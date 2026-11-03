// Ozdoby Živého režimu: data, ne kód. Postavičky (scene) jsou v Scenes.jsx, jejich pohyb v lively.css.
// x a y jsou v procentech šířky pruhu po straně a výšky okna, size je v pixelech (u širokých obrazovek se zvětší), dur a del v sekundách
// (záporné zpoždění = pohyb nezačínají všechny naráz), float je houpání celé postavičky, dp hloubka při pohybu myši, par rychlost
// houpání při posouvání stránky.

/** Pruh vlevo je „čtenářský koutek“, vpravo „herní“. Zobrazují se jen tam, kde je vedle obsahu místo (široké obrazovky). */
export const SIDE_ITEMS = {
  left: [
    { scene: 'Owl', x: 50, y: 13, size: 70, float: 'sway', dur: 7, del: -1, dp: 1.0, par: 0.0022 },
    { scene: 'Book', x: 42, y: 28, size: 72, float: 'bob', dur: 6, del: -3, dp: 0.6, par: 0.0030 },
    { scene: 'Coffee', x: 58, y: 43, size: 62, float: 'bob', dur: 8, del: -4, dp: 0.8, par: 0.0018 },
    { scene: 'Lamp', x: 46, y: 58, size: 76, float: 'sway', dur: 7.5, del: -2, dp: 0.5, par: 0.0026 },
    { scene: 'Moon', x: 54, y: 72, size: 66, float: 'drift', dur: 11, del: -6, dp: 1.2, par: 0.0020 },
    { scene: 'Quill', x: 44, y: 87, size: 70, float: 'sway', dur: 9, del: -5, dp: 0.7, par: 0.0034 },
  ],
  right: [
    { scene: 'Rocket', x: 50, y: 13, size: 72, float: 'none', dur: 9, del: -2, dp: 1.0, par: 0.0028 },
    { scene: 'Coin', x: 44, y: 28, size: 60, float: 'none', dur: 3, del: 0, dp: 0.7, par: 0.0020 },
    { scene: 'Trophy', x: 56, y: 43, size: 70, float: 'bob', dur: 7.5, del: -3.5, dp: 0.9, par: 0.0032 },
    { scene: 'Flame', x: 46, y: 58, size: 66, float: 'none', dur: 3, del: 0, dp: 0.6, par: 0.0022 },
    { scene: 'Gamepad', x: 54, y: 72, size: 72, float: 'sway', dur: 6.5, del: -4, dp: 1.1, par: 0.0026 },
    { scene: 'Crown', x: 48, y: 87, size: 66, float: 'bob', dur: 6, del: -1, dp: 0.8, par: 0.0030 },
  ],
};

/** Tvorové, kteří přelétají celou obrazovku (i na telefonu): motýli, papírové letadlo a housenka po dolním okraji. */
export const ROAMERS = [
  { scene: 'Butterfly', kind: 'wander', top: 24, w: 36, dur: 46, del: -8, c1: '#fb7185', c2: '#fbbf24' },
  { scene: 'Butterfly', kind: 'wander', top: 58, w: 30, dur: 58, del: -34, c1: '#38bdf8', c2: 'var(--bg-primary)', desktop: true },
  { scene: 'Plane', kind: 'plane', top: 10, w: 56, dur: 36, del: -14 },
  { scene: 'Worm', kind: 'worm', top: null, w: 66, dur: 96, del: -22 },
];

/** Hvězdičky, kroužky a tečky, které pomalu stoupají přes celou obrazovku. Rozmístění je pevné (žádná náhoda při vykreslení). */
export const PARTICLE_COUNT = 16;
export const PARTICLE_SHAPES = ['dot', 'star', 'ring'];
export const particles = (count = PARTICLE_COUNT) => Array.from({ length: count }, (_, i) => ({
  x: Math.round(((i * 37 + 11) % 97) + 1),            // vodorovná poloha v % šířky okna
  size: 4 + ((i * 5) % 5),                             // 4 až 8 px
  dur: 16 + ((i * 7) % 13),                            // 16 až 28 s
  del: -((i * 53) % 29),                               // záporné zpoždění: nezačínají všechny naráz
  shape: PARTICLE_SHAPES[i % PARTICLE_SHAPES.length],
}));

export const SCENE_NAMES = [...new Set([...Object.values(SIDE_ITEMS).flat(), ...ROAMERS].map((it) => it.scene))];
export const FLOATS = ['bob', 'drift', 'sway', 'none'];
