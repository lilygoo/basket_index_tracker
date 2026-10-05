# Basket Index Tracker

Private two-pane workspace for building theme baskets and tracking equal-weighted or market-cap-weighted custom indices. It is designed to share the existing Portfolio Risk Lens Supabase market-data tables while remaining independently deployable.

## What it does

- Search basket names, apply multiple exact-ticker filters, and edit compact basket cards.
- Create baskets through a validated dialog, keep one active ticker minimum, and soft-delete baskets with immutable audit history.
- Keep unsupported constituents visible as `Pending` and submit them through the existing ticker-support queue.
- Calculate both equal-weight and market-cap one-year histories dynamically with monthly index-style rebalancing; display each basket's preferred method.
- Show daily or weekly history, compare two indices, or chart their rebased ratio.
- In the two-index overlay, click or drag the vertical marker—or use its slider/arrow keys—to choose the common date where both histories are rebased to 100.
- Enrich `daily_prices` with historical shares outstanding from yfinance and derive daily market capitalization.

## Local UI

The app runs with deterministic demo data when Supabase is not configured.

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`. Run `npm test`, `npm run typecheck`, and `npm run build` before deployment.

## Shared Supabase setup

1. Review and apply the migrations in order in the existing Supabase project:
   - `202610030001_basket_index_tracker.sql` creates the initial basket model and daily market-cap columns.
   - `202610040002_basket_audit_and_market_data.sql` adds controlled creation/deletion, unique names, immutable events, current universe snapshots, and frozen daily market-cap updates. It also removes the three confirmed empty accidental `New Basket` rows.
   - `202610040003_queue_unsupported_basket_tickers.sql` atomically queues unsupported basket constituents through the shared Risk Lens support RPC.
2. Copy the server-only Supabase values into an ignored `.env.local`; never expose the secret with a `NEXT_PUBLIC_` prefix.
3. Configure two independent layers of access control:
   - Enable Vercel Authentication for every URL that serves the app. On Vercel Hobby, Standard Protection does not protect a production custom domain, so use a protected deployment URL or a plan/scope that protects production.
   - Set a strong shared `BASKET_ACCESS_PASSWORD` and a separate random `BASKET_SESSION_SECRET`. All reads and writes require the resulting HTTP-only application session.

```dotenv
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
BASKET_ACCESS_PASSWORD=...
BASKET_SESSION_SECRET=...
```

The browser never talks to Supabase. Authenticated Next.js handlers use the service-role key, and the database mutation functions reject non-service-role callers.

Ticker support is determined by `security_universe`, not by the presence of an old price row. Creating a basket or adding a constituent calls the shared `request_shared_ticker_support` RPC inside the same database transaction whenever the ticker is not both active and supported. Requested tickers stay Pending until the shared refresh promotes them.

## Market-cap enrichment

Install the Python environment and run the enrichment after the existing Risk Lens price refresh:

```bash
uv sync
uv run pytest -q
uv run basket-index-tracker refresh-market-caps
```

The first job run backfills missing history from sparse `yfinance` share counts. Leading dates without a prior observation use the earliest/current available count as an explicit bootstrap proxy. Populated historical rows are then frozen: later runs fill only new or missing rows, refresh the current snapshot in `security_universe`, and carry the last stored shares when the provider is temporarily unavailable. Market cap always uses raw close. `.github/workflows/market-cap-refresh.yml` schedules the job at 9:20 p.m. America/New_York on weekdays and supports manual dispatch.

Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as GitHub Actions secrets before enabling the workflow.

## Index methodology

- The initial basket roster is backtested from the earliest retained shared price date; later membership edits are effective from their New York calendar date and do not rewrite earlier membership.
- Adjusted closes drive constituent returns. Raw close multiplied by the latest historically known shares outstanding supplies rebalance-date market capitalization.
- Rebalances occur on the first available trading observation of each month and whenever membership or data eligibility changes. Index level continuity is preserved.
- Equal-weight history can use every priced constituent. Market-cap history is published only when every active priced constituent has valid market-cap input; missing inputs are identified in the UI.
- Weekly values are the last available daily index level in each ISO week.
- Comparison overlays use common dates. The selected vertical marker is the 100 base for both series; the ratio view is `(Index A / Index B)` rebased to 100.
