import { useCallback, useEffect, useRef, useState } from 'react';
import { Coins, Loader2, Swords, Users, KeyRound, X } from 'lucide-react';
import { t } from '../i18n';
import { mpApi } from './index.js';
import { MP_GAMES, cleanParams, defaultParams, hasArena, hasOnline } from './catalog.js';
import { mpErrorText } from './errors.js';

const FIND_EVERY_MS = 2000;

// Oddíl „Hrát online“ pod tlačítkem spustit hru: hledání náhodného soupeře, hra s kamarádem přes kód a návrat do rozehraného zápasu.
// Ukáže se jen tehdy, když je multiplayer na serveru zapnutý (mp_ping) a hra má online režim.
export const MpSection = ({ game, online, auto, onMatch, onArena }) => {
  const def = MP_GAMES[game.id];
  const arena = hasArena(game.id);
  const enabled = hasOnline(game.id) || arena;
  const [state, setState] = useState('checking'); // checking | off | ready
  const [realtime, setRealtime] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | searching | room
  const [mode, setMode] = useState(auto?.mode && def?.modes.some((m) => m.id === auto.mode) ? auto.mode : def?.modes[0]?.id || '');
  const [params, setParams] = useState(() => (auto ? cleanParams(game.id, auto.params) : defaultParams(game.id)));
  const [waited, setWaited] = useState(0);
  const [queued, setQueued] = useState(0);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(null); // rozehraný zápas z dřívějška
  const [stats, setStats] = useState(null);
  const aliveRef = useRef(true);
  const loopRef = useRef(null);
  const startedRef = useRef(0);
  const autoDoneRef = useRef(false);

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; clearTimeout(loopRef.current); }; }, []);

  const refreshInfo = useCallback(async () => {
    const [a, s] = await Promise.all([mpApi.active(), mpApi.stats()]);
    if (!aliveRef.current) return;
    setActive(a.data && a.data.id ? a.data : null);
    setStats(s.data || null);
  }, []);

  // Je multiplayer na serveru? Dokud odpověď nepřijde, nic se neukazuje. Bez spojení se zeptá, až se spojení vrátí.
  useEffect(() => {
    if (!enabled || !online || state === 'ready') return undefined;
    let cancelled = false;
    (async () => {
      const res = await mpApi.ping();
      if (cancelled) return;
      if (res.error || !res.data?.ok) { setState('off'); return; }
      setRealtime(!!res.data.realtime);
      setState('ready');
      refreshInfo();
    })();
    return () => { cancelled = true; };
  }, [enabled, online, state, refreshInfo]);

  const stopLoop = () => { clearTimeout(loopRef.current); loopRef.current = null; };

  const fail = (err) => { stopLoop(); setPhase('idle'); setBusy(false); setError(mpErrorText(err)); };

  const searchTick = useCallback(async () => {
    const res = await mpApi.find(game.id, mode, params);
    if (!aliveRef.current || loopRef.current === null) return;
    if (res.error) { if (res.error.transient) { loopRef.current = setTimeout(searchTick, FIND_EVERY_MS); return; } fail(res.error); return; }
    if (res.data.status === 'matched') { stopLoop(); setPhase('idle'); onMatch(res.data.match); return; }
    setWaited(Math.round((Date.now() - startedRef.current) / 1000));
    setQueued(res.data.queued || 0);
    loopRef.current = setTimeout(searchTick, FIND_EVERY_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, mode, params, onMatch]);

  const startSearch = () => {
    setError('');
    setPhase('searching');
    setWaited(0);
    startedRef.current = Date.now();
    loopRef.current = setTimeout(() => {}, 0);
    searchTick();
  };

  // „Hrát znovu“ po zápase: hledání soupeře začne samo se stejným nastavením.
  useEffect(() => {
    if (!auto || autoDoneRef.current || state !== 'ready' || !online || phase !== 'idle') return;
    autoDoneRef.current = true;
    startSearch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, state, online, phase]);

  const cancelSearch = async () => {
    stopLoop();
    setPhase('idle');
    setBusy(true);
    await mpApi.cancel();
    setBusy(false);
    // zrušení mohlo dorazit až po spárování: pak je zápas rozehraný a nabídne se návrat
    refreshInfo();
  };

  // Místnost pro kamaráda: kód se ukáže, hra čeká, až kamarád vstoupí (host dostane zápas přes mp_active).
  const roomTick = useCallback(async () => {
    const res = await mpApi.active();
    if (!aliveRef.current || loopRef.current === null) return;
    if (res.data && res.data.id) { stopLoop(); setPhase('idle'); onMatch(res.data); return; }
    loopRef.current = setTimeout(roomTick, FIND_EVERY_MS);
  }, [onMatch]);

  const createRoom = async () => {
    setError('');
    setBusy(true);
    const res = await mpApi.roomCreate(game.id, mode, params);
    setBusy(false);
    if (res.error) { setError(mpErrorText(res.error)); return; }
    setCode(res.data.code);
    setPhase('room');
    loopRef.current = setTimeout(() => {}, 0);
    roomTick();
  };

  const cancelRoom = async () => { stopLoop(); setPhase('idle'); setCode(''); await mpApi.cancel(); refreshInfo(); };

  const joinRoom = async () => {
    setError('');
    setBusy(true);
    const res = await mpApi.roomJoin(joinCode.trim());
    setBusy(false);
    if (res.error) { setError(mpErrorText(res.error)); return; }
    onMatch(res.data);
  };

  const resume = () => { if (active) onMatch(active); };
  const giveUp = async () => {
    if (!active) return;
    setBusy(true);
    await mpApi.resign(active.id);
    setBusy(false);
    setActive(null);
    refreshInfo();
  };

  if (!enabled || state !== 'ready') return null;
  const modeDef = def.modes.find((m) => m.id === mode) || def.modes[0];
  const needsRealtime = (def.kind === 'realtime' || arena) && !realtime;
  const pill = (on) => ({ backgroundColor: on ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: on ? 'var(--text-primary)' : 'var(--text-body)', borderColor: 'var(--border-color)' });
  const cardStyle = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };

  // Sdílená aréna: jedno tlačítko, žádné hledání soupeře
  if (arena) {
    return (
      <div data-testid="mp-section" style={cardStyle} className="w-full max-w-md border rounded-2xl p-4 text-left space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-xs font-black uppercase tracking-wider flex items-center gap-1.5"><Swords size={14} aria-hidden="true" /> {t('Hrát online')}</h2>
          {stats && stats.daily_cap > 0 && (
            <span data-testid="mp-daily" style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-bold flex items-center gap-1" title={t('Kolik Coinů z online výher dnes ještě můžeš získat')}>
              <Coins size={11} className="text-amber-500" aria-hidden="true" /> {t('Dnes můžeš získat ještě {n} z {max} Coinů', { n: stats.room_left, max: stats.daily_cap })}
            </span>
          )}
        </div>
        {!online && <p style={{ color: 'var(--text-muted)' }} className="m-0 text-xs">{t('Online hra potřebuje připojení k internetu.')}</p>}
        {online && needsRealtime && <p style={{ color: 'var(--text-muted)' }} className="m-0 text-xs">{t('Tahle hra potřebuje rychlé kanály, které na serveru zatím nejsou zapnuté.')}</p>}
        {online && !needsRealtime && (
          <>
            <p style={{ color: 'var(--text-muted)' }} className="m-0 text-xs leading-relaxed">{t(def.arena.text)}</p>
            <button type="button" onClick={onArena} data-testid="mp-arena-enter" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="px-4 py-2.5 rounded-xl border-none text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer inline-flex items-center gap-1.5">
              <Users size={14} aria-hidden="true" /> {t('Vstoupit do arény')}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div data-testid="mp-section" style={cardStyle} className="w-full max-w-md border rounded-2xl p-4 text-left space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-xs font-black uppercase tracking-wider flex items-center gap-1.5"><Swords size={14} aria-hidden="true" /> {t('Hrát online')}</h2>
        {stats && stats.daily_cap > 0 && (
          <span data-testid="mp-daily" style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-bold flex items-center gap-1" title={t('Kolik Coinů z online výher dnes ještě můžeš získat')}>
            <Coins size={11} className="text-amber-500" aria-hidden="true" /> {t('Dnes můžeš získat ještě {n} z {max} Coinů', { n: stats.room_left, max: stats.daily_cap })}
          </span>
        )}
      </div>

      {!online && <p style={{ color: 'var(--text-muted)' }} className="m-0 text-xs">{t('Online hra potřebuje připojení k internetu.')}</p>}

      {online && active && phase === 'idle' && (
        <div data-testid="mp-active" role="status" className="border rounded-xl p-3 space-y-2" style={{ borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.10)' }}>
          <p className="m-0 text-xs font-bold">
            {active.game === game.id
              ? t('Máš rozehraný zápas proti hráči {name}.', { name: active.opponent?.name || '?' })
              : t('Máš rozehraný zápas v jiné hře (proti hráči {name}). Nejdřív ho dohraj nebo vzdej.', { name: active.opponent?.name || '?' })}
          </p>
          <div className="flex flex-wrap gap-2">
            {active.game === game.id && (
              <button type="button" onClick={resume} data-testid="mp-resume" style={pill(true)} className="px-3 py-2 rounded-lg border text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer">{t('Pokračovat')}</button>
            )}
            <button type="button" onClick={giveUp} disabled={busy} data-testid="mp-resign" style={pill(false)} className="px-3 py-2 rounded-lg border text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer disabled:opacity-60">{t('Vzdát zápas')}</button>
          </div>
        </div>
      )}

      {online && !active && phase === 'idle' && (
        <>
          {needsRealtime && <p style={{ color: 'var(--text-muted)' }} className="m-0 text-xs">{t('Tahle hra potřebuje rychlé kanály, které na serveru zatím nejsou zapnuté.')}</p>}
          {!needsRealtime && (
            <>
              {def.modes.length > 1 && (
                <div role="group" aria-label={t('Režim')} className="flex flex-wrap gap-1.5">
                  {def.modes.map((m) => (
                    <button key={m.id} type="button" onClick={() => setMode(m.id)} aria-pressed={mode === m.id} data-testid={`mp-mode-${m.id}`} style={pill(mode === m.id)} className="px-3 py-1.5 rounded-lg border text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer">{t(m.title)}</button>
                  ))}
                </div>
              )}
              {modeDef && <p style={{ color: 'var(--text-muted)' }} className="m-0 text-xs leading-relaxed">{t(modeDef.text)}</p>}
              {def.options.map((o) => (
                <div key={o.key} role="group" aria-label={t(o.title)} className="flex flex-wrap items-center gap-1.5">
                  <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider mr-1">{t(o.title)}</span>
                  {o.choices.map((c) => (
                    <button key={c.value} type="button" onClick={() => setParams((p) => ({ ...p, [o.key]: c.value }))} aria-pressed={params[o.key] === c.value} data-testid={`mp-opt-${o.key}-${c.value}`} style={pill(params[o.key] === c.value)} className="px-3 py-1.5 rounded-lg border text-[0.6875rem] font-black cursor-pointer">{c.labelKey ? t(c.labelKey) : c.label}</button>
                  ))}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={startSearch} disabled={busy} data-testid="mp-find" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="px-4 py-2.5 rounded-xl border-none text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60">
                  <Users size={14} aria-hidden="true" /> {t('Najít soupeře')}
                </button>
                <button type="button" onClick={createRoom} disabled={busy} data-testid="mp-room-create" style={pill(false)} className="px-4 py-2.5 rounded-xl border text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60">
                  <KeyRound size={14} aria-hidden="true" /> {t('Hrát s kamarádem')}
                </button>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); if (joinCode.trim()) joinRoom(); }} className="flex items-center gap-2">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  placeholder={t('Kód od kamaráda')}
                  aria-label={t('Kód od kamaráda')}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  data-testid="mp-join-input"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="min-w-0 flex-1 px-3 py-2 border rounded-lg text-sm font-mono tracking-widest outline-none"
                />
                <button type="submit" disabled={busy || joinCode.length < 6} data-testid="mp-join" style={pill(false)} className="px-3 py-2 rounded-lg border text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50">{t('Vstoupit')}</button>
              </form>
            </>
          )}
        </>
      )}

      {phase === 'searching' && (
        <div data-testid="mp-searching" role="status" className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs font-bold"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> {t('Hledám soupeře... {n} s', { n: waited })}{queued > 1 ? ` · ${t('ve frontě: {n}', { n: queued })}` : ''}</span>
          <button type="button" onClick={cancelSearch} data-testid="mp-cancel" style={pill(false)} className="px-3 py-1.5 rounded-lg border text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer inline-flex items-center gap-1"><X size={12} aria-hidden="true" /> {t('Zrušit')}</button>
        </div>
      )}

      {phase === 'room' && (
        <div data-testid="mp-room" role="status" className="space-y-2">
          <p className="m-0 text-xs font-bold">{t('Pošli kamarádovi tenhle kód. Zápas začne, jakmile vstoupí (kód platí 10 minut).')}</p>
          <p data-testid="mp-room-code" className="m-0 text-3xl font-black font-mono tracking-[0.3em]" style={{ color: 'var(--text-badge)' }}>{code}</p>
          <button type="button" onClick={cancelRoom} data-testid="mp-room-cancel" style={pill(false)} className="px-3 py-1.5 rounded-lg border text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer">{t('Zrušit místnost')}</button>
        </div>
      )}

      {error && <p role="alert" data-testid="mp-error" className="m-0 text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{error}</p>}
    </div>
  );
};
