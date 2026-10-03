// Rozhraní: HUD, menu, stavy hry, hlavní smyčka, start.
/* =====================================================================
   UI
   ===================================================================== */
const statRows = [];
STATS.forEach((s, i) => {
  const btn = h('button', 'srow'); btn.type = 'button'; btn.style.setProperty('--c', s.color);
  const pips = h('span', 'spips'), pe = [];
  for (let j = 0; j < STAT_CAP; j++) { const p = h('i', j >= STAT_MAX ? (j === STAT_MAX ? 'od odf' : 'od') : ''); pips.appendChild(p); pe.push(p); }
  const sod = h('span', 'sod');
  btn.appendChild(h('span', 'sname', s.name)); btn.appendChild(sod); btn.appendChild(pips); btn.appendChild(h('span', 'skey', String(i + 1)));
  btn.addEventListener('click', () => buyStat(player, i));
  $('statRows').appendChild(btn); statRows.push({ btn, pe, sod });
});
function updateStatsUI() {
  const p = player, pts = p.points;
  elStatHead.textContent = pts > 0 ? pts + ' ' + plBody(pts) + ' k rozdání' : 'Stavba tanku';
  elStats.classList.toggle('hasPts', pts > 0);
  if (pts <= 0) ui.statsOpen = false;
  elStats.classList.toggle('collapsed', !ui.statsOpen);
  for (let i = 0; i < STATS.length; i++) {
    const v = p.stats[i], r = statRows[i];
    for (let j = 0; j < STAT_CAP; j++) r.pe[j].classList.toggle('on', j < v);
    r.btn.disabled = pts <= 0 || v >= STAT_CAP; r.btn.classList.toggle('max', v >= STAT_CAP); r.btn.classList.toggle('over', v >= STAT_MAX);
    const od = v >= STAT_CAP ? 'MAX' : v > STAT_MAX ? '+' + (v - STAT_MAX) : ''; if (r.sod.textContent !== od) r.sod.textContent = od;
  }
}
elStatHead.addEventListener('click', () => { if (!elApp.classList.contains('touch')) return; ui.statsOpen = !ui.statsOpen; ui.statsDirty = true; });
function buildOffer(ids) {
  elClasses.replaceChildren(); elClasses.classList.toggle('many', ids.length > 4);
  const t0 = CLASSES[ids[0]].tier;
  elClasses.appendChild(h('div', 'otitle', t0 >= 5 ? 'Vzestup' : t0 >= 4 ? 'Nejvyšší vývoj' : 'Vyber třídu'));
  for (const id of ids) {
    const cls = CLASSES[id], btn = h('button', 'ccard panel'); btn.type = 'button';
    const cv = document.createElement('canvas'); cv.width = 112; cv.height = 112; btn.appendChild(cv);
    btn.appendChild(h('b', null, cls.name)); btn.appendChild(h('small', null, cls.info));
    btn.addEventListener('click', () => chooseClass(player, id));
    elClasses.appendChild(btn);
    drawIcon(cv.getContext('2d'), id, 112);
  }
}
function buildPerkOffer(ids) {
  elClasses.replaceChildren(); elClasses.classList.remove('many');
  elClasses.appendChild(h('div', 'otitle', 'Vyber výhodu'));
  for (const id of ids) {
    const pk = PERK_BY[id], btn = h('button', 'ccard panel perk'); btn.type = 'button';
    const cv = document.createElement('canvas'); cv.width = 112; cv.height = 112; btn.appendChild(cv);
    btn.appendChild(h('b', null, pk.name)); btn.appendChild(h('small', null, pk.info));
    btn.addEventListener('click', () => choosePerk(player, id));
    elClasses.appendChild(btn);
    drawPerkIcon(cv, id, 112);
  }
}
function updateLB() {
  const MD = M(), val = MD.lbVal || (t => t.score);
  const alive = (MD.lbList ? MD.lbList() : tanks.filter(t => t.alive && !t.boss)).slice().sort((a, b) => val(b) - val(a));
  elLb.replaceChildren();
  const add = (t, i) => {
    const row = h('div', 'lbrow' + (t === player ? ' me' : ''));
    if (t.team) { row.style.borderLeft = '3px solid ' + TEAM_COLORS[t.team]; row.style.paddingLeft = '5px'; }
    row.appendChild(h('span', null, (i + 1) + '. ' + t.name)); row.appendChild(h('span', null, MD.lbText ? String(MD.lbText(t)) : fmt(t.score)));
    elLb.appendChild(row);
  };
  alive.slice(0, 6).forEach(add);
  const pi = alive.indexOf(player);
  if (pi >= 6) add(player, pi);
}
const elBanner = $('banner'), elDash = $('dashBtn'), elPerks = $('perkStrip'), elBoss = $('bossbar'), elObj = $('objbar');
function banner(text, kind) { elBanner.textContent = text; elBanner.className = 'show ' + (kind || ''); ui.bannerT = 4.2; }
function buzz(ms) { if (save.set.vib && input.touch && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } } }
function playerColor() { return M().team ? TEAM_COLORS[1] : skinColor(); }
function updateHud2() {
  const p = player, dmax = 7 * p.pk.dashCd, ready = p.dashCd <= 0;
  elDash.style.setProperty('--p', ready ? 100 : Math.round((1 - p.dashCd / dmax) * 100));
  elDash.classList.toggle('ready', ready);
  const bs = Math.ceil(Math.max(0, p.buff.speed)), bd = Math.ceil(Math.max(0, p.buff.dmg)), sh = p.shield > 0 ? Math.ceil(p.shield / Math.max(1, p.maxHp) * 10) : 0;
  const key = Object.keys(p.perks).join(',') + '|' + bs + '|' + bd + '|' + sh;
  if (ui.perkDirty || key !== ui.perkKey) {
    ui.perkDirty = false; ui.perkKey = key; elPerks.replaceChildren();
    for (const id in p.perks) { const d = h('div', 'pk'); d.title = PERK_BY[id].name; const cv = document.createElement('canvas'); cv.width = 36; cv.height = 36; d.appendChild(cv); elPerks.appendChild(d); drawGlyph(cv.getContext('2d'), PERK_BY[id].ic, 18, 18, 24, theme.accent); }
    const chip = (txt, col) => { const d = h('div', 'bf', txt); d.style.color = col; elPerks.appendChild(d); };
    if (bs > 0) chip('Turbo ' + bs, PICKS.speed.color); if (bd > 0) chip('Síla ' + bd, PICKS.dmg.color); if (sh > 0) chip('Štít', PICKS.shield.color);
  }
  const html = M().hud ? M().hud() : '';
  if (html) { elObj.classList.remove('hidden'); if (elObj.dataset.h !== html) { elObj.innerHTML = html; elObj.dataset.h = html; } }
  else elObj.classList.add('hidden');
  const B = world.boss;
  if (B && B.alive && mode !== 'sandbox') { elBoss.classList.remove('hidden'); $('bossName').textContent = B.name; $('bossFill').style.width = (clamp(B.hp / B.maxHp, 0, 1) * 100).toFixed(1) + '%'; }
  else elBoss.classList.add('hidden');
}
function feed(msg, mine) {
  const el = h('div', mine ? 'me' : '', msg);
  elFeed.appendChild(el); feedItems.push({ el, t: time + 4.5 });
  while (feedItems.length > 3) { const it = feedItems.shift(); if (it.el.parentNode) it.el.parentNode.removeChild(it.el); }
}
function frameUI(dt) {
  const inPlay = state === 'play' && player.alive;
  if (ui.statsDirty && inPlay) { updateStatsUI(); ui.statsDirty = false; }
  const cO = inPlay ? offerOf(player) : null, pO = inPlay && !cO ? perkOfferOf(player) : null;
  const key = cO ? 'c:' + player.cls + ':' + player.tierDone : pO ? 'p:' + player.perkN + ':' + pO.join() : '';
  if (key !== ui.offerKey) { ui.offerKey = key; if (cO) buildOffer(cO); else if (pO) buildPerkOffer(pO); else elClasses.replaceChildren(); elApp.classList.toggle('offering', !!key); }
  if (inPlay) {
    const lv = 'Úroveň ' + player.level + (player.level >= MAX_LEVEL ? ' (max)' : '') + (player.cls !== 'basic' ? ' · ' + CLASSES[player.cls].name : '');
    if (elLvl.textContent !== lv) elLvl.textContent = lv;
    const sc = 'Skóre ' + fmt(player.score); if (elScore.textContent !== sc) elScore.textContent = sc;
    const a = xpFor(player.level), b = xpFor(player.level + 1);
    const f = player.level >= MAX_LEVEL ? ((player.score - a) % BONUS_XP) / BONUS_XP : clamp((player.score - a) / (b - a), 0, 1);
    elXp.style.width = (f * 100).toFixed(1) + '%';
    updateHud2();
  }
  if (ui.vig > 0) ui.vig = Math.max(0, ui.vig - dt * 1.6);
  ui.lbT -= dt; if (ui.lbT <= 0) { ui.lbT = 0.4; if (state !== 'menu') updateLB(); }
  ui.miniT -= dt; if (ui.miniT <= 0) { ui.miniT = 0.1; if (state !== 'menu') drawMini(); }
  if (ui.bannerT > 0) { ui.bannerT -= dt; if (ui.bannerT <= 0) elBanner.classList.remove('show'); }
  ui.achT -= dt; if (ui.achT <= 0) { ui.achT = 1; if (state === 'play') checkAch(); }
  if (state === 'dead' && ui.deadT > 0) { ui.deadT -= dt; if (ui.deadT <= 0) showDead(); }
}

/* ---------- stavy hry ---------- */
function buildBots(key) { diffKey = key; setupMatch(); }
function setAuto(v) { input.auto = !!v; elAuto.classList.toggle('on', input.auto); elAuto.setAttribute('aria-pressed', input.auto ? 'true' : 'false'); }
function setPause(v) {
  if (state !== 'play') return;
  paused = !!v; elPause.classList.toggle('hidden', !paused);
  if (paused) { input.stickL = null; input.stickR = null; input.mouse.down = false; }
}
function startGame(fresh) {
  const nm = (elName.value || '').trim().slice(0, 14);
  save.name = nm; save.diff = diffKey; save.mode = mode;
  if (fresh !== false || builtDiff !== diffKey || builtMode !== mode) { setupMatch(); save.st.games++; }
  persist();
  player.name = nm || 'Ty';
  resetTank(player); player.color = playerColor();
  if (M().playerStart) M().playerStart(player);
  save.st.modesPlayed[mode] = true;
  state = 'play'; paused = false; ui.spec = null;
  elMenu.classList.add('hidden'); elDead.classList.add('hidden'); elPause.classList.add('hidden'); $('coll').classList.add('hidden'); $('settings').classList.add('hidden'); elHud.classList.remove('hidden');
  $('clsBtn').classList.toggle('hidden', mode !== 'sandbox');
  elFeed.replaceChildren(); feedItems.length = 0; elBanner.classList.remove('show');
  cam.x = player.x; cam.y = player.y; cam.z = 1;
  ui.statsDirty = true; ui.offerKey = '#'; ui.lbT = 0; ui.miniT = 0; ui.statsOpen = false; ui.perkDirty = true; ui.achNew = [];
  elLvl.textContent = ''; elScore.textContent = '';
  input.stickL = null; input.stickR = null; shake = 0;
  if (mode === 'teams' && !world.matchT) banner('Aréna: ' + world.mapName + '. Jsi v modrém týmu, cíl: ' + DIFFS[diffKey].goal + ' zničených tanků', 'info');
  else if (mode === 'teams') banner('Zpět v boji za modré! ' + world.teamScore[1] + ' : ' + world.teamScore[2], 'info');
  else if (!world.matchT && mode === 'ffa') banner('Aréna: ' + world.mapName, 'info');
  else if (!world.matchT && mode !== 'sandbox') banner(M().name + ': ' + M().tag + '. Aréna: ' + world.mapName, 'info');
  beep('click');
}
function toMenu() {
  world.over = true;                                          // opuštěný zápas už nesmí nic vyhodnocovat ani zapisovat do postupu
  if (player.alive) { player.alive = false; for (const b of bullets) if ((b.drone || b.trap) && b.owner === player) b.dead = true; }
  state = 'menu'; paused = false; ui.spec = null; ui.offerKey = '#';
  input.stickL = null; input.stickR = null; input.mouse.down = false;
  elHud.classList.add('hidden'); elDead.classList.add('hidden'); elPause.classList.add('hidden'); $('coll').classList.add('hidden'); $('settings').classList.add('hidden'); elMenu.classList.remove('hidden');
  elClasses.replaceChildren(); persist(); refreshMenu();
}
function showDead() {
  const d = deathInfo, s = Math.floor(d.time), boosted = world.boost > 0, best = d.score > save.best && d.score > 0 && mode !== 'sandbox' && !boosted;
  const E = world.over ? world.end : null;
  if (E) { $('deadTitle').textContent = E.title || 'Konec'; $('deadBy').textContent = E.text || ''; }
  else {
    $('deadTitle').textContent = 'Byl jsi zničen';
    $('deadBy').textContent = d.by ? 'Zničil tě ' + d.by + '.' : 'Zničily tě tvary.';
  }
  if (ui.achNew.length) { $('deadBy').textContent += ' Úspěch: ' + ui.achNew.join(', ') + '.'; ui.achNew = []; }
  const grid = $('deadGrid'); grid.querySelectorAll('.x').forEach(n => n.remove());
  for (const [label, v] of (E ? E.extra : M().deathExtra && M().deathExtra()) || []) { const bx = h('div', 'x'); bx.appendChild(h('b', null, typeof v === 'number' ? fmt(v) : String(v))); bx.appendChild(h('span', null, label)); grid.appendChild(bx); }
  $('againBtn').textContent = world.over ? 'Nový zápas' : 'Hrát znovu';
  $('dLvl').textContent = d.level; $('dScore').textContent = fmt(d.score); $('dKills').textContent = d.kills;
  $('dTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  $('newBest').classList.toggle('hidden', !best);
  if (best) save.best = d.score;
  if (!boosted && mode !== 'sandbox') save.st.bestLevel = Math.max(save.st.bestLevel, d.level);
  persist();
  elHud.classList.add('hidden'); elDead.classList.remove('hidden');
}
// Tlačítka režimů se skládají z tabulky MODES (modes.js).
for (const id of MODE_IDS) {
  const m = MODES[id], b = h('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.m = id;
  b.appendChild(h('b', null, m.name)); b.appendChild(h('small', null, m.tag)); $('modeSeg').appendChild(b);
}
const DIFF_INFO = {
  easy: 'Málo botů, slabší zásahy, rychlý růst. Boti tě nechají rozkoukat.',
  normal: 'Vyvážené souboje. Boti loví i se brání.',
  hard: 'Hodně přesných botů a žádná milost.',
  hell: 'Nejtěžší: víc rychlých botů, kteří skoro nechybují, uhýbají a loví hlavně tebe. Slabší regenerace, silnější bossové.',
};
function refreshMenu() {
  $('diffInfo').textContent = DIFF_INFO[diffKey] || '';
  $('modeInfo').textContent = M().info || '';
  $('bestText').textContent = save.best > 0 ? 'Rekord: ' + fmt(save.best) : 'Zatím bez rekordu';
  $('soundBtn').textContent = 'Zvuk: ' + (save.sound ? 'zapnutý' : 'vypnutý');
  document.querySelectorAll('#diffSeg button').forEach(b => b.setAttribute('aria-checked', b.dataset.d === diffKey ? 'true' : 'false'));
  document.querySelectorAll('#modeSeg button').forEach(b => b.setAttribute('aria-checked', b.dataset.m === mode ? 'true' : 'false'));
  const sb = !M().diff; $('diffLabel').classList.toggle('hidden', sb); $('diffSeg').classList.toggle('hidden', sb); $('diffInfo').classList.toggle('hidden', sb);
}
document.querySelectorAll('#diffSeg button').forEach(b => b.addEventListener('click', () => { diffKey = b.dataset.d; save.diff = diffKey; refreshMenu(); }));
document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => { mode = b.dataset.m; save.mode = mode; refreshMenu(); }));
$('playBtn').addEventListener('click', () => startGame(true));
$('againBtn').addEventListener('click', () => startGame(world.over));
elDash.addEventListener('pointerdown', e => { e.preventDefault(); if (state === 'play' && !paused) dash(player); });
$('clsBtn').addEventListener('click', () => openColl('classes'));
$('deadMenuBtn').addEventListener('click', toMenu);
$('pauseMenuBtn').addEventListener('click', toMenu);
$('resumeBtn').addEventListener('click', () => setPause(false));
$('pauseBtn').addEventListener('click', () => setPause(true));
elAuto.addEventListener('click', () => setAuto(!input.auto));
$('soundBtn').addEventListener('click', () => { save.sound = !save.sound; persist(); refreshMenu(); beep('click'); });

/* ---------- hlavní smyčka ---------- */
let lastT = 0, acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000; lastT = now;
  const w0 = performance.now(), rawDt = dt;
  if (!(dt > 0)) dt = 0; if (dt > 0.1) dt = 0.1;
  if (!paused) {
    acc += dt; let n = 0;
    while (acc >= STEP && n < 4) { update(STEP); acc -= STEP; n++; }
    if (n === 4) acc = 0;
    frameUI(dt);
  }
  updateCamera(paused ? 0 : dt); render();
  if (rawDt < 0.25 && !paused) fxFrame(rawDt * 1000, performance.now() - w0);
}

function boot() {
  readTheme(); fxState.level = fxLevelNow();
  try {
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.addEventListener) mq.addEventListener('change', readTheme);
    new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) { /* bez živého přepínání motivu */ }
  resize(); window.addEventListener('resize', resize);
  if (window.ResizeObserver) { ui.ro = new ResizeObserver(resize); ui.ro.observe($('app')); }

  diffKey = own(DIFFS, save.diff) ? save.diff : 'normal'; mode = own(MODES, save.mode) ? save.mode : 'ffa';
  player = makeTank(true, save.name || 'Ty', PLAYER_COLOR); player.alive = false;
  setupMatch();
  for (let i = 0; i < SHAPE_TARGET; i++) spawnShape();
  for (let i = 0; i < 120; i++) update(STEP); // krátký náběh, ať aréna při startu žije

  elName.value = save.name || '';
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  if (coarse) { elApp.classList.add('touch'); setAuto(true); }
  $('hintText').textContent = coarse
    ? 'Levý palec pohybuje, pravý míří a střílí. Tlačítko Skok uhýbá, Auto míří za tebe. Body vylepšení rozdáváš klepnutím na panel vlevo.'
    : 'WASD pohyb, myš míří, klik nebo mezerník střílí. Shift = skok, 1–8 vylepšují stavbu, E zapíná Auto, P pauza.';
  refreshMenu();
  requestAnimationFrame(t => { lastT = t; requestAnimationFrame(frame); });
}
