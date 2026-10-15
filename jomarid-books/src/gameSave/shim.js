// Náhrada localStorage uvnitř hry. Hra běží v iframu (srcDoc) ze stejného původu jako appka, takže by jinak zapisovala do localStorage
// prohlížeče. Appka proto do dokumentu hry, ještě před jejími skripty, vloží krátký skript: metody Storage (getItem, setItem, removeItem,
// clear, key, length) pro localStorage tohohle okna pracují nad pamětí, kterou předvyplní uloženým postupem ze serveru, a každou změnu
// pošlou appce zprávou {source: 'jomarid-game', type: 'storage', game, op, key, value}. Předvyplnění se bere z window.__jomaridGameSave.read(hra)
// v okně appky (aktuální postup i s neodeslanými změnami), a když tam není, z postupu vloženého do dokumentu. Skutečný localStorage prohlížeče hra nevidí
// ani nezapisuje; sessionStorage a ostatní objekty typu Storage zůstávají beze změny (pozná se podle toho, na čem se metoda volá).
// Skript je schválně v ES5 a v jedné funkci, ať nic nepřidává do globálního prostoru hry.

const SHIM_TEMPLATE = `(function () {
  var GAME = __GAME__;
  var seed = __SEED__;
  // Hra, která se v iframu sama znovu načte (restart, reset postupu), by z vloženého dokumentu dostala postup z doby otevření. Appka proto
  // drží aktuální postup na window.__jomaridGameSave a skript si ho při každém načtení vezme odtamtud (stejný původ, takže synchronně).
  try {
    var host = window.parent;
    if (host && host !== window && host.__jomaridGameSave && typeof host.__jomaridGameSave.read === 'function') {
      var live = host.__jomaridGameSave.read(GAME);
      if (live && typeof live === 'object') seed = live;
    }
  } catch (e) {}
  var mem = Object.create(null);
  for (var k in seed) { if (Object.prototype.hasOwnProperty.call(seed, k) && typeof seed[k] === 'string') mem[k] = seed[k]; }
  var proto = window.Storage && window.Storage.prototype;
  var ls = null;
  try { ls = window.localStorage; } catch (e) { ls = null; }
  if (!proto || !ls) return;
  function post(msg) {
    try { msg.source = 'jomarid-game'; msg.type = 'storage'; msg.game = GAME; window.parent.postMessage(msg, '*'); } catch (e) {}
  }
  var orig = { get: proto.getItem, set: proto.setItem, remove: proto.removeItem, clear: proto.clear, key: proto.key };
  var lenDesc = Object.getOwnPropertyDescriptor(proto, 'length');
  proto.getItem = function (k) { if (this !== ls) return orig.get.apply(this, arguments); k = String(k); return k in mem ? mem[k] : null; };
  proto.setItem = function (k, v) { if (this !== ls) return orig.set.apply(this, arguments); k = String(k); v = String(v); mem[k] = v; post({ op: 'set', key: k, value: v }); };
  proto.removeItem = function (k) { if (this !== ls) return orig.remove.apply(this, arguments); k = String(k); if (k in mem) { delete mem[k]; post({ op: 'remove', key: k }); } };
  proto.clear = function () { if (this !== ls) return orig.clear.apply(this, arguments); mem = Object.create(null); post({ op: 'clear' }); };
  proto.key = function (i) { if (this !== ls) return orig.key.apply(this, arguments); var keys = Object.keys(mem); i = Number(i); return i >= 0 && i < keys.length ? keys[i] : null; };
  if (lenDesc && lenDesc.get && lenDesc.configurable) {
    Object.defineProperty(proto, 'length', { configurable: true, enumerable: lenDesc.enumerable, get: function () { return this === ls ? Object.keys(mem).length : lenDesc.get.call(this); } });
  }
})();`;

// Hodnota bezpečná pro vložení do <script> (u postupu jako řetězec s JSON, který si skript rozebere JSON.parse; objektový literál by klíč
// "__proto__" vyložil jinak): znak "<" se zapíše jako \u003c (aby se nedal předčasně ukončit skript ani začít komentář)
// a oddělovače řádků U+2028 a U+2029 se zapíšou výslovně.
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// Text skriptu s předvyplněným postupem (map: {klíč: text}).
export function buildStorageShim(gameId, map) {
  // Nahrazuje se funkcí, ne řetězcem: v postupu může být "$&" a podobné zápisy, které by replace jinak vyložil po svém.
  return SHIM_TEMPLATE.replace('__GAME__', () => scriptJson(gameId)).replace('__SEED__', () => `JSON.parse(${scriptJson(JSON.stringify(map || {}))})`);
}

// Vloží skript na úplný začátek <head> hry (před všechny její skripty). Dokument bez <head> dostane skript za <html>, bez obojího na začátek.
export function withStorageShim(html, gameId, map) {
  const tag = `<script>${buildStorageShim(gameId, map)}</script>`;
  const at = (re) => { const m = re.exec(html); return m ? m.index + m[0].length : -1; };
  const i = at(/<head(?:\s[^>]*)?>/i);
  const j = i >= 0 ? i : at(/<html(?:\s[^>]*)?>/i);
  return j >= 0 ? html.slice(0, j) + tag + html.slice(j) : tag + html;
}
