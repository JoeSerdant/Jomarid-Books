import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BookDetailModal } from '../components/BookDetailModal';
import { LibraryBrowser } from '../browse/LibraryBrowser';
import { BookCover, LoadMore } from '../browse/BrowseParts';
import { usePagedList } from '../browse/usePagedList';
import { loadLibrary } from '../browse/libraryData';
import { isInProgress } from '../browse/libraryModel';
import { czCount } from '../browse/browseModel';
import {
  BookOpen, Coins, Heart, Loader2, LogOut, Sparkles, Star, ArrowLeft, Feather,
} from 'lucide-react';

export const UserLibrary = () => {
  const { user, logout } = useAuth();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState(null);
  const [coins, setCoins] = useState(0);
  const [dailyBonus, setDailyBonus] = useState(null);
  const [detailBook, setDetailBook] = useState(null);

  // Výsledek z vyhledávání, který ještě nemám odemčený, sem přijde jako location.state.openBookId
  // a rovnou se otevře jeho detail (s tlačítkem Koupit).
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const id = location.state?.openBookId;
    if (!id || loading) return;
    const target = books.find(b => b.id === id);
    if (target) setDetailBook(target);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, loading, books]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data se načítají podle id uživatele, ne podle objektu user: ten se v appce během chvilky vymění víckrát (obnovení
  // přihlášení, zápis do metadat účtu při prohlídce) a každá výměna by spustila stejné dotazy znovu a seznam by
  // "vyskočil" na začátek. Spinner na celou stránku je jen při prvním načtení; další načtení (např. po nákupu, který
  // se nepodařil, protože kniha už patřila čtenáři) proběhne tiše na pozadí.
  const userId = user?.id;
  const loadedOnce = useRef(false);
  const loadSeq = useRef(0);

  const loadLibraryData = useCallback(async () => {
    if (!userId) return;
    const seq = ++loadSeq.current;
    if (!loadedOnce.current) setLoading(true);
    try {
      // Přihlašovací bonus se uděluje atomicky přes RPC (nejvýš jednou za kalendářní den).
      try {
        const { data: bonusData, error: bonusError } = await supabase.rpc('claim_daily_login_bonus');
        if (!bonusError && bonusData?.granted) {
          setDailyBonus(bonusData.amount);
        }
      } catch (bonusErr) {
        console.error('Přihlašovací bonus se nepodařilo přiznat:', bonusErr);
      }

      // Vyřešení streaku (dožene jakékoliv celé uplynulé dny od posledního
      // vyřešení) - proaktivně i tady, ne jen při návštěvě Statistik, ať se
      // to nenatahuje na dobu, kdy si toho uživatel zrovna všimne.
      try {
        await supabase.rpc('resolve_streak');
      } catch (streakErr) {
        console.error('Nepodařilo se vyhodnotit streak:', streakErr);
      }

      // Knihy po částech, počty lajků jedním číslem u knihy (viz browse/libraryData.js).
      const { books: loadedBooks, coins: balance } = await loadLibrary(supabase, userId);
      if (seq !== loadSeq.current) return; // mezitím začalo novější načtení, to platí
      if (balance !== null) setCoins(balance);
      setBooks(loadedBooks);
      loadedOnce.current = true;

      // Pokud sem uživatel dorazil kvůli konkrétní knize (klik na homepage,
      // ať už jako právě přihlášený, nebo už dřív přihlášený), otevřít mu
      // rovnou její detail - ať nemusí knihu mezi všemi ostatními hledat znovu sám.
      try {
        const pendingBookId = sessionStorage.getItem('library_open_book_id');
        if (pendingBookId) {
          sessionStorage.removeItem('library_open_book_id');
          const target = loadedBooks.find(b => b.id === pendingBookId);
          if (target) setDetailBook(target);
        }
      } catch (e) { /* storage unavailable, ignore */ }
    } catch (error) {
      console.error("Chyba při načítání knihovny:", error.message);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => { loadLibraryData(); }, [loadLibraryData]);

  const handleBuyLicense = async (book) => {
    if (!user) return;
    setSubmittingId(book.id);
    try {
      // purchase_book je atomická Postgres funkce (SECURITY DEFINER): ověří cenu a zůstatek,
      // strhne mince, přidělí přístup a zaloguje transakci - to vše v jedné DB transakci.
      const { data, error } = await supabase.rpc('purchase_book', { book_id_input: book.id });
      if (error) throw error;

      setCoins(data?.new_balance ?? (coins - book.priceCoins));
      setBooks(prev => prev.map(sb => sb.id === book.id ? { ...sb, hasAccess: true } : sb));
      setDetailBook(prev => prev && prev.id === book.id ? { ...prev, hasAccess: true } : prev);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('insufficient_coins')) {
        let realBalance = coins;
        try {
          const { data: freshProfile } = await supabase.from('profiles').select('coins').eq('id', user.id).maybeSingle();
          if (freshProfile) {
            realBalance = freshProfile.coins ?? realBalance;
            setCoins(realBalance);
          }
        } catch (refreshErr) {
          console.error('Nepodařilo se ověřit aktuální zůstatek:', refreshErr);
        }
        alert(`Nemáš dost Jomarid Coinů. Tahle kniha stojí ${book.priceCoins}, ty máš ${realBalance}.`);
      } else if (msg.includes('already_owned')) {
        alert('Tuhle knihu už vlastníš.');
        loadLibraryData();
      } else {
        alert('Nákup se nezdařil: ' + msg);
      }
    } finally {
      setSubmittingId(null);
    }
  };

  // Stabilní funkce (useCallback), ať se při změně jedné knihy nevykreslují znovu všechny karty v seznamu.
  const toggleLike = useCallback(async (book) => {
    if (!user) return;
    const wasLiked = book.isLiked;
    setBooks(prev => prev.map(sb => sb.id === book.id ? { ...sb, isLiked: !wasLiked, likesCount: sb.likesCount + (wasLiked ? -1 : 1) } : sb));
    try {
      if (wasLiked) {
        const { error } = await supabase.from('book_likes').delete().eq('user_id', user.id).eq('book_id', book.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('book_likes').insert([{ user_id: user.id, book_id: book.id }]);
        if (error) throw error;
      }
    } catch (err) {
      setBooks(prev => prev.map(sb => sb.id === book.id ? { ...sb, isLiked: wasLiked, likesCount: sb.likesCount + (wasLiked ? 1 : -1) } : sb));
      console.error('Lajk se nepodařilo uložit:', err);
    }
  }, [user]);

  // Kniha, kterou má smysl nabídnout k pokračování - vlastněná, rozečtená,
  // ale ne dočtená, naposledy otevřená jako první.
  const continueBook = useMemo(() => {
    const candidates = books.filter(isInProgress);
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, b) => (b.lastOpened > latest.lastOpened ? b : latest), candidates[0]);
  }, [books]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-pulse">
      <Loader2 className="animate-spin mb-4" size={40} style={{ color: 'var(--bg-primary)' }} />
      <p className="text-sm font-black uppercase tracking-wider opacity-60">Otevírám tvůj čtenářský trezor...</p>
    </div>
  );

  return (
    <>
      <div style={{ color: 'var(--text-body)' }} className="max-w-6xl mx-auto px-4 py-4 sm:py-8 space-y-3 sm:space-y-5 animate-in fade-in duration-500">
        {/* Na telefonu je hlavička jen nadpis: odznak a odhlášení by zabíraly místo knihám (odhlášení je v horní liště). */}
        <div className="flex justify-between items-end gap-3 border-b pb-2 sm:pb-6" style={{ borderColor: 'var(--border-color)' }}>
          <div className="min-w-0">
            <span className="bg-amber-500/10 text-amber-500 text-[10px] font-black uppercase px-2.5 py-1 rounded-full border border-amber-500/20 hidden sm:inline-flex items-center gap-1 mb-2">
              <Sparkles size={10} /> Prémiová knihovna
            </span>
            <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-tight m-0">Tvoje Knihovna</h2>
          </div>
          <button onClick={logout} style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="hidden sm:flex items-center gap-2 px-4 py-2.5 border rounded-xl font-bold uppercase text-xs cursor-pointer hover:bg-red-500/10 hover:text-red-500 transition-all">
            <LogOut size={14} /> Odhlásit se
          </button>
        </div>

        {/* POKRAČOVAT VE ČTENÍ - jen když je co nabídnout */}
        {continueBook && (
          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-2.5 sm:p-4 flex items-center gap-3 sm:gap-5">
            <BookCover title={continueBook.title} seed={continueBook.id} className="w-10 h-14 sm:w-16 sm:h-20 rounded-lg sm:rounded-xl shrink-0" textClass="text-base sm:text-2xl" />
            <div className="flex-1 min-w-0">
              <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wide opacity-60 hidden sm:block">Pokračovat ve čtení</span>
              <h3 className="font-black text-sm sm:text-base uppercase tracking-tight truncate m-0">{continueBook.title}</h3>
              <div className="flex items-center gap-2 mt-1.5 sm:mt-2 sm:max-w-sm">
                <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="flex-1 h-1.5 rounded-full overflow-hidden">
                  <div style={{ backgroundColor: 'var(--bg-primary)', width: `${Math.round(continueBook.scrollPosition)}%` }} className="h-full rounded-full" />
                </div>
                <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-70 shrink-0 tabular-nums">{Math.round(continueBook.scrollPosition)} %<span className="hidden sm:inline"> přečteno</span></span>
              </div>
            </div>
            <Link to={`/read/${continueBook.id}`} aria-label={`Pokračovat ve čtení: ${continueBook.title}`} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="no-underline shrink-0 px-3 sm:px-6 py-2.5 sm:py-3 rounded-xl font-black text-[11px] sm:text-xs uppercase tracking-wider hover:brightness-105 transition-all flex items-center justify-center gap-1.5 sm:gap-2">
              <BookOpen size={14} /> <span className="max-[359px]:hidden">Pokračovat</span>
            </Link>
          </div>
        )}

        {/* Zůstatek je i v horní liště, takže na telefonu se tenhle pruh ukáže jen s přihlašovacím bonusem. */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className={`border p-3 sm:p-3.5 rounded-2xl items-center gap-3 ${dailyBonus ? 'flex' : 'hidden sm:flex'}`}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shrink-0">
            <Coins size={20} />
          </div>
          <div className="min-w-0">
            <h4 className="font-black text-sm uppercase m-0 flex items-center gap-2">
              {coins.toLocaleString()} Jomarid Coins
            </h4>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">
              {dailyBonus ? `+${dailyBonus} mincí za dnešní přihlášení! 🎉` : 'Kup si přístup ke knihám za mince, nebo si je vydělej odznáčky.'}
            </p>
          </div>
        </div>

        {/* Přehled (vlastníš / rozečteno / dočteno) je teď v přepínači knihovny jako počty u filtrů. */}
        <LibraryBrowser key={user.id} books={books} coins={coins} userId={user.id} onOpenDetail={setDetailBook} onToggleLike={toggleLike} />
      </div>

      {/* Mimo kontejner s odstupy (space-y): jinak by překryv detailu dostal horní okraj a nezakrýval celé okno. */}
      <BookDetailModal
        book={detailBook}
        onClose={() => setDetailBook(null)}
        onBuy={handleBuyLicense}
        buying={detailBook ? submittingId === detailBook.id : false}
        coins={coins}
      />
    </>
  );
};

const NO_BOOKS = [];

// Veřejná stránka autora: jméno (krycí jméno, jinak uživatelské), souhrn hodnocení a jeho neskryté knihy.
// Kliknutí na knihu otevře její detail v knihovně (stejně jako výsledek z vyhledávání).
export const AuthorPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    (async () => {
      const { data, error } = await supabase.rpc('author_profile', { p_author: id });
      if (!alive) return;
      if (error) {
        const msg = String(error.message || '');
        if (error.code === 'PGRST202' || /could not find the function/i.test(msg)) return setState({ status: 'missing' });
        if (error.code === '22P02' || /invalid input syntax/i.test(msg)) return setState({ status: 'notfound' }); // adresa není platné ID
        return setState({ status: 'error' });
      }
      setState(data?.found ? { status: 'ok', author: data } : { status: 'notfound' });
    })();
    return () => { alive = false; };
  }, [id]);

  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/app'));
  const a = state.author;
  // Autor s mnoha knihami: seznam se ukazuje po částech.
  const pagedBooks = usePagedList(a?.books ?? NO_BOOKS, { pageSize: 20 });

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-3xl mx-auto px-3 sm:px-4 py-6 sm:py-10">
      <div className="flex items-center gap-3 mb-5">
        <button type="button" onClick={goBack} aria-label="Zpět" title="Zpět" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="w-10 h-10 shrink-0 border rounded-xl cursor-pointer flex items-center justify-center hover:brightness-95 active:scale-95 transition-all">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight m-0 break-words min-w-0">{state.status === 'ok' ? a.name : 'Autor'}</h1>
      </div>

      {state.status === 'loading' && <div className="flex items-center gap-2 text-xs font-bold py-10 justify-center" style={{ color: 'var(--text-muted)' }}><Loader2 size={16} className="animate-spin" /> Načítám...</div>}
      {state.status === 'notfound' && <p style={{ color: 'var(--text-muted)' }} className="text-sm text-center py-10 m-0">Tenhle autor tu není. Možná už nepublikuje, nebo je odkaz špatný.</p>}
      {state.status === 'missing' && <p style={{ color: 'var(--text-muted)' }} className="text-sm text-center py-10 m-0">Stránky autorů se zapnou po aktualizaci databáze.</p>}
      {state.status === 'error' && <p role="alert" className="text-sm text-center py-10 m-0 text-red-500 font-bold">Autora se nepodařilo načíst. Zkus to za chvíli.</p>}

      {state.status === 'ok' && (
        <>
          <section style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl shadow-sm p-4 sm:p-5 mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <span style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--bg-primary)' }} className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"><Feather size={22} /></span>
            <div className="min-w-0 flex-1">
              <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-black uppercase tracking-wider m-0">{a.pen_name ? 'Autor · krycí jméno' : 'Autor'}</p>
              <p className="text-sm font-bold m-0 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span data-testid="author-books-count">{czCount(a.books_count, 'kniha', 'knihy', 'knih')}</span>
                {a.ratings_count > 0
                  ? <span data-testid="author-rating" className="inline-flex items-center gap-1"><Star size={13} className="fill-current text-amber-500" /> {Number(a.avg_rating).toFixed(1)} <span style={{ color: 'var(--text-muted)' }} className="font-semibold">({czCount(a.ratings_count, 'hodnocení', 'hodnocení', 'hodnocení')})</span></span>
                  : <span style={{ color: 'var(--text-muted)' }} className="font-semibold">zatím bez hodnocení</span>}
              </p>
            </div>
            {a.is_self && <Link to="/publisher" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider no-underline">Spravovat moje knihy</Link>}
          </section>

          {a.books.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="text-sm text-center py-8 m-0">Autor zatím nemá žádné zveřejněné knihy.</p>
          ) : (
            <>
              <ul className="list-none p-0 m-0 space-y-3">
                {pagedBooks.items.map(b => (
                  <li key={b.id}>
                    <button type="button" data-testid="author-book" onClick={() => navigate('/app', { state: { openBookId: b.id } })} style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="w-full text-left border rounded-2xl p-4 cursor-pointer hover:brightness-95 active:scale-[0.99] transition-all flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-black break-words">{b.title}</span>
                        {b.genres?.length > 0 && <span className="flex flex-wrap gap-1 mt-1.5">{b.genres.map(g => <span key={g} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }} className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase">{g}</span>)}</span>}
                        {b.description && <span style={{ color: 'var(--text-muted)' }} className="block text-xs mt-2 leading-relaxed line-clamp-2 break-words">{b.description}</span>}
                      </span>
                      <span className="flex sm:flex-col items-center sm:items-end gap-x-4 gap-y-1 text-xs font-bold shrink-0">
                        <span className="inline-flex items-center gap-1" title="Hodnocení"><Star size={12} className="fill-current text-amber-500" /> {b.ratings_count > 0 ? Number(b.avg_rating).toFixed(1) : '-'}</span>
                        <span className="inline-flex items-center gap-1" title="Líbí se"><Heart size={12} className="fill-current text-red-400" /> {b.likes}</span>
                        <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>{b.is_auto_assigned || b.price_coins === 0 ? 'Zdarma' : <><Coins size={12} className="text-amber-500" /> {b.price_coins}</>}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <LoadMore paged={pagedBooks} className="pt-4" />
            </>
          )}
        </>
      )}
    </div>
  );
};
