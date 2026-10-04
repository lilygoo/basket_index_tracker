from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pandas as pd
import yfinance as yf
from supabase import Client, create_client


def enrich_price_rows(price_rows: list[dict[str, Any]], shares: pd.Series) -> list[dict[str, Any]]:
    """As-of join sparse reported shares to daily raw closes without lookahead."""
    if not price_rows or shares is None or shares.empty:
        return []
    normalized = shares.astype(float).dropna().sort_index()
    normalized.index = pd.DatetimeIndex(normalized.index).tz_localize(None).normalize()
    normalized = normalized[~normalized.index.duplicated(keep="last")]
    share_frame = normalized.rename("shares_outstanding").rename_axis("share_date").reset_index()
    price_frame = pd.DataFrame(price_rows).copy()
    price_frame["price_date_value"] = pd.to_datetime(price_frame["price_date"])
    price_frame = price_frame.sort_values("price_date_value")
    joined = pd.merge_asof(
        price_frame,
        share_frame,
        left_on="price_date_value",
        right_on="share_date",
        direction="backward",
    ).dropna(subset=["shares_outstanding"])
    output: list[dict[str, Any]] = []
    for row in joined.to_dict("records"):
        share_count = int(round(float(row["shares_outstanding"])))
        raw_close = Decimal(str(row["raw_close"]))
        market_cap = (raw_close * Decimal(share_count)).quantize(Decimal("0.01"))
        if share_count > 0 and market_cap > 0:
            output.append({
                "ticker": str(row["ticker"]),
                "price_date": str(row["price_date"]),
                "shares_outstanding": share_count,
                "market_cap": float(market_cap),
            })
    return output


def load_price_rows(client: Client) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        response = (
            client.table("daily_prices")
            .select("ticker,price_date,raw_close")
            .order("ticker")
            .order("price_date")
            .range(start, start + 999)
            .execute()
        )
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def fetch_shares(ticker: str, rows: list[dict[str, Any]]) -> pd.Series | None:
    dates = [date.fromisoformat(str(row["price_date"])) for row in rows]
    start = min(dates) - timedelta(days=75)
    end = max(dates) + timedelta(days=2)
    return yf.Ticker(ticker).get_shares_full(start=start.isoformat(), end=end.isoformat())


def _chunks(rows: list[dict[str, Any]], size: int = 500):
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


def refresh_market_caps(client: Client | None = None, workers: int = 4) -> dict[str, Any]:
    database = client or create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])
    price_rows = load_price_rows(database)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in price_rows:
        grouped.setdefault(str(row["ticker"]), []).append(row)
    updates: list[dict[str, Any]] = []
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(fetch_shares, ticker, rows): (ticker, rows) for ticker, rows in grouped.items()}
        for future in as_completed(futures):
            ticker, rows = futures[future]
            try:
                shares = future.result()
                enriched = enrich_price_rows(rows, shares) if shares is not None else []
                if not enriched:
                    raise ValueError("no historical shares outstanding available")
                updates.extend(enriched)
            except Exception as exc:  # ticker failures must not discard successful updates
                errors[ticker] = str(exc)
    updated = 0
    for chunk in _chunks(updates):
        response = database.rpc("update_daily_price_market_caps", {"p_rows": chunk}).execute()
        updated += int(response.data or 0)
    return {"tickers": len(grouped), "rows_updated": updated, "errors": errors}
