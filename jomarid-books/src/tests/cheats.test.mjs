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
  for (const stat of ['score_normal', 'score_hard', 'score_inferno', 'score_insane', 'score_blitz']) assert.ok(cheatScore >= badgeMax('rocket', stat), stat);
  for (const mode of ['normal', 'hard', 'inferno', 'insane', 'blitz']) assert.ok(rocket.includes(`'score-${mode}': () => cheatScore('${mode}')`), mode);
  const rushCheat = Number(rocket.match(/const CHEAT_RUSH = (\d+);/)[1]);
  assert.ok(rushCheat >= badgeMax('rocket', 'rush_streak'), 'rush_streak (série bossů v Boss Rush)');
  assert.match(rocket, /rush: \(\) => \{\s*Storage\.data\.best\.rush = Math\.max\(Storage\.data\.best\.rush \|\| 0, CHEAT_RUSH\);/);
  assert.ok(GAMES.rocket.page.includes('data-cheat="rush"'));
  // celkové statistiky za celou dobu hraní: jedno cheat tlačítko, které je zvedne na prahy všech odznaků a relikvií (nejdelší běh je v ms, odznak v minutách)
  const life = JSON.parse(rocket.match(/const CHEAT_LIFETIME = (\{[^}]*\});/)[1].replace(/(\w+):/g, '"$1":'));
  const lifeStats = { total_kills: ['totalKills', 1], total_boss_kills: ['totalBossKills', 1], no_hit_bosses: ['noHitBosses', 1], best_combo: ['bestCombo', 1], bombs_used: ['bombsUsed', 1], total_coins_earned: ['totalCoinsEarned', 1], longest_run: ['longestRun', 60000], blitz_clears: ['blitzClears', 1] };
  for (const [stat, [field, unit]] of Object.entries(lifeStats)) assert.ok(life[field] / unit >= badgeMax('rocket', stat), stat);
  assert.match(rocket, /lifetime: \(\) => \{\s*for \(const k in CHEAT_LIFETIME\) Storage\.data\.stats\[k\] = Math\.max\(Storage\.data\.stats\[k\] \|\| 0, CHEAT_LIFETIME\[k\]\);/);
  assert.ok(GAMES.rocket.page.includes('data-cheat="lifetime"'));
  assert.equal(Object.keys(life).length, Object.keys(lifeStats).length, 'každá celková statistika má v cheatu hodnotu');
  assert.ok(badgeMax('rocket', 'maxed_upgrades') === 8 && /maxship: \(\) => \{ for \(const u of UPGRADES\) Storage\.data\.upgrades\[u\.key\] = MAX_LVL;/.test(rocket), 'Loď na maximum (maxed_upgrades)');
  const boss = Number(rocket.match(/bestBossLevel = Math\.max\(Storage\.data\.stats\.bestBossLevel \|\| 0, (\d+)\)/)[1]);
  assert.ok(boss >= badgeMax('rocket', 'boss_level'), 'boss_level (NEMESIS 8, GLITCH 14)');
  // Polygon aréna: úroveň, bossové, výhry, režimy, vlny, třídy, stupeň třídy a Peklo
  const core = read('polygonArena', 'core.js');
  const cheat = GAMES.polygonarena.code;
  const num = (name) => Number(cheat.match(new RegExp(`${name} = (\\d+)`))[1]);
  const maxLevel = Number(core.match(/const MAX_LEVEL = (\d+);/)[1]);
  assert.ok(maxLevel >= badgeMax('polygonarena', 'best_level'));
  assert.match(cheat, /bestLevel = Math\.max\(save\.st\.bestLevel \|\| 1, MAX_LEVEL\)/);
  assert.match(cheat, /save\.st\.bosses = \(save\.st\.bosses \|\| 0\) \+ CHEAT_BOSSES/);
  assert.match(cheat, /save\.st\.wins = \(save\.st\.wins \|\| 0\) \+ 1/);
  assert.ok(num('CHEAT_BOSSES') >= badgeMax('polygonarena', 'bosses_defeated') && 1 >= badgeMax('polygonarena', 'wins'));
  assert.match(cheat, /st\.hillWins = \(st\.hillWins \|\| 0\) \+ 1; st\.royaleWins = \(st\.royaleWins \|\| 0\) \+ 1; st\.rushWins = \(st\.rushWins \|\| 0\) \+ 1;/);
  assert.ok(1 >= Math.max(...['hill_wins', 'royale_wins', 'rush_wins'].map((s) => badgeMax('polygonarena', s))));
  assert.ok(num('CHEAT_WAVE') >= badgeMax('polygonarena', 'best_wave') && num('CHEAT_CLASSES') >= badgeMax('polygonarena', 'classes_discovered') && num('CHEAT_HELL_LEVEL') >= badgeMax('polygonarena', 'hell_best_level'));
  assert.match(cheat, /for \(const m of MODE_IDS\) st\.modesPlayed\[m\] = true;/, 'všechny režimy (modes_played)');
  assert.match(cheat, /for \(const id of BOSS_IDS\) st\.bossKinds\[id\] = true;/, 'všechny druhy bossů (boss_kinds)');
  assert.match(cheat, /st\.bestTier = Math\.max\(st\.bestTier \|\| 0, TIER_LEVELS\.length\)/, 'nejvyšší stupeň třídy (best_tier)');
  for (const id of ['level', 'boss', 'win', 'modes', 'collect']) assert.ok(GAMES.polygonarena.page.includes(`data-cheat="${id}"`), `tlačítko ${id}`);
  // Kouloví Kámoši: skóre Klasiky a všech 12 koulí
  const k = GAMES.koulovikamosi.code;
  const ks = k.match(/const CHEAT_SCORES=\{classic:(\d+),time:(\d+),drops:(\d+),chaos:(\d+)\}/);
  for (const [i, m] of ['classic', 'time', 'drops', 'chaos'].entries()) assert.ok(Number(ks[i + 1]) >= badgeMax('koulovikamosi', 'score_' + m), 'score_' + m);
  assert.match(k, /for\(const m in CHEAT_SCORES\)bump\(m,CHEAT_SCORES\[m\]\)/);
  assert.ok(Number(k.match(/S\.disc=(\d+);return/)[1]) + 1 >= badgeMax('koulovikamosi', 'balls_discovered'), 'balls_discovered se hlásí jako S.disc + 1');
  // City Clicker: kliky a přestavba
  const c = GAMES.cityclicker.code;
  assert.ok(Number(c.match(/state\.totalClicks \+= (\d+);/)[1]) >= badgeMax('cityclicker', 'total_clicks'));
  assert.match(c, /function cheatPrestige\(\)[\s\S]*?doPrestige\(\);/, 'přestavba je skutečná (stejné potvrzení i odměna)');
});

test('cheat se ukládá a hlásí jako skutečný postup (Rocket, Polygon, Kouloví Kámoši, City Clicker)', () => {
  assert.match(GAMES.rocket.code, /Storage\.save\(\);\s*UI\.refresh\(\);\s*UI\.renderStats\(\);\s*Relics\.check\(\);/);
  assert.match(GAMES.polygonarena.code, /persist\(\);[^\n]*\n\s*trackProgress\(\);/);
  assert.match(GAMES.koulovikamosi.code, /cmsg\.textContent=CHEATS\[k\]\(\);save\(\);stats\(\)/);
  assert.match(GAMES.cityclicker.code, /function cheatAddClicks\(\)[\s\S]*?saveGame\(false\);/);
});

test('cheat menu se otevírá i na telefonu bez klávesnice (pole) a vždy se po otevření pole vyprázdní', () => {
  assert.match(GAMES.rocket.code, /applyCode = value =>[\s\S]*?secretInput\.value = '';\s*secretInput\.blur\(\);\s*openCheatMenu\(\);/);
  assert.match(GAMES.polygonarena.code, /elVersionField\.value = '';\s*elVersionField\.blur\(\);\s*openCheat\(\);/);
  assert.match(GAMES.koulovikamosi.code, /const cheatOpen=\(\)=>\{vf\.value='';vf\.blur\(\)/);
  assert.match(GAMES.cityclicker.code, /function openCheatModal\(\)\{\s*var field = document\.getElementById\('versionField'\);\s*if\(field\)\{ field\.value = ''; field\.blur\(\); \}/);
});
