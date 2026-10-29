// Jak se v liště nad hrou jmenuje odměna, o kterou hra požádala. Hry posílají krátký technický důvod
// (viz jomaridReward v každé hře), čtenáři se ukazuje česky.
const LABELS = {
  coin_pickup: 'Bonusová mince',
  crystal: 'Krystal',
  golden_click: 'Zlaté kliknutí',
  supply_cache: 'Sklad zásob',
  golden_ball: 'Zlatá koule',
  discover: 'Nová koule objevena',
  record: 'Nový rekord',
  victory: 'Vítězství',
  wave: 'Poražená vlna',
};

export const DEFAULT_REWARD_LABEL = 'Odměna ze hry';

export const rewardLabel = (reason) => {
  if (typeof reason !== 'string') return DEFAULT_REWARD_LABEL;
  if (Object.prototype.hasOwnProperty.call(LABELS, reason)) return LABELS[reason];
  if (reason.startsWith('chess_win_')) return 'Výhra v šachách';
  return DEFAULT_REWARD_LABEL;
};

export const REWARD_LIMIT_NOTE = 'Denní limit odměn z téhle hry je vyčerpán';
