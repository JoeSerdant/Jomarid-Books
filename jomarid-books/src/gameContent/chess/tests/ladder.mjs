// Měření žebříčku botů: odehraje partie mezi sousedními boty a vypíše skutečný odstup v Elo.
// Pouští se ručně (trvá minuty), ne jako součást testů:
//
//   npm run chess:ladder                 # 60 partií na dvojici
//   node src/gameContent/chess/tests/ladder.mjs 120 4   # 120 partií na dvojici, 4 vlákna
//
// K čemu to je: nominální ratingy botů (bots.js) jsou nastavené podle takového měření (odstupy ~350 Elo,
// silnější bot vyhrává přibližně 88 % partií). Když se změní hodnocení pozice, hledání nebo parametry
// botů, rozestupy se můžou posunout - tímhle skriptem se dá ověřit, že pořád sedí.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadGame } from './load.mjs';

const OPENINGS = [
  'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6', 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4', 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6', 'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7',
  'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6', 'g1f3 d7d5 g2g3 g8f6 f1g2 e7e6', 'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6', 'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4',
  'd2d4 d7d5 g1f3 g8f6 c1f4 e7e6', 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6', 'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5', 'e2e4 g7g6 d2d4 f8g7 b1c3 d7d6'
].map((s) => s.split(' '));

// Jedna partie dvou botů (bez knihy - zahájení se losuje z tabulky výše, aby dvojice nehrály pořád totéž).
function playGame(get, job) {
  const F = get('FastChess'), E = get('ChessEngine'), B = get('Bots');
  const coord = get('moveToCoord'), findByCoord = get('findMoveByCoord');
  let st = E.initialState(); const hist = []; const counts = {};
  const bump = () => { const k = E.positionKey(st); counts[k] = (counts[k] || 0) + 1; return counts[k]; };
  bump();
  for (const c of OPENINGS[job.opening]) { hist.push(c); st = E.applyMove(st, findByCoord(st, c)); bump(); }
  F.handle({ type: 'newgame' });
  const params = (idx) => Object.assign({}, B.BOTS[idx].params, { timeMs: 10000 });
  for (let ply = hist.length; ply < 300; ply++) {
    const legal = E.generateAllLegalMoves(st, st.turn);
    if (legal.length === 0) return E.isCheckmate(st) ? (st.turn === 'w' ? 'black' : 'white') : 'draw';
    if (E.insufficientMaterial(st) || st.halfmoveClock >= 100) return 'draw';
    const idx = st.turn === 'w' ? job.white : job.black;
    const r = F.handle({ type: 'search', moves: hist, seed: job.seed * 1000 + ply, params: params(idx) });
    const m = findByCoord(st, r.best);
    hist.push(coord(m)); st = E.applyMove(st, m);
    if (bump() >= 3) return 'draw';
  }
  return 'draw';
}

if (!isMainThread) {
  const get = loadGame();
  parentPort.postMessage(workerData.jobs.map((job) => ({ ...job, res: playGame(get, job) })));
} else {
  const games = parseInt(process.argv[2] || '60', 10);
  const threads = parseInt(process.argv[3] || '4', 10);
  const get = loadGame();
  const B = get('Bots');
  const eloOf = (s) => (s <= 0 ? -999 : s >= 1 ? 999 : -400 * Math.log10(1 / s - 1));
  console.log(`Odstupy sousedních botů (${games} partií na dvojici, ${threads} vlákna)\n`);
  for (let strong = B.BOTS.length - 1; strong >= 1; strong--) {
    const weak = strong - 1;
    const jobs = [];
    for (let g = 0; g < games; g++) jobs.push({ white: g % 2 === 0 ? strong : weak, black: g % 2 === 0 ? weak : strong, strongIsWhite: g % 2 === 0, opening: Math.floor(g / 2) % OPENINGS.length, seed: g + 1 });
    const chunks = Array.from({ length: threads }, () => []);
    jobs.forEach((j, i) => chunks[i % threads].push(j));
    const t0 = Date.now();
    const results = (await Promise.all(chunks.filter((c) => c.length).map((c) => new Promise((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { jobs: c } });
      w.on('message', resolve); w.on('error', reject);
    })))).flat();
    let pts = 0;
    for (const r of results) pts += r.res === 'draw' ? 0.5 : (r.res === 'white') === r.strongIsWhite ? 1 : 0;
    const score = pts / results.length;
    const nominal = B.BOTS[strong].rating - B.BOTS[weak].rating;
    console.log(`${B.BOTS[strong].name.padEnd(14)} proti ${B.BOTS[weak].name.padEnd(14)} ${(score * 100).toFixed(0).padStart(3)} %   naměřeno ${eloOf(score).toFixed(0).padStart(4)} Elo   (nominálně ${nominal})   ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
