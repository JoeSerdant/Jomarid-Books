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
      highlights: true, botChat: true, autoQueen: false,
      recentGames: [],
      rating: START_RATING, peak: START_RATING, ratedGames: 0,
      ratingHistory: [], record: emptyRecord(), botStats,
      winStreak: 0, bestWinStreak: 0
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
  function loadGame(storage) {
    try { const raw = storage.getItem(GAME_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function persistGame(storage, game) {
    try { if (game) storage.setItem(GAME_KEY, JSON.stringify(game)); else storage.removeItem(GAME_KEY); } catch (e) { /* nevadí */ }
  }

  // ---------- Dokončení partie ----------
  // g: { botIdx, botKey, result: win|loss|draw, reason, color, plies, tc, rated, moves, accuracy?, cheated? }
  // Partie s cheat kódem (cheated) je nehodnocená a navíc se nepočítá do výher ani do odemykání dalšího soupeře.
  // bots: [{ key, rating }]. Vrací nový postup a souhrn pro obrazovku po zápase.
  function finishGame(save, g, bots, today) {
    const s = JSON.parse(JSON.stringify(save));
    const bot = bots[g.botIdx];
    const score = g.result === "win" ? 1 : g.result === "draw" ? 0.5 : 0;
    const rated = !!g.rated && !g.cheated; // cheat partie nikdy není hodnocená
    const summary = { rated, result: g.result, cheated: !!g.cheated };

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
    if (g.result === "win" && !g.cheated) {
      s.wins[bot.key] = (s.wins[bot.key] || 0) + 1;
      if (g.botIdx === s.unlockedIndex && g.botIdx < bots.length - 1) { s.unlockedIndex = g.botIdx + 1; summary.newlyUnlocked = true; }
    }

    // historie zápasů
    s.recentGames.unshift({
      botKey: bot.key, result: g.result, reason: g.reason || null, date: today,
      delta: summary.delta, rated, color: g.color, plies: g.plies, tc: g.tc || "none", ...(g.cheated ? { cheat: true } : {}),
      ratingBefore: summary.ratingBefore, oppRating: bot.rating, moves: (g.moves || []).join(" "),
      acc: g.accuracy == null ? null : Math.round(g.accuracy)
    });
    s.recentGames = s.recentGames.slice(0, RECENT_CAP);

    return { save: s, summary };
  }

  return {
    SAVE_KEY, GAME_KEY, START_RATING, RATING_FLOOR, PROVISIONAL_GAMES, TIME_CONTROLS, CATEGORY_LABELS, BOT_KEYS,
    expectedScore, kFactor, ratingChange, ratingTitle, winPercent, moveAccuracy, classify, summarizeAnalysis,
    defaultSave, migrate, loadSave, persistSave, loadGame, persistGame, finishGame
  };
})();
