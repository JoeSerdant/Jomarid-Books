-- Kouloví Kámoši online: proč se tah "nepodařilo odeslat". TOHLE SQL JEN ČTE, NIC NEMĚNÍ. Spusť celé v Supabase SQL Editoru.
--
-- Podezření: současná hra posílá po tahu každou kouli jako 54 čísel (26 bodů obalu), ale server (db/multiplayer.sql, funkce mp_check_payload) čeká
-- 18 čísel (8 bodů) a zprávu odmítne jako illegal_move; navíc by velká miska přesáhla limit 16 000 znaků na tah (max_payload).
-- Výsledek je jedna tabulka: 1 co je teď v databázi (verdikt), 2 poslední zápasy Kouloví Kámošů a jejich limit velikosti tahu, 3 poslední tahy
-- (velikost a kolik čísel má první koule). Pošli mi celý výsledek.

with fn as (
  select pg_get_functiondef('public.mp_check_payload(public.mp_matches, smallint, jsonb)'::regprocedure) as def,
         pg_get_functiondef('public.mp_cfg(text, text)'::regprocedure) as cfg
),
m as (
  select id, status, move_count, created_at, rules ->> 'max_payload' as max_payload
  from public.mp_matches where game_id = 'koulovikamosi' order by created_at desc limit 5
),
mv as (
  select x.match_id, x.seq, x.player, octet_length(x.payload::text) as bytes,
         (select string_agg(k, ',' order by k) from jsonb_object_keys(x.payload) k) as keys,
         case when x.payload ? 'b' then jsonb_array_length(x.payload -> 'b') end as koulí,
         case when x.payload ? 'b' and jsonb_array_length(x.payload -> 'b') > 0 then jsonb_array_length((x.payload -> 'b') -> 0) end as čísel_v_první_kouli
  from public.mp_moves x where x.match_id in (select id from m) order by x.at desc limit 12
)
select oddil, text from (
  select 1 as o, 0 as n, '1 Server' as oddil,
         case when (select def from fn) like '%not in (18, 54)%' then 'OPRAVENO: server bere koule s 18 i 54 čísly'
              when (select def from fn) like '%<> 18%' then 'STARÁ VERZE: server bere jen koule s 18 čísly, hra posílá 54, proto se tah odmítá (spusť db/multiplayer.sql po nasazení opravy)'
              else 'nepoznám verzi kontroly koulí' end
         || ' · limit tahu v pravidlech: ' || coalesce(substring((select cfg from fn) from 'koulovikamosi/duel[^\n]*max_payload'', ([0-9]+)'), '?') as text
  union all
  select 2, row_number() over (order by created_at desc), '2 Zápasy',
         id || ' · ' || status || ' · tahů ' || move_count || ' · limit ' || coalesce(max_payload, '?') || ' · ' || created_at from m
  union all
  select 3, row_number() over (order by match_id, seq desc), '3 Tahy',
         'zápas ' || left(match_id::text, 8) || ' · tah ' || seq || ' · hráč ' || player || ' · ' || bytes || ' B · pole ' || keys
         || coalesce(' · koulí ' || koulí || ' · čísel v první kouli ' || čísel_v_první_kouli, '') from mv
) r order by o, n;
