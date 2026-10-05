import "server-only";
import { calculateIndex } from "@/lib/index-engine";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase";
import { demoWorkspace } from "@/lib/demo";
import type { Basket, PriceRow, WorkspaceData, WeightingMethod } from "@/lib/types";

type DbBasket = { id: string; name: string; weighting_method: WeightingMethod; rebalance_frequency: "monthly"; inception_date: string; revision: number };
type DbMember = { id: string; basket_id: string; ticker: string; active_from: string; active_to: string | null };
type DbPrice = { ticker: string; price_date: string; raw_close: number | string; adjusted_close: number | string; market_cap: number | string | null };

async function loadPrices(tickers: string[]) {
  if (!tickers.length) return [] as DbPrice[];
  const supabase = createAdminClient();
  const rows: DbPrice[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("daily_prices")
      .select("ticker,price_date,raw_close,adjusted_close,market_cap")
      .in("ticker", tickers).order("ticker").order("price_date").range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as DbPrice[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function loadWorkspace(): Promise<WorkspaceData> {
  if (!isSupabaseConfigured()) return demoWorkspace();
  const supabase = createAdminClient();
  const [{ data: basketRows, error: basketError }, { data: memberRows, error: memberError }] = await Promise.all([
    supabase.from("baskets").select("id,name,weighting_method,rebalance_frequency,inception_date,revision").is("deleted_at", null).order("created_at"),
    supabase.from("basket_constituents").select("id,basket_id,ticker,active_from,active_to").order("created_at"),
  ]);
  if (basketError) throw basketError;
  if (memberError) throw memberError;
  const dbMembers = (memberRows ?? []) as DbMember[];
  const tickers = [...new Set(dbMembers.map((row) => row.ticker))];
  const dbPrices = await loadPrices(tickers);
  const prices: PriceRow[] = dbPrices.map((row) => ({
    ticker: row.ticker, date: row.price_date, rawClose: Number(row.raw_close), adjustedClose: Number(row.adjusted_close),
    marketCap: row.market_cap === null ? null : Number(row.market_cap),
  }));
  const priceTickers = new Set(prices.map((row) => row.ticker));
  const latestPriceByTicker = new Map<string, PriceRow>();
  for (const row of prices) latestPriceByTicker.set(row.ticker, row);
  const capTickers = new Set([...latestPriceByTicker].filter(([, row]) => row.marketCap && row.marketCap > 0).map(([ticker]) => ticker));
  function mapMember(member: DbMember, weightingMethod: WeightingMethod) {
      const hasPrice = priceTickers.has(member.ticker);
      const hasCap = capTickers.has(member.ticker);
      const pendingReason = !hasPrice ? "price" as const : weightingMethod === "market_cap" && !hasCap ? "market_cap" as const : null;
      return { id: member.id, ticker: member.ticker, activeFrom: member.active_from, activeTo: member.active_to, status: pendingReason ? "pending" as const : "ready" as const, pendingReason };
  }
  const dbBaskets = (basketRows ?? []) as DbBasket[];
  const baskets: Basket[] = dbBaskets.map((row) => ({
    id: row.id, name: row.name, weightingMethod: row.weighting_method, rebalanceFrequency: row.rebalance_frequency,
    inceptionDate: row.inception_date, revision: row.revision,
    constituents: dbMembers.filter((member) => member.basket_id === row.id && !member.active_to).map((member) => mapMember(member, row.weighting_method)),
  }));
  const priceAsOf = dbPrices.map((row) => row.price_date).sort().at(-1) ?? null;
  const series = Object.fromEntries(baskets.map((basket) => {
    const historicalBasket = { ...basket, constituents: dbMembers.filter((member) => member.basket_id === basket.id).map((member) => mapMember(member, basket.weightingMethod)) };
    const activeTickers = historicalBasket.constituents.filter((member) => !member.activeTo).map((member) => member.ticker);
    const marketCapMissing = activeTickers.filter((ticker) => priceTickers.has(ticker) && !capTickers.has(ticker));
    return [basket.id, {
      equal: calculateIndex(historicalBasket, prices, "equal"),
      marketCap: calculateIndex(historicalBasket, prices, "market_cap"),
      marketCapMissing,
    }];
  }));
  return { baskets, series, priceAsOf, persistent: true };
}
