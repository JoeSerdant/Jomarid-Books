// Kam v okně umístit kartu prohlídky vůči zvýrazněnému prvku (čistá geometrie, jde testovat bez prohlížeče).
//
// Karta se nikdy nedostane mimo okno a pokud to jde, nezakrývá zvýrazněný prvek. Když se v okně nevejde celá
// (telefon na šířku, zvětšené písmo), zmenší se na volné místo nad nebo pod prvkem (maxHeight) a její text se posouvá.

const round = (n) => Math.round(n);
const MIN_CARD_HEIGHT = 140; // užší než tohle by už karta byla k ničemu - radši přes prvek

/**
 * @param {object} p
 * @param {{top:number,left:number,width:number,height:number}|null} p.target  zvýrazněný prvek (souřadnice v okně); null = bez prvku
 * @param {{width:number,height:number}} p.card      přirozené rozměry karty (bez omezení výšky)
 * @param {{width:number,height:number}} p.viewport  rozměry okna
 * @returns {{top:number,left:number,placement:string,maxHeight:number}}
 */
export const computeCardPosition = ({ target, card, viewport, margin = 12, gap = 14 }) => {
  const vw = viewport.width;
  const vh = viewport.height;
  const cw = Math.min(card.width, Math.max(0, vw - 2 * margin));
  const fullMax = Math.max(0, vh - 2 * margin);
  const ch = Math.min(card.height, fullMax);
  const clampX = (x) => Math.max(margin, Math.min(x, vw - cw - margin));
  const clampY = (y, h) => Math.max(margin, Math.min(y, vh - h - margin));
  const out = (left, top, placement, maxHeight) => ({ left: round(left), top: round(top), placement, maxHeight: round(maxHeight) });
  const center = (placement) => out(clampX((vw - cw) / 2), clampY((vh - ch) / 2, ch), placement, fullMax);

  if (!target) return center('center');

  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const narrow = vw < 640; // telefon: karta přes celou šířku, přilepená dole nebo nahoře
  const cx = narrow ? clampX((vw - cw) / 2) : clampX(target.left + target.width / 2 - cw / 2);

  // Volné místo pod a nad prvkem a kam by karta v tom případě přišla.
  const spaceBelow = vh - margin - (bottom + gap);
  const spaceAbove = target.top - gap - margin;
  const below = (h) => out(cx, narrow ? vh - margin - h : bottom + gap, narrow ? 'dock-bottom' : 'below', spaceBelow);
  const above = (h) => out(cx, narrow ? margin : target.top - gap - h, narrow ? 'dock-top' : 'above', spaceAbove);

  // 1) Vejde se celá: pod prvek, jinak nad něj, na širokém okně i vedle něj.
  if (spaceBelow >= ch) return below(ch);
  if (spaceAbove >= ch) return above(ch);
  if (!narrow) {
    const cy = clampY(target.top + target.height / 2 - ch / 2, ch);
    if (right + gap + cw <= vw - margin) return out(right + gap, cy, 'right', fullMax);
    if (target.left - gap - cw >= margin) return out(target.left - gap - cw, cy, 'left', fullMax);
  }

  // 2) Nevejde se: zmenšit na větší z volných míst, je-li aspoň trochu použitelné (obsah se v kartě posouvá).
  const best = spaceBelow >= spaceAbove ? { space: spaceBelow, place: below } : { space: spaceAbove, place: above };
  if (best.space >= Math.min(ch, MIN_CARD_HEIGHT)) return best.place(Math.min(ch, best.space));

  // 3) Není kam: karta uprostřed přes prvek (ten zůstane aspoň zvýrazněný kolem).
  return center('center-over');
};

// Rámeček zvýraznění: souřadnice prvku zvětšené o malý okraj a oříznuté na okno.
export const computeSpotlight = (target, viewport, pad = 6) => {
  if (!target) return null;
  const left = Math.max(0, target.left - pad);
  const top = Math.max(0, target.top - pad);
  const right = Math.min(viewport.width, target.left + target.width + pad);
  const bottom = Math.min(viewport.height, target.top + target.height + pad);
  if (right <= left || bottom <= top) return null;
  return { left: round(left), top: round(top), width: round(right - left), height: round(bottom - top) };
};
