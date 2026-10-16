-- SQL testy Jomarid Coinů z her (db/game-coins.sql): strop na hru a den, strop ze všech her, nová hra Kouloví Kámoši, hranice, dny, zápis do deníku a zůstatek připsaný přesně jednou.
-- Spouští se přes db/tests/run.sh po game_saves.test.sql (potřebuje mock_schema.sql, ve kterém je dosavadní award_game_coins, a db/game-coins.sql, který ji nahradil).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
-- Účty tohoto testu mají čísla od 700 (id ...0701 a výš), ať se nepletou s ostatními testy.
create or replace function tt.cu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((700 + n)::text, 12, '0'))::uuid $$;
create or replace function tt.as_cu(n int) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', tt.cu(n)::text, false); end $$;
create or replace function tt.no_user() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
create or replace function tt.cmk(n int, p_coins bigint default 0) returns void language plpgsql security definer as $$
begin
  insert into auth.users (id, email) values (tt.cu(n), 'c' || n || '@x.cz');
  insert into public.profiles (id, role, email, username, coins) values (tt.cu(n), 'uživatel', 'c' || n || '@x.cz', 'Coin' || n, p_coins);
end $$;
-- Žádost hry o Coiny jako přihlášený účet n; vrací odpověď serveru.
create or replace function tt.aw(n int, g text, amt int, why text default 'event') returns jsonb language plpgsql as $$ begin perform tt.as_cu(n); return public.award_game_coins(g, amt, why); end $$;
create or replace function tt.granted(n int, g text, amt int) returns int language sql as $$ select (tt.aw(n, g, amt)->>'granted')::int $$;
create or replace function tt.capped(r jsonb) returns boolean language sql immutable as $$ select (r->>'capped')::boolean $$;
-- Součet Coinů zapsaných z her dnes (UTC): všech, nebo jen jedné hry.
create or replace function tt.earned(n int, g text default null) returns bigint language sql security definer as $$
  select coalesce(sum(amount), 0) from public.coin_transactions
  where user_id = tt.cu(n) and starts_with(source_type, 'game_event:' || coalesce(g || ':', '')) and split_part(source_type, ':', 3) = ((now() at time zone 'utc')::date)::text $$;
-- Je v deníku řádek s daným označením? Funkce (ne vložený poddotaz), aby viděla i zápis, který udělalo volání ve stejném příkazu.
create or replace function tt.has_src(n int, pat text) returns boolean language sql security definer as $$ select exists (select 1 from public.coin_transactions where user_id = tt.cu(n) and source_type like pat) $$;
create or replace function tt.coins(n int) returns bigint language sql security definer as $$ select coins from public.profiles where id = tt.cu(n) $$;
create or replace function tt.lifetime(n int) returns bigint language sql security definer as $$ select lifetime_coins_earned from public.profiles where id = tt.cu(n) $$;
-- Otisk všeho, co žádost mění (po odmítnutí se nesmí změnit nic).
create or replace function tt.csnap() returns text language sql security definer as $$
  select md5(concat_ws('|',
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id, t.source_type, t.created_at), '[]') from public.coin_transactions t)::text,
    (select coalesce(jsonb_agg(jsonb_build_array(t.id, t.coins, t.lifetime_coins_earned) order by t.id), '[]') from public.profiles t)::text)) $$;
create or replace function tt.cfails(q text, p_code text, msg text) returns void language plpgsql as $$
declare before_state text := tt.csnap();
begin
  begin
    execute q;
  exception when others then
    if sqlerrm <> p_code and sqlstate <> p_code then raise exception 'SELÁHALO: % (čekalo se %, přišlo %)', msg, p_code, sqlerrm; end if;
    if tt.csnap() is distinct from before_state then raise exception 'SELÁHALO: % (selhání něco změnilo)', msg; end if;
    raise notice 'OK   %', msg;
    return;
  end;
  raise exception 'SELÁHALO: % (nic nevyhodilo)', msg;
end $$;
grant execute on all functions in schema tt to public;

-- ===== příprava =====
delete from public.coin_transactions where user_id between tt.cu(0) and tt.cu(899);
delete from public.profiles where id between tt.cu(0) and tt.cu(899);
delete from auth.users where id between tt.cu(0) and tt.cu(899);
select tt.cmk(1);                -- každá hra jednou
select tt.cmk(2);                -- strop na hru, pak strop ze všech her
select tt.cmk(3);                -- strop ze všech her jen zčásti
select tt.cmk(4);                -- Kouloví Kámoši
select tt.cmk(5);                -- jiné dny
select tt.cmk(6);                -- hranice
select tt.cmk(7);                -- důvody
select tt.cmk(8, 50);            -- chyby a zůstatek

-- ===== kdo smí žádat a co =====
select tt.no_user();
select tt.cfails($$select public.award_game_coins('rocket', 5, 'x')$$, 'not_authenticated', 'bez přihlášení se žádost odmítne');
select tt.as_cu(1);
select tt.cfails($$select public.award_game_coins('nope', 5, 'x')$$, 'invalid_game_id', 'neznámá hra se odmítne');
select tt.cfails($$select public.award_game_coins(null, 5, 'x')$$, 'invalid_game_id', 'žádost bez určení hry se odmítne');
select tt.cfails($$select public.award_game_coins('Rocket', 5, 'x')$$, 'invalid_game_id', 'id hry se píše přesně (velká písmena neprojdou)');
select tt.cfails($$select public.award_game_coins('rocket', 0, 'x')$$, 'invalid_amount', 'nulová částka se odmítne');
select tt.cfails($$select public.award_game_coins('rocket', -5, 'x')$$, 'invalid_amount', 'záporná částka se odmítne (hra Coiny nemůže brát)');
select tt.cfails($$select public.award_game_coins('rocket', null, 'x')$$, 'invalid_amount', 'chybějící částka se odmítne');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000999', false);
select tt.cfails($$select public.award_game_coins('rocket', 5, 'x')$$, 'profile_not_found', 'účet bez profilu Coiny nedostane');
select tt.ok((select count(*) from public.coin_transactions where user_id between tt.cu(0) and tt.cu(899)) = 0, 'žádné odmítnuté žádosti nic nezapsaly');

-- ===== všech šest her smí žádat =====
select tt.ok(tt.granted(1, 'rocket', 1) = 1, 'Rocket Game: žádost projde');
select tt.ok(tt.granted(1, 'warroom', 1) = 1, 'Warroom: žádost projde');
select tt.ok(tt.granted(1, 'cityclicker', 1) = 1, 'City Clicker: žádost projde');
select tt.ok(tt.granted(1, 'polygonarena', 1) = 1, 'Polygon Aréna: žádost projde');
select tt.ok(tt.granted(1, 'chess', 1) = 1, 'Šachy: žádost projde');
select tt.ok(tt.granted(1, 'koulovikamosi', 1) = 1, 'Kouloví Kámoši: žádost projde (dřív končila chybou invalid_game_id)');
select tt.ok(tt.earned(1) = 6 and tt.lifetime(1) = 6 and tt.coins(1) = 6, 'za šest her je v deníku, v celkově získaných Coinech i na zůstatku přesně 6 (ne dvojnásobek)');

-- ===== strop na jednu hru: 100 za den =====
with r as (select tt.aw(2, 'rocket', 60) j) select tt.ok(r.j = '{"granted": 60, "capped": false, "balance": 60}'::jsonb and tt.coins(2) = 60, 'první žádost na 60 projde celá, není capped a vrácený zůstatek 60 je i skutečný zůstatek v profilu') from r;
with r as (select tt.aw(2, 'rocket', 60) j) select tt.ok(r.j->>'granted' = '40' and tt.capped(r.j) and (r.j->>'balance')::bigint = 100 and tt.coins(2) = 100, 'druhá žádost na 60 se ořízne na zbývajících 40, je capped a zůstatek je 100') from r;
select tt.ok(tt.earned(2, 'rocket') = 100, 'z Rocketu je za den přesně 100 (strop je 100, ne dosavadních 75)');
select tt.ok((select count(*) from public.coin_transactions where user_id = tt.cu(2) and source_type like 'game_event:rocket:%:2:%' and amount = 40) = 1, 'druhá žádost se zapsala jen na zbývajících 40');
with r as (select tt.aw(2, 'rocket', 5) j) select tt.ok(r.j->>'granted' = '0' and tt.capped(r.j) and (r.j->>'balance')::bigint = tt.coins(2), 'po vyčerpání stropu hra nedostane nic (granted 0, capped true, vrácený zůstatek je skutečný) ') from r;
select tt.ok(tt.earned(2, 'rocket') = 100, 'žádost po vyčerpání stropu nic nezapsala');

-- ===== strop na hru se nesčítá přes hry, strop ze všech her je 200 =====
select tt.ok(tt.granted(2, 'warroom', 60) = 60, 'jiná hra má vlastní strop: Warroom dostane 60, i když Rocket je vyčerpaný');
select tt.ok(tt.granted(2, 'warroom', 60) = 40, 'Warroom: druhých 60 se ořízne na zbývajících 40 (strop hry 100)');
select tt.ok(tt.earned(2) = 200 and tt.coins(2) = 200, 'dvě plné hry dávají dohromady 200 (celkový strop za den) a zůstatek je přesně 200');
with r as (select tt.aw(2, 'cityclicker', 10) j) select tt.ok(r.j->>'granted' = '0' and tt.capped(r.j), 'třetí hra nedostane nic: vyčerpaný je celkový strop, i když v ní ten den nic nebylo') from r;
select tt.ok(tt.earned(2) = 200 and tt.earned(2, 'cityclicker') = 0, 'celkem pořád 200, ve City Clickeru nic');

-- celkový strop jen zčásti
select tt.ok(tt.granted(3, 'rocket', 100) = 100, 'účet 3: Rocket 100');
select tt.ok(tt.granted(3, 'warroom', 70) = 70, 'účet 3: Warroom 70, celkem 170');
with r as (select tt.aw(3, 'cityclicker', 60) j) select tt.ok(r.j->>'granted' = '30' and tt.capped(r.j), 'třetí hra dostane jen zbývajících 30 z celkového stropu (200 - 170)') from r;
select tt.ok(tt.granted(3, 'chess', 1) = 0 and tt.earned(3) = 200, 'a čtvrtá hra už nic: celkem 200');

-- ===== Kouloví Kámoši mají vlastní strop jako ostatní hry =====
with r as (select tt.aw(4, 'koulovikamosi', 150) j) select tt.ok(r.j->>'granted' = '100' and tt.capped(r.j), 'Kouloví Kámoši: žádost na 150 se ořízne na 100') from r;
select tt.ok(tt.granted(4, 'koulovikamosi', 1) = 0, 'Kouloví Kámoši: další žádost už nic nedá');
select tt.ok(tt.granted(4, 'chess', 100) = 100, 'jiná hra vedle plných Kouloví Kámošů pořád dává (celkem 200)');
select tt.ok(tt.earned(4) = 200, 'Kouloví Kámoši se počítají do celkového stropu za den');

-- ===== hranice stropu =====
with r as (select tt.aw(6, 'rocket', 100) j) select tt.ok(r.j->>'granted' = '100' and not tt.capped(r.j), 'přesně 100 najednou projde celé a není capped') from r;
with r as (select tt.aw(6, 'rocket', 1) j) select tt.ok(r.j->>'granted' = '0' and tt.capped(r.j), 'o jedna víc už ne') from r;
select tt.ok(tt.granted(6, 'warroom', 1) = 1, 'jiná hra pořád dává (celkem 101 z 200)');

-- ===== jiné dny se nepočítají =====
select tt.cmk(9);
select tt.no_user();   -- zápis do deníku jako ze SQL editoru (spoušť smí upravit zůstatek)
insert into public.coin_transactions (user_id, amount, source_type)
  values (tt.cu(9), 100, 'game_event:rocket:' || ((now() at time zone 'utc')::date - 1)::text || ':1:event'),
         (tt.cu(9), 100, 'game_event:warroom:' || ((now() at time zone 'utc')::date - 1)::text || ':1:event');
select tt.ok(tt.aw(9, 'rocket', 100)->>'granted' = '100', 'včerejší vyčerpaný strop dnes nic neubírá (hra i celkový strop)');
select tt.ok(tt.earned(9) = 100, 'dnes je v deníku jen dnešních 100');

-- ===== zápis do deníku a důvody =====
select tt.ok(tt.aw(7, 'chess', 3, 'win')->>'granted' = '3', 'výhra v šachách: 3');
select tt.ok((select source_type from public.coin_transactions where user_id = tt.cu(7)) = 'game_event:chess:' || ((now() at time zone 'utc')::date)::text || ':1:win', 'deník má označení game_event:<hra>:<den UTC>:<pořadí>:<důvod>');
select tt.ok(tt.aw(7, 'chess', 2, 'gold-en ball!')->>'granted' = '2' and tt.has_src(7, 'game_event:chess:%:2:goldenball'), 'důvod se očistí od nepísmen (gold-en ball! -> goldenball) a pořadí se zvýší');
select tt.ok(tt.aw(7, 'chess', 1, null)->>'granted' = '1' and tt.has_src(7, 'game_event:chess:%:3:event'), 'chybějící důvod je "event"');
select tt.ok(tt.aw(7, 'chess', 1, '!!!')->>'granted' = '1' and tt.has_src(7, 'game_event:chess:%:4:event'), 'důvod jen z nepísmen je "event"');
select tt.ok(tt.aw(7, 'chess', 1, repeat('a', 40))->>'granted' = '1' and tt.has_src(7, 'game_event:chess:%:5:' || repeat('a', 30)), 'dlouhý důvod se zkrátí na 30 znaků');
select tt.ok(tt.earned(7) = 3 + 2 + 1 + 1 + 1, 'deník dává součet všech udělených částek');

-- ===== zůstatek a celkově získané Coiny =====
select tt.ok(tt.aw(8, 'rocket', 10)->>'granted' = '10' and tt.lifetime(8) = 10, 'celkově získané Coiny vzrostly o udělenou částku');
select tt.ok(tt.aw(8, 'rocket', 1000)->>'granted' = '90' and tt.lifetime(8) = 100, 'oříznutá žádost zvýší celkově získané Coiny jen o to, co se udělilo');
select tt.ok((select count(*) from public.coin_transactions where user_id = tt.cu(8)) = 2, 'každé udělení je v deníku jednou');
select tt.ok(tt.coins(8) = 50 + 100, 'zůstatek vzrostl přesně o udělené Coiny (50 + 100 z her), ne o dvojnásobek');
select tt.ok(tt.coins(8) = 50 + tt.earned(8), 'zůstatek = počáteční zůstatek + součet zápisů z her v deníku (obojí se drží pohromadě)');
with r as (select tt.aw(8, 'rocket', 5) j) select tt.ok(r.j->>'granted' = '0' and (r.j->>'balance')::bigint = tt.coins(8) and tt.coins(8) = 150, 'odmítnutá žádost nic nepřipsala a vrací skutečný zůstatek') from r;

-- ===== opakované spuštění souboru =====
select tt.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'award_game_coins') = 1, 'po opakovaném spuštění souboru je jen jedna funkce award_game_coins (žádné přetížení navíc)');
select tt.ok(pg_get_functiondef('public.award_game_coins(text, integer, text)'::regprocedure) ~ 'v_per_game_cap constant integer := 100;' and pg_get_functiondef('public.award_game_coins(text, integer, text)'::regprocedure) ~ 'v_global_cap constant integer := 200;', 've funkci jsou stropy 100 a 200');
select tt.ok((select prosecdef from pg_proc where oid = 'public.award_game_coins(text, integer, text)'::regprocedure), 'funkce běží s právy vlastníka (security definer), jako dřív');
