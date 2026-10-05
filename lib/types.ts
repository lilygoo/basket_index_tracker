export type WeightingMethod = "equal" | "market_cap";
export type Frequency = "daily" | "weekly";
export type ComparisonView = "overlay" | "ratio";

export interface BasketConstituent {
  id: string;
  ticker: string;
  activeFrom: string;
  activeTo: string | null;
  status: "ready" | "pending";
  pendingReason: "support" | "price" | "market_cap" | null;
}

export interface Basket {
  id: string;
  name: string;
  weightingMethod: WeightingMethod;
  rebalanceFrequency: "monthly";
  inceptionDate: string;
  revision: number;
  constituents: BasketConstituent[];
}

export interface PriceRow {
  ticker: string;
  date: string;
  rawClose: number;
  adjustedClose: number;
  marketCap: number | null;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface BasketSeries {
  equal: SeriesPoint[];
  marketCap: SeriesPoint[];
  marketCapMissing: string[];
}

export interface WorkspaceData {
  baskets: Basket[];
  series: Record<string, BasketSeries>;
  priceAsOf: string | null;
  persistent: boolean;
}
