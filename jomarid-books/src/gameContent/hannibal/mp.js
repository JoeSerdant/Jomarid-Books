/* mp.js - online souboj armád v Hannibalovi (multiplayer). Hra se spustí s rozhraním window.jomaridMP z appky (src/mp); bez něj se tenhle soubor jen
   načte a nic nedělá.

   Pravidla souboje: oba hráči mají stejně velkou armádu se stejným složením (malá, střední nebo velká podle volby před zápasem), na náhodné mapě, která se
   z čísla zápasu vygeneruje u obou stejně a je zrcadlově souměrná, takže žádná strana nemá výhodu v terénu. Armády stojí proti sobě, střídají se po tazích:
   hráč na tahu hýbe a útočí jednotkami, jak je zvyklý z bitev kampaně (stejné ovládání, stejná pravidla boje, morálka, zákryty a boky), a tah ukončí.
   Vyhrává ten, kdo zničí soupeřovu armádu nebo jeho velitele (Hannibalova garda); po posledním kole rozhodne zbylé zdraví armády.

   Jak se to drží pohromadě: oba prohlížeče počítají celou bitvu samy a stejně (hra není náhodná, protože hody kostkou při útoku se losují z čísla zápasu,
   kola a pořadí akce). Na server se proto posílá jen seznam akcí jednoho tahu {t:'turn', k: pořadí tahu, a: [[akce]...], h: otisk stavu, e: konec}
   a soupeřův prohlížeč ho přehraje na své kopii bitvy (po jednotkách, s animací, jde přeskočit klepnutím). Otisk stavu po tahu slouží ke kontrole, že obě
   strany vidí totéž. Rozehraný zápas se po obnovení stránky složí přehráním všech tahů od začátku, takže se nic neukládá.

   O čase na tah a odměně rozhoduje server (db/multiplayer.sql). Cheat kódy appka v online zápase vypíná. */
(function () {
  var MP = window.jomaridMP && window.jomaridMP.enabled ? window.jomaridMP : null;
  if (!MP) return;
  document.body.classList.add('mp');

  var COLS = 12, ROWS = 8;
  var SLOT = MP.init.slot === 2 ? 2 : 1;
  var FRONT = { carthage_spearmen: 1, libyan_heavy: 1, celtiberian_swordsman: 1, elephants: 1 };   // v přední řadě stojí těžká pěchota a sloni, ostatní za nimi
  // Velikosti armád: stejné pro oba, velitel je v každé. Kol je tolik, aby se bitva stihla dohrát, ale nešla donekonečna.
  var PRESETS = {
    small:  { title: 'Malá armáda', rounds: 10, army: ['hannibal', 'carthage_spearmen', 'numidian_cavalry', 'balearic_sling', 'celtiberian_swordsman'] },
    medium: { title: 'Střední armáda', rounds: 12, army: ['hannibal', 'carthage_spearmen', 'carthage_spearmen', 'numidian_cavalry', 'numidian_cavalry', 'balearic_sling', 'elephants', 'celtiberian_swordsman'] },
    large:  { title: 'Velká armáda', rounds: 14, army: ['hannibal', 'carthage_spearmen', 'carthage_spearmen', 'carthage_spearmen', 'libyan_heavy', 'numidian_cavalry', 'numidian_cavalry', 'balearic_sling', 'balearic_sling', 'elephants', 'elephants', 'celtiberian_swordsman'] },
  };
  var preset = PRESETS[MP.init.params && MP.init.params.preset] || PRESETS.medium;
  // Jména jednotek, kterých je v armádě víc: s pořadím, ať se v deníku dají rozlišit (celé texty, aby šly přeložit do angličtiny)
  var NUMBERED = {
    carthage_spearmen: ['1. Africká Falanx', '2. Africká Falanx', '3. Africká Falanx'],
    numidian_cavalry: ['1. Numidská jízda', '2. Numidská jízda'],
    balearic_sling: ['1. Baleárští prakovníci', '2. Baleárští prakovníci'],
    elephants: ['1. Bojoví sloni', '2. Bojoví sloni'],
  };

  var V = { eng: null, proto: null, ply: 0, started: -1, cur: null, replaying: false, busy: false, synced: false, early: [], queue: [], ended: null, pending: null, view: null, desync: false };

  // ---------- Pomocné funkce (bez závislosti na hře, jdou zkoušet samostatně) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mix(a, b, c) {   // 32bitový otisk tří čísel
    var h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA6B) ^ Math.imul((c | 0) + 0x165667B1, 0xC2B2AE35)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 12;
    return h >>> 0;
  }

  // Rozmístění n jednotek do osmi řádků rovnoměrně
  function spreadRows(n) {
    var rows = [];
    for (var i = 0; i < n; i++) rows.push(Math.min(ROWS - 1, Math.max(0, Math.round((i + 0.5) * ROWS / n - 0.5))));
    return rows;
  }

  // Náhodná mapa z čísla zápasu. Zrcadlově souměrná podle svislé osy (sloupec x má stejný terén jako 11 - x), takže žádná strana nemá lepší terén.
  // Rozestavení armád (sloupce 0 až 2 a 9 až 11) zůstává rovinou. Mapa musí být průchodná, jinak se losuje znovu.
  function buildTerrain(seed) {
    var last = null;
    for (var attempt = 0; attempt < 30; attempt++) {
      var rnd = mulberry32(mix(seed, attempt, 7));
      var map = {};
      var put = function (x, y, type) { if (x < 3 || x > 5 || y < 0 || y >= ROWS) return; map[x + ',' + y] = type; map[(COLS - 1 - x) + ',' + y] = type; };
      var kinds = ['hill', 'hill', 'forest', 'forest', 'snow'];
      var clusters = 3 + Math.floor(rnd() * 3);
      for (var i = 0; i < clusters; i++) {
        var type = kinds[Math.floor(rnd() * kinds.length)];
        var cx = 3 + Math.floor(rnd() * 3), cy = Math.floor(rnd() * ROWS);
        var size = 1 + Math.floor(rnd() * 4);
        for (var s = 0; s < size; s++) {
          put(cx, cy, type);
          cx += Math.floor(rnd() * 3) - 1; cy += Math.floor(rnd() * 3) - 1;
          cx = Math.min(5, Math.max(3, cx)); cy = Math.min(ROWS - 1, Math.max(0, cy));
        }
      }
      if (rnd() < 0.55) {   // nepřekonatelné skály: pár osamělých polí uprostřed
        var rocks = 2 + Math.floor(rnd() * 3);
        for (var r = 0; r < rocks; r++) put(4 + Math.floor(rnd() * 2), Math.floor(rnd() * ROWS), 'cliff');
      }
      if (rnd() < 0.35) {   // dvoupolní řeka uprostřed se dvěma brody, každý v jedné polovině mapy
        var f1 = 1 + Math.floor(rnd() * 2), f2 = 5 + Math.floor(rnd() * 2);
        for (var y = 0; y < ROWS; y++) { var t = (y === f1 || y === f2) ? 'ford' : 'river'; map['5,' + y] = t; map['6,' + y] = t; }
      }
      last = map;
      if (connected(map)) return map;
    }
    return {};   // pojistka: bez překážek je mapa vždy průchodná
  }

  // Dá se projít po průchodných polích ze sloupce 2 do sloupce 9 (jízdou na čtyři strany)?
  function connected(map) {
    var blocked = function (x, y) { var t = map[x + ',' + y]; return t === 'river' || t === 'cliff' || t === 'wall'; };
    var seen = {}, queue = [];
    for (var y = 0; y < ROWS; y++) { seen['2,' + y] = true; queue.push([2, y]); }
    while (queue.length) {
      var p = queue.shift();
      if (p[0] === 9) return true;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = p[0] + d[0], ny = p[1] + d[1], k = nx + ',' + ny;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS || seen[k] || blocked(nx, ny)) return;
        seen[k] = true; queue.push([nx, ny]);
      });
    }
    return false;
  }

  // Armáda jedné strany: seznam {id, type, x, y} ve stálém pořadí (obě strany mají obě armády ve stejném pořadí, na tom stojí shoda výpočtů)
  function armyLayout(slot) {
    var front = [], back = [];
    preset.army.forEach(function (type, i) { (FRONT[type] ? front : back).push({ type: type, i: i }); });
    var out = [];
    var place = function (list, x) {
      var rows = spreadRows(list.length);
      list.forEach(function (e, k) { out[e.i] = { id: 's' + slot + '_' + e.i, type: e.type, x: slot === 1 ? x : COLS - 1 - x, y: rows[k] }; });
    };
    place(front, 2); place(back, 1);
    return out;
  }

  // Otisk stavu bitvy po tahu: pozice, zdraví a morálka všech jednotek. Obě strany mají mít stejný.
  function stateHash(units) {
    var h = 2166136261;
    units.filter(function (u) { return u.hp > 0; }).map(function (u) { return u.id + ':' + u.x + ',' + u.y + ',' + Math.round(u.hp) + ',' + Math.round(u.morale) + (u.routed ? 'r' : ''); })
      .sort().join('|').split('').forEach(function (ch) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; });
    return h >>> 0;
  }

  // Pomocné funkce pro zkoušky (v hře je nikdo nevolá)
  window.__hannibalMp = { V: V, buildTerrain: buildTerrain, armyLayout: armyLayout, stateHash: stateHash, mulberry32: mulberry32, mix: mix, preset: preset, connected: connected };

  // ---------- Hra ----------
  function unitById(id) { for (var i = 0; i < V.eng.units.length; i++) if (V.eng.units[i].id === id && V.eng.units[i].hp > 0) return V.eng.units[i]; return null; }
  function sideOf(slot) { return slot === SLOT ? 'player' : 'enemy'; }
  function oppName() { return (MP.init.opponent && MP.init.opponent.name) || 'Soupeř'; }
  function myTurn() { return !V.ended && V.eng.turn === 'player' && !V.replaying; }
  function slotToMove() { return V.ply % 2 === 0 ? 1 : 2; }

  function note(text, type) { try { V.eng.log(text, type || 'info'); } catch (e) { /* bitva ještě nemá deník */ } }

  // Hody kostkou při útoku: proud náhodných čísel z čísla zápasu, tahu a pořadí akce. Obě strany tak dostanou stejné hody.
  function seeded(k, fn) {
    var orig = Math.random;
    Math.random = mulberry32(mix(MP.init.seed, V.ply * 1000 + k, 99));
    try { return fn(); } finally { Math.random = orig; }
  }

  function loadDuel() {
    var eng = V.eng;
    eng.clearBattleSave();
    eng.meta = new MetaStrategyManager();   // bez odemčených doktrín: všichni bojují se stejnými hodnotami
    eng.meta.playerRoster = [];
    eng.isEndless = false;
    eng.currentScenario = { title: 'Souboj armád' };   // bez id: bitva se neukládá do postupu
    eng.scenarioConf = { terrainMap: buildTerrain(MP.init.seed), rules: {}, objective: 'Znič soupeřovu armádu nebo jeho velitele. Po ' + preset.rounds + '. kole rozhodne zbylé zdraví.' };
    eng.units = [];
    eng.selectedUnit = null; eng.floatingTexts = []; eng.attackEffects = []; eng.shakeUntil = 0;
    // Obě armády ve stálém pořadí (první hráč, druhý hráč), ať jsou výpočty u obou stejné. Moje jednotky jsou vždy modré a hrají za 'player'.
    var counts = {};
    preset.army.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    [1, 2].forEach(function (slot) {
      var seen = {};
      armyLayout(slot).forEach(function (p) {
        seen[p.type] = (seen[p.type] || 0) + 1;
        var label = UNIT_INFO[p.type] ? UNIT_INFO[p.type].label : p.type;
        var name = counts[p.type] > 1 && NUMBERED[p.type] ? NUMBERED[p.type][seen[p.type] - 1] || label : label;
        if (slot !== SLOT) name = `${name} (soupeř)`;
        var team = sideOf(slot);
        var u = makeUnit(p.id, name, p.type, team, p.x, p.y, eng.getUnitStats(p.type, 1, team));
        u.slot = slot; u.level = 1;
        u.facing = slot === 1 ? 'E' : 'W';
        eng.units.push(u);
      });
    });
    eng.turn = slotToMove() === SLOT ? 'player' : 'enemy';
    Game.showScreen('battle-screen');
    eng.resetBattleUiState();
    document.getElementById('battle-title').innerText = `Souboj armád: ${preset.title}`;
    document.getElementById('combat-log').innerHTML = '';
    note(`Souboj začíná: ty proti hráči ${oppName()}. Obě armády jsou stejné a mapa je souměrná.`);
    note('Střídáte se po tazích. Soupeř uvidí tvůj tah, až ho ukončíš. Vyhrává, kdo zničí soupeřovu armádu nebo jeho velitele.');
    if (V.eng.turn === 'player') beginMyPly(); else beginOppPly();
  }

  // Začátek tahu strany: její zlomené jednotky (morálka na nule) utečou, jako na začátku tahu hráče v kampani. Pro každý tah právě jednou
  // (při skládání rozehraného zápasu z historie se začátek tahu nesmí zopakovat), ve stejné podobě, v jaké ho má strana na tahu.
  function ensureStart() {
    if (V.started === V.ply) return;
    V.started = V.ply;
    inFrame(slotToMove() !== SLOT, function () { V.eng.autoFleeRoutedPlayers(); });
  }

  function beginMyPly() {
    var eng = V.eng;
    eng.turn = 'player';
    V.cur = { acts: [] };
    eng.selectedUnit = null; eng.undoState = null; eng.pendingTarget = null; eng.actingUnit = null;
    ensureStart();
    eng.updateUnitDetailCard(null);
    eng.showBanner(`Kolo ${eng.turnNumber} - tvůj tah`);
    eng.render();
  }

  function beginOppPly() {
    var eng = V.eng;
    eng.turn = 'enemy';
    V.cur = null;
    eng.selectedUnit = null; eng.undoState = null; eng.pendingTarget = null; eng.actingUnit = null;
    eng.updateUnitDetailCard(null);
    eng.showBanner('Tah soupeře');
    eng.render();
  }

  // Konec celého kola (po tahu druhého hráče): stavy, morálka, nové kolo. Po posledním kole rozhodne zbylé zdraví.
  function finishRound() {
    var eng = V.eng;
    eng.tickStatuses();
    eng.units.forEach(function (u) { u.hasMoved = false; u.hasActed = false; u._charging = false; });
    eng.turnNumber += 1;
    if (eng.turnNumber > preset.rounds && !V.pending) {
      var hp = [0, 0, 0];
      eng.units.forEach(function (u) { if (u.hp > 0) hp[u.slot] += u.hp; });
      V.pending = { winner: hp[1] === hp[2] ? 0 : hp[1] > hp[2] ? 1 : 2, reason: 'limit' };
    }
  }

  // Kdo prohrál: ten, komu padl velitel nebo kdo nemá žádnou jednotku
  function evaluate() {
    var lost = { 1: false, 2: false }, byCmd = { 1: false, 2: false };
    [1, 2].forEach(function (s) {
      var alive = V.eng.units.filter(function (u) { return u.slot === s && u.hp > 0; });
      var cmd = alive.some(function (u) { return u.type === 'hannibal'; });
      lost[s] = alive.length === 0 || !cmd;
      byCmd[s] = alive.length > 0 && !cmd;
    });
    if (lost[1] && lost[2]) return { winner: 0, reason: 'both' };
    if (lost[1]) return { winner: 2, reason: byCmd[1] ? 'commander' : 'army' };
    if (lost[2]) return { winner: 1, reason: byCmd[2] ? 'commander' : 'army' };
    return null;
  }

  function sendTurn(final) {
    var eng = V.eng, acts = V.cur ? V.cur.acts : [];
    eng.selectedUnit = null; eng.undoState = null; eng.pendingTarget = null; eng.actingUnit = null;
    if (!final && SLOT === 2) finishRound();
    var msg = { t: 'turn', k: V.ply, a: acts, h: stateHash(eng.units), e: (final || V.pending) ? 1 : 0 };
    V.ply += 1;
    V.cur = null;
    var sent = MP.move(msg).then(function () { /* hotovo */ }, function () { note('Tah se nepodařilo odeslat. Zkontroluj připojení.', 'enemy'); });
    if (V.pending) { finishDuel(sent); return; }
    beginOppPly();
  }

  // ---------- Zapisování vlastních akcí (hráč hraje přes běžné ovládání hry, mp.js si je jen pamatuje) ----------
  function patchEngine() {
    var eng = V.eng, proto = V.proto = Object.getPrototypeOf(eng);
    var record = function (a) { if (V.cur && !V.replaying) V.cur.acts.push(a); };
    var afterAction = function () { if (!V.replaying && V.pending && !V.ended) sendTurn(true); };

    eng.moveSelectedTo = function (col, row) {
      var u = this.selectedUnit;
      var r = proto.moveSelectedTo.call(this, col, row);
      if (u) record(['m', u.id, col, row]);
      afterAction();
      return r;
    };
    eng.executeAttack = function (attacker, target, opts) {
      var k = V.cur ? V.cur.acts.length : 0, self = this;
      var r = V.replaying ? proto.executeAttack.call(self, attacker, target, opts) : seeded(k, function () { return proto.executeAttack.call(self, attacker, target, opts); });
      record(['a', attacker.id, target.id]);
      afterAction();
      return r;
    };
    eng.activateAbility = function (unit) {
      var done = unit ? unit.hasActed : true, k = V.cur ? V.cur.acts.length : 0, self = this;
      var r = V.replaying ? proto.activateAbility.call(self, unit) : seeded(k, function () { return proto.activateAbility.call(self, unit); });
      if (unit && !done && unit.hasActed) record(['b', unit.id]);
      afterAction();
      return r;
    };
    eng.undoMove = function () {
      var can = this.canUndo();
      var r = proto.undoMove.call(this);
      if (can) record(['u']);
      return r;
    };
    eng.checkBattleEnd = function () {
      if (V.ended || V.pending) return;
      var res = evaluate();
      if (res) V.pending = res;
    };
    eng.endTurn = function () {
      if (!myTurn()) return;
      sendTurn(false);
    };
    // Hráč vidí dění, i když soupeř právě přemýšlí: klepnutí na jednotku ukáže její údaje (a během přehrávání tahu ho přeskočí)
    var click = proto.handleCanvasClick;
    eng.handleCanvasClick = function (e) {
      if (this.turn === 'enemy' && !V.replaying) {
        var t = this.eventToTile(e), u = this.units.find(function (o) { return o.hp > 0 && o.x === t.col && o.y === t.row; });
        this.updateUnitDetailCard(u || null);
        return;
      }
      return click.call(this, e);
    };
    // Ústup z bitvy je tady vzdání se
    GameCampaign.retreatFromBattle = function () {
      if (V.ended) return;
      if (confirm('Opravdu chceš souboj vzdát? Prohraješ.')) MP.resign().catch(function () { /* konec přijde od serveru */ });
    };
    var back = document.querySelector('#battle-screen .btn-danger');
    if (back) back.innerText = 'Vzdát';
  }

  // ---------- Přehrávání tahu soupeře (a všech tahů od začátku při obnovení stránky) ----------
  // Akce se provádí na kopii bitvy tak, jak ji provedl soupeř ve své: moje a jeho jednotky si na chvíli prohodí strany (jeho je 'player'),
  // takže běží stejný kód a stejné výpočty. Vykreslování se mezitím vypne, ať neproblikne přebarvení.
  function inFrame(theirs, fn) {
    var eng = V.eng;
    if (!theirs) { fn(); return; }
    var savedTurn = eng.turn, protoLog = V.proto.log;
    eng.units.forEach(function (u) { u.team = u.team === 'player' ? 'enemy' : 'player'; });
    eng.turn = 'player';
    eng.render = function () { /* během prohození stran se nekreslí */ };
    eng.log = function (msg, type) { protoLog.call(eng, msg, type === 'player' ? 'enemy' : type === 'enemy' ? 'player' : type); };
    try { fn(); } finally {
      eng.units.forEach(function (u) { u.team = u.team === 'player' ? 'enemy' : 'player'; });
      eng.turn = savedTurn;
      delete eng.render;
      delete eng.log;
    }
  }

  // Provede jednu akci, jen když je podle pravidel možná (soupeř může mít upravený prohlížeč)
  function applyAction(a, k) {
    var eng = V.eng, p = V.proto, type = a && a[0];
    if (type === 'm') {
      var u = unitById(a[1]);
      if (!u || u.team !== 'player' || u.hasMoved || u.routed) return false;
      var reach = eng.getReachableTiles(u);
      if (reach[a[2] + ',' + a[3]] === undefined) return false;
      eng.actingUnit = u; eng.selectedUnit = u;
      p.moveSelectedTo.call(eng, a[2], a[3]);
      return true;
    }
    if (type === 'a') {
      var at = unitById(a[1]), tg = unitById(a[2]);
      if (!at || !tg || at.team !== 'player' || tg.team !== 'enemy' || at.hasActed || at.routed) return false;
      if (Math.abs(at.x - tg.x) + Math.abs(at.y - tg.y) > at.range) return false;
      eng.actingUnit = at; eng.selectedUnit = at;
      seeded(k, function () { p.executeAttack.call(eng, at, tg); });
      return true;
    }
    if (type === 'b') {
      var bu = unitById(a[1]);
      if (!bu || bu.team !== 'player' || bu.hasActed || bu.routed) return false;
      eng.actingUnit = bu; eng.selectedUnit = bu;
      seeded(k, function () { p.activateAbility.call(eng, bu); });
      return true;
    }
    if (type === 'u') {
      if (!eng.canUndo()) return false;
      p.undoMove.call(eng);
      return true;
    }
    return false;
  }

  function replayTurn(rec, instant, done) {
    var eng = V.eng, m = rec.payload || {}, theirs = rec.p !== SLOT, acts = Array.isArray(m.a) ? m.a : [];
    if (m.k !== V.ply) note('Pořadí tahů nesedí (' + m.k + ' místo ' + V.ply + ').', 'enemy');
    V.replaying = true;
    var before = new Map(eng.units.map(function (u) { return [u, { x: u.x, y: u.y }]; }));
    var ph = null;
    if (!instant) {
      ph = eng._phase = { seq: eng._battleSeq, skip: false, pending: null, scale: Math.max(0.45, Math.min(1, 3600 / (Math.max(1, acts.length) * 380))), posBefore: before };
      eng.turn = 'enemy'; eng.showBanner(theirs ? 'Tah soupeře' : 'Tah');
    }
    var side = theirs ? 'enemy' : 'player';
    ensureStart();
    var i = 0;
    var end = function () {
      eng.actingUnit = null; eng.selectedUnit = null; eng._phase = null;
      V.replaying = false;
      if (!V.pending && slotMoving(rec) === 2) finishRound();
      if (!V.pending && m.e && !V.ended) { V.pending = evaluate(); if (!V.pending) markDesync(); }   // soupeř hlásí konec: ověř ho vlastním výpočtem
      var sentHash = m.h;
      V.ply += 1;
      if (sentHash !== undefined && sentHash !== stateHash(eng.units) && !V.pending) markDesync();
      if (side === 'enemy') {
        eng.enemyTrails = [];
        eng.units.forEach(function (u) { var b = before.get(u); if (u.team === 'enemy' && u.hp > 0 && b && (b.x !== u.x || b.y !== u.y)) eng.enemyTrails.push({ x1: b.x, y1: b.y, x2: u.x, y2: u.y }); });
      }
      if (V.pending) { eng.render(); finishDuel(); done && done(); return; }
      if (slotToMove() === SLOT) beginMyPly(); else beginOppPly();
      done && done();
    };
    var step = function () {
      if (i >= acts.length) { end(); return; }
      var a = acts[i], k = i; i += 1;
      var okAction = false;
      inFrame(theirs, function () { try { okAction = applyAction(a, k); } catch (e) { okAction = false; try { console.error(e); } catch (x) { /* nic */ } } });
      if (!okAction) markDesync();
      eng.render();
      if (V.pending) { end(); return; }
      if (instant) step(); else eng.phaseWait(ph, a[0] === 'm' ? 260 : 420, function () { eng.actingUnit = null; step(); });
    };
    step();
  }

  function slotMoving(rec) { return rec.p === 2 ? 2 : 1; }

  function markDesync() {
    if (V.desync) return;
    V.desync = true;
    note('Pozor: stav bitvy se u tebe a u soupeře rozešel. Zápas může skončit zrušením.', 'enemy');
  }

  // Fronta tahů k přehrání, po jednom a podle pořadí: historie z načtení zápasu naráz (instant), nové tahy soupeře v animaci. Tah se přehraje jen
  // jednou: co už má kopie bitvy za sebou (k je menší než pořadí dalšího tahu), se zahodí, takže se nezopakují ani moje vlastní odeslané tahy.
  function enqueue(rec, instant) {
    if (!rec || !rec.payload || rec.payload.t !== 'turn') return;
    if (V.queue.some(function (q) { return q.rec.seq === rec.seq; })) return;
    V.queue.push({ rec: rec, instant: instant });
    V.queue.sort(function (a, b) { return a.rec.seq - b.rec.seq; });
  }

  function pump() {
    while (!V.busy && V.queue.length && !V.ended) {
      var q = V.queue.shift();
      if (q.rec.payload.k < V.ply) continue;
      if (q.instant) { replayTurn(q.rec, true, null); continue; }
      V.busy = true;
      replayTurn(q.rec, false, function () { V.busy = false; pump(); });
    }
  }

  // ---------- Konec ----------
  function finishDuel(after) {
    if (V.ended) return;
    var res = V.pending, eng = V.eng;
    var outcome = res.winner === 0 ? 'draw' : res.winner === SLOT ? 'win' : 'loss';
    V.ended = outcome;
    eng.turn = 'over';
    // výsledek se ohlásí až po odeslání posledního tahu, ať soupeř uvidí, jak bitva skončila
    var report = function () { MP.report(outcome, res.reason).catch(function () { /* výsledek potvrdí server */ }); };
    if (after && after.then) after.then(report); else report();
    var why = res.reason === 'commander' ? (outcome === 'win' ? 'Soupeřův velitel padl.' : 'Tvůj velitel padl.')
      : res.reason === 'army' ? (outcome === 'win' ? 'Zničil jsi soupeřovu armádu.' : 'Tvoje armáda byla zničena.')
      : res.reason === 'limit' ? (outcome === 'win' ? 'Po posledním kole máš víc zdraví armády.' : outcome === 'loss' ? 'Po posledním kole má soupeř víc zdraví armády.' : 'Po posledním kole mají obě armády stejné zdraví.')
      : 'Obě armády padly najednou.';
    showEnd(outcome, why);
  }

  function showEnd(outcome, why) {
    try { if (outcome === 'win') audioFX.playVictory(); } catch (e) { /* bez zvuku */ }
    V.eng.render();
    Game.showBattleResultModal(outcome === 'win', why, 'Zavřít', function () { Game.closeModals(); });
    var title = document.getElementById('result-title');
    if (title && outcome !== 'win') title.innerText = outcome === 'draw' ? 'Remíza' : outcome === 'void' ? 'Souboj zrušen' : 'Porážka!';
  }

  // Stav nahoře v záhlaví: kdo je na tahu, kolik zbývá času, které kolo
  function refreshHud() {
    var el = document.getElementById('battle-turn-info');
    if (!el || !V.eng) return;
    if (V.ended) { el.innerText = 'Souboj skončil'; return; }
    var left = V.view && V.view.deadline ? Math.max(0, Math.ceil((V.view.deadline - MP.serverNow()) / 1000)) : null;
    var clock = left == null ? '-:--' : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    var r = Math.min(V.eng.turnNumber, preset.rounds), n = preset.rounds;
    el.innerText = V.eng.turn === 'player' ? `Kolo ${r} z ${n} - jsi na tahu - ${clock}` : V.replaying ? `Kolo ${r} z ${n} - soupeř táhne` : `Kolo ${r} z ${n} - na tahu je ${oppName()} - ${clock}`;
  }

  function boot() {
    var eng = V.eng = window.gameEngine;
    var st = document.createElement('style');
    st.textContent = 'body.mp #main-menu,body.mp #campaign-hub{display:none!important}';
    document.head.appendChild(st);
    patchEngine();
    loadDuel();
    MP.on('sync', function (d) {
      V.view = d.match; V.synced = true;
      var known = {};
      // zápas už běžel (obnovená stránka nebo pozdější příchod): složí se přehráním všech dosavadních tahů naráz
      (d.moves || []).forEach(function (rec) { known[rec.seq] = true; enqueue(rec, true); });
      // tahy, které přišly dřív než historie a v ní nejsou, se přehrají normálně
      V.early.forEach(function (rec) { if (!known[rec.seq]) enqueue(rec, false); });
      V.early = [];
      pump();
      if (d.match && d.match.status !== 'active' && !V.ended) {
        V.ended = d.outcome || 'void'; eng.turn = 'over';
        showEnd(V.ended, d.match.reason === 'timeout' ? (V.ended === 'win' ? 'Soupeři vypršel čas.' : 'Vypršel ti čas.') : d.match.reason === 'resign' ? (V.ended === 'win' ? 'Soupeř to vzdal.' : 'Vzdal jsi to.') : '');
      }
      eng.render();
    });
    MP.on('moves', function (d) {
      (d.moves || []).forEach(function (rec) {
        if (rec.p === SLOT) return;   // můj vlastní tah už mám
        if (V.synced) enqueue(rec, false); else V.early.push(rec);
      });
      pump();
    });
    MP.on('match', function (d) { V.view = d.match; });
    MP.on('end', function (d) {
      var v = d.match || {};
      if (V.ended && V.ended !== 'void') return;
      V.ended = d.outcome || (v.status === 'void' ? 'void' : v.winner === v.slot ? 'win' : 'loss');
      eng.turn = 'over';
      var why = v.reason === 'timeout' ? (V.ended === 'win' ? 'Soupeři vypršel čas.' : 'Vypršel ti čas.')
        : v.reason === 'resign' ? (V.ended === 'win' ? 'Soupeř to vzdal.' : 'Vzdal jsi to.')
        : v.reason === 'opponent_gone' ? 'Soupeř se odpojil.' : v.reason === 'no_show' ? 'Soupeř se nepřipojil.' : '';
      showEnd(V.ended, why);
    });
    MP.listen();
    setInterval(refreshHud, 500);
    refreshHud();
  }

  window.addEventListener('load', boot);
})();
