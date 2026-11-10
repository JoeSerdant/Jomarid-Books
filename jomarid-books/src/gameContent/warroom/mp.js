/* mp.js - online souboj velitelů ve Warroom: Frontlines (multiplayer). Hra se spustí s rozhraním window.jomaridMP z appky (src/mp); bez něj se tenhle
   soubor jen načte a nic nedělá.

   Pravidla souboje: oba hráči hrají stejnou hru (scénář Základ, doktrínu si každý vybere), každý má vlastní frontu, zásoby, velitelské body a vylepšení.
   Střídají se po dnech: na tahu je jeden hráč. Může použít libovolně mnoho okamžitých akcí (vylepšení, dělostřelectvo, letecký shoz) a jeden den ukončí
   útokem nebo logistikou, jako v samostatné hře. Denní tlak nepřítele, který ve hře hrál počítač, je tady útok soupeře: o kolik se tvoje fronta při tahu
   posunula dopředu, o tolik soupeř ztratí (zmírněné jeho pancířem, doktrínou a technologiemi stejně jako dřív tlak nepřítele). Kdo dotlačí frontu
   na maximum, vyhrává; komu klesne na nulu, prohrává. K tlaku soupeře se přidává malá únava, která s dny roste (getEnemyPush), takže se
   vyrovnaní hráči nepřetahují donekonečna: souboj rozhodne, kdo lépe útočí, vylepšuje a brání se. Útok prvního hráče z prvního dne druhému
   tlak nepřidá (zahajovací útok): oba pak čelí vždy jednomu útoku soupeře za den a nikdo není kvůli pořadí tahů pozadu. O čase na tah (2 minuty) a odměně rozhoduje server (db/multiplayer.sql).

   Co se posílá: po každém dni zpráva {t:'a', adv: posun fronty, w: dosáhl jsem maxima, l: padl jsem, m: co jsem udělal, d: doktrína}. Zprávy soupeře se
   sčítají do state.mpIncoming a ve hře je vyřídí getEnemyPush() při konci dne. Stav hry se po každém dni ukládá do sessionStorage okna appky, takže
   obnovená stránka partii dohraje (v jiném prohlížeči ji obnovit nejde). */
(function () {
  var MP = window.jomaridMP && window.jomaridMP.enabled ? window.jomaridMP : null;
  if (!MP) return;

  var SAVE = 'jomarid-mp-warroom:' + MP.init.match;
  var V = { view: null, synced: false, ended: null, reason: '', turnNo: 0, base: 0, queue: [], applied: 0, restored: false, started: false, waiting: false };
  var ui = {};

  function store() { try { return window.parent.sessionStorage; } catch (e) { return null; } }
  var myTurn = function () { var v = V.view; return !!(v && v.status === 'active' && v.turn === MP.init.slot); };
  function blocked() { return !V.started || !!V.ended || V.waiting || !myTurn() || state.gamePaused; }
  function oppName() { return (MP.init.opponent && MP.init.opponent.name) || 'Soupeř'; }

  // ---------- Vzhled: pruh nahoře (kdo je na tahu, čas) a zamčení ovládání, dokud není řada na hráči ----------
  function buildUi() {
    document.body.classList.add('mp');
    var st = document.createElement('style');
    st.textContent = 'body.mp #tutorial-help-btn,body.mp #tutorial-intro{display:none!important}' +
      'body.mpw #game-screen button:not(#sound-toggle):not(#btn-back-to-jomarid),body.mpw #game-screen .card{opacity:.45;pointer-events:none}' +
      '#mpBar{position:fixed;left:0;right:0;top:0;z-index:99990;display:flex;justify-content:space-between;gap:8px;align-items:center;padding:5px 12px;font:700 13px system-ui,sans-serif;color:#fff;background:rgba(10,14,24,.94);border-bottom:2px solid #3b4a72}' +
      '#mpBar.me{border-bottom-color:#22c55e}#mpBar.op{border-bottom-color:#f59e0b}#mpBar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#mpEnd{position:fixed;inset:0;z-index:99995;display:none;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:rgba(4,6,14,.82);color:#fff;text-align:center;font:800 28px system-ui,sans-serif;padding:20px}' +
      '#mpEnd small{font:600 16px system-ui,sans-serif;opacity:.9}body.mp{padding-top:34px}';
    document.head.appendChild(st);
    var bar = document.createElement('div');
    bar.id = 'mpBar';
    bar.innerHTML = '<span id="mpWho"></span><span id="mpTime"></span>';
    document.body.appendChild(bar);
    var end = document.createElement('div');
    end.id = 'mpEnd';
    end.innerHTML = '<span id="mpEndT"></span><small id="mpEndS"></small>';
    document.body.appendChild(end);
    ui = { bar: bar, who: bar.querySelector('#mpWho'), time: bar.querySelector('#mpTime'), end: end, endT: end.querySelector('#mpEndT'), endS: end.querySelector('#mpEndS') };
  }

  function refreshBar() {
    if (!ui.bar) return;
    var mine = myTurn() && V.started && !V.ended;
    document.body.classList.toggle('mpw', !V.ended && (!mine || !V.started));
    ui.bar.className = V.ended ? '' : mine ? 'me' : 'op';
    if (V.ended) { ui.who.textContent = 'Souboj skončil'; ui.time.textContent = ''; return; }
    if (!V.synced) { ui.who.textContent = 'Načítám zápas...'; ui.time.textContent = ''; return; }
    if (!V.started) { ui.who.textContent = 'Vyber si doktrínu'; ui.time.textContent = ''; return; }
    ui.who.textContent = mine ? 'Jsi na tahu' : 'Na tahu je ' + oppName();
    var v = V.view, left = v && v.deadline ? Math.max(0, Math.ceil((v.deadline - MP.serverNow()) / 1000)) : null;
    ui.time.textContent = left == null ? '' : left + ' s';
  }

  // ---------- Průběh dne ----------
  var origEndTurn = endTurn;
  endTurn = function (msg, color) {
    if (blocked()) return;
    var adv = Math.max(0, state.front - V.base);          // o kolik se fronta při tomhle tahu posunula dopředu
    origEndTurn(msg, color);                               // tlak soupeře (state.mpIncoming) se vyřídí uvnitř
    state.mpIncoming = 0;
    afterDay(adv, msg);
  };

  function plain(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 90); }

  function afterDay(adv, msg) {
    var m = { t: 'a', k: ++V.turnNo, adv: adv, m: plain(msg) };
    if (V.ended === 'win') m.w = 1;                // konec dne mě dotlačil na maximum (checkWinLoss to během dne zaznamenal)
    else if (V.ended === 'loss') m.l = 1;          // nebo mi fronta padla
    if (V.turnNo === 1) m.d = state.doctrine;
    V.base = state.front;
    V.waiting = !V.ended;                           // další den až po odpovědi soupeře
    saveState();
    MP.move(m).catch(function () { V.waiting = false; note('Tah se nepodařilo odeslat.'); });
    refreshBar();
  }

  // Konec: vítězství (fronta na maximu) nebo prohra (fronta na nule). Výsledek ohlásí oba hráči, o odměně rozhoduje server.
  checkWinLoss = function () {
    if (state.gamePaused || V.ended || !V.started) return;
    if (state.front <= 0 && state.doctrine === 'fanatic' && !state.fanaticUsed) { state.front = 1; state.fanaticUsed = true; logMessage('VÍRA: Vojáci odmítli ustoupit! Poslední linie drží na 1 HP!', 't-purple'); return; }
    if (state.front >= state.maxFront) finish('win', 'front');
    else if (state.front <= 0) finish('loss', 'front');
  };

  function finish(outcome, reason) {
    if (V.ended) return;
    V.ended = outcome; V.reason = reason;
    state.gamePaused = true;
    MP.report(outcome, reason).catch(function () {});
    showEnd(outcome, reason);
    saveState();
  }

  function showEnd(outcome, reason) {
    var why = reason === 'timeout' ? (outcome === 'win' ? 'Soupeři vypršel čas.' : 'Vypršel ti čas.')
      : reason === 'resign' ? (outcome === 'win' ? 'Soupeř to vzdal.' : 'Vzdal jsi to.')
      : reason === 'opponent_gone' ? 'Soupeř se odpojil.'
      : reason === 'front' ? (outcome === 'win' ? 'Dotlačil jsi frontu na maximum.' : 'Tvoje fronta padla.') : '';
    ui.endT.textContent = outcome === 'win' ? 'Vítězství!' : outcome === 'loss' ? 'Porážka' : outcome === 'draw' ? 'Remíza' : 'Souboj zrušen';
    ui.endS.textContent = why;
    ui.end.style.display = 'flex';
    refreshBar();
  }

  function note(text) { try { logMessage(text, 't-orange'); } catch (e) { /* hra ještě nemá log */ } }

  // ---------- Zprávy soupeře ----------
  function onOpp(rec) {
    var m = rec.payload;
    if (!m || m.t !== 'a' || V.ended) return;
    if (rec.seq <= V.applied) return;
    if (!V.started) { V.queue.push(rec); return; }
    V.applied = rec.seq;
    V.waiting = false;
    if (m.d && typeof DOCTRINE_SHORT !== 'undefined' && DOCTRINE_SHORT[m.d]) logMessage(oppName() + ' - doktrína ' + DOCTRINE_SHORT[m.d] + '.', 't-white');
    if (m.m) logMessage(oppName() + ': ' + plain(m.m), 't-red');
    if (m.w) { finish('loss', 'front'); return; }          // dotlačil frontu na maximum
    if (m.l) { finish('win', 'front'); return; }           // jeho fronta padla
    var adv = Math.max(0, Math.min(1000, Number(m.adv) || 0));
    if (V.turnNo === 0) {
      // Zahajovací útok: kdo táhne první, před sebou žádný útok soupeře nemá. Druhý hráč proto první den tlak necítí, jinak by byl o jeden útok pozadu
      logMessage(oppName() + ' - zahajovací útok (+' + adv + '). První den je ještě bez tlaku na tvou frontu.', 't-red');
      adv = 0;
    } else {
      state.mpIncoming = (state.mpIncoming || 0) + adv;
      if (adv > 0) logMessage('Soupeř postoupil o ' + adv + '. Tlak na tvou frontu roste.', 't-red');
    }
    saveState();
    updateUI();
    refreshBar();
  }

  // ---------- Uložení pro obnovení stránky ----------
  function saveState() {
    var s = store();
    if (!s || !V.started) return;
    try { s.setItem(SAVE, JSON.stringify({ state: state, turnNo: V.turnNo, base: V.base, applied: V.applied, ended: V.ended, reason: V.reason })); } catch (e) { /* plné úložiště: partie jde dál, jen se neobnoví */ }
  }
  function restoreState() {
    var s = store();
    if (!s) return false;
    var raw = null;
    try { raw = JSON.parse(s.getItem(SAVE) || 'null'); } catch (e) { raw = null; }
    if (!raw || !raw.state || typeof raw.state !== 'object') return false;
    Object.keys(state).forEach(function (k) { delete state[k]; });
    Object.assign(state, raw.state);
    V.turnNo = raw.turnNo | 0; V.base = Number(raw.base) || state.front; V.applied = raw.applied | 0;
    V.restored = true;
    return true;
  }

  // ---------- Začátek hry ----------
  var origSetDoctrine = setDoctrine;
  setDoctrine = function (doc) {
    origSetDoctrine(doc);
    started();
  };
  function started() {
    if (V.started) return;
    V.started = true;
    // Souboj je kratší než tažení: fronta i její maximum na 40 %, ať se rozhodne za zhruba dvacet dní každého
    state.maxFront = Math.max(120, Math.round(state.maxFront * 0.4));
    state.front = Math.round(state.front * 0.4);
    V.base = state.front;
    state.mpIncoming = 0;
    el('game-screen').style.display = 'block';
    var q = V.queue; V.queue = [];
    q.forEach(onOpp);
    refreshBar();
  }

  // okamžité akce a dny jdou jen na tahu hráče
  ['startAttack', 'doLogistics', 'useArtillery', 'useAirdrop', 'useScenarioSkill', 'buyUpgrade', 'buyExclusiveTech'].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () { if (blocked()) { try { Sound.deny(); } catch (e) { /* bez zvuku */ } return undefined; } return orig.apply(this, arguments); };
  });

  function boot() {
    buildUi();
    try { localStorage.setItem('warroom_tutorial_done', '1'); } catch (e) { /* paměť hry */ }
    startTutorial = function () {};
    var intro = el('tutorial-intro'); if (intro) intro.style.display = 'none';
    var box = el('resume-box'); if (box) box.style.display = 'none';
    MP.on('sync', function (d) {
      V.view = d.match; V.synced = true;
      var moves = d.moves || [];
      var mine = moves.some(function (r) { return r.p === MP.init.slot; });
      if (mine) {
        if (restoreState()) {
          // obnovená stránka: stav hry se vrací z uložení a přijmou se zprávy soupeře, které přišly mezitím
          el('screen-scenario').classList.remove('active'); el('screen-doctrine').classList.remove('active');
          V.started = true;
          el('game-screen').style.display = 'block';
          moves.forEach(function (r) { if (r.p !== MP.init.slot) onOpp(r); });
          updateUI();
        } else if (d.match && d.match.status === 'active') {
          // partie už běží, ale tenhle prohlížeč o ní nic nemá (jiné okno, vymazané úložiště): nejde ji obnovit
          V.ended = 'void'; V.reason = 'lost_state';
          ui.endT.textContent = 'Souboj nejde obnovit';
          ui.endS.textContent = 'Partie běžela v jiném okně nebo se stav smazal. Odejdi a vzdej ji, nebo začni novou.';
          ui.end.style.display = 'flex';
        }
      } else {
        // nový začátek: zprávy soupeře (když byl rychlejší) se vyřídí po výběru doktríny
        moves.forEach(function (r) { if (r.p !== MP.init.slot) onOpp(r); });
      }
      if (d.match && d.match.status !== 'active' && V.ended !== 'void') { V.ended = d.outcome || 'void'; V.reason = d.match.reason || ''; state.gamePaused = true; showEnd(V.ended, V.reason); }
      refreshBar();
    });
    MP.on('moves', function (d) { (d.moves || []).forEach(function (r) { if (r.p !== MP.init.slot) onOpp(r); }); });
    MP.on('match', function (d) { V.view = d.match; refreshBar(); });
    MP.on('end', function (d) {
      var v = d.match || {};
      if (V.ended && V.ended !== 'void') { refreshBar(); return; }
      V.ended = d.outcome || (v.status === 'void' ? 'void' : v.winner === v.slot ? 'win' : 'loss'); V.reason = v.reason || '';
      state.gamePaused = true;
      showEnd(V.ended, V.reason);
    });
    MP.listen();
    setScenario('default');          // souboj se hraje v základním scénáři; doktrínu si hráč vybere
    setInterval(refreshBar, 500);
  }

  window.addEventListener('load', boot);
})();
