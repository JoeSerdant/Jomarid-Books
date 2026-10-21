import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Heart, Layers, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { plural } from '../lib/plural';
import { buildSlides, progressFromSlide, readMinutes, slideIndexFromScroll } from '../shorts/shortsModel';
import { buildPreferences, rankFeed, reasonLabel } from '../shorts/shortsRanking';
import { loadCandidates, loadShortsByIds, loadSignals, reportShort } from '../shorts/shortsApi';
import { loadBookTaste } from '../shorts/shortsTaste';

const BATCH = 4;           // kolik textů se načte najednou
const MIN_REPORT_MS = 600; // kratší průlet kartou se nehlásí
const REPORT_DELAY_MS = 1500;
const muted = { color: 'var(--text-muted)' };
const chip = { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' };

// ---------------------------------------------------------------------------
// Jedna karta: úvodní strana, stránky textu a závěr. Čte se do strany (jako obrázky na Instagramu), po dočtení se jde dolů na další.
// ---------------------------------------------------------------------------
const ShortCard = ({ index, card, active, onNext }) => {
  const { short, slides } = card;
  const carRef = useRef(null);
  const [slide, setSlide] = useState(0);
  const [liked, setLiked] = useState(short.myLiked);
  const maxSlide = useRef(0);
  const activeSince = useRef(null);
  const dwell = useRef(0);
  const timer = useRef(null);
  const sent = useRef({ seen: short.myPagesSeen, finished: short.myFinished });

  // Odešle postup (nejdál viděná strana, dočteno, čas u shortB). Čas se přičítá jen u aktivní karty a viditelné stránky.
  const flush = useCallback((extra = {}) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (activeSince.current !== null) { dwell.current += Date.now() - activeSince.current; activeSince.current = document.hidden ? null : Date.now(); }
    const { pagesSeen, pagesTotal, finished } = progressFromSlide(slides.length, maxSlide.current);
    const ms = dwell.current;
    if (ms < MIN_REPORT_MS && extra.liked === undefined && pagesSeen <= sent.current.seen && !(finished && !sent.current.finished)) return;
    dwell.current = 0;
    sent.current = { seen: Math.max(sent.current.seen, pagesSeen), finished: sent.current.finished || finished };
    reportShort(supabase, { shortId: short.id, pagesSeen, pagesTotal, dwellMs: ms, finished, ...extra });
  }, [slides.length, short.id]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), REPORT_DELAY_MS);
  }, [flush]);

  // Aktivní karta měří čas, neaktivní se odešle a zastaví.
  useEffect(() => {
    if (active) activeSince.current = document.hidden ? null : Date.now();
    else { flush(); activeSince.current = null; }
  }, [active, flush]);

  useEffect(() => {
    const onVisibility = () => {
      if (!active) return;
      if (document.hidden) flush(); else activeSince.current = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onVisibility); };
  }, [active, flush]);

  useEffect(() => () => flush(), [flush]);

  // Rozečtený shortB se otevře na stránce, kde čtenář skončil.
  useEffect(() => {
    const car = carRef.current;
    const start = !short.myFinished && short.myPagesSeen >= 2 ? Math.min(short.myPagesSeen, slides.length - 2) : 0;
    if (car && start > 0) { car.scrollLeft = car.clientWidth * start; setSlide(start); maxSlide.current = start; }
  }, [short.myFinished, short.myPagesSeen, slides.length]);

  const onScroll = (e) => {
    const car = e.currentTarget;
    const i = slideIndexFromScroll(car.scrollLeft, car.clientWidth, slides.length);
    if (i === slide) return;
    setSlide(i);
    if (i > maxSlide.current) { maxSlide.current = i; schedule(); }
  };

  const go = (delta) => {
    const car = carRef.current;
    if (car) car.scrollTo({ left: car.clientWidth * Math.min(slides.length - 1, Math.max(0, slide + delta)), behavior: 'smooth' });
  };

  const toggleLike = () => {
    const next = !liked;
    setLiked(next);
    flush({ liked: next });
  };

  return (
    <section data-testid="short-card" data-index={index} aria-label={`ShortB: ${short.title}`} className="snap-start snap-always h-full relative flex flex-col">
      {/* proužky postupu jako u příběhů */}
      <div className="flex gap-1 px-4 pt-3" aria-hidden="true">
        {slides.map((_, i) => <span key={i} className="h-1 flex-1 rounded-full" style={{ backgroundColor: i <= slide ? 'var(--bg-primary)' : 'var(--border-color)' }} />)}
      </div>

      <div ref={carRef} data-carousel onScroll={onScroll} tabIndex={0} aria-label={`Strany shortB ${short.title}`}
        className="flex-1 min-h-0 flex overflow-x-auto snap-x snap-mandatory scrollbar-hide" style={{ overscrollBehaviorX: 'contain' }}>
        {slides.map((s, i) => (
          <div key={i} data-slide={s.kind} className="min-w-full w-full h-full snap-center flex flex-col justify-center px-6 sm:px-12 pb-6">
            <div className="max-w-xl w-full mx-auto">
              {s.kind === 'cover' && (
                <div className="space-y-4">
                  {reasonLabel(short.reason, short) && <span style={chip} className="inline-block border rounded-full px-3 py-1 text-[0.6875rem] font-black uppercase tracking-wider">{reasonLabel(short.reason, short)}</span>}
                  <h2 className="text-3xl sm:text-4xl font-black leading-tight m-0 break-words">{short.title}</h2>
                  <p style={muted} className="text-sm font-bold m-0">{short.authorName}</p>
                  {short.seriesName && <p className="text-sm font-black m-0" style={{ color: 'var(--bg-primary)' }}>{short.seriesName} · díl {short.seriesPart}</p>}
                  {short.genres.length > 0 && <p style={muted} className="text-xs font-bold m-0">{short.genres.join(' · ')}</p>}
                  <p style={muted} className="text-xs m-0 opacity-80">{slides.length - 2} {plural(slides.length - 2, 'stránka', 'stránky', 'stránek')} · asi {readMinutes(short.chars)} min čtení</p>
                  <p style={muted} className="text-xs font-bold m-0 pt-4 flex items-center gap-1">Listuj do strany <ChevronRight size={14} aria-hidden="true" /></p>
                </div>
              )}
              {s.kind === 'page' && (
                <div>
                  <p data-testid="short-text" className="whitespace-pre-line text-[1.0625rem] sm:text-lg leading-[1.75] m-0 break-words">{s.text}</p>
                  <p style={muted} className="text-[0.6875rem] font-bold mt-5 mb-0 tabular-nums">{s.n} / {s.of}</p>
                </div>
              )}
              {s.kind === 'end' && (
                <div className="space-y-5 text-center">
                  <p className="text-2xl font-black m-0">Konec</p>
                  <p style={muted} className="text-sm m-0">{short.title} · {short.authorName}</p>
                  <button type="button" onClick={toggleLike} aria-pressed={liked} data-testid="short-like-end" style={liked ? { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' } : chip}
                    className="border rounded-xl px-5 py-3 text-xs font-black uppercase tracking-wider cursor-pointer inline-flex items-center gap-2"><Heart size={16} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" /> {liked ? 'Líbí se mi' : 'Dát lajk'}</button>
                  <div><button type="button" onClick={onNext} data-testid="short-next" style={chip} className="border rounded-xl px-5 py-3 text-xs font-black uppercase tracking-wider cursor-pointer inline-flex items-center gap-2">Další shortB <ArrowDown size={14} aria-hidden="true" /></button></div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* lajk po straně a šipky pro myš (na telefonu se listuje prstem) */}
      <button type="button" onClick={toggleLike} aria-pressed={liked} aria-label={liked ? 'Zrušit lajk' : 'Dát lajk'} data-testid="short-like" style={chip}
        className="absolute right-3 bottom-24 w-11 h-11 rounded-full border flex items-center justify-center cursor-pointer"><Heart size={18} fill={liked ? 'currentColor' : 'none'} style={{ color: liked ? '#ef4444' : 'currentColor' }} aria-hidden="true" /></button>
      <button type="button" onClick={() => go(-1)} disabled={slide === 0} aria-label="Předchozí strana" style={chip}
        className="hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full border items-center justify-center cursor-pointer disabled:opacity-30"><ChevronLeft size={18} aria-hidden="true" /></button>
      <button type="button" onClick={() => go(1)} disabled={slide === slides.length - 1} aria-label="Další strana" style={chip}
        className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full border items-center justify-center cursor-pointer disabled:opacity-30"><ChevronRight size={18} aria-hidden="true" /></button>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Stránka feedu
// ---------------------------------------------------------------------------
export const ShortsPage = () => {
  const { user } = useAuth();
  const feedRef = useRef(null);
  const wrapRef = useRef(null);
  const orderRef = useRef([]);
  const loadingMore = useRef(false);
  const [status, setStatus] = useState('loading'); // loading | ready | empty | done | unavailable
  const [cards, setCards] = useState([]);
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const noCards = cards.length === 0;

  // Feed vyplní zbytek okna pod lištou.
  useEffect(() => {
    const measure = () => {
      const top = wrapRef.current ? wrapRef.current.getBoundingClientRect().top + window.scrollY : 0;
      setHeight(Math.max(360, Math.round((window.visualViewport?.height || window.innerHeight) - top)));
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => { window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [status, noCards]);

  const loadMore = useCallback(async (count = BATCH) => {
    if (loadingMore.current) return;
    const next = orderRef.current.splice(0, count);
    if (next.length === 0) { setHasMore(false); return; }
    loadingMore.current = true;
    const texts = await loadShortsByIds(supabase, next.map((n) => n.id));
    const fresh = next.filter((n) => texts.has(n.id)).map((n) => {
      const short = { ...texts.get(n.id), reason: n.reason, chars: n.cand?.chars || texts.get(n.id).body.length };
      return { short, slides: buildSlides(short.body) };
    });
    setCards((prev) => [...prev, ...fresh]);
    setHasMore(orderRef.current.length > 0);
    loadingMore.current = false;
  }, []);

  const start = useCallback(async () => {
    setStatus('loading');
    setCards([]); setActive(0); loadingMore.current = false;
    const now = Date.now();
    const [cands, signals, taste] = await Promise.all([loadCandidates(supabase, 200), loadSignals(supabase), loadBookTaste(supabase, user.id)]);
    if (cands.unavailable) { setStatus('unavailable'); return; }
    const prefs = buildPreferences({ signals, books: taste, now });
    const ranked = rankFeed(cands.items, prefs, { now, seed: Math.floor(Math.random() * 2147483647) });
    const meta = new Map(cands.items.map((c) => [c.id, c]));
    orderRef.current = ranked.map((r) => ({ id: r.id, reason: r.reason, cand: meta.get(r.id) }));
    if (ranked.length === 0) { setStatus(cands.items.length === 0 ? 'empty' : 'done'); return; }
    setHasMore(true); // dokud nedorazí první texty, závěr feedu se nekreslí (prohlížeč by na něm zůstal stát)
    setStatus('ready');
    await loadMore(BATCH);
  }, [user, loadMore]);

  useEffect(() => { if (user) start(); }, [user, start]);

  // Která karta je právě vidět: z toho se měří čtení a dočítají další.
  useEffect(() => {
    const root = feedRef.current;
    if (!root || status !== 'ready') return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(Number(e.target.getAttribute('data-index')));
    }, { root, threshold: 0.6 });
    root.querySelectorAll('[data-testid=short-card]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [cards.length, status]);

  useEffect(() => { if (status === 'ready' && cards.length - active <= 2 && hasMore) loadMore(BATCH); }, [active, cards.length, hasMore, status, loadMore]);

  const goCard = useCallback((delta) => {
    const root = feedRef.current;
    const target = root?.querySelector(`[data-index="${Math.max(0, active + delta)}"]`) || (delta > 0 ? root?.querySelector('[data-testid=shorts-end]') : null);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [active]);

  // Klávesnice: nahoru a dolů mezi shortB, do stran po stránkách.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target?.tagName || '')) return;
      const car = feedRef.current?.querySelector(`[data-index="${active}"] [data-carousel]`);
      const step = (d) => car?.scrollBy({ left: d * car.clientWidth, behavior: 'smooth' });
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); goCard(1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); goCard(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, goCard]);

  const message = (title, text, button) => (
    <div className="max-w-sm mx-auto py-20 px-4 text-center space-y-3" data-testid={`shorts-${status}`}>
      <Layers size={28} style={{ color: 'var(--bg-primary)' }} className="mx-auto" aria-hidden="true" />
      <p className="text-base font-black m-0">{title}</p>
      <p style={muted} className="text-sm m-0">{text}</p>
      {button}
    </div>
  );

  if (status === 'loading') return <div role="status" className="py-24 text-center"><Loader2 size={24} className="animate-spin mx-auto" aria-hidden="true" /><p style={muted} className="text-sm font-bold opacity-70 mt-3">Skládám tvůj feed...</p></div>;
  if (status === 'unavailable') return message('ShortB zatím nejsou k dispozici', 'Zkus to prosím později.');
  if (status === 'empty') return message('Zatím tu nejsou žádné shortB', 'Jakmile nakladatelé nějaké zveřejní, objeví se tady.', <Link to="/app" style={chip} className="inline-block border rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider no-underline">Do knihovny</Link>);
  if (status === 'done') return message('Máš přečtené všechny shortB', 'Nové se ukážou, jakmile nějaké přibudou. Mezitím si můžeš přečíst knihu.', <Link to="/app" style={chip} className="inline-block border rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider no-underline">Do knihovny</Link>);

  // Feed se vykreslí až s prvními texty: kdyby v posuvném okně nejdřív stál jen závěr nebo načítání, prohlížeč by při dosazení karet zůstal na něm.
  if (cards.length === 0) {
    return hasMore
      ? <div role="status" className="py-24 text-center"><Loader2 size={24} className="animate-spin mx-auto" aria-hidden="true" /><p style={muted} className="text-sm font-bold opacity-70 mt-3">Načítám shortB...</p></div>
      : message('ShortB se nepodařilo načíst', 'Zkus to prosím později.', <button type="button" onClick={start} style={chip} className="border rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider cursor-pointer">Zkusit znovu</button>);
  }

  return (
    <div ref={wrapRef} className="relative max-w-3xl mx-auto w-full" style={{ height: height || '70vh', color: 'var(--text-body)' }} data-testid="shorts-feed">
      <div ref={feedRef} className="h-full overflow-y-auto snap-y snap-mandatory scrollbar-hide" style={{ overscrollBehaviorY: 'contain', overflowAnchor: 'none' }}>
        {cards.map((card, i) => <ShortCard key={card.short.id} index={i} card={card} active={i === active} onNext={() => goCard(1)} />)}
        {!hasMore && (
          <section data-testid="shorts-end" className="snap-start snap-always h-full flex items-center justify-center px-6">
            {message('To je zatím všechno', 'Prošel jsi, co je pro tebe připravené. Nové shortB se skládají podle toho, co čteš.',
              <button type="button" onClick={start} data-testid="shorts-reload" style={chip} className="border rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider cursor-pointer">Načíst znovu</button>)}
          </section>
        )}
        {hasMore && <div className="snap-start h-full flex items-center justify-center" aria-hidden="true"><Loader2 size={20} className="animate-spin opacity-60" /></div>}
      </div>
      <div className="hidden md:flex flex-col gap-2 absolute right-[-3.5rem] top-1/2 -translate-y-1/2">
        <button type="button" onClick={() => goCard(-1)} disabled={active === 0} aria-label="Předchozí shortB" style={chip} className="w-10 h-10 rounded-full border flex items-center justify-center cursor-pointer disabled:opacity-30"><ArrowUp size={16} aria-hidden="true" /></button>
        <button type="button" onClick={() => goCard(1)} aria-label="Další shortB" style={chip} className="w-10 h-10 rounded-full border flex items-center justify-center cursor-pointer"><ArrowDown size={16} aria-hidden="true" /></button>
      </div>
    </div>
  );
};

export default ShortsPage;
