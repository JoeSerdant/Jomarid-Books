// Testy přátelských hlášek o chybách (src/lib/friendlyError.js).
//   npm run test:friendly
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, friendlyError, friendlyErrorWithDetail, FRIENDLY } from '../lib/friendlyError.js';

test('classifyError: druhy chyb ze Supabase, fetch a funkcí', () => {
  const cases = [
    [{ message: 'Failed to fetch' }, 'network'],
    [{ name: 'FunctionsFetchError', message: 'x' }, 'network'],
    [{ message: 'TypeError: NetworkError when attempting to fetch resource.' }, 'network'],
    [{ name: 'TimeoutError', message: 'Signal timed out.' }, 'timeout'],
    [{ name: 'AbortError', message: 'x' }, 'timeout'],
    [{ message: 'upstream request timeout' }, 'timeout'],
    [{ status: 503, message: 'x' }, 'server'],
    [{ status: 502 }, 'server'],
    [{ context: { status: 500 } }, 'server'],
    [{ message: 'Gemini odpovědělo 503: This model is currently experiencing high demand' }, 'server'],
    [{ message: 'Internal server error' }, 'server'],
    [{ status: 429 }, 'rate'],
    [{ message: 'Too many requests' }, 'rate'],
    [{ status: 401 }, 'auth'],
    [{ message: 'JWT expired' }, 'auth'],
    [{ code: 'PGRST301', message: 'x' }, 'auth'],
    [{ status: 403 }, 'forbidden'],
    [{ code: '42501', message: 'x' }, 'forbidden'],
    [{ message: 'new row violates row-level security policy' }, 'forbidden'],
    [{ code: 'PGRST202', message: 'x' }, 'missing'],
    [{ message: 'Could not find the function public.x in the schema cache' }, 'missing'],
    [{ status: 404 }, 'missing'],
    [{ message: 'duplicate key value violates unique constraint' }, 'other'],
    [{ message: 'Nemáš dost Jomarid Coinů.' }, 'other'],
    [null, 'other'],
    ['něco', 'other'],
  ];
  for (const [err, kind] of cases) assert.equal(classifyError(err), kind, JSON.stringify(err));
});

test('friendlyError: známé druhy dostanou lidskou větu, ostatní fallback a nikdy technický text', () => {
  assert.equal(friendlyError({ status: 503 }, 'Záložku se nepodařilo uložit.'), FRIENDLY.server);
  assert.match(FRIENDLY.server, /závratě/);
  assert.equal(friendlyError({ message: 'Failed to fetch' }, 'x'), FRIENDLY.network);
  assert.equal(friendlyError({ message: 'duplicate key value violates unique constraint "x_pkey"' }, 'Záložku se nepodařilo uložit.'), 'Záložku se nepodařilo uložit.');
  assert.equal(friendlyError(null), 'Něco se nepovedlo. Zkus to prosím znovu.');
  for (const text of Object.values(FRIENDLY)) assert.ok(!/\b\d{3}\b|fetch|jwt|rls|postgres/i.test(text), text);
});

test('friendlyErrorWithDetail: u neznámé chyby přidá krátký technický text (pro správce)', () => {
  assert.equal(friendlyErrorWithDetail({ status: 503 }, 'x'), FRIENDLY.server);
  const t = friendlyErrorWithDetail({ message: 'duplicate key value\nviolates   constraint ' + 'a'.repeat(400) }, 'Uložení selhalo.');
  assert.match(t, /^Uložení selhalo\. \(technicky: duplicate key value violates constraint a+\)$/);
  assert.ok(t.length < 220);
  assert.equal(friendlyErrorWithDetail({}, 'Uložení selhalo.'), 'Uložení selhalo.');
});
