// Testy multiplayeru v appce (src/mp): seznam her proti databázi, chyby, řadič zápasu s falešným serverem (pořadí tahů, opakování po výpadku,
// konec zápasu, čas serveru), dokument hry (vypnuté cheaty, čisté úložiště, rozhraní window.jomaridMP) a most mezi hrou a appkou.
//   npm run test:mp
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { MP_GAMES, hasOnline, defaultParams, cleanParams } from '../mp/catalog.js';
import { normalizeError, createMpApi } from '../mp/api.js';
import { errorCode, mpErrorText } from '../mp/errors.js';
import { MpSession, outcomeFor, POLL } from '../mp/session.js';
import { stripCheatCodes, buildMpPrelude, withMultiplayer, initForGame } from '../mp/inject.js';
import { attachMpBridge } from '../mp/bridge.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(SRC, '..', 'db');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const sql = fs.readFileSync(path.join(DB, 'multiplayer.sql'), 'utf8');

// ---------- seznam her proti databázi ----------
const cfgLines = [...sql.matchAll(/when '([a-z]+)\/([a-z]+)'\s+then jsonb_build_object\(([^\n]*)\)/g)].map((m) => ({ game: m[1], mode: m[2], body: m[3] }));
const num = (body, key) => { const m = new RegExp(`'${key}', (-?\\d+)`).exec(body); return m ? Number(m[1]) : null; };

test('každý režim v seznamu her je i v databázi (mp_cfg) a naopak, se stejným druhem hry a odměnou', () => {
  const dbModes = new Set(cfgLines.map((c) => `${c.game}/${c.mode}`));
  const appModes = new Set();
  for (const [game, def] of Object.entries(MP_GAMES)) for (const m of def.modes) appModes.add(`${game}/${m.id}`);
  assert.deepEqual([...appModes].sort(), [...dbModes].sort());
  for (const c of cfgLines) {
    const def = MP_GAMES[c.game];
    const mode = def.modes.find((m) => m.id === c.mode);
    assert.equal(mode.reward, num(c.body, 'reward'), `odměna ${c.game}/${c.mode}`);
    assert.match(c.body, new RegExp(`'kind', '${def.kind === 'turn' ? 'turn' : def.kind}'`), `druh ${c.game}/${c.mode}`);
  }
});

test('volby před zápasem v seznamu her odpovídají tomu, co databáze (mp_clean_params) povoluje', () => {
  const fn = /create or replace function public\.mp_clean_params[\s\S]*?end \$\$;/.exec(sql)[0];
  for (const [game, def] of Object.entries(MP_GAMES)) {
    for (const o of def.options) {
      const part = new RegExp(`p_game = '${game}' then[\\s\\S]*?v not in \\(([^)]*)\\)`).exec(fn.replace(/elsif/g, 'if'));
      assert.ok(part, `${game}: volba ${o.key} je v databázi`);
      const allowed = [...part[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
      assert.deepEqual(o.choices.map((c) => c.value).sort(), allowed, `${game}.${o.key}`);
      assert.ok(o.choices.some((c) => c.value === o.def), `${game}.${o.key}: výchozí hodnota je mezi volbami`);
      assert.match(fn, new RegExp(`'${o.key}'`), `${game}: databáze čte klíč ${o.key}`);
    }
  }
});

test('hry v seznamu mají režim jen tehdy, kdy ho server zná; tlačítko Hrát online jen u zapnutých', () => {
  assert.equal(hasOnline('chess'), true);
  assert.equal(hasOnline('polygonarena'), false, 'aréna nejde přes zápasy');
  assert.equal(hasOnline('neexistuje'), false);
  for (const [id, def] of Object.entries(MP_GAMES)) assert.equal(hasOnline(id), def.ready && def.modes.length > 0, id);
});

test('výchozí a očištěné volby', () => {
  assert.deepEqual(defaultParams('chess'), { tc: '5+3' });
  assert.deepEqual(defaultParams('koulovikamosi'), {});
  assert.deepEqual(cleanParams('chess', { tc: '3+2', x: 1 }), { tc: '3+2' });
  assert.deepEqual(cleanParams('chess', { tc: 'bad' }), { tc: '5+3' });
  assert.deepEqual(cleanParams('chess', null), { tc: '5+3' });
  assert.deepEqual(cleanParams('hannibal', { preset: 'large' }), { preset: 'large' });
});

// ---------- chyby ----------
test('chyby ze serveru: kód z databáze, výpadek spojení, chybějící funkce', () => {
  assert.deepEqual(normalizeError({ message: 'not_your_turn', code: 'P0001' }), { code: 'not_your_turn', message: 'not_your_turn', transient: false });
  assert.equal(normalizeError({ message: 'TypeError: Failed to fetch', name: 'TypeError' }).code, 'network');
  assert.equal(normalizeError({ message: 'TypeError: Failed to fetch', name: 'TypeError' }).transient, true);
  assert.equal(normalizeError({ code: 'PGRST202', message: 'Could not find the function public.mp_find' }).code, 'unavailable');
  assert.equal(normalizeError({ status: 404, message: 'Not Found' }).code, 'unavailable');
  assert.equal(normalizeError({ code: '42501', message: 'permission denied for function mp_find' }).code, 'not_authenticated');
  assert.equal(normalizeError({ status: 503, message: 'Service Unavailable' }).transient, true);
  assert.equal(normalizeError({ message: 'cokoliv jiného' }).code, 'error');
  assert.equal(errorCode({ code: 'room_taken' }), 'room_taken');
  assert.equal(errorCode({ message: 'bad_seq' }), 'bad_seq');
  assert.equal(errorCode(null), '');
  assert.match(mpErrorText({ code: 'not_your_turn' }), /na tahu/);
  assert.match(mpErrorText({ code: 'zcela_nova_chyba' }), /pokazilo/);
});

test('volání serveru: názvy funkcí a parametry odpovídají databázi', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: { ok: true }, error: null }; } };
  const api = createMpApi(client);
  await api.find('chess', 'duel', { tc: '3+2' }); await api.state('m1', 4); await api.move('m1', 5, { a: 1 }, false); await api.report('m1', 'win', 'x');
  await api.progress('m1', 12.5); await api.roomJoin('ABC234'); await api.arenaClaim(200.7, 3.2); await api.resign('m1'); await api.abort('m1'); await api.cancel(); await api.active();
  assert.deepEqual(calls.map((c) => c[0]), ['mp_find', 'mp_state', 'mp_move', 'mp_report', 'mp_progress', 'mp_room_join', 'mp_arena_claim', 'mp_resign', 'mp_abort', 'mp_cancel', 'mp_active']);
  assert.deepEqual(calls[0][1], { p_game: 'chess', p_mode: 'duel', p_params: { tc: '3+2' } });
  assert.deepEqual(calls[2][1], { p_match: 'm1', p_seq: 5, p_payload: { a: 1 }, p_end_turn: false });
  assert.deepEqual(calls[6][1], { p_seconds: 200, p_score: 3 });
  for (const [name] of calls) assert.match(sql, new RegExp(`function public\\.${name}\\(`), `${name} je v databázi`);
  const bad = createMpApi({ rpc: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal((await bad.state('m', 0)).error.code, 'network');
  const err = createMpApi({ rpc: async () => ({ data: null, error: { message: 'not_in_match', code: 'P0001' } }) });
  assert.equal((await err.state('m', 0)).error.code, 'not_in_match');
});

// ---------- falešný server a hodiny ----------
class Clock {
  constructor() { this.t = 1_000_000; this.timers = []; this.id = 0; }
  now() { return this.t; }
  get api() { return { setTimeout: (f, ms) => { const id = ++this.id; this.timers.push({ id, at: this.t + ms, f }); return id; }, clearTimeout: (id) => { this.timers = this.timers.filter((x) => x.id !== id); } }; }
  async flush() { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); }
  // Posune čas o ms a spustí, co se stihne.
  async advance(ms) {
    const end = this.t + ms;
    for (;;) {
      await this.flush();
      const next = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = Math.max(this.t, next.at);
      next.f();
    }
    this.t = end;
    await this.flush();
  }
}

// Minimální server zápasu: pořadí tahů, výpadky, vypršení času a konec zápasu zvenčí.
class FakeServer {
  constructor(clock, { slot = 1, kind = 'turn', skew = 5000 } = {}) {
    this.clock = clock; this.slot = slot; this.skew = skew; this.kind = kind;
    this.moves = []; this.turn = 1; this.status = 'active'; this.winner = null; this.reason = null;
    this.calls = []; this.failNext = []; this.latency = 0; this.coins = 0;
  }
  view() {
    return { id: 'm1', game: 'chess', mode: 'duel', params: {}, seed: 7, slot: this.slot, status: this.status, turn: this.status === 'active' ? this.turn : null, deadline: null, bank: [300, 300],
      now: this.clock.now() + this.skew + this.latency, move_count: this.moves.length, winner: this.winner, reason: this.reason, kind: this.kind, team: false, reward: 30,
      opponent: { id: 'o', name: 'Soupeř', seen_ago: 0 }, me: { id: 'u', name: 'Já' }, my_coins: this.coins, prog: [0, 0] };
  }
  fail() { return this.failNext.length ? this.failNext.shift() : null; }
  async tick() { if (this.latency) { this.clock.t += this.latency; } }
  api() {
    const self = this;
    return {
      async state(id, since) {
        self.calls.push(['state', since]);
        const f = self.fail(); if (f) return { error: f };
        await self.tick();
        return { data: { match: self.view(), moves: self.moves.filter((m) => m.seq > since).slice(0, 300).map((m) => ({ seq: m.seq, p: m.p, payload: m.payload, end: m.end, at: 1 })) } };
      },
      async move(id, seq, payload, endTurn) {
        self.calls.push(['move', seq]);
        const f = self.fail(); if (f) return { error: f };
        const old = self.moves[seq - 1];
        if (old) return old.p === self.slot && JSON.stringify(old.payload) === JSON.stringify(payload) ? { data: { ok: true, seq, turn: self.turn, again: true, bank: [300, 300] } } : { error: { code: 'bad_seq', transient: false } };
        if (self.status !== 'active') return { error: { code: 'not_active', transient: false } };
        if (self.turn !== self.slot) return { error: { code: 'not_your_turn', transient: false } };
        if (seq !== self.moves.length + 1) return { error: { code: 'bad_seq', transient: false } };
        self.moves.push({ seq, p: self.slot, payload, end: endTurn !== false });
        if (endTurn !== false) self.turn = 3 - self.slot;
        return { data: { ok: true, seq, turn: self.turn, deadline: null, bank: [300, 300] } };
      },
      async report(id, outcome) { self.calls.push(['report', outcome]); const f = self.fail(); if (f) return { error: f }; return { data: self.view() }; },
      async resign(id) { self.calls.push(['resign']); self.status = 'finished'; self.winner = 3 - self.slot; self.reason = 'resign'; return { data: self.view() }; },
      async abort(id) { self.calls.push(['abort']); self.status = 'void'; return { data: self.view() }; },
      async progress(id, v) { self.calls.push(['progress', v]); const f = self.fail(); if (f) return { error: f }; return { data: self.view() }; },
    };
  }
  opponentMoves(n) { for (let i = 0; i < n; i++) { this.moves.push({ seq: this.moves.length + 1, p: 3 - this.slot, payload: { o: this.moves.length + 1 }, end: true }); this.turn = this.slot; } }
}

const make = (opts) => {
  const clock = new Clock();
  const server = new FakeServer(clock, opts);
  const session = new MpSession({ api: server.api(), match: server.view(), now: () => clock.now(), timers: clock.api });
  return { clock, server, session };
};

test('řadič: čas serveru se odvodí z odpovědi a dá se pak použít (nejpřesnější je vzorek s nejkratší odezvou)', async () => {
  const { clock, server, session } = make();
  server.skew = 5000;
  session.start();
  await clock.advance(10);
  assert.ok(Math.abs(session.serverNow() - (clock.now() + 5000)) < 5, `rozdíl hodin ${session.serverNow() - clock.now()}`);
  server.latency = 400; // pomalá odpověď: nezhorší odhad
  await clock.advance(4000);
  assert.ok(Math.abs(session.serverNow() - (clock.now() + 5000)) < 60);
  session.stop();
});

test('řadič: první dotaz vrátí historii tahů označenou jako replay a whenSynced se splní', async () => {
  const { clock, server, session } = make();
  server.moves.push({ seq: 1, p: 1, payload: { a: 1 }, end: true }, { seq: 2, p: 2, payload: { a: 2 }, end: true });
  server.turn = 1;
  const got = [];
  session.on('moves', (list) => got.push(...list));
  let synced = false;
  session.whenSynced().then(() => { synced = true; });
  session.start();
  await clock.advance(5);
  assert.equal(synced, true);
  assert.deepEqual(got.map((m) => [m.seq, m.p, m.replay, m.mine]), [[1, 1, true, true], [2, 2, true, false]]);
  assert.equal(session.lastSeq(), 2);
  server.opponentMoves(1); // soupeř (místo 2) táhne po odehrání dvou tahů
  server.turn = 1;
  await clock.advance(3000);
  assert.deepEqual(got.slice(2).map((m) => [m.seq, m.p, m.replay]), [[3, 2, false]]);
  session.stop();
});

test('řadič: tahy se přijímají jen po řadě a nikdy dvakrát', async () => {
  const { clock, server, session } = make();
  server.turn = 2; // čeká se na soupeře: ptá se často
  const got = [];
  session.on('moves', (list) => got.push(...list.map((m) => m.seq)));
  session.start();
  await clock.advance(5);
  server.opponentMoves(1);
  server.turn = 1;
  await clock.advance(1200);
  await clock.advance(1200);
  assert.deepEqual(got, [1]);
  // poškozená odpověď s mezerou: tah 5 bez 3 a 4 se nepřijme
  const api = server.api();
  session.api = Object.assign({}, api, { state: async () => ({ data: { match: server.view(), moves: [{ seq: 1, p: 2, payload: {}, end: true }, { seq: 5, p: 2, payload: {}, end: true }] } }) });
  await clock.advance(1500);
  assert.deepEqual(got, [1]);
  session.stop();
});

test('řadič: vlastní tah se pošle, zapíše do historie a z dotazu se znovu neohlásí jako nový', async () => {
  const { clock, server, session } = make();
  const got = [];
  session.on('moves', (list) => got.push(...list));
  session.start();
  await clock.advance(5);
  const res = await Promise.race([session.sendMove({ from: 'e2', to: 'e4' }), clock.advance(50).then(() => null)]);
  await clock.advance(50);
  assert.ok(server.moves.length === 1 && server.moves[0].payload.to === 'e4');
  assert.equal(session.lastSeq(), 1);
  assert.equal(session.match.turn, 2, 'po tahu je na řadě soupeř');
  await clock.advance(3000);
  assert.equal(got.length, 0, 'vlastní tah se z dotazu nevrací jako nový');
  assert.equal(res === null || res.ok === true, true);
  session.stop();
});

test('řadič: tahy odeslané za sebou jdou po jednom a ve správném pořadí', async () => {
  const { clock, server, session } = make();
  server.turn = 1;
  session.start();
  await clock.advance(5);
  const done = [];
  session.sendMove({ n: 1 }, { endTurn: false }).then((r) => done.push(r.seq));
  session.sendMove({ n: 2 }, { endTurn: false }).then((r) => done.push(r.seq));
  session.sendMove({ n: 3 }).then((r) => done.push(r.seq));
  await clock.advance(100);
  assert.deepEqual(done, [1, 2, 3]);
  assert.deepEqual(server.moves.map((m) => m.payload.n), [1, 2, 3]);
  assert.equal(server.turn, 2);
  session.stop();
});

test('řadič: po výpadku spojení se stejný tah zkusí znovu a server ho přijme jen jednou', async () => {
  const { clock, server, session } = make();
  session.start();
  await clock.advance(5);
  const netErr = { code: 'network', transient: true };
  server.failNext = [netErr, netErr]; // stav i tah
  const conn = [];
  session.on('connection', (c) => conn.push(c.ok));
  let ack = null;
  session.sendMove({ a: 1 }).then((r) => { ack = r; });
  await clock.advance(10_000);
  assert.ok(ack && ack.ok, 'tah nakonec prošel');
  assert.equal(server.moves.length, 1);
  const moveCalls = server.calls.filter((c) => c[0] === 'move');
  assert.ok(moveCalls.length >= 1 && moveCalls.every((c) => c[1] === 1), 'pokaždé stejné číslo tahu');
  assert.ok(conn.includes(false) && conn[conn.length - 1] === true, 'výpadek se ohlásil a spojení se obnovilo');
  session.stop();
});

test('řadič: ztracená odpověď na úspěšný tah (stejný tah už je na serveru) se bere jako úspěch', async () => {
  const { clock, server, session } = make();
  session.start();
  await clock.advance(5);
  server.moves.push({ seq: 1, p: 1, payload: { a: 1 }, end: true }); server.turn = 1; // server tah přijal, odpověď se ztratila
  let ack = null; let err = null;
  session.sendMove({ a: 1 }).then((r) => { ack = r; }, (e) => { err = e; });
  await clock.advance(200);
  assert.equal(err, null);
  assert.ok(ack && ack.ok);
  assert.equal(server.moves.length, 1);
  session.stop();
});

test('řadič: tah, který server odmítne (jiný obsah na stejném čísle), skončí chybou', async () => {
  const { clock, server, session } = make();
  session.start();
  await clock.advance(5);
  server.moves.push({ seq: 1, p: 2, payload: { o: 1 }, end: true }); server.turn = 1;
  let err = null;
  session.sendMove({ a: 1 }).catch((e) => { err = e; });
  await clock.advance(200);
  assert.ok(err && ['bad_seq', 'not_your_turn'].includes(err.code));
  session.stop();
});

test('řadič: konec zápasu zastaví dotazování, ohlásí se jednou a další tahy se odmítnou', async () => {
  const { clock, server, session } = make();
  const ends = [];
  session.on('end', (v) => ends.push(v.winner));
  session.start();
  await clock.advance(5);
  server.status = 'finished'; server.winner = 2; server.reason = 'timeout';
  await clock.advance(3000);
  assert.deepEqual(ends, [2]);
  assert.equal(session.ended, true);
  const before = server.calls.length;
  await clock.advance(20_000);
  assert.equal(server.calls.length, before, 'po konci se na server dál neptá');
  assert.equal(session.outcome(), 'loss');
  await assert.rejects(() => session.sendMove({ a: 1 }), (e) => e.code === 'not_active');
});

test('výsledek z pohledu hráče', () => {
  const v = (o) => Object.assign({ status: 'finished', slot: 1, winner: 1, team: false }, o);
  assert.equal(outcomeFor(v()), 'win');
  assert.equal(outcomeFor(v({ winner: 2 })), 'loss');
  assert.equal(outcomeFor(v({ winner: 0 })), 'draw');
  assert.equal(outcomeFor(v({ winner: 0, team: true })), 'loss', 'prohra týmu není remíza');
  assert.equal(outcomeFor(v({ winner: 3, team: true })), 'win');
  assert.equal(outcomeFor(v({ status: 'void' })), 'void');
  assert.equal(outcomeFor(v({ status: 'active' })), null);
  assert.equal(outcomeFor(null), null);
});

test('řadič: tah po vypršení času vrátí chybu timeout a zápas je uzavřený', async () => {
  const { clock, server, session } = make();
  session.start();
  await clock.advance(5);
  const api = server.api();
  session.api = Object.assign({}, api, { move: async () => { server.status = 'finished'; server.winner = 2; server.reason = 'timeout'; return { data: { ok: false, error: 'timeout', match: server.view() } }; } });
  let err = null;
  session.sendMove({ a: 1 }).catch((e) => { err = e; });
  await clock.advance(100);
  assert.equal(err && err.code, 'timeout');
  assert.equal(session.ended, true);
  assert.equal(session.outcome(), 'loss');
});

test('řadič: opakované chyby spojení zpomalují dotazování, po dvou se ohlásí výpadek, zotavení se ohlásí také', async () => {
  const { clock, server, session } = make();
  const conn = [];
  session.on('connection', (c) => conn.push(c.ok));
  session.start();
  await clock.advance(5);
  const net = { code: 'network', transient: true };
  server.failNext = [net, net, net];
  const callsBefore = server.calls.length;
  await clock.advance(2500 + 1000 + 2000 + 4000 + 300);
  assert.deepEqual(conn, [false, true]);
  assert.ok(server.calls.length - callsBefore >= 4);
  session.stop();
});

test('řadič: zápas, který už není můj, se přestane sledovat (fatal)', async () => {
  const { clock, server, session } = make();
  let fatal = null;
  session.on('fatal', (e) => { fatal = e; });
  session.start();
  await clock.advance(5);
  server.failNext = [{ code: 'not_in_match', transient: false }];
  await clock.advance(5000);
  assert.equal(fatal && fatal.code, 'not_in_match');
  const n = server.calls.length;
  await clock.advance(20_000);
  assert.equal(server.calls.length, n);
});

test('řadič: hlášení výsledku, vzdání a zrušení vrací pohled serveru; hlášení se po výpadku zopakuje', async () => {
  const { clock, server, session } = make();
  session.start();
  await clock.advance(5);
  server.failNext = [];
  const api = server.api();
  let n = 0;
  session.api = Object.assign({}, api, { report: async (id, o) => { n++; if (n === 1) return { error: { code: 'network', transient: true } }; return api.report(id, o); } });
  let view = null;
  session.report('win', 'checkmate').then((v) => { view = v; });
  await clock.advance(3000);
  assert.ok(view && view.id === 'm1');
  assert.equal(n, 2);
  const r = session.resign();
  await clock.advance(50);
  assert.equal((await r).reason, 'resign');
  assert.equal(session.ended, true);
  assert.equal(session.outcome(), 'loss');
});

test('řadič: dlouhá historie se dotáhne po stránkách', async () => {
  const { clock, server, session } = make();
  for (let i = 1; i <= 650; i++) server.moves.push({ seq: i, p: i % 2 ? 1 : 2, payload: { i }, end: true });
  server.turn = 1;
  const got = [];
  session.on('moves', (l) => got.push(...l));
  session.start();
  await clock.advance(50);
  assert.equal(got.length, 650);
  assert.ok(got.every((m, i) => m.seq === i + 1 && m.replay));
  assert.equal(session.synced, true);
  session.stop();
});

test('řadič: dotazy jsou častější, když se čeká na soupeře, než když jsem na tahu', async () => {
  const a = make();
  a.server.turn = 2; // čeká se na soupeře
  a.session.start();
  await a.clock.advance(10_000);
  const waiting = a.server.calls.filter((c) => c[0] === 'state').length;
  a.session.stop();
  const b = make();
  b.server.turn = 1;
  b.session.start();
  await b.clock.advance(10_000);
  const mine = b.server.calls.filter((c) => c[0] === 'state').length;
  b.session.stop();
  assert.ok(waiting > mine * 1.8, `čekání ${waiting}, můj tah ${mine}`);
  assert.ok(POLL.turnWait < POLL.myTurn);
});

// ---------- dokument hry ----------
const GAME_SOURCES = {
  chess: [['gameContent', 'chess', 'ui.js'], ['gameContent', 'chess', 'index.html']],
  rocket: [['gameContent', 'rocket', 'index.html']],
  polygonarena: [['gameContent', 'polygonArena', 'cheat.js'], ['gameContent', 'polygonArena', 'index.html']],
  koulovikamosi: [['gameContent', 'koulovi', 'game.js'], ['gameContent', 'koulovi', 'index.html']],
  cityclicker: [['gameContent', 'cityClicker', 'index.html']],
  warroom: [['gameContent', 'warroom', 'index.html']],
};

test('cheat kódy zmizí ze všech her (kód 67MILUJU i výjimka Rocketu) a nic jiného se nezmění', () => {
  for (const [id, files] of Object.entries(GAME_SOURCES)) {
    const joined = files.map((f) => read(...f)).join('\n');
    assert.match(joined, /67MILUJU/i, `${id}: kód ve hře je`);
    const clean = stripCheatCodes(joined, () => 0.25);
    assert.doesNotMatch(clean, /67MILUJU/i, `${id}: po úpravě kód není`);
    assert.doesNotMatch(clean, /IMAGINEFLEXIT/i, `${id}: ani výjimka`);
    assert.equal(clean.length, joined.length - (joined.match(/67MILUJU/gi) || []).length * 8 - (joined.match(/IMAGINEFLEXITSTVOJIMMENEM/gi) || []).length * 25 + (joined.match(/67MILUJU/gi) || []).length * 14 + (joined.match(/IMAGINEFLEXITSTVOJIMMENEM/gi) || []).length * 14, `${id}: mění se jen kód`);
  }
  const a = stripCheatCodes('x 67MILUJU y 67MILUJU z');
  const [t1, t2] = a.match(/[A-Z0-9]{14}/g);
  assert.notEqual(t1, t2, 'každý výskyt má jiný náhodný text');
});

test('dokument online hry: rozhraní window.jomaridMP je před skripty hry, úložiště je čisté a nese označení mp:<hra>', () => {
  const init = initForGame({ id: 'm1', game: 'chess', mode: 'duel', params: { tc: '5+3' }, seed: '123', slot: 2, kind: 'turn', team: false, reward: 30, me: { id: 'u', name: 'Já' }, opponent: { id: 'o', name: 'Soupeř' } }, 12);
  const html = '<!doctype html><html><head><title>x</title></head><body><script>const CHEAT_CODE = "67MILUJU";</script></body></html>';
  const doc = withMultiplayer(html, 'chess', init, () => 0.5);
  assert.ok(doc.indexOf('window.jomaridMP') < doc.indexOf('CHEAT_CODE'), 'rozhraní je před skripty hry');
  assert.ok(doc.includes('"mp:chess"') || doc.includes('\\"mp:chess\\"'), 'úložiště má označení mp:chess');
  assert.doesNotMatch(doc, /67MILUJU/);
  assert.match(doc, /"slot":2/);
  assert.match(doc, /"seed":123/);
  assert.equal(init.opponent.name, 'Soupeř');
  assert.doesNotMatch(doc, /"p_/, 'nic ze serveru navíc');
});

// Spustí rozhraní hry v izolovaném prostředí, které zachytává zprávy pro appku.
function runPrelude(init) {
  const listeners = [];
  const posted = [];
  const parent = { postMessage: (m) => posted.push(m) };
  const win = { parent, addEventListener: (t, f) => { if (t === 'message') listeners.push(f); }, console };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, { Promise, Object, Date, JSON, Math }));
  vm.runInContext(buildMpPrelude(init), ctx);
  const deliver = (data, source = parent) => { for (const f of listeners) f({ source, data }); };
  return { win, posted, deliver, parent };
}

test('rozhraní hry: událost před listen() se zpozdí, po listen() dorazí; odpovědi spárované podle čísla', async () => {
  const { win, posted, deliver } = runPrelude({ slot: 1, offset: 100 });
  const mp = win.jomaridMP;
  assert.equal(mp.enabled, true);
  assert.equal(mp.init.slot, 1);
  assert.equal(win.__JOMARID_MP, true);
  const seen = [];
  mp.on('moves', (d) => seen.push(d.moves.length)).on('sync', (d) => seen.push('sync:' + d.moves.length));
  deliver({ source: 'jomarid-host', type: 'mp-event', event: 'sync', data: { moves: [1, 2], offset: 500 } });
  assert.deepEqual(seen, [], 'hra ještě neposlouchá');
  mp.listen();
  assert.deepEqual(seen, ['sync:2']);
  assert.equal(posted.find((m) => m.op === 'listen').type, 'mp');
  assert.equal(posted.find((m) => m.op === 'listen').source, 'jomarid-game');
  deliver({ source: 'jomarid-host', type: 'mp-event', event: 'moves', data: { moves: [3] } });
  assert.deepEqual(seen, ['sync:2', 1]);
  assert.ok(Math.abs(mp.serverNow() - (Date.now() + 500)) < 50, 'čas serveru se aktualizuje z události');
  const p = mp.move({ a: 1 });
  const sent = posted.find((m) => m.op === 'move');
  assert.deepEqual(JSON.parse(JSON.stringify(sent.args)), { payload: { a: 1 }, endTurn: true });
  deliver({ source: 'jomarid-host', type: 'mp-reply', id: sent.id, ok: true, data: { seq: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(await p)), { seq: 1 });
  const q = mp.report('win', 'checkmate');
  const rep = posted.find((m) => m.op === 'report');
  deliver({ source: 'jomarid-host', type: 'mp-reply', id: rep.id, ok: false, error: { code: 'not_active' } });
  await assert.rejects(q, (e) => e.code === 'not_active');
  mp.close();
  assert.ok(posted.some((m) => m.op === 'close'));
});

test('rozhraní hry: zprávy z jiného okna nebo s cizím původem se ignorují a rozhraní nejde přepsat', () => {
  const { win, deliver } = runPrelude({ slot: 2 });
  const mp = win.jomaridMP;
  const seen = [];
  mp.on('moves', () => seen.push(1)); mp.listen();
  deliver({ source: 'jomarid-host', type: 'mp-event', event: 'moves', data: { moves: [] } }, { postMessage() {} });
  deliver({ source: 'neco-jineho', type: 'mp-event', event: 'moves', data: { moves: [] } });
  assert.deepEqual(seen, []);
  assert.throws(() => { 'use strict'; win.jomaridMP = {}; }, TypeError);
  assert.equal(win.jomaridMP, mp);
});

// ---------- most ----------
test('most: zprávy ze hry projdou jen z okna této hry, žádosti se ověří a odpovědi se vrátí hře', async () => {
  const { clock, server, session } = make();
  server.turn = 1;
  const sent = [];
  const gameWin = { postMessage: (m) => sent.push(m) };
  const host = (() => { const ls = []; return { addEventListener: (t, f) => ls.push(f), removeEventListener: (t, f) => ls.splice(ls.indexOf(f), 1), fire: (e) => ls.slice().forEach((f) => f(e)), count: () => ls.length }; })();
  let closed = 0;
  const bridge = attachMpBridge({ session, getWindow: () => gameWin, onClose: () => { closed++; }, win: host });
  session.start();
  await clock.advance(5);
  const msg = (data, source = gameWin) => host.fire({ source, data: Object.assign({ source: 'jomarid-game', type: 'mp' }, data) });
  msg({ op: 'listen', id: 0 });
  await clock.advance(5);
  const sync = sent.find((m) => m.type === 'mp-event' && m.event === 'sync');
  assert.ok(sync && sync.source === 'jomarid-host' && Array.isArray(sync.data.moves) && sync.data.match.slot === 1);
  msg({ op: 'move', id: 7, args: { payload: { from: 'e2', to: 'e4' } } });
  await clock.advance(100);
  const ok = sent.find((m) => m.type === 'mp-reply' && m.id === 7);
  assert.ok(ok && ok.ok && ok.data.seq === 1);
  assert.equal(server.moves.length, 1);
  msg({ op: 'move', id: 8, args: {} });
  assert.equal(sent.find((m) => m.id === 8).error.code, 'invalid_payload');
  msg({ op: 'report', id: 9, args: { outcome: 'victory' } });
  assert.equal(sent.find((m) => m.id === 9).error.code, 'invalid_outcome');
  msg({ op: 'progress', id: 10, args: { value: -1 } });
  assert.equal(sent.find((m) => m.id === 10).error.code, 'invalid_value');
  msg({ op: 'nic', id: 11, args: {} });
  assert.equal(sent.find((m) => m.id === 11).error.code, 'unknown_op');
  const n = sent.length;
  msg({ op: 'move', id: 12, args: { payload: { a: 1 } } }, { postMessage() {} });
  host.fire({ source: gameWin, data: { source: 'jomarid-game', type: 'coin', amount: 50 } });
  host.fire({ source: gameWin, data: { type: 'mp', op: 'move', id: 13, args: { payload: 1 } } });
  await clock.advance(100);
  assert.equal(sent.length, n, 'cizí okno, jiný druh zprávy ani zpráva bez označení hry nic nespustí');
  assert.equal(server.moves.length, 1);
  msg({ op: 'close', id: 0 });
  assert.equal(closed, 1);
  server.opponentMoves(1);
  await clock.advance(1500);
  assert.ok(sent.some((m) => m.type === 'mp-event' && m.event === 'moves' && m.data.moves[0].p === 2), 'nový tah soupeře jde hře jako událost');
  server.status = 'finished'; server.winner = 1; server.reason = 'checkmate';
  await clock.advance(3000);
  const end = sent.find((m) => m.type === 'mp-event' && m.event === 'end');
  assert.ok(end && end.data.outcome === 'win');
  bridge.dispose();
  assert.equal(host.count(), 0, 'po odpojení mostu nezůstane posluchač');
  session.stop();
});

// ---------- zapojení do appky ----------
test('Games.jsx: zprávy ze hry se bez spuštěné vlastní hry nepřijímají (online hra nesmí psát do uloženého postupu ani žádat o Coiny jako sólová)', () => {
  const g = read('pages', 'Games.jsx');
  assert.match(g, /if \(!iframeRef\.current \|\| event\.source !== iframeRef\.current\.contentWindow\) return;/);
});
