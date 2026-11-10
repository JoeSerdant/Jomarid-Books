import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { GameBar } from '../components/GameBar';
import { t, getLang } from '../i18n';
import { withGameLanguage } from '../i18n/gameLayer';
import { loadGameDictionary } from '../i18n/games';
import { supabase } from '../lib/supabase';
import { mpApi } from './index.js';
import { attachArenaBridge } from './bridge.js';
import { openRealtime } from './realtime.js';
import { withMultiplayer, initForArena } from './inject.js';

export const ARENA_TOPIC = 'mp-arena:polygonarena';

// Obrazovka sdílené arény (Polygon aréna): hra v iframu s čistým úložištěm, bez cheatů, napojená na společný kanál v reálném čase. Žádný zápas ani řadič:
// hráči se potkávají v kanálu, o odměně za vyhrané kolo rozhoduje server (mp_arena_claim). Křížek lištu zavře arénu bez dotazu (nic se nevzdává).
//   game: položka seznamu her, userId: přihlášený účet, onExit: zpět na stránku hry, onCoins(n): hráč dostal n Coinů (lišta ukáže nový zůstatek)
export const MpArenaScreen = ({ game, userId, coins, coinsLoaded, reader, gameFx, onExit, onCoins }) => {
  const [doc, setDoc] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [flash, setFlash] = useState(null);
  const iframeRef = useRef(null);
  const onCoinsRef = useRef(onCoins);
  onCoinsRef.current = onCoins;

  // Dokument hry: stejná hra jako sólo, ale pro sdílenou arénu. Jméno tanku je jméno účtu.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [src, prof] = await Promise.all([
          game.load(),
          supabase.from('profiles').select('username').eq('id', userId).maybeSingle().then((r) => r?.data || null, () => null),
        ]);
        const lang = getLang();
        const dict = lang === 'en' ? await loadGameDictionary(game.id) : null;
        if (cancelled) return;
        const name = String((prof && prof.username) || t('Hráč')).slice(0, 14);
        setDoc(withGameLanguage(withMultiplayer(src, game.id, initForArena({ id: userId, name }, game.id)), lang, dict, { collect: typeof window !== 'undefined' && window.__JOMARID_I18N_COLLECT === true }));
      } catch (err) {
        console.error('Nepodařilo se načíst hru pro sdílenou arénu:', err?.message || err);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [game, userId]);

  // Most ke hře: kanál arény (soukromý, jinak obyčejný) a žádost o odměnu za vyhrané kolo.
  useEffect(() => {
    if (!doc) return undefined;
    const openChannel = (handlers) => openRealtime({ client: supabase, topic: ARENA_TOPIC, key: userId, ...handlers });
    const claim = async (seconds, score) => {
      const res = await mpApi.arenaClaim(seconds, score);
      if (res.error) throw res.error;
      const got = res.data && res.data.granted;
      if (got > 0) {
        onCoinsRef.current?.(got);
        setFlash({ id: Date.now(), text: `+${got}`, label: t('Výhra online') });
        setTimeout(() => setFlash(null), 4000);
      }
      return res.data;
    };
    const bridge = attachArenaBridge({ getWindow: () => iframeRef.current?.contentWindow || null, onClose: onExit, openChannel, claim });
    return () => bridge.dispose();
  }, [doc, userId, onExit]);

  return (
    <div data-testid="mp-screen" style={{ position: 'fixed', inset: 0, zIndex: 999, backgroundColor: '#000', '--sat': 'env(safe-area-inset-top,0px)', '--sar': 'env(safe-area-inset-right,0px)' }} className="flex flex-col [@media(orientation:landscape)_and_(max-height:500px)]:flex-row-reverse">
      <GameBar title={`${t(game.title)} · ${t('Online')}`} onClose={onExit} coins={coins} coinsLoaded={coinsLoaded} level={reader?.level} levelName={reader?.levelName} flash={flash} saveStatus={null} />
      <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
        {!doc && !loadError && (
          <div className="flex-1 flex items-center justify-center text-sm font-bold" style={{ color: '#e5e7eb' }}><Loader2 size={18} className="animate-spin mr-2" aria-hidden="true" /> {t('Načítám hru...')}</div>
        )}
        {loadError && (
          <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ color: '#e5e7eb' }}>
            <p className="m-0 text-sm font-bold">{t('Hru se nepodařilo načíst. Zkontroluj připojení a zkus to znovu - když to nepomůže, obnov stránku.')}</p>
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
      </div>
    </div>
  );
};
