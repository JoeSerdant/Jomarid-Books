// Doplňování stromu vývoje.
/* =====================================================================
   Automatické rozvětvení: každá třída, která má pokračování, jich má
   vždy aspoň 4 (na libovolném stupni, včetně 4.). Chybějící možnosti se
   dopočítají jako odvozené varianty existující třídy.
   ===================================================================== */
(function expandBranches() {
  const usedNames = new Set(Object.keys(CLASSES).map(id => CLASSES[id].name));
  const ADJ = ['Ledový', 'Ohnivý', 'Bleskový', 'Temný', 'Zlatý', 'Stínový', 'Bouřlivý', 'Divoký', 'Tichý', 'Železný',
    'Krvavý', 'Toxický', 'Křišťálový', 'Purpurový', 'Polární', 'Sluneční', 'Nebeský', 'Podzemní', 'Rudý', 'Rezavý',
    'Chromový', 'Prastarý', 'Přízračný', 'Ocelový', 'Smaragdový', 'Půlnoční', 'Pouštní', 'Ledovcový'];
  const NOUN = ['Drak', 'Sokol', 'Vlk', 'Titan', 'Štír', 'Krakan', 'Fénix', 'Golem', 'Mantis', 'Hydra',
    'Žralok', 'Jestřáb', 'Medvěd', 'Tygr', 'Kobra', 'Ještěr', 'Pavouk', 'Vosa', 'Havran', 'Lev',
    'Gryf', 'Bazilišek', 'Kentaur', 'Minotaur', 'Netopýr', 'Rys', 'Sup', 'Škorpion'];
  let ai = 0, ni = 0;
  function nextName(salt) {
    for (let guard = 0; guard < 4000; guard++) {
      const nm = ADJ[(ai + salt * 7) % ADJ.length] + ' ' + NOUN[ni % NOUN.length];
      ni++; if (ni % NOUN.length === 0) ai++;
      if (!usedNames.has(nm)) { usedNames.add(nm); return nm; }
    }
    return 'Varianta ' + Object.keys(CLASSES).length;  // v praxi nenastane
  }

  const bulLike = b => !b.turret && BUL_KINDS[b.kind];
  const hasBul = c => c.barrels.some(bulLike);
  const hasRearable = c => c.barrels.some(b => !b.turret && (b.kind === 'bullet' || b.kind === 'missile' || b.kind === 'trap'));
  const hasSwarm = c => c.maxDrones > 0 || c.maxTraps > 0;

  function offenseOf(c) {
    let s = 0;
    for (const b of c.barrels) s += (b.dmg || 0) * (1 + 0.07 * (b.pierce || 0)) * (1 + 0.05 * (b.bounce || 0)) * (b.blast ? 1.3 : 1);
    return Math.max(0.05, s) / Math.max(0.15, c.reload);
  }
  const defenseOf = c => c.hp * Math.pow(1 / Math.max(0.4, c.size || 1), 0.3);
  // odvozenou třídu jemně dorovná (přes reload) tak, aby celkovou silou seděla poblíž
  // původní třídy — recept si tak zachová svůj charakter, ale nevznikne z něj výrazně
  // silnější/slabší varianta než ostatní sourozenci.
  function balanceAgainst(base, c) {
    const ratio = Math.pow(offenseOf(c) / offenseOf(base), 0.55) * Math.pow(defenseOf(c) / defenseOf(base), 0.3) * Math.pow(c.speed / base.speed, 0.15);
    const corr = Math.pow(ratio / clamp(ratio, 0.88, 1.18), 1 / 0.55);
    if (corr > 1.015 || corr < 0.985) c.reload = clamp(c.reload * corr, 0.15, 4.5);
  }
  const RECIPES = [
    { info: 'Rychlejší a hbitější, ale křehčí', ok: () => true, fn: c => t4.st(c, { speed: 1.18, hp: 0.9 }) },
    { info: 'Pomalejší, zato mnohem odolnější', ok: () => true, fn: c => t4.st(c, { hp: 1.35, speed: 0.9 }) },
    { info: 'Slabší pancíř, drtivé zásahy', ok: hasBul, fn: c => { t4.bul(c, { dmg: 1.3 }); t4.st(c, { hp: 0.85 }); } },
    { info: 'Rychlejší palba, slabší rány', ok: hasBul, fn: c => { t4.st(c, { reload: 0.8 }); t4.bul(c, { dmg: 0.85 }); } },
    { info: 'Pomalejší palba, těžké rány', ok: hasBul, fn: c => { t4.st(c, { reload: 1.28 }); t4.bul(c, { dmg: 1.35, spd: 0.92 }); } },
    { info: 'Delší dostřel, přesnější míření', ok: () => true, fn: c => { t4.st(c, { range: 1.3, zoom: 0.86, speed: 0.94 }); t4.bul(c, { spd: 1.15 }); } },
    { info: 'Střely prorazí více cílů', ok: hasBul, fn: c => t4.bul(c, { pierce: 2 }) },
    { info: 'Střely se odrážejí od zdí', ok: hasBul, fn: c => t4.bul(c, { bounce: 2 }) },
    { info: 'Střely při zásahu vybuchnou', ok: hasBul, fn: c => t4.bul(c, { blast: 42 }) },
    { info: 'Přidána palba i dozadu', ok: hasRearable, fn: c => t4.rear(c, 0.65) },
    { info: 'Doplněno o dvě samočinné věže', ok: () => true, fn: c => t4.tur(c, 2, 0.5) },
    { info: 'Vyšší kapacita dronů a pastí', ok: hasSwarm, fn: c => t4.st(c, { maxDrones: 1.45, maxTraps: 1.45 }) },
    { info: 'Agresivní beran, víc rychlosti', ok: () => true, fn: c => t4.st(c, { ram: 1.6, speed: 1.08 }) },
    { info: 'Menší a mnohem hbitější', ok: () => true, fn: c => t4.st(c, { size: 0.85, speed: 1.14 }) },
    { info: 'Větší a mohutnější', ok: () => true, fn: c => t4.st(c, { size: 1.22, hp: 1.2, speed: 0.9 }) },
    { info: 'Delší hlavně, tvrdší zásah', ok: hasBul, fn: c => t4.bul(c, { dmg: 1.18, size: 1.15 }) },
  ];

  function pad(id) {
    const base = CLASSES[id];
    if (!base || base.boss || base.tier == null || base.tier > 3) return;
    const kids = TREE[id] || (TREE[id] = []);
    let ri = (id.length * 7 + kids.length * 3) % RECIPES.length, guard = 0;
    while (kids.length < 4 && guard++ < 80) {
      const rec = RECIPES[ri % RECIPES.length]; ri++;
      if (!rec.ok(base)) continue;
      const c = t4.clone(id);
      c.name = nextName(kids.length); c.info = rec.info; c.tier = base.tier + 1;
      rec.fn(c);
      balanceAgainst(base, c);
      const childId = id + 'v' + kids.length;
      CLASSES[childId] = C(c);
      kids.push(childId);
    }
  }
  // po vrstvách: nově doplněné uzly (např. nová větev 1. stupně) tak hned
  // dostanou svoje vlastní 4 pokračování na dalším stupni.
  for (let tier = 0; tier <= 3; tier++)
    for (const id in CLASSES) if (CLASSES[id].tier === tier) pad(id);
})();
