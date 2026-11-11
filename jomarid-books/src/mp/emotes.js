// Rychlé reakce v online zápase (mp_emote): kód 1 až 8, stejné pro oba hráče; server drží jen kód, vzhled je tady.
import { tk } from '../i18n/mark.js';

export const EMOTES = [
  { code: 1, icon: '👍', label: tk('Palec nahoru') },
  { code: 2, icon: '👏', label: tk('Potlesk') },
  { code: 3, icon: '😮', label: tk('Údiv') },
  { code: 4, icon: '😂', label: tk('Smích') },
  { code: 5, icon: '😅', label: tk('Uf') },
  { code: 6, icon: '🔥', label: tk('Skvělý tah') },
  { code: 7, icon: '🤝', label: tk('Podání ruky') },
  { code: 8, icon: '⏳', label: tk('Pospěš si') },
];

export const emoteByCode = (code) => EMOTES.find((e) => e.code === Number(code)) || null;

// Je v pohledu na zápas nová reakce soupeře? Vrací { code, n } jen když je číslo reakce vyšší než naposledy zobrazené a reakce není stará.
export function freshEmote(view, lastN) {
  const e = view && view.opp_emote;
  if (!e || !Number.isFinite(e.n) || e.n <= lastN) return null;
  if (!emoteByCode(e.c)) return null;
  if (Number.isFinite(e.age) && e.age > 8000) return null;
  return { code: Number(e.c), n: e.n };
}
