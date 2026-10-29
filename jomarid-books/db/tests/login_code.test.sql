-- SQL testy db/login-code.sql: vytvoření kódu, jeho otisk, uplatnění, ochrana proti zkoušení, oprávnění a znovuspuštění souboru.
-- Spouští se přes db/tests/run.sh (potřebuje mock_schema.sql).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
-- Účty tohoto testu mají čísla od 400 (id ...0401 a výš), ať se nepletou s ostatními testy.
create or replace function tt.lu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((400 + n)::text, 12, '0'))::uuid $$;
create or replace function tt.as_lu(n int) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', tt.lu(n)::text, false); end $$;
create or replace function tt.no_user() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
create or replace function tt.lmk(n int) returns void language plpgsql security definer as $$
begin
  insert into auth.users (id, email) values (tt.lu(n), 'l' || n || '@x.cz');
  insert into public.profiles (id, role, email, username) values (tt.lu(n), 'uživatel', 'l' || n || '@x.cz', 'kod' || n);
end $$;
-- Otisk kódu tak, jak ho počítá Edge Function: SHA-256 ze 32 znaků bez pomlček.
create or replace function tt.h(code text) returns bytea language sql immutable as $$ select sha256(convert_to(upper(replace(code, '-', '')), 'UTF8')) $$;
grant execute on all functions in schema tt to public;

delete from public.login_code_failures;
delete from public.login_codes where user_id between tt.lu(0) and tt.lu(99);
delete from public.profiles where id between tt.lu(0) and tt.lu(99);
delete from auth.users where id between tt.lu(0) and tt.lu(99);
select tt.lmk(1);
select tt.lmk(2);

-- ===== vytvoření kódu =====
select tt.as_lu(1);
create temp table c1 as select public.create_login_code() as code;
select tt.ok((select code ~ '^([0-9A-F]{4}-){7}[0-9A-F]{4}$' from c1), 'kód má osm skupin po čtyřech znacích 0-9 A-F');
select tt.ok((select count(*) from public.login_codes where user_id = tt.lu(1)) = 1, 'uložil se jeden záznam');
select tt.ok((select code_hash = tt.h(code) from public.login_codes, c1 where user_id = tt.lu(1)), 'uložený je otisk SHA-256 kódu');
select tt.ok(not exists (select 1 from public.login_codes l, c1 where encode(l.code_hash, 'hex') ilike '%' || replace(c1.code, '-', '') || '%'), 'samotný kód se nikde neukládá');
select tt.ok((select my_login_code ->> 'exists' = 'true' and my_login_code ? 'created_at' and not (my_login_code ? 'code_hash') from (select public.my_login_code()) x), 'my_login_code řekne, že kód je, a nevrací otisk');
create temp table c1b as select public.create_login_code() as code;
select tt.ok((select c1.code <> c1b.code from c1, c1b), 'každý kód je jiný');
select tt.ok((select count(*) from public.login_codes where user_id = tt.lu(1)) = 1, 'nový kód nahradil starý (pořád jeden záznam)');

-- ===== uplatnění =====
select tt.no_user();
select tt.ok(public.redeem_login_code(tt.h((select code from c1)), '1.1.1.1') = '{"ok": false, "reason": "invalid"}'::jsonb, 'starý (nahrazený) kód už neplatí');
select tt.ok(public.redeem_login_code(tt.h((select code from c1b)), '1.1.1.1') = jsonb_build_object('ok', true, 'user_id', tt.lu(1)), 'nový kód vrátí správný účet');
select tt.ok((select use_count = 1 and last_used_at is not null from public.login_codes where user_id = tt.lu(1)), 'použití se započítá');
select tt.ok(public.redeem_login_code(tt.h((select code from c1b)), null)->>'ok' = 'true', 'bez adresy volajícího to taky projde (jen se nezapočítá do omezení po adrese)');

-- ===== Nový kód vynuluje počítadlo =====
select tt.as_lu(1);
create temp table c1c as select public.create_login_code() as code;
select tt.ok((select use_count = 0 and last_used_at is null from public.login_codes where user_id = tt.lu(1)), 'nový kód vynuluje počet použití');

-- ===== ochrana proti zkoušení =====
select tt.no_user();
select public.redeem_login_code(tt.h('DEADBEEF' || lpad(i::text, 24, '0')), '9.9.9.9') from generate_series(1, 10) i;
select tt.ok((select count(*) from public.login_code_failures where client = '9.9.9.9') = 10, 'deset chybných pokusů se zapsalo');
select tt.ok(public.redeem_login_code(tt.h('DEADBEEF' || lpad('11', 24, '0')), '9.9.9.9') = '{"ok": false, "reason": "throttled"}'::jsonb, 'jedenáctý pokus z téže adresy je odmítnutý');
select tt.ok(public.redeem_login_code(tt.h((select code from c1c)), '9.9.9.9') = '{"ok": false, "reason": "throttled"}'::jsonb, 'a odmítne se i správný kód z téže adresy, dokud omezení trvá');
select tt.ok(public.redeem_login_code(tt.h((select code from c1c)), '8.8.8.8')->>'ok' = 'true', 'jiná adresa s platným kódem projde');
update public.login_code_failures set at = now() - interval '11 minutes' where client = '9.9.9.9';
select tt.ok(public.redeem_login_code(tt.h((select code from c1c)), '9.9.9.9')->>'ok' = 'true', 'po deseti minutách se omezení uvolní');
select tt.ok(public.redeem_login_code(tt.h('AAAA'), '7.7.7.7') ->> 'reason' = 'invalid', 'chybný kód se odmítne');
select tt.ok((select count(*) from public.login_code_failures where client = '7.7.7.7') = 1, 'a pokus se zapíše');
update public.login_code_failures set at = now() - interval '2 days' where client = '7.7.7.7';
select public.redeem_login_code(tt.h('BBBB'), '6.6.6.6');
select tt.ok((select count(*) from public.login_code_failures where client = '7.7.7.7') = 0, 'záznamy starší než den se mažou');
-- celkové omezení ze všech adres
insert into public.login_code_failures (client) select 'rozptyl' || i from generate_series(1, 300) i;
select tt.ok(public.redeem_login_code(tt.h((select code from c1c)), '5.5.5.5')->>'reason' = 'throttled', 'při stovkách pokusů ze všech adres naráz se odmítá všem');
delete from public.login_code_failures;

-- ===== zneplatnění =====
select tt.as_lu(1);
select tt.ok(public.revoke_login_code() is true, 'zneplatnění kódu vrátí true');
select tt.ok(public.revoke_login_code() is false, 'podruhé už není co rušit (false)');
select tt.ok((select my_login_code ->> 'exists' = 'false' from (select public.my_login_code()) x), 'po zneplatnění kód není');
select tt.no_user();
select tt.ok(public.redeem_login_code(tt.h((select code from c1c)), '4.4.4.4')->>'reason' = 'invalid', 'zneplatněný kód už nejde uplatnit');

-- ===== každý má svůj kód =====
select tt.as_lu(2);
create temp table c2 as select public.create_login_code() as code;
select tt.as_lu(1);
create temp table c1d as select public.create_login_code() as code;
select tt.no_user();
select tt.ok((public.redeem_login_code(tt.h((select code from c2)), 'x')->>'user_id')::uuid = tt.lu(2) and (public.redeem_login_code(tt.h((select code from c1d)), 'x')->>'user_id')::uuid = tt.lu(1), 'dva čtenáři, dva kódy, každý vede na svůj účet');
select tt.as_lu(2);
select tt.ok(public.revoke_login_code() and exists (select 1 from public.login_codes where user_id = tt.lu(1)), 'zneplatnění kódu jednoho čtenáře ten druhý nepocítí');

-- ===== oprávnění =====
select tt.no_user();
do $$ begin
  begin perform public.create_login_code(); raise exception 'SELÁHALO: nepřihlášený smí vytvořit kód';
  exception when others then if sqlerrm <> 'not_authenticated' then raise; end if; end;
  begin perform public.my_login_code(); raise exception 'SELÁHALO: nepřihlášený smí číst stav kódu';
  exception when others then if sqlerrm <> 'not_authenticated' then raise; end if; end;
  begin perform public.revoke_login_code(); raise exception 'SELÁHALO: nepřihlášený smí rušit kód';
  exception when others then if sqlerrm <> 'not_authenticated' then raise; end if; end;
  raise notice 'OK   nepřihlášený nesmí vytvořit, číst ani rušit kód (not_authenticated)';
end $$;
select tt.ok(has_function_privilege('authenticated', 'public.create_login_code()', 'execute') and has_function_privilege('authenticated', 'public.my_login_code()', 'execute') and has_function_privilege('authenticated', 'public.revoke_login_code()', 'execute'), 'přihlášený čtenář smí vytvořit, číst a rušit svůj kód');
select tt.ok(not has_function_privilege('anon', 'public.create_login_code()', 'execute') and not has_function_privilege('anon', 'public.my_login_code()', 'execute') and not has_function_privilege('anon', 'public.revoke_login_code()', 'execute'), 'anon nesmí nic z toho');
select tt.ok(has_function_privilege('service_role', 'public.redeem_login_code(bytea, text)', 'execute') and not has_function_privilege('authenticated', 'public.redeem_login_code(bytea, text)', 'execute') and not has_function_privilege('anon', 'public.redeem_login_code(bytea, text)', 'execute'), 'kód uplatní jen Edge Function (service_role), ne přihlášený ani anon');
select tt.ok(not has_table_privilege('authenticated', 'public.login_codes', 'select') and not has_table_privilege('anon', 'public.login_codes', 'select') and not has_table_privilege('authenticated', 'public.login_code_failures', 'select'), 'k tabulkám nemá přímý přístup nikdo kromě serveru');
select tt.ok((select relrowsecurity from pg_class where oid = 'public.login_codes'::regclass) and (select relrowsecurity from pg_class where oid = 'public.login_code_failures'::regclass), 'obě tabulky mají zapnutou RLS');

-- ===== smazání účtu =====
select tt.as_lu(1);
create temp table c1e as select public.create_login_code() as code;
delete from public.profiles where id = tt.lu(1);
select tt.ok(not exists (select 1 from public.login_codes where user_id = tt.lu(1)), 'smazáním profilu zmizí i kód');

-- ===== znovuspuštění souboru =====
select tt.as_lu(2);
create temp table c2b as select public.create_login_code() as code;
\ir ../login-code.sql
select tt.ok((select count(*) from public.login_codes where user_id = tt.lu(2)) = 1 and public.my_login_code()->>'exists' = 'true', 'nové spuštění souboru kódy nesmazalo');
select tt.no_user();
select tt.ok(public.redeem_login_code(tt.h((select code from c2b)), 'z')->>'ok' = 'true', 'a kód pořád funguje');
