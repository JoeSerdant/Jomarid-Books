// Která ze dvou verzí postupu hry je pokročilejší? Rozhoduje se, když se hrálo offline a mezitím se postup změnil i na serveru (hrálo se jinde).
// Hry samy žádné číslo „pokroku“ nehlásí, takže se bere z uloženého postupu: nejdřív čítače, které jen rostou (čas hraní, počet her,
// celkový výdělek), a když je shoda nebo hra žádný známý čítač nemá, obecný součet toho, co se v postupu hromadí (úrovně, odemčené věci, rekordy).
// Je to odhad, ne přesná věda: při nerozhodnosti vyhrává postup na serveru a druhý se uloží jako záloha, takže se nic nenávratně neztratí.

// Čítače, které jen rostou, podle hry: { klíč v uloženém postupu: [cesta v JSON, ...] }. První cesta, ve které se postupy liší, rozhoduje.
export const PRIORITY_PATHS = Object.freeze({
  rocket: { space_shooter_v2_9: ['stats.totalPlaytime', 'stats.runsPlayed', 'stats.totalKills', 'ascension'] },
  cityclicker: { cityClickerSaveV1: ['totalPlaytimeSeconds', 'lifetimeEarnings', 'totalClicks', 'prestigeCount'] },
  chess: { 'chessLeague.save.v1': ['ratedGames', 'peak', 'unlockedIndex'] },
  koulovikamosi: { 'koulovi-kamosi-v1': ['games', 'merges', 'best'] },
});

// Měny (mince, zlato, rozpočet) se do obecného součtu záměrně nepočítají: utrácením klesají, a kdo víc utratil, nemusí být míň daleko.
// Klíče, které jsou jen nastavení (zvuk, návod): do pokroku se nepočítají.
const SETTINGS_KEYS = new Set(['warroom_muted', 'warroom_tutorial_done']);

const MONOTONE_NAME = /(level|lvl|xp|best|total|max|peak|wave|score|stage|rank|elo|wins|win|unlock|star|prestige|campaign|chapter|mission|kills|record|rating|upgrade|tier|lifetime|playtime|games|merges|disc|phase|count|streak|asc)/i;
const MONOTONE_LIST = /(achiev|relic|unlocked|completed|owned|discovered|codex|ach$|roster|doctrines|nodes)/i;
const FLAG_NAME = /(unlocked|completed|done|owned|bought|built|discovered)/i;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const log = (n) => Math.log2(1 + Math.max(0, Number(n) || 0));

const parse = (text) => { try { return JSON.parse(text); } catch { return undefined; } };

const getPath = (obj, path) => path.split('.').reduce((o, k) => (isObject(o) ? o[k] : undefined), obj);

// Obecný součet toho, co v postupu roste. Čísla se berou logaritmem, ať jediný obrovský čítač nepřehluší všechno ostatní.
export function genericScore(value, key = '', depth = 0) {
  if (depth > 8) return 0;
  if (typeof value === 'number') return Number.isFinite(value) && MONOTONE_NAME.test(key) ? log(value) : 0;
  if (typeof value === 'boolean') return value && FLAG_NAME.test(key) ? 1 : 0;
  if (Array.isArray(value)) return MONOTONE_LIST.test(key) ? log(value.length) + value.length * 0.01 : 0;
  if (isObject(value)) {
    const entries = Object.entries(value);
    let sum = MONOTONE_LIST.test(key) ? log(entries.length) + entries.length * 0.01 : 0;
    for (const [k, v] of entries) sum += genericScore(v, k, depth + 1);
    return sum;
  }
  return 0;
}

// Čísla, podle kterých se postupy porovnávají (od nejdůležitějšího): hodnoty čítačů dané hry a nakonec obecný součet.
export function progressTuple(gameId, map) {
  const hints = PRIORITY_PATHS[gameId] || {};
  const tuple = [];
  for (const [key, paths] of Object.entries(hints)) {
    const parsed = parse(map?.[key]);
    for (const p of paths) {
      const n = Number(getPath(parsed, p));
      tuple.push(Number.isFinite(n) ? n : 0);
    }
  }
  let generic = 0;
  for (const [key, text] of Object.entries(map || {})) {
    if (SETTINGS_KEYS.has(key) || typeof text !== 'string') continue;
    const parsed = parse(text);
    if (parsed !== undefined) generic += genericScore(parsed);
  }
  tuple.push(generic);
  return tuple;
}

// > 0: a je pokročilejší, < 0: b je pokročilejší, 0: nelze rozlišit.
export function compareProgress(gameId, a, b) {
  const ta = progressTuple(gameId, a);
  const tb = progressTuple(gameId, b);
  for (let i = 0; i < ta.length; i += 1) {
    const d = ta[i] - tb[i];
    if (Math.abs(d) > 1e-9) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Stejný postup (po klíčích a textech)?
export function sameMap(a, b) {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] === a[k]);
}
