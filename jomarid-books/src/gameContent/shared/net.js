/* net.js - společný základ pro hry, které sdílejí jeden svět mezi hráči (Rocket, Polygon aréna). Vkládá se do dokumentu hry před jejím mp.js
   a nabízí window.JomaridNet. Nic nedělá samo: hra si z něj bere stavební kameny.

   Jak to funguje: jeden hráč (hostitel) počítá celý svět (nepřátele, boty, střely, bonusy), ostatní (hosté) posílají jen vstupy a od hostitele dostávají
   obraz světa. Díky tomu mají všichni opravdu totéž. Aby se obraz nesekal a nestál moc zpráv, posílá se způsobem "odhad podle rychlosti":
   hostitel pošle polohu a rychlost entity a znovu ji pošle, až když se skutečnost od odhadu hosta rozejde víc než o toleranci (nebo po delší době).
   Host mezitím entitu sám posouvá podle rychlosti a při opravě se k nové poloze plynule přibližuje, takže nic neskáče.

   Součásti:
     Replicator  strana hostitele: z polí entit ve hře sestaví zprávu s tím, co se změnilo (nové, opravené, zmizelé).
     Mirror      strana hosta: zprávy skládá do tabulky entit a vrací jejich vyhlazenou polohu v daném čase.
     Roster      kdo je ve hře a kdo by měl být hostitel, když hostitel vypadne (nejdřív příchozí). Kdo hostitelem skutečně je, rozhoduje číslo období (term):
               každé převzetí ho zvýší a vyšší období vyhrává, takže se vrátivší starý hostitel (třeba po uspání karty) nikoho nepřeskočí.
     tween       pomocná funkce pro plynulé přiblížení.
   Skript je schválně v ES5 a bez závislostí (jde zkoušet samostatně v Node). */
(function (root) {
  'use strict';

  function hyp(a, b) { return Math.sqrt(a * a + b * b); }

  // ---------- Replicator (hostitel) ----------
  // kinds: { jméno: { list(): pole entit, id(e): číslo, state(e): [x, y, vx, vy, ...další], info(e): JSON o tom, co se nemění (jen při vzniku a při změně infoSig),
  //                   infoSig(e): text, který se změní, když se má info poslat znovu (nepovinné), always: posílat každý krok (tanky), tol: tolerance polohy,
  //                   vtol: tolerance rychlosti, refresh: nejdelší doba bez zprávy v ms, dev(st, last, dt): true, když se má poslat i kvůli dalším polím (nepovinné) } }
  // build(now) vrací zprávu {n, key, full, K: {jméno: {a: [[id, stav, info?]], d: [id]}}} nebo null, když není co poslat.
  // Každých keyEvery ms je to "klíčová" zpráva se stavem všech entit (host podle ní odstraní, co už neexistuje); full = klíčová i s info (pro nově příchozí).
  function Replicator(kinds, opt) {
    opt = opt || {};
    var keyEvery = opt.keyEvery || 4000;
    var book = {}, name;
    for (name in kinds) if (Object.prototype.hasOwnProperty.call(kinds, name)) book[name] = new Map();
    var seq = 0, lastKey = -1e12, wantKey = false, wantFull = false;
    this.requestKey = function (full) { wantKey = true; if (full) wantFull = true; };
    this.reset = function () { for (var k in book) book[k].clear(); lastKey = -1e12; };
    this.build = function (now) {
      var key = wantKey || now - lastKey >= keyEvery, full = wantFull;
      if (key) { lastKey = now; wantKey = false; wantFull = false; }
      var pkt = { n: ++seq, key: key ? 1 : 0, K: {} }, any = false;
      if (full) pkt.full = 1;
      for (var kind in kinds) {
        if (!Object.prototype.hasOwnProperty.call(kinds, kind)) continue;
        var cfg = kinds[kind], bk = book[kind], list = cfg.list(), seen = new Set(), adds = [], dels = [];
        var tol = cfg.tol === undefined ? 4 : cfg.tol, vtol = cfg.vtol === undefined ? 30 : cfg.vtol, refresh = cfg.refresh || 1500;
        for (var i = 0; i < list.length; i++) {
          var e = list[i], id = cfg.id(e);
          seen.add(id);
          var st = cfg.state(e), rec = bk.get(id), sig = cfg.infoSig ? cfg.infoSig(e) : '', send = false, withInfo = false;
          if (!rec) { send = true; withInfo = true; }
          else {
            if (key || cfg.always) send = true;
            else {
              var dt = (now - rec.t) / 1000, ex = rec.st[0] + rec.st[2] * dt, ey = rec.st[1] + rec.st[3] * dt;
              if (hyp(st[0] - ex, st[1] - ey) > tol || hyp(st[2] - rec.st[2], st[3] - rec.st[3]) > vtol || now - rec.t > refresh || (cfg.dev && cfg.dev(st, rec.st, dt))) send = true;
            }
            if (cfg.infoSig && sig !== rec.sig) { withInfo = true; send = true; }
            if (full) withInfo = true;
          }
          if (send) {
            adds.push(withInfo ? [id, st, cfg.info(e)] : [id, st]);
            bk.set(id, { st: st, t: now, sig: sig });
          }
        }
        bk.forEach(function (r, id) { if (!seen.has(id)) { dels.push(id); bk.delete(id); } });
        if (adds.length || dels.length) {
          var sec = {};
          if (adds.length) sec.a = adds;
          if (dels.length) sec.d = dels;
          pkt.K[kind] = sec; any = true;
        }
      }
      return any || key ? pkt : null;
    };
  }

  // ---------- Mirror (host) ----------
  // hooks: { add(kind, id, info, st): vytvoří entitu ve hře a vrátí ji, upd(kind, id, obj, st, info): nový stav (volitelné), remove(kind, id, obj): entita zmizela,
  //          need(): zpráva se stavem entity, kterou host nezná (nepřišlo její info): host si má vyžádat úplnou zprávu }
  // Mirror drží ke každé entitě poslední stav a čas jeho příchodu (v hodinách hosta, ne hostitele: hodiny zařízení se liší o vteřiny).
  function Mirror(kinds, hooks) {
    hooks = hooks || {};
    var tbl = {}, tau = 130, maxExtra = 0.6;
    for (var k in kinds) if (Object.prototype.hasOwnProperty.call(kinds, k)) tbl[k] = new Map();
    this.tau = function (v) { if (v) tau = v; return tau; };
    this.table = function (kind) { return tbl[kind]; };
    this.size = function (kind) { return tbl[kind] ? tbl[kind].size : 0; };
    // Poloha vyhlazená a odhadnutá do času now: poslední stav + rychlost krát stáří (nejvýš maxExtra s, pak entita stojí) + zbytek chyby, který se plynule ztrácí
    function pos(rec, now, out) {
      var age = now - rec.t, dt = Math.min(age / 1000, maxExtra), f = Math.exp(-age / tau);
      out = out || {};
      out.x = rec.st[0] + rec.st[2] * dt + rec.ox * f;
      out.y = rec.st[1] + rec.st[3] * dt + rec.oy * f;
      return out;
    }
    this.pos = pos;
    var scratch = {};
    this.apply = function (pkt, now) {
      if (!pkt || typeof pkt !== 'object' || !pkt.K) return { unknown: 0 };
      var unknown = 0;
      if (pkt.key) for (var kz in tbl) tbl[kz].forEach(function (r) { r.seen = 0; });      // klíčová zpráva obsahuje všechny entity: co v ní nebude, zanikne
      for (var kind in pkt.K) {
        var m = tbl[kind];
        if (!m || !Object.prototype.hasOwnProperty.call(pkt.K, kind)) continue;
        var sec = pkt.K[kind], a = sec.a || [], d = sec.d || [], i;
        for (i = 0; i < a.length; i++) {
          var row = a[i], id = row[0], st = row[1], info = row[2];
          if (!Array.isArray(st) || st.length < 4) continue;
          var rec = m.get(id);
          if (!rec) {
            if (info === undefined) { unknown++; continue; }          // nezná ji a nemá, jak ji vytvořit: počká na úplnou zprávu
            rec = { id: id, st: st, info: info, t: now, ox: 0, oy: 0, seen: 1, obj: null };
            rec.obj = hooks.add ? hooks.add(kind, id, info, st) : null;
            m.set(id, rec);
          } else {
            var before = pos(rec, now, scratch);
            rec.ox = before.x - st[0]; rec.oy = before.y - st[1];
            if (Math.abs(rec.ox) > 500 || Math.abs(rec.oy) > 500) { rec.ox = 0; rec.oy = 0; }   // velký skok (znovuzrození, přenos): nepřibližovat, rovnou přeskočit
            rec.st = st; rec.t = now; rec.seen = 1;
            if (info !== undefined) rec.info = info;
            if (hooks.upd) hooks.upd(kind, id, rec.obj, st, info);
          }
        }
        for (i = 0; i < d.length; i++) {
          var dr = m.get(d[i]);
          if (dr) { if (hooks.remove) hooks.remove(kind, d[i], dr.obj, dr); m.delete(d[i]); }
        }
      }
      if (pkt.key) {
        for (var kn in tbl) {
          var mm = tbl[kn], gone = [];
          mm.forEach(function (r, rid) { if (!r.seen) gone.push(rid); });
          for (var g = 0; g < gone.length; g++) { var gr = mm.get(gone[g]); if (hooks.remove) hooks.remove(kn, gone[g], gr.obj, gr); mm.delete(gone[g]); }
        }
      }
      return { unknown: unknown };
    };
    this.clear = function () {
      for (var kind in tbl) {
        var m = tbl[kind];
        m.forEach(function (r, id) { if (hooks.remove) hooks.remove(kind, id, r.obj, r); });
        m.clear();
      }
    };
  }

  // ---------- Roster: kdo je ve hře a kdo je hostitel ----------
  // Hostitelem je ten, kdo přišel nejdřív (joinedAt, čas serveru z appky; při shodě menší id). Když z hostitele nic nepřijde silentMs, vypadne ze seznamu a převezme další.
  function Roster(me, opt) {
    opt = opt || {};
    var silentMs = opt.silentMs || 4000, peers = new Map();
    me = { id: me.id, name: me.name, joinedAt: me.joinedAt, seen: 0, self: true };
    peers.set(me.id, me);
    this.me = me;
    this.get = function (id) { return peers.get(id) || null; };
    this.ids = function () { var out = []; peers.forEach(function (p, id) { out.push(id); }); return out; };
    this.list = function () { var out = []; peers.forEach(function (p) { out.push(p); }); return out; };
    this.size = function () { return peers.size; };
    // Zpráva o hráči (hello): přidá ho, nebo obnoví. Vrací true, když je nový.
    this.hello = function (p, now) {
      if (!p || typeof p.id !== 'string' || p.id === me.id) return false;
      var cur = peers.get(p.id), isNew = !cur;
      if (!cur) { cur = { id: p.id, seen: now }; peers.set(p.id, cur); }
      cur.name = typeof p.name === 'string' ? p.name.slice(0, 24) : cur.name || '';
      cur.joinedAt = typeof p.joinedAt === 'number' && isFinite(p.joinedAt) ? p.joinedAt : (cur.joinedAt || now);
      cur.seen = now;
      return isNew;
    };
    this.touch = function (id, now) { var p = peers.get(id); if (p && !p.self) p.seen = now; return !!p; };
    this.remove = function (id) { if (id !== me.id) return peers.delete(id); return false; };
    // Odstraní hráče, od kterých nic nepřišlo; vrací jejich id
    this.expire = function (now) {
      var gone = [];
      peers.forEach(function (p, id) { if (!p.self && now - p.seen > silentMs) gone.push(id); });
      for (var i = 0; i < gone.length; i++) peers.delete(gone[i]);
      return gone;
    };
    // Kdo má být hostitel: nejdřív příchozí ze všech známých (bez excludeId, třeba bez hostitele, který přestal odpovídat)
    this.hostId = function (excludeId) {
      var best = null;
      peers.forEach(function (p) {
        if (p.id === excludeId) return;
        if (!best || p.joinedAt < best.joinedAt || (p.joinedAt === best.joinedAt && p.id < best.id)) best = p;
      });
      return best ? best.id : me.id;
    };
    this.isHost = function (excludeId) { return this.hostId(excludeId) === me.id; };
  }

  // ---------- Výkon zařízení a volba hostitele ----------
  // Krátká zkouška rychlosti (asi 120 ms smyčky s počítáním): víc znamená silnější zařízení. Používá se jen pro volbu hostitele a varování, nic neodemyká.
  function bench() {
    var t0 = Date.now(), n = 0, x = 1;
    while (Date.now() - t0 < 120) { for (var i = 0; i < 1500; i++) x = (x * 1.0000003 + Math.sin(i)) % 997; n++; }
    return Math.max(1, Math.round(n + (x < -1e9 ? 1 : 0)));
  }
  // Kdo má být hostitel: obě zařízení mají k dispozici stejná dvě čísla (zkouška místa 1 a místa 2), takže rozhodnou stejně. Silnější zařízení (aspoň o čtvrtinu) vyhrává, jinak
  // zůstává hostitelem místo 1. Vrací 1 nebo 2 (číslo místa hostitele).
  function pickHostSlot(score1, score2) {
    var a = +score1 || 0, b = +score2 || 0;
    if (a > 0 && b > 0) { if (b >= a * 1.25) return 2; if (a >= b * 1.25) return 1; }
    return 1;
  }

  // ---------- Paralelní výpočet (lockstep): obě zařízení počítají tutéž hru ----------
  // Oba hráči počítají hru ze stejného semínka a posílají si jen vstupy. Hra se posune o jeden snímek, až když jsou známé vstupy obou hráčů pro ten snímek
  // (každý hráč se zaváže: "do snímku hz se můj vstup nezmění"). Vstup, který hráč zadá teď, se projeví o `delay` snímků později, ať stihne dorazit.
  // Čas od času si strany vymění otisk stavu (hash zaokrouhlených čísel): kdo si stav upraví, přestane se s druhým shodovat a obě hry to poznají (onDesync).
  // Zaokrouhlení otisku a vlastní náhoda (rng) jsou proto, aby malé rozdíly v desetinných číslech na různých zařízeních nevyvolaly planý poplach.
  function rng(seed) {                                  // mulberry32: stejná posloupnost na každém zařízení
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Otisk pole čísel a textů: každé číslo se zaokrouhlí na `prec` desetinných míst (výchozí 1), pak se spojí a zahashuje (FNV-1a, 32 bitů).
  function stateHash(values, prec) {
    var k = Math.pow(10, prec === undefined ? 1 : prec), h = 0x811C9DC5, str = '';
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      str += (typeof v === 'number' ? (isFinite(v) ? Math.round(v * k) : 'x') : String(v)) + ',';
    }
    for (var j = 0; j < str.length; j++) { h ^= str.charCodeAt(j); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  // opt: { me: 0|1 (kdo jsem: číslo hráče ve hře), delay: zpoždění vstupu ve snímcích (výchozí 6), hashEvery: po kolika snímcích se porovná otisk (výchozí 60),
  //        empty: vstup, který platí na začátku, step(frame, inputs): posune hru o jeden snímek (inputs[0], inputs[1]), hash(): pole čísel ze stavu hry,
  //        send(msg): pošle zprávu druhému, onDesync(frame, mine, theirs): otisky se po snímku `frame` nerovnají, maxLead: kolik snímků smí jít hra před posledním známým (nepovinné) }
  function Lockstep(opt) {
    var me = opt.me | 0, other = 1 - me, delay = opt.delay === undefined ? 6 : opt.delay, hashEvery = opt.hashEvery || 60;
    var frame = 0, tl = [[{ f: 0, i: opt.empty }], [{ f: 0, i: opt.empty }]];      // časová osa vstupů obou hráčů: od snímku f platí vstup i
    var horizon = [delay, delay];                                // do jakého snímku (bez něj) je vstup hráče jistý: na začátku oba znají prázdný vstup pro prvních `delay` snímků
    var hashes = {}, desync = false;
    this.frame = function () { return frame; };
    this.desynced = function () { return desync; };
    function inputAt(p, f) { var a = tl[p], r = a[0].i; for (var i = 0; i < a.length && a[i].f <= f; i++) r = a[i].i; return r; }
    function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
    // Můj aktuální vstup (volá se každý vykreslený snímek). Projeví se ve snímku frame + delay.
    this.local = function (input) {
      var f = frame + delay, a = tl[me];
      if (a.length === 0 || !same(a[a.length - 1].i, input)) a.push({ f: f, i: input });
      horizon[me] = Math.max(horizon[me], f + 1);
      this.heartbeat(a[a.length - 1].f === f ? input : null);
    };
    this.heartbeat = function (changed) {
      opt.send({ k: 'ls', f: changed ? frame + delay : null, i: changed, hz: horizon[me] });
    };
    this.receive = function (m) {
      if (!m || m.k !== 'ls') {
        if (m && m.k === 'lh' && typeof m.f === 'number') { var mine = hashes[m.f]; if (mine !== undefined && mine !== m.h && !desync) { desync = true; if (opt.onDesync) opt.onDesync(m.f, mine, m.h); } else if (mine === undefined) hashes['p' + m.f] = m.h; }
        return;
      }
      if (m.i !== null && m.i !== undefined && typeof m.f === 'number') { var a = tl[other]; if (a.length === 0 || a[a.length - 1].f < m.f) a.push({ f: m.f, i: m.i }); }
      if (typeof m.hz === 'number' && m.hz > horizon[other]) horizon[other] = m.hz;
    };
    // Posune hru o všechny snímky, které jsou už jisté; vrací počet provedených kroků (max `limit`, ať se nezasekne vykreslování).
    this.tick = function (limit) {
      var n = 0, lim = limit || 8;
      while (n < lim && frame < horizon[me] && frame < horizon[other]) {
        var ins = [null, null]; ins[me] = inputAt(me, frame); ins[other] = inputAt(other, frame);
        opt.step(frame, ins);
        frame++; n++;
        if (frame % hashEvery === 0) {
          var h = stateHash(opt.hash()); hashes[frame] = h;
          opt.send({ k: 'lh', f: frame, h: h });
          var ph = hashes['p' + frame];
          if (ph !== undefined && ph !== h && !desync) { desync = true; if (opt.onDesync) opt.onDesync(frame, h, ph); }
        }
      }
      return n;
    };
  }

  // Plynulé přiblížení hodnoty k cíli (tau v sekundách): pro opravu vlastního tanku podle hostitele
  function tween(cur, target, dt, tau) { return cur + (target - cur) * (1 - Math.exp(-dt / tau)); }

  // Zaokrouhlení pro zprávy (kratší text)
  function q1(v) { return Math.round(v * 10) / 10; }
  function q2(v) { return Math.round(v * 100) / 100; }

  root.JomaridNet = { Replicator: Replicator, Mirror: Mirror, Roster: Roster, tween: tween, q1: q1, q2: q2, bench: bench, pickHostSlot: pickHostSlot, rng: rng, stateHash: stateHash, Lockstep: Lockstep };
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
