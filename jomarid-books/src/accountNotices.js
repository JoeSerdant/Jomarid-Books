// Kontrola vlastních dat v Nastavení (záložka „Kontrola účtu“).
//
// Každý přihlášený uživatel (čtenář, nakladatel i správce) tu vidí jen to, co může opravit sám: chybějící jméno
// u účtu a u nakladatelů i nedodělané knihy. Nic z toho se nepočítá na serveru ani se nikam neukládá - jde o čtení
// z tabulek, ke kterým už appka přistupuje (profiles, books, book_contents a soubory textů ve Storage), takže žádná změna databáze není potřeba.
//
// Logika je rozdělená na dvě části, ať jde první otestovat bez prohlížeče a bez databáze:
//   buildAccountNotices - čistá funkce: z načtených dat udělá seznam upozornění
//   loadAccountNotices  - načte data (klient Supabase se předává zvenku, tenhle soubor ho neimportuje)
//
// Zásada: když se něco nepodaří načíst, upozornění na to se NEvymýšlí (chybějící data ≠ chybějící text knihy);
// kontrola se jen označí jako neúplná.

export const LEVEL_WARN = 'warn';  // je potřeba opravit
export const LEVEL_INFO = 'info';  // tip nebo připomenutí

// Role, které můžou mít vlastní knihy.
import { findBookTexts } from './bookText/bookText.js';

export const ROLES_WITH_BOOKS = ['nakladatel', 'správce'];

export const MAX_ITEMS = 5; // kolik názvů knih se ukáže v jednom upozornění, zbytek se jen spočítá
const CONTENT_CHUNK = 40;   // kolik knih se ptáme na text najednou (limit délky adresy dotazu)

// Česká množná čísla: 1 kniha, 2-4 knihy, 5 a víc knih (i 0).
export const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

const isBlank = (v) => typeof v !== 'string' || v.trim() === '';
const titleOf = (b) => (typeof b?.title === 'string' && b.title.trim() ? b.title.trim() : 'Bez názvu');
const sortedTitles = (books) => books.map(titleOf).sort((a, b) => a.localeCompare(b, 'cs'));

// Seznam knih do upozornění: prvních MAX_ITEMS názvů + počet zbylých.
const listBooks = (books) => {
  const titles = sortedTitles(books);
  return { items: titles.slice(0, MAX_ITEMS), more: Math.max(0, titles.length - MAX_ITEMS) };
};

/**
 * @param {object} input
 * @param {string} [input.role]                    'uživatel' | 'nakladatel' | 'správce'
 * @param {object|null|undefined} [input.profile]  řádek z profiles; null = profil neexistuje; undefined = nepodařilo se načíst
 * @param {Array|null} [input.books]               knihy, jejichž je uživatel autorem; null = nenačteno / nepodstatné
 * @param {Iterable<string>|null} [input.bookIdsWithContent]  id knih, které mají řádek v book_contents; null = nenačteno
 * @returns {Array<{id:string, level:string, title:string, detail:string, to?:string, linkLabel?:string, items?:string[], more?:number}>}
 */
export const buildAccountNotices = ({ role, profile, books, bookIdsWithContent } = {}) => {
  const out = [];

  if (profile === null) {
    out.push({
      id: 'profile-missing', level: LEVEL_WARN,
      title: 'Profil ještě není založený',
      detail: 'Dokud se nezaloží (stane se při příštím přihlášení), nejdou nastavit jméno ani veřejné údaje. Zkus se odhlásit a přihlásit znovu.',
    });
  } else if (profile) {
    if (isBlank(profile.username)) {
      out.push({
        id: 'username-missing', level: LEVEL_WARN,
        title: 'Chybí uživatelské jméno',
        detail: 'Bez něj se v žebříčku a na dalších místech ukáže začátek tvého e-mailu (před zavináčem).',
        to: '/settings/profile', linkLabel: 'Nastavit jméno',
      });
    }
    if (ROLES_WITH_BOOKS.includes(role) && isBlank(profile.pen_name)) {
      out.push({
        id: 'pen-name-missing', level: LEVEL_INFO,
        title: 'Nemáš nastavené autorské jméno',
        detail: 'Autorské jméno se ukazuje u tvých knih. Nastav si ho, ať čtenáři vidí, kdo knihy napsal.',
        to: '/settings/profile', linkLabel: 'Nastavit autorské jméno',
      });
    }
  }

  if (Array.isArray(books) && ROLES_WITH_BOOKS.includes(role)) {
    const hidden = books.filter((b) => b?.is_hidden === true);
    // Rozepsané (skryté) knihy ještě nemusí být hotové, proto se na chybějící údaje kontrolují jen zveřejněné.
    const published = books.filter((b) => b && b.is_hidden !== true);
    const link = { to: '/publisher', linkLabel: 'Otevřít panel nakladatele' };

    if (bookIdsWithContent != null) {
      const withContent = new Set(bookIdsWithContent);
      const noText = published.filter((b) => !withContent.has(b.id));
      if (noText.length) {
        out.push({
          id: 'books-no-content', level: LEVEL_WARN,
          title: `${noText.length} ${plural(noText.length, 'zveřejněná kniha nemá text', 'zveřejněné knihy nemají text', 'zveřejněných knih nemá text')}`,
          detail: 'Čtenář by po koupi otevřel prázdnou knihu. Doplň text, nebo knihu stáhni z prodeje.',
          ...link, ...listBooks(noText),
        });
      }
    }

    const noDescription = published.filter((b) => isBlank(b.description));
    if (noDescription.length) {
      out.push({
        id: 'books-no-description', level: LEVEL_WARN,
        title: `${noDescription.length} ${plural(noDescription.length, 'zveřejněná kniha nemá popis', 'zveřejněné knihy nemají popis', 'zveřejněných knih nemá popis')}`,
        detail: 'Popis se ukazuje v katalogu a pomáhá čtenářům vybrat.',
        ...link, ...listBooks(noDescription),
      });
    }

    const noGenres = published.filter((b) => !Array.isArray(b.genres) || b.genres.length === 0);
    if (noGenres.length) {
      out.push({
        id: 'books-no-genres', level: LEVEL_INFO,
        title: `${noGenres.length} ${plural(noGenres.length, 'zveřejněná kniha nemá žánr', 'zveřejněné knihy nemají žánr', 'zveřejněných knih nemá žánr')}`,
        detail: 'Podle žánrů čtenáři knihy filtrují, bez žánru se hůř hledá.',
        ...link, ...listBooks(noGenres),
      });
    }

    if (hidden.length) {
      out.push({
        id: 'books-hidden', level: LEVEL_INFO,
        title: `${hidden.length} ${plural(hidden.length, 'kniha je skrytá', 'knihy jsou skryté', 'knih je skrytých')}`,
        detail: 'Skryté knihy čtenáři v katalogu nevidí a nejdou koupit. Až budou hotové, zveřejníš je v panelu nakladatele.',
        ...link, ...listBooks(hidden),
      });
    }
  }

  // Nejdřív to, co je potřeba opravit; uvnitř skupiny zůstává pořadí kontrol.
  return [...out.filter((n) => n.level === LEVEL_WARN), ...out.filter((n) => n.level !== LEVEL_WARN)];
};

export const countWarnings = (notices) => (Array.isArray(notices) ? notices.filter((n) => n.level === LEVEL_WARN).length : 0);

/**
 * Načte data a sestaví upozornění. Vrací { notices, partial }; partial = část dat se nepodařilo načíst,
 * takže výsledek nemusí být úplný (a nic se v takovém případě nehlásí "naslepo").
 */
export const loadAccountNotices = async (client, { user, role }) => {
  let partial = false;
  const withBooks = ROLES_WITH_BOOKS.includes(role);

  const [profileRes, booksRes] = await Promise.all([
    client.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    withBooks ? client.from('books').select('*').eq('author_id', user.id) : Promise.resolve(null),
  ]);

  let profile; // undefined = nepodařilo se načíst
  if (profileRes.error) partial = true; else profile = profileRes.data ?? null;

  let books = null;
  let bookIdsWithContent = null;
  if (booksRes) {
    if (booksRes.error) {
      partial = true;
    } else {
      books = booksRes.data || [];
      const have = new Set();
      let complete = true;
      for (let i = 0; i < books.length && complete; i += CONTENT_CHUNK) {
        const ids = books.slice(i, i + CONTENT_CHUNK).map((b) => b.id);
        const res = await client.from('book_contents').select('book_id').in('book_id', ids);
        if (res.error) { complete = false; partial = true; } else (res.data || []).forEach((r) => have.add(r.book_id));
      }
      if (complete) {
        // Texty přesunuté do úložiště už nejsou ve staré tabulce: dohledají se tam.
        const missing = books.map((b) => b.id).filter((id) => !have.has(id));
        const stored = await findBookTexts(client, missing);
        stored.found.forEach((id) => have.add(id));
        if (!stored.complete) partial = true;
        complete = stored.complete;
      }
      bookIdsWithContent = complete ? have : null;
    }
  }

  return { notices: buildAccountNotices({ role, profile, books, bookIdsWithContent }), partial };
};
