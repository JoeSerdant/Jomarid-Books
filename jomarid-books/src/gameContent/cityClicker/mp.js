/* mp.js - online závod City Clickeru (multiplayer): dva hráči začnou úplně od nuly (čerstvá hra bez uloženého postupu) a vyhrává, kdo první
   vydělá cílový obnos (miliarda, 10 miliard nebo 100 miliard podle volby před zápasem). Hra se spustí s rozhraním window.jomaridMP z appky
   (src/mp); bez něj se tenhle soubor jen načte a nic nedělá.

   Hra posílá serveru průběh (kolik celkem vydělala, i napříč přestavbami města) každou vteřinu a půl a hned, jakmile dosáhne cíle.
   O vítězi rozhoduje server: kdo první pošle hodnotu na cíli, vyhrává (a průběh nejde přeskočit rychleji, než dovolí nejkratší možná doba
   závodu). Před startem je krátký odpočet od založení zápasu, ať mají oba čas načíst hru. Přestavba, skoky i cheaty zůstávají ve hře, jen se
   započítávají do celkového výdělku (hook window.__ccHooks z index.html); cheat kódy appka v online zápase vypne. */
(function () {
  var MP = window.jomaridMP && window.jomaridMP.enabled ? window.jomaridMP : null;
  if (!MP) return;
  var COUNTDOWN_MS = 7000;   // od založení zápasu do startu
  var SEND_EVERY_MS = 1500;
  var H = null, view = null, ended = null, startAt = 0, started = false, lastSent = 0, sentGoal = false;
  var el = {};

  function css() {
    var st = document.createElement('style');
    st.textContent = 'body.mp{padding-bottom:84px}body.mp #resetBtn{display:none}' +
      '#mpRace{position:fixed;left:0;right:0;bottom:0;z-index:900;background:rgba(12,16,28,.94);color:#fff;font:600 13px system-ui,sans-serif;border-top:2px solid #4a5a8a;padding:6px 10px 8px}' +
      '#mpRace .mpt{display:flex;justify-content:space-between;gap:8px;opacity:.85;font-size:12px;margin-bottom:3px}' +
      '#mpRace .mpr{display:flex;align-items:center;gap:8px;margin:2px 0}#mpRace .mpn{flex:0 0 5.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#mpRace .mpb{flex:1;height:12px;border-radius:7px;background:#2a3350;overflow:hidden}#mpRace .mpb i{display:block;height:100%;width:0;border-radius:7px;transition:width .5s}' +
      '#mpRace .me i{background:linear-gradient(90deg,#3ecf8e,#9be15d)}#mpRace .op i{background:linear-gradient(90deg,#f5a623,#ff7a59)}#mpRace .mpv{flex:0 0 6.5em;text-align:right;font-variant-numeric:tabular-nums}' +
      '#mpCover{position:fixed;inset:0;z-index:950;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:rgba(5,8,18,.72);color:#fff;text-align:center;font:700 22px system-ui,sans-serif;padding:20px}' +
      '#mpCover b{font-size:min(22vw,120px);line-height:1;color:#ffd92e}#mpCover small{font-size:16px;font-weight:600;opacity:.9}';
    document.head.appendChild(st);
  }

  function build() {
    css();
    document.body.classList.add('mp');
    var bar = document.createElement('div');
    bar.id = 'mpRace';
    bar.innerHTML = '<div class="mpt"><span>Závod o peníze</span><span id="mpGoal"></span></div>' +
      '<div class="mpr me"><span class="mpn">Ty</span><span class="mpb"><i id="mpMeBar"></i></span><span class="mpv" id="mpMeVal"></span></div>' +
      '<div class="mpr op"><span class="mpn" id="mpOpName"></span><span class="mpb"><i id="mpOpBar"></i></span><span class="mpv" id="mpOpVal"></span></div>';
    document.body.appendChild(bar);
    var cover = document.createElement('div');
    cover.id = 'mpCover';
    cover.innerHTML = '<b id="mpBig"></b><span id="mpMsg"></span><small id="mpSub"></small>';
    document.body.appendChild(cover);
    el = { goal: bar.querySelector('#mpGoal'), meBar: bar.querySelector('#mpMeBar'), meVal: bar.querySelector('#mpMeVal'), opName: bar.querySelector('#mpOpName'), opBar: bar.querySelector('#mpOpBar'),
      opVal: bar.querySelector('#mpOpVal'), cover: cover, big: cover.querySelector('#mpBig'), msg: cover.querySelector('#mpMsg'), sub: cover.querySelector('#mpSub') };
    el.goal.textContent = 'Cíl: ' + H.fmt(MP.init.target || 1e10);
    el.opName.textContent = (MP.init.opponent && MP.init.opponent.name) || 'Soupeř';
  }

  // Ukazatel v logaritmické stupnici: výdělek roste řádově, takže na přímé stupnici by byl dlouho prázdný.
  function frac(v) {
    var target = MP.init.target || 1e10;
    if (!(v > 100)) return 0;
    return Math.max(0, Math.min(1, (Math.log10(v) - 2) / (Math.log10(target) - 2)));
  }

  function render(total) {
    var oppIdx = MP.init.slot === 1 ? 1 : 0;
    var opp = view && view.prog ? Number(view.prog[oppIdx]) || 0 : 0;
    el.meBar.style.width = Math.round(frac(total) * 100) + '%';
    el.meVal.textContent = H.fmt(total);
    el.opBar.style.width = Math.round(frac(opp) * 100) + '%';
    el.opVal.textContent = H.fmt(opp);
  }

  function cover(big, msg, sub) {
    el.big.textContent = big || '';
    el.big.style.display = big ? 'block' : 'none';
    el.msg.textContent = msg || '';
    el.sub.textContent = sub || '';
    el.cover.style.display = big || msg ? 'flex' : 'none';
  }

  function send(v) {
    lastSent = Date.now();
    var p = MP.progress(v);
    if (p && p.catch) p.catch(function () { /* spojení se obnoví, další průběh půjde za chvíli */ });
  }

  function tick() {
    if (ended) return;
    var now = MP.serverNow();
    if (!started) {
      if (!startAt) { cover('', 'Čekám na načtení zápasu...', ''); return; }
      if (now < startAt) { cover(String(Math.ceil((startAt - now) / 1000)), 'Start za chvíli', 'Oba hráči začínají od nuly. Vyhraje, kdo první vydělá ' + H.fmt(MP.init.target || 1e10) + '.'); return; }
      started = true; H.freeze(false); cover('', '', '');
    }
    var total = H.total();
    render(total);
    if (total >= (MP.init.target || 1e10)) { if (!sentGoal) { sentGoal = true; send(total); } return; }
    if (Date.now() - lastSent >= SEND_EVERY_MS) send(total);
  }

  function finish(d) {
    if (ended) return;
    var v = d.match || {};
    ended = d.outcome || (v.status === 'void' ? 'void' : v.winner === v.slot ? 'win' : 'loss');
    H.freeze(true);
    render(H.total());
    var why = v.reason === 'goal' ? (ended === 'win' ? 'Dosáhl jsi cíle jako první.' : 'Soupeř dosáhl cíle jako první.')
      : v.reason === 'resign' ? (ended === 'win' ? 'Soupeř to vzdal.' : 'Vzdal jsi to.')
      : v.reason === 'opponent_gone' ? 'Soupeř se odpojil.' : v.reason === 'no_show' ? 'Soupeř se nepřipojil.' : '';
    cover('', ended === 'win' ? 'Vyhrál jsi závod!' : ended === 'loss' ? 'Soupeř byl rychlejší.' : ended === 'draw' ? 'Remíza.' : 'Závod byl zrušen.', why);
  }

  function boot() {
    if (!window.__ccHooks) return false;
    H = window.__ccHooks;
    H.freeze(true);
    build();
    MP.on('sync', function (d) {
      view = d.match;
      if (view && view.created) startAt = view.created + COUNTDOWN_MS;
      if (view && view.status !== 'active') finish({ match: view, outcome: d.outcome });
    });
    MP.on('match', function (d) { view = d.match; });
    MP.on('end', function (d) { finish(d); });
    MP.listen();
    setInterval(tick, 100);
    return true;
  }

  var tries = 0;
  var wait = setInterval(function () { if (boot() || ++tries > 200) clearInterval(wait); }, 50);
})();
