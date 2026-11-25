// Hudba na pozadí her. Skladby jsou soubory v src/music (Vite jim dá otisk obsahu a service worker je uloží jako ostatní soubory v /assets/).
// Každá hra má jednu skladbu nebo víc (z víc se při každém spuštění vybere jedna náhodně). Přehrávač (player.js) se vloží do dokumentu hry,
// stáhne soubor jednou, pustí ho ve smyčce potichu a řídí ho appka (tlačítko v liště nad hrou, volba se pamatuje).
import playerSource from './player.js?raw';
import rocket from './rocket.mp3?url';
import warroom from './warroom.mp3?url';
import hannibal from './hannibal.mp3?url';
import city from './city.mp3?url';
import polygon from './polygon.mp3?url';
import chess from './chess.mp3?url';
import katakomby from './katakomby.mp3?url';
import chaos from './chaos.mp3?url';
import koulovi1 from './koulovi-1.mp3?url';
import koulovi2 from './koulovi-2.mp3?url';

export const MUSIC = {
  rocket: { urls: [rocket], volume: 0.2 },
  warroom: { urls: [warroom], volume: 0.2 },
  hannibal: { urls: [hannibal], volume: 0.2 },
  cityclicker: { urls: [city], volume: 0.2 },
  polygonarena: { urls: [polygon], volume: 0.2 },
  chess: { urls: [chess], volume: 0.2 },
  koulovikamosi: { urls: [koulovi1, koulovi2], volume: 0.2 },
  onlinegames: { urls: [katakomby], volume: 0.2 },        // menu a Katakomby (sólo i online)
  'onlinegames/chaos': { urls: [chaos], volume: 0.2 },    // Chaos Aréna
};

// Skladby hry; mode je režim online zápasu (Chaos Aréna má vlastní hudbu).
export const musicFor = (gameId, mode) => MUSIC[`${gameId}/${mode}`] || MUSIC[gameId] || null;

export const musicUrls = (gameId) => Object.entries(MUSIC).filter(([k]) => k === gameId || k.startsWith(`${gameId}/`)).flatMap(([, v]) => v.urls);

// Vloží do dokumentu hry nastavení hudby a přehrávač hned za <head> (nebo na začátek).
export function withMusic(html, cfg) {
  if (!cfg || !cfg.urls || cfg.urls.length === 0 || typeof html !== 'string') return html;
  const tag = `<script>window.JOMARID_MUSIC=${JSON.stringify(cfg).replace(/</g, '\\u003c')};</script><script>${playerSource}</script>`;
  const m = /<head(?:\s[^>]*)?>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length) : tag + html;
}
