-- Série čtení (streak) ostatních čtenářů v žebříčku: server vrátí vyhodnocenou sérii a použité pojistky (Streak Freeze), podle kterých
-- se série počítá stejně jako ta tvoje nahoře na stránce Statistiky.
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát: funkce se jen nahrazuje, žádná data se nemění.
-- Předpoklady, které v databázi už jsou: tabulka profiles (id, current_streak, frozen_dates, show_in_leaderboard).
--
-- Proč: žebříček dosud počítal sérii ostatních jen z dnů, kdy četli (user_daily_activity). Zmeškaný den zachráněný pojistkou tam chybí,
-- takže čtenáři s pojistkou (nebo takový, co dnes ještě nečetl) vycházela série 0, i když má osm dní. current_streak a frozen_dates jsou
-- hodnoty, které vyhodnotila funkce resolve_streak(); appka k nim jen připočte dnešek, pokud se dnes četlo.
-- Vrací jen ty, kdo smějí být v žebříčku (profiles.show_in_leaderboard, výchozí je ano), žádné e-maily ani jiné osobní údaje.
create or replace function public.leaderboard_streaks()
returns table (user_id uuid, current_streak int, frozen_dates date[]) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select p.id, greatest(coalesce(p.current_streak, 0), 0)::int, coalesce(p.frozen_dates, '{}'::date[])
    from public.profiles p
    where coalesce(p.show_in_leaderboard, true);
end $$;

revoke all on function public.leaderboard_streaks() from public, anon;
grant execute on function public.leaderboard_streaks() to authenticated;
