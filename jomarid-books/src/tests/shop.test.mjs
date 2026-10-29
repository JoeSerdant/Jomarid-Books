// Testy obchůdku: katalog, shoda se SQL, volání serveru, stav zboží a napojení do Statistik, her a exportu dat.
//   npm run test:shop
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SHOP_ITEMS, SHOP_KINDS, SHOP_ERRORS, SHOP_FALLBACK_ERROR, KIND_TITLE, KIND_GAMEFX,
  getShopItem, itemsOfKind, groupsOfKind, titleLabel, gameFilter, requirementText, missingCoins, itemState, shopErrorText,
} from '../shop/catalog.js';
import { EMPTY_COSMETICS, normalizeCosmetics, loadMyCosmetics, buyCosmetic, equipCosmetic, loadEquippedTitles, errorReason } from '../shop/api.js';
import { GAME_BADGES, GAME_CATALOG } from '../gameRecords/catalog.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(SRC, '..', 'db');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8').replace(/\r\n/g, '\n');
const sql = fs.readFileSync(path.join(DB, 'shop.sql'), 'utf8');

/* ---------------------------------------------------------------- katalog */
test('katalog: unikátní id s předponou podle skupiny, ceny 100 až 400 mincí, názvy se neopakují', () => {
  const ids = SHOP_ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of SHOP_ITEMS) {
    assert.ok(item.id.startsWith(item.kind === KIND_TITLE ? 'title_' : 'gamefx_'), item.id);
    assert.ok(Number.isInteger(item.price) && item.price >= 100 && item.price <= 400, `${item.id}: cena`);
    assert.ok(item.label && item.label.length >= 3, item.id);
  }
  for (const { kind } of SHOP_KINDS) {
    const labels = itemsOfKind(kind).map((i) => i.label);
    assert.equal(new Set(labels).size, labels.length, `názvy ve skupině ${kind}`);
  }
  assert.equal(itemsOfKind(KIND_TITLE).length, 44);
  assert.equal(itemsOfKind(KIND_GAMEFX).length, 6);
});

test('katalog: požadovaný odznak existuje a mají ho jen tituly; vzhledy her mají filtr z povolených funkcí a popis', () => {
  const badgeIds = new Set(GAME_BADGES.map((b) => b.id));
  for (const item of SHOP_ITEMS) {
    if (item.kind === KIND_GAMEFX) {
      assert.equal(item.requires, null, `${item.id}: vzhled her se kupuje jen za mince`);
      assert.ok(item.description?.endsWith('.'), `${item.id}: popis`);
      assert.match(item.filter, /^(?:(?:grayscale|sepia|saturate|contrast|brightness|hue-rotate)\(-?[\d.]+(?:deg)?\) ?)+$/, `${item.id}: filtr`);
    } else {
      assert.ok(item.requires === null || badgeIds.has(item.requires), `${item.id}: odznak ${item.requires}`);
      assert.equal(item.filter, undefined);
    }
  }
  assert.equal(new Set(SHOP_ITEMS.filter((i) => i.requires).map((i) => i.requires)).size, SHOP_ITEMS.filter((i) => i.requires).length, 'každý odznak odemyká jediný titul');
});

test('tituly: obecné jen za mince a u každé hry aspoň tři, další se odemykají odznaky ze hry', () => {
  const titles = itemsOfKind(KIND_TITLE);
  assert.ok(titles.filter((t) => !t.requires).length >= 12, 'obecných titulů za mince je aspoň dvanáct');
  const badgeGame = new Map(GAME_BADGES.map((b) => [b.id, b.game]));
  for (const game of GAME_CATALOG) {
    const own = titles.filter((t) => t.requires && badgeGame.get(t.requires) === game.id);
    assert.ok(own.length >= 3, `${game.title}: má jen ${own.length} titulů`);
  }
});

test('groupsOfKind: tituly po skupinách (obecné, pak hry v pořadí katalogu), každý titul v jediné skupině, vzhledy her bez nadpisu', () => {
  const groups = groupsOfKind(KIND_TITLE);
  assert.deepEqual(groups.map((g) => g.id), ['reading', ...GAME_CATALOG.map((g) => g.id)]);
  assert.deepEqual(groups.map((g) => g.label), ['Čtení a obecné', ...GAME_CATALOG.map((g) => g.title)]);
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), itemsOfKind(KIND_TITLE).length);
  assert.equal(new Set(groups.flatMap((g) => g.items.map((i) => i.id))).size, itemsOfKind(KIND_TITLE).length, 'žádný titul dvakrát');
  assert.ok(groups[0].items.every((i) => i.requires === null), 'v obecné skupině jsou jen tituly bez odznaku');
  const badgeGame = new Map(GAME_BADGES.map((b) => [b.id, b.game]));
  for (const g of groups.slice(1)) assert.ok(g.items.every((i) => badgeGame.get(i.requires) === g.id), `${g.id}: tituly patří hře`);
  const fx = groupsOfKind(KIND_GAMEFX);
  assert.equal(fx.length, 1); assert.equal(fx[0].label, null); assert.equal(fx[0].items.length, 6);
});

test('Shop.jsx kreslí zboží po skupinách s nadpisem (u vzhledů her bez nadpisu)', () => {
  const shop = read('components', 'Shop.jsx');
  assert.match(shop, /groupsOfKind\(kind\)\.map\(\(group\) => \(/);
  assert.match(shop, /data-testid=\{`shop-group-\$\{group\.id\}`\}/);
  assert.match(shop, /\{group\.label && <h4/);
});

test('titleLabel, gameFilter, requirementText, missingCoins', () => {
  assert.equal(titleLabel('title_pilot'), 'Pilot');
  assert.equal(titleLabel('gamefx_noir'), null, 'vzhled her není titul');
  assert.equal(titleLabel('neznamy'), null);
  assert.equal(titleLabel(undefined), null);
  assert.equal(gameFilter('gamefx_noir'), 'grayscale(1) contrast(1.15)');
  assert.equal(gameFilter('title_pilot'), '', 'titul není vzhled her');
  assert.equal(gameFilter('neznamy'), '');
  assert.equal(gameFilter(null), '');
  assert.equal(gameFilter('toString'), '');
  assert.equal(requirementText(getShopItem('title_pilot')), 'Odznak „Eso hvězd“ (Jomarid Rocket Game)');
  assert.equal(requirementText(getShopItem('title_bookworm')), null);
  assert.equal(requirementText(null), null);
  assert.equal(missingCoins(getShopItem('title_pilot'), 100), 50);
  assert.equal(missingCoins(getShopItem('title_pilot'), 150), 0);
  assert.equal(missingCoins(getShopItem('title_pilot'), 9999), 0);
  assert.equal(missingCoins(getShopItem('title_pilot'), undefined), 150);
  assert.equal(missingCoins(getShopItem('title_pilot'), NaN), 150);
});

test('itemState: nasazené, koupené, zamčené, málo mincí a lze koupit', () => {
  const pilot = getShopItem('title_pilot');
  const book = getShopItem('title_bookworm');
  const noir = getShopItem('gamefx_noir');
  const base = { owned: [], equipped: {}, unlocked: [], coins: 1000 };
  assert.equal(itemState(book, base), 'available');
  assert.equal(itemState(book, { ...base, coins: 99 }), 'poor');
  assert.equal(itemState(book, { ...base, coins: 100 }), 'available', 'přesně tolik mincí stačí');
  assert.equal(itemState(pilot, base), 'locked');
  assert.equal(itemState(pilot, { ...base, coins: 0 }), 'locked', 'odznak chybí přednější než mince');
  assert.equal(itemState(pilot, { ...base, unlocked: ['rocket_ace'] }), 'available');
  assert.equal(itemState(pilot, { ...base, unlocked: ['rocket_ace'], coins: 149 }), 'poor');
  assert.equal(itemState(book, { ...base, owned: ['title_bookworm'] }), 'owned');
  assert.equal(itemState(book, { ...base, owned: ['title_bookworm'], equipped: { title: 'title_bookworm' } }), 'equipped');
  assert.equal(itemState(book, { ...base, owned: ['title_bookworm'], equipped: { title: 'title_night' } }), 'owned', 'nasazený je jiný titul');
  assert.equal(itemState(noir, { ...base, owned: ['gamefx_noir'], equipped: { title: 'gamefx_noir' } }), 'owned', 'nasazení se bere podle skupiny zboží');
  assert.equal(itemState(pilot, { owned: ['title_pilot'] }), 'owned', 'koupené zůstane koupené, i když odznak mezitím chybí');
  assert.equal(itemState(book, undefined), 'poor');
});

test('chybové hlášky: každý kód z SQL, který může klient vyvolat, má český text, a žádný text nezůstal bez kódu', () => {
  const codes = new Set([...sql.matchAll(/raise exception '(\w+)';/g)].map((m) => m[1]));
  const clientNever = new Set(['invalid_kind', 'too_many']); // klient posílá jen 'title' a 'gamefx' a pár ID najednou
  for (const code of codes) assert.ok(clientNever.has(code) || SHOP_ERRORS[code], `chybí text pro ${code}`);
  for (const code of Object.keys(SHOP_ERRORS)) assert.ok(codes.has(code), `text pro ${code}, který SQL nevyhazuje`);
  for (const text of Object.values(SHOP_ERRORS)) assert.ok(text.endsWith('.') && !text.includes('_'), text);
  assert.equal(shopErrorText('insufficient_coins'), 'Nemáš dost Jomarid Coinů.');
  assert.equal(shopErrorText('neco_noveho'), SHOP_FALLBACK_ERROR);
  assert.equal(shopErrorText(undefined), SHOP_FALLBACK_ERROR);
});

/* ---------------------------------------------------------------- shoda se SQL */
test('db/shop.sql má stejné zboží, ceny, požadované odznaky a skupiny jako katalog v appce', () => {
  const rows = [...sql.matchAll(/^\s+\('(\w+)', '(\w+)', '([^']+)', (\d+), (null|'\w+')\),?$/gm)].map((m) => `${m[1]}|${m[2]}|${m[3]}|${m[4]}|${m[5] === 'null' ? '' : m[5].slice(1, -1)}`);
  const want = SHOP_ITEMS.map((i) => `${i.id}|${i.kind}|${i.label}|${i.price}|${i.requires || ''}`);
  assert.deepEqual(rows, want);
  assert.match(sql, /check \(kind in \('title', 'gamefx'\)\)/);
  assert.deepEqual(SHOP_KINDS.map((k) => k.kind), [KIND_TITLE, KIND_GAMEFX]);
});

test('SQL: funkce jsou jen pro přihlášené, tabulky mají RLS a nikdo k nim nemá přímý přístup, nákup zamyká řádek profilu', () => {
  for (const fn of ['buy_cosmetic(text)', 'equip_cosmetic(text, text)', 'my_cosmetics()', 'equipped_titles(uuid[])']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon;`), `revoke ${fn}`);
    assert.ok(sql.includes(`grant execute on function public.${fn} to authenticated;`), `grant ${fn}`);
  }
  for (const t of ['shop_items', 'user_cosmetics', 'user_equipped']) assert.ok(sql.includes(`alter table public.${t} enable row level security;`), t);
  assert.match(sql, /revoke all on public\.shop_items, public\.user_cosmetics, public\.user_equipped from public, anon, authenticated;/);
  assert.equal((sql.match(/security definer set search_path to 'public'/g) || []).length, 4);
  assert.match(sql, /select coins into v_coins from public\.profiles where id = v_uid for update;/, 'zámek řádku: dva nákupy naráz se nepředběhnou');
  assert.match(sql, /'cosmetic_purchase:' \|\| v_item\.item_id/, 'označení v deníku mincí');
  // Mince strhává spoušť trg_update_coins při zápisu do coin_transactions (zjištěno z databáze); přímý update profilu by je strhl dvakrát.
  assert.ok(!/update\s+public\.profiles\s+set\s+coins/i.test(sql), 'zůstatek se v profilu přímo neupravuje');
  assert.match(sql, /perform set_config\('app\.bypass_profile_column_guard', 'true', true\);\n\s+insert into public\.coin_transactions/, 'nákup si před zápisem do deníku nastaví bypass ochrany sloupců profilu');
  assert.match(sql, /v_after is distinct from v_before - 1/, 'kontrola předpokladů vyžaduje, aby zápis do deníku snížil zůstatek o zapsanou částku');
  assert.match(read('pages', 'AdminDashboard.jsx'), /cosmetic_purchase: '[^']+'/, 'správce vidí nákupy z obchůdku pod čitelným názvem');
});

/* ---------------------------------------------------------------- volání serveru */
const fakeClient = (handlers) => ({ rpc: async (name, args) => { const h = handlers[name]; if (!h) return { data: null, error: { message: 'function does not exist' } }; return h(args); } });
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

test('normalizeCosmetics zahodí neznámé zboží, zdvojení a nasazené kusy ve špatné skupině', () => {
  const c = normalizeCosmetics({ owned: ['title_pilot', 'title_pilot', 'neznamy', 5, 'gamefx_noir'], equipped: { title: 'title_pilot', gamefx: 'gamefx_noir', frame: 'x' } });
  assert.deepEqual(c, { owned: ['title_pilot', 'gamefx_noir'], equipped: { title: 'title_pilot', gamefx: 'gamefx_noir' } });
  assert.deepEqual(normalizeCosmetics({ owned: [], equipped: { title: 'gamefx_noir', gamefx: 'title_pilot' } }).equipped, {}, 'zboží ve špatné skupině se nenasadí');
  assert.deepEqual(normalizeCosmetics({ owned: [], equipped: { title: 'neznamy' } }).equipped, {});
  for (const bad of [null, undefined, 5, 'x', [], true]) assert.deepEqual(normalizeCosmetics(bad), EMPTY_COSMETICS);
  assert.deepEqual(normalizeCosmetics({ owned: 'x', equipped: [] }), { owned: [], equipped: {} });
});

test('loadMyCosmetics: úspěch, a když obchůdek v databázi není nebo selže, null (appka ho pak neukáže)', async () => {
  const ok = await loadMyCosmetics(fakeClient({ my_cosmetics: async () => ({ data: { owned: ['title_night'], equipped: { title: 'title_night' } }, error: null }) }));
  assert.deepEqual(ok, { owned: ['title_night'], equipped: { title: 'title_night' } });
  assert.equal(await quiet(() => loadMyCosmetics(fakeClient({}))), null);
  assert.equal(await quiet(() => loadMyCosmetics(fakeClient({ my_cosmetics: async () => { throw new Error('síť'); } }))), null);
});

test('errorReason: kód chyby musí stát v hlášce samostatně', () => {
  assert.equal(errorReason({ message: 'insufficient_coins' }), 'insufficient_coins');
  assert.equal(errorReason({ message: 'Error: locked' }), 'locked');
  assert.equal(errorReason(new Error('already_owned')), 'already_owned');
  assert.equal(errorReason({ message: 'request blocked by client' }), 'failed', '"blocked" není "locked"');
  assert.equal(errorReason({ message: 'Failed to fetch' }), 'failed');
  assert.equal(errorReason(null), 'failed');
  assert.equal(errorReason('not_owned'), 'not_owned');
});

test('buyCosmetic: neznámé zboží se na server neposílá, úspěch vrátí nový zůstatek, chyby se převedou na kód', async () => {
  const calls = [];
  const client = fakeClient({ buy_cosmetic: async (args) => { calls.push(args); return { data: { ok: true, item_id: args.p_item_id, kind: 'title', new_balance: 400 }, error: null }; } });
  assert.deepEqual(await buyCosmetic(client, 'nope'), { ok: false, reason: 'unknown_item' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await buyCosmetic(client, 'title_bookworm'), { ok: true, itemId: 'title_bookworm', kind: 'title', newBalance: 400 });
  assert.deepEqual(calls, [{ p_item_id: 'title_bookworm' }]);
  for (const code of ['insufficient_coins', 'already_owned', 'locked', 'unknown_item']) {
    const r = await buyCosmetic(fakeClient({ buy_cosmetic: async () => ({ data: null, error: { message: code } }) }), 'title_pilot');
    assert.deepEqual(r, { ok: false, reason: code });
  }
  assert.deepEqual(await buyCosmetic(fakeClient({}), 'title_pilot'), { ok: false, reason: 'failed' }, 'funkce v databázi není');
  assert.deepEqual(await buyCosmetic(fakeClient({ buy_cosmetic: async () => { throw new Error('síť'); } }), 'title_pilot'), { ok: false, reason: 'failed' });
  assert.deepEqual(await buyCosmetic(fakeClient({ buy_cosmetic: async () => ({ data: { ok: false }, error: null }) }), 'title_pilot'), { ok: false, reason: 'failed' });
  assert.equal((await buyCosmetic(fakeClient({ buy_cosmetic: async () => ({ data: { ok: true, new_balance: 'x' }, error: null }) }), 'title_pilot')).newBalance, null, 'nečitelný zůstatek se neukáže jako číslo');
});

test('equipCosmetic: nasazení i sundání (itemId null) se pošle serveru, chyby se převedou na kód', async () => {
  const calls = [];
  const client = fakeClient({ equip_cosmetic: async (args) => { calls.push(args); return { data: { ok: true }, error: null }; } });
  assert.deepEqual(await equipCosmetic(client, 'title', 'title_night'), { ok: true });
  assert.deepEqual(await equipCosmetic(client, 'gamefx', null), { ok: true });
  assert.deepEqual(calls, [{ p_kind: 'title', p_item_id: 'title_night' }, { p_kind: 'gamefx', p_item_id: null }]);
  assert.deepEqual(await equipCosmetic(fakeClient({ equip_cosmetic: async () => ({ data: null, error: { message: 'not_owned' } }) }), 'title', 'title_pilot'), { ok: false, reason: 'not_owned' });
  assert.deepEqual(await equipCosmetic(fakeClient({}), 'title', 'x'), { ok: false, reason: 'failed' });
});

test('loadEquippedTitles: Map id -> text titulu, bez ptaní se serverem pro prázdný seznam, neznámé a cizí zboží se přeskočí', async () => {
  const calls = [];
  const client = fakeClient({ equipped_titles: async (args) => { calls.push(args); return { data: [{ user_id: 'a', item_id: 'title_pilot' }, { user_id: 'b', item_id: 'gamefx_noir' }, { user_id: 'c', item_id: 'neznamy' }, { item_id: 'title_night' }, null, { user_id: 'd', item_id: 'title_night' }], error: null }; } });
  assert.equal((await loadEquippedTitles(client, [])).size, 0);
  assert.equal((await loadEquippedTitles(client, null)).size, 0);
  assert.equal(calls.length, 0);
  const m = await loadEquippedTitles(client, ['a', 'a', 'b', null, 'c', 'd']);
  assert.deepEqual([...m.entries()], [['a', 'Pilot'], ['d', 'Noční sova']]);
  assert.deepEqual(calls, [{ p_user_ids: ['a', 'b', 'c', 'd'] }], 'každé id jen jednou a bez prázdných');
  assert.equal((await quiet(() => loadEquippedTitles(fakeClient({}), ['a']))).size, 0, 'bez SQL prázdná mapa');
});

test('loadEquippedTitles: velký žebříček se posílá po částech a chyba jedné části neshodí ostatní', async () => {
  const sizes = [];
  const ids = Array.from({ length: 1201 }, (_, i) => `u${i}`);
  const client = fakeClient({ equipped_titles: async ({ p_user_ids: chunk }) => {
    sizes.push(chunk.length);
    if (chunk[0] === 'u500') return { data: null, error: { message: 'boom' } };
    return { data: chunk.filter((id) => id === 'u0' || id === 'u1200').map((id) => ({ user_id: id, item_id: 'title_chess' })), error: null };
  } });
  const m = await quiet(() => loadEquippedTitles(client, ids));
  assert.deepEqual(sizes.sort((a, b) => a - b), [201, 500, 500]);
  assert.deepEqual([...m.entries()].sort(), [['u0', 'Šachista'], ['u1200', 'Šachista']], 'tituly z povedených částí zůstaly');
});

/* ---------------------------------------------------------------- napojení */
test('Games.jsx přebarví hru jen když je nasazený vzhled, filtr bere z obchůdku', () => {
  const games = read('pages', 'Games.jsx');
  assert.match(games, /import \{ useGameFilter \} from '\.\.\/shop\/useGameFilter';/);
  assert.match(games, /const gameFx = useGameFilter\(user\?\.id\);/);
  assert.match(games, /\.\.\.\(gameFx \? \{ filter: gameFx \} : \{\}\)/, 'bez vzhledu se na iframe žádný filtr nepíše');
  const hook = read('shop', 'useGameFilter.js');
  assert.match(hook, /loadMyCosmetics\(supabase\)/);
  assert.match(hook, /gameFilter\(cosmetics\?\.equipped\?\.\[KIND_GAMEFX\]\)/);
  assert.match(hook, /if \(!userId\) \{ setFilter\(''\)/);
});

test('Stránka Odznaky: obchůdek se ukáže jen když je v databázi, zůstatek se bere ze stránky; titul je u jména i v žebříčku Statistik', () => {
  const page = read('pages', 'Badges.jsx');
  assert.match(page, /import \{ Shop \} from '\.\.\/components\/Shop';/);
  assert.match(page, /const tabs = cosmetics \? BADGE_TABS : BADGE_TABS\.filter\(\(t\) => t\.id !== 'shop'\);/);
  assert.match(page, /\{active === 'shop' && cosmetics && \(\s*<Shop/);
  assert.match(page, /coins=\{stats\.jomaridCoins\}/);
  assert.match(page, /onBalance=\{\(balance\) => setStats\(\(prev\) => \(\{ \.\.\.prev, jomaridCoins: balance \}\)\)\}/);
  assert.match(page, /setCosmetics\(mine\.cosmetics\);/);
  const loader = read('stats', 'loadStats.js');
  assert.match(loader, /loadMyCosmetics\(client\)/);
  assert.match(loader, /loadEquippedTitles\(client, allProfiles\.map\(p => p\.id\)\)/);
  assert.match(loader, /title: boardTitles\.get\(p\.id\) \|\| null/);
  const stats = read('pages', 'UserStats.jsx');
  assert.match(stats, /const rowTitle = row\.isMe \? myTitle : row\.title;/, 'vlastní titul se po nasazení ukáže hned, bez nového načtení žebříčku');
  assert.match(stats, /data-testid="own-title"/);
  assert.match(stats, /data-testid="lb-title"/);
  assert.match(stats, /setCosmetics\(mine\.cosmetics\);/);
});

test('Shop.jsx nepoužívá alert, hlásí do stavového řádku a chrání před dvojklikem', () => {
  const shop = read('components', 'Shop.jsx');
  assert.ok(!/\balert\(/.test(shop));
  assert.match(shop, /role="status"/);
  assert.match(shop, /busyRef\.current/);
  assert.match(shop, /data-testid=\{`shop-item-\$\{item\.id\}`\}/);
  assert.match(shop, /shopErrorText\(res\.reason\)/);
});

test('export dat účtu obsahuje herní postup i obchůdek (funkce nemusí v databázi být)', () => {
  const modal = read('components', 'SettingsModal.jsx');
  assert.match(modal, /\{ key: 'game_progress', rpc: 'my_game_progress', optional: true \}/);
  assert.match(modal, /\{ key: 'cosmetics', rpc: 'my_cosmetics', optional: true \}/);
  assert.match(modal, /isMissingFunction\(r\.reason\)/);
});

test('npm test pouští i testy obchůdku a SQL testy obchůdek zahrnují', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:shop'], 'node --test src/tests/shop.test.mjs');
  assert.ok(pkg.scripts.test.includes('npm run test:shop'));
  const run = fs.readFileSync(path.join(DB, 'tests', 'run.sh'), 'utf8');
  assert.ok(run.includes('shop.test.sql'));
});
