// Sbírka (třídy, výhody, vzhled, statistiky) a nastavení.
/* =====================================================================
   Sbírka (třídy, výhody, vzhled, statistiky) a nastavení
   ===================================================================== */
// Barvy tanku. Odemykají se přímo podle toho, co hráč dokázal (need = text do nabídky, has = podmínka, old = dřívější úspěch, který barvu už odemkl).
const SKINS = [
  { id: 'teal', name: 'Tyrkys', color: '#5fd6cc' },
  { id: 'sun', name: 'Západ', color: '#ff9a5a' },
  { id: 'violet', name: 'Fialka', color: '#a98bff' },
  { id: 'lime', name: 'Limeta', color: '#9bdc4d', need: 'Znič první tank', has: st => st.kills >= 1, old: 'first' },
  { id: 'pink', name: 'Růžová', color: '#ff7eb6', need: 'Znič 500 tvarů', has: st => st.shapes >= 500, old: 'farm' },
  { id: 'ice', name: 'Led', color: '#9ee7ff', need: 'Dosáhni úrovně 20', has: st => st.bestLevel >= 20, old: 'lvl20' },
  { id: 'gold', name: 'Zlatá', color: '#f5c542', need: 'Poraz bosse', has: st => st.bosses >= 1, old: 'boss' },
  { id: 'ink', name: 'Obsidián', color: '#4b5b6e', need: 'Dosáhni maximální úrovně', has: st => st.bestLevel >= MAX_LEVEL, old: 'lvl45' },
  { id: 'magma', name: 'Magma', color: '#ff5a2a', need: 'Dosáhni úrovně 25 na Pekle', has: st => st.hellBest >= 25, old: 'hell5' },
  { id: 'rainbow', name: 'Duha', color: '#ffffff', need: 'Objev 40 tříd', has: () => codexCount() >= 40, old: 'cdx40', rainbow: true },
];

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
const skinOpen = sk => !sk.has || sk.has(save.st) || !!save.ach[sk.old];
function codexCount() { let n = 0; for (const id in save.codex) if (CLASSES[id] && !CLASSES[id].boss) n++; return n; }

// Zapíše do postupu, čeho hráč právě dosáhl: objevenou třídu a nejvyšší úroveň, stupeň třídy a úroveň na Pekle. Odznaky z toho vyhodnocuje appka
// (persist hlásí rekordy), hra žádné vlastní úspěchy nemá. force = i když hráč právě skončil (výhra se započítá hned na obrazovce výsledku).
// Hry s vyšší startovní úrovní (world.boost) se nepočítají do úrovně ani stupně třídy - ty by se daly získat hned na startu.
function trackProgress(force) {
  if (mode === 'sandbox' || (!player.alive && !force)) return;
  const p = player, st = save.st;
  let changed = false;
  if (!save.codex[p.cls]) { save.codex[p.cls] = true; changed = true; }
  if (!(world.boost > 0)) {
    if (p.level > st.bestLevel) { st.bestLevel = p.level; changed = true; }
    if (p.tierDone > st.bestTier) { st.bestTier = p.tierDone; changed = true; }
    if (diffKey === 'hell' && p.level > st.hellBest) { st.hellBest = p.level; changed = true; }
  }
  if (changed || force) persist();                // konec zápasu uloží a ohlásí i výhru, ne až další uložení
}

/* ---------- sbírka ---------- */
const elColl = $('coll'), elCollBody = $('collBody'), elCollTabs = $('collTabs'), elSet = $('settings');
const collState = { tab: 'classes', paused: false };
const COLL_TABS = [['classes', 'Třídy'], ['perks', 'Výhody'], ['skins', 'Vzhled'], ['stats', 'Statistiky']];
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
  ({ classes: renderClasses, perks: renderPerks, skins: renderSkins, stats: renderStats })[collState.tab]();
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
      el.appendChild(h('small', null, known ? (PARENT[id] && cls.tier < 5 ? 'z: ' + CLASSES[PARENT[id]].name : cls.info) : 'Zatím neobjeveno'));
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
function renderSkins() {
  elCollBody.appendChild(h('div', 'tier', 'Barva tvého tanku (v týmovém režimu se použije barva týmu). Další odemykáš hraním.'));
  const grid = h('div', 'skgrid');
  for (const sk of SKINS) {
    const open = skinOpen(sk), el = h('button', 'sk' + (save.skin === sk.id ? ' sel' : '') + (open ? '' : ' lock')); el.type = 'button';
    const dot = h('i'); dot.style.background = sk.rainbow ? 'conic-gradient(#ff6b6b,#f5c542,#5fdc7a,#5fd6f2,#a98bff,#ff6b6b)' : sk.color; el.appendChild(dot);
    el.appendChild(h('span', null, sk.name));
    if (!open) el.appendChild(h('small', null, 'Odemkne: ' + sk.need));
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
  seg('Efekty', 'Nízké šetří baterii a výkon', [['Nízké', 0], ['Střední', 0.5], ['Plné', 1]], () => save.set.fx, v => { save.set.fx = v; fxReset(); });
}
$('setBtn').addEventListener('click', () => { beep('click'); renderSettings(); elSet.classList.remove('hidden'); });
function closeSettings() { elSet.classList.add('hidden'); }
$('setClose').addEventListener('click', closeSettings);
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (!elColl.classList.contains('hidden') || !elSet.classList.contains('hidden'))) { closeColl(); closeSettings(); e.stopImmediatePropagation(); e.preventDefault(); }
}, true);
