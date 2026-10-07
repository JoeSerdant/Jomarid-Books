// Interaktivní prohlídka appky: obsah, pravidla a ověřování uložených dat (čistá logika bez Reactu).
//
// Obsah prohlídky (kroky, texty, zapnutí) edituje správce v administraci a ukládá se do tabulky site_settings pod
// klíčem TOUR_SETTINGS_KEY - stejně jako obsah domovské stránky. Kroky jsou zvlášť pro čtenáře, nakladatele a správce.
// Správce si u kroku vybírá jen z pevného seznamu zvýraznitelných prvků (ANCHORS), žádné CSS selektory se z databáze
// nikdy nepoužívají. Všechno, co se z databáze načte, projde normalizeTour(), takže poškozená nebo cizí hodnota
// prohlídku nerozbije a texty se nikdy nevykreslují jako HTML (jen jako text).

export const TOUR_SETTINGS_KEY = 'onboarding_tour';

export const TOUR_LIMITS = { maxSteps: 15, title: 80, text: 400, maxVersion: 9999, maxAutoDays: 3650 };

export const SET_KEYS = ['reader', 'publisher', 'admin'];
export const SET_LABELS = { reader: 'Čtenář', publisher: 'Nakladatel', admin: 'Správce' };
export const setKeyForRole = (role) => (role === 'nakladatel' ? 'publisher' : role === 'správce' ? 'admin' : 'reader');

// Zvýraznitelné prvky. route = stránka, na které prvek je (prohlídka na ni přejde, když na ní uživatel ještě není),
// at = jak začíná adresa, na které prvek už je (nepřecházet zbytečně). Bez route je prvek vidět na každé stránce.
// Klíče musí odpovídat atributům data-tour v komponentách (Navbar, UserLibrary, SettingsModal, PublisherDashboard).
export const ANCHORS = {
  none: { label: 'Bez zvýraznění (karta uprostřed)' },
  'nav-library': { label: 'Menu: Knihovna' },
  'nav-stats': { label: 'Menu: Statistiky' },
  'nav-games': { label: 'Menu: Hry' },
  'nav-studio': { label: 'Menu: Studio (jen nakladatel)' },
  'nav-admin': { label: 'Menu: Admin (jen správce)' },
  'nav-coins': { label: 'Zůstatek Jomarid Coinů' },
  'nav-search': { label: 'Tlačítko hledání knih' },
  'nav-settings': { label: 'Ozubené kolo (Nastavení)' },
  'library-search': { label: 'Knihovna: hledání a filtry', route: '/app' },
  'settings-tabs': { label: 'Nastavení: seznam záložek', route: '/settings/appearance', at: '/settings' },
  'publisher-tabs': { label: 'Studio: záložky panelu', route: '/publisher' },
};
export const ANCHOR_KEYS = Object.keys(ANCHORS);
const isAnchor = (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(ANCHORS, v);

const s = (id, anchor, title, text) => ({ id, enabled: true, anchor, title, text });

const READER_STEPS = [
  s('welcome', 'none', 'Vítej v Jomarid Books', 'Za minutku ti ukážeme, kde co najdeš. Prohlídku můžeš kdykoli přeskočit a znovu ji spustit v Nastavení v záložce Prohlídka appky.'),
  s('library', 'nav-library', 'Knihovna', 'Tady jsou tvoje knihy. Otevři knihu a čti, appka si pamatuje, kde čtení skončilo.'),
  s('library-search', 'library-search', 'Hledání v knihovně', 'Najdi knihu podle názvu nebo autora a výběr zúž podle žánru.'),
  s('stats', 'nav-stats', 'Statistiky', 'Série čtení, odznaky, zkušenosti a žebříček. Čím víc čteš, tím víc toho odemkneš.'),
  s('games', 'nav-games', 'Mini-hry', 'Krátká odbočka od čtení. Za hraní dostaneš i pár Jomarid Coinů, jednou denně.'),
  s('coins', 'nav-coins', 'Jomarid Coins', 'Mince získáváš čtením, sériemi a hrami. Za mince kupuješ další knihy.'),
  s('search', 'nav-search', 'Rychlé hledání', 'Knihy můžeš hledat odkudkoli v appce.'),
  s('settings', 'nav-settings', 'Nastavení', 'Tady si appku přizpůsobíš. Ukážeme ti, co všechno v ní je.'),
  s('settings-tabs', 'settings-tabs', 'Přizpůsob si to po svém', 'Ve Vzhledu je světlý, tmavý i vlastní motiv s tvými barvami. Ve Čtečce si nastavíš písmo, řádkování nebo noční filtr. V Kontrole účtu uvidíš, co je ještě potřeba doladit.'),
  s('done', 'none', 'To je vše', 'Prohlídku najdeš kdykoli v Nastavení v záložce Prohlídka appky. Příjemné čtení!'),
];

const PUBLISHER_STEPS = [
  s('welcome', 'none', 'Vítej v Jomarid Books', 'Jsi tu jako nakladatel, takže ti kromě čtení ukážeme i to, kde vydáš a spravuješ své knihy. Prohlídku můžeš kdykoli přeskočit a znovu spustit v Nastavení.'),
  s('library', 'nav-library', 'Knihovna', 'Tady čteš knihy jako každý čtenář. Tvoje vlastní knihy tu máš také.'),
  s('studio', 'nav-studio', 'Studio', 'Tvůj panel nakladatele: statistiky prodejů a čtenářů, správa knih a vydávání nových.'),
  s('studio-tabs', 'publisher-tabs', 'Co ve Studiu najdeš', 'Přehled ukazuje prodeje a čtenáře, v Mých knihách knihy spravuješ a stahuješ z prodeje, ve Vydat / upravit knihu vydáš nebo upravíš a v Licencích a profilu rozdáváš licence a nastavíš autorské jméno.'),
  s('stats', 'nav-stats', 'Statistiky', 'Tvoje čtenářské statistiky, odznaky a žebříček.'),
  s('coins', 'nav-coins', 'Jomarid Coins', 'Mince dostáváš čtením a hrami a také z prodeje svých knih. Za mince můžeš kupovat další knihy.'),
  s('settings', 'nav-settings', 'Nastavení', 'Tady si appku přizpůsobíš a zkontroluješ svůj účet i knihy.'),
  s('settings-tabs', 'settings-tabs', 'Kontrola účtu a knih', 'V záložce Kontrola účtu uvidíš, co u tvých knih ještě chybí (text, popis, žánr) a jestli máš nastavené autorské jméno. Ve Vzhledu a Čtečce si appku přizpůsobíš.'),
  s('done', 'none', 'To je vše', 'Prohlídku najdeš kdykoli v Nastavení v záložce Prohlídka appky. Ať se daří!'),
];

const ADMIN_STEPS = [
  ...READER_STEPS.slice(0, 7),
  s('admin', 'nav-admin', 'Administrace', 'Správa účtů, knih, domovské stránky a také této prohlídky. Otevřená upozornění mají u záložky číslo.'),
  ...READER_STEPS.slice(7),
];

const DEFAULT_SETS = { reader: READER_STEPS, publisher: PUBLISHER_STEPS, admin: ADMIN_STEPS };

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
const toNumber = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
const intIn = (v, min, max, fallback) => { const n = toNumber(v); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; };

// Jeden krok. Krok bez titulku i textu nemá smysl a zahodí se; neplatný cíl se změní na "none" (karta uprostřed).
export const normalizeStep = (raw, fallbackId) => {
  if (!raw || typeof raw !== 'object') return null;
  const title = clean(raw.title, TOUR_LIMITS.title);
  const text = clean(raw.text, TOUR_LIMITS.text);
  if (!title && !text) return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 40) : fallbackId;
  return { id, enabled: raw.enabled !== false, anchor: isAnchor(raw.anchor) ? raw.anchor : 'none', title, text };
};

const normalizeSteps = (list, setKey) => {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (out.length >= TOUR_LIMITS.maxSteps) break;
    const step = normalizeStep(raw, `${setKey}-${out.length + 1}`);
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

export const activeSteps = (tour, role) => (tour?.sets?.[setKeyForRole(role)] || []).filter((st) => st.enabled);

// ---- Kdy se prohlídka spustí sama ----
const normalizePath = (p) => (typeof p === 'string' && p.length > 1 ? p.replace(/\/+$/, '') || '/' : p);

// Jen na klidných stránkách: ne uprostřed čtení knihy, ve hře, při přihlášení ani v administraci.
export const isAutoStartPath = (pathname) => {
  const p = normalizePath(pathname);
  if (typeof p !== 'string') return false;
  return ['/', '/app', '/stats', '/games', '/publisher'].includes(p) || p === '/settings' || p.startsWith('/settings/') || p.startsWith('/autor/');
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
