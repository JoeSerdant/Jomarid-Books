// Cheat kód ve hrách: stejný u všech (67MILUJU; Rocket má navíc výjimku IMAGINEFLEXITSTVOJIMMENEM na hvězdný prach), skryté pole jako číslo verze
// úplně dole, a cheaty slouží k testování: dosáhnou prahů herních odznaků, takže se odznaky, rekordy a postup dají vyzkoušet bez hodin hraní.
//   npm run test:cheats
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_BADGES } from '../gameRecords/catalog.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(SRC, 'gameContent', ...p), 'utf8');
// Hry City Clicker a Warroom jsou v repu jako jeden JS řetězec s HTML
const htmlOf = (file) => JSON.parse(read(file).match(/export const \w+ = (".*");\s*$/s)[1]);

const GAMES = {
  chess: { code: read('chess', 'ui.js'), page: read('chess', 'ui.js') },
  rocket: { code: read('rocket', 'index.html'), page: read('rocket', 'index.html') },
  polygonarena: { code: read('polygonArena', 'cheat.js'), page: read('polygonArena', 'index.html') },
  koulovikamosi: { code: read('koulovi', 'game.js'), page: read('koulovi', 'index.html') + read('koulovi', 'style.css') },
  cityclicker: { code: htmlOf('cityClicker.js'), page: htmlOf('cityClicker.js') },
  warroom: { code: htmlOf('warroom.js'), page: htmlOf('warroom.js') },
};
const badgeMax = (game, stat) => Math.max(...GAME_BADGES.filter((b) => b.game === game && b.stat === stat).map((b) => b.threshold));

test('kód je u všech šesti her 67MILUJU', () => {
  assert.match(GAMES.chess.code, /const CHEAT_CODE = "67MILUJU";/);
  assert.match(GAMES.rocket.code, /const CHEAT_CODE = '67MILUJU';/);
  assert.match(GAMES.polygonarena.code, /const CHEAT_CODE = '67MILUJU';/);
  assert.match(GAMES.koulovikamosi.code, /const CHEAT='67MILUJU'/);
  assert.match(GAMES.cityclicker.code, /var CHEAT_CODE = '67MILUJU';/);
  assert.match(GAMES.warroom.code, /value === '67MILUJU'/);
});

test('výjimka IMAGINEFLEXITSTVOJIMMENEM je jen v Rocketu (doplní hvězdný prach), jinde není', () => {
  assert.match(GAMES.rocket.code, /const STARDUST_CODE = 'IMAGINEFLEXITSTVOJIMMENEM';/);
  for (const [id, g] of Object.entries(GAMES)) if (id !== 'rocket') assert.doesNotMatch(g.code, /IMAGINEFLEX/, id);
});

test('kód jde napsat i na české klávesnici (číslice podle kódu klávesy) všude, kde se píše na klávesnici', () => {
  for (const id of ['chess', 'rocket', 'polygonarena', 'koulovikamosi', 'cityclicker']) assert.match(GAMES[id].code, /\(\?:Digit\|Numpad\)\(\\d\)/, id);
});

test('každá hra má pole „Tajný kód“, které vypadá jako číslo verze, a v textu hry se o kódu nic nepíše', () => {
  const fields = {
    chess: /CHEAT_FIELD_HINT = "v\d+\.\d+"/,
    rocket: /id="secret-input" class="vfield" placeholder="v\d+\.\d+"/,
    polygonarena: /id="versionField" class="vfield" type="text" placeholder="v\d+\.\d+"/,
    koulovikamosi: /id="vf" class="vfield" placeholder="v\d+\.\d+"/,
    cityclicker: /id="versionField" class="vfield" placeholder="v\d+\.\d+"/,
    warroom: /id=\\?"cheat-input\\?"[\s\S]{0,80}value=\\?"v\d+\.\d+/,
  };
  for (const [id, re] of Object.entries(fields)) assert.match(GAMES[id].page, re, id);
  for (const id of ['chess', 'rocket', 'polygonarena', 'koulovikamosi', 'cityclicker']) {
    assert.match(GAMES[id].page, /aria-label="Tajný kód"|"aria-label": "Tajný kód"/, id + ': název pro čtečky');
    assert.doesNotMatch(GAMES[id].page, /placeholder="Tajný kód"|Aktivovat(?! EndCraze)|ukrytý tajný cheat kód|Zkus jej napsat/, id + ': žádný viditelný popisek ani nápověda');
  }
});

test('pole má písmo aspoň 16 px (iOS při klepnutí nepřibližuje stránku) a vizuálně se zmenší', () => {
  assert.match(read('chess', 'style.css'), /\.cheat-field \{[^}]*font: 700 16px\/[^}]*transform: scale\(\.75\)/);
  assert.match(GAMES.rocket.page, /\.vfield \{[^}]*font-size: 16px;[^}]*transform: scale\(0\.75\)/);
  assert.match(GAMES.cityclicker.page, /\.vfield\{[^}]*font-size:16px;[^}]*transform:scale\(\.75\)/);
  assert.match(read('polygonArena', 'style.css'), /\.vfield\{[^}]*font-size:16px;[^}]*transform:scale\(\.75\)/);
  assert.match(GAMES.koulovikamosi.page, /\.vfield\{[^}]*font-size:16px;[^}]*transform:scale\(\.75\)/);
});

test('cheaty dosáhnou prahů herních odznaků (hlášení rekordů appce se děje při uložení postupu)', () => {
  // Rocket: skóre všech režimů a boss
  const rocket = GAMES.rocket.code;
  const cheatScore = Number(rocket.match(/const CHEAT_SCORE = (\d+);/)[1]);
  for (const stat of ['score_normal', 'score_inferno', 'score_insane']) assert.ok(cheatScore >= badgeMax('rocket', stat), stat);
  for (const mode of ['normal', 'hard', 'inferno', 'insane', 'blitz']) assert.ok(rocket.includes(`'score-${mode}': () => cheatScore('${mode}')`), mode);
  const boss = Number(rocket.match(/bestBossLevel = Math\.max\(Storage\.data\.stats\.bestBossLevel \|\| 0, (\d+)\)/)[1]);
  assert.ok(boss >= badgeMax('rocket', 'boss_level'), 'boss_level (NEMESIS 8, GLITCH 14)');
  // Polygon aréna: nejvyšší úroveň, boss a výhra
  const core = read('polygonArena', 'core.js');
  const maxLevel = Number(core.match(/const MAX_LEVEL = (\d+);/)[1]);
  assert.ok(maxLevel >= badgeMax('polygonarena', 'best_level'));
  assert.match(GAMES.polygonarena.code, /bestLevel = Math\.max\(save\.st\.bestLevel \|\| 1, MAX_LEVEL\)/);
  assert.match(GAMES.polygonarena.code, /save\.st\.bosses = \(save\.st\.bosses \|\| 0\) \+ 1/);
  assert.match(GAMES.polygonarena.code, /save\.st\.wins = \(save\.st\.wins \|\| 0\) \+ 1/);
  assert.ok(1 >= badgeMax('polygonarena', 'bosses_defeated') && 1 >= badgeMax('polygonarena', 'wins'));
  // Kouloví Kámoši: skóre Klasiky a všech 12 koulí
  const k = GAMES.koulovikamosi.code;
  assert.ok(Number(k.match(/bump\('classic',(\d+)\)/)[1]) >= badgeMax('koulovikamosi', 'score_classic'));
  assert.ok(Number(k.match(/S\.disc=(\d+);return/)[1]) + 1 >= badgeMax('koulovikamosi', 'balls_discovered'), 'balls_discovered se hlásí jako S.disc + 1');
  // City Clicker: kliky a přestavba
  const c = GAMES.cityclicker.code;
  assert.ok(Number(c.match(/state\.totalClicks \+= (\d+);/)[1]) >= badgeMax('cityclicker', 'total_clicks'));
  assert.match(c, /function cheatPrestige\(\)[\s\S]*?doPrestige\(\);/, 'přestavba je skutečná (stejné potvrzení i odměna)');
});

test('cheat se ukládá a hlásí jako skutečný postup (Rocket, Polygon, Kouloví Kámoši, City Clicker)', () => {
  assert.match(GAMES.rocket.code, /Storage\.save\(\);\s*UI\.refresh\(\);\s*UI\.renderStats\(\);\s*Achv\.check\(\);/);
  assert.match(GAMES.polygonarena.code, /persist\(\);[^\n]*\n\s*checkAch\(\);/);
  assert.match(GAMES.koulovikamosi.code, /cmsg\.textContent=CHEATS\[k\]\(\);save\(\);stats\(\)/);
  assert.match(GAMES.cityclicker.code, /function cheatAddClicks\(\)[\s\S]*?saveGame\(false\);/);
});

test('cheat menu se otevírá i na telefonu bez klávesnice (pole) a vždy se po otevření pole vyprázdní', () => {
  assert.match(GAMES.rocket.code, /applyCode = value =>[\s\S]*?secretInput\.value = '';\s*secretInput\.blur\(\);\s*openCheatMenu\(\);/);
  assert.match(GAMES.polygonarena.code, /elVersionField\.value = '';\s*elVersionField\.blur\(\);\s*openCheat\(\);/);
  assert.match(GAMES.koulovikamosi.code, /const cheatOpen=\(\)=>\{vf\.value='';vf\.blur\(\)/);
  assert.match(GAMES.cityclicker.code, /function openCheatModal\(\)\{\s*var field = document\.getElementById\('versionField'\);\s*if\(field\)\{ field\.value = ''; field\.blur\(\); \}/);
});
