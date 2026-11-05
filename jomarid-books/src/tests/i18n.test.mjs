// Čeština / angličtina: jádro překladů, slovník a hlídání, že v kódu nezůstane nepřeložený český text.
//   npm run test:i18n
// Seznam toho, co se ještě nepřeložilo, je src/i18n/tools/baseline.json (přegeneruje ho npm run i18n:baseline).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as core from '../i18n/core.js';
import { tx } from '../i18n/react.js';
import dict, { PARTS } from '../i18n/en/index.js';
import { listSourceFiles, scanFile, rawTexts, placeholdersOf, hasCzechDiacritics } from '../i18n/tools/scan.mjs';
import { readBaseline } from '../i18n/tools/baseline.mjs';
import { transform } from '../i18n/tools/codemod.mjs';
import { parseTodo, parseAnswers } from '../i18n/tools/apply.mjs';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

// Texty, které se v angličtině píšou stejně jako česky (název, zkratka, obecné slovo): jen tyto smějí mít překlad shodný s klíčem.
const IDENTICAL_OK = new Set(['Admin', 'Studio', 'E-mail', 'Text', 'Tip', 'Role', 'shortB', 'Menu: shortB', 'Jomarid Coins']);
// České texty, které se záměrně nepřekládají (názvy jazyků se píšou vlastním jazykem).
const PERMANENT = {
  'i18n/LanguageSwitch.jsx': ['Čeština'],              // názvy jazyků se píšou vlastním jazykem
  'constants/roles.js': ['správce', 'uživatel'],        // hodnoty rolí, jak je drží databáze
  'offline/store.js': ['Neznámé úložiště {}'],           // chyba pro vývojáře, uživatel ji neuvidí
  'pwa/sw.template.js': ['Máš nové oznámení.'],          // service worker nemá přístup k jazyku appky; běžně text oznámení posílá server
};

const makeStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, m };
};
const brokenStorage = { getItem() { throw new Error('zablokováno'); }, setItem() { throw new Error('zablokováno'); } };
const withEnglish = (fn) => async () => { core.resetForTests(); core.setDictionary({ 'Uložit': 'Save', 'Máš {n} knih': 'You have {n} books', 'kniha|knihy|knih': ['book', 'books'], '{n} kniha|{n} knihy|{n} knih': ['{n} book', '{n} books'] }); try { await fn(); } finally { core.resetForTests(); } };

// ------------------------------------------------------------------ jádro
test('jádro: česky se text nemění, anglicky se bere ze slovníku a chybějící zůstane česky', withEnglish(() => {
  assert.equal(core.t('Uložit'), 'Uložit');
  assert.equal(core.setLang('en'), true);
  assert.equal(core.t('Uložit'), 'Save');
  assert.equal(core.t('Neznámý text'), 'Neznámý text', 'nepřeložený text je vidět česky, nic nespadne');
  assert.equal(core.t('toString'), 'toString', 'klíče z prototypu objektu se nebérou');
  assert.equal(core.t('constructor'), 'constructor');
  core.setLang('cs');
  assert.equal(core.t('Uložit'), 'Uložit');
}));

test('jádro: parametry se dosazují, neznámé zůstanou vidět a dosazený text se znovu neprohlíží', withEnglish(() => {
  assert.equal(core.interpolate('Máš {n} knih', { n: 0 }), 'Máš 0 knih', 'nula je platná hodnota');
  assert.equal(core.interpolate('{a} a {b}', { a: 'X' }), 'X a {b}', 'chybějící parametr zůstane, ať je chyba vidět');
  assert.equal(core.interpolate('{a}', { a: '{b}', b: 'Y' }), '{b}', 'dosazený text se znovu nezpracovává');
  assert.equal(core.interpolate('{a}', { a: null }), '{a}');
  assert.equal(core.interpolate('{a}', { a: undefined }), '{a}');
  assert.equal(core.interpolate('bez parametrů', undefined), 'bez parametrů');
  assert.equal(core.interpolate('{__proto__} {toString}', { }), '{__proto__} {toString}', 'z prototypu se nic nebere');
  core.setLang('en');
  assert.equal(core.t('Máš {n} knih', { n: 3 }), 'You have 3 books');
}));

test('jádro: tvary podle počtu, česky 1 / 2-4 / 5 a víc, anglicky jednotné nebo množné', withEnglish(() => {
  const cs = (n) => core.t.p(n, 'kniha', 'knihy', 'knih');
  assert.deepEqual([0, 1, 2, 4, 5, 11, 12, 21, 22, 100, 101, 102].map(cs), ['knih', 'kniha', 'knihy', 'knihy', 'knih', 'knih', 'knih', 'knih', 'knihy', 'knih', 'knih', 'knihy']);
  core.setLang('en');
  const en = (n) => core.t.p(n, 'kniha', 'knihy', 'knih');
  assert.deepEqual([0, 1, 2, 5, 21].map(en), ['books', 'book', 'books', 'books', 'books']);
  assert.equal(core.t.p(1, '{n} kniha', '{n} knihy', '{n} knih', { n: 1 }), '1 book');
  assert.equal(core.t.p(7, '{n} kniha', '{n} knihy', '{n} knih', { n: 7 }), '7 books');
  assert.equal(core.t.p(-1, 'kniha', 'knihy', 'knih'), 'book', 'záporná jednička je taky jednotné číslo');
  assert.equal(core.t.p('x', 'kniha', 'knihy', 'knih'), 'books', 'nečíselný počet se bere jako nula');
  assert.equal(core.t.p(3, 'nezname', 'neznama', 'nezna'), 'neznama', 'bez záznamu zůstane české skloňování');
}));

test('jádro: uložený jazyk se čte i zapisuje bezpečně a cokoli jiného než en je čeština', () => {
  assert.equal(core.normalizeLang('en'), 'en');
  for (const v of ['cs', 'EN', 'de', '', null, undefined, 5, {}]) assert.equal(core.normalizeLang(v), 'cs');
  assert.equal(core.readStoredLang(makeStorage({ [core.LANG_KEY]: 'en' })), 'en');
  assert.equal(core.readStoredLang(makeStorage({ [core.LANG_KEY]: 'xx' })), 'cs');
  assert.equal(core.readStoredLang(makeStorage()), 'cs');
  assert.equal(core.readStoredLang(brokenStorage), 'cs', 'zablokované úložiště nic neshodí');
  assert.equal(core.storeLang('en', brokenStorage), false);
  const st = makeStorage(); assert.equal(core.storeLang('en', st), true); assert.equal(st.m.get(core.LANG_KEY), 'en');
  assert.equal(core.LANG_KEY, 'jomarid-lang');
});

test('jádro: bez slovníku se na angličtinu nepřepne, s ním ano, posluchači se zavolají a <html lang> se nastaví', withEnglish(() => {
  core.resetForTests();
  const doc = { documentElement: { lang: '' } };
  globalThis.document = doc;
  try {
    let calls = 0; const off = core.subscribe(() => { calls += 1; });
    assert.equal(core.setLang('en'), false, 'bez slovníku zůstává čeština');
    assert.equal(core.getLang(), 'cs');
    core.setDictionary({ 'a': 'b' });
    assert.equal(core.setLang('en'), true);
    assert.equal(core.getLang(), 'en'); assert.equal(doc.documentElement.lang, 'en'); assert.equal(calls, 1);
    assert.equal(core.setLang('en'), false, 'stejný jazyk nic nehlásí'); assert.equal(calls, 1);
    assert.equal(core.setLang('cs'), true); assert.equal(doc.documentElement.lang, 'cs'); assert.equal(calls, 2);
    off(); core.setLang('en'); assert.equal(calls, 2, 'odhlášený posluchač se nevolá');
    // posluchač, který vyhodí chybu, ostatní nezastaví
    core.subscribe(() => { throw new Error('chyba'); }); let ok = 0; core.subscribe(() => { ok += 1; }); core.setLang('cs'); assert.equal(ok, 1);
  } finally { delete globalThis.document; }
}));

test('jádro: switchLang stáhne skutečný anglický slovník, uloží volbu a ohlásí změnu nastavení; initLang ji při startu obnoví', async () => {
  core.resetForTests();
  const st = makeStorage();
  assert.equal(await core.switchLang('en', st), true);
  assert.equal(core.getLang(), 'en'); assert.equal(st.m.get(core.LANG_KEY), 'en');
  assert.equal(core.t('Uložit jméno'), 'Save name', 'slovník je opravdu načtený');
  assert.equal(await core.switchLang('cs', st), true);
  assert.equal(core.getLang(), 'cs'); assert.equal(st.m.get(core.LANG_KEY), 'cs');
  // start s uloženou angličtinou
  core.resetForTests();
  assert.equal(await core.initLang(makeStorage({ [core.LANG_KEY]: 'en' })), 'en');
  assert.equal(core.t('Odhlásit se'), 'Log out');
  core.resetForTests();
  assert.equal(await core.initLang(makeStorage({ [core.LANG_KEY]: 'blbost' })), 'cs');
  assert.equal(await core.initLang(brokenStorage), 'cs');
  core.resetForTests();
});

test('jádro: formátování čísel a dat podle jazyka', withEnglish(() => {
  const cs = core.formatNumber(1234567.5);
  core.setLang('en');
  const en = core.formatNumber(1234567.5);
  assert.notEqual(cs, en);
  assert.equal(en, '1,234,567.5');
  assert.match(cs, /^1\s234\s567,5$/);
  assert.equal(core.formatNumber(null), '0'); assert.equal(core.formatNumber(undefined), '0');
  assert.equal(core.getLocale(), 'en-GB');
  assert.match(core.formatDate('2026-03-04T12:00:00Z', { timeZone: 'UTC' }), /^04\/03\/2026$/);
  core.setLang('cs');
  assert.equal(core.getLocale(), 'cs-CZ');
  assert.match(core.formatDate('2026-03-04T12:00:00Z', { timeZone: 'UTC' }), /^4\.\s?3\.\s?2026$/);
}));

test('tx: parametry smí být prvky Reactu a pořadí určuje překlad, ne kód', withEnglish(() => {
  core.setDictionary({ 'Klepni na {a} v liště {b}.': 'Tap {a} in the toolbar {b}.' });
  const html = () => renderToStaticMarkup(createElement(Fragment, null, ...tx('Klepni na {a} v liště {b}.', { a: createElement('b', null, 'Sdílet'), b: 'tady' })));
  assert.equal(html(), 'Klepni na <b>Sdílet</b> v liště tady.');
  core.setLang('en');
  assert.equal(html(), 'Tap <b>Sdílet</b> in the toolbar tady.');
  assert.equal(renderToStaticMarkup(createElement(Fragment, null, ...tx('Chybí {x}.', {}))), 'Chybí {x}.', 'neznámý parametr zůstane vidět');
}));

// ------------------------------------------------------------------ slovník
const allEntries = Object.entries(dict);

test('slovník: každý záznam má neprázdný překlad a stejné {parametry} jako český klíč', () => {
  assert.ok(allEntries.length > 300);
  for (const [key, value] of allEntries) {
    if (Array.isArray(value)) {
      const forms = key.split('|');
      assert.equal(forms.length, 3, `plurál musí mít klíč jedna|dvě|pět: ${key}`);
      assert.equal(value.length, 2, key);
      const want = [...new Set(forms.flatMap(placeholdersOf))].sort().join(',');
      for (const v of value) { assert.ok(typeof v === 'string' && v.trim(), key); assert.equal(placeholdersOf(v).join(','), want, `parametry plurálu: ${key}`); }
    } else {
      assert.ok(typeof value === 'string' && value.trim() !== '', `prázdný překlad: ${key}`);
      assert.equal(placeholdersOf(value).join(','), placeholdersOf(key).join(','), `parametry se liší: ${key}`);
      assert.equal(value, value.trim(), `mezera na kraji překladu: ${key}`);
    }
  }
});

test('slovník: překlad neobsahuje českou diakritiku a shodný s klíčem je jen to, co se píše stejně', () => {
  for (const [key, value] of allEntries) {
    for (const v of Array.isArray(value) ? value : [value]) {
      assert.ok(!hasCzechDiacritics(v), `česká diakritika v překladu: ${key} -> ${v}`);
      if (!Array.isArray(value) && v === key) assert.ok(IDENTICAL_OK.has(key), `překlad je stejný jako klíč (zapomenutý překlad?): ${key}`);
    }
  }
});

test('slovník: stejný český text nemá v různých oblastech různé překlady', () => {
  const seen = new Map();
  for (const [area, entries] of Object.entries(PARTS)) {
    for (const [key, value] of Object.entries(entries)) {
      const j = JSON.stringify(value);
      if (seen.has(key)) assert.equal(seen.get(key).v, j, `${key}: ${seen.get(key).area} x ${area}`);
      else seen.set(key, { v: j, area });
    }
  }
});

// ------------------------------------------------------------------ kód
const files = listSourceFiles();
const scans = new Map(files.map((f) => [f, scanFile(f)]));

test('kód: každý text v t(), tx(), tk() a t.p() má anglický záznam a ve slovníku není nic nepoužitého', () => {
  const used = new Set();
  const missing = [];
  for (const [f, sc] of scans) for (const k of sc.keys) { used.add(k.key); if (!Object.prototype.hasOwnProperty.call(dict, k.key)) missing.push(`${f}:${k.line} ${k.key.slice(0, 70)}`); }
  assert.deepEqual(missing, [], 'chybí překlad (npm run i18n:extract ukáže seznam)');
  const unused = Object.keys(dict).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], 'nepoužité klíče ve slovníku (po úpravě českého textu zůstal starý klíč?)');
});

test('kód: t se nikdy nevolá na úrovni modulu, vždy je importované a nikde ho nepřekrývá jiná proměnná', () => {
  const bad = [];
  for (const [f, sc] of scans) for (const p of sc.problems) bad.push(`${f}:${p.line} ${p.kind}`);
  assert.deepEqual(bad, []);
});

test('kód: konstanty s texty označenými tk() se při použití vždy překládají přes t()', () => {
  const bad = [];
  for (const [f, sc] of scans) for (const u of sc.tkUses) bad.push(`${f}:${u.line} ${u.name}`);
  assert.deepEqual(bad, [], 'tk konstanta se vypisuje bez t(...); pokud ji přeloží přijímající komponenta, přidej na řádek poznámku i18n-ok');
});

test('kód: v nic nepřibyl nepřeložený český text (seznam src/i18n/tools/baseline.json je přesný)', () => {
  const baseline = readBaseline();
  const problems = [];
  for (const f of files) {
    const now = rawTexts(scans.get(f));
    const was = baseline[f] || [];
    const added = now.filter((x) => !was.includes(x));
    const gone = was.filter((x) => !now.includes(x));
    for (const a of added) problems.push(`${f}: přibyl nepřeložený text: ${a.slice(0, 80)}`);
    for (const g of gone) problems.push(`${f}: už je přeložený, odeber ze seznamu (npm run i18n:baseline): ${g.slice(0, 80)}`);
  }
  for (const f of Object.keys(baseline)) if (!files.includes(f)) problems.push(`${f}: soubor už neexistuje, odeber ze seznamu`);
  assert.deepEqual(problems, []);
});

test('kód: soubory, které už jsou přeložené, nepoužívají pevné české formátování data a čísel', () => {
  const baseline = readBaseline();
  const bad = [];
  for (const f of files) {
    if (baseline[f] || f.startsWith('i18n/')) continue;
    const code = read(f);
    if (!/from '(\.\.?\/)+i18n/.test(code)) continue;
    if (/['"]cs-CZ['"]/.test(code)) bad.push(f);
  }
  assert.deepEqual(bad, [], 'místo toLocaleString(\'cs-CZ\') patří formatNumber / formatDate / formatDateTime z i18n');
});

test('kód: překlad je hotový tam, kde má být (ukazatel postupu, ne podmínka průchodu)', { todo: 'dokud se nepřeloží zbytek appky' }, () => {
  const baseline = readBaseline();
  const left = [];
  for (const [f, texts] of Object.entries(baseline)) { const rest = texts.filter((x) => !(PERMANENT[f] || []).includes(x)); if (rest.length) left.push(`${f}: ${rest.length}`); }
  assert.deepEqual(left, []);
});

// ------------------------------------------------------------------ zapojení
test('zapojení: appka čeká na jazyk před prvním vykreslením, obsah se při přepnutí vykreslí znovu a přepínač je v liště i v Nastavení', () => {
  const entry = read('index.jsx');
  assert.match(entry, /initLang\(\)\.finally\(\(\) => \{\s*ReactDOM\.createRoot\(document\.getElementById\('root'\)\)\.render\(<App \/>\)/);
  const app = read('App.jsx');
  assert.match(app, /const \{ lang \} = useLang\(\);/);
  assert.match(app, /<div key=\{lang\} /);
  assert.match(read('components', 'Navbar.jsx'), /<LanguageSwitch \/>/);
  assert.match(read('components', 'SettingsModal.jsx'), /<LanguageSwitch variant="settings" \/>/);
  const sw = read('i18n', 'LanguageSwitch.jsx');
  assert.match(sw, /aria-pressed=\{active\}/);
  assert.match(sw, /lang=\{o\.key\}/, 'každé tlačítko je ve svém jazyce');
  assert.match(sw, /<span className="sr-only">\{`\$\{o\.name\} \(\$\{o\.code\}\)`\}<\/span>/, 'název tlačítka obsahuje viditelný text (CZ, EN)');
  assert.ok(read('settings', 'settingsSync.js').includes('LANG_KEY'), 'jazyk se synchronizuje s účtem');
});

test('zapojení: slovník se stahuje až při použití angličtiny (nezvětšuje start české appky)', () => {
  const core = read('i18n', 'core.js');
  assert.match(core, /import\('\.\/en\/index\.js'\)/);
  for (const f of files) { if (f.startsWith('i18n/') || f === 'index.jsx') continue; assert.ok(!/from '[^']*i18n\/en\//.test(read(f)), `${f} importuje slovník napřímo`); }
});

// ------------------------------------------------------------------ nástroje
test('nástroje: převodník obalí text i atributy, množná čísla převede na t.p a nechá věty s výrazy na ruční práci', () => {
  const code = "import { plural } from '../lib/plural';\nconst A = ({ n }) => (<div title=\"Ahoj světe\"><p>Tohle je text</p><p>Máš {n} knih</p><span>{plural(n, 'kniha', 'knihy', 'knih')}</span><b translate=\"no\">Jomarid</b></div>);\n";
  const r = transform(code, 'components/A.jsx', { strings: true });
  assert.match(r.code, /^import \{ t \} from '\.\.\/i18n';/);
  assert.ok(!r.code.includes("from '../lib/plural'"), 'nepoužitý import plural je pryč');
  assert.match(r.code, /title=\{t\('Ahoj světe'\)\}/);
  assert.match(r.code, /<p>\{t\('Tohle je text'\)\}<\/p>/);
  assert.match(r.code, /\{t\.p\(n, 'kniha', 'knihy', 'knih'\)\}/);
  assert.ok(r.report.some((x) => /vedle výrazu/.test(x)), 'věta s výrazem se hlásí k ruční práci');
  const again = transform(r.code, 'components/A.jsx', { strings: true });
  assert.equal(again.code.includes("t(t("), false, 'opakované spuštění nic nezdvojí');
});

test('nástroje: odpovědi na úkoly se spárují podle čísla a hlídají parametry a diakritiku', () => {
  const todo = parseTodo('1|Máš {n} knih\t@a.jsx:1\n2|PLURAL|kniha|knihy|knih\t@a.jsx:2\n3|Uložit\t@a.jsx:3\n');
  const ok = parseAnswers('1|You have {n} books\n2|book|books\n3|Save\n', todo);
  assert.deepEqual(ok.problems, []); assert.deepEqual(ok.out, { 'Máš {n} knih': 'You have {n} books', 'kniha|knihy|knih': ['book', 'books'], 'Uložit': 'Save' });
  const bad = parseAnswers('1|You have books\n2|book\n3|Uložit\n4|x\n', todo);
  assert.ok(bad.problems.some((p) => /parametry/.test(p)) && bad.problems.some((p) => /plurál/.test(p)) && bad.problems.some((p) => /diakritika/.test(p)) && bad.problems.some((p) => /neznámé číslo 4/.test(p)));
  assert.ok(parseAnswers('1|a {n}\n', todo).problems.some((p) => /chybí odpověď/.test(p)));
});
