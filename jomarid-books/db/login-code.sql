-- Přihlašovací kód: dlouhý náhodný kód, který si čtenář vygeneruje v Nastavení (Zabezpečení) a pak ho použije místo hesla.
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát: tabulky se nemažou, funkce se nahrazují.
-- Předpoklady, které v databázi už jsou: tabulka profiles (id).
--
-- Jak to funguje: kód (32 znaků 0-9 a A-F, 122 náhodných bitů) vzniká tady v databázi a čtenáři se ukáže jen jednou. Uložený je jen jeho otisk (SHA-256),
-- takže ani správce databáze kód nepozná. Kdo kód zná, pošle ho Edge Function code-login (db/auth/code-login.ts), která otisk najde a vydá přihlášení.
-- Nový kód předchozí zneplatní. Heslo zůstává: kód je druhý způsob přihlášení, ne jeho náhrada, a kdo ho ztratí, přihlásí se heslem a vygeneruje si nový.
--
-- Ochrana proti zkoušení kódů: Edge Function volá redeem_login_code s adresou volajícího a funkce po 10 neúspěšných pokusech za 10 minut z jedné adresy
-- (nebo po 300 neúspěšných pokusech ze všech adres dohromady) další pokusy odmítne. Při 122 bitech je uhodnutí kódu stejně nereálné, tohle jen brání zátěži.

-- ---------- Tabulky ----------
create table if not exists public.login_codes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  use_count int not null default 0
);

create table if not exists public.login_code_failures (
  id bigint generated always as identity primary key,
  client text not null,
  at timestamptz not null default now()
);
create index if not exists login_code_failures_client on public.login_code_failures (client, at);

-- Klienti do tabulek nesahají vůbec: čtou a zapisují jen přes funkce níže.
alter table public.login_codes enable row level security;
alter table public.login_code_failures enable row level security;
revoke all on public.login_codes, public.login_code_failures from public, anon, authenticated;

-- ---------- Čtenář ----------
-- Vytvoří nový kód a vrátí ho (jediná chvíle, kdy ho server ukáže). Předchozí kód přestane platit.
create or replace function public.create_login_code()
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_raw text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_raw := upper(replace(gen_random_uuid()::text, '-', ''));
  insert into public.login_codes (user_id, code_hash) values (v_uid, sha256(convert_to(v_raw, 'UTF8')))
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, created_at = now(), last_used_at = null, use_count = 0;
  return substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4) || '-' || substr(v_raw, 13, 4) || '-'
      || substr(v_raw, 17, 4) || '-' || substr(v_raw, 21, 4) || '-' || substr(v_raw, 25, 4) || '-' || substr(v_raw, 29, 4);
end $$;

-- Má čtenář kód a kdy ho naposledy použil (samotný kód ani otisk se nevrací).
create or replace function public.my_login_code()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  r public.login_codes;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into r from public.login_codes where user_id = v_uid;
  if not found then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object('exists', true, 'created_at', r.created_at, 'last_used_at', r.last_used_at, 'use_count', r.use_count);
end $$;

-- Zneplatní kód. Vrací, jestli nějaký byl.
create or replace function public.revoke_login_code()
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  delete from public.login_codes where user_id = v_uid;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- ---------- Edge Function ----------
-- Zkusí uplatnit kód podle jeho otisku. Smí ji volat jen Edge Function (role service_role). Vrací {ok: true, user_id}
-- nebo {ok: false, reason: 'invalid' | 'throttled'}.
create or replace function public.redeem_login_code(p_hash bytea, p_client text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_client text := left(coalesce(nullif(btrim(p_client), ''), 'unknown'), 100);
  v_uid uuid;
begin
  delete from public.login_code_failures where at < now() - interval '1 day';
  if (select count(*) from public.login_code_failures where client = v_client and at > now() - interval '10 minutes') >= 10
     or (select count(*) from public.login_code_failures where at > now() - interval '10 minutes') >= 300 then
    return jsonb_build_object('ok', false, 'reason', 'throttled');
  end if;
  update public.login_codes set last_used_at = now(), use_count = use_count + 1 where code_hash = p_hash returning user_id into v_uid;
  if v_uid is null then
    insert into public.login_code_failures (client) values (v_client);
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  return jsonb_build_object('ok', true, 'user_id', v_uid);
end $$;

-- ---------- Oprávnění ----------
revoke all on function public.create_login_code() from public, anon;
revoke all on function public.my_login_code() from public, anon;
revoke all on function public.revoke_login_code() from public, anon;
revoke all on function public.redeem_login_code(bytea, text) from public, anon, authenticated;
grant execute on function public.create_login_code() to authenticated;
grant execute on function public.my_login_code() to authenticated;
grant execute on function public.revoke_login_code() to authenticated;
grant execute on function public.redeem_login_code(bytea, text) to service_role;
