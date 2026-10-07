import { notifySettingsChanged } from './settings/settingsEvents.js';

export const THEMES = {
 saas: {
   '--bg-body': '#f8fafc',       
   '--text-body': '#0f172a',     
   '--bg-card': '#ffffff',       
   '--border-color': '#e2e8f0',  
   '--bg-navbar': 'rgba(255, 255, 255, 0.8)',
   '--text-muted': '#64748b',    
   '--bg-primary': '#4f46e5',    
   '--text-primary': '#ffffff',
   '--bg-secondary': '#ffffff',
   '--text-secondary': '#334155',
   '--bg-badge': '#f5f3ff',
   '--text-badge': '#4f46e5',
 },
 dark: {
   '--bg-body': '#020617',       
   '--text-body': '#f1f5f9',     
   '--bg-card': '#0f172a',       
   '--border-color': '#1e293b',  
   '--bg-navbar': 'rgba(15, 23, 42, 0.8)',
   '--text-muted': '#94a3b8',    
   '--bg-primary': '#7c3aed',    
   '--text-primary': '#ffffff',
   '--bg-secondary': '#1e293b',
   '--text-secondary': '#e2e8f0',
   '--bg-badge': '#2e1065',
   '--text-badge': '#a78bfa',
 },
 emerald: {
   '--bg-body': '#2d1a10',        
   '--text-body': '#f4ebd9',      
   '--bg-card': '#3d2518',        
   '--border-color': '#543523',    
   '--bg-navbar': 'rgba(45, 26, 16, 0.85)',
   '--text-muted': '#bda691',     
   '--bg-primary': '#246b54',     
   '--text-primary': '#ffffff',
   '--bg-secondary': '#4d3223',
   '--text-secondary': '#246b54',
   '--bg-badge': '#1f4237',
   '--text-badge': '#a3cfc0',
 }
};

// --- Vlastní motiv ---
// Uživatel zadá jen dvě barvy (pozadí a zvýraznění), zbylých 12 proměnných se odvodí a text se
// vždy dorovná na čitelný kontrast (WCAG). Pozor: index.html čte uloženou kopii proměnných.
export const CUSTOM_THEME_KEY = 'custom';
export const CUSTOM_THEME_STORAGE = 'jomarid-books-theme-custom'; // {"bg":"#rrggbb","accent":"#rrggbb"}
export const CUSTOM_VARS_STORAGE = 'jomarid-books-theme-vars';    // odvozené proměnné, čte je index.html před vykreslením
export const CUSTOM_DEFAULT = { bg: '#1e293b', accent: '#14b8a6' };
export const CUSTOM_PRESETS = [
  { label: 'Půlnoc', bg: '#0b1020', accent: '#60a5fa' },
  { label: 'Fialová', bg: '#1a1033', accent: '#a855f7' },
  { label: 'Růžová', bg: '#fff1f2', accent: '#e11d48' },
  { label: 'Papír', bg: '#f5efe0', accent: '#b45309' },
  { label: 'Oceán', bg: '#06222b', accent: '#22d3ee' },
  { label: 'Grafit', bg: '#18181b', accent: '#f59e0b' },
];

export const normalizeHex = (v) => {
  if (typeof v !== 'string') return null;
  let h = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? `#${h.toLowerCase()}` : null;
};
// Za psaní do pole se bere jen úplný 6místný kód. Zkratka #abc je platná, ale kdyby se brala hned, přepsala by se
// uprostřed psaní na #aabbcc a zbylé znaky by se zahodily. Zkratka se proto rozbalí až při opuštění pole (normalizeHex).
export const completeHex = (v) => (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v.trim()) ? normalizeHex(v) : null);
const toRgb = (hex) => { const h = normalizeHex(hex).slice(1); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const toHex = (rgb) => `#${rgb.map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => { const x = toRgb(a), y = toRgb(b); return toHex(x.map((c, i) => c + (y[i] - c) * t)); };
export const luminance = (hex) => {
  const [r, g, b] = toRgb(hex).map(c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => { const l1 = luminance(a), l2 = luminance(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
// Posouvá barvu k černé/bílé, dokud nemá proti pozadí aspoň požadovaný kontrast.
const ensureContrast = (fg, bg, min) => {
  if (contrast(fg, bg) >= min) return fg;
  const target = bestOn(bg);
  for (let t = 0.05; t <= 1.0001; t += 0.05) { const c = mix(fg, target, t); if (contrast(c, bg) >= min) return c; }
  return target;
};
// Barva čitelná na všech plochách najednou. Posouvá se vždy ke stejnému konci (podle první plochy, tedy pozadí stránky),
// jinak by u středně světlých barev karta a pozadí táhly text opačnými směry. Nejde-li min dosáhnout všude, vyhrává
// nejlepší dosažitelný nejhorší kontrast.
const ensureContrastAll = (fg, surfaces, min) => {
  const target = bestOn(surfaces[0]);
  let best = fg;
  let bestScore = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = t === 0 ? fg : mix(fg, target, t);
    const score = Math.min(...surfaces.map((surface) => Math.min(contrast(c, surface), min)));
    if (score >= min) return c;
    if (score > bestScore + 1e-9) { best = c; bestScore = score; }
  }
  return best;
};
const bestOn = (bg) => (contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000');

export const isDarkColor = (hex) => bestOn(hex) === '#ffffff';

export const deriveTheme = (bgIn, accentIn) => {
  const bg = normalizeHex(bgIn) || CUSTOM_DEFAULT.bg;
  const accent = normalizeHex(accentIn) || CUSTOM_DEFAULT.accent;
  const dark = isDarkColor(bg);
  const text = ensureContrast(mix(dark ? '#ffffff' : '#000000', bg, 0.08), bg, 9);
  const card = dark ? mix(bg, '#ffffff', 0.06) : mix(bg, '#ffffff', 0.55);
  const secondary = dark ? mix(bg, '#ffffff', 0.11) : mix(bg, '#ffffff', 0.7);
  const badge = mix(bg, accent, dark ? 0.28 : 0.14);
  const [r, g, b] = toRgb(bg);
  const muted = ensureContrastAll(mix(text, bg, 0.38), [bg, card, secondary], 4.5);
  return {
    '--bg-body': bg,
    '--text-body': text,
    '--bg-card': card,
    '--border-color': dark ? mix(bg, '#ffffff', 0.14) : mix(bg, '#000000', 0.11),
    '--bg-navbar': `rgba(${r}, ${g}, ${b}, 0.85)`,
    '--text-muted': muted,
    '--bg-primary': accent,
    '--text-primary': bestOn(accent),
    '--bg-secondary': secondary,
    '--text-secondary': ensureContrast(mix(text, secondary, 0.12), secondary, 7),
    '--bg-badge': badge,
    '--text-badge': ensureContrast(accent, badge, 4.5),
  };
};

// Zvýraznění, které se od pozadí skoro neliší (pod tímhle kontrastem), je špatně vidět: tlačítka a okraje splynou s plochou.
export const ACCENT_MIN_CONTRAST = 3;
// Nejbližší odstín zvýraznění, který už je na daném pozadí vidět (zachová barvu, jen ji posune ke světlé/tmavé).
export const readableAccent = (accentIn, bgIn) => {
  const bg = normalizeHex(bgIn) || CUSTOM_DEFAULT.bg;
  const accent = normalizeHex(accentIn) || CUSTOM_DEFAULT.accent;
  return ensureContrast(accent, bg, ACCENT_MIN_CONTRAST);
};

export const loadCustomColors = () => {
  try {
    const o = JSON.parse(localStorage.getItem(CUSTOM_THEME_STORAGE));
    return { bg: normalizeHex(o && o.bg) || CUSTOM_DEFAULT.bg, accent: normalizeHex(o && o.accent) || CUSTOM_DEFAULT.accent };
  } catch { return { ...CUSTOM_DEFAULT }; }
};
export const saveCustomColors = (colors) => {
  const vars = deriveTheme(colors.bg, colors.accent);
  try {
    localStorage.setItem(CUSTOM_THEME_STORAGE, JSON.stringify({ bg: vars['--bg-body'], accent: vars['--bg-primary'] }));
    localStorage.setItem(CUSTOM_VARS_STORAGE, JSON.stringify([vars['--bg-body'], vars['--text-body'], isDarkColor(vars['--bg-body']) ? 'dark' : 'light']));
  } catch { /* nevadí */ }
  notifySettingsChanged();
};

// Uložené jsou jen úplné a platné vlastní barvy (poškozená hodnota se bere jako neuložená, ať se použije seed).
export const hasSavedCustomColors = () => {
  try { const o = JSON.parse(localStorage.getItem(CUSTOM_THEME_STORAGE)); return !!o && !!normalizeHex(o.bg) && !!normalizeHex(o.accent); } catch { return false; }
};

// Proměnné motivu podle klíče (vestavěné i vlastní) + jestli je tmavý.
export const resolveTheme = (key) => {
  if (key === CUSTOM_THEME_KEY) { const c = loadCustomColors(); return deriveTheme(c.bg, c.accent); }
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(THEMES, key) ? THEMES[key] : THEMES.saas; // ne zděděné (constructor, __proto__)
};
// Dvě barvy vlastního motivu odvozené z právě používaného motivu. První přepnutí na „Vlastní“ tak nezačne od výchozí
// tyrkysové, ale od toho, co uživatel zrovna vidí (zvýraznění se podle potřeby jen dorovná, aby bylo na pozadí vidět).
export const colorsFromTheme = (key) => {
  const vars = resolveTheme(key);
  return { bg: vars['--bg-body'], accent: readableAccent(vars['--bg-primary'], vars['--bg-body']) };
};
// První přepnutí na „Vlastní“: pokud ještě nejsou uložené žádné vlastní barvy, uloží se barvy právě používaného motivu.
// Vrací aktuální vlastní barvy (už uložené se nikdy nepřepisují).
export const seedCustomColors = (fromKey) => {
  if (!hasSavedCustomColors()) saveCustomColors(colorsFromTheme(fromKey));
  return loadCustomColors();
};
// Barvy, které „Vlastní“ dostane po kliknutí - podle nich se kreslí náhled dlaždice (aby odpovídal výsledku).
export const customColorsPreview = (currentKey, saved) => (currentKey !== CUSTOM_THEME_KEY && !hasSavedCustomColors() ? colorsFromTheme(currentKey) : saved);
// --- Další hotové motivy (dopočítané stejně jako „Vlastní“, takže čitelnost je zaručená) ---
Object.assign(THEMES, {
  sepia: deriveTheme('#f3e9d2', '#9a3412'),
  ocean: deriveTheme('#06222b', '#22d3ee'),
  // Vysoký kontrast: čistě černé pozadí, bílé okraje a žlutá akcentní barva
  contrast: { ...deriveTheme('#000000', '#ffd60a'), '--text-body': '#ffffff', '--border-color': '#ffffff', '--text-muted': '#e6e6e6', '--bg-card': '#0a0a0a', '--bg-secondary': '#171717' },
});
export const THEME_KEY = 'jomarid-books-theme';
export const THEME_LABELS = { saas: 'Světlý', dark: 'Tmavý', emerald: 'Dřevo a zeleň', sepia: 'Sépiový', ocean: 'Oceán', contrast: 'Vysoký kontrast', [CUSTOM_THEME_KEY]: 'Vlastní' };
export const DARK_THEMES = ['dark', 'emerald', 'ocean', 'contrast'];

// --- Akcentní barva hotových motivů ---
// Přebije jen zvýraznění (tlačítka, štítky); ostatní barvy motivu zůstanou. Barva se vždy dorovná tak, aby byla na
// pozadí vidět a text na ní byl čitelný, takže jde zvolit libovolná z nabídky v libovolném motivu.
export const ACCENT_KEY = 'jomarid-accent';
const own = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key); // ne zděděné (__proto__, toString)
export const ACCENTS = {
  default: { label: 'Podle motivu', color: null },
  blue: { label: 'Modrá', color: '#2563eb' },
  teal: { label: 'Tyrkysová', color: '#0d9488' },
  green: { label: 'Zelená', color: '#16a34a' },
  amber: { label: 'Jantarová', color: '#d97706' },
  rose: { label: 'Růžová', color: '#e11d48' },
  violet: { label: 'Fialová', color: '#7c3aed' },
};
export const withAccent = (vars, key) => {
  const base = own(ACCENTS, key) ? ACCENTS[key].color : null;
  if (!base) return vars;
  const bg = vars['--bg-body'];
  const accent = readableAccent(base, bg);
  const badge = mix(bg, accent, isDarkColor(bg) ? 0.28 : 0.14);
  return { ...vars, '--bg-primary': accent, '--text-primary': bestOn(accent), '--bg-badge': badge, '--text-badge': ensureContrast(accent, badge, 4.5) };
};
export const loadAccent = () => { try { const v = localStorage.getItem(ACCENT_KEY); return own(ACCENTS, v) ? v : 'default'; } catch { return 'default'; } };
export const saveAccent = (key) => { try { localStorage.setItem(ACCENT_KEY, own(ACCENTS, key) ? key : 'default'); } catch { /* nevadí */ } notifySettingsChanged(); };

// --- Velikost a hustota rozhraní (platí v celé appce; čtečka má vlastní velikost písma) ---
// Velikost mění základní velikost písma stránky (všechno v rem se přepočítá), hustota násobí vnější a vnitřní mezery
// (padding, margin, gap) přes proměnnou --d, kterou čte konfigurace Tailwindu (vite.config.js).
export const UI_SCALE_KEY = 'jomarid-ui-scale';
export const UI_DENSITY_KEY = 'jomarid-ui-density';
export const UI_SCALES = { s: { label: 'Menší', value: 0.9 }, m: { label: 'Standardní', value: 1 }, l: { label: 'Větší', value: 1.125 }, xl: { label: 'Největší', value: 1.25 } };
export const UI_DENSITIES = { compact: { label: 'Kompaktní', value: 0.8 }, normal: { label: 'Standardní', value: 1 }, comfy: { label: 'Pohodlné', value: 1.2 } };
const loadChoice = (storageKey, options, fallback) => { try { const v = localStorage.getItem(storageKey); return own(options, v) ? v : fallback; } catch { return fallback; } };
export const loadUiScale = () => loadChoice(UI_SCALE_KEY, UI_SCALES, 'm');
export const loadUiDensity = () => loadChoice(UI_DENSITY_KEY, UI_DENSITIES, 'normal');
export const applyUiPrefs = (root = document.documentElement) => {
  const scale = UI_SCALES[loadUiScale()].value;
  const density = UI_DENSITIES[loadUiDensity()].value;
  if (scale === 1) root.style.removeProperty('font-size'); else root.style.setProperty('font-size', `${Math.round(scale * 1000) / 10}%`);
  if (density === 1) root.style.removeProperty('--d'); else root.style.setProperty('--d', String(density));
};
const saveChoice = (storageKey, options, key) => {
  try { localStorage.setItem(storageKey, own(options, key) ? key : ''); } catch { /* nevadí */ }
  if (typeof document !== 'undefined') applyUiPrefs();
  notifySettingsChanged();
};
export const saveUiScale = (key) => saveChoice(UI_SCALE_KEY, UI_SCALES, key);
export const saveUiDensity = (key) => saveChoice(UI_DENSITY_KEY, UI_DENSITIES, key);
export const isDarkTheme = (key, vars) => (key === CUSTOM_THEME_KEY ? isDarkColor(vars['--bg-body']) : DARK_THEMES.includes(key));

// Sdílené volby čtečky - používá je ReaderPage i Nastavení, aby se seznamy
// voleb a klíče v localStorage nikdy nerozjely (stejný princip jako leveling.js).
export const FONT_FAMILIES = {
  serif:    { label: 'Serifové',    className: 'font-serif' },
  sans:     { label: 'Bezpatkové',  className: 'font-sans' },
  readable: { label: 'Čitelné',     className: 'font-sans tracking-wide' },
};
export const LINE_HEIGHTS = {
  compact: { label: 'Kompaktní', value: 1.5 },
  normal:  { label: 'Normální',  value: 1.8 },
  airy:    { label: 'Vzdušné',   value: 2.2 },
};
export const TEXT_WIDTHS = {
  narrow: { label: 'Úzký',    ratio: 0.62 },
  medium: { label: 'Střední', ratio: 0.72 },
  wide:   { label: 'Široký',  ratio: 0.82 },
};

export const ALIGNMENTS = { left: { label: 'Vlevo' }, justify: { label: 'Do bloku' } };
export const LETTER_SPACINGS = { normal: { label: 'Běžné', value: '0' }, wide: { label: 'Širší', value: '0.02em' }, wider: { label: 'Nejširší', value: '0.04em' } };
export const PAGE_MARGINS = { narrow: { label: 'Úzké', x: 14, y: 20 }, normal: { label: 'Střední', x: 24, y: 28 }, wide: { label: 'Široké', x: 38, y: 36 } };
export const PAGE_BREAKS = {
  word: { label: 'Přesně', hint: 'Stránka je plná až dolů, věta se může rozdělit.' },
  sentence: { label: 'Po větách', hint: 'Stránka skončí koncem věty, pokud je blízko (dole může zůstat malá mezera).' },
  paragraph: { label: 'Po odstavcích', hint: 'Stránka se snaží skončit koncem odstavce, jinak věty.' },
};
export const PAGE_ANIMATIONS = { none: { label: 'Žádná' }, fade: { label: 'Prolnutí' }, slide: { label: 'Posun' } };
export const MOTION_OPTIONS = { system: { label: 'Podle zařízení' }, reduce: { label: 'Omezit' }, full: { label: 'Plné' } };
export const FONT_SIZE_RANGE = { min: 14, max: 28 };
export const AUTO_ADVANCE_RANGE = { min: 8, max: 60 };
export const WPM_RANGE = { min: 120, max: 400 };
export const NIGHT_RANGE = { min: 0, max: 60 };

// Klíče v localStorage. Čtečka i Nastavení čtou a zapisují TYTÉŽ klíče, takže změna z jednoho místa se hned projeví i v druhém.
export const READER_STORAGE = {
  fontSize: 'reader_font_size', fontFamily: 'reader_font_family', lineHeight: 'reader_line_height', textWidth: 'reader_text_width',
  paper: 'reader_paper_mode', autoAdvance: 'reader_autoadvance_secs',
  align: 'reader_align', hyphens: 'reader_hyphens', letterSpacing: 'reader_letter_spacing', margin: 'reader_margin', pageBreak: 'reader_page_break',
  pageAnim: 'reader_page_anim', tapZones: 'reader_tap_zones', swipe: 'reader_swipe', wakeLock: 'reader_wake_lock',
  showMeta: 'reader_show_meta', showProgress: 'reader_show_progress', wpm: 'reader_wpm', nightFilter: 'reader_night_filter', startFocus: 'reader_start_focus',
};
export const READER_DEFAULTS = {
  fontSize: 18, fontFamily: 'serif', lineHeight: 'normal', textWidth: 'medium', paper: false, autoAdvance: 25,
  align: 'left', hyphens: false, letterSpacing: 'normal', margin: 'normal', pageBreak: 'sentence',
  pageAnim: 'fade', tapZones: true, swipe: true, wakeLock: true,
  showMeta: true, showProgress: true, wpm: 200, nightFilter: 0, startFocus: false,
};
const BOOLEAN_PREFS = ['paper', 'hyphens', 'tapZones', 'swipe', 'wakeLock', 'showMeta', 'showProgress', 'startFocus'];

const pick = (map, key, fallback) => (key && map[key] ? key : fallback);
const clamp = (v, range) => Math.min(range.max, Math.max(range.min, v));

export const loadReaderPrefs = () => {
  const get = (k) => { try { return localStorage.getItem(READER_STORAGE[k]); } catch { return null; } };
  const num = (k, d) => { const v = parseInt(get(k), 10); return Number.isFinite(v) ? v : d; };
  const bool = (k) => { const v = get(k); return v === null ? READER_DEFAULTS[k] : v === '1'; };
  const D = READER_DEFAULTS;
  return {
    fontSize: clamp(num('fontSize', D.fontSize) || D.fontSize, FONT_SIZE_RANGE),
    fontFamily: pick(FONT_FAMILIES, get('fontFamily'), D.fontFamily),
    lineHeight: pick(LINE_HEIGHTS, get('lineHeight'), D.lineHeight),
    textWidth: pick(TEXT_WIDTHS, get('textWidth'), D.textWidth),
    paper: bool('paper'),
    autoAdvance: clamp(num('autoAdvance', D.autoAdvance) || D.autoAdvance, AUTO_ADVANCE_RANGE),
    align: pick(ALIGNMENTS, get('align'), D.align),
    hyphens: bool('hyphens'),
    letterSpacing: pick(LETTER_SPACINGS, get('letterSpacing'), D.letterSpacing),
    margin: pick(PAGE_MARGINS, get('margin'), D.margin),
    pageBreak: pick(PAGE_BREAKS, get('pageBreak'), D.pageBreak),
    pageAnim: pick(PAGE_ANIMATIONS, get('pageAnim'), D.pageAnim),
    tapZones: bool('tapZones'), swipe: bool('swipe'), wakeLock: bool('wakeLock'),
    showMeta: bool('showMeta'), showProgress: bool('showProgress'),
    wpm: clamp(num('wpm', D.wpm), WPM_RANGE),
    nightFilter: clamp(num('nightFilter', D.nightFilter), NIGHT_RANGE),
    startFocus: bool('startFocus'),
  };
};

const notifyReaderPrefs = () => { try { window.dispatchEvent(new Event('jomarid-reader-prefs')); } catch { /* mimo prohlížeč */ } };

export const saveReaderPref = (name, value) => {
  if (!READER_STORAGE[name]) return;
  const stored = BOOLEAN_PREFS.includes(name) ? (value ? '1' : '0') : String(value);
  try { localStorage.setItem(READER_STORAGE[name], stored); } catch { /* úložiště nemusí být dostupné */ }
  notifyReaderPrefs();
  notifySettingsChanged();
};

export const resetReaderPrefs = () => {
  Object.values(READER_STORAGE).forEach(k => { try { localStorage.removeItem(k); } catch { /* nevadí */ } });
  notifyReaderPrefs();
  notifySettingsChanged();
};

// Jedno místo, které z voleb udělá CSS textu. Stejné použije viditelná stránka, skrytý měřicí uzel
// pro stránkování (MUSÍ mít totéž, jinak by se stránky zalamovaly jinak, než se vykreslí) i náhled v Nastavení.
export const readerTypography = (prefs) => {
  const fam = FONT_FAMILIES[prefs.fontFamily] || FONT_FAMILIES.serif;
  const lh = LINE_HEIGHTS[prefs.lineHeight] || LINE_HEIGHTS.normal;
  const margin = PAGE_MARGINS[prefs.margin] || PAGE_MARGINS.normal;
  const hy = prefs.hyphens ? 'auto' : 'manual';
  return {
    className: fam.className,
    lang: 'cs', // dělení slov a zalamování podle češtiny
    padX: margin.x,
    padY: margin.y,
    breakMode: PAGE_BREAKS[prefs.pageBreak] ? prefs.pageBreak : 'sentence',
    style: {
      fontSize: `${prefs.fontSize}px`,
      lineHeight: lh.value,
      letterSpacing: (LETTER_SPACINGS[prefs.letterSpacing] || LETTER_SPACINGS.normal).value,
      textAlign: prefs.align === 'justify' ? 'justify' : 'left',
      hyphens: hy,
      WebkitHyphens: hy,
      whiteSpace: 'pre-wrap',
      wordBreak: 'normal',
      overflowWrap: 'normal',
    },
  };
};

// --- Pohyb a animace v celé appce (nastavuje se v Nastavení -> Vzhled) ---
export const MOTION_KEY = 'jomarid-motion';
export const loadMotionPref = () => { try { const v = localStorage.getItem(MOTION_KEY); return MOTION_OPTIONS[v] ? v : 'system'; } catch { return 'system'; } };
export const applyMotionPref = () => {
  const pref = loadMotionPref();
  const system = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  const reduce = pref === 'reduce' || (pref === 'system' && system);
  document.documentElement.dataset.reduceMotion = reduce ? '1' : '0';
  return reduce;
};
export const saveMotionPref = (value) => { try { localStorage.setItem(MOTION_KEY, value); } catch { /* nevadí */ } applyMotionPref(); notifySettingsChanged(); };
export const initMotionPref = () => {
  applyMotionPref();
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const handler = () => applyMotionPref();
  if (mq && mq.addEventListener) mq.addEventListener('change', handler);
  return () => { if (mq && mq.removeEventListener) mq.removeEventListener('change', handler); };
};
