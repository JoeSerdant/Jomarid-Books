-- SQL testy denního limitu pomocníka v appce (db/help-bot.sql): počítání, vyčerpání limitu, oddělení uživatelů, vrácení otázky, oprávnění.
-- Spouští se přes db/tests/run.sh (potřebuje mock_schema.sql a db/help-bot.sql).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
-- Účty tohoto testu mají čísla od 950 (id ...0951 a výš).
create or replace function tt.bu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((950 + n)::text, 12, '0'))::uuid $$;
create or replace function tt.as_bu(n int) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', tt.bu(n)::text, false); end $$;
create or replace function tt.no_user() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
create or replace function tt.bmk(n int) returns void language plpgsql security definer as $$
begin
  insert into auth.users (id, email) values (tt.bu(n), 'b' || n || '@x.cz');
  insert into public.profiles (id, role, email, username) values (tt.bu(n), 'uživatel', 'b' || n || '@x.cz', 'bot' || n);
end $$;
create or replace function tt.bcount(p_user int) returns int language sql security definer as $$ select coalesce((select u.n from public.help_bot_usage u where u.user_id = tt.bu(p_user) and u.day = (now() at time zone 'Europe/Prague')::date), 0) $$;
grant execute on all functions in schema tt to public;

select tt.no_user();
delete from public.help_bot_usage where user_id between tt.bu(0) and tt.bu(99);
delete from public.profiles where id between tt.bu(0) and tt.bu(99);
delete from auth.users where id between tt.bu(0) and tt.bu(99);
select tt.bmk(1);
select tt.bmk(2);

-- ===== počítání a limit =====
select tt.as_bu(1);
select tt.ok(public.help_bot_take(3) = 2, 'první otázka při limitu 3: zbývají 2');
select tt.ok(public.help_bot_take(3) = 1, 'druhá otázka: zbývá 1');
select tt.ok(public.help_bot_take(3) = 0, 'třetí otázka: zbývá 0, ještě prošla');
select tt.ok(public.help_bot_take(3) = -1, 'čtvrtá otázka při limitu 3 je odmítnutá (-1)');
select tt.ok(tt.bcount(1) = 3, 'odmítnutá otázka se do počtu nezapsala');
select tt.ok(public.help_bot_take(3) = -1, 'a zůstává odmítnutá');

-- ===== uživatelé jsou oddělení =====
select tt.as_bu(2);
select tt.ok(public.help_bot_take(3) = 2, 'jiný uživatel má vlastní počítadlo');
select tt.ok(tt.bcount(2) = 1 and tt.bcount(1) = 3, 'počty obou uživatelů jsou samostatné');

-- ===== vrácení otázky =====
select tt.as_bu(1);
select public.help_bot_refund();
select tt.ok(tt.bcount(1) = 2, 'vrácení sníží počet o jednu');
select tt.ok(public.help_bot_take(3) = 0, 'po vrácení jde otázku zase položit');
select tt.as_bu(2);
select public.help_bot_refund(); select public.help_bot_refund(); select public.help_bot_refund();
select tt.ok(tt.bcount(2) = 0, 'vrácení nikdy nejde pod nulu');

-- ===== meze limitu =====
select tt.as_bu(2);
select tt.ok(public.help_bot_take(0) = 0, 'limit 0 se zvedne na 1 (první otázka projde, pak 0 zbývá)');
select tt.ok(public.help_bot_take(0) = -1, 'a druhá už ne');
select tt.ok(public.help_bot_take(null) between 0 and 39, 'limit null se bere jako výchozí 40');
select tt.ok(public.help_bot_take(100000) >= 0, 'obrovský limit se ořízne na 500');

-- ===== staré dny se uklízejí =====
insert into public.help_bot_usage (user_id, day, n) values (tt.bu(1), (now() at time zone 'Europe/Prague')::date - 30, 5);
select tt.as_bu(1);
select public.help_bot_take(3);
select tt.ok(not exists (select 1 from public.help_bot_usage where user_id = tt.bu(1) and day < (now() at time zone 'Europe/Prague')::date - 7), 'záznamy starší než týden se při dalším použití smažou');

-- ===== bez přihlášení =====
select tt.no_user();
do $$ begin
  begin perform public.help_bot_take(3); raise exception 'SELÁHALO: bez přihlášení to prošlo';
  exception when others then if sqlerrm <> 'not_authenticated' then raise; end if; end;
  begin perform public.help_bot_refund(); raise exception 'SELÁHALO: vrácení bez přihlášení prošlo';
  exception when others then if sqlerrm <> 'not_authenticated' then raise; end if; end;
  raise notice 'OK   bez přihlášení se nic nepočítá ani nevrací';
end $$;

-- ===== oprávnění =====
select tt.ok(not has_table_privilege('anon', 'public.help_bot_usage', 'select') and not has_table_privilege('authenticated', 'public.help_bot_usage', 'select')
  and not has_table_privilege('authenticated', 'public.help_bot_usage', 'insert') and not has_table_privilege('authenticated', 'public.help_bot_usage', 'update'), 'tabulka help_bot_usage je klientům zavřená');
select tt.ok(not has_function_privilege('anon', 'public.help_bot_take(int)', 'execute') and has_function_privilege('authenticated', 'public.help_bot_take(int)', 'execute')
  and not has_function_privilege('anon', 'public.help_bot_refund()', 'execute') and has_function_privilege('authenticated', 'public.help_bot_refund()', 'execute'), 'funkce smí volat jen přihlášený');

-- ===== úklid =====
delete from public.help_bot_usage where user_id between tt.bu(0) and tt.bu(99);
delete from public.profiles where id between tt.bu(0) and tt.bu(99);
delete from auth.users where id between tt.bu(0) and tt.bu(99);
