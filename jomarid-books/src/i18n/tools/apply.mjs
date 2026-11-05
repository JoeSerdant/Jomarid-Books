// Zapíše překlady do oblasti slovníku:   node src/i18n/tools/apply.mjs <oblast> <soubor-s-úkoly> <soubor-s-odpověďmi>
// Úkoly vytvořil extract.mjs, odpovědi mají řádky  číslo|English  (plurál  číslo|singular|plural). Spáruje se podle čísla,
// zkontroluje, že anglický text má stejné {parametry} jako český a že neobsahuje českou diakritiku.
import fs from 'node:fs';
import { placeholdersOf, hasCzechDiacritics } from './scan.mjs';
import { readArea, writeArea } from './dictionary.mjs';

export const parseTodo = (text) => {
  const todo = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const body = line.split('\t@')[0];
    const m = /^(\d+)\|(.*)$/s.exec(body);
    if (!m) throw new Error(`špatný řádek úkolu: ${line.slice(0, 80)}`);
    const rest = m[2];
    if (rest.startsWith('PLURAL|')) todo.set(Number(m[1]), { kind: 'plural', key: rest.slice(7) });
    else todo.set(Number(m[1]), { kind: 'text', key: rest });
  }
  return todo;
};

export const parseAnswers = (text, todo) => {
  const out = {}; const problems = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = /^(\d+)\|(.*)$/s.exec(line);
    if (!m) { problems.push(`špatný řádek odpovědi: ${line.slice(0, 80)}`); continue; }
    const id = Number(m[1]); const item = todo.get(id);
    if (!item) { problems.push(`neznámé číslo ${id}`); continue; }
    seen.add(id);
    if (item.kind === 'plural') {
      const forms = m[2].split('|');
      if (forms.length !== 2 || forms.some((f) => !f.trim())) { problems.push(`${id}: plurál potřebuje dva tvary (singular|plural): ${m[2]}`); continue; }
      out[item.key] = forms.map((f) => f.trim());
    } else {
      const en = m[2].trim();
      if (!en) { problems.push(`${id}: prázdný překlad`); continue; }
      const a = placeholdersOf(item.key).join(','); const b = placeholdersOf(en).join(',');
      if (a !== b) { problems.push(`${id}: parametry se liší (${a || '-'} x ${b || '-'}): ${item.key}`); continue; }
      out[item.key] = en;
    }
  }
  for (const id of todo.keys()) if (!seen.has(id)) problems.push(`chybí odpověď na číslo ${id}: ${todo.get(id).key.slice(0, 60)}`);
  for (const [k, v] of Object.entries(out)) {
    for (const s of Array.isArray(v) ? v : [v]) if (hasCzechDiacritics(s) && !/^(Kouloví Kámoši)$/.test(s)) problems.push(`česká diakritika v překladu: ${k.slice(0, 50)} -> ${s.slice(0, 50)}`);
  }
  return { out, problems };
};

if (process.argv[1] && process.argv[1].endsWith('apply.mjs')) {
  const [area, todoFile, doneFile] = process.argv.slice(2);
  if (!area || !todoFile || !doneFile) { console.error('použití: node apply.mjs <oblast> <úkoly> <odpovědi>'); process.exit(1); }
  const todo = parseTodo(fs.readFileSync(todoFile, 'utf8'));
  const { out, problems } = parseAnswers(fs.readFileSync(doneFile, 'utf8'), todo);
  if (problems.length) { console.error(problems.join('\n')); console.error(`\n${problems.length} problémů, nic se nezapsalo.`); process.exit(2); }
  const existing = await readArea(area);
  writeArea(area, { ...existing, ...out });
  console.log(`Oblast ${area}: přidáno ${Object.keys(out).length}, celkem ${Object.keys({ ...existing, ...out }).length}.`);
}
