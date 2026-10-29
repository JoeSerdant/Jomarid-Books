// Synchronizace postupu jedné hry se serverem (db/game-saves.sql). Drží celý postup ({klíč: text}) v paměti, změny z hry
// (apply) odesílá s odkladem a hlídá, aby jedno zařízení nepřepsalo postup z druhého (revize).
//
// - load(): načte postup ze serveru. Je-li v prohlížeči starý postup z localStorage (readLegacy), pošle ho serveru (jednorázový přenos)
//   a teprve potom ho z prohlížeče smaže. Při chybě spojení vyhodí: hra se pak nesmí spustit naprázdno, uložený postup by se přepsal.
// - apply(zpráva): změna z hry (set / remove / clear). Uloží se po odkladu debounceMs (nejpozději maxWaitMs od první neuložené změny).
// - flush(): uloží hned (zavření hry, skrytí stránky). Nikdy nevyhazuje.
// - flushOnHide(): uložení při odchodu ze stránky (fetch s keepalive).
// - Chyba spojení: opakuje se s rostoucími prodlevami (retryDelaysMs). Konflikt revize (hraje se i jinde) a odmítnutí serverem (příliš velký
//   nebo nesmyslný postup) ukládání zastaví: stav 'conflict' / 'rejected'.
// onStatus({state, ...}) se volá při změně stavu: 'failing' (neuloženo, zkouším znovu), 'offline' (bez spojení, postup je v zařízení),
// 'ok' s recovered: true (zase uloženo), 'conflict', 'rejected'.
//
// Offline (volitelné, parametr offline = { read, write, reconcile }, viz offline/gameSaves.js a gameMerge.js):
// - Každá změna se (s krátkým odkladem) zrcadlí do šifrované kopie v zařízení.
// - Nejde-li server načíst kvůli spojení, hra se otevře z té kopie. Není-li žádná a zařízení je offline, load vyhodí NoLocalSaveError;
//   hráč pak může zvolit load({ allowEmpty: true }): hra začne od nuly a po připojení se postup sloučí s účtem (pokročilejší vyhraje, druhý je záloha).
// - Bez spojení se na server nic neposílá; po návratu spojení (retryNow) se změny uloží. Mezitím-li se postup změnil i na serveru
//   (hrálo se jinde), rozhodne se podle toho, který je pokročilejší (gameMerge.js).
import { saveProblem } from './catalog.js';
import { loadGameState, importLegacyGameState, saveGameState } from './api.js';
import { isTransientError } from '../offline/model.js';

// Hra nejde načíst ze serveru a v zařízení pro ni není uložený postup (nehrála se na tomhle zařízení s internetem).
export class NoLocalSaveError extends Error { constructor() { super('no_local_save'); this.name = 'NoLocalSaveError'; } }

const SERVER_REJECTS = ['invalid_data', 'too_large'];
const rejectReason = (err) => SERVER_REJECTS.find((code) => new RegExp(`(^|[^a-z_])${code}($|[^a-z_])`).test(String(err?.message || err || ''))) || null;

export function createGameSync({
  client, gameId,
  readLegacy = () => ({}), clearLegacy = () => {}, keepalive = null,
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now(),
  onStatus = () => {},
  offline = null, isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false,
  debounceMs = 2500, maxWaitMs = 15000, retryDelaysMs = [3000, 8000, 20000, 60000], mirrorDelayMs = 600,
}) {
  let map = {};
  let rev = 0;
  let loaded = false;
  let version = 0; // zvyšuje se při každé změně
  let savedVersion = 0; // poslední verze, o které server ví
  let firstDirtyAt = 0;
  let timer = null;
  let inflight = null;
  let failures = 0;
  let status = 'ok';
  let stopped = false; // po konfliktu nebo odmítnutí se neukládá
  let disposed = false;
  let touchedOffline = false; // od posledního uložení na server se hrálo bez spojení (při konfliktu se pak rozhoduje podle pokroku)
  let mirrorTimer = null;

  const setStatus = (state, info = {}) => {
    const changed = state !== status;
    status = state;
    if (changed) onStatus({ state, ...info });
  };
  const stop = (state, info) => { stopped = true; clearTimer(timer); timer = null; setStatus(state, info); };

  // Kopie v zařízení: aktuální postup a to, jestli v něm jsou změny, které server nezná. Chyba úložiště (plné, zakázané) hru nezastaví.
  const mirror = () => {
    if (!offline || !loaded) return Promise.resolve();
    return Promise.resolve(offline.write({ map: { ...map }, rev, dirty: version !== savedVersion })).catch(() => {});
  };
  const scheduleMirror = () => {
    if (!offline || disposed) return;
    clearTimer(mirrorTimer);
    mirrorTimer = setTimer(() => { mirrorTimer = null; mirror(); }, mirrorDelayMs);
  };
  const mirrorNow = async () => {
    if (!mirrorTimer) return;
    clearTimer(mirrorTimer); mirrorTimer = null;
    await mirror();
  };

  const schedule = (delay) => {
    if (stopped || disposed || !loaded) return;
    clearTimer(timer);
    const wait = delay ?? Math.max(0, Math.min(debounceMs, firstDirtyAt + maxWaitMs - now()));
    timer = setTimer(() => { timer = null; flush(); }, wait);
  };

  async function load({ allowEmpty = false } = {}) {
    stopped = false;
    // Změny z dřívějšího hraní bez spojení se nejdřív sloučí se serverem (nechtěně by se přepsaly). Chyba spojení nevadí: níž se hra otevře z kopie.
    if (offline && !isOffline()) { try { await offline.reconcile(); } catch { /* spojení nebo opakovaný konflikt: řeší se níž */ } }
    let server;
    try {
      server = await loadGameState(client, gameId);
    } catch (err) {
      if (!offline || !isTransientError(err)) throw err;
      const copy = await Promise.resolve(offline.read()).catch(() => null);
      // Bez kopie a bez spojení: NoLocalSaveError (nebo od nuly, když to hráč výslovně chce). Server, který jen vypadl, zatímco zařízení je online,
      // se hlásí jako obyčejná chyba načtení (jako dřív).
      if (!copy && !allowEmpty) throw (isOffline() ? new NoLocalSaveError() : err);
      map = copy ? { ...copy.map } : {};
      rev = copy ? copy.rev : 0;
      version = copy?.dirty ? 1 : 0; savedVersion = 0; firstDirtyAt = copy?.dirty ? now() : 0; failures = 0;
      stopped = false; loaded = true; touchedOffline = true;
      status = 'ok'; setStatus(isOffline() ? 'offline' : 'failing', { failures: 0 });
      return;
    }
    if (offline) {
      // Neodeslané změny, které se sloučit nepovedlo, by se přepsaly: hra se radši nespustí a zkusí se to znovu.
      const copy = await Promise.resolve(offline.read()).catch(() => null);
      if (copy?.dirty) throw new Error('offline_reconcile_pending');
    }
    let state = server;
    const legacy = readLegacy(gameId) || {};
    const keys = Object.keys(legacy);
    if (keys.length > 0) {
      try {
        const res = await importLegacyGameState(client, gameId, legacy);
        state = { rev: res.rev, data: res.data };
        clearLegacy(gameId, keys);
      } catch (err) {
        // Server starý postup odmítl kvůli tvaru nebo velikosti: opakování by nepomohlo a hra by se nikdy nespustila. Postup v prohlížeči
        // zůstane nedotčený a hraje se z uloženého na serveru. Chyba spojení se vyhodí, aby se hra nespustila naprázdno.
        if (!rejectReason(err)) throw err;
        console.warn('Starý postup z prohlížeče server nepřijal:', err?.message || err);
      }
    }
    map = { ...state.data };
    rev = state.rev;
    version = 0; savedVersion = 0; firstDirtyAt = 0; failures = 0;
    stopped = false; status = 'ok'; loaded = true; touchedOffline = false;
    await mirror();
  }

  function apply(msg) {
    if (!loaded || !msg || typeof msg !== 'object') return false;
    if (msg.op === 'set') {
      if (typeof msg.key !== 'string' || typeof msg.value !== 'string') return false;
      if (map[msg.key] === msg.value) return true;
      map[msg.key] = msg.value;
    } else if (msg.op === 'remove') {
      if (typeof msg.key !== 'string') return false;
      if (!(msg.key in map)) return true;
      delete map[msg.key];
    } else if (msg.op === 'clear') {
      if (Object.keys(map).length === 0) return true;
      map = {};
    } else {
      return false;
    }
    version += 1;
    if (!firstDirtyAt) firstDirtyAt = now();
    if (offline && isOffline()) touchedOffline = true;
    scheduleMirror();
    if (failures === 0) schedule();
    return true;
  }

  async function flush() {
    if (!loaded || stopped) return;
    await mirrorNow();
    if (offline && version !== savedVersion && isOffline()) {
      // Bez spojení se nic neposílá: postup je v zařízení (mirror) a odešle se, až spojení bude.
      clearTimer(timer); timer = null;
      touchedOffline = true;
      setStatus('offline');
      return;
    }
    if (inflight) {
      await inflight;
      if (version !== savedVersion && !stopped && failures === 0) await flush();
      return;
    }
    if (version === savedVersion) return;
    clearTimer(timer); timer = null;
    const problem = saveProblem(map);
    if (problem) { stop('rejected', { reason: problem }); return; }
    const sentVersion = version;
    const sentMap = { ...map };
    inflight = (async () => {
      try {
        const res = await saveGameState(client, gameId, sentMap, rev);
        if (res.ok) {
          rev = res.rev;
          savedVersion = sentVersion;
          firstDirtyAt = version === sentVersion ? 0 : now();
          failures = 0;
          touchedOffline = false;
          if (status === 'failing' || status === 'offline') setStatus('ok', { recovered: true });
          await mirror();
        } else if (offline && touchedOffline) {
          // Hrálo se bez spojení a mezitím se postup změnil i na serveru: vyhraje pokročilejší, druhý je záloha.
          await offline.write({ map: sentMap, rev, dirty: true });
          const out = await offline.reconcile();
          if (out.action === 'server_won') { stop('conflict', { reason: 'server_won', rev: out.rev }); return; }
          rev = out.rev;
          savedVersion = sentVersion;
          firstDirtyAt = version === sentVersion ? 0 : now();
          failures = 0;
          touchedOffline = false;
          if (status === 'failing' || status === 'offline') setStatus('ok', { recovered: true });
          await mirror();
        } else {
          stop('conflict', { rev: res.rev });
        }
      } catch (err) {
        const reason = rejectReason(err);
        if (reason) { stop('rejected', { reason }); return; }
        failures += 1;
        if (offline && isTransientError(err)) touchedOffline = true;
        setStatus(offline && isOffline() ? 'offline' : 'failing', { failures });
      }
    })();
    try { await inflight; } finally { inflight = null; }
    if (stopped || disposed) return;
    if (failures > 0) schedule(retryDelaysMs[Math.min(failures - 1, retryDelaysMs.length - 1)]);
    else if (version !== savedVersion) schedule();
  }

  function flushOnHide() {
    if (!loaded || stopped) return;
    if (offline) { clearTimer(mirrorTimer); mirrorTimer = null; mirror(); }   // odchod ze stránky: kopie v zařízení se uloží hned
    if (inflight || version === savedVersion || !keepalive || (offline && (isOffline() || touchedOffline))) return;
    clearTimer(timer); timer = null;
    keepalive({ gameId, map: { ...map }, baseRev: rev });
  }

  // Spojení je zpět: uloží se, co čeká (a zruší se čekání mezi pokusy).
  async function retryNow() {
    if (!loaded || stopped || disposed) return;
    failures = 0;
    clearTimer(timer); timer = null;
    await flush();
  }

  function dispose() {
    disposed = true;
    clearTimer(timer);
    clearTimer(mirrorTimer);
    timer = null;
    mirrorTimer = null;
  }

  return {
    load, apply, flush, flushOnHide, retryNow, dispose,
    isLoaded: () => loaded,
    snapshot: () => ({ map: { ...map }, rev }),
    state: () => ({ status, dirty: version !== savedVersion, rev, stopped }),
  };
}
