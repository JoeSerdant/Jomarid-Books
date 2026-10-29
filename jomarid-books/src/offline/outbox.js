// Fronta změn z offline čtení: pozice, záložky, zvýraznění, poznámky, hodnocení. Změny se ukládají do zařízení a po připojení se odešlou serveru
// pod skutečnou relací (server dál rozhoduje o všem: o dnešním dni čtení, o dočtení, o mincích). Stejné volání jako čtečka online.
import { STORES } from './store.js';
import { LOCAL_PREFIX, isLocalId, isTransientError, resolvePosition } from './model.js';

const seqKey = (n) => `${String(n).padStart(12, '0')}`;

export function createOutbox({ store, now = Date.now }) {
  let counter = 0;
  let chain = Promise.resolve();   // zápisy do fronty běží po jednom (rychlé změny za sebou se nepřepíšou)
  const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

  const nextKey = async () => {
    if (!counter) { const keys = await store.keys(STORES.queue); counter = keys.length ? Number(keys[keys.length - 1]) : 0; }
    counter += 1;
    return seqKey(counter);
  };

  const list = async (userId) => (await store.all(STORES.queue)).filter((e) => !userId || e.value.userId === userId);

  // Přidá změnu. Pozice a hodnocení se pro jednu knihu slučují do jedné (platí poslední), zvýraznění a záložky vzniklé offline a hned smazané se zruší navzájem.
  const enqueue = (op) => serial(async () => {
    const entry = { ...op, at: op.at ?? now() };
    const all = await list(op.userId);
    const same = (e, type) => e.value.type === type && e.value.bookId === op.bookId;
    if (op.type === 'position') {
      const prev = all.find((e) => same(e, 'position'));
      if (prev) { await store.put(STORES.queue, prev.key, { ...prev.value, ...entry, isRead: !!(prev.value.isRead || entry.isRead), tries: 0 }); return; }
    } else if (op.type === 'rating') {
      const prev = all.find((e) => same(e, 'rating'));
      if (prev) { await store.put(STORES.queue, prev.key, { ...prev.value, ...entry, tries: 0 }); return; }
    } else if ((op.type === 'bookmark_delete' || op.type === 'highlight_delete') && isLocalId(op.id)) {
      // Smazání položky, která na serveru ještě není: stačí zrušit její vytvoření (a změny poznámky), nic se neposílá.
      const addType = op.type === 'bookmark_delete' ? 'bookmark_add' : 'highlight_add';
      const related = all.filter((e) => (e.value.type === addType && e.value.localId === op.id) || (e.value.type === 'highlight_note' && e.value.id === op.id));
      for (const e of related) await store.del(STORES.queue, e.key);
      return;
    } else if (op.type === 'highlight_note') {
      const prev = all.find((e) => e.value.type === 'highlight_note' && e.value.id === op.id);
      if (prev) { await store.put(STORES.queue, prev.key, { ...prev.value, ...entry, tries: 0 }); return; }
      const add = isLocalId(op.id) ? all.find((e) => e.value.type === 'highlight_add' && e.value.localId === op.id) : null;
      if (add) { await store.put(STORES.queue, add.key, { ...add.value, note: op.note }); return; }   // poznámka k ještě neodeslanému zvýraznění jde rovnou s ním
    }
    await store.put(STORES.queue, await nextKey(), { ...entry, tries: 0 });
  });

  const pending = async (userId) => (await list(userId)).length;
  const clear = async () => { await store.clear(STORES.queue); counter = 0; };

  // Po přijetí položky serverem se dočasné id nahradí skutečným v dalších změnách ve frontě.
  const remap = async (userId, localId, serverId) => {
    for (const e of await list(userId)) {
      if (e.value.id === localId) await store.put(STORES.queue, e.key, { ...e.value, id: serverId });
    }
  };

  let flushing = null;

  // Odešle změny v pořadí. Při výpadku sítě se zastaví (zbytek zůstane), změnu zamítnutou serverem (práva, špatná data) zahodí.
  // callbacks.onRemap(localId, serverRow, kind) dostane skutečnou položku, ať se opraví uložená kopie knihy.
  const flush = (client, userId, callbacks = {}) => {
    if (flushing) return flushing;
    flushing = (async () => {
      const result = { sent: 0, dropped: 0, remaining: 0, stopped: false };
      const dead = new Set();   // dočasná id, jejichž vytvoření server zamítl
      for (const snap of await list(userId)) {
        const entry = { key: snap.key, value: await store.get(STORES.queue, snap.key) };   // čerstvě: dočasná id se mezitím mohla nahradit skutečnými
        if (!entry.value) continue;
        const op = entry.value;
        const refs = [op.id, op.localId].filter((x) => typeof x === 'string' && x.startsWith(LOCAL_PREFIX));
        if (refs.some((r) => dead.has(r) || (op.type !== 'bookmark_add' && op.type !== 'highlight_add'))) {
          // změna míří na položku, která na serveru není (vytvoření zamítnuto nebo nikdy neodešlo)
          await store.del(STORES.queue, entry.key); result.dropped += 1; continue;
        }
        let ok = false;
        try {
          ok = await runOp(client, userId, op, callbacks, async (localId, serverId) => { await remap(userId, localId, serverId); });
          if (ok === 'dropped') { await store.del(STORES.queue, entry.key); result.dropped += 1; continue; }
        } catch (err) {
          if (isTransientError(err)) { result.stopped = true; break; }
          console.error('Změnu z offline čtení server nepřijal, zahazuje se:', op.type, err?.message || err);
          await store.del(STORES.queue, entry.key); result.dropped += 1;
          if (op.localId) dead.add(op.localId);
          continue;
        }
        await store.del(STORES.queue, entry.key); result.sent += 1;
      }
      result.remaining = await pending(userId);
      return result;
    })().finally(() => { flushing = null; });
    return flushing;
  };

  return { enqueue, pending, list, clear, flush, remap };
}

// Jedna změna proti serveru. Vrací true, nebo 'dropped' (nemá smysl odesílat); chyba se vyhazuje.
async function runOp(client, userId, op, callbacks, remapId) {
  const need = (res) => { if (res?.error) throw res.error; return res; };
  switch (op.type) {
    case 'position': {
      const cur = need(await client.from('user_books').select('scroll_position, is_read, updated_at, status').eq('user_id', userId).eq('book_id', op.bookId).maybeSingle()).data;
      const r = resolvePosition(op, cur);
      if (!r.apply && !(r.isRead && !cur?.is_read)) return 'dropped';
      const payload = { user_id: userId, book_id: op.bookId, is_read: r.isRead, updated_at: new Date(op.at).toISOString() };
      payload.scroll_position = r.apply ? r.percent : (Number(cur?.scroll_position) || 0);
      if (!cur) payload.status = 'active';
      need(await client.from('user_books').upsert(payload, { onConflict: 'user_id,book_id' }));
      return true;
    }
    case 'bookmark_add': {
      const row = need(await client.from('book_bookmarks').insert([{ user_id: userId, book_id: op.bookId, label: op.label, scroll_position: op.percent }]).select('id, label, scroll_position, created_at').single()).data;
      await remapId(op.localId, row.id); await callbacks.onRemap?.(op.localId, row, 'bookmark', op.bookId);
      return true;
    }
    case 'bookmark_delete': need(await client.from('book_bookmarks').delete().eq('id', op.id)); return true;
    case 'highlight_add': {
      const row = need(await client.from('book_highlights').insert([{ user_id: userId, book_id: op.bookId, start_offset: op.start, end_offset: op.end, color: op.color, ...(op.note ? { note: op.note } : {}) }]).select('id, start_offset, end_offset, color, note').single()).data;
      await remapId(op.localId, row.id); await callbacks.onRemap?.(op.localId, row, 'highlight', op.bookId);
      return true;
    }
    case 'highlight_note': need(await client.from('book_highlights').update({ note: op.note || null }).eq('id', op.id)); return true;
    case 'highlight_delete': need(await client.from('book_highlights').delete().eq('id', op.id)); return true;
    case 'rating': need(await client.from('book_ratings').upsert({ user_id: userId, book_id: op.bookId, rating: op.rating, updated_at: new Date(op.at).toISOString() }, { onConflict: 'user_id,book_id' })); return true;
    default: return 'dropped';
  }
}
