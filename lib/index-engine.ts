import type { Basket, Frequency, PriceRow, SeriesPoint, WeightingMethod } from "@/lib/types";

const round = (value: number) => Math.round(value * 1e8) / 1e8;

function activeOn(basket: Basket, date: string) {
  return basket.constituents.filter((member) => member.activeFrom <= date && (!member.activeTo || date < member.activeTo));
}

export function calculateIndex(basket: Basket, rows: PriceRow[], weightingMethod: WeightingMethod = basket.weightingMethod): SeriesPoint[] {
  const relevant = rows.filter((row) => basket.constituents.some((member) => member.ticker === row.ticker) && row.date >= basket.inceptionDate);
  const dates = [...new Set(relevant.map((row) => row.date))].sort();
  const rowsByDate = new Map<string, PriceRow[]>();
  for (const row of relevant) rowsByDate.set(row.date, [...(rowsByDate.get(row.date) ?? []), row]);

  const latest = new Map<string, PriceRow>();
  let units = new Map<string, number>();
  let previousMonth = "";
  let previousEligibility = "";
  let started = false;
  const output: SeriesPoint[] = [];

  for (const date of dates) {
    for (const row of rowsByDate.get(date) ?? []) latest.set(row.ticker, row);
    const active = activeOn(basket, date);
    const priced = active.filter((member) => {
      const price = latest.get(member.ticker);
      return Boolean(price && price.adjustedClose > 0);
    });
    if (weightingMethod === "market_cap" && priced.some((member) => (latest.get(member.ticker)?.marketCap ?? 0) <= 0)) continue;
    const eligible = priced;
    if (!eligible.length) continue;

    let level = 100;
    if (units.size) {
      const marked = [...units].reduce((sum, [ticker, quantity]) => {
        const price = latest.get(ticker);
        return sum + (price ? quantity * price.adjustedClose : 0);
      }, 0);
      if (marked > 0) level = marked;
    }

    const month = date.slice(0, 7);
    const eligibility = eligible.map((member) => member.ticker).sort().join("|");
    const shouldRebalance = !started || month !== previousMonth || eligibility !== previousEligibility;
    if (shouldRebalance) {
      const denominator = weightingMethod === "equal"
        ? eligible.length
        : eligible.reduce((sum, member) => sum + (latest.get(member.ticker)?.marketCap ?? 0), 0);
      units = new Map(eligible.map((member) => {
        const price = latest.get(member.ticker)!;
        const weight = weightingMethod === "equal" ? 1 / denominator : (price.marketCap ?? 0) / denominator;
        return [member.ticker, (level * weight) / price.adjustedClose];
      }));
    }

    started = true;
    previousMonth = month;
    previousEligibility = eligibility;
    output.push({ date, value: round(level) });
  }
  return output;
}

export function chartAxis(values: number[]) {
  if (!values.length) return { lo: 99, hi: 101, step: 1, ticks: [99, 100, 101] };
  const min = Math.min(100, ...values);
  const max = Math.max(100, ...values);
  const span = max - min;
  const step = span <= 10 ? 1 : span <= 50 ? 5 : 10;
  let lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (lo === hi) { lo -= step; hi += step; }
  const ticks: number[] = [];
  for (let value = lo; value <= hi + step / 2; value += step) ticks.push(value);
  return { lo, hi, step, ticks };
}

export function sampleSeries(series: SeriesPoint[], frequency: Frequency): SeriesPoint[] {
  if (frequency === "daily") return series;
  const weeks = new Map<string, SeriesPoint>();
  for (const point of series) {
    const date = new Date(`${point.date}T12:00:00Z`);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    weeks.set(`${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`, point);
  }
  return [...weeks.values()];
}

export function commonDates(a: SeriesPoint[], b: SeriesPoint[]) {
  const bDates = new Set(b.map((point) => point.date));
  return a.map((point) => point.date).filter((date) => bDates.has(date));
}

export function rebaseSeries(series: SeriesPoint[], date: string): SeriesPoint[] {
  const base = series.find((point) => point.date === date)?.value;
  if (!base) return [];
  return series.map((point) => ({ date: point.date, value: round((point.value / base) * 100) }));
}

export function ratioSeries(a: SeriesPoint[], b: SeriesPoint[], rebaseDate?: string): SeriesPoint[] {
  const byDate = new Map(b.map((point) => [point.date, point.value]));
  const joined = a.flatMap((point) => {
    const other = byDate.get(point.date);
    return other ? [{ date: point.date, value: point.value / other }] : [];
  });
  if (!joined.length) return [];
  return rebaseSeries(joined, rebaseDate && joined.some((point) => point.date === rebaseDate) ? rebaseDate : joined[0].date);
}
