-- Multiplayer (online hra ve dvou) pro hry v appce: fronta na náhodného soupeře, zápasy, tahy, hlášení výsledku a odměna Jomarid Coiny za výhru.
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát: tabulky se nemažou, funkce se nahrazují, rozehrané zápasy zůstanou.
-- Předpoklady, které v databázi už jsou: tabulka profiles (id, username, coins, lifetime_coins_earned), coin_transactions (user_id, amount, source_type)
-- a spoušť trg_update_coins, která při zápisu do coin_transactions sama zvýší profiles.coins o zapsanou částku (stejně jako u db/game-coins.sql).
-- Kdyby spoušť zůstatek nezvýšila přesně o zapsanou částku, soubor se hned na začátku zastaví a nic nezmění.
--
-- Jak to funguje
--   * Zápas řídí appka (src/mp), server drží fronty, zápasy a tahy a o odměně rozhoduje sám. Hra serveru žádné Coiny nenařizuje.
--   * Hráč se přihlásí do fronty (mp_find). Jakmile čeká druhý hráč na stejnou hru, režim a nastavení, server je spáruje (kdo je první, se vylosuje)
--     a založí zápas se společným semínkem (z něj hry odvodí třeba stejnou mapu nebo pořadí koulí). Fronta se ptá sama: kdo se 20 vteřin neozve, z ní vypadne.
--   * Tahové hry (šachy, Kouloví Kámoši, Warroom, Hannibal) posílají tahy přes mp_move. Server hlídá POŘADÍ (kdo je na tahu, číslo tahu), čas (hodiny nebo limit
--     na tah) a velikost zprávy. Komu vyprší čas, prohrává (server to pozná sám při dotazu soupeře).
--   * Šachy: server zná celá pravidla (mp_chess_*: tahy, rošáda, braní mimochodem, proměna, mat, pat, nedostatek materiálu, padesát tahů, trojí opakování)
--     a odmítne každý tah, který by jim odporoval (chyba illegal_move). Výsledek partie určuje server sám z tahů a hodin; hlášení hráčů se u šachů nebere.
--     Když vypršel čas hráči a soupeř už nemá materiál na mat, je to remíza (timeout-material).
--   * Kouloví Kámoši, Warroom a Hannibal: pravidla (fyziku koulí, bitvu) server přehrát neumí, hrají je hry samy a soupeř každý tah u sebe ověří. Server navíc kontroluje
--     tvar a meze každého tahu (mp_check_payload): nic navíc ve zprávě, správné pořadí, čísla v rozumných mezích, u Kouloví Kámošů i typ koule, který je dán
--     společným semínkem (nejde si ho vybrat). O výsledku těchto her rozhodují hlášení obou hráčů jako dřív.
--   * Kolem hry: žebříček (mp_record, mp_leaderboard: výhry, prohry, remízy a hodnocení Elo za řádně odehrané zápasy), rychlé reakce hráčů (mp_emote) a odveta
--     po skončeném zápase (mp_rematch: nový zápas se stejnými volbami a prohozenými stranami, když ji chtějí oba).
--   * Závod (City Clicker) posílá průběh přes mp_progress. Kdo první dosáhne cíle, vyhrává; rozhoduje pořadí na serveru. Průběh nejde přeskočit rychleji,
--     než dovolí nejkratší možná doba závodu.
--   * Výsledek ostatních her hlásí OBA hráči (mp_report). Souhlasí-li, zápas se uzavře a vítěz dostane Coiny. Nesouhlasí-li, zápas se zruší bez odměny (spor).
--     Když se soupeř odpojil a nehlásí, přijme se hlášení toho druhého po chvíli. Vzdání (mp_resign) platí hned.
--   * Odměna jen za výhru, za prohru se nic neděje. Podmínky: zápas musí mít aspoň určitý počet tahů a trvat určitou dobu (ať nejde „vyhrávat“ hned vzdáním),
--     denní strop Coinů z online výher (UTC den) a nejvýš pár odměněných výher nad stejným soupeřem za den. Čísla jsou v mp_limits() a mp_cfg() níže,
--     změníš je úpravou funkce a opětovným spuštěním souboru (rozehrané zápasy dohrají podle pravidel, se kterými začaly).
--   * Hry v reálném čase (Rocket, Polygon aréna) navíc posílají rychlé zprávy přes Supabase Realtime (broadcast). Do kanálu zápasu smí jen jeho dva hráči
--     (pravidla na realtime.messages dole); když Realtime autorizace v projektu není, soubor to jen oznámí a tahové hry fungují dál.
--
-- Oprávnění: klienti nesahají do tabulek (RLS zapnutá, práva odebraná), čtou a píšou jen přes funkce níže; funkce smí volat jen přihlášený.

-- ---------- Kontrola předpokladů dřív, než se cokoli změní ----------
do $$
declare
  v_uid uuid;
  v_before bigint;
  v_after bigint;
begin
  if to_regclass('public.profiles') is null or to_regclass('public.coin_transactions') is null then
    raise exception 'V databázi chybí tabulka profiles nebo coin_transactions. Nic se nezměnilo.';
  end if;
  select id, coalesce(coins, 0) into v_uid, v_before from public.profiles order by id limit 1;
  if v_uid is not null then
    begin
      perform set_config('app.bypass_profile_column_guard', 'true', true);
      insert into public.coin_transactions (user_id, amount, source_type) values (v_uid, 1, 'mp_win:preflight');
      select coalesce(coins, 0) into v_after from public.profiles where id = v_uid;
      if v_after is distinct from v_before + 1 then
        raise exception 'zápis do coin_transactions musí sám (spouští) zvýšit zůstatek v profilu o zapsanou částku; zůstatek byl % a po zápisu +1 je %', v_before, v_after;
      end if;
      raise exception using errcode = 'P0001', message = 'preflight_ok';
    exception when others then
      if sqlerrm <> 'preflight_ok' then
        raise exception 'Zkušební zápis do coin_transactions selhal: %. Nic se nezměnilo, SQL je potřeba upravit podle skutečné databáze.', sqlerrm;
      end if;
    end;
  end if;
end $$;

-- ---------- Čísla, která se dají ladit ----------
-- Vteřiny a počty. daily_cap = nejvíc Coinů z online výher za den (UTC); same_opponent_daily = nejvíc odměněných výher nad jedním soupeřem za den;
-- queue_ttl = za jak dlouho vypadne z fronty hráč, který se neozývá; idle = po jak dlouhém tichu je soupeř „pryč“; join_grace = čas navíc na načtení hry
-- před prvním tahem; report_wait = jak dlouho musí ležet jediné hlášení výsledku, než se přijme; arena_gap = nejkratší doba mezi dvěma výhrami v aréně.
create or replace function public.mp_limits()
returns jsonb language sql immutable set search_path to 'public' as $$
  select jsonb_build_object(
    'queue_ttl', 20,
    'join_grace', 45,
    'idle', 25,
    'report_wait', 15,
    'abandon_minutes', 30,
    'daily_cap', 150,
    'same_opponent_daily', 3,
    'keep_days', 3,
    'room_minutes', 10,
    'seen_every', 4,
    'late_grace', 2,
    'arena_gap', 150,
    'arena_reward', 15
  )
$$;

-- Nastavení her a režimů. kind: turn (tahová), race (závod), realtime (rychlé zprávy). reward = Coiny za výhru, min_moves a min_seconds = kolik zápas musí mít
-- tahů a jak dlouho musí trvat, aby se za výhru platilo, team = oba hráči vyhrávají společně, turn_seconds = limit na tah, bank a inc = šachové hodiny
-- (vteřiny na celou partii a přídavek za tah), first_move = vteřiny na první tah, max_payload a max_moves = meze velikosti.
create or replace function public.mp_cfg(p_game text, p_mode text)
returns jsonb language sql immutable set search_path to 'public' as $$
  select case p_game || '/' || p_mode
    when 'chess/duel'         then jsonb_build_object('kind', 'turn',     'turn_seconds', 0,   'bank', 300, 'inc', 3, 'first_move', 60, 'reward', 30, 'min_moves', 10, 'min_seconds', 45,  'max_payload', 400,   'max_moves', 700,  'team', false)
    when 'koulovikamosi/duel' then jsonb_build_object('kind', 'turn',     'turn_seconds', 60,  'bank', 0,   'inc', 0, 'first_move', 60, 'reward', 20, 'min_moves', 6,  'min_seconds', 30,  'max_payload', 16000, 'max_moves', 400,  'team', false)
    when 'warroom/duel'       then jsonb_build_object('kind', 'turn',     'turn_seconds', 120, 'bank', 0,   'inc', 0, 'first_move', 90, 'reward', 35, 'min_moves', 4,  'min_seconds', 40,  'max_payload', 16000, 'max_moves', 900,  'team', false)
    when 'hannibal/duel'      then jsonb_build_object('kind', 'turn',     'turn_seconds', 180, 'bank', 0,   'inc', 0, 'first_move', 90, 'reward', 40, 'min_moves', 4,  'min_seconds', 30,  'max_payload', 16000, 'max_moves', 1500, 'team', false)
    when 'cityclicker/race'   then jsonb_build_object('kind', 'race',     'turn_seconds', 0,   'bank', 0,   'inc', 0, 'first_move', 0,  'reward', 40, 'min_moves', 0,  'min_seconds', 38,  'max_payload', 600,   'max_moves', 0,    'team', false, 'target', 10000000000)
    when 'onlinegames/katakomby' then jsonb_build_object('kind', 'turn',  'turn_seconds', 120, 'bank', 0,   'inc', 0, 'first_move', 120, 'reward', 40, 'min_moves', 40, 'min_seconds', 240, 'max_payload', 400,  'max_moves', 4000, 'team', true)
    when 'onlinegames/chaos'  then jsonb_build_object('kind', 'realtime', 'turn_seconds', 0,   'bank', 0,   'inc', 0, 'first_move', 0,  'reward', 35, 'min_moves', 0,  'min_seconds', 150, 'max_payload', 600,   'max_moves', 0,    'team', true)
    when 'rocket/coop'        then jsonb_build_object('kind', 'realtime', 'turn_seconds', 0,   'bank', 0,   'inc', 0, 'first_move', 0,  'reward', 25, 'min_moves', 0,  'min_seconds', 60,  'max_payload', 600,   'max_moves', 0,    'team', true)
    when 'rocket/pvp'         then jsonb_build_object('kind', 'realtime', 'turn_seconds', 0,   'bank', 0,   'inc', 0, 'first_move', 0,  'reward', 35, 'min_moves', 0,  'min_seconds', 30,  'max_payload', 600,   'max_moves', 0,    'team', false)
    else null
  end
$$;

-- Zkontroluje a očistí nastavení zápasu (p_params): šachy tc (3+2, 5+3, 10+5), City Clicker goal (quick, standard, long), Hannibal preset (small, medium, large).
-- Neznámá hodnota se odmítne chybou invalid_params, chybějící dostane výchozí. Hráči se párují jen s někým se stejným nastavením.
create or replace function public.mp_clean_params(p_game text, p_mode text, p_params jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare
  v text;
begin
  if p_game = 'chess' then
    v := coalesce(p_params ->> 'tc', '5+3');
    if v not in ('3+2', '5+3', '10+5') then raise exception 'invalid_params'; end if;
    return jsonb_build_object('tc', v);
  elsif p_game = 'onlinegames' then
    v := coalesce(p_params ->> 'diff', 'normal');
    if v not in ('easy', 'normal', 'hard') then raise exception 'invalid_params'; end if;
    return jsonb_build_object('diff', v);
  elsif p_game = 'cityclicker' then
    v := coalesce(p_params ->> 'goal', 'standard');
    if v not in ('quick', 'standard', 'long') then raise exception 'invalid_params'; end if;
    return jsonb_build_object('goal', v);
  elsif p_game = 'hannibal' then
    v := coalesce(p_params ->> 'preset', 'medium');
    if v not in ('small', 'medium', 'large') then raise exception 'invalid_params'; end if;
    return jsonb_build_object('preset', v);
  end if;
  return '{}'::jsonb;
end $$;

-- Pravidla zápasu = nastavení hry upravené podle voleb hráčů. Ukládají se do zápasu při jeho založení, takže pozdější změna čísel výše nezmění rozehrané zápasy.
create or replace function public.mp_rules(p_game text, p_mode text, p_params jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare
  v jsonb := public.mp_cfg(p_game, p_mode);
begin
  if v is null then return null; end if;
  if p_game = 'chess' then
    v := v || case p_params ->> 'tc' when '3+2' then '{"bank":180,"inc":2}'::jsonb when '10+5' then '{"bank":600,"inc":5}'::jsonb else '{"bank":300,"inc":3}'::jsonb end;
    v := v || '{"engine":"chess"}'::jsonb;   -- pravidla šachů hlídá server (mp_chess_*); zápasy založené dřív se hlásí po starém
  elsif p_game in ('koulovikamosi', 'warroom', 'hannibal', 'onlinegames') then
    v := v || '{"check":"shape"}'::jsonb;    -- server kontroluje tvar a meze tahů (mp_check_payload)
  elsif p_game = 'cityclicker' then
    v := v || case p_params ->> 'goal' when 'quick' then '{"target":1000000000,"min_seconds":24}'::jsonb when 'long' then '{"target":100000000000,"min_seconds":75}'::jsonb else '{"target":10000000000,"min_seconds":38}'::jsonb end;
  end if;
  return v;
end $$;

-- ---------- Tabulky ----------
-- Fronta: nejvýš jeden řádek na hráče. match_id se vyplní, když hráče spáruje někdo jiný (jeho další dotaz pak zápas dostane).
create table if not exists public.mp_queue (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  game_id text not null,
  mode text not null,
  params jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  match_id uuid
);

-- Zápas dvou hráčů. winner: 0 remíza (nebo tým prohrál), 1 nebo 2 vyhrál ten hráč, 3 vyhráli oba (tým). Při stavu void se nic neplatí.
-- bank1 a bank2 jsou zbývající vteřiny hodin (jen šachy), turn_started je začátek tahu hráče na tahu.
create table if not exists public.mp_matches (
  id uuid primary key default gen_random_uuid(),
  game_id text not null,
  mode text not null,
  params jsonb not null default '{}'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  seed bigint not null,
  p1 uuid not null references public.profiles (id) on delete cascade,
  p2 uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'finished', 'void')),
  turn smallint check (turn in (1, 2)),
  turn_started timestamptz,
  deadline timestamptz,
  bank1 double precision not null default 0,
  bank2 double precision not null default 0,
  move_count int not null default 0,
  prog1 double precision not null default 0,
  prog2 double precision not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  winner smallint check (winner in (0, 1, 2, 3)),
  reason text,
  report1 jsonb,
  report2 jsonb,
  seen1 timestamptz not null default now(),
  seen2 timestamptz not null default now(),
  coins1 int not null default 0,
  coins2 int not null default 0,
  check (p1 <> p2)
);
create index if not exists mp_matches_p1_idx on public.mp_matches (p1, status);
create index if not exists mp_matches_p2_idx on public.mp_matches (p2, status);
create index if not exists mp_matches_created_idx on public.mp_matches (created_at);
-- Stav partie, kterému rozumí server (zatím šachy: viz mp_chess_init). U her, které server nehlídá, je null.
alter table public.mp_matches add column if not exists gstate jsonb;
-- Rychlé reakce hráčů (naposledy poslaná reakce každého: {c: kód, n: pořadí, at: čas}) a odveta (kdy ji který hráč chtěl a jaký zápas z ní vznikl).
alter table public.mp_matches add column if not exists emotes jsonb not null default '{}'::jsonb;
alter table public.mp_matches add column if not exists rematch1 timestamptz;
alter table public.mp_matches add column if not exists rematch2 timestamptz;
alter table public.mp_matches add column if not exists next_match uuid;

-- Tahy (nebo jiné zprávy zápasu) v pořadí. payload je to, co hra pošle, server mu nerozumí.
create table if not exists public.mp_moves (
  match_id uuid not null references public.mp_matches (id) on delete cascade,
  seq int not null,
  player smallint not null check (player in (1, 2)),
  payload jsonb not null,
  end_turn boolean not null default true,
  at timestamptz not null default now(),
  primary key (match_id, seq)
);

-- Místnosti pro hru s kamarádem: kód, který host řekne druhému.
create table if not exists public.mp_rooms (
  code text primary key,
  host uuid not null references public.profiles (id) on delete cascade,
  game_id text not null,
  mode text not null,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  match_id uuid
);
create index if not exists mp_rooms_host_idx on public.mp_rooms (host);

-- Poslední odměněná výhra v Polygon aréně (hlídá odstup mezi dvěma výhrami).
create table if not exists public.mp_arena_log (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  last_claim timestamptz not null default now()
);

-- Žebříček online her: výhry, prohry, remízy a hodnocení (Elo, začíná na 1000) každého hráče v každé hře a režimu. Počítá se jen z řádně odehraných zápasů.
create table if not exists public.mp_record (
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id text not null,
  mode text not null,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  rating int not null default 1000,
  last_played timestamptz not null default now(),
  primary key (user_id, game_id, mode)
);
create index if not exists mp_record_rank_idx on public.mp_record (game_id, mode, rating desc, wins desc);

-- Klienti do tabulek nesahají vůbec: čtou a zapisují jen přes funkce níže.
alter table public.mp_record enable row level security;
alter table public.mp_queue enable row level security;
alter table public.mp_matches enable row level security;
alter table public.mp_moves enable row level security;
alter table public.mp_rooms enable row level security;
alter table public.mp_arena_log enable row level security;
revoke all on public.mp_queue, public.mp_matches, public.mp_moves, public.mp_rooms, public.mp_arena_log, public.mp_record from public, anon, authenticated;

-- ---------- Pomocné funkce (klienti je nevolají) ----------
create or replace function public.mp_user_name(p_uid uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(trim((select username from public.profiles where id = p_uid)), ''), 'Hráč ' || right(p_uid::text, 4))
$$;

-- Zápas tak, jak ho vidí hráč p_uid: jeho číslo (slot), soupeř, stav, na tahu, hodiny a čas serveru (v milisekundách od roku 1970, ať se nepletou časová pásma).
create or replace function public.mp_match_json(m public.mp_matches, p_uid uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_slot int := case when m.p1 = p_uid then 1 else 2 end;
  v_opp uuid := case when m.p1 = p_uid then m.p2 else m.p1 end;
  v_seen timestamptz := case when m.p1 = p_uid then m.seen2 else m.seen1 end;
  v_emote jsonb := m.emotes -> (case when m.p1 = p_uid then '2' else '1' end);
  v_mine timestamptz := case when m.p1 = p_uid then m.rematch1 else m.rematch2 end;
  v_theirs timestamptz := case when m.p1 = p_uid then m.rematch2 else m.rematch1 end;
begin
  return jsonb_build_object(
    'id', m.id, 'game', m.game_id, 'mode', m.mode, 'params', m.params, 'seed', m.seed,
    'slot', v_slot, 'status', m.status, 'turn', m.turn,
    'deadline', case when m.deadline is null then null else (extract(epoch from m.deadline) * 1000)::bigint end,
    'turn_started', case when m.turn_started is null then null else (extract(epoch from m.turn_started) * 1000)::bigint end,
    'bank', jsonb_build_array(m.bank1, m.bank2),
    'now', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'created', (extract(epoch from m.created_at) * 1000)::bigint,
    'move_count', m.move_count,
    'winner', m.winner, 'reason', m.reason,
    'kind', m.rules ->> 'kind', 'team', coalesce((m.rules ->> 'team')::boolean, false), 'reward', (m.rules ->> 'reward')::int,
    'target', (m.rules ->> 'target')::bigint, 'inc', (m.rules ->> 'inc')::int,
    'opponent', jsonb_build_object('id', v_opp, 'name', public.mp_user_name(v_opp), 'seen_ago', greatest(0, floor(extract(epoch from (clock_timestamp() - v_seen))))::int),
    'me', jsonb_build_object('id', p_uid, 'name', public.mp_user_name(p_uid)),
    'my_coins', case when v_slot = 1 then m.coins1 else m.coins2 end,
    'prog', jsonb_build_array(m.prog1, m.prog2),
    'opp_emote', case when v_emote is null then null else jsonb_build_object('c', v_emote -> 'c', 'n', v_emote -> 'n',
      'age', greatest(0, (extract(epoch from clock_timestamp()) * 1000 - (v_emote ->> 'at')::double precision))::bigint) end,
    'rematch', jsonb_build_object('mine', v_mine is not null and v_mine > clock_timestamp() - interval '10 minutes',
      'theirs', v_theirs is not null and v_theirs > clock_timestamp() - interval '10 minutes', 'next', m.next_match)
  );
end $$;

-- Zápas, ve kterém hráč opravdu je (jinak chyba), zamčený pro změnu.
create or replace function public.mp_load(p_match uuid, p_uid uuid)
returns public.mp_matches language plpgsql security definer set search_path to 'public' as $$
declare m public.mp_matches%rowtype;
begin
  if p_match is null then raise exception 'not_in_match'; end if;
  select * into m from public.mp_matches where id = p_match for update;
  if not found or p_uid not in (m.p1, m.p2) then raise exception 'not_in_match'; end if;
  return m;
end $$;

-- Zbývá hráči Coinů pod denním stropem? Vrací, kolik Coinů smí dnes ještě získat z online výher.
create or replace function public.mp_room_left(p_uid uuid)
returns int language sql stable security definer set search_path to 'public' as $$
  select greatest(0, (public.mp_limits() ->> 'daily_cap')::int - coalesce((
    select sum(ct.amount) from public.coin_transactions ct
    where ct.user_id = p_uid and starts_with(ct.source_type, 'mp_win:') and split_part(ct.source_type, ':', 3) = ((now() at time zone 'utc')::date)::text), 0)::int)
$$;

-- Připíše hráči p_uid p_amount Coinů za výhru (zápis do deníku, zůstatek zvýší spoušť). p_ref je označení zápasu v deníku. Vrací, kolik se připsalo.
create or replace function public.mp_grant(p_uid uuid, p_game text, p_ref text, p_amount int)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_grant int;
  v_balance bigint;
begin
  -- zámek na řádek profilu: dvě souběžné výplaty téhož hráče se nemohou obě „vejít“ pod strop
  select coins into v_balance from public.profiles where id = p_uid for update;
  if not found then return 0; end if;
  v_grant := least(p_amount, public.mp_room_left(p_uid));
  if v_grant <= 0 then return 0; end if;
  perform set_config('app.bypass_profile_column_guard', 'true', true);
  update public.profiles set lifetime_coins_earned = coalesce(lifetime_coins_earned, 0) + v_grant where id = p_uid;
  -- Zůstatek zvýší spoušť trg_update_coins při zápisu do deníku (jednou, o zapsanou částku). Tady se přímo neupravuje, připsal by se dvakrát.
  insert into public.coin_transactions (user_id, amount, source_type)
    values (p_uid, v_grant, 'mp_win:' || p_game || ':' || ((now() at time zone 'utc')::date)::text || ':' || p_ref);
  return v_grant;
end $$;

-- Odměna jednomu hráči za výhru: vrací, kolik Coinů dostal (0, když nesplnil podmínky nebo narazil na strop).
create or replace function public.mp_pay(p_match uuid, p_slot smallint)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  m public.mp_matches%rowtype;
  v_uid uuid;
  v_opp uuid;
  v_lim jsonb := public.mp_limits();
  v_today date := (now() at time zone 'utc')::date;
  v_same int;
  v_grant int;
begin
  select * into m from public.mp_matches where id = p_match;
  if not found or m.status <> 'finished' then return 0; end if;
  v_uid := case p_slot when 1 then m.p1 else m.p2 end;
  v_opp := case p_slot when 1 then m.p2 else m.p1 end;
  if m.move_count < coalesce((m.rules ->> 'min_moves')::int, 0) then return 0; end if;
  if extract(epoch from (m.finished_at - m.created_at)) < coalesce((m.rules ->> 'min_seconds')::int, 0) then return 0; end if;

  select count(*) into v_same from public.mp_matches x
    where x.id <> m.id and x.status = 'finished' and (x.finished_at at time zone 'utc')::date = v_today
      and ((x.p1 = v_uid and x.p2 = v_opp and x.coins1 > 0) or (x.p2 = v_uid and x.p1 = v_opp and x.coins2 > 0));
  if v_same >= (v_lim ->> 'same_opponent_daily')::int then return 0; end if;

  v_grant := public.mp_grant(v_uid, m.game_id, left(m.id::text, 8), coalesce((m.rules ->> 'reward')::int, 0));
  if v_grant <= 0 then return 0; end if;
  if p_slot = 1 then update public.mp_matches set coins1 = v_grant where id = m.id; else update public.mp_matches set coins2 = v_grant where id = m.id; end if;
  return v_grant;
end $$;

-- Uzavře zápas. p_winner null = zrušen (void), 0 remíza, 1 nebo 2 vítěz, 3 vyhráli oba. Dělá něco, jen když je zápas ještě aktivní.
create or replace function public.mp_finalize(p_match uuid, p_winner smallint, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m public.mp_matches%rowtype;
begin
  select * into m from public.mp_matches where id = p_match for update;
  if not found or m.status <> 'active' then return; end if;
  update public.mp_matches
    set status = case when p_winner is null then 'void' else 'finished' end, winner = p_winner, reason = left(coalesce(p_reason, ''), 40), finished_at = now(), deadline = null
    where id = p_match;
  delete from public.mp_queue where user_id in (m.p1, m.p2);
  if p_winner in (1, 3) then perform public.mp_pay(p_match, 1::smallint); end if;
  if p_winner in (2, 3) then perform public.mp_pay(p_match, 2::smallint); end if;
  if p_winner is not null then perform public.mp_record_result(p_match); end if;
end $$;

-- Vyhodnotí hlášení výsledku. Obě hlášení souhlasí = výsledek; nesouhlasí = spor (zrušeno); jediné hlášení se přijme, až když se druhý hráč odpojil.
create or replace function public.mp_settle(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  m public.mp_matches%rowtype;
  v_lim jsonb := public.mp_limits();
  v_team boolean;
  c1 smallint;
  c2 smallint;
  v_slot smallint;
  v_report jsonb;
  v_seen timestamptz;
begin
  select * into m from public.mp_matches where id = p_match for update;
  if not found or m.status <> 'active' then return; end if;
  v_team := coalesce((m.rules ->> 'team')::boolean, false);

  -- co z hlášení vyplývá: číslo vítěze (0 remíza, 1, 2, 3 tým vyhrál), nebo null, když hlášení nemá
  c1 := case when m.report1 is null then null when v_team then (case m.report1 ->> 'outcome' when 'win' then 3 else 0 end)
              else (case m.report1 ->> 'outcome' when 'win' then 1 when 'loss' then 2 else 0 end) end;
  c2 := case when m.report2 is null then null when v_team then (case m.report2 ->> 'outcome' when 'win' then 3 else 0 end)
              else (case m.report2 ->> 'outcome' when 'win' then 2 when 'loss' then 1 else 0 end) end;

  if c1 is not null and c2 is not null then
    if c1 = c2 then
      perform public.mp_finalize(m.id, c1, coalesce(m.report1 ->> 'reason', 'agreed'));
    else
      perform public.mp_finalize(m.id, null, 'dispute');
    end if;
    return;
  end if;
  if c1 is null and c2 is null then return; end if;

  -- jen jedno hlášení: přijme se, až když ten druhý nějakou dobu nic neposlal a hlášení chvíli leží
  v_slot := case when c1 is not null then 1 else 2 end;
  v_report := case when v_slot = 1 then m.report1 else m.report2 end;
  v_seen := case when v_slot = 1 then m.seen2 else m.seen1 end;
  if clock_timestamp() - v_seen >= make_interval(secs => (v_lim ->> 'idle')::int)
     and clock_timestamp() - (v_report ->> 'at')::timestamptz >= make_interval(secs => (v_lim ->> 'report_wait')::int) then
    if (v_report ->> 'outcome') = 'win' then
      perform public.mp_finalize(m.id, case when v_team then 3 else v_slot end::smallint, 'opponent_gone');   -- tým vyhrál, ale druhý je pryč: zaplatí se oběma jen podle pravidel výplaty
    elsif (v_report ->> 'outcome') = 'loss' then
      perform public.mp_finalize(m.id, case when v_team then 0 else 3 - v_slot end::smallint, 'opponent_gone');
    else
      perform public.mp_finalize(m.id, 0::smallint, 'opponent_gone');
    end if;
  end if;
end $$;

-- ---------- Šachy: pravidla hlídá server ----------
-- Šachovnice je text o 64 znacích, řada po řadě od 8. řady (a8, b8 ... h8, a7 ... h1) jako v appce. Velké písmeno je bílá figura, malé černá, tečka prázdné pole.
-- Políčko má číslo 0 až 63 (a8 = 0, h8 = 7, a1 = 56, h1 = 63). Bílý je hráč číslo 1. Pravidla odpovídají hře (src/gameContent/chess/rules.js): rošáda, braní
-- mimochodem, proměna pěšce, mat, pat, nedostatek materiálu, padesát tahů a trojí opakování. Funkce jsou čisté: nic nečtou z tabulek a nic nezapisují.
-- Stav partie (mp_matches.gstate): {b: šachovnice, t: 'w' nebo 'b' na tahu, c: práva rošády (třeba 'KQkq'), e: pole pro braní mimochodem nebo -1,
-- h: půltahů od posledního braní nebo tahu pěšcem, k: počty pozic od posledního nevratného tahu (otisk md5 pozice -> kolikrát)}.

-- Je políčko napadené figurami dané barvy?
create or replace function public.mp_chess_attacked(p_bd text[], p_sq int, p_by_white boolean)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare
  r int := p_sq / 8;
  c int := p_sq % 8;
  rr int;
  cc int;
  i int;
  dr int;
  dc int;
  p text;
  v_pawn text := case when p_by_white then 'P' else 'p' end;
  v_knight text := case when p_by_white then 'N' else 'n' end;
  v_king text := case when p_by_white then 'K' else 'k' end;
  v_bishop text := case when p_by_white then 'B' else 'b' end;
  v_rook text := case when p_by_white then 'R' else 'r' end;
  v_queen text := case when p_by_white then 'Q' else 'q' end;
  v_dr int[] := array[-1, -1, -1, 0, 0, 1, 1, 1];
  v_dc int[] := array[-1, 0, 1, -1, 1, -1, 0, 1];
  v_kr int[] := array[-2, -2, -1, -1, 1, 1, 2, 2];
  v_kc int[] := array[-1, 1, -2, 2, -2, 2, -1, 1];
begin
  -- pěšec: bílý útočí k 8. řadě, takže útočník stojí o řadu níž, černý o řadu výš
  rr := r + case when p_by_white then 1 else -1 end;
  if rr between 0 and 7 then
    if c > 0 and p_bd[rr * 8 + (c - 1) + 1] = v_pawn then return true; end if;
    if c < 7 and p_bd[rr * 8 + (c + 1) + 1] = v_pawn then return true; end if;
  end if;
  for i in 1..8 loop
    rr := r + v_kr[i];
    cc := c + v_kc[i];
    if rr between 0 and 7 and cc between 0 and 7 and p_bd[rr * 8 + cc + 1] = v_knight then return true; end if;
    dr := v_dr[i];
    dc := v_dc[i];
    rr := r + dr;
    cc := c + dc;
    if rr between 0 and 7 and cc between 0 and 7 and p_bd[rr * 8 + cc + 1] = v_king then return true; end if;
    while rr between 0 and 7 and cc between 0 and 7 loop
      p := p_bd[rr * 8 + cc + 1];
      if p <> '.' then
        if p = v_queen or (p = v_rook and (dr = 0 or dc = 0)) or (p = v_bishop and dr <> 0 and dc <> 0) then return true; end if;
        exit;
      end if;
      rr := rr + dr;
      cc := cc + dc;
    end loop;
  end loop;
  return false;
end $$;

-- Zkusí tah z pole p_f na pole p_t (p_promo je q, r, b, n při proměně, jinak prázdné). ok je true, když je tah podle pravidel; pak jsou ve výstupu nová šachovnice,
-- nová práva rošády, nové pole pro braní mimochodem (nebo -1) a irrev (tah pěšcem nebo braní: dřívější pozice už se nemohou opakovat).
create or replace function public.mp_chess_try(p_bd text[], p_castle text, p_ep int, p_f int, p_t int, p_promo text,
  out ok boolean, out nbd text[], out ncastle text, out nep int, out irrev boolean)
language plpgsql immutable set search_path to 'public' as $$
declare
  p text;
  q text;
  v_white boolean;
  v_type text;
  fr int;
  fc int;
  tr int;
  tc int;
  dr int;
  dc int;
  adr int;
  adc int;
  v_dir int;
  v_new text;
  v_ep_capture boolean := false;
  v_castle int := 0;
  v_home int;
  sr int;
  sc int;
  k int;
  v_ksq int;
begin
  ok := false;
  nep := -1;
  if p_f is null or p_t is null or p_f < 0 or p_f > 63 or p_t < 0 or p_t > 63 or p_f = p_t then return; end if;
  p := p_bd[p_f + 1];
  q := p_bd[p_t + 1];
  if p = '.' then return; end if;
  v_white := p <> lower(p);
  if q <> '.' and (q <> lower(q)) = v_white then return; end if;   -- na cíli je vlastní figura
  v_type := lower(p);
  if v_type <> 'p' and coalesce(p_promo, '') <> '' then return; end if;
  fr := p_f / 8; fc := p_f % 8; tr := p_t / 8; tc := p_t % 8;
  dr := tr - fr; dc := tc - fc; adr := abs(dr); adc := abs(dc);
  v_new := p;

  if v_type = 'p' then
    v_dir := case when v_white then -1 else 1 end;
    if dc = 0 and dr = v_dir and q = '.' then
      ok := true;
    elsif dc = 0 and dr = 2 * v_dir and fr = (case when v_white then 6 else 1 end) and q = '.' and p_bd[(fr + v_dir) * 8 + fc + 1] = '.' then
      ok := true;
      nep := (fr + v_dir) * 8 + fc;
    elsif adc = 1 and dr = v_dir then
      if q <> '.' then ok := true;
      elsif p_ep = p_t then ok := true; v_ep_capture := true; end if;
    end if;
    if not ok then return; end if;
    if tr = (case when v_white then 0 else 7 end) then
      if p_promo is null or p_promo not in ('q', 'r', 'b', 'n') then ok := false; return; end if;
      v_new := case when v_white then upper(p_promo) else p_promo end;
    elsif coalesce(p_promo, '') <> '' then
      ok := false; return;
    end if;
  elsif v_type = 'n' then
    ok := (adr = 1 and adc = 2) or (adr = 2 and adc = 1);
  elsif v_type in ('b', 'r', 'q') then
    ok := case v_type when 'b' then adr = adc when 'r' then (dr = 0 or dc = 0) else (adr = adc or dr = 0 or dc = 0) end;
    if ok then
      sr := case when dr > 0 then 1 when dr < 0 then -1 else 0 end;
      sc := case when dc > 0 then 1 when dc < 0 then -1 else 0 end;
      for k in 1..(greatest(adr, adc) - 1) loop
        if p_bd[(fr + sr * k) * 8 + (fc + sc * k) + 1] <> '.' then ok := false; exit; end if;
      end loop;
    end if;
  else   -- král
    if adr <= 1 and adc <= 1 then
      ok := true;
    else
      v_home := case when v_white then 7 else 0 end;
      if fr = v_home and fc = 4 and dr = 0 then
        if tc = 6 and position(case when v_white then 'K' else 'k' end in p_castle) > 0
           and p_bd[v_home * 8 + 5 + 1] = '.' and p_bd[v_home * 8 + 6 + 1] = '.' and p_bd[v_home * 8 + 7 + 1] = (case when v_white then 'R' else 'r' end)
           and not public.mp_chess_attacked(p_bd, v_home * 8 + 4, not v_white) and not public.mp_chess_attacked(p_bd, v_home * 8 + 5, not v_white)
           and not public.mp_chess_attacked(p_bd, v_home * 8 + 6, not v_white) then
          ok := true; v_castle := 1;
        elsif tc = 2 and position(case when v_white then 'Q' else 'q' end in p_castle) > 0
           and p_bd[v_home * 8 + 1 + 1] = '.' and p_bd[v_home * 8 + 2 + 1] = '.' and p_bd[v_home * 8 + 3 + 1] = '.' and p_bd[v_home * 8 + 0 + 1] = (case when v_white then 'R' else 'r' end)
           and not public.mp_chess_attacked(p_bd, v_home * 8 + 4, not v_white) and not public.mp_chess_attacked(p_bd, v_home * 8 + 3, not v_white)
           and not public.mp_chess_attacked(p_bd, v_home * 8 + 2, not v_white) then
          ok := true; v_castle := 2;
        end if;
      end if;
    end if;
  end if;
  if not ok then return; end if;

  nbd := p_bd;
  nbd[p_t + 1] := v_new;
  nbd[p_f + 1] := '.';
  if v_ep_capture then nbd[fr * 8 + tc + 1] := '.'; end if;
  if v_castle = 1 then nbd[v_home * 8 + 5 + 1] := nbd[v_home * 8 + 7 + 1]; nbd[v_home * 8 + 7 + 1] := '.';
  elsif v_castle = 2 then nbd[v_home * 8 + 3 + 1] := nbd[v_home * 8 + 0 + 1]; nbd[v_home * 8 + 0 + 1] := '.'; end if;
  -- vlastní král po tahu nesmí být v šachu
  v_ksq := array_position(nbd, case when v_white then 'K' else 'k' end);
  if v_ksq is not null and public.mp_chess_attacked(nbd, v_ksq - 1, not v_white) then ok := false; return; end if;

  -- práva rošády: král o ně přijde, věž z rohu také, stejně jako braná věž v rohu
  ncastle := p_castle;
  if v_type = 'k' then ncastle := translate(ncastle, case when v_white then 'KQ' else 'kq' end, ''); end if;
  if v_type = 'r' then
    ncastle := translate(ncastle, case when v_white then (case p_f when 56 then 'Q' when 63 then 'K' else '' end) else (case p_f when 0 then 'q' when 7 then 'k' else '' end) end, '');
  end if;
  if q = 'R' then ncastle := translate(ncastle, case p_t when 56 then 'Q' when 63 then 'K' else '' end, ''); end if;
  if q = 'r' then ncastle := translate(ncastle, case p_t when 0 then 'q' when 7 then 'k' else '' end, ''); end if;
  irrev := v_type = 'p' or q <> '.';
end $$;

-- Pole, kam by figura na poli p_f mohla podle svého pohybu táhnout (jen zeměpis, bez ohledu na šach, rošádu nebo braní mimochodem se kontrolují až v mp_chess_try).
create or replace function public.mp_chess_cands(p_bd text[], p_f int)
returns int[] language plpgsql immutable set search_path to 'public' as $$
declare
  p text := lower(p_bd[p_f + 1]);
  v_white boolean := p_bd[p_f + 1] <> lower(p_bd[p_f + 1]);
  r int := p_f / 8;
  c int := p_f % 8;
  v_out int[] := '{}';
  rr int;
  cc int;
  i int;
  dr int;
  dc int;
  v_dr int[] := array[-1, -1, -1, 0, 0, 1, 1, 1];
  v_dc int[] := array[-1, 0, 1, -1, 1, -1, 0, 1];
  v_kr int[] := array[-2, -2, -1, -1, 1, 1, 2, 2];
  v_kc int[] := array[-1, 1, -2, 2, -2, 2, -1, 1];
begin
  if p = 'p' then
    dr := case when v_white then -1 else 1 end;
    for dc in -1..1 loop
      rr := r + dr; cc := c + dc;
      if rr between 0 and 7 and cc between 0 and 7 then v_out := v_out || (rr * 8 + cc); end if;
    end loop;
    rr := r + 2 * dr;
    if rr between 0 and 7 then v_out := v_out || (rr * 8 + c); end if;
  elsif p = 'n' then
    for i in 1..8 loop
      rr := r + v_kr[i]; cc := c + v_kc[i];
      if rr between 0 and 7 and cc between 0 and 7 then v_out := v_out || (rr * 8 + cc); end if;
    end loop;
  elsif p = 'k' then
    for i in 1..8 loop
      rr := r + v_dr[i]; cc := c + v_dc[i];
      if rr between 0 and 7 and cc between 0 and 7 then v_out := v_out || (rr * 8 + cc); end if;
    end loop;
    if c = 4 then v_out := v_out || (r * 8 + 2) || (r * 8 + 6); end if;   -- rošáda
  else
    for i in 1..8 loop
      dr := v_dr[i]; dc := v_dc[i];
      if (p = 'r' and dr <> 0 and dc <> 0) or (p = 'b' and (dr = 0 or dc = 0)) then continue; end if;
      rr := r + dr; cc := c + dc;
      while rr between 0 and 7 and cc between 0 and 7 loop
        v_out := v_out || (rr * 8 + cc);
        exit when p_bd[rr * 8 + cc + 1] <> '.';
        rr := rr + dr; cc := cc + dc;
      end loop;
    end loop;
  end if;
  return v_out;
end $$;

-- Má strana na tahu aspoň jeden tah podle pravidel?
create or replace function public.mp_chess_has_move(p_bd text[], p_castle text, p_ep int, p_white boolean)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare
  f int;
  t int;
  p text;
begin
  for f in 0..63 loop
    p := p_bd[f + 1];
    if p = '.' or (p <> lower(p)) <> p_white then continue; end if;
    foreach t in array public.mp_chess_cands(p_bd, f) loop
      if (public.mp_chess_try(p_bd, p_castle, p_ep, f, t, case when lower(p) = 'p' and (t / 8) in (0, 7) then 'q' else '' end)).ok then return true; end if;
    end loop;
  end loop;
  return false;
end $$;

-- Všechny tahy podle pravidel (pro zkoušky a rozbor): pole odkud a kam, proměna a pozice po tahu.
create or replace function public.mp_chess_moves(p_bd text[], p_castle text, p_ep int, p_white boolean)
returns table (f int, t int, promo text, nbd text[], ncastle text, nep int, irrev boolean) language plpgsql immutable set search_path to 'public' as $$
declare
  v_f int;
  v_t int;
  p text;
  v_promo text;
  s record;
begin
  for v_f in 0..63 loop
    p := p_bd[v_f + 1];
    if p = '.' or (p <> lower(p)) <> p_white then continue; end if;
    foreach v_t in array public.mp_chess_cands(p_bd, v_f) loop
      foreach v_promo in array (case when lower(p) = 'p' and (v_t / 8) in (0, 7) then array['q', 'r', 'b', 'n'] else array[''] end) loop
        select * into s from public.mp_chess_try(p_bd, p_castle, p_ep, v_f, v_t, v_promo);
        if s.ok then
          f := v_f; t := v_t; promo := v_promo; nbd := s.nbd; ncastle := s.ncastle; nep := s.nep; irrev := s.irrev;
          return next;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- Je v pozici nedostatek materiálu na mat? (holí králové, král s jedním střelcem nebo jezdcem, střelci na políčkách stejné barvy)
create or replace function public.mp_chess_insufficient(p_bd text[])
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare
  i int;
  p text;
  n int := 0;
  v_first text;
  v_second text;
  v_sq1 int;
  v_sq2 int;
begin
  for i in 0..63 loop
    p := p_bd[i + 1];
    if p = '.' or lower(p) = 'k' then continue; end if;
    n := n + 1;
    if n = 1 then v_first := p; v_sq1 := i; elsif n = 2 then v_second := p; v_sq2 := i; else return false; end if;
  end loop;
  if n = 0 then return true; end if;
  if n = 1 then return lower(v_first) in ('b', 'n'); end if;
  if lower(v_first) = 'b' and lower(v_second) = 'b' and (v_first <> lower(v_first)) <> (v_second <> lower(v_second)) then
    return ((v_sq1 / 8) + (v_sq1 % 8)) % 2 = ((v_sq2 / 8) + (v_sq2 % 8)) % 2;
  end if;
  return false;
end $$;

-- Může strana ještě matovat? Ne, má-li jen krále nebo krále a jednu lehkou figuru. Rozhoduje při vypršení času (soupeř bez materiálu na mat jen remizuje).
create or replace function public.mp_chess_can_mate(p_bd text[], p_white boolean)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare
  i int;
  p text;
  v_minors int := 0;
begin
  for i in 0..63 loop
    p := p_bd[i + 1];
    if p = '.' or (p <> lower(p)) <> p_white or lower(p) = 'k' then continue; end if;
    if lower(p) in ('p', 'r', 'q') then return true; end if;
    v_minors := v_minors + 1;
  end loop;
  return v_minors >= 2;
end $$;

-- Otisk pozice pro počítání opakování: šachovnice, strana na tahu, práva rošády a pole pro braní mimochodem (jako positionKey v appce).
create or replace function public.mp_chess_key(p_bd text[], p_turn text, p_castle text, p_ep int)
returns text language sql immutable set search_path to 'public' as $$
  select md5(array_to_string(p_bd, '') || p_turn || p_castle || p_ep::text)
$$;

-- Základní postavení partie.
create or replace function public.mp_chess_init()
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare v_b text := 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR';
begin
  return jsonb_build_object('b', v_b, 't', 'w', 'c', 'KQkq', 'e', -1, 'h', 0,
    'k', jsonb_build_object(public.mp_chess_key(regexp_split_to_array(v_b, ''), 'w', 'KQkq', -1), 1));
end $$;

-- Tah p_coord ("e2e4", "e7e8q") hráče p_slot ve stavu p_g. Vrací nový stav a výsledek: null (partie pokračuje) nebo důvod konce
-- (checkmate, stalemate, insufficient, fiftymove, repetition). Tah proti pravidlům = chyba illegal_move.
create or replace function public.mp_chess_step(p_g jsonb, p_slot smallint, p_coord text, out g jsonb, out result text)
language plpgsql immutable set search_path to 'public' as $$
declare
  v_white boolean := p_slot = 1;
  v_bd text[];
  v_castle text;
  v_ep int;
  v_half int;
  v_f int;
  v_t int;
  v_promo text;
  v_next text := case when p_slot = 1 then 'b' else 'w' end;
  s record;
  v_key text;
  v_seen jsonb;
  v_count int;
  v_ksq int;
begin
  if p_g is null or (p_g ->> 't') is distinct from (case when v_white then 'w' else 'b' end) then raise exception 'illegal_move'; end if;
  if p_coord is null or p_coord !~ '^[a-h][1-8][a-h][1-8][qrbn]?$' then raise exception 'illegal_move'; end if;
  v_bd := regexp_split_to_array(p_g ->> 'b', '');
  v_castle := p_g ->> 'c';
  v_ep := (p_g ->> 'e')::int;
  v_half := (p_g ->> 'h')::int;
  v_f := (8 - substr(p_coord, 2, 1)::int) * 8 + ascii(substr(p_coord, 1, 1)) - 97;
  v_t := (8 - substr(p_coord, 4, 1)::int) * 8 + ascii(substr(p_coord, 3, 1)) - 97;
  v_promo := nullif(substr(p_coord, 5, 1), '');
  select * into s from public.mp_chess_try(v_bd, v_castle, v_ep, v_f, v_t, v_promo);
  if not coalesce(s.ok, false) then raise exception 'illegal_move'; end if;
  -- táhnout smí jen strana na tahu: figura na výchozím poli musí mít její barvu
  if (v_bd[v_f + 1] <> lower(v_bd[v_f + 1])) <> v_white then raise exception 'illegal_move'; end if;

  v_half := case when s.irrev then 0 else v_half + 1 end;
  v_key := public.mp_chess_key(s.nbd, v_next, s.ncastle, s.nep);
  v_seen := case when s.irrev then '{}'::jsonb else coalesce(p_g -> 'k', '{}'::jsonb) end;
  v_count := coalesce((v_seen ->> v_key)::int, 0) + 1;
  v_seen := v_seen || jsonb_build_object(v_key, v_count);

  -- konec partie ve stejném pořadí jako v appce: mat nebo pat, nedostatek materiálu, padesát tahů, opakování
  v_ksq := array_position(s.nbd, case when v_next = 'w' then 'K' else 'k' end);
  if not public.mp_chess_has_move(s.nbd, s.ncastle, s.nep, v_next = 'w') then
    result := case when v_ksq is not null and public.mp_chess_attacked(s.nbd, v_ksq - 1, v_white) then 'checkmate' else 'stalemate' end;
  elsif public.mp_chess_insufficient(s.nbd) then result := 'insufficient';
  elsif v_half >= 100 then result := 'fiftymove';
  elsif v_count >= 3 then result := 'repetition';
  end if;
  g := jsonb_build_object('b', array_to_string(s.nbd, ''), 't', v_next, 'c', s.ncastle, 'e', s.nep, 'h', v_half, 'k', v_seen);
end $$;

-- Výsledek, když hráči p_loser vypršel čas: prohrává, jen pokud soupeř ještě může matovat; jinak je to remíza (timeout-material).
create or replace function public.mp_timeout_result(p_match public.mp_matches, p_loser smallint, out winner smallint, out reason text)
language plpgsql immutable set search_path to 'public' as $$
begin
  winner := (3 - p_loser)::smallint;
  reason := 'timeout';
  -- týmová hra (spolupráce): kdo nestihl tah, vítězství soupeři nedává, zápas skončí bez výhry
  if coalesce((p_match.rules ->> 'team')::boolean, false) then winner := 0; return; end if;
  if (p_match.rules ->> 'engine') = 'chess' and p_match.gstate is not null
     and not public.mp_chess_can_mate(regexp_split_to_array(p_match.gstate ->> 'b', ''), winner = 1) then
    winner := 0;
    reason := 'timeout-material';
  end if;
end $$;

-- ---------- Ostatní tahové hry: kontrola tvaru a rozumných mezí tahů ----------
-- Pravidla Kouloví Kámošů (fyzika), Warroomu a Hannibala (celá bitva) server neumí přehrát, ty počítají hry samy a soupeř každý tah u sebe ověří. Server proto
-- hlídá aspoň to, co hlídat jde: tvar zprávy (nic navíc, žádné nesmysly), pořadí tahů, rozumné meze čísel a to, co se dá spočítat ze společného semínka.
-- Tah mimo to je chyba illegal_move a nezapíše se.

-- 32bitové počítání jako v JavaScriptu (pro pořadí koulí v Kouloví Kámoších)
create or replace function public.mp_i32(p_x bigint)
returns bigint language sql immutable set search_path to 'public' as $$
  select case when (p_x & 4294967295) >= 2147483648 then (p_x & 4294967295) - 4294967296 else (p_x & 4294967295) end
$$;
create or replace function public.mp_imul(p_a bigint, p_b bigint)
returns bigint language sql immutable set search_path to 'public' as $$
  select public.mp_i32(public.mp_i32(p_a) * public.mp_i32(p_b))
$$;

-- Typ koule při k-tém hodu v Kouloví Kámoších: stejný vzorec jako mpType v src/gameContent/koulovi/mp.js (společné pořadí koulí ze semínka zápasu).
create or replace function public.mp_koulovi_type(p_seed bigint, p_k int)
returns int language plpgsql immutable set search_path to 'public' as $$
declare
  s bigint;
  t bigint;
  x bigint;
  r bigint;
begin
  s := public.mp_i32(public.mp_i32(p_seed) + public.mp_imul(p_k + 1, 1831565813));
  t := public.mp_imul(public.mp_i32(s # ((s & 4294967295) >> 15)), s | 1);
  x := t + public.mp_imul(public.mp_i32(t # ((t & 4294967295) >> 7)), 61 | t);
  t := public.mp_i32(public.mp_i32(x) # t);
  r := (t # ((t & 4294967295) >> 14)) & 4294967295;
  return (array[0, 0, 0, 1, 1, 2, 3])[floor(r::double precision / 4294967296.0 * 7)::int + 1];
end $$;

-- Je v poli jsonb číslo v mezích? (jsonb číslo je vždy konečné)
create or replace function public.mp_num_in(p_v jsonb, p_min double precision, p_max double precision)
returns boolean language sql immutable set search_path to 'public' as $$
  select jsonb_typeof(p_v) = 'number' and (p_v #>> '{}')::double precision between p_min and p_max
$$;
create or replace function public.mp_int_in(p_v jsonb, p_min bigint, p_max bigint)
returns boolean language sql immutable set search_path to 'public' as $$
  select jsonb_typeof(p_v) = 'number' and (p_v #>> '{}') ~ '^-?[0-9]+$' and (p_v #>> '{}')::numeric between p_min and p_max
$$;

create or replace function public.mp_check_payload(p_match public.mp_matches, p_slot smallint, p_payload jsonb)
returns void language plpgsql stable set search_path to 'public' as $$
declare
  v_game text := p_match.game_id;
  v_keys text[];
  v_k int;
  v_prev_len int;
  v_len int;
  v_ball jsonb;
  v_i int;
  v_a jsonb;
  v_n int;
  v_sum numeric;
begin
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'illegal_move'; end if;
  select array_agg(k) into v_keys from jsonb_object_keys(p_payload) k;

  if v_game = 'koulovikamosi' then
    -- hod {d:1, k, x, t}: typ koule je dán pořadím ze semínka (nejde si vybrat); stav misky {r:1, k, b:[koule]} nebo {r:1, k, out:1} (koule vypadla)
    v_k := (select count(*) from public.mp_moves where match_id = p_match.id and payload ? 'r');
    if not public.mp_int_in(p_payload -> 'k', 0, 100000) or (p_payload ->> 'k')::int <> v_k then raise exception 'illegal_move'; end if;
    if p_payload ? 'd' then
      if not (v_keys <@ array['d', 'k', 'x', 't']) or p_payload -> 'd' <> '1'::jsonb or not public.mp_num_in(p_payload -> 'x', 0, 540)
         or not public.mp_int_in(p_payload -> 't', 0, 11) or (p_payload ->> 't')::int <> public.mp_koulovi_type(p_match.seed, v_k) then raise exception 'illegal_move'; end if;
    elsif p_payload ? 'r' then
      if p_payload -> 'r' <> '1'::jsonb then raise exception 'illegal_move'; end if;
      if p_payload ? 'out' then
        if not (v_keys <@ array['r', 'k', 'out']) or p_payload -> 'out' <> '1'::jsonb then raise exception 'illegal_move'; end if;
      else
        if not (v_keys <@ array['r', 'k', 'b']) or jsonb_typeof(p_payload -> 'b') <> 'array' then raise exception 'illegal_move'; end if;
        v_len := jsonb_array_length(p_payload -> 'b');
        select coalesce(jsonb_array_length(payload -> 'b'), 0) into v_prev_len from public.mp_moves
          where match_id = p_match.id and payload ? 'r' and payload ? 'b' order by seq desc limit 1;
        v_prev_len := coalesce(v_prev_len, 0);
        -- po hodu přibude nejvýš jedna koule (spojováním jich ubývá); víc než 160 se do misky nevejde
        if v_len < 1 or v_len > 160 or v_len > v_prev_len + 1 then raise exception 'illegal_move'; end if;
        -- každá koule: [typ, fáze, 8 bodů těla x, y]
        for v_i in 0..(v_len - 1) loop
          v_ball := (p_payload -> 'b') -> v_i;
          if jsonb_typeof(v_ball) <> 'array' or jsonb_array_length(v_ball) <> 18 or not public.mp_int_in(v_ball -> 0, 0, 11) or not public.mp_num_in(v_ball -> 1, -1000, 1000) then raise exception 'illegal_move'; end if;
          for v_n in 2..17 loop
            if not public.mp_num_in(v_ball -> v_n, -100, case when v_n % 2 = 0 then 640 else 1060 end) then raise exception 'illegal_move'; end if;   -- x je na sudých místech, y na lichých
          end loop;
        end loop;
      end if;
    else
      raise exception 'illegal_move';
    end if;

  elsif v_game = 'warroom' then
    -- den {t:'a', k, adv, m, d, w, l}: k je pořadí dne hráče, adv posun fronty, d doktrína (jen první den), w vyhrál jsem, l prohrál jsem
    if not (v_keys <@ array['t', 'k', 'adv', 'm', 'd', 'w', 'l']) or p_payload -> 't' <> '"a"'::jsonb then raise exception 'illegal_move'; end if;
    v_k := (select count(*) from public.mp_moves where match_id = p_match.id and player = p_slot) + 1;
    if not public.mp_int_in(p_payload -> 'k', 1, 100000) or (p_payload ->> 'k')::int <> v_k then raise exception 'illegal_move'; end if;
    if not public.mp_num_in(p_payload -> 'adv', 0, 3000) then raise exception 'illegal_move'; end if;   -- soupeřova hra bere nejvýš 1000 za den
    if p_payload ? 'm' and (jsonb_typeof(p_payload -> 'm') <> 'string' or length(p_payload ->> 'm') > 300) then raise exception 'illegal_move'; end if;
    if p_payload ? 'd' and (v_k <> 1 or jsonb_typeof(p_payload -> 'd') <> 'string'
       or (p_payload ->> 'd') not in ('fortress', 'blitz', 'intel', 'quartermaster', 'tech', 'artillery', 'partisan', 'propaganda', 'fanatic', 'fleet', 'mercenary', 'chemical')) then raise exception 'illegal_move'; end if;
    if p_payload ? 'w' and p_payload -> 'w' <> '1'::jsonb then raise exception 'illegal_move'; end if;
    if p_payload ? 'l' and p_payload -> 'l' <> '1'::jsonb then raise exception 'illegal_move'; end if;
    if p_payload ? 'w' and p_payload ? 'l' then raise exception 'illegal_move'; end if;
    -- vítězství znamená dotlačit frontu z poloviny na maximum (aspoň ~90 bodů i v nejmenším scénáři): bez dostatečného postupu se tvrzení nepřijme
    if p_payload ? 'w' then
      select coalesce(sum((payload ->> 'adv')::numeric), 0) into v_sum from public.mp_moves where match_id = p_match.id and player = p_slot;
      if v_sum + (p_payload ->> 'adv')::numeric < 90 then raise exception 'illegal_move'; end if;
    end if;

  elsif v_game = 'onlinegames' then
    -- Katakomby (jediný tahový režim Jomarid Online Games): hrdina {t:'hero', h: 0-4} (první dva tahy zápasu, po jednom od každého), zahrání karty {t:'p', k: číslo karty v ruce},
    -- konec tahu {t:'e', x: otisk stavu, a: 1 když tah za poraženého hrdinu ukončila hra sama} a výběr odměny po vlně {t:'r', j: 0-2}
    if not (v_keys <@ array['t', 'h', 'k', 'x', 'a', 'j']) or jsonb_typeof(p_payload -> 't') <> 'string' then raise exception 'illegal_move'; end if;
    if p_match.mode <> 'katakomby' then raise exception 'illegal_move'; end if;
    if (p_payload ->> 't') = 'hero' then
      if p_match.move_count >= 2 or not (v_keys <@ array['t', 'h']) or not public.mp_int_in(p_payload -> 'h', 0, 4) then raise exception 'illegal_move'; end if;
    else
      if p_match.move_count < 2 then raise exception 'illegal_move'; end if;
      if (p_payload ->> 't') = 'p' then
        if not (v_keys <@ array['t', 'k']) or not public.mp_int_in(p_payload -> 'k', 0, 9) then raise exception 'illegal_move'; end if;
      elsif (p_payload ->> 't') = 'e' then
        if not (v_keys <@ array['t', 'x', 'a']) or (p_payload ? 'x' and not public.mp_int_in(p_payload -> 'x', 0, 4294967295)) or (p_payload ? 'a' and p_payload -> 'a' <> '1'::jsonb) then raise exception 'illegal_move'; end if;
      elsif (p_payload ->> 't') = 'r' then
        if not (v_keys <@ array['t', 'j']) or not public.mp_int_in(p_payload -> 'j', 0, 2) then raise exception 'illegal_move'; end if;
      else
        raise exception 'illegal_move';
      end if;
    end if;

  elsif v_game = 'hannibal' then
    -- tah {t:'turn', k: pořadí tahu v zápase od 0, a: seznam akcí, h: otisk stavu, e: konec}; akce: ['m', jednotka, sloupec, řada], ['a', útočník, cíl], ['b', jednotka], ['u']
    if not (v_keys <@ array['t', 'k', 'a', 'h', 'e']) or p_payload -> 't' <> '"turn"'::jsonb then raise exception 'illegal_move'; end if;
    if not public.mp_int_in(p_payload -> 'k', 0, 100000) or (p_payload ->> 'k')::int <> p_match.move_count then raise exception 'illegal_move'; end if;
    if not public.mp_int_in(p_payload -> 'h', 0, 4294967295) or (p_payload ? 'e' and not public.mp_int_in(p_payload -> 'e', 0, 1)) then raise exception 'illegal_move'; end if;
    if jsonb_typeof(p_payload -> 'a') <> 'array' or jsonb_array_length(p_payload -> 'a') > 150 then raise exception 'illegal_move'; end if;
    for v_i in 0..(jsonb_array_length(p_payload -> 'a') - 1) loop
      v_a := (p_payload -> 'a') -> v_i;
      if jsonb_typeof(v_a) <> 'array' or jsonb_typeof(v_a -> 0) <> 'string' then raise exception 'illegal_move'; end if;
      v_n := jsonb_array_length(v_a);
      if not (case v_a ->> 0
                when 'm' then v_n = 4 and jsonb_typeof(v_a -> 1) in ('string', 'number') and public.mp_int_in(v_a -> 2, 0, 11) and public.mp_int_in(v_a -> 3, 0, 7)
                when 'a' then v_n = 3 and jsonb_typeof(v_a -> 1) in ('string', 'number') and jsonb_typeof(v_a -> 2) in ('string', 'number')
                when 'b' then v_n = 2 and jsonb_typeof(v_a -> 1) in ('string', 'number')
                when 'u' then v_n = 1
                else false end) then raise exception 'illegal_move'; end if;
    end loop;
  end if;
end $$;

-- Zapíše výsledek zápasu do žebříčku. Jen řádně odehraný zápas (stejné podmínky jako pro odměnu: dost tahů a dost dlouho), ať se hodnocení nedá nabrat rychlým vzdáním.
-- Týmová hra (Rocket spolupráce) počítá výhry a prohry oběma, ostatní hry navíc upraví hodnocení podle Elo (K = 32, nejméně 100).
create or replace function public.mp_record_result(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  m public.mp_matches%rowtype;
  r1 int;
  r2 int;
  s1 double precision;
  e1 double precision;
  n1 int;
  n2 int;
begin
  select * into m from public.mp_matches where id = p_match;
  if not found or m.status <> 'finished' or m.winner is null then return; end if;
  if m.move_count < coalesce((m.rules ->> 'min_moves')::int, 0) then return; end if;
  if extract(epoch from (m.finished_at - m.created_at)) < coalesce((m.rules ->> 'min_seconds')::int, 0) then return; end if;
  insert into public.mp_record (user_id, game_id, mode) values (m.p1, m.game_id, m.mode), (m.p2, m.game_id, m.mode) on conflict do nothing;
  if coalesce((m.rules ->> 'team')::boolean, false) then
    update public.mp_record set wins = wins + (case when m.winner = 3 then 1 else 0 end), losses = losses + (case when m.winner = 3 then 0 else 1 end), last_played = now()
      where game_id = m.game_id and mode = m.mode and user_id in (m.p1, m.p2);
    return;
  end if;
  select rating into r1 from public.mp_record where user_id = m.p1 and game_id = m.game_id and mode = m.mode;
  select rating into r2 from public.mp_record where user_id = m.p2 and game_id = m.game_id and mode = m.mode;
  s1 := case m.winner when 1 then 1.0 when 2 then 0.0 else 0.5 end;
  e1 := 1.0 / (1.0 + power(10.0, (r2 - r1) / 400.0));
  n1 := greatest(100, round(r1 + 32 * (s1 - e1))::int);
  n2 := greatest(100, round(r2 + 32 * ((1 - s1) - (1 - e1)))::int);
  update public.mp_record set rating = n1, last_played = now(),
      wins = wins + (case when m.winner = 1 then 1 else 0 end), losses = losses + (case when m.winner = 2 then 1 else 0 end), draws = draws + (case when m.winner = 0 then 1 else 0 end)
    where user_id = m.p1 and game_id = m.game_id and mode = m.mode;
  update public.mp_record set rating = n2, last_played = now(),
      wins = wins + (case when m.winner = 2 then 1 else 0 end), losses = losses + (case when m.winner = 1 then 1 else 0 end), draws = draws + (case when m.winner = 0 then 1 else 0 end)
    where user_id = m.p2 and game_id = m.game_id and mode = m.mode;
end $$;

-- Žebříček hry a režimu: nejlepší hráči podle hodnocení (u týmové hry podle výher) a pozice volajícího. Vrací {team, players, rows: [{rank, name, wins, losses, draws, rating, me}], me}.
create or replace function public.mp_leaderboard(p_game text, p_mode text default 'duel', p_limit int default 10)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_cfg jsonb;
  v_team boolean;
  v_limit int := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_rows jsonb;
  v_me jsonb;
  v_players int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_cfg := public.mp_cfg(p_game, coalesce(p_mode, 'duel'));
  if v_cfg is null then raise exception 'unknown_mode'; end if;
  v_team := coalesce((v_cfg ->> 'team')::boolean, false);
  with ranked as (
    select r.*, row_number() over (order by (case when v_team then r.wins else r.rating end) desc, r.wins desc, r.last_played desc, r.user_id) as rk
    from public.mp_record r where r.game_id = p_game and r.mode = p_mode and (r.wins + r.losses + r.draws) > 0)
  select coalesce(jsonb_agg(jsonb_build_object('rank', x.rk, 'name', public.mp_user_name(x.user_id), 'wins', x.wins, 'losses', x.losses, 'draws', x.draws, 'rating', x.rating, 'me', x.user_id = v_uid) order by x.rk) filter (where x.rk <= v_limit), '[]'::jsonb),
         (select jsonb_build_object('rank', y.rk, 'wins', y.wins, 'losses', y.losses, 'draws', y.draws, 'rating', y.rating) from ranked y where y.user_id = v_uid),
         count(*)::int
    into v_rows, v_me, v_players from ranked x;
  return jsonb_build_object('team', v_team, 'players', coalesce(v_players, 0), 'rows', v_rows, 'me', v_me);
end $$;

-- Rychlá reakce hráče (kód 1 až 8: třeba palec nahoru, údiv, smích, podání ruky). Soupeř ji uvidí v pohledu na zápas (opp_emote). Nejvýš jedna za 3 vteřiny, jen v běžícím zápase.
create or replace function public.mp_emote(p_match uuid, p_code int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  m public.mp_matches%rowtype;
  v_slot text;
  v_prev jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_code is null or p_code < 1 or p_code > 8 then raise exception 'invalid_emote'; end if;
  m := public.mp_load(p_match, v_uid);
  if m.status <> 'active' then raise exception 'not_active'; end if;
  v_slot := case when m.p1 = v_uid then '1' else '2' end;
  v_prev := m.emotes -> v_slot;
  if v_prev is not null and (extract(epoch from clock_timestamp()) * 1000 - (v_prev ->> 'at')::double precision) < 3000 then raise exception 'too_soon'; end if;
  update public.mp_matches set emotes = jsonb_set(coalesce(emotes, '{}'::jsonb), array[v_slot],
      jsonb_build_object('c', p_code, 'n', coalesce((v_prev ->> 'n')::int, 0) + 1, 'at', (extract(epoch from clock_timestamp()) * 1000)::bigint))
    where id = m.id;
  return jsonb_build_object('ok', true);
end $$;

-- Odveta: oba hráči skončeného zápasu (do 10 minut od konce) ji chtějí. První dostane {status: 'waiting'} a ptá se znovu, jakmile ji chce i druhý, vznikne nový zápas
-- se stejnými volbami a prohozenými stranami (barvami) a oba dostanou {status: 'matched', match}. Chyby: not_finished, too_late, already_in_match.
create or replace function public.mp_rematch(p_match uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  m public.mp_matches%rowtype;
  n public.mp_matches%rowtype;
  v_other timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  m := public.mp_load(p_match, v_uid);
  if m.status <> 'finished' then raise exception 'not_finished'; end if;
  if m.next_match is not null then
    select * into n from public.mp_matches where id = m.next_match;
    return jsonb_build_object('status', 'matched', 'match', public.mp_match_json(n, v_uid));
  end if;
  if m.finished_at < clock_timestamp() - interval '10 minutes' then raise exception 'too_late'; end if;
  if m.p1 = v_uid then update public.mp_matches set rematch1 = clock_timestamp() where id = m.id; else update public.mp_matches set rematch2 = clock_timestamp() where id = m.id; end if;
  v_other := case when m.p1 = v_uid then m.rematch2 else m.rematch1 end;
  if v_other is null or v_other < clock_timestamp() - interval '10 minutes' then return jsonb_build_object('status', 'waiting'); end if;
  if exists (select 1 from public.mp_matches x where x.status = 'active' and (x.p1 in (m.p1, m.p2) or x.p2 in (m.p1, m.p2))) then raise exception 'already_in_match'; end if;
  n := public.mp_create_match(m.game_id, m.mode, m.params, m.p2, m.p1);
  update public.mp_matches set next_match = n.id where id = m.id;
  delete from public.mp_queue where user_id in (m.p1, m.p2);
  return jsonb_build_object('status', 'matched', 'match', public.mp_match_json(n, v_uid));
end $$;

-- Komu vypršel čas, prohrává. Volá se při dotazu na stav zápasu (kdokoli ze dvou hráčů ho spustí).
create or replace function public.mp_expire(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  m public.mp_matches%rowtype;
  v_lim jsonb := public.mp_limits();
  v_res record;
begin
  select * into m from public.mp_matches where id = p_match for update;
  if not found or m.status <> 'active' or m.deadline is null or m.turn is null then return; end if;
  if clock_timestamp() <= m.deadline + make_interval(secs => (v_lim ->> 'late_grace')::int) then return; end if;
  select * into v_res from public.mp_timeout_result(m, m.turn);
  perform public.mp_finalize(m.id, v_res.winner, v_res.reason);
end $$;

-- Úklid: zapomenuté zápasy se zruší, staré dohrané se smažou, vypršené místnosti také. Volá se zdarma při hledání soupeře.
create or replace function public.mp_tidy()
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_lim jsonb := public.mp_limits();
begin
  delete from public.mp_queue where last_seen < now() - make_interval(secs => (v_lim ->> 'queue_ttl')::int * 3) and match_id is null;
  update public.mp_matches set status = 'void', reason = 'abandoned', finished_at = now(), deadline = null
    where status = 'active' and greatest(seen1, seen2) < now() - make_interval(mins => (v_lim ->> 'abandon_minutes')::int);
  delete from public.mp_matches where id in (
    select id from public.mp_matches where status <> 'active' and created_at < now() - make_interval(days => (v_lim ->> 'keep_days')::int) limit 100);
  delete from public.mp_rooms where expires_at < now() - interval '1 minute';
end $$;

-- Je přihlášený hráč v kanálu? Zápas: 'mp:<id zápasu>'; sdílená aréna Polygonu: 'mp-arena:polygonarena'. Používají ho pravidla Realtime níže.
create or replace function public.mp_topic_ok(p_topic text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null or p_topic is null then return false; end if;
  if p_topic = 'mp-arena:polygonarena' then return true; end if;
  if left(p_topic, 3) = 'mp:' then
    begin v_id := substr(p_topic, 4)::uuid; exception when others then return false; end;
    return exists (select 1 from public.mp_matches m where m.id = v_id and m.status = 'active' and v_uid in (m.p1, m.p2));
  end if;
  return false;
end $$;

-- ---------- Funkce pro appku ----------
-- Zjištění, že multiplayer v databázi je (appka ho jinak nenabízí): {ok, v, realtime}. realtime je true, když jsou pravidla kanálů nastavená.
create or replace function public.mp_ping()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object('ok', true, 'v', 1,
    'realtime', coalesce(to_regclass('realtime.messages') is not null and exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'mp_broadcast_select'), false));
end $$;

-- Kolik hráčů právě čeká na soupeře v dané hře a režimu.
create or replace function public.mp_queue_count(p_game text, p_mode text default 'duel')
returns int language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return (select count(*) from public.mp_queue where game_id = p_game and mode = p_mode and match_id is null and last_seen > now() - make_interval(secs => (public.mp_limits() ->> 'queue_ttl')::int));
end $$;

-- Přehled hráče: výhry, prohry a remízy po hrách, kolik Coinů z online výher dnes získal a kolik ještě může.
create or replace function public.mp_stats()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object(
    'daily_cap', (public.mp_limits() ->> 'daily_cap')::int,
    'room_left', public.mp_room_left(v_uid),
    'games', coalesce((
      select jsonb_object_agg(g.game_id, jsonb_build_object('wins', g.w, 'losses', g.l, 'draws', g.d))
      from (
        select m.game_id,
               count(*) filter (where m.winner = 3 or (m.winner = 1 and m.p1 = v_uid) or (m.winner = 2 and m.p2 = v_uid)) as w,
               count(*) filter (where (m.winner = 1 and m.p2 = v_uid) or (m.winner = 2 and m.p1 = v_uid) or (m.winner = 0 and coalesce((m.rules ->> 'team')::boolean, false))) as l,
               count(*) filter (where m.winner = 0 and not coalesce((m.rules ->> 'team')::boolean, false)) as d
        from public.mp_matches m where m.status = 'finished' and v_uid in (m.p1, m.p2) group by m.game_id) g), '{}'::jsonb));
end $$;

-- Rozehraný zápas hráče (po obnovení stránky se k němu vrátí), nebo null.
create or replace function public.mp_active()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  m public.mp_matches%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into m from public.mp_matches where status = 'active' and (p1 = v_uid or p2 = v_uid) order by created_at desc limit 1;
  if not found then return null; end if;
  return public.mp_match_json(m, v_uid);
end $$;

-- Zápas založený podle pravidel: hráč p_first je první (slot 1), p_second druhý.
create or replace function public.mp_create_match(p_game text, p_mode text, p_params jsonb, p_first uuid, p_second uuid)
returns public.mp_matches language plpgsql security definer set search_path to 'public' as $$
declare
  v_rules jsonb := public.mp_rules(p_game, p_mode, p_params);
  v_lim jsonb := public.mp_limits();
  v_turn boolean := (v_rules ->> 'kind') = 'turn';
  v_first_secs int := coalesce((v_rules ->> 'first_move')::int, 60) + (v_lim ->> 'join_grace')::int;
  m public.mp_matches%rowtype;
begin
  insert into public.mp_matches (game_id, mode, params, rules, seed, p1, p2, turn, turn_started, deadline, bank1, bank2, gstate)
    values (p_game, p_mode, p_params, v_rules, floor(random() * 4294967296)::bigint, p_first, p_second,
            case when v_turn then 1 else null end, case when v_turn then now() else null end,
            case when v_turn then now() + make_interval(secs => v_first_secs) else null end,
            coalesce((v_rules ->> 'bank')::int, 0), coalesce((v_rules ->> 'bank')::int, 0),
            case when (v_rules ->> 'engine') = 'chess' then public.mp_chess_init() else null end)
    returning * into m;
  return m;
end $$;

-- Hledání soupeře: volá se opakovaně (každé 2 vteřiny je zároveň „jsem tu“). Vrací {status: 'waiting', queued} nebo {status: 'matched', match}.
create or replace function public.mp_find(p_game text, p_mode text, p_params jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_lim jsonb := public.mp_limits();
  v_params jsonb;
  q public.mp_queue%rowtype;
  o public.mp_queue%rowtype;
  m public.mp_matches%rowtype;
  v_swap boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if public.mp_cfg(p_game, p_mode) is null then raise exception 'unknown_mode'; end if;
  v_params := public.mp_clean_params(p_game, p_mode, coalesce(p_params, '{}'::jsonb));
  if not exists (select 1 from public.profiles where id = v_uid) then raise exception 'profile_not_found'; end if;

  perform pg_advisory_xact_lock(hashtext('mp_find'));
  perform public.mp_tidy();

  -- už rozehraný zápas: vrátí se k němu (po obnovení stránky, nebo když hráče mezitím spároval někdo jiný)
  select * into m from public.mp_matches where status = 'active' and (p1 = v_uid or p2 = v_uid) order by created_at desc limit 1;
  if found then
    delete from public.mp_queue where user_id = v_uid;
    return jsonb_build_object('status', 'matched', 'match', public.mp_match_json(m, v_uid));
  end if;

  -- zastaralé řádky ve frontě pryč (nikdo se neptá)
  delete from public.mp_queue where last_seen < now() - make_interval(secs => (v_lim ->> 'queue_ttl')::int);

  select * into o from public.mp_queue
    where user_id <> v_uid and game_id = p_game and mode = p_mode and params = v_params and match_id is null
    order by joined_at limit 1 for update;
  if found then
    v_swap := random() < 0.5;
    m := public.mp_create_match(p_game, p_mode, v_params, case when v_swap then v_uid else o.user_id end, case when v_swap then o.user_id else v_uid end);
    update public.mp_queue set match_id = m.id where user_id = o.user_id;
    delete from public.mp_queue where user_id = v_uid;
    return jsonb_build_object('status', 'matched', 'match', public.mp_match_json(m, v_uid));
  end if;

  insert into public.mp_queue (user_id, game_id, mode, params) values (v_uid, p_game, p_mode, v_params)
    on conflict (user_id) do update
      set joined_at = case when mp_queue.game_id = excluded.game_id and mp_queue.mode = excluded.mode and mp_queue.params = excluded.params then mp_queue.joined_at else now() end,
          game_id = excluded.game_id, mode = excluded.mode, params = excluded.params, last_seen = now(), match_id = null;
  select * into q from public.mp_queue where user_id = v_uid;
  return jsonb_build_object('status', 'waiting', 'waited', floor(extract(epoch from (now() - q.joined_at)))::int,
    'queued', (select count(*) from public.mp_queue where game_id = p_game and mode = p_mode and match_id is null));
end $$;

-- Z fronty pryč (a z rozdělané místnosti také).
create or replace function public.mp_cancel()
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  delete from public.mp_queue where user_id = v_uid and match_id is null;
  delete from public.mp_rooms where host = v_uid and match_id is null;
end $$;

-- Místnost pro hru s kamarádem: vrátí kód (6 znaků), který host řekne druhému. Host pak čeká na zápas přes mp_active.
create or replace function public.mp_room_create(p_game text, p_mode text, p_params jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_lim jsonb := public.mp_limits();
  v_params jsonb;
  v_code text;
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_tries int := 0;
  v_exp timestamptz := now() + make_interval(mins => (v_lim ->> 'room_minutes')::int);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if public.mp_cfg(p_game, p_mode) is null then raise exception 'unknown_mode'; end if;
  v_params := public.mp_clean_params(p_game, p_mode, coalesce(p_params, '{}'::jsonb));
  if not exists (select 1 from public.profiles where id = v_uid) then raise exception 'profile_not_found'; end if;
  perform pg_advisory_xact_lock(hashtext('mp_find'));
  perform public.mp_tidy();
  if exists (select 1 from public.mp_matches where status = 'active' and (p1 = v_uid or p2 = v_uid)) then raise exception 'already_in_match'; end if;
  delete from public.mp_queue where user_id = v_uid;
  delete from public.mp_rooms where host = v_uid;
  loop
    v_code := (select string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from public.mp_rooms where code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 20 then raise exception 'try_again'; end if;
  end loop;
  insert into public.mp_rooms (code, host, game_id, mode, params, expires_at) values (v_code, v_uid, p_game, p_mode, v_params, v_exp);
  return jsonb_build_object('code', v_code, 'expires', (extract(epoch from v_exp) * 1000)::bigint);
end $$;

-- Připojení do místnosti kódem: založí zápas s hostem (kdo je první, se vylosuje) a vrátí ho. Host ho dostane přes mp_active.
create or replace function public.mp_room_join(p_code text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  r public.mp_rooms%rowtype;
  m public.mp_matches%rowtype;
  v_swap boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then raise exception 'profile_not_found'; end if;
  perform pg_advisory_xact_lock(hashtext('mp_find'));
  perform public.mp_tidy();
  select * into r from public.mp_rooms where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found or r.expires_at < now() then raise exception 'room_not_found'; end if;
  if r.match_id is not null then raise exception 'room_taken'; end if;
  if r.host = v_uid then raise exception 'own_room'; end if;
  if exists (select 1 from public.mp_matches where status = 'active' and (p1 = v_uid or p2 = v_uid)) then raise exception 'already_in_match'; end if;
  if exists (select 1 from public.mp_matches where status = 'active' and (p1 = r.host or p2 = r.host)) then raise exception 'room_not_found'; end if;
  v_swap := random() < 0.5;
  m := public.mp_create_match(r.game_id, r.mode, r.params, case when v_swap then v_uid else r.host end, case when v_swap then r.host else v_uid end);
  update public.mp_rooms set match_id = m.id where code = r.code;
  delete from public.mp_queue where user_id in (v_uid, r.host);
  return public.mp_match_json(m, v_uid);
end $$;

-- Stav zápasu a nové tahy od čísla p_since (dotaz je zároveň „jsem tu“; podle něj server pozná odpojeného soupeře). Vrací {match, moves: [{seq, p, payload, end, at}]}.
create or replace function public.mp_state(p_match uuid, p_since int default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_lim jsonb := public.mp_limits();
  m public.mp_matches%rowtype;
  v_slot int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  m := public.mp_load(p_match, v_uid);
  v_slot := case when m.p1 = v_uid then 1 else 2 end;
  -- „jsem tu“ se zapisuje nejvýš jednou za pár vteřin (jinak by každý dotaz vytvořil novou verzi řádku)
  if (case when v_slot = 1 then m.seen1 else m.seen2 end) < clock_timestamp() - make_interval(secs => (v_lim ->> 'seen_every')::int) then
    if v_slot = 1 then update public.mp_matches set seen1 = clock_timestamp() where id = m.id; else update public.mp_matches set seen2 = clock_timestamp() where id = m.id; end if;
  end if;
  if m.status = 'active' then
    perform public.mp_expire(m.id);
    if m.report1 is not null or m.report2 is not null then perform public.mp_settle(m.id); end if;
  end if;
  select * into m from public.mp_matches where id = p_match;
  return jsonb_build_object('match', public.mp_match_json(m, v_uid),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('seq', x.seq, 'p', x.player, 'payload', x.payload, 'end', x.end_turn, 'at', (extract(epoch from x.at) * 1000)::bigint) order by x.seq)
                       from (select * from public.mp_moves where match_id = p_match and seq > greatest(coalesce(p_since, 0), 0) order by seq limit 300) x), '[]'::jsonb));
end $$;

-- Tah (zpráva) hráče. Smí jen ten, kdo je na tahu, a s dalším číslem v pořadí (p_seq = počet dosavadních + 1); opakované odeslání téhož se přijme jen jednou.
-- p_end_turn = false nechá hráče na tahu (hry s víc akcemi v jednom tahu). Vrací {ok, seq, turn, deadline, bank}; po vypršení času {ok: false, error: 'timeout'}
-- (hráč prohrál). Chyby: not_in_match, not_active, not_your_turn, bad_seq, too_large, too_many, not_turn_based, invalid_payload.
create or replace function public.mp_move(p_match uuid, p_seq int, p_payload jsonb, p_end_turn boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_lim jsonb := public.mp_limits();
  m public.mp_matches%rowtype;
  v_slot smallint;
  v_old public.mp_moves%rowtype;
  v_bank int;
  v_inc int;
  v_end boolean := coalesce(p_end_turn, true);
  v_spent double precision;
  v_mine double precision;
  v_other double precision;
  v_deadline timestamptz;
  v_engine text;
  v_step record;
  v_gnew jsonb;
  v_gres text;
  v_res record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  m := public.mp_load(p_match, v_uid);
  v_slot := case when m.p1 = v_uid then 1 else 2 end;
  if (m.rules ->> 'kind') <> 'turn' then raise exception 'not_turn_based'; end if;
  if p_payload is null or jsonb_typeof(p_payload) not in ('object', 'array', 'string', 'number') then raise exception 'invalid_payload'; end if;
  if octet_length(p_payload::text) > (m.rules ->> 'max_payload')::int then raise exception 'too_large'; end if;
  if p_seq is null or p_seq < 1 then raise exception 'bad_seq'; end if;
  -- Šachy: server zná pravidla, tah musí být {c: "e2e4"} a podle pravidel. Do zápisu jde jen ten čistý tvar (nic navíc se neuloží) a tah vždy předává řadu.
  v_engine := m.rules ->> 'engine';
  if v_engine = 'chess' then
    if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload -> 'c') is distinct from 'string' or (p_payload ->> 'c') !~ '^[a-h][1-8][a-h][1-8][qrbn]?$' then raise exception 'illegal_move'; end if;
    p_payload := jsonb_build_object('c', p_payload ->> 'c');
    v_end := true;
  end if;

  -- opakované odeslání (výpadek spojení po úspěšném zápisu): stejný tah téhož hráče se přijme znovu jako úspěch
  select * into v_old from public.mp_moves where match_id = m.id and seq = p_seq;
  if found then
    if v_old.player = v_slot and v_old.payload = p_payload then
      return jsonb_build_object('ok', true, 'seq', p_seq, 'turn', m.turn, 'again', true,
        'deadline', case when m.deadline is null then null else (extract(epoch from m.deadline) * 1000)::bigint end, 'bank', jsonb_build_array(m.bank1, m.bank2));
    end if;
    raise exception 'bad_seq';
  end if;

  if m.status <> 'active' then raise exception 'not_active'; end if;
  if m.turn is distinct from v_slot then raise exception 'not_your_turn'; end if;
  if p_seq <> m.move_count + 1 then raise exception 'bad_seq'; end if;
  if m.move_count >= (m.rules ->> 'max_moves')::int then raise exception 'too_many'; end if;

  v_bank := coalesce((m.rules ->> 'bank')::int, 0);
  v_inc := coalesce((m.rules ->> 'inc')::int, 0);
  v_mine := case when v_slot = 1 then m.bank1 else m.bank2 end;
  v_other := case when v_slot = 1 then m.bank2 else m.bank1 end;

  -- čas: hodiny (první tah hodiny nespotřebuje) nebo limit na tah; kdo to nestihl, prohrál
  if v_bank > 0 then
    v_spent := case when m.move_count = 0 then 0 else extract(epoch from (clock_timestamp() - m.turn_started)) end;
    if m.move_count = 0 and clock_timestamp() > m.deadline + make_interval(secs => (v_lim ->> 'late_grace')::int) then v_mine := 0; v_spent := 1; end if;
    if v_mine - v_spent <= 0 then
      select * into v_res from public.mp_timeout_result(m, v_slot);
      perform public.mp_finalize(m.id, v_res.winner, v_res.reason);
      select * into m from public.mp_matches where id = p_match;
      return jsonb_build_object('ok', false, 'error', 'timeout', 'match', public.mp_match_json(m, v_uid));
    end if;
    v_mine := v_mine - v_spent + (case when v_end then v_inc else 0 end);
  elsif clock_timestamp() > m.deadline + make_interval(secs => (v_lim ->> 'late_grace')::int) then
    select * into v_res from public.mp_timeout_result(m, v_slot);
    perform public.mp_finalize(m.id, v_res.winner, v_res.reason);
    select * into m from public.mp_matches where id = p_match;
    return jsonb_build_object('ok', false, 'error', 'timeout', 'match', public.mp_match_json(m, v_uid));
  end if;

  if v_engine = 'chess' then
    select * into v_step from public.mp_chess_step(m.gstate, v_slot, p_payload ->> 'c');   -- tah proti pravidlům = chyba illegal_move, nic se nezapíše
    v_gnew := v_step.g;
    v_gres := v_step.result;
  end if;
  if (m.rules ->> 'check') = 'shape' and m.game_id in ('koulovikamosi', 'warroom', 'hannibal', 'onlinegames') then
    perform public.mp_check_payload(m, v_slot, p_payload);   -- tvar a meze tahu, u Kouloví Kámošů i pořadí koulí; jinak chyba illegal_move
  end if;
  insert into public.mp_moves (match_id, seq, player, payload, end_turn) values (m.id, p_seq, v_slot, p_payload, v_end);
  if v_end then
    v_deadline := now() + make_interval(secs => case when v_bank > 0 then v_other else (m.rules ->> 'turn_seconds')::int end);
    update public.mp_matches set
        move_count = p_seq, turn = (3 - v_slot)::smallint, turn_started = clock_timestamp(), deadline = v_deadline,
        bank1 = case when v_slot = 1 and v_bank > 0 then v_mine else bank1 end,
        bank2 = case when v_slot = 2 and v_bank > 0 then v_mine else bank2 end,
        gstate = coalesce(v_gnew, gstate),
        seen1 = case when v_slot = 1 then clock_timestamp() else seen1 end,
        seen2 = case when v_slot = 2 then clock_timestamp() else seen2 end
      where id = m.id returning * into m;
    -- konec partie rozhoduje server: mat vyhrává ten, kdo táhl, ostatní konce (pat, materiál, padesát tahů, opakování) jsou remíza
    if v_gres is not null then
      perform public.mp_finalize(m.id, (case when v_gres = 'checkmate' then v_slot else 0 end)::smallint, v_gres);
      select * into m from public.mp_matches where id = p_match;
    end if;
  else
    -- hráč zůstává na tahu: hodiny běží dál, jen se posune číslo tahu
    update public.mp_matches set move_count = p_seq,
        seen1 = case when v_slot = 1 then clock_timestamp() else seen1 end,
        seen2 = case when v_slot = 2 then clock_timestamp() else seen2 end
      where id = m.id returning * into m;
  end if;
  return jsonb_build_object('ok', true, 'seq', p_seq, 'turn', m.turn, 'deadline', case when m.deadline is null then null else (extract(epoch from m.deadline) * 1000)::bigint end,
    'bank', jsonb_build_array(m.bank1, m.bank2), 'status', m.status, 'winner', m.winner, 'reason', m.reason,
    'match', case when m.status <> 'active' then public.mp_match_json(m, v_uid) else null end);   -- po uzavření zápasu rovnou celý pohled (výhra, Coiny)
end $$;

-- Průběh hráče v závodě (City Clicker: kolik peněz celkem vydělal; cíle jsou 1 miliarda, 10 miliard a 100 miliard podle měření ekonomiky hry). Jen roste (nižší hodnota se ignoruje) a nesmí předběhnout nejkratší možnou dobu závodu:
-- dřív, než uplyne min_seconds, se hodnota ořízne tak, aby ani při podvodu nešlo dosáhnout cíle. Kdo první dosáhne cíle, vyhrává a zápas se uzavře hned.
-- Vrací stav zápasu (průběh obou hráčů v prog).
create or replace function public.mp_progress(p_match uuid, p_value double precision)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  m public.mp_matches%rowtype;
  v_slot smallint;
  v_target double precision;
  v_min double precision;
  v_val double precision;
  v_elapsed double precision;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  m := public.mp_load(p_match, v_uid);
  if (m.rules ->> 'kind') <> 'race' then raise exception 'not_a_race'; end if;
  if p_value is null or p_value <> p_value or p_value < 0 or p_value > 1e300 then raise exception 'invalid_value'; end if;
  v_slot := case when m.p1 = v_uid then 1 else 2 end;
  if m.status = 'active' then
    v_target := (m.rules ->> 'target')::double precision;
    v_min := coalesce((m.rules ->> 'min_seconds')::double precision, 0);
    v_elapsed := extract(epoch from (clock_timestamp() - m.created_at));
    v_val := p_value;
    -- nejkratší možný průběh je přímka k cíli za min_seconds; hodnota nad ní se ořízne těsně pod cíl
    if v_min > 0 and v_elapsed < v_min then v_val := least(v_val, v_target * v_elapsed / v_min); end if;
    if v_slot = 1 then update public.mp_matches set prog1 = greatest(prog1, v_val), seen1 = clock_timestamp() where id = m.id;
    else update public.mp_matches set prog2 = greatest(prog2, v_val), seen2 = clock_timestamp() where id = m.id; end if;
    if v_val >= v_target then perform public.mp_finalize(m.id, v_slot, 'goal'); end if;
  end if;
  select * into m from public.mp_matches where id = p_match;
  return public.mp_match_json(m, v_uid);
end $$;

-- Hlášení výsledku z pohledu hráče: p_outcome je win, loss nebo draw (u týmové hry win nebo loss). Hlásit smí kdykoli, hlášení se dá změnit, dokud zápas běží.
-- Vrací stav zápasu; když se zápas uzavřel, je v něm winner a my_coins.
create or replace function public.mp_report(p_match uuid, p_outcome text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  m public.mp_matches%rowtype;
  v_report jsonb;
  v_team boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_outcome is null or p_outcome not in ('win', 'loss', 'draw') then raise exception 'invalid_outcome'; end if;
  m := public.mp_load(p_match, v_uid);
  v_team := coalesce((m.rules ->> 'team')::boolean, false);
  if v_team and p_outcome = 'draw' then raise exception 'invalid_outcome'; end if;
  if (m.rules ->> 'kind') = 'race' then raise exception 'not_reportable'; end if;
  -- Hra, jejíž pravidla hlídá server (šachy): výsledek určuje server z tahů a hodin, hlášení hráče se nebere (dá se jen zeptat na stav zápasu).
  if m.status = 'active' and (m.rules ->> 'engine') is null then
    v_report := jsonb_build_object('outcome', p_outcome, 'reason', left(regexp_replace(coalesce(p_reason, ''), '[^a-zA-Z0-9_]', '', 'g'), 30), 'at', clock_timestamp());
    if m.p1 = v_uid then update public.mp_matches set report1 = v_report, seen1 = clock_timestamp() where id = m.id;
    else update public.mp_matches set report2 = v_report, seen2 = clock_timestamp() where id = m.id; end if;
    perform public.mp_settle(m.id);
  end if;
  select * into m from public.mp_matches where id = p_match;
  return public.mp_match_json(m, v_uid);
end $$;

-- Vzdání: hráč prohrál, soupeř vyhrál (odměna podle podmínek). U týmové hry se zápas jen ukončí bez výhry. Zavření hry uprostřed zápasu se bere stejně.
create or replace function public.mp_resign(p_match uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  m public.mp_matches%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  m := public.mp_load(p_match, v_uid);
  if m.status = 'active' then
    if coalesce((m.rules ->> 'team')::boolean, false) then perform public.mp_finalize(m.id, 0::smallint, 'resign');
    else perform public.mp_finalize(m.id, (case when m.p1 = v_uid then 2 else 1 end)::smallint, 'resign'); end if;
  end if;
  select * into m from public.mp_matches where id = p_match;
  return public.mp_match_json(m, v_uid);
end $$;

-- Soupeř se vůbec nepřipojil (hra se mu nenačetla): zápas se zruší bez odměny a bez následků. Jde to, až když se soupeř delší dobu neozval.
create or replace function public.mp_abort(p_match uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_lim jsonb := public.mp_limits();
  m public.mp_matches%rowtype;
  v_seen timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  m := public.mp_load(p_match, v_uid);
  v_seen := case when m.p1 = v_uid then m.seen2 else m.seen1 end;
  if m.status = 'active' then
    if m.move_count > 0 then raise exception 'already_started'; end if;
    if clock_timestamp() - v_seen < make_interval(secs => (v_lim ->> 'idle')::int) then raise exception 'too_early'; end if;
    perform public.mp_finalize(m.id, null, 'no_show');
  end if;
  select * into m from public.mp_matches where id = p_match;
  return public.mp_match_json(m, v_uid);
end $$;

-- Výhra v Polygon aréně (jeden sdílený server, hráči a boti): hra žádá o odměnu za vyhrané kolo, server hlídá odstup mezi výhrami, délku kola a denní strop.
-- Vrací {granted, capped, balance}. Chyby: not_authenticated, profile_not_found, invalid_value, too_soon.
create or replace function public.mp_arena_claim(p_seconds int, p_score int default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_lim jsonb := public.mp_limits();
  v_last timestamptz;
  v_grant int := 0;
  v_balance bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_seconds is null or p_seconds < 0 or p_seconds > 86400 then raise exception 'invalid_value'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'profile_not_found'; end if;
  select last_claim into v_last from public.mp_arena_log where user_id = v_uid;
  if v_last is not null and clock_timestamp() - v_last < make_interval(secs => (v_lim ->> 'arena_gap')::int) then raise exception 'too_soon'; end if;
  insert into public.mp_arena_log (user_id, last_claim) values (v_uid, clock_timestamp())
    on conflict (user_id) do update set last_claim = excluded.last_claim;
  -- příliš krátké kolo se neplatí (hráč mohl jen přišel k dohrávajícímu)
  if p_seconds >= (v_lim ->> 'arena_gap')::int then
    v_grant := public.mp_grant(v_uid, 'polygonarena', to_char(clock_timestamp(), 'HH24MISS'), (v_lim ->> 'arena_reward')::int);
  end if;
  select coins into v_balance from public.profiles where id = v_uid;
  return jsonb_build_object('granted', v_grant, 'capped', v_grant < (v_lim ->> 'arena_reward')::int, 'balance', v_balance);
end $$;

-- ---------- Oprávnění ----------
revoke all on function public.mp_limits() from public, anon, authenticated;
revoke all on function public.mp_cfg(text, text) from public, anon, authenticated;
revoke all on function public.mp_clean_params(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.mp_rules(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.mp_user_name(uuid) from public, anon, authenticated;
revoke all on function public.mp_match_json(public.mp_matches, uuid) from public, anon, authenticated;
revoke all on function public.mp_load(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mp_room_left(uuid) from public, anon, authenticated;
revoke all on function public.mp_grant(uuid, text, text, int) from public, anon, authenticated;
revoke all on function public.mp_pay(uuid, smallint) from public, anon, authenticated;
revoke all on function public.mp_finalize(uuid, smallint, text) from public, anon, authenticated;
revoke all on function public.mp_settle(uuid) from public, anon, authenticated;
revoke all on function public.mp_chess_attacked(text[], int, boolean) from public, anon, authenticated;
revoke all on function public.mp_chess_try(text[], text, int, int, int, text) from public, anon, authenticated;
revoke all on function public.mp_chess_cands(text[], int) from public, anon, authenticated;
revoke all on function public.mp_chess_has_move(text[], text, int, boolean) from public, anon, authenticated;
revoke all on function public.mp_chess_moves(text[], text, int, boolean) from public, anon, authenticated;
revoke all on function public.mp_chess_insufficient(text[]) from public, anon, authenticated;
revoke all on function public.mp_chess_can_mate(text[], boolean) from public, anon, authenticated;
revoke all on function public.mp_chess_key(text[], text, text, int) from public, anon, authenticated;
revoke all on function public.mp_chess_init() from public, anon, authenticated;
revoke all on function public.mp_chess_step(jsonb, smallint, text) from public, anon, authenticated;
revoke all on function public.mp_timeout_result(public.mp_matches, smallint) from public, anon, authenticated;
revoke all on function public.mp_record_result(uuid) from public, anon, authenticated;
revoke all on function public.mp_i32(bigint) from public, anon, authenticated;
revoke all on function public.mp_imul(bigint, bigint) from public, anon, authenticated;
revoke all on function public.mp_koulovi_type(bigint, int) from public, anon, authenticated;
revoke all on function public.mp_num_in(jsonb, double precision, double precision) from public, anon, authenticated;
revoke all on function public.mp_int_in(jsonb, bigint, bigint) from public, anon, authenticated;
revoke all on function public.mp_check_payload(public.mp_matches, smallint, jsonb) from public, anon, authenticated;
revoke all on function public.mp_expire(uuid) from public, anon, authenticated;
revoke all on function public.mp_tidy() from public, anon, authenticated;
revoke all on function public.mp_create_match(text, text, jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mp_topic_ok(text) from public, anon;
revoke all on function public.mp_ping() from public, anon;
revoke all on function public.mp_queue_count(text, text) from public, anon;
revoke all on function public.mp_stats() from public, anon;
revoke all on function public.mp_active() from public, anon;
revoke all on function public.mp_find(text, text, jsonb) from public, anon;
revoke all on function public.mp_cancel() from public, anon;
revoke all on function public.mp_room_create(text, text, jsonb) from public, anon;
revoke all on function public.mp_room_join(text) from public, anon;
revoke all on function public.mp_state(uuid, int) from public, anon;
revoke all on function public.mp_move(uuid, int, jsonb, boolean) from public, anon;
revoke all on function public.mp_progress(uuid, double precision) from public, anon;
revoke all on function public.mp_report(uuid, text, text) from public, anon;
revoke all on function public.mp_leaderboard(text, text, int) from public, anon;
revoke all on function public.mp_emote(uuid, int) from public, anon;
revoke all on function public.mp_rematch(uuid) from public, anon;
revoke all on function public.mp_resign(uuid) from public, anon;
revoke all on function public.mp_abort(uuid) from public, anon;
revoke all on function public.mp_arena_claim(int, int) from public, anon;
grant execute on function public.mp_topic_ok(text) to authenticated;
grant execute on function public.mp_ping() to authenticated;
grant execute on function public.mp_queue_count(text, text) to authenticated;
grant execute on function public.mp_stats() to authenticated;
grant execute on function public.mp_active() to authenticated;
grant execute on function public.mp_find(text, text, jsonb) to authenticated;
grant execute on function public.mp_cancel() to authenticated;
grant execute on function public.mp_room_create(text, text, jsonb) to authenticated;
grant execute on function public.mp_room_join(text) to authenticated;
grant execute on function public.mp_state(uuid, int) to authenticated;
grant execute on function public.mp_move(uuid, int, jsonb, boolean) to authenticated;
grant execute on function public.mp_progress(uuid, double precision) to authenticated;
grant execute on function public.mp_report(uuid, text, text) to authenticated;
grant execute on function public.mp_leaderboard(text, text, int) to authenticated;
grant execute on function public.mp_emote(uuid, int) to authenticated;
grant execute on function public.mp_rematch(uuid) to authenticated;
grant execute on function public.mp_resign(uuid) to authenticated;
grant execute on function public.mp_abort(uuid) to authenticated;
grant execute on function public.mp_arena_claim(int, int) to authenticated;

-- ---------- Rychlé zprávy v reálném čase (Supabase Realtime) ----------
-- Hry v reálném čase (Rocket, Polygon aréna) posílají polohy a střely přes broadcast kanál zápasu 'mp:<id zápasu>' (Polygon aréna přes 'mp-arena:polygonarena').
-- Pravidla níže pouští do kanálu jen hráče zápasu (mp_topic_ok). Appka používá soukromé kanály (private: true), takže ostatní se do cizího zápasu nedostanou ani
-- se znalostí jeho čísla. Kdyby v projektu Realtime autorizace (tabulka realtime.messages) nebyla, soubor to jen oznámí: tahové hry fungují i bez ní.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'Realtime autorizace (tabulka realtime.messages) v projektu není: hry v reálném čase (Rocket, Polygon aréna) se zatím nezapnou, tahové hry fungují.';
    return;
  end if;
  begin
    execute 'drop policy if exists mp_broadcast_select on realtime.messages';
    execute 'drop policy if exists mp_broadcast_insert on realtime.messages';
    execute $p$create policy mp_broadcast_select on realtime.messages for select to authenticated
      using (realtime.messages.extension in ('broadcast', 'presence') and public.mp_topic_ok((select realtime.topic())))$p$;
    execute $p$create policy mp_broadcast_insert on realtime.messages for insert to authenticated
      with check (realtime.messages.extension in ('broadcast', 'presence') and public.mp_topic_ok((select realtime.topic())))$p$;
  exception when others then
    raise notice 'Pravidla Realtime kanálů se nepodařilo nastavit (%): hry v reálném čase se zatím nezapnou, tahové hry fungují.', sqlerrm;
  end;
end $$;
