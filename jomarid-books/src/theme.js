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
};

export const resetReaderPrefs = () => {
  Object.values(READER_STORAGE).forEach(k => { try { localStorage.removeItem(k); } catch { /* nevadí */ } });
  notifyReaderPrefs();
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
export const saveMotionPref = (value) => { try { localStorage.setItem(MOTION_KEY, value); } catch { /* nevadí */ } applyMotionPref(); };
export const initMotionPref = () => {
  applyMotionPref();
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const handler = () => applyMotionPref();
  if (mq && mq.addEventListener) mq.addEventListener('change', handler);
  return () => { if (mq && mq.removeEventListener) mq.removeEventListener('change', handler); };
};
