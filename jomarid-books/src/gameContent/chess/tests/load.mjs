// Načte soubory hry do izolovaného kontextu (stejně jako je v prohlížeči skládá chess.js)
// a vrátí funkci, která vyhodnotí výraz v tomhle kontextu.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCES = ['rules.js', 'search.js', 'book.js', 'league.js', 'bots.js', 'session.js'];

export function loadGame(files = SOURCES) {
  const ctx = vm.createContext({ console, Math, Date, JSON, setTimeout, clearTimeout });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
  return (expr) => vm.runInContext(expr, ctx);
}

// Objekty z vm kontextu mají jiný prototyp, takže se pro porovnání převedou přes JSON.
export const plain = (x) => JSON.parse(JSON.stringify(x));
