import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownAZ, BookOpen, Check, Coins, Heart, Library, Lock, Search, Star, X } from 'lucide-react';
import { useTour } from '../tour/TourProvider';
import { PAGE_SIZE, czCount, restoredVisible } from './browseModel.js';
import {
  SORT_OPTIONS, STATUS_FILTERS, bookAction, bookStateText, filterBooks, fmtRating, genreCounts, isInProgress, sanitizeRestoredState,
  sortBooks, splitGenres, statusCounts,
} from './libraryModel.js';
import { readLibraryPrefs, readLibraryState, writeLibraryState, writeViewMode } from './browseStore.js';
import { usePagedList } from './usePagedList.js';
import { BackToTop, BookCover, LoadMore, ViewToggle } from './BrowseParts.jsx';

// Procházení knihovny: přepínač Všechny / Moje / Rozečtené / Dočtené, hledání, řazení, žánry, mřížka (na telefonu
// dva sloupce) nebo seznam, postupné načítání a zapamatování, kde čtenář skončil. Data, nákup a lajky řeší UserLibrary.

const card = { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' };
const pct = (book) => Math.min(100, Math.max(0, Math.round(book.scrollPosition)));
// Kroužek zvýraznění kolem pole, ve kterém je fokus (vstupní pole samotná mají outline vypnutý).
const focusRing = 'focus-within:ring-2 focus-within:ring-[color:var(--bg-primary)]';

const ProgressBar = ({ value }) => (
  <span aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-1.5 block bg-black/40">
    <span className="block h-full bg-white/90" style={{ width: `${value}%` }} />
  </span>
);

// Lajk je přepínač: název je stále stejný a stav nese aria-pressed (počet je součástí názvu, ať ho čtečka přečte).
const LikeButton = ({ book, onLike, className = '' }) => (
  <button
    type="button"
    onClick={() => onLike(book)}
    aria-pressed={book.isLiked}
    aria-label={`Líbí se mi: ${book.title} (${book.likesCount})`}
    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }}
    className={`border px-2.5 h-8 rounded-lg text-[0.6875rem] font-black flex items-center gap-1 cursor-pointer ${className}`}
  >
    <Heart size={11} className={book.isLiked ? 'fill-red-500 text-red-500' : 'text-red-500'} />
    <span className="tabular-nums">{book.likesCount}</span>
  </button>
);

// Stav knihy na obálce: zámek u nevlastněných, "Dočteno" u přečtených (rozečtené mají pruh dole). Čtečky obrazovky
// stav slyší u názvu knihy (bookStateText), obálka je jen obrázek.
const StateBadge = ({ book, mini }) => {
  if (!book.hasAccess) {
    return (
      <span title="Zatím nevlastníš" className={`absolute bg-black/50 text-white rounded-full flex items-center justify-center ${mini ? 'bottom-1 left-1 w-5 h-5' : 'bottom-2 left-2 w-6 h-6'}`}>
        <Lock size={mini ? 10 : 12} />
      </span>
    );
  }
  if (book.isRead) {
    return mini ? (
      <span title="Dočteno" className="absolute bottom-1 left-1 w-5 h-5 rounded-full bg-black/50 text-emerald-300 flex items-center justify-center">
        <Check size={11} />
      </span>
    ) : (
      <span className="absolute bottom-2 left-2 h-6 px-2 rounded-full bg-black/50 text-white text-[0.625rem] font-black uppercase flex items-center gap-1">
        <Check size={12} className="text-emerald-300" /> Dočteno
      </span>
    );
  }
  return null;
};

// Název knihy: tlačítko, které otevře detail. Je to jediný ovladač detailu pro klávesnici a čtečky (obálka je jen
// větší plocha pro myš a prst), a nese i stav knihy slovy.
const TitleButton = ({ book, onOpen, className }) => {
  const state = bookStateText(book);
  return (
    <button type="button" data-title-button onClick={() => onOpen(book)} style={{ color: 'var(--text-body)' }} className={`text-left p-0 border-none bg-transparent cursor-pointer font-black uppercase tracking-tight leading-snug line-clamp-2 break-words hover:opacity-70 ${className}`}>
      {book.title}
      {state && <span className="sr-only">. {state}</span>}
    </button>
  );
};

// Hlavní tlačítko u knihy: čtení je odkaz na čtečku, nákup otevře detail (tam je potvrzení).
const ActionButton = ({ book, action, onOpen, compact }) => {
  const size = compact ? 'px-3 py-2.5 min-w-[5.5rem]' : 'w-full py-2.5 sm:py-3';
  const base = `${size} rounded-xl font-black text-[0.625rem] uppercase tracking-wider border-none cursor-pointer flex items-center justify-center gap-1 no-underline`;
  const text = compact ? action.short : action.label;
  if (action.kind === 'read') {
    return (
      <Link to={`/read/${book.id}`} style={{ backgroundColor: 'var(--text-body)', color: 'var(--bg-body)' }} className={base}>
        <BookOpen size={12} className="shrink-0" /> {text}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(book)}
      style={{ backgroundColor: action.affordable ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: action.affordable ? 'var(--text-primary)' : 'var(--text-muted)' }}
      className={base}
    >
      {text} <Coins size={12} className="shrink-0" />
    </button>
  );
};

const BookCard = memo(function BookCard({ book, coins, onOpen, onLike }) {
  const action = bookAction(book, coins);
  return (
    <article data-testid="library-card" data-book-id={book.id} style={card} className="h-full border rounded-2xl overflow-hidden flex flex-col hover:shadow-lg transition-shadow">
      <div className="relative">
        {/* Obálka je klepací plocha pro myš a prst; pro klávesnici a čtečky slouží tlačítko s názvem (jinak by byly dva ovladače téhož). */}
        <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => onOpen(book)} className="block w-full p-0 border-none bg-transparent cursor-pointer">
          <BookCover title={book.title} seed={book.id} className="aspect-[3/4] w-full">
            {book.avgRating > 0 && (
              <span style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }} className="absolute top-2 left-2 border px-2 h-7 rounded-lg text-[0.6875rem] font-black flex items-center gap-1">
                <Star size={11} className="fill-amber-400 text-amber-400" />
                <span className="tabular-nums">{fmtRating(book.avgRating)}</span>
              </span>
            )}
            <StateBadge book={book} />
            {isInProgress(book) && <ProgressBar value={pct(book)} />}
          </BookCover>
        </button>
        <LikeButton book={book} onLike={onLike} className="absolute top-2 right-2" />
      </div>
      <div className="p-2.5 sm:p-3 flex flex-col gap-0.5 flex-1">
        <TitleButton book={book} onOpen={onOpen} className="text-[0.75rem] sm:text-sm" />
        <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] sm:text-xs font-bold m-0 truncate">{book.author}</p>
        <div className="mt-auto pt-2">
          <ActionButton book={book} action={action} onOpen={onOpen} />
        </div>
      </div>
    </article>
  );
});

const BookRow = memo(function BookRow({ book, coins, onOpen, onLike }) {
  const action = bookAction(book, coins);
  return (
    <article data-testid="library-row" data-book-id={book.id} style={card} className="border rounded-2xl p-2.5 flex gap-3 hover:shadow-md transition-shadow">
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => onOpen(book)} className="shrink-0 self-start p-0 border-none bg-transparent cursor-pointer rounded-lg overflow-hidden">
        <BookCover title={book.title} seed={book.id} className="w-14 h-[74px] rounded-lg" textClass="text-lg">
          <StateBadge book={book} mini />
          {isInProgress(book) && <ProgressBar value={pct(book)} />}
        </BookCover>
      </button>
      <div className="min-w-0 flex-1 flex flex-col">
        <TitleButton book={book} onOpen={onOpen} className="w-full text-[0.75rem] sm:text-[0.8125rem]" />
        <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] sm:text-xs font-bold m-0 mt-0.5 truncate">{book.author}</p>
        <div className="flex items-center justify-between gap-2 mt-auto pt-2">
          <div className="flex items-center gap-x-3 min-w-0 text-[0.6875rem] font-bold">
            {book.avgRating > 0 && (
              <span className="inline-flex items-center gap-1 shrink-0 max-[359px]:hidden">
                <Star size={11} className="fill-amber-400 text-amber-400" /> <span className="tabular-nums">{fmtRating(book.avgRating)}</span>
              </span>
            )}
            <LikeButton book={book} onLike={onLike} />
            {book.genres[0] && <span style={{ color: 'var(--text-muted)' }} className="truncate hidden min-[430px]:inline">{book.genres[0]}</span>}
          </div>
          <div className="shrink-0">
            <ActionButton book={book} action={action} onOpen={onOpen} compact />
          </div>
        </div>
      </div>
    </article>
  );
});

const Chip = ({ active, onClick, children }) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    style={{ backgroundColor: active ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}
    className="shrink-0 px-3 py-2 rounded-full font-black text-[0.625rem] uppercase border-none cursor-pointer transition-all flex items-center gap-1.5"
  >
    {children}
  </button>
);

export const LibraryBrowser = ({ books, coins, userId, onOpenDetail, onToggleLike }) => {
  const tour = useTour();
  // Výchozí chování z Nastavení (pohled, řazení, filtr, pamatování stavu).
  const [prefs] = useState(() => readLibraryPrefs());
  // Stav z předchozí návštěvy (návrat z čtečky, obnovení stránky); platí jen pro tohoto uživatele a jen pár hodin.
  const [initial] = useState(() => (prefs.remember ? sanitizeRestoredState(readLibraryState(userId), books) : null));
  const [view, setView] = useState(prefs.view);
  const [status, setStatus] = useState(initial?.status ?? prefs.status);
  const [genre, setGenre] = useState(initial?.genre ?? 'all');
  const [query, setQuery] = useState(initial?.query ?? '');
  const [sort, setSort] = useState(initial?.sort ?? prefs.sort);
  // Pole s hledáním se přepíše hned, těžší výpočty seznamu a žánrů za ním mohou na pomalém telefonu o chvilku zaostat.
  const deferredQuery = useDeferredValue(query);

  const counts = useMemo(() => statusCounts(books), [books]);
  // Řazení je zvlášť: při psaní do hledání se nemění, takže se při každém písmenu nepřerazuje celý katalog.
  const sorted = useMemo(() => sortBooks(books, sort), [books, sort]);
  const genres = useMemo(() => genreCounts(books, { status, query: deferredQuery }), [books, status, deferredQuery]);
  const filtered = useMemo(() => filterBooks(sorted, { status, genre, query: deferredQuery }), [sorted, status, genre, deferredQuery]);
  // Nejčastější žánry jako tlačítka, zbytek v rozbalovátku; vybraný žánr zůstane mezi tlačítky i bez knih, ať jde zrušit.
  const { chips: genreChips, rest: moreGenres } = useMemo(() => splitGenres(genres, genre), [genres, genre]);
  const moreActive = genre !== 'all' && moreGenres.some((g) => g.genre === genre); // vybraný žánr je v rozbalovátku

  const paged = usePagedList(filtered, {
    pageSize: PAGE_SIZE[view],
    resetKey: `${view}|${status}|${genre}|${deferredQuery}|${sort}`,
    initialVisible: restoredVisible(initial?.visible, PAGE_SIZE[view]),
  });

  // Zapamatování stavu: změny filtrů a rozbalení hned, poloha při scrollování (nejvýš jednou za 200 ms).
  const latest = useRef(null);
  latest.current = { sort, status, genre, query, visible: paged.count };
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const scrollY = useRef(initial?.scrollY || 0);
  const saveTimer = useRef(0);
  const save = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    if (prefs.remember) writeLibraryState(userId, { ...latest.current, scrollY: scrollY.current });
  }, [userId, prefs.remember]);
  useEffect(() => { save(); }, [save, sort, status, genre, query, paged.count]);
  useEffect(() => {
    const onScroll = () => {
      // Při prvním přechodu na líně načítanou stránku (čtečka, statistiky) React nechá knihovnu připojenou, ale
      // skrytou, dokud se stránka nestáhne: dokument se zmenší, prohlížeč vrátí scroll na nulu a ten by se uložil
      // jako poloha čtenáře. Skrytý seznam (display: none nemá žádné obdélníky) se proto ignoruje.
      if (!rootRef.current || rootRef.current.getClientRects().length === 0) return;
      scrollY.current = window.scrollY;
      if (!saveTimer.current) saveTimer.current = window.setTimeout(save, 200);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', save);
      // Při odchodu ze stránky už window.scrollY neříká, kde čtenář byl (obsah se právě odstraňuje), proto se
      // ukládá poslední hodnota ze scrollu, ne aktuální.
      if (saveTimer.current) save();
    };
  }, [save]);

  // Návrat na místo, kde čtenář skončil. Prohlídka si při spuštění polohu řídí sama.
  useLayoutEffect(() => {
    if (initial?.scrollY && !tour?.running) window.scrollTo(0, initial.scrollY);
    // Skutečná poloha (prohlížeč ji mohl srovnat nebo obnovit sám), ne cíl; jinak by se cíl ukládal dál, i kdyby už neplatil.
    scrollY.current = window.scrollY;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseView = (mode) => { setView(mode); writeViewMode(mode); };
  const hasFilters = status !== 'all' || genre !== 'all' || query.trim() !== '';
  // Tlačítko, které zmizí (zrušení filtrů), nesmí odnést fokus na <body>: fokus přejde na začátek knihovny
  // (na telefonu to nevyvolá klávesnici jako fokus do hledání).
  const resetFilters = () => { setStatus('all'); setGenre('all'); setQuery(''); rootRef.current?.focus({ preventScroll: true }); };
  const clearSearch = () => { setQuery(''); searchRef.current?.focus(); };
  // Po "Zobrazit další" se fokus přesune na první novou položku (jinak zůstane na tlačítku, které odjede dolů).
  const focusNewItem = (before) => window.requestAnimationFrame(() => {
    listRef.current?.children[before]?.querySelector('button.line-clamp-2')?.focus({ preventScroll: false });
  });
  const total = books.length;
  const summary = filtered.length === total ? czCount(total, 'kniha', 'knihy', 'knih') : `${czCount(filtered.length, 'kniha', 'knihy', 'knih')} z ${total}`;
  const Item = view === 'grid' ? BookCard : BookRow;

  return (
    <>
      <section ref={rootRef} tabIndex={-1} aria-label="Procházení knihovny" className="space-y-3 focus:outline-none">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div role="group" aria-label="Které knihy zobrazit" className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 lg:shrink-0 lg:overflow-visible">
            {STATUS_FILTERS.map((f) => {
              const active = status === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  data-testid={`status-${f.key}`}
                  onClick={() => setStatus(f.key)}
                  style={{ backgroundColor: active ? 'var(--text-body)' : 'var(--bg-secondary)', color: active ? 'var(--bg-body)' : 'var(--text-body)', borderColor: 'var(--border-color)' }}
                  className="shrink-0 px-3.5 py-2.5 border rounded-xl font-black text-[0.6875rem] uppercase tracking-wide cursor-pointer transition-all flex items-center gap-2"
                >
                  {f.label} <span className="tabular-nums font-bold">{counts[f.key]}</span>
                </button>
              );
            })}
          </div>

          <div className="flex gap-3 lg:flex-1 min-w-0">
            {/* label: klepnutí kamkoli do rámečku (i na lupu a okraje) zaostří do pole, ne jen na řádek textu */}
            <label data-tour="library-search" style={card} className={`border rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 flex-1 min-w-0 cursor-text ${focusRing}`}>
              <Search size={15} style={{ color: 'var(--text-muted)' }} className="opacity-50 shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Enter schová klávesnici na telefonu, ať jsou vidět výsledky (výběr se mění už při psaní). S myší a
                // klávesnicí pole zůstane zaostřené, jinak by fokus spadl na <body>.
                onKeyDown={(e) => { if (e.key === 'Enter' && window.matchMedia?.('(pointer: coarse)').matches) e.currentTarget.blur(); }}
                placeholder="Hledat podle názvu nebo autora..."
                aria-label="Hledat v knihovně"
                autoComplete="off"
                enterKeyHint="search"
                style={{ color: 'var(--text-body)' }}
                className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm font-medium placeholder:opacity-100 placeholder:text-[color:var(--text-muted)]"
              />
              {query && (
                <button type="button" aria-label="Smazat hledání" onClick={clearSearch} className="bg-transparent border-none cursor-pointer p-1.5 -mr-1.5 opacity-60 hover:opacity-100" style={{ color: 'var(--text-body)' }}>
                  <X size={14} />
                </button>
              )}
            </label>
            <ViewToggle value={view} onChange={chooseView} />
          </div>
        </div>

        {genreChips.length > 0 && (
          <div role="group" aria-label="Žánr" className="flex gap-2 overflow-x-auto sm:flex-wrap scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
            <Chip active={genre === 'all'} onClick={() => setGenre('all')}>Všechny žánry</Chip>
            {genreChips.map((g) => (
              <Chip key={g.genre} active={genre === g.genre} onClick={() => setGenre(g.genre)}>
                {g.genre} <span className="tabular-nums font-bold">{g.count}</span>
              </Chip>
            ))}
            {moreGenres.length > 0 && (
              <select
                value={moreActive ? genre : ''}
                onChange={(e) => setGenre(e.target.value || 'all')}
                aria-label={`Další žánry (${moreGenres.length})`}
                data-testid="more-genres"
                style={{ backgroundColor: moreActive ? 'var(--text-body)' : 'var(--bg-secondary)', color: moreActive ? 'var(--bg-body)' : 'var(--text-muted)' }}
                className="shrink-0 px-3 py-2 rounded-full font-black text-[0.625rem] uppercase border-none cursor-pointer max-w-[11rem]"
              >
                <option value="">Další žánry ({moreGenres.length})</option>
                {moreGenres.map((g) => <option key={g.genre} value={g.genre}>{g.genre} ({g.count})</option>)}
              </select>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-h-[2rem]">
          <p role="status" data-testid="library-summary" style={{ color: 'var(--text-muted)' }} className="text-xs font-bold m-0 whitespace-nowrap">{summary}</p>
          <div className="flex items-center gap-1 min-w-0">
            {hasFilters && (
              <button type="button" data-testid="reset-filters" onClick={resetFilters} style={{ color: 'var(--text-body)' }} className="bg-transparent border-none cursor-pointer text-[0.6875rem] font-black uppercase tracking-wide underline underline-offset-2 hover:opacity-70 p-2 shrink-0">
                Zrušit filtry
              </button>
            )}
            <label className={`flex items-center gap-1.5 min-w-0 cursor-pointer rounded-lg px-1 ${focusRing}`}>
              <ArrowDownAZ size={15} style={{ color: 'var(--text-muted)' }} className="opacity-60 shrink-0" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Řazení"
                style={{ color: 'var(--text-body)', backgroundColor: 'transparent' }}
                className="border-none outline-none text-xs font-bold cursor-pointer py-2 min-w-0"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key} style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }}>{opt.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={card} className="border rounded-2xl py-16 px-4 flex flex-col items-center gap-3 text-center">
            <Library size={32} style={{ color: 'var(--text-muted)' }} className="opacity-30" />
            <p style={{ color: 'var(--text-muted)' }} className="text-sm font-bold m-0 break-words max-w-full">
              {total === 0 ? 'V katalogu zatím nejsou žádné knihy.' : query.trim() ? `Nic neodpovídá hledání "${query.trim()}".` : 'V tomhle výběru zatím nic není.'}
            </p>
            {hasFilters && (
              <button type="button" onClick={resetFilters} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="px-5 py-2.5 rounded-xl border-none font-black text-[0.6875rem] uppercase tracking-wider cursor-pointer">
                Zrušit filtry
              </button>
            )}
          </div>
        ) : (
          <ul
            ref={listRef}
            role="list"
            data-testid={view === 'grid' ? 'library-grid' : 'library-list'}
            className={`list-none p-0 m-0 grid gap-3 ${view === 'grid' ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 sm:gap-5' : 'grid-cols-1 lg:grid-cols-2 gap-2.5'}`}
          >
            {paged.items.map((b) => (
              <li key={b.id} className="min-w-0">
                <Item book={b} coins={coins} onOpen={onOpenDetail} onLike={onToggleLike} />
              </li>
            ))}
          </ul>
        )}

        <LoadMore paged={paged} className="pt-3" onMore={focusNewItem} />
      </section>
      <BackToTop focusRef={rootRef} />
    </>
  );
};
