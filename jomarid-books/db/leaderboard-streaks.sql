-- Série čtení (streak) ostatních čtenářů v žebříčku: server vrátí vyhodnocenou sérii, použité pojistky (Streak Freeze) i počet pojistek
-- v zásobě, podle kterých se série počítá stejně jako ta tvoje nahoře na stránce Statistiky a řádek se zmrzlou sérií se v žebříčku
-- zbarví modře.
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát: funkce se zahodí a založí znovu, žádná data se nemění.
-- Předpoklady, které v databázi už jsou: tabulka profiles (id, current_streak, frozen_dates, streak_freezes, show_in_leaderboard).
--
-- Proč: žebříček dosud počítal sérii ostatních jen z dnů, kdy četli (user_daily_activity). Zmeškaný den zachráněný pojistkou tam chybí,
-- takže čtenáři s pojistkou (nebo takový, co dnes ještě nečetl) vycházela série 0, i když má osm dní. current_streak a frozen_dates jsou
-- hodnoty, které vyhodnotila funkce resolve_streak(); appka k nim jen připočte dnešek, pokud se dnes četlo.
-- Pojistky v zásobě (streak_freezes) jsou tu proto, že resolve_streak() se spustí až ve chvíli, kdy čtenář appku otevře: kdo zmeškal den
-- a appku ještě neotevřel, má pojistku ve skutečnosti spotřebovanou až zítra. Appka z počtu pojistek pozná, že mu sérii drží, a nezobrazí 0.
-- Funkce mění návratové sloupce (přibyl streak_freezes), proto se nejdřív zahazuje.
-- Vrací jen ty, kdo smějí být v žebříčku (profiles.show_in_leaderboard, výchozí je ano), žádné e-maily ani jiné osobní údaje.
drop function if exists public.leaderboard_streaks();
create function public.leaderboard_streaks()
returns table (user_id uuid, current_streak int, frozen_dates date[], streak_freezes int) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select p.id, greatest(coalesce(p.current_streak, 0), 0)::int, coalesce(p.frozen_dates, '{}'::date[]), greatest(coalesce(p.streak_freezes, 0), 0)::int
    from public.profiles p
    where coalesce(p.show_in_leaderboard, true);
end $$;

revoke all on function public.leaderboard_streaks() from public, anon;
grant execute on function public.leaderboard_streaks() to authenticated;
