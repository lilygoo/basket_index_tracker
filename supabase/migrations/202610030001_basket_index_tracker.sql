create extension if not exists pgcrypto;

alter table public.daily_prices
  add column if not exists shares_outstanding numeric(24, 0) check (shares_outstanding > 0),
  add column if not exists market_cap numeric(30, 2) check (market_cap > 0);

create table if not exists public.baskets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  weighting_method text not null check (weighting_method in ('equal', 'market_cap')),
  rebalance_frequency text not null default 'monthly' check (rebalance_frequency = 'monthly'),
  inception_date date not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.basket_constituents (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.baskets(id) on delete cascade,
  ticker text not null check (ticker = upper(trim(ticker)) and ticker ~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$'),
  active_from date not null,
  active_to date check (active_to is null or active_to > active_from),
  created_at timestamptz not null default now(),
  unique (basket_id, ticker, active_from)
);

create unique index if not exists basket_constituents_one_active on public.basket_constituents (basket_id, ticker) where active_to is null;
create index if not exists basket_constituents_basket_dates on public.basket_constituents (basket_id, active_from, active_to);
alter table public.baskets enable row level security;
alter table public.basket_constituents enable row level security;
revoke all on table public.baskets, public.basket_constituents from public, anon, authenticated;
grant select, insert, update, delete on table public.baskets, public.basket_constituents to service_role;

create or replace function public.touch_basket_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists baskets_touch_updated_at on public.baskets;
create trigger baskets_touch_updated_at before update on public.baskets for each row execute function public.touch_basket_updated_at();

create or replace function public.update_basket_details(p_basket_id uuid, p_expected_revision integer, p_name text, p_weighting_method text)
returns public.baskets language plpgsql security definer set search_path = public as $$
declare v_basket public.baskets;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 80 then raise exception 'invalid basket name'; end if;
  if p_weighting_method not in ('equal', 'market_cap') then raise exception 'invalid weighting method'; end if;
  update public.baskets set name = trim(p_name), weighting_method = p_weighting_method, revision = revision + 1
  where id = p_basket_id and revision = p_expected_revision returning * into v_basket;
  if v_basket.id is null then raise exception 'basket changed; refresh and retry' using errcode = '40001'; end if;
  return v_basket;
end;
$$;

create or replace function public.add_basket_constituent(p_basket_id uuid, p_expected_revision integer, p_ticker text, p_effective_date date)
returns public.basket_constituents language plpgsql security definer set search_path = public as $$
declare v_ticker text := upper(trim(p_ticker)); v_member public.basket_constituents;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if v_ticker !~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$' then raise exception 'invalid ticker'; end if;
  perform 1 from public.baskets where id = p_basket_id and revision = p_expected_revision for update;
  if not found then raise exception 'basket changed; refresh and retry' using errcode = '40001'; end if;
  if exists (select 1 from public.basket_constituents where basket_id = p_basket_id and ticker = v_ticker and active_to is null) then raise exception 'ticker already active'; end if;
  insert into public.basket_constituents (basket_id, ticker, active_from) values (p_basket_id, v_ticker, p_effective_date) returning * into v_member;
  update public.baskets set revision = revision + 1 where id = p_basket_id;
  return v_member;
end;
$$;

create or replace function public.remove_basket_constituent(p_basket_id uuid, p_member_id uuid, p_expected_revision integer, p_effective_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform 1 from public.baskets where id = p_basket_id and revision = p_expected_revision for update;
  if not found then raise exception 'basket changed; refresh and retry' using errcode = '40001'; end if;
  update public.basket_constituents set active_to = greatest(p_effective_date, active_from + 1)
  where id = p_member_id and basket_id = p_basket_id and active_to is null;
  if not found then raise exception 'active constituent not found'; end if;
  update public.baskets set revision = revision + 1 where id = p_basket_id;
end;
$$;

create or replace function public.update_daily_price_market_caps(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(ticker text, price_date date, shares_outstanding numeric, market_cap numeric)
    where x.shares_outstanding <= 0 or x.market_cap <= 0) then raise exception 'shares and market cap must be positive'; end if;
  update public.daily_prices prices set shares_outstanding = updates.shares_outstanding, market_cap = updates.market_cap
  from jsonb_to_recordset(p_rows) as updates(ticker text, price_date date, shares_outstanding numeric, market_cap numeric)
  where prices.ticker = upper(trim(updates.ticker)) and prices.price_date = updates.price_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.update_basket_details(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.add_basket_constituent(uuid, integer, text, date) from public, anon, authenticated;
revoke all on function public.remove_basket_constituent(uuid, uuid, integer, date) from public, anon, authenticated;
revoke all on function public.update_daily_price_market_caps(jsonb) from public, anon, authenticated;
grant execute on function public.update_basket_details(uuid, integer, text, text) to service_role;
grant execute on function public.add_basket_constituent(uuid, integer, text, date) to service_role;
grant execute on function public.remove_basket_constituent(uuid, uuid, integer, date) to service_role;
grant execute on function public.update_daily_price_market_caps(jsonb) to service_role;

with seed(id, name, weighting_method) as (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'AI Losers', 'equal'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'AI Infrastructure', 'market_cap'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'Legacy Software', 'equal'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'Consumer Compounders', 'market_cap')
), horizon as (select coalesce(min(price_date), current_date - 365) as inception_date from public.daily_prices)
insert into public.baskets (id, name, weighting_method, inception_date)
select seed.id, seed.name, seed.weighting_method, horizon.inception_date from seed cross join horizon on conflict (id) do nothing;

with members(basket_id, ticker) as (values
  ('11111111-1111-4111-8111-111111111111'::uuid,'INTU'),('11111111-1111-4111-8111-111111111111'::uuid,'FIG'),('11111111-1111-4111-8111-111111111111'::uuid,'HUBS'),('11111111-1111-4111-8111-111111111111'::uuid,'ADBE'),('11111111-1111-4111-8111-111111111111'::uuid,'MNDY'),
  ('22222222-2222-4222-8222-222222222222'::uuid,'NVDA'),('22222222-2222-4222-8222-222222222222'::uuid,'AVGO'),('22222222-2222-4222-8222-222222222222'::uuid,'AMD'),('22222222-2222-4222-8222-222222222222'::uuid,'ANET'),('22222222-2222-4222-8222-222222222222'::uuid,'VRT'),
  ('33333333-3333-4333-8333-333333333333'::uuid,'ORCL'),('33333333-3333-4333-8333-333333333333'::uuid,'IBM'),('33333333-3333-4333-8333-333333333333'::uuid,'SAP'),('33333333-3333-4333-8333-333333333333'::uuid,'CSCO'),
  ('44444444-4444-4444-8444-444444444444'::uuid,'COST'),('44444444-4444-4444-8444-444444444444'::uuid,'WMT'),('44444444-4444-4444-8444-444444444444'::uuid,'MCD'),('44444444-4444-4444-8444-444444444444'::uuid,'TJX'),('44444444-4444-4444-8444-444444444444'::uuid,'LOW')
)
insert into public.basket_constituents (basket_id, ticker, active_from)
select members.basket_id, members.ticker, baskets.inception_date from members join public.baskets on baskets.id = members.basket_id
on conflict (basket_id, ticker, active_from) do nothing;

insert into public.ticker_support_requests (owner_id, ticker, status)
select owner.owner_id, requested.ticker, 'requested'
from (select owner_id from public.portfolios order by created_at limit 1) owner
cross join (values ('INTU'),('FIG'),('HUBS'),('ADBE'),('MNDY'),('NVDA'),('AVGO'),('AMD'),('ANET'),('VRT'),('ORCL'),('IBM'),('SAP'),('CSCO'),('COST'),('WMT'),('MCD'),('TJX'),('LOW')) requested(ticker)
where (select count(*) from public.portfolios) = 1 and not exists (select 1 from public.daily_prices where daily_prices.ticker = requested.ticker)
on conflict (owner_id, ticker) do nothing;
