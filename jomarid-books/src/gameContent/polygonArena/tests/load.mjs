// Načte datové části hry (třídy tanků, generátor) do izolovaného kontextu bez prohlížeče,
// aby se daly testovat v Node. Herní soubory jsou obyčejné skripty, takže stačí je spustit v pořadí.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Soubory, které nepotřebují DOM (pořadí jako v polygonArena.js).
export const DATA_FILES = ['classes.js', 'tier4.js', 'tankgen.js', 'ascension.js'];

// Minimum z core.js, co datové soubory používají.
const PRELUDE = `
const TAU = Math.PI * 2, PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; else if (d < -PI) d += TAU; return d; };
`;

// patch(soubor, zdroj) -> upravený zdroj: testy tak můžou před spuštěním pozměnit jednu věc (např. podmínku modulu).
export function loadClasses(files = DATA_FILES, patch = null) {
  const ctx = vm.createContext({ Math, console, Object, Array, Set, Map, JSON, Number, String, Boolean, parseInt, parseFloat, isFinite, isNaN });
  vm.runInContext(PRELUDE, ctx, { filename: 'prelude.js' });
  for (const f of files) { const src = fs.readFileSync(path.join(DIR, f), 'utf8'); vm.runInContext(patch ? patch(f, src) : src, ctx, { filename: f }); }
  const get = (name) => vm.runInContext(name, ctx);
  return get;
}
