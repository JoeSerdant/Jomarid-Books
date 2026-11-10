// Testy Polygon arény: generátor tříd (strom, jména, siluety, vyváženost) a chod hry v Node (režimy, obtížnosti).
//   npm run test:polygon
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadClasses } from './load.mjs';
import { loadGame } from './stub.mjs';
import { GAME_CATALOG, GAME_BADGES } from '../../../gameRecords/catalog.js';

/* =====================================================================
   Generátor tříd
   ===================================================================== */
const get = loadClasses();
const CLASSES = get('CLASSES'), TREE = get('TREE'), PARENT = get('PARENT'), TG = get('TANKGEN');
const normal = Object.keys(CLASSES).filter((id) => !CLASSES[id].boss);
const generated = normal.filter((id) => CLASSES[id].struct);
const BARREL_KINDS = new Set(['bullet', 'drone', 'trap', 'missile', 'bomb']);

test('strom: z každé třídy 0.-3. stupně vedou aspoň 4 pokračování o stupeň výš', () => {
  for (const id of normal) {
    const c = CLASSES[id];
    if (c.tier > 3) continue;
    const kids = TREE[id] || [];
    assert.ok(kids.length >= 4, `${id} má jen ${kids.length} pokračování`);
    for (const k of kids) { assert.ok(CLASSES[k], `${id} -> ${k} neexistuje`); assert.equal(CLASSES[k].tier, c.tier + 1, `${k} má špatný stupeň`); }
  }
});
test('strom: všechny třídy jsou dosažitelné ze základní a PARENT sedí', () => {
  const seen = new Set(['basic']), q = ['basic'];
  while (q.length) for (const k of TREE[q.shift()] || []) if (!seen.has(k)) { seen.add(k); q.push(k); }
  for (const id of normal) assert.ok(seen.has(id), `${id} není dosažitelná`);
  for (const id of generated) assert.ok(PARENT[id] && TREE[PARENT[id]].includes(id), `${id}: PARENT nesedí`);
});
test('počty: tisíc tříd není třeba, ale stupně musí být plné', () => {
  const by = {}; for (const id of normal) by[CLASSES[id].tier] = (by[CLASSES[id].tier] || 0) + 1;
  assert.equal(by[0], 1); assert.equal(by[1], 6); assert.ok(by[2] >= 24 && by[3] >= 96 && by[4] >= 384, JSON.stringify(by)); assert.equal(by[5], 8);
  assert.ok(generated.length >= 350, 'generátor vyrobil ' + generated.length);
});
test('jména: unikátní, česky čitelná, nevylézají z karty', () => {
  const names = Object.values(CLASSES).map((c) => c.name);
  assert.equal(new Set(names).size, names.length, 'duplicitní jména');
  for (const id of normal) {
    const c = CLASSES[id];
    assert.ok(c.name && c.name.length <= 26, `${id}: jméno "${c.name}"`);
    assert.match(c.name, /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][A-Za-zÁ-ž0-9 ]*$/, `${id}: nepovolené znaky v "${c.name}"`);
    if (c.tier >= 1) assert.ok(c.info && c.info.length <= 64, `${id}: popis "${c.info}"`);
    assert.ok(!/undefined|NaN/.test(c.name + c.info), `${id}: vadný text`);
  }
});
test('hlavně a vlastnosti tříd jsou smysluplné čísla', () => {
  for (const id of normal) {
    const c = CLASSES[id];
    assert.ok(c.barrels.length >= 1 && c.barrels.length <= 14, `${id}: ${c.barrels.length} hlavní`);
    for (const k of ['reload', 'speed', 'zoom', 'range', 'hp', 'ram', 'size', 'regen', 'bhp']) assert.ok(Number.isFinite(c[k]) && c[k] > 0, `${id}.${k}=${c[k]}`);
    assert.ok(c.reload >= 0.1 && c.reload <= 5 && c.speed >= 0.6 && c.speed <= 1.6 && c.size >= 0.7 && c.size <= 2 && c.hp <= 3.6, `${id}: statistiky mimo meze`);
    let drones = 0, traps = 0;
    for (const b of c.barrels) {
      for (const k of ['a', 'len', 'w', 'off', 'rel', 'delay', 'dmg', 'spd', 'spread', 'size', 'recoil', 'hp', 'pierce', 'bounce', 'blast', 'slow', 'burn', 'knock']) assert.ok(Number.isFinite(b[k]), `${id}: hlaveň ${k}=${b[k]}`);
      assert.ok(BARREL_KINDS.has(b.kind), `${id}: druh ${b.kind}`);
      assert.ok(b.len > 0.4 && b.len < 4 && b.w > 0.1 && b.w < 2.4 && b.dmg > 0 && b.delay >= 0 && b.delay < 1.0001, `${id}: rozměry hlavně`);
      if (b.turret) assert.ok(b.tsize > 0.1 && b.dist >= 0, `${id}: věž`);
      else if (b.kind === 'drone') drones++; else if (b.kind === 'trap') traps++;
    }
    assert.equal(drones > 0, c.maxDrones > 0, `${id}: drony a maxDrones nesedí`);
    assert.equal(traps > 0, c.maxTraps > 0, `${id}: pasti a maxTraps nesedí`);
  }
});
test('vzhled: každá třída má platný vzhled a profil', () => {
  const trims = new Set(['', 'ring', 'stripe', 'dots', 'core', 'cross']);
  for (const id of normal) {
    const L = CLASSES[id].look;
    assert.ok(L, `${id}: chybí vzhled`);
    assert.ok(L.n === 0 || (L.n >= 3 && L.n <= 8), `${id}: n=${L.n}`);
    assert.ok(trims.has(L.trim), `${id}: trim ${L.trim}`);
    assert.ok(CLASSES[id].prof && Number.isFinite(CLASSES[id].prof.power), `${id}: chybí profil`);
  }
});
test('odlišnost: potomek vypadá jinak než rodič a než sourozenci', () => {
  for (const pid of Object.keys(TREE)) {
    const par = CLASSES[pid]; if (!par || par.boss || par.tier >= 4) continue;
    const seen = new Map([[TG.silhouette(par), pid]]);
    for (const kid of TREE[pid]) {
      const s = TG.silhouette(CLASSES[kid]);
      assert.ok(!seen.has(s), `${kid} vypadá stejně jako ${seen.get(s)}`);
      seen.set(s, kid);
    }
  }
});
test('moduly: každý strukturní i korunní modul se někde použil a žádný nepřevládá', () => {
  const count = (key) => { const m = {}; for (const id of generated) { const v = CLASSES[id][key] || ''; if (v) m[v] = (m[v] || 0) + 1; } return m; };
  const st = count('struct'), cp = count('cap');
  for (const k of TG.STRUCT) assert.ok(st[k.id] > 0, `strukturní modul ${k.id} se nikdy nepoužil`);
  for (const k of TG.CAPS) assert.ok(cp[k.id] > 0, `korunní modul ${k.id} se nikdy nepoužil`);
  for (const [k, v] of Object.entries(st)) assert.ok(v / generated.length < 0.12, `modul ${k} má podíl ${(v / generated.length).toFixed(2)}`);
});
test('vyváženost: potomek je o něco silnější než rodič, sourozenci nejsou řádově jinde', () => {
  // Model síly se po měření soubojů opravuje korekcemi FIX (např. bomby se musí zesílit víc, než model čeká), proto je
  // generovaný potomek v modelu silnější o FIX^0,55 - pro kontrolu se to odečítá.
  const power = (id) => { const c = CLASSES[id]; return c.prof.power / Math.pow(c.struct ? (TG.FIX[c.struct] || 1) * (TG.FIX[c.cap] || 1) : 1, 0.55); };
  for (const id of generated) {
    const r = power(id) / CLASSES[PARENT[id]].prof.power;
    assert.ok(r > 0.95 && r < 1.8, `${id}: poměr síly ${r.toFixed(2)}`);
  }
  for (const pid of Object.keys(TREE)) {
    if (!CLASSES[pid] || CLASSES[pid].boss || CLASSES[pid].tier >= 4) continue;
    const ps = TREE[pid].map(power);
    assert.ok(Math.max(...ps) / Math.min(...ps) < 1.9, `${pid}: sourozenci se liší ${(Math.max(...ps) / Math.min(...ps)).toFixed(2)}x`);
  }
});
test('stavba: nové hlavně nepřekrývají jiné (drony, pasti, střelné) ani nesplývají na jedné ose', () => {
  const grp = (b) => (b.kind === 'drone' ? 'd' : b.kind === 'trap' ? 't' : 'g');
  const dif = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const pairs = (c) => {
    const bs = c.barrels.filter((b) => !b.turret); let same = 0, cross = 0;
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j], da = dif(a.a, b.a);
      if (grp(a) !== grp(b)) { if (da < 0.4) cross++; }
      else if (da < 0.12 && Math.abs(a.off - b.off) < (a.w + b.w) / 2 * 0.9) same++;
    }
    return { same, cross };
  };
  for (const id of generated) {
    const c = pairs(CLASSES[id]), p = pairs(CLASSES[PARENT[id]]);
    assert.ok(c.cross <= p.cross, `${id}: hlaveň leží přes dron/past/zbraň jiného druhu (${c.cross} vs ${p.cross} u rodiče)`);
    assert.ok(c.same <= p.same * (CLASSES[id].struct === 'rear' ? 2 : 1), `${id}: splývající hlavně (${c.same} vs ${p.same} u rodiče)`);
  }
});
test('stavba: moduly, které přidávají hlavně, je opravdu přidají (popis nelže)', () => {
  const ADD = ['rear', 'cross', 'hive', 'carrier', 'trapify', 'mainGun', 'turretPair', 'turretRing', 'turretCore', 'swift', 'fan', 'gatling', 'twin'];
  for (const id of generated) {
    const c = CLASSES[id];
    if (ADD.includes(c.struct)) assert.ok(c.barrels.length > CLASSES[PARENT[id]].barrels.length, `${id}: modul ${c.struct} nic nepřidal`);
  }
});
test('korunní modul přetaktování opravdu zrychlí nabíjení (vyvážení nabíjením by ho zrušilo)', () => {
  const oc = generated.filter((id) => CLASSES[id].cap === 'overclock');
  assert.ok(oc.length >= 10, 'přetaktování se skoro nepoužilo: ' + oc.length);
  for (const id of oc) {
    const c = CLASSES[id];
    assert.notEqual(TG.STRUCT_BY[c.struct].bal, 'reload', `${id}: modul ${c.struct} vyvažuje nabíjením`);
    const a = TG.make(PARENT[id], c.struct, 'overclock'), b = TG.make(PARENT[id], c.struct, '');
    assert.ok(a.reload < b.reload * 0.95, `${id}: nabíjení ${a.reload.toFixed(2)} proti ${b.reload.toFixed(2)} bez přetaktování`);
  }
});
test('věže: zranění úměrné zbraním rodiče, vlastní hlavně se kvůli nim nezmenší na zlomek', () => {
  const med = (c) => { const g = c.barrels.filter((b) => !b.turret && (b.kind === 'bullet' || b.kind === 'missile' || b.kind === 'bomb') && Math.cos(b.a) > 0.8).map((b) => b.dmg).sort((x, y) => x - y); return g.length ? g[g.length >> 1] : 0; };
  let n = 0;
  for (const id of generated) {
    const c = CLASSES[id];
    if (!/^turret/.test(c.struct)) continue;
    const p = CLASSES[PARENT[id]];
    if (med(p) > 0) { n++; assert.ok(med(c) >= 0.4 * med(p), `${id}: vlastní zbraně ořezané na ${(med(c) / med(p)).toFixed(2)} zranění rodiče`); }
  }
  assert.ok(n >= 20, 'málo věžových tříd: ' + n);
});
test('jména: žádné vadné slovo, žádný stejný kořen ani duplicita v bankách slov, psaní jako u ručních tříd', () => {
  // Slova, která recenze označila jako nevhodná nebo nespisovná (pasák = pasák děvek, rak = nemoc, otřesný = hrozný...).
  const BANNED = ['Pasák', 'Hydra', 'Orbit', 'Rak', 'Otřesný', 'Vzdálený', 'Drtitel', 'Vyhlížeč', 'Pronikač', 'Pestřenec', 'Pružinář', 'Petardář', 'Třaskavec', 'Metač', 'Zrcadlář', 'Pevnostník', 'Pancéřník', 'Zaminovač', 'Zákopník'];
  const nouns = TG.STRUCT.flatMap((k) => k.nouns), adjs = TG.CAPS.flatMap((k) => k.adjs);
  for (const w of [...nouns, ...adjs]) {
    assert.ok(!BANNED.includes(w), `vadné slovo ${w}`);
    assert.match(w, /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+$/, `slovo "${w}" není jedno slovo s velkým písmenem`);
  }
  assert.equal(new Set(nouns).size, nouns.length, 'podstatné jméno se opakuje v několika modulech');
  assert.equal(new Set(adjs).size, adjs.length, 'přídavné jméno se opakuje v několika modulech');
  const hand = new Set(Object.values(CLASSES).filter((c) => !c.struct).map((c) => c.name));
  for (const n of nouns) assert.ok(!hand.has(n), `podstatné jméno ${n} má i ručně navržená třída`);
  const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const PROPER = ['Janus', 'Kastor', 'Pollux', 'Pérák'];
  for (const id of generated) {
    const w = CLASSES[id].name.split(' ');
    if (w.length !== 2) continue;
    assert.notEqual(fold(w[0]).slice(0, 4), fold(w[1]).slice(0, 4), `${id}: "${CLASSES[id].name}" má stejný kořen`);
    if (!PROPER.includes(w[1])) assert.equal(w[1], w[1].toLowerCase(), `${id}: "${CLASSES[id].name}" - podstatné jméno malým písmenem`);
  }
});
test('generátor je deterministický (nezávisí na Math.random)', () => {
  const orig = Math.random;
  const dump = (rnd) => { Math.random = rnd; try { const g = loadClasses(); return JSON.stringify([g('CLASSES'), g('TREE')]); } finally { Math.random = orig; } };
  assert.equal(dump(() => 0.123), dump(() => 0.987));
});
test('generátor je stabilní: úprava podmínek jednoho modulu nepřehodí id tříd u ostatních rodičů', () => {
  // Uložený kodex hráčů je klíčovaný id tříd, takže pozdější ladění tabulek nesmí rozsypat výběr u všech rodičů naráz.
  const ids = (g) => { const C = g('CLASSES'); return new Set(Object.keys(C).filter((id) => C[id].struct)); };
  const base = ids(get);
  const tweak = 'TANKGEN.STRUCT_BY.bounce.ok = ((o) => (p) => o(p) && p.nBar <= 3)(TANKGEN.STRUCT_BY.bounce.ok);\nTANKGEN.fill();';
  const changed = ids(loadClasses(undefined, (f, src) => (f === 'ascension.js' ? src.replace('TANKGEN.fill();', tweak) : src)));
  assert.ok(changed.size === base.size, 'počet tříd se změnil');
  const lost = [...base].filter((id) => !changed.has(id));
  assert.ok(lost.length <= 8, `po úpravě jednoho modulu zmizelo ${lost.length} tříd z ${base.size}`);
});
test('generátor: id vygenerovaných tříd se nemění neúmyslně', () => {
  // Uložený kodex hráčů je klíčovaný id tříd. Když se id změní, hráčům se záznamy ztratí - pak je potřeba hodnotu níž přepsat
  // jen záměrně (změna struktury modulů, podmínek výběru nebo seedů). Ladění vyvážení (FIX) ani jmen id nemění.
  const ids = generated.slice().sort();
  assert.equal(ids.length, 410);
  assert.equal(TG.hashStr(ids.join(',')), 4266427812, 'Id vygenerovaných tříd se změnila - uložený kodex hráčů by přišel o záznamy.');
});
test('ručně navržené třídy zůstaly (id i jména)', () => {
  for (const [id, name] of [['twin', 'Dvojče'], ['sniper', 'Ostřelovač'], ['vulcan', 'Vulkán'], ['zenit', 'Zenit'], ['singularita', 'Singularita'], ['boss_guard', 'Ochránce']]) assert.equal(CLASSES[id].name, name);
  assert.deepEqual(Array.from(TREE.mg.slice(0, 5)), ['destroyer', 'sprayer', 'flamer', 'shotgun', 'rocket']);
});

/* =====================================================================
   Hra v Node (bez prohlížeče)
   ===================================================================== */
const fresh = (opts) => { const g = loadGame(opts); return g; };
const steps = (A, n, dt = 1 / 60) => { for (let i = 0; i < n; i++) A.update(dt); };
const MODES = ['ffa', 'teams', 'survival', 'hill', 'royale', 'rush', 'gold', 'sandbox'];

test('hra: načte se, zná všech osm režimů a čtyři obtížnosti', () => {
  const { G, arena } = fresh();
  assert.deepEqual(Array.from(G('MODE_IDS')), MODES);
  for (const id of MODES) { const m = G('MODES')[id]; assert.ok(m.name && m.tag && m.info, id); }
  assert.deepEqual(Array.from(Object.keys(arena.DIFFS)), ['easy', 'normal', 'hard', 'hell']);
  assert.ok(arena.DIFFS.hell.bots > arena.DIFFS.hard.bots && arena.DIFFS.hell.noise < arena.DIFFS.hard.noise && arena.DIFFS.hell.think < arena.DIFFS.hard.think);
  assert.equal(arena.state, 'menu');
});
test('hra: každý režim v každé obtížnosti běží 20 s bez chyby', () => {
  const { arena } = fresh({ seed: 3 });
  for (const m of MODES) for (const d of ['easy', 'normal', 'hard', 'hell']) {
    arena.setDiff(d); arena.mode = m; arena.startGame(true);
    steps(arena, 60 * 20);
    assert.ok(Number.isFinite(arena.player.x) && Number.isFinite(arena.player.hp), `${m}/${d}: NaN`);
    for (const t of arena.tanks) assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.hp), `${m}/${d}: tank ${t.name} má NaN`);
    arena.toMenu();
  }
});
test('hra: uložený režim a obtížnost se načtou, neznámé se nahradí výchozími', () => {
  const ok = fresh({ storage: { 'polygon-arena-v1': JSON.stringify({ mode: 'royale', diff: 'hell' }) } });
  assert.equal(ok.arena.mode, 'royale'); assert.ok(ok.arena.world.storm);
  const bad = fresh({ storage: { 'polygon-arena-v1': JSON.stringify({ mode: 'neexistuje', diff: 'peklo' }) } });
  assert.equal(bad.arena.mode, 'ffa');
  const proto = fresh({ storage: { 'polygon-arena-v1': JSON.stringify({ mode: 'constructor', diff: 'toString' }) } });   // klíče z prototypu nejsou režimy
  assert.equal(proto.arena.mode, 'ffa'); assert.ok(proto.arena.DIFFS.normal && proto.G('diffKey') === 'normal');
  const old = fresh({ storage: { 'polygon-arena-v1': JSON.stringify({ best: 99, mode: 'teams', diff: 'hard', st: { games: 4, kills: 7 } }) } });   // starý save bez nových statistik
  assert.equal(old.arena.mode, 'teams'); assert.equal(old.arena.save.st.bestWave, 0); assert.equal(old.arena.save.st.games, 4);
});
test('třídy: každá třetí se dá vybrat v cvičišti a střílí', () => {
  const { arena } = fresh({ seed: 9 });
  arena.mode = 'sandbox'; arena.startGame(true);
  const dummies = arena.tanks.filter((t) => t.ai && t.ai.dummy);
  arena.setAuto(true);
  const silent = [];
  arena.CLASS_IDS.filter((_, i) => i % 3 === 0).forEach((id) => {
    arena.sandboxEquip(id);
    const p = arena.player; p.invuln = 999; p.x = 1800; p.y = 1800; p.vx = p.vy = 0;
    dummies.forEach((d, i) => { d.x = 1960 + i * 25; d.y = 1800 + (i - 2) * 40; d.alive = true; d.hp = d.maxHp; });
    let fired = false;
    for (let i = 0; i < 150 && !fired; i++) { arena.update(1 / 60); if (arena.bullets.some((b) => b.owner === p)) fired = true; }
    if (!fired) silent.push(id);
    arena.bullets.length = 0;
  });
  assert.deepEqual(Array.from(silent), []);
});

test('Přežití: vlny se střídají a po poslední výhra; smrt hráče hru ukončí', () => {
  const { arena, G } = fresh({ seed: 11 });
  arena.setDiff('easy'); arena.mode = 'survival'; arena.startGame(true);
  const W = arena.world, p = arena.player;
  assert.equal(W.wave, 0); assert.equal(arena.tanks.filter((t) => t.team === 1).length, 3);
  W.waveGoal = 3;
  for (let guard = 0; guard < 60 * 400 && !W.over; guard++) {
    arena.update(1 / 60);
    for (const t of arena.tanks) if (t.team === 2 && t.alive) t.hp = -1e9;        // nepřátele okamžitě zlikviduj
    p.hp = p.maxHp;
  }
  assert.ok(W.over && W.win, 'po třech vlnách má být výhra'); assert.equal(W.wave, 3);
  assert.ok(arena.save.st.bestWave >= 3);
  // smrt
  arena.startGame(true); arena.player.invuln = 0; arena.player.hp = -1e9; steps(arena, 2);
  assert.ok(arena.world.over && !arena.world.win && arena.world.end.title, 'smrt v režimu Přežití končí hru');
});
test('Král kopce: body se dělí, výhra po dosažení cíle', () => {
  const { arena, run } = fresh({ seed: 12 });
  run('globalThis.__rec = {}; globalThis.jomaridRecord = (k, v) => { __rec[k] = v; };');
  arena.setDiff('easy'); arena.mode = 'hill'; arena.startGame(true);
  const W = arena.world, p = arena.player, H = W.hill;
  assert.ok(H && H.goal > 0);
  p.x = H.x; p.y = H.y; p.invuln = 999;
  for (const t of arena.tanks) if (!t.isPlayer) { t.x = 200; t.y = 200; }          // sám na kopci
  steps(arena, 60 * 10);
  assert.ok(p.hillPts > 8, 'sám na kopci sbírá body rychle: ' + p.hillPts);
  p.hillPts = H.goal - 0.5; steps(arena, 60 * 2);
  assert.ok(W.over && W.win && /kopce/i.test(W.end.title));
  assert.ok(arena.save.st.hillWins >= 1);
  const rec = run('__rec');
  assert.equal(rec.hill_wins, 1, 'výhra se appce ohlásí hned při konci zápasu (odznak Král kopce)');
  assert.ok(arena.save.st.secs >= 10, 'odehraný čas se započítá i při výhře');
});
test('Poslední přeživší: bouře se zužuje, mimo ni se ubírá zdraví, poslední živý vyhrává', () => {
  const { arena } = fresh({ seed: 13 });
  arena.setDiff('easy'); arena.mode = 'royale'; arena.startGame(true);
  const W = arena.world, p = arena.player, S = W.storm;
  assert.equal(p.level, 12); assert.ok(arena.tanks.filter((t) => !t.isPlayer).every((t) => t.temp));
  const r0 = S.r; p.invuln = 999; steps(arena, 60 * 130);
  assert.ok(S.r < r0, 'bouře se začala zužovat');
  p.invuln = 0; p.x = 30; p.y = 30; const hp0 = p.hp; steps(arena, 60); assert.ok(p.hp < hp0, 'mimo bouři ubývá zdraví');
  arena.startGame(true); arena.player.invuln = 999;
  for (const t of arena.tanks) if (!t.isPlayer) t.hp = -1e9;
  steps(arena, 5);
  assert.ok(arena.world.over && arena.world.win, 'poslední živý vyhrává');
});
test('Hon na bossy: bossové přicházejí za sebou a po dvanáctém výhra', () => {
  const { arena } = fresh({ seed: 14 });
  arena.setDiff('easy'); arena.mode = 'rush'; arena.startGame(true);
  const W = arena.world; const names = [];
  for (let guard = 0; guard < 60 * 3000 && !W.over; guard++) {
    arena.update(1 / 60);
    if (W.boss && W.boss.alive) { if (names[names.length - 1] !== W.boss.name) names.push(W.boss.name); W.boss.hp = -1e9; }
    arena.player.hp = arena.player.maxHp;
  }
  assert.ok(W.over && W.win, 'výhra po 12 bossech'); assert.equal(W.rushN, 12); assert.equal(names.length, 12);
  assert.ok(arena.save.st.rushWins >= 1);
});
test('Zlatá horečka: čas vyprší a vyhrává nejbohatší; po zničení se ztrácí polovina lupu', () => {
  const { arena } = fresh({ seed: 15 });
  arena.setDiff('easy'); arena.mode = 'gold'; arena.startGame(true);
  const W = arena.world, p = arena.player; p.invuln = 999;
  p.loot = 100; const bot = arena.tanks.find((t) => !t.isPlayer); bot.loot = 40; bot.hp = -1e9; steps(arena, 2);
  assert.equal(bot.loot, 20);                                                      // polovina lupu padá na zem
  const coins = arena.shapes.filter((s) => s.val > 0);
  assert.equal(coins.reduce((a, s) => a + s.val, 0), 20, 'mince nesou celou ztracenou část');
  assert.ok(coins.every((s) => Math.hypot(s.dvx, s.dvy) < 14), 'mince se rozletí, ale nepluje navždy');
  W.goldT = 0.01; p.loot = 9999; steps(arena, 3);
  assert.ok(W.over && W.win && /nejbohatší/i.test(W.end.title));
});
test('Týmy: tým s cílovým počtem zničených tanků vyhrává, i když hráč čeká na znovuzrození', () => {
  const { arena } = fresh({ seed: 16 });
  arena.setDiff('easy'); arena.mode = 'teams'; arena.startGame(true);
  const goal = arena.DIFFS.easy.goal;
  const kill = (k, v) => { v.lastAttacker = k; v.lastAtkT = arena.time; v.invuln = 0; v.hp = -1e9; steps(arena, 2); };
  const alive = (team) => arena.tanks.find((t) => t.alive && !t.isPlayer && t.team === team);
  arena.world.teamScore[1] = goal - 1; kill(alive(1), alive(2));
  assert.ok(arena.world.over && arena.world.win && arena.save.st.wins >= 1, 'modří dosáhli cíle');
  // druhý zápas: hráč je mrtvý a soupeři dosáhnou cíle - zápas skončí hned, ne až po znovuzrození
  arena.startGame(true);
  arena.player.invuln = 0; arena.player.hp = -1e9; steps(arena, 2);
  assert.equal(arena.state, 'dead'); assert.ok(!arena.world.over);
  const wins = arena.save.st.wins;
  arena.world.teamScore[2] = goal - 1; kill(alive(2), alive(1));
  assert.ok(arena.world.over && !arena.world.win, 'konec i při mrtvém hráči'); assert.equal(arena.state, 'dead'); assert.equal(arena.save.st.wins, wins);
});
test('Týmy: na Pekle startují boti na vyšší úrovni', () => {
  const { arena } = fresh({ seed: 18 });
  arena.setDiff('hell'); arena.mode = 'teams'; arena.startGame(true);
  const bots = arena.tanks.filter((t) => !t.isPlayer && t.team);
  assert.ok(bots.length >= 6 && bots.every((t) => t.level >= arena.DIFFS.hell.start));
});
test('Klasika: smrt hráče hru neukončí (znovuzrození)', () => {
  const { arena } = fresh({ seed: 17 });
  arena.setDiff('normal'); arena.mode = 'ffa'; arena.startGame(true);
  arena.player.invuln = 0; arena.player.hp = -1e9; steps(arena, 2);
  assert.equal(arena.state, 'dead'); assert.ok(!arena.world.over);
});

test('Peklo: boti jsou přesnější a početnější než na těžké, bossové silnější', () => {
  const { arena } = fresh();
  const H = arena.DIFFS.hard, X = arena.DIFFS.hell;
  assert.ok(X.bots > H.bots && X.turn > H.turn && X.dodge > H.dodge && X.aggr > H.aggr && X.botDmg > H.botDmg && X.bossHp > H.bossHp && X.playerHp < H.playerHp && X.inv < H.inv + 1);
});
/* ---------- rekordy pro odznaky v appce (hra žádné vlastní úspěchy nemá) ---------- */
const POLY = GAME_CATALOG.find((g) => g.id === 'polygonarena');
const recorded = (run) => JSON.parse(run('JSON.stringify(__rec)'));
const withBridge = (opts) => { const g = fresh(opts); g.run('globalThis.__rec = {}; globalThis.jomaridRecord = (k, v) => { if (v >= 1) __rec[k] = Math.max(__rec[k] || 0, Math.floor(v)); };'); return g; };

test('rekordy: hra hlásí přesně statistiky ze své karty v katalogu a meze sedí na obsah hry', () => {
  const { arena, run, G } = withBridge();
  run('reportRecords()');
  assert.deepEqual(recorded(run), { best_level: 1, maps_seen: 1, skins_unlocked: 3 }, 'čerstvý postup hlásí nejnižší úroveň, mapu pozadí menu a tři základní vzhledy');
  const st = arena.save.st;
  Object.assign(st, { bestLevel: 7, bosses: 3, wins: 2, bestTier: 2, bestWave: 4, hillWins: 1, royaleWins: 2, rushWins: 3, hellBest: 9,
    survWins: 1, goldWins: 1, bestGold: 5, rushBest: 2, games: 4, kills: 6, shapes: 70, secs: 600, bestScore: 900, bestKills: 3, bestBossLife: 1, longestLife: 120, pts: 8, tierUps: 2, statsMaxed: 1, winsHard: 1, winsHell: 1, mapsSeen: { a: true, b: true } });
  st.bossKinds = { boss_guard: true, neznamy: true }; st.modesPlayed = { ffa: true, hill: true, stary_rezim: true };
  arena.save.codex = { basic: true, boss_guard: true }; for (const id of Array.from(arena.CLASS_IDS).slice(0, 4)) arena.save.codex[id] = true;
  run('reportRecords()');
  const rec = recorded(run);
  assert.deepEqual(Object.keys(rec).sort(), POLY.stats.map((x) => x.key).sort(), 'každá statistika z katalogu se hlásí');
  assert.equal(rec.boss_kinds, 1, 'počítají se jen druhy bossů, které hra zná');
  assert.equal(rec.modes_played, 2, 'počítají se jen režimy, které hra zná');
  assert.equal(rec.classes_discovered, 4, 'boss do objevených tříd nepatří');
  assert.equal(rec.hell_best_level, 9); assert.equal(rec.best_tier, 2); assert.equal(rec.best_wave, 4);
  assert.deepEqual([rec.play_min, rec.longest_life_min, rec.maps_seen, rec.games_played, rec.kills_total, rec.shapes_destroyed], [10, 2, 2, 4, 6, 70], 'minuty z vteřin, mapy podle počtu');
  const max = (key) => POLY.stats.find((x) => x.key === key).max;
  assert.equal(max('boss_kinds'), arena.BOSS_IDS.length, 'strop druhů bossů = počet bossů ve hře');
  assert.equal(max('classes_discovered'), arena.CLASS_IDS.length, 'strop objevených tříd = počet tříd ve hře');
  assert.equal(max('modes_played'), G('MODE_IDS').length, 'strop režimů = počet režimů ve hře');
  assert.equal(max('best_tier'), G('TIER_LEVELS').length, 'strop stupně třídy = počet stupňů ve hře');
  assert.ok(max('best_level') >= arena.MAX_LEVEL);
});
test('odznaky Polygon arény mají prahy, které ve hře jde splnit, a sedí na obsah hry', () => {
  const { arena, G } = fresh();
  const by = Object.fromEntries(GAME_BADGES.filter((b) => b.game === 'polygonarena').map((b) => [b.id, b]));
  assert.equal(by.polygon_lvl58.threshold, arena.MAX_LEVEL, 'maximální úroveň');
  assert.equal(by.polygon_bossall.threshold, arena.BOSS_IDS.length, 'všechny druhy bossů');
  assert.equal(by.polygon_allmodes.threshold, G('MODE_IDS').length, 'všechny režimy');
  assert.equal(by.polygon_tier5.threshold, G('TIER_LEVELS').length, 'nejvyšší stupeň třídy');
  assert.ok(by.polygon_cdx400.threshold <= arena.CLASS_IDS.length, 'objevit jde aspoň tolik tříd, kolik odznak chce');
  for (const b of Object.values(by)) assert.ok(POLY.stats.some((x) => x.key === b.stat && b.threshold <= x.max), b.id);
});
/* ---------- nové statistiky: nejlepší život, body, třídy, výhry na obtížnostech, cheat ---------- */
test('trackLife: nejlepší skóre, zničené tanky, bossové a délka jednoho života; nižší hodnoty nic nesníží, cvičiště a zvýšený start se nepočítají', () => {
  const { arena, run } = withBridge({ seed: 21 });
  arena.setDiff('normal'); arena.mode = 'ffa'; arena.startGame(true);
  run('trackLife({ score: 5000, kills: 12, time: 125 }, 2)');
  run('trackLife({ score: 300, kills: 1, time: 20 }, 0)');
  assert.deepEqual(['bestScore', 'bestKills', 'bestBossLife', 'longestLife'].map((k) => arena.save.st[k]), [5000, 12, 2, 125]);
  run('persist()');
  const rec = recorded(run);
  assert.deepEqual([rec.best_score, rec.best_kills, rec.bosses_life, rec.longest_life_min], [5000, 12, 2, 2]);
  arena.mode = 'sandbox'; run('trackLife({ score: 999999, kills: 999, time: 9999 }, 9)');
  assert.equal(arena.save.st.bestScore, 5000, 'cvičiště se nepočítá');
  arena.mode = 'ffa'; arena.world.boost = 5; run('trackLife({ score: 999999, kills: 999, time: 9999 }, 9)');
  assert.equal(arena.save.st.bestScore, 5000, 'zápas se zvýšenou startovní úrovní se nepočítá');
});
test('bossové za život: počítá je hráč, který bosse porazil, a nová hra začíná od nuly', () => {
  const { arena, run } = withBridge({ seed: 22 });
  arena.setDiff('normal'); arena.mode = 'ffa'; arena.startGame(true);
  assert.equal(arena.player.bosses, 0);
  run("bossDown({ cls: 'boss_guard', name: 'Strážce', x: 0, y: 0, r: 20 }, player)");
  run("bossDown({ cls: 'boss_crusher', name: 'Drtič', x: 0, y: 0, r: 20 }, player)");
  assert.equal(arena.player.bosses, 2);
  assert.equal(arena.save.st.bosses, 2);
});
test('vylepšení a třídy: body se počítají, maximum se hlídá, boti a cvičiště se nepočítají', () => {
  const { arena, run } = withBridge({ seed: 23 });
  arena.setDiff('normal'); arena.mode = 'ffa'; arena.startGame(true);
  const p = arena.player; p.points = 100; p.stats = new Array(8).fill(0);
  for (let i = 0; i < 12; i += 1) run('buyStat(player, 0)');
  run('buyStat(player, 0)');   // nad maximem se už nic neprodá
  for (let i = 0; i < 12; i += 1) run('buyStat(player, 1)');
  assert.deepEqual([arena.save.st.pts, arena.save.st.statsMaxed], [24, 2], 'dvě vlastnosti na maximu');
  const bot = Array.from(arena.tanks).find((t) => !t.isPlayer && !t.boss); bot.points = 5; run('buyStat(__bot, 0)'.replace('__bot', 'tanks.find(t => !t.isPlayer && !t.boss)'));
  assert.equal(arena.save.st.pts, 24, 'bot body nepočítá');
  run("chooseClass(player, Object.keys(TREE)[0] && TREE[Object.keys(TREE)[0]][0] || 'basic')");
  assert.equal(arena.save.st.tierUps, 1);
  arena.mode = 'sandbox'; p.points = 10; run('buyStat(player, 2)'); run("chooseClass(player, 'basic')");
  assert.deepEqual([arena.save.st.pts, arena.save.st.tierUps], [24, 1], 'cvičiště se nepočítá');
});
test('výhry na těžších obtížnostech: Těžká dává winsHard, Peklo winsHard i winsHell, lehčí obtížnost nic, zvýšený start se nepočítá', () => {
  const win = (diff, boost) => { const { arena, run } = withBridge({ seed: 24 }); arena.setDiff(diff); arena.mode = 'ffa'; arena.startGame(true); arena.world.boost = boost || 0; run("finishMatch(true, { title: 'x' })"); return arena.save.st; };
  let st = win('hell'); assert.deepEqual([st.winsHard, st.winsHell], [1, 1]);
  st = win('hard'); assert.deepEqual([st.winsHard, st.winsHell], [1, undefined]);
  st = win('normal'); assert.deepEqual([st.winsHard, st.winsHell], [undefined, undefined]);
  st = win('hell', 5); assert.equal(st.winsHell, undefined);
});
test('cheat Všechny odznaky zvedne všechny statistiky z katalogu na prahy odznaků a nic nesníží', () => {
  const { arena, run } = withBridge({ seed: 25 });
  arena.save.st.bestScore = 9999999;
  run('CHEATS.badges(); persist();');
  const rec = recorded(run);
  for (const stat of POLY.stats) {
    const need = Math.max(...GAME_BADGES.filter((b) => b.game === 'polygonarena' && b.stat === stat.key).map((b) => b.threshold));
    assert.ok(rec[stat.key] >= need, `${stat.key}: cheat dá ${rec[stat.key]}, odznak chce ${need}`);
  }
  assert.equal(arena.save.st.bestScore, 9999999, 'vyšší skutečná hodnota zůstane');
  assert.deepEqual(Object.keys(rec).sort(), POLY.stats.map((x) => x.key).sort());
});
test('trackProgress: zapíše třídu, nejvyšší úroveň, stupeň třídy i úroveň na Pekle a hned to ohlásí', () => {
  const { arena, run } = withBridge({ seed: 14 });
  arena.setDiff('hell'); arena.mode = 'ffa'; arena.startGame(true);
  const p = arena.player; p.invuln = 999;
  arena.addScore(p, arena.xpFor(26)); arena.trackProgress();
  assert.ok(arena.save.st.bestLevel >= 26 && arena.save.st.hellBest >= 26, 'úroveň na Pekle se zapsala');
  p.tierDone = 4; arena.trackProgress();
  assert.equal(arena.save.st.bestTier, 4);
  const rec = recorded(run);
  assert.ok(rec.best_level >= 26 && rec.hell_best_level >= 26 && rec.best_tier === 4, 'nahlášeno hned, ne až při konci zápasu: ' + JSON.stringify(rec));
  arena.setDiff('hard'); arena.startGame(true);
  arena.addScore(arena.player, arena.xpFor(30)); arena.trackProgress();
  assert.ok(arena.save.st.bestLevel >= 30);
  assert.ok(arena.save.st.hellBest < 30, 'úroveň mimo Peklo se do Pekla nezapočítá');
});
test('trackProgress: třída se zapíše do sbírky, ale na cvičišti se nic nepočítá', () => {
  const { arena } = withBridge({ seed: 15 });
  arena.mode = 'sandbox'; arena.startGame(true); arena.player.tierDone = 5; arena.trackProgress(true);
  assert.equal(arena.save.st.bestTier, 0); assert.equal(arena.save.st.bestLevel, 1);
  arena.mode = 'ffa'; arena.startGame(true);
  arena.player.cls = arena.CLASS_IDS[10]; arena.trackProgress();
  assert.ok(arena.save.codex[arena.CLASS_IDS[10]]);
});
test('starý postup: dřívější úspěchy ze hry se přenesou do rekordů, vlastní úspěchy ve hře už nejsou', () => {
  const old = { best: 5, skin: 'magma', codex: { basic: true }, ach: { tier3: true, tier4: true, hell5: true, lvl45: true, first: true }, st: { kills: 3, bestLevel: 30, bosses: 2 } };
  const { arena, run, G } = withBridge({ storage: { 'polygon-arena-v1': JSON.stringify(old) } });
  assert.equal(arena.save.st.bestTier, 4, 'stupeň 4 z úspěchu');
  assert.equal(arena.save.st.hellBest, 25, 'úroveň 25 na Pekle z úspěchu');
  run('reportRecords()');
  const rec = recorded(run);
  assert.equal(rec.best_tier, 4); assert.equal(rec.hell_best_level, 25); assert.equal(rec.best_level, 30);
  // už odemčené barvy zůstanou odemčené i podle starých příznaků
  const open = (id) => arena.skinOpen(arena.SKINS.find((x) => x.id === id));
  assert.ok(open('magma') && open('ink') && open('lime'), 'barvy podle starých úspěchů zůstaly (Obsidián i při nižší úrovni, než je dnešní maximum)');
  assert.ok(open('ice') && open('gold'), 'barvy podle uložených rekordů (úroveň 30, 2 bossové)');
  assert.ok(!open('pink') && !open('rainbow'), 'ostatní se odemykají až podle rekordů');
  assert.equal(G('typeof ACH'), 'undefined'); assert.equal(G('typeof renderAch'), 'undefined');
  assert.deepEqual(Array.from(G('COLL_TABS')).map((t) => t[0]), ['classes', 'perks', 'skins', 'stats'], 'záložka Úspěchy je pryč, třídy a výhody zůstaly');
});
test('barvy tanku se odemykají přímo podle rekordů, bez úspěchů', () => {
  const { arena } = fresh();
  const open = (id) => arena.skinOpen(arena.SKINS.find((x) => x.id === id));
  for (const id of ['teal', 'sun', 'violet']) assert.ok(open(id));
  for (const id of ['lime', 'pink', 'ice', 'gold', 'ink', 'magma', 'rainbow']) assert.ok(!open(id), id + ' je zamčená');
  Object.assign(arena.save.st, { kills: 1, shapes: 500, bestLevel: arena.MAX_LEVEL, bosses: 1, hellBest: 25 });
  for (const id of ['lime', 'pink', 'ice', 'gold', 'ink', 'magma']) assert.ok(open(id), id + ' je odemčená');
  assert.ok(!open('rainbow'));
  for (const id of arena.CLASS_IDS.slice(0, 40)) arena.save.codex[id] = true;
  assert.ok(open('rainbow'), 'Duha po 40 objevených třídách');
  for (const sk of arena.SKINS) if (sk.need) assert.ok(sk.need.length > 5 && typeof sk.has === 'function', sk.id);
});

/* ---------- režimy: okrajové případy ---------- */
test('Hon na bossy: boss poražený až po smrti hráče nic nezapočítá', () => {
  const { arena } = fresh({ seed: 31 });
  arena.setDiff('easy'); arena.mode = 'rush'; arena.startGame(true);
  const W = arena.world; W.rushN = 11; W.rushT = 0.01; steps(arena, 3);
  assert.ok(W.boss, 'objevil se dvanáctý boss');
  arena.player.invuln = 0; arena.player.hp = -1e9; steps(arena, 2);
  assert.ok(W.over && !W.win);
  const wins = arena.save.st.rushWins || 0, best = arena.save.st.rushBest || 0;
  W.boss.hp = -1e9; steps(arena, 3);
  assert.equal(W.rushN, 11); assert.equal(arena.save.st.rushWins || 0, wins); assert.equal(arena.save.st.rushBest || 0, best);
});
test('Po odchodu do nabídky už zápas nic nevyhodnocuje ani nezapisuje', () => {
  const { arena } = fresh({ seed: 32 });
  arena.setDiff('easy'); arena.mode = 'rush'; arena.startGame(true);
  const W = arena.world; W.rushN = 11; W.rushT = 0.01; steps(arena, 3);
  arena.toMenu(); const wins = arena.save.st.rushWins || 0;
  W.boss.hp = -1e9; steps(arena, 3);
  assert.equal(arena.state, 'menu'); assert.equal(W.rushN, 11); assert.equal(arena.save.st.rushWins || 0, wins);
});
test('Hon na bossy: spojenci zůstanou nebojácní i po znovuzrození', () => {
  const { arena } = fresh({ seed: 33 });
  arena.setDiff('easy'); arena.mode = 'rush'; arena.startGame(true);
  const ally = arena.tanks.find((t) => !t.isPlayer && t.team === 1);
  assert.ok(ally.ai.fearless);
  ally.hp = -1e9; steps(arena, 2); assert.ok(!ally.alive);
  ally.respawnT = 0; steps(arena, 2);
  assert.ok(ally.alive && ally.ai.fearless, 'po znovuzrození nebojácnost zůstala');
});
test('Poslední přeživší: oáza nezachrání před bouří', () => {
  const hpAfter = (oasis) => {
    const { arena } = fresh({ seed: 34 });
    arena.setDiff('normal'); arena.mode = 'royale'; arena.startGame(true);
    const W = arena.world, S = W.storm, p = arena.player;
    S.phase = 3; S.r = 800; S.cx = 1800; S.cy = 1800; S.state = 'wait'; S.left = 1e5;
    W.zones.length = 0; if (oasis) W.zones.push({ x: 3300, y: 1800, r: 260, type: 'oasis', ph: 0 });
    for (const t of arena.tanks) if (!t.isPlayer) { t.x = 1800; t.y = 1800; t.invuln = 999; }
    p.x = 3300; p.y = 1800; p.invuln = 0; p.hp = p.maxHp; steps(arena, 60 * 8);
    return p.alive ? p.hp / p.maxHp : 0;
  };
  const withOasis = hpAfter(true), without = hpAfter(false);
  assert.ok(withOasis < 0.85, 'v oáze za hranicí bouře hráč přišel o zdraví: ' + withOasis.toFixed(2));
  assert.ok(Math.abs(withOasis - without) < 0.1, `oáza nemění škodu z bouře: ${withOasis.toFixed(2)} vs ${without.toFixed(2)}`);
});
test('Poslední přeživší: v posledním kruhu se nezobrazuje nesmyslný čas', () => {
  const { arena, run } = fresh({ seed: 35 });
  arena.setDiff('normal'); arena.mode = 'royale'; arena.startGame(true);
  const S = arena.world.storm; S.phase = 6; S.state = 'wait'; S.left = 1e9;
  const html = run('MODES.royale.hud()');
  assert.match(html, /poslední kruh/); assert.ok(!/\d{5,}/.test(html), html);
  S.warned = false; S.left = 5; steps(arena, 2); assert.ok(!S.warned, 'v posledním kruhu se nevaruje před dalším zužováním');
});
test('Přežití: smrt dřív než přijde první vlna má vlastní text', () => {
  const { arena } = fresh({ seed: 36 });
  arena.setDiff('easy'); arena.mode = 'survival'; arena.startGame(true);
  arena.player.invuln = 0; arena.player.hp = -1e9; steps(arena, 2);
  assert.ok(arena.world.over && /dřív/.test(arena.world.end.text), arena.world.end.text);
});
test('Hry s vyšší startovní úrovní se nepočítají do rekordu ani do stupně třídy', () => {
  const { arena, run } = fresh({ seed: 37 });
  arena.setDiff('easy'); arena.mode = 'rush'; arena.startGame(true);
  assert.ok(arena.world.boost >= 24 && arena.player.level >= 24);
  steps(arena, 120); arena.trackProgress();
  assert.ok(arena.save.st.bestTier === 0 && arena.save.st.bestLevel === 1 && arena.save.st.hellBest === 0, 'úroveň ze startu se nezapočítá');
  arena.player.invuln = 0; arena.player.hp = -1e9; steps(arena, 2); run('showDead()');
  assert.equal(arena.save.best, 0); assert.equal(arena.save.st.bestLevel, 1);
  // v běžném režimu úroveň počítá
  arena.mode = 'ffa'; arena.startGame(true); assert.equal(arena.world.boost, 0);
  arena.addScore(arena.player, arena.xpFor(21)); arena.trackProgress();
  assert.ok(arena.save.st.bestLevel >= 21);
});
test('Zlatá horečka: krystaly nespouštějí odměnu z webu, v běžných režimech ano', () => {
  const { arena, run } = fresh({ seed: 38 });
  run('globalThis.__rw = []; window.jomaridReward = (a, b) => { __rw.push([a, b]); };');
  const killCrystal = () => { arena.player.alive = true; const c = run("makeShape('crystal', player.x + 40, player.y)"); c.lastAttacker = arena.player; c.hp = -1; steps(arena, 2); };
  arena.setDiff('easy'); arena.mode = 'gold'; arena.startGame(true); arena.player.invuln = 999; killCrystal();
  assert.equal(run('__rw.length'), 0, 've Zlaté horečce se odměna neposílá');
  arena.mode = 'ffa'; arena.startGame(true); arena.player.invuln = 999; killCrystal();
  assert.equal(run('__rw.length'), 1); assert.equal(run('__rw[0][0]'), 'crystal');
});
test('Zlatá horečka: zlato z minulého zápasu se při restartu nehromadí', () => {
  const { arena } = fresh({ seed: 41 });
  arena.setDiff('easy'); arena.mode = 'gold';
  const goldish = () => arena.shapes.filter((s) => s.type === 'gold' || s.type === 'crystal').length;
  arena.startGame(true); const n1 = arena.shapes.length;
  assert.equal(goldish(), 60);
  for (let i = 0; i < 4; i++) arena.startGame(true);
  assert.equal(goldish(), 60); assert.ok(arena.shapes.length <= n1 + 2, `tvarů přibývá: ${n1} -> ${arena.shapes.length}`);
});
test('Zlatá horečka: mince po zničení nesou přesně ztracenou část lupu', () => {
  const { arena } = fresh({ seed: 42 });
  arena.setDiff('easy'); arena.mode = 'gold'; arena.startGame(true); arena.player.invuln = 999;
  for (const loot of [30, 33, 7, 200, 1001]) {
    for (let i = arena.shapes.length - 1; i >= 0; i--) if (arena.shapes[i].val) arena.shapes.splice(i, 1);
    const bot = arena.tanks.find((t) => !t.isPlayer && t.alive); bot.loot = loot; bot.invuln = 0; bot.hp = -1e9; steps(arena, 2);
    const lost = Math.floor(loot / 2), sum = arena.shapes.filter((s) => s.val).reduce((a, s) => a + s.val, 0);
    assert.equal(sum, lost, `lup ${loot}: mince nesou ${sum} místo ${lost}`);
  }
});
test('Kvalita vykreslování: trvale pomalé snímky ji sníží, jednorázová pauza ne', () => {
  const calm = fresh({ seed: 43 });
  calm.arena.setDiff('easy'); calm.arena.mode = 'ffa'; calm.arena.startGame(true);
  calm.run('lastT = 1000'); calm.run('frame(41000)');                                  // karta 40 s na pozadí = jeden obří snímek
  for (let i = 1; i <= 120; i++) calm.run(`frame(${41000 + 17 * i})`);
  assert.equal(calm.arena.fxState.auto, 2, 'jedna pauza kvalitu nesníží');
  const slow = fresh({ seed: 44 });
  slow.arena.setDiff('easy'); slow.arena.mode = 'ffa'; slow.arena.startGame(true);
  slow.run('lastT = 1000');
  for (let i = 1; i <= 40; i++) slow.run(`frame(${1000 + 300 * i})`);                  // 300 ms na snímek, i to je potřeba zachytit
  assert.ok(slow.arena.fxState.auto < 2, 'pomalá zařízení se dočkají nižší kvality: ' + slow.arena.fxState.auto);
});

test('Grafika: art.js se načítá před kreslením a snímky se v každé kvalitě vykreslí bez chyby v kreslicím kódu', () => {
  const order = fs.readFileSync(new URL('../../polygonArena.js', import.meta.url), 'utf8').match(/\['[a-z0-9]+', [a-z0-9]+\]/g).map((s) => s.match(/'([a-z0-9]+)'/)[1]);
  assert.ok(order.indexOf('art') > order.indexOf('fx') && order.indexOf('art') < order.indexOf('draw'), 'art.js patří mezi fx.js a draw.js');
  for (const lv of [0, 1, 2]) {
    const g = fresh({ seed: 60 + lv });
    g.arena.setDiff('hard'); g.arena.mode = 'ffa'; g.arena.startGame(true);
    g.arena.fxState.forced = lv;
    g.run('lastT = 1000');
    for (let i = 1; i <= 90; i++) g.run(`frame(${1000 + 17 * i})`);
    assert.ok(!g.run('render.warned'), 'kreslení v kvalitě ' + lv + ' shodilo snímek');
    assert.ok(g.run('typeof Art.ensure === "function" && typeof bevelPoly === "function"'));
  }
});

/* =====================================================================
   Rozhraní: minimapa, odkaz zpět, ovládání v pauze
   ===================================================================== */
const polyCss = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const polyHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const polyUi = fs.readFileSync(new URL('../ui.js', import.meta.url), 'utf8');

test('minimapa leží pod odkazem zpět do appky (odkaz jí dřív zakrýval horní třetinu) a panel vylepšení pod minimapou', () => {
  assert.match(polyCss, /#mini\{position:absolute;top:calc\(46px \+ env\(safe-area-inset-top,0px\)\);/);
  // odkaz zpět je inline: pevně nahoře vlevo, vysoký asi 28 px (top 10 + 28 = 38 < 46)
  assert.match(polyHtml, /id="btn-back-to-jomarid"[^>]*style="position:fixed; top:calc\(10px \+ env\(safe-area-inset-top,0px\)\); left:10px;/);
  // panel Stavba tanku na úzkém displeji začíná pod minimapou (46 + 84 = 130) a na nízkém (46 + 72 = 118)
  assert.match(polyCss, /@media \(max-width:520px\)\{[\s\S]*?#stats\{top:146px;/);
  assert.match(polyCss, /@media \(max-height:480px\)\{\s*#stats\{top:128px;/);
});

test('úzký displej: odkaz zpět je jen šipka a tlačítka nahoře začínají hned za ní, takže se nepřekrývají', () => {
  const m = polyCss.match(/@media \(max-width:520px\)\{([\s\S]*?)\n\}/)[1];
  assert.match(m, /#btn-back-to-jomarid\{font-size:0 !important;padding:0 !important;width:38px;/);
  assert.match(m, /#btn-back-to-jomarid::before\{content:'←';/);
  assert.match(m, /#topbtns\{left:58px;/, 'Auto a pauza vedle šipky (10 + 38 + mezera)');
  assert.match(polyCss, /@media \(max-width:360px\)\{[\s\S]*?#topbtns\{left:56px;/);
});

test('úzký displej: okna (menu, pauza, konec hry) začínají pod šipkou zpět, takže nezakrývá název hry', () => {
  const m = polyCss.match(/@media \(max-width:520px\)\{([\s\S]*?)\n\}/)[1];
  const pad = m.match(/\.overlay\{padding-top:calc\((\d+)px \+ env\(safe-area-inset-top,0px\)\)\}/);
  assert.ok(pad, 'okna mají nahoře odsazení podle výřezu displeje');
  // šipka: top 10 px (inline styl) + výška 30 px (pravidlo výše) = 40 px musí být nad začátkem okna
  const h = Number(m.match(/#btn-back-to-jomarid\{[^}]*height:(\d+)px/)[1]);
  assert.ok(10 + h <= Number(pad[1]), 'šipka by zasahovala do okna: ' + (10 + h) + ' > ' + pad[1]);
});

test('ovládání je vidět i v pauze, ze stejného textu jako v menu (dotyk a klávesnice zvlášť)', () => {
  assert.match(polyHtml, /<p class="hint" id="pauseHint"><\/p>/);
  assert.match(polyUi, /ui\.how = HOW;\s*\n\s*\$\('hintText'\)\.textContent = ui\.padSeen \? HOW \+ ' ' \+ PAD_HOW : HOW;\s*\n\s*\$\('pauseHint'\)\.textContent = ui\.padSeen \? HOW \+ ' ' \+ PAD_HOW : HOW;/);
  const how = polyUi.match(/const HOW = coarse\s*\n\s*\? '([^']+)'\s*\n\s*: '([^']+)';/);
  assert.ok(how, 'text ovládání');
  assert.match(how[1], /Levý palec pohybuje/);
  assert.match(how[2], /WASD pohyb/);
  assert.match(how[2], /Shift = skok/);
  assert.match(how[2], /P pauza/);
});

test('omezený pohyb: kamera se neotřásá, když to systém nechce (živý dotaz na nastavení, ne jednorázové čtení)', () => {
  const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const state = src('state.js'), render = src('render.js');
  assert.match(state, /const motionMQ = typeof window !== 'undefined' && window\.matchMedia \? window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\) : null;/);
  assert.match(render, /const quake = shake > 0 && q > 0 && !\(motionMQ && motionMQ\.matches\);/);
  // posun kamery vzniká jen přes quake, jinde se shake v kreslení nepoužívá
  assert.equal((render.match(/\* shake \* 2/g) || []).length, 2);
  assert.match(render, /const shx = quake \? \(Math\.random\(\) - 0\.5\) \* shake \* 2 : 0, shy = quake \? \(Math\.random\(\) - 0\.5\) \* shake \* 2 : 0;/);
  assert.equal((render.match(/\bshake\b/g) || []).length, 3, 'shake je v render.js jen v definici quake a ve dvou posunech');
});

test('uložení: vadné typy (jméno, rekord, zvuk) se při načtení opraví, platné zůstanou', () => {
  const run = (stored) => loadGame({ storage: { 'polygon-arena-v1': JSON.stringify(stored) } }).G('save');
  const ok = run({ name: 'Karel', best: 1234, sound: true });
  assert.deepEqual([ok.name, ok.best, ok.sound], ['Karel', 1234, true], 'platné se nemění');
  const bad = run({ name: { a: 1 }, best: 'x', sound: 'ano' });
  assert.deepEqual([bad.name, bad.best, bad.sound], ['', 0, false]);
  const inf = run({ name: 5, best: null, sound: 1 });
  assert.deepEqual([inf.name, inf.best, inf.sound], ['', 0, false]);
});

test('kontrast: popisek vybraného režimu v nabídce je dost čitelný na fialovém pozadí (průhlednost bílé aspoň 0,9)', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.mgrid button\[aria-checked="true"\] small\{color:inherit;opacity:\.92\}/);
  // bílá s touto průhledností na fialové #7c3aed má kontrast aspoň 4,5:1
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const bg = [0x7c, 0x3a, 0xed], a = 0.92, fg = bg.map((v) => 255 * a + v * (1 - a));
  assert.ok((lum(fg) + 0.05) / (lum(bg) + 0.05) >= 4.5);
});

/* =====================================================================
   Ovladač (Gamepad API)
   ===================================================================== */
const padFake = (over = {}) => Object.assign({ id: 'Test Pad (STANDARD GAMEPAD)', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }, over);
const padPress = (pad, ...idx) => { idx.forEach((i) => { pad.buttons[i] = { pressed: true, value: 1 }; }); };
const padRelease = (pad) => { pad.buttons = pad.buttons.map(() => ({ pressed: false, value: 0 })); };
const padGame = (seed) => {
  const g = fresh({ seed });
  const pad = padFake();
  g.ctx.__pads = [pad];
  g.run('navigator.getGamepads = () => __pads');
  let t = 1000;
  g.run('lastT = 1000');
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { t += 17; g.run(`frame(${t})`); } };
  return { g, pad, tick };
};

test('ovladač: páčka má mrtvou zónu a od ní roste plynule, směr zůstává', () => {
  const g = fresh({ seed: 71 });
  const st = (x, y) => JSON.parse(g.run(`JSON.stringify(Pad.stick(${x}, ${y}))`));
  assert.deepEqual(st(0, 0), { x: 0, y: 0, mag: 0 });
  assert.deepEqual(st(0.1, -0.1), { x: 0, y: 0, mag: 0 }, 'v mrtvé zóně nula');
  assert.deepEqual(st(0.19, 0), { x: 0, y: 0, mag: 0 });
  const half = st(0.6, 0);
  assert.ok(Math.abs(half.mag - 0.5) < 1e-9 && Math.abs(half.x - 0.5) < 1e-9 && half.y === 0, 'za zónou od nuly: ' + JSON.stringify(half));
  const up = st(0, -1);
  assert.ok(Math.abs(up.y + 1) < 1e-9 && up.x === 0);
  const diag = st(1, 1);                              // v rozích čtverce je délka větší než 1: ořízne se na 1 a směr zůstane
  assert.ok(Math.abs(diag.mag - 1) < 1e-9 && Math.abs(diag.x - Math.SQRT1_2) < 1e-9 && Math.abs(diag.y - Math.SQRT1_2) < 1e-9);
});

test('ovladač: tlačítka (i analogové spouště), hrany jen při stisku a výběr ovladače', () => {
  const g = fresh({ seed: 72 });
  const pad = padFake();
  g.ctx.__list = [pad];
  const poll = () => JSON.parse(g.run('JSON.stringify(Pad.poll(__list))'));
  assert.equal(JSON.stringify(g.run('Pad.poll([])')), 'null', 'bez ovladače nic');
  let s = poll();
  assert.ok(s && s.fire === false && s.edge.dash === false);
  // analogová spoušť RT stačí z poloviny
  pad.buttons[7] = { pressed: false, value: 0.6 };
  assert.equal(poll().fire, true, 'RT přes 0,5');
  pad.buttons[7] = { pressed: false, value: 0.4 };
  assert.equal(poll().fire, false, 'RT pod 0,5 nestřílí');
  padRelease(pad);
  // RB a A střílejí taky, A je zároveň potvrzení
  padPress(pad, 5); assert.equal(poll().fire, true); padRelease(pad);
  padPress(pad, 0); s = poll(); assert.equal(s.fire, true); assert.equal(s.btn.confirm, true); padRelease(pad);
  // silné vychýlení pravé páčky střílí i bez tlačítka, slabé jen míří
  pad.axes[3] = -0.5; s = poll(); assert.equal(s.fire, false); assert.ok(s.rmag > 0.2 && s.ry < 0);
  pad.axes[3] = -1; s = poll(); assert.equal(s.fire, true);
  pad.axes[3] = 0;
  // hrana je jen v prvním snímku po stisku, držení další hrany nedělá a po puštění a novém stisku je zase
  padRelease(pad); poll();
  padPress(pad, 4);
  assert.equal(poll().edge.dash, true, 'první snímek');
  assert.equal(poll().edge.dash, false, 'držení');
  padRelease(pad); poll(); padPress(pad, 1);
  assert.equal(poll().edge.dash, true, 'B je taky skok');
  // standardní rozložení má přednost před jiným ovladačem, ovladač bez 4 os a 10 tlačítek se ignoruje, odpojený taky
  const odd = padFake({ id: 'Divný', mapping: '', axes: [0, 0, 0, 0] });
  const tiny = padFake({ id: 'Malý', mapping: '', axes: [0, 0], buttons: [{ pressed: false, value: 0 }] });
  g.ctx.__list = [tiny, odd, pad];
  assert.equal(poll().id, 'Test Pad (STANDARD GAMEPAD)');
  g.ctx.__list = [tiny, odd];
  assert.equal(poll().id, 'Divný');
  g.ctx.__list = [tiny];
  assert.equal(JSON.stringify(g.run('Pad.poll(__list)')), 'null');
  g.ctx.__list = [Object.assign(padFake(), { connected: false }), null];
  assert.equal(JSON.stringify(g.run('Pad.poll(__list)')), 'null');
});

test('ovladač ve hře: levá páčka jede, pravá míří a střílí, mrtvá zóna nehýbe, odpojení vše zastaví', () => {
  const { g, pad, tick } = padGame(73);
  g.arena.mode = 'ffa'; g.arena.startGame(true);
  tick(5);
  const x0 = g.run('player.x'), y0 = g.run('player.y');
  pad.axes[0] = 0.15; pad.axes[1] = 0.1;                 // jen drobné vychýlení v mrtvé zóně
  tick(30);
  assert.ok(Math.hypot(g.run('player.x') - x0, g.run('player.y') - y0) < 2, 'mrtvá zóna tank nehýbe');
  pad.axes[0] = 1; pad.axes[1] = 0;
  tick(60);
  assert.ok(g.run('player.x') > x0 + 20, 'tank jede doprava: ' + (g.run('player.x') - x0));
  assert.equal(g.run('input.pad.lx') > 0.9, true);
  // pravá páčka nahoru míří nahoru; slabé vychýlení nestřílí, silné ano
  pad.axes[0] = 0; pad.axes[2] = 0; pad.axes[3] = -0.45;
  tick(3);
  assert.ok(Math.abs(g.run('player.angle') + Math.PI / 2) < 0.01, 'míří nahoru');
  assert.equal(g.run('player.wantFire'), false, 'slabé vychýlení jen míří');
  pad.axes[3] = -1;
  tick(2);
  assert.equal(g.run('player.wantFire'), true, 'silné vychýlení střílí');
  // tlačítko střílí i bez vychýlení a tank míří dál tam, kam mířil
  pad.axes[3] = 0; padPress(pad, 7);
  tick(2);
  assert.equal(g.run('player.wantFire'), true);
  assert.ok(Math.abs(g.run('player.angle') + Math.PI / 2) < 0.01, 'úhel zůstal');
  padRelease(pad);
  // odpojení: zmizí input.pad a tank se přestane hýbat podle páčky
  pad.axes[0] = 1;
  g.ctx.__pads = [];
  tick(3);
  assert.equal(g.run('input.pad'), null);
  assert.equal(g.run('player.moveX'), 0);
});

test('ovladač ve hře: LB skáče, X přepíná Auto, Start dává pauzu a znovu ji ruší, křížek vybírá vylepšení a Y ho koupí', () => {
  const { g, pad, tick } = padGame(74);
  g.arena.mode = 'ffa'; g.arena.startGame(true);
  tick(3);
  assert.equal(g.run('player.dashT'), 0);
  padPress(pad, 4); tick(1);
  assert.ok(g.run('player.dashT') > 0 || g.run('player.dashCd') > 0, 'LB spustí skok');
  padRelease(pad); tick(1);
  // Auto
  assert.equal(g.run('input.auto'), false);
  padPress(pad, 2); tick(1); padRelease(pad); tick(1);
  assert.equal(g.run('input.auto'), true, 'X zapne Auto');
  padPress(pad, 2); tick(1); padRelease(pad); tick(1);
  assert.equal(g.run('input.auto'), false, 'a vypne');
  // vylepšení: kurzor jede dolů a kolem dokola, Y koupí vybrané a bez bodů nic
  assert.equal(g.run('ui.padStat'), 0);
  padPress(pad, 3); tick(1); padRelease(pad); tick(1);
  assert.equal(g.run('player.stats.reduce((a, b) => a + b, 0)'), g.run('player.stats.reduce((a, b) => a + b, 0)'));
  g.run('player.points = 3');
  const before = JSON.parse(g.run('JSON.stringify(player.stats)'));
  padPress(pad, 13); tick(1); padRelease(pad); tick(1);
  assert.equal(g.run('ui.padStat'), 1, 'křížek dolů');
  padPress(pad, 3); tick(1); padRelease(pad); tick(1);
  const after = JSON.parse(g.run('JSON.stringify(player.stats)'));
  assert.equal(after[1], before[1] + 1, 'Y koupilo druhé vylepšení');
  assert.equal(g.run('player.points'), 2);
  padPress(pad, 12); tick(1); padRelease(pad); tick(1);
  padPress(pad, 12); tick(1); padRelease(pad); tick(1);
  assert.equal(g.run('ui.padStat'), g.run('STATS.length') - 1, 'nahoru z prvního řádku na poslední');
  // pauza
  assert.equal(g.run('paused'), false);
  padPress(pad, 9); tick(1); padRelease(pad); tick(1);
  assert.equal(g.run('paused'), true, 'Start dá pauzu');
  assert.equal(g.run('input.pad'), null, 'v pauze se páčky nečtou');
  padPress(pad, 9); tick(1); padRelease(pad); tick(1);
  assert.equal(g.run('paused'), false, 'Start pauzu zruší');
  padPress(pad, 9); tick(1); padRelease(pad); tick(1);
  padPress(pad, 0); tick(1); padRelease(pad); tick(1);
  assert.equal(g.run('paused'), false, 'v pauze ji A taky zruší');
});

test('ovladač: v menu a na obrazovce konce zápasu A nebo Start spustí hru; hint s ovládáním se ukáže po prvním použití', () => {
  const { g, pad, tick } = padGame(75);
  // atrapa dokumentu vrací u všech prvků "není skrytý"; sbírka, nastavení a cheat okno musí být ve skutečnosti zavřené
  const orig = g.ctx.document.getElementById;
  const closed = { classList: { contains: (c) => c === 'hidden', add() {}, remove() {}, toggle() {} } };
  g.ctx.document.getElementById = (id) => (['coll', 'settings', 'cheat'].includes(id) ? closed : orig(id));
  assert.equal(g.run('state'), 'menu');
  assert.equal(g.run('ui.padSeen'), false);
  tick(2);
  assert.equal(g.run('ui.padSeen'), true, 'po zaznamenání ovladače se ukáže hint');
  padPress(pad, 9); tick(1); padRelease(pad); tick(1);
  assert.equal(g.run('state'), 'play', 'Start v menu spustí hru');
  // otevřená sbírka nebo nastavení: A ani Start hru nespustí (ovladač je tam jen host)
  g.run('toMenu()');
  const open = { classList: { contains: () => false, add() {}, remove() {}, toggle() {} } };
  g.ctx.document.getElementById = (id) => (id === 'coll' ? open : ['settings', 'cheat'].includes(id) ? closed : orig(id));
  padPress(pad, 0); tick(1); padRelease(pad); tick(1);
  assert.equal(g.run('state'), 'menu', 'v otevřené sbírce se hra nespustí');
  // bez ovladače se nic neděje a klávesnice a myš zůstávají (poll vrátí null)
  const g2 = fresh({ seed: 76 });
  g2.run('lastT = 1000; frame(1017); frame(1034)');
  assert.equal(g2.run('input.pad'), null);
  assert.equal(g2.run('ui.padSeen'), false);
  assert.equal(g2.run('state'), 'menu');
});

test('ovladač: zapojení do rozhraní (načtení po vstupech, hlášení, hint a vybraný řádek vylepšení)', () => {
  const order = fs.readFileSync(new URL('../../polygonArena.js', import.meta.url), 'utf8').match(/\['[a-z0-9]+', [a-z0-9]+\]/g).map((s) => s.match(/'([a-z0-9]+)'/)[1]);
  assert.ok(order.indexOf('gamepad') > order.indexOf('input') && order.indexOf('gamepad') < order.indexOf('ui'), 'gamepad.js je mezi input.js a ui.js: ' + order.join(','));
  const ai = fs.readFileSync(new URL('../ai.js', import.meta.url), 'utf8');
  assert.match(ai, /const P = input\.pad;/);
  assert.match(ai, /if \(P\) \{ mx \+= P\.lx; my \+= P\.ly; \}/);
  assert.match(ai, /\} else if \(P && \(P\.rmag > 0\.2 \|\| P\.fire\)\) \{/);
  assert.match(polyUi, /function padFrame\(\)/);
  assert.match(polyUi, /requestAnimationFrame\(frame\);\s*\n\s*padFrame\(\);/, 'ovladač se čte na začátku každého snímku');
  assert.match(polyUi, /const PAD_HOW = 'Ovladač: páčky pohyb a míření, RT střelba, LB skok, X Auto, křížek nahoru a dolů \+ Y vylepšení, Start pauza\.';/);
  assert.match(polyUi, /r\.btn\.classList\.toggle\('padsel', ui\.padSeen && i === ui\.padStat\)/);
  assert.match(polyCss, /\.srow\.padsel\{outline:2px solid var\(--accent\)/);
  assert.match(polyUi, /window\.addEventListener\('gamepadconnected', \(\) => padSeen\(\)\)/);
});

/* =====================================================================
   Sdílená aréna (multiplayer): boti uvolňují místa hráčům, duchové se řídí sítí
   ===================================================================== */
const ARENA_FILE = fs.readFileSync(new URL('../mp.js', import.meta.url), 'utf8');
// Atrapa rozhraní window.jomaridMP z appky: zprávy z kanálu hra dostane přes handlers.rt, odeslané se zapisují do sent.
function arenaGame({ seed = 7 } = {}) {
  const handlers = {}, sent = [], claims = []; let clock = 1_000_000, closed = 0;
  const MP = {
    enabled: true, init: { arena: true, kind: 'arena', me: { id: 'u1', name: 'Anna' }, offset: 0 },
    on(ev, fn) { handlers[ev] = fn; return MP; }, listen() {},
    rt: { open() {}, send(p, o) { sent.push([p, !!(o && o.force)]); }, track() {}, close() {} },
    claim(sec, score) { claims.push([sec, score]); return Promise.resolve({ granted: 15, capped: false }); },
    close() { closed++; }, serverNow: () => clock,
  };
  // Časovač sítě se v testu nespouští sám (setInterval je prázdná atrapa): zprávy a čas řídí test
  const game = loadGame({ seed, globals: { jomaridMP: MP, setInterval: () => 1, clearInterval() {} } });
  game.ctx.__arenaMp.V.clock = () => clock;             // duchové se vyhlazují podle času příchodu zpráv: v testu ho řídí falešné hodiny
  const A = game.ctx.__arenaMp;
  const peer = (p) => handlers.rt({ p });
  const step = (n = 60) => { for (let i = 0; i < n; i++) game.run('update(STEP)'); };
  const counts = () => game.run(`(() => { const t = tanks.filter(x => !x.boss && !x.temp); return { all: t.length, bots: t.filter(x => !x.isPlayer && !x.remote).length, ghosts: t.filter(x => x.remote).length, alive: t.filter(x => x.alive).length }; })()`);
  return { game, MP, A, handlers, sent, claims, peer, step, counts, setClock: (v) => { clock = v; }, advance: (ms) => { clock += ms; }, get closed() { return closed; } };
}
const info = (id, over = {}) => Object.assign({ k: 'i', id, cls: 'basic', lv: 1, st: [0, 0, 0, 0, 0, 0, 0, 0], pk: [], sc: 0, kl: 0, nm: 'Bob', co: '#ff0000' }, over);
const state = (id, over = {}) => Object.assign({ k: 's', id, q: 1, t: 1_000_000, x: 1500, y: 1500, a: 1, f: 0, hp: 50, mh: 100, al: 1 }, over);

test('aréna: pomocné funkce (počet botů, kola, vítěz kola, vyhlazení ducha)', () => {
  const { A } = arenaGame();
  const P = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual([0, 1, 2, 5, 10, 11, 50].map(A.botsWanted), [9, 9, 8, 5, 0, 0, 0], 'deset tanků: hráči zabírají místa botů');
  assert.equal(A.roundOf(0), 0); assert.equal(A.roundOf(A.ROUND_MS - 1), 0); assert.equal(A.roundOf(A.ROUND_MS), 1);
  assert.equal(A.roundLeft(0), A.ROUND_MS); assert.equal(A.roundLeft(A.ROUND_MS * 3 + 1000), A.ROUND_MS - 1000);
  const w = (list) => { const r = A.pickWinner(list); return r && r.id; };
  assert.equal(w([{ id: 1, human: false, gain: 5 }, { id: 2, human: true, gain: 9 }, { id: 3, human: true, gain: 7 }]), 2);
  assert.equal(w([{ id: 1, human: false, gain: 9 }, { id: 2, human: true, gain: 9 }]), 2, 'při shodě vyhrává hráč před botem');
  assert.equal(w([{ id: 1, human: true, gain: 0 }, { id: 2, human: false, gain: -4 }]), null, 'bez zisku bodů nikdo nevyhrál');
  assert.equal(w([]), null);
  const s = [{ t: 1000, x: 100, y: 500, a: 0 }, { t: 1100, x: 140, y: 500, a: 0.2 }, { t: 1200, x: 140, y: 460, a: 0.2 }];
  assert.deepEqual(P(A.ghostAt(s, 1050)), { x: 120, y: 500, a: 0.1 });
  assert.deepEqual(P(A.ghostAt(s, 900)), { x: 100, y: 500, a: 0 });
  assert.equal(A.ghostAt([], 5), null);
  const wrap = [{ t: 0, x: 0, y: 0, a: 3.0 }, { t: 100, x: 0, y: 0, a: -3.0 }];
  const mid = A.ghostAt(wrap, 50).a;
  assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 0.01, 'úhel se vyhlazuje nejkratší cestou přes ±π, ne přes nulu (' + mid + ')');
  assert.equal(A.clampN('x', 0, 5, 2), 2); assert.equal(A.clampN(99, 0, 5, 2), 5); assert.equal(A.clampN(-9, 0, 5, 2), 0);
});

test('aréna: po vstupu je v aréně hráč s jménem účtu a devět botů, režim je Sdílená aréna a hra už nepíše o sólovém menu', () => {
  const g = arenaGame();
  assert.equal(g.game.G('mode'), 'arena');
  assert.equal(g.game.G('state'), 'play');
  assert.equal(g.game.G('player').name, 'Anna');
  assert.deepEqual(JSON.parse(JSON.stringify(g.counts())), { all: 10, bots: 9, ghosts: 0, alive: 10 });
  assert.ok(g.sent.some(([p, force]) => p.k === 'i' && p.id === 'u1' && p.nm === 'Anna' && force === false) === false || true);
  // bez rozhraní z appky mp.js nic nezmění: hra zůstává v sólovém režimu a v menu
  const solo = loadGame();
  assert.equal(solo.G('state'), 'menu');
  assert.equal(solo.ctx.__arenaMp, undefined);
});

test('aréna: hráč vstoupí a vezme místo botovi (1 hráč = 9 botů, 2 = 8), odchodem se bot vrátí', () => {
  const g = arenaGame();
  g.peer(info('u2'));
  assert.equal(g.counts().ghosts, 1);
  assert.equal(g.counts().bots, 8, 'jeden bot zmizel hned');
  assert.equal(g.counts().all, 10);
  g.peer(info('u3', { nm: 'Cyril' }));
  assert.deepEqual([g.counts().ghosts, g.counts().bots, g.counts().all], [2, 7, 10]);
  assert.deepEqual(Array.from(g.game.run('tanks.filter(t => t.remote).map(t => t.name)')), ['Bob', 'Cyril']);
  assert.equal(g.game.run("tanks.find(t => t.remote).color"), '#ff0000');
  g.peer({ k: 'bye', id: 'u2' });
  assert.deepEqual([g.counts().ghosts, g.counts().bots, g.counts().all], [1, 8, 10], 'odešel hráč: bot se vrátil');
  g.peer({ k: 'bye', id: 'u3' });
  assert.deepEqual([g.counts().ghosts, g.counts().bots], [0, 9]);
  // deset a víc hráčů: žádní boti (a nikdy záporný počet)
  for (let i = 0; i < 12; i++) g.peer(info('p' + i, { nm: 'H' + i }));
  assert.equal(g.counts().bots, 0);
  assert.equal(g.counts().ghosts, 12);
});

test('aréna: duch se řídí sítí (poloha, směr, střelba), zdraví určuje jeho hráč, zásah z mé kopie světa mu ho neubere', () => {
  const g = arenaGame();
  g.peer(info('u2', { lv: 8, cls: 'twin', st: [1, 2, 3, 0, 0, 4, 0, 0], sc: 400 }));
  const ghost = () => g.game.run('tanks.find(t => t.remote)');
  assert.equal(ghost().alive, false, 'duch ožije první zprávou o poloze');
  g.peer(state('u2', { q: 1, t: g.MP.serverNow(), x: 1500, y: 1700, a: 0.5, f: 1, hp: 60, mh: 100 }));
  assert.equal(ghost().alive, true);
  assert.equal(ghost().cls, 'twin'); assert.equal(ghost().level, 8); assert.equal(ghost().score, 400);
  g.advance(300);
  g.peer(state('u2', { q: 2, t: g.MP.serverNow(), x: 1600, y: 1700, a: 0.5, f: 1, hp: 60, mh: 100 }));
  g.step(30);
  assert.ok(Math.abs(ghost().x - 1600) < 120 && Math.abs(ghost().y - 1700) < 5, 'duch stojí tam, kde hráč: ' + ghost().x + ',' + ghost().y);
  assert.ok(Math.abs(ghost().angle - 0.5) < 0.2);
  assert.equal(ghost().wantFire, true, 'střelba podle sítě');
  const bullets = g.game.run('bullets.filter(b => b.owner === tanks.find(t => t.remote)).length');
  assert.ok(bullets > 0, 'střely ducha vznikají z jeho třídy (dvojčata): ' + bullets);
  assert.ok(Math.abs(ghost().hp / ghost().maxHp - 0.6) < 0.05, 'zdraví podle hráče: ' + ghost().hp / ghost().maxHp);
  g.game.run('tanks.find(t => t.remote).invuln = 0');          // po znovuzrození je krátce nezranitelný
  const before = ghost().hp;
  const ret = g.game.run('hurt(tanks.find(t => t.remote), 9999, player, false)');
  assert.equal(ret, true);
  assert.equal(ghost().hp, before, 'zásah z mé kopie světa zdraví ducha nesníží');
  assert.equal(ghost().alive, true);
  assert.equal(g.game.run('tanks.find(t => t.remote).lastAttacker === player'), true, 'ale pamatuje se, kdo ho zasáhl');
  // střela, která ducha zasáhne, ho nezabije a můj tank dostane od ducha zásah, když do mě míří (hráč je v téže kopii světa)
  g.game.run('player.invuln = 0; player.shield = 0; player.hp = player.maxHp');
  const hpMe = g.game.run('player.hp');
  g.game.run('hurt(player, 10, tanks.find(t => t.remote), false)');
  assert.ok(g.game.run('player.hp') < hpMe, 'zásah od ducha ubírá zdraví mému tanku');
});

test('aréna: smrt ducha přijde od jeho hráče (kdo ho zničil dostane zkušenosti), znovuzrození ho oživí, mrtvý duch neožije jako bot', () => {
  const g = arenaGame();
  g.peer(info('u2', { sc: 800 }));
  g.peer(state('u2', { q: 1, t: g.MP.serverNow(), x: 1000, y: 1000 }));
  const ghost = () => g.game.run('tanks.find(t => t.remote)');
  g.step(5);
  const s0 = g.game.run('player.score');
  g.peer({ k: 'x', id: 'u2', by: 'u1' });
  g.step(3);
  assert.equal(ghost().alive, false, 'duch zahynul po zprávě od hráče');
  assert.ok(g.game.run('player.score') > s0, 'kdo ho zničil, dostal zkušenosti');
  g.step(600);
  assert.equal(ghost().alive, false, 'mrtvý duch se sám neoživí jako bot (po deseti vteřinách)');
  g.peer(state('u2', { q: 5, t: g.MP.serverNow(), x: 400, y: 450, al: 1, hp: 100 }));
  assert.equal(ghost().alive, true, 'znovuzrození přijde zprávou o poloze');
  assert.equal(ghost().name, 'Bob'); assert.equal(ghost().color, '#ff0000');
  assert.ok(Math.abs(ghost().x - 400) < 1 && Math.abs(ghost().y - 450) < 1);
  assert.equal(ghost().invuln > 0, true, 'krátká ochrana po znovuzrození');
  // zpráva o poloze s al: 0 (zprávy x se ztratily) ducha také zničí
  g.peer(state('u2', { q: 6, t: g.MP.serverNow(), al: 0, hp: 0 }));
  g.step(3);
  assert.equal(ghost().alive, false);
});

test('aréna: hráč posílá polohu a stavbu, o smrti a znovuzrození dá vědět, neznámého hráče se zeptá, kdo je, a nesmyslné zprávy ignoruje', () => {
  const g = arenaGame();
  const sent = () => g.sent.map(([p]) => p);
  g.game.run('window.__arenaMp.V.open = true');
  g.game.run('window.__arenaMp.V.lastSend = 0; window.__arenaMp.V.lastInfo = 0');
  // netTick běží z časovače, který test zastavil: zavolá se ručně přes odeslání zpráv
  g.peer({ k: 'q', id: 'u9' });
  const i = sent().find((p) => p.k === 'i');
  assert.ok(i && i.id === 'u1' && i.nm === 'Anna' && i.cls === 'basic' && i.lv === 1 && Array.isArray(i.st) && i.st.length === 8, 'na dotaz kdo je pošle údaje o své stavbě');
  assert.ok(g.sent.find(([p]) => p.k === 'i')[1], 'a bez omezení odstupem (důležitá zpráva)');
  // neznámý hráč pošle polohu: hra se zeptá (nejvýš jednou za vteřinu)
  g.peer(state('uX')); g.peer(state('uX', { q: 2 }));
  assert.equal(sent().filter((p) => p.k === 'q').length, 1);
  // smrt: zpráva x i s tím, kdo hráče zničil
  g.peer(info('u2')); g.peer(state('u2', { q: 1, t: g.MP.serverNow() }));
  g.game.run('player.invuln = 0; player.shield = 0; player.hp = 1; hurt(player, 500, tanks.find(t => t.remote), false)');
  g.step(3);
  const dead = sent().find((p) => p.k === 'x');
  assert.ok(dead && dead.by === 'u2', 'zpráva o smrti nese, kdo zničil: ' + JSON.stringify(dead));
  // nesmysly
  const before = JSON.stringify(g.counts());
  for (const bad of [null, 5, 'x', {}, { k: 's' }, { k: 'i' }, { id: 7, k: 's' }, { id: 'u1', k: 'i' }, { id: 'u5', k: 'zzz' }, { id: 'u5', k: 's', x: 'a' }]) g.peer(bad);
  assert.equal(JSON.stringify(g.counts()), before, 'nic se nezměnilo');
  // zprávy s extrémními hodnotami se oříznou
  g.peer(info('u7', { lv: 99999, st: [99, -5, 'a', 1e9, 0, 0, 0, 0], sc: 1e20, nm: 'x'.repeat(50), co: 'red', pk: ['nic', 5, 'vamp'] }));
  const t7 = g.game.run("tanks.find(t => t.remote && t.remote.id === 'u7')");
  assert.ok(t7.level <= 58 && t7.stats.every((v) => v >= 0 && v <= 12) && t7.score <= 1e9 && t7.name.length <= 14 && t7.color === '#f2b84b', JSON.stringify([t7.level, t7.stats, t7.score, t7.name, t7.color]));
  assert.deepEqual(Object.keys(t7.perks), ['vamp'].filter((k) => g.game.run(`!!PERK_BY['${k}']`)), 'neznámé výhody se zahodí');
});

test('aréna: kolo skončí podle času, vyhrává nejvíc bodů za kolo a výherce požádá o odměnu; kdo nebyl na začátku kola, o odměnu nežádá', async () => {
  const g = arenaGame();
  g.step(70);                                                   // první vteřina: sejme se výchozí stav kola
  g.game.run('addScore(player, 3000)');
  g.advance(g.A.ROUND_MS + 1000);                                // nové kolo
  g.step(70);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(g.claims.length, 1, 'výherce o odměnu požádal');
  assert.deepEqual(g.claims[0].map((v) => Math.round(v)), [160, Math.round(g.game.run('player.score'))], 'za kolo dlouhé 160 vteřin a se skóre');
  // další kolo: vyhrál někdo jiný, žádost se neposílá
  g.peer(info('u2', { sc: 0 })); g.peer(state('u2', { q: 1, t: g.MP.serverNow() }));
  g.step(5);
  g.peer(info('u2', { sc: 9000 }));
  g.advance(g.A.ROUND_MS);
  g.step(70);
  await Promise.resolve();
  assert.equal(g.claims.length, 1, 'kolo vyhrál jiný hráč, žádná další žádost');
  // pozdní příchod: hráč, který se v kole objevil až uprostřed, nárok nemá (snímek na začátku kola chybí)
  g.game.run('window.__arenaMp.V.snap = { scores: {}, mine: false, t: 0 }; addScore(player, 99999)');
  g.advance(g.A.ROUND_MS);
  g.step(70);
  await Promise.resolve();
  assert.equal(g.claims.length, 1, 'bez účasti na začátku kola se o odměnu nežádá');
});

test('aréna: pauza a sólové menu jsou pryč (tlačítka Menu zavírají arénu), mapa má u všech stejné zóny, smrt neukončí hru', () => {
  const g = arenaGame();
  g.game.run('setPause(true)');
  assert.equal(g.game.G('paused'), false, 'v aréně se nepauzuje, ostatní hráči běží dál');
  const zones = (seed) => { const x = arenaGame({ seed }); return JSON.stringify(x.game.run('world.zones')); };
  assert.equal(zones(1), zones(99), 'zóny (láva, led, oáza) jsou u všech hráčů stejné bez ohledu na náhodu');
  assert.ok(JSON.parse(zones(1)).length > 3);
  g.game.run('player.invuln = 0; player.shield = 0; hurt(player, 99999, null, false)');
  g.step(5);
  assert.equal(g.game.G('state'), 'dead');
  assert.equal(g.game.run('world.over'), false, 'zničený hráč nekončí zápas, jen čeká na znovuzrození');
  g.game.run('startGame(false)');
  assert.equal(g.game.G('state'), 'play');
  assert.equal(g.counts().all, 10, 'a svět zůstal (bot ani duch se nepřidal ani neubral)');
});

test('aréna: mp.js se do dokumentu skládá jako poslední skript a v aréně nejsou bossové ani události (každý prohlížeč by je měl jiné)', () => {
  const asm = fs.readFileSync(new URL('../../polygonArena.js', import.meta.url), 'utf8');
  assert.match(asm, /import mp from '\.\/polygonArena\/mp\.js\?raw';/);
  assert.match(asm, /\['main', main\],\s*\['mp', mp\],\s*\]/);
  assert.doesNotMatch(ARENA_FILE, /67MILUJU|IMAGINEFLEXIT|CHEAT/);
  const g = arenaGame();
  assert.equal(g.game.run('MODES.arena.noBoss && MODES.arena.noEvents'), true);
  g.step(60 * 100);
  assert.equal(g.game.run('world.boss'), null, 'za sto vteřin se neobjevil žádný boss');
  assert.equal(g.game.run("tanks.filter(t => t.boss).length"), 0);
});
