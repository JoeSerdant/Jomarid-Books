// Most mezi hrou v iframu a řadičem zápasu (MpSession) v appce. Hra volá window.jomaridMP (viz inject.js), to pošle zprávu
// {source: 'jomarid-game', type: 'mp', op, id, args}; appka ji provede a odpoví {source: 'jomarid-host', type: 'mp-reply', id, ok, data | error}.
// Události zápasu (nové tahy, nový pohled serveru, konec) jdou hře jako {source: 'jomarid-host', type: 'mp-event', event, data}.
// Přijímají se jen zprávy z okna té jedné hry. Co hra pošle, je jen žádost: o pořadí, času i výplatě rozhoduje server.
import { outcomeFor } from './session.js';

const OUTCOMES = new Set(['win', 'loss', 'draw']);
const errOf = (e) => ({ code: (e && e.code) || 'error', message: String((e && e.message) || '') });

// Společná část obou mostů: kanál v reálném čase. Hra o něj požádá (rt-open), pak do něj posílá zprávy (rt-send, rt-track) a dostává zprávy ostatních
// (událost rt), stav kanálu (rt-status) a kdo je v kanálu (rt-presence). handle(op, args) vrací true, když operaci vyřídila.
function createRtRelay({ openChannel, event }) {
  let rt = null;
  return {
    handle(op, args) {
      switch (op) {
        case 'rt-open':
          if (!openChannel) { event('rt-status', { status: 'error' }); return true; }
          if (!rt) {
            rt = openChannel({
              onMessage: (p) => event('rt', { p }),
              onStatus: (s) => event('rt-status', s),
              onPresence: (state) => event('rt-presence', { state }),
            });
          }
          return true;
        case 'rt-send':
          if (rt && args.payload !== undefined) rt.send(args.payload, { force: args.force === true });
          return true;
        case 'rt-track':
          if (rt && args.state && typeof args.state === 'object') rt.track(args.state);
          return true;
        case 'rt-close':
          if (rt) { rt.close(); rt = null; }
          return true;
        default:
          return false;
      }
    },
    dispose() { if (rt) { rt.close(); rt = null; } },
  };
}

// session: MpSession; getWindow: () => okno hry; onClose: hráč v rozhraní hry zvolil odchod; win: okno appky (pro zprávy);
// openChannel(handlers) otevře kanál v reálném čase pro hru (viz realtime.js) a vrátí { send, close, track }; bez něj hra v reálném čase nepojede.
export function attachMpBridge({ session, getWindow, onClose, win, openChannel }) {
  const host = win || (typeof window !== 'undefined' ? window : null);
  const post = (msg) => { const w = getWindow(); if (w) { try { w.postMessage(Object.assign({ source: 'jomarid-host' }, msg), '*'); } catch { /* okno hry už neexistuje */ } } };
  const event = (name, data) => post({ type: 'mp-event', event: name, data: Object.assign({ offset: session.offset }, data) });
  const reply = (id, ok, payload) => post(ok ? { type: 'mp-reply', id, ok: true, data: payload } : { type: 'mp-reply', id, ok: false, error: payload });

  const listeners = [
    session.on('match', (match) => event('match', { match })),
    session.on('moves', (moves) => event('moves', { moves })),
    session.on('end', (match) => event('end', { match, outcome: outcomeFor(match) })),
    session.on('connection', (c) => event('connection', c)),
  ];

  const relay = createRtRelay({ openChannel, event });

  const run = (id, promise) => { Promise.resolve(promise).then((data) => reply(id, true, data === undefined ? null : data), (err) => reply(id, false, errOf(err))); };

  const onMessage = (e) => {
    if (e.source !== getWindow()) return;
    const d = e.data;
    if (!d || d.source !== 'jomarid-game' || d.type !== 'mp') return;
    const args = d.args && typeof d.args === 'object' ? d.args : {};
    if (relay.handle(d.op, args)) return;
    switch (d.op) {
      case 'listen':
        // Hra má obsluhu připravenou: dostane celou historii tahů a aktuální pohled na zápas.
        session.whenSynced().then(() => event('sync', { match: session.match, moves: session.moves.slice(), outcome: outcomeFor(session.match) }));
        break;
      case 'move':
        if (args.payload === undefined) { reply(d.id, false, { code: 'invalid_payload' }); break; }
        run(d.id, session.sendMove(args.payload, { endTurn: args.endTurn !== false }));
        break;
      case 'report':
        if (!OUTCOMES.has(args.outcome)) { reply(d.id, false, { code: 'invalid_outcome' }); break; }
        run(d.id, session.report(args.outcome, typeof args.reason === 'string' ? args.reason.slice(0, 30) : null));
        break;
      case 'resign':
        run(d.id, session.resign());
        break;
      case 'progress': {
        const v = Number(args.value);
        if (!Number.isFinite(v) || v < 0) { reply(d.id, false, { code: 'invalid_value' }); break; }
        run(d.id, session.progress(v));
        break;
      }
      case 'close':
        if (onClose) onClose();
        break;
      default:
        if (d.id) reply(d.id, false, { code: 'unknown_op' });
    }
  };
  if (host) host.addEventListener('message', onMessage);

  return {
    dispose() {
      relay.dispose();
      for (const off of listeners) off();
      if (host) host.removeEventListener('message', onMessage);
    },
  };
}

// Most pro sdílenou arénu (Polygon aréna): žádný zápas ani řadič, jen kanál v reálném čase, žádost o odměnu za vyhrané kolo (claim) a odchod.
// claim(sekundy, skóre) vrací { granted, capped, balance }; o odměně rozhoduje server.
export function attachArenaBridge({ getWindow, onClose, win, openChannel, claim }) {
  const host = win || (typeof window !== 'undefined' ? window : null);
  const post = (msg) => { const w = getWindow(); if (w) { try { w.postMessage(Object.assign({ source: 'jomarid-host' }, msg), '*'); } catch { /* okno hry už neexistuje */ } } };
  const event = (name, data) => post({ type: 'mp-event', event: name, data: Object.assign({ offset: 0 }, data) });
  const reply = (id, ok, payload) => post(ok ? { type: 'mp-reply', id, ok: true, data: payload } : { type: 'mp-reply', id, ok: false, error: payload });
  const relay = createRtRelay({ openChannel, event });
  const run = (id, promise) => { Promise.resolve(promise).then((data) => reply(id, true, data === undefined ? null : data), (err) => reply(id, false, errOf(err))); };

  const onMessage = (e) => {
    if (e.source !== getWindow()) return;
    const d = e.data;
    if (!d || d.source !== 'jomarid-game' || d.type !== 'mp') return;
    const args = d.args && typeof d.args === 'object' ? d.args : {};
    if (relay.handle(d.op, args)) return;
    switch (d.op) {
      case 'listen':
        event('sync', { arena: true });
        break;
      case 'claim': {
        const sec = Number(args.seconds), score = Number(args.score);
        if (!Number.isFinite(sec) || sec < 0 || !claim) { reply(d.id, false, { code: 'invalid_value' }); break; }
        run(d.id, claim(sec, Number.isFinite(score) ? score : 0));
        break;
      }
      case 'close':
        if (onClose) onClose();
        break;
      default:
        if (d.id) reply(d.id, false, { code: 'unknown_op' });
    }
  };
  if (host) host.addEventListener('message', onMessage);

  return {
    dispose() {
      relay.dispose();
      if (host) host.removeEventListener('message', onMessage);
    },
  };
}
