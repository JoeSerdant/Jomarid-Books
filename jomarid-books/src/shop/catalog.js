// Obchůdek za Jomarid Coins: tituly (u jména ve Statistikách a v žebříčku, kupují se na stránce Odznaky) a vzhledy her (barevný odstín, kterým appka přebarví hru).
// Stejný seznam je v db/shop.sql (tam rozhoduje server o ceně a o požadovaném odznaku); test src/tests/shop.test.mjs hlídá, že si odpovídají.
// Nic z toho nedává výhodu ve hře ani při čtení, je to jen vzhled.
import { GAME_CATALOG, getBadge, getGame } from '../gameRecords/catalog.js';

export const KIND_TITLE = 'title';
export const KIND_GAMEFX = 'gamefx';
export const SHOP_KINDS = [
  { kind: KIND_TITLE, label: 'Tituly', equipped: 'Titul', hint: 'Titul se ukazuje u tvého jména ve Statistikách a v žebříčku (jen když jsi v žebříčku vidět).' },
  { kind: KIND_GAMEFX, label: 'Vzhled her', equipped: 'Vzhled her', hint: 'Vzhled přebarví hru, když ji spustíš. Kdyby ti barvy při hraní vadily, sundej ho tady.' },
];

// requires = id herního odznaku (src/gameRecords/catalog.js), který musí čtenář mít, než si titul může koupit
export const SHOP_ITEMS = [
  { id: 'title_bookworm', kind: KIND_TITLE, label: 'Knihomol', price: 100, requires: null },
  { id: 'title_night', kind: KIND_TITLE, label: 'Noční sova', price: 120, requires: null },
  { id: 'title_morning', kind: KIND_TITLE, label: 'Ranní ptáče', price: 120, requires: null },
  { id: 'title_collector', kind: KIND_TITLE, label: 'Sběratel', price: 150, requires: null },
  { id: 'title_reader', kind: KIND_TITLE, label: 'Čtenář', price: 100, requires: null },
  { id: 'title_dreamer', kind: KIND_TITLE, label: 'Snílek', price: 120, requires: null },
  { id: 'title_wanderer', kind: KIND_TITLE, label: 'Poutník', price: 120, requires: null },
  { id: 'title_detective', kind: KIND_TITLE, label: 'Detektiv', price: 150, requires: null },
  { id: 'title_librarian', kind: KIND_TITLE, label: 'Knihovník', price: 150, requires: null },
  { id: 'title_chronicler', kind: KIND_TITLE, label: 'Kronikář', price: 200, requires: null },
  { id: 'title_wizard', kind: KIND_TITLE, label: 'Čaroděj', price: 250, requires: null },
  { id: 'title_legend', kind: KIND_TITLE, label: 'Legenda', price: 400, requires: null },
  { id: 'title_pilot', kind: KIND_TITLE, label: 'Pilot', price: 150, requires: 'rocket_ace' },
  { id: 'title_hellrider', kind: KIND_TITLE, label: 'Pán pekel', price: 250, requires: 'rocket_hell' },
  { id: 'title_nemesis', kind: KIND_TITLE, label: 'Lovec Nemesis', price: 250, requires: 'rocket_nemesis' },
  { id: 'title_raider', kind: KIND_TITLE, label: 'Nájezdník', price: 200, requires: 'rocket_rush5' },
  { id: 'title_astro', kind: KIND_TITLE, label: 'Hvězdoplavec', price: 200, requires: 'rocket_ascend' },
  { id: 'title_chess', kind: KIND_TITLE, label: 'Šachista', price: 100, requires: 'chess_first' },
  { id: 'title_dragon', kind: KIND_TITLE, label: 'Drakobijec', price: 250, requires: 'chess_dragon' },
  { id: 'title_grandmaster', kind: KIND_TITLE, label: 'Velmistr', price: 300, requires: 'chess_r1300' },
  { id: 'title_matador', kind: KIND_TITLE, label: 'Šachový matador', price: 150, requires: 'chess_25' },
  { id: 'title_dragonfear', kind: KIND_TITLE, label: 'Postrach draků', price: 300, requires: 'chess_expert5' },
  { id: 'title_koulovi', kind: KIND_TITLE, label: 'Mistr koulí', price: 250, requires: 'koulovi_all' },
  { id: 'title_koulovi_king', kind: KIND_TITLE, label: 'Král klasiky', price: 250, requires: 'koulovi_10k' },
  { id: 'title_chaos', kind: KIND_TITLE, label: 'Pán chaosu', price: 200, requires: 'koulovi_chaos' },
  { id: 'title_koular', kind: KIND_TITLE, label: 'Koulař', price: 100, requires: 'koulovi_3000' },
  { id: 'title_arena', kind: KIND_TITLE, label: 'Velitel arény', price: 200, requires: 'polygon_win' },
  { id: 'title_hunter', kind: KIND_TITLE, label: 'Lovec bossů', price: 150, requires: 'polygon_boss' },
  { id: 'title_polylegend', kind: KIND_TITLE, label: 'Legenda arény', price: 300, requires: 'polygon_lvl58' },
  { id: 'title_builder', kind: KIND_TITLE, label: 'Konstruktér', price: 200, requires: 'polygon_tier4' },
  { id: 'title_helltank', kind: KIND_TITLE, label: 'Pekelný tankista', price: 250, requires: 'polygon_hell' },
  { id: 'title_mayor', kind: KIND_TITLE, label: 'Starosta', price: 150, requires: 'city_prestige' },
  { id: 'title_tycoon', kind: KIND_TITLE, label: 'Magnát', price: 200, requires: 'city_prestige5' },
  { id: 'title_clicker', kind: KIND_TITLE, label: 'Klikač', price: 120, requires: 'city_clicks' },
  { id: 'title_primator', kind: KIND_TITLE, label: 'Primátor', price: 300, requires: 'city_prestige10' },
  { id: 'title_strategist', kind: KIND_TITLE, label: 'Stratég', price: 200, requires: 'war_sector10' },
  { id: 'title_commander', kind: KIND_TITLE, label: 'Velitel front', price: 250, requires: 'war_scen12' },
  { id: 'title_lieutenant', kind: KIND_TITLE, label: 'Poručík', price: 120, requires: 'war_sector5' },
  { id: 'title_general', kind: KIND_TITLE, label: 'Generál', price: 350, requires: 'war_sector25' },
  { id: 'title_carthaginian', kind: KIND_TITLE, label: 'Kartaginec', price: 120, requires: 'han_ch1' },
  { id: 'title_alpine', kind: KIND_TITLE, label: 'Horolezec Alp', price: 150, requires: 'han_ch4' },
  { id: 'title_cannae', kind: KIND_TITLE, label: 'Vítěz od Cannae', price: 250, requires: 'han_ch8' },
  { id: 'title_tactician', kind: KIND_TITLE, label: 'Mistr taktiky', price: 300, requires: 'han_doc6' },
  { id: 'title_barca', kind: KIND_TITLE, label: 'Hannibal Barkas', price: 400, requires: 'han_ch11' },
  { id: 'gamefx_noir', kind: KIND_GAMEFX, label: 'Noir', price: 250, requires: null, description: 'Černobílé hry s o něco větším kontrastem.', filter: 'grayscale(1) contrast(1.15)' },
  { id: 'gamefx_retro', kind: KIND_GAMEFX, label: 'Retro', price: 250, requires: null, description: 'Teplé, trochu vybledlé barvy jako ze starého filmu.', filter: 'sepia(0.85) saturate(1.15) contrast(1.05)' },
  { id: 'gamefx_neon', kind: KIND_GAMEFX, label: 'Neon', price: 300, requires: null, description: 'Sytější, zářivější barvy.', filter: 'saturate(1.9) contrast(1.12) brightness(1.05)' },
  { id: 'gamefx_frost', kind: KIND_GAMEFX, label: 'Mráz', price: 300, requires: null, description: 'Studené, ledově modré tóny.', filter: 'hue-rotate(150deg) saturate(1.15)' },
  { id: 'gamefx_ember', kind: KIND_GAMEFX, label: 'Žár', price: 300, requires: null, description: 'Rozžhavené, oranžovočervené tóny.', filter: 'hue-rotate(-35deg) saturate(1.35) contrast(1.05)' },
  { id: 'gamefx_dusk', kind: KIND_GAMEFX, label: 'Soumrak', price: 300, requires: null, description: 'Fialový soumrak, o něco tlumenější.', filter: 'hue-rotate(250deg) saturate(1.2) brightness(0.95)' },
];

const ITEM_BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]));

export const getShopItem = (id) => ITEM_BY_ID.get(id) || null;
export const itemsOfKind = (kind) => SHOP_ITEMS.filter((item) => item.kind === kind);

// Nabídka po skupinách. Tituly se dělí na obecné (jen za mince) a po hrách podle odznaku, který titul odemyká; ostatní zboží je jedna skupina bez nadpisu.
export function groupsOfKind(kind) {
  const items = itemsOfKind(kind);
  if (kind !== KIND_TITLE) return [{ id: 'all', label: null, items }];
  const groups = [{ id: 'reading', label: 'Čtení a obecné', items: [] }, ...GAME_CATALOG.map((g) => ({ id: g.id, label: g.title, items: [] }))];
  for (const item of items) {
    const gameId = item.requires ? getBadge(item.requires)?.game : null;
    (groups.find((g) => g.id === gameId) || groups[0]).items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

// Text titulu pro zobrazení u jména; neznámé nebo chybějící id nevrátí nic (a nic se u jména neukáže).
export const titleLabel = (id) => {
  const item = ITEM_BY_ID.get(id);
  return item && item.kind === KIND_TITLE ? item.label : null;
};

// CSS filtr nasazeného vzhledu her; bez vzhledu (nebo se neznámým id) prázdný řetězec = hra se nepřebarvuje.
export const gameFilter = (id) => {
  const item = ITEM_BY_ID.get(id);
  return item && item.kind === KIND_GAMEFX ? item.filter : '';
};

// Čím se titul odemkne: "Odznak „Eso hvězd“ (Jomarid Rocket Game)"; null, když se kupuje jen za mince.
export function requirementText(item) {
  if (!item || !item.requires) return null;
  const badge = getBadge(item.requires);
  if (!badge) return null;
  const game = getGame(badge.game);
  return `Odznak „${badge.title}“${game ? ` (${game.title})` : ''}`;
}

// Chybí-li mince, kolik jich je; jinak 0.
export const missingCoins = (item, coins) => Math.max(0, (item?.price || 0) - (Number.isFinite(coins) ? coins : 0));

// Stav zboží pro jednoho čtenáře: 'equipped' (nasazené), 'owned' (koupené, nenasazené), 'locked' (chybí odznak),
// 'poor' (málo mincí) nebo 'available' (jde koupit).
export function itemState(item, { owned = [], equipped = {}, unlocked = [], coins = 0 } = {}) {
  if (owned.includes(item.id)) return equipped[item.kind] === item.id ? 'equipped' : 'owned';
  if (item.requires && !unlocked.includes(item.requires)) return 'locked';
  return missingCoins(item, coins) > 0 ? 'poor' : 'available';
}

// Co se čtenáři řekne, když server nákup nebo nasazení odmítne (kódy chyb z db/shop.sql).
export const SHOP_ERRORS = {
  insufficient_coins: 'Nemáš dost Jomarid Coinů.',
  already_owned: 'Tohle už máš.',
  locked: 'Tenhle titul se odemkne odznakem ze hry.',
  unknown_item: 'Tohle zboží se už neprodává.',
  not_owned: 'Tohle ještě nemáš koupené.',
  wrong_kind: 'Tohle sem nepatří.',
  not_authenticated: 'Přihlášení vypršelo, přihlas se prosím znovu.',
  profile_not_found: 'Tvůj profil se nepodařilo najít. Zkus to za chvíli.',
};
export const SHOP_FALLBACK_ERROR = 'Nepovedlo se, zkus to prosím za chvíli.';
export const shopErrorText = (reason) => SHOP_ERRORS[reason] || SHOP_FALLBACK_ERROR;
