-- Uložený postup her: místo v localStorage prohlížeče se postup každé hry (vylepšení, nastavení, rozehraná partie...) ukládá u účtu.
-- Hra sama nic nemění, pořád si "ukládá do localStorage"; appka ten localStorage ve hře nahradí pamětí a změny posílá sem.
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát: tabulka se nemaže, funkce se nahrazují.
-- Předpoklady, které v databázi už jsou: tabulka profiles (id).
--
-- Co se ukládá: pro každou hru jeden objekt {klíč: text}, přesně tak, jak by to hra zapsala do localStorage (hra si text čte a skládá sama).
-- Server do obsahu nesahá, jen hlídá tvar: známá hra, nejvýš 40 klíčů, klíč 1 až 100 znaků, hodnoty jen text, celek nejvýš 2 MB.
--
-- Revize (rev): každé uložení ji zvýší o jedna. Hra při načtení dostane svoji revizi a při ukládání ji posílá zpátky; když je mezitím na
-- serveru novější (hraje se jinde), uložení se odmítne ({ok: false, reason: 'conflict'}), aby jedno zařízení nepřepsalo postup z druhého.
--
-- Starý postup z prohlížeče: appka ho při prvním spuštění hry pošle funkcí import_legacy_game_state. Když ještě žádný uložený postup není,
-- stane se jím. Když už je (postup z jiného zařízení), zůstane ten na serveru a starý z prohlížeče se uloží jen jako záloha
-- (legacy_backup, appka ho nikde nečte, jde ho případně obnovit ručně), aby se nic nenávratně neztratilo.

-- ---------- Tabulka ----------
create table if not exists public.game_saves (
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id text not null,
  data jsonb not null default '{}'::jsonb,
  rev int not null default 0 check (rev >= 0),
  updated_at timestamptz not null default now(),
  legacy_backup jsonb,
  legacy_backup_at timestamptz,
  primary key (user_id, game_id)
);

-- Klienti do tabulky nesahají vůbec: čtou a zapisují jen přes funkce níže.
alter table public.game_saves enable row level security;
revoke all on public.game_saves from public, anon, authenticated;

-- ---------- Kontrola tvaru ----------
-- Vyhodí unknown_game, invalid_data nebo too_large; jinak nic.
create or replace function public.game_save_check(p_game_id text, p_data jsonb)
returns void language plpgsql immutable set search_path to 'public' as $$
begin
  if p_game_id is null or p_game_id not in ('rocket', 'warroom', 'cityclicker', 'polygonarena', 'chess', 'koulovikamosi') then raise exception 'unknown_game'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_data'; end if;
  if (select count(*) from jsonb_object_keys(p_data)) > 40 then raise exception 'invalid_data'; end if;
  if exists (select 1 from jsonb_each(p_data) e where jsonb_typeof(e.value) <> 'string' or length(e.key) < 1 or length(e.key) > 100) then raise exception 'invalid_data'; end if;
  if octet_length(p_data::text) > 2000000 then raise exception 'too_large'; end if;
end $$;

-- ---------- Načtení ----------
-- {rev, data}; hra, která ještě nic neuložila, má rev 0 a prázdná data.
create or replace function public.load_game_state(p_game_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  r public.game_saves%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.game_save_check(p_game_id, '{}'::jsonb);
  select * into r from public.game_saves where user_id = v_uid and game_id = p_game_id;
  if not found then return jsonb_build_object('rev', 0, 'data', '{}'::jsonb); end if;
  return jsonb_build_object('rev', r.rev, 'data', r.data);
end $$;

-- ---------- Uložení ----------
-- Uloží celý postup hry, když p_base_rev je revize, kterou má server. Vrací {ok: true, rev} (nová revize) nebo {ok: false, reason: 'conflict', rev}
-- (na serveru je jiná revize, nic se nezměnilo). Chyby: not_authenticated, unknown_game, invalid_data, too_large.
create or replace function public.save_game_state(p_game_id text, p_data jsonb, p_base_rev int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_rev int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.game_save_check(p_game_id, p_data);
  if p_base_rev is null or p_base_rev < 0 then raise exception 'invalid_data'; end if;

  insert into public.game_saves (user_id, game_id) values (v_uid, p_game_id) on conflict do nothing;
  select rev into v_rev from public.game_saves where user_id = v_uid and game_id = p_game_id for update;
  if v_rev <> p_base_rev then return jsonb_build_object('ok', false, 'reason', 'conflict', 'rev', v_rev); end if;

  update public.game_saves set data = p_data, rev = v_rev + 1, updated_at = now() where user_id = v_uid and game_id = p_game_id;
  return jsonb_build_object('ok', true, 'rev', v_rev + 1);
end $$;

-- ---------- Starý postup z prohlížeče ----------
-- Vrací {imported, rev, data}: imported je true, když se starý postup stal uloženým postupem (dosud žádný nebyl); jinak zůstává uložený
-- postup na serveru (vrací se jeho rev a data) a starý se uloží do legacy_backup.
create or replace function public.import_legacy_game_state(p_game_id text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  r public.game_saves%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.game_save_check(p_game_id, p_data);

  insert into public.game_saves (user_id, game_id) values (v_uid, p_game_id) on conflict do nothing;
  select * into r from public.game_saves where user_id = v_uid and game_id = p_game_id for update;
  if r.rev = 0 then
    update public.game_saves set data = p_data, rev = 1, updated_at = now() where user_id = v_uid and game_id = p_game_id;
    return jsonb_build_object('imported', true, 'rev', 1, 'data', p_data);
  end if;
  update public.game_saves set legacy_backup = p_data, legacy_backup_at = now() where user_id = v_uid and game_id = p_game_id;
  return jsonb_build_object('imported', false, 'rev', r.rev, 'data', r.data);
end $$;

-- ---------- Export dat účtu ----------
-- Všechny uložené postupy: {hra: {rev, updated_at, data}}. Záloha starého postupu se nevrací (je jen pro ruční obnovu).
create or replace function public.my_game_saves()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return coalesce((select jsonb_object_agg(game_id, jsonb_build_object('rev', rev, 'updated_at', updated_at, 'data', data))
                   from public.game_saves where user_id = v_uid and rev > 0), '{}'::jsonb);
end $$;

-- ---------- Oprávnění ----------
revoke all on function public.game_save_check(text, jsonb) from public, anon, authenticated;
revoke all on function public.load_game_state(text) from public, anon;
revoke all on function public.save_game_state(text, jsonb, int) from public, anon;
revoke all on function public.import_legacy_game_state(text, jsonb) from public, anon;
revoke all on function public.my_game_saves() from public, anon;
grant execute on function public.load_game_state(text) to authenticated;
grant execute on function public.save_game_state(text, jsonb, int) to authenticated;
grant execute on function public.import_legacy_game_state(text, jsonb) to authenticated;
grant execute on function public.my_game_saves() to authenticated;
