import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateIndex, commonDates, ratioSeries, rebaseSeries, sampleSeries } from "../lib/index-engine";
import type { Basket, PriceRow } from "../lib/types";

const basket: Basket = {
  id: "one", name: "Test", weightingMethod: "equal", rebalanceFrequency: "monthly",
  inceptionDate: "2026-01-01", revision: 1,
  constituents: [
    { id: "a", ticker: "AAA", activeFrom: "2026-01-01", activeTo: null, status: "ready", pendingReason: null },
    { id: "b", ticker: "BBB", activeFrom: "2026-01-01", activeTo: null, status: "ready", pendingReason: null },
  ],
};

const rows: PriceRow[] = [
  { ticker: "AAA", date: "2026-01-02", rawClose: 10, adjustedClose: 10, marketCap: 100 },
  { ticker: "BBB", date: "2026-01-02", rawClose: 20, adjustedClose: 20, marketCap: 300 },
  { ticker: "AAA", date: "2026-01-05", rawClose: 11, adjustedClose: 11, marketCap: 110 },
  { ticker: "BBB", date: "2026-01-05", rawClose: 20, adjustedClose: 20, marketCap: 300 },
  { ticker: "AAA", date: "2026-02-02", rawClose: 12, adjustedClose: 12, marketCap: 120 },
  { ticker: "BBB", date: "2026-02-02", rawClose: 18, adjustedClose: 18, marketCap: 270 },
];

describe("index engine", () => {
  it("builds an equal-weight index and preserves level at rebalance", () => {
    const result = calculateIndex(basket, rows);
    assert.deepEqual(result[0], { date: "2026-01-02", value: 100 });
    assert.equal(result[1].value, 105);
    assert.ok(Math.abs(result[2].value - 105) < 0.00001);
  });

  it("uses market caps for target weights", () => {
    const result = calculateIndex({ ...basket, weightingMethod: "market_cap" }, rows);
    assert.ok(Math.abs(result[1].value - 102.5) < 0.00001);
  });

  it("rebases both series on a selected common date", () => {
    const a = calculateIndex(basket, rows);
    const b = a.map((point) => ({ ...point, value: point.value * 1.2 }));
    assert.equal(commonDates(a, b).length, 3);
    assert.equal(rebaseSeries(a, "2026-01-05").find((point) => point.date === "2026-01-05")?.value, 100);
    assert.equal(ratioSeries(a, b, "2026-01-05").find((point) => point.date === "2026-01-05")?.value, 100);
  });

  it("samples the last observation in each week", () => {
    assert.equal(sampleSeries(calculateIndex(basket, rows), "weekly").length, 3);
  });
});
