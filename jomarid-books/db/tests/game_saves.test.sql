-- SQL testy uloženého postupu her (db/game-saves.sql): načtení, uložení s revizí proti přepsání, kontrola tvaru, přenos starého postupu,
-- export, oprávnění a znovuspuštění souboru.
-- Spouští se přes db/tests/run.sh po shop.test.sql (potřebuje mock_schema.sql a db/game-saves.sql).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
-- Účty tohoto testu mají čísla od 500 (id ...0501 a výš), ať se nepletou s ostatními testy.
create or replace function tt.vu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((500 + n)::text, 12, '0'))::uuid $$;
create or replace function tt.as_vu(n int) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', tt.vu(n)::text, false); end $$;
create or replace function tt.no_user() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
create or replace function tt.vmk(n int) returns void language plpgsql security definer as $$
begin
  insert into auth.users (id, email) values (tt.vu(n), 'v' || n || '@x.cz');
  insert into public.profiles (id, role, email, username) values (tt.vu(n), 'uživatel', 'v' || n || '@x.cz', 'v' || n);
end $$;
-- Otisk tabulky (po selhání se nesmí nic změnit).
create or replace function tt.vsnap() returns text language sql security definer as $$
  select md5(coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id, t.game_id) from public.game_saves t), '[]')::text) $$;
create or replace function tt.vfails(q text, p_code text, msg text) returns void language plpgsql as $$
declare before_state text := tt.vsnap();
begin
  begin
    execute q;
  exception when others then
    if sqlerrm <> p_code and sqlstate <> p_code then raise exception 'SELÁHALO: % (čekalo se %, přišlo %)', msg, p_code, sqlerrm; end if;
    if tt.vsnap() is distinct from before_state then raise exception 'SELÁHALO: % (selhání něco změnilo)', msg; end if;
    raise notice 'OK   %', msg;
    return;
  end;
  raise exception 'SELÁHALO: % (nic nevyhodilo)', msg;
end $$;
create or replace function tt.load(n int, g text) returns jsonb language plpgsql as $$ begin perform tt.as_vu(n); return public.load_game_state(g); end $$;
create or replace function tt.save(n int, g text, d jsonb, base int) returns jsonb language plpgsql as $$ begin perform tt.as_vu(n); return public.save_game_state(g, d, base); end $$;
create or replace function tt.imp(n int, g text, d jsonb) returns jsonb language plpgsql as $$ begin perform tt.as_vu(n); return public.import_legacy_game_state(g, d); end $$;
create or replace function tt.mine(n int) returns jsonb language plpgsql as $$ begin perform tt.as_vu(n); return public.my_game_saves(); end $$;
create or replace function tt.backup(n int, g text) returns jsonb language sql security definer as $$ select legacy_backup from public.game_saves where user_id = tt.vu(n) and game_id = g $$;
create or replace function tt.big(len int) returns jsonb language sql as $$ select jsonb_build_object('a', repeat('x', len)) $$;
grant execute on all functions in schema tt to public;

-- ===== příprava =====
delete from public.profiles where id between tt.vu(0) and tt.vu(899);
delete from auth.users where id between tt.vu(0) and tt.vu(899);
select tt.vmk(1); select tt.vmk(2); select tt.vmk(3); select tt.vmk(4); select tt.vmk(5);

-- ===== bez přihlášení =====
select tt.no_user();
select tt.vfails($$select public.load_game_state('rocket')$$, 'not_authenticated', 'načtení bez přihlášení se odmítne');
select tt.vfails($$select public.save_game_state('rocket', '{}', 0)$$, 'not_authenticated', 'uložení bez přihlášení se odmítne');
select tt.vfails($$select public.import_legacy_game_state('rocket', '{}')$$, 'not_authenticated', 'přenos starého postupu bez přihlášení se odmítne');
select tt.vfails($$select public.my_game_saves()$$, 'not_authenticated', 'export bez přihlášení se odmítne');

-- ===== načtení a uložení =====
select tt.ok(tt.load(1, 'rocket') = '{"rev": 0, "data": {}}'::jsonb, 'hra, která nic neuložila, má revizi 0 a prázdná data');
select tt.ok(tt.save(1, 'rocket', '{"space_shooter_v2_9": "{\"coins\":5}"}', 0) = '{"ok": true, "rev": 1}'::jsonb, 'první uložení (základ 0) vrátí revizi 1');
select tt.ok(tt.load(1, 'rocket') = '{"rev": 1, "data": {"space_shooter_v2_9": "{\"coins\":5}"}}'::jsonb, 'načtení vrátí uložené klíče i s textem přesně tak, jak se uložil');
select tt.ok(tt.save(1, 'rocket', '{"space_shooter_v2_9": "{\"coins\":9}", "jiny": "x"}', 1) = '{"ok": true, "rev": 2}'::jsonb, 'další uložení se správnou revizí zvýší revizi na 2');
select tt.ok(tt.load(1, 'rocket')->'data' = '{"space_shooter_v2_9": "{\"coins\":9}", "jiny": "x"}'::jsonb, 'uložení nahradí celý postup');
select tt.ok(tt.save(1, 'rocket', '{"space_shooter_v2_9": "{\"coins\":9}"}', 2)->>'ok' = 'true' and tt.load(1, 'rocket')->'data' = '{"space_shooter_v2_9": "{\"coins\":9}"}'::jsonb, 'klíč, který hra smazala, ze serveru zmizí také');
select tt.ok(tt.save(1, 'rocket', '{}', 3)->>'ok' = 'true' and tt.load(1, 'rocket') = '{"rev": 4, "data": {}}'::jsonb, 'prázdný postup (hra všechno smazala) je platný a zvýší revizi');
select tt.ok(tt.save(1, 'chess', '{"chessLeague.save.v1": "{}"}', 0)->>'rev' = '1' and tt.load(1, 'rocket')->>'rev' = '4', 'každá hra má vlastní postup i vlastní revizi');
select tt.ok(tt.save(1, 'koulovikamosi', '{"a": "{\"x\": [1,2,3]}", "b": "ěščřžýáíé 🙂 x"}', 0)->>'ok' = 'true', 'text s diakritikou, emotikonem a vnořeným JSON se uloží');
select tt.ok(tt.load(1, 'koulovikamosi')->'data'->>'a' = '{"x": [1,2,3]}', 'vnořený JSON zůstane jen textem, server ho nepřepisuje (včetně mezer)');
select tt.ok(tt.save(1, 'hannibal', '{"hannibal_save_v1": "{\"meta\": {}}", "hannibal_endless_best": "7"}', 0)->>'ok' = 'true' and tt.load(1, 'hannibal')->'data'->>'hannibal_endless_best' = '7', 'Hannibal: Barca uloží postup jako ostatní hry');

-- ===== ochrana proti přepsání z druhého zařízení =====
select tt.save(2, 'chess', '{"a": "1"}', 0);
select tt.save(2, 'chess', '{"a": "2"}', 1);
select tt.ok(tt.save(2, 'chess', '{"a": "z-druheho-zarizeni"}', 1) = '{"ok": false, "reason": "conflict", "rev": 2}'::jsonb, 'uložení se zastaralou revizí se odmítne a vrátí aktuální revizi');
select tt.ok(tt.load(2, 'chess') = '{"rev": 2, "data": {"a": "2"}}'::jsonb, 'po odmítnutém uložení zůstal na serveru původní postup');
select tt.ok(tt.save(2, 'chess', '{"a": "z-budoucnosti"}', 5)->>'reason' = 'conflict' and tt.load(2, 'chess')->>'rev' = '2', 'revize vyšší než na serveru se také odmítne');
select tt.ok(tt.save(2, 'chess', '{"a": "3"}', 2)->>'rev' = '3', 'se správnou revizí uložení zase projde');
select tt.ok(tt.save(3, 'chess', '{"a": "1"}', 3)->>'reason' = 'conflict', 'nový hráč nemůže začít s revizí jinou než 0');
select tt.ok(tt.load(3, 'chess') = '{"rev": 0, "data": {}}'::jsonb, 'a po odmítnutí pořád nic uloženo není');
select tt.ok(tt.save(3, 'chess', '{"a": "1"}', 0)->>'rev' = '1', 'a s revizí 0 uložení projde');

-- ===== oddělení čtenářů =====
select tt.ok(tt.load(2, 'rocket') = '{"rev": 0, "data": {}}'::jsonb and tt.load(4, 'chess') = '{"rev": 0, "data": {}}'::jsonb, 'cizí postup nikdo nevidí (jiný čtenář má u téže hry prázdno)');

-- ===== kontrola tvaru =====
select tt.vfails($$select tt.save(4, 'nope', '{}', 0)$$, 'unknown_game', 'neznámá hra se odmítne při ukládání');
select tt.vfails($$select tt.load(4, 'nope')$$, 'unknown_game', 'neznámá hra se odmítne při načítání');
select tt.vfails($$select tt.save(4, null, '{}', 0)$$, 'unknown_game', 'chybějící hra se odmítne');
select tt.vfails($$select tt.save(4, 'rocket', '[]', 0)$$, 'invalid_data', 'pole místo objektu se odmítne');
select tt.vfails($$select tt.save(4, 'rocket', '"text"', 0)$$, 'invalid_data', 'text místo objektu se odmítne');
select tt.vfails($$select tt.save(4, 'rocket', null, 0)$$, 'invalid_data', 'chybějící data se odmítnou');
select tt.vfails($$select tt.save(4, 'rocket', '{"a": 5}', 0)$$, 'invalid_data', 'číslo místo textu se odmítne');
select tt.vfails($$select tt.save(4, 'rocket', '{"a": {"b": "c"}}', 0)$$, 'invalid_data', 'vnořený objekt místo textu se odmítne');
select tt.vfails($$select tt.save(4, 'rocket', '{"a": null}', 0)$$, 'invalid_data', 'null místo textu se odmítne');
select tt.vfails($$select tt.save(4, 'rocket', '{"": "x"}', 0)$$, 'invalid_data', 'prázdný klíč se odmítne');
select tt.vfails($$select tt.save(4, 'rocket', jsonb_build_object(repeat('k', 101), 'x'), 0)$$, 'invalid_data', 'klíč delší než 100 znaků se odmítne');
select tt.ok(tt.save(4, 'rocket', jsonb_build_object(repeat('k', 100), 'x'), 0)->>'ok' = 'true', 'klíč dlouhý přesně 100 znaků projde');
select tt.vfails($$select tt.save(4, 'warroom', (select jsonb_object_agg('k' || i, 'x') from generate_series(1, 41) i), 0)$$, 'invalid_data', '41 klíčů se odmítne');
select tt.ok(tt.save(4, 'warroom', (select jsonb_object_agg('k' || i, 'x') from generate_series(1, 40) i), 0)->>'ok' = 'true', '40 klíčů projde');
select tt.vfails($$select tt.save(4, 'cityclicker', '{}', -1)$$, 'invalid_data', 'záporná revize se odmítne');
select tt.vfails($$select tt.save(4, 'cityclicker', '{}', null)$$, 'invalid_data', 'chybějící revize se odmítne');
select tt.ok(tt.save(4, 'cityclicker', tt.big(1999991), 0)->>'ok' = 'true', 'postup velký přesně 2 000 000 bajtů (podle zápisu jsonb) projde');
select tt.vfails($$select tt.save(5, 'cityclicker', tt.big(1999992), 0)$$, 'too_large', 'o bajt větší postup se odmítne');
select tt.vfails($$select tt.imp(5, 'rocket', '[]')$$, 'invalid_data', 'přenos starého postupu s nesmyslným tvarem se odmítne');

-- ===== přenos starého postupu z prohlížeče =====
select tt.ok(tt.imp(5, 'polygonarena', '{"polygon-arena-v1": "{\"best\":7}"}') = '{"imported": true, "rev": 1, "data": {"polygon-arena-v1": "{\"best\":7}"}}'::jsonb, 'když ještě nic uloženo není, starý postup se stane uloženým');
select tt.ok(tt.load(5, 'polygonarena') = '{"rev": 1, "data": {"polygon-arena-v1": "{\"best\":7}"}}'::jsonb, 'a načte se jako uložený postup');
select tt.ok(tt.backup(5, 'polygonarena') is null, 'bez zálohy, protože se nic nepřepisuje');
select tt.ok(tt.imp(5, 'polygonarena', '{"polygon-arena-v1": "{\"best\":99}"}') = '{"imported": false, "rev": 1, "data": {"polygon-arena-v1": "{\"best\":7}"}}'::jsonb, 'když už uložený postup je, zůstane ten na serveru a vrátí se jeho data');
select tt.ok(tt.backup(5, 'polygonarena') = '{"polygon-arena-v1": "{\"best\":99}"}'::jsonb, 'starý postup z druhého prohlížeče se uložil jako záloha');
select tt.imp(5, 'polygonarena', '{"polygon-arena-v1": "{\"best\":3}"}');
select tt.ok(tt.backup(5, 'polygonarena') = '{"polygon-arena-v1": "{\"best\":3}"}'::jsonb and tt.load(5, 'polygonarena')->>'rev' = '1', 'další záloha nahradí předchozí a uložený postup se nemění');
select tt.ok(tt.save(5, 'polygonarena', '{"polygon-arena-v1": "{\"best\":8}"}', 1)->>'rev' = '2' and tt.backup(5, 'polygonarena') is not null, 'běžné uložení zálohu nesmaže');
-- řádek s revizí 0 (po odmítnutém uložení) neblokuje přenos
select tt.save(5, 'warroom', '{"a": "1"}', 4);
select tt.ok(tt.imp(5, 'warroom', '{"warroom_muted": "1"}')->>'imported' = 'true', 'po odmítnutém uložení (řádek s revizí 0) se starý postup přenést dá');

-- ===== export =====
select tt.ok(tt.mine(5) ? 'polygonarena' and tt.mine(5) ? 'warroom' and not (tt.mine(5) ? 'rocket'), 'export obsahuje jen hry s uloženým postupem');
select tt.ok(tt.mine(5)->'polygonarena'->'data' = '{"polygon-arena-v1": "{\"best\":8}"}'::jsonb and tt.mine(5)->'polygonarena'->>'rev' = '2' and (tt.mine(5)->'polygonarena') ? 'updated_at', 'export má data, revizi a čas');
select tt.ok(not ((tt.mine(5)->'polygonarena') ? 'legacy_backup'), 'záloha starého postupu se v exportu neukazuje');
select tt.ok(tt.mine(2) = jsonb_build_object('chess', jsonb_build_object('rev', 3, 'updated_at', tt.mine(2)->'chess'->'updated_at', 'data', '{"a": "3"}'::jsonb)), 'export čtenáře obsahuje jen jeho postup');
select tt.ok(tt.mine(4)->'rocket' is not null, 'export obsahuje i hru, která má jen jeden klíč');
select tt.save(1, 'warroom', '{"a": "1"}', 9);
select tt.ok(not (tt.mine(1) ? 'warroom') and tt.load(1, 'warroom') = '{"rev": 0, "data": {}}'::jsonb, 'hra, kde se první uložení odmítlo (prázdný řádek s revizí 0), není v exportu a načte se jako prázdná');

-- ===== oprávnění =====
select tt.ok(not has_function_privilege('anon', 'public.load_game_state(text)', 'execute') and not has_function_privilege('anon', 'public.save_game_state(text, jsonb, int)', 'execute')
  and not has_function_privilege('anon', 'public.import_legacy_game_state(text, jsonb)', 'execute') and not has_function_privilege('anon', 'public.my_game_saves()', 'execute'), 'nepřihlášený návštěvník nesmí volat žádnou funkci uložených her');
select tt.ok(has_function_privilege('authenticated', 'public.load_game_state(text)', 'execute') and has_function_privilege('authenticated', 'public.save_game_state(text, jsonb, int)', 'execute')
  and has_function_privilege('authenticated', 'public.import_legacy_game_state(text, jsonb)', 'execute') and has_function_privilege('authenticated', 'public.my_game_saves()', 'execute'), 'přihlášený čtenář funkce volat smí');
select tt.ok(not has_function_privilege('authenticated', 'public.game_save_check(text, jsonb)', 'execute') and not has_function_privilege('anon', 'public.game_save_check(text, jsonb)', 'execute'), 'pomocná kontrola tvaru je jen pro ostatní funkce');
select tt.ok(not has_table_privilege('authenticated', 'public.game_saves', 'select') and not has_table_privilege('authenticated', 'public.game_saves', 'insert')
  and not has_table_privilege('authenticated', 'public.game_saves', 'update') and not has_table_privilege('authenticated', 'public.game_saves', 'delete') and not has_table_privilege('anon', 'public.game_saves', 'select'), 'klienti nesmí sahat do tabulky přímo');
select tt.ok((select relrowsecurity from pg_class where oid = 'public.game_saves'::regclass), 'na tabulce je zapnutá ochrana řádků');
select tt.ok((select count(*) from pg_proc where proname in ('load_game_state', 'save_game_state', 'import_legacy_game_state', 'my_game_saves') and pronamespace = 'public'::regnamespace and prosecdef) = 4, 'čtyři funkce pro hru běží s právy vlastníka (security definer)');

-- ===== znovuspuštění souboru =====
create temp table before_rerun as select (select count(*) from public.game_saves) n, tt.vsnap() snap;
\ir ../game-saves.sql
select tt.ok((select n from before_rerun) = (select count(*) from public.game_saves) and (select snap from before_rerun) = tt.vsnap(), 'nové spuštění souboru nezměnilo žádný uložený postup');
select tt.ok(tt.load(2, 'chess') = '{"rev": 3, "data": {"a": "3"}}'::jsonb, 'a postup se pořád načte');
drop table before_rerun;

-- ===== smazání účtu =====
select tt.ok(exists (select 1 from public.game_saves where user_id = tt.vu(2)), 'před smazáním má čtenář uložený postup');
delete from public.profiles where id = tt.vu(2);
select tt.ok(not exists (select 1 from public.game_saves where user_id = tt.vu(2)), 'smazáním profilu zmizí i uložený postup');
