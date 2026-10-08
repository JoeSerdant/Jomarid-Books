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

/* ---------- Hromadný přesun ze staré tabulky (správce) ---------- */

const PAGE = 100;

/** Všechna id knih, které mají řádek ve staré tabulce (po stránkách podle klíče, ať se při změně dat nic nepřeskočí). */
export const listTableBookIds = async (client, { signal } = {}) => {
  const ids = [];
  let last = null;
  for (;;) {
    if (signal?.aborted) break;
    let q = client.from(BOOK_TEXT_TABLE).select('book_id').order('book_id', { ascending: true }).limit(PAGE);
    if (last) q = q.gt('book_id', last);
    const { data, error } = await q;
    if (error) return { ids, error };
    const rows = data || [];
    rows.forEach((r) => ids.push(r.book_id));
    if (rows.length < PAGE) break;
    last = rows[rows.length - 1].book_id;
  }
  return { ids, error: null };
};

/**
 * Přesune jednu knihu: nahraje text, stáhne ho zpět a porovná znak po znaku. Existující jiný soubor se nepřepisuje.
 * status: 'migrated' | 'already' (už tam je stejný) | 'conflict' (ve Storage je jiný text) | 'empty' | 'verify_failed' | 'error'
 */
export const migrateOneBookText = async (client, bookId) => {
  const row = await readTableText(client, bookId);
  if (row.error) return { status: 'error', error: row.error };
  if (typeof row.text !== 'string' || row.text === '') return { status: 'empty' };
  const existing = await downloadBookText(client, bookId);
  if (typeof existing.text === 'string') return { status: existing.text === row.text ? 'already' : 'conflict' };
  if (!existing.missing) return { status: 'error', error: existing.error };
  const up = await uploadBookText(client, bookId, row.text, { upsert: false }); // bez přepisu: mezitím uložená úprava se neztratí
  if (isAlreadyExists(up.error)) return { status: 'conflict' };
  if (up.error) return { status: 'error', error: up.error };
  const back = await downloadBookText(client, bookId);
  if (typeof back.text !== 'string') return { status: 'verify_failed', error: back.error };
  return { status: back.text === row.text ? 'migrated' : 'verify_failed' };
};

/** Přesune všechny knihy ze staré tabulky. onProgress({done,total,counts,last}). Nic nemaže. */
export const migrateAllBookTexts = async (client, { onProgress, signal } = {}) => {
  const listed = await listTableBookIds(client, { signal });
  const counts = { migrated: 0, already: 0, conflict: 0, empty: 0, verify_failed: 0, error: 0 };
  const failures = [];
  if (listed.error) return { total: 0, counts, failures, error: listed.error };
  const total = listed.ids.length;
  let done = 0;
  for (const id of listed.ids) {
    if (signal?.aborted) break;
    const r = await migrateOneBookText(client, id);
    counts[r.status] += 1;
    if (r.status !== 'migrated' && r.status !== 'already' && r.status !== 'empty') failures.push({ id, status: r.status, message: r.error?.message || '' });
    done += 1;
    onProgress?.({ done, total, counts: { ...counts }, last: { id, status: r.status } });
  }
  return { total, counts, failures, error: null, aborted: !!signal?.aborted };
};

/**
 * Smaže ze staré tabulky řádky, jejichž text je ve Storage totožný (znovu se ověří těsně před smazáním).
 * Řádek, který se liší nebo ve Storage chybí, se NIKDY nemaže.
 */
export const cleanupTableCopies = async (client, { onProgress, signal } = {}) => {
  const listed = await listTableBookIds(client, { signal });
  const counts = { deleted: 0, kept: 0, error: 0 };
  if (listed.error) return { total: 0, counts, error: listed.error };
  const total = listed.ids.length;
  let done = 0;
  for (const id of listed.ids) {
    if (signal?.aborted) break;
    const row = await readTableText(client, id);
    const stored = row.error ? null : await downloadBookText(client, id);
    if (row.error || (stored.error && !stored.missing)) {
      counts.error += 1;
    } else if (typeof row.text !== 'string' || typeof stored.text !== 'string' || stored.text !== row.text) {
      counts.kept += 1; // ve Storage chybí nebo se liší: stará kopie zůstává
    } else {
      const del = await client.from(BOOK_TEXT_TABLE).delete().eq('book_id', id);
      counts[del.error ? 'error' : 'deleted'] += 1;
    }
    done += 1;
    onProgress?.({ done, total, counts: { ...counts } });
  }
  return { total, counts, error: null, aborted: !!signal?.aborted };
};

/** Přehled: kolik textů je ve staré tabulce a kolik ve Storage (jen počty, bez stahování). */
export const countStoredTexts = async (client) => {
  let count = 0;
  let offset = 0;
  for (;;) {
    const { data, error } = await store(client).list('', { limit: 1000, offset });
    if (error) return { count, error };
    const files = (data || []).filter((o) => o?.name && o.id);
    count += files.length;
    if ((data || []).length < 1000) break;
    offset += 1000;
  }
  return { count, error: null };
};
