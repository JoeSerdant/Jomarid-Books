// Hannibal: Barca: statistiky, které hra hlásí, a odznaky z nich (id a prahy se nemění, na nich stojí odemčené odznaky hráčů).
import { stat, badge } from './helpers.js';

export const STATS = [
  stat("endless_wave", "Nejvyšší vlna v Nekonečném tažení", 1000),
  stat("chapters_completed", "Dokončené kapitoly kampaně (z 11)", 11),
  stat("doctrines_unlocked", "Odemčené doktríny (z 6)", 6),
  stat("top_unit_level", "Nejvyšší úroveň jednotky", 1000),
];

export const BADGES = [
  badge("han_ch1", "chapters_completed", 1, 3, "Pád Sagunta", "Dokonči první kapitolu kampaně."),
  badge("han_ch4", "chapters_completed", 4, 6, "Přes Alpy", "Dokonči 4 kapitoly kampaně."),
  badge("han_ch8", "chapters_completed", 8, 9, "Hrozba pro Řím", "Dokonči 8 kapitol kampaně."),
  badge("han_ch11", "chapters_completed", 11, 12, "Celé tažení", "Dokonči všech 11 kapitol kampaně."),
  badge("han_doc1", "doctrines_unlocked", 1, 3, "První doktrína", "Odemkni první taktickou doktrínu."),
  badge("han_doc3", "doctrines_unlocked", 3, 6, "Zkušený taktik", "Odemkni 3 taktické doktríny."),
  badge("han_doc6", "doctrines_unlocked", 6, 10, "Mistr taktiky", "Odemkni všech 6 taktických doktrín."),
  badge("han_wave5", "endless_wave", 5, 5, "Neúnavné tažení", "Poraž 5 vln v Nekonečném tažení."),
  badge("han_wave10", "endless_wave", 10, 8, "Neústupný", "Poraž 10 vln v Nekonečném tažení."),
  badge("han_wave20", "endless_wave", 20, 11, "Nekonečná armáda", "Poraž 20 vln v Nekonečném tažení."),
  badge("han_lvl5", "top_unit_level", 5, 5, "Ostřílený voják", "Vypěstuj jednotku na úroveň 5."),
  badge("han_lvl10", "top_unit_level", 10, 9, "Legenda armády", "Vypěstuj jednotku na úroveň 10."),
];
