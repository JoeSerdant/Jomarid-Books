import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';
import { plural } from '../lib/plural';
import { Coins, Loader2, Rocket, Swords, Building2, Target, Crown, Smile, Lock, Castle, Folder, FolderOpen } from 'lucide-react';
import { GameBar } from '../components/GameBar';
import { useReaderSnapshot } from '../gameBar/useReaderSnapshot';
import { rewardLabel, REWARD_LIMIT_NOTE } from '../gameBar/rewardLabels';
import { normalizeRecord } from '../gameRecords/catalog';
import { reportGameRecord } from '../gameRecords/api';
import { useGameFilter } from '../shop/useGameFilter';
import { createGameSync } from '../gameSave/sync';
import { withStorageShim } from '../gameSave/shim';
import { saveGameStateKeepalive } from '../gameSave/api';
import { readLegacyStorage, clearLegacyStorage } from '../gameSave/legacy';
import { SAVE_MESSAGES, SAVE_LOAD_ERROR } from '../gameSave/messages';

// Každá hra je velký kus textu (stovky kB, šachy i s Reactem). Stahuje se až při spuštění (dynamický import), ne spolu
// se stránkou Her - jinak by si hráč už při otevření seznamu stáhl všechny hry najednou.
const GAMES = [
  {
    id: 'rocket',
    title: 'Jomarid Rocket Game',
    tagline: 'Vesmírná arkádová střílečka s vlastními vylepšeními a postupem.',
    icon: Rocket,
    load: () => import('../gameContent/rocketGame').then(m => m.ROCKET_GAME_HTML),
  },
  {
    id: 'warroom',
    title: 'Warroom: Frontlines',
    tagline: 'Velitelská taktická hra - řiď frontu, jednotky a zdroje ve velitelském stanu.',
    icon: Swords,
    folder: 'strategy',
    load: () => import('../gameContent/warroom').then(m => m.WARROOM_HTML),
  },
  {
    id: 'hannibal',
    title: 'Hannibal: Barca',
    tagline: 'Taktická kampaň druhé punské války - vedeš Hannibala od Sagunta až k Zamě, v bitvách na čtvercové síti, minihrách i nekonečném tažení.',
    icon: Castle,
    folder: 'strategy',
    load: () => import('../gameContent/hannibalGame').then(m => m.HANNIBAL_HTML),
  },
  {
    id: 'cityclicker',
    title: 'City Clicker',
    tagline: 'Vybuduj si vlastní město klikáním - se čtyřmi zcela odlišnými vizuálními styly na výběr.',
    icon: Building2,
    load: () => import('../gameContent/cityClicker').then(m => m.CITY_CLICKER_HTML),
  },
  {
    id: 'polygonarena',
    title: 'Polygon aréna',
    tagline: 'Rozstřílej tvary, poskládej si stavbu z více než 500 tanků a přežij mezi chytrými boty - osm režimů od vln nepřátel po zužující se bouři a obtížnost až do Pekla.',
    icon: Target,
    load: () => import('../gameContent/polygonArena').then(m => m.POLYGON_ARENA_HTML),
  },
  {
    id: 'chess',
    title: 'Chess League',
    tagline: 'Šachy proti pěti botům s vlastní osobností - skutečný Elo rating, hodiny, nápověda a rozbor partie.',
    icon: Crown,
    load: () => import('../gameContent/chess').then(m => m.CHESS_HTML),
  },
  {
    id: 'koulovikamosi',
    title: 'Kouloví Kámoši',
    tagline: 'Pouštěj do misky měkké koule, spojuj stejné a vypěstuj tu největší - pět režimů od klasiky po chaos, obchod s vylepšeními a vlastní rekordy.',
    icon: Smile,
    load: () => import('../gameContent/koulovi').then(m => m.KOULOVI_HTML),
  },
  // Další hra se přidá jako další objekt v tomhle poli.
];

// Složky v seznamu her: hra s `folder: 'klíč'` se v seznamu neukazuje sama, ale uvnitř složky (karta složky otevře seznam her pod mřížkou).
const FOLDERS = [
  { key: 'strategy', title: 'Strategie', tagline: 'Taktické hry: veď armády, frontu a zdroje.' },
];

// Kolik milisekund musí být hra otevřená, než se hráči vůbec odemkne
// tlačítko na vyzvednutí denní odměny. Nejde o přísný anti-cheat, jen
// o to, aby prosté otevření a hned zavření hry samo o sobě nestačilo -
// beze zbytku to reálně hraní nenahradí, ale zavírá tu nejočividnější
// díru (nárok bez jediné vteřiny hraní).
const MIN_PLAY_MS = 15000;

// Přesně stejný tvar řetězce, jaký si server sám skládá uvnitř
// claim_game_bonus() pro source_type - viz 'game_bonus:' || game_id || ':' || today.
// Datum musí být UTC (server počítá (now() at time zone 'utc')::date), ne
// místní čas prohlížeče - jinak by kontrola kolem půlnoci mohla ukázat
// špatný den.
function gameBonusSourceType(gameId) {
  const todayUtc = new Date().toISOString().slice(0, 10);
  return `game_bonus:${gameId}:${todayUtc}`;
}

export const GameLauncher = ({ game }) => {
  const { user } = useAuth();
  const [coins, setCoins] = useState(0);
  const [coinsLoaded, setCoinsLoaded] = useState(false); // zůstatek z účtu už je načtený (do té doby ho hře neposíláme, ať neukáže nulu)
  const [claiming, setClaiming] = useState(false);
  const [claimedToday, setClaimedToday] = useState(false);
  const [claimedAmount, setClaimedAmount] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [showGame, setShowGame] = useState(false);
  const [hasPlayedEnough, setHasPlayedEnough] = useState(false);
  const [html, setHtml] = useState(null); // text hry; do stažení je null
  const [gameDoc, setGameDoc] = useState(null); // text hry s vloženým úložištěm a uloženým postupem; to, co běží v iframu
  const [saveLoadError, setSaveLoadError] = useState(false); // uložený postup se nepodařilo načíst, hra se nespustila
  const [saveStatus, setSaveStatus] = useState(null); // 'failing' | 'conflict' | 'rejected': postup se právě neukládá
  const [loadingGame, setLoadingGame] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const gameOpenedAtRef = useRef(null);
  const [flash, setFlash] = useState(null); // krátké potvrzení odměny v liště nad hrou
  const iframeRef = useRef(null);
  const mountedRef = useRef(true);
  const flashTimerRef = useRef(null);
  const syncRef = useRef(null); // synchronizace postupu této hry se serverem
  const tokenRef = useRef(null); // přihlašovací token pro uložení při zavírání stránky (tam se na nové načtení čekat nedá)
  const limitShownRef = useRef(false);
  const reader = useReaderSnapshot(user?.id);
  const gameFx = useGameFilter(user?.id); // vzhled her z obchůdku

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearTimeout(flashTimerRef.current); };
  }, []);

  // Potvrzení odměny (nebo poznámka o limitu) se ukazuje jen v liště appky nad hrou, hry samy nic nezobrazují.
  const showFlash = useCallback((next, ms = 2800) => {
    if (!mountedRef.current) return;
    clearTimeout(flashTimerRef.current);
    setFlash({ id: Date.now() + Math.random(), ...next });
    flashTimerRef.current = setTimeout(() => { if (mountedRef.current) setFlash(null); }, ms);
  }, []);

  // Postup hry žije na serveru (db/game-saves.sql). Hra si pořád "ukládá do localStorage", ale ten jí appka nahradí pamětí (gameSave/shim.js)
  // a změny posílá sem; o chybách ukládání se hráč dozví v liště nad hrou.
  const handleSaveStatus = useCallback(({ state, recovered }) => {
    if (state === 'failing') { setSaveStatus('failing'); showFlash({ text: SAVE_MESSAGES.failing, warn: true }, 4000); }
    else if (state === 'ok' && recovered) { setSaveStatus(null); showFlash({ text: SAVE_MESSAGES.recovered, warn: true }); }
    else if (state === 'conflict') { setSaveStatus('conflict'); showFlash({ text: SAVE_MESSAGES.conflict, warn: true }, 9000); }
    else if (state === 'rejected') { setSaveStatus('rejected'); showFlash({ text: SAVE_MESSAGES.rejected, warn: true }, 6000); }
  }, [showFlash]);

  const getSync = useCallback(() => {
    if (!syncRef.current) {
      syncRef.current = createGameSync({
        client: supabase,
        gameId: game.id,
        readLegacy: readLegacyStorage,
        clearLegacy: clearLegacyStorage,
        keepalive: (args) => saveGameStateKeepalive({ url: supabaseUrl, apiKey: supabaseKey, token: tokenRef.current, ...args }),
        onStatus: handleSaveStatus,
      });
    }
    return syncRef.current;
  }, [game.id, handleSaveStatus]);

  // Token pro uložení při zavírání stránky: obyčejné načtení tokenu je asynchronní, tam už by se nestihlo.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => { if (!cancelled) tokenRef.current = data?.session?.access_token || null; });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => { tokenRef.current = session?.access_token || null; });
    return () => { cancelled = true; sub?.subscription?.unsubscribe(); };
  }, []);

  // Hra, která se v iframu sama znovu načte (třeba restart ve Warroomu), si aktuální postup bere přímo odsud (gameSave/shim.js), ne z kopie
  // vložené při otevření: ta by byla zastaralá a hra by se vrátila o krok zpět.
  useEffect(() => {
    const store = { read: (gameId) => (gameId === game.id && syncRef.current ? syncRef.current.snapshot().map : null) };
    window.__jomaridGameSave = store;
    return () => { if (window.__jomaridGameSave === store) delete window.__jomaridGameSave; };
  }, [game.id]);

  // Dohnat neuložené změny při skrytí stránky (přepnutí karty nebo aplikace), při odchodu ze stránky a při opuštění hry v appce.
  useEffect(() => {
    const onHide = () => syncRef.current?.flushOnHide();
    const onVisibility = () => { if (document.visibilityState === 'hidden') syncRef.current?.flush(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      const sync = syncRef.current;
      syncRef.current = null;
      if (sync) sync.flush().finally(() => sync.dispose());
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('coins').eq('id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw error;
        if (data) { setCoins(data.coins || 0); setCoinsLoaded(true); }
      })
      .catch((err) => console.error('Nepodařilo se načíst zůstatek mincí:', err.message));
  }, [user]);

  // Zjistí SKUTEČNÝ stav rovnou ze serveru (přes stejný source_type klíč,
  // co si používá claim_game_bonus interně), místo aby appka po refreshi
  // vždycky naivně předpokládala "ještě nevyzvednuto". Bez tohohle si po
  // obnovení stránky tlačítko myslelo, že nárok pořád čeká, i když ho
  // uživatel už dávno vybral - RPC by druhé kliknutí sice správně odmítlo
  // (žádná dvojitá odměna), ale tlačítko by do tý doby lhalo o stavu.
  useEffect(() => {
    if (!user || !game) return;
    let cancelled = false;
    setCheckingStatus(true);
    supabase
      .from('coin_transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('source_type', gameBonusSourceType(game.id))
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) throw error;
        if (data) {
          setClaimedToday(true);
          setClaimedAmount(data.amount);
        }
      })
      .catch((err) => console.error('Nepodařilo se ověřit stav dnešní odměny:', err.message))
      .finally(() => { if (!cancelled) setCheckingStatus(false); });
    return () => { cancelled = true; };
  }, [user, game]);

  // Hra se stáhne až teď (poprvé), další otevření je okamžité. Čas hraní se počítá až od chvíle, kdy se hra zobrazí.
  const handleOpenGame = useCallback(async () => {
    if (loadingGame) return;
    setLoadError(false);
    setSaveLoadError(false);
    setLoadingGame(true);
    let src = html;
    if (!src) {
      try {
        src = await game.load();
      } catch (err) {
        console.error('Nepodařilo se načíst hru:', err?.message || err);
        if (mountedRef.current) { setLoadError(true); setLoadingGame(false); }
        return;
      }
      if (!mountedRef.current) return;
      setHtml(src);
    }
    // Uložený postup ze serveru (a při prvním spuštění po přesunu jednorázový přenos starého z prohlížeče). Když se nenačte, hra se
    // nespustí: kdyby běžela naprázdno, mohla by uložený postup přepsat. Už načtený postup se znovu nenačítá (v paměti jsou i změny,
    // které se ještě neodeslaly); jen po konfliktu (hrálo se jinde) se načte znovu.
    const sync = getSync();
    try {
      if (!sync.isLoaded() || sync.state().stopped) await sync.load();
    } catch (err) {
      console.error('Nepodařilo se načíst uložený postup hry:', err?.message || err);
      if (mountedRef.current) { setSaveLoadError(true); setLoadingGame(false); }
      return;
    }
    if (!mountedRef.current) return;
    const { status } = sync.state(); // znovu otevřená hra ukáže štítek i tehdy, když se postup pořád neukládá
    setSaveStatus(status === 'ok' ? null : status);
    setGameDoc(withStorageShim(src, game.id, sync.snapshot().map));
    setLoadingGame(false);
    gameOpenedAtRef.current = Date.now();
    limitShownRef.current = false;
    setShowGame(true);
  }, [game, html, loadingGame, getSync]);

  // Při najetí myší nebo zaostření se hra stáhne dopředu, takže se po kliknutí obvykle otevře hned.
  const warmUp = useCallback(() => { game.load().catch(() => {}); }, [game]);

  const handleCloseGame = useCallback(() => {
    if (gameOpenedAtRef.current && Date.now() - gameOpenedAtRef.current >= MIN_PLAY_MS) {
      setHasPlayedEnough(true);
    }
    gameOpenedAtRef.current = null;
    setShowGame(false);
    syncRef.current?.flush(); // postup se uloží hned, ne až po odkladu
  }, []);

  // Hry uvnitř iframu posílají postMessage místo skutečné navigace na "/app" -
  // díky tomu tlačítko "Zpět" ve hře nikdy nezpůsobí opravdový přechod na
  // serveru (a tedy ani riziko 404, kdyby hostingu chyběl SPA rewrite).
  // event.source se navíc ověřuje proti konkrétnímu iframu týhle hry, aby
  // zprávu nemohlo spustit nic jiného, co náhodou pošle stejně tvarovanou
  // zprávu odjinud.
  //
  // 'record' je HLÁŠENÍ rekordu (nejlepší skóre, nejvyšší úroveň...). Appka ho jen předá serveru (report_game_record), ten si nejvyšší
  // hodnotu pamatuje u účtu a odemyká herní odznaky; nový odznak se potvrdí v liště nad hrou. Neznámá statistika a hodnota mimo meze se zahodí.
  //
  // 'coin' je ŽÁDOST o odměnu za herní událost (zlaté kliknutí, sklad zásob,
  // krystal, výhra v šachách...) - hra sama Jomarid Coins NIKDY neuděluje,
  // jen POŽÁDÁ; o skutečné částce (a denním stropu) rozhoduje výhradně server
  // přes award_game_coins(). Skutečně připsanou částku (ne tu, o kterou jen
  // požádala) ukáže lišta nad hrou; hra samotná žádné potvrzení nezobrazuje.
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.source !== 'jomarid-game') return;
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;

      if (event.data?.type === 'close') {
        handleCloseGame();
      } else if (event.data?.type === 'storage') {
        // Změna "localStorage" ve hře (viz gameSave/shim.js): drží se v paměti a posílá se na server s odkladem.
        syncRef.current?.apply(event.data);
      } else if (event.data?.type === 'record' && user) {
        const rec = normalizeRecord(game.id, event.data.stat, event.data.value);
        if (!rec) return;
        reportGameRecord(supabase, rec.game, rec.stat, rec.value).then((res) => {
          if (res?.unlocked?.length) showFlash({ text: `+${res.xp} XP`, label: `Odznak: ${res.unlocked.map((b) => b.title).join(', ')}` });
        });
      } else if (event.data?.type === 'coin' && user) {
        const amount = Math.floor(Number(event.data.amount));
        if (!Number.isFinite(amount) || amount < 1) return;
        const reason = String(event.data.reason || 'event').slice(0, 30);
        supabase.rpc('award_game_coins', { p_game_id: game.id, p_amount: amount, p_reason: reason })
          .then(({ data, error }) => {
            if (error) { console.error('Chyba při udílení herní odměny:', error.message); return; }
            if (data?.granted) { setCoins(data.balance ?? 0); setCoinsLoaded(true); } // zůstatek z odpovědi serveru platí i tehdy, když se úvodní načtení nepovedlo
            if (data?.granted > 0) showFlash({ text: `+${data.granted}`, label: rewardLabel(reason) });
            else if (data?.capped && !limitShownRef.current) { limitShownRef.current = true; showFlash({ text: REWARD_LIMIT_NOTE, warn: true }); }
          })
          .catch((err) => console.error('Chyba při udílení herní odměny:', err.message));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleCloseGame, user, game.id, showFlash]);

  const canClaim = hasPlayedEnough && !checkingStatus && !claimedToday;

  const handleClaimBonus = async () => {
    if (!user || claiming || !canClaim) return;
    setClaiming(true);
    try {
      const { data, error } = await supabase.rpc('claim_game_bonus', { game_id: game.id });
      if (error) throw error;
      if (data?.granted) {
        setClaimedAmount(data.amount);
        setClaimedToday(true);
        setCoins(prev => prev + (data.amount || 0));
      } else {
        setClaimedToday(true);
      }
    } catch (err) {
      console.error('Odměna za hraní:', err);
      alert(friendlyError(err, 'Odměnu se nepodařilo vyzvednout. Zkus to znovu.'));
    } finally {
      setClaiming(false);
    }
  };

  // Hra běží v izolovaném iframu (srcDoc) přímo nad zbytkem appky - žádná
  // navigace pryč z SPA, žádný samostatný soubor ani public/ složka. Herní
  // vlastní CSS reset a stovky document.getElementById volání tak nemůžou
  // nijak zasáhnout do zbytku Reactu (a naopak).
  if (showGame) {
    // Křížek je v samostatném pruhu mimo hru, ne přes iframe, aby nezakrýval ovládací prvky her (např. pauzu v Rocket Game).
    // Pruh je nahoře; na nízké obrazovce na šířku (telefon) je vpravo, ať se hře
    // neubírá výška. Hra se v iframu přizpůsobí zbylé ploše, takže to platí pro všechny hry, i budoucí.
    // Třídy jsou napsané celé (ne skládané): Tailwind je při sestavení hledá v textu a sestavené by nepoznal.
    return (
      // Výřez displeje (--sat nahoře, --sar vpravo) se přičítá k velikosti pruhu, ne odebírá z místa pro tlačítko.
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, backgroundColor: '#000', '--sat': 'env(safe-area-inset-top,0px)', '--sar': 'env(safe-area-inset-right,0px)' }} className="flex flex-col [@media(orientation:landscape)_and_(max-height:500px)]:flex-row-reverse">
        <GameBar title={game.title} onClose={handleCloseGame} coins={coins} coinsLoaded={coinsLoaded} level={reader?.level} levelName={reader?.levelName} flash={flash} saveStatus={saveStatus} />
        <iframe
          ref={iframeRef}
          title={game.title}
          srcDoc={gameDoc}
          allow="clipboard-write"
          style={{ border: 'none', display: 'block', ...(gameFx ? { filter: gameFx } : {}) }}
          className="flex-1 min-h-0 min-w-0 w-full"
        />
      </div>
    );
  }

  const GameIcon = game.icon;

  return (
    <div className="max-w-4xl mx-auto px-4 py-16 text-center animate-in fade-in duration-300">
      <Link to={game.folder ? `/games?slozka=${game.folder}` : '/games'} className="text-[0.625rem] font-black uppercase tracking-wider no-underline opacity-50 hover:opacity-100 transition-all inline-flex items-center gap-1 mb-6" style={{ color: 'var(--text-body)' }}>
        ← {game.folder ? `Složka ${FOLDERS.find(f => f.key === game.folder)?.title || 'her'}` : 'Všechny hry'}
      </Link>
      <div 
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} 
        className="border rounded-2xl p-8 md:p-12 shadow-lg flex flex-col items-center justify-center gap-6"
      >
        <div className="w-20 h-20 bg-purple-500/10 text-purple-500 rounded-full flex items-center justify-center animate-bounce">
          <GameIcon size={40} />
        </div>
        
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tight mb-2" style={{ color: 'var(--text-body)' }}>
            {game.title}
          </h1>
          <p style={{ color: 'var(--text-muted)' }} className="text-sm max-w-md mx-auto">
            {game.tagline} Otevře se rovnou tady na celou obrazovku.
          </p>
        </div>

        <button
          onClick={handleOpenGame}
          onPointerEnter={warmUp}
          onFocus={warmUp}
          aria-disabled={loadingGame}
          aria-busy={loadingGame}
          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          className="px-8 py-3.5 rounded-xl font-black uppercase tracking-wider text-sm border-none cursor-pointer shadow-lg hover:opacity-90 transition-all flex items-center gap-2 aria-disabled:cursor-wait aria-disabled:opacity-70"
        >
          {loadingGame ? <><Loader2 size={16} className="animate-spin" /> Načítám hru...</> : <><GameIcon size={16} /> Spustit hru</>}
        </button>
        {saveLoadError && (
          <div role="alert" data-testid="save-load-error" className="-mt-3 flex flex-col items-center gap-2">
            <p style={{ color: 'var(--text-body)', borderColor: '#ef4444' }} className="text-xs m-0 border-l-2 pl-2 text-left max-w-sm">
              {SAVE_LOAD_ERROR}
            </p>
            <button
              onClick={handleOpenGame}
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
              className="px-4 py-2 rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer border"
            >
              Zkusit znovu
            </button>
          </div>
        )}
        {loadError && (
          // Prohlížeč si neúspěšné načtení souboru pamatuje, takže opakované kliknutí často nepomůže (stejně jako po vydání nové
          // verze aplikace, kdy staré soubory už neexistují). Spolehlivě pomůže až obnovení stránky.
          <div role="alert" className="-mt-3 flex flex-col items-center gap-2">
            <p style={{ color: 'var(--text-body)', borderColor: '#ef4444' }} className="text-xs m-0 border-l-2 pl-2 text-left max-w-sm">
              Hru se nepodařilo načíst. Zkontroluj připojení a zkus to znovu - když to nepomůže, obnov stránku.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
              className="px-4 py-2 rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer border"
            >
              Obnovit stránku
            </button>
          </div>
        )}

        <div style={{ borderColor: 'var(--border-color)' }} className="w-full border-t pt-6 flex flex-col items-center gap-3">
          <p style={{ color: 'var(--text-muted)' }} className="text-xs max-w-sm mx-auto opacity-80">
            Postup ve hře (vylepšení, nastavení, rozehraná partie), rekordy i herní odznaky se ukládají k tvému účtu, takže je máš na všech zařízeních stejné (rekordy a odznaky najdeš na stránce Odznaky, záložka Odznaky her). Za to, že si dnes zahraješ, dostaneš i pár skutečných Jomarid Coinů - jednou denně.
          </p>
          <button
            onClick={handleClaimBonus}
            disabled={claiming || checkingStatus || !canClaim}
            style={{
              backgroundColor: claimedToday ? 'var(--bg-secondary)' : canClaim ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-secondary)',
              color: claimedToday ? 'var(--text-muted)' : canClaim ? '#f59e0b' : 'var(--text-muted)',
            }}
            className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer border-none shadow-sm disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {checkingStatus ? (
              <Loader2 size={14} className="animate-spin" />
            ) : claiming ? (
              <Loader2 size={14} className="animate-spin" />
            ) : claimedToday ? (
              <>Dnešní odměna vyzvednuta {claimedAmount ? `(+${claimedAmount})` : ''} <Coins size={12} /></>
            ) : !hasPlayedEnough ? (
              <>Nejdřív si zahraj <Lock size={12} /></>
            ) : (
              <>Vyzvednout dnešní odměnu za hraní <Coins size={12} /></>
            )}
          </button>
          {!claimedToday && !checkingStatus && !hasPlayedEnough && (
            <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] opacity-60">
              Odměna se odemkne po chvilce hraní - zkus to po zavření hry znovu.
            </span>
          )}
          <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] opacity-60 flex items-center gap-1">
            <Coins size={11} /> Aktuální zůstatek: {coins} Jomarid Coins
          </span>
        </div>
      </div>
    </div>
  );
};


// Karta hry v seznamu (samostatná i uvnitř složky).
const GameCard = ({ game }) => {
  const GameIcon = game.icon;
  return (
    <Link
      to={`/games/${game.id}`}
      data-testid={`game-link-${game.id}`}
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
      className="border rounded-2xl p-3 sm:p-6 flex flex-col items-center text-center gap-2 sm:gap-3 no-underline hover:shadow-lg transition-all"
    >
      <div className="w-12 h-12 sm:w-16 sm:h-16 bg-purple-500/10 text-purple-500 rounded-full flex items-center justify-center">
        <GameIcon className="w-6 h-6 sm:w-[30px] sm:h-[30px]" />
      </div>
      <h3 className="font-black uppercase text-xs sm:text-sm tracking-tight m-0" style={{ color: 'var(--text-body)' }}>{game.title}</h3>
      <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] sm:text-xs m-0 line-clamp-3 sm:line-clamp-none">{game.tagline}</p>
    </Link>
  );
};

export const GamesHub = () => {
  // Otevřená složka je v adrese (?slozka=strategy), ať se po návratu ze hry zase ukáže otevřená.
  const [params, setParams] = useSearchParams();
  const openKey = FOLDERS.some(f => f.key === params.get('slozka')) ? params.get('slozka') : null;
  const toggleFolder = (key) => setParams(openKey === key ? {} : { slozka: key }, { replace: true });
  const loose = GAMES.filter(g => !g.folder);
  const openFolder = FOLDERS.find(f => f.key === openKey);
  const openGames = openFolder ? GAMES.filter(g => g.folder === openFolder.key) : [];
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 sm:py-16 animate-in fade-in duration-300">
      <div className="text-center mb-6 sm:mb-10">
        <h1 className="text-3xl font-black uppercase tracking-tight mb-2" style={{ color: 'var(--text-body)' }}>Mini-hry 🎮</h1>
        <p style={{ color: 'var(--text-muted)' }} className="text-sm">Krátká odbočka od čtení - a pár Jomarid Coinů navrch za to, že si dnes zahraješ.</p>
      </div>
      {/* Na telefonu dva sloupce s kompaktními kartami (pět her pod sebou zabíralo přes 1000 px). */}
      <div className="grid grid-cols-2 gap-3 sm:gap-6">
        {loose.map(game => <GameCard key={game.id} game={game} />)}
        {FOLDERS.map(folder => {
          const inside = GAMES.filter(g => g.folder === folder.key);
          if (inside.length === 0) return null;
          const open = folder.key === openKey;
          const FolderIcon = open ? FolderOpen : Folder;
          return (
            <button
              key={folder.key}
              type="button"
              onClick={() => toggleFolder(folder.key)}
              aria-expanded={open}
              aria-controls={`folder-${folder.key}`}
              data-testid={`folder-${folder.key}`}
              style={{ backgroundColor: open ? 'var(--bg-badge)' : 'var(--bg-card)', borderColor: open ? 'var(--bg-primary)' : 'var(--border-color)' }}
              className="border rounded-2xl p-3 sm:p-6 flex flex-col items-center text-center gap-2 sm:gap-3 cursor-pointer hover:shadow-lg transition-all"
            >
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-amber-500/10 text-amber-500 rounded-full flex items-center justify-center">
                <FolderIcon className="w-6 h-6 sm:w-[30px] sm:h-[30px]" />
              </div>
              <h3 className="font-black uppercase text-xs sm:text-sm tracking-tight m-0" style={{ color: 'var(--text-body)' }}>{folder.title}</h3>
              <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] sm:text-xs m-0">{folder.tagline}</p>
              <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider flex items-center gap-1.5">
                {inside.map(g => { const I = g.icon; return <I key={g.id} size={12} aria-hidden="true" />; })}
                {inside.length} {plural(inside.length, 'hra', 'hry', 'her')}
              </span>
            </button>
          );
        })}
      </div>
      {openFolder && (
        <div id={`folder-${openFolder.key}`} data-testid={`folder-games-${openFolder.key}`} role="region" aria-label={`Složka ${openFolder.title}`} className="mt-6 sm:mt-10">
          <h2 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider text-center mb-3 sm:mb-4 flex items-center justify-center gap-1.5">
            <FolderOpen size={14} aria-hidden="true" /> {openFolder.title}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-6">
            {openGames.map(game => <GameCard key={game.id} game={game} />)}
          </div>
        </div>
      )}
    </div>
  );
};

export const GamePage = () => {
  const { gameId } = useParams();
  const game = GAMES.find(g => g.id === gameId);
  if (!game) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <p style={{ color: 'var(--text-muted)' }} className="text-sm mb-4">Tahle hra neexistuje.</p>
        <Link to="/games" style={{ color: 'var(--text-badge)' }} className="text-xs font-black uppercase">← Zpět na hry</Link>
      </div>
    );
  }
  return <GameLauncher key={game.id} game={game} />;
};
