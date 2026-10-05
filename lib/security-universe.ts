export interface SecurityUniverseStatus {
  ticker: string;
  active: boolean;
  support_status: string;
}

export function unsupportedTickers(tickers: string[], rows: SecurityUniverseStatus[]) {
  const supported = new Set(
    rows
      .filter((row) => row.active && row.support_status === "supported")
      .map((row) => row.ticker.toUpperCase()),
  );
  return tickers.filter((ticker) => !supported.has(ticker.toUpperCase()));
}

export function supportedTickerSet(rows: SecurityUniverseStatus[]) {
  return new Set(
    rows
      .filter((row) => row.active && row.support_status === "supported")
      .map((row) => row.ticker.toUpperCase()),
  );
}
