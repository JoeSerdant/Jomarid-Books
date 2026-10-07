// Společné pomůcky pro procházení dlouhých seznamů (knihovna, studio, administrace): postupné zobrazování po částech,
// hledání bez ohledu na diakritiku, generované obálky a skloňování. Čistá logika bez Reactu, jde testovat v Node.

// Kolik položek se ukáže najednou. 60 se beze zbytku dělí počtem sloupců mřížky (2 až 6), takže rozbalená část nikdy
// nekončí poloprázdným řádkem; seznam (řádky) je nižší a stačí mu míň.
export const PAGE_SIZE = { grid: 60, list: 30 };
export const VIEW_MODES = ['grid', 'list'];

export const normalizeViewMode = (value) => (VIEW_MODES.includes(value) ? value : 'grid');

// ---- hledání ----

/** Text pro porovnání: malá písmena bez diakritiky a bez zdvojených mezer ("Žluťoučký kůň" -> "zlutoucky kun"). */
export const foldText = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/** Hledaný dotaz rozdělený na slova (bez diakritiky). Prázdný dotaz = žádná slova = vyhovuje všechno. */
export const queryTokens = (query) => {
  const folded = foldText(query);
  return folded ? folded.split(' ') : [];
};

/** Vyhovuje, když klíč (už složený přes foldText) obsahuje každé slovo dotazu; na pořadí slov nezáleží. */
export const matchesTokens = (key, tokens) => tokens.every((t) => key.includes(t));

// ---- postupné zobrazování ----

const whole = (n) => Math.floor(Number(n)) || 0;

/** Kolik položek je vidět: aspoň jedna část (nebo všechno, co je), nejvýš celkový počet. */
export const clampVisible = (wanted, total, pageSize) => {
  const t = Math.max(0, whole(total));
  const p = Math.max(1, whole(pageSize));
  return Math.min(t, Math.max(p, whole(wanted)));
};

// Kolik částí se rozbalí samo (doscrollováním nebo při návratu na stránku). Dál už jen tlačítkem: kdo by sjížděl
// tisíce položek v kuse, nafoukl by stránku na stovky tisíc prvků (paměť, pomalé psaní do hledání) a tak daleko
// se stejně hledá spíš filtrem nebo hledáním. Při návratu na stránku by se jinak celý rozbalený seznam vykresloval
// několik sekund.
export const MAX_AUTO_PAGES = 10;

/** Kolik položek se rozbalí samo (a nejvýš se obnoví z uloženého stavu). */
export const autoLimit = (pageSize) => Math.max(1, whole(pageSize)) * MAX_AUTO_PAGES;

/** Kolik položek rozbalit při obnovení uloženého stavu (0 = jen první část). */
export const restoredVisible = (saved, pageSize) => Math.min(Math.max(0, whole(saved)), autoLimit(pageSize));

/** Počet viditelných položek po stisknutí "Zobrazit dalších". */
export const nextVisibleCount = (visible, total, pageSize) => clampVisible(whole(visible) + Math.max(1, whole(pageSize)), total, pageSize);

/** Kolik položek přibude při příštím rozbalení (pro popisek tlačítka). */
export const nextChunkSize = (visible, total, pageSize) => Math.max(0, Math.min(Math.max(1, whole(pageSize)), whole(total) - whole(visible)));

/** Počet se správným tvarem: "1 kniha", "3 knihy", "5 knih", "22 knihy", "25 knih", "112 knih". */
export const czCount = (n, one, few, many) => {
  const last = n % 10;
  const lastTwo = n % 100;
  const form = n === 1 ? one : last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? few : many;
  return `${n} ${form}`;
};

// ---- generované obálky ----
// Knihy nemají obrázek obálky. Místo stejně šedých dlaždic se z názvu odvodí barva, takže se knihy na první pohled
// liší a při prohlížení dlouhého seznamu se v nich dá orientovat. Stejná kniha má vždy stejnou obálku.

const hashString = (value) => {
  let h = 2166136261; // FNV-1a
  const s = String(value ?? '');
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/**
 * Barvy obálky jako [odstín, sytost %, světlost %] pro začátek a konec přechodu. Světlost je nízká, aby byl bílý
 * text na obálce vždy čitelný (kontrola je v testech pro všech 360 odstínů).
 */
export const coverHsl = (seed) => {
  const h = hashString(seed);
  const hue = h % 360;
  const hue2 = (hue + 24 + ((h >>> 9) % 32)) % 360;
  return { from: [hue, 50, 28], to: [hue2, 55, 19] };
};

export const coverGradient = (seed) => {
  const { from, to } = coverHsl(seed);
  const css = ([h, s, l]) => `hsl(${h} ${s}% ${l}%)`;
  return `linear-gradient(150deg, ${css(from)}, ${css(to)})`;
};

/** Iniciály z názvu: první písmena prvních dvou slov ("Stíny nad městem" -> "SN"). */
export const coverInitials = (title) => {
  const words = String(title ?? '').match(/[\p{L}\p{N}]+/gu) || [];
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0]).join('');
  return letters.toLocaleUpperCase('cs') || '?';
};
