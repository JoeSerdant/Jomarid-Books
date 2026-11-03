// Pomůcky pro seznamy odznaků her. XP odznaku se bere z tabulky podle obtížnosti (tier 1 až 16): v řetězci odznaků stejné statistiky tier roste,
// takže těžší odznak vždy dává víc XP (hlídá test src/tests/gameRecords.test.mjs).
export const XP_TIERS = Object.freeze([30, 40, 50, 60, 80, 100, 130, 160, 200, 250, 320, 400, 500, 650, 800, 1000]);

export const stat = (key, label, max) => ({ key, label, max });

export const badge = (id, statKey, threshold, tier, title, description) => ({ id, stat: statKey, threshold, xp: XP_TIERS[tier - 1], title, description });
