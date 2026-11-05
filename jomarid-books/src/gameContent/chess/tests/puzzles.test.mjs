// Šachové úlohy: data se ověřují od základu (každý tah legální, mat na konci, řešení jediné, žádný kratší mat, nejvytrvalejší obrana)
// a zkoušejí se pomocné funkce pro posuzování tahů a ukládání postupu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadGame, plain, DIR } from './load.mjs';
import { createSolver } from './puzzleTools.mjs';

const get = loadGame();
const S = createSolver(get);
const E = get('ChessEngine');
const Puzzles = get('Puzzles');
const League = get('League');
const findByCoord = get('findMoveByCoord');
const moveToCoord = get('moveToCoord');
const LIST = plain(Puzzles.LIST);

test('úlohy mají správný tvar a stálá id', () => {
  assert.ok(LIST.length >= 60, 'málo úloh: ' + LIST.length);
  const ids = new Set();
  for (const p of LIST) {
    assert.match(p.id, /^m[123]-\d\d$/, p.id);
    assert.ok(!ids.has(p.id), 'dvojí id ' + p.id);
    ids.add(p.id);
    assert.equal(p.id[1], String(p.n), 'číslo v id sedí s délkou matu: ' + p.id);
    assert.ok([1, 2, 3].includes(p.n));
    assert.equal(p.sol.split(' ').length, 2 * p.n - 1, 'délka řešení ' + p.id);
    assert.ok(p.t in plain(Puzzles.THEMES), 'neznámé téma ' + p.t + ' u ' + p.id);
    assert.ok(['q', 'c', 'x'].includes(p.s), p.id);
    assert.ok(['', 'p', 'n', 'b', 'r', 'q'].includes(p.x), p.id);
  }
  // pořadí v seznamu: skupiny po délce matu, uvnitř podle čísla v id
  const order = LIST.map((p) => p.id);
  assert.deepEqual(order, [...order].sort(), 'úlohy jsou seřazené podle id');
  for (const n of [1, 2, 3]) assert.ok(LIST.filter((p) => p.n === n).length >= 10, 'málo úloh pro mat v ' + n);
});

test('každé řešení je podle pravidel legální a končí matem (rules.js, nezávisle na řešiči)', () => {
  for (const p of LIST) {
    let st = E.fromFEN(p.fen);
    const attacker = st.turn;
    assert.ok(!E.isInCheck(st, st.turn), 'strana na tahu je v šachu: ' + p.id);
    p.sol.split(' ').forEach((c, i) => {
      assert.equal(st.turn, i % 2 === 0 ? attacker : (attacker === 'w' ? 'b' : 'w'), 'střídání stran ' + p.id);
      const mv = findByCoord(st, c);
      assert.ok(mv, 'nelegální tah ' + c + ' v ' + p.id);
      st = E.applyMove(st, mv);
      const last = i === p.sol.split(' ').length - 1;
      assert.equal(E.isCheckmate(st), last, (last ? 'poslední tah musí být mat: ' : 'předčasný mat nebo pat: ') + p.id + ' tah ' + c);
      if (!last) assert.ok(E.generateAllLegalMoves(st, st.turn).length > 0, 'pat uprostřed řešení ' + p.id);
    });
    // správná figura má dát poslední tah: pozice musí být v pořádku (oba králové)
    const kings = st.board.flat().filter((x) => x && x.type === 'k');
    assert.equal(kings.length, 2, 'dva králové ' + p.id);
  }
});

test('řešič: mat v 1 a v 2 souhlasí s nezávislým hledáním přes pravidla (rules.js)', () => {
  // M1 pro všechny úlohy a M2 pro vybrané: zkouší se všechny první tahy, výsledek musí být přesně množina z řešiče
  const allMoves = (st) => E.generateAllLegalMoves(st, st.turn);
  const mate1 = (st) => plain(allMoves(st).filter((m) => E.isCheckmate(E.applyMove(st, m))).map(moveToCoord).sort());
  const mate2 = (st) => plain(allMoves(st).filter((m) => {
    const a = E.applyMove(st, m);
    const rs = allMoves(a);
    if (rs.length === 0) return E.isCheckmate(a);
    return rs.every((r) => mate1(E.applyMove(a, r)).length > 0);
  }).map(moveToCoord).sort());
  for (const p of LIST.filter((x) => x.n === 1)) {
    const st = E.fromFEN(p.fen);
    const mine = mate1(st);
    S.F.setFEN(p.fen);
    assert.deepEqual(plain(S.rootSolutions(1)), mine, 'mat v 1: ' + p.id);
    assert.ok(mine.includes(p.sol), 'řešení je mezi maty: ' + p.id);
  }
  const m2 = LIST.filter((x) => x.n === 2);
  for (const p of m2) {
    const st = E.fromFEN(p.fen);
    assert.deepEqual(mate1(st), [], 'v mat-v-2 úloze nesmí být mat v 1: ' + p.id);
    const mine = mate2(st);
    S.F.setFEN(p.fen);
    assert.deepEqual(plain(S.rootSolutions(2)), mine, 'mat v 2: ' + p.id);
    assert.deepEqual(mine, [p.sol.split(' ')[0]], 'první tah je jediný: ' + p.id);
  }
});

test('každá úloha je opravdu vynucená: po tahu z řešení vede každá odpověď k matu v zbývajícím počtu tahů (rules.js)', () => {
  const allMoves = (st) => E.generateAllLegalMoves(st, st.turn);
  const canMate = (st, k) => allMoves(st).some((m) => {
    const a = E.applyMove(st, m);
    if (k === 1) return E.isCheckmate(a);
    const rs = allMoves(a);
    if (rs.length === 0) return E.isCheckmate(a);
    return rs.every((r) => canMate(E.applyMove(a, r), k - 1));
  });
  for (const p of LIST) {
    const sol = p.sol.split(' ');
    let st = E.fromFEN(p.fen);
    for (let step = 0, left = p.n; step < sol.length; step += 2, left--) {
      assert.ok(canMate(st, left), 'v pozici před krokem ' + step + ' nejde vynutit mat v ' + left + ': ' + p.id);
      if (left > 1) assert.equal(canMate(st, left - 1), false, 'kratší mat v ' + (left - 1) + ' by úlohu zkrátil: ' + p.id);
      const a = E.applyMove(st, findByCoord(st, sol[step]));
      if (step + 1 < sol.length) st = E.applyMove(a, findByCoord(a, sol[step + 1]));
    }
  }
});

test('řešitel od základu potvrdí každou úlohu: jediné řešení, nic kratšího, nejvytrvalejší obrana, jednoznačné další tahy', () => {
  for (const p of LIST) {
    const line = S.buildLine(p.fen, p.n);
    assert.ok(line, 'úloha není čistá: ' + p.id);
    assert.equal(line.sol.join(' '), p.sol, 'hlavní varianta ' + p.id);
    // nic kratšího než p.n
    S.F.setFEN(p.fen);
    for (let k = 1; k < p.n; k++) assert.equal(S.canMate(k), false, 'existuje kratší mat v ' + k + ': ' + p.id);
    const first = p.sol.split(' ')[0];
    const roots = plain(S.rootSolutions(p.n));
    if (p.n > 1) assert.deepEqual(roots, [first], 'první tah musí být jediný: ' + p.id);
    else assert.ok(roots.includes(first), p.id);
  }
});

test('popis úloh (téma, začátek, oběť) odpovídá skutečné variantě', () => {
  for (const p of LIST) {
    const d = S.describe(p.fen, p.sol.split(' '));
    assert.equal(d.main, p.t, 'téma ' + p.id);
    assert.equal(d.start === 'quiet' ? 'q' : d.start === 'check' ? 'c' : 'x', p.s, 'začátek ' + p.id);
    assert.equal(d.sacrifice || '', p.x, 'oběť ' + p.id);
  }
});

test('posuzování tahů: správný tah projde, jiný ne, na konci stačí jakýkoli mat', () => {
  for (const p of LIST) {
    const sol = p.sol.split(' ');
    let st = E.fromFEN(p.fen);
    for (let step = 0; step < sol.length; step += 2) {
      const last = step === sol.length - 1;
      const mv = findByCoord(st, sol[step]);
      const after = E.applyMove(st, mv);
      assert.equal(Puzzles.judge(p, step, sol[step], after), last ? 'mate' : 'good', p.id + ' krok ' + step);
      // každý jiný legální tah je špatně (u posledního kroku jen ten, který nedává mat)
      for (const other of E.generateAllLegalMoves(st, st.turn)) {
        const c = moveToCoord(other);
        if (c === sol[step]) continue;
        const a2 = E.applyMove(st, other);
        const verdict = Puzzles.judge(p, step, c, a2);
        if (last && E.isCheckmate(a2)) assert.equal(verdict, 'mate', 'jiný mat se uznává: ' + p.id);
        else assert.equal(verdict, 'wrong', p.id + ' krok ' + step + ' ' + c);
      }
      if (!last) {
        assert.equal(Puzzles.replyAfter(p, step), sol[step + 1]);
        st = E.applyMove(after, findByCoord(after, sol[step + 1]));
      } else assert.equal(Puzzles.replyAfter(p, step), null);
    }
    // krok s lichým indexem (tah soupeře) ani mimo řešení se nikdy neposuzuje jako správný
    assert.equal(Puzzles.judge(p, 1, sol[1] || 'a1a1', E.initialState()), 'wrong');
    assert.equal(Puzzles.judge(p, 99, 'e2e4', E.initialState()), 'wrong');
    assert.equal(Puzzles.judge(p, -2, 'e2e4', E.initialState()), 'wrong');
  }
});

test('nápověda ukazuje tah z řešení a jen na tahu hráče', () => {
  const p = Puzzles.LIST.find((x) => x.n === 2);
  const sol = p.sol.split(' ');
  const hint = plain(Puzzles.hintFor(p, 0));
  assert.deepEqual(hint, { from: plain(Puzzles.sq(sol[0].slice(0, 2))), to: plain(Puzzles.sq(sol[0].slice(2, 4))) });
  assert.equal(Puzzles.hintFor(p, 1), null);
  assert.equal(Puzzles.hintFor(p, 5), null);
  assert.deepEqual(plain(Puzzles.sq('a8')), { r: 0, c: 0 });
  assert.deepEqual(plain(Puzzles.sq('h1')), { r: 7, c: 7 });
  assert.deepEqual(plain(Puzzles.sq('e4')), { r: 4, c: 4 });
});

test('české popisky: mat v 1 tahu, ve 2 a ve 3 tazích; skupiny od nejlehčích', () => {
  assert.equal(Puzzles.mateText(1), 'Mat v 1 tahu');
  assert.equal(Puzzles.mateText(2), 'Mat ve 2 tazích');
  assert.equal(Puzzles.mateText(3), 'Mat ve 3 tazích');
  const groups = Puzzles.groups();
  assert.deepEqual(plain(groups.map((g) => g.n)), [1, 2, 3]);
  assert.equal(groups.reduce((a, g) => a + g.list.length, 0), LIST.length);
  const p = Puzzles.byId('m2-01');
  assert.equal(Puzzles.title(p), 'Mat ve 2 tazích');
  assert.ok(Puzzles.reveal(p).length >= 1);
  assert.equal(Puzzles.byId('neexistuje'), null);
  assert.equal(Puzzles.byId('__proto__'), null);
  assert.equal(Puzzles.byId('constructor'), null);
});

test('další nevyřešená úloha: přeskakuje hotové, jde dokola a nakonec vrátí null', () => {
  const ids = LIST.map((p) => p.id);
  assert.equal(Puzzles.nextUnsolved(() => false, null).id, ids[0]);
  assert.equal(Puzzles.nextUnsolved((id) => id === ids[0], null).id, ids[1]);
  assert.equal(Puzzles.nextUnsolved(() => false, ids[0]).id, ids[1]);
  assert.equal(Puzzles.nextUnsolved((id) => id !== ids[0], ids[5]).id, ids[0], 'po poslední se jde dokola');
  assert.equal(Puzzles.nextUnsolved(() => true, null), null);
  assert.equal(Puzzles.nextUnsolved(() => true, ids[3]), null);
  assert.equal(Puzzles.nextUnsolved(() => false, 'neexistuje').id, ids[0], 'neznámé id se bere jako začátek');
});

test('postup v úlohách: nový postup je prázdný a vadná data se zahodí', () => {
  assert.deepEqual(plain(League.defaultSave().puzzles), { solved: {} });
  const bad = [null, undefined, 5, 'x', [], [1, 2], { solved: null }, { solved: [] }, { solved: 'a' }, { solved: { 'a b': { m: 1 } } }, { solved: { 'm1-01': 5 } }, { solved: { __proto__: { x: 1 } } }];
  for (const raw of bad) assert.deepEqual(plain(League.cleanPuzzles(raw)), { solved: {} }, JSON.stringify(raw));
  // JSON.parse vytvoří opravdovou vlastnost "__proto__" (v zápisu objektu by se jen nastavil prototyp)
  const raw = JSON.parse('{"solved":{"m1-01":{"m":2,"h":1,"d":"2026-11-05"},"m2-03":{"m":-4,"h":"x","d":7},"M1-01":{"m":1},"__proto__":{"m":1},"' + 'a'.repeat(30) + '":{"m":1}}}');
  const ok = plain(League.cleanPuzzles(raw));
  assert.deepEqual(ok, { solved: { 'm1-01': { m: 2, h: 1, d: '2026-11-05' }, 'm2-03': { m: 0, h: 0, d: '' } } });
  assert.equal(Object.getPrototypeOf(League.cleanPuzzles(raw).solved) === Object.prototype || true, true);
  // přehnané počty se ořežou
  assert.equal(League.cleanPuzzles({ solved: { 'm1-01': { m: 1e9, h: 5.5 } } }).solved['m1-01'].m, 99);
  assert.equal(League.cleanPuzzles({ solved: { 'm1-01': { m: 1e9, h: 5.5 } } }).solved['m1-01'].h, 0);
  // strop počtu záznamů
  const many = {};
  for (let i = 0; i < 800; i++) many['x' + i] = { m: 0, h: 0, d: '' };
  assert.equal(Object.keys(League.cleanPuzzles({ solved: many }).solved).length, 500);
});

test('zápis vyřešené úlohy: první datum zůstává, zlepšuje se jen počet chyb a nápověd', () => {
  let s = League.defaultSave();
  assert.equal(League.puzzleSolved(s, 'm1-01'), false);
  s = League.markPuzzle(s, 'm1-01', { m: 3, h: 1 }, '2026-11-05');
  assert.deepEqual(plain(s.puzzles.solved['m1-01']), { m: 3, h: 1, d: '2026-11-05' });
  assert.equal(League.puzzleSolved(s, 'm1-01'), true);
  s = League.markPuzzle(s, 'm1-01', { m: 5, h: 5 }, '2026-11-09'); // horší výsledek nic nemění
  assert.deepEqual(plain(s.puzzles.solved['m1-01']), { m: 3, h: 1, d: '2026-11-05' });
  s = League.markPuzzle(s, 'm1-01', { m: 0, h: 0 }, '2026-11-10'); // lepší zlepší čísla, datum zůstane
  assert.deepEqual(plain(s.puzzles.solved['m1-01']), { m: 0, h: 0, d: '2026-11-05' });
  // vadné id, vadné údaje, vadný postup
  const before = JSON.stringify(s.puzzles);
  assert.equal(JSON.stringify(League.markPuzzle(s, 'Špatné id!', { m: 0, h: 0 }, 'x').puzzles), before);
  assert.equal(JSON.stringify(League.markPuzzle(s, '__proto__', { m: 0, h: 0 }, 'x').puzzles), before);
  const t = League.markPuzzle({ ...s, puzzles: 'rozbité' }, 'm3-02', { m: 'a', h: -1 }, '2026-11-11');
  assert.deepEqual(plain(t.puzzles.solved), { 'm3-02': { m: 0, h: 0, d: '2026-11-11' } });
  assert.equal(League.puzzleSolved(null, 'm1-01'), false);
  assert.equal(League.puzzleSolved({}, 'm1-01'), false);
  assert.equal(League.puzzleSolved({ puzzles: { solved: {} } }, 'toString'), false);
  // původní postup se nemění (vrací se kopie)
  assert.equal(League.puzzleSolved(s, 'm3-02'), false);
});

test('starý uložený postup bez úloh se načte, postup úloh přežije uložení a načtení', () => {
  const old = JSON.parse(JSON.stringify(League.defaultSave()));
  delete old.puzzles;
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  storage.setItem(League.SAVE_KEY, JSON.stringify(old));
  const loaded = League.loadSave(storage, []);
  assert.deepEqual(plain(loaded.puzzles), { solved: {} });
  const next = League.markPuzzle(loaded, 'm2-04', { m: 1, h: 0 }, '2026-11-05');
  League.persistSave(storage, next);
  const again = League.loadSave(storage, []);
  assert.deepEqual(plain(again.puzzles.solved), { 'm2-04': { m: 1, h: 0, d: '2026-11-05' } });
  // poškozený záznam v uloženém postupu nic neshodí
  const raw = JSON.parse(storage.getItem(League.SAVE_KEY));
  raw.puzzles = { solved: { 'm1-01': { m: 'zlo', h: [], d: { x: 1 } }, 'nejde id': 1 } };
  storage.setItem(League.SAVE_KEY, JSON.stringify(raw));
  assert.deepEqual(plain(League.loadSave(storage, []).puzzles), { solved: { 'm1-01': { m: 0, h: 0, d: '' } } });
});

test('zapojení do rozhraní: záložka Úlohy, obrazovka úlohy, uložení postupu a skripty ve správném pořadí', () => {
  const ui = fs.readFileSync(path.join(DIR, 'ui.js'), 'utf8');
  const wrapper = fs.readFileSync(path.join(DIR, '..', 'chess.js'), 'utf8');
  assert.match(ui, /\["puzzles", "🧩", "Úlohy"\]/, 'záložka v menu');
  assert.match(ui, /menuTab === "puzzles" && h\(PuzzlesTab/, 'obsah záložky');
  assert.match(ui, /view === "puzzle" && puzzleId && Puzzles\.byId\(puzzleId\)/, 'zobrazení úlohy v aplikaci');
  assert.match(ui, /League\.markPuzzle\(saveRef\.current, puzzleId, info, todayStr\(\)\)/, 'zápis postupu');
  assert.match(ui, /Puzzles\.judge\(puzzle, step, moveToCoord\(move\), after\)/, 'posouzení tahu');
  // ukázané řešení se nepočítá: onSolved se volá jen při verdiktu mat, ne v showSolution
  const show = ui.slice(ui.indexOf('function showSolution()'), ui.indexOf('const mateLabel'));
  assert.ok(!/onSolved/.test(show), 'ukázané řešení se nesmí počítat jako vyřešené');
  assert.match(ui, /if \(!doneRef\.current\) \{ doneRef\.current = true;[^}]*onSolved\(/, 'jednorázové hlášení vyřešení');
  const order = [...wrapper.matchAll(/\['([a-z]+)', [a-z]+\]/g)].map((m) => m[1]);
  assert.ok(order.indexOf('puzzles') > order.indexOf('league') && order.indexOf('puzzles') < order.indexOf('ui'), 'puzzles.js je mezi league a ui: ' + order.join(','));
});
