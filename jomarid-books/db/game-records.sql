-- Herní rekordy a odznaky: hry hlásí své nejlepší výsledky (skóre, úroveň, počet výher...), server si nejvyšší hodnotu pamatuje u účtu,
-- odemyká herní odznaky a dává za ně XP. Rekordy se ukazují na stránce Odznaky (záložka Odznaky her) a v žebříčku her.
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát: tabulky se nemažou, seznamy statistik a odznaků níže se jen srovnají
-- (odznak, který ze seznamu zmizí, se i s odemčením smaže) a funkce se nahrazují.
-- Předpoklady, které v databázi už jsou: tabulka profiles (id, username, show_in_leaderboard).
--
-- Důvěra: hry běží v prohlížeči, takže hlášená hodnota jde podvrhnout (stejně jako uložený postup ve hře). Server proto přijme jen
-- známé statistiky, celá nezáporná čísla do věrohodné meze a nikdy hodnotu nesníží. Odznaky za hry dávají jen XP (ne mince), dohromady
-- 12080 XP: čím těžší odznak ve stejné statistice, tím víc XP. XP se přičítá k úrovni čtenáře, ale odznaky za úroveň (a s nimi mince)
-- se z něj nevyhodnocují. Seznam statistik a odznaků je i v appce (src/gameRecords/catalog.js);
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
  ('rocket', 'total_kills', 2000000000),
  ('rocket', 'total_boss_kills', 100000000),
  ('rocket', 'no_hit_bosses', 100000000),
  ('rocket', 'best_combo', 1000),
  ('rocket', 'bombs_used', 1000000000),
  ('rocket', 'total_coins_earned', 1000000000000),
  ('rocket', 'longest_run', 100000),
  ('rocket', 'blitz_clears', 100000000),
  ('rocket', 'maxed_upgrades', 8),
  ('warroom', 'best_sector', 10000),
  ('warroom', 'scenarios_unlocked', 100),
  ('cityclicker', 'prestige_count', 100000),
  ('cityclicker', 'total_clicks', 2000000000),
  ('polygonarena', 'best_level', 100),
  ('polygonarena', 'bosses_defeated', 1000000),
  ('polygonarena', 'wins', 1000000),
  ('polygonarena', 'best_tier', 5),
  ('polygonarena', 'boss_kinds', 12),
  ('polygonarena', 'classes_discovered', 540),
  ('polygonarena', 'best_wave', 1000),
  ('polygonarena', 'hill_wins', 1000000),
  ('polygonarena', 'royale_wins', 1000000),
  ('polygonarena', 'rush_wins', 1000000),
  ('polygonarena', 'hell_best_level', 100),
  ('polygonarena', 'modes_played', 8),
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
  ('rocket_ace', 'rocket', 'score_normal', 2500, 100),
  ('rocket_hell', 'rocket', 'score_inferno', 1500, 150),
  ('rocket_insane', 'rocket', 'score_insane', 1500, 250),
  ('rocket_nemesis', 'rocket', 'boss_level', 8, 150),
  ('rocket_glitch', 'rocket', 'boss_level', 14, 250),
  ('rocket_ascend', 'rocket', 'ascension', 1, 300),
  ('rocket_hard', 'rocket', 'score_hard', 2000, 120),
  ('rocket_blitz', 'rocket', 'score_blitz', 1500, 100),
  ('rocket_rush5', 'rocket', 'rush_streak', 5, 150),
  ('rocket_rush10', 'rocket', 'rush_streak', 10, 300),
  ('rocket_hunter300', 'rocket', 'total_kills', 300, 50),
  ('rocket_hunter1500', 'rocket', 'total_kills', 1500, 120),
  ('rocket_boss10', 'rocket', 'total_boss_kills', 10, 80),
  ('rocket_boss30', 'rocket', 'total_boss_kills', 30, 200),
  ('rocket_nohit', 'rocket', 'no_hit_bosses', 1, 150),
  ('rocket_combo8', 'rocket', 'best_combo', 8, 80),
  ('rocket_bombs20', 'rocket', 'bombs_used', 20, 40),
  ('rocket_coins5k', 'rocket', 'total_coins_earned', 5000, 40),
  ('rocket_coins50k', 'rocket', 'total_coins_earned', 50000, 120),
  ('rocket_run10', 'rocket', 'longest_run', 10, 100),
  ('rocket_run20', 'rocket', 'longest_run', 20, 250),
  ('rocket_blitzclear', 'rocket', 'blitz_clears', 1, 80),
  ('rocket_maxship', 'rocket', 'maxed_upgrades', 8, 300),
  ('chess_first', 'chess', 'wins_total', 1, 50),
  ('chess_25', 'chess', 'wins_total', 25, 120),
  ('chess_dragon', 'chess', 'expert_wins', 1, 250),
  ('chess_r1000', 'chess', 'rating_peak', 1000, 100),
  ('chess_r1300', 'chess', 'rating_peak', 1300, 200),
  ('chess_10', 'chess', 'wins_total', 10, 80),
  ('chess_bots3', 'chess', 'bots_unlocked', 3, 80),
  ('chess_bots5', 'chess', 'bots_unlocked', 5, 150),
  ('chess_expert5', 'chess', 'expert_wins', 5, 350),
  ('koulovi_3000', 'koulovikamosi', 'score_classic', 3000, 100),
  ('koulovi_big', 'koulovikamosi', 'balls_discovered', 8, 120),
  ('koulovi_all', 'koulovikamosi', 'balls_discovered', 12, 250),
  ('koulovi_10k', 'koulovikamosi', 'score_classic', 10000, 200),
  ('koulovi_time', 'koulovikamosi', 'score_time', 1000, 80),
  ('koulovi_drops', 'koulovikamosi', 'score_drops', 500, 80),
  ('koulovi_chaos', 'koulovikamosi', 'score_chaos', 1500, 120),
  ('polygon_lvl20', 'polygonarena', 'best_level', 20, 100),
  ('polygon_lvl58', 'polygonarena', 'best_level', 58, 300),
  ('polygon_boss', 'polygonarena', 'bosses_defeated', 1, 100),
  ('polygon_win', 'polygonarena', 'wins', 1, 100),
  ('polygon_boss5', 'polygonarena', 'bosses_defeated', 5, 150),
  ('polygon_bossall', 'polygonarena', 'boss_kinds', 12, 250),
  ('polygon_tier4', 'polygonarena', 'best_tier', 4, 150),
  ('polygon_tier5', 'polygonarena', 'best_tier', 5, 200),
  ('polygon_cdx40', 'polygonarena', 'classes_discovered', 40, 50),
  ('polygon_cdx150', 'polygonarena', 'classes_discovered', 150, 100),
  ('polygon_cdx400', 'polygonarena', 'classes_discovered', 400, 250),
  ('polygon_wave10', 'polygonarena', 'best_wave', 10, 100),
  ('polygon_hill', 'polygonarena', 'hill_wins', 1, 100),
  ('polygon_royale', 'polygonarena', 'royale_wins', 1, 120),
  ('polygon_rush', 'polygonarena', 'rush_wins', 1, 250),
  ('polygon_hell', 'polygonarena', 'hell_best_level', 25, 200),
  ('polygon_allmodes', 'polygonarena', 'modes_played', 8, 120),
  ('city_prestige', 'cityclicker', 'prestige_count', 1, 150),
  ('city_prestige5', 'cityclicker', 'prestige_count', 5, 250),
  ('city_clicks', 'cityclicker', 'total_clicks', 10000, 100),
  ('city_clicks1k', 'cityclicker', 'total_clicks', 1000, 30),
  ('city_prestige3', 'cityclicker', 'prestige_count', 3, 200),
  ('city_prestige10', 'cityclicker', 'prestige_count', 10, 400),
  ('city_clicks100k', 'cityclicker', 'total_clicks', 100000, 200),
  ('war_sector5', 'warroom', 'best_sector', 5, 100),
  ('war_sector10', 'warroom', 'best_sector', 10, 150),
  ('war_sector25', 'warroom', 'best_sector', 25, 300),
  ('war_scen4', 'warroom', 'scenarios_unlocked', 4, 250),
  ('war_scen12', 'warroom', 'scenarios_unlocked', 12, 500),
  ('war_scen24', 'warroom', 'scenarios_unlocked', 24, 800),
  ('war_sector15', 'warroom', 'best_sector', 15, 200)
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
