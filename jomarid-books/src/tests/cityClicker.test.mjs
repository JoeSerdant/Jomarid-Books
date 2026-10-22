// City Clicker: grafická vrstva (skyline s gradientem a majáky, plastické panely a tlačítka, vzhled čtyř motivů) a celistvost dokumentu.
//   npm run test:city
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = fs.readFileSync(path.join(SRC, 'gameContent', 'cityClicker.js'), 'utf8');
const html = JSON.parse(file.match(/^export const CITY_CLICKER_HTML = (".*");\s*$/s)[1]);
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
const THEMES = ['classic', 'steampunk', 'cyberpunk', 'mars'];

test('dokument: jedno style, skripty se dají přeložit a CSS má vyvážené závorky', () => {
  assert.equal(html.split('<style>').length, 2);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 2);
  for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code));
  let depth = 0;
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"/g, '""')) { if (ch === '{') depth += 1; if (ch === '}') depth -= 1; assert.ok(depth >= 0, 'přebývá }'); }
  assert.equal(depth, 0, 'chybí }');
});

test('grafika: skyline má gradienty, vzdálenou vrstvu a majáky u nejvyšších budov', () => {
  const sky = html.slice(html.indexOf('<div class="skyline-banner"'), html.indexOf('</svg>', html.indexOf('<div class="skyline-banner"')));
  assert.match(sky, /<linearGradient id="skG"/);
  assert.match(sky, /<linearGradient id="skF"/);
  assert.ok((sky.match(/class="sk-far"/g) || []).length > 10, 'vzdálená vrstva');
  assert.ok((sky.match(/class="sk-beacon"/g) || []).length >= 3, 'majáky');
  assert.ok((sky.match(/class="sk-ant"/g) || []).length === (sky.match(/class="sk-beacon"/g) || []).length, 'každý maják má anténu');
  assert.match(css, /\.skyline-banner \.sk-building\{ fill:url\(#skG\)/);
  // odkazy na gradienty vedou na existující id
  for (const id of ['skG', 'skF']) assert.ok(sky.includes(`id="${id}"`), id);
});

test('grafika: každý motiv má vlastní vzhled a stavové třídy z původního stylu zůstaly funkční', () => {
  for (const t of THEMES) assert.match(css, new RegExp(`\\[data-theme="${t}"\\]\\{`), t + ' má své barvy');
  for (const t of ['steampunk', 'cyberpunk', 'mars']) assert.ok(css.includes(`[data-theme="${t}"] .column`) || css.includes(`body[data-theme="${t}"]`), t + ' má vlastní grafiku');
  // pulz tlačítka radnice a blesk ve frenzy musí mít vyšší specificitu než nový základ tlačítka
  assert.match(css, /\.btn-townhall\.pulse\{ animation:pulseBtn/);
  assert.match(css, /body\.frenzy \.btn-townhall\{[^}]*box-shadow/);
  // grafika se nesmí dotknout EndCraze pozadí
  assert.match(css, /body:not\(\.endcraze\)\{/);
  assert.match(css, /body\.endcraze\{/);
});

test('grafika: panely, tlačítka a ikony zón mají plastický vzhled a zůstává vypnutelná animace při omezeném pohybu', () => {
  for (const sel of ['.column{', '.stat-gauge{', '.btn-build, .btn-policy{', '.btn-mega, .btn-prestige{', '.ledger-icon{', '.toast{', '.modal-box{']) assert.ok(css.includes(sel), sel);
  assert.match(css, /prefers-reduced-motion: reduce\)\{\s*\*\{ animation-duration:0\.01ms !important/);
  // nové animace pocházejí z @keyframes definovaných v tomtéž stylu
  for (const name of ['thSpin', 'comboShine', 'sk-blink']) assert.ok(css.includes(`@keyframes ${name}`), name);
});
