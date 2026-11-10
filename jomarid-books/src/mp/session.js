// Řadič jednoho online zápasu na straně appky (bez DOM a bez Reactu, takže ho jde zkoušet v Node s falešným serverem).
// Drží poslední pohled serveru na zápas, ptá se serveru na nové tahy (mp_state, zároveň „jsem tu“), posílá tahy po jednom v pořadí
// (opakování po výpadku spojení je bezpečné: server stejný tah přijme jen jednou), hlásí výsledek a pozná konec zápasu.
// Hra o ničem z toho neví: dostává události přes most (bridge.js).
//
// Události (on): 'match' (nový pohled serveru), 'moves' (nové tahy v pořadí; replay = tah z historie při obnovení), 'end' (zápas skončil),
// 'connection' ({ ok }), 'fatal' (zápas se nedá dál sledovat).

export const POLL = {
  turnWait: 1100, // čeká se na tah soupeře: ptáme se často
  myTurn: 2500, // jsem na tahu: stačí občasné „jsem tu“
  race: 1800,
  realtime: 5000,
  error: [1000, 2000, 4000, 8000],
};
const PAGE = 300; // server vrací nejvýš 300 tahů najednou
const SEND_RETRIES = 12;
const FATAL = new Set(['not_in_match', 'not_authenticated', 'unavailable']);

// Výsledek z pohledu hráče: 'win' | 'loss' | 'draw' | 'void' (zrušeno) | null (zápas běží).
export function outcomeFor(view) {
  if (!view || view.status === 'active') return null;
  if (view.status === 'void') return 'void';
  if (view.winner === 3) return 'win';
  if (view.winner === 0) return view.team ? 'loss' : 'draw';
  return view.winner === view.slot ? 'win' : 'loss';
}

export class MpSession {
  // opts: { api, match, now, timers, poll }
  constructor(opts) {
    this.api = opts.api;
    this.now = opts.now || (() => Date.now());
    this.timers = opts.timers || { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) };
    this.poll = Object.assign({}, POLL, opts.poll || {});
    this.id = opts.match.id;
    this.slot = opts.match.slot;
    this.match = opts.match; // poslední pohled serveru
    this.moves = []; // všechny známé tahy po řadě (index = číslo tahu - 1)
    this.offset = 0; // čas serveru - čas zařízení (ms)
    this.synced = false; // historie tahů je načtená
    this.ended = false;
    this.reported = null; // výsledek, který hra ohlásila serveru (zápas se ale ještě nemusel uzavřít)
    this.connected = true;
    this._samples = [];
    this._handlers = {};
    this._running = false;
    this._timer = null;
    this._polling = null;
    this._failures = 0;
    this._outbox = [];
    this._pumping = false;
    this._syncWaiters = [];
    // Zatím jen odhad rozdílu hodin (odezva neznámá); první odpověď serveru ho zpřesní.
    this.offset = Number.isFinite(opts.match.now) ? opts.match.now - this.now() : 0;
  }

  // ---------- Události ----------
  on(event, fn) {
    (this._handlers[event] = this._handlers[event] || []).push(fn);
    return () => { this._handlers[event] = (this._handlers[event] || []).filter((f) => f !== fn); };
  }
  _emit(event, data) {
    for (const fn of (this._handlers[event] || []).slice()) { try { fn(data); } catch (err) { console.error('Chyba v obsluze události zápasu:', err); } }
  }

  // ---------- Čas serveru ----------
  _sampleOffset(serverMs, t0, t1) {
    if (!Number.isFinite(serverMs)) return;
    this._samples.push({ rtt: Math.max(0, t1 - t0), offset: serverMs - (t0 + t1) / 2 });
    if (this._samples.length > 8) this._samples.shift();
    // nejpřesnější je vzorek s nejkratší odezvou
    let best = this._samples[0];
    for (const s of this._samples) if (s.rtt < best.rtt) best = s;
    this.offset = best.offset;
  }
  serverNow() { return this.now() + this.offset; }

  // ---------- Dotazy ----------
  lastSeq() { return this.moves.length; }
  get status() { return this.match.status; }
  get active() { return this.match.status === 'active'; }
  get myTurn() { return this.active && this.match.turn === this.slot; }
  outcome() { return outcomeFor(this.match); }

  whenSynced() {
    if (this.synced) return Promise.resolve();
    return new Promise((resolve) => this._syncWaiters.push(resolve));
  }

  // ---------- Dotazování serveru ----------
  start() {
    if (this._running) return;
    this._running = true;
    this._schedule(0);
  }
  stop() {
    this._running = false;
    if (this._timer != null) { this.timers.clearTimeout(this._timer); this._timer = null; }
  }
  _schedule(ms) {
    if (!this._running) return;
    if (this._timer != null) this.timers.clearTimeout(this._timer);
    this._timer = this.timers.setTimeout(() => { this._timer = null; this.refresh(); }, ms);
  }
  // Hned se zeptá serveru (po vlastním tahu, po upozornění z kanálu...). Souběžné dotazy se slučují.
  kick() { if (this._running && !this.ended) this._schedule(0); }

  refresh() {
    if (this._polling) return this._polling;
    this._polling = this._pollOnce().finally(() => { this._polling = null; });
    return this._polling;
  }

  async _pollOnce() {
    if (this.ended) return;
    const t0 = this.now();
    const res = await this.api.state(this.id, this.lastSeq());
    const t1 = this.now();
    if (res.error) { this._failed(res.error); return; }
    this._connection(true);
    this._failures = 0;
    this._sampleOffset(res.data.match.now, t0, t1);
    const full = (res.data.moves || []).length >= PAGE; // dalších tahů je ještě víc
    this._absorb(res.data.match, res.data.moves || [], full);
    if (this._running && !this.ended) this._schedule(full ? 0 : this._delay());
  }

  _delay() {
    const v = this.match;
    if (v.kind === 'race') return this.poll.race;
    if (v.kind === 'realtime') return this.poll.realtime;
    if (v.turn && v.turn !== this.slot) return this.poll.turnWait;
    return this.poll.myTurn;
  }

  _failed(err) {
    if (FATAL.has(err.code)) { this.stop(); this._emit('fatal', err); return; }
    this._failures += 1;
    if (this._failures >= 2) this._connection(false);
    if (this._running && !this.ended) this._schedule(this.poll.error[Math.min(this._failures - 1, this.poll.error.length - 1)]);
  }

  _connection(ok) {
    if (this.connected === ok) return;
    this.connected = ok;
    this._emit('connection', { ok });
  }

  // Zapracuje odpověď serveru: pohled na zápas a nové tahy.
  _absorb(view, moves, more) {
    const fresh = [];
    for (const m of moves) {
      if (m.seq <= this.moves.length) continue; // už známe (třeba vlastní tah)
      if (m.seq !== this.moves.length + 1) break; // díra v pořadí by se nikdy neměla stát; dotáhne se příště
      const rec = { seq: m.seq, p: m.p, payload: m.payload, end: m.end !== false, at: m.at, mine: m.p === this.slot, replay: !this.synced };
      this.moves.push(rec);
      fresh.push(rec);
    }
    this._setView(view);
    if (fresh.length) this._emit('moves', fresh);
    if (!this.synced && !more) {
      this.synced = true;
      const waiters = this._syncWaiters.splice(0);
      for (const w of waiters) w();
    }
    this._checkEnd();
  }

  _setView(view) {
    if (!view) return;
    this.match = view;
    this._emit('match', view);
  }

  _checkEnd() {
    if (this.ended || this.match.status === 'active') return;
    this.ended = true;
    this.stop();
    this._emit('end', this.match);
  }

  // ---------- Posílání tahů ----------
  // Pošle tah (payload je cokoli, co hra potřebuje; server mu nerozumí). Vrací odpověď serveru { ok, seq, turn, deadline, bank }.
  // Tahy jdou po jednom v pořadí. Po výpadku spojení se stejný tah zkusí znovu (server ho přijme jen jednou).
  sendMove(payload, opts) {
    const endTurn = !(opts && opts.endTurn === false);
    return new Promise((resolve, reject) => {
      this._outbox.push({ payload, endTurn, resolve, reject, seq: null, tries: 0 });
      this._pump();
    });
  }

  async _pump() {
    if (this._pumping) return;
    this._pumping = true;
    try {
      while (this._outbox.length) {
        const job = this._outbox[0];
        if (this.ended) { this._outbox.shift(); job.reject({ code: 'not_active' }); continue; }
        if (job.seq == null) job.seq = this.moves.length + 1;
        const res = await this.api.move(this.id, job.seq, job.payload, job.endTurn);
        if (res.error) {
          if (res.error.transient && job.tries < SEND_RETRIES) {
            job.tries += 1;
            this._connection(false);
            await this._sleep(this.poll.error[Math.min(job.tries - 1, this.poll.error.length - 1)]);
            continue;
          }
          if (res.error.code === 'bad_seq' || res.error.code === 'not_your_turn') {
            await this.refresh();
            const known = this.moves[job.seq - 1];
            if (known && known.mine && JSON.stringify(known.payload) === JSON.stringify(job.payload)) { this._outbox.shift(); job.resolve({ ok: true, seq: job.seq, again: true }); continue; }
          }
          this._outbox.shift();
          job.reject(res.error);
          continue;
        }
        this._connection(true);
        const data = res.data || {};
        this._outbox.shift();
        if (data.ok === false) {
          // čas vypršel: zápas je uzavřen, server poslal jeho pohled
          if (data.match) this._setView(data.match);
          this._checkEnd();
          job.reject({ code: data.error || 'timeout' });
          continue;
        }
        if (this.moves.length === job.seq - 1) {
          this.moves.push({ seq: job.seq, p: this.slot, payload: job.payload, end: job.endTurn, at: this.serverNow(), mine: true, replay: false });
        }
        this._setView(Object.assign({}, this.match, { turn: data.turn ?? this.match.turn, deadline: data.deadline ?? this.match.deadline, bank: data.bank || this.match.bank, move_count: Math.max(this.match.move_count || 0, job.seq), turn_started: this.serverNow() }));
        job.resolve(data);
        this.kick();
      }
    } finally {
      this._pumping = false;
    }
  }

  _sleep(ms) { return new Promise((resolve) => this.timers.setTimeout(resolve, ms)); }

  // ---------- Výsledek, vzdání, průběh ----------
  async _act(call) {
    let last = null;
    for (let i = 0; i < 4; i++) {
      const res = await call();
      if (!res.error) { if (res.data && res.data.id) { this._setView(res.data); this._checkEnd(); } return res.data; }
      last = res.error;
      if (!res.error.transient) break;
      await this._sleep(this.poll.error[Math.min(i, this.poll.error.length - 1)]);
    }
    throw last;
  }

  // Ohlásí výsledek z pohledu hráče (win | loss | draw); o výplatě rozhodne server podle hlášení obou.
  async report(outcome, reason) {
    const view = await this._act(() => this.api.report(this.id, outcome, reason));
    if (!this.ended) { this.reported = outcome; this._emit('reported', outcome); }
    return view;
  }
  resign() { return this._act(() => this.api.resign(this.id)); }
  abort() { return this._act(() => this.api.abort(this.id)); }
  async progress(value) {
    const res = await this.api.progress(this.id, value);
    if (res.error) throw res.error;
    this._setView(res.data);
    this._checkEnd();
    return res.data;
  }
}
