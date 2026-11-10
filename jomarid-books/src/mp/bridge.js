// Most mezi hrou v iframu a řadičem zápasu (MpSession) v appce. Hra volá window.jomaridMP (viz inject.js), to pošle zprávu
// {source: 'jomarid-game', type: 'mp', op, id, args}; appka ji provede a odpoví {source: 'jomarid-host', type: 'mp-reply', id, ok, data | error}.
// Události zápasu (nové tahy, nový pohled serveru, konec) jdou hře jako {source: 'jomarid-host', type: 'mp-event', event, data}.
// Přijímají se jen zprávy z okna té jedné hry. Co hra pošle, je jen žádost: o pořadí, času i výplatě rozhoduje server.
import { outcomeFor } from './session.js';

const OUTCOMES = new Set(['win', 'loss', 'draw']);
const errOf = (e) => ({ code: (e && e.code) || 'error', message: String((e && e.message) || '') });

// session: MpSession; getWindow: () => okno hry; onClose: hráč v rozhraní hry zvolil odchod; win: okno appky (pro zprávy).
export function attachMpBridge({ session, getWindow, onClose, win }) {
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

  const run = (id, promise) => { Promise.resolve(promise).then((data) => reply(id, true, data === undefined ? null : data), (err) => reply(id, false, errOf(err))); };

  const onMessage = (e) => {
    if (e.source !== getWindow()) return;
    const d = e.data;
    if (!d || d.source !== 'jomarid-game' || d.type !== 'mp') return;
    const args = d.args && typeof d.args === 'object' ? d.args : {};
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
      for (const off of listeners) off();
      if (host) host.removeEventListener('message', onMessage);
    },
  };
}
