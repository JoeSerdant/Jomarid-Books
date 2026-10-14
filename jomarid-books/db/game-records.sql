-- Herní rekordy a odznaky: hry hlásí své nejlepší výsledky (skóre, úroveň, počet výher...), server si nejvyšší hodnotu pamatuje u účtu,
-- odemyká herní odznaky a dává za ně XP. Rekordy se ukazují ve Statistikách (záložka Hry) a v žebříčku her.
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát: tabulky se nemažou, seznamy statistik a odznaků níže se jen srovnají
-- (odznak, který ze seznamu zmizí, se i s odemčením smaže) a funkce se nahrazují.
-- Předpoklady, které v databázi už jsou: tabulka profiles (id, username, show_in_leaderboard).
--
-- Důvěra: hry běží v prohlížeči, takže hlášená hodnota jde podvrhnout (stejně jako uložený postup ve hře). Server proto přijme jen
-- známé statistiky, celá nezáporná čísla do věrohodné meze a nikdy hodnotu nesníží. Odznaky za hry dávají jen XP (ne mince) a dohromady
-- málo (375 XP), takže na úrovni čtenáře skoro nic nezmění. Seznam statistik a odznaků je i v appce (src/gameRecords/catalog.js);
-- test src/tests/gameRecords.test.mjs hlídá, že si odpovídají.

-- ---------- Tabulky ----------
-- Věrohodná horní mez každé statistiky; podle ní server pozná, co je zjevně podvrh.
create table if not exists public.game_stat_limits (
  game_id text not null,
  stat_key text not null,
  max_value bigint not null check (max_value > 0),
  primary key (game_id, stat_key)
);

create table if not exists public.game_badge_defs (
  badge_id text primary key,
  game_id text not null,
  stat_key text not null,
  threshold bigint not null check (threshold > 0),
  xp int not null check (xp >= 0),
  foreign key (game_id, stat_key) references public.game_stat_limits (game_id, stat_key)
);

-- Nejvyšší hlášená hodnota každé statistiky u každého účtu.
create table if not exists public.game_records (
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id text not null,
  stat_key text not null,
  value bigint not null check (value >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id, stat_key),
  foreign key (game_id, stat_key) references public.game_stat_limits (game_id, stat_key)
);

create table if not exists public.game_badge_unlocks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_id text not null references public.game_badge_defs (badge_id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- Žebříček řadí podle hodnoty v rámci statistiky.
create index if not exists game_records_leaderboard on public.game_records (game_id, stat_key, value desc, updated_at);

-- Klienti do tabulek nesahají vůbec: čtou a zapisují jen přes funkce níže.
alter table public.game_stat_limits enable row level security;
alter table public.game_badge_defs enable row level security;
alter table public.game_records enable row level security;
alter table public.game_badge_unlocks enable row level security;
revoke all on public.game_stat_limits, public.game_badge_defs, public.game_records, public.game_badge_unlocks from public, anon, authenticated;

-- ---------- Seznam statistik a odznaků ----------
insert into public.game_stat_limits (game_id, stat_key, max_value) values
  ('rocket', 'score_normal', 100000000),
  ('rocket', 'score_hard', 100000000),
  ('rocket', 'score_inferno', 100000000),
  ('rocket', 'score_insane', 100000000),
  ('rocket', 'score_blitz', 100000000),
  ('rocket', 'rush_streak', 10000),
  ('rocket', 'boss_level', 1000),
  ('rocket', 'ascension', 10000),
  ('warroom', 'best_sector', 10000),
  ('warroom', 'scenarios_unlocked', 100),
  ('cityclicker', 'prestige_count', 100000),
  ('cityclicker', 'total_clicks', 2000000000),
  ('polygonarena', 'best_level', 100),
  ('polygonarena', 'bosses_defeated', 1000000),
  ('polygonarena', 'wins', 1000000),
  ('chess', 'rating_peak', 4000),
  ('chess', 'wins_total', 1000000),
  ('chess', 'expert_wins', 1000000),
  ('chess', 'bots_unlocked', 5),
  ('koulovikamosi', 'score_classic', 50000000),
  ('koulovikamosi', 'score_time', 50000000),
  ('koulovikamosi', 'score_drops', 50000000),
  ('koulovikamosi', 'score_chaos', 50000000),
  ('koulovikamosi', 'balls_discovered', 12)
on conflict (game_id, stat_key) do update set max_value = excluded.max_value;

with seed (badge_id, game_id, stat_key, threshold, xp) as (values
  ('rocket_ace', 'rocket', 'score_normal', 2500, 10),
  ('rocket_hell', 'rocket', 'score_inferno', 1500, 15),
  ('rocket_insane', 'rocket', 'score_insane', 1500, 25),
  ('rocket_nemesis', 'rocket', 'boss_level', 8, 15),
  ('rocket_glitch', 'rocket', 'boss_level', 14, 25),
  ('rocket_ascend', 'rocket', 'ascension', 1, 10),
  ('chess_first', 'chess', 'wins_total', 1, 5),
  ('chess_25', 'chess', 'wins_total', 25, 10),
  ('chess_dragon', 'chess', 'expert_wins', 1, 25),
  ('chess_r1000', 'chess', 'rating_peak', 1000, 10),
  ('chess_r1300', 'chess', 'rating_peak', 1300, 20),
  ('koulovi_3000', 'koulovikamosi', 'score_classic', 3000, 10),
  ('koulovi_big', 'koulovikamosi', 'balls_discovered', 8, 10),
  ('koulovi_all', 'koulovikamosi', 'balls_discovered', 12, 25),
  ('polygon_lvl20', 'polygonarena', 'best_level', 20, 10),
  ('polygon_lvl58', 'polygonarena', 'best_level', 58, 30),
  ('polygon_boss', 'polygonarena', 'bosses_defeated', 1, 10),
  ('polygon_win', 'polygonarena', 'wins', 1, 10),
  ('city_prestige', 'cityclicker', 'prestige_count', 1, 15),
  ('city_prestige5', 'cityclicker', 'prestige_count', 5, 25),
  ('city_clicks', 'cityclicker', 'total_clicks', 10000, 10),
  ('war_sector5', 'warroom', 'best_sector', 5, 10),
  ('war_sector10', 'warroom', 'best_sector', 10, 15),
  ('war_sector25', 'warroom', 'best_sector', 25, 25)
), upserted as (
  insert into public.game_badge_defs (badge_id, game_id, stat_key, threshold, xp)
  select badge_id, game_id, stat_key, threshold, xp from seed
  on conflict (badge_id) do update set game_id = excluded.game_id, stat_key = excluded.stat_key, threshold = excluded.threshold, xp = excluded.xp
  returning badge_id
)
delete from public.game_badge_defs d where not exists (select 1 from seed s where s.badge_id = d.badge_id);

-- ---------- Hra hlásí výsledek ----------
-- Zapíše nejvyšší hodnotu statistiky (nižší nebo stejná nic nemění) a odemkne odznaky, které tím vznikly. Vrací
-- {ok, value, improved, unlocked: [id...], xp}; hodnota nad věrohodnou mezí vrací {ok: false, reason: 'implausible'}.
create or replace function public.report_game_record(p_game_id text, p_stat_key text, p_value bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_max bigint;
  v_old bigint;
  v_new bigint;
  v_unlocked text[] := '{}';
  v_xp int := 0;
  r record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select max_value into v_max from public.game_stat_limits where game_id = p_game_id and stat_key = p_stat_key;
  if not found then raise exception 'unknown_stat'; end if;
  if p_value is null or p_value < 0 then raise exception 'invalid_value'; end if;
  if p_value > v_max then return jsonb_build_object('ok', false, 'reason', 'implausible'); end if;

  select value into v_old from public.game_records where user_id = v_uid and game_id = p_game_id and stat_key = p_stat_key;
  insert into public.game_records (user_id, game_id, stat_key, value) values (v_uid, p_game_id, p_stat_key, p_value)
  on conflict (user_id, game_id, stat_key) do update
    set value = greatest(public.game_records.value, excluded.value),
        updated_at = case when excluded.value > public.game_records.value then now() else public.game_records.updated_at end
  returning value into v_new;

  for r in
    select d.badge_id, d.xp from public.game_badge_defs d
    where d.game_id = p_game_id and d.stat_key = p_stat_key and d.threshold <= v_new
    order by d.threshold
  loop
    insert into public.game_badge_unlocks (user_id, badge_id) values (v_uid, r.badge_id) on conflict do nothing;
    if found then v_unlocked := v_unlocked || r.badge_id; v_xp := v_xp + r.xp; end if;
  end loop;

  return jsonb_build_object('ok', true, 'value', v_new, 'improved', v_old is null or p_value > v_old, 'unlocked', to_jsonb(v_unlocked), 'xp', v_xp);
end $$;

-- ---------- Čtenář ----------
-- Vlastní rekordy, odemčené odznaky a z nich plynoucí XP jedním dotazem: {records: {hra: {statistika: hodnota}}, unlocked: [id...], xp}.
create or replace function public.my_game_progress()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object(
    'records', coalesce((select jsonb_object_agg(s.game_id, s.stats) from (
        select game_id, jsonb_object_agg(stat_key, value) as stats from public.game_records where user_id = v_uid group by game_id) s), '{}'::jsonb),
    'unlocked', coalesce((select jsonb_agg(badge_id order by unlocked_at, badge_id) from public.game_badge_unlocks where user_id = v_uid), '[]'::jsonb),
    'xp', coalesce((select sum(d.xp) from public.game_badge_unlocks u join public.game_badge_defs d on d.badge_id = u.badge_id where u.user_id = v_uid), 0));
end $$;

-- XP z herních odznaků všech, kdo smějí být v žebříčku (profiles.show_in_leaderboard, výchozí je ano); appka je přičte k XP v žebříčku.
create or replace function public.game_xp_totals()
returns table (user_id uuid, xp int) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select u.user_id, sum(d.xp)::int
    from public.game_badge_unlocks u
    join public.game_badge_defs d on d.badge_id = u.badge_id
    join public.profiles p on p.id = u.user_id
    where coalesce(p.show_in_leaderboard, true)
    group by u.user_id;
end $$;

-- Nejlepší hráči jedné statistiky (jen ti, kdo smějí být v žebříčku). Při stejné hodnotě je výš ten, kdo jí dosáhl dřív.
create or replace function public.game_leaderboard(p_game_id text, p_stat_key text, p_limit int default 10)
returns table (user_id uuid, username text, value bigint) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.game_stat_limits where game_id = p_game_id and stat_key = p_stat_key) then raise exception 'unknown_stat'; end if;
  return query
    select r.user_id, nullif(btrim(coalesce(p.username, '')), ''), r.value
    from public.game_records r
    join public.profiles p on p.id = r.user_id
    where r.game_id = p_game_id and r.stat_key = p_stat_key and r.value > 0 and coalesce(p.show_in_leaderboard, true)
    order by r.value desc, r.updated_at asc, r.user_id
    limit greatest(1, least(coalesce(p_limit, 10), 50));
end $$;

-- ---------- Oprávnění ----------
revoke all on function public.report_game_record(text, text, bigint) from public, anon;
revoke all on function public.my_game_progress() from public, anon;
revoke all on function public.game_xp_totals() from public, anon;
revoke all on function public.game_leaderboard(text, text, int) from public, anon;
grant execute on function public.report_game_record(text, text, bigint) to authenticated;
grant execute on function public.my_game_progress() to authenticated;
grant execute on function public.game_xp_totals() to authenticated;
grant execute on function public.game_leaderboard(text, text, int) to authenticated;
