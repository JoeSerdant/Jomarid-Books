// Testy skrytého příběhu v Rocketu (sekce STŘEPY v rocket/index.html): texty a jejich návaznost, čisté funkce, chod příběhu v atrapě prohlížeče
// (hvězda, Poutník, zvyky bossů, archiv, finále), skrytost před běžným hráčem a to, že cheat menu skrytý odznak nedá. Samotná hra je plátno,
// to se zkouší v prohlížeči; tady se hlídá logika.
//   npm run test:story
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { getBadge } from '../../../gameRecords/catalog.js';
import { getShopItem } from '../../../shop/catalog.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const block = (name) => html.match(new RegExp(`// <${name}>\\n([\\s\\S]*?)// </${name}>`))[1];
const DATA = block('STORY-DATA');
const ENGINE = block('STORY-ENGINE');
const GUARD = block('STORY-GUARD');
const bossTypes = vm.runInNewContext(html.match(/const BOSS_TYPES = (\[[\s\S]*?\n\]);/)[1]);

// Hodnoty z vm mají jiné prototypy než ty v testu, proto se data a výsledky porovnávají přes prosté kopie
const plain = (v) => JSON.parse(JSON.stringify(v));
const raw = vm.runInNewContext(`${DATA}
({ STORY_SHARDS, STORY_BY_ID, STORY_CAPTAINS, STORY_DEEP, STORY_ROMAN, STORY_STAR_PITY, STORY_STAR_MIN_RUNS, STORY_LINE_BAND, STORY_LINE_RATIO, STORY_LINE_MIN, STORY_ZEN_MS,
  normalizeStory, storyCodeMatches, storyStarPlanned, storyRuleOk, storyRuleLive, storyText, storyEsc, storyPickups })`);
const api = { ...raw, ...plain({ STORY_SHARDS: raw.STORY_SHARDS, STORY_BY_ID: raw.STORY_BY_ID, STORY_CAPTAINS: raw.STORY_CAPTAINS, STORY_DEEP: raw.STORY_DEEP, STORY_ROMAN: raw.STORY_ROMAN }) };
const { STORY_SHARDS, STORY_BY_ID, STORY_CAPTAINS, STORY_DEEP } = api;

const MAIN = ['noise', 'channel', 'wanderer', 'warden', 'prism', 'archon', 'nemesis'];
const CAPTAINS = ['warden', 'prism', 'archon', 'nemesis'];
const found = (...ids) => Object.fromEntries(ids.map((id, i) => [id, i + 1]));

/* ---------------------------------------------------------------- texty a návaznost */
test('střepy: unikátní id a čísla po řadě, římské číslice, každý má název, mluvčího a věty bez HTML', () => {
  assert.equal(STORY_SHARDS.length, 12);
  assert.equal(new Set(STORY_SHARDS.map((s) => s.id)).size, STORY_SHARDS.length);
  STORY_SHARDS.forEach((s, i) => {
    assert.equal(s.no, i + 1, `${s.id}: číslo`);
    assert.ok(api.STORY_ROMAN[i], `${s.id}: římská číslice`);
    assert.ok(s.title.length >= 3 && s.who.length >= 5, s.id);
    assert.ok(s.memory.length >= 3 && s.memory.every((l) => typeof l === 'string' && l.length > 8), `${s.id}: věty`);
    for (const text of [...s.memory, s.margin || '']) {
      assert.doesNotMatch(text, /[<>&"]/, `${s.id}: v textu nemá být HTML`);
      assert.doesNotMatch(text.replace(/\{#\d+\}/g, ''), /[{}#▒◈]/, `${s.id}: jen povolené značky {#n}`);
      assert.doesNotMatch(text, /\s{2,}\S/, `${s.id}: dvojitá mezera`);
    }
  });
});

test('střepy: řetěz návazností: Šum → Kanál → Poutník → čtyři kapitáni v libovolném pořadí → Domov → zbylé střepy', () => {
  const req = (id) => STORY_BY_ID[id].requires;
  assert.deepEqual(req('noise'), []);
  assert.deepEqual(req('channel'), ['noise']);
  assert.deepEqual(req('wanderer'), ['channel']);
  for (const id of CAPTAINS) assert.deepEqual(req(id), ['wanderer'], id);
  assert.deepEqual([...req('home')].sort(), [...CAPTAINS].sort());
  assert.ok(STORY_BY_ID.home.finale);
  for (const s of STORY_SHARDS) for (const r of s.requires) assert.ok(STORY_BY_ID[r].no < s.no, `${s.id} čeká na pozdější střep ${r}`);
  assert.equal(STORY_DEEP.length, 4);
  for (const s of STORY_DEEP) { assert.deepEqual(s.requires, ['home']); assert.ok(s.hint.endsWith('.') && s.deep, s.id); }
  assert.equal(new Set(STORY_DEEP.map((s) => s.deep)).size, 4);
});

test('střepy: každý krok napovídá, kam dál (stopa v poznámce na okraji)', () => {
  const margin = (id) => STORY_BY_ID[id].margin;
  assert.match(margin('noise'), /kanál/i);
  assert.match(margin('noise'), /dole v menu/, 'Šum posílá k poli s číslem verze dole v menu');
  assert.match(margin('channel'), /nech ho dojít/);
  assert.match(margin('channel'), /stůj stranou/, 'a říká, jak: nestřílet nejde, ale jde se vyhnout');
  for (const name of ['Strážkyně', 'Prizma', 'Archont', 'Nemesis']) assert.ok(margin('wanderer').includes(name), name);
  assert.match(margin('wanderer'), /STRÁŽCE/, 'jak se Strážkyni říká ve hře');
  assert.match(margin('nemesis'), /zazářit/i, 'poslední kus posílá do archivu k tlačítku Zazářit');
  assert.match(margin('home'), /v ohni, v tichu, v rychlosti a v prachu/i, 'po finále napovídá čtyři zbylé střepy');
  // kapitáni a jejich zvyky jsou v seznamu pod záznamy
  assert.equal(STORY_CAPTAINS.length, 4);
  for (const s of STORY_CAPTAINS) assert.ok(s.captain.hint.endsWith('.') && s.captain.name && s.captain.alias, s.id);
  // zbylé střepy: každý patří jinému místu ve hře
  const hints = STORY_DEEP.map((s) => s.hint).join(' ');
  for (const word of ['Pekle', 'Zenu', 'Bleskovou vlnu', 'stromu Vzestupu']) assert.ok(hints.includes(word), word);
});

test('kapitáni: úrovně bossů a jména sedí na BOSS_TYPES a zvyky jsou čtyři různé', () => {
  assert.deepEqual(STORY_CAPTAINS.map((s) => s.captain.level), [1, 5, 6, 8]);
  for (const s of STORY_CAPTAINS) assert.equal(bossTypes[s.captain.level - 1].name, s.captain.boss, s.id);
  assert.deepEqual(STORY_CAPTAINS.map((s) => s.captain.rule), ['line', 'beam', 'bare', 'flawless']);
  assert.equal(new Set(STORY_CAPTAINS.map((s) => s.captain.level)).size, 4);
  // třináct Vlaštovek = prvních třináct bossů, čtrnáctý (GLITCH) není loď
  assert.equal(bossTypes.length, 14);
  assert.equal(bossTypes[13].name, 'GLITCH');
  assert.match(STORY_BY_ID.wanderer.memory.join(' '), /Třináct lodí/);
  assert.match(STORY_BY_ID.wanderer.memory.join(' '), /čtrnáctý, kterému říká Chyba/);
  assert.match(STORY_BY_ID.home.memory.join(' '), /třináct/);
});

test('názvy a popis skrytého odznaku a titulu: odznak je za dokončení, titul Majákář se dává zdarma za něj', () => {
  const badge = getBadge('rocket_beacon');
  assert.ok(badge.secret && badge.stat === 'story_end');
  assert.equal(getShopItem('title_majakar').grantedBy, 'rocket_beacon');
  assert.match(STORY_BY_ID.home.memory.join(' '), /Majákáři/, 'titul je v posledním záznamu oslovení');
});

/* ---------------------------------------------------------------- čisté funkce */
test('normalizeStory: nesmysly, přeskočené kroky a rozbité hodnoty se opraví', () => {
  const { normalizeStory } = api;
  const empty = { found: {}, seen: {}, pity: 0, lost: 0, done: false };
  for (const bad of [null, undefined, 5, 'x', [], true]) assert.deepEqual(plain(normalizeStory(bad)), empty);
  // střep platí jen s předchozími: kanál bez šumu a finále bez kapitánů zmizí
  assert.deepEqual(plain(normalizeStory({ found: { channel: 5, home: 9 }, done: true })), empty);
  const n = plain(normalizeStory({ found: { ...found(...MAIN), home: 1700000000000, neznamy: 1 }, seen: { noise: true, home: true, warden: false, nemesis: 1, xx: true }, pity: 5.9, lost: -3, done: true }));
  assert.deepEqual(Object.keys(n.found).sort(), [...MAIN, 'home'].sort(), 'neznámé id se zahodí');
  assert.equal(n.found.home, 1700000000000);
  assert.deepEqual(Object.keys(n.seen).sort(), ['home', 'nemesis', 'noise'], 'přečtené jen u nalezených a jen pravdivé');
  assert.deepEqual([n.pity, n.lost, n.done], [5, 0, true]);
  // done bez finálního střepu neplatí, ani done, které není přesně true
  assert.equal(normalizeStory({ found: found(...MAIN), done: true }).done, false);
  assert.equal(normalizeStory({ found: { ...found(...MAIN), home: 1 }, done: 'ano' }).done, false);
  assert.equal(normalizeStory({ pity: 1e9, lost: 1e9 }).pity, 99);
  assert.equal(normalizeStory({ pity: 1e9, lost: 1e9 }).lost, 9999);
  assert.equal(normalizeStory({ found: { noise: 'ano' } }).found.noise, 1, 'nečíselné datum nalezení');
  // pořadí v hlášení: deep střepy potřebují finále
  assert.deepEqual(Object.keys(normalizeStory({ found: { ...found(...MAIN), fire: 1 } }).found).sort(), [...MAIN].sort());
});

test('Kanál: jméno v2.9 se pozná i bez teček, mezer a velikosti písmen, a na české klávesnici podle kódů kláves (V29)', () => {
  const { storyCodeMatches: ok } = api;
  for (const good of ['v2.9', 'V2.9', 'v 2 . 9', ' V29 ', '2.9', '29', 'v2,9']) assert.equal(ok(good), true, good);
  for (const bad of ['', 'v', 'v2', 'v2.8', 'v3.0', 'v4.0', 'v2.99', 'ahoj', '67MILUJU', 'IMAGINEFLEXITSTVOJIMMENEM', null, undefined, 29.5]) assert.equal(ok(bad), false, String(bad));
  assert.notEqual(ok('vě.í'), true, 'česká klávesnice bez obsluhy kláves napíše písmena s háčky');
});

test('hvězda: objeví se jen kdo ještě nenašel první střep, až po pár bězích, s malou šancí a po sérii bez ní jistě', () => {
  const { storyStarPlanned: plan } = api;
  const fresh = { found: {}, pity: 0 };
  assert.equal(plan(fresh, { runsPlayed: 2 }, 0), false, 'nováček hvězdu nevidí');
  assert.equal(plan(fresh, { runsPlayed: 3 }, 0.11), true);
  assert.equal(plan(fresh, { runsPlayed: 3 }, 0.12), false, 'šance je 12 %');
  assert.equal(plan(fresh, { runsPlayed: 30 }, 0.9), false);
  assert.equal(plan({ found: {}, pity: 8 }, { runsPlayed: 30 }, 0.99), true, 'po osmi bězích bez hvězdy jistě');
  assert.equal(plan({ found: {}, pity: 7 }, { runsPlayed: 30 }, 0.99), false);
  assert.equal(plan({ found: { noise: 1 }, pity: 99 }, { runsPlayed: 30 }, 0), false, 'kdo střep už má, hvězdu nevidí');
  assert.equal(plan(fresh, undefined, 0), false);
});

test('zvyky kapitánů: hranice (linie 80 %, žádný zásah paprskem, žádná bomba ani dar, žádný zásah)', () => {
  const { storyRuleOk: ok, storyRuleLive: live, STORY_LINE_MIN } = api;
  assert.equal(ok('line', { t: 10000, inBand: 8000 }), true);
  assert.equal(ok('line', { t: 10000, inBand: 7999 }), false);
  assert.equal(ok('line', { t: STORY_LINE_MIN - 1, inBand: STORY_LINE_MIN - 1 }), false, 'příliš krátký boj se nepočítá');
  assert.equal(live('line', { t: 100, inBand: 0 }), true, 'na začátku souboje je odpuštění');
  assert.equal(live('line', { t: 5000, inBand: 3000 }), false);
  assert.equal(ok('beam', { beamHits: 0 }), true);
  assert.equal(ok('beam', { beamHits: 1 }), false);
  assert.equal(ok('bare', { bombs: 0, picks: 0 }), true);
  assert.equal(ok('bare', { bombs: 1, picks: 0 }), false);
  assert.equal(ok('bare', { bombs: 0, picks: 1 }), false);
  assert.equal(ok('flawless', { hits: 0 }), true);
  assert.equal(ok('flawless', { hits: 1 }), false);
  assert.equal(ok('neznamy', { hits: 0 }), false);
  assert.equal(ok('line', null), false);
  assert.equal(api.storyPickups({ pickups_heal: 1, pickups_power: 2, pickups_coin: 3 }), 6);
});

test('storyText: vše se escapuje a jen {#n} se změní na zašuměné místo (nejvýš 12 znaků)', () => {
  const { storyText, storyEsc } = api;
  assert.equal(storyEsc('<b>"a" & b</b>'), '&lt;b&gt;&quot;a&quot; &amp; b&lt;/b&gt;');
  assert.equal(storyText('a {#3} b'), 'a <span class="st" style="width:3ch" aria-hidden="true"></span> b');
  assert.equal(storyText('{#99}'), '<span class="st" style="width:12ch" aria-hidden="true"></span>');
  assert.equal(storyText('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(storyText('{#x}'), '{#x}', 'jiné závorky zůstanou textem');
});

/* ---------------------------------------------------------------- chod příběhu v atrapě prohlížeče */
function makeEnv(storyRaw = {}, { stats = {}, tutorialDone = true, game: over = {} } = {}) {
  const els = new Map();
  const mkEl = () => {
    const cls = new Set();
    return {
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle(c, f) { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; } },
      innerText: '', innerHTML: '', className: '', style: {}, dataset: {}, scrollTop: 0, offsetWidth: 0, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [],
    };
  };
  const el = (id) => { if (!els.has(id)) els.set(id, mkEl()); return els.get(id); };
  for (const id of ['story-overlay', 'finale-layer', 'finale-hold', 'finale-done', 'btn-story-finale', 'story-caps', 'story-deep', 'story-preview', 'btn-open-story', 'btn-story-go', 'story-mark']) el(id).classList.add('hidden');
  const document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [] };
  const log = { save: 0, queue: 0, sounds: [], toasts: [], errors: [] };
  const Storage = { data: { tutorialDone, stats: { runsPlayed: 6, bombsUsed: 0, pickups_heal: 0, pickups_power: 0, pickups_coin: 0, ...stats }, story: null }, save() { log.save++; }, queueSave() { log.queue++; } };
  const Sounds = new Proxy({}, { get: (_, k) => (...a) => { log.sounds.push(k); } });
  const Toast = { push: (t) => log.toasts.push(t) };
  class Particle { constructor(x, y) { this.x = x; this.y = y; } }
  class FloatingText { constructor(x, y, text) { this.x = x; this.y = y; this.text = text; } }
  const game = {
    width: 390, height: 780, particles: [], texts: [], bullets: [], enemies: [], player: { x: 195, y: 690 }, boom() {}, resize() {}, runTime: 0, bossActive: false, boss: null,
    bossNoHit: true, mode: 'normal', tutActive: false, whiteFlash: 0, state: 'PLAY', inferno: false, ...over,
  };
  const env = { rnd: 0.5 };
  const M = Object.assign(Object.create(Math), { random: () => env.rnd });
  const sprite = { c: {}, w: 10, h: 10 };
  const Art = { glow: () => sprite, ship: () => sprite, sprite: () => sprite, white: () => sprite, blit() {} };
  const ctx = vm.createContext({ document, Storage, Sounds, Toast, Particle, FloatingText, Math: M, Date, Game: game, UI: { refresh() {} }, BOSS_TYPES: bossTypes, Art, console: { error: (...a) => log.errors.push(a) } });
  vm.runInContext(`const U = ${html.match(/const U = (\{[\s\S]*?\n\});/)[1]};`, ctx);
  vm.runInContext(`${DATA}\n${ENGINE}\nglobalThis.__story = Story; globalThis.__normalize = normalizeStory;`, ctx);
  const Story = ctx.__story;
  // storyRaw: buď uložený tvar ({found, done...}), nebo prostá mapa nalezených střepů s volitelným done
  const toRaw = (x) => { if ('found' in x) return x; const { done, pity, lost, seen, ...ids } = x; return { found: ids, done, pity, lost, seen }; };
  Storage.data.story = ctx.__normalize(toRaw(storyRaw));
  return { Story, Storage, game, log, els, el, env, ctx };
}
const step = (env, n, dt = 16, each) => { for (let i = 0; i < n; i++) { if (each) each(i); env.game.runTime += dt; env.Story.update(dt, env.game); } };
const hasShard = (env, id) => !!env.Story.d().found[id];

test('hvězda: při startu běhu se naplánuje jen podle pravidel, objeví se po čase, a kdo u ní vydrží, dostane Střep I', () => {
  // nováček ani režim bez hvězdy
  let e = makeEnv({}, { stats: { runsPlayed: 2 } }); e.env.rnd = 0; e.Story.onRunStart(e.game);
  assert.equal(e.Story.plan.starAt, null);
  e = makeEnv({}, { tutorialDone: false }); e.env.rnd = 0; e.Story.onRunStart(e.game);
  assert.equal(e.Story.plan.starAt, null, 've výcviku nic');
  for (const mode of ['rush', 'blitz']) { e = makeEnv({}, { game: { mode } }); e.env.rnd = 0; e.Story.onRunStart(e.game); assert.equal(e.Story.plan.starAt, null, mode); }
  // plánuje se v běžném běhu a hvězda se ukáže až po plánovaném čase a ne při bossovi
  e = makeEnv(); e.env.rnd = 0; e.Story.onRunStart(e.game);
  const at = e.Story.plan.starAt;
  assert.ok(at >= 32000 && at <= 68000);
  step(e, 100, 16);
  assert.equal(e.Story.star, null);
  e.game.runTime = at; e.game.bossActive = true; step(e, 1);
  assert.equal(e.Story.star, null, 'během bosse se neukáže');
  e.game.bossActive = false; step(e, 1);
  assert.ok(e.Story.star && e.Story.starShown);
  const s = e.Story.star;
  assert.ok(s.x >= e.game.width * 0.16 && s.x <= e.game.width * 0.84 && s.y >= e.game.height * 0.26 && s.y <= e.game.height * 0.5, 'mimo okraje, zasahuje jen do střední části');
  // vzdálená loď: hvězda se jen stahuje a po 26 s zmizí
  e.game.player.x = 10; e.game.player.y = 700;
  step(e, 120, 16);
  assert.equal(hasShard(e, 'noise'), false);
  step(e, 2000, 16);
  assert.equal(e.Story.star, null, 'po 26 s zmizí');
  assert.equal(e.log.toasts.length, 0);
  // loď u hvězdy: nejdřív se při přerušení stahuje zpět, pak vydrží 1,3 s
  e = makeEnv(); e.env.rnd = 0; e.Story.onRunStart(e.game); e.game.runTime = e.Story.plan.starAt; step(e, 1);
  const star = e.Story.star;
  e.game.player.x = star.x; e.game.player.y = star.y;
  step(e, 40, 16);                                        // ~0,64 s
  assert.ok(e.Story.star.dwell > 500 && !hasShard(e, 'noise'));
  e.game.player.x = 5; step(e, 20, 16);                   // odlétne
  assert.ok(e.Story.star.dwell < 400, 'pokrok se při odchodu rychle vrací');
  e.game.player.x = star.x; step(e, 100, 16);
  assert.ok(hasShard(e, 'noise'), 'vytrvalost se odmění');
  assert.equal(e.Story.star, null);
  assert.equal(e.log.toasts.at(-1).name, 'Střep I: Šum');
  assert.ok(e.log.save >= 1 && e.log.sounds.includes('shard'));
});

test('hvězda: pokazí-li se nález (běh skončí dřív), počítá se série bez hvězdy a po osmi bězích se objeví jistě; nález ji vynuluje', () => {
  const e = makeEnv();
  const run = (time, shown) => { e.Story.onRunStart(e.game); e.Story.starShown = shown; e.game.runTime = time; e.Story.onRunEnd(e.game, true); };
  run(30000, false);                                                        // příliš krátký běh se nepočítá
  assert.equal(e.Story.d().pity, 0);
  for (let i = 1; i <= 3; i++) { run(50000, false); assert.equal(e.Story.d().pity, i); }
  run(50000, true);                                                         // hvězda byla, jen se nechytla: série se vynuluje
  assert.equal(e.Story.d().pity, 0);
  e.Story.onRunEnd(e.game, false);                                         // opuštění bez dohrání (Uložit a odejít) se nepočítá
  assert.equal(e.Story.d().pity, 0);
  e.Story.d().pity = 8; e.env.rnd = 0.99; e.Story.onRunStart(e.game);
  assert.notEqual(e.Story.plan.starAt, null, 'po sérii bez hvězdy jistě');
  e.Story.d().found.noise = 1;
  e.Story.onRunEnd(e.game, true);
  assert.equal(e.Story.d().pity, 8, 'po nálezu se série nepočítá');
});

test('Kanál: slovo v2.9 přijme jen ten, kdo už našel Šum, a jen jednou; otevře archiv na střepu II', () => {
  let e = makeEnv();
  assert.equal(e.Story.onCode('v2.9'), false, 'bez prvního střepu pole nic neřekne');
  assert.equal(hasShard(e, 'channel'), false);
  e = makeEnv(found('noise'));
  assert.equal(e.Story.onCode('v2.8'), false);
  assert.equal(e.Story.onCode('V29'), true);
  assert.ok(hasShard(e, 'channel'));
  assert.equal(e.log.toasts.at(-1).name, 'Střep II: Kanál');
  assert.equal(e.el('story-overlay').classList.contains('hidden'), false, 'archiv se otevřel');
  assert.match(e.el('story-list').innerHTML, /data-shard="channel"/);
  assert.equal(e.Story.onCode('v2.9'), false, 'podruhé už nic');
});

test('Poutník: objeví se v běhu po 20 s, když dojde dolů, dá Střep III; zničený střelami se ve stejném běhu nevrátí; bombám a nepřátelům je vzdálený', () => {
  const base = found('noise', 'channel');
  // dosud nenalezený kanál: Poutník není
  let e = makeEnv(found('noise')); e.Story.onRunStart(e.game); e.game.runTime = 30000; step(e, 2);
  assert.equal(e.Story.actor, null);
  // blitz a rush ne
  for (const mode of ['blitz', 'rush']) { e = makeEnv(base, { game: { mode } }); e.Story.onRunStart(e.game); e.game.runTime = 30000; step(e, 2); assert.equal(e.Story.actor, null, mode); }
  // spravedlivě: nepřijde před 20 s ani při bossovi
  e = makeEnv(base); e.Story.onRunStart(e.game); e.game.runTime = 19000; step(e, 1);
  assert.equal(e.Story.actor, null);
  e.game.runTime = 25000; e.game.bossActive = true; step(e, 1);
  assert.equal(e.Story.actor, null);
  e.game.bossActive = false; step(e, 1);
  assert.ok(e.Story.actor);
  assert.equal(e.game.enemies.length, 0, 'není mezi nepřáteli, takže ho bomba ani konec boje nezasáhnou');
  // dojde dolů: loď stojí stranou
  e.game.player.x = 30; e.game.player.y = 700;
  step(e, 700, 16);
  assert.ok(hasShard(e, 'wanderer'));
  assert.equal(e.Story.actor, null);
  assert.equal(e.Story.d().lost, 0);
  assert.equal(e.log.toasts.at(-1).name, 'Střep III: Poutník');
  // zničený: střely pod ním
  e = makeEnv(base); e.Story.onRunStart(e.game); e.game.runTime = 25000; step(e, 1);
  for (let i = 0; i < 400 && e.Story.actor; i++) {
    const a = e.Story.actor;
    e.game.bullets.push({ x: a.x, y: a.y + 10, r: 4, isEnemy: false });
    e.game.runTime += 16; e.Story.update(16, e.game);
  }
  assert.equal(e.Story.actor, null);
  assert.equal(hasShard(e, 'wanderer'), false);
  assert.equal(e.Story.d().lost, 1);
  assert.ok(e.log.sounds.includes('crack'));
  step(e, 500, 16);
  assert.equal(e.Story.actor, null, 'v tomto běhu už se nevrátí');
  // další běh: znovu
  e.Story.onRunStart(e.game); e.game.runTime = 25000; step(e, 1);
  assert.ok(e.Story.actor, 'v dalším běhu přijde zase');
  // nepřátelské střely mu nic neudělají
  const a = e.Story.actor; e.game.bullets.push({ x: a.x, y: a.y, r: 6, isEnemy: true }); step(e, 1);
  assert.equal(e.Story.actor.hp, 5);
  assert.equal(e.game.bullets.length, 1);
});

function fightEnv(level, name, storyFound = found('noise', 'channel', 'wanderer'), over = {}) {
  const e = makeEnv(storyFound, over);
  e.Story.onRunStart(e.game);
  e.game.boss = { state: 'MOVE', level, name };
  e.game.bossActive = true;
  e.game.bossNoHit = true;
  e.Story.onBossSpawn(e.game, e.game.boss);
  return e;
}

test('Strážkyně (boss 1): střep dá jen boj, v němž loď zůstala v linii uprostřed (80 % času po příletu)', () => {
  let e = fightEnv(1, 'STRÁŽCE');
  assert.ok(e.Story.fight && e.Story.fight.rule === 'line');
  assert.equal(e.el('story-mark').classList.contains('hidden'), false, 'u bosse svítí ukazatel');
  e.game.boss.state = 'ENTRY';
  e.game.player.x = 10; step(e, 100, 16);
  assert.equal(e.Story.fight.t, 0, 'při příletu bosse se čas nepočítá');
  e.game.boss.state = 'MOVE';
  e.game.player.x = 195; step(e, 500, 16);
  e.Story.onBossKilled(e.game);
  assert.ok(hasShard(e, 'warden'));
  assert.equal(e.el('story-mark').classList.contains('hidden'), true);
  // mimo linii
  e = fightEnv(1, 'STRÁŽCE'); e.game.player.x = 20; step(e, 500, 16);
  assert.equal(e.el('story-mark').classList.contains('broken'), true, 'ukazatel pohasne');
  e.Story.onBossKilled(e.game);
  assert.equal(hasShard(e, 'warden'), false);
  // z části v linii: hranice 80 %
  e = fightEnv(1, 'STRÁŽCE'); step(e, 400, 16, (i) => { e.game.player.x = i < 300 ? 195 : 20; });      // 75 %
  e.Story.onBossKilled(e.game);
  assert.equal(hasShard(e, 'warden'), false);
  e = fightEnv(1, 'STRÁŽCE'); step(e, 400, 16, (i) => { e.game.player.x = i < 330 ? 195 : 20; });      // 82,5 %
  e.Story.onBossKilled(e.game);
  assert.ok(hasShard(e, 'warden'));
  // šířka linie je kolem středu: 0,26 šířky na každou stranu
  e = fightEnv(1, 'STRÁŽCE'); e.game.player.x = 195 + 390 * 0.26; step(e, 300, 16); e.Story.onBossKilled(e.game);
  assert.ok(hasShard(e, 'warden'), 'na hranici pásu ještě platí');
  e = fightEnv(1, 'STRÁŽCE'); e.game.player.x = 195 + 390 * 0.26 + 2; step(e, 300, 16); e.Story.onBossKilled(e.game);
  assert.equal(hasShard(e, 'warden'), false);
});

test('Prizma (boss 5): bez zásahu paprskem; ostatní zásahy nevadí', () => {
  let e = fightEnv(5, 'PRIZMA'); step(e, 100, 16);
  e.Story.onHit(e.game, undefined); e.Story.onHit(e.game, 'bullet');
  e.Story.onBossKilled(e.game);
  assert.ok(hasShard(e, 'prism'));
  e = fightEnv(5, 'PRIZMA'); step(e, 10, 16); e.Story.onHit(e.game, 'beam'); step(e, 1, 16);
  assert.equal(e.el('story-mark').classList.contains('broken'), true);
  e.Story.onBossKilled(e.game);
  assert.equal(hasShard(e, 'prism'), false);
});

test('Archont (boss 6): bez bomby a bez sebraného daru od začátku souboje', () => {
  let e = fightEnv(6, 'ARCHONT', undefined, { stats: { bombsUsed: 7, pickups_heal: 3 } });   // dřívější hodnoty nevadí
  step(e, 50, 16); e.Story.onBossKilled(e.game);
  assert.ok(hasShard(e, 'archon'));
  e = fightEnv(6, 'ARCHONT'); step(e, 5, 16); e.Storage.data.stats.bombsUsed++; step(e, 1, 16);
  assert.equal(e.el('story-mark').classList.contains('broken'), true);
  e.Story.onBossKilled(e.game);
  assert.equal(hasShard(e, 'archon'), false);
  for (const key of ['pickups_heal', 'pickups_power', 'pickups_coin']) {
    e = fightEnv(6, 'ARCHONT'); step(e, 5, 16); e.Storage.data.stats[key]++;
    e.Story.onBossKilled(e.game);
    assert.equal(hasShard(e, 'archon'), false, key);
  }
  // bomba, která bosse zabije, se do zvyku počítá taky (syncFight při zabití)
  e = fightEnv(6, 'ARCHONT'); step(e, 5, 16); e.Storage.data.stats.bombsUsed++; e.Story.onBossKilled(e.game);
  assert.equal(hasShard(e, 'archon'), false);
});

test('Nemesis (boss 8): bez jediného zásahu (jako odznak „Bez škrábnutí“)', () => {
  let e = fightEnv(8, 'NEMESIS'); step(e, 50, 16); e.Story.onBossKilled(e.game);
  assert.ok(hasShard(e, 'nemesis'));
  e = fightEnv(8, 'NEMESIS'); step(e, 5, 16); e.game.bossNoHit = false; step(e, 1, 16);
  assert.equal(e.el('story-mark').classList.contains('broken'), true);
  e.Story.onBossKilled(e.game);
  assert.equal(hasShard(e, 'nemesis'), false);
});

test('bossové mimo příběh: bez ukazatele a beze střepu; výcvik, jiný boss a nesplněný postup také', () => {
  let e = fightEnv(2, 'ÚLOVEC');
  assert.equal(e.Story.fight, null);
  assert.equal(e.el('story-mark').classList.contains('hidden'), true);
  e = fightEnv(1, 'STRÁŽCE', found('noise', 'channel'));            // Poutník ještě nebyl: kapitáni mlčí
  assert.equal(e.Story.fight, null);
  e = fightEnv(1, 'STRÁŽCE', undefined, { game: { tutActive: true } });
  assert.equal(e.Story.fight, null, 've výcviku ne');
  // správná úroveň, ale špatný boss (GLITCH se opakuje od 14. úrovně, ale nikdy neponese střep)
  e = fightEnv(8, 'ODSTŘELOVAČ'); assert.equal(e.Story.fight, null);
  // už nalezený střep se nehledá znovu
  e = fightEnv(1, 'STRÁŽCE', { ...found('noise', 'channel', 'wanderer'), warden: 9 });
  assert.equal(e.Story.fight, null);
  // zabití bosse bez souboje o střep nic neudělá
  e = fightEnv(3, 'TRHÁČ'); e.Story.onBossKilled(e.game);
  assert.equal(e.log.toasts.length, 0);
});

test('zbylé střepy: dají se získat až po finále, každý jinde (Peklo, Zen, Blesková vlna, strom Vzestupu)', () => {
  const done = { ...found(...MAIN), home: 99, done: true };
  // před finále ne
  let e = fightEnv(1, 'STRÁŽCE', found(...MAIN.slice(0, 3)), { game: { inferno: true } });
  e.Story.onBossKilled(e.game);
  assert.equal(hasShard(e, 'fire'), false);
  // Oheň: boss v Pekle nebo Insane Pekle (game.inferno je pro oba)
  e = fightEnv(2, 'ÚLOVEC', done, { game: { inferno: true } }); e.Story.onBossKilled(e.game);
  assert.ok(hasShard(e, 'fire'));
  e = fightEnv(2, 'ÚLOVEC', done); e.Story.onBossKilled(e.game);
  assert.equal(hasShard(e, 'fire'), false, 'v normální hře ne');
  // Ticho: pět minut v Zenu
  e = makeEnv(done, { game: { mode: 'zen' } }); e.game.runTime = api.STORY_ZEN_MS - 1000; step(e, 1, 16);
  assert.equal(hasShard(e, 'silence'), false);
  e.game.runTime = api.STORY_ZEN_MS; step(e, 1, 16);
  assert.ok(hasShard(e, 'silence'));
  e = makeEnv(done, { game: { mode: 'normal' } }); e.game.runTime = 9e6; step(e, 1, 16);
  assert.equal(hasShard(e, 'silence'), false, 'jen v Zenu');
  // Dech: Blesková vlna do konce bez bomby
  e = makeEnv(done, { game: { mode: 'blitz' } }); e.Story.onRunStart(e.game); e.Story.onRunEnd(e.game, true, 'timeup');
  assert.ok(hasShard(e, 'breath'));
  e = makeEnv(done, { game: { mode: 'blitz' } }); e.Story.onRunStart(e.game); e.Storage.data.stats.bombsUsed++; e.Story.onRunEnd(e.game, true, 'timeup');
  assert.equal(hasShard(e, 'breath'), false, 'bomba ho zruší');
  e = makeEnv(done, { game: { mode: 'blitz' } }); e.Story.onRunStart(e.game); e.Story.onRunEnd(e.game, true, 'death');
  assert.equal(hasShard(e, 'breath'), false, 'smrt není dokončená vlna');
  e = makeEnv(done, { game: { mode: 'normal' } }); e.Story.onRunStart(e.game); e.Story.onRunEnd(e.game, true, 'timeup');
  assert.equal(hasShard(e, 'breath'), false, 'jen Blesková vlna');
  // Prach: utracený hvězdný prach ve stromu Vzestupu
  e = makeEnv(done); e.Story.onStardustSpent();
  assert.ok(hasShard(e, 'dust'));
  e = makeEnv(found(...MAIN)); e.Story.onStardustSpent();
  assert.equal(hasShard(e, 'dust'), false, 'před finále ne');
});

test('archiv: ukazuje jen nalezené střepy, nepřečtené označí, kapitány a zbylé střepy odhalí až po svém kroku; náhled ukáže všechno', () => {
  let e = makeEnv(found('noise'));
  e.Story.openArchive('menu', false);
  let list = e.el('story-list').innerHTML;
  assert.match(list, /data-shard="noise"/);
  assert.match(list, /new-dot/, 'nepřečtený má tečku');
  assert.doesNotMatch(list, /Kanál|Poutník|Strážkyně|Majákář/, 'další střepy v seznamu nejsou ani jejich název');
  assert.equal(e.el('story-caps').classList.contains('hidden'), true);
  assert.equal(e.el('story-deep').classList.contains('hidden'), true);
  assert.equal(e.el('btn-story-finale').classList.contains('hidden'), true);
  assert.equal(e.el('story-preview').classList.contains('hidden'), true);
  assert.equal(e.Story.d().seen.noise, true, 'první nepřečtený se rovnou rozbalí a označí jako přečtený');
  assert.equal(e.el('menu-overlay').classList.contains('hidden'), true, 'menu se schová');
  e.Story.closeArchive();
  assert.equal(e.el('story-overlay').classList.contains('hidden'), true);
  assert.equal(e.el('menu-overlay').classList.contains('hidden'), false);
  // po Poutníkovi: seznam zvyků kapitánů s jejich podmínkami
  e = makeEnv(found('noise', 'channel', 'wanderer'));
  e.Story.openArchive('menu', false);
  assert.equal(e.el('story-caps').classList.contains('hidden'), false);
  const caps = e.el('story-caps').innerHTML;
  for (const s of STORY_CAPTAINS) { assert.ok(caps.includes(s.captain.name), s.id); assert.ok(caps.includes(s.captain.hint), `${s.id}: zvyk`); }
  assert.ok(caps.includes('pro Systém STRÁŽCE') && !caps.includes('pro Systém PRIZMA'), 'přezdívka se ukáže jen u Strážkyně');
  assert.equal(e.el('btn-story-finale').classList.contains('hidden'), true);
  // všichni čtyři kapitáni: tlačítko Zazářit
  e = makeEnv(found(...MAIN)); e.Story.openArchive('menu', false);
  assert.equal(e.el('btn-story-finale').classList.contains('hidden'), false);
  assert.equal(e.el('story-deep').classList.contains('hidden'), true, 'zbylé střepy až po finále');
  // po finále: zbylé střepy se stopami, nalezený ukáže název
  e = makeEnv({ ...found(...MAIN), home: 9, silence: 10, done: true }); e.Story.openArchive('menu', false);
  assert.equal(e.el('story-deep').classList.contains('hidden'), false);
  const deep = e.el('story-deep').innerHTML;
  assert.ok(deep.includes('Ticho') && !deep.includes('Oheň') && !deep.includes('Dech') && !deep.includes('Prach'), 'název jen u nalezeného');
  for (const s of STORY_DEEP.filter((x) => x.id !== 'silence')) assert.ok(deep.includes(s.hint), `${s.id}: stopa`);
  assert.equal(e.el('btn-story-finale').classList.contains('hidden'), true, 'finále je splněné');
  // náhled: všech dvanáct, banner, tlačítko, nic se nezapíše
  e = makeEnv({}); e.Story.openArchive('menu', true);
  assert.equal((e.el('story-list').innerHTML.match(/data-shard=/g) || []).length, 12);
  assert.equal(e.el('story-preview').classList.contains('hidden'), false);
  assert.equal(e.el('btn-story-finale').classList.contains('hidden'), false);
  assert.deepEqual(plain(e.Story.d().seen), {});
  assert.equal(e.log.queue + e.log.save, 0);
});

test('archiv má vlastní stav: mezerník ani Enter pod ním nespustí hru, a po zavření se vrátí menu nebo konec hry', () => {
  let e = makeEnv(found('noise'), { game: { state: 'MENU' } });
  e.Story.openArchive('menu', false);
  assert.equal(e.game.state, 'ARCHIVE');
  e.Story.closeArchive();
  assert.equal(e.game.state, 'MENU');
  e = makeEnv(found('noise'), { game: { state: 'GAMEOVER' } });
  e.Story.openArchive('gameover', false);
  assert.equal(e.game.state, 'ARCHIVE');
  assert.equal(e.el('gameover-overlay').classList.contains('hidden'), true);
  e.Story.closeArchive();
  assert.equal(e.game.state, 'GAMEOVER');
  assert.equal(e.el('gameover-overlay').classList.contains('hidden'), false, 'konec hry zase vidět');
  // klávesa Enter/Space spouští hru jen v menu a po skončení hry (stavy MENU a GAMEOVER), tedy ne v archivu
  assert.match(html, /if \(this\.state === 'MENU'\) this\.start\('normal'\);\s*else if \(this\.state === 'GAMEOVER'\) this\.start\(this\.mode\);/);
});

test('tlačítka Střepy: skrytá, dokud hráč nenašel první střep; po nálezu se ukážou a svítí, dokud něco není přečtené', () => {
  let e = makeEnv(); e.Story.refreshButtons();
  for (const id of ['btn-open-story', 'btn-story-go']) { assert.equal(e.el(id).classList.contains('hidden'), true, id); assert.equal(e.el(id).classList.contains('unread'), false); }
  e = makeEnv(found('noise')); e.Story.refreshButtons();
  for (const id of ['btn-open-story', 'btn-story-go']) { assert.equal(e.el(id).classList.contains('hidden'), false, id); assert.equal(e.el(id).classList.contains('unread'), true, id); }
  e.Story.d().seen.noise = true; e.Story.refreshButtons();
  assert.equal(e.el('btn-open-story').classList.contains('unread'), false);
});

test('finále: začne jen se všemi čtyřmi kapitány; držení a poklepání nabíjí a bez držení se nabití vrací', () => {
  let e = makeEnv(found('noise', 'channel', 'wanderer', 'warden'));
  e.Story.startFinale();
  assert.equal(e.Story.fin, null, 'bez všech kapitánů se nespustí');
  e = makeEnv(found(...MAIN));
  assert.equal(e.Story.canFinale(), true);
  e.Story.openArchive('menu', false);
  e.Story.startFinale();
  assert.ok(e.Story.fin && e.game.state === 'FINALE');
  assert.equal(e.el('finale-layer').classList.contains('hidden'), false);
  assert.equal(e.el('story-overlay').classList.contains('hidden'), true);
  const run = (ms) => { for (let t = 0; t < ms; t += 50) e.Story.finaleUpdate(50); };
  run(2000);
  assert.equal(e.Story.fin.phase, 'intro');
  assert.equal(e.el('finale-hold').classList.contains('hidden'), true, 'tlačítko až po úvodu');
  e.Story.finaleHold(true);
  assert.equal(e.Story.fin.holding, false, 'v úvodu se držet nedá');
  run(4200);
  assert.equal(e.Story.fin.phase, 'charge');
  assert.equal(e.el('finale-hold').classList.contains('hidden'), false);
  e.Story.finaleHold(true); e.Story.finaleHold(false);
  const tapped = e.Story.fin.charge;
  assert.ok(tapped > 0 && tapped < 0.2, 'poklepání přidá kousek, ať to jde i bez držení');
  run(1000);
  assert.ok(e.Story.fin.charge < tapped, 'bez držení nabití slábne');
  e.Story.finaleHold(true);
  run(1500);
  assert.equal(e.Story.fin.phase, 'charge', 'půl nabití ještě nestačí');
  assert.ok(e.Story.fin.charge > 0.3 && e.Story.fin.charge < 0.7);
  run(2500);
  assert.equal(e.Story.fin.phase, 'answer', 'tři vteřiny držení Zrcadlo rozzáří');
  assert.equal(e.Story.fin.holding, false);
});

test('finále: celý průběh od držení po Dokončit a zápis příběhu (a náhled nezapisuje nic)', () => {
  const play = (e, finish = true) => {
    e.Story.openArchive('menu', e.preview);
    e.Story.startFinale();
    const run = (ms, hold) => { if (hold !== undefined) e.Story.finaleHold(hold); for (let t = 0; t < ms; t += 50) e.Story.finaleUpdate(50); };
    run(6200);
    assert.equal(e.Story.fin.phase, 'charge');
    run(4000, true);
    assert.equal(e.Story.fin.phase, 'answer');
    assert.equal(e.el('finale-hold').classList.contains('hidden'), true);
    assert.equal(e.Story.fin.answered, true);
    e.Story.finaleHold(true);
    assert.equal(e.Story.fin.holding, false, 'po odpovědi držet nejde');
    run(4600);
    assert.equal(e.Story.fin.phase, 'home');
    run(13200);
    assert.equal(e.Story.fin.phase, 'keeper');
    assert.equal(e.Story.fin.landed, 13, 'přistálo třináct lodí');
    run(15000);
    assert.equal(e.el('finale-done').classList.contains('hidden'), false, 'na konci tlačítko Dokončit');
    if (finish) e.Story.finishFinale();
  };
  const e = makeEnv(found(...MAIN));
  play(e);
  assert.ok(e.Story.d().done && hasShard(e, 'home'));
  assert.equal(e.game.state, 'ARCHIVE', 'po finále se otevře archiv');
  assert.equal(e.Story.fin, null);
  assert.ok(e.log.save >= 1, 'postup se uložil (a tím ohlásil serveru)');
  assert.equal(e.log.toasts.at(-1).name, 'Střep VIII: Domov');
  assert.equal(e.el('story-overlay').classList.contains('hidden'), false, 'archiv se otevřel na posledním střepu');
  assert.equal(e.Story.canFinale(), false, 'hotovo se nedá zopakovat do zápisu');
  // náhled z cheat menu: stejná cesta, ale bez zápisu a bez odznaku
  const p = makeEnv({}); p.preview = true; p.Story.preview = true;
  p.Story.openArchive('menu', true); p.Story.startFinale();
  for (let t = 0; t < 6200; t += 50) p.Story.finaleUpdate(50);
  p.Story.finaleHold(true);
  for (let t = 0; t < 4000; t += 50) p.Story.finaleUpdate(50);
  for (let t = 0; t < 40000; t += 50) p.Story.finaleUpdate(50);
  p.Story.finishFinale();
  assert.equal(p.Story.d().done, false);
  assert.deepEqual(plain(p.Story.d().found), {});
  assert.equal(p.log.save, 0);
  assert.equal(p.log.toasts.length, 0);
  assert.equal(p.game.state, 'ARCHIVE');
  p.Story.closeArchive();
  assert.equal(p.game.state, 'MENU');
});

test('finále: Přerušit před odpovědí nic nezapíše, Přeskočit po odpovědi příběh dokončí', () => {
  let e = makeEnv(found(...MAIN)); e.Story.openArchive('menu', false); e.Story.startFinale();
  for (let t = 0; t < 3000; t += 50) e.Story.finaleUpdate(50);
  e.Story.skipFinale();
  assert.equal(e.Story.d().done, false);
  assert.equal(e.Story.fin, null);
  assert.equal(e.game.state, 'ARCHIVE');
  assert.equal(e.el('story-overlay').classList.contains('hidden'), false, 'zpátky v archivu, odkud šel');
  e.Story.closeArchive();
  assert.equal(e.game.state, 'MENU');
  e = makeEnv(found(...MAIN)); e.Story.openArchive('menu', false); e.Story.startFinale();
  for (let t = 0; t < 6200; t += 50) e.Story.finaleUpdate(50);
  e.Story.finaleHold(true);
  for (let t = 0; t < 4000; t += 50) e.Story.finaleUpdate(50);
  assert.equal(e.Story.fin.answered, true);
  e.Story.skipFinale();
  assert.ok(e.Story.d().done, 'po odpovědi se přeskočení počítá jako dokončené');
});

/* ---------------------------------------------------------------- kreslení a pojistka proti pádu */
// Plátno, které se chová jako skutečné tam, kde skutečné vyhodí výjimku (záporný poloměr, nekonečné souřadnice) nebo tiše ignoruje vadnou hodnotu
// (průhlednost mimo 0 až 1). Výjimka při kreslení v hlavní smyčce hru zmrazí, proto se kreslení zkouší po celou dobu příběhu.
function strictCanvas() {
  const bad = [];
  const finite = (...a) => a.every((n) => Number.isFinite(n));
  const grad = { addColorStop(o) { if (!(o >= 0 && o <= 1)) bad.push(`addColorStop ${o}`); } };
  const alphaOf = (v) => { const m = /^rgba\(.*,\s*([-\d.e]+)\)$/.exec(String(v)); return m ? Number(m[1]) : null; };
  const ctx = new Proxy({}, {
    get(_, k) {
      switch (k) {
        case 'arc': return (x, y, r) => { if (!finite(x, y, r) || r < 0) bad.push(`arc ${x},${y},${r}`); };
        case 'createLinearGradient': return (...a) => { if (!finite(...a)) bad.push(`linear ${a}`); return grad; };
        case 'createRadialGradient': return (...a) => { if (!finite(...a) || a[2] < 0 || a[5] < 0) bad.push(`radial ${a}`); return grad; };
        case 'drawImage': return (img, ...a) => { if (!finite(...a)) bad.push(`drawImage ${a}`); };
        case 'fillRect': case 'translate': case 'rotate': case 'moveTo': case 'lineTo': return (...a) => { if (!finite(...a)) bad.push(`${String(k)} ${a}`); };
        default: return () => {};
      }
    },
    set(_, k, v) {
      if (k === 'globalAlpha' && !(v >= 0 && v <= 1)) bad.push(`globalAlpha ${v}`);
      if ((k === 'fillStyle' || k === 'strokeStyle') && typeof v === 'string') { const a = alphaOf(v); if (a !== null && !(a >= 0 && a <= 1)) bad.push(`${String(k)} ${v}`); }
      if (k === 'lineWidth' && !(v > 0)) bad.push(`lineWidth ${v}`);
      return true;
    },
  });
  return { ctx, bad };
}

test('finále se po celou dobu vykreslí bez výjimky a bez vadných hodnot (záporný poloměr kruhu dřív hru zmrazil při rozsvícení majáku)', () => {
  for (const [w, h] of [[390, 780], [320, 568], [620, 900]]) {
    const e = makeEnv(found(...MAIN), { game: { width: w, height: h } });
    const { ctx, bad } = strictCanvas();
    e.Story.openArchive('menu', false);
    e.Story.startFinale();
    let frames = 0, reachedKeeper = 0;
    // snímek po snímku jako ve skutečné smyčce (16 ms): úvod, držení, odpověď, přistání, poslední záznam
    for (let t = 0; t < 70000 && e.Story.fin; t += 16) {
      if (e.Story.fin.phase === 'charge' && !e.Story.fin.holding) e.Story.finaleHold(true);
      e.Story.finaleUpdate(16);
      e.Story.finaleDraw(ctx);
      frames++;
      if (e.Story.fin.phase === 'keeper') reachedKeeper++;
    }
    assert.deepEqual(bad, [], `${w}x${h}: vadné kreslení`);
    assert.ok(frames > 3000 && reachedKeeper > 500, `${w}x${h}: celá časová osa se prošla (${frames} snímků, ${reachedKeeper} v posledním záznamu)`);
    assert.equal(e.Story.off, false);
    assert.deepEqual(e.log.errors, []);
  }
  // krátké snímky (rychlý monitor) i dlouhé (100 ms, nejvíc, co hra povolí) dopadnou stejně
  for (const dt of [4, 33, 100]) {
    const e = makeEnv(found(...MAIN));
    const { ctx, bad } = strictCanvas();
    e.Story.openArchive('menu', false); e.Story.startFinale();
    for (let t = 0; t < 70000 && e.Story.fin; t += dt) {
      if (e.Story.fin.phase === 'charge' && !e.Story.fin.holding) e.Story.finaleHold(true);
      e.Story.finaleUpdate(dt); e.Story.finaleDraw(ctx);
    }
    assert.deepEqual(bad, [], `snímek ${dt} ms`);
  }
});

test('hvězda, Poutník a linie se vykreslí bez vadných hodnot ve všech stavech (dotyk hvězdy, konec života, zásah Poutníka, okraje linie)', () => {
  const e = makeEnv(found('noise', 'channel', 'wanderer'));
  const { ctx, bad } = strictCanvas();
  for (const t of [0, 100, 1500, 12000, 25000, 26000]) for (const life of [26000, 1500, 100, 0]) for (const dwell of [0, 1, 650, 1299]) {
    e.Story.drawStar(ctx, { x: 100, y: 300, t, life, dwell });
  }
  for (const flash of [0, 160]) for (const tt of [0, 1200, 2399, 5000]) e.Story.drawWanderer(ctx, { x: 50, y: 400, t: tt, flash, hp: 5 });
  for (const x of [0, 195, 390, 1e4]) { e.game.player.x = x; e.Story.drawBand(ctx, e.game); }
  assert.deepEqual(bad, []);
});

test('pojistka: výjimka v příběhu hru nezastaví, příběh se vypne a rozehrané finále skončí v menu', () => {
  // běh hry: chyba při aktualizaci hvězdy
  let e = makeEnv(); vm.runInContext(GUARD, e.ctx);
  e.Story.star = { x: 10, y: 10, t: 0, life: 1000, dwell: 0 };
  e.Story.updateStar = () => { throw new Error('rozbité'); };
  assert.doesNotThrow(() => e.Story.update(16, e.game));
  assert.equal(e.Story.off, true);
  assert.equal(e.Story.star, null);
  assert.equal(e.log.errors.length, 1);
  assert.equal(e.Story.update(16, e.game), undefined, 'po vypnutí se nic nevolá');
  assert.equal(e.log.errors.length, 1);
  assert.equal(e.Story.onBossSpawn(e.game, { level: 1, name: 'STRÁŽCE' }), undefined);
  assert.equal(e.el('story-mark').classList.contains('hidden'), true);
  // finále: chyba při kreslení
  e = makeEnv(found(...MAIN)); vm.runInContext(GUARD, e.ctx);
  e.Story.openArchive('menu', false); e.Story.startFinale();
  assert.equal(e.game.state, 'FINALE');
  Object.defineProperty(e.game, 'width', { get() { throw new Error('rozbité kreslení'); } });
  const { ctx } = strictCanvas();
  assert.doesNotThrow(() => e.Story.finaleDraw(ctx));
  assert.equal(e.Story.off, true);
  assert.equal(e.Story.fin, null);
  assert.equal(e.game.state, 'MENU', 'hra se vrátí do menu, ne do zamrzlého finále');
  assert.equal(e.el('finale-layer').classList.contains('hidden'), true);
  assert.equal(e.el('menu-overlay').classList.contains('hidden'), false);
  assert.equal(e.Story.startFinale(), undefined);
  assert.equal(e.Story.fin, null, 'vypnutý příběh finále nespustí');
  assert.equal(hasShard(e, 'home'), false, 'rozbité finále nic nezapíše');
});

test('pojistka: všechna volání příběhu z herní smyčky jsou obalená, ostatní jsou obsluha tlačítek (její výjimka smyčku nezastaví)', () => {
  const guarded = GUARD.match(/\[('onRunStart'[^\]]*)\]\.forEach\(wrap\)/)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.deepEqual(guarded.sort(), ['drawBack', 'drawFront', 'finaleDraw', 'finaleUpdate', 'onBossKilled', 'onBossSpawn', 'onHit', 'onRunEnd', 'onRunStart', 'onStardustSpent', 'refreshButtons', 'update']);
  const handlers = new Set(['openArchive', 'closeArchive', 'startFinale', 'skipFinale', 'finaleHold', 'finishFinale', 'onCode', 'available', 'toggleShard']);
  const used = new Set([...html.replace(ENGINE, '').replace(GUARD, '').matchAll(/\bStory\.(\w+)\(/g)].map((m) => m[1]));
  for (const name of used) assert.ok(guarded.includes(name) || handlers.has(name), `Story.${name} se volá bez pojistky`);
  for (const name of guarded) assert.ok(used.has(name), `Story.${name} je obalená, ale hra ji nevolá`);
  assert.match(ENGINE, /\n    fail\(err\) \{/);
});

/* ---------------------------------------------------------------- skrytost, napojení a cheaty (zdroj hry) */
test('skrytost: nic z příběhu není v menu vidět, dokud se nenajde první střep (prvky jsou hidden a text se vykresluje až z dat)', () => {
  const tag = (id) => html.match(new RegExp(`<[^>]*\\bid="${id}"[^>]*>`))[0];
  for (const id of ['btn-open-story', 'btn-story-go', 'story-overlay', 'finale-layer', 'story-mark', 'finale-hold', 'finale-done', 'btn-story-finale', 'story-caps', 'story-deep', 'story-preview']) {
    assert.match(tag(id), /class="[^"]*\bhidden\b/, `${id} je schovaný`);
  }
  // texty příběhu nejsou v žádném HTML prvku ve stránce, jen v datech skriptu
  const body = html.slice(html.indexOf('<body>'), html.indexOf('<script>', html.indexOf('<body>')));
  for (const word of ['Majákář', 'Vlaštovky', 'Poutník', 'Zrcadlo', 'Směrnice']) assert.ok(!body.includes(word), `${word} není v HTML stránky`);
  // znaky, které by se na části telefonů vykreslily jako čtvereček
  assert.doesNotMatch(html, /[◈▒]/);
  // hra o příběhu nic nenapoví v nápovědě, při smazání postupu ani v bridgi
  const bridge = html.slice(html.indexOf('/* JOMARID-BRIDGE */'), html.indexOf('</script>', html.indexOf('/* JOMARID-BRIDGE */')));
  assert.doesNotMatch(bridge, /story|střep/i);
  assert.doesNotMatch(html.match(/<div class="hint">[\s\S]*?<\/div>/)[0], /střep|příběh|story/i);
});

test('napojení do hry: háčky ve správných místech a skrytý odznak se hlásí jen po dokončení', () => {
  assert.match(html, /this\.resetGameData\(\);\s*Story\.onRunStart\(this\);/);
  assert.match(html, /this\.player\.update\(dt, this\.input, this\);\s*Story\.update\(dt, this\);/);
  assert.match(html, /Story\.onBossSpawn\(this, this\.boss\);/);
  assert.match(html, /if \(!this\.tutActive\) \{\s*Story\.onBossKilled\(this\);/);
  assert.match(html, /damagePlayer\(amount, iframes, piercing, fromBoss, source\) \{[\s\S]*?Story\.onHit\(this, source\);/);
  assert.match(html, /this\.damagePlayer\(14, 620, false, true, 'beam'\)/, 'zásah paprskem se hlásí příběhu');
  assert.match(html, /Story\.onRunEnd\(this, true, effectiveReason\);\s*Relics\.check\(\);/);
  assert.match(html, /Story\.onRunEnd\(this, false\);/);
  assert.match(html, /this\.renderShop\('pause-shop'\);\s*Story\.refreshButtons\(\);/);
  assert.match(html, /Storage\.data\.prestige\[id\] = node\.unlock \? true : lvl \+ 1;\s*Storage\.save\(\);\s*Sounds\.buy\(\);\s*Story\.onStardustSpent\(\);/);
  assert.match(html, /Story\.drawBack\(ctx, this\);/);
  assert.match(html, /Story\.drawFront\(ctx\);/);
  assert.match(html, /if \(this\.state === 'FINALE'\) Story\.finaleUpdate\(dt\);/);
  assert.match(html, /else if \(this\.state === 'FINALE'\) \{\s*Story\.finaleDraw\(ctx\);/);
  assert.match(html, /this\.data\.story = normalizeStory\(this\.data\.story\);/);
  assert.match(html, /story: \{ found: \{\}, seen: \{\}, pity: 0, lost: 0, done: false \}/);
  // Story.collect se volá jen uvnitř příběhu
  assert.doesNotMatch(html.replace(ENGINE, ''), /Story\.collect\(/);
  // hlášení serveru: jen dokončený příběh, hned
  const rec = html.match(/function reportRecords\(\) \{[\s\S]*?\n\}\n/)[0];
  assert.match(rec, /if \(d\.story && d\.story\.done\) jomaridRecord\('story_end', 1, true\);/);
  assert.equal((rec.match(/story_end/g) || []).length, 1);
  // jiné statistiky se příběhu netýkají a katalog stat nemá žádnou, kterou by příběh počítal po částech
  assert.doesNotMatch(html.match(/const TRACKED_STATS = \[[\s\S]*?\];/)[0], /story|shard|step/);
});

test('cheat menu skrytý odznak nedá: žádný cheat nezapisuje do příběhu, jen náhled bez zápisu', () => {
  const cheats = html.match(/const CHEATS = \{[\s\S]*?\n\};/)[0];
  assert.match(cheats, /story: \(\) => \{ closeCheatMenu\(\); Story\.openArchive\('menu', true\); return ''; \}/);
  assert.doesNotMatch(cheats.replace(/story: \(\) => \{[^\n]*\n/, ''), /Story|story/, 'ostatní cheaty o příběhu nic nevědí');
  assert.doesNotMatch(html.match(/const CHEAT_STATS = \{[^}]*\};/)[0], /story/);
  assert.match(html, /data-cheat="story"/);
  // v náhledu se nikdy nic nesbírá a nezapisuje: sbírání jde jen přes available(), které v náhledu nikdo nevolá, a zápis konce hlídá f.preview
  const engine = ENGINE.replace(/\s+/g, ' ');
  assert.match(engine, /if \(!f\.preview && this\.available\('home'\)\)/);
  assert.match(engine, /markSeen\(id\) \{ if \(this\.preview\) return;/);
});

test('mobil i počítač: finále se ovládá držením tlačítka dotykem, myší i klávesou (mezerník, Enter) a tlačítko neposouvá stránku ani nevolá nabídku', () => {
  assert.match(html, /finaleHold\.addEventListener\('pointerdown', e => \{\s*e\.preventDefault\(\);/);
  assert.match(html, /\['pointerup', 'pointercancel', 'lostpointercapture'\]\.forEach\(ev => finaleHold\.addEventListener\(ev, \(\) => Story\.finaleHold\(false\)\)\)/);
  assert.match(html, /finaleHold\.addEventListener\('contextmenu', e => e\.preventDefault\(\)\)/);
  assert.match(html, /Game\.state === 'FINALE' && \(e\.code === 'Space' \|\| e\.code === 'Enter'\) && !e\.repeat/);
  assert.match(html, /\.finale-hold \{[^}]*touch-action: none;[^}]*-webkit-touch-callout: none;/);
  assert.match(html, /\.shard-head \{[^}]*min-height: 46px;/, 'cíl pro prst je dost velký');
  // česká klávesnice: číslice podle kódu klávesy i pro jméno v2.9
  assert.match(html, /else if \(keyBuf\.endsWith\('V29'\) && Story\.available\('channel'\)\) \{/);
  assert.match(html, /if \(Story\.onCode\(code\)\) \{[\s\S]*?secretInput\.value = '';/);
  assert.match(html, /secretInput\.addEventListener\('focus', \(\) => \{\s*if \(Story\.available\('channel'\)\)/);
  // Escape zavře archiv
  assert.match(html, /e\.code === 'Escape' && !document\.getElementById\('story-overlay'\)\.classList\.contains\('hidden'\)\) Story\.closeArchive\(\)/);
});

test('po finále Jomarid svítí: pozadí kreslí světla měst jen u hráče, který příběh dokončil, a mají stejné rozložení jako ve finále', () => {
  assert.match(html, /if \(Storage\.data\.story && Storage\.data\.story\.done\) \{\s*const warm = /);
  // stejné semínko, stejný generátor a stejné pořadí hodnot: světla ve finále a v pozadí sedí na sebe
  const gen = /let seed = 11;\s*const rnd = \(\) => \(seed = \(seed \* 16807\) % 2147483647\) \/ 2147483647;/;
  assert.match(html, gen);
  assert.match(ENGINE, gen);
  assert.match(html, /const a = rnd\(\) \* Math\.PI \* 2, rr = Math\.sqrt\(rnd\(\)\) \* 0\.92, sz = 0\.6 \+ rnd\(\) \* 1\.1;\s*base\.g\.fillRect\(px \+ Math\.cos\(a \+ 2\.4\)/);
  assert.match(ENGINE, /const a = rnd\(\) \* Math\.PI \* 2, r = Math\.sqrt\(rnd\(\)\) \* 0\.92; return \{ a, r, s: 0\.6 \+ rnd\(\) \* 1\.1 \};/);
  assert.match(ENGINE, /Math\.cos\(L\.a \+ 2\.4\)/);
  assert.match(html, /for \(let i = 0; i < 46; i\+\+\)/);
  assert.match(ENGINE, /length: 46/);
});
