/* rules.js - pravidla šachů nad objektovou reprezentací šachovnice (board[0] = 8. řada).
   Slouží uživatelskému rozhraní: legální tahy, mat/pat, SAN. Rychlé hledání tahů pro boty
   je v search.js (jiná, rychlejší reprezentace) - oba moduly se v testech křížově ověřují.
   Žádné DOM API, jen čistý výpočet. */
const ChessEngine = (function () {
  const KNIGHT_OFFSETS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  function inBounds(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }
  function opponent(color) {
    return color === "w" ? "b" : "w";
  }
  function cloneBoard(board) {
    return board.map((row) => row.slice());
  }
  function emptyBoard() {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
  function initialState() {
    const board = emptyBoard();
    const backRank = ["r", "n", "b", "q", "k", "b", "n", "r"];
    for (let c = 0; c < 8; c++) {
      board[0][c] = { type: backRank[c], color: "b" };
      board[1][c] = { type: "p", color: "b" };
      board[6][c] = { type: "p", color: "w" };
      board[7][c] = { type: backRank[c], color: "w" };
    }
    return {
      board,
      turn: "w",
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      epTarget: null,
      halfmoveClock: 0,
      fullmoveNumber: 1,
      lastMove: null
    };
  }
  function isSquareAttacked(board, r, c, byColor) {
    const pawnDir = byColor === "w" ? 1 : -1;
    for (const dc of [-1, 1]) {
      const rr = r + pawnDir, cc = c + dc;
      if (inBounds(rr, cc)) {
        const p = board[rr][cc];
        if (p && p.color === byColor && p.type === "p") return true;
      }
    }
    for (const [dr, dc] of KNIGHT_OFFSETS) {
      const rr = r + dr, cc = c + dc;
      if (inBounds(rr, cc)) {
        const p = board[rr][cc];
        if (p && p.color === byColor && p.type === "n") return true;
      }
    }
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr, cc = c + dc;
      if (inBounds(rr, cc)) {
        const p = board[rr][cc];
        if (p && p.color === byColor && p.type === "k") return true;
      }
    }
    for (const [dr, dc] of BISHOP_DIRS) {
      let rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc)) {
        const p = board[rr][cc];
        if (p) {
          if (p.color === byColor && (p.type === "b" || p.type === "q")) return true;
          break;
        }
        rr += dr;
        cc += dc;
      }
    }
    for (const [dr, dc] of ROOK_DIRS) {
      let rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc)) {
        const p = board[rr][cc];
        if (p) {
          if (p.color === byColor && (p.type === "r" || p.type === "q")) return true;
          break;
        }
        rr += dr;
        cc += dc;
      }
    }
    return false;
  }
  function findKing(board, color) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === "k" && p.color === color) return { r, c };
    }
    return null;
  }
  function isInCheck(state, color) {
    const kp = findKing(state.board, color);
    if (!kp) return false;
    return isSquareAttacked(state.board, kp.r, kp.c, opponent(color));
  }
  function addPawnMove(moves, r, c, rr, cc, piece, captured, promoRow, flag) {
    if (rr === promoRow) {
      for (const pt of ["q", "r", "b", "n"]) {
        moves.push({ from: { r, c }, to: { r: rr, c: cc }, piece, captured, promotion: pt, flag: flag || null });
      }
    } else {
      moves.push({ from: { r, c }, to: { r: rr, c: cc }, piece, captured, promotion: null, flag: flag || null });
    }
  }
  function slide(moves, board, r, c, piece, dirs, color) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc)) {
        const target = board[rr][cc];
        if (!target) {
          moves.push({ from: { r, c }, to: { r: rr, c: cc }, piece, captured: null, promotion: null, flag: null });
        } else {
          if (target.color !== color) {
            moves.push({ from: { r, c }, to: { r: rr, c: cc }, piece, captured: target, promotion: null, flag: null });
          }
          break;
        }
        rr += dr;
        cc += dc;
      }
    }
  }
  function generatePseudoMovesForSquare(state, r, c) {
    const board = state.board;
    const piece = board[r][c];
    if (!piece) return [];
    const color = piece.color;
    const moves = [];
    if (piece.type === "p") {
      const dir = color === "w" ? -1 : 1;
      const startRow = color === "w" ? 6 : 1;
      const promoRow = color === "w" ? 0 : 7;
      const r1 = r + dir;
      if (inBounds(r1, c) && !board[r1][c]) {
        addPawnMove(moves, r, c, r1, c, piece, null, promoRow);
        const r2 = r + 2 * dir;
        if (r === startRow && !board[r2][c]) {
          moves.push({ from: { r, c }, to: { r: r2, c }, piece, captured: null, promotion: null, flag: "double" });
        }
      }
      for (const dc of [-1, 1]) {
        const cc = c + dc, rr = r + dir;
        if (!inBounds(rr, cc)) continue;
        const target = board[rr][cc];
        if (target && target.color !== color) {
          addPawnMove(moves, r, c, rr, cc, piece, target, promoRow);
        } else if (!target && state.epTarget && state.epTarget.r === rr && state.epTarget.c === cc) {
          moves.push({ from: { r, c }, to: { r: rr, c: cc }, piece, captured: board[r][cc], promotion: null, flag: "ep" });
        }
      }
    } else if (piece.type === "n") {
      for (const [dr, dc] of KNIGHT_OFFSETS) {
        const rr = r + dr, cc = c + dc;
        if (!inBounds(rr, cc)) continue;
        const target = board[rr][cc];
        if (!target || target.color !== color) {
          moves.push({ from: { r, c }, to: { r: rr, c: cc }, piece, captured: target, promotion: null, flag: null });
        }
      }
    } else if (piece.type === "b") {
      slide(moves, board, r, c, piece, BISHOP_DIRS, color);
    } else if (piece.type === "r") {
      slide(moves, board, r, c, piece, ROOK_DIRS, color);
    } else if (piece.type === "q") {
      slide(moves, board, r, c, piece, BISHOP_DIRS.concat(ROOK_DIRS), color);
    } else if (piece.type === "k") {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr, cc = c + dc;
        if (!inBounds(rr, cc)) continue;
        const target = board[rr][cc];
        if (!target || target.color !== color) {
          moves.push({ from: { r, c }, to: { r: rr, c: cc }, piece, captured: target, promotion: null, flag: null });
        }
      }
      const homeRow = color === "w" ? 7 : 0;
      if (r === homeRow && c === 4) {
        const rights = state.castling;
        const kRight = color === "w" ? rights.wK : rights.bK;
        const qRight = color === "w" ? rights.wQ : rights.bQ;
        const oppo = opponent(color);
        if (kRight && !board[homeRow][5] && !board[homeRow][6] && board[homeRow][7] && board[homeRow][7].type === "r" && board[homeRow][7].color === color) {
          if (!isSquareAttacked(board, homeRow, 4, oppo) && !isSquareAttacked(board, homeRow, 5, oppo) && !isSquareAttacked(board, homeRow, 6, oppo)) {
            moves.push({ from: { r, c }, to: { r: homeRow, c: 6 }, piece, captured: null, promotion: null, flag: "castleK" });
          }
        }
        if (qRight && !board[homeRow][1] && !board[homeRow][2] && !board[homeRow][3] && board[homeRow][0] && board[homeRow][0].type === "r" && board[homeRow][0].color === color) {
          if (!isSquareAttacked(board, homeRow, 4, oppo) && !isSquareAttacked(board, homeRow, 3, oppo) && !isSquareAttacked(board, homeRow, 2, oppo)) {
            moves.push({ from: { r, c }, to: { r: homeRow, c: 2 }, piece, captured: null, promotion: null, flag: "castleQ" });
          }
        }
      }
    }
    return moves;
  }
  function applyMove(state, move) {
    const board = cloneBoard(state.board);
    const { from, to, piece, captured, promotion, flag } = move;
    if (flag === "ep") {
      board[from.r][to.c] = null;
    }
    board[to.r][to.c] = promotion ? { type: promotion, color: piece.color } : { type: piece.type, color: piece.color };
    board[from.r][from.c] = null;
    if (flag === "castleK") {
      const row = from.r;
      board[row][5] = board[row][7];
      board[row][7] = null;
    } else if (flag === "castleQ") {
      const row = from.r;
      board[row][3] = board[row][0];
      board[row][0] = null;
    }
    const castling = Object.assign({}, state.castling);
    if (piece.type === "k") {
      if (piece.color === "w") {
        castling.wK = false;
        castling.wQ = false;
      } else {
        castling.bK = false;
        castling.bQ = false;
      }
    }
    if (piece.type === "r") {
      if (piece.color === "w") {
        if (from.r === 7 && from.c === 0) castling.wQ = false;
        if (from.r === 7 && from.c === 7) castling.wK = false;
      } else {
        if (from.r === 0 && from.c === 0) castling.bQ = false;
        if (from.r === 0 && from.c === 7) castling.bK = false;
      }
    }
    if (captured && captured.type === "r") {
      if (captured.color === "w") {
        if (to.r === 7 && to.c === 0) castling.wQ = false;
        if (to.r === 7 && to.c === 7) castling.wK = false;
      } else {
        if (to.r === 0 && to.c === 0) castling.bQ = false;
        if (to.r === 0 && to.c === 7) castling.bK = false;
      }
    }
    let epTarget = null;
    if (flag === "double") {
      epTarget = { r: (from.r + to.r) / 2, c: from.c };
    }
    let halfmoveClock = state.halfmoveClock + 1;
    if (piece.type === "p" || captured) halfmoveClock = 0;
    let fullmoveNumber = state.fullmoveNumber;
    if (piece.color === "b") fullmoveNumber += 1;
    return {
      board,
      turn: opponent(piece.color),
      castling,
      epTarget,
      halfmoveClock,
      fullmoveNumber,
      lastMove: move
    };
  }
  function generateLegalMoves(state, r, c) {
    const pseudo = generatePseudoMovesForSquare(state, r, c);
    const legal = [];
    for (const m of pseudo) {
      const next = applyMove(state, m);
      if (!isInCheck(next, m.piece.color)) legal.push(m);
    }
    return legal;
  }
  function generateAllLegalMoves(state, color) {
    let all = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && p.color === color) {
        all = all.concat(generateLegalMoves(state, r, c));
      }
    }
    return all;
  }
  function isCheckmate(state) {
    return isInCheck(state, state.turn) && generateAllLegalMoves(state, state.turn).length === 0;
  }
  function isStalemate(state) {
    return !isInCheck(state, state.turn) && generateAllLegalMoves(state, state.turn).length === 0;
  }
  function insufficientMaterial(state) {
    const pieces = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p) pieces.push({ ...p, r, c });
    }
    const nonKings = pieces.filter((p) => p.type !== "k");
    if (nonKings.length === 0) return true;
    if (nonKings.length === 1 && (nonKings[0].type === "b" || nonKings[0].type === "n")) return true;
    if (nonKings.length === 2 && nonKings.every((p) => p.type === "b") && nonKings[0].color !== nonKings[1].color) {
      const sq0 = (nonKings[0].r + nonKings[0].c) % 2;
      const sq1 = (nonKings[1].r + nonKings[1].c) % 2;
      if (sq0 === sq1) return true;
    }
    return false;
  }
  function positionKey(state) {
    let key = "";
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      key += p ? p.color + p.type : "--";
    }
    key += "_" + state.turn + "_" + (state.castling.wK ? 1 : 0) + (state.castling.wQ ? 1 : 0) + (state.castling.bK ? 1 : 0) + (state.castling.bQ ? 1 : 0) + "_" + (state.epTarget ? state.epTarget.r + "," + state.epTarget.c : "x");
    return key;
  }
  function perft(state, depth) {
    if (depth === 0) return 1;
    const moves = generateAllLegalMoves(state, state.turn);
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (const m of moves) {
      nodes += perft(applyMove(state, m), depth - 1);
    }
    return nodes;
  }

  // ---- FEN (hlavně pro testy a rozbor): board[0] je 8. řada, jako všude v téhle hře ----
  function fromFEN(fen) {
    const parts = fen.trim().split(/\s+/);
    const board = emptyBoard();
    const rows = parts[0].split("/");
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (/[1-8]/.test(ch)) { c += Number(ch); continue; }
        const color = ch === ch.toUpperCase() ? "w" : "b";
        board[r][c++] = { type: ch.toLowerCase(), color };
      }
    }
    const cs = parts[2] || "-";
    const ept = parts[3] && parts[3] !== "-" ? { r: 8 - Number(parts[3][1]), c: parts[3].charCodeAt(0) - 97 } : null;
    return {
      board,
      turn: parts[1] === "b" ? "b" : "w",
      castling: { wK: cs.includes("K"), wQ: cs.includes("Q"), bK: cs.includes("k"), bQ: cs.includes("q") },
      epTarget: ept,
      halfmoveClock: Number(parts[4]) || 0,
      fullmoveNumber: Number(parts[5]) || 1,
      lastMove: null
    };
  }
  function toFEN(state) {
    const rows = state.board.map((row) => {
      let s = "", empty = 0;
      for (const p of row) {
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        s += p.color === "w" ? p.type.toUpperCase() : p.type;
      }
      return s + (empty ? empty : "");
    });
    const c = state.castling;
    const cs = (c.wK ? "K" : "") + (c.wQ ? "Q" : "") + (c.bK ? "k" : "") + (c.bQ ? "q" : "") || "-";
    const ept = state.epTarget ? String.fromCharCode(97 + state.epTarget.c) + (8 - state.epTarget.r) : "-";
    return rows.join("/") + " " + state.turn + " " + cs + " " + ept + " " + state.halfmoveClock + " " + state.fullmoveNumber;
  }
  return { initialState, generateAllLegalMoves, generateLegalMoves, applyMove, isInCheck, isCheckmate, isStalemate, insufficientMaterial, positionKey, findKing, isSquareAttacked, opponent, perft, fromFEN, toFEN };
})();

// ---------- Zápis tahů ----------
function squareName(r, c) {
  return String.fromCharCode(97 + c) + (8 - r);
}
// Tah jako souřadnice ("e2e4", "e7e8q") - společný jazyk mezi UI, workerem a uloženou hrou.
function moveToCoord(move) {
  return squareName(move.from.r, move.from.c) + squareName(move.to.r, move.to.c) + (move.promotion || "");
}
function findMoveByCoord(state, coord) {
  const all = ChessEngine.generateAllLegalMoves(state, state.turn);
  for (const m of all) if (moveToCoord(m) === coord) return m;
  return null;
}
function appendCheckSuffix(san, stateAfter) {
  if (ChessEngine.isInCheck(stateAfter, stateAfter.turn)) {
    const noMoves = ChessEngine.generateAllLegalMoves(stateAfter, stateAfter.turn).length === 0;
    return san + (noMoves ? "#" : "+");
  }
  return san;
}
function toSAN(move, allLegalBefore, stateAfter) {
  if (move.flag === "castleK") return appendCheckSuffix("O-O", stateAfter);
  if (move.flag === "castleQ") return appendCheckSuffix("O-O-O", stateAfter);
  const pieceLetter = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "" }[move.piece.type];
  let disamb = "";
  if (move.piece.type !== "p") {
    const others = allLegalBefore.filter((m) => (m.from.r !== move.from.r || m.from.c !== move.from.c) && m.piece.type === move.piece.type && m.piece.color === move.piece.color && m.to.r === move.to.r && m.to.c === move.to.c);
    if (others.length > 0) {
      const sameFile = others.some((m) => m.from.c === move.from.c);
      const sameRank = others.some((m) => m.from.r === move.from.r);
      const fromName = squareName(move.from.r, move.from.c);
      if (!sameFile) disamb = fromName[0];
      else if (!sameRank) disamb = fromName[1];
      else disamb = fromName;
    }
  }
  const pawnFile = move.piece.type === "p" && move.captured ? squareName(move.from.r, move.from.c)[0] : "";
  const capture = move.captured ? "x" : "";
  const dest = squareName(move.to.r, move.to.c);
  const promo = move.promotion ? "=" + move.promotion.toUpperCase() : "";
  return appendCheckSuffix(pieceLetter + disamb + pawnFile + capture + dest + promo, stateAfter);
}
// SAN bez +/# - tak se porovnávají tahy s knihou zahájení.
function plainSAN(san) {
  return san.replace(/[+#!?]/g, "");
}
// Tah z knihy zahájení zapsaný v SAN -> objekt tahu (nebo null, když v téhle pozici neexistuje).
function findMoveBySAN(state, san) {
  const all = ChessEngine.generateAllLegalMoves(state, state.turn);
  const want = plainSAN(san);
  for (const m of all) {
    if (plainSAN(toSAN(m, all, ChessEngine.applyMove(state, m))) === want) return m;
  }
  return null;
}
// Co kdo sebral + materiálový rozdíl (pěšec 1, jezdec/střelec 3, věž 5, dáma 9).
function computeCaptured(chessState) {
  const startCounts = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const remaining = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of chessState.board) for (const p of row) {
    if (p && p.type !== "k") remaining[p.color][p.type]++;
  }
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const order = ["q", "r", "b", "n", "p"];
  function missingList(color) {
    const list = [];
    for (const t of order) {
      // proměny pěšce můžou dát víc figur, než je výchozí počet - tím se "chybějící" nezáporní
      const missing = Math.max(0, startCounts[t] - remaining[color][t]);
      for (let i = 0; i < missing; i++) list.push(t);
    }
    return list;
  }
  const takenFromBlack = missingList("b");
  const takenFromWhite = missingList("w");
  return { capturedByWhite: takenFromBlack, capturedByBlack: takenFromWhite, advantage: materialOf("w") - materialOf("b") };
  function materialOf(color) {
    let s = 0;
    for (const t of order) s += VAL[t] * remaining[color][t];
    return s;
  }
}
