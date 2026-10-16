// Testy Chess League: node --test src/gameContent/chess/tests   (nebo: npm run test:chess)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadGame, plain, DIR, SOURCES } from './load.mjs';

const get = loadGame();
const F = get('FastChess'), E = get('ChessEngine'), B = get('Bots'), L = get('League'), Book = get('OpeningBook'), GameSession = get('GameSession');
const coord = get('moveToCoord'), findByCoord = get('findMoveByCoord'), findBySAN = get('findMoveBySAN');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 8000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await sleep(5); } };

// deterministický generátor pro opakovatelné testy
const lcg = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

describe('pravidla a generátor tahů (perft)', () => {
  const cases = [
    ['základní postavení', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
    ['Kiwipete (rošády, braní, piny)', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['koncovka s braním mimochodem', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['proměny a šachy', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['pozice 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
    ['pozice 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
  ];
  for (const [name, fen, expected] of cases) {
    test(name, () => {
      expected.forEach((n, i) => {
        assert.equal(F.perftFEN(fen, i + 1), n, `rychlý engine, hloubka ${i + 1}`);
        assert.ok(F.hashIsConsistent(), 'hash po perftu');
      });
      const st = E.fromFEN(fen);
      for (let d = 1; d <= Math.min(3, expected.length); d++) assert.equal(E.perft(st, d), expected[d - 1], `rules.js, hloubka ${d}`);
    });
  }

  test('oba generátory dávají stejné legální tahy v náhodných partiích', () => {
    const rnd = lcg(12345);
    let compared = 0;
    for (let g = 0; g < 15; g++) {
      let st = E.initialState(); const hist = [];
      for (let ply = 0; ply < 140; ply++) {
        const legal = E.generateAllLegalMoves(st, st.turn);
        if (legal.length === 0 || E.insufficientMaterial(st)) break;
        F.setupFromMoves(hist);
        assert.equal(F.legalCoords().join(','), legal.map(coord).sort().join(','), 'po ' + hist.join(' '));
        compared++;
        let pool = legal;
        if (rnd() < 0.5) { const caps = legal.filter((m) => m.captured || m.promotion); if (caps.length) pool = caps; }
        const m = pool[Math.floor(rnd() * pool.length)];
        hist.push(coord(m)); st = E.applyMove(st, m);
      }
    }
    assert.ok(compared > 500);
  });

  test('SAN: zápis tahů a shoda s knihou', () => {
    let st = E.initialState();
    const play = (san) => { const m = findBySAN(st, san); assert.ok(m, san); st = E.applyMove(st, m); return m; };
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']) play(san);
    assert.equal(E.toFEN(st), 'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 3 5');
  });
});

describe('engine botů', () => {
  const strong = { depth: 8, nodes: 400000, timeMs: 2500, qd: 10, evalLevel: 2, margin: 0, temperature: 0, blunder: 0, key: 'test-strong' };
  const best = (fen, moves = [], params = strong) => F.handle({ type: 'search', fen, moves, seed: 1, params });

  test('najde mat v jednom tahu', () => {
    assert.equal(best('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1').best, 'a1a8');
    assert.equal(best('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4').best, 'h5f7');
    assert.equal(best('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2').best, 'd8h4');
  });
  test('vezme volnou dámu a nenechá se matovat', () => {
    assert.equal(best('rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1').best, 'f3h4');
    assert.equal(best('4k3/8/8/3q4/8/2N5/8/4K3 w - - 0 1').best, 'c3d5');
  });
  test('dotáhne koncovky (dřív boti přehazovali figury do remízy)', () => {
    const rnd = lcg(777);
    const prof = { depth: 6, nodes: 120000, timeMs: 1200, qd: 6, evalLevel: 2, margin: 0, temperature: 0, blunder: 0, key: 'eg' };
    for (const [fen, color] of [['8/8/8/3k4/8/8/8/4KQ2 w - - 0 1', 'w'], ['8/8/8/3k4/8/8/8/R3K3 w - - 0 1', 'w'], ['4kq2/8/8/8/3K4/8/8/8 b - - 0 1', 'b']]) {
      let st = E.fromFEN(fen); const hist = []; let result = null;
      for (let i = 0; i < 120 && !result; i++) {
        const legal = E.generateAllLegalMoves(st, st.turn);
        if (legal.length === 0) { result = E.isCheckmate(st) ? 'mate' : 'stalemate'; break; }
        if (E.insufficientMaterial(st) || st.halfmoveClock >= 100) { result = 'draw'; break; }
        let m;
        if (st.turn === color) m = findByCoord(st, F.handle({ type: 'search', fen, moves: hist, seed: i, params: prof }).best);
        else m = legal[Math.floor(rnd() * legal.length)];
        assert.ok(m, 'bot zahrál nelegální tah');
        hist.push(coord(m)); st = E.applyMove(st, m);
      }
      assert.equal(result, 'mate', fen);
    }
  });
  test('každý profil vrací jen legální tahy a nepadá (náhodné pozice)', () => {
    const rnd = lcg(4242);
    const profiles = B.BOTS.map((b) => Object.assign({}, b.params, { timeMs: 300 }));
    for (let g = 0; g < 25; g++) {
      let st = E.initialState(); const hist = [];
      const len = 4 + Math.floor(rnd() * 100);
      for (let ply = 0; ply < len; ply++) {
        const legal = E.generateAllLegalMoves(st, st.turn);
        if (!legal.length) break;
        const m = legal[Math.floor(rnd() * legal.length)];
        hist.push(coord(m)); st = E.applyMove(st, m);
      }
      const legalNow = E.generateAllLegalMoves(st, st.turn).map(coord);
      for (const prof of profiles) {
        const r = F.handle({ type: 'search', moves: hist, seed: g + 1, params: prof });
        if (!legalNow.length) assert.ok(r.over); else assert.ok(legalNow.includes(r.best), `${r.best} v ${E.toFEN(st)}`);
      }
    }
  });
  test('rozbor označí hrubku (šášků mat)', () => {
    const mv = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
    const res = F.handle({ type: 'analyze', moves: mv }, () => {});
    const sum = L.summarizeAnalysis(res.scores, mv);
    assert.ok(sum.counts.w.blunder >= 1);
    assert.equal(sum.counts.b.blunder, 0);
  });
  test('silnější bot porazí slabšího (kontrola zapojení všech částí)', () => {
    const ex = Object.assign({}, B.BOTS[4].params, { timeMs: 3000 }), pip = Object.assign({}, B.BOTS[0].params, { timeMs: 3000 });
    let points = 0; const N = 4;
    for (let g = 0; g < N; g++) {
      let st = E.initialState(); const hist = []; const counts = {}; let res = 0.5;
      for (let ply = 0; ply < 260; ply++) {
        const legal = E.generateAllLegalMoves(st, st.turn);
        if (!legal.length) { res = E.isCheckmate(st) ? ((st.turn === 'w') === (g % 2 === 1) ? 1 : 0) : 0.5; break; }
        if (E.insufficientMaterial(st) || st.halfmoveClock >= 100) break;
        const botIsExpert = (st.turn === 'w') === (g % 2 === 0);
        const r = F.handle({ type: 'search', moves: hist, seed: g * 1000 + ply, params: botIsExpert ? ex : pip });
        const m = findByCoord(st, r.best); hist.push(r.best); st = E.applyMove(st, m);
        const k = E.positionKey(st); counts[k] = (counts[k] || 0) + 1; if (counts[k] >= 3) break;
      }
      points += res;
    }
    assert.ok(points >= 3, `Drak by měl z ${N} partií s Pipem získat aspoň 3 body, má ${points}`);
  });
});

describe('kniha zahájení', () => {
  test('všechny čáry jsou legální a bez duplicit', () => {
    const seen = new Set();
    Book.LINES.forEach((line, idx) => {
      let st = E.initialState();
      line.moves.forEach((san, i) => { const m = findBySAN(st, san); assert.ok(m, `čára ${idx}, půltah ${i + 1}: ${san}`); st = E.applyMove(st, m); });
      assert.ok(!E.isCheckmate(st) && !E.isStalemate(st));
      const key = line.moves.join(' '); assert.ok(!seen.has(key), 'duplicita ' + idx); seen.add(key);
    });
  });
  test('názvy zahájení a výběr tahu', () => {
    assert.equal(Book.nameFor('e4 e5 Nf3 Nc6 Bb5 a6'.split(' ')), 'Španělská hra');
    assert.equal(Book.nameFor(['a3']), 'Neobvyklé zahájení');
    assert.equal(Book.nameFor([]), null);
    const rng = lcg(5);
    for (let i = 0; i < 50; i++) assert.ok(['e4', 'd4', 'c4', 'Nf3', 'b3', 'f4'].includes(Book.pickMove([], {}, rng)));
    assert.equal(Book.pickMove(['e4', 'e5', 'Nf3', 'Nc6'], { maxPly: 4 }, rng), null);
    assert.equal(Book.pickMove(['h4', 'a5'], {}, rng), null); // mimo knihu
  });
});

describe('Elo, XP a uložený postup', () => {
  const bots = B.BOTS.map((b) => ({ key: b.key, rating: b.rating }));

  test('očekávaný výsledek, K-faktor a změna ratingu', () => {
    assert.equal(L.expectedScore(1000, 1000), 0.5);
    assert.ok(Math.abs(L.expectedScore(1200, 800) - 0.9090909) < 1e-6);
    assert.deepEqual([L.kFactor(0), L.kFactor(9), L.kFactor(10), L.kFactor(29), L.kFactor(30)], [40, 40, 28, 28, 20]);
    assert.equal(L.ratingChange(1000, 1000, 1, 0).delta, 20);
    assert.equal(L.ratingChange(1000, 1000, 0, 0).delta, -20);
    assert.equal(L.ratingChange(1000, 1000, 0.5, 0).delta, 0);
    assert.equal(L.ratingChange(1500, 500, 1, 40).delta, 1);      // výhra nad mnohem slabším: aspoň +1
    assert.equal(L.ratingChange(100, 1000, 0, 0).delta, 0);       // podlaha ratingu
    assert.ok(L.ratingChange(800, 1800, 1, 0).delta > 35);        // překvapivá výhra: skoro celé K
    assert.equal(L.ratingTitle(800), 'Začátečník');
  });
  test('rating už neroste za porážky (dřív byl 800 + 2xXP)', () => {
    let s = L.defaultSave();
    for (let i = 0; i < 6; i++) s = L.finishGame(s, { botIdx: 2, result: 'loss', reason: 'checkmate', color: 'w', plies: 40, tc: 'none', rated: true, moves: [] }, bots, '2026-01-01', '2025-12-31').save;
    assert.ok(s.rating < 800);
    assert.equal(plain(s.record).l, 6);
  });
  test('migrace starého postupu a odolnost proti rozbitým datům', () => {
    const legacy = { xp: 500, streak: 3, lastPlayedDate: '2025-01-01', questClaims: { date: '2025-01-01', keys: ['play'] }, unlockedIndex: 3, wins: { beginner: 4, easy: 3, medium: 2, hard: 0, expert: 0 }, theme: 'system', recentGames: [{ botKey: 'easy', result: 'win', date: '2025-01-01', xpGained: 25 }] };
    const s = plain(L.migrate(legacy, bots.map((b) => b.rating)));
    assert.equal(s.v, 2); assert.equal(s.rating, 1050); assert.equal(s.unlockedIndex, 3); assert.equal(s.theme, 'dark');
    // denní výzvy, série dní a XP s ligami ve hře nejsou: z uloženého postupu se zahodí
    for (const k of ['xp', 'streak', 'lastPlayedDate', 'questClaims']) assert.ok(!(k in s), k);
    assert.ok(!('xpGained' in s.recentGames[0]) && s.recentGames[0].botKey === 'easy');
    assert.deepEqual(plain(L.migrate(s, bots.map((b) => b.rating))), s); // idempotentní
    assert.equal(L.migrate(null, []).rating, 800);
    const store = { x: '{rozbite' }; const storage = { getItem: () => store.x, setItem: (k, v) => { store.x = v; }, removeItem: () => {} };
    assert.equal(L.loadSave(storage, []).rating, 800);
  });
  test('konec partie: rating, odemknutí soupeře a série výher (bez XP, výzev a série dní)', () => {
    const g = { botIdx: 0, result: 'win', reason: 'checkmate', color: 'w', plies: 40, tc: 'none', rated: true, moves: ['e2e4'] };
    const r = L.finishGame(L.defaultSave(), g, bots, '2026-10-03');
    assert.ok(r.summary.delta >= 1 && r.summary.delta < 20);
    assert.equal(r.save.rating, 800 + r.summary.delta); assert.equal(r.save.ratedGames, 1); assert.equal(r.save.unlockedIndex, 1);
    assert.equal(r.summary.newlyUnlocked, true);
    assert.equal(r.save.winStreak, 1);
    const again = L.finishGame(r.save, { ...g, botIdx: 1 }, bots, '2026-10-03');
    assert.equal(again.save.winStreak, 2); assert.equal(again.save.bestWinStreak, 2);
    const next = L.finishGame(again.save, { ...g, result: 'loss' }, bots, '2026-10-04');
    assert.equal(next.save.winStreak, 0); assert.equal(next.save.bestWinStreak, 2);
    for (const o of [r, again, next]) {
      for (const k of ['xp', 'streak', 'lastPlayedDate', 'questClaims']) assert.ok(!(k in o.save), k);
      for (const k of ['xpBase', 'xpGained', 'questBonus', 'streak', 'promoted', 'tierBefore', 'tierAfter']) assert.ok(!(k in o.summary), k);
      assert.ok(!('xpGained' in o.save.recentGames[0]));
    }
  });
  test('cvičná partie nemění rating', () => {
    const u = L.finishGame(L.defaultSave(), { botIdx: 0, result: 'win', reason: 'checkmate', color: 'w', plies: 40, tc: 'none', rated: false, moves: [] }, bots, '2026-10-03');
    assert.equal(u.save.rating, 800); assert.equal(u.save.ratedGames, 0); assert.equal(u.save.ratingHistory.length, 0);
  });
  test('přesnost a kategorie tahů', () => {
    assert.ok(L.winPercent(300) > 74 && L.winPercent(300) < 76);
    assert.equal(L.winPercent(0), 50);
    assert.ok(L.moveAccuracy(50, 50) > 99.9 && L.moveAccuracy(80, 20) < 15);
    assert.equal(L.classify(0, true), 'best'); assert.equal(L.classify(15, false), 'inaccuracy'); assert.equal(L.classify(40, false), 'blunder');
  });
  test('šachy nemají vlastní denní výzvy, série dní, XP, ligy ani odznaky (to dělá Jomarid Books)', () => {
    for (const k of ['getDailyQuests', 'getBadges', 'getLeagueInfo', 'computeXp', 'LEAGUE_TIERS']) assert.equal(typeof L[k], 'undefined', k);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const ui = fs.readFileSync(path.join(here, '..', 'ui.js'), 'utf8');
    for (const re of [/Dnešní výzvy/, /Tvoje liga/, /Odznaky/, /\bXP\b/, /save\.streak/, /QuestsCard|LeagueCard|BadgesCard/]) assert.doesNotMatch(ui, re, String(re));
    const tabs = ui.match(/const navItems = (\[.*\]);/);
    assert.ok(tabs);
    assert.deepEqual(Array.from(vm.runInNewContext(tabs[1]), (t) => t[0]), ['play', 'rating', 'settings']);
  });
  test('boti: rostoucí rating, hlášky ke všem událostem, lidské tempo', () => {
    const ratings = plain(B.BOTS.map((b) => b.rating));
    assert.deepEqual(ratings, [...ratings].sort((a, b) => a - b));
    const r = F.mulberry32(3);
    for (const bt of B.BOTS) for (const kind of ['start', 'capture', 'lostPiece', 'check', 'inCheck', 'blunder', 'win', 'loss', 'draw', 'drawAccept', 'drawDecline', 'drawEarly', 'hint', 'undo']) assert.ok(B.talkLine(bt.key, kind, r), bt.key + ' ' + kind);
    const delays = []; for (let i = 0; i < 200; i++) delays.push(B.thinkDelay(B.BOTS[3], { legal: 30, ply: 20 }, r, null));
    assert.ok(new Set(delays.map((d) => Math.round(d / 100))).size > 8, 'tempo se mění');
    assert.ok(B.thinkDelay(B.BOTS[3], { book: true }, r, null) < 900);
    assert.ok(B.thinkDelay(B.BOTS[3], { legal: 30 }, r, 6000) <= 300);
    assert.ok(B.shouldResign(B.BOTS[3], [-1300, -1400, -1500], 25));
    assert.ok(!B.shouldResign(B.BOTS[4], [-9999, -9999, -9999], 40)); // Drak se nevzdává
  });
});

describe('řadič partie', () => {
  const ai = {
    search: (req) => Promise.resolve().then(() => F.handle(Object.assign({ type: 'search' }, req))),
    evalPos: (req) => Promise.resolve().then(() => F.handle(Object.assign({ type: 'eval' }, req))),
    newGame: () => F.handle({ type: 'newgame' }), cancel() {}
  };
  const mk = (opts) => new GameSession(Object.assign({ bot: B.BOTS[0], botIdx: 0, playerColor: 'w', ai, delayScale: 0, chat: true }, opts));
  const pm = (s, c) => { const m = findByCoord(s.state, c); assert.ok(m, 'nelegální ' + c); return s.playerMove(m); };

  test('hráč táhne, bot odpoví, v tahu bota se táhnout nedá', async () => {
    const s = mk({ bot: B.BOTS[2], botIdx: 2 }); s.start();
    const early = findByCoord(s.state, 'd2d4');
    assert.ok(pm(s, 'e2e4')); assert.equal(s.playerMove(early), false);
    await until(() => s.moves.length === 2);
    assert.equal(s.moves[0].san, 'e4'); assert.ok(s.isPlayerTurn); assert.ok(s.opening());
    s.destroy();
  });
  test('hráč za černé: bot táhne první', async () => {
    const s = mk({ playerColor: 'b' }); s.start();
    await until(() => s.moves.length === 1);
    assert.equal(s.moves[0].color, 'w'); assert.ok(s.isPlayerTurn); assert.equal(s.canUndo, false);
    s.destroy();
  });
  test('nápověda a vrácení tahu dělají z partie cvičnou', async () => {
    const s = mk({ bot: B.BOTS[1], botIdx: 1 }); s.start();
    assert.equal(s.rated, true);
    pm(s, 'e2e4'); await until(() => s.moves.length === 2);
    assert.ok(await s.requestHint()); assert.equal(s.rated, false);
    pm(s, 'g1f3'); await until(() => s.moves.length === 4);
    assert.ok(s.undo()); assert.equal(s.moves.length, 2); assert.ok(s.isPlayerTurn);
    s.destroy();
  });
  test('vzdání a mat hráčem', async () => {
    const a = mk(); a.start(); pm(a, 'e2e4'); await until(() => a.moves.length === 2);
    a.resign(); assert.deepEqual(plain(a.result), { result: 'loss', reason: 'resign' }); a.destroy();
    const b = mk(); b.restore({ moves: ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6'] }); b.start();
    pm(b, 'h5f7'); assert.equal(b.result.result, 'win'); assert.equal(b.result.reason, 'checkmate'); assert.equal(b.moves[6].san, 'Qxf7#');
    b.destroy();
  });
  test('hodiny: první tahy zdarma, přírůstek, prohra na čas, remíza při nedostatku materiálu', async () => {
    let now = 1e6;
    const s = mk({ tcKey: 'blitz3', now: () => now }); s.start();
    assert.deepEqual(plain(s.liveTimes()), { w: 180000, b: 180000 });
    now += 5000; pm(s, 'e2e4'); assert.equal(s.clock.running, null);
    await until(() => s.moves.length === 2); assert.equal(s.clock.running, 'w');
    now += 10000; assert.equal(Math.round(s.liveTimes().w), 170000);
    pm(s, 'g1f3'); assert.equal(Math.round(s.clock.w), 172000);
    await until(() => s.moves.length === 4);
    now += 200000; assert.ok(s.tick()); assert.equal(s.result.reason, 'timeout'); s.destroy();
    const t = mk({ tcKey: 'blitz3' });
    t.states.push(E.fromFEN('4k3/4p3/8/8/8/8/8/2B1K3 b - - 0 1')); t.moves.push({ coord: 'x', san: 'x', color: 'w' }, { coord: 'x', san: 'x', color: 'b' });
    t.clock.running = 'b'; t.clock.since = Date.now() - 999999;
    t.tick(); assert.equal(t.result.result, 'draw'); assert.equal(t.result.reason, 'timeout-material');
  });
  test('uložení a obnovení partie včetně hodin', async () => {
    let now = 5000;
    const s = mk({ tcKey: 'blitz5', now: () => now }); s.start(); pm(s, 'e2e4'); await until(() => s.moves.length === 2);
    now += 7000; const ser = plain(s.serialize()); s.destroy();
    assert.equal(ser.moves.length, 2); assert.ok(ser.times.w <= 293000 && ser.times.w >= 292000);
    const r = mk({ tcKey: ser.tc, now: () => now }).restore(ser);
    assert.equal(r.moves.length, 2); assert.ok(Math.abs(r.liveTimes().w - ser.times.w) < 5);
  });
  test('nabídka remízy: příliš brzy se odmítne, nejde spamovat, v mrtvé pozici bot přijme', async () => {
    const s = mk({ bot: B.BOTS[3], botIdx: 3 }); s.start(); pm(s, 'e2e4'); await until(() => s.moves.length === 2);
    assert.equal((await s.offerDraw()).verdict, 'early'); assert.equal((await s.offerDraw()).verdict, 'blocked'); s.destroy();
    const t = mk({ bot: B.BOTS[3], botIdx: 3, rng: () => 0.9 });
    t.states.push(E.fromFEN('8/8/4k3/8/8/4K3/8/5B2 w - - 0 40')); for (let i = 0; i < 70; i++) t.moves.push({ coord: 'x', san: 'x', color: i % 2 ? 'b' : 'w' });
    assert.equal((await t.offerDraw()).verdict, 'accept'); assert.equal(t.result.reason, 'agreement');
  });
  test('každý bot dohraje partii proti náhodnému soupeři matem', async () => {
    const rnd = lcg(99);
    for (let bi = 0; bi < 5; bi++) {
      const s = mk({ bot: B.BOTS[bi], botIdx: bi, playerColor: bi % 2 ? 'b' : 'w', chat: false, rng: rnd }); s.start();
      const t0 = Date.now();
      while (!s.over && s.moves.length < 400) {
        if (s.isPlayerTurn) { const legal = E.generateAllLegalMoves(s.state, s.state.turn); s.playerMove(legal[Math.floor(rnd() * legal.length)]); } else await sleep(1);
        assert.ok(Date.now() - t0 < 60000, 'zaseklo se');
      }
      assert.ok(s.over, B.BOTS[bi].key); assert.equal(s.result.reason, 'checkmate'); assert.equal(s.result.result, 'loss', 'bot ' + B.BOTS[bi].key + ' má vyhrát');
      s.destroy();
    }
  });
});

const NODE_MODULES = path.join(DIR, '..', '..', '..', 'node_modules');
const UMD_FILES = ['react/umd/react.production.min.js', 'react-dom/umd/react-dom.production.min.js'];

describe('složení dokumentu', () => {
  test('žádný zdroj neobsahuje </script ani <!-- (rozbilo by vložení do HTML)', () => {
    for (const f of [...SOURCES, 'ui.js']) {
      const code = fs.readFileSync(path.join(DIR, f), 'utf8');
      assert.ok(!/<\/script/i.test(code), f + ' obsahuje </script');
      assert.ok(!/<!--/.test(code), f + ' obsahuje <!--');
    }
  });
  test('index.html má značky pro styl, React a skripty a zachovaný most pro odměny', () => {
    const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
    assert.ok(html.includes('/*__CSS__*/') && html.includes('<!--__REACT__-->') && html.includes('<!--__SCRIPTS__-->'));
    assert.ok(html.includes('JOMARID-BRIDGE') && html.includes('window.jomaridReward'));
  });
  test('React se bere z node_modules, ne z cizího serveru (CDN)', () => {
    const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
    assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'index.html nesmí načítat skripty zvenku');
    const composer = fs.readFileSync(path.join(DIR, '..', 'chess.js'), 'utf8');
    for (const f of UMD_FILES) assert.ok(composer.includes(`node_modules/${f}?raw`), 'chess.js nevkládá ' + f);
  });
  test('vložené soubory Reactu neobsahují </script ani <!-- (rozbilo by vložení do HTML)', { skip: !fs.existsSync(NODE_MODULES) && 'chybí node_modules (npm install)' }, () => {
    for (const f of UMD_FILES) {
      const umd = fs.readFileSync(path.join(NODE_MODULES, f), 'utf8');
      assert.ok(!/<\/script/i.test(umd) && !/<!--/.test(umd), f + ' by rozbil vložení do HTML');
    }
  });
  test('skutečně složený dokument: React je vložený před hrou, žádná značka nezůstala a nic se nenačítá zvenku', { skip: !fs.existsSync(path.join(NODE_MODULES, 'vite')) && 'chybí node_modules (npm install)' }, async () => {
    // chess.js používá Vite "?raw" importy, v čistém Node by nešel načíst - Vite tu slouží jen jako načítač modulů (bez serveru, bez pluginů).
    const { createServer } = await import('vite');
    const server = await createServer({ configFile: false, root: path.join(NODE_MODULES, '..'), logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    try {
      const { CHESS_HTML: html } = await server.ssrLoadModule('/src/gameContent/chess.js');
      assert.ok(!/__REACT__|__SCRIPTS__|__CSS__/.test(html), 'zůstala nenahrazená značka');
      assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'dokument nesmí načítat skripty zvenku (CDN)');
      const [react, reactDom] = UMD_FILES.map((f) => fs.readFileSync(path.join(NODE_MODULES, f), 'utf8'));
      const at = (code) => { const i = html.indexOf(code); assert.ok(i >= 0, 'v dokumentu chybí vložený kód'); assert.equal(html.indexOf(code, i + 1), -1, 'vložený kód je v dokumentu víckrát'); return i; };
      const iReact = at(react), iDom = at(reactDom), iRules = html.indexOf('id="src-rules"'), iUi = html.indexOf('id="src-ui"');
      assert.ok(iReact < iDom, 'react-dom musí následovat až po reactu');
      assert.ok(iDom < iRules && iRules < iUi && iRules > 0, 'React musí být před skripty hry');
      assert.ok(html.indexOf('JOMARID-BRIDGE') < iReact, 'most pro odměny musí být před hrou');
    } finally {
      await server.close();
    }
  });
  test('search.js jde spustit jako Web Worker (žádné DOM API, handler zpráv)', () => {
    const code = fs.readFileSync(path.join(DIR, 'search.js'), 'utf8');
    assert.ok(!/\bdocument\b|\blocalStorage\b/.test(code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/typeof document/g, '')));
    assert.ok(code.includes('self.onmessage'));
  });
});

describe('cheat kód 67MILUJU', () => {
  const calls = { search: 0 };
  const ai = {
    search: (req) => { calls.search++; return Promise.resolve().then(() => F.handle(Object.assign({ type: 'search' }, req))); },
    evalPos: (req) => Promise.resolve().then(() => F.handle(Object.assign({ type: 'eval' }, req))),
    newGame: () => F.handle({ type: 'newgame' }), cancel() {}
  };
  const mk = (opts) => new GameSession(Object.assign({ bot: B.BOTS[0], botIdx: 0, playerColor: 'w', ai, delayScale: 0, chat: true }, opts));
  const pm = (s, c) => { const m = findByCoord(s.state, c); assert.ok(m, 'nelegální ' + c); return s.playerMove(m); };
  const BOT_LIST = B.BOTS.map((b) => ({ key: b.key, rating: b.rating }));
  const save0 = () => L.defaultSave();

  test('vyhrát partii: soupeř se vzdá a partie zůstane hodnocená (cheat ji nijak neoznačí)', async () => {
    const s = mk({ bot: B.BOTS[2], botIdx: 2 }); s.start();
    pm(s, 'e2e4'); await until(() => s.moves.length === 2);
    assert.equal(s.rated, true);
    assert.equal(s.cheatWin(), true);
    assert.deepEqual(plain(s.result), { result: 'win', reason: 'cheat' });
    assert.equal(s.rated, true, 'výsledek se počítá jako skutečný'); assert.equal(s.assisted, false);
    assert.ok(!('cheated' in s), 'partie se jako cheat neoznačuje');
    assert.equal(s.cheatWin(), false, 'hotová partie se znovu nevyhraje');
    assert.equal(s.cheatDraw(), false);
    s.destroy();
  });
  test('vynutit remízu: hodnocená remíza', async () => {
    const s = mk(); s.start();
    assert.equal(s.cheatDraw(), true);
    assert.deepEqual(plain(s.result), { result: 'draw', reason: 'cheat' });
    assert.equal(s.rated, true); s.destroy();
  });
  test('výhra s cheat kódem se počítá jako skutečná: rating podle Elo, rekord, výhra, série i odemčení soupeře', () => {
    const before = plain(save0());
    const r = L.finishGame(save0(), { botIdx: 0, result: 'win', reason: 'cheat', color: 'w', plies: 0, tc: 'none', rated: true, moves: [] }, BOT_LIST, '2026-10-16');
    const s = plain(r.save);
    const exp = L.ratingChange(before.rating, BOT_LIST[0].rating, 1, 0);
    assert.ok(exp.delta > 0);
    assert.equal(r.summary.delta, exp.delta); assert.equal(s.rating, before.rating + exp.delta); assert.equal(s.peak, s.rating);
    assert.equal(s.ratedGames, 1); assert.equal(s.record.w, 1); assert.equal(s.botStats.beginner.w, 1);
    assert.equal(s.wins.beginner, 1); assert.equal(s.unlockedIndex, 1); assert.equal(s.winStreak, 1);
    assert.equal(r.summary.newlyUnlocked, true); assert.equal(r.summary.rated, true);
    assert.equal(s.recentGames.length, 1);
    assert.equal(s.recentGames[0].rated, true); assert.equal(s.recentGames[0].result, 'win'); assert.equal(s.recentGames[0].reason, 'cheat');
    assert.ok(!('cheat' in s.recentGames[0]), 'v historii není žádné označení cheat');
    assert.equal(s.ratingHistory.length, 1);
  });
  test('remíza s cheat kódem: rating podle Elo a remíza v rekordu; výhra nad posledním soupeřem se zapíše do výher', () => {
    const before = plain(save0());
    const d = L.finishGame(save0(), { botIdx: 1, result: 'draw', reason: 'cheat', color: 'w', plies: 0, tc: 'none', rated: true, moves: [] }, BOT_LIST, '2026-10-16');
    const exp = L.ratingChange(before.rating, BOT_LIST[1].rating, 0.5, 0);
    assert.equal(d.summary.delta, exp.delta); assert.equal(plain(d.save).rating, before.rating + exp.delta);
    assert.equal(plain(d.save).record.d, 1); assert.equal(plain(d.save).wins.easy, 0, 'remíza není výhra');
    const last = BOT_LIST.length - 1;
    const w = L.finishGame(Object.assign(save0(), { unlockedIndex: last }), { botIdx: last, result: 'win', reason: 'cheat', color: 'w', plies: 0, tc: 'none', rated: true, moves: [] }, BOT_LIST, '2026-10-16');
    assert.equal(plain(w.save).wins[BOT_LIST[last].key], 1);
  });
  test('běžná cvičná výhra (s nápovědou) se počítá do výher jako dřív, jen bez ratingu', () => {
    const r = L.finishGame(save0(), { botIdx: 0, result: 'win', reason: 'checkmate', color: 'w', plies: 30, tc: 'none', rated: false, moves: [] }, BOT_LIST, '2026-10-16');
    assert.equal(plain(r.save).wins.beginner, 1); assert.equal(plain(r.save).unlockedIndex, 1); assert.equal(r.summary.newlyUnlocked, true);
    assert.equal(r.summary.rated, false); assert.equal(plain(r.save).rating, save0().rating);
    const rated = L.finishGame(save0(), { botIdx: 0, result: 'win', reason: 'checkmate', color: 'w', plies: 30, tc: 'none', rated: true, moves: [] }, BOT_LIST, '2026-10-16');
    assert.equal(rated.summary.rated, true); assert.ok(plain(rated.save).rating > save0().rating);
  });
  test('soupeř naslepo: táhne náhodně bez hledání a bez knihy, partie zůstane hodnocená', async () => {
    // nejdřív normálně: mimo knihu (Pip ji má jen na 2 půltahy) se engine ptá; potom naslepo se neptá vůbec
    const rnd = lcg(5);
    const randomMove = (s) => { const legal = E.generateAllLegalMoves(s.state, s.state.turn); return s.playerMove(legal[Math.floor(rnd() * legal.length)]); };
    calls.search = 0;
    const normal = mk({ bot: B.BOTS[0], botIdx: 0, rng: lcg(5), chat: false }); normal.start();
    for (let i = 0; i < 4 && !normal.over; i++) { randomMove(normal); await until(() => normal.over || (normal.moves.length % 2 === 0 && normal.isPlayerTurn)); }
    assert.ok(calls.search > 0, 'bez cheatu se engine ptá (jinak by test nic nedokazoval)');
    normal.destroy();

    calls.search = 0;
    const s = mk({ bot: B.BOTS[0], botIdx: 0, rng: lcg(5), chat: false }); s.start();
    assert.equal(s.setBlindBot(true), true); assert.equal(s.rated, true); assert.equal(s.cheatBlind, true);
    for (let i = 0; i < 4 && !s.over; i++) { randomMove(s); await until(() => s.over || (s.moves.length % 2 === 0 && s.isPlayerTurn)); }
    assert.equal(calls.search, 0, 'engine se na tahy soupeře neptal');
    assert.ok(s.moves.filter((x) => x.color === 'b').length >= 3);
    assert.equal(s.setBlindBot(false), true); assert.equal(s.cheatBlind, false);
    s.destroy();
  });

  test('autopilot hraje za hráče: tahy přibývají sami a partie zůstane hodnocená (bez nápovědy); vypnutí ho zastaví', async () => {
    const s = mk({ bot: B.BOTS[0], botIdx: 0, rng: lcg(11), chat: false }); s.start();
    assert.equal(s.setAutopilot(true), true);
    await until(() => s.moves.length >= 8 || s.over, 60000);
    assert.ok(s.moves.length >= 8 || s.over, 'autopilot odehrál několik tahů');
    assert.ok(s.moves.filter((m) => m.color === 'w').length >= 4, 'bílé tahy (hráče) zahrál autopilot');
    assert.equal(s.hintsUsed, 0, 'autopilot nepoužívá nápovědu'); assert.equal(s.assisted, false); assert.equal(s.rated, true); assert.equal(s.hint, null);
    s.setAutopilot(false);
    const n = s.moves.length;
    await sleep(400);
    assert.equal(s.moves.length <= n + 1, true, 'po vypnutí se za hráče netáhne (nejvýš dotahuje tah soupeře)');
    s.destroy();
  });

  test('rozehraná partie s cheatem se uloží a obnoví jako obyčejná hodnocená; destroy autopilota ukončí', async () => {
    const s = mk(); s.start(); pm(s, 'e2e4'); await until(() => s.moves.length === 2);
    s.setBlindBot(true);
    const ser = plain(s.serialize());
    assert.ok(!('cheated' in ser), 'v uložené partii není žádné označení cheat');
    assert.equal(ser.assisted, false);
    s.destroy();
    const r = mk().restore(ser);
    assert.equal(r.rated, true); assert.equal(r.cheatBlind, false, 'režim soupeře naslepo se neukládá');
    const t = mk(); t.start(); t.setAutopilot(true); t.destroy();
    assert.equal(t.cheatAuto, false); assert.equal(t._autoTimer, null);
  });

  test('vyděsit soupeře: řekne hlášku jen když jsou zapnuté', () => {
    const said = [];
    const a = mk({ chat: true }); a.onEvent = (t, d) => { if (t === 'say') said.push(d.kind); };
    a.cheatScare(); assert.deepEqual(said, ['losing']); assert.equal(a.rated, true, 'hláška partii nijak nezmění');
    const b = mk({ chat: false }); b.onEvent = (t) => { said.push(t); }; b.cheatScare(); assert.equal(said.length, 1);
  });
});

describe('cheat kód v rozhraní', () => {
  const ui = fs.readFileSync(path.join(DIR, 'ui.js'), 'utf8');
  const fn = (name) => ui.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n`))[0];

  test('kód je 67MILUJU a znaky z kláves se berou nezávisle na rozložení klávesnice', () => {
    assert.match(ui, /const CHEAT_CODE = "67MILUJU";/);
    const cheatChar = new Function(`${fn('cheatChar')}; return cheatChar;`)();
    assert.equal(cheatChar({ code: 'Digit6', key: 'ž' }), '6', 'česká klávesnice: číslice bez Shiftu dává písmeno');
    assert.equal(cheatChar({ code: 'Digit7', key: '7' }), '7');
    assert.equal(cheatChar({ code: 'Numpad7', key: '7' }), '7');
    assert.equal(cheatChar({ code: 'KeyM', key: 'm' }), 'M');
    assert.equal(cheatChar({ code: 'KeyM', key: 'M' }), 'M');
    assert.equal(cheatChar({ code: 'KeyJ', key: 'j' }), 'J');
    assert.equal(cheatChar({ code: 'ShiftLeft', key: 'Shift' }), null);
    assert.equal(cheatChar({ code: 'Enter', key: 'Enter' }), null);
    assert.equal(cheatChar({ code: 'KeyA', key: 'á' }), null, 'diakritika bez kódu číslice se neberou');
    assert.equal(cheatChar({}), null);
  });

  test('zadání kódu se hlídá přes posuvné okno posledních 8 znaků, s Ctrl/Alt/Meta a opakováním kláves se nepočítá', () => {
    const hook = fn('useCheatCode');
    assert.match(hook, /e\.repeat \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/);
    assert.match(hook, /buf = \(buf \+ ch\)\.slice\(-CHEAT_CODE\.length\);/);
    assert.match(ui, /useCheatCode\(\(\) => \{ setCheatOpen\(true\); \}\);/);
  });

  test('menu: akce do partie jsou jen za rozehrané partie, vizuální kdykoli; menu se zavře Esc i klepnutím mimo', () => {
    const menu = fn('CheatMenu');
    for (const id of ['win', 'draw', 'blind', 'auto', 'scare', 'confetti', 'disco', 'fanfare']) assert.ok(menu.includes(`id: "${id}"`), id);
    assert.match(menu, /const live = !!session && !session\.over;/);
    assert.match(menu, /disabled: off/);
    assert.match(menu, /e\.key === "Escape"/);
    assert.match(menu, /tabIndex: -1, autoFocus: true/, 'fokus na kartě, ne na tlačítku: stisk klávesy, který menu otevřel, by jinak hned potvrdil Zavřít');
    assert.doesNotMatch(menu, /btn btn-primary btn-sm", onClick: onClose, autoFocus/);
    assert.match(menu, /session\.cheatWin\(\)/);
    assert.match(ui, /session: view === "game" \? session : null/, 'mimo hru není žádná partie, do které by se zasahovalo');
  });

  test('výsledek cheat partie se do postupu zapíše jako každý jiný: rozhraní žádné označení cheat nepředává ani nezobrazuje', () => {
    assert.match(ui, /rated, moves: coords \}, BOT_LIST/);
    assert.match(ui, /rated: !saved\.assisted, moves: saved\.moves \}/);
    assert.match(ui, /cheat: "cheat kódem"/, 'konec partie říká, jak skončila');
    assert.doesNotMatch(ui, /cheated/);
    assert.doesNotMatch(ui, /🎭 Cheat partie/);
    assert.match(ui, /g\.rated === false \? "cvičná" : null/);
  });

  test('kód se pozná bez ohledu na velikost písmen a mezery, jiný text ne', () => {
    const isCheatCode = new Function(`const CHEAT_CODE = "67MILUJU"; ${fn('isCheatCode')}; return isCheatCode;`)();
    assert.equal(isCheatCode('67MILUJU'), true);
    assert.equal(isCheatCode('67miluju'), true);
    assert.equal(isCheatCode('  67 Miluju '), true);
    for (const bad of ['', '67MILUJ', '67MILUJUU', 'v1.0', '67MILUJU!', null, undefined]) assert.equal(isCheatCode(bad), false, String(bad));
  });

  test('nenápadné pole u spodního okraje (jako ve Warroom Frontlines) je na každé obrazovce a otevře menu stejným kódem', () => {
    assert.match(ui, /content,\s*h\(CheatField, \{ open: cheatOpen, withNav: view === "menu", onOpen: \(\) => setCheatOpen\(true\) \}\)/, 'pole je v App hned za obsahem obrazovky (úplně dole), ne jen na jedné obrazovce');
    const f = fn('CheatField');
    assert.match(f, /if \(isCheatCode\(text\)\) \{ setVal\(""\);/, 'správný kód pole vyprázdní');
    assert.match(f, /onOpen\(\);/);
    assert.match(f, /onBlur: \(\) => setVal\(""\)/, 'špatný text v poli nezůstane');
    assert.match(f, /if \(open\) \{ setVal\(""\);/, 'po otevření menu (třeba klávesnicí) se pole vyprázdní');
    assert.match(f, /placeholder: CHEAT_FIELD_HINT/);
    assert.match(ui, /const CHEAT_FIELD_HINT = "v\d+\.\d+";/, 'vypadá jako číslo verze');
    assert.match(f, /"aria-label": "Tajný kód"/);
    assert.match(f, /autoCapitalize: "characters"/);
    assert.doesNotMatch(ui, /SecretCodeRow|tryCheatCode|onCheatCode/, 'řádek v Nastavení je pryč, nahradilo ho pole u spodního okraje');
  });

  test('pole je v toku stránky úplně dole (nic nepřekrývá), písmo má 16 px (iOS jinak při klepnutí přiblíží stránku) a na menu se vejde nad dolní lištu', () => {
    const css = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
    const rule = css.match(/\.cheat-field \{[\s\S]*?\n\}/)[0];
    assert.doesNotMatch(rule, /position: (fixed|absolute)/, 'pole není nad obsahem');
    assert.match(rule, /font: 700 16px\//);
    assert.match(rule, /transform: scale\(\.75\)/, 'vizuálně menší než 16 px');
    assert.match(css, /\.version-foot \{ flex: none; display: flex; justify-content: center;/, 'patička je v toku stránky jako poslední prvek');
    assert.match(css, /@media \(max-width: 899px\) \{ \.version-foot\.with-nav \{ padding-bottom: calc\(72px/, 'na menu patička neleží pod dolní lištou');
    assert.doesNotMatch(css, /\.dash-shell \{[^}]*88px/, 'místo pod lištou řeší patička');
  });
});
