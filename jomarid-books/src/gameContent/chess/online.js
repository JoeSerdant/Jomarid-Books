/* online.js - online partie proti živému soupeři (multiplayer). Stejná šachovnice a stejná pravidla jako proti botům, jen soupeř táhne přes server:
   tahy a hodiny řídí server (appka v okně rodiče, rozhraní window.jomaridMP), pravidla hlídá tahle hra u obou hráčů. Server hlídá pořadí
   tahů a čas, o výsledku rozhodnou hlášení obou hráčů a o odměně server sám.

   Podtřída GameSession, ale bez bota, nápovědy, vracení tahů a nabídky remízy; hodiny se berou ze serveru. Bez DOM, takže ji jde zkoušet v Node
   s falešným rozhraním zápasu (net): { init, on(událost, fn), listen(), move(payload), report(výsledek, důvod), resign(), close(), serverNow() }. */
const NO_AI = { search: async () => ({}), evalPos: async () => ({}), analyze: async () => ({}), newGame() {}, cancel() {}, destroy() {} };

class OnlineSession extends GameSession {
  // opts: { net, now, timers }
  constructor(opts) {
    const net = opts.net;
    const init = net.init || {};
    const color = init.slot === 2 ? "b" : "w";
    const name = (init.opponent && init.opponent.name) || "Soupeř";
    const opponent = { key: "online", name, emoji: "🧑", colorSoft: "var(--gold-soft)", stars: 0, rating: null, fem: false, params: {}, book: null, think: { base: 0, spread: 0, min: 0, max: 0 }, resign: null, drawMargin: 0 };
    super({ bot: opponent, botIdx: -1, playerColor: color, tcKey: "none", ai: NO_AI, now: opts.now, timers: opts.timers, chat: false });
    this.online = true;
    this.net = net;
    this.init = init;
    this.synced = false; // historie tahů ze serveru je načtená
    this.waitingForServer = false; // lokálně skončeno, čeká se na potvrzení výsledku od serveru
    this.lastError = null;
    this._sendChain = Promise.resolve(); // tahy a hlášení jdou na server po jednom v pořadí
    this._replaying = false;
    this._fromServer = false;
    this._started = false;
    // Hodiny z nastavení zápasu (tc "5+3"); přesné hodnoty a běžící strana se pak berou z odpovědí serveru.
    const tc = String((init.params && init.params.tc) || "").split("+").map(Number);
    if (tc.length === 2 && tc[0] > 0) this.clock = { on: true, base: tc[0] * 60000, inc: tc[1] * 1000, w: tc[0] * 60000, b: tc[0] * 60000, running: null, since: 0 };
    this.tcKey = "online";
  }

  // ---------- Co online partie nemá ----------
  get rated() { return false; }
  get canUndo() { return false; }
  requestHint() { return Promise.resolve(null); }
  undo() { return false; }
  offerDraw() { return Promise.resolve({ verdict: "blocked" }); }
  cheatWin() { return false; }
  cheatDraw() { return false; }
  setBlindBot() { return false; }
  setAutopilot() { return false; }
  cheatScare() {}
  _botTurn() {}
  _autopilotSoon() {}
  serialize() { return null; }
  restore() { return this; }
  // O konci času rozhoduje server (vidí oba hráče a jeho hodiny jsou jediné platné): nikdy se tu nekončí lokálně.
  tick() { return false; }
  get isPlayerTurn() { return !this.over && this.synced && this.turn === this.playerColor; }

  // ---------- Průběh ----------
  start() {
    if (this._started) { this._changed(); return; }
    this._started = true;
    const net = this.net;
    net.on("sync", (d) => this._onSync(d));
    net.on("moves", (d) => this._onMoves(d.moves || []));
    net.on("match", (d) => this._onMatch(d.match));
    net.on("end", (d) => this._onEnd(d));
    this._changed();
    net.listen();
  }

  // Historie tahů ze serveru (po načtení hry i po obnovení stránky): přehraje se bez událostí a zvuků.
  _onSync(d) {
    if (this.synced) return;
    this._replaying = true;
    for (const rec of d.moves || []) if (!this._takeRemote(rec)) break;
    this._replaying = false;
    this.synced = true;
    // Historie mohla skončit matem nebo patem, i když to server ještě nezná (stránka se obnovila dřív než hlášení).
    if (this.moves.length) this._evaluateEnd(this.state, ChessEngine.positionKey(this.state));
    this._onMatch(d.match);
    if (d.match && d.match.status !== "active") this._onEnd({ match: d.match, outcome: d.outcome });
    this._changed();
  }

  _onMoves(list) {
    if (!this.synced) return; // před historií se živé tahy nezpracují: přijdou znovu v ní
    for (const rec of list) {
      if (rec.seq <= this.moves.length) continue; // vlastní nebo už přehraný tah
      if (!this._takeRemote(rec)) return;
    }
  }

  // Tah ze serveru: payload.c je tah jako souřadnice ("e2e4", "e7e8q"). Hráč na tahu podle čísla tahu musí být ten, kdo ho poslal.
  _takeRemote(rec) {
    if (rec.seq !== this.moves.length + 1) return false;
    const coord = rec.payload && rec.payload.c;
    const move = typeof coord === "string" ? findMoveByCoord(this.state, coord) : null;
    const expectedSlot = this.state.turn === "w" ? 1 : 2;
    if (!move || rec.p !== expectedSlot) { this._problem("Tah ze serveru neodpovídá pravidlům, partie se nedá dál sledovat."); return false; }
    if (this._replaying) this._replayMove(move);
    else this._apply(move, true, null);
    return true;
  }

  _replayMove(move) {
    const before = this.state;
    const all = ChessEngine.generateAllLegalMoves(before, before.turn);
    const after = ChessEngine.applyMove(before, move);
    const san = toSAN(move, all, after);
    this.states.push(after);
    this.moves.push({ coord: moveToCoord(move), san, color: move.piece.color, capture: move.flag === "ep" ? "p" : move.captured ? move.captured.type : null, flag: move.flag || null, promotion: move.promotion || null, check: /[+#]$/.test(san) });
    this._countPosition(after);
  }

  // Tah hráče: pravidla ověří GameSession, tah se pak pošle serveru (opakování po výpadku řeší appka).
  _apply(move, byBot, info) {
    // Tah jde na server dřív než případné hlášení konce partie (mat), které přijde uvnitř super._apply.
    if (!byBot && !this._replaying) this._sendMove(move);
    super._apply(move, byBot, info);
  }

  _sendMove(move) {
    const payload = { c: moveToCoord(move) };
    this._enqueue(() => this.net.move(payload));
  }

  _enqueue(job) {
    const run = this._sendChain.then(job);
    this._sendChain = run.catch((err) => {
      if (err && err.code === "timeout") { this._problem("Vypršel ti čas."); return; }
      this._problem("Tah se nepodařilo odeslat. Zkontroluj připojení.");
    });
    return run;
  }

  _problem(text) {
    this.lastError = text;
    this.onEvent("problem", { text });
    this._changed();
  }

  // ---------- Hodiny ze serveru ----------
  _onMatch(view) {
    if (!view) return;
    this.view = view;
    const c = this.clock;
    if (!c.on || !Array.isArray(view.bank)) return;
    const offset = this.net.serverNow() - Date.now();
    c.w = Math.max(0, view.bank[0] * 1000);
    c.b = Math.max(0, view.bank[1] * 1000);
    if (view.status === "active" && view.turn && (view.move_count || 0) >= 1 && view.turn_started != null) {
      c.running = view.turn === 1 ? "w" : "b";
      c.since = view.turn_started - offset;
    } else {
      c.running = null;
    }
    this._changed();
  }

  // ---------- Konec ----------
  // Lokální konec (mat, pat, opakování, vzdání) se ohlásí serveru; rozhodne shoda obou hlášení. Konec od serveru (čas, vzdání soupeře,
  // zrušení) se jen převezme.
  _finish(result, reason) {
    if (this.result) return;
    super._finish(result, reason);
    if (this._fromServer) return;
    this.waitingForServer = true;
    this._enqueue(() => (reason === "resign" && result === "loss" ? this.net.resign() : this.net.report(result, reason)));
  }

  _onEnd(d) {
    const view = d.match || {};
    this.waitingForServer = false;
    if (this.result) { this._changed(); return; }
    const outcome = d.outcome || (view.status === "void" ? "void" : view.winner === 0 ? "draw" : view.winner === view.slot ? "win" : "loss");
    const reason = view.reason === "agreed" ? "agreement" : (view.reason || "");
    this._fromServer = true;
    this._finish(outcome === "void" ? "draw" : outcome, reason);
    this._fromServer = false;
  }
}
