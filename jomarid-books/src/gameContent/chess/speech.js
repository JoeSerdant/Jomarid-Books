/* speech.js - české popisky pro čtečky obrazovky: jak se jmenuje figura a pole, věta o odehraném tahu a o vybrané figuře.
   Čistá logika bez DOM (kvůli testům v Node); používá jen pravidla z rules.js (mat, šach). */
const Speech = (function () {
  // [podstatné jméno, rod, 7. pád (čím), 4. pád (koho/co)]; rod kvůli shodě přídavného jména (bílá věž, černý jezdec)
  const PIECE_CZ = { p: ["pěšec", "m", "pěšcem", "pěšce"], n: ["jezdec", "m", "jezdcem", "jezdce"], b: ["střelec", "m", "střelcem", "střelce"], r: ["věž", "f", "věží", "věž"], q: ["dáma", "f", "dámou", "dámu"], k: ["král", "m", "králem", "krále"] };
  function pieceLabel(piece) {
    const [nom, g] = PIECE_CZ[piece.type];
    return (piece.color === "w" ? (g === "f" ? "bílá" : "bílý") : (g === "f" ? "černá" : "černý")) + " " + nom;
  }
  function sqName(r, c) { return String.fromCharCode(97 + c) + (8 - r); }
  // Věta o tahu: "jezdcem z g8 na f6, bere pěšce. Šach." (after = pozice po tahu)
  function describeMove(move, after) {
    let t;
    if (move.flag === "castleK") t = "malá rošáda";
    else if (move.flag === "castleQ") t = "velká rošáda";
    else {
      t = PIECE_CZ[move.piece.type][2] + " z " + sqName(move.from.r, move.from.c) + " na " + sqName(move.to.r, move.to.c);
      if (move.flag === "ep") t += ", bere pěšce mimochodem";
      else if (move.captured) t += ", bere " + PIECE_CZ[move.captured.type][3];
      if (move.promotion) t += ", mění se na " + PIECE_CZ[move.promotion][3];
    }
    if (after && ChessEngine.isCheckmate(after)) t += ". Mat.";
    else if (after && ChessEngine.isInCheck(after, after.turn)) t += ". Šach.";
    else t += ".";
    return t;
  }
  // Co čtečka řekne po výběru figury: kam může táhnout (cíle bez opakování, proměny se nezdvojují).
  function describeSelection(piece, r, c, moves) {
    const dests = [];
    moves.forEach((m) => { const n = sqName(m.to.r, m.to.c); if (!dests.includes(n)) dests.push(n); });
    return "Vybráno: " + pieceLabel(piece) + " na " + sqName(r, c) + ". " + (dests.length ? "Možné tahy: " + dests.join(", ") + "." : "Tahle figura teď nemůže táhnout.");
  }
  // Popisek jednoho pole šachovnice: "e4, bílý pěšec, vybráno, možný tah s braním, král v šachu"
  function squareLabel(r, c, piece, opts) {
    let label = sqName(r, c) + ", " + (piece ? pieceLabel(piece) : "prázdné pole");
    const o = opts || {};
    if (o.selected) label += ", vybráno";
    if (o.target) label += ", možný tah" + (o.capture ? " s braním" : "");
    if (o.check) label += ", král v šachu";
    return label;
  }
  return { PIECE_CZ, pieceLabel, sqName, describeMove, describeSelection, squareLabel };
})();
