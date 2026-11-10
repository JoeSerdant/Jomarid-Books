// Příprava dokumentu hry pro online zápas. Hra běží v iframu (srcDoc) jako obvykle, jen:
//   1. dostane čisté úložiště v paměti (žádný uložený postup z účtu, nic se nesynchronizuje ani neukládá),
//   2. cheat kódy se nahradí náhodným textem, který nikdo nezná (cheat menu je v online zápase vypnuté ve všech hrách),
//   3. před skripty hry se vloží rozhraní window.jomaridMP, kterým hra mluví se zápasem (tahy, výsledek, události).
// Hra z rozhraní dostane jen to, co potřebuje; síť a odměny řeší appka (bridge.js, db/multiplayer.sql).
import { withStorageShim, scriptJson } from '../gameSave/shim.js';

const CHEAT_CODES = [/67MILUJU/gi, /IMAGINEFLEXITSTVOJIMMENEM/gi];

const randomToken = (rng) => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 14; i++) out += abc[Math.floor(rng() * abc.length)];
  return out;
};

const secureRng = () => {
  try {
    const c = globalThis.crypto;
    if (c && c.getRandomValues) { const a = new Uint32Array(1); return () => { c.getRandomValues(a); return a[0] / 4294967296; }; }
  } catch { /* bez kryptografického generátoru se použije Math.random */ }
  return Math.random;
};

// Nahradí cheat kódy v celém dokumentu (kód je ve hrách vždy jen jako textová konstanta). Každý výskyt dostane jiný náhodný text, takže ani
// porovnání s prvním výskytem nic neodemkne.
export function stripCheatCodes(html, rng = secureRng()) {
  let out = html;
  for (const re of CHEAT_CODES) out = out.replace(re, () => randomToken(rng));
  return out;
}

// Část rt v rozhraní níže je kanál v reálném čase pro rychlé hry: open() ho otevře (stav přijde událostí rt-status), send() pošle zprávu ostatním
// a zprávy ostatních chodí jako událost rt. (Text uvnitř skriptu je jen kód bez komentářů, aby ho kontrola překladů nebrala za český text.)
const PRELUDE = `(function () {
  var INIT = __INIT__;
  var queue = [], handlers = {}, waits = {}, nextId = 0, listening = false, offset = INIT.offset || 0;
  function post(msg) { try { msg.source = 'jomarid-game'; msg.type = 'mp'; window.parent.postMessage(msg, '*'); } catch (e) {} }
  function call(op, args) {
    return new Promise(function (resolve, reject) {
      var id = ++nextId; waits[id] = { resolve: resolve, reject: reject };
      post({ op: op, id: id, args: args });
    });
  }
  function dispatch(d) {
    if (d.data && typeof d.data.offset === 'number') offset = d.data.offset;
    var list = handlers[d.event] || [];
    for (var i = 0; i < list.length; i++) { try { list[i](d.data); } catch (e) { try { console.error(e); } catch (x) {} } }
  }
  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var d = ev.data;
    if (!d || d.source !== 'jomarid-host') return;
    if (d.type === 'mp-reply') {
      var w = waits[d.id]; if (!w) return; delete waits[d.id];
      if (d.ok) w.resolve(d.data); else w.reject(d.error || { code: 'error' });
    } else if (d.type === 'mp-event') {
      if (listening) dispatch(d); else queue.push(d);
    }
  });
  var api = {
    enabled: true,
    init: INIT,
    on: function (event, fn) { (handlers[event] = handlers[event] || []).push(fn); return api; },
    listen: function () {
      if (listening) return;
      listening = true;
      post({ op: 'listen', id: 0 });
      var q = queue; queue = [];
      for (var i = 0; i < q.length; i++) dispatch(q[i]);
    },
    move: function (payload, opts) { return call('move', { payload: payload, endTurn: !(opts && opts.endTurn === false) }); },
    report: function (outcome, reason) { return call('report', { outcome: outcome, reason: reason || null }); },
    resign: function () { return call('resign', {}); },
    progress: function (value) { return call('progress', { value: value }); },
    close: function () { post({ op: 'close', id: 0 }); },
    rt: {
      open: function () { post({ op: 'rt-open', id: 0, args: {} }); },
      send: function (payload, opts) { post({ op: 'rt-send', id: 0, args: { payload: payload, force: !!(opts && opts.force) } }); },
      track: function (state) { post({ op: 'rt-track', id: 0, args: { state: state } }); },
      close: function () { post({ op: 'rt-close', id: 0 }); }
    },
    serverNow: function () { return Date.now() + offset; }
  };
  Object.defineProperty(window, 'jomaridMP', { value: api, writable: false, configurable: false });
  window.__JOMARID_MP = true;
})();`;

// Skript s rozhraním window.jomaridMP; init je to, co hra o zápase ví hned po spuštění (místo, semínko, soupeř, nastavení).
export function buildMpPrelude(init) {
  return PRELUDE.replace('__INIT__', () => scriptJson(init));
}

const insertAtHead = (html, tag) => {
  const at = (re) => { const m = re.exec(html); return m ? m.index + m[0].length : -1; };
  const i = at(/<head(?:\s[^>]*)?>/i);
  const j = i >= 0 ? i : at(/<html(?:\s[^>]*)?>/i);
  return j >= 0 ? html.slice(0, j) + tag + html.slice(j) : tag + html;
};

// Pohled na zápas, který hra dostane při startu (jen to, co se nemění).
export function initForGame(view, offset) {
  return {
    match: view.id, game: view.game, mode: view.mode, params: view.params || {}, seed: Number(view.seed) || 0, slot: view.slot, kind: view.kind,
    team: !!view.team, reward: view.reward, target: view.target ?? null, inc: view.inc ?? 0,
    me: view.me, opponent: { id: view.opponent && view.opponent.id, name: view.opponent && view.opponent.name },
    offset: offset || 0,
  };
}

// Dokument hry pro online zápas. Úložiště dostane jiné označení hry (mp:...), takže ho appka nespojí s uloženým postupem hráče.
export function withMultiplayer(html, gameId, init, rng) {
  const clean = stripCheatCodes(html, rng);
  const withStorage = withStorageShim(clean, `mp:${gameId}`, {});
  return insertAtHead(withStorage, `<script>${buildMpPrelude(init)}</script>`);
}
