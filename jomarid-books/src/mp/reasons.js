// Proč zápas skončil: krátká věta pro hráče. Důvody posílá hra (checkmate, resign...) nebo server (timeout, dispute, no_show...).
import { t } from '../i18n/core.js';
import { tk } from '../i18n/mark.js';

const REASONS = {
  checkmate: tk('Mat.'),
  stalemate: tk('Pat.'),
  insufficient: tk('Nedostatek materiálu.'),
  fiftymove: tk('Pravidlo padesáti tahů.'),
  repetition: tk('Trojnásobné opakování pozice.'),
  timeout: tk('Vypršel čas.'),
  'timeout-material': tk('Vypršel čas, ale soupeř už nemůže dát mat.'),
  resign: tk('Soupeř vzdal.'),
  goal: tk('Cíl závodu je splněn.'),
  dispute: tk('Hráči nahlásili různý výsledek, zápas se nezapočítal.'),
  no_show: tk('Soupeř se nepřipojil, zápas se zrušil.'),
  abandoned: tk('Zápas se zrušil, protože ho nikdo nedohrál.'),
  opponent_gone: tk('Soupeř se odpojil.'),
  left: tk('Soupeř se odpojil.'),
};

export const reasonText = (reason) => (REASONS[reason] ? t(REASONS[reason]) : '');
