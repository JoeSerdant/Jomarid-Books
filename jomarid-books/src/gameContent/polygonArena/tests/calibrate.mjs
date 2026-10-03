// Kalibrace vyváženosti generátoru tříd měřením: každý modul (a každý korunní modul) vytvoří potomky několika rodičů a ti
// bojují se svými rodiči (boti proti sobě, celá hra běží v Node bez prohlížeče). Cílem je, aby potomek vyhrával stejně
// často bez ohledu na modul. Výsledek ukazuje, které moduly jsou silnější / slabší, než čeká model síly v tankgen.js,
// a navrhne nové hodnoty tabulky FIX.
//
//   npm run polygon:calibrate                       # 24 rodičů na modul, 4 souboje, 4 vlákna
//   node src/gameContent/polygonArena/tests/calibrate.mjs 30 6 4 0.72 --write   # + zapíše upravené FIX do tankgen.js
//
// Argumenty: počet rodičů na modul, počet soubojů, vlákna, cílová výhra (výchozí 0.72), --write.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame } from './stub.mjs';
import { loadClasses } from './load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLOPE = 0.9;                 // o kolik vzroste výhra při dvojnásobném zranění (z měření: +10 % zranění ~ +9 % výher)

// Jeden souboj dvou tříd na zadané úrovni; vrací 'a' / 'b' / 't' (nerozhodně: rozhodne zdraví).
function duelCode(a, b, seed, level) {
  return `(() => {
    let s = ${seed * 2654435761 >>> 0}; Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = tanks.length - 1; i >= 0; i--) if (!tanks[i].isPlayer) tanks.splice(i, 1);
    bullets.length = 0; parts.length = 0; texts.length = 0; shapes.length = 0; world.pickups.length = 0; world.zones.length = 0; world.rings.length = 0;
    world.boss = null; world.bossT = 1e9; world.evT = 1e9; world.alphaT = 1e9; world.pickT = 1e9; world.over = false;
    mode = 'ffa'; diffKey = 'hard'; state = 'play';
    const mk = (cls, x, ang, name) => {
      const t = makeTank(false, name, '#ff6666', 0);
      t.x = x; t.y = HALF; t.angle = ang; t.vx = t.vy = 0; t.invuln = 0;
      t.cls = cls; t.level = ${level}; t.score = xpFor(${level}); t.stats = [0, 0, 0, 0, 0, 0, 0, 0]; t.points = ${level} - 1; t.tierDone = TIER_LEVELS.length; t.perkN = PERK_LEVELS.length;
      const n = CLASSES[cls].barrels.length; t.bt = new Array(n).fill(0); t.rec = new Array(n).fill(0); t.tur = new Array(n).fill(ang);
      t.ai.arch = 'balanced'; t.ai.w = ARCH.balanced.w; t.ai.aggr = 0.7; t.ai.courage = 0.5; t.ai.rammer = false;
      t.maxHp = 0; recalc(t); botUpgrade(t); t.hp = t.maxHp; t.name = name;
      return t;
    };
    const A = mk(${JSON.stringify(a)}, HALF - 260, 0, 'A'), B = mk(${JSON.stringify(b)}, HALF + 260, PI, 'B');
    let steps = 0; const MAX = 60 * 90;
    while (steps++ < MAX && A.alive && B.alive) update(STEP);
    const fa = A.alive ? A.hp / A.maxHp : 0, fb = B.alive ? B.hp / B.maxHp : 0;
    const win = fa > 0 && fb <= 0 ? 'a' : fb > 0 && fa <= 0 ? 'b' : fa > fb * 1.0001 ? 'a' : fb > fa * 1.0001 ? 'b' : 't';
    for (const t of [A, B]) { const i = tanks.indexOf(t); if (i >= 0) tanks.splice(i, 1); }
    bullets.length = 0;
    return win;
  })()`;
}

if (!isMainThread) {
  const g = loadGame({ seed: 1 });
  const out = [];
  let n = 0;
  for (const j of workerData.jobs) {
    const id = '__k' + (n++);
    g.run(`CLASSES[${JSON.stringify(id)}] = C(${j.kind === 'struct' ? `TANKGEN.make(${JSON.stringify(j.parent)}, ${JSON.stringify(j.k)}, '')` : `TANKGEN.makeCap(${JSON.stringify(j.parent)}, ${JSON.stringify(j.k)})`}); CLASSES[${JSON.stringify(id)}].hasTur = CLASSES[${JSON.stringify(id)}].barrels.some(b => b.turret);`);
    let w = 0;
    for (let t = 0; t < workerData.trials; t++) {
      const seed = 3000 + t * 13 + (j.i % 97);
      const r = t % 2 === 0 ? g.run(duelCode(id, j.parent, seed, 40)) : g.run(duelCode(j.parent, id, seed, 40));
      const mine = t % 2 === 0 ? 'a' : 'b';
      w += r === mine ? 1 : r === 't' ? 0.5 : 0;
    }
    out.push({ k: j.k, kind: j.kind, win: w / workerData.trials });
  }
  parentPort.postMessage(out);
} else {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const PARENTS = +(args[0] || 24), TRIALS = +(args[1] || 4), THREADS = +(args[2] || 4), TARGET = +(args[3] || 0.72), WRITE = process.argv.includes('--write');
  const get = loadClasses(), CLASSES = get('CLASSES'), TG = get('TANKGEN');
  const tier3 = Object.keys(CLASSES).filter((id) => !CLASSES[id].boss && CLASSES[id].tier === 3);
  const pickN = (arr, n, salt) => { const a = arr.slice(); let h = 0; for (const ch of salt) h = (h * 31 + ch.charCodeAt(0)) >>> 0; for (let i = a.length - 1; i > 0; i--) { h = (h * 1664525 + 1013904223) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
  const jobs = [];
  for (const k of TG.STRUCT) for (const p of pickN(tier3.filter((id) => k.ok(TG.profile(CLASSES[id]))), PARENTS, k.id)) jobs.push({ kind: 'struct', k: k.id, parent: p });
  for (const k of TG.CAPS) for (const p of pickN(tier3.filter((id) => k.ok(TG.profile(CLASSES[id]), { id: 'none' })), PARENTS, k.id)) jobs.push({ kind: 'cap', k: k.id, parent: p });
  jobs.forEach((j, i) => { j.i = i; });
  console.log(`${jobs.length} dvojic, ${TRIALS} souboje na dvojici, ${THREADS} vlákna (cíl: výhra potomka ${TARGET})\n`);
  const chunks = Array.from({ length: THREADS }, () => []);
  jobs.forEach((j, i) => chunks[i % THREADS].push(j));
  const t0 = Date.now();
  const results = (await Promise.all(chunks.filter((c) => c.length).map((c) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { jobs: c, trials: TRIALS } });
    w.on('message', resolve); w.on('error', reject);
  })))).flat();
  const per = {};
  for (const r of results) { const e = per[r.k] || (per[r.k] = { n: 0, w: 0 }); e.n++; e.w += r.win; }
  const cur = TG.FIX, next = {};
  console.log('modul'.padEnd(13) + 'n'.padStart(4) + '  výhra  FIX  ->  nový FIX');
  for (const [k, e] of Object.entries(per).sort((a, b) => a[1].w / a[1].n - b[1].w / b[1].n)) {
    const win = e.w / e.n, m = Math.max(0.6, Math.min(1.7, 1 + (TARGET - win) / SLOPE)), f0 = cur[k] || 1, f1 = f0 * Math.pow(m, 0.8);
    next[k] = f1;
    console.log(k.padEnd(13) + String(e.n).padStart(4) + '  ' + win.toFixed(2) + '   ' + f0.toFixed(3) + '  ->  ' + f1.toFixed(3));
  }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (WRITE) {
    const file = path.join(HERE, '..', 'tankgen.js');
    let s = fs.readFileSync(file, 'utf8');
    const a = s.indexOf('/*FIX*/'), b = s.indexOf('/*END*/');
    const body = Object.keys(next).sort().map((k) => `${k}: ${next[k].toFixed(3)}`).join(', ');
    s = s.slice(0, a) + '/*FIX*/\n    ' + body + ',\n    ' + s.slice(b);
    fs.writeFileSync(file, s);
    console.log('FIX zapsáno do tankgen.js - spusť měření znovu, dokud se hodnoty neustálí.');
  }
}
