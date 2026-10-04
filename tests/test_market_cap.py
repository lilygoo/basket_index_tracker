from __future__ import annotations

import pandas as pd

from basket_index_tracker.market_cap import enrich_price_rows


def test_enrichment_forward_fills_without_lookahead() -> None:
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
    assert [row["price_date"] for row in result] == ["2026-01-05", "2026-01-06"]
    assert result[0]["shares_outstanding"] == 100
    assert result[0]["market_cap"] == 1100
    assert result[1]["shares_outstanding"] == 120
    assert result[1]["market_cap"] == 1440
