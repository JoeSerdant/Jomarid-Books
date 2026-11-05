/* puzzles.js - šachové úlohy "najdi mat". Čistá logika a data bez DOM, proto jde celé otestovat v Node.
   Každá úloha je pozice, ve které má strana na tahu vynucený mat v 1 až 3 tazích. Data jsou vygenerovaná z partií botů
   (tests/genPuzzles.mjs) a testy (tests/puzzles.test.mjs) je ověřují od základu: řešení je jediné, nejde to kratší cestou
   a obránce se brání nejvytrvaleji. Proto stačí přijmout přesně tah z hlavní varianty, jen u posledního tahu (mat) platí jakýkoli mat.

   Pole úlohy: id (stálé, ukládá se do postupu), n (mat v n tazích), fen (výchozí pozice), sol (hlavní varianta: tah útočníka, odpověď obránce, ...,
   mat), t (hlavní téma matu), s (první tah: q tichý, c šach, x braní), x (figura, kterou útočník obětuje, nebo ""). */
const Puzzles = (function () {
  const THEMES = {
    smothered: "Uškrcený mat", backrank: "Mat na poslední řadě", double: "Mat dvojitým šachem", discovered: "Mat odkrytým šachem",
    promotion: "Mat s proměnou pěšce", queen: "Mat dámou", rook: "Mat věží", bishop: "Mat střelcem", knight: "Mat jezdcem", pawn: "Mat pěšcem"
  };
  const PIECE_GEN = { p: "pěšce", n: "jezdce", b: "střelce", r: "věže", q: "dámy" }; // "Oběť dámy"
  const START = { q: "Tichý tah", c: "Začíná šachem", x: "Začíná braním" };

  /* __PUZZLE_DATA_BEGIN__ */
  const LIST = [
    { id: "m1-01", n: 1, t: "queen", s: "c", x: "", fen: "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2", sol: "d8h4" },
    { id: "m1-02", n: 1, t: "backrank", s: "c", x: "", fen: "1R3b1r/2p2ppp/4k3/4p2n/2P5/8/5PPP/2r1B1K1 b - - 2 22", sol: "c1e1" },
    { id: "m1-03", n: 1, t: "rook", s: "c", x: "", fen: "2k5/6R1/3P2p1/1p4Np/8/3P4/RP1K1PPP/8 w - - 2 35", sol: "a2a8" },
    { id: "m1-04", n: 1, t: "backrank", s: "c", x: "", fen: "1Q2B1k1/pp1b1ppp/3p4/4n3/1P6/8/P1P2PPP/R1B1K2R w KQ - 1 17", sol: "e8d7" },
    { id: "m1-05", n: 1, t: "rook", s: "c", x: "", fen: "3R1b1k/1R5p/5p2/p1r1n3/P3P3/5BPP/2P2PK1/8 w - - 2 31", sol: "d8f8" },
    { id: "m1-06", n: 1, t: "queen", s: "c", x: "", fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", sol: "h5f7" },
    { id: "m1-07", n: 1, t: "promotion", s: "c", x: "", fen: "1B4kr/4P1pp/2p5/3p1p2/8/5NP1/PPP2PBP/R2Q2K1 w - f6 0 21", sol: "e7e8q" },
    { id: "m1-08", n: 1, t: "smothered", s: "c", x: "", fen: "r1b1kbnr/pppp1Npp/8/8/3nq3/8/PPPPBP1P/RNBQKR2 b Qkq - 1 7", sol: "d4f3" },
    { id: "m1-09", n: 1, t: "discovered", s: "c", x: "", fen: "2k4r/1pp2ppp/5n2/1qb1K3/8/7P/2P2PP1/7R b - - 7 26", sol: "c5e3" },
    { id: "m1-10", n: 1, t: "bishop", s: "c", x: "", fen: "2kr3r/1pp2pp1/p5bp/8/1n2B2P/4p1bN/PP4P1/RKB3R1 b - - 6 26", sol: "g6e4" },
    { id: "m1-11", n: 1, t: "double", s: "c", x: "", fen: "1rk2r2/2pR3R/p2pB3/1b6/4P2Q/1p2K3/PPP3P1/8 w - - 3 36", sol: "d7c7" },
    { id: "m1-12", n: 1, t: "knight", s: "c", x: "", fen: "2b1k1nr/rppp3p/2n5/3p4/8/2PK4/P1P2qP1/R4B2 b k - 3 19", sol: "c6e5" },
    { id: "m1-13", n: 1, t: "backrank", s: "c", x: "", fen: "Q4r1k/1p4pp/2p5/5p2/2B5/7P/PPP2PP1/R1B1K2R w KQ - 3 19", sol: "a8f8" },
    { id: "m1-14", n: 1, t: "queen", s: "c", x: "", fen: "5br1/p2k2pp/Pp6/4pp2/3p4/1Pq2b2/5P1P/R4K2 b - - 4 34", sol: "c3a1" },
    { id: "m1-15", n: 1, t: "queen", s: "c", x: "", fen: "4kb1r/3ppppp/4P3/7q/3K4/5b2/P1r2n1P/R7 b k - 1 21", sol: "h5c5" },
    { id: "m1-16", n: 1, t: "pawn", s: "c", x: "", fen: "r3kb1r/pp3pp1/3p3p/8/6b1/P4p2/2q3PP/3R1BKR b kq - 1 17", sol: "f3f2" },
    { id: "m1-17", n: 1, t: "queen", s: "c", x: "", fen: "3r1b1r/ppp1pkp1/8/5n2/8/P7/2P1KPPP/q5NR b - - 2 14", sol: "a1d1" },
    { id: "m1-18", n: 1, t: "knight", s: "c", x: "", fen: "r3kb1r/pp2pppp/2n2n2/4Pb2/8/8/P1P1KPPP/2q2B1R b kq - 4 15", sol: "c6d4" },
    { id: "m1-19", n: 1, t: "rook", s: "c", x: "", fen: "rq1k4/pp4Q1/3p4/2pP4/2P4r/8/PP1BB1PP/5RK1 w - - 5 27", sol: "f1f8" },
    { id: "m1-20", n: 1, t: "smothered", s: "c", x: "", fen: "r1b1k2r/ppp1ppbp/6p1/3Pn3/4q3/8/PP1BNPPP/R2QKB1R b KQkq - 2 10", sol: "e5d3" },
    { id: "m1-21", n: 1, t: "bishop", s: "c", x: "", fen: "1rq1r2k/p1pbp3/6Q1/3p4/2PP1B2/2N5/PP3PPP/2KR1B1R w - - 2 19", sol: "f4e5" },
    { id: "m1-22", n: 1, t: "bishop", s: "c", x: "", fen: "1r1k3r/1b1p1ppp/3bp3/6q1/3p4/P7/1nK2PPP/R6R b - - 3 22", sol: "b7e4" },
    { id: "m1-23", n: 1, t: "queen", s: "c", x: "", fen: "4r3/1p2B1pp/2k1b3/p1N5/P4Q2/8/1PP1KPPP/R1R5 w - - 6 24", sol: "f4d6" },
    { id: "m2-01", n: 2, t: "bishop", s: "c", x: "", fen: "rnbk1b1r/pp3ppp/2p5/4q3/4n3/8/PPPB1PPP/2KR1BNR w - - 0 10", sol: "d2g5 d8c7 g5d8" },
    { id: "m2-02", n: 2, t: "knight", s: "c", x: "", fen: "rn1qkbnr/ppp2p1p/3p2p1/4N3/2B1P3/2N5/PPPP1PPP/R1BbK2R w KQkq - 0 6", sol: "c4f7 e8e7 c3d5" },
    { id: "m2-03", n: 2, t: "double", s: "c", x: "", fen: "r1b2r2/2pp3p/1p3pp1/3k4/p1R3PB/1B3N2/P1P2P1P/4R1K1 w - - 2 26", sol: "e1d1 d5e6 c4e4" },
    { id: "m2-04", n: 2, t: "discovered", s: "q", x: "", fen: "1r2kb1r/1pK2ppp/3p1n2/4q3/1P2P3/8/P1P5/8 b - - 4 29", sol: "f6d7 a2a3 d6d5" },
    { id: "m2-05", n: 2, t: "rook", s: "c", x: "q", fen: "4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 1 17", sol: "b3b8 d7b8 d1d8" },
    { id: "m2-06", n: 2, t: "pawn", s: "x", x: "", fen: "3rr1k1/ppp2ppp/2p5/8/1KP1n3/8/P5qP/8 b - - 7 24", sol: "g2a2 c4c5 a7a5" },
    { id: "m2-07", n: 2, t: "bishop", s: "c", x: "n", fen: "4r3/2p1n1p1/1kb5/p3K1Pp/5P2/8/7P/8 b - - 3 51", sol: "e7f5 e5f5 c6e4" },
    { id: "m2-08", n: 2, t: "knight", s: "q", x: "", fen: "3k2r1/1pR3p1/8/PP1p3p/3N3P/6B1/2P3P1/1K2R3 w - - 3 55", sol: "e1e7 b7b6 d4c6" },
    { id: "m2-09", n: 2, t: "knight", s: "q", x: "", fen: "1rb4r/pp1k2p1/3b3p/P4p2/2pp4/5K2/1PnP1PPP/2B3N1 b - - 2 27", sol: "h8e8 a5a6 c2e1" },
    { id: "m2-10", n: 2, t: "pawn", s: "q", x: "", fen: "6k1/2p3bp/p7/1p1K1n2/1P4p1/P1r5/3p1r2/6R1 b - - 5 52", sol: "f2e2 g1g4 c7c6" },
    { id: "m2-11", n: 2, t: "bishop", s: "q", x: "", fen: "r3r1k1/pp3p1p/4b1p1/1K6/8/8/P1P4P/q7 b - - 1 23", sol: "a1c3 a2a3 e6d7" },
    { id: "m2-12", n: 2, t: "queen", s: "c", x: "b", fen: "5rk1/1p3pp1/p1b5/7p/4p2P/PKP1P3/4qPP1/5N2 b - - 1 37", sol: "c6a4 b3a4 e2b5" },
    { id: "m2-13", n: 2, t: "queen", s: "q", x: "", fen: "r3k2r/p1p2ppp/K2p4/5q2/8/P7/2P3bP/8 b kq - 2 23", sol: "f5c5 a3a4 c5b6" },
    { id: "m2-14", n: 2, t: "knight", s: "q", x: "", fen: "r1b4r/p1p2kp1/p1n1pn1p/3p4/1P1P4/3K4/1q3PPP/5B1R b - - 2 22", sol: "f6g4 b4b5 c6b4" },
    { id: "m2-15", n: 2, t: "backrank", s: "c", x: "q", fen: "1kb1r3/1p1p1p1p/p2P4/2P5/4q3/P7/5PPP/R5K1 b - - 0 21", sol: "e4e1 a1e1 e8e1" },
    { id: "m2-16", n: 2, t: "backrank", s: "c", x: "q", fen: "4r2k/1pp2Qpp/p1b5/4r3/2P5/PP6/3P2PP/R1B2RK1 w - - 1 18", sol: "f7f8 e8f8 f1f8" },
    { id: "m2-17", n: 2, t: "queen", s: "q", x: "", fen: "r3k3/ppp4p/5n2/P7/5bb1/3P1P2/4K3/q7 b q - 0 27", sol: "g4h3 a5a6 a1f1" },
    { id: "m2-18", n: 2, t: "promotion", s: "c", x: "r", fen: "4k2r/3b3P/3Pp2R/1pr1Pp2/p2pBP2/P7/2P1NK2/6R1 w - - 1 53", sol: "g1g8 h8g8 h7g8q" },
    { id: "m2-19", n: 2, t: "rook", s: "c", x: "r", fen: "5rk1/3b2p1/2pb4/p2p2Bp/P2P2n1/1PN5/1RP2rP1/2R4K b - - 7 32", sol: "f2f1 c1f1 f8f1" },
    { id: "m2-20", n: 2, t: "bishop", s: "c", x: "q", fen: "8/q3bk2/4b3/5pp1/8/Q7/1P6/KN3q2 b - - 2 54", sol: "a7a3 b2a3 e7f6" },
    { id: "m2-21", n: 2, t: "queen", s: "c", x: "n", fen: "r4b1r/ppp1kp1p/2q2p2/8/1NNQP3/8/PP3PPP/R2R2K1 w - - 7 21", sol: "b4c6 b7c6 d4d7" },
    { id: "m2-22", n: 2, t: "backrank", s: "c", x: "q", fen: "3r2kr/ppp1Qppp/8/3q4/P4P1P/8/1PPN1KP1/R1B1R3 w - - 3 19", sol: "e7e8 d8e8 e1e8" },
    { id: "m2-23", n: 2, t: "queen", s: "c", x: "n", fen: "1rb2bnr/3nkpp1/pp1N1q2/4p1Bp/2N1P1Q1/8/PPP2PPP/2KR1B1R w - h6 0 12", sol: "d6c8 b8c8 g4d7" },
    { id: "m2-24", n: 2, t: "backrank", s: "c", x: "n", fen: "2b2knr/ppN1nppp/4q3/Q3N3/3P4/3B4/PPP3PP/R4K1R w - - 7 18", sol: "c7e6 c8e6 a5d8" },
    { id: "m2-25", n: 2, t: "rook", s: "c", x: "r", fen: "2r3k1/1pr2ppp/p2b1q2/8/1P2p1b1/P6N/R2P1P2/1Q2K2R b K - 1 27", sol: "c7c1 b1c1 c8c1" },
    { id: "m2-26", n: 2, t: "rook", s: "q", x: "q", fen: "4r2k/1Qp2p2/3b1N2/7P/P6P/5K2/1PPP4/R1B3R1 w - - 3 29", sol: "b7e4 e8e4 g1g8" },
    { id: "m2-27", n: 2, t: "rook", s: "x", x: "b", fen: "2k2b2/ppn2pp1/2n5/8/4pPb1/P2qP3/1P1B2Pr/R1KR4 b - - 3 20", sol: "g4d1 c1d1 h2h1" },
    { id: "m3-01", n: 3, t: "pawn", s: "q", x: "", fen: "5br1/1pp2pp1/3kb2p/7P/3K1P2/r1p5/6P1/6R1 b - f3 0 22", sol: "c3c2 d4e4 f7f5 e4d4 c7c5" },
    { id: "m3-02", n: 3, t: "promotion", s: "q", x: "", fen: "4R3/2P2p1p/5k2/8/6p1/2N4P/P3R1P1/6K1 w - - 0 44", sol: "e8g8 g4h3 c3d5 f6f5 c7c8b" },
    { id: "m3-03", n: 3, t: "discovered", s: "x", x: "", fen: "r2k4/4Rppr/p1pB3p/8/2B5/8/PPP2PPP/3R2K1 w - - 5 31", sol: "c4f7 a8a7 e7e8 d8d7 d6b8" },
    { id: "m3-04", n: 3, t: "rook", s: "q", x: "", fen: "3r4/2p2p2/8/1Nkp1Ppp/1R6/B2P3P/P1PK2P1/4R3 w - g6 0 28", sol: "b5a7 c5d6 b4b6 d6d7 e1e7" },
    { id: "m3-05", n: 3, t: "knight", s: "q", x: "", fen: "2r2k2/5B2/p5Q1/4N1p1/8/8/1P1K1PPP/7R w - - 7 35", sol: "g6f6 c8c2 d2c2 a6a5 e5d7" },
    { id: "m3-06", n: 3, t: "bishop", s: "q", x: "", fen: "rnb2b2/ppp4R/3qpk2/1B1p4/3P1P2/2N1Q3/PPP1N3/2K5 w - - 1 20", sol: "e3g3 d6f4 g3f4 f6g6 b5d3" },
    { id: "m3-07", n: 3, t: "queen", s: "c", x: "b", fen: "rn2Qb1r/ppp3pp/8/8/5K2/1Pk1B3/P1q5/R7 w - - 1 27", sol: "e3d4 c3d4 e8e5 d4d3 e5e3" },
    { id: "m3-08", n: 3, t: "rook", s: "c", x: "r", fen: "r7/1rp2B1k/1pp1P2p/3p1n2/P1PPb3/K7/1B1b2p1/6R1 b - - 14 46", sol: "a8a4 a3a4 e4c2 a4a3 b7a7" },
    { id: "m3-09", n: 3, t: "rook", s: "q", x: "", fen: "2k3r1/2pb1p1p/r5p1/7P/8/8/2P2PPK/3q4 b - - 0 29", sol: "d1g4 f2f3 g4h4 h2g1 a6a1" },
    { id: "m3-10", n: 3, t: "knight", s: "q", x: "", fen: "3R4/2p2pp1/p1k5/2nN4/6Q1/8/PBP2PP1/4K3 w - - 3 34", sol: "g4b4 c5d3 c2d3 a6a5 d5e7" },
    { id: "m3-11", n: 3, t: "queen", s: "c", x: "r", fen: "2r4r/Q1p1kppp/3p4/1K4P1/7P/3P1b2/P4q2/8 b - - 0 38", sol: "c8b8 a7b8 h8b8 b5a4 f2a2" },
    { id: "m3-12", n: 3, t: "backrank", s: "c", x: "r", fen: "2b3k1/2p1rp1p/4p1p1/pr6/8/P2qB3/5PPP/R5K1 b - - 0 21", sol: "b5b1 a1b1 d3b1 e3c1 b1c1" },
    { id: "m3-13", n: 3, t: "bishop", s: "c", x: "q", fen: "3R4/2p2pBp/4k1p1/2r1Pp2/pqP4P/5QP1/PP2BP2/1K3R2 w - - 7 32", sol: "f3d5 c5d5 c4d5 e6e7 g7f6" },
    { id: "m3-14", n: 3, t: "rook", s: "c", x: "q", fen: "2kr3r/p4ppp/2p2n2/8/6b1/N3B1P1/P1P2PKP/q6R b - - 1 19", sol: "a1h1 g2h1 g4f3 h1g1 d8d1" },
    { id: "m3-15", n: 3, t: "queen", s: "c", x: "n", fen: "r2qkb1r/5ppp/2n5/1B2p3/1n6/1NK3Q1/PPP2PbP/R1B4R b kq - 1 16", sol: "b4a2 a1a2 f8b4 c3c4 d8d5" },
    { id: "m3-16", n: 3, t: "queen", s: "c", x: "n", fen: "r3k1nr/p1q2p1p/8/1p2n3/3Kp1p1/7P/PP5q/R1B2Q2 b kq - 1 25", sol: "e5f3 f1f3 c7c4 d4e3 c4d3" },
    { id: "m3-17", n: 3, t: "bishop", s: "c", x: "r", fen: "1r6/k1p2pp1/p1r1p3/P2pP2p/Q2b3P/3q1NP1/K2N4/4R2R b - - 1 50", sol: "c6c2 a4c2 d3c2 a2a3 d4c5" },
    { id: "m3-18", n: 3, t: "queen", s: "q", x: "r", fen: "2b1k2r/1pp2ppp/8/3qb3/6n1/1P3p2/r1P2P2/4R2K b k - 0 20", sol: "a2a1 e1a1 e5a1 b3b4 d5d1" },
  ];
  /* __PUZZLE_DATA_END__ */

  const BY_ID = {};
  LIST.forEach((p) => { BY_ID[p.id] = p; });

  function byId(id) { return Object.prototype.hasOwnProperty.call(BY_ID, id) ? BY_ID[id] : null; }
  function solution(p) { return p.sol.split(" "); }
  function sq(name) { return { r: 8 - Number(name[1]), c: name.charCodeAt(0) - 97 }; }
  // "Mat v 1 tahu", "Mat ve 2 tazích" (správný tvar předložky a pádu podle počtu tahů)
  function mateText(n) { return n === 1 ? "Mat v 1 tahu" : "Mat ve " + n + " tazích"; }
  function title(p) { return mateText(p.n); }
  function themeLabel(p) { return THEMES[p.t] || ""; }
  // Co o úloze prozradí její tah (ukazuje se až po vyřešení, aby nebyla prozrazena myšlenka předem).
  function reveal(p) {
    const out = [];
    if (THEMES[p.t]) out.push(THEMES[p.t]);
    if (p.x && PIECE_GEN[p.x]) out.push("Oběť " + PIECE_GEN[p.x]);
    else if (START[p.s]) out.push(START[p.s]);
    return out;
  }
  // Skupiny podle délky matu, v pořadí od nejlehčích; úlohy uvnitř skupiny jsou seřazené podle obtížnosti.
  function groups() {
    const out = [];
    for (let n = 1; n <= 3; n++) {
      const list = LIST.filter((p) => p.n === n);
      if (list.length) out.push({ n, label: mateText(n), list });
    }
    return out;
  }
  // Posuzuje tah hráče. step = index v hlavní variantě, nextState = pozice po tahu hráče (rules.js), coord = tah jako souřadnice.
  // Vrací "mate" (úloha vyřešena), "good" (správný mezitah, soupeř odpoví) nebo "wrong".
  function judge(p, step, coord, nextState) {
    const sol = solution(p);
    if (step < 0 || step >= sol.length || step % 2 !== 0) return "wrong";
    if (step === sol.length - 1) return ChessEngine.isCheckmate(nextState) ? "mate" : "wrong";
    return coord === sol[step] ? "good" : "wrong";
  }
  // Tah, který má hráč zahrát (pro nápovědu): { from, to } jako řádek/sloupec, nebo null.
  function hintFor(p, step) {
    const sol = solution(p);
    if (step < 0 || step >= sol.length || step % 2 !== 0) return null;
    return { from: sq(sol[step].slice(0, 2)), to: sq(sol[step].slice(2, 4)) };
  }
  // Odpověď soupeře po správném tahu hráče na pozici step (souřadnice), nebo null.
  function replyAfter(p, step) {
    const sol = solution(p);
    return step + 1 < sol.length ? sol[step + 1] : null;
  }
  // Další nevyřešená úloha za úlohou afterId (dokola); bez afterId první nevyřešená. isSolved(id) -> boolean. Vrací úlohu nebo null, když jsou všechny hotové.
  function nextUnsolved(isSolved, afterId) {
    const n = LIST.length;
    if (!n) return null;
    const start = afterId ? LIST.findIndex((p) => p.id === afterId) + 1 : 0;
    for (let i = 0; i < n; i++) {
      const p = LIST[(start + i) % n];
      if (!isSolved(p.id)) return p;
    }
    return null;
  }

  return { LIST, THEMES, byId, solution, sq, mateText, title, themeLabel, reveal, groups, judge, hintFor, replyAfter, nextUnsolved };
})();
