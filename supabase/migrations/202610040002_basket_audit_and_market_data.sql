-- Basket lifecycle, immutable audit events, and frozen daily market-cap inputs.

-- Remove the three accidental empty placeholders created by the old one-click flow.
delete from public.baskets baskets
where baskets.id in (
    '26d5069b-e2f9-42af-9f42-30174b0a81e7'::uuid,
    'af8c9461-2386-4662-a9fd-c86e39d807bf'::uuid,
    'b59c8b5c-ec61-4017-bf31-10b19cd9d996'::uuid
  )
  and lower(trim(baskets.name)) = 'new basket'
  and not exists (
    select 1 from public.basket_constituents members where members.basket_id = baskets.id
  );

alter table public.baskets
  add column if not exists deleted_at timestamptz;

create unique index if not exists baskets_name_ci_unique
  on public.baskets (lower(trim(name)));

create table if not exists public.basket_events (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.baskets(id),
  event_type text not null check (event_type in (
    'basket_created', 'basket_deleted', 'basket_renamed', 'weighting_changed',
    'constituent_added', 'constituent_removed'
  )),
  ticker text check (ticker is null or (ticker = upper(trim(ticker)) and ticker ~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$')),
  effective_date date,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists basket_events_basket_time
  on public.basket_events (basket_id, occurred_at desc);

alter table public.basket_events enable row level security;
revoke all on table public.basket_events from public, anon, authenticated;
grant select, insert on table public.basket_events to service_role;

create or replace function public.reject_basket_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'basket events are immutable' using errcode = '55000';
end;
$$;

drop trigger if exists basket_events_immutable on public.basket_events;
create trigger basket_events_immutable
before update or delete on public.basket_events
for each row execute function public.reject_basket_event_mutation();

alter table public.security_universe
  add column if not exists current_shares_outstanding numeric(24, 0) check (current_shares_outstanding > 0),
  add column if not exists current_market_cap numeric(30, 2) check (current_market_cap > 0),
  add column if not exists market_data_as_of timestamptz,
  add column if not exists market_data_source text,
  add column if not exists market_data_stale boolean not null default false;

create or replace function public.create_basket_with_constituents(
  p_name text,
  p_weighting_method text,
  p_tickers text[],
  p_inception_date date
)
returns public.baskets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_basket public.baskets;
  v_tickers text[];
  v_ticker text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 80 then raise exception 'invalid basket name'; end if;
  if p_weighting_method not in ('equal', 'market_cap') then raise exception 'invalid weighting method'; end if;
  if p_inception_date is null then raise exception 'inception date required'; end if;

  select array_agg(distinct upper(trim(input.ticker)) order by upper(trim(input.ticker)))
    into v_tickers
  from unnest(coalesce(p_tickers, array[]::text[])) as input(ticker)
  where nullif(trim(input.ticker), '') is not null;

  if coalesce(cardinality(v_tickers), 0) = 0 then raise exception 'at least one ticker required'; end if;
  if exists (select 1 from unnest(v_tickers) as input(ticker) where input.ticker !~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$') then
    raise exception 'invalid ticker';
  end if;

  insert into public.baskets (name, weighting_method, inception_date)
  values (trim(p_name), p_weighting_method, p_inception_date)
  returning * into v_basket;

  insert into public.basket_events (basket_id, event_type, effective_date, after_state)
  values (
    v_basket.id,
    'basket_created',
    p_inception_date,
    jsonb_build_object('name', v_basket.name, 'weighting_method', v_basket.weighting_method, 'inception_date', p_inception_date, 'tickers', to_jsonb(v_tickers))
  );

  foreach v_ticker in array v_tickers loop
    insert into public.basket_constituents (basket_id, ticker, active_from)
    values (v_basket.id, v_ticker, p_inception_date);
    insert into public.basket_events (basket_id, event_type, ticker, effective_date, after_state)
    values (v_basket.id, 'constituent_added', v_ticker, p_inception_date, jsonb_build_object('ticker', v_ticker, 'active_from', p_inception_date));
  end loop;

  return v_basket;
end;
$$;

create or replace function public.update_basket_details(p_basket_id uuid, p_expected_revision integer, p_name text, p_weighting_method text)
returns public.baskets language plpgsql security definer set search_path = public as $$
declare v_before public.baskets; v_basket public.baskets;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 80 then raise exception 'invalid basket name'; end if;
  if p_weighting_method not in ('equal', 'market_cap') then raise exception 'invalid weighting method'; end if;
  select * into v_before from public.baskets
    where id = p_basket_id and revision = p_expected_revision and deleted_at is null for update;
  if v_before.id is null then raise exception 'basket changed; refresh and retry' using errcode = '40001'; end if;

  update public.baskets set name = trim(p_name), weighting_method = p_weighting_method, revision = revision + 1
    where id = p_basket_id returning * into v_basket;

  if v_before.name is distinct from v_basket.name then
    insert into public.basket_events (basket_id, event_type, before_state, after_state)
    values (p_basket_id, 'basket_renamed', jsonb_build_object('name', v_before.name), jsonb_build_object('name', v_basket.name));
  end if;
  if v_before.weighting_method is distinct from v_basket.weighting_method then
    insert into public.basket_events (basket_id, event_type, before_state, after_state)
    values (p_basket_id, 'weighting_changed', jsonb_build_object('weighting_method', v_before.weighting_method), jsonb_build_object('weighting_method', v_basket.weighting_method));
  end if;
  return v_basket;
end;
$$;

create or replace function public.add_basket_constituent(p_basket_id uuid, p_expected_revision integer, p_ticker text, p_effective_date date)
returns public.basket_constituents language plpgsql security definer set search_path = public as $$
declare v_ticker text := upper(trim(p_ticker)); v_member public.basket_constituents;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if v_ticker !~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$' then raise exception 'invalid ticker'; end if;
  perform 1 from public.baskets where id = p_basket_id and revision = p_expected_revision and deleted_at is null for update;
  if not found then raise exception 'basket changed; refresh and retry' using errcode = '40001'; end if;
  if exists (select 1 from public.basket_constituents where basket_id = p_basket_id and ticker = v_ticker and active_to is null) then raise exception 'ticker already active'; end if;
  insert into public.basket_constituents (basket_id, ticker, active_from) values (p_basket_id, v_ticker, p_effective_date) returning * into v_member;
  update public.baskets set revision = revision + 1 where id = p_basket_id;
  insert into public.basket_events (basket_id, event_type, ticker, effective_date, after_state)
  values (p_basket_id, 'constituent_added', v_ticker, p_effective_date, jsonb_build_object('ticker', v_ticker, 'active_from', p_effective_date));
  return v_member;
end;
$$;

create or replace function public.remove_basket_constituent(p_basket_id uuid, p_member_id uuid, p_expected_revision integer, p_effective_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_member public.basket_constituents; v_effective_date date;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform 1 from public.baskets where id = p_basket_id and revision = p_expected_revision and deleted_at is null for update;
  if not found then raise exception 'basket changed; refresh and retry' using errcode = '40001'; end if;
  if (select count(*) from public.basket_constituents where basket_id = p_basket_id and active_to is null) <= 1 then
    raise exception 'a basket must retain at least one ticker; delete the basket instead';
  end if;
  select * into v_member from public.basket_constituents
    where id = p_member_id and basket_id = p_basket_id and active_to is null for update;
  if v_member.id is null then raise exception 'active constituent not found'; end if;
  update public.basket_constituents set active_to = greatest(p_effective_date, active_from + 1)
    where id = p_member_id returning active_to into v_effective_date;
  update public.baskets set revision = revision + 1 where id = p_basket_id;
  insert into public.basket_events (basket_id, event_type, ticker, effective_date, before_state, after_state)
  values (
    p_basket_id, 'constituent_removed', v_member.ticker, v_effective_date,
    jsonb_build_object('ticker', v_member.ticker, 'active_from', v_member.active_from, 'active_to', null),
    jsonb_build_object('ticker', v_member.ticker, 'active_from', v_member.active_from, 'active_to', v_effective_date)
  );
end;
$$;

create or replace function public.delete_basket(p_basket_id uuid, p_expected_revision integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_basket public.baskets; v_deleted_at timestamptz;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select * into v_basket from public.baskets
    where id = p_basket_id and revision = p_expected_revision and deleted_at is null for update;
  if v_basket.id is null then raise exception 'basket changed; refresh and retry' using errcode = '40001'; end if;
  update public.baskets set deleted_at = now(), revision = revision + 1
    where id = p_basket_id returning deleted_at into v_deleted_at;
  insert into public.basket_events (basket_id, event_type, before_state, after_state)
  values (
    p_basket_id, 'basket_deleted',
    jsonb_build_object('name', v_basket.name, 'weighting_method', v_basket.weighting_method, 'deleted_at', null),
    jsonb_build_object('name', v_basket.name, 'weighting_method', v_basket.weighting_method, 'deleted_at', v_deleted_at)
  );
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
  update public.daily_prices prices
  set shares_outstanding = updates.shares_outstanding,
      market_cap = updates.market_cap
  from jsonb_to_recordset(p_rows) as updates(ticker text, price_date date, shares_outstanding numeric, market_cap numeric)
  where prices.ticker = upper(trim(updates.ticker))
    and prices.price_date = updates.price_date
    and (prices.shares_outstanding is null or prices.market_cap is null);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.record_security_market_snapshot(
  p_ticker text,
  p_shares_outstanding numeric,
  p_market_cap numeric,
  p_as_of timestamptz,
  p_source text,
  p_stale boolean
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  update public.security_universe
  set current_shares_outstanding = p_shares_outstanding,
      current_market_cap = p_market_cap,
      market_data_as_of = p_as_of,
      market_data_source = p_source,
      market_data_stale = p_stale
  where ticker = upper(trim(p_ticker));
  if not found then raise exception 'security is not in the supported universe: %', upper(trim(p_ticker)); end if;
end;
$$;

revoke all on function public.create_basket_with_constituents(text, text, text[], date) from public, anon, authenticated;
revoke all on function public.delete_basket(uuid, integer) from public, anon, authenticated;
revoke all on function public.record_security_market_snapshot(text, numeric, numeric, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.create_basket_with_constituents(text, text, text[], date) to service_role;
grant execute on function public.delete_basket(uuid, integer) to service_role;
grant execute on function public.record_security_market_snapshot(text, numeric, numeric, timestamptz, text, boolean) to service_role;
