// Základní seznam českých textů, které ještě nejsou přeložené (src/i18n/tools/baseline.json). Je to zároveň seznam úkolů:
// test (src/tests/i18n.test.mjs) hlídá, že v kódu nepřibyl žádný další nepřeložený český text a že seznam odpovídá skutečnosti.
// Po převedení souboru na t(...) se seznam přegeneruje:   npm run i18n:baseline
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSourceFiles, rawTexts, scanFile } from './scan.mjs';

export const BASELINE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'baseline.json');

export const currentBaseline = () => {
  const out = {};
  for (const rel of listSourceFiles()) {
    const texts = rawTexts(scanFile(rel));
    if (texts.length) out[rel] = texts;
  }
  return out;
};

export const readBaseline = () => JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));

export const formatBaseline = (obj) => {
  const files = Object.keys(obj).sort();
  const parts = files.map((f) => `  ${JSON.stringify(f)}: [\n${obj[f].map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ]`);
  return `{\n${parts.join(',\n')}\n}\n`;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cur = currentBaseline();
  fs.writeFileSync(BASELINE_FILE, formatBaseline(cur));
  const total = Object.values(cur).reduce((a, l) => a + l.length, 0);
  console.log(`Základní seznam zapsán: ${Object.keys(cur).length} souborů, ${total} nepřeložených textů.`);
}
