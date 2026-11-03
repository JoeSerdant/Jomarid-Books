// Herní rekordy a odznaky: které výsledky hry hlásí, jak se jmenují, jaké jsou nejvyšší věrohodné hodnoty a jaké odznaky z nich vznikají.
// Stejný seznam je v db/game-records.sql (tam rozhoduje server); test src/tests/gameRecords.test.mjs hlídá, že si odpovídají.
// Hry samy nic nepočítají ani neudělují: hlásí jen aktuální hodnotu (jomaridRecord), server si pamatuje nejvyšší a odemyká odznaky.
import { Rocket, Swords, Building2, Target, Crown, Smile, Castle } from 'lucide-react';

import * as rocket from './defs/rocket.js';
import * as warroom from './defs/warroom.js';
import * as cityClicker from './defs/cityClicker.js';
import * as polygonArena from './defs/polygonArena.js';
import * as chess from './defs/chess.js';
import * as koulovi from './defs/koulovi.js';
import * as hannibal from './defs/hannibal.js';

// id her jsou stejná jako v Games.jsx a v mostu pro odměny; headline je statistika, podle které se řadí žebříček hry.
// Statistiky a odznaky každé hry jsou ve vlastním souboru ve složce defs (a každá hra je hlásí přes jomaridRecord).
const GAMES = [
  { id: 'rocket', title: 'Jomarid Rocket Game', icon: Rocket, headline: 'score_normal', defs: rocket },
  { id: 'warroom', title: 'Warroom: Frontlines', icon: Swords, headline: 'best_sector', defs: warroom },
  { id: 'cityclicker', title: 'City Clicker', icon: Building2, headline: 'prestige_count', defs: cityClicker },
  { id: 'polygonarena', title: 'Polygon aréna', icon: Target, headline: 'best_level', defs: polygonArena },
  { id: 'chess', title: 'Chess League', icon: Crown, headline: 'rating_peak', defs: chess },
  { id: 'koulovikamosi', title: 'Kouloví Kámoši', icon: Smile, headline: 'score_classic', defs: koulovi },
  { id: 'hannibal', title: 'Hannibal: Barca', icon: Castle, headline: 'endless_wave', defs: hannibal },
];

// Veřejný seznam statistik (ten se ukazuje ve Statistikách a Odznacích). Skryté statistiky (SECRET_STATS v defs) tu nejsou, viz níž.
export const GAME_CATALOG = GAMES.map(({ id, title, icon, headline, defs }) => ({ id, title, icon, headline, stats: defs.STATS }));

// Odznaky za hry dávají jen XP (ne mince). XP se bere z tabulky obtížnosti (defs/helpers.js): ve stejné statistice platí, že čím těžší odznak, tím víc XP.
// XP z her se do úrovně přičítá, ale odznaky za úroveň (a s nimi mince) se z něj nevyhodnocují.
//
// Skryté odznaky a statistiky (příběh v Rocketu) jsou vedle: server je zná stejně jako ostatní (db/game-records.sql je má v seznamu), appka je ale
// neukazuje, dokud je čtenář nezíská. ALL_* jsou veřejné a skryté dohromady (po hrách, veřejné první), GAME_BADGES a GAME_CATALOG jen veřejné.
export const ALL_GAME_BADGES = GAMES.flatMap(({ id, defs }) => [
  ...defs.BADGES.map((b) => ({ ...b, game: id })),
  ...(defs.SECRET_BADGES || []).map((b) => ({ ...b, game: id, secret: true })),
]);
export const ALL_GAME_STATS = GAMES.flatMap(({ id, defs }) => [
  ...defs.STATS.map((s) => ({ ...s, game: id })),
  ...(defs.SECRET_STATS || []).map((s) => ({ ...s, game: id, secret: true })),
]);
export const GAME_BADGES = ALL_GAME_BADGES.filter((b) => !b.secret);
export const SECRET_BADGES = ALL_GAME_BADGES.filter((b) => b.secret);

export const GAME_BADGES_TOTAL_XP = GAME_BADGES.reduce((sum, b) => sum + b.xp, 0);
export const ALL_GAME_BADGES_TOTAL_XP = ALL_GAME_BADGES.reduce((sum, b) => sum + b.xp, 0);

const STAT_BY_GAME = new Map(GAMES.map(({ id }) => [id, new Map(ALL_GAME_STATS.filter((s) => s.game === id).map((s) => [s.key, s]))]));
const BADGE_BY_ID = new Map(ALL_GAME_BADGES.map((b) => [b.id, b]));

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

// „X z Y“ pro čtenáře: skrytý odznak se do počtu (i do součtu XP) přičte, až ho čtenář má, jinak by číslo prozradilo, že nějaký je.
export function countGameBadges(unlockedIds) {
  const ids = new Set(Array.isArray(unlockedIds) ? unlockedIds : []);
  const secretOwned = SECRET_BADGES.filter((b) => ids.has(b.id));
  return {
    unlocked: GAME_BADGES.filter((b) => ids.has(b.id)).length + secretOwned.length,
    total: GAME_BADGES.length + secretOwned.length,
    totalXp: GAME_BADGES_TOTAL_XP + secretOwned.reduce((sum, b) => sum + b.xp, 0),
  };
}

// Odznaky hry, které se čtenáři ukazují: všechny veřejné a ze skrytých jen ty, které má.
export const visibleGameBadges = (gameId, unlockedIds) => {
  const ids = new Set(Array.isArray(unlockedIds) ? unlockedIds : []);
  return ALL_GAME_BADGES.filter((b) => b.game === gameId && (!b.secret || ids.has(b.id)));
};

// XP z odznaků podle seznamu odemčených id (neznámé id se přeskočí, stejně jako sumBadgeXp u knižních odznaků).
export const sumGameBadgeXp = (ids) => (Array.isArray(ids) ? ids.reduce((sum, id) => sum + (BADGE_BY_ID.get(id)?.xp || 0), 0) : 0);
