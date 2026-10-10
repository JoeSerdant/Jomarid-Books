import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Coins, Loader2, X, Rocket, Swords, Building2, Target, Crown, Lock } from 'lucide-react';

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
    load: () => import('../gameContent/warroom').then(m => m.WARROOM_HTML),
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
    tagline: 'Šachy proti pěti botům s vlastní osobností - skutečný Elo rating, hodiny, nápověda, rozbor partie a ligový postup.',
    icon: Crown,
    load: () => import('../gameContent/chess').then(m => m.CHESS_HTML),
  },
  // Další hra se přidá jako další objekt v tomhle poli.
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
  const [claiming, setClaiming] = useState(false);
  const [claimedToday, setClaimedToday] = useState(false);
  const [claimedAmount, setClaimedAmount] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [showGame, setShowGame] = useState(false);
  const [hasPlayedEnough, setHasPlayedEnough] = useState(false);
  const [html, setHtml] = useState(null); // text hry; do stažení je null
  const [loadingGame, setLoadingGame] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const gameOpenedAtRef = useRef(null);
  const iframeRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('coins').eq('id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw error;
        if (data) setCoins(data.coins || 0);
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
    let src = html;
    if (!src) {
      setLoadError(false);
      setLoadingGame(true);
      try {
        src = await game.load();
      } catch (err) {
        console.error('Nepodařilo se načíst hru:', err?.message || err);
        if (mountedRef.current) { setLoadError(true); setLoadingGame(false); }
        return;
      }
      if (!mountedRef.current) return;
      setHtml(src);
      setLoadingGame(false);
    }
    gameOpenedAtRef.current = Date.now();
    setShowGame(true);
  }, [game, html, loadingGame]);

  // Při najetí myší nebo zaostření se hra stáhne dopředu, takže se po kliknutí obvykle otevře hned.
  const warmUp = useCallback(() => { game.load().catch(() => {}); }, [game]);

  const handleCloseGame = useCallback(() => {
    if (gameOpenedAtRef.current && Date.now() - gameOpenedAtRef.current >= MIN_PLAY_MS) {
      setHasPlayedEnough(true);
    }
    gameOpenedAtRef.current = null;
    setShowGame(false);
  }, []);

  // Hry uvnitř iframu posílají postMessage místo skutečné navigace na "/app" -
  // díky tomu tlačítko "Zpět" ve hře nikdy nezpůsobí opravdový přechod na
  // serveru (a tedy ani riziko 404, kdyby hostingu chyběl SPA rewrite).
  // event.source se navíc ověřuje proti konkrétnímu iframu týhle hry, aby
  // zprávu nemohlo spustit nic jiného, co náhodou pošle stejně tvarovanou
  // zprávu odjinud.
  //
  // 'coin' je ŽÁDOST o odměnu za herní událost (zlaté kliknutí, sklad zásob,
  // krystal, výhra v šachách...) - hra sama Jomarid Coins NIKDY neuděluje,
  // jen POŽÁDÁ; o skutečné částce (a denním stropu) rozhoduje výhradně server
  // přes award_game_coins(). Výsledek se pošle zpátky do hry jako
  // 'coin-result', aby mohla zobrazit skutečně připsanou částku (ne tu, o
  // kterou jen požádala).
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.source !== 'jomarid-game') return;
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;

      if (event.data?.type === 'close') {
        handleCloseGame();
      } else if (event.data?.type === 'coin' && user) {
        const amount = Math.floor(Number(event.data.amount));
        if (!Number.isFinite(amount) || amount < 1) return;
        supabase.rpc('award_game_coins', { p_game_id: game.id, p_amount: amount, p_reason: String(event.data.reason || 'event').slice(0, 30) })
          .then(({ data, error }) => {
            if (error) { console.error('Chyba při udílení herní odměny:', error.message); return; }
            if (data?.granted) setCoins(data.balance ?? 0);
            try {
              event.source?.postMessage({ source: 'jomarid-host', type: 'coin-result', granted: data?.granted || 0, capped: !!data?.capped }, '*');
            } catch { /* okno hry už zaniklo */ }
          })
          .catch((err) => console.error('Chyba při udílení herní odměny:', err.message));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleCloseGame, user, game.id]);

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
      alert('Nepodařilo se vyzvednout odměnu: ' + (err.message || 'neznámá chyba'));
    } finally {
      setClaiming(false);
    }
  };

  // Hra běží v izolovaném iframu (srcDoc) přímo nad zbytkem appky - žádná
  // navigace pryč z SPA, žádný samostatný soubor ani public/ složka. Herní
  // vlastní CSS reset a stovky document.getElementById volání tak nemůžou
  // nijak zasáhnout do zbytku Reactu (a naopak).
  if (showGame) {
    // Křížek není přes hru, ale v samostatném pruhu mimo ni: dřív ležel v rohu přes iframe a na telefonu zakrýval ovládací
    // prvky her (např. pauzu v Rocket Game). Pruh je nahoře; na nízké obrazovce na šířku (telefon) je vpravo, ať se hře
    // neubírá výška. Hra se v iframu přizpůsobí zbylé ploše, takže to platí pro všechny hry, i budoucí.
    // Třídy jsou napsané celé (ne skládané): Tailwind je při sestavení hledá v textu a sestavené by nepoznal.
    return (
      // Výřez displeje (--sat nahoře, --sar vpravo) se přičítá k velikosti pruhu, ne odebírá z místa pro tlačítko.
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, backgroundColor: '#000', '--sat': 'env(safe-area-inset-top,0px)', '--sar': 'env(safe-area-inset-right,0px)' }} className="flex flex-col [@media(orientation:landscape)_and_(max-height:500px)]:flex-row-reverse">
        <div
          data-testid="game-bar"
          style={{ backgroundColor: '#05050f', paddingTop: 'var(--sat)', paddingRight: 'var(--sar)', borderColor: 'rgba(255,255,255,0.12)' }}
          className="shrink-0 flex items-center justify-between gap-2 px-3 h-[calc(2.75rem+var(--sat))] border-b [@media(orientation:landscape)_and_(max-height:500px)]:flex-col [@media(orientation:landscape)_and_(max-height:500px)]:justify-start [@media(orientation:landscape)_and_(max-height:500px)]:w-[calc(3rem+var(--sar))] [@media(orientation:landscape)_and_(max-height:500px)]:h-auto [@media(orientation:landscape)_and_(max-height:500px)]:px-1 [@media(orientation:landscape)_and_(max-height:500px)]:pt-2 [@media(orientation:landscape)_and_(max-height:500px)]:border-b-0 [@media(orientation:landscape)_and_(max-height:500px)]:border-l"
        >
          <span style={{ color: 'rgba(255,255,255,0.7)' }} className="text-[0.6875rem] font-black uppercase tracking-wider truncate [@media(orientation:landscape)_and_(max-height:500px)]:hidden">{game.title}</span>
          <button
            onClick={handleCloseGame}
            title="Zavřít hru"
            aria-label="Zavřít hru"
            style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}
            className="w-9 h-9 shrink-0 rounded-xl cursor-pointer flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>
        <iframe
          ref={iframeRef}
          title={game.title}
          srcDoc={html}
          allow="clipboard-write"
          style={{ border: 'none', display: 'block' }}
          className="flex-1 min-h-0 min-w-0 w-full"
        />
      </div>
    );
  }

  const GameIcon = game.icon;

  return (
    <div className="max-w-4xl mx-auto px-4 py-16 text-center animate-in fade-in duration-300">
      <Link to="/games" className="text-[0.625rem] font-black uppercase tracking-wider no-underline opacity-50 hover:opacity-100 transition-all inline-flex items-center gap-1 mb-6" style={{ color: 'var(--text-body)' }}>
        ← Všechny hry
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
            Skóre a vylepšení ve hře jsou jen pro zábavu a zůstávají jen v tomhle prohlížeči. Za to, že si dnes zahraješ, ale dostaneš i pár skutečných Jomarid Coinů - jednou denně.
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


export const GamesHub = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 sm:py-16 animate-in fade-in duration-300">
      <div className="text-center mb-6 sm:mb-10">
        <h1 className="text-3xl font-black uppercase tracking-tight mb-2" style={{ color: 'var(--text-body)' }}>Mini-hry 🎮</h1>
        <p style={{ color: 'var(--text-muted)' }} className="text-sm">Krátká odbočka od čtení - a pár Jomarid Coinů navrch za to, že si dnes zahraješ.</p>
      </div>
      {/* Na telefonu dva sloupce s kompaktními kartami (pět her pod sebou zabíralo přes 1000 px). */}
      <div className="grid grid-cols-2 gap-3 sm:gap-6">
        {GAMES.map(game => {
          const GameIcon = game.icon;
          return (
            <Link
              key={game.id}
              to={`/games/${game.id}`}
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
        })}
      </div>
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
