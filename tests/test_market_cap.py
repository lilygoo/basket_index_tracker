from __future__ import annotations

import pandas as pd

from basket_index_tracker.market_cap import _last_stored_shares, enrich_price_rows


def test_enrichment_forward_fills_and_pads_leading_gap() -> None:
    prices = [
        {"ticker": "ABC", "price_date": "2026-01-02", "raw_close": 10},
        {"ticker": "ABC", "price_date": "2026-01-05", "raw_close": 11},
        {"ticker": "ABC", "price_date": "2026-01-06", "raw_close": 12},
    ]
    shares = pd.Series(
        [100, 120],
        index=pd.to_datetime(["2026-01-03", "2026-01-06"]),
    )
    result = enrich_price_rows(prices, shares)
    assert [row["price_date"] for row in result] == ["2026-01-02", "2026-01-05", "2026-01-06"]
    assert result[0]["shares_outstanding"] == 100
    assert result[0]["market_cap"] == 1000
    assert result[1]["shares_outstanding"] == 100
    assert result[1]["market_cap"] == 1100
    assert result[2]["shares_outstanding"] == 120
    assert result[2]["market_cap"] == 1440


def test_enrichment_uses_current_shares_when_history_is_unavailable() -> None:
    prices = [{"ticker": "ABC", "price_date": "2026-01-02", "raw_close": 10}]
    result = enrich_price_rows(prices, None, fallback_shares=150)
    assert result == [{
        "ticker": "ABC",
        "price_date": "2026-01-02",
        "shares_outstanding": 150,
        "market_cap": 1500.0,
    }]


def test_historical_shares_win_over_current_fallback_for_leading_dates() -> None:
    prices = [{"ticker": "ABC", "price_date": "2026-01-02", "raw_close": 10}]
    shares = pd.Series([100], index=pd.to_datetime(["2026-01-03"]))
    result = enrich_price_rows(prices, shares, fallback_shares=150)
    assert result[0]["shares_outstanding"] == 100


def test_last_stored_shares_supports_stale_carry_forward() -> None:
    rows = [
        {"shares_outstanding": 100},
        {"shares_outstanding": None},
        {"shares_outstanding": 120},
    ]
    assert _last_stored_shares(rows) == 120


def test_enrichment_accepts_live_rows_with_null_market_columns() -> None:
    prices = [{
        "ticker": "ABC",
        "price_date": "2026-01-02",
        "raw_close": 10,
        "shares_outstanding": None,
        "market_cap": None,
    }]
    shares = pd.Series([100], index=pd.to_datetime(["2026-01-02"]))
    assert enrich_price_rows(prices, shares)[0]["market_cap"] == 1000
