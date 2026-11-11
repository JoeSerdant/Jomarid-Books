import { t } from '../i18n/core.js';
import { tk } from '../i18n/mark.js';
// Jak se v liště nad hrou jmenuje odměna, o kterou hra požádala. Hry posílají krátký technický důvod
// (viz jomaridReward v každé hře), čtenáři se ukazuje česky.
const LABELS = {
  coin_pickup: tk('Bonusová mince'),
  crystal: tk('Krystal'),
  golden_click: tk('Zlaté kliknutí'),
  supply_cache: tk('Sklad zásob'),
  golden_ball: tk('Zlatá koule'),
  discover: tk('Nová koule objevena'),
  record: tk('Nový rekord'),
  victory: tk('Vítězství'),
  wave: tk('Poražená vlna'),
  enemy: tk('Poražený nepřítel'),
  elite: tk('Poražená elita'),
  guardian: tk('Strážce katakomb poražen'),
};

export const DEFAULT_REWARD_LABEL = tk('Odměna ze hry');

export const rewardLabel = (reason) => {
  if (typeof reason !== 'string') return t(DEFAULT_REWARD_LABEL);
  if (Object.prototype.hasOwnProperty.call(LABELS, reason)) return t(LABELS[reason]);
  if (reason.startsWith('chess_win_')) return t('Výhra v šachách');
  return t(DEFAULT_REWARD_LABEL);
};

export const REWARD_LIMIT_NOTE = tk('Denní limit odměn z téhle hry je vyčerpán');
