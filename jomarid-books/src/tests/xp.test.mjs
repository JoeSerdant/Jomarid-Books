// Společný výpočet XP: hlídá, že dává stejná čísla jako vzorce, které dřív stály zvlášť
// ve Statistikách, v žebříčku a na domovské stránce.
// Spuštění: node --test src/tests/xp.test.mjs
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MONTHLY_GOAL, calculateGoalMultiplier, calculateXpMultiplier, calculateLevelAndProgress, computeTotalXp,
} from '../constants/leveling.js';
import { sumBadgeXp } from '../constants/badgeXp.js';
import { BOOK_BADGES } from '../constants/badges.js';

// Pevný generátor čísel, ať je test opakovatelný.
const makeRng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

// Původní vzorce (zkopírované z doby, kdy byly na třech místech).
const oldOwn = ({ totalRead, goal, fake, bonus, streak }) =>
  Math.round((totalRead * 100) * calculateGoalMultiplier(goal)) + (parseInt(fake, 10) || 0) + (parseInt(bonus, 10) || 0) + calculateXpMultiplier(streak);
const oldBadgeBonus = (ids) => (Array.isArray(ids)
  ? ids.reduce((sum, id) => { const def = BOOK_BADGES.find((bd) => bd.id === id); return sum + (def?.rewardXp || 0); }, 0)
  : 0);

describe('společný výpočet XP', () => {
  test('výchozí měsíční cíl je 25 a bonus začíná až nad ním', () => {
    assert.equal(DEFAULT_MONTHLY_GOAL, 25);
    assert.equal(calculateGoalMultiplier(undefined), 1);
    assert.equal(calculateGoalMultiplier(25), 1);
    assert.equal(calculateGoalMultiplier(30), 1.1);
  });

  test('computeTotalXp dává totéž co původní vzorec (2000 náhodných případů)', () => {
    const rnd = makeRng(12345);
    for (let i = 0; i < 2000; i += 1) {
      const input = {
        totalRead: Math.floor(rnd() * 400),
        goal: pick(rnd, [undefined, null, '', 0, '25', 25, 30, '40', 100, 'abc']),
        fake: pick(rnd, [undefined, null, '', 0, '120', 500, 'x']),
        bonus: pick(rnd, [undefined, null, 0, '75', 1000]),
        streak: Math.floor(rnd() * 400),
      };
      const ids = rnd() < 0.2 ? null : BOOK_BADGES.filter(() => rnd() < 0.3).map((b) => b.id).concat(rnd() < 0.3 ? ['neexistuje'] : []);
      const badgeXp = sumBadgeXp(ids);
      const expected = oldOwn(input) + oldBadgeBonus(ids);
      const actual = computeTotalXp({ totalRead: input.totalRead, highestGoalCompleted: input.goal, fakeXp: input.fake, bonusXp: input.bonus, streak: input.streak, badgeXp });
      assert.equal(actual, expected, JSON.stringify({ input, ids }));
      assert.deepEqual(calculateLevelAndProgress(actual), calculateLevelAndProgress(expected));
    }
  });

  test('bez údajů je výsledek 0', () => {
    assert.equal(computeTotalXp({}), 0);
  });

  test('sumBadgeXp: neznámé id se přeskočí, neplatný vstup dává 0', () => {
    assert.equal(sumBadgeXp(undefined), 0);
    assert.equal(sumBadgeXp('x'), 0);
    assert.equal(sumBadgeXp([]), 0);
    assert.equal(sumBadgeXp(['neexistuje']), 0);
    const first = BOOK_BADGES[0];
    assert.equal(sumBadgeXp([first.id, 'neexistuje']), first.rewardXp || 0);
  });
});
