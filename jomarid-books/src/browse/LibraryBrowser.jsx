import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownAZ, BookOpen, Check, Coins, Heart, Library, Lock, Search, Star, X } from 'lucide-react';
import { useTour } from '../tour/TourProvider';
import { PAGE_SIZE, czCount } from './browseModel.js';
import {
  SORT_OPTIONS, STATUS_FILTERS, bookAction, filterBooks, genreCounts, isInProgress, sanitizeRestoredState, sortBooks, statusCounts,
} from './libraryModel.js';
import { readLibraryState, readViewMode, writeLibraryState, writeViewMode } from './browseStore.js';
import { usePagedList } from './usePagedList.js';
import { BackToTop, BookCover, LoadMore, ViewToggle } from './BrowseParts.jsx';

// Procházení knihovny: přepínač Všechny / Moje / Rozečtené / Dočtené, hledání, řazení, žánry, mřížka (na telefonu
// dva sloupce) nebo seznam, postupné načítání a zapamatování, kde čtenář skončil. Data, nákup a lajky řeší UserLibrary.

const card = { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' };
const pct = (book) => Math.min(100, Math.max(0, Math.round(book.scrollPosition)));
const detailLabel = (book) => `Detail knihy: ${book.title}${isInProgress(book) ? `, přečteno ${pct(book)} %` : ''}`;

const ProgressBar = ({ value }) => (
  <span aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-1.5 block bg-black/40">
    <span className="block h-full bg-white/90" style={{ width: `${value}%` }} />
  </span>
);

const LikeButton = ({ book, onLike, className = '' }) => (
  <button
    type="button"
    onClick={() => onLike(book)}
    aria-pressed={book.isLiked}
    aria-label={`${book.isLiked ? 'Odebrat lajk' : 'Dát lajk'}: ${book.title}`}
    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }}
    className={`border px-2 h-7 rounded-lg text-[11px] font-black flex items-center gap-1 cursor-pointer ${className}`}
  >
    <Heart size={11} className={book.isLiked ? 'fill-red-500 text-red-500' : 'text-red-500'} />
    <span className="tabular-nums">{book.likesCount}</span>
  </button>
);

// Stav knihy na obálce: zámek u nevlastněných, "Dočteno" u přečtených (rozečtené mají pruh dole).
const StateBadge = ({ book, mini }) => {
  if (!book.hasAccess) {
    return (
      <span title="Zatím nevlastníš" className={`absolute bg-black/50 text-white rounded-full flex items-center justify-center ${mini ? 'bottom-1 left-1 w-5 h-5' : 'bottom-2 left-2 w-6 h-6'}`}>
        <Lock size={mini ? 10 : 12} />
        <span className="sr-only">Zatím nevlastníš</span>
      </span>
    );
  }
  if (book.isRead) {
    return mini ? (
      <span title="Dočteno" className="absolute bottom-1 left-1 w-5 h-5 rounded-full bg-black/50 text-emerald-300 flex items-center justify-center">
        <Check size={11} /><span className="sr-only">Dočteno</span>
      </span>
    ) : (
      <span className="absolute bottom-2 left-2 h-6 px-2 rounded-full bg-black/50 text-white text-[10px] font-black uppercase flex items-center gap-1">
        <Check size={12} className="text-emerald-300" /> Dočteno
      </span>
    );
  }
  return null;
};

// Hlavní tlačítko u knihy: čtení je odkaz na čtečku, nákup otevře detail (tam je potvrzení).
const ActionButton = ({ book, action, onOpen, compact }) => {
  const size = compact ? 'px-3 py-2 min-w-[5.5rem]' : 'w-full py-2 sm:py-2.5';
  const base = `${size} rounded-xl font-black text-[10px] uppercase tracking-wider border-none cursor-pointer flex items-center justify-center gap-1 no-underline`;
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
    <article data-testid="library-card" style={card} className="h-full border rounded-2xl overflow-hidden flex flex-col hover:shadow-lg transition-shadow">
      <div className="relative">
        <button type="button" onClick={() => onOpen(book)} aria-label={detailLabel(book)} className="block w-full p-0 border-none bg-transparent cursor-pointer">
          <BookCover title={book.title} seed={book.id} className="aspect-[3/4] w-full">
            {book.avgRating > 0 && (
              <span style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }} className="absolute top-2 left-2 border px-2 h-7 rounded-lg text-[11px] font-black flex items-center gap-1">
                <Star size={11} className="fill-amber-400 text-amber-400" />
                <span className="tabular-nums">{book.avgRating.toFixed(1)}</span>
              </span>
            )}
            <StateBadge book={book} />
            {isInProgress(book) && <ProgressBar value={pct(book)} />}
          </BookCover>
        </button>
        <LikeButton book={book} onLike={onLike} className="absolute top-2 right-2" />
      </div>
      <div className="p-2.5 sm:p-3 flex flex-col gap-0.5 flex-1">
        <button
          type="button"
          onClick={() => onOpen(book)}
          style={{ color: 'var(--text-body)' }}
          className="text-left p-0 border-none bg-transparent cursor-pointer font-black uppercase text-[12px] sm:text-sm tracking-tight leading-snug line-clamp-2 break-words hover:opacity-70"
        >
          {book.title}
        </button>
        <p style={{ color: 'var(--text-muted)' }} className="text-[11px] sm:text-xs font-bold m-0 truncate">{book.author}</p>
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
    <article data-testid="library-row" style={card} className="border rounded-2xl p-2.5 flex gap-3 hover:shadow-md transition-shadow">
      <button type="button" onClick={() => onOpen(book)} aria-label={detailLabel(book)} className="shrink-0 self-start p-0 border-none bg-transparent cursor-pointer rounded-lg overflow-hidden">
        <BookCover title={book.title} seed={book.id} className="w-14 h-[74px] rounded-lg" textClass="text-lg">
          <StateBadge book={book} mini />
          {isInProgress(book) && <ProgressBar value={pct(book)} />}
        </BookCover>
      </button>
      <div className="min-w-0 flex-1 flex flex-col">
        <button
          type="button"
          onClick={() => onOpen(book)}
          style={{ color: 'var(--text-body)' }}
          className="block w-full text-left p-0 border-none bg-transparent cursor-pointer font-black uppercase text-[12px] sm:text-[13px] tracking-tight leading-snug line-clamp-2 break-words hover:opacity-70"
        >
          {book.title}
        </button>
        <p style={{ color: 'var(--text-muted)' }} className="text-[11px] sm:text-xs font-bold m-0 mt-0.5 truncate">{book.author}</p>
        <div className="flex items-center justify-between gap-2 mt-auto pt-2">
          <div className="flex items-center gap-x-3 min-w-0 text-[11px] font-bold">
            {book.avgRating > 0 && (
              <span className="inline-flex items-center gap-1 shrink-0 max-[359px]:hidden">
                <Star size={11} className="fill-amber-400 text-amber-400" /> <span className="tabular-nums">{book.avgRating.toFixed(1)}</span>
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
    className="shrink-0 px-3 py-1.5 rounded-full font-black text-[10px] uppercase border-none cursor-pointer transition-all flex items-center gap-1.5"
  >
    {children}
  </button>
);

export const LibraryBrowser = ({ books, coins, userId, onOpenDetail, onToggleLike }) => {
  const tour = useTour();
  // Stav z předchozí návštěvy (návrat z čtečky, obnovení stránky); platí jen pro tohoto uživatele a jen pár minut.
  const [initial] = useState(() => sanitizeRestoredState(readLibraryState(userId), books));
  const [view, setView] = useState(() => readViewMode());
  const [status, setStatus] = useState(initial?.status ?? 'all');
  const [genre, setGenre] = useState(initial?.genre ?? 'all');
  const [query, setQuery] = useState(initial?.query ?? '');
  const [sort, setSort] = useState(initial?.sort ?? 'smart');

  const counts = useMemo(() => statusCounts(books), [books]);
  const genres = useMemo(() => genreCounts(books, { status, query }), [books, status, query]);
  const filtered = useMemo(() => sortBooks(filterBooks(books, { status, genre, query }), sort), [books, status, genre, query, sort]);
  // Vybraný žánr zůstane mezi tlačítky i tehdy, když v aktuálním výběru nic nemá, ať jde zrušit.
  const genreChips = genre !== 'all' && !genres.some((g) => g.genre === genre) ? [...genres, { genre, count: 0 }] : genres;

  const paged = usePagedList(filtered, {
    pageSize: PAGE_SIZE[view],
    resetKey: `${view}|${status}|${genre}|${query}|${sort}`,
    initialVisible: initial?.visible || 0,
  });

  // Zapamatování stavu: změny filtrů a rozbalení hned, poloha při scrollování (nejvýš jednou za 200 ms).
  const latest = useRef(null);
  latest.current = { sort, status, genre, query, visible: paged.count };
  const scrollY = useRef(initial?.scrollY || 0);
  const saveTimer = useRef(0);
  const save = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    writeLibraryState(userId, { ...latest.current, scrollY: scrollY.current });
  }, [userId]);
  useEffect(() => { save(); }, [save, sort, status, genre, query, paged.count]);
  useEffect(() => {
    const onScroll = () => {
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseView = (mode) => { setView(mode); writeViewMode(mode); };
  const hasFilters = status !== 'all' || genre !== 'all' || query.trim() !== '';
  const resetFilters = () => { setStatus('all'); setGenre('all'); setQuery(''); };
  const total = books.length;
  const summary = filtered.length === total ? czCount(total, 'kniha', 'knihy', 'knih') : `${czCount(filtered.length, 'kniha', 'knihy', 'knih')} z ${total}`;
  const Item = view === 'grid' ? BookCard : BookRow;

  return (
    <>
      <section aria-label="Procházení knihovny" className="space-y-3">
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
                className="shrink-0 px-3.5 py-2 border rounded-xl font-black text-[11px] uppercase tracking-wide cursor-pointer transition-all flex items-center gap-2"
              >
                {f.label} <span className="tabular-nums opacity-60">{counts[f.key]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-3 lg:flex-1 min-w-0">
          <div data-tour="library-search" style={card} className="border rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 flex-1 min-w-0">
            <Search size={15} style={{ color: 'var(--text-muted)' }} className="opacity-50 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat podle názvu nebo autora..."
              aria-label="Hledat v knihovně"
              autoComplete="off"
              enterKeyHint="search"
              style={{ color: 'var(--text-body)' }}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm font-medium placeholder:opacity-40"
            />
            {query && (
              <button type="button" aria-label="Smazat hledání" onClick={() => setQuery('')} className="bg-transparent border-none cursor-pointer p-0.5 opacity-50 hover:opacity-100" style={{ color: 'var(--text-body)' }}>
                <X size={14} />
              </button>
            )}
          </div>
          <ViewToggle value={view} onChange={chooseView} />
        </div>
        </div>

        {genreChips.length > 0 && (
          <div role="group" aria-label="Žánr" className="flex gap-2 overflow-x-auto sm:flex-wrap scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
            <Chip active={genre === 'all'} onClick={() => setGenre('all')}>Všechny žánry</Chip>
            {genreChips.map((g) => (
              <Chip key={g.genre} active={genre === g.genre} onClick={() => setGenre(g.genre)}>
                {g.genre} <span className="tabular-nums opacity-60">{g.count}</span>
              </Chip>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 min-h-[2rem]">
          <p role="status" data-testid="library-summary" style={{ color: 'var(--text-muted)' }} className="text-xs font-bold m-0 min-w-0">{summary}</p>
          <div className="flex items-center gap-1 min-w-0">
            {hasFilters && (
              <button type="button" data-testid="reset-filters" onClick={resetFilters} style={{ color: 'var(--text-body)' }} className="bg-transparent border-none cursor-pointer text-[11px] font-black uppercase tracking-wide underline underline-offset-2 hover:opacity-70 p-1.5 shrink-0">
                Zrušit filtry
              </button>
            )}
            <label className="flex items-center gap-1.5 min-w-0 cursor-pointer">
              <ArrowDownAZ size={15} style={{ color: 'var(--text-muted)' }} className="opacity-60 shrink-0" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Řazení"
                style={{ color: 'var(--text-body)', backgroundColor: 'transparent' }}
                className="border-none outline-none text-xs font-bold cursor-pointer py-1.5 min-w-0"
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
            <p style={{ color: 'var(--text-muted)' }} className="text-sm font-bold opacity-70 m-0 break-words max-w-full">
              {query.trim() ? `Nic neodpovídá hledání "${query.trim()}".` : 'V tomhle výběru zatím nic není.'}
            </p>
            {hasFilters && (
              <button type="button" onClick={resetFilters} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="px-5 py-2.5 rounded-xl border-none font-black text-[11px] uppercase tracking-wider cursor-pointer">
                Zrušit filtry
              </button>
            )}
          </div>
        ) : (
          <ul
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

        <LoadMore paged={paged} className="pt-3" />
      </section>
      <BackToTop />
    </>
  );
};
