// Základ: pomocné funkce, uložený postup, motiv, konstanty, obtížnosti a statistiky tanku.
/* =====================================================================
   Polygon aréna – offline tanková hra s AI boty
   ===================================================================== */

/* ---------- utils ---------- */
const TAU = Math.PI * 2, PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; else if (d < -PI) d += TAU; return d; };
const $ = id => document.getElementById(id);
const elApp = $('app');            // třídy touch / offering se přepínají na kořenovém prvku (CSS je čeká na #app)
const evTarget = e => (e.composedPath && e.composedPath()[0]) || e.target;
function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const plBody = n => (n === 1 ? 'bod' : n >= 2 && n <= 4 ? 'body' : 'bodů');
const fmt = n => Math.round(n).toLocaleString('cs-CZ');
function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 0.75; } // ~ -1..1, zvonovitě

/* ---------- save ---------- */
const STORE_KEY = 'polygon-arena-v1';
const save = { best: 0, name: '', diff: 'normal', sound: false, mode: 'ffa', skin: 'teal', set: {}, codex: {}, ach: {}, st: {} };
try { const raw = localStorage.getItem(STORE_KEY); if (raw) Object.assign(save, JSON.parse(raw)); } catch (e) { /* storage nemusí být dostupné */ }
save.set = Object.assign({ vib: true, lefty: false, ctl: 1, fx: 1 }, save.set || {});
save.st = Object.assign({ games: 0, kills: 0, deaths: 0, shapes: 0, bosses: 0, secs: 0, bestLevel: 1, wins: 0, perks: 0, crystals: 0, bossKinds: {}, mapsSeen: {}, modesPlayed: {}, bestWave: 0, survWins: 0, hillWins: 0, royaleWins: 0, rushWins: 0, rushBest: 0, bestGold: 0, goldWins: 0 }, save.st || {});
save.st.bossKinds = save.st.bossKinds || {}; save.st.mapsSeen = save.st.mapsSeen || {}; save.st.modesPlayed = save.st.modesPlayed || {};
save.codex = save.codex || {}; save.ach = save.ach || {};
function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }

/* ---------- theme (čte CSS tokeny) ---------- */
const theme = { bg: '#08131a', arena: '#0e1f27', grid: '#16303a', ink: '#e7f2f3', barrel: '#8ea0aa', barrelStroke: '#4a5a63', accent: '#5fe0d4' };
function readTheme() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const g = (n, d) => ((cs.getPropertyValue(n) || '').trim() || d);
    theme.bg = g('--bg', theme.bg); theme.arena = g('--arena', theme.arena); theme.grid = g('--grid', theme.grid);
    theme.ink = g('--ink', theme.ink); theme.barrel = g('--barrel', theme.barrel);
    theme.barrelStroke = g('--barrelStroke', theme.barrelStroke); theme.accent = g('--accent', theme.accent);
  } catch (e) { /* ponech výchozí */ }
}

const shadeCache = new Map();
function shade(hex, f) {
  const key = hex + f; let c = shadeCache.get(key); if (c) return c;
  const n = parseInt(hex.slice(1), 16);
  c = `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
  shadeCache.set(key, c); return c;
}

/* ---------- konstanty ---------- */
const WORLD = 3600, HALF = WORLD / 2;
const STEP = 1 / 60;
const MAX_LEVEL = 58;
const STAT_MAX = 7, STAT_CAP = 12, OD_EFF = 0.55;   // nad STAT_MAX = „nadlimit“ (slabší přírůstek)
const BONUS_XP = 2500;                               // po max. úrovni: každých 2500 skóre = 1 bod
const TIER_LEVELS = [7, 16, 26, 36, 48];
const eff = v => (v <= STAT_MAX ? v : STAT_MAX + (v - STAT_MAX) * OD_EFF);
const BULLET_LIFE = 1.1;
const SHAPE_TARGET = 250;
const PLAYER_COLOR = '#5fd6cc';
const BOT_COLORS = ['#ef7b6b', '#f2b84b', '#b08cf2', '#f28cb8', '#6aa9f2', '#9adb6a', '#f29b5c', '#8be0c0', '#d6c26a', '#c98cf2', '#7fd0f2', '#e07f9f'];
const NAMES = ['Kulička', 'Šiška', 'Rychlík', 'Bořek', 'Pepa', 'Ninja', 'Robot', 'Wafle', 'Dezolát', 'Žralok', 'Hroch', 'Vlk', 'Kobliha', 'Blesk', 'Dýně', 'Mates', 'Lenka', 'Kuba', 'Zeus', 'Cyklop', 'Mlha', 'Brouk', 'Tygr', 'Rampouch', 'Kaktus', 'Pirát', 'Nuget', 'Sokol', 'Fantom', 'Kakao', 'Ježek', 'Mrkev'];

const DIFFS = {
  // botDmg/shapeDmg = kolik zranění hráč dostává, playerHp/playerRegen = bonusy hráči, xpMul/botXp = rychlost růstu,
  // keep/keepLvl = co si bot ponechá po respawnu, mercy = do jaké úrovně hráče boti nelovní, hunt = dosah lovu, inv = ochrana po spawnu,
  // smart = jak rozumně boti volí třídy a výhody (0 = skoro náhodně), focus = jak moc se boti zaměřují na hráče, start = počáteční úroveň botů
  easy:   { bots: 6,  noise: 0.34, turn: 3.2, think: 0.5,  dodge: 0.0, lead: 0.15, aggr: 0.45, botDmg: 0.4,  shapeDmg: 0.45, playerHp: 1.8,  playerRegen: 2.2, xpMul: 1.3, botXp: 0.45, keep: 0.1,  keepLvl: 6,  mercy: 6, hunt: 0.5,  inv: 7,  bossHp: 0.5, bossT1: 150, bossT: 240, goal: 25, evGap: 60, smart: 0,   focus: 0,   start: 1 },
  normal: { bots: 11, noise: 0.13, turn: 7.0, think: 0.27, dodge: 0.5, lead: 0.75, aggr: 0.9,  botDmg: 0.8,  shapeDmg: 0.8,  playerHp: 1.25, playerRegen: 1.3, xpMul: 1.2, botXp: 0.8,  keep: 0.22, keepLvl: 10, mercy: 3, hunt: 0.85, inv: 4,  bossHp: 0.8, bossT1: 110, bossT: 190, goal: 32, evGap: 75, smart: 0.5, focus: 0,   start: 1 },
  hard:   { bots: 16, noise: 0.05, turn: 11,  think: 0.17, dodge: 1.0, lead: 1.0,  aggr: 1.2,  botDmg: 1,    shapeDmg: 1,    playerHp: 1,    playerRegen: 1,   xpMul: 1,   botXp: 1,    keep: 0.3,  keepLvl: 14, mercy: 0, hunt: 1,    inv: 3,  bossHp: 1,   bossT1: 90,  bossT: 150, goal: 40, evGap: 80, smart: 1,   focus: 0,   start: 1 },
  hell:   { bots: 22, noise: 0.04,  turn: 15, think: 0.11, dodge: 1.25, lead: 1.0, aggr: 1.6,  botDmg: 1.1,  shapeDmg: 1.2,  playerHp: 0.85, playerRegen: 0.8, xpMul: 0.8, botXp: 1.3,  keep: 0.45, keepLvl: 24, mercy: 0, hunt: 1.25, inv: 3,   bossHp: 1.8, bossT1: 60,  bossT: 100, goal: 50, evGap: 70, smart: 1.6, focus: 0.4, start: 2 },
};

/* ---------- statistiky ---------- */
const STATS = [
  { name: 'Regenerace', color: '#f08fb4' },
  { name: 'Zdraví', color: '#f0a35e' },
  { name: 'Náraz', color: '#b58cf0' },
  { name: 'Rychlost střel', color: '#6fa7f2' },
  { name: 'Průraznost', color: '#f2d24b' },
  { name: 'Síla střel', color: '#f2695f' },
  { name: 'Nabíjení', color: '#7ad86b' },
  { name: 'Pohyb', color: '#5fd9d0' },
];
