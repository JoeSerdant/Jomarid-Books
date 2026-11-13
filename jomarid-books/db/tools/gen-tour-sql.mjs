// Vygeneruje db/tour-expand.sql z výchozího obsahu prohlídky v src/tour/tourModel.js (jediný zdroj pravdy):
//   node db/tools/gen-tour-sql.mjs
// Test src/tests/tour.test.mjs hlídá, že soubor odpovídá kódu, takže po změně textů prohlídky stačí tohle spustit znovu.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultTour, SET_KEYS, TOUR_LIMITS } from '../../src/tour/tourModel.js';

export const TOUR_SQL_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tour-expand.sql');

export const buildTourSql = () => {
  const tour = defaultTour();
  const json = '{\n' + SET_KEYS.map((k) => `  ${JSON.stringify(k)}: [\n${tour.sets[k].map((st) => `    ${JSON.stringify(st)}`).join(',\n')}\n  ]`).join(',\n') + '\n}';
  if (json.includes('$tour$')) throw new Error('obsah prohlídky obsahuje oddělovač $tour$');
  const counts = SET_KEYS.map((k) => `${k} ${tour.sets[k].length}`).join(', ');

  return `-- Prohlídka appky (tutoriál): VELKÉ ROZŠÍŘENÍ. Spusť celé v Supabase SQL Editoru. Generuje ho db/tools/gen-tour-sql.mjs z výchozího obsahu v src/tour/tourModel.js.
--
-- Co to udělá (kroky: ${counts}; limit appky je ${TOUR_LIMITS.maxSteps} kroků na sadu a ${TOUR_LIMITS.text} znaků na text):
--   * nahradí obsah prohlídky v site_settings (klíč onboarding_tour) novým, mnohem větším: pro čtenáře, nakladatele a správce, včetně všeho, co v původní
--     prohlídce chybělo (shortB, odznaky a obchůdek, statistiky, hry, nové Jomarid Online Games, hraní online, oznámení, čtení a hry bez internetu, jazyk,
--     pomocník, jednotlivé záložky Nastavení a všechny záložky Administrace);
--   * ZACHOVÁ, jestli je prohlídka zapnutá, i počet dní, po které se účet považuje za nový (autoDays);
--   * ZVÝŠÍ verzi prohlídky (jen když se obsah opravdu mění), takže ji sama uvidí i ti, kdo už starší verzi viděli. Znovu spuštěné SQL se stejným obsahem verzi
--     nezvýší a nic nezmění;
--   * dosavadní prohlídku nejdřív zálohuje do site_settings pod klíč onboarding_tour_before_expand (jen poprvé, další spuštění zálohu nepřepíše).
--
-- DŮLEŽITÉ: spusť to AŽ PO nasazení nové verze appky (po mergi). Starší appka má limit jen 15 kroků na sadu a prohlídku by ořízla. Nové cíle ve stránkách
-- (přepínač jazyka, pomocník, jednotlivé záložky Nastavení a Administrace, seznam her, Online Games...) jsou taky až v nové verzi; bez nich se karta ukáže uprostřed.
--
-- Zpět na původní prohlídku:
--   update public.site_settings set value = (select value from public.site_settings where key = 'onboarding_tour_before_expand') where key = 'onboarding_tour';
-- (Prohlídku jde kdykoli upravit i v Administraci v záložce Prohlídka appky; po úpravě už tohle SQL znovu nespouštěj, přepsalo by tvoje úpravy.)

-- 1) záloha dosavadní prohlídky (jen když ještě žádná záloha není)
insert into public.site_settings (key, value)
select 'onboarding_tour_before_expand', value from public.site_settings where key = 'onboarding_tour'
on conflict (key) do nothing;

-- 2) nová prohlídka
with old as (
  select value as v,
         case when (value ->> 'version') ~ '^[0-9]{1,4}$' then (value ->> 'version')::int else 1 end as ver
  from public.site_settings where key = 'onboarding_tour'
),
new_sets as (
  select $tour$${json}$tour$::jsonb as sets
)
insert into public.site_settings (key, value)
select 'onboarding_tour',
       jsonb_build_object(
         'enabled', coalesce((select v -> 'enabled' from old), 'true'::jsonb),
         'version', case when (select v -> 'sets' from old) is not distinct from n.sets then coalesce((select ver from old), 1)
                         else least(coalesce((select ver from old), 1) + 1, ${TOUR_LIMITS.maxVersion}) end,
         'autoDays', coalesce((select v -> 'autoDays' from old), '14'::jsonb),
         'sets', n.sets)
from new_sets n
on conflict (key) do update set value = excluded.value
returning key, value -> 'enabled' as zapnuto, value -> 'version' as verze, value -> 'autoDays' as dnu_novy_ucet,
          jsonb_array_length(value -> 'sets' -> 'reader') as kroku_ctenar, jsonb_array_length(value -> 'sets' -> 'publisher') as kroku_nakladatel,
          jsonb_array_length(value -> 'sets' -> 'admin') as kroku_spravce;
`;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sql = buildTourSql();
  fs.writeFileSync(TOUR_SQL_PATH, sql);
  console.log(`Zapsáno ${TOUR_SQL_PATH} (${sql.length} znaků).`);
}
