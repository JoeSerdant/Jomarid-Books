/* game.js - Katakomby online: obrazovky, vstupy a napojení na zápas (window.jomaridMP z appky, src/mp).
   Dva hráči jdou spolu proti vlnám příšer. Pravidla jsou v core.js a běží u obou stejně ze semínka zápasu: po síti jdou jen akce (mp_move),
   stav si každý počítá sám a po konci tahu se porovná otisk (x), takže se případný rozchod pozná hned.

   Tah na serveru: akce hráče {t:'p'} (zahrát kartu) tah nepředává, {t:'hero'}, {t:'e'} (konec tahu) a {t:'r'} (odměna) ano. Výběr hrdiny a odměny si hráč může
   zvolit hned, odešle se, jakmile je řada na něm. Za poraženého hrdinu pošle konec tahu hra sama, aby tah šel dál. O výsledku rozhodují shodná hlášení obou hráčů
   (výprava vyhrána / prohrána) a o Coinech server. */
(function () {
  'use strict';
  var MPI = window.jomaridMP && window.jomaridMP.enabled ? window.jomaridMP : null;
  var K = window.KatCore, C = K.C, H = K.H, cd = K.cd;
  var scr = document.getElementById('scr'), fx = document.getElementById('fx'), bg = document.getElementById('bg');
  var ME = MPI ? (MPI.init.slot === 2 ? 1 : 0) : 0, PARTNER = 1 - ME;
  var names = [MPI && MPI.init.slot === 2 ? (MPI.init.opponent && MPI.init.opponent.name) || 'Parťák' : (MPI && MPI.init.me && MPI.init.me.name) || 'Ty',
    MPI && MPI.init.slot === 2 ? (MPI.init.me && MPI.init.me.name) || 'Ty' : (MPI && MPI.init.opponent && MPI.init.opponent.name) || 'Parťák'];
  var st = null;
  var V = { view: null, synced: false, applied: 0, want: { hero: -1, pick: -1 }, desync: false, note: '', over: false, reported: false, fx: [], replay: false, banner: null };
  var MUTE = false;

  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var AC;
  function snd(f, d, t, v) {
    try {
      if (MUTE || V.replay) return;
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      var o = AC.createOscillator(), g = AC.createGain();
      o.type = t || 'square'; o.frequency.value = f; g.gain.setValueAtTime(v || 0.05, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + (d || 0.12));
      o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + (d || 0.12));
    } catch (e) { /* bez zvuku */ }
  }
  var vib = function (n) { try { if (!V.replay && navigator.vibrate) navigator.vibrate(n); } catch (e) { /* bez vibrací */ } };

  // Pozadí: pomalu stoupající symboly podle patra (vlny)
  for (var bi = 0; bi < 14; bi++) {
    var bs = document.createElement('i');
    bs.style.cssText = 'left:' + Math.random() * 100 + '%;animation-duration:' + (6 + Math.random() * 8) + 's;animation-delay:-' + Math.random() * 10 + 's';
    bg.appendChild(bs);
  }
  function theme() {
    var w = st && st.w ? st.w : 0, th = w >= 9 ? ['#6a2030', '#1c0a10', '🔥'] : w >= 7 ? ['#4a3a7a', '#150f28', '❄️'] : w >= 4 ? ['#2f5f55', '#0f2420', '🍃'] : ['#3d3972', '#1a1933', '✨'];
    document.documentElement.style.setProperty('--a', th[0]); document.documentElement.style.setProperty('--b', th[1]);
    var els = bg.querySelectorAll('i'); for (var i = 0; i < els.length; i++) els[i].textContent = th[2];
  }

  // ---------- Vykreslení částí ----------
  var bar = function (v, m, col) { return '<div class=bar><i style="width:' + Math.max(0, v / m * 100) + '%;background:' + col + '"></i><span>' + Math.max(0, v) + '/' + m + '</span></div>'; };
  var txt = function (c) { return [c.d && 'Zásah ' + c.d + (c.x ? '×' + c.x : ''), c.bb && 'Zásah = štít', c.b && 'Štít ' + c.b, c.h && 'Léčení ' + c.h, c.p && 'Jed ' + c.p, c.v && 'Zranitelný ' + c.v,
    c.s && 'Síla +' + c.s, c.w && 'Lízni ' + c.w, c.en && '+' + c.en + ' energie', c.cl && 'Očista jedu'].filter(Boolean).join('. '); };
  var cls = function (c) { return (c.d || c.bb || c.p) ? 'a' : c.b ? 's' : 'u'; };
  function cardH(o, act, dim, style, key) {
    var c = cd(o);
    return '<button class="card ' + cls(c) + ' ' + (C[o.k].r === 2 ? 'rare' : '') + ' ' + (dim ? 'no' : '') + '" style="' + (style || '') + '" ' + (act || '') + (key ? ' data-k="' + key + '"' : '') + '><i class=cost>' + c.c + '</i><span class=ce>' + c.e + '</span><b>' + c.n + '</b><small>' + txt(c) + '</small></button>';
  }
  function handH(hand, en) {
    var n = hand.length, sz = n > 6 ? Math.ceil(n / 2) : n || 1, out = '';
    for (var s = 0; s < n; s += sz) {
      var row = hand.slice(s, s + sz), mid = (row.length - 1) / 2;
      out += '<div class=hrow>' + row.map(function (o, j) {
        var k = s + j;
        return cardH(o, 'data-act="play" data-i="' + k + '"', en < cd(o).c, '--r:' + (j - mid) * 3.5 + 'deg;--y:' + Math.pow(j - mid, 2) * 2 + 'px', k < 10 ? String((k + 1) % 10) : '');
      }).join('') + '</div>';
    }
    return '<div class="hand ' + (n > 6 ? 'two' : '') + '">' + out + '</div>';
  }
  function pills(p) {
    return '<span class=pill>🛡️ ' + p.blk + '</span><span class=pill>⚡ ' + p.en + '</span>' + (p.str ? '<span class=pill>💪' + p.str + '</span>' : '') + (p.vu ? '<span class=pill>🥀' + p.vu + '</span>' : '') + (p.psn ? '<span class=pill>☠️' + p.psn + '</span>' : '');
  }
  function heroLine(i) {
    var p = st.p[i], h = H[p.hi], dead = p.hp <= 0, turnNow = st.phase === 'play' && st.t === i && !dead;
    return '<div class="me ' + (i === ME ? 'mine' : '') + ' ' + (dead ? 'dead' : '') + '"><span style="font-size:26px">' + (dead ? '💀' : h.e) + '</span><span class=pill>' + esc(i === ME ? 'Ty' : names[i]) + ' · ' + h.n + '</span>' +
      bar(p.hp, p.max, 'linear-gradient(#b4f59d,#4cb86a)') + pills(p) + (turnNow ? '<span class="pill turnpill">na tahu</span>' : '') + '</div>';
  }
  function intent() {
    var E = st.E, a = E.pat[E.i % E.pat.length], t = st.tg, who = t === ME ? 'tebe' : esc(names[t]);
    var x = { a: '⚔️ ' + Math.round((a.v + E.str) * E.sc) + (a.x ? '×' + a.x : '') + ' → ' + who, b: '🛡️ ' + a.v, d: '🥀 Oslabí', s: '💢 Zesílí', p: '☠️ Jed ' + a.v, c: '🕸️ Kletba ×' + a.v, h: '💚 Léčí ' + a.v }[a.k];
    return x;
  }
  function secondsLeft() {
    var v = V.view; if (!v || !v.deadline || v.status !== 'active') return null;
    return Math.max(0, Math.ceil((v.deadline - MPI.serverNow()) / 1000));
  }
  var myAction = function () { return !!(st && V.synced && !V.over && KatCore.next(st) === ME && V.view && V.view.status === 'active'); };

  function screenHTML() {
    if (!MPI) return '<div class=center><h1>Katakomby</h1><p style="color:var(--mut);max-width:300px;margin:0">Tahle hra běží jen online ve dvou, v appce Jomarid Books (Jomarid Online Games).</p></div>';
    if (!V.synced || !st) return '<div class=center><h2>Načítám zápas…</h2></div>';
    var partner = esc(names[PARTNER]), h = '';
    if (st.phase === 'select') {
      var mine = V.want.hero >= 0 ? V.want.hero : st.picks[ME];
      h = '<div class=center><h2>Vyber hrdinu</h2><p style="color:var(--mut);margin:0;max-width:300px">Výpravu jdete spolu s hráčem ' + partner + '. Každý si vybere hrdinu a pak se střídáte v tazích.</p><div class=hs>' +
        H.map(function (x, j) { return '<button class=node style="width:92px;padding:10px 4px;' + (mine === j ? 'border-color:var(--gold);background:#ffcf6b33' : '') + '" data-act="hero" data-h="' + j + '"><span style="font-size:34px">' + x.e + '</span><b style="font-size:13px">' + x.n + '</b><small style="font-size:10px">' + x.d + '</small></button>'; }).join('') +
        '</div><div class=pending>' + (mine >= 0 ? 'Vybráno: ' + H[mine].e + ' ' + H[mine].n + ' ✓' + (st.picks[ME] < 0 ? ' (odešle se, až bude řada na tobě)' : '') : 'Klepni na hrdinu') + '</div>' +
        '<div class=pending>' + (st.picks[PARTNER] >= 0 ? 'Parťák ' + partner + ': ' + H[st.picks[PARTNER]].e + ' ' + H[st.picks[PARTNER]].n + ' ✓' : 'Parťák ' + partner + ' ještě vybírá…') + '</div></div>';
    } else if (st.phase === 'play') {
      var E = st.E, p = st.p[ME], mineTurn = myAction() && st.t === ME && p.hp > 0, sec = secondsLeft();
      var turnTxt = st.p[st.t].hp <= 0 ? 'Poražený hrdina vynechává tah' : st.t === ME ? 'Jsi na tahu' : 'Táhne ' + partner;
      h = '<div class=hud><span>Vlna ' + st.w + '/' + K.FINAL_WAVE + '</span><span>' + turnTxt + '</span>' + (sec !== null ? '<span>⏱ ' + sec + ' s</span>' : '') + '</div>' +
        '<div class=enemy><div class=intent>' + intent() + '</div><div class="emo ' + (E.boss ? 'boss' : '') + '" id="emo">' + E.e + '</div><div class=nm>' + E.n + (E.boss ? ' · strážce' : E.elite ? ' · elita' : '') + '</div>' + bar(E.hp, E.max, 'linear-gradient(#ff8b97,#e0455a)') +
        '<div class=st>' + (E.blk ? '🛡️' + E.blk + ' ' : '') + (E.psn ? '🧪' + E.psn + ' ' : '') + (E.vu ? '🎯' + E.vu + ' ' : '') + (E.str ? '💪' + E.str : '') + '</div></div>' +
        '<div class=duo>' + heroLine(PARTNER) + heroLine(ME) + '</div>' +
        (mineTurn ? handH(p.hand, p.en) : '<div class=hand><div class=hrow>' + (p.hp > 0 ? '<div class="card back"></div>'.repeat(3) : '') + '</div></div>') +
        '<div class=row>' + (mineTurn ? '<span>Lízací ' + p.deck.length + ' · Odhoz ' + p.disc.length + '</span><button class=btn data-act="end">Konec tahu</button>' :
          '<span>' + (p.hp <= 0 ? 'Jsi poražený, oživí tě léčení parťáka nebo další vlna' : st.t === ME ? 'Chvilku…' : 'Čekáš na parťáka ' + partner + '…') + '</span>') + '</div>' +
        (V.desync ? '<div class=warn>⚠️ Hra se u vás dvou rozešla. Zavři zápas a spusť ho znovu.</div>' : '') + (V.note ? '<div class=warn>' + esc(V.note) + '</div>' : '');
    } else if (st.phase === 'reward') {
      var pk = V.want.pick >= 0 ? V.want.pick : -1, sentMine = st.pk[ME];
      h = '<div class=center><h2>Vlna ' + st.w + ' zvládnuta!</h2><p style="color:var(--mut);margin:0">Vyber si novou kartu do balíčku.</p>' +
        (sentMine ? '<b>Vybráno ✓</b>' : '<div class=opts>' + st.rw[ME].map(function (o, j) { return cardH(o, 'data-act="pick" data-j="' + j + '"', false, pk === j ? 'outline:3px solid var(--gold)' : ''); }).join('') + '</div>') +
        '<div class=pending>' + (pk >= 0 && !sentMine ? 'Vybráno (odešle se, až bude řada na tobě)' : '') + '</div>' +
        '<div class=pending>' + (st.pk[PARTNER] ? 'Parťák ' + partner + ' vybral ✓' : 'Parťák ' + partner + ' ještě vybírá…') + '</div></div>';
    } else {
      var o = st.over, win = o && o.win;
      h = '<div class=center><h1>' + (win ? 'Strážce padl! 🏆' : '💀 Konec výpravy') + '</h1><p style="color:var(--mut);margin:0">' + (win ? 'Katakomby jsou vaše. Zvládli jste všech ' + o.waves + ' vln.' : 'Přežili jste ' + (o ? o.waves : 0) + ' vln.') + '</p>' +
        '<p style="color:var(--mut);margin:0">' + (V.reported ? 'Výsledek je ohlášený, o odměně rozhodne server.' : 'Ohlašuju výsledek…') + '</p></div>';
    }
    return h;
  }

  var pending = false;
  function render() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; theme(); scr.innerHTML = screenHTML(); flushFx(); });
  }

  // ---------- Efekty ----------
  function flushFx() {
    var q = V.fx; V.fx = [];
    q.forEach(function (e, n) { setTimeout(function () { showFx(e); }, n * 140); });
  }
  function showFx(e) {
    if (e.banner) { var b = document.createElement('div'); b.className = 'bn'; b.textContent = e.banner; fx.appendChild(b); setTimeout(function () { b.remove(); }, 1600); return; }
    if (e.shake !== undefined) {
      var el = e.shake === 2 ? document.getElementById('emo') : scr.querySelectorAll('.me')[e.shake === ME ? 1 : 0];
      if (el) { el.classList.add('shake'); setTimeout(function () { el.classList.remove('shake'); }, 300); }
      snd(e.shake === 2 ? 180 : 110, 0.15, 'sawtooth', 0.08); vib(e.shake === 2 ? 15 : 60);
      if (e.shake !== 2 && e.shake === ME) { document.body.classList.add('hurt'); setTimeout(function () { document.body.classList.remove('hurt'); }, 260); }
      return;
    }
    if (e.lunge) { var em = document.getElementById('emo'); if (em) { em.classList.add('lunge'); setTimeout(function () { em.classList.remove('lunge'); }, 450); } return; }
    if (e.t === undefined) return;
    var s = document.createElement('b'); s.className = 'fl ' + e.c; s.textContent = e.t;
    s.style.top = e.w === 2 ? '22%' : e.w === ME ? '62%' : '46%'; s.style.left = (36 + Math.random() * 22) + '%';
    fx.appendChild(s); setTimeout(function () { s.remove(); }, 900);
    for (var i = 0; i < 6; i++) {
      var q = document.createElement('i'); q.className = 'pt'; q.textContent = { d: '💥', b: '✨', h: '💚', p: '🧪' }[e.c] || '✨';
      q.style.cssText = 'left:50%;top:' + (e.w === 2 ? '26%' : '60%') + ';--x:' + (Math.random() - 0.5) * 170 + 'px;--y:' + (Math.random() - 0.5) * 120 + 'px';
      fx.appendChild(q); setTimeout(function (n) { n.remove(); }.bind(null, q), 700);
    }
    snd(e.c === 'b' ? 520 : e.c === 'h' ? 700 : e.c === 'd' ? 260 : 300, 0.1, 'triangle');
  }
  function collectEvents() {
    if (!st) return;
    var ev = st.ev; st.ev = [];
    if (V.replay) return;
    ev.forEach(function (e) { V.fx.push(e); });
  }

  // ---------- Akce a síť ----------
  function endTurnFlag(a) { return a.t !== 'p'; }   // karta tah nepředává, vše ostatní ano (stejně jako ve hře na serveru)

  // Provede akci u mě a pošle ji; vrací true, když ji pravidla přijala
  function doAction(a) {
    if (!MPI || !st) return false;
    var r = KatCore.apply(st, ME, a);
    if (!r.ok) return false;
    V.applied++;
    if (a.t === 'e') a.x = KatCore.hash(st);
    collectEvents();
    afterChange();
    var sent = MPI.move(a, { endTurn: endTurnFlag(a) });
    sent.then(function () { /* hotovo */ }, function (err) {
      var code = err && err.code;
      if (code === 'timeout') V.note = 'Vypršel čas na tah.';
      else if (code !== 'not_active') V.note = 'Tah se nepodařilo odeslat. Zkontroluj připojení.';
      render();
    });
    return true;
  }

  function afterChange() {
    if (st.phase === 'over' && !V.over) finish();
    render();
    setTimeout(trySend, 0);
  }

  // Odložené akce: výběr hrdiny a odměny (hráč si ho zvolí hned, odešle se, až je řada na něm) a automatický konec tahu poraženého hrdiny
  function trySend() {
    if (!myAction() || st.phase === 'over') return;
    var a = null;
    if (st.phase === 'select' && V.want.hero >= 0) a = { t: 'hero', h: V.want.hero };
    else if (st.phase === 'reward' && V.want.pick >= 0) a = { t: 'r', j: V.want.pick };
    else if (st.phase === 'play' && st.t === ME && st.p[ME].hp <= 0) a = { t: 'e', a: 1 };
    if (!a) return;
    if (a.t === 'hero') V.want.hero = -1;
    if (a.t === 'r') V.want.pick = -1;
    doAction(a);
  }

  function finish() {
    V.over = true;
    var o = st.over;
    if (MPI && !V.reported) {
      V.reported = true;
      MPI.report(o.win ? 'win' : 'loss', o.win ? 'boss' : 'wipe').catch(function () { /* výsledek se pošle znovu při dalším pokusu */ V.reported = false; });
    }
  }

  function applyRecord(rec) {
    var slot = rec.p === 2 ? 1 : 0, pl = rec.payload;
    var r = KatCore.apply(st, slot, pl);
    if (!r.ok) { V.desync = true; V.note = 'Tah soupeře neodpovídá pravidlům (' + r.err + ').'; return false; }
    V.applied = rec.seq;
    if (pl && pl.t === 'e' && typeof pl.x === 'number' && pl.x !== KatCore.hash(st)) V.desync = true;
    return true;
  }

  function onMoves(list) {
    var any = false;
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      if (rec.seq <= V.applied) continue;
      if (rec.seq !== V.applied + 1) break;
      if (!applyRecord(rec)) break;
      any = true;
    }
    if (any) { collectEvents(); afterChange(); }
  }

  if (MPI) {
    st = KatCore.create({ seed: MPI.init.seed, diff: (MPI.init.params && MPI.init.params.diff) || 'normal' });
    MPI.on('sync', function (d) {
      if (V.synced) return;
      V.view = d.match;
      V.replay = true;
      var list = d.moves || [];
      for (var i = 0; i < list.length; i++) { if (!applyRecord(list[i])) break; }
      st.ev = []; V.replay = false;
      V.synced = true;
      if (st.phase === 'over') finish();
      afterChange();
    });
    MPI.on('moves', function (d) { if (V.synced) onMoves(d.moves || []); });
    MPI.on('match', function (d) { V.view = d.match; if (V.synced) { render(); setTimeout(trySend, 0); } });
    MPI.on('end', function (d) {
      var v = d.match || {};
      if (st && st.phase !== 'over') {
        V.over = true;
        V.note = v.reason === 'timeout' ? 'Vypršel čas na tah, výprava skončila.' : v.reason === 'resign' ? 'Parťák výpravu opustil.' : 'Výprava skončila.';
        V.reported = true;
        st.phase = 'over'; st.over = st.over || { win: false, waves: Math.max(0, (st.w || 1) - 1) };
        render();
      }
    });
    MPI.listen();
    setInterval(function () { if (V.synced && st && st.phase === 'play') render(); }, 1000);   // odpočet času na tah
  }

  // ---------- Vstupy ----------
  scr.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || !st || !V.synced || V.over) return;
    var act = b.getAttribute('data-act');
    if (act === 'hero') {
      V.want.hero = +b.getAttribute('data-h'); snd(500, 0.06);
      render(); trySend();
    } else if (act === 'pick') {
      V.want.pick = +b.getAttribute('data-j'); snd(500, 0.06);
      render(); trySend();
    } else if (act === 'play') {
      if (myAction() && st.t === ME) { V.note = ''; doAction({ t: 'p', k: +b.getAttribute('data-i') }); snd(400, 0.08, 'triangle'); }
    } else if (act === 'end') {
      if (myAction() && st.t === ME) { V.note = ''; doAction({ t: 'e' }); }
    }
  });
  addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !st || !V.synced || V.over || st.phase !== 'play' || !myAction() || st.t !== ME) return;
    var k = e.key.length === 1 ? e.key.toUpperCase() : e.key, i = '1234567890'.indexOf(k);
    if (i >= 0) doAction({ t: 'p', k: i }); else if (k === 'E' || k === ' ') { e.preventDefault(); doAction({ t: 'e' }); }
  });

  // Pro zkoušky: hra nabízí jen čtení stavu (nic nemění)
  window.__katakomby = { me: ME, state: function () { return st; }, view: function () { return V; } };
  render();
})();
