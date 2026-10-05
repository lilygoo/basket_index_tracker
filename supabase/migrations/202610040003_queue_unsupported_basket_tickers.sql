-- Queue unsupported basket constituents in the shared Risk Lens universe.
-- Queueing occurs in the same transaction as basket membership changes.

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
    if not exists (
      select 1 from public.security_universe
      where ticker = v_ticker and support_status = 'supported' and active
    ) then
      begin
        perform public.request_shared_ticker_support(v_ticker);
      exception when unique_violation then
        -- A concurrent refresh may have promoted the ticker after our check.
        if not exists (
          select 1 from public.security_universe
          where ticker = v_ticker and support_status = 'supported' and active
        ) then
          raise;
        end if;
      end;
    end if;
    insert into public.basket_constituents (basket_id, ticker, active_from)
    values (v_basket.id, v_ticker, p_inception_date);
    insert into public.basket_events (basket_id, event_type, ticker, effective_date, after_state)
    values (v_basket.id, 'constituent_added', v_ticker, p_inception_date, jsonb_build_object('ticker', v_ticker, 'active_from', p_inception_date));
  end loop;

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
  if not exists (
    select 1 from public.security_universe
    where ticker = v_ticker and support_status = 'supported' and active
  ) then
    begin
      perform public.request_shared_ticker_support(v_ticker);
    exception when unique_violation then
      -- A concurrent refresh may have promoted the ticker after our check.
      if not exists (
        select 1 from public.security_universe
        where ticker = v_ticker and support_status = 'supported' and active
      ) then
        raise;
      end if;
    end;
  end if;
  insert into public.basket_constituents (basket_id, ticker, active_from) values (p_basket_id, v_ticker, p_effective_date) returning * into v_member;
  update public.baskets set revision = revision + 1 where id = p_basket_id;
  insert into public.basket_events (basket_id, event_type, ticker, effective_date, after_state)
  values (p_basket_id, 'constituent_added', v_ticker, p_effective_date, jsonb_build_object('ticker', v_ticker, 'active_from', p_effective_date));
  return v_member;
end;
$$;
