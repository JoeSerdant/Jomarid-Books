// Co ještě chybí ve slovníku. Projde zdrojáky, vytáhne klíče z t(...), tk(...) a t.p(...) a vypíše ty, které nemají anglický záznam.
//   node src/i18n/tools/extract.mjs <soubor-s-úkoly> [oblast-souborů-regex]
// Řádek úkolu:  číslo|český text   nebo   číslo|PLURAL|jedna|dvě|pět   (a za tabulátorem, kde se použil)
// Odpověď (jiný soubor):  číslo|English text   nebo   číslo|singular|plural
import fs from 'node:fs';
import { listSourceFiles, scanFile } from './scan.mjs';
import { readMerged } from './dictionary.mjs';

export const missingKeys = async (fileFilter = null) => {
  const dict = await readMerged();
  const found = new Map(); // key -> { kind, where: [] }
  for (const rel of listSourceFiles()) {
    if (fileFilter && !fileFilter.test(rel)) continue;
    for (const k of scanFile(rel).keys) {
      const have = Object.prototype.hasOwnProperty.call(dict, k.key);
      if (have) continue;
      if (!found.has(k.key)) found.set(k.key, { kind: k.kind === 'plural' ? 'plural' : 'text', where: [] });
      found.get(k.key).where.push(`${rel}:${k.line}`);
    }
  }
  return [...found.entries()].map(([key, v], i) => ({ id: i + 1, key, kind: v.kind, where: v.where }));
};

if (process.argv[1] && process.argv[1].endsWith('extract.mjs')) {
  const [out, filter] = process.argv.slice(2);
  if (!out) { console.error('použití: node extract.mjs <soubor-s-úkoly> [regex souborů]'); process.exit(1); }
  const list = await missingKeys(filter ? new RegExp(filter) : null);
  const lines = list.map((m) => (m.kind === 'plural' ? `${m.id}|PLURAL|${m.key}` : `${m.id}|${m.key}`) + `\t@${m.where.slice(0, 2).join(' ')}`);
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`${list.length} chybějících klíčů zapsáno do ${out}`);
}
