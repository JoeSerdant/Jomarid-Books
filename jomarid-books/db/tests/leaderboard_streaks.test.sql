-- SQL testy db/leaderboard-streaks.sql: série ostatních do žebříčku, skrytí čtenáři, oprávnění a znovuspuštění souboru.
-- Spouští se přes db/tests/run.sh (potřebuje mock_schema.sql).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
-- Účty tohoto testu mají čísla od 300 (id ...0301 a výš), ať se nepletou s ostatními testy.
create or replace function tt.su(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((300 + n)::text, 12, '0'))::uuid $$;
create or replace function tt.as_su(n int) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', tt.su(n)::text, false); end $$;
create or replace function tt.no_user() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
create or replace function tt.lbmk(n int, p_streak int, p_frozen date[], p_show boolean default true) returns void language plpgsql security definer as $$
begin
  insert into auth.users (id, email) values (tt.su(n), 's' || n || '@x.cz');
  insert into public.profiles (id, role, email, username, current_streak, frozen_dates, show_in_leaderboard) values (tt.su(n), 'uživatel', 's' || n || '@x.cz', 'serie' || n, p_streak, p_frozen, p_show);
end $$;
grant execute on all functions in schema tt to public;

delete from public.profiles where id between tt.su(0) and tt.su(99);
delete from auth.users where id between tt.su(0) and tt.su(99);
select tt.lbmk(1, 8, array['2026-10-20'::date]);
select tt.lbmk(2, 0, '{}');
select tt.lbmk(3, 5, '{}', false);
select tt.lbmk(4, null, null);

select tt.as_su(2);
select tt.ok((select current_streak from public.leaderboard_streaks() where user_id = tt.su(1)) = 8, 'vrací vyhodnocenou sérii čtenáře (osm dní)');
select tt.ok((select frozen_dates from public.leaderboard_streaks() where user_id = tt.su(1)) = array['2026-10-20'::date], 'a dny zachráněné pojistkou');
select tt.ok(not exists (select 1 from public.leaderboard_streaks() where user_id = tt.su(3)), 'skrytý čtenář (inkognito) v odpovědi není');
select tt.ok((select current_streak from public.leaderboard_streaks() where user_id = tt.su(4)) = 0 and (select frozen_dates from public.leaderboard_streaks() where user_id = tt.su(4)) = '{}', 'prázdné hodnoty se vrátí jako nula a prázdný seznam');
select tt.ok((select count(*) from public.leaderboard_streaks() where user_id between tt.su(0) and tt.su(99)) = 3, 'ostatní vidí tři viditelné čtenáře');

select tt.no_user();
do $$ begin
  begin perform * from public.leaderboard_streaks(); raise exception 'SELÁHALO: nepřihlášený smí volat funkci';
  exception when others then if sqlerrm <> 'not_authenticated' then raise; end if; end;
  raise notice 'OK   nepřihlášený je odmítnut (not_authenticated)';
end $$;
select tt.ok(not has_function_privilege('anon', 'public.leaderboard_streaks()', 'execute') and has_function_privilege('authenticated', 'public.leaderboard_streaks()', 'execute'), 'funkci smí volat jen přihlášený');

\ir ../leaderboard-streaks.sql
select tt.as_su(2);
select tt.ok((select current_streak from public.leaderboard_streaks() where user_id = tt.su(1)) = 8, 'nové spuštění souboru nic nerozbilo');
