// Testy změny e-mailu přes správce: node --test src/tests/emailChange.test.mjs
// (a) čisté funkce z src/emailChange.js, (b) texty chyb, (c) statická shoda mezi SQL (db/email-change.sql) a klientem:
// kódy chyb, názvy druhů oznámení a volání funkcí v Nastavení, administraci a AuthContextu. Databáze se tu nespouští (to dělá db/tests/run.sh).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMAIL_RE, EMAIL_MAX, normalizeEmail, sameEmail, isValidEmail,
  EMAIL_REQUEST_KIND, EMAIL_CHANGED_KIND, EMAIL_REJECTED_KIND,
  REQUEST_ERRORS, ADMIN_EMAIL_ERRORS, explainEmailError,
} from '../emailChange.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Zdroják bez komentářů (// a /* */), aby se nehledalo v poznámkách. Dvojtečka před // chrání adresy typu https://.
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const stripSqlComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

describe('čisté funkce', () => {
  test('normalizeEmail: ořízne mezery a sjednotí velikost písmen', () => {
    assert.equal(normalizeEmail('  Jan.Novak@Example.CZ '), 'jan.novak@example.cz');
    assert.equal(normalizeEmail('\t a@b.cz \n'), 'a@b.cz');
  });

  test('normalizeEmail: null a undefined dají prázdný řetězec', () => {
    assert.equal(normalizeEmail(null), '');
    assert.equal(normalizeEmail(undefined), '');
    assert.equal(normalizeEmail(''), '');
  });

  test('sameEmail: bez ohledu na mezery a velikost písmen', () => {
    assert.equal(sameEmail('A@b.cz', ' a@B.cz '), true);
    assert.equal(sameEmail('a@b.cz', 'a@b.com'), false);
    assert.equal(sameEmail('a@b.cz', null), false);
  });

  test('sameEmail: dvě chybějící hodnoty jsou stejné (obě prázdné)', () => {
    assert.equal(sameEmail(null, undefined), true);
    assert.equal(sameEmail('', null), true);
  });

  test('isValidEmail: platné adresy', () => {
    for (const ok of ['a@b.cz', ' A@B.CZ ', 'jan.novak+knihy@sub.example.com', 'a@b.c']) assert.equal(isValidEmail(ok), true, ok);
  });

  test('isValidEmail: neplatné adresy', () => {
    for (const bad of ['', '   ', 'abc', 'a@b', 'a@.', '@b.cz', 'a@', 'a b@c.cz', 'a@b c.cz', 'a@@b.cz', null, undefined]) {
      assert.equal(isValidEmail(bad), false, String(bad));
    }
  });

  test('isValidEmail: délka 254 projde, 255 ne', () => {
    const make = (len) => `${'a'.repeat(len - '@b.cz'.length)}@b.cz`;
    assert.equal(make(254).length, 254);
    assert.equal(EMAIL_MAX, 254);
    assert.equal(isValidEmail(make(254)), true);
    assert.equal(isValidEmail(make(255)), false);
  });

  test('isValidEmail: mezery na krajích se do délky nepočítají', () => {
    const make = (len) => `${'a'.repeat(len - '@b.cz'.length)}@b.cz`;
    assert.equal(isValidEmail(`  ${make(254)}  `), true);
  });

  test('EMAIL_RE nemění stav mezi voláními (bez příznaku g)', () => {
    assert.equal(EMAIL_RE.global, false);
    assert.equal(EMAIL_RE.test('a@b.cz'), true);
    assert.equal(EMAIL_RE.test('a@b.cz'), true);
  });

  test('explainEmailError: Error, řetězec, neznámý kód, null', () => {
    const fb = 'Náhradní text.';
    assert.equal(explainEmailError(new Error('same_email'), REQUEST_ERRORS, fb), REQUEST_ERRORS.same_email);
    assert.equal(explainEmailError({ message: 'P0001: request_already_open' }, REQUEST_ERRORS, fb), REQUEST_ERRORS.request_already_open);
    assert.equal(explainEmailError('too_many_requests', REQUEST_ERRORS, fb), REQUEST_ERRORS.too_many_requests);
    assert.equal(explainEmailError(new Error('email_taken'), ADMIN_EMAIL_ERRORS, fb), ADMIN_EMAIL_ERRORS.email_taken);
    assert.equal(explainEmailError(new Error('neco_jineho'), REQUEST_ERRORS, fb), fb);
    assert.equal(explainEmailError(new Error('email_taken'), REQUEST_ERRORS, fb), fb);
    assert.equal(explainEmailError(null, REQUEST_ERRORS, fb), fb);
    assert.equal(explainEmailError(undefined, REQUEST_ERRORS, fb), fb);
    assert.equal(explainEmailError({}, REQUEST_ERRORS, fb), fb);
  });

  test('druhy oznámení mají očekávané názvy', () => {
    assert.equal(EMAIL_REQUEST_KIND, 'email_change_request');
    assert.equal(EMAIL_CHANGED_KIND, 'email_changed');
    assert.equal(EMAIL_REJECTED_KIND, 'email_change_rejected');
  });
});

const EXISTING_ADMIN_CODES = ['user_not_found', 'notification_not_found', 'already_handled', 'forbidden'];

describe('texty chyb', () => {
  for (const [name, table] of [['REQUEST_ERRORS', REQUEST_ERRORS], ['ADMIN_EMAIL_ERRORS', ADMIN_EMAIL_ERRORS]]) {
    test(`${name}: neprázdné české věty bez tvarů „-l/a“`, () => {
      assert.ok(Object.keys(table).length > 0);
      for (const [code, text] of Object.entries(table)) {
        assert.equal(typeof text, 'string', code);
        assert.ok(text.trim().length > 0, code);
        assert.match(text, /[áčďéěíňóřšťúůýž]/i, `${code}: chybí česká diakritika`);
        assert.match(text, /[.!]$/, `${code}: věta nekončí tečkou`);
        assert.doesNotMatch(text, /\wl\/a\b|\wla?\(a\)|\wl\(a\)/, `${code}: rodový tvar`);
      }
    });
  }

  test('žádný kód není podřetězcem jiného (hledá se podle obsahu zprávy)', () => {
    const codes = [...new Set([...Object.keys(REQUEST_ERRORS), ...Object.keys(ADMIN_EMAIL_ERRORS), ...EXISTING_ADMIN_CODES])];
    for (const a of codes) {
      for (const b of codes) {
        if (a !== b) assert.ok(!b.includes(a), `${a} je podřetězcem ${b}`);
      }
    }
  });
});

describe('shoda SQL a klienta', () => {
  const sql = stripSqlComments(read('db/email-change.sql'));

  // Tělo každé funkce: od "create or replace function public.<jméno>" do další takové (nebo do konce souboru).
  const bodies = {};
  const starts = [...sql.matchAll(/create or replace function public\.(\w+)/gi)];
  starts.forEach((m, i) => {
    bodies[m[1]] = sql.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : sql.length);
  });
  const codesOf = (fn) => [...new Set([...bodies[fn].matchAll(/raise exception '(\w+)'/g)].map((m) => m[1]))];

  test('SQL obsahuje všech pět funkcí', () => {
    for (const fn of ['request_email_change', 'my_email_change_request', 'cancel_my_email_change_request', 'admin_change_email', 'admin_reject_email_change']) {
      assert.ok(bodies[fn], fn);
    }
  });

  test('kódy chyb žádosti čtenáře jsou v REQUEST_ERRORS', () => {
    for (const fn of ['request_email_change', 'my_email_change_request', 'cancel_my_email_change_request']) {
      for (const code of codesOf(fn)) assert.ok(code in REQUEST_ERRORS, `${fn}: ${code}`);
    }
    // a naopak: každý text v REQUEST_ERRORS má v SQL zdroj
    const used = new Set(['request_email_change', 'my_email_change_request', 'cancel_my_email_change_request'].flatMap(codesOf));
    for (const code of Object.keys(REQUEST_ERRORS)) assert.ok(used.has(code), `${code} se v SQL nevyhazuje`);
  });

  test('kódy chyb správce jsou v ADMIN_EMAIL_ERRORS nebo v ADMIN_ERRORS administrace', () => {
    const adminText = stripJsComments(read('src/pages/AdminDashboard.jsx'));
    const block = adminText.match(/const ADMIN_ERRORS = \{([\s\S]*?)\n\};/);
    assert.ok(block, 'v AdminDashboard.jsx chybí ADMIN_ERRORS');
    const adminCodes = new Set([...block[1].matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]));
    for (const code of EXISTING_ADMIN_CODES) assert.ok(adminCodes.has(code), `ADMIN_ERRORS nemá ${code}`);
    for (const fn of ['admin_change_email', 'admin_reject_email_change']) {
      for (const code of codesOf(fn)) {
        assert.ok(code in ADMIN_EMAIL_ERRORS || adminCodes.has(code), `${fn}: ${code}`);
      }
    }
    for (const code of Object.keys(ADMIN_EMAIL_ERRORS)) {
      const used = new Set(['admin_change_email', 'admin_reject_email_change'].flatMap(codesOf));
      assert.ok(used.has(code), `${code} se v SQL nevyhazuje`);
    }
  });

  // Rozdělí seznam hodnot na nejvyšší úrovni (čárky v závorkách a v uvozovkách se nepočítají).
  const splitTop = (s) => {
    const out = [];
    let depth = 0, quote = false, cur = '';
    for (const ch of s) {
      if (ch === "'") quote = !quote;
      if (!quote && ch === '(') depth++;
      if (!quote && ch === ')') depth--;
      if (!quote && depth === 0 && ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const kindsInserted = (table) => {
    const kinds = new Set();
    const re = new RegExp(`insert into public\\.${table}\\s*\\(([^)]*)\\)\\s*values\\s*\\(`, 'gi');
    for (const m of sql.matchAll(re)) {
      const cols = m[1].split(',').map((c) => c.trim());
      const idx = cols.indexOf('kind');
      assert.ok(idx >= 0, `${table}: insert bez sloupce kind`);
      // hodnoty: od závorky za "values (" po její uzavření
      let i = m.index + m[0].length, depth = 1, quote = false, body = '';
      for (; i < sql.length && depth > 0; i++) {
        const ch = sql[i];
        if (ch === "'") quote = !quote;
        if (!quote && ch === '(') depth++;
        if (!quote && ch === ')') depth--;
        if (depth > 0) body += ch;
      }
      const lit = splitTop(body)[idx].match(/^'(\w+)'$/);
      assert.ok(lit, `${table}: kind není textový literál`);
      kinds.add(lit[1]);
    }
    return kinds;
  };

  test('druhy oznámení v SQL se shodují s konstantami', () => {
    assert.deepEqual([...kindsInserted('admin_notifications')], [EMAIL_REQUEST_KIND]);
    assert.deepEqual([...kindsInserted('user_notifications')].sort(), [EMAIL_CHANGED_KIND, EMAIL_REJECTED_KIND].sort());
    const filtered = [...sql.matchAll(/kind\s*(?:=|<>)\s*'(\w+)'/g)].map((m) => m[1]);
    assert.ok(filtered.length > 0);
    for (const k of filtered) assert.equal(k, EMAIL_REQUEST_KIND);
  });

  test('SQL nikde nedává nový e-mail do title ani body upozornění pro správce', () => {
    const insert = bodies.request_email_change.match(/insert into public\.admin_notifications[\s\S]*?;/i);
    assert.ok(insert);
    const cols = insert[0].match(/\(([^)]*)\)/)[1].split(',').map((c) => c.trim());
    const values = splitTop(insert[0].slice(insert[0].search(/values\s*\(/i)).replace(/^values\s*\(/i, '').replace(/\)\s*;?\s*$/, ''));
    assert.doesNotMatch(values[cols.indexOf('title')], /v_new/);
    assert.doesNotMatch(values[cols.indexOf('body')], /v_new/);
  });
});

describe('shoda klienta', () => {
  const settings = stripJsComments(read('src/components/SettingsModal.jsx'));
  const auth = stripJsComments(read('src/contexts/AuthContext.jsx'));
  const admin = stripJsComments(read('src/pages/AdminDashboard.jsx'));

  test('Nastavení už nemění e-mail přímo přes Supabase Auth', () => {
    assert.ok(!settings.includes('updateUser({ email'));
    assert.ok(!settings.includes('emailRedirectTo'));
    assert.doesNotMatch(settings, /const EMAIL_RE\b/);
  });

  test('Nastavení volá všechny tři funkce žádosti a bere logiku ze sdíleného modulu', () => {
    for (const fn of ['request_email_change', 'my_email_change_request', 'cancel_my_email_change_request']) {
      assert.match(settings, new RegExp(`rpc\\('${fn}'`), fn);
    }
    assert.match(settings, /from '\.\.\/emailChange'/);
    assert.match(settings, /verifyPassword\(user\.email, emailPw\)/);
  });

  test('doručená pošta má ikony pro oba druhy oznámení o e-mailu', () => {
    const block = settings.match(/const INBOX_ICONS = \{([^}]*)\};/);
    assert.ok(block, 'chybí INBOX_ICONS');
    assert.match(block[1], /\[EMAIL_CHANGED_KIND\]\s*:/);
    assert.match(block[1], /\[EMAIL_REJECTED_KIND\]\s*:/);
  });

  test('AuthContext po změně e-mailu správcem obnoví relaci', () => {
    assert.match(auth, /refreshSession\(/);
    assert.match(auth, /sameEmail\(/);
  });

  test('administrace volá obě funkce správce', () => {
    assert.match(admin, /rpc\('admin_change_email'/);
    assert.match(admin, /rpc\('admin_reject_email_change'/);
  });
});
