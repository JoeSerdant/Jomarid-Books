// Generátor šachových úloh: odehraje partie slabých botů (ti často přehlédnou mat), v každé pozici zkusí najít
// vynucený mat v 1 až 3 tazích a nechá si jen čisté úlohy (jednoznačné řešení, žádný kratší mat, viz puzzleTools.mjs).
// Pouští se ručně (trvá minuty), ne jako součást testů. Výstup je JSON řádky, ze kterých se pak ručně vybírají úlohy do puzzles.js:
//
//   node src/gameContent/chess/tests/genPuzzles.mjs 400 4 > kandidati.jsonl     # 400 partií, 4 vlákna
//
// Hotová data se v testech (puzzles.test.mjs) znovu ověřují od základu, takže se na tenhle skript není třeba spoléhat.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadGame } from './load.mjs';
import { createSolver } from './puzzleTools.mjs';

const OPENINGS = [
  'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6', 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4', 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6', 'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7',
  'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6', 'g1f3 d7d5 g2g3 g8f6 f1g2 e7e6', 'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6', 'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4',
  'd2d4 d7d5 g1f3 g8f6 c1f4 e7e6', 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6', 'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5', 'e2e4 g7g6 d2d4 f8g7 b1c3 d7d6',
  'e2e4 e7e5 f2f4 e5f4 g1f3 g7g5', 'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6', 'd2d4 e7e5 d4e5 b8c6 g1f3 d8e7', 'e2e4 b8c6 d2d4 d7d5 e4e5 c8f5',
  'c2c4 c7c5 g1f3 g8f6 b1c3 b8c6', 'e2e4 e7e5 b1c3 g8f6 f2f4 d7d5', 'd2d4 g8f6 c1g5 e7e6 e2e4 h7h6', 'e2e4 a7a6 d2d4 b7b5 f1d3 c8b7'
].map((s) => s.split(' '));

// Slabší nastavení než u botů v hře, ať partie obsahují přehlédnuté matové útoky a hodně taktiky.
const PRESETS = [
  { depth: 2, nodes: 6000, timeMs: 400, qd: 0, evalLevel: 0, margin: 60, temperature: 20, blunder: 0.06, blunderRange: 350, ttBits: 14, key: 'g-pip' },
  { depth: 1, nodes: 3000, timeMs: 200, qd: 0, evalLevel: 0, margin: 0, temperature: 90, blunder: 0.12, blunderRange: 500, ttBits: 14, key: 'g-wild' },
  { depth: 2, nodes: 20000, timeMs: 400, qd: 4, evalLevel: 1, margin: 25, temperature: 8, blunder: 0.03, blunderRange: 400, ttBits: 15, key: 'g-mid' },
  { depth: 1, nodes: 8000, timeMs: 300, qd: 3, evalLevel: 0, margin: 20, temperature: 40, blunder: 0.05, blunderRange: 400, ttBits: 14, key: 'g-low' }
];

function rng(seed) { let t = seed >>> 0; return () => { t = (t + 0x6d2b79f5) >>> 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

function run(seeds) {
  const get = loadGame();
  const S = createSolver(get);
  const F = S.F, E = S.E;
  const out = [];
  for (const seed of seeds) {
    const r = rng(seed * 7919 + 13);
    const pw = PRESETS[Math.floor(r() * PRESETS.length)], pb = PRESETS[Math.floor(r() * PRESETS.length)];
    const op = OPENINGS[Math.floor(r() * OPENINGS.length)];
    let st = E.initialState();
    const hist = [];
    for (const c of op) { hist.push(c); st = E.applyMove(st, S.findByCoord(st, c)); }
    F.handle({ type: 'newgame' });
    for (let ply = hist.length; ply < 160; ply++) {
      const legal = E.generateAllLegalMoves(st, st.turn);
      if (legal.length === 0 || E.insufficientMaterial(st) || st.halfmoveClock >= 100) break;
      // pozice před tahem: zkus najít úlohu pro stranu na tahu
      if (ply >= 8 && !E.isInCheck(st, st.turn)) {
        const fen = E.toFEN(st);
        if (S.pieceCount(fen) >= 6) {
          F.setFEN(fen);
          const n = S.shortestMate(3);
          if (n) {
            const line = S.buildLine(fen, n);
            if (line) {
              const info = S.describe(fen, line.sol);
              F.setFEN(fen);
              out.push({ seed, ply, fen, n, sol: line.sol, finals: line.finals, pieces: S.pieceCount(fen), legal: legal.length, ...info });
            }
          }
        }
      }
      const params = Object.assign({}, st.turn === 'w' ? pw : pb);
      const res = F.handle({ type: 'search', moves: hist, seed: seed * 1000 + ply, params });
      if (!res || !res.best) break;
      const m = S.findByCoord(st, res.best);
      if (!m) break;
      hist.push(res.best); st = E.applyMove(st, m);
    }
  }
  return out;
}

if (!isMainThread) {
  parentPort.postMessage(run(workerData.seeds));
} else {
  const games = parseInt(process.argv[2] || '100', 10);
  const threads = parseInt(process.argv[3] || '4', 10);
  const first = parseInt(process.argv[4] || '1', 10);
  const chunks = Array.from({ length: threads }, () => []);
  for (let g = 0; g < games; g++) chunks[g % threads].push(first + g);
  const results = (await Promise.all(chunks.filter((c) => c.length).map((c) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { seeds: c } });
    w.on('message', resolve); w.on('error', reject);
  })))).flat();
  for (const x of results) console.log(JSON.stringify(x));
  console.error(`partií ${games}, kandidátů ${results.length} (mat v 1: ${results.filter((x) => x.n === 1).length}, v 2: ${results.filter((x) => x.n === 2).length}, v 3: ${results.filter((x) => x.n === 3).length})`);
}
