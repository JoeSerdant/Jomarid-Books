(function () {
  var CFG = window.JOMARID_MUSIC;
  if (!CFG || !CFG.urls || !CFG.urls.length || window.__JOMARID_MUSIC) return;
  window.__JOMARID_MUSIC = true;
  var on = true, touched = false, audio = null, blobUrl = null, loading = false;
  var url = CFG.urls[Math.floor(Math.random() * CFG.urls.length)];
  function volume() { return (CFG.volume || 0.2) * (window.jomaridMP && window.jomaridMP.enabled ? 0.6 : 1); }
  function want() { return on && touched && !document.hidden; }
  function sync() {
    try {
      if (!want()) { if (audio) audio.pause(); return; }
      if (!blobUrl) {
        if (!loading) {
          loading = true;
          fetch(url).then(function (r) { if (!r.ok) throw new Error('x'); return r.blob(); })
            .then(function (b) { blobUrl = URL.createObjectURL(b); loading = false; sync(); })
            .catch(function () { loading = false; });
        }
        return;
      }
      if (!audio) { audio = new Audio(blobUrl); audio.loop = true; }
      audio.volume = volume();
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* hudba nikdy nesmí rozbít hru */ }
  }
  function touch() { if (!touched) { touched = true; sync(); } }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, touch, true); });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var d = ev.data;
    if (d && d.source === 'jomarid-host' && d.type === 'music-pref') { on = !!d.on; sync(); }
  });
  try { window.parent.postMessage({ source: 'jomarid-game', type: 'music-hello' }, '*'); } catch (e) { /* mimo appku */ }
})();
