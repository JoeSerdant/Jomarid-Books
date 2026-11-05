// České popisky pro čtečky obrazovky: názvy figur a polí, věta o tahu, věta o výběru figury a zapojení klávesnice do rozhraní.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadGame, plain, DIR } from './load.mjs';

const get = loadGame();
const E = get('ChessEngine');
const Speech = get('Speech');
const findByCoord = get('findMoveByCoord');

const say = (fen, coord) => {
  const st = E.fromFEN(fen);
  const mv = findByCoord(st, coord);
  assert.ok(mv, 'tah ' + coord + ' v ' + fen);
  return Speech.describeMove(mv, E.applyMove(st, mv));
};

test('názvy figur se shodují v rodě: bílá věž a dáma, bílý pěšec, jezdec, střelec a král', () => {
  const want = {
    w: { p: 'bílý pěšec', n: 'bílý jezdec', b: 'bílý střelec', r: 'bílá věž', q: 'bílá dáma', k: 'bílý král' },
    b: { p: 'černý pěšec', n: 'černý jezdec', b: 'černý střelec', r: 'černá věž', q: 'černá dáma', k: 'černý král' }
  };
  for (const color of ['w', 'b']) for (const type of Object.keys(want[color])) assert.equal(Speech.pieceLabel({ type, color }), want[color][type]);
});

test('názvy polí: a8 vlevo nahoře, h1 vpravo dole (řada 0 je 8. řada)', () => {
  assert.equal(Speech.sqName(0, 0), 'a8');
  assert.equal(Speech.sqName(7, 7), 'h1');
  assert.equal(Speech.sqName(4, 4), 'e4');
  assert.equal(Speech.sqName(7, 0), 'a1');
  assert.equal(Speech.sqName(0, 7), 'h8');
});

test('popisek pole: figura nebo prázdné pole, vybráno, možný tah (i s braním) a král v šachu', () => {
  assert.equal(Speech.squareLabel(6, 4, { type: 'p', color: 'w' }), 'e2, bílý pěšec');
  assert.equal(Speech.squareLabel(4, 4, null), 'e4, prázdné pole');
  assert.equal(Speech.squareLabel(6, 4, { type: 'p', color: 'w' }, { selected: true }), 'e2, bílý pěšec, vybráno');
  assert.equal(Speech.squareLabel(4, 4, null, { target: true }), 'e4, prázdné pole, možný tah');
  assert.equal(Speech.squareLabel(3, 3, { type: 'n', color: 'b' }, { target: true, capture: true }), 'd5, černý jezdec, možný tah s braním');
  assert.equal(Speech.squareLabel(0, 4, { type: 'k', color: 'b' }, { check: true }), 'e8, černý král, král v šachu');
});

test('věta o tahu: běžný tah, braní, šach, mat, rošády, braní mimochodem a proměna', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.equal(say(start, 'e2e4'), 'pěšcem z e2 na e4.');
  assert.equal(say(start, 'g1f3'), 'jezdcem z g1 na f3.');
  // pastýřský mat: dáma bere pěšce f7 a dává mat
  assert.equal(say('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'h5f7'), 'dámou z h5 na f7, bere pěšce. Mat.');
  // šach bez matu
  assert.equal(say('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1', 'e2e7'), 'věží z e2 na e7. Šach.');
  // rošády
  assert.equal(say('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1'), 'malá rošáda.');
  assert.equal(say('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1c1'), 'velká rošáda.');
  // braní mimochodem
  assert.equal(say('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6'), 'pěšcem z e5 na d6, bere pěšce mimochodem.');
  // proměna s braním a výměna za jezdce (dává šach)
  assert.equal(say('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7b8n'), 'pěšcem z a7 na b8, bere jezdce, mění se na jezdce.');
  assert.equal(say('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8q'), 'pěšcem z a7 na a8, mění se na dámu. Šach.');
  assert.equal(say('7k/6P1/8/8/8/8/8/4K3 w - - 0 1', 'g7g8r'), 'pěšcem z g7 na g8, mění se na věž. Šach.');
  assert.equal(say('k7/1PK5/8/8/8/8/8/8 w - - 0 1', 'b7b8q'), 'pěšcem z b7 na b8, mění se na dámu. Mat.');
});

test('věta o výběru: kam figura může, bez opakování cílů; figura bez tahů to řekne', () => {
  const start = E.initialState();
  const sel = (r, c) => Speech.describeSelection(start.board[r][c], r, c, E.generateLegalMoves(start, r, c));
  assert.equal(sel(6, 4), 'Vybráno: bílý pěšec na e2. Možné tahy: e3, e4.');
  assert.equal(sel(7, 6), 'Vybráno: bílý jezdec na g1. Možné tahy: f3, h3.');
  assert.equal(sel(7, 0), 'Vybráno: bílá věž na a1. Tahle figura teď nemůže táhnout.');
  // proměna nabízí čtyři tahy na stejné pole, ale pole se řekne jednou
  const st = E.fromFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const moves = E.generateLegalMoves(st, 1, 0);
  assert.equal(moves.length, 4);
  assert.equal(Speech.describeSelection(st.board[1][0], 1, 0, moves), 'Vybráno: bílý pěšec na a7. Možné tahy: a8.');
});

test('všechny kombinace figur a barev mají popisek bez "undefined" a bez prázdných míst', () => {
  for (const color of ['w', 'b']) for (const type of ['p', 'n', 'b', 'r', 'q', 'k']) {
    const t = Speech.pieceLabel({ type, color });
    assert.ok(/^[a-zěščřžýáíéúůďťň ]+$/i.test(t) && !/undefined/.test(t), t);
  }
  for (const [type, names] of Object.entries(plain(Speech.PIECE_CZ))) assert.equal(names.length, 4, type);
});

test('zapojení do rozhraní: obě obrazovky mají klávesnici, hlášení a popisky polí; mřížka má řady a jedno políčko v pořadí tabulátoru', () => {
  const ui = fs.readFileSync(path.join(DIR, 'ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
  assert.equal((ui.match(/keyboard: true, onCancel:/g) || []).length, 2, 'hra i úloha zapínají klávesnici');
  assert.match(ui, /role: keyboard \? "grid" : undefined/);
  assert.match(ui, /role: keyboard \? "row" : undefined/);
  assert.match(ui, /sqProps\.role = "gridcell"/);
  assert.match(ui, /sqProps\.tabIndex = cur\.vr === dr && cur\.vc === dc \? 0 : -1/, 'jediné políčko v pořadí tabulátoru');
  assert.match(ui, /Speech\.squareLabel\(r, c, piece,/);
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', 'Escape']) assert.ok(ui.includes('"' + key + '"'), key);
  // šipky pracují s viditelnou polohou (data-vsq), takže sedí i na otočené desce
  assert.match(ui, /"data-vsq"\] = dr \+ "," \+ dc/);
  // hlášení: tahy hráče i bota, výběr, konec hry a odpověď soupeře v úloze
  assert.match(ui, /announce\(\(data\.byBot \? session\.bot\.name : "Ty"\) \+ ": " \+ describeMove\(m, data\.state\)\)/);
  assert.match(ui, /announce\("Konec hry: "/);
  assert.equal((ui.match(/announce\(describeSelection\(/g) || []).length, 2, 'výběr figury se hlásí ve hře i v úloze');
  assert.match(ui, /"Soupeř zahrál " \+ describeMove\(mvR, afterR\)/);
  assert.match(ui, /className: "sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true"/);
  assert.match(css, /\.sr-only \{[^}]*clip: rect\(0 0 0 0\)/);
  assert.match(css, /\.board-row \{ display: contents; \}/);
  assert.match(css, /\.square:focus-visible \{ outline: 4px solid var\(--blue\)/);
  // prohlížení partie (rozbor) zůstává bez klávesnice: nemá keyboard
  const review = ui.slice(ui.indexOf('function ReviewScreen'), ui.indexOf('// ---------- Šachové úlohy'));
  assert.ok(!/keyboard: true/.test(review));
});
