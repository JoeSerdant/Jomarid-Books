-- SQL testy herních rekordů a odznaků (db/game-records.sql): zápis rekordů, odemykání odznaků, XP, žebříček, oprávnění a znovuspuštění souboru.
-- Spouští se přes db/tests/run.sh po email_change.test.sql (potřebuje mock_schema.sql a db/game-records.sql).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
-- Účty tohoto testu mají čísla od 200 (id ...0201 a výš), ať se nepletou s ostatními testy.
create or replace function tt.gu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((200 + n)::text, 12, '0'))::uuid $$;
create or replace function tt.as_gu(n int) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', tt.gu(n)::text, false); end $$;
create or replace function tt.no_user() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
-- Otisk tabulek her (po selhání se nesmí nic změnit).
create or replace function tt.gsnap() returns text language sql security definer as $$
  select md5(concat_ws('|',
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id, t.game_id, t.stat_key), '[]') from public.game_records t)::text,
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id, t.badge_id), '[]') from public.game_badge_unlocks t)::text)) $$;
create or replace function tt.gfails(q text, p_code text, msg text) returns void language plpgsql as $$
declare before_state text := tt.gsnap();
begin
  begin
    execute q;
  exception when others then
    if sqlerrm <> p_code and sqlstate <> p_code then raise exception 'SELÁHALO: % (čekalo se %, přišlo %)', msg, p_code, sqlerrm; end if;
    if tt.gsnap() is distinct from before_state then raise exception 'SELÁHALO: % (selhání něco změnilo)', msg; end if;
    raise notice 'OK   %', msg;
    return;
  end;
  raise exception 'SELÁHALO: % (nic nevyhodilo)', msg;
end $$;
create or replace function tt.gmk(n int, p_username text, p_show boolean default true) returns void language plpgsql security definer as $$
begin
  insert into auth.users (id, email) values (tt.gu(n), 'g' || n || '@x.cz');
  insert into public.profiles (id, role, email, username, show_in_leaderboard) values (tt.gu(n), 'uživatel', 'g' || n || '@x.cz', p_username, p_show);
end $$;
-- Vrátí výsledek volání jako jsonb (zjednodušuje porovnání).
create or replace function tt.rep(n int, g text, s text, v bigint) returns jsonb language plpgsql as $$
begin perform tt.as_gu(n); return public.report_game_record(g, s, v); end $$;
grant execute on all functions in schema tt to public;

-- ===== příprava =====
delete from public.game_records where user_id between tt.gu(0) and tt.gu(899);
delete from public.game_badge_unlocks where user_id between tt.gu(0) and tt.gu(899);
delete from public.profiles where id between tt.gu(0) and tt.gu(899);
delete from auth.users where id between tt.gu(0) and tt.gu(899);
select tt.gmk(1, 'jana');
select tt.gmk(2, 'petr');
select tt.gmk(3, 'ema');
select tt.gmk(4, 'skrytý', false);
select tt.gmk(5, null);
select tt.gmk(6, '   ');
select tt.gmk(7, 'nový');

-- ===== seznam statistik a odznaků =====
select tt.ok((select count(*) from public.game_stat_limits) = 24, 'v seznamu je 24 statistik u šesti her');
select tt.ok((select count(distinct game_id) from public.game_stat_limits) = 6, 'statistiky patří šesti hrám');
select tt.ok((select count(*) from public.game_badge_defs) = 24, 'v seznamu je 24 herních odznaků');
select tt.ok((select sum(xp) from public.game_badge_defs) = 375, 'herní odznaky dohromady dávají 375 XP (méně než úroveň 5 za 506 XP)');
select tt.ok((select count(*) from public.game_badge_defs d where not exists (select 1 from public.game_stat_limits l where l.game_id = d.game_id and l.stat_key = d.stat_key)) = 0, 'každý odznak sedí na existující statistiku');
select tt.ok((select count(*) from public.game_badge_defs d join public.game_stat_limits l using (game_id, stat_key) where d.threshold > l.max_value) = 0, 'práh žádného odznaku není nad věrohodnou mezí statistiky');

-- ===== zápis rekordu =====
select tt.gfails($$select tt.no_user(); select public.report_game_record('rocket', 'score_normal', 100)$$, 'not_authenticated', 'bez přihlášení se rekord nezapíše');
select tt.gfails($$select tt.as_gu(1); select public.report_game_record('rocket', 'score_neznamy', 100)$$, 'unknown_stat', 'neznámá statistika se odmítne');
select tt.gfails($$select tt.as_gu(1); select public.report_game_record('neznama_hra', 'score_normal', 100)$$, 'unknown_stat', 'neznámá hra se odmítne');
select tt.gfails($$select tt.as_gu(1); select public.report_game_record('rocket', 'score_normal', -5)$$, 'invalid_value', 'záporná hodnota se odmítne');
select tt.gfails($$select tt.as_gu(1); select public.report_game_record('rocket', 'score_normal', null)$$, 'invalid_value', 'prázdná hodnota se odmítne');
select tt.ok((tt.rep(1, 'rocket', 'score_normal', 100000001)) = '{"ok": false, "reason": "implausible"}'::jsonb, 'hodnota nad věrohodnou mezí vrátí implausible');
select tt.ok((select count(*) from public.game_records where user_id = tt.gu(1)) = 0, 'a nic se nezapsalo');

select tt.ok((tt.rep(1, 'rocket', 'score_inferno', 900)) = '{"ok": true, "value": 900, "improved": true, "unlocked": [], "xp": 0}'::jsonb, 'první rekord pod prahem: zapsán, bez odznaku');
select tt.ok((tt.rep(1, 'rocket', 'score_inferno', 1500)) = '{"ok": true, "value": 1500, "improved": true, "unlocked": ["rocket_hell"], "xp": 15}'::jsonb, 'rekord přesně na prahu odemkne odznak (15 XP)');
select tt.ok((tt.rep(1, 'rocket', 'score_inferno', 1499)) = '{"ok": true, "value": 1500, "improved": false, "unlocked": [], "xp": 0}'::jsonb, 'nižší hodnota rekord nesníží a nic neodemkne');
select tt.ok((tt.rep(1, 'rocket', 'score_inferno', 1500)) = '{"ok": true, "value": 1500, "improved": false, "unlocked": [], "xp": 0}'::jsonb, 'stejná hodnota se nepočítá jako zlepšení');
select tt.ok((tt.rep(1, 'rocket', 'score_inferno', 5000)) = '{"ok": true, "value": 5000, "improved": true, "unlocked": [], "xp": 0}'::jsonb, 'vyšší hodnota rekord zvedne, odznak už nepřijde podruhé');
select tt.ok((tt.rep(1, 'rocket', 'score_normal', 2499))->'unlocked' = '[]'::jsonb, 'o jedna pod prahem odznak nevznikne');
select tt.ok((tt.rep(1, 'rocket', 'score_normal', 2500))->'unlocked' = '["rocket_ace"]'::jsonb, 'přesně na prahu odznak vznikne');
select tt.ok((tt.rep(1, 'rocket', 'boss_level', 14)) = '{"ok": true, "value": 14, "improved": true, "unlocked": ["rocket_nemesis", "rocket_glitch"], "xp": 40}'::jsonb, 'jedna hodnota může odemknout víc odznaků najednou (od nejnižšího prahu)');
select tt.ok((tt.rep(1, 'chess', 'wins_total', 30)) = '{"ok": true, "value": 30, "improved": true, "unlocked": ["chess_first", "chess_25"], "xp": 15}'::jsonb, 'výhry v šachách: oba odznaky najednou');
select tt.ok((select value from public.game_records where user_id = tt.gu(1) and game_id = 'rocket' and stat_key = 'score_inferno') = 5000, 'v tabulce je nejvyšší hodnota');
select tt.ok((select count(*) from public.game_badge_unlocks where user_id = tt.gu(1)) = 6, 'odemčeno je 6 odznaků');

-- ===== vlastní postup =====
select tt.as_gu(1);
select tt.ok((public.my_game_progress())->'records'->'rocket'->>'score_inferno' = '5000' and (public.my_game_progress())->'records'->'chess'->>'wins_total' = '30', 'my_game_progress vrací rekordy po hrách');
select tt.ok(jsonb_typeof((public.my_game_progress())->'xp') = 'number', 'xp se vrací jako číslo');
select tt.ok(((public.my_game_progress())->>'xp')::int = 15 + 10 + 40 + 15, 'XP je součet odemčených odznaků (hell 15 + ace 10 + nemesis a glitch 40 + šachy 15)');
select tt.ok((public.my_game_progress())->'unlocked' @> '["rocket_hell", "rocket_ace", "chess_25"]'::jsonb and jsonb_array_length((public.my_game_progress())->'unlocked') = 6, 'seznam odemčených odznaků');
select tt.as_gu(7);
select tt.ok((public.my_game_progress()) = '{"records": {}, "unlocked": [], "xp": 0}'::jsonb, 'nový účet má prázdný postup');
select tt.no_user();
select tt.gfails($$select public.my_game_progress()$$, 'not_authenticated', 'bez přihlášení postup nevrátí');

-- ===== XP v žebříčku =====
select tt.rep(2, 'koulovikamosi', 'balls_discovered', 12);   -- 10 + 25
select tt.rep(3, 'chess', 'wins_total', 1);                  -- 5
select tt.rep(4, 'chess', 'expert_wins', 1);                 -- 25, ale účet je skrytý
select tt.as_gu(1);
select tt.ok((select xp from public.game_xp_totals() where user_id = tt.gu(1)) = 80, 'game_xp_totals: XP prvního účtu');
select tt.ok((select xp from public.game_xp_totals() where user_id = tt.gu(2)) = 35, 'game_xp_totals: dva odznaky najednou (10 + 25)');
select tt.ok((select xp from public.game_xp_totals() where user_id = tt.gu(3)) = 5, 'game_xp_totals: jeden odznak');
select tt.ok((select count(*) from public.game_xp_totals() where user_id = tt.gu(4)) = 0, 'skrytý účet v žebříčku XP není');
select tt.ok((select count(*) from public.game_xp_totals() where user_id = tt.gu(7)) = 0, 'účet bez odznaků v žebříčku XP není');
select tt.no_user();
select tt.gfails($$select * from public.game_xp_totals()$$, 'not_authenticated', 'bez přihlášení se XP z žebříčku nevrátí');

-- ===== žebříček statistiky =====
select tt.rep(2, 'rocket', 'score_normal', 9000);
select tt.rep(3, 'rocket', 'score_normal', 9000);   -- stejná hodnota jako účet 2, ale později
select tt.rep(4, 'rocket', 'score_normal', 99000);  -- skrytý
select tt.rep(5, 'rocket', 'score_normal', 1000);   -- bez jména
select tt.rep(6, 'rocket', 'score_normal', 800);    -- jméno z mezer
select tt.as_gu(1);
select tt.ok((select array_agg(coalesce(username, '~') order by ord) from (select username, row_number() over () as ord from public.game_leaderboard('rocket', 'score_normal', 10)) s) = array['petr', 'ema', 'jana', '~', '~']::text[],
  'žebříček: podle hodnoty (petr a ema mají 9000, petr to hlásil dřív), skrytý účet chybí, prázdná jména jsou null');
select tt.ok((select value from public.game_leaderboard('rocket', 'score_normal', 1)) = 9000, 'první v žebříčku má nejvyšší hodnotu (9000)');
select tt.ok((select count(*) from public.game_leaderboard('rocket', 'score_normal', 2)) = 2, 'limit omezí počet řádků');
select tt.ok((select count(*) from public.game_leaderboard('rocket', 'score_normal', 0)) = 1, 'limit 0 se zvedne na 1');
select tt.ok((select count(*) from public.game_leaderboard('rocket', 'score_normal', -7)) = 1, 'záporný limit se zvedne na 1');
select tt.ok((select count(*) from public.game_leaderboard('rocket', 'score_normal', 100000)) = 5, 'velký limit vrátí všechny viditelné (strop je 50)');
select tt.ok((select count(*) from public.game_leaderboard('rocket', 'score_normal')) = 5, 'výchozí limit je 10');
select tt.ok((select count(*) from public.game_leaderboard('chess', 'rating_peak', 10)) = 0, 'statistika bez hlášení má prázdný žebříček');
select tt.gfails($$select * from public.game_leaderboard('rocket', 'score_neznamy', 10)$$, 'unknown_stat', 'neznámá statistika v žebříčku se odmítne');
select tt.no_user();
select tt.gfails($$select * from public.game_leaderboard('rocket', 'score_normal', 10)$$, 'not_authenticated', 'bez přihlášení se žebříček nevrátí');

-- ===== oprávnění =====
select tt.ok(not has_function_privilege('anon', 'public.report_game_record(text, text, bigint)', 'execute'), 'anon nesmí hlásit rekordy');
select tt.ok(not has_function_privilege('anon', 'public.my_game_progress()', 'execute'), 'anon nesmí číst postup');
select tt.ok(not has_function_privilege('anon', 'public.game_xp_totals()', 'execute'), 'anon nesmí číst XP z žebříčku');
select tt.ok(not has_function_privilege('anon', 'public.game_leaderboard(text, text, int)', 'execute'), 'anon nesmí číst žebříček');
select tt.ok(has_function_privilege('authenticated', 'public.report_game_record(text, text, bigint)', 'execute') and has_function_privilege('authenticated', 'public.game_leaderboard(text, text, int)', 'execute'), 'přihlášený smí volat funkce');
select tt.ok(not has_table_privilege('authenticated', 'public.game_records', 'select') and not has_table_privilege('authenticated', 'public.game_badge_unlocks', 'select')
  and not has_table_privilege('authenticated', 'public.game_records', 'insert') and not has_table_privilege('authenticated', 'public.game_badge_defs', 'select'), 'do tabulek nemá přihlášený přímý přístup (jen přes funkce)');
select tt.ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.game_records'::regclass, 'public.game_badge_unlocks'::regclass, 'public.game_badge_defs'::regclass, 'public.game_stat_limits'::regclass)), 'u všech čtyř tabulek je zapnutá RLS');

-- ===== smazání účtu =====
select tt.ok((select count(*) from public.game_records where user_id = tt.gu(3)) = 2, 'účet 3 má dva rekordy před smazáním');
delete from public.profiles where id = tt.gu(3);
select tt.ok((select count(*) from public.game_records where user_id = tt.gu(3)) = 0 and (select count(*) from public.game_badge_unlocks where user_id = tt.gu(3)) = 0, 'po smazání účtu zmizí i jeho rekordy a odznaky');

-- ===== znovuspuštění souboru srovná seznam =====
-- Odznak, který ze seznamu zmizel (tady vymyšlený), se i s odemčením smaže; ostatní zůstanou a nic se nezmění.
select tt.gsnap() as before_rerun \gset
insert into public.game_badge_defs (badge_id, game_id, stat_key, threshold, xp) values ('zz_zrusen', 'rocket', 'score_blitz', 1, 99);
insert into public.game_badge_unlocks (user_id, badge_id) values (tt.gu(1), 'zz_zrusen');
update public.game_stat_limits set max_value = 5 where game_id = 'chess' and stat_key = 'bots_unlocked';
update public.game_badge_defs set xp = 1 where badge_id = 'rocket_ace';
\ir ../game-records.sql
select tt.ok(not exists (select 1 from public.game_badge_defs where badge_id = 'zz_zrusen') and not exists (select 1 from public.game_badge_unlocks where badge_id = 'zz_zrusen'), 'odznak mimo seznam zmizel i s odemčením');
select tt.ok((select xp from public.game_badge_defs where badge_id = 'rocket_ace') = 10, 'změněná hodnota XP se vrátila podle souboru');
select tt.ok((select count(*) from public.game_badge_defs) = 24 and (select count(*) from public.game_stat_limits) = 24, 'seznamy mají zase 24 a 24 položek');
select tt.ok(tt.gsnap() = :'before_rerun', 'rekordy a odemčené odznaky všech ostatních zůstaly beze změny');
select tt.as_gu(1);
select tt.ok(((public.my_game_progress())->>'xp')::int = 80, 'XP účtu 1 je po novém spuštění stejné (80)');
select tt.no_user();
