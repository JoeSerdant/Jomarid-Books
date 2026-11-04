// Čistá logika pohybu rozhraní v Živém režimu (bez Reactu a bez DOM, jde testovat v Node): časování postupného objevování karet,
// naklánění karet za myší a počítání čísel.

export const REVEAL_STEP = 0.08;      // zpoždění mezi sousedními prvky objevujícími se najednou (s)
export const REVEAL_MAX_STEPS = 10;   // dál se zpoždění nezvyšuje: stovka karet nesmí čekat několik vteřin
export const NESTED_BASE = 0.22;      // prvek uvnitř karty (řádek, ukazatel) začne až chvíli po kartě (s)

const finite = (n, fallback = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** Zpoždění (s) prvku podle jeho pořadí mezi prvky, které se objevují naráz; base je zpoždění celé dávky. */
export const staggerDelay = (index, base = 0) => finite(base) + clamp(Math.floor(finite(index)), 0, REVEAL_MAX_STEPS) * REVEAL_STEP;

/** Zpomalující průběh 0 až 1 (rychle se rozjede, na konci se zpomalí): čísla se „dotočí“ a nezastaví se ostře. */
export const easeOutExpo = (t) => {
  const x = clamp(finite(t), 0, 1);
  return x >= 1 ? 1 : 1 - 2 ** (-10 * x);
};

/** Číslo v čase: z from do to, progress je 0 až 1. Vždy celé číslo a na konci přesně cílová hodnota. */
export const countAt = (from, to, progress) => (finite(progress) >= 1 ? finite(to) : Math.round(finite(from) + (finite(to) - finite(from)) * easeOutExpo(progress)));

/** Jak dlouho (ms) se číslo počítá: malé změny rychle, velké o něco déle, nikdy víc než 1,8 s. */
export const countDuration = (from, to) => clamp(Math.round(800 + Math.sqrt(Math.abs(finite(to) - finite(from))) * 55), 900, 1800);

export const TILT_MAX = 9; // největší náklon karty ve stupních

/** Náklon karty podle polohy myši uvnitř ní (x, y od levého horního rohu karty). rx/ry ve stupních, mx/my v procentech pro odlesk. */
export const tiltFor = (x, y, rect, max = TILT_MAX) => {
  const w = finite(rect && rect.width);
  const h = finite(rect && rect.height);
  if (w <= 0 || h <= 0) return { rx: 0, ry: 0, mx: 50, my: 50 };
  const px = clamp(finite(x) / w, 0, 1);
  const py = clamp(finite(y) / h, 0, 1);
  const r = (v) => Math.round(v * 100) / 100;
  return { rx: r((0.5 - py) * 2 * max), ry: r((px - 0.5) * 2 * max), mx: Math.round(px * 100), my: Math.round(py * 100) };
};

export const REVEAL_VARIANTS = ['rise', 'left', 'right', 'flip', 'row', 'grow'];

/** Jak se prvek objeví: sloupce vyjedou z krajů k sobě, články (karty knih) se překlopí, řádky uvnitř karty vjedou zleva, ukazatele se roztáhnou,
 *  ostatní vyjedou zespodu. Karta, která zabírá jen část šířky obsahu, se podle své polohy rozhodne mezi levou, pravou a prostřední cestou. */
export const revealVariant = ({ grow = false, nested = false, article = false, rect = null, container = null } = {}) => {
  if (grow) return 'grow';
  if (nested) return 'row';
  if (article) return 'flip';
  const cw = finite(container && container.width);
  const w = finite(rect && rect.width);
  if (cw > 0 && w > 0 && w < cw * 0.62) {
    const center = (finite(rect.left) + w / 2 - finite(container.left)) / cw;
    if (center < 0.4) return 'left';
    if (center > 0.6) return 'right';
  }
  return 'rise';
};
