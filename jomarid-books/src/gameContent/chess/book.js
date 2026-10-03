/* book.js - kniha zahájení pro boty a české názvy zahájení.
   Tahy jsou v SAN bez šachů (porovnávají se přes plainSAN z rules.js). Každá čára je celá
   partie od začátku: bílý táhne na sudých, černý na lichých místech. Bot, který se drží
   knihy, vybírá z čar shodných s dosavadním průběhem a chová se tak jako člověk, co zná teorii.
   Mimo knihu (soupeř vybočil, nebo čára skončila) dál hraje engine. */
const OpeningBook = (function () {
  // štítky: open (1.e4 e5), sicilian, semi (polootevřené: francouzská, caro-kann...), closed (1.d4 d5),
  // indian, flank (křídlová zahájení), solid (klidné pozice), sharp (ostré, taktické)
  const RAW = [
    // ---- 1.e4 e5 ----
    ["open solid", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O"],
    ["open sharp", "e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O"],
    ["open sharp", "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6 Nf3 e4"],
    ["open solid", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3"],
    ["open solid", "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8"],
    ["open sharp", "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6"],
    ["open solid", "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7 Bc4 Ne5"],
    ["open solid", "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Be7 O-O Nc6 Re1 Bg4"],
    ["open sharp", "e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7 d4 O-O Bd3 f5"],
    ["open sharp", "e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5 Nf6 Bc4 d5 exd5 Bd6 d4 Nh5"],
    ["open solid", "e4 e5 Bc4 Nf6 d3 c6 Nf3 d5 Bb3 Bd6 O-O O-O"],
    ["open solid", "e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O O-O d3 Bxc3 bxc3 d6 Bg5 Qe7"],
    ["open solid", "e4 e5 Nf3 d6 d4 Nf6 Nc3 Nbd7 Bc4 Be7 O-O O-O"],
    ["open sharp", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Nc3 Nxe4 O-O Bxc3 d5 Bf6"],
    // ---- Sicilská ----
    ["sicilian sharp", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O"],
    ["sicilian sharp", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6 Bc4 Bd7 O-O-O"],
    ["sicilian solid", "e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 Bd3 Nf6 O-O Qc7 Qe2 d6 c4 g6"],
    ["sicilian sharp", "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 d6 Bg5 e6 Qd2 a6 O-O-O Bd7 f4 b5"],
    ["sicilian solid", "e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6 Bc4 Nb6 Bb5 dxe5 Nxe5 Bd7"],
    ["sicilian solid", "e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 Be3 e6 Qd2 Nge7"],
    ["sicilian sharp", "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7 Be3 Nf6 Bc4 O-O Bb3 d6 f3 Bd7"],
    ["sicilian sharp", "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6 Qd2 Nf6 O-O-O Be7 f3"],
    // ---- polootevřené ----
    ["semi solid", "e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7 f4 O-O Nf3 c5"],
    ["semi sharp", "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 Qc7 Qxg7 Rg8 Qxh7 cxd4 Ne2 Nbc6"],
    ["semi solid", "e4 e6 d4 d5 exd5 exd5 Nf3 Nf6 Bd3 Bd6 O-O O-O Bg5 Bg4"],
    ["semi solid", "e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6 Ne2 cxd4 cxd4 f6"],
    ["semi solid", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6"],
    ["semi solid", "e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 cxd4 Nxd4 Nd7 O-O Ne7"],
    ["semi sharp", "e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6 Nf3 Be7 cxd5 Nxd5 Bd3 Nc6 O-O O-O"],
    ["semi sharp", "e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5"],
    ["semi solid", "e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O c6 a4 Nbd7"],
    ["semi sharp", "e4 d6 d4 Nf6 Nc3 g6 f4 Bg7 Nf3 O-O Bd3 Na6 O-O c5"],
    ["semi sharp", "e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4 Be2 e6 O-O Be7 c4 Nb6 Nc3 O-O"],
    // ---- 1.d4 d5 ----
    ["closed solid", "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7 Nxd5 exd5"],
    ["closed solid", "d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6 Qe2 b5 Bb3 Nc6"],
    ["closed solid", "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O Nbd7"],
    ["closed sharp", "d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5 Bd3 Bb7"],
    ["closed solid", "d4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6 Bg3 O-O Nbd2 c5 c3 Nc6 Bd3"],
    ["closed solid", "d4 d5 Nf3 Nf6 e3 e6 Bd3 c5 b3 Nc6 O-O Bd6 Bb2 O-O"],
    ["closed solid", "d4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O c4 d6 Nc3 Qe8"],
    ["closed solid", "d4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4 Qc2 a6"],
    // ---- indické systémy ----
    ["indian sharp", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7"],
    ["indian sharp", "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5 Be3 Qa5 Qd2 O-O Rc1"],
    ["indian solid", "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4 Bxc4 Qc7"],
    ["indian solid", "d4 Nf6 c4 e6 Nf3 b6 g3 Bb7 Bg2 Be7 O-O O-O Nc3 Ne4 Qc2 Nxc3 Qxc3 c5"],
    ["indian sharp", "d4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 e4 g6 Nf3 Bg7 Be2 O-O O-O"],
    ["indian solid", "d4 Nf6 c4 e6 Nf3 Bb4+ Bd2 Qe7 g3 Nc6 Nc3 Bxc3 Bxc3 Ne4 Rc1 O-O Bg2"],
    ["indian sharp", "d4 Nf6 Bg5 Ne4 Bf4 c5 f3 Qa5+ c3 Nf6 d5 Qb6 Qd2 d6"],
    // ---- křídlová zahájení ----
    ["flank solid", "c4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 Nf3 e6 O-O Nge7 d3 O-O"],
    ["flank solid", "c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7 d3 O-O"],
    ["flank solid", "c4 Nf6 Nc3 g6 e4 d6 d4 Bg7 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7"],
    ["flank solid", "Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5 e4 Nc6 c3"],
    ["flank solid", "Nf3 Nf6 c4 g6 Nc3 Bg7 e4 d6 d4 O-O Be2 e5 O-O"],
    ["flank solid", "Nf3 c5 c4 Nf6 Nc3 e6 g3 b6 Bg2 Bb7 O-O Be7 d4 cxd4 Qxd4 d6"],
    ["flank solid", "Nf3 d5 g3 c5 Bg2 Nc6 O-O e5 d3 Nf6 Nbd2 Be7 e4 O-O"],
    ["flank solid", "b3 e5 Bb2 Nc6 e3 d5 Bb5 Bd6 Nf3 Qe7"],
    ["flank sharp", "f4 d5 Nf3 Nf6 e3 g6 Be2 Bg7 O-O O-O d3 c5"]
  ];

  const LINES = RAW.map(([tags, moves]) => ({ tags: tags.split(" "), moves: moves.replace(/[+#]/g, "").split(" ") }));

  // České názvy zahájení; platí nejdelší shodný začátek partie.
  const NAMES = [
    ["e4", "Zahájení královského pěšce"],
    ["d4", "Zahájení dámského pěšce"],
    ["c4", "Anglické zahájení"],
    ["Nf3", "Zahájení Réti"],
    ["f4", "Birdovo zahájení"],
    ["b3", "Larsenovo zahájení"],
    ["e4 e5", "Otevřená hra"],
    ["e4 e5 Nf3 Nc6 Bc4", "Italská hra"],
    ["e4 e5 Nf3 Nc6 Bc4 Bc5", "Italská hra: Giuoco Piano"],
    ["e4 e5 Nf3 Nc6 Bc4 Bc5 b4", "Evansův gambit"],
    ["e4 e5 Nf3 Nc6 Bc4 Nf6", "Hra dvou jezdců"],
    ["e4 e5 Nf3 Nc6 Bb5", "Španělská hra"],
    ["e4 e5 Nf3 Nc6 Bb5 Nf6", "Španělská hra: berlínská obrana"],
    ["e4 e5 Nf3 Nc6 d4", "Skotská hra"],
    ["e4 e5 Nf3 Nc6 Nc3", "Hra tří jezdců"],
    ["e4 e5 Nf3 Nc6 Nc3 Nf6", "Hra čtyř jezdců"],
    ["e4 e5 Nf3 Nf6", "Petrovova obrana"],
    ["e4 e5 Nf3 d6", "Philidorova obrana"],
    ["e4 e5 f4", "Královský gambit"],
    ["e4 e5 Nc3", "Vídeňská hra"],
    ["e4 e5 Bc4", "Střelcová hra"],
    ["e4 c5", "Sicilská obrana"],
    ["e4 c5 c3", "Sicilská obrana: Alapinova varianta"],
    ["e4 c5 Nc3", "Uzavřená sicilská"],
    ["e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6", "Sicilská obrana: Najdorfova varianta"],
    ["e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6", "Sicilská obrana: dračí varianta"],
    ["e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6", "Sicilská obrana: zrychlený drak"],
    ["e4 c5 Nf3 e6", "Sicilská obrana: Kanova varianta"],
    ["e4 e6", "Francouzská obrana"],
    ["e4 e6 d4 d5 Nc3 Bb4", "Francouzská obrana: Winawerova varianta"],
    ["e4 e6 d4 d5 exd5", "Francouzská obrana: výměnná varianta"],
    ["e4 e6 d4 d5 Nd2", "Francouzská obrana: Tarraschova varianta"],
    ["e4 c6", "Caro-Kann"],
    ["e4 c6 d4 d5 e5", "Caro-Kann: pokročilá varianta"],
    ["e4 c6 d4 d5 exd5", "Caro-Kann: Panovův útok"],
    ["e4 d5", "Skandinávská obrana"],
    ["e4 d6", "Pircova obrana"],
    ["e4 Nf6", "Aljechinova obrana"],
    ["e4 g6", "Moderní obrana"],
    ["d4 d5", "Zahájení dámského pěšce"],
    ["d4 d5 c4", "Dámský gambit"],
    ["d4 d5 c4 e6", "Odmítnutý dámský gambit"],
    ["d4 d5 c4 dxc4", "Přijatý dámský gambit"],
    ["d4 d5 c4 c6", "Slovanská obrana"],
    ["d4 d5 Bf4", "Londýnský systém"],
    ["d4 d5 Nf3 Nf6 Bf4", "Londýnský systém"],
    ["d4 d5 Nf3 Nf6 e3", "Collův systém"],
    ["d4 f5", "Holandská obrana"],
    ["d4 Nf6", "Indická obrana"],
    ["d4 Nf6 Bg5", "Trompowského zahájení"],
    ["d4 Nf6 c4 g6", "Královská indická obrana"],
    ["d4 Nf6 c4 g6 Nc3 d5", "Grünfeldova obrana"],
    ["d4 Nf6 c4 e6 Nc3 Bb4", "Nimcovičova obrana"],
    ["d4 Nf6 c4 e6 Nf3 b6", "Dámská indická obrana"],
    ["d4 Nf6 c4 e6 Nf3 Bb4", "Bogoindická obrana"],
    ["d4 Nf6 c4 e6 g3", "Katalánské zahájení"],
    ["d4 Nf6 c4 c5 d5", "Benoni"],
    ["c4 e5", "Anglické zahájení: obrácená sicilská"],
    ["c4 c5", "Anglické zahájení: symetrická varianta"],
    ["Nf3 d5", "Zahájení Réti"],
    ["Nf3 d5 g3", "Zahájení Réti: královský indický útok"]
  ];

  const nameKeys = NAMES.map(([k, v]) => [k.split(" "), v]);

  function samePrefix(line, played) {
    for (let i = 0; i < played.length; i++) if (line[i] !== played[i]) return false;
    return true;
  }

  // Název zahájení pro dosavadní průběh (pole SAN bez +/#) nebo null, dokud se nehrálo.
  function nameFor(played) {
    if (!played.length) return null;
    let best = null, bestLen = 0;
    for (const [key, name] of nameKeys) {
      if (key.length <= played.length && key.length > bestLen && samePrefix(key, played.slice(0, key.length))) {
        best = name; bestLen = key.length;
      }
    }
    return best || "Neobvyklé zahájení";
  }

  // Další tah z knihy (SAN) nebo null. opts: { tags: [...], maxPly: n }
  // Čáry se váží stejně, takže častější pokračování se vybírá častěji.
  function pickMove(played, opts, rng) {
    const maxPly = opts.maxPly != null ? opts.maxPly : 99;
    const n = played.length;
    if (n >= maxPly) return null;
    const tags = opts.tags || null;
    const counts = {};
    let total = 0;
    for (const line of LINES) {
      if (line.moves.length <= n) continue;
      if (tags && !line.tags.some((t) => tags.includes(t))) continue;
      if (!samePrefix(line.moves, played)) continue;
      const mv = line.moves[n];
      counts[mv] = (counts[mv] || 0) + 1;
      total++;
    }
    if (total === 0) return null;
    let roll = rng() * total;
    for (const mv of Object.keys(counts)) { roll -= counts[mv]; if (roll <= 0) return mv; }
    return Object.keys(counts)[0];
  }

  return { LINES, NAMES, nameFor, pickMove };
})();
