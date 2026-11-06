// Angličtina ve hrách: překladová vrstva v iframu (src/i18n/gameLayer.js), slovníky her (src/i18n/games/) a jejich úplnost.
// Hra běží v iframu, kam appka nedosáhne, takže se hlídá zvlášť: každý český text ve zdroji hry, který se ukazuje hráči, musí mít ve slovníku
// anglický záznam (u her, které už jsou přeložené: seznam DONE níž). Co se ve zdrojích nedá vyčíst (text složený za běhu), ukáže zkouška
// v prohlížeči (window.__jomaridMiss, viz zkušební skript v popisu PR).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildGameLayer, withGameLanguage } from '../i18n/gameLayer.js';
import { GAME_IDS, loadGameDictionary } from '../i18n/games/index.js';
import { GAMES, extractGameKeys, readGameDict } from '../i18n/tools/gamestrings.mjs';
import { placeholdersOf, hasCzechDiacritics } from '../i18n/tools/scan.mjs';
import { withoutNames } from '../i18n/tools/gamestrings.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

// Hry, jejichž slovník je hotový (úplnost se u nich hlídá); ostatní se doplňují po jedné.
const DONE = ['koulovikamosi', 'chess', 'cityclicker', 'hannibal', 'warroom', 'polygonarena'];

// Spustí vrstvu v izolovaném kontextu s minimálním oknem a vrátí window.
const runLayer = (lang, dict, extra = {}, intl = Intl) => {
  const win = { addEventListener() {}, ...extra };
  const doc = { addEventListener() {}, documentElement: { setAttribute() {} }, title: '' };
  const ctx = vm.createContext({ window: win, document: doc, Intl: intl, Number, Date, Object, String, Array, RegExp, WeakMap });
  win.window = win;
  vm.runInContext(buildGameLayer(lang, dict), ctx);
  return { win, doc, ctx };
};

test('vrstva: česky nic nepřekládá, anglicky bere z slovníku, bílé znaky zachová a text bez písmen nechá být', () => {
  assert.equal(runLayer('cs', { Hrát: 'Play' }).win.jomaridT('Hrát'), 'Hrát');
  const T = runLayer('en', { Hrát: 'Play', 'Začít novou hru': 'Start a new game' }).win.jomaridT;
  assert.equal(T('Hrát'), 'Play');
  assert.equal(T('  Hrát \n'), '  Play \n');
  assert.equal(T('Začít    novou\n hru'), 'Start a new game');
  assert.equal(T('Neznámé'), 'Neznámé', 'chybějící překlad zůstane česky, aby byl vidět');
  assert.equal(T(42), 42);
  assert.equal(T('1 234'), '1 234');
  assert.equal(T(''), '');
});

test('vrstva: místa {0} se shodují s dosazenou částí věty a ta se přeloží zvlášť; delší pevná část vyhrává', () => {
  const T = runLayer('en', {
    'Skóre: {0}': 'Score: {0}', 'Máš {0} mincí': 'You have {0} coins', coiny: 'coins', 'Vlna {0} z {1}': 'Wave {0} of {1}',
    '{0} bodů': '{0} points', 'Rekord: {0} bodů': 'Record: {0} points',
  }).win.jomaridT;
  assert.equal(T('Skóre: 1 234'), 'Score: 1 234');
  assert.equal(T('Máš 5 mincí'), 'You have 5 coins');
  assert.equal(T('Máš coiny mincí'), 'You have coins coins');
  assert.equal(T('Vlna 3 z 10'), 'Wave 3 of 10');
  assert.equal(T('Rekord: 12 bodů'), 'Record: 12 points', 'konkrétnější vzor má přednost před obecným {0} bodů');
  assert.equal(T('Jiný text 5'), 'Jiný text 5');
});

test('vrstva: ikona před známým textem, tečka na konci a více vět v jednom textu se přeloží, neznámá věta nechá celek česky', () => {
  const T = runLayer('en', {
    Zdupání: 'Trample', 'Přesná muška': 'Sharp Aim', 'Silný útok.': 'Strong attack.', 'Rychlá jízda - výpad a ústup.': 'Fast cavalry - charge and retreat.',
    '{0} (pasivní): {1}': '{0} (passive): {1}', 'Zvuk: vypnutý': 'Sound: off',
  }).win.jomaridT;
  assert.equal(T('🔇 Zvuk: vypnutý'), '🔇 Sound: off');
  assert.equal(T('🐘 Zdupání'), '🐘 Trample');
  assert.equal(T('🐘 Zdupání.'), '🐘 Trample.', 'tečka za známým textem bez tečky');
  assert.equal(T('🎯 Přesná muška (pasivní): Silný útok.'), '🎯 Sharp Aim (passive): Strong attack.');
  assert.equal(T('Rychlá jízda - výpad a ústup. 🐘 Zdupání.'), 'Fast cavalry - charge and retreat. 🐘 Trample.');
  assert.equal(T('Silný útok. Neznámá věta.'), 'Silný útok. Neznámá věta.', 'když některá věta chybí, zůstane celek česky a je vidět');
  assert.equal(T('Silný útok. Rychlá jízda - výpad a ústup. Zdupání.'), 'Strong attack. Fast cavalry - charge and retreat. Trample.', 'víc vět za sebou');
  assert.equal(T('Zdupání, Přesná muška, Zdupání'), 'Trample, Sharp Aim, Trample', 'seznam známých názvů');
  assert.equal(T('Zdupání, Neznámé'), 'Zdupání, Neznámé');
  assert.equal(T('Zdupání: Silný útok.'), 'Trample: Strong attack.', 'název: popis ze dvou známých textů');
  assert.equal(T('Zdupání: Neznámé'), 'Zdupání: Neznámé');
  assert.equal(T('⚠ Neznámé'), '⚠ Neznámé');
  assert.equal(T('— 5'), '— 5');
});

test('vrstva: vzor, jehož části se všechny přeloží, má přednost před vzorem s neznámou částí', () => {
  const T = runLayer('en', {
    'AKCE: {0} {1} (+{2} VB)': 'ACTION: {0} {1} (+{2} CP)', 'AKCE: {0} (+{1} VB)': 'ACTION: {0} (+{1} CP)',
    'Útok selhal.': 'The attack failed.', 'Úder': 'Strike',
  }).win.jomaridT;
  assert.equal(T('AKCE: Úder 5 (+2 VB)'), 'ACTION: Strike 5 (+2 CP)');
  assert.equal(T('AKCE: Útok selhal. (+2 VB)'), 'ACTION: The attack failed. (+2 CP)', 'celá věta se nerozdělí na dvě části jen kvůli mezeře');
  assert.equal(T('AKCE: Neznámé věci (+2 VB)'), 'ACTION: Neznámé věci (+2 CP)', 'když nic nesedí úplně, použije se částečná shoda');
});

test('vrstva: krátký název ze známých slov se přeloží po slovech, s neznámým slovem zůstane česky; částečná shoda se v kolekci ohlásí', () => {
  const dict = { Ledový: 'Icy', Šíp: 'Arrow', 'AKCE: {0} ({1})': 'ACTION: {0} ({1})' };
  const win = { addEventListener() {} };
  const ctx = vm.createContext({ window: win, document: { addEventListener() {}, documentElement: { setAttribute() {} }, title: '' }, Intl, Number, Date, Object, String, Array, RegExp, WeakMap });
  win.window = win;
  vm.runInContext(buildGameLayer('en', dict, { collect: true }), ctx);
  const T = win.jomaridT;
  assert.equal(T('Ledový Šíp'), 'Icy Arrow');
  assert.equal(T('Ledový šíp'), 'Icy Arrow', 'podstatné jméno malým písmenem se hledá i s velkým začátkem');
  assert.equal(T('Ledový Neznámý'), 'Ledový Neznámý');
  assert.equal(T('AKCE: Neznámé (5)'), 'ACTION: Neznámé (5)');
  assert.ok(win.__jomaridMiss && win.__jomaridMiss['AKCE: Neznámé (5)'], 'částečně přeložený text je v seznamu chybějících');
});

test('vrstva: znaky regulárních výrazů v klíči nevadí a slovník s </script> nerozbije dokument', () => {
  const T = runLayer('en', { 'Cena (v 1. kole)?': 'Price (round 1)?', 'Bonus +{0} [x]': 'Bonus +{0} [x]' }).win.jomaridT;
  assert.equal(T('Cena (v 1. kole)?'), 'Price (round 1)?');
  assert.equal(T('Bonus +5 [x]'), 'Bonus +5 [x]');
  const html = withGameLanguage('<!DOCTYPE html><html><head><title>x</title></head><body></body></html>', 'en', { 'a</script><b>': 'x' });
  assert.equal((html.match(/<\/script>/g) || []).length, 1, 'uvnitř skriptu není předčasný </script>');
  assert.ok(html.indexOf('<script>') < html.indexOf('<title>'), 'vrstva je na začátku <head>, před skripty hry');
});

test('vrstva: okna a canvas dostanou přeložený text', () => {
  const calls = [];
  class Ctx2D { fillText(t) { calls.push(['fill', t]); } strokeText(t) { calls.push(['stroke', t]); } measureText(t) { calls.push(['measure', t]); return { width: 1 }; } }
  const { win } = runLayer('en', { 'Konec hry': 'Game over' }, { CanvasRenderingContext2D: Ctx2D, alert: (m) => calls.push(['alert', m]), confirm: (m) => { calls.push(['confirm', m]); return true; } });
  const ctx = new win.CanvasRenderingContext2D();
  ctx.fillText('Konec hry', 1, 2); ctx.strokeText('Konec hry', 1, 2); ctx.measureText('Konec hry'); ctx.fillText(5, 1, 2);
  win.alert('Konec hry'); win.confirm('Konec hry');
  assert.deepEqual(calls.map((c) => c[1]), ['Game over', 'Game over', 'Game over', 5, 'Game over', 'Game over']);
});

test('vrstva: česká jazyková verze se při formátování nahradí anglickou, ostatní zůstanou', () => {
  const seen = [];
  const fake = (name) => class { constructor(l) { seen.push([name, l]); } };
  const intl = { NumberFormat: Object.assign(fake('N'), { supportedLocalesOf() { return []; } }), DateTimeFormat: Object.assign(fake('D'), { supportedLocalesOf() { return []; } }) };
  const { ctx } = runLayer('en', {}, {}, intl);
  new ctx.Intl.NumberFormat('cs-CZ'); new ctx.Intl.NumberFormat(); new ctx.Intl.DateTimeFormat('cs'); new ctx.Intl.NumberFormat('de-DE');
  assert.deepEqual(seen, [['N', 'en-GB'], ['N', 'en-GB'], ['D', 'en-GB'], ['N', 'de-DE']]);
});

test('slovníky: překlad nemá víc míst {0} než klíč, v překladu není česká diakritika (kromě záměrně stejných) a jde se stáhnout přes loader', async () => {
  for (const id of GAME_IDS) {
    const dict = await readGameDict(id);
    for (const [cs, en] of Object.entries(dict)) {
      assert.ok(placeholdersOf(en).every((p) => placeholdersOf(cs).includes(p)), `${id}: v překladu je místo, které česky není: ${cs}`); // anglicky smí místo chybět (české koncovky rodu)
      assert.ok(en.trim(), `${id}: prázdný překlad: ${cs}`);
      if (en !== cs) assert.ok(!hasCzechDiacritics(withoutNames(en)), `${id}: česká diakritika v překladu: ${cs} -> ${en}`);
    }
    assert.deepEqual(await loadGameDictionary(id), dict, `${id}: loader vrací stejný slovník`);
  }
  assert.deepEqual(await loadGameDictionary('neexistuje'), {});
  assert.deepEqual([...GAME_IDS].sort(), Object.keys(GAMES).sort(), 'každá hra má slovník');
});

test('hry s hotovým slovníkem: každý český text ve zdroji hry má anglický záznam', async () => {
  for (const id of DONE) {
    const { keys, errors } = extractGameKeys(id);
    assert.deepEqual(errors, [], `${id}: zdroj se nepodařilo přečíst`);
    const dict = await readGameDict(id);
    const missing = [...keys.entries()].filter(([k]) => !(k in dict)).map(([k, locs]) => `${k}  @${locs[0]}`);
    assert.deepEqual(missing, [], `${id}: chybí překlad (npm run i18n:games -- extract ${id} soubor)`);
  }
});

test('šachy: věty pro čtečky obrazovky se anglicky skládají z anglických názvů, česky zůstávají beze změny', () => {
  const src = read('gameContent', 'chess', 'speech.js');
  const load = (lang) => {
    const win = lang === 'en' ? { jomaridLang: 'en' } : {};
    const ctx = vm.createContext({ window: lang ? win : undefined, ChessEngine: { isCheckmate: () => false, isInCheck: () => true } });
    vm.runInContext(`${src}\nthis.Speech = Speech;`, ctx);
    return ctx.Speech;
  };
  const move = { piece: { type: 'n', color: 'b' }, from: { r: 0, c: 6 }, to: { r: 2, c: 5 }, captured: { type: 'p', color: 'w' } };
  assert.equal(load('en').describeMove(move, { turn: 'w' }), 'knight from g8 to f6, captures a pawn. Check.');
  assert.equal(load('en').squareLabel(6, 4, { type: 'p', color: 'w' }, { selected: true }), 'e2, white pawn, selected');
  assert.equal(load('en').describeSelection({ type: 'q', color: 'b' }, 0, 3, []), "Selected: black queen at d8. This piece can't move right now.");
  assert.match(load(null).describeMove(move, { turn: 'w' }), /^jezdcem z g8 na f6, bere pěšce\. Šach\.$/);
});

test('zapojení: Games.jsx vkládá vrstvu a slovník hry jen v angličtině, nástroje a test jsou v npm test', () => {
  const games = read('pages', 'Games.jsx');
  assert.match(games, /import \{ withGameLanguage \} from '\.\.\/i18n\/gameLayer';/);
  assert.match(games, /import \{ loadGameDictionary \} from '\.\.\/i18n\/games';/);
  assert.match(games, /const dict = lang === 'en' \? await loadGameDictionary\(game\.id\) : null;/);
  assert.match(games, /setGameDoc\(withGameLanguage\(withStorageShim\(src, game\.id, sync\.snapshot\(\)\.map\), lang, dict,/);
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:gamei18n'], 'node --test src/tests/gameI18n.test.mjs');
  assert.ok(pkg.scripts.test.includes('npm run test:gamei18n'));
  assert.ok(pkg.scripts['i18n:games'], 'nástroj pro texty her');
});
