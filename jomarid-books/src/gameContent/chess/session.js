/* session.js - řadič jedné partie (bez DOM, takže ho jde testovat v Node).
   Drží stav partie, hodiny, tah bota (kniha -> hledání -> "lidské" tempo), nápovědu, vrácení tahu,
   nabídku remízy, vzdání a uložení rozehrané partie. Rozhraní se jen přihlásí k odběru změn.

   Závislosti se předávají zvenku: ai (worker nebo přímo FastChess), now(), timers, rng(). */
const HINT_PARAMS = { depth: 6, nodes: 150000, timeMs: 1500, qd: 8, evalLevel: 2, margin: 0, temperature: 0, blunder: 0, ttBits: 17, key: "hint" };
const DRAW_CHECK_PARAMS = { depth: 4, nodes: 40000, timeMs: 700, qd: 8, evalLevel: 2, ttBits: 17, key: "hint" };

class GameSession {
  // opts: { bot, botIdx, playerColor, tcKey, ai, now, timers, rng, delayScale, chat, onChange, onEvent }
  constructor(opts) {
    this.bot = opts.bot;
    this.botIdx = opts.botIdx;
    this.playerColor = opts.playerColor;
    this.botColor = opts.playerColor === "w" ? "b" : "w";
    this.tcKey = opts.tcKey || "none";
    this.ai = opts.ai;
    this.now = opts.now || (() => Date.now());
    this.timers = opts.timers || { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };
    this.rng = opts.rng || Math.random;
    this.delayScale = opts.delayScale != null ? opts.delayScale : 1;
    this.chat = opts.chat !== false;
    this.onChange = opts.onChange || (() => {});
    this.onEvent = opts.onEvent || (() => {});
    this.onPersist = opts.onPersist || null; // volá se při každé změně; rozhraní si tu ukládá rozehranou partii

    this.states = [ChessEngine.initialState()];
    this.moves = []; // { coord, san, color, capture, flag, promotion, check }
    this.counts = {};
    this._countPosition(this.states[0]);
    this.result = null; // { result: win|loss|draw (z pohledu hráče), reason }
    this.thinking = false;
    this.hint = null;
    this.assisted = false;
    this.hintsUsed = 0;
    this.undosUsed = 0;
    this.drawBlockedUntil = 0;
    this.botScores = [];
    this.lastBotEval = null;
    this._said = { winning: false, losing: false };
    this._lastSayAt = -1e9;
    this._token = 0;
    this._timer = null;
    this.startedAt = this.now();

    const tc = League.TIME_CONTROLS.find((t) => t.key === this.tcKey) || League.TIME_CONTROLS[0];
    this.clock = tc.base > 0
      ? { on: true, base: tc.base * 1000, inc: tc.inc * 1000, w: tc.base * 1000, b: tc.base * 1000, running: null, since: 0 }
      : { on: false };
  }

  // ---------- Dotazy ----------
  get state() { return this.states[this.states.length - 1]; }
  get turn() { return this.state.turn; }
  get over() { return !!this.result; }
  get ply() { return this.moves.length; }
  get isPlayerTurn() { return !this.over && this.turn === this.playerColor; }
  get rated() { return !this.assisted; }
  get canUndo() {
    return !this.over && !this.thinking && this.turn === this.playerColor && this.moves.length >= (this.playerColor === "w" ? 2 : 3);
  }
  coords() { return this.moves.map((m) => m.coord); }
  opening() { return OpeningBook.nameFor(this.moves.map((m) => plainSAN(m.san))); }
  legalFrom(r, c) { return ChessEngine.generateLegalMoves(this.state, r, c); }
  captured() { return computeCaptured(this.state); }

  // Zbývající čas obou stran (včetně právě běžícího úseku).
  liveTimes() {
    const c = this.clock;
    if (!c.on) return null;
    const t = { w: c.w, b: c.b };
    if (c.running && !this.over) t[c.running] = Math.max(0, t[c.running] - (this.now() - c.since));
    return t;
  }

  // ---------- Průběh ----------
  start() {
    if (this.moves.length === 0) this._say("start", 1); // při pokračování rozehrané partie se nezdraví znovu
    this._changed();
    if (!this.over && this.turn === this.botColor) this._botTurn();
  }

  // Tah hráče (objekt tahu z ChessEngine, u proměny už s vybranou figurou).
  playerMove(move) {
    if (!this.isPlayerTurn || this.thinking) return false;
    const legal = ChessEngine.generateLegalMoves(this.state, move.from.r, move.from.c);
    const ok = legal.find((m) => m.to.r === move.to.r && m.to.c === move.to.c && (m.promotion || null) === (move.promotion || null));
    if (!ok) return false;
    this._apply(ok, false, null);
    return true;
  }

  _apply(move, byBot, info) {
    const before = this.state;
    const all = ChessEngine.generateAllLegalMoves(before, before.turn);
    const after = ChessEngine.applyMove(before, move);
    const san = toSAN(move, all, after);
    const mover = move.piece.color;
    this._clockAfterMove(mover);
    const capture = move.flag === "ep" ? "p" : move.captured ? move.captured.type : null;
    const rec = { coord: moveToCoord(move), san, color: mover, capture, flag: move.flag || null, promotion: move.promotion || null, check: /[+#]$/.test(san) };
    this.states.push(after);
    this.moves.push(rec);
    this.hint = null;
    const key = ChessEngine.positionKey(after);
    this.counts[key] = (this.counts[key] || 0) + 1;
    this.onEvent("move", { move, san, byBot, rec, state: after, info });

    const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    if (byBot) {
      if (capture && VAL[capture] >= 3) this._say("capture", 0.5);
      else if (rec.check) this._say("check", 0.4);
    } else {
      if (capture && VAL[capture] >= 3) this._say("lostPiece", 0.5);
      else if (rec.check) this._say("inCheck", 0.4);
    }
    if (!this._evaluateEnd(after, key)) {
      this._clockResume();
      if (after.turn === this.botColor) this._botTurn();
    }
    this._changed();
  }

  _countPosition(state) {
    const k = ChessEngine.positionKey(state);
    this.counts[k] = (this.counts[k] || 0) + 1;
  }

  _evaluateEnd(state, key) {
    let result = null, reason = null;
    if (ChessEngine.isCheckmate(state)) {
      result = ChessEngine.opponent(state.turn) === this.playerColor ? "win" : "loss";
      reason = "checkmate";
    } else if (ChessEngine.isStalemate(state)) { result = "draw"; reason = "stalemate"; }
    else if (ChessEngine.insufficientMaterial(state)) { result = "draw"; reason = "insufficient"; }
    else if (state.halfmoveClock >= 100) { result = "draw"; reason = "fiftymove"; }
    else if (this.counts[key] >= 3) { result = "draw"; reason = "repetition"; }
    if (!result) return false;
    this._finish(result, reason);
    return true;
  }

  _finish(result, reason) {
    if (this.result) return;
    // hodiny se zastaví v okamžiku konce
    const live = this.liveTimes();
    if (live) { this.clock.w = live.w; this.clock.b = live.b; this.clock.running = null; }
    this.result = { result, reason };
    this._token++;
    this.thinking = false;
    this.hint = null;
    if (this._timer) { this.timers.clearTimeout(this._timer); this._timer = null; }
    this.ai.cancel && this.ai.cancel();
    const kind = result === "win" ? "loss" : result === "loss" ? "win" : "draw"; // hláška bota = jeho pohled
    if (reason !== "botresign") this._say(kind, 1, true);
    this.onEvent("gameover", { result, reason });
    this._changed();
  }

  resign() {
    if (this.over) return;
    this._finish("loss", "resign");
  }

  // ---------- Hodiny ----------
  _clockAfterMove(mover) {
    const c = this.clock;
    if (!c.on) return;
    const t = this.now();
    if (c.running === mover) {
      c[mover] = Math.max(0, c[mover] - (t - c.since)) + c.inc;
    }
    // hodiny se rozběhnou až po prvních dvou půltazích (první tah každé strany je zdarma)
    c.running = this.moves.length >= 1 ? ChessEngine.opponent(mover) : null;
    c.since = t;
  }
  _clockResume() {
    const c = this.clock;
    if (!c.on) return;
    c.since = this.now();
  }
  // Volá rozhraní pravidelně; když dojde čas, partie končí.
  tick() {
    const c = this.clock;
    if (!c.on || this.over || !c.running) return false;
    const t = this.liveTimes();
    if (t[c.running] > 0) return false;
    const loser = c.running; // ten, komu čas došel
    const winner = ChessEngine.opponent(loser);
    c[loser] = 0;
    const winnerCanMate = this._canMate(this.state, winner);
    if (!winnerCanMate) this._finish("draw", "timeout-material");
    else this._finish(loser === this.playerColor ? "loss" : "win", "timeout");
    return true;
  }
  // Může daná strana ještě matovat? (samotný král nebo král + jedna lehká figura nemůže)
  _canMate(state, color) {
    let minors = 0;
    for (const row of state.board) for (const p of row) {
      if (!p || p.color !== color || p.type === "k") continue;
      if (p.type === "p" || p.type === "r" || p.type === "q") return true;
      minors++;
    }
    return minors >= 2;
  }

  // ---------- Bot ----------
  _botParams() {
    const p = Object.assign({}, this.bot.params);
    const t = this.liveTimes();
    if (t) {
      const mine = t[this.botColor];
      if (mine < 20000) { p.timeMs = Math.min(p.timeMs, Math.max(150, mine / 25)); p.depth = Math.max(2, p.depth - 1); }
      if (mine < 7000) { p.depth = Math.max(2, p.depth - 1); p.nodes = Math.min(p.nodes, 40000); }
    }
    return p;
  }

  async _botTurn() {
    if (this.over || this.thinking) return;
    this.thinking = true;
    const token = ++this._token;
    const t0 = this.now();
    this._changed();
    const state = this.state;
    const bot = this.bot;
    const played = this.moves.map((m) => plainSAN(m.san));
    let move = null;
    const info = { book: false, forced: false, legal: 0, recapture: false, inCheck: ChessEngine.isInCheck(state, state.turn), ply: this.moves.length };

    // 1) kniha zahájení
    if (bot.book) {
      let san = null;
      if (played.length === 0 && bot.book.odd && this.rng() < bot.book.odd.chance) {
        san = bot.book.odd.moves[Math.floor(this.rng() * bot.book.odd.moves.length)];
      } else {
        san = OpeningBook.pickMove(played, { tags: bot.book.tags, maxPly: bot.book.maxPly }, this.rng);
      }
      if (san) { move = findMoveBySAN(state, san); if (move) info.book = true; }
    }

    // 2) hledání
    let res = null;
    if (!move) {
      try {
        res = await this.ai.search({ moves: this.coords(), params: this._botParams(), seed: Math.floor(this.rng() * 1e9) });
      } catch (e) { res = { error: String(e && e.message || e) }; }
      if (token !== this._token || this.over) return;
      if (res && res.best) move = findMoveByCoord(state, res.best);
      if (!move) { // záchrana: nikdy nenecháme partii zaseknout
        const legal = ChessEngine.generateAllLegalMoves(state, state.turn);
        move = legal[Math.floor(this.rng() * legal.length)];
      }
      info.legal = res.legal || 0;
      info.forced = !!res.forced;
      info.score = res.score;
      info.bestScore = res.bestScore;
      info.depth = res.depth;
      const last = this.moves[this.moves.length - 1];
      info.recapture = !!(last && last.capture && move && move.captured && last.coord.slice(2, 4) === moveToCoord(move).slice(2, 4));
    } else {
      info.legal = ChessEngine.generateAllLegalMoves(state, state.turn).length;
    }
    if (token !== this._token || this.over) return;

    // 3) vyhodnocení situace -> hlášky, vzdání
    if (res && res.bestScore != null && !info.forced) {
      const sc = res.bestScore;
      if (this.lastBotEval != null && sc - this.lastBotEval >= 250 && this.moves.length >= 4) this._say("blunder", 0.7);
      if (sc >= 450 && !this._said.winning) { this._said.winning = true; this._say("winning", 0.8); }
      if (sc <= -450 && !this._said.losing) { this._said.losing = true; this._say("losing", 0.8); }
      this.botScores.push(sc);
      this.lastBotEval = res.score;
      if (Bots.shouldResign(bot, this.botScores, Math.ceil(this.moves.length / 2))) {
        const wait = Math.max(0, Bots.thinkDelay(bot, info, this.rng, null) * this.delayScale - (this.now() - t0));
        this._timer = this.timers.setTimeout(() => {
          this._timer = null;
          if (token !== this._token || this.over) return;
          this._say("resign", 1, true);
          this._finish("win", "botresign");
        }, wait);
        return;
      }
    }

    // 4) lidské tempo
    const t = this.liveTimes();
    const delay = Bots.thinkDelay(bot, info, this.rng, t ? t[this.botColor] : null) * this.delayScale;
    const wait = Math.max(0, delay - (this.now() - t0));
    this._timer = this.timers.setTimeout(() => {
      this._timer = null;
      if (token !== this._token || this.over) return;
      this.thinking = false;
      this._apply(move, true, info);
    }, wait);
  }

  // ---------- Pomoc a nabídky ----------
  async requestHint() {
    if (!this.isPlayerTurn || this.thinking) return null;
    if (!this.assisted) this._say("hint", 0.6);
    this.assisted = true;
    this.hintsUsed++;
    const token = this._token;
    this._changed();
    let res;
    try { res = await this.ai.search({ moves: this.coords(), params: HINT_PARAMS, seed: 7 }); } catch (e) { return null; }
    if (token !== this._token || this.over || !res || !res.best) return null;
    const m = findMoveByCoord(this.state, res.best);
    if (!m) return null;
    this.hint = { from: m.from, to: m.to, coord: res.best };
    this._changed();
    return this.hint;
  }

  undo() {
    if (!this.canUndo) return false;
    if (!this.assisted) this._say("undo", 0.6);
    this.assisted = true;
    this.undosUsed++;
    this.states.length -= 2;
    this.moves.length -= 2;
    this.counts = {};
    for (const s of this.states) this._countPosition(s);
    this.botScores.pop();
    this.hint = null;
    this._changed();
    return true;
  }

  // Vrací { verdict: accept|decline|early|blocked }.
  async offerDraw() {
    if (!this.isPlayerTurn || this.thinking) return { verdict: "blocked" };
    if (this.moves.length < this.drawBlockedUntil) return { verdict: "blocked" };
    const token = this._token;
    let score = 0;
    try {
      const res = await this.ai.evalPos({ moves: this.coords(), params: DRAW_CHECK_PARAMS });
      if (res && res.score != null) score = -res.score; // z pohledu bota
    } catch (e) { /* bez analýzy se rozhodne podle remízového prahu */ }
    if (token !== this._token || this.over) return { verdict: "blocked" };
    const verdict = Bots.drawDecision(this.bot, score, Math.ceil(this.moves.length / 2), this.rng);
    if (verdict === "accept") {
      this._say("drawAccept", 1, true);
      this._finish("draw", "agreement");
    } else {
      this.drawBlockedUntil = this.moves.length + 8;
      this._say(verdict === "early" ? "drawEarly" : "drawDecline", 1, true);
    }
    this._changed();
    return { verdict };
  }

  // ---------- Hlášky bota ----------
  _say(kind, prob, force) {
    if (!this.chat) return;
    const t = this.now();
    if (!force && t - this._lastSayAt < 4500) return;
    if (this.rng() >= prob) return;
    const text = Bots.talkLine(this.bot.key, kind, this.rng);
    if (!text) return;
    this._lastSayAt = t;
    this.onEvent("say", { text, kind });
  }

  // ---------- Uložení a obnovení ----------
  serialize() {
    const t = this.liveTimes();
    return {
      v: 1, botIdx: this.botIdx, botKey: this.bot.key, color: this.playerColor, tc: this.tcKey,
      moves: this.coords(), times: t ? { w: Math.round(t.w), b: Math.round(t.b) } : null,
      assisted: this.assisted, hints: this.hintsUsed, undos: this.undosUsed, startedAt: this.startedAt
    };
  }

  // Přehraje uloženou partii bez událostí; hodiny se obnoví na uložené hodnoty.
  restore(saved) {
    for (const coord of saved.moves || []) {
      const move = findMoveByCoord(this.state, coord);
      if (!move) break;
      const before = this.state;
      const all = ChessEngine.generateAllLegalMoves(before, before.turn);
      const after = ChessEngine.applyMove(before, move);
      const san = toSAN(move, all, after);
      this.states.push(after);
      this.moves.push({ coord, san, color: move.piece.color, capture: move.flag === "ep" ? "p" : move.captured ? move.captured.type : null, flag: move.flag || null, promotion: move.promotion || null, check: /[+#]$/.test(san) });
      this._countPosition(after);
    }
    this.assisted = !!saved.assisted;
    this.hintsUsed = saved.hints || 0;
    this.undosUsed = saved.undos || 0;
    this.startedAt = saved.startedAt || this.startedAt;
    if (this.clock.on && saved.times) {
      this.clock.w = saved.times.w; this.clock.b = saved.times.b;
      this.clock.running = this.moves.length >= 2 ? this.turn : null;
      this.clock.since = this.now();
    }
    // bot už mohl partii vyhrát/prohrát tím, co bylo uloženo
    const k = ChessEngine.positionKey(this.state);
    this._evaluateEnd(this.state, k);
    return this;
  }

  destroy() {
    this._token++;
    this.thinking = false;
    if (this._timer) { this.timers.clearTimeout(this._timer); this._timer = null; }
    this.ai.cancel && this.ai.cancel();
  }

  _changed() {
    this.onChange(this);
    if (this.onPersist) this.onPersist(this);
  }
}
