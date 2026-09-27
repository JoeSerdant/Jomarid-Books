import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  BookMarked, Loader2, Star, X, Settings2, List, Minimize2, Maximize2,
  Play, Pause, Clock, ChevronRight, ChevronLeft, Highlighter, Trash2,
} from 'lucide-react';

// ============================================================================
// Čtecí nastavení - beze změny oproti dřívější verzi, pořád localStorage.
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
  narrow: { label: 'Úzký',    ratio: 0.62 },
  medium: { label: 'Střední', ratio: 0.72 },
  wide:   { label: 'Široký',  ratio: 0.82 },
};
const AVG_WORDS_PER_MINUTE = 200;

const HIGHLIGHT_COLORS = {
  amber:   { label: 'Žlutá',   bg: 'rgba(245, 158, 11, 0.35)' },
  green:   { label: 'Zelená',  bg: 'rgba(16, 185, 129, 0.35)' },
  blue:    { label: 'Modrá',   bg: 'rgba(59, 130, 246, 0.35)' },
  pink:    { label: 'Růžová',  bg: 'rgba(236, 72, 153, 0.35)' },
};

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

// Rozdělí text na střídavá "obyčejný text" / "zvýrazněný text" (mark) pole,
// podle absolutních pozic v PŮVODNÍM textu. Nezávislé na tom, jak se text
// zrovna stránkuje - zvýraznění je vždy vázané na ZÁKLADNÍ obsah, ne na
// vizuální rozložení. Přesahující zvýraznění (kdyby k tomu nějak došlo) se
// ořežou tak, aby nikdy nevznikla duplicita ani mezera v rekonstruovaném textu.
function splitContentWithHighlights(content, highlights) {
  if (!highlights || highlights.length === 0) return [{ type: 'text', text: content, key: 't-0' }];
  const sorted = [...highlights].sort((a, b) => a.start_offset - b.start_offset);
  const segments = [];
  let cursor = 0;
  sorted.forEach((h, idx) => {
    const start = Math.max(h.start_offset, cursor);
    if (start >= h.end_offset) return;
    if (start > cursor) {
      segments.push({ type: 'text', text: content.slice(cursor, start), key: `t-${idx}` });
    }
    segments.push({ type: 'highlight', text: content.slice(start, h.end_offset), id: h.id, color: h.color, note: h.note, key: `h-${h.id}` });
    cursor = h.end_offset;
  });
  if (cursor < content.length) {
    segments.push({ type: 'text', text: content.slice(cursor), key: 't-last' });
  }
  return segments;
}

// Spočítá hranice stránek (jako pole {start, end} - index do PŮVODNÍHO
// textu) tak, že se skutečně změří ve skryté kopii stejné šířky/písma/
// řádkování jako viditelná stránka, kolik znaků se do jedné výšky stránky
// vejde. Nezávisí na tom, jak přesně prohlížeč počítá CSS sloupce - to se
// ukázalo být křehké (dvakrát za sebou se to rozešlo s tím, co appka čekala,
// že se zobrazuje) - tady appka sama binárně hledá přesný zlom, takže žádná
// nesrovnalost mezi "kolik stránek appka myslí, že existuje" a tím, co se
// doopravdy vykreslí, nemůže vzniknout.
function computePageBoundaries(content, measureNode, pageHeight) {
  if (!content || !measureNode || pageHeight <= 0) return [{ start: 0, end: content?.length || 0 }];
  const totalLen = content.length;
  const pages = [];
  let start = 0;
  let estimate = 1500;

  const fits = (end) => {
    measureNode.textContent = content.slice(start, end);
    return measureNode.scrollHeight <= pageHeight;
  };

  let guard = 0;
  while (start < totalLen && guard++ < 5000) {
    if (fits(totalLen)) {
      pages.push({ start, end: totalLen });
      break;
    }

    let hi = Math.min(totalLen, start + Math.max(50, estimate));
    while (hi < totalLen && fits(hi)) {
      hi = Math.min(totalLen, hi + Math.max(50, estimate));
    }
    let lo = start + 1;
    let best = lo;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    // Nelámat uprostřed slova, pokud to jde - couvnout k poslednímu mezerníku.
    let boundary = best;
    if (boundary < totalLen) {
      const lastSpace = content.lastIndexOf(' ', boundary);
      if (lastSpace > start) boundary = lastSpace + 1;
    }
    if (boundary <= start) boundary = best; // pojistka proti nekonečné smyčce u extrémně dlouhého "slova"

    pages.push({ start, end: boundary });
    estimate = Math.max(200, boundary - start);
    start = boundary;
  }

  return pages.length > 0 ? pages : [{ start: 0, end: totalLen }];
}

// Spočítá absolutní pozici v PŮVODNÍM textu z DOM uzlu + offsetu uvnitř něj -
// funguje bez ohledu na to, kolik <mark> prvků mezi tím leží (projde všechny
// textové uzly ve struktuře a sečte jejich délky před cílovým uzlem).
function computeAbsoluteOffset(root, targetNode, targetOffset) {
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return total + targetOffset;
    total += node.textContent.length;
  }
  return total;
}


export const ReaderPage = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialScroll, setInitialScroll] = useState(0);
  const [liveProgress, setLiveProgress] = useState(0);

  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('reader_font_size'), 10) || 18);
  const [fontFamilyKey, setFontFamilyKey] = useState(() => localStorage.getItem('reader_font_family') || 'serif');
  const [lineHeightKey, setLineHeightKey] = useState(() => localStorage.getItem('reader_line_height') || 'normal');
  const [textWidthKey, setTextWidthKey] = useState(() => localStorage.getItem('reader_text_width') || 'medium');
  const [paperMode, setPaperMode] = useState(() => localStorage.getItem('reader_paper_mode') === '1');

  const [showSettings, setShowSettings] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [autoAdvanceSeconds, setAutoAdvanceSeconds] = useState(() => parseInt(localStorage.getItem('reader_autoadvance_secs'), 10) || 25);

  const [bookmarks, setBookmarks] = useState([]);
  const [myRating, setMyRating] = useState(0);
  const [savingRating, setSavingRating] = useState(false);

  const [highlights, setHighlights] = useState([]);
  const [pendingSelection, setPendingSelection] = useState(null); // { start, end, x, y }
  const [activeHighlight, setActiveHighlight] = useState(null); // highlight being viewed/edited
  const [noteDraft, setNoteDraft] = useState('');

  const [currentPage, setCurrentPage] = useState(1);

  const hasBeenMarkedReadRef = useRef(false);
  const hadExistingRowRef = useRef(false);
  const autoAdvanceRef = useRef(null);
  const toolbarRef = useRef(null);
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const touchStartRef = useRef(null);
  const suppressTapRef = useRef(false);
  const pendingSaveRef = useRef(null);

  useEffect(() => { localStorage.setItem('reader_font_size', fontSize); }, [fontSize]);
  useEffect(() => { localStorage.setItem('reader_font_family', fontFamilyKey); }, [fontFamilyKey]);
  useEffect(() => { localStorage.setItem('reader_line_height', lineHeightKey); }, [lineHeightKey]);
  useEffect(() => { localStorage.setItem('reader_text_width', textWidthKey); }, [textWidthKey]);
  useEffect(() => { localStorage.setItem('reader_paper_mode', paperMode ? '1' : '0'); }, [paperMode]);
  useEffect(() => { localStorage.setItem('reader_autoadvance_secs', autoAdvanceSeconds); }, [autoAdvanceSeconds]);

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
        hadExistingRowRef.current = !!userBookData;

        const isAuthor = bookData.author_id === user.id;
        const hasAccess = isAuthor || bookData.is_auto_assigned || userBookData?.status === 'active';

        if (!hasAccess) {
          alert('K tomuto dílu nemáš aktivní licenci.');
          navigate('/app');
          return;
        }

        const [{ data: contentRow }, { data: bookmarksData }, { data: ratingData }, { data: highlightsData }] = await Promise.all([
          supabase.from('book_contents').select('content').eq('book_id', id).maybeSingle(),
          supabase.from('book_bookmarks').select('id, label, scroll_position, created_at').eq('user_id', user.id).eq('book_id', id).order('created_at', { ascending: false }),
          supabase.from('book_ratings').select('rating').eq('user_id', user.id).eq('book_id', id).maybeSingle(),
          supabase.from('book_highlights').select('id, start_offset, end_offset, color, note').eq('user_id', user.id).eq('book_id', id).order('start_offset', { ascending: true }),
        ]);

        setBook({ ...bookData, content: contentRow?.content || '' });
        setBookmarks(bookmarksData || []);
        setMyRating(ratingData?.rating || 0);
        setHighlights(highlightsData || []);

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

  const chapters = useMemo(() => detectChapters(book?.content), [book?.content]);

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

  // --- Stránkování: appka sama změří ve skryté kopii (stejná šířka, písmo,
  // řádkování jako viditelná stránka), kolik znaků se do jedné výšky vejde,
  // a podle toho spočítá přesné hranice VŠECH stránek předem. Oproti CSS
  // sloupcům (dvakrát se to rozešlo s tím, co appka myslela, že je vidět)
  // tohle appka sama plně řídí - vždycky se vykresluje jen přesně JEDNA
  // stránka, nic jiného v DOM ani neexistuje, takže nemá co "prokouknout".
  const [pages, setPages] = useState([{ start: 0, end: 0 }]);
  const [paginating, setPaginating] = useState(false);
  const measureRef = useRef(null);
  const totalPages = pages.length;

  const recomputePages = useCallback(() => {
    const container = containerRef.current;
    const measureNode = measureRef.current;
    if (!container || !measureNode || !book?.content) return;
    const innerWidth = container.clientWidth - 48; // odpovídá 24px+24px vnitřnímu odsazení stránky
    const innerHeight = container.clientHeight - 56; // odpovídá 28px+28px
    if (innerWidth <= 0 || innerHeight <= 0) return;

    setPaginating(true);
    measureNode.style.width = `${innerWidth}px`;
    // Necháme prohlížeč nejdřív doopravdy vykreslit novou šířku měřicího uzlu,
    // než na něm začneme měřit - jinak by první měření mohlo číst starou šířku.
    requestAnimationFrame(() => {
      const newPages = computePageBoundaries(book.content, measureNode, innerHeight);
      setPages(newPages);
      setPaginating(false);
    });
  }, [book?.content]);

  useLayoutEffect(() => {
    if (loading || !book) return;
    recomputePages();
    const ro = new ResizeObserver(() => recomputePages());
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', recomputePages);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recomputePages);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, book, fontSize, fontFamilyKey, lineHeightKey, textWidthKey, focusMode]);

  // Po přepočtu (např. po změně velikosti písma) se appka snaží zůstat na
  // ZHRUBA stejném místě v textu (podle procenta), ne nutně na stejné
  // stránce - přesně tak, jak se chovají i skutečné čtečky.
  const lastPercentRef = useRef(0);
  useEffect(() => { lastPercentRef.current = liveProgress; }, [liveProgress]);
  const didSetInitialRef = useRef(false);
  useEffect(() => {
    if (pages.length <= 1 && pages[0]?.end === 0) return; // ještě nedopočítáno
    const targetPercent = didSetInitialRef.current ? lastPercentRef.current : initialScroll;
    didSetInitialRef.current = true;
    const targetOffset = (targetPercent / 100) * (book?.content?.length || 0);
    let pageIdx = pages.findIndex(p => targetOffset >= p.start && targetOffset < p.end);
    if (pageIdx === -1) pageIdx = targetPercent >= 100 ? pages.length - 1 : 0;
    setCurrentPage(pageIdx + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const persistPosition = useCallback((percent, isReadNow) => {
    if (!user || !id) return;
    clearTimeout(pendingSaveRef.current);
    pendingSaveRef.current = setTimeout(async () => {
      try {
        const payload = {
          user_id: user.id,
          book_id: id,
          scroll_position: percent,
          is_read: isReadNow,
          updated_at: new Date().toISOString()
        };
        // 'status' se posílá VÝSLOVNĚ jen při úplně prvním uložení pro tuhle
        // dvojici uživatel+kniha (kdy žádný řádek ještě neexistoval - tedy
        // tenhle upsert bude INSERT, ne UPDATE). Přístup už byl ověřen výš
        // (hasAccess), takže 'active' je tu správně. Při KAŽDÉM DALŠÍM uložení
        // (řádek už existuje) se 'status' vůbec neposílá - jinak by tenhle
        // upsert mohl tiše "obživit" i řádek, kterému mezitím admin práva
        // odebral (např. je pořád otevřená čtečka v jiné záložce) tím, že by
        // mu status při každém scrollu znovu přepsal zpátky na 'active'.
        if (!hadExistingRowRef.current) {
          payload.status = 'active';
        }
        await supabase
          .from('user_books')
          .upsert(payload, { onConflict: 'user_id,book_id' });
        hadExistingRowRef.current = true;
      } catch (err) {
        console.error('Chyba synchronizace pozice:', err);
      }
    }, 1000);
  }, [user, id]);

  // Aktuální procento se odvozuje ze ZAČÁTKU aktuální stránky (jako podíl
  // celého textu) - stejná 0-100 škála, jakou appka používala i dřív u
  // scrollování, takže žádná změna DB schématu není potřeba.
  useEffect(() => {
    if (!book?.content || pages.length === 0) return;
    const page = pages[currentPage - 1];
    if (!page) return;
    const percent = book.content.length > 0 ? Math.min(100, (page.start / book.content.length) * 100) : 0;
    setLiveProgress(percent);
    if (currentPage >= totalPages) hasBeenMarkedReadRef.current = true;
    persistPosition(percent, hasBeenMarkedReadRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pages]);

  const goToPage = useCallback((pageNum) => {
    setCurrentPage(p => Math.min(totalPages, Math.max(1, pageNum)));
  }, [totalPages]);

  const nextPage = useCallback(() => goToPage(currentPage + 1), [goToPage, currentPage]);
  const prevPage = useCallback(() => goToPage(currentPage - 1), [goToPage, currentPage]);

  const goToPercent = useCallback((percent) => {
    if (!book?.content) return;
    const targetOffset = (percent / 100) * book.content.length;
    let pageIdx = pages.findIndex(p => targetOffset >= p.start && targetOffset < p.end);
    if (pageIdx === -1) pageIdx = percent >= 100 ? pages.length - 1 : 0;
    setCurrentPage(pageIdx + 1);
  }, [book?.content, pages]);

  const currentScrollPercent = useCallback(() => liveProgress, [liveProgress]);

  // Jen text AKTUÁLNÍ stránky - nic jiného v DOM vůbec neexistuje, takže
  // nemá co "vykukovat" na krajích. Zvýraznění se posunou vůči začátku
  // téhle konkrétní stránky, ne vůči celé knize.
  const currentPageRange = pages[currentPage - 1] || { start: 0, end: 0 };
  const pageText = book?.content ? book.content.slice(currentPageRange.start, currentPageRange.end) : '';
  const pageHighlights = useMemo(
    () => highlights
      .filter(h => h.start_offset < currentPageRange.end && h.end_offset > currentPageRange.start)
      .map(h => ({
        ...h,
        start_offset: Math.max(0, h.start_offset - currentPageRange.start),
        end_offset: Math.min(pageText.length, h.end_offset - currentPageRange.start),
      })),
    [highlights, currentPageRange.start, currentPageRange.end, pageText.length]
  );
  const contentSegments = useMemo(
    () => pageText ? splitContentWithHighlights(pageText, pageHighlights) : [],
    [pageText, pageHighlights]
  );

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

  const jumpToBookmark = (bm) => {
    goToPercent(bm.scroll_position);
    setShowBookmarks(false);
  };

  const jumpToChapter = (chapter) => {
    if (!book?.content) return;
    const percent = (chapter.charOffset / book.content.length) * 100;
    goToPercent(percent);
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

  // --- Zvýrazňování: klasický výběr textu (tažením myší, nebo podržením a
  // tažením prstem) - stejné gesto, jaké lidé znají odjinud, a záměrně JINÉ
  // gesto než prosté ťuknutí (to listuje stránkami, viz níže), takže se
  // spolu nikdy neperou.
  useEffect(() => {
    const handleSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const content = contentRef.current;
      if (!content || !content.contains(range.commonAncestorContainer)) return;

      const localStart = computeAbsoluteOffset(content, range.startContainer, range.startOffset);
      const localEnd = computeAbsoluteOffset(content, range.endContainer, range.endOffset);
      if (localEnd <= localStart) return;
      const start = currentPageRange.start + localStart;
      const end = currentPageRange.start + localEnd;

      // Nedovolí zvýraznění přes existující - jednodušší a bezpečnější, než
      // se pokoušet je automaticky slučovat či prořezávat.
      const overlaps = highlights.some(h => start < h.end_offset && end > h.start_offset);
      if (overlaps) return;

      const rect = range.getBoundingClientRect();
      suppressTapRef.current = true;
      setPendingSelection({ start, end, x: rect.left + rect.width / 2, y: rect.top });
    };
    document.addEventListener('selectionchange', handleSelection);
    return () => document.removeEventListener('selectionchange', handleSelection);
  }, [highlights, currentPageRange.start]);

  const saveHighlight = async (color) => {
    if (!pendingSelection || !user) return;
    try {
      const { data, error } = await supabase
        .from('book_highlights')
        .insert([{ user_id: user.id, book_id: id, start_offset: pendingSelection.start, end_offset: pendingSelection.end, color }])
        .select('id, start_offset, end_offset, color, note')
        .single();
      if (error) throw error;
      setHighlights(prev => [...prev, data].sort((a, b) => a.start_offset - b.start_offset));
      setPendingSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      alert('Zvýraznění se nepodařilo uložit: ' + err.message);
    }
  };

  const saveNote = async () => {
    if (!activeHighlight) return;
    try {
      const trimmed = noteDraft.trim().slice(0, 500);
      const { error } = await supabase.from('book_highlights').update({ note: trimmed || null }).eq('id', activeHighlight.id);
      if (error) throw error;
      setHighlights(prev => prev.map(h => h.id === activeHighlight.id ? { ...h, note: trimmed || null } : h));
      setActiveHighlight(null);
    } catch (err) {
      alert('Poznámku se nepodařilo uložit: ' + err.message);
    }
  };

  const deleteHighlight = async (highlightId) => {
    try {
      await supabase.from('book_highlights').delete().eq('id', highlightId);
      setHighlights(prev => prev.filter(h => h.id !== highlightId));
      setActiveHighlight(null);
    } catch (err) {
      console.error('Zvýraznění se nepodařilo smazat:', err);
    }
  };

  // --- Klávesové zkratky: mezerník/šipky teď listují STRÁNKAMI (ne plynulým
  // posunem), B pro záložku, F pro fokus, Esc pro jeho opuštění.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;

      if (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'PageDown') {
        e.preventDefault();
        nextPage();
      } else if (e.code === 'ArrowLeft' || e.code === 'PageUp') {
        e.preventDefault();
        prevPage();
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
  }, [focusMode, handleAddBookmark, nextPage, prevPage]);

  // --- Automatické listování stránek. Jakýkoliv ruční zásah (dotyk, kolečko,
  // šipka) ho sám pozastaví.
  useEffect(() => {
    if (!autoAdvance) return;
    autoAdvanceRef.current = setInterval(() => {
      setCurrentPage(p => {
        if (p >= totalPages) { setAutoAdvance(false); return p; }
        goToPage(p + 1);
        return p + 1;
      });
    }, autoAdvanceSeconds * 1000);

    const pause = () => setAutoAdvance(false);
    window.addEventListener('wheel', pause, { passive: true });
    window.addEventListener('touchstart', pause, { passive: true });
    window.addEventListener('keydown', pause);

    return () => {
      clearInterval(autoAdvanceRef.current);
      window.removeEventListener('wheel', pause);
      window.removeEventListener('touchstart', pause);
      window.removeEventListener('keydown', pause);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvance, autoAdvanceSeconds, totalPages]);

  // --- Ťuknutí pro listování (levá třetina = zpět, pravá třetina = vpřed,
  // střed = přepnout fokus) + přejetí prstem. Odlišeno od výběru textu tím,
  // že se počítá, jestli po dotyku vůbec něco vybraného zůstalo, a jestli se
  // prst posunul jen málo (ťuknutí) nebo hodně vodorovně (přejetí).
  const handleTouchStart = (e) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  };

  const handleTouchEnd = (e) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    if (window.getSelection()?.toString()) return; // právě dokončený výběr textu, ne gesto pro stránkování

    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);

    if (adx < 10 && ady < 10) {
      handleTapNavigation(t.clientX);
    } else if (adx > 50 && adx > ady * 1.5) {
      if (dx < 0) nextPage(); else prevPage();
    }
  };

  const handleTapNavigation = (clientX) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const relativeX = (clientX - rect.left) / rect.width;
    if (relativeX < 0.3) prevPage();
    else if (relativeX > 0.7) nextPage();
    else setFocusMode(v => !v);
  };

  const handleContainerClick = (e) => {
    if (suppressTapRef.current) { suppressTapRef.current = false; return; }
    if (window.getSelection()?.toString()) return;
    handleTapNavigation(e.clientX);
  };

  // --- Klik mimo panel (vzhled/obsah/záložky) ho zavře.
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
    <div style={{ backgroundColor: readingBg, height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} className="transition-colors duration-200">

      <div style={{ backgroundColor: 'var(--border-color)' }} className="shrink-0 h-1 z-40">
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

      {!focusMode && (
        <div className="shrink-0 px-4 pt-4 pb-2 max-w-[100vw]">
          <div className="border-b pb-4 text-center max-w-2xl mx-auto" style={{ borderColor: 'var(--border-color)' }}>
            <Link to="/app" className="text-[10px] font-black uppercase tracking-wider no-underline opacity-50 hover:opacity-100 transition-all inline-flex items-center gap-1 mb-3" style={{ color: readingText }}>
              ← Zpět do knihovny
            </Link>
            <h1 style={{ color: readingText }} className="text-xl sm:text-3xl font-black uppercase tracking-tight m-0 truncate">{book.title}</h1>
            <p className="text-xs uppercase font-bold mt-1 opacity-60 m-0" style={{ color: 'var(--text-muted)' }}>Autor: {book.author_display || book.author}</p>
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] mt-2 opacity-70 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1"><Clock size={11} /> zbývá ~{remainingMinutes} min</span>
              <span>Strana {currentPage} / {totalPages}</span>
            </p>
          </div>

          <div ref={toolbarRef} className="flex items-center justify-center gap-2 relative flex-wrap mt-3 max-w-2xl mx-auto">
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
                <List size={12} /> Obsah
              </button>
            )}

            <button
              onClick={() => setAutoAdvance(v => !v)}
              style={{ borderColor: 'var(--border-color)', backgroundColor: autoAdvance ? 'var(--bg-primary)' : 'var(--bg-card)', color: autoAdvance ? 'white' : 'var(--text-body)' }}
              className="border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase cursor-pointer flex items-center gap-1.5"
              title="Automatické listování"
            >
              {autoAdvance ? <Pause size={12} /> : <Play size={12} />} Auto
            </button>

            <button
              onClick={() => setFocusMode(true)}
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }}
              className="border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase cursor-pointer flex items-center gap-1.5"
              title="Fokus režim (F)"
            >
              <Maximize2 size={12} /> Fokus
            </button>

            <button
              onClick={handleAddBookmark}
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }}
              className="border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase cursor-pointer flex items-center gap-1.5"
              title="Uložit místo (B)"
            >
              <BookMarked size={12} /> Místo
            </button>
            <button
              onClick={() => setShowBookmarks(v => !v)}
              style={{ borderColor: 'var(--border-color)', backgroundColor: showBookmarks ? 'var(--bg-primary)' : 'var(--bg-card)', color: showBookmarks ? 'white' : 'var(--text-body)' }}
              className="border rounded-xl px-3 py-1.5 text-[10px] font-black uppercase cursor-pointer flex items-center gap-1.5"
            >
              Záložky {bookmarks.length > 0 && `(${bookmarks.length})`}
            </button>

            {showSettings && (
              <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-80 max-w-[92vw] border rounded-xl shadow-lg z-20 p-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider">Velikost písma</span>
                    <span style={{ color: 'var(--text-body)' }} className="text-[10px] font-bold">{fontSize}px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setFontSize(f => Math.max(14, f - 1))} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="w-8 h-8 shrink-0 rounded-lg border-none cursor-pointer font-black text-xs">A-</button>
                    <input type="range" min={14} max={28} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="flex-1 min-w-0" style={{ accentColor: 'var(--bg-primary)' }} />
                    <button onClick={() => setFontSize(f => Math.min(28, f + 1))} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="w-8 h-8 shrink-0 rounded-lg border-none cursor-pointer font-black text-sm">A+</button>
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
                  <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block mb-2">Šířka stránky</span>
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
                  <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block mb-2">Rychlost auto-listování (s/stránku)</span>
                  <input type="range" min={8} max={60} value={autoAdvanceSeconds} onChange={e => setAutoAdvanceSeconds(Number(e.target.value))} className="w-full" style={{ accentColor: 'var(--bg-primary)' }} />
                </div>
              </div>
            )}

            {showToc && chapters.length > 0 && (
              <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 max-w-[92vw] border rounded-xl shadow-lg z-20 p-2 max-h-72 overflow-y-auto">
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

            {showBookmarks && (
              <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 max-w-[92vw] border rounded-xl shadow-lg z-20 p-2 max-h-64 overflow-y-auto">
                {bookmarks.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }} className="text-[11px] text-center py-3 opacity-60">Zatím žádné záložky.</p>
                ) : bookmarks.map(bm => (
                  <div key={bm.id} className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-[var(--bg-secondary)]">
                    <button onClick={() => jumpToBookmark(bm)} className="flex-1 text-left bg-transparent border-none cursor-pointer p-0 min-w-0" style={{ color: 'var(--text-body)' }}>
                      <span className="text-xs font-bold block truncate">{bm.label}</span>
                      <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-60">{Math.round(bm.scroll_position)} % knihy</span>
                    </button>
                    <button onClick={() => deleteBookmark(bm.id)} className="bg-transparent border-none cursor-pointer p-1 text-red-400 opacity-60 hover:opacity-100 shrink-0">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- STRÁNKA: pevný poměr stran (jako video s "contain") uvnitř
          dostupného prostoru - jediný zdroj pravdy pro šířku stránky, žádná
          samostatná maxWidth/vycentrování vrstva navrch, která by se s
          sloupcovým rozvržením textu mohla rozejít (přesně tohle byla
          příčina "vykukujících" sousedních stránek předtím). --- */}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden px-2 sm:px-4 py-2">
        <div
          ref={containerRef}
          onClick={handleContainerClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          style={{
            aspectRatio: textWidth.ratio,
            height: '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            overflow: 'hidden',
            position: 'relative',
            touchAction: 'pan-y',
            backgroundColor: paperMode ? 'rgba(0,0,0,0.03)' : 'var(--bg-card)',
            borderRadius: '18px',
            boxShadow: '0 6px 28px rgba(0,0,0,0.16)',
          }}
        >
          <div
            ref={contentRef}
            className={`select-text ${fontFamily.className}`}
            style={{
              width: '100%',
              height: '100%',
              padding: '28px 24px',
              boxSizing: 'border-box',
              color: readingText,
              fontSize: `${fontSize}px`,
              lineHeight: lineHeight.value,
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
            }}
          >
            {paginating ? (
              <span style={{ opacity: 0.4 }}>Připravuji stránky...</span>
            ) : contentSegments.length > 0 ? contentSegments.map(seg => (
              seg.type === 'highlight' ? (
                <mark
                  key={seg.key}
                  style={{ backgroundColor: HIGHLIGHT_COLORS[seg.color]?.bg || HIGHLIGHT_COLORS.amber.bg, color: 'inherit', borderRadius: '2px', cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); setActiveHighlight(highlights.find(h => h.id === seg.id)); setNoteDraft(seg.note || ''); }}
                >
                  {seg.text}
                </mark>
              ) : (
                <span key={seg.key}>{seg.text}</span>
              )
            )) : "Tato kniha zatím nemá nahraný žádný textový obsah."}
          </div>

          {/* Skrytá kopie pro měření zalomení stránek - stejná šířka/písmo/
              řádkování jako výše, ale mimo obrazovku a s neomezenou výškou. */}
          <div
            ref={measureRef}
            aria-hidden="true"
            className={fontFamily.className}
            style={{
              position: 'fixed',
              top: 0,
              left: '-9999px',
              visibility: 'hidden',
              height: 'auto',
              fontSize: `${fontSize}px`,
              lineHeight: lineHeight.value,
              whiteSpace: 'pre-wrap',
              wordBreak: 'normal',
            }}
          />

          {/* Šipky pro myš na širších obrazovkách - na mobilu se listuje
              ťuknutím do krajů stránky, tohle je navíc, ne náhrada. */}
          <button
            onClick={(e) => { e.stopPropagation(); prevPage(); }}
            disabled={currentPage <= 1}
            className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full border-none items-center justify-center cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); nextPage(); }}
            disabled={currentPage >= totalPages}
            className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full border-none items-center justify-center cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
          >
            <ChevronRight size={18} />
          </button>

          {/* Popup po výběru textu - vybrat barvu zvýraznění. */}
          {pendingSelection && (
            <div
              style={{
                position: 'fixed', left: pendingSelection.x, top: Math.max(8, pendingSelection.y - 56),
                transform: 'translateX(-50%)', backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)',
                zIndex: 50,
              }}
              className="border rounded-xl shadow-lg p-2 flex items-center gap-1.5"
            >
              {Object.entries(HIGHLIGHT_COLORS).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => saveHighlight(key)}
                  title={val.label}
                  style={{ backgroundColor: val.bg.replace('0.35', '0.9') }}
                  className="w-7 h-7 rounded-full border-none cursor-pointer"
                />
              ))}
              <button onClick={() => { setPendingSelection(null); window.getSelection()?.removeAllRanges(); }} className="w-7 h-7 rounded-full border-none cursor-pointer flex items-center justify-center" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }}>
                <X size={13} />
              </button>
            </div>
          )}

          {/* Panel pro zobrazenou zvýrazněnou pasáž - přidat/upravit poznámku, smazat. */}
        {activeHighlight && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={() => setActiveHighlight(null)}>
            <div onClick={e => e.stopPropagation()} style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl shadow-xl w-full sm:w-96 max-w-full p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Highlighter size={15} style={{ color: 'var(--bg-primary)' }} />
                <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider">Zvýrazněná pasáž</span>
              </div>
              <p style={{ color: 'var(--text-body)', backgroundColor: HIGHLIGHT_COLORS[activeHighlight.color]?.bg }} className="text-sm p-2 rounded-lg italic max-h-32 overflow-y-auto">
                „{book.content.slice(activeHighlight.start_offset, activeHighlight.end_offset)}"
              </p>
              <textarea
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value.slice(0, 500))}
                placeholder="Osobní poznámka k téhle pasáži (jen pro tebe)..."
                rows={3}
                style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                className="w-full p-2.5 border rounded-lg text-xs font-medium outline-none resize-none"
              />
              <div className="flex items-center gap-2">
                <button onClick={() => deleteHighlight(activeHighlight.id)} className="px-3 py-2 rounded-lg border-none cursor-pointer text-[10px] font-black uppercase flex items-center gap-1.5 text-red-500" style={{ backgroundColor: 'rgba(239,68,68,0.1)' }}>
                  <Trash2 size={12} /> Smazat
                </button>
                <button onClick={() => setActiveHighlight(null)} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="flex-1 py-2 rounded-lg border-none cursor-pointer text-[10px] font-black uppercase">Zrušit</button>
                <button onClick={saveNote} style={{ backgroundColor: 'var(--bg-primary)', color: 'white' }} className="flex-1 py-2 rounded-lg border-none cursor-pointer text-[10px] font-black uppercase">Uložit</button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* --- Spodní lišta se šipkami a číslem stránky - hlavní ovládání
          listování, proto viditelná VŽDY, i ve fokus režimu (na rozdíl od
          horní lišty s nastavením/obsahem/záložkami). --- */}
      <div className="shrink-0 flex items-center justify-center gap-5 py-3">
        <button
          onClick={prevPage}
          disabled={currentPage <= 1}
          style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
          className="w-10 h-10 rounded-full border flex items-center justify-center cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed shadow-sm"
        >
          <ChevronLeft size={18} />
        </button>
        <span style={{ color: readingText }} className="text-xs font-black tabular-nums min-w-[64px] text-center">
          {currentPage} / {totalPages}
        </span>
        <button
          onClick={nextPage}
          disabled={currentPage >= totalPages}
          style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
          className="w-10 h-10 rounded-full border flex items-center justify-center cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed shadow-sm"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {!focusMode && (
        <div className="shrink-0 px-4 pb-3 max-w-2xl mx-auto w-full">
          <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="border rounded-xl p-3 flex items-center justify-center gap-3 flex-wrap">
            <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-70">Ohodnotit knihu:</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => handleRate(n)} disabled={savingRating} className="bg-transparent border-none cursor-pointer p-0.5 disabled:cursor-not-allowed">
                  <Star size={18} className={n <= myRating ? "fill-amber-400 text-amber-400" : "text-amber-400 opacity-30"} />
                </button>
              ))}
            </div>
            {book.ratings_count > 0 && (
              <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-60">({parseFloat(book.avg_rating || 0).toFixed(1)} ⭐, {book.ratings_count})</span>
            )}
          </div>
          <p style={{ color: 'var(--text-muted)' }} className="text-center text-[10px] opacity-40 mt-2">
            Ťukni do krajů pro listování · vyber text pro zvýraznění · mezerník/šipky · B záložka · F fokus
          </p>
        </div>
      )}
    </div>
  );
};
