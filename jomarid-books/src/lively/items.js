// Ozdoby Živého režimu: data, ne kód. Ikony se berou podle názvu (mapa je v LivelyScenery.jsx).
// x a y jsou v procentech šířky pruhu po straně a výšky okna, size je v pixelech, dur a del v sekundách (záporné zpoždění = animace
// nezačíná všechna naráz), anim je název animace z src/lively.css.

/** Pruh vlevo je „čtenářský koutek“, vpravo „herní“. Zobrazují se jen tam, kde je vedle obsahu místo (široké obrazovky).
 *  par = jak rychle se ozdoba při posouvání stránky houpe nahoru a dolů (každá jinak, aby to vypadalo jako hloubka). */
export const SIDE_ITEMS = {
  left: [
    { icon: 'BookOpen', x: 45, y: 15, size: 42, anim: 'bob', dur: 7, del: -1, par: 0.0022 },
    { icon: 'Moon', x: 28, y: 27, size: 34, anim: 'twinkle', dur: 5.5, del: -3, par: 0.0030 },
    { icon: 'Coffee', x: 62, y: 39, size: 36, anim: 'bob', dur: 8, del: -4, par: 0.0018 },
    { icon: 'Feather', x: 34, y: 51, size: 34, anim: 'drift', dur: 11, del: -2, par: 0.0026 },
    { icon: 'Lamp', x: 56, y: 63, size: 38, anim: 'flicker', dur: 4.5, del: -1.5, par: 0.0020 },
    { icon: 'Glasses', x: 36, y: 75, size: 36, anim: 'bob', dur: 9, del: -5, par: 0.0034 },
    { icon: 'Sparkles', x: 58, y: 87, size: 30, anim: 'twinkle', dur: 4, del: -2.5, par: 0.0024 },
  ],
  right: [
    { icon: 'Rocket', x: 52, y: 15, size: 40, anim: 'drift', dur: 10, del: -5, par: 0.0028 },
    { icon: 'Star', x: 34, y: 27, size: 28, anim: 'twinkle', dur: 3.5, del: -1, par: 0.0020 },
    { icon: 'Trophy', x: 56, y: 39, size: 38, anim: 'bob', dur: 7.5, del: -3.5, par: 0.0032 },
    { icon: 'Flame', x: 38, y: 51, size: 36, anim: 'flicker', dur: 3.2, del: -0.5, par: 0.0022 },
    { icon: 'Crown', x: 60, y: 63, size: 34, anim: 'bob', dur: 9, del: -6, par: 0.0026 },
    { icon: 'Gamepad2', x: 40, y: 75, size: 40, anim: 'drift', dur: 12, del: -7, par: 0.0018 },
    { icon: 'Star', x: 52, y: 87, size: 26, anim: 'twinkle', dur: 4.8, del: -2, par: 0.0030 },
  ],
};

/** Hvězdičky, které pomalu stoupají přes celou obrazovku. Rozmístění je pevné (žádná náhoda při vykreslení). */
export const PARTICLE_COUNT = 14;
export const particles = (count = PARTICLE_COUNT) => Array.from({ length: count }, (_, i) => ({
  x: Math.round(((i * 37 + 11) % 97) + 1),            // vodorovná poloha v % šířky okna
  size: 3 + ((i * 5) % 4),                             // 3 až 6 px
  dur: 16 + ((i * 7) % 13),                            // 16 až 28 s
  del: -((i * 53) % 29),                               // záporné zpoždění: nezačínají všechny naráz
}));

export const ICON_NAMES = [...new Set(Object.values(SIDE_ITEMS).flat().map((it) => it.icon))];
export const ANIMATIONS = ['bob', 'drift', 'twinkle', 'flicker'];
