import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BookDetailModal } from '../components/BookDetailModal';
import {
  BookOpen, Coins, Heart, Loader2, LogOut, ShieldOff, Sparkles, Star,
  Search, ArrowDownAZ, X, Library,
} from 'lucide-react';

const SORT_OPTIONS = [
  { key: 'smart', label: 'Doporučeno' },
  { key: 'alpha', label: 'Abecedně' },
  { key: 'rating', label: 'Nejlépe hodnocené' },
  { key: 'likes', label: 'Nejoblíbenější' },
  { key: 'price_low', label: 'Nejlevnější' },
  { key: 'price_high', label: 'Nejdražší' },
];

export const UserLibrary = () => {
  const { user, logout } = useAuth();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [coins, setCoins] = useState(0);
  const [dailyBonus, setDailyBonus] = useState(null);
  const [genreFilter, setGenreFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('smart');
  const [detailBook, setDetailBook] = useState(null);

  const getUsername = useCallback((email) => email ? email.split('@')[0] : '', []);

  const loadLibraryData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
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

      const [booksRes, userBooksRes, likesRes, allLikesRes, profileRes] = await Promise.all([
        supabase.from('books').select('*'),
        supabase.from('user_books').select('book_id, is_read, status, updated_at, scroll_position').eq('user_id', user.id),
        supabase.from('book_likes').select('book_id').eq('user_id', user.id),
        supabase.from('book_likes').select('book_id'),
        supabase.from('profiles').select('coins').eq('id', user.id).maybeSingle()
      ]);

      if (booksRes.error) throw booksRes.error;

      // POZOR: setLikedBookIds by se tu NEPROJEVIL do stejného běhu funkce (setState
      // se neaplikuje synchronně) - proto se pro isLiked níž používá tahle čerstvá
      // lokální proměnná, ne stav.
      const freshLikedIds = likesRes.data?.map(l => l.book_id) || [];
      if (profileRes.data) setCoins(profileRes.data.coins || 0);

      const currentUsername = getUsername(user.email);

      const processedBooks = (booksRes.data || []).map(singleBook => {
        const userBookEntry = userBooksRes.data?.find(ub => ub.book_id === singleBook.id);
        const totalLikesCount = (allLikesRes.data?.filter(l => l.book_id === singleBook.id).length || 0) + (singleBook.fake_likes || 0);

        const isOwner = singleBook.author === currentUsername;
        // Knihy označené jako "Automatická kniha" jsou zdarma pro všechny bez nutnosti nákupu.
        const hasAccess = isOwner || singleBook.is_auto_assigned || userBookEntry?.status === 'active';

        return {
          id: singleBook.id,
          title: singleBook.title,
          author: singleBook.author,
          likesCount: totalLikesCount,
          isLiked: freshLikedIds.includes(singleBook.id),
          avgRating: parseFloat(singleBook.avg_rating) || 0,
          ratingsCount: singleBook.ratings_count || 0,
          genres: Array.isArray(singleBook.genres) ? singleBook.genres : [],
          description: singleBook.description || '',
          priceCoins: singleBook.price_coins ?? 0,
          hasAccess,
          isOwner,
          isRead: userBookEntry?.is_read || false,
          scrollPosition: userBookEntry?.scroll_position || 0,
          lastOpened: userBookEntry?.updated_at ? new Date(userBookEntry.updated_at).getTime() : 0
        };
      });

      processedBooks.sort((a, b) => {
        if (a.hasAccess && b.hasAccess) {
          if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
          return b.lastOpened - a.lastOpened;
        }
        if (a.hasAccess !== b.hasAccess) return (b.hasAccess ? 1 : 0) - (a.hasAccess ? 1 : 0);
        // Mezi dvěma nevlastněnými knihami má smysl řadit podle obliby -
        // dřív tu žádné konzistentní pořadí nebylo (jen náhodou, jak je
        // appka zrovna dostala z DB).
        return b.likesCount - a.likesCount;
      });

      setBooks(processedBooks);
    } catch (error) {
      console.error("Chyba při načítání knihovny:", error.message);
    } finally {
      setLoading(false);
    }
  }, [user, getUsername]);

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
        alert(`Nemáš dost Jomarid Coinů. Tahle kniha stojí ${book.priceCoins}, ty máš ${coins}.`);
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

  const toggleLike = async (book) => {
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
  };

  const allGenres = useMemo(() => {
    const set = new Set();
    books.forEach(b => b.genres.forEach(g => set.add(g)));
    return Array.from(set).sort();
  }, [books]);

  // Kniha, kterou má smysl nabídnout k pokračování - vlastněná, rozečtená,
  // ale ne dočtená, naposledy otevřená jako první.
  const continueBook = useMemo(() => {
    const candidates = books.filter(b => b.hasAccess && !b.isRead && b.scrollPosition > 0);
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, b) => (b.lastOpened > latest.lastOpened ? b : latest), candidates[0]);
  }, [books]);

  const libraryStats = useMemo(() => {
    const owned = books.filter(b => b.hasAccess).length;
    const finished = books.filter(b => b.hasAccess && b.isRead).length;
    const inProgress = books.filter(b => b.hasAccess && !b.isRead && b.scrollPosition > 0).length;
    return { owned, finished, inProgress };
  }, [books]);

  const filteredBooks = useMemo(() => {
    let result = books.filter(sb => {
      if (activeFilter === 'owned' && !sb.hasAccess) return false;
      if (genreFilter !== 'all' && !sb.genres.includes(genreFilter)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        if (!sb.title.toLowerCase().includes(q) && !sb.author.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    // 'smart' zachovává pořadí, které appka už sestavila v loadLibraryData
    // (rozečtené nahoře, pak podle poslední aktivity) - jakékoliv jiné
    // řazení je explicitní volba uživatele a přebije to.
    if (sortBy === 'alpha') {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title, 'cs'));
    } else if (sortBy === 'rating') {
      result = [...result].sort((a, b) => b.avgRating - a.avgRating);
    } else if (sortBy === 'likes') {
      result = [...result].sort((a, b) => b.likesCount - a.likesCount);
    } else if (sortBy === 'price_low') {
      result = [...result].sort((a, b) => a.priceCoins - b.priceCoins);
    } else if (sortBy === 'price_high') {
      result = [...result].sort((a, b) => b.priceCoins - a.priceCoins);
    }

    return result;
  }, [books, activeFilter, genreFilter, searchQuery, sortBy]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-pulse">
      <Loader2 className="animate-spin mb-4" size={40} style={{ color: 'var(--bg-primary)' }} />
      <p className="text-sm font-black uppercase tracking-wider opacity-60">Otevírám tvůj čtenářský trezor...</p>
    </div>
  );

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-6xl mx-auto px-4 py-12 space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-6" style={{ borderColor: 'var(--border-color)' }}>
        <div>
          <span className="bg-amber-500/10 text-amber-500 text-[10px] font-black uppercase px-2.5 py-1 rounded-full border border-amber-500/20 inline-flex items-center gap-1 mb-2">
            <Sparkles size={10} /> Prémiová knihovna
          </span>
          <h2 className="text-4xl font-black uppercase tracking-tight m-0">Tvoje Knihovna</h2>
        </div>
        <button onClick={logout} style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="flex items-center gap-2 px-4 py-2.5 border rounded-xl font-bold uppercase text-xs cursor-pointer hover:bg-red-500/10 hover:text-red-500 transition-all">
          <LogOut size={14} /> Odhlásit se
        </button>
      </div>

      {/* POKRAČOVAT VE ČTENÍ - jen když je co nabídnout */}
      {continueBook && (
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-5 flex flex-col sm:flex-row items-center gap-5">
          <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="w-16 h-20 rounded-xl flex items-center justify-center shrink-0">
            <BookOpen size={24} style={{ color: 'var(--bg-primary)' }} className="opacity-70" />
          </div>
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wide opacity-60 block mb-1">Pokračovat ve čtení</span>
            <h3 className="font-black text-base uppercase tracking-tight truncate">{continueBook.title}</h3>
            <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="w-full h-1.5 rounded-full overflow-hidden mt-2 mb-1">
              <div style={{ backgroundColor: 'var(--bg-primary)', width: `${Math.round(continueBook.scrollPosition)}%` }} className="h-full rounded-full" />
            </div>
            <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-70">{Math.round(continueBook.scrollPosition)} % přečteno</span>
          </div>
          <Link to={`/read/${continueBook.id}`} className="no-underline shrink-0 w-full sm:w-auto">
            <button style={{ backgroundColor: 'var(--bg-primary)', color: 'white' }} className="w-full sm:w-auto px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider border-none cursor-pointer hover:brightness-105 transition-all flex items-center justify-center gap-2">
              <BookOpen size={14} /> Pokračovat
            </button>
          </Link>
        </div>
      )}

      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shrink-0">
            <Coins size={20} />
          </div>
          <div>
            <h4 className="font-black text-sm uppercase m-0 flex items-center gap-2">
              {coins.toLocaleString()} Jomarid Coins
            </h4>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">
              {dailyBonus ? `+${dailyBonus} mincí za dnešní přihlášení! 🎉` : 'Kup si přístup ke knihám za mince, nebo si je vydělej odznáčky.'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {['all', 'owned'].map((filter) => (
            <button key={filter} onClick={() => setActiveFilter(filter)} style={{ backgroundColor: activeFilter === filter ? 'var(--text-body)' : 'var(--bg-secondary)', color: activeFilter === filter ? 'var(--bg-body)' : 'var(--text-body)', borderColor: 'var(--border-color)' }} className="px-3 py-1.5 border rounded-xl font-black text-[10px] uppercase transition-all">
              {filter === 'all' && 'Všechny'}
              {filter === 'owned' && 'Moje Knihy'}
            </button>
          ))}
        </div>
      </div>

      {/* PŘEHLED */}
      <div className="grid grid-cols-3 gap-3">
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-xl p-3 text-center">
          <span className="font-black text-xl block tabular-nums">{libraryStats.owned}</span>
          <span style={{ color: 'var(--text-muted)' }} className="text-[9px] font-bold uppercase opacity-60">Vlastníš</span>
        </div>
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-xl p-3 text-center">
          <span className="font-black text-xl block tabular-nums">{libraryStats.inProgress}</span>
          <span style={{ color: 'var(--text-muted)' }} className="text-[9px] font-bold uppercase opacity-60">Rozečteno</span>
        </div>
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-xl p-3 text-center">
          <span className="font-black text-xl block tabular-nums">{libraryStats.finished}</span>
          <span style={{ color: 'var(--text-muted)' }} className="text-[9px] font-bold uppercase opacity-60">Dočteno</span>
        </div>
      </div>

      {/* HLEDÁNÍ + ŘAZENÍ */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 flex-1">
          <Search size={15} style={{ color: 'var(--text-muted)' }} className="opacity-50 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Hledat podle názvu nebo autora..."
            style={{ color: 'var(--text-body)' }}
            className="flex-1 bg-transparent border-none outline-none text-sm font-medium placeholder:opacity-40"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="bg-transparent border-none cursor-pointer p-0.5 opacity-50 hover:opacity-100" style={{ color: 'var(--text-body)' }}>
              <X size={14} />
            </button>
          )}
        </div>

        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-xl px-3 py-2.5 flex items-center gap-2 shrink-0">
          <ArrowDownAZ size={15} style={{ color: 'var(--text-muted)' }} className="opacity-50 shrink-0" />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{ color: 'var(--text-body)', backgroundColor: 'transparent' }}
            className="border-none outline-none text-xs font-bold cursor-pointer pr-2"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.key} value={opt.key} style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {allGenres.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setGenreFilter('all')} style={{ backgroundColor: genreFilter === 'all' ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: genreFilter === 'all' ? 'white' : 'var(--text-muted)' }} className="px-3 py-1 rounded-full font-black text-[10px] uppercase border-none cursor-pointer transition-all">
            Všechny žánry
          </button>
          {allGenres.map(g => (
            <button key={g} onClick={() => setGenreFilter(g)} style={{ backgroundColor: genreFilter === g ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: genreFilter === g ? 'white' : 'var(--text-muted)' }} className="px-3 py-1 rounded-full font-black text-[10px] uppercase border-none cursor-pointer transition-all">
              {g}
            </button>
          ))}
        </div>
      )}

      {filteredBooks.length === 0 ? (
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl py-16 flex flex-col items-center gap-3 text-center">
          <Library size={32} style={{ color: 'var(--text-muted)' }} className="opacity-30" />
          <p style={{ color: 'var(--text-muted)' }} className="text-sm font-bold opacity-70">
            {searchQuery ? `Nic neodpovídá hledání "${searchQuery}".` : 'V tomhle výběru zatím nic není.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          {filteredBooks.map(sb => {
            const showProgress = sb.hasAccess && !sb.isRead && sb.scrollPosition > 0;
            return (
              <div key={sb.id} style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border p-4 rounded-2xl flex flex-col justify-between hover:shadow-lg transition-all">
                <div>
                  <div onClick={() => setDetailBook(sb)} style={{ backgroundColor: 'var(--bg-secondary)' }} className="aspect-[3/4] rounded-xl mb-4 flex items-center justify-center relative cursor-pointer overflow-hidden">
                    {sb.hasAccess ? <BookOpen size={36} className="text-[var(--bg-primary)] opacity-60" /> : <ShieldOff size={36} className="opacity-20" />}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleLike(sb); }}
                      className="absolute top-2 right-2 border px-2 py-0.5 rounded-lg text-[10px] font-black bg-[var(--bg-card)] flex items-center gap-1 cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <Heart size={10} className={sb.isLiked ? "fill-red-500 text-red-500" : "text-red-500"} />
                      <span>{sb.likesCount}</span>
                    </button>
                    {sb.avgRating > 0 && (
                      <div className="absolute top-2 left-2 border px-2 py-0.5 rounded-lg text-[10px] font-black bg-[var(--bg-card)] flex items-center gap-1" style={{ borderColor: 'var(--border-color)' }}>
                        <Star size={10} className="fill-amber-400 text-amber-400" />
                        <span>{sb.avgRating.toFixed(1)}</span>
                      </div>
                    )}
                    {showProgress && (
                      <div style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} className="absolute bottom-0 left-0 right-0 h-1.5">
                        <div style={{ backgroundColor: 'var(--bg-primary)', width: `${Math.round(sb.scrollPosition)}%` }} className="h-full" />
                      </div>
                    )}
                  </div>
                  <h4 onClick={() => setDetailBook(sb)} className="font-black uppercase text-sm tracking-tight m-0 line-clamp-1 cursor-pointer hover:opacity-70">{sb.title}</h4>
                  <p className="text-xs font-bold opacity-60 m-0" style={{ color: 'var(--text-muted)' }}>{sb.author}</p>
                  {sb.genres.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {sb.genres.slice(0, 3).map(g => (
                        <span key={g} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }} className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded">{g}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-4">
                  {sb.hasAccess ? (
                    <Link to={`/read/${sb.id}`} className="no-underline">
                      <button style={{ backgroundColor: 'var(--text-body)', color: 'var(--bg-body)' }} className="w-full py-2.5 rounded-xl font-black text-[10px] uppercase tracking-wider border-none cursor-pointer flex items-center justify-center gap-1">
                        <BookOpen size={12} /> {sb.isRead ? 'Číst znovu' : showProgress ? 'Pokračovat' : 'Číst'}
                      </button>
                    </Link>
                  ) : (
                    <button
                      onClick={() => setDetailBook(sb)}
                      style={{ backgroundColor: coins < sb.priceCoins ? 'var(--bg-secondary)' : 'var(--bg-primary)', color: coins < sb.priceCoins ? 'var(--text-muted)' : 'white' }}
                      className="w-full py-2.5 rounded-xl font-black text-[10px] uppercase tracking-wider border-none cursor-pointer flex items-center justify-center gap-1"
                    >
                      {coins < sb.priceCoins ? (
                        <>Chybí {sb.priceCoins - coins} <Coins size={12} /></>
                      ) : (
                        <>Koupit za {sb.priceCoins} <Coins size={12} /></>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BookDetailModal
        book={detailBook}
        onClose={() => setDetailBook(null)}
        onBuy={handleBuyLicense}
        buying={detailBook ? submittingId === detailBook.id : false}
        coins={coins}
      />
    </div>
  );
};
