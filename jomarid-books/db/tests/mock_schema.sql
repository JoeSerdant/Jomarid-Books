-- Zjednodušené schéma Supabase pro SQL testy (db/tests/run.sh): jen tabulky a funkce, na které se db/push-notifications.sql, db/email-change.sql, db/game-records.sql, db/shop.sql, db/game-saves.sql a db/game-coins.sql odkazují.
-- Slouží výhradně testům na dočasném lokálním PostgreSQL; do Supabase se nikdy nespouští (maže schéma public!).
drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade; drop schema if exists net cascade; drop schema if exists extensions cascade;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
-- Jako v Supabase: nové funkce v public smí zavolat anon i authenticated, dokud jim to 'revoke' nevezme (test pak pozná, když revoke anon chybí).
alter default privileges in schema public grant execute on functions to anon, authenticated;
create schema auth;
create table auth.users (id uuid primary key, email varchar(255), email_confirmed_at timestamptz, email_change varchar(255), email_change_token_new varchar(255), email_change_token_current varchar(255) default '',
  email_change_sent_at timestamptz, email_change_confirm_status smallint default 0, raw_user_meta_data jsonb, updated_at timestamptz);
create table auth.identities (id uuid not null default gen_random_uuid(), provider_id text not null, user_id uuid not null, identity_data jsonb not null, provider text not null, updated_at timestamptz,
  email text generated always as (lower(identity_data ->> 'email')) stored);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
create schema extensions;
create schema net;
create table net.calls (id serial primary key, url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$ begin insert into net.calls (url, headers, body) values (url, headers, body); return 1; end $$;
create table public.profiles (id uuid primary key references auth.users (id), role text, email text, username text, coins bigint default 0, lifetime_coins_earned bigint default 0, monthly_goal int, frozen_dates date[] default '{}', current_streak int default 0, show_in_leaderboard boolean default true);
create table public.books (id uuid primary key default gen_random_uuid(), title text, author text, author_display text, author_id uuid, price_coins int not null default 0, is_hidden boolean not null default false, is_auto_assigned boolean default false);
create table public.user_books (id uuid primary key default gen_random_uuid(), user_id uuid not null, book_id uuid not null, status text, is_read boolean default false, scroll_position numeric(5,2), updated_at timestamptz default now(), first_completed_at timestamptz);
-- Deník mincí: jen sloupce, které appka čte (user_id, amount, source_type, created_at); skutečná tabulka může mít další, db/shop.sql to při spuštění ověří zkušebním zápisem.
create table public.coin_transactions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles (id) on delete cascade, amount int not null, source_type text not null, created_at timestamptz not null default now());
-- Jako ve skutečné databázi: zápis do deníku mincí sám upraví zůstatek v profilu (spoušť trg_update_coins).
create function public.update_user_coins_balance() returns trigger language plpgsql as $$ begin update public.profiles set coins = coins + new.amount where id = new.user_id; return new; end $$;
create trigger trg_update_coins after insert on public.coin_transactions for each row execute function public.update_user_coins_balance();
-- Zjednodušená ochrana sloupců profilu: přihlášený uživatel smí změnit zůstatek jen tehdy, když si funkce nastavila app.bypass_profile_column_guard
-- (volání bez přihlášení, třeba ze SQL editoru, projde). Skutečná ochrana je složitější; tady slouží k ověření, že nákup si bypass nastavuje.
create function public.profile_column_guard() returns trigger language plpgsql as $$
begin
  if new.coins is distinct from old.coins and auth.uid() is not null and coalesce(current_setting('app.bypass_profile_column_guard', true), '') <> 'true' then
    raise exception 'profile_column_guard: zůstatek smí měnit jen funkce s bypassem';
  end if;
  return new;
end $$;
create trigger trg_profile_column_guard before update on public.profiles for each row execute function public.profile_column_guard();
create table public.user_daily_activity (id bigint generated always as identity primary key, user_id uuid, activity_date date, unique (user_id, activity_date));
create table public.user_notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, kind text not null, title text not null, body text, payload jsonb not null default '{}', created_at timestamptz not null default now(), read_at timestamptz);
create table public.admin_notifications (id uuid primary key default gen_random_uuid(), kind text not null, status text not null default 'open', user_id uuid, title text not null, body text, payload jsonb not null default '{}', created_at timestamptz not null default now(), handled_at timestamptz, handled_by uuid,
  constraint admin_notifications_status_check check (status in ('open', 'done', 'dismissed')));
create table public.system_logs (id bigint generated always as identity primary key, created_at timestamptz not null default now(), log_type text not null, message text not null);
create function public.app_current_role() returns text language sql stable security definer set search_path to 'public' as $$ select role from public.profiles where id = auth.uid() $$;
-- Jako ve skutečné databázi: vrátí id přihlášeného správce, jinak vyhodí 'forbidden'.
create function public.notif_require_admin() returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v uuid := auth.uid();
begin
  if v is null or coalesce((select role from public.profiles where id = v), '') <> 'správce' then raise exception 'forbidden'; end if;
  return v;
end $$;
-- Jako ve skutečné databázi: změněný e-mail v auth.users se zkopíruje do profiles.email.
create function public.sync_profile_email() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin update public.profiles set email = new.email where id = new.id; return new; end $$;
create trigger trg_sync_profile_email after update of email on auth.users for each row execute function public.sync_profile_email();

-- Funkce award_game_coins přesně tak, jak je ve skutečné databázi před db/game-coins.sql (zjištěno z pg_get_functiondef): strop 75 Coinů na hru a 150 za den ze všech her,
-- seznam her bez 'koulovikamosi'. db/game-coins.sql ji nahrazuje; test pak ověřuje změny proti tomuhle stavu.
create or replace function public.award_game_coins(p_game_id text, p_amount integer, p_reason text default 'event'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_per_game_cap constant integer := 75;
  v_global_cap constant integer := 150;
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
  if p_game_id is null or p_game_id not in ('rocket', 'warroom', 'cityclicker', 'polygonarena', 'chess') then
    raise exception 'invalid_game_id';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'invalid_amount';
  end if;

  v_reason := left(regexp_replace(coalesce(p_reason, 'event'), '[^a-zA-Z0-9_]', '', 'g'), 30);
  if v_reason = '' then v_reason := 'event'; end if;

  -- zamek na radek profilu: dve soubezna volani se nemohou obe "vejit" pod strop
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
