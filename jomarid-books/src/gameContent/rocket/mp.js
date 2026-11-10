/* mp.js - online hra pro dva v Rocketu (multiplayer): spolupráce a souboj raket. Hra se spustí s rozhraním window.jomaridMP z appky (src/mp); bez něj se
   tenhle soubor jen načte a nic nedělá.

   Dva hráči mají v jednom okamžiku stejné bojiště (pevný rozměr 400 x 640, na obrazovce se jen zvětší nebo zmenší), stejné lodě bez vylepšení a stejnou
   řadu nepřátel. Každý prohlížeč počítá svou kopii bojiště sám a po síti (Supabase Realtime, 10x za vteřinu) si posílají jen polohu své lodi, zdraví a
   výstřely. Ostatní se odvozuje ze společného času zápasu:
     - vlny nepřátel jsou předem vylosované z čísla zápasu a pouštějí se podle času (ne podle toho, kolik nepřátel zbylo), takže u obou přilétají
       tytéž nepřátele ve stejnou chvíli a letí stejně (dráha je daná jen časem), střely nepřátel mířené na hráče si každý počítá u sebe;
     - lodě a střely druhého hráče se objeví na obrazovce jako "duch" a dál fungují podle režimu:
       * Spolupráce: duch je spojenec, jeho střely zasahují nepřátele i bosse (u obou stejně), bossové chodí v pevných časech. Vyhráváte, když padnou tři
         bossové; prohráváte, když padnou obě lodě.
       * Souboj: duch je soupeř nahoře na obrazovce (otočený čelem dolů), jeho střely jsou nepřátelské a zraňují jen toho, na koho letí. Každý hlídá zásahy
         na vlastní lodi, takže se do zdraví nikdo nevměšuje. Kdo padne první, prohrál. Nepřátelé letí na oba, bomby jsou vypnuté.
   O výsledku a odměně rozhoduje server (db/multiplayer.sql); hra mu jen oznámí, jak to dopadlo. */
(function () {
  var MP = window.jomaridMP && window.jomaridMP.enabled ? window.jomaridMP : null;
  if (!MP) return;

  var W = 400, H = 640;                       // pevné bojiště
  var MODE = MP.init.mode === 'pvp' ? 'pvp' : 'coop';
  var SEED = Number(MP.init.seed) || 0;
  var BOSS_TIMES = [60000, 150000, 255000];   // spolupráce: kdy přiletí bossové (společný čas od startu)
  var BOSS_TARGET = BOSS_TIMES.length;        // kolik bossů musí padnout
  var SEND_EVERY = 100;                       // ms mezi zprávami o poloze
  var COUNTDOWN_MS = 8000;                    // od založení zápasu do nejdřívějšího startu
  var JOIN_TIMEOUT = 30000;                   // tak dlouho se čeká na druhého hráče

  var V = { started: false, startAt: 0, lastHi: 0, mine: 0, theirs: 0, ready: false, open: false, sent: 0, lastSend: 0, seq: 0, fire: [], samples: [], ended: null, dead: false,
    bosses: 0, bossIdx: 0, spawned: 0, schedule: null, created: 0, peer: { seen: 0, hp: 100, maxHp: 100, dead: false, shield: 0, triple: 0, rapid: 0, seq: -1 }, error: '' };

  // ---------- Pomocné funkce (bez závislosti na hře, jdou zkoušet samostatně) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mix(a, b, c) {
    var h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA6B) ^ Math.imul((c | 0) + 0x165667B1, 0xC2B2AE35)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 12;
    return h >>> 0;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Fáze hry (obtížnost) podle společného času, ne podle skóre: každý jí tak má stejnou
  function phaseAt(ms) { return clamp(1 + Math.floor(Math.max(0, ms) / 40000), 1, 9); }

  // Pevná řada nepřátel z čísla zápasu: [{at, x, y, type, vx, wob, fire}] podle času od startu. Vlny z formací hry, jedna za druhou, s odstupem, který odpovídá tomu,
  // jak dlouho útvar letí přes bojiště. Ve spolupráci se kolem příletu bosse nepouští nic. Používá formace a náhodu (U.rand, U.pick) hry, na čas místo náhodného
  // dvojí nahrazené proudem z čísla zápasu.
  function buildSchedule(seed, coop, formations, U, minutes) {
    var rnd = mulberry32(mix(seed, 7, 3));
    var saveRand = U.rand, savePick = U.pick;
    U.rand = function (a, b) { return rnd() * (b - a) + a; };
    U.pick = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };
    var events = [];
    try {
      var t = 2500, last = '', fake = { width: W, height: H };
      var limit = (minutes || 14) * 60000;
      while (t < limit) {
        if (coop && BOSS_TIMES.some(function (bt) { return t > bt - 11000 && t < bt + 50000; })) { t += 1000; continue; }
        var phase = phaseAt(t);
        var pool = formations.filter(function (f) { return f.minPhase <= phase; });
        var rest = pool.filter(function (f) { return f.name !== last; });
        if (rest.length) pool = rest;
        var form = U.pick(pool);
        last = form.name;
        var queue = form.build(fake, phase), span = 0;
        queue.forEach(function (o) {
          events.push({ at: Math.round(t + o.delay), x: Math.round(o.x * 10) / 10, y: o.y, type: o.type, vx: o.vx || 0, wob: Math.round(U.rand(0, 3000)), fire: Math.round(U.rand(900, 2200)) });
          span = Math.max(span, o.delay);
        });
        t += span + Math.max(450, 1700 - phase * 95) + 4200;
      }
    } finally { U.rand = saveRand; U.pick = savePick; }
    events.sort(function (a, b) { return a.at - b.at; });
    return events;
  }

  // Poloha ducha v čase z vzorků [{t, x, y}] (podle času odesílatele): mezi dvěma vzorky se vyhladí, za posledním se chvíli pokračuje stejným směrem, pak stojí
  function ghostAt(samples, t) {
    var n = samples.length;
    if (!n) return null;
    if (t <= samples[0].t) return { x: samples[0].x, y: samples[0].y };
    for (var i = 1; i < n; i++) {
      var a = samples[i - 1], b = samples[i];
      if (t <= b.t) {
        var k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    var l = samples[n - 1], p = n > 1 ? samples[n - 2] : null;
    var over = Math.min(t - l.t, 160);
    var vx = p && l.t > p.t ? (l.x - p.x) / (l.t - p.t) : 0, vy = p && l.t > p.t ? (l.y - p.y) / (l.t - p.t) : 0;
    return { x: l.x + vx * over, y: l.y + vy * over };
  }

  // Čas startu: nejdřív osm vteřin po založení zápasu a nejdřív 2,5 vteřiny po tom, co je připravený druhý z hráčů. Oba si ho spočítají z obou návrhů stejně.
  function proposeStart(created, now) { return Math.max(created + COUNTDOWN_MS, now + 2500); }
  function agreedStart(mine, theirs) { return Math.max(mine, theirs); }

  window.__rocketMp = { buildSchedule: buildSchedule, ghostAt: ghostAt, phaseAt: phaseAt, mix: mix, mulberry32: mulberry32, proposeStart: proposeStart, agreedStart: agreedStart, V: V, MODE: MODE };

  // ---------- Vzhled: pevné bojiště, zakrytí menu a pruhy ----------
  function css() {
    var st = document.createElement('style');
    st.textContent = 'body.mp #menu-overlay,body.mp #btn-pause,body.mp #pause-overlay,body.mp #gameover-overlay,body.mp #quit-overlay,body.mp #hud-coins{display:none!important}' +
      'body.mp.pvp #btn-bomb{display:none!important}' +
      'body.mp #game-container{width:' + W + 'px;height:' + H + 'px;max-width:none;flex:none;transform-origin:center center;transform:scale(var(--mps,1))}' +
      '#mpCover{position:absolute;inset:0;z-index:950;display:none;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:rgba(2,6,23,.78);color:#fff;text-align:center;font:800 24px system-ui,sans-serif;padding:24px}' +
      '#mpCover b{font-size:96px;line-height:1;color:#7dd3fc}#mpCover small{font:600 15px system-ui,sans-serif;opacity:.9;max-width:300px}' +
      '#mpPeer{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:60;display:none;align-items:center;gap:8px;padding:4px 10px;border-radius:12px;background:rgba(2,6,23,.72);color:#e2e8f0;font:700 11px system-ui,sans-serif;pointer-events:none;white-space:nowrap}' +
      '#mpPeer .bar{width:90px;height:7px;border-radius:5px;background:#1e293b;overflow:hidden}#mpPeer .bar i{display:block;height:100%;width:100%;background:#4ade80;transition:width .2s}' +
      '#mpPeer.dead{opacity:.55}#mpPeer .nm{max-width:90px;overflow:hidden;text-overflow:ellipsis}';
    document.head.appendChild(st);
    var cover = document.createElement('div');
    cover.id = 'mpCover';
    cover.innerHTML = '<b id="mpBig"></b><span id="mpMsg"></span><small id="mpSub"></small>';
    document.getElementById('game-container').appendChild(cover);
    var peer = document.createElement('div');
    peer.id = 'mpPeer';
    peer.innerHTML = '<span class="nm" id="mpPeerName"></span><span class="bar"><i id="mpPeerFill"></i></span><span id="mpPeerHp"></span>';
    document.getElementById('game-container').appendChild(peer);
  }

  function say(big, msg, sub) {
    var c = document.getElementById('mpCover');
    document.getElementById('mpBig').textContent = big || '';
    document.getElementById('mpBig').style.display = big ? 'block' : 'none';
    document.getElementById('mpMsg').textContent = msg || '';
    document.getElementById('mpSub').textContent = sub || '';
    c.style.display = big || msg ? 'flex' : 'none';
    c.style.background = ''; c.style.pointerEvents = '';
  }

  function fit() {
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    document.documentElement.style.setProperty('--mps', String(Math.max(0.3, Math.min(2.2, s))));
  }

  function oppName() { return (MP.init.opponent && MP.init.opponent.name) || (MODE === 'pvp' ? 'Soupeř' : 'Spoluhráč'); }
  function now() { return MP.serverNow(); }
  function elapsed() { return V.started ? now() - V.startAt : 0; }

  // ---------- Síť ----------
  function send(pkt, force) { try { MP.rt.send(pkt, { force: !!force }); } catch (e) { /* kanál není */ } }
  // Důležité zprávy (padl jsem, vyhráli jsme) se neomezují odstupem a pro jistotu se zopakují: když jedna zmizí, druhá dorazí. Příjemce je zpracuje jen jednou.
  function sendSure(pkt) { send(pkt, true); setTimeout(function () { send(pkt, true); }, 350); setTimeout(function () { send(pkt, true); }, 1100); }

  function sendState(force) {
    var g = Game, t = now();
    if (!V.started || (!force && t - V.lastSend < SEND_EVERY - 5)) return;
    V.lastSend = t;
    var p = g.player;
    var pkt = { k: 's', q: ++V.seq, t: Math.round(t), x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, hp: Math.max(0, Math.round(p.hp)), mh: Math.round(p.maxHp),
      sh: p.shieldTimer > 0 ? 1 : 0, tr: p.tripleShotTimer > 0 ? 1 : 0, rp: p.rapidTimer > 0 ? 1 : 0, d: p.dmg };
    if (V.fire.length) { pkt.f = V.fire; V.fire = []; }
    send(pkt);
  }

  // Střely druhého hráče: stejné rozestavení jako ve Player.shoot, u souboje převrácené (letí shora dolů) a nepřátelské
  function spawnPeerShots(fire, dmg) {
    var g = Game, pvp = MODE === 'pvp', d = clamp(Number(dmg) || 2, 1, 3) * (pvp ? 2 : 1);   // v souboji střela zraňuje dvojnásobně, ať se souboj nevleče
    (fire || []).slice(0, 12).forEach(function (f) {
      var t0 = Number(f[0]), fx = clamp(Number(f[1]) || 0, 0, W), fy = clamp(Number(f[2]) || 0, 0, H), tri = f[3] ? 1 : 0;
      var age = clamp(now() - t0, 0, 450);
      var y = fy - 18, v = -14.5;
      var shots = tri ? [[fx, y, 0, v], [fx - 11, y + 6, -2.6, v * 0.92], [fx + 11, y + 6, 2.6, v * 0.92]] : [[fx - 6, y, 0, v], [fx + 6, y, 0, v]];
      shots.forEach(function (s) {
        var bx = s[0], by = s[1], vx = s[2], vy = s[3];
        if (pvp) { by = H - by; vy = -vy; }
        var b = pvp ? new Bullet(bx, by, vx, vy, d, '#ff5470', true, 5) : new Bullet(bx, by, vx, vy, d, '#7dffb0', false);
        b.x += vx * age / 16; b.y += vy * age / 16;
        b.peer = true;
        g.bullets.push(b);
      });
    });
  }

  function onMessage(p) {
    if (!p || typeof p !== 'object') return;
    if (p.k === 'hi') {
      V.peerHi = Number(p.p) || 0; V.peerLive = !!p.live;
      if (V.started) send({ k: 'hi', p: V.startAt, live: 1 }, true);
      else maybeStart();
      return;
    }
    V.peer.seen = Date.now();
    if (p.k === 's') {
      if (!(p.q > V.peer.seq)) return;      // starší nebo opakovaná zpráva
      V.peer.seq = p.q;
      var pe = V.peer, pvp = MODE === 'pvp';
      var x = clamp(Number(p.x) || 0, 0, W), y = clamp(Number(p.y) || 0, 0, H);
      var oldHp = pe.hp;
      pe.hp = clamp(Number(p.hp) || 0, 0, 1000); pe.maxHp = clamp(Number(p.mh) || 100, 1, 1000);
      pe.shield = p.sh ? 1 : 0; pe.triple = p.tr ? 1 : 0; pe.rapid = p.rp ? 1 : 0;
      V.samples.push({ t: Number(p.t) || now(), x: x, y: pvp ? H - y : y });
      if (V.samples.length > 24) V.samples.shift();
      if (pe.hp < oldHp && V.started && !V.ended) Game.boom(ghostNow().x, ghostNow().y, '#ffffff', 5, 3);
      if (p.f && V.started && !V.ended) spawnPeerShots(p.f, p.d);
      return;
    }
    if (p.k === 'dead') { V.peer.dead = true; if (V.started) onPeerDead(); return; }
    if (p.k === 'won') { if (!V.ended) finish('win', 'bosses'); }
  }

  // ---------- Začátek ----------
  function maybeStart() {
    if (V.started || V.ended || !V.open || !V.mine) return;
    // už rozehraná hra druhého hráče: připojím se do jejího času
    if (V.peerLive && V.peerHi) { begin(V.peerHi); return; }
    if (!V.peerHi) return;
    begin(agreedStart(V.mine, V.peerHi));
  }

  function begin(startAt) {
    V.startAt = startAt;
    V.beginWatch = true;
  }

  function startRun() {
    V.started = true;
    say('', '', '');
    Game.start('normal');
    Game.holdFire = false;
    V.schedule = buildSchedule(SEED, MODE === 'coop', FORMATIONS, U);
    // připojení do rozehrané hry: co už letělo před mým příchodem, se nepouští
    var el = elapsed();
    while (V.spawned < V.schedule.length && V.schedule[V.spawned].at < el - 1500) V.spawned++;
    while (V.bossIdx < BOSS_TIMES.length && BOSS_TIMES[V.bossIdx] < el - 5000 && MODE === 'coop') V.bossIdx++;
    document.getElementById('mpPeer').style.display = 'flex';
    if (MODE === 'pvp') {
      var bar = document.getElementById('boss-bar');
      document.getElementById('boss-name').innerText = oppName();
      document.getElementById('boss-name').style.color = '#ff5470';
      document.getElementById('boss-fill').style.background = '#ff5470';
      bar.classList.remove('hidden');
    }
  }

  // ---------- Průběh hry ----------
  // Pustí nepřátele a bosse podle společného času. Kdo zaostal, zmeškané nepřátele nedohání (jen ty, co přiletěli před okamžikem).
  function directorUpdate() {
    var g = Game;
    if (!V.started || V.ended || !V.schedule) return;
    var el = elapsed();
    while (V.spawned < V.schedule.length && V.schedule[V.spawned].at <= el) {
      var ev = V.schedule[V.spawned++];
      if (el - ev.at > 1500) continue;
      var e = new Enemy(ev.x, ev.y, ev.type, g.diffMult);
      if (ev.vx) e.vx = ev.vx;
      var late = Math.max(0, el - ev.at);
      e.t = ev.wob + late; e.fireTimer = ev.fire - late;
      if (late > 0) { e.y += e.speed * late / 16; e.x += (e.vx || 0) * late / 16; }
      g.enemies.push(e);
    }
    if (MODE === 'coop' && V.bossIdx < BOSS_TIMES.length && el >= BOSS_TIMES[V.bossIdx] && !g.boss) {
      V.bossIdx++;
      g.spawnBoss();
    }
  }

  function ghostNow() {
    var s = ghostAt(V.samples, now() - 130);
    return s || { x: W / 2, y: MODE === 'pvp' ? 90 : H - 90 };
  }

  function drawGhost(ctx) {
    if (!V.started || V.ended || V.peer.dead || !V.samples.length) return;
    var p = ghostNow(), pe = V.peer, pvp = MODE === 'pvp', r = 17;
    var rapid = !!pe.rapid;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (pvp) ctx.rotate(Math.PI);
    ctx.globalAlpha = pvp ? 1 : 0.85;
    Art.blit(ctx, Art.ship(r, rapid));
    ctx.globalAlpha = 1;
    if (pe.shield) {
      ctx.beginPath(); ctx.arc(0, 0, r + 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(150,225,255,0.85)'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = pvp ? 'rgba(255,84,112,0.85)' : 'rgba(125,255,176,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.font = '700 10px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = pvp ? '#ff9aad' : '#a7f3c4';
    ctx.fillText(oppName().slice(0, 14), p.x, pvp ? p.y + 32 : p.y - 26);
    ctx.restore();
  }

  function refreshPeerBar() {
    var pe = V.peer, pct = clamp(pe.hp / Math.max(1, pe.maxHp), 0, 1);
    var nm = document.getElementById('mpPeerName'); if (nm) nm.textContent = oppName();
    var fill = document.getElementById('mpPeerFill'); if (fill) { fill.style.width = (pct * 100) + '%'; fill.style.background = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#facc15' : '#f87171'; }
    var hp = document.getElementById('mpPeerHp'); if (hp) hp.textContent = pe.dead ? 'Padl' : pe.hp + '/' + pe.maxHp;
    var box = document.getElementById('mpPeer'); if (box) box.classList.toggle('dead', pe.dead);
    if (MODE === 'pvp' && V.started) {
      document.getElementById('boss-fill').style.width = (pct * 100) + '%';
      document.getElementById('boss-phase').innerText = pe.dead ? 'Padl' : pe.hp + '/' + pe.maxHp;
    }
  }

  // ---------- Konec ----------
  function finish(outcome, reason) {
    if (V.ended) return;
    V.ended = outcome;
    MP.report(outcome, reason).catch(function () { /* výsledek potvrdí server */ });
    var big = outcome === 'win' ? 'Vítězství!' : outcome === 'loss' ? 'Porážka' : outcome === 'draw' ? 'Remíza' : 'Souboj zrušen';
    var why = reason === 'bosses' ? 'Společně jste porazili všechny bosse.'
      : reason === 'team' ? 'Obě lodě padly.'
      : reason === 'death' ? 'Tvoje loď byla zničena.'
      : reason === 'foe' ? 'Soupeřova loď byla zničena.' : '';
    // zmrazí svět a ukáže výsledek (po načtení výsledku od serveru přibude odměna v liště appky)
    Game.state = 'GAMEOVER';
    Game.holdFire = true;
    say('', big, why);
    if (V.started) sendSure({ k: outcome === 'win' && MODE === 'coop' ? 'won' : 'bye' });
  }

  function onMyDeath() {
    if (V.dead || V.ended) return;
    V.dead = true;
    var p = Game.player;
    Game.boom(p.x, p.y, '#00f0ff', 45, 9);
    p.hp = 0;
    sendState(true);
    sendSure({ k: 'dead' });
    p.x = -500; p.y = -500;
    if (MODE === 'pvp') { finish('loss', 'death'); return; }
    if (V.peer.dead) { finish('loss', 'team'); return; }
    say('', 'Jsi vyřazen', 'Spoluhráč bojuje dál. Když porazí bosse, vyhráváte oba.');
    document.getElementById('mpCover').style.background = 'rgba(2,6,23,0.3)';
    document.getElementById('mpCover').style.pointerEvents = 'none';
  }

  function onPeerDead() {
    if (V.ended) return;
    if (MODE === 'pvp') { finish('win', 'foe'); return; }
    if (V.dead) finish('loss', 'team');
  }

  // ---------- Úpravy hry ----------
  function patchGame() {
    Story.off = true;
    Storage.data.tutorialDone = true;
    GameManager.prototype.pause = function () { /* v online hře se nepauzuje */ };
    GameManager.prototype.updateEvents = function () { /* náhodné události by se u obou lišily */ };
    GameManager.prototype.nextBossScore = function () { return Infinity; };
    Object.defineProperty(GameManager.prototype, 'phase', { configurable: true, get: function () { return phaseAt(elapsed()); } });
    Game.director.update = directorUpdate;
    Game.director.reset = function () { /* vlny řídí společný čas */ };
    // dokud nezačne společný odpočet, loď nestřílí
    Game.holdFire = true;

    var baseUpdate = Player.prototype.update, baseShoot = Player.prototype.shoot, baseDraw = Player.prototype.draw;
    Player.prototype.update = function (dt, input, game) {
      if (V.dead) return;
      baseUpdate.call(this, dt, input, game);
      if (MODE === 'pvp') this.y = Math.max(this.y, H * 0.5);     // v souboji má každý svou polovinu bojiště
    };
    Player.prototype.shoot = function (game) {
      baseShoot.call(this, game);
      if (V.started && !V.dead) V.fire.push([Math.round(now()), Math.round(this.x), Math.round(this.y), this.tripleShotTimer > 0 ? 1 : 0]);
    };
    Player.prototype.draw = function (ctx) { if (!V.dead) baseDraw.call(this, ctx); };

    var baseOverlays = GameManager.prototype.drawOverlays;
    GameManager.prototype.drawOverlays = function (ctx) {
      drawGhost(ctx);
      // mrtvý hráč nemá mít stále červený okraj (je to jen „málo zdraví“, loď tu už není)
      var p = this.player, hp = p.hp;
      if (V.dead) p.hp = p.maxHp;
      baseOverlays.call(this, ctx);
      p.hp = hp;
    };

    Game.gameOver = function (reason) { if (reason === 'death' || reason === undefined) onMyDeath(); };
    var baseKillBoss = Game.killBoss;
    Game.killBoss = function () {
      var had = !!this.boss;
      baseKillBoss.call(this);
      if (had && MODE === 'coop' && !V.ended) {
        V.bosses++;
        if (V.bosses >= BOSS_TARGET) finish('win', 'bosses');
      }
    };
    var baseBomb = Game.useBomb;
    Game.useBomb = function () { if (MODE === 'pvp' || V.dead || V.ended) return; baseBomb.call(this); };
  }

  function tick() {
    if (V.ended && V.ended !== 'void') { return; }
    var t = now();
    if (!V.started) {
      if (V.beginWatch) {
        var left = V.startAt - t;
        if (left <= 0) { startRun(); return; }
        say(String(Math.ceil(left / 1000)), 'Start za chvíli', MODE === 'pvp' ? 'Soupeř je nahoře, ty dole. Zničte se, nepřátelé jedou na oba.' : 'Společně proti nepřátelům. Padnout musí tři bossové.');
      } else if (V.error) {
        say('', V.error, '');
      } else {
        say('', V.open ? 'Čekám na ' + oppName() + '...' : 'Připojuji se...', '');
        if (Date.now() - V.joinStart > JOIN_TIMEOUT && !V.peerHi) { V.error = 'Soupeř se nepřipojil.'; }
      }
      // vzkaz „jsem tu a chci začít v tomhle čase“ se opakuje, dokud hra nezačne (zpráva v reálném čase se může ztratit)
      if (V.open && V.mine && Date.now() - V.lastHi > 400) { V.lastHi = Date.now(); send({ k: 'hi', p: V.mine }, true); }
      return;
    }
    sendState(false);
    refreshPeerBar();
  }

  function boot() {
    document.body.classList.add('mp');
    document.body.classList.add(MODE);
    css();
    fit();
    window.addEventListener('resize', fit);
    patchGame();
    Game.resize();
    V.joinStart = Date.now();
    MP.on('sync', function (d) {
      V.created = d.match && d.match.created ? Number(d.match.created) : now();
      V.mine = proposeStart(V.created, now());
      if (V.open) maybeStart();
    });
    MP.on('rt', function (d) { onMessage(d && d.p); });
    MP.on('rt-status', function (d) {
      if (d.status === 'open') { V.open = true; maybeStart(); }
      else if (d.status === 'down') { V.open = false; }
      else if (d.status === 'error') { V.error = 'Spojení v reálném čase se nepodařilo navázat. Zkus to prosím znovu.'; }
    });
    MP.on('end', function (d) {
      var v = d.match || {};
      if (V.ended && V.ended !== 'void') return;
      V.ended = d.outcome || (v.status === 'void' ? 'void' : v.winner === v.slot || v.winner === 3 ? 'win' : 'loss');
      Game.state = 'GAMEOVER';
      var why = v.reason === 'timeout' ? '' : v.reason === 'resign' ? (V.ended === 'win' ? 'Soupeř to vzdal.' : 'Vzdal jsi to.') : v.reason === 'opponent_gone' ? 'Soupeř se odpojil.' : '';
      say('', V.ended === 'win' ? 'Vítězství!' : V.ended === 'loss' ? 'Porážka' : V.ended === 'draw' ? 'Remíza' : 'Souboj zrušen', why);
    });
    MP.listen();
    MP.rt.open();
    setInterval(tick, 50);
    tick();
  }

  // V hotové hře jsou všechny části na místě; zkušební prostředí bez hry si bere jen pomocné funkce výše
  if (typeof GameManager !== 'undefined' && typeof Game !== 'undefined') boot();
})();
