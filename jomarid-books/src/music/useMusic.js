import { useCallback, useEffect, useRef, useState } from 'react';

// Přepínač hudby na pozadí her: volba se pamatuje v zařízení (jedna pro všechny hry) a posílá se do iframu hry. Hra se po načtení přihlásí zprávou
// music-hello a dostane aktuální volbu; po přepnutí se pošle rovnou. iframeRef je odkaz na iframe hry.
const KEY = 'jomarid-music-off';
const read = () => { try { return localStorage.getItem(KEY) !== '1'; } catch { return true; } };

export function useMusic(iframeRef) {
  const [on, setOn] = useState(read);
  const onRef = useRef(on);
  onRef.current = on;
  const post = useCallback(() => {
    const w = iframeRef.current && iframeRef.current.contentWindow;
    if (w) { try { w.postMessage({ source: 'jomarid-host', type: 'music-pref', on: onRef.current }, '*'); } catch { /* iframe už není */ } }
  }, [iframeRef]);
  useEffect(() => {
    const onMessage = (ev) => {
      const w = iframeRef.current && iframeRef.current.contentWindow;
      if (!w || ev.source !== w) return;
      if (ev.data && ev.data.source === 'jomarid-game' && ev.data.type === 'music-hello') post();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [iframeRef, post]);
  const toggle = useCallback(() => {
    const next = !onRef.current;
    try { localStorage.setItem(KEY, next ? '0' : '1'); } catch { /* blokované úložiště: volba platí jen teď */ }
    onRef.current = next;
    setOn(next);
    post();
  }, [post]);
  return { on, toggle };
}
