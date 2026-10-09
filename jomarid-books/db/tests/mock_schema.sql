-- Zjednodušené schéma Supabase pro SQL testy oznámení (db/tests/run.sh): jen tabulky a funkce, na které se db/push-notifications.sql odkazuje.
-- Slouží výhradně testům na dočasném lokálním PostgreSQL; do Supabase se nikdy nespouští (maže schéma public!).
drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade; drop schema if exists net cascade; drop schema if exists extensions cascade;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
create schema extensions;
create schema net;
create table net.calls (id serial primary key, url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$ begin insert into net.calls (url, headers, body) values (url, headers, body); return 1; end $$;
create table public.profiles (id uuid primary key references auth.users (id), role text, coins bigint default 0, monthly_goal int, frozen_dates date[] default '{}', current_streak int default 0);
create table public.books (id uuid primary key default gen_random_uuid(), title text, author text, author_display text, author_id uuid, price_coins int not null default 0, is_hidden boolean not null default false, is_auto_assigned boolean default false);
create table public.user_books (id uuid primary key default gen_random_uuid(), user_id uuid not null, book_id uuid not null, status text, is_read boolean default false, scroll_position numeric(5,2), updated_at timestamptz default now(), first_completed_at timestamptz);
create table public.user_daily_activity (id bigint generated always as identity primary key, user_id uuid, activity_date date, unique (user_id, activity_date));
create table public.user_notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, kind text not null, title text not null, body text, payload jsonb not null default '{}', created_at timestamptz not null default now(), read_at timestamptz);
create table public.admin_notifications (id uuid primary key default gen_random_uuid(), kind text not null, status text not null default 'open', user_id uuid, title text not null, body text, payload jsonb not null default '{}', created_at timestamptz not null default now());
create function public.app_current_role() returns text language sql stable security definer set search_path to 'public' as $$ select role from public.profiles where id = auth.uid() $$;
