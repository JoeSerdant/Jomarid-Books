-- SQL testy shortB (db/shorts.sql): kdo smí psát, kontroly vstupu, úpravy a skrývání, nabídka pro feed, hlášení čtení, signály, mazání a oprávnění.
-- Spouští se přes db/tests/run.sh (potřebuje mock_schema.sql a db/shorts.sql).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
-- Účty tohoto testu mají čísla od 900 (id ...0901 a výš).
create or replace function tt.hu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((900 + n)::text, 12, '0'))::uuid $$;
create or replace function tt.as_hu(n int) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', tt.hu(n)::text, false); end $$;
create or replace function tt.no_user() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
create or replace function tt.hsnap() returns text language sql security definer as $$
  select md5(concat_ws('|',
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from public.shorts t)::text,
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id, t.short_id), '[]') from public.short_progress t)::text)) $$;
-- Volání musí selhat s danou chybou a nic nesmí změnit.
create or replace function tt.hfails(q text, p_code text, msg text) returns void language plpgsql as $$
declare before_state text := tt.hsnap();
begin
  begin
    execute q;
  exception when others then
    if sqlerrm <> p_code and sqlstate <> p_code then raise exception 'SELÁHALO: % (čekalo se %, přišlo %)', msg, p_code, sqlerrm; end if;
    if tt.hsnap() is distinct from before_state then raise exception 'SELÁHALO: % (selhání něco změnilo)', msg; end if;
    raise notice 'OK   %', msg;
    return;
  end;
  raise exception 'SELÁHALO: % (nic nevyhodilo)', msg;
end $$;
create or replace function tt.hmk(n int, p_role text, p_username text, p_pen text default null) returns void language plpgsql security definer as $$
begin
  insert into auth.users (id, email) values (tt.hu(n), 'h' || n || '@x.cz');
  insert into public.profiles (id, role, email, username, pen_name) values (tt.hu(n), p_role, 'h' || n || '@x.cz', p_username, p_pen);
end $$;
-- Uloží shortB jako účet n a vrátí jeho id.
create or replace function tt.hsave(n int, p_title text, p_body text default 'Text.', p_genres text[] default '{}', p_series text default null, p_part int default null, p_hidden boolean default false, p_id uuid default null)
returns uuid language plpgsql as $$ begin perform tt.as_hu(n); return public.short_save(p_id, p_title, p_body, p_genres, p_series, p_part, p_hidden); end $$;
create or replace function tt.hrep(n int, p_id uuid, p_seen int, p_total int, p_dwell bigint default 0, p_finished boolean default false, p_liked boolean default null) returns jsonb language plpgsql as $$
begin perform tt.as_hu(n); return public.short_report(p_id, p_seen, p_total, p_dwell, p_finished, p_liked); end $$;
grant execute on all functions in schema tt to public;

-- ===== příprava =====
delete from public.short_progress where user_id between tt.hu(0) and tt.hu(99);
delete from public.shorts where author_id between tt.hu(0) and tt.hu(99);
delete from public.profiles where id between tt.hu(0) and tt.hu(99);
delete from auth.users where id between tt.hu(0) and tt.hu(99);
select tt.hmk(1, 'nakladatel', 'jana_pise', 'J. Pero');
select tt.hmk(2, 'správce', 'admin');
select tt.hmk(3, 'uživatel', 'ctenar');
select tt.hmk(4, 'nakladatel', 'petr_pise');
select tt.hmk(5, 'nakladatel', '   ');
select tt.hmk(6, 'uživatel', 'druhy_ctenar');

-- ===== kdo smí psát =====
select tt.hfails($$select tt.no_user(); select public.short_save(null, 'Název', 'Text.', '{}', null, null, false)$$, 'not_authenticated', 'bez přihlášení shortB nejde uložit');
select tt.hfails($$select tt.as_hu(3); select public.short_save(null, 'Název', 'Text.', '{}', null, null, false)$$, 'forbidden', 'běžný čtenář shortB psát nesmí');
select tt.hfails($$select tt.as_hu(3); select public.my_shorts()$$, 'forbidden', 'ani číst seznam svých shortB (není co)');
select tt.ok(tt.hsave(1, 'Od nakladatele') is not null, 'nakladatel shortB uloží');
select tt.ok(tt.hsave(2, 'Od správce') is not null, 'správce shortB uloží');

-- ===== kontroly vstupu =====
select tt.hfails($$select tt.hsave(1, '   ')$$, 'invalid_title', 'prázdný název se odmítne');
select tt.hfails($$select tt.hsave(1, repeat('x', 121))$$, 'invalid_title', 'název nad 120 znaků se odmítne');
select tt.hfails($$select tt.hsave(1, 'Název', '  ')$$, 'invalid_body', 'prázdný text se odmítne');
select tt.hfails($$select tt.hsave(1, 'Název', repeat('a', 6001))$$, 'body_too_long', 'text nad 6 000 znaků se odmítne');
select tt.ok(tt.hsave(1, repeat('x', 120), repeat('a', 6000)) is not null, 'název 120 a text přesně 6 000 znaků projdou');
select tt.hfails($$select tt.hsave(1, 'Název', 'Text.', '{}', 'Série', null)$$, 'invalid_series', 'série bez čísla dílu se odmítne');
select tt.hfails($$select tt.hsave(1, 'Název', 'Text.', '{}', 'Série', 0)$$, 'invalid_series', 'číslo dílu 0 se odmítne');
select tt.hfails($$select tt.hsave(1, 'Název', 'Text.', '{}', repeat('s', 81), 1)$$, 'invalid_series', 'název série nad 80 znaků se odmítne');
-- česká písmena se počítají jako jeden znak (ne jako bajty)
select tt.ok(tt.hsave(1, 'Šíleně žluťoučký kůň', repeat('ě', 6000)) is not null, '6 000 znaků s diakritikou projde (počítají se znaky, ne bajty)');

-- ===== uložení: žánry, série =====
create temp table t_ids (k text primary key, id uuid);
insert into t_ids select 'a', tt.hsave(1, '  Dům u lesa ', E'První odstavec.\n\nDruhý odstavec.', array['  Horor ', 'horor', 'Thriller', '', 'Sci-fi', 'Fantasy', 'Romance', 'Drama', 'Komedie', 'Poezie', 'Historie'], '  Lesní kronika ', 2);
select tt.ok((select title from public.shorts where id = (select id from t_ids where k = 'a')) = 'Dům u lesa', 'název se ořízne o okrajové mezery');
select tt.ok((select genres from public.shorts where id = (select id from t_ids where k = 'a')) = array['Horor', 'Thriller', 'Sci-fi', 'Fantasy', 'Romance', 'Drama', 'Komedie', 'Poezie'], 'žánry: bez prázdných a zdvojených (i podle velikosti písmen), nejvýš 8');
select tt.ok((select series_name || '#' || series_part from public.shorts where id = (select id from t_ids where k = 'a')) = 'Lesní kronika#2', 'série se uloží s číslem dílu');
insert into t_ids select 'g', tt.hsave(1, 'Žánry', 'Text.', array[repeat('Ž', 60)]);
select tt.ok((select genres from public.shorts where id = (select id from t_ids where k = 'g')) = array[repeat('Ž', 40)], 'žánr se zkrátí na 40 znaků');
insert into t_ids select 'b', tt.hsave(1, 'Bez série', 'Text.', '{}', '   ', 5);
select tt.ok((select series_name is null and series_part is null from public.shorts where id = (select id from t_ids where k = 'b')), 'prázdný název série zruší i číslo dílu');

-- ===== úpravy a skrývání =====
select tt.hfails($$select tt.hsave(4, 'Cizí úprava', 'Text.', '{}', null, null, false, (select id from t_ids where k = 'a'))$$, 'not_found', 'cizí nakladatel cizí shortB upravit nesmí');
select tt.hfails($$select tt.hsave(1, 'Neznámý', 'Text.', '{}', null, null, false, gen_random_uuid())$$, 'not_found', 'neexistující shortB se upravit nedá');
select tt.ok(tt.hsave(1, 'Dům u lesa 2', 'Nový text.', array['Horor'], 'Lesní kronika', 2, false, (select id from t_ids where k = 'a')) = (select id from t_ids where k = 'a'), 'autor svůj shortB upraví a dostane stejné id');
select tt.ok((select body from public.shorts where id = (select id from t_ids where k = 'a')) = 'Nový text.' and (select updated_at > created_at from public.shorts where id = (select id from t_ids where k = 'a')), 'změna se uloží a updated_at se posune');
select tt.ok(tt.hsave(2, 'Upravil správce', 'Nový text.', array['Horor'], 'Lesní kronika', 2, false, (select id from t_ids where k = 'a')) is not null, 'správce smí upravit cizí shortB');
select tt.ok((select author_id = tt.hu(1) from public.shorts where id = (select id from t_ids where k = 'a')), 'autorem zůstává původní nakladatel');

select tt.hfails($$select tt.as_hu(4); select public.short_set_hidden((select id from t_ids where k = 'a'), true)$$, 'not_found', 'cizí nakladatel cizí shortB neskryje');
select tt.hfails($$select tt.as_hu(3); select public.short_set_hidden((select id from t_ids where k = 'a'), true)$$, 'forbidden', 'čtenář neskrývá');

-- ===== nabídka pro feed =====
select tt.as_hu(3);
select tt.ok((select count(*) from public.shorts_candidates()) >= 4, 'čtenář dostane nabídku shortB');
select tt.ok((select author_name from public.shorts_candidates() where id = (select id from t_ids where k = 'a')) = 'J. Pero', 'jméno autora je krycí jméno, když ho má');
insert into t_ids select 'c', tt.hsave(4, 'Od Petra');
select tt.as_hu(3);
select tt.ok((select author_name from public.shorts_candidates() where id = (select id from t_ids where k = 'c')) = 'petr_pise', 'bez krycího jména je to uživatelské jméno');
insert into t_ids select 'd', tt.hsave(5, 'Bez jména');
select tt.as_hu(3);
select tt.ok((select author_name from public.shorts_candidates() where id = (select id from t_ids where k = 'd')) = 'Neznámý', 'bez jména i krycího jména je to „Neznámý“');
select tt.ok((select chars from public.shorts_candidates() where id = (select id from t_ids where k = 'a')) = char_length('Nový text.'), 'nabídka ukazuje délku textu (bez samotného textu)');
select tt.ok((select count(*) from public.shorts_candidates(1)) = 1 and (select count(*) from public.shorts_candidates(0)) = 1 and (select count(*) from public.shorts_candidates(null)) >= 4, 'p_limit: 1, nula se zvedne na 1, prázdný znamená výchozí');
select tt.ok((select created_at from public.shorts_candidates() limit 1) = (select max(created_at) from public.shorts where not is_hidden), 'nejnovější první');
select tt.ok((select my_pages_seen = 0 and not my_finished and not my_liked from public.shorts_candidates() where id = (select id from t_ids where k = 'a')), 'bez čtení je můj postup prázdný');

-- skrytý shortB
select tt.as_hu(1);
select public.short_set_hidden((select id from t_ids where k = 'a'), true);
select tt.as_hu(3);
select tt.ok(not exists (select 1 from public.shorts_candidates() where id = (select id from t_ids where k = 'a')), 'skrytý shortB v nabídce pro čtenáře není');
select tt.ok(not exists (select 1 from public.shorts_get(array[(select id from t_ids where k = 'a')])), 'skrytý shortB čtenář nenačte ani podle id');
select tt.hfails($$select tt.hrep(3, (select id from t_ids where k = 'a'), 1, 2)$$, 'not_found', 'o skrytém shortB se nedá hlásit čtení');
select tt.as_hu(1);
select tt.ok(exists (select 1 from public.shorts_get(array[(select id from t_ids where k = 'a')])), 'autor svůj skrytý shortB načte');
select tt.as_hu(2);
select tt.ok(exists (select 1 from public.shorts_get(array[(select id from t_ids where k = 'a')])), 'správce skrytý shortB načte');
select tt.as_hu(2);
select public.short_set_hidden((select id from t_ids where k = 'a'), false);
select tt.as_hu(3);
select tt.ok(exists (select 1 from public.shorts_candidates() where id = (select id from t_ids where k = 'a')), 'po zveřejnění je shortB zase v nabídce');

-- ===== shorts_get =====
select tt.as_hu(3);
select tt.ok((select body from public.shorts_get(array[(select id from t_ids where k = 'a')])) = 'Nový text.', 'shorts_get vrací text');
select tt.ok((select count(*) from public.shorts_get(null)) = 0 and (select count(*) from public.shorts_get('{}')) = 0, 'prázdný seznam id nevrátí nic');
select tt.ok((select count(*) from public.shorts_get(array(select gen_random_uuid() from generate_series(1, 30)))) = 0, 'neznámá id nevrátí nic');
select tt.hfails($$select tt.no_user(); select * from public.shorts_candidates()$$, 'not_authenticated', 'bez přihlášení se nabídka nevrátí');
select tt.hfails($$select tt.no_user(); select * from public.shorts_get('{}')$$, 'not_authenticated', 'bez přihlášení se text nevrátí');

-- ===== hlášení čtení =====
select tt.ok((tt.hrep(3, (select id from t_ids where k = 'a'), 1, 3, 4000)) = '{"ok": true, "finished": false, "liked": false, "newly_finished": false}'::jsonb, 'první hlášení: viděna první stránka, nic dočteno ani olajkováno');
select tt.ok((select pages_seen = 1 and pages_total = 3 and dwell_ms = 4000 from public.short_progress where user_id = tt.hu(3) and short_id = (select id from t_ids where k = 'a')), 'postup se zapsal');
select tt.hrep(3, (select id from t_ids where k = 'a'), 0, 3, 1000);
select tt.ok((select pages_seen = 1 and dwell_ms = 5000 from public.short_progress where user_id = tt.hu(3) and short_id = (select id from t_ids where k = 'a')), 'viděné stránky se nesnižují, čas se přičítá');
select tt.ok((tt.hrep(3, (select id from t_ids where k = 'a'), 3, 3, 2000, true, true)) = '{"ok": true, "finished": true, "liked": true, "newly_finished": true}'::jsonb, 'dočtení a lajk: newly_finished je pravda poprvé');
select tt.ok((tt.hrep(3, (select id from t_ids where k = 'a'), 3, 3, 0, true)) = '{"ok": true, "finished": true, "liked": true, "newly_finished": false}'::jsonb, 'podruhé už ne, lajk zůstává (null = beze změny)');
select tt.ok((tt.hrep(3, (select id from t_ids where k = 'a'), 3, 3, 0, false, false)) = '{"ok": true, "finished": true, "liked": false, "newly_finished": false}'::jsonb, 'lajk jde odebrat, dočtení zůstane');
select tt.hrep(3, (select id from t_ids where k = 'c'), 99, 500, 99999999999);
select tt.ok((select pages_total = 100 and pages_seen = 99 and dwell_ms = 600000 from public.short_progress where user_id = tt.hu(3) and short_id = (select id from t_ids where k = 'c')), 'počet stránek se ořeže na 100 a čas jednoho hlášení na 10 minut');
select tt.hrep(3, (select id from t_ids where k = 'd'), -5, 0, -10);
select tt.ok((select pages_total = 1 and pages_seen = 0 and dwell_ms = 0 from public.short_progress where user_id = tt.hu(3) and short_id = (select id from t_ids where k = 'd')), 'záporné a nulové hodnoty se srovnají');
select tt.hfails($$select tt.hrep(3, gen_random_uuid(), 1, 1)$$, 'not_found', 'o neexistujícím shortB se hlásit nedá');
select tt.hfails($$select tt.no_user(); select public.short_report((select id from t_ids where k = 'a'), 1, 1, 0, false, null)$$, 'not_authenticated', 'bez přihlášení se čtení nehlásí');
select tt.as_hu(3);
select tt.ok((select my_pages_seen = 3 and my_finished and not my_liked from public.shorts_candidates() where id = (select id from t_ids where k = 'a')), 'nabídka ukazuje můj postup');
select tt.ok((select my_finished and not my_liked from public.shorts_get(array[(select id from t_ids where k = 'a')])), 'shorts_get taky');

-- ===== počty u shortB =====
select tt.hrep(6, (select id from t_ids where k = 'a'), 1, 3, 1000, false, true);
select tt.as_hu(3);
select tt.ok((select readers = 2 and finished_by = 1 and likes = 1 from public.shorts_candidates() where id = (select id from t_ids where k = 'a')), 'počty čtenářů, dočtení a lajků (cizí postup se neukazuje, jen součet)');
select tt.as_hu(1);
select tt.ok((select readers = 2 and finished = 1 and likes = 1 from public.my_shorts() where id = (select id from t_ids where k = 'a')), 'autor vidí stejné počty u svého shortB');
select tt.ok((select count(*) from public.my_shorts()) = (select count(*) from public.shorts where author_id = tt.hu(1)), 'autor vidí jen svoje shortB');
select tt.ok((select count(*) from public.my_shorts(true)) = (select count(*) from public.shorts where author_id = tt.hu(1)), 'autor s p_all = true pořád jen svoje');
select tt.as_hu(2);
select tt.ok((select count(*) from public.my_shorts(true)) = (select count(*) from public.shorts), 'správce s p_all = true vidí všechny');
select tt.ok((select count(*) from public.my_shorts()) = (select count(*) from public.shorts where author_id = tt.hu(2)), 'správce bez p_all jen svoje');

-- ===== signály pro přizpůsobení =====
select tt.as_hu(3);
select tt.ok((select count(*) from public.my_short_signals()) = 3, 'signály: tři shortB, které čtenář otevřel');
select tt.ok((select genres = array['Horor'] and series_name = 'Lesní kronika' and series_part = 2 and finished and author_id = tt.hu(1) from public.my_short_signals() where short_id = (select id from t_ids where k = 'a')), 'signál nese žánry, sérii, autora a dočtení');
select tt.ok((select count(*) from public.my_short_signals()) = (select count(*) from public.short_progress where user_id = tt.hu(3)), 'jen moje signály');
select tt.as_hu(1);
select public.short_set_hidden((select id from t_ids where k = 'a'), true);
select tt.as_hu(3);
select tt.ok(not exists (select 1 from public.my_short_signals() where short_id = (select id from t_ids where k = 'a')), 'skrytý shortB se do signálů nepočítá');
select tt.as_hu(1);
select public.short_set_hidden((select id from t_ids where k = 'a'), false);
select tt.hfails($$select tt.no_user(); select * from public.my_short_signals()$$, 'not_authenticated', 'bez přihlášení se signály nevrátí');

-- ===== mazání =====
select tt.hfails($$select tt.as_hu(4); select public.short_delete((select id from t_ids where k = 'a'))$$, 'not_found', 'cizí nakladatel cizí shortB nesmaže');
select tt.hfails($$select tt.as_hu(3); select public.short_delete((select id from t_ids where k = 'a'))$$, 'forbidden', 'čtenář nemaže');
select tt.as_hu(1);
select public.short_delete((select id from t_ids where k = 'a'));
select tt.ok(not exists (select 1 from public.shorts where id = (select id from t_ids where k = 'a')) and not exists (select 1 from public.short_progress where short_id = (select id from t_ids where k = 'a')), 'smazaný shortB zmizel i s postupem čtenářů');
select tt.hfails($$select tt.as_hu(1); select public.short_delete(gen_random_uuid())$$, 'not_found', 'neexistující shortB se smazat nedá');
select tt.as_hu(2);
select public.short_delete((select id from t_ids where k = 'c'));
select tt.ok(not exists (select 1 from public.shorts where id = (select id from t_ids where k = 'c')), 'správce smaže cizí shortB');

-- ===== smazání účtu =====
select tt.ok((select count(*) from public.shorts where author_id = tt.hu(1)) > 0, 'nakladatel 1 má shortB před smazáním účtu');
delete from public.profiles where id = tt.hu(6);
select tt.ok(not exists (select 1 from public.short_progress where user_id = tt.hu(6)), 'smazání čtenáře smaže jeho postup');
delete from public.profiles where id = tt.hu(1);
select tt.ok(not exists (select 1 from public.shorts where author_id = tt.hu(1)), 'smazání autora smaže jeho shortB');

-- ===== oprávnění =====
select tt.ok(not has_table_privilege('anon', 'public.shorts', 'select') and not has_table_privilege('authenticated', 'public.shorts', 'select'), 'tabulka shorts je klientům zavřená');
select tt.ok(not has_table_privilege('anon', 'public.short_progress', 'select') and not has_table_privilege('authenticated', 'public.short_progress', 'insert'), 'tabulka short_progress je klientům zavřená');
select tt.ok((select relrowsecurity from pg_class where oid = 'public.shorts'::regclass) and (select relrowsecurity from pg_class where oid = 'public.short_progress'::regclass), 'obě tabulky mají zapnutou RLS');
select tt.ok((select bool_and(not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in ('short_save', 'short_set_hidden', 'short_delete', 'my_shorts', 'shorts_candidates', 'shorts_get', 'short_report', 'my_short_signals')), 'veřejné funkce smí jen přihlášení, ne anon');
select tt.ok((select bool_and(not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in ('short_uid', 'short_require_writer', 'short_is_admin', 'short_clean_genres')), 'pomocné funkce klienti volat nesmí');
select tt.ok((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('short_save', 'short_set_hidden', 'short_delete', 'my_shorts', 'shorts_candidates', 'shorts_get', 'short_report', 'my_short_signals') and p.prosecdef) = 8, 'všech osm veřejných funkcí běží s právy vlastníka (security definer)');
select tt.no_user();
