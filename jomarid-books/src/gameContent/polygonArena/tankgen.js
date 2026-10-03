// Generátor tříd: doplní strom vývoje tak, aby z každé třídy vedly aspoň 4 pokračování a aby každé z nich
// bylo opravdu jiné (jiná silueta, jiný styl hry, jméno i popis, který sedí, a vyvážená síla).
//
// Princip: třída vzniká z rodiče použitím "modulů". Strukturní modul určuje podobu a roli (přidá zadní hlavně,
// věže, drony, zesílí kalibr, prodlouží hlavně, zahustí palbu...). Třídy 4. stupně dostanou navíc "korunní"
// modul se zvláštní vlastností (mráz, oheň, upíří střely, pancíř...). Výsledek se pak modelem síly vyváží vůči
// rodiči. Všechno je deterministické a šum se odvozuje z dvojice (rodič, modul), ne z jednoho sdíleného proudu čísel:
// úprava podmínek jednoho modulu tak nepřehodí výběr u ostatních rodičů a id tříd i uložený kodex zůstanou stabilní.
// Funkce profile() / powerOf() používají i boti k výběru třídy a testy k hlídání vyváženosti.
const TANKGEN = (function () {
  /* ---------- náhoda a pomocné funkce ---------- */
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const seeded = (seed) => {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const isGun = b => !b.turret && (b.kind === 'bullet' || b.kind === 'missile' || b.kind === 'bomb');
  const isFront = b => !b.turret && Math.cos(b.a) > 0.8;
  const isRear = b => !b.turret && Math.cos(b.a) < -0.8;
  const frontGuns = c => c.barrels.filter(b => isGun(b) && isFront(b));
  const sameAng = (a, b) => Math.abs(angDiff(a, b)) < 0.4;
  const SLOTS = [0, PI / 2, -PI / 2, PI];                           // čtyři strany: vpředu, vlevo, vpravo, vzadu
  function cloneClass(c) {
    const o = Object.assign({}, c);
    o.barrels = c.barrels.map(b => Object.assign({}, b));
    delete o.look; delete o.prof; delete o.hasTur;
    return o;
  }

  /* ---------- profil třídy a model síly ---------- */
  // Profil popisuje, co třída je (kolik má jakých hlavní, zda je dálková, rychlá, odolná...). Používá se k výběru
  // modulů, k odvození vzhledu i k hodnocení třídy botem.
  function profile(c) {
    const p = {
      nBar: c.barrels.length, nFront: 0, nRear: 0, nSide: 0, nTur: 0, nDrone: 0, nTrap: 0, nGun: 0, nMissile: 0, nBomb: 0,
      avgW: 0, avgLen: 0, maxDmg: 0, maxPierce: 0, maxBounce: 0, blast: false, fan: false, coreTur: false, bSpd: 1, spreadMax: 0,
    };
    let wS = 0, lS = 0, sS = 0, nF = 0;
    for (const b of c.barrels) {
      if (b.turret) { p.nTur++; if (b.dist < 0.15) p.coreTur = true; continue; }
      if (b.kind === 'drone') { p.nDrone++; continue; }
      if (b.kind === 'trap') { p.nTrap++; continue; }
      p.nGun++;
      if (b.kind === 'missile') p.nMissile++; else if (b.kind === 'bomb') p.nBomb++;
      if (isFront(b)) { p.nFront++; nF++; wS += b.w; lS += b.len; sS += b.spd; if (Math.abs(angDiff(0, b.a)) > 0.15) p.fan = true; }
      else if (isRear(b)) p.nRear++; else p.nSide++;
      p.maxDmg = Math.max(p.maxDmg, b.dmg); p.maxPierce = Math.max(p.maxPierce, b.pierce || 0); p.maxBounce = Math.max(p.maxBounce, b.bounce || 0);
      p.spreadMax = Math.max(p.spreadMax, b.spread || 0);
      if (b.blast) p.blast = true;
    }
    p.avgW = nF ? wS / nF : 0; p.avgLen = nF ? lS / nF : 0; p.bSpd = nF ? sS / nF : 1;
    // Moduly, které přidávají hlavně na pevný úhel, se nesmí trefit na obsazené místo: occ = strana je obsazená jakoukoli
    // hlavní (i drony a pasti), rimTur = věže na okraji. fSpacing/maxFW hlídají, aby se rozšířené či zdvojené hlavně
    // nesplynuly se sousedem (odstup středů souběžných čelních hlavní a nejširší čelní hlaveň).
    p.occ = SLOTS.map(s => c.barrels.some(b => !b.turret && sameAng(b.a, s)));
    p.rimTur = c.barrels.filter(b => b.turret && b.dist > 0.4).length;
    const fg = c.barrels.filter(b => isGun(b) && isFront(b));
    p.maxFW = fg.reduce((m, b) => Math.max(m, b.w), 0); p.fSpacing = 99;
    for (let i = 0; i < fg.length; i++) for (let j = i + 1; j < fg.length; j++) if (Math.abs(angDiff(fg[i].a, fg[j].a)) < 0.15) p.fSpacing = Math.min(p.fSpacing, Math.abs(fg[i].off - fg[j].off));
    p.minions = c.maxDrones > 0 || c.maxTraps > 0;
    p.sniper = c.range >= 1.35 || c.zoom <= 0.9;
    p.rapid = c.reload <= 0.5;
    p.short = c.range <= 0.6;
    p.fast = c.speed >= 1.1;
    p.tanky = c.hp >= 1.5;
    p.ram = c.ram >= 2;
    p.off = offenseOf(c); p.tough = toughOf(c); p.mob = mobilityOf(c); p.reach = reachOf(c);
    p.power = Math.pow(p.off, 0.55) * Math.pow(p.tough, 0.3) * Math.pow(p.mob, 0.04) * Math.pow(p.reach, 0.15);
    return p;
  }
  // Odhad zranění za sekundu (v násobcích zranění základní střely) při běžném nastavení statistik.
  const REF_RELOAD = 0.3;
  // Jak moc hlaveň při souboji tváří v tvář opravdu zasahuje: čelní hlavně naplno, vějířové jen zčásti (střely míjejí cíl),
  // boční a zadní hlavně jsou spíš pojistka než hlavní zbraň.
  function angW(b) {
    if (b.turret) return 1;
    const t = Math.abs(angDiff(0, b.a));
    return t < 0.15 ? 1 : t < 0.7 ? 0.35 : t < 2.4 ? 0.1 : 0.15;
  }
  function offenseOf(c) {
    const dt = REF_RELOAD * c.reload;
    let gun = 0, dDmg = 0, dRate = 0, dN = 0, tDmg = 0, tRate = 0, tN = 0;
    for (const b of c.barrels) {
      const rate = 1 / (dt * (b.rel || 1));
      if (!b.turret && b.kind === 'drone') { dDmg += b.dmg; dRate += rate; dN++; continue; }
      if (!b.turret && b.kind === 'trap') { tDmg += b.dmg; tRate += rate; tN++; continue; }
      let d = b.dmg * rate;
      if (b.turret) d *= 1.12;                                      // věž míří sama
      else {
        d *= angW(b) / (1 + 2.2 * (b.spread || 0));                  // rozptyl snižuje počet zásahů
        d *= 1 + 0.1 * Math.min(b.pierce || 0, 8) + 0.05 * (b.bounce || 0);
        if (b.blast) d *= 1.15;
        if (b.kind === 'missile') d *= 1.25;
        else if (b.kind === 'bomb') d *= 0.55;                       // bomby pomalu létají a často minou
      }
      d *= 1 + 1.0 * (b.slow || 0) + 0.3 * (b.burn || 0) + 0.035 * ((b.knock || 1) - 1);
      gun += d;
    }
    let minion = 0;
    if (dN) minion += Math.min(c.maxDrones || 0, dRate * 14) * (dDmg / dN) / 0.8 * 0.45;
    if (tN) minion += Math.min(c.maxTraps || 0, tRate * 7.5) * (tDmg / tN) / 0.3 * 0.1;
    return Math.max(0.05, (gun + minion) * (1 + 0.15 * ((c.bhp || 1) - 1)));
  }
  const toughOf = c => c.hp * (1 + 0.12 * ((c.regen || 1) - 1)) * (1 + 2.0 * (c.vamp || 0)) * (1 + 0.06 * ((c.ram || 1) - 1)) / Math.pow(Math.max(0.5, c.size || 1), 0.35);
  const mobilityOf = c => c.speed / Math.pow(Math.max(0.5, c.size || 1), 0.2);
  function reachOf(c) {
    let sp = 0, n = 0;
    for (const b of c.barrels) if (isGun(b) && isFront(b)) { sp += b.spd; n++; }
    return Math.pow(c.range, 0.6) * Math.pow(1 / Math.max(0.5, c.zoom), 0.25) * Math.pow(n ? sp / n : 1, 0.2);
  }
  const powerOf = c => profile(c).power;

  /* ---------- moduly ---------- */
  // Každý modul: id, rodina (sourozenci nesmí mít dva moduly stejné rodiny), nejnižší stupeň, popis, vzhled,
  // podmínka použití ok(profil), příznivost aff(profil) a samotná úprava apply(třída, kontext).
  // Podstatná jména jsou schválně jen rodu mužského, aby se k nim dala přidat přídavná jména ze stejného jazykového
  // tvaru bez skloňování ("Ledový Šíp").
  const TUR_DEF = { dist: 0.7, tsize: 0.3 };
  // Věže dostanou zranění úměrné zbraním rodiče (na plamenometu věž s pevným zraněním přebíjela celou jeho palbu a vyvážení
  // pak ořezávalo jeho vlastní hlavně).
  function turDmg(c, k) {
    const g = (frontGuns(c).length ? frontGuns(c) : c.barrels.filter(isGun)).map(b => b.dmg).sort((x, y) => x - y);
    return clamp(k * (g.length ? g[g.length >> 1] : 1), 0.2, 0.9);
  }
  const STRUCT = [
    { id: 'heavy', fam: 'caliber', min: 2, desc: 'Těžké hlavně, drtivé rány', look: { n: 6, trim: 'ring' }, tone: '#d9a05b', bal: 'reload', caps: ['impact', 'plating', 'fire'],
      nouns: ['Kolos', 'Obr', 'Mamut', 'Hromotluk', 'Bourač', 'Kovář', 'Bizon', 'Kladivář', 'Cyklop', 'Buvol', 'Lamač', 'Rozbíječ'],
      ok: p => p.nFront >= 1 && p.maxDmg < 3 && p.avgW < 1.1 && p.fSpacing >= 1.35 * p.maxFW, aff: p => (p.rapid ? 1.35 : 1) * (p.sniper ? 0.8 : 1),
      apply(c) { for (const b of frontGuns(c)) { b.w *= 1.3; b.len *= 1.05; b.dmg *= 1.5; b.spd *= 0.92; b.size *= 1.12; b.recoil *= 1.4; if (b.w > 0.85) b.flare = true; } c.reload *= 1.3; c.size *= 1.06; c.speed *= 0.97; } },
    { id: 'gatling', fam: 'rate', min: 2, desc: 'Dvojité tenké hlavně, hustá palba', look: { n: 0, trim: 'dots' }, tone: '#f0d36a', bal: 'reload', caps: ['frost', 'fire'],
      nouns: ['Datel', 'Bubeník', 'Metronom', 'Příval', 'Liják', 'Šrapnel', 'Kolibřík', 'Kulometčík', 'Šermíř', 'Cvrček', 'Švihák'],
      ok: p => p.nFront >= 1 && p.nFront <= 3 && p.nBar <= 9 && p.nBomb === 0 && p.avgW >= 0.3 && p.fSpacing >= 1.3 * p.maxFW, aff: p => (p.rapid ? 0.8 : 1.2),
      apply(c) {
        const out = [];
        for (const b of c.barrels) {
          if (isGun(b) && isFront(b) && b.kind !== 'bomb') {
            const w = b.w * 0.56, d = b.w * 0.36, sp = Math.max(b.spread, 0.1);
            out.push(Object.assign({}, b, { w, off: b.off - d, dmg: b.dmg * 0.5, spread: sp, size: b.size * 0.92 }));
            out.push(Object.assign({}, b, { w, off: b.off + d, dmg: b.dmg * 0.5, spread: sp, size: b.size * 0.92, delay: (b.delay + 0.5) % 1 }));
          } else out.push(b);
        }
        c.barrels = out; c.reload *= 0.8;
      } },
    { id: 'longbarrel', fam: 'reach', min: 2, desc: 'Dlouhé hlavně, větší dostřel', look: { n: 0, trim: 'stripe' }, tone: '#9ad0ff', bal: 'dmg', caps: ['frost', 'armorShots'],
      nouns: ['Sokol', 'Jestřáb', 'Kondor', 'Dalekohled', 'Zvěd', 'Teleskop', 'Orlík', 'Albatros', 'Luňák', 'Pozorovatel', 'Horizont'],
      ok: p => p.nFront >= 1 && p.avgLen < 2.4, aff: p => (p.sniper ? 1.3 : 1) * (p.short ? 0.6 : 1),
      apply(c) { for (const b of frontGuns(c)) { b.len = Math.min(3.4, b.len * 1.3); b.w *= 0.86; b.spd *= 1.35; } c.range *= 1.3; c.zoom *= 0.88; c.reload *= 1.1; c.speed *= 0.97; } },
    { id: 'rail', fam: 'pierce', min: 2, desc: 'Střely prorážejí cíle', look: { n: 4, rot: 0.785, trim: '' }, tone: '#b6a4ff', bal: 'dmg', caps: ['scope', 'armorShots', 'frost'],
      nouns: ['Šíp', 'Hrot', 'Oštěp', 'Bodák', 'Trn', 'Vrták', 'Průbojník', 'Dráp', 'Osten', 'Průraz'],
      ok: p => p.nFront >= 1 && p.nFront <= 3 && p.maxPierce <= 2 && p.nMissile === 0 && p.nBomb === 0, aff: p => (p.sniper ? 1.3 : 1),
      apply(c) {
        for (const b of frontGuns(c)) if (b.kind === 'bullet') { b.pierce = Math.min(8, b.pierce + 2); b.w *= 0.82; b.spd *= 1.3; b.dmg *= 0.95; b.len *= 1.12; if (b.w <= 0.7) b.streak = true; }
        c.range *= 1.12; c.reload *= 1.05;
      } },
    { id: 'bounce', fam: 'bounce', min: 2, desc: 'Střely se odrážejí od zdí', look: { n: 0, trim: 'ring' }, tone: '#7fe0c0', bal: 'dmg', caps: ['overclock', 'frost', 'impact'],
      nouns: ['Míč', 'Skokan', 'Bumerang', 'Pérák', 'Odraz', 'Kaučuk', 'Poskok', 'Rikošet', 'Žonglér', 'Kamzík', 'Tenista'],
      ok: p => p.nGun + p.nTur >= 1 && p.maxBounce <= 1 && p.nBomb === 0, aff: () => 0.6,
      apply(c) { for (const b of c.barrels) if ((isGun(b) || b.turret) && b.kind !== 'bomb') b.bounce = Math.min(4, b.bounce + 2); c.range *= 1.2; c.reload *= 1.04; } },
    { id: 'blast', fam: 'blast', min: 2, desc: 'Střely při zásahu vybuchnou', look: { n: 8, trim: 'core' }, tone: '#ff9a4d', bal: 'dmg', caps: ['fire', 'impact', 'plating'],
      nouns: ['Granát', 'Dynamit', 'Střelmistr', 'Ohňostroj', 'Kráter', 'Detonátor', 'Třesk', 'Pyrotechnik', 'Výbuch', 'Zápalník'],
      ok: p => p.nFront >= 1 && !p.blast && p.nGun >= 1, aff: () => 1,
      apply(c) { for (const b of frontGuns(c)) { if (b.kind === 'bullet') { b.blast = 46; b.size *= 1.1; } else b.blast = b.blast ? b.blast * 1.35 : 50; } c.reload *= 1.15; } },
    { id: 'fan', fam: 'spread', min: 2, desc: 'Vějíř střel před sebou', look: { n: 5, trim: '' }, tone: '#ffd24d', bal: 'dmg', caps: ['overclock', 'fire', 'frost'],
      nouns: ['Vějíř', 'Páv', 'Trojzubec', 'Slunečník', 'Kohout', 'Věnec', 'Rozsévač', 'Rozptylovač', 'Tukan', 'Hřeben', 'Ježek'],
      ok: p => p.nFront >= 1 && p.nFront <= 2 && !p.fan && p.nBar <= 10 && p.nBomb === 0, aff: p => (p.short ? 1.3 : 1),
      apply(c, ctx) {
        const g = frontGuns(c).sort((a, b) => Math.abs(a.off) - Math.abs(b.off))[0];
        const angs = ctx.tier >= 4 ? [0.38, -0.38, 0.76, -0.76] : [0.38, -0.38];
        angs.forEach((a, i) => c.barrels.push(Object.assign({}, g, { a, off: 0, len: g.len * (i > 1 ? 0.84 : 0.92), w: Math.min(g.w * 0.78, 0.5), dmg: g.dmg * (i > 1 ? 0.42 : 0.55), delay: i > 1 ? 0.75 : 0.5 })));
        c.reload *= 1.08;
      } },
    { id: 'rear', fam: 'cover', min: 2, desc: 'Střílí i dozadu', look: { n: 0, trim: 'cross' }, tone: '#ff8aa0', bal: 'dmg', caps: ['afterburner', 'vamp', 'plating'],
      nouns: ['Janus', 'Škorpion', 'Štír', 'Zrádce', 'Krab', 'Dvojník', 'Kentaur', 'Chameleon'],
      ok: p => p.nFront >= 1 && p.nBomb === 0 && p.nRear === 0 && !p.occ[3] && p.nBar <= 9, aff: p => (p.fast ? 1.3 : 1),
      apply(c) {
        const add = [];
        for (const b of c.barrels) if (!b.turret && isFront(b) && (b.kind === 'bullet' || b.kind === 'missile' || b.kind === 'trap')) add.push(Object.assign({}, b, { a: b.a + PI, dmg: b.dmg * 0.7, len: b.len * 0.92, delay: (b.delay + 0.5) % 1 }));
        c.barrels.push(...add); c.reload *= 1.06;
      } },
    { id: 'cross', fam: 'cover', min: 2, desc: 'Palba i do stran', look: { n: 4, rot: 0, trim: 'cross' }, tone: '#ff8aa0', bal: 'dmg', caps: ['overclock', 'vamp', 'afterburner'],
      nouns: ['Kříž', 'Křižák', 'Kompas', 'Větrník', 'Čtyřlístek', 'Kardinál', 'Templář', 'Rozcestník', 'Satelit'],
      ok: p => p.nSide === 0 && !p.occ[1] && !p.occ[2] && p.nBar <= 9 && p.nGun >= 1, aff: () => 1,
      apply(c) {
        const g = frontGuns(c)[0] || c.barrels.find(isGun);
        const s = (a) => B({ a, len: 1.2, w: Math.min(0.5, g.w * 0.8), dmg: g.dmg * 0.55, spd: g.spd, delay: 0.25, spread: g.spread });
        c.barrels.push(s(PI / 2), s(-PI / 2)); c.reload *= 1.08;
      } },
    { id: 'turretPair', fam: 'turret', min: 2, desc: 'Dvě samočinné věže po stranách', look: { n: 7, trim: 'core' }, tone: '#9aa8ff', bal: 'dmg', caps: ['frost', 'plating', 'vamp'],
      nouns: ['Hlídač', 'Dozorce', 'Strážník', 'Gardista', 'Obránce', 'Pobočník', 'Štítonoš', 'Pohraničník'],
      ok: p => p.nTur <= 2 && p.rimTur === 0 && p.nBar <= 11, aff: () => 1,
      apply(c) { const d = turDmg(c, 0.5); c.barrels.push(TUR(Object.assign({ a: PI / 2, dmg: d }, TUR_DEF)), TUR(Object.assign({ a: -PI / 2, dmg: d }, TUR_DEF))); c.reload *= 1.04; } },
    { id: 'turretRing', fam: 'turret', min: 3, desc: 'Čtyři samočinné věže dokola', look: { n: 8, trim: 'ring' }, tone: '#9aa8ff', bal: 'dmg', caps: ['plating', 'overclock', 'frost'],
      nouns: ['Dělostřelec', 'Kanonýr', 'Arzenál', 'Kastelán', 'Zbrojíř', 'Zbrojmistr', 'Zbrojnoš'],
      ok: p => p.nTur <= 1 && p.rimTur === 0 && p.nBar <= 10, aff: p => (p.tanky ? 1.3 : 1),
      apply(c) { const d = turDmg(c, 0.5); [0.78, 2.36, -0.78, -2.36].forEach(a => c.barrels.push(TUR(Object.assign({ a, dmg: d }, TUR_DEF)))); c.reload *= 1.06; c.speed *= 0.97; } },
    { id: 'turretCore', fam: 'turret', min: 2, desc: 'Samočinná věž uprostřed', look: { n: 0, trim: 'core' }, tone: '#9aa8ff', bal: 'dmg', caps: ['overclock', 'vamp', 'frost'],
      nouns: ['Reaktor', 'Generátor', 'Magnet', 'Atom', 'Pulsar', 'Kvazar', 'Motor', 'Nukleon', 'Proton'],
      ok: p => p.nTur <= 2 && !p.coreTur && p.nBar <= 12, aff: () => 1,
      apply(c) { c.barrels.push(TUR({ dist: 0, dmg: turDmg(c, 0.6), tsize: 0.4 })); } },
    { id: 'mainGun', fam: 'turret', min: 2, desc: 'Přibylo hlavní dělo vpředu', look: { n: 6, trim: 'core' }, tone: '#d9a05b', bal: 'dmg', caps: ['impact', 'plating', 'fire'],
      nouns: ['Kanón', 'Moždíř', 'Falkon', 'Mušketýr', 'Arkebuzír', 'Galeon', 'Korzár', 'Pirát'],
      ok: p => !p.occ[0] && p.nTur >= 1 && p.nGun === 0, aff: () => 3,
      apply(c) { c.barrels.push(B({ len: 1.55, w: 0.6, dmg: 1.1, spd: 1.1 })); c.reload *= 1.1; } },
    { id: 'swift', fam: 'body', min: 2, desc: 'Hbitý, s tryskami vzadu', look: { n: 3, fins: 2, trim: '' }, tone: '#7fe0ff', bal: 'dmg', caps: ['vamp', 'frost'],
      nouns: ['Gepard', 'Chrt', 'Jelen', 'Zajíc', 'Mustang', 'Pstruh', 'Větřík', 'Rychlík', 'Sprinter', 'Kojot', 'Šakal'],
      ok: p => !p.fast && !p.occ[3], aff: p => (p.tanky ? 0.5 : 1.1),
      apply(c) {
        c.speed *= 1.2; c.size *= 0.9; c.hp *= 0.88;
        c.barrels.push(B({ a: PI - 0.32, len: 1.2, w: 0.3, dmg: 0.3, size: 0.6, recoil: 3 }), B({ a: PI + 0.32, len: 1.2, w: 0.3, dmg: 0.3, size: 0.6, recoil: 3, delay: 0.5 }));
      } },
    { id: 'bulwark', fam: 'body', min: 2, desc: 'Silný pancíř, ale pomalejší', look: { n: 8, plates: 4, trim: '' }, tone: '#9fb0c0', bal: 'dmg', caps: ['impact', 'vamp', 'fire'],
      nouns: ['Bunkr', 'Pancíř', 'Nosorožec', 'Pásovec', 'Kyrysník', 'Obrněnec', 'Rytíř', 'Golem', 'Hroch', 'Štít', 'Val', 'Monolit', 'Balvan', 'Granit'],
      ok: p => !p.tanky, aff: p => (p.fast ? 1.2 : 1),
      apply(c) { c.hp *= 1.55; c.size *= 1.12; c.speed *= 0.88; c.ram *= 1.25; } },
    { id: 'ram', fam: 'body', min: 2, desc: 'Beran: náraz a boj zblízka', look: { n: 0, spikes: 6, trim: '' }, tone: '#d98c4d', bal: 'dmg', caps: ['impact', 'vamp', 'plating'],
      nouns: ['Beran', 'Kanec', 'Kozorožec', 'Jezevec', 'Divočák', 'Tur', 'Taran', 'Berserk', 'Býk'],
      ok: p => !p.ram && !p.sniper, aff: p => (p.short ? 1.4 : 0.8),
      apply(c) { c.ram *= 2.4; c.hp *= 1.3; c.speed *= 1.08; c.range *= 0.75; for (const b of c.barrels) if (isGun(b)) { b.len *= 0.92; b.dmg *= 0.92; } } },
    { id: 'hive', fam: 'minion', min: 2, desc: 'Víc dronů', look: { n: 6, trim: 'dots' }, tone: '#f0c14b', bal: 'dmg', caps: ['fire', 'vamp', 'plating'],
      nouns: ['Úl', 'Sršeň', 'Čmelák', 'Mravenec', 'Trubec', 'Včelař', 'Chovatel', 'Pastýř', 'Mrak'],
      ok: p => p.nDrone >= 1 && p.nBar <= 10 && p.occ.some(o => !o), aff: () => 1.5,
      apply(c) {
        const d = c.barrels.find(b => !b.turret && b.kind === 'drone');
        let added = 0;
        for (const a of [PI / 2, -PI / 2, PI, 0]) {
          if (added >= 2) break;
          if (c.barrels.some(b => !b.turret && sameAng(b.a, a))) continue;
          c.barrels.push(Object.assign({}, d, { a, off: 0, delay: added ? 0.5 : 0.25 })); added++;
        }
        c.maxDrones = Math.round(c.maxDrones * 1.35) + 2;
      } },
    { id: 'bigdrones', fam: 'minionB', min: 2, desc: 'Méně dronů, ale větší a silnější', look: { n: 6, trim: 'ring' }, tone: '#f0c14b', bal: 'dmg', caps: ['impact', 'plating', 'fire'],
      nouns: ['Roháč', 'Chrobák', 'Nosorožík', 'Střevlík', 'Brouk', 'Škvor', 'Pavouk', 'Tesařík', 'Svižník', 'Zlatohlávek', 'Kovařík'],
      ok: p => p.nDrone >= 1, aff: () => 1.2,
      apply(c) { for (const b of c.barrels) if (!b.turret && b.kind === 'drone') { b.dmg *= 1.5; b.hp *= 1.5; b.size *= 1.3; } c.maxDrones = Math.max(2, Math.round(c.maxDrones * 0.65)); c.reload *= 1.25; } },
    { id: 'swarmlets', fam: 'minionC', min: 2, desc: 'Hejno drobných dronů', look: { n: 5, trim: 'dots' }, tone: '#f0c14b', bal: 'dmg', caps: ['frost', 'overclock', 'vamp'],
      nouns: ['Komár', 'Pakomár', 'Svatojánek', 'Hmyz', 'Šváb', 'Mol', 'Chrostík', 'Ovád'],
      ok: p => p.nDrone >= 1 && p.nBar <= 10, aff: () => 1.1,
      apply(c) { for (const b of c.barrels) if (!b.turret && b.kind === 'drone') { b.size *= 0.75; b.dmg *= 0.72; } c.maxDrones = Math.round(c.maxDrones * 1.8); c.reload *= 0.8; } },
    { id: 'carrier', fam: 'minion', min: 2, desc: 'Navíc vypouští drony', look: { n: 6, trim: 'stripe' }, tone: '#f0c14b', bal: 'dmg', caps: ['plating', 'vamp', 'overclock'],
      nouns: ['Nosič', 'Hangár', 'Admirál', 'Komodor', 'Kapitán', 'Dopravce', 'Pilot', 'Maršál', 'Generál', 'Kormidelník'],
      ok: p => p.nDrone === 0 && p.nBar <= 8 && p.nGun >= 1 && !p.occ[1] && !p.occ[2], aff: p => (p.minions ? 0.6 : 1),
      apply(c) {
        const dr = a => B({ a, len: 1.25, w: 0.7, dmg: 0.55, spd: 0.65, size: 0.8, kind: 'drone', flare: true, delay: a > 0 ? 0 : 0.5 });
        c.barrels.push(dr(PI / 2), dr(-PI / 2)); c.maxDrones = Math.max(c.maxDrones, 5); c.reload *= 1.1;
      } },
    { id: 'bunker', fam: 'minion', min: 2, desc: 'Odolné, obrovské pasti', look: { n: 4, plates: 4, trim: 'cross' }, tone: '#9fb0c0', bal: 'dmg', caps: ['frost', 'fire'],
      nouns: ['Kazamat', 'Sklep', 'Okop', 'Příkop', 'Žalář', 'Sejf', 'Trezor', 'Sklad'],
      ok: p => p.nTrap >= 1, aff: () => 1.5,
      apply(c) { for (const b of c.barrels) if (!b.turret && b.kind === 'trap') { b.hp *= 1.7; b.size *= 1.25; } c.maxTraps = Math.max(3, Math.round(c.maxTraps * 0.8)); c.reload *= 1.15; } },
    { id: 'spiketrap', fam: 'minionB', min: 2, desc: 'Ostré pasti, větší zranění', look: { n: 4, spikes: 4, trim: '' }, tone: '#d98c4d', bal: 'dmg', caps: ['fire', 'impact', 'vamp'],
      nouns: ['Bodlák', 'Kaktus', 'Dikobraz', 'Střep', 'Cep', 'Pichlák'],
      ok: p => p.nTrap >= 1, aff: () => 1.2,
      apply(c) { for (const b of c.barrels) if (!b.turret && b.kind === 'trap') { b.dmg *= 1.5; b.size *= 0.92; b.spd *= 1.1; } c.reload *= 1.1; } },
    { id: 'minefield', fam: 'minionC', min: 2, desc: 'Víc pastí najednou', look: { n: 4, rot: 0.785, trim: 'dots' }, tone: '#f0c14b', bal: 'dmg', caps: ['frost', 'overclock', 'vamp'],
      nouns: ['Sapér', 'Ženista', 'Kopáč', 'Hrobník', 'Krtek', 'Šachtař', 'Hlodavec', 'Zahradník'],
      ok: p => p.nTrap >= 1, aff: () => 1.3,
      apply(c) { for (const b of c.barrels) if (!b.turret && b.kind === 'trap') b.spd *= 1.12; c.maxTraps = Math.round(c.maxTraps * 1.7); c.reload *= 0.82; } },
    { id: 'trapify', fam: 'minion', min: 2, desc: 'Zadní pasti kryjí ústup', look: { n: 5, trim: 'cross' }, tone: '#f0c14b', bal: 'dmg', caps: ['afterburner', 'frost', 'plating'],
      nouns: ['Lapač', 'Chytač', 'Kapkán', 'Pytlák', 'Zálesák', 'Trapér', 'Stopař'],
      ok: p => p.nTrap === 0 && p.nBar <= 9 && p.nFront >= 1 && !p.occ[3], aff: () => 1,
      apply(c) { c.barrels.push(B({ a: PI, len: 1.3, w: 0.8, dmg: 1.1, spd: 0.9, size: 1.4, kind: 'trap', flare: true, recoil: 0.5 })); c.maxTraps = Math.max(c.maxTraps, 6); c.reload *= 1.06; } },
    { id: 'lob', fam: 'blast', min: 3, desc: 'Vrhá bomby s výbuchem', look: { n: 5, trim: 'ring' }, tone: '#ff9a4d', bal: 'dmg', caps: ['fire', 'impact', 'scope'],
      nouns: ['Katapult', 'Trebuchet', 'Odpalovač', 'Prak', 'Vrhač', 'Minometčík', 'Granátomet', 'Obléhatel'],
      ok: p => p.nFront >= 1 && p.nFront <= 2 && p.nBomb === 0 && p.nMissile === 0 && p.fSpacing >= 1.05 * Math.max(0.8, p.maxFW), aff: p => (p.sniper ? 1.2 : 1),
      apply(c) {
        for (const b of frontGuns(c)) { b.kind = 'bomb'; b.lob = true; b.blast = 70; b.dmg *= 1.6; b.spd *= 0.8; b.size *= 1.4; b.flare = true; b.recoil *= 1.5; b.len *= 0.85; b.w = Math.max(b.w, 0.8); b.pierce = 0; b.streak = false; }
        c.reload *= 1.5; c.range *= 1.1;
      } },
    { id: 'homing', fam: 'seek', min: 3, desc: 'Naváděné střely', look: { n: 3, trim: 'stripe' }, tone: '#ff8aa0', bal: 'dmg', caps: ['fire', 'frost', 'scope'],
      nouns: ['Honič', 'Ohař', 'Slídil', 'Sokolník', 'Lovčí', 'Detektiv', 'Slídič', 'Vlčák'],
      ok: p => p.nFront >= 1 && p.nFront <= 3 && p.nMissile === 0 && p.nBomb === 0, aff: () => 1,
      apply(c) { for (const b of frontGuns(c)) { b.kind = 'missile'; b.spd *= 0.85; b.dmg *= 1.05; b.size *= 0.9; b.flare = true; b.pierce = 0; b.streak = false; b.spread = 0; } c.reload *= 1.1; } },
    { id: 'twin', fam: 'rate', min: 2, desc: 'Dvojitá hlaveň, střídavá palba', look: { n: 7, trim: 'stripe' }, tone: '#f0d36a', bal: 'reload', caps: ['frost', 'vamp'],
      nouns: ['Blíženec', 'Kastor', 'Pollux', 'Tandem', 'Duet', 'Dvoják'],
      ok: p => p.nFront === 1 && p.nBar <= 8 && p.nBomb === 0 && p.avgW <= 1.2, aff: () => 1,
      apply(c) {
        const out = [];
        for (const b of c.barrels) {
          if (isGun(b) && isFront(b) && b.kind !== 'bomb') {
            out.push(Object.assign({}, b, { w: b.w * 0.8, off: b.off - 0.5, dmg: b.dmg * 0.62 }), Object.assign({}, b, { w: b.w * 0.8, off: b.off + 0.5, dmg: b.dmg * 0.62, delay: (b.delay + 0.5) % 1 }));
          } else out.push(b);
        }
        c.barrels = out;
      } },
  ];

  const CAPS = [
    { id: 'frost', desc: 'Zásah zpomalí soupeře', tone: '#8fd8ff',
      adjs: ['Ledový', 'Mrazivý', 'Polární', 'Zamrzlý', 'Sněžný', 'Zimní', 'Chladný', 'Křišťálový', 'Severský'],
      ok: p => p.nGun + p.nTur + p.nDrone + p.nTrap > 0, apply(c) { for (const b of c.barrels) b.slow = Math.max(b.slow || 0, 0.32); } },
    { id: 'fire', desc: 'Zapaluje zasažené cíle', tone: '#ff8a3d',
      adjs: ['Ohnivý', 'Žhavý', 'Plamenný', 'Planoucí', 'Sopečný', 'Rozžhavený', 'Spalující', 'Pekelný', 'Doutnající'],
      ok: p => p.nGun + p.nTur + p.nDrone + p.nTrap > 0, apply(c) { for (const b of c.barrels) b.burn = Math.max(b.burn || 0, 0.4); } },
    { id: 'vamp', desc: 'Zásahy tě léčí', tone: '#d1405a',
      adjs: ['Upíří', 'Krvavý', 'Krvelačný', 'Noční', 'Temný', 'Přízračný', 'Stínový', 'Rudý', 'Hladový', 'Záhrobní'],
      ok: () => true, apply(c) { c.vamp = Math.max(c.vamp || 0, 0.1); for (const b of c.barrels) b.dmg *= 0.96; } },
    { id: 'impact', desc: 'Střely odhazují soupeře', tone: '#c9a15a',
      adjs: ['Drtivý', 'Dunivý', 'Nárazový', 'Rázový', 'Hřmotný', 'Mocný', 'Zdrcující', 'Bouřlivý'],
      ok: p => p.nGun + p.nTur >= 1, apply(c) { for (const b of c.barrels) if (isGun(b) || b.turret) { b.knock = Math.max(b.knock || 1, 2.4); b.size *= 1.08; b.recoil *= 1.15; } } },
    { id: 'plating', desc: 'Pevnější a rychleji se léčí', tone: '#9fb0c0',
      adjs: ['Pancéřový', 'Ocelový', 'Železný', 'Neprůstřelný', 'Kovový', 'Obrněný', 'Chromový', 'Titanový', 'Pevný', 'Litinový'],
      ok: (p, s) => s.id !== 'bulwark' && s.id !== 'bunker', apply(c) { c.hp *= 1.28; c.regen *= 1.35; c.size *= 1.05; c.speed *= 0.95; } },
    { id: 'overclock', desc: 'Rychlejší nabíjení', tone: '#ffe14d',
      adjs: ['Přetaktovaný', 'Zběsilý', 'Rozpálený', 'Horečný', 'Divoký', 'Splašený', 'Nabuzený', 'Elektrický', 'Neúnavný', 'Svižný'],
      ok: (p, s) => s.bal !== 'reload', apply(c) { c.reload *= 0.86; for (const b of c.barrels) if (isGun(b) || b.turret) b.dmg *= 0.97; } },
    { id: 'scope', desc: 'Větší dostřel a rychlejší střely', tone: '#b6f0a0',
      adjs: ['Orlí', 'Dalekozraký', 'Bystrozraký', 'Jasnozřivý', 'Přesný', 'Zaměřený', 'Dálkový', 'Ostrozraký', 'Dalekonosný'],
      ok: (p, s) => p.nFront >= 1 && s.id !== 'longbarrel', apply(c) { c.range *= 1.2; c.zoom *= 0.9; for (const b of frontGuns(c)) b.spd *= 1.15; } },
    { id: 'afterburner', desc: 'Vyšší rychlost pohybu', tone: '#7fe0ff',
      adjs: ['Bleskový', 'Raketový', 'Rychlý', 'Pádící', 'Větrný', 'Letící', 'Zrychlený', 'Proudový', 'Tryskový', 'Hbitý'],
      ok: (p, s) => s.id !== 'swift' && !p.fast, apply(c) { c.speed *= 1.14; } },
    { id: 'armorShots', desc: 'Odolnější střely', tone: '#c0c8d0',
      adjs: ['Tvrdý', 'Nezdolný', 'Vytrvalý', 'Houževnatý', 'Neústupný', 'Odolný', 'Žilavý', 'Nezničitelný', 'Nepoddajný'],
      ok: p => p.nGun + p.nTur + p.nDrone + p.nTrap > 0, apply(c) { c.bhp *= 1.6; for (const b of c.barrels) if (isGun(b)) b.size *= 1.04; } },
  ];
  const STRUCT_BY = {}; for (const k of STRUCT) STRUCT_BY[k.id] = k;
  const CAP_BY = {}; for (const k of CAPS) CAP_BY[k.id] = k;

  // Záložní jména, kdyby se vyčerpala jména modulu (v praxi to nenastane).
  const SPARE = ['Drak', 'Gryf', 'Fénix', 'Kraken', 'Bazilišek', 'Minotaur', 'Chrlič', 'Vlkodlak', 'Troll', 'Ogr', 'Trpaslík', 'Čaroděj', 'Alchymista', 'Šaman', 'Poutník', 'Žoldnéř'];

  /* ---------- sestavení jednoho potomka ---------- */
  const GROWTH = { 1: 1.04, 2: 1.07, 3: 1.07, 4: 1.13 };      // o kolik je potomek tohoto stupně silnější než rodič
  // Korekce zranění podle měření (souboje potomků s rodiči): model síly některé moduly nadhodnocuje a jiné podceňuje.
  // Tabulka se dá znovu odvodit kalibračním měřením; 1 = bez korekce.
  const FIX = {
    /*FIX*/
    afterburner: 0.929, armorShots: 0.942, bigdrones: 1.032, blast: 1.036, bounce: 1.058, bulwark: 1.118, bunker: 0.948, carrier: 0.912, cross: 1.012, fan: 1.071, fire: 0.927, frost: 1.012, gatling: 0.964, heavy: 1.016, hive: 0.984, homing: 1.039, impact: 1.013, lob: 2.239, longbarrel: 0.886, mainGun: 0.820, minefield: 1.207, overclock: 0.962, plating: 0.966, rail: 1.042, ram: 1.080, rear: 1.130, scope: 0.940, spiketrap: 1.153, swarmlets: 0.970, swift: 0.880, trapify: 1.650, turretCore: 0.994, turretPair: 1.064, turretRing: 1.307, twin: 0.951, vamp: 1.047,
    /*END*/
  };
  const BOUNDS = { reload: [0.12, 4.5], speed: [0.6, 1.5], hp: [0.6, 3.2], size: [0.78, 1.9], range: [0.3, 2.4], zoom: [0.55, 1], ram: [0.8, 4], regen: [0.8, 3], bhp: [0.8, 3], vamp: [0, 0.3] };
  function clampClass(c) {
    for (const k in BOUNDS) c[k] = clamp(c[k], BOUNDS[k][0], BOUNDS[k][1]);
    c.maxDrones = Math.min(24, Math.round(c.maxDrones)); c.maxTraps = Math.min(26, Math.round(c.maxTraps));
    for (const b of c.barrels) { b.len = clamp(b.len, 0.5, 3.6); b.w = clamp(b.w, 0.14, 2.2); b.dmg = Math.max(0.05, b.dmg); b.delay = ((b.delay % 1) + 1) % 1; }
  }
  // Vyvážení: sílu potomka srovná na cílovou hodnotu změnou zranění (nebo rychlosti nabíjení u modulů, které na to míří).
  function balance(c, target, how) {
    for (let it = 0; it < 4; it++) {
      const r = target / powerOf(c);
      if (Math.abs(r - 1) < 0.01) break;
      const k = clamp(Math.pow(r, 1 / 0.55), 0.55, 1.8);
      if (how === 'reload' && !(c.maxDrones > 0 || c.maxTraps > 0)) c.reload = clamp(c.reload / k, BOUNDS.reload[0], BOUNDS.reload[1]);
      else for (const b of c.barrels) b.dmg *= k;
    }
  }
  function build(parent, struct, cap, tier) {
    const c = cloneClass(parent);
    c.tier = tier;
    const p = profile(parent);
    struct.apply(c, { tier, parent: p });
    if (cap) cap.apply(c, { tier });
    clampClass(c);
    c.struct = struct.id; c.cap = cap ? cap.id : '';
    c.look = Object.assign({ n: 0, rot: 0, spikes: 0, fins: 0, plates: 0, trim: '' }, struct.look, { tone: (cap || struct).tone });
    return c;
  }
  // Dokončení potomka: vyvážení na cílovou sílu a korekce podle měření.
  function finalize(c, target, struct, cap) {
    balance(c, target, struct.bal);
    const fx = (FIX[struct.id] || 1) * (cap ? (FIX[cap.id] || 1) : 1);
    if (fx !== 1) for (const b of c.barrels) b.dmg *= fx;
    clampClass(c);
    return c;
  }
  // Potomek rodiče s daným modulem (a případně korunním modulem) bez zápisu do stromu - pro měření a testy.
  function make(parentId, structId, capId) {
    const base = CLASSES[parentId], st = STRUCT_BY[structId], cap = capId ? CAP_BY[capId] : null;
    const tier = base.tier + 1;
    const c = build(base, st, cap, tier);
    return finalize(c, profile(base).power * (GROWTH[tier] || 1), st, cap);
  }

  // Totéž jen s korunním modulem (bez strukturního) - měří se tím čistý vliv korunního modulu.
  function makeCap(parentId, capId) {
    const base = CLASSES[parentId], cap = CAP_BY[capId], tier = base.tier + 1;
    const c = cloneClass(base); c.tier = tier;
    cap.apply(c, { tier }); clampClass(c); c.struct = 'none'; c.cap = cap.id;
    return finalize(c, profile(base).power * (GROWTH[tier] || 1), { id: 'none', bal: 'dmg' }, cap);
  }

  /* ---------- výběr modulů pro rodiče ---------- */
  // Znak, podle kterého se sourozenci liší: dvojice (strukturní rodina) a příznaky z hlaveň.
  function featureSet(c) {
    const p = profile(c), f = new Set();
    if (p.nRear) f.add('cover'); if (p.nSide) f.add('cover'); if (p.fan) f.add('spread');
    if (p.nTur) f.add('turret'); if (p.maxPierce >= 2) f.add('pierce'); if (p.maxBounce) f.add('bounce');
    if (p.blast || p.nBomb) f.add('blast'); if (p.nDrone || p.nTrap) f.add('minion'); if (p.nMissile) f.add('seek');
    if (p.sniper) f.add('reach'); if (p.rapid) f.add('rate'); if (p.fast || p.tanky || p.ram) f.add('body');
    return f;
  }
  // Seřadí použitelné moduly podle toho, jak se k rodiči hodí (příznivost, trocha náhody, ruční sourozenci se stejným
  // zaměřením se potlačí). Rodinu modulu pak hlídá volající, aby sourozenci nebyli dvakrát stejného druhu.
  // Šum pro dvojici (klíč rodiče, modul): stejný vstup dává vždy stejné číslo, bez ohledu na to, co se vybíralo před tím.
  const jit = (...parts) => seeded(hashStr(parts.join('|')))();
  function rankKits(parent, siblings, key, tier) {
    const pp = profile(parent);
    const taken = new Set();
    for (const s of siblings) for (const f of featureSet(s)) taken.add(f);
    return STRUCT.filter(k => k.min <= tier && k.ok(pp))
      .map(k => ({ k, w: k.aff(pp) * (0.6 + jit(key, k.id) * 0.8) * (taken.has(k.fam) ? 0.5 : 1) }))
      .sort((x, y) => y.w - x.w).map(x => x.k);
  }
  function pickCap(parentProf, struct, usedCaps, key) {
    const pool = CAPS.filter(k => k.ok(parentProf, struct));
    const scored = pool.map(k => ({ k, w: (struct.caps.indexOf(k.id) >= 0 ? 2.2 : 1) * (usedCaps.has(k.id) ? 0.1 : 1) * (0.7 + jit(key, struct.id, k.id) * 0.6) }));
    scored.sort((a, b) => b.w - a.w);
    return scored.length ? scored[0].k : null;
  }

  /* ---------- jména ---------- */
  // Dvouslovná jména se píšou jako u ručně navržených tříd (první slovo velkým, podstatné jméno malým, kromě vlastních jmen),
  // přídavné jméno nesmí mít stejný kořen jako podstatné ("Drtivý drtič", "Svižný svižník").
  const PROPER = new Set(['Janus', 'Kastor', 'Pollux', 'Pérák']);
  const fold = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const sameRoot = (a, b) => fold(a).slice(0, 4) === fold(b).slice(0, 4);
  const compose = (adj, n) => adj + ' ' + (PROPER.has(n) ? n : n.charAt(0).toLowerCase() + n.slice(1));
  function nameFor(struct, cap, rng, used) {
    const nouns = shuffled(struct.nouns, rng);
    if (!cap) {
      for (const n of nouns) if (!used.has(n)) return n;
    } else {
      const adjs = shuffled(cap.adjs, rng);
      for (const n of nouns) for (const a of adjs) { if (sameRoot(a, n)) continue; const nm = compose(a, n); if (!used.has(nm)) return nm; }
    }
    for (const n of shuffled(SPARE, rng)) { const nm = cap ? compose(cap.adjs[0], n) : n; if (!used.has(nm)) return nm; }
    let i = 2; const base = struct.nouns[0]; while (used.has(base + ' ' + i)) i++;
    return base + ' ' + i;
  }

  /* ---------- hlavní průchod: doplnění stromu ---------- */
  // Potomek musí vypadat jinak než rodič i než sourozenci (podle silueta()), jinak se zkusí další modul.
  function fill() {
    const used = new Set(); for (const id in CLASSES) used.add(CLASSES[id].name);
    let made = 0;
    for (let tier = 0; tier <= 3; tier++) {
      for (const id of Object.keys(CLASSES)) {
        const base = CLASSES[id];
        if (!base || base.boss || base.tier !== tier) continue;
        const kids = TREE[id] || (TREE[id] = []);
        const need = 4 - kids.length; if (need <= 0) continue;
        const ct = tier + 1;                                           // stupeň potomků
        const key = id + '|' + tier;                                     // z něj se odvozuje všechen šum pro tohoto rodiče
        const sibs = kids.map(k => CLASSES[k]);
        const pp = profile(base);
        // cílová síla: rodič * růst (pokud mají ruční sourozenci jinou sílu, vezmeme střed)
        let target = pp.power * GROWTH[ct];
        if (sibs.length) { const sp = sibs.map(s => profile(s).power).sort((x, y) => x - y); target = Math.sqrt(target * sp[Math.floor(sp.length / 2)]); }
        const seen = new Set([silhouette(Object.assign({}, base, { look: lookFor(base) }))]);
        for (const s of sibs) seen.add(silhouette(Object.assign({}, s, { look: lookFor(s) })));
        const ranked = rankKits(base, sibs, key, ct);
        const usedCaps = new Set(), usedFam = new Set();
        const accepted = [];
        for (const relax of [false, true]) {
          for (const st of ranked) {
            if (accepted.length >= need) break;
            if (accepted.some(a => a.st === st) || (!relax && usedFam.has(st.fam))) continue;
            const cap = ct >= 4 ? pickCap(pp, st, usedCaps, key) : null;
            const c = build(base, st, cap, ct);
            const sg = silhouette(c);
            if (seen.has(sg)) continue;
            seen.add(sg); usedFam.add(st.fam); if (cap) usedCaps.add(cap.id);
            accepted.push({ st, cap, c });
          }
        }
        for (const { st, cap, c } of accepted) {
          finalize(c, target, st, cap);
          c.name = nameFor(st, cap, seeded(hashStr(key + '|' + st.id + '|' + (cap ? cap.id : ''))), used); used.add(c.name);
          c.info = cap ? st.desc + '. ' + cap.desc : st.desc;
          const childId = id + '_' + st.id + (cap ? '_' + cap.id : '');
          CLASSES[childId] = C(c);
          kids.push(childId); made++;
        }
      }
    }
    return { made };
  }

  /* ---------- vzhled odvozený z vlastností třídy (pro třídy bez ručně zadaného vzhledu) ---------- */
  function lookFor(c) {
    if (c.look) return c.look;
    const p = profile(c), h = hashStr(c.name || 'x');
    const L = { n: 0, rot: 0, spikes: 0, fins: 0, plates: 0, trim: '', tone: '' };
    if (p.nDrone) { L.n = 6; L.trim = 'dots'; L.tone = '#f0c14b'; }
    else if (p.nTrap) { L.n = 4; L.trim = 'cross'; L.tone = '#f0c14b'; }
    else if (p.nTur >= 3) { L.trim = 'ring'; L.tone = '#9aa8ff'; }
    else if (p.nTur) { L.trim = 'core'; L.tone = '#9aa8ff'; }
    else if (p.nBomb || p.blast) { L.n = 8; L.trim = 'core'; L.tone = '#ff9a4d'; }
    else if (p.sniper) { L.trim = 'stripe'; L.tone = '#9ad0ff'; }
    else if (p.rapid) { L.trim = 'dots'; L.tone = '#f0d36a'; }
    if (p.fast) { L.n = 3; L.fins = 2; L.tone = L.tone || '#7fe0ff'; }
    if (p.tanky) { L.n = 8; L.plates = 4; L.tone = L.tone || '#9fb0c0'; }
    if (p.ram) { L.spikes = 6; L.tone = L.tone || '#d98c4d'; }
    if (!L.n && (h % 7 === 0)) L.n = 5;                              // pár tříd navíc s jiným tělem pro pestrost
    return L;
  }
  // Silueta: to, co je na tanku vidět na první pohled (hlavně, těleso, doplňky). Dvě třídy se stejnou siluetou
  // vypadají stejně. Podpis navíc zahrnuje značky střel (průraz, odraz, výbuch, mráz, oheň...).
  function silhouette(c) {
    const bs = c.barrels.map(b => [b.turret ? 'T' : b.kind === 'bomb' ? 'o' : b.kind[0], Math.round(b.a * 4), Math.round(b.len * 3), Math.round(b.w * 6), Math.round(b.off * 4), Math.round((b.dist || 0) * 4), b.flare ? 1 : 0].join('.')).sort();
    const L = c.look || {};
    return bs.join('|') + '#' + [L.n || 0, L.spikes || 0, L.fins || 0, L.plates || 0, L.trim || ''].join('.') + '#' + Math.round((c.size || 1) * 10);
  }

  const TRIMS = ['', 'ring', 'stripe', 'dots', 'core', 'cross'];
  // Doplní vzhled a profil všem třídám (volá se po definici všech stupňů). Ručně navržené třídy, které by vypadaly stejně
  // jako rodič nebo sourozenec, dostanou jiné zdobení.
  function finish() {
    for (const id in CLASSES) {
      const c = CLASSES[id];
      if (c.boss) continue;
      c.look = lookFor(c);
    }
    for (const pid in TREE) {
      const par = CLASSES[pid]; if (!par || par.boss || par.tier >= 4) continue;
      const seen = new Set([silhouette(par)]);
      for (const kid of TREE[pid]) {
        const c = CLASSES[kid]; let guard = 0;
        while (seen.has(silhouette(c)) && guard++ < 40) {
          const L = c.look;
          if (guard <= TRIMS.length) L.trim = TRIMS[(TRIMS.indexOf(L.trim) + 1) % TRIMS.length];
          else if (guard <= TRIMS.length + 6) L.n = [0, 3, 4, 5, 6, 8][(guard) % 6];
          else L.plates = (L.plates + 1) % 6;
        }
        seen.add(silhouette(c));
      }
    }
    for (const id in CLASSES) if (!CLASSES[id].boss) CLASSES[id].prof = profile(CLASSES[id]);
  }

  // fill() se volá z ascension.js, až když jsou definované i ruční třídy vyšších stupňů a bossové (jejich jména se nesmí použít podruhé).
  const api = { STRUCT, CAPS, STRUCT_BY, CAP_BY, make, makeCap, FIX, profile, powerOf, offenseOf, toughOf, mobilityOf, reachOf, lookFor, finish, silhouette, featureSet, hashStr, seeded, GROWTH, made: 0 };
  api.fill = () => { api.made = fill().made; return api.made; };
  return api;
})();
