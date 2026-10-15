-- Obchůdek: za Jomarid Coins se dají koupit tituly (zobrazují se u jména ve Statistikách a v žebříčku) a vzhledy her (barevný odstín,
-- kterým appka přebarví hru, když ji spustíš). Nic z toho nedává výhodu ve hrách ani při čtení, je to jen vzhled.
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát: tabulky se nemažou, seznam zboží níže se jen srovná
-- (zboží, které ze seznamu zmizí, se přestane prodávat, ale kdo ho koupil, ho dál má) a funkce se nahrazují.
-- Předpoklady, které v databázi už jsou: tabulky profiles (id, coins, username, show_in_leaderboard) a coin_transactions (user_id, amount, source_type)
-- a hotový db/game-records.sql (některé tituly se odemykají herními odznaky).
--
-- Nákup je jedna transakce: zamkne řádek profilu (dva nákupy naráz se nepředběhnou), zkontroluje cenu, zůstatek a odznak, strhne mince,
-- zapíše je do coin_transactions (source_type 'cosmetic_purchase:<zboží>') a koupené zboží rovnou nasadí. Cenu a požadovaný odznak rozhoduje
-- server; seznam zboží je i v appce (src/shop/catalog.js) a test src/tests/shop.test.mjs hlídá, že si odpovídají.

-- Kontrola předpokladů dřív, než se cokoli vytvoří: ať případný nesoulad s tabulkou mincí vyjde najevo hned při spuštění,
-- ne až když si někdo něco koupí. Zkušební zápis se vrací zpět, nic po něm nezůstane.
do $$
declare
  v_uid uuid;
  v_before bigint;
  v_after bigint;
begin
  if to_regclass('public.game_badge_unlocks') is null then
    raise exception 'Nejdřív spusť db/game-records.sql (tituly se odemykají herními odznaky).';
  end if;
  if to_regclass('public.coin_transactions') is null then
    raise exception 'V databázi chybí tabulka coin_transactions.';
  end if;
  select id, coins into v_uid, v_before from public.profiles order by id limit 1;
  if v_uid is not null then
    begin
      insert into public.coin_transactions (user_id, amount, source_type) values (v_uid, -1, 'cosmetic_purchase:preflight');
      select coins into v_after from public.profiles where id = v_uid;
      if v_after is distinct from v_before then
        raise exception 'zápis do coin_transactions sám mění zůstatek v profiles (spoušť), nákup by strhl mince dvakrát';
      end if;
      raise exception using errcode = 'P0001', message = 'preflight_ok';
    exception when others then
      if sqlerrm <> 'preflight_ok' then
        raise exception 'Zkušební zápis do coin_transactions selhal: %. SQL je potřeba upravit podle skutečné tabulky.', sqlerrm;
      end if;
    end;
  end if;
end $$;

-- ---------- Tabulky ----------
create table if not exists public.shop_items (
  item_id text primary key,
  kind text not null check (kind in ('title', 'gamefx')),
  label text not null,
  price int not null check (price > 0),
  requires_badge text,
  active boolean not null default true
);

-- Co kdo koupil (a za kolik).
create table if not exists public.user_cosmetics (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.shop_items (item_id),
  price_paid int not null check (price_paid > 0),
  bought_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- Co má kdo právě nasazené: nejvýš jeden titul a jeden vzhled her.
create table if not exists public.user_equipped (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('title', 'gamefx')),
  item_id text not null,
  primary key (user_id, kind),
  foreign key (user_id, item_id) references public.user_cosmetics (user_id, item_id) on delete cascade
);

-- Klienti do tabulek nesahají vůbec: čtou a zapisují jen přes funkce níže.
alter table public.shop_items enable row level security;
alter table public.user_cosmetics enable row level security;
alter table public.user_equipped enable row level security;
revoke all on public.shop_items, public.user_cosmetics, public.user_equipped from public, anon, authenticated;

-- ---------- Seznam zboží ----------
with seed (item_id, kind, label, price, requires_badge) as (values
  ('title_bookworm', 'title', 'Knihomol', 100, null),
  ('title_night', 'title', 'Noční sova', 120, null),
  ('title_morning', 'title', 'Ranní ptáče', 120, null),
  ('title_collector', 'title', 'Sběratel', 150, null),
  ('title_pilot', 'title', 'Pilot', 150, 'rocket_ace'),
  ('title_hellrider', 'title', 'Pán pekel', 250, 'rocket_hell'),
  ('title_chess', 'title', 'Šachista', 100, 'chess_first'),
  ('title_dragon', 'title', 'Drakobijec', 250, 'chess_dragon'),
  ('title_koulovi', 'title', 'Mistr koulí', 250, 'koulovi_all'),
  ('title_arena', 'title', 'Velitel arény', 200, 'polygon_win'),
  ('title_mayor', 'title', 'Starosta', 150, 'city_prestige'),
  ('title_strategist', 'title', 'Stratég', 200, 'war_sector10'),
  ('gamefx_noir', 'gamefx', 'Noir', 250, null),
  ('gamefx_retro', 'gamefx', 'Retro', 250, null),
  ('gamefx_neon', 'gamefx', 'Neon', 300, null),
  ('gamefx_frost', 'gamefx', 'Mráz', 300, null),
  ('gamefx_ember', 'gamefx', 'Žár', 300, null),
  ('gamefx_dusk', 'gamefx', 'Soumrak', 300, null)
), upserted as (
  insert into public.shop_items (item_id, kind, label, price, requires_badge, active)
  select item_id, kind, label, price, requires_badge, true from seed
  on conflict (item_id) do update
    set kind = excluded.kind, label = excluded.label, price = excluded.price, requires_badge = excluded.requires_badge, active = true
  returning item_id
)
update public.shop_items i set active = false where i.active and not exists (select 1 from seed s where s.item_id = i.item_id);

-- ---------- Nákup ----------
-- Koupí zboží za mince a rovnou ho nasadí. Vrací {ok, item_id, kind, new_balance}.
-- Chyby: not_authenticated, unknown_item (neexistuje nebo se už neprodává), profile_not_found, already_owned,
-- locked (chybí požadovaný herní odznak), insufficient_coins.
create or replace function public.buy_cosmetic(p_item_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_item public.shop_items%rowtype;
  v_coins bigint;
  v_new bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_item from public.shop_items where item_id = p_item_id and active;
  if not found then raise exception 'unknown_item'; end if;

  select coins into v_coins from public.profiles where id = v_uid for update;
  if not found then raise exception 'profile_not_found'; end if;

  if exists (select 1 from public.user_cosmetics where user_id = v_uid and item_id = v_item.item_id) then raise exception 'already_owned'; end if;
  if v_item.requires_badge is not null
     and not exists (select 1 from public.game_badge_unlocks where user_id = v_uid and badge_id = v_item.requires_badge) then
    raise exception 'locked';
  end if;
  if coalesce(v_coins, 0) < v_item.price then raise exception 'insufficient_coins'; end if;

  update public.profiles set coins = coins - v_item.price where id = v_uid returning coins into v_new;
  insert into public.coin_transactions (user_id, amount, source_type) values (v_uid, -v_item.price, 'cosmetic_purchase:' || v_item.item_id);
  insert into public.user_cosmetics (user_id, item_id, price_paid) values (v_uid, v_item.item_id, v_item.price);
  insert into public.user_equipped (user_id, kind, item_id) values (v_uid, v_item.kind, v_item.item_id)
  on conflict (user_id, kind) do update set item_id = excluded.item_id;

  return jsonb_build_object('ok', true, 'item_id', v_item.item_id, 'kind', v_item.kind, 'new_balance', v_new);
end $$;

-- Nasadí koupený kus, nebo (p_item_id = null) sundá to, co je nasazené v dané skupině. p_kind je 'title' nebo 'gamefx'.
-- Chyby: not_authenticated, invalid_kind, not_owned, wrong_kind.
create or replace function public.equip_cosmetic(p_kind text, p_item_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_kind is null or p_kind not in ('title', 'gamefx') then raise exception 'invalid_kind'; end if;
  if p_item_id is null then
    delete from public.user_equipped where user_id = v_uid and kind = p_kind;
    return jsonb_build_object('ok', true, 'kind', p_kind, 'item_id', null);
  end if;
  select i.kind into v_kind from public.user_cosmetics c join public.shop_items i on i.item_id = c.item_id where c.user_id = v_uid and c.item_id = p_item_id;
  if not found then raise exception 'not_owned'; end if;
  if v_kind <> p_kind then raise exception 'wrong_kind'; end if;
  insert into public.user_equipped (user_id, kind, item_id) values (v_uid, p_kind, p_item_id)
  on conflict (user_id, kind) do update set item_id = excluded.item_id;
  return jsonb_build_object('ok', true, 'kind', p_kind, 'item_id', p_item_id);
end $$;

-- ---------- Čtenář ----------
-- Vlastní zboží a nasazené kusy: {owned: [id...], equipped: {title: id, gamefx: id}} (u nenasazené skupiny klíč chybí).
create or replace function public.my_cosmetics()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object(
    'owned', coalesce((select jsonb_agg(item_id order by bought_at, item_id) from public.user_cosmetics where user_id = v_uid), '[]'::jsonb),
    'equipped', coalesce((select jsonb_object_agg(kind, item_id) from public.user_equipped where user_id = v_uid), '{}'::jsonb));
end $$;

-- Nasazené tituly vybraných lidí (do žebříčku). Titul je vidět jen u těch, kdo smějí být v žebříčku (profiles.show_in_leaderboard).
create or replace function public.equipped_titles(p_user_ids uuid[])
returns table (user_id uuid, item_id text) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if cardinality(p_user_ids) > 1000 then raise exception 'too_many'; end if;
  return query
    select e.user_id, e.item_id
    from public.user_equipped e
    join public.profiles p on p.id = e.user_id
    where e.kind = 'title' and e.user_id = any (p_user_ids) and coalesce(p.show_in_leaderboard, true);
end $$;

-- ---------- Oprávnění ----------
revoke all on function public.buy_cosmetic(text) from public, anon;
revoke all on function public.equip_cosmetic(text, text) from public, anon;
revoke all on function public.my_cosmetics() from public, anon;
revoke all on function public.equipped_titles(uuid[]) from public, anon;
grant execute on function public.buy_cosmetic(text) to authenticated;
grant execute on function public.equip_cosmetic(text, text) to authenticated;
grant execute on function public.my_cosmetics() to authenticated;
grant execute on function public.equipped_titles(uuid[]) to authenticated;
