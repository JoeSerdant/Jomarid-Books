// City Clicker: statistiky, které hra hlásí, a odznaky z nich (id a prahy se nemění, na nich stojí odemčené odznaky hráčů).
import { stat, badge } from './helpers.js';

export const STATS = [
  stat("prestige_count", "Prestiže", 100000),
  stat("total_clicks", "Kliknutí celkem", 2000000000),
];

export const BADGES = [
  badge("city_prestige", "prestige_count", 1, 8, "Nový začátek", "Proveď první prestiž."),
  badge("city_prestige5", "prestige_count", 5, 10, "Zkušený starosta", "Proveď 5 prestiží."),
  badge("city_clicks", "total_clicks", 10000, 6, "Klikací mistr", "Klikni 10 000krát."),
  badge("city_clicks1k", "total_clicks", 1000, 1, "Rozcvička", "Klikni 1 000krát."),
  badge("city_prestige3", "prestige_count", 3, 9, "Stavitel měst", "Proveď 3 prestiže."),
  badge("city_prestige10", "prestige_count", 10, 12, "Mistr přestaveb", "Proveď 10 prestiží."),
  badge("city_clicks100k", "total_clicks", 100000, 9, "Klikací legenda", "Klikni 100 000krát."),
];
