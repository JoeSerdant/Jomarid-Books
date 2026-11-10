import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, WifiOff, Trophy, Frown, Handshake, Ban } from 'lucide-react';
import { GameBar } from '../components/GameBar';
import { t, getLang } from '../i18n';
import { withGameLanguage } from '../i18n/gameLayer';
import { loadGameDictionary } from '../i18n/games';
import { mpApi } from './index.js';
import { MpSession, outcomeFor } from './session.js';
import { attachMpBridge } from './bridge.js';
import { withMultiplayer, initForGame } from './inject.js';
import { reasonText } from './reasons.js';
import { mpErrorText } from './errors.js';

const OFFLINE_AFTER_S = 15; // tolik vteřin ticha od soupeře a ukáže se, že je offline
const GONE_AFTER_S = 25; // a tolik, než se dá zápas ukončit (server to pak sám přijme)

// Celá obrazovka online zápasu: lišta nad hrou, hra v iframu (stejná jako sólová, ale s čistým úložištěm, bez cheatů a s rozhraním window.jomaridMP),
// stavové pásy (offline soupeř, výpadek spojení) a hláška o konci zápasu. O výsledku a Coinech rozhoduje server; tady se jen ukazují.
//   game: položka seznamu her (id, title, load), match: pohled na zápas z mp_find / mp_active, onExit: zpět na stránku hry,
//   onAgain: konec a rovnou hledat dalšího soupeře, onCoins(n): hráč dostal n Coinů (lišta ukáže nový zůstatek)
export const MpGameScreen = ({ game, match, coins, coinsLoaded, reader, gameFx, onExit, onAgain, onCoins }) => {
  const [doc, setDoc] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState(match);
  const [ended, setEnded] = useState(null);
  const [connected, setConnected] = useState(true);
  const [fatal, setFatal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState(null);
  const [, setTick] = useState(0);
  const iframeRef = useRef(null);
  const sessionRef = useRef(null);
  if (!sessionRef.current) sessionRef.current = new MpSession({ api: mpApi, match });
  const session = sessionRef.current;

  // Řadič zápasu: dotazuje server hned, ještě než se hra načte (historie tahů je pak připravená, až ji hra pozná).
  useEffect(() => {
    const offs = [
      session.on('match', setView),
      session.on('end', (v) => setEnded(v)),
      session.on('connection', (c) => setConnected(c.ok)),
      session.on('fatal', () => setFatal(true)),
    ];
    session.start();
    return () => { offs.forEach((off) => off()); session.stop(); };
  }, [session]);

  // Dokument hry: stejná hra jako sólo, ale pro online zápas.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = await game.load();
        const lang = getLang();
        const dict = lang === 'en' ? await loadGameDictionary(game.id) : null;
        if (cancelled) return;
        setDoc(withGameLanguage(withMultiplayer(src, game.id, initForGame(match, session.offset)), lang, dict, { collect: typeof window !== 'undefined' && window.__JOMARID_I18N_COLLECT === true }));
      } catch (err) {
        console.error('Nepodařilo se načíst hru pro online zápas:', err?.message || err);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [game, match, session]);

  // Zápas, jehož výsledek už hra ohlásila (mat, vzdání), se opouští bez dotazu: vzdání by z výhry udělalo prohru.
  const askLeave = useCallback(() => { if (session.ended || session.reported) onExit(); else setConfirm(true); }, [session, onExit]);

  // Most ke hře: žádosti hry (tah, výsledek) jdou na server přes řadič, události zpět do hry.
  useEffect(() => {
    if (!doc) return undefined;
    const bridge = attachMpBridge({ session, getWindow: () => iframeRef.current?.contentWindow || null, onClose: askLeave });
    return () => bridge.dispose();
  }, [doc, session, askLeave]);

  // Ztráta soupeře se počítá z času; překreslení jednou za vteřinu stačí.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Konec zápasu: odměna se ukáže v liště a zůstatek se předá výš.
  const outcome = ended ? outcomeFor(ended) : null;
  const onCoinsRef = useRef(onCoins);
  onCoinsRef.current = onCoins;
  const paidRef = useRef(false);
  useEffect(() => {
    if (!ended || paidRef.current) return undefined;
    paidRef.current = true; // odměna se zůstatku přičte jen jednou, ať se stránka překresluje, jak chce
    const won = ended.my_coins || 0;
    if (won > 0) {
      onCoinsRef.current?.(won);
      setFlash({ id: Date.now(), text: `+${won}`, label: t('Výhra online') });
      const id = setTimeout(() => setFlash(null), 4000);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [ended]);

  const leave = async () => {
    setBusy(true);
    try { await session.resign(); } catch (err) { setNote(mpErrorText(err)); }
    setBusy(false);
    setConfirm(false);
    onExit();
  };

  const act = async (fn) => {
    setBusy(true);
    setNote('');
    try { await fn(); } catch (err) { setNote(mpErrorText(err)); }
    setBusy(false);
  };

  const opp = view.opponent || {};
  const seenAgo = opp.seen_ago || 0;
  const active = !ended && view.status === 'active';
  const oppOffline = active && seenAgo >= OFFLINE_AFTER_S;
  const oppGone = active && seenAgo >= GONE_AFTER_S;
  const notStarted = (view.move_count || 0) === 0;

  const overlayCard = { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
  const btn = (primary) => ({ backgroundColor: primary ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: primary ? 'var(--text-primary)' : 'var(--text-body)', borderColor: 'var(--border-color)' });
  const OutcomeIcon = outcome === 'win' ? Trophy : outcome === 'loss' ? Frown : outcome === 'draw' ? Handshake : Ban;

  return (
    <div data-testid="mp-screen" style={{ position: 'fixed', inset: 0, zIndex: 999, backgroundColor: '#000', '--sat': 'env(safe-area-inset-top,0px)', '--sar': 'env(safe-area-inset-right,0px)' }} className="flex flex-col [@media(orientation:landscape)_and_(max-height:500px)]:flex-row-reverse">
      <GameBar title={`${t(game.title)} · ${t('Online')}`} onClose={askLeave} coins={coins} coinsLoaded={coinsLoaded} level={reader?.level} levelName={reader?.levelName} flash={flash} saveStatus={null} />

      <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
        {(oppOffline || !connected || fatal) && (
          <div data-testid="mp-status" role="status" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="shrink-0 border-b px-3 py-2 text-xs font-bold flex flex-wrap items-center gap-2">
            <WifiOff size={14} aria-hidden="true" className="shrink-0 text-amber-500" />
            {fatal ? <span>{t('Tenhle zápas se nedá dál sledovat.')}</span>
              : !connected ? <span>{t('Spojení se serverem se přerušilo, zkouším ho obnovit...')}</span>
              : <span>{oppGone ? t('Soupeř {name} se odpojil.', { name: opp.name || '' }) : t('Soupeř {name} je offline ({n} s).', { name: opp.name || '', n: seenAgo })}</span>}
            {oppGone && connected && (
              <span className="flex gap-2">
                {notStarted
                  ? <button type="button" disabled={busy} onClick={() => act(() => session.abort())} data-testid="mp-abort" style={btn(false)} className="px-2.5 py-1 rounded-lg border text-[0.625rem] font-black uppercase tracking-wider cursor-pointer disabled:opacity-60">{t('Zrušit zápas')}</button>
                  : <button type="button" disabled={busy} onClick={() => act(() => session.report('win', 'left'))} data-testid="mp-claim" style={btn(false)} className="px-2.5 py-1 rounded-lg border text-[0.625rem] font-black uppercase tracking-wider cursor-pointer disabled:opacity-60">{t('Ukončit jako výhru')}</button>}
              </span>
            )}
            {note && <span role="alert" style={{ color: '#ef4444' }}>{note}</span>}
          </div>
        )}

        {!doc && !loadError && (
          <div className="flex-1 flex items-center justify-center text-sm font-bold" style={{ color: '#e5e7eb' }}><Loader2 size={18} className="animate-spin mr-2" aria-hidden="true" /> {t('Načítám hru...')}</div>
        )}
        {loadError && (
          <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ color: '#e5e7eb' }}>
            <p className="m-0 text-sm font-bold">{t('Hru se nepodařilo načíst. Zkontroluj připojení a zkus to znovu - když to nepomůže, obnov stránku.')}</p>
            <button type="button" onClick={() => act(async () => { await session.resign(); onExit(); })} style={btn(false)} className="px-4 py-2 rounded-lg border text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer">{t('Vzdát zápas a odejít')}</button>
          </div>
        )}
        {doc && (
          <iframe
            ref={iframeRef}
            title={t(game.title)}
            srcDoc={doc}
            allow="clipboard-write"
            data-testid="mp-iframe"
            onLoad={(e) => { try { e.currentTarget.contentWindow?.focus(); } catch { /* okno hry se zaměřit nedá: klávesy začnou platit po kliknutí do hry */ } }}
            style={{ border: 'none', display: 'block', ...(gameFx ? { filter: gameFx } : {}) }}
            className="flex-1 min-h-0 min-w-0 w-full"
          />
        )}

        {ended && (
          <div data-testid="mp-end" role="status" style={overlayCard} className="absolute left-2 right-2 bottom-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-96 border rounded-2xl shadow-xl p-3 flex items-center gap-3 animate-in fade-in duration-300">
            <OutcomeIcon size={28} className={outcome === 'win' ? 'text-amber-500 shrink-0' : 'shrink-0 opacity-70'} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-black">
                {outcome === 'win' ? t('Vyhrál jsi!') : outcome === 'loss' ? t('Prohrál jsi.') : outcome === 'draw' ? t('Remíza.') : t('Zápas se nezapočítal.')}
                {(ended.my_coins || 0) > 0 && <span data-testid="mp-coins" className="ml-2 text-amber-500">{t('+{n} Coinů', { n: ended.my_coins })}</span>}
              </p>
              <p style={{ color: 'var(--text-muted)' }} className="m-0 text-xs">{reasonText(ended.reason)}</p>
              {outcome === 'win' && (ended.my_coins || 0) === 0 && (ended.reward || 0) > 0 && (
                <p data-testid="mp-nocoins" style={{ color: 'var(--text-muted)' }} className="m-0 mt-1 text-[0.6875rem]">{t('Bez Coinů: zápas byl příliš krátký, nebo je dnešní strop z online výher vyčerpaný.')}</p>
              )}
            </div>
            <div className="shrink-0 flex flex-col gap-1.5">
              <button type="button" onClick={onAgain} data-testid="mp-again" style={btn(true)} className="px-3 py-1.5 rounded-lg border-none text-[0.625rem] font-black uppercase tracking-wider cursor-pointer">{t('Hrát znovu')}</button>
              <button type="button" onClick={onExit} data-testid="mp-exit" style={btn(false)} className="px-3 py-1.5 rounded-lg border text-[0.625rem] font-black uppercase tracking-wider cursor-pointer">{t('Zavřít')}</button>
            </div>
          </div>
        )}

        {confirm && !ended && (
          <div role="dialog" aria-modal="true" aria-label={t('Opustit zápas?')} className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-black/60">
            <div style={overlayCard} className="w-full max-w-sm border rounded-2xl shadow-xl p-5 space-y-3">
              <h2 className="m-0 text-sm font-black uppercase tracking-wider">{t('Opustit zápas?')}</h2>
              <p style={{ color: 'var(--text-muted)' }} className="m-0 text-xs leading-relaxed">{t('Když odejdeš, zápas vzdáš a soupeř vyhrává. Za prohru ti nic neubude.')}</p>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setConfirm(false)} disabled={busy} data-testid="mp-stay" style={btn(true)} className="px-4 py-2 rounded-lg border-none text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer disabled:opacity-60">{t('Hrát dál')}</button>
                <button type="button" onClick={leave} disabled={busy} data-testid="mp-leave" style={btn(false)} className="px-4 py-2 rounded-lg border text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer disabled:opacity-60">{busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : t('Vzdát a odejít')}</button>
              </div>
              {note && <p role="alert" className="m-0 text-xs font-bold" style={{ color: '#ef4444' }}>{note}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
