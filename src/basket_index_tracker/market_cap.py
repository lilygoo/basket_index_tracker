from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import pandas as pd
import yfinance as yf
from supabase import Client, create_client


def enrich_price_rows(
    price_rows: list[dict[str, Any]],
    shares: pd.Series | None,
    fallback_shares: int | None = None,
) -> list[dict[str, Any]]:
    """Fill missing daily inputs with as-of shares; pad leading gaps once."""
    if not price_rows:
        return []
    normalized = pd.Series(dtype=float)
    if shares is not None and not shares.empty:
        normalized = shares.astype(float).dropna().sort_index()
        normalized.index = pd.DatetimeIndex(normalized.index).tz_localize(None).normalize()
        normalized = normalized[~normalized.index.duplicated(keep="last")]
    if normalized.empty and not fallback_shares:
        return []

    price_frame = pd.DataFrame(price_rows).drop(
        columns=["shares_outstanding", "market_cap"], errors="ignore"
    ).copy()
    price_frame["price_date_value"] = pd.to_datetime(price_frame["price_date"]).astype("datetime64[ns]")
    price_frame = price_frame.sort_values("price_date_value")
    if normalized.empty:
        price_frame["shares_outstanding"] = float(fallback_shares)
    else:
        share_frame = normalized.rename("shares_outstanding").rename_axis("share_date").reset_index()
        share_frame["share_date"] = pd.to_datetime(share_frame["share_date"]).astype("datetime64[ns]")
        price_frame = pd.merge_asof(
            price_frame,
            share_frame,
            left_on="price_date_value",
            right_on="share_date",
            direction="backward",
        )
        leading_value = float(normalized.iloc[0])
        price_frame["shares_outstanding"] = price_frame["shares_outstanding"].fillna(leading_value)

    output: list[dict[str, Any]] = []
    for row in price_frame.to_dict("records"):
        if row.get("shares_outstanding") is None or pd.isna(row["shares_outstanding"]):
            continue
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
    active_baskets = (
        client.table("baskets").select("id").is_("deleted_at", "null").execute().data or []
    )
    basket_ids = [str(row["id"]) for row in active_baskets]
    if not basket_ids:
        return []
    member_rows = (
        client.table("basket_constituents").select("ticker").in_("basket_id", basket_ids).execute().data or []
    )
    tickers = sorted({str(row["ticker"]) for row in member_rows})
    if not tickers:
        return []

    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        response = (
            client.table("daily_prices")
            .select("ticker,price_date,raw_close,shares_outstanding,market_cap")
            .in_("ticker", tickers)
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


def _utc_iso(value: Any) -> str:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return timestamp.isoformat()


def fetch_market_data(ticker: str, rows: list[dict[str, Any]]) -> tuple[pd.Series | None, int | None, float | None, str, str]:
    dates = [date.fromisoformat(str(row["price_date"])) for row in rows]
    start = min(dates) - timedelta(days=75)
    end = max(max(dates), date.today()) + timedelta(days=2)
    security = yf.Ticker(ticker)
    shares = security.get_shares_full(start=start.isoformat(), end=end.isoformat())
    if shares is not None and not shares.dropna().empty:
        available = shares.dropna()
        current_shares = int(round(float(available.iloc[-1])))
        return shares, current_shares, None, "yfinance_shares", _utc_iso(available.index[-1])

    market_cap: float | None = None
    try:
        value = security.fast_info.get("market_cap") or security.fast_info.get("marketCap")
        if value is not None and float(value) > 0:
            market_cap = float(value)
    except Exception:
        market_cap = None
    if market_cap:
        latest_raw = float(rows[-1]["raw_close"])
        if latest_raw > 0:
            return None, int(round(market_cap / latest_raw)), market_cap, "yfinance_market_cap", datetime.now(timezone.utc).isoformat()
    return None, None, None, "unavailable", datetime.now(timezone.utc).isoformat()


def _chunks(rows: list[dict[str, Any]], size: int = 500):
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


def _last_stored_shares(rows: list[dict[str, Any]]) -> int | None:
    values = [int(row["shares_outstanding"]) for row in rows if row.get("shares_outstanding")]
    return values[-1] if values else None


def refresh_market_caps(client: Client | None = None, workers: int = 4) -> dict[str, Any]:
    database = client or create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])
    price_rows = load_price_rows(database)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in price_rows:
        grouped.setdefault(str(row["ticker"]), []).append(row)

    provider_results: dict[str, tuple[pd.Series | None, int | None, float | None, str, str]] = {}
    provider_errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(fetch_market_data, ticker, rows): ticker for ticker, rows in grouped.items()}
        for future in as_completed(futures):
            ticker = futures[future]
            try:
                provider_results[ticker] = future.result()
            except Exception as exc:
                provider_errors[ticker] = str(exc)
                provider_results[ticker] = (None, None, None, "unavailable", datetime.now(timezone.utc).isoformat())

    updates: list[dict[str, Any]] = []
    errors: dict[str, str] = {}
    snapshots = 0
    for ticker, rows in grouped.items():
        shares, current_shares, provider_cap, source, provider_as_of = provider_results[ticker]
        previous_shares = _last_stored_shares(rows)
        stale = current_shares is None
        if current_shares is None:
            current_shares = previous_shares
            source = "carried_forward" if current_shares else source
            if current_shares:
                last_filled = next(row for row in reversed(rows) if row.get("shares_outstanding"))
                provider_as_of = _utc_iso(last_filled["price_date"])
        if current_shares is None:
            errors[ticker] = provider_errors.get(ticker, "no shares outstanding or market cap available")
            continue

        missing = [row for row in rows if not row.get("shares_outstanding") or not row.get("market_cap")]
        updates.extend(enrich_price_rows(missing, shares, current_shares))
        latest_raw = Decimal(str(rows[-1]["raw_close"]))
        current_cap = provider_cap or float((latest_raw * Decimal(current_shares)).quantize(Decimal("0.01")))
        response = database.rpc("record_security_market_snapshot", {
            "p_ticker": ticker,
            "p_shares_outstanding": current_shares,
            "p_market_cap": current_cap,
            "p_as_of": provider_as_of,
            "p_source": source,
            "p_stale": stale,
        }).execute()
        if response.data is not None or not getattr(response, "error", None):
            snapshots += 1

    updated = 0
    for chunk in _chunks(updates):
        response = database.rpc("update_daily_price_market_caps", {"p_rows": chunk}).execute()
        updated += int(response.data or 0)
    return {
        "tickers": len(grouped),
        "rows_updated": updated,
        "snapshots_updated": snapshots,
        "errors": errors,
    }
