-- shortB: krátké knihy (nejvýš 6 000 znaků) ve feedu přizpůsobeném čtenáři. Nakladatel nebo správce shortB napíše, čtenář je prochází
-- (do strany po stránkách textu, dolů na další) a server si pamatuje, co dočetl, olajkoval nebo přeskočil. Podle toho appka skládá feed
-- (žánry, autoři, série). Žádný denní limit.
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát: tabulky se nemažou, funkce se nahrazují.
-- Předpoklady, které v databázi už jsou: tabulka profiles (id, role, username, pen_name). Role 'nakladatel' a 'správce' smějí psát.
--
-- Klienti do tabulek nesahají vůbec: čtou a zapisují jen přes funkce níž. Text shortB je v tabulce přímo (ne ve Storage jako u knih), protože
-- je krátký, zdarma pro každého přihlášeného a feed ho potřebuje načítat po dávkách. Skrytý shortB vidí jen autor a správce.
-- Hodnoty, které appka hlídá taky (src/shorts/shortsModel.js): 6 000 znaků textu, 120 znaků názvu, 8 žánrů po 40 znacích, název série 80 znaků.

-- ---------- Tabulky ----------
create table if not exists public.shorts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 6000),
  genres text[] not null default '{}' check (cardinality(genres) <= 8),
  series_name text check (series_name is null or char_length(btrim(series_name)) between 1 and 80),
  series_part int check (series_part is null or series_part between 1 and 1000),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((series_name is null) = (series_part is null))
);

-- Co čtenář s kterým shortB udělal: kolik stránek viděl, jestli ho dočetl, olajkoval a jak dlouho u něj byl. Podle toho se skládá feed.
create table if not exists public.short_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  short_id uuid not null references public.shorts (id) on delete cascade,
  pages_seen int not null default 0 check (pages_seen >= 0),
  pages_total int not null default 1 check (pages_total between 1 and 100),
  finished boolean not null default false,
  liked boolean not null default false,
  dwell_ms bigint not null default 0 check (dwell_ms >= 0),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, short_id)
);

create index if not exists shorts_visible_new on public.shorts (created_at desc) where not is_hidden;
create index if not exists shorts_author on public.shorts (author_id, created_at desc);
create index if not exists short_progress_short on public.short_progress (short_id);
create index if not exists short_progress_user_recent on public.short_progress (user_id, updated_at desc);

alter table public.shorts enable row level security;
alter table public.short_progress enable row level security;
revoke all on public.shorts, public.short_progress from public, anon, authenticated;

-- ---------- Pomocné funkce ----------
-- Vrátí id přihlášeného. Nepřihlášený: 'not_authenticated'.
create or replace function public.short_uid() returns uuid language plpgsql stable security definer set search_path to 'public' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_authenticated'; end if;
  return v;
end $$;

-- Může přihlášený psát shortB (nakladatel nebo správce)? Jinak 'forbidden'.
create or replace function public.short_require_writer() returns uuid language plpgsql stable security definer set search_path to 'public' as $$
declare v uuid := public.short_uid();
begin
  if coalesce((select role from public.profiles where id = v), '') not in ('nakladatel', 'správce') then raise exception 'forbidden'; end if;
  return v;
end $$;

create or replace function public.short_is_admin(p_uid uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select role from public.profiles where id = p_uid), '') = 'správce' $$;

-- Žánry jako v appce (cleanGenres): jen neprázdné, bez zdvojených mezer, nejvýš 40 znaků, bez dvojic lišících se jen velikostí písmen, nejvýš 8.
create or replace function public.short_clean_genres(p text[]) returns text[] language plpgsql immutable as $$
declare g text; n text; out text[] := '{}'; seen text[] := '{}';
begin
  foreach g in array coalesce(p, '{}') loop
    n := btrim(left(btrim(regexp_replace(coalesce(g, ''), '\s+', ' ', 'g')), 40));
    if n = '' or lower(n) = any (seen) then continue; end if;
    seen := seen || lower(n);
    out := out || n;
    exit when cardinality(out) >= 8;
  end loop;
  return out;
end $$;

-- ---------- Nakladatel ----------
-- Vytvoří (p_id je null) nebo upraví shortB; vrací jeho id. Upravit smí jen autor nebo správce.
create or replace function public.short_save(p_id uuid, p_title text, p_body text, p_genres text[], p_series_name text, p_series_part int, p_hidden boolean default false)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := public.short_require_writer();
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := coalesce(p_body, '');
  v_series text := nullif(btrim(coalesce(p_series_name, '')), '');
  v_id uuid;
begin
  if v_title = '' or char_length(v_title) > 120 then raise exception 'invalid_title'; end if;
  if btrim(v_body) = '' then raise exception 'invalid_body'; end if;
  if char_length(v_body) > 6000 then raise exception 'body_too_long'; end if;
  if v_series is not null and (char_length(v_series) > 80 or p_series_part is null or p_series_part < 1 or p_series_part > 1000) then raise exception 'invalid_series'; end if;
  if v_series is null then p_series_part := null; end if;

  if p_id is null then
    insert into public.shorts (author_id, title, body, genres, series_name, series_part, is_hidden)
    values (v_uid, v_title, v_body, public.short_clean_genres(p_genres), v_series, p_series_part, coalesce(p_hidden, false))
    returning id into v_id;
  else
    update public.shorts s set title = v_title, body = v_body, genres = public.short_clean_genres(p_genres), series_name = v_series, series_part = p_series_part,
      is_hidden = coalesce(p_hidden, s.is_hidden), updated_at = now()
    where s.id = p_id and (s.author_id = v_uid or public.short_is_admin(v_uid))
    returning s.id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

-- Skrýt nebo zase zveřejnit (autor nebo správce).
create or replace function public.short_set_hidden(p_id uuid, p_hidden boolean) returns void language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.short_require_writer();
begin
  update public.shorts s set is_hidden = coalesce(p_hidden, false), updated_at = now() where s.id = p_id and (s.author_id = v_uid or public.short_is_admin(v_uid));
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.short_delete(p_id uuid) returns void language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.short_require_writer();
begin
  delete from public.shorts s where s.id = p_id and (s.author_id = v_uid or public.short_is_admin(v_uid));
  if not found then raise exception 'not_found'; end if;
end $$;

-- Moje shortB (správce s p_all vidí všechny) s počty čtenářů, dočtení a lajků.
create or replace function public.my_shorts(p_all boolean default false)
returns table (id uuid, author_id uuid, author_name text, title text, body text, genres text[], series_name text, series_part int, is_hidden boolean, created_at timestamptz, updated_at timestamptz,
  readers bigint, finished bigint, likes bigint)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.short_require_writer();
begin
  return query
    select s.id, s.author_id, coalesce(nullif(btrim(p.pen_name), ''), nullif(btrim(p.username), ''), 'Neznámý'), s.title, s.body, s.genres, s.series_name, s.series_part, s.is_hidden, s.created_at, s.updated_at,
      coalesce(a.readers, 0), coalesce(a.finished, 0), coalesce(a.likes, 0)
    from public.shorts s
    join public.profiles p on p.id = s.author_id
    left join (select sp.short_id, count(*) as readers, count(*) filter (where sp.finished) as finished, count(*) filter (where sp.liked) as likes from public.short_progress sp group by sp.short_id) a on a.short_id = s.id
    where (s.author_id = v_uid) or (p_all and public.short_is_admin(v_uid))
    order by s.created_at desc
    limit 500;
end $$;

-- ---------- Čtenář ----------
-- Nabídka pro feed: nejnovější viditelné shortB (bez textu) s mým postupem a počty. Pořadí a přizpůsobení dělá appka (src/shorts/shortsRanking.js).
create or replace function public.shorts_candidates(p_limit int default 150)
returns table (id uuid, author_id uuid, author_name text, title text, genres text[], series_name text, series_part int, created_at timestamptz, chars int,
  likes bigint, readers bigint, finished_by bigint, my_pages_seen int, my_finished boolean, my_liked boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.short_uid();
begin
  return query
    select s.id, s.author_id, coalesce(nullif(btrim(p.pen_name), ''), nullif(btrim(p.username), ''), 'Neznámý'), s.title, s.genres, s.series_name, s.series_part, s.created_at, char_length(s.body),
      coalesce(a.likes, 0), coalesce(a.readers, 0), coalesce(a.finished, 0),
      coalesce(me.pages_seen, 0), coalesce(me.finished, false), coalesce(me.liked, false)
    from public.shorts s
    join public.profiles p on p.id = s.author_id
    left join (select sp.short_id, count(*) as readers, count(*) filter (where sp.finished) as finished, count(*) filter (where sp.liked) as likes from public.short_progress sp group by sp.short_id) a on a.short_id = s.id
    left join public.short_progress me on me.short_id = s.id and me.user_id = v_uid
    where not s.is_hidden
    order by s.created_at desc
    limit least(greatest(coalesce(p_limit, 150), 1), 300);
end $$;

-- Texty vybraných shortB (nejvýš 20 najednou, jen viditelné; autor a správce vidí i své skryté).
create or replace function public.shorts_get(p_ids uuid[])
returns table (id uuid, author_id uuid, author_name text, title text, body text, genres text[], series_name text, series_part int, created_at timestamptz,
  likes bigint, my_pages_seen int, my_finished boolean, my_liked boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.short_uid();
begin
  return query
    select s.id, s.author_id, coalesce(nullif(btrim(p.pen_name), ''), nullif(btrim(p.username), ''), 'Neznámý'), s.title, s.body, s.genres, s.series_name, s.series_part, s.created_at,
      (select count(*) from public.short_progress sp where sp.short_id = s.id and sp.liked),
      coalesce(me.pages_seen, 0), coalesce(me.finished, false), coalesce(me.liked, false)
    from public.shorts s
    join public.profiles p on p.id = s.author_id
    left join public.short_progress me on me.short_id = s.id and me.user_id = v_uid
    where s.id = any ((coalesce(p_ids, '{}'::uuid[]))[1:20])
      and (not s.is_hidden or s.author_id = v_uid or public.short_is_admin(v_uid));
end $$;

-- Hlášení čtení jednoho shortB: nejvyšší vidění stránka, dočteno, lajk (null = beze změny) a čas strávený u něj (přičte se, jedno hlášení nejvýš 10 minut).
-- Vrací {ok, finished, liked, newly_finished}; newly_finished je true jen při prvním dočtení.
create or replace function public.short_report(p_short_id uuid, p_pages_seen int, p_pages_total int, p_dwell_ms bigint default 0, p_finished boolean default false, p_liked boolean default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := public.short_uid();
  v_total int := least(greatest(coalesce(p_pages_total, 1), 1), 100);
  v_seen int := least(greatest(coalesce(p_pages_seen, 0), 0), v_total);
  v_old public.short_progress;
  v_new public.short_progress;
begin
  if not exists (select 1 from public.shorts s where s.id = p_short_id and (not s.is_hidden or s.author_id = v_uid or public.short_is_admin(v_uid))) then raise exception 'not_found'; end if;
  select * into v_old from public.short_progress where user_id = v_uid and short_id = p_short_id;

  insert into public.short_progress (user_id, short_id, pages_seen, pages_total, finished, liked, dwell_ms)
  values (v_uid, p_short_id, v_seen, v_total, coalesce(p_finished, false), coalesce(p_liked, false), least(greatest(coalesce(p_dwell_ms, 0), 0), 600000))
  on conflict (user_id, short_id) do update
    set pages_seen = greatest(public.short_progress.pages_seen, excluded.pages_seen),
        pages_total = excluded.pages_total,
        finished = public.short_progress.finished or excluded.finished,
        liked = case when p_liked is null then public.short_progress.liked else p_liked end,
        dwell_ms = public.short_progress.dwell_ms + excluded.dwell_ms,
        updated_at = now()
  returning * into v_new;

  return jsonb_build_object('ok', true, 'finished', v_new.finished, 'liked', v_new.liked, 'newly_finished', v_new.finished and not coalesce(v_old.finished, false));
end $$;

-- Co jsem v poslední době dělal (až 300 shortB): z toho appka vyčte, jaké žánry, autory a série mám rád. Skryté a smazané shortB se nepočítají.
create or replace function public.my_short_signals()
returns table (short_id uuid, author_id uuid, genres text[], series_name text, series_part int, pages_seen int, pages_total int, finished boolean, liked boolean, dwell_ms bigint, updated_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.short_uid();
begin
  return query
    select sp.short_id, s.author_id, s.genres, s.series_name, s.series_part, sp.pages_seen, sp.pages_total, sp.finished, sp.liked, sp.dwell_ms, sp.updated_at
    from public.short_progress sp
    join public.shorts s on s.id = sp.short_id and not s.is_hidden
    where sp.user_id = v_uid
    order by sp.updated_at desc
    limit 300;
end $$;

-- ---------- Oprávnění ----------
revoke all on function public.short_uid() from public, anon, authenticated;
revoke all on function public.short_require_writer() from public, anon, authenticated;
revoke all on function public.short_is_admin(uuid) from public, anon, authenticated;
revoke all on function public.short_clean_genres(text[]) from public, anon, authenticated;
revoke all on function public.short_save(uuid, text, text, text[], text, int, boolean) from public, anon;
revoke all on function public.short_set_hidden(uuid, boolean) from public, anon;
revoke all on function public.short_delete(uuid) from public, anon;
revoke all on function public.my_shorts(boolean) from public, anon;
revoke all on function public.shorts_candidates(int) from public, anon;
revoke all on function public.shorts_get(uuid[]) from public, anon;
revoke all on function public.short_report(uuid, int, int, bigint, boolean, boolean) from public, anon;
revoke all on function public.my_short_signals() from public, anon;
grant execute on function public.short_save(uuid, text, text, text[], text, int, boolean) to authenticated;
grant execute on function public.short_set_hidden(uuid, boolean) to authenticated;
grant execute on function public.short_delete(uuid) to authenticated;
grant execute on function public.my_shorts(boolean) to authenticated;
grant execute on function public.shorts_candidates(int) to authenticated;
grant execute on function public.shorts_get(uuid[]) to authenticated;
grant execute on function public.short_report(uuid, int, int, bigint, boolean, boolean) to authenticated;
grant execute on function public.my_short_signals() to authenticated;
