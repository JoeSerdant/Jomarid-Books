// Warroom: grafická vrstva (karty s emblémy, HUD rámečky, přístroje) a celistvost dokumentu.
//   npm run test:warroom
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = fs.readFileSync(path.join(SRC, 'gameContent', 'warroom.js'), 'utf8');
const html = JSON.parse(file.match(/^export const WARROOM_HTML = (".*");\s*$/s)[1]);
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const game = scripts.find((s) => s.includes('const RAW_SCENARIOS'));

test('dokument: jedno style, skripty se dají přeložit a CSS má vyvážené závorky', () => {
  assert.equal(html.split('<style>').length, 2);
  assert.ok(scripts.length >= 2 && game);
  for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code));
  let depth = 0;
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''")) { if (ch === '{') depth += 1; if (ch === '}') depth -= 1; assert.ok(depth >= 0, 'přebývá }'); }
  assert.equal(depth, 0, 'chybí }');
});

test('grafika: každý štítek scénáře a každá doktrína má ikonu a karty dostávají barvu a číslo operace', () => {
  const tags = [...new Set([...game.matchAll(/tag: '([A-Z -]+)'/g)].map((m) => m[1]))];
  const iconTags = game.match(/const TAG_ICONS = \{([^}]*)\}/)[1];
  for (const t of tags) assert.ok(iconTags.includes(`'${t}'`), 'chybí ikona štítku ' + t);
  const docIds = [...game.slice(game.indexOf('const DOCTRINES')).matchAll(/\{ id: '([a-z_]+)', name:/g)].map((m) => m[1]);
  assert.ok(docIds.length >= 10);
  const iconDocs = game.match(/const DOCTRINE_ICONS = \{([^}]*)\}/)[1];
  for (const d of docIds) assert.ok(new RegExp(`\\b${d}:`).test(iconDocs), 'chybí ikona doktríny ' + d);
  assert.match(game, /card\.style\.setProperty\('--tag', badgeBg\)/);
  assert.match(game, /OP-\$\{String\(scIdx \+ 1\)\.padStart\(2, '0'\)\}/);
  assert.match(game, /DOK-\$\{String\(docIdx \+ 1\)\.padStart\(2, '0'\)\}/);
  // zamčené karty ukazují zámek, ne ikonu scénáře
  assert.match(game, /isUnlocked \? \(TAG_ICONS\[sc\.tag\] \|\| '🎖️'\) : '🔒'/);
});

test('grafika: HUD vrstva (rohové značky, ukazatele, fronta, radar, terminál) a původní chování tlačítek zůstalo', () => {
  for (const sel of ['.glass-panel {', '.card-emblem {', '.stat-box {', '#gauge {', '#gauge::after', '#radar {', '.target-zone {', '#pointer {', '.terminal-log {', '#overlay-sector {']) assert.ok(css.includes(sel), sel);
  for (const name of ['gaugeFlow', 'zonePulse']) assert.ok(css.includes(`@keyframes ${name}`), name);
  // původní funkční třídy a animace zůstaly
  for (const sel of ['.crisis {', '.vietnam-hidden #gauge', '.flash-good', '@keyframes crisisPulse', '.btn-main {', '.btn-gold {']) assert.ok(css.includes(sel), sel);
  // ukazatel fronty se barví přes backgroundColor, takže vrstvy v background-image na něj nesmí sahat shorthandem
  assert.match(game, /g\.style\.backgroundColor = /);
  const layer = css.slice(css.indexOf('#gauge {\n            background-image'));
  assert.ok(layer.startsWith('#gauge {\n            background-image'), 'gauge používá background-image, ne background');
  // tlačítka zvuk a nápověda stojí vedle odkazu zpět
  assert.match(css, /#sound-toggle \{ top: 8px; left: 148px; \}/);
});
