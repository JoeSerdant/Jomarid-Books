-- Oznámení do telefonu (Web Push): tabulka zařízení, funkce a spouštěče, které při každém novém oznámení zavolají Edge Function.
-- Spouští se ručně v Supabase -> SQL Editor. Je idempotentní (jde pustit víckrát). Postup celého nastavení: db/push/README.md.
-- Pozor: složka se záměrně nejmenuje "supabase/", ať ji integrace s GitHubem sama nespouští na produkci.

-- 0) HTTP volání z databáze (pg_net)
create extension if not exists pg_net with schema extensions;

-- 1) Zařízení, která chtějí oznámení (jedno zařízení = jeden endpoint). Zapisuje se jen přes funkce níž.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated using (auth.uid() = user_id);
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;

-- 2) Soukromé nastavení odesílání (adresa funkce a sdílené heslo). RLS bez pravidel + žádná práva = čte jen databáze samotná.
create table if not exists public.push_settings (
  id int primary key default 1 check (id = 1),
  function_url text,
  secret text
);
alter table public.push_settings enable row level security;
revoke all on public.push_settings from anon, authenticated;

-- Nastavení čtenáře: chce i připomínky a motivaci (série, cíle, novinky)? Bez řádku platí „ano“. Mění se jen přes funkce níž.
create table if not exists public.push_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  engage boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.push_prefs enable row level security;
revoke all on public.push_prefs from anon, authenticated;

-- Deník motivačních oznámení: nejvýš jedno za den na čtenáře a odstupy mezi stejnými druhy.
create table if not exists public.push_engage_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kind text not null,
  meta text,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists push_engage_log_kind_idx on public.push_engage_log (user_id, kind, created_at desc);
alter table public.push_engage_log enable row level security;
revoke all on public.push_engage_log from anon, authenticated;

-- Nově zveřejněné knihy čekající na oznámení. Oznámí se až v plánovači (16-19 h, nejvýš jedno oznámení denně na čtenáře), ne ihned.
create table if not exists public.push_new_books (
  book_id uuid primary key,
  title text,
  author text,
  author_id uuid,
  announced_at timestamptz not null default now()
);
alter table public.push_new_books enable row level security;
revoke all on public.push_new_books from anon, authenticated;

-- 3) Přihlášení a odhlášení zařízení (security definer: zařízení sdílené dvěma účty se přepíše na toho, kdo se právě přihlásil)
-- Adresa zařízení smí vést jen na skutečnou push službu prohlížeče (Chrome/FCM, Firefox, Safari, Edge/Windows). Jinak by si přihlášený čtenář
-- mohl zaregistrovat libovolnou adresu a server by na ni posílal požadavky. Stejné pravidlo kontroluje i Edge Function před odesláním.
create or replace function public.push_endpoint_ok(p_endpoint text) returns boolean language sql immutable as $$
  select coalesce(
    p_endpoint ~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(:443)?/'
    and length(p_endpoint) <= 2000, false)
$$;
delete from public.push_subscriptions where not public.push_endpoint_ok(endpoint);

create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.push_endpoint_ok(p_endpoint) then raise exception 'bad_endpoint'; end if;
  if coalesce(length(p_p256dh), 0) not between 20 and 200 or coalesce(length(p_auth), 0) not between 8 and 100 then raise exception 'bad_keys'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, created_at = now();
  -- nejvýš 10 zařízení na účet: nejstarší se smažou
  delete from public.push_subscriptions s
   where s.user_id = auth.uid()
     and s.id in (select id from public.push_subscriptions where user_id = auth.uid() order by created_at desc offset 10);
end $$;

create or replace function public.unregister_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

revoke execute on function public.register_push_subscription(text, text, text, text), public.unregister_push_subscription(text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text), public.unregister_push_subscription(text) to authenticated;

-- 4) Odeslání: zavolá Edge Function. Nenastavené odesílání nebo chyba sítě nikdy nesmí rozbít zápis oznámení.
-- Buď hotový titulek a text (oznámení z appky), nebo druh a data (motivační oznámení: texty skládá funkce podle druhu).
drop function if exists public.push_dispatch(text, uuid, text, text, text, text);
drop function if exists public.push_dispatch(text, uuid, text, text, text, text, text, jsonb, uuid);
create or replace function public.push_dispatch(p_audience text, p_user uuid, p_title text, p_body text, p_url text, p_tag text,
                                                p_kind text default null, p_data jsonb default null)
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare cfg record;
begin
  select function_url, secret into cfg from public.push_settings where id = 1;
  if cfg.function_url is null or cfg.secret is null then return; end if;
  perform net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret),
    body := jsonb_build_object('audience', p_audience, 'user_id', p_user, 'title', left(coalesce(p_title, ''), 120),
                               'body', left(coalesce(p_body, ''), 200), 'url', p_url, 'tag', p_tag,
                               'kind', p_kind, 'data', coalesce(p_data, '{}'::jsonb))
  );
exception when others then
  null;
end $$;
revoke execute on function public.push_dispatch(text, uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;

-- 5) Spouštěče: nové oznámení čtenáři (Nastavení -> Oznámení) a nová žádost pro správce (Správa -> Upozornění)
create or replace function public.trg_push_user_notification() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.push_dispatch('user', new.user_id, new.title, new.body, '/settings/notifications', 'n-' || new.id::text);
  return new;
end $$;
drop trigger if exists trg_push_user_notification on public.user_notifications;
create trigger trg_push_user_notification after insert on public.user_notifications
  for each row execute function public.trg_push_user_notification();

create or replace function public.trg_push_admin_notification() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'open' then
    perform public.push_dispatch('admins', null, new.title, new.body, '/admin', 'a-' || new.id::text);
  end if;
  return new;
end $$;
drop trigger if exists trg_push_admin_notification on public.admin_notifications;
create trigger trg_push_admin_notification after insert on public.admin_notifications
  for each row execute function public.trg_push_admin_notification();

-- 6) Novinky v knihovně: spouštěč jen zapíše knihu do fronty. Oznámí se až plánovačem (viz 9), takže platí stejná pravidla jako pro ostatní
--    připomínky: nejvýš jedno oznámení denně, jen odpoledne a večer, jen kdo má připomínky zapnuté. Autor knihu nedostane.
create or replace function public.trg_push_new_book() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(new.is_hidden, false) then return new; end if;                              -- skrytý koncept se neoznamuje
  if tg_op = 'UPDATE' and not coalesce(old.is_hidden, false) then return new; end if;     -- jen když se kniha právě zveřejnila
  insert into public.push_new_books (book_id, title, author, author_id, announced_at)
  values (new.id, new.title, coalesce(new.author_display, new.author), new.author_id, now())
  on conflict (book_id) do update set title = excluded.title, author = excluded.author, author_id = excluded.author_id, announced_at = excluded.announced_at;
  delete from public.push_new_books where announced_at < now() - interval '30 days';
  return new;
end $$;
drop trigger if exists trg_push_new_book on public.books;
create trigger trg_push_new_book after insert or update of is_hidden on public.books
  for each row execute function public.trg_push_new_book();

-- 7) Nastavení motivačních oznámení čtenáře
create or replace function public.get_push_prefs() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('engage', coalesce((select engage from public.push_prefs where user_id = auth.uid()), true));
$$;
create or replace function public.set_push_prefs(p_engage boolean) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.push_prefs (user_id, engage, updated_at) values (auth.uid(), coalesce(p_engage, true), now())
  on conflict (user_id) do update set engage = excluded.engage, updated_at = now();
end $$;
revoke execute on function public.get_push_prefs(), public.set_push_prefs(boolean) from public, anon;
grant execute on function public.get_push_prefs(), public.set_push_prefs(boolean) to authenticated;

-- 8) Co dnes čtenáři připomenout? Vrací { kind, data, meta } nebo null. Pořadí: série v ohrožení, milník série, návrat po pauze,
--    rozečtená kniha, měsíční cíl, mince na novou knihu, nová kniha v knihovně, jemné popostrčení. Kdo dnes už četl, dostane jen milník nebo novinku.
create or replace function public.push_engage_pick(p_user uuid, p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  tz constant text := 'Europe/Prague';
  d date := (p_now at time zone tz)::date;
  read_today boolean;
  last_day date;
  streak_y int;
  streak_now int;
  b record;
  p record;
  v_done int;
  v_min int;
  nb record;
  new_book jsonb;
  recent_days constant int[] := array[3, 7, 14, 30];
  milestones constant int[] := array[3, 7, 14, 30, 50, 100, 200, 365];
begin
  select exists (select 1 from public.user_daily_activity where user_id = p_user and activity_date = d) into read_today;
  select max(activity_date) into last_day from public.user_daily_activity where user_id = p_user;

  -- série do včerejška: po sobě jdoucí dny s čtením (zmrazené dny série se počítají jako splněné)
  select coalesce(count(*) filter (where g = d), 0) into streak_y from (
    select dd, dd + (row_number() over (order by dd desc))::int as g from (
      select activity_date as dd from public.user_daily_activity where user_id = p_user and activity_date < d
      union
      select f from public.profiles pr, unnest(coalesce(pr.frozen_dates, '{}'::date[])) f where pr.id = p_user and f < d
    ) days
  ) x;
  streak_now := streak_y + (case when read_today then 1 else 0 end);

  -- nově zveřejněná kniha (poslední 4 dny), kterou čtenář ještě nemá a nenapsal; stejný druh nejdřív za 2 dny
  select n.book_id, n.title, n.author into nb from public.push_new_books n
   where n.announced_at > p_now - interval '4 days'
     and n.author_id is distinct from p_user
     and not exists (select 1 from public.user_books ub where ub.user_id = p_user and ub.book_id = n.book_id)
     and exists (select 1 from public.books bk where bk.id = n.book_id and not coalesce(bk.is_hidden, false))
     and not exists (select 1 from public.push_engage_log l where l.user_id = p_user and l.kind = 'new_book' and l.meta = n.book_id::text)
   order by n.announced_at desc limit 1;
  if found and not exists (select 1 from public.push_engage_log where user_id = p_user and kind = 'new_book' and created_at > p_now - interval '2 days') then
    new_book := jsonb_build_object('kind', 'new_book', 'data', jsonb_build_object('title', nb.title, 'author', nb.author), 'meta', nb.book_id::text);
  end if;

  if read_today then
    if streak_now = any (milestones) and not exists (select 1 from public.push_engage_log where user_id = p_user and kind = 'streak_milestone' and meta = streak_now::text) then
      return jsonb_build_object('kind', 'streak_milestone', 'data', jsonb_build_object('streak', streak_now), 'meta', streak_now::text);
    end if;
    return new_book;
  end if;

  if streak_y >= 1 then
    return jsonb_build_object('kind', 'streak_risk', 'data', jsonb_build_object('streak', streak_y));
  end if;

  if last_day is not null and (d - last_day) = any (recent_days) then
    return jsonb_build_object('kind', 'comeback', 'data', jsonb_build_object('days', d - last_day));
  end if;

  select bk.title, ub.scroll_position into b
    from public.user_books ub join public.books bk on bk.id = ub.book_id
   where ub.user_id = p_user and ub.status = 'active' and not coalesce(ub.is_read, false) and coalesce(ub.scroll_position, 0) between 3 and 97
   order by ub.updated_at desc nulls last limit 1;
  if found and not exists (select 1 from public.push_engage_log where user_id = p_user and kind = 'continue_book' and created_at > p_now - interval '3 days') then
    return jsonb_build_object('kind', 'continue_book', 'data', jsonb_build_object('title', b.title, 'percent', round(b.scroll_position)::int));
  end if;

  select monthly_goal, coins into p from public.profiles where id = p_user;
  if coalesce(p.monthly_goal, 0) > 0 and extract(day from d) >= 10
     and not exists (select 1 from public.push_engage_log where user_id = p_user and kind = 'goal_progress' and created_at > p_now - interval '5 days') then
    select count(*) into v_done from public.user_books
     where user_id = p_user and coalesce(is_read, false) and first_completed_at >= (date_trunc('month', p_now at time zone tz)) at time zone tz;
    if v_done < p.monthly_goal then
      return jsonb_build_object('kind', 'goal_progress', 'data', jsonb_build_object('goal', p.monthly_goal, 'done', v_done, 'remaining', p.monthly_goal - v_done));
    end if;
  end if;

  select min(bk.price_coins) into v_min from public.books bk
   where not coalesce(bk.is_hidden, false) and bk.price_coins > 0
     and not exists (select 1 from public.user_books ub where ub.user_id = p_user and ub.book_id = bk.id);
  if v_min is not null and coalesce(p.coins, 0) >= v_min
     and not exists (select 1 from public.push_engage_log where user_id = p_user and kind = 'coins_to_spend' and created_at > p_now - interval '7 days') then
    return jsonb_build_object('kind', 'coins_to_spend', 'data', jsonb_build_object('coins', p.coins));
  end if;

  if new_book is not null then return new_book; end if;

  if not exists (select 1 from public.push_engage_log where user_id = p_user and kind = 'gentle_nudge' and created_at > p_now - interval '3 days') then
    return jsonb_build_object('kind', 'gentle_nudge', 'data', '{}'::jsonb);
  end if;
  return null;
end $$;
revoke execute on function public.push_engage_pick(uuid, timestamptz) from public, anon, authenticated;

-- 9) Plánovač: každou hodinu projde čtenáře, kterým právě nastal jejich čas (mezi 16. a 19. hodinou pražského času, každý má svou
--    hodinu podle sebe), a každému pošle nejvýš jedno motivační oznámení denně. Nikdy v noci.
create or replace function public.push_engagement_tick(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path to 'public' as $$
declare
  tz constant text := 'Europe/Prague';
  d date := (p_now at time zone tz)::date;
  h int := extract(hour from (p_now at time zone tz))::int;
  u record;
  pick jsonb;
  sent int := 0;
begin
  if h < 16 or h > 19 then return 0; end if;
  -- nenastavené odesílání: nic se nezapisuje do deníku, ať čtenáři nepřijdou o dnešní připomínku, až se server dokončí
  if not exists (select 1 from public.push_settings where id = 1 and function_url is not null and secret is not null) then return 0; end if;
  for u in
    select distinct s.user_id from public.push_subscriptions s
    left join public.push_prefs pf on pf.user_id = s.user_id
    where coalesce(pf.engage, true) and (16 + mod(abs(hashtext(s.user_id::text)::bigint), 4)) = h
  loop
    continue when exists (select 1 from public.push_engage_log where user_id = u.user_id and day = d);
    pick := public.push_engage_pick(u.user_id, p_now);
    continue when pick is null;
    insert into public.push_engage_log (user_id, day, kind, meta) values (u.user_id, d, pick->>'kind', pick->>'meta') on conflict (user_id, day) do nothing;
    continue when not found;
    perform public.push_dispatch('user', u.user_id, null, null, '/', 'e-' || d::text, pick->>'kind', pick->'data');
    sent := sent + 1;
  end loop;
  return sent;
end $$;
revoke execute on function public.push_engagement_tick(timestamptz) from public, anon, authenticated;

-- Hodinový plánovač (pg_cron). Nejde-li ho zapnout odsud, zapni ho v Supabase: Integrations -> Cron -> nový úkol "select public.push_engagement_tick()" každou hodinu.
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('push-engagement', '0 * * * *', 'select public.push_engagement_tick()');
exception when others then
  raise notice 'pg_cron se nepodařilo zapnout (%). Zapni ho ručně podle db/push/README.md.', sqlerrm;
end $$;

-- 10) Zkušební oznámení sobě (tlačítko v Nastavení -> Oznámení). Posílá se přímo, bez zápisu do schránky oznámení; nejvýš jednou za
--     20 vteřin. Správce si může poslat ukázku libovolného druhu motivačního oznámení (Správa -> Upozornění).
create table if not exists public.push_test_log (
  user_id uuid primary key references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
alter table public.push_test_log enable row level security;
revoke all on public.push_test_log from anon, authenticated;

drop function if exists public.send_test_push();
create or replace function public.send_test_push(p_kind text default null) returns void language plpgsql security definer set search_path to 'public' as $$
declare sample jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_kind is not null then
    if coalesce(public.app_current_role(), '') <> 'správce' then raise exception 'forbidden'; end if;
    sample := case p_kind
      when 'streak_risk' then '{"streak": 5}'::jsonb
      when 'streak_milestone' then '{"streak": 7}'::jsonb
      when 'comeback' then '{"days": 7}'::jsonb
      when 'continue_book' then '{"title": "Ukázková kniha", "percent": 42}'::jsonb
      when 'goal_progress' then '{"goal": 4, "done": 2, "remaining": 2}'::jsonb
      when 'coins_to_spend' then '{"coins": 250}'::jsonb
      when 'gentle_nudge' then '{}'::jsonb
      when 'new_book' then '{"title": "Ukázková kniha", "author": "Jomarid"}'::jsonb
      else null end;
    if sample is null then raise exception 'bad_kind'; end if;
  end if;
  insert into public.push_test_log (user_id, at) values (auth.uid(), now())
  on conflict (user_id) do update set at = now() where public.push_test_log.at < now() - interval '20 seconds';
  if not found then raise exception 'too_many'; end if;
  if p_kind is null then
    perform public.push_dispatch('user', auth.uid(), 'Zkušební oznámení', 'Takhle ti budou chodit oznámení z Jomarid Books.', '/settings/notifications', 'test');
  else
    perform public.push_dispatch('user', auth.uid(), null, null, '/', 'test-' || p_kind, p_kind, sample);
  end if;
end $$;
revoke execute on function public.send_test_push(text) from public, anon;
grant execute on function public.send_test_push(text) to authenticated;
