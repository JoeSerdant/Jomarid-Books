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
// onStatus({state, ...}) se volá při změně stavu: 'failing' (neuloženo, zkouším znovu), 'ok' s recovered: true (zase uloženo),
// 'conflict', 'rejected'.
import { saveProblem } from './catalog.js';
import { loadGameState, importLegacyGameState, saveGameState } from './api.js';

const SERVER_REJECTS = ['invalid_data', 'too_large'];
const rejectReason = (err) => SERVER_REJECTS.find((code) => new RegExp(`(^|[^a-z_])${code}($|[^a-z_])`).test(String(err?.message || err || ''))) || null;

export function createGameSync({
  client, gameId,
  readLegacy = () => ({}), clearLegacy = () => {}, keepalive = null,
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now(),
  onStatus = () => {},
  debounceMs = 2500, maxWaitMs = 15000, retryDelaysMs = [3000, 8000, 20000, 60000],
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

  const setStatus = (state, info = {}) => {
    const changed = state !== status;
    status = state;
    if (changed) onStatus({ state, ...info });
  };
  const stop = (state, info) => { stopped = true; clearTimer(timer); timer = null; setStatus(state, info); };

  const schedule = (delay) => {
    if (stopped || disposed || !loaded) return;
    clearTimer(timer);
    const wait = delay ?? Math.max(0, Math.min(debounceMs, firstDirtyAt + maxWaitMs - now()));
    timer = setTimer(() => { timer = null; flush(); }, wait);
  };

  async function load() {
    const server = await loadGameState(client, gameId);
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
    stopped = false; status = 'ok'; loaded = true;
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
    if (failures === 0) schedule();
    return true;
  }

  async function flush() {
    if (!loaded || stopped) return;
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
          if (status === 'failing') setStatus('ok', { recovered: true });
        } else {
          stop('conflict', { rev: res.rev });
        }
      } catch (err) {
        const reason = rejectReason(err);
        if (reason) { stop('rejected', { reason }); return; }
        failures += 1;
        setStatus('failing', { failures });
      }
    })();
    try { await inflight; } finally { inflight = null; }
    if (stopped || disposed) return;
    if (failures > 0) schedule(retryDelaysMs[Math.min(failures - 1, retryDelaysMs.length - 1)]);
    else if (version !== savedVersion) schedule();
  }

  function flushOnHide() {
    if (!loaded || stopped || inflight || version === savedVersion || !keepalive) return;
    clearTimer(timer); timer = null;
    keepalive({ gameId, map: { ...map }, baseRev: rev });
  }

  function dispose() {
    disposed = true;
    clearTimer(timer);
    timer = null;
  }

  return {
    load, apply, flush, flushOnHide, dispose,
    isLoaded: () => loaded,
    snapshot: () => ({ map: { ...map }, rev }),
    state: () => ({ status, dirty: version !== savedVersion, rev, stopped }),
  };
}
