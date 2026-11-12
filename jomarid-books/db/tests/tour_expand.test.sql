-- SQL testy db/tour-expand.sql (velké rozšíření prohlídky appky): na zkušební tabulce site_settings ověří, že SQL nahradí kroky novými, zachová zapnutí a počet dní,
-- zvýší verzi jen při skutečné změně, zálohuje původní prohlídku jen poprvé, nesahá na jiné klíče a jde spustit víckrát.
-- Spouští se přes db/tests/run.sh (psql -v tour_sql=<cesta k db/tour-expand.sql>); potřebuje jen tabulku site_settings, tu si založí sám.
\set ON_ERROR_STOP on
create schema if not exists tt;
create table public.site_settings (key text primary key, value jsonb);   -- mock_schema.sql ji nemá; na konci se zase smaže, ať neovlivní další testy
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
create or replace function tt.tour() returns jsonb language sql as $$ select value from public.site_settings where key = 'onboarding_tour' $$;
create or replace function tt.backup() returns jsonb language sql as $$ select value from public.site_settings where key = 'onboarding_tour_before_expand' $$;
create or replace function tt.n(p_set text) returns int language sql as $$ select jsonb_array_length(tt.tour() -> 'sets' -> p_set) $$;

insert into public.site_settings values ('push_vapid_public', '{"key":"abc"}'), ('home_texts', '{"hero":"Ahoj"}');

-- ===== 1) v databázi prohlídka vůbec není (nikdy se neukládala z administrace) =====
\i :tour_sql
select tt.ok(tt.tour() is not null, 'bez původní prohlídky se řádek založí');
select tt.ok((tt.tour() ->> 'version')::int = 2 and (tt.tour() ->> 'enabled') = 'true' and (tt.tour() ->> 'autoDays')::int = 14, 'bez původní prohlídky: zapnuto, výchozích 14 dní, verze 2 (aby ji znovu uviděli ti, co viděli výchozí z kódu)');
select tt.ok(tt.backup() is null, 'bez původní prohlídky se nic nezálohuje');
select tt.ok(tt.n('reader') > 30 and tt.n('publisher') > 30 and tt.n('admin') > 30, 'všechny tři sady mají přes 30 kroků (původní měly 10, 9 a 11)');

-- ===== 2) tvar každého kroku =====
select tt.ok(not exists (
  select 1 from jsonb_each(tt.tour() -> 'sets') s, jsonb_array_elements(s.value) st
  where jsonb_typeof(st -> 'id') <> 'string' or coalesce(st ->> 'id', '') = '' or length(st ->> 'id') > 40
     or jsonb_typeof(st -> 'enabled') <> 'boolean' or jsonb_typeof(st -> 'anchor') <> 'string'
     or coalesce(st ->> 'title', '') = '' or length(st ->> 'title') > 80
     or coalesce(st ->> 'text', '') = '' or length(st ->> 'text') > 700
), 'každý krok má id, enabled, anchor, titulek (do 80 znaků) a text (do 700 znaků)');
select tt.ok(not exists (
  select 1 from jsonb_each(tt.tour() -> 'sets') s where jsonb_array_length(s.value) > 60
), 'žádná sada nepřesahuje limit 60 kroků');
select tt.ok(not exists (
  select 1 from jsonb_each(tt.tour() -> 'sets') s, jsonb_array_elements(s.value) st
  group by s.key, st ->> 'id' having count(*) > 1
), 'id kroků jsou v každé sadě jedinečná');
select tt.ok((select count(*) from jsonb_object_keys(tt.tour() -> 'sets')) = 3, 'sady jsou právě tři: čtenář, nakladatel, správce');
select tt.ok(not exists (select 1 from jsonb_array_elements(tt.tour() -> 'sets' -> 'reader') st where st ->> 'anchor' = 'admin-tabs'), 'čtenář nemá kroky ze správy');
select tt.ok(exists (select 1 from jsonb_array_elements(tt.tour() -> 'sets' -> 'admin') st where st ->> 'anchor' = 'admin-tabs'), 'správce má kroky k záložkám administrace');

-- ===== 3) původní prohlídka (verze 1, 1 den, zapnuto) =====
delete from public.site_settings where key in ('onboarding_tour', 'onboarding_tour_before_expand');
insert into public.site_settings values ('onboarding_tour', jsonb_build_object('enabled', true, 'version', 1, 'autoDays', 1, 'sets', jsonb_build_object(
  'reader', jsonb_build_array(jsonb_build_object('id', 'welcome', 'enabled', true, 'anchor', 'none', 'title', 'Vítej', 'text', 'Starý text.')),
  'publisher', jsonb_build_array(jsonb_build_object('id', 'welcome', 'enabled', true, 'anchor', 'none', 'title', 'Vítej', 'text', 'Starý text.')),
  'admin', jsonb_build_array(jsonb_build_object('id', 'welcome', 'enabled', true, 'anchor', 'none', 'title', 'Vítej', 'text', 'Starý text.')))));
create temp table tt_before as select tt.tour() as v;
\i :tour_sql
select tt.ok((tt.tour() ->> 'version')::int = 2, 'ze starého řádku verze 1 se udělá verze 2 (prohlídka se znovu ukáže)');
select tt.ok((tt.tour() ->> 'autoDays')::int = 1 and (tt.tour() ->> 'enabled') = 'true', 'počet dní nového účtu (1) i zapnutí zůstaly');
select tt.ok(tt.n('reader') > 30 and tt.n('publisher') > 30 and tt.n('admin') > 30, 'sady jsou nové a velké');
select tt.ok(tt.backup() = (select v from tt_before), 'záloha je přesně původní prohlídka');
select tt.ok((select count(*) from public.site_settings) = 4, 'přibyl jen řádek se zálohou (a existující klíče se nezdvojily)');
select tt.ok((select value from public.site_settings where key = 'push_vapid_public') = '{"key":"abc"}'::jsonb and (select value from public.site_settings where key = 'home_texts') = '{"hero":"Ahoj"}'::jsonb, 'jiné klíče v nastavení zůstaly beze změny');

-- ===== 4) podruhé: stejný obsah, nic se nemění =====
create temp table tt_after1 as select tt.tour() as v, tt.backup() as b;
\i :tour_sql
select tt.ok(tt.tour() = (select v from tt_after1), 'druhé spuštění nezmění prohlídku ani verzi');
select tt.ok(tt.backup() = (select b from tt_after1), 'druhé spuštění nepřepíše zálohu (je pořád původní prohlídka, ne ta nová)');
\i :tour_sql
select tt.ok((tt.tour() ->> 'version')::int = 2, 'ani po třetím spuštění verze neroste');

-- ===== 5) vypnutá prohlídka, vlastní počet dní, vyšší verze =====
delete from public.site_settings where key in ('onboarding_tour', 'onboarding_tour_before_expand');
insert into public.site_settings values ('onboarding_tour', '{"enabled":false,"version":5,"autoDays":30,"sets":{"reader":[{"id":"a","enabled":true,"anchor":"none","title":"A","text":"B"}]}}');
\i :tour_sql
select tt.ok((tt.tour() ->> 'enabled') = 'false', 'vypnutá prohlídka zůstane vypnutá (správce ji vypnul záměrně)');
select tt.ok((tt.tour() ->> 'autoDays')::int = 30 and (tt.tour() ->> 'version')::int = 6, 'vlastní počet dní zůstane, verze 5 se zvýší na 6');
select tt.ok(tt.n('reader') > 30 and tt.n('publisher') > 30, 'chybějící sada (nakladatel, správce) se doplní, čtenářská nahradí');

-- ===== 6) zadaná sada beze změny: stejný obsah už v databázi je =====
delete from public.site_settings where key = 'onboarding_tour_before_expand';
update public.site_settings set value = jsonb_set(value, '{version}', '7') where key = 'onboarding_tour';
\i :tour_sql
select tt.ok((tt.tour() ->> 'version')::int = 7, 'když už je v databázi přesně nový obsah, verze se nezvýší');
select tt.ok(tt.backup() is not null, 'záloha se vytvoří, i když se obsah nemění (poprvé)');

-- ===== 7) poškozená verze a strop verze =====
delete from public.site_settings where key in ('onboarding_tour', 'onboarding_tour_before_expand');
insert into public.site_settings values ('onboarding_tour', '{"enabled":true,"version":"abc","autoDays":3,"sets":{}}');
\i :tour_sql
select tt.ok((tt.tour() ->> 'version')::int = 2, 'nečíselná verze se bere jako 1, výsledek 2');
update public.site_settings set value = jsonb_set(value, '{version}', '9999') where key = 'onboarding_tour';
update public.site_settings set value = jsonb_set(value, '{sets,reader,0,title}', '"Změněno"') where key = 'onboarding_tour';
\i :tour_sql
select tt.ok((tt.tour() ->> 'version')::int = 9999, 'verze nepřeroste strop 9999 (víc by appka nepřijala)');

-- ===== 8) úklid =====
drop table tt_before; drop table tt_after1;
drop table public.site_settings;
