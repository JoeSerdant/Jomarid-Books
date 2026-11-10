// Vstup do online hry z menu samotné hry. Hra má ve svém menu tlačítko (nebo kartu) s atributem data-jomarid-online; ve hře spuštěné z appky
// se tlačítko ukáže a po kliknutí appka otevře okno s hledáním soupeře (src/mp/MpLobbyDialog.jsx). Ve všech ostatních dokumentech (online zápas,
// aréna, hra otevřená mimo appku) tenhle skript není, tlačítko zůstane schované a nic nedělá.
//
// Hra -> appka: {source: 'jomarid-game', type: 'online-ask'} (po načtení: zeptá se, jestli má tlačítko ukázat) a
//               {source: 'jomarid-game', type: 'online'} (hráč kliknul na tlačítko).
// Appka -> hra: {source: 'jomarid-host', type: 'online', available: true|false}. Při true dostane <html> třídu jomarid-online; schovávání tlačítek
// je ve stylech her (html:not(.jomarid-online) [data-jomarid-online] { display: none !important }), takže funguje i u menu, které si hra překresluje.
//
// Skript je schválně v ES5, v jedné funkci a bez diakritiky (vkládá se do dokumentu hry před její skripty).
import { insertAtHead } from '../gameSave/shim.js';

export const ONLINE_ATTR = 'data-jomarid-online';

const ENTRY_TEMPLATE = `(function () {
  var GAME = __GAME__;
  var root = document.documentElement;
  function post(type) {
    try { window.parent.postMessage({ source: 'jomarid-game', type: type, game: GAME }, '*'); } catch (e) {}
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window.parent || !d || d.source !== 'jomarid-host' || d.type !== 'online') return;
    if (d.available === true) root.classList.add('jomarid-online'); else root.classList.remove('jomarid-online');
  });
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-jomarid-online]') : null;
    if (!t || !root.classList.contains('jomarid-online')) return;
    e.preventDefault();
    e.stopPropagation();
    post('online');
  }, true);
  post('online-ask');
  document.addEventListener('DOMContentLoaded', function () { post('online-ask'); });
})();`;

export function buildOnlineEntry(gameId) {
  // Nahrazuje se funkcí, ne řetězcem (v názvu hry by mohlo být "$&")
  return ENTRY_TEMPLATE.replace('__GAME__', () => JSON.stringify(String(gameId)).replace(/</g, '\\u003c'));
}

// Vloží skript na začátek <head> sólové hry.
export function withOnlineEntry(html, gameId) {
  return insertAtHead(html, `<script>${buildOnlineEntry(gameId)}</script>`);
}

// Zpráva pro hru: smí ukázat vstup do online hry?
export const onlineMessage = (available) => ({ source: 'jomarid-host', type: 'online', available: available === true });
