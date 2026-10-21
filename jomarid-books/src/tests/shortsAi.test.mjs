// Testy AI pomocníka pro shortB: Edge Function db/ai/shortb-ai.ts (s falešnými závislostmi, bez sítě) a klient src/shorts/shortsAi.js.
//   npm run test:shortsai
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_PROMPT_MAX, AI_LENGTHS, latestPart, buildAiRequest, generateShortText, aiErrorMessage } from '../shorts/shortsAi.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
let EDGE = null;
try { EDGE = await import('../../db/ai/shortb-ai.ts'); } catch (e) {
  // Přeskočí se jen starší Node bez podpory TypeScriptu. Chyba v samotném souboru (syntaxe, import) musí test shodit, ne ho tiše vynechat.
  if (!['ERR_UNKNOWN_FILE_EXTENSION', 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX'].includes(e?.code)) throw e;
}
const skip = !EDGE && 'Node bez podpory TypeScriptu';

const req = (body, { method = 'POST', token = 'tok', raw } = {}) => new Request('https://f.test/shortb-ai', { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined });
const mkDeps = (over = {}) => {
  const calls = { auth: [], gen: [] };
  return { calls, deps: {
    authorize: async (t) => { calls.auth.push(t); return { ok: true }; },
    generate: async (system, user) => { calls.gen.push({ system, user }); return { text: 'První odstavec.\n\nDruhý odstavec.' }; },
    ...over,
  } };
};
const body = async (res) => res.json();

/* ---------------------------------------------------------------- Edge Function */
test('Edge Function: předběžný dotaz prohlížeče (CORS) a metody mimo POST', { skip }, async () => {
  const { deps } = mkDeps();
  const pre = await EDGE.handle(new Request('https://f.test/', { method: 'OPTIONS' }), deps);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  assert.equal((await EDGE.handle(new Request('https://f.test/', { method: 'GET' }), deps)).status, 405);
  const ok = await EDGE.handle(req({ prompt: 'x' }), deps);
  assert.ok(ok.headers.get('access-control-allow-origin'), 'odpověď má CORS hlavičky');
});

test('Edge Function: bez přihlášení 401, špatná role 403, selhání ověření 502; model se nevolá', { skip }, async () => {
  const a = mkDeps();
  assert.equal((await EDGE.handle(req({ prompt: 'x' }, { token: '' }), a.deps)).status, 401);
  assert.equal(a.calls.auth.length + a.calls.gen.length, 0);
  const b = mkDeps({ authorize: async () => ({ ok: false, reason: 'forbidden' }) });
  const r = await EDGE.handle(req({ prompt: 'x' }), b.deps);
  assert.equal(r.status, 403); assert.equal((await body(r)).error, 'forbidden');
  assert.equal(b.calls.gen.length, 0, 'čtenář AI nespustí');
  const c = mkDeps({ authorize: async () => ({ ok: false, reason: 'not_authenticated' }) });
  assert.equal((await EDGE.handle(req({ prompt: 'x' }), c.deps)).status, 401);
  const d = mkDeps({ authorize: async () => { throw new Error('síť'); } });
  const quiet = console.error; console.error = () => {};
  try { assert.equal((await EDGE.handle(req({ prompt: 'x' }), d.deps)).status, 502); } finally { console.error = quiet; }
});

test('Edge Function: token se předává jen ověření, jiná hlavička Authorization se bere bez „Bearer“', { skip }, async () => {
  const { deps, calls } = mkDeps();
  await EDGE.handle(req({ prompt: 'x' }, { token: 'abc.def.ghi' }), deps);
  assert.deepEqual(calls.auth, ['abc.def.ghi']);
});

test('Edge Function: neplatný vstup se odmítne dřív, než se zavolá model', { skip }, async () => {
  for (const [input, re] of [
    [{}, /o čem má shortB být/],
    [{ prompt: '   ' }, /o čem má shortB být/],
    [{ prompt: 'x'.repeat(2001) }, /moc dlouhé/],
    [{ mode: 'next', prompt: 'x' }, /předchozího dílu/],
    [{ mode: 'next', previous: { body: '  ' } }, /předchozího dílu/],
  ]) {
    const { deps, calls } = mkDeps();
    const r = await EDGE.handle(req(input), deps);
    assert.equal(r.status, 400, JSON.stringify(input).slice(0, 60));
    assert.match((await body(r)).message, re);
    assert.equal(calls.gen.length, 0);
  }
  const { deps } = mkDeps();
  assert.equal((await EDGE.handle(req(null, { raw: 'ne json' }), deps)).status, 400);
  assert.equal((await EDGE.handle(req(null, { raw: '5' }), deps)).status, 400, 'číslo místo objektu je prázdné zadání');
});

test('Edge Function: úspěch vrátí uklizený text, počet znaků a model dostane zadání i délku', { skip }, async () => {
  const { deps, calls } = mkDeps({ generate: async (s, u) => { calls.gen.push({ system: s, user: u }); return { text: '```\n# Nadpis\n\n**Silný** začátek.\n\n\n\n- druhý odstavec\n```' }; } });
  const r = await EDGE.handle(req({ prompt: '  Horor o majáku  ', length: 'long' }), deps);
  assert.equal(r.status, 200);
  const out = await body(r);
  assert.equal(out.text, 'Silný začátek.\n\ndruhý odstavec');
  assert.equal(out.chars, [...out.text].length);
  assert.equal(out.trimmed, false);
  assert.match(calls.gen[0].user, /Zadání: Horor o majáku$/);
  assert.match(calls.gen[0].system, /zhruba 5500 znaků/);
});

test('Edge Function: text nad 6 000 znaků se ořízne na hranici odstavce', { skip }, async () => {
  const para = 'Věta o pár slovech, která se opakuje. '.repeat(20).trim();
  const long = Array.from({ length: 12 }, () => para).join('\n\n');
  assert.ok(long.length > 6000);
  const { deps } = mkDeps({ generate: async () => ({ text: long }) });
  const out = await body(await EDGE.handle(req({ prompt: 'x' }), deps));
  assert.ok(out.chars <= 6000 && out.trimmed === true);
  assert.ok(out.text.endsWith(para), 'konec je celý odstavec');
  const noBreaks = { text: 'Slovo. '.repeat(1500) };
  const { deps: d2 } = mkDeps({ generate: async () => noBreaks });
  const o2 = await body(await EDGE.handle(req({ prompt: 'x' }), d2));
  assert.ok(o2.chars <= 6000 && o2.text.endsWith('.'), 'bez odstavců se řeže na větě');
});

test('Edge Function: chyby modelu dostanou českou větu a správný kód, podrobnosti ani klíč se neprozradí', { skip }, async () => {
  const quiet = console.error; console.error = () => {};
  try {
    for (const [result, status, code] of [[{ error: 'quota' }, 429, 'quota'], [{ error: 'blocked' }, 422, 'blocked'], [{ error: 'upstream' }, 502, 'upstream'], [{ error: 'empty' }, 502, 'empty'], [{ text: '  \n ' }, 502, 'empty']]) {
      const { deps } = mkDeps({ generate: async () => result });
      const r = await EDGE.handle(req({ prompt: 'x' }), deps);
      assert.equal(r.status, status, code);
      const b = await body(r);
      assert.equal(b.error, code);
      assert.match(b.message, /AI/);
    }
    const { deps } = mkDeps({ generate: async () => { throw new Error('tajné: AIza-klic'); } });
    const r = await EDGE.handle(req({ prompt: 'x' }), deps);
    assert.equal(r.status, 502);
    assert.doesNotMatch(JSON.stringify(await body(r)), /AIza|tajné/);
  } finally { console.error = quiet; }
});

test('Edge Function: další díl série pošle modelu předchozí díl, číslo a zadání (zadání smí chybět)', { skip }, async () => {
  const { deps, calls } = mkDeps();
  const previous = { title: 'Maják', body: 'Hlídač slyšel zvony.', seriesName: 'Zvony pod hladinou', seriesPart: 2 };
  const r = await EDGE.handle(req({ mode: 'next', previous }), deps);
  assert.equal(r.status, 200);
  const u = calls.gen[0].user;
  assert.match(u, /další díl série „Zvony pod hladinou“ \(předchozí byl díl 2, „Maják“\)/);
  assert.match(u, /Hlídač slyšel zvony\./);
  assert.match(u, /Zadání pro tenhle díl není/);
  await EDGE.handle(req({ mode: 'next', prompt: 'Objeví se potápěč', previous }), deps);
  assert.match(calls.gen[1].user, /Zadání pro tenhle díl: Objeví se potápěč/);
  await EDGE.handle(req({ mode: 'new', prompt: 'Nová povídka', previous }), deps);
  assert.doesNotMatch(calls.gen[2].user, /Hlídač slyšel/, 'předchozí díl se u nového textu nepoužije');
  const long = { ...previous, body: 'a'.repeat(9000) };
  await EDGE.handle(req({ mode: 'next', previous: long }), deps);
  assert.ok(calls.gen[3].user.length < 7000, 'předchozí díl se ořízne');
});

test('Edge Function: pokyny modelu zakazují Markdown a úvod, chtějí odstavce a omezují obsah', { skip }, () => {
  const { system } = EDGE.buildPrompt({ mode: 'new', prompt: 'x', length: 'medium', previous: null });
  for (const re of [/česky/, /zhruba 4000 znaků/, /prázdným řádkem/, /Markdown/, /pouze samotný text/, /skutečné žijící osoby/, /explicitní sexuální obsah/]) assert.match(system, re);
  assert.equal(EDGE.MAX_BODY_CHARS, 6000, 'stejný strop jako db/shorts.sql');
  assert.match(read('..', 'db', 'shorts.sql'), /between 1 and 6000/);
});

test('Edge Function: Gemini se volá jen na serveru, klíč se čte z tajných hodnot a nikde není v repu', { skip }, () => {
  const fn = fs.readFileSync(path.join(SRC, '..', 'db', 'ai', 'shortb-ai.ts'), 'utf8');
  assert.match(fn, /D\.env\.get\('GEMINI_API_KEY'\)/);
  assert.match(fn, /'x-goog-api-key': key/, 'klíč jde v hlavičce, ne v adrese (ta se loguje)');
  assert.doesNotMatch(fn, /\?key=/);
  assert.match(fn, /role === 'nakladatel' \|\| role === 'správce'/);
  for (const f of ['src/shorts/shortsAi.js', 'src/components/ShortsStudio.jsx']) assert.doesNotMatch(fs.readFileSync(path.join(SRC, '..', f), 'utf8'), /generativelanguage|GEMINI/, `${f}: prohlížeč Gemini nevolá`);
  const everything = fs.readdirSync(path.join(SRC, '..', 'db', 'ai')).map((f) => fs.readFileSync(path.join(SRC, '..', 'db', 'ai', f), 'utf8')).join('\n') + fn;
  assert.doesNotMatch(everything, /AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,}/, 'v repu není klíč');
});

/* ---------------------------------------------------------------- klient */
test('latestPart: nejvyšší díl téže série (bez ohledu na velikost písmen a diakritiku), ostatní série a vlastní shortB se přeskočí', () => {
  const items = [
    { id: '1', seriesName: 'Lesní kronika', seriesPart: 1, body: 'a' }, { id: '2', seriesName: 'lesni KRONIKA', seriesPart: 3, body: 'b' }, { id: '3', seriesName: 'Lesní kronika', seriesPart: 2, body: 'c' },
    { id: '4', seriesName: 'Jiná', seriesPart: 9, body: 'd' }, { id: '5', seriesName: null, seriesPart: null, body: 'e' }, { id: '6', seriesName: 'Lesní kronika', seriesPart: 7, body: '' },
  ];
  assert.equal(latestPart(items, 'Lesní kronika').id, '2');
  assert.equal(latestPart(items, 'Lesní kronika', '2').id, '3', 'upravovaný shortB se přeskočí');
  assert.equal(latestPart(items, 'Neznámá'), null);
  assert.equal(latestPart(items, '  '), null);
  assert.equal(latestPart(undefined, 'x'), null);
});

test('buildAiRequest: kontrola zadání, délky a předchozího dílu', () => {
  assert.match(buildAiRequest({ prompt: '  ' }).error, /o čem/);
  assert.match(buildAiRequest({ prompt: 'x'.repeat(AI_PROMPT_MAX + 1) }).error, /2000/);
  assert.deepEqual(buildAiRequest({ prompt: ' Horor ', length: 'long' }).request, { mode: 'new', prompt: 'Horor', length: 'long', previous: null });
  assert.equal(buildAiRequest({ prompt: 'x', length: 'neznámá' }).request.length, 'medium');
  assert.deepEqual(AI_LENGTHS.map((l) => l.key), ['short', 'medium', 'long']);
  assert.match(buildAiRequest({ mode: 'next' }).error, /předchozí díl/);
  assert.match(buildAiRequest({ mode: 'next', previous: { body: ' ' } }).error, /předchozí díl/);
  const next = buildAiRequest({ mode: 'next', previous: { title: 'T', body: 'x'.repeat(9000), seriesName: 'S', seriesPart: '2' } });
  assert.equal(next.request.prompt, '', 'u dalšího dílu smí zadání chybět');
  assert.equal(next.request.previous.body.length, 6000);
  assert.equal(next.request.previous.seriesPart, 2);
});

test('generateShortText: úspěch, chyba funkce s kódem, funkce není nasazená a vyhozená výjimka', async () => {
  const ok = await generateShortText({ functions: { invoke: async (name, o) => { assert.equal(name, 'shortb-ai'); assert.deepEqual(o.body, { mode: 'new' }); return { data: { text: 'Text.', chars: 5, trimmed: true }, error: null }; } } }, { mode: 'new' });
  assert.deepEqual(ok, { text: 'Text.', chars: 5, trimmed: true });
  const withCode = (code, message) => ({ functions: { invoke: async () => ({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: code, message }) } } }) } });
  assert.match((await generateShortText(withCode('quota', ''), {})).error, /plno/);
  assert.match((await generateShortText(withCode('forbidden', ''), {})).error, /nakladatel/);
  assert.equal((await generateShortText(withCode('neznamy', 'Vlastní věta ze serveru.'), {})).error, 'Vlastní věta ze serveru.');
  const failing = (error) => ({ functions: { invoke: async () => ({ data: null, error }) } });
  const quietWarn = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };
  assert.match((await quietWarn(() => generateShortText(failing({ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }), {}))).error, /Nepodařilo se spojit/);
  assert.match((await quietWarn(() => generateShortText(failing({ name: 'FunctionsRelayError', message: 'Relay Error invoking the Edge Function' }), {}))).error, /se nespustila.*Logs/);
  assert.match((await quietWarn(() => generateShortText(failing({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 404, json: async () => ({ code: 'NOT_FOUND', message: 'Requested function was not found' }) } }), {}))).error, /nebyla nalezena.*přesně/);
  assert.match((await quietWarn(() => generateShortText(failing({ name: 'FunctionsHttpError', message: 'x', context: { status: 401, json: async () => ({ code: 401, message: 'Invalid JWT' }) } }), {}))).error, /Verify JWT/);
  const e500 = (await quietWarn(() => generateShortText(failing({ name: 'FunctionsHttpError', message: 'x', context: { status: 500, json: async () => ({}) } }), {}))).error;
  assert.match(e500, /neodpovídá.*kód 500.*Logs/);
  assert.match((await generateShortText({ functions: { invoke: async () => ({ data: { text: ' ' }, error: null }) } }, {})).error, /nevrátila/);
  assert.match((await generateShortText({ functions: { invoke: async () => { throw new Error('x'); } } }, {})).error, /neodpovídá/);
  assert.match((await generateShortText({ functions: { invoke: async () => ({ data: null, error: { message: 'divné', context: { json: async () => { throw new Error('ne json'); } } } }) } }, {})).error, /neodpovídá/);
  assert.equal(aiErrorMessage('blocked').length > 10, true);
  assert.equal(aiErrorMessage('', 'zpráva'), 'zpráva');
});

test('Studio je napojené na AI: panel, tlačítka a potvrzení přepsání textu', () => {
  const studio = read('components', 'ShortsStudio.jsx');
  for (const needle of ['data-testid="shorts-ai"', 'data-testid="shorts-ai-write"', 'data-testid="shorts-ai-next"', "runAi('new')", "runAi('next')", 'buildAiRequest(', 'generateShortText(supabase', 'latestPart(items, form.seriesName)', 'Přepsat stávající text návrhem od AI?']) assert.ok(studio.includes(needle), needle);
  assert.match(studio, /form && !form\.id \? latestPart/, 'další díl jen u nového shortB');
});
