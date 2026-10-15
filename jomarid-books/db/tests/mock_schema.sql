-- Zjednodušené schéma Supabase pro SQL testy (db/tests/run.sh): jen tabulky a funkce, na které se db/push-notifications.sql, db/email-change.sql a db/game-records.sql odkazují.
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
create table public.profiles (id uuid primary key references auth.users (id), role text, email text, username text, coins bigint default 0, monthly_goal int, frozen_dates date[] default '{}', current_streak int default 0, show_in_leaderboard boolean default true);
create table public.books (id uuid primary key default gen_random_uuid(), title text, author text, author_display text, author_id uuid, price_coins int not null default 0, is_hidden boolean not null default false, is_auto_assigned boolean default false);
create table public.user_books (id uuid primary key default gen_random_uuid(), user_id uuid not null, book_id uuid not null, status text, is_read boolean default false, scroll_position numeric(5,2), updated_at timestamptz default now(), first_completed_at timestamptz);
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
