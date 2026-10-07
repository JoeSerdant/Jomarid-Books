import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { loadCatalog } from '../browse/libraryData';
import { ChevronRight, Loader2, Search, X, SlidersHorizontal, Star, Heart, RotateCcw, History, Library, Globe } from 'lucide-react';

const PREFS_KEY = 'jomarid-search-prefs';
const RECENT_KEY = 'jomarid-search-recent';
const PAGE_SIZE = 20;
const DAY_MS = 86400000;

export const DEFAULT_SEARCH_PREFS = {
  scope: 'mine',        // mine = knihy, ke kterým mám přístup | catalog = celý katalog
  sort: 'smart',
  fields: ['title', 'author', 'genres'],
  genres: [], genreMode: 'any',
  progress: 'all',      // all | unread | reading | read
  ownership: 'all',     // all | owned | notOwned | published
  priceMode: 'all',     // all | free | paid
  maxPrice: null,
  affordable: false,
  minRating: 0,
  ratedOnly: false,
  author: 'all',
  addedWithin: 0,
  likedOnly: false,
};

const FIELD_OPTIONS = [['title', 'Název'], ['author', 'Autor'], ['genres', 'Žánry'], ['description', 'Popis']];
const SORT_OPTIONS = [
  ['smart', 'Nejrelevantnější'], ['recent', 'Naposledy čtené'], ['title_asc', 'Název A-Z'], ['title_desc', 'Název Z-A'], ['author_asc', 'Autor A-Z'],
  ['newest', 'Nejnovější'], ['oldest', 'Nejstarší'], ['price_asc', 'Cena: od nejlevnější'], ['price_desc', 'Cena: od nejdražší'],
  ['rating_desc', 'Nejlépe hodnocené'], ['ratings_count_desc', 'Nejvíc hodnocení'], ['likes_desc', 'Nejoblíbenější'],
];
const DATE_SORTS = ['newest', 'oldest'];

// Bez diakritiky a bez ohledu na velikost písmen: "vitej" musí najít "Vítej".
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const cs = (a, b) => String(a).localeCompare(String(b), 'cs');

// Lajky pro buildSearchItems: buď seznam všech lajků (řádky book_likes), nebo hotové { count(kniha), liked(id) } z
// načtení katalogu (loadCatalog), které nestahuje lajky všech čtenářů.
const likeInfoFromRows = (rows, userId) => {
  const likeCount = new Map();
  const mine = new Set();
  rows.forEach(l => {
    likeCount.set(l.book_id, (likeCount.get(l.book_id) || 0) + 1);
    if (l.user_id === userId) mine.add(l.book_id);
  });
  return { count: (b) => likeCount.get(b.id) || 0, liked: (id) => mine.has(id) };
};

// Z řádků z databáze udělá jednotný tvar, nad kterým se hledá a filtruje.
export const buildSearchItems = (books, userBooks, likes, userId) => {
  const ubMap = new Map(userBooks.map(ub => [ub.book_id, ub]));
  const likeInfo = Array.isArray(likes) ? likeInfoFromRows(likes, userId) : likes;
  return books.map(b => {
    const ub = ubMap.get(b.id);
    const isOwn = !!b.author_id && b.author_id === userId;
    // Stejná definice přístupu jako v UserLibrary/ReaderPage: vlastník, automaticky
    // přiřazená kniha, nebo aktivní licence.
    const owned = isOwn || !!b.is_auto_assigned || ub?.status === 'active';
    const genres = Array.isArray(b.genres) ? b.genres : [];
    const authorName = b.author_display || b.author || '';
    const price = b.is_auto_assigned ? 0 : (parseInt(b.price_coins, 10) || 0);
    const progress = ub ? Math.round(parseFloat(ub.scroll_position) || 0) : 0;
    const read = !!ub?.is_read;
    return {
      id: b.id, title: b.title || '', authorName, description: b.description || '', genres,
      price, owned, isOwn, read, progress, inProgress: owned && !read && progress > 0,
      liked: likeInfo.liked(b.id), likes: likeInfo.count(b) + (parseInt(b.fake_likes, 10) || 0),
      rating: parseFloat(b.avg_rating) || 0, ratingsCount: parseInt(b.ratings_count, 10) || 0,
      createdAt: b.created_at ? new Date(b.created_at).getTime() : null,
      lastReadAt: ub?.updated_at ? new Date(ub.updated_at).getTime() : 0,
      f: { title: fold(b.title), author: fold(`${authorName} ${b.author || ''}`), genres: fold(genres.join(' ')), description: fold(b.description) },
    };
  });
};

const relevance = (it, tokens, fields) => {
  let score = 0;
  tokens.forEach(t => {
    const title = it.f.title;
    if (fields.includes('title')) {
      if (title === t) score += 10;
      else if (title.startsWith(t)) score += 6;
      else if (title.split(/\s+/).some(w => w.startsWith(t))) score += 4;
      else if (title.includes(t)) score += 3;
    }
    if (fields.includes('author') && it.f.author.includes(t)) score += 2;
    if (fields.includes('genres') && it.f.genres.includes(t)) score += 2;
    if (fields.includes('description') && it.f.description.includes(t)) score += 1;
  });
  if (tokens.length > 1 && fields.includes('title') && it.f.title.includes(tokens.join(' '))) score += 3;
  return score;
};

const SORTERS = {
  title_asc: (a, b) => cs(a.title, b.title),
  title_desc: (a, b) => cs(b.title, a.title),
  author_asc: (a, b) => cs(a.authorName, b.authorName) || cs(a.title, b.title),
  newest: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || cs(a.title, b.title),
  oldest: (a, b) => (a.createdAt ?? 8.64e15) - (b.createdAt ?? 8.64e15) || cs(a.title, b.title),
  price_asc: (a, b) => a.price - b.price || cs(a.title, b.title),
  price_desc: (a, b) => b.price - a.price || cs(a.title, b.title),
  rating_desc: (a, b) => b.rating - a.rating || b.ratingsCount - a.ratingsCount || cs(a.title, b.title),
  ratings_count_desc: (a, b) => b.ratingsCount - a.ratingsCount || b.rating - a.rating || cs(a.title, b.title),
  likes_desc: (a, b) => b.likes - a.likes || cs(a.title, b.title),
  recent: (a, b) => b.lastReadAt - a.lastReadAt || cs(a.title, b.title),
};

// Čistá funkce (žádné React stavy) - dá se testovat samostatně.
export const runBookSearch = (scopeItems, prefs, tokens, coins, now = Date.now()) => {
  const fields = prefs.fields.length ? prefs.fields : ['title'];
  let list = scopeItems.filter(it => {
    // každé zadané slovo se musí najít alespoň v jednom z vybraných polí
    if (!tokens.every(t => fields.some(f => it.f[f].includes(t)))) return false;
    if (prefs.genres.length) {
      const has = (g) => it.genres.includes(g);
      if (!(prefs.genreMode === 'all' ? prefs.genres.every(has) : prefs.genres.some(has))) return false;
    }
    if (prefs.progress === 'read' && !(it.owned && it.read)) return false;
    if (prefs.progress === 'reading' && !it.inProgress) return false;
    if (prefs.progress === 'unread' && !(it.owned && !it.read && !it.inProgress)) return false;
    if (prefs.ownership === 'owned' && !it.owned) return false;
    if (prefs.ownership === 'notOwned' && it.owned) return false;
    if (prefs.ownership === 'published' && !it.isOwn) return false;
    if (prefs.priceMode === 'free' && it.price > 0) return false;
    if (prefs.priceMode === 'paid' && it.price === 0) return false;
    if (prefs.maxPrice != null && it.price > prefs.maxPrice) return false;
    if (prefs.affordable && !(it.owned || it.price <= coins)) return false;
    if (prefs.ratedOnly && it.ratingsCount === 0) return false;
    if (prefs.minRating > 0 && !(it.ratingsCount > 0 && it.rating >= prefs.minRating)) return false;
    if (prefs.author !== 'all' && it.authorName !== prefs.author) return false;
    if (prefs.addedWithin > 0 && !(it.createdAt != null && now - it.createdAt <= prefs.addedWithin * DAY_MS)) return false;
    if (prefs.likedOnly && !it.liked) return false;
    return true;
  });
  if (prefs.sort === 'smart') {
    if (tokens.length) {
      const score = new Map(list.map(it => [it.id, relevance(it, tokens, fields)]));
      list = list.sort((a, b) => score.get(b.id) - score.get(a.id) || SORTERS.recent(a, b));
    } else list = list.sort(SORTERS.recent);
  } else list = list.sort(SORTERS[prefs.sort] || SORTERS.title_asc);
  return list;
};

const loadJson = (key, fallback) => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};
// Uložené nastavení může být starší / poškozené - vezmou se jen hodnoty správného typu.
export const sanitizePrefs = (raw) => {
  const out = { ...DEFAULT_SEARCH_PREFS };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(DEFAULT_SEARCH_PREFS)) {
    const d = DEFAULT_SEARCH_PREFS[k], v = raw[k];
    if (Array.isArray(d)) { if (Array.isArray(v)) out[k] = v.filter(x => typeof x === 'string'); }
    else if (d === null) { if (typeof v === 'number' && v >= 0) out[k] = v; }
    else if (typeof v === typeof d) out[k] = v;
  }
  if (!['mine', 'catalog'].includes(out.scope)) out.scope = 'mine';
  if (!SORT_OPTIONS.some(([v]) => v === out.sort)) out.sort = 'smart';
  if (!out.fields.length) out.fields = [...DEFAULT_SEARCH_PREFS.fields];
  return out;
};

const Highlight = ({ text, tokens }) => {
  if (!tokens.length || !text) return text;
  const f = fold(text);
  if (f.length !== text.length) return text; // neobvyklý znak - raději nezvýrazňovat, než zvýraznit špatně
  const ranges = [];
  tokens.forEach(t => { let i = f.indexOf(t); while (t && i !== -1) { ranges.push([i, i + t.length]); i = f.indexOf(t, i + t.length); } });
  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0].slice()];
  ranges.slice(1).forEach(r => { const last = merged[merged.length - 1]; if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice()); });
  const parts = [];
  let pos = 0;
  merged.forEach(([s, e], i) => {
    if (s > pos) parts.push(text.slice(pos, s));
    parts.push(<mark key={i} style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="rounded px-0.5">{text.slice(s, e)}</mark>);
    pos = e;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
};

const fieldStyle = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
const Chip = ({ active, onClick, children, ...rest }) => (
  <button type="button" onClick={onClick} aria-pressed={active} {...rest}
    style={active ? { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--bg-primary)' } : fieldStyle}
    className="px-2.5 py-1 rounded-full border text-[11px] font-bold cursor-pointer whitespace-nowrap">
    {children}
  </button>
);
const Group = ({ label, children }) => (
  <div className="min-w-0">
    <p style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider m-0 mb-1.5">{label}</p>
    {children}
  </div>
);
const Select = ({ label, value, onChange, children }) => (
  <select aria-label={label} value={value} onChange={onChange} style={fieldStyle} className="w-full p-2 border rounded-lg text-xs font-bold outline-none cursor-pointer">{children}</select>
);
const Check = ({ checked, onChange, children }) => (
  <label className="flex items-center gap-2 text-xs font-bold cursor-pointer select-none">
    <input type="checkbox" checked={checked} onChange={onChange} className="cursor-pointer" style={{ accentColor: 'var(--bg-primary)' }} /> {children}
  </label>
);

export const SearchModal = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState(() => sanitizePrefs(loadJson(PREFS_KEY, null)));
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [coins, setCoins] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState(() => { const r = loadJson(RECENT_KEY, []); return Array.isArray(r) ? r.filter(x => typeof x === 'string').slice(0, 6) : []; });
  const listRef = useRef(null);
  const patch = (changes) => setPrefs(p => ({ ...p, ...changes }));

  useEffect(() => {
    if (!isOpen || !user) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    // Knihy po částech (databáze vrací najednou jen omezený počet řádků) a počty lajků jedním číslem u knihy.
    loadCatalog(supabase, user.id, { isCancelled: () => cancelled }).then(({ rows, userBooks, likes, coins: balance }) => {
      if (cancelled) return;
      setItems(buildSearchItems(rows, userBooks, likes, user.id));
      setCoins(parseInt(balance, 10) || 0);
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      console.error('Chyba při vyhledávání:', err);
      setError('Katalog se nepodařilo načíst. Zkus to prosím znovu.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [isOpen, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!isOpen) { setQuery(''); setLimit(PAGE_SIZE); setActiveIdx(0); setShowFilters(false); } }, [isOpen]);
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* úložiště nemusí být dostupné */ } }, [prefs]);
  useEffect(() => { setLimit(PAGE_SIZE); setActiveIdx(0); }, [query, prefs]);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const tokens = useMemo(() => fold(query).split(/\s+/).filter(Boolean), [query]);
  const scopeItems = useMemo(() => (prefs.scope === 'mine' ? items.filter(i => i.owned) : items), [items, prefs.scope]);
  const genreOptions = useMemo(() => {
    const counts = new Map();
    scopeItems.forEach(i => i.genres.forEach(g => counts.set(g, (counts.get(g) || 0) + 1)));
    prefs.genres.forEach(g => { if (!counts.has(g)) counts.set(g, 0); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || cs(a[0], b[0])).map(([g]) => g);
  }, [scopeItems, prefs.genres]);
  const authorOptions = useMemo(() => {
    const set = new Set(scopeItems.map(i => i.authorName).filter(Boolean));
    if (prefs.author !== 'all') set.add(prefs.author);
    return [...set].sort(cs);
  }, [scopeItems, prefs.author]);
  const maxPriceInScope = useMemo(() => Math.max(0, ...scopeItems.map(i => i.price)), [scopeItems]);
  const hasCreatedAt = useMemo(() => items.some(i => i.createdAt != null), [items]);
  const results = useMemo(() => runBookSearch(scopeItems, prefs, tokens, coins), [scopeItems, prefs, tokens, coins]);
  const visible = results.slice(0, limit);

  const activeFilterCount = [
    prefs.genres.length > 0, prefs.progress !== 'all', prefs.ownership !== 'all', prefs.priceMode !== 'all',
    prefs.maxPrice != null && prefs.maxPrice < maxPriceInScope, prefs.affordable, prefs.minRating > 0, prefs.ratedOnly,
    prefs.author !== 'all', prefs.addedWithin > 0, prefs.likedOnly,
  ].filter(Boolean).length;
  const resetFilters = () => setPrefs(p => ({ ...DEFAULT_SEARCH_PREFS, scope: p.scope, sort: p.sort, fields: p.fields }));

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIdx, visible.length]);

  if (!isOpen) return null;

  const rememberQuery = () => {
    const q = query.trim();
    if (!q) return;
    const next = [q, ...recent.filter(r => fold(r) !== fold(q))].slice(0, 6);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* nevadí */ }
  };
  const targetOf = (it) => (it.owned ? { to: `/read/${it.id}` } : { to: '/app', state: { openBookId: it.id } });
  const openItem = (it) => { rememberQuery(); const t = targetOf(it); navigate(t.to, t.state ? { state: t.state } : undefined); onClose(); };
  const onInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, Math.max(visible.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { const it = visible[activeIdx] || visible[0]; if (it) { e.preventDefault(); openItem(it); } }
  };
  // Filtr "nemám odemčené" v mých knihách nedává smysl, tak se při přepnutí zruší.
  const setScope = (scope) => patch({ scope, ownership: scope === 'mine' && prefs.ownership === 'notOwned' ? 'all' : prefs.ownership });
  const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const sortOptions = SORT_OPTIONS.filter(([v]) => hasCreatedAt || !DATE_SORTS.includes(v));
  const mineCount = items.filter(i => i.owned).length;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex justify-center items-start p-2 sm:p-4 pt-14 sm:pt-20" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label="Vyhledávání knih"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)', maxHeight: 'calc(100dvh - 4.5rem)' }}
        className="border rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 p-3 sm:p-5 pb-2 sm:pb-3 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div role="tablist" aria-label="Kde hledat" className="flex gap-1.5 min-w-0">
              <Chip active={prefs.scope === 'mine'} onClick={() => setScope('mine')} role="tab" aria-selected={prefs.scope === 'mine'}><Library size={11} className="inline -mt-0.5 mr-1" />Moje knihy ({mineCount})</Chip>
              <Chip active={prefs.scope === 'catalog'} onClick={() => setScope('catalog')} role="tab" aria-selected={prefs.scope === 'catalog'}><Globe size={11} className="inline -mt-0.5 mr-1" />Celý katalog ({items.length})</Chip>
            </div>
            <button type="button" onClick={onClose} aria-label="Zavřít hledání" className="shrink-0 opacity-50 hover:opacity-100 cursor-pointer text-current bg-transparent border-none p-1"><X size={20} /></button>
          </div>

          <div className="relative flex items-center">
            <Search className="absolute left-3.5 opacity-40" size={18} />
            <input
              type="text" autoFocus aria-label="Hledaný text" autoComplete="off"
              placeholder="Název, autor, žánr..."
              value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onInputKeyDown}
              style={fieldStyle} className="w-full pl-10 pr-9 py-2.5 border rounded-xl outline-none font-bold text-sm"
            />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Vymazat hledání" className="absolute right-2.5 bg-transparent border-none cursor-pointer text-current opacity-50 hover:opacity-100 p-1"><X size={15} /></button>}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider mr-0.5">Hledat v:</span>
            {FIELD_OPTIONS.map(([v, label]) => (
              <Chip key={v} active={prefs.fields.includes(v)} onClick={() => { const next = toggleIn(prefs.fields, v); if (next.length) patch({ fields: next }); }} title={prefs.fields.length === 1 && prefs.fields[0] === v ? 'Aspoň jedno pole musí zůstat zapnuté' : undefined}>{label}</Chip>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowFilters(s => !s)} aria-expanded={showFilters}
              style={activeFilterCount ? { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--bg-primary)' } : fieldStyle}
              className="shrink-0 px-3 py-2 border rounded-lg text-xs font-black uppercase tracking-wide cursor-pointer inline-flex items-center gap-1.5">
              <SlidersHorizontal size={13} /> Filtry{activeFilterCount ? ` (${activeFilterCount})` : ''}
            </button>
            <div className="flex-1 min-w-0">
              <Select label="Řazení" value={prefs.sort} onChange={(e) => patch({ sort: e.target.value })}>
                {sortOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            {activeFilterCount > 0 && (
              <button type="button" onClick={resetFilters} aria-label="Zrušit všechny filtry" title="Zrušit všechny filtry" style={fieldStyle} className="shrink-0 p-2 border rounded-lg cursor-pointer inline-flex"><RotateCcw size={14} /></button>
            )}
          </div>
        </div>

        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 pb-3 sm:pb-5">
          {showFilters && (
            <div style={{ borderColor: 'var(--border-color)' }} className="border rounded-xl p-3 mb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3" data-testid="filters">
              <div className="sm:col-span-2">
                <Group label={`Žánry${prefs.genres.length > 1 ? (prefs.genreMode === 'all' ? ' - musí mít všechny vybrané' : ' - stačí kterýkoliv vybraný') : ''}`}>
                  {genreOptions.length === 0 ? <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">Knihy zatím nemají žádné žánry.</p> : (
                    <div className="flex flex-wrap gap-1.5">
                      {genreOptions.map(g => <Chip key={g} active={prefs.genres.includes(g)} onClick={() => patch({ genres: toggleIn(prefs.genres, g) })}>{g}</Chip>)}
                    </div>
                  )}
                  {prefs.genres.length > 1 && (
                    <div className="mt-2 flex gap-1.5">
                      <Chip active={prefs.genreMode === 'any'} onClick={() => patch({ genreMode: 'any' })}>Aspoň jeden</Chip>
                      <Chip active={prefs.genreMode === 'all'} onClick={() => patch({ genreMode: 'all' })}>Všechny</Chip>
                    </div>
                  )}
                </Group>
              </div>
              <Group label="Stav čtení">
                <Select label="Stav čtení" value={prefs.progress} onChange={(e) => patch({ progress: e.target.value })}>
                  <option value="all">Všechny</option><option value="unread">Nepřečtené</option><option value="reading">Rozečtené</option><option value="read">Přečtené</option>
                </Select>
                <div className="mt-2"><Check checked={prefs.likedOnly} onChange={(e) => patch({ likedOnly: e.target.checked })}>Jen oblíbené (s mým srdíčkem)</Check></div>
              </Group>
              <Group label="Vlastnictví">
                <Select label="Vlastnictví" value={prefs.ownership} onChange={(e) => patch({ ownership: e.target.value })}>
                  <option value="all">Všechny</option><option value="owned">Mám odemčené</option>
                  {prefs.scope === 'catalog' && <option value="notOwned">Nemám (ke koupi)</option>}
                  <option value="published">Vydané mnou</option>
                </Select>
              </Group>
              <Group label="Cena">
                <div className="flex gap-1.5 flex-wrap">
                  {[['all', 'Jakákoliv'], ['free', 'Zdarma'], ['paid', 'Placené']].map(([v, l]) => <Chip key={v} active={prefs.priceMode === v} onClick={() => patch({ priceMode: v })}>{l}</Chip>)}
                </div>
                {maxPriceInScope > 0 && (
                  <div className="mt-2">
                    <label className="text-xs font-bold block mb-1">Nejvýš: {prefs.maxPrice == null || prefs.maxPrice >= maxPriceInScope ? 'bez limitu' : `${prefs.maxPrice} mincí`}</label>
                    <input type="range" aria-label="Maximální cena" min={0} max={maxPriceInScope} step={maxPriceInScope > 1000 ? 25 : 5}
                      value={prefs.maxPrice == null ? maxPriceInScope : Math.min(prefs.maxPrice, maxPriceInScope)}
                      onChange={(e) => { const v = parseInt(e.target.value, 10); patch({ maxPrice: v >= maxPriceInScope ? null : v }); }}
                      className="w-full cursor-pointer" style={{ accentColor: 'var(--bg-primary)' }} />
                  </div>
                )}
                <div className="mt-2"><Check checked={prefs.affordable} onChange={(e) => patch({ affordable: e.target.checked })}>Jen dostupné pro mě (mám {coins.toLocaleString('cs-CZ')} mincí)</Check></div>
              </Group>
              <Group label="Hodnocení">
                <Select label="Minimální hodnocení" value={String(prefs.minRating)} onChange={(e) => patch({ minRating: parseFloat(e.target.value) })}>
                  <option value="0">Jakékoliv</option><option value="3">3 a víc</option><option value="4">4 a víc</option><option value="4.5">4,5 a víc</option>
                </Select>
                <div className="mt-2"><Check checked={prefs.ratedOnly} onChange={(e) => patch({ ratedOnly: e.target.checked })}>Jen knihy s hodnocením</Check></div>
              </Group>
              <Group label="Autor">
                <Select label="Autor" value={prefs.author} onChange={(e) => patch({ author: e.target.value })}>
                  <option value="all">Všichni autoři</option>
                  {authorOptions.map(a => <option key={a} value={a}>{a}</option>)}
                </Select>
              </Group>
              {hasCreatedAt && (
                <Group label="Přidáno do katalogu">
                  <Select label="Přidáno do katalogu" value={String(prefs.addedWithin)} onChange={(e) => patch({ addedWithin: parseInt(e.target.value, 10) })}>
                    <option value="0">Kdykoliv</option><option value="7">Za posledních 7 dní</option><option value="30">Za posledních 30 dní</option><option value="90">Za posledních 90 dní</option><option value="365">Za poslední rok</option>
                  </Select>
                </Group>
              )}
            </div>
          )}

          {loading ? (
            <div className="text-center py-6 text-xs font-bold opacity-70 flex items-center justify-center gap-2"><Loader2 className="animate-spin" size={14} /> Načítání katalogu...</div>
          ) : error ? (
            <p role="alert" className="text-center py-6 text-sm font-bold text-red-500 m-0">{error}</p>
          ) : (
            <>
              {tokens.length === 0 && recent.length > 0 && (
                <div className="mb-3 flex items-center gap-1.5 flex-wrap" data-testid="recent">
                  <History size={12} className="opacity-50" />
                  {recent.map(r => <Chip key={r} active={false} onClick={() => setQuery(r)}>{r}</Chip>)}
                  <button type="button" onClick={() => { setRecent([]); try { localStorage.removeItem(RECENT_KEY); } catch { /* nevadí */ } }} style={{ color: 'var(--text-muted)' }} className="bg-transparent border-none cursor-pointer text-[10px] font-bold underline">smazat</button>
                </div>
              )}
              <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-bold m-0 mb-1.5" aria-live="polite">{results.length === 1 ? '1 výsledek' : results.length >= 2 && results.length <= 4 ? `${results.length} výsledky` : `${results.length} výsledků`}</p>
              {results.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm font-medium opacity-70 m-0">{prefs.scope === 'mine' && mineCount === 0 && !query && !activeFilterCount ? 'Zatím nemáš žádné knihy - zkus Celý katalog.' : 'Nic neodpovídá zadání.'}</p>
                  {activeFilterCount > 0 && <button type="button" onClick={resetFilters} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="mt-3 px-4 py-2 rounded-lg border-none cursor-pointer text-xs font-black uppercase">Zrušit filtry</button>}
                  {prefs.scope === 'mine' && query && <button type="button" onClick={() => setScope('catalog')} style={fieldStyle} className="mt-3 ml-2 px-4 py-2 border rounded-lg cursor-pointer text-xs font-black uppercase">Hledat v celém katalogu</button>}
                </div>
              ) : (
                <div role="listbox" aria-label="Výsledky" className="space-y-0.5">
                  {visible.map((it, idx) => {
                    const t = targetOf(it);
                    const active = idx === activeIdx;
                    return (
                      <Link key={it.id} to={t.to} state={t.state} role="option" aria-selected={active} onClick={() => { rememberQuery(); onClose(); }} onMouseEnter={() => setActiveIdx(idx)}
                        style={active ? { backgroundColor: 'var(--bg-secondary)' } : undefined}
                        className="p-2.5 flex justify-between items-center gap-3 rounded-xl no-underline text-current">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-sm m-0 break-words"><Highlight text={it.title} tokens={tokens} /></h4>
                          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] uppercase font-semibold mt-0.5 m-0 break-words"><Highlight text={it.authorName} tokens={tokens} /></p>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1.5 text-[11px] font-bold">
                            {it.genres.slice(0, 3).map(g => <span key={g} style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="px-1.5 py-0.5 rounded-full text-[10px]">{g}</span>)}
                            {it.ratingsCount > 0 && <span className="inline-flex items-center gap-0.5"><Star size={11} className="text-amber-500 fill-amber-500" /> {it.rating.toFixed(1).replace('.', ',')} <span style={{ color: 'var(--text-muted)' }} className="font-medium">({it.ratingsCount})</span></span>}
                            {it.likes > 0 && <span className="inline-flex items-center gap-0.5" style={{ color: it.liked ? '#ef4444' : 'var(--text-muted)' }}><Heart size={11} className={it.liked ? 'fill-current' : ''} /> {it.likes}</span>}
                            {it.isOwn ? <span className="text-emerald-500">Tvoje kniha</span>
                              : it.read ? <span className="text-emerald-500">✓ Přečteno</span>
                              : it.inProgress ? <span className="text-amber-500">Rozečteno {it.progress} %</span>
                              : it.owned ? (prefs.scope === 'catalog' ? <span style={{ color: 'var(--text-muted)' }}>Odemčeno</span> : null)
                              : <span style={{ color: it.price <= coins ? '#d97706' : 'var(--text-muted)' }}>{it.price === 0 ? 'Zdarma' : `${it.price.toLocaleString('cs-CZ')} mincí`}{it.price > coins ? ' (nemáš dost)' : ''}</span>}
                          </div>
                        </div>
                        <ChevronRight size={16} className="shrink-0 opacity-50 text-emerald-600" />
                      </Link>
                    );
                  })}
                </div>
              )}
              {results.length > visible.length && (
                <button type="button" onClick={() => setLimit(l => l + PAGE_SIZE)} style={fieldStyle} className="mt-3 w-full py-2.5 border rounded-lg cursor-pointer text-xs font-black uppercase">Zobrazit dalších {Math.min(PAGE_SIZE, results.length - visible.length)}</button>
              )}
              <p style={{ color: 'var(--text-muted)' }} className="hidden sm:block text-[10px] text-center opacity-50 mt-3 m-0">↑ ↓ výběr · Enter otevřít · Esc zavřít</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
