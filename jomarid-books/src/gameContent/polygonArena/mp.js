// Sdílená aréna (multiplayer): jedna společná aréna pro deset tanků. Hráči nahrazují boty: když se připojí hráč, jeden bot zmizí (1 hráč = 9 botů, 2 hráči = 8 botů...),
// když odejde, bot se vrátí. Aréna běží jen tehdy, když je v ní nějaký hráč (každý prohlížeč počítá svou kopii světa, jen dokud ho hráč má otevřený).
// Hra se spustí s rozhraním window.jomaridMP z appky (src/mp) a jen v režimu arény; bez něj se tenhle soubor jen načte a nic nedělá.
//
// Jak se hráči v aréně potkávají: žádný server, jen kanál v reálném čase (Supabase Realtime, 12x za vteřinu). Každý hráč posílá, kde stojí, kam míří, jestli střílí a jak
// je na tom se zdravím a stavbou tanku (třída, úroveň, vlastnosti, výhody). Ostatní prohlížeče z toho udělají "ducha": tank, který se řídí podle sítě, ne podle umělé
// inteligence nebo vstupů. Střely ducha vznikají normálně z jeho třídy a stavu a zraňují jen toho, na koho letí: každý hlídá zásahy na vlastním tanku, takže se
// zdraví nikomu nevnucuje. Smrt oznámí její oběť (a kdo ji zničil), vítěz tak dostane zkušenosti. Boti, tvary a bonusy má každý prohlížeč vlastní;
// zóny (láva, led, oáza) jsou u všech stejné.
//
// Kolo trvá 160 vteřin (podle času zařízení, takže u všech zhruba stejně). Vyhrává ho ten, komu za kolo nejvíc přibylo bodů; výherce o odměnu požádá server
// (mp_arena_claim, odměna je jednou za kolo a v denním stropu). Cheaty a sólový postup tu nejsou.
(function () {
  var MP = window.jomaridMP && window.jomaridMP.enabled && window.jomaridMP.init && window.jomaridMP.init.arena ? window.jomaridMP : null;
  if (!MP) return;

  var SLOTS = 10;                // tanků v aréně: hráči a boti dohromady
  var ROUND_MS = 160000;         // délka kola
  var SEND_EVERY = 80;           // ms mezi zprávami o poloze (s víc hráči se zpomaluje, ať se kanál nezahltí)
  var INFO_EVERY = 1500;         // ms mezi zprávami o stavbě tanku
  var SILENT_MS = 9000;          // hráč, od kterého nic nepřišlo tak dlouho, z arény odešel
  var DELAY = 140;               // nejmenší zpoždění, o které se duch kreslí za skutečností, ať se pohyb vyhladí (při řidších zprávách je větší)
  var ZONE_SEED = 20240611;      // zóny (láva, led, oáza) jsou u všech hráčů stejné
  var ME = MP.init.me || { id: 'me', name: 'Ty' };

  var V = { clock: function () { return Date.now(); }, open: false, started: false, peers: {}, seq: 0, lastSend: 0, lastInfo: 0, lastAsk: 0, infoSig: '', round: -1, snap: null, claimBusy: false, botT: 0, roundWins: 0 };

  // ---------- Pomocné funkce (bez závislosti na hře, jdou zkoušet samostatně) ----------
  function clampN(v, lo, hi, dflt) { v = Number(v); if (!isFinite(v)) return dflt; return v < lo ? lo : v > hi ? hi : v; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function turn(a, b) { var d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; return d; }

  // Počet botů: hráči zabírají místa, boti doplňují zbytek (na nule se nikdy nejde pod nulu)
  function botsWanted(humans) { return Math.max(0, SLOTS - Math.max(1, humans)); }

  // Kolo podle času (u všech zhruba stejné) a kolik z něj zbývá
  function roundOf(ms) { return Math.floor(ms / ROUND_MS); }
  function roundLeft(ms) { return ROUND_MS - (ms - roundOf(ms) * ROUND_MS); }

  // Kdo vyhrál kolo: nejvíc bodů za kolo (jen kladné), při shodě ten, kdo je dřív v seznamu (hráči před boty). entries: [{id, human, gain}]
  function pickWinner(entries) {
    var best = null;
    entries.forEach(function (e) {
      if (!(e.gain > 0)) return;
      if (!best || e.gain > best.gain || (e.gain === best.gain && e.human && !best.human)) best = e;
    });
    return best;
  }

  // Poloha ducha v čase z vzorků [{t, x, y, a}]: mezi dvěma vzorky se vyhladí (úhel nejkratší cestou), za posledním se chvíli pokračuje a pak stojí
  function ghostAt(samples, t) {
    var n = samples.length;
    if (!n) return null;
    if (t <= samples[0].t) return { x: samples[0].x, y: samples[0].y, a: samples[0].a };
    for (var i = 1; i < n; i++) {
      var p = samples[i - 1], q = samples[i];
      if (t <= q.t) {
        var k = q.t === p.t ? 1 : (t - p.t) / (q.t - p.t);
        return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, a: p.a + turn(p.a, q.a) * k };
      }
    }
    var l = samples[n - 1], pr = n > 1 ? samples[n - 2] : null, over = Math.min(t - l.t, 180);
    var vx = pr && l.t > pr.t ? (l.x - pr.x) / (l.t - pr.t) : 0, vy = pr && l.t > pr.t ? (l.y - pr.y) / (l.t - pr.t) : 0;
    return { x: l.x + vx * over, y: l.y + vy * over, a: l.a };
  }

  window.__arenaMp = { ghostAt: ghostAt, botsWanted: botsWanted, roundOf: roundOf, roundLeft: roundLeft, pickWinner: pickWinner, clampN: clampN, V: V, ROUND_MS: ROUND_MS, SLOTS: SLOTS };

  // ---------- Hra ----------
  function now() { return MP.serverNow(); }
  function send(pkt, force) { try { pkt.id = ME.id; MP.rt.send(pkt, { force: !!force }); } catch (e) { /* kanál není */ } }
  function peerList() { var out = []; for (var id in V.peers) out.push(V.peers[id]); return out; }
  function humans() { return 1 + peerList().filter(function (p) { return p.tank; }).length; }

  // ---------- Duchové ----------
  function makeGhost(id, name, color) {
    var t = makeTank(false, name, color, 0);
    t.remote = { id: id, samples: [], hp: 1, mh: 1, al: 1, fire: false, seen: Date.now(), name: name, color: color, ready: false };
    t.name = name; t.color = color; t.alive = false; t.respawnT = 1e9;   // ožije první zprávou o poloze
    return t;
  }

  function dropGhost(p) {
    var t = p.tank;
    if (!t) return;
    t.alive = false;
    for (var i = 0; i < bullets.length; i++) if ((bullets[i].drone || bullets[i].trap) && bullets[i].owner === t) bullets[i].dead = true;
    var k = tanks.indexOf(t);
    if (k >= 0) tanks.splice(k, 1);
    p.tank = null;
  }

  function applyInfo(t, i) {
    if (t.remote) t.remote.info = i;
    var id = CLASSES[i.cls] ? i.cls : 'basic';
    if (t.cls !== id) {
      var n = CLASSES[id].barrels.length;
      t.cls = id; t.bt = new Array(n).fill(0); t.rec = new Array(n).fill(0); t.tur = new Array(n).fill(t.angle || 0); t.drones = 0; t.traps = 0;
      for (var b = 0; b < bullets.length; b++) if ((bullets[b].drone || bullets[b].trap) && bullets[b].owner === t) bullets[b].dead = true;
    }
    t.level = clampN(i.lv, 1, MAX_LEVEL, 1) | 0;
    var st = Array.isArray(i.st) ? i.st : [];
    t.stats = [0, 1, 2, 3, 4, 5, 6, 7].map(function (k) { return clampN(st[k], 0, STAT_CAP, 0) | 0; });
    t.perks = {};
    (Array.isArray(i.pk) ? i.pk : []).slice(0, 30).forEach(function (pid) { if (typeof pid === 'string' && PERK_BY[pid]) t.perks[pid] = true; });
    t.score = clampN(i.sc, 0, 1e9, 0); t.kills = clampN(i.kl, 0, 1e6, 0) | 0;
    if (typeof i.nm === 'string' && i.nm) { t.name = i.nm.slice(0, 14); t.remote.name = t.name; }
    if (typeof i.co === 'string' && /^#[0-9a-fA-F]{6}$/.test(i.co)) { t.color = i.co; t.remote.color = i.co; }
    recalc(t);
  }

  function reviveGhost(t, p) {
    var R = t.remote, keep = { name: R.name, color: R.color };
    resetTank(t);
    t.name = keep.name; t.color = keep.color;
    if (R.info) applyInfo(t, R.info);          // stavba tanku z poslední zprávy (resetTank ji vrátil na začátek)
    t.x = p.x; t.y = p.y; t.invuln = 2.5; t.alive = true; t.respawnT = 1e9; t.hp = t.maxHp;
    R.samples.length = 0;
  }

  function onState(pr, p) {
    var t = pr.tank; if (!t) return;
    var R = t.remote;
    R.seen = Date.now();
    // Vzorky se řadí podle času příchodu v mých hodinách (ne podle hodin odesílatele): hodiny zařízení se u hráčů liší o vteřiny a duch by stál nebo skákal
    var arrive = V.clock();
    var s = { t: arrive, x: clampN(p.x, 0, WORLD, 0), y: clampN(p.y, 0, WORLD, 0), a: clampN(p.a, -10, 10, 0) };
    if (R.lastArrive) R.gap = R.gap ? R.gap * 0.8 + (arrive - R.lastArrive) * 0.2 : arrive - R.lastArrive;
    R.lastArrive = arrive;
    R.fire = !!p.f; R.hp = clampN(p.hp, 0, 1e7, R.hp); R.mh = clampN(p.mh, 1, 1e7, R.mh);
    var alive = p.al ? 1 : 0;
    if (alive && !t.alive) reviveGhost(t, s);
    if (!alive && t.alive) { R.al = 0; t.hp = -1000; }
    R.al = alive;
    R.samples.push(s); if (R.samples.length > 24) R.samples.shift();
    R.ready = true;
  }

  function onMessage(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || p.id === ME.id) return;
    if (p.k === 'q') { sendInfo(true); return; }          // někdo právě vstoupil a ptá se, kdo tu je: pošlu údaje o své stavbě
    var pr = V.peers[p.id];
    if (p.k === 'i') {
      if (!pr) pr = V.peers[p.id] = { id: p.id, tank: null };
      if (!pr.tank) {
        var nm = typeof p.nm === 'string' && p.nm ? p.nm.slice(0, 14) : 'Hráč', co = typeof p.co === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.co) ? p.co : '#f2b84b';
        pr.tank = makeGhost(p.id, nm, co);
        banner(nm + ' vstoupil do arény', 'info');
        feed(nm + ' vstoupil do arény', false);
        reconcileBots(true);
      }
      applyInfo(pr.tank, p);
      return;
    }
    if (!pr || !pr.tank) {                                  // neznám ho: ať pošle, kdo je (nejvýš jednou za vteřinu)
      if (p.k === 's' && Date.now() - V.lastAsk > 1000) { V.lastAsk = Date.now(); send({ k: 'q' }, true); }
      return;
    }
    if (p.k === 's') onState(pr, p);
    else if (p.k === 'x') {
      var t = pr.tank;
      t.remote.al = 0;
      t.lastAttacker = p.by === ME.id ? player : (p.by && V.peers[p.by] && V.peers[p.by].tank) || null; t.lastAtkT = time;
      t.hp = -1000;
    } else if (p.k === 'bye') { dropGhost(pr); delete V.peers[p.id]; reconcileBots(true); }
  }

  // Duch místo AI: poloha, směr a střelba podle sítě, zdraví podle jeho hráče (na vlastním tanku se zdraví nikdy nesníží zásahem z mé kopie světa)
  function remoteControl(t) {
    var R = t.remote; if (!R) return;
    var g = ghostAt(R.samples, V.clock() - Math.max(DELAY, Math.min(450, 1.7 * (R.gap || 0))));
    if (g) { t.x = clampN(g.x, 0, WORLD, t.x); t.y = clampN(g.y, 0, WORLD, t.y); t.angle = g.a; }
    t.vx = 0; t.vy = 0; t.moveX = 0; t.moveY = 0; t.dashT = 0;
    t.wantFire = !!R.fire && R.al === 1;
    t.hp = R.al ? Math.max(0.001, t.maxHp * (R.hp / Math.max(1, R.mh))) : -1000;     // mrtvý duch zůstane pod nulou, ať ho regenerace nezdvihne zpět
  }

  // ---------- Boti: hráči jim berou místa ----------
  function botList() { return tanks.filter(function (t) { return !t.isPlayer && !t.remote && !t.boss && !t.temp && !(t.ai && t.ai.dummy); }); }

  function reconcileBots(force) {
    if (!V.started || state === 'menu') return;
    var want = botsWanted(humans()), bots = botList();
    if (bots.length > want) {
      // nejdřív ti, kdo právě čekají na znovuzrození, potom nejslabší
      bots.sort(function (a, b) { return (a.alive ? 1 : 0) - (b.alive ? 1 : 0) || a.score - b.score; });
      for (var i = 0; i < bots.length - want; i++) {
        var b = bots[i];
        b.alive = false;
        for (var k = 0; k < bullets.length; k++) if ((bullets[k].drone || bullets[k].trap) && bullets[k].owner === b) bullets[k].dead = true;
        var at = tanks.indexOf(b); if (at >= 0) tanks.splice(at, 1);
      }
    } else if (bots.length < want) {
      for (var j = bots.length; j < want; j++) makeTank(false, '', BOT_COLORS[0]);
    }
  }

  // ---------- Kola a odměna ----------
  function entries() {
    var out = [];
    tanks.forEach(function (t) {
      if (t.boss || t.temp || (t.ai && t.ai.dummy)) return;
      var base = V.snap && V.snap.scores[t.id] !== undefined ? V.snap.scores[t.id] : 0;
      out.push({ id: t.id, name: t.name, human: t === player || !!t.remote, mine: t === player, gain: t.score - base });
    });
    return out;
  }

  function takeSnapshot() {
    var sc = {};
    tanks.forEach(function (t) { sc[t.id] = t.score; });
    V.snap = { scores: sc, mine: player.alive || state === 'play', t: now() };
  }

  function finishRound() {
    var snap = V.snap, list = entries(), w = pickWinner(list);
    if (!w) return;
    if (w.mine && snap && snap.mine) {
      if (V.claimBusy) return;
      V.claimBusy = true;
      MP.claim(Math.round(ROUND_MS / 1000), Math.round(player.score)).then(function (res) {
        V.claimBusy = false; V.roundWins++;
        if (res && res.granted > 0) banner('Vyhrál jsi kolo! Odměna +' + res.granted + ' Coinů', 'good');
        else banner('Vyhrál jsi kolo! Dnešní odměna za online hru už je vyčerpaná', 'info');
      }, function () { V.claimBusy = false; banner('Vyhrál jsi kolo, odměnu se teď nepodařilo vyřídit', 'info'); });
    } else banner('Kolo skončilo, vítěz: ' + w.name, 'info');
  }

  function roundTick() {
    var r = roundOf(now());
    if (V.round === -1) { V.round = r; takeSnapshot(); return; }
    if (r !== V.round) { finishRound(); V.round = r; takeSnapshot(); }
  }

  window.__arenaMp.entries = entries;     // pro zkoušky

  // ---------- Síť ----------
  function infoSig() {
    var p = player;
    return [p.cls, p.level, p.stats.join(''), Object.keys(p.perks).sort().join(','), p.name, p.color].join('|');
  }

  function sendInfo(force) {
    var p = player, t = Date.now(), sig = infoSig();
    if (!force && sig === V.infoSig && t - V.lastInfo < INFO_EVERY) return;
    V.infoSig = sig; V.lastInfo = t;
    send({ k: 'i', cls: p.cls, lv: p.level, st: p.stats, pk: Object.keys(p.perks), sc: Math.round(p.score), kl: p.kills, nm: p.name, co: p.color }, true);
  }

  function sendState() {
    var t = Date.now(), p = player, every = SEND_EVERY * (humans() <= 2 ? 1 : humans() <= 4 ? 1.6 : 2.5);
    if (t - V.lastSend < every - 5) return;
    V.lastSend = t;
    send({ k: 's', q: ++V.seq, t: Math.round(now()), x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, a: Math.round(p.angle * 100) / 100, f: p.wantFire ? 1 : 0,
      hp: Math.max(0, Math.round(p.hp)), mh: Math.round(p.maxHp), al: p.alive ? 1 : 0 });
  }

  function netTick() {
    if (!V.started) return;
    if (V.open) { sendInfo(false); sendState(); }
    // hráči, od kterých dlouho nic nepřišlo, odešli
    var t = Date.now();
    peerList().forEach(function (p) { if (p.tank && t - p.tank.remote.seen > SILENT_MS) { banner(p.tank.name + ' opustil arénu', 'info'); dropGhost(p); delete V.peers[p.id]; reconcileBots(true); } });
  }

  // ---------- Režim "Sdílená aréna" ----------
  MODES.arena = {
    name: 'Sdílená aréna', tag: 'Online', diff: false, noBoss: true, noEvents: true,
    info: 'Jedna aréna pro všechny hráče, boti uvolňují místa.',
    setup: function (D) { spawnBots({ bots: botsWanted(humans()), start: D.start }); },
    tick: function () {
      V.botT -= STEP;
      if (V.botT <= 0) { V.botT = 1; reconcileBots(false); roundTick(); }
    },
    hud: function () { return '<span>Kolo ' + fmtTime(roundLeft(now()) / 1000) + '</span><small>hráčů ' + humans() + ' z ' + SLOTS + '</small>'; },
    onKill: function (k, t) {
      if (t !== player) return;
      send({ k: 'x', by: k && k.remote ? k.remote.id : null }, true);
    },
  };

  function patchGame() {
    var baseHurt = hurt, baseBot = botControl, baseRespawn = respawnBot, baseZones = genZones;
    hurt = function (t, amt, src, quiet) {
      if (t.remote) {            // zdraví ducha určuje jeho hráč
        if (!t.alive || t.invuln > 0) return false;
        if (src && src !== t) { t.lastAttacker = src; t.lastAtkT = time; }
        if (!quiet) t.hit = 0.08;
        return true;
      }
      return baseHurt(t, amt, src, quiet);
    };
    botControl = function (b, dt) { if (b.remote) { remoteControl(b); return; } return baseBot(b, dt); };
    respawnBot = function (t) { if (t.remote) { t.respawnT = 1e9; return; } return baseRespawn(t); };
    genZones = function () {
      var orig = Math.random;
      Math.random = mulberry32(ZONE_SEED);
      try { baseZones(); } finally { Math.random = orig; }
    };
    // v online aréně se nepauzuje a z arény se odchází přes křížek v liště appky
    setPause = function () { /* ostatní hráči běží dál */ };
    toMenu = function () { try { MP.close(); } catch (e) { /* appka arénu zavře sama */ } };
  }

  function start() {
    patchGame();
    mode = 'arena'; diffKey = 'normal';
    var nm = String(ME.name || 'Ty').slice(0, 14);
    elName.value = nm;
    V.started = true;
    startGame(true);
    player.name = nm;                        // jméno účtu (hra by si ho jinak vzala z pole v sólovém menu)
    takeSnapshot();
    document.documentElement.classList.add('mp');
    var st = document.createElement('style');
    st.textContent = 'html.mp #pauseBtn{display:none!important}';
    document.head.appendChild(st);
    MP.on('rt', function (d) { onMessage(d && d.p); });
    MP.on('rt-status', function (d) {
      if (d.status === 'open') { V.open = true; sendInfo(true); send({ k: 'q' }, true); }
      else if (d.status === 'down') V.open = false;
      else if (d.status === 'error') { banner('Spojení s ostatními hráči se nepodařilo navázat. Hraješ sám s boty.', 'info'); }
    });
    // tlačítka „Menu“ (po zničení a v pauze) by otevřela sólové menu: místo nich je „Opustit arénu“, které zavře arénu v appce
    ['deadMenuBtn', 'pauseMenuBtn'].forEach(function (id) {
      var b = $(id); if (!b) return;
      var c = b.cloneNode(true); c.textContent = 'Opustit arénu';
      b.parentNode.replaceChild(c, b);
      c.addEventListener('click', function () { try { MP.close(); } catch (e) { /* appka arénu zavře sama */ } });
    });
    MP.listen();
    MP.rt.open();
    window.addEventListener('pagehide', function () { send({ k: 'bye' }, true); });
    V.timer = setInterval(netTick, 40);
  }

  document.addEventListener('DOMContentLoaded', start);
})();
