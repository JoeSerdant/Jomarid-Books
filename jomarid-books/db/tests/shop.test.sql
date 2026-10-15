-- SQL testy obchůdku (db/shop.sql): nákup za mince, požadovaný herní odznak, nasazení a sundání, tituly v žebříčku, oprávnění a znovuspuštění souboru.
-- Spouští se přes db/tests/run.sh po game_records.test.sql (potřebuje mock_schema.sql, db/game-records.sql a db/shop.sql).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
-- Účty tohoto testu mají čísla od 300 (id ...0301 a výš), ať se nepletou s ostatními testy.
create or replace function tt.su(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((300 + n)::text, 12, '0'))::uuid $$;
create or replace function tt.as_su(n int) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', tt.su(n)::text, false); end $$;
create or replace function tt.no_user() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
create or replace function tt.smk(n int, p_username text, p_coins bigint, p_show boolean default true) returns void language plpgsql security definer as $$
begin
  insert into auth.users (id, email) values (tt.su(n), 's' || n || '@x.cz');
  insert into public.profiles (id, role, email, username, coins, show_in_leaderboard) values (tt.su(n), 'uživatel', 's' || n || '@x.cz', p_username, p_coins, p_show);
end $$;
create or replace function tt.coins(n int) returns bigint language sql security definer as $$ select coins from public.profiles where id = tt.su(n) $$;
-- Otisk všeho, co nákup mění (po selhání se nesmí změnit nic).
create or replace function tt.ssnap() returns text language sql security definer as $$
  select md5(concat_ws('|',
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id, t.item_id), '[]') from public.user_cosmetics t)::text,
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id, t.kind), '[]') from public.user_equipped t)::text,
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id, t.source_type, t.created_at), '[]') from public.coin_transactions t)::text,
    (select coalesce(jsonb_agg(jsonb_build_array(t.id, t.coins) order by t.id), '[]') from public.profiles t)::text)) $$;
create or replace function tt.sfails(q text, p_code text, msg text) returns void language plpgsql as $$
declare before_state text := tt.ssnap();
begin
  begin
    execute q;
  exception when others then
    if sqlerrm <> p_code and sqlstate <> p_code then raise exception 'SELÁHALO: % (čekalo se %, přišlo %)', msg, p_code, sqlerrm; end if;
    if tt.ssnap() is distinct from before_state then raise exception 'SELÁHALO: % (selhání něco změnilo)', msg; end if;
    raise notice 'OK   %', msg;
    return;
  end;
  raise exception 'SELÁHALO: % (nic nevyhodilo)', msg;
end $$;
create or replace function tt.buy(n int, p_item text) returns jsonb language plpgsql as $$ begin perform tt.as_su(n); return public.buy_cosmetic(p_item); end $$;
create or replace function tt.equip(n int, p_kind text, p_item text) returns jsonb language plpgsql as $$ begin perform tt.as_su(n); return public.equip_cosmetic(p_kind, p_item); end $$;
create or replace function tt.mine(n int) returns jsonb language plpgsql as $$ begin perform tt.as_su(n); return public.my_cosmetics(); end $$;
create or replace function tt.titles(n int, p_ids uuid[]) returns jsonb language plpgsql as $$
begin perform tt.as_su(n); return coalesce((select jsonb_object_agg(user_id::text, item_id) from public.equipped_titles(p_ids)), '{}'::jsonb); end $$;
create or replace function tt.srep(n int, g text, s text, v bigint) returns jsonb language plpgsql as $$ begin perform tt.as_su(n); return public.report_game_record(g, s, v); end $$;
create or replace function tt.ledger(n int) returns jsonb language sql security definer as $$
  select coalesce(jsonb_agg(jsonb_build_array(source_type, amount) order by created_at, source_type), '[]'::jsonb) from public.coin_transactions where user_id = tt.su(n) $$;
grant execute on all functions in schema tt to public;

-- ===== příprava =====
delete from public.profiles where id between tt.su(0) and tt.su(899);
delete from auth.users where id between tt.su(0) and tt.su(899);
select tt.smk(1, 'Eva', 500);          -- dost mincí, bez odznaků
select tt.smk(2, 'Petr', 99);          -- o minci míň než nejlevnější zboží
select tt.smk(3, 'Jana', 1000);        -- dostane odznak za Rocket
select tt.smk(4, 'Ema', 0);            -- bez mincí
select tt.smk(5, 'Skrytý', 1000, false);
select tt.smk(6, null, 1000);          -- bez uživatelského jména
select tt.smk(7, 'Pavel', 100);        -- přesně na nejlevnější zboží

-- ===== zboží =====
select tt.ok((select count(*) from public.shop_items) = 18 and (select count(*) from public.shop_items where kind = 'title') = 12 and (select count(*) from public.shop_items where kind = 'gamefx') = 6, 'v obchůdku je 12 titulů a 6 vzhledů her');
select tt.ok((select count(*) from public.shop_items where active) = 18, 'všechno zboží se prodává');
select tt.ok(not exists (select 1 from public.shop_items where requires_badge is not null and requires_badge not in (select badge_id from public.game_badge_defs)), 'každý požadovaný odznak opravdu existuje mezi herními odznaky');
select tt.ok(not exists (select 1 from public.shop_items where kind = 'gamefx' and requires_badge is not null), 'vzhledy her se nekoupí za odznak, jen za mince');
select tt.ok(not exists (select 1 from public.shop_items where price < 100 or price > 400), 'ceny jsou od 100 do 400 mincí (jako kniha nebo Streak Freeze)');

-- ===== bez přihlášení =====
select tt.no_user();
select tt.sfails($$select public.buy_cosmetic('title_bookworm')$$, 'not_authenticated', 'nákup bez přihlášení se odmítne');
select tt.sfails($$select public.equip_cosmetic('title', 'title_bookworm')$$, 'not_authenticated', 'nasazení bez přihlášení se odmítne');
select tt.sfails($$select public.my_cosmetics()$$, 'not_authenticated', 'výpis vlastního zboží bez přihlášení se odmítne');
select tt.sfails($$select * from public.equipped_titles(array[tt.su(1)])$$, 'not_authenticated', 'tituly v žebříčku bez přihlášení se odmítnou');

-- ===== nákup =====
select tt.ok(tt.mine(1) = '{"owned": [], "equipped": {}}'::jsonb, 'nový čtenář nemá nic koupené ani nasazené');
select tt.ok(tt.buy(1, 'title_bookworm') = '{"ok": true, "item_id": "title_bookworm", "kind": "title", "new_balance": 400}'::jsonb, 'nákup titulu za 100 vrátí nový zůstatek 400');
select tt.ok(tt.coins(1) = 400, 'zůstatek v profilu je opravdu 400');
select tt.ok(tt.ledger(1) = '[["cosmetic_purchase:title_bookworm", -100]]'::jsonb, 'v deníku mincí je jeden záporný zápis s označením zboží');
select tt.ok((select price_paid from public.user_cosmetics where user_id = tt.su(1) and item_id = 'title_bookworm') = 100, 'u koupeného kusu je uložená zaplacená cena');
select tt.ok(tt.mine(1) = '{"owned": ["title_bookworm"], "equipped": {"title": "title_bookworm"}}'::jsonb, 'koupený titul je rovnou nasazený');
select tt.sfails($$select tt.buy(1, 'title_bookworm')$$, 'already_owned', 'stejné zboží podruhé koupit nejde');
select tt.ok(tt.coins(1) = 400, 'druhý pokus nestrhl žádné mince');

select tt.ok(tt.buy(1, 'gamefx_noir')->>'new_balance' = '150', 'vzhled her za 250 strhne mince a zbyde 150');
select tt.ok(tt.mine(1) = '{"owned": ["title_bookworm", "gamefx_noir"], "equipped": {"title": "title_bookworm", "gamefx": "gamefx_noir"}}'::jsonb, 'titul a vzhled her jsou nasazené zároveň');
select tt.ok(tt.ledger(1) = '[["cosmetic_purchase:title_bookworm", -100], ["cosmetic_purchase:gamefx_noir", -250]]'::jsonb, 'deník mincí má oba nákupy ve správném pořadí');
select tt.ok((select 500 + coalesce(sum(amount), 0) from public.coin_transactions where user_id = tt.su(1)) = tt.coins(1), 'počáteční zůstatek plus deník mincí dává aktuální zůstatek');

-- málo mincí
select tt.sfails($$select tt.buy(2, 'title_bookworm')$$, 'insufficient_coins', 'o minci míň, než zboží stojí: nákup se odmítne');
select tt.sfails($$select tt.buy(4, 'gamefx_noir')$$, 'insufficient_coins', 'bez mincí nejde koupit nic');
select tt.ok(tt.buy(7, 'title_bookworm')->>'new_balance' = '0', 'přesně tolik mincí, kolik zboží stojí: nákup projde a zůstatek je nula');
select tt.ok(tt.coins(7) = 0 and tt.mine(7)->'owned' = '["title_bookworm"]'::jsonb, 'zůstatek nula a zboží je koupené');

-- zboží, které neexistuje nebo se neprodává
select tt.sfails($$select tt.buy(1, 'nope')$$, 'unknown_item', 'neexistující zboží nejde koupit');
select tt.sfails($$select tt.buy(1, null)$$, 'unknown_item', 'nákup bez určení zboží se odmítne');
update public.shop_items set active = false where item_id = 'title_night';
select tt.sfails($$select tt.buy(1, 'title_night')$$, 'unknown_item', 'zboží, které se přestalo prodávat, nejde koupit');
update public.shop_items set active = true where item_id = 'title_night';
select tt.ok(tt.buy(1, 'title_night')->>'new_balance' = '30', 'po obnovení prodeje nákup projde (150 - 120 = 30)');

-- tituly za herní odznaky
select tt.sfails($$select tt.buy(3, 'title_pilot')$$, 'locked', 'titul za herní odznak bez toho odznaku nejde koupit, i když mincí je dost');
select tt.sfails($$select tt.buy(4, 'title_pilot')$$, 'locked', 'bez odznaku i bez mincí vyjde důvod "locked", ne "málo mincí"');
select tt.ok(tt.srep(3, 'rocket', 'score_normal', 2500)->>'ok' = 'true', 'Jana získá v Rocketu 2 500 bodů (odznak Eso hvězd)');
select tt.ok(tt.buy(3, 'title_pilot')->>'new_balance' = '850', 'po odznaku Eso hvězd jde koupit titul Pilot (1000 - 150)');
select tt.sfails($$select tt.buy(3, 'title_hellrider')$$, 'locked', 'jiný titul s jiným odznakem je pořád zamčený');
select tt.ok(tt.srep(2, 'rocket', 'score_normal', 2500)->>'ok' = 'true', 'Petr také získá odznak Eso hvězd');
select tt.sfails($$select tt.buy(2, 'title_pilot')$$, 'insufficient_coins', 'odznak je, ale mincí je málo: důvod je "málo mincí"');
select tt.ok(tt.coins(2) = 99, 'Petrovi se nic nestrhlo');

-- ===== nasazení a sundání =====
select tt.ok(tt.mine(1)->'equipped' = '{"title": "title_night", "gamefx": "gamefx_noir"}'::jsonb, 'poslední koupený titul nahradil předchozí, vzhled her zůstal');
select tt.ok(tt.mine(1)->'owned' = '["title_bookworm", "gamefx_noir", "title_night"]'::jsonb, 'dřívější titul pořád patří Evě');
select tt.ok(tt.equip(1, 'title', 'title_bookworm') = '{"ok": true, "kind": "title", "item_id": "title_bookworm"}'::jsonb, 'dřívější titul jde zase nasadit');
select tt.ok(tt.mine(1)->'equipped'->>'title' = 'title_bookworm', 'nasazený je zase Knihomol');
select tt.sfails($$select tt.equip(1, 'title', 'title_pilot')$$, 'not_owned', 'nenakoupený titul nejde nasadit');
select tt.sfails($$select tt.equip(1, 'title', 'gamefx_noir')$$, 'wrong_kind', 'vzhled her nejde nasadit jako titul');
select tt.sfails($$select tt.equip(1, 'gamefx', 'title_bookworm')$$, 'wrong_kind', 'titul nejde nasadit jako vzhled her');
select tt.sfails($$select tt.equip(1, 'frame', 'title_bookworm')$$, 'invalid_kind', 'neznámá skupina se odmítne');
select tt.sfails($$select tt.equip(1, null, 'title_bookworm')$$, 'invalid_kind', 'chybějící skupina se odmítne');
select tt.sfails($$select tt.equip(2, 'title', 'title_bookworm')$$, 'not_owned', 'cizí zboží nejde nasadit (Petr nic nekoupil)');
select tt.ok(tt.equip(1, 'gamefx', null) = '{"ok": true, "kind": "gamefx", "item_id": null}'::jsonb, 'vzhled her jde sundat');
select tt.ok(tt.mine(1) = '{"owned": ["title_bookworm", "gamefx_noir", "title_night"], "equipped": {"title": "title_bookworm"}}'::jsonb, 'po sundání zbylo nasazený jen titul a zboží pořád patří Evě');
select tt.ok((tt.equip(1, 'gamefx', null))->>'ok' = 'true', 'sundání, když nic nasazené není, nevadí');
select tt.ok(tt.equip(1, 'gamefx', 'gamefx_noir')->>'ok' = 'true' and tt.mine(1)->'equipped'->>'gamefx' = 'gamefx_noir', 'sundaný vzhled her jde znovu nasadit bez dalšího placení');
select tt.ok(tt.coins(1) = 30, 'nasazování a sundávání nestojí mince');

-- ===== tituly v žebříčku =====
select tt.ok(tt.buy(5, 'title_collector')->>'ok' = 'true' and tt.buy(6, 'title_bookworm')->>'ok' = 'true', 'Skrytý i Bez-jména si koupí titul');
select tt.ok(tt.titles(2, array[tt.su(1), tt.su(3), tt.su(5), tt.su(6), tt.su(2)])
  = jsonb_build_object(tt.su(1)::text, 'title_bookworm', tt.su(3)::text, 'title_pilot', tt.su(6)::text, 'title_bookworm'),
  'žebříček dostane tituly jen těch, kdo smějí být vidět, a jen tituly (ne vzhled her): skrytý a bez titulu chybí');
select tt.ok(tt.titles(2, array[tt.su(1)]) = jsonb_build_object(tt.su(1)::text, 'title_bookworm'), 'vrátí jen ty, na které se ptám');
select tt.ok(tt.titles(2, '{}'::uuid[]) = '{}'::jsonb and tt.titles(2, null) = '{}'::jsonb, 'prázdný seznam i null vrátí nic');
update public.profiles set show_in_leaderboard = null where id = tt.su(5);
select tt.ok(tt.titles(2, array[tt.su(5)]) = jsonb_build_object(tt.su(5)::text, 'title_collector'), 'nevyplněné nastavení žebříčku znamená, že titul vidět je (jako u ostatních žebříčků)');
update public.profiles set show_in_leaderboard = false where id = tt.su(5);
select tt.ok(tt.titles(2, array[tt.su(5)]) = '{}'::jsonb, 'po vypnutí viditelnosti titul zmizí');
select tt.ok(tt.mine(5)->'equipped'->>'title' = 'title_collector', 'skrytý čtenář svůj titul pořád vidí a má ho nasazený');
select tt.equip(1, 'title', null);
select tt.ok(tt.titles(2, array[tt.su(1)]) = '{}'::jsonb, 'sundaný titul se v žebříčku neukáže');
select tt.sfails($$select * from public.equipped_titles((select array_agg(gen_random_uuid()) from generate_series(1, 1001)))$$, 'too_many', 'víc než 1000 lidí najednou se odmítne');

-- ===== oprávnění =====
select tt.ok(not has_function_privilege('anon', 'public.buy_cosmetic(text)', 'execute')
  and not has_function_privilege('anon', 'public.equip_cosmetic(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.my_cosmetics()', 'execute')
  and not has_function_privilege('anon', 'public.equipped_titles(uuid[])', 'execute'), 'nepřihlášený návštěvník nesmí volat žádnou funkci obchůdku');
select tt.ok(has_function_privilege('authenticated', 'public.buy_cosmetic(text)', 'execute')
  and has_function_privilege('authenticated', 'public.equip_cosmetic(text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.my_cosmetics()', 'execute')
  and has_function_privilege('authenticated', 'public.equipped_titles(uuid[])', 'execute'), 'přihlášený čtenář funkce volat smí');
select tt.ok(not exists (select 1 from unnest(array['public.shop_items', 'public.user_cosmetics', 'public.user_equipped']) t
  where has_table_privilege('authenticated', t, 'select') or has_table_privilege('authenticated', t, 'insert') or has_table_privilege('authenticated', t, 'update')
     or has_table_privilege('authenticated', t, 'delete') or has_table_privilege('anon', t, 'select')), 'klienti nesmí sahat do tabulek obchůdku přímo');
select tt.ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.shop_items'::regclass, 'public.user_cosmetics'::regclass, 'public.user_equipped'::regclass)), 'na tabulkách obchůdku je zapnutá ochrana řádků');
select tt.ok(not exists (select 1 from pg_proc where proname in ('buy_cosmetic', 'equip_cosmetic', 'my_cosmetics', 'equipped_titles') and pronamespace = 'public'::regnamespace and not prosecdef), 'všechny funkce obchůdku běží s právy vlastníka (security definer)');

-- ===== znovuspuštění souboru =====
update public.shop_items set price = 1, label = 'Rozbité', requires_badge = null where item_id = 'title_hellrider';
insert into public.shop_items (item_id, kind, label, price) values ('title_old', 'title', 'Starý titul', 100);
select tt.ok(tt.buy(6, 'title_old')->>'new_balance' = '800', 'Bez-jména koupí kus, který se brzy přestane prodávat (900 - 100)');
create temp table before_rerun as select (select coins from public.profiles where id = tt.su(1)) c1, (select count(*) from public.user_cosmetics) uc, (select count(*) from public.user_equipped) ue, (select count(*) from public.coin_transactions) ct;
\ir ../shop.sql
select tt.ok((select price from public.shop_items where item_id = 'title_hellrider') = 250 and (select requires_badge from public.shop_items where item_id = 'title_hellrider') = 'rocket_hell'
  and (select label from public.shop_items where item_id = 'title_hellrider') = 'Pán pekel', 'po novém spuštění se cena, název i požadovaný odznak zboží srovnají se seznamem');
select tt.ok((select count(*) from public.shop_items where active) = 18, 'zboží ze seznamu se prodává dál');
select tt.ok((select active from public.shop_items where item_id = 'title_old') = false, 'zboží, které ze seznamu zmizelo, se přestalo prodávat, ale nesmazalo se');
select tt.sfails($$select tt.buy(7, 'title_old')$$, 'unknown_item', 'staré zboží už nikdo další nekoupí');
select tt.ok(tt.mine(6)->'owned' = '["title_bookworm", "title_old"]'::jsonb and tt.mine(6)->'equipped'->>'title' = 'title_old', 'kdo ho koupil, ho má dál (i nasazené)');
select tt.ok((select (c1 = (select coins from public.profiles where id = tt.su(1)) and uc = (select count(*) from public.user_cosmetics) and ue = (select count(*) from public.user_equipped) and ct = (select count(*) from public.coin_transactions)) from before_rerun), 'nové spuštění nezměnilo žádný nákup, nasazení ani zůstatek');
drop table before_rerun;

-- ===== smazání účtu =====
select tt.ok(exists (select 1 from public.user_cosmetics where user_id = tt.su(6)) and exists (select 1 from public.user_equipped where user_id = tt.su(6)), 'před smazáním má Bez-jména zboží i nasazení');
delete from public.profiles where id = tt.su(6);
select tt.ok(not exists (select 1 from public.user_cosmetics where user_id = tt.su(6)) and not exists (select 1 from public.user_equipped where user_id = tt.su(6)), 'smazáním profilu zmizí i jeho zboží a nasazení');
