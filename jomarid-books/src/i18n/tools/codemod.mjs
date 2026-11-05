// Převodník: v zadaných souborech obalí české texty do t(...) / tk(...) a přidá import. Mění jen to, co se dá bezpečně převést strojově,
// zbytek vypíše k ručnímu dokončení (věty rozdělené výrazy {...}, šablony s ${...}, shodná jména t).
//   node src/i18n/tools/codemod.mjs [--strings] [--data] [--dry] <soubor-ze-src> ...
//   (výchozí)  JSX text a texty v atributech (title, aria-label, placeholder, label, description ...) -> {t('...')}
//   --strings  navíc řetězce s českou diakritikou uvnitř funkcí -> t('...'), na úrovni modulu -> tk('...')
//   --data     datový soubor (katalog odznaků, štítky): všechny řetězce s diakritikou a texty ve vlastnostech title, label, ... -> tk('...')
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { SRC_DIR, TEXT_ATTRS } from './scan.mjs';

const traverse = _traverse.default || _traverse;
const CZECH = /[ěščřžýáíéůúďťňĚŠČŘŽÝÁÍÉŮÚĎŤŇ]/;
const LETTERS = /\p{L}{2,}/u;
const WS = /[ \t\r\n]+/g;
const DATA_PROPS = new Set(['title', 'label', 'description', 'desc', 'name', 'hint', 'text', 'message', 'caption', 'subtitle', 'heading', 'equipped', 'tagline', 'summary']);
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

export const transform = (code, rel, { strings = false, data = false, wrap = {} } = {}) => {
  const plugins = /\.tsx?$/.test(rel) ? ['jsx', 'typescript'] : ['jsx'];
  const ast = parse(code, { sourceType: 'module', plugins });
  const edits = []; const report = []; let usesT = false; let usesTk = false;
  const hasImport = (name) => ast.program.body.some((n) => n.type === 'ImportDeclaration' && /i18n(\/(index|core|mark)\.js)?$/.test(n.source.value) && n.specifiers.some((s) => s.local.name === name));
  const shadow = []; const handled = new Set(); const replacedCallees = new Set();
  traverse(ast, {
    Identifier(path) {
      if (path.node.name === 't' && path.isBindingIdentifier() && !(path.parent.type === 'ImportSpecifier')) shadow.push(path.node.loc.start.line);
    },
  });
  if (shadow.length) report.push(`⚠ proměnná t už existuje (řádky ${[...new Set(shadow)].join(', ')}): přejmenovat, jinak se překrývá s překladem`);

  traverse(ast, {
    CallExpression(path) {
      const n = path.node;
      // pomocné funkce katalogů (stat(klíč, popisek, max), badge(id, ..., název, popis)): zadané pozice argumentů jsou texty -> tk(...)
      if (n.callee.type === 'Identifier' && wrap[n.callee.name]) {
        for (const i of wrap[n.callee.name]) {
          const a = n.arguments[i];
          if (a && a.type === 'StringLiteral' && LETTERS.test(a.value)) { handled.add(a); edits.push({ start: a.start, end: a.end, text: `tk(${quote(a.value)})` }); usesTk = true; }
        }
        return;
      }
      if (n.callee.type !== 'Identifier' || n.callee.name !== 'plural' || n.arguments.length < 4) return;
      const forms = n.arguments.slice(1, 4);
      const first = code.slice(n.arguments[0].start, n.arguments[0].end);
      if (!forms.every((a) => a.type === 'StringLiteral')) { report.push(`řádek ${n.loc.start.line}: plural s nestatickými tvary, převést ručně na t.p`); return; }
      if (CZECH.test(first) || n.arguments.length > 4) { report.push(`řádek ${n.loc.start.line}: plural s češtinou v prvním argumentu, převést ručně`); return; }
      forms.forEach((f) => handled.add(f));
      replacedCallees.add(n.callee);
      edits.push({ start: n.start, end: n.end, text: `t.p(${first}, ${forms.map((f) => quote(f.value)).join(', ')})` });
      usesT = true;
    },
    JSXText(path) {
      const node = path.node;
      const raw = code.slice(node.start, node.end);
      if (!LETTERS.test(raw)) return;
      if (/&[#\w]+;/.test(raw)) { report.push(`řádek ${node.loc.start.line}: text s entitou, převést ručně: ${raw.trim().slice(0, 60)}`); return; }
      const siblings = path.parent.children;
      const i = siblings.indexOf(node);
      const isExpr = (n) => n && n.type === 'JSXExpressionContainer' && n.expression.type !== 'JSXEmptyExpression';
      if (isExpr(siblings[i - 1]) || isExpr(siblings[i + 1])) { report.push(`řádek ${node.loc.start.line}: text vedle výrazu {…}, převést ručně na jednu větu s parametry: ${raw.replace(WS, ' ').trim().slice(0, 70)}`); return; }
      const lead = /^[ \t\r\n]*/.exec(raw)[0]; const trail = /[ \t\r\n]*$/.exec(raw)[0];
      const core = raw.slice(lead.length, raw.length - trail.length).replace(WS, ' ');
      if (!core) return;
      edits.push({ start: node.start, end: node.end, text: `${lead}{t(${quote(core)})}${trail}` });
      usesT = true;
    },
    JSXAttribute(path) {
      const name = path.node.name.type === 'JSXIdentifier' ? path.node.name.name : null;
      const val = path.node.value;
      if (!name || !TEXT_ATTRS.has(name) || !val || val.type !== 'StringLiteral' || !LETTERS.test(val.value)) return;
      const rawVal = code.slice(val.start, val.end);
      if (/&[#\w]+;/.test(rawVal)) { report.push(`řádek ${val.loc.start.line}: atribut s entitou, převést ručně`); return; }
      edits.push({ start: val.start, end: val.end, text: `{t(${quote(val.value)})}` });
      usesT = true;
    },
    StringLiteral(path) {
      if (!strings && !data) return;
      if (handled.has(path.node)) return;
      const p = path.parent; const v = path.node.value;
      if (/^(ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration|JSXAttribute)$/.test(p.type)) return;
      if ((p.type === 'ObjectProperty' || p.type === 'ObjectMethod') && p.key === path.node && !p.computed) return;
      if (p.type === 'BinaryExpression' || p.type === 'SwitchCase' || p.type === 'ImportExpression') return;
      if (p.type === 'CallExpression' && ['t', 'tk'].includes(p.callee.name)) return;
      for (let q = path.parentPath; q; q = q.parentPath) {
        if (q.isCallExpression() && q.node.callee.type === 'MemberExpression' && q.node.callee.object.name === 'console') return;
        if (q.isCallExpression() && ((q.node.callee.name === 't' || q.node.callee.name === 'tk') || (q.node.callee.type === 'MemberExpression' && q.node.callee.object.name === 't'))) return;
        if (q.isFunction()) break;
      }
      const isDataProp = p.type === 'ObjectProperty' && p.value === path.node && !p.computed && DATA_PROPS.has(p.key.name || p.key.value);
      const czech = CZECH.test(v);
      if (data) {
        if (!(czech || (isDataProp && LETTERS.test(v)))) return;
        edits.push({ start: path.node.start, end: path.node.end, text: `tk(${quote(v)})` }); usesTk = true; return;
      }
      if (!czech) return;
      const atModule = !path.getFunctionParent();
      if (atModule) { edits.push({ start: path.node.start, end: path.node.end, text: `tk(${quote(v)})` }); usesTk = true; }
      else { edits.push({ start: path.node.start, end: path.node.end, text: `t(${quote(v)})` }); usesT = true; }
    },
    TemplateLiteral(path) {
      if (!strings) return;
      const text = path.node.quasis.map((q) => q.value.cooked).join('{}');
      if (CZECH.test(text) && !path.findParent((q) => q.isCallExpression() && ['t', 'tk'].includes(q.node.callee.name))) report.push(`řádek ${path.node.loc.start.line}: šablona s ${path.node.expressions.length} výrazy, převést ručně: ${text.slice(0, 70)}`);
    },
  });

  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  // Importy se řeší až nad hotovým textem (druhý průchod): odebere se nepoužitý import { plural } a přidá se import překladů.
  const nl = code.includes('\r\n') ? '\r\n' : '\n';
  const ast2 = parse(out, { sourceType: 'module', plugins });
  const spec = (() => {
    const rel2 = path.relative(path.dirname(path.join(SRC_DIR, rel)), path.join(SRC_DIR, 'i18n')).split(path.sep).join('/');
    return rel2.startsWith('.') ? rel2 : `./${rel2}`;
  })();
  const has = (name) => ast2.program.body.some((n) => n.type === 'ImportDeclaration' && /i18n(\/(index|core|mark)\.js)?$/.test(n.source.value) && n.specifiers.some((sp) => sp.local.name === name));
  const edits2 = [];
  if (replacedCallees.size) {
    traverse(ast2, {
      Program(pp) {
        const b = pp.scope.getBinding('plural');
        if (b && b.kind === 'module' && b.referencePaths.length === 0) {
          const decl = b.path.parentPath.node;
          if (decl.specifiers.length === 1) edits2.push({ start: decl.start, end: out[decl.end] === '\r' ? decl.end + 2 : decl.end + 1, text: '' });
          else report.push('import plural zůstal (jsou v něm i další názvy), odebrat ručně');
        }
        pp.stop();
      },
    });
  }
  const newImports = [];
  if (usesT && !has('t')) newImports.push(`import { t } from '${rel.endsWith('.jsx') ? spec : `${spec}/core.js`}';`); // moduly bez Reactu berou t přímo z jádra
  if (usesTk && !has('tk')) newImports.push(`import { tk } from '${spec}/mark.js';`);
  if (newImports.length) {
    const imps = ast2.program.body.filter((n) => n.type === 'ImportDeclaration');
    const at = imps.length ? imps[imps.length - 1].end : 0;
    edits2.push({ start: at, end: at, text: (imps.length ? nl : '') + newImports.join(nl) + (imps.length ? '' : nl) });
  }
  for (const e of edits2.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { code: out, count: edits.length + edits2.length, report };
};

if (process.argv[1] && process.argv[1].endsWith('codemod.mjs')) {
  const args = process.argv.slice(2);
  const wrap = {};
  for (const a of args.filter((x) => x.startsWith('--wrap='))) for (const part of a.slice(7).split(',')) { const [name, ...pos] = part.split(':'); wrap[name] = pos.map(Number); }
  const opts = { strings: args.includes('--strings'), data: args.includes('--data'), wrap };
  const dry = args.includes('--dry');
  for (const rel of args.filter((a) => !a.startsWith('--'))) {
    const file = path.join(SRC_DIR, rel);
    const code = fs.readFileSync(file, 'utf8');
    const crlf = code.includes('\r\n');
    const res = transform(code, rel, opts);
    if (!dry && res.count) fs.writeFileSync(file, crlf ? res.code.replace(/\r?\n/g, '\r\n') : res.code);
    console.log(`${rel}: ${res.count} úprav${dry ? ' (nanečisto)' : ''}`);
    for (const r of res.report) console.log(`   ${r}`);
  }
}
