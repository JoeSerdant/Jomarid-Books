// Obchůdek za Jomarid Coins: tituly (u jména ve Statistikách a v žebříčku, kupují se na stránce Odznaky) a vzhledy her (barevný odstín, kterým appka přebarví hru).
// Stejný seznam je v db/shop.sql (tam rozhoduje server o ceně a o požadovaném odznaku); test src/tests/shop.test.mjs hlídá, že si odpovídají.
// Nic z toho nedává výhodu ve hře ani při čtení, je to jen vzhled.
import { GAME_CATALOG, getBadge, getGame } from '../gameRecords/catalog.js';
import { t } from '../i18n/core.js';
import { tk } from '../i18n/mark.js';

export const KIND_TITLE = 'title';
export const KIND_GAMEFX = 'gamefx';
export const SHOP_KINDS = [
  { kind: KIND_TITLE, label: tk('Tituly'), equipped: tk('Titul'), hint: tk('Titul se ukazuje u tvého jména ve Statistikách a v žebříčku (jen když jsi v žebříčku vidět).') },
  { kind: KIND_GAMEFX, label: tk('Vzhled her'), equipped: tk('Vzhled her'), hint: tk('Vzhled přebarví hru, když ji spustíš. Kdyby ti barvy při hraní vadily, sundej ho tady.') },
];

// requires = id herního odznaku (src/gameRecords/catalog.js), který musí čtenář mít, než si titul může koupit
export const SHOP_ITEMS = [
  { id: 'title_bookworm', kind: KIND_TITLE, label: tk('Knihomol'), price: 100, requires: null },
  { id: 'title_night', kind: KIND_TITLE, label: tk('Noční sova'), price: 120, requires: null },
  { id: 'title_morning', kind: KIND_TITLE, label: tk('Ranní ptáče'), price: 120, requires: null },
  { id: 'title_collector', kind: KIND_TITLE, label: tk('Sběratel'), price: 150, requires: null },
  { id: 'title_reader', kind: KIND_TITLE, label: tk('Čtenář'), price: 100, requires: null },
  { id: 'title_dreamer', kind: KIND_TITLE, label: tk('Snílek'), price: 120, requires: null },
  { id: 'title_wanderer', kind: KIND_TITLE, label: tk('Poutník'), price: 120, requires: null },
  { id: 'title_detective', kind: KIND_TITLE, label: tk('Detektiv'), price: 150, requires: null },
  { id: 'title_librarian', kind: KIND_TITLE, label: tk('Knihovník'), price: 150, requires: null },
  { id: 'title_chronicler', kind: KIND_TITLE, label: tk('Kronikář'), price: 200, requires: null },
  { id: 'title_wizard', kind: KIND_TITLE, label: tk('Čaroděj'), price: 250, requires: null },
  { id: 'title_legend', kind: KIND_TITLE, label: tk('Legenda'), price: 400, requires: null },
  { id: 'title_pilot', kind: KIND_TITLE, label: tk('Pilot'), price: 150, requires: 'rocket_ace' },
  { id: 'title_hellrider', kind: KIND_TITLE, label: tk('Pán pekel'), price: 250, requires: 'rocket_hell' },
  { id: 'title_nemesis', kind: KIND_TITLE, label: tk('Lovec Nemesis'), price: 250, requires: 'rocket_nemesis' },
  { id: 'title_raider', kind: KIND_TITLE, label: tk('Nájezdník'), price: 200, requires: 'rocket_rush5' },
  { id: 'title_astro', kind: KIND_TITLE, label: tk('Hvězdoplavec'), price: 200, requires: 'rocket_ascend' },
  { id: 'title_chess', kind: KIND_TITLE, label: tk('Šachista'), price: 100, requires: 'chess_first' },
  { id: 'title_dragon', kind: KIND_TITLE, label: tk('Drakobijec'), price: 250, requires: 'chess_dragon' },
  { id: 'title_grandmaster', kind: KIND_TITLE, label: tk('Velmistr'), price: 300, requires: 'chess_r1300' },
  { id: 'title_matador', kind: KIND_TITLE, label: tk('Šachový matador'), price: 150, requires: 'chess_25' },
  { id: 'title_dragonfear', kind: KIND_TITLE, label: tk('Postrach draků'), price: 300, requires: 'chess_expert5' },
  { id: 'title_koulovi', kind: KIND_TITLE, label: tk('Mistr koulí'), price: 250, requires: 'koulovi_all' },
  { id: 'title_koulovi_king', kind: KIND_TITLE, label: tk('Král klasiky'), price: 250, requires: 'koulovi_10k' },
  { id: 'title_chaos', kind: KIND_TITLE, label: tk('Pán chaosu'), price: 200, requires: 'koulovi_chaos' },
  { id: 'title_koular', kind: KIND_TITLE, label: tk('Koulař'), price: 100, requires: 'koulovi_3000' },
  { id: 'title_arena', kind: KIND_TITLE, label: tk('Velitel arény'), price: 200, requires: 'polygon_win' },
  { id: 'title_hunter', kind: KIND_TITLE, label: tk('Lovec bossů'), price: 150, requires: 'polygon_boss' },
  { id: 'title_polylegend', kind: KIND_TITLE, label: tk('Legenda arény'), price: 300, requires: 'polygon_lvl58' },
  { id: 'title_builder', kind: KIND_TITLE, label: tk('Konstruktér'), price: 200, requires: 'polygon_tier4' },
  { id: 'title_helltank', kind: KIND_TITLE, label: tk('Pekelný tankista'), price: 250, requires: 'polygon_hell' },
  { id: 'title_mayor', kind: KIND_TITLE, label: tk('Starosta'), price: 150, requires: 'city_prestige' },
  { id: 'title_tycoon', kind: KIND_TITLE, label: tk('Magnát'), price: 200, requires: 'city_prestige5' },
  { id: 'title_clicker', kind: KIND_TITLE, label: tk('Klikač'), price: 120, requires: 'city_clicks' },
  { id: 'title_primator', kind: KIND_TITLE, label: tk('Primátor'), price: 300, requires: 'city_prestige10' },
  { id: 'title_strategist', kind: KIND_TITLE, label: tk('Stratég'), price: 200, requires: 'war_sector10' },
  { id: 'title_commander', kind: KIND_TITLE, label: tk('Velitel front'), price: 250, requires: 'war_scen12' },
  { id: 'title_lieutenant', kind: KIND_TITLE, label: tk('Poručík'), price: 120, requires: 'war_sector5' },
  { id: 'title_general', kind: KIND_TITLE, label: tk('Generál'), price: 350, requires: 'war_sector25' },
  { id: 'title_carthaginian', kind: KIND_TITLE, label: tk('Kartaginec'), price: 120, requires: 'han_ch1' },
  { id: 'title_alpine', kind: KIND_TITLE, label: tk('Horolezec Alp'), price: 150, requires: 'han_ch4' },
  { id: 'title_cannae', kind: KIND_TITLE, label: tk('Vítěz od Cannae'), price: 250, requires: 'han_ch8' },
  { id: 'title_tactician', kind: KIND_TITLE, label: tk('Mistr taktiky'), price: 300, requires: 'han_doc6' },
  { id: 'title_barca', kind: KIND_TITLE, label: tk('Hannibal Barkas'), price: 400, requires: 'han_ch11' },
  { id: 'gamefx_noir', kind: KIND_GAMEFX, label: tk('Noir'), price: 250, requires: null, description: tk('Černobílé hry s o něco větším kontrastem.'), filter: 'grayscale(1) contrast(1.15)' },
  { id: 'gamefx_retro', kind: KIND_GAMEFX, label: tk('Retro'), price: 250, requires: null, description: tk('Teplé, trochu vybledlé barvy jako ze starého filmu.'), filter: 'sepia(0.85) saturate(1.15) contrast(1.05)' },
  { id: 'gamefx_neon', kind: KIND_GAMEFX, label: tk('Neon'), price: 300, requires: null, description: tk('Sytější, zářivější barvy.'), filter: 'saturate(1.9) contrast(1.12) brightness(1.05)' },
  { id: 'gamefx_frost', kind: KIND_GAMEFX, label: tk('Mráz'), price: 300, requires: null, description: tk('Studené, ledově modré tóny.'), filter: 'hue-rotate(150deg) saturate(1.15)' },
  { id: 'gamefx_ember', kind: KIND_GAMEFX, label: tk('Žár'), price: 300, requires: null, description: tk('Rozžhavené, oranžovočervené tóny.'), filter: 'hue-rotate(-35deg) saturate(1.35) contrast(1.05)' },
  { id: 'gamefx_dusk', kind: KIND_GAMEFX, label: tk('Soumrak'), price: 300, requires: null, description: tk('Fialový soumrak, o něco tlumenější.'), filter: 'hue-rotate(250deg) saturate(1.2) brightness(0.95)' },
];

// Skryté zboží: nekupuje se, v obchůdku není vidět a na stránce Odznaky se ukáže, až ho čtenář má. Dostane ho zdarma za herní odznak (grantedBy),
// který se také nikde neukazuje, dokud ho čtenář nezíská (src/gameRecords/defs/rocket.js, skrytý příběh). Titul se ale ukazuje u jména jako každý jiný.
// Stejný seznam je v db/shop.sql (druhý seznam zboží, ten s grant_badge).
export const SECRET_ITEMS = [
  { id: 'title_majakar', kind: KIND_TITLE, label: tk('Majákář'), price: 0, requires: null, grantedBy: 'rocket_beacon', secret: true },
];

const ITEM_BY_ID = new Map([...SHOP_ITEMS, ...SECRET_ITEMS].map((item) => [item.id, item]));
// Skryté zboží, které čtenář už má (jen to se mu ukáže).
export const ownedSecretItems = (owned) => (Array.isArray(owned) ? SECRET_ITEMS.filter((item) => owned.includes(item.id)) : []);

export const getShopItem = (id) => ITEM_BY_ID.get(id) || null;
export const itemsOfKind = (kind) => SHOP_ITEMS.filter((item) => item.kind === kind);

// Nabídka po skupinách. Tituly se dělí na obecné (jen za mince) a po hrách podle odznaku, který titul odemyká; ostatní zboží je jedna skupina bez nadpisu.
export function groupsOfKind(kind) {
  const items = itemsOfKind(kind);
  if (kind !== KIND_TITLE) return [{ id: 'all', label: null, items }];
  const groups = [{ id: 'reading', label: t('Čtení a obecné'), items: [] }, ...GAME_CATALOG.map((g) => ({ id: g.id, label: t(g.title), items: [] }))];
  for (const item of items) {
    const gameId = item.requires ? getBadge(item.requires)?.game : null;
    (groups.find((g) => g.id === gameId) || groups[0]).items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

// Text titulu pro zobrazení u jména; neznámé nebo chybějící id nevrátí nic (a nic se u jména neukáže).
export const titleLabel = (id) => {
  const item = ITEM_BY_ID.get(id);
  return item && item.kind === KIND_TITLE ? t(item.label) : null;
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
  return game ? t('Odznak „{badge}“ ({game})', { badge: t(badge.title), game: t(game.title) }) : t('Odznak „{badge}“', { badge: t(badge.title) });
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
  insufficient_coins: tk('Nemáš dost Jomarid Coinů.'),
  already_owned: tk('Tohle už máš.'),
  locked: tk('Tenhle titul se odemkne odznakem ze hry.'),
  unknown_item: tk('Tohle zboží se už neprodává.'),
  not_owned: tk('Tohle ještě nemáš koupené.'),
  wrong_kind: tk('Tohle sem nepatří.'),
  not_authenticated: tk('Přihlášení vypršelo, přihlas se prosím znovu.'),
  profile_not_found: tk('Tvůj profil se nepodařilo najít. Zkus to za chvíli.'),
};
export const SHOP_FALLBACK_ERROR = tk('Nepovedlo se, zkus to prosím za chvíli.');
export const shopErrorText = (reason) => t(SHOP_ERRORS[reason] || SHOP_FALLBACK_ERROR);
