import { useCallback, useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE, clampVisible, nextChunkSize, nextVisibleCount } from './browseModel.js';

/**
 * Postupné zobrazování dlouhého seznamu: ukáže první část a další přidává, když čtenář doscrolluje ke konci
 * (nebo stiskne tlačítko). Nevykreslované položky nestojí nic, takže seznam o tisících položek zůstává svižný.
 *
 *  - resetKey: při jeho změně (filtry, řazení, způsob zobrazení) se začíná znovu od první části.
 *  - initialVisible: kolik položek bylo rozbaleno naposledy (obnovení po návratu na stránku); platí jen pro první resetKey.
 *  - sentinelRef patří na prvek hned pod seznam; když se přiblíží k oknu, přidá se další část. Je to funkce (ne objekt
 *    ref), protože prvek se může objevit později než samotný seznam (přepnutá záložka, seznam po prázdném výsledku).
 */
export const usePagedList = (items, { pageSize = PAGE_SIZE.list, resetKey = '', initialVisible = 0, auto = true, lookahead = 700 } = {}) => {
  const total = items.length;
  const [state, setState] = useState({ key: resetKey, wanted: initialVisible });
  // Po změně resetKey se začíná znovu od první části. Děje se to přímo při vykreslování (React hned vykreslí znovu),
  // ne v efektu, takže není vidět ani jeden snímek se starým počtem. Počet se musí zahodit, ne jen ignorovat: kdyby
  // zůstal uložený, po zrušení filtru by se zase objevil starý rozbalený seznam.
  if (state.key !== resetKey) setState({ key: resetKey, wanted: 0 });
  const wanted = state.key === resetKey ? state.wanted : 0;
  const count = clampVisible(wanted, total, pageSize);
  const hasMore = count < total;

  // Vychází z nejnovějšího stavu, takže zbloudilé dvojí zavolání nikdy nezkrátí už rozbalený seznam.
  const showMore = useCallback(() => {
    setState((s) => {
      const current = clampVisible(s.key === resetKey ? s.wanted : 0, total, pageSize);
      return { key: resetKey, wanted: nextVisibleCount(current, total, pageSize) };
    });
  }, [resetKey, total, pageSize]);

  const [sentinel, setSentinel] = useState(null);
  useEffect(() => {
    if (!auto || !hasMore || !sentinel || typeof IntersectionObserver === 'undefined') return undefined;
    // Pozorovatel se po každém rozbalení zakládá znovu (count v závislostech): nově založený hned hlásí, jestli je
    // prvek v dohledu, takže se na vysokém okně rozbalují části tak dlouho, dokud nepřestane být konec vidět.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) showMore();
    }, { rootMargin: `0px 0px ${lookahead}px 0px` });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [auto, hasMore, count, showMore, lookahead, sentinel]);

  const visible = useMemo(() => items.slice(0, count), [items, count]);
  return { items: visible, count, total, hasMore, remaining: total - count, nextChunk: nextChunkSize(count, total, pageSize), pageSize, showMore, sentinelRef: setSentinel };
};
