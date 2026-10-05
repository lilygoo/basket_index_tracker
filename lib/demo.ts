import type { Basket, PriceRow, WorkspaceData } from "@/lib/types";
import { calculateIndex } from "@/lib/index-engine";

const definitions = [
  ["11111111-1111-4111-8111-111111111111", "AI Losers", "equal", ["INTU", "FIG", "HUBS", "ADBE", "MNDY"]],
  ["22222222-2222-4222-8222-222222222222", "AI Infrastructure", "market_cap", ["NVDA", "AVGO", "AMD", "ANET", "VRT"]],
  ["33333333-3333-4333-8333-333333333333", "Legacy Software", "equal", ["ORCL", "IBM", "SAP", "CSCO"]],
  ["44444444-4444-4444-8444-444444444444", "Consumer Compounders", "market_cap", ["COST", "WMT", "MCD", "TJX", "LOW"]],
] as const;

export const demoBaskets: Basket[] = definitions.map(([id, name, weightingMethod, tickers]) => ({
  id, name, weightingMethod, rebalanceFrequency: "monthly", inceptionDate: "2025-10-01", revision: 1,
  constituents: tickers.map((ticker, index) => ({
    id: `${id}-${index}`, ticker, activeFrom: "2025-10-01", activeTo: null,
    status: index > 2 ? "pending" : "ready", pendingReason: index > 2 ? "price" : null,
  })),
}));

function hash(value: string) {
  return [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

export function demoPriceRows(basket: Basket): PriceRow[] {
  const rows: PriceRow[] = [];
  const start = new Date("2025-10-01T12:00:00Z");
  for (const member of basket.constituents.filter((item) => item.status === "ready")) {
    const seed = hash(member.ticker);
    let price = 40 + (seed % 180);
    for (let offset = 0; offset < 365; offset += 1) {
      const date = new Date(start); date.setUTCDate(start.getUTCDate() + offset);
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
      price *= 1 + Math.sin((offset + seed) / 19) * 0.006 + ((seed % 9) - 3) * 0.00018;
      const shares = 100_000_000 + (seed % 30) * 25_000_000;
      rows.push({ ticker: member.ticker, date: date.toISOString().slice(0, 10), rawClose: price, adjustedClose: price, marketCap: price * shares });
    }
  }
  return rows;
}

export function demoSeriesForBasket(basket: Basket) {
  const prices = demoPriceRows(basket);
  return {
    equal: calculateIndex(basket, prices, "equal"),
    marketCap: calculateIndex(basket, prices, "market_cap"),
    marketCapMissing: [],
  };
}

export function demoWorkspace(): WorkspaceData {
  return {
    baskets: demoBaskets,
    series: Object.fromEntries(demoBaskets.map((basket) => [basket.id, demoSeriesForBasket(basket)])),
    priceAsOf: "2026-09-30",
    persistent: false,
  };
}
