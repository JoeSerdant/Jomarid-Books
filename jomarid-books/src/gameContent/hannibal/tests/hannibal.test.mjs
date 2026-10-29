// Testy hry Hannibal: Barca a složky Strategie v seznamu her: skládání dokumentu, napojení na appku, odměny a postup, složka se Warroomem.
// Samotný chod hry se zkouší v prohlížeči (hra je plátno).
//   npm run test:hannibal
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { LEGACY_KEYS } from '../../../gameSave/catalog.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(DIR, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const html = read(path.join(DIR, 'index.html'));
const assembler = read(path.join(SRC, 'gameContent', 'hannibalGame.js'));
const gamesPage = read(path.join(SRC, 'pages', 'Games.jsx'));
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test('hannibalGame.js skládá hru z hannibal/index.html a Games.jsx ji stahuje až při spuštění', () => {
  assert.match(assembler, /import html from '\.\/hannibal\/index\.html\?raw'/);
  assert.match(assembler, /export const HANNIBAL_HTML = html/);
  assert.match(gamesPage, /id: 'hannibal',[\s\S]*?import\('\.\.\/gameContent\/hannibalGame'\)\.then\(m => m\.HANNIBAL_HTML\)/);
  assert.match(html, /var GAME_ID = 'hannibal';/);
  assert.doesNotMatch(gamesPage, /^import .*gameContent\/hannibalGame/m);
});

test('dokument je jeden celek: všechny skripty se dají přeložit a nic se nestahuje z cizích skriptů', () => {
  assert.equal((html.match(/<!DOCTYPE html>/gi) || []).length, 1);
  assert.equal((html.match(/<\/html>/gi) || []).length, 1, 'obalový dokument z publikování se nesmí dostat dovnitř');
  assert.ok(scripts.length >= 3);
  for (const s of scripts) new vm.Script(s);
  assert.doesNotMatch(html, /<script[^>]*\bsrc=/i, 'hra nenačítá žádný cizí skript');
});

test('postup se ukládá jen pod klíči, které appka přenáší na server', () => {
  const used = new Set([...html.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*(?:'([^']+)'|this\.SAVE_KEY)/g)].map((m) => m[1] || 'hannibal_save_v1'));
  assert.ok(html.includes("SAVE_KEY: 'hannibal_save_v1'"));
  for (const key of used) assert.ok(LEGACY_KEYS.hannibal.includes(key), `${key} chybí v gameSave/catalog.js`);
  assert.deepEqual([...LEGACY_KEYS.hannibal].sort(), ['hannibal_endless_best', 'hannibal_save_v1']);
});

test('Jomarid Coins: hra jen žádá (vítězství v kampani 10, v minihře 5, poražená vlna nekonečného tažení 2), o částce rozhoduje server', () => {
  assert.match(html, /rewardCoins\(reason, amount\) \{\s*try \{ if \(typeof jomaridReward === 'function'\) jomaridReward\(reason, amount\); \}/);
  assert.match(html, /if \(node\) this\.rewardCoins\('victory', 10\);/);
  assert.match(html, /if \(result\.success !== false\) this\.rewardCoins\('victory', 5\);/);
  assert.match(html, /this\.rewardCoins\('wave', 2\);/);
  const rewards = [...html.matchAll(/rewardCoins\('(\w+)', (\d+)\)/g)];
  assert.ok(rewards.reduce((sum, m) => sum + Number(m[2]), 0) <= 20, 'jedna událost dává málo, denní strop 100 hlídá server');
  const labels = read(path.join(SRC, 'gameBar', 'rewardLabels.js'));
  for (const reason of new Set(rewards.map((m) => m[1]))) assert.match(labels, new RegExp(`\\b${reason}: '`), `${reason} má v liště český název`);
});

test('Hry: složka Strategie obsahuje Warroom a Hannibala, ostatní hry zůstávají mimo ni', () => {
  const games = [...gamesPage.matchAll(/\n  \{\n    id: '(\w+)',[\s\S]*?\n  \},/g)].map((m) => [m[1], (m[0].match(/folder: '(\w+)'/) || [])[1]]);
  assert.deepEqual(games.filter(([, f]) => f === 'strategy').map(([id]) => id), ['warroom', 'hannibal']);
  assert.deepEqual(games.filter(([, f]) => !f).map(([id]) => id).sort(), ['chess', 'cityclicker', 'koulovikamosi', 'polygonarena', 'rocket']);
  assert.match(gamesPage, /\{ key: 'strategy', title: 'Strategie',/);
  // složka se otevírá v adrese, ať se po návratu ze hry ukáže otevřená, a hra vede zpět do své složky
  assert.match(gamesPage, /useSearchParams/);
  assert.match(gamesPage, /params\.get\('slozka'\)/);
  assert.match(gamesPage, /to=\{game\.folder \? `\/games\?slozka=\$\{game\.folder\}` : '\/games'\}/);
});

test('SQL: server pozná hru hannibal pro uložený postup i Coiny', () => {
  const noComments = (f) => fs.readFileSync(path.join(SRC, '..', 'db', f), 'utf8').replace(/--[^\n]*/g, '');
  for (const f of ['game-saves.sql', 'game-coins.sql']) assert.match(noComments(f), /p_game_id not in \([^)]*'hannibal'[^)]*\)/, f);
});
