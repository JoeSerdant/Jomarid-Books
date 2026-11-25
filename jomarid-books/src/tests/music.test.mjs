// Testy hudby na pozadí her (src/music): každá hra má skladbu, soubory existují, přehrávač je platný skript a do dokumentu se vloží jednou.
//   npm run test:music
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tracks = fs.readFileSync(path.join(SRC, 'music', 'tracks.js'), 'utf8');
const player = fs.readFileSync(path.join(SRC, 'music', 'player.js'), 'utf8');
const games = fs.readFileSync(path.join(SRC, 'pages', 'Games.jsx'), 'utf8');
const gameIds = [...games.matchAll(/\n  \{\n    id: '(\w+)',/g)].map((m) => m[1]);

test('každá hra z Games.jsx má hudbu a všechny skladby jsou soubory v src/music', () => {
  const keys = [...tracks.matchAll(/^\s+'?([\w/]+)'?: \{ urls: \[/gm)].map((m) => m[1]);
  for (const id of gameIds) assert.ok(keys.includes(id), `hra ${id} nemá hudbu`);
  for (const k of keys) assert.ok(gameIds.includes(k.split('/')[0]), `hudba pro neznámou hru ${k}`);
  const files = [...tracks.matchAll(/from '\.\/([\w-]+\.mp3)\?url'/g)].map((m) => m[1]);
  assert.ok(files.length >= 10);
  for (const f of files) assert.ok(fs.statSync(path.join(SRC, 'music', f)).size > 100000, f);
  assert.match(tracks, /koulovikamosi: \{ urls: \[koulovi1, koulovi2\]/, 'Kouloví Kámoši vybírají ze dvou skladeb');
  assert.match(tracks, /'onlinegames\/chaos': \{ urls: \[chaos\]/, 'Chaos Aréna má vlastní skladbu');
});

test('přehrávač je platný skript, skladbu vybírá náhodně a nic nevyhodí ani bez nastavení', () => {
  new vm.Script(player);
  const posted = [];
  const sandbox = { document: { addEventListener() {}, hidden: false }, addEventListener() {}, Math, fetch: () => Promise.reject(new Error('x')), URL, Audio: function () {}, console };
  sandbox.window = sandbox; sandbox.parent = { postMessage: (m) => posted.push(m) }; sandbox.window.parent = sandbox.parent;
  vm.createContext(sandbox);
  vm.runInContext(player, sandbox);                       // bez window.JOMARID_MUSIC nedělá nic
  assert.equal(posted.length, 0);
  sandbox.JOMARID_MUSIC = { urls: ['/a.mp3', '/b.mp3'], volume: 0.2 };
  sandbox.__JOMARID_MUSIC = undefined;
  vm.runInContext(player, sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ source: 'jomarid-game', type: 'music-hello' }], 'po načtení se přihlásí appce');
});

test('rozhraní: tlačítko v liště, přepínač pamatuje volbu a zprávy jdou jen do iframu hry', () => {
  const bar = fs.readFileSync(path.join(SRC, 'components', 'GameBar.jsx'), 'utf8');
  assert.match(bar, /data-testid="game-bar-music"/);
  const hook = fs.readFileSync(path.join(SRC, 'music', 'useMusic.js'), 'utf8');
  assert.match(hook, /const KEY = 'jomarid-music-off';/);
  assert.match(hook, /ev\.source !== w/);
  const mp = fs.readFileSync(path.join(SRC, 'mp', 'MpGameScreen.jsx'), 'utf8');
  assert.match(mp, /withMusic\(withMultiplayer\(src, game\.id, initForGame\(match, session\.offset\)\), musicFor\(game\.id, match\.mode\)\)/);
  assert.match(games, /withMusic\(withOnlineEntry\(withStorageShim\(src, game\.id, sync\.snapshot\(\)\.map\), game\.id\), musicFor\(game\.id\)\)/);
  assert.match(games, /for \(const u of musicUrls\(game\.id\)\)/, 'hudba se stahuje dopředu pro hraní bez internetu');
});
