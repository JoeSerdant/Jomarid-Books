// Testy online partie šachů (chess/online.js): tahy přes server, přehrání historie, hodiny ze serveru, konec partie a to, co online partie nemá.
//   node --test src/gameContent/chess/tests/online.test.mjs   (spouští se i v npm run test:chess)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, plain } from './load.mjs';

const get = loadGame();
const OnlineSession = get('OnlineSession');
const coord = get('moveToCoord');
const findByCoord = get('findMoveByCoord');
const E = get('ChessEngine');

const flush = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };

// Falešné rozhraní zápasu: to, co hře v prohlížeči dává window.jomaridMP.
class FakeNet {
  constructor({ slot = 1, opponent = 'Soupeř', tc = '5+3' } = {}) {
    this.init = { slot, opponent: { id: 'o', name: opponent }, params: { tc }, game: 'chess', mode: 'duel' };
    this.handlers = {}; this.timeline = []; this.listening = false; this.closed = 0; this.moveError = null;
  }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; }
  listen() { this.listening = true; }
  emit(ev, data) { for (const f of this.handlers[ev] || []) f(data); }
  move(payload) { this.timeline.push(['move', payload.c]); return this.moveError ? Promise.reject(this.moveError) : Promise.resolve({ ok: true, seq: this.timeline.filter((x) => x[0] === 'move').length }); }
  report(outcome, reason) { this.timeline.push(['report', outcome, reason]); return Promise.resolve({}); }
  resign() { this.timeline.push(['resign']); return Promise.resolve({}); }
  close() { this.closed += 1; }
  serverNow() { return Date.now(); }
}

const view = (o = {}) => Object.assign({ id: 'm1', slot: 1, status: 'active', turn: 1, move_count: 0, bank: [300, 300], turn_started: Date.now(), winner: null, reason: null }, o);
const recs = (coords, firstSlot = 1) => coords.map((c, i) => ({ seq: i + 1, p: i % 2 === 0 ? firstSlot : 3 - firstSlot, payload: { c }, end: true, mine: false, replay: true }));

function start(opts = {}) {
  const net = new FakeNet(opts);
  const s = new OnlineSession({ net });
  const events = [];
  s.onEvent = (type, data) => events.push([type, data]);
  s.start();
  return { net, s, events };
}

// Tah hráče z hlediska UI: najde legální tah podle souřadnic a zahraje ho.
const play = (s, c) => { const m = findByCoord(s.state, c); assert.ok(m, 'legální tah ' + c); return s.playerMove(m); };

describe('začátek online partie', () => {
  test('bílý (místo 1) táhne první, černý (místo 2) čeká; hra se hlásí serveru přes listen()', () => {
    const w = start({ slot: 1 });
    assert.equal(w.net.listening, true);
    assert.equal(w.s.playerColor, 'w');
    assert.equal(w.s.isPlayerTurn, false, 'dokud nepřišla historie, netáhne se');
    w.net.emit('sync', { match: view(), moves: [], outcome: null });
    assert.equal(w.s.isPlayerTurn, true);
    const b = start({ slot: 2 });
    b.net.emit('sync', { match: view({ slot: 2 }), moves: [], outcome: null });
    assert.equal(b.s.playerColor, 'b');
    assert.equal(b.s.isPlayerTurn, false);
    assert.equal(b.s.bot.name, 'Soupeř');
  });

  test('jméno soupeře je v pseudo-botovi, který používá rozhraní (jméno, avatar)', () => {
    const { s } = start({ opponent: 'Marie' });
    assert.equal(s.bot.name, 'Marie');
    assert.equal(s.bot.key, 'online');
    assert.ok(s.bot.emoji && s.bot.colorSoft);
  });

  test('co online partie nemá: hodnocení, nápověda, vrácení tahu, nabídka remízy, cheaty', async () => {
    const { s } = start();
    s.net.emit('sync', { match: view(), moves: [], outcome: null });
    assert.equal(s.online, true);
    assert.equal(s.rated, false);
    assert.equal(s.canUndo, false);
    assert.equal(s.undo(), false);
    assert.equal(await s.requestHint(), null);
    assert.deepEqual(plain(await s.offerDraw()), { verdict: 'blocked' });
    assert.equal(s.cheatWin(), false);
    assert.equal(s.cheatDraw(), false);
    assert.equal(s.setAutopilot(true), false);
    assert.equal(s.setBlindBot(true), false);
    assert.equal(s.serialize(), null);
    assert.equal(s.over, false);
  });
});

describe('tahy', () => {
  test('vlastní tah se zahraje na šachovnici a pošle serveru jako {c: souřadnice}', async () => {
    const { s, net } = start();
    net.emit('sync', { match: view(), moves: [], outcome: null });
    assert.equal(play(s, 'e2e4'), true);
    await settle();
    assert.deepEqual(plain(net.timeline), [['move', 'e2e4']]);
    assert.equal(s.moves.length, 1);
    assert.equal(s.turn, 'b');
    assert.equal(s.isPlayerTurn, false);
  });

  test('tah soupeře ze serveru se zahraje s událostí move (byBot) a hráč je na tahu', () => {
    const { s, net, events } = start({ slot: 2 });
    net.emit('sync', { match: view({ slot: 2, turn: 1 }), moves: [], outcome: null });
    net.emit('moves', { moves: [{ seq: 1, p: 1, payload: { c: 'e2e4' }, end: true, mine: false, replay: false }] });
    assert.equal(s.moves.length, 1);
    assert.equal(s.isPlayerTurn, true);
    const mv = events.find((e) => e[0] === 'move');
    assert.ok(mv && mv[1].byBot === true && mv[1].rec.coord === 'e2e4');
  });

  test('vlastní tah vrácený ze serveru (stejné číslo tahu) se nehraje podruhé', async () => {
    const { s, net } = start();
    net.emit('sync', { match: view(), moves: [], outcome: null });
    play(s, 'd2d4');
    net.emit('moves', { moves: [{ seq: 1, p: 1, payload: { c: 'd2d4' }, end: true, mine: true, replay: false }] });
    await settle();
    assert.equal(s.moves.length, 1);
    assert.equal(net.timeline.filter((x) => x[0] === 'move').length, 1);
  });

  test('tah, který neodpovídá pravidlům, se nepřijme a hra hlásí problém', () => {
    const { s, net, events } = start({ slot: 2 });
    net.emit('sync', { match: view({ slot: 2 }), moves: [], outcome: null });
    net.emit('moves', { moves: [{ seq: 1, p: 1, payload: { c: 'e2e5' }, end: true }] });
    assert.equal(s.moves.length, 0);
    assert.ok(events.some((e) => e[0] === 'problem'));
  });

  test('tah od špatného hráče (táhl bílý dvakrát) se nepřijme', () => {
    const { s, net, events } = start({ slot: 1 });
    net.emit('sync', { match: view(), moves: [], outcome: null });
    play(s, 'e2e4');
    net.emit('moves', { moves: [{ seq: 2, p: 1, payload: { c: 'e7e5' }, end: true }] });
    assert.equal(s.moves.length, 1);
    assert.ok(events.some((e) => e[0] === 'problem'));
  });

  test('tah s přeskočeným číslem se nepřijme (dotáhne se ve správném pořadí)', () => {
    const { s, net } = start({ slot: 2 });
    net.emit('sync', { match: view({ slot: 2 }), moves: [], outcome: null });
    net.emit('moves', { moves: [{ seq: 2, p: 2, payload: { c: 'e7e5' }, end: true }] });
    assert.equal(s.moves.length, 0);
  });

  test('živý tah dřív než historie se zahodí (přijde znovu v historii)', () => {
    const { s, net } = start({ slot: 2 });
    net.emit('moves', { moves: [{ seq: 1, p: 1, payload: { c: 'e2e4' }, end: true }] });
    assert.equal(s.moves.length, 0);
    net.emit('sync', { match: view({ slot: 2 }), moves: recs(['e2e4']), outcome: null });
    assert.equal(s.moves.length, 1);
  });

  test('tahy se na server posílají po jednom v pořadí, i když další přijde dřív, než předchozí potvrdí server', async () => {
    const { s, net } = start();
    net.emit('sync', { match: view(), moves: [], outcome: null });
    let release;
    const slow = new Promise((r) => { release = r; });
    let first = true;
    net.move = (payload) => { net.timeline.push(['move', payload.c]); if (first) { first = false; return slow.then(() => ({ ok: true })); } return Promise.resolve({ ok: true }); };
    play(s, 'e2e4');
    net.emit('moves', { moves: [{ seq: 2, p: 2, payload: { c: 'e7e5' }, end: true }] });
    play(s, 'g1f3');
    await settle();
    assert.deepEqual(plain(net.timeline), [['move', 'e2e4']], 'druhý tah čeká, dokud první nepotvrdí server');
    release();
    await settle();
    assert.deepEqual(plain(net.timeline), [['move', 'e2e4'], ['move', 'g1f3']]);
  });

  test('server tah odmítl (pozdě, vypršel čas): hra to hlásí a dál funguje', async () => {
    const { s, net, events } = start();
    net.emit('sync', { match: view(), moves: [], outcome: null });
    net.moveError = { code: 'timeout' };
    play(s, 'e2e4');
    await settle();
    const prob = events.find((e) => e[0] === 'problem');
    assert.ok(prob && /čas/.test(prob[1].text));
    net.moveError = null;
    net.emit('moves', { moves: [{ seq: 2, p: 2, payload: { c: 'e7e5' }, end: true }] });
    assert.equal(s.moves.length, 2);
  });
});

describe('historie při obnovení stránky', () => {
  test('uložené tahy se přehrají bez událostí a zvuků, partie pokračuje', () => {
    const { s, net, events } = start({ slot: 1 });
    net.emit('sync', { match: view({ turn: 1, move_count: 4 }), moves: recs(['e2e4', 'e7e5', 'g1f3', 'b8c6']), outcome: null });
    assert.equal(s.moves.length, 4);
    assert.equal(events.filter((e) => e[0] === 'move').length, 0);
    assert.equal(s.isPlayerTurn, true);
    assert.equal(s.moves[2].san, 'Nf3');
    assert.equal(s.over, false);
  });

  test('historie, která skončila matem, partii ukončí a výsledek ohlásí serveru', async () => {
    const { s, net } = start({ slot: 2 });
    net.emit('sync', { match: view({ slot: 2, turn: 1, move_count: 4 }), moves: recs(['f2f3', 'e7e5', 'g2g4', 'd8h4']), outcome: null });
    await settle();
    assert.equal(s.over, true);
    assert.deepEqual(plain(s.result), { result: 'win', reason: 'checkmate' });
    assert.deepEqual(plain(net.timeline), [['report', 'win', 'checkmate']]);
  });

  test('zápas, který už server uzavřel, se jen zobrazí (nic se znovu nehlásí)', async () => {
    const { s, net } = start({ slot: 1 });
    net.emit('sync', { match: view({ status: 'finished', winner: 2, slot: 1, reason: 'timeout', move_count: 6 }), moves: recs(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6']), outcome: 'loss' });
    await settle();
    assert.equal(s.over, true);
    assert.deepEqual(plain(s.result), { result: 'loss', reason: 'timeout' });
    assert.deepEqual(plain(net.timeline), []);
    assert.equal(s.waitingForServer, false);
  });
});

describe('konec partie', () => {
  test('mat: tah jde na server dřív než hlášení výsledku', async () => {
    const { s, net } = start({ slot: 2 });
    net.emit('sync', { match: view({ slot: 2, turn: 1 }), moves: [], outcome: null });
    net.emit('moves', { moves: [{ seq: 1, p: 1, payload: { c: 'f2f3' }, end: true }] });
    play(s, 'e7e5');
    net.emit('moves', { moves: [{ seq: 3, p: 1, payload: { c: 'g2g4' }, end: true }] });
    play(s, 'd8h4');
    await settle();
    assert.equal(s.over, true);
    assert.deepEqual(plain(s.result), { result: 'win', reason: 'checkmate' });
    assert.deepEqual(plain(net.timeline), [['move', 'e7e5'], ['move', 'd8h4'], ['report', 'win', 'checkmate']]);
    assert.equal(s.waitingForServer, true, 'čeká se na potvrzení výsledku od soupeře a serveru');
  });

  test('mat na straně poraženého: prohra se ohlásí', async () => {
    const { s, net } = start({ slot: 1 });
    net.emit('sync', { match: view(), moves: [], outcome: null });
    play(s, 'f2f3');
    net.emit('moves', { moves: [{ seq: 2, p: 2, payload: { c: 'e7e5' }, end: true }] });
    play(s, 'g2g4');
    net.emit('moves', { moves: [{ seq: 4, p: 2, payload: { c: 'd8h4' }, end: true }] });
    await settle();
    assert.deepEqual(plain(s.result), { result: 'loss', reason: 'checkmate' });
    assert.deepEqual(plain(net.timeline.filter((x) => x[0] === 'report')), [['report', 'loss', 'checkmate']]);
  });

  test('vzdání se ohlásí serveru jako vzdání, ne jako hlášení výsledku', async () => {
    const { s, net } = start();
    net.emit('sync', { match: view(), moves: [], outcome: null });
    s.resign();
    await settle();
    assert.deepEqual(plain(net.timeline), [['resign']]);
    assert.deepEqual(plain(s.result), { result: 'loss', reason: 'resign' });
    s.resign();
    await settle();
    assert.equal(net.timeline.length, 1, 'podruhé už ne');
  });

  test('konec od serveru (vypršel čas) se převezme a nic se neposílá zpět', async () => {
    const { s, net } = start({ slot: 1 });
    net.emit('sync', { match: view(), moves: [], outcome: null });
    net.emit('end', { match: view({ status: 'finished', winner: 1, slot: 1, reason: 'timeout' }), outcome: 'win' });
    await settle();
    assert.deepEqual(plain(s.result), { result: 'win', reason: 'timeout' });
    assert.deepEqual(plain(net.timeline), []);
  });

  test('soupeř vzdal: výhra, důvod resign', async () => {
    const { s, net } = start({ slot: 1 });
    net.emit('sync', { match: view(), moves: [], outcome: null });
    net.emit('end', { match: view({ status: 'finished', winner: 1, slot: 1, reason: 'resign' }), outcome: 'win' });
    assert.deepEqual(plain(s.result), { result: 'win', reason: 'resign' });
    await settle();
    assert.equal(net.timeline.length, 0);
  });

  test('zrušený zápas (void) se v partii ukáže jako konec bez výhry a bez hlášení', async () => {
    const { s, net } = start();
    net.emit('sync', { match: view(), moves: [], outcome: null });
    net.emit('end', { match: view({ status: 'void', reason: 'dispute' }), outcome: 'void' });
    assert.equal(s.over, true);
    assert.equal(s.result.result, 'draw');
    assert.equal(s.result.reason, 'dispute');
    await settle();
    assert.equal(net.timeline.length, 0);
  });

  test('po lokálním konci server výsledek potvrdí: čekání skončí a výsledek zůstane', async () => {
    const { s, net } = start({ slot: 1 });
    net.emit('sync', { match: view(), moves: [], outcome: null });
    s.resign();
    await settle();
    assert.equal(s.waitingForServer, true);
    net.emit('end', { match: view({ status: 'finished', winner: 2, slot: 1, reason: 'resign' }), outcome: 'loss' });
    assert.equal(s.waitingForServer, false);
    assert.deepEqual(plain(s.result), { result: 'loss', reason: 'resign' });
  });
});

describe('hodiny ze serveru', () => {
  test('zbývající čas a běžící strana se berou z odpovědi serveru', () => {
    const { s, net } = start({ slot: 1, tc: '5+3' });
    assert.equal(s.clock.on, true);
    net.emit('sync', { match: view(), moves: [], outcome: null });
    assert.equal(s.clock.running, null, 'před prvním tahem hodiny neběží');
    assert.deepEqual(plain(s.liveTimes()), { w: 300000, b: 300000 });
    net.emit('match', { match: view({ turn: 2, move_count: 1, bank: [303, 300], turn_started: Date.now() - 10000 }) });
    assert.equal(s.clock.running, 'b');
    const t = s.liveTimes();
    assert.equal(t.w, 303000);
    assert.ok(t.b > 289000 && t.b < 290500, `černému běží čas: ${t.b}`);
  });

  test('rozdíl hodin zařízení a serveru se přepočítá', () => {
    const net = new FakeNet({ slot: 1 });
    net.serverNow = () => Date.now() + 60000; // server jde o minutu napřed
    const s = new OnlineSession({ net });
    s.start();
    net.emit('sync', { match: view(), moves: [], outcome: null });
    net.emit('match', { match: view({ turn: 2, move_count: 1, bank: [300, 300], turn_started: Date.now() + 60000 - 5000 }) });
    const t = s.liveTimes();
    assert.ok(t.b > 294000 && t.b < 295500, `po přepočtu zbývá cca 295 s: ${t.b}`);
  });

  test('tick() partii nikdy sám neukončí, i když hodiny dojdou: rozhoduje server', () => {
    const { s, net } = start({ slot: 1 });
    net.emit('sync', { match: view(), moves: [], outcome: null });
    net.emit('match', { match: view({ turn: 2, move_count: 1, bank: [300, 0.2], turn_started: Date.now() - 5000 }) });
    assert.equal(s.liveTimes().b, 0);
    assert.equal(s.tick(), false);
    assert.equal(s.over, false);
  });

  test('hodiny po konci zápasu stojí', () => {
    const { s, net } = start({ slot: 1 });
    net.emit('sync', { match: view(), moves: [], outcome: null });
    net.emit('match', { match: view({ status: 'finished', turn: null, move_count: 5, winner: 1, bank: [250, 100] }) });
    assert.equal(s.clock.running, null);
  });
});

describe('rozhraní', () => {
  test('destroy() nic nerozbije a start() podruhé se nepřihlásí k odběru znovu', () => {
    const { s, net } = start();
    const n = (net.handlers.moves || []).length;
    s.start();
    assert.equal((net.handlers.moves || []).length, n);
    s.destroy();
  });
});
