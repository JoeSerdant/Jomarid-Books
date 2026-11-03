// Warroom: Frontlines: statistiky, které hra hlásí, a odznaky z nich (id a prahy se nemění, na nich stojí odemčené odznaky hráčů).
import { stat, badge } from './helpers.js';

export const STATS = [
  stat("best_sector", "Nejdál v kampani (sektor)", 10000),
  stat("scenarios_unlocked", "Odemčené scénáře", 100),
];

export const BADGES = [
  badge("war_sector5", "best_sector", 5, 6, "Držíme linii", "Dostaň se v kampani do 5. sektoru."),
  badge("war_sector10", "best_sector", 10, 8, "Průlom", "Dostaň se v kampani do 10. sektoru."),
  badge("war_sector25", "best_sector", 25, 11, "Generál", "Dostaň se v kampani do 25. sektoru."),
  badge("war_scen4", "scenarios_unlocked", 4, 10, "Čtyři fronty", "Odemkni 4 scénáře."),
  badge("war_scen12", "scenarios_unlocked", 12, 13, "Půl světa", "Odemkni 12 scénářů."),
  badge("war_scen24", "scenarios_unlocked", 24, 15, "Všechny fronty", "Odemkni všech 24 scénářů."),
  badge("war_sector15", "best_sector", 15, 9, "Hluboký průlom", "Dostaň se v kampani do 15. sektoru."),
];
