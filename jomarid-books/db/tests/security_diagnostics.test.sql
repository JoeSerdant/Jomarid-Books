-- SQL testy db/security-diagnostics.sql: skript nic nezmění, dohraje všechny části bez chyby a pozná děravé i správně zavřené věci.
-- Spouští se přes db/tests/run.sh (potřebuje mock_schema.sql; po ostatních souborech v db/ je v databázi i jejich zavřené tabulky a funkce).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
-- Účty tohoto testu mají čísla od 900 (id ...0901 a výš), ať se nepletou s ostatními testy.
create or replace function tt.su(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((900 + n)::text, 12, '0'))::uuid $$;
delete from public.user_books where user_id between tt.su(0) and tt.su(99);
delete from public.profiles where id between tt.su(0) and tt.su(99);
delete from auth.users where id between tt.su(0) and tt.su(99);
delete from public.books where title like 'tt-sec-%';
insert into auth.users (id, email) values (tt.su(1), 'a@x.cz'), (tt.su(2), 'b@x.cz'), (tt.su(3), 'c@x.cz');
insert into public.profiles (id, role, email, username) values (tt.su(1), 'správce', 'a@x.cz', 'sec1'), (tt.su(2), 'uživatel', 'b@x.cz', 'sec2'), (tt.su(3), 'uživatel', 'c@x.cz', 'sec3');
insert into public.books (id, title, price_coins) values (gen_random_uuid(), 'tt-sec-placena', 40);

-- Zkušební objekty: jedna tabulka a funkce děravé, jedna tabulka zavřená.
drop table if exists public.tt_sec_leaky; drop table if exists public.tt_sec_closed;
create table public.tt_sec_leaky (id serial primary key, email text);
insert into public.tt_sec_leaky (email) values ('x@y.cz');
grant all on public.tt_sec_leaky to anon, authenticated;
grant all on sequence public.tt_sec_leaky_id_seq to anon, authenticated;  -- jako ve Supabase, kde se sekvence otevírají výchozími právy
create table public.tt_sec_closed (id serial primary key, email text);
alter table public.tt_sec_closed enable row level security;
revoke all on public.tt_sec_closed from public, anon, authenticated;
create or replace function public.tt_sec_open() returns int language sql security definer as $$ select 1 $$;
grant execute on function public.tt_sec_open() to anon, authenticated;
-- Dvě funkce správce bez parametrů: jedna čtenáři vrací 0 a správci 7 (v pořádku), druhá všem 5 (únik).
create or replace function public.admin_tt_count() returns int language sql stable security definer set search_path to 'public' as $$ select case when public.app_current_role() = 'správce' then 7 else 0 end $$;
create or replace function public.admin_tt_leak() returns int language sql stable security definer set search_path to 'public' as $$ select 5 $$;
revoke all on function public.admin_tt_count() from public, anon; revoke all on function public.admin_tt_leak() from public, anon;
grant execute on function public.admin_tt_count() to authenticated; grant execute on function public.admin_tt_leak() to authenticated;

-- Stav dat před diagnostikou.
create temp table tt_before as
select 'profiles' t, md5(string_agg(p::text, '|' order by id)) h from public.profiles p
union all select 'books', md5(coalesce(string_agg(b::text, '|' order by id), '')) from public.books b
union all select 'user_books', md5(coalesce(string_agg(u::text, '|' order by id), '')) from public.user_books u
union all select 'coin_transactions', md5(coalesce(string_agg(c::text, '|' order by id), '')) from public.coin_transactions c
union all select 'system_logs', md5(coalesce(string_agg(l::text, '|' order by id), '')) from public.system_logs l
union all select 'leaky', md5(string_agg(k::text, '|' order by id)) from public.tt_sec_leaky k;

\ir ../security-diagnostics.sql

select tt.ok(not exists (select 1 from pg_temp._diag where sekce like 'Z.%'), 'žádná část diagnostiky nespadla (žádný řádek "Chyba skriptu")');
select tt.ok((select count(distinct left(sekce, 2)) filter (where left(sekce, 2) in ('A.', 'B.', 'D.', 'J.', 'K.', 'N.', 'O.')) from pg_temp._diag) = 7, 'výsledek obsahuje hlavní části (instance, tabulky, funkce, rozšíření, role, zkoušky, ruční seznam)');
select tt.ok(exists (select 1 from pg_temp._diag where sekce = 'N. Zkoušky' and objekt = '(průběh)'), 'zkoušky pod rolí čtenáře a anon se spustily');
select tt.ok(exists (select 1 from pg_temp._diag where sev = 1 and sekce = 'B. Tabulky' and objekt = 'public.tt_sec_leaky'), 'tabulka bez RLS s právy pro anon je hlášená jako kritická');
select tt.ok(not exists (select 1 from pg_temp._diag where sev <= 3 and objekt = 'public.tt_sec_closed'), 'zavřená tabulka (RLS, bez práv) nic nehlásí');
select tt.ok(exists (select 1 from pg_temp._diag where sev = 1 and sekce = 'N. Zkoušky: zápis' and objekt = 'public.tt_sec_leaky' and nalez like '%anon%VKLÁDAT%'), 'zkouška pozná, že do děravé tabulky jde bez přihlášení vkládat');
select tt.ok(exists (select 1 from pg_temp._diag where sev = 1 and sekce = 'D. Funkce' and objekt like 'public.tt_sec_open(%'), 'funkce SECURITY DEFINER volatelná bez přihlášení je hlášená jako kritická');
select tt.ok(exists (select 1 from pg_temp._diag where sev = 2 and sekce = 'D. Funkce' and objekt like 'public.tt_sec_open(%' and nalez like '%search_path%'), 'a chybějící search_path také');
select tt.ok(not exists (select 1 from pg_temp._diag where sev <= 2 and objekt like 'public.login_codes%'), 'tabulka login_codes z db/login-code.sql (zavřená) je v pořádku');
select tt.ok(not exists (select 1 from pg_temp._diag where sev <= 2 and sekce = 'D. Funkce' and objekt like 'public.redeem_login_code(%'), 'redeem_login_code smí volat jen service_role (nic nehlásí)');
select tt.ok(exists (select 1 from pg_temp._diag where sekce = 'O. Ruční kontrola v dashboardu') and exists (select 1 from pg_temp._diag where sekce like 'N. Zkoušky%' and nalez like 'V pořádku:%'), 'ruční kontrolní seznam i potvrzení, že něco je správně zavřené, jsou ve výsledku');
select tt.ok(not exists (select 1 from pg_temp._diag where sev = 1 and objekt = 'public.admin_tt_count()') and exists (select 1 from pg_temp._diag where sev = 5 and objekt = 'public.admin_tt_count()' and nalez like 'V pořádku: čtenáři vrátí prázdnou%'), 'funkce správce, která čtenáři vrací jen 0 (a správci 7), není hlášená jako únik');
select tt.ok(exists (select 1 from pg_temp._diag where sev = 1 and sekce = 'N. Zkoušky: funkce' and objekt = 'public.admin_tt_leak()' and nalez like 'Funkce správce vrátí odpověď%'), 'funkce správce, která čtenáři vrátí skutečný výsledek, je hlášená jako únik');
select tt.ok(not exists (select 1 from pg_temp._diag where detail ~* 'eyJ[A-Za-z0-9_-]{20,}'), 'výsledek neobsahuje žádný klíč');
select tt.ok(current_user = session_user, 'po zkouškách je role spojení zase původní (set local role se vrátil)');

-- Nic se nezměnilo.
select tt.ok(not exists (
  select 1 from tt_before b join (
    select 'profiles' t, md5(string_agg(p::text, '|' order by id)) h from public.profiles p
    union all select 'books', md5(coalesce(string_agg(b::text, '|' order by id), '')) from public.books b
    union all select 'user_books', md5(coalesce(string_agg(u::text, '|' order by id), '')) from public.user_books u
    union all select 'coin_transactions', md5(coalesce(string_agg(c::text, '|' order by id), '')) from public.coin_transactions c
    union all select 'system_logs', md5(coalesce(string_agg(l::text, '|' order by id), '')) from public.system_logs l
    union all select 'leaky', md5(string_agg(k::text, '|' order by id)) from public.tt_sec_leaky k) a on a.t = b.t where a.h is distinct from b.h), 'diagnostika nezměnila ani jediný řádek (profily, knihy, mince, logy, děravá tabulka)');

-- Druhé spuštění ve stejném spojení (dočasná tabulka už existuje) dá totéž.
select count(*) as n1 from pg_temp._diag \gset
\ir ../security-diagnostics.sql
select count(*) as n2 from pg_temp._diag \gset
select tt.ok(:n1 = :n2, 'druhé spuštění ve stejném spojení dá stejný počet řádků (starý výsledek se smaže)');

drop table public.tt_sec_leaky; drop table public.tt_sec_closed; drop function public.tt_sec_open(); drop function public.admin_tt_count(); drop function public.admin_tt_leak();
delete from public.user_books where user_id between tt.su(0) and tt.su(99);
delete from public.profiles where id between tt.su(0) and tt.su(99);
delete from auth.users where id between tt.su(0) and tt.su(99);
delete from public.books where title like 'tt-sec-%';
