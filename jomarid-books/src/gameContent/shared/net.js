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

  // Plynulé přiblížení hodnoty k cíli (tau v sekundách): pro opravu vlastního tanku podle hostitele
  function tween(cur, target, dt, tau) { return cur + (target - cur) * (1 - Math.exp(-dt / tau)); }

  // Zaokrouhlení pro zprávy (kratší text)
  function q1(v) { return Math.round(v * 10) / 10; }
  function q2(v) { return Math.round(v * 100) / 100; }

  root.JomaridNet = { Replicator: Replicator, Mirror: Mirror, Roster: Roster, tween: tween, q1: q1, q2: q2 };
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
