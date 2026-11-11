// Testy pravidel Katakomb (core.js): data, shoda stavu u obou hráčů, střídání tahů se serverem, poražený hrdina, odměny, konec výpravy.
//   npm run test:katakomby
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({ Math });
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(DIR, 'core.js'), 'utf8'), ctx, { filename: 'core.js' });
const K = ctx.KatCore;
const plain = (x) => JSON.parse(JSON.stringify(x));
const snap = (st) => { const o = plain(st); o.ev = []; return o; };

// Falešný server: střídá tahy podle end_turn jako mp_move (db/multiplayer.sql). Akce {t:'p'} nechává hráče na tahu, ostatní tah předávají.
const keepsTurn = (a) => a.t === 'p';
function fakeServer() { return { turn: 0, moves: [] }; }
function send(st, srv, slot, a) {
  assert.equal(srv.turn, slot, `server má na tahu ${srv.turn}, ale ${slot} posílá ${JSON.stringify(a)}`);
  const r = K.apply(st, slot, a);
  assert.equal(r.ok, true, `akce ${JSON.stringify(a)} se odmítla: ${r.err}`);
  srv.moves.push({ slot, a });
  if (!keepsTurn(a)) srv.turn = 1 - srv.turn;
}

// Jednoduchý hráč: zahraje co jde (náhodně) a tah ukončí
function rng(seed) { let s = seed | 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function botAction(st, slot, r) {
  if (st.phase === 'select') return { t: 'hero', h: Math.floor(r() * K.H.length) };
  if (st.phase === 'reward') return { t: 'r', j: Math.floor(r() * 3) };
  const p = st.p[slot];
  if (p.hp <= 0) return { t: 'e', a: 1 };
  const ok = p.hand.map((o, i) => [o, i]).filter(([o]) => K.cd(o).c <= p.en && !(K.cd(o).c > 3));
  if (ok.length && r() < 0.8) return { t: 'p', k: ok[Math.floor(r() * ok.length)][1] };
  return { t: 'e', x: 0 };
}
function playOut(seed, diff, botSeed, maxSteps = 4000) {
  const st = K.create({ seed, diff }), srv = fakeServer(), r = rng(botSeed);
  let steps = 0;
  while (st.phase !== 'over' && steps++ < maxSteps) {
    const slot = K.next(st);
    assert.ok(slot === 0 || slot === 1);
    send(st, srv, slot, botAction(st, slot, r));
    st.ev = [];
  }
  return { st, srv, steps };
}

test('data: každý hrdina má balíček z existujících karet, každá karta má název, cenu a ikonu', () => {
  for (const h of K.H) {
    assert.ok(h.n && h.e && h.dk);
    h.dk.replace(/([a-z]+)(\d)/g, (_, k) => { assert.ok(K.C[k], `${h.n}: karta ${k} existuje`); return ''; });
  }
  for (const [k, c] of Object.entries(K.C)) {
    assert.ok(c.n && c.e && Number.isInteger(c.c) && c.c >= 0, k);
    assert.ok(c.d || c.b || c.h || c.p || c.v || c.s || c.w || c.en || c.bb || c.cl || k === 'curse', `${k} něco dělá`);
  }
  assert.equal(K.FINAL_WAVE, 10);
  assert.equal(K.BOSSES.length, 4);
});

test('vylepšená karta je silnější (nebo levnější, když nemá co zesílit)', () => {
  assert.ok(K.cd({ k: 'strike', u: 1 }).d > K.cd({ k: 'strike' }).d);
  assert.ok(K.cd({ k: 'flurry', u: 1 }).x > K.cd({ k: 'flurry' }).x);
  assert.equal(K.cd({ k: 'strike', u: 1 }).n, 'Úder+');
});

test('výpověď o pořadí: hrdinu vybírá nejdřív první hráč, potom druhý, tahy a odměny pak podle next()', () => {
  const st = K.create({ seed: 5 });
  assert.equal(K.next(st), 0);
  assert.equal(K.apply(st, 1, { t: 'hero', h: 0 }).ok, false, 'druhý hráč před prvním nevybere');
  assert.equal(K.apply(st, 0, { t: 'hero', h: 9 }).ok, false, 'neznámý hrdina');
  assert.equal(K.apply(st, 0, { t: 'hero', h: 1.5 }).ok, false);
  assert.equal(K.apply(st, 0, { t: 'hero', h: 1 }).ok, true);
  assert.equal(K.next(st), 1);
  assert.equal(K.apply(st, 1, { t: 'hero', h: 4 }).ok, true);
  assert.equal(st.phase, 'play');
  assert.equal(K.next(st), 0, 'první vlnu začíná první hráč');
  assert.equal(st.p[0].hand.length, 5);
  assert.equal(st.p[1].hand.length, 0, 'karty líže hráč až na začátku svého tahu');
  assert.equal(K.apply(st, 1, { t: 'p', k: 0 }).ok, false, 'hráč, který není na tahu, nehraje');
  assert.equal(K.apply(st, 0, { t: 'r', j: 0 }).ok, false, 'výběr odměny mimo odměnu');
  assert.equal(K.apply(st, 0, { t: 'p', k: 99 }).ok, false, 'karta, která v ruce není');
  assert.equal(K.apply(st, 0, { t: 'x' }).ok, false);
  assert.equal(K.apply(st, 0, null).ok, false);
});

test('karta bez dost energie se nezahraje a stav se nezmění', () => {
  const st = K.create({ seed: 8 });
  K.apply(st, 0, { t: 'hero', h: 0 }); K.apply(st, 1, { t: 'hero', h: 0 });
  st.p[0].en = 0;
  const idx = st.p[0].hand.findIndex((o) => K.cd(o).c > 0);
  assert.ok(idx >= 0);
  const before = snap(st);
  assert.equal(K.apply(st, 0, { t: 'p', k: idx }).ok, false);
  assert.deepEqual(snap(st), before);
});

test('stejné semínko a stejné akce dávají stejný stav, jiné semínko jiný', () => {
  const a = playOut(1234, 'normal', 77), b = playOut(1234, 'normal', 77), c = playOut(4321, 'normal', 77);
  assert.deepEqual(snap(a.st), snap(b.st));
  assert.equal(K.hash(a.st), K.hash(b.st));
  assert.notEqual(K.hash(a.st), K.hash(c.st));
});

test('dva hráči na dvou kopiích stavu: každý provádí akce druhého a stavy se nikdy nerozejdou (otisk po každé akci)', () => {
  for (let g = 0; g < 12; g++) {
    const A = K.create({ seed: 900 + g, diff: ['easy', 'normal', 'hard'][g % 3] }), Bs = K.create({ seed: 900 + g, diff: ['easy', 'normal', 'hard'][g % 3] }), srv = fakeServer(), r = rng(g * 31 + 7);
    let n = 0;
    while (A.phase !== 'over' && n++ < 4000) {
      const slot = K.next(A);
      assert.equal(K.next(Bs), slot, 'oba vědí, kdo je na řadě');
      const act = botAction(A, slot, r);
      send(A, srv, slot, act);            // táhne hráč slot na své kopii
      assert.equal(K.apply(Bs, slot, act).ok, true);   // druhý hráč totéž převezme
      assert.equal(K.hash(A), K.hash(Bs), `hra ${g}, akce ${n}`);
      A.ev = []; Bs.ev = [];
    }
    assert.equal(A.phase, 'over');
    assert.deepEqual(snap(A), snap(Bs));
  }
});

test('střídání se serverem: next() je vždy ten, komu server dá tah (i při poraženém hrdinovi a při výběru odměny), a každá hra skončí', () => {
  let wins = 0, losses = 0, deadSkips = 0, rewards = 0;
  for (let g = 0; g < 40; g++) {
    const { st, srv, steps } = playOut(100 + g, ['easy', 'normal', 'hard'][g % 3], g * 17 + 3);
    assert.equal(st.phase, 'over', `hra ${g} skončila (po ${steps} akcích)`);
    if (st.over.win) wins++; else losses++;
    deadSkips += srv.moves.filter((m) => m.a.a === 1).length;
    rewards += srv.moves.filter((m) => m.a.t === 'r').length;
    assert.ok(st.over.waves >= 0 && st.over.waves <= 10);
  }
  assert.equal(wins + losses, 40);
  assert.ok(deadSkips > 0, 'někdy padl hrdina a hra za něj ukončila tah');
  assert.ok(rewards > 0, 'někdy se volila odměna');
});

test('poražený hrdina: čeká se na jeho automatický konec tahu a hra jde dál; oživí ho léčení partnera nebo další vlna', () => {
  const st = K.create({ seed: 21 });
  K.apply(st, 0, { t: 'hero', h: 0 }); K.apply(st, 1, { t: 'hero', h: 4 });
  // první hráč končí tah, druhý je mrtvý
  K.apply(st, 0, { t: 'e' });
  assert.equal(K.next(st), 1);
  st.p[1].hp = 0; st.t = 1; st.p[1].hand = [];
  assert.equal(K.apply(st, 1, { t: 'p', k: 0 }).ok, false, 'poražený nehraje');
  const r = K.apply(st, 1, { t: 'e', a: 1 });
  assert.equal(r.ok, true);
  assert.equal(st.phase, 'play');
  assert.equal(K.next(st), 0, 'po tahu nepřítele začíná nové kolo prvním hráčem');
  assert.equal(st.p[1].hp, 0);
  // léčení partnera ho oživí
  st.p[0].hand = [{ k: 'bless' }]; st.p[0].en = 3;
  assert.equal(K.apply(st, 0, { t: 'p', k: 0 }).ok, true);
  assert.ok(st.p[1].hp > 0, 'Požehnání oživilo poraženého parťáka');
});

test('odměna po vlně: vybírá nejdřív ten, kdo vlnu dokončil, a vlnu pak začíná on; v další vlně jsou oba na nohou', () => {
  const st = K.create({ seed: 33 });
  K.apply(st, 0, { t: 'hero', h: 0 }); K.apply(st, 1, { t: 'hero', h: 0 });
  K.apply(st, 0, { t: 'e' });              // druhý hráč je na tahu
  assert.equal(K.next(st), 1);
  st.p[1].hand = [{ k: 'exec' }]; st.p[1].en = 9; st.E.hp = 1;
  assert.equal(K.apply(st, 1, { t: 'p', k: 0 }).ok, true);
  assert.equal(st.phase, 'reward');
  assert.equal(st.rwFirst, 1);
  assert.equal(K.next(st), 1, 'odměnu volí jako první ten, kdo vlnu dorazil');
  assert.equal(st.rw[0].length, 3); assert.equal(new Set(st.rw[0].map((o) => o.k)).size, 3);
  assert.equal(K.apply(st, 0, { t: 'r', j: 0 }).ok, false);
  const decks = [st.p[0].deck.length + st.p[0].disc.length + st.p[0].hand.length, st.p[1].deck.length + st.p[1].disc.length + st.p[1].hand.length];
  assert.equal(K.apply(st, 1, { t: 'r', j: 2 }).ok, true);
  assert.equal(K.next(st), 0);
  assert.equal(K.apply(st, 1, { t: 'r', j: 0 }).ok, false, 'dvakrát nevybere');
  assert.equal(K.apply(st, 0, { t: 'r', j: 1 }).ok, true);
  assert.equal(st.w, 2);
  assert.equal(st.phase, 'play');
  assert.equal(st.first, 1);
  assert.equal(K.next(st), 1, 'druhou vlnu začíná ten, kdo vybíral první');
  assert.equal(st.p[0].deck.length + st.p[0].disc.length + st.p[0].hand.length, decks[0] + 1);
  assert.equal(st.p[1].deck.length + st.p[1].disc.length + st.p[1].hand.length, decks[1] + 1);
});

test('vítězství: strážce v desáté vlně uzavře výpravu, prohra: padnou oba hrdinové', () => {
  const st = K.create({ seed: 50, diff: 'easy' });
  K.apply(st, 0, { t: 'hero', h: 0 }); K.apply(st, 1, { t: 'hero', h: 1 });
  const killBoss = (slot) => { st.p[slot].hand = [{ k: 'exec' }]; st.p[slot].en = 9; st.E.hp = 1; return K.apply(st, slot, { t: 'p', k: 0 }); };
  const srv = { turn: 0 };
  for (let w = 1; w < 10; w++) {
    assert.equal(st.w, w); assert.equal(st.phase, 'play');
    const slot = K.next(st);
    assert.equal(killBoss(slot).ok, true);
    assert.equal(st.phase, 'reward');
    const a = K.next(st); assert.equal(K.apply(st, a, { t: 'r', j: 0 }).ok, true);
    const b = K.next(st); assert.equal(K.apply(st, b, { t: 'r', j: 0 }).ok, true);
  }
  assert.equal(st.w, 10); assert.ok(st.E.boss, 'v desáté vlně je boss');
  assert.equal(killBoss(K.next(st)).ok, true);
  assert.equal(st.phase, 'over');
  assert.deepEqual(plain(st.over), { win: true, waves: 10 });
  assert.equal(K.next(st), -1);
  assert.equal(K.apply(st, 0, { t: 'e' }).ok, false, 'po konci nejde nic');

  const l = K.create({ seed: 51 });
  K.apply(l, 0, { t: 'hero', h: 0 }); K.apply(l, 1, { t: 'hero', h: 0 });
  l.p[0].hp = 0; l.p[1].hp = 1; l.p[1].blk = 0;
  l.E.pat = [{ k: 'a', v: 500 }]; l.E.i = 0; l.tg = 1;
  K.apply(l, 0, { t: 'e', a: 1 });
  assert.equal(K.apply(l, 1, { t: 'e' }).ok, true);
  assert.equal(l.phase, 'over');
  assert.equal(l.over.win, false);
  assert.equal(l.over.waves, 0);
  void srv;
});

test('nepřítel: jed ho může dorazit na začátku jeho tahu (odměnu pak volí první hráč kola)', () => {
  const st = K.create({ seed: 60 });
  K.apply(st, 0, { t: 'hero', h: 0 }); K.apply(st, 1, { t: 'hero', h: 0 });
  K.apply(st, 0, { t: 'e' });
  st.E.hp = 3; st.E.psn = 5;
  K.apply(st, 1, { t: 'e' });
  assert.equal(st.phase, 'reward');
  assert.equal(st.rwFirst, 0);
  assert.equal(K.next(st), 0);
});

test('události pro vykreslení: číslo zásahu a otřes; jádro samo čas ani DOM nepoužívá', () => {
  const st = K.create({ seed: 70 });
  K.apply(st, 0, { t: 'hero', h: 0 }); K.apply(st, 1, { t: 'hero', h: 0 });
  assert.ok(st.ev.some((e) => e.banner), 'nápis nové vlny');
  st.ev = [];
  st.p[0].hand = [{ k: 'strike' }]; st.p[0].en = 3;
  K.apply(st, 0, { t: 'p', k: 0 });
  assert.ok(st.ev.some((e) => e.w === 2 && /^-\d+$/.test(e.t)));
  assert.ok(st.ev.some((e) => e.shake === 2));
  const src = fs.readFileSync(path.join(DIR, 'core.js'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//, ''), /Math\.random|Date\.now|performance|document\.|window\.[a-z]/, 'jádro je čisté');
});
