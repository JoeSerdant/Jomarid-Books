// Interaktivní prohlídka appky: obsah, pravidla a ověřování uložených dat (čistá logika bez Reactu).
//
// Obsah prohlídky (kroky, texty, zapnutí) edituje správce v administraci a ukládá se do tabulky site_settings pod
// klíčem TOUR_SETTINGS_KEY - stejně jako obsah domovské stránky. Kroky jsou zvlášť pro čtenáře, nakladatele a správce.
// Správce si u kroku vybírá jen z pevného seznamu zvýraznitelných prvků (ANCHORS), žádné CSS selektory se z databáze
// nikdy nepoužívají. Všechno, co se z databáze načte, projde normalizeTour(), takže poškozená nebo cizí hodnota
// prohlídku nerozbije a texty se nikdy nevykreslují jako HTML (jen jako text).

import { ROLE_READER, ROLE_PUBLISHER, ROLE_ADMIN, ROLE_LABELS } from '../constants/roles.js';
import { tk } from '../i18n/mark.js';

export const TOUR_SETTINGS_KEY = 'onboarding_tour';

export const TOUR_LIMITS = { maxSteps: 60, title: 80, text: 700, maxVersion: 9999, maxAutoDays: 3650 };

export const SET_KEYS = ['reader', 'publisher', 'admin'];
export const SET_LABELS = { reader: ROLE_LABELS[ROLE_READER], publisher: ROLE_LABELS[ROLE_PUBLISHER], admin: ROLE_LABELS[ROLE_ADMIN] };
export const setKeyForRole = (role) => (role === ROLE_PUBLISHER ? 'publisher' : role === ROLE_ADMIN ? 'admin' : 'reader');

// Zvýraznitelné prvky. route = stránka, na které prvek je (prohlídka na ni přejde, když na ní uživatel ještě není),
// at = jak začíná adresa, na které prvek už je (nepřecházet zbytečně). Bez route je prvek vidět na každé stránce.
// Klíče musí odpovídat atributům data-tour v komponentách (Navbar, UserLibrary, SettingsModal, PublisherDashboard).
export const ANCHORS = {
  none: { label: tk('Bez zvýraznění (karta uprostřed)') },
  'nav-library': { label: tk('Menu: Knihovna') },
  'nav-shorts': { label: tk('Menu: shortB') },
  'nav-stats': { label: tk('Menu: Statistiky') },
  'nav-badges': { label: tk('Menu: Odznaky') },
  'nav-games': { label: tk('Menu: Hry') },
  'nav-studio': { label: tk('Menu: Studio (jen nakladatel)') },
  'nav-admin': { label: tk('Menu: Admin (jen správce)') },
  'nav-coins': { label: tk('Zůstatek Jomarid Coinů') },
  'nav-search': { label: tk('Tlačítko hledání knih') },
  'nav-settings': { label: tk('Ozubené kolo (Nastavení)') },
  'library-search': { label: tk('Knihovna: hledání a filtry'), route: '/app' },
  'settings-tabs': { label: tk('Nastavení: seznam záložek'), route: '/settings/appearance', at: '/settings' },
  'settings-checks': { label: tk('Nastavení: záložka Kontrola účtu'), route: '/settings/checks', at: '/settings' },
  'publisher-tabs': { label: tk('Studio: záložky panelu'), route: '/publisher' },
  'nav-language': { label: tk('Přepínač jazyka (CZ / EN)') },
  'help-bot': { label: tk('Pomocník (tlačítko s otázkou)') },
  'shorts-feed': { label: tk('shortB: feed krátkých knih'), route: '/shorts' },
  'stats-streak': { label: tk('Statistiky: série čtení'), route: '/stats' },
  'stats-goal': { label: tk('Statistiky: měsíční cíl'), route: '/stats' },
  'stats-leaderboard': { label: tk('Statistiky: žebříček'), route: '/stats' },
  'badges-tabs': { label: tk('Odznaky: záložky stránky'), route: '/badges' },
  'badges-shop': { label: tk('Odznaky: tituly a vzhled her (obchůdek)'), route: '/badges/shop' },
  'games-list': { label: tk('Hry: seznam her'), route: '/games' },
  'games-online': { label: tk('Hry: karta Jomarid Online Games'), route: '/games' },
  'settings-profile': { label: tk('Nastavení: záložka Profil'), route: '/settings/profile', at: '/settings' },
  'settings-security': { label: tk('Nastavení: záložka Zabezpečení'), route: '/settings/security', at: '/settings' },
  'settings-notifications': { label: tk('Nastavení: záložka Oznámení'), route: '/settings/notifications', at: '/settings' },
  'settings-tour': { label: tk('Nastavení: záložka Prohlídka appky'), route: '/settings/tour', at: '/settings' },
  'settings-appearance': { label: tk('Nastavení: záložka Vzhled'), route: '/settings/appearance', at: '/settings' },
  'settings-reader': { label: tk('Nastavení: záložka Čtečka'), route: '/settings/reader', at: '/settings' },
  'settings-app': { label: tk('Nastavení: záložka Aplikace'), route: '/settings/app', at: '/settings' },
  'settings-data': { label: tk('Nastavení: záložka Data a účet'), route: '/settings/data', at: '/settings' },
  'admin-tabs': { label: tk('Administrace: záložky'), route: '/admin' },
};
export const ANCHOR_KEYS = Object.keys(ANCHORS);
const isAnchor = (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(ANCHORS, v);

const s = (id, anchor, title, text) => ({ id, enabled: true, anchor, title, text });

// Obsah je psaný jednou tady a stejný je i v databázi: db/tour-expand.sql se z něj generuje (node db/tools/gen-tour-sql.mjs) a test hlídá, že si odpovídají.
// Kroky společné všem rolím mají stejné id; nakladatel má navíc Studio, správce Administraci (viz níž).
const STEP = {
  welcome: s('welcome', 'none', tk('Vítej v Jomarid Books'), tk('Tahle prohlídka ti ukáže všechno, co appka umí: knihy a čtečku, shortB, statistiky a odznaky, hry (i online ve dvou), Jomarid Coins, oznámení, čtení bez internetu a nastavení. Je delší, protože toho appka umí hodně. Kdykoli ji můžeš přeskočit a znovu spustit v Nastavení v záložce Prohlídka appky.')),
  library: s('library', 'nav-library', tk('Knihovna'), tk('Tady najdeš celý katalog knih. Ty, které už máš, ukáže filtr Moje knihy. Otevři knihu a čti, appka si pamatuje, kde čtení skončilo.')),
  librarySearch: s('library-search', 'library-search', tk('Hledání v knihovně'), tk('Najdi knihu podle názvu nebo autora a výběr zúž podle žánru.')),
  search: s('search', 'nav-search', tk('Rychlé hledání'), tk('Knihy můžeš hledat odkudkoli v appce.')),
  bookDetail: s('book-detail', 'none', tk('Detail knihy'), tk('Klepnutím na knihu otevřeš její detail s popisem a komentáři. Napíšeš tam krátký komentář (nejvýš 100 znaků, jeden ke každé knize), svůj můžeš smazat a nevhodný cizí nahlásit správci. Knihu, kterou ještě nemáš, odemkneš za Jomarid Coins.')),
  reading: s('reading', 'none', tk('Čtení knihy'), tk('Ve čtečce si nastavíš velikost písma, řádkování, šířku a zarovnání textu, papírový režim i noční filtr. Klávesou B si uložíš místo a záložky najdeš kdykoli zpátky. Text můžeš zvýrazňovat barvami a k pasáži si připsat osobní poznámku, kterou uvidíš jen ty. Fokus režim (klávesa F) schová všechno kromě textu a automatické listování posouvá stránky za tebe. Po přečtení knihu ohodnotíš.')),
  offlineBooks: s('offline-books', 'none', tk('Čtení bez internetu'), tk('Knihu si můžeš v jejím detailu stáhnout do zařízení a číst ji i bez připojení. Čtení se po čase znovu ověřuje s licencí, takže se občas stačí připojit. Stažené knihy a hry spravuješ v Nastavení v záložce Aplikace.')),
  shorts: s('shorts', 'nav-shorts', tk('shortB'), tk('Krátké knihy na jedno sezení. Listuj je do strany, po dočtení jedeš dolů na další. Feed se přizpůsobí tomu, co čteš.')),
  shortsFeed: s('shorts-feed', 'shorts-feed', tk('Jak se shortB listují'), tk('Strany jedné krátké knihy listuješ do strany, další shortB přijde, když jedeš dolů. Nové shortB se skládají podle toho, co čteš, a na konci feedu appka napíše, že jsi prošel všechno, co je pro tebe připravené.')),
  stats: s('stats', 'nav-stats', tk('Statistiky'), tk('Série čtení, měsíční cíl, zkušenosti a žebříček. Čím víc čteš, tím víc toho odemkneš.')),
  statsStreak: s('stats-streak', 'stats-streak', tk('Série čtení'), tk('Série (streak) roste, když čteš den za dnem. Pojistka Streak Freeze, kterou si koupíš za 150 Jomarid Coinů, drží sérii, i když jeden den vynecháš; takový den je v přehledu modrý. Kolik pojistek máš k dispozici, vidíš tady.')),
  statsGoal: s('stats-goal', 'stats-goal', tk('Měsíční cíl'), tk('Nastavíš si, kolik knih chceš tenhle měsíc přečíst, a tady sleduješ postup. Cíl můžeš během měsíce jen zvýšit, ne snížit. Splněný měsíční cíl odemyká odznak.')),
  statsLeaderboard: s('stats-leaderboard', 'stats-leaderboard', tk('Síň slávy (žebříček)'), tk('Žebříček porovnává čtenáře podle série, úrovně, počtu přečtených knih, knih za tento měsíc a zkušeností. Kdo se nechce ukazovat, zapne v Nastavení v záložce Profil režim inkognito. Modrý řádek znamená, že sérii drží pojistka Streak Freeze.')),
  badges: s('badges', 'nav-badges', tk('Odznaky'), tk('Odznaky za čtení i za hry. Za odznaky dostáváš zkušenosti (XP), které zvyšují tvou úroveň, a mince.')),
  badgesTabs: s('badges-tabs', 'badges-tabs', tk('Záložky Odznaků'), tk('Odznaky knih jsou za čtení. Odznaky her se odemykají přímo ve hrách a část z nich je tajná, dokud ji nezískáš. Třetí záložka, Tituly a vzhled her, je obchůdek.')),
  badgesShop: s('badges-shop', 'badges-shop', tk('Obchůdek'), tk('Za Jomarid Coins si tady koupíš titul, který se ukáže u tvého jména ve Statistikách a v žebříčku, nebo vzhled hry, který ji přebarví. Některé tituly jsou zdarma za skrytý odznak ze hry. Koupené věci nasadíš a zase sundáš tlačítkem u položky.')),
  games: s('games', 'nav-games', tk('Mini-hry'), tk('Krátká odbočka od čtení: sbírka her, z nichž některé jdou hrát i online ve dvou. Za hraní dostaneš Jomarid Coins.')),
  gamesList: s('games-list', 'games-list', tk('Seznam her'), tk('Každá hra má svou kartu: Jomarid Rocket Game, Warroom: Frontlines a Hannibal: Barca (ve složce Strategie), City Clicker, Polygon aréna, Chess League, Kouloví Kámoši a Jomarid Online Games. Klepnutím hru otevřeš, šipkou nahoře se vrátíš.')),
  gamesCoins: s('games-coins', 'none', tk('Coiny z her'), tk('Za události ve hře (sebraný bonus, vyhraný zápas, poražený boss) dostaneš Jomarid Coins a lišta nad hrou ti každou odměnu ukáže. Z jedné hry můžeš za den získat nejvýš 100 Coinů a u většiny her si jednou denně vyzvedneš i denní bonus za to, že sis zahrál.')),
  gamesSaves: s('games-saves', 'none', tk('Postup her a hry offline'), tk('Postup ve hrách (vylepšení, nastavení, rozehraná partie) se ukládá k tvému účtu, takže ho máš na všech zařízeních stejný. Hry jdou hrát i bez internetu: stáhneš si je v Nastavení v záložce Aplikace a postup se po připojení sloučí.')),
  gamesOnline: s('games-online', 'games-online', tk('Jomarid Online Games'), tk('Dvě hry z původní sbírky. Katakomby jsou karetní výprava: sólo offline (10 pater, relikvie, kobka duší), online ve dvou jako co-op proti vlnám příšer, nebo jako souboj hrdinů proti sobě. Chaos Aréna je akční aréna ve dvou s třídami, bossy a vlnami.')),
  gamesMultiplayer: s('games-multiplayer', 'none', tk('Hrát online'), tk('Tlačítko Hrát online najdeš v menu hry. Najde ti náhodného soupeře, nebo si zahraješ s kamarádem přes kód. Během zápasu můžeš posílat rychlé reakce, po něm si dát odvetu. Výhra dá Jomarid Coins (v co-opu oběma hráčům) a výsledky se počítají do online žebříčku.')),
  coins: s('coins', 'nav-coins', tk('Jomarid Coins'), tk('Mince získáváš odznaky, každodenním přihlášením a hrami, i výhrami v online zápasech. Za mince kupuješ další knihy, tituly, vzhledy her a pojistku Streak Freeze.')),
  language: s('language', 'nav-language', tk('Čeština a angličtina'), tk('Celá appka, včetně her, funguje česky i anglicky. Jazyk přepneš tady nahoře (CZ / EN) a appka si ho pamatuje. Angličtina se při prvním přepnutí stáhne, bez připojení to nejde.')),
  help: s('help', 'help-bot', tk('Pomocník'), tk('Tlačítko s otázkou otevře pomocníka, kterému se můžeš zeptat na cokoli o appce. Odpovídá jen na otázky o aplikaci a může se mýlit. Na přání smí znát tvé jméno, mince, sérii a četbu kvůli tipům na knihy. Za den má omezený počet otázek.')),
  settings: s('settings', 'nav-settings', tk('Nastavení'), tk('Tady si appku přizpůsobíš. Ukážeme ti, co všechno v ní je.')),
  settingsTabs: s('settings-tabs', 'settings-tabs', tk('Záložky Nastavení'), tk('Nastavení je rozdělené do záložek: Profil, Zabezpečení, Oznámení, Kontrola účtu, Prohlídka appky, Vzhled, Čtečka, Aplikace a Data a účet. Teď projdeme jednu po druhé.')),
  settingsProfile: s('settings-profile', 'settings-profile', tk('Profil'), tk('Tady změníš uživatelské jméno a rozhodneš, jestli se smíš ukazovat v žebříčku (jinak jsi v režimu inkognito). Na jednom zařízení můžeš mít víc účtů a mezi nimi se přepínat bez odhlášení: přidáš je v sekci Účty na tomto zařízení.')),
  settingsSecurity: s('settings-security', 'settings-security', tk('Zabezpečení'), tk('Změníš heslo nebo e-mail, zapneš přihlašovací kód místo hesla a uvidíš, na kterých zařízeních jsi přihlášený. Odhlásit se můžeš i ze všech zařízení najednou.')),
  settingsNotifications: s('settings-notifications', 'settings-notifications', tk('Oznámení'), tk('Tady najdeš schránku oznámení z appky (skrytá kniha, odstraněný komentář, změna jména, dar knihy...) a můžeš si je zapnout i jako oznámení přímo v telefonu nebo počítači. Zůstávají zapnutá i po obnovení aplikace a přepnutí účtu, vypneš je jen tady. Zvlášť si zapneš nebo vypneš připomínky a novinky (série, rozečtená kniha, měsíční cíl).')),
  settingsChecks: s('settings-checks', 'settings-checks', tk('Kontrola účtu'), tk('Appka tě upozorní na věci, které je dobré doladit, a u záložky ukáže číslo, kolik jich je.')),
  settingsAppearance: s('settings-appearance', 'settings-appearance', tk('Vzhled'), tk('Vybereš jazyk, světlý, tmavý nebo vlastní motiv s tvými barvami, akcentní barvu a velikost a hustotu rozhraní. Živý režim přidá appce animace; kdo je nechce, zapne omezení pohybu.')),
  settingsReader: s('settings-reader', 'settings-reader', tk('Čtečka'), tk('Nastavíš výchozí podobu čtení: velikost písma, řádkování, šířku a zarovnání textu, listování a informace, které se při čtení ukazují.')),
  settingsApp: s('settings-app', 'settings-app', tk('Aplikace'), tk('Appku můžeš nainstalovat na plochu telefonu nebo počítače (na iPhonu přes Sdílet a Přidat na plochu; oznámení tam fungují jen z plochy). Obal appky se ukládá do zařízení, takže se otevře i bez připojení. Tlačítko Obnovit aplikaci načte nejnovější verzi, kdyby se appka zasekla. Tady také stahuješ knihy a hry pro čtení a hraní bez internetu.')),
  settingsData: s('settings-data', 'settings-data', tk('Data a účet'), tk('Můžeš si stáhnout všechna svá data, uvidíš svá zařízení a odsud účet také natrvalo smažeš. Smazání nejde vrátit zpět.')),
  settingsTour: s('settings-tour', 'settings-tour', tk('Prohlídka appky'), tk('Tuhle prohlídku tu můžeš kdykoli spustit znovu. Když správce prohlídku rozšíří, ukáže se ti nová verze sama.')),
  done: s('done', 'none', tk('To je vše'), tk('Prohlídku najdeš kdykoli v Nastavení v záložce Prohlídka appky. Příjemné čtení!')),
};

// Kroky čtenáře (a základ pro ostatní role) v pořadí, v jakém se ukazují.
const COMMON_BEFORE_SETTINGS = [
  STEP.library, STEP.librarySearch, STEP.search, STEP.bookDetail, STEP.reading, STEP.offlineBooks,
  STEP.shorts, STEP.shortsFeed,
  STEP.stats, STEP.statsStreak, STEP.statsGoal, STEP.statsLeaderboard,
  STEP.badges, STEP.badgesTabs, STEP.badgesShop,
  STEP.games, STEP.gamesList, STEP.gamesCoins, STEP.gamesSaves, STEP.gamesOnline, STEP.gamesMultiplayer,
  STEP.coins, STEP.language, STEP.help,
];
const SETTINGS_STEPS = [
  STEP.settings, STEP.settingsTabs, STEP.settingsProfile, STEP.settingsSecurity, STEP.settingsNotifications, STEP.settingsChecks,
  STEP.settingsAppearance, STEP.settingsReader, STEP.settingsApp, STEP.settingsData, STEP.settingsTour,
];

const READER_STEPS = [STEP.welcome, ...COMMON_BEFORE_SETTINGS, ...SETTINGS_STEPS, STEP.done];

// Nakladatel: čtenářské kroky a navíc Studio (za Knihovnou a hledáním), mince i z prodeje, vlastní Kontrola účtu a knih.
const PUBLISHER_STUDIO_STEPS = [
  s('studio', 'nav-studio', tk('Studio'), tk('Tvůj panel nakladatele: statistiky prodejů a čtenářů, správa knih a vydávání nových.')),
  s('studio-tabs', 'publisher-tabs', tk('Co ve Studiu najdeš'), tk('Přehled ukazuje prodeje a čtenáře. V záložce Moje knihy knihy spravuješ a stahuješ z prodeje, v záložce Vydat / upravit knihu vydáš nebo upravíš. V záložce Licence a profil daruješ knihu čtenáři a vidíš jméno, pod kterým se tvé knihy zobrazují.')),
  s('studio-overview', 'publisher-tabs', tk('Přehled prodejů a čtenářů'), tk('V záložce Přehled vidíš, kolik se tvých knih prodalo a kolik čtenářů je otevírá, takže víš, co se čte. Z prodeje dostáváš Jomarid Coins.')),
  s('studio-books', 'publisher-tabs', tk('Moje knihy'), tk('Tady knihy spravuješ: upravuješ je a když potřebuješ, stáhneš je z prodeje. Filtr Moje knihy v Knihovně ukazuje i tvoje vlastní knihy.')),
  s('studio-editor', 'publisher-tabs', tk('Vydat / upravit knihu'), tk('Nahraješ text knihy, doplníš popis a žánr a knihu vydáš. Stejný formulář slouží k úpravě už vydané knihy. Co u tvých knih ještě chybí, ti ukáže Kontrola účtu v Nastavení.')),
  s('studio-shorts', 'publisher-tabs', tk('shortB ve Studiu'), tk('Krátké knihy do 6 000 znaků, které čtenáři listují ve feedu. Své shortB píšeš v záložce shortB ve Studiu.')),
  s('studio-licenses', 'publisher-tabs', tk('Licence a profil'), tk('V záložce Licence a profil daruješ knihu čtenáři a vidíš krycí jméno, pod kterým se tvé knihy zobrazují.')),
];
const PUBLISHER_STEPS = [
  s('welcome', 'none', tk('Vítej v Jomarid Books'), tk('Jsi tu jako nakladatel, takže ti kromě čtení ukážeme i to, kde vydáš a spravuješ své knihy. Prohlídka je delší, protože toho appka umí hodně. Kdykoli ji můžeš přeskočit a znovu spustit v Nastavení v záložce Prohlídka appky.')),
  STEP.library, STEP.librarySearch, STEP.search, STEP.bookDetail, STEP.reading, STEP.offlineBooks,
  ...PUBLISHER_STUDIO_STEPS,
  STEP.shorts, STEP.shortsFeed,
  STEP.stats, STEP.statsStreak, STEP.statsGoal, STEP.statsLeaderboard,
  STEP.badges, STEP.badgesTabs, STEP.badgesShop,
  STEP.games, STEP.gamesList, STEP.gamesCoins, STEP.gamesSaves, STEP.gamesOnline, STEP.gamesMultiplayer,
  s('coins', 'nav-coins', tk('Jomarid Coins'), tk('Mince dostáváš odznaky, každodenním přihlášením a hrami a také z prodeje svých knih. Za mince můžeš kupovat další knihy, tituly, vzhledy her a pojistku Streak Freeze.')),
  STEP.language, STEP.help,
  STEP.settings, STEP.settingsTabs, STEP.settingsProfile, STEP.settingsSecurity, STEP.settingsNotifications,
  s('settings-checks', 'settings-checks', tk('Kontrola účtu a knih'), tk('V záložce Kontrola účtu uvidíš, co u tvých knih ještě chybí (text, popis, žánr) a jestli máš nastavené krycí jméno.')),
  STEP.settingsAppearance, STEP.settingsReader, STEP.settingsApp, STEP.settingsData, STEP.settingsTour,
  s('done', 'none', tk('To je vše'), tk('Prohlídku najdeš kdykoli v Nastavení v záložce Prohlídka appky. Ať se daří!')),
];

// Správce má kroky čtenáře a navíc Administraci těsně před Nastavením.
const ADMIN_STEPS = [
  STEP.welcome, ...COMMON_BEFORE_SETTINGS,
  s('admin', 'nav-admin', tk('Administrace'), tk('Správa účtů, knih, domovské stránky a také této prohlídky. Otevřená upozornění mají u záložky číslo.')),
  s('admin-tabs', 'admin-tabs', tk('Záložky Administrace'), tk('Přehled, Upozornění, Účty, Knihovna & Editace, shortB, Domovská stránka, Prohlídka appky, Licence, XP a mince a Systémový log. Projdeme je po jedné.')),
  s('admin-notifications', 'admin-tabs', tk('Upozornění'), tk('Tady řešíš, co čeká na správce (například nahlášené komentáře nebo žádosti o pomoc s heslem); počet otevřených věcí je vidět u záložky. V záložce je i nastavení oznámení do zařízení: odešleš si zkušební oznámení a ukázky motivačních oznámení.')),
  s('admin-accounts', 'admin-tabs', tk('Účty'), tk('Správa účtů čtenářů a nakladatelů: role, dočasná hesla a další zásahy.')),
  s('admin-books', 'admin-tabs', tk('Knihovna & Editace'), tk('Katalog knih: úpravy, skrývání a správa obsahu.')),
  s('admin-shorts', 'admin-tabs', tk('shortB v administraci'), tk('Správa krátkých knih (shortB) ve feedu.')),
  s('admin-homepage', 'admin-tabs', tk('Domovská stránka'), tk('Texty a vybrané knihy úvodní stránky, kterou vidí nepřihlášení návštěvníci.')),
  s('admin-tour', 'admin-tabs', tk('Prohlídka appky v administraci'), tk('Tuhle prohlídku tady upravuješ: kroky, texty, zapnutí a verzi. Po zvýšení verze se prohlídka ukáže znovu i těm, kdo už starší viděli.')),
  s('admin-users', 'admin-tabs', tk('Licence, XP a mince'), tk('Přehled uživatelů s licencemi, zkušenostmi a mincemi.')),
  s('admin-logs', 'admin-tabs', tk('Systémový log'), tk('Záznamy o důležitých událostech v appce.')),
  ...SETTINGS_STEPS, STEP.done,
];

const DEFAULT_SETS = { reader: READER_STEPS, publisher: PUBLISHER_STEPS, admin: ADMIN_STEPS };

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
const toNumber = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
const intIn = (v, min, max, fallback) => { const n = toNumber(v); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; };

// Jeden krok. Krok bez titulku i textu nemá smysl a zahodí se; neplatný cíl se změní na "none" (karta uprostřed).
// draft = rozpracovaná podoba v editoru: nic se neořezává o mezery a prázdný krok zůstane (správce ho právě píše).
export const normalizeStep = (raw, fallbackId, { draft = false } = {}) => {
  if (!raw || typeof raw !== 'object') return null;
  const cut = (v, max) => (draft ? (typeof v === 'string' ? v.slice(0, max) : '') : clean(v, max));
  const title = cut(raw.title, TOUR_LIMITS.title);
  const text = cut(raw.text, TOUR_LIMITS.text);
  if (!draft && !title && !text) return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 40) : fallbackId;
  return { id, enabled: raw.enabled !== false, anchor: isAnchor(raw.anchor) ? raw.anchor : 'none', title, text };
};

const normalizeSteps = (list, setKey, options) => {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (out.length >= TOUR_LIMITS.maxSteps) break;
    const step = normalizeStep(raw, `${setKey}-${out.length + 1}`, options);
    if (!step) continue;
    let id = step.id; let n = 2;
    while (seen.has(id)) id = `${step.id}-${n++}`; // stejné id dvou kroků by rozbilo klíče v seznamu
    seen.add(id);
    out.push({ ...step, id });
  }
  return out;
};

export const defaultSteps = (setKey) => normalizeSteps(DEFAULT_SETS[setKey] || [], setKey);

/**
 * Z čehokoli (null, poškozený JSON, částečná data) udělá platné nastavení prohlídky.
 * Chybějící sada kroků se nahradí výchozí; sada, kterou správce záměrně vyprázdnil ([]), zůstane prázdná (= bez prohlídky).
 */
export const normalizeTour = (raw) => {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const given = src.sets && typeof src.sets === 'object' && !Array.isArray(src.sets) ? src.sets : {};
  const sets = {};
  for (const key of SET_KEYS) sets[key] = Array.isArray(given[key]) ? normalizeSteps(given[key], key) : defaultSteps(key);
  return {
    enabled: src.enabled !== false,
    version: intIn(src.version, 1, TOUR_LIMITS.maxVersion, 1),
    autoDays: intIn(src.autoDays, 0, TOUR_LIMITS.maxAutoDays, 14),
    sets,
  };
};
export const defaultTour = () => normalizeTour(null);

// Je to celé číslo od 0 do maxAutoDays? (Editor ho podle toho hlídá, normalizeTour jinak potichu použije výchozích 14.)
export const isValidAutoDays = (v) => { const n = toNumber(v); return Number.isInteger(n) && n >= 0 && n <= TOUR_LIMITS.maxAutoDays; };
// Krok, který by se při uložení zahodil, protože nemá titulek ani text.
export const isBlankStep = (step) => !step || (!clean(step.title, TOUR_LIMITS.title) && !clean(step.text, TOUR_LIMITS.text));

/**
 * Shovívavá podoba pro rozpracovaný návrh v editoru (ukládá se do sessionStorage, aby přežil náhled a přepnutí záložky):
 * stejná pravidla jako normalizeTour, ale prázdné kroky a nedopsaný počet dní zůstanou, jak je správce napsal.
 */
export const normalizeDraft = (raw) => {
  const base = normalizeTour(raw);
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const given = src.sets && typeof src.sets === 'object' && !Array.isArray(src.sets) ? src.sets : {};
  const sets = {};
  for (const key of SET_KEYS) sets[key] = Array.isArray(given[key]) ? normalizeSteps(given[key], key, { draft: true }) : base.sets[key];
  const days = typeof src.autoDays === 'number' || typeof src.autoDays === 'string' ? String(src.autoDays).slice(0, 8) : base.autoDays;
  return { ...base, autoDays: days, sets };
};

export const activeSteps = (tour, role) => (tour?.sets?.[setKeyForRole(role)] || []).filter((st) => st.enabled);

// ---- Kdy se prohlídka spustí sama ----
const normalizePath = (p) => (typeof p === 'string' && p.length > 1 ? p.replace(/\/+$/, '') || '/' : p);

// Jen na klidných stránkách: ne uprostřed čtení knihy, ve hře, při přihlášení ani v administraci.
export const isAutoStartPath = (pathname) => {
  const p = normalizePath(pathname);
  if (typeof p !== 'string') return false;
  return ['/', '/app', '/stats', '/games', '/publisher'].includes(p) || p === '/shorts' || p === '/badges' || p.startsWith('/badges/') || p === '/settings' || p.startsWith('/settings/') || p.startsWith('/autor/');
};

export const accountAgeDays = (createdAt, now = Date.now()) => {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86400000) : Infinity;
};

/**
 * Prohlídka se sama spustí, když je zapnutá, má pro roli aspoň jeden krok, uživatel aktuální verzi ještě neviděl
 * a je to buď nový účet (mladší než tour.autoDays dní), nebo někdo, kdo už starší verzi viděl (správce zvýšil verzi).
 * Staré účty, které prohlídku nikdy neviděly, se jí sama nedočkají - dohledají si ji v Nastavení.
 */
export const shouldAutoStart = ({ tour, role, seenVersion = 0, createdAt, now = Date.now(), pathname }) => {
  if (!tour || !tour.enabled) return false;
  if (typeof role !== 'string' || !role) return false; // role se nenačetla (chyba profilu) - nevíme, jakou sadu ukázat
  if (activeSteps(tour, role).length === 0) return false;
  if (seenVersion >= tour.version) return false;
  const isNew = tour.autoDays > 0 && accountAgeDays(createdAt, now) <= tour.autoDays;
  if (!isNew && !(seenVersion > 0)) return false;
  return isAutoStartPath(pathname);
};

// Adresa, na kterou je potřeba přejít, aby byl cíl kroku vidět; null = přecházet netřeba.
export const routeForAnchor = (anchor, pathname) => {
  const def = isAnchor(anchor) ? ANCHORS[anchor] : null;
  if (!def || !def.route) return null;
  const at = def.at || def.route;
  const p = normalizePath(pathname);
  return p === at || (typeof p === 'string' && p.startsWith(at + '/')) ? null : def.route;
};
