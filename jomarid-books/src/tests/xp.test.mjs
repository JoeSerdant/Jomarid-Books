// Společný výpočet XP pro Statistiky, žebříček a domovskou stránku: pevná čísla spočítaná ručně a porovnání
// s referenčním vzorcem zapsaným nezávisle na produkčním kódu.
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

// Referenční vzorec zapsaný samostatně, bez volání produkčních násobků:
// násobek za knihu je 1 + (cíl - 25) * 0.02 nad 25 (jinak 1), XP za sérii je série x10, od 10 x25, od 50 x50.
const referenceXp = ({ totalRead, goal, fake, bonus, streak }) => {
  const g = parseInt(goal, 10) || 25;
  const goalMultiplier = g > 25 ? 1 + (g - 25) * 0.02 : 1;
  const streakXp = streak >= 50 ? streak * 50 : streak >= 10 ? streak * 25 : streak * 10;
  return Math.round(totalRead * 100 * goalMultiplier) + (parseInt(fake, 10) || 0) + (parseInt(bonus, 10) || 0) + streakXp;
};
const referenceBadgeXp = (ids) => (Array.isArray(ids)
  ? ids.reduce((sum, id) => { const def = BOOK_BADGES.find((bd) => bd.id === id); return sum + (def?.rewardXp || 0); }, 0)
  : 0);

describe('společný výpočet XP', () => {
  test('výchozí měsíční cíl je 25 a bonus začíná až nad ním', () => {
    assert.equal(DEFAULT_MONTHLY_GOAL, 25);
    assert.equal(calculateGoalMultiplier(undefined), 1);
    assert.equal(calculateGoalMultiplier(25), 1);
    assert.equal(calculateGoalMultiplier(30), 1.1);
  });

  test('násobek za sérii má pevné hodnoty', () => {
    assert.equal(calculateXpMultiplier(0), 0);
    assert.equal(calculateXpMultiplier(9), 90);
    assert.equal(calculateXpMultiplier(10), 250);
    assert.equal(calculateXpMultiplier(49), 1225);
    assert.equal(calculateXpMultiplier(50), 2500);
  });

  test('úroveň a postup mají pevné hodnoty', () => {
    assert.deepEqual(calculateLevelAndProgress(0), { level: 1, xpInCurrentLevel: 0, xpNeededForNext: 150 });
    assert.deepEqual(calculateLevelAndProgress(149), { level: 1, xpInCurrentLevel: 149, xpNeededForNext: 150 });
    assert.deepEqual(calculateLevelAndProgress(150), { level: 2, xpInCurrentLevel: 0, xpNeededForNext: 75 });
    // milion XP už není zkratka na úroveň 100: křivka pokračuje plynule (úroveň 24 začíná kolem 1,12 milionu)
    assert.deepEqual(calculateLevelAndProgress(1000000), { level: 23, xpInCurrentLevel: 251817, xpNeededForNext: 374091 });
    assert.deepEqual(calculateLevelAndProgress(1200000), { level: 24, xpInCurrentLevel: 77726, xpNeededForNext: 561137 });
    assert.equal(calculateLevelAndProgress(1e9).level, 40);
  });

  test('computeTotalXp má pevné součty', () => {
    assert.equal(computeTotalXp({ totalRead: 3 }), 300);
    assert.equal(computeTotalXp({ totalRead: 30, highestGoalCompleted: 30, streak: 10 }), 3550);
    // 3 knihy x 100 x 1.1 (cíl 30) + 10 (fake) + 5 (bonus) + 250 (série 10) + 100 (odznaky)
    assert.equal(computeTotalXp({ totalRead: 3, highestGoalCompleted: 30, fakeXp: '10', bonusXp: 5, streak: 10, badgeXp: 100 }), Math.round(300 * 1.1) + 10 + 5 + 250 + 100);
    assert.equal(computeTotalXp({ totalRead: 3, highestGoalCompleted: 30, fakeXp: '10', bonusXp: 5, streak: 10, badgeXp: 100 }), 695);
    assert.equal(computeTotalXp({ totalRead: 1, fakeXp: '120', bonusXp: 75, streak: 0, badgeXp: 5 }), 300);
  });

  test('computeTotalXp odpovídá referenčnímu vzorci (2000 náhodných případů)', () => {
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
      const expected = referenceXp(input) + referenceBadgeXp(ids);
      const actual = computeTotalXp({ totalRead: input.totalRead, highestGoalCompleted: input.goal, fakeXp: input.fake, bonusXp: input.bonus, streak: input.streak, badgeXp });
      assert.equal(actual, expected, JSON.stringify({ input, ids }));
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
