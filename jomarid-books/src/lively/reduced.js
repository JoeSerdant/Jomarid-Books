// Má se pohyb omezit? Jedno místo pro Živý režim. Atribut data-reduce-motion na <html> nastavuje App až po prvním vykreslení, jenže
// objevování karet a počítání čísel se spouští ještě před ním: proto se při chybějícím atributu vyhodnotí nastavení hned (a atribut se tím nastaví).
import { applyMotionPref } from '../theme.js';

export const prefersReducedMotion = (doc = globalThis.document) => {
  const attr = doc && doc.documentElement && doc.documentElement.dataset ? doc.documentElement.dataset.reduceMotion : undefined;
  if (attr === '1') return true;
  if (attr === '0') return false;
  try { return !!applyMotionPref(); } catch { return false; }
};
