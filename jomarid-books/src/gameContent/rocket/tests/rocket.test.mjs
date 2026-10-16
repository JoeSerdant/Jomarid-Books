// Testy Rocket Game: skládání dokumentu, napojení na appku, režimy Peklo a Insane Peklo, bossové, tajný kód. Samotný chod hry se zkouší v prohlížeči (hra je plátno).
//   npm run test:rocket
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { GAME_BADGES, GAME_CATALOG } from '../../../gameRecords/catalog.js';

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
  assert.match(html, /\['normal', 'hard', 'inferno', 'insane', 'blitz', 'rush', 'zen', 'daily'\]\.includes\(mode\)/);
  assert.match(html, /this\.isHardMode = \(this\.mode === 'hard' \|\| this\.inferno\)/);
  assert.match(html, /get inferno\(\) \{\s*return this\.mode === 'inferno' \|\| this\.mode === 'insane';/);
  assert.match(html, /best: \{ normal: 0, hard: 0, inferno: 0,/);
  assert.match(html, /getElementById\('rec-inferno'\)\.innerText = /);
  assert.match(html, /inferno: 'Peklo'/);
});

test('Peklo: čísla odpovídají zadání (víc a odolnější nepřátelé, asteroidy hustěji, power-upů míň)', () => {
  const m = html.match(/const INFERNO = (\{[\s\S]*?\n\});/);
  assert.ok(m, 'konstanty Pekla');
  const I = vm.runInNewContext('(' + m[1] + ')');
  assert.ok(I.dmgTakenMult > 1);
  assert.ok(I.enemyHpMult > 1 && I.bossHpMult > 1);
  assert.ok(I.powerupMult < 1 && I.pickupMult < 1);
  assert.ok(I.extraEnemies > 0 && I.gapMult < 1 && I.maxLeft > 2);
  assert.ok(I.asteroidBurst >= 2 && I.asteroidGapMult < 1 && I.asteroidChance > 0.0012 && I.asteroidScoreMin < 500 && I.asteroidDuration > 12000 && I.eventCooldown < 16000);
});

test('štít vykryje jen 50 % poškození ve všech režimech, v Pekle ho asteroid probíjí celý', () => {
  assert.match(html, /const SHIELD_BLOCK = 0\.5;/);
  assert.match(html, /takeDamage\(amount, iframes, shieldBlock\)/);
  assert.match(html, /const shieldBlock = \(\(this\.inferno && piercing\) \|\| \(this\.insane && fromBoss\)\) \? 0 : SHIELD_BLOCK;/);
  assert.match(html, /this\.damagePlayer\(dmg, e\.indestructible \? 900 : 400, e\.type === 'asteroid'\)/);
  assert.doesNotMatch(html, /if \(this\.shieldTimer > 0 \|\| this\.invulnTimer > 0\) return false;/, 'starý štít, který pohltil všechno');
  assert.match(html, /štít ti na chvíli pohltí polovinu zásahů/);
});

test('v Pekle se do vlny nepočítají asteroidy, takže nepřátelé chodí i během pole asteroidů', () => {
  assert.match(html, /g\.enemies\.filter\(e => e\.type !== 'asteroid'\)\.length : g\.enemies\.length/);
});

test('tajné kódy: pole vypadá jako číslo verze úplně dole v menu, 67MILUJU otevře cheat menu, IMAGINEFLEXITSTVOJIMMENEM dál doplní hvězdný prach', () => {
  assert.match(html, /const CHEAT_CODE = '67MILUJU';/);
  assert.match(html, /const STARDUST_CODE = 'IMAGINEFLEXITSTVOJIMMENEM';/);
  assert.match(html, /String\(value \|\| ''\)\.replace\(\/\\s\+\/g, ''\)\.toUpperCase\(\)/, 'velikost písmen a mezery nevadí');
  // pole je poslední věc v menu, vypadá jako verze (placeholder v2.9), nemá tlačítko Aktivovat ani popisek „Tajný kód“
  const menu = html.slice(html.indexOf('<div id="menu-overlay"'), html.indexOf('<div id="stats-overlay"'));
  assert.match(menu, /<div class="vfoot">[\s\S]*<input type="text" id="secret-input" class="vfield" placeholder="v\d+\.\d+"[\s\S]*<\/div>\s*<\/div>\s*$/, 'patička s polem je úplně na konci menu');
  assert.doesNotMatch(menu, /btn-secret|Aktivovat|placeholder="Tajný kód"/);
  assert.match(menu, /aria-label="Tajný kód"/);
  // výjimka: starý kód na hvězdný prach funguje beze změny (+1 000 000, strop 1 mld.)
  assert.match(html, /Storage\.data\.stardust = Math\.min\(\(Storage\.data\.stardust \|\| 0\) \+ 1000000, 1000000000\);/);
  assert.match(html, /code === STARDUST_CODE/);
  // česká klávesnice: číslice podle kódu klávesy
  assert.match(html, /const m = \/\^\(\?:Digit\|Numpad\)\(\\d\)\$\/\.exec\(e\.code \|\| ''\);/);
  // CSS: písmo aspoň 16 px, ať iOS při klepnutí nepřibližuje
  assert.match(html, /\.vfield \{[^}]*font-size: 16px;/);
});

test('cheat menu v Rocketu: mince, prach, loď na maximum, boss 14 a rekordy skóre ve všech režimech se zapíšou do skutečného postupu a nahlásí appce', () => {
  const overlay = html.slice(html.indexOf('<div id="cheat-overlay"'), html.indexOf('<div id="pause-overlay"'));
  for (const id of ['coins', 'stardust', 'maxship', 'boss', 'score-normal', 'score-hard', 'score-inferno', 'score-insane', 'score-blitz', 'rush', 'lifetime']) assert.ok(overlay.includes(`data-cheat="${id}"`), id);
  assert.match(html, /boss: \(\) => \{ Storage\.data\.stats\.bestBossLevel = Math\.max\(Storage\.data\.stats\.bestBossLevel \|\| 0, 14\);/, 'boss 14 odemkne NEMESIS i GLITCH');
  assert.match(html, /Storage\.data\.best\[mode\] = Math\.max\(Storage\.data\.best\[mode\] \|\| 0, CHEAT_SCORE\);/, 'rekord se jen zvyšuje');
  assert.match(html, /const CHEAT_SCORE = 3000;/);
  assert.match(html, /maxship: \(\) => \{ for \(const u of UPGRADES\) Storage\.data\.upgrades\[u\.key\] = MAX_LVL;/);
  // po každém cheatu se postup uloží (to ho nahlásí appce přes reportRecords), obnoví se menu a vyhodnotí relikvie
  assert.match(html, /const text = CHEATS\[btn\.dataset\.cheat\]\(\);\s*Storage\.save\(\);\s*UI\.refresh\(\);\s*UI\.renderStats\(\);\s*Relics\.check\(\);/);
});

test('strom Vzestupu: nové uzly za hvězdný prach mají cenu, strop, uložení a napojení do hry', () => {
  const m = html.match(/const PRESTIGE_TREE = (\[[\s\S]*?\n\]);/);
  assert.ok(m, 'PRESTIGE_TREE');
  const tree = vm.runInNewContext(m[1]);
  const byId = Object.fromEntries(tree.map((n) => [n.id, n]));
  for (const id of ['armor', 'startShield', 'heal', 'loot', 'discount', 'combo']) {
    const n = byId[id];
    assert.ok(n, id);
    assert.ok(n.max >= 4 && n.max <= 10, `${id}: max`);
    assert.ok(n.cost(0) > 0 && n.cost(n.max - 1) > n.cost(0), `${id}: cena roste`);
    assert.match(html, new RegExp(`${id}: 0[,\\s]`), `${id} v uložených výchozích hodnotách`);
  }
  assert.equal(new Set(tree.map((n) => n.id)).size, tree.length, 'unikátní id');
  assert.match(html, /prestigeBonus\('armor', 0\.02\)/);
  assert.match(html, /prestigeLevel\('startShield'\) \* 1500/);
  assert.match(html, /prestigeBonus\('heal', 0\.1\)/);
  assert.match(html, /prestigeBonus\('loot', 0\.03\)/);
  assert.match(html, /prestigeBonus\('discount', 0\.03\)/);
  assert.match(html, /prestigeBonus\('combo', 0\.1\)/);
  // stropy, ať se hra nerozbije: pancíř nejvýš -20 %, sleva nejvýš -15 %
  assert.ok(byId.armor.max * 0.02 <= 0.2 && byId.discount.max * 0.03 <= 0.15);
});


test('Insane Peklo je zapsané na všech místech: odemčení za 1000 ✦, karta, start, rekord, konec hry', () => {
  assert.match(html, /<button class="mode-card insane hidden" id="btn-start-insane">/);
  assert.match(html, /Pro ty, co si mysleli, že Peklo je lehké/);
  assert.match(html, /id="rec-insane"/);
  assert.match(html, /getElementById\('btn-start-insane'\)\.onclick = \(\) => Game\.start\('insane'\)/);
  assert.match(html, /getElementById\('btn-start-insane'\)\.classList\.toggle\('hidden', !Storage\.data\.prestige\.insaneUnlocked\)/);
  assert.match(html, /insaneUnlocked: false/);
  assert.match(html, /best: \{ normal: 0, hard: 0, inferno: 0, insane: 0,/);
  assert.match(html, /insane: 'Insane Peklo'/);
  const tree = vm.runInNewContext(html.match(/const PRESTIGE_TREE = (\[[\s\S]*?\n\]);/)[1]);
  const node = tree.find((n) => n.id === 'insaneUnlocked');
  assert.ok(node && node.unlock && node.max === 1 && node.cost(0) === 1000, 'odemykací uzel za 1000');
});

test('Insane Peklo: čísla odpovídají zadání (+75 % bossové, +70 % nepřátelé, vše tvrdší než Peklo)', () => {
  const I = vm.runInNewContext('(' + html.match(/const INFERNO = (\{[\s\S]*?\n\});/)[1] + ')');
  const N = vm.runInNewContext('(' + html.match(/const INSANE = (\{[\s\S]*?\n\});/)[1] + ')');
  // stejný tvar jako INFERNO, aby šel brát místo něj (g.hell)
  for (const k of Object.keys(I)) assert.ok(k in N, 'chybí ' + k);
  assert.ok(Math.abs(N.bossHpMult / I.bossHpMult - 1.75) < 0.01, 'bossové o 75 % víc než v Pekle');
  assert.ok(Math.abs(N.enemyHpMult / I.enemyHpMult - 1.7) < 0.01, 'nepřátelé o 70 % víc než v Pekle');
  assert.ok(N.extraEnemies > I.extraEnemies && N.gapMult < I.gapMult && N.maxLeft > I.maxLeft, 'nepřátelé častěji');
  assert.ok(N.asteroidChance > I.asteroidChance && N.asteroidGapMult < I.asteroidGapMult && N.asteroidBurst > I.asteroidBurst && N.eventCooldown < I.eventCooldown, 'asteroidy častěji a hustěji');
  assert.ok(N.powerupMult < I.powerupMult && N.pickupMult < I.pickupMult, 'power-upy vzácnější');
  assert.ok(N.bossRate > 1 && N.destroyerFireMult < 1 && N.destroyerShots > 1 && N.heavyWeight > 1 && N.tankUpgrade > 0, 'bossové rychleji, destroyer víc, těžší nepřátelé častěji');
  assert.ok(N.powerupTimeMult < 1 && N.healMult < 1 && N.hpMult < 1 && N.dmgMult < 1 && N.fireRateMult > 1, 'slabší loď a power-upy');
});

test('bossové chodí v Pekle řidčeji a v Insane Pekle ještě řidčeji (násobek skóre), jinde beze změny', () => {
  const I = vm.runInNewContext('(' + html.match(/const INFERNO = (\{[\s\S]*?\n\});/)[1] + ')');
  const N = vm.runInNewContext('(' + html.match(/const INSANE = (\{[\s\S]*?\n\});/)[1] + ')');
  assert.ok(I.bossScoreMult > 1 && N.bossScoreMult > I.bossScoreMult, 'Peklo řidší než ostatní režimy, Insane Peklo řidší než Peklo');
  assert.equal(I.bossScoreMult, 1.5);
  assert.equal(N.bossScoreMult, 2);
  // nextBossScore se spustí tak, jak je ve hře napsané (bez zbytku třídy)
  const thr = vm.runInNewContext(html.match(/const BOSS_THRESHOLDS = (\[[^\]]*\]);/)[1]);
  const src = html.match(/nextBossScore\(\) \{([\s\S]*?)\n    \}\n/)[1];
  const next = new Function('BOSS_THRESHOLDS', 'game', `return (function () {${src}}).call(game)`);
  const at = (count, extra) => next(thr, { bossCount: count, inferno: false, ...extra });
  assert.deepEqual([0, 1, 12].map((c) => at(c)), [150, 650, 20400], 'normální režimy: stejné prahy jako dřív');
  assert.equal(at(13), 20400 + 3400, 'za poslední pevnou hranicí dál po 3400');
  assert.deepEqual([0, 1, 12].map((c) => at(c, { inferno: true, hell: I })), [225, 975, 30600], 'Peklo: o polovinu později');
  assert.deepEqual([0, 1, 12].map((c) => at(c, { inferno: true, hell: N })), [300, 1300, 40800], 'Insane Peklo: dvakrát později');
  assert.equal(at(14, { inferno: true, hell: N }), (20400 + 2 * 3400) * 2, 'násobek platí i za pevnými hranicemi');
  assert.equal(at(0, { inferno: true, hell: {} }), 150, 'režim bez násobku se chová jako normální (žádné NaN)');
  assert.ok(html.includes('řidší bossové'), 'karta Pekla to říká');
});

test('Insane Peklo se projeví v kódu: bossové probíjejí štít, nepřátelé chodí i při bossovi, slabší loď, destroyer ve vějíři', () => {
  assert.match(html, /get insane\(\) \{\s*return this\.mode === 'insane';/);
  assert.match(html, /get hell\(\) \{\s*return this\.insane \? INSANE : INFERNO;/);
  assert.doesNotMatch(html, /INFERNO\.\w+/, 'čísla Pekla se berou přes g.hell, ne napřímo');
  assert.match(html, /\(g\.bossActive && !g\.insane\) \|\| g\.tutActive \|\| g\.mode === 'rush'/);
  for (const call of ['damagePlayer(14, 620, false, true)', 'damagePlayer(12, 500, false, true)', 'damagePlayer(26, 900, false, true)', 'damagePlayer(b.dmg, 400, false, b.fromBoss)']) {
    assert.ok(html.includes(call), call);
  }
  assert.equal((html.match(/b\.fromBoss = true;/g) || []).length, 2, 'střely bosse jsou označené (fire i fireRaw)');
  assert.match(html, /if \(this\.insane\) \{\s*this\.maxHp = /);
  assert.match(html, /this\.player\.hp = this\.player\.maxHp;\s*this\.lastPlayerHp = this\.player\.hp;/, 'poslední známý život se přepíše, jinak by hned naskočil NÁLET');
  assert.match(html, /if \(ins\) this\.shootFan\(game, game\.player, 4\.6, 7, INSANE\.destroyerShots\)/);
  assert.match(html, /heavy\(f\) \? INSANE\.heavyWeight : 1/);
});

test('bossové: pět nových za NEMESIS, na konci GLITCH, který se opakuje; všechny útoky mají obsluhu', () => {
  const bosses = vm.runInNewContext(html.match(/const BOSS_TYPES = (\[[\s\S]*?\n\]);/)[1]);
  const names = Array.from(bosses, (b) => b.name);
  assert.deepEqual(names.slice(0, 8), ['STRÁŽCE', 'ÚLOVEC', 'TRHÁČ', 'VÍR', 'PRIZMA', 'ARCHONT', 'BAŠTA', 'NEMESIS']);
  assert.equal(names.length, 14);
  assert.equal(names[13], 'GLITCH');
  assert.equal(new Set(names).size, names.length, 'jména jsou unikátní');
  assert.equal(new Set(bosses.map((b) => b.color)).size, bosses.length, 'barvy jsou unikátní');
  const glitch = bosses[13];
  assert.ok(glitch.glitch && glitch.rate > 1 && glitch.recoverMul < 1 && glitch.moveMul < 1, 'GLITCH je rychlý a bez prodlev');
  const used = new Set(bosses.flatMap((b) => [...b.attacks, b.rage]));
  for (const a of used) assert.ok(html.includes(`case '${a}':`), `útok ${a} nemá obsluhu`);
  // kombinace všech útoků: GLITCH umí všechno, co umí kdokoli jiný
  for (const a of used) assert.ok(glitch.attacks.includes(a) || glitch.rage === a, `GLITCH neumí ${a}`);
  // opakuje se poslední z řady
  assert.match(html, /BOSS_TYPES\[Math\.min\(level - 1, BOSS_TYPES\.length - 1\)\]/);
  // bossové se objevují po skóre, které roste: 13 pevných hranic, další po 3400
  const thr = vm.runInNewContext(html.match(/const BOSS_THRESHOLDS = (\[[^\]]*\]);/)[1]);
  assert.equal(thr.length, 13);
  assert.ok(thr.every((v, i) => i === 0 || v > thr[i - 1]));
});

/* ---------------------------------------------------------------- úspěchy jsou odznaky v appce */
const rocketBadges = GAME_BADGES.filter((b) => b.game === 'rocket');
const rocketStats = GAME_CATALOG.find((g) => g.id === 'rocket').stats;
// statistika v appce -> klíč ve hře (a jednotka: nejdelší běh se hlásí v minutách)
const STAT_SOURCE = {
  total_kills: ['stats', 'totalKills', 1], total_boss_kills: ['stats', 'totalBossKills', 1], no_hit_bosses: ['stats', 'noHitBosses', 1], best_combo: ['stats', 'bestCombo', 1],
  bombs_used: ['stats', 'bombsUsed', 1], total_coins_earned: ['stats', 'totalCoinsEarned', 1], longest_run: ['stats', 'longestRun', 60000], blitz_clears: ['stats', 'blitzClears', 1],
};

test('úspěchy ve hře jsou odznaky v appce: ve hře není seznam úspěchů ani odměny za ně, zůstaly jen relikvie', () => {
  assert.doesNotMatch(html, /ACHIEVEMENTS|renderAchievements|achv-|\bAchv\b/);
  assert.ok(html.includes('id="stats-overlay"') && html.includes('class="stats-note"'), 'poznámka, kde úspěchy najít');
  assert.match(html, /Úspěchy za hraní jsou odznaky v appce: stránka Odznaky, záložka Odznaky her\./);
  assert.ok(html.includes('>Postup a relikvie</button>'));
  assert.match(html, /const Relics = \{[\s\S]*?\n\};/);
  const relics = html.match(/const Relics = \{[\s\S]*?\n\};/)[0];
  assert.doesNotMatch(relics, /coins|reward/i, 'relikvie nedávají mince');
  assert.match(relics, /d\.achievements\[r\.requires\] = true;/, 'odemčení se zapisuje pod stejným klíčem jako dřív, takže starší uložení platí dál');
  assert.match(relics, /if \(Game && Game\.player\) Game\.player\.applyStats\(\);/, 'nová relikvie se projeví hned');
});

test('relikvie: podmínky odpovídají odznakům v appce (každý odznak s relikvií má stejný práh) a ve hře se ukáže, jak ji získat', () => {
  const arr = html.match(/const RELICS = (\[[\s\S]*?\n\]);/)[1];
  const RELICS = vm.runInNewContext(arr);
  assert.deepEqual([...RELICS.map((r) => r.requires)], ['hunter_300', 'boss_10', 'combo_8', 'bomb_20', 'coins_5000', 'ascend_1'], 'klíče dřívějších úspěchů');
  for (const r of RELICS) {
    const badge = rocketBadges.find((b) => b.description.includes(`Odemyká relikvii ${r.name}.`));
    assert.ok(badge, `odznak, který odemyká relikvii ${r.name}`);
    assert.ok(r.how.endsWith('.') && r.desc, r.id);
    const stats = { totalKills: 0, totalBossKills: 0, bestCombo: 0, bombsUsed: 0, totalCoinsEarned: 0 };
    const data = { ascension: 0 };
    const at = (v) => { const st = { ...stats }; const d = { ...data }; if (badge.stat === 'ascension') d.ascension = v; else st[STAT_SOURCE[badge.stat][1]] = v; return r.check(st, d); };
    assert.equal(at(badge.threshold - 1), false, `${r.id}: o jedna pod prahem ${badge.id}`);
    assert.equal(at(badge.threshold), true, `${r.id}: přesně na prahu ${badge.id}`);
    if (r.progress) assert.equal(r.progress({ totalKills: 5, totalBossKills: 5, bombsUsed: 5, totalCoinsEarned: 5 })[1], badge.threshold, `${r.id}: ukazatel míří na stejný práh`);
  }
  assert.match(html, /Jak získat: \$\{r\.how\}\$\{progress\}/);
});

test('reportRecords hlásí všechny statistiky Rocketu z katalogu appky ve správných jednotkách', () => {
  for (const s of rocketStats) assert.ok(html.includes(`jomaridRecord('${s.key}'`), s.key);
  const fn = html.match(/function reportRecords\(\) \{[\s\S]*?\n\}\n/)[0];
  const keys = [...html.match(/defaults: \{[\s\S]*?upgrades: \{([^}]*)\}/)[1].matchAll(/(\w+):/g)].map((m) => m[1]);
  assert.equal(keys.length, rocketStats.find((s) => s.key === 'maxed_upgrades').max, 'osm kategorií vylepšení');
  const calls = {};
  const upgrades = Object.fromEntries(keys.map((k, i) => [k, i < 5 ? 20 : 19]));
  const ctx = vm.createContext({ jomaridRecord: (k, v) => { calls[k] = v; }, MAX_LVL: 20, Storage: { defaults: { upgrades: Object.fromEntries(keys.map((k) => [k, 1])) }, data: {
    best: { normal: 11, hard: 12, inferno: 13, insane: 14, blitz: 15, rush: 16 }, ascension: 2, upgrades,
    stats: { bestBossLevel: 9, totalKills: 301, totalBossKills: 11, noHitBosses: 1, bestCombo: 8, bombsUsed: 21, totalCoinsEarned: 5001, longestRun: 20 * 60000 + 59999, blitzClears: 3 } } } });
  vm.runInContext(`${fn}; reportRecords();`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), {
    score_normal: 11, score_hard: 12, score_inferno: 13, score_insane: 14, score_blitz: 15, rush_streak: 16, boss_level: 9, ascension: 2,
    total_kills: 301, total_boss_kills: 11, no_hit_bosses: 1, best_combo: 8, bombs_used: 21, total_coins_earned: 5001, longest_run: (20 * 60000 + 59999) / 60000, blitz_clears: 3, maxed_upgrades: 5,
  });
  // reportRecords se volá i při načtení hry, kdy ještě není definované UPGRADES: seznam kategorií se proto bere z výchozího postupu
  assert.doesNotMatch(fn.replace(/\/\/.*$/gm, ''), /UPGRADES/);
});

test('každý nový odznak Rocketu míří na statistiku, kterou hra opravdu počítá', () => {
  for (const [stat, [, field]] of Object.entries(STAT_SOURCE)) {
    assert.match(html, new RegExp(`\\b${field}\\b`), `${stat}: ${field} ve hře`);
    assert.ok(rocketBadges.some((b) => b.stat === stat), `${stat}: má aspoň jeden odznak`);
  }
  assert.ok(rocketBadges.some((b) => b.stat === 'maxed_upgrades' && b.threshold === 8));
});
