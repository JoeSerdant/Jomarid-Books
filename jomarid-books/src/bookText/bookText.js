// Text knih ve Storage. Každá kniha je jeden soubor <id knihy>.txt v soukromém bucketu "book-texts"; přístup hlídají
// pravidla v databázi (stejná jako dřív u tabulky book_contents: správce, autor, držitel aktivní licence, automaticky
// přidělené knihy). Stará tabulka book_contents zůstává jako záloha: čte se z ní, dokud text ve Storage není, a zápis
// do ní se použije jen když bucket vůbec neexistuje (SQL ještě nebylo spuštěno).
//
// Text se ukládá a čte BEZ jakékoli úpravy (ani konců řádků, ani znaku BOM), protože zvýraznění v čtečce jsou
// uložená jako číselné pozice v textu. Čistá logika bez Reactu, jde testovat v Node (src/tests/bookText.test.mjs).

export const BOOK_TEXT_BUCKET = 'book-texts';
export const BOOK_TEXT_TABLE = 'book_contents';
const MIME = 'text/plain';

export const bookTextPath = (bookId) => `${bookId}.txt`;

const store = (client) => client.storage.from(BOOK_TEXT_BUCKET);

/** Bucket ještě neexistuje (SQL nebylo spuštěno) nebo Storage není dostupný: dá se spadnout zpět na tabulku. */
export const isBucketMissing = (error) => {
  if (!error) return false;
  return /bucket not found/i.test(String(error.message || '')) || (/bucket/i.test(String(error.message || '')) && String(error.statusCode ?? error.status) === '404');
};

/** Soubor ve Storage chybí (zatím nepřesunutá nebo nová kniha). */
export const isObjectMissing = (error) => {
  if (!error) return false;
  const status = String(error.statusCode ?? error.status ?? '');
  return /not found|no such|does not exist/i.test(String(error.message || '')) || status === '404';
};

// TextDecoder s ignoreBOM: znak U+FEFF na začátku textu zůstane (Blob.text() ho tiše zahazuje a posunul by pozice).
const decodeExact = async (blob) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer());

/** Stáhne text ze Storage. {text} | {missing:true} | {error}. */
export const downloadBookText = async (client, bookId) => {
  let res;
  try { res = await store(client).download(bookTextPath(bookId)); } catch (e) { res = { error: e }; }
  if (res.error) return isObjectMissing(res.error) ? { missing: true, error: res.error } : { error: res.error };
  if (!res.data) return { missing: true };
  try { return { text: await decodeExact(res.data) }; } catch (e) { return { error: e }; }
};

/** Soubor už ve Storage je (nahrání bez přepisu skončí chybou 409). */
export const isAlreadyExists = (error) => {
  if (!error) return false;
  const status = String(error.statusCode ?? error.status ?? '');
  return status === '409' || /already exists|duplicate/i.test(String(error.message || ''));
};

/**
 * Nahraje text do Storage. Bez mezipaměti, ať editor nikdy nenačte starší verzi.
 * upsert=false (přesun) soubor jen vytvoří a existující nepřepíše, takže nemůže smazat novější úpravu.
 */
export const uploadBookText = async (client, bookId, text, { upsert = true } = {}) => {
  try {
    const { error } = await store(client).upload(bookTextPath(bookId), new Blob([text], { type: MIME }), { upsert, contentType: MIME, cacheControl: '0' });
    return { error: error || null };
  } catch (e) { return { error: e }; }
};

const readTableText = async (client, bookId) => {
  const res = await client.from(BOOK_TEXT_TABLE).select('content').eq('book_id', bookId).maybeSingle();
  if (res.error) return { error: res.error };
  return { text: typeof res.data?.content === 'string' ? res.data.content : null };
};

/**
 * Načte text knihy: nejdřív ze Storage, když tam není, ze staré tabulky.
 * Vrací { text, source: 'storage'|'table'|'none', error }. text je null, když kniha žádný text nemá nebo se nenačetl (error).
 */
export const fetchBookText = async (client, bookId) => {
  const fromStore = await downloadBookText(client, bookId);
  if (typeof fromStore.text === 'string') return { text: fromStore.text, source: 'storage', error: null };
  // Stará tabulka je záloha jen pro knihu, kterou ve Storage opravdu nemáme (soubor nebo bucket chybí). Při výpadku
  // Storage by se jinak načetl případně zastaralý text a jeho uložení by přepsalo novější verzi.
  if (!fromStore.missing && !isBucketMissing(fromStore.error)) return { text: null, source: 'none', error: fromStore.error || new Error('Text knihy se nepodařilo načíst.') };
  const fromTable = await readTableText(client, bookId);
  if (typeof fromTable.text === 'string') return { text: fromTable.text, source: 'table', error: null };
  return { text: null, source: 'none', error: fromTable.error || null };
};

/**
 * Uloží text knihy do Storage a smaže starou kopii z tabulky (ať nezůstane zastaralá ani nezabírá místo).
 * Jen když bucket vůbec neexistuje, uloží se do staré tabulky jako dřív. Vrací { error, where }.
 */
export const saveBookText = async (client, bookId, text) => {
  const up = await uploadBookText(client, bookId, text);
  if (!up.error) {
    try { await client.from(BOOK_TEXT_TABLE).delete().eq('book_id', bookId); } catch { /* stará kopie se zkusí smazat příště */ }
    return { error: null, where: 'storage' };
  }
  if (isBucketMissing(up.error)) {
    const res = await client.from(BOOK_TEXT_TABLE).upsert({ book_id: bookId, content: text });
    return { error: res.error || null, where: 'table' };
  }
  return { error: up.error, where: 'storage' };
};

/** Smaže text knihy ze Storage (po smazání knihy). Chyba nevadí: nanejvýš zůstane nepřístupný soubor. */
export const removeBookText = async (client, bookId) => {
  try { await store(client).remove([bookTextPath(bookId)]); } catch { /* nevadí */ }
};

const LIST_PAGE = 1000;
const LIST_MAX_PAGES = 50;

/**
 * Které z knih mají text ve Storage. Vrací { found:Set, complete }. complete=false: nepodařilo se ověřit všechny.
 * Pár knih se ověří jednotlivě, víc se zjistí z výpisu bucketu po stránkách (jeden dotaz na 1000 souborů).
 * Bucket, který neexistuje, znamená "nic ve Storage" (complete zůstává true).
 */
export const findBookTexts = async (client, ids, { few = 25 } = {}) => {
  const found = new Set();
  if (!ids.length || !client?.storage) return { found, complete: true };
  if (ids.length <= few) {
    let complete = true;
    for (const id of ids) {
      let res;
      try { res = await store(client).list('', { limit: 5, search: bookTextPath(id) }); } catch (e) { res = { error: e }; }
      if (res.error) { if (isBucketMissing(res.error)) break; complete = false; continue; }
      if ((res.data || []).some((o) => o?.name === bookTextPath(id))) found.add(id);
    }
    return { found, complete };
  }
  const wanted = new Set(ids.map(bookTextPath));
  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    let res;
    try { res = await store(client).list('', { limit: LIST_PAGE, offset: page * LIST_PAGE }); } catch (e) { res = { error: e }; }
    if (res.error) return { found, complete: isBucketMissing(res.error) };
    const rows = res.data || [];
    rows.forEach((o) => { if (wanted.has(o?.name)) found.add(o.name.slice(0, -4)); });
    if (rows.length < LIST_PAGE) return { found, complete: true };
  }
  return { found, complete: false }; // výpis je delší než strop: co se nenašlo, není potvrzené
};
