-- Denní limity Jomarid Coinů z her a seznam her, které smějí o Coiny žádat (funkce award_game_coins).
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát: funkce se jen nahrazuje, žádná data se nemění.
-- Předpoklady, které v databázi už jsou: funkce public.award_game_coins(p_game_id text, p_amount integer, p_reason text), tabulky profiles (coins, lifetime_coins_earned)
-- a coin_transactions (user_id, amount, source_type). Kdyby funkce chyběla, soubor se hned na začátku zastaví a nic nezmění.
--
-- Co se mění oproti dosavadní funkci (nic dalšího):
--   1. Strop na jednu hru a den: 75 -> 100 Coinů.
--   2. Strop ze všech her dohromady za den: 150 -> 200 Coinů (poměr dvou plných her zůstává; bez zvýšení tohohle stropu by vyšší strop na hru pomohl jen tomu, kdo hraje jednu hru).
--   3. Seznam her doplněn o 'koulovikamosi'. Dosud ho funkce neznala a každou žádost Kouloví Kámošů (zlatá koule) odmítla výjimkou invalid_game_id, takže ze hry nešly žádné Coiny.
-- Den se počítá podle UTC, jako dřív. Server pořád rozhoduje o částce i stropu, hra jen žádá. Oprávnění funkce se nemění (CREATE OR REPLACE je zachová).
--
-- Beze změny zůstává i to, jak se zůstatek připisuje: funkce zvýší profiles.coins sama a pak zapíše řádek do coin_transactions, kde ho spoušť trg_update_coins
-- zvýší ještě jednou (přesně stejně jako u dosavadní funkce).

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'award_game_coins'
      and pg_get_function_identity_arguments(p.oid) = 'p_game_id text, p_amount integer, p_reason text'
  ) then
    raise exception 'Funkce public.award_game_coins(p_game_id text, p_amount integer, p_reason text) v databázi není. Tenhle soubor jen upravuje její stropy a seznam her, novou nevytváří. Nic se nezměnilo.';
  end if;
end $$;

create or replace function public.award_game_coins(p_game_id text, p_amount integer, p_reason text default 'event'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_per_game_cap constant integer := 100;
  v_global_cap constant integer := 200;
  v_prefix text;
  v_used_game integer;
  v_used_global integer;
  v_n integer;
  v_remaining integer;
  v_grant integer;
  v_reason text;
  v_balance bigint;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_game_id is null or p_game_id not in ('rocket', 'warroom', 'cityclicker', 'polygonarena', 'chess', 'koulovikamosi') then
    raise exception 'invalid_game_id';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'invalid_amount';
  end if;

  v_reason := left(regexp_replace(coalesce(p_reason, 'event'), '[^a-zA-Z0-9_]', '', 'g'), 30);
  if v_reason = '' then v_reason := 'event'; end if;

  -- zámek na řádek profilu: dvě souběžná volání se nemohou obě "vejít" pod strop
  select coins into v_balance from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'profile_not_found';
  end if;

  v_prefix := 'game_event:' || p_game_id || ':' || v_today::text || ':';

  select coalesce(sum(ct.amount), 0), count(*) into v_used_game, v_n
    from public.coin_transactions ct
    where ct.user_id = v_user_id and starts_with(ct.source_type, v_prefix);

  select coalesce(sum(ct.amount), 0) into v_used_global
    from public.coin_transactions ct
    where ct.user_id = v_user_id
      and starts_with(ct.source_type, 'game_event:')
      and split_part(ct.source_type, ':', 3) = v_today::text;

  v_remaining := least(v_per_game_cap - v_used_game, v_global_cap - v_used_global);
  if v_remaining <= 0 then
    return jsonb_build_object('granted', 0, 'capped', true, 'balance', v_balance);
  end if;

  v_grant := least(p_amount, v_remaining);

  perform set_config('app.bypass_profile_column_guard', 'true', true);
  update public.profiles
    set coins = coalesce(coins, 0) + v_grant,
        lifetime_coins_earned = coalesce(lifetime_coins_earned, 0) + v_grant
    where id = v_user_id
    returning coins into v_balance;

  insert into public.coin_transactions (user_id, amount, source_type)
  values (v_user_id, v_grant, v_prefix || (v_n + 1)::text || ':' || v_reason);

  return jsonb_build_object('granted', v_grant, 'capped', v_grant < p_amount, 'balance', v_balance);
end;
$function$;
