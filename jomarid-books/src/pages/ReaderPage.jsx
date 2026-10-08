import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { fetchBookText } from '../bookText/bookText';
import { FONT_FAMILIES, LINE_HEIGHTS, TEXT_WIDTHS, ALIGNMENTS, PAGE_BREAKS, loadReaderPrefs, saveReaderPref, readerTypography } from '../theme';
import {
  BookMarked, Loader2, Star, X, Settings2, List, Minimize2, Maximize2,
  Play, Pause, Clock, ChevronRight, ChevronLeft, Highlighter, Trash2,
} from 'lucide-react';

// ============================================================================
// Čtecí nastavení - beze změny oproti dřívější verzi, pořád localStorage.
// ============================================================================

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
// <<PAGINATOR-START>>
// ============================================================================
// STRÁNKOVÁNÍ (v2)
//
// Dřív se pro každou stránku vykresloval ve skrytém uzlu celý ZBYTEK knihy
// (jen aby se zjistilo, jestli už nejsme na konci) a pak se hledalo půlením,
// takže čas rostl s druhou mocninou délky knihy (300 kB = 13 s, na telefonu
// minuty) a UI po celou dobu stálo. Navíc se zalamovalo jen na mezeře, takže
// 95 % stránek skončilo uprostřed věty.
//
// Teď: na každou stránku se vykreslí jen malý výřez textu (o něco delší než
// stránka), prohlížeč ho rozloží JEDNOU a první řádek, který se už nevejde,
// se najde půlením přes Range.getBoundingClientRect() - bez dalšího
// vykreslování. Zlom se pak posune na konec věty / odstavce, pokud je blízko.
// ============================================================================
export const BREAK_MODES = { word: 0, sentence: 0.22, paragraph: 0.3 };

const isWs = (ch) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r'; // NBSP záměrně NENÍ mezera - nezalamuje se
const CLOSERS = '"\'”“»’)]';
const SENTENCE_START = /[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9„"“«(\[–—\-]/;

// Vybere, kde stránka skutečně skončí. rawEnd = největší index, kam se ještě vejdou řádky.
export function chooseBreak(content, start, rawEnd, mode = 'sentence') {
  if (rawEnd >= content.length) return content.length;
  // 1) nikdy nelámat uprostřed slova
  let wordEnd = rawEnd;
  if (!(isWs(content[rawEnd]) || isWs(content[rawEnd - 1]))) {
    let i = rawEnd;
    while (i > start && !isWs(content[i - 1])) i--;
    if (i > start) wordEnd = i; // u extrémně dlouhého "slova" bez mezery se nechá původní řez
  }
  const windowFrac = BREAK_MODES[mode] ?? 0;
  if (!windowFrac) return wordEnd;
  // Okno, ve kterém se hledá konec věty: podíl stránky, ale aspoň ~150 znaků (na úzké stránce je 22 % kratší než
  // průměrná věta) a nejvýš 35 % stránky, aby dole nezůstávala velká prázdná plocha.
  const pageLen = wordEnd - start;
  const windowLen = Math.min(Math.floor(pageLen * 0.35), Math.max(Math.floor(pageLen * windowFrac), 150));
  const lo = Math.max(start + 1, wordEnd - windowLen);
  // 2) odstavec (jen v režimu "paragraph")
  if (mode === 'paragraph') {
    for (let i = wordEnd - 1; i >= lo; i--) if (content[i] === '\n') return i;
  }
  // 3) konec věty: . ! ? … (+ uvozovky/závorky) a pak mezera a velké písmeno/číslice/uvozovka
  //    (malé písmeno za tečkou = zkratka typu "atd. pak", takže to není konec věty)
  for (let i = wordEnd - 1; i >= lo; i--) {
    const ch = content[i];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') continue;
    let j = i + 1;
    while (j < content.length && CLOSERS.includes(content[j])) j++;
    if (j > wordEnd) continue;
    if (j < content.length && !isWs(content[j])) continue;
    let k = j;
    while (k < content.length && isWs(content[k])) k++;
    if (k >= content.length || SENTENCE_START.test(content[k])) return j;
  }
  return wordEnd;
}

// Vytvoří "stránkovač" nad skrytým měřicím uzlem (stejná šířka, písmo, řádkování,
// white-space: pre-wrap jako viditelná stránka). nextPage() vrací další stránku.
export function createPaginator(content, node, pageHeight, { breakMode = 'sentence' } = {}) {
  const total = content.length;
  const textNode = document.createTextNode('');
  node.textContent = '';
  node.appendChild(textNode);
  const range = document.createRange();
  let pos = 0;
  let avg = 1500;

  // Range.getBoundingClientRect() vrací rámeček ZNAKŮ, ne řádku: nahoře i dole je ještě půl mezery mezi řádky.
  // Prohlížeč ale ořezává podle spodku ŘÁDKU, takže stránka, jejíž poslední znaky se vejdou a řádek ne, by
  // přetekla (naměřeno: u některých výšek plochy přetékala skoro každá třetí stránka). Proto se k spodku znaků
  // přičte rozdíl (výška řádku - výška znaků) / 2.
  const lineHeightPx = parseFloat(getComputedStyle(node).lineHeight);
  textNode.nodeValue = 'Mgjpq';
  range.setStart(textNode, 0);
  range.setEnd(textNode, 5);
  const glyphH = range.getBoundingClientRect().height;
  const slack = Number.isFinite(lineHeightPx) && glyphH > 0
    ? Math.min(lineHeightPx, Math.max(-glyphH * 0.25, (lineHeightPx - glyphH) / 2))
    : 0;
  const limit = pageHeight + 0.5 - slack; // 0,5 px tolerance: prohlížeč zaokrouhluje výšku a méně než pixel neořízne

  const finish = (start, end) => {
    let e = end;
    while (e > start + 1 && isWs(content[e - 1])) e--; // stránka nekončí mezerou/novým řádkem
    pos = end;
    avg = Math.max(200, Math.round(avg * 0.6 + (e - start) * 0.4));
    return { start, end: e };
  };

  const nextPage = () => {
    while (pos < total && isWs(content[pos])) pos++; // stránka nezačíná mezerou/novým řádkem
    if (pos >= total) return null;
    const start = pos;
    let take = Math.min(total - start, Math.max(300, Math.ceil(avg * 1.3)));
    for (;;) {
      textNode.nodeValue = content.slice(start, start + take);
      const top0 = node.getBoundingClientRect().top;
      range.setStart(textNode, 0);
      const bottom = (k) => { range.setEnd(textNode, k); return range.getBoundingClientRect().bottom - top0; };
      if (bottom(take) <= limit) {
        if (start + take >= total) return finish(start, total);
        take = Math.min(total - start, take * 2); // stránka je delší než výřez - zvětšit a znovu
        continue;
      }
      let lo = 1, hi = take - 1, best = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (bottom(mid) <= limit) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return finish(start, chooseBreak(content, start, start + best, breakMode));
    }
  };

  return { nextPage, get position() { return pos; }, total };
}

export function paginateSync(content, node, pageHeight, opts = {}) {
  const p = createPaginator(content, node, pageHeight, opts);
  const pages = [];
  for (let page = p.nextPage(); page; page = p.nextPage()) pages.push(page);
  return pages.length ? pages : [{ start: 0, end: content.length }];
}

// Stejné, ale po dávkách, s průběhem a možností zrušit. Mezi dávkami se uvolní hlavní vlákno, aby šlo
// ovládat stránku; dávka je ale nutné držet delší (40 ms), protože každé uvolnění dovolí prohlížeči
// vykreslit celý snímek a na pomalém telefonu to stojí víc než samotná práce (naměřeno: 12 ms dávky
// = 11 s, 40 ms dávky = zlomek). Uvolňuje se přes MessageChannel (setTimeout má po pár opakováních
// minimální prodlevu 4 ms), a hned, jakmile čeká vstup uživatele (Chrome: isInputPending).
const yieldToBrowser = () => new Promise(resolve => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
  ch.port2.postMessage(0);
});
export async function paginateAll(content, node, pageHeight, { breakMode, isCancelled, onProgress, budgetMs = 40 } = {}) {
  const p = createPaginator(content, node, pageHeight, { breakMode });
  const pages = [];
  const input = typeof navigator !== 'undefined' && navigator.scheduling && navigator.scheduling.isInputPending ? navigator.scheduling : null;
  let t = performance.now();
  for (let page = p.nextPage(); page; page = p.nextPage()) {
    pages.push(page);
    const now = performance.now();
    if (now - t > budgetMs || (input && now - t > 8 && input.isInputPending())) {
      if (isCancelled && isCancelled()) return null;
      if (onProgress) onProgress(pages, p.position / Math.max(1, p.total));
      await yieldToBrowser();
      t = performance.now();
    }
  }
  return pages.length ? pages : [{ start: 0, end: content.length }];
}

// Stránka, na které leží daný znak (půlením). Znak v "mezeře" mezi stránkami patří té následující.
export function pageIndexForOffset(pages, offset) {
  if (!pages.length) return 0;
  let lo = 0, hi = pages.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid].start <= offset) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return pages[ans].end <= offset && ans < pages.length - 1 ? ans + 1 : ans;
}
// <<PAGINATOR-END>>

// --- Mezipaměť stránkování: stejná kniha + stejné nastavení + stejná velikost plochy = stejné stránky, takže
// se při dalším otevření nic nepočítá. Platnost hlídá podpis (délka a otisk textu, velikost plochy, nastavení)
// a navíc kontrola, že se zobrazená stránka opravdu vejde (viz níže) - když ne, mezipaměť se zahodí.
const PAGE_CACHE_KEY = 'jomarid-page-cache-v1';
const PAGE_CACHE_MAX = 6;
const quickHash = (s) => {
  let h = s.length;
  const step = Math.max(1, Math.floor(s.length / 64));
  for (let i = 0; i < s.length; i += step) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
export const pageCacheSig = (bookId, content, w, h, typoKey) => `${bookId}|${content.length}|${quickHash(content)}|${w}x${h}|${typoKey}`;
const loadPageCache = () => { try { const v = JSON.parse(localStorage.getItem(PAGE_CACHE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
export const readPageCache = (sig, contentLength) => {
  const hit = loadPageCache().find(e => e && e.sig === sig && typeof e.data === 'string');
  if (!hit) return null;
  try {
    const pages = hit.data.split(',').map(x => { const [a, b] = x.split('.'); return { start: parseInt(a, 36), end: parseInt(b, 36) }; });
    let prevEnd = 0;
    for (const p of pages) { if (!(p.start >= prevEnd && p.end > p.start && p.end <= contentLength)) return null; prevEnd = p.end; }
    return pages.length ? pages : null;
  } catch { return null; }
};
export const writePageCache = (sig, pages) => {
  if (pages.length < 3) return;
  try {
    const rest = loadPageCache().filter(e => e && e.sig !== sig);
    const entry = { sig, t: Date.now(), data: pages.map(p => p.start.toString(36) + '.' + p.end.toString(36)).join(',') };
    localStorage.setItem(PAGE_CACHE_KEY, JSON.stringify([entry, ...rest].slice(0, PAGE_CACHE_MAX)));
  } catch { /* plné úložiště apod. - mezipaměť je jen urychlení */ }
};
export const dropPageCache = (sig) => { try { localStorage.setItem(PAGE_CACHE_KEY, JSON.stringify(loadPageCache().filter(e => e && e.sig !== sig))); } catch { /* nevadí */ } };

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

  // Nastavení čtečky sdílí Nastavení (ozubené kolečko) i tahle stránka: obojí čte a zapisuje stejné klíče
  // a změna z jednoho místa se hned projeví i v druhém (událost jomarid-reader-prefs).
  const [prefs, setPrefs] = useState(loadReaderPrefs);
  const setPref = useCallback((name, value) => {
    saveReaderPref(name, value);
    setPrefs(p => (p[name] === value ? p : { ...p, [name]: value }));
  }, []);
  useEffect(() => {
    const sync = () => setPrefs(p => { const n = loadReaderPrefs(); return JSON.stringify(n) === JSON.stringify(p) ? p : n; });
    window.addEventListener('jomarid-reader-prefs', sync);
    return () => window.removeEventListener('jomarid-reader-prefs', sync);
  }, []);
  const fontSize = prefs.fontSize;
  const fontFamilyKey = prefs.fontFamily;
  const lineHeightKey = prefs.lineHeight;
  const textWidthKey = prefs.textWidth;
  const paperMode = prefs.paper;
  const autoAdvanceSeconds = prefs.autoAdvance;
  const setFontSize = (v) => setPref('fontSize', typeof v === 'function' ? v(prefs.fontSize) : v);
  const setFontFamilyKey = (v) => setPref('fontFamily', v);
  const setLineHeightKey = (v) => setPref('lineHeight', v);
  const setTextWidthKey = (v) => setPref('textWidth', v);
  const setPaperMode = (v) => setPref('paper', typeof v === 'function' ? v(prefs.paper) : v);
  const setAutoAdvanceSeconds = (v) => setPref('autoAdvance', v);
  const typo = readerTypography(prefs);
  const typoRef = useRef(typo);
  typoRef.current = typo;
  // Co všechno mění rozložení textu, a tedy vyžaduje přepočet stránek.
  const typoKey = JSON.stringify([prefs.fontSize, prefs.fontFamily, prefs.lineHeight, prefs.textWidth, prefs.align, prefs.hyphens, prefs.letterSpacing, prefs.margin, prefs.pageBreak]);

  const [showSettings, setShowSettings] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [focusMode, setFocusMode] = useState(() => loadReaderPrefs().startFocus);
  const [autoAdvance, setAutoAdvance] = useState(false);

  const [bookmarks, setBookmarks] = useState([]);
  const [myRating, setMyRating] = useState(0);
  const [savingRating, setSavingRating] = useState(false);

  const [highlights, setHighlights] = useState([]);
  const [pendingSelection, setPendingSelection] = useState(null); // { start, end, x, y }
  const [activeHighlight, setActiveHighlight] = useState(null); // highlight being viewed/edited
  const [noteDraft, setNoteDraft] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);
  currentPageRef.current = currentPage;

  const hasBeenMarkedReadRef = useRef(false);
  const hadExistingRowRef = useRef(false);
  const autoAdvanceRef = useRef(null);
  const toolbarRef = useRef(null);
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const touchStartRef = useRef(null);
  const suppressTapRef = useRef(false);
  const pendingSaveRef = useRef(null);


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
          fetchBookText(supabase, id).then((r) => ({ data: r })),
          supabase.from('book_bookmarks').select('id, label, scroll_position, created_at').eq('user_id', user.id).eq('book_id', id).order('created_at', { ascending: false }),
          supabase.from('book_ratings').select('rating').eq('user_id', user.id).eq('book_id', id).maybeSingle(),
          supabase.from('book_highlights').select('id, start_offset, end_offset, color, note').eq('user_id', user.id).eq('book_id', id).order('start_offset', { ascending: true }),
        ]);

        setBook({ ...bookData, content: contentRow?.text || '' });
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
    return Math.max(1, Math.round(remainingWords / prefs.wpm));
  }, [wordCount, liveProgress, prefs.wpm]);

  // --- Stránkování (v2, viz createPaginator výše). Spočítá se po dávkách, takže se UI nezasekne, a čtenář
  // vidí stránku, na které skončil, jakmile je spočítaná (netřeba čekat na celou knihu). Po změně písma
  // apod. zůstane na stejném místě textu (podle znaku, ne podle čísla stránky).
  const [pages, setPages] = useState([{ start: 0, end: 0 }]);
  const [paginating, setPaginating] = useState(true);
  const [pagesComplete, setPagesComplete] = useState(false);
  const measureRef = useRef(null);
  const totalPages = pages.length;
  const isLastPage = pagesComplete && currentPage >= totalPages;
  const paginateTokenRef = useRef(0);
  const anchorOffsetRef = useRef(null); // začátek stránky, kterou čtenář právě čte
  const pendingJumpRef = useRef(null);  // skok (záložka/obsah) za hranici dosud spočítaných stránek
  const lastSizeRef = useRef({ w: 0, h: 0 });
  const dirRef = useRef(1);
  const progressTextRef = useRef(null); // procenta přípravy se píšou přímo do DOM - překreslovat kvůli nim celou čtečku každých 40 ms by stránkování zpomalilo několikanásobně
  const sigRef = useRef('');
  const fromCacheRef = useRef(false); // aktuální stránky pochází z mezipaměti (pak se hlídá, že se opravdu vejdou)
  const forceRef = useRef(false);
  const trimRef = useRef(0);
  const typoKeyRef = useRef('');
  typoKeyRef.current = typoKey;

  const recomputePages = useCallback(() => {
    const container = containerRef.current;
    const node = measureRef.current;
    const content = book?.content;
    if (!container || !node || !content) return;
    const { padX, padY } = typoRef.current;
    // Zlomkové rozměry (clientHeight zaokrouhluje na celé pixely a o půl pixelu se pak stránka nevejde).
    // trimRef = pojistka: když se zobrazená stránka přesto nevejde, příště se počítá o pár pixelů nižší.
    const box = container.getBoundingClientRect();
    const innerWidth = box.width - 2 * padX;
    const innerHeight = box.height - 2 * padY - trimRef.current;
    if (innerWidth <= 0 || innerHeight <= 0) return;
    lastSizeRef.current = { w: container.clientWidth, h: container.clientHeight };

    const token = ++paginateTokenRef.current;
    const cancelled = () => token !== paginateTokenRef.current;
    const anchor = anchorOffsetRef.current ?? Math.floor((initialScroll / 100) * content.length);
    node.style.width = `${innerWidth}px`;
    const sig = pageCacheSig(id, content, innerWidth, innerHeight, typoKeyRef.current);
    sigRef.current = sig;
    const cached = forceRef.current ? null : readPageCache(sig, content.length);
    forceRef.current = false;
    if (cached) {
      fromCacheRef.current = true;
      setPages(cached);
      setCurrentPage(pageIndexForOffset(cached, anchor) + 1);
      setPaginating(false);
      setPagesComplete(true);
      return;
    }
    fromCacheRef.current = false;
    setPaginating(true);
    setPagesComplete(false);
    if (progressTextRef.current) progressTextRef.current.textContent = '...';
    const fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();
    fontsReady.then(() => {
      if (cancelled()) return;
      requestAnimationFrame(async () => {
        if (cancelled()) return;
        let revealed = false;
        let lastPush = 0;
        const reveal = (pgs) => {
          revealed = true;
          setPages(pgs.slice());
          setCurrentPage(pageIndexForOffset(pgs, anchor) + 1);
          setPaginating(false);
        };
        const result = await paginateAll(content, node, innerHeight, {
          breakMode: typoRef.current.breakMode,
          isCancelled: cancelled,
          onProgress: (pgs) => {
            if (!revealed) {
              if (pgs[pgs.length - 1].end > anchor) reveal(pgs);
              else if (progressTextRef.current) progressTextRef.current.textContent = `... ${Math.min(99, Math.round(100 * pgs[pgs.length - 1].end / Math.max(1, anchor)))} %`;
            }
            else if (performance.now() - lastPush > 800) { lastPush = performance.now(); setPages(pgs.slice()); }
          },
        });
        if (!result || cancelled()) return;
        setPages(result);
        if (!revealed) setCurrentPage(pageIndexForOffset(result, anchor) + 1);
        setPaginating(false);
        setPagesComplete(true);
        writePageCache(sig, result);
        const jump = pendingJumpRef.current;
        if (jump != null) { pendingJumpRef.current = null; setCurrentPage(pageIndexForOffset(result, jump) + 1); }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.content, initialScroll, id]);

  useLayoutEffect(() => {
    if (loading || !book) return;
    if (!book.content) { setPaginating(false); setPagesComplete(true); return; }
    trimRef.current = 0;
    recomputePages();
    let timer = null;
    // Jen když se OPRAVDU změnila velikost plochy (ResizeObserver hlásí i první měření a drobné posuny
    // při schovávání lišty prohlížeče na telefonu).
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const c = containerRef.current;
        if (!c || (c.clientWidth === lastSizeRef.current.w && c.clientHeight === lastSizeRef.current.h)) return;
        recomputePages();
      }, 200);
    };
    const ro = new ResizeObserver(onResize);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', onResize);
    const recomputeNow = () => recomputePages(); // dočtené webové písmo může změnit šířku textu
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', recomputeNow);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', recomputeNow);
      paginateTokenRef.current++; // rozpočítané stránkování se zahodí
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, book, typoKey, focusMode]);

  // Pojistka: nic se nesmí uříznout. Kdyby se zobrazená stránka (z mezipaměti i čerstvě spočítaná, třeba kvůli
  // neobvyklému písmu) přesto nevešla, zahodí se mezipaměť a stránky se spočítají znovu o trochu nižší.
  useLayoutEffect(() => {
    if (paginating) return;
    const el = contentRef.current;
    if (!el) return;
    const over = el.scrollHeight - el.clientHeight;
    if (over > 1 && trimRef.current < 40) {
      trimRef.current += Math.max(2, Math.ceil(over) + 1);
      fromCacheRef.current = false;
      dropPageCache(sigRef.current);
      forceRef.current = true;
      recomputePages();
    }
  }, [currentPage, pages, paginating]);

  // Kde čtenář je (začátek stránky) - po přepočtu se vrátí na stejné místo textu.
  useEffect(() => {
    const pg = pages[currentPage - 1];
    if (!paginating && pg && pg.end > 0) anchorOffsetRef.current = pg.start;
  }, [currentPage, pages, paginating]);

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
    if (!book?.content || paginating || pages.length === 0 || pages[0].end === 0) return;
    const page = pages[currentPage - 1];
    if (!page) return;
    const percent = book.content.length > 0 ? Math.min(100, (page.start / book.content.length) * 100) : 0;
    setLiveProgress(percent);
    if (isLastPage) hasBeenMarkedReadRef.current = true;
    persistPosition(percent, hasBeenMarkedReadRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pages, paginating, pagesComplete]);

  const goToPage = useCallback((pageNum) => {
    dirRef.current = pageNum >= currentPageRef.current ? 1 : -1;
    setCurrentPage(Math.min(totalPages, Math.max(1, pageNum)));
  }, [totalPages]);

  const nextPage = useCallback(() => goToPage(currentPage + 1), [goToPage, currentPage]);
  const prevPage = useCallback(() => goToPage(currentPage - 1), [goToPage, currentPage]);

  const goToPercent = useCallback((percent) => {
    if (!book?.content) return;
    const target = Math.floor((percent / 100) * book.content.length);
    const covered = pages[pages.length - 1]?.end ?? 0;
    // cíl leží za dosud spočítanými stránkami - po dopočítání se na něj skočí
    if (!pagesComplete && target >= covered) { pendingJumpRef.current = target; setCurrentPage(pages.length); return; }
    setCurrentPage(pageIndexForOffset(pages, target) + 1);
  }, [book?.content, pages, pagesComplete]);

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
      if (prefs.tapZones) handleTapNavigation(t.clientX);
    } else if (prefs.swipe && adx > 50 && adx > ady * 1.5) {
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
    if (prefs.tapZones) handleTapNavigation(e.clientX);
  };

  // --- Displej nezhasne, dokud se čte (Screen Wake Lock; nepodporuje každý prohlížeč, pak se nic neděje).
  useEffect(() => {
    if (!prefs.wakeLock || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock = null;
    const acquire = async () => {
      try { if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch { /* prohlížeč nepovolil */ }
    };
    acquire();
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (lock && lock.release) lock.release().catch(() => {});
    };
  }, [prefs.wakeLock]);

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
  // Dokud se stránky dopočítávají, celkový počet je jen odhad (podle toho, jak daleko v textu už jsou).
  const coveredEnd = pages[totalPages - 1]?.end || 0;
  const estimatedTotal = pagesComplete || coveredEnd <= 0 ? totalPages : Math.max(totalPages, Math.round(totalPages * book.content.length / coveredEnd));
  const totalLabel = pagesComplete ? totalPages : `~${estimatedTotal}`;
  const animClass = prefs.pageAnim === 'fade' ? 'reader-anim-fade' : prefs.pageAnim === 'slide' ? (dirRef.current >= 0 ? 'reader-anim-next' : 'reader-anim-prev') : '';

  return (
    <div style={{ backgroundColor: readingBg, height: 'calc(100dvh - var(--navbar-h, 4rem))', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} className="transition-colors duration-200">

      {prefs.nightFilter > 0 && (
        <div aria-hidden="true" data-testid="night-filter" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 35, mixBlendMode: 'multiply', backgroundColor: `rgba(255, 130, 30, ${(prefs.nightFilter / 100) * 0.45})` }} />
      )}

      {prefs.showProgress && (
        <div style={{ backgroundColor: 'var(--border-color)' }} className="shrink-0 h-1 z-40">
          <div style={{ backgroundColor: 'var(--bg-primary)', width: `${liveProgress}%` }} className="h-full transition-all duration-150" />
        </div>
      )}

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
        <div className="shrink-0 px-3 sm:px-4 pt-2 sm:pt-4 pb-1 sm:pb-2 max-w-[100vw]">
          <div className="border-b pb-2 sm:pb-4 text-center max-w-2xl mx-auto" style={{ borderColor: 'var(--border-color)' }}>
            <Link to="/app" className="text-[0.625rem] font-black uppercase tracking-wider no-underline opacity-50 hover:opacity-100 transition-all hidden sm:inline-flex items-center gap-1 mb-3" style={{ color: readingText }}>
              ← Zpět do knihovny
            </Link>
            <h1 style={{ color: readingText }} className="text-base sm:text-3xl font-black uppercase tracking-tight m-0 truncate">{book.title}</h1>
            <p className="hidden sm:block text-xs uppercase font-bold mt-1 opacity-60 m-0" style={{ color: 'var(--text-muted)' }}>Autor: {book.author_display || book.author}</p>
            {prefs.showMeta && (
              <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] mt-1 sm:mt-2 opacity-70 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1"><Clock size={11} /> zbývá ~{remainingMinutes} min</span>
                <span>Strana {currentPage} / {totalLabel}</span>
              </p>
            )}
          </div>

          <div ref={toolbarRef} className="flex items-center justify-center gap-1.5 sm:gap-2 relative flex-wrap mt-2 sm:mt-3 max-w-2xl mx-auto">
            <button
              onClick={() => setShowSettings(v => !v)}
              style={{ borderColor: 'var(--border-color)', backgroundColor: showSettings ? 'var(--bg-primary)' : 'var(--bg-card)', color: showSettings ? 'var(--text-primary)' : 'var(--text-body)' }}
              className="border rounded-xl px-3 py-1.5 text-[0.625rem] font-black uppercase cursor-pointer flex items-center gap-1.5"
            >
              <Settings2 size={12} /><span className="hidden sm:inline"> Vzhled</span><span className="sr-only sm:hidden">Vzhled</span>
            </button>

            {chapters.length > 0 && (
              <button
                onClick={() => setShowToc(v => !v)}
                style={{ borderColor: 'var(--border-color)', backgroundColor: showToc ? 'var(--bg-primary)' : 'var(--bg-card)', color: showToc ? 'var(--text-primary)' : 'var(--text-body)' }}
                className="border rounded-xl px-3 py-1.5 text-[0.625rem] font-black uppercase cursor-pointer flex items-center gap-1.5"
              >
                <List size={12} /><span className="hidden sm:inline"> Obsah</span><span className="sr-only sm:hidden">Obsah</span>
              </button>
            )}

            <button
              onClick={() => setAutoAdvance(v => !v)}
              style={{ borderColor: 'var(--border-color)', backgroundColor: autoAdvance ? 'var(--bg-primary)' : 'var(--bg-card)', color: autoAdvance ? 'var(--text-primary)' : 'var(--text-body)' }}
              className="border rounded-xl px-3 py-1.5 text-[0.625rem] font-black uppercase cursor-pointer flex items-center gap-1.5"
              title="Automatické listování"
            >
              {autoAdvance ? <Pause size={12} /> : <Play size={12} />}<span className="hidden sm:inline"> Auto</span><span className="sr-only sm:hidden">Auto</span>
            </button>

            <button
              onClick={() => setFocusMode(true)}
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }}
              className="border rounded-xl px-3 py-1.5 text-[0.625rem] font-black uppercase cursor-pointer flex items-center gap-1.5"
              title="Fokus režim (F)"
            >
              <Maximize2 size={12} /><span className="hidden sm:inline"> Fokus</span><span className="sr-only sm:hidden">Fokus</span>
            </button>

            <button
              onClick={handleAddBookmark}
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }}
              className="border rounded-xl px-3 py-1.5 text-[0.625rem] font-black uppercase cursor-pointer flex items-center gap-1.5"
              title="Uložit místo (B)"
            >
              <BookMarked size={12} /><span className="hidden sm:inline"> Místo</span><span className="sr-only sm:hidden">Místo</span>
            </button>
            <button
              onClick={() => setShowBookmarks(v => !v)}
              style={{ borderColor: 'var(--border-color)', backgroundColor: showBookmarks ? 'var(--bg-primary)' : 'var(--bg-card)', color: showBookmarks ? 'var(--text-primary)' : 'var(--text-body)' }}
              className="border rounded-xl px-3 py-1.5 text-[0.625rem] font-black uppercase cursor-pointer flex items-center gap-1.5"
            >
              Záložky {bookmarks.length > 0 && `(${bookmarks.length})`}
            </button>

            {showSettings && (
              <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-80 max-w-[92vw] border rounded-xl shadow-lg z-20 p-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider">Velikost písma</span>
                    <span style={{ color: 'var(--text-body)' }} className="text-[0.625rem] font-bold">{fontSize}px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setFontSize(f => Math.max(14, f - 1))} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="w-8 h-8 shrink-0 rounded-lg border-none cursor-pointer font-black text-xs">A-</button>
                    <input type="range" min={14} max={28} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="flex-1 min-w-0" style={{ accentColor: 'var(--bg-primary)' }} />
                    <button onClick={() => setFontSize(f => Math.min(28, f + 1))} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="w-8 h-8 shrink-0 rounded-lg border-none cursor-pointer font-black text-sm">A+</button>
                  </div>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block mb-2">Písmo</span>
                  <div className="flex gap-1.5">
                    {Object.entries(FONT_FAMILIES).map(([key, val]) => (
                      <button key={key} onClick={() => setFontFamilyKey(key)} style={{ backgroundColor: fontFamilyKey === key ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: fontFamilyKey === key ? 'var(--text-primary)' : 'var(--text-body)' }} className="flex-1 py-1.5 rounded-lg border-none cursor-pointer text-[0.625rem] font-bold">
                        {val.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block mb-2">Řádkování</span>
                  <div className="flex gap-1.5">
                    {Object.entries(LINE_HEIGHTS).map(([key, val]) => (
                      <button key={key} onClick={() => setLineHeightKey(key)} style={{ backgroundColor: lineHeightKey === key ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: lineHeightKey === key ? 'var(--text-primary)' : 'var(--text-body)' }} className="flex-1 py-1.5 rounded-lg border-none cursor-pointer text-[0.625rem] font-bold">
                        {val.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block mb-2">Šířka stránky</span>
                  <div className="flex gap-1.5">
                    {Object.entries(TEXT_WIDTHS).map(([key, val]) => (
                      <button key={key} onClick={() => setTextWidthKey(key)} style={{ backgroundColor: textWidthKey === key ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: textWidthKey === key ? 'var(--text-primary)' : 'var(--text-body)' }} className="flex-1 py-1.5 rounded-lg border-none cursor-pointer text-[0.625rem] font-bold">
                        {val.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block mb-2">Zarovnání textu</span>
                  <div className="flex gap-1.5">
                    {Object.entries(ALIGNMENTS).map(([key, val]) => (
                      <button key={key} onClick={() => setPref('align', key)} style={{ backgroundColor: prefs.align === key ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: prefs.align === key ? 'var(--text-primary)' : 'var(--text-body)' }} className="flex-1 py-1.5 rounded-lg border-none cursor-pointer text-[0.625rem] font-bold">
                        {val.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block mb-2">Zalamování stránek</span>
                  <div className="flex gap-1.5">
                    {Object.entries(PAGE_BREAKS).map(([key, val]) => (
                      <button key={key} onClick={() => setPref('pageBreak', key)} style={{ backgroundColor: prefs.pageBreak === key ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: prefs.pageBreak === key ? 'var(--text-primary)' : 'var(--text-body)' }} className="flex-1 py-1.5 rounded-lg border-none cursor-pointer text-[0.625rem] font-bold">
                        {val.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider">Papírový režim</span>
                  <button onClick={() => setPaperMode(v => !v)} style={{ backgroundColor: paperMode ? '#8b6f3e' : 'var(--bg-secondary)', color: paperMode ? 'white' : 'var(--text-body)' }} className="px-3 py-1.5 rounded-lg border-none cursor-pointer text-[0.625rem] font-bold">
                    {paperMode ? 'Zapnuto' : 'Vypnuto'}
                  </button>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block mb-2">Rychlost auto-listování (s/stránku)</span>
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
                  <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] text-center py-3 opacity-60">Zatím žádné záložky.</p>
                ) : bookmarks.map(bm => (
                  <div key={bm.id} className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-[var(--bg-secondary)]">
                    <button onClick={() => jumpToBookmark(bm)} className="flex-1 text-left bg-transparent border-none cursor-pointer p-0 min-w-0" style={{ color: 'var(--text-body)' }}>
                      <span className="text-xs font-bold block truncate">{bm.label}</span>
                      <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] opacity-60">{Math.round(bm.scroll_position)} % knihy</span>
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
            key={currentPage}
            ref={contentRef}
            lang={typo.lang}
            className={`select-text ${typo.className} ${paginating ? '' : animClass}`}
            style={{
              ...typo.style,
              width: '100%',
              height: '100%',
              padding: `${typo.padY}px ${typo.padX}px`,
              boxSizing: 'border-box',
              color: readingText,
              overflow: 'hidden',
            }}
          >
            {paginating ? (
              <span style={{ opacity: 0.4 }}>Připravuji stránky<span ref={progressTextRef}>...</span></span>
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
            lang={typo.lang}
            className={typo.className}
            style={{
              ...typo.style,
              position: 'fixed',
              top: 0,
              left: '-9999px',
              visibility: 'hidden',
              height: 'auto',
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
                <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider">Zvýrazněná pasáž</span>
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
                <button onClick={() => deleteHighlight(activeHighlight.id)} className="px-3 py-2 rounded-lg border-none cursor-pointer text-[0.625rem] font-black uppercase flex items-center gap-1.5 text-red-500" style={{ backgroundColor: 'rgba(239,68,68,0.1)' }}>
                  <Trash2 size={12} /> Smazat
                </button>
                <button onClick={() => setActiveHighlight(null)} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="flex-1 py-2 rounded-lg border-none cursor-pointer text-[0.625rem] font-black uppercase">Zrušit</button>
                <button onClick={saveNote} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="flex-1 py-2 rounded-lg border-none cursor-pointer text-[0.625rem] font-black uppercase">Uložit</button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* --- Spodní lišta se šipkami a číslem stránky - hlavní ovládání
          listování, proto viditelná VŽDY, i ve fokus režimu (na rozdíl od
          horní lišty s nastavením/obsahem/záložkami). --- */}
      <div className="shrink-0 flex items-center justify-center gap-5 py-2 sm:py-3">
        <button
          onClick={prevPage}
          disabled={currentPage <= 1}
          style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
          className="w-10 h-10 rounded-full border flex items-center justify-center cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed shadow-sm"
        >
          <ChevronLeft size={18} />
        </button>
        <span style={{ color: readingText }} className="text-xs font-black tabular-nums min-w-[64px] text-center">
          {currentPage} / {totalLabel}
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
        <div className={`shrink-0 px-4 pb-3 max-w-2xl mx-auto w-full ${isLastPage ? '' : 'hidden sm:block'}`}>
          <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="border rounded-xl p-3 flex items-center justify-center gap-3 flex-wrap">
            <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider opacity-70">Ohodnotit knihu:</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => handleRate(n)} disabled={savingRating} className="bg-transparent border-none cursor-pointer p-0.5 disabled:cursor-not-allowed">
                  <Star size={18} className={n <= myRating ? "fill-amber-400 text-amber-400" : "text-amber-400 opacity-30"} />
                </button>
              ))}
            </div>
            {book.ratings_count > 0 && (
              <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] opacity-60">({parseFloat(book.avg_rating || 0).toFixed(1)} ⭐, {book.ratings_count})</span>
            )}
          </div>
          <p style={{ color: 'var(--text-muted)' }} className="hidden sm:block text-center text-[0.625rem] opacity-40 mt-2">
            Ťukni do krajů pro listování · vyber text pro zvýraznění · mezerník/šipky · B záložka · F fokus
          </p>
        </div>
      )}
    </div>
  );
};
