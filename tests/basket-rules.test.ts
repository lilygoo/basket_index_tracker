import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canRemoveConstituent, filterAndOrderBaskets, newBasketValues, validateNewBasket } from "../lib/basket-rules";
import type { Basket } from "../lib/types";

const member = (id: string, ticker: string) => ({
  id, ticker, activeFrom: "2026-01-01", activeTo: null, status: "ready" as const, pendingReason: null,
});
const basket = (id: string, name: string, tickers: string[]): Basket => ({
  id, name, weightingMethod: "equal", rebalanceFrequency: "monthly", inceptionDate: "2026-01-01", revision: 1,
  constituents: tickers.map((ticker, index) => member(`${id}-${index}`, ticker)),
});
const baskets = [
  basket("a", "Alpha", ["NVDA", "AMD"]),
  basket("b", "Beta", ["NVDA"]),
  basket("c", "Gamma", ["AMD", "AVGO"]),
];

describe("basket UI rules", () => {
  it("moves the selected basket to the top without disturbing the others", () => {
    assert.deepEqual(filterAndOrderBaskets(baskets, "", [], "c").map(({ id }) => id), ["c", "a", "b"]);
  });

  it("uses AND logic for multiple exact ticker filters", () => {
    assert.deepEqual(filterAndOrderBaskets(baskets, "", ["NVDA", "AMD"], "b").map(({ id }) => id), ["a"]);
  });

  it("validates names case-insensitively and requires initial tickers", () => {
    assert.equal(validateNewBasket(" alpha ", "NVDA", ["Alpha"]).error, "A basket with that name already exists.");
    assert.equal(validateNewBasket("New", "", []).error, "Add at least one valid ticker, separated by commas or spaces.");
    assert.deepEqual(newBasketValues(" New ", "nvda, AMD nvda", "market_cap", []), {
      error: null, name: "New", tickers: ["NVDA", "AMD"], weightingMethod: "market_cap",
    });
  });

  it("protects the final active ticker", () => {
    assert.equal(canRemoveConstituent(baskets[1]), false);
    assert.equal(canRemoveConstituent(baskets[0]), true);
  });
});
