/* mp.js - online zápas Kouloví Kámošů (multiplayer): dva hráči se střídají v pouštění koulí do jedné společné misky, komu koule vypadne první, prohrává.
   Hra se spustí s rozhraním window.jomaridMP (appka, src/mp), jinak se tenhle soubor jen načte a nic nedělá.

   Jak to funguje:
   - Pořadí koulí je společné: n-tý hod má u obou stejný typ (odvozený ze semínka zápasu, ne z toho, co se děje v misce).
   - Na tahu je jeden hráč. Zamíří, pustí kouli (zpráva d: kam a jakou) a jeho hra spočítá, jak se miska usadí (spojování koulí, kutálení). Soupeř mezitím
     vidí stejný pád (jeho hra ho přehraje) a nic nerozhoduje. Když se miska usadí, tah hráče pošle její stav (zpráva r: všechny koule) a tah přechází na soupeře.
   - Stav misky po tahu je závazný pro oba: soupeř si ho převezme místo toho, aby spoléhal na vlastní přehrání (fyzika měkkých koulí se může
     v různých prohlížečích o kousek lišit, závazný stav tomu brání). Když koule při tahu vypadne (z misky ven), prohrává ten, kdo byl na tahu
     (zpráva r s out), a oba to ohlásí serveru. O pořadí, čase na tah (60 vteřin) a odměně rozhoduje server (db/multiplayer.sql). */
const MPI = window.jomaridMP && window.jomaridMP.enabled ? window.jomaridMP : null;
const MP_SETTLE_MIN = 70, MP_CALM = 30, MP_SETTLE_MAX = 480, MP_CALM_SPEED = 0.5;   // snímky (60 za vteřinu) a rychlost, pod kterou se miska počítá za klidnou
const MP_MAX_BALLS = 160;

// Typ koule pro hod číslo k: stejný vzorec jako sr() (denní výzva), jen s počítadlem místo stavu, ať nezáleží na pořadí volání.
const mpType = (k) => { const s = ((MPI ? MPI.init.seed | 0 : 0) + Math.imul(k + 1, 0x6D2B79F5)) | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return [0, 0, 0, 1, 1, 2, 3][(((t ^ t >>> 14) >>> 0) / 4294967296) * 7 | 0]; };
const mpMe = () => (MPI ? MPI.init.slot : 1);

function mpInit() {
  S.tut = 1; S.disc = 11;                       // online zápas nemá návod pro první hru a ukazuje všechny typy koulí
  start('mp');
  g.mp = { k: 0, phase: 'wait', view: null, steps: 0, calm: 0, synced: false, ended: null, reason: '', note: '', noteT: 0, reported: false };
  mpTurnBalls();
  MPI.on('sync', (d) => mpSync(d));
  MPI.on('moves', (d) => { for (const m of d.moves || []) mpApply(m); });
  MPI.on('match', (d) => { g.mp.view = d.match; });
  MPI.on('end', (d) => mpEnd(d));
  MPI.listen();
}

// Koule, které hráč drží a které je další (podle počtu odehraných tahů).
function mpTurnBalls() { g.cur = mpType(g.mp.k); g.next = mpType(g.mp.k + 1); g.cG = g.nG = 0; }

function mpNote(text) { g.mp.note = text; g.mp.noteT = 240; }
const mpMyTurn = () => { const v = g.mp.view; return !!(v && v.status === 'active' && v.turn === mpMe()); };
const mpCanAim = () => g.mp.synced && !g.mp.ended && g.mp.phase === 'wait' && mpMyTurn();
const mpAim = () => mpCanAim();

// ---------- Stav misky ----------
// Stav misky pro soupeře: každá koule jako [typ, fáze, x0, y0, ..., x7, y7] (osm bodů měkkého těla, na desetiny pixelu).
function mpSnapshot() {
  return g.balls.map((b) => { const a = [b.t, +b.ph.toFixed(2)]; for (const p of b.P) a.push(+p.x.toFixed(1), +p.y.toFixed(1)); return a; });
}
function mpSnapOk(b) {
  return Array.isArray(b) && b.length <= MP_MAX_BALLS && b.every((a) => Array.isArray(a) && a.length === 2 + NP * 2 && Number.isInteger(a[0]) && a[0] >= 0 && a[0] < RAD.length && a.every((v) => typeof v === 'number' && isFinite(v) && Math.abs(v) < 5000));
}
function mpSetBalls(b) {
  g.balls = b.map((a) => { const o = mk(0, 0, a[0]); o.ph = a[1]; for (let i = 0; i < NP; i++) Object.assign(o.P[i], { x: a[2 + i * 2], y: a[3 + i * 2], vx: 0, vy: 0 }); cm(o); o.age = 999; return o; });
  g.overT = 0;
}
function mpAddDrop(x, t, quiet) {
  const r = RAD[t], nb = mk(clamp(x, AL + r + 6, AR - r - 6), DROP_Y, t);
  g.balls.push(nb); g.cool = 35;
  if (!quiet) snd(260, .08, 'triangle');
}

// ---------- Zprávy od soupeře a historie ----------
// Zpráva zápasu: d = hod (kam a jaká koule), r = stav misky po tahu (k = pořadí tahu, out = vypadla koule, b = koule v misce)
function mpApply(m, quiet) {
  const o = m.payload;
  if (!o || typeof o !== 'object' || g.mp.ended) return;
  const mine = m.p === mpMe();
  if (o.d) {
    if (o.k !== g.mp.k || !Number.isFinite(o.x) || !Number.isInteger(o.t) || o.t < 0 || o.t >= RAD.length) { mpNote('Hod od soupeře neodpovídá pořadí.'); return; }
    mpAddDrop(o.x, o.t, quiet);
    g.mp.phase = mine ? 'mine' : 'replay'; g.mp.steps = 0; g.mp.calm = 0;
  } else if (o.r) {
    if (o.k !== g.mp.k) return;
    if (o.out) { mpOver(mine ? 'loss' : 'win', 'out'); return; }
    if (!mpSnapOk(o.b)) { mpNote('Stav misky od soupeře je neplatný.'); return; }
    mpSetBalls(o.b);
    g.mp.k = o.k + 1; g.mp.phase = 'wait'; mpTurnBalls();
  }
}

function mpSync(d) {
  g.mp.view = d.match;
  for (const m of d.moves || []) mpApply(m, true);
  g.mp.synced = true;
  if (d.match && d.match.status !== 'active') mpEnd({ match: d.match, outcome: d.outcome });
}

// ---------- Můj tah ----------
function mpDown(e) {
  const [x, y] = pt(e);
  if (x > 430 && y < 90) { toMenu(); return; }
  if (!mpCanAim() || y > 880) return;
  g.aiming = true; g.pid = e.pointerId; g.aimX = x; cv.setPointerCapture(e.pointerId);
}
function mpDrop() {
  if (!mpCanAim() || g.cool > 0) return;
  const t = mpType(g.mp.k), r = RAD[t], x = Math.round(clamp(g.aimX, AL + r + 6, AR - r - 6) * 10) / 10;
  mpAddDrop(x, t);
  g.mp.phase = 'mine'; g.mp.steps = 0; g.mp.calm = 0;
  MPI.move({ d: 1, k: g.mp.k, x, t }, { endTurn: false }).catch(mpFail);
}
function mpFail(err) {
  if (!err || err.code === 'not_active') return;
  mpNote(err.code === 'timeout' ? 'Vypršel ti čas na tah.' : 'Tah se nepodařilo odeslat.');
}

// Po každém kroku fyziky: usazení misky po mém tahu. Za klidnou se miska počítá, když se všechny koule aspoň chvíli téměř nehýbou.
function mpStep() {
  const P = g.mp;
  if (P.phase !== 'mine' && P.phase !== 'replay') return;
  P.steps++;
  if (P.phase !== 'mine') return;
  let mx = 0;
  for (const b of g.balls) mx = Math.max(mx, Math.hypot(b.vx, b.vy));
  P.calm = mx < MP_CALM_SPEED ? P.calm + 1 : 0;
  if ((P.steps >= MP_SETTLE_MIN && P.calm >= MP_CALM) || P.steps >= MP_SETTLE_MAX) mpSettle();
}
function mpSettle() {
  const P = g.mp, k = P.k;
  // Pořadí tahu se zvedne hned, ne až po potvrzení serveru: soupeř může hrát dřív, než odpověď serveru dorazí, a jeho hod by jinak neseděl na pořadí.
  P.phase = 'sent'; P.k = k + 1; mpTurnBalls();
  MPI.move({ r: 1, k, b: mpSnapshot() }, { endTurn: true }).then(() => { if (P.phase === 'sent') P.phase = 'wait'; }, (err) => {
    mpFail(err);
    if (P.phase === 'sent') { P.k = k; P.phase = 'wait'; mpTurnBalls(); }
  });
}

// Koule vypadla z misky (step() zavolá finish): prohrává ten, kdo je zrovna na tahu, tedy já, když jsem pustil kouli. Při přehrávání cizího tahu rozhoduje soupeřova zpráva.
function mpFinish() {
  const P = g.mp;
  g.overT = 0;
  if (P.phase !== 'mine' || P.ended) return;
  P.phase = 'over';
  const k = P.k;
  MPI.move({ r: 1, k, out: 1 }, { endTurn: true }).catch(() => {});
  mpOver('loss', 'out');
}

// ---------- Konec ----------
function mpOver(outcome, reason) {
  const P = g.mp;
  if (P.ended) return;
  P.ended = outcome; P.reason = reason; P.phase = 'over';
  snd(outcome === 'win' ? 660 : 120, .5, outcome === 'win' ? 'sine' : 'sawtooth', .07);
  if (!P.reported) { P.reported = true; MPI.report(outcome, reason).catch(() => {}); }
}
// Konec od serveru (vypršel čas, soupeř vzdal, odpojení, zrušení): převezme se a nic se neposílá zpět.
function mpEnd(d) {
  const P = g.mp, v = d.match || {};
  if (P.ended) { P.final = true; return; }
  const outcome = d.outcome || (v.status === 'void' ? 'void' : v.winner === 0 ? 'draw' : v.winner === v.slot ? 'win' : 'loss');
  P.reported = true; P.ended = outcome; P.reason = v.reason || ''; P.phase = 'over'; P.final = true;
}
function mpLeave() { MPI.close(); }

// ---------- Kreslení ----------
function mpTimeLeft() { const v = g.mp.view; return v && v.deadline ? Math.max(0, Math.ceil((v.deadline - MPI.serverNow()) / 1000)) : null; }
function mpHud() {
  const P = g.mp, v = P.view || {}, opp = (MPI.init.opponent && MPI.init.opponent.name) || 'Soupeř';
  txt('Hod ' + (P.k + 1), 24, 50, 44, 'left', '#5be04a');
  txt('Soupeř: ' + opp, 24, 100, 30);
  if (P.noteT > 0) { P.noteT--; txt(P.note, W / 2, 250, 26, 'center', '#ffd92e'); }
  if (!P.synced) { txt('Načítám zápas...', W / 2, 250, 32, 'center', '#ffd92e'); return; }
  if (P.ended) return;
  const mine = mpMyTurn(), left = mpTimeLeft();
  if (mine && P.phase === 'wait') txt('Jsi na tahu: pusť kouli', W / 2, 190, 34, 'center', '#5be04a');
  else if (P.phase === 'mine' || P.phase === 'sent') txt('Miska se usazuje...', W / 2, 190, 34, 'center', '#ffd92e');
  else txt('Hraje ' + opp, W / 2, 190, 34, 'center', '#ffd92e');
  if (left != null && v.status === 'active') txt(left + ' s', 500, 100, 36, 'right', left <= 10 ? '#ff6b6b' : '#ffd92e');
}
// Konec zápasu přes plátno: velký nápis a vysvětlení. Odměnu a tlačítka ukazuje appka pod hrou.
function mpDraw() {
  const P = g.mp;
  if (!P || !P.ended) return;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 300, W, 260);
  const o = P.ended;
  txt(o === 'win' ? 'Vyhráváš!' : o === 'loss' ? 'Prohrál jsi' : o === 'draw' ? 'Remíza' : 'Zápas zrušen', W / 2, 370, 64, 'center', o === 'win' ? '#5be04a' : '#fff');
  const why = P.reason === 'out' ? (o === 'win' ? 'Soupeři vypadla koule.' : 'Tobě vypadla koule.')
    : P.reason === 'timeout' ? (o === 'win' ? 'Soupeři vypršel čas.' : 'Vypršel ti čas.')
    : P.reason === 'resign' ? (o === 'win' ? 'Soupeř to vzdal.' : 'Vzdal jsi to.')
    : P.reason === 'opponent_gone' ? 'Soupeř se odpojil.' : '';
  if (why) txt(why, W / 2, 440, 30, 'center', '#fff');
  if (!P.final) txt('Čekám na potvrzení výsledku...', W / 2, 500, 24, 'center', '#ffd92e');
}

if (MPI) mpInit();
