// Práce se slovníky: zápis oblastí (src/i18n/en/<oblast>.js), sestavení index.js a načtení sloučeného slovníku.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SRC_DIR } from './scan.mjs';

export const EN_DIR = path.join(SRC_DIR, 'i18n', 'en');

const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;

export const formatArea = (area, entries) => {
  const keys = Object.keys(entries).sort((a, b) => a.localeCompare(b, 'cs') || (a < b ? -1 : 1));
  const lines = keys.map((k) => {
    const v = entries[k];
    return `  ${quote(k)}: ${Array.isArray(v) ? `[${v.map(quote).join(', ')}]` : quote(v)},`;
  });
  return `// Anglické texty: ${area}. Klíč je české znění, hodnota anglický překlad (pole [jednotné, množné] u t.p, klíč 'jedna|dvě|pět').\n// Soubor se zapisuje nástrojem (npm run i18n:apply), ručně se dá upravit jen hodnota.\nexport default {\n${lines.join('\n')}\n};\n`;
};

export const areaFile = (area) => path.join(EN_DIR, `${area}.js`);
export const listAreas = () => (fs.existsSync(EN_DIR) ? fs.readdirSync(EN_DIR).filter((f) => f.endsWith('.js') && f !== 'index.js').map((f) => f.replace(/\.js$/, '')).sort() : []);

export const readArea = async (area) => {
  const f = areaFile(area);
  if (!fs.existsSync(f)) return {};
  // cache-busting: soubor se mohl právě přepsat
  const m = await import(`${pathToFileURL(f).href}?t=${Date.now()}`);
  return m.default;
};

export const writeArea = (area, entries) => {
  fs.mkdirSync(EN_DIR, { recursive: true });
  fs.writeFileSync(areaFile(area), formatArea(area, entries));
  writeIndex();
};

/** index.js sloučí všechny oblasti; PARTS zůstane k dispozici testům (kontrola rozporných překladů téhož textu). */
export const writeIndex = () => {
  const areas = listAreas();
  const ids = areas.map((a) => a.replace(/[^A-Za-z0-9]/g, '_'));
  const imports = areas.map((a, i) => `import ${ids[i]} from './${a}.js';`).join('\n');
  const parts = areas.map((a, i) => `  ${JSON.stringify(a)}: ${ids[i]},`).join('\n');
  fs.writeFileSync(path.join(EN_DIR, 'index.js'), `// Anglický slovník: sloučené oblasti. Vytváří nástroj src/i18n/tools (npm run i18n:apply), ručně se neupravuje.\n${imports}\n\nexport const PARTS = {\n${parts}\n};\n\nexport default Object.assign({}, ...Object.values(PARTS));\n`);
};

export const readMerged = async () => {
  const areas = listAreas();
  const merged = {};
  for (const a of areas) Object.assign(merged, await readArea(a));
  return merged;
};
