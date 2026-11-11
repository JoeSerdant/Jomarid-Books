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

/* ---------------------------------------------------------------- PvP: souboj dvou hrdinů */
const pvp = (seed = 5, h0 = 0, h1 = 0) => {
  const st = K.create({ seed, mode: 'pvp' });
  assert.equal(K.apply(st, 0, { t: 'hero', h: h0 }).ok, true);
  assert.equal(K.apply(st, 1, { t: 'hero', h: h1 }).ok, true);
  st.ev = [];
  return st;
};
const setHand = (st, slot, keys, en = 3) => { st.p[slot].hand = keys.map((k) => (typeof k === 'string' ? { k } : k)); st.p[slot].en = en; };
const playK = (st, slot, k = 0) => { const r = K.apply(st, slot, { t: 'p', k }); assert.equal(r.ok, true, r.err); st.ev = []; };

function pvpBot(st, slot, r) {
  if (st.phase === 'select') return { t: 'hero', h: Math.floor(r() * K.H.length) };
  const p = st.p[slot];
  const ok = p.hand.map((o, i) => [o, i]).filter(([o]) => K.cd(o).c <= p.en);
  if (ok.length && r() < 0.85) return { t: 'p', k: ok[Math.floor(r() * ok.length)][1] };
  return { t: 'e', x: 0 };
}
function pvpOut(seed, botSeed, bot = pvpBot, maxSteps = 6000) {
  const st = K.create({ seed, mode: 'pvp' }), srv = fakeServer(), r = rng(botSeed);
  let steps = 0;
  while (st.phase !== 'over' && steps++ < maxSteps) {
    const slot = K.next(st);
    assert.ok(slot === 0 || slot === 1);
    send(st, srv, slot, bot(st, slot, r));
    st.ev = [];
  }
  return { st, srv, steps };
}

test('PvP začátek: oba mají 60 životů a své balíčky, začíná první hráč s 5 kartami a 3 energiemi, druhý má v prvním tahu o kartu a energii víc', () => {
  const st = pvp(11, 0, 2);   // Rytíř proti Lupiči (Lupič líže 6)
  assert.equal(st.mode, 'pvp'); assert.equal(st.phase, 'play'); assert.equal(st.t, 0); assert.equal(st.pvn, 1);
  assert.deepEqual(plain(st.p.map((p) => [p.hp, p.max])), [[60, 60], [60, 60]]);
  assert.equal(st.p[0].hand.length, 5); assert.equal(st.p[0].en, 3);
  assert.equal(st.p[1].hand.length, 0, 'druhý hráč nemá nic, dokud nezačne jeho tah');
  assert.equal(st.p[0].deck.length + st.p[0].hand.length, 11 + 4, 'základní balíček Rytíře (11 karet) a 4 náhodné navíc');
});

test('PvP: druhý hráč má v prvním tahu 4 energie a o kartu víc, od třetího tahu zase 3 a běžné lízání', () => {
  const st = pvp(12, 0, 2);
  K.apply(st, 0, { t: 'e' });
  assert.equal(st.t, 1); assert.equal(st.pvn, 2);
  assert.equal(st.p[1].en, 4); assert.equal(st.p[1].hand.length, 7, 'Lupič líže 6 a o kartu víc');
  K.apply(st, 1, { t: 'e' });
  assert.equal(st.t, 0); assert.equal(st.pvn, 3); assert.equal(st.p[0].en, 3); assert.equal(st.p[0].hand.length, 5);
  K.apply(st, 0, { t: 'e' });
  assert.equal(st.p[1].en, 3); assert.equal(st.p[1].hand.length, 6);
});

test('PvP útok: štít soupeře zásah pohltí a zbytek jde do životů, síla útok zvyšuje, zranitelnost ho zvyšuje o polovinu (dolů zaokrouhleno)', () => {
  const st = pvp(13);
  st.p[1].blk = 4;
  setHand(st, 0, ['strike', 'strike', 'strike']);
  playK(st, 0);               // 6 zásah - 4 štít = 2 životy
  assert.deepEqual([st.p[1].hp, st.p[1].blk], [58, 0]);
  st.p[0].str = 2;
  playK(st, 0);               // 6 + 2 síla
  assert.equal(st.p[1].hp, 50);
  st.p[1].vu = 1;
  playK(st, 0);               // (6 + 2) * 1.5 = 12
  assert.equal(st.p[1].hp, 38);
  assert.equal(st.p[0].hp, 60, 'útočník o životy nepřišel');
});

test('PvP karty: štít a léčení jen sobě, štítová rána bije podle štítu, vícenásobný zásah, jed a zranitelnost soupeři, očista, energie, lízání', () => {
  const st = pvp(14);
  setHand(st, 0, ['defend', 'bash', 'flurry', 'venom', 'shatter', 'focus', 'potion'], 9);
  st.p[0].hp = 30;
  playK(st, 0);                        // štít 5
  assert.equal(st.p[0].blk, 5); assert.equal(st.p[1].blk, 0, 'soupeř štít nedostane (to je jen v coopu)');
  playK(st, 0);                        // štítová rána: zásah = štít 5
  assert.equal(st.p[1].hp, 55);
  playK(st, 0);                        // salva 3x3
  assert.equal(st.p[1].hp, 46);
  playK(st, 0);                        // jed 5
  assert.equal(st.p[1].psn, 5); assert.equal(st.p[0].psn, 0);
  playK(st, 0);                        // rozdrcení: 4 zásah + zranitelný 2
  assert.equal(st.p[1].hp, 42); assert.equal(st.p[1].vu, 2);
  const deck = st.p[0].deck.length, en = st.p[0].en;
  playK(st, 0);                        // soustředění: +1 energie, lízni 1
  assert.equal(st.p[0].en, en - 0 + 1); assert.equal(st.p[0].deck.length, deck - 1);
  playK(st, 0);                        // lektvar léčí sebe o 6
  assert.equal(st.p[0].hp, 36); assert.equal(st.p[1].hp, 42, 'léčení soupeři neprospěje');
  st.p[0].psn = 3; st.p[0].vu = 2;
  setHand(st, 0, ['antidote'], 3);
  playK(st, 0);
  assert.deepEqual([st.p[0].psn, st.p[0].vu], [0, 0], 'očista smaže jed i zranitelnost');
});

test('PvP léčení nejde nad maximum a zásah nesníží štít soupeře pod nulu', () => {
  const st = pvp(15);
  st.p[0].hp = 58;
  setHand(st, 0, ['bless']);
  playK(st, 0);
  assert.equal(st.p[0].hp, 60);
  setHand(st, 0, ['strike'], 3);
  st.p[1].blk = 50;
  playK(st, 0);
  assert.deepEqual([st.p[1].hp, st.p[1].blk], [60, 44]);
});

test('PvP jed: na začátku tahu zraní toho, kdo ho má, a ubude o 1; štít před ním nechrání', () => {
  const st = pvp(16);
  st.p[1].psn = 3; st.p[1].blk = 9;
  K.apply(st, 0, { t: 'e' });
  assert.equal(st.p[1].hp, 57); assert.equal(st.p[1].psn, 2); assert.equal(st.p[1].blk, 0, 'štít na začátku vlastního tahu zmizí');
  K.apply(st, 1, { t: 'e' }); K.apply(st, 0, { t: 'e' });
  assert.equal(st.p[1].hp, 55);
  assert.ok(st.ev.some((e) => e.w === 1 && e.t === '-2' && e.c === 'p'));
});

test('PvP konec tahu: ruka jde do odhozu, zranitelnost se na konci tahu zmenší, štít přečká tah soupeře', () => {
  const st = pvp(17);
  const before = st.p[0].hand.length;
  st.p[0].vu = 2; st.p[0].blk = 7;
  K.apply(st, 0, { t: 'e' });
  assert.equal(st.p[0].hand.length, 0); assert.equal(st.p[0].disc.length, before);
  assert.equal(st.p[0].vu, 1); assert.equal(st.p[0].blk, 7, 'štít zmizí až na začátku jeho dalšího tahu');
});

test('PvP vítězství zásahem: poslední životy soupeře ukončí hru, vítěz je ten, kdo zahrál kartu, a další akce se odmítnou', () => {
  const st = pvp(18);
  st.p[1].hp = 5;
  setHand(st, 0, ['strike']);
  assert.equal(K.apply(st, 0, { t: 'p', k: 0 }).ok, true);
  assert.equal(st.phase, 'over'); assert.equal(st.p[1].hp, 0);
  assert.deepEqual(plain(st.over), { winner: 0, why: 'ko', turns: 1 });
  assert.equal(K.next(st), -1);
  assert.equal(K.apply(st, 0, { t: 'e' }).err, 'over');
  assert.equal(K.apply(st, 1, { t: 'p', k: 0 }).err, 'over');
  const st2 = pvp(19);
  K.apply(st2, 0, { t: 'e' });
  st2.p[0].hp = 3; setHand(st2, 1, ['strike']);
  K.apply(st2, 1, { t: 'p', k: 0 });
  assert.equal(st2.over.winner, 1, 'vyhrává i druhý hráč');
});

test('PvP vítězství jedem: kdo na začátku svého tahu jedem padne, prohrává a soupeř vyhrává', () => {
  const st = pvp(20);
  st.p[1].hp = 2; st.p[1].psn = 2;
  K.apply(st, 0, { t: 'e' });
  assert.equal(st.phase, 'over');
  assert.deepEqual(plain(st.over), { winner: 0, why: 'poison', turns: 2 });
  assert.equal(st.p[1].hp, 0);
});

test('PvP vyčerpání: od 41. tahu ztrácí hráč na začátku tahu rostoucí počet životů, takže zdržování skončí', () => {
  const st = pvp(21);
  let guard = 0;
  while (st.phase !== 'over' && guard++ < 200) K.apply(st, K.next(st), { t: 'e' });
  assert.equal(st.phase, 'over');
  assert.equal(st.over.why, 'fatigue');
  assert.ok(st.over.turns > K.PVP_FATIGUE_FROM && st.over.turns < K.PVP_FATIGUE_FROM + 40, `skončilo v ${st.over.turns}. tahu`);
  assert.equal(st.p[1 - st.over.winner].hp, 0);
});

test('PvP: odměna po vlně ani nepřítel neexistují, výběr odměny se odmítne a před výběrem hrdiny se nehraje', () => {
  const st = K.create({ seed: 22, mode: 'pvp' });
  assert.equal(K.apply(st, 0, { t: 'p', k: 0 }).err, 'phase', 'před výběrem hrdinů se nehraje');
  assert.equal(K.apply(st, 0, { t: 'r', j: 0 }).err, 'reward');
  K.apply(st, 0, { t: 'hero', h: 1 }); K.apply(st, 1, { t: 'hero', h: 3 });
  assert.equal(st.E, null);
  assert.equal(st.w, 0);
  assert.equal(K.apply(st, 0, { t: 'r', j: 0 }).err, 'reward');
  assert.equal(K.apply(st, 1, { t: 'p', k: 0 }).err, 'order', 'druhý hráč na tahu není');
  assert.equal(K.apply(st, 0, { t: 'p', k: 99 }).err, 'card');
});

test('PvP: v balíčku nejsou kletby, každý hrdina má svůj základ a 4 náhodné karty navíc', () => {
  for (let h = 0; h < K.H.length; h++) {
    const st = pvp(30 + h, h, (h + 1) % K.H.length);
    for (const p of st.p) {
      const all = p.deck.concat(p.hand, p.disc);
      assert.ok(all.every((o) => o.k !== 'curse'));
      const base = K.H[p.hi].dk.replace(/([a-z]+)(\d)/g, (_, k, n) => `${k} `.repeat(+n)).trim().split(' ').length;
      assert.equal(all.length, base + 4, K.H[p.hi].n);
    }
  }
});

test('PvP stejné semínko a akce dávají stejný stav; dva hráči na dvou kopiích se nikdy nerozejdou (otisk po každé akci)', () => {
  for (let g = 0; g < 25; g++) {
    const A = K.create({ seed: 400 + g, mode: 'pvp' }), Bs = K.create({ seed: 400 + g, mode: 'pvp' }), srv = fakeServer(), r = rng(g * 13 + 1);
    let n = 0;
    while (A.phase !== 'over' && n++ < 6000) {
      const slot = K.next(A);
      assert.equal(K.next(Bs), slot);
      const act = pvpBot(A, slot, r);
      send(A, srv, slot, act);
      assert.equal(K.apply(Bs, slot, act).ok, true);
      assert.equal(K.hash(A), K.hash(Bs), `hra ${g}, akce ${n}`);
      A.ev = []; Bs.ev = [];
    }
    assert.equal(A.phase, 'over');
    assert.deepEqual(snap(A), snap(Bs));
  }
  const a = K.create({ seed: 7, mode: 'pvp' }), b = K.create({ seed: 8, mode: 'pvp' });
  for (const s of [a, b]) { K.apply(s, 0, { t: 'hero', h: 0 }); K.apply(s, 1, { t: 'hero', h: 1 }); }
  assert.notEqual(K.hash(a), K.hash(b));
});

test('PvP se serverem: tah vždy dostane ten, kdo je podle next() na řadě (karta tah nepředává, konec tahu ano) a každý souboj skončí vítězem', () => {
  const winners = [0, 0];
  let ko = 0, poison = 0;
  for (let g = 0; g < 80; g++) {
    const { st, srv, steps } = pvpOut(700 + g, g * 7 + 2);
    assert.equal(st.phase, 'over', `souboj ${g} skončil (po ${steps} akcích)`);
    assert.ok(st.over.winner === 0 || st.over.winner === 1);
    assert.equal(st.p[1 - st.over.winner].hp, 0);
    assert.ok(st.p[st.over.winner].hp > 0);
    winners[st.over.winner]++;
    if (st.over.why === 'ko') ko++; else if (st.over.why === 'poison') poison++;
    assert.ok(srv.moves.every((m) => m.a.t !== 'r'));
  }
  assert.ok(winners[0] > 10 && winners[1] > 10, `vyhrávají oba: ${winners}`);
  assert.ok(ko > 0, 'někdy rozhodne zásah');
});

test('PvP: hra je vyvážená natolik, že výběr hrdinů nikdy nevede k nekonečné hře a souboj netrvá déle než pár desítek tahů', () => {
  let max = 0;
  for (let g = 0; g < 60; g++) {
    const { st } = pvpOut(1000 + g, g + 11);
    max = Math.max(max, st.over.turns);
  }
  assert.ok(max <= K.PVP_FATIGUE_FROM + 40, `nejdelší souboj ${max} tahů`);
});

test('PvP události pro vykreslení: zásah ukáže číslo u soupeře a otřes, poslední zahraná karta je v st.last', () => {
  const st = pvp(40);
  setHand(st, 0, ['strike']);
  K.apply(st, 0, { t: 'p', k: 0 });
  assert.ok(st.ev.some((e) => e.w === 1 && /^-\d+$/.test(e.t) && e.c === 'd'));
  assert.ok(st.ev.some((e) => e.shake === 1));
  assert.deepEqual(plain(st.last), { w: 0, k: 'strike', u: 0, n: st.n });
});
