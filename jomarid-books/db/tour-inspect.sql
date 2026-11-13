-- Prohlídka appky (tutoriál): co je teď uloženo v databázi. TOHLE SQL JEN ČTE, NIC NEMĚNÍ. Spusť celé v Supabase SQL Editoru.
--
-- Obsah prohlídky je v tabulce site_settings pod klíčem onboarding_tour (JSON: zapnuto, verze, kolik dní je účet "nový" a tři sady kroků: čtenář, nakladatel,
-- správce). Správce ho upravuje v Administraci. Řádek v databázi přebíjí výchozí kroky z kódu (src/tour/tourModel.js): když tam žádný není, platí výchozí.
-- Výsledek je jedna tabulka: nejdřív souhrn, potom každý krok (sada, pořadí, id, zapnuto, na co ukazuje, titulek a celý text), nakonec kolik lidí
-- prohlídku už vidělo (podle toho se rozhoduje, jestli ji po rozšíření ukázat znovu) a jaké další klíče jsou v site_settings.
--
-- Pošli mi celý výsledek (třeba jako text nebo snímek), z něj poznám, co v prohlídce chybí, a podle toho napíšu SQL, které ji rozšíří.

with cfg as (
  select value as v from public.site_settings where key = 'onboarding_tour'
),
sets(k, label, ord) as (
  values ('reader', 'čtenář', 1), ('publisher', 'nakladatel', 2), ('admin', 'správce', 3)
),
steps as (
  select s.ord as sada_ord, s.label as sada, e.n::int as poradi, e.step as step
  from cfg
  cross join sets s
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(cfg.v -> 'sets' -> s.k) = 'array' then cfg.v -> 'sets' -> s.k else '[]'::jsonb end
  ) with ordinality as e(step, n)
),
summary as (
  select
    case when not exists (select 1 from cfg)
         then 'ŘÁDEK V DATABÁZI NENÍ: appka používá výchozí kroky z kódu (nikdy se neukládalo z administrace)'
         else 'zapnuto: ' || coalesce((select v ->> 'enabled' from cfg), 'ano (výchozí)')
              || ' · verze: ' || coalesce((select v ->> 'version' from cfg), '1 (výchozí)')
              || ' · nový účet je do (dní): ' || coalesce((select v ->> 'autoDays' from cfg), '14 (výchozí)')
    end as text
  union all
  select 'sada ' || s.label || ': ' ||
         case when not exists (select 1 from cfg) then 'výchozí z kódu'
              when jsonb_typeof((select v -> 'sets' -> s.k from cfg)) = 'array'
                then (select count(*) from steps t where t.sada_ord = s.ord)::text || ' kroků v databázi (zapnutých: '
                     || (select count(*) from steps t where t.sada_ord = s.ord and coalesce(t.step ->> 'enabled', 'true') <> 'false')::text || ')'
              else 'v databázi chybí, platí výchozí z kódu' end
  from sets s
)
select oddil, sada, poradi, id, zapnuto, cil, titulek, text from (
  select 1 as o1, 0 as o2, 0 as o3, '1 Souhrn' as oddil, null::text as sada, null::int as poradi, null::text as id, null::text as zapnuto, null::text as cil, null::text as titulek, text from summary
  union all
  select 2, sada_ord, poradi, '2 Kroky', sada, poradi, step ->> 'id', coalesce(step ->> 'enabled', 'true'), step ->> 'anchor', step ->> 'title',
         (step ->> 'text') || ' [' || length(coalesce(step ->> 'text', '')) || ' znaků]'
  from steps
  union all
  select 3, 0, 0, '3 Kdo prohlídku viděl', null, null, null, null, null, null,
         'účtů celkem: ' || (select count(*) from auth.users)
         || ' · viděli nějakou verzi: ' || (select count(*) from auth.users u where (to_jsonb(u) -> 'raw_user_meta_data' ->> 'tour_seen_version') ~ '^[0-9]+$')
         || ' · nejvyšší viděná verze: ' || coalesce((select max(((to_jsonb(u) -> 'raw_user_meta_data' ->> 'tour_seen_version'))::int) from auth.users u
                                                      where (to_jsonb(u) -> 'raw_user_meta_data' ->> 'tour_seen_version') ~ '^[0-9]+$')::text, '-')
  union all
  select 4, 0, row_number() over (order by key), '4 Ostatní klíče v site_settings', null, null, key, null, null, null,
         'velikost hodnoty: ' || length(value::text) || ' znaků'
  from public.site_settings where key <> 'onboarding_tour'
) r
order by o1, o2, o3;
