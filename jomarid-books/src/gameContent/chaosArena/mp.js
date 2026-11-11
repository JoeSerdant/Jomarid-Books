/* mp.js - Chaos Aréna online ve dvou: výběr třídy, síť, ovládání, hlavní smyčka a konec hry.
   Zápas počítá jeden hráč (hostitel, místo 1) celou arénu podle sim.js; druhý (host, místo 2) dostává obraz světa (nepřátelé, střely, power-upy, hráči, vlna) a posílá hostiteli
   svůj pohyb, míření a střelbu. Host si pohyb svého hrdiny počítá sám (odezva nic nestojí) a hostitel jeho polohu omezí rychlostí. Zdraví, zásahy, skóre a výhru určuje vždy hostitel.
   Zprávy jdou přes kanál zápasu (window.jomaridMP.rt): host -> hostitel {k:'i'} (vstup), hostitel -> host {k:'S'} (obraz světa, společný základ shared/net.js) a {k:'go'}, {k:'end'}.
   Výsledek (vyhráli jste devět vln / padli oba) hlásí oba hráči, o Coinech rozhodne server (db/multiplayer.sql). */
(function () {
  'use strict';
  var MPI = window.jomaridMP && window.jomaridMP.enabled ? window.jomaridMP : null;
  var Net = window.JomaridNet;
  var pickEl = document.getElementById('pick');
  if (!MPI || !Net) {
    pickEl.hidden = false;
    pickEl.querySelector('.box').innerHTML = '<h1>Chaos Aréna</h1><p class="sub">Tahle hra běží jen online ve dvou, v appce Jomarid Books (Jomarid Online Games).</p>';
    return;
  }
  var HOST = Number(MPI.init.slot) === 1, ME = HOST ? 0 : 1, PEER = 1 - ME;
  var SEED = Number(MPI.init.seed) || 0;
  var DIFFN = MPI.init.params && MPI.init.params.diff ? MPI.init.params.diff : 'normal';
  var SEND_EVERY = 50;                          // ms mezi obrazy světa od hostitele i vstupy od hosta (po 50 ms: 20 zpráv za vteřinu z každého)
  var SILENT_MS = 5000;                         // tak dlouho bez zpráv a ukáže se, že druhý neodpovídá
  var Q1 = Net.q1, Q2 = Net.q2;

  var names = [HOST ? (MPI.init.me && MPI.init.me.name) || 'Ty' : (MPI.init.opponent && MPI.init.opponent.name) || 'Hostitel',
    HOST ? (MPI.init.opponent && MPI.init.opponent.name) || 'Parťák' : (MPI.init.me && MPI.init.me.name) || 'Ty'];
  NAMES = [String(names[0]).slice(0, 14), String(names[1]).slice(0, 14)];

  var V = { phase: 'pick', myCls: -1, peerCls: -1, started: false, rep: null, mirror: null, last: 0, lastIn: 0, lastSnap: 0, seq: 0, rem: { f: 0, ax: 1, ay: 0, t: 0 }, ended: false, reported: false,
    peerSeen: 0, open: false, error: '', note: '', lastCls: 0, endNote: '', asked: 0, ak: 1, lastGo: 0, guestIn: false };
  var now = function () { return Date.now(); };
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  function send(pkt, force) { try { MPI.rt.send(pkt, { force: !!force }); } catch (e) { /* kanál není */ } }
  function sendSure(pkt) { send(pkt, true); setTimeout(function () { send(pkt, true); }, 350); setTimeout(function () { send(pkt, true); }, 1100); }

  // ---------- Výběr třídy ----------
  var ICONS = ['🔫', '⚡', '💚', '🛡️', '🚀'];
  function buildPick() {
    var box = document.getElementById('classes');
    box.innerHTML = '';
    CLS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('data-cls', String(i));
      b.innerHTML = '<span class="ic" aria-hidden="true">' + ICONS[i] + '</span><b></b><small></small>';
      b.querySelector('b').textContent = c.n; b.querySelector('small').textContent = c.d;
      b.addEventListener('click', function () { chooseClass(i); });
      box.appendChild(b);
    });
    pickEl.hidden = false;
    refreshPick();
  }
  function chooseClass(i) {
    initAudio();
    if (V.started) return;
    V.myCls = i;
    refreshPick();
    sendCls();
    if (HOST) maybeBegin();
  }
  function sendCls() { if (V.myCls >= 0) send({ k: 'cls', c: V.myCls }, true); }
  function refreshPick() {
    var btns = document.querySelectorAll('#classes button');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(i === V.myCls));
    var note = V.error || (V.myCls < 0 ? 'Vyber si třídu.' : V.peerCls < 0 ? 'Vybráno. Čekám, až si vybere parťák ' + names[PEER] + '…' : 'Oba máte vybráno, začínáme…');
    if (!V.open && !V.error) note = 'Připojuji se…';
    document.getElementById('pickNote').textContent = note;
  }

  // ---------- Začátek ----------
  // Hostitel začne, jakmile zná obě třídy. Posílá hostovi úvodní zprávu s rozložením arény; host ji opakovaně dostává, dokud hra nezačne.
  function maybeBegin() {
    if (!HOST || V.started || V.myCls < 0 || V.peerCls < 0) return;
    var cl = HOST ? [V.myCls, V.peerCls] : [V.peerCls, V.myCls];
    V.ak = 1 + (Math.abs(SEED) % 3);
    simStart({ diff: DIFFN, classes: cl, arena: V.ak });
    ASSIST = S.assist; REMOTE[1] = true; EVQ = [];
    V.rep = new Net.Replicator(hostKinds(), { keyEvery: 3000 });
    V.rep.requestKey(true);
    V.started = true; V.phase = 'play'; pickEl.hidden = true; showTouch();
    sendGo();
  }
  function sendGo() {
    V.lastGo = now();
    send({ k: 'go', cl: [CLS.indexOf(P[0].cl), CLS.indexOf(P[1].cl)], ak: AK, d: DIFFN, ob: Ob.map(function (o) { var r = { x: Q1(o.x), y: Q1(o.y), r: Q1(o.r) }; if (o.m) { r.m = 1; r.ox = Q1(o.ox); r.oy = Q1(o.oy); r.ax = o.ax; r.am = Q1(o.am); r.ph = Q2(o.ph); } return r; }),
      tr: Tr.map(function (t) { return { x: Q1(t.x), y: Q1(t.y), r: t.r, ph: Q2(t.ph) }; }) }, true);
  }
  function beginGuest(m) {
    if (V.started || !m || !m.cl) return;
    diff = DIFF_INDEX[m.d] === undefined ? 1 : DIFF_INDEX[m.d];
    AK = m.ak; V.ak = AK;
    Ob = (m.ob || []).map(function (o) { var r = { x: +o.x, y: +o.y, r: +o.r }; if (o.m) { r.m = 1; r.ox = +o.ox; r.oy = +o.oy; r.ax = o.ax; r.am = +o.am; r.ph = +o.ph; } return r; });
    Tr = (m.tr || []).map(function (t) { return { x: +t.x, y: +t.y, r: +t.r, ph: +t.ph }; });
    P = [0, 1].map(function (i) {
      var c = CLS[clamp(m.cl[i] | 0, 0, CLS.length - 1)];
      return { x: WW / 2 + (i - 0.5) * 70, y: WH / 2, vx: 0, vy: 0, ax: 1, ay: 0, cl: c, hp: DIFFS[diff].ph + c.hp, mhp: DIFFS[diff].ph + c.hp, down: 0, rev: 0, inv: 0, cd: 0, rapid: 0, shield: 0, score: 0, kills: 0, downs: 0, revives: 0 };
    });
    E = []; Bu = []; EB = []; Pu = []; Pa = []; Tx = []; Rg = []; wave = 1; modI = 0; mod = MODS[0]; gt = 0; combo = 0; comboT = 0; teamKills = 0; banner = 2.8; shake = 0;
    ASSIST = S.assist; EVQ = null;
    V.mirror = new Net.Mirror(hostKinds(), mirrorHooks());
    V.started = true; V.phase = 'play'; V.lastSnap = now(); pickEl.hidden = true; state = 'play'; showTouch();
  }

  // ---------- Obraz světa (hostitel -> host) ----------
  var flags = function (e) { return (e.hit > 0 ? 1 : 0) | (e.stun > 0 ? 2 : 0) | (e.windup > 0 ? 4 : 0); };
  function hostKinds() {
    return {
      e: { list: function () { return E; }, id: nid, state: function (e) { return [Q1(e.x), Q1(e.y), Math.round(e.vx), Math.round(e.vy), Math.max(0, e.hp), flags(e)]; },
        info: function (e) { return { k: e.k, r: Q1(e.r), c: e.c, m: e.mhp, b: e.boss ? 1 : 0 }; }, tol: 7, vtol: 45, refresh: 1500,
        dev: function (st, last) { return st[4] !== last[4] || st[5] !== last[5]; } },
      b: { list: function () { return Bu; }, id: nid, state: function (b) { return [Q1(b.x), Q1(b.y), Math.round(b.vx), Math.round(b.vy)]; },
        info: function (b) { return { c: b.c, rk: b.rk ? 1 : 0, big: b.big ? 1 : 0 }; }, tol: 6, vtol: 40, refresh: 1500 },
      s: { list: function () { return EB; }, id: nid, state: function (s) { return [Q1(s.x), Q1(s.y), Math.round(s.vx), Math.round(s.vy)]; }, info: function () { return 0; }, tol: 6, vtol: 40, refresh: 1500 },
      u: { list: function () { return Pu; }, id: nid, state: function (u) { return [Q1(u.x), Q1(u.y), 0, 0, Q1(u.life)]; }, info: function (u) { return { t: u.t }; }, tol: 2, vtol: 5, refresh: 2000 },
      p: { list: function () { return P; }, id: function (p) { return P.indexOf(p) + 1; }, always: true,
        state: function (p) { return [Q1(p.x), Q1(p.y), Math.round(p.vx), Math.round(p.vy), Q2(p.ax), Q2(p.ay), p.hp, p.mhp, p.down ? 1 : 0, Q2(p.rev), Q2(p.inv), p.shield ? 1 : 0, Q1(p.rapid), Q2(Math.max(0, p.cd)), Q2(p.hc || 0), p.score, p.kills, p.downs, p.revives]; },
        info: function () { return 0; } },
    };
  }
  var stCode = function () { return state === 'won' ? 1 : state === 'over' ? 2 : 0; };
  function hostSend() {
    var t = now();
    if (t - V.last < SEND_EVERY - 5) return;
    V.last = t;
    var pkt = V.rep.build(t);
    if (!pkt) return;
    pkt.W = [wave, modI, Q1(banner), combo, Q1(comboT), teamKills, toSpawn, bossDone ? 1 : 0, Q1(gt), stCode()];
    if (EVQ && EVQ.length) { pkt.ev = EVQ; EVQ = []; }
    pkt.k = 'S';
    send(pkt);
  }

  // ---------- Obraz světa u hosta ----------
  function mirrorHooks() {
    return {
      add: function (kind, id, info, st) {
        if (kind === 'e') return { k: info.k, r: info.r, c: info.c, mhp: info.m, boss: info.b, x: st[0], y: st[1], vx: st[2], vy: st[3], hp: st[4], hit: 0, stun: 0, windup: 0, dx: 1, dy: 0, _id: id };
        if (kind === 'b') return { c: info.c, rk: info.rk, big: info.big, x: st[0], y: st[1], vx: st[2], vy: st[3], life: 1 };
        if (kind === 's') return { x: st[0], y: st[1], vx: st[2], vy: st[3], life: 1 };
        if (kind === 'u') return { t: info.t, x: st[0], y: st[1], life: st[4] };
        return null;
      },
      upd: function (kind, id, obj, st) { if (kind === 'e' && obj) { obj.hp = st[4]; var f = st[5]; obj.hit = f & 1 ? 0.1 : 0; obj.stun = f & 2 ? 1 : 0; obj.windup = f & 4 ? 0.3 : 0; } if (kind === 'u' && obj) obj.life = st[4]; },
      remove: function () { /* nic: pole se skládají znovu každý snímek */ },
    };
  }
  function applyEvents(ev) {
    for (var i = 0; i < ev.length && i < 80; i++) {
      var e = ev[i];
      if (!Array.isArray(e)) continue;
      if (e[0] === 'b') burst(+e[1], +e[2], String(e[3]), clamp(+e[4] || 0, 0, 90), clamp(+e[5] || 200, 0, 700));
      else if (e[0] === 'r') ring(+e[1], +e[2], clamp(+e[3] || 0, 0, 400), clamp(+e[4] || 0.3, 0.1, 1), String(e[5]));
      else if (e[0] === 't') floatText(+e[1], +e[2], String(e[3]).slice(0, 8), String(e[4]));
      else if (e[0] === 's') shk(clamp(+e[1] || 0, 0, 30));
      else if (e[0] === 'z') audioBeep(+e[1] || 400, clamp(+e[2] || 0.1, 0.02, 1), String(e[3]), +e[4] || 0.04, +e[5] || 0);
    }
  }
  function onSnapshot(p) {
    V.lastSnap = now();
    var res = V.mirror.apply(p, now());
    if (res.unknown && now() - V.asked > 1000) { V.asked = now(); send({ k: 'Q' }, true); }
    if (p.W) {
      wave = p.W[0] | 0; modI = clamp(p.W[1] | 0, 0, MODS.length - 1); mod = MODS[modI]; banner = Math.max(banner, +p.W[2] || 0); combo = p.W[3] | 0; comboT = +p.W[4] || 0; teamKills = p.W[5] | 0; toSpawn = p.W[6] | 0; bossDone = !!p.W[7];
      if (Math.abs(gt - (+p.W[8] || 0)) > 0.2) gt = +p.W[8] || 0;
      if (!V.ended && p.W[9] === 1) finish(true, 'waves'); else if (!V.ended && p.W[9] === 2) finish(false, 'wipe');
    }
    if (p.ev) applyEvents(p.ev);
    // hráči: vlastní hrdina se počítá tady (z obrazu se berou jen zdraví, skóre apod.), parťák se vyhlazuje z obrazu
    var tbl = V.mirror.table('p');
    tbl.forEach(function (rec, id) {
      var i = id - 1, pl = P[i], st = rec.st;
      if (!pl || !st) return;
      pl.hp = st[6]; pl.mhp = st[7]; pl.down = st[8]; pl.rev = st[9]; pl.inv = st[10]; pl.shield = st[11]; pl.rapid = st[12]; pl.cd = st[13]; pl.hc = st[14]; pl.score = st[15]; pl.kills = st[16]; pl.downs = st[17]; pl.revives = st[18];
      if (i !== ME) { pl.ax = st[4]; pl.ay = st[5]; pl.vx = st[2]; pl.vy = st[3]; }
    });
  }
  // Před každým snímkem: pole nepřátel, střel a power-upů se složí z obrazu (poloha odhadnutá podle rychlosti a vyhlazená)
  var scratch = {};
  function rebuild() {
    var t = now(), m = V.mirror, list;
    list = []; m.table('e').forEach(function (rec) { var o = rec.obj; if (!o) return; m.pos(rec, t, scratch); o.x = clamp(scratch.x, o.r, WW - o.r); o.y = clamp(scratch.y, o.r, WH - o.r); o.vx = rec.st[2]; o.vy = rec.st[3]; var d = Math.hypot(o.vx, o.vy); if (d > 5) { o.dx = o.vx / d; o.dy = o.vy / d; } list.push(o); }); E = list;
    list = []; m.table('b').forEach(function (rec) { var o = rec.obj; if (!o) return; m.pos(rec, t, scratch); o.x = scratch.x; o.y = scratch.y; o.vx = rec.st[2]; o.vy = rec.st[3]; list.push(o); }); Bu = list;
    list = []; m.table('s').forEach(function (rec) { var o = rec.obj; if (!o) return; m.pos(rec, t, scratch); o.x = scratch.x; o.y = scratch.y; list.push(o); }); EB = list;
    list = []; m.table('u').forEach(function (rec) { var o = rec.obj; if (!o) return; o.x = rec.st[0]; o.y = rec.st[1]; list.push(o); }); Pu = list;
    var pr = m.table('p').get(PEER + 1);
    if (pr) { m.pos(pr, t, scratch); P[PEER].x = clamp(scratch.x, 16, WW - 16); P[PEER].y = clamp(scratch.y, 16, WH - 16); }   // odhad podle rychlosti nesmí vyjet ze světa
    var mr = m.table('p').get(ME + 1);   // vlastní hrdina: jen velký rozdíl (znovuzrození, odhození) se opraví podle hostitele
    if (mr) { var hx = mr.st[0], hy = mr.st[1]; if (Math.hypot(P[ME].x - hx, P[ME].y - hy) > 420) { P[ME].x = hx; P[ME].y = hy; } }
  }

  // ---------- Ovládání: klávesnice, myš, dotyk, ovladač ----------
  var keys = {}, mouse = { down: false, x: 0, y: 0 }, touchL = null, touchR = null, TOUCHCFG = { r: 64 };
  addEventListener('keydown', function (e) { keys[e.code] = 1; initAudio(); if (e.code.indexOf('Arrow') === 0 || e.code === 'Space') e.preventDefault(); });
  addEventListener('keyup', function (e) { keys[e.code] = 0; });
  addEventListener('blur', function () { keys = {}; mouse.down = false; });
  cv.addEventListener('mousedown', function (e) { initAudio(); mouse.down = true; mouseMove(e); });
  addEventListener('mouseup', function () { mouse.down = false; });
  cv.addEventListener('mousemove', mouseMove);
  function mouseMove(e) { var r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; }
  var stickL = document.getElementById('stickL'), stickR = document.getElementById('stickR'), touchEl = document.getElementById('touch');
  function showTouch() { if ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0) touchEl.hidden = false; }
  function touchPos(t) { var r = cv.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; }
  function placeStick(el, c, p) { el.style.display = c ? 'block' : 'none'; if (c) { el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; el.style.background = '#ffffff14'; } void p; }
  cv.addEventListener('touchstart', function (e) {
    e.preventDefault(); initAudio();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i], p = touchPos(t);
      if (p.x < CW / 2 && !touchL) touchL = { id: t.identifier, cx: p.x, cy: p.y, x: p.x, y: p.y };
      else if (p.x >= CW / 2 && !touchR) touchR = { id: t.identifier, cx: p.x, cy: p.y, x: p.x, y: p.y };
    }
    placeStick(stickL, touchL); placeStick(stickR, touchR);
  }, { passive: false });
  cv.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i], p = touchPos(t);
      if (touchL && t.identifier === touchL.id) { touchL.x = p.x; touchL.y = p.y; }
      if (touchR && t.identifier === touchR.id) { touchR.x = p.x; touchR.y = p.y; }
    }
  }, { passive: false });
  function touchEnd(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (touchL && t.identifier === touchL.id) touchL = null;
      if (touchR && t.identifier === touchR.id) touchR = null;
    }
    placeStick(stickL, touchL); placeStick(stickR, touchR);
  }
  cv.addEventListener('touchend', touchEnd); cv.addEventListener('touchcancel', touchEnd);

  // Vstup hráče u tohoto zařízení: pohyb (-1..1), střelba, míření (vektor nebo null)
  function readInput() {
    var x = 0, y = 0, f = 0, aim = null;
    if (keys.KeyW || keys.ArrowUp) y--; if (keys.KeyS || keys.ArrowDown) y++; if (keys.KeyA || keys.ArrowLeft) x--; if (keys.KeyD || keys.ArrowRight) x++;
    if (keys.Space || keys.Enter || keys.NumpadEnter || keys.KeyF) f = 1;
    var g = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    if (g) {
      var a = g.axes; if (Math.abs(a[0]) > 0.2) x += a[0]; if (Math.abs(a[1]) > 0.2) y += a[1];
      var B = function (n) { return g.buttons[n] && g.buttons[n].pressed; };
      if (B(14)) x--; if (B(15)) x++; if (B(12)) y--; if (B(13)) y++; f = f || (B(0) || B(7) || B(5) ? 1 : 0);
      if (Math.hypot(a[2] || 0, a[3] || 0) > 0.4) aim = [a[2], a[3]];
    }
    if (mouse.down) { f = 1; var pl = P[ME]; if (pl) { var sc = Math.min(CW / 760, CH / 460), px = (pl.x - VX) * sc, py = (pl.y - VY) * sc; if (Math.hypot(mouse.x - px, mouse.y - py) > 8) aim = [mouse.x - px, mouse.y - py]; } }
    if (touchL) { var dx = touchL.x - touchL.cx, dy = touchL.y - touchL.cy, d = Math.hypot(dx, dy); if (d > 8) { var k = Math.min(1, d / TOUCHCFG.r); x += dx / d * k; y += dy / d * k; } }
    if (touchR) { var rx = touchR.x - touchR.cx, ry = touchR.y - touchR.cy, rd = Math.hypot(rx, ry); f = 1; if (rd > 14) aim = [rx, ry]; }
    var m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    return { x: x, y: y, f: f, aim: aim };
  }

  // Pohyb vlastního hrdiny u hosta: stejný výpočet jako v sim.js (hostitel jeho polohu přebírá z našich zpráv)
  function guestMove(dt) {
    var p = P[ME], n = INP[ME];
    if (!p || p.down) return;
    var sp = p.cl.sp;
    if (mod.ice) { p.vx += (n.x * sp - p.vx) * Math.min(1, dt * 2); p.vy += (n.y * sp - p.vy) * Math.min(1, dt * 2); } else { p.vx = n.x * sp; p.vy = n.y * sp; }
    if (n.aim) { var m = Math.hypot(n.aim[0], n.aim[1]) || 1; p.ax = n.aim[0] / m; p.ay = n.aim[1] / m; } else if (n.x || n.y) { var mm = Math.hypot(n.x, n.y); p.ax = n.x / mm; p.ay = n.y / mm; }
    p.x = clamp(p.x + p.vx * dt, 16, WW - 16); p.y = clamp(p.y + p.vy * dt, 16, WH - 16); pushOut(p, 16);
  }
  function guestFx(dt) {
    shake = Math.max(0, shake - dt * 40); banner = Math.max(0, banner - dt); gt += dt;
    for (var i = 0; i < Ob.length; i++) { var o = Ob[i]; if (o.m) { var s = Math.sin(gt * 0.8 + o.ph) * o.am; o.x = o.ox + (o.ax ? s : 0); o.y = o.oy + (o.ax ? 0 : s); } }
    Pa.forEach(function (a) { a.x += a.vx * dt; a.y += a.vy * dt; a.vx *= 0.94; a.vy *= 0.94; a.life -= dt; }); Pa = Pa.filter(function (a) { return a.life > 0; });
    comboT -= dt; if (comboT <= 0) combo = 0;
    Tx.forEach(function (t) { t.y -= 40 * dt; t.life -= dt; }); Tx = Tx.filter(function (t) { return t.life > 0; }); Rg.forEach(function (r) { r.life -= dt; }); Rg = Rg.filter(function (r) { return r.life > 0; });
    var p = P[ME]; if (p) { p.inv = Math.max(0, p.inv - dt); p.rapid = Math.max(0, p.rapid - dt); p.cd -= dt; p.tg = p.down ? null : aimTarget(p); }
    var q = P[PEER]; if (q) { q.inv = Math.max(0, q.inv - dt); q.rapid = Math.max(0, q.rapid - dt); }
  }
  function sendInput(force) {
    var t = now();
    if (!force && t - V.lastIn < SEND_EVERY - 5) return;
    V.lastIn = t;
    var p = P[ME], n = INP[ME];
    send({ k: 'i', q: ++V.seq, x: Q1(p.x), y: Q1(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), ax: Q2(p.ax), ay: Q2(p.ay), f: n.f ? 1 : 0 });
  }
  function onInput(m) {
    var t = now(), dt = V.rem.t ? (t - V.rem.t) / 1000 : 0.05;
    V.rem.t = t;
    if (!(m.q > (V.rem.q || 0))) return;
    V.rem.q = m.q; V.guestIn = true;
    setRemote(1, +m.x || 0, +m.y || 0, +m.vx || 0, +m.vy || 0, dt);
    var ax = +m.ax || 0, ay = +m.ay || 0, d = Math.hypot(ax, ay);
    INP[1].f = m.f ? 1 : 0; INP[1].x = 0; INP[1].y = 0;
    INP[1].aim = d > 0.1 ? [ax / d, ay / d] : [P[1].ax, P[1].ay];
  }

  // ---------- Konec ----------
  function finish(win, reason) {
    if (V.ended) return;
    V.ended = true; V.phase = 'end';
    state = win ? 'won' : 'over';
    V.endNote = win ? 'Výsledek se zapisuje, o odměně rozhodne server.' : 'Výsledek se zapisuje.';
    if (!V.reported) { V.reported = true; MPI.report(win ? 'win' : 'loss', reason).catch(function () { V.reported = false; }); }
    if (HOST) sendSure({ k: 'end', w: win ? 1 : 0 });
    touchEl.hidden = true;
  }

  // ---------- Smyčka ----------
  var last = performance.now();
  function loop(t) {
    var dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (V.started && !V.ended) {
      var inp = readInput();
      INP[ME].x = inp.x; INP[ME].y = inp.y; INP[ME].f = inp.f; INP[ME].aim = inp.aim;
      if (HOST) {
        if (state === 'play') update(dt);
        hostSend();
        if (!V.guestIn && now() - V.lastGo > 700) sendGo();   // úvodní zpráva se opakuje, dokud se host neozve vstupem (zpráva v reálném čase se může ztratit)
        if (state === 'won') finish(true, 'waves'); else if (state === 'over') finish(false, 'wipe');
        if (V.peerSeen && now() - V.peerSeen > SILENT_MS) V.note = 'Parťák ' + names[PEER] + ' neodpovídá…'; else V.note = '';
      } else {
        guestMove(dt); guestFx(dt); rebuild(); sendInput(false);
        if (now() - V.lastSnap > SILENT_MS) V.note = 'Hostitel ' + names[PEER] + ' neodpovídá. Jeho okno musí zůstat otevřené a viditelné.'; else V.note = '';
      }
    } else if (V.started && V.ended && !HOST) { guestFx(dt); rebuild(); }
    if (V.started) {
      if (V.ended) drawResult(state === 'won', ME, V.endNote);
      else { drawGame(ME); if (V.note) { ctx.save(); rrect(CW / 2 - 240, CH - 60, 480, 34, 12); ctx.fillStyle = '#7a1f2edd'; ctx.fill(); ctx.restore(); txt(V.note, CW / 2, CH - 38, 14); } }
    } else { ctx.fillStyle = '#0f1226'; ctx.fillRect(0, 0, CW, CH); }
    requestAnimationFrame(loop);
  }

  // Rozhraní pro zkoušky: jen čtení stavu a vložení vstupu
  window.__chaos = { me: ME, host: HOST, v: function () { return V; }, sim: function () { return { wave: wave, state: state, P: P, E: E.length, Bu: Bu.length, teamKills: teamKills }; }, choose: chooseClass };

  // ---------- Zprávy a start ----------
  function onMessage(p) {
    if (!p || typeof p !== 'object') return;
    V.peerSeen = now();
    if (p.k === 'cls') {
      V.peerCls = clamp(p.c | 0, 0, CLS.length - 1);
      if (HOST) maybeBegin();
      else refreshPick();
      return;
    }
    if (p.k === 'go' && !HOST) { beginGuest(p); return; }
    if (p.k === 'S' && !HOST && V.mirror) { onSnapshot(p); return; }
    if (p.k === 'i' && HOST && V.started) { onInput(p); return; }
    if (p.k === 'Q' && HOST && V.rep) { V.rep.requestKey(true); sendGo(); return; }
    if (p.k === 'end' && !HOST) { if (!V.ended && V.started) finish(p.w === 1, p.w === 1 ? 'waves' : 'wipe'); return; }
  }

  buildPick();
  MPI.on('rt', function (d) { onMessage(d && d.p); });
  MPI.on('rt-status', function (d) {
    if (d.status === 'open') { V.open = true; V.error = ''; sendCls(); }
    else if (d.status === 'down') V.open = false;
    else if (d.status === 'error') V.error = 'Spojení v reálném čase se nepodařilo navázat. Zkus to prosím znovu.';
    refreshPick();
  });
  MPI.on('end', function (d) {
    var v = d.match || {};
    if (V.ended) return;
    V.ended = true; V.phase = 'end'; V.reported = true;
    state = v.winner === 3 ? 'won' : 'over';
    V.endNote = v.reason === 'resign' ? 'Parťák hru opustil.' : v.reason === 'opponent_gone' ? 'Parťák se odpojil.' : 'Zápas skončil.';
    if (!V.started) { pickEl.hidden = true; V.started = true; if (!P.length) simStartIdle(); }
    touchEl.hidden = true;
  });
  // zápas skončil dřív, než hra začala: ať je co vykreslit
  function simStartIdle() { P = [0, 1].map(function (i) { var c = CLS[0]; return { x: WW / 2, y: WH / 2, vx: 0, vy: 0, ax: 1, ay: 0, cl: c, hp: 3, mhp: 3, down: 0, rev: 0, inv: 0, cd: 0, rapid: 0, shield: 0, score: 0, kills: 0, downs: 0, revives: 0 }; }); }
  MPI.listen();
  MPI.rt.open();
  setInterval(function () { if (!V.started && V.open && now() - V.lastCls > 600) { V.lastCls = now(); sendCls(); } }, 200);   // vzkaz o třídě se opakuje, dokud hra nezačne (zpráva v reálném čase se může ztratit)
  requestAnimationFrame(loop);
})();
