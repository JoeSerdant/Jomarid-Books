// Nástroje pro šachové úlohy (puzzles.js): řešič matů nad rychlým enginem (FastChess), sestavení hlavní varianty
// a popis tématu. Sdílí ho test (ověřuje hotová data od základu) i generátor genPuzzles.mjs (spouští se ručně).
//
// Úloha "mat v n" je čistá, když platí všechno z tohohle seznamu:
//  - strana na tahu není v šachu a nemá kratší mat než n tahů,
//  - první tah, který vynutí mat v n tazích, je jediný,
//  - totéž platí pro každý další tah útočníka v hlavní variantě (až na poslední: tam stačí jakýkoli mat),
//  - obránce v hlavní variantě odpovídá nejvytrvalejší obranou (mat co nejpozději).
import { loadGame } from './load.mjs';

export function createSolver(get = loadGame()) {
  const F = get('FastChess');
  const E = get('ChessEngine');
  const findByCoord = get('findMoveByCoord');
  const toCoord = get('moveToCoord');

  const mated = () => F.inCheck() && !F.hasLegalMove();

  // Útočník (strana na tahu) vynutí mat nejpozději svým k-tým tahem.
  function canMate(k) {
    const ms = F.legalMoves();
    for (let i = 0; i < ms.length; i++) {
      F.makeMove(ms[i]);
      const ok = k === 1 ? mated() : defenderLoses(k - 1);
      F.unmakeMove();
      if (ok) return true;
    }
    return false;
  }
  // Obránce (strana na tahu) prohraje: buď už je zmatovaný, nebo každá odpověď pustí mat nejpozději za k tahů.
  function defenderLoses(k) {
    const rs = F.legalMoves();
    if (rs.length === 0) return F.inCheck();
    for (let i = 0; i < rs.length; i++) {
      F.makeMove(rs[i]);
      const ok = canMate(k);
      F.unmakeMove();
      if (!ok) return false;
    }
    return true;
  }
  // Všechny první tahy (souřadnice), po kterých jde vynutit mat nejpozději za k tahů. Pozice je právě nastavená v enginu.
  function rootSolutions(k) {
    const out = [];
    const ms = F.legalMoves();
    for (let i = 0; i < ms.length; i++) {
      const c = F.moveCoord(ms[i]);
      F.makeMove(ms[i]);
      const ok = k === 1 ? mated() : defenderLoses(k - 1);
      F.unmakeMove();
      if (ok) out.push(c);
    }
    return out.sort();
  }
  // Nejkratší mat (1..maxN) pro stranu na tahu, nebo 0.
  function shortestMate(maxN) {
    for (let k = 1; k <= maxN; k++) if (canMate(k)) return k;
    return 0;
  }
  function play(fen, coords) {
    F.setFEN(fen);
    for (const c of coords) {
      const m = F.parseCoord(c);
      if (!m) throw new Error('Nelegální tah ' + c + ' v pozici ' + fen);
      F.makeMove(m);
    }
  }

  // Hlavní varianta úlohy "mat v n" (útočník, obránce, útočník, ...), nebo null, když úloha není čistá (viz začátek souboru).
  function buildLine(fen, n) {
    F.setFEN(fen);
    if (F.inCheck()) return null;
    if (n > 1 && shortestMate(n - 1)) return null;
    const line = [];
    let finals = 0;
    for (let remaining = n; remaining >= 1; remaining--) {
      play(fen, line);
      const sols = rootSolutions(remaining);
      if (sols.length === 0) return null;
      if (remaining === 1) { line.push(sols[0]); finals = sols.length; break; }
      if (sols.length !== 1) return null;
      line.push(sols[0]);
      // Odpověď obránce: nejvytrvalejší obrana; z rovnocenných ta, po které je další tah útočníka zase jednoznačný.
      play(fen, line);
      const replies = F.legalMoves();
      if (replies.length === 0) return null;
      let best = [];
      for (const r of replies) {
        const rc = F.moveCoord(r);
        F.makeMove(r);
        let dist = 0;
        for (let k = 1; k < remaining; k++) if (canMate(k)) { dist = k; break; }
        F.unmakeMove();
        if (dist === 0) return null; // tah nevynutí mat v n: nemělo by nastat
        best.push({ rc, dist });
      }
      const worst = Math.max(...best.map((b) => b.dist));
      best = best.filter((b) => b.dist === worst);
      if (worst !== remaining - 1) return null; // nejvytrvalejší obrana mat zkracuje: úloha je ve skutečnosti kratší
      const clean = [];
      for (const b of best) {
        play(fen, line.concat(b.rc));
        const s = rootSolutions(remaining - 1);
        if (remaining - 1 === 1 ? s.length > 0 : s.length === 1) clean.push(b);
      }
      if (!clean.length) return null;
      // Rovnocenné obrany: nejdřív braní tahem, který zrovna zahrál útočník (přijetí oběti), potom jakékoli braní, potom abecedně.
      const lastTo = sols[0].slice(2, 4);
      const st = E.fromFEN(fen);
      let cur = st;
      line.forEach((c) => { cur = E.applyMove(cur, findByCoord(cur, c)); });
      const rank = (b) => {
        const mv = findByCoord(cur, b.rc);
        if (mv.captured && b.rc.slice(2, 4) === lastTo) return 0;
        return mv.captured ? 1 : 2;
      };
      clean.sort((a, b) => rank(a) - rank(b) || (a.rc < b.rc ? -1 : 1));
      line.push(clean[0].rc);
    }
    return { sol: line, finals };
  }

  // Souřadnice figur, které dávají šach králi strany `victim` (geometricky, bez ohledu na legálnost).
  function checkers(state, victim) {
    const king = E.findKing(state.board, victim);
    const att = victim === 'w' ? 'b' : 'w';
    const out = [];
    const at = (r, c) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? state.board[r][c] : null);
    const pr = king.r + (att === 'w' ? 1 : -1);
    for (const dc of [-1, 1]) { const p = at(pr, king.c + dc); if (p && p.color === att && p.type === 'p') out.push({ r: pr, c: king.c + dc, type: 'p' }); }
    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
      const p = at(king.r + dr, king.c + dc);
      if (p && p.color === att && p.type === 'n') out.push({ r: king.r + dr, c: king.c + dc, type: 'n' });
    }
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const diag = dr !== 0 && dc !== 0;
      for (let r = king.r + dr, c = king.c + dc; r >= 0 && r < 8 && c >= 0 && c < 8; r += dr, c += dc) {
        const p = state.board[r][c];
        if (!p) continue;
        if (p.color === att && (p.type === 'q' || p.type === (diag ? 'b' : 'r'))) out.push({ r, c, type: p.type });
        break;
      }
    }
    return out;
  }

  // Téma úlohy z hlavní varianty: hlavní téma matu a popis prvního tahu (kódy; české názvy jsou v puzzles.js).
  function describe(fen, sol) {
    let st = E.fromFEN(fen);
    const attacker = st.turn, defender = attacker === 'w' ? 'b' : 'w';
    let first = null;
    const states = [st];
    sol.forEach((c, i) => {
      const mv = findByCoord(st, c);
      if (i === 0) first = { mv, state: st };
      st = E.applyMove(st, mv);
      states.push(st);
    });
    const lastMove = findByCoord(states[states.length - 2], sol[sol.length - 1]);
    const ch = checkers(st, defender);
    const king = E.findKing(st.board, defender);
    // sousední pole krále: všechna na desce jsou obsazená vlastními figurami -> uškrcený mat
    let free = 0, own = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = king.r + dr, c = king.c + dc;
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      const p = st.board[r][c];
      if (!p) free++; else if (p.color === defender) own++;
    }
    const homeRank = defender === 'w' ? 7 : 0;
    const fwd = defender === 'w' ? -1 : 1;
    let fwdOwn = 0, fwdTotal = 0;
    for (let dc = -1; dc <= 1; dc++) {
      const c = king.c + dc, r = king.r + fwd;
      if (c < 0 || c > 7 || r < 0 || r > 7) continue;
      fwdTotal++;
      const p = st.board[r][c];
      if (p && p.color === defender) fwdOwn++;
    }
    const slider = ch.find((x) => (x.type === 'r' || x.type === 'q') && x.r === king.r);
    let main;
    if (ch.length === 1 && ch[0].type === 'n' && free === 0 && own > 0) main = 'smothered';
    else if (king.r === homeRank && slider && ch.length === 1 && fwdTotal > 0 && fwdOwn === fwdTotal) main = 'backrank';
    else if (ch.length >= 2) main = 'double';
    else if (!ch.some((x) => x.r === lastMove.to.r && x.c === lastMove.to.c)) main = 'discovered';
    else if (lastMove.promotion) main = 'promotion';
    else main = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn', k: 'king' }[ch[0].type];
    // první tah
    let start = 'quiet';
    const afterFirst = states[1];
    if (first.mv.captured) start = 'capture';
    if (E.isInCheck(afterFirst, afterFirst.turn)) start = 'check';
    let sacrifice = null;
    if (sol.length >= 3) {
      const reply = findByCoord(states[1], sol[1]);
      if (reply.captured && reply.to.r === first.mv.to.r && reply.to.c === first.mv.to.c && first.mv.piece.type !== 'p') sacrifice = first.mv.piece.type;
    }
    return { main, start, sacrifice, attacker };
  }

  function pieceCount(fen) {
    const placement = fen.split(' ')[0];
    let n = 0;
    for (const ch of placement) if (/[a-zA-Z]/.test(ch)) n++;
    return n;
  }

  return { F, E, canMate, rootSolutions, shortestMate, buildLine, describe, checkers, play, pieceCount, toCoord, findByCoord };
}
