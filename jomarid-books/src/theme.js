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

export const READER_STORAGE = {
  fontSize: 'reader_font_size',
  fontFamily: 'reader_font_family',
  lineHeight: 'reader_line_height',
  textWidth: 'reader_text_width',
  paper: 'reader_paper_mode',
  autoAdvance: 'reader_autoadvance_secs',
};
export const READER_DEFAULTS = { fontSize: 18, fontFamily: 'serif', lineHeight: 'normal', textWidth: 'medium', paper: false, autoAdvance: 25 };
export const FONT_SIZE_RANGE = { min: 14, max: 28 };
export const AUTO_ADVANCE_RANGE = { min: 8, max: 60 };

const pick = (map, key, fallback) => (key && map[key] ? key : fallback);

export const loadReaderPrefs = () => {
  const num = (k, d) => parseInt(localStorage.getItem(k), 10) || d;
  return {
    fontSize: Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, num(READER_STORAGE.fontSize, READER_DEFAULTS.fontSize))),
    fontFamily: pick(FONT_FAMILIES, localStorage.getItem(READER_STORAGE.fontFamily), READER_DEFAULTS.fontFamily),
    lineHeight: pick(LINE_HEIGHTS, localStorage.getItem(READER_STORAGE.lineHeight), READER_DEFAULTS.lineHeight),
    textWidth: pick(TEXT_WIDTHS, localStorage.getItem(READER_STORAGE.textWidth), READER_DEFAULTS.textWidth),
    paper: localStorage.getItem(READER_STORAGE.paper) === '1',
    autoAdvance: Math.min(AUTO_ADVANCE_RANGE.max, Math.max(AUTO_ADVANCE_RANGE.min, num(READER_STORAGE.autoAdvance, READER_DEFAULTS.autoAdvance))),
  };
};

export const saveReaderPref = (name, value) => {
  const stored = name === 'paper' ? (value ? '1' : '0') : String(value);
  localStorage.setItem(READER_STORAGE[name], stored);
};
