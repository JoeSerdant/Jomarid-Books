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

-- 3) Přihlášení a odhlášení zařízení (security definer: zařízení sdílené dvěma účty se přepíše na toho, kdo se právě přihlásil)
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2000 then raise exception 'bad_endpoint'; end if;
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
create or replace function public.push_dispatch(p_audience text, p_user uuid, p_title text, p_body text, p_url text, p_tag text)
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare cfg record;
begin
  select function_url, secret into cfg from public.push_settings where id = 1;
  if cfg.function_url is null or cfg.secret is null then return; end if;
  perform net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret),
    body := jsonb_build_object('audience', p_audience, 'user_id', p_user, 'title', left(coalesce(p_title, ''), 120),
                               'body', left(coalesce(p_body, ''), 200), 'url', p_url, 'tag', p_tag)
  );
exception when others then
  null;
end $$;
revoke execute on function public.push_dispatch(text, uuid, text, text, text, text) from public, anon, authenticated;

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

-- 6) Zkušební oznámení sobě (tlačítko v Nastavení -> Oznámení). Posílá se přímo, bez zápisu do schránky oznámení; nejvýš jednou za 20 vteřin.
create table if not exists public.push_test_log (
  user_id uuid primary key references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
alter table public.push_test_log enable row level security;
revoke all on public.push_test_log from anon, authenticated;

create or replace function public.send_test_push() returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.push_test_log (user_id, at) values (auth.uid(), now())
  on conflict (user_id) do update set at = now() where public.push_test_log.at < now() - interval '20 seconds';
  if not found then raise exception 'too_many'; end if;
  perform public.push_dispatch('user', auth.uid(), 'Zkušební oznámení', 'Takhle ti budou chodit oznámení z Jomarid Books.', '/settings/notifications', 'test');
end $$;
revoke execute on function public.send_test_push() from public, anon;
grant execute on function public.send_test_push() to authenticated;
