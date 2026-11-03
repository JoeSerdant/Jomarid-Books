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

test('každá hra s cheatem má tlačítko „Všechny odznaky“, které zvedne statistiky na prahy odznaků (úplnost hlídají sady testů her)', () => {
  // Skutečné dosažení všech prahů ověřují testy v sadách jednotlivých her (každý odznak z katalogu musí cheat zvednout nad práh).
  // Tady se hlídá jen to, že je tlačítko v menu každé hry a že se po něm postup uloží a ohlásí.
  assert.match(GAMES.rocket.page, /<button class="btn btn-small" data-cheat="badges">🎖️ Všechny odznaky<\/button>/);
  assert.match(GAMES.rocket.code, /    badges: \(\) => \{[\s\S]*?Storage\.save\(\);/);
  assert.match(GAMES.chess.code, /id: "badges", icon: "🎖️", label: "Všechny odznaky"/);
  assert.match(GAMES.polygonarena.page, /data-cheat="badges"/);
  assert.match(GAMES.polygonarena.code, /badges: \(\) => \{[\s\S]*?persist\(\)/);
  assert.match(GAMES.koulovikamosi.page, /Všechny odznaky/);
  assert.match(GAMES.koulovikamosi.code, / all:\(\)=>\{for\(const k in CHEAT_STATS\)/);
  assert.match(GAMES.cityclicker.page, /id=\\?"cheatAllBadges\\?"|id="cheatAllBadges"/);
  assert.match(GAMES.cityclicker.code, /function cheatAllBadges\(\)\{/);
  assert.match(GAMES.warroom.code, /cheatAction\(\\?'badges\\?'\)|cheatAction\('badges'\)/);
  assert.match(GAMES.warroom.code, /type === 'badges'/);
  // cheat pouze zvedá: žádná z tabulek CHEAT_STATS nemá nulu ani hodnotu nad mezí statistiky
  for (const b of GAME_BADGES) assert.ok(b.threshold > 0, b.id);
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
