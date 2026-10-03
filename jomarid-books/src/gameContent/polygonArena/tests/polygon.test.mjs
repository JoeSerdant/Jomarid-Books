// Testy Polygon arény: generátor tříd (strom, jména, siluety, vyváženost) a chod hry v Node (režimy, obtížnosti).
//   npm run test:polygon
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClasses } from './load.mjs';
import { loadGame } from './stub.mjs';

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
  // Model síly se po měření soubojů opravuje korekcemi FIX (např. bomby se musí zesílit víc, než model čeká), proto
  // je horní mez volnější než cílový růst o ~10 %.
  for (const id of generated) {
    const par = CLASSES[PARENT[id]], r = CLASSES[id].prof.power / par.prof.power;
    assert.ok(r > 0.95 && r < 2.1, `${id}: poměr síly ${r.toFixed(2)}`);
  }
  for (const pid of Object.keys(TREE)) {
    if (!CLASSES[pid] || CLASSES[pid].boss || CLASSES[pid].tier >= 4) continue;
    const ps = TREE[pid].map((k) => CLASSES[k].prof.power);
    assert.ok(Math.max(...ps) / Math.min(...ps) < 2.2, `${pid}: sourozenci se liší ${(Math.max(...ps) / Math.min(...ps)).toFixed(2)}x`);
  }
});
test('generátor je deterministický (nezávisí na Math.random)', () => {
  const orig = Math.random;
  const dump = (rnd) => { Math.random = rnd; try { const g = loadClasses(); return JSON.stringify([g('CLASSES'), g('TREE')]); } finally { Math.random = orig; } };
  assert.equal(dump(() => 0.123), dump(() => 0.987));
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
  const { arena } = fresh({ seed: 12 });
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
  W.goldT = 0.01; p.loot = 9999; steps(arena, 3);
  assert.ok(W.over && W.win && /nejbohatší/i.test(W.end.title));
});
test('Týmy: tým s cílovým počtem zničených tanků vyhrává', () => {
  const { arena } = fresh({ seed: 16 });
  arena.setDiff('easy'); arena.mode = 'teams'; arena.startGame(true);
  arena.world.teamScore[1] = arena.DIFFS.easy.goal; steps(arena, 2);
  assert.ok(arena.world.over && arena.world.win); assert.ok(arena.save.st.wins >= 1);
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
test('úspěchy: nové úspěchy mají podmínky, hell5 vyžaduje Peklo', () => {
  const { arena } = fresh();
  const by = Object.fromEntries(arena.ACH.map((a) => [a.id, a]));
  for (const id of ['wave10', 'hillwin', 'royale', 'rushall', 'gold300', 'hell5', 'allmodes']) assert.ok(by[id], id);
  assert.ok(!by.hell5.ok({ diff: 'hard', life: { level: 40 } })); assert.ok(by.hell5.ok({ diff: 'hell', life: { level: 25 } }));
});
