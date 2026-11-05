// Skener zdrojáků pro překlady (jen nástroj a testy, do appky se nebalí). Z kódu appky vytáhne:
//  - klíče překladů: literály v t('...'), tk('...') a t.p(n, 'jedna', 'dvě', 'pět')  (klíč plurálu je 'jedna|dvě|pět'),
//  - české texty, které zůstaly bez překladu (JSX text, texty v atributech jako title nebo aria-label, řetězce s českou diakritikou).
// Řetězec uvnitř t(...) / tk(...) je přeložený; console.* a importy se přeskakují.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;

export const SRC_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SKIP_DIRS = new Set(['gameContent', 'tests', 'fonts', 'bookText', 'tools']);
const CZECH_DIACRITIC = /[ěščřžýáíéůúďťňĚŠČŘŽÝÁÍÉŮÚĎŤŇ]/;
const HAS_LETTERS = /\p{L}{2,}/u;
// Atributy, jejichž text vidí člověk (u vlastních komponent i běžných prvků).
export const TEXT_ATTRS = new Set([
  'title', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'alt', 'placeholder', 'label', 'description', 'hint',
  'subtitle', 'heading', 'caption', 'tooltip', 'helper', 'text', 'message', 'ariaLabel', 'emptyText', 'confirmLabel', 'cancelLabel',
  'question', 'answer',
]);

/** Všechny zdrojové soubory appky (jsx a js bez her, testů a nástrojů), cesty relativní k src/. */
export const listSourceFiles = (dir = SRC_DIR, base = SRC_DIR) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...listSourceFiles(p, base)); }
    else if (/\.(jsx|js|ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
};

const isCallTo = (node, name) => node && node.type === 'CallExpression' && node.callee.type === 'Identifier' && (node.callee.name === name || (name === 't' && node.callee.name === 'tx'));
const isPluralCall = (node) => node && node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed
  && node.callee.object.type === 'Identifier' && node.callee.object.name === 't' && node.callee.property.name === 'p';
const staticString = (n) => {
  if (!n) return null;
  if (n.type === 'StringLiteral') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
  return null;
};
// Všechny statické texty, které výraz může vrátit (podmínka a ? 'x' : 'y', rezerva a || 'x'); dynamic = je v něm i něco, co se nedá přečíst ze zdroje.
const staticStrings = (n) => {
  const one = staticString(n);
  if (one !== null) return { list: [one], dynamic: false };
  if (n && n.type === 'ConditionalExpression') {
    const a = staticStrings(n.consequent); const b = staticStrings(n.alternate);
    return { list: [...a.list, ...b.list], dynamic: a.dynamic || b.dynamic };
  }
  if (n && n.type === 'LogicalExpression' && (n.operator === '||' || n.operator === '??')) {
    const a = staticStrings(n.left); const b = staticStrings(n.right);
    return { list: [...a.list, ...b.list], dynamic: a.dynamic || b.dynamic };
  }
  return { list: [], dynamic: true };
};

// Které konstanty na úrovni modulu obsahují texty označené tk(...) a jsou exportované (jiný soubor je musí při použití přeložit).
const tkExportCache = new Map();
const unwrapFreeze = (n) => (n && n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'Object' && n.callee.property.name === 'freeze' ? n.arguments[0] : n);
// "Plochá" tabulka textů: každá hodnota je tk('...'), takže i obyčejný přístup X.klíč je text.
const isFlatTable = (init) => {
  const o = unwrapFreeze(init);
  if (!o) return false;
  if (o.type === 'CallExpression') return o.callee.type === 'Identifier' && o.callee.name === 'tk';
  if (o.type === 'ObjectExpression') return o.properties.length > 0 && o.properties.every((pr) => pr.type === 'ObjectProperty' && pr.value.type === 'CallExpression' && pr.value.callee.type === 'Identifier' && pr.value.callee.name === 'tk');
  return false;
};
const topLevelTkNames = (ast) => {
  const names = new Set(); const exported = new Set(); const flat = new Set();
  traverse(ast, {
    VariableDeclarator(path) {
      const decl = path.parentPath; const top = decl.parentPath;
      const isTop = top.isProgram() || (top.isExportNamedDeclaration() && top.parentPath.isProgram());
      if (!isTop || path.node.id.type !== 'Identifier') return;
      let has = path.node.init && isCallTo(path.node.init, 'tk');
      if (!has && path.node.init) path.get('init').traverse({ CallExpression(q) { if (isCallTo(q.node, 'tk')) has = true; } });
      if (has) { names.add(path.node.id.name); if (isFlatTable(path.node.init)) flat.add(path.node.id.name); if (top.isExportNamedDeclaration()) exported.add(path.node.id.name); }
    },
    ExportNamedDeclaration(path) {
      if (!path.node.source && path.node.specifiers.length) for (const sp of path.node.specifiers) if (sp.local && sp.exported) exported.add(`__spec:${sp.local.name}:${sp.exported.name}`);
    },
  });
  for (const e of [...exported]) {
    if (!e.startsWith('__spec:')) continue;
    exported.delete(e);
    const [, local, ext] = e.split(':');
    if (names.has(local)) exported.add(ext);
  }
  return { names, exported, flat };
};
export const tkExportsOf = (rel) => {
  if (tkExportCache.has(rel)) return tkExportCache.get(rel);
  let out = { exported: new Set(), flat: new Set() };
  try {
    const code = fs.readFileSync(path.join(SRC_DIR, rel), 'utf8');
    if (code.includes('tk(')) { const r = topLevelTkNames(parse(code, { sourceType: 'module', plugins: /\.tsx?$/.test(rel) ? ['jsx', 'typescript'] : ['jsx'] })); out = { exported: r.exported, flat: r.flat }; }
  } catch { /* soubor chybí nebo nejde přeložit: nic neexportuje */ }
  tkExportCache.set(rel, out);
  return out;
};
const resolveImport = (fromRel, source) => {
  if (!source.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), source));
  for (const cand of [base, `${base}.js`, `${base}.jsx`, `${base}/index.js`, `${base}/index.jsx`]) {
    try { if (fs.statSync(path.join(SRC_DIR, cand)).isFile()) return cand; } catch { /* zkusit další */ }
  }
  return null;
};

/** Zdroj -> { keys: [{ key, kind, line }], raw: [{ kind, text, line }], dynamic: [{ line, arg }], problems: [{ kind, line }] }.
 *  problems: 'unbound' (t není importované), 'shadowed' (t je jiná proměnná), 'moduleLevel' (t zavolané na úrovni modulu, kde ještě není načtený jazyk). */
export const scanSource = (code, file = '') => {
  const ast = parse(code, { sourceType: 'module', plugins: file.endsWith('.ts') || file.endsWith('.tsx') ? ['jsx', 'typescript'] : ['jsx'] });
  const keys = []; const raw = []; const dynamic = []; const problems = [];
  const wrappedBy = (path) => {
    for (let p = path.parentPath; p; p = p.parentPath) {
      if (p.isCallExpression() && (isCallTo(p.node, 't') || isCallTo(p.node, 'tk') || isPluralCall(p.node))) return true;
      if (p.isFunction()) return false;
    }
    return false;
  };
  const insideConsole = (path) => {
    for (let p = path.parentPath; p; p = p.parentPath) {
      if (p.isCallExpression() && p.node.callee.type === 'MemberExpression' && p.node.callee.object.type === 'Identifier' && p.node.callee.object.name === 'console') return true;
    }
    return false;
  };
  traverse(ast, {
    CallExpression(path) {
      const n = path.node;
      if (isCallTo(n, 't') || isPluralCall(n)) {
        const b = path.scope.getBinding(n.callee.name === 'tx' ? 'tx' : 't');
        if (!b) problems.push({ kind: 'unbound', line: n.loc.start.line });
        else if (b.kind !== 'module') problems.push({ kind: 'shadowed', line: n.loc.start.line });
        if (!path.getFunctionParent()) problems.push({ kind: 'moduleLevel', line: n.loc.start.line });
      }
      if (isCallTo(n, 't') || isCallTo(n, 'tk')) {
        const r = staticStrings(n.arguments[0]);
        for (const key of r.list) keys.push({ key, kind: isCallTo(n, 'tk') ? 'tk' : 't', line: n.loc.start.line });
        if (r.dynamic) dynamic.push({ line: n.loc.start.line, arg: code.slice(n.arguments[0].start, n.arguments[0].end).replace(/\s+/g, ' ') });
      } else if (isPluralCall(n)) {
        const forms = [n.arguments[1], n.arguments[2], n.arguments[3]].map(staticString);
        if (forms.some((f) => f === null)) dynamic.push({ line: n.loc.start.line, arg: `t.p(${n.arguments.slice(1, 4).map((a) => code.slice(a.start, a.end)).join(', ')})` }); else keys.push({ key: forms.join('|'), kind: 'plural', line: n.loc.start.line });
      }
    },
    JSXText(path) {
      if (path.findParent((q) => q.isJSXElement() && q.node.openingElement.attributes.some((a) => a.type === 'JSXAttribute' && a.name.name === 'translate' && a.value && a.value.value === 'no'))) return; // značka, název appky: neprekládá se
      const v = path.node.value.replace(/[ \t\r\n]+/g, ' ').replace(/^ | $/g, ''); // JSX zachází jen s obyčejnými mezerami (pevná mezera zůstává)
      if (v && HAS_LETTERS.test(v)) raw.push({ kind: 'jsxText', text: v, line: path.node.loc.start.line });
    },
    JSXAttribute(path) {
      const name = path.node.name.type === 'JSXIdentifier' ? path.node.name.name : null;
      const val = path.node.value;
      if (name && TEXT_ATTRS.has(name) && val && val.type === 'StringLiteral' && HAS_LETTERS.test(val.value)) raw.push({ kind: 'jsxAttr', text: val.value, line: val.loc.start.line });
    },
    StringLiteral(path) {
      const p = path.parent;
      if (/^(ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration|JSXAttribute)$/.test(p.type)) return;
      if ((p.type === 'ObjectProperty' || p.type === 'ObjectMethod') && p.key === path.node && !p.computed) return;
      const v = path.node.value;
      if (wrappedBy(path) || insideConsole(path)) return;
      if (CZECH_DIACRITIC.test(v)) { raw.push({ kind: 'string', text: v, line: path.node.loc.start.line }); return; }
      // Český text bez diakritiky: poznat se dá jen podle místa. Přímo vypsaný text v JSX ({a ? 'Ano' : 'Ne'}), text v atributech jako title nebo aria-label
      // a hodnoty vlastností label, title, description... v seznamech a katalozích.
      if (!/\p{L}{2,}/u.test(v) || /^[a-z0-9_.:\/#@-]+$/.test(v) && !/\s/.test(v) && /^[a-z]/.test(v)) return; // identifikátory, cesty, ID: malá písmena bez mezer
      let top = path;
      while (top.parentPath && (top.parentPath.isConditionalExpression() || top.parentPath.isLogicalExpression())) top = top.parentPath;
      const holder = top.parentPath;
      if (holder && holder.isJSXExpressionContainer()) {
        const owner = holder.parent;
        if (owner.type === 'JSXElement' || owner.type === 'JSXFragment') raw.push({ kind: 'string', text: v, line: path.node.loc.start.line });
        else if (owner.type === 'JSXAttribute' && owner.name.type === 'JSXIdentifier' && TEXT_ATTRS.has(owner.name.name)) raw.push({ kind: 'string', text: v, line: path.node.loc.start.line });
        return;
      }
      if (p.type === 'ObjectProperty' && p.value === path.node && !p.computed && ['label', 'title', 'description', 'hint', 'text', 'message', 'caption', 'placeholder'].includes(p.key.name || p.key.value)) raw.push({ kind: 'string', text: v, line: path.node.loc.start.line });
    },
    TemplateLiteral(path) {
      const text = path.node.quasis.map((q) => q.value.cooked).join('{}');
      if (wrappedBy(path) || insideConsole(path)) return;
      if (CZECH_DIACRITIC.test(text)) { raw.push({ kind: 'template', text, line: path.node.loc.start.line }); return; }
      // šablona v atributu s textem (aria-label={`Smazat krok ${i}`}) nebo přímo vypsaná v JSX
      const holder = path.parentPath;
      if (holder && holder.isJSXExpressionContainer() && /\p{L}{3,}/u.test(text.replace(/\{\}/g, ' '))) {
        const owner = holder.parent;
        if (owner.type === 'JSXElement' || owner.type === 'JSXFragment' || (owner.type === 'JSXAttribute' && owner.name.type === 'JSXIdentifier' && TEXT_ATTRS.has(owner.name.name))) raw.push({ kind: 'template', text, line: path.node.loc.start.line });
      }
    },
  });
  // Konstanty na úrovni modulu s texty označenými tk(...): každé jejich použití musí jít přes t(...), jinak by zůstaly česky.
  const tkConstants = new Map(); // název -> řádek deklarace
  const flatNames = new Set();
  traverse(ast, {
    VariableDeclarator(path) {
      if (path.parentPath.parentPath.isProgram() || (path.parentPath.parentPath.isExportNamedDeclaration() && path.parentPath.parentPath.parentPath.isProgram())) {
        let has = false;
        path.get('init').traverse({ CallExpression(q) { if (isCallTo(q.node, 'tk')) has = true; } });
        if (!has && path.node.init && path.node.init.type === 'CallExpression' && isCallTo(path.node.init, 'tk')) has = true;
        if (has && path.node.id.type === 'Identifier') { tkConstants.set(path.node.id.name, path.node.loc.start.line); if (isFlatTable(path.node.init)) flatNames.add(path.node.id.name); }
      }
    },
  });
  // tk konstanty importované z jiných souborů
  const importedTk = new Set();
  for (const n of ast.program.body) {
    if (n.type !== 'ImportDeclaration') continue;
    const target = file ? resolveImport(file, n.source.value) : null;
    if (!target) continue;
    const ex = tkExportsOf(target);
    for (const sp of n.specifiers) if (sp.type === 'ImportSpecifier' && ex.exported.has(sp.imported.name || sp.imported.value)) { importedTk.add(sp.local.name); if (ex.flat.has(sp.imported.name || sp.imported.value)) flatNames.add(sp.local.name); }
  }
  const unwrappedUses = [];
  traverse(ast, {
    Identifier(path) {
      const name = path.node.name;
      if (!(tkConstants.has(name) || importedTk.has(name)) || !path.isReferencedIdentifier()) return;
      const b = path.scope.getBinding(name);
      if (!b || !b.scope.path.isProgram()) return;
      // použití uvnitř funkce (vykreslení, obsluha události), ne při načtení modulu
      if (!path.getFunctionParent()) return;
      // Vypsání: konstanta (nebo její položka) přímo ve výrazu v JSX, nebo uložená jako text/label/title/message. Odvozené použití
      // (Object.entries(X).map(...), X.filter(...)) tu nejde sledovat, to hlídá zkouška v prohlížeči (viditelný český klíč ve slovníku).
      let top = path; let lastProp = null;
      while (top.parentPath && ((top.parentPath.isMemberExpression() && top.parentPath.node.object === top.node) || top.parentPath.isOptionalMemberExpression() || top.parentPath.isLogicalExpression() || top.parentPath.isConditionalExpression())) {
        top = top.parentPath;
        if ((top.isMemberExpression() || top.isOptionalMemberExpression()) && !top.node.computed) lastProp = top.node.property.name; else if (top.isMemberExpression()) lastProp = null;
      }
      if (lastProp && !flatNames.has(name) && !['label', 'title', 'text', 'hint', 'description', 'desc', 'short', 'heading', 'caption', 'message', 'equipped', 'name'].includes(lastProp)) return; // položka, která není text (route, key, id...); v ploché tabulce textů je text každá
      const sinkParent = top.parent;
      const isOptionsAttr = sinkParent.type === 'JSXExpressionContainer' && top.parentPath.parent.type === 'JSXAttribute' && top.parentPath.parent.name.name === 'options'; // texty přeloží přijímající komponenta
      const isSink = !isOptionsAttr && (sinkParent.type === 'JSXExpressionContainer'
        || (sinkParent.type === 'ObjectProperty' && sinkParent.value === top.node && !sinkParent.computed && ['text', 'label', 'title', 'message', 'description', 'hint'].includes(sinkParent.key.name || sinkParent.key.value))
        || sinkParent.type === 'TemplateLiteral');
      if (!isSink) return;
      if ((code.split('\n')[path.node.loc.start.line - 1] || '').includes('i18n-ok')) return;
      for (let p = path.parentPath; p; p = p.parentPath) {
        if (p.isCallExpression() && (isCallTo(p.node, 't') || isPluralCall(p.node))) return;
        if (p.isFunction()) break;
      }
      unwrappedUses.push({ name, line: path.node.loc.start.line });
    },
  });
  // Řádek označený i18n-ok je záměrně v původním jazyce (ukázka z knihy, jméno): nehlásí se jako nepřeložený text.
  const lines = code.split('\n');
  const rawChecked = raw.filter((r) => !(lines[r.line - 1] || '').includes('i18n-ok'));
  return { keys, raw: rawChecked, dynamic, problems, tkUses: unwrappedUses };
};

/** Soubor ze src/ -> výsledek scanSource. */
export const scanFile = (rel) => scanSource(fs.readFileSync(path.join(SRC_DIR, rel), 'utf8'), rel);

/** Jedinečné nepřeložené texty souboru (seřazené), jak je drží základní seznam. */
export const rawTexts = (scan) => [...new Set(scan.raw.map((r) => r.text))].sort((a, b) => a.localeCompare(b, 'cs'));

/** Parametry {název} v textu (seřazené), pro kontrolu, že anglický text má stejné jako český. */
export const placeholdersOf = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

export const hasCzechDiacritics = (s) => CZECH_DIACRITIC.test(s);
