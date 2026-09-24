import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BookMarked, Loader2, Star, X } from 'lucide-react';

export const ReaderPage = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialScroll, setInitialScroll] = useState(0);
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('reader_font_size'), 10) || 18);
  const [bookmarks, setBookmarks] = useState([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [myRating, setMyRating] = useState(0);
  const [savingRating, setSavingRating] = useState(false);

  useEffect(() => {
    localStorage.setItem('reader_font_size', fontSize);
  }, [fontSize]);

  useEffect(() => {
    const fetchBookData = async () => {
      if (!user || !id) return;
      setLoading(true);
      try {
        const { data: bookData, error: bookErr } = await supabase
          .from('books')
          .select('*')
          .eq('id', id)
          .single();

        if (bookErr) throw bookErr;

        const { data: userBookData } = await supabase
          .from('user_books')
          .select('scroll_position, status')
          .eq('user_id', user.id)
          .eq('book_id', id)
          .maybeSingle();

        const currentUsername = user.email ? user.email.split('@')[0] : '';
        const isAuthor = bookData.author === currentUsername;
        
        if (!isAuthor && (!userBookData || userBookData.status !== 'active')) {
          alert('K tomuto dílu nemáš aktivní licenci.');
          navigate('/app');
          return;
        }

        // Samotný text knihy je v samostatné tabulce book_contents, kterou RLS
        // pustí jen vlastníkům/autorovi/adminovi - takže tenhle dotaz je ta
        // skutečná vynucovací hranice, kontrola výše je jen hezčí UX hláška.
        const [{ data: contentRow }, { data: bookmarksData }, { data: ratingData }] = await Promise.all([
          supabase.from('book_contents').select('content').eq('book_id', id).maybeSingle(),
          supabase.from('book_bookmarks').select('id, label, scroll_position, created_at').eq('user_id', user.id).eq('book_id', id).order('created_at', { ascending: false }),
          supabase.from('book_ratings').select('rating').eq('user_id', user.id).eq('book_id', id).maybeSingle()
        ]);

        setBook({ ...bookData, content: contentRow?.content || '' });
        setBookmarks(bookmarksData || []);
        setMyRating(ratingData?.rating || 0);

        if (userBookData?.scroll_position) {
          setInitialScroll(userBookData.scroll_position);
        }
      } catch (err) {
        console.error('Chyba při otevírání knihy:', err.message);
      } finally { // 🔥 OPRAVENO: Správně napsané "finally" (původně bylo "finaly")
        setLoading(false);
      }
    };

    fetchBookData();
  }, [id, user, navigate]);

  useEffect(() => {
    if (loading || !book || !user) return;

    if (initialScroll > 0) {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, (totalHeight * initialScroll) / 100);
    }

    let timeoutId;
    const handleScroll = () => {
      clearTimeout(timeoutId);
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;

      const progress = Math.min(100, Math.max(0, (scrollTop / docHeight) * 100));
      const isReadNow = progress >= 95;

      timeoutId = setTimeout(async () => {
        try {
          await supabase
            .from('user_books')
            .upsert({
              user_id: user.id,
              book_id: id,
              scroll_position: progress,
              is_read: isReadNow,
              updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,book_id' });
        } catch (err) {
          console.error('Chyba synchronizace pozice:', err);
        }
      }, 1000);
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
    };
  }, [loading, book, user, id, initialScroll]);

  const currentScrollPercent = () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    return docHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / docHeight) * 100)) : 0;
  };

  const handleAddBookmark = async () => {
    if (!user) return;
    const progress = currentScrollPercent();
    const label = prompt('Název záložky:', `Záložka na ${Math.round(progress)} %`);
    if (label === null) return;
    try {
      const { data, error } = await supabase
        .from('book_bookmarks')
        .insert([{ user_id: user.id, book_id: id, label: label.trim() || 'Záložka', scroll_position: progress }])
        .select('id, label, scroll_position, created_at')
        .single();
      if (error) throw error;
      setBookmarks(prev => [data, ...prev]);
    } catch (err) {
      alert('Nepodařilo se uložit záložku: ' + err.message);
    }
  };

  const jumpToBookmark = (bm) => {
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: (totalHeight * bm.scroll_position) / 100, behavior: 'smooth' });
    setShowBookmarks(false);
  };

  const deleteBookmark = async (bmId) => {
    try {
      await supabase.from('book_bookmarks').delete().eq('id', bmId);
      setBookmarks(prev => prev.filter(b => b.id !== bmId));
    } catch (err) {
      console.error('Nepodařilo se smazat záložku:', err);
    }
  };

  const handleRate = async (stars) => {
    if (!user || savingRating) return;
    setSavingRating(true);
    try {
      const { error } = await supabase
        .from('book_ratings')
        .upsert({ user_id: user.id, book_id: id, rating: stars, updated_at: new Date().toISOString() }, { onConflict: 'user_id,book_id' });
      if (error) throw error;
      setMyRating(stars);
    } catch (err) {
      console.error('Hodnocení se nepodařilo uložit:', err);
    } finally {
      setSavingRating(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <Loader2 className="animate-spin text-[var(--bg-primary)] mb-2" size={32} />
      <p className="text-xs font-black uppercase tracking-wider opacity-60">Načítám stránky knihy...</p>
    </div>
  );

  if (!book) return (
    <div className="text-center py-12">
      <p className="font-bold uppercase text-sm">Kniha nebyla nalezena.</p>
      <Link to="/app" className="text-xs uppercase font-black text-[var(--bg-primary)] mt-4 block">Návrat do knihovny</Link>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 space-y-6 animate-in fade-in duration-300">
      <div className="border-b pb-6 text-center" style={{ borderColor: 'var(--border-color)' }}>
        <Link to="/app" className="text-[10px] font-black uppercase tracking-wider no-underline opacity-50 hover:opacity-100 transition-all flex items-center justify-center gap-1 mb-4" style={{ color: 'var(--text-body)' }}>
          ← Zpět do knihovny
        </Link>
        <h1 className="text-3xl font-black uppercase tracking-tight m-0">{book.title}</h1>
        <p className="text-xs uppercase font-bold mt-1 opacity-60 m-0" style={{ color: 'var(--text-muted)' }}>Autor: {book.author}</p>
      </div>

      {/* ČTECÍ PANEL: velikost písma a záložky */}
      <div className="flex items-center justify-between gap-3 relative">
        <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="flex items-center gap-1 border rounded-xl p-1">
          <button onClick={() => setFontSize(f => Math.max(14, f - 1))} style={{ color: 'var(--text-body)' }} className="w-7 h-7 rounded-lg bg-transparent border-none cursor-pointer font-black text-xs flex items-center justify-center hover:bg-[var(--bg-secondary)]">A-</button>
          <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold w-8 text-center">{fontSize}px</span>
          <button onClick={() => setFontSize(f => Math.min(28, f + 1))} style={{ color: 'var(--text-body)' }} className="w-7 h-7 rounded-lg bg-transparent border-none cursor-pointer font-black text-sm flex items-center justify-center hover:bg-[var(--bg-secondary)]">A+</button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleAddBookmark}
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }}
            className="border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase cursor-pointer flex items-center gap-1.5"
          >
            <BookMarked size={12} /> Uložit místo
          </button>
          <button
            onClick={() => setShowBookmarks(v => !v)}
            style={{ borderColor: 'var(--border-color)', backgroundColor: showBookmarks ? 'var(--bg-primary)' : 'var(--bg-card)', color: showBookmarks ? 'white' : 'var(--text-body)' }}
            className="border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase cursor-pointer flex items-center gap-1.5"
          >
            Záložky {bookmarks.length > 0 && `(${bookmarks.length})`}
          </button>
        </div>

        {showBookmarks && (
          <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="absolute top-full right-0 mt-2 w-64 border rounded-xl shadow-lg z-20 p-2 max-h-64 overflow-y-auto">
            {bookmarks.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }} className="text-[11px] text-center py-3 opacity-60">Zatím žádné záložky.</p>
            ) : bookmarks.map(bm => (
              <div key={bm.id} className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-[var(--bg-secondary)]">
                <button onClick={() => jumpToBookmark(bm)} className="flex-1 text-left bg-transparent border-none cursor-pointer p-0" style={{ color: 'var(--text-body)' }}>
                  <span className="text-xs font-bold block truncate">{bm.label}</span>
                  <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-60">{Math.round(bm.scroll_position)} % knihy</span>
                </button>
                <button onClick={() => deleteBookmark(bm.id)} className="bg-transparent border-none cursor-pointer p-1 text-red-400 opacity-60 hover:opacity-100">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div 
        className="prose prose-neutral dark:prose-invert max-w-none leading-relaxed tracking-wide font-serif space-y-6"
        style={{ color: 'var(--text-body)', whiteSpace: 'pre-wrap', fontSize: `${fontSize}px` }}
      >
        {book.content || "Tato kniha zatím nemá nahraný žádný textový obsah."}
      </div>

      {/* HODNOCENÍ */}
      <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="border rounded-2xl p-5 flex flex-col items-center gap-2">
        <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-black uppercase tracking-wider m-0 opacity-70">Jak by ses ohodnotil tuhle knihu?</p>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => handleRate(n)}
              disabled={savingRating}
              className="bg-transparent border-none cursor-pointer p-1 disabled:cursor-not-allowed"
            >
              <Star size={24} className={n <= myRating ? "fill-amber-400 text-amber-400" : "text-amber-400 opacity-30"} />
            </button>
          ))}
        </div>
        {book.ratings_count > 0 && (
          <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-60">Průměr {parseFloat(book.avg_rating || 0).toFixed(1)} ⭐ ({book.ratings_count} hodnocení)</span>
        )}
      </div>
    </div>
  );
};

