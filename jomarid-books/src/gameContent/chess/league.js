/* league.js - hodnocení (Elo), XP, ligy, denní výzvy a uložený postup. Čistá logika bez DOM,
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

  // ---------- XP, ligy ----------
  const LEAGUE_TIERS = [
    { name: "Bronzová liga", icon: "🥉", min: 0 },
    { name: "Stříbrná liga", icon: "🥈", min: 120 },
    { name: "Zlatá liga", icon: "🥇", min: 300 },
    { name: "Safírová liga", icon: "💠", min: 600 },
    { name: "Diamantová liga", icon: "💎", min: 1000 }
  ];
  function getLeagueInfo(xp) {
    let idx = 0;
    for (let i = 0; i < LEAGUE_TIERS.length; i++) if (xp >= LEAGUE_TIERS[i].min) idx = i;
    const current = LEAGUE_TIERS[idx];
    const next = LEAGUE_TIERS[idx + 1] || null;
    const progress = next ? Math.max(0, Math.min(1, (xp - current.min) / (next.min - current.min))) : 1;
    return { idx, current, next, progress };
  }
  function computeXp(botIndex, result) {
    const base = 10;
    if (result === "win") return base + 15 + botIndex * 10;
    if (result === "draw") return base + 8 + botIndex * 4;
    return base;
  }

  // ---------- Denní výzvy (nově za splnění dostaneš XP) ----------
  const SPECIAL_QUESTS = [
    { key: "sp_black", icon: "♟️", label: "Vyhraj dnes za černé", target: 1, reward: 20, count: (g) => g.filter((x) => x.result === "win" && x.color === "b" && x.rated).length },
    { key: "sp_three", icon: "🎲", label: "Odehraj dnes 3 zápasy", target: 3, reward: 15, count: (g) => g.length },
    { key: "sp_quick", icon: "⚡", label: "Vyhraj dnes do 30 tahů", target: 1, reward: 20, count: (g) => g.filter((x) => x.result === "win" && x.rated && Math.ceil(x.plies / 2) <= 30).length },
    { key: "sp_clock", icon: "⏱️", label: "Vyhraj dnes zápas na hodiny", target: 1, reward: 20, count: (g) => g.filter((x) => x.result === "win" && x.rated && x.tc && x.tc !== "none").length },
    { key: "sp_upset", icon: "🔥", label: "Poraz soupeře s vyšším ratingem", target: 1, reward: 25, count: (g) => g.filter((x) => x.result === "win" && x.rated && x.oppRating > x.ratingBefore).length }
  ];
  function dayHash(dateStr) {
    let h = 0;
    for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) >>> 0;
    return h;
  }
  function getDailyQuests(save, today) {
    const todays = (save.recentGames || []).filter((g) => g.date === today);
    const winsToday = todays.filter((g) => g.result === "win").length;
    const xpToday = todays.reduce((sum, g) => sum + (g.xpGained || 0), 0);
    const special = SPECIAL_QUESTS[dayHash(today) % SPECIAL_QUESTS.length];
    const claimed = save.questClaims && save.questClaims.date === today ? save.questClaims.keys : [];
    const list = [
      { key: "play", icon: "♟️", label: "Odehraj dnes zápas", current: Math.min(todays.length, 1), target: 1, reward: 5 },
      { key: "win", icon: "🎯", label: "Vyhraj dnes zápas", current: Math.min(winsToday, 1), target: 1, reward: 10 },
      { key: "xp", icon: "⚡", label: "Získej dnes 20 XP", current: Math.min(xpToday, 20), target: 20, reward: 15 },
      { key: special.key, icon: special.icon, label: special.label, current: Math.min(special.count(todays), special.target), target: special.target, reward: special.reward, special: true }
    ];
    return list.map((q) => ({ ...q, done: q.current >= q.target, claimed: claimed.includes(q.key) }));
  }

  // ---------- Odznaky (odvozené z postupu, nic dalšího se neukládá) ----------
  const BADGES = [
    { key: "first_win", icon: "🥇", name: "První výhra", hint: "Vyhraj zápas.", test: (s) => s.record.w > 0 || BOT_KEYS.some((k) => s.wins[k] > 0) },
    { key: "calibrated", icon: "🎯", name: "Kalibrace hotová", hint: "Odehraj " + PROVISIONAL_GAMES + " hodnocených zápasů.", test: (s) => s.ratedGames >= PROVISIONAL_GAMES },
    { key: "streak3", icon: "🔥", name: "Série 3 výher", hint: "Vyhraj 3 hodnocené zápasy v řadě.", test: (s) => s.bestWinStreak >= 3 },
    { key: "streak5", icon: "⚔️", name: "Série 5 výher", hint: "Vyhraj 5 hodnocených zápasů v řadě.", test: (s) => s.bestWinStreak >= 5 },
    { key: "r1000", icon: "📈", name: "Rating 1000", hint: "Dosáhni ratingu 1000.", test: (s) => s.peak >= 1000 },
    { key: "r1300", icon: "🚀", name: "Rating 1300", hint: "Dosáhni ratingu 1300.", test: (s) => s.peak >= 1300 },
    { key: "r1600", icon: "🏆", name: "Rating 1600", hint: "Dosáhni ratingu 1600.", test: (s) => s.peak >= 1600 },
    { key: "fox", icon: "🦊", name: "Přelstil jsi lišku", hint: "Poraz Fenwicka.", test: (s) => s.wins.medium > 0 },
    { key: "owl", icon: "🦉", name: "Moudřejší než sova", hint: "Poraz Profesora Hůůů.", test: (s) => s.wins.hard > 0 },
    { key: "dragon", icon: "🐉", name: "Přemožitel draka", hint: "Poraz Draka.", test: (s) => s.wins.expert > 0 },
    { key: "gold", icon: "🥇", name: "Zlatá liga", hint: "Získej 300 XP.", test: (s) => s.xp >= 300 },
    { key: "diamond", icon: "💎", name: "Diamantová liga", hint: "Získej 1000 XP.", test: (s) => s.xp >= 1000 }
  ];
  function getBadges(save) {
    return BADGES.map((b) => ({ key: b.key, icon: b.icon, name: b.name, hint: b.hint, earned: !!b.test(save) }));
  }

  // ---------- Uložený postup ----------
  function emptyRecord() { return { w: 0, d: 0, l: 0 }; }
  const BOT_KEYS = ["beginner", "easy", "medium", "hard", "expert"];
  function defaultSave() {
    const botStats = {};
    BOT_KEYS.forEach((k) => { botStats[k] = emptyRecord(); });
    return {
      v: SAVE_VERSION,
      xp: 0, streak: 0, lastPlayedDate: null, unlockedIndex: 0,
      wins: { beginner: 0, easy: 0, medium: 0, hard: 0, expert: 0 },
      sound: true, theme: "dark", playerColor: "w", tc: "none",
      highlights: true, botChat: true, autoQueen: false,
      recentGames: [],
      rating: START_RATING, peak: START_RATING, ratedGames: 0,
      ratingHistory: [], record: emptyRecord(), botStats,
      winStreak: 0, bestWinStreak: 0,
      questClaims: { date: null, keys: [] }
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
    merged.questClaims = raw.questClaims && Array.isArray(raw.questClaims.keys) ? raw.questClaims : base.questClaims;
    if (!raw.v || raw.v < 2) {
      merged.rating = seedRating(raw, botRatings || []);
      merged.peak = merged.rating;
      merged.ratedGames = 0;
      merged.ratingHistory = [];
      if (merged.theme === "system" || merged.theme === "light") merged.theme = "dark";
    }
    merged.v = SAVE_VERSION;
    if (!Array.isArray(merged.recentGames)) merged.recentGames = [];
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
  // g: { botIdx, botKey, result: win|loss|draw, reason, color, plies, tc, rated, moves, accuracy? }
  // bots: [{ key, rating }]. Vrací nový postup a souhrn pro obrazovku po zápase.
  function finishGame(save, g, bots, today, yesterday) {
    const s = JSON.parse(JSON.stringify(save));
    const bot = bots[g.botIdx];
    const score = g.result === "win" ? 1 : g.result === "draw" ? 0.5 : 0;
    const xpBefore = s.xp;
    const summary = { rated: !!g.rated, result: g.result };

    // hodnocení
    summary.ratingBefore = s.rating;
    summary.provisional = s.ratedGames < PROVISIONAL_GAMES;
    if (g.rated) {
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

    // XP (cvičná partie dává polovinu)
    const xpBase = Math.round(computeXp(g.botIdx, g.result) * (g.rated ? 1 : 0.5));
    summary.xpBase = xpBase;

    // série dní
    if (s.lastPlayedDate === today) { /* dnes už hrál */ }
    else if (s.lastPlayedDate === yesterday) s.streak += 1;
    else s.streak = 1;
    s.lastPlayedDate = today;

    // odemykání dalšího soupeře a výhry
    summary.newlyUnlocked = false;
    if (g.result === "win") {
      s.wins[bot.key] = (s.wins[bot.key] || 0) + 1;
      if (g.botIdx === s.unlockedIndex && g.botIdx < bots.length - 1) { s.unlockedIndex = g.botIdx + 1; summary.newlyUnlocked = true; }
    }

    // historie zápasů
    s.recentGames.unshift({
      botKey: bot.key, result: g.result, reason: g.reason || null, date: today, xpGained: xpBase,
      delta: summary.delta, rated: !!g.rated, color: g.color, plies: g.plies, tc: g.tc || "none",
      ratingBefore: summary.ratingBefore, oppRating: bot.rating, moves: (g.moves || []).join(" "),
      acc: g.accuracy == null ? null : Math.round(g.accuracy)
    });
    s.recentGames = s.recentGames.slice(0, RECENT_CAP);

    // výzvy: za nově splněné dostane hráč XP navíc (jednou denně za každou)
    if (!s.questClaims || s.questClaims.date !== today) s.questClaims = { date: today, keys: [] };
    const bonus = [];
    for (const q of getDailyQuests(s, today)) {
      if (q.done && !s.questClaims.keys.includes(q.key)) {
        s.questClaims.keys.push(q.key);
        bonus.push({ key: q.key, label: q.label, icon: q.icon, reward: q.reward });
      }
    }
    // výzva "Získej 20 XP" se počítá z xpGained té hry, takže po přičtení bonusů ji nezvyšujeme znovu
    const questXp = bonus.reduce((sum, b) => sum + b.reward, 0);
    summary.questBonus = bonus;
    summary.xpGained = xpBase + questXp;
    s.xp += summary.xpGained;
    summary.streak = s.streak;
    const tierBefore = getLeagueInfo(xpBefore), tierAfter = getLeagueInfo(s.xp);
    summary.tierBefore = tierBefore.current; summary.tierAfter = tierAfter.current;
    summary.promoted = tierAfter.idx > tierBefore.idx;
    return { save: s, summary };
  }

  return {
    SAVE_KEY, GAME_KEY, START_RATING, RATING_FLOOR, PROVISIONAL_GAMES, TIME_CONTROLS, LEAGUE_TIERS, CATEGORY_LABELS, BOT_KEYS,
    expectedScore, kFactor, ratingChange, ratingTitle, winPercent, moveAccuracy, classify, summarizeAnalysis,
    getLeagueInfo, computeXp, getDailyQuests, getBadges, defaultSave, migrate, loadSave, persistSave, loadGame, persistGame, finishGame
  };
})();
