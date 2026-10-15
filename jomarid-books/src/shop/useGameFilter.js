import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { loadMyCosmetics } from './api';
import { KIND_GAMEFX, gameFilter } from './catalog';

// CSS filtr nasazeného vzhledu her pro přihlášeného čtenáře; prázdný řetězec = hry se nepřebarvují (bez vzhledu, bez obchůdku v databázi
// i při chybě načtení). Načítá se jednou při otevření Her, hra se tak přebarví od prvního snímku.
export function useGameFilter(userId) {
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!userId) { setFilter(''); return undefined; }
    let cancelled = false;
    loadMyCosmetics(supabase).then((cosmetics) => {
      if (!cancelled) setFilter(gameFilter(cosmetics?.equipped?.[KIND_GAMEFX]));
    });
    return () => { cancelled = true; };
  }, [userId]);

  return filter;
}
