import { useEffect, useState } from 'react';
import { ArrowUp, LayoutGrid, List } from 'lucide-react';
import { coverGradient, coverInitials } from './browseModel.js';

// Společné součásti procházení dlouhých seznamů: přepínač zobrazení, "Zobrazit dalších", tlačítko nahoru a obálka.

/** Přepínač způsobu zobrazení: mřížka obálek / seznam řádků. */
export const ViewToggle = ({ value, onChange }) => (
  <div role="group" aria-label="Způsob zobrazení" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="flex border rounded-xl p-0.5 shrink-0">
    {[['grid', LayoutGrid, 'Mřížka'], ['list', List, 'Seznam']].map(([key, Icon, label]) => {
      const active = value === key;
      return (
        <button
          key={key}
          type="button"
          aria-pressed={active}
          aria-label={label}
          title={label}
          data-testid={`view-${key}`}
          onClick={() => onChange(key)}
          style={{ backgroundColor: active ? 'var(--bg-primary)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}
          className="w-10 h-9 rounded-[10px] border-none cursor-pointer flex items-center justify-center transition-colors"
        >
          <Icon size={16} />
        </button>
      );
    })}
  </div>
);

/**
 * Pod seznamem: neviditelný hlídač, který při přiblížení k oknu přidá další část, údaj "Zobrazeno X z Y" a tlačítko
 * pro ruční rozbalení (pro ovládání klávesnicí, čtečky obrazovky a prohlížeče bez IntersectionObserver).
 * paged = výsledek usePagedList. Když se vejde všechno do první části, nezobrazí se nic.
 */
export const LoadMore = ({ paged, className = '' }) => {
  if (paged.total <= paged.pageSize) return null;
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      {paged.hasMore && <div ref={paged.sentinelRef} aria-hidden="true" className="h-px w-full" />}
      <p role="status" data-testid="paged-count" style={{ color: 'var(--text-muted)' }} className="text-xs font-bold m-0 tabular-nums">
        Zobrazeno {paged.count} z {paged.total}
      </p>
      {paged.hasMore && (
        <button
          type="button"
          data-testid="paged-more"
          onClick={paged.showMore}
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
          className="px-6 py-3 border rounded-xl font-black text-[11px] uppercase tracking-wider cursor-pointer hover:brightness-95 active:scale-95 transition-all"
        >
          Zobrazit dalších {paged.nextChunk}
        </button>
      )}
    </div>
  );
};

/** Plovoucí tlačítko zpět na začátek stránky; objeví se, až když je čtenář od začátku dál než pár obrazovek. */
export const BackToTop = ({ threshold = 900 }) => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => { frame = 0; setShow(window.scrollY > threshold); };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, [threshold]);
  if (!show) return null;
  const goTop = () => {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
  };
  return (
    <button
      type="button"
      data-testid="back-to-top"
      onClick={goTop}
      aria-label="Zpět nahoru"
      title="Zpět nahoru"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
      className="fixed bottom-4 right-4 z-30 w-12 h-12 rounded-full border shadow-lg cursor-pointer flex items-center justify-center hover:brightness-110 active:scale-95 transition-all"
    >
      <ArrowUp size={20} />
    </button>
  );
};

/**
 * Obálka knihy (kniha nemá obrázek): přechod odvozený z seed + iniciály. children = popisky přes obálku (absolutně
 * umístěné). Velikost určuje className rodiče (např. aspect-[3/4] w-full), velikost písma textClass.
 */
export const BookCover = ({ title, seed, className = '', textClass = 'text-4xl', children }) => (
  <span className={`relative block overflow-hidden ${className}`} style={{ backgroundImage: coverGradient(seed ?? title) }}>
    <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[7%] bg-black/25" />
    <span aria-hidden="true" className={`absolute inset-0 flex items-center justify-center font-black tracking-tight text-white/90 select-none ${textClass}`}>
      {coverInitials(title)}
    </span>
    {children}
  </span>
);
