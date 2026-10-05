import type { Basket, WeightingMethod } from "@/lib/types";

export const TICKER_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;

export function filterAndOrderBaskets(
  baskets: Basket[],
  nameQuery: string,
  tickerFilters: string[],
  selectedId: string,
) {
  const query = nameQuery.trim().toLowerCase();
  return baskets
    .filter((basket) =>
      basket.name.toLowerCase().includes(query)
      && tickerFilters.every((ticker) => basket.constituents.some((member) => member.ticker === ticker)),
    )
    .map((basket, position) => ({ basket, position }))
    .sort((left, right) => {
      const selectedDifference = Number(right.basket.id === selectedId) - Number(left.basket.id === selectedId);
      return selectedDifference || left.position - right.position;
    })
    .map(({ basket }) => basket);
}

export function parseTickerList(value: string) {
  return [...new Set(value.toUpperCase().split(/[\s,]+/).map((ticker) => ticker.trim()).filter(Boolean))];
}

export function validateNewBasket(
  name: string,
  tickerText: string,
  existingNames: string[],
): { error: string | null; name: string; tickers: string[] } {
  const cleanName = name.trim();
  const tickers = parseTickerList(tickerText);
  if (!cleanName) return { error: "Enter a basket name.", name: cleanName, tickers };
  if (existingNames.some((value) => value.trim().toLowerCase() === cleanName.toLowerCase())) {
    return { error: "A basket with that name already exists.", name: cleanName, tickers };
  }
  if (!tickers.length || tickers.some((ticker) => !TICKER_PATTERN.test(ticker))) {
    return { error: "Add at least one valid ticker, separated by commas or spaces.", name: cleanName, tickers };
  }
  return { error: null, name: cleanName, tickers };
}

export function canRemoveConstituent(basket: Basket) {
  return basket.constituents.length > 1;
}

export function newBasketValues(name: string, tickerText: string, weightingMethod: WeightingMethod, existingNames: string[]) {
  const validated = validateNewBasket(name, tickerText, existingNames);
  return validated.error ? { ...validated, weightingMethod: null } : { ...validated, weightingMethod };
}
