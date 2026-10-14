import { calculateLevelAndProgress, computeTotalXp, getLevelVisuals } from '../constants/leveling.js';
import { sumBadgeXp } from '../constants/badgeXp.js';

export const todayUtcStr = (now = new Date()) => now.toISOString().slice(0, 10);

// Z řádků z databáze udělá to, co lišta nad hrou ukazuje: úroveň čtenáře a zůstatek. Vzorec je stejný jako na úvodní
// stránce a ve Statistikách (computeTotalXp), ať je úroveň všude stejná. Série čtení se do XP počítá včetně dneška,
// pokud se dnes už četlo (jako na úvodní stránce); dnešek se tady nikam nezapisuje.
//   profile: řádek z profiles (fake_xp, bonus_xp, unlocked_badges, highest_goal_completed, current_streak, coins)
//   totalRead: počet dočtených knih
//   todayActive: četl dnes (v user_daily_activity je dnešní den)
//   resolvedStreak: výsledek resolve_streak(); když chybí, použije se current_streak z profilu
//   gameXp: XP z herních odznaků (my_game_progress); bez něj se počítá nula
export function buildReaderSnapshot({ profile, totalRead = 0, todayActive = false, resolvedStreak, gameXp = 0 } = {}) {
  const p = profile || {};
  const base = Number.isFinite(resolvedStreak) ? resolvedStreak : (parseInt(p.current_streak, 10) || 0);
  const streak = base + (todayActive ? 1 : 0);
  const totalXp = computeTotalXp({
    totalRead,
    highestGoalCompleted: p.highest_goal_completed,
    fakeXp: p.fake_xp,
    bonusXp: p.bonus_xp,
    streak,
    badgeXp: sumBadgeXp(p.unlocked_badges || []),
    gameXp,
  });
  const { level } = calculateLevelAndProgress(totalXp);
  const name = getLevelVisuals(level).name;
  return { coins: parseInt(p.coins, 10) || 0, level, levelName: name, streak, totalXp };
}
