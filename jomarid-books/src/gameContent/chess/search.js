/* search.js - rychlý šachový engine pro boty a rozbor partií.
   Deska 0x88 v typovaných polích, make/unmake, Zobristův hash, hashovací tabulka, quiescence,
   null-move, LMR a vyvážené hodnocení pozice (střední hra / koncovka). Nad hledáním sedí
   "lidský" výběr tahu (teplota, přehlédnutí, preference), aby boti nehráli jako stroje.

   Soubor běží ve Web Workeru (sestaví se z jeho textu) i v hlavním vlákně jako záloha - proto
   žádné DOM API. Souřadnice: sq = řada * 16 + sloupec, řada 0 = 8. řada (stejně jako rules.js). */
const FastChess = (function () {
  "use strict";

  // ---------- Konstanty ----------
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const MATE = 30000, INF = 32000, MATE_BOUND = MATE - 300;
  const MAX_PLY = 72, MAX_STACK = 2048, MPP = 320; // MPP = místo pro tahy na jedno patro hledání
  const F_DOUBLE = 1, F_EP = 2, F_CASTLE_K = 3, F_CASTLE_Q = 4;
  const T_EXACT = 1, T_LOWER = 2, T_UPPER = 3;
  const VALUE = [0, 100, 320, 330, 500, 900, 0];
  const PHASE_W = [0, 0, 1, 1, 2, 4, 0];

  // Figura = typ | (barva << 3); barva 0 = bílá, 1 = černá.
  const board = new Int8Array(128);
  let side = 0, castle = 0, ep = -1, half = 0, hLo = 0, hHi = 0, sp = 0;
  const kingSq = new Int32Array(2);
  const npMat = new Int32Array(2); // materiál bez pěšců a krále (pro null-move a koncovky)

  // Zásobník pro vracení tahů (obsahuje i tahy odehrané před kořenem -> detekce opakování pozic).
  const stLo = new Int32Array(MAX_STACK), stHi = new Int32Array(MAX_STACK);
  const stCastle = new Int8Array(MAX_STACK), stEp = new Int16Array(MAX_STACK), stHalf = new Int16Array(MAX_STACK);
  const stMove = new Int32Array(MAX_STACK);

  const SQ = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) SQ.push(r * 16 + c);

  const KNIGHT_D = [-33, -31, -18, -14, 14, 18, 31, 33];
  const KING_D = [-17, -16, -15, -1, 1, 15, 16, 17];
  const BISHOP_D = [-17, -15, 15, 17];
  const ROOK_D = [-16, -1, 1, 16];

  const CASTLE_MASK = new Int8Array(128).fill(15);
  CASTLE_MASK[116] = 12; CASTLE_MASK[119] = 14; CASTLE_MASK[112] = 13;
  CASTLE_MASK[4] = 3; CASTLE_MASK[7] = 11; CASTLE_MASK[0] = 7;

  // ---------- Zobrist ----------
  let rs = 0x2545F491 | 0;
  function xorshift() { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return rs | 0; }
  const zLo = new Int32Array(16 * 128), zHi = new Int32Array(16 * 128);
  const zCastleLo = new Int32Array(16), zCastleHi = new Int32Array(16);
  const zEpLo = new Int32Array(128), zEpHi = new Int32Array(128);
  for (let i = 0; i < zLo.length; i++) { zLo[i] = xorshift(); zHi[i] = xorshift(); }
  for (let i = 0; i < 16; i++) { zCastleLo[i] = xorshift(); zCastleHi[i] = xorshift(); }
  for (let i = 0; i < 128; i++) { zEpLo[i] = xorshift(); zEpHi[i] = xorshift(); }
  const zSideLo = xorshift(), zSideHi = xorshift();

  function computeHash() {
    let lo = 0, hi = 0;
    for (let i = 0; i < 64; i++) {
      const sq = SQ[i], p = board[sq];
      if (p) { lo ^= zLo[p * 128 + sq]; hi ^= zHi[p * 128 + sq]; }
    }
    lo ^= zCastleLo[castle]; hi ^= zCastleHi[castle];
    if (ep >= 0) { lo ^= zEpLo[ep]; hi ^= zEpHi[ep]; }
    if (side) { lo ^= zSideLo; hi ^= zSideHi; }
    hLo = lo; hHi = hi;
  }

  // ---------- Pozice ----------
  function nameToSq(n) { return (8 - (n.charCodeAt(1) - 48)) * 16 + (n.charCodeAt(0) - 97); }
  function sqToName(sq) { return String.fromCharCode(97 + (sq & 15)) + (8 - (sq >> 4)); }

  function recountMaterial() {
    npMat[0] = 0; npMat[1] = 0;
    for (let i = 0; i < 64; i++) {
      const p = board[SQ[i]];
      if (p) {
        const t = p & 7;
        if (t !== PAWN && t !== KING) npMat[p >> 3] += VALUE[t];
        if (t === KING) kingSq[p >> 3] = SQ[i];
      }
    }
  }

  function setFEN(fen) {
    board.fill(0);
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split("/");
    const map = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (ch >= "1" && ch <= "8") { c += ch.charCodeAt(0) - 48; continue; }
        const isWhite = ch === ch.toUpperCase();
        board[r * 16 + c] = map[ch.toLowerCase()] | (isWhite ? 0 : 8);
        c++;
      }
    }
    side = parts[1] === "b" ? 1 : 0;
    const cs = parts[2] || "-";
    castle = (cs.includes("K") ? 1 : 0) | (cs.includes("Q") ? 2 : 0) | (cs.includes("k") ? 4 : 0) | (cs.includes("q") ? 8 : 0);
    ep = parts[3] && parts[3] !== "-" ? nameToSq(parts[3]) : -1;
    half = parseInt(parts[4], 10) || 0;
    sp = 0;
    recountMaterial();
    computeHash();
  }
  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  // ---------- Útoky ----------
  function isAttacked(sq, by) {
    let s;
    if (by === 0) {
      s = sq + 15; if (!(s & 0x88) && board[s] === 1) return true;
      s = sq + 17; if (!(s & 0x88) && board[s] === 1) return true;
    } else {
      s = sq - 15; if (!(s & 0x88) && board[s] === 9) return true;
      s = sq - 17; if (!(s & 0x88) && board[s] === 9) return true;
    }
    const bits = by << 3;
    const kn = KNIGHT | bits;
    for (let k = 0; k < 8; k++) { s = sq + KNIGHT_D[k]; if (!(s & 0x88) && board[s] === kn) return true; }
    const kg = KING | bits;
    for (let k = 0; k < 8; k++) { s = sq + KING_D[k]; if (!(s & 0x88) && board[s] === kg) return true; }
    const bi = BISHOP | bits, ro = ROOK | bits, qu = QUEEN | bits;
    for (let k = 0; k < 4; k++) {
      const d = BISHOP_D[k];
      s = sq + d;
      while (!(s & 0x88)) {
        const p = board[s];
        if (p !== 0) { if (p === bi || p === qu) return true; break; }
        s += d;
      }
    }
    for (let k = 0; k < 4; k++) {
      const d = ROOK_D[k];
      s = sq + d;
      while (!(s & 0x88)) {
        const p = board[s];
        if (p !== 0) { if (p === ro || p === qu) return true; break; }
        s += d;
      }
    }
    return false;
  }
  function inCheck() { return isAttacked(kingSq[side], side ^ 1); }

  // ---------- Generování tahů ----------
  // Tah: from | to<<7 | flag<<14 | promo<<17 | zajatá figura<<20
  const moves = new Int32Array(MAX_PLY * MPP);
  const mscore = new Int32Array(MAX_PLY * MPP);

  function genMoves(base, capsOnly) {
    let n = base;
    const us = side, them = us ^ 1;
    for (let i = 0; i < 64; i++) {
      const from = SQ[i];
      const p = board[from];
      if (p === 0 || (p >> 3) !== us) continue;
      const t = p & 7;
      if (t === PAWN) {
        const dir = us === 0 ? -16 : 16;
        const startRow = us === 0 ? 6 : 1;
        const promoRow = us === 0 ? 0 : 7;
        let to = from + dir;
        if (board[to] === 0) {
          if ((to >> 4) === promoRow) {
            moves[n++] = from | (to << 7) | (QUEEN << 17);
            if (!capsOnly) {
              moves[n++] = from | (to << 7) | (ROOK << 17);
              moves[n++] = from | (to << 7) | (BISHOP << 17);
              moves[n++] = from | (to << 7) | (KNIGHT << 17);
            }
          } else if (!capsOnly) {
            moves[n++] = from | (to << 7);
            if ((from >> 4) === startRow && board[to + dir] === 0) moves[n++] = from | ((to + dir) << 7) | (F_DOUBLE << 14);
          }
        }
        for (let k = -1; k <= 1; k += 2) {
          to = from + dir + k;
          if (to & 0x88) continue;
          const tp = board[to];
          if (tp !== 0 && (tp >> 3) === them) {
            if ((to >> 4) === promoRow) {
              moves[n++] = from | (to << 7) | (QUEEN << 17) | (tp << 20);
              if (!capsOnly) {
                moves[n++] = from | (to << 7) | (ROOK << 17) | (tp << 20);
                moves[n++] = from | (to << 7) | (BISHOP << 17) | (tp << 20);
                moves[n++] = from | (to << 7) | (KNIGHT << 17) | (tp << 20);
              }
            } else {
              moves[n++] = from | (to << 7) | (tp << 20);
            }
          } else if (tp === 0 && to === ep) {
            moves[n++] = from | (to << 7) | (F_EP << 14) | (((them << 3) | PAWN) << 20);
          }
        }
      } else if (t === KNIGHT || t === KING) {
        const offs = t === KNIGHT ? KNIGHT_D : KING_D;
        for (let k = 0; k < 8; k++) {
          const to = from + offs[k];
          if (to & 0x88) continue;
          const tp = board[to];
          if (tp === 0) { if (!capsOnly) moves[n++] = from | (to << 7); }
          else if ((tp >> 3) !== us) moves[n++] = from | (to << 7) | (tp << 20);
        }
        if (t === KING && !capsOnly) {
          if (us === 0 && from === 116) {
            if ((castle & 1) && board[117] === 0 && board[118] === 0 && !isAttacked(116, 1) && !isAttacked(117, 1) && !isAttacked(118, 1))
              moves[n++] = 116 | (118 << 7) | (F_CASTLE_K << 14);
            if ((castle & 2) && board[115] === 0 && board[114] === 0 && board[113] === 0 && !isAttacked(116, 1) && !isAttacked(115, 1) && !isAttacked(114, 1))
              moves[n++] = 116 | (114 << 7) | (F_CASTLE_Q << 14);
          } else if (us === 1 && from === 4) {
            if ((castle & 4) && board[5] === 0 && board[6] === 0 && !isAttacked(4, 0) && !isAttacked(5, 0) && !isAttacked(6, 0))
              moves[n++] = 4 | (6 << 7) | (F_CASTLE_K << 14);
            if ((castle & 8) && board[3] === 0 && board[2] === 0 && board[1] === 0 && !isAttacked(4, 0) && !isAttacked(3, 0) && !isAttacked(2, 0))
              moves[n++] = 4 | (2 << 7) | (F_CASTLE_Q << 14);
          }
        }
      } else {
        const dirs = t === BISHOP ? BISHOP_D : t === ROOK ? ROOK_D : KING_D;
        const nd = dirs.length;
        for (let k = 0; k < nd; k++) {
          const d = dirs[k];
          let to = from + d;
          while (!(to & 0x88)) {
            const tp = board[to];
            if (tp === 0) { if (!capsOnly) moves[n++] = from | (to << 7); }
            else { if ((tp >> 3) !== us) moves[n++] = from | (to << 7) | (tp << 20); break; }
            to += d;
          }
        }
      }
    }
    return n;
  }

  // ---------- Provedení a vrácení tahu ----------
  function makeMove(m) {
    const from = m & 127, to = (m >> 7) & 127, flag = (m >> 14) & 7, promo = (m >> 17) & 7, cap = (m >> 20) & 15;
    const piece = board[from];
    const us = side;
    stLo[sp] = hLo; stHi[sp] = hHi; stCastle[sp] = castle; stEp[sp] = ep; stHalf[sp] = half; stMove[sp] = m; sp++;
    if (ep >= 0) { hLo ^= zEpLo[ep]; hHi ^= zEpHi[ep]; }
    hLo ^= zCastleLo[castle]; hHi ^= zCastleHi[castle];
    half++;
    if (cap !== 0 || (piece & 7) === PAWN) half = 0;
    if (flag === F_EP) {
      const capSq = to + (us === 0 ? 16 : -16);
      board[capSq] = 0;
      hLo ^= zLo[cap * 128 + capSq]; hHi ^= zHi[cap * 128 + capSq];
    } else if (cap !== 0) {
      hLo ^= zLo[cap * 128 + to]; hHi ^= zHi[cap * 128 + to];
      if ((cap & 7) !== PAWN) npMat[us ^ 1] -= VALUE[cap & 7];
    }
    board[from] = 0;
    hLo ^= zLo[piece * 128 + from]; hHi ^= zHi[piece * 128 + from];
    const placed = promo ? (promo | (us << 3)) : piece;
    board[to] = placed;
    hLo ^= zLo[placed * 128 + to]; hHi ^= zHi[placed * 128 + to];
    if (promo) npMat[us] += VALUE[promo];
    if (flag === F_CASTLE_K) {
      const rook = ROOK | (us << 3);
      board[to + 1] = 0; board[to - 1] = rook;
      hLo ^= zLo[rook * 128 + to + 1] ^ zLo[rook * 128 + to - 1]; hHi ^= zHi[rook * 128 + to + 1] ^ zHi[rook * 128 + to - 1];
    } else if (flag === F_CASTLE_Q) {
      const rook = ROOK | (us << 3);
      board[to - 2] = 0; board[to + 1] = rook;
      hLo ^= zLo[rook * 128 + to - 2] ^ zLo[rook * 128 + to + 1]; hHi ^= zHi[rook * 128 + to - 2] ^ zHi[rook * 128 + to + 1];
    }
    if ((piece & 7) === KING) kingSq[us] = to;
    castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    ep = flag === F_DOUBLE ? (from + to) >> 1 : -1;
    hLo ^= zCastleLo[castle]; hHi ^= zCastleHi[castle];
    if (ep >= 0) { hLo ^= zEpLo[ep]; hHi ^= zEpHi[ep]; }
    hLo ^= zSideLo; hHi ^= zSideHi;
    side ^= 1;
  }

  function unmakeMove() {
    sp--;
    const m = stMove[sp];
    side ^= 1;
    const us = side;
    const from = m & 127, to = (m >> 7) & 127, flag = (m >> 14) & 7, promo = (m >> 17) & 7, cap = (m >> 20) & 15;
    const placed = board[to];
    const piece = promo ? (PAWN | (us << 3)) : placed;
    if (promo) npMat[us] -= VALUE[promo];
    board[from] = piece;
    if (flag === F_EP) {
      board[to] = 0;
      board[to + (us === 0 ? 16 : -16)] = cap;
    } else {
      board[to] = cap;
      if (cap !== 0 && (cap & 7) !== PAWN) npMat[us ^ 1] += VALUE[cap & 7];
    }
    if (flag === F_CASTLE_K) {
      const rook = ROOK | (us << 3);
      board[to - 1] = 0; board[to + 1] = rook;
    } else if (flag === F_CASTLE_Q) {
      const rook = ROOK | (us << 3);
      board[to + 1] = 0; board[to - 2] = rook;
    }
    if ((piece & 7) === KING) kingSq[us] = from;
    hLo = stLo[sp]; hHi = stHi[sp]; castle = stCastle[sp]; ep = stEp[sp]; half = stHalf[sp];
  }

  function makeNull() {
    stLo[sp] = hLo; stHi[sp] = hHi; stCastle[sp] = castle; stEp[sp] = ep; stHalf[sp] = half; stMove[sp] = 0; sp++;
    if (ep >= 0) { hLo ^= zEpLo[ep]; hHi ^= zEpHi[ep]; }
    ep = -1;
    hLo ^= zSideLo; hHi ^= zSideHi;
    half++;
    side ^= 1;
  }
  function unmakeNull() {
    sp--; side ^= 1;
    hLo = stLo[sp]; hHi = stHi[sp]; castle = stCastle[sp]; ep = stEp[sp]; half = stHalf[sp];
  }

  // Provede tah a vrátí true; je-li nelegální (nechává krále v šachu), hned ho vrátí a vrátí false.
  function makeLegal(m) {
    makeMove(m);
    if (isAttacked(kingSq[side ^ 1], side)) { unmakeMove(); return false; }
    return true;
  }

  // ---------- Hodnocení ----------
  // Tabulky z pohledu bílého; index = řada * 8 + sloupec, řada 0 = 8. řada.
  const PST_MG = [null,
    [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20]
  ];
  const PST_EG = PST_MG.slice();
  PST_EG[PAWN] = (function () {
    const rowBonus = [0, 80, 45, 25, 12, 5, 0, 0];
    const t = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) t.push(rowBonus[r] + (c >= 2 && c <= 5 ? 2 : 0));
    return t;
  })();
  PST_EG[KING] = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

  const PASSED_MG = [0, 5, 10, 20, 35, 60, 100, 0];
  const PASSED_EG = [0, 10, 20, 40, 70, 120, 200, 0];
  const CENTER_MAN = new Int8Array(128); // vzdálenost od středu (0-6)
  for (let i = 0; i < 64; i++) { const r = SQ[i] >> 4, f = SQ[i] & 7; CENTER_MAN[SQ[i]] = Math.max(3 - r, r - 4) + Math.max(3 - f, f - 4); }

  // Nastavení hodnocení pro právě běžící hledání (úroveň + styl bota).
  const EV = { level: 2, mob: 1, pawn: 1, ka: 1, kaOpp: 1, botSide: 0 };

  const wCnt = new Int8Array(10), bCnt = new Int8Array(10), wMax = new Int8Array(10), bMin = new Int8Array(10);
  const pcSq = new Int16Array(40), pcPc = new Int8Array(40);
  const zoneMark = new Int8Array(128);

  // Vrací skóre z pohledu strany na tahu (v setinách pěšce).
  function evaluate() {
    let mg = 0, eg = 0, phase = 0, np = 0;
    let wB = 0, bB = 0, wP = 0, bP = 0, wMat = 0, bMat = 0;
    wCnt.fill(0); bCnt.fill(0); wMax.fill(-1); bMin.fill(8);
    for (let i = 0; i < 64; i++) {
      const sq = SQ[i], p = board[sq];
      if (p === 0) continue;
      const t = p & 7, c = p >> 3, r = sq >> 4, f = sq & 7;
      if (c === 0) {
        const idx = r * 8 + f;
        mg += VALUE[t] + PST_MG[t][idx]; eg += VALUE[t] + PST_EG[t][idx];
        if (t === PAWN) { wP++; wCnt[f + 1]++; if (r > wMax[f + 1]) wMax[f + 1] = r; }
        else if (t !== KING) { wMat += VALUE[t]; if (t === BISHOP) wB++; }
      } else {
        const idx = (7 - r) * 8 + f;
        mg -= VALUE[t] + PST_MG[t][idx]; eg -= VALUE[t] + PST_EG[t][idx];
        if (t === PAWN) { bP++; bCnt[f + 1]++; if (r < bMin[f + 1]) bMin[f + 1] = r; }
        else if (t !== KING) { bMat += VALUE[t]; if (t === BISHOP) bB++; }
      }
      phase += PHASE_W[t];
      if (t >= KNIGHT && t <= QUEEN) { pcSq[np] = sq; pcPc[np] = p; np++; }
    }

    // Remízový materiál (samotný král, král + lehká figura): žádné hodnocení, čistá remíza.
    if (wP + bP === 0 && wMat <= 330 && bMat <= 330) return 0;

    if (EV.level >= 1) {
      if (wB >= 2) { mg += 30; eg += 45; }
      if (bB >= 2) { mg -= 30; eg -= 45; }
      const pw = EV.pawn;
      for (let f = 1; f <= 8; f++) {
        if (wCnt[f] > 1) { mg -= 10 * pw * (wCnt[f] - 1); eg -= 18 * pw * (wCnt[f] - 1); }
        if (bCnt[f] > 1) { mg += 10 * pw * (bCnt[f] - 1); eg += 18 * pw * (bCnt[f] - 1); }
        if (wCnt[f] > 0 && wCnt[f - 1] === 0 && wCnt[f + 1] === 0) { mg -= 12 * pw; eg -= 20 * pw; }
        if (bCnt[f] > 0 && bCnt[f - 1] === 0 && bCnt[f + 1] === 0) { mg += 12 * pw; eg += 20 * pw; }
      }
      // Volní pěšci: za pěšcem na jeho a sousedních sloupcích už není soupeřův pěšec.
      for (let f = 1; f <= 8; f++) {
        if (wCnt[f] > 0) {
          // nejpokročilejší bílý pěšec na sloupci = nejmenší řada; pro jednoduchost hodnotíme nejdál postoupivšího
          let best = -1;
          for (let r = 1; r <= 6; r++) { if (board[r * 16 + f - 1] === 1) { best = r; break; } }
          if (best >= 0 && bMin[f] >= best && bMin[f - 1] >= best && bMin[f + 1] >= best) {
            const rank = 7 - best; mg += PASSED_MG[rank] * pw; eg += PASSED_EG[rank] * pw;
          }
        }
        if (bCnt[f] > 0) {
          let best = -1;
          for (let r = 6; r >= 1; r--) { if (board[r * 16 + f - 1] === 9) { best = r; break; } }
          if (best >= 0 && wMax[f] <= best && wMax[f - 1] <= best && wMax[f + 1] <= best) {
            const rank = best; mg -= PASSED_MG[rank] * pw; eg -= PASSED_EG[rank] * pw;
          }
        }
      }
      // Věže na otevřených a polootevřených sloupcích.
      for (let k = 0; k < np; k++) {
        if ((pcPc[k] & 7) !== ROOK) continue;
        const f = (pcSq[k] & 7) + 1;
        if (pcPc[k] >> 3 === 0) {
          if (wCnt[f] === 0) { if (bCnt[f] === 0) { mg += 20; eg += 10; } else { mg += 10; eg += 5; } }
          if ((pcSq[k] >> 4) === 1) { mg += 12; eg += 18; }
        } else {
          if (bCnt[f] === 0) { if (wCnt[f] === 0) { mg -= 20; eg -= 10; } else { mg -= 10; eg -= 5; } }
          if ((pcSq[k] >> 4) === 6) { mg -= 12; eg -= 18; }
        }
      }
    }

    if (EV.level >= 2) {
      // Pohyblivost a útoky na okolí krále (zóna = král + sousední pole + 3 pole před ním).
      const wk = kingSq[0], bk = kingSq[1];
      zoneMark.fill(0);
      for (let k = 0; k < 8; k++) {
        let s = wk + KING_D[k]; if (!(s & 0x88)) zoneMark[s] |= 1;
        s = bk + KING_D[k]; if (!(s & 0x88)) zoneMark[s] |= 2;
      }
      zoneMark[wk] |= 1; zoneMark[bk] |= 2;
      let s = wk - 32 - 1; for (let j = 0; j < 3; j++, s++) if (!(s & 0x88)) zoneMark[s] |= 1;
      s = bk + 32 - 1; for (let j = 0; j < 3; j++, s++) if (!(s & 0x88)) zoneMark[s] |= 2;
      let wAtt = 0, wUnits = 0, bAtt = 0, bUnits = 0;
      for (let k = 0; k < np; k++) {
        const sq = pcSq[k], p = pcPc[k], t = p & 7, c = p >> 3;
        const enemyZone = c === 0 ? 2 : 1;
        let cnt = 0, hit = false;
        if (t === KNIGHT) {
          for (let j = 0; j < 8; j++) {
            const to = sq + KNIGHT_D[j];
            if (to & 0x88) continue;
            const tp = board[to];
            if (tp === 0 || (tp >> 3) !== c) { cnt++; if (zoneMark[to] & enemyZone) hit = true; }
          }
        } else {
          const dirs = t === BISHOP ? BISHOP_D : t === ROOK ? ROOK_D : KING_D;
          const nd = dirs.length;
          for (let j = 0; j < nd; j++) {
            const d = dirs[j];
            let to = sq + d;
            while (!(to & 0x88)) {
              const tp = board[to];
              if (zoneMark[to] & enemyZone) hit = true;
              if (tp === 0) cnt++;
              else { if ((tp >> 3) !== c) cnt++; break; }
              to += d;
            }
          }
        }
        let mob;
        if (t === KNIGHT) mob = (cnt - 4) * 4;
        else if (t === BISHOP) mob = (cnt - 6) * 3;
        else if (t === ROOK) mob = (cnt - 7) * 2;
        else mob = (cnt - 13);
        mob *= EV.mob;
        const w = t === KNIGHT ? 2 : t === BISHOP ? 2 : t === ROOK ? 3 : 5;
        if (c === 0) { mg += mob; eg += t === ROOK ? mob * 2 : mob; if (hit) { wAtt++; wUnits += w; } }
        else { mg -= mob; eg -= t === ROOK ? mob * 2 : mob; if (hit) { bAtt++; bUnits += w; } }
      }
      // bílé figury útočí na černého krále
      if (wAtt >= 2) { const u = Math.min(wUnits, 24); mg += Math.round(u * u * 0.35 * (EV.botSide === 0 ? EV.ka : EV.kaOpp)); }
      if (bAtt >= 2) { const u = Math.min(bUnits, 24); mg -= Math.round(u * u * 0.35 * (EV.botSide === 1 ? EV.ka : EV.kaOpp)); }
      // pěšcový štít před králem (jen střední hra)
      mg += shield(0, wk) - shield(1, bk);
      // dáma vyběhla dřív než lehké figury
      if (phase >= 20) {
        if (board[115] !== 5 && (board[113] === 2 || board[114] === 3 || board[117] === 3 || board[118] === 2)) mg -= 12;
        if (board[3] !== 13 && (board[1] === 10 || board[2] === 11 || board[5] === 11 || board[6] === 10)) mg += 12;
      }
    }

    // Dotahování výhry v koncovce: silnější strana zatlačí krále soupeře k okraji a přiblíží svého.
    if (bP === 0 && wMat + 100 * wP - bMat >= 300) {
      const bonus = 10 * CENTER_MAN[kingSq[1]] + 4 * (14 - manhattan(kingSq[0], kingSq[1]));
      mg += bonus; eg += bonus;
    } else if (wP === 0 && bMat + 100 * bP - wMat >= 300) {
      const bonus = 10 * CENTER_MAN[kingSq[0]] + 4 * (14 - manhattan(kingSq[0], kingSq[1]));
      mg -= bonus; eg -= bonus;
    }

    const ph = phase > 24 ? 24 : phase;
    const score = ((mg * ph + eg * (24 - ph)) / 24) | 0;
    return side === 0 ? score + 10 : -score + 10;
  }

  function manhattan(a, b) { return Math.abs((a >> 4) - (b >> 4)) + Math.abs((a & 7) - (b & 7)); }

  function shield(color, ksq) {
    const r = ksq >> 4, f = ksq & 7;
    if (color === 0 ? r < 6 : r > 1) return 0; // král ve středu desky - štít nehodnotíme
    const dir = color === 0 ? -16 : 16;
    const pawn = color === 0 ? 1 : 9;
    let s = 0;
    for (let df = -1; df <= 1; df++) {
      const ff = f + df;
      if (ff < 0 || ff > 7) continue;
      const a = ksq + dir + df;
      if (board[a] === pawn) s += 10;
      else if (board[a + dir] === pawn) s += 5;
      else s -= 8;
    }
    return s * EV.pawn;
  }

  // ---------- Hashovací tabulka ----------
  let ttBits = 0, ttMask = 0;
  let ttHi = null, ttMv = null, ttSc = null, ttDp = null, ttFl = null;
  function ensureTT(bits) {
    if (bits === ttBits && ttHi) return;
    ttBits = bits; ttMask = (1 << bits) - 1;
    ttHi = new Int32Array(1 << bits); ttMv = new Int32Array(1 << bits); ttSc = new Int16Array(1 << bits);
    ttDp = new Int8Array(1 << bits); ttFl = new Int8Array(1 << bits);
  }
  function clearTT() { if (ttHi) { ttFl.fill(0); } }

  // ---------- Hledání ----------
  const killers = new Int32Array(MAX_PLY * 2);
  const history = new Int32Array(16 * 128);
  let nodes = 0, stopped = false, limitsOn = false, deadline = 0, nodeLimit = 0;
  let qLimit = 8, useNull = true, useLmr = true, contempt = 0, rootSp = 0;

  function checkLimits() {
    if (!limitsOn) return;
    if (nodes >= nodeLimit || Date.now() >= deadline) stopped = true;
  }

  function drawScore(ply) { return (ply & 1) === 0 ? -contempt : contempt; }

  function isRepetition() {
    const lim = sp - half > 0 ? sp - half : 0;
    let count = 0;
    for (let i = sp - 2; i >= lim; i -= 2) {
      if (stLo[i] === hLo && stHi[i] === hHi) {
        if (i >= rootSp) return true;
        if (++count >= 2) return true;
      }
    }
    return false;
  }

  function scoreMoves(base, n, ttMove, ply) {
    const k1 = killers[ply * 2], k2 = killers[ply * 2 + 1];
    for (let i = base; i < n; i++) {
      const m = moves[i];
      let s;
      if (m === ttMove) s = 1900000000;
      else {
        const cap = (m >> 20) & 15, promo = (m >> 17) & 7;
        if (cap !== 0) s = 1000000 + (cap & 7) * 16 - (board[m & 127] & 7);
        else if (promo) s = promo === QUEEN ? 1500000 : 400000;
        else if (m === k1) s = 900000;
        else if (m === k2) s = 800000;
        else { s = history[board[m & 127] * 128 + ((m >> 7) & 127)]; if (s > 700000) s = 700000; }
        if (cap !== 0 && promo === QUEEN) s += 500000;
      }
      mscore[i] = s;
    }
  }

  function pickNext(base, n, i) {
    let bi = i, bs = mscore[i];
    for (let j = i + 1; j < n; j++) if (mscore[j] > bs) { bs = mscore[j]; bi = j; }
    if (bi !== i) {
      const tm = moves[i]; moves[i] = moves[bi]; moves[bi] = tm;
      const ts = mscore[i]; mscore[i] = mscore[bi]; mscore[bi] = ts;
    }
  }

  function quiesce(alpha, beta, ply, qd) {
    if ((++nodes & 2047) === 0) checkLimits();
    if (stopped) return 0;
    if (ply >= MAX_PLY - 2) return evaluate();
    if (half >= 100) return drawScore(ply);
    const chk = inCheck();
    let standPat = -INF;
    if (!chk) {
      standPat = evaluate();
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
      if (qd <= 0) return standPat;
    } else if (qd <= -4) {
      return evaluate();
    }
    const base = ply * MPP;
    const n = genMoves(base, !chk);
    scoreMoves(base, n, 0, ply);
    let best = chk ? -INF : standPat, legal = 0;
    for (let i = base; i < n; i++) {
      pickNext(base, n, i);
      const m = moves[i];
      if (!chk) {
        const cap = (m >> 20) & 15, promo = (m >> 17) & 7;
        // delta pruning: ani zisk celé figury nezachrání pozici -> tah nezkoušíme
        if (promo === 0 && standPat + VALUE[cap & 7] + 200 < alpha) continue;
      }
      if (!makeLegal(m)) continue;
      legal++;
      const score = -quiesce(-beta, -alpha, ply + 1, qd - 1);
      unmakeMove();
      if (stopped) return 0;
      if (score > best) {
        best = score;
        if (score > alpha) { alpha = score; if (score >= beta) return score; }
      }
    }
    if (chk && legal === 0) return -MATE + ply;
    return best;
  }

  function search(depth, alpha, beta, ply, canNull) {
    if ((++nodes & 2047) === 0) checkLimits();
    if (stopped) return 0;
    const pvNode = beta - alpha > 1;
    const chk = inCheck();
    if (ply > 0) {
      if (half >= 100) return drawScore(ply);
      if (isRepetition()) return drawScore(ply);
      const mateA = -MATE + ply, mateB = MATE - ply - 1;
      if (alpha < mateA) alpha = mateA;
      if (beta > mateB) beta = mateB;
      if (alpha >= beta) return alpha;
    }
    if (chk && ply < MAX_PLY - 12) depth++;
    if (depth <= 0) return qLimit > 0 ? quiesce(alpha, beta, ply, qLimit) : evaluate();
    if (ply >= MAX_PLY - 2) return evaluate();

    // hashovací tabulka
    const idx = hLo & ttMask;
    let ttMove = 0;
    if (ttFl[idx] !== 0 && ttHi[idx] === hHi) {
      ttMove = ttMv[idx];
      if (ttDp[idx] >= depth && !pvNode) {
        let sc = ttSc[idx];
        if (sc > MATE_BOUND) sc -= ply; else if (sc < -MATE_BOUND) sc += ply;
        const fl = ttFl[idx];
        if (fl === T_EXACT) return sc;
        if (fl === T_LOWER && sc >= beta) return sc;
        if (fl === T_UPPER && sc <= alpha) return sc;
      }
    }

    let staticEval = 0;
    if (!chk && !pvNode && depth <= 3 && beta < MATE_BOUND && beta > -MATE_BOUND) {
      staticEval = evaluate();
      if (staticEval - 110 * depth >= beta) return staticEval; // příliš dobrá pozice, soupeř to nedožene
    }
    // null-move: kdybych přeskočil tah a stejně bych byl nad beta, pozice je pro soupeře ztracená
    if (useNull && canNull && !chk && !pvNode && depth >= 3 && npMat[side] > 0 && beta < MATE_BOUND) {
      if (staticEval === 0) staticEval = evaluate();
      if (staticEval >= beta) {
        makeNull();
        const R = depth >= 6 ? 3 : 2;
        const sc = -search(depth - 1 - R, -beta, -beta + 1, ply + 1, false);
        unmakeNull();
        if (stopped) return 0;
        if (sc >= beta) return sc > MATE_BOUND ? beta : sc;
      }
    }

    const base = ply * MPP;
    const n = genMoves(base, false);
    scoreMoves(base, n, ttMove, ply);
    let best = -INF, bestMove = 0, flag = T_UPPER, legal = 0;
    const origAlpha = alpha;
    for (let i = base; i < n; i++) {
      pickNext(base, n, i);
      const m = moves[i];
      if (!makeLegal(m)) continue;
      legal++;
      const quiet = ((m >> 20) & 15) === 0 && ((m >> 17) & 7) === 0;
      const newDepth = depth - 1;
      let score;
      if (legal === 1) {
        score = -search(newDepth, -beta, -alpha, ply + 1, true);
      } else {
        let red = 0;
        if (useLmr && depth >= 3 && legal > 3 && quiet && !chk && !inCheck()) {
          red = 1 + (legal > 8 ? 1 : 0) + (depth > 7 ? 1 : 0);
          if (red > newDepth - 1) red = newDepth - 1 > 0 ? newDepth - 1 : 0;
        }
        score = -search(newDepth - red, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && red > 0) score = -search(newDepth, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && score < beta) score = -search(newDepth, -beta, -alpha, ply + 1, true);
      }
      unmakeMove();
      if (stopped) return 0;
      if (score > best) {
        best = score; bestMove = m;
        if (score > alpha) {
          alpha = score; flag = T_EXACT;
          if (score >= beta) {
            flag = T_LOWER;
            if (quiet) {
              if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
              const hi = board[m & 127] * 128 + ((m >> 7) & 127);
              history[hi] += depth * depth;
            }
            break;
          }
        }
      }
    }
    if (legal === 0) return chk ? -MATE + ply : drawScore(ply);
    if (alpha <= origAlpha && flag === T_EXACT) flag = T_UPPER;
    // uložení do tabulky
    if (ttFl[idx] === 0 || ttHi[idx] === hHi || depth >= ttDp[idx]) {
      let sc = best;
      if (sc > MATE_BOUND) sc += ply; else if (sc < -MATE_BOUND) sc -= ply;
      ttHi[idx] = hHi; ttMv[idx] = bestMove; ttSc[idx] = sc; ttDp[idx] = depth > 127 ? 127 : depth; ttFl[idx] = flag;
    }
    return best;
  }

  // ---------- Kořen hledání ----------
  // Vrací výsledky posledního dokončeného patra pro všechny kořenové tahy.
  // Tahy do vzdálenosti "margin" od nejlepšího mají přesné skóre (z nich se vybírá "lidsky").
  function searchRoot(p) {
    rootSp = sp;
    const n0 = genMoves(0, false);
    const legalMoves = [];
    for (let i = 0; i < n0; i++) { const m = moves[i]; if (makeLegal(m)) { unmakeMove(); legalMoves.push(m); } }
    if (legalMoves.length === 0) return { legal: 0, depth: 0, results: [], inCheck: inCheck() };
    if (legalMoves.length === 1) return { legal: 1, depth: 0, results: [{ m: legalMoves[0], s: 0, exact: true }], forced: true, inCheck: inCheck() };

    nodes = 0; stopped = false; limitsOn = false;
    deadline = Date.now() + p.timeMs; nodeLimit = p.nodes;
    qLimit = p.qd; useNull = p.nullMove !== false; useLmr = p.lmr !== false; contempt = p.contempt || 0;
    for (let i = 0; i < killers.length; i++) killers[i] = 0;
    for (let i = 0; i < history.length; i++) history[i] >>= 3; // stará data postupně slábnou

    const margin = p.margin || 0;
    let order = legalMoves.slice();
    let finished = null, doneDepth = 0;
    for (let depth = 1; depth <= p.depth; depth++) {
      const results = [];
      let bestScore = -INF, alphaLow = -INF, aborted = false;
      for (let i = 0; i < order.length; i++) {
        const m = order[i];
        makeMove(m);
        const score = i === 0 ? -search(depth - 1, -INF, INF, 1, true) : -search(depth - 1, -INF, -alphaLow, 1, true);
        unmakeMove();
        if (stopped) { aborted = true; break; }
        if (i === 0 || score > alphaLow) {
          results.push({ m, s: score, exact: true });
          if (score > bestScore) { bestScore = score; alphaLow = score - margin; }
        } else {
          results.push({ m, s: alphaLow, exact: false });
        }
      }
      if (aborted) break;
      finished = results; doneDepth = depth;
      // další patro prohledává nejdřív nejlepší tahy
      order = results.slice().sort((a, b) => (b.exact - a.exact) || (b.s - a.s)).map((r) => r.m);
      if (depth === 1) limitsOn = true;
      if (bestScore >= MATE_BOUND || bestScore <= -MATE_BOUND) break;
      if (Date.now() - (deadline - p.timeMs) > p.timeMs * 0.6) break; // další patro by už zřejmě nestihlo doběhnout
    }
    return { legal: legalMoves.length, depth: doneDepth, results: finished, nodes, inCheck: inCheck() };
  }

  // ---------- "Lidský" výběr tahu ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function moveCoord(m) {
    const promo = (m >> 17) & 7;
    return sqToName(m & 127) + sqToName((m >> 7) & 127) + (promo ? "nbrq"[promo - 2] : "");
  }

  function parseCoord(str) {
    const from = nameToSq(str.slice(0, 2)), to = nameToSq(str.slice(2, 4));
    const pc = str[4];
    const promo = pc ? "nbrq".indexOf(pc) + 2 : 0;
    const n = genMoves(0, false);
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      if ((m & 127) === from && ((m >> 7) & 127) === to && ((m >> 17) & 7) === promo) return m;
    }
    return 0;
  }

  function givesCheckAfter(m) {
    makeMove(m);
    const chk = inCheck();
    unmakeMove();
    return chk;
  }

  // Z přesně spočtených kandidátů vybere tah tak, jak by ho zahrál člověk dané síly:
  // měkká volba podle skóre (teplota), preference braní/šachů/rošády a občasné přehlédnutí.
  function chooseHuman(results, p, rng) {
    const cands = results.filter((r) => r.exact).sort((a, b) => b.s - a.s);
    if (cands.length === 0) return results[0];
    const best = cands[0].s;
    if (best >= MATE_BOUND) return cands[0]; // vynucený mat vidí každý
    const T = p.temperature || 0;
    const bias = p.bias || {};
    // občasné přehlédnutí: místo nejlepšího zahraje jiný, ale ne katastrofální tah
    if (p.blunder > 0 && cands.length > 1 && rng() < p.blunder) {
      const range = p.blunderRange || 300;
      const pool = cands.filter((c, i) => i > 0 && best - c.s <= range && c.s > -MATE_BOUND);
      if (pool.length > 0) return pool[Math.floor(rng() * pool.length)];
    }
    if (T <= 0 && !bias.capture && !bias.check && !bias.castle) return cands[0];
    let maxA = -Infinity;
    const adj = cands.map((c) => {
      let a = c.s;
      if (bias.capture && ((c.m >> 20) & 15) !== 0) a += bias.capture;
      if (bias.castle && (((c.m >> 14) & 7) === F_CASTLE_K || ((c.m >> 14) & 7) === F_CASTLE_Q)) a += bias.castle;
      if (bias.check && givesCheckAfter(c.m)) a += bias.check;
      if (a > maxA) maxA = a;
      return a;
    });
    if (T <= 0) { let bi = 0; for (let i = 1; i < adj.length; i++) if (adj[i] > adj[bi]) bi = i; return cands[bi]; }
    let total = 0;
    const w = adj.map((a) => { const x = Math.exp((a - maxA) / T); total += x; return x; });
    let roll = rng() * total;
    for (let i = 0; i < w.length; i++) { roll -= w[i]; if (roll <= 0) return cands[i]; }
    return cands[0];
  }

  // ---------- Příprava a rozhraní ----------
  const DEFAULTS = { depth: 6, nodes: 400000, timeMs: 2000, qd: 8, evalLevel: 2, margin: 0, temperature: 0, blunder: 0, blunderRange: 300, nullMove: true, lmr: true, contempt: 0, ttBits: 18, style: null, bias: null, key: "default" };
  let lastKey = null;

  function prepare(params, botSide) {
    const p = Object.assign({}, DEFAULTS, params || {});
    ensureTT(p.ttBits);
    EV.level = p.evalLevel;
    const st = p.style || {};
    EV.mob = st.mob != null ? st.mob : 1; EV.pawn = st.pawn != null ? st.pawn : 1;
    EV.ka = st.ka != null ? st.ka : 1; EV.kaOpp = st.kaOpp != null ? st.kaOpp : 1;
    EV.botSide = botSide;
    if (p.key !== lastKey) { clearTT(); lastKey = p.key; }
    return p;
  }

  function setupFromMoves(coords, fen) {
    setFEN(fen || START_FEN);
    for (let i = 0; i < coords.length; i++) {
      const m = parseCoord(coords[i]);
      if (!m) return false;
      makeMove(m);
    }
    return true;
  }

  function search_(req) {
    if (!setupFromMoves(req.moves || [], req.fen)) return { id: req.id, error: "illegal-history" };
    const p = prepare(req.params, side);
    const t0 = Date.now();
    const root = searchRoot(p);
    if (root.legal === 0) return { id: req.id, over: true, inCheck: root.inCheck };
    const rng = mulberry32(req.seed != null ? req.seed : (Date.now() & 0x7fffffff));
    const pick = root.forced ? root.results[0] : chooseHuman(root.results, p, rng);
    const bestScore = root.forced ? 0 : Math.max.apply(null, root.results.filter((r) => r.exact).map((r) => r.s));
    return {
      id: req.id,
      best: moveCoord(pick.m),
      score: root.forced ? 0 : pick.s,
      bestScore,
      depth: root.depth,
      nodes: root.nodes || 0,
      ms: Date.now() - t0,
      legal: root.legal,
      forced: !!root.forced,
      inCheck: root.inCheck,
      isCapture: ((pick.m >> 20) & 15) !== 0,
      cands: (root.results || []).filter((r) => r.exact).sort((a, b) => b.s - a.s).slice(0, 6).map((r) => ({ m: moveCoord(r.m), s: r.s }))
    };
  }

  // Skóre pozice (z pohledu strany na tahu) pro každou pozici partie - základ rozboru.
  function analyze_(req, post) {
    const out = [];
    const p = prepare(Object.assign({ depth: 4, nodes: 60000, timeMs: 400, qd: 8, margin: 0, temperature: 0, blunder: 0, key: "analysis" }, req.params || {}), 0);
    const coords = req.moves || [];
    for (let i = 0; i <= coords.length; i++) {
      if (!setupFromMoves(coords.slice(0, i), req.fen)) break;
      const r = searchRoot(p);
      if (r.legal === 0) out.push({ s: r.inCheck ? -MATE : 0, b: null, over: true });
      else {
        const top = r.results.filter((x) => x.exact).sort((a, b) => b.s - a.s)[0] || r.results[0];
        out.push({ s: r.forced ? evaluate() : top.s, b: moveCoord(top.m) });
      }
      if (post && (i % 2 === 0 || i === coords.length)) post({ id: req.id, type: "progress", done: i + 1, total: coords.length + 1 });
    }
    return { id: req.id, type: "analysis", scores: out };
  }

  function evalPosition_(req) {
    if (!setupFromMoves(req.moves || [], req.fen)) return { id: req.id, error: "illegal-history" };
    const p = prepare(Object.assign({ depth: 4, nodes: 40000, timeMs: 300, key: "analysis" }, req.params || {}), side);
    const r = searchRoot(p);
    if (r.legal === 0) return { id: req.id, score: r.inCheck ? -MATE : 0, over: true };
    const top = r.results.filter((x) => x.exact).sort((a, b) => b.s - a.s)[0] || r.results[0];
    return { id: req.id, score: r.forced ? evaluate() : top.s, best: moveCoord(top.m) };
  }

  function handle(req, post) {
    switch (req.type) {
      case "newgame": clearTT(); lastKey = null; for (let i = 0; i < history.length; i++) history[i] = 0; return { id: req.id, type: "ok" };
      case "search": return search_(req);
      case "analyze": return analyze_(req, post);
      case "eval": return evalPosition_(req);
      default: return { id: req.id, error: "unknown-request" };
    }
  }

  // ---------- Pomocné funkce pro testy ----------
  function perft(depth, ply) {
    if (depth === 0) return 1;
    const base = (ply || 0) * MPP;
    const n = genMoves(base, false);
    let total = 0;
    for (let i = base; i < n; i++) {
      const m = moves[i];
      if (!makeLegal(m)) continue;
      total += depth === 1 ? 1 : perft(depth - 1, (ply || 0) + 1);
      unmakeMove();
    }
    return total;
  }
  function perftFEN(fen, depth) { setFEN(fen); return perft(depth, 0); }
  function hashIsConsistent() { const a = hLo, b = hHi; computeHash(); const ok = a === hLo && b === hHi; return ok; }
  function legalCoords() {
    const n = genMoves(0, false), out = [];
    for (let i = 0; i < n; i++) { const m = moves[i]; if (makeLegal(m)) { unmakeMove(); out.push(moveCoord(m)); } }
    return out.sort();
  }
  function stateInfo() { return { side, castle, ep, half, sp }; }

  return {
    handle, setFEN, START_FEN, perft, perftFEN, hashIsConsistent, legalCoords, stateInfo, evaluate, mulberry32,
    parseCoord, makeMove, unmakeMove, moveCoord, setupFromMoves, DEFAULTS, MATE
  };
})();

// Záložní cesta, když Web Worker není k dispozici (nebo ho prostředí zakáže).
if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof window === "undefined" && typeof document === "undefined") {
  // V workeru: zprávy zpracuje handle() a odpověď (i průběh rozboru) se pošle zpět.
  self.onmessage = function (e) {
    const req = e.data;
    let res;
    try { res = FastChess.handle(req, function (msg) { self.postMessage(msg); }); }
    catch (err) { res = { id: req && req.id, error: String(err && err.message || err) }; }
    self.postMessage(res);
  };
}
