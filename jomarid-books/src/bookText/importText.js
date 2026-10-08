// Načtení textu knihy ze souboru přetaženého do editoru (nakladatel, správce). Čistá logika bez Reactu.
// Podporované jsou prosté textové soubory; kódování se pozná samo (UTF-8, UTF-16 s BOM, jinak Windows-1250, což je
// u starších českých textů nejčastější). Word, PDF a e-knihy se odmítnou s návodem, ať se nevloží změť znaků.

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // stejný strop jako u souboru ve Storage
const TEXT_EXT = /\.(txt|text|md|markdown)$/i;
const OTHER_EXT = /\.(docx?|odt|rtf|pdf|epub|mobi|azw3?|html?)$/i;

const sniffBinary = (bytes) => {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
};

/** Dekóduje bajty souboru na text. Vrací { text, encoding }. */
export const decodeTextBytes = (buffer) => {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes); // BOM na začátku se zahodí
    return { text, encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1250').decode(bytes), encoding: 'windows-1250' };
  }
};

/** Přečte textový soubor. Vrací { text, encoding } nebo { error } (česky, k zobrazení uživateli). */
export const readTextFile = async (file) => {
  const name = String(file?.name || '');
  if (!file) return { error: 'Soubor se nepodařilo načíst.' };
  if (OTHER_EXT.test(name)) return { error: 'Tenhle typ souboru nejde vložit. Ulož ho nejdřív jako prostý text (.txt) nebo text z něj rovnou zkopíruj a vlož.' };
  if (!TEXT_EXT.test(name) && file.type && !/^text\//i.test(file.type)) return { error: 'Podporované jsou textové soubory (.txt, .md).' };
  if (file.size > MAX_IMPORT_BYTES) return { error: 'Soubor je příliš velký (nejvýš 20 MB).' };
  let buffer;
  try { buffer = await file.arrayBuffer(); } catch { return { error: 'Soubor se nepodařilo načíst.' }; }
  const head = new Uint8Array(buffer);
  const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff); // UTF-16 obsahuje nulové bajty
  if (!utf16 && sniffBinary(head)) return { error: 'Soubor vypadá jako binární, ne jako prostý text.' };
  const { text, encoding } = decodeTextBytes(buffer);
  if (!text.trim()) return { error: 'Soubor je prázdný.' };
  return { text, encoding };
};

/** Jak se vložený text spojí s tím, co už v poli je: 'replace' nahradí, 'append' připojí na konec s prázdným řádkem. */
export const mergeImported = (current, imported, mode) => {
  if (mode === 'append' && current.trim()) return `${current.replace(/\s+$/, '')}\n\n${imported}`;
  return imported;
};
