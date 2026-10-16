// Testy lišty nad hrou: názvy odměn, výpočet úrovně pro lištu a shodný most pro odměny ve všech hrách.
//   npm run test:gamebar
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { rewardLabel, DEFAULT_REWARD_LABEL, REWARD_LIMIT_NOTE } from '../gameBar/rewardLabels.js';
import { buildReaderSnapshot, todayUtcStr } from '../gameBar/readerSnapshot.js';
import { computeTotalXp, calculateLevelAndProgress, getLevelVisuals } from '../constants/leveling.js';
import { sumBadgeXp } from '../constants/badgeXp.js';
import { BOOK_BADGES } from '../constants/badges.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const gamesPage = read('pages', 'Games.jsx');
const bar = read('components', 'GameBar.jsx');

/* ---------------------------------------------------------------- názvy odměn */
test('odměny mají české názvy, šachy podle výhry, neznámé a divné důvody dostanou obecný', () => {
  assert.equal(rewardLabel('coin_pickup'), 'Bonusová mince');
  assert.equal(rewardLabel('crystal'), 'Krystal');
  assert.equal(rewardLabel('golden_click'), 'Zlaté kliknutí');
  assert.equal(rewardLabel('supply_cache'), 'Sklad zásob');
  assert.equal(rewardLabel('golden_ball'), 'Zlatá koule');
  assert.equal(rewardLabel('discover'), 'Nová koule objevena');
  assert.equal(rewardLabel('record'), 'Nový rekord');
  for (const k of ['beginner', 'easy', 'medium', 'hard', 'expert']) assert.equal(rewardLabel('chess_win_' + k), 'Výhra v šachách');
  for (const bad of ['', 'event', 'něco_nového', undefined, null, 5, {}, 'toString', '__proto__', 'constructor']) assert.equal(rewardLabel(bad), DEFAULT_REWARD_LABEL, String(bad));
  assert.match(REWARD_LIMIT_NOTE, /Denní limit odměn/);
});

test('každý důvod, který hry posílají, má v liště vlastní název (nic nekončí na obecném)', () => {
  const reasons = new Set();
  const dirs = [['gameContent', 'rocket', 'index.html'], ['gameContent', 'polygonArena', 'sim.js'], ['gameContent', 'koulovi', 'game.js'], ['gameContent', 'chess', 'ui.js'], ['gameContent', 'cityClicker.js'], ['gameContent', 'warroom.js']];
  for (const d of dirs) {
    for (const m of read(...d).matchAll(/jomaridReward\(\\?["']([a-z_]+)["']|jomaridReward\(\\?["']([a-z_]+)["'] \+/g)) reasons.add(m[1] || m[2]);
  }
  assert.ok(reasons.size >= 7, [...reasons].join(','));
  for (const r of reasons) {
    const full = r === 'chess_win_' ? 'chess_win_hard' : r;
    assert.notEqual(rewardLabel(full), DEFAULT_REWARD_LABEL, r);
  }
});

/* ---------------------------------------------------------------- úroveň pro lištu */
test('úroveň v liště se počítá stejným vzorcem jako na úvodní stránce a ve Statistikách', () => {
  const badgeIds = BOOK_BADGES.slice(0, 4).map((b) => b.id);
  const profile = { fake_xp: 30, bonus_xp: 120, unlocked_badges: badgeIds, highest_goal_completed: 30, current_streak: 4, coins: '1250' };
  const s = buildReaderSnapshot({ profile, totalRead: 7, todayActive: true, resolvedStreak: 6 });
  const xp = computeTotalXp({ totalRead: 7, highestGoalCompleted: 30, fakeXp: 30, bonusXp: 120, streak: 7, badgeXp: sumBadgeXp(badgeIds) });
  assert.equal(s.totalXp, xp);
  assert.equal(s.level, calculateLevelAndProgress(xp).level);
  assert.equal(s.levelName, getLevelVisuals(s.level).name);
  assert.equal(s.streak, 7, 'dnešek se do série započítá, jen když se dnes četlo');
  assert.equal(s.coins, 1250);
  assert.equal(buildReaderSnapshot({ profile, totalRead: 7, todayActive: false, resolvedStreak: 6 }).streak, 6);
});

test('lišta nespadne na chybějících datech: bez profilu je úroveň 1, bez výsledku série se vezme ze profilu', () => {
  const none = buildReaderSnapshot();
  assert.equal(none.level, 1); assert.equal(none.coins, 0); assert.equal(none.streak, 0);
  const fromProfile = buildReaderSnapshot({ profile: { current_streak: '3' }, todayActive: false });
  assert.equal(fromProfile.streak, 3);
  const weird = buildReaderSnapshot({ profile: { coins: 'x', fake_xp: 'y', unlocked_badges: 'z' }, totalRead: undefined, resolvedStreak: NaN });
  assert.equal(weird.coins, 0); assert.ok(weird.level >= 1);
  assert.match(todayUtcStr(new Date('2026-10-03T23:30:00Z')), /^2026-10-03$/);
});

test('více přečtených knih a delší série dávají vyšší nebo stejnou úroveň, nikdy nižší', () => {
  let prev = 0;
  for (let read = 0; read <= 60; read += 5) {
    const l = buildReaderSnapshot({ profile: {}, totalRead: read, todayActive: false, resolvedStreak: 0 }).level;
    assert.ok(l >= prev, `${read} knih`); prev = l;
  }
  assert.ok(buildReaderSnapshot({ profile: {}, resolvedStreak: 40 }).level >= buildReaderSnapshot({ profile: {}, resolvedStreak: 1 }).level);
});

/* ---------------------------------------------------------------- most ve hrách */
const GAMES = {
  rocket: ['gameContent', 'rocket', 'index.html'], polygonarena: ['gameContent', 'polygonArena', 'index.html'], chess: ['gameContent', 'chess', 'index.html'],
  koulovikamosi: ['gameContent', 'koulovi', 'index.html'], cityclicker: ['gameContent', 'cityClicker.js'], warroom: ['gameContent', 'warroom.js'],
};
const bridgeOf = (rel) => {
  let text = read(...rel);
  if (rel[rel.length - 1].endsWith('.js') && /^export const \w+ = "/.test(text)) text = JSON.parse(text.match(/^export const \w+ = (".*");\s*$/s)[1]);
  const i = text.indexOf('JOMARID-BRIDGE');
  assert.ok(i >= 0, rel.join('/'));
  return text.slice(i, text.indexOf('</script>', i));
};

test('každá hra má most, který jen žádá o odměnu a sám nic nezobrazuje (potvrzení ukazuje lišta)', () => {
  for (const [id, rel] of Object.entries(GAMES)) {
    const b = bridgeOf(rel);
    assert.match(b, new RegExp(`var GAME_ID = '${id}';`), id);
    assert.match(b, /window\.jomaridReward = function/, id);
    assert.match(b, /source: 'jomarid-game', type: 'coin'/, id);
    assert.doesNotMatch(b, /toast|capNotified|coin-result|createElement/, `${id}: hra už žádné potvrzení nezobrazuje`);
    assert.match(b, /Potvrzení odměny .* ukazuje lišta appky/, id);
    // syntakticky v pořádku
    new vm.Script(b.replace(/^JOMARID-BRIDGE \*\//, ''));
  }
});

test('mosty ve všech šesti hrách jsou až na id hry stejné (zůstatek ukazuje jen lišta appky, žádná hra ho nepřijímá)', () => {
  const norm = (b) => b.replace(/var GAME_ID = '\w+';/, '');
  const base = norm(bridgeOf(GAMES.rocket));
  for (const id of ['polygonarena', 'chess', 'cityclicker', 'warroom', 'koulovikamosi']) assert.equal(norm(bridgeOf(GAMES[id])), base, id);
  for (const id of Object.keys(GAMES)) assert.doesNotMatch(bridgeOf(GAMES[id]), /balance/i, id);
});

test('id her v Games.jsx a v mostech jsou stejná (server podle něj hlídá denní limit)', () => {
  const ids = [...gamesPage.matchAll(/^\s+id: '(\w+)',$/gm)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), Object.keys(GAMES).sort());
});

test('server (db/game-coins.sql) pustí k Coinům všechny hry z Games.jsx a žádnou navíc; strop je 100 na hru a žádný za všechny hry dohromady', () => {
  const sql = fs.readFileSync(path.join(SRC, '..', 'db', 'game-coins.sql'), 'utf8').replace(/--[^\n]*/g, '');
  const list = sql.match(/p_game_id not in \(([^)]*)\)/);
  assert.ok(list, 'funkce má seznam povolených her');
  const serverIds = [...list[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  const ids = [...gamesPage.matchAll(/^\s+id: '(\w+)',$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(serverIds, ids, 'nová hra v appce bez zápisu v award_game_coins by o Coiny žádala marně (invalid_game_id)');
  assert.match(sql, /v_per_game_cap constant integer := 100;/);
  assert.doesNotMatch(sql, /v_global_cap|v_used_global/, 'strop ze všech her dohromady se zrušil: kdo hraje víc her, vydělá víc');
  assert.doesNotMatch(sql, /\bset\s+coins\s*=/i, 'zůstatek zvyšuje jen spoušť trg_update_coins při zápisu do coin_transactions; přímá úprava by ho připsala dvakrát');
  assert.match(sql, /insert into public\.coin_transactions[\s\S]*select coins into v_balance from public\.profiles/, 'vrácený zůstatek se čte až po zápisu do deníku');
});

/* ---------------------------------------------------------------- hub a lišta */
test('Games.jsx používá lištu, potvrzení ukazuje jen v ní a nic zbytečného neposílá hře', () => {
  assert.match(gamesPage, /<GameBar title=\{game\.title\} onClose=\{handleCloseGame\}/);
  assert.match(gamesPage, /showFlash\(\{ text: `\+\$\{data\.granted\}`, label: rewardLabel\(reason\) \}\)/);
  assert.match(gamesPage, /showFlash\(\{ text: REWARD_LIMIT_NOTE, warn: true \}\)/);
  assert.match(gamesPage, /limitShownRef\.current = false;/, 'poznámka o limitu se při dalším otevření hry ukáže znovu');
  assert.doesNotMatch(gamesPage, /type: 'coin-result'/);
  assert.doesNotMatch(gamesPage, /type: 'balance'|sendBalance/, 'hrám se zůstatek neposílá, ukazuje ho lišta');
  assert.doesNotMatch(gamesPage, /backgroundColor: '#05050f'/, 'černý pruh je pryč');
});

test('lišta je v motivu appky, má křížek s popiskem a zachovává svislé rozložení na nízké obrazovce na šířku', () => {
  assert.match(bar, /data-testid="game-bar"/);
  assert.match(bar, /aria-label="Zavřít hru"/);
  assert.match(bar, /var\(--bg-card\)/);
  assert.match(bar, /var\(--border-color\)/);
  assert.doesNotMatch(bar, /#05050f|rgba\(255,255,255,0\.1\)/, 'žádné pevné tmavé barvy');
  assert.match(bar, /paddingTop: 'var\(--sat\)', paddingRight: 'var\(--sar\)'/, 'výřez displeje');
  assert.ok((bar.match(/\[@media\(orientation:landscape\)_and_\(max-height:500px\)\]/g) || []).length >= 12);
  assert.match(bar, /role="status"/);
  assert.match(bar, /Lv\. \{level\}/);
});
