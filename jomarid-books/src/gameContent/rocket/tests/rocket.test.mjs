// Testy Rocket Game: skládání dokumentu, napojení na appku, režim Peklo, tajný kód. Samotný chod hry se zkouší v prohlížeči (hra je plátno).
//   npm run test:rocket
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(DIR, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const html = read(path.join(DIR, 'index.html'));
const assembler = read(path.join(SRC, 'gameContent', 'rocketGame.js'));
const gamesPage = read(path.join(SRC, 'pages', 'Games.jsx'));
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test('rocketGame.js skládá hru z rocket/index.html a Games.jsx ji stahuje až při spuštění', () => {
  assert.match(assembler, /import html from '\.\/rocket\/index\.html\?raw'/);
  assert.match(assembler, /export const ROCKET_GAME_HTML = html/);
  assert.match(gamesPage, /id: 'rocket',[\s\S]*?import\('\.\.\/gameContent\/rocketGame'\)\.then\(m => m\.ROCKET_GAME_HTML\)/);
  assert.match(html, /var GAME_ID = 'rocket';/);
  assert.doesNotMatch(gamesPage, /^import .*gameContent\/rocketGame/m);
});

test('všechny skripty ve hře jsou syntakticky v pořádku', () => {
  assert.ok(scripts.length >= 2);
  for (const s of scripts) new vm.Script(s);
});

test('odkaz „← Jomarid Books“ ve hře není (zavírá se křížkem v appce)', () => {
  assert.doesNotMatch(html, /<a [^>]*id="btn-back-to-jomarid"/);
  assert.doesNotMatch(html, /← Jomarid Books/);
});

test('Peklo je zapsané na všech místech: karta, start, uložený rekord, menu, konec hry', () => {
  assert.match(html, /<button class="mode-card inferno" id="btn-start-inferno">/);
  assert.match(html, /id="rec-inferno"/);
  assert.match(html, /getElementById\('btn-start-inferno'\)\.onclick = \(\) => Game\.start\('inferno'\)/);
  assert.match(html, /\['normal', 'hard', 'inferno', 'blitz', 'rush', 'zen', 'daily'\]\.includes\(mode\)/);
  assert.match(html, /this\.isHardMode = \(this\.mode === 'hard' \|\| this\.mode === 'inferno'\)/);
  assert.match(html, /best: \{ normal: 0, hard: 0, inferno: 0,/);
  assert.match(html, /getElementById\('rec-inferno'\)\.innerText = /);
  assert.match(html, /inferno: 'Peklo'/);
});

test('Peklo: čísla odpovídají zadání (štít půlka, asteroidy hustěji, power-upů míň, víc nepřátel)', () => {
  const m = html.match(/const INFERNO = (\{[\s\S]*?\n\});/);
  assert.ok(m, 'konstanty Pekla');
  const I = vm.runInNewContext('(' + m[1] + ')');
  assert.equal(I.shieldBlock, 0.5);
  assert.ok(I.dmgTakenMult > 1);
  assert.ok(I.powerupMult < 1 && I.pickupMult < 1);
  assert.ok(I.extraEnemies > 0 && I.gapMult < 1 && I.maxLeft > 2);
  assert.ok(I.asteroidBurst >= 2 && I.asteroidGapMult < 1 && I.asteroidChance > 0.0012 && I.asteroidScoreMin < 500 && I.asteroidDuration > 12000 && I.eventCooldown < 16000);
});

test('štít: normálně pohltí zásah celý, jen v Pekle část projde a asteroid ho probíjí', () => {
  assert.match(html, /takeDamage\(amount, iframes, shieldBlock\)/);
  assert.match(html, /if \(block >= 1\) return false;/);
  assert.match(html, /const shieldBlock = this\.inferno \? \(piercing \? 0 : INFERNO\.shieldBlock\) : 1;/);
  assert.match(html, /this\.damagePlayer\(dmg, e\.indestructible \? 900 : 400, e\.type === 'asteroid'\)/);
});

test('v Pekle se do vlny nepočítají asteroidy, takže nepřátelé chodí i během pole asteroidů', () => {
  assert.match(html, /g\.enemies\.filter\(e => e\.type !== 'asteroid'\)\.length : g\.enemies\.length/);
});

test('tajné kódy: starý dává mince, IMAGINEFLEXITSTVOJIMMENEM hvězdný prach', () => {
  assert.match(html, /code === '67MILUJU'/);
  assert.match(html, /code === 'IMAGINEFLEXITSTVOJIMMENEM'/);
  assert.match(html, /const code = secretInput\.value\.trim\(\)\.toUpperCase\(\);/);
  assert.match(html, /Storage\.data\.stardust = Math\.min\(\(Storage\.data\.stardust \|\| 0\) \+ 1000000, 1000000000\)/);
});
