// 5. stupeň (Vzestup), varianty bossů a seznamy tříd.
/* =====================================================================
   5. stupeň – Vzestup: malá sada opravdu výjimečných, ručně stavěných
   forem (ne odvozeniny). Odemyká se na úrovni TIER_LEVELS[4]=48 a je
   stejná pro každý tank 4. stupně – nezávisle na tom, kterou z 400
   variant hráč doteď hrál, dostane stejnou nabídku aspoň 4 (tady 8)
   opravdu odlišných vrcholných tvarů.
   ===================================================================== */
Object.assign(CLASSES, {
  singularita: C({ name: 'Singularita', tier: 5, info: 'Osm věží kolem těžkého jádra', reload: 1.0, hp: 1.3, speed: 0.95,
    barrels: [...ring(8, { turret: true, dist: 0.64, len: 1.0, w: 0.5, tsize: 0.27, dmg: 0.5, spd: 1.1, size: 0.85, recoil: 0 }),
      B({ len: 1.3, w: 0.9, dmg: 2.3, spd: 0.85, recoil: 2 })] }),
  nadnova: C({ name: 'Nadnova', tier: 5, info: 'Šest bomb vybuchujících do všech stran', reload: 1.6, speed: 0.9, range: 1.3,
    barrels: ring(6, { len: 1.1, w: 0.85, dmg: 1.35, spd: 0.7, size: 1.3, kind: 'bomb', lob: true, blast: 68, flare: true, recoil: 1.4 }, true) }),
  leviatan: C({ name: 'Leviatan', tier: 5, info: 'Obří trup, zdrcující náraz', reload: 1.3, hp: 2.0, ram: 2.6, size: 1.5, speed: 0.78,
    barrels: [B({ len: 1.0, w: 1.0, dmg: 1.9, spd: 0.8 }), B({ a: PI, len: 1.0, w: 1.0, dmg: 1.9, spd: 0.8, delay: 0.5 })] }),
  nekonecno: C({ name: 'Nekonečno', tier: 5, info: 'Jediný paprsek – neprorazíte ho', reload: 3.0, zoom: 0.6, range: 2.3, speed: 0.82,
    barrels: [B({ len: 3.4, w: 0.42, dmg: 3.6, spd: 3.4, pierce: 99, streak: true, size: 0.85 })] }),
  rojtisice: C({ name: 'Roj tisíce', tier: 5, info: 'Nekonečný příval dronů', reload: 0.55, maxDrones: 20,
    barrels: ring(6, { kind: 'drone', len: 1.1, w: 0.7, dmg: 0.55, spd: 0.8, size: 0.72, flare: true }, true) }),
  bludiste: C({ name: 'Bludiště', tier: 5, info: 'Aréna plná nezničitelných pastí', reload: 1.3, hp: 1.3, maxTraps: 22,
    barrels: [...ring(4, { kind: 'trap', len: 1.0, w: 0.9, dmg: 1.3, hp: 3.0 }, true),
      TUR({ a: PI / 2, dist: 0.7, dmg: 0.55 }), TUR({ a: -PI / 2, dist: 0.7, dmg: 0.55 })] }),
  krupobiti: C({ name: 'Krupobití', tier: 5, info: 'Nepřetržitá sprška střel ze všech stran', reload: 0.45, speed: 1.05,
    barrels: ring(10, { len: 1.15, w: 0.4, dmg: 0.42, spd: 1.05 }, true) }),
  poslednigarda: C({ name: 'Poslední garda', tier: 5, info: 'Nejtvrdší obrana, jakou lze postavit', reload: 1.0, hp: 2.2, ram: 1.6, speed: 0.8,
    barrels: [...ring(4, { turret: true, dist: 0.75, len: 1.0, w: 0.55, tsize: 0.34, dmg: 0.68, spd: 1.1, size: 0.85, recoil: 0 }, true),
      B({ len: 1.35, w: 0.85, dmg: 1.9, spd: 0.85 })] }),
});
const TIER5_IDS = ['singularita', 'nadnova', 'leviatan', 'nekonecno', 'rojtisice', 'bludiste', 'krupobiti', 'poslednigarda'];

/* ---------- varianty bossů: stejná rodina, výraznější rozptyl sil ---------- */
function bossVariant(id, from, name, fn) {
  const c = t4.clone(from); c.name = name; fn(c);
  CLASSES[id] = C(c);
}
bossVariant('boss_guard_a', 'boss_guard', 'Pohlcovač', c => { t4.st(c, { hp: 1.35, size: 1.12, speed: 0.85 }); t4.bul(c, { blast: 34 }); });
bossVariant('boss_guard_b', 'boss_guard', 'Blesk', c => { t4.st(c, { speed: 1.35, hp: 0.82, reload: 0.8 }); });
bossVariant('boss_crusher_a', 'boss_crusher', 'Titán', c => t4.st(c, { hp: 1.4, size: 1.2, ram: 1.25, speed: 0.85 }));
bossVariant('boss_crusher_b', 'boss_crusher', 'Stín', c => t4.st(c, { speed: 1.3, size: 0.82, hp: 0.8 }));
bossVariant('boss_hive_a', 'boss_hive', 'Královna', c => t4.st(c, { maxDrones: 1.4, hp: 1.3, speed: 0.9 }));
bossVariant('boss_hive_b', 'boss_hive', 'Roj', c => { t4.st(c, { maxDrones: 1.7, reload: 0.75, hp: 0.85 }); });
bossVariant('boss_tower_a', 'boss_tower', 'Maják', c => { t4.tur(c, 2, 0.6, 0.8); t4.st(c, { hp: 1.25 }); });
bossVariant('boss_tower_b', 'boss_tower', 'Kovadlina', c => { t4.st(c, { hp: 1.3, ram: 1.6, speed: 0.75 }); t4.bul(c, { dmg: 1.25 }); });

// Generátor doplní strom až teď, když jsou definované všechny ruční třídy i bossové (jejich jména se nesmí použít podruhé);
// teprve potom dostane každá třída 4. stupně nabídku tříd 5. stupně.
TANKGEN.fill();
for (const id in CLASSES) if (CLASSES[id].tier === 4) TREE[id] = TIER5_IDS;

const BOSS_IDS = ['boss_guard', 'boss_crusher', 'boss_hive', 'boss_tower',
  'boss_guard_a', 'boss_guard_b', 'boss_crusher_a', 'boss_crusher_b', 'boss_hive_a', 'boss_hive_b', 'boss_tower_a', 'boss_tower_b'];
const CLASS_IDS = Object.keys(CLASSES).filter(id => !CLASSES[id].boss);
const PARENT = {}; for (const k in TREE) for (const c of TREE[k]) PARENT[c] = k;

// Vzhled a profil všem třídám (až teď, když jsou definované všechny stupně).
TANKGEN.finish();
