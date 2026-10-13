import { BOOK_BADGES } from './badges.js';

const XP_BY_ID = new Map(BOOK_BADGES.map((b) => [b.id, b.rewardXp || 0]));

// Součet XP za odemčené odznaky (podle jejich id). Neznámé id se přeskočí, neplatný vstup dává 0.
export const sumBadgeXp = (ids) => (Array.isArray(ids) ? ids.reduce((sum, id) => sum + (XP_BY_ID.get(id) || 0), 0) : 0);
