-- Denní limit otázek pro pomocníka v appce (chatbot, Edge Function help-bot): kolikrát dnes který přihlášený uživatel pomocníka použil.
-- Limit hlídá funkce help_bot_take, kterou volá Edge Function jménem uživatele. Klienti do tabulky nesahají vůbec.
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát: tabulka se nemaže, funkce se nahrazují.
-- Předpoklad, který v databázi už je: tabulka profiles (id). Den se počítá podle pražského času.

create table if not exists public.help_bot_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default ((now() at time zone 'Europe/Prague')::date),
  n int not null default 0 check (n >= 0),
  primary key (user_id, day)
);
alter table public.help_bot_usage enable row level security;
revoke all on public.help_bot_usage from public, anon, authenticated;

-- Započítá jednu otázku. Vrací, kolik otázek dnes ještě zbývá (0 = tohle byla poslední), nebo -1, když je limit vyčerpaný (nic se pak nezapíše).
-- Limit si volající určuje sám (Edge Function), tady se jen ořízne na 1 až 500.
create or replace function public.help_bot_take(p_limit int default 40) returns int
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 500);
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_n int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  delete from public.help_bot_usage where user_id = v_uid and day < v_today - 7;
  insert into public.help_bot_usage as u (user_id, day, n) values (v_uid, v_today, 1)
  on conflict (user_id, day) do update set n = u.n + 1 where u.n < v_limit
  returning u.n into v_n;
  if v_n is null then return -1; end if;
  return v_limit - v_n;
end $$;

-- Vrátí jednu otázku, když odpověď selhala z naší strany (Google neodpověděl), ať uživateli limit zbytečně neubývá.
create or replace function public.help_bot_refund() returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.help_bot_usage set n = n - 1
  where user_id = v_uid and day = (now() at time zone 'Europe/Prague')::date and n > 0;
end $$;

revoke all on function public.help_bot_take(int), public.help_bot_refund() from public, anon;
grant execute on function public.help_bot_take(int), public.help_bot_refund() to authenticated;
