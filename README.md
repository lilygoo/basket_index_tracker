# Basket Index Tracker

Private two-pane workspace for building theme baskets and tracking equal-weighted or market-cap-weighted custom indices. It is designed to share the existing Portfolio Risk Lens Supabase market-data tables while remaining independently deployable.

## What it does

- Search, create, rename, and edit basket cards.
- Keep unsupported constituents visible as `Pending` and submit them through the existing ticker-support queue.
- Calculate one year of adjusted-close index history with monthly index-style rebalancing.
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

1. Review and apply `supabase/migrations/202610030001_basket_index_tracker.sql` in the existing Supabase project. The migration is idempotent, adds only `shares_outstanding` and `market_cap` to `daily_prices`, creates the basket tables/RPCs, and seeds the four prototype baskets.
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

## Market-cap enrichment

Install the Python environment and run the enrichment after the existing Risk Lens price refresh:

```bash
uv sync
uv run pytest -q
uv run basket-index-tracker refresh-market-caps
```

The job requests sparse historical share counts from `yfinance`, performs a backward-looking as-of join onto each daily raw close, and updates the two market-cap columns through a restricted bulk RPC. It never backward-fills a share count from a future report. `.github/workflows/market-cap-refresh.yml` schedules the same job at 9:20 p.m. America/New_York on weekdays and supports manual dispatch.

Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as GitHub Actions secrets before enabling the workflow.

## Index methodology

- The initial basket roster is backtested from the earliest retained shared price date; later membership edits are effective from their New York calendar date and do not rewrite earlier membership.
- Adjusted closes drive constituent returns. Raw close multiplied by the latest historically known shares outstanding supplies rebalance-date market capitalization.
- Rebalances occur on the first available trading observation of each month and whenever membership or data eligibility changes. Index level continuity is preserved.
- Missing price or required market-cap history keeps a constituent Pending and excluded until usable data arrives.
- Weekly values are the last available daily index level in each ISO week.
- Comparison overlays use common dates. The selected vertical marker is the 100 base for both series; the ratio view is `(Index A / Index B)` rebased to 100.
