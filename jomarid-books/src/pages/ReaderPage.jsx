import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  BookMarked, Loader2, Star, X, Settings2, List, Minimize2, Maximize2,
  Play, Pause, Clock, ChevronRight,
} from 'lucide-react';

// ============================================================================
// Volby čtecího nastavení - všechno lokální (per zařízení), stejně jako
// dosavadní velikost písma, ukládá se do localStorage, ne do DB.
// ============================================================================
const FONT_FAMILIES = {
  serif:    { label: 'Serifové',    className: 'font-serif' },
  sans:     { label: 'Bezpatkové',  className: 'font-sans' },
  readable: { label: 'Čitelné',     className: 'font-sans tracking-wide' },
};
const LINE_HEIGHTS = {
  compact: { label: 'Kompaktní', value: 1.5 },
  normal:  { label: 'Normální',  value: 1.8 },
  airy:    { label: 'Vzdušné',   value: 2.2 },
};
const TEXT_WIDTHS = {
  narrow: { label: 'Úzký',    maxWidth: '38rem' },
  medium: { label: 'Střední', maxWidth: '48rem' },
  wide:   { label: 'Široký',  maxWidth: '60rem' },
};
// Průměrná čtecí rychlost pro odhad zbývajícího času - obecný odhad, ne
// měřeno na konkrétním uživateli.
const AVG_WORDS_PER_MINUTE = 200;

// Rozpozná nadpisy kapitol na VLASTNÍM řádku (ne uprostřed věty) - běžné
// české konvence. Když kniha žádnou takovou strukturu nemá, vrátí se
// prázdné pole a appka to bere jako zcela platný stav (žádná chyba) -
// tlačítko na obsah se pak jen nezobrazí.
const CHAPTER_LINE_REGEX = /^(kapitola|část|díl|prolog|epilog)(\s+[ivxlcdm]+|\s+\d+)?\s*[:.\-–]?\s*(.{0,50})?$/i;

function detectChapters(content) {
  if (!content) return [];
  const lines = content.split('\n');
  const chapters = [];
  let charOffset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length < 80 && CHAPTER_LINE_REGEX.test(trimmed)) {
      chapters.push({ title: trimmed, charOffset, id: `ch-${chapters.length}` });
    }
    charOffset += line.length + 1;
  }
  return chapters;
}

export const ReaderPage = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialScroll, setInitialScroll] = useState(0);
  const [liveProgress, setLiveProgress] = useState(0);

  // --- Čtecí nastavení (localStorage) ---
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('reader_font_size'), 10) || 18);
  const [fontFamilyKey, setFontFamilyKey] = useState(() => localStorage.getItem('reader_font_family') || 'serif');
  const [lineHeightKey, setLineHeightKey] = useState(() => localStorage.getItem('reader_line_height') || 'normal');
  const [textWidthKey, setTextWidthKey] = useState(() => localStorage.getItem('reader_text_width') || 'medium');
  const [paperMode, setPaperMode] = useState(() => localStorage.getItem('reader_paper_mode') === '1');

  // --- Panely a režimy ---
  const [showSettings, setShowSettings] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(() => parseInt(localStorage.getItem('reader_autoscroll_speed'), 10) || 40);

  const [bookmarks, setBookmarks] = useState([]);
  const [myRating, setMyRating] = useState(0);
  const [savingRating, setSavingRating] = useState(false);

  // Jakmile je kniha jednou označená jako přečtená, další scrollování zpátky
  // (např. dohledání dřívější kapitoly - běžné chování, ne cheat) ji nesmí
  // "odznačit". Bez týhle pojistky by debounced ukládání níž při každém
  // scrollu přepsalo is_read podle AKTUÁLNÍ pozice, i zpátky na false.
  const hasBeenMarkedReadRef = useRef(false);
  const autoScrollRafRef = useRef(null);
  const toolbarRef = useRef(null);

  // --- Perzistence čtecího nastavení ---
  useEffect(() => { localStorage.setItem('reader_font_size', fontSize); }, [fontSize]);
  useEffect(() => { localStorage.setItem('reader_font_family', fontFamilyKey); }, [fontFamilyKey]);
  useEffect(() => { localStorage.setItem('reader_line_height', lineHeightKey); }, [lineHeightKey]);
  useEffect(() => { localStorage.setItem('reader_text_width', textWidthKey); }, [textWidthKey]);
  useEffect(() => { localStorage.setItem('reader_paper_mode', paperMode ? '1' : '0'); }, [paperMode]);
  useEffect(() => { localStorage.setItem('reader_autoscroll_speed', autoScrollSpeed); }, [autoScrollSpeed]);

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
          .select('scroll_position, status, is_read')
          .eq('user_id', user.id)
          .eq('book_id', id)
          .maybeSingle();

        hasBeenMarkedReadRef.current = !!userBookData?.is_read;

        const currentUsername = user.email ? user.email.split('@')[0] : '';
        const isAuthor = bookData.author === currentUsername;
        const hasAccess = isAuthor || bookData.is_auto_assigned || userBookData?.status === 'active';

        if (!hasAccess) {
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
          setLiveProgress(userBookData.scroll_position);
        }
      } catch (err) {
        console.error('Chyba při otevírání knihy:', err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchBookData();
  }, [id, user, navigate]);

  // --- Kapitoly - počítáno jen jednou po načtení textu, ne na každém renderu ---
  const chapters = useMemo(() => detectChapters(book?.content), [book?.content]);

  // --- Počet slov a odhad zbývajícího času ---
  const wordCount = useMemo(() => {
    if (!book?.content) return 0;
    const trimmed = book.content.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [book?.content]);

  const remainingMinutes = useMemo(() => {
    if (wordCount === 0) return 0;
    const remainingWords = Math.round(wordCount * (1 - liveProgress / 100));
    return Math.max(1, Math.round(remainingWords / AVG_WORDS_PER_MINUTE));
  }, [wordCount, liveProgress]);

  useEffect(() => {
    if (loading || !book || !user) return;

    if (initialScroll > 0) {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, (totalHeight * initialScroll) / 100);
    }

    let timeoutId;
    const handleScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;

      const progress = Math.min(100, Math.max(0, (scrollTop / docHeight) * 100));
      setLiveProgress(progress);
      if (progress >= 95) hasBeenMarkedReadRef.current = true;
      const isReadNow = hasBeenMarkedReadRef.current;

      clearTimeout(timeoutId);
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

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
    };
  }, [loading, book, user, id, initialScroll]);

  // --- Klik mimo celý čtecí panel (tlačítka i otevřené panely dohromady)
  // zavře jakýkoliv otevřený panel - jinak by zůstal viset nad textem, dokud
  // by uživatel netrefil přesně to samé tlačítko. Kontroluje se proti CELÉMU
  // panelu (tlačítka + panely společně), ne jen samotnému panelu - jinak by
  // klik na přepínací tlačítko sám sebe vyhodnotil jako "mimo" a panel by se
  // po zavření vteřinu nato hned zase otevřel (mousedown běží před click).
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        setShowSettings(false);
        setShowToc(false);
        setShowBookmarks(false);
      }
    };
    if (showSettings || showToc || showBookmarks) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSettings, showToc, showBookmarks]);

  const currentScrollPercent = useCallback(() => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    return docHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / docHeight) * 100)) : 0;
  }, []);

  const handleAddBookmark = useCallback(async () => {
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
  }, [user, id, currentScrollPercent]);

  const jumpToPercent = useCallback((percent) => {
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: (totalHeight * percent) / 100, behavior: 'smooth' });
  }, []);

  const jumpToBookmark = (bm) => {
    jumpToPercent(bm.scroll_position);
    setShowBookmarks(false);
  };

  const jumpToChapter = (chapter) => {
    if (!book?.content) return;
    const percent = (chapter.charOffset / book.content.length) * 100;
    jumpToPercent(percent);
    setShowToc(false);
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

  // --- Klávesové zkratky: mezerník/šipky pro stránkování, B pro záložku,
  // F pro fokus režim, Esc pro jeho opuštění. Vypnuto, když se zrovna píše
  // do libovolného vstupního pole (např. by jinak "b" v textu záložky
  // spustilo další záložku).
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;

      if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'PageDown') {
        e.preventDefault();
        window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
      } else if (e.code === 'ArrowUp' || e.code === 'PageUp') {
        e.preventDefault();
        window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
      } else if (e.key === 'b' || e.key === 'B') {
        handleAddBookmark();
      } else if (e.key === 'f' || e.key === 'F') {
        setFocusMode(v => !v);
      } else if (e.key === 'Escape' && focusMode) {
        setFocusMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusMode, handleAddBookmark]);

  // --- Automatické plynulé posouvání. Jakékoliv ruční zapojení (kolečko myši,
  // dotyk, šipky) ho samo pozastaví - ať uživatel nikdy nebojuje s appkou
  // o to, kdo právě posouvá stránku.
  useEffect(() => {
    if (!autoScroll) return;

    let lastTime = performance.now();
    const step = (now) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      window.scrollBy(0, autoScrollSpeed * dt);
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (window.scrollY >= docHeight - 4) {
        setAutoScroll(false);
        return;
      }
      autoScrollRafRef.current = requestAnimationFrame(step);
    };
    autoScrollRafRef.current = requestAnimationFrame(step);

    const pauseOnManualInput = () => setAutoScroll(false);
    window.addEventListener('wheel', pauseOnManualInput, { passive: true });
    window.addEventListener('touchstart', pauseOnManualInput, { passive: true });

    return () => {
      if (autoScrollRafRef.current) cancelAnimationFrame(autoScrollRafRef.current);
      window.removeEventListener('wheel', pauseOnManualInput);
      window.removeEventListener('touchstart', pauseOnManualInput);
    };
  }, [autoScroll, autoScrollSpeed]);

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

  const fontFamily = FONT_FAMILIES[fontFamilyKey] || FONT_FAMILIES.serif;
  const lineHeight = LINE_HEIGHTS[lineHeightKey] || LINE_HEIGHTS.normal;
  const textWidth = TEXT_WIDTHS[textWidthKey] || TEXT_WIDTHS.medium;
  const readingBg = paperMode ? '#f4ecd8' : 'var(--bg-body)';
  const readingText = paperMode ? '#3b2f1e' : 'var(--text-body)';

  return (
    <div style={{ backgroundColor: readingBg, minHeight: '100vh' }} className="transition-colors duration-200">

      {/* Tenký pruh živého postupu čtení - vždy vidět, i ve fokus režimu */}
      <div style={{ backgroundColor: 'var(--border-color)' }} className="fixed top-0 left-0 right-0 h-1 z-40">
        <div style={{ backgroundColor: 'var(--bg-primary)', width: `${liveProgress}%` }} className="h-full transition-all duration-150" />
      </div>

      {focusMode && (
        <button
          onClick={() => setFocusMode(false)}
          title="Opustit fokus režim (Esc)"
          style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
          className="fixed top-4 right-4 z-40 w-9 h-9 rounded-xl border cursor-pointer flex items-center justify-center shadow-md backdrop-blur-sm"
        >
          <Minimize2 size={16} />
        </button>
      )}

      <div
        style={{ maxWidth: focusMode ? textWidth.maxWidth : '42rem' }}
        className="mx-auto px-4 py-16 space-y-6 animate-in fade-in duration-300"
      >
        {!focusMode && (
          <>
            <div className="border-b pb-6 text-center" style={{ borderColor: 'var(--border-color)' }}>
              <Link to="/app" className="text-[10px] font-black uppercase tracking-wider no-underline opacity-50 hover:opacity-100 transition-all flex items-center justify-center gap-1 mb-4" style={{ color: readingText }}>
                ← Zpět do knihovny
              </Link>
              <h1 style={{ color: readingText }} className="text-3xl font-black uppercase tracking-tight m-0">{book.title}</h1>
              <p className="text-xs uppercase font-bold mt-1 opacity-60 m-0" style={{ color: 'var(--text-muted)' }}>Autor: {book.author}</p>
              <p style={{ color: 'var(--text-muted)' }} className="text-[11px] mt-2 opacity-70 flex items-center justify-center gap-1.5">
                <Clock size={11} /> {Math.round(liveProgress)} % přečteno · zbývá přibližně {remainingMinutes} min
              </p>
            </div>

            {/* ČTECÍ PANEL */}
            <div ref={toolbarRef} className="flex items-center justify-between gap-2 relative flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowSettings(v => !v)}
                  style={{ borderColor: 'var(--border-color)', backgroundColor: showSettings ? 'var(--bg-primary)' : 'var(--bg-card)', color: showSettings ? 'white' : 'var(--text-body)' }}
                  className="border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase cursor-pointer flex items-center gap-1.5"
                >
                  <Settings2 size={12} /> Vzhled
                </button>

                {chapters.length > 0 && (
                  <button
                    onClick={() => setShowToc(v => !v)}
                    style={{ borderColor: 'var(--border-color)', backgroundColor: showToc ? 'var(--bg-primary)' : 'var(--bg-card)', color: showToc ? 'white' : 'var(--text-body)' }}
                    className="border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase cursor-pointer flex items-center gap-1.5"
                  >
                    <List size={12} /> Obsah ({chapters.length})
                  </button>
                )}

                <button
                  onClick={() => setAutoScroll(v => !v)}
                  style={{ borderColor: 'var(--border-color)', backgroundColor: autoScroll ? 'var(--bg-primary)' : 'var(--bg-card)', color: autoScroll ? 'white' : 'var(--text-body)' }}
                  className="border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase cursor-pointer flex items-center gap-1.5"
                  title="Automatické plynulé posouvání"
                >
                  {autoScroll ? <Pause size={12} /> : <Play size={12} />} Auto
                </button>

                <button
                  onClick={() => setFocusMode(true)}
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }}
                  className="border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase cursor-pointer flex items-center gap-1.5"
                  title="Fokus režim (F)"
                >
                  <Maximize2 size={12} /> Fokus
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddBookmark}
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }}
                  className="border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase cursor-pointer flex items-center gap-1.5"
                  title="Uložit místo (B)"
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

              {/* PANEL: NASTAVENÍ VZHLEDU */}
              {showSettings && (
                <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="absolute top-full left-0 mt-2 w-80 max-w-[90vw] border rounded-xl shadow-lg z-20 p-4 space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider">Velikost písma</span>
                      <span style={{ color: 'var(--text-body)' }} className="text-[10px] font-bold">{fontSize}px</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setFontSize(f => Math.max(14, f - 1))} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="w-8 h-8 rounded-lg border-none cursor-pointer font-black text-xs">A-</button>
                      <input type="range" min={14} max={28} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="flex-1" style={{ accentColor: 'var(--bg-primary)' }} />
                      <button onClick={() => setFontSize(f => Math.min(28, f + 1))} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="w-8 h-8 rounded-lg border-none cursor-pointer font-black text-sm">A+</button>
                    </div>
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block mb-2">Písmo</span>
                    <div className="flex gap-1.5">
                      {Object.entries(FONT_FAMILIES).map(([key, val]) => (
                        <button key={key} onClick={() => setFontFamilyKey(key)} style={{ backgroundColor: fontFamilyKey === key ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: fontFamilyKey === key ? 'white' : 'var(--text-body)' }} className="flex-1 py-1.5 rounded-lg border-none cursor-pointer text-[10px] font-bold">
                          {val.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block mb-2">Řádkování</span>
                    <div className="flex gap-1.5">
                      {Object.entries(LINE_HEIGHTS).map(([key, val]) => (
                        <button key={key} onClick={() => setLineHeightKey(key)} style={{ backgroundColor: lineHeightKey === key ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: lineHeightKey === key ? 'white' : 'var(--text-body)' }} className="flex-1 py-1.5 rounded-lg border-none cursor-pointer text-[10px] font-bold">
                          {val.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block mb-2">Šířka textu</span>
                    <div className="flex gap-1.5">
                      {Object.entries(TEXT_WIDTHS).map(([key, val]) => (
                        <button key={key} onClick={() => setTextWidthKey(key)} style={{ backgroundColor: textWidthKey === key ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: textWidthKey === key ? 'white' : 'var(--text-body)' }} className="flex-1 py-1.5 rounded-lg border-none cursor-pointer text-[10px] font-bold">
                          {val.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider">Papírový režim</span>
                    <button onClick={() => setPaperMode(v => !v)} style={{ backgroundColor: paperMode ? '#8b6f3e' : 'var(--bg-secondary)', color: paperMode ? 'white' : 'var(--text-body)' }} className="px-3 py-1.5 rounded-lg border-none cursor-pointer text-[10px] font-bold">
                      {paperMode ? 'Zapnuto' : 'Vypnuto'}
                    </button>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider">Rychlost auto-posouvání</span>
                      {autoScroll && <span style={{ color: 'var(--bg-primary)' }} className="text-[10px] font-bold">● aktivní</span>}
                    </div>
                    <input type="range" min={15} max={120} value={autoScrollSpeed} onChange={e => setAutoScrollSpeed(Number(e.target.value))} className="w-full" style={{ accentColor: 'var(--bg-primary)' }} />
                  </div>
                </div>
              )}

              {/* PANEL: OBSAH (KAPITOLY) */}
              {showToc && chapters.length > 0 && (
                <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="absolute top-full left-0 mt-2 w-72 max-w-[90vw] border rounded-xl shadow-lg z-20 p-2 max-h-72 overflow-y-auto">
                  {chapters.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => jumpToChapter(ch)}
                      className="w-full text-left flex items-center justify-between gap-2 p-2.5 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer bg-transparent border-none"
                      style={{ color: 'var(--text-body)' }}
                    >
                      <span className="text-xs font-bold truncate">{ch.title}</span>
                      <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} className="shrink-0 opacity-50" />
                    </button>
                  ))}
                </div>
              )}

              {/* PANEL: ZÁLOŽKY */}
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
          </>
        )}

        <div
          className={`prose prose-neutral dark:prose-invert max-w-none tracking-wide space-y-6 ${fontFamily.className}`}
          style={{ color: readingText, whiteSpace: 'pre-wrap', fontSize: `${fontSize}px`, lineHeight: lineHeight.value }}
        >
          {book.content || "Tato kniha zatím nemá nahraný žádný textový obsah."}
        </div>

        {!focusMode && (
          <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="border rounded-2xl p-5 flex flex-col items-center gap-2">
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-black uppercase tracking-wider m-0 opacity-70">Jak by ses ohodnotil tuhle knihu?</p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => handleRate(n)} disabled={savingRating} className="bg-transparent border-none cursor-pointer p-1 disabled:cursor-not-allowed">
                  <Star size={24} className={n <= myRating ? "fill-amber-400 text-amber-400" : "text-amber-400 opacity-30"} />
                </button>
              ))}
            </div>
            {book.ratings_count > 0 && (
              <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-60">Průměr {parseFloat(book.avg_rating || 0).toFixed(1)} ⭐ ({book.ratings_count} hodnocení)</span>
            )}
          </div>
        )}

        {!focusMode && (
          <p style={{ color: 'var(--text-muted)' }} className="text-center text-[10px] opacity-40">
            Zkratky: mezerník/šipky pro stránkování · B pro záložku · F pro fokus režim
          </p>
        )}
      </div>
    </div>
  );
};
