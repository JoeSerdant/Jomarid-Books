// Polygon aréna: statistiky, které hra hlásí, a odznaky z nich (id a prahy se nemění, na nich stojí odemčené odznaky hráčů).
import { stat, badge } from './helpers.js';

export const STATS = [
  stat("best_level", "Nejvyšší úroveň", 100),
  stat("bosses_defeated", "Poražení bossové", 1000000),
  stat("wins", "Vyhrané zápasy", 1000000),
  stat("best_tier", "Nejvyšší stupeň třídy", 5),
  stat("boss_kinds", "Druhy poražených bossů", 12),
  stat("classes_discovered", "Objevené třídy", 540),
  stat("best_wave", "Nejvyšší vlna v Přežití", 1000),
  stat("hill_wins", "Výhry v Králi kopce", 1000000),
  stat("royale_wins", "Výhry v Posledním přeživším", 1000000),
  stat("rush_wins", "Výhry v Honu na bossy", 1000000),
  stat("hell_best_level", "Nejvyšší úroveň na Pekle", 100),
  stat("modes_played", "Vyzkoušené režimy", 8),
];

export const BADGES = [
  badge("polygon_lvl20", "best_level", 20, 6, "Veterán arény", "Dosáhni úrovně 20."),
  badge("polygon_lvl58", "best_level", 58, 11, "Legenda arény", "Dosáhni maximální úrovně."),
  badge("polygon_boss", "bosses_defeated", 1, 6, "Lovec bossů", "Poraz bosse."),
  badge("polygon_win", "wins", 1, 6, "Vítěz zápasu", "Vyhraj zápas."),
  badge("polygon_boss5", "bosses_defeated", 5, 8, "Zabiják titánů", "Poraz 5 bossů."),
  badge("polygon_bossall", "boss_kinds", 12, 10, "Sběratel trofejí", "Poraz všech 12 druhů bossů."),
  badge("polygon_tier4", "best_tier", 4, 8, "Vrchol vývoje", "Dosáhni 4. stupně třídy."),
  badge("polygon_tier5", "best_tier", 5, 9, "Vzestup třídy", "Dosáhni 5. stupně třídy (Vzestup)."),
  badge("polygon_cdx40", "classes_discovered", 40, 3, "Znalec", "Objev 40 tříd."),
  badge("polygon_cdx150", "classes_discovered", 150, 6, "Archivář", "Objev 150 tříd."),
  badge("polygon_cdx400", "classes_discovered", 400, 10, "Encyklopedie", "Objev 400 tříd."),
  badge("polygon_wave10", "best_wave", 10, 6, "Desátá vlna", "Zvládni 10 vln v režimu Přežití."),
  badge("polygon_hill", "hill_wins", 1, 6, "Král kopce", "Vyhraj zápas v režimu Král kopce."),
  badge("polygon_royale", "royale_wins", 1, 7, "Poslední v bouři", "Vyhraj režim Poslední přeživší."),
  badge("polygon_rush", "rush_wins", 1, 10, "Přemožitel", "Poraz všechny bossy v Honu na bossy."),
  badge("polygon_hell", "hell_best_level", 25, 9, "Z pekla", "Dosáhni úrovně 25 na obtížnosti Peklo."),
  badge("polygon_allmodes", "modes_played", 8, 7, "Všechny režimy", "Zahraj si všech 8 herních režimů."),
];
