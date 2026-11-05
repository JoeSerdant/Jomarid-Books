import { tk } from '../i18n/mark.js';
// Vzhled řádku v žebříčku. Zmrzlá série (drží ji pojistka Streak Freeze) se nezobrazuje jako nula, ale řádek má modrý přechod.
// Platí jen na záložce „Plamínky“ (u úrovně, knih a XP o sérii nejde).

/** Modrý přechod zleva doprava (ledová barva, dál od jména slábne). Průhledná barva, takže funguje na světlých i tmavých motivech. */
export const FROZEN_ROW_IMAGE = 'linear-gradient(90deg, rgba(56, 189, 248, 0.32) 0%, rgba(59, 130, 246, 0.16) 55%, rgba(125, 211, 252, 0.05) 100%)';
export const FROZEN_ROW_BORDER = 'rgba(56, 189, 248, 0.6)';
export const FROZEN_ICON_COLOR = '#38bdf8';
export const FROZEN_LABEL = tk('Série drží pojistka (Streak Freeze)');

/** Je řádek na dané záložce zmrzlý? */
export const isFrozenRow = (row, tab) => tab === 'streak' && !!row && row.streakFrozen === true;

/** Inline styl řádku: obyčejný, svůj (zvýrazněný), nebo zmrzlý (modrý přechod a okraj; svůj řádek se pozná dál podle štítku „Ty“ a tučného písma). */
export const boardRowStyle = (row, tab) => {
  const frozen = isFrozenRow(row, tab);
  return {
    backgroundColor: row?.isMe ? 'var(--bg-badge)' : 'rgba(0,0,0,0.02)',
    backgroundImage: frozen ? FROZEN_ROW_IMAGE : undefined,
    borderColor: frozen ? FROZEN_ROW_BORDER : (row?.isMe ? 'var(--bg-primary)' : 'transparent'),
  };
};
