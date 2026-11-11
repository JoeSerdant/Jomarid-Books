-- SQL testy multiplayeru (db/multiplayer.sql): fronta a párování, tahy a jejich pořadí, hodiny a časové limity, hlášení výsledku, odměny a stropy,
-- závod (City Clicker), týmová hra (Rocket), místnosti pro kamarády, úklid, výhra v Polygon aréně, oprávnění a pravidla Realtime kanálů.
-- Spouští se přes db/tests/run.sh po login_code.test.sql (potřebuje mock_schema.sql a db/multiplayer.sql).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
-- Účty tohoto testu mají čísla od 1000 (id ...1001 a výš), ať se nepletou s ostatními testy.
create or replace function tt.mu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((1000 + n)::text, 12, '0'))::uuid $$;
create or replace function tt.as_mu(n int) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', tt.mu(n)::text, false); end $$;
create or replace function tt.no_user() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
create or replace function tt.mmk(n int, p_coins bigint default 0) returns void language plpgsql security definer as $$
begin
  insert into auth.users (id, email) values (tt.mu(n), 'm' || n || '@x.cz');
  insert into public.profiles (id, role, email, username, coins) values (tt.mu(n), 'uživatel', 'm' || n || '@x.cz', 'Hrac' || n, p_coins);
end $$;
-- Hledání soupeře jako účet n; vrací odpověď serveru.
create or replace function tt.find(n int, g text, m text default 'duel', p jsonb default '{}') returns jsonb language plpgsql as $$ begin perform tt.as_mu(n); return public.mp_find(g, m, p); end $$;
-- Dva účty se spárují; vrací id zápasu. Šachy, Kouloví Kámoši, Warroom a Hannibal se tu zakládají jako zápas ZALOŽENÝ PŘED aktualizací (bez enginu a kontroly tvaru
-- tahů): tahy jsou libovolné a výsledek se hlásí po starém. Díky tomu se tahové mechanismy (pořadí, hodiny, hlášení, odměny) zkouší na těchhle zápasech beze změny
-- a zároveň se ověřuje zpětná kompatibilita. Zápas s pravidly na serveru dělá tt.pair_chess (šachy) a tt.pair_new (ostatní hry).
create or replace function tt.pair_chess(a int, b int, p jsonb default '{}') returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform tt.find(a, 'chess', 'duel', p);
  r := tt.find(b, 'chess', 'duel', p);
  if r ->> 'status' <> 'matched' then raise exception 'SELÁHALO: účty % a % se nespárovaly (%)', a, b, r; end if;
  return (r -> 'match' ->> 'id')::uuid;
end $$;
create or replace function tt.pair(a int, b int, g text, m text default 'duel', p jsonb default '{}') returns uuid language plpgsql as $$
declare r jsonb; v_id uuid;
begin
  perform tt.find(a, g, m, p);
  r := tt.find(b, g, m, p);
  if r ->> 'status' <> 'matched' then raise exception 'SELÁHALO: účty % a % se nespárovaly (%)', a, b, r; end if;
  v_id := (r -> 'match' ->> 'id')::uuid;
  if g in ('chess', 'koulovikamosi', 'warroom', 'hannibal') then perform tt.legacy(v_id); end if;
  return v_id;
end $$;
create or replace function tt.pair_new(a int, b int, g text, m text default 'duel', p jsonb default '{}') returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform tt.find(a, g, m, p);
  r := tt.find(b, g, m, p);
  if r ->> 'status' <> 'matched' then raise exception 'SELÁHALO: účty % a % se nespárovaly (%)', a, b, r; end if;
  return (r -> 'match' ->> 'id')::uuid;
end $$;
create or replace function tt.legacy(mid uuid) returns void language plpgsql security definer as $$
begin update public.mp_matches set rules = rules - 'engine' - 'check', gstate = null where id = mid; end $$;
create or replace function tt.row(mid uuid) returns jsonb language sql security definer as $$ select to_jsonb(m) from public.mp_matches m where id = mid $$;
-- Číslo účtu na místě s (1 nebo 2) v zápase a místo účtu n.
create or replace function tt.who(mid uuid, s int) returns int language sql security definer as $$ select (right((case when s = 1 then p1 else p2 end)::text, 12)::int - 1000) from public.mp_matches where id = mid $$;
create or replace function tt.slot(mid uuid, n int) returns int language sql security definer as $$ select case when p1 = tt.mu(n) then 1 else 2 end from public.mp_matches where id = mid $$;
create or replace function tt.mv(n int, mid uuid, seq int, payload jsonb default '{"m":1}', e boolean default true) returns jsonb language plpgsql as $$ begin perform tt.as_mu(n); return public.mp_move(mid, seq, payload, e); end $$;
-- Odehraje k tahů za sebou (hráči se střídají podle toho, kdo je na tahu); vrací poslední odpověď.
create or replace function tt.play(mid uuid, k int) returns jsonb language plpgsql as $$
declare i int; r jsonb; s int; t int;
begin
  for i in 1..k loop
    select move_count + 1, turn into s, t from public.mp_matches where id = mid;
    r := tt.mv(tt.who(mid, t), mid, s, jsonb_build_object('i', s));
  end loop;
  return r;
end $$;
create or replace function tt.cancel(n int) returns void language plpgsql as $$ begin perform tt.as_mu(n); perform public.mp_cancel(); end $$;
create or replace function tt.st(n int, mid uuid, since int default 0) returns jsonb language plpgsql as $$ begin perform tt.as_mu(n); return public.mp_state(mid, since); end $$;
create or replace function tt.rep(n int, mid uuid, outcome text, why text default null) returns jsonb language plpgsql as $$ begin perform tt.as_mu(n); return public.mp_report(mid, outcome, why); end $$;
create or replace function tt.resign(n int, mid uuid) returns jsonb language plpgsql as $$ begin perform tt.as_mu(n); return public.mp_resign(mid); end $$;
create or replace function tt.prog(n int, mid uuid, v double precision) returns jsonb language plpgsql as $$ begin perform tt.as_mu(n); return public.mp_progress(mid, v); end $$;
-- Posune čas zápasu o s vteřin dopředu (vše se tváří, že je starší o s vteřin).
create or replace function tt.ff(mid uuid, s numeric) returns void language plpgsql security definer as $$
declare d interval := make_interval(secs => s::double precision);
begin
  update public.mp_matches set created_at = created_at - d, turn_started = turn_started - d, deadline = deadline - d, seen1 = seen1 - d, seen2 = seen2 - d where id = mid;
  update public.mp_moves set at = at - d where match_id = mid;
end $$;
-- Hlášení výsledku bude ležet o s vteřin déle.
create or replace function tt.age_report(mid uuid, s int, secs int) returns void language plpgsql security definer as $$
begin
  if s = 1 then update public.mp_matches set report1 = jsonb_set(report1, '{at}', to_jsonb(now() - make_interval(secs => secs))) where id = mid;
  else update public.mp_matches set report2 = jsonb_set(report2, '{at}', to_jsonb(now() - make_interval(secs => secs))) where id = mid; end if;
end $$;
create or replace function tt.set_seen(mid uuid, s int, secs int) returns void language plpgsql security definer as $$
begin
  if s = 1 then update public.mp_matches set seen1 = now() - make_interval(secs => secs) where id = mid; else update public.mp_matches set seen2 = now() - make_interval(secs => secs) where id = mid; end if;
end $$;
create or replace function tt.coins(n int) returns bigint language sql security definer as $$ select coins from public.profiles where id = tt.mu(n) $$;
create or replace function tt.lifetime(n int) returns bigint language sql security definer as $$ select lifetime_coins_earned from public.profiles where id = tt.mu(n) $$;
create or replace function tt.mpearn(n int) returns bigint language sql security definer as $$
  select coalesce(sum(amount), 0) from public.coin_transactions where user_id = tt.mu(n) and starts_with(source_type, 'mp_win:') and split_part(source_type, ':', 3) = ((now() at time zone 'utc')::date)::text $$;
create or replace function tt.mpcount(n int) returns bigint language sql security definer as $$ select count(*) from public.coin_transactions where user_id = tt.mu(n) and starts_with(source_type, 'mp_win:') $$;
create or replace function tt.fails(n int, q text, p_code text, msg text) returns void language plpgsql as $$
begin
  if n is null then perform tt.no_user(); else perform tt.as_mu(n); end if;
  begin
    execute q;
  exception when others then
    if sqlerrm <> p_code and sqlstate <> p_code then raise exception 'SELÁHALO: % (čekalo se %, přišlo %)', msg, p_code, sqlerrm; end if;
    raise notice 'OK   %', msg;
    return;
  end;
  raise exception 'SELÁHALO: % (nic nevyhodilo)', msg;
end $$;
grant execute on all functions in schema tt to public;

-- ===== příprava =====
delete from public.coin_transactions where user_id between tt.mu(0) and tt.mu(99);
delete from public.mp_matches where p1 between tt.mu(0) and tt.mu(99) or p2 between tt.mu(0) and tt.mu(99);
delete from public.profiles where id between tt.mu(0) and tt.mu(99);
delete from auth.users where id between tt.mu(0) and tt.mu(99);
select tt.mmk(n) from generate_series(1, 40) n;
select tt.mmk(41, 100);

-- ===== nastavení her a voleb =====
select tt.ok(public.mp_cfg('chess', 'duel') ->> 'kind' = 'turn' and public.mp_cfg('rocket', 'coop') ->> 'kind' = 'realtime' and public.mp_cfg('cityclicker', 'race') ->> 'kind' = 'race', 'hry mají druh: šachy tahová, Rocket v reálném čase, City Clicker závod');
select tt.ok(public.mp_cfg('nope', 'duel') is null and public.mp_cfg('chess', 'race') is null and public.mp_cfg('polygonarena', 'duel') is null, 'neznámá hra nebo režim nemá nastavení (Polygon aréna nejde přes zápasy)');
select tt.ok(public.mp_clean_params('chess', 'duel', '{}') = '{"tc": "5+3"}' and public.mp_clean_params('chess', 'duel', '{"tc":"3+2","x":1}') = '{"tc": "3+2"}', 'šachy: výchozí hodiny 5+3 a cizí volby se zahodí');
select tt.ok(public.mp_clean_params('hannibal', 'duel', '{}') = '{"preset": "medium"}' and public.mp_clean_params('cityclicker', 'race', '{}') = '{"goal": "standard"}' and public.mp_clean_params('warroom', 'duel', '{"a":1}') = '{}', 'výchozí volby: Hannibal střední, City Clicker standardní, ostatní hry nic');
select tt.fails(1, $$select public.mp_clean_params('chess', 'duel', '{"tc":"1+0"}')$$, 'invalid_params', 'neznámé hodiny se odmítnou');
select tt.fails(1, $$select public.mp_clean_params('hannibal', 'duel', '{"preset":"huge"}')$$, 'invalid_params', 'neznámá velikost armády se odmítne');
select tt.fails(1, $$select public.mp_clean_params('cityclicker', 'race', '{"goal":"x"}')$$, 'invalid_params', 'neznámý cíl závodu se odmítne');
select tt.ok(public.mp_rules('chess', 'duel', '{"tc":"3+2"}') @> '{"bank":180,"inc":2}' and public.mp_rules('chess', 'duel', '{"tc":"10+5"}') @> '{"bank":600,"inc":5}' and public.mp_rules('chess', 'duel', '{"tc":"5+3"}') @> '{"bank":300,"inc":3}', 'pravidla šachů berou hodiny podle volby');
select tt.ok((public.mp_rules('cityclicker', 'race', '{"goal":"quick"}') ->> 'target')::bigint < (public.mp_rules('cityclicker', 'race', '{"goal":"standard"}') ->> 'target')::bigint
         and (public.mp_rules('cityclicker', 'race', '{"goal":"standard"}') ->> 'target')::bigint < (public.mp_rules('cityclicker', 'race', '{"goal":"long"}') ->> 'target')::bigint, 'City Clicker: cíl roste od krátkého přes standardní po dlouhý závod');

-- ===== oprávnění =====
select tt.ok(not has_function_privilege('anon', 'public.mp_find(text,text,jsonb)', 'execute') and has_function_privilege('authenticated', 'public.mp_find(text,text,jsonb)', 'execute'), 'hledat soupeře smí jen přihlášený');
select tt.ok(not has_function_privilege('anon', 'public.mp_move(uuid,int,jsonb,boolean)', 'execute') and not has_function_privilege('anon', 'public.mp_state(uuid,int)', 'execute') and not has_function_privilege('anon', 'public.mp_arena_claim(int,int)', 'execute'), 'nepřihlášený nesmí hrát ani žádat o odměnu');
select tt.ok(not has_function_privilege('authenticated', 'public.mp_pay(uuid,smallint)', 'execute') and not has_function_privilege('authenticated', 'public.mp_finalize(uuid,smallint,text)', 'execute')
         and not has_function_privilege('authenticated', 'public.mp_grant(uuid,text,text,int)', 'execute') and not has_function_privilege('authenticated', 'public.mp_create_match(text,text,jsonb,uuid,uuid)', 'execute'), 'vnitřní funkce (odměna, uzavření zápasu, založení) přihlášený hráč volat nesmí');
select tt.ok(not has_function_privilege('authenticated', 'public.mp_settle(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.mp_expire(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.mp_limits()', 'execute'), 'ani vyhodnocení hlášení, vypršení času a čísla');
select tt.ok(not has_table_privilege('authenticated', 'public.mp_matches', 'select') and not has_table_privilege('authenticated', 'public.mp_moves', 'select') and not has_table_privilege('authenticated', 'public.mp_queue', 'select')
         and not has_table_privilege('authenticated', 'public.mp_rooms', 'select') and not has_table_privilege('authenticated', 'public.mp_arena_log', 'select'), 'do tabulek multiplayeru hráč nesmí vůbec (jen přes funkce)');
select tt.ok(not has_table_privilege('authenticated', 'public.mp_matches', 'update') and not has_table_privilege('authenticated', 'public.mp_matches', 'insert') and not has_table_privilege('anon', 'public.mp_matches', 'select'), 'zápasy hráč nezapíše ani nepřepíše a nepřihlášený je nevidí');
select tt.ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.mp_queue'::regclass, 'public.mp_matches'::regclass, 'public.mp_moves'::regclass, 'public.mp_rooms'::regclass, 'public.mp_arena_log'::regclass)), 'všech pět tabulek má zapnutou RLS');
set role authenticated;
select tt.as_mu(1);
select tt.fails(1, $$select count(*) from public.mp_matches$$, '42501', 'přihlášený hráč nepřečte tabulku zápasů přímo');
select tt.fails(1, $$insert into public.mp_matches (game_id, mode, seed, p1, p2) values ('chess', 'duel', 1, tt.mu(1), tt.mu(2))$$, '42501', 'ani si zápas nevytvoří');
select tt.fails(1, $$select public.mp_pay('00000000-0000-0000-0000-000000000000', 1::smallint)$$, '42501', 'ani si nenechá vyplatit odměnu');
reset role;
select tt.fails(null, $$select public.mp_find('chess', 'duel')$$, 'not_authenticated', 'bez přihlášení nejde hledat soupeře');
select tt.fails(null, $$select public.mp_state('00000000-0000-0000-0000-000000000000')$$, 'not_authenticated', 'bez přihlášení nejde číst zápas');
select tt.fails(null, $$select public.mp_ping()$$, 'not_authenticated', 'bez přihlášení neodpoví ani mp_ping');
select tt.fails(null, $$select public.mp_arena_claim(300, 0)$$, 'not_authenticated', 'bez přihlášení nejde žádat o výhru v aréně');
select tt.as_mu(1);
select tt.ok((public.mp_ping() ->> 'ok')::boolean and (public.mp_ping() ->> 'v')::int = 1, 'mp_ping odpoví přihlášenému: multiplayer v databázi je');

-- ===== fronta a párování =====
select tt.fails(1, $$select public.mp_find('nope', 'duel')$$, 'unknown_mode', 'neznámá hra se do fronty nedostane');
select tt.fails(1, $$select public.mp_find('chess', 'race')$$, 'unknown_mode', 'neznámý režim hry se odmítne');
select tt.fails(1, $$select public.mp_find('chess', 'duel', '{"tc":"7+7"}')$$, 'invalid_params', 'neplatná volba se odmítne');
select tt.fails(1, $$select public.mp_find('polygonarena', 'duel')$$, 'unknown_mode', 'do Polygon arény se přes frontu zápasů nejde');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000999', false);
select tt.fails(null, $$select public.mp_find('chess', 'duel')$$, 'not_authenticated', 'bez přihlášení');
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000999', false);
  begin perform public.mp_find('chess', 'duel'); raise exception 'SELÁHALO: účet bez profilu se dostal do fronty'; exception when others then
    if sqlerrm <> 'profile_not_found' then raise; end if; raise notice 'OK   účet bez profilu se do fronty nedostane'; end;
end $$;
select tt.ok(tt.find(1, 'chess') ->> 'status' = 'waiting', 'první hráč ve frontě čeká');
select tt.ok(tt.find(1, 'chess') ->> 'status' = 'waiting' and (select count(*) from public.mp_queue where user_id = tt.mu(1)) = 1, 'opakované hledání je pořád jeden řádek ve frontě');
select tt.ok((select public.mp_queue_count('chess', 'duel')) = 1 and (select public.mp_queue_count('koulovikamosi', 'duel')) = 0, 'počet čekajících v dané hře');
select tt.ok(tt.find(2, 'koulovikamosi') ->> 'status' = 'waiting', 'jiná hra se s čekajícím šachistou nespáruje');
select tt.ok(tt.find(3, 'chess', 'duel', '{"tc":"3+2"}') ->> 'status' = 'waiting', 'jiné hodiny se nespárují');
select tt.ok(tt.find(1, 'chess') ->> 'status' = 'waiting', 'a první stále čeká');
select tt.cancel(2); select tt.cancel(3);
create temp table t_m1 as select tt.pair(4, 1, 'chess') as id;   -- 4 přijde, čeká 1 s výchozími hodinami 5+3: spárují se
select tt.ok((select count(*) from public.mp_queue where user_id in (tt.mu(1), tt.mu(4))) <= 1, 'po spárování zbývá nejvýš řádek čekajícího, kterému spárování ještě nikdo nepřevzal');
select tt.ok(tt.find(1, 'chess') -> 'match' ->> 'id' = (select id::text from t_m1) and tt.find(1, 'chess') ->> 'status' = 'matched', 'čekající dostane zápas při dalším dotazu');
select tt.ok((select count(*) from public.mp_queue where user_id in (tt.mu(1), tt.mu(4))) = 0, 'fronta se po převzetí zápasu vyčistí');
select tt.ok((select count(*) from public.mp_matches where p1 in (tt.mu(1), tt.mu(4)) or p2 in (tt.mu(1), tt.mu(4))) = 1, 'vznikl právě jeden zápas');
select tt.ok(tt.slot((select id from t_m1), 1) <> tt.slot((select id from t_m1), 4), 'oba hráči sedí na jiném místě (1 a 2)');
select tt.ok((tt.find(1, 'chess') -> 'match' ->> 'seed') = (tt.find(4, 'chess') -> 'match' ->> 'seed'), 'oba mají stejné semínko');
select tt.ok((tt.find(1, 'chess') -> 'match' -> 'opponent' ->> 'name') = 'Hrac4' and (tt.find(4, 'chess') -> 'match' -> 'opponent' ->> 'name') = 'Hrac1', 'každý vidí jméno soupeře');
select tt.ok((tt.find(1, 'chess') -> 'match' -> 'opponent' ->> 'id')::uuid = tt.mu(4) and (tt.find(1, 'chess') -> 'match' -> 'me' ->> 'id')::uuid = tt.mu(1), 'a vlastní i soupeřovo id');
select tt.ok((tt.find(1, 'chess') -> 'match' ->> 'slot')::int + (tt.find(4, 'chess') -> 'match' ->> 'slot')::int = 3, 'místa 1 a 2 se doplňují');
select tt.ok(tt.find(1, 'koulovikamosi') ->> 'status' = 'matched' and (tt.find(1, 'koulovikamosi') -> 'match' ->> 'game') = 'chess', 'hráč v rozehraném zápase dostane znovu ten zápas, ne další (i když hledá jinou hru)');
select tt.ok((select count(*) from public.mp_matches where p1 = tt.mu(1) or p2 = tt.mu(1)) = 1, 'a žádný druhý zápas nevznikl');
select tt.as_mu(1);
select tt.ok(public.mp_active() ->> 'id' = (select id::text from t_m1), 'mp_active vrátí rozehraný zápas');
select tt.as_mu(7);
select tt.ok(public.mp_active() is null or public.mp_active() = 'null'::jsonb, 'bez rozehraného zápasu mp_active nic nevrací');
select tt.ok((select (tt.row((select id from t_m1))) ->> 'bank1')::numeric = 300 and (select (tt.row((select id from t_m1))) ->> 'bank2')::numeric = 300, 'šachové hodiny začínají na 300 vteřin (5+3)');
select tt.ok((select tt.row((select id from t_m1)) -> 'rules' ->> 'inc')::int = 3 and (tt.row((select id from t_m1)) -> 'rules' ->> 'reward')::int = 30, 'pravidla se uložila do zápasu');

select tt.resign(1, (select id from t_m1));

-- čekající, který zmizel, se nepáruje
select tt.find(5, 'warroom');
update public.mp_queue set last_seen = now() - interval '60 seconds' where user_id = tt.mu(5);
select tt.ok(tt.find(6, 'warroom') ->> 'status' = 'waiting', 'hráč, který se přestal ptát, se nespáruje (starý řádek se smaže)');
select tt.ok((select count(*) from public.mp_queue where user_id = tt.mu(5)) = 0, 'a z fronty zmizel');
select tt.as_mu(6); select public.mp_cancel();
select tt.ok((select count(*) from public.mp_queue where user_id = tt.mu(6)) = 0 and public.mp_queue_count('warroom') = 0, 'mp_cancel hráče z fronty vyřadí');

-- ===== tahy a jejich pořadí (Kouloví Kámoši: limit 60 vteřin na tah) =====
create temp table t_k as select tt.pair(10, 11, 'koulovikamosi') as id;
select tt.ok((select tt.row(id) ->> 'turn' from t_k) = '1', 'začíná hráč na místě 1');
select tt.ok((select (tt.row(id) ->> 'move_count')::int from t_k) = 0 and (select tt.row(id) ->> 'deadline' from t_k) is not null, 'zápas má limit na první tah');
select tt.fails(tt.who((select id from t_k), 2), format($$select public.mp_move(%L, 1, '{"a":1}')$$, (select id from t_k)), 'not_your_turn', 'hráč, který není na tahu, netáhne');
select tt.fails(tt.who((select id from t_k), 1), format($$select public.mp_move(%L, 2, '{"a":1}')$$, (select id from t_k)), 'bad_seq', 'tah s přeskočeným číslem se odmítne');
select tt.fails(tt.who((select id from t_k), 1), format($$select public.mp_move(%L, 0, '{"a":1}')$$, (select id from t_k)), 'bad_seq', 'tah s nulovým číslem se odmítne');
select tt.fails(tt.who((select id from t_k), 1), format($$select public.mp_move(%L, 1, null)$$, (select id from t_k)), 'invalid_payload', 'prázdný obsah tahu se odmítne');
select tt.fails(tt.who((select id from t_k), 1), format($$select public.mp_move(%L, 1, 'true'::jsonb)$$, (select id from t_k)), 'invalid_payload', 'ani pravda nepravda jako tah');
select tt.fails(tt.who((select id from t_k), 1), format($$select public.mp_move(%L, 1, to_jsonb(repeat('x', 17000)))$$, (select id from t_k)), 'too_large', 'příliš velká zpráva se odmítne');
select tt.fails(12, format($$select public.mp_move(%L, 1, '{"a":1}')$$, (select id from t_k)), 'not_in_match', 'cizí hráč do zápasu netáhne');
select tt.fails(12, format($$select public.mp_state(%L)$$, (select id from t_k)), 'not_in_match', 'cizí hráč zápas nepřečte');
select tt.fails(12, format($$select public.mp_report(%L, 'win')$$, (select id from t_k)), 'not_in_match', 'cizí hráč nehlásí výsledek');
select tt.fails(12, format($$select public.mp_resign(%L)$$, (select id from t_k)), 'not_in_match', 'cizí hráč nevzdá cizí zápas');
select tt.fails(12, format($$select public.mp_abort(%L)$$, (select id from t_k)), 'not_in_match', 'cizí hráč nezruší cizí zápas');
select tt.fails(12, format($$select public.mp_progress(%L, 5)$$, (select id from t_k)), 'not_in_match', 'cizí hráč neposílá průběh');
select tt.fails(10, $$select public.mp_move(null, 1, '{"a":1}')$$, 'not_in_match', 'tah bez zápasu');
select tt.ok(tt.mv(tt.who((select id from t_k), 1), (select id from t_k), 1, '{"ball":[1,2]}') @> '{"ok": true, "seq": 1, "turn": 2}', 'první tah projde a řadí se druhý hráč');
select tt.ok((select tt.row(id) ->> 'turn' from t_k) = '2' and (select (tt.row(id) ->> 'move_count')::int from t_k) = 1, 'v zápase je jeden tah a na tahu druhý');
select tt.ok(tt.mv(tt.who((select id from t_k), 1), (select id from t_k), 1, '{"ball":[1,2]}') @> '{"ok": true, "again": true}', 'opakované odeslání téhož tahu (výpadek spojení) projde znovu bez dalšího zápisu');
select tt.fails(tt.who((select id from t_k), 1), format($$select public.mp_move(%L, 1, '{"ball":[9,9]}')$$, (select id from t_k)), 'bad_seq', 'stejné číslo s jiným obsahem se odmítne');
select tt.ok((select count(*) from public.mp_moves where match_id = (select id from t_k)) = 1, 'v deníku tahů je pořád jeden');
select tt.fails(tt.who((select id from t_k), 1), format($$select public.mp_move(%L, 2, '{"a":1}')$$, (select id from t_k)), 'not_your_turn', 'po svém tahu už první netáhne');
select tt.ok(tt.mv(tt.who((select id from t_k), 2), (select id from t_k), 2, '{"ball":[3]}') @> '{"ok": true, "turn": 1}', 'druhý hráč odpoví a tah se vrátí');
select tt.ok(jsonb_array_length(tt.st(tt.who((select id from t_k), 1), (select id from t_k)) -> 'moves') = 2, 'mp_state vrátí oba tahy');
select tt.ok(jsonb_array_length(tt.st(tt.who((select id from t_k), 1), (select id from t_k), 1) -> 'moves') = 1 and (tt.st(tt.who((select id from t_k), 1), (select id from t_k), 1) -> 'moves' -> 0 ->> 'seq') = '2', 'od čísla 1 vrátí jen novější tahy');
select tt.ok((tt.st(tt.who((select id from t_k), 1), (select id from t_k)) -> 'moves' -> 0 -> 'payload') = '{"ball": [1, 2]}'::jsonb and (tt.st(tt.who((select id from t_k), 1), (select id from t_k)) -> 'moves' -> 0 ->> 'p') = '1', 'obsah tahu i jeho autor se zachovají');
select tt.ok(jsonb_array_length(tt.st(tt.who((select id from t_k), 1), (select id from t_k), 99) -> 'moves') = 0, 'od čísla za koncem nic');
-- víc akcí v jednom tahu: p_end_turn = false nechá hráče na tahu
select tt.ok(tt.mv(tt.who((select id from t_k), 1), (select id from t_k), 3, '{"a":1}', false) @> '{"ok": true, "turn": 1}', 'tah bez konce tahu nechá hráče na tahu');
select tt.ok(tt.mv(tt.who((select id from t_k), 1), (select id from t_k), 4, '{"a":2}') @> '{"ok": true, "turn": 2}', 'a další tah už tah předá');
select tt.ok((select (tt.row(id) ->> 'move_count')::int from t_k) = 4, 'počet tahů sedí (4)');

-- ===== časové limity (bez hodin: limit na tah) =====
select tt.ff((select id from t_k), 30);
select tt.ok(tt.st(tt.who((select id from t_k), 1), (select id from t_k)) -> 'match' ->> 'status' = 'active', 'půl limitu uplynulo: zápas běží');
select tt.ff((select id from t_k), 40);
select tt.ok(tt.st(tt.who((select id from t_k), 1), (select id from t_k)) -> 'match' ->> 'status' = 'finished' and tt.st(tt.who((select id from t_k), 1), (select id from t_k)) -> 'match' ->> 'reason' = 'timeout', 'po vypršení limitu zápas při dotazu soupeře skončí časem');
select tt.ok((tt.st(tt.who((select id from t_k), 1), (select id from t_k)) -> 'match' ->> 'winner')::int = 1, 'vyhrál ten, kdo čekal na soupeře (místo 1)');
select tt.ok(tt.mpcount(tt.who((select id from t_k), 1)) = 0 and tt.mpcount(tt.who((select id from t_k), 2)) = 0, 'krátký zápas (4 tahy) se neplatí: minimum je 6 tahů');
select tt.fails(tt.who((select id from t_k), 2), format($$select public.mp_move(%L, 5, '{"a":1}')$$, (select id from t_k)), 'not_active', 'po konci zápasu už se netáhne');
select tt.ok(tt.mv(tt.who((select id from t_k), 1), (select id from t_k), 1, '{"ball":[1,2]}') @> '{"again": true}', 'a opakované odeslání starého tahu po skončení stále „projde“ jako přijaté');

-- pozdní tah: hráč na tahu nestihl limit a chce táhnout dřív, než ho soupeř vyhlásí
create temp table t_k2 as select tt.pair(13, 14, 'koulovikamosi') as id;
select tt.mv(tt.who((select id from t_k2), 1), (select id from t_k2), 1);
select tt.ff((select id from t_k2), 100);
select tt.ok(tt.mv(tt.who((select id from t_k2), 2), (select id from t_k2), 2) @> '{"ok": false, "error": "timeout"}', 'tah po vypršení limitu se nepřijme: odpověď timeout');
select tt.ok((select tt.row(id) ->> 'status' from t_k2) = 'finished' and (select tt.row(id) ->> 'winner' from t_k2) = '1' and (select count(*) from public.mp_moves where match_id = (select id from t_k2)) = 1, 'a zápas skončil v neprospěch pozdního hráče');

-- ===== šachové hodiny =====
create temp table t_c as select tt.pair(15, 16, 'chess') as id;
select tt.ok((tt.mv(tt.who((select id from t_c), 1), (select id from t_c), 1) -> 'bank' ->> 0)::numeric = 303 and (tt.row((select id from t_c)) ->> 'bank1')::numeric = 303, 'první tah hodiny nespotřebuje a přidá se přídavek 3 vteřiny (303)');
select tt.ff((select id from t_c), 100);
select tt.mv(tt.who((select id from t_c), 2), (select id from t_c), 2);
select tt.ok((tt.row((select id from t_c)) ->> 'bank2')::numeric between 202 and 203.5, 'druhý hráč přemýšlel 100 vteřin: z 300 zbývá cca 200 a přidají se 3 (cca 203)');
select tt.ok((tt.row((select id from t_c)) ->> 'bank1')::numeric = 303, 'hodiny prvního hráče se nemění, dokud netáhne');
select tt.ok(abs(extract(epoch from ((select (tt.row(id) ->> 'deadline')::timestamptz from t_c) - now())) - 303) < 3, 'limit na další tah je podle zbytku hodin hráče na tahu (cca 303 vteřin)');
update public.mp_matches set bank1 = 5 where id = (select id from t_c);
select tt.ff((select id from t_c), 10);
select tt.ok(tt.mv(tt.who((select id from t_c), 1), (select id from t_c), 3) @> '{"ok": false, "error": "timeout"}' and (select tt.row(id) ->> 'winner' from t_c) = '2', 'hráči, kterému došly hodiny, tah nevyjde a prohrává');
select tt.ok((select tt.row(id) ->> 'reason' from t_c) = 'timeout', 'důvod konce je čas');
create temp table t_c2 as select tt.pair(15, 16, 'chess', 'duel', '{"tc":"3+2"}') as id;
select tt.ok((tt.row((select id from t_c2)) ->> 'bank1')::numeric = 180 and (tt.row((select id from t_c2)) -> 'rules' ->> 'inc')::int = 2, 'volba hodin 3+2 se projeví (180 vteřin, přídavek 2)');
select tt.resign(15, (select id from t_c2));
create temp table t_c3 as select tt.pair(15, 16, 'chess', 'duel', '{"tc":"10+5"}') as id;
select tt.ok((tt.row((select id from t_c3)) ->> 'bank2')::numeric = 600, 'hodiny 10+5 mají 600 vteřin');
-- první tah musí přijít do první lhůty
select tt.ff((select id from t_c3), 400);
select tt.ok(tt.st(tt.who((select id from t_c3), 2), (select id from t_c3)) -> 'match' ->> 'reason' = 'timeout' and (tt.row((select id from t_c3)) ->> 'winner')::int = 2, 'kdo neudělá první tah ve lhůtě (60 + 45 vteřin), prohrává časem');

-- ===== hlášení výsledku =====
create temp table t_r as select tt.pair(20, 21, 'chess') as id;
select tt.play((select id from t_r), 12);
select tt.ff((select id from t_r), 70);
select tt.ok(tt.rep(20, (select id from t_r), 'win', 'checkmate') ->> 'status' = 'active', 'jediné hlášení zápas neuzavře');
select tt.ok(tt.st(21, (select id from t_r)) -> 'match' ->> 'status' = 'active', 'a soupeř dál vidí běžící zápas');
select tt.fails(20, format($$select public.mp_report(%L, 'victory')$$, (select id from t_r)), 'invalid_outcome', 'neznámý výsledek se odmítne');
select tt.fails(20, format($$select public.mp_report(%L, null)$$, (select id from t_r)), 'invalid_outcome', 'chybějící výsledek se odmítne');
create temp table t_r_before as select tt.coins(20) c20, tt.coins(21) c21;
select tt.ok(tt.rep(21, (select id from t_r), 'loss', 'checkmate') ->> 'status' = 'finished', 'obě hlášení souhlasí: zápas je uzavřen');
select tt.ok((tt.row((select id from t_r)) ->> 'winner')::int = tt.slot((select id from t_r), 20), 'vítěz je ten, kdo hlásil výhru');
select tt.ok(tt.coins(20) = (select c20 from t_r_before) + 30 and tt.coins(21) = (select c21 from t_r_before), 'vítěz dostal 30 Coinů, poražený nic');
select tt.ok(tt.mpearn(20) = 30 and tt.lifetime(20) = 30 and tt.mpcount(20) = 1, 'v deníku je jeden zápis, v celkově získaných také 30 (jednou)');
select tt.ok((select source_type from public.coin_transactions where user_id = tt.mu(20) and starts_with(source_type, 'mp_win:')) = 'mp_win:chess:' || ((now() at time zone 'utc')::date)::text || ':' || left((select id::text from t_r), 8), 'označení v deníku: mp_win:<hra>:<den>:<začátek id zápasu>');
select tt.ok(tt.rep(20, (select id from t_r), 'win') -> 'my_coins' = '30'::jsonb and tt.rep(21, (select id from t_r), 'win') -> 'my_coins' = '0'::jsonb, 'další hlášení po konci nic nemění a vrací, kolik kdo dostal');
select tt.ok(tt.coins(20) = (select c20 from t_r_before) + 30, 'odměna se nevyplatí dvakrát');
select tt.ok((tt.rep(20, (select id from t_r), 'win')) ->> 'winner' = (tt.row((select id from t_r)) ->> 'winner'), 'vítěz se po konci nemění');
select tt.ok(tt.mpearn(21) = 0 and tt.mpcount(21) = 0, 'poražený nemá v deníku nic');

-- spor: oba hlásí výhru
create temp table t_d as select tt.pair(22, 23, 'chess') as id;
select tt.play((select id from t_d), 12); select tt.ff((select id from t_d), 70);
select tt.rep(22, (select id from t_d), 'win');
select tt.ok(tt.rep(23, (select id from t_d), 'win') ->> 'status' = 'void' and (select tt.row(id) ->> 'reason' from t_d) = 'dispute', 'když oba hlásí výhru, zápas se zruší jako spor');
select tt.ok(tt.coins(22) = 0 and tt.coins(23) = 0, 'a nikdo nedostane nic');
-- remíza
create temp table t_dr as select tt.pair(22, 23, 'chess') as id;
select tt.play((select id from t_dr), 12); select tt.ff((select id from t_dr), 70);
select tt.rep(22, (select id from t_dr), 'draw'); select tt.rep(23, (select id from t_dr), 'draw');
select tt.ok((select tt.row(id) ->> 'status' from t_dr) = 'finished' and (select tt.row(id) ->> 'winner' from t_dr) = '0' and tt.coins(22) = 0, 'obě remízy: zápas skončí remízou bez odměny');
-- hlášení se dá změnit
create temp table t_ch as select tt.pair(24, 25, 'chess') as id;
select tt.play((select id from t_ch), 12); select tt.ff((select id from t_ch), 70);
select tt.rep(24, (select id from t_ch), 'loss'); select tt.rep(24, (select id from t_ch), 'win');
select tt.ok(tt.rep(25, (select id from t_ch), 'loss') ->> 'status' = 'finished' and (select tt.row(id) ->> 'winner' from t_ch) = tt.slot((select id from t_ch), 24)::text, 'hlášení jde změnit, dokud zápas běží: platí poslední');
-- jediné hlášení se přijme, až když soupeř zmizel
create temp table t_g as select tt.pair(26, 27, 'chess') as id;
select tt.play((select id from t_g), 12); select tt.ff((select id from t_g), 70);
select tt.rep(26, (select id from t_g), 'win', 'left');
select tt.ok(tt.st(26, (select id from t_g)) -> 'match' ->> 'status' = 'active', 'soupeř je zatím k zastižení: hlášení samo nestačí');
select tt.set_seen((select id from t_g), tt.slot((select id from t_g), 27), 60);
select tt.ok(tt.st(26, (select id from t_g)) -> 'match' ->> 'status' = 'active', 'soupeř je ticho, ale hlášení leží teprve chvíli: ještě se čeká');
select tt.age_report((select id from t_g), tt.slot((select id from t_g), 26), 30);
select tt.ok(tt.st(26, (select id from t_g)) -> 'match' ->> 'status' = 'finished' and (select tt.row(id) ->> 'reason' from t_g) = 'opponent_gone', 'soupeř ticho a hlášení leží: přijme se');
select tt.ok(tt.coins(26) = 30 and tt.coins(27) = 0, 'a vítěz dostane odměnu');
-- jediné hlášení o prohře: vyhrává soupeř
create temp table t_g2 as select tt.pair(28, 29, 'chess') as id;
select tt.play((select id from t_g2), 12); select tt.ff((select id from t_g2), 70);
select tt.rep(28, (select id from t_g2), 'loss');
select tt.set_seen((select id from t_g2), tt.slot((select id from t_g2), 29), 60);
select tt.age_report((select id from t_g2), tt.slot((select id from t_g2), 28), 30);
select tt.st(28, (select id from t_g2));
select tt.ok((select tt.row(id) ->> 'winner' from t_g2) = tt.slot((select id from t_g2), 29)::text, 'hráč, který ohlásil prohru, a soupeř pryč: vyhrává soupeř (podle pravidel odměny)');

-- ===== vzdání a podmínky odměny =====
create temp table t_s as select tt.pair(30, 31, 'chess') as id;
select tt.resign(30, (select id from t_s));
select tt.ok((select tt.row(id) ->> 'status' from t_s) = 'finished' and (select tt.row(id) ->> 'winner' from t_s) = tt.slot((select id from t_s), 31)::text and (select tt.row(id) ->> 'reason' from t_s) = 'resign', 'vzdání: vyhrává soupeř');
select tt.ok(tt.coins(31) = 0, 'vzdání po dvou tazích (nula tahů) odměnu nedá: minimum je 10 tahů a 45 vteřin');
create temp table t_s2 as select tt.pair(30, 31, 'chess') as id;
select tt.play((select id from t_s2), 12);
select tt.resign(30, (select id from t_s2));
select tt.ok(tt.coins(31) = 0, 'dost tahů, ale hrálo se jen pár vteřin: odměna se nevyplatí');
create temp table t_s3 as select tt.pair(30, 31, 'chess') as id;
select tt.play((select id from t_s3), 12); select tt.ff((select id from t_s3), 70);
select tt.resign(30, (select id from t_s3));
select tt.ok(tt.coins(31) = 30, 'dost tahů i času: vzdání vyplatí soupeři 30');
select tt.ok(tt.resign(30, (select id from t_s3)) ->> 'status' = 'finished' and tt.coins(31) = 30, 'druhé vzdání už nic nemění');
-- stejný soupeř: nejvýš 3 odměněné výhry za den
create temp table t_o1 as select tt.pair(32, 33, 'chess') as id;
select tt.play((select id from t_o1), 12); select tt.ff((select id from t_o1), 70); select tt.rep(32, (select id from t_o1), 'win'); select tt.rep(33, (select id from t_o1), 'loss');
create temp table t_o2 as select tt.pair(32, 33, 'chess') as id;
select tt.play((select id from t_o2), 12); select tt.ff((select id from t_o2), 70); select tt.rep(32, (select id from t_o2), 'win'); select tt.rep(33, (select id from t_o2), 'loss');
create temp table t_o3 as select tt.pair(32, 33, 'chess') as id;
select tt.play((select id from t_o3), 12); select tt.ff((select id from t_o3), 70); select tt.rep(32, (select id from t_o3), 'win'); select tt.rep(33, (select id from t_o3), 'loss');
select tt.ok(tt.coins(32) = 90, 'třetí odměněná výhra nad stejným soupeřem ještě platí (90)');
create temp table t_o4 as select tt.pair(32, 33, 'chess') as id;
select tt.play((select id from t_o4), 12); select tt.ff((select id from t_o4), 70); select tt.rep(32, (select id from t_o4), 'win'); select tt.rep(33, (select id from t_o4), 'loss');
select tt.ok(tt.coins(32) = 90 and (select tt.row(id) ->> 'status' from t_o4) = 'finished' and (select tt.row(id) ->> 'winner' from t_o4) = tt.slot((select id from t_o4), 32)::text, 'čtvrtá výhra nad stejným soupeřem Coiny nedá (zápas se ale uzavře)');
-- denní strop 150: výhry nad různými soupeři
create temp table t_cap1 as select tt.pair(34, 35, 'chess') as id;
select tt.play((select id from t_cap1), 12); select tt.ff((select id from t_cap1), 70); select tt.rep(34, (select id from t_cap1), 'win'); select tt.rep(35, (select id from t_cap1), 'loss');
create temp table t_cap2 as select tt.pair(34, 36, 'chess') as id;
select tt.play((select id from t_cap2), 12); select tt.ff((select id from t_cap2), 70); select tt.rep(34, (select id from t_cap2), 'win'); select tt.rep(36, (select id from t_cap2), 'loss');
create temp table t_cap3 as select tt.pair(34, 37, 'chess') as id;
select tt.play((select id from t_cap3), 12); select tt.ff((select id from t_cap3), 70); select tt.rep(34, (select id from t_cap3), 'win'); select tt.rep(37, (select id from t_cap3), 'loss');
create temp table t_cap4 as select tt.pair(34, 38, 'chess') as id;
select tt.play((select id from t_cap4), 12); select tt.ff((select id from t_cap4), 70); select tt.rep(34, (select id from t_cap4), 'win'); select tt.rep(38, (select id from t_cap4), 'loss');
create temp table t_cap5 as select tt.pair(34, 39, 'chess') as id;
select tt.play((select id from t_cap5), 12); select tt.ff((select id from t_cap5), 70); select tt.rep(34, (select id from t_cap5), 'win'); select tt.rep(39, (select id from t_cap5), 'loss');
select tt.ok(tt.coins(34) = 150 and tt.mpearn(34) = 150, 'pět výher po 30 = 150: denní strop je naplněný');
create temp table t_cap6 as select tt.pair(34, 40, 'chess') as id;
select tt.play((select id from t_cap6), 12); select tt.ff((select id from t_cap6), 70); select tt.rep(34, (select id from t_cap6), 'win'); select tt.rep(40, (select id from t_cap6), 'loss');
select tt.ok(tt.coins(34) = 150 and tt.mpcount(34) = 5 and (select tt.row(id) ->> 'winner' from t_cap6) = tt.slot((select id from t_cap6), 34)::text, 'šestá výhra nad denním stropem Coiny nedá, zápas se uzavře a v deníku nic nepřibude');
select tt.ok(tt.lifetime(34) = 150, 'a celkově získané Coiny se nezvýšily');
-- částečná výplata: ve stropu zbývá jen 10
select tt.no_user();
delete from public.coin_transactions where user_id = tt.mu(41);
insert into public.coin_transactions (user_id, amount, source_type) values (tt.mu(41), 140, 'mp_win:chess:' || ((now() at time zone 'utc')::date)::text || ':fake');
create temp table t_part as select tt.pair(41, 2, 'chess') as id;
select tt.play((select id from t_part), 12); select tt.ff((select id from t_part), 70); select tt.rep(41, (select id from t_part), 'win'); select tt.rep(2, (select id from t_part), 'loss');
select tt.ok(tt.mpearn(41) = 150, 'zbývalo 10 do stropu: vyplatí se jen těch 10 (celkem 150)');
-- včerejší výhry se do denního stropu nepočítají
select tt.no_user();
delete from public.coin_transactions where user_id = tt.mu(3);
insert into public.coin_transactions (user_id, amount, source_type) values (tt.mu(3), 150, 'mp_win:chess:' || ((now() at time zone 'utc')::date - 1)::text || ':old');
select tt.ok(public.mp_room_left(tt.mu(3)) = 150, 'včerejších 150 Coinů do dnešního stropu nepatří');
-- přehled
select tt.as_mu(34);
select tt.ok((public.mp_stats() -> 'games' -> 'chess' ->> 'wins')::int = 6 and (public.mp_stats() ->> 'room_left')::int = 0 and (public.mp_stats() ->> 'daily_cap')::int = 150, 'mp_stats: šest výher v šachách a dnes už nic nezbývá do stropu');
select tt.as_mu(33);
select tt.ok((public.mp_stats() -> 'games' -> 'chess' ->> 'losses')::int = 4 and (public.mp_stats() ->> 'room_left')::int = 150, 'mp_stats poraženého: čtyři prohry a nic nevyděláno');
select tt.as_mu(23);
select tt.ok((public.mp_stats() -> 'games' -> 'chess' ->> 'draws')::int = 1, 'mp_stats počítá remízy zvlášť');

-- ===== závod (City Clicker) =====
create temp table t_race as select tt.pair(1, 2, 'cityclicker', 'race', '{"goal":"quick"}') as id;
select tt.ok((tt.row((select id from t_race)) -> 'rules' ->> 'target')::bigint = 1000000000 and (select tt.row(id) ->> 'turn' from t_race) is null and (select tt.row(id) ->> 'deadline' from t_race) is null, 'závod nemá tahy ani limit; cíl rychlého závodu je miliarda');
select tt.fails(1, format($$select public.mp_move(%L, 1, '{"a":1}')$$, (select id from t_race)), 'not_turn_based', 'do závodu se netáhne');
select tt.fails(1, format($$select public.mp_report(%L, 'win')$$, (select id from t_race)), 'not_reportable', 'závod se nehlásí, rozhoduje server');
select tt.fails(1, format($$select public.mp_progress(%L, -5)$$, (select id from t_race)), 'invalid_value', 'záporný průběh se odmítne');
select tt.fails(1, format($$select public.mp_progress(%L, 'NaN'::double precision)$$, (select id from t_race)), 'invalid_value', 'NaN se odmítne');
select tt.fails(1, format($$select public.mp_progress(%L, null)$$, (select id from t_race)), 'invalid_value', 'prázdný průběh se odmítne');
select tt.fails(1, format($$select public.mp_progress(%L, 1e301)$$, (select id from t_race)), 'invalid_value', 'a nesmyslně velké číslo také');
select tt.ok((tt.prog(1, (select id from t_race), 300) -> 'prog' ->> 0)::numeric between 0 and 300, 'průběh hráče 1 se zapíše (a hned po startu se ořízne podle nejkratší možné doby)');
select tt.ff((select id from t_race), 10);
select tt.ok((tt.prog(1, (select id from t_race), 300) -> 'prog' ->> tt.slot((select id from t_race), 1) - 1)::numeric = 300, 'za 10 vteřin je 300 věrohodných a zapíše se přesně');
select tt.ok((tt.prog(1, (select id from t_race), 100) -> 'prog' ->> tt.slot((select id from t_race), 1) - 1)::numeric = 300, 'nižší hodnota nic nesníží');
select tt.ok((tt.prog(2, (select id from t_race), 1e12) -> 'prog' ->> tt.slot((select id from t_race), 2) - 1)::numeric between 4.0e8 and 4.3e8 and (select tt.row(id) ->> 'status' from t_race) = 'active', 'podvodná obrovská hodnota se ořízne na lineární strop (miliarda · 10/24) a závod nekončí');
select tt.ok((tt.st(1, (select id from t_race)) -> 'match' -> 'prog' ->> tt.slot((select id from t_race), 2) - 1)::numeric > 3e8, 'oba hráči vidí průběh soupeře v mp_state');
select tt.ff((select id from t_race), 15);
select tt.ok(tt.prog(1, (select id from t_race), 1000000000) ->> 'status' = 'finished' and (select tt.row(id) ->> 'winner' from t_race) = tt.slot((select id from t_race), 1)::text and (select tt.row(id) ->> 'reason' from t_race) = 'goal', 'kdo první pošle hodnotu na cíli (po nejkratší době), vyhrává hned');
select tt.ok(tt.coins(1) = 40 and tt.coins(2) = 0, 'vítěz závodu dostal 40 Coinů, druhý nic');
select tt.ok((tt.prog(2, (select id from t_race), 99999) ->> 'winner')::int = tt.slot((select id from t_race), 1) and tt.coins(2) = 0, 'pozdější průběh druhého nic nezmění');
-- rychlý podvod: cíl hned po startu
create temp table t_race2 as select tt.pair(3, 4, 'cityclicker', 'race', '{"goal":"quick"}') as id;
select tt.ok(tt.prog(3, (select id from t_race2), 1000000000) ->> 'status' = 'active', 'cíl poslaný vteřinu po startu závod neukončí (ořízne se)');
select tt.ok((select tt.row(id) ->> 'prog1' from t_race2)::numeric < 5e7 and (select tt.row(id) ->> 'prog2' from t_race2)::numeric < 5e7, 'a průběh zůstane hluboko pod cílem (lineární strop za pár vteřin)');
create temp table t_c3b as select tt.coins(3) c, tt.coins(4) d;
select tt.resign(4, (select id from t_race2));
select tt.ok((select tt.row(id) ->> 'winner' from t_race2) = tt.slot((select id from t_race2), 3)::text, 'vzdání v závodě dá výhru soupeři');
select tt.ok(tt.coins(3) = (select c from t_c3b) and tt.coins(4) = (select d from t_c3b), 'ale za pár vteřin závodu bez odměny (nejkratší doba 24 vteřin)');
create temp table t_race3 as select tt.pair(3, 4, 'cityclicker', 'race') as id;
select tt.ok((tt.row((select id from t_race3)) -> 'rules' ->> 'target')::bigint = 10000000000 and (tt.row((select id from t_race3)) ->> 'params') = '{"goal": "standard"}', 'výchozí závod je standardní (cíl 10 miliard)');
select tt.fails(3, format($$select public.mp_move(%L, 1, '{"a":1}')$$, (select id from t_race3)), 'not_turn_based', 'ani do dalšího závodu se netáhne');
select tt.resign(3, (select id from t_race3));

-- ===== týmová hra (Rocket: spolupráce) =====
create temp table t_t as select tt.pair(5, 6, 'rocket', 'coop') as id;
select tt.ok((select tt.row(id) ->> 'turn' from t_t) is null and (tt.row((select id from t_t)) -> 'rules' ->> 'team')::boolean, 'Rocket coop nemá tahy a je týmový');
select tt.fails(5, format($$select public.mp_move(%L, 1, '{"a":1}')$$, (select id from t_t)), 'not_turn_based', 'do hry v reálném čase se netáhne přes tahy');
select tt.fails(5, format($$select public.mp_report(%L, 'draw')$$, (select id from t_t)), 'invalid_outcome', 'tým nemůže remizovat');
select tt.ff((select id from t_t), 70);
select tt.rep(5, (select id from t_t), 'win', 'wave10'); select tt.rep(6, (select id from t_t), 'win', 'wave10');
select tt.ok((select tt.row(id) ->> 'winner' from t_t) = '3' and tt.coins(5) = 25 and tt.coins(6) = 25, 'tým zvítězil: oba dostanou po 25 Coinech');
select tt.as_mu(5); select tt.ok((public.mp_stats() -> 'games' -> 'rocket' ->> 'wins')::int = 1, 'tým počítá výhru oběma');
create temp table t_t2 as select tt.pair(5, 6, 'rocket', 'coop') as id;
select tt.ff((select id from t_t2), 70);
select tt.rep(5, (select id from t_t2), 'loss'); select tt.rep(6, (select id from t_t2), 'loss');
select tt.ok((select tt.row(id) ->> 'winner' from t_t2) = '0' and tt.coins(5) = 25, 'tým prohrál: nikdo nic nedostane');
select tt.as_mu(5); select tt.ok((public.mp_stats() -> 'games' -> 'rocket' ->> 'losses')::int = 1 and (public.mp_stats() -> 'games' -> 'rocket' ->> 'draws')::int = 0, 'prohra týmu se počítá jako prohra, ne remíza');
create temp table t_t3 as select tt.pair(5, 6, 'rocket', 'coop') as id;
select tt.resign(5, (select id from t_t3));
select tt.ok((select tt.row(id) ->> 'winner' from t_t3) = '0' and tt.coins(6) = 25, 'vzdání ve spolupráci: bez výhry pro kohokoli');
create temp table t_t4 as select tt.pair(5, 6, 'rocket', 'coop') as id;
select tt.ff((select id from t_t4), 70);
select tt.rep(5, (select id from t_t4), 'win', 'wave10');
select tt.set_seen((select id from t_t4), tt.slot((select id from t_t4), 6), 60); select tt.age_report((select id from t_t4), tt.slot((select id from t_t4), 5), 30);
select tt.st(5, (select id from t_t4));
select tt.ok((select tt.row(id) ->> 'winner' from t_t4) = '3' and tt.coins(5) = 50, 'tým zvítězil a partner se odpojil dřív, než stihl hlásit: výhra platí podle hlášení toho, kdo zůstal');
-- Rocket PvP
create temp table t_pv as select tt.pair(7, 8, 'rocket', 'pvp') as id;
select tt.ff((select id from t_pv), 40);
select tt.rep(7, (select id from t_pv), 'win', 'bossdown'); select tt.rep(8, (select id from t_pv), 'loss', 'bossdown');
select tt.ok((select tt.row(id) ->> 'winner' from t_pv) = tt.slot((select id from t_pv), 7)::text and tt.coins(7) = 35, 'Rocket PvP: vítěz dostane 35');
select tt.ok(not exists (select 1 from public.mp_queue where user_id in (tt.mu(5), tt.mu(6), tt.mu(7), tt.mu(8))), 'po zápasech jsou fronty prázdné');

-- ===== nepřipojený soupeř (zrušení bez následků) =====
create temp table t_a as select tt.pair(9, 10, 'warroom') as id;
select tt.fails(9, format($$select public.mp_abort(%L)$$, (select id from t_a)), 'too_early', 'hned po spárování se zápas zrušit nedá');
select tt.set_seen((select id from t_a), tt.slot((select id from t_a), 10), 60);
select tt.ok(tt.as_mu(9) is not null and public.mp_abort((select id from t_a)) ->> 'status' = 'void', 'soupeř se 60 vteřin neozval: zápas se zruší (void)');
select tt.ok((select tt.row(id) ->> 'reason' from t_a) = 'no_show' and tt.coins(9) = tt.coins(9), 'důvodem je nepřipojení');
create temp table t_a2 as select tt.pair(9, 10, 'warroom') as id;
select tt.mv(tt.who((select id from t_a2), 1), (select id from t_a2), 1);
select tt.set_seen((select id from t_a2), tt.slot((select id from t_a2), 10), 60);
select tt.fails(9, format($$select public.mp_abort(%L)$$, (select id from t_a2)), 'already_started', 'po prvním tahu už zrušit nejde (už se hraje)');
select tt.resign(9, (select id from t_a2));

-- ===== místnosti pro kamaráda =====
select tt.as_mu(11);
create temp table t_room as select public.mp_room_create('hannibal', 'duel', '{"preset":"large"}') as j;
select tt.ok(length((select j ->> 'code' from t_room)) = 6 and (select j ->> 'code' from t_room) ~ '^[A-HJKMNP-Z2-9]{6}$', 'kód místnosti má šest znaků bez zaměnitelných (0, O, 1, I, L)');
select tt.ok((select count(*) from public.mp_rooms where host = tt.mu(11)) = 1, 'místnost je zapsaná');
select tt.fails(11, format($$select public.mp_room_join(%L)$$, (select j ->> 'code' from t_room)), 'own_room', 'do své místnosti nelze vstoupit');
select tt.fails(12, $$select public.mp_room_join('ZZZZZZ')$$, 'room_not_found', 'neexistující kód');
select tt.fails(12, $$select public.mp_room_join('')$$, 'room_not_found', 'prázdný kód');
select tt.fails(12, $$select public.mp_room_join(null)$$, 'room_not_found', 'chybějící kód');
select tt.as_mu(12);
create temp table t_rm as select public.mp_room_join(lower((select j ->> 'code' from t_room))) as j;
select tt.ok((select j ->> 'game' from t_rm) = 'hannibal' and (select j -> 'params' ->> 'preset' from t_rm) = 'large' and (select j -> 'opponent' ->> 'name' from t_rm) = 'Hrac11', 'kamarád vstoupí (i s malými písmeny), dostane zápas s volbami hosta');
select tt.as_mu(11);
select tt.ok(public.mp_active() ->> 'id' = (select j ->> 'id' from t_rm), 'host zápas dostane přes mp_active');
select tt.fails(13, format($$select public.mp_room_join(%L)$$, (select j ->> 'code' from t_room)), 'room_taken', 'obsazená místnost');
select tt.fails(11, $$select public.mp_room_create('chess', 'duel')$$, 'already_in_match', 'kdo hraje, další místnost nevytvoří');
select tt.fails(11, $$select public.mp_room_create('hannibal', 'duel', '{"preset":"giant"}')$$, 'invalid_params', 'neplatná volba místnosti');
select tt.resign(11, (select j ->> 'id' from t_rm)::uuid);
select tt.as_mu(14);
create temp table t_room2 as select public.mp_room_create('chess', 'duel') as j;
select tt.ok((public.mp_room_create('chess', 'duel') ->> 'code') <> (select j ->> 'code' from t_room2) and (select count(*) from public.mp_rooms where host = tt.mu(14)) = 1, 'nová místnost nahradí starou (jedna na hráče)');
select tt.as_mu(14); select public.mp_cancel();
select tt.ok((select count(*) from public.mp_rooms where host = tt.mu(14)) = 0, 'mp_cancel zruší i místnost');
select tt.as_mu(14);
create temp table t_room3 as select public.mp_room_create('chess', 'duel') as j;
update public.mp_rooms set expires_at = now() - interval '5 minutes' where host = tt.mu(14);
select tt.fails(15, format($$select public.mp_room_join(%L)$$, (select j ->> 'code' from t_room3)), 'room_not_found', 'vypršená místnost');
select tt.find(15, 'warroom'); select tt.cancel(15);
select tt.ok((select count(*) from public.mp_rooms where host = tt.mu(14)) = 0, 'a vypršelá místnost se při dalším hledání uklidí');

-- ===== úklid =====
create temp table t_u as select tt.pair(16, 17, 'chess') as id;
select tt.play((select id from t_u), 3);
update public.mp_matches set seen1 = now() - interval '2 hours', seen2 = now() - interval '2 hours' where id = (select id from t_u);
select tt.find(18, 'warroom');
select tt.ok((select tt.row(id) ->> 'status' from t_u) = 'void' and (select tt.row(id) ->> 'reason' from t_u) = 'abandoned', 'zápas, ze kterého oba utekli, se po půl hodině zruší (úklid při hledání)');
select tt.as_mu(18); select public.mp_cancel();
update public.mp_matches set created_at = now() - interval '5 days' where id = (select id from t_u);
select tt.find(18, 'warroom'); select tt.as_mu(18); select public.mp_cancel();
select tt.ok((select count(*) from public.mp_matches where id = (select id from t_u)) = 0 and (select count(*) from public.mp_moves where match_id = (select id from t_u)) = 0, 'dohrané zápasy starší než tři dny se i s tahy smažou');

-- ===== Polygon aréna =====
select tt.as_mu(19);
select tt.fails(19, $$select public.mp_arena_claim(-1, 0)$$, 'invalid_value', 'záporná doba kola');
select tt.fails(19, $$select public.mp_arena_claim(null, 0)$$, 'invalid_value', 'chybějící doba kola');
select tt.ok(public.mp_arena_claim(200, 5) @> '{"granted": 15, "capped": false}' and tt.coins(19) = 15, 'výhra v aréně po dostatečně dlouhém kole: 15 Coinů');
select tt.fails(19, $$select public.mp_arena_claim(200, 5)$$, 'too_soon', 'druhá výhra hned po první se odmítne (odstup 150 vteřin)');
select tt.ok(tt.coins(19) = 15, 'a nic se nepřipsalo');
update public.mp_arena_log set last_claim = now() - interval '200 seconds' where user_id = tt.mu(19);
select tt.ok(public.mp_arena_claim(100, 5) @> '{"granted": 0}' and tt.coins(19) = 15, 'příliš krátké kolo (pod 150 vteřin) se neplatí');
select tt.fails(19, $$select public.mp_arena_claim(500, 5)$$, 'too_soon', 'ale odstup od poslední žádosti se i tak počítá (žádosti nejdou střílet jedna za druhou)');
update public.mp_arena_log set last_claim = now() - interval '200 seconds' where user_id = tt.mu(19);
select tt.ok(public.mp_arena_claim(500, 5) @> '{"granted": 15}' and tt.coins(19) = 30 and tt.mpearn(19) = 30, 'po odstupu zase platí');
select tt.ok(tt.lifetime(19) = 30 and (select source_type from public.coin_transactions where user_id = tt.mu(19) order by created_at limit 1) like 'mp_win:polygonarena:%', 'zápis je v deníku jako mp_win:polygonarena');
-- strop se sdílí s ostatními online výhrami
select tt.no_user();
delete from public.coin_transactions where user_id = tt.mu(19);
insert into public.coin_transactions (user_id, amount, source_type) values (tt.mu(19), 145, 'mp_win:chess:' || ((now() at time zone 'utc')::date)::text || ':fake');
update public.mp_arena_log set last_claim = now() - interval '200 seconds' where user_id = tt.mu(19);
select tt.as_mu(19);
select tt.ok(public.mp_arena_claim(500, 5) @> '{"granted": 5, "capped": true}', 'strop 150 se sdílí s ostatními online výhrami: zbývalo 5');
update public.mp_arena_log set last_claim = now() - interval '200 seconds' where user_id = tt.mu(19);
select tt.ok(public.mp_arena_claim(500, 5) @> '{"granted": 0, "capped": true}', 'a pak nic');

-- ===== Šachy: pravidla hlídá server =====
select tt.mmk(n) from generate_series(42, 49) n;
-- Pomůcky: šachovnice z FEN, počítání tahů (perft) a tah hráče na tahu zadaný souřadnicí.
create or replace function tt.fen(p_fen text) returns text[] language plpgsql immutable as $$
declare v_rows text[] := string_to_array(split_part(p_fen, ' ', 1), '/'); v_out text := ''; i int; j int; ch text;
begin
  for i in 1..8 loop
    for j in 1..length(v_rows[i]) loop
      ch := substr(v_rows[i], j, 1);
      if ch ~ '[1-8]' then v_out := v_out || repeat('.', ch::int); else v_out := v_out || ch; end if;
    end loop;
  end loop;
  return regexp_split_to_array(v_out, '');
end $$;
create or replace function tt.perft(p_fen text, p_depth int) returns bigint language plpgsql as $$
declare
  v_castle text := case when split_part(p_fen, ' ', 3) = '-' then '' else split_part(p_fen, ' ', 3) end;
begin
  return tt.perft_rec(tt.fen(p_fen), v_castle, -1, split_part(p_fen, ' ', 2) = 'w', p_depth);
end $$;
create or replace function tt.perft_rec(p_bd text[], p_castle text, p_ep int, p_white boolean, p_depth int) returns bigint language plpgsql as $$
declare n bigint := 0; r record;
begin
  if p_depth = 0 then return 1; end if;
  if p_depth = 1 then return (select count(*) from public.mp_chess_moves(p_bd, p_castle, p_ep, p_white)); end if;
  for r in select * from public.mp_chess_moves(p_bd, p_castle, p_ep, p_white) loop
    n := n + tt.perft_rec(r.nbd, r.ncastle, r.nep, not p_white, p_depth - 1);
  end loop;
  return n;
end $$;
-- Stav partie z FEN (pole pro braní mimochodem a čítač půltahů se berou z FEN).
create or replace function tt.fen2g(p_fen text) returns jsonb language plpgsql as $$
declare
  v_bd text[] := tt.fen(p_fen);
  v_t text := split_part(p_fen, ' ', 2);
  v_c text := case when split_part(p_fen, ' ', 3) = '-' then '' else split_part(p_fen, ' ', 3) end;
  v_e text := split_part(p_fen, ' ', 4);
  v_ep int := case when v_e = '-' or v_e = '' then -1 else (8 - substr(v_e, 2, 1)::int) * 8 + ascii(substr(v_e, 1, 1)) - 97 end;
  v_h int := coalesce(nullif(split_part(p_fen, ' ', 5), '')::int, 0);
begin
  return jsonb_build_object('b', array_to_string(v_bd, ''), 't', v_t, 'c', v_c, 'e', v_ep, 'h', v_h, 'k', jsonb_build_object(public.mp_chess_key(v_bd, v_t, v_c, v_ep), 1));
end $$;
-- Přepíše stav zápasu na pozici z FEN (a počet tahů); na tahu je podle FEN hráč 1 (bílý) nebo 2 (černý).
create or replace function tt.setg(mid uuid, p_fen text, p_moves int default 0) returns void language plpgsql security definer as $$
begin
  update public.mp_matches set gstate = tt.fen2g(p_fen), move_count = p_moves, turn = case when split_part(p_fen, ' ', 2) = 'w' then 1 else 2 end,
    turn_started = now(), deadline = now() + interval '300 seconds' where id = mid;
end $$;
create or replace function tt.cmv(n int, mid uuid, c text) returns jsonb language plpgsql as $$
declare s int;
begin
  select move_count + 1 into s from public.mp_matches where id = mid;
  return tt.mv(n, mid, s, jsonb_build_object('c', c));
end $$;
-- Odehraje tahy za sebou (mezerou oddělené souřadnice), hráči se střídají podle toho, kdo je na tahu; vrací poslední odpověď.
create or replace function tt.cplay(mid uuid, p_moves text) returns jsonb language plpgsql as $$
declare c text; r jsonb; t int;
begin
  foreach c in array string_to_array(p_moves, ' ') loop
    select turn into t from public.mp_matches where id = mid;
    r := tt.cmv(tt.who(mid, t), mid, c);
  end loop;
  return r;
end $$;
create or replace function tt.cfail(mid uuid, c text, p_code text, msg text) returns void language plpgsql as $$
declare t int; n int;
begin
  select turn into t from public.mp_matches where id = mid;
  n := tt.who(mid, t);
  perform tt.fails(n, format($q$select tt.cmv(%s, %L, %L)$q$, n, mid, c), p_code, msg);
end $$;
grant execute on all functions in schema tt to public;

-- pravidla a výpočty (bez zápasu)
select tt.ok(public.mp_rules('chess', 'duel', '{"tc":"5+3"}') ->> 'engine' = 'chess' and (public.mp_rules('koulovikamosi', 'duel', '{}') ->> 'engine') is null, 'pravidla šachů mají engine, ostatní hry ne');
select tt.ok(public.mp_chess_init() ->> 'b' = 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR' and public.mp_chess_init() ->> 'c' = 'KQkq', 'základní postavení');
select tt.ok(tt.perft('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -', 3) = 8902, 'perft: základní postavení, hloubka 3 = 8902');
select tt.ok(tt.perft('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -', 3) = 97862, 'perft: Kiwipete (rošády, braní, šachy), hloubka 3 = 97862');
select tt.ok(tt.perft('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -', 4) = 43238, 'perft: koncovka s braním mimochodem a přišpendlením, hloubka 4 = 43238');
select tt.ok(tt.perft('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -', 3) = 9467 and tt.perft('r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ -', 3) = 9467, 'perft: proměny a šachy (obě barvy), hloubka 3 = 9467');
select tt.ok(tt.perft('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -', 3) = 62379, 'perft: proměna se šachem a rošáda, hloubka 3 = 62379');
select tt.ok(public.mp_chess_insufficient(tt.fen('8/8/8/8/8/8/8/K6k w - -')) and public.mp_chess_insufficient(tt.fen('8/8/8/8/8/8/8/KB5k w - -')) and public.mp_chess_insufficient(tt.fen('8/8/8/8/8/8/8/KN5k w - -'))
  and public.mp_chess_insufficient(tt.fen('8/8/8/8/8/8/1b6/K1B4k w - -')), 'nedostatek materiálu: holí králové, král a lehká figura, dva střelci na stejné barvě');
select tt.ok(not public.mp_chess_insufficient(tt.fen('8/8/8/8/8/8/8/KP5k w - -')) and not public.mp_chess_insufficient(tt.fen('8/8/8/8/8/8/8/KR5k w - -')) and not public.mp_chess_insufficient(tt.fen('8/8/8/8/8/8/8/KNN4k w - -'))
  and not public.mp_chess_insufficient(tt.fen('8/8/8/8/8/8/8/KBb4k w - -')) and not public.mp_chess_insufficient(tt.fen('8/8/8/8/8/8/b7/K1B4k w - -')), 'a není: pěšec, věž, dva jezdci, střelci na různých barvách');
select tt.ok(public.mp_chess_can_mate(tt.fen('8/8/8/8/8/8/8/KN5k w - -'), true) = false and public.mp_chess_can_mate(tt.fen('8/8/8/8/8/8/8/KNB4k w - -'), true) and public.mp_chess_can_mate(tt.fen('8/8/8/8/8/8/8/KP5k w - -'), true), 'může strana ještě matovat: král s jednou lehkou figurou ne, se dvěma nebo s pěšcem ano');

-- zápas s pravidly na serveru
create temp table t_e as select tt.pair_chess(42, 43) as id;
select tt.ok(tt.row((select id from t_e)) -> 'rules' ->> 'engine' = 'chess' and tt.row((select id from t_e)) -> 'gstate' ->> 't' = 'w', 'nový šachový zápas má engine a základní postavení');
select tt.ok(not (tt.st(42, (select id from t_e)) -> 'match' ? 'gstate'), 'stav postavení se klientům neposílá (mají tahy)');
select tt.cfail((select id from t_e), 'e2e5', 'illegal_move', 'pěšec o tři pole se odmítne');
select tt.cfail((select id from t_e), 'e1e2', 'illegal_move', 'král na obsazené pole se odmítne');
select tt.cfail((select id from t_e), 'b1b3', 'illegal_move', 'jezdec nesmí táhnout jako pěšec');
select tt.cfail((select id from t_e), 'a1a3', 'illegal_move', 'věž přes vlastního pěšce nejde');
select tt.cfail((select id from t_e), 'e7e5', 'illegal_move', 'černou figurou táhnout nejde, když je na tahu bílý');
select tt.cfail((select id from t_e), 'e2e4q', 'illegal_move', 'proměna u tahu, který není proměna, se odmítne');
select tt.cfail((select id from t_e), 'e2e9', 'illegal_move', 'souřadnice mimo šachovnici se odmítne');
select tt.cfail((select id from t_e), 'xx', 'illegal_move', 'nesmyslná souřadnice se odmítne');
select tt.fails(42, format($$select public.mp_move(%L, 1, '{"m":1}')$$, (select id from t_e)), 'illegal_move', 'tah bez souřadnice se odmítne');
select tt.fails(42, format($$select public.mp_move(%L, 1, '"e2e4"')$$, (select id from t_e)), 'illegal_move', 'souřadnice jako holý text se odmítne (tah musí mít tvar {c: ...})');
select tt.ok((tt.row((select id from t_e)) ->> 'move_count')::int = 0 and tt.row((select id from t_e)) -> 'gstate' ->> 't' = 'w', 'odmítnuté tahy nic nezměnily');
select tt.ok(tt.cmv(tt.who((select id from t_e), 1), (select id from t_e), 'e2e4') @> '{"ok": true, "seq": 1, "turn": 2, "status": "active"}' and tt.row((select id from t_e)) -> 'gstate' ->> 't' = 'b', 'platný tah projde a na tahu je černý');
select tt.ok((select payload from public.mp_moves where match_id = (select id from t_e) and seq = 1) = '{"c": "e2e4"}', 'tah se uloží v čistém tvaru');
select tt.ok(tt.mv(tt.who((select id from t_e), 1), (select id from t_e), 1, '{"c":"e2e4","x":"navíc"}') @> '{"ok": true, "again": true}', 'opakované odeslání téhož tahu (i s přebytečným polem) projde jako opakování');
select tt.cfail((select id from t_e), 'e2e4', 'illegal_move', 'bílý pěšec už na e2 nestojí');
select tt.cfail((select id from t_e), 'a7a8', 'illegal_move', 'pěšec nepřeskočí pole');
-- hlášení výsledku klientem se u zápasu s pravidly na serveru nebere
select tt.ok(tt.rep(tt.who((select id from t_e), 1), (select id from t_e), 'win', 'checkmate') ->> 'status' = 'active' and tt.rep(tt.who((select id from t_e), 2), (select id from t_e), 'loss', 'checkmate') ->> 'status' = 'active', 'hlášení hráčů zápas neuzavře (výsledek určuje server)');
select tt.ok(tt.row((select id from t_e)) -> 'report1' is not distinct from 'null'::jsonb and tt.row((select id from t_e)) -> 'report2' is not distinct from 'null'::jsonb, 'a ani se neukládá');

-- mat: Scholarův mat (7 půltahů), vítěz je ten, kdo mat dal
select tt.cplay((select id from t_e), 'e7e5 d1h5 b8c6 f1c4 g8f6');
select tt.ok(tt.cmv(tt.who((select id from t_e), 1), (select id from t_e), 'h5f7') @> '{"ok": true, "status": "finished", "winner": 1, "reason": "checkmate"}', 'mat uzavře zápas: vyhrává bílý, důvod checkmate (odpověď na tah to rovnou hlásí)');
select tt.ok(tt.row((select id from t_e)) ->> 'status' = 'finished' and tt.row((select id from t_e)) ->> 'winner' = '1' and tt.row((select id from t_e)) ->> 'deadline' is null, 'zápas je uzavřený a bez limitu');
select tt.ok(tt.st(tt.who((select id from t_e), 2), (select id from t_e)) -> 'match' ->> 'reason' = 'checkmate' and tt.st(tt.who((select id from t_e), 2), (select id from t_e)) -> 'match' ->> 'winner' = '1', 'soupeř se o matu dozví ze stavu zápasu');
select tt.fails(tt.who((select id from t_e), 1), format($$select tt.cmv(%s, %L, 'a2a3')$$, tt.who((select id from t_e), 1), (select id from t_e)), 'not_active', 'po konci se táhnout nedá');
select tt.ok(tt.rep(tt.who((select id from t_e), 1), (select id from t_e), 'loss') ->> 'winner' = '1', 'pozdní hlášení výsledek nezmění');
select tt.ok(tt.mpearn(tt.who((select id from t_e), 1)) = 0, 'Scholarův mat (7 půltahů) nezíská odměnu: míň než 10 tahů');

-- remíza pozice, pat, nedostatek materiálu, padesát tahů (pozice z FEN)
create temp table t_e2 as select tt.pair_chess(44, 45) as id;
select tt.setg((select id from t_e2), 'k7/2K5/8/1Q6/8/8/8/8 w - - 0 1');
select tt.ok(tt.cmv(tt.who((select id from t_e2), 1), (select id from t_e2), 'b5b6') @> '{"status": "finished", "winner": 0, "reason": "stalemate"}', 'pat je remíza (winner 0)');
create temp table t_e3 as select tt.pair_chess(44, 45) as id;
select tt.setg((select id from t_e3), '7k/5n2/8/8/2B5/8/8/4K3 w - - 0 1');
select tt.ok(tt.cmv(tt.who((select id from t_e3), 1), (select id from t_e3), 'c4f7') @> '{"status": "finished", "winner": 0, "reason": "insufficient"}', 'vzetí poslední figury, po kterém zbyde král a střelec proti králi, je remíza (insufficient)');
create temp table t_e4 as select tt.pair_chess(44, 45) as id;
select tt.setg((select id from t_e4), 'k7/8/8/8/8/8/8/K6R w - - 98 80');
select tt.ok(tt.cmv(tt.who((select id from t_e4), 1), (select id from t_e4), 'a1b1') ->> 'status' = 'active', '99. půltah bez braní a tahu pěšcem ještě partii neukončí');
select tt.ok(tt.cmv(tt.who((select id from t_e4), 2), (select id from t_e4), 'a8b8') @> '{"status": "finished", "winner": 0, "reason": "fiftymove"}', '100. půltah bez braní a tahu pěšcem: remíza (fiftymove)');
create temp table t_e5 as select tt.pair_chess(44, 45) as id;
select tt.setg((select id from t_e5), 'k7/8/1K6/8/8/8/8/7Q w - - 99 80');
select tt.ok(tt.cmv(tt.who((select id from t_e5), 1), (select id from t_e5), 'h1h8') @> '{"status": "finished", "winner": 1, "reason": "checkmate"}', 'mat má přednost před pravidlem padesáti tahů');
create temp table t_e6 as select tt.pair_chess(44, 45) as id;
select tt.setg((select id from t_e6), 'k7/8/8/8/8/8/p7/K6R w - - 99 80');
select tt.ok(tt.cmv(tt.who((select id from t_e6), 1), (select id from t_e6), 'a1a2') @> '{"status": "active"}', 'braní nuluje počítadlo padesáti tahů (partie pokračuje)');
select tt.ok(tt.row((select id from t_e6)) -> 'gstate' ->> 'h' = '0', 'a počítadlo se vynuluje');
select tt.resign(44, (select id from t_e6));

-- trojí opakování pozice
create temp table t_e7 as select tt.pair_chess(46, 47) as id;
select tt.cplay((select id from t_e7), 'g1f3 g8f6 f3g1 f6g8');
select tt.ok(tt.row((select id from t_e7)) ->> 'status' = 'active', 'dvakrát stejná pozice partii neukončí');
select tt.cplay((select id from t_e7), 'g1f3 g8f6 f3g1');
select tt.ok(tt.row((select id from t_e7)) ->> 'status' = 'active', 'a tři půltahy před koncem také ne');
select tt.ok(tt.cplay((select id from t_e7), 'f6g8') @> '{"status": "finished", "winner": 0, "reason": "repetition"}', 'potřetí stejná pozice: remíza (repetition)');
create temp table t_e8 as select tt.pair_chess(46, 47) as id;
select tt.cplay((select id from t_e8), 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 e7e5 g1f3 e5e4');
select tt.ok(tt.row((select id from t_e8)) ->> 'status' = 'active' and jsonb_array_length(jsonb_path_query_array(tt.row((select id from t_e8)) -> 'gstate' -> 'k', '$.*')) <= 3, 'tah pěšcem opakování vynuluje (a paměť pozic se zmenší)');
select tt.resign(46, (select id from t_e8));

-- braní mimochodem, rošáda, proměna
create temp table t_e9 as select tt.pair_chess(48, 49) as id;
select tt.cplay((select id from t_e9), 'e2e4 a7a6 e4e5 d7d5');
select tt.ok(tt.cplay((select id from t_e9), 'e5d6') ->> 'ok' = 'true' and substr(tt.row((select id from t_e9)) -> 'gstate' ->> 'b', 28, 1) = '.', 'braní mimochodem hned po dvojkroku jde a sebraný pěšec zmizí');
select tt.resign(48, (select id from t_e9));
create temp table t_e10 as select tt.pair_chess(48, 49) as id;
select tt.cplay((select id from t_e10), 'e2e4 a7a6 e4e5 d7d5 h2h3 a6a5');
select tt.cfail((select id from t_e10), 'e5d6', 'illegal_move', 'braní mimochodem o tah později už nejde');
select tt.resign(48, (select id from t_e10));
create temp table t_e11 as select tt.pair_chess(48, 49) as id;
select tt.setg((select id from t_e11), '5r1k/8/8/8/8/8/8/R3K2R w KQ - 0 1');
select tt.cfail((select id from t_e11), 'e1g1', 'illegal_move', 'rošáda přes napadené pole (f1) se odmítne');
select tt.ok(tt.cmv(tt.who((select id from t_e11), 1), (select id from t_e11), 'e1c1') ->> 'ok' = 'true' and (select tt.row(id) -> 'gstate' ->> 'b' from t_e11) like '%..KR%', 'dlouhá rošáda tam, kde napadené pole není na cestě krále, jde a věž přeskočí krále');
select tt.resign(48, (select id from t_e11));
create temp table t_e12 as select tt.pair_chess(48, 49) as id;
select tt.setg((select id from t_e12), '4r2k/8/8/8/8/8/8/R3K2R w KQ - 0 1');
select tt.cfail((select id from t_e12), 'e1g1', 'illegal_move', 'rošáda z šachu se odmítne');
select tt.cfail((select id from t_e12), 'e1c1', 'illegal_move', 'ani na druhou stranu');
select tt.cfail((select id from t_e12), 'e1e2', 'illegal_move', 'z šachu se nedá utéct po stejném sloupci');
select tt.cfail((select id from t_e12), 'a1a2', 'illegal_move', 'a šach se musí řešit: tah jinou figurou, který ho nechá, se odmítne');
select tt.ok(tt.cmv(tt.who((select id from t_e12), 1), (select id from t_e12), 'e1d1') ->> 'ok' = 'true', 'ze šachu se uhnout dá (král na d1)');
select tt.resign(48, (select id from t_e12));

-- proměna pěšce
create temp table t_e14 as select tt.pair_chess(46, 47) as id;
select tt.setg((select id from t_e14), '8/P6k/8/8/8/8/8/K7 w - - 0 1');
select tt.cfail((select id from t_e14), 'a7a8', 'illegal_move', 'pěšec na poslední řadě bez zvolené figury se odmítne');
select tt.cfail((select id from t_e14), 'a7a8k', 'illegal_move', 'proměna v krále se odmítne');
select tt.cfail((select id from t_e14), 'a7a8p', 'illegal_move', 'a v pěšce také');
select tt.ok(tt.cmv(tt.who((select id from t_e14), 1), (select id from t_e14), 'a7a8n') ->> 'ok' = 'true' and substr(tt.row((select id from t_e14)) -> 'gstate' ->> 'b', 1, 1) = 'N', 'proměna v jezdce: na a8 stojí bílý jezdec');
select tt.resign(46, (select id from t_e14));
create temp table t_e15 as select tt.pair_chess(46, 47) as id;
select tt.setg((select id from t_e15), '8/P6k/8/8/8/8/8/K7 w - - 0 1');
select tt.ok(tt.cmv(tt.who((select id from t_e15), 1), (select id from t_e15), 'a7a8q') ->> 'ok' = 'true' and substr(tt.row((select id from t_e15)) -> 'gstate' ->> 'b', 1, 1) = 'Q', 'proměna v dámu');
select tt.resign(46, (select id from t_e15));

-- čas: komu vyprší čas, prohrává, ale jen když soupeř ještě může matovat
create temp table t_e16 as select tt.pair_chess(42, 43) as id;
select tt.setg((select id from t_e16), 'k7/8/8/8/8/8/1r6/K7 w - - 0 1');
select tt.ff((select id from t_e16), 400);
select tt.ok(tt.st(42, (select id from t_e16)) -> 'match' ->> 'status' = 'finished' and tt.row((select id from t_e16)) ->> 'winner' = '2' and tt.row((select id from t_e16)) ->> 'reason' = 'timeout', 'vypršel čas bílému a černý má věž: vyhrává černý (timeout)');
create temp table t_e17 as select tt.pair_chess(42, 43) as id;
select tt.setg((select id from t_e17), 'k7/8/8/8/8/8/n7/K1R5 w - - 0 1');
select tt.ff((select id from t_e17), 400);
select tt.ok(tt.st(42, (select id from t_e17)) -> 'match' ->> 'status' = 'finished' and tt.row((select id from t_e17)) ->> 'winner' = '0' and tt.row((select id from t_e17)) ->> 'reason' = 'timeout-material', 'vypršel čas bílému, ale černý má jen krále a jezdce: remíza (timeout-material)');
create temp table t_e18 as select tt.pair_chess(42, 43) as id;
select tt.setg((select id from t_e18), 'k7/8/8/8/8/8/n7/K1R5 w - - 0 1', 1);
update public.mp_matches set bank1 = 5 where id = (select id from t_e18);
select tt.ff((select id from t_e18), 10);
select tt.ok(tt.cmv(tt.who((select id from t_e18), 1), (select id from t_e18), 'c1c8') @> '{"ok": false, "error": "timeout"}' and tt.row((select id from t_e18)) ->> 'winner' = '0' and tt.row((select id from t_e18)) ->> 'reason' = 'timeout-material', 'tah po vypršení hodin: soupeř bez materiálu na mat jen remizuje');
create temp table t_e19 as select tt.pair_chess(42, 43) as id;
select tt.setg((select id from t_e19), 'k7/8/8/8/8/8/1r6/K7 w - - 0 1', 1);
update public.mp_matches set bank1 = 5 where id = (select id from t_e19);
select tt.ff((select id from t_e19), 10);
select tt.ok(tt.cmv(tt.who((select id from t_e19), 1), (select id from t_e19), 'a1b2') @> '{"ok": false, "error": "timeout"}' and tt.row((select id from t_e19)) ->> 'winner' = '2' and tt.row((select id from t_e19)) ->> 'reason' = 'timeout', 'a s věží prohrává ten, komu hodiny došly, i při pokusu o tah');

-- odměna: vítěz vyhrané partie (aspoň 10 tahů, aspoň 45 vteřin) dostane Coiny, remíza nikdo
create temp table t_e20 as select tt.pair_chess(44, 45) as id;
create temp table t_e20c as select tt.coins(44) c44, tt.coins(45) c45;
select tt.setg((select id from t_e20), 'k7/8/1K6/8/8/8/8/7Q w - - 0 1', 10);
select tt.ff((select id from t_e20), 60);
select tt.ok(tt.cmv(tt.who((select id from t_e20), 1), (select id from t_e20), 'h1h8') @> '{"status": "finished", "winner": 1, "reason": "checkmate"}', 'mat po dostatečně dlouhé partii');
select tt.ok(tt.coins(tt.who((select id from t_e20), 1)) - (case when tt.who((select id from t_e20), 1) = 44 then (select c44 from t_e20c) else (select c45 from t_e20c) end) = 30, 'vítěz dostane 30 Coinů za výhru');
select tt.ok(tt.coins(tt.who((select id from t_e20), 2)) = (case when tt.who((select id from t_e20), 2) = 44 then (select c44 from t_e20c) else (select c45 from t_e20c) end), 'poražený nic');
create temp table t_e21 as select tt.pair_chess(44, 45) as id;
create temp table t_e21c as select tt.coins(44) c44, tt.coins(45) c45;
select tt.setg((select id from t_e21), 'k7/2K5/8/1Q6/8/8/8/8 w - - 0 1', 10);
select tt.ff((select id from t_e21), 60);
select tt.cmv(tt.who((select id from t_e21), 1), (select id from t_e21), 'b5b6');
select tt.ok(tt.coins(44) = (select c44 from t_e21c) and tt.coins(45) = (select c45 from t_e21c) and tt.row((select id from t_e21)) ->> 'winner' = '0', 'remíza (pat) žádné Coiny nepřinese');
-- vzdání platí jako dřív
create temp table t_e22 as select tt.pair_chess(46, 47) as id;
select tt.cplay((select id from t_e22), 'e2e4 e7e5');
select tt.ok(tt.resign(tt.who((select id from t_e22), 1), (select id from t_e22)) @> '{"status": "finished", "winner": 2, "reason": "resign"}', 'vzdání v zápase s pravidly na serveru');
-- zápasy založené před aktualizací pravidla nemají
create temp table t_e23 as select tt.pair(46, 47, 'chess') as id;
select tt.ok(not (tt.row((select id from t_e23)) -> 'rules' ? 'engine') and tt.row((select id from t_e23)) -> 'gstate' = 'null'::jsonb, 'zápas založený před aktualizací nemá engine ani stav postavení');
select tt.ok(tt.cmv(tt.who((select id from t_e23), 1), (select id from t_e23), 'e2e5') ->> 'ok' = 'true', 'a hlídá jen pořadí a čas jako dřív (libovolný tah projde)');
select tt.resign(46, (select id from t_e23));
-- pomocné funkce serveru nejsou pro klienty
select tt.ok(not has_function_privilege('authenticated', 'public.mp_chess_step(jsonb, smallint, text)', 'execute') and not has_function_privilege('anon', 'public.mp_chess_try(text[], text, int, int, int, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.mp_timeout_result(public.mp_matches, smallint)', 'execute') and not has_function_privilege('authenticated', 'public.mp_chess_moves(text[], text, int, boolean)', 'execute'), 'pravidla šachů nemůže volat klient přímo');

-- ===== Ostatní tahové hry: tvar a meze tahů (Kouloví Kámoši, Warroom, Hannibal) =====
select tt.mmk(n) from generate_series(50, 55) n;
-- Tah hráče, který je na řadě (číslo tahu se doplní).
create or replace function tt.xmv(mid uuid, p_payload jsonb, e boolean default true) returns jsonb language plpgsql as $$
declare t int; s int;
begin
  select turn, move_count + 1 into t, s from public.mp_matches where id = mid;
  return tt.mv(tt.who(mid, t), mid, s, p_payload, e);
end $$;
create or replace function tt.xfail(mid uuid, p_payload jsonb, msg text, e boolean default true) returns void language plpgsql as $$
declare t int; s int; n int;
begin
  select turn, move_count + 1 into t, s from public.mp_matches where id = mid;
  n := tt.who(mid, t);
  perform tt.fails(n, format($q$select public.mp_move(%L, %s, %L::jsonb, %L)$q$, mid, s, p_payload::text, e), 'illegal_move', msg);
end $$;
-- Koule do misky: [typ, fáze, osm bodů x, y]
create or replace function tt.ball(t int, x numeric default 200) returns jsonb language sql immutable as $$
  select jsonb_build_array(t, 0.5) || (select jsonb_agg(v order by i, j) from (select i, j, case when j = 0 then x + i else 500 end as v from generate_series(0, 7) i, generate_series(0, 1) j) q)
$$;
grant execute on all functions in schema tt to public;
select tt.ok(jsonb_array_length(tt.ball(0)) = 18, 'zkušební koule má 18 čísel');
select tt.ok((select count(*) from (values (920370032,0,2),(3761641487,7,1),(2252023330,14,3),(1475571481,21,2),(2340457892,28,3),(1600748723,35,3),(1240767094,42,1),(2297155421,49,1),(1696368920,6,1),(551123351,13,0),(1839942154,20,0),(1218163169,27,0),(1412407756,34,0),(1245541051,41,0),(2978433246,48,0),(1157896869,5,3),(4200532928,12,2),(4155575327,19,1),(2319969010,26,1),(3679735209,33,3),(2351512308,40,1),(2312645059,47,0),(1897382982,4,1),(2645413613,11,0),(3017401192,18,1),(1682108327,25,3),(1721805018,32,1),(4079510129,39,0),(1237186844,46,1),(1163723,3,0),(1029680302,10,3),(1444285493,17,0),(2509746192,24,0),(1993950255,31,3),(2134451138,38,0),(4102492217,45,0),(223509572,2,1),(3922090707,9,0),(38576662,16,0),(3071144573,23,0)) v(seed,k,t) where public.mp_koulovi_type(seed, k) <> t) = 0, 'typ koule ze semínka sedí s hrou (40 kombinací semínka a pořadí, i semínka nad 2^31)');

create temp table t_k1 as select tt.pair_new(50, 51, 'koulovikamosi') as id;
create temp table t_k1s as select (tt.row((select id from t_k1)) ->> 'seed')::bigint as seed;
select tt.ok(not (tt.row((select id from t_k1)) -> 'rules' ? 'engine') and tt.row((select id from t_k1)) -> 'rules' ->> 'check' = 'shape', 'Kouloví Kámoši mají jen kontrolu tvaru tahů (bez enginu pravidel)');
select tt.xfail((select id from t_k1), jsonb_build_object('d', 1, 'k', 0, 'x', 200, 't', (public.mp_koulovi_type((select seed from t_k1s), 0) + 1) % 4), 'hod s jinou koulí, než určuje pořadí ze semínka, se odmítne', false);
select tt.xfail((select id from t_k1), jsonb_build_object('d', 1, 'k', 1, 'x', 200, 't', public.mp_koulovi_type((select seed from t_k1s), 1)), 'hod se špatným pořadím se odmítne', false);
select tt.xfail((select id from t_k1), jsonb_build_object('d', 1, 'k', 0, 'x', 9999, 't', public.mp_koulovi_type((select seed from t_k1s), 0)), 'hod mimo misku se odmítne', false);
select tt.xfail((select id from t_k1), jsonb_build_object('d', 1, 'k', 0, 'x', 200, 't', public.mp_koulovi_type((select seed from t_k1s), 0), 'z', 1), 'hod s přebytečným polem se odmítne', false);
select tt.xfail((select id from t_k1), '{"k":0}'::jsonb, 'zpráva bez hodu i stavu misky se odmítne', false);
select tt.xfail((select id from t_k1), '"hod"'::jsonb, 'zpráva, která není objekt, se odmítne', false);
select tt.ok(tt.xmv((select id from t_k1), jsonb_build_object('d', 1, 'k', 0, 'x', 200, 't', public.mp_koulovi_type((select seed from t_k1s), 0)), false) ->> 'ok' = 'true', 'hod se správnou koulí projde a hráč zůstává na tahu');
select tt.xfail((select id from t_k1), jsonb_build_object('r', 1, 'k', 0, 'b', jsonb_build_array(tt.ball(0), tt.ball(0, 300))), 'po hodu přibude do misky nejvýš jedna koule', true);
select tt.xfail((select id from t_k1), jsonb_build_object('r', 1, 'k', 0, 'b', jsonb_build_array(jsonb_build_array(0, 1, 2, 3))), 'koule se špatným počtem čísel se odmítne', true);
select tt.xfail((select id from t_k1), jsonb_build_object('r', 1, 'k', 0, 'b', jsonb_build_array(tt.ball(99))), 'koule neznámého typu se odmítne', true);
select tt.xfail((select id from t_k1), jsonb_build_object('r', 1, 'k', 0, 'b', jsonb_build_array(jsonb_set(tt.ball(0), '{4}', '99999'))), 'koule daleko mimo misku se odmítne', true);
select tt.xfail((select id from t_k1), '{"r":1,"k":0,"b":"nic"}'::jsonb, 'stav misky, který není seznam, se odmítne', true);
select tt.xfail((select id from t_k1), '{"r":1,"k":0,"b":[]}'::jsonb, 'prázdná miska po hodu je nemožná', true);
select tt.xfail((select id from t_k1), '{"r":1,"k":0,"out":2}'::jsonb, 'vypadnutí koule se hlásí jen jako out: 1', true);
create temp table t_k1t as select turn from public.mp_matches where id = (select id from t_k1);
select tt.ok(tt.xmv((select id from t_k1), jsonb_build_object('r', 1, 'k', 0, 'b', jsonb_build_array(tt.ball(0))), true) ->> 'turn' = (3 - (select turn from t_k1t))::text, 'platný stav misky předá tah soupeři');
select tt.ok(tt.xmv((select id from t_k1), jsonb_build_object('d', 1, 'k', 1, 'x', 250.5, 't', public.mp_koulovi_type((select seed from t_k1s), 1)), false) ->> 'ok' = 'true', 'soupeř hází druhou koulí v pořadí');
select tt.ok(tt.xmv((select id from t_k1), jsonb_build_object('r', 1, 'k', 1, 'b', jsonb_build_array(tt.ball(0), tt.ball(1, 300))), true) ->> 'ok' = 'true', 'a po jeho hodu jsou v misce dvě koule');
select tt.ok(tt.xmv((select id from t_k1), jsonb_build_object('d', 1, 'k', 2, 'x', 250, 't', public.mp_koulovi_type((select seed from t_k1s), 2)), false) ->> 'ok' = 'true', 'pořadí koulí pokračuje (třetí hod)');
select tt.xfail((select id from t_k1), jsonb_build_object('r', 1, 'k', 2, 'b', jsonb_build_array(tt.ball(0), tt.ball(1, 300), tt.ball(1, 100), tt.ball(2, 400))), 'ze dvou koulí po hodu nemůžou být čtyři', true);
select tt.ok(tt.xmv((select id from t_k1), '{"r":1,"k":2,"out":1}'::jsonb, true) ->> 'ok' = 'true', 'vypadnutí koule se ohlásí jako out');
select tt.resign(50, (select id from t_k1));

-- Warroom: den {t:'a', k, adv, m, d, w, l}
create temp table t_w as select tt.pair_new(52, 53, 'warroom') as id;
select tt.xfail((select id from t_w), '{"t":"a","k":2,"adv":10}'::jsonb, 'den se špatným pořadím se odmítne');
select tt.xfail((select id from t_w), '{"t":"b","k":1,"adv":10}'::jsonb, 'jiný druh zprávy se odmítne');
select tt.xfail((select id from t_w), '{"t":"a","k":1,"adv":-5}'::jsonb, 'záporný posun fronty se odmítne');
select tt.xfail((select id from t_w), '{"t":"a","k":1,"adv":99999}'::jsonb, 'nesmyslně velký posun fronty se odmítne');
select tt.xfail((select id from t_w), '{"t":"a","k":1,"adv":"deset"}'::jsonb, 'posun, který není číslo, se odmítne');
select tt.xfail((select id from t_w), '{"t":"a","k":1,"adv":10,"d":"atomovka"}'::jsonb, 'neznámá doktrína se odmítne');
select tt.xfail((select id from t_w), '{"t":"a","k":1,"adv":10,"extra":1}'::jsonb, 'zpráva s přebytečným polem se odmítne');
select tt.xfail((select id from t_w), '{"t":"a","k":1,"adv":10,"w":1,"l":1}'::jsonb, 'výhra i prohra naráz se odmítne');
select tt.xfail((select id from t_w), jsonb_build_object('t', 'a', 'k', 1, 'adv', 10, 'm', repeat('x', 301)), 'příliš dlouhý popis dne se odmítne');
select tt.xfail((select id from t_w), '{"t":"a","k":1,"adv":0,"w":1}'::jsonb, 'výhra hned první den bez postupu fronty se odmítne');
select tt.ok(tt.xmv((select id from t_w), '{"t":"a","k":1,"adv":40,"m":"Útok","d":"fortress"}'::jsonb) ->> 'ok' = 'true', 'platný první den s doktrínou projde');
select tt.xfail((select id from t_w), '{"t":"a","k":2,"adv":10}'::jsonb, 'druhý hráč má vlastní pořadí dnů: jeho první den je k = 1, ne 2');
select tt.ok(tt.xmv((select id from t_w), '{"t":"a","k":1,"adv":30,"d":"blitz"}'::jsonb) ->> 'ok' = 'true', 'druhý hráč začíná od k = 1');
select tt.xfail((select id from t_w), '{"t":"a","k":2,"adv":10,"d":"fortress"}'::jsonb, 'doktrínu lze poslat jen první den');
select tt.xfail((select id from t_w), '{"t":"a","k":2,"adv":10,"w":1}'::jsonb, 'výhra po 50 bodech postupu se odmítne (fronta se musí dotlačit z poloviny na maximum)');
select tt.ok(tt.xmv((select id from t_w), '{"t":"a","k":2,"adv":120,"w":1}'::jsonb) ->> 'ok' = 'true', 'výhra po dostatečném postupu projde');
select tt.resign(52, (select id from t_w));

-- Hannibal: tah {t:'turn', k, a, h, e}
create temp table t_h as select tt.pair_new(54, 55, 'hannibal', 'duel', '{"preset":"small"}') as id;
select tt.xfail((select id from t_h), '{"t":"turn","k":1,"a":[],"h":5,"e":0}'::jsonb, 'tah se špatným pořadím se odmítne (první má k = 0)');
select tt.xfail((select id from t_h), '{"t":"turn","k":0,"a":[["x"]],"h":5,"e":0}'::jsonb, 'neznámá akce se odmítne');
select tt.xfail((select id from t_h), '{"t":"turn","k":0,"a":[["m","u1",12,0]],"h":5,"e":0}'::jsonb, 'pohyb mimo mapu (sloupec 12) se odmítne');
select tt.xfail((select id from t_h), '{"t":"turn","k":0,"a":[["m","u1",3]],"h":5,"e":0}'::jsonb, 'pohyb bez řady se odmítne');
select tt.xfail((select id from t_h), '{"t":"turn","k":0,"a":[["a","u1"]],"h":5,"e":0}'::jsonb, 'útok bez cíle se odmítne');
select tt.xfail((select id from t_h), '{"t":"turn","k":0,"a":"nic","h":5,"e":0}'::jsonb, 'akce, které nejsou seznam, se odmítnou');
select tt.xfail((select id from t_h), '{"t":"turn","k":0,"a":[],"h":-1,"e":0}'::jsonb, 'záporný otisk stavu se odmítne');
select tt.xfail((select id from t_h), '{"t":"turn","k":0,"a":[],"h":4294967296,"e":0}'::jsonb, 'otisk větší než 32 bitů se odmítne');
select tt.xfail((select id from t_h), '{"t":"turn","k":0,"a":[],"h":1.5,"e":0}'::jsonb, 'otisk, který není celé číslo, se odmítne');
select tt.xfail((select id from t_h), '{"t":"turn","k":0,"a":[],"h":5,"e":3}'::jsonb, 'příznak konce jen 0 nebo 1');
select tt.xfail((select id from t_h), '{"t":"turn","k":0,"a":[],"h":5,"e":0,"x":1}'::jsonb, 'zpráva s přebytečným polem se odmítne');
select tt.xfail((select id from t_h), jsonb_build_object('t', 'turn', 'k', 0, 'a', (select jsonb_agg(jsonb_build_array('u')) from generate_series(1, 151)), 'h', 5, 'e', 0), 'víc než 150 akcí v jednom tahu se odmítne');
select tt.ok(tt.xmv((select id from t_h), '{"t":"turn","k":0,"a":[["m","u1",3,2],["a","u1","e3"],["b",7],["u"]],"h":123456,"e":0}'::jsonb) ->> 'ok' = 'true', 'platný tah s pohybem, útokem, schopností a vrácením projde');
select tt.xfail((select id from t_h), '{"t":"turn","k":0,"a":[],"h":5,"e":0}'::jsonb, 'druhý hráč nemůže poslat k = 0 znovu');
select tt.ok(tt.xmv((select id from t_h), '{"t":"turn","k":1,"a":[],"h":4294967295,"e":1}'::jsonb) ->> 'ok' = 'true', 'tah bez akcí a s koncem bitvy projde');
select tt.resign(54, (select id from t_h));
-- zápas, který skončil, se dál neřeší; pomocné funkce nejsou pro klienty
select tt.ok(not has_function_privilege('authenticated', 'public.mp_check_payload(public.mp_matches, smallint, jsonb)', 'execute') and not has_function_privilege('authenticated', 'public.mp_koulovi_type(bigint, int)', 'execute'), 'kontrolu tahů nemůže volat klient přímo');


-- ===== Žebříček, rychlé reakce a odveta =====
select tt.mmk(n) from generate_series(56, 59) n;
-- zápasy z dřívějších částí testu žebříček už naplnily (27 hráčů v šachách): pro zkoušku pořadí se začíná čistý
select tt.ok((select count(*) from public.mp_record where game_id = 'chess') >= 20, 'dřívější zápasy testu už zapsaly výsledky do žebříčku');
delete from public.mp_record;
-- Odehraje zápas dvou účtů do konce: dost tahů a času, pak vzdá ten, kdo je na řadě po p_loser_n (vyhrává druhý). Vrací id zápasu.
create or replace function tt.played(a int, b int, p_loser int, g text default 'chess', m text default 'duel') returns uuid language plpgsql as $$
declare v_id uuid;
begin
  v_id := tt.pair(a, b, g, m);
  perform tt.play(v_id, 10);
  perform tt.ff(v_id, 60);
  perform tt.resign(p_loser, v_id);
  return v_id;
end $$;
grant execute on all functions in schema tt to public;

-- žebříček: zápas s dost tahy a dostatečně dlouhý se započítá, krátký ne
create temp table t_l0 as select tt.pair(56, 57, 'chess') as id;
select tt.play((select id from t_l0), 2);
select tt.resign(56, (select id from t_l0));
select tt.ok((select count(*) from public.mp_record where user_id in (tt.mu(56), tt.mu(57))) = 0, 'krátký zápas (vzdaný po dvou tazích) se do žebříčku nepočítá');
create temp table t_l1 as select tt.played(56, 57, 57) as id;   -- vyhrává 56
select tt.ok((select rating from public.mp_record where user_id = tt.mu(56) and game_id = 'chess') = 1016 and (select rating from public.mp_record where user_id = tt.mu(57) and game_id = 'chess') = 984, 'řádně odehraná výhra: vítěz 1016, poražený 984 (Elo, K = 32)');
select tt.ok((select wins from public.mp_record where user_id = tt.mu(56) and game_id = 'chess') = 1 and (select losses from public.mp_record where user_id = tt.mu(57) and game_id = 'chess') = 1, 'výhry a prohry se započítají');
create temp table t_l2 as select tt.played(56, 57, 57) as id;
select tt.ok((select rating from public.mp_record where user_id = tt.mu(56) and game_id = 'chess') = 1031 and (select rating from public.mp_record where user_id = tt.mu(57) and game_id = 'chess') = 969, 'druhá výhra nad slabším: míň bodů (1031 a 969)');
select tt.ok(not exists (select 1 from public.mp_record where user_id in (tt.mu(56), tt.mu(57)) and game_id <> 'chess'), 'záznam je jen v zahrané hře');
-- remíza: oba hlásí draw
create temp table t_l3 as select tt.pair(56, 57, 'chess') as id;
select tt.play((select id from t_l3), 10);
select tt.ff((select id from t_l3), 60);
select tt.rep(56, (select id from t_l3), 'draw'); select tt.rep(57, (select id from t_l3), 'draw');
select tt.ok((select draws from public.mp_record where user_id = tt.mu(56) and game_id = 'chess') = 1 and (select rating from public.mp_record where user_id = tt.mu(56) and game_id = 'chess') between 1016 and 1030, 'remíza: počítá se jako remíza a silnější hráč o pár bodů přijde');
-- týmová hra: výhry bez hodnocení
create temp table t_l4 as select tt.pair(58, 59, 'rocket', 'coop') as id;
select tt.ff((select id from t_l4), 70);
select tt.rep(58, (select id from t_l4), 'win'); select tt.rep(59, (select id from t_l4), 'win');
select tt.ok((select wins from public.mp_record where user_id = tt.mu(58) and game_id = 'rocket' and mode = 'coop') = 1 and (select rating from public.mp_record where user_id = tt.mu(58) and game_id = 'rocket' and mode = 'coop') = 1000, 'týmová hra: výhra oběma, hodnocení se nemění');
-- čtení žebříčku
select tt.as_mu(56);
select tt.ok((public.mp_leaderboard('chess', 'duel', 10) -> 'rows' -> 0 ->> 'rank') = '1' and (public.mp_leaderboard('chess', 'duel', 10) -> 'rows' -> 0 ->> 'name') = 'Hrac56' and (public.mp_leaderboard('chess', 'duel', 10) -> 'rows' -> 0 ->> 'me')::boolean, 'žebříček: první je Hrac56, je to volající');
select tt.ok((public.mp_leaderboard('chess', 'duel', 10) -> 'rows' -> 1 ->> 'name') = 'Hrac57' and (public.mp_leaderboard('chess', 'duel', 10) -> 'rows' -> 1 ->> 'me')::boolean = false and (public.mp_leaderboard('chess', 'duel', 10) ->> 'players')::int = 2, 'druhý je Hrac57 a hráčů je dva');
select tt.ok((public.mp_leaderboard('chess', 'duel', 1) -> 'rows' -> 1) is null and (public.mp_leaderboard('chess', 'duel', 1) -> 'me' ->> 'rank') = '1', 'limit řádků platí a pozice volajícího je vždy vedle');
select tt.as_mu(57);
select tt.ok((public.mp_leaderboard('chess', 'duel', 1) -> 'me' ->> 'rank') = '2' and (public.mp_leaderboard('chess', 'duel', 1) -> 'me' ->> 'losses') = '2', 'poražený vidí svou pozici mimo seznam');
select tt.ok(public.mp_leaderboard('hannibal', 'duel') -> 'rows' = '[]'::jsonb and public.mp_leaderboard('hannibal', 'duel') -> 'me' = 'null'::jsonb, 'žebříček hry, ve které nikdo nehrál, je prázdný');
select tt.as_mu(58);
select tt.ok((public.mp_leaderboard('rocket', 'coop') ->> 'team')::boolean and (public.mp_leaderboard('rocket', 'coop') -> 'rows' -> 0 ->> 'wins') = '1', 'týmový žebříček řadí podle výher');
select tt.fails(58, $$select public.mp_leaderboard('nope', 'duel')$$, 'unknown_mode', 'neznámá hra v žebříčku');
select tt.fails(null, $$select public.mp_leaderboard('chess', 'duel')$$, 'not_authenticated', 'žebříček jen pro přihlášené');
select tt.ok(not has_table_privilege('authenticated', 'public.mp_record', 'select') and not has_table_privilege('authenticated', 'public.mp_record', 'insert') and not has_table_privilege('authenticated', 'public.mp_record', 'update')
  and not has_table_privilege('anon', 'public.mp_record', 'select') and (select relrowsecurity from pg_class where oid = 'public.mp_record'::regclass), 'tabulku žebříčku klient nečte ani nezapíše přímo (práva odebraná, RLS zapnutá)');
set role authenticated;
select tt.fails(58, $$select count(*) from public.mp_record$$, '42501', 'přihlášený hráč nepřečte tabulku žebříčku přímo');
select tt.fails(58, $$update public.mp_record set rating = 3000$$, '42501', 'a hodnocení si nepřepíše');
reset role;
select tt.ok(not has_function_privilege('anon', 'public.mp_leaderboard(text, text, int)', 'execute') and has_function_privilege('authenticated', 'public.mp_leaderboard(text, text, int)', 'execute') and not has_function_privilege('authenticated', 'public.mp_record_result(uuid)', 'execute'), 'oprávnění: žebříček smí číst přihlášený, zapisovat jen server');

-- rychlé reakce
create temp table t_em as select tt.pair(56, 57, 'chess') as id;
select tt.ok((tt.st(57, (select id from t_em)) -> 'match' -> 'opp_emote') = 'null'::jsonb, 'bez reakce je opp_emote prázdné');
select tt.as_mu(56);
select tt.ok(public.mp_emote((select id from t_em), 4) = '{"ok": true}', 'reakce se pošle');
select tt.ok((tt.st(57, (select id from t_em)) -> 'match' -> 'opp_emote' ->> 'c') = '4' and (tt.st(57, (select id from t_em)) -> 'match' -> 'opp_emote' ->> 'n') = '1' and ((tt.st(57, (select id from t_em)) -> 'match' -> 'opp_emote' ->> 'age')::bigint) < 5000, 'soupeř ji vidí (kód 4, pořadí 1, čerstvá)');
select tt.ok((tt.st(56, (select id from t_em)) -> 'match' -> 'opp_emote') = 'null'::jsonb, 'odesílatel svou reakci jako soupeřovu nevidí');
select tt.fails(56, format($$select public.mp_emote(%L, 5)$$, (select id from t_em)), 'too_soon', 'druhá reakce hned po první se odmítne (jedna za 3 vteřiny)');
update public.mp_matches set emotes = jsonb_set(emotes, array[tt.slot((select id from t_em), 56)::text, 'at'], to_jsonb((extract(epoch from now()) * 1000)::bigint - 5000)) where id = (select id from t_em);
select tt.ok(public.mp_emote((select id from t_em), 5) = '{"ok": true}' and (tt.st(57, (select id from t_em)) -> 'match' -> 'opp_emote' ->> 'n') = '2', 'po odstupu jde další a má vyšší pořadí');
select tt.fails(56, format($$select public.mp_emote(%L, 0)$$, (select id from t_em)), 'invalid_emote', 'kód 0 neexistuje');
select tt.fails(56, format($$select public.mp_emote(%L, 9)$$, (select id from t_em)), 'invalid_emote', 'kód 9 neexistuje');
select tt.fails(56, format($$select public.mp_emote(%L, null)$$, (select id from t_em)), 'invalid_emote', 'chybějící kód se odmítne');
select tt.fails(58, format($$select public.mp_emote(%L, 1)$$, (select id from t_em)), 'not_in_match', 'cizí hráč reakci nepošle');
select tt.resign(56, (select id from t_em));
select tt.fails(57, format($$select public.mp_emote(%L, 1)$$, (select id from t_em)), 'not_active', 'po konci zápasu reakce nejdou');

-- odveta (t_em je právě skončený zápas 56 vs 57 vzdáním)
create temp table t_rm1 as select tt.pair(58, 59, 'chess') as id;
select tt.fails(58, format($$select public.mp_rematch(%L)$$, (select id from t_rm1)), 'not_finished', 'odveta za běžící zápas nejde');
select tt.resign(58, (select id from t_rm1));
select tt.ok(public.mp_rematch((select id from t_rm1)) = '{"status": "waiting"}', 'první hráč chce odvetu: čeká');
select tt.ok((tt.st(59, (select id from t_rm1)) -> 'match' -> 'rematch' ->> 'theirs') = 'true' and (tt.st(59, (select id from t_rm1)) -> 'match' -> 'rematch' ->> 'mine') = 'false', 'soupeř vidí, že chce odvetu');
select tt.as_mu(58);
select tt.ok(public.mp_rematch((select id from t_rm1)) ->> 'status' = 'waiting', 'opakované ptaní nic nevytvoří');
select tt.as_mu(59);
create temp table t_rm2 as select public.mp_rematch((select id from t_rm1)) as r;
select tt.ok((select r ->> 'status' from t_rm2) = 'matched' and (select r -> 'match' ->> 'game' from t_rm2) = 'chess', 'když ji chce i druhý, vznikne nový zápas');
select tt.ok((select (r -> 'match' ->> 'slot')::int from t_rm2) = case when tt.slot((select id from t_rm1), 59) = 1 then 2 else 1 end, 'strany (barvy) se prohodí');
select tt.ok((select tt.row((r -> 'match' ->> 'id')::uuid) -> 'rules' ->> 'engine' from t_rm2) = 'chess' and (select r -> 'match' -> 'params' ->> 'tc' from t_rm2) = '5+3', 'nový zápas má stejné volby a pravidla na serveru');
select tt.as_mu(58);
select tt.ok(public.mp_rematch((select id from t_rm1)) -> 'match' ->> 'id' = (select r -> 'match' ->> 'id' from t_rm2), 'první hráč dostane při dalším ptaní tentýž nový zápas');
select tt.ok((tt.st(58, (select id from t_rm1)) -> 'match' -> 'rematch' ->> 'next') = (select r -> 'match' ->> 'id' from t_rm2), 'a starý zápas ukazuje na nový');
select tt.ok(public.mp_active() ->> 'id' = (select r -> 'match' ->> 'id' from t_rm2), 'nový zápas je u obou rozehraný (mp_active)');
select tt.fails(56, format($$select public.mp_rematch(%L)$$, (select id from t_rm1)), 'not_in_match', 'cizí hráč odvetu nezažádá');
-- pozdě a obsazený hráč
select tt.resign(58, (select r -> 'match' ->> 'id' from t_rm2)::uuid);
update public.mp_matches set finished_at = now() - interval '11 minutes' where id = (select r -> 'match' ->> 'id' from t_rm2)::uuid;
select tt.fails(58, format($$select public.mp_rematch(%L)$$, (select r -> 'match' ->> 'id' from t_rm2)), 'too_late', 'po deseti minutách je na odvetu pozdě');
create temp table t_rm3 as select tt.pair(58, 59, 'chess') as id;
select tt.resign(58, (select id from t_rm3));
select tt.ok(public.mp_rematch((select id from t_rm3)) ->> 'status' = 'waiting', 'další odveta: první čeká');
create temp table t_rm4 as select tt.pair(58, 56, 'warroom') as id;
select tt.fails(59, format($$select public.mp_rematch(%L)$$, (select id from t_rm3)), 'already_in_match', 'hráč, který už hraje jinde, odvetu nezačne');
select tt.resign(58, (select id from t_rm4));

-- ===== Jomarid Online Games: Katakomby (týmová tahová hra) a Chaos Aréna (týmová hra v reálném čase) =====
select tt.mmk(n) from generate_series(60, 63) n;
select tt.ok(public.mp_cfg('onlinegames', 'katakomby') ->> 'kind' = 'turn' and public.mp_cfg('onlinegames', 'chaos') ->> 'kind' = 'realtime'
  and (public.mp_cfg('onlinegames', 'katakomby') ->> 'team')::boolean and (public.mp_cfg('onlinegames', 'chaos') ->> 'team')::boolean, 'Jomarid Online Games: dva týmové režimy, Katakomby tahové a Chaos Aréna v reálném čase');
select tt.ok(public.mp_clean_params('onlinegames', 'chaos', '{}') = '{"diff": "normal"}' and public.mp_clean_params('onlinegames', 'katakomby', '{"diff":"hard","x":1}') = '{"diff": "hard"}', 'volba obtížnosti: výchozí normální, cizí klíče se zahodí');
select tt.fails(60, $$select public.mp_clean_params('onlinegames', 'chaos', '{"diff":"peklo"}')$$, 'invalid_params', 'neznámá obtížnost se odmítne');
select tt.ok(tt.find(60, 'onlinegames', 'katakomby', '{"diff":"easy"}') ->> 'status' = 'waiting' and tt.find(61, 'onlinegames', 'katakomby', '{"diff":"hard"}') ->> 'status' = 'waiting', 'různá obtížnost se nespáruje');
select tt.cancel(60); select tt.cancel(61);
select tt.ok(tt.find(60, 'onlinegames', 'chaos') ->> 'status' = 'waiting' and tt.find(61, 'onlinegames', 'katakomby') ->> 'status' = 'waiting', 'různé režimy se nespárují');
select tt.cancel(60); select tt.cancel(61);

create temp table t_og as select tt.pair_new(60, 61, 'onlinegames', 'katakomby', '{"diff":"easy"}') as id;
select tt.ok(tt.row((select id from t_og)) -> 'rules' ->> 'team' = 'true' and tt.row((select id from t_og)) -> 'rules' ->> 'check' = 'shape' and tt.row((select id from t_og)) ->> 'turn' = '1', 'zápas Katakomb: tým, kontrola tvaru tahů, první táhne místo 1');
-- tvar tahů Katakomb
select tt.xfail((select id from t_og), '{"t":"p","k":0}'::jsonb, 'karta před výběrem hrdinů se odmítne', false);
select tt.xfail((select id from t_og), '{"t":"hero","h":7}'::jsonb, 'neznámý hrdina se odmítne');
select tt.xfail((select id from t_og), '{"t":"hero","h":1,"z":1}'::jsonb, 'pole navíc se odmítne');
select tt.xfail((select id from t_og), '{"t":"x"}'::jsonb, 'neznámý druh tahu se odmítne');
select tt.xfail((select id from t_og), '"hero"'::jsonb, 'tah, který není objekt, se odmítne');
select tt.ok(tt.xmv((select id from t_og), '{"t":"hero","h":0}'::jsonb) ->> 'turn' = '2', 'výběr hrdiny prvního hráče předá tah druhému');
select tt.ok(tt.xmv((select id from t_og), '{"t":"hero","h":4}'::jsonb) ->> 'turn' = '1', 'a po druhém hrdinovi je na tahu zase první');
select tt.xfail((select id from t_og), '{"t":"hero","h":2}'::jsonb, 'třetí výběr hrdiny se odmítne');
select tt.xfail((select id from t_og), '{"t":"p","k":10}'::jsonb, 'karta mimo ruku (číslo 10) se odmítne', false);
select tt.xfail((select id from t_og), '{"t":"e","x":-1}'::jsonb, 'záporný otisk stavu se odmítne');
select tt.xfail((select id from t_og), '{"t":"e","x":4294967296}'::jsonb, 'otisk nad 32 bitů se odmítne');
select tt.xfail((select id from t_og), '{"t":"e","a":2}'::jsonb, 'příznak automatického konce jen 1');
select tt.xfail((select id from t_og), '{"t":"r","j":3}'::jsonb, 'odměna číslo 3 neexistuje');
select tt.ok(tt.xmv((select id from t_og), '{"t":"p","k":0}'::jsonb, false) ->> 'turn' = '1', 'zahraná karta tah nepředává');
select tt.ok(tt.xmv((select id from t_og), '{"t":"p","k":3}'::jsonb, false) ->> 'turn' = '1', 'a další karta také ne');
select tt.ok(tt.xmv((select id from t_og), '{"t":"e","x":123456}'::jsonb) ->> 'turn' = '2', 'konec tahu s otiskem tah předá');
select tt.ok(tt.xmv((select id from t_og), '{"t":"e","a":1}'::jsonb) ->> 'turn' = '1', 'automatický konec tahu poraženého hrdiny také');
-- Chaos Aréna běží v reálném čase: tahy přes mp_move nejdou
create temp table t_oc as select tt.pair_new(62, 63, 'onlinegames', 'chaos') as id;
select tt.fails(62, format($$select public.mp_move(%L, 1, '{"t":"e"}')$$, (select id from t_oc)), 'not_turn_based', 'Chaos Aréna tahy nemá');
-- týmová hra: vypršení času nikomu výhru nedá
update public.mp_matches set rules = rules || '{"turn_seconds":120}' where id = (select id from t_og);
select tt.ff((select id from t_og), 400);
select tt.ok(tt.st(60, (select id from t_og)) -> 'match' ->> 'status' = 'finished' and tt.row((select id from t_og)) ->> 'winner' = '0' and tt.row((select id from t_og)) ->> 'reason' = 'timeout', 'Katakomby: komu vypršel čas, nepřivodí soupeři výhru, zápas skončí bez vítěze');
-- výhra týmu: oba hlásí win, oba dostanou odměnu
create temp table t_og2 as select tt.pair_new(60, 61, 'onlinegames', 'katakomby') as id;
create temp table t_ogc as select tt.coins(60) c60, tt.coins(61) c61;
update public.mp_matches set move_count = 45 where id = (select id from t_og2);
select tt.ff((select id from t_og2), 300);
select tt.rep(60, (select id from t_og2), 'win', 'boss'); select tt.rep(61, (select id from t_og2), 'win', 'boss');
select tt.ok(tt.row((select id from t_og2)) ->> 'winner' = '3' and tt.coins(60) - (select c60 from t_ogc) = 40 and tt.coins(61) - (select c61 from t_ogc) = 40, 'společná výhra: oba dostanou po 40 Coinech');
select tt.ok((select wins from public.mp_record where user_id = tt.mu(60) and game_id = 'onlinegames' and mode = 'katakomby') = 1, 'a do týmového žebříčku se zapíše výhra');
create temp table t_og3 as select tt.pair_new(60, 61, 'onlinegames', 'katakomby') as id;
select tt.resign(60, (select id from t_og3));
select tt.ok(tt.row((select id from t_og3)) ->> 'winner' = '0' and tt.row((select id from t_og3)) ->> 'reason' = 'resign', 'odchod z týmové hry skončí bez vítěze');
create temp table t_og4 as select tt.pair_new(62, 63, 'onlinegames', 'chaos') as id;
select tt.ff((select id from t_og4), 200);
select tt.rep(62, (select id from t_og4), 'win', 'waves'); select tt.rep(63, (select id from t_og4), 'win', 'waves');
select tt.ok(tt.row((select id from t_og4)) ->> 'winner' = '3' and tt.coins(62) = 35 and tt.coins(63) = 35, 'Chaos Aréna: společná výhra po devíti vlnách dá oběma 35 Coinů');


-- ===== Realtime: kdo smí do kanálu =====
create temp table t_rt as select tt.pair(20, 21, 'rocket', 'pvp') as id;
select tt.as_mu(20);
select tt.ok(public.mp_topic_ok('mp:' || (select id from t_rt)), 'hráč zápasu smí do jeho kanálu');
select tt.as_mu(22);
select tt.ok(not public.mp_topic_ok('mp:' || (select id from t_rt)), 'cizí hráč do kanálu cizího zápasu nesmí');
select tt.ok(not public.mp_topic_ok('mp:neni-uuid') and not public.mp_topic_ok('mp:') and not public.mp_topic_ok('jine') and not public.mp_topic_ok(null) and not public.mp_topic_ok('mp:00000000-0000-0000-0000-000000000000'), 'nesmyslný nebo neexistující kanál ne');
select tt.ok(public.mp_topic_ok('mp-arena:polygonarena'), 'do sdílené arény Polygonu smí každý přihlášený');
select tt.no_user();
select tt.ok(not public.mp_topic_ok('mp:' || (select id from t_rt)) and not public.mp_topic_ok('mp-arena:polygonarena'), 'nepřihlášený nesmí nikam');
select tt.resign(20, (select id from t_rt));
select tt.as_mu(20);
select tt.ok(not public.mp_topic_ok('mp:' || (select id from t_rt)), 'po skončení zápasu kanál zavřený');
select tt.ok(not has_function_privilege('anon', 'public.mp_topic_ok(text)', 'execute') and has_function_privilege('authenticated', 'public.mp_topic_ok(text)', 'execute'), 'mp_topic_ok smí volat jen přihlášený');

-- pravidla na realtime.messages (zkušební náhrada tabulky a funkce realtime.topic() jako ve Supabase)
drop schema if exists realtime cascade;
create schema realtime;
create table realtime.messages (id bigint generated always as identity primary key, topic text, extension text not null, payload jsonb);
create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated;
grant select, insert on realtime.messages to authenticated;
\ir ../multiplayer.sql
select tt.ok((select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname in ('mp_broadcast_select', 'mp_broadcast_insert')) = 2, 'soubor vytvořil pravidla pro realtime.messages (čtení i zápis)');
\ir ../multiplayer.sql
select tt.ok((select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname in ('mp_broadcast_select', 'mp_broadcast_insert')) = 2, 'a po druhém spuštění jsou pořád právě dvě');
select tt.as_mu(20);
select tt.ok((public.mp_ping() ->> 'realtime')::boolean, 'mp_ping hlásí, že Realtime pravidla jsou nastavená');
create temp table t_rt2 as select tt.pair(20, 21, 'rocket', 'pvp') as id;
insert into realtime.messages (topic, extension, payload) values ('x', 'broadcast', '{"a":1}'), ('x', 'broadcast', '{"a":2}'), ('x', 'postgres_changes', '{"a":3}');
select set_config('tt.rt2', (select id::text from t_rt2), false);
set role authenticated;
select tt.as_mu(20);
select set_config('realtime.topic', 'mp:' || current_setting('tt.rt2'), false);
select tt.ok((select count(*) from realtime.messages where extension = 'broadcast') = 2, 'hráč zápasu čte zprávy svého kanálu');
select tt.ok((select count(*) from realtime.messages where extension = 'postgres_changes') = 0, 'ale jen broadcast a presence, ne jiné druhy zpráv');
insert into realtime.messages (topic, extension, payload) values ('mp:x', 'broadcast', '{"hit":1}');
select tt.ok(true, 'a smí do kanálu psát');
select tt.as_mu(22);
select tt.ok((select count(*) from realtime.messages where extension = 'broadcast') = 0, 'cizí hráč se stejným názvem kanálu nic nepřečte');
select tt.fails(22, $$insert into realtime.messages (topic, extension, payload) values ('mp:x', 'broadcast', '{"hit":2}')$$, '42501', 'a nezapíše');
select set_config('realtime.topic', 'mp-arena:polygonarena', false);
select tt.ok((select count(*) from realtime.messages where extension = 'broadcast') = 3, 'do arény smí každý přihlášený');
select set_config('realtime.topic', '', false);
select tt.ok((select count(*) from realtime.messages) = 0, 'bez kanálu se nečte nic');
reset role;
drop schema realtime cascade;
select tt.as_mu(20);
select tt.ok(not (public.mp_ping() ->> 'realtime')::boolean, 'bez Realtime autorizace mp_ping hlásí realtime: false');
select tt.resign(20, (select id from t_rt2));

-- ===== úklid po testu =====
delete from public.coin_transactions where user_id between tt.mu(0) and tt.mu(99);
delete from public.mp_matches where p1 between tt.mu(0) and tt.mu(99) or p2 between tt.mu(0) and tt.mu(99);
delete from public.profiles where id between tt.mu(0) and tt.mu(99);
delete from auth.users where id between tt.mu(0) and tt.mu(99);
select tt.ok((select count(*) from public.mp_queue) = 0 and (select count(*) from public.mp_rooms) = 0, 'po testu nezůstala žádná fronta ani místnost');
