// Herní rekordy a odznaky: které výsledky hry hlásí, jak se jmenují, jaké jsou nejvyšší věrohodné hodnoty a jaké odznaky z nich vznikají.
// Stejný seznam je v db/game-records.sql (tam rozhoduje server); test src/tests/gameRecords.test.mjs hlídá, že si odpovídají.
// Hry samy nic nepočítají ani neudělují: hlásí jen aktuální hodnotu (jomaridRecord), server si pamatuje nejvyšší a odemyká odznaky.
import { Rocket, Swords, Building2, Target, Crown, Smile } from 'lucide-react';

// id her jsou stejná jako v Games.jsx a v mostu pro odměny; headline je statistika, podle které se řadí žebříček hry
export const GAME_CATALOG = [
  {
    id: 'rocket', title: 'Jomarid Rocket Game', icon: Rocket, headline: 'score_normal',
    stats: [
      { key: 'score_normal', label: 'Normální (skóre)', max: 100000000 },
      { key: 'score_hard', label: 'Těžká (skóre)', max: 100000000 },
      { key: 'score_inferno', label: 'Peklo (skóre)', max: 100000000 },
      { key: 'score_insane', label: 'Insane Peklo (skóre)', max: 100000000 },
      { key: 'score_blitz', label: 'Blesková vlna (skóre)', max: 100000000 },
      { key: 'rush_streak', label: 'Boss Rush (série bossů)', max: 10000 },
      { key: 'boss_level', label: 'Nejvyšší poražený boss', max: 1000 },
      { key: 'ascension', label: 'Vzestupy', max: 10000 },
    ],
  },
  {
    id: 'warroom', title: 'Warroom: Frontlines', icon: Swords, headline: 'best_sector',
    stats: [
      { key: 'best_sector', label: 'Nejdál v kampani (sektor)', max: 10000 },
      { key: 'scenarios_unlocked', label: 'Odemčené scénáře', max: 100 },
    ],
  },
  {
    id: 'cityclicker', title: 'City Clicker', icon: Building2, headline: 'prestige_count',
    stats: [
      { key: 'prestige_count', label: 'Prestiže', max: 100000 },
      { key: 'total_clicks', label: 'Kliknutí celkem', max: 2000000000 },
    ],
  },
  {
    id: 'polygonarena', title: 'Polygon aréna', icon: Target, headline: 'best_level',
    stats: [
      { key: 'best_level', label: 'Nejvyšší úroveň', max: 100 },
      { key: 'bosses_defeated', label: 'Poražení bossové', max: 1000000 },
      { key: 'wins', label: 'Vyhrané zápasy', max: 1000000 },
      { key: 'best_tier', label: 'Nejvyšší stupeň třídy', max: 5 },
      { key: 'boss_kinds', label: 'Druhy poražených bossů', max: 12 },
      { key: 'classes_discovered', label: 'Objevené třídy', max: 540 },
      { key: 'best_wave', label: 'Nejvyšší vlna v Přežití', max: 1000 },
      { key: 'hill_wins', label: 'Výhry v Králi kopce', max: 1000000 },
      { key: 'royale_wins', label: 'Výhry v Posledním přeživším', max: 1000000 },
      { key: 'rush_wins', label: 'Výhry v Honu na bossy', max: 1000000 },
      { key: 'hell_best_level', label: 'Nejvyšší úroveň na Pekle', max: 100 },
      { key: 'modes_played', label: 'Vyzkoušené režimy', max: 8 },
    ],
  },
  {
    id: 'chess', title: 'Chess League', icon: Crown, headline: 'rating_peak',
    stats: [
      { key: 'rating_peak', label: 'Nejvyšší rating', max: 4000 },
      { key: 'wins_total', label: 'Výhry v hodnocených partiích', max: 1000000 },
      { key: 'expert_wins', label: 'Výhry nad Drakem', max: 1000000 },
      { key: 'bots_unlocked', label: 'Odemčení soupeři', max: 5 },
    ],
  },
  {
    id: 'koulovikamosi', title: 'Kouloví Kámoši', icon: Smile, headline: 'score_classic',
    stats: [
      { key: 'score_classic', label: 'Klasika (skóre)', max: 50000000 },
      { key: 'score_time', label: 'Časovka (skóre)', max: 50000000 },
      { key: 'score_drops', label: '30 hodů (skóre)', max: 50000000 },
      { key: 'score_chaos', label: 'Chaos (skóre)', max: 50000000 },
      { key: 'balls_discovered', label: 'Objevené koule', max: 12 },
    ],
  },
];

// Odznaky za hry dávají jen XP (ne mince) a dohromady málo: hry samy nedovedou nikoho na úroveň 5 (506 XP), ta zůstává za čtením.
export const GAME_BADGES = [
  { id: 'rocket_ace', game: 'rocket', stat: 'score_normal', threshold: 2500, xp: 10, title: 'Eso hvězd', description: 'Získej v Normální obtížnosti 2 500 bodů.' },
  { id: 'rocket_hell', game: 'rocket', stat: 'score_inferno', threshold: 1500, xp: 15, title: 'Pekelný pilot', description: 'Získej v Pekle 1 500 bodů.' },
  { id: 'rocket_insane', game: 'rocket', stat: 'score_insane', threshold: 1500, xp: 25, title: 'Šílenec', description: 'Získej v Insane Pekle 1 500 bodů.' },
  { id: 'rocket_nemesis', game: 'rocket', stat: 'boss_level', threshold: 8, xp: 15, title: 'Konec NEMESIS', description: 'Poraz osmého bosse (NEMESIS).' },
  { id: 'rocket_glitch', game: 'rocket', stat: 'boss_level', threshold: 14, xp: 25, title: 'Chyba v systému', description: 'Poraz čtrnáctého bosse (GLITCH).' },
  { id: 'rocket_ascend', game: 'rocket', stat: 'ascension', threshold: 1, xp: 10, title: 'Hvězdný vzestup', description: 'Dokonči první Vzestup.' },
  { id: 'rocket_hard', game: 'rocket', stat: 'score_hard', threshold: 2000, xp: 2, title: 'Těžká cesta', description: 'Získej v Těžké obtížnosti 2 000 bodů.' },
  { id: 'rocket_blitz', game: 'rocket', stat: 'score_blitz', threshold: 1500, xp: 2, title: 'Bleskový pilot', description: 'Získej v Bleskové vlně 1 500 bodů.' },
  { id: 'rocket_rush5', game: 'rocket', stat: 'rush_streak', threshold: 5, xp: 3, title: 'Nájezdník', description: 'V Boss Rush poraz 5 bossů v jedné sérii.' },
  { id: 'rocket_rush10', game: 'rocket', stat: 'rush_streak', threshold: 10, xp: 5, title: 'Legenda nájezdů', description: 'V Boss Rush poraz 10 bossů v jedné sérii.' },
  { id: 'chess_first', game: 'chess', stat: 'wins_total', threshold: 1, xp: 5, title: 'První výhra', description: 'Vyhraj hodnocenou partii.' },
  { id: 'chess_25', game: 'chess', stat: 'wins_total', threshold: 25, xp: 10, title: 'Stálý hráč', description: 'Vyhraj 25 hodnocených partií.' },
  { id: 'chess_dragon', game: 'chess', stat: 'expert_wins', threshold: 1, xp: 25, title: 'Přemožitel draka', description: 'Poraz Draka v hodnocené partii.' },
  { id: 'chess_r1000', game: 'chess', stat: 'rating_peak', threshold: 1000, xp: 10, title: 'Rating 1000', description: 'Dosáhni ratingu 1 000.' },
  { id: 'chess_r1300', game: 'chess', stat: 'rating_peak', threshold: 1300, xp: 20, title: 'Rating 1300', description: 'Dosáhni ratingu 1 300.' },
  { id: 'chess_10', game: 'chess', stat: 'wins_total', threshold: 10, xp: 2, title: 'Deset výher', description: 'Vyhraj 10 hodnocených partií.' },
  { id: 'chess_bots3', game: 'chess', stat: 'bots_unlocked', threshold: 3, xp: 2, title: 'Třetí soupeř', description: 'Odemkni třetího soupeře.' },
  { id: 'chess_bots5', game: 'chess', stat: 'bots_unlocked', threshold: 5, xp: 4, title: 'Všichni soupeři', description: 'Odemkni všech 5 soupeřů.' },
  { id: 'chess_expert5', game: 'chess', stat: 'expert_wins', threshold: 5, xp: 5, title: 'Postrach draků', description: 'Poraz Draka 5krát v hodnocené partii.' },
  { id: 'koulovi_3000', game: 'koulovikamosi', stat: 'score_classic', threshold: 3000, xp: 10, title: 'Měkká klasika', description: 'Získej v Klasice 3 000 bodů.' },
  { id: 'koulovi_big', game: 'koulovikamosi', stat: 'balls_discovered', threshold: 8, xp: 10, title: 'Velká koule', description: 'Objev 8 typů koulí.' },
  { id: 'koulovi_all', game: 'koulovikamosi', stat: 'balls_discovered', threshold: 12, xp: 25, title: 'Všichni kámoši', description: 'Objev všech 12 typů koulí.' },
  { id: 'koulovi_10k', game: 'koulovikamosi', stat: 'score_classic', threshold: 10000, xp: 5, title: 'Vysoká klasika', description: 'Získej v Klasice 10 000 bodů.' },
  { id: 'koulovi_time', game: 'koulovikamosi', stat: 'score_time', threshold: 1000, xp: 2, title: 'Rychlé koule', description: 'Získej v Časovce 1 000 bodů.' },
  { id: 'koulovi_drops', game: 'koulovikamosi', stat: 'score_drops', threshold: 500, xp: 2, title: 'Přesné hody', description: 'Získej ve hře 30 hodů 500 bodů.' },
  { id: 'koulovi_chaos', game: 'koulovikamosi', stat: 'score_chaos', threshold: 1500, xp: 3, title: 'Zvládnutý chaos', description: 'Získej v Chaosu 1 500 bodů.' },
  { id: 'polygon_lvl20', game: 'polygonarena', stat: 'best_level', threshold: 20, xp: 10, title: 'Veterán arény', description: 'Dosáhni úrovně 20.' },
  { id: 'polygon_lvl58', game: 'polygonarena', stat: 'best_level', threshold: 58, xp: 30, title: 'Legenda arény', description: 'Dosáhni maximální úrovně.' },
  { id: 'polygon_boss', game: 'polygonarena', stat: 'bosses_defeated', threshold: 1, xp: 10, title: 'Lovec bossů', description: 'Poraz bosse.' },
  { id: 'polygon_win', game: 'polygonarena', stat: 'wins', threshold: 1, xp: 10, title: 'Vítěz zápasu', description: 'Vyhraj zápas.' },
  { id: 'polygon_boss5', game: 'polygonarena', stat: 'bosses_defeated', threshold: 5, xp: 2, title: 'Zabiják titánů', description: 'Poraz 5 bossů.' },
  { id: 'polygon_bossall', game: 'polygonarena', stat: 'boss_kinds', threshold: 12, xp: 6, title: 'Sběratel trofejí', description: 'Poraz všech 12 druhů bossů.' },
  { id: 'polygon_tier4', game: 'polygonarena', stat: 'best_tier', threshold: 4, xp: 4, title: 'Vrchol vývoje', description: 'Dosáhni 4. stupně třídy.' },
  { id: 'polygon_tier5', game: 'polygonarena', stat: 'best_tier', threshold: 5, xp: 6, title: 'Vzestup třídy', description: 'Dosáhni 5. stupně třídy (Vzestup).' },
  { id: 'polygon_cdx40', game: 'polygonarena', stat: 'classes_discovered', threshold: 40, xp: 2, title: 'Znalec', description: 'Objev 40 tříd.' },
  { id: 'polygon_cdx150', game: 'polygonarena', stat: 'classes_discovered', threshold: 150, xp: 4, title: 'Archivář', description: 'Objev 150 tříd.' },
  { id: 'polygon_cdx400', game: 'polygonarena', stat: 'classes_discovered', threshold: 400, xp: 6, title: 'Encyklopedie', description: 'Objev 400 tříd.' },
  { id: 'polygon_wave10', game: 'polygonarena', stat: 'best_wave', threshold: 10, xp: 2, title: 'Desátá vlna', description: 'Zvládni 10 vln v režimu Přežití.' },
  { id: 'polygon_hill', game: 'polygonarena', stat: 'hill_wins', threshold: 1, xp: 2, title: 'Král kopce', description: 'Vyhraj zápas v režimu Král kopce.' },
  { id: 'polygon_royale', game: 'polygonarena', stat: 'royale_wins', threshold: 1, xp: 2, title: 'Poslední v bouři', description: 'Vyhraj režim Poslední přeživší.' },
  { id: 'polygon_rush', game: 'polygonarena', stat: 'rush_wins', threshold: 1, xp: 4, title: 'Přemožitel', description: 'Poraz všechny bossy v Honu na bossy.' },
  { id: 'polygon_hell', game: 'polygonarena', stat: 'hell_best_level', threshold: 25, xp: 4, title: 'Z pekla', description: 'Dosáhni úrovně 25 na obtížnosti Peklo.' },
  { id: 'polygon_allmodes', game: 'polygonarena', stat: 'modes_played', threshold: 8, xp: 3, title: 'Všechny režimy', description: 'Zahraj si všech 8 herních režimů.' },
  { id: 'city_prestige', game: 'cityclicker', stat: 'prestige_count', threshold: 1, xp: 15, title: 'Nový začátek', description: 'Proveď první prestiž.' },
  { id: 'city_prestige5', game: 'cityclicker', stat: 'prestige_count', threshold: 5, xp: 25, title: 'Zkušený starosta', description: 'Proveď 5 prestiží.' },
  { id: 'city_clicks', game: 'cityclicker', stat: 'total_clicks', threshold: 10000, xp: 10, title: 'Klikací mistr', description: 'Klikni 10 000krát.' },
  { id: 'city_clicks1k', game: 'cityclicker', stat: 'total_clicks', threshold: 1000, xp: 2, title: 'Rozcvička', description: 'Klikni 1 000krát.' },
  { id: 'city_prestige3', game: 'cityclicker', stat: 'prestige_count', threshold: 3, xp: 3, title: 'Stavitel měst', description: 'Proveď 3 prestiže.' },
  { id: 'city_prestige10', game: 'cityclicker', stat: 'prestige_count', threshold: 10, xp: 4, title: 'Mistr přestaveb', description: 'Proveď 10 prestiží.' },
  { id: 'city_clicks100k', game: 'cityclicker', stat: 'total_clicks', threshold: 100000, xp: 5, title: 'Klikací legenda', description: 'Klikni 100 000krát.' },
  { id: 'war_sector5', game: 'warroom', stat: 'best_sector', threshold: 5, xp: 10, title: 'Držíme linii', description: 'Dostaň se v kampani do 5. sektoru.' },
  { id: 'war_sector10', game: 'warroom', stat: 'best_sector', threshold: 10, xp: 15, title: 'Průlom', description: 'Dostaň se v kampani do 10. sektoru.' },
  { id: 'war_sector25', game: 'warroom', stat: 'best_sector', threshold: 25, xp: 25, title: 'Generál', description: 'Dostaň se v kampani do 25. sektoru.' },
  { id: 'war_scen4', game: 'warroom', stat: 'scenarios_unlocked', threshold: 4, xp: 2, title: 'Čtyři fronty', description: 'Odemkni 4 scénáře.' },
  { id: 'war_scen12', game: 'warroom', stat: 'scenarios_unlocked', threshold: 12, xp: 3, title: 'Půl světa', description: 'Odemkni 12 scénářů.' },
  { id: 'war_scen24', game: 'warroom', stat: 'scenarios_unlocked', threshold: 24, xp: 5, title: 'Všechny fronty', description: 'Odemkni všech 24 scénářů.' },
  { id: 'war_sector15', game: 'warroom', stat: 'best_sector', threshold: 15, xp: 4, title: 'Hluboký průlom', description: 'Dostaň se v kampani do 15. sektoru.' },
];

export const GAME_BADGES_TOTAL_XP = GAME_BADGES.reduce((sum, b) => sum + b.xp, 0);

const STAT_BY_GAME = new Map(GAME_CATALOG.map((g) => [g.id, new Map(g.stats.map((s) => [s.key, s]))]));
const BADGE_BY_ID = new Map(GAME_BADGES.map((b) => [b.id, b]));

export const getGame = (gameId) => GAME_CATALOG.find((g) => g.id === gameId) || null;
export const getStat = (gameId, key) => STAT_BY_GAME.get(gameId)?.get(key) || null;
export const getBadge = (id) => BADGE_BY_ID.get(id) || null;

// Hlášení z hry smí projít jen se známou statistikou, celým nezáporným číslem a hodnotou v mezích; jinak null.
export function normalizeRecord(gameId, key, value) {
  const stat = getStat(gameId, key);
  const n = typeof value === 'number' ? value : Number(value);
  if (!stat || !Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if (v < 1 || v > stat.max) return null;
  return { game: gameId, stat: key, value: v };
}

// XP z odznaků podle seznamu odemčených id (neznámé id se přeskočí, stejně jako sumBadgeXp u knižních odznaků).
export const sumGameBadgeXp = (ids) => (Array.isArray(ids) ? ids.reduce((sum, id) => sum + (BADGE_BY_ID.get(id)?.xp || 0), 0) : 0);
