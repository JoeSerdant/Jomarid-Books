// Sdílené výpočty úrovně/XP - vytaženo z UserStats.jsx, ať existuje jen JEDNA
// pravda o tom, jak se počítá level. Cokoliv, co ukazuje uživatelův level
// (Statistiky, domovská stránka po přihlášení, žebříček...), musí čerpat
// odsud, ne mít vlastní kopii vzorce.

export const calculateXpMultiplier = (streakCount) => {
  if (streakCount >= 50) return streakCount * 50;
  if (streakCount >= 10) return streakCount * 25;
  return streakCount * 10;
};

export const calculateLevelAndProgress = (totalXp) => {
  if (totalXp >= 1000000) return { level: 100, xpInCurrentLevel: 100, xpNeededForNext: 100 };

  const getRequiredXp = (lvl) => (lvl <= 1 ? 0 : Math.round(100 * Math.pow(1.5, lvl - 1)));

  let currentLevel = 1;
  while (totalXp >= getRequiredXp(currentLevel + 1) && currentLevel < 100) {
    currentLevel++;
  }

  const xpForCurrentLevelStart = getRequiredXp(currentLevel);
  const xpForNextLevelStart = getRequiredXp(currentLevel + 1);
  const xpInCurrentLevel = totalXp - xpForCurrentLevelStart;
  const xpNeededForNext = xpForNextLevelStart - xpForCurrentLevelStart;

  return { level: currentLevel, xpInCurrentLevel, xpNeededForNext };
};

export const getLevelVisuals = (lvl) => {
  if (lvl >= 20) return {
    name: "Bůh zapomenutých příběhů 🌌",
    badge: "border border-amber-500/40 text-amber-500 bg-amber-500/10 font-black animate-pulse",
    box: "bg-gradient-to-br from-amber-500 to-amber-700 text-black shadow-lg"
  };
  if (lvl >= 15) return {
    name: "Mág nejvyšší knihovny 🧙‍♂️",
    badge: "border border-emerald-500/30 text-emerald-400 bg-emerald-500/10 font-bold",
    box: "bg-emerald-700 text-white"
  };
  if (lvl >= 10) return {
    name: "Mistr skrytých pravd 🗝️",
    badge: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30 font-bold",
    box: "bg-indigo-600 text-white"
  };
  if (lvl >= 5) return {
    name: "Pravidelný knihomol 🐛",
    badge: "bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)]",
    box: "bg-[var(--bg-primary)] text-[var(--text-primary)]"
  };

  return {
    name: "Začínající čtenář 🌱",
    badge: "bg-[var(--bg-badge)] text-[var(--text-badge)]",
    box: "bg-[var(--bg-primary)] text-[var(--text-primary)]"
  };
};
