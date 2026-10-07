// Kam v okně umístit kartu prohlídky vůči zvýrazněnému prvku (čistá geometrie, jde testovat bez prohlížeče).

const round = (n) => Math.round(n);

/**
 * @param {object} p
 * @param {{top:number,left:number,width:number,height:number}|null} p.target  zvýrazněný prvek (souřadnice v okně); null = bez prvku
 * @param {{width:number,height:number}} p.card      rozměry karty
 * @param {{width:number,height:number}} p.viewport  rozměry okna
 * @returns {{top:number,left:number,placement:string}}
 */
export const computeCardPosition = ({ target, card, viewport, margin = 12, gap = 14 }) => {
  const vw = viewport.width;
  const vh = viewport.height;
  const cw = Math.min(card.width, Math.max(0, vw - 2 * margin));
  const ch = Math.min(card.height, Math.max(0, vh - 2 * margin));
  const clampX = (x) => Math.max(margin, Math.min(x, vw - cw - margin));
  const clampY = (y) => Math.max(margin, Math.min(y, vh - ch - margin));
  const pos = (left, top, placement) => ({ left: round(left), top: round(top), placement });
  const center = (placement = 'center') => pos(clampX((vw - cw) / 2), clampY((vh - ch) / 2), placement);

  if (!target) return center();

  const right = target.left + target.width;
  const bottom = target.top + target.height;

  // Telefon: karta je přilepená k dolnímu (nebo, když by tam zakrývala prvek, k hornímu) okraji.
  if (vw < 640) {
    const dockBottom = vh - ch - margin;
    if (bottom + gap <= dockBottom) return pos(clampX((vw - cw) / 2), dockBottom, 'dock-bottom');
    if (target.top - gap >= margin + ch) return pos(clampX((vw - cw) / 2), margin, 'dock-top');
    return pos(clampX((vw - cw) / 2), dockBottom, 'dock-bottom');
  }

  const cx = clampX(target.left + target.width / 2 - cw / 2);
  if (bottom + gap + ch <= vh - margin) return pos(cx, bottom + gap, 'below');
  if (target.top - gap - ch >= margin) return pos(cx, target.top - gap - ch, 'above');
  const cy = clampY(target.top + target.height / 2 - ch / 2);
  if (right + gap + cw <= vw - margin) return pos(right + gap, cy, 'right');
  if (target.left - gap - cw >= margin) return pos(target.left - gap - cw, cy, 'left');
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
