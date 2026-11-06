// Texty her. Hra běží v iframu (srcDoc) a texty má ve zdrojích (JS řetězce, šablony, HTML). Tenhle nástroj z nich vyčte všechny české
// texty jako klíče slovníku hry (src/i18n/games/<hra>.js); místa pro dosazené hodnoty se píšou {0}, {1}... ve stejném pořadí jako ve zdroji.
//   node src/i18n/tools/gamestrings.mjs extract <hra> <soubor-úkolů>      zapíše chybějící klíče (číslo|česky) k překladu
//   node src/i18n/tools/gamestrings.mjs apply <hra> <úkoly> <odpovědi>    zapíše překlady do slovníku hry
//   node src/i18n/tools/gamestrings.mjs count [hra]                       kolik klíčů a kolik chybí
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { SRC_DIR, hasCzechDiacritics, placeholdersOf } from './scan.mjs';

const traverse = _traverse.default || _traverse;

// Vlastní jména postav (příběh Rocketu) se v angličtině píšou s původní diakritikou: nepočítají se jako česká diakritika v překladu.
export const NAMES_WITH_DIACRITICS = /Dušan|Eliška|Ondřej|Rybák|Kopecká|Kamenář|Hájková|Včelka|Vránová|Zedníková|Dolejš|Šíp|Jonáš|Kosová/g;
export const withoutNames = (en) => String(en).replace(NAMES_WITH_DIACRITICS, '');
export const GAME_DICT_DIR = path.join(SRC_DIR, 'i18n', 'games');

// hra -> složka v gameContent (kromě testů a stylů se čtou všechny .js a .html)
export const GAMES = {
  koulovikamosi: 'koulovi',
  chess: 'chess',
  cityclicker: 'cityClicker',
  polygonarena: 'polygonArena',
  hannibal: 'hannibal',
  warroom: 'warroom',
  rocket: 'rocket',
};

const CZECH = /[ěščřžýáíéůúďťňóĚŠČŘŽÝÁÍÉŮÚĎŤŇÓ]/;
const LETTER = /\p{L}{2,}/u;
const TAG = /<\/?[a-zA-Z][^>]*>/g;
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

export const gameFiles = (gameId) => {
  const dir = path.join(SRC_DIR, 'gameContent', GAMES[gameId]);
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'tests') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
};

// Text -> klíče. HTML značky uvnitř textu se zahodí a text se rozdělí na části (v DOM jsou to samostatné textové uzly).
// Český text bez diakritiky (Klasika, Menu, Vypnout zvuk) se v JS pozná jen odhadem: začíná velkým písmenem, jsou to jen písmena a běžná
// interpunkce a je delší než tři znaky. Něco z toho bude kód (Enter, ArrowLeft, Arial): takový klíč se ve slovníku přeloží beze změny.
const ASCII_TEXT = /^[A-ZÁ-Ž][\p{L}' .,:!?()+\-0-9%·]*$/u;
const looksLikeText = (k) => ASCII_TEXT.test(k) && (k.includes(' ') || /\p{L}{3,}/u.test(k)) && !/^[A-Z0-9_]{2,}$/.test(k);

// atLeastCzech: true = JS (česká diakritika nebo odhad textu bez diakritiky), false = značky HTML (každý text s písmeny je text)
const textKeys = (raw, atLeastCzech = true) => {
  const parts = /<\/?[a-zA-Z]/.test(raw) ? raw.split(TAG) : [raw];
  const keys = [];
  for (const part of parts) {
    if (/^\s*<!/.test(part)) continue;
    const k = norm(part.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/gi, ' '));
    if (!LETTER.test(k.replace(/\{\d+\}/g, ''))) continue;
    if (atLeastCzech && !CZECH.test(k.replace(/\{\d+\}/g, '')) && !looksLikeText(k.replace(/\{\d+\}/g, '').trim())) continue;
    keys.push(k);
  }
  return keys;
};

const LOGIC_CALLS = new Set(['includes', 'indexOf', 'startsWith', 'endsWith', 'getElementById', 'querySelector', 'querySelectorAll', 'getItem', 'setItem', 'removeItem', 'addEventListener', 'hasOwnProperty', 'matches', 'closest', 'getAttribute']);

const scriptBlocks = (html) => {
  const blocks = []; const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1] || '')) continue;
    const before = html.slice(0, m.index + m[0].indexOf('>') + 1);
    blocks.push({ code: m[2], line: before.split('\n').length });
  }
  return blocks;
};

const markupKeys = (html) => {
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, (s) => s.replace(/[^\n]/g, '')).replace(/<style[\s\S]*?<\/style>/gi, (s) => s.replace(/[^\n]/g, '')).replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ''));
  const out = [];
  let line = 1; let last = 0; let m;
  const re = /<\/?[a-zA-Z][^>]*>/g;
  const lineAt = (idx) => stripped.slice(0, idx).split('\n').length;
  while ((m = re.exec(stripped))) {
    const text = stripped.slice(last, m.index);
    for (const k of textKeys(text, false)) out.push({ key: k, line: lineAt(last) });
    for (const am of m[0].matchAll(/\b(?:title|aria-label|placeholder|alt|aria-description)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      for (const k of textKeys(am[2] ?? am[3] ?? '', false)) out.push({ key: k, line: lineAt(m.index) });
    }
    last = m.index + m[0].length;
  }
  for (const k of textKeys(stripped.slice(last), false)) out.push({ key: k, line: lineAt(last) });
  return out;
};

// Klíče jednoho JS bloku: řetězce, šablony ${} -> {i}, řetězení 'a' + x + 'b' -> 'a{0}b'.
const jsKeys = (code, baseLine) => {
  const out = [];
  let ast;
  try { ast = parse(code, { sourceType: 'script', errorRecovery: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }); }
  catch (e) { return { out, error: e.message }; }
  const add = (key, node) => out.push({ key, line: baseLine + (node.loc ? node.loc.start.line - 1 : 0) });
  const templateText = (node) => node.quasis.map((q, i) => (q.value.cooked ?? q.value.raw) + (i < node.expressions.length ? `{${i}}` : '')).join('');
  const isLogic = (path) => {
    const p = path.parent;
    if (p.type === 'BinaryExpression' && ['===', '!==', '==', '!=', 'in'].includes(p.operator)) return true;
    if (p.type === 'SwitchCase' && p.test === path.node) return true;
    if (p.type === 'ObjectProperty' && p.key === path.node && !p.computed) return true;
    if (p.type === 'MemberExpression' && p.property === path.node && p.computed) return true;
    if (/^(ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration)$/.test(p.type)) return true;
    if (p.type === 'CallExpression' && p.callee.type === 'MemberExpression') {
      if (p.callee.object.type === 'Identifier' && p.callee.object.name === 'console') return true;
      if (LOGIC_CALLS.has(p.callee.property.name) && p.arguments[0] === path.node) return true;
    }
    return false;
  };
  traverse(ast, {
    StringLiteral(path) { if (isLogic(path)) return; for (const k of textKeys(path.node.value)) add(k, path.node); },
    TemplateLiteral(path) { if (path.parent.type === 'TaggedTemplateExpression') return; if (isLogic(path)) return; for (const k of textKeys(templateText(path.node))) add(k, path.node); },
    BinaryExpression(path) {
      if (path.node.operator !== '+') return;
      // jen vrchol řetězu: rodič není další +
      if (path.parent.type === 'BinaryExpression' && path.parent.operator === '+') return;
      const ops = []; const flat = (n) => { if (n.type === 'BinaryExpression' && n.operator === '+') { flat(n.left); flat(n.right); } else ops.push(n); };
      flat(path.node);
      const hasText = ops.some((n) => n.type === 'StringLiteral' || (n.type === 'TemplateLiteral' && n.expressions.length === 0));
      const hasExpr = ops.some((n) => !(n.type === 'StringLiteral' || n.type === 'TemplateLiteral'));
      if (!hasText || !hasExpr) return;
      let i = 0; let key = '';
      for (const n of ops) {
        if (n.type === 'StringLiteral') key += n.value;
        else if (n.type === 'TemplateLiteral') key += templateText(n).replace(/\{(\d+)\}/g, () => `{${i++}}`);
        else key += `{${i++}}`;
      }
      for (const k of textKeys(key)) add(k, path.node);
    },
  });
  return { out };
};

/** hra -> Map(klíč -> ['soubor:řádek', ...]) a seznam souborů, které se nepodařilo přečíst. */
export const extractGameKeys = (gameId) => {
  const keys = new Map(); const errors = [];
  const put = (list, rel) => { for (const { key, line } of list) { if (!keys.has(key)) keys.set(key, []); const loc = `${rel}:${line}`; if (!keys.get(key).includes(loc)) keys.get(key).push(loc); } };
  for (const file of gameFiles(gameId)) {
    const rel = path.relative(path.join(SRC_DIR, 'gameContent'), file).split(path.sep).join('/');
    const code = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.html')) {
      put(markupKeys(code), rel);
      for (const b of scriptBlocks(code)) { const r = jsKeys(b.code, b.line); put(r.out, rel); if (r.error) errors.push(`${rel}: ${r.error}`); }
    } else { const r = jsKeys(code, 1); put(r.out, rel); if (r.error) errors.push(`${rel}: ${r.error}`); }
  }
  return { keys, errors };
};

// ---- slovník hry ----
const dictFile = (gameId) => path.join(GAME_DICT_DIR, `${gameId}.js`);
export const readGameDict = async (gameId) => {
  if (!fs.existsSync(dictFile(gameId))) return {};
  return (await import(`${dictFile(gameId)}?t=${Date.now()}`)).default;
};
export const formatGameDict = (gameId, dict) => {
  const entries = Object.keys(dict).sort((a, b) => a.localeCompare(b, 'cs')).map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(dict[k])},${hasCzechDiacritics(dict[k]) ? ' // i18n-ok' : ''}`); // jméno s diakritikou v hodnotě: značka pro hlídání nepřeloženého textu
  return `// Anglický slovník hry ${gameId}: klíč je původní český text (místa {0}, {1} pro dosazené hodnoty), hodnota anglický překlad.\n// Vytváří nástroj src/i18n/tools/gamestrings.mjs, ručně se neupravuje. Slovník se stahuje až při otevření hry v angličtině.\nexport default {\n${entries.join('\n')}\n};\n`;
};
export const writeGameDict = (gameId, dict) => { fs.mkdirSync(GAME_DICT_DIR, { recursive: true }); fs.writeFileSync(dictFile(gameId), formatGameDict(gameId, dict)); };

export const missingGameKeys = async (gameId) => {
  const { keys } = extractGameKeys(gameId); const dict = await readGameDict(gameId);
  return [...keys.entries()].filter(([k]) => !(k in dict)).sort((a, b) => a[0].localeCompare(b[0], 'cs'));
};

if (process.argv[1] && process.argv[1].endsWith('gamestrings.mjs')) {
  const [cmd, game, a, b] = process.argv.slice(2);
  if (cmd === 'count') {
    for (const g of game ? [game] : Object.keys(GAMES)) { const { keys, errors } = extractGameKeys(g); const miss = await missingGameKeys(g); console.log(`${g}: ${keys.size} klíčů, chybí ${miss.length}${errors.length ? `, chyby čtení: ${errors.join('; ')}` : ''}`); }
  } else if (cmd === 'extract') {
    const miss = await missingGameKeys(game);
    fs.writeFileSync(a, miss.map(([k, locs], i) => `${i + 1}|${k}\t@${locs.slice(0, 2).join(' ')}`).join('\n') + '\n');
    console.log(`${miss.length} chybějících klíčů zapsáno do ${a}`);
  } else if (cmd === 'apply') {
    const todo = new Map(fs.readFileSync(a, 'utf8').split('\n').filter(Boolean).map((l) => { const body = l.split('\t@')[0]; const m = /^(\d+)\|(.*)$/s.exec(body); return [Number(m[1]), m[2]]; }));
    const problems = []; const add = {};
    const answered = new Set();
    for (const line of fs.readFileSync(b, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const m = /^(\d+)\|(.*)$/s.exec(line);
      if (!m) { problems.push(`špatný řádek: ${line.slice(0, 60)}`); continue; }
      const id = Number(m[1]); const cs = todo.get(id);
      if (cs === undefined) { problems.push(`neznámé číslo ${id}`); continue; }
      answered.add(id);
      const en = m[2].trim() === '=' ? cs : m[2].trim(); // = znamená: píše se stejně (název, kód, anglické slovo)
      if (!en) { problems.push(`${id}: prázdný překlad`); continue; }
      if (!placeholdersOf(en).every((p) => placeholdersOf(cs).includes(p))) problems.push(`${id}: v překladu je místo, které česky není (${placeholdersOf(cs).join(',') || '-'} x ${placeholdersOf(en).join(',') || '-'}): ${cs.slice(0, 60)}`); // anglicky smí některé místo chybět (české koncovky rodu {1})
      else if (hasCzechDiacritics(withoutNames(en)) && en !== cs) problems.push(`${id}: česká diakritika v překladu: ${en.slice(0, 60)}`);
      else add[cs] = en;
    }
    for (const id of todo.keys()) if (!answered.has(id)) problems.push(`chybí odpověď na číslo ${id}: ${todo.get(id).slice(0, 50)}`);
    if (problems.length) { console.error(problems.join('\n')); console.error(`\n${problems.length} problémů, nic se nezapsalo.`); process.exit(2); }
    const dict = { ...(await readGameDict(game)), ...add };
    writeGameDict(game, dict);
    console.log(`${game}: přidáno ${Object.keys(add).length}, celkem ${Object.keys(dict).length}.`);
  } else { console.error('použití: extract <hra> <soubor> | apply <hra> <úkoly> <odpovědi> | count [hra]'); process.exit(1); }
}
