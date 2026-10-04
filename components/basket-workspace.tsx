"use client";

import { FormEvent, PointerEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, GitCompareArrows, Plus, Search, X } from "lucide-react";
import { commonDates, ratioSeries, rebaseSeries, sampleSeries } from "@/lib/index-engine";
import { demoSeriesForBasket } from "@/lib/demo";
import type { Basket, ComparisonView, Frequency, SeriesPoint, WeightingMethod, WorkspaceData } from "@/lib/types";

const COLORS = ["#3568a8", "#087b6b"];
const fmtDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function InteractiveChart({ datasets, rebaseDate, selectableDates, onSelectDate }: {
  datasets: { name: string; points: SeriesPoint[]; color: string }[];
  rebaseDate?: string;
  selectableDates?: string[];
  onSelectDate?: (date: string) => void;
}) {
  const W = 900, H = 380, L = 56, R = 22, T = 24, B = 42;
  const dates = datasets[0]?.points.map((point) => point.date) ?? [];
  const values = datasets.flatMap((dataset) => dataset.points.map((point) => point.value));
  if (!dates.length || !values.length) return <div className="chart-empty">No calculated history is available yet.</div>;
  const min = Math.min(...values), max = Math.max(...values), pad = Math.max((max - min) * 0.12, 1);
  const lo = min - pad, hi = max + pad;
  const x = (index: number) => L + index * (W - L - R) / Math.max(dates.length - 1, 1);
  const y = (value: number) => T + (hi - value) * (H - T - B) / (hi - lo);
  const selectedIndex = rebaseDate ? dates.indexOf(rebaseDate) : -1;

  function pick(event: PointerEvent<SVGSVGElement>) {
    if (!onSelectDate || !selectableDates?.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = (event.clientX - rect.left) / rect.width * W;
    const index = Math.max(0, Math.min(dates.length - 1, Math.round((svgX - L) / (W - L - R) * (dates.length - 1))));
    const candidate = dates[index];
    if (selectableDates.includes(candidate)) onSelectDate(candidate);
  }

  function moveSelection(direction: number) {
    if (!onSelectDate || !selectableDates?.length) return;
    const current = Math.max(0, selectableDates.indexOf(rebaseDate ?? selectableDates[0]));
    onSelectDate(selectableDates[Math.max(0, Math.min(selectableDates.length - 1, current + direction))]);
  }

  return <div className="chart-wrap">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={onSelectDate ? "Index comparison chart. Click or drag to choose the vertical rebase date." : "Basket index history chart"}
      tabIndex={onSelectDate ? 0 : undefined} className={onSelectDate ? "chart selectable" : "chart"}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pick(event); }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event); }}
      onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); moveSelection(-1); } if (event.key === "ArrowRight") { event.preventDefault(); moveSelection(1); } }}>
      {Array.from({ length: 5 }, (_, index) => {
        const yy = T + index * (H - T - B) / 4; const value = hi - index * (hi - lo) / 4;
        return <g key={index}><line x1={L} x2={W - R} y1={yy} y2={yy} className="chart-grid"/><text x={L - 9} y={yy + 4} textAnchor="end" className="chart-label">{value.toFixed(1)}</text></g>;
      })}
      {datasets.map((dataset) => <path key={dataset.name} d={dataset.points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ")} fill="none" stroke={dataset.color} strokeWidth="2.8" vectorEffect="non-scaling-stroke"/>) }
      {selectedIndex >= 0 && <g><line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={T} y2={H - B} className="rebase-line"/><circle cx={x(selectedIndex)} cy={y(100)} r="5" className="rebase-dot"/><text x={x(selectedIndex)} y={T + 13} textAnchor={selectedIndex > dates.length * .75 ? "end" : "start"} dx={selectedIndex > dates.length * .75 ? -7 : 7} className="rebase-label">Rebase · {fmtDate(dates[selectedIndex])}</text></g>}
      <text x={L} y={H - 12} className="chart-label">{fmtDate(dates[0])}</text><text x={W - R} y={H - 12} textAnchor="end" className="chart-label">{fmtDate(dates.at(-1)!)}</text>
    </svg>
  </div>;
}

function BasketCard({ basket, selected, persistent, onSelect, onLocalChange }: {
  basket: Basket; selected: boolean; persistent: boolean; onSelect: () => void; onLocalChange: (basket: Basket) => void;
}) {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [message, setMessage] = useState("");

  async function patch(values: Partial<Pick<Basket, "name" | "weightingMethod">>) {
    if (!persistent) { onLocalChange({ ...basket, ...values, revision: basket.revision + 1 }); return; }
    const response = await fetch(`/api/baskets/${basket.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, revision: basket.revision }) });
    if (!response.ok) setMessage((await response.json().catch(() => ({}))).error ?? "Change could not be saved.");
    else router.refresh();
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const symbol = ticker.trim().toUpperCase();
    if (!/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(symbol)) { setMessage("Enter a valid ticker."); return; }
    if (basket.constituents.some((member) => member.ticker === symbol)) { setMessage(`${symbol} is already in this basket.`); return; }
    if (!persistent) {
      const next = { ...basket, revision: basket.revision + 1, constituents: [...basket.constituents, { id: crypto.randomUUID(), ticker: symbol, activeFrom: new Date().toISOString().slice(0, 10), activeTo: null, status: "pending" as const, pendingReason: "price" as const }] };
      onLocalChange(next); setTicker(""); setMessage(`${symbol} is Pending.`); return;
    }
    const response = await fetch(`/api/baskets/${basket.id}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: symbol, revision: basket.revision }) });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? body.pending ? `${symbol} added as Pending.` : `${symbol} added.` : body.error ?? "Ticker could not be added.");
    if (response.ok) { setTicker(""); router.refresh(); }
  }

  async function remove(memberId: string) {
    if (!persistent) { onLocalChange({ ...basket, revision: basket.revision + 1, constituents: basket.constituents.filter((member) => member.id !== memberId) }); return; }
    const response = await fetch(`/api/baskets/${basket.id}/members/${memberId}?revision=${basket.revision}`, { method: "DELETE" });
    if (!response.ok) setMessage((await response.json().catch(() => ({}))).error ?? "Ticker could not be removed.");
    else router.refresh();
  }

  const ready = basket.constituents.filter((member) => member.status === "ready").length;
  const pending = basket.constituents.length - ready;
  return <article className={`basket-card ${selected ? "selected" : ""}`} onClick={onSelect}>
    <div className="basket-card-head">
      <input aria-label="Index name" defaultValue={basket.name} onClick={(event) => event.stopPropagation()} onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== basket.name) void patch({ name }); }}/>
      <select aria-label="Weighting method" value={basket.weightingMethod} onClick={(event) => event.stopPropagation()} onChange={(event) => void patch({ weightingMethod: event.target.value as WeightingMethod })}>
        <option value="equal">Equal weight</option><option value="market_cap">Market-cap</option>
      </select>
    </div>
    <div className="ticker-list">{basket.constituents.map((member) => <span className={`ticker-chip ${member.status}`} key={member.id} title={member.pendingReason === "market_cap" ? "Waiting for market-cap history" : member.pendingReason === "price" ? "Waiting for price history" : "Ready"}>
      {member.ticker}{member.status === "pending" && <small>Pending</small>}<button type="button" aria-label={`Remove ${member.ticker}`} onClick={(event) => { event.stopPropagation(); void remove(member.id); }}><X size={12}/></button>
    </span>)}</div>
    <form className="add-ticker" onSubmit={add} onClick={(event) => event.stopPropagation()}><input aria-label={`Add ticker to ${basket.name}`} value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} placeholder="Add ticker"/><button>Add</button></form>
    <div className="basket-meta">Monthly rebalance · {ready} active{pending ? ` · ${pending} pending` : ""}</div>
    {message && <div className="card-message">{message}</div>}
  </article>;
}

export function BasketWorkspace({ initialData }: { initialData: WorkspaceData }) {
  const router = useRouter();
  const [baskets, setBaskets] = useState(initialData.baskets);
  const [series, setSeries] = useState(initialData.series);
  const [query, setQuery] = useState("");
  const [primaryId, setPrimaryId] = useState(initialData.baskets[0]?.id ?? "");
  const [secondaryId, setSecondaryId] = useState(initialData.baskets[1]?.id ?? initialData.baskets[0]?.id ?? "");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [comparison, setComparison] = useState(false);
  const [view, setView] = useState<ComparisonView>("overlay");
  const [rebaseDate, setRebaseDate] = useState<string | undefined>();

  useEffect(() => { setBaskets(initialData.baskets); setSeries(initialData.series); }, [initialData]);
  const primary = baskets.find((basket) => basket.id === primaryId) ?? baskets[0];
  const secondary = baskets.find((basket) => basket.id === secondaryId) ?? baskets.find((basket) => basket.id !== primary?.id) ?? baskets[0];
  useEffect(() => { if (primary && secondary?.id === primary.id) setSecondaryId(baskets.find((basket) => basket.id !== primary.id)?.id ?? primary.id); }, [primary, secondary, baskets]);

  const rawA = sampleSeries(series[primary?.id] ?? [], frequency);
  const rawB = sampleSeries(series[secondary?.id] ?? [], frequency);
  const dates = comparison && primary && secondary ? commonDates(rawA, rawB) : [];
  useEffect(() => { if (comparison && view === "overlay" && dates.length && (!rebaseDate || !dates.includes(rebaseDate))) setRebaseDate(dates[0]); }, [comparison, view, primaryId, secondaryId, frequency, dates, rebaseDate]);

  const chart = useMemo(() => {
    if (!primary) return [];
    if (!comparison || !secondary) return [{ name: primary.name, points: rawA, color: COLORS[0] }];
    if (view === "ratio") return [{ name: `${primary.name} / ${secondary.name}`, points: ratioSeries(rawA, rawB), color: COLORS[0] }];
    const common = new Set(dates); const date = rebaseDate ?? dates[0];
    return [
      { name: primary.name, points: rebaseSeries(rawA.filter((point) => common.has(point.date)), date), color: COLORS[0] },
      { name: secondary.name, points: rebaseSeries(rawB.filter((point) => common.has(point.date)), date), color: COLORS[1] },
    ];
  }, [primary, secondary, comparison, view, rawA, rawB, dates, rebaseDate]);

  function localChange(next: Basket) {
    setBaskets((current) => current.map((basket) => basket.id === next.id ? next : basket));
    setSeries((current) => ({ ...current, [next.id]: demoSeriesForBasket(next) }));
  }

  async function createBasket() {
    if (!initialData.persistent) {
      const id = crypto.randomUUID();
      const next: Basket = { id, name: "New Basket", weightingMethod: "equal", rebalanceFrequency: "monthly", inceptionDate: "2025-10-01", revision: 1, constituents: [] };
      setBaskets((current) => [next, ...current]); setSeries((current) => ({ ...current, [id]: [] })); setPrimaryId(id); return;
    }
    const response = await fetch("/api/baskets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "New Basket", weightingMethod: "equal" }) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) { setPrimaryId(body.id); router.refresh(); }
  }

  const filtered = baskets.filter((basket) => basket.name.toLowerCase().includes(query.toLowerCase()) || basket.constituents.some((member) => member.ticker.includes(query.toUpperCase())));
  const pending = primary?.constituents.filter((member) => member.status === "pending") ?? [];
  const first = chart[0]?.points[0], last = chart[0]?.points.at(-1);
  const usesSelectedRebase = comparison && view === "overlay";
  const change = usesSelectedRebase && last ? last.value - 100 : first && last ? (last.value / first.value - 1) * 100 : null;

  return <main className="app-shell">
    <header className="app-header"><div><p className="eyebrow">PORTFOLIO / CUSTOM INDICES</p><h1>Basket Index Tracker</h1></div><div className="as-of"><span/>Prices as of {initialData.priceAsOf ? fmtDate(initialData.priceAsOf) : "unavailable"}{!initialData.persistent && " · Demo"}</div></header>
    <div className="workspace">
      <aside className="library-panel">
        <div className="library-actions"><label><Search size={15}/><input aria-label="Search baskets" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search baskets..."/></label><button type="button" onClick={() => void createBasket()}><Plus size={14}/>New</button></div>
        <div className="library-label"><span>INDEX LIBRARY</span><span>{filtered.length} shown</span></div>
        <div className="basket-list">{filtered.map((basket) => <BasketCard key={basket.id} basket={basket} selected={basket.id === primary?.id} persistent={initialData.persistent} onSelect={() => setPrimaryId(basket.id)} onLocalChange={localChange}/>)}</div>
        <p className="library-help">Click a card to display it. New unsupported tickers remain Pending until the shared price pipeline loads them.</p>
      </aside>
      <section className="chart-column">
        <div className="control-panel">
          <div><span className="control-label">Selected index</span><h2>{primary?.name ?? "No baskets"}</h2></div>
          <div className="top-controls"><select aria-label="Frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}><option value="daily">Daily</option><option value="weekly">Weekly</option></select><button type="button" className={comparison ? "active" : ""} onClick={() => setComparison((value) => !value)}><GitCompareArrows size={14}/>{comparison ? "Stop comparison" : "Compare 2 indices"}</button></div>
          {comparison && <div className="compare-controls"><label><span>Second index</span><select value={secondary?.id} onChange={(event) => setSecondaryId(event.target.value)}>{baskets.filter((basket) => basket.id !== primary?.id).map((basket) => <option key={basket.id} value={basket.id}>{basket.name}</option>)}</select></label><label><span>View</span><select value={view} onChange={(event) => setView(event.target.value as ComparisonView)}><option value="overlay">Both indices</option><option value="ratio">Ratio</option></select></label></div>}
        </div>
        <div className="chart-panel">
          <div className="chart-head"><div><h3>{comparison && secondary ? view === "ratio" ? `${primary?.name} / ${secondary.name}` : `${primary?.name} vs ${secondary.name}` : primary?.name}</h3><p>{comparison && view === "overlay" ? "Both histories rebased to 100 at the vertical marker" : view === "ratio" && comparison ? "Relative performance ratio, rebased to 100" : "Historical custom index, base level 100"}</p></div><div className="latest-value"><strong>{last?.value.toFixed(2) ?? "—"}</strong><span>{change === null ? "No history" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% ${usesSelectedRebase ? "since rebase" : "over displayed period"}`}</span></div></div>
          {comparison && view === "overlay" && dates.length > 0 && <div className="rebase-control"><CalendarRange size={15}/><span>Rebase date</span><input aria-label="Rebase date" type="range" min="0" max={dates.length - 1} value={Math.max(0, dates.indexOf(rebaseDate ?? dates[0]))} onChange={(event) => setRebaseDate(dates[Number(event.target.value)])}/><strong>{fmtDate(rebaseDate ?? dates[0])}</strong><small>Click or drag the vertical line on the chart; use arrow keys for one period at a time.</small></div>}
          {pending.length > 0 && <div className="pending-notice">{pending.map((member) => member.ticker).join(", ")} pending {pending.some((member) => member.pendingReason === "market_cap") ? "price or market-cap" : "price"} history; excluded until ready.</div>}
          <InteractiveChart datasets={chart} rebaseDate={comparison && view === "overlay" ? rebaseDate : undefined} selectableDates={comparison && view === "overlay" ? dates : undefined} onSelectDate={comparison && view === "overlay" ? setRebaseDate : undefined}/>
          <div className="legend">{chart.map((dataset) => <span key={dataset.name}><i style={{ background: dataset.color }}/>{dataset.name}</span>)}</div>
        </div>
        <div className="method-panel"><span className="control-label">Methodology</span><p>{primary ? `${primary.weightingMethod === "equal" ? "Equal-weighted" : "Market-cap weighted"} · monthly index-style rebalancing · adjusted-close returns · ${primary.constituents.filter((member) => member.status === "ready").length} active constituents${pending.length ? ` · ${pending.length} pending` : ""}.` : "Create a basket to begin."}</p></div>
      </section>
    </div>
  </main>;
}
