import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';
import { Coins, Loader2, Rocket, Swords, Building2, Target, Crown, Smile, Lock, Castle, Folder, FolderOpen } from 'lucide-react';
import { GameBar } from '../components/GameBar';
import { useReaderSnapshot } from '../gameBar/useReaderSnapshot';
import { rewardLabel, REWARD_LIMIT_NOTE } from '../gameBar/rewardLabels';
import { normalizeRecord } from '../gameRecords/catalog';
import { reportGameRecord } from '../gameRecords/api';
import { gameSaves, activeGames, outbox } from '../offline/index.js';
import { reconcileGameSave } from '../offline/gameMerge';
import { requestCoins, queueRecord } from '../offline/gameQueue';
import { useOnline } from '../offline/useOnline';
import { useGameFilter } from '../shop/useGameFilter';
import { createGameSync, NoLocalSaveError } from '../gameSave/sync';
import { withStorageShim } from '../gameSave/shim';
import { saveGameStateKeepalive } from '../gameSave/api';
import { readLegacyStorage, clearLegacyStorage } from '../gameSave/legacy';
import { SAVE_MESSAGES, SAVE_LOAD_ERROR, SAVE_NO_LOCAL_COPY, SAVE_PLAY_FRESH } from '../gameSave/messages';
import { t, getLang } from '../i18n';
import { tk } from '../i18n/mark.js';
import { withGameLanguage } from '../i18n/gameLayer';
import { loadGameDictionary } from '../i18n/games';
import { MpResume, useMpAvailability } from '../mp/MpSection.jsx';
import { MpLobbyDialog } from '../mp/MpLobbyDialog.jsx';
import { withOnlineEntry, onlineMessage } from '../mp/entry.js';
import { MpGameScreen } from '../mp/MpGameScreen.jsx';
import { MpArenaScreen } from '../mp/MpArenaScreen.jsx';

// Každá hra je velký kus textu (stovky kB, šachy i s Reactem). Stahuje se až při spuštění (dynamický import), ne spolu
// se stránkou Her - jinak by si hráč už při otevření seznamu stáhl všechny hry najednou.
const GAMES = [
  {
    id: 'rocket',
    title: tk('Jomarid Rocket Game'),
    tagline: tk('Vesmírná arkádová střílečka s vlastními vylepšeními a postupem.'),
    icon: Rocket,
    load: () => import('../gameContent/rocketGame').then(m => m.ROCKET_GAME_HTML),
  },
  {
    id: 'warroom',
    title: tk('Warroom: Frontlines'),
    tagline: tk('Velitelská taktická hra - řiď frontu, jednotky a zdroje ve velitelském stanu.'),
    icon: Swords,
    folder: 'strategy',
    load: () => import('../gameContent/warroom').then(m => m.WARROOM_HTML),
  },
  {
    id: 'hannibal',
    title: tk('Hannibal: Barca'),
    tagline: tk('Taktická kampaň druhé punské války - vedeš Hannibala od Sagunta až k Zamě, v bitvách na čtvercové síti, minihrách i nekonečném tažení.'),
    icon: Castle,
    folder: 'strategy',
    load: () => import('../gameContent/hannibalGame').then(m => m.HANNIBAL_HTML),
  },
  {
    id: 'cityclicker',
    title: tk('City Clicker'),
    tagline: tk('Vybuduj si vlastní město klikáním - se čtyřmi zcela odlišnými vizuálními styly na výběr.'),
    icon: Building2,
    load: () => import('../gameContent/cityClicker').then(m => m.CITY_CLICKER_HTML),
  },
  {
    id: 'polygonarena',
    title: tk('Polygon aréna'),
    tagline: tk('Rozstřílej tvary, poskládej si stavbu z více než 500 tanků a přežij mezi chytrými boty - osm režimů od vln nepřátel po zužující se bouři a obtížnost až do Pekla.'),
    icon: Target,
    load: () => import('../gameContent/polygonArena').then(m => m.POLYGON_ARENA_HTML),
  },
  {
    id: 'chess',
    title: tk('Chess League'),
    tagline: tk('Šachy proti pěti botům s vlastní osobností - skutečný Elo rating, hodiny, nápověda, rozbor partie a šachové úlohy na hledání matu.'),
    icon: Crown,
    load: () => import('../gameContent/chess').then(m => m.CHESS_HTML),
  },
  {
    id: 'koulovikamosi',
    title: tk('Kouloví Kámoši'),
    tagline: tk('Pouštěj do misky měkké koule, spojuj stejné a vypěstuj tu největší - pět režimů od klasiky po chaos, obchod s vylepšeními a vlastní rekordy.'),
    icon: Smile,
    load: () => import('../gameContent/koulovi').then(m => m.KOULOVI_HTML),
  },
  // Další hra se přidá jako další objekt v tomhle poli.
];

// Stáhne všechny hry dopředu, ať jdou hrát bez internetu (service worker si soubory uloží při stažení). Volá se z Nastavení → Offline.
// Vrací { total, failed: [id her, které se nepodařilo stáhnout] }.
export async function preloadGames(onProgress = () => {}) {
  const failed = [];
  let done = 0;
  for (const game of GAMES) {
    try { await game.load(); } catch { failed.push(game.id); }
    done += 1;
    onProgress(done, GAMES.length);
  }
  return { total: GAMES.length, failed };
}

// Složky v seznamu her: hra s `folder: 'klíč'` se v seznamu neukazuje sama, ale uvnitř složky (karta složky otevře seznam her pod mřížkou).
const FOLDERS = [
  { key: 'strategy', title: tk('Strategie'), tagline: tk('Taktické hry: veď armády, frontu a zdroje.') },
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
  const online = useOnline();
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
  const [saveLoadError, setSaveLoadError] = useState(false); // uložený postup se nepodařilo načíst, hra se nespustila (true), nebo je offline a nemá v zařízení kopii ('nocopy')
  const [saveStatus, setSaveStatus] = useState(null); // 'failing' | 'conflict' | 'rejected': postup se právě neukládá
  const [loadingGame, setLoadingGame] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [mpMatch, setMpMatch] = useState(null); // rozehraný online zápas (pohled serveru), nebo null
  const [mpAuto, setMpAuto] = useState(null); // volby posledního zápasu: po „Hrát znovu“ se hledá soupeř rovnou
  const [mpArena, setMpArena] = useState(false); // hráč je ve sdílené aréně (Polygon aréna)
  const [mpLobby, setMpLobby] = useState(false); // okno Hrát online je otevřené (z tlačítka v menu hry, nebo po „Hrát znovu“)
  const mpAvail = useMpAvailability(game.id, online); // je na serveru multiplayer a má tahle hra online režim
  const mpAvailRef = useRef(mpAvail);
  mpAvailRef.current = mpAvail;
  const gameOpenedAtRef = useRef(null);
  const [flash, setFlash] = useState(null); // krátké potvrzení odměny v liště nad hrou
  const iframeRef = useRef(null);
  const mountedRef = useRef(true);
  const flashTimerRef = useRef(null);
  const syncRef = useRef(null); // synchronizace postupu této hry se serverem
  const tokenRef = useRef(null); // přihlašovací token pro uložení při zavírání stránky (tam se na nové načtení čekat nedá)
  const limitShownRef = useRef(false);
  const queuedShownRef = useRef(false); // poznámka „odměna čeká na připojení“ se ukáže jednou za otevření hry
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
  const handleSaveStatus = useCallback(({ state, recovered, reason }) => {
    if (state === 'failing') { setSaveStatus('failing'); showFlash({ text: t(SAVE_MESSAGES.failing), warn: true }, 4000); }
    else if (state === 'offline') { setSaveStatus('offline'); showFlash({ text: t(SAVE_MESSAGES.offline), warn: true }, 4000); }
    else if (state === 'ok' && recovered) { setSaveStatus(null); showFlash({ text: t(SAVE_MESSAGES.recovered), warn: true }); }
    else if (state === 'conflict') { setSaveStatus('conflict'); showFlash({ text: t(reason === 'server_won' ? SAVE_MESSAGES.server_won : SAVE_MESSAGES.conflict), warn: true }, 9000); }
    else if (state === 'rejected') { setSaveStatus('rejected'); showFlash({ text: t(SAVE_MESSAGES.rejected), warn: true }, 6000); }
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
        // Kopie postupu v zařízení: hra jde otevřít i bez internetu a změny z hraní offline se po připojení sloučí se serverem
        offline: user ? {
          read: () => gameSaves.get(user.id, game.id),
          write: (rec) => gameSaves.put(user.id, game.id, rec),
          reconcile: () => reconcileGameSave({ client: supabase, userId: user.id, gameId: game.id, gameSaves }),
        } : null,
      });
      activeGames.add(game.id); // pozadí ji pak neodesílá samo, hra si postup slučuje sama
    }
    return syncRef.current;
  }, [game.id, handleSaveStatus, user]);

  // Token pro uložení při zavírání stránky: obyčejné načtení tokenu je asynchronní, tam už by se nestihlo.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => { if (!cancelled) tokenRef.current = data?.session?.access_token || null; });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => { tokenRef.current = session?.access_token || null; });
    return () => { cancelled = true; sub?.subscription?.unsubscribe(); };
  }, []);

  // Hra v iframu ukazuje tlačítko „Hrát online“ ve svém menu jen tehdy, když jí to appka povolí (src/mp/entry.js): multiplayer musí být na serveru.
  const postOnline = useCallback(() => {
    const w = iframeRef.current?.contentWindow;
    if (w) w.postMessage(onlineMessage(mpAvailRef.current.state === 'ready'), '*');
  }, []);
  useEffect(() => { if (showGame) postOnline(); }, [showGame, mpAvail.state, postOnline]);

  // Hra, která se v iframu sama znovu načte (třeba restart ve Warroomu), si aktuální postup bere přímo odsud (gameSave/shim.js), ne z kopie
  // vložené při otevření: ta by byla zastaralá a hra by se vrátila o krok zpět.
  useEffect(() => {
    const store = { read: (gameId) => (gameId === game.id && syncRef.current ? syncRef.current.snapshot().map : null) };
    window.__jomaridGameSave = store;
    return () => { if (window.__jomaridGameSave === store) delete window.__jomaridGameSave; };
  }, [game.id]);

  // Dohnat neuložené změny při skrytí stránky (přepnutí karty nebo aplikace), při odchodu ze stránky a při opuštění hry v appce;
  // po návratu spojení se uloží to, co se hrálo offline.
  useEffect(() => {
    const onHide = () => syncRef.current?.flushOnHide();
    const onVisibility = () => { if (document.visibilityState === 'hidden') syncRef.current?.flush(); };
    const onOnline = () => { syncRef.current?.retryNow(); };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      const sync = syncRef.current;
      syncRef.current = null;
      activeGames.delete(game.id);
      if (sync) sync.flush().finally(() => sync.dispose());
    };
  }, [game.id]);

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
  // allowEmpty === true: hráč offline bez uloženého postupu v zařízení chce hrát od začátku (po připojení se sloučí s účtem).
  const handleOpenGame = useCallback(async (allowEmpty = false) => {
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
      if (!sync.isLoaded() || sync.state().stopped) await sync.load({ allowEmpty: allowEmpty === true });
    } catch (err) {
      console.error('Nepodařilo se načíst uložený postup hry:', err?.message || err);
      if (mountedRef.current) { setSaveLoadError(err instanceof NoLocalSaveError ? 'nocopy' : true); setLoadingGame(false); }
      return;
    }
    if (!mountedRef.current) return;
    const { status } = sync.state(); // znovu otevřená hra ukáže štítek i tehdy, když se postup pořád neukládá
    setSaveStatus(status === 'ok' ? null : status);
    // Jazyk hry: v angličtině se do dokumentu vloží slovník hry a překladová vrstva (src/i18n/gameLayer.js).
    const lang = getLang();
    const dict = lang === 'en' ? await loadGameDictionary(game.id) : null;
    if (!mountedRef.current) return;
    setGameDoc(withGameLanguage(withOnlineEntry(withStorageShim(src, game.id, sync.snapshot().map), game.id), lang, dict, { collect: typeof window !== 'undefined' && window.__JOMARID_I18N_COLLECT === true }));
    setLoadingGame(false);
    gameOpenedAtRef.current = Date.now();
    limitShownRef.current = false;
    queuedShownRef.current = false;
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
      // Zprávy se berou jen z iframu sólové hry. Bez něj (třeba za online zápasu, který má vlastní iframe a vlastní most) se nepřijme nic,
      // jinak by online hra mohla psát do uloženého postupu nebo žádat o Coiny jako sólová.
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;

      if (event.data?.type === 'close') {
        handleCloseGame();
      } else if (event.data?.type === 'online-ask') {
        postOnline();
      } else if (event.data?.type === 'online') {
        if (mpAvailRef.current.state === 'ready') setMpLobby(true); // tlačítko Hrát online v menu hry
      } else if (event.data?.type === 'storage') {
        // Změna "localStorage" ve hře (viz gameSave/shim.js): drží se v paměti a posílá se na server s odkladem.
        syncRef.current?.apply(event.data);
      } else if (event.data?.type === 'record' && user) {
        const rec = normalizeRecord(game.id, event.data.stat, event.data.value);
        if (!rec) return;
        // Bez spojení (nebo při výpadku) se rekord uloží do fronty a odešle po připojení; server dál rozhoduje o odznacích.
        if (navigator.onLine === false) { queueRecord(outbox, user.id, rec).catch(() => {}); return; }
        reportGameRecord(supabase, rec.game, rec.stat, rec.value, { onTransient: (r) => { queueRecord(outbox, user.id, r).catch(() => {}); } }).then((res) => {
          if (res?.unlocked?.length) showFlash({ text: `+${res.xp} XP`, label: t('Odznak: {names}', { names: res.unlocked.map((b) => t(b.title)).join(', ') }) });
        });
      } else if (event.data?.type === 'coin' && user) {
        const amount = Math.floor(Number(event.data.amount));
        if (!Number.isFinite(amount) || amount < 1) return;
        const reason = String(event.data.reason || 'event').slice(0, 30);
        requestCoins({ client: supabase, outbox, userId: user.id, gameId: game.id, amount, reason, offline: navigator.onLine === false })
          .then(({ queued, data, error }) => {
            if (queued) {
              // Bez spojení žádost čeká ve frontě; o skutečné částce a stropu rozhodne server po připojení.
              if (!queuedShownRef.current) { queuedShownRef.current = true; showFlash({ text: t('Offline'), label: t('Odměny se připíšou po připojení'), warn: true }); }
              return;
            }
            if (error) { console.error('Chyba při udílení herní odměny:', error.message); return; }
            if (data?.granted) { setCoins(data.balance ?? 0); setCoinsLoaded(true); } // zůstatek z odpovědi serveru platí i tehdy, když se úvodní načtení nepovedlo
            if (data?.granted > 0) showFlash({ text: `+${data.granted}`, label: rewardLabel(reason) });
            else if (data?.capped && !limitShownRef.current) { limitShownRef.current = true; showFlash({ text: t(REWARD_LIMIT_NOTE), warn: true }); }
          })
          .catch((err) => console.error('Chyba při udílení herní odměny:', err.message));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleCloseGame, postOnline, user, game.id, showFlash]);

  const canClaim = hasPlayedEnough && !checkingStatus && !claimedToday && online;

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
      alert(friendlyError(err, t('Odměnu se nepodařilo vyzvednout. Zkus to znovu.')));
    } finally {
      setClaiming(false);
    }
  };

  // Zápas nebo aréna se otevírá místo hry: sólová hra se zavře (uloží se její postup) a okno Hrát online také.
  const handleMpMatch = useCallback((m) => { setMpAuto(null); setMpLobby(false); handleCloseGame(); setMpMatch(m); }, [handleCloseGame]);
  const handleMpArena = useCallback(() => { setMpAuto(null); setMpLobby(false); handleCloseGame(); setMpArena(true); }, [handleCloseGame]);
  const closeLobby = useCallback(() => {
    setMpLobby(false);
    setMpAuto(null);
    try { iframeRef.current?.contentWindow?.focus(); } catch { /* okno hry se zaměřit nedá: klávesy začnou platit po kliknutí do hry */ }
  }, []);
  const lobbyDialog = mpLobby ? (
    <MpLobbyDialog game={game} online={online} avail={mpAvail} auto={mpAuto} onMatch={handleMpMatch} onArena={handleMpArena} onClose={closeLobby} />
  ) : null;

  // Sdílená aréna má obrazovku bez zápasu: hra v iframu napojená jen na společný kanál (src/mp)
  if (mpArena) {
    return (
      <MpArenaScreen
        game={game}
        userId={user.id}
        coins={coins}
        coinsLoaded={coinsLoaded}
        reader={reader}
        gameFx={gameFx}
        onExit={() => setMpArena(false)}
        onCoins={(n) => setCoins((c) => c + n)}
      />
    );
  }

  // Online zápas má vlastní obrazovku (src/mp): hra v iframu s čistým úložištěm, bez cheatů a s napojením na server.
  if (mpMatch) {
    return (
      <MpGameScreen
        key={mpMatch.id}
        game={game}
        match={mpMatch}
        coins={coins}
        coinsLoaded={coinsLoaded}
        reader={reader}
        gameFx={gameFx}
        onExit={() => { setMpMatch(null); setMpAuto(null); }}
        onAgain={() => { setMpAuto({ mode: mpMatch.mode, params: mpMatch.params }); setMpMatch(null); setMpLobby(true); }}
        onCoins={(n) => setCoins((c) => c + n)}
      />
    );
  }

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
        <GameBar title={t(game.title)} onClose={handleCloseGame} coins={coins} coinsLoaded={coinsLoaded} level={reader?.level} levelName={reader?.levelName} flash={flash} saveStatus={saveStatus} />
        <iframe
          ref={iframeRef}
          title={t(game.title)}
          srcDoc={gameDoc}
          allow="clipboard-write"
          // Hra se po načtení zaměří, ať klávesy a ovladač fungují hned, bez kliknutí do ní (bez toho by klávesy dostala stránka kolem).
          onLoad={(e) => { try { e.currentTarget.contentWindow?.focus(); } catch { /* okno hry se zaměřit nedá: klávesy začnou platit po kliknutí do hry */ } }}
          style={{ border: 'none', display: 'block', ...(gameFx ? { filter: gameFx } : {}) }}
          className="flex-1 min-h-0 min-w-0 w-full"
        />
        {lobbyDialog}
      </div>
    );
  }

  const GameIcon = game.icon;

  return (
    <div className="max-w-4xl mx-auto px-4 py-16 text-center animate-in fade-in duration-300">
      <Link to={game.folder ? `/games?slozka=${game.folder}` : '/games'} className="text-[0.625rem] font-black uppercase tracking-wider no-underline opacity-50 hover:opacity-100 transition-all inline-flex items-center gap-1 mb-6" style={{ color: 'var(--text-body)' }}>
        ← {game.folder ? t('Složka {name}', { name: t(FOLDERS.find(f => f.key === game.folder)?.title || 'her') }) : t('Všechny hry')}
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
            {t(game.title)}
          </h1>
          <p style={{ color: 'var(--text-muted)' }} className="text-sm max-w-md mx-auto">
            {t(game.tagline)} {t('Otevře se rovnou tady na celou obrazovku.')}
          </p>
        </div>

        <button
          onClick={() => handleOpenGame()}
          onPointerEnter={warmUp}
          onFocus={warmUp}
          aria-disabled={loadingGame}
          aria-busy={loadingGame}
          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          className="px-8 py-3.5 rounded-xl font-black uppercase tracking-wider text-sm border-none cursor-pointer shadow-lg hover:opacity-90 transition-all flex items-center gap-2 aria-disabled:cursor-wait aria-disabled:opacity-70"
        >
          {loadingGame ? <><Loader2 size={16} className="animate-spin" /> {t('Načítám hru...')}</> : <><GameIcon size={16} /> {t('Spustit hru')}</>}
        </button>
        <MpResume game={game} online={online} avail={mpAvail} onMatch={handleMpMatch} />
        {lobbyDialog}
        {saveLoadError && (
          <div role="alert" data-testid="save-load-error" className="-mt-3 flex flex-col items-center gap-2">
            <p style={{ color: 'var(--text-body)', borderColor: '#ef4444' }} className="text-xs m-0 border-l-2 pl-2 text-left max-w-sm">
              {saveLoadError === 'nocopy' ? t(SAVE_NO_LOCAL_COPY) : t(SAVE_LOAD_ERROR)}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {saveLoadError === 'nocopy' && (
                <button
                  onClick={() => handleOpenGame(true)}
                  data-testid="play-fresh-offline"
                  style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                  className="px-4 py-2 rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer border-none"
                >
                  {t(SAVE_PLAY_FRESH)}
                </button>
              )}
              <button
                onClick={() => handleOpenGame()}
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
                className="px-4 py-2 rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer border"
              >
                {t('Zkusit znovu')}
              </button>
            </div>
          </div>
        )}
        {loadError && (
          // Prohlížeč si neúspěšné načtení souboru pamatuje, takže opakované kliknutí často nepomůže (stejně jako po vydání nové
          // verze aplikace, kdy staré soubory už neexistují). Spolehlivě pomůže až obnovení stránky.
          <div role="alert" className="-mt-3 flex flex-col items-center gap-2">
            <p style={{ color: 'var(--text-body)', borderColor: '#ef4444' }} className="text-xs m-0 border-l-2 pl-2 text-left max-w-sm">
              {t('Hru se nepodařilo načíst. Zkontroluj připojení a zkus to znovu - když to nepomůže, obnov stránku.')}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
              className="px-4 py-2 rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer border"
            >
              {t('Obnovit stránku')}
            </button>
          </div>
        )}

        <div style={{ borderColor: 'var(--border-color)' }} className="w-full border-t pt-6 flex flex-col items-center gap-3">
          <p style={{ color: 'var(--text-muted)' }} className="text-xs max-w-sm mx-auto opacity-80">
            {t('Postup ve hře (vylepšení, nastavení, rozehraná partie), rekordy i herní odznaky se ukládají k tvému účtu, takže je máš na všech zařízeních stejné (rekordy a odznaky najdeš na stránce Odznaky, záložka Odznaky her). Za to, že si dnes zahraješ, dostaneš i pár skutečných Jomarid Coinů - jednou denně.')}
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
              <>{t('Dnešní odměna vyzvednuta')} {claimedAmount ? `(+${claimedAmount})` : ''} <Coins size={12} /></>
            ) : !online ? (
              <>{t('Odměna za hraní jde jen online')} <Lock size={12} /></>
            ) : !hasPlayedEnough ? (
              <>{t('Nejdřív si zahraj')} <Lock size={12} /></>
            ) : (
              <>{t('Vyzvednout dnešní odměnu za hraní')} <Coins size={12} /></>
            )}
          </button>
          {!claimedToday && !checkingStatus && !hasPlayedEnough && (
            <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] opacity-60">
              {t('Odměna se odemkne po chvilce hraní - zkus to po zavření hry znovu.')}
            </span>
          )}
          <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] opacity-60 flex items-center gap-1">
            <Coins size={11} /> {t('Aktuální zůstatek: {n} Jomarid Coins', { n: coins })}
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
      <h3 className="font-black uppercase text-xs sm:text-sm tracking-tight m-0" style={{ color: 'var(--text-body)' }}>{t(game.title)}</h3>
      <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] sm:text-xs m-0 line-clamp-3 sm:line-clamp-none">{t(game.tagline)}</p>
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
        <h1 className="text-3xl font-black uppercase tracking-tight mb-2" style={{ color: 'var(--text-body)' }}>{t('Mini-hry 🎮')}</h1>
        <p style={{ color: 'var(--text-muted)' }} className="text-sm">{t('Krátká odbočka od čtení - a pár Jomarid Coinů navrch za to, že si dnes zahraješ.')}</p>
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
              <h3 className="font-black uppercase text-xs sm:text-sm tracking-tight m-0" style={{ color: 'var(--text-body)' }}>{t(folder.title)}</h3>
              <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] sm:text-xs m-0">{t(folder.tagline)}</p>
              <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider flex items-center gap-1.5">
                {inside.map(g => { const I = g.icon; return <I key={g.id} size={12} aria-hidden="true" />; })}
                {inside.length} {t.p(inside.length, 'hra', 'hry', 'her')}
              </span>
            </button>
          );
        })}
      </div>
      {openFolder && (
        <div id={`folder-${openFolder.key}`} data-testid={`folder-games-${openFolder.key}`} role="region" aria-label={t('Složka {name}', { name: t(openFolder.title) })} className="mt-6 sm:mt-10">
          <h2 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider text-center mb-3 sm:mb-4 flex items-center justify-center gap-1.5">
            <FolderOpen size={14} aria-hidden="true" /> {t(openFolder.title)}
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
        <p style={{ color: 'var(--text-muted)' }} className="text-sm mb-4">{t('Tahle hra neexistuje.')}</p>
        <Link to="/games" style={{ color: 'var(--text-badge)' }} className="text-xs font-black uppercase">{t('← Zpět na hry')}</Link>
      </div>
    );
  }
  return <GameLauncher key={game.id} game={game} />;
};
