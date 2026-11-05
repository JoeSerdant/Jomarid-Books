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
  const named = { 'this.SAVE_KEY': 'hannibal_save_v1', BATTLE_KEY: 'hannibal_battle_v1' };
  const used = new Set([...html.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*(?:'([^']+)'|(this\.SAVE_KEY|BATTLE_KEY))/g)].map((m) => m[1] || named[m[2]]));
  assert.ok(html.includes("SAVE_KEY: 'hannibal_save_v1'"));
  assert.ok(html.includes("const BATTLE_KEY = 'hannibal_battle_v1';"));
  assert.deepEqual([...used].sort(), ['hannibal_battle_v1', 'hannibal_endless_best', 'hannibal_muted', 'hannibal_save_v1'], 'hra sahá přesně na tyto čtyři klíče');
  for (const key of used) assert.ok(LEGACY_KEYS.hannibal.includes(key), `${key} chybí v gameSave/catalog.js`);
  assert.deepEqual([...LEGACY_KEYS.hannibal].sort(), ['hannibal_battle_v1', 'hannibal_endless_best', 'hannibal_muted', 'hannibal_save_v1']);
});

test('Jomarid Coins: hra jen žádá (vítězství v kampani 10, v minihře 5, poražená vlna nekonečného tažení 2), o částce rozhoduje server', () => {
  assert.match(html, /rewardCoins\(reason, amount\) \{\s*try \{ if \(typeof jomaridReward === 'function'\) jomaridReward\(reason, amount\); \}/);
  assert.match(html, /if \(node\) this\.rewardCoins\('victory', 10\);/);
  assert.match(html, /if \(result\.success !== false\) \{ this\.rewardCoins\('victory', 5\); this\.track\(/);
  assert.match(html, /this\.rewardCoins\('wave', 2\);/);
  const rewards = [...html.matchAll(/rewardCoins\('(\w+)', (\d+)\)/g)];
  assert.ok(rewards.reduce((sum, m) => sum + Number(m[2]), 0) <= 20, 'jedna událost dává málo, denní strop 100 hlídá server');
  const labels = read(path.join(SRC, 'gameBar', 'rewardLabels.js'));
  for (const reason of new Set(rewards.map((m) => m[1]))) assert.match(labels, new RegExp(`\\b${reason}: tk\\('`), `${reason} má v liště český název`);
});

test('Hry: složka Strategie obsahuje Warroom a Hannibala, ostatní hry zůstávají mimo ni', () => {
  const games = [...gamesPage.matchAll(/\n  \{\n    id: '(\w+)',[\s\S]*?\n  \},/g)].map((m) => [m[1], (m[0].match(/folder: '(\w+)'/) || [])[1]]);
  assert.deepEqual(games.filter(([, f]) => f === 'strategy').map(([id]) => id), ['warroom', 'hannibal']);
  assert.deepEqual(games.filter(([, f]) => !f).map(([id]) => id).sort(), ['chess', 'cityclicker', 'koulovikamosi', 'polygonarena', 'rocket']);
  assert.match(gamesPage, /\{ key: 'strategy', title: tk\('Strategie'\),/);
  // složka se otevírá v adrese, ať se po návratu ze hry ukáže otevřená, a hra vede zpět do své složky
  assert.match(gamesPage, /useSearchParams/);
  assert.match(gamesPage, /params\.get\('slozka'\)/);
  assert.match(gamesPage, /to=\{game\.folder \? `\/games\?slozka=\$\{game\.folder\}` : '\/games'\}/);
});

test('SQL: server pozná hru hannibal pro uložený postup i Coiny', () => {
  const noComments = (f) => fs.readFileSync(path.join(SRC, '..', 'db', f), 'utf8').replace(/--[^\n]*/g, '');
  for (const f of ['game-saves.sql', 'game-coins.sql']) assert.match(noComments(f), /p_game_id not in \([^)]*'hannibal'[^)]*\)/, f);
});

test('rekordy: hra hlásí všechny statistiky z katalogu při každém uložení i při spuštění a prahy odznaků sedí na obsah hry', async () => {
  const { GAME_CATALOG, GAME_BADGES, getStat } = await import('../../../gameRecords/catalog.js');
  const literal = [...html.matchAll(/jomaridRecord\('([a-z_]+)',/g)].map((m) => m[1]);
  const tracked = JSON.parse(html.match(/TRACKED_STATS: (\[[^\]]*\])/s)[1].replace(/'/g, '"').replace(/\s+/g, ' '));
  assert.deepEqual([...literal, ...tracked].sort(), GAME_CATALOG.find((g) => g.id === 'hannibal').stats.map((s) => s.key).sort(), 'hra hlásí přesně statistiky z katalogu');
  assert.match(html, /this\.TRACKED_STATS\.forEach\(k => jomaridRecord\(k, st\[k\]\)\);/);
  assert.match(html, /saveGame\(\) \{[\s\S]*?this\.reportRecords\(data\);\s*\},/, 'po každém uložení');
  assert.match(html, /GameCampaign\.reportRecords\(GameCampaign\.readSave\(\) \|\| \{ nodes: \{\}, doctrines: \{\}, roster: \[\] \}\);/, 'při spuštění (postup z dřívějška)');
  const map = html.slice(html.indexOf('const CAMPAIGN_MAP'));
  const chapters = [...map.slice(0, map.indexOf('\n    };')).matchAll(/^\s{10}id: '(\w+)',$/gm)].length;
  assert.equal(chapters, 11, 'kapitol v kampani');
  const doctrines = [...html.matchAll(/^\s+([A-Z_]+):\s+\{ name: '[^']+', unlocked: false, cost: \d+/gm)].length;
  const badge = (id) => GAME_BADGES.find((b) => b.id === id);
  assert.equal(badge('han_ch11').threshold, chapters);
  assert.equal(getStat('hannibal', 'chapters_completed').max, chapters);
  assert.equal(getStat('hannibal', 'doctrines_unlocked').max, doctrines, 'všechny doktríny ve hře');
  assert.equal(badge('han_doc6').threshold, doctrines);
  assert.ok(badge('han_ch11').description.includes('všech 11 '));
  assert.ok(GAME_BADGES.filter((b) => b.game === 'hannibal').length >= 50);
});

test('čítače: track přičítá a drží nejvyšší hodnoty, loadStats bere z postupu jen vyšší, a každý čítač má ve hře své místo', () => {
  const src = html.match(/track\(inc, max\) \{[\s\S]*?\n      \},\n      \/\/ Čítače z uloženého postupu[^\n]*\n      loadStats\(d\) \{[\s\S]*?\n      \},/)[0];
  const camp = vm.runInNewContext(`({ stats: {}, ${src.replace(/,\s*$/, '')} })`);
  camp.track({ kills: 2, crits: 0, attacks: 1 }, { best_hit: 40 });
  camp.track({ kills: 3 }, { best_hit: 25, gold_peak: 900 });
  assert.deepEqual(JSON.parse(JSON.stringify(camp.stats)), { kills: 5, attacks: 1, best_hit: 40, gold_peak: 900 }, 'nuly se nezapisují, maximum se nesnižuje');
  camp.loadStats({ stats: { kills: 4, attacks: 10, best_hit: 'x', crits: 7 } });
  assert.deepEqual(JSON.parse(JSON.stringify(camp.stats)), { kills: 5, attacks: 10, best_hit: 40, gold_peak: 900, crits: 7 });
  camp.loadStats(null); camp.loadStats({ stats: 5 });
  assert.equal(camp.stats.kills, 5);
  const tracked = JSON.parse(html.match(/TRACKED_STATS: (\[[^\]]*\])/s)[1].replace(/'/g, '"').replace(/\s+/g, ' '));
  for (const key of tracked) assert.match(html, new RegExp(`track\\([^;]*\\b${key}\\b`), key);
  assert.match(html, /nodes, stats: this\.stats \};/, 'čítače jsou v uloženém postupu');
  assert.match(html, /this\.loadStats\(d\);\s+this\.started = true;/, 'načtení postupu čítače nesmaže');
  assert.doesNotMatch(html.slice(html.indexOf('resetState() {'), html.indexOf('nextNode() {')), /stats/, 'nová kampaň čítače nemaže (nejsou v meta)');
});

/* ============================ Rozehraná bitva: uložení a obnovení ============================ */
const battleBlock = () => {
  const start = html.indexOf("const BATTLE_KEY = 'hannibal_battle_v1';");
  const end = html.lastIndexOf('/*', html.indexOf('2. META STRATEGY MANAGER'));
  assert.ok(start > 0 && end > start, 'blok pro uložení bitvy je v souboru');
  return html.slice(start, end);
};
const loadBattleCode = () => {
  const ctx = {};
  vm.runInNewContext(`${battleBlock()}\nthis.normalizeBattleSave = normalizeBattleSave; this.TYPES = BATTLE_UNIT_TYPES;`, ctx);
  return ctx;
};
const methodSrc = (name, indent = 6) => {
  const re = new RegExp(`\\n${' '.repeat(indent)}${name}\\([^)]*\\) \\{\\n[\\s\\S]*?\\n${' '.repeat(indent)}\\}`);
  const m = html.match(re);
  assert.ok(m, `metoda ${name} existuje`);
  return m[0].replace(/^\n/, '');
};
const plain = (v) => JSON.parse(JSON.stringify(v));
const NODES = [{ id: 'saguntum' }, { id: 'rhone' }, { id: 'scipio_chase', kind: 'minigame' }];
const mkUnit = (o = {}) => ({
  id: 'h', name: 'Hannibalova Garda', type: 'hannibal', team: 'player', x: 2, y: 3, hp: 200, maxHp: 220, atk: 45, def: 35, move: 3, range: 1,
  isCavalry: false, ability: 'inspire', abilityUsed: false, hasMoved: false, hasActed: false, facing: 'E', morale: 90, hidden: false, statuses: {}, level: 2, ...o,
});
const mkFoe = (o = {}) => mkUnit({ id: 'e1', name: 'Římská legie', type: 'roman_legion', team: 'enemy', x: 9, y: 3, hp: 140, maxHp: 140, atk: 30, def: 25, move: 2, ability: null, facing: 'W', level: undefined, ...o });
const mkSave = (o = {}) => ({ v: 1, t: 1700000000000, kind: 'campaign', node: 'saguntum', wave: 0, turnNumber: 4, terrain: null, units: [mkUnit(), mkFoe()], ...o });

test('rozehraná bitva: platná uložená bitva projde a vrátí čistou kopii jen se známými poli', () => {
  const { normalizeBattleSave } = loadBattleCode();
  const raw = mkSave({ units: [mkUnit({ evil: 'x', __proto__x: 1, statuses: { chilled: 2, 'ne platné': 3, sleepy: -1, bad: 'a', other: 99, constructor: 3 } }), mkFoe(), mkUnit({ id: 'amb', name: 'Zvěd', type: 'carthage_spearmen', x: 9, y: 6, hidden: true, isAmbush: true, routed: true, _charging: true, level: undefined })] });
  const out = plain(normalizeBattleSave(raw, NODES, ['hannibal', 'roman_legion', 'carthage_spearmen']));
  assert.equal(out.kind, 'campaign');
  assert.equal(out.nodeId, 'saguntum');
  assert.equal(out.turnNumber, 4);
  assert.equal(out.units.length, 3);
  assert.deepEqual(out.units[0].statuses, { chilled: 2 }, 'z účinků zůstanou jen ty, které hra zná (prochladlý, ospalý), a jen s platnou hodnotou');
  assert.ok(!('evil' in out.units[0]) && !('__proto__x' in out.units[0]), 'neznámá pole se nepřenášejí');
  assert.deepEqual(Object.keys(out.units[0]).sort(), ['abilityUsed', 'ability', 'atk', 'def', 'facing', 'hasActed', 'hasMoved', 'hidden', 'hp', 'id', 'isCavalry', 'level', 'maxHp', 'morale', 'move', 'name', 'range', 'statuses', 'team', 'type', 'x', 'y'].sort());
  const amb = out.units[2];
  assert.equal(amb.hidden, true); assert.equal(amb.isAmbush, true); assert.equal(amb.routed, true); assert.equal(amb._charging, true);
  assert.deepEqual(out.stats, {}, 'bez čítačů v uložení zůstane prázdný objekt');
  const flags = plain(normalizeBattleSave(mkSave({ units: [mkUnit({ _charging: false, routed: false, isAmbush: 'ano' }), mkFoe()] }), NODES, ['hannibal', 'roman_legion']));
  assert.equal(flags.units[0]._charging, false, 'příznak, který hra nastavuje na false, zůstane false');
  assert.equal(flags.units[0].routed, false);
  assert.ok(!('isAmbush' in flags.units[0]), 'příznak jiného typu než boolean se nepřenáší');
  assert.ok(!('level' in out.units[1]), 'úroveň se doplňuje jen u jednotek, které ji mají');
  raw.units[0].hp = 1;
  assert.equal(out.units[0].hp, 200, 'výsledek je nezávislá kopie');
  // z textu (tak se čte z úložiště) i z objektu
  assert.equal(plain(normalizeBattleSave(JSON.stringify(mkSave()), NODES, ['hannibal', 'roman_legion'])).turnNumber, 4);
});

test('rozehraná bitva: čítače pro odznaky se čistí (jen známý tvar a smysluplná čísla), vadné čítače nezahodí celou bitvu', () => {
  const { normalizeBattleSave } = loadBattleCode();
  const T = ['hannibal', 'roman_legion'];
  const out = plain(normalizeBattleSave(mkSave({ stats: { kills: 12, best_hit: 63.5, 'Zlé Jméno': 4, damage_dealt: -1, turns: NaN, moves: '5', crits: Infinity, attacks: 0, constructor: 'x', x: 1e13, ok_key: 1e12 } }), NODES, T));
  assert.deepEqual(out.stats, { kills: 12, best_hit: 63.5, attacks: 0, ok_key: 1e12 });
  for (const stats of [null, 5, 'x', [1, 2], undefined]) assert.deepEqual(plain(normalizeBattleSave(mkSave({ stats }), NODES, T)).stats, {}, String(stats));
});

test('rozehraná bitva: nekonečné tažení nese vlnu i terén (ten se při každé vlně losuje)', () => {
  const { normalizeBattleSave } = loadBattleCode();
  const T = ['hannibal', 'roman_legion'];
  const ok = plain(normalizeBattleSave(mkSave({ kind: 'endless', node: null, wave: 7, terrain: { '3,0': 'hill', '4,5': 'forest', '5,2': 'river', '5,3': 'ford', '11,7': 'snow' } }), NODES, T));
  assert.equal(ok.kind, 'endless'); assert.equal(ok.wave, 7); assert.equal(ok.nodeId, null);
  assert.deepEqual(ok.terrain, { '3,0': 'hill', '4,5': 'forest', '5,2': 'river', '5,3': 'ford', '11,7': 'snow' });
  const bad = (terrain, wave = 7) => normalizeBattleSave(mkSave({ kind: 'endless', node: null, wave, terrain }), NODES, T);
  assert.equal(bad(undefined), null, 'bez terénu by se po obnovení změnilo bojiště');
  assert.equal(bad(null), null);
  assert.equal(bad([]), null);
  assert.equal(bad({ '12,0': 'hill' }), null, 'mimo mapu vpravo');
  assert.equal(bad({ '3,8': 'hill' }), null, 'mimo mapu dole');
  assert.equal(bad({ 'a,b': 'hill' }), null);
  assert.equal(bad({ '3,3': 'lava' }), null, 'neznámý terén');
  assert.equal(bad({ '3,3': 'wall' }), null, 'hradby jsou jen v kampani');
  assert.equal(bad({}, 0), null, 'vlna musí být od 1');
  assert.equal(bad({}, 1.5), null);
  assert.ok(bad({}) && bad({}).wave === 7, 'prázdný terén (samá pláň) je v pořádku');
  const tooMany = {}; for (let x = 0; x < 12; x++) for (let y = 0; y < 8; y++) tooMany[`${x},${y}`] = 'hill'; tooMany['0,0x'] = 'hill';
  assert.equal(bad(tooMany), null, 'víc polí, než mapa má');
});

test('rozehraná bitva: poškozená, upravená a cizí data se zahodí (nikdy výjimka)', () => {
  const { normalizeBattleSave } = loadBattleCode();
  const T = ['hannibal', 'roman_legion', 'carthage_spearmen'];
  const n = (raw, nodes = NODES) => normalizeBattleSave(raw, nodes, T);
  for (const raw of [null, undefined, '', 'nejde to', '{', '[]', '5', 'null', 42, true, [], {}]) assert.equal(n(raw), null, String(raw));
  assert.equal(n(mkSave({ v: 2 })), null, 'jiná verze');
  assert.equal(n(mkSave({ v: undefined })), null);
  assert.equal(n(mkSave({ kind: 'minigame' })), null);
  assert.equal(n(mkSave({ node: 'cannae' })), null, 'neznámá kapitola');
  assert.equal(n(mkSave({ node: 'scipio_chase' })), null, 'minihra bitva není');
  assert.equal(n(mkSave({ node: undefined })), null);
  assert.equal(n(mkSave(), []), null, 'bez seznamu kapitol');
  for (const turnNumber of [0, -1, 1.5, 10000, '3', null, NaN]) assert.equal(n(mkSave({ turnNumber })), null, `tah ${turnNumber}`);
  for (const units of [null, 'x', {}, [], [mkUnit()], [mkFoe()], [mkUnit(), mkUnit({ id: 'a', x: 5 }), 7]]) assert.equal(n(mkSave({ units })), null);
  assert.equal(n(mkSave({ units: Array.from({ length: 81 }, (_, i) => mkUnit({ id: 'u' + i, x: i % 12, y: Math.floor(i / 12) % 8, team: i % 2 ? 'enemy' : 'player' })) })), null, 'víc jednotek než pole');
  const one = (o) => n(mkSave({ units: [mkUnit(o), mkFoe()] }));
  assert.ok(one({}), 'základní jednotka je platná');
  const rejected = [
    { team: 'neutral' }, { id: '' }, { id: 5 }, { id: 'x'.repeat(61) }, { name: 7 }, { name: 'x'.repeat(81) }, { type: 'dragon' }, { type: undefined },
    { x: -1 }, { x: 12 }, { y: 8 }, { x: 1.5 }, { x: '2' }, { x: NaN },
    { hp: 0 }, { hp: -5 }, { hp: NaN }, { hp: Infinity }, { hp: '100' }, { hp: 400 }, { maxHp: 0 }, { maxHp: 6000 },
    { atk: -1 }, { atk: 9999 }, { def: NaN }, { move: -1 }, { move: 21 }, { move: 1.5 }, { range: 0 }, { range: 13 }, { morale: -1 }, { morale: 101 }, { morale: NaN },
    { facing: 'X' }, { facing: 'e' }, { facing: undefined }, { isCavalry: 1 }, { abilityUsed: 'ne' }, { hasMoved: null }, { hasActed: undefined }, { hidden: 0 },
    { ability: 5 }, { ability: 'x'.repeat(21) },
  ];
  for (const o of rejected) assert.equal(one(o), null, JSON.stringify(o));
  assert.equal(n(mkSave({ units: [mkUnit(), mkFoe({ x: 2, y: 3 })] })), null, 'dvě jednotky na jednom poli');
  assert.equal(n(mkSave({ units: [mkUnit(), mkFoe({ id: 'h', x: 9, y: 3 }), mkUnit({ id: 'h', x: 4 })] })), null, 'dvě jednotky téhož hráče se stejným id');
  assert.ok(n(mkSave({ units: [mkUnit({ id: 'same' }), mkFoe({ id: 'same' })] })), 'stejné id u hráče a nepřítele je v pořádku');
  assert.equal(n(mkSave({ units: [mkUnit(), mkUnit({ id: 'b', x: 4 })] })), null, 'bez nepřátel by bitva byla vyhraná');
  assert.equal(n(mkSave({ units: [mkFoe(), mkFoe({ id: 'e2', x: 8 })] })), null, 'bez hráčových jednotek by bitva byla prohraná');
  // hlubší pokus o podvržení nesmí nic přepsat
  const out = n(mkSave({ units: [mkUnit({ statuses: { constructor: 3, __proto__: 4, chilled: 1 } }), mkFoe()] }));
  assert.deepEqual(plain(out.units[0].statuses), { chilled: 1 });
  assert.equal({}.chilled, undefined);
});

test('rozehraná bitva: vše, co hra vyrábí, se do uložení vejde (typy jednotek, tvar jednotky z makeUnit)', () => {
  const { normalizeBattleSave, TYPES } = loadBattleCode();
  // všechny typy, které hra zná (getUnitStats) i které do bitvy vkládají scénáře (makeUnit)
  const stats = html.slice(html.indexOf('getUnitStats(type, level = 1'), html.indexOf('base = Object.assign({}, base);'));
  const known = new Set([...stats.matchAll(/case '(\w+)':/g)].map((m) => m[1]));
  for (const m of html.matchAll(/makeUnit\([^,\n]+,[^,\n]+,\s*(?:'(\w+)'|[a-z.]+\))/g)) if (m[1]) known.add(m[1]);
  assert.ok(known.size >= 12, 'našly se typy jednotek');
  for (const type of known) assert.ok(TYPES.includes(type), `${type} chybí v BATTLE_UNIT_TYPES`);
  for (const type of TYPES) assert.ok(known.has(type) || type === 'hannibal', `${type} v seznamu nemá ve hře žádný význam`);
  // jednotka přesně tak, jak ji vyrobí makeUnit
  const makeUnit = vm.runInNewContext(`(${html.match(/function makeUnit\(id, name, type, team, x, y, stats, extra = \{\}\) \{[\s\S]*?\n    \}/)[0].replace(/^function makeUnit/, 'function')})`);
  let i = 0;
  const units = TYPES.map((type) => makeUnit('u' + i, 'Jednotka ' + type, type, i % 2 ? 'enemy' : 'player', i % 12, Math.floor(i++ / 12), { maxHp: 120, atk: 30, def: 20, move: 2, range: type === 'balearic_sling' ? 3 : 1, isCavalry: /cavalry/.test(type), ability: type === 'elephants' ? 'trample' : undefined }));
  units.push(makeUnit('amb', 'Zvěd', 'carthage_spearmen', 'player', 11, 7, { maxHp: 150, atk: 28, def: 30, move: 2, range: 1 }, { hidden: true, isAmbush: true }));
  const out = normalizeBattleSave({ v: 1, kind: 'campaign', node: 'rhone', turnNumber: 2, units: plain(units) }, NODES, TYPES);
  assert.ok(out, 'jednotky z makeUnit projdou');
  assert.equal(out.units.length, units.length);
  for (let k = 0; k < units.length; k++) {
    for (const f of ['id', 'name', 'type', 'team', 'x', 'y', 'hp', 'maxHp', 'atk', 'def', 'move', 'range', 'isCavalry', 'abilityUsed', 'hasMoved', 'hasActed', 'facing', 'morale', 'hidden']) assert.equal(out.units[k][f], units[k][f], `${units[k].type}.${f}`);
    assert.equal(out.units[k].ability, units[k].ability || null);
  }
});

test('rozehraná bitva: ukládá se jen na tahu hráče, hluboká kopie, terén jen v nekonečném tažení', () => {
  const src = methodSrc('serializeBattle');
  const mk = (o = {}, tut = false) => Object.assign(vm.runInNewContext(`({ ${src} })`, { Date, JSON, Object, ...gl(tut) }), {
    turn: 'player', isBattleActive: () => true, meta: {}, isEndless: false, endlessWave: 0, currentScenario: { id: 'rhone' }, turnNumber: 3,
    units: [mkUnit(), mkFoe()], scenarioConf: { terrainMap: { '1,1': 'forest' } }, ...o,
  });
  // GameCampaign a Tutorial jsou globální objekty hry; tady stačí jejich nutné části
  const gl = (tutorialActive) => ({ GameCampaign: { stats: { kills: 3, attacks: 9 } }, Tutorial: { active: tutorialActive } });
  const camp = mk();
  const s = camp.serializeBattle();
  assert.equal(s.v, 1); assert.equal(s.kind, 'campaign'); assert.equal(s.node, 'rhone'); assert.equal(s.wave, 0); assert.equal(s.turnNumber, 3);
  assert.equal(s.terrain, null, 'kampaňové mapy jsou pevné, nic se neukládá navíc');
  assert.deepEqual(plain(s.stats), { kills: 3, attacks: 9 }, 'čítače pro odznaky jsou součástí uložení');
  assert.equal(s.units.length, 2);
  camp.units[0].hp = 5;
  assert.equal(s.units[0].hp, 200, 'uložení je kopie, další tah ji nezmění');
  assert.ok(Number.isFinite(s.t));
  const endless = mk({ isEndless: true, endlessWave: 4, currentScenario: { title: 'Vlna 4' } }).serializeBattle();
  assert.equal(endless.kind, 'endless'); assert.equal(endless.wave, 4); assert.equal(endless.node, null);
  assert.deepEqual(plain(endless.terrain), { '1,1': 'forest' });
  // jen na tahu hráče, jen při běžící bitvě, jen s kampaní a se známou kapitolou
  assert.equal(mk({ turn: 'enemy' }).serializeBattle(), null);
  assert.equal(mk({ isBattleActive: () => false }).serializeBattle(), null, 'okno výsledku nebo jiná obrazovka');
  assert.equal(mk({ meta: null }).serializeBattle(), null);
  assert.equal(mk({ currentScenario: null }).serializeBattle(), null);
  assert.equal(mk({}, true).serializeBattle(), null, 'během výcviku se neukládá (po obnově by se nespustil)');
  // a co uloží, to normalizace přijme
  const { normalizeBattleSave, TYPES } = loadBattleCode();
  assert.ok(normalizeBattleSave(JSON.stringify(s), NODES.concat([{ id: 'rhone' }]), TYPES));
  assert.ok(normalizeBattleSave(JSON.stringify(endless), NODES, TYPES));
});

test('rozehraná bitva: čtení z úložiště zahodí poškozenou bitvu i bitvu, na kterou už nesedí armáda', () => {
  const src = methodSrc('readBattleSave');
  const store = new Map();
  const { normalizeBattleSave, TYPES } = loadBattleCode();
  const make = (roster) => vm.runInNewContext(`({ ${src} })`, {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    normalizeBattleSave, CAMPAIGN_MAP: { nodes: NODES }, BATTLE_UNIT_TYPES: TYPES, BATTLE_KEY: 'hannibal_battle_v1',
  });
  const camp = Object.assign(make(), { meta: { playerRoster: [{ id: 'h' }, { id: 'p2' }] } });
  assert.equal(camp.readBattleSave(), null, 'nic uloženo');
  store.set('hannibal_battle_v1', JSON.stringify(mkSave({ units: [mkUnit(), mkUnit({ id: 'p2', type: 'carthage_spearmen', x: 3 }), mkUnit({ id: 'amb', x: 9, y: 6, hidden: true, isAmbush: true }), mkFoe()] })));
  const ok = camp.readBattleSave();
  assert.ok(ok && ok.units.length === 4, 'armáda sedí (zvěd z léčky v rosteru být nemusí)');
  assert.ok(store.has('hannibal_battle_v1'), 'platná bitva zůstává uložená');
  // jednotka, která v rosteru už není (například po nové kampani), bitvu neguje
  camp.meta.playerRoster = [{ id: 'h' }];
  assert.equal(camp.readBattleSave(), null);
  assert.ok(!store.has('hannibal_battle_v1'), 'nepoužitelná bitva se vymaže, ať nezůstane viset v hubu');
  store.set('hannibal_battle_v1', 'rozbité {');
  assert.equal(camp.readBattleSave(), null);
  assert.ok(!store.has('hannibal_battle_v1'));
  camp.meta = { playerRoster: [] };
  store.set('hannibal_battle_v1', JSON.stringify(mkSave()));
  assert.equal(camp.readBattleSave(), null, 'prázdný roster');
  // bez přístupu k úložišti (soukromé okno) se nic nerozbije
  const noStore = vm.runInNewContext(`({ ${src} })`, { localStorage: { getItem() { throw new Error('zakázáno'); }, removeItem() { throw new Error('zakázáno'); } }, normalizeBattleSave, CAMPAIGN_MAP: { nodes: NODES }, BATTLE_UNIT_TYPES: TYPES, BATTLE_KEY: 'x' });
  noStore.meta = { playerRoster: [] };
  assert.equal(noStore.readBattleSave(), null);
});

test('rozehraná bitva: po vítězství, porážce i ústupu se uložení maže, nová bitva ho přepíše a kampaň od nuly také', () => {
  for (const name of ['onBattleVictory', 'onBattleDefeat', 'onEndlessWaveVictory', 'onEndlessDefeat']) {
    assert.match(methodSrc(name), /window\.gameEngine\.clearBattleSave\(\);/, `${name} maže uloženou bitvu`);
  }
  const retreat = methodSrc('retreatFromBattle');
  assert.match(retreat, /if \(confirm\(confirmMsg\)\) \{\s*window\.gameEngine\.clearBattleSave\(\);/, 'ústup maže až po potvrzení');
  for (const name of ['loadCampaignScenario', 'loadEndlessWave']) {
    assert.match(methodSrc(name), /^\s*\w+\([^)]*\) \{\n\s*if \(!this\._resuming\) this\.clearBattleSave\(\);/, `${name} zahodí staré uložení, ledaže jde o obnovení`);
  }
  assert.match(html, /node\.id === 'saguntum' && this\.meta && !this\.meta\.tutorialDone && typeof Tutorial !== 'undefined' && !this\._resuming/, 'obnovená bitva nespouští výcvik znovu');
  assert.match(html, /if \(window\.gameEngine\) window\.gameEngine\.clearBattleSave\(\);\s*GameCampaign\.resetState\(\);/, 'nová kampaň maže i rozehranou bitvu');
  // jen na tahu hráče a za běhu bitvy se při překreslení plánuje uložení (s odstupem, ne při každém snímku)
  assert.match(methodSrc('render'), /^\s*render\(\) \{\n\s*if \(this\.turn === 'player' && this\.units\.length\) this\.queueBattleSave\(\);/);
  assert.match(methodSrc('queueBattleSave'), /if \(this\._saveT\) return;\s*this\._saveT = setTimeout\(\(\) => \{ this\._saveT = null; this\.saveBattleNow\(\); \}, 600\);/);
  // uložení při zavření i schování stránky, ať se neztratí poslední tah
  assert.match(html, /window\.addEventListener\('pagehide', \(\) => window\.gameEngine\.saveBattleNow\(\)\);/);
  assert.match(html, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.hidden\) window\.gameEngine\.saveBattleNow\(\); \}\);/);
  // uložení se nepíše, když se od posledního nic nezměnilo; chyba úložiště hru neshodí
  const save = methodSrc('saveBattleNow');
  assert.match(save, /if \(cmp === this\._lastBattleSave\) return;/);
  assert.match(save, /try \{ localStorage\.setItem\(BATTLE_KEY, JSON\.stringify\(s\)\); \} catch \(e\)/);
});

test('rozehraná bitva: velitelství nabízí pokračování nebo zahození a obnova nepřepisuje armádu', () => {
  assert.match(html, /<div id="campaign-resume" style="display:none;/);
  assert.match(html, /onclick="GameCampaign\.resumeBattle\(\)"/);
  assert.match(html, /onclick="if \(confirm\('Zahodit rozehranou bitvu\? Postup v ní se ztratí\.'\)\) GameCampaign\.discardBattle\(\)"/, 'zahození chce potvrzení');
  const resume = methodSrc('resumeBattle');
  assert.match(resume, /eng\._resuming = true;[\s\S]*?finally \{ eng\._resuming = false; \}/, 'příznak obnovy se vždy vrátí zpět');
  assert.match(resume, /eng\.units = s\.units;/);
  assert.match(resume, /eng\.turnNumber = s\.turnNumber;/);
  assert.match(resume, /eng\.showBanner\(`Bitva obnovena – tah \$\{s\.turnNumber\}`\);/, 'nápis "Bitva začíná" z načtení se přepíše');
  assert.match(resume, /this\.loadStats\(\{ stats: s\.stats \}\);/, 'čítače se vrací (jen vyšší hodnoty)');
  assert.match(resume, /if \(s\.nodeId === 'saguntum'\) this\.meta\.tutorialDone = true;/);
  // hlavní menu jen nahlíží (neruší uložení dřív, než se načte armáda z postupu)
  const peek = methodSrc('peekBattleSave');
  assert.doesNotMatch(peek, /removeItem/);
  assert.match(html, /if \(\(GameCampaign\.started \|\| save\) && GameCampaign\.peekBattleSave\(\)\) info\.innerText \+= '\\n⚔️ Čeká na tebe rozehraná bitva\.';/);
  assert.match(resume, /eng\.scenarioConf\.terrainMap = s\.terrain;/, 'terén nekonečného tažení se vrací');
  assert.doesNotMatch(resume, /meta\.playerRoster\s*=/, 'obnova armádu v rosteru nemění');
});

/* ============================ Zvuk a omezený pohyb ============================ */
const storeStub = (init = {}, broken = false) => {
  const m = new Map(Object.entries(init));
  const boom = () => { throw new Error('úložiště je zakázané'); };
  return broken ? { getItem: boom, setItem: boom, removeItem: boom, map: m } : { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
};
const loadSound = (store) => {
  const made = { osc: 0, ctx: 0 };
  class FakeAudioContext {
    constructor() { made.ctx++; this.currentTime = 0; this.destination = {}; }
    createOscillator() { made.osc++; return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  const src = html.slice(html.indexOf('class SoundEngine {'), html.indexOf('const audioFX = new SoundEngine();'));
  assert.ok(src.length > 200, 'zdroj SoundEngine se našel');
  const ctx = vm.createContext({ window: { AudioContext: FakeAudioContext }, localStorage: store });
  vm.runInContext(`${src}\nthis.SoundEngine = SoundEngine;`, ctx);
  return { SoundEngine: ctx.SoundEngine, made };
};

test('zvuk: vypnutí se pamatuje, ztlumený zvuk nevytváří žádné oscilátory a chybné úložiště hru nerozbije', () => {
  const store = storeStub();
  const { SoundEngine, made } = loadSound(store);
  const a = new SoundEngine();
  assert.equal(a.muted, false, 'bez uloženého nastavení je zvuk zapnutý');
  a.playSword();
  assert.equal(made.osc, 0, 'před init() (bez kliknutí hráče) se nehraje nic, jako dřív');
  a.init();
  a.playSword(); a.playMarch(); a.playVictory();
  assert.equal(made.osc, 1 + 1 + 4, 'zapnutý zvuk hraje meč, pochod i čtyři tóny vítězství');
  a.setMuted(true);
  assert.equal(store.map.get('hannibal_muted'), '1');
  const before = made.osc;
  a.playSword(); a.playMarch(); a.playVictory();
  assert.equal(made.osc, before, 'ztlumeno: nic se nevytváří');
  // nová návštěva: ztlumení zůstane
  const b = new SoundEngine();
  assert.equal(b.muted, true, 'nastavení se načte z úložiště');
  b.init(); b.playVictory();
  assert.equal(made.osc, before);
  b.setMuted(false);
  assert.ok(!store.map.has('hannibal_muted'), 'zapnutí klíč smaže (nezůstává "0")');
  b.playSword();
  assert.equal(made.osc, before + 1);
  assert.equal(new SoundEngine().muted, false);
  // úložiště, které hází výjimky (soukromé okno, zakázané cookies)
  const { SoundEngine: S2, made: m2 } = loadSound(storeStub({}, true));
  const c = new S2();
  assert.equal(c.muted, false);
  assert.doesNotThrow(() => c.setMuted(true));
  assert.equal(c.muted, true, 'v paměti se ztlumení drží i bez úložiště');
  c.init(); c.playSword();
  assert.equal(m2.osc, 0);
});

test('zvuk: tlačítka v menu, velitelství i bitvě sdílejí jeden stav, klávesa M přepíná a popisky se mění', () => {
  for (const id of ['btn-sound-menu', 'btn-sound-hub', 'btn-sound']) assert.match(html, new RegExp(`class="btn[^"]*sound-toggle" id="${id}"[^>]*onclick="Game\\.toggleSound\\(\\)"`), id);
  assert.match(html, /id="btn-sound-menu" data-full="1"/, 'v menu je popisek celý, jinde jen ikona');
  assert.match(html, /<kbd>M<\/kbd> zvuk/);
  assert.match(html, /\.btn-small\.sound-toggle \{ min-width: 34px; \}/, 'ikona v bitvě má použitelnou šířku pro prst');
  assert.match(html, /\.battle-hud > div:last-child \.btn\.sound-toggle \{ flex: 0 0 auto; min-width: 34px; \}/, 'i na telefonu, kde se tlačítka v řádku mačkají (min-width: 0)');
  assert.match(html, /else if \(e\.key === 'm' \|\| e\.key === 'M'\) \{ Game\.toggleSound\(\); \}/);
  assert.match(html, /window\.gameEngine = new TacticalEngine\('gameCanvas'\);\s*Game\.refreshSoundButtons\(\);/, 'popisky se při startu srovnají s uloženým nastavením');
  const mkBtn = (full) => { const attrs = {}; return { dataset: full ? { full: '1' } : {}, textContent: '', title: '', attrs, setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; } }; };
  const sandbox = {
    buttons: [mkBtn(true), mkBtn(false), mkBtn(false)],
    audioFX: { muted: false, inits: 0, marches: 0, setMuted(m) { this.muted = m; }, init() { this.inits++; }, playMarch() { this.marches++; } },
    String,
  };
  sandbox.document = { querySelectorAll: (q) => (q === '.sound-toggle' ? sandbox.buttons : []) };
  const game = vm.runInNewContext(`({ ${methodSrc('toggleSound')}, ${methodSrc('refreshSoundButtons')} })`, sandbox);
  game.refreshSoundButtons();
  assert.deepEqual(sandbox.buttons.map((b) => b.textContent), ['🔊 Zvuk: zapnutý', '🔊', '🔊']);
  game.toggleSound();
  assert.equal(sandbox.audioFX.muted, true);
  assert.deepEqual(sandbox.buttons.map((b) => b.textContent), ['🔇 Zvuk: vypnutý', '🔇', '🔇']);
  assert.deepEqual(sandbox.buttons.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'false']);
  assert.equal(sandbox.buttons[1].title, 'Zapnout zvuk');
  assert.equal(sandbox.buttons[1].attrs['aria-label'], 'Zapnout zvuk', 'ikona bez popisku má název');
  assert.ok(!('aria-label' in sandbox.buttons[0].attrs), 'tlačítko s viditelným popiskem se jmenuje podle něj (název musí obsahovat viditelný text)');
  assert.equal(sandbox.audioFX.marches, 0, 'vypnutí nic nezahraje');
  game.toggleSound();
  assert.equal(sandbox.audioFX.muted, false);
  assert.deepEqual(sandbox.buttons.map((b) => b.textContent), ['🔊 Zvuk: zapnutý', '🔊', '🔊']);
  assert.deepEqual(sandbox.buttons.map((b) => b.attrs['aria-pressed']), ['true', 'true', 'true']);
  assert.equal(sandbox.buttons[2].title, 'Vypnout zvuk');
  assert.deepEqual([sandbox.audioFX.inits, sandbox.audioFX.marches], [1, 1], 'zapnutí zvuk probudí (kliknutí hráče) a krátce ho předvede');
});

test('omezený pohyb: otřes plátna se při nastavení systému vypne, nápis tahu jen zprůhlední a pulzování zmizí', () => {
  const shake = (matches) => {
    const eng = vm.runInNewContext(`({ ${methodSrc('triggerShake')} })`, { window: { matchMedia: (q) => ({ matches: matches && /prefers-reduced-motion: reduce/.test(q) }) }, Date });
    eng.shakeUntil = 0; eng.shakeMag = 0;
    eng.triggerShake(9);
    return [eng.shakeUntil > 0, eng.shakeMag];
  };
  assert.deepEqual(shake(false), [true, 9], 'běžně se plátno otřese');
  assert.deepEqual(shake(true), [false, 0], 'při „omezit pohyb“ ne');
  // prohlížeč bez matchMedia nic nerozbije
  const bare = vm.runInNewContext(`({ ${methodSrc('triggerShake')} })`, { window: {}, Date });
  bare.triggerShake(4);
  assert.ok(bare.shakeUntil > 0);
  const css = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce) {'));
  const block = css.slice(0, css.indexOf('\n    }') + 6);
  assert.match(block, /\.btn-warn, \.next-badge \{ animation: none !important; \}/, 'pozdější pravidlo .next-badge by jinak pulzování vrátilo');
  assert.match(block, /\.turn-banner\.show \{ animation: bannerFadeCalm 1\.4s linear forwards; \}/);
  assert.match(block, /\* \{ transition-duration: 0\.01ms !important; \}/);
  const calm = html.match(/@keyframes bannerFadeCalm [^\n]*/)[0];
  assert.doesNotMatch(calm, /transform|scale/, 'klidný nápis se nepřibližuje');
  assert.match(calm, /100% \{ opacity: 0; \}/);
});

test('rada „otoč telefon“: po otočení na šířku se skryje (jen dokud by běžela), jinde se nic nemění', () => {
  assert.match(html, /this\._tipUntil = Date\.now\(\) \+ 6000;\s*Game\.toast\('Tip: pro větší bojiště otoč telefon/);
  const fit = methodSrc('fitCanvas');
  assert.match(fit, /if \(this\._tipUntil && Date\.now\(\) < this\._tipUntil && !this\.isPortraitPhone\(\)\) \{ this\._tipUntil = 0; Game\.hideToast\(\); \}/);
  // hideToast: schová hlášku a zruší její časovač
  const calls = [];
  const game = vm.runInNewContext(`({ ${methodSrc('hideToast')} })`, { document: { getElementById: () => ({ classList: { remove: (c) => calls.push('remove:' + c) } }) }, clearTimeout: (t) => calls.push('clear:' + t) });
  game._toastTimer = 7;
  game.hideToast();
  assert.deepEqual(calls, ['remove:show', 'clear:7']);
  // fitCanvas: tip se skryje jen při přechodu z výšky na šířku v době jeho zobrazení
  const run = (portrait, until) => {
    const hidden = [];
    const eng = vm.runInNewContext(`({ ${fit} })`, {
      Date, Game: { hideToast: () => hidden.push(1) }, Math, parseFloat, window: { getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0', paddingTop: '0', paddingBottom: '0' }) },
    });
    Object.assign(eng, { canvas: { width: 900, height: 600, style: {}, parentElement: { clientWidth: 800, clientHeight: 500 } }, isPortraitPhone: () => portrait, _tipUntil: until });
    eng.fitCanvas();
    return [hidden.length, eng._tipUntil];
  };
  const soon = Date.now() + 5000;
  assert.deepEqual(run(true, soon), [0, soon], 'dál na výšku: rada zůstává');
  assert.deepEqual(run(false, soon), [1, 0], 'otočeno na šířku: rada zmizí');
  const expired = Date.now() - 1000;
  assert.deepEqual(run(false, expired), [0, expired], 'už vypršela: nic se neskrývá (nezasahuje do jiných hlášek)');
  assert.deepEqual(run(false, 0), [0, 0], 'rada se nikdy neukázala');
});

test('uložený postup kampaně: při čtení se vadné hodnoty opraví a nic platného se nezmění', () => {
  const start = html.indexOf('function cleanCampaignSave(');
  const end = html.lastIndexOf('/*', html.indexOf('2. META STRATEGY MANAGER'));
  const clean = vm.runInNewContext(`(${html.slice(start, end).trim().replace(/;\s*$/, '')})`, { Math, Number, Array, Object, Set, isFinite, Number });
  const TYPES = ['hannibal', 'carthage_spearmen', 'numidian_cavalry', 'elephants', 'balearic_sling'];
  const label = (t) => ({ elephants: 'Bojoví sloni', hannibal: 'Hannibalova Garda' }[t]);
  const start0 = { v: 1, savedAt: 5, gold: 500, manpower: 10000, senateFavor: 50, tutorialDone: true, saguntumBonusGiven: false, doctrines: { SACRED_BAND: true }, nodes: { saguntum: { unlocked: true, completed: true } }, stats: { kills: 3 },
    roster: [
      { id: 'u_hannibal', type: 'hannibal', name: 'Hannibalova Garda', xp: 120, level: 3, hpPercent: 1.0 },
      { id: 'u_spear_1', type: 'carthage_spearmen', name: '1. Africká Falanx', xp: 40, level: 1, hpPercent: 0.35 },
      { id: 'u_balearic_sling_1793814310573', type: 'balearic_sling', name: 'Baleárští prakovníci 2', xp: 0, level: 1, hpPercent: 0.05 },
    ] };
  const same = plain(clean(start0, TYPES, label));
  assert.deepEqual(same, start0, 'platný postup (včetně výchozího xp 120 u Hannibala a nejnižšího zdraví 5 %) se nezmění ani na vlas');
  assert.notEqual(clean(start0, TYPES, label), start0, 'vrací kopii, ne původní objekt');
  // není to postup
  for (const bad of [null, undefined, 5, 'x', [], {}, { v: 2, roster: [], gold: 1 }, { v: 1, roster: 'x', gold: 1 }, { v: 1, roster: [], gold: '5' }, { v: 1, roster: [], gold: null }]) assert.equal(clean(bad, TYPES, label), null, JSON.stringify(bad));
  // oprava hodnot
  const mixed = plain(clean({ v: 1, gold: -50, manpower: 1e12, senateFavor: 'x', roster: [
    null, 7, [], { id: 'a', type: 'dragon' }, { type: 'elephants', id: '' }, { type: 'elephants', id: 'x'.repeat(61) },
    { id: 'ok1', type: 'elephants', name: 5, level: 'x', xp: 'NaN', hpPercent: 'x' },
    { id: 'ok1', type: 'elephants', name: 'duplicita' },
    { id: 'ok2', type: 'hannibal', name: '', level: 2.5, xp: -4, hpPercent: 7 },
    { id: 'ok3', type: 'numidian_cavalry', name: 'x'.repeat(81), level: 1e9, xp: 1e9, hpPercent: -1 },
    { id: 'ok4', type: 'carthage_spearmen', name: { a: 1 }, level: null, xp: null, hpPercent: null },
  ] }, TYPES, label));
  assert.equal(mixed.gold, 0); assert.equal(mixed.manpower, 1e9); assert.equal(mixed.senateFavor, 50);
  assert.deepEqual(mixed.roster.map((u) => u.id), ['ok1', 'ok2', 'ok3', 'ok4'], 'nepoužitelné a opakované jednotky se zahodí');
  assert.deepEqual(mixed.roster[0], { id: 'ok1', type: 'elephants', name: 'Bojoví sloni', level: 1, xp: 0, hpPercent: 1 }, 'chybné jméno se doplní podle typu');
  assert.deepEqual(mixed.roster[1], { id: 'ok2', type: 'hannibal', name: 'Hannibalova Garda', level: 1, xp: 0, hpPercent: 1 });
  assert.deepEqual(mixed.roster[2], { id: 'ok3', type: 'numidian_cavalry', name: 'numidian_cavalry', level: 99, xp: 1000, hpPercent: 0.05 }, 'bez štítku se jméno zalomí na typ');
  assert.deepEqual(mixed.roster[3], { id: 'ok4', type: 'carthage_spearmen', name: 'carthage_spearmen', level: 1, xp: 0, hpPercent: 1 });
  // kapitoly: jen objekty se dvěma pravdivostními příznaky (menu postup sčítá hodnoty bez kontroly na null)
  const nodes = plain(clean({ v: 1, gold: 1, roster: [], nodes: { a: null, b: 5, c: 'x', d: [], e: { unlocked: 1, completed: 0 }, f: { completed: 'ano' } } }, TYPES, label)).nodes;
  assert.deepEqual(nodes, { d: { unlocked: false, completed: false }, e: { unlocked: true, completed: false }, f: { unlocked: false, completed: true } });
  for (const bad of [undefined, null, 5, 'abc', [1, 2]]) assert.deepEqual(plain(clean({ v: 1, gold: 1, roster: [], nodes: bad }, TYPES, label)).nodes, {}, String(bad));
  // prázdná armáda je platný stav (po zničení armády se verbuje znovu) a příliš dlouhý seznam se zkrátí
  assert.deepEqual(plain(clean({ v: 1, gold: 1, roster: [] }, TYPES, label)).roster, []);
  const big = Array.from({ length: 200 }, (_, i) => ({ id: 'u' + i, type: 'elephants', name: 'S' + i, xp: 0, level: 1, hpPercent: 1 }));
  assert.equal(clean({ v: 1, gold: 1, roster: big }, TYPES, label).roster.length, 60);
  assert.match(html, /return cleanCampaignSave\(JSON\.parse\(raw\), Object\.keys\(UNIT_INFO\), t => UNIT_INFO\[t\]\.label\);/, 'readSave používá čištění pro všechny, kdo postup čtou, a v armádě jsou jen jednotky hráče');
  // armáda hráče má jen typy z UNIT_INFO, a ty umí verbování i počáteční armáda
  const info = html.slice(html.indexOf('const UNIT_INFO = {'), html.indexOf('const ABILITY_INFO'));
  const playerTypes = [...info.matchAll(/^\s+(\w+):\s+\{ label:/gm)].map((m) => m[1]);
  assert.deepEqual(playerTypes.sort(), ['balearic_sling', 'carthage_spearmen', 'celtiberian_swordsman', 'elephants', 'hannibal', 'libyan_heavy', 'numidian_cavalry']);
  for (const m of html.matchAll(/\{ id: 'u_\w+', type: '(\w+)'/g)) assert.ok(playerTypes.includes(m[1]), `počáteční armáda: ${m[1]}`);
});

test('čeština: množné číslo jednotek v hlášce o doplnění armády (1 jednotka, 2 až 4 jednotky, jinak jednotek)', () => {
  const src = html.match(/    function czPlural\(n, one, few, many\) \{[\s\S]*?\n    \}\n/)[0];
  const f = vm.runInNewContext(`(${src.trim().replace(/^function czPlural/, 'function')})`, { Math });
  const cases = { 0: 'jednotek', 1: 'jednotka', 2: 'jednotky', 3: 'jednotky', 4: 'jednotky', 5: 'jednotek', 10: 'jednotek', 11: 'jednotek', 12: 'jednotek', 13: 'jednotek', 14: 'jednotek', 15: 'jednotek',
    20: 'jednotek', 21: 'jednotek', 22: 'jednotky', 24: 'jednotky', 25: 'jednotek', 100: 'jednotek', 101: 'jednotek', 102: 'jednotky', 111: 'jednotek', 112: 'jednotek', 1000: 'jednotek' };
  for (const [n, word] of Object.entries(cases)) assert.equal(f(Number(n), 'jednotka', 'jednotky', 'jednotek'), word, `${n}`);
  assert.equal(f(-2, 'a', 'b', 'c'), 'b');
  assert.match(html, /Doplněno \$\{healed\} \$\{czPlural\(healed, 'jednotka', 'jednotky', 'jednotek'\)\}/);
});

/* ============================ Tah nepřítele po jednotkách ============================ */
const engineFn = (...names) => vm.runInNewContext(`({ ${names.map((n) => methodSrc(n)).join(',\n')} })`, { Math, Object, Map, Set, Date, setTimeout: (fn, ms) => ({ fn, ms }), clearTimeout: () => {}, document: { getElementById: () => ({ classList: { contains: () => true } }) }, Game: { toast() {} } });

test('tah nepřítele: rozhodnutí (planEnemy) je bez vedlejších účinků a drží původní pravidla (útěk, nejslabší cíl v dosahu, bok a záda, přiblížení)', () => {
  const eng = engineFn('planEnemy');
  const mkU = (o) => ({ hp: 100, maxHp: 100, range: 1, routed: false, ...o });
  const setup = (units, reach, angle = () => 'front') => Object.assign(eng, { units, isVisibleTo: () => true, getReachableTiles: () => reach, classifyAngle: angle });
  const enemy = mkU({ id: 'e', team: 'enemy', x: 5, y: 3 });
  // nikdo k vidění
  setup([enemy], {});
  assert.deepEqual(plain(eng.planEnemy(enemy)), { kind: 'none' });
  // v panice prchá (a je vidět, před kým)
  const p1 = mkU({ id: 'p1', team: 'player', x: 6, y: 3 });
  setup([enemy, p1], { '4,3': 1 });
  assert.equal(eng.planEnemy({ ...enemy, routed: true }).kind, 'flee');
  // v dosahu bije nejslabšího, bez přesunu
  const weak = mkU({ id: 'p2', team: 'player', x: 4, y: 3, hp: 10 });
  setup([enemy, p1, weak], { '4,2': 1 });
  const atk = eng.planEnemy(enemy);
  assert.equal(atk.kind, 'attack'); assert.equal(atk.target, weak);
  // mimo dosah: vybere pole, ze kterého zasáhne zezadu, i když je delší cesta
  const far = mkU({ id: 'p3', team: 'player', x: 8, y: 3 });
  setup([enemy, far], { '7,3': 2, '8,4': 3, '8,2': 3 }, (from) => (from.x === 8 && from.y === 4 ? 'rear' : from.x === 7 ? 'front' : 'flank'));
  const mv = eng.planEnemy(enemy);
  assert.equal(mv.kind, 'moveAttack'); assert.deepEqual(plain(mv.dest), { x: 8, y: 4, cost: 3 }); assert.equal(mv.target, far);
  // úplně mimo dosah: přiblíží se k nejbližšímu hráči (nejkratší vzdálenost), případně zůstane stát
  const veryFar = mkU({ id: 'p4', team: 'player', x: 11, y: 3 });
  setup([enemy, veryFar], { '6,3': 1, '5,2': 1, '7,3': 2 });
  assert.deepEqual(plain(eng.planEnemy(enemy)), { kind: 'approach', dest: { x: 7, y: 3 } });
  setup([enemy, veryFar], {});
  assert.deepEqual(plain(eng.planEnemy(enemy)), { kind: 'approach', dest: null });
  // plánování nic nemění
  assert.deepEqual([enemy.x, enemy.y, enemy.hp, weak.hp], [5, 3, 100, 10]);
});

test('tah nepřítele: pauzy jdou přeskočit (rozdělaná skončí hned, další se nečekají) a ústup nebo nová bitva tah ukončí', () => {
  const timers = [];
  const eng = vm.runInNewContext(`({ ${methodSrc('phaseAlive')}, ${methodSrc('phaseWait')}, ${methodSrc('skipEnemyAnimation')} })`, {
    Math, clearTimeout: (t) => { t.cleared = true; }, setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    document: { getElementById: () => ({ classList: { contains: () => eng.screenActive !== false } }) },
  });
  eng._battleSeq = 3;
  const ph = eng._phase = { seq: 3, skip: false, pending: null, scale: 0.5 };
  const log = [];
  eng.phaseWait(ph, 400, () => log.push('a'));
  assert.equal(timers.length, 1); assert.equal(timers[0].ms, 200, 'pauza se zkracuje podle počtu nepřátel (scale)');
  assert.deepEqual(log, []);
  eng.skipEnemyAnimation();
  assert.deepEqual(log, ['a'], 'rozdělaná pauza skončí hned');
  assert.ok(timers[0].cleared && ph.pending === null && ph.skip === true);
  eng.phaseWait(ph, 400, () => log.push('b'));
  assert.deepEqual(log, ['a', 'b'], 'po přeskočení se nečeká vůbec');
  eng.skipEnemyAnimation(); // opakované přeskočení nic nedělá
  eng.phaseWait({ ...ph, skip: false, pending: null }, 0, () => log.push('c'));
  assert.deepEqual(log, ['a', 'b', 'c'], 'nulová pauza proběhne hned');
  // ústup (obrazovka bitvy není aktivní) nebo nová bitva (jiné číslo) uprostřed pauzy: nic se nedovykoná
  const ph2 = eng._phase = { seq: 3, skip: false, pending: null, scale: 1 };
  eng.phaseWait(ph2, 300, () => log.push('d'));
  eng.screenActive = false;
  timers[timers.length - 1].fn();
  assert.ok(!log.includes('d'), 'po odchodu z bitvy se nic nevyhodnotí');
  eng.screenActive = true;
  const ph3 = eng._phase = { seq: 3, skip: false, pending: null, scale: 1 };
  eng.phaseWait(ph3, 300, () => log.push('e'));
  eng._battleSeq = 4;
  timers[timers.length - 1].fn();
  assert.ok(!log.includes('e'), 'nová bitva ukončí tah nepřítele z té předchozí');
  assert.equal(eng.phaseAlive(ph3), false);
  assert.equal(eng.skipEnemyAnimation.call({ _phase: null }), undefined);
});

test('tah nepřítele: zapojení (klepnutí a Mezerník přeskočí, odložený start patří své bitvě, nová bitva čísluje, jednající jednotka se zvýrazní)', () => {
  assert.match(methodSrc('handleCanvasClick'), /handleCanvasClick\(e\) \{\n\s*if \(this\.turn === 'enemy'\) \{ this\.skipEnemyAnimation\(\); return; \}\n\s*if \(this\.turn !== 'player'\) return;/);
  assert.match(methodSrc('handleKey'), /if \(this\.turn === 'enemy' && \(e\.key === 'Enter' \|\| e\.key === ' '\)\) \{ e\.preventDefault\(\); this\.skipEnemyAnimation\(\); return; \}/);
  const end = methodSrc('endTurn');
  assert.match(end, /const seq = this\._battleSeq;\s*setTimeout\(\(\) => \{[\s\S]*?this\._battleSeq === seq && screen && screen\.classList\.contains\('active'\)\) this\.runEnemyPhase\(\);/, 'ústup během půlsekundy před tahem nepřítele nespustí tah v cizí bitvě');
  assert.match(methodSrc('resetBattleUiState'), /this\._battleSeq = \(this\._battleSeq \|\| 0\) \+ 1;[\s\S]*?this\._phase = null;\s*this\.actingUnit = null;/);
  assert.match(html, /if \(this\.selectedUnit === u \|\| this\.actingUnit === u\) \{\s*this\.ctx\.strokeStyle = this\.actingUnit === u \? '#ff7043' : '#ffd700';/);
  // konec fáze se vyhodnotí jednou, až po posledním nepříteli, a stejně jako dřív (stopy, obnovení příznaků, kontrola konce)
  const fin = methodSrc('finishEnemyPhase');
  assert.match(fin, /this\._phase = null;[\s\S]*?this\.applyGlobalAttrition\(\);\s*this\.tickStatuses\(\);[\s\S]*?this\.turnNumber \+= 1;\s*this\.turn = 'player';[\s\S]*?this\.checkBattleEnd\(\);\s*this\.autoFleeRoutedPlayers\(\);/);
  const run = methodSrc('runEnemyPhase');
  assert.match(run, /if \(i >= queue\.length\) \{ this\.finishEnemyPhase\(ph\); return; \}/);
  assert.match(run, /Tah nepřítele jde přeskočit klepnutím na plátno nebo klávesou Mezerník\./);
  assert.doesNotMatch(methodSrc('stepEnemy'), /checkBattleEnd/, 'konec bitvy se nevyhodnocuje po jednotlivých jednotkách');
});

test('záhlaví bitvy roste podle obsahu (dřív mělo pevnou výšku a na šířkách 1000 až 1280 px ořezávalo název nahoře)', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const hud = css.match(/\n    \.battle-hud \{([^}]*)\}/)[1];
  assert.match(hud, /min-height: 65px;/);
  assert.doesNotMatch(hud, /(^|[^-])height: 65px/, 'žádná pevná výška');
  assert.match(hud, /padding: 6px 20px;/);
  assert.match(css, /\.battle-hud > div:first-child \{ min-width: 0; \}/);
  // úzké obrazovky mají vlastní pravidlo s height: auto, to zůstává
  assert.match(css, /\.battle-hud, \.minigame-hud \{ height: auto; min-height: 48px;/);
});
