// Testy skrytého příběhu v Rocketu (sekce STŘEPY v rocket/index.html): texty a jejich návaznost, čisté funkce, chod příběhu v atrapě prohlížeče
// (probuzení při 100 000 v Insane Pekle, cutscény, zvyky bossů, počítadla, archiv, finále), skrytost před běžným hráčem a to, že cheat menu skrytý
// odznak nedá. Samotná hra je plátno, to se zkouší v prohlížeči; tady se hlídá logika.
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
({ STORY_SHARDS, STORY_BOOKS, STORY_SCENES, STORY_RULES, STORY_BY_ID, STORY_HABITS, STORY_ENDINGS, STORY_LAST, STORY_BY_KIND,
  STORY_AWAKEN_SCORE, STORY_WANDERER_HP, STORY_WANDERER_R, STORY_ZEN_MS, STORY_BREATH_HITS, STORY_DUST_SPEND, STORY_RING_SPEND, STORY_KILLS, STORY_ASCENDS, STORY_VIGIL_MS, STORY_RUSH_STREAK, STORY_DARK_NOHIT,
  STORY_LINE_BAND, STORY_LINE_RATIO, STORY_LINE_MIN, STORY_EDGE_BAND, STORY_EDGE_RATIO, STORY_LOW_FROM, STORY_LOW_RATIO, STORY_GRACE, STORY_COMBO_N, STORY_SWARM_N,
  normalizeStory, storyCodeMatches, storyRuleOk, storyRuleLive, storyRuleCount, storyRuleList, storyModeOk, storyText, storyEsc, storyPickups, storyRoman })`);
const api = { ...raw, ...plain({ STORY_SHARDS: raw.STORY_SHARDS, STORY_BOOKS: raw.STORY_BOOKS, STORY_SCENES: raw.STORY_SCENES, STORY_ENDINGS: raw.STORY_ENDINGS }) };
const { STORY_SHARDS, STORY_BOOKS, STORY_SCENES, STORY_ENDINGS } = api;
const BY_ID = Object.fromEntries(STORY_SHARDS.map((s) => [s.id, s]));

// Všechny střepy, které je potřeba mít před daným (včetně něj, když withSelf)
const upTo = (id, withSelf = true) => {
  const out = new Set();
  const add = (x) => { for (const r of BY_ID[x].requires) add(r); out.add(x); };
  add(id);
  if (!withSelf) out.delete(id);
  return [...out];
};
// Uložený příběh se zadanými nalezenými střepy (příjem příběhu už proběhl)
const S = (ids, extra = {}) => ({ v: 2, found: Object.fromEntries(ids.map((id, i) => [id, 1000 + i])), awake: true, ...extra });

/* ---------------------------------------------------------------- texty a návaznost */
test('střepy: unikátní id, čísla po řadě (poslední tři konce sdílejí číslo), každý má knihu, název, mluvčího a věty bez HTML', () => {
  const ids = STORY_SHARDS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'unikátní id');
  const nos = STORY_SHARDS.map((s) => s.no);
  assert.deepEqual([...new Set(nos)], Array.from({ length: 33 }, (_, i) => i + 1), 'čísla 1 až 33 bez mezer');
  assert.deepEqual(nos, [...nos].sort((a, b) => a - b), 'seřazené podle čtení');
  for (const s of STORY_SHARDS) {
    assert.ok(STORY_BOOKS.some((b) => b.id === s.book), `${s.id}: kniha`);
    assert.ok(s.title && s.who && s.memory.length >= 3, `${s.id}: název, mluvčí a aspoň tři věty`);
    for (const line of [...s.memory, s.margin || '']) assert.doesNotMatch(line, /[<>]/, `${s.id}: žádné HTML`);
    assert.doesNotMatch([...s.memory, s.margin || '', s.hint || '', s.title, s.who].join(' '), /'|"|&#/, `${s.id}: v textech jen typografické uvozovky`);
  }
  assert.equal(STORY_SHARDS.length, 35);
  assert.deepEqual(STORY_BOOKS.map((b) => b.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(['I', 'IV', 'IX', 'XIV', 'XXIV', 'XXXIII', 'XLIX', 'MMXXIV'].map((x, i) => api.storyRoman([1, 4, 9, 14, 24, 33, 49, 2024][i])), ['I', 'IV', 'IX', 'XIV', 'XXIV', 'XXXIII', 'XLIX', 'MMXXIV']);
});

test('střepy: řetěz návazností: Šum → Kanál → Poutník → čtyři kapitáni → Domov → Ozvěna → čtyři zbylé → Seznam → devět lodí → Podpis → šest zkoušek → Chyba → Marek → tři konce', () => {
  for (const s of STORY_SHARDS) {
    for (const r of s.requires) assert.ok(STORY_SHARDS.findIndex((x) => x.id === r) < STORY_SHARDS.findIndex((x) => x.id === s.id), `${s.id} po ${r}`);
  }
  assert.deepEqual(BY_ID.noise.requires, []);
  assert.deepEqual(BY_ID.channel.requires, ['noise']);
  assert.deepEqual(BY_ID.wanderer.requires, ['channel']);
  const captains = ['warden', 'prism', 'archon', 'nemesis'];
  for (const c of captains) assert.deepEqual(BY_ID[c].requires, ['wanderer'], `${c}: v libovolném pořadí`);
  assert.deepEqual(BY_ID.home.requires, captains);
  assert.deepEqual(BY_ID.echo.requires, ['home']);
  for (const id of ['fire', 'silence', 'breath', 'dust']) assert.deepEqual(BY_ID[id].requires, ['echo'], `${id}: zbylé střepy v libovolném pořadí`);
  assert.deepEqual(BY_ID.seznam.requires, ['fire', 'silence', 'breath', 'dust']);
  const ships = ['hunter', 'ripper', 'vortex', 'bastion', 'sniper', 'rampart', 'swarm', 'gloom', 'leviathan'];
  for (const id of ships) assert.deepEqual(BY_ID[id].requires, ['seznam'], `${id}: lodě v libovolném pořadí`);
  assert.deepEqual(BY_ID.podpis.requires, ships);
  const trials = ['counter', 'ring', 'cycle', 'vigil', 'witness', 'dark'];
  for (const id of trials) assert.deepEqual(BY_ID[id].requires, ['podpis']);
  assert.deepEqual(BY_ID.glitch.requires, trials);
  assert.deepEqual(BY_ID.marek.requires, ['glitch']);
  for (const e of ['end_light', 'end_rest', 'end_door']) assert.deepEqual(BY_ID[e].requires, ['marek']);
  // poslední střep celého příběhu má před sebou úplně všechno ostatní
  assert.equal(upTo('end_light').length, STORY_SHARDS.length - 2, 'všechno kromě dvou ostatních konců');
});

test('podmínky: každý střep má druh podmínky, kterému hra rozumí, nápovědu tam, kde ji hráč potřebuje, a čísla v nápovědě sedí na ladicí konstanty', () => {
  const kinds = new Set(['scene', 'code', 'spare', 'habit', 'finale', 'auto', 'bossKill', 'zen', 'blitz', 'spend', 'kills', 'ascend', 'survive', 'rush', 'nohit', 'ending']);
  for (const s of STORY_SHARDS) assert.ok(kinds.has(s.how.kind), `${s.id}: druh ${s.how.kind}`);
  for (const s of STORY_SHARDS) {
    if (!['auto', 'ending'].includes(s.how.kind) && s.id !== 'noise') assert.ok(s.hint && s.hint.length > 30, `${s.id}: nápověda`);
    else assert.equal(s.hint, '', `${s.id}: bez nápovědy`);
  }
  const num = (n) => String(n);
  const hintDigits = (id) => BY_ID[id].hint.replace(/\s/g, '');
  assert.ok(hintDigits('counter').includes(num(api.STORY_KILLS)));
  assert.ok(hintDigits('ring').includes(num(api.STORY_RING_SPEND)));
  assert.ok(hintDigits('dust').includes(num(api.STORY_DUST_SPEND)));
  assert.ok(BY_ID.hunter.hint.includes(String(api.STORY_COMBO_N)));
  assert.ok(BY_ID.swarm.hint.includes(String(api.STORY_SWARM_N)));
  assert.ok(BY_ID.vortex.hint.includes(`${Math.round(api.STORY_EDGE_RATIO * 100)} %`));
  assert.ok(BY_ID.sniper.hint.includes(`${Math.round(api.STORY_LOW_RATIO * 100)} %`));
  assert.equal(api.STORY_VIGIL_MS / 60000, 25);
  assert.ok(BY_ID.vigil.hint.includes('pětadvacet minut'), 'minuty vigilie');
  assert.equal(api.STORY_ZEN_MS / 60000, 10);
  assert.ok(BY_ID.silence.hint.includes('deset minut'), 'minuty Ticha');
  assert.equal(BY_ID.breath.how.maxHits, api.STORY_BREATH_HITS);
  assert.ok(BY_ID.breath.hint.includes('čtyřmi'), 'zásahy v Dechu');
  assert.ok(BY_ID.witness.hint.includes(String(api.STORY_RUSH_STREAK)) || BY_ID.witness.hint.includes('dvacet'));
  assert.ok(BY_ID.dark.hint.includes('dvanáct') && api.STORY_DARK_NOHIT === 12);
  assert.ok(BY_ID.cycle.hint.includes('třikrát') && api.STORY_ASCENDS === 3);
  // režimy v nápovědě odpovídají režimu podmínky
  for (const s of STORY_SHARDS.filter((x) => x.how.modes === 'insane')) assert.match(s.hint, /Insane Pekl/, `${s.id}: Insane Peklo v nápovědě`);
  for (const s of STORY_SHARDS.filter((x) => x.how.modes === 'hell' && x.how.kind === 'habit')) assert.match(s.hint, /Pekle/, `${s.id}: Peklo v nápovědě`);
});

test('zvyky bossů: jména a pořadí sedí na BOSS_TYPES, každá z třinácti lodí a Chyba mají jednu, pravidla existují', () => {
  const habits = STORY_SHARDS.filter((s) => s.how.kind === 'habit');
  assert.equal(habits.length, 14);
  const levels = habits.map((s) => s.how.level);
  assert.deepEqual(levels.filter((l) => l !== 'glitch').sort((a, b) => a - b), Array.from({ length: 13 }, (_, i) => i + 1), 'lodě 1 až 13 po jedné');
  for (const s of habits) {
    const h = s.how;
    const boss = h.level === 'glitch' ? bossTypes.at(-1) : bossTypes[h.level - 1];
    assert.equal(boss.name, h.boss, `${s.id}: jméno bosse`);
    assert.equal(h.alias, h.boss);
    assert.ok(['hell', 'insane'].includes(h.modes), `${s.id}: režim`);
    assert.ok(api.storyRuleList(h.rule).length === (Array.isArray(h.rule) ? h.rule.length : 1) && api.storyRuleList(h.rule).length > 0, `${s.id}: pravidla existují`);
  }
  assert.equal(bossTypes.at(-1).name, 'GLITCH');
  // těžší lodě se hrají jen v Insane Pekle; první čtyři kapitáni a první tři lodě v Pekle
  for (const id of ['warden', 'prism', 'archon', 'nemesis', 'hunter', 'ripper', 'vortex']) assert.equal(BY_ID[id].how.modes, 'hell', id);
  for (const id of ['bastion', 'sniper', 'rampart', 'swarm', 'gloom', 'leviathan', 'glitch']) assert.equal(BY_ID[id].how.modes, 'insane', id);
  assert.deepEqual(plain(BY_ID.leviathan.how.rule), ['flawless', 'nobomb']);
  assert.deepEqual(plain(BY_ID.glitch.how.rule), ['p3flawless', 'nobomb', 'noshield']);
  assert.equal(BY_ID.warden.how.rule, 'line');
  assert.equal(BY_ID.prism.how.rule, 'beam');
  assert.equal(BY_ID.archon.how.rule, 'bare');
  assert.equal(BY_ID.nemesis.how.rule, 'flawless');
});

test('každý krok napovídá, kam dál: poznámka na okraji u Knihy I a u přechodů mezi knihami; texty říkají, kde se hledá', () => {
  for (const id of ['noise', 'channel', 'wanderer', 'warden', 'prism', 'archon', 'home', 'echo', 'seznam']) assert.ok(BY_ID[id].margin.length > 20, `${id}: poznámka`);
  assert.match(BY_ID.noise.margin, /v2\.9|jméno/, 'Šum odkazuje na jméno v menu');
  assert.match(BY_ID.channel.margin, /Pekle/, 'Kanál říká, že Poutník chodí v Pekle');
  assert.match(BY_ID.wanderer.margin, /Pekle/);
  assert.match(BY_ID.home.margin, /ohni|tichu|rychlosti|prachu/, 'Domov odkazuje na zbylé střepy');
  assert.match(BY_ID.echo.margin, /ohni, v tichu, v dechu a v prachu/);
  assert.match(BY_ID.seznam.memory.join(' '), /Insane Pekle/, 'Seznam říká, že lodě se ozvou v Insane Pekle');
  assert.match(BY_ID.podpis.margin, /Marek/, 'poznámky na okraji psal Marek');
});

test('názvy a popis skrytého odznaku a titulu: odznak je za dokončení celého příběhu, titul Majákář se dává zdarma za něj', () => {
  const badge = getBadge('rocket_beacon');
  assert.ok(badge && badge.secret && badge.stat === 'story_end' && badge.threshold === 1);
  assert.match(badge.title, /Vlaštovky/);
  assert.match(badge.description, /Marek|Majákář/, 'popis odznaku už mluví o celém příběhu');
  const title = getShopItem('title_majakar');
  assert.ok(title && title.price === 0 && title.grantedBy === 'rocket_beacon' && title.secret, 'titul se dává zdarma za odznak');
  assert.equal(title.label, 'Majákář');
  assert.ok(['marek', 'end_light', 'end_rest', 'end_door'].every((id) => BY_ID[id].who.includes('Majákář')), 'poslední záznamy mluví jako Majákář');
  assert.match(BY_ID.home.memory.join(' '), /Majákáři/, 'titul je v záznamu Domov oslovení');
});

/* ---------------------------------------------------------------- scény */
test('scény: každá věta má známý styl, text a (kde je) zvuk i číslo lodi; volby mají id a popisek; seznam rozsvěcí lodě 0 až 13 po řadě', () => {
  const styles = new Set(['sys', 'marek', 'voice', 'big', 'quiet', 'prompt']);
  const snds = new Set(['whisper', 'crack', 'shard']);
  const fxs = new Set(['alarm', 'static', 'calm', 'ring', 'dawn']);
  for (const [id, sc] of Object.entries(STORY_SCENES)) {
    assert.ok(fxs.has(sc.fx), `${id}: efekt`);
    const all = [...sc.beats, ...Object.values(sc.after || {}).flat()];
    assert.ok(sc.beats.length >= 4, `${id}: aspoň čtyři věty`);
    for (const b of all) {
      assert.ok(styles.has(b.c), `${id}: styl ${b.c}`);
      assert.ok(typeof b.say === 'string' && b.say.length > 0 && !/[<>]/.test(b.say), `${id}: text`);
      if (b.snd) assert.ok(snds.has(b.snd), `${id}: zvuk ${b.snd}`);
      if (b.fx) assert.ok(fxs.has(b.fx), `${id}: efekt věty`);
      if (b.k !== undefined) assert.ok(b.k >= 0 && b.k <= 1, `${id}: síla efektu`);
      if (b.ms !== undefined) assert.ok(b.ms >= 1200 && b.ms <= 6000, `${id}: délka věty`);
    }
    for (const c of sc.choice || []) assert.ok(c.id && c.label, `${id}: volba`);
  }
  assert.deepEqual(STORY_SCENES.odstavec12.choice.map((c) => c.id), ['listen', 'close']);
  assert.deepEqual(STORY_SCENES.odstavec13.choice.map((c) => c.id), STORY_ENDINGS);
  assert.equal(STORY_SCENES.odstavec12.beats.at(-1).c, 'prompt', 'výzva s volbou je poslední věta');
  assert.equal(STORY_SCENES.odstavec13.beats.at(-1).c, 'prompt');
  assert.ok(STORY_SCENES.odstavec12.repeat > 0 && STORY_SCENES.odstavec12.repeat < STORY_SCENES.odstavec12.beats.length, 'opakování začíná uprostřed');
  for (const e of STORY_ENDINGS) assert.ok(STORY_SCENES.odstavec13.endFx[e].fx, `konec ${e} má efekt`);
  const ships = STORY_SCENES.rollcall.beats.filter((b) => typeof b.ship === 'number').map((b) => b.ship);
  assert.deepEqual(ships, Array.from({ length: 14 }, (_, i) => i), 'čtrnáct světel po řadě');
  assert.ok(STORY_SCENES.rollcall.beats.length >= 15 && !STORY_SCENES.rollcall.choice);
  // seznam jmenuje všech třináct kapitánů podle střepů
  const text = STORY_SCENES.rollcall.beats.map((b) => b.say).join(' ');
  for (const name of ['Hana Vránová', 'Dušan Rybák', 'Eliška Kopecká', 'Ondřej Vrba', 'Prizma', 'Archont', 'Zdena Hájková', 'Návrat', 'Pavel Dolejš', 'Marta Zedníková', 'Libor Včelka', 'Irena Kosová', 'Gustav Kamenář', 'Marek']) assert.ok(text.includes(name), name);
});

/* ---------------------------------------------------------------- čisté funkce */
test('normalizeStory: nesmysly, přeskočené kroky a rozbité hodnoty se opraví', () => {
  const { normalizeStory } = api;
  const empty = plain(normalizeStory(null));
  assert.deepEqual(empty, { v: 2, found: {}, seen: {}, prog: {}, awake: false, fin1: false, done: false, legacy: false, ending: '', refused: 0, lost: 0 });
  assert.deepEqual(plain(normalizeStory('x')), empty);
  assert.deepEqual(plain(normalizeStory({ v: 2, found: { channel: 5, warden: 6 } })), empty, 'bez Šumu nic neplatí (přeskočit začátek nejde)');
  const n = plain(normalizeStory({ v: 2, found: { noise: 1, channel: 'x', wanderer: 3, warden: -4 }, seen: { noise: true, wanderer: true }, refused: 'a', lost: 1e9 }));
  assert.deepEqual(Object.keys(n.found).sort(), ['channel', 'noise', 'wanderer', 'warden'], 'rozbité časy se opraví na 1, střepy zůstanou');
  assert.equal(n.found.channel, 1);
  assert.equal(n.found.warden, 1, 'záporný čas se opraví');
  assert.equal(n.found.wanderer, 3);
  const m = plain(normalizeStory({ v: 2, found: { noise: 1, channel: 2, wanderer: 3, warden: 4 }, seen: { noise: true, wanderer: true, warden: false } }));
  assert.deepEqual(Object.keys(m.found), ['noise', 'channel', 'wanderer', 'warden']);
  assert.equal(m.found.noise, 1);
  assert.deepEqual(Object.keys(m.seen).sort(), ['noise', 'wanderer'], 'přečtené jen u nalezených');
  assert.equal(m.awake, true, 'kdo má Šum, příběh přijal');
  assert.equal(n.lost, 9999);
  assert.equal(n.refused, 0);
  // věci, které se z uložení nesmí dostat
  const evil = plain(normalizeStory({ v: 2, found: { noise: 1, __proto__x: 1, constructor: 1 }, done: true, ending: 'light', awake: false, legacy: 'yes', fin1: true, prog: { nic: 5 } }));
  assert.equal(evil.done, false, 'dokončeno jen s nalezeným koncem');
  assert.equal(evil.ending, '');
  assert.equal(evil.fin1, false, 'první kniha jen s nalezeným Domovem');
  assert.equal(evil.legacy, false);
  assert.deepEqual(evil.prog, {}, 'postup jen známým střepům s počítadlem');
});

test('normalizeStory: postup počítadel se ořízne, u nalezeného střepu se zahodí; konec platí jen s nalezeným střepem konce', () => {
  const { normalizeStory } = api;
  const base = S(upTo('podpis')).found;
  const n = plain(normalizeStory({ v: 2, found: base, prog: { counter: 5000.9, ring: -3, cycle: 'x', dust: 99999, podpis: 5, vigil: 1e12 } }));
  assert.equal(n.prog.counter, 5000, 'celé číslo');
  assert.equal('ring' in n.prog && n.prog.ring === 0 || !('ring' in n.prog), true);
  assert.equal(n.prog.vigil, undefined, 'vigilie se nesčítá (jeden běh)');
  assert.equal(n.prog.podpis, undefined, 'podpis nemá počítadlo');
  assert.equal(n.prog.dust, undefined, 'nalezený střep (Prach) postup nemá');
  const e = plain(normalizeStory({ v: 2, found: S(upTo('end_rest')).found, ending: 'rest' }));
  assert.equal(e.done, true);
  assert.equal(e.ending, 'rest');
  const other = plain(normalizeStory({ v: 2, found: S(upTo('end_rest')).found, ending: 'door' }));
  assert.equal(other.done, false, 'konec, který se nenašel, neplatí');
  assert.equal(plain(normalizeStory({ v: 2, found: S(upTo('end_rest')).found, ending: 'nesmysl' })).done, false);
});

test('normalizeStory: starý příběh před knihami se převede (Ozvěna k dobru, odznak zachován, nic se neztratí)', () => {
  const { normalizeStory } = api;
  const oldFound = { noise: 1, channel: 2, wanderer: 3, warden: 4, prism: 5, archon: 6, nemesis: 7, home: 8, fire: 9, dust: 10 };
  const m = plain(normalizeStory({ found: oldFound, seen: { noise: true }, pity: 3, lost: 2, done: true }));
  assert.deepEqual(Object.keys(m.found).sort(), [...Object.keys(oldFound), 'echo'].sort(), 'zbylé střepy zůstaly a přibyla Ozvěna');
  assert.equal(m.found.echo, 8, 'Ozvěna má čas Domova');
  assert.equal(m.legacy, true, 'odznak za starý příběh');
  assert.equal(m.done, false, 'celý příběh dokončený není');
  assert.equal(m.fin1, true);
  assert.equal(m.awake, true);
  assert.equal(m.lost, 2);
  assert.equal(m.seen.echo, undefined, 'Ozvěna je nepřečtená');
  // starý příběh rozehraný: žádná Ozvěna ani odznak, ale nalezené zůstává
  const part = plain(normalizeStory({ found: { noise: 1, channel: 2 }, done: false }));
  assert.deepEqual(Object.keys(part.found), ['noise', 'channel']);
  assert.equal(part.legacy, false);
  assert.equal(part.awake, true);
  // starý příběh, který tvrdí dokončení bez Domova, odznak nedostane
  assert.equal(plain(normalizeStory({ found: { noise: 1 }, done: true })).legacy, false);
  // nové uložení se nepřevádí znovu
  const v2 = plain(normalizeStory({ v: 2, found: { noise: 1, channel: 2, wanderer: 3, warden: 4, prism: 5, archon: 6, nemesis: 7, home: 8 }, legacy: true }));
  assert.equal(v2.found.echo, undefined, 'bez nové Ozvěny');
  assert.equal(v2.legacy, true, 'příznak se zachová');
});

test('Kanál: jméno v2.9 se pozná i bez teček, mezer a velikosti písmen, a na české klávesnici podle kódů kláves (V29)', () => {
  const { storyCodeMatches } = api;
  for (const ok of ['v2.9', 'V2.9', ' v 2 . 9 ', 'V29', 'v-29', '29']) assert.equal(storyCodeMatches(ok), true, ok);
  for (const no of ['', 'v3.0', 'v2.99', 'abc', null, undefined, 'v2.8']) assert.equal(storyCodeMatches(no), false, String(no));
});

test('storyText: vše se escapuje a jen {#n} se změní na zašuměné místo (nejvýš 12 znaků)', () => {
  const { storyText, storyEsc } = api;
  assert.equal(storyEsc('<b>"a" & b</b>'), '&lt;b&gt;&quot;a&quot; &amp; b&lt;/b&gt;');
  assert.equal(storyText('a {#3} b'), 'a <span class="st" style="width:3ch" aria-hidden="true"></span> b');
  assert.equal(storyText('{#99}'), '<span class="st" style="width:12ch" aria-hidden="true"></span>');
  assert.equal(storyText('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(storyText('{#x}'), '{#x}', 'jiné závorky zůstanou textem');
});

test('storyModeOk: Peklo je Peklo i Insane Peklo, Insane jen Insane, bez omezení kdekoli', () => {
  const { storyModeOk } = api;
  assert.equal(storyModeOk('hell', { inferno: true, insane: false }), true);
  assert.equal(storyModeOk('hell', { inferno: true, insane: true }), true);
  assert.equal(storyModeOk('hell', { inferno: false, insane: false }), false);
  assert.equal(storyModeOk('insane', { inferno: true, insane: false }), false);
  assert.equal(storyModeOk('insane', { inferno: true, insane: true }), true);
  assert.equal(storyModeOk(undefined, { inferno: false }), true);
});

const rec = (over = {}) => ({ t: 20000, inBand: 0, edgeT: 0, lowT: 0, shieldT: 0, beamHits: 0, hits: 0, hitsP3: 0, bombs: 0, picks: 0, maxCombo: 0, kills: 0, ...over });

test('zvyky bossů: hranice všech pravidel (linie, okraj, dole, paprsek, bomba, dar, štít, zásah, zásah ve zuřivosti, kombo, rojnice)', () => {
  const { storyRuleOk, storyRuleLive, storyRuleCount, STORY_LINE_MIN, STORY_GRACE } = api;
  // linie: 80 % po příletu a aspoň 3 s boje
  assert.equal(storyRuleOk('line', rec({ t: 10000, inBand: 8000 })), true);
  assert.equal(storyRuleOk('line', rec({ t: 10000, inBand: 7999 })), false);
  assert.equal(storyRuleOk('line', rec({ t: STORY_LINE_MIN - 1, inBand: STORY_LINE_MIN - 1 })), false, 'příliš krátký boj');
  assert.equal(storyRuleLive('line', rec({ t: 1000, inBand: 0 })), true, 'na začátku odpuštění');
  assert.equal(storyRuleLive('line', rec({ t: 10000, inBand: 5000 })), false);
  // okraj a dole: 70 % a 85 % po úvodní lhůtě
  assert.equal(storyRuleOk('edge', rec({ t: 20000, edgeT: 14000 })), true);
  assert.equal(storyRuleOk('edge', rec({ t: 20000, edgeT: 13999 })), false);
  assert.equal(storyRuleOk('edge', rec({ t: STORY_GRACE - 1, edgeT: STORY_GRACE - 1 })), false, 'krátký boj');
  assert.equal(storyRuleLive('edge', rec({ t: STORY_GRACE - 1, edgeT: 0 })), true);
  assert.equal(storyRuleOk('low', rec({ t: 20000, lowT: 17000 })), true);
  assert.equal(storyRuleOk('low', rec({ t: 20000, lowT: 16999 })), false);
  assert.equal(storyRuleLive('low', rec({ t: 20000, lowT: 1000 })), false);
  // jednoduchá pravidla
  assert.equal(storyRuleOk('beam', rec()), true);
  assert.equal(storyRuleOk('beam', rec({ beamHits: 1 })), false);
  assert.equal(storyRuleOk('bare', rec({ picks: 0, bombs: 0 })), true);
  assert.equal(storyRuleOk('bare', rec({ bombs: 1 })), false);
  assert.equal(storyRuleOk('bare', rec({ picks: 1 })), false);
  assert.equal(storyRuleOk('nobomb', rec({ picks: 3 })), true, 'dary nevadí');
  assert.equal(storyRuleOk('nobomb', rec({ bombs: 1 })), false);
  assert.equal(storyRuleOk('nopick', rec({ bombs: 3 })), true, 'bomby nevadí');
  assert.equal(storyRuleOk('nopick', rec({ picks: 1 })), false);
  assert.equal(storyRuleOk('noshield', rec()), true);
  assert.equal(storyRuleOk('noshield', rec({ shieldT: 1 })), false);
  assert.equal(storyRuleOk('flawless', rec()), true);
  assert.equal(storyRuleOk('flawless', rec({ hits: 1 })), false);
  assert.equal(storyRuleOk('p3flawless', rec({ hits: 1, hitsP3: 0 })), true, 'zásahy dřív nevadí');
  assert.equal(storyRuleOk('p3flawless', rec({ hitsP3: 1 })), false);
  // čítače
  assert.equal(storyRuleOk('combo', rec({ maxCombo: 11 })), false);
  assert.equal(storyRuleOk('combo', rec({ maxCombo: 12 })), true);
  assert.deepEqual(plain(storyRuleCount('combo', rec({ maxCombo: 7 }))), { v: 7, n: 12 });
  assert.deepEqual(plain(storyRuleCount('combo', rec({ maxCombo: 99 }))), { v: 12, n: 12 }, 'ukazatel se zastaví na cíli');
  assert.equal(storyRuleOk('swarm', rec({ kills: 24 })), false);
  assert.equal(storyRuleOk('swarm', rec({ kills: 25 })), true);
  assert.deepEqual(plain(storyRuleCount('swarm', rec({ kills: 10 }))), { v: 10, n: 25 });
  assert.equal(storyRuleLive('combo', rec()), true, 'čítač nikdy "nepohasne" předčasně');
  assert.equal(storyRuleCount('flawless', rec()), null);
  // víc pravidel najednou musí platit všechna
  assert.equal(storyRuleOk(['flawless', 'nobomb'], rec()), true);
  assert.equal(storyRuleOk(['flawless', 'nobomb'], rec({ bombs: 1 })), false);
  assert.equal(storyRuleOk(['flawless', 'nobomb'], rec({ hits: 1 })), false);
  assert.equal(storyRuleLive(['noshield', 'nobomb'], rec({ shieldT: 5 })), false);
  assert.equal(storyRuleOk(['p3flawless', 'nobomb', 'noshield'], rec()), true);
  assert.equal(storyRuleOk(['p3flawless', 'nobomb', 'noshield'], rec({ shieldT: 1 })), false);
  // nesmysly nikdy neprojdou
  assert.equal(storyRuleOk('nic', rec()), false);
  assert.equal(storyRuleOk([], rec()), false);
  assert.equal(storyRuleOk('flawless', null), false);
  assert.equal(storyRuleLive(['nic'], rec()), false);
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
  for (const id of ['story-overlay', 'finale-layer', 'finale-hold', 'finale-done', 'finale-skip', 'scene-tap', 'scene-choices', 'story-actions', 'story-caps', 'story-preview', 'btn-open-story', 'btn-story-go', 'story-mark']) el(id).classList.add('hidden');
  const document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [] };
  const log = { save: 0, queue: 0, sounds: [], toasts: [], errors: [], resized: 0 };
  const Storage = { data: { tutorialDone, stats: { runsPlayed: 6, bombsUsed: 0, pickups_heal: 0, pickups_power: 0, pickups_coin: 0, ...stats }, story: null }, save() { log.save++; }, queueSave() { log.queue++; } };
  const Sounds = new Proxy({}, { get: (_, k) => (...a) => { log.sounds.push(k); } });
  const Toast = { push: (t) => log.toasts.push(t) };
  class Particle { constructor(x, y) { this.x = x; this.y = y; } }
  class FloatingText { constructor(x, y, text) { this.x = x; this.y = y; this.text = text; } }
  const game = {
    width: 390, height: 780, particles: [], texts: [], bullets: [], enemies: [], player: { x: 195, y: 690, shieldTimer: 0, invulnTimer: 0 }, boom() {}, resize() { log.resized++; },
    runTime: 0, bossActive: false, boss: null, bossNoHit: true, mode: 'normal', tutActive: false, whiteFlash: 0, state: 'PLAY', inferno: false, insane: false, score: 0, kills: 0,
    combo: 0, rushStreak: 0, lastTime: 0, ...over,
  };
  if (game.insane) game.inferno = true;
  const env = { rnd: 0.5 };
  const M = Object.assign(Object.create(Math), { random: () => env.rnd });
  const sprite = { c: {}, w: 10, h: 10 };
  const Art = { glow: () => sprite, ship: () => sprite, sprite: () => sprite, white: () => sprite, blit() {} };
  const ctx = vm.createContext({ document, Storage, Sounds, Toast, Particle, FloatingText, Math: M, Date, Game: game, UI: { refresh() {} }, BOSS_TYPES: bossTypes, Art, performance: { now: () => 123 }, console: { error: (...a) => log.errors.push(a) } });
  vm.runInContext(`const U = ${html.match(/const U = (\{[\s\S]*?\n\});/)[1]};`, ctx);
  vm.runInContext(`${DATA}\n${ENGINE}\nglobalThis.__story = Story; globalThis.__normalize = normalizeStory;`, ctx);
  const Story = ctx.__story;
  // storyRaw: buď uložený tvar ({found, ...}), nebo pole id nalezených střepů (příběh přijatý)
  Storage.data.story = ctx.__normalize(Array.isArray(storyRaw) ? S(storyRaw) : storyRaw);
  return { Story, Storage, game, log, els, el, env, ctx };
}
const has = (e, id) => !!e.Story.d().found[id];
const step = (e, n, dt = 16) => { for (let i = 0; i < n; i++) { e.game.runTime += dt; e.Story.update(dt, e.game); } };
const hidden = (e, id) => e.el(id).classList.contains('hidden');

test('skrytost: dokud hráč příběh nepřijal, nic z něj není vidět a nic se nepočítá', () => {
  const e = makeEnv({});
  e.Story.paintButtons();
  assert.equal(hidden(e, 'btn-open-story'), true);
  assert.equal(hidden(e, 'btn-story-go'), true);
  assert.equal(e.Story.d().awake, false);
  // normální běhy, Peklo i Insane Peklo pod hranicí: žádný Poutník, žádný souboj, žádný postup
  for (const g of [{}, { inferno: true }, { inferno: true, insane: true, score: 99999 }, { mode: 'zen' }, { mode: 'blitz' }]) {
    const x = makeEnv({}, { game: g });
    x.Story.onRunStart(x.game);
    step(x, 3000);
    x.Story.onKill(x.game);
    x.Story.onStardustSpent(5000);
    x.Story.onAscend();
    assert.equal(x.Story.actor, null);
    assert.equal(x.Story.fight, null);
    assert.equal(x.Story.scn, null);
    assert.deepEqual(plain(x.Story.d().prog), {});
    assert.deepEqual(plain(x.Story.d().found), {});
    assert.equal(x.log.save, 0);
  }
  assert.match(html, /<button class="btn btn-ghost btn-small hidden" id="btn-open-story"/, 'tlačítko v menu je v HTML skryté');
  assert.match(html, /<button class="btn btn-ghost btn-small hidden" id="btn-story-go"/);
  assert.match(html, /<span class="story-mark hidden" id="story-mark"/);
  assert.match(html, /<div id="story-overlay" class="overlay hidden"/);
  assert.match(html, /<div id="finale-layer" class="hidden">/);
  assert.match(html, /<div id="scene-tap" class="scene-tap hidden">/);
  assert.match(html, /<div id="scene-choices" class="scene-choices hidden">/);
  assert.match(html, /id="finale-hold" type="button"/);
  assert.match(html, /const renderStory|story-list/, 'archiv se vykresluje z dat');
});

test('tlačítka Střepy: skrytá před přijetím příběhu; po něm se ukážou a svítí, dokud něco není přečtené', () => {
  const e = makeEnv([...upTo('channel')]);
  e.Story.paintButtons();
  assert.equal(hidden(e, 'btn-open-story'), false);
  assert.equal(e.el('btn-open-story').classList.contains('unread'), true, 'svítí: nic nebylo přečtené');
  assert.equal(e.el('btn-story-go').classList.contains('unread'), true);
  for (const id of upTo('channel')) e.Story.d().seen[id] = true;
  e.Story.paintButtons();
  assert.equal(e.el('btn-open-story').classList.contains('unread'), false, 'všechno přečteno');
});

/* ---------------------------------------------------------------- probuzení (Odstavec 12) */
test('probuzení: cutscéna se spustí jen v Insane Pekle na 100 000 bodech, u hráče po výcviku, mimo výcvik, a jen u toho, kdo příběh ještě nepřijal', () => {
  assert.equal(api.STORY_AWAKEN_SCORE, 100000);
  const no = [
    ['normální režim', { game: { score: 150000 } }],
    ['Peklo (ne Insane)', { game: { inferno: true, score: 150000 } }],
    ['pod hranicí', { game: { insane: true, score: 99999 } }],
    ['výcvik není dohraný', { tutorialDone: false, game: { insane: true, score: 100000 } }],
    ['právě probíhá výcvik', { game: { insane: true, score: 100000, tutActive: true } }],
  ];
  for (const [name, opts] of no) {
    const e = makeEnv({}, opts);
    e.Story.update(16, e.game);
    assert.equal(e.Story.scn, null, name);
    assert.equal(e.game.state, 'PLAY', name);
  }
  // kdo už příběh přijal, probuzení nedostane znovu
  const awake = makeEnv(['noise'], { game: { insane: true, score: 100000 } });
  awake.Story.update(16, awake.game);
  assert.equal(awake.Story.scn, null);
  const e = makeEnv({}, { game: { insane: true, score: 100000 } });
  e.Story.update(16, e.game);
  assert.equal(e.Story.scn.id, 'odstavec12');
  assert.equal(e.game.state, 'SCENE');
  assert.equal(e.Story.scn.run, true);
  assert.equal(hidden(e, 'finale-layer'), false);
  assert.equal(hidden(e, 'scene-tap'), false);
  assert.equal(hidden(e, 'hud'), true, 'ukazatele hry se na dobu scény schovají');
  assert.ok(e.el('finale-text').innerHTML.includes('SMĚRNICE 7'), 'první věta');
  assert.equal(e.Story.scn.beats.length, STORY_SCENES.odstavec12.beats.length, 'poprvé celá scéna');
  // scéna se nespustí podruhé, dokud běží
  e.Story.update(16, e.game);
  assert.equal(e.Story.scn.i, 0);
});

test('probuzení: věty běží podle času, klepnutí přeskočí větu (ne hned po jejím začátku a ne hned po začátku scény), přeskočení vede k volbě', () => {
  const e = makeEnv({}, { game: { insane: true, score: 100000 } });
  e.Story.update(16, e.game);
  const s = e.Story.scn;
  const first = s.dur;
  assert.ok(first > 0 && s.lock > first, 'zámek klepnutí je delší než první věta (hráč mohl ovládat loď)');
  e.Story.sceneAdvance();
  assert.equal(s.i, 0, 'hned po začátku scény klepnutí nic neudělá');
  e.Story.sceneUpdate(first - 1);
  assert.equal(s.i, 0, 'první věta ještě běží');
  e.Story.sceneUpdate(1);
  assert.equal(s.i, 1, 'věta doběhla, nastoupila další');
  e.Story.sceneAdvance();
  assert.equal(s.i, 1, 'zámek ještě drží');
  e.Story.sceneUpdate(s.lock + 1);
  assert.equal(s.i, 1);
  e.Story.sceneAdvance();
  assert.equal(s.i, 1, 'věta běží méně než 0,9 s: klepnutí ji nepřeskočí (nechtěný dvojklik)');
  e.Story.sceneUpdate(1000);
  e.Story.sceneAdvance();
  assert.equal(s.i, 2, 'po chvíli klepnutí přeskočí větu');
  assert.ok(e.log.sounds.includes('crack') || e.log.sounds.includes('whisper') || e.log.sounds.includes('shard') || e.log.sounds.length > 0);
  // přeskočit: rovnou k výzvě s tlačítky
  e.Story.skipScene();
  assert.equal(s.phase, 'choice');
  assert.equal(s.i, STORY_SCENES.odstavec12.beats.length - 1);
  assert.ok(e.el('finale-text').innerHTML.includes('Kanál je otevřený'), 'na obrazovce je výzva, ne předchozí věta');
  assert.equal(hidden(e, 'scene-choices'), false);
  assert.ok(e.el('scene-choices').innerHTML.includes('data-choice="listen"') && e.el('scene-choices').innerHTML.includes('data-choice="close"'));
  // během volby čas ani klepnutí nic neposouvá
  e.Story.sceneUpdate(60000);
  e.Story.sceneAdvance();
  assert.equal(s.phase, 'choice');
  assert.equal(e.Story.scn, s);
});

test('probuzení: Naslouchat přijme příběh (Střep I, tlačítka Střepy), vrátí běh do hry s chvílí neranitelnosti a hudbu nezastaví', () => {
  const e = makeEnv({}, { game: { insane: true, score: 100000 } });
  e.el('hud').classList.remove('hidden'); e.el('boss-bar').classList.remove('hidden');
  e.game.player.invulnTimer = 100;
  e.Story.update(16, e.game);
  assert.equal(hidden(e, 'hud'), true); assert.equal(hidden(e, 'boss-bar'), true);
  e.Story.skipScene();
  e.Story.chooseScene('nesmysl');
  assert.equal(e.Story.scn.phase, 'choice', 'neznámá volba se ignoruje');
  e.Story.chooseScene('listen');
  assert.equal(e.Story.scn.phase, 'after');
  assert.equal(e.Story.scn.result, 'listen');
  assert.equal(hidden(e, 'scene-choices'), true);
  assert.equal(e.Story.scn.beats.length, STORY_SCENES.odstavec12.after.listen.length);
  assert.equal(has(e, 'noise'), false, 'zatím se nezapsalo: až na konci');
  e.Story.skipScene();
  assert.equal(e.Story.scn, null, 'scéna skončila sama (bez tlačítka)');
  assert.equal(has(e, 'noise'), true);
  assert.equal(e.Story.d().awake, true);
  assert.equal(e.log.toasts.at(-1).name, 'Střep I: Šum');
  assert.ok(e.log.save >= 1);
  assert.equal(e.game.state, 'PLAY', 'běh pokračuje');
  assert.equal(e.game.lastTime, 123, 'hodiny hry se zarovnaly (žádný skok času)');
  assert.ok(e.game.player.invulnTimer >= 2500, 'chvíle na rozkoukání');
  assert.equal(hidden(e, 'hud'), false, 'ukazatele zpátky');
  assert.equal(hidden(e, 'boss-bar'), false, 'jen ty, které byly vidět');
  assert.equal(hidden(e, 'finale-layer'), true);
  assert.equal(hidden(e, 'btn-open-story'), false, 'tlačítko Střepy se ukázalo');
  // po přijetí se scéna znovu nespustí
  e.Story.update(16, e.game);
  assert.equal(e.Story.scn, null);
});

test('probuzení: Zavřít kanál nic neodemkne, v tomhle běhu se nenabídne znovu, příště se přehraje jen od hlasu Majákáře', () => {
  const e = makeEnv({}, { game: { insane: true, score: 100000 } });
  e.Story.update(16, e.game);
  e.Story.skipScene();
  e.Story.chooseScene('close');
  assert.equal(e.Story.scn.beats.length, STORY_SCENES.odstavec12.after.close.length);
  e.Story.skipScene();
  assert.equal(e.Story.scn, null);
  assert.equal(e.game.state, 'PLAY');
  assert.equal(has(e, 'noise'), false);
  assert.equal(e.Story.d().awake, false);
  assert.equal(e.Story.d().refused, 1);
  assert.equal(hidden(e, 'btn-open-story'), true, 'příběh dál neexistuje');
  e.Story.update(16, e.game);
  assert.equal(e.Story.scn, null, 'v tomhle běhu už ne');
  // nový běh: znovu se nabídne, od Majákáře
  e.Story.onRunStart(e.game);
  e.Story.update(16, e.game);
  assert.equal(e.Story.scn.id, 'odstavec12');
  assert.equal(e.Story.scn.beats.length, STORY_SCENES.odstavec12.beats.length - STORY_SCENES.odstavec12.repeat);
  assert.equal(e.Story.scn.beats[0].c, 'marek');
  // a tentokrát ji přijme
  e.Story.skipScene(); e.Story.chooseScene('listen'); e.Story.skipScene();
  assert.equal(has(e, 'noise'), true);
});

test('probuzení: chyba v cutscéně uprostřed běhu příběh vypne a hra pokračuje (ne zamrzne ve stavu SCENE)', () => {
  const e = makeEnv({}, { game: { insane: true, score: 100000 } });
  vm.runInContext(GUARD, e.ctx);
  e.Story.update(16, e.game);
  assert.equal(e.game.state, 'SCENE');
  e.Story.nextBeat = () => { throw new Error('rozbitý takt'); };
  const bad = vm.runInContext('Story', e.ctx);
  assert.doesNotThrow(() => bad.sceneUpdate(99999));
  assert.equal(e.Story.off, true);
  assert.equal(e.Story.scn, null);
  assert.equal(e.game.state, 'PLAY', 'běh se vrátil do hry');
  assert.equal(hidden(e, 'hud'), false);
  assert.equal(hidden(e, 'finale-layer'), true);
  assert.equal(hidden(e, 'scene-tap'), true);
  assert.equal(e.log.errors.length, 1);
});

/* ---------------------------------------------------------------- Poutník */
test('Poutník: objeví se jen v Pekle a Insane Pekle, po 20 s, když je k mání; dolétne-li, dá Střep III; zničený se ve stejném běhu nevrátí', () => {
  // mimo Peklo ne
  for (const g of [{}, { mode: 'zen' }, { mode: 'blitz' }, { mode: 'rush' }]) {
    const e = makeEnv(['noise', 'channel'], { game: g }); e.Story.onRunStart(e.game); step(e, 2000);
    assert.equal(e.Story.actor, null, JSON.stringify(g));
  }
  // bez Kanálu ne
  let e = makeEnv(['noise'], { game: { inferno: true } }); e.Story.onRunStart(e.game); step(e, 2000);
  assert.equal(e.Story.actor, null);
  // v Pekle po 20 s, ne při bossovi
  e = makeEnv(['noise', 'channel'], { game: { inferno: true } }); e.Story.onRunStart(e.game);
  e.game.bossActive = true; e.game.runTime = 25000; e.Story.update(16, e.game);
  assert.equal(e.Story.actor, null, 'při bossovi ne');
  e.game.bossActive = false; e.game.runTime = 19000; e.Story.update(16, e.game);
  assert.equal(e.Story.actor, null, 'před 20. vteřinou ne');
  e.game.runTime = 20000; e.Story.update(16, e.game);
  assert.ok(e.Story.actor);
  assert.ok(e.log.sounds.includes('whisper'));
  // dolétne bez zásahu
  step(e, 600);
  assert.equal(has(e, 'wanderer'), false, 'ještě letí');
  step(e, 100);
  assert.equal(has(e, 'wanderer'), true, 'ušetřený Poutník dá střep');
  assert.equal(e.Story.actor, null);
  assert.equal(e.log.toasts.at(-1).name, 'Střep III: Poutník');
  // zničený střelami: ztichl, střep nic, ve stejném běhu se nevrátí
  e = makeEnv(['noise', 'channel'], { game: { inferno: true, insane: true } }); e.Story.onRunStart(e.game); e.game.runTime = 20000; e.Story.update(16, e.game);
  const a = e.Story.actor;
  for (let i = 0; i < api.STORY_WANDERER_HP; i++) e.game.bullets.push({ x: a.x, y: a.y, r: 3, isEnemy: false });
  e.Story.update(16, e.game);
  assert.equal(e.Story.actor, null);
  assert.equal(has(e, 'wanderer'), false);
  assert.equal(e.Story.d().lost, 1);
  step(e, 100);
  assert.equal(e.Story.actor, null, 'v tomhle běhu už ne');
  e.Story.onRunStart(e.game); e.game.runTime = 20000; e.Story.update(16, e.game);
  assert.ok(e.Story.actor, 'v dalším běhu zas');
  // nepřátelské střely a bomby se ho netýkají
  const b = e.Story.actor;
  e.game.bullets.push({ x: b.x, y: b.y, r: 3, isEnemy: true });
  e.Story.update(16, e.game);
  assert.equal(e.Story.actor.hp, api.STORY_WANDERER_HP);
});

/* ---------------------------------------------------------------- zvyky bossů */
// Souboj: připraví hráče s daným střepem k mání, spustí bosse a vrátí prostředí. boss: { level, name }
function fightEnv(id, { insane = true, extra = [] } = {}) {
  const ids = [...upTo(id, false), ...extra];
  const e = makeEnv(ids, { game: { inferno: true, insane } });
  e.Story.onRunStart(e.game);
  const h = BY_ID[id].how;
  e.game.boss = { level: h.level === 'glitch' ? 15 : h.level, name: h.boss, state: 'FIGHT', phase: 1 };
  e.game.bossActive = true;
  e.Story.onBossSpawn(e.game, e.game.boss);
  return e;
}
// Boj po snímcích; at(t) vrátí { x, y, shield, combo, phase }, ostatní děje (zásahy, bomby, dary, kills) se dělají před voláním
function fight(e, ms, at = () => ({})) {
  const dt = 100;
  for (let t = 0; t < ms; t += dt) {
    const o = at(t) || {};
    if (o.x !== undefined) e.game.player.x = o.x;
    if (o.y !== undefined) e.game.player.y = o.y;
    e.game.player.shieldTimer = o.shield ? 5000 : 0;
    if (o.combo !== undefined) e.game.combo = o.combo;
    if (o.phase !== undefined) e.game.boss.phase = o.phase;
    e.game.runTime += dt;
    e.Story.update(dt, e.game);
  }
}
const kill = (e) => { const b = e.game.boss; e.game.boss = null; e.game.bossActive = false; e.Story.onBossKilled(e.game); return b; };

test('zvyky bossů: souboj se hlídá jen u bosse, který střep nese, v pravém režimu a když je střep k mání; jinak bez ukazatele', () => {
  // Strážkyně: STRÁŽCE, boss 1, Peklo i Insane
  let e = fightEnv('warden', { insane: false });
  assert.ok(e.Story.fight && e.Story.fight.shard === 'warden');
  assert.equal(hidden(e, 'story-mark'), false, 'ukazatel svítí');
  // v normálním režimu ne
  e = makeEnv(upTo('warden', false), { game: {} }); e.Story.onRunStart(e.game);
  e.game.boss = { level: 1, name: 'STRÁŽCE', state: 'FIGHT', phase: 1 }; e.Story.onBossSpawn(e.game, e.game.boss);
  assert.equal(e.Story.fight, null);
  assert.equal(hidden(e, 'story-mark'), true);
  // jiný boss, jiné pořadí
  e = makeEnv(upTo('warden', false), { game: { inferno: true } }); e.Story.onRunStart(e.game);
  for (const boss of [{ level: 2, name: 'STRÁŽCE' }, { level: 1, name: 'ÚLOVEC' }]) { e.Story.onBossSpawn(e.game, { ...boss, state: 'FIGHT', phase: 1 }); assert.equal(e.Story.fight, null); }
  // střep, který ještě není k mání (chybí Poutník): nic
  e = makeEnv(['noise', 'channel'], { game: { inferno: true } }); e.Story.onRunStart(e.game);
  e.Story.onBossSpawn(e.game, { level: 1, name: 'STRÁŽCE', state: 'FIGHT', phase: 1 }); assert.equal(e.Story.fight, null);
  // lodě jen v Insane Pekle: v Pekle ne
  e = fightEnv('bastion', { insane: true }); assert.ok(e.Story.fight);
  e = makeEnv(upTo('bastion', false), { game: { inferno: true } }); e.Story.onRunStart(e.game);
  e.Story.onBossSpawn(e.game, { level: 7, name: 'BAŠTA', state: 'FIGHT', phase: 1 }); assert.equal(e.Story.fight, null, 'Bašta jen v Insane Pekle');
  // ve výcviku ani před příjmem příběhu nic
  e = makeEnv(upTo('warden', false), { game: { inferno: true, tutActive: true } });
  e.Story.onBossSpawn(e.game, { level: 1, name: 'STRÁŽCE', state: 'FIGHT', phase: 1 }); assert.equal(e.Story.fight, null);
  // Chyba: GLITCH se opakuje, hlídá se od čtrnáctého (jinak je to jen obyčejný boss)
  e = fightEnv('glitch'); assert.ok(e.Story.fight && e.Story.fight.shard === 'glitch');
  e = makeEnv(upTo('glitch', false), { game: { inferno: true, insane: true } }); e.Story.onRunStart(e.game);
  e.Story.onBossSpawn(e.game, { level: 14, name: 'GLITCH', state: 'FIGHT', phase: 1 }); assert.ok(e.Story.fight, 'čtrnáctý boss');
  e.Story.onBossSpawn(e.game, { level: 13, name: 'GLITCH', state: 'FIGHT', phase: 1 }); assert.equal(e.Story.fight, null, 'třináctý nikdy není GLITCH, ale i kdyby: ne');
});

test('Strážkyně (linie): střep dá jen boj, v němž loď zůstala uprostřed 80 % času po příletu; přílet se nepočítá', () => {
  const W = 390;
  let e = fightEnv('warden');
  e.game.boss.state = 'ENTRY';
  fight(e, 5000, () => ({ x: 5 }));
  assert.equal(e.Story.fight.t, 0, 'během příletu se čas nepočítá');
  e.game.boss.state = 'FIGHT';
  fight(e, 10000, () => ({ x: W / 2 }));
  kill(e);
  assert.equal(has(e, 'warden'), true);
  assert.equal(e.log.toasts.at(-1).name, 'Střep IV: Strážkyně');
  assert.equal(hidden(e, 'story-mark'), true, 'po souboji ukazatel zmizí');
  // 70 % v pásu nestačí
  e = fightEnv('warden');
  fight(e, 10000, (t) => ({ x: t < 7000 ? W / 2 : 5 }));
  kill(e);
  assert.equal(has(e, 'warden'), false);
  // ukazatel pohasne, když se linie poruší
  e = fightEnv('warden');
  fight(e, 8000, () => ({ x: 5 }));
  assert.equal(e.el('story-mark').classList.contains('broken'), true);
  assert.ok(e.log.sounds.includes('crack'));
});

test('Vír (okraj) a Odstřelovač (dole): drží se u kraje 70 %, resp. u dna 85 % boje', () => {
  let e = fightEnv('vortex', { insane: false });
  fight(e, 20000, (t) => ({ x: t % 3000 < 600 ? 195 : 10 }));   // 80 % u okraje
  kill(e); assert.equal(has(e, 'vortex'), true);
  e = fightEnv('vortex', { insane: false });
  fight(e, 20000, (t) => ({ x: t % 2000 < 1000 ? 195 : 10 }));  // 50 %
  kill(e); assert.equal(has(e, 'vortex'), false);
  e = fightEnv('vortex', { insane: false });
  fight(e, 20000, (t) => ({ x: t % 2000 < 1400 ? 380 : 195 }));  // pravý okraj se počítá taky (70 %)
  kill(e); assert.equal(has(e, 'vortex'), true);
  e = fightEnv('sniper');
  fight(e, 20000, (t) => ({ y: t % 10000 < 1000 ? 600 : 740 }));  // 90 % dole
  kill(e); assert.equal(has(e, 'sniper'), true);
  e = fightEnv('sniper');
  fight(e, 20000, (t) => ({ y: t % 10000 < 2000 ? 600 : 740 }));  // 80 %
  kill(e); assert.equal(has(e, 'sniper'), false);
  // příliš krátký boj se nepočítá
  e = fightEnv('sniper');
  fight(e, 4000, () => ({ y: 770 }));
  kill(e); assert.equal(has(e, 'sniper'), false, 'boj kratší než úvodní lhůta');
});

test('Prizma (paprsek), Archont (bez bomby a daru), Nemesis (bez zásahu): jako dřív, jen v Pekle', () => {
  let e = fightEnv('prism', { insane: false });
  e.Story.onHit(e.game, 'bullet'); e.game.bossNoHit = false;
  fight(e, 3000); kill(e); assert.equal(has(e, 'prism'), true, 'jiný zásah než paprskem nevadí');
  e = fightEnv('prism', { insane: false }); e.Story.onHit(e.game, 'beam'); fight(e, 3000); kill(e); assert.equal(has(e, 'prism'), false);
  e = fightEnv('archon', { insane: false }); fight(e, 3000); kill(e); assert.equal(has(e, 'archon'), true);
  e = fightEnv('archon', { insane: false }); e.Storage.data.stats.bombsUsed = 1; fight(e, 3000); kill(e); assert.equal(has(e, 'archon'), false, 'bomba');
  e = fightEnv('archon', { insane: false }); e.Storage.data.stats.pickups_power = 1; fight(e, 3000); kill(e); assert.equal(has(e, 'archon'), false, 'dar');
  e = fightEnv('archon', { insane: false }); e.Storage.data.stats.pickups_coin = 1; fight(e, 3000); kill(e); assert.equal(has(e, 'archon'), false, 'mince je dar');
  e = fightEnv('nemesis', { insane: false }); fight(e, 3000); kill(e); assert.equal(has(e, 'nemesis'), true);
  e = fightEnv('nemesis', { insane: false }); e.game.bossNoHit = false; fight(e, 3000); kill(e); assert.equal(has(e, 'nemesis'), false);
  // bomba před bossem (dřív než souboj) nevadí
  e = makeEnv(upTo('archon', false), { game: { inferno: true }, stats: { bombsUsed: 4, pickups_heal: 7 } }); e.Story.onRunStart(e.game);
  e.game.boss = { level: 6, name: 'ARCHONT', state: 'FIGHT', phase: 1 }; e.Story.onBossSpawn(e.game, e.game.boss);
  fight(e, 3000); kill(e); assert.equal(has(e, 'archon'), true);
});

test('Úlovec (kombo 12), Rojnice (25 zničených) a jejich ukazatel s čítačem', () => {
  let e = fightEnv('hunter', { insane: false });
  fight(e, 3000, () => ({ combo: 7 }));
  assert.equal(e.el('story-mark-n').innerText, '7/12');
  fight(e, 3000, (t) => ({ combo: t < 1000 ? 12 : 0 }));   // kombo se rozpadlo, ale padesát ho předtím bylo dvanáct
  kill(e); assert.equal(has(e, 'hunter'), true);
  e = fightEnv('hunter', { insane: false }); fight(e, 3000, () => ({ combo: 11 })); kill(e); assert.equal(has(e, 'hunter'), false);
  e = fightEnv('swarm');
  e.game.kills = 100; e.Story.onBossSpawn(e.game, e.game.boss);   // zničení před příletem bosse se nepočítají
  fight(e, 1000);
  e.game.kills += 24; fight(e, 100);
  assert.equal(e.el('story-mark-n').innerText, '24/25');
  kill(e); assert.equal(has(e, 'swarm'), false);
  e = fightEnv('swarm'); e.game.kills = 50; e.Story.onBossSpawn(e.game, e.game.boss);
  e.game.kills += 25; fight(e, 100); kill(e); assert.equal(has(e, 'swarm'), true);
  assert.equal(e.el('story-mark').classList.contains('broken'), false, 'čítač neznamená "rozbité"');
});

test('Trhač (zuřivost bez zásahu), Hradba (bez bomby a zuřivosti), Zátma (bez štítu a bomby), Leviatan (bez bomby a zásahu): zásahy a štít se počítají správně', () => {
  // Trhač: zásahy ve fázi 1 a 2 nevadí, ve fázi 3 ano
  let e = fightEnv('ripper', { insane: false });
  e.game.boss.phase = 1; e.Story.onHit(e.game, 'bullet'); e.game.boss.phase = 2; e.Story.onHit(e.game, 'bullet');
  fight(e, 3000, (t) => ({ phase: 3 })); kill(e); assert.equal(has(e, 'ripper'), true);
  e = fightEnv('ripper', { insane: false }); fight(e, 1000, () => ({ phase: 3 })); e.Story.onHit(e.game, 'bullet'); kill(e); assert.equal(has(e, 'ripper'), false);
  // Hradba: obě pravidla
  e = fightEnv('rampart'); fight(e, 3000, () => ({ phase: 3 })); kill(e); assert.equal(has(e, 'rampart'), true);
  e = fightEnv('rampart'); e.Storage.data.stats.bombsUsed = 2; fight(e, 3000); kill(e); assert.equal(has(e, 'rampart'), false, 'bomba');
  e = fightEnv('rampart'); fight(e, 1000, () => ({ phase: 3 })); e.Story.onHit(e.game, 'bullet'); kill(e); assert.equal(has(e, 'rampart'), false, 'zásah ve zuřivosti');
  // Zátma: štít kdykoli v souboji ji zruší
  e = fightEnv('gloom'); fight(e, 3000); kill(e); assert.equal(has(e, 'gloom'), true);
  e = fightEnv('gloom'); fight(e, 3000, (t) => ({ shield: t === 1000 })); kill(e); assert.equal(has(e, 'gloom'), false, 'štít na vteřinu');
  assert.equal(e.el('story-mark').classList.contains('broken'), false, 'po zabití bosse ukazatel zmizel');
  e = fightEnv('gloom'); fight(e, 600, () => ({ shield: true }));
  assert.equal(e.el('story-mark').classList.contains('broken'), true, 'ukazatel pohasne hned');
  // Leviatan
  e = fightEnv('leviathan'); fight(e, 3000); kill(e); assert.equal(has(e, 'leviathan'), true);
  e = fightEnv('leviathan'); e.game.bossNoHit = false; fight(e, 3000); kill(e); assert.equal(has(e, 'leviathan'), false);
  e = fightEnv('leviathan'); e.Storage.data.stats.bombsUsed = 1; fight(e, 3000); kill(e); assert.equal(has(e, 'leviathan'), false);
  // Bašta: žádný dar
  e = fightEnv('bastion'); fight(e, 3000); kill(e); assert.equal(has(e, 'bastion'), true);
  e = fightEnv('bastion'); e.Storage.data.stats.pickups_heal = 1; fight(e, 3000); kill(e); assert.equal(has(e, 'bastion'), false);
  e = fightEnv('bastion'); e.Storage.data.stats.bombsUsed = 5; fight(e, 3000); kill(e); assert.equal(has(e, 'bastion'), true, 'bomba Bašti nevadí');
});

test('Chyba (GLITCH): bez bomby, bez štítu a bez zásahu ve zuřivosti; teprve pak se otevře Marek (Střep XXXII přijde sám)', () => {
  let e = fightEnv('glitch'); fight(e, 3000, () => ({ phase: 3 })); kill(e);
  assert.equal(has(e, 'glitch'), true);
  assert.equal(has(e, 'marek'), true, 'další střep se odemkl sám');
  assert.deepEqual(e.log.toasts.map((t) => t.name).slice(-2), ['Střep XXXI: Chyba', 'Střep XXXII: Marek']);
  for (const bad of [(x) => { x.Storage.data.stats.bombsUsed = 1; }, (x) => { x.game.shieldOn = true; }, (x) => { x.game.boss.phase = 3; x.Story.onHit(x.game, 'bullet'); }]) {
    e = fightEnv('glitch'); bad(e);
    fight(e, 3000, () => ({ phase: 3, shield: !!e.game.shieldOn })); kill(e);
    assert.equal(has(e, 'glitch'), false);
  }
  // zásah mimo zuřivost nevadí
  e = fightEnv('glitch'); e.game.boss.phase = 1; e.Story.onHit(e.game, 'bullet'); fight(e, 3000, () => ({ phase: 3 })); kill(e);
  assert.equal(has(e, 'glitch'), true);
});

test('zvyky: boss, který zemřel bez střepu, nic nedá; následující boss se hlídá znovu; konec běhu souboj zruší; GLITCH mimo Insane Peklo ne', () => {
  let e = fightEnv('warden');
  e.Story.onRunEnd(e.game, true, 'death');
  assert.equal(e.Story.fight, null);
  assert.equal(hidden(e, 'story-mark'), true);
  e = fightEnv('hunter', { insane: false });
  e.Story.onBossSpawn(e.game, { level: 3, name: 'TRHÁČ', state: 'FIGHT', phase: 1 });
  assert.equal(e.Story.fight.shard, 'ripper', 'další boss přepíše souboj vlastním střepem');
  e.Story.onBossSpawn(e.game, { level: 7, name: 'BAŠTA', state: 'FIGHT', phase: 1 });
  assert.equal(e.Story.fight, null, 'Bašta jen v Insane Pekle: ukazatel zmizí');
  assert.equal(hidden(e, 'story-mark'), true);
  e = makeEnv(upTo('glitch', false), { game: { inferno: true } }); e.Story.onRunStart(e.game);
  e.Story.onBossSpawn(e.game, { level: 14, name: 'GLITCH', state: 'FIGHT', phase: 1 });
  assert.equal(e.Story.fight, null, 'jen v Insane Pekle');
});

/* ---------------------------------------------------------------- počítadla a zkoušky */
test('počítadla: sčítají se jen od chvíle, kdy je střep k mání, jen v pravém režimu, a při dosažení cíle se střep odemkne a postup zmizí', () => {
  // Počítadlo (zničení nepřátelé v Pekle) až po Podpisu
  let e = makeEnv(upTo('seznam'), { game: { inferno: true } });
  for (let i = 0; i < 500; i++) e.Story.onKill(e.game);
  assert.deepEqual(plain(e.Story.d().prog), {}, 'kniha IV ještě není otevřená: nic se nezapisuje');
  e = makeEnv(upTo('podpis'), { game: { inferno: true } });
  for (let i = 0; i < 123; i++) e.Story.onKill(e.game);
  assert.equal(e.Story.d().prog.counter, 123);
  assert.ok(e.log.queue > 0 && e.log.save === 0, 'průběh se ukládá odloženě');
  const n = makeEnv(upTo('podpis'), { game: {} });
  n.Story.onKill(n.game);
  assert.deepEqual(plain(n.Story.d().prog), {}, 'normální režim se nepočítá');
  const t = makeEnv(upTo('podpis'), { game: { inferno: true, tutActive: true } });
  t.Story.onKill(t.game);
  assert.deepEqual(plain(t.Story.d().prog), {}, 'výcvik se nepočítá');
  e.Story.d().prog.counter = api.STORY_KILLS - 3;
  e.Story.onKill(e.game); e.Story.onKill(e.game);
  assert.equal(has(e, 'counter'), false, 'ještě jeden chybí');
  e.Story.onKill(e.game);
  assert.equal(has(e, 'counter'), true);
  assert.equal(e.Story.d().prog.counter, undefined, 'dosažený cíl se nezapisuje');
  assert.equal(e.log.toasts.at(-1).name, 'Střep XXV: Počítadlo');
  e.Story.onKill(e.game);
  assert.deepEqual(plain(e.Story.d().prog), {}, 'po nálezu se dál nesčítá');
});

test('počítadla: utracený prach plní nejdřív Prach a až potom (jako samostatný krok) Prstenec; Vzestupy plní Cyklus', () => {
  let e = makeEnv(upTo('echo'));
  e.Story.onStardustSpent(1000);
  assert.equal(e.Story.d().prog.dust, 1000);
  assert.equal(has(e, 'dust'), false);
  e.Story.onStardustSpent(500);
  assert.equal(has(e, 'dust'), true, 'Prach: 1 500');
  assert.equal(e.log.toasts.at(-1).name, 'Střep XIII: Prach');
  e.Story.onStardustSpent(9999);
  assert.equal(e.Story.d().prog.ring, undefined, 'Prstenec ještě není k mání');
  // Prstenec a Cyklus po Podpisu
  e = makeEnv(upTo('podpis'));
  e.Story.onStardustSpent(4000);
  assert.equal(e.Story.d().prog.ring, 4000);
  e.Story.onStardustSpent(1000);
  assert.equal(has(e, 'ring'), true, 'Prstenec: 5 000');
  e.Story.onAscend(); e.Story.onAscend();
  assert.equal(e.Story.d().prog.cycle, 2);
  assert.equal(has(e, 'cycle'), false);
  e.Story.onAscend();
  assert.equal(has(e, 'cycle'), true, 'Cyklus: tři Vzestupy');
  // zvolání bez částky (starý způsob) počítá jako jeden kus
  e = makeEnv(upTo('echo')); e.Story.onStardustSpent(); assert.equal(e.Story.d().prog.dust, 1);
});

test('zkoušky: Oheň (boss v Insane Pekle), Ticho (Zen 10 minut), Dech (Blesková vlna bez bomby a s nejvýš čtyřmi zásahy)', () => {
  // Oheň: jen Insane Peklo, jakýkoli boss
  let e = makeEnv(upTo('echo'), { game: { inferno: true, insane: false } });
  e.Story.onBossKilled(e.game);
  assert.equal(has(e, 'fire'), false, 'Peklo nestačí');
  e = makeEnv(upTo('echo'), { game: { inferno: true, insane: true } });
  e.Story.onBossKilled(e.game);
  assert.equal(has(e, 'fire'), true);
  e = makeEnv(upTo('home'), { game: { inferno: true, insane: true } });
  e.Story.onBossKilled(e.game);
  assert.equal(has(e, 'fire'), false, 'bez Ozvěny nic (ta se ale doplní sama: viz dál)');
  e.Story.sync(); assert.equal(has(e, 'echo'), true);
  // Ticho
  e = makeEnv(upTo('echo'), { game: { mode: 'zen' } });
  e.game.runTime = api.STORY_ZEN_MS - 1000; step(e, 10, 16);
  assert.equal(has(e, 'silence'), false);
  e.game.runTime = api.STORY_ZEN_MS; step(e, 70, 16);
  assert.equal(has(e, 'silence'), true);
  e = makeEnv(upTo('echo'), { game: { mode: 'normal' } }); e.game.runTime = 9e6; step(e, 100);
  assert.equal(has(e, 'silence'), false, 'jen v Zenu');
  // Dech
  const blitz = (zmena) => { const x = makeEnv(upTo('echo'), { game: { mode: 'blitz' } }); x.Story.onRunStart(x.game); zmena(x); x.Story.onRunEnd(x.game, true, 'timeup'); return x; };
  assert.equal(has(blitz(() => {}), 'breath'), true);
  assert.equal(has(blitz((x) => { for (let i = 0; i < 4; i++) x.Story.onHit(x.game, 'bullet'); }), 'breath'), true, 'čtyři zásahy projdou');
  assert.equal(has(blitz((x) => { for (let i = 0; i < 5; i++) x.Story.onHit(x.game, 'bullet'); }), 'breath'), false, 'pět zásahů ne');
  assert.equal(has(blitz((x) => { x.Storage.data.stats.bombsUsed = 1; }), 'breath'), false, 'bomba');
  const quit = makeEnv(upTo('echo'), { game: { mode: 'blitz' } }); quit.Story.onRunStart(quit.game); quit.Story.onRunEnd(quit.game, true, 'death');
  assert.equal(has(quit, 'breath'), false, 'jen dokončená vlna');
  const other = makeEnv(upTo('echo'), { game: { mode: 'hard' } }); other.Story.onRunStart(other.game); other.Story.onRunEnd(other.game, true, 'timeup');
  assert.equal(has(other, 'breath'), false);
  const tut = makeEnv(upTo('echo'), { game: { mode: 'blitz', tutActive: true } }); tut.Story.onRunEnd(tut.game, true, 'timeup');
  assert.equal(has(tut, 'breath'), false);
  // zásahy z minulého běhu se do dalšího nepřenášejí
  const again = makeEnv(upTo('echo'), { game: { mode: 'blitz' } });
  again.Story.onRunStart(again.game); for (let i = 0; i < 9; i++) again.Story.onHit(again.game, 'bullet');
  again.Story.onRunStart(again.game); again.Story.onRunEnd(again.game, true, 'timeup');
  assert.equal(has(again, 'breath'), true);
});

test('zkoušky Knihy IV: Vigilie (25 minut v jednom běhu Insane Pekla), Svědek (20 bossů v Boss Rush), Hluboká noc (12 bossů bez zásahu v Insane Pekle)', () => {
  // Vigilie
  let e = makeEnv(upTo('podpis'), { game: { inferno: true, insane: true } });
  e.game.runTime = api.STORY_VIGIL_MS - 2000; step(e, 100, 16);
  assert.equal(has(e, 'vigil'), false);
  e.game.runTime = api.STORY_VIGIL_MS; step(e, 70, 16);
  assert.equal(has(e, 'vigil'), true);
  e = makeEnv(upTo('podpis'), { game: { inferno: true, insane: false } }); e.game.runTime = 9e6; step(e, 100);
  assert.equal(has(e, 'vigil'), false, 'Peklo nestačí');
  e = makeEnv(upTo('echo'), { game: { inferno: true, insane: true } }); e.game.runTime = 9e6; step(e, 100);
  assert.equal(has(e, 'vigil'), false, 'ještě není k mání');
  // Svědek: série se zvýší až po volání onBossKilled
  e = makeEnv(upTo('podpis'), { game: { mode: 'rush' } });
  e.game.rushStreak = 18; e.Story.onBossKilled(e.game);
  assert.equal(has(e, 'witness'), false, 'devatenáctý boss');
  e.game.rushStreak = 19; e.Story.onBossKilled(e.game);
  assert.equal(has(e, 'witness'), true, 'dvacátý boss');
  e = makeEnv(upTo('podpis'), { game: { mode: 'rush' } }); e.game.rushStreak = 20; e.Story.onRunStart(e.game); e.game.rushStreak = 20; e.Story.onRunEnd(e.game, true, 'rush_death');
  assert.equal(has(e, 'witness'), true, 'i podle konečné série');
  e = makeEnv(upTo('podpis'), { game: { mode: 'hard' } }); e.game.rushStreak = 99; e.Story.onBossKilled(e.game);
  assert.equal(has(e, 'witness'), false, 'jen Boss Rush');
  // Hluboká noc
  e = makeEnv(upTo('podpis'), { game: { inferno: true, insane: true } });
  for (let i = 0; i < 11; i++) { e.game.bossNoHit = true; e.Story.onBossKilled(e.game); }
  assert.equal(e.Story.d().prog.dark, 11);
  e.game.bossNoHit = false; e.Story.onBossKilled(e.game);
  assert.equal(e.Story.d().prog.dark, 11, 'zasažený boj se nepočítá');
  e.game.bossNoHit = true; e.Story.onBossKilled(e.game);
  assert.equal(has(e, 'dark'), true);
  e = makeEnv(upTo('podpis'), { game: { inferno: true, insane: false } });
  e.game.bossNoHit = true; e.Story.onBossKilled(e.game);
  assert.equal(e.Story.d().prog.dark, undefined, 'jen Insane Peklo');
});

test('návaznosti mezi knihami se dějí samy: Ozvěna po Domově, Seznam po čtyřech zbylých, Marek po Chybě; sync je opakovatelný a nic neduplikuje', () => {
  let e = makeEnv(upTo('home'));
  e.Story.sync();
  assert.equal(has(e, 'echo'), true);
  assert.equal(e.log.toasts.filter((t) => t.name.includes('Ozvěna')).length, 1);
  e.Story.sync(); e.Story.sync();
  assert.equal(e.log.toasts.filter((t) => t.name.includes('Ozvěna')).length, 1, 'jen jednou');
  e = makeEnv(['noise', 'channel', 'wanderer', 'warden', 'prism', 'archon', 'nemesis', 'home', 'echo', 'fire', 'silence', 'breath']);
  e.Story.sync(); assert.equal(has(e, 'seznam'), false, 'chybí Prach');
  e.Story.d().found.dust = 5; e.Story.sync();
  assert.equal(has(e, 'seznam'), true);
  // sync se spustí i při obnovení tlačítek (po načtení hry)
  e = makeEnv(upTo('home')); e.Story.refreshButtons();
  assert.equal(has(e, 'echo'), true);
  // před příjmem příběhu sync nic nedělá
  e = makeEnv({}); e.Story.sync(); assert.deepEqual(plain(e.Story.d().found), {});
});

/* ---------------------------------------------------------------- cutscény z archivu */
test('Seznam flotily: k mání až s devíti loděmi; scéna rozsvěcí světla po řadě, na konci čeká na Pokračovat a teprve pak dá Podpis', () => {
  let e = makeEnv(upTo('podpis', false).filter((x) => x !== 'leviathan'));
  assert.equal(e.Story.canSeznam(), false);
  e.Story.openArchive('menu', false);
  assert.ok(!e.el('story-actions').innerHTML.includes('data-act="rollcall"'), 'tlačítko až s devíti');
  e.Story.act('rollcall');
  assert.equal(e.Story.scn, null, 'bez devíti se scéna nespustí');
  e = makeEnv(upTo('podpis', false));
  e.Story.openArchive('menu', false);
  assert.ok(e.el('story-actions').innerHTML.includes('data-act="rollcall"'));
  e.Story.act('rollcall');
  assert.equal(e.Story.scn.id, 'rollcall');
  assert.equal(e.Story.scn.run, false);
  assert.equal(e.game.state, 'SCENE');
  assert.equal(hidden(e, 'story-overlay'), true, 'archiv se na dobu scény schová');
  let lastLit = -1;
  for (let i = 0; i < 60 && e.Story.scn && e.Story.scn.phase !== 'end'; i++) {
    e.Story.sceneUpdate(e.Story.scn.dur);
    assert.ok(e.Story.scn.lit >= lastLit);
    lastLit = e.Story.scn.lit;
  }
  assert.equal(e.Story.scn.phase, 'end');
  assert.equal(e.Story.scn.lit, 13, 'všech čtrnáct světel svítí');
  assert.equal(hidden(e, 'finale-done'), false);
  assert.equal(e.el('finale-done').innerText, 'Pokračovat');
  assert.equal(has(e, 'podpis'), false, 'dokud hráč nepokračuje, nic se nezapíše');
  assert.ok(e.log.sounds.filter((s) => s === 'chime').length >= 14, 'každé jméno zazvoní');
  e.Story.endScene();
  assert.equal(has(e, 'podpis'), true);
  assert.equal(e.log.toasts.at(-1).name, 'Střep XXIV: Podpis');
  assert.equal(e.game.state, 'ARCHIVE', 'zpátky v archivu');
  assert.equal(hidden(e, 'story-overlay'), false);
  assert.equal(e.Story.canSeznam(), false);
  assert.ok(!e.el('story-actions').innerHTML.includes('rollcall'));
  assert.equal(e.Story.d().done, false);
});

test('poslední volba: tři konce, každý jiný text; zápis konce dokončí příběh (hlásí se odznak), jinak nic; konec se nedá změnit', () => {
  const ids = upTo('marek');
  for (const ending of ['light', 'rest', 'door']) {
    const e = makeEnv(ids);
    assert.equal(e.Story.canChoose(), true);
    e.Story.openArchive('menu', false);
    assert.ok(e.el('story-actions').innerHTML.includes('data-act="odstavec13"'));
    e.Story.act('odstavec13');
    assert.equal(e.Story.scn.id, 'odstavec13');
    e.Story.skipScene();
    assert.equal(e.Story.scn.phase, 'choice');
    assert.ok(STORY_ENDINGS.every((x) => e.el('scene-choices').innerHTML.includes(`data-choice="${x}"`)));
    e.Story.chooseScene(ending);
    // pokračování je text konce a poslední věta je největší
    assert.equal(e.Story.scn.beats.length, BY_ID['end_' + ending].memory.length);
    assert.equal(e.Story.scn.beats.at(-1).c, 'big');
    assert.equal(e.Story.scn.beats[0].say, BY_ID['end_' + ending].memory[0]);
    e.Story.sceneUpdate(99999); for (let i = 0; i < 8; i++) e.Story.sceneUpdate(e.Story.scn.dur);
    assert.equal(e.Story.scn.phase, 'end');
    assert.equal(e.el('finale-done').innerText, 'Dokončit');
    assert.equal(e.Story.d().done, false, 'dokud hráč nedokončí, nic se nezapíše');
    const saved = e.log.save;
    e.Story.endScene();
    assert.equal(e.Story.d().done, true);
    assert.equal(e.Story.d().ending, ending);
    assert.equal(has(e, 'end_' + ending), true);
    assert.equal(e.log.toasts.at(-1).name, 'Střep XXXIII: ' + BY_ID['end_' + ending].title);
    assert.ok(e.log.save > saved, 'postup se uložil (a tím ohlásil serveru)');
    assert.ok(e.log.resized >= 1, 'pozadí se postavilo znovu: Jomarid svítí');
    assert.equal(e.Story.canChoose(), false, 'konec se nedá změnit');
    e.Story.act('odstavec13');
    assert.equal(e.Story.scn, null);
    assert.equal(e.game.state, 'ARCHIVE');
    assert.equal(e.el('story-sub').innerText, 'Příběh je dokončený');
  }
  // před Markem volba není
  const early = makeEnv(upTo('glitch'));
  early.Story.openArchive('menu', false);
  assert.ok(!early.el('story-actions').innerHTML.includes('odstavec13'), 'Marek se otevře až po Chybě');
  early.Story.act('odstavec13');
  assert.equal(early.Story.scn, null);
});

test('náhled z cheat menu: projde všechny scény i volbu, ale nic nezapíše a odznak se nedá', () => {
  const e = makeEnv({});
  e.Story.openArchive('menu', true);
  assert.ok(['odstavec12', 'finale', 'rollcall', 'odstavec13'].every((a) => e.el('story-actions').innerHTML.includes(`data-act="${a}"`)), 'v náhledu všechny čtyři');
  assert.equal(hidden(e, 'story-preview'), false);
  // prolog: Naslouchat v náhledu nic neodemkne a příběh nepřijme
  e.Story.act('odstavec12');
  assert.equal(e.Story.scn.run, false);
  assert.equal(e.Story.scn.beats.length, STORY_SCENES.odstavec12.beats.length);
  e.Story.skipScene(); e.Story.chooseScene('listen'); e.Story.skipScene();
  assert.equal(e.Story.scn, null);
  assert.equal(e.Story.d().awake, false);
  assert.deepEqual(plain(e.Story.d().found), {});
  assert.equal(e.game.state, 'ARCHIVE');
  // poslední volba
  e.Story.act('odstavec13'); e.Story.skipScene(); e.Story.chooseScene('door'); e.Story.skipScene();
  e.Story.endScene();
  assert.equal(e.Story.d().done, false);
  assert.equal(e.Story.d().ending, '');
  assert.equal(e.log.save, 0);
  assert.equal(e.log.toasts.length, 0);
  assert.equal(e.game.state, 'ARCHIVE');
  e.Story.closeArchive();
  assert.equal(e.game.state, 'MENU');
});

/* ---------------------------------------------------------------- archiv */
test('archiv: knihy s nadpisy, jen nalezené střepy, nepřečtené označené; stopy jen k mání s nápovědou, postupem a jmény kapitánů; tlačítka scén podle postupu', () => {
  const e = makeEnv(upTo('wanderer'));
  e.Story.openArchive('menu', false);
  assert.equal(e.game.state, 'ARCHIVE');
  const list = e.el('story-list').innerHTML;
  assert.equal((list.match(/<article class="shard/g) || []).length, 3);
  assert.ok(list.includes('Hlas v šumu') && !list.includes('Rozházené'), 'jen první kniha');
  assert.ok(list.includes('data-shard="noise"') && list.includes('data-shard="wanderer"') && !list.includes('data-shard="warden"'));
  assert.ok(list.includes('new-dot'), 'nepřečtené svítí');
  assert.ok(e.Story.d().seen.noise, 'první nepřečtený se rovnou otevřel a označil');
  assert.equal(e.el('story-sub').innerText, 'Kniha I: Hlas v šumu');
  const leads = e.el('story-caps').innerHTML;
  for (const id of ['warden', 'prism', 'archon', 'nemesis']) assert.ok(leads.includes(BY_ID[id].hint.replace(/&/g, '&amp;')) || leads.includes(BY_ID[id].how.name), id);
  assert.ok(leads.includes('Strážkyně') && leads.includes('pro Systém STRÁŽCE'), 'jména kapitánů jsou znát předem');
  assert.ok(!leads.includes('Prach'), 'hotové ani nedostupné stopy se neukazují');
  assert.equal(hidden(e, 'story-caps'), false);
  assert.ok(!e.el('story-actions').innerHTML.includes('data-act'), 'žádná scéna zatím není k mání');
  // všechny čtyři kapitáni: stopa Domov a tlačítko Zazářit
  const f = makeEnv(upTo('home', false));
  f.Story.openArchive('menu', false);
  assert.ok(f.el('story-actions').innerHTML.includes('data-act="finale"'));
  assert.ok(f.el('story-caps').innerHTML.includes('Máš všechny čtyři'));
  // počítadlo s ukazatelem postupu
  const g = makeEnv(S(upTo('podpis'), { prog: { counter: 5000, ring: 2500 } }));
  g.Story.openArchive('menu', false);
  const gl = g.el('story-caps').innerHTML;
  assert.ok(gl.includes('story-bar') && gl.includes('width:25%'), 'Počítadlo 5 000 z 20 000');
  assert.ok(gl.includes('width:50%'), 'Prstenec 2 500 z 5 000');
  assert.ok(/5\s000 \/ 20\s000/.test(gl), 'číselný postup (mezera po tisících)');
  assert.ok(g.el('story-list').innerHTML.includes('story-book-title">Třináct hlasů'), 'nadpis třetí knihy je v seznamu');
  assert.ok(!g.el('story-list').innerHTML.includes('story-book-title">Chyba'), 'čtvrtá kniha se neukáže, dokud v ní nic není');
  assert.equal(g.el('story-sub').innerText, 'Kniha III: Třináct hlasů');
  // se Zrcadlem hotovým a Markem v ruce se ukáže čtvrtá kniha
  const h = makeEnv(upTo('marek'));
  h.Story.openArchive('menu', false);
  assert.ok(h.el('story-list').innerHTML.includes('story-book-title">Chyba'));
  assert.equal(h.el('story-sub').innerText, 'Kniha IV: Chyba');
});

test('archiv: titulky nenalezených střepů se neprozradí, v náhledu je vidět všechno, zavření vrací menu nebo konec hry', () => {
  const e = makeEnv(upTo('echo'));
  e.Story.openArchive('menu', false);
  const leads = e.el('story-caps').innerHTML;
  for (const id of ['fire', 'silence', 'breath', 'dust']) assert.ok(!leads.includes(`>${BY_ID[id].title}<`), `titulek ${id} se neprozradí`);
  assert.ok(leads.includes('class="st"'), 'zašuměný titulek');
  assert.equal((leads.match(/story-cap-hint/g) || []).length, 4, 'čtyři nápovědy');
  // náhled
  const p = makeEnv({});
  p.Story.openArchive('menu', true);
  assert.equal((p.el('story-list').innerHTML.match(/<article class="shard/g) || []).length, STORY_SHARDS.length, 'v náhledu všechny střepy');
  assert.ok(p.el('story-list').innerHTML.includes('Odstavec 13'));
  assert.equal(Object.keys(p.Story.d().seen).length, 0, 'náhled nic neoznačí jako přečtené');
  assert.equal(p.el('story-sub').innerText, 'Náhled všech knih');
  assert.equal(hidden(p, 'story-preview'), false);
  // zavření
  const m = makeEnv(['noise']); m.Story.openArchive('menu', false); m.Story.closeArchive();
  assert.equal(m.game.state, 'MENU');
  const g = makeEnv(['noise']); g.Story.openArchive('gameover', false);
  assert.equal(g.el('gameover-overlay').classList.contains('hidden'), true);
  g.Story.closeArchive();
  assert.equal(g.game.state, 'GAMEOVER');
  assert.equal(g.el('gameover-overlay').classList.contains('hidden'), false);
});

test('archiv má vlastní stav: mezerník ani Enter pod ním nespustí hru; cutscéna taky ne', () => {
  assert.match(html, /if \(this\.state === 'MENU'\) this\.start\('normal'\);\s*else if \(this\.state === 'GAMEOVER'\) this\.start\(this\.mode\);\s*else if \(this\.state === 'PAUSE'\) this\.resume\(\);/);
  const e = makeEnv(['noise']);
  e.Story.openArchive('menu', false);
  assert.equal(e.game.state, 'ARCHIVE');
  e.Story.startScene('rollcall', { preview: true });
  assert.equal(e.game.state, 'SCENE');
});

test('toggleShard a Kanál: rozbalení označí střep jako přečtený; slovo v2.9 přijme jen ten, kdo našel Šum, a jen jednou; otevře archiv na Kanálu', () => {
  let e = makeEnv({});
  assert.equal(e.Story.onCode('v2.9'), false, 'bez Šumu pole nic nedělá');
  e = makeEnv(['noise']);
  assert.equal(e.Story.onCode('abc'), false);
  assert.equal(e.Story.onCode('v2.9'), true);
  assert.equal(has(e, 'channel'), true);
  assert.equal(e.log.toasts.at(-1).name, 'Střep II: Kanál');
  assert.equal(e.game.state, 'ARCHIVE');
  assert.equal(e.Story.onCode('v2.9'), false, 'podruhé ne');
  const before = e.log.toasts.length;
  e.Story.onCode('v2.9');
  assert.equal(e.log.toasts.length, before);
  // štítek Šumu
  const art = { querySelector: (q) => (q === '.shard-body' ? body : head), classList: { remove() {} } };
  const cls = new Set(['hidden']);
  const body = { classList: { contains: (c) => cls.has(c), toggle: (c, f) => { if (f) cls.add(c); else cls.delete(c); } }, querySelectorAll: () => [] };
  const head = { setAttribute() {}, querySelector: () => null };
  e.ctx.document.querySelector = () => art;
  e.Story.d().seen = {};
  e.Story.toggleShard('noise');
  assert.equal(e.Story.d().seen.noise, true);
});

/* ---------------------------------------------------------------- finále první knihy */
test('finále první knihy: začne jen se všemi čtyřmi kapitány; držení a poklepání nabíjí a bez držení se nabití vrací', () => {
  let e = makeEnv(upTo('warden'));
  e.Story.startFinale();
  assert.equal(e.Story.fin, null, 'bez všech kapitánů se nespustí');
  e = makeEnv(upTo('home', false));
  assert.equal(e.Story.canFinale(), true);
  e.Story.openArchive('menu', false);
  e.Story.startFinale();
  assert.ok(e.Story.fin && e.game.state === 'FINALE');
  assert.equal(hidden(e, 'finale-layer'), false);
  assert.equal(hidden(e, 'story-overlay'), true);
  const run = (ms) => { for (let t = 0; t < ms; t += 50) e.Story.finaleUpdate(50); };
  run(2000);
  assert.equal(e.Story.fin.phase, 'intro');
  assert.equal(hidden(e, 'finale-hold'), true, 'tlačítko až po úvodu');
  e.Story.finaleHold(true);
  assert.equal(e.Story.fin.holding, false, 'v úvodu se držet nedá');
  run(4200);
  assert.equal(e.Story.fin.phase, 'charge');
  assert.equal(hidden(e, 'finale-hold'), false);
  e.Story.finaleHold(true); e.Story.finaleHold(false);
  const tapped = e.Story.fin.charge;
  assert.ok(tapped > 0 && tapped < 0.2, 'poklepání přidá kousek, ať to jde i bez držení');
  run(1000);
  assert.ok(e.Story.fin.charge < tapped, 'bez držení nabití slábne');
  e.Story.finaleHold(true);
  run(1500);
  assert.equal(e.Story.fin.phase, 'charge', 'půl nabití ještě nestačí');
  run(2500);
  assert.equal(e.Story.fin.phase, 'answer', 'tři vteřiny držení Zrcadlo rozzáří');
});

test('finále první knihy: celý průběh od držení po Dokončit uzavře první knihu (Domov, Jomarid svítí, Ozvěna sama) a nedokončí celý příběh; náhled nezapisuje nic', () => {
  const play = (e) => {
    e.Story.openArchive('menu', e.Story.preview);
    e.Story.startFinale();
    const run = (ms, hold) => { if (hold !== undefined) e.Story.finaleHold(hold); for (let t = 0; t < ms; t += 50) e.Story.finaleUpdate(50); };
    run(6200);
    run(4000, true);
    assert.equal(e.Story.fin.phase, 'answer');
    run(4600);
    run(13200);
    assert.equal(e.Story.fin.phase, 'keeper');
    assert.equal(e.Story.fin.landed, 13, 'přistálo třináct lodí');
    run(15000);
    assert.equal(hidden(e, 'finale-done'), false, 'na konci tlačítko Dokončit');
    e.Story.finishFinale();
  };
  const e = makeEnv(upTo('home', false));
  play(e);
  assert.equal(has(e, 'home'), true);
  assert.equal(e.Story.d().fin1, true, 'první kniha je dokončená');
  assert.equal(e.Story.d().done, false, 'celý příběh ne');
  assert.equal(has(e, 'echo'), true, 'druhá kniha se otevřela sama');
  assert.deepEqual(e.log.toasts.map((t) => t.name).slice(-2), ['Střep VIII: Domov', 'Střep IX: Ozvěna']);
  assert.equal(e.game.state, 'ARCHIVE', 'po finále se otevře archiv');
  assert.equal(e.Story.fin, null);
  assert.ok(e.log.save >= 1);
  assert.equal(e.Story.canFinale(), false);
  assert.ok(e.el('story-list').innerHTML.includes('Rozházené střepy'), 'nadpis druhé knihy');
  // náhled
  const p = makeEnv({}); p.Story.preview = true;
  p.Story.openArchive('menu', true); p.Story.startFinale();
  for (let t = 0; t < 6200; t += 50) p.Story.finaleUpdate(50);
  p.Story.finaleHold(true);
  for (let t = 0; t < 4000; t += 50) p.Story.finaleUpdate(50);
  for (let t = 0; t < 40000; t += 50) p.Story.finaleUpdate(50);
  p.Story.finishFinale();
  assert.equal(p.Story.d().fin1, false);
  assert.deepEqual(plain(p.Story.d().found), {});
  assert.equal(p.log.save, 0);
  assert.equal(p.log.toasts.length, 0);
  assert.equal(p.game.state, 'ARCHIVE');
  p.Story.closeArchive();
  assert.equal(p.game.state, 'MENU');
});

test('finále první knihy: Přerušit před odpovědí nic nezapíše, Přeskočit po odpovědi první knihu dokončí', () => {
  let e = makeEnv(upTo('home', false)); e.Story.openArchive('menu', false); e.Story.startFinale();
  for (let t = 0; t < 3000; t += 50) e.Story.finaleUpdate(50);
  e.Story.skipFinale();
  assert.equal(e.Story.d().fin1, false);
  assert.equal(e.Story.fin, null);
  assert.equal(e.game.state, 'ARCHIVE');
  assert.equal(hidden(e, 'story-overlay'), false, 'zpátky v archivu, odkud šel');
  e.Story.closeArchive();
  assert.equal(e.game.state, 'MENU');
  e = makeEnv(upTo('home', false)); e.Story.openArchive('menu', false); e.Story.startFinale();
  for (let t = 0; t < 6200; t += 50) e.Story.finaleUpdate(50);
  e.Story.finaleHold(true);
  for (let t = 0; t < 4000; t += 50) e.Story.finaleUpdate(50);
  assert.equal(e.Story.fin.answered, true);
  e.Story.skipFinale();
  assert.equal(e.Story.d().fin1, true, 'po odpovědi se přeskočení počítá jako dokončené');
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

test('finále první knihy se po celou dobu vykreslí bez výjimky a bez vadných hodnot (záporný poloměr kruhu dřív hru zmrazil při rozsvícení majáku)', () => {
  for (const [w, h] of [[390, 780], [320, 568], [620, 900]]) {
    const e = makeEnv(upTo('home', false), { game: { width: w, height: h } });
    const { ctx, bad } = strictCanvas();
    e.Story.openArchive('menu', false);
    e.Story.startFinale();
    let frames = 0, reachedKeeper = 0;
    for (let t = 0; t < 70000 && e.Story.fin; t += 16) {
      if (e.Story.fin.phase === 'charge' && !e.Story.fin.holding) e.Story.finaleHold(true);
      e.Story.finaleUpdate(16);
      e.Story.finaleDraw(ctx);
      frames++;
      if (e.Story.fin.phase === 'keeper') reachedKeeper++;
    }
    assert.deepEqual(bad, [], `${w}x${h}: vadné kreslení`);
    assert.ok(frames > 3000 && reachedKeeper > 500, `${w}x${h}: celá časová osa se prošla`);
    assert.equal(e.Story.off, false);
    assert.deepEqual(e.log.errors, []);
  }
});

test('cutscény se vykreslí po celou dobu bez výjimky a bez vadných hodnot na všech velikostech obrazovky a při všech délkách snímku', () => {
  for (const [w, h] of [[390, 780], [320, 568], [900, 500], [1280, 720]]) {
    for (const dt of [4, 16, 100]) {
      for (const id of ['odstavec12', 'rollcall', 'odstavec13']) {
        const ids = id === 'rollcall' ? upTo('podpis', false) : id === 'odstavec13' ? upTo('marek') : [];
        const e = makeEnv(ids, { game: { width: w, height: h } });
        const { ctx, bad } = strictCanvas();
        e.Story.startScene(id, { preview: true });
        let frames = 0, choiceSeen = false, guard = 0;
        // snímek po snímku jako ve smyčce; u voleb se vždy vybere první (a v odstavci 13 postupně všechny konce)
        while (e.Story.scn && guard++ < 200000) {
          if (e.Story.scn.phase === 'choice') { choiceSeen = true; e.Story.chooseScene(e.Story.scn.def.choice[e.Story.scn.def.choice.length - 1].id); }
          if (e.Story.scn.phase === 'end') break;
          e.Story.sceneUpdate(dt); e.Story.sceneDraw(ctx); frames++;
        }
        assert.deepEqual(bad.slice(0, 3), [], `${id} ${w}x${h} ${dt} ms: vadné kreslení`);
        assert.ok(frames > 20, `${id}: scéna se prošla`);
        assert.equal(choiceSeen, id !== 'rollcall', `${id}: volba`);
        assert.equal(e.Story.off, false);
        assert.deepEqual(e.log.errors, []);
      }
    }
  }
  // každý efekt a každý odstín v krajních hodnotách síly
  const e = makeEnv([]); const { ctx, bad } = strictCanvas();
  e.Story.startScene('rollcall', { preview: true });
  for (const fx of ['alarm', 'static', 'calm', 'ring', 'dawn']) for (const hue of ['gold', 'violet', 'blue', 'nic']) for (const k of [0, 0.3, 1, 5, -2]) for (const t of [0, 500, 90000]) {
    Object.assign(e.Story.scn, { fx, hue, k, t, bt: t, lit: 13, ship: 13 });
    e.Story.sceneDraw(ctx);
  }
  assert.deepEqual(bad, []);
});

test('Poutník a vodítka zvyků (linie, okraj, dole) se vykreslí bez vadných hodnot ve všech stavech', () => {
  const e = makeEnv(upTo('wanderer'));
  const { ctx, bad } = strictCanvas();
  for (const flash of [0, 160]) for (const tt of [0, 1200, 2399, 5000]) e.Story.drawWanderer(ctx, { x: 50, y: 400, t: tt, flash, hp: 5 });
  for (const x of [0, 195, 390, 1e4, -50]) for (const y of [0, 700, 780, 5000]) {
    e.game.player.x = x; e.game.player.y = y;
    e.Story.drawBand(ctx, e.game); e.Story.drawEdges(ctx, e.game); e.Story.drawLow(ctx, e.game);
  }
  for (const rule of ['line', 'edge', 'low', ['edge', 'low'], 'flawless', ['nobomb', 'p3flawless']]) { e.Story.fight = rec({ rule }); e.Story.drawBack(ctx, e.game); }
  assert.deepEqual(bad, []);
});

test('pojistka: výjimka v příběhu hru nezastaví, příběh se vypne a rozehrané finále skončí v menu', () => {
  const e = makeEnv(upTo('home', false));
  vm.runInContext(GUARD, e.ctx);
  e.Story.openArchive('menu', false);
  e.Story.startFinale();
  assert.equal(e.game.state, 'FINALE');
  const S2 = vm.runInContext('Story', e.ctx);
  // rozbitý stav: kreslení finále vyhodí výjimku
  S2.fin.fleet = null;
  assert.doesNotThrow(() => S2.finaleDraw(strictCanvas().ctx));
  assert.equal(S2.off, true);
  assert.equal(S2.fin, null);
  assert.equal(e.game.state, 'MENU');
  assert.equal(hidden(e, 'finale-layer'), true);
  assert.equal(hidden(e, 'menu-overlay'), false);
  assert.equal(e.log.errors.length, 1);
  // vypnutý příběh už nic nedělá
  e.game.inferno = true; e.game.insane = true; e.game.score = 200000;
  assert.doesNotThrow(() => { S2.update(16, e.game); S2.onKill(e.game); S2.onHit(e.game, 'beam'); S2.sceneUpdate(100); S2.onAscend(); S2.onStardustSpent(1); });
  assert.equal(e.Story.scn, null);
});

test('pojistka: všechna volání příběhu z herní smyčky jsou obalená, ostatní jsou obsluha tlačítek (její výjimka smyčku nezastaví a příběh se vypne)', () => {
  const wrapped = GUARD.match(/\[([^\]]+)\]\.forEach\(wrap\)/)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(wrapped.sort(), ['drawBack', 'drawFront', 'finaleDraw', 'finaleUpdate', 'onAscend', 'onBossKilled', 'onBossSpawn', 'onHit', 'onKill', 'onRunEnd', 'onRunStart', 'onStardustSpent', 'refreshButtons', 'sceneDraw', 'sceneUpdate', 'update']);
  const calls = new Set([...html.replace(/\/\/ <STORY-ENGINE>[\s\S]*?\/\/ <\/STORY-ENGINE>/, '').matchAll(/\bStory\.(\w+)\(/g)].map((m) => m[1]));
  for (const c of calls) assert.ok(wrapped.includes(c) || ['openArchive', 'closeArchive', 'toggleShard', 'finaleHold', 'finishFinale', 'skipFinale', 'onCode', 'available', 'act', 'chooseScene', 'sceneAdvance', 'skipScene', 'endScene', 'fail', 'startFinale', 'paintButtons'].includes(c), `volání Story.${c} není obalené ani obsluha tlačítka`);
  // obsluha tlačítek příběhu si chybu hlídá sama
  assert.match(html, /const storySafe = fn => \(\.\.\.a\) => \{ try \{ return fn\(\.\.\.a\); \} catch \(err\) \{ Story\.fail\(err\); \} \};/);
  for (const re of [/story-actions'\)\.addEventListener\('click', storySafe\(/, /scene-choices'\)\.addEventListener\('click', storySafe\(/, /scene-tap'\)\.addEventListener\('pointerdown', storySafe\(/, /finale-done'\)\.onclick = storySafe\(/, /finale-skip'\)\.onclick = storySafe\(/]) assert.match(html, re);
});

test('napojení do hry: háčky ve správných místech a skrytý odznak se hlásí jen po dokončení (nebo u starého příběhu, který ho měl)', () => {
  assert.match(html, /this\.kills\+\+;\s*this\.trackStat\('totalKills'\);\s*Story\.onKill\(this\);/, 'zničený nepřítel');
  assert.match(html, /Relics\.check\(\);\s*Story\.onAscend\(\);/, 'dokončený Vzestup');
  assert.match(html, /Story\.onStardustSpent\(cost\);/, 'utracený prach s částkou');
  assert.match(html, /Story\.onRunStart\(this\);/);
  assert.match(html, /Story\.onRunEnd\(this, true, effectiveReason\);/);
  assert.match(html, /Story\.onRunEnd\(this, false\);/);
  assert.match(html, /Story\.onBossSpawn\(this, this\.boss\);/);
  assert.match(html, /Story\.onBossKilled\(this\);/);
  assert.match(html, /Story\.onHit\(this, source\);/);
  assert.match(html, /Story\.update\(dt, this\);/);
  assert.match(html, /Story\.refreshButtons\(\);/);
  // stav SCENE ve smyčce a v kreslení
  assert.match(html, /if \(this\.state === 'SCENE'\) Story\.sceneUpdate\(dt\);/);
  assert.match(html, /\(this\.state === 'SCENE' && Story\.scn && Story\.scn\.run\)\) \{\s*Story\.drawBack\(ctx, this\);/, 'cutscéna uprostřed běhu kreslí zmrzlou hru');
  assert.match(html, /ctx\.restore\(\);\s*if \(this\.state === 'SCENE'\) Story\.sceneDraw\(ctx\);\s*this\.drawOverlays\(ctx\);/);
  // uložení rozehraného běhu i při zavření stránky během scény
  assert.match(html, /\(this\.state === 'SCENE' && Story\.scn && Story\.scn\.run\)\) \|\| this\.tutActive\) return false;/);
  assert.match(html, /window\.addEventListener\('pagehide', \(\) => \{ if \(Game\.state === 'PLAY' \|\| Game\.state === 'PAUSE' \|\| \(Game\.state === 'SCENE' && Story\.scn && Story\.scn\.run\)\) Game\.saveRun\(\)/);
  // skrytý odznak
  const rep = html.match(/\/\/ Příběh: hlásí se jen dokončený[\s\S]*?\n\}/)[0];
  assert.match(rep, /if \(d\.story && \(d\.story\.done \|\| d\.story\.legacy\)\) jomaridRecord\('story_end', 1, true\);/);
  assert.equal((rep.match(/story_end/g) || []).length, 1);
  // planeta svítí po první knize a po celém příběhu
  assert.match(html, /Storage\.data\.story && \(Storage\.data\.story\.fin1 \|\| Storage\.data\.story\.done \|\| Storage\.data\.story\.legacy\)/);
  assert.match(html, /story: \{ v: 2, found: \{\}, seen: \{\}, prog: \{\}, awake: false, fin1: false, done: false, legacy: false, ending: '', refused: 0, lost: 0 \}/);
});

test('cheat menu skrytý odznak nedá: žádný cheat nezapisuje do příběhu, jen náhled bez zápisu', () => {
  const cheats = html.match(/const CHEATS = \{([\s\S]*?)\n\};/)[1];
  assert.doesNotMatch(cheats, /story\.(found|done|ending|awake|fin1|legacy|prog)|\.story\s*=|Story\.collect|Story\.d\(\)/, 'cheaty příběh nemění');
  assert.match(cheats, /story: \(\) => \{ closeCheatMenu\(\); Story\.openArchive\('menu', true\); return ''; \}/);
  assert.match(html, /data-cheat="story">📖 Náhled příběhu</);
});

test('mobil i počítač: finále se ovládá držením tlačítka dotykem, myší i klávesou (mezerník, Enter), cutscéna klepnutím do obrazovky i klávesou', () => {
  assert.match(html, /finaleHold\.addEventListener\('pointerdown', e => \{\s*e\.preventDefault\(\);/);
  assert.match(html, /\['pointerup', 'pointercancel', 'lostpointercapture'\]\.forEach\(ev => finaleHold\.addEventListener\(ev, \(\) => Story\.finaleHold\(false\)\)\);/);
  assert.match(html, /Game\.state === 'FINALE' && \(e\.code === 'Space' \|\| e\.code === 'Enter'\)/);
  assert.match(html, /Game\.state === 'SCENE' && Story\.scn && \(Story\.scn\.phase === 'beats' \|\| Story\.scn\.phase === 'after'\) && \(e\.code === 'Space' \|\| e\.code === 'Enter'\)/);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.scene-tap \{ position: absolute; inset: 0; z-index: 0;/);
  assert.match(css, /#finale-done, \.finale-hold, \.finale-skip, \.scene-choices \{ z-index: 2; \}/, 'tlačítka jsou nad klepací plochou');
  assert.match(css, /\.finale-hold \{[^}]*touch-action: none;/);
});

test('po první knize Jomarid svítí: pozadí kreslí světla měst jen u hráče, který ji dokončil, a mají stejné rozložení jako ve finále', () => {
  assert.match(html, /if \(Storage\.data\.story && \(Storage\.data\.story\.fin1 \|\| Storage\.data\.story\.done \|\| Storage\.data\.story\.legacy\)\) \{\s*const warm = /);
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

test('skrytost v HTML: prvky příběhu jsou v kódu stránky schované, žádný text příběhu v ní není (je jen v datech skriptu) a hra o něm nic nenapoví', () => {
  const tag = (id) => html.match(new RegExp(`<[^>]*\\bid="${id}"[^>]*>`))[0];
  for (const id of ['btn-open-story', 'btn-story-go', 'story-overlay', 'finale-layer', 'story-mark', 'finale-hold', 'finale-done', 'scene-tap', 'scene-choices', 'story-caps', 'story-actions', 'story-preview']) {
    assert.match(tag(id), /class="[^"]*\bhidden\b/, `${id} je schovaný`);
  }
  // texty příběhu nejsou v žádném HTML prvku ve stránce, jen v datech skriptu
  const body = html.slice(html.indexOf('<body>'), html.indexOf('<script>', html.indexOf('<body>')));
  for (const word of ['Majákář', 'Vlaštovky', 'Poutník', 'Zrcadlo', 'Směrnice', 'Marek', 'Odstavec']) assert.ok(!body.includes(word), `${word} není v HTML stránky`);
  // znaky, které by se na části telefonů vykreslily jako čtvereček
  assert.doesNotMatch(html, /[◈▒]/);
  // hra o příběhu nic nenapoví v nápovědě, při smazání postupu ani v bridgi
  const bridge = html.slice(html.indexOf('/* JOMARID-BRIDGE */'), html.indexOf('</script>', html.indexOf('/* JOMARID-BRIDGE */')));
  assert.doesNotMatch(bridge, /story|střep/i);
  assert.doesNotMatch(html.match(/<div class="hint">[\s\S]*?<\/div>/)[0], /střep|příběh|story|Marek/i);
  // jméno Marek ani odstavec nejsou v žádném textu menu, výsledků ani nastavení (vyskytují se jen ve skriptu v datech příběhu)
  const outsideScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  assert.doesNotMatch(outsideScript, /Směrnice 7|Odstavec 1[23]|Kdo tam/);
});

test('mobil i počítač: obsluha příběhu na dotykových zařízeních i klávesnici (držení, klepnutí, česká klávesnice pro v2.9, Escape zavře archiv)', () => {
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
  // klepnutí do cutscény ani tlačítka voleb nespouštějí nabídku ani posun stránky
  assert.match(html, /scene-tap'\)\.addEventListener\('pointerdown', storySafe\(e => \{\s*e\.preventDefault\(\);/);
});
