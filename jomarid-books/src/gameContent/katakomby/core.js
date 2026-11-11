/* core.js - pravidla Katakomb pro dva hráče (co-op výprava): karty, hrdinové, nepřátelé a průběh výpravy.
   Bez DOM a bez Math.random: všechna náhoda jde ze semínka zápasu (KatCore.create({seed})). Oba prohlížeče, které provedou stejné akce ve stejném pořadí,
   mají přesně stejný stav, takže se po síti posílají jen akce, ne stav (jako v Hannibalovi). Kdo je právě na řadě, říká KatCore.next(st).

   Průběh: oba vyberou hrdinu (hrdina prvního hráče, potom druhého), pak se po vlnách střídají v tazích (kdo začíná kolo, určuje st.first), potom táhne nepřítel
   (hned v rámci tahu posledního hráče) a znovu. Po vlně si oba vyberou novou kartu. Vyhráváte porazením strážce v 10. vlně, prohráváte, když padnou oba hrdinové.
   Akce: {t:'hero', h}, {t:'p', k} (zahrát kartu číslo k z ruky), {t:'e'} (konec tahu; u poraženého hrdiny ho posílá hra sama), {t:'r', j} (výběr odměny). */
(function (root) {
  'use strict';

  var C = {
    strike: { n: 'Úder', c: 1, e: '⚔️', d: 6, r: 0 }, defend: { n: 'Štít', c: 1, e: '🛡️', b: 5, r: 0 }, quick: { n: 'Výpad', c: 0, e: '🗡️', d: 3, r: 0 },
    heavy: { n: 'Těžká rána', c: 2, e: '🔨', d: 15, r: 1 }, wall: { n: 'Zeď', c: 2, e: '🧱', b: 14, r: 1 }, fire: { n: 'Ohnivá koule', c: 2, e: '🔥', d: 9, p: 2, r: 1 },
    venom: { n: 'Jed', c: 1, e: '🧪', p: 5, r: 1 }, potion: { n: 'Lektvar', c: 1, e: '❤️', h: 6, r: 1 }, rage: { n: 'Zuřivost', c: 1, e: '😤', d: 7, w: 1, r: 1 },
    focus: { n: 'Soustředění', c: 0, e: '✨', en: 1, w: 1, r: 1 }, bash: { n: 'Štítová rána', c: 1, e: '🔰', bb: 1, r: 1 }, guard: { n: 'Hbitost', c: 1, e: '💨', b: 7, w: 1, r: 1 },
    shatter: { n: 'Rozdrcení', c: 1, e: '💥', d: 4, v: 2, r: 1 }, flurry: { n: 'Salva', c: 1, e: '🏹', d: 3, x: 3, r: 1 }, drain: { n: 'Výsek', c: 2, e: '🩸', d: 8, h: 4, r: 1 },
    fury: { n: 'Běsnění', c: 1, e: '🦁', s: 2, r: 2 }, plague: { n: 'Mor', c: 2, e: '☠️', p: 11, r: 2 }, surge: { n: 'Příliv sil', c: 0, e: '⚡', en: 2, w: 2, r: 2 },
    exec: { n: 'Poprava', c: 3, e: '⚰️', d: 30, r: 2 }, bolt: { n: 'Blesk', c: 1, e: '🌩️', d: 10, r: 1 }, barrier: { n: 'Bariéra', c: 1, e: '🔮', b: 9, r: 1 },
    vamp: { n: 'Upíří polibek', c: 1, e: '🧛', d: 5, h: 5, r: 1 }, toxin: { n: 'Smrtící jed', c: 2, e: '🐍', d: 4, p: 8, r: 1 }, calm: { n: 'Meditace', c: 0, e: '🧘', b: 4, w: 1, r: 1 },
    titan: { n: 'Titán', c: 2, e: '🗿', b: 12, s: 1, r: 2 }, barrage: { n: 'Palba', c: 2, e: '🎆', d: 4, x: 5, r: 2 },
    curse: { n: 'Kletba', c: 9, e: '🕸️', r: 0 }, blade: { n: 'Tanec čepelí', c: 1, e: '💃', d: 4, x: 2, b: 3, r: 1 }, zap: { n: 'Výboj', c: 0, e: '🔌', d: 4, r: 1 },
    iron: { n: 'Železná vůle', c: 1, e: '🦾', b: 6, s: 1, r: 1 }, hex: { n: 'Zlořeč', c: 1, e: '🕯️', v: 3, p: 3, r: 1 }, inferno: { n: 'Peklo', c: 3, e: '🌋', d: 12, x: 3, r: 2 },
    sanct: { n: 'Svatyně', c: 2, e: '⛪', b: 10, h: 8, r: 1 }, bastion: { n: 'Pevnost', c: 3, e: '🏯', b: 30, r: 2 }, tempo: { n: 'Tempo', c: 1, e: '⏱️', w: 3, r: 1 },
    doom: { n: 'Zkáza', c: 3, e: '☄️', d: 18, v: 2, p: 6, r: 2 },
    bless: { n: 'Požehnání', c: 1, e: '🙏', h: 8, r: 1 }, mend: { n: 'Obvaz', c: 0, e: '🩹', h: 4, r: 1 }, prayer: { n: 'Modlitba', c: 1, e: '📿', h: 6, w: 1, r: 1 },
    radiance: { n: 'Svatá záře', c: 2, e: '🌟', h: 12, b: 8, r: 1 }, smite: { n: 'Svatý hněv', c: 1, e: '☀️', d: 6, h: 4, r: 1 }, miracle: { n: 'Zázrak', c: 3, e: '💖', h: 25, r: 2 },
    antidote: { n: 'Protijed', c: 1, e: '💊', cl: 1, b: 4, r: 1 }, cleanse: { n: 'Očista', c: 0, e: '🧼', cl: 1, w: 1, r: 1 }, panacea: { n: 'Všelék', c: 2, e: '⚕️', cl: 1, h: 10, b: 6, r: 2 },
  };

  // Hrdinové: hp se v co-op výpravě nepoužívá (každý začíná s 50 životy), dr = kolik karet líže na začátku tahu, dk = základní balíček
  var H = [
    { n: 'Rytíř', e: '🛡️', hp: 48, d: 'Odolný a silný', dk: 'strike4defend4bash1heavy1antidote1' },
    { n: 'Mág', e: '🔮', hp: 36, d: 'Jedy a oheň', dk: 'strike3defend3venom2fire1focus1antidote1' },
    { n: 'Lupič', e: '🗡️', hp: 40, d: 'Rychlé karty, líže 6', dr: 6, dk: 'strike3defend3quick2flurry1guard1cleanse1' },
    { n: 'Alchymista', e: '⚗️', hp: 38, d: 'Jedy a lektvary', dk: 'strike3defend3toxin1venom1calm1potion1antidote1' },
    { n: 'Léčitel', e: '🌿', hp: 44, d: 'Léčení, energie a lízání', dk: 'strike2defend2bless2mend2calm1focus1surge1prayer1antidote1' },
  ];

  // Akce nepřátel: a = útok (v = síla, x = kolikrát), b = štít, d = oslabí hrdinu (zranitelnost), s = zesílí se, p = jed, c = kletby do balíčku, h = léčí se
  var A = function (v, x) { return { k: 'a', v: v, x: x }; }, B = function (v) { return { k: 'b', v: v }; }, D = function (v) { return { k: 'd', v: v }; };
  var S = function (v) { return { k: 's', v: v }; }, P = function (v) { return { k: 'p', v: v }; }, Cu = function (v) { return { k: 'c', v: v }; }, Hl = function (v) { return { k: 'h', v: v }; };
  var EN = [
    [{ n: 'Krysa', e: '🐀', hp: 14, pat: [A(5), A(6), B(4)] }, { n: 'Netopýr', e: '🦇', hp: 18, pat: [A(3, 2), A(7), B(5)] }, { n: 'Slizák', e: '🟢', hp: 22, pat: [A(6), D(2), A(8)] },
      { n: 'Divoký pes', e: '🐕', hp: 20, pat: [A(4, 2), A(9), B(5)] }, { n: 'Mumie', e: '🧟', hp: 26, pat: [B(6), A(10), D(1)] }, { n: 'Kultista', e: '🧝', hp: 24, pat: [Cu(1), A(7), D(1), A(9)] }],
    [{ n: 'Kostlivec', e: '💀', hp: 30, pat: [A(8), B(8), A(11)] }, { n: 'Goblin', e: '👺', hp: 34, pat: [A(5, 2), S(2), A(8)] }, { n: 'Pavouk', e: '🕷️', hp: 34, pat: [P(3), A(4, 3), B(6)] },
      { n: 'Duch', e: '👻', hp: 32, pat: [D(2), A(9), A(9), B(8)] }, { n: 'Vlkodlak', e: '🐺', hp: 40, pat: [A(7), A(7), S(1), A(12)] }, { n: 'Medúza', e: '🪼', hp: 36, pat: [P(4), D(2), A(11)] },
      { n: 'Černokněžník', e: '🧞', hp: 42, pat: [Cu(2), A(8), Hl(10), A(12)] }, { n: 'Harpyje', e: '🦅', hp: 38, pat: [A(5, 3), D(2), A(8, 2)] }],
    [{ n: 'Troll', e: '🧌', hp: 56, pat: [A(14), B(10), A(9)] }, { n: 'Čaroděj', e: '🧙', hp: 48, pat: [A(6, 3), B(12), P(4), A(16)] }, { n: 'Golem', e: '🗿', hp: 60, pat: [B(14), A(18), S(2)] },
      { n: 'Démon', e: '😈', hp: 58, pat: [A(9, 2), P(4), A(18), B(8)] }, { n: 'Ledový obr', e: '🥶', hp: 64, pat: [B(12), D(2), A(20)] }, { n: 'Obří štír', e: '🦂', hp: 62, pat: [P(6), A(12), A(8, 2), B(10)] },
      { n: 'Stín', e: '🌑', hp: 58, pat: [Cu(2), D(2), A(10, 2), Hl(12)] }],
  ];
  var EL = [
    { n: 'Upír', e: '🧛', hp: 60, pat: [A(10), D(2), A(6, 2), S(2)] }, { n: 'Minotaur', e: '🐂', hp: 72, pat: [A(16), B(10), A(8, 2)] }, { n: 'Hydra', e: '🐍', hp: 66, pat: [P(4), A(5, 3), A(12)] },
    { n: 'Rytíř smrti', e: '☠️', hp: 78, pat: [S(2), A(11), A(7, 2), B(12)] }, { n: 'Zlatý golem', e: '🤖', hp: 84, pat: [B(16), A(18), A(10), S(2)] },
    { n: 'Víla smrti', e: '🧚', hp: 74, pat: [Cu(2), A(9, 2), Hl(15), A(14)] }, { n: 'Behemot', e: '🦣', hp: 96, pat: [B(18), A(24), S(3), A(12, 2)] },
  ];
  var BOSSES = [
    { n: 'Drak', e: '🐉', hp: 115, pat: [A(8, 2), B(14), S(2), A(20), A(6, 3)] }, { n: 'Lich', e: '🪦', hp: 105, pat: [P(5), A(7, 3), D(2), B(14), A(24)] },
    { n: 'Kraken', e: '🦑', hp: 125, pat: [A(10), B(12), A(5, 4), S(2), A(22)] }, { n: 'Král démonů', e: '👿', hp: 135, pat: [Cu(2), A(9, 2), Hl(12), S(2), A(18), A(7, 3)] },
  ];

  // Obtížnosti: [násobek zdraví nepřátel, násobek jejich síly]
  var DIFFS = { easy: [0.8, 0.8], normal: [1, 1], hard: [1.35, 1.3] };
  var FINAL_WAVE = 10;
  var START_HP = 50;
  var HAND_MAX = 10;

  // Karta v balíčku je { k: klíč, u?: vylepšená }; cd vrátí její hodnoty (vylepšená je silnější)
  function cd(o) {
    var c = Object.assign({}, C[o.k]), f, i, ch = 0, up1 = ['d', 'b', 'h', 'p'], up2 = ['v', 'x', 'w', 'en', 's'];
    if (o.u) {
      for (i = 0; i < up1.length; i++) { f = up1[i]; if (c[f]) { c[f] += Math.ceil(c[f] * 0.4); ch = 1; } }
      for (i = 0; i < up2.length; i++) { f = up2[i]; if (c[f]) { c[f]++; ch = 1; } }
      if (!ch) c.c = Math.max(0, c.c - 1);
      c.n += '+';
    }
    return c;
  }

  // ---------- Náhoda ze semínka ----------
  function rnd(st) {
    st.rs = (st.rs + 0x6D2B79F5) | 0;
    var t = Math.imul(st.rs ^ (st.rs >>> 15), 1 | st.rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(st, arr) { return arr[Math.floor(rnd(st) * arr.length)]; }
  function shuffle(st, a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd(st) * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }

  // ---------- Stav ----------
  function create(opts) {
    var diff = DIFFS[opts && opts.diff] ? opts.diff : 'normal';
    return { seed: (opts && opts.seed) | 0, rs: (opts && opts.seed) | 0, diff: diff, D: DIFFS[diff], phase: 'select', picks: [-1, -1], p: [null, null], w: 0, E: null,
      t: 0, first: 0, tg: 0, rw: [[], []], pk: [0, 0], rwFirst: 0, over: null, n: 0, ev: [] };
  }

  // Kdo má podle pravidel provést další akci (0 nebo 1), -1 po konci. Server dává tah tomu samému hráči (viz db/multiplayer.sql, mp_move a end_turn).
  function next(st) {
    if (st.phase === 'select') return st.picks[0] < 0 ? 0 : 1;
    if (st.phase === 'play') return st.t;
    if (st.phase === 'reward') return st.pk[st.rwFirst] ? 1 - st.rwFirst : st.rwFirst;
    return -1;
  }

  // Událost pro vykreslení (číslo, štít, léčení, otřes, nápis): stav na nich nezávisí, hra je jen ukáže. w: 0/1 hráč, 2 nepřítel
  function ev(st, w, t, c) { st.ev.push({ w: w, t: t, c: c }); }

  function mkPlayer(st, hi) {
    var h = H[hi], cards = [], pool = Object.keys(C).filter(function (k) { return C[k].r; });
    h.dk.replace(/([a-z]+)(\d)/g, function (_, k, n) { for (var j = 0; j < +n; j++) cards.push({ k: k }); return ''; });
    for (var j = 0; j < 4; j++) cards.push({ k: pick(st, pool) });
    return { hi: hi, hp: START_HP, max: START_HP, blk: 0, en: 3, str: 0, vu: 0, psn: 0, deck: shuffle(st, cards), disc: [], hand: [] };
  }

  function draw(st, p, n) {
    while (n-- > 0) {
      if (p.hand.length >= HAND_MAX) break;
      if (!p.deck.length) { p.deck = shuffle(st, p.disc); p.disc = []; }
      if (p.deck.length) p.hand.push(p.deck.pop());
    }
  }

  function rewards(st) {
    var pool = [], k, i, o = [];
    for (k in C) if (C[k].r) for (i = 0; i < (C[k].r === 1 ? 3 : 1); i++) pool.push(k);
    while (o.length < 3) { k = pick(st, pool); if (o.indexOf(k) < 0) o.push(k); }
    return o.map(function (x) { return { k: x }; });
  }

  function over(st, win) {
    st.phase = 'over';
    st.over = { win: !!win, waves: win ? st.w : Math.max(0, st.w - 1) };
  }

  function wave(st) {
    var w = ++st.w, boss = w % 10 === 0, elite = !boss && w % 5 === 0;
    var e = boss ? pick(st, BOSSES) : elite ? pick(st, EL) : pick(st, EN[w < 4 ? 0 : w < 8 ? 1 : 2]);
    var hp = Math.round(e.hp * (1 + 0.12 * w) * 1.8 * st.D[0]);
    st.E = { n: e.n, e: e.e, pat: e.pat, hp: hp, max: hp, blk: 0, psn: 0, vu: 0, str: 0, i: 0, sc: (1 + 0.05 * w) * st.D[1], boss: boss, elite: elite };
    st.p.forEach(function (p) {
      p.blk = 0; p.str = 0; p.vu = 0; p.psn = 0;
      p.deck = shuffle(st, p.deck.concat(p.disc, p.hand).filter(function (o) { return o.k !== 'curse'; }));
      p.disc = []; p.hand = [];
      p.hp = p.hp <= 0 ? Math.ceil(p.max * 0.3) : Math.min(p.max, p.hp + Math.ceil(p.max * 0.2));
    });
    st.phase = 'play';
    st.ev.push({ banner: (boss ? '⚠️ BOSS · ' : elite ? '👹 Elita · ' : '') + e.n + ' · vlna ' + w, big: boss || elite });
    turn(st, st.first);
  }

  // Začátek tahu hráče i. Poražený hrdina táhnout nemůže: hra za něj pošle {t:'e', a:1}, aby tah přešel dál (server střídá tahy beze zbytku).
  function turn(st, i) {
    var p = st.p[i];
    if (i === st.first) {
      var al = [0, 1].filter(function (j) { return st.p[j].hp > 0; });
      if (!al.length) return over(st, false);
      st.tg = pick(st, al);
    }
    st.t = i;
    if (p.hp <= 0) return;
    p.blk = 0; p.en = 3;
    if (p.psn > 0) {
      p.hp = Math.max(0, p.hp - p.psn); ev(st, i, '-' + p.psn, 'p'); p.psn--;
      if (p.hp <= 0) return;
    }
    draw(st, p, p.hr || H[p.hi].dr || 5);
  }

  function hitEnemy(st, d) {
    var E = st.E;
    d = Math.floor(d * (E.vu ? 1.5 : 1));
    var a = Math.min(E.blk, d); E.blk -= a; d -= a; E.hp -= d;
    ev(st, 2, d ? '-' + d : '🛡️', d ? 'd' : 'b');
    if (d) st.ev.push({ shake: 2 });
  }
  function hurt(st, i, v) {
    var p = st.p[i];
    v = Math.floor(v * (p.vu ? 1.5 : 1));
    var a = Math.min(p.blk, v); p.blk -= a; v -= a; p.hp = Math.max(0, p.hp - v);
    ev(st, i, v ? '-' + v : '🛡️', v ? 'd' : 'b');
    if (v) st.ev.push({ shake: i });
  }

  // Vlna zvládnuta. starter je hráč, který zahrál poslední kartu (nebo st.first, když nepřítele dorazil jed): vybírá si odměnu jako první a po výběru obou
  // z něj vznikne první hráč další vlny (tah na serveru se tak vrátí přesně tomu, kdo má začínat).
  function won(st, starter) {
    if (st.w >= FINAL_WAVE) { st.ev.push({ banner: '🏆 Strážce padl!', big: true }); return over(st, true); }
    st.pk = [0, 0];
    st.rw = [rewards(st), rewards(st)];
    st.rwFirst = starter;
    st.phase = 'reward';
  }

  function enemyTurn(st) {
    var E = st.E; E.blk = 0;
    if (E.psn > 0) {
      E.hp -= E.psn; ev(st, 2, '-' + E.psn, 'p'); E.psn--;
      if (E.hp <= 0) return won(st, st.first);
    }
    var a = E.pat[E.i++ % E.pat.length], t = st.tg;
    if (st.p[t].hp <= 0) t = 1 - t;
    var P = st.p[t], j;
    st.ev.push({ lunge: 1 });
    if (a.k === 'b') { E.blk += a.v; ev(st, 2, '+' + a.v, 'b'); }
    else if (a.k === 'd') P.vu += a.v;
    else if (a.k === 's') E.str += a.v;
    else if (a.k === 'p') P.psn += a.v;
    else if (a.k === 'c') { for (j = 0; j < a.v; j++) P.disc.push({ k: 'curse' }); ev(st, t, '🕸️', 'p'); }
    else if (a.k === 'h') { E.hp = Math.min(E.max, E.hp + a.v); ev(st, 2, '+' + a.v, 'h'); }
    else for (j = 0; j < (a.x || 1); j++) hurt(st, t, Math.round((a.v + E.str) * E.sc));
    if (E.vu) E.vu--;
    if (st.p[0].hp <= 0 && st.p[1].hp <= 0) return over(st, false);
    turn(st, st.first);
  }

  function playCard(st, i, k) {
    var p = st.p[i], q = st.p[1 - i], E = st.E, obj = p.hand[k], c = cd(obj), j;
    p.en -= c.c; p.hand.splice(k, 1); p.disc.push(obj);
    var d = c.bb ? p.blk : c.d || 0;
    if (d) for (j = 0; j < (c.x || 1); j++) hitEnemy(st, d + (c.bb ? 0 : p.str));
    if (c.b) { p.blk += c.b; if (q.hp > 0) q.blk += c.b >> 1; ev(st, i, '+' + c.b, 'b'); }
    if (c.h) { p.hp = Math.min(p.max, p.hp + c.h); q.hp = Math.min(q.max, Math.max(q.hp, 0) + (c.h >> 1)); ev(st, i, '+' + c.h, 'h'); }
    if (c.p) E.psn += c.p;
    if (c.v) E.vu += c.v;
    if (c.cl) { p.psn = 0; p.vu = 0; q.psn = 0; ev(st, i, '💊', 'h'); }
    if (c.s) p.str += c.s;
    if (c.en) p.en += c.en;
    if (c.w) draw(st, p, c.w);
    if (E.hp <= 0) won(st, i);
  }

  function endTurn(st, i) {
    var p = st.p[i];
    if (p.hp > 0) { p.disc.push.apply(p.disc, p.hand); p.hand = []; if (p.vu) p.vu--; }
    if (i === st.first) turn(st, 1 - st.first); else enemyTurn(st);
  }

  // Provede akci hráče slot (0 nebo 1). Vrací { ok: true } nebo { ok: false, err } (stav se pak nezměnil). Události pro vykreslení jsou v st.ev (hra je po použití vyprázdní).
  function apply(st, slot, a) {
    if (!a || typeof a !== 'object') return { ok: false, err: 'shape' };
    if (st.phase === 'over') return { ok: false, err: 'over' };
    if (slot !== 0 && slot !== 1) return { ok: false, err: 'slot' };
    if (next(st) !== slot) return { ok: false, err: 'order' };
    var p;
    if (a.t === 'hero') {
      if (st.phase !== 'select' || !(a.h >= 0 && a.h < H.length) || a.h !== Math.floor(a.h)) return { ok: false, err: 'hero' };
      st.picks[slot] = a.h;
      if (st.picks[0] >= 0 && st.picks[1] >= 0) {
        st.p = [mkPlayer(st, st.picks[0]), mkPlayer(st, st.picks[1])];
        st.first = 0;
        wave(st);
      }
    } else if (a.t === 'p') {
      if (st.phase !== 'play') return { ok: false, err: 'phase' };
      p = st.p[slot];
      if (p.hp <= 0 || !(a.k >= 0) || a.k !== Math.floor(a.k) || !p.hand[a.k] || p.en < cd(p.hand[a.k]).c) return { ok: false, err: 'card' };
      playCard(st, slot, a.k);
    } else if (a.t === 'e') {
      if (st.phase !== 'play') return { ok: false, err: 'phase' };
      endTurn(st, slot);
    } else if (a.t === 'r') {
      if (st.phase !== 'reward' || !(a.j >= 0 && a.j < 3) || a.j !== Math.floor(a.j)) return { ok: false, err: 'reward' };
      st.p[slot].deck.push(st.rw[slot][a.j]);
      st.pk[slot] = 1;
      if (st.pk[0] && st.pk[1]) { st.first = st.rwFirst; wave(st); }
    } else return { ok: false, err: 'type' };
    st.n++;
    return { ok: true };
  }

  // Otisk stavu (32 bitů): po konci tahu ho posílá hráč s akcí a druhý ho porovná se svým, takže se rozchod stavů pozná hned.
  function hash(st) {
    var h = 2166136261 >>> 0;
    function mixIn(v) { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; }
    mixIn(st.rs); mixIn(st.w); mixIn(st.t); mixIn(st.first); mixIn(st.n);
    mixIn(st.phase === 'play' ? 1 : st.phase === 'reward' ? 2 : st.phase === 'over' ? 3 : 0);
    if (st.E) { mixIn(st.E.hp); mixIn(st.E.blk); mixIn(st.E.psn); mixIn(st.E.i); }
    st.p.forEach(function (p) { if (p) { mixIn(p.hp); mixIn(p.blk); mixIn(p.psn); mixIn(p.deck.length); mixIn(p.disc.length); mixIn(p.hand.length); } });
    return h >>> 0;
  }

  root.KatCore = { C: C, H: H, BOSSES: BOSSES, DIFFS: DIFFS, FINAL_WAVE: FINAL_WAVE, cd: cd, create: create, next: next, apply: apply, hash: hash };
})(typeof window !== 'undefined' ? window : globalThis);
