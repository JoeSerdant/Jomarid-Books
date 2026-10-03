// Herní režimy. Každý režim je objekt s pravidly a háčky, na které se engine v pravý čas ptá:
//
//   name, tag, info   texty do menu
//   diff              ukázat volbu obtížnosti
//   team              hráč je v týmu 1 (spojenci i nepřátelé mají týmové barvy)
//   solo              smrt hráče končí hru (bez znovuzrození)
//   noBoss/noEvents   vypne obvyklé bossy a události (režim má vlastní)
//   noFocus           boti se na hráče nezaměřují víc než na ostatní (obtížnost Peklo)
//   setup(D)          po obecném přípravě zápasu vytvoří boty a stav režimu
//   playerStart(p)    upraví hráče při startu (úroveň, statistiky)
//   tick(dt)          každý krok hry
//   hud()             HTML do horní lišty cíle (prázdné = skrytá)
//   steer(b, ai)      vektor řízení navíc pro bota (kam má jít kvůli cíli režimu)
//   farmOk(x, y)      smí bot farmit tady?
//   onShapeKill(k,s)  zničený tvar
//   xpScale(s)        násobek zkušeností za zničený tvar
//   onKill(k, t)      zničený tank (k = kdo zničil, může být null)
//   onBossDown(t, k)  poražený boss
//   lbList()/lbText(t) tabulka nejlepších
//   draw(g, V, px)    kreslení ve světě pod předměty, drawTop nad nimi (bouře), mini(g, k) mini mapa
//   deathExtra()      doplňující údaje na obrazovce po zničení
//   result(win)       texty a údaje na konci hry
//
// M() vrací objekt aktuálního režimu.
function M() { return MODES[mode] || MODES.ffa; }

const MODE_D = {
  survival: { easy: { waves: 6, n: 0.6, lvl: 0.7 }, normal: { waves: 10, n: 0.85, lvl: 0.9 }, hard: { waves: 12, n: 1, lvl: 1 }, hell: { waves: 15, n: 1.25, lvl: 1.12 } },
  hill: { easy: 50, normal: 80, hard: 100, hell: 120 },
  royale: { easy: 1.3, normal: 1.1, hard: 1, hell: 0.85 },        // násobek délky zužování
};
const fmtTime = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const wavePlural = n => (n === 1 ? 'vlnu' : n >= 2 && n <= 4 ? 'vlny' : 'vln');

// Rozdělí body vlastností podle vah (hráč na začátku režimů, kde startuje na vyšší úrovni).
function allocStats(t, w) {
  while (t.points > 0) {
    let bi = -1, bs = -1;
    for (let i = 0; i < 8; i++) { const c = t.stats[i]; if (c >= STAT_MAX) continue; const sc = w[i] / (c + 1.2); if (sc > bs) { bs = sc; bi = i; } }
    if (bi < 0) break;
    t.stats[bi]++; t.points--;
  }
  recalc(t);
}
function boostPlayer(p, lvl) { addScore(p, xpFor(lvl)); allocStats(p, ARCH.balanced.w); p.hp = p.maxHp; }
// Boti pro režimy "každý sám za sebe".
function spawnBots(D) { for (let i = 0; i < D.bots; i++) { const t = makeTank(false, '', BOT_COLORS[0]); if (D.start > 1) addScore(t, xpFor(D.start)); } }
function aliveCount(filter) { let n = 0; for (const t of tanks) if (t.alive && !t.boss && (!filter || filter(t))) n++; return n; }

// Konec zápasu (výhra i porážka). res = { title, text, extra: [[popisek, hodnota], ...] }.
function finishMatch(win, res) {
  if (world.over) return;
  world.over = true; world.win = win; world.end = res || {};
  player.alive = false;
  for (const b of bullets) if ((b.drone || b.trap) && b.owner === player) b.dead = true;
  state = 'dead'; ui.deadT = 0.8; ui.spec = null; ui.specT = 0;
  Object.assign(deathInfo, { by: '', level: player.level, score: Math.round(player.score), kills: player.kills, time: time - player.born });
  beep(win ? 'ach' : 'die');
}
// Smrt hráče v režimu bez znovuzrození: hra končí.
function soloOver(killer) {
  if (world.over) return;
  const res = M().result ? M().result(false, killer) : { title: 'Konec hry', text: '' };
  world.over = true; world.win = false; world.end = res;
}

const MODES = {
  /* ---------- Klasika ---------- */
  ffa: {
    name: 'Klasika', tag: 'Každý sám za sebe', diff: true,
    info: 'Každý sám za sebe. Aréna s bossy, událostmi, zónami a bonusy.',
    setup(D) { spawnBots(D); },
  },

  /* ---------- Týmy ---------- */
  teams: {
    name: 'Týmy', tag: 'Modří proti červeným', diff: true, team: true,
    info: 'Modří proti červeným. Spojenci ti kryjí záda; vyhrává tým, který první zničí cílový počet tanků.',
    setup(D) {
      const n = Math.max(3, Math.round(D.bots / 2));
      for (let i = 0; i < n - 1; i++) makeTank(false, '', TEAM_COLORS[1], 1);
      for (let i = 0; i < n - (diffKey === 'easy' ? 1 : 0); i++) makeTank(false, '', TEAM_COLORS[2], 2);
    },
    tick() {
      const g = DIFFS[diffKey].goal;
      for (const tm of [1, 2]) if (world.teamScore[tm] >= g) { finishMatch(tm === 1, MODES.teams.result(tm === 1)); if (tm === 1) save.st.wins++; break; }
    },
    hud: () => '<span class="tb">Modří ' + world.teamScore[1] + '</span><small>cíl ' + DIFFS[diffKey].goal + '</small><span class="tr">' + world.teamScore[2] + ' Červení</span>',
    result: (win) => ({ title: win ? 'Vítězství!' : 'Porážka', text: (win ? 'Tvůj tým vyhrál ' : 'Soupeři vyhráli ') + world.teamScore[1] + ' : ' + world.teamScore[2] + '.' }),
    onKill(k, t) { if (k && k.team && t.team && k.team !== t.team) world.teamScore[k.team]++; },
  },

  /* ---------- Cvičiště ---------- */
  sandbox: {
    name: 'Cvičiště', tag: 'Bez tlaku', diff: false, noBoss: true, noEvents: true,
    info: 'Bez tlaku: maximální úroveň, střelecké terče a libovolná třída i výhody na jedno klepnutí.',
    setup() {
      for (let i = 0; i < 5; i++) {
        const t = makeTank(false, 'Terč', '#8fa0aa', 0), a = i * TAU / 5;
        t.ai.dummy = true; t.name = 'Terč'; t.color = '#8fa0aa'; t.x = HALF + Math.cos(a) * 520; t.y = HALF + Math.sin(a) * 520;
      }
    },
    playerStart() { sandboxPrep(); },
  },

  /* ---------- Přežití: vlny nepřátel ---------- */
  survival: {
    name: 'Přežití', tag: 'Vlny nepřátel', diff: true, team: true, solo: true, noBoss: true,
    info: 'Přežij vlny stále silnějších nepřátel. Máš dva spojence, mezi vlnami se léčíš a farmíš. Každá pátá vlna přivede bosse. Když padneš, hra končí.',
    playerStart(p) { boostPlayer(p, 4); },
    setup(D) {
      for (let i = 0; i < 2; i++) { const t = makeTank(false, '', TEAM_COLORS[1], 1); addScore(t, xpFor(6)); }
      Object.assign(world, { wave: 0, waveT: 8, waveState: 'rest', waveKills: 0, waveGoal: MODE_D.survival[diffKey].waves });
    },
    tick(dt) {
      if (world.over) return;
      if (world.waveState === 'rest') {
        world.waveT -= dt;
        if (world.waveT <= 0) MODES.survival.startWave();
      } else if (!tanks.some(t => t.alive && t.team === 2)) {
        const w = world.wave;
        save.st.bestWave = Math.max(save.st.bestWave || 0, w);
        if (w >= world.waveGoal) { save.st.survWins = (save.st.survWins || 0) + 1; finishMatch(true, MODES.survival.result(true)); return; }
        world.waveState = 'rest'; world.waveT = 10;
        heal(player, player.maxHp * 0.5); dropPickup(player.x, player.y, 4);
        banner('Vlna ' + w + ' zvládnuta! Další za 10 s', 'good'); beep('ach');
      }
    },
    startWave() {
      const Dm = MODE_D.survival[diffKey], w = ++world.wave, boss = w % 5 === 0;
      world.waveState = 'fight';
      const n = Math.max(2, Math.round(clamp(1 + w * 1.15, 2, 14) * Dm.n * (boss ? 0.5 : 1))), L = clamp(Math.round(w * 2.2 * Dm.lvl), 2, MAX_LEVEL - 2);
      for (let i = 0; i < n; i++) {
        const t = makeTank(false, '', TEAM_COLORS[2], 2), a = rand(0, TAU), r = rand(1000, 1500);
        t.x = clamp(player.x + Math.cos(a) * r, 140, WORLD - 140); t.y = clamp(player.y + Math.sin(a) * r, 140, WORLD - 140);
        t.temp = true; t.invuln = 1.5; t.ai.seek = true; t.ai.fearless = true;
        addScore(t, xpFor(L));
      }
      if (boss) { spawnBoss(); world.boss.team = 2; }
      banner('Vlna ' + w + (boss ? ' – přichází boss!' : ': ' + n + ' nepřátel'), boss ? 'boss' : 'info'); beep(boss ? 'boss' : 'level');
    },
    hud: () => world.waveState === 'rest'
      ? '<span>Vlna <b>' + world.wave + '</b> / ' + world.waveGoal + '</span><small>další za ' + fmtTime(world.waveT) + '</small>'
      : '<span>Vlna <b>' + world.wave + '</b> / ' + world.waveGoal + '</span><small>nepřátel ' + tanks.filter(t => t.alive && t.team === 2).length + '</small>',
    onKill(k, t) { if (t.team === 2 && k && k.isPlayer) world.waveKills++; },
    result(win) {
      const w = win ? world.wave : Math.max(0, world.wave - (world.waveState === 'fight' ? 1 : 0));
      return {
        title: win ? 'Přežil jsi všechny vlny!' : 'Konec hry',
        text: win ? 'Zvládnuté vlny: ' + world.wave + ' z ' + world.waveGoal + '.' : w ? 'Zvládl jsi ' + w + ' ' + wavePlural(w) + ' z ' + world.waveGoal + '.' : 'Padl jsi hned v první vlně.',
        extra: [['Vlna', world.wave], ['Poražených nepřátel', world.waveKills]],
      };
    },
    deathExtra: () => [['Vlna', world.wave]],
  },

  /* ---------- Král kopce ---------- */
  hill: {
    name: 'Král kopce', tag: 'Drž kopec', diff: true,
    info: 'V aréně je kopec. Kdo stojí uvnitř, sbírá body – uvnitř se o ně dělíš se všemi ostatními. Kopec se čas od času přesune. Kdo první nasbírá cílový počet, vyhrává.',
    setup(D) {
      spawnBots(D);
      const H = world.hill = { x: HALF, y: HALF, r: 250, t: 0, nx: 0, ny: 0, warn: false, next: 85, goal: MODE_D.hill[diffKey], inside: 0 };
      H.nx = H.x; H.ny = H.y;
      for (const t of tanks) t.hillPts = 0;
    },
    tick(dt) {
      const H = world.hill; if (!H || world.over) return;
      H.t += dt;
      if (!H.warn && H.t > H.next - 9) {              // upozornění a výběr nového místa
        H.warn = true;
        for (let k = 0; k < 30; k++) {
          const x = rand(800, WORLD - 800), y = rand(800, WORLD - 800);
          if (Math.hypot(x - H.x, y - H.y) > 1100 && !inLava(x, y)) { H.nx = x; H.ny = y; break; }
        }
        banner('Kopec se za chvíli přesune!', 'event');
      }
      if (H.t >= H.next) { H.x = H.nx; H.y = H.ny; H.t = 0; H.warn = false; H.next = 85; banner('Kopec je na novém místě', 'info'); beep('pick'); }
      let n = 0;
      for (const t of tanks) {
        if (!t.alive || t.boss || (t.ai && t.ai.dummy)) continue;
        if (Math.hypot(t.x - H.x, t.y - H.y) < H.r + t.r * 0.3) n++;
      }
      H.inside = n;
      if (n) {
        for (const t of tanks) {
          if (!t.alive || t.boss || (t.ai && t.ai.dummy) || Math.hypot(t.x - H.x, t.y - H.y) >= H.r + t.r * 0.3) continue;
          t.hillPts = (t.hillPts || 0) + dt / n * (n === 1 ? 1.5 : 1);
          if (t.hillPts >= H.goal) {
            const win = t.isPlayer;
            if (win) save.st.hillWins = (save.st.hillWins || 0) + 1;
            finishMatch(win, MODES.hill.result(win, t)); return;
          }
        }
      }
    },
    lbList: () => tanks.filter(t => !t.boss && !(t.ai && t.ai.dummy)),
    lbVal: t => t.hillPts || 0,
    lbText: t => Math.floor(t.hillPts || 0),
    hud() {
      const H = world.hill; if (!H) return '';
      const top = tanks.filter(t => !t.boss).sort((a, b) => (b.hillPts || 0) - (a.hillPts || 0))[0];
      return '<span>Kopec <b>' + Math.floor(player.hillPts || 0) + '</b> / ' + H.goal + '</span><small>' + (top && top !== player ? 'vede ' + top.name + ' (' + Math.floor(top.hillPts || 0) + ')' : 'vedeš ty') + '</small>';
    },
    steer(b, ai) {
      const H = world.hill; if (!H || ai.mode === 'flee' || ai.mode === 'heal') return null;
      const gx = H.warn ? H.nx : H.x, gy = H.warn ? H.ny : H.y, dx = gx - b.x, dy = gy - b.y, d = Math.hypot(dx, dy) || 1;
      const w = d > H.r * 0.7 ? (ai.mode === 'hunt' ? 0.9 : 1.6) : 0.15;
      return { x: dx / d * w, y: dy / d * w };
    },
    result(win, t) {
      const H = world.hill;
      return {
        title: win ? 'Jsi králem kopce!' : 'Porážka',
        text: win ? 'Nasbíral jsi ' + H.goal + ' bodů jako první.' : (t ? t.name + ' nasbíral ' + H.goal + ' bodů jako první.' : ''),
        extra: [['Body kopce', Math.floor(player.hillPts || 0)], ['Pořadí', tanks.filter(x => !x.boss && (x.hillPts || 0) > (player.hillPts || 0)).length + 1 + '.']],
      };
    },
    deathExtra: () => [['Body kopce', Math.floor(player.hillPts || 0)]],
    draw(g, V, px) {
      const H = world.hill; if (!H) return;
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.4), contested = H.inside > 1, mine = H.inside === 1 && Math.hypot(player.x - H.x, player.y - H.y) < H.r;
      const col = contested ? '#ff6b5e' : mine ? '#5fdc7a' : theme.accent;
      g.globalAlpha = 0.1 + 0.06 * pulse; g.fillStyle = col; g.beginPath(); g.arc(H.x, H.y, H.r, 0, TAU); g.fill();
      g.globalAlpha = 0.85; g.strokeStyle = col; g.lineWidth = 5 * px; g.setLineDash([22 * px, 14 * px]); g.lineDashOffset = -time * 24 * px;
      g.beginPath(); g.arc(H.x, H.y, H.r, 0, TAU); g.stroke(); g.setLineDash([]);
      g.globalAlpha = 0.22 + 0.1 * pulse; g.lineWidth = 2 * px; g.beginPath(); g.arc(H.x, H.y, H.r * 0.55, 0, TAU); g.stroke();
      if (H.warn) { g.globalAlpha = 0.5 + 0.4 * Math.sin(time * 7); g.strokeStyle = '#f5c542'; g.lineWidth = 4 * px; g.setLineDash([10 * px, 12 * px]); g.beginPath(); g.arc(H.nx, H.ny, H.r, 0, TAU); g.stroke(); g.setLineDash([]); }
      g.globalAlpha = 1;
    },
    mini(g, k) {
      const H = world.hill; if (!H) return;
      g.strokeStyle = theme.accent; g.fillStyle = theme.accent; g.lineWidth = 2;
      g.globalAlpha = 0.28; g.beginPath(); g.arc(H.x * k, H.y * k, H.r * k, 0, TAU); g.fill();
      g.globalAlpha = 0.9; g.stroke();
      if (H.warn) { g.strokeStyle = '#f5c542'; g.beginPath(); g.arc(H.nx * k, H.ny * k, H.r * k, 0, TAU); g.stroke(); }
      g.globalAlpha = 1;
    },
    target: () => (world.hill ? { x: world.hill.x, y: world.hill.y, color: theme.accent } : null),
  },

  /* ---------- Poslední přeživší ---------- */
  royale: {
    name: 'Poslední přeživší', tag: 'Zužující se bouře', diff: true, solo: true, noFocus: true, noBoss: true,
    info: 'Všichni začínají silnější a nikdo se nevrací. Bouře se zužuje a ničí všechno za svými hranicemi. Zůstaň naživu jako poslední.',
    setup(D) {
      spawnBots(D);
      world.place = 0;
      world.storm = { cx: HALF, cy: HALF, r: 2500, phase: 0, t: 0, state: 'wait', tx: HALF, ty: HALF, tr: 2500, fx: HALF, fy: HALF, fr: 2500, dur: 0, left: 75, fight: MODE_D.royale[diffKey] };
      for (const t of tanks) if (!t.isPlayer) { t.temp = true; addScore(t, xpFor(12)); }
    },
    playerStart(p) { boostPlayer(p, 12); },
    tick(dt) {
      const S = world.storm; if (!S || world.over) return;
      const RADII = [2500, 1750, 1200, 800, 500, 260, 90];
      S.t += dt;
      if (S.state === 'wait') {
        S.left -= dt;
        if (S.left <= 0) {                                            // začne zužování na další kruh
          const pr = Math.min(S.phase + 1, RADII.length - 1);
          if (pr === S.phase) { S.left = 1e9; } else {
            const nr = RADII[pr], room = Math.max(0, S.r - nr) * 0.8, a = rand(0, TAU), d = Math.sqrt(Math.random()) * room;
            S.fx = S.cx; S.fy = S.cy; S.fr = S.r; S.tx = clamp(S.cx + Math.cos(a) * d, nr, WORLD - nr); S.ty = clamp(S.cy + Math.sin(a) * d, nr, WORLD - nr); S.tr = nr;
            S.state = 'shrink'; S.dur = (35 + pr * 3) * S.fight; S.left = S.dur; S.phase = pr;
            banner(pr >= RADII.length - 1 ? 'Poslední zužování bouře!' : 'Bouře se zužuje!', 'boss'); beep('boss');
          }
        } else if (S.left < 12 && !S.warned) { S.warned = true; banner('Bouře se za chvíli začne zužovat', 'event'); }
      } else {
        S.left -= dt;
        const f = 1 - clamp(S.left / S.dur, 0, 1), e = f * f * (3 - 2 * f);
        S.r = S.fr + (S.tr - S.fr) * e; S.cx = S.fx + (S.tx - S.fx) * e; S.cy = S.fy + (S.ty - S.fy) * e;
        if (S.left <= 0) { S.state = 'wait'; S.left = Math.max(12, 28 - S.phase * 2) * S.fight; S.warned = false; }
      }
      // poškození mimo bezpečný kruh
      for (const t of tanks) {
        if (!t.alive || t.boss) continue;
        const d = Math.hypot(t.x - S.cx, t.y - S.cy);
        if (d > S.r) hurt(t, ((0.025 + 0.012 * S.phase) * t.maxHp + 3) * dt, null, true);
      }
      S.alive = aliveCount();
      if (player.alive && S.alive <= 1) {
        save.st.royaleWins = (save.st.royaleWins || 0) + 1;
        finishMatch(true, MODES.royale.result(true));
      }
    },
    hud() {
      const S = world.storm; if (!S) return '';
      const st = S.state === 'shrink' ? 'bouře se zužuje (' + fmtTime(S.left) + ')' : S.phase === 0 ? 'bouře začne za ' + fmtTime(S.left) : 'další zužování za ' + fmtTime(S.left);
      return '<span>Zbývá <b>' + aliveCount() + '</b></span><small>' + st + '</small>';
    },
    steer(b, ai) {
      const S = world.storm; if (!S) return null;
      const cx = S.state === 'shrink' ? S.tx : S.cx, cy = S.state === 'shrink' ? S.ty : S.cy, r = S.state === 'shrink' ? S.tr : S.r;
      const dx = cx - b.x, dy = cy - b.y, d = Math.hypot(dx, dy) || 1, lim = Math.min(S.r, r + 200) - 180;
      if (d <= lim) return null;
      const w = Math.min(3.2, 0.8 + (d - lim) / 220);
      return { x: dx / d * w, y: dy / d * w };
    },
    farmOk(x, y) { const S = world.storm; return !S || Math.hypot(x - S.cx, y - S.cy) < S.r - 120; },
    wanderPoint() { const S = world.storm; if (!S) return null; const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * Math.max(60, S.r - 200); return { x: S.cx + Math.cos(a) * rr, y: S.cy + Math.sin(a) * rr }; },
    onKill(k, t) {
      if (t.isPlayer) world.place = aliveCount(x => x !== t) + 1;
    },
    result(win) {
      const place = win ? 1 : (world.place || aliveCount() + 1);
      return {
        title: win ? 'Poslední přeživší!' : 'Vyřazen',
        text: win ? 'Přežil jsi všechny soupeře i bouři.' : 'Skončil jsi na ' + place + '. místě z ' + (DIFFS[diffKey].bots + 1) + '.',
        extra: [['Umístění', place + '.'], ['Zbývalo živých', win ? 1 : aliveCount()]],
      };
    },
    drawTop(g, V, px) {
      const S = world.storm; if (!S) return;
      g.beginPath(); g.rect(V.x0 - 60, V.y0 - 60, V.x1 - V.x0 + 120, V.y1 - V.y0 + 120); g.arc(S.cx, S.cy, S.r, 0, TAU, true);
      g.fillStyle = 'rgba(140,24,84,0.34)'; g.fill('evenodd');
      g.strokeStyle = 'rgba(255,96,150,' + (0.6 + 0.3 * Math.sin(time * 5)) + ')'; g.lineWidth = 6 * px;
      g.beginPath(); g.arc(S.cx, S.cy, S.r, 0, TAU); g.stroke();
      if (S.state === 'shrink') { g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3 * px; g.setLineDash([16 * px, 12 * px]); g.beginPath(); g.arc(S.tx, S.ty, S.tr, 0, TAU); g.stroke(); g.setLineDash([]); }
    },
    mini(g, k) {
      const S = world.storm; if (!S) return;
      g.beginPath(); g.rect(0, 0, WORLD * k, WORLD * k); g.arc(S.cx * k, S.cy * k, S.r * k, 0, TAU, true);
      g.fillStyle = 'rgba(140,24,84,0.4)'; g.fill('evenodd');
      g.strokeStyle = 'rgba(255,96,150,0.9)'; g.lineWidth = 1.5; g.beginPath(); g.arc(S.cx * k, S.cy * k, S.r * k, 0, TAU); g.stroke();
      if (S.state === 'shrink') { g.strokeStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(S.tx * k, S.ty * k, S.tr * k, 0, TAU); g.stroke(); }
    },
    deathExtra: () => [['Umístění', (world.place || aliveCount() + 1) + '.']],
  },

  /* ---------- Hon na bossy ---------- */
  rush: {
    name: 'Hon na bossy', tag: 'Dvanáct bossů', diff: true, team: true, solo: true, noBoss: true, noEvents: true,
    info: 'Poraz všech dvanáct bossů za sebou. Začínáš silnější a dva spojenci ti pomáhají. Mezi bossy je krátká pauza. Když padneš, hra končí.',
    setup() {
      for (let i = 0; i < 2; i++) { const t = makeTank(false, '', TEAM_COLORS[1], 1); addScore(t, xpFor(18)); t.ai.fearless = true; }
      Object.assign(world, { rushN: 0, rushT: 9, bossMul: { easy: 1, normal: 1.15, hard: 1.5, hell: 2 }[diffKey] });
    },
    playerStart(p) { boostPlayer(p, 24); },
    tick(dt) {
      if (world.over) return;
      if (!world.boss) { world.rushT -= dt; if (world.rushT <= 0) { world.rushT = 1e9; spawnBoss(); } }
    },
    onBossDown(t, k) {
      world.rushN++;
      save.st.rushBest = Math.max(save.st.rushBest || 0, world.rushN);
      if (world.rushN >= BOSS_IDS.length) {
        save.st.rushWins = (save.st.rushWins || 0) + 1;
        finishMatch(true, MODES.rush.result(true));
      } else { world.rushT = 10; heal(player, player.maxHp * 0.4); banner('Boss poražen (' + world.rushN + '/' + BOSS_IDS.length + '). Další za 10 s', 'good'); }
    },
    hud: () => '<span>Boss <b>' + Math.min(world.rushN + (world.boss ? 1 : 0), BOSS_IDS.length) + '</b> / ' + BOSS_IDS.length + '</span><small>' + (world.boss ? 'čas ' + fmtTime(time - player.born) : 'další za ' + fmtTime(world.rushT)) + '</small>',
    result(win) {
      return {
        title: win ? 'Všichni bossové poraženi!' : 'Konec hry',
        text: win ? 'Zvládl jsi to za ' + fmtTime(time - player.born) + '.' : 'Porazil jsi ' + world.rushN + ' z ' + BOSS_IDS.length + ' bossů.',
        extra: [['Poražených bossů', world.rushN + ' / ' + BOSS_IDS.length], ['Čas', fmtTime(time - player.born)]],
      };
    },
    deathExtra: () => [['Poražených bossů', world.rushN]],
  },

  /* ---------- Zlatá horečka ---------- */
  gold: {
    name: 'Zlatá horečka', tag: 'Čtyři minuty na lup', diff: true,
    info: 'Čtyři minuty na to nasbírat co nejvíc zlata ze zlatých čtverců a krystalů. Po zničení přijdeš o polovinu lupu a spadne na zem. Vyhrává nejbohatší.',
    setup(D) { spawnBots(D); world.goldT = 240; for (const t of tanks) t.loot = 0; for (let i = 0; i < 60; i++) makeShape(Math.random() < 0.8 ? 'gold' : 'crystal', rand(200, WORLD - 200), rand(200, WORLD - 200)); },
    tick(dt) {
      if (world.over) return;
      world.goldT -= dt;
      if (world.goldT <= 0) {
        const all = tanks.filter(t => !t.boss).sort((a, b) => (b.loot || 0) - (a.loot || 0));
        const win = all[0] === player;
        save.st.bestGold = Math.max(save.st.bestGold || 0, Math.floor(player.loot || 0));
        if (win) save.st.goldWins = (save.st.goldWins || 0) + 1;
        finishMatch(win, MODES.gold.result(win));
      }
    },
    shapeType() { const q = Math.random(); return q < 0.34 ? 'gold' : q < 0.4 ? 'crystal' : null; },
    xpScale: s => (s.type === 'gold' || s.type === 'crystal' ? 0.25 : 1),                      // zlato je hlavně lup, ne rychlé levelování
    onShapeKill(k, s) { if (k && (s.type === 'gold' || s.type === 'crystal')) k.loot = (k.loot || 0) + (s.type === 'gold' ? 10 : 40); },
    onKill(k, t) {
      const lost = Math.floor((t.loot || 0) * 0.5);
      if (k && k !== t) k.loot = (k.loot || 0) + 25;
      if (lost > 0) { t.loot -= lost; for (let i = 0; i < Math.min(8, Math.ceil(lost / 10)); i++) { const s = makeShape('gold', t.x + rand(-50, 50), t.y + rand(-50, 50)); s.dvx = rand(-60, 60); s.dvy = rand(-60, 60); } }
    },
    lbList: () => tanks.filter(t => !t.boss && !(t.ai && t.ai.dummy)),
    lbVal: t => t.loot || 0,
    lbText: t => Math.floor(t.loot || 0),
    hud: () => '<span>Zlato <b>' + Math.floor(player.loot || 0) + '</b></span><small>zbývá ' + fmtTime(world.goldT) + '</small>',
    result(win) {
      const rank = tanks.filter(x => !x.boss && (x.loot || 0) > (player.loot || 0)).length + 1;
      return {
        title: win ? 'Nejbohatší!' : 'Čas vypršel',
        text: win ? 'Nasbíral jsi nejvíc zlata: ' + Math.floor(player.loot || 0) + '.' : 'Skončil jsi na ' + rank + '. místě se ziskem ' + Math.floor(player.loot || 0) + '.',
        extra: [['Zlato', Math.floor(player.loot || 0)], ['Pořadí', rank + '.']],
      };
    },
    deathExtra: () => [['Zlato', Math.floor(player.loot || 0)]],
  },
};
const MODE_IDS = ['ffa', 'teams', 'survival', 'hill', 'royale', 'rush', 'gold', 'sandbox'];
