// Třídy tanků 0.-3. stupně (ručně navržené), továrny na hlavně a třídy, strom vývoje.
/* ---------- třídy tanků ---------- */
const B = o => { const b = Object.assign({ a: 0, len: 1.55, w: 0.6, off: 0, rel: 1, delay: 0, dmg: 1, spd: 1, spread: 0, size: 1, recoil: 1, hp: 1, kind: 'bullet', flare: false, pierce: 0, bounce: 0, blast: 0, lob: false, streak: false, turret: false, dist: 0, tsize: 0.34 }, o); b.len += 0.18; return b; };
const C = o => Object.assign({ reload: 1, speed: 1, zoom: 1, range: 1, maxDrones: 0, maxTraps: 0, hp: 1, ram: 1, size: 1, boss: false, bn: 6, info: '' }, o);
const ring = (n, o, alt) => Array.from({ length: n }, (_, i) => B(Object.assign({ a: i * TAU / n, delay: alt && (i & 1) ? 0.5 : 0 }, o)));
const TRAP = { kind: 'trap', flare: true, recoil: 0.5 };
const CLASSES = {
  basic: C({ name: 'Základní', tier: 0, barrels: [B({})] }),

  /* ===== 1. stupeň ===== */
  twin: C({ name: 'Dvojče', tier: 1, info: 'Dvě hlavně střídavě', barrels: [B({ len: 1.5, w: 0.42, off: -0.5, dmg: 0.65 }), B({ len: 1.5, w: 0.42, off: 0.5, dmg: 0.65, delay: 0.5 })] }),
  sniper: C({ name: 'Ostřelovač', tier: 1, info: 'Dálka a přesnost', reload: 1.6, zoom: 0.86, range: 1.45, speed: 0.95, barrels: [B({ len: 2.1, w: 0.5, dmg: 1.25, spd: 1.5 })] }),
  mg: C({ name: 'Kulomet', tier: 1, info: 'Rychlá palba, rozptyl', reload: 0.42, barrels: [B({ len: 1.4, w: 0.85, dmg: 0.6, spd: 0.95, spread: 0.2, size: 0.9, flare: true })] }),
  flank: C({ name: 'Křídlo', tier: 1, info: 'Střílí dopředu i dozadu', barrels: [B({ len: 1.5, w: 0.55, dmg: 0.8 }), B({ a: PI, len: 1.5, w: 0.55, dmg: 0.8 })] }),
  trapper: C({ name: 'Pastičkář', tier: 1, info: 'Klade pasti, které zůstanou ležet', reload: 1.9, speed: 0.98, maxTraps: 9, barrels: [B(Object.assign({ len: 1.3, w: 0.8, dmg: 1.15, spd: 0.9, size: 1.4 }, TRAP))] }),

  /* ===== 2. stupeň ===== */
  triple: C({ name: 'Trojitý', tier: 2, info: 'Vějíř tří střel', reload: 1.15, barrels: [B({ a: -0.5, len: 1.4, w: 0.42, dmg: 0.6 }), B({ a: 0.5, len: 1.4, w: 0.42, dmg: 0.6 }), B({ len: 1.7, w: 0.42, dmg: 0.6, delay: 0.35 })] }),
  twinflank: C({ name: 'Dvojité křídlo', tier: 2, info: 'Dvojče vpředu i vzadu', reload: 1.1, barrels: [
    B({ len: 1.5, w: 0.4, off: -0.5, dmg: 0.55 }), B({ len: 1.5, w: 0.4, off: 0.5, dmg: 0.55, delay: 0.5 }),
    B({ a: PI, len: 1.5, w: 0.4, off: -0.5, dmg: 0.55 }), B({ a: PI, len: 1.5, w: 0.4, off: 0.5, dmg: 0.55, delay: 0.5 })] }),
  gunner: C({ name: 'Střelec', tier: 2, info: 'Čtyři tenké hlavně, hustá palba', reload: 0.74, barrels: [-0.78, -0.26, 0.26, 0.78].map((off, i) => B({ len: i === 1 || i === 2 ? 1.62 : 1.42, w: 0.28, off, dmg: 0.33, spd: 1.05, size: 0.9, delay: i % 2 ? 0.5 : 0 })) }),

  assassin: C({ name: 'Zabiják', tier: 2, info: 'Extrémní dostřel a síla', reload: 2.0, zoom: 0.74, range: 1.7, speed: 0.9, barrels: [B({ len: 2.5, w: 0.5, dmg: 1.9, spd: 1.9 })] }),
  hunter: C({ name: 'Lovec', tier: 2, info: 'Dvě hlavně nad sebou', reload: 1.7, zoom: 0.82, range: 1.45, speed: 0.95, barrels: [B({ len: 2.2, w: 0.36, dmg: 0.8, spd: 1.55 }), B({ len: 1.75, w: 0.62, dmg: 1.15, spd: 1.4, delay: 0.4 })] }),
  overseer: C({ name: 'Velitel', tier: 2, info: 'Roj naváděných dronů', reload: 2.2, zoom: 0.9, maxDrones: 6, barrels: [
    B({ a: PI / 2, len: 1.25, w: 0.75, dmg: 0.6, spd: 0.6, size: 0.8, kind: 'drone', flare: true }),
    B({ a: -PI / 2, len: 1.25, w: 0.75, dmg: 0.6, spd: 0.6, size: 0.8, kind: 'drone', flare: true, delay: 0.5 })] }),

  destroyer: C({ name: 'Ničitel', tier: 2, info: 'Pomalé obří střely', reload: 2.8, speed: 0.95, barrels: [B({ len: 1.6, w: 1.25, dmg: 4.2, spd: 0.7, recoil: 4 })] }),
  sprayer: C({ name: 'Rozprašovač', tier: 2, info: 'Kulomet + přesná hlaveň', reload: 0.4, barrels: [
    B({ len: 1.4, w: 0.85, dmg: 0.5, spd: 0.95, spread: 0.28, size: 0.85, flare: true }),
    B({ len: 1.95, w: 0.36, dmg: 0.55, rel: 1.5, delay: 0.5, spd: 1.1 })] }),
  flamer: C({ name: 'Plamenomet', tier: 2, info: 'Krátký dosah, obří škody', reload: 0.15, range: 0.34, barrels: [B({ len: 1.3, w: 1.0, dmg: 0.27, spd: 0.85, spread: 0.24, size: 1.2, recoil: 0.15, flare: true })] }),
  shotgun: C({ name: 'Brokovnice', tier: 2, info: 'Pět broků, krátký dosah', reload: 1.3, range: 0.55, barrels: [-0.14, -0.07, 0, 0.07, 0.14].map((a, i) => B({ a, len: 1.35, w: 0.4, dmg: 0.4, spd: 0.9 + (i % 3) * 0.08, spread: 0.07, size: 0.85, recoil: 0.5 })) }),

  quad: C({ name: 'Čtyřhlaveň', tier: 2, info: 'Palba na čtyři strany', reload: 1.05, barrels: [0, PI / 2, PI, -PI / 2].map(a => B({ a, len: 1.5, w: 0.5, dmg: 0.75 })) }),
  triangle: C({ name: 'Trojúhelník', tier: 2, info: 'Rychlý, střílí dozadu', speed: 1.14, barrels: [
    B({ len: 1.6, w: 0.55, dmg: 1 }), B({ a: 2.5, len: 1.3, w: 0.4, dmg: 0.5, recoil: 2.5 }), B({ a: -2.5, len: 1.3, w: 0.4, dmg: 0.5, recoil: 2.5 })] }),
  fortress: C({ name: 'Pevnost', tier: 2, info: 'Odolná, střílí vpřed i vzad', reload: 1.05, speed: 0.9, hp: 1.6, ram: 1.5, barrels: [B({ len: 1.4, w: 0.7, dmg: 0.85, flare: true }), B({ a: PI, len: 1.4, w: 0.7, dmg: 0.85, flare: true })] }),

  minelayer: C({ name: 'Minér', tier: 2, info: 'Tři pasti najednou', reload: 2.2, maxTraps: 12, barrels: [-0.3, 0, 0.3].map((a, i) => B(Object.assign({ a, len: 1.3, w: 0.6, dmg: 1, spd: 0.85, size: 1.3, recoil: 0.4, delay: i === 1 ? 0.3 : 0 }, { kind: 'trap', flare: true }))) }),
  builder: C({ name: 'Stavitel', tier: 2, info: 'Větší a odolnější pasti', reload: 2.3, speed: 0.95, maxTraps: 10, barrels: [
    B(Object.assign({ len: 1.3, w: 0.95, off: -0.35, dmg: 1.2, spd: 0.85, size: 1.5, hp: 1.5 }, TRAP)),
    B(Object.assign({ len: 1.3, w: 0.95, off: 0.35, dmg: 1.2, spd: 0.85, size: 1.5, hp: 1.5, delay: 0.5 }, TRAP))] }),
  gunTrapper: C({ name: 'Střelec pastí', tier: 2, info: 'Vpředu pasti, vzadu kulky', reload: 1.5, maxTraps: 7, barrels: [
    B(Object.assign({ len: 1.3, w: 0.8, dmg: 1.2, spd: 0.9, size: 1.4 }, TRAP)),
    B({ a: PI, len: 1.4, w: 0.6, dmg: 0.5, rel: 0.4, spd: 1.0, spread: 0.1, flare: true })] }),

  /* ===== 3. stupeň ===== */
  penta: C({ name: 'Pětinásobný', tier: 3, info: 'Vějíř pěti střel', reload: 1.3, barrels: [
    B({ a: -0.86, len: 1.3, w: 0.38, dmg: 0.5 }), B({ a: 0.86, len: 1.3, w: 0.38, dmg: 0.5 }),
    B({ a: -0.43, len: 1.5, w: 0.4, dmg: 0.5, delay: 0.33 }), B({ a: 0.43, len: 1.5, w: 0.4, dmg: 0.5, delay: 0.33 }),
    B({ len: 1.8, w: 0.42, dmg: 0.55, delay: 0.66 })] }),
  spreadshot: C({ name: 'Rozptyl', tier: 3, info: 'Široký vějíř, spousta střel', reload: 1.4, barrels: [
    B({ a: -0.84, len: 1.45, w: 0.3, dmg: 0.36 }), B({ a: 0.84, len: 1.45, w: 0.3, dmg: 0.36 }),
    B({ a: -0.56, len: 1.6, w: 0.32, dmg: 0.38, delay: 0.25 }), B({ a: 0.56, len: 1.6, w: 0.32, dmg: 0.38, delay: 0.25 }),
    B({ a: -0.28, len: 1.75, w: 0.34, dmg: 0.4, delay: 0.5 }), B({ a: 0.28, len: 1.75, w: 0.34, dmg: 0.4, delay: 0.5 }),
    B({ len: 1.95, w: 0.46, dmg: 0.9, spd: 1.15, delay: 0.75 })] }),
  hexa: C({ name: 'Šestihlaveň', tier: 3, info: 'Tři dvojčata kolem dokola', reload: 1.15, barrels: [0, TAU / 3, 2 * TAU / 3].flatMap((a, k) => [
    B({ a, off: -0.5, len: 1.5, w: 0.4, dmg: 0.55, delay: k * 0.17 }), B({ a, off: 0.5, len: 1.5, w: 0.4, dmg: 0.55, delay: 0.5 + k * 0.17 })]) }),
  cruiser: C({ name: 'Křižník', tier: 3, info: 'Silné dvojče vpředu, krytí vzadu', reload: 1.1, barrels: [
    B({ len: 1.55, w: 0.5, off: -0.5, dmg: 0.7 }), B({ len: 1.55, w: 0.5, off: 0.5, dmg: 0.7, delay: 0.5 }),
    B({ a: PI, len: 1.45, w: 0.42, off: -0.5, dmg: 0.45 }), B({ a: PI, len: 1.45, w: 0.42, off: 0.5, dmg: 0.45, delay: 0.5 }),
    B({ a: PI / 2, len: 1.3, w: 0.4, dmg: 0.4, delay: 0.25 }), B({ a: -PI / 2, len: 1.3, w: 0.4, dmg: 0.4, delay: 0.25 })] }),
  vulcan: C({ name: 'Vulkán', tier: 3, info: 'Šest tenkých hlavní, palebná bouře', reload: 0.6, barrels: [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0].map((off, i) => B({ len: i === 2 || i === 3 ? 1.75 : 1.55, w: 0.22, off, dmg: 0.24, spd: 1.1, size: 0.9, delay: i / 6 })) }),
  salvo: C({ name: 'Salva', tier: 3, info: 'Těžká hlaveň a čtyři pomocné', reload: 0.95, barrels: [
    B({ len: 2.05, w: 0.5, dmg: 0.85, spd: 1.2, rel: 1.3 }),
    B({ len: 1.6, w: 0.28, off: -0.7, dmg: 0.3 }), B({ len: 1.6, w: 0.28, off: 0.7, dmg: 0.3, delay: 0.5 }),
    B({ len: 1.4, w: 0.26, off: -1.0, dmg: 0.28, delay: 0.25 }), B({ len: 1.4, w: 0.26, off: 1.0, dmg: 0.28, delay: 0.75 })] }),

  ranger: C({ name: 'Ostrostřelec', tier: 3, info: 'Nejdelší dostřel, obří síla', reload: 2.4, zoom: 0.6, range: 2.1, speed: 0.85, barrels: [B({ len: 2.9, w: 0.48, dmg: 2.5, spd: 2.1 })] }),
  stalker: C({ name: 'Stíhač', tier: 3, info: 'Rychlý zabiják na dálku', reload: 1.75, zoom: 0.78, range: 1.6, speed: 1.12, barrels: [B({ len: 2.6, w: 0.44, dmg: 1.6, spd: 1.9 })] }),
  predator: C({ name: 'Predátor', tier: 3, info: 'Tři hlavně nad sebou', reload: 1.9, zoom: 0.78, range: 1.5, speed: 0.93, barrels: [
    B({ len: 2.55, w: 0.3, dmg: 0.65, spd: 1.6 }), B({ len: 2.1, w: 0.48, dmg: 0.95, spd: 1.5, delay: 0.3 }), B({ len: 1.7, w: 0.7, dmg: 1.35, spd: 1.4, delay: 0.6 })] }),
  streamliner: C({ name: 'Proudnice', tier: 3, info: 'Nepřetržitý proud střel', reload: 0.9, zoom: 0.84, range: 1.35, speed: 0.95, barrels: [0, 1, 2, 3, 4].map(i => B({ len: 2.35 - i * 0.2, w: 0.26, dmg: 0.32, spd: 1.5, delay: i * 0.2 })) }),
  overlord: C({ name: 'Vládce', tier: 3, info: 'Osm dronů ze čtyř stran', reload: 2.3, zoom: 0.88, maxDrones: 8, barrels: [0, PI / 2, PI, -PI / 2].map((a, i) => B({ a, len: 1.25, w: 0.75, dmg: 0.62, spd: 0.6, size: 0.8, kind: 'drone', flare: true, delay: i * 0.25 })) }),
  swarm: C({ name: 'Hejno', tier: 3, info: 'Spousta drobných rychlých dronů', reload: 0.9, zoom: 0.92, maxDrones: 12, barrels: [
    B({ a: -0.55, len: 1.25, w: 0.5, dmg: 0.28, spd: 0.85, size: 0.6, kind: 'drone', flare: true }),
    B({ a: 0.55, len: 1.25, w: 0.5, dmg: 0.28, spd: 0.85, size: 0.6, kind: 'drone', flare: true, delay: 0.5 })] }),

  annihilator: C({ name: 'Anihilátor', tier: 3, info: 'Jedna gigantická střela', reload: 3.6, speed: 0.9, barrels: [B({ len: 1.7, w: 1.75, dmg: 7.5, spd: 0.7, recoil: 6 })] }),
  hybrid: C({ name: 'Hybrid', tier: 3, info: 'Ničitel a zadní drony', reload: 2.9, speed: 0.95, maxDrones: 3, barrels: [
    B({ len: 1.6, w: 1.1, dmg: 3.7, spd: 0.7, recoil: 4 }), B({ a: PI, len: 1.2, w: 0.8, dmg: 0.55, spd: 0.6, size: 0.8, kind: 'drone', flare: true, rel: 0.7 })] }),
  hurricane: C({ name: 'Hurikán', tier: 3, info: 'Dva kulomety a přesná hlaveň', reload: 0.45, barrels: [
    B({ len: 1.4, w: 0.8, off: -0.4, dmg: 0.36, spd: 0.95, spread: 0.26, size: 0.85, flare: true }),
    B({ len: 1.4, w: 0.8, off: 0.4, dmg: 0.36, spd: 0.95, spread: 0.26, size: 0.85, flare: true, delay: 0.5 }),
    B({ len: 2.0, w: 0.34, dmg: 0.5, rel: 1.4, delay: 0.25, spd: 1.15 })] }),
  cannonade: C({ name: 'Kanonáda', tier: 3, info: 'Přesný kulomet na dálku', reload: 0.34, range: 1.3, zoom: 0.88, speed: 0.96, barrels: [B({ len: 2.0, w: 0.5, dmg: 0.55, spd: 1.35, spread: 0.05 })] }),
  inferno: C({ name: 'Inferno', tier: 3, info: 'Dvojitý plamenomet', reload: 0.13, range: 0.36, barrels: [
    B({ len: 1.3, w: 0.9, off: -0.45, dmg: 0.19, spd: 0.85, spread: 0.24, size: 1.1, recoil: 0.1, flare: true }),
    B({ len: 1.3, w: 0.9, off: 0.45, dmg: 0.19, spd: 0.85, spread: 0.24, size: 1.1, recoil: 0.1, flare: true, delay: 0.5 })] }),
  vichr: C({ name: 'Vichr', tier: 3, info: 'Široký kužel ohně', reload: 0.16, range: 0.32, barrels: [-0.38, 0, 0.38].map((a, i) => B({ a, len: 1.25, w: 0.8, dmg: 0.17, spd: 0.85, spread: 0.2, size: 1.0, recoil: 0.1, flare: true, delay: i / 3 })) }),
  ravager: C({ name: 'Zpustošitel', tier: 3, info: 'Sedm broků, drtí zblízka', reload: 1.15, range: 0.55, barrels: [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3].map((a, i) => B({ a, len: 1.4, w: 0.4, dmg: 0.42, spd: 0.9 + (i % 3) * 0.08, spread: 0.07, size: 0.85, recoil: 0.5 })) }),
  canister: C({ name: 'Kartáč', tier: 3, info: 'Tři těžké broky zblízka', reload: 1.6, range: 0.42, barrels: [-0.22, 0, 0.22].map(a => B({ a, len: 1.4, w: 0.65, dmg: 0.95, spd: 0.85, spread: 0.06, size: 1.0, recoil: 1.2, flare: true })) }),

  octo: C({ name: 'Osmihlaveň', tier: 3, info: 'Palba na osm stran', reload: 1.0, barrels: ring(8, { len: 1.5, w: 0.42, dmg: 0.5 }, true) }),
  pentagram: C({ name: 'Pentagram', tier: 3, info: 'Pět silných hlavní dokola', reload: 1.0, barrels: ring(5, { len: 1.6, w: 0.5, dmg: 0.75 }, true) }),
  fighter: C({ name: 'Stíhačka', tier: 3, info: 'Rychlá, střílí do všech stran', speed: 1.16, reload: 1.05, barrels: [
    B({ len: 1.6, w: 0.55, dmg: 1 }), B({ a: PI / 2, len: 1.3, w: 0.4, dmg: 0.5, delay: 0.5 }), B({ a: -PI / 2, len: 1.3, w: 0.4, dmg: 0.5, delay: 0.5 }),
    B({ a: 2.5, len: 1.3, w: 0.4, dmg: 0.5, recoil: 2.5 }), B({ a: -2.5, len: 1.3, w: 0.4, dmg: 0.5, recoil: 2.5 })] }),
  thruster: C({ name: 'Tryska', tier: 3, info: 'Extrémní rychlost, zadní trysky', speed: 1.3, reload: 1.0, barrels: [
    B({ len: 1.6, w: 0.55, dmg: 0.95 }),
    B({ a: PI - 0.3, len: 1.3, w: 0.36, dmg: 0.4, recoil: 3 }), B({ a: PI + 0.3, len: 1.3, w: 0.36, dmg: 0.4, recoil: 3, delay: 0.5 }),
    B({ a: PI - 0.85, len: 1.25, w: 0.34, dmg: 0.35, recoil: 3, delay: 0.25 }), B({ a: PI + 0.85, len: 1.25, w: 0.34, dmg: 0.35, recoil: 3, delay: 0.75 })] }),
  citadel: C({ name: 'Citadela', tier: 3, info: 'Nezdolná tvrz se čtyřmi hlavněmi', speed: 0.8, hp: 2.3, ram: 2.0, reload: 1.1, barrels: ring(4, { len: 1.35, w: 0.72, dmg: 0.72, flare: true }) }),
  berserker: C({ name: 'Berserker', tier: 3, info: 'Rychlý beran, pálí jen zblízka', speed: 1.14, hp: 1.7, ram: 3.0, reload: 1.3, range: 0.7, barrels: [
    B({ len: 1.3, w: 0.5, dmg: 0.55 }), B({ a: 2.7, len: 1.2, w: 0.4, dmg: 0.4 }), B({ a: -2.7, len: 1.2, w: 0.4, dmg: 0.4 })] }),

  minefield: C({ name: 'Minové pole', tier: 3, info: 'Pět pastí najednou', reload: 2.4, maxTraps: 18, barrels: [-0.6, -0.3, 0, 0.3, 0.6].map((a, i) => B(Object.assign({ a, len: 1.25, w: 0.55, dmg: 0.85, spd: 0.75 + (i % 2) * 0.15, size: 1.2, recoil: 0.4 }, { kind: 'trap', flare: true }))) }),
  sneak: C({ name: 'Zákeřník', tier: 3, info: 'Dvě obří pomalé pasti', reload: 1.9, maxTraps: 8, barrels: [
    B(Object.assign({ len: 1.3, w: 1.0, off: -0.4, dmg: 1.7, spd: 0.6, size: 1.6, hp: 1.8 }, TRAP)),
    B(Object.assign({ len: 1.3, w: 1.0, off: 0.4, dmg: 1.7, spd: 0.6, size: 1.6, hp: 1.8, delay: 0.5 }, TRAP))] }),
  engineer: C({ name: 'Inženýr', tier: 3, info: 'Obří pevné zátarasy', reload: 1.7, hp: 1.15, maxTraps: 10, barrels: [B(Object.assign({ len: 1.3, w: 1.15, dmg: 1.9, spd: 0.85, size: 1.9, hp: 2.2, recoil: 0.7 }, { kind: 'trap', flare: true }))] }),
  barricader: C({ name: 'Opevňovač', tier: 3, info: 'Pasti do stran i dopředu', reload: 1.5, speed: 0.97, maxTraps: 14, barrels: [
    B(Object.assign({ a: 1.05, len: 1.25, w: 0.8, dmg: 1.1, spd: 0.8, size: 1.4, hp: 1.4 }, TRAP)),
    B(Object.assign({ a: -1.05, len: 1.25, w: 0.8, dmg: 1.1, spd: 0.8, size: 1.4, hp: 1.4, delay: 0.5 }, TRAP)),
    B(Object.assign({ len: 1.3, w: 0.8, dmg: 1.1, spd: 0.9, size: 1.4, hp: 1.4, delay: 0.25 }, TRAP))] }),
  siege: C({ name: 'Obléhač', tier: 3, info: 'Velká past vpředu, kulomet vzadu', reload: 1.4, maxTraps: 8, barrels: [
    B(Object.assign({ len: 1.3, w: 0.95, dmg: 1.5, spd: 0.9, size: 1.6, hp: 1.6, recoil: 0.6 }, { kind: 'trap', flare: true })),
    B({ a: PI, len: 1.4, w: 0.55, off: -0.35, dmg: 0.5, rel: 0.55, spd: 1.05, spread: 0.12, flare: true }),
    B({ a: PI, len: 1.4, w: 0.55, off: 0.35, dmg: 0.5, rel: 0.55, spd: 1.05, spread: 0.12, flare: true, delay: 0.5 })] }),
  guardian: C({ name: 'Strážce', tier: 3, info: 'Dvě pasti vpředu, dvě hlavně vzadu', reload: 1.5, maxTraps: 10, barrels: [
    B(Object.assign({ len: 1.3, w: 0.7, off: -0.4, dmg: 1.2, spd: 0.9, size: 1.35, hp: 1.3 }, TRAP)),
    B(Object.assign({ len: 1.3, w: 0.7, off: 0.4, dmg: 1.2, spd: 0.9, size: 1.35, hp: 1.3, delay: 0.5 }, TRAP)),
    B({ a: PI, len: 1.4, w: 0.5, off: -0.4, dmg: 0.5, rel: 0.6, spd: 1.05, spread: 0.1 }),
    B({ a: PI, len: 1.4, w: 0.5, off: 0.4, dmg: 0.5, rel: 0.6, spd: 1.05, spread: 0.1, delay: 0.5 })] }),
};
const TREE = {
  basic: ['twin', 'sniper', 'mg', 'flank', 'trapper'],
  twin: ['triple', 'twinflank', 'gunner'],
  sniper: ['assassin', 'hunter', 'overseer'],
  mg: ['destroyer', 'sprayer', 'flamer', 'shotgun'],
  flank: ['quad', 'triangle', 'fortress'],
  trapper: ['minelayer', 'builder', 'gunTrapper'],
  triple: ['penta', 'spreadshot'], twinflank: ['hexa', 'cruiser'], gunner: ['vulcan', 'salvo'],
  assassin: ['ranger', 'stalker'], hunter: ['predator', 'streamliner'], overseer: ['overlord', 'swarm'],
  destroyer: ['annihilator', 'hybrid'], sprayer: ['hurricane', 'cannonade'], flamer: ['inferno', 'vichr'], shotgun: ['ravager', 'canister'],
  quad: ['octo', 'pentagram'], triangle: ['fighter', 'thruster'], fortress: ['citadel', 'berserker'],
  minelayer: ['minefield', 'sneak'], builder: ['engineer', 'barricader'], gunTrapper: ['siege', 'guardian'],
};


/* ---------- nové mechaniky: věže, průraz, odraz, rakety, bomby ---------- */
const TUR = o => B(Object.assign({ turret: true, dist: 0.6, len: 1.0, w: 0.5, tsize: 0.34, dmg: 0.5, spd: 1.1, size: 0.85, recoil: 0 }, o));
Object.assign(CLASSES, {
  /* 1. stupeň */
  autoT: C({ name: 'Věžař', tier: 1, info: 'Hlaveň a samočinná věž', barrels: [B({ len: 1.45, w: 0.55, dmg: 0.75 }), TUR({ dist: 0, dmg: 0.45, tsize: 0.36 })] }),

  /* 2. stupeň */
  auto3: C({ name: 'Trojvěž', tier: 2, info: 'Tři samočinné věže střílí samy', reload: 1.0, barrels: [0, TAU / 3, 2 * TAU / 3].map(a => TUR({ a, dist: 0.62, dmg: 0.62 })) }),
  autoGun: C({ name: 'Dvojče s věží', tier: 2, info: 'Dvojče a samočinná věž', reload: 1.05, barrels: [
    B({ len: 1.5, w: 0.4, off: -0.5, dmg: 0.55 }), B({ len: 1.5, w: 0.4, off: 0.5, dmg: 0.55, delay: 0.5 }), TUR({ dist: 0, dmg: 0.5, tsize: 0.4 })] }),
  autoSnp: C({ name: 'Ostřelec s věžemi', tier: 2, info: 'Dálka a dvě boční věže', reload: 1.5, zoom: 0.86, range: 1.45, speed: 0.95, barrels: [
    B({ len: 2.1, w: 0.5, dmg: 1.25, spd: 1.5 }), TUR({ a: PI / 2, dist: 0.72, dmg: 0.5 }), TUR({ a: -PI / 2, dist: 0.72, dmg: 0.5 })] }),
  bouncer: C({ name: 'Odražeč', tier: 2, info: 'Střely se odrážejí od zdí', reload: 1.0, range: 1.4, barrels: [
    B({ len: 1.5, w: 0.42, off: -0.5, dmg: 0.7, bounce: 2 }), B({ len: 1.5, w: 0.42, off: 0.5, dmg: 0.7, bounce: 2, delay: 0.5 })] }),
  rail: C({ name: 'Kolejnice', tier: 2, info: 'Střela prorazí několik cílů', reload: 2.1, zoom: 0.8, range: 1.6, speed: 0.92, barrels: [B({ len: 2.4, w: 0.36, dmg: 1.5, spd: 2.6, pierce: 4, streak: true, size: 0.8 })] }),
  rocket: C({ name: 'Raketomet', tier: 2, info: 'Naváděné rakety', reload: 1.5, barrels: [
    B({ len: 1.4, w: 0.6, off: -0.4, dmg: 1.05, spd: 0.8, kind: 'missile', size: 0.9, flare: true }),
    B({ len: 1.4, w: 0.6, off: 0.4, dmg: 1.05, spd: 0.8, kind: 'missile', size: 0.9, flare: true, delay: 0.5 })] }),
  mortar: C({ name: 'Minomet', tier: 2, info: 'Vrhá bomby na zvolené místo', reload: 2.4, speed: 0.95, range: 1.6, barrels: [
    B({ len: 1.2, w: 0.95, dmg: 1.6, spd: 0.75, size: 1.5, kind: 'bomb', lob: true, blast: 85, flare: true, recoil: 2 })] }),

  /* 3. stupeň */
  auto5: C({ name: 'Pětivěž', tier: 3, info: 'Pět samočinných věží dokola', reload: 1.0, barrels: ring(5, { turret: true, dist: 0.72, len: 1.0, w: 0.5, tsize: 0.3, dmg: 0.55, spd: 1.1, size: 0.85, recoil: 0 }) }),
  autoStorm: C({ name: 'Věžová smršť', tier: 3, info: 'Šest rychlých věží', reload: 0.72, barrels: [0, 1, 2].flatMap(k => [
    TUR({ a: k * TAU / 3, dist: 0.78, dmg: 0.42, tsize: 0.28 }), TUR({ a: k * TAU / 3 + PI / 3, dist: 0.3, dmg: 0.42, tsize: 0.28, delay: 0.5 })]) }),
  autoTwin: C({ name: 'Dvojče se dvěma věžemi', tier: 3, info: 'Dvojče a dvě věže po stranách', reload: 1.0, barrels: [
    B({ len: 1.55, w: 0.42, off: -0.5, dmg: 0.62 }), B({ len: 1.55, w: 0.42, off: 0.5, dmg: 0.62, delay: 0.5 }),
    TUR({ a: PI / 2, dist: 0.72, dmg: 0.55 }), TUR({ a: -PI / 2, dist: 0.72, dmg: 0.55 })] }),
  autoBattle: C({ name: 'Bojová věž', tier: 3, info: 'Těžké dělo a čtyři věže', reload: 2.2, speed: 0.92, barrels: [
    B({ len: 1.6, w: 1.1, dmg: 3.2, spd: 0.75, recoil: 3 }), ...[0.9, 2.3, -0.9, -2.3].map(a => TUR({ a, dist: 0.7, dmg: 0.45, tsize: 0.3 }))] }),
  autoGuard: C({ name: 'Strážný ostřelec', tier: 3, info: 'Zabiják se dvěma rychlými věžemi', reload: 2.0, zoom: 0.76, range: 1.7, speed: 0.9, barrels: [
    B({ len: 2.5, w: 0.5, dmg: 1.9, spd: 1.9 }), TUR({ a: PI / 2, dist: 0.72, dmg: 0.6, spd: 1.4 }), TUR({ a: -PI / 2, dist: 0.72, dmg: 0.6, spd: 1.4 })] }),
  autoFort: C({ name: 'Pevnost s věžemi', tier: 3, info: 'Odolná tvrz se čtyřmi věžemi', reload: 1.0, speed: 0.88, hp: 1.7, ram: 1.4, barrels: [0.78, 2.36, -0.78, -2.36].map(a => TUR({ a, dist: 0.68, dmg: 0.6, tsize: 0.34 })) }),
  pinball: C({ name: 'Pinball', tier: 3, info: 'Čtyři odrážející se střely', reload: 1.05, range: 1.7, barrels: ring(4, { len: 1.5, w: 0.45, dmg: 0.6, bounce: 3 }, true) }),
  billiard: C({ name: 'Kulečník', tier: 3, info: 'Velké odrazivé koule', reload: 1.3, range: 1.6, barrels: [-0.28, 0, 0.28].map((a, i) => B({ a, len: 1.5, w: 0.6, dmg: 1.0, size: 1.35, bounce: 3, delay: i * 0.3 })) }),
  rail2: C({ name: 'Dvojkolejnice', tier: 3, info: 'Dvě průrazné hlavně', reload: 1.9, zoom: 0.8, range: 1.6, speed: 0.9, barrels: [
    B({ len: 2.4, w: 0.3, off: -0.45, dmg: 1.15, spd: 2.6, pierce: 4, streak: true, size: 0.8 }), B({ len: 2.4, w: 0.3, off: 0.45, dmg: 1.15, spd: 2.6, pierce: 4, streak: true, size: 0.8, delay: 0.5 })] }),
  lancer: C({ name: 'Kopiník', tier: 3, info: 'Nejdelší dostřel, prorazí vše', reload: 2.8, zoom: 0.66, range: 2.0, speed: 0.85, barrels: [B({ len: 3.0, w: 0.4, dmg: 2.4, spd: 3.0, pierce: 8, streak: true, size: 0.8 })] }),
  swarmer: C({ name: 'Roj střel', tier: 3, info: 'Pět malých naváděných střel', reload: 1.7, barrels: [-0.5, -0.25, 0, 0.25, 0.5].map((a, i) => B({ a, len: 1.35, w: 0.42, dmg: 0.5, spd: 0.85, kind: 'missile', size: 0.7, delay: i * 0.2 })) }),
  seeker: C({ name: 'Hledač', tier: 3, info: 'Obří střela s výbuchem', reload: 2.6, barrels: [B({ len: 1.45, w: 1.0, dmg: 3.0, spd: 0.75, kind: 'missile', size: 1.2, blast: 70, flare: true, recoil: 2 })] }),
  howitzer: C({ name: 'Houfnice', tier: 3, info: 'Obří výbuch z dálky', reload: 3.4, speed: 0.9, range: 2.1, barrels: [B({ len: 1.3, w: 1.15, dmg: 3.0, spd: 0.8, size: 1.8, kind: 'bomb', lob: true, blast: 130, flare: true, recoil: 3 })] }),
  grenadier: C({ name: 'Granátník', tier: 3, info: 'Tři menší bomby v řadě', reload: 2.2, range: 1.5, barrels: [-0.3, 0, 0.3].map((a, i) => B({ a, len: 1.2, w: 0.7, dmg: 0.95, spd: 0.75, size: 1.2, kind: 'bomb', lob: true, blast: 62, flare: true, delay: i * 0.25, recoil: 1 })) }),

  /* bossové (mimo strom, jen pro AI) */
  boss_guard: C({ name: 'Ochránce', tier: 9, boss: true, bn: 8, size: 2.7, hp: 14, ram: 1.6, speed: 0.62, reload: 1.15, range: 1.1, barrels: [...ring(6, { len: 1.35, w: 0.6, dmg: 0.6 }, true), B({ len: 1.9, w: 0.8, dmg: 1.4 })] }),
  boss_crusher: C({ name: 'Drtič', tier: 9, boss: true, bn: 3, size: 2.3, hp: 11, ram: 3.2, speed: 1.25, reload: 1.8, barrels: [B({ len: 1.3, w: 0.6, dmg: 0.5 }), B({ a: PI, len: 1.3, w: 0.6, dmg: 0.5 })] }),
  boss_hive: C({ name: 'Hnízdo', tier: 9, boss: true, bn: 6, size: 2.5, hp: 12, ram: 1.2, speed: 0.72, reload: 0.8, maxDrones: 16, barrels: [0, PI / 2, PI, -PI / 2].map((a, i) => B({ a, len: 1.25, w: 0.75, dmg: 0.55, spd: 0.7, size: 0.75, kind: 'drone', flare: true, delay: i * 0.25 })) }),
  boss_tower: C({ name: 'Věž', tier: 9, boss: true, bn: 4, size: 2.6, hp: 13, ram: 1.4, speed: 0.34, reload: 1.0, barrels: ring(6, { turret: true, dist: 0.76, len: 1.0, w: 0.5, tsize: 0.24, dmg: 0.7, spd: 1.1, size: 0.85, recoil: 0 }) }),
});
Object.assign(TREE, {
  basic: ['twin', 'sniper', 'mg', 'flank', 'trapper', 'autoT'],
  twin: ['triple', 'twinflank', 'gunner', 'bouncer'],
  sniper: ['assassin', 'hunter', 'overseer', 'rail'],
  mg: ['destroyer', 'sprayer', 'flamer', 'shotgun', 'rocket'],
  trapper: ['minelayer', 'builder', 'gunTrapper', 'mortar'],
  autoT: ['auto3', 'autoGun', 'autoSnp'],
  auto3: ['auto5', 'autoStorm'], autoGun: ['autoTwin', 'autoBattle'], autoSnp: ['autoGuard', 'autoFort'],
  bouncer: ['pinball', 'billiard'], rail: ['rail2', 'lancer'], rocket: ['swarmer', 'seeker'], mortar: ['howitzer', 'grenadier'],
});
