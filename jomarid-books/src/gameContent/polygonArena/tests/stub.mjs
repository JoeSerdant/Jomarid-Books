// Spustí celou hru (všechny skripty ve správném pořadí) v Node bez prohlížeče: místo DOM dostane "hluchý" atrapový
// model, kreslení se neprovádí. Díky tomu se dá simulace, AI i režimy testovat rychle a deterministicky.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = fs.readFileSync(path.join(DIR, '..', 'polygonArena.js'), 'utf8').match(/\['[a-z0-9]+', [a-z0-9]+\]/g).map((s) => s.match(/'([a-z0-9]+)'/)[1]);

// Atrapa, která přežije jakékoli čtení, volání i zápis (vrací samu sebe); pár vlastností má smysluplné hodnoty.
function dummy(extra = {}) {
  const fn = function () {};
  const p = new Proxy(fn, {
    get(t, k) {
      if (k in extra) return extra[k];
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'dataset') return {};
      if (k === 'children' || k === 'childNodes') return [];
      if (k === 'getBoundingClientRect') return () => ({ width: 800, height: 600, left: 0, top: 0 });
      if (k === 'getContext') return () => dummy({ measureText: () => ({ width: 10 }) });
      if (k === 'querySelectorAll') return () => [];
      if (k === 'width' || k === 'height') return 192;
      return p;
    },
    set() { return true; },
    apply() { return p; },
  });
  return p;
}

export function loadGame({ seed = 1, storage = {} } = {}) {
  const listeners = {};
  const store = Object.assign({}, storage);
  const documentStub = {
    getElementById: () => dummy(), querySelector: () => dummy(), querySelectorAll: () => [],
    createElement: () => dummy(), addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener() {},
    documentElement: dummy(), body: dummy(), hidden: false,
  };
  const ctx = vm.createContext({
    console, Object, Array, Set, Map, JSON, Number, String, Boolean, Symbol, Proxy, Promise, parseInt, parseFloat, isFinite, isNaN, Error, RegExp, Date, Uint8Array, Float32Array,
    document: documentStub,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    navigator: { vibrate: () => false }, performance: { now: () => Date.now() },
    matchMedia: () => ({ matches: false, addEventListener() {} }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: () => 0, addEventListener() {}, removeEventListener() {},
    devicePixelRatio: 1, MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout, clearTimeout, AudioContext: undefined, webkitAudioContext: undefined,
  });
  ctx.window = ctx;
  // Math.random podle seedu (každý kontext má vlastní Math)
  vm.runInContext(`(() => { let s = ${seed >>> 0}; Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`, ctx);
  for (const id of ORDER) vm.runInContext(fs.readFileSync(path.join(DIR, id + '.js'), 'utf8'), ctx, { filename: id + '.js' });
  for (const f of listeners.DOMContentLoaded || []) f();          // main.js: zpřístupní __arena a spustí boot()
  const G = (name) => vm.runInContext(name, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return { ctx, G, run, arena: ctx.__arena, store };
}
