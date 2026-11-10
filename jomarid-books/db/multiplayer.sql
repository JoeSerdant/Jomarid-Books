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
--     na tah) a velikost zprávy; obsah tahu kontroluje hra u soupeře. Komu vyprší čas, prohrává (server to pozná sám při dotazu soupeře).
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
    when 'warroom/duel'       then jsonb_build_object('kind', 'turn',     'turn_seconds', 120, 'bank', 0,   'inc', 0, 'first_move', 90, 'reward', 35, 'min_moves', 8,  'min_seconds', 60,  'max_payload', 16000, 'max_moves', 900,  'team', false)
    when 'hannibal/duel'      then jsonb_build_object('kind', 'turn',     'turn_seconds', 150, 'bank', 0,   'inc', 0, 'first_move', 90, 'reward', 40, 'min_moves', 8,  'min_seconds', 90,  'max_payload', 16000, 'max_moves', 1500, 'team', false)
    when 'cityclicker/race'   then jsonb_build_object('kind', 'race',     'turn_seconds', 0,   'bank', 0,   'inc', 0, 'first_move', 0,  'reward', 40, 'min_moves', 0,  'min_seconds', 30,  'max_payload', 600,   'max_moves', 0,    'team', false, 'target', 10000000000)
    when 'rocket/coop'        then jsonb_build_object('kind', 'realtime', 'turn_seconds', 0,   'bank', 0,   'inc', 0, 'first_move', 0,  'reward', 25, 'min_moves', 0,  'min_seconds', 60,  'max_payload', 600,   'max_moves', 0,    'team', true)
    when 'rocket/pvp'         then jsonb_build_object('kind', 'realtime', 'turn_seconds', 0,   'bank', 0,   'inc', 0, 'first_move', 0,  'reward', 35, 'min_moves', 0,  'min_seconds', 30,  'max_payload', 600,   'max_moves', 0,    'team', false)
    else null
  end
$$;

-- Zkontroluje a očistí nastavení zápasu (p_params): šachy tc (3+2, 5+3, 10+5), City Clicker goal (quick, standard, long), Hannibal preset (small, medium, large, budget).
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
  elsif p_game = 'cityclicker' then
    v := coalesce(p_params ->> 'goal', 'standard');
    if v not in ('quick', 'standard', 'long') then raise exception 'invalid_params'; end if;
    return jsonb_build_object('goal', v);
  elsif p_game = 'hannibal' then
    v := coalesce(p_params ->> 'preset', 'medium');
    if v not in ('small', 'medium', 'large', 'budget') then raise exception 'invalid_params'; end if;
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
  elsif p_game = 'cityclicker' then
    v := v || case p_params ->> 'goal' when 'quick' then '{"target":1000000000,"min_seconds":18}'::jsonb when 'long' then '{"target":100000000000,"min_seconds":60}'::jsonb else '{"target":10000000000,"min_seconds":30}'::jsonb end;
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

-- Klienti do tabulek nesahají vůbec: čtou a zapisují jen přes funkce níže.
alter table public.mp_queue enable row level security;
alter table public.mp_matches enable row level security;
alter table public.mp_moves enable row level security;
alter table public.mp_rooms enable row level security;
alter table public.mp_arena_log enable row level security;
revoke all on public.mp_queue, public.mp_matches, public.mp_moves, public.mp_rooms, public.mp_arena_log from public, anon, authenticated;

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
    'prog', jsonb_build_array(m.prog1, m.prog2)
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

-- Komu vypršel čas, prohrává. Volá se při dotazu na stav zápasu (kdokoli ze dvou hráčů ho spustí).
create or replace function public.mp_expire(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  m public.mp_matches%rowtype;
  v_lim jsonb := public.mp_limits();
begin
  select * into m from public.mp_matches where id = p_match for update;
  if not found or m.status <> 'active' or m.deadline is null or m.turn is null then return; end if;
  if clock_timestamp() <= m.deadline + make_interval(secs => (v_lim ->> 'late_grace')::int) then return; end if;
  perform public.mp_finalize(m.id, (3 - m.turn)::smallint, 'timeout');
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
  insert into public.mp_matches (game_id, mode, params, rules, seed, p1, p2, turn, turn_started, deadline, bank1, bank2)
    values (p_game, p_mode, p_params, v_rules, floor(random() * 4294967296)::bigint, p_first, p_second,
            case when v_turn then 1 else null end, case when v_turn then now() else null end,
            case when v_turn then now() + make_interval(secs => v_first_secs) else null end,
            coalesce((v_rules ->> 'bank')::int, 0), coalesce((v_rules ->> 'bank')::int, 0))
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
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  m := public.mp_load(p_match, v_uid);
  v_slot := case when m.p1 = v_uid then 1 else 2 end;
  if (m.rules ->> 'kind') <> 'turn' then raise exception 'not_turn_based'; end if;
  if p_payload is null or jsonb_typeof(p_payload) not in ('object', 'array', 'string', 'number') then raise exception 'invalid_payload'; end if;
  if octet_length(p_payload::text) > (m.rules ->> 'max_payload')::int then raise exception 'too_large'; end if;
  if p_seq is null or p_seq < 1 then raise exception 'bad_seq'; end if;

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
      perform public.mp_finalize(m.id, (3 - v_slot)::smallint, 'timeout');
      select * into m from public.mp_matches where id = p_match;
      return jsonb_build_object('ok', false, 'error', 'timeout', 'match', public.mp_match_json(m, v_uid));
    end if;
    v_mine := v_mine - v_spent + (case when v_end then v_inc else 0 end);
  elsif clock_timestamp() > m.deadline + make_interval(secs => (v_lim ->> 'late_grace')::int) then
    perform public.mp_finalize(m.id, (3 - v_slot)::smallint, 'timeout');
    select * into m from public.mp_matches where id = p_match;
    return jsonb_build_object('ok', false, 'error', 'timeout', 'match', public.mp_match_json(m, v_uid));
  end if;

  insert into public.mp_moves (match_id, seq, player, payload, end_turn) values (m.id, p_seq, v_slot, p_payload, v_end);
  if v_end then
    v_deadline := now() + make_interval(secs => case when v_bank > 0 then v_other else (m.rules ->> 'turn_seconds')::int end);
    update public.mp_matches set
        move_count = p_seq, turn = (3 - v_slot)::smallint, turn_started = clock_timestamp(), deadline = v_deadline,
        bank1 = case when v_slot = 1 and v_bank > 0 then v_mine else bank1 end,
        bank2 = case when v_slot = 2 and v_bank > 0 then v_mine else bank2 end,
        seen1 = case when v_slot = 1 then clock_timestamp() else seen1 end,
        seen2 = case when v_slot = 2 then clock_timestamp() else seen2 end
      where id = m.id returning * into m;
  else
    -- hráč zůstává na tahu: hodiny běží dál, jen se posune číslo tahu
    update public.mp_matches set move_count = p_seq,
        seen1 = case when v_slot = 1 then clock_timestamp() else seen1 end,
        seen2 = case when v_slot = 2 then clock_timestamp() else seen2 end
      where id = m.id returning * into m;
  end if;
  return jsonb_build_object('ok', true, 'seq', p_seq, 'turn', m.turn, 'deadline', (extract(epoch from m.deadline) * 1000)::bigint, 'bank', jsonb_build_array(m.bank1, m.bank2));
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
  if m.status = 'active' then
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
