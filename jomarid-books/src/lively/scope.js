// Živý režim: kde se co kreslí a jak se počítá pruh průběhu stránky. Čistá logika bez Reactu, jde testovat v Node.

/** Čtečka, hry a krátké knihy zůstávají klidné (tam se čte nebo hraje), správa a nakladatelský panel mají široký obsah,
 *  kam by ozdoby po stranách zasahovaly. Ostatní stránky dostanou všechno. */
export const livelyScope = (pathname) => {
  const p = typeof pathname === 'string' && pathname ? pathname : '/';
  const calm = /^\/(read|shorts)(\/|$)/.test(p) || /^\/games\/[^/]+/.test(p);
  const wide = /^\/(admin|publisher)(\/|$)/.test(p);
  return { ambient: !calm, sparkles: !calm, sides: !calm && !wide };
};

/** Podíl už projeté stránky 0 až 1 (0, když se stránka vejde na obrazovku nebo jsou vstupy nesmysl). */
export const scrollProgress = (top, total, view) => {
  const range = Number(total) - Number(view);
  const t = Number(top);
  if (!Number.isFinite(range) || !Number.isFinite(t) || range <= 0) return 0;
  return Math.min(1, Math.max(0, t / range));
};

/** Poloha myši jako číslo -1 až 1 vůči středu okna (vlevo/nahoře -1, vpravo/dole 1). Ozdoby se podle ní lehce posouvají a sova se dívá za myší. */
export const pointerOffset = (x, y, width, height) => {
  const axis = (v, size) => (typeof v === 'number' && Number.isFinite(v) && typeof size === 'number' && Number.isFinite(size) && size > 0 ? Math.min(1, Math.max(-1, (v / size) * 2 - 1)) : 0);
  return { px: axis(x, width), py: axis(y, height) };
};
