import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Coins, Loader2, X, Rocket, Swords, Building2, Target, Crown, Lock } from 'lucide-react';
import { ROCKET_GAME_HTML } from '../gameContent/rocketGame';
import { WARROOM_HTML } from '../gameContent/warroom';
import { CITY_CLICKER_HTML } from '../gameContent/cityClicker';
import { POLYGON_ARENA_HTML } from '../gameContent/polygonArena';
import { CHESS_HTML } from '../gameContent/chess';

const GAMES = [
  {
    id: 'rocket',
    title: 'Jomarid Rocket Game',
    tagline: 'Vesmírná arkádová střílečka s vlastními vylepšeními a postupem.',
    icon: Rocket,
    html: ROCKET_GAME_HTML,
  },
  {
    id: 'warroom',
    title: 'Warroom: Frontlines',
    tagline: 'Velitelská taktická hra - řiď frontu, jednotky a zdroje ve velitelském stanu.',
    icon: Swords,
    html: WARROOM_HTML,
  },
  {
    id: 'cityclicker',
    title: 'City Clicker',
    tagline: 'Vybuduj si vlastní město klikáním - se čtyřmi zcela odlišnými vizuálními styly na výběr.',
    icon: Building2,
    html: CITY_CLICKER_HTML,
  },
  {
    id: 'polygonarena',
    title: 'Polygon aréna',
    tagline: 'Rozstřílej tvary, poskládej si stavbu tanku a přežij mezi chytrými boty - klasika, týmy nebo cvičiště.',
    icon: Target,
    html: POLYGON_ARENA_HTML,
  },
  {
    id: 'chess',
    title: 'Chess League',
    tagline: 'Šachy proti pěti botům rostoucí obtížnosti - se streaky, XP a ligovým postupem.',
    icon: Crown,
    html: CHESS_HTML,
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
  const gameOpenedAtRef = useRef(null);
  const iframeRef = useRef(null);

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

  const handleOpenGame = useCallback(() => {
    gameOpenedAtRef.current = Date.now();
    setShowGame(true);
  }, []);

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
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.source === 'jomarid-game' && event.data?.type === 'close') {
        if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
        handleCloseGame();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleCloseGame]);

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
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, backgroundColor: '#000' }}>
        <button
          onClick={handleCloseGame}
          title="Zavřít hru"
          style={{ position: 'fixed', top: 'calc(10px + env(safe-area-inset-top,0px))', right: '10px', zIndex: 1000, backgroundColor: 'rgba(5,5,15,0.75)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          className="w-9 h-9 rounded-xl cursor-pointer flex items-center justify-center backdrop-blur-sm"
        >
          <X size={18} />
        </button>
        <iframe
          ref={iframeRef}
          title={game.title}
          srcDoc={game.html}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        />
      </div>
    );
  }

  const GameIcon = game.icon;

  return (
    <div className="max-w-4xl mx-auto px-4 py-16 text-center animate-in fade-in duration-300">
      <Link to="/games" className="text-[10px] font-black uppercase tracking-wider no-underline opacity-50 hover:opacity-100 transition-all inline-flex items-center gap-1 mb-6" style={{ color: 'var(--text-body)' }}>
        ← Všechny hry
      </Link>
      <div 
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} 
        className="border rounded-3xl p-8 md:p-12 shadow-xl flex flex-col items-center justify-center gap-6"
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
          style={{ backgroundColor: 'var(--bg-primary)', color: 'white' }}
          className="px-8 py-3.5 rounded-xl font-black uppercase tracking-wider text-sm border-none cursor-pointer shadow-lg hover:opacity-90 transition-all flex items-center gap-2"
        >
          <GameIcon size={16} /> Spustit hru
        </button>

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
            <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-60">
              Odměna se odemkne po chvilce hraní - zkus to po zavření hry znovu.
            </span>
          )}
          <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-60 flex items-center gap-1">
            <Coins size={11} /> Aktuální zůstatek: {coins} Jomarid Coins
          </span>
        </div>
      </div>
    </div>
  );
};


export const GamesHub = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 animate-in fade-in duration-300">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-black uppercase tracking-tight mb-2" style={{ color: 'var(--text-body)' }}>Mini-hry 🎮</h1>
        <p style={{ color: 'var(--text-muted)' }} className="text-sm">Krátká odbočka od čtení - a pár Jomarid Coinů navrch za to, že si dnes zahraješ.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {GAMES.map(game => {
          const GameIcon = game.icon;
          return (
            <Link
              key={game.id}
              to={`/games/${game.id}`}
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
              className="border rounded-2xl p-6 flex flex-col items-center text-center gap-3 no-underline hover:shadow-lg transition-all"
            >
              <div className="w-16 h-16 bg-purple-500/10 text-purple-500 rounded-full flex items-center justify-center">
                <GameIcon size={30} />
              </div>
              <h3 className="font-black uppercase text-sm tracking-tight m-0" style={{ color: 'var(--text-body)' }}>{game.title}</h3>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-75">{game.tagline}</p>
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
  return <GameLauncher game={game} />;
};
