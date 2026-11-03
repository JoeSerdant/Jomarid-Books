// Chess League: statistiky, které hra hlásí, a odznaky z nich (id a prahy se nemění, na nich stojí odemčené odznaky hráčů).
import { stat, badge } from './helpers.js';

export const STATS = [
  stat("rating_peak", "Nejvyšší rating", 4000),
  stat("wins_total", "Výhry v hodnocených partiích", 1000000),
  stat("expert_wins", "Výhry nad Drakem", 1000000),
  stat("bots_unlocked", "Odemčení soupeři", 5),
];

export const BADGES = [
  badge("chess_first", "wins_total", 1, 3, "První výhra", "Vyhraj hodnocenou partii."),
  badge("chess_25", "wins_total", 25, 7, "Stálý hráč", "Vyhraj 25 hodnocených partií."),
  badge("chess_dragon", "expert_wins", 1, 10, "Přemožitel draka", "Poraz Draka v hodnocené partii."),
  badge("chess_r1000", "rating_peak", 1000, 6, "Rating 1000", "Dosáhni ratingu 1 000."),
  badge("chess_r1300", "rating_peak", 1300, 9, "Rating 1300", "Dosáhni ratingu 1 300."),
  badge("chess_10", "wins_total", 10, 5, "Deset výher", "Vyhraj 10 hodnocených partií."),
  badge("chess_bots3", "bots_unlocked", 3, 5, "Třetí soupeř", "Odemkni třetího soupeře."),
  badge("chess_bots5", "bots_unlocked", 5, 8, "Všichni soupeři", "Odemkni všech 5 soupeřů."),
  badge("chess_expert5", "expert_wins", 5, 11, "Postrach draků", "Poraz Draka 5krát v hodnocené partii."),
];
