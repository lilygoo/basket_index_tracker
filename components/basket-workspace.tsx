"use client";

import { FormEvent, PointerEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Check, Filter, GitCompareArrows, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { canRemoveConstituent, filterAndOrderBaskets, newBasketValues, parseTickerList, TICKER_PATTERN } from "@/lib/basket-rules";
import { chartAxis, commonDates, ratioSeries, rebaseSeries, sampleSeries } from "@/lib/index-engine";
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
  const { lo, hi, ticks } = chartAxis(values);
  const x = (index: number) => L + index * (W - L - R) / Math.max(dates.length - 1, 1);
  const y = (value: number) => T + (hi - value) * (H - T - B) / Math.max(hi - lo, 1);
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
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={onSelectDate ? "Index history chart. Click or drag to choose the vertical rebase date." : "Basket index history chart"}
      tabIndex={onSelectDate ? 0 : undefined} className={onSelectDate ? "chart selectable" : "chart"}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pick(event); }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event); }}
      onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); moveSelection(-1); } if (event.key === "ArrowRight") { event.preventDefault(); moveSelection(1); } }}>
      {ticks.map((value) => <g key={value}>
        <line x1={L} x2={W - R} y1={y(value)} y2={y(value)} className={value === 100 ? "chart-grid chart-base" : "chart-grid"}/>
        <text x={L - 9} y={y(value) + 4} textAnchor="end" className={value === 100 ? "chart-label chart-base-label" : "chart-label"}>{value}</text>
      </g>)}
      {datasets.map((dataset) => <path key={dataset.name} d={dataset.points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ")} fill="none" stroke={dataset.color} strokeWidth="2.8" vectorEffect="non-scaling-stroke"/>) }
      {selectedIndex >= 0 && <g><line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={T} y2={H - B} className="rebase-line"/><circle cx={x(selectedIndex)} cy={y(100)} r="5" className="rebase-dot"/><text x={x(selectedIndex)} y={T + 13} textAnchor={selectedIndex > dates.length * .75 ? "end" : "start"} dx={selectedIndex > dates.length * .75 ? -7 : 7} className="rebase-label">Rebase · {fmtDate(dates[selectedIndex])}</text></g>}
      <text x={L} y={H - 12} className="chart-label">{fmtDate(dates[0])}</text><text x={W - R} y={H - 12} textAnchor="end" className="chart-label">{fmtDate(dates.at(-1)!)}</text>
    </svg>
  </div>;
}

function BasketCard({ basket, selected, editing, persistent, onSelect, onEdit, onDelete, onLocalChange }: {
  basket: Basket;
  selected: boolean;
  editing: boolean;
  persistent: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLocalChange: (basket: Basket) => void;
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
    if (!TICKER_PATTERN.test(symbol)) { setMessage("Enter a valid ticker."); return; }
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
    if (!canRemoveConstituent(basket)) { setMessage("A basket must retain one ticker. Delete the basket instead."); return; }
    if (!persistent) { onLocalChange({ ...basket, revision: basket.revision + 1, constituents: basket.constituents.filter((member) => member.id !== memberId) }); return; }
    const response = await fetch(`/api/baskets/${basket.id}/members/${memberId}?revision=${basket.revision}`, { method: "DELETE" });
    if (!response.ok) setMessage((await response.json().catch(() => ({}))).error ?? "Ticker could not be removed.");
    else router.refresh();
  }

  const ready = basket.constituents.filter((member) => member.status === "ready").length;
  const pending = basket.constituents.length - ready;
  return <article className={`basket-card ${selected ? "selected" : ""} ${editing ? "editing" : ""}`} onClick={onSelect}>
    <div className="basket-card-head">
      {editing ? <>
        <input aria-label="Index name" defaultValue={basket.name} onClick={(event) => event.stopPropagation()} onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== basket.name) void patch({ name }); }}/>
        <select aria-label="Preferred weighting method" value={basket.weightingMethod} onClick={(event) => event.stopPropagation()} onChange={(event) => void patch({ weightingMethod: event.target.value as WeightingMethod })}>
          <option value="equal">Equal weight</option><option value="market_cap">Market-cap</option>
        </select>
      </> : <><h3>{basket.name}</h3><span className="weight-label">{basket.weightingMethod === "equal" ? "Equal weight" : "Market-cap"}</span></>}
      <button type="button" className="edit-card" onClick={(event) => { event.stopPropagation(); onEdit(); }}>{editing ? <Check size={13}/> : <Pencil size={12}/>} {editing ? "Done" : "Edit"}</button>
    </div>
    <div className="ticker-list">{basket.constituents.map((member) => <span className={`ticker-chip ${member.status}`} key={member.id} title={member.pendingReason === "support" ? "Waiting for shared-universe refresh" : member.pendingReason === "market_cap" ? "Waiting for market-cap history" : member.pendingReason === "price" ? "Waiting for price history" : "Ready"}>
      {member.ticker}{member.status === "pending" && <small>Pending</small>}{editing && <button type="button" aria-label={`Remove ${member.ticker}`} onClick={(event) => { event.stopPropagation(); void remove(member.id); }}><X size={12}/></button>}
    </span>)}</div>
    {editing && <form className="add-ticker" onSubmit={add} onClick={(event) => event.stopPropagation()}><input aria-label={`Add ticker to ${basket.name}`} value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} placeholder="Add ticker"/><button>Add</button></form>}
    <div className="basket-footer"><span className="basket-meta">Monthly rebalance · {ready} active{pending ? ` · ${pending} pending` : ""}</span>{editing && <button type="button" className="delete-card" onClick={(event) => { event.stopPropagation(); onDelete(); }}><Trash2 size={12}/>Delete</button>}</div>
    {message && <div className="card-message">{message}</div>}
  </article>;
}

function NewBasketDialog({ existingNames, onClose, onCreate }: {
  existingNames: string[];
  onClose: () => void;
  onCreate: (values: { name: string; tickers: string[]; weightingMethod: WeightingMethod }) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [tickerText, setTickerText] = useState("");
  const [weightingMethod, setWeightingMethod] = useState<WeightingMethod>("equal");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validated = newBasketValues(name, tickerText, weightingMethod, existingNames);
    if (validated.error || !validated.weightingMethod) { setError(validated.error ?? "Invalid basket."); return; }
    setSaving(true);
    const failure = await onCreate({ name: validated.name, tickers: validated.tickers, weightingMethod: validated.weightingMethod });
    setSaving(false);
    if (failure) setError(failure);
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <form className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-basket-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><span className="control-label">New index</span><h2 id="new-basket-title">Create a basket</h2></div><button type="button" aria-label="Close" onClick={onClose}><X size={17}/></button></div>
      <label><span>Basket name</span><input autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="e.g. Cloud Software"/></label>
      <label><span>Initial tickers</span><input value={tickerText} onChange={(event) => setTickerText(event.target.value)} placeholder="CRM, NOW, WDAY"/><small>Use commas or spaces. The initial roster receives the full available backtest.</small></label>
      <label><span>Preferred weighting</span><select value={weightingMethod} onChange={(event) => setWeightingMethod(event.target.value as WeightingMethod)}><option value="equal">Equal weight</option><option value="market_cap">Market-cap</option></select></label>
      {error && <div className="modal-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={saving}>{saving ? "Creating…" : "Create basket"}</button></div>
    </form>
  </div>;
}

export function BasketWorkspace({ initialData }: { initialData: WorkspaceData }) {
  const router = useRouter();
  const [baskets, setBaskets] = useState(initialData.baskets);
  const [series, setSeries] = useState(initialData.series);
  const [query, setQuery] = useState("");
  const [tickerInput, setTickerInput] = useState("");
  const [tickerFilters, setTickerFilters] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState(initialData.baskets[0]?.id ?? "");
  const [secondaryId, setSecondaryId] = useState(initialData.baskets[1]?.id ?? initialData.baskets[0]?.id ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Basket | null>(null);
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [comparison, setComparison] = useState(false);
  const [view, setView] = useState<ComparisonView>("overlay");
  const [rebaseDate, setRebaseDate] = useState<string | undefined>();

  useEffect(() => { setBaskets(initialData.baskets); setSeries(initialData.series); }, [initialData]);
  const ordered = useMemo(() => filterAndOrderBaskets(baskets, query, tickerFilters, primaryId), [baskets, query, tickerFilters, primaryId]);
  useEffect(() => { if (ordered.length && !ordered.some((basket) => basket.id === primaryId)) setPrimaryId(ordered[0].id); }, [ordered, primaryId]);

  const primary = baskets.find((basket) => basket.id === primaryId) ?? baskets[0];
  const secondary = baskets.find((basket) => basket.id === secondaryId) ?? baskets.find((basket) => basket.id !== primary?.id) ?? baskets[0];
  useEffect(() => { if (primary && secondary?.id === primary.id) setSecondaryId(baskets.find((basket) => basket.id !== primary.id)?.id ?? primary.id); }, [primary, secondary, baskets]);

  const primarySeries = primary ? series[primary.id] : undefined;
  const secondarySeries = secondary ? series[secondary.id] : undefined;
  const rawA = sampleSeries(primary?.weightingMethod === "market_cap" ? primarySeries?.marketCap ?? [] : primarySeries?.equal ?? [], frequency);
  const rawB = sampleSeries(secondary?.weightingMethod === "market_cap" ? secondarySeries?.marketCap ?? [] : secondarySeries?.equal ?? [], frequency);
  const comparisonDates = useMemo(() => comparison && primary && secondary ? commonDates(rawA, rawB) : [], [comparison, primary, secondary, rawA, rawB]);
  const rebaseDates = useMemo(() => !comparison ? rawA.map((point) => point.date) : view === "overlay" ? comparisonDates : [], [comparison, view, rawA, comparisonDates]);
  useEffect(() => { if (rebaseDates.length && (!rebaseDate || !rebaseDates.includes(rebaseDate))) setRebaseDate(rebaseDates[0]); }, [primaryId, secondaryId, frequency, rebaseDates, rebaseDate]);

  const chart = useMemo(() => {
    if (!primary) return [];
    if (!comparison || !secondary) {
      const date = rebaseDate ?? rebaseDates[0];
      return [{ name: primary.name, points: date ? rebaseSeries(rawA, date) : rawA, color: COLORS[0] }];
    }
    if (view === "ratio") return [{ name: `${primary.name} / ${secondary.name}`, points: ratioSeries(rawA, rawB), color: COLORS[0] }];
    const common = new Set(comparisonDates); const date = rebaseDate ?? comparisonDates[0];
    return [
      { name: primary.name, points: rebaseSeries(rawA.filter((point) => common.has(point.date)), date), color: COLORS[0] },
      { name: secondary.name, points: rebaseSeries(rawB.filter((point) => common.has(point.date)), date), color: COLORS[1] },
    ];
  }, [primary, secondary, comparison, view, rawA, rawB, comparisonDates, rebaseDates, rebaseDate]);

  function localChange(next: Basket) {
    setBaskets((current) => current.map((basket) => basket.id === next.id ? next : basket));
    setSeries((current) => ({ ...current, [next.id]: demoSeriesForBasket(next) }));
  }

  async function createBasket(values: { name: string; tickers: string[]; weightingMethod: WeightingMethod }) {
    if (!initialData.persistent) {
      const id = crypto.randomUUID();
      const next: Basket = { id, name: values.name, weightingMethod: values.weightingMethod, rebalanceFrequency: "monthly", inceptionDate: "2025-10-01", revision: 1, constituents: values.tickers.map((ticker) => ({ id: crypto.randomUUID(), ticker, activeFrom: "2025-10-01", activeTo: null, status: "ready" as const, pendingReason: null })) };
      setBaskets((current) => [next, ...current]); setSeries((current) => ({ ...current, [id]: demoSeriesForBasket(next) })); setPrimaryId(id); setNewOpen(false); return null;
    }
    const response = await fetch("/api/baskets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return body.error ?? "Basket could not be created.";
    setPrimaryId(body.id); setNewOpen(false); router.refresh(); return null;
  }

  async function deleteBasket(basket: Basket) {
    if (!initialData.persistent) {
      const remaining = baskets.filter((item) => item.id !== basket.id);
      setBaskets(remaining); setSeries((current) => { const next = { ...current }; delete next[basket.id]; return next; });
      setPrimaryId(remaining[0]?.id ?? ""); setDeleteTarget(null); setEditingId(null); return;
    }
    const response = await fetch(`/api/baskets/${basket.id}?revision=${basket.revision}`, { method: "DELETE" });
    if (!response.ok) { window.alert((await response.json().catch(() => ({}))).error ?? "Basket could not be deleted."); return; }
    setPrimaryId(baskets.find((item) => item.id !== basket.id)?.id ?? ""); setDeleteTarget(null); setEditingId(null); router.refresh();
  }

  function addTickerFilters(event: FormEvent) {
    event.preventDefault();
    const candidates = parseTickerList(tickerInput).filter((value) => TICKER_PATTERN.test(value));
    setTickerFilters((current) => [...new Set([...current, ...candidates])]); setTickerInput("");
  }

  const pending = primary?.constituents.filter((member) => member.status === "pending") ?? [];
  const capMissing = primarySeries?.marketCapMissing ?? [];
  const first = chart[0]?.points[0], last = chart[0]?.points.at(-1);
  const usesSelectedRebase = rebaseDates.length > 0;
  const change = usesSelectedRebase && last ? last.value - 100 : first && last ? (last.value / first.value - 1) * 100 : null;

  return <main className="app-shell">
    <header className="app-header"><div><p className="eyebrow">PORTFOLIO / CUSTOM INDICES</p><h1>Basket Index Tracker</h1></div><div className="as-of"><span/>Prices as of {initialData.priceAsOf ? fmtDate(initialData.priceAsOf) : "unavailable"}{!initialData.persistent && " · Demo"}</div></header>
    <div className="workspace">
      <aside className="library-panel">
        <div className="library-actions"><label><Search size={15}/><input aria-label="Search basket names" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names..."/></label><button type="button" onClick={() => setNewOpen(true)}><Plus size={14}/>New</button></div>
        <form className="ticker-filter" onSubmit={addTickerFilters}><label><Filter size={14}/><input aria-label="Filter by tickers" value={tickerInput} onChange={(event) => setTickerInput(event.target.value.toUpperCase())} placeholder="Filter tickers..."/></label><button>Add</button></form>
        {tickerFilters.length > 0 && <div className="filter-chips">{tickerFilters.map((ticker) => <span key={ticker}>{ticker}<button type="button" aria-label={`Remove ${ticker} filter`} onClick={() => setTickerFilters((current) => current.filter((value) => value !== ticker))}><X size={11}/></button></span>)}</div>}
        <div className="library-label"><span>INDEX LIBRARY</span><span>{ordered.length} shown</span></div>
        <div className="basket-list">{ordered.map((basket) => <BasketCard key={basket.id} basket={basket} selected={basket.id === primary?.id} editing={editingId === basket.id} persistent={initialData.persistent} onSelect={() => setPrimaryId(basket.id)} onEdit={() => { setPrimaryId(basket.id); setEditingId((current) => current === basket.id ? null : basket.id); }} onDelete={() => setDeleteTarget(basket)} onLocalChange={localChange}/>)}</div>
        {!ordered.length && <div className="library-empty">No baskets match these filters.</div>}
        <p className="library-help">Select a card to move it to the top. Ticker filters require every selected ticker.</p>
      </aside>
      <section className="chart-column">
        <div className="control-panel">
          <div><span className="control-label">Selected index</span><h2>{primary?.name ?? "No baskets"}</h2></div>
          <div className="top-controls"><select aria-label="Frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}><option value="daily">Daily</option><option value="weekly">Weekly</option></select><button type="button" className={comparison ? "active" : ""} onClick={() => setComparison((value) => !value)}><GitCompareArrows size={14}/>{comparison ? "Stop comparison" : "Compare 2 indices"}</button></div>
          {comparison && <div className="compare-controls"><label><span>Second index</span><select aria-label="Second index" value={secondary?.id} onChange={(event) => setSecondaryId(event.target.value)}>{baskets.filter((basket) => basket.id !== primary?.id).map((basket) => <option key={basket.id} value={basket.id}>{basket.name}</option>)}</select></label><label><span>View</span><select value={view} onChange={(event) => setView(event.target.value as ComparisonView)}><option value="overlay">Both indices</option><option value="ratio">Ratio</option></select></label></div>}
        </div>
        <div className="chart-panel">
          <div className="chart-head"><div><h3>{comparison && secondary ? view === "ratio" ? `${primary?.name} / ${secondary.name}` : `${primary?.name} vs ${secondary.name}` : primary?.name}</h3><p>{comparison && view === "overlay" ? "Both histories rebased to 100 at the vertical marker" : view === "ratio" && comparison ? "Relative performance ratio, rebased to 100" : `Historical ${primary?.weightingMethod === "market_cap" ? "market-cap" : "equal-weight"} index rebased to 100 at the vertical marker`}</p></div><div className="latest-value"><strong>{last?.value.toFixed(2) ?? "—"}</strong><span>{change === null ? "No history" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% ${usesSelectedRebase ? "since rebase" : "over displayed period"}`}</span></div></div>
          {rebaseDates.length > 0 && <div className="rebase-control"><CalendarRange size={15}/><span>Rebase date</span><input aria-label="Rebase date" type="range" min="0" max={rebaseDates.length - 1} value={Math.max(0, rebaseDates.indexOf(rebaseDate ?? rebaseDates[0]))} onChange={(event) => setRebaseDate(rebaseDates[Number(event.target.value)])}/><strong>{fmtDate(rebaseDate ?? rebaseDates[0])}</strong><small>Click or drag the vertical line on the chart; use arrow keys for one period at a time.</small></div>}
          {pending.length > 0 && <div className="pending-notice">{pending.map((member) => member.ticker).join(", ")} pending {pending.some((member) => member.pendingReason === "support") ? "shared-universe refresh" : pending.some((member) => member.pendingReason === "market_cap") ? "price or market-cap history" : "price history"}; excluded until ready.</div>}
          {primary?.weightingMethod === "market_cap" && capMissing.length > 0 && <div className="pending-notice">Market-cap history is waiting for complete inputs for {capMissing.join(", ")}.</div>}
          <InteractiveChart datasets={chart} rebaseDate={rebaseDates.length ? rebaseDate : undefined} selectableDates={rebaseDates.length ? rebaseDates : undefined} onSelectDate={rebaseDates.length ? setRebaseDate : undefined}/>
          <div className="legend">{chart.map((dataset) => <span key={dataset.name}><i style={{ background: dataset.color }}/>{dataset.name}</span>)}</div>
        </div>
        <div className="method-panel"><span className="control-label">Methodology</span><p>{primary ? `${primary.weightingMethod === "equal" ? "Equal-weighted" : "Market-cap weighted"} · monthly index-style rebalancing · adjusted-close returns · ${primary.constituents.filter((member) => member.status === "ready").length} active constituents${pending.length ? ` · ${pending.length} pending` : ""}. Both weighting methods are calculated dynamically; this basket displays its preferred method.` : "Create a basket to begin."}</p></div>
      </section>
    </div>
    {newOpen && <NewBasketDialog existingNames={baskets.map((basket) => basket.name)} onClose={() => setNewOpen(false)} onCreate={createBasket}/>}
    {deleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeleteTarget(null)}><div className="modal-panel confirm-panel" role="dialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="control-label">Delete index</span><h2 id="delete-title">Delete {deleteTarget.name}?</h2></div><button type="button" aria-label="Close" onClick={() => setDeleteTarget(null)}><X size={17}/></button></div><p>The basket will disappear from the library. Its membership and audit history will remain in the database.</p><div className="modal-actions"><button type="button" onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="danger" onClick={() => void deleteBasket(deleteTarget)}>Delete basket</button></div></div></div>}
  </main>;
}
