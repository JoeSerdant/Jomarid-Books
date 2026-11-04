// Bezpečnostní zpevnění (db/security-hardening.sql + kód + hlavičky): hlídá, že appka a zpevněná databáze zůstávají ve shodě.
// Samotné chování SQL ověřují SQL testy (npm run test:sql, db/tests/security_hardening.test.sql). Tady se kontroluje, že kód appky
// nesahá na nic, co zpevnění zavírá: proti jejich vlastním seznamům v SQL, takže nové políčko v kódu bez úpravy SQL test shodí.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SQL = read('db/security-hardening.sql');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'tests' || e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
const SRC_FILES = walk(path.join(ROOT, 'src')).filter((f) => /\.(js|jsx)$/.test(f));
const rel = (f) => path.relative(ROOT, f).replaceAll('\\', '/');
const quoted = (text) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const keysOf = (obj) => [...obj.matchAll(/(?:^|[{,\s])([a-z_]+)\s*:/g)].map((m) => m[1]);

test('npm test pouští i bezpečnostní testy', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:security'], 'node --test src/tests/securityHardening.test.mjs');
  assert.ok(pkg.scripts.test.includes('npm run test:security'));
});

/* ---------------------------------------------------------------- hlavičky */
test('vercel.json: bezpečnostní hlavičky pro všechny odpovědi, pravidla pro sw.js a manifest zůstala', () => {
  const cfg = JSON.parse(read('vercel.json'));
  const all = cfg.headers.find((h) => h.source === '/(.*)');
  assert.ok(all, 'pravidlo pro všechny cesty');
  const val = (k) => all.headers.find((h) => h.key === k)?.value;
  assert.equal(val('X-Content-Type-Options'), 'nosniff');
  assert.equal(val('X-Frame-Options'), 'SAMEORIGIN', 'hry běží v iframe ze stejného původu, cizí web appku zarámovat nesmí');
  assert.match(val('Referrer-Policy'), /strict-origin/);
  assert.match(val('Strict-Transport-Security'), /max-age=\d{7,}/);
  const csp = val('Content-Security-Policy');
  for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"]) assert.ok(csp.includes(d), d);
  assert.doesNotMatch(csp, /default-src|script-src/, 'bez omezení skriptů: hry v iframe srcDoc a téma v index.html mají vložené skripty');
  const pp = val('Permissions-Policy');
  for (const f of ['camera', 'microphone', 'geolocation', 'payment']) assert.match(pp, new RegExp(`${f}=\\(\\)`), `${f} je zakázané`);
  for (const f of ['fullscreen', 'clipboard-write', 'wake-lock', 'vibrate']) assert.ok(!pp.includes(f), `${f} appka a hry používají, nesmí se zakázat`);
  const sw = cfg.headers.find((h) => h.source === '/sw.js');
  assert.ok(sw && sw.headers.some((h) => h.key === 'Service-Worker-Allowed'), 'service worker má své hlavičky');
  assert.ok(cfg.headers.findIndex((h) => h.source === '/(.*)') < cfg.headers.findIndex((h) => h.source === '/sw.js'), 'obecné pravidlo je první, konkrétní ho případně přepíše');
  assert.equal(cfg.rewrites.length, 1, 'přesměrování na index.html beze změny');
});

/* ---------------------------------------------------------------- SQL: tvar skriptu */
test('security-hardening.sql: jde spustit víckrát a nemaže (Supabase by ukázal varování před destruktivním příkazem)', () => {
  const code = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /\bdrop\s+(table|policy|schema|function|trigger|index|view|role)\b/i, 'žádné drop');
  assert.doesNotMatch(code, /\btruncate\s+(table\s+)?[a-z_.]+\s*;/i, 'žádný truncate');
  assert.doesNotMatch(code, /\bdelete\s+from\s+(?!_hard_log\s+where true)/i, 'delete jen z vlastního dočasného výpisu');
  assert.match(code, /create or replace trigger/i, 'spouště se zakládají přes create or replace');
  assert.match(code, /alter policy/i, 'politiky se mění na místě');
  assert.ok(code.trimEnd().endsWith('order by case stav when \'SELHALO\' then 0 when \'CHYBA\' then 1 when \'UPOZORNĚNÍ\' then 2 when \'ZMĚNA\' then 3 else 4 end, n;'), 'poslední příkaz vrací výsledkovou tabulku (editor ukáže jen ten)');
  assert.match(SQL, /db\/security-hardening-undo\.sql/, 'hlavička odkazuje na návrat zpět');
});

test('security-hardening.sql: jen dvě funkce zůstávají volatelné bez přihlášení a nejsou mezi nimi funkce, které appka volá až po přihlášení', () => {
  const pub = quoted(SQL.match(/v_pub\s+constant text\[\] := array\[([^\]]*)\]/)[1]);
  assert.deepEqual(pub.sort(), ['request_password_help', 'username_available_public']);
  const preLogin = new Set();
  for (const f of SRC_FILES.filter((x) => /LoginPage|RegisterPage|SignUp|ForgotPassword/i.test(x))) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\.rpc\('([a-z_]+)'/g)) preLogin.add(m[1]);
  assert.ok(preLogin.size > 0, 'přihlašovací stránka nějaké funkce volá');
  // Přihlašovací stránka volá i funkce, které běží až po přihlášení (nucená změna dočasného hesla). Každá další funkce tu musí být buď veřejná, nebo výslovně zapsaná sem.
  const AFTER_LOGIN = new Set(['clear_must_change_password']);
  for (const fn of preLogin) assert.ok(pub.includes(fn) || AFTER_LOGIN.has(fn), `${fn} volá přihlašovací stránka: buď musí zůstat veřejná (v_pub v SQL), nebo se přidá do AFTER_LOGIN`);
  for (const fn of pub) assert.ok(preLogin.has(fn), `${fn} je veřejná, ale přihlašovací stránka ji nevolá: je potřeba ještě?`);
  const none = quoted(SQL.match(/v_none\s+constant text\[\] := array\[([^\]]*)\]/)[1]);
  const used = new Set(SRC_FILES.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1])));
  for (const fn of none) assert.ok(!used.has(fn), `${fn} se zavírá všem klientům, appka ji nesmí volat`);
});

test('security-hardening.sql: anon smí číst jen books a site_settings, a appka před přihlášením nečte nic jiného', () => {
  const anon = quoted(SQL.match(/v_anon_read constant text\[\] := array\[([^\]]*)\]/)[1]);
  assert.deepEqual(anon.sort(), ['books', 'site_settings']);
  for (const f of SRC_FILES.filter((x) => /LoginPage|RegisterPage|SignUp|ForgotPassword/i.test(x))) {
    const tables = [...fs.readFileSync(f, 'utf8').matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]);
    for (const t of tables) assert.ok(anon.includes(t), `${rel(f)} čte ${t} bez přihlášení`);
  }
});

/* ---------------------------------------------------------------- appka vs. omezení sloupců */
test('profil: appka zakládá profil jen se sloupci, na které zpevnění dává právo INSERT', () => {
  const auth = read('src/contexts/AuthContext.jsx');
  const ins = auth.match(/from\('profiles'\)\s*\.insert\(\[\{([^}]*)\}\]\)/);
  assert.ok(ins, 'AuthContext zakládá profil');
  const sqlCols = quoted(SQL.match(/attname in \(([^)]*)\)/)[1]);
  assert.deepEqual(keysOf(ins[1]).sort(), sqlCols.sort(), 'sloupce v kódu a v GRANT INSERT jsou stejné (přidáš-li sloupec do kódu, přidej ho i do SQL)');
});

test('profil: přímé změny profilu z appky se netýkají sloupců, které zpevnění čtenáři zakazuje (správce smí fake_xp a streak_freezes)', () => {
  const protectedCols = quoted(SQL.match(/v_prot constant text\[\] :=\s*array\[([^\]]*)\]/)[1]);
  assert.ok(protectedCols.includes('highest_goal_ever') && protectedCols.includes('coins') && protectedCols.includes('role'));
  let checked = 0;
  for (const f of SRC_FILES) {
    const code = fs.readFileSync(f, 'utf8');
    const isAdmin = rel(f) === 'src/pages/AdminDashboard.jsx';
    const payloads = [...code.matchAll(/from\('profiles'\)[\s\S]{0,200}?\.update\(\s*\{([^}]*)\}/g)].map((m) => m[1]);
    if (rel(f) === 'src/components/SettingsModal.jsx') payloads.push(...[...code.matchAll(/\bsave\(\{([^}]*)\}/g)].map((m) => m[1]));
    for (const p of payloads) {
      checked++;
      for (const k of keysOf(p)) if (!isAdmin) assert.ok(!protectedCols.includes(k), `${rel(f)} mění profiles.${k}, což je pro čtenáře zakázané`);
    }
  }
  assert.ok(checked >= 5, `zkontrolováno ${checked} přímých změn profilu`);
});

test('user_books: čtenářská část appky nemění status, user_id, book_id ani first_completed_at (kromě prvního uložení se statusem active)', () => {
  const banned = ['status', 'user_id', 'book_id', 'first_completed_at'];
  let writes = 0;
  for (const f of SRC_FILES) {
    if (rel(f) === 'src/pages/AdminDashboard.jsx') continue;   // správce smí všechno (spoušť ho propustí)
    const code = fs.readFileSync(f, 'utf8');
    for (const m of code.matchAll(/from\('user_books'\)[\s\S]{0,200}?\.(update|upsert)\(\s*(\{[^}]*\})/g)) {
      writes++;
      for (const k of keysOf(m[2])) if (m[1] === 'update') assert.ok(!banned.includes(k), `${rel(f)}: update user_books mění ${k}`);
    }
    for (const m of code.matchAll(/from\('user_books'\)[\s\S]{0,200}?\.insert\(\[\{([^}]*)\}\]\)/g)) {
      writes++;
      assert.ok(!keysOf(m[1]).includes('first_completed_at'), `${rel(f)}: insert user_books nastavuje first_completed_at`);
      for (const s of m[1].matchAll(/status:\s*'([a-z_]+)'/g)) assert.equal(s[1], 'active');
    }
  }
  assert.ok(writes >= 2, `zkontrolováno ${writes} zápisů`);
  const rb = read('src/offline/readerBackend.js');
  assert.match(rb, /if \(needsStatus\) payload\.status = 'active'/, 'status se posílá jen při prvním uložení a jen jako active (stejný stav spoušť nepovažuje za změnu)');
});

/* ---------------------------------------------------------------- soukromí žebříčku */
test('žebříček: cizí řádky user_books a user_daily_activity se čtou jen přes funkce serveru (a po staru jen když funkce v databázi chybí)', () => {
  const code = read('src/stats/loadStats.js');
  assert.match(code, /rpc\('leaderboard_reads'/);
  assert.match(code, /rpc\('leaderboard_activity'/);
  const direct = [...code.matchAll(/client\.from\('(user_books|user_daily_activity)'\)([\s\S]{0,160})/g)];
  for (const m of direct) {
    const own = /\.eq\('user_id', user\.id\)/.test(m[2]);
    const fallback = /fetchAllRows\(\(\) => $/.test(code.slice(Math.max(0, m.index - 40), m.index));
    assert.ok(own || fallback, `čtení ${m[1]} bez filtru na vlastní řádky mimo záložní cestu: ${m[2].slice(0, 80)}`);
  }
  for (const f of SRC_FILES.filter((x) => rel(x) !== 'src/stats/loadStats.js')) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/from\('user_daily_activity'\)([\s\S]{0,160})/g)) {
      assert.match(m[1], /\.eq\('user_id'/, `${rel(f)} čte user_daily_activity bez filtru na vlastní řádky`);
    }
  }
  assert.match(SQL, /alter policy %I on public\.%I using/, 'politiky se zužují');
  for (const t of ['user_books_select', 'user_daily_activity_select', 'book_ratings_select']) assert.match(SQL, new RegExp(`'${t}'`));
});

test('hodnocení knih: appka čte cizí hodnocení jen přes průměr v tabulce books (zpevnění je skrývá)', () => {
  for (const f of SRC_FILES) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/from\('book_ratings'\)\s*\.select\([^)]*\)([\s\S]{0,60})/g)) assert.match(m[1], /\.eq\('user_id'/, `${rel(f)} čte hodnocení bez filtru na vlastní řádky`);
  }
});

/* ---------------------------------------------------------------- dokumentace a návrat zpět */
test('README popisuje zpevnění a návrat zpět', () => {
  const readme = read('db/README.md');
  for (const re of [/security-hardening\.sql/, /security-hardening-undo\.sql/, /security-diagnostics\.sql/]) assert.match(readme, re);
  assert.ok(fs.existsSync(path.join(ROOT, 'db/security-hardening-undo.sql')));
});
