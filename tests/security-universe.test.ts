import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { supportedTickerSet, unsupportedTickers } from "../lib/security-universe";

describe("shared security universe", () => {
  const rows = [
    { ticker: "READY", active: true, support_status: "supported" },
    { ticker: "REQUESTED", active: true, support_status: "requested" },
    { ticker: "DECLINED", active: false, support_status: "declined" },
  ];

  it("recognizes only active supported rows", () => {
    assert.deepEqual([...supportedTickerSet(rows)], ["READY"]);
  });

  it("queues absent, requested, and declined tickers", () => {
    assert.deepEqual(
      unsupportedTickers(["READY", "REQUESTED", "DECLINED", "ABSENT"], rows),
      ["REQUESTED", "DECLINED", "ABSENT"],
    );
  });

  it("does not infer support from historical-price information", () => {
    const historicalPriceTickers = new Set(["ABSENT"]);
    assert.equal(historicalPriceTickers.has("ABSENT"), true);
    assert.deepEqual(unsupportedTickers(["ABSENT"], rows), ["ABSENT"]);
  });

  it("classifies every unsupported ticker in a multi-ticker basket", () => {
    assert.deepEqual(unsupportedTickers(["ABSENT", "READY", "REQUESTED"], rows), ["ABSENT", "REQUESTED"]);
  });
});
