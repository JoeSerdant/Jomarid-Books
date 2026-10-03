// Stav hry: prostorová mřížka, svět, výpočet statistik, výběr tříd a zkušenosti.
/* ---------- prostorová mřížka ---------- */
class Grid {
  constructor(cell) {
    this.cell = cell; this.n = Math.ceil(WORLD / cell) + 1;
    this.cells = Array.from({ length: this.n * this.n }, () => []);
  }
  clear() { const c = this.cells; for (let i = 0; i < c.length; i++) c[i].length = 0; }
  add(e) {
    const n = this.n;
    const cx = clamp((e.x / this.cell) | 0, 0, n - 1), cy = clamp((e.y / this.cell) | 0, 0, n - 1);
    this.cells[cy * n + cx].push(e);
  }
  near(x, y, r, out) {
    out.length = 0; const c = this.cell, n = this.n;
    const x0 = clamp(((x - r) / c) | 0, 0, n - 1), x1 = clamp(((x + r) / c) | 0, 0, n - 1);
    const y0 = clamp(((y - r) / c) | 0, 0, n - 1), y1 = clamp(((y + r) / c) | 0, 0, n - 1);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const cell = this.cells[cy * n + cx];
      for (let i = 0; i < cell.length; i++) out.push(cell[i]);
    }
    return out;
  }
}
const gBody = new Grid(200), gBul = new Grid(160);

/* ---------- stav světa ---------- */
const tanks = [], shapes = [], bullets = [], parts = [], texts = [];
let nextId = 1, time = 0, state = 'menu', paused = false, diffKey = 'normal', builtDiff = null, builtMode = null;
let player = null;
const cam = { x: HALF, y: HALF, z: 1 };
const view = { w: 800, h: 600, dpr: 1, scale: 1 };
const ui = { vig: 0, statsDirty: true, offerKey: '', lbT: 0, deadT: 0, spec: null, specT: 0, miniT: 0, statsOpen: false, perkDirty: true, perkKey: '', bannerT: 0, achT: 1 };
const deathInfo = { by: '', level: 1, score: 0, kills: 0, time: 0 };
let mode = 'ffa', shake = 0;
const world = { zones: [], pickups: [], rings: [], pickT: 0, bossT: 90, evT: 60, alphaT: 80, boss: null, bossN: 0, teamScore: [0, 0, 0], over: false, winner: 0, matchT: 0, mapName: '' };
const TEAM_COLORS = ['', '#4da3ff', '#ff6b5e'];

/* ---------- výpočet odvozených statistik ---------- */
const _e = new Array(8).fill(0);
const PK0 = { dmg: 1, tank: 1, shape: 1, spd: 1, rel: 1, rng: 1, bspd: 1, hp: 1, regen: 1, ram: 1, bhp: 1, crit: 0, vamp: 0, blast: 0, bounce: 0, slow: 0, knock: 1, minion: 1, xp: 1, sxp: 1, dashCd: 1, magnet: 0, shield: 0, adren: 0, greed: 0 };
function calcPerks(t) {
  const pk = t.pk || (t.pk = {}); Object.assign(pk, PK0); const P = t.perks || {};
  if (P.vamp) pk.vamp = 0.12; if (P.armor) pk.bhp = 1.7; if (P.bounce) pk.bounce = 2; if (P.explode) pk.blast = 1; if (P.crit) pk.crit = 0.18;
  if (P.thorn) pk.ram = 1.8; if (P.shield) pk.shield = 0.3; if (P.tough) { pk.hp = 1.3; pk.spd *= 0.94; } if (P.swift) pk.spd *= 1.14; if (P.rapid) pk.rel = 0.86;
  if (P.far) { pk.rng = 1.3; pk.bspd = 1.1; } if (P.hunter) pk.tank = 1.25; if (P.farmer) { pk.shape = 1.4; pk.sxp = 1.2; } if (P.adren) pk.adren = 1; if (P.greed) pk.greed = 1;
  if (P.regen) pk.regen = 2.2; if (P.magnet) pk.magnet = 1; if (P.dashp) pk.dashCd = 0.55; if (P.slow) pk.slow = 0.35; if (P.minion) pk.minion = 1.5; if (P.knock) pk.knock = 2.4; if (P.scholar) pk.xp = 1.15;
  return pk;
}
function recalc(t) {
  const st = t.stats, L = t.level, cls = CLASSES[t.cls], D = DIFFS[diffKey], me = t.isPlayer;
  for (let i = 0; i < 8; i++) _e[i] = eff(st[i]);
  const s = _e, old = t.maxHp || 0, pk = calcPerks(t);
  t.r = 24 * (1 + 0.011 * (L - 1)) * cls.size;
  t.maxHp = (60 + 3.2 * (L - 1) + 26 * s[1]) * cls.hp * (t.boss ? D.bossHp * (world.bossMul || 1) : 1) * (me ? D.playerHp : 1) * pk.hp;
  t.hp = old > 0 ? Math.min(t.maxHp, t.hp + (t.maxHp - old)) : t.maxHp;
  t.regenPct = (0.010 + 0.006 * s[0]) * (me ? D.playerRegen : 1) * pk.regen * cls.regen;
  t.ramDps = (12 + 7 * s[2]) * cls.ram * pk.ram;
  t.ramLoss = 8 + 3 * s[2];
  t.bulletSpeed = (520 + 62 * s[3]) * pk.bspd;
  t.bulletHp = (5 + 6 * s[4]) * pk.bhp * cls.bhp;
  t.vamp = Math.max(pk.vamp, cls.vamp || 0);
  t.bulletDmg = 6 + 3.3 * s[5];
  t.reload = 0.55 * Math.pow(0.86, s[6]) * cls.reload * pk.rel;
  t.speed = 235 * (1 + 0.075 * s[7]) * Math.pow(0.9935, L - 1) * cls.speed * pk.spd;
  t.zoomT = cls.zoom * (1 - 0.0045 * (L - 1));
}

function offerOf(t) {
  return t.tierDone < TIER_LEVELS.length && t.level >= TIER_LEVELS[t.tierDone] && TREE[t.cls] ? TREE[t.cls] : null;
}
function chooseClass(t, id) {
  const cls = CLASSES[id]; if (!cls) return;
  t.cls = id; t.tierDone++;
  t.bt = new Array(cls.barrels.length).fill(0); t.rec = new Array(cls.barrels.length).fill(0); t.tur = new Array(cls.barrels.length).fill(t.angle || 0);
  for (const b of bullets) if ((b.drone || b.trap) && b.owner === t) b.dead = true;
  recalc(t);
  if (t.isPlayer) { ui.statsDirty = true; beep('level'); }
}
function buyStat(t, i) {
  if (!t.alive || t.points <= 0 || t.stats[i] >= STAT_CAP) return false;
  t.stats[i]++; t.points--; recalc(t);
  if (t.isPlayer) { ui.statsDirty = true; beep('click'); }
  return true;
}
function addScore(t, amt) {
  t.score += amt;
  const L = levelFor(t.score, t.level);
  if (L > t.level) {
    t.points += L - t.level; t.level = L; recalc(t);
    if (t.isPlayer) { floatText(t.x, t.y - t.r - 26, 'Úroveň ' + L, theme.accent); beep('level'); buzz(30); ui.statsDirty = true; ringFx(t.x, t.y, t.r, t.r * 3.6, 0.6, theme.accent, false); sparks(t.x, t.y, theme.accent, 14, 240); }
  }
  if (t.level >= MAX_LEVEL) {          // po dosažení maxima dál přibývají bonusové body
    const n = Math.floor((t.score - xpFor(MAX_LEVEL)) / BONUS_XP);
    if (n > t.bonusN) {
      t.points += n - t.bonusN; t.bonusN = n;
      if (t.isPlayer) { floatText(t.x, t.y - t.r - 26, '+1 bod', theme.accent); beep('level'); ui.statsDirty = true; }
    }
  }
}
