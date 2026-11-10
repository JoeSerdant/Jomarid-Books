// Sdílená aréna (multiplayer): jedna společná aréna pro deset tanků, ve které mají všichni hráči opravdu totéž. Hráči nahrazují boty: když se připojí hráč, jeden bot
// zmizí (1 hráč = 9 botů, 2 hráči = 8 botů...), když odejde, bot se vrátí. Aréna běží jen tehdy, když je v ní nějaký hráč.
// Hra se spustí s rozhraním window.jomaridMP z appky (src/mp) a jen v režimu arény; bez něj se tenhle soubor jen načte a nic nedělá.
//
// Jak to funguje (vychází ze shared/net.js): jeden hráč je HOSTITEL a počítá celou arénu jako v sólové hře: boty, tvary, střely, bonusy, zásahy, smrti i zkušenosti.
// Ostatní jsou HOSTÉ: ovládají jen svůj tank (jeho pohyb si počítají sami, ať odezva nic nestojí) a posílají hostiteli vstupy: polohu, míření, střelbu a příkazy
// (koupit vlastnost, vybrat třídu nebo výhodu, skok, znovuzrození). Od hostitele dostávají obraz arény a kreslí ho stejným kreslením jako sólovou hru.
// Zprávy se posílají jen při změně ("odhad podle rychlosti": střela letící rovně se pošle jednou), takže se obraz nesekne a zpráv je málo.
// Zdraví, zásahy, zkušenosti, třídy a výhody určuje vždy hostitel: host nemůže poslat nic, čím by si je zvýšil (příkaz se ověří, poloha se omezí rychlostí).
//
// Když hostitel odejde nebo ztichne (třeba uspaná karta), převezme to nejdřív příchozí z ostatních a pokračuje z toho, co měl na obrazovce: boty, tvary i hráči zůstanou.
// O tom, kdo je hostitel, rozhoduje číslo období (term): každé převzetí ho zvýší, takže se vrátivší starý hostitel nikoho nepřeskočí a sám se stane hostem.
//
// Kolo trvá 160 vteřin (podle času serveru z appky). Vyhrává ho ten, komu za kolo nejvíc přibylo bodů; vítěze oznámí hostitel a výherce o odměnu požádá server
// (mp_arena_claim, odměna je jednou za kolo a v denním stropu). Cheaty a sólový postup tu nejsou.
(function () {
  var MP = window.jomaridMP && window.jomaridMP.enabled && window.jomaridMP.init && window.jomaridMP.init.arena ? window.jomaridMP : null;
  if (!MP) return;
  var Net = window.JomaridNet;
  if (!Net) return;
  var Q1 = Net.q1, Q2 = Net.q2;

  var SLOTS = 10;                // tanků v aréně: hráči a boti dohromady
  var MAX_HUMANS = 6;            // víc hráčů by u bezplatné Supabase přesáhlo 100 zpráv za vteřinu
  var ROUND_MS = 160000;         // délka kola
  var HELLO_EVERY = 2000;        // ms mezi zprávami "jsem tu"
  var HELLO_WAIT = 1600;         // po otevření kanálu tak dlouho čeká, jestli v aréně už někdo je, než se ujme hostitele
  var SILENT_MS = 5000;          // kdo tak dlouho nic neposlal, z arény odešel
  var KEY_EVERY = 4000;          // klíčová zpráva se stavem všeho
  var ZONE_SEED = 20240611;      // zóny (láva, led, oáza) jsou u všech hráčů stejné
  var ME = MP.init.me || { id: 'me', name: 'Ty' };

  var V = {
    clock: function () { return Date.now(); },
    role: 'host', term: 0, hostId: null, hostTerm: 0, hostSeen: 0, hostJoined: 0,
    open: false, started: false, joinedAt: 0, openedAt: 0, lastHello: 0, lastAsk: 0, lastInput: 0, lastFire: 0, lastFireSent: 0, lastSnap: 0,
    roster: null, rep: null, mirror: null, remotes: {}, evq: [], hn: 1, rates: { snap: 100, input: 100 },
    round: -1, snap: null, claimBusy: false, botT: 0, roundWins: 0, respawning: 0, killer: '', guestSince: 0, fullShown: false,
  };

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
  // Počet botů: hráči zabírají místa, boti doplňují zbytek
  function botsWanted(humans) { return Math.max(0, SLOTS - Math.max(1, humans)); }
  // Kolo podle času (u všech stejné) a kolik z něj zbývá
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
  // Jak často se posílá: každá zpráva se u Supabase počítá i za každého příjemce a bezplatný projekt snese 100 zpráv za vteřinu, takže s víc hráči se zpomaluje.
  // snap = mezi obrazy světa od hostitele, input = mezi vstupy od hostů (střelba a příkazy se posílají hned).
  function ratesFor(humans) {
    var h = Math.max(1, humans | 0);
    if (h <= 2) return { snap: 100, input: 100 };
    if (h === 3) return { snap: 110, input: 150 };
    if (h === 4) return { snap: 130, input: 250 };
    if (h === 5) return { snap: 170, input: 400 };
    return { snap: 250, input: 800 };
  }
  // Poloha hosta od hostitele: nejvýš tolik, kolik tank za ten čas urazí (i se skokem a bonusem), ať se nedá "teleportovat"
  function clampMove(px, py, nx, ny, dt, vmax) {
    var lim = vmax * Math.min(Math.max(dt, 0.02), 0.6) + 80, dx = nx - px, dy = ny - py, d = Math.sqrt(dx * dx + dy * dy);
    if (!(d > lim)) return { x: nx, y: ny, clamped: false };
    return { x: px + dx / d * lim, y: py + dy / d * lim, clamped: true };
  }
  // Který z dvou hostitelů se stejným obdobím vyhrává: dřív příchozí, při shodě menší id
  function beats(aJoined, aId, bJoined, bId) { return aJoined < bJoined || (aJoined === bJoined && aId < bId); }

  // Stav tanku pro zprávu: [x, y, vx, vy, úhel, zdraví, příznaky, skóre, úroveň, štít]
  var F = { ALIVE: 1, INV: 2, HIT: 4, DASH: 8, BURN: 16, SLOW: 32, ICE: 64, SPD: 128, DMG: 256, FIRE: 512, OASIS: 1024 };
  function tankFlags(t) {
    return (t.alive ? F.ALIVE : 0) | (t.invuln > 0 ? F.INV : 0) | (t.hit > 0 ? F.HIT : 0) | (t.dashT > 0 ? F.DASH : 0) | (t.burnT > 0 ? F.BURN : 0) | (t.slowT > 0 ? F.SLOW : 0) |
      (t.onIce ? F.ICE : 0) | (t.buff && t.buff.speed > 0 ? F.SPD : 0) | (t.buff && t.buff.dmg > 0 ? F.DMG : 0) | (t.wantFire ? F.FIRE : 0) | (t.inOasis ? F.OASIS : 0);
  }
  function packTank(t) {
    return [Q1(t.x), Q1(t.y), Q1(t.vx || 0), Q1(t.vy || 0), Q2(t.angle || 0), Math.round(Math.max(0, t.hp)), tankFlags(t), Math.round(t.score), t.level, Math.round(t.shield || 0)];
  }
  function tankSig(t) {
    return [t.cls, t.level, t.stats.join(''), Object.keys(t.perks).sort().join(','), t.name, t.color, t.points, t.tierDone, t.perkN, t.perkOffer ? t.perkOffer.join() : '', t.kills, Math.round(t.maxHp)].join('|');
  }

  window.__arenaMp = { botsWanted: botsWanted, roundOf: roundOf, roundLeft: roundLeft, pickWinner: pickWinner, clampN: clampN, ratesFor: ratesFor, clampMove: clampMove, beats: beats,
    tankFlags: tankFlags, packTank: packTank, tankSig: tankSig, F: F, V: V, ROUND_MS: ROUND_MS, SLOTS: SLOTS, MAX_HUMANS: MAX_HUMANS };

  // ---------- Hra ----------
  function now() { return MP.serverNow(); }
  function send(pkt, force) { try { pkt.id = ME.id; MP.rt.send(pkt, { force: !!force }); } catch (e) { /* kanál není */ } }
  function tankById(id) { for (var i = 0; i < tanks.length; i++) if (tanks[i].id === id) return tanks[i]; return null; }
  function remoteList() { var out = []; for (var id in V.remotes) if (V.remotes[id]) out.push(V.remotes[id]); return out; }
  function humans() { return V.role === 'host' ? 1 + remoteList().length : Math.max(1, V.hn | 0); }
  function dropFrom(arr, obj) { var k = arr.indexOf(obj); if (k >= 0) arr.splice(k, 1); }

  // ---------- Hostitel: co se posílá ----------
  function bulletFlags(b) { return (b.drone ? 1 : 0) | (b.trap ? 2 : 0) | (b.missile ? 4 : 0) | (b.bomb ? 8 : 0) | (b.crit ? 16 : 0) | (b.slow ? 32 : 0) | (b.burn ? 64 : 0) | (b.streak ? 128 : 0); }
  function kindsHost() {
    return {
      tank: {
        list: function () { return tanks; }, id: function (t) { return t.id; },
        state: packTank, infoSig: tankSig, always: true,
        info: function (t) {
          return { nm: t.name, co: t.color, tm: t.team || 0, cls: t.cls, st: t.stats.slice(), pk: Object.keys(t.perks), pt: t.points, td: t.tierDone, pn: t.perkN, po: t.perkOffer || null,
            kl: t.kills, mh: Math.round(t.maxHp), pid: t.remote ? t.remote.id : t === player ? ME.id : t.humanPid || '' };
        },
      },
      shape: {
        list: function () { return shapes; }, id: function (s) { return s.id; }, tol: 5, vtol: 25, refresh: 2500,
        state: function (s) { return [Q1(s.x), Q1(s.y), Q1(s.vx + s.dvx), Q1(s.vy + s.dvy), Q2(s.rot), Math.round(s.hp * 10) / 10, Q2(s.spin)]; },
        info: function (s) { return { ty: s.type, r: Q1(s.r), mh: Math.round(s.maxHp * 10) / 10 }; },
        dev: function (st, last, dt) { return st[5] !== last[5] || Math.abs(st[4] - (last[4] + last[6] * dt)) > 0.35; },
      },
      bullet: {
        list: function () { return bullets; }, id: function (b) { return b.id; }, tol: 6, vtol: 45, refresh: 700,
        state: function (b) { return [Q1(b.x), Q1(b.y), Q1(b.vx), Q1(b.vy)]; },
        info: function (b) { return { o: b.owner ? b.owner.id : 0, r: Q1(b.r), c: b.color, f: bulletFlags(b), bl: Math.round(b.blast || 0), li: Q1(b.life) }; },
      },
      pickup: {
        list: function () { return world.pickups; }, id: function (p) { return p.id; }, tol: 3, vtol: 20, refresh: 3000,
        state: function (p) { return [Q1(p.x), Q1(p.y), 0, 0, Q1(p.life)]; },
        info: function (p) { return { ty: p.type, r: p.r }; },
      },
    };
  }

  // ---------- Host: obraz světa od hostitele se skládá do entit hry ----------
  function applyTankInfo(t, i, own) {
    var id = CLASSES[i.cls] ? i.cls : 'basic';
    if (t.cls !== id) {
      var n = CLASSES[id].barrels.length;
      t.cls = id; t.bt = new Array(n).fill(0); t.rec = new Array(n).fill(0); t.tur = new Array(n).fill(t.angle || 0); t.drones = 0; t.traps = 0;
    }
    t.name = typeof i.nm === 'string' ? i.nm.slice(0, 14) : t.name;
    if (typeof i.co === 'string' && /^#[0-9a-fA-F]{6}$/.test(i.co)) t.color = i.co;
    t.team = i.tm | 0;
    var st = Array.isArray(i.st) ? i.st : [];
    t.stats = [0, 1, 2, 3, 4, 5, 6, 7].map(function (k) { return clampN(st[k], 0, STAT_CAP, 0) | 0; });
    t.perks = {};
    (Array.isArray(i.pk) ? i.pk : []).slice(0, 30).forEach(function (pid) { if (typeof pid === 'string' && PERK_BY[pid]) t.perks[pid] = true; });
    t.points = clampN(i.pt, 0, 1e6, 0) | 0; t.tierDone = clampN(i.td, 0, 20, 0) | 0; t.perkN = clampN(i.pn, 0, 99, 0) | 0;
    t.perkOffer = Array.isArray(i.po) ? i.po.filter(function (x) { return typeof x === 'string' && PERK_BY[x]; }).slice(0, 3) : null;
    t.kills = clampN(i.kl, 0, 1e6, 0) | 0;
    t.humanPid = typeof i.pid === 'string' ? i.pid : '';
    recalc(t);
    if (own) { ui.statsDirty = true; ui.perkDirty = true; ui.offerKey = '#'; }
  }

  // příznaky z obrazu -> časovače, které kreslení čte (jen jestli běží)
  function applyFlags(t, f) {
    t.invuln = f & F.INV ? 1 : 0;
    if (f & F.HIT) t.hit = Math.max(t.hit || 0, 0.08);
    t.dashT = f & F.DASH ? 0.1 : 0;
    t.burnT = f & F.BURN ? 1 : 0; t.slowT = f & F.SLOW ? 1 : 0; t.slowF = 0.6;
    t.onIce = !!(f & F.ICE); t.inOasis = !!(f & F.OASIS);
    t.buff.speed = f & F.SPD ? 1 : 0; t.buff.dmg = f & F.DMG ? 1 : 0;
    t.wantFire = !!(f & F.FIRE);
  }

  function mirrorTank(id, info, st) {
    var own = info.pid === ME.id, t;
    if (own) { t = player; t.id = id; }
    else { t = makeTank(false, info.nm || 'Hráč', info.co || BOT_COLORS[0], info.tm | 0); t.id = id; }
    t.mirror = true; t.level = st[8];
    applyTankInfo(t, info, own);
    var alive = !!(st[6] & F.ALIVE);
    t.hp = Math.min(t.maxHp, st[5]); t.score = st[7]; t.shield = st[9] || 0;
    t.x = st[0]; t.y = st[1]; t.vx = st[2]; t.vy = st[3]; t.angle = st[4];
    if (own) { ownState(t, st, true); return t; }
    applyFlags(t, st[6]);
    t.alive = alive; t.wasAlive = alive;
    return t;
  }

  // Můj tank u hosta: pohyb si řídím sám, zbytek (zdraví, zkušenosti, smrt, znovuzrození) určuje hostitel
  function ownState(t, st, first) {
    var alive = !!(st[6] & F.ALIVE), f = st[6];
    t.hp = Math.min(t.maxHp, st[5]); t.shield = st[9] || 0; t.score = st[7];
    if (st[8] !== t.level) {
      var up = st[8] > t.level;
      t.level = st[8];
      if (!first && up && alive) { floatText(t.x, t.y - t.r - 26, 'Úroveň ' + st[8], theme.accent); beep('level'); buzz(30); ui.statsDirty = true; }
    }
    t.invuln = f & F.INV ? 1 : 0; if (f & F.HIT) t.hit = 0.08;
    t.buff.speed = f & F.SPD ? 1 : 0; t.buff.dmg = f & F.DMG ? 1 : 0; t.burnT = f & F.BURN ? 1 : 0; t.slowT = f & F.SLOW ? 1 : 0; t.slowF = 0.6;
    if (alive && !t.alive) {                                  // (znovu)zrození: poloha od hostitele
      t.x = st[0]; t.y = st[1]; t.vx = 0; t.vy = 0; t.alive = true; t.born = time;
      V.respawning = 0; state = 'play'; ui.spec = null;
      elDead.classList.add('hidden'); elHud.classList.remove('hidden');
      cam.x = t.x; cam.y = t.y; ui.statsDirty = true; ui.offerKey = '#'; ui.perkDirty = true;
    } else if (!alive && t.alive && !V.respawning) {          // zničen
      t.alive = false; deathFx(t);
      state = 'dead'; ui.deadT = 1.15; ui.spec = null; ui.specT = 0;
      Object.assign(deathInfo, { by: V.killer || '', level: t.level, score: Math.round(t.score), kills: t.kills, time: Math.max(0, time - (t.born || time)) });
      V.killer = '';
      beep('die'); buzz(70);
    }
  }

  function mirrorShape(id, info, st) {
    var d = SHAPES[info.ty]; if (!d) return null;
    var s = { id: id, isShape: true, type: info.ty, x: st[0], y: st[1], vx: 0, vy: 0, dvx: 0, dvy: 0, r: clampN(info.r, 4, 400, d.r), hp: st[5], maxHp: clampN(info.mh, 1, 1e9, d.hp), rot: st[4], spin: st[6],
      xp: d.xp, dps: d.dps, loss: d.loss, n: d.n, color: d.color, hit: 0, dead: false, lastAttacker: null, born: time };
    shapes.push(s);
    return s;
  }

  function mirrorBullet(id, info, st) {
    var f = info.f | 0;
    var b = { id: id, owner: tankById(info.o), x: st[0], y: st[1], vx: st[2], vy: st[3], r: clampN(info.r, 1, 200, 5), hp: 1, dmg: 1, life: clampN(info.li, 0, 30, 1), color: typeof info.c === 'string' ? info.c : '#ffffff',
      drone: !!(f & 1), trap: !!(f & 2), missile: !!(f & 4), bomb: !!(f & 8), crit: !!(f & 16), slow: f & 32 ? 1 : 0, burn: f & 64 ? 1 : 0, streak: !!(f & 128),
      blast: info.bl | 0, bdmg: info.bl ? 2 : 0, dead: false, bounce: 0 };
    bullets.push(b);
    if (b.owner && !b.drone && !b.trap && b.owner.rec) for (var i = 0; i < b.owner.rec.length; i++) b.owner.rec[i] = Math.max(b.owner.rec[i], 0.6);    // zpětný ráz hlavně
    return b;
  }

  function mirrorPickup(id, info, st) {
    var p = { id: id, x: st[0], y: st[1], type: PICKS[info.ty] ? info.ty : 'heal', life: st[4], r: info.r || 15, ph: Math.random() * TAU };
    world.pickups.push(p);
    return p;
  }

  var HOOKS = {
    add: function (kind, id, info, st) {
      if (kind === 'tank') return mirrorTank(id, info, st);
      if (kind === 'shape') return mirrorShape(id, info, st);
      if (kind === 'bullet') return mirrorBullet(id, info, st);
      return mirrorPickup(id, info, st);
    },
    upd: function (kind, id, obj, st, info) {
      if (!obj) return;
      if (kind === 'tank') {
        obj.level = st[8];
        if (info) applyTankInfo(obj, info, obj === player);
        if (obj === player) { ownState(obj, st, false); return; }
        var alive = !!(st[6] & F.ALIVE);
        if (obj.alive && !alive) deathFx(obj);
        obj.alive = alive; obj.hp = Math.min(obj.maxHp, st[5]); obj.score = st[7]; obj.shield = st[9] || 0;
        applyFlags(obj, st[6]);
        if (alive && !obj.wasAlive) { obj.x = st[0]; obj.y = st[1]; }
        obj.wasAlive = alive;
      } else if (kind === 'shape') { obj.hp = st[5]; obj.spin = st[6]; }
      else if (kind === 'pickup') obj.life = st[4];
    },
    remove: function (kind, id, obj) {
      if (!obj) return;
      if (kind === 'tank') {
        if (obj === player) return;
        dropFrom(tanks, obj); obj.alive = false;
      } else if (kind === 'shape') {
        obj.dead = true; dropFrom(shapes, obj); shapeBreakFx(obj);
      } else if (kind === 'bullet') {
        obj.dead = true; dropFrom(bullets, obj);
        if (obj.blast) explosionFx(obj.x, obj.y, obj.blast, '#ffb04d');
      } else dropFrom(world.pickups, obj);
    },
  };

  function newMirror() { return new Net.Mirror(kindsHost(), HOOKS); }

  // Každý snímek: entity z obrazu světa se posunou na vyhlazenou polohu
  function syncMirror(dt) {
    var t = V.clock(), M = V.mirror, k = 1 - Math.exp(-dt * 18), p = { x: 0, y: 0 };
    M.table('tank').forEach(function (rec) {
      var o = rec.obj; if (!o || o === player) return;
      M.pos(rec, t, p);
      if (rec.st[6] & F.ALIVE) {
        o.x = p.x; o.y = p.y; o.vx = rec.st[2]; o.vy = rec.st[3];
        o.angle += angDiff(o.angle, rec.st[4]) * k;
        if (o.tur) for (var i = 0; i < o.tur.length; i++) o.tur[i] = o.angle;
      }
      if (o.hit > 0) o.hit -= dt;
      if (o.rec) for (var j = 0; j < o.rec.length; j++) o.rec[j] = Math.max(0, o.rec[j] - dt * 6);
    });
    M.table('shape').forEach(function (rec) {
      var o = rec.obj; if (!o) return;
      M.pos(rec, t, p); o.x = p.x; o.y = p.y;
      o.rot = rec.st[4] + rec.st[6] * Math.min((t - rec.t) / 1000, 0.6);
    });
    M.table('bullet').forEach(function (rec) {
      var o = rec.obj; if (!o) return;
      M.pos(rec, t, p); o.x = p.x; o.y = p.y; o.vx = rec.st[2]; o.vy = rec.st[3]; o.life -= dt;
    });
    M.table('pickup').forEach(function (rec) {
      var o = rec.obj; if (!o) return;
      M.pos(rec, t, p); o.x = p.x; o.y = p.y; o.life -= dt;
    });
  }

  // ---------- Host: vlastní tank a odesílání vstupů ----------
  function predictOwn(dt) {
    var p = player;
    p.onIce = false; p.inOasis = false;
    var Z = world.zones;
    for (var i = 0; i < Z.length; i++) { var z = Z[i], dx = p.x - z.x, dy = p.y - z.y; if (dx * dx + dy * dy > z.r * z.r) continue; if (z.type === 'ice') p.onIce = true; else if (z.type === 'oasis') p.inOasis = true; }
    if (p.dashCd > 0) p.dashCd -= dt;
    if (p.hit > 0) p.hit -= dt;
    for (var b = 0; b < (p.rec || []).length; b++) p.rec[b] = Math.max(0, p.rec[b] - dt * 6);
    moveTank(p, dt);
    // srážky s tvary a tanky z obrazu: posunou jen mě, ostatní se na další snímek stejně vrátí na polohy od hostitele
    var saved = [], n, m;
    for (n = 0; n < tanks.length; n++) if (tanks[n] !== p) saved.push([tanks[n], tanks[n].x, tanks[n].y, tanks[n].vx, tanks[n].vy]);
    var ss = [];
    for (m = 0; m < shapes.length; m++) ss.push([shapes[m], shapes[m].x, shapes[m].y, shapes[m].hp]);
    gBody.clear();
    if (p.alive) gBody.add(p);
    for (n = 0; n < tanks.length; n++) if (tanks[n].alive && tanks[n] !== p) gBody.add(tanks[n]);
    for (m = 0; m < shapes.length; m++) if (!shapes[m].dead) gBody.add(shapes[m]);
    bodyCollisions(dt);
    for (n = 0; n < saved.length; n++) { saved[n][0].x = saved[n][1]; saved[n][0].y = saved[n][2]; saved[n][0].vx = saved[n][3]; saved[n][0].vy = saved[n][4]; }
    for (m = 0; m < ss.length; m++) { ss[m][0].x = ss[m][1]; ss[m][0].y = ss[m][2]; ss[m][0].hp = ss[m][3]; }
  }

  function sendInput(force) {
    var t = V.clock(), p = player, fire = p.wantFire ? 1 : 0;
    if (!force && t - V.lastInput < V.rates.input && fire === V.lastFire) return;
    V.lastInput = t; V.lastFire = fire;
    send({ k: 'I', x: Q1(p.x), y: Q1(p.y), vx: Q1(p.vx), vy: Q1(p.vy), mx: Q2(p.moveX || 0), my: Q2(p.moveY || 0), tx: Math.round(p.tx), ty: Math.round(p.ty), a: Q2(p.angle), f: fire }, fire !== V.lastFireSent);
    V.lastFireSent = fire;
  }

  function guestUpdate(dt) {
    time += dt; world.matchT += dt;
    syncMirror(dt);
    if (state === 'play' && player.alive) {
      controlPlayer(player, dt);
      predictOwn(dt);
    } else { player.moveX = 0; player.moveY = 0; player.wantFire = false; }
    if (V.respawning && V.clock() - V.respawning > 3000) { V.respawning = V.clock(); send({ k: 'C', c: 'respawn' }, true); }
    // částice, texty a prstence (jen vzhled)
    var pcap = partCap();
    for (var i = parts.length - 1; i >= 0; i--) {
      var pp = parts[i]; pp.life -= dt;
      if (pp.life <= 0 || (i > pcap && Math.random() < 0.5)) { parts.splice(i, 1); continue; }
      pp.x += pp.vx * dt; pp.y += pp.vy * dt; var f = Math.pow(pp.kind === 2 ? 0.25 : pp.kind === 1 ? 0.004 : 0.02, dt); pp.vx *= f; pp.vy *= f; pp.rot += (pp.vr === undefined ? 4 : pp.vr) * dt;
    }
    for (var j = texts.length - 1; j >= 0; j--) { var tx = texts[j]; tx.life -= dt; if (tx.life <= 0) { texts.splice(j, 1); continue; } tx.y -= 46 * dt; }
    for (var g = world.rings.length - 1; g >= 0; g--) { var rg = world.rings[g]; rg.life -= dt; if (rg.life <= 0) world.rings.splice(g, 1); else rg.r = rg.max * (1 - Math.pow(rg.life / rg.m, 2)); }
    shake *= Math.exp(-9 * dt); if (shake < 0.15) shake = 0;
    while (feedItems.length && feedItems[0].t < time) { var it = feedItems.shift(); if (it.el.parentNode) it.el.parentNode.removeChild(it.el); }
    sendInput(false);
    // plná aréna: hostitel pro mě nemá místo
    if (!V.fullShown && V.guestSince && V.clock() - V.guestSince > 7000) {
      var mine = false; V.mirror.table('tank').forEach(function (r) { if (r.obj === player) mine = true; });
      if (!mine && V.mirror.size('tank') > 0) { V.fullShown = true; banner('Aréna je plná, zatím jen sleduješ ostatní', 'info'); }
    }
  }

  // ---------- Hostitel: hosté jako tanky řízené sítí ----------
  function addRemote(id, name, color) {
    var t = V.remotes[id];
    if (t) return t;
    t = makeTank(false, name, color, 0);
    t.remote = { id: id, seen: V.clock(), lastIn: V.clock(), in: { mx: 0, my: 0, tx: t.x, ty: t.y, a: 0, f: 0 } };
    t.name = name; t.color = color; t.respawnT = 1e9;
    V.remotes[id] = t;
    banner(name + ' vstoupil do arény', 'info'); feed(name + ' vstoupil do arény', false);
    reconcileBots(true);
    return t;
  }
  function dropRemote(id, why) {
    var t = V.remotes[id];
    if (!t) return;
    delete V.remotes[id];
    t.alive = false;
    for (var i = 0; i < bullets.length; i++) if ((bullets[i].drone || bullets[i].trap) && bullets[i].owner === t) bullets[i].dead = true;
    dropFrom(tanks, t);
    banner(t.name + (why === 'bye' ? ' opustil arénu' : ' ztratil spojení'), 'info'); feed(t.name + ' opustil arénu', false);
    reconcileBots(true);
  }
  function respawnRemote(t) {
    var keep = { name: t.name, color: t.color };
    resetTank(t);
    t.name = keep.name; t.color = keep.color; t.invuln = 3; t.respawnT = 1e9; t.remote.in.f = 0;
  }

  function controlRemote(t) {
    var I = t.remote.in;
    t.moveX = I.mx; t.moveY = I.my; t.tx = I.tx; t.ty = I.ty; t.angle = I.a; t.wantFire = !!I.f && t.alive;
    if (V.clock() - t.remote.lastIn > 1500) t.wantFire = false;       // ztichl: nestřílí
    // nabídka výhod pro hosta (třída má přednost, jako v rozhraní hry)
    if (t.alive && !offerOf(t)) perkOfferOf(t);
  }
  function remoteMove(t, dt) {
    if (t.dashT > 0) t.dashT -= dt;
    var age = V.clock() - t.remote.lastIn;
    if (age < 400) { t.x += t.vx * dt; t.y += t.vy * dt; }
    t.x = clamp(t.x, t.r, WORLD - t.r); t.y = clamp(t.y, t.r, WORLD - t.r);
  }

  function onInput(p) {
    var t = V.remotes[p.id];
    if (!t || !t.remote) return;
    var R = t.remote, nowMs = V.clock(), dt = (nowMs - R.lastIn) / 1000;
    R.lastIn = nowMs; R.seen = nowMs;
    var I = R.in;
    I.mx = clampN(p.mx, -1.5, 1.5, 0); I.my = clampN(p.my, -1.5, 1.5, 0);
    I.tx = clampN(p.tx, -200, WORLD + 200, t.x); I.ty = clampN(p.ty, -200, WORLD + 200, t.y);
    I.a = clampN(p.a, -10, 10, t.angle); I.f = p.f ? 1 : 0;
    if (!t.alive) return;
    var c = clampMove(t.x, t.y, clampN(p.x, 0, WORLD, t.x), clampN(p.y, 0, WORLD, t.y), dt, t.speed * 1.4 * 3.2 + 320);
    t.x = c.x; t.y = c.y;
    t.vx = clampN(p.vx, -2500, 2500, 0); t.vy = clampN(p.vy, -2500, 2500, 0);
  }

  function onCommand(p) {
    var t = V.remotes[p.id];
    if (!t || !t.remote) return;
    t.remote.seen = V.clock();
    if (p.c === 'respawn') { if (!t.alive) respawnRemote(t); return; }
    if (!t.alive) return;
    if (p.c === 'buy') buyStat(t, clampN(p.i, 0, 7, 0) | 0);
    else if (p.c === 'cls') { var o = offerOf(t); if (o && typeof p.v === 'string' && o.indexOf(p.v) >= 0) chooseClass(t, p.v); }
    else if (p.c === 'perk') { var po = !offerOf(t) ? perkOfferOf(t) : null; if (po && typeof p.v === 'string' && po.indexOf(p.v) >= 0) choosePerk(t, p.v); }
    else if (p.c === 'dash') dash(t);
  }

  // ---------- Boti: hráči jim berou místa ----------
  function botList() { return tanks.filter(function (t) { return !t.isPlayer && !t.remote && !t.boss && !t.temp && !(t.ai && t.ai.dummy); }); }

  function reconcileBots() {
    if (!V.started || state === 'menu' || V.role !== 'host') return;
    var want = botsWanted(humans()), bots = botList();
    if (bots.length > want) {
      bots.sort(function (a, b) { return (a.alive ? 1 : 0) - (b.alive ? 1 : 0) || a.score - b.score; });
      for (var i = 0; i < bots.length - want; i++) {
        var b = bots[i];
        b.alive = false;
        for (var k = 0; k < bullets.length; k++) if ((bullets[k].drone || bullets[k].trap) && bullets[k].owner === b) bullets[k].dead = true;
        dropFrom(tanks, b);
      }
    } else if (bots.length < want) {
      for (var j = bots.length; j < want; j++) makeTank(false, '', BOT_COLORS[0]);
    }
  }

  // ---------- Kola a odměna (rozhoduje hostitel, vítěz si o odměnu řekne sám) ----------
  function entries() {
    var out = [];
    tanks.forEach(function (t) {
      if (t.boss || t.temp || (t.ai && t.ai.dummy)) return;
      var human = t === player || !!t.remote, known = V.snap && V.snap.scores[t.id] !== undefined;
      if (human && !known) return;                                   // kdo nebyl na začátku kola v aréně, o výhru nesoutěží
      out.push({ id: t.id, pid: t === player ? ME.id : t.remote ? t.remote.id : '', name: t.name, human: human, mine: t === player, gain: t.score - (known ? V.snap.scores[t.id] : 0) });
    });
    return out;
  }
  function takeSnapshot() {
    var sc = {};
    tanks.forEach(function (t) { sc[t.id] = t.score; });
    V.snap = { scores: sc, mine: player.alive || state === 'play', t: now() };
  }
  function claimMine() {
    if (V.claimBusy) return;
    V.claimBusy = true;
    MP.claim(Math.round(ROUND_MS / 1000), Math.round(player.score)).then(function (res) {
      V.claimBusy = false; V.roundWins++;
      if (res && res.granted > 0) banner('Vyhrál jsi kolo! Odměna +' + res.granted + ' Coinů', 'good');
      else banner('Vyhrál jsi kolo! Dnešní odměna za online hru už je vyčerpaná', 'info');
    }, function () { V.claimBusy = false; banner('Vyhrál jsi kolo, odměnu se teď nepodařilo vyřídit', 'info'); });
  }
  // Výsledek kola od hostitele: id hráče (nebo prázdné, když vyhrál bot) a jméno
  function onRoundResult(pid, name) {
    if (pid && pid === ME.id) claimMine();
    else if (name) banner('Kolo skončilo, vítěz: ' + name, 'info');
  }
  function finishRound() {
    var w = pickWinner(entries());
    if (!w) return;
    V.evq.push(['w', w.human ? w.pid : '', w.name]);
    onRoundResult(w.human ? w.pid : '', w.name);
  }
  function roundTick() {
    var r = roundOf(now());
    if (V.round === -1) { V.round = r; takeSnapshot(); return; }
    if (r !== V.round) { finishRound(); V.round = r; takeSnapshot(); }
  }
  window.__arenaMp.entries = entries;     // pro zkoušky

  // ---------- Síť: kdo je hostitel, zprávy ----------
  function sendHello() {
    V.lastHello = V.clock();
    send({ k: 'H', nm: String(ME.name || 'Hráč').slice(0, 14), co: player ? player.color : '#5fd6cc', ja: V.joinedAt }, true);
  }

  // Hostitel posílá obraz světa
  function hostSend() {
    var t = V.clock();
    V.rates = ratesFor(humans());
    if (t - V.lastSnap < V.rates.snap - 4) return;
    V.lastSnap = t;
    var pkt = V.rep.build(t);
    if (!pkt && !V.evq.length) return;
    pkt = pkt || { n: 0, key: 0, K: {} };
    pkt.k = 'S'; pkt.tm = V.term; pkt.ja = V.joinedAt; pkt.hn = humans();
    if (V.evq.length) pkt.ev = V.evq.splice(0, 30);
    send(pkt, !!pkt.key || !!pkt.ev);
  }

  function clearLocalWorld() {
    for (var i = tanks.length - 1; i >= 0; i--) if (tanks[i] !== player) { tanks[i].alive = false; tanks.splice(i, 1); }
    shapes.length = 0; bullets.length = 0; world.pickups.length = 0; parts.length = 0; texts.length = 0; world.rings.length = 0;
  }

  // Přechod na hosta: vlastní svět zmizí, čeká se na obraz od hostitele
  function becomeGuest(hostId, term, joined) {
    var wasHost = V.role === 'host';
    V.role = 'guest'; V.hostId = hostId; V.hostTerm = term; V.hostJoined = joined || 0; V.hostSeen = V.clock(); V.guestSince = V.clock(); V.fullShown = false;
    V.remotes = {}; V.evq.length = 0; V.respawning = 0;
    clearLocalWorld();
    V.mirror = newMirror();
    player.alive = false; player.hp = 0;
    if (state === 'dead') { elDead.classList.add('hidden'); elHud.classList.remove('hidden'); }
    state = 'play'; ui.spec = null; ui.offerKey = '#';
    if (wasHost) banner('Připojuješ se k aréně hostitele', 'info');
    sendHello();
    send({ k: 'Q' }, true);
  }

  // Přechod na hostitele (jsem první, nebo převzetí po hostiteli, který odešel): z entit, které host má na obrazovce, se stává svět
  function becomeHost(term) {
    var was = V.role;
    V.role = 'host'; V.term = term; V.hostId = ME.id; V.hostSeen = V.clock();
    if (was === 'guest') {
      var maxId = nextId;
      V.mirror = newMirror();                                             // staré záznamy o entitách se zahodí, samotné entity ve hře zůstávají
      for (var i = tanks.length - 1; i >= 0; i--) {
        var t = tanks[i]; maxId = Math.max(maxId, t.id);
        if (t === player) continue;
        t.mirror = false;
        if (t.humanPid) {
          var peer = V.roster.get(t.humanPid);
          if (peer) { t.remote = { id: t.humanPid, seen: V.clock(), lastIn: V.clock(), in: { mx: 0, my: 0, tx: t.x, ty: t.y, a: t.angle, f: 0 } }; V.remotes[t.humanPid] = t; t.respawnT = 1e9; }
          else { t.alive = false; tanks.splice(i, 1); }
        }
      }
      for (var k = 0; k < shapes.length; k++) maxId = Math.max(maxId, shapes[k].id);
      for (var b = bullets.length - 1; b >= 0; b--) { bullets[b].dead = true; bullets.splice(b, 1); }
      var mp = 0; for (var q = 0; q < world.pickups.length; q++) mp = Math.max(mp, world.pickups[q].id);
      pickId = Math.max(pickId, mp + 1);
      nextId = maxId + 1000;
      player.mirror = false; V.respawning = 0;
    }
    V.rep.reset(); V.rep.requestKey(true);
    V.round = -1;
    reconcileBots();
    if (was === 'guest') banner('Staráš se o arénu pro ostatní', 'info');
  }

  function onMessage(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || p.id === ME.id) return;
    var t = V.clock();
    switch (p.k) {
      case 'H': onHello(p, t); break;
      case 'S': onSnapshot(p, t); break;
      case 'I': if (V.role === 'host') { if (V.roster) V.roster.touch(p.id, t); ensureRemote(p.id); onInput(p); } break;
      case 'C': if (V.role === 'host') { if (V.roster) V.roster.touch(p.id, t); ensureRemote(p.id); onCommand(p); } break;
      case 'Q': if (V.role === 'host') V.rep.requestKey(true); break;
      case 'B': onBye(p); break;
    }
  }

  function ensureRemote(id) {
    if (V.remotes[id] || !V.roster || V.term < 1) return;
    var peer = V.roster.get(id);
    if (!peer || humans() >= MAX_HUMANS) return;
    addRemote(id, peer.name || 'Hráč', peer.color || '#f2b84b');
    V.rep.requestKey(true);
  }

  function onHello(p, t) {
    if (!V.roster) return;
    var isNew = V.roster.hello({ id: p.id, name: p.nm, joinedAt: p.ja }, t);
    var peer = V.roster.get(p.id);
    if (peer && typeof p.co === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.co)) peer.color = p.co;
    if (isNew && V.open && t - V.lastHello > 250) sendHello();            // nový hráč se tak dozví, kdo tu je
    if (V.role === 'host' && V.term > 0) { ensureRemote(p.id); if (isNew) V.rep.requestKey(true); }
  }

  function onBye(p) {
    if (V.roster) V.roster.remove(p.id);
    if (V.role === 'host') dropRemote(p.id, 'bye');
    else if (p.id === V.hostId) V.hostSeen = V.clock() - SILENT_MS - 1;     // hostitel odešel: převzetí proběhne hned
  }

  function onSnapshot(p, t) {
    var term = p.tm | 0, joined = Number(p.ja) || 0;
    if (V.roster) V.roster.touch(p.id, t);
    if (V.role === 'host') {
      // druhý hostitel: vyšší období vyhrává, při shodě dřív příchozí (předběžný hostitel bez období vždy ustoupí tomu, kdo už období má)
      if (term > V.term || (term === V.term && term > 0 && beats(joined, p.id, V.joinedAt, ME.id))) becomeGuest(p.id, term, joined);
      else return;
    } else if (V.hostId !== p.id) {
      if (term > V.hostTerm || (term === V.hostTerm && beats(joined, p.id, V.hostJoined, V.hostId))) {
        V.hostId = p.id; V.hostTerm = term; V.hostJoined = joined; V.mirror = newMirror(); clearLocalWorld(); send({ k: 'Q' }, true);
      } else return;
    }
    V.hostSeen = t; V.hostTerm = Math.max(V.hostTerm, term); V.hn = p.hn | 0;
    if (Array.isArray(p.ev)) p.ev.forEach(onEvent);
    var res = V.mirror.apply(p, t);
    if (res.unknown && t - V.lastAsk > 1000) { V.lastAsk = t; send({ k: 'Q' }, true); }
  }

  // Události od hostitele: řádek v přehledu, hláška, kdo mě zničil, výsledek kola
  function onEvent(e) {
    if (!Array.isArray(e)) return;
    if (e[0] === 'f' && typeof e[1] === 'string') feed(e[1].slice(0, 80), false);
    else if (e[0] === 'b' && typeof e[1] === 'string') banner(e[1].slice(0, 90), typeof e[2] === 'string' ? e[2] : 'info');
    else if (e[0] === 'x') { if (e[1] === player.id) V.killer = typeof e[2] === 'string' ? e[2].slice(0, 14) : ''; }
    else if (e[0] === 'w') onRoundResult(typeof e[1] === 'string' ? e[1] : '', typeof e[2] === 'string' ? e[2].slice(0, 14) : '');
  }

  // Jednou za 100 ms: kdo je ve hře, přechody rolí, zprávy "jsem tu"
  function netTick() {
    if (!V.started || !V.open) return;
    var t = V.clock();
    if (t - V.lastHello >= HELLO_EVERY) sendHello();
    var gone = V.roster.expire(t);
    gone.forEach(function (id) { if (V.role === 'host') dropRemote(id, 'lost'); });
    // předběžný hostitel bez nikoho jiného se po chvíli stane skutečným (období 1); do té doby by ho vystřídal každý, kdo už období má
    if (V.role === 'host' && V.term === 0 && t - V.openedAt > HELLO_WAIT) becomeHost(1);
    // hostitel ztichl: převzetí
    if (V.role === 'guest' && V.hostSeen && t - V.hostSeen > SILENT_MS) {
      V.roster.remove(V.hostId);
      var next = V.roster.hostId();
      if (next === ME.id) becomeHost(V.hostTerm + 1);
      else { V.hostId = next; V.hostSeen = t; V.hostTerm = V.hostTerm + 1; V.hostJoined = (V.roster.get(next) || {}).joinedAt || 0; }
    }
  }

  // ---------- Režim "Sdílená aréna" ----------
  MODES.arena = {
    name: 'Sdílená aréna', tag: 'Online', diff: false, noBoss: true, noEvents: true,
    info: 'Jedna aréna pro všechny hráče, boti uvolňují místa.',
    setup: function (D) { spawnBots({ bots: botsWanted(humans()), start: D.start }); },
    tick: function () {
      V.botT -= STEP;
      if (V.botT <= 0) { V.botT = 1; reconcileBots(); roundTick(); }
    },
    hud: function () { return '<span>Kolo ' + fmtTime(roundLeft(now()) / 1000) + '</span><small>hráčů ' + humans() + ' z ' + SLOTS + '</small>'; },
    onKill: function (k, t) {
      if (V.role !== 'host' || !(t === player || t.remote)) return;
      V.evq.push(['x', t.id, k ? k.name : '']);
    },
  };

  function patchGame() {
    var baseHurt = hurt, baseBot = botControl, baseRespawn = respawnBot, baseZones = genZones, baseMove = moveTank, baseUpdate = update, baseFeed = feed,
      baseBuy = buyStat, baseClass = chooseClass, basePerk = choosePerk, baseDash = dash, baseStart = startGame;
    hurt = function (t, amt, src, quiet) {
      if (V.role === 'guest') return false;                       // zdraví určuje hostitel
      return baseHurt(t, amt, src, quiet);
    };
    botControl = function (b, dt) { if (b.remote) { controlRemote(b); return; } return baseBot(b, dt); };
    moveTank = function (t, dt) { if (t.remote) { remoteMove(t, dt); return; } return baseMove(t, dt); };
    respawnBot = function (t) { if (t.remote) { t.respawnT = 1e9; return; } return baseRespawn(t); };
    genZones = function () {
      var orig = Math.random;
      Math.random = mulberry32(ZONE_SEED);
      try { baseZones(); } finally { Math.random = orig; }
    };
    // řádky přehledu hostitele vidí i ostatní
    feed = function (msg, mine) { baseFeed(msg, mine); if (V.role === 'host' && V.open && V.started) V.evq.push(['f', msg]); };
    // příkazy hosta jdou hostiteli (a platí hned i u mě, ať odezva nic nestojí; hostitel pak pošle skutečný stav)
    buyStat = function (t, i) { var r = baseBuy(t, i); if (r && V.role === 'guest' && t === player) send({ k: 'C', c: 'buy', i: i }, true); return r; };
    chooseClass = function (t, id) { baseClass(t, id); if (V.role === 'guest' && t === player) send({ k: 'C', c: 'cls', v: id }, true); };
    choosePerk = function (t, id) { basePerk(t, id); if (V.role === 'guest' && t === player) send({ k: 'C', c: 'perk', v: id }, true); };
    dash = function (t) { var r = baseDash(t); if (r && V.role === 'guest' && t === player) send({ k: 'C', c: 'dash' }, true); return r; };
    // znovuzrození hosta: hostitel vybere místo a pošle ho; do té doby host čeká (pohled na ostatní)
    startGame = function (fresh) {
      if (V.role === 'guest' && V.started && state === 'dead') {
        V.respawning = V.clock(); state = 'play'; ui.spec = null; ui.offerKey = '#';
        elDead.classList.add('hidden'); elHud.classList.remove('hidden'); elFeed.replaceChildren(); feedItems.length = 0;
        send({ k: 'C', c: 'respawn' }, true);
        return;
      }
      return baseStart(fresh);
    };
    update = function (dt) {
      if (!V.started) return baseUpdate(dt);
      if (V.role === 'guest') { guestUpdate(dt); return; }
      baseUpdate(dt);
      if (V.open && V.term > 0) hostSend();
    };
    // v online aréně se nepauzuje a z arény se odchází přes křížek v liště appky
    setPause = function () { /* ostatní hráči běží dál */ };
    toMenu = function () { try { MP.close(); } catch (e) { /* appka arénu zavře sama */ } };
  }

  function start() {
    patchGame();
    // Rovné podmínky pro všechny hráče (hostitel i hosté, boti taky): žádné bonusy hráči, stejné zkušenosti a zranění od botů i tvarů
    DIFFS.arena = Object.assign({}, DIFFS.normal, { playerHp: 1, playerRegen: 1, xpMul: 1, botXp: 1, botDmg: 1, shapeDmg: 1 });
    mode = 'arena'; diffKey = 'arena';
    var nm = String(ME.name || 'Ty').slice(0, 14);
    elName.value = nm;
    V.started = true;
    V.joinedAt = now();
    V.roster = new Net.Roster({ id: ME.id, name: nm, joinedAt: V.joinedAt }, { silentMs: SILENT_MS });
    V.rep = new Net.Replicator(kindsHost(), { keyEvery: KEY_EVERY });
    V.mirror = newMirror();
    startGame(true);
    player.name = nm;                        // jméno účtu (hra by si ho jinak vzala z pole v sólovém menu)
    takeSnapshot();
    document.documentElement.classList.add('mp');
    var st = document.createElement('style');
    st.textContent = 'html.mp #pauseBtn{display:none!important}';
    document.head.appendChild(st);
    MP.on('rt', function (d) { onMessage(d && d.p); });
    MP.on('rt-status', function (d) {
      if (d.status === 'open') { V.open = true; V.openedAt = V.clock(); V.joinedAt = now(); V.roster.me.joinedAt = V.joinedAt; sendHello(); }
      else if (d.status === 'down') V.open = false;
      else if (d.status === 'error') { banner('Spojení s ostatními hráči se nepodařilo navázat. Hraješ sám s boty.', 'info'); becomeHost(1); }
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
    window.addEventListener('pagehide', function () { send({ k: 'B' }, true); });
    V.timer = setInterval(netTick, 100);
  }

  window.__arenaMp.becomeHost = becomeHost;
  window.__arenaMp.becomeGuest = becomeGuest;
  window.__arenaMp.onMessage = onMessage;
  window.__arenaMp.netTick = netTick;
  window.__arenaMp.humans = humans;
  window.__arenaMp.kindsHost = kindsHost;

  document.addEventListener('DOMContentLoaded', start);
})();
