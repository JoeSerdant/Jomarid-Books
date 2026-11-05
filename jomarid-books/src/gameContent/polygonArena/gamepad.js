// Ovladač (Gamepad API). Levá páčka je pohyb, pravá míření, RT / RB / A střílí (nebo silné vychýlení pravé páčky), LB / B / LT je skok,
// X zapíná Auto, křížek nahoru a dolů vybírá vylepšení stavby a Y koupí vybrané, Start je pauza (v menu a na konci zápasu spustí hru).
// Bez připojeného ovladače se nic neděje. Plynulé hodnoty (páčky, střelba) čte ai.js z input.pad, jednorázové stisky vyřizuje padFrame v ui.js.
/* =====================================================================
   Ovladač
   ===================================================================== */
const Pad = (function () {
  const DEAD = 0.2;                 // mrtvá zóna páčky (levné páčky se v klidu třesou)
  const FIRE_STICK = 0.55;          // silné vychýlení pravé páčky střílí i bez tlačítka
  const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, START: 9, UP: 12, DOWN: 13 };
  let prev = null, label = '';

  // Páčka s kruhovou mrtvou zónou: uvnitř nula, za ní plynule od 0 do 1 (ne skokem), směr zůstává.
  function stick(x, y) {
    const len = Math.hypot(x, y);
    if (!(len > DEAD)) return { x: 0, y: 0, mag: 0 };
    const mag = Math.min(1, (len - DEAD) / (1 - DEAD));
    return { x: (x / len) * mag, y: (y / len) * mag, mag };
  }
  const down = (gp, i) => { const b = gp.buttons && gp.buttons[i]; return !!(b && (b.pressed || b.value > 0.5)); };
  // Surový ovladač -> snímek stavu (bez hran).
  function read(gp) {
    const L = stick(Number(gp.axes && gp.axes[0]) || 0, Number(gp.axes && gp.axes[1]) || 0);
    const R = stick(Number(gp.axes && gp.axes[2]) || 0, Number(gp.axes && gp.axes[3]) || 0);
    return {
      lx: L.x, ly: L.y, rx: R.x, ry: R.y, rmag: R.mag,
      fire: down(gp, B.RT) || down(gp, B.RB) || down(gp, B.A) || R.mag > FIRE_STICK,
      btn: { dash: down(gp, B.LB) || down(gp, B.B) || down(gp, B.LT), auto: down(gp, B.X), buy: down(gp, B.Y), up: down(gp, B.UP), down: down(gp, B.DOWN), start: down(gp, B.START), confirm: down(gp, B.A) }
    };
  }
  // Hrana = tlačítko je stisknuté teď a v předchozím snímku nebylo.
  function edges(cur, old) {
    const e = {};
    for (const k in cur.btn) e[k] = cur.btn[k] && !(old && old.btn[k]);
    return e;
  }
  // První připojený ovladač; standardní rozložení (mapping "standard") má přednost, jiný musí mít aspoň 4 osy a 10 tlačítek.
  function choose(list) {
    let any = null;
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (!gp || gp.connected === false) continue;
      if (gp.mapping === 'standard') return gp;
      if (!any && gp.axes && gp.axes.length >= 4 && gp.buttons && gp.buttons.length >= 10) any = gp;
    }
    return any;
  }
  // Jeden snímek: null bez ovladače, jinak { lx, ly, rx, ry, rmag, fire, btn, edge, id }. list je pro testy, jinak se čte navigator.getGamepads().
  function poll(list) {
    let gps = list;
    if (!gps) { try { gps = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : []; } catch (e) { gps = []; } }
    const gp = choose(gps || []);
    if (!gp) { prev = null; return null; }
    const cur = read(gp);
    cur.edge = edges(cur, prev);
    cur.id = label = String(gp.id || '');
    prev = cur;
    return cur;
  }
  function reset() { prev = null; }
  return { DEAD, FIRE_STICK, B, stick, read, edges, choose, poll, reset, get label() { return label; } };
})();
