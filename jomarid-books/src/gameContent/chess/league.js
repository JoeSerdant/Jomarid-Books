/* league.js - hodnocení (Elo), soupeři a uložený postup. Čistá logika bez DOM,
   proto jde celá otestovat v Node. Úložiště se předává zvenku (getItem/setItem). */
const League = (function () {
  const SAVE_KEY = "chessLeague.save.v1"; // klíč zůstává, aby hráči nepřišli o postup
  const GAME_KEY = "chessLeague.game.v1"; // rozehraná partie
  const SAVE_VERSION = 2;
  const START_RATING = 800;
  const RATING_FLOOR = 100;
  const PROVISIONAL_GAMES = 10;
  const HISTORY_CAP = 80;
  const RECENT_CAP = 20;

  const TIME_CONTROLS = [
    { key: "none", label: "Bez limitu", short: "∞", base: 0, inc: 0 },
    { key: "rapid10", label: "10 minut", short: "10 min", base: 600, inc: 0 },
    { key: "blitz5", label: "5 min + 3 s", short: "5+3", base: 300, inc: 3 },
    { key: "blitz3", label: "3 min + 2 s", short: "3+2", base: 180, inc: 2 },
    { key: "bullet1", label: "1 minuta", short: "1 min", base: 60, inc: 0 }
  ];

  // ---------- Elo ----------
  function expectedScore(rating, opp) {
    return 1 / (1 + Math.pow(10, (opp - rating) / 400));
  }
  // Kalibrace: prvních 10 hodnocených zápasů se rating hýbe rychleji, pak se uklidní.
  function kFactor(ratedGames) {
    if (ratedGames < PROVISIONAL_GAMES) return 40;
    if (ratedGames < 30) return 28;
    return 20;
  }
  // score: 1 výhra, 0.5 remíza, 0 prohra. Výhra vždy aspoň +1 a prohra aspoň -1.
  function ratingChange(rating, opp, score, ratedGames) {
    const expected = expectedScore(rating, opp);
    const k = kFactor(ratedGames);
    let delta = Math.round(k * (score - expected));
    if (score === 1 && delta < 1) delta = 1;
    if (score === 0 && delta > -1) delta = -1;
    if (rating + delta < RATING_FLOOR) delta = RATING_FLOOR - rating;
    return { delta, expected, k };
  }
  const RATING_TITLES = [
    { min: 0, name: "Nováček" },
    { min: 700, name: "Začátečník" },
    { min: 950, name: "Pokročilý" },
    { min: 1200, name: "Klubový hráč" },
    { min: 1500, name: "Silný hráč" },
    { min: 1800, name: "Expert" },
    { min: 2100, name: "Mistr" }
  ];
  function ratingTitle(rating) {
    let t = RATING_TITLES[0];
    for (const x of RATING_TITLES) if (rating >= x.min) t = x;
    return t.name;
  }

  // ---------- Rozbor partie: přesnost a kvalita tahů ----------
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  // Skóre v setinách pěšce -> pravděpodobnost výhry (0-100), stejný tvar jako na lichess.
  function winPercent(cp) {
    const c = clamp(cp, -1000, 1000);
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
  }
  function moveAccuracy(wpBefore, wpAfter) {
    const diff = Math.max(0, wpBefore - wpAfter);
    return clamp(103.1668 * Math.exp(-0.04354 * diff) - 3.1669, 0, 100);
  }
  const CATEGORY_LABELS = { best: "Nejlepší", good: "Výborný", ok: "Dobrý", inaccuracy: "Nepřesnost", mistake: "Chyba", blunder: "Hrubka" };
  function classify(loss, wasBest) {
    if (wasBest || loss < 0.5) return "best";
    if (loss < 2.5) return "good";
    if (loss < 10) return "ok";
    if (loss < 20) return "inaccuracy";
    if (loss < 30) return "mistake";
    return "blunder";
  }
  // scores[i] = { s: skóre pro stranu na tahu v pozici i, b: nejlepší tah } pro i = 0..počet tahů.
  // Výsledek: přesnost obou stran, počty kategorií a graf výhodnosti bílého.
  function summarizeAnalysis(scores, coords) {
    const n = coords.length;
    const perPly = [], graph = [];
    const acc = { w: [], b: [] };
    const counts = { w: { best: 0, good: 0, ok: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, b: { best: 0, good: 0, ok: 0, inaccuracy: 0, mistake: 0, blunder: 0 } };
    for (let i = 0; i <= n; i++) {
      const sc = scores[i] ? scores[i].s : 0;
      const wpMover = winPercent(sc);
      graph.push(i % 2 === 0 ? wpMover : 100 - wpMover); // z pohledu bílého
    }
    for (let i = 0; i < n; i++) {
      if (!scores[i] || !scores[i + 1]) { perPly.push(null); continue; }
      const side = i % 2 === 0 ? "w" : "b";
      const before = winPercent(scores[i].s);
      const after = winPercent(-scores[i + 1].s);
      const wasBest = scores[i].b === coords[i];
      const loss = wasBest ? 0 : Math.max(0, before - after);
      const cat = classify(loss, wasBest);
      acc[side].push(moveAccuracy(before, wasBest ? before : after));
      counts[side][cat]++;
      perPly.push({ cat, loss, best: scores[i].b, played: coords[i] });
    }
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    return { acc: { w: mean(acc.w), b: mean(acc.b) }, counts, perPly, graph };
  }

  // ---------- Statistiky pro odznaky ----------
  // Čítače za celou dobu hraní. Hlásí se appce přes recordStats (názvy jsou stejné jako v src/gameRecords/defs/chess.js); odznaky vyhodnocuje server.
  // Počítají se jen hodnocené výhry (partie s nápovědou hodnocená není), aby se odznaky nedaly získat pomocí nápovědy.
  const STAT_KEYS = ["games_total", "draws_total", "losses_total", "wins_white", "wins_black", "mate_wins", "time_wins", "quick_wins", "stalemates",
    "repetitions", "fifty_move_draws", "bot_resigns", "resigns", "flagged", "longest_game_moves", "best_accuracy", "clean_games", "flawless_games",
    "checks_given", "castlings", "promotions", "underpromotions", "en_passants", "pieces_captured", "queens_captured", "hints_used", "undos_used",
    "bullet_wins", "blitz_wins", "rapid_wins", "best_rating_gain", "upsets", "biggest_upset"];
  const STAT_DAYS_CAP = 400;
  function emptyStats() { const o = {}; STAT_KEYS.forEach((k) => { o[k] = 0; }); return o; }
  function cleanStats(raw) {
    const o = emptyStats();
    if (raw && typeof raw === "object") STAT_KEYS.forEach((k) => { const n = Math.floor(Number(raw[k])); if (Number.isFinite(n) && n > 0) o[k] = n; });
    return o;
  }
  // Co hráč za partii udělal: záznamy tahů ({ color, capture, flag, promotion, check }) pro jeho barvu.
  function summarizeMoves(moves, color) {
    const d = { checks: 0, castles: 0, promotions: 0, underpromotions: 0, enPassants: 0, captures: 0, queensCaptured: 0 };
    (moves || []).forEach((m) => {
      if (!m || m.color !== color) return;
      if (m.check) d.checks++;
      if (m.flag === "castleK" || m.flag === "castleQ") d.castles++;
      if (m.promotion === "q") d.promotions++; else if (m.promotion) d.underpromotions++;
      if (m.flag === "ep") d.enPassants++;
      if (m.capture) { d.captures++; if (m.capture === "q") d.queensCaptured++; }
    });
    return d;
  }
  function updateStats(s, g, bot, summary, today) {
    const st = s.stats;
    const win = g.result === "win", loss = g.result === "loss", draw = g.result === "draw";
    st.games_total++;
    if (draw) {
      st.draws_total++;
      if (g.reason === "stalemate") st.stalemates++;
      else if (g.reason === "repetition") st.repetitions++;
      else if (g.reason === "fiftymove") st.fifty_move_draws++;
    }
    if (loss) { st.losses_total++; if (g.reason === "resign") st.resigns++; else if (g.reason === "timeout") st.flagged++; }
    if (win && g.reason === "botresign") st.bot_resigns++;
    const fullMoves = Math.ceil((g.plies || 0) / 2);
    if (fullMoves > st.longest_game_moves) st.longest_game_moves = fullMoves;
    const d = g.details;
    if (d) {
      st.checks_given += d.checks | 0; st.castlings += d.castles | 0; st.promotions += d.promotions | 0; st.underpromotions += d.underpromotions | 0;
      st.en_passants += d.enPassants | 0; st.pieces_captured += d.captures | 0; st.queens_captured += d.queensCaptured | 0;
    }
    st.hints_used += g.hints | 0;
    st.undos_used += g.undos | 0;
    if (g.rated) {
      if (summary.delta > st.best_rating_gain) st.best_rating_gain = summary.delta;
      if (win) {
        if (g.color === "b") st.wins_black++; else st.wins_white++;
        if (g.reason === "checkmate") st.mate_wins++;
        if (g.reason === "timeout") st.time_wins++;
        if ((g.plies || 0) <= 40) st.quick_wins++;
        if (g.tc === "bullet1") st.bullet_wins++;
        else if (g.tc === "blitz3" || g.tc === "blitz5") st.blitz_wins++;
        else if (g.tc === "rapid10") st.rapid_wins++;
        const gap = bot.rating - summary.ratingBefore;
        if (gap >= 100) st.upsets++;
        if (gap > st.biggest_upset) st.biggest_upset = gap;
      }
    }
    if (today && !s.statDays.includes(today)) s.statDays = s.statDays.concat(today).slice(-STAT_DAYS_CAP);
  }
  // Po rozboru partie: přesnost a čisté partie (counts = počty chyb hráče z rozboru, plies = počet půltahů).
  function recordAccuracy(save, accuracy, counts, plies) {
    const s = JSON.parse(JSON.stringify(save));
    s.stats = cleanStats(s.stats);
    const a = Math.round(Number(accuracy));
    if (Number.isFinite(a) && a > s.stats.best_accuracy) s.stats.best_accuracy = Math.min(100, a);
    if (counts && plies >= 20) {
      if (!counts.blunder && !counts.mistake) s.stats.clean_games++;
      if (!counts.blunder && !counts.mistake && !counts.inaccuracy) s.stats.flawless_games++;
    }
    return s;
  }
  // Všechny statistiky pro appku: { název: hodnota } (část je uložená v s.stats, část se odvozuje z ostatního postupu).
  function recordStats(s) {
    const st = s.stats || {};
    const bs = s.botStats || {};
    const w = (k) => (bs[k] && bs[k].w) || 0;
    const out = {
      rating_peak: s.peak, wins_total: s.record && s.record.w, expert_wins: w("expert"), bots_unlocked: (s.unlockedIndex || 0) + 1,
      wins_beginner: w("beginner"), wins_easy: w("easy"), wins_medium: w("medium"), wins_hard: w("hard"),
      win_streak: s.bestWinStreak || 0, days_played: (s.statDays || []).length
    };
    STAT_KEYS.forEach((k) => { out[k] = st[k] || 0; });
    return out;
  }
  // Cheat menu: všechny statistiky na hodnoty pro odznaky (jen na zkoušení, ukládá se jako skutečný postup).
  const CHEAT_STATS = {
    rating_peak: 2100,
    wins_total: 100,
    expert_wins: 5,
    bots_unlocked: 5,
    wins_beginner: 5,
    wins_easy: 5,
    wins_medium: 5,
    wins_hard: 5,
    win_streak: 10,
    games_total: 150,
    draws_total: 10,
    losses_total: 10,
    wins_white: 25,
    wins_black: 25,
    mate_wins: 50,
    time_wins: 3,
    quick_wins: 3,
    stalemates: 1,
    repetitions: 1,
    fifty_move_draws: 1,
    bot_resigns: 1,
    resigns: 3,
    flagged: 3,
    longest_game_moves: 100,
    best_accuracy: 95,
    clean_games: 3,
    flawless_games: 1,
    checks_given: 1000,
    castlings: 25,
    promotions: 5,
    underpromotions: 1,
    en_passants: 1,
    pieces_captured: 500,
    queens_captured: 25,
    hints_used: 5,
    undos_used: 10,
    bullet_wins: 1,
    blitz_wins: 3,
    rapid_wins: 3,
    best_rating_gain: 30,
    upsets: 5,
    biggest_upset: 300,
    days_played: 14,
  };
  function cheatAllBadges(save) {
    const s = JSON.parse(JSON.stringify(save));
    s.stats = cleanStats(s.stats);
    STAT_KEYS.forEach((k) => { s.stats[k] = Math.max(s.stats[k], CHEAT_STATS[k] || 0); });
    s.peak = Math.max(s.peak, CHEAT_STATS.rating_peak);
    s.record.w = Math.max(s.record.w, CHEAT_STATS.wins_total);
    BOT_KEYS.forEach((k) => { if (CHEAT_STATS["wins_" + k] != null) s.botStats[k].w = Math.max(s.botStats[k].w, CHEAT_STATS["wins_" + k]); });
    s.botStats.expert.w = Math.max(s.botStats.expert.w, CHEAT_STATS.expert_wins);
    s.bestWinStreak = Math.max(s.bestWinStreak || 0, CHEAT_STATS.win_streak);
    s.unlockedIndex = Math.max(s.unlockedIndex || 0, CHEAT_STATS.bots_unlocked - 1);
    s.statDays = s.statDays || [];
    while (s.statDays.length < CHEAT_STATS.days_played) s.statDays.push("cheat-" + s.statDays.length);
    return s;
  }

  // ---------- Uložený postup ----------
  function emptyRecord() { return { w: 0, d: 0, l: 0 }; }
  const BOT_KEYS = ["beginner", "easy", "medium", "hard", "expert"];
  function defaultSave() {
    const botStats = {};
    BOT_KEYS.forEach((k) => { botStats[k] = emptyRecord(); });
    return {
      v: SAVE_VERSION,
      unlockedIndex: 0,
      wins: { beginner: 0, easy: 0, medium: 0, hard: 0, expert: 0 },
      sound: true, theme: "dark", playerColor: "w", tc: "none",
      highlights: true, botChat: true, autoQueen: false, board: "green",
      recentGames: [],
      rating: START_RATING, peak: START_RATING, ratedGames: 0,
      ratingHistory: [], record: emptyRecord(), botStats,
      winStreak: 0, bestWinStreak: 0,
      stats: emptyStats(), statDays: []
    };
  }

  // Starý postup (bez skutečného ratingu) dostane počáteční rating podle toho, koho už porazil.
  function seedRating(raw, botRatings) {
    let seed = START_RATING;
    const wins = raw.wins || {};
    BOT_KEYS.forEach((k, i) => { if (wins[k] > 0 && botRatings[i] != null) seed = Math.max(seed, botRatings[i] - 150); });
    return seed;
  }
  function migrate(raw, botRatings) {
    const base = defaultSave();
    if (!raw || typeof raw !== "object") return base;
    const merged = { ...base, ...raw, wins: { ...base.wins, ...(raw.wins || {}) } };
    merged.botStats = { ...base.botStats, ...(raw.botStats || {}) };
    BOT_KEYS.forEach((k) => { merged.botStats[k] = { ...emptyRecord(), ...merged.botStats[k] }; });
    merged.record = { ...emptyRecord(), ...(raw.record || {}) };
    merged.stats = cleanStats(raw.stats);
    merged.statDays = Array.isArray(raw.statDays) ? raw.statDays.filter((d) => typeof d === "string").slice(-STAT_DAYS_CAP) : [];
    // Denní výzvy, série dní a XP s ligami už ve hře nejsou (to dělá Jomarid Books samotný); zbylé hodnoty ze starého postupu se zahodí.
    ['xp', 'streak', 'lastPlayedDate', 'questClaims'].forEach((k) => { delete merged[k]; });
    if (!raw.v || raw.v < 2) {
      merged.rating = seedRating(raw, botRatings || []);
      merged.peak = merged.rating;
      merged.ratedGames = 0;
      merged.ratingHistory = [];
      if (merged.theme === "system" || merged.theme === "light") merged.theme = "dark";
    }
    merged.v = SAVE_VERSION;
    if (!Array.isArray(merged.recentGames)) merged.recentGames = [];
    merged.recentGames = merged.recentGames.map((g) => { const c = Object.assign({}, g); delete c.xpGained; return c; });
    if (!Array.isArray(merged.ratingHistory)) merged.ratingHistory = [];
    merged.rating = Math.max(RATING_FLOOR, Math.round(Number(merged.rating)) || START_RATING);
    merged.peak = Math.max(merged.rating, Math.round(Number(merged.peak)) || merged.rating);
    return merged;
  }
  function loadSave(storage, botRatings) {
    try {
      const raw = storage.getItem(SAVE_KEY);
      return migrate(raw ? JSON.parse(raw) : null, botRatings);
    } catch (e) { return migrate(null, botRatings); }
  }
  function persistSave(storage, save) { try { storage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* nevadí */ } }
  // Rozehraná partie z úložiště musí mít platný tvar, jinak by menu nebo Pokračovat spadlo (dřív stačilo moves jako číslo). Vadná se zahodí (null),
  // platná se vrátí jako kopie jen s příslušnými poli. botCount (nepovinný) je počet soupeřů, ať botIdx nemíří mimo seznam.
  const COORD_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
  function cleanGame(g, botCount) {
    if (!g || typeof g !== "object" || Array.isArray(g) || g.v !== 1) return null;
    if (!Array.isArray(g.moves) || g.moves.length > 1000 || !g.moves.every((c) => typeof c === "string" && COORD_RE.test(c))) return null;
    if (g.color !== "w" && g.color !== "b") return null;
    if (!Number.isInteger(g.botIdx) || g.botIdx < 0 || (botCount !== undefined && g.botIdx >= botCount)) return null;
    const num = (v) => typeof v === "number" && isFinite(v) && v >= 0;
    const int = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
    return {
      v: 1, botIdx: g.botIdx, botKey: typeof g.botKey === "string" ? g.botKey : undefined, color: g.color,
      tc: TIME_CONTROLS.some((t) => t.key === g.tc) ? g.tc : "none", moves: g.moves.slice(),
      times: g.times && num(g.times.w) && num(g.times.b) ? { w: g.times.w, b: g.times.b } : null,
      assisted: !!g.assisted, hints: int(g.hints), undos: int(g.undos), startedAt: num(g.startedAt) ? g.startedAt : undefined
    };
  }
  function loadGame(storage, botCount) {
    try { const raw = storage.getItem(GAME_KEY); return raw ? cleanGame(JSON.parse(raw), botCount) : null; } catch (e) { return null; }
  }
  function persistGame(storage, game) {
    try { if (game) storage.setItem(GAME_KEY, JSON.stringify(game)); else storage.removeItem(GAME_KEY); } catch (e) { /* nevadí */ }
  }

  // ---------- Dokončení partie ----------
  // g: { botIdx, botKey, result: win|loss|draw, reason, color, plies, tc, rated, moves, accuracy? }
  // bots: [{ key, rating }]. Vrací nový postup a souhrn pro obrazovku po zápase.
  function finishGame(save, g, bots, today) {
    const s = JSON.parse(JSON.stringify(save));
    const bot = bots[g.botIdx];
    const score = g.result === "win" ? 1 : g.result === "draw" ? 0.5 : 0;
    const rated = !!g.rated;
    const summary = { rated, result: g.result };

    // hodnocení
    summary.ratingBefore = s.rating;
    summary.provisional = s.ratedGames < PROVISIONAL_GAMES;
    if (rated) {
      const ch = ratingChange(s.rating, bot.rating, score, s.ratedGames);
      summary.expected = ch.expected; summary.k = ch.k; summary.delta = ch.delta;
      s.rating += ch.delta;
      s.ratedGames += 1;
      const rec = g.result === "win" ? "w" : g.result === "draw" ? "d" : "l";
      s.record[rec] += 1;
      s.botStats[bot.key][rec] += 1;
      if (g.result === "win") { s.winStreak += 1; if (s.winStreak > s.bestWinStreak) s.bestWinStreak = s.winStreak; }
      else if (g.result === "loss") s.winStreak = 0;
      summary.newPeak = s.rating > s.peak && s.ratedGames > 1;
      if (s.rating > s.peak) s.peak = s.rating;
      s.ratingHistory.push({ r: s.rating, delta: ch.delta, d: today, b: bot.key, res: g.result });
      if (s.ratingHistory.length > HISTORY_CAP) s.ratingHistory.splice(0, s.ratingHistory.length - HISTORY_CAP);
    } else {
      summary.expected = expectedScore(s.rating, bot.rating); summary.delta = 0; summary.newPeak = false;
    }
    summary.ratingAfter = s.rating;
    summary.ratedGamesAfter = s.ratedGames;

    // odemykání dalšího soupeře a výhry
    summary.newlyUnlocked = false;
    if (g.result === "win") {
      s.wins[bot.key] = (s.wins[bot.key] || 0) + 1;
      if (g.botIdx === s.unlockedIndex && g.botIdx < bots.length - 1) { s.unlockedIndex = g.botIdx + 1; summary.newlyUnlocked = true; }
    }

    // historie zápasů
    s.recentGames.unshift({
      botKey: bot.key, result: g.result, reason: g.reason || null, date: today,
      delta: summary.delta, rated, color: g.color, plies: g.plies, tc: g.tc || "none",
      ratingBefore: summary.ratingBefore, oppRating: bot.rating, moves: (g.moves || []).join(" "),
      acc: g.accuracy == null ? null : Math.round(g.accuracy)
    });
    s.recentGames = s.recentGames.slice(0, RECENT_CAP);

    updateStats(s, g, bot, summary, today);

    return { save: s, summary };
  }

  return {
    SAVE_KEY, GAME_KEY, START_RATING, RATING_FLOOR, PROVISIONAL_GAMES, TIME_CONTROLS, CATEGORY_LABELS, BOT_KEYS,
    expectedScore, kFactor, ratingChange, ratingTitle, winPercent, moveAccuracy, classify, summarizeAnalysis,
    defaultSave, migrate, loadSave, persistSave, loadGame, cleanGame, persistGame, finishGame,
    STAT_KEYS, CHEAT_STATS, summarizeMoves, recordAccuracy, recordStats, cheatAllBadges
  };
})();
