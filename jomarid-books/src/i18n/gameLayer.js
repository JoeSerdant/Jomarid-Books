// Překladová vrstva her. Hra běží v iframu (srcDoc), kam appkin React nedosáhne, a texty má v hotových dokumentech (DOM, canvas, alert).
// Appka proto při anglickém jazyce vloží na začátek <head> hry krátký skript (jako úložiště postupu v gameSave/shim.js) se slovníkem
// téhle hry. Skript v ES5 a v jedné funkci:
//   - překládá textové uzly a atributy (title, aria-label, placeholder, alt) při načtení i při každé změně dokumentu (MutationObserver),
//   - překládá text kreslený do canvasu (fillText, strokeText, measureText) a okna alert/confirm/prompt,
//   - přepíná formátování čísel a dat z češtiny na angličtinu (Intl, toLocaleString),
//   - vystaví window.jomaridT(text) pro složené věty, které si hra skládá sama.
// Slovník: { 'Česky': 'English' }. Klíč smí mít místa {0}, {1}...: dosazená část (číslo, jméno, jiný přeložitelný text) se vezme z věty
// a přeloží se zvlášť; tak se překládají i věty skládané z kousků ('Máš ' + n + ' mincí' -> 'Máš {0} mincí').
// Nepřeložený text zůstane česky (nic nespadne, chybějící překlad je vidět), a text bez písmen (čísla, značky) se vůbec neprohlíží.

const LAYER_TEMPLATE = `(function () {
  var CFG = __CONFIG__;
  var identity = function (s) { return s; };
  window.jomaridLang = CFG && CFG.lang === 'en' ? 'en' : 'cs';
  if (!CFG || CFG.lang !== 'en') { window.jomaridT = identity; return; }
  var DICT = CFG.dict || {};
  var PH = /\\{(\\d+)\\}/g;
  var exact = Object.create(null), pats = [];
  function norm(s) { return String(s).replace(/[\\s\\u200b\\ufeff]+/g, ' ').replace(/^ | $/g, ''); }
  function esc(s) { return s.replace(/[.*+?^$()|[\\]\\\\{}]/g, '\\\\$&'); }
  Object.keys(DICT).forEach(function (cs) {
    var en = DICT[cs]; var key = norm(cs);
    if (!/\\{\\d+\\}/.test(key)) { exact[key] = en; return; }
    var parts = key.split(/\\{\\d+\\}/); var idx = [];
    key.replace(PH, function (m, i) { idx.push(Number(i)); return m; });
    var src = '^' + parts.map(function (p) { return esc(p).replace(/ /g, '\\\\s+'); }).join('([\\\\s\\\\S]*?)') + '$';
    pats.push({ re: new RegExp(src), idx: idx, en: en, lit: key.replace(PH, '').length });
  });
  pats.sort(function (a, b) { return b.lit - a.lit; });
  var cache = Object.create(null), cacheCount = 0;
  var LETTER = /[A-Za-z\\u00C0-\\u024F]/;
  function lookup(core, depth) {
    var hit = exact[core];
    if (hit !== undefined) return hit;
    if (depth > 2) return null;
    for (var p = 0; p < pats.length; p++) {
      var m = pats[p].re.exec(core);
      if (!m) continue;
      var args = [];
      for (var i = 0; i < pats[p].idx.length; i++) {
        var g = m[i + 1]; var tr = LETTER.test(g) ? lookup(norm(g), depth + 1) : null;
        args[pats[p].idx[i]] = tr === null ? g : tr;
      }
      return pats[p].en.replace(PH, function (x, n) { return args[n] !== undefined ? args[n] : x; });
    }
    return null;
  }
  function T(text) {
    if (typeof text !== 'string' || text.length === 0 || !LETTER.test(text)) return text;
    var c = cache[text];
    if (c !== undefined) return c;
    var core = norm(text); var out = lookup(core, 0);
    if (out === null) { if (CFG.collect) (window.__jomaridMiss = window.__jomaridMiss || {})[core] = 1; out = text; }
    else out = /^[\\s\\u200b\\ufeff]*/.exec(text)[0] + out + /[\\s\\u200b\\ufeff]*$/.exec(text)[0];
    if (cacheCount > 4000) { cache = Object.create(null); cacheCount = 0; }
    cache[text] = out; cacheCount++;
    return out;
  }
  window.jomaridT = T;

  // ---- DOM ----
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1 };
  var ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'aria-description', 'aria-valuetext'];
  // Text we wrote ourselves is not translated again (saves work, and in collect mode does not report our own output as missing).
  var wroteText = typeof WeakMap === 'function' ? new WeakMap() : null;
  var wroteAttr = typeof WeakMap === 'function' ? new WeakMap() : null;
  function fixAttrs(el) {
    var w = wroteAttr ? (wroteAttr.get(el) || (wroteAttr.set(el, {}), wroteAttr.get(el))) : {};
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (v && w[ATTRS[i]] !== v) { var t = T(v); if (t !== v) { el.setAttribute(ATTRS[i], t); w[ATTRS[i]] = t; } }
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '')) { var val = el.value; var tv = T(val); if (tv !== val) el.value = tv; }
  }
  function fixTree(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      if (root.parentNode && SKIP[root.parentNode.tagName]) return;
      var v = root.nodeValue;
      if (wroteText && wroteText.get(root) === v) return;
      var t = T(v);
      if (t !== v) { root.nodeValue = t; if (wroteText) wroteText.set(root, t); }
      return;
    }
    if (root.nodeType !== 1 || SKIP[root.tagName]) return;
    fixAttrs(root);
    for (var n = root.firstChild; n; n = n.nextSibling) fixTree(n);
  }
  function fixDocument() {
    try { document.documentElement.setAttribute('lang', 'en'); } catch (e) {}
    try { var title = document.title; var tt = T(title); if (tt !== title) document.title = tt; } catch (e) {}
    fixTree(document.documentElement);
  }
  if (typeof MutationObserver === 'function') {
    var obs = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'childList') { for (var k = 0; k < m.addedNodes.length; k++) fixTree(m.addedNodes[k]); }
        else if (m.type === 'characterData') { if (!(m.target.parentNode && SKIP[m.target.parentNode.tagName])) fixTree(m.target); }
        else if (m.type === 'attributes') fixAttrs(m.target);
      }
    });
    try { obs.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS }); } catch (e) {}
  }
  document.addEventListener('DOMContentLoaded', fixDocument);
  window.addEventListener('load', fixDocument);

  // ---- canvas ----
  [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D].forEach(function (Ctx) {
    if (!Ctx || !Ctx.prototype) return;
    ['fillText', 'strokeText', 'measureText'].forEach(function (name) {
      var orig = Ctx.prototype[name];
      if (typeof orig !== 'function') return;
      Ctx.prototype[name] = function (text) {
        if (typeof text === 'string') { var args = Array.prototype.slice.call(arguments); args[0] = T(text); return orig.apply(this, args); }
        return orig.apply(this, arguments);
      };
    });
  });

  // ---- okna ----
  ['alert', 'confirm', 'prompt'].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function (message) {
      var args = Array.prototype.slice.call(arguments);
      if (typeof args[0] === 'string' || typeof args[0] === 'number') args[0] = T(String(args[0]));
      if (typeof args[1] === 'string') args[1] = T(args[1]);
      return orig.apply(window, args);
    };
  });

  // ---- numbers and dates: the Czech locale is replaced by the English one ----
  var LOCALE = CFG.locale || 'en-GB';
  var fixLocale = function (l) { return (l === undefined || l === null || /^cs/i.test(String(l))) ? LOCALE : l; };
  try {
    ['NumberFormat', 'DateTimeFormat'].forEach(function (name) {
      var Orig = Intl[name];
      var Wrapped = function (l, o) { return new Orig(fixLocale(l), o); };
      Wrapped.prototype = Orig.prototype;
      Wrapped.supportedLocalesOf = Orig.supportedLocalesOf;
      Intl[name] = Wrapped;
    });
    var wrapLocaleMethod = function (proto, name) {
      var orig = proto[name];
      if (typeof orig !== 'function') return;
      proto[name] = function (l, o) { return orig.call(this, fixLocale(l), o); };
    };
    wrapLocaleMethod(Number.prototype, 'toLocaleString');
    ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(function (name) { wrapLocaleMethod(Date.prototype, name); });
  } catch (e) {}
})();`;

// Hodnota bezpečná pro vložení do <script> (stejně jako v gameSave/shim.js): "<" se zapíše jako \\u003c, oddělovače řádků výslovně.
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export const LOCALE_OF = { en: 'en-GB' };

/** Text skriptu vrstvy: lang 'en' se slovníkem, jinak jen prázdná náhrada window.jomaridT. */
// options.collect: jen pro zkoušky v prohlížeči; vrstva si do window.__jomaridMiss zapisuje všechny texty s písmeny, které nenašla ve slovníku.
export function buildGameLayer(lang, dict, options) {
  const config = lang === 'en' ? { lang: 'en', locale: LOCALE_OF.en, dict: dict || {}, collect: !!(options && options.collect) } : { lang: 'cs' };
  return LAYER_TEMPLATE.replace('__CONFIG__', () => scriptJson(config));
}

/** Vloží vrstvu na začátek <head> hry (před její skripty). Dokument bez <head> ji dostane za <html>, bez obojího na začátek. */
export function withGameLanguage(html, lang, dict, options) {
  const tag = `<script>${buildGameLayer(lang, dict, options)}</script>`;
  const at = (re) => { const m = re.exec(html); return m ? m.index + m[0].length : -1; };
  const i = at(/<head(?:\s[^>]*)?>/i);
  const j = i >= 0 ? i : at(/<html(?:\s[^>]*)?>/i);
  return j >= 0 ? html.slice(0, j) + tag + html.slice(j) : tag + html;
}
