// Sbírka (třídy, výhody, úspěchy, vzhled, statistiky) a nastavení.
/* =====================================================================
   Sbírka (třídy, výhody, úspěchy, vzhled, statistiky) a nastavení
   ===================================================================== */
const SKINS = [
  { id: 'teal', name: 'Tyrkys', color: '#5fd6cc' },
  { id: 'sun', name: 'Západ', color: '#ff9a5a' },
  { id: 'violet', name: 'Fialka', color: '#a98bff' },
  { id: 'lime', name: 'Limeta', color: '#9bdc4d', need: 'first' },
  { id: 'pink', name: 'Růžová', color: '#ff7eb6', need: 'farm' },
  { id: 'ice', name: 'Led', color: '#9ee7ff', need: 'lvl20' },
  { id: 'gold', name: 'Zlatá', color: '#f5c542', need: 'boss' },
  { id: 'ink', name: 'Obsidián', color: '#4b5b6e', need: 'lvl45' },
  { id: 'magma', name: 'Magma', color: '#ff5a2a', need: 'hell5' },
  { id: 'rainbow', name: 'Duha', color: '#ffffff', need: 'cdx40', rainbow: true },
];
const ACH = [
  { id: 'first', name: 'První krev', info: 'Znič svůj první tank', ok: c => c.st.kills >= 1 },
  { id: 'farm', name: 'Farmář', info: 'Znič celkem 500 tvarů', ok: c => c.st.shapes >= 500 },
  { id: 'lvl20', name: 'Veterán', info: 'Dosáhni úrovně 20', ok: c => c.st.bestLevel >= 20 },
  { id: 'lvl45', name: 'Legenda', info: 'Dosáhni maximální úrovně', ok: c => c.st.bestLevel >= MAX_LEVEL },
  { id: 'tier3', name: 'Mistr stavby', info: 'Dosáhni 3. stupně třídy', ok: c => c.life.tier >= 3 },
  { id: 'tier4', name: 'Vrchol vývoje', info: 'Dosáhni 4. stupně třídy', ok: c => c.life.tier >= 4 },
  { id: 'tier5', name: 'Vzestoupil jsi', info: 'Dosáhni 5. stupně (Vzestup)', ok: c => c.life.tier >= 5 },
  { id: 'boss', name: 'Lovec bossů', info: 'Poraz bosse', ok: c => c.st.bosses >= 1 },
  { id: 'boss5', name: 'Zabiják titánů', info: 'Poraz 5 bossů', ok: c => c.st.bosses >= 5 },
  { id: 'bossvariety', name: 'Lovec forem', info: 'Poraz aspoň 6 různých druhů bossů', ok: c => Object.keys(c.st.bossKinds || {}).length >= 6 },
  { id: 'bossall', name: 'Sběratel trofejí', info: 'Poraz všechny druhy bossů', ok: c => Object.keys(c.st.bossKinds || {}).length >= BOSS_IDS.length },
  { id: 'mapall', name: 'Cestovatel', info: 'Zahraj si na všech typech arény', ok: c => Object.keys(c.st.mapsSeen || {}).length >= MAP_PRESETS.length },
  { id: 'cdx15', name: 'Sběratel', info: 'Objev 15 tříd', ok: c => c.cdx >= 15 },
  { id: 'cdx40', name: 'Znalec', info: 'Objev 40 tříd', ok: c => c.cdx >= 40 },
  { id: 'cdx150', name: 'Archivář', info: 'Objev 150 tříd', ok: c => c.cdx >= 150 },
  { id: 'cdx400', name: 'Encyklopedie', info: 'Objev 400 tříd', ok: c => c.cdx >= 400 },
  { id: 'surv5', name: 'Přeživší', info: 'Přežij 5 minut jedním životem', ok: c => c.life.time >= 300 },
  { id: 'rampage', name: 'Řádění', info: 'Znič 10 tanků jedním životem', ok: c => c.life.kills >= 10 },
  { id: 'perks', name: 'Kombinátor', info: 'Vyber všech pět výhod v jedné hře', ok: c => c.life.perks >= 5 },
  { id: 'over', name: 'Nadlimit', info: 'Vylepši vlastnost nad maximum až na 12', ok: c => c.life.maxStat >= 12 },
  { id: 'teamwin', name: 'Týmový hráč', info: 'Vyhraj týmový zápas', ok: c => c.st.wins >= 1 },
  { id: 'games10', name: 'Stálice', info: 'Odehraj 10 her', ok: c => c.st.games >= 10 },
  { id: 'wave10', name: 'Odolný', info: 'Zvládni 10 vln v režimu Přežití', ok: c => c.st.bestWave >= 10 },
  { id: 'hillwin', name: 'Král kopce', info: 'Vyhraj zápas v režimu Král kopce', ok: c => c.st.hillWins >= 1 },
  { id: 'royale', name: 'Poslední v bouři', info: 'Vyhraj Posledního přeživšího', ok: c => c.st.royaleWins >= 1 },
  { id: 'rushall', name: 'Přemožitel', info: 'Poraz všechny bossy v Honu na bossy', ok: c => c.st.rushWins >= 1 },
  { id: 'gold300', name: 'Zlatokop', info: 'Nasbírej 300 zlata v jedné Zlaté horečce', ok: c => c.st.bestGold >= 300 },
  { id: 'hell5', name: 'Z pekla', info: 'Dosáhni úrovně 25 na obtížnosti Peklo', ok: c => c.diff === 'hell' && c.life.level >= 25 },
  { id: 'allmodes', name: 'Všestranný', info: 'Zahraj si všechny režimy', ok: c => Object.keys(c.st.modesPlayed || {}).length >= MODE_IDS.length },
];
const ACH_BY = {}; for (const a of ACH) ACH_BY[a.id] = a;

function hueHex(hh) {
  hh = Math.floor(hh / 15) * 15; const s = 0.7, l = 0.6, a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + hh / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const to = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return '#' + to(f(0)) + to(f(8)) + to(f(4));
}
function skinColor() {
  const sk = SKINS.find(k => k.id === save.skin) || SKINS[0];
  return sk.rainbow ? hueHex((time * 60) % 360) : sk.color;
}
const skinOpen = sk => !sk.need || !!save.ach[sk.need];
function codexCount() { let n = 0; for (const id in save.codex) if (CLASSES[id] && !CLASSES[id].boss) n++; return n; }

function checkAch() {
  if (mode === 'sandbox' || !player.alive) return;
  if (!save.codex[player.cls]) save.codex[player.cls] = true;
  const p = player, st = save.st;
  st.bestLevel = Math.max(st.bestLevel, p.level);
  const c = { st, cdx: codexCount(), diff: diffKey, life: { time: time - p.born, kills: p.kills, level: p.level, tier: p.tierDone, perks: p.perkN, maxStat: Math.max.apply(null, p.stats) } };
  let changed = false;
  for (const a of ACH) if (!save.ach[a.id] && a.ok(c)) { save.ach[a.id] = true; changed = true; banner('Úspěch: ' + a.name, 'ach'); beep('ach'); buzz(40); }
  if (changed) persist();
}

/* ---------- sbírka ---------- */
const elColl = $('coll'), elCollBody = $('collBody'), elCollTabs = $('collTabs'), elSet = $('settings');
const collState = { tab: 'classes', paused: false };
const COLL_TABS = [['classes', 'Třídy'], ['perks', 'Výhody'], ['ach', 'Úspěchy'], ['skins', 'Vzhled'], ['stats', 'Statistiky']];
function inSandbox() { return mode === 'sandbox' && state === 'play'; }
function openColl(tab) {
  if (tab) collState.tab = tab;
  if (state === 'play' && !paused) { paused = true; collState.paused = true; input.stickL = null; input.stickR = null; input.mouse.down = false; }
  elColl.classList.remove('hidden'); renderColl();
}
function closeColl() {
  elColl.classList.add('hidden');
  if (collState.paused) { collState.paused = false; paused = false; }
}
function renderColl() {
  $('collTitle').textContent = inSandbox() ? 'Cvičiště – výběr' : 'Sbírka';
  elCollTabs.replaceChildren();
  for (const [id, name] of COLL_TABS) {
    const b = h('button', null, name); b.type = 'button'; b.setAttribute('aria-selected', id === collState.tab ? 'true' : 'false');
    b.addEventListener('click', () => { collState.tab = id; renderColl(); elCollBody.scrollTop = 0; });
    elCollTabs.appendChild(b);
  }
  const top = elCollBody.scrollTop;
  elCollBody.replaceChildren();
  ({ classes: renderClasses, perks: renderPerks, ach: renderAch, skins: renderSkins, stats: renderStats })[collState.tab]();
  elCollBody.scrollTop = top;
}
function renderClasses() {
  const sb = inSandbox(), all = ['basic'].concat(CLASS_IDS.filter(id => id !== 'basic'));
  const n = codexCount();
  elCollBody.appendChild(h('div', 'tier', sb ? 'Klepni na třídu a hned ji dostaneš. (' + CLASS_IDS.length + ' tříd)' : 'Objeveno ' + n + ' z ' + CLASS_IDS.length + ' tříd. Třídy se odemykají tím, že je v hře postavíš.'));
  for (let t = 0; t <= 4; t++) {
    const ids = all.filter(id => CLASSES[id].tier === t); if (!ids.length) continue;
    elCollBody.appendChild(h('div', 'tier', t === 0 ? 'Základ' : t + '. stupeň'));
    const grid = h('div', 'cgrid');
    for (const id of ids) {
      const known = sb || id === 'basic' || !!save.codex[id], cls = CLASSES[id];
      const el = h(sb ? 'button' : 'div', 'cc' + (known ? '' : ' lock') + (sb && player.cls === id ? ' sel' : '')); if (sb) el.type = 'button';
      const cv = document.createElement('canvas'); cv.width = 104; cv.height = 104; el.appendChild(cv);
      const g = cv.getContext('2d');
      if (known) drawIcon(g, id, 104); else { g.fillStyle = theme.ink; g.globalAlpha = 0.5; g.font = '700 54px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 52, 54); g.globalAlpha = 1; }
      el.appendChild(h('b', null, known ? cls.name : '???'));
      el.appendChild(h('small', null, known ? (PARENT[id] ? 'z: ' + CLASSES[PARENT[id]].name : cls.info) : 'Zatím neobjeveno'));
      if (sb) el.addEventListener('click', () => { sandboxEquip(id); closeColl(); });
      grid.appendChild(el);
    }
    elCollBody.appendChild(grid);
  }
}
function renderPerks() {
  const sb = inSandbox();
  elCollBody.appendChild(h('div', 'tier', sb ? 'Klepnutím výhodu zapneš nebo vypneš.' : 'Během hry si na úrovních ' + PERK_LEVELS.join(', ') + ' vybíráš jednu ze tří náhodných výhod.'));
  const grid = h('div', 'cgrid');
  for (const pk of PERKS) {
    const on = sb && !!player.perks[pk.id];
    const el = h(sb ? 'button' : 'div', 'cc' + (on ? ' sel' : '')); if (sb) el.type = 'button';
    const cv = document.createElement('canvas'); cv.width = 104; cv.height = 104; el.appendChild(cv); drawPerkIcon(cv, pk.id, 104);
    el.appendChild(h('b', null, pk.name)); el.appendChild(h('small', null, pk.info));
    if (sb) el.addEventListener('click', () => { if (player.perks[pk.id]) delete player.perks[pk.id]; else player.perks[pk.id] = true; recalc(player); ui.perkDirty = true; renderColl(); });
    grid.appendChild(el);
  }
  elCollBody.appendChild(grid);
}
function renderAch() {
  const done = ACH.filter(a => save.ach[a.id]).length;
  elCollBody.appendChild(h('div', 'tier', 'Splněno ' + done + ' z ' + ACH.length));
  const list = h('div', 'alist');
  for (const a of ACH) {
    const ok = !!save.ach[a.id], row = h('div', 'arow' + (ok ? ' done' : ' lock'));
    row.appendChild(h('span', 'dot', ok ? '✓' : ''));
    const box = h('div'); box.appendChild(h('b', null, a.name)); box.appendChild(h('small', null, a.info)); row.appendChild(box);
    list.appendChild(row);
  }
  elCollBody.appendChild(list);
}
function renderSkins() {
  elCollBody.appendChild(h('div', 'tier', 'Barva tvého tanku (v týmovém režimu se použije barva týmu). Další odemykáš úspěchy.'));
  const grid = h('div', 'skgrid');
  for (const sk of SKINS) {
    const open = skinOpen(sk), el = h('button', 'sk' + (save.skin === sk.id ? ' sel' : '') + (open ? '' : ' lock')); el.type = 'button';
    const dot = h('i'); dot.style.background = sk.rainbow ? 'conic-gradient(#ff6b6b,#f5c542,#5fdc7a,#5fd6f2,#a98bff,#ff6b6b)' : sk.color; el.appendChild(dot);
    el.appendChild(h('span', null, sk.name));
    if (!open) el.appendChild(h('small', null, 'Odemkne: ' + ACH_BY[sk.need].name));
    el.addEventListener('click', () => { if (!open) return; save.skin = sk.id; persist(); if (player && state !== 'play') player.color = skinColor(); renderColl(); });
    grid.appendChild(el);
  }
  elCollBody.appendChild(grid);
}
function renderStats() {
  const st = save.st, m = Math.floor(st.secs / 60);
  const rows = [['Odehraných her', st.games], ['Zničených tanků', st.kills], ['Zničených tvarů', st.shapes], ['💎 Krystaly', st.crystals || 0], ['Poražených bossů', st.bosses], ['Druhů bossů poraženo', Object.keys(st.bossKinds || {}).length + ' / ' + BOSS_IDS.length], ['Nejvyšší úroveň', st.bestLevel], ['Nejlepší skóre', save.best], ['Vyhrané týmové zápasy', st.wins], ['Nejlepší vlna (Přežití)', st.bestWave || 0], ['Výhry: Král kopce', st.hillWins || 0], ['Výhry: Poslední přeživší', st.royaleWins || 0], ['Hon na bossy: nejvíc bossů', (st.rushBest || 0) + ' / ' + BOSS_IDS.length], ['Nejvíc zlata', st.bestGold || 0], ['Vybrané výhody', st.perks], ['Zničení', st.deaths], ['Navštívené arény', Object.keys(st.mapsSeen || {}).length + ' / ' + MAP_PRESETS.length], ['Čas ve hře (min)', m]];
  const grid = h('div', 'stgrid');
  for (const [name, v] of rows) { const d = h('div'); d.appendChild(h('b', null, typeof v === 'string' ? v : fmt(v))); d.appendChild(h('span', null, name)); grid.appendChild(d); }
  elCollBody.appendChild(grid);
}
$('collBtn').addEventListener('click', () => { beep('click'); openColl('classes'); });
$('collClose').addEventListener('click', closeColl);

/* ---------- nastavení ---------- */
function renderSettings() {
  const body = $('setBody'); body.replaceChildren();
  const sw = (label, sub, get, set) => {
    const row = h('div', 'trow'), l = h('div'); l.appendChild(h('span', null, label)); if (sub) l.appendChild(h('small', null, sub)); row.appendChild(l);
    const b = h('button', 'sw'); b.type = 'button'; b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', get() ? 'true' : 'false'); b.setAttribute('aria-label', label);
    b.addEventListener('click', () => { set(!get()); persist(); b.setAttribute('aria-checked', get() ? 'true' : 'false'); refreshMenu(); }); row.appendChild(b); body.appendChild(row);
  };
  const seg = (label, sub, opts, get, set) => {
    const row = h('div', 'trow'), l = h('div'); l.appendChild(h('span', null, label)); if (sub) l.appendChild(h('small', null, sub)); row.appendChild(l);
    const s = h('div', 'seg'); s.setAttribute('role', 'radiogroup');
    for (const [name, val] of opts) { const b = h('button', null, name); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', get() === val ? 'true' : 'false'); b.addEventListener('click', () => { set(val); persist(); s.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', 'false')); b.setAttribute('aria-checked', 'true'); }); s.appendChild(b); }
    row.appendChild(s); body.appendChild(row);
  };
  sw('Zvuk', 'Efekty střelby a bonusů', () => save.sound, v => { save.sound = v; });
  sw('Vibrace', 'Jen na dotykových zařízeních', () => save.set.vib, v => { save.set.vib = v; });
  sw('Levá ruka', 'Prohodí páčky: vpravo pohyb, vlevo míření', () => save.set.lefty, v => { save.set.lefty = v; });
  seg('Velikost páček', null, [['Malé', 0.85], ['Střední', 1], ['Velké', 1.3]], () => save.set.ctl, v => { save.set.ctl = v; });
  seg('Efekty', 'Nízké šetří baterii a výkon', [['Nízké', 0], ['Střední', 0.5], ['Plné', 1]], () => save.set.fx, v => { save.set.fx = v; fxState.level = fxLevelNow(); });
}
$('setBtn').addEventListener('click', () => { beep('click'); renderSettings(); elSet.classList.remove('hidden'); });
function closeSettings() { elSet.classList.add('hidden'); }
$('setClose').addEventListener('click', closeSettings);
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (!elColl.classList.contains('hidden') || !elSet.classList.contains('hidden'))) { closeColl(); closeSettings(); e.stopImmediatePropagation(); e.preventDefault(); }
}, true);
