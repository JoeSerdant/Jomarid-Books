// Testy multiplayeru v appce (src/mp): seznam her proti databázi, chyby, řadič zápasu s falešným serverem (pořadí tahů, opakování po výpadku,
// konec zápasu, čas serveru), dokument hry (vypnuté cheaty, čisté úložiště, rozhraní window.jomaridMP) a most mezi hrou a appkou.
//   npm run test:mp
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { MP_GAMES, hasOnline, hasArena, defaultParams, cleanParams } from '../mp/catalog.js';
import { normalizeError, createMpApi } from '../mp/api.js';
import { errorCode, mpErrorText } from '../mp/errors.js';
import { MpSession, outcomeFor, POLL } from '../mp/session.js';
import { stripCheatCodes, buildMpPrelude, withMultiplayer, initForGame, initForArena } from '../mp/inject.js';
import { attachMpBridge, attachArenaBridge } from '../mp/bridge.js';
import { openRealtime, MAX_PAYLOAD_CHARS, MIN_SEND_GAP_MS } from '../mp/realtime.js';
import { buildOnlineEntry, withOnlineEntry, onlineMessage } from '../mp/entry.js';
import { EMOTES, emoteByCode, freshEmote } from '../mp/emotes.js';

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
    assert.match(c.body, new RegExp(`'kind', '${mode.kind || def.kind}'`), `druh ${c.game}/${c.mode}`);
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
  assert.match(mpErrorText({ code: 'illegal_move' }), /neuznal/);
  assert.match(mpErrorText({ code: 'zcela_nova_chyba' }), /pokazilo/);
});

test('volání serveru: názvy funkcí a parametry odpovídají databázi', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: { ok: true }, error: null }; } };
  const api = createMpApi(client);
  await api.find('chess', 'duel', { tc: '3+2' }); await api.state('m1', 4); await api.move('m1', 5, { a: 1 }, false); await api.report('m1', 'win', 'x');
  await api.progress('m1', 12.5); await api.roomJoin('ABC234'); await api.arenaClaim(200.7, 3.2); await api.resign('m1'); await api.abort('m1'); await api.cancel(); await api.active();
  await api.leaderboard('chess', 'duel', 5); await api.emote('m1', 3); await api.rematch('m1');
  assert.deepEqual(calls.map((c) => c[0]), ['mp_find', 'mp_state', 'mp_move', 'mp_report', 'mp_progress', 'mp_room_join', 'mp_arena_claim', 'mp_resign', 'mp_abort', 'mp_cancel', 'mp_active', 'mp_leaderboard', 'mp_emote', 'mp_rematch']);
  assert.deepEqual(calls[11][1], { p_game: 'chess', p_mode: 'duel', p_limit: 5 });
  assert.deepEqual(calls[12][1], { p_match: 'm1', p_code: 3 });
  assert.deepEqual(calls[13][1], { p_match: 'm1' });
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

test('řadič: tah, kterým server uzavře zápas (mat), rovnou ukončí zápas s plným pohledem (vítěz, Coiny)', async () => {
  const { clock, server, session } = make();
  const ends = [];
  session.on('end', (m) => ends.push(m));
  session.start();
  await clock.advance(5);
  const api = server.api();
  session.api = Object.assign({}, api, { move: async (id, seq) => {
    server.moves.push({ seq, p: server.slot, payload: { c: 'h5f7' }, end: true });
    server.status = 'finished'; server.winner = server.slot; server.reason = 'checkmate';
    return { data: { ok: true, seq, turn: 3 - server.slot, deadline: null, bank: [300, 300], status: 'finished', winner: server.slot, reason: 'checkmate', match: Object.assign(server.view(), { my_coins: 30 }) } };
  } });
  let ack = null;
  session.sendMove({ c: 'h5f7' }).then((r) => { ack = r; });
  await clock.advance(100);
  assert.equal(ack && ack.ok, true);
  assert.equal(session.ended, true, 'zápas skončil už odpovědí na tah');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].reason, 'checkmate');
  assert.equal(ends[0].my_coins, 30, 'konec nese i odměnu');
  assert.equal(session.outcome(), 'win');
  session.stop();
});

test('rychlé reakce: kódy 1 až 8 jako v databázi, nová reakce soupeře se pozná podle pořadí a stáří', () => {
  assert.deepEqual(EMOTES.map((e) => e.code), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.match(sql, /p_code < 1 or p_code > 8/);
  assert.equal(emoteByCode(4).icon, '😂');
  assert.equal(emoteByCode(9), null);
  assert.equal(freshEmote({}, 0), null);
  assert.equal(freshEmote({ opp_emote: null }, 0), null);
  assert.deepEqual(freshEmote({ opp_emote: { c: 2, n: 1, age: 300 } }, 0), { code: 2, n: 1 });
  assert.equal(freshEmote({ opp_emote: { c: 2, n: 1, age: 300 } }, 1), null, 'už ukázaná reakce se neukáže znovu');
  assert.deepEqual(freshEmote({ opp_emote: { c: 5, n: 2, age: 100 } }, 1), { code: 5, n: 2 });
  assert.equal(freshEmote({ opp_emote: { c: 2, n: 3, age: 60000 } }, 0), null, 'stará reakce (po návratu do zápasu) se neukáže');
  assert.equal(freshEmote({ opp_emote: { c: 99, n: 3, age: 10 } }, 0), null, 'neznámý kód se ignoruje');
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

// ---------- kanál v reálném čase ----------
// Falešný klient Supabase: channel() vrací kanál, jehož subscribe() si test řídí (SUBSCRIBED, CHANNEL_ERROR...).
function fakeRealtimeClient({ denyPrivate = false, denyAll = false } = {}) {
  const made = [], removed = [];
  const client = {
    made, removed,
    channel(topic, opts) {
      const ch = { topic, opts, sent: [], handlers: [], statusCb: null,
        on(type, filter, fn) { ch.handlers.push({ type, filter, fn }); return ch; },
        subscribe(cb) {
          ch.statusCb = cb;
          Promise.resolve().then(() => cb(denyAll || (denyPrivate && opts.config.private) ? 'CHANNEL_ERROR' : 'SUBSCRIBED'));
          return ch;
        },
        send(m) { ch.sent.push(m); return Promise.resolve('ok'); },
        track() {}, presenceState: () => ({}),
        emit(payload) { ch.handlers.filter((h) => h.type === 'broadcast').forEach((h) => h.fn({ payload })); },
      };
      made.push(ch);
      return ch;
    },
    removeChannel(ch) { removed.push(ch); },
  };
  return client;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('kanál v reálném čase: otevře se soukromý, zprávy jdou oběma směry a jsou omezené (odstup, velikost), důležité se neomezují', async () => {
  const client = fakeRealtimeClient();
  let t = 1000; const got = [], status = [];
  const rt = openRealtime({ client, topic: 'mp:abc', key: 'u1', now: () => t, onMessage: (p) => got.push(p), onStatus: (s) => status.push(s) });
  await tick();
  assert.equal(client.made.length, 1);
  assert.equal(client.made[0].topic, 'mp:abc');
  assert.equal(client.made[0].opts.config.private, true, 'nejdřív soukromý kanál ověřený pravidly v databázi');
  assert.deepEqual(client.made[0].opts.config.broadcast, { self: false, ack: false });
  assert.deepEqual(status, [{ status: 'open', private: true }]);
  assert.ok(rt.isOpen() && rt.isPrivate());
  assert.equal(rt.send({ k: 's', x: 1 }), true);
  assert.deepEqual(client.made[0].sent[0], { type: 'broadcast', event: 'g', payload: { k: 's', x: 1 } });
  t += MIN_SEND_GAP_MS - 1;
  assert.equal(rt.send({ k: 's', x: 2 }), false, 'příliš brzy po předchozí');
  assert.equal(rt.send({ k: 'dead' }, { force: true }), true, 'důležitá zpráva projde i hned');
  t += MIN_SEND_GAP_MS;
  assert.equal(rt.send({ big: 'x'.repeat(MAX_PAYLOAD_CHARS + 1) }), false, 'obrovská zpráva se zahodí');
  assert.equal(rt.send({ k: 's', x: 3 }), true);
  assert.equal(client.made[0].sent.length, 3);
  client.made[0].emit({ k: 's', x: 9 });
  assert.deepEqual(got, [{ k: 's', x: 9 }]);
  rt.close();
  assert.equal(client.removed.length, 1);
  assert.equal(rt.send({ k: 's' }, { force: true }), false, 'po zavření se nic neposílá');
  client.made[0].emit({ k: 'po konci' });
  assert.equal(got.length, 1, 'ani nic nepřijímá');
});

test('kanál v reálném čase: když soukromý kanál nejde, zkusí se obyčejný stejného jména; když nejde nic, ohlásí se chyba', async () => {
  const c1 = fakeRealtimeClient({ denyPrivate: true }); const s1 = [];
  const rt1 = openRealtime({ client: c1, topic: 'mp:x', onStatus: (s) => s1.push(s) });
  await tick(); await tick();
  assert.deepEqual(c1.made.map((c) => c.opts.config.private), [true, false], 'soukromý, pak obyčejný');
  assert.equal(c1.removed.length, 1, 'neúspěšný pokus se uklidí');
  assert.deepEqual(s1, [{ status: 'open', private: false }]);
  assert.ok(rt1.isOpen() && !rt1.isPrivate());
  const c2 = fakeRealtimeClient({ denyAll: true }); const s2 = [];
  const rt2 = openRealtime({ client: c2, topic: 'mp:y', onStatus: (s) => s2.push(s) });
  await tick(); await tick(); await tick();
  assert.deepEqual(s2, [{ status: 'error' }]);
  assert.ok(!rt2.isOpen());
  assert.equal(rt2.send({ a: 1 }, { force: true }), false);
  // jen obyčejný kanál na požádání
  const c3 = fakeRealtimeClient(); openRealtime({ client: c3, topic: 'mp:z', preferPrivate: false, onStatus() {} });
  await tick();
  assert.deepEqual(c3.made.map((c) => c.opts.config.private), [false]);
});

test('kanál v reálném čase: výpadek spojení se ohlásí a po obnovení kanál zase hlásí, že je otevřený', async () => {
  const client = fakeRealtimeClient(); const status = [];
  openRealtime({ client, topic: 'mp:r', onStatus: (s) => status.push(s.status) });
  await tick();
  const ch = client.made[0];
  ch.statusCb('CLOSED'); ch.statusCb('SUBSCRIBED');
  assert.deepEqual(status, ['open', 'down', 'open']);
});

test('kanál v reálném čase: neodpovídající kanál se po lhůtě vzdá (a zkusí další)', async () => {
  const client = fakeRealtimeClient(); const pending = [];
  client.channel = (topic, opts) => { const ch = { opts, handlers: [], on() { return ch; }, subscribe() { return ch; }, send() {} }; pending.push(ch); return ch; };
  client.removeChannel = () => {};
  const timers = []; const status = [];
  openRealtime({ client, topic: 'mp:t', timeoutMs: 500, timers: { setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {} }, onStatus: (s) => status.push(s) });
  assert.equal(pending.length, 1);
  timers[0]();
  assert.equal(pending.length, 2, 'po lhůtě se zkusí obyčejný kanál');
  timers[1]();
  assert.deepEqual(status, [{ status: 'error' }]);
});

test('most: kanál v reálném čase se otevře na žádost hry, zprávy jdou oběma směry a po odpojení se kanál zavře', async () => {
  const { clock, session } = make();
  const sent = [];
  const gameWin = { postMessage: (m) => sent.push(m) };
  const ls = []; const host = { addEventListener: (t, f) => ls.push(f), removeEventListener: (t, f) => ls.splice(ls.indexOf(f), 1), fire: (e) => ls.slice().forEach((f) => f(e)) };
  const opened = []; let handlers = null; const out = []; let closedCh = 0;
  const openChannel = (h) => { opened.push(1); handlers = h; return { send: (p, o) => { out.push([p, o]); return true; }, close: () => { closedCh++; }, track: () => {} }; };
  const bridge = attachMpBridge({ session, getWindow: () => gameWin, onClose() {}, win: host, openChannel });
  const msg = (data) => host.fire({ source: gameWin, data: Object.assign({ source: 'jomarid-game', type: 'mp' }, data) });
  msg({ op: 'rt-send', id: 0, args: { payload: { k: 's' } } });
  assert.equal(out.length, 0, 'před otevřením se nic neposílá');
  msg({ op: 'rt-open', id: 0, args: {} }); msg({ op: 'rt-open', id: 0, args: {} });
  assert.equal(opened.length, 1, 'kanál se otevře jednou');
  msg({ op: 'rt-send', id: 0, args: { payload: { k: 's', x: 1 } } });
  msg({ op: 'rt-send', id: 0, args: { payload: { k: 'dead' }, force: true } });
  msg({ op: 'rt-send', id: 0, args: { payload: { k: 's', x: 2 }, force: 'ano' } });
  assert.deepEqual(out.map((o) => [o[0].k, o[1].force]), [['s', false], ['dead', true], ['s', false]], 'force platí jen s hodnotou true');
  handlers.onMessage({ k: 's', x: 5 }); handlers.onStatus({ status: 'open', private: true }); handlers.onPresence({ a: 1 });
  const ev = (name) => sent.find((m) => m.type === 'mp-event' && m.event === name);
  assert.deepEqual(ev('rt').data.p, { k: 's', x: 5 });
  assert.deepEqual({ status: ev('rt-status').data.status, private: ev('rt-status').data.private }, { status: 'open', private: true });
  assert.deepEqual(ev('rt-presence').data.state, { a: 1 });
  assert.equal(typeof ev('rt').data.offset, 'number', 'k události patří i posun času serveru');
  msg({ op: 'rt-close', id: 0 });
  assert.equal(closedCh, 1);
  msg({ op: 'rt-send', id: 0, args: { payload: { k: 's' } } });
  assert.equal(out.length, 3, 'po zavření se neposílá');
  msg({ op: 'rt-open', id: 0, args: {} }); bridge.dispose();
  assert.equal(closedCh, 2, 'po odpojení mostu se kanál zavře');
  // bez kanálu (appka ho nedodá) hra dostane chybu místo ticha
  const sent2 = []; const w2 = { postMessage: (m) => sent2.push(m) };
  const b2 = attachMpBridge({ session, getWindow: () => w2, onClose() {}, win: host });
  host.fire({ source: w2, data: { source: 'jomarid-game', type: 'mp', op: 'rt-open', id: 0, args: {} } });
  assert.equal(sent2.find((m) => m.event === 'rt-status').data.status, 'error');
  b2.dispose(); session.stop(); await clock.advance(1);
});

test('rozhraní hry: rt.open, rt.send, rt.track a rt.close posílají žádosti, události rt a rt-status dorazí po listen()', async () => {
  const posts = []; const listeners = [];
  const sandbox = { setTimeout, clearTimeout, console, Date, JSON, Promise };
  sandbox.window = sandbox; sandbox.parent = { postMessage: (m) => posts.push(m) };
  sandbox.window.parent = sandbox.parent;
  sandbox.addEventListener = (t, f) => listeners.push(f);
  vm.createContext(sandbox);
  new vm.Script(buildMpPrelude({ match: 'm', slot: 1 })).runInContext(sandbox);
  const MP = sandbox.jomaridMP;
  MP.rt.open(); MP.rt.send({ a: 1 }); MP.rt.send({ b: 2 }, { force: true }); MP.rt.track({ x: 1 }); MP.rt.close();
  assert.deepEqual(posts.map((p) => [p.op, p.args && p.args.force]), [['rt-open', undefined], ['rt-send', false], ['rt-send', true], ['rt-track', undefined], ['rt-close', undefined]]);
  assert.ok(posts.every((p) => p.source === 'jomarid-game' && p.type === 'mp' && p.id === 0));
  const got = [];
  MP.on('rt', (d) => got.push(d.p)).on('rt-status', (d) => got.push(d.status));
  const fire = (event, data) => listeners.forEach((f) => f({ source: sandbox.parent, data: { source: 'jomarid-host', type: 'mp-event', event, data } }));
  fire('rt-status', { status: 'open', offset: 5 });
  assert.deepEqual(got, [], 'před listen() se události zdrží');
  MP.listen();
  assert.deepEqual(got, ['open']);
  fire('rt', { p: { k: 's' }, offset: 6 });
  assert.deepEqual(got, ['open', { k: 's' }]);
  assert.equal(MP.serverNow() - Date.now() >= 5 && MP.serverNow() - Date.now() <= 8, true, 'posun času se bere z každé události');
});

test('sdílená aréna: je jen u Polygon arény, odměna za kolo sedí na databázi (mp_limits) a init pro hru nese jen účet', () => {
  assert.equal(hasArena('polygonarena'), true);
  for (const id of Object.keys(MP_GAMES)) if (id !== 'polygonarena') assert.equal(hasArena(id), false, id);
  assert.equal(hasArena('neexistuje'), false);
  assert.equal(MP_GAMES.polygonarena.kind, 'arena');
  assert.equal(MP_GAMES.polygonarena.arena.reward, Number(/'arena_reward', (\d+)/.exec(sql)[1]), 'odměna za vyhrané kolo je v databázi stejná');
  assert.equal(hasOnline('polygonarena'), false, 'aréna nejde přes zápasy');
  const init = initForArena({ id: 'u1', name: 'Anna' });
  assert.deepEqual(init, { arena: true, match: null, game: 'polygonarena', mode: 'arena', params: {}, seed: 0, slot: 0, kind: 'arena', team: false, reward: 0, target: null, inc: 0, me: { id: 'u1', name: 'Anna' }, opponent: null, offset: 0 });
  const doc = withMultiplayer('<html><head></head><body>67MILUJU</body></html>', 'polygonarena', init, () => 0.5);
  assert.ok(!doc.includes('67MILUJU'), 'cheat kód zmizí i v aréně');
  assert.match(doc, /mp:polygonarena/, 'úložiště arény je čisté a odděleně označené');
  assert.match(doc, /"arena":true/);
});

test('most arény: kanál v reálném čase, žádost o odměnu za kolo s kontrolou hodnot a odchod; zprávy jen z okna hry', async () => {
  const sent = []; const gameWin = { postMessage: (m) => sent.push(m) };
  const ls = []; const host = { addEventListener: (t, f) => ls.push(f), removeEventListener: (t, f) => ls.splice(ls.indexOf(f), 1), fire: (e) => ls.slice().forEach((f) => f(e)), count: () => ls.length };
  const claims = []; let closed = 0, chClosed = 0; const out = [];
  const claim = async (sec, score) => { claims.push([sec, score]); if (sec === 999) throw { code: 'too_soon' }; return { granted: 15, capped: false, balance: 40 }; };
  const openChannel = (h) => ({ send: (p, o) => { out.push([p, o]); return true; }, close: () => { chClosed++; }, track() {}, _h: h });
  const bridge = attachArenaBridge({ getWindow: () => gameWin, onClose: () => { closed++; }, win: host, openChannel, claim });
  const msg = (data, source = gameWin) => host.fire({ source, data: Object.assign({ source: 'jomarid-game', type: 'mp' }, data) });
  msg({ op: 'listen', id: 0 });
  assert.deepEqual(sent.find((m) => m.event === 'sync').data, { offset: 0, arena: true });
  msg({ op: 'claim', id: 5, args: { seconds: 160, score: 1234.7 } });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(claims[0], [160, 1234.7]);
  const ok = sent.find((m) => m.type === 'mp-reply' && m.id === 5);
  assert.ok(ok.ok && ok.data.granted === 15);
  msg({ op: 'claim', id: 6, args: { seconds: 999, score: 1 } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sent.find((m) => m.id === 6).error.code, 'too_soon', 'chyba serveru jde hře jako chyba');
  msg({ op: 'claim', id: 7, args: { seconds: -3, score: 1 } });
  msg({ op: 'claim', id: 8, args: { seconds: 'x' } });
  assert.equal(sent.find((m) => m.id === 7).error.code, 'invalid_value');
  assert.equal(sent.find((m) => m.id === 8).error.code, 'invalid_value');
  assert.equal(claims.length, 2, 'neplatné hodnoty na server nejdou');
  msg({ op: 'move', id: 9, args: { payload: 1 } });
  assert.equal(sent.find((m) => m.id === 9).error.code, 'unknown_op', 'v aréně nejsou tahy ani zápas');
  msg({ op: 'rt-open', id: 0, args: {} }); msg({ op: 'rt-send', id: 0, args: { payload: { k: 's' }, force: true } });
  assert.deepEqual(out, [[{ k: 's' }, { force: true }]]);
  msg({ op: 'rt-send', id: 0, args: { payload: { k: 'x' } } }, { postMessage() {} });
  assert.equal(out.length, 1, 'cizí okno nic neodešle');
  msg({ op: 'close', id: 0 });
  assert.equal(closed, 1);
  bridge.dispose();
  assert.equal(chClosed, 1, 'po odpojení se kanál zavře'); assert.equal(host.count(), 0);
});

// ---------- zapojení do appky ----------
test('Games.jsx: zprávy ze hry se bez spuštěné vlastní hry nepřijímají (online hra nesmí psát do uloženého postupu ani žádat o Coiny jako sólová)', () => {
  const g = read('pages', 'Games.jsx');
  assert.match(g, /if \(!iframeRef\.current \|\| event\.source !== iframeRef\.current\.contentWindow\) return;/);
});

// ---------- vstup do online hry z menu hry ----------
// Skript vložený do sólové hry spustíme s falešným oknem: ptá se appky, jestli smí ukázat tlačítko; ukáže ho jen na pokyn appky (jen z rodičovského okna);
// klik na prvek s data-jomarid-online pošle appce zprávu a hra ho dál nezpracuje.
function runEntry(gameId = 'chess') {
  const parent = { posted: [], postMessage(m) { this.posted.push(JSON.parse(JSON.stringify(m))); } };   // zprávy z jiného kontextu (vm) se porovnávají jako obyčejné objekty
  const classes = new Set();
  const win = { parent, handlers: {}, addEventListener(t, f) { this.handlers[t] = f; } };
  const doc = { handlers: {}, documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } }, addEventListener(t, f, cap) { this.handlers[t] = { f, cap }; } };
  vm.runInNewContext(buildOnlineEntry(gameId), { window: win, document: doc, JSON });
  const hostMsg = (data, source = parent) => win.handlers.message({ data, source });
  const click = (match = true) => {
    const ev = { target: { closest: (sel) => (match && sel === '[data-jomarid-online]' ? { id: 'btn' } : null) }, prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; } };
    doc.handlers.click.f(ev);
    return ev;
  };
  return { parent, classes, doc, hostMsg, click };
}

test('vstup do online hry: po načtení se hra zeptá appky; tlačítko se ukáže až na pokyn appky a jen z rodičovského okna', () => {
  const r = runEntry('hannibal');
  assert.deepEqual(r.parent.posted, [{ source: 'jomarid-game', type: 'online-ask', game: 'hannibal' }]);
  assert.equal(r.classes.has('jomarid-online'), false, 'bez pokynu se nic neukazuje');
  r.hostMsg({ source: 'jomarid-host', type: 'online', available: true }, { postMessage() {} });
  assert.equal(r.classes.has('jomarid-online'), false, 'zpráva z cizího okna se ignoruje');
  r.hostMsg({ source: 'jine', type: 'online', available: true });
  r.hostMsg({ source: 'jomarid-host', type: 'online', available: 'true' });
  assert.equal(r.classes.has('jomarid-online'), false, 'jen přesné true, jen od appky');
  r.hostMsg(onlineMessage(true));
  assert.equal(r.classes.has('jomarid-online'), true);
  r.hostMsg(onlineMessage(false));
  assert.equal(r.classes.has('jomarid-online'), false, 'appka může vstup zase vypnout (třeba bez spojení)');
  r.doc.handlers.DOMContentLoaded.f();
  assert.equal(r.parent.posted.filter((m) => m.type === 'online-ask').length, 2, 'dotaz se zopakuje po načtení stránky');
});

test('vstup do online hry: klik na tlačítko pošle appce zprávu a hra ho dál nezpracuje, bez povolení nedělá nic', () => {
  const r = runEntry('rocket');
  assert.equal(r.doc.handlers.click.cap, true, 'poslouchá ve fázi zachytávání, ať hra klik nevyřídí první');
  let ev = r.click();
  assert.equal(ev.prevented + ev.stopped, 0, 'schované tlačítko nic nedělá');
  assert.equal(r.parent.posted.filter((m) => m.type === 'online').length, 0);
  r.hostMsg(onlineMessage(true));
  ev = r.click();
  assert.equal(ev.prevented, 1); assert.equal(ev.stopped, 1);
  assert.deepEqual(r.parent.posted.filter((m) => m.type === 'online'), [{ source: 'jomarid-game', type: 'online', game: 'rocket' }]);
  ev = r.click(false);
  assert.equal(ev.prevented, 0, 'klik jinam hra zpracuje sama');
  assert.equal(r.parent.posted.filter((m) => m.type === 'online').length, 1);
});

test('vstup do online hry: skript je bez diakritiky, název hry se do něj vloží bezpečně a vloží se na začátek <head>', () => {
  const code = buildOnlineEntry('a"b</script>$&');
  assert.doesNotMatch(code, /[^\x00-\x7f]/, 'bez diakritiky (vkládá se do dokumentu hry)');
  assert.doesNotMatch(code, /<\/script>/i);
  assert.doesNotThrow(() => new vm.Script(code));
  const out = withOnlineEntry('<!DOCTYPE html><html><head><title>x</title></head><body></body></html>', 'chess');
  assert.match(out, /<head><script>\(function \(\) \{\n  var GAME = "chess";/);
  assert.ok(out.endsWith('<title>x</title></head><body></body></html>'));
  assert.deepEqual(onlineMessage(true), { source: 'jomarid-host', type: 'online', available: true });
  assert.equal(onlineMessage('ano').available, false);
});

test('každá hra s online režimem má ve svém menu tlačítko s data-jomarid-online a styl, který ho mimo appku schová', () => {
  const FILES = {
    chess: ['gameContent/chess/ui.js', 'gameContent/chess/style.css'],
    koulovikamosi: ['gameContent/koulovi/index.html', 'gameContent/koulovi/style.css'],
    cityclicker: ['gameContent/cityClicker/index.html'],
    warroom: ['gameContent/warroom/index.html'],
    hannibal: ['gameContent/hannibal/index.html'],
    rocket: ['gameContent/rocket/index.html'],
    polygonarena: ['gameContent/polygonArena/index.html', 'gameContent/polygonArena/style.css'],
    onlinegames: ['gameContent/onlineGames/index.html', 'gameContent/onlineGames/style.css'],
  };
  assert.deepEqual(Object.keys(FILES).sort(), Object.keys(MP_GAMES).filter((id) => MP_GAMES[id].ready).sort());
  for (const [game, files] of Object.entries(FILES)) {
    const text = files.map((f) => read(...f.split('/'))).join('\n');
    assert.match(text, /data-jomarid-online/, `${game}: tlačítko v menu`);
    assert.match(text, /html:not\(\.jomarid-online\) \[data-jomarid-online\]\s*\{\s*display:\s*none\s*!important/, `${game}: bez povolení appky je schované`);
  }
});

test('Games.jsx: hra spuštěná z appky dostane skript vstupu, zprávy online se berou jen z jejího iframu a zápas nebo aréna sólovou hru zavře', () => {
  const g = read('pages', 'Games.jsx');
  assert.match(g, /withOnlineEntry\(withStorageShim\(src, game\.id, sync \? sync\.snapshot\(\)\.map : \{\}\), game\.id\)/);
  assert.match(g, /type === 'online-ask'\) \{\s*postOnline\(\);/);
  assert.match(g, /type === 'online'\) \{\s*if \(mpAvailRef\.current\.state === 'ready'\) \{ setMpMode\(typeof event\.data\.mode === 'string' \? event\.data\.mode : null\); setMpLobby\(true\); \}/);
  assert.match(g, /const handleMpMatch = useCallback\(\(m\) => \{ setMpAuto\(null\); setMpLobby\(false\); handleCloseGame\(\); setMpMatch\(m\); \}, \[handleCloseGame\]\);/);
  assert.match(g, /const handleMpArena = useCallback\(\(\) => \{ setMpAuto\(null\); setMpLobby\(false\); handleCloseGame\(\); setMpArena\(true\); \}, \[handleCloseGame\]\);/);
  assert.match(g, /setMpMatch\(null\); setMpLobby\(true\); \}\}/, '„Hrát znovu“ otevře okno a rovnou hledá');
  assert.match(g, /<MpResume game=\{game\}/, 'na stránce hry zbyl jen pruh s rozehraným zápasem');
  assert.doesNotMatch(g, /<MpSection/, 'hledání soupeře není na stránce hry, ale v okně nad hrou');
});
