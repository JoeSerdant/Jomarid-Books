// Animované postavičky a scény Živého režimu. Jsou to malé kreslené SVG; pohyb je čisté CSS (src/lively.css, třídy s předponou
// postavy: owl-, book-, coffee-...), takže nic nezatěžuje JavaScript. Barvy: akcent motivu (třída a), zlatá, modrá a bílá pro doplňky.
// Každá postava musí vypadat dobře i bez pohybu („Omezit pohyb“ animace vypne a zůstane výchozí póza), proto je výchozí stav CSS vždycky
// hezký obrázek. Všechno je jen ozdoba (aria-hidden, žádné ovládání).

const Svg = ({ name, vb = '0 0 64 64', className = '', style, children }) => (
  <svg className={`lv-scene lv-s-${name} ${className}`} style={style} viewBox={vb} aria-hidden="true" focusable="false">{children}</svg>
);

const SPARK = 'M0 -6 L1.8 -1.8 L6 0 L1.8 1.8 L0 6 L-1.8 1.8 L-6 0 L-1.8 -1.8 Z'; // čtyřcípá jiskra kolem bodu 0,0

/** Sova: mrká, rozhlíží se a zornice sledují kurzor. */
const Owl = (p) => (
  <Svg name="owl" {...p}>
    <ellipse className="gold" cx="25" cy="61" rx="5" ry="2.4" />
    <ellipse className="gold" cx="39" cy="61" rx="5" ry="2.4" />
    <g className="owl-body">
      <path className="a" d="M13 24 Q13 8 32 8 Q51 8 51 24 V46 Q51 60 32 60 Q13 60 13 46 Z" />
      <path className="a" d="M14 15 L10 3 L25 9 Z" />
      <path className="a" d="M50 15 L54 3 L39 9 Z" />
      <ellipse className="white" cx="32" cy="47" rx="13" ry="11" fillOpacity=".4" />
      <path className="st-w" strokeWidth="1.6" strokeOpacity=".7" d="M22 41 q3 3 6 0 M30 45 q3 3 6 0 M38 41 q3 3 6 0 M26 51 q3 3 6 0 M34 51 q3 3 6 0" />
      <circle className="white" cx="23" cy="26" r="9" />
      <circle className="white" cx="41" cy="26" r="9" />
      <circle className="ink owl-pupil" cx="23" cy="27" r="4.2" />
      <circle className="ink owl-pupil" cx="41" cy="27" r="4.2" />
      <rect className="a owl-lid" x="13" y="16" width="20" height="20" rx="10" />
      <rect className="a owl-lid" x="31" y="16" width="20" height="20" rx="10" />
      <path className="gold" d="M28 33 L36 33 L32 41 Z" />
    </g>
  </Svg>
);

/** Otevřená kniha, jejíž stránka se otáčí. */
const Book = (p) => (
  <Svg name="book" {...p}>
    <g className="book-wrap">
      <path className="a" d="M4 22 Q18 15 32 22 V52 Q18 45 4 52 Z" />
      <path className="a2" d="M60 22 Q46 15 32 22 V52 Q46 45 60 52 Z" />
      <path className="white" d="M7 23.5 Q18 18 31 24 V48.5 Q18 43 7 48.5 Z" />
      <path className="white" fillOpacity=".95" d="M57 23.5 Q46 18 33 24 V48.5 Q46 43 57 48.5 Z" />
      <path className="st-a" strokeWidth="1.4" strokeOpacity=".4" d="M11 29 Q18 26 27 29.5 M11 34 Q18 31 27 34.5 M11 39 Q18 36 27 39.5 M37 29.5 Q46 26 53 29 M37 34.5 Q46 31 53 34" />
      <path className="white book-flip" stroke="rgba(0,0,0,.12)" strokeWidth=".8" d="M33 24 Q46 18 57 23.5 V48.5 Q46 43 33 48.5 Z" />
    </g>
    <g transform="translate(32 8)"><path className="gold spark" d={SPARK} /></g>
    <g transform="translate(52 12) scale(.7)"><path className="gold spark sk2" d={SPARK} /></g>
    <g transform="translate(11 11) scale(.6)"><path className="gold spark sk3" d={SPARK} /></g>
  </Svg>
);

/** Šálek kávy, z kterého stoupá pára. */
const Coffee = (p) => (
  <Svg name="coffee" {...p}>
    <ellipse className="a2" cx="30" cy="58" rx="23" ry="4.5" />
    <path className="st-a" strokeWidth="4.5" d="M46 33 Q58 33 57 42 Q56 50 45 50" />
    <path className="white" d="M12 30 H48 V43 Q48 57 30 57 Q12 57 12 43 Z" />
    <path className="a" d="M12 30 H48 V37 H12 Z" />
    <ellipse className="brown" cx="30" cy="30" rx="18" ry="4.5" />
    <path className="st-a coffee-steam" strokeWidth="2.6" pathLength="100" d="M21 24 q-5 -5 0 -10 t0 -10" />
    <path className="st-a coffee-steam cs2" strokeWidth="2.6" pathLength="100" d="M30 24 q-5 -5 0 -10 t0 -10" />
    <path className="st-a coffee-steam cs3" strokeWidth="2.6" pathLength="100" d="M39 24 q-5 -5 0 -10 t0 -10" />
  </Svg>
);

/** Stolní lampa, která se kývá a svítí. */
const Lamp = (p) => (
  <Svg name="lamp" {...p}>
    <ellipse className="a" cx="32" cy="59" rx="15" ry="3.6" />
    <path className="st-a" strokeWidth="4" d="M32 57 V30" />
    <g className="lamp-head">
      <path className="gold lamp-cone" d="M14 25 L50 25 L62 60 L2 60 Z" />
      <path className="a" d="M21 6 L43 6 L51 25 L13 25 Z" />
      <ellipse className="gold lamp-bulb" cx="32" cy="25" rx="9" ry="3" />
    </g>
  </Svg>
);

/** Spící měsíc, z kterého stoupají „z“. */
const Moon = (p) => (
  <Svg name="moon" {...p}>
    <g className="moon-face">
      <circle className="gold" cx="28" cy="38" r="22" />
      <circle className="gold2" cx="17" cy="50" r="4" fillOpacity=".45" />
      <circle className="gold2" cx="40" cy="52" r="3" fillOpacity=".45" />
      <circle className="pink" cx="15" cy="43" r="3.2" fillOpacity=".55" />
      <circle className="pink" cx="41" cy="43" r="3.2" fillOpacity=".55" />
      <path className="st-ink" strokeWidth="2" d="M17 36 q4 4 8 0 M31 36 q4 4 8 0 M25 46 q3 3 6 0" />
    </g>
    <path className="st-a moon-z" strokeWidth="2.4" d="M47 22 h8 l-8 9 h8" />
    <path className="st-a moon-z mz2" strokeWidth="2.2" d="M52 8 h6 l-6 7 h6" />
  </Svg>
);

/** Brk, který píše čáru. */
const Quill = (p) => (
  <Svg name="quill" {...p}>
    <path className="st-a quill-line" strokeWidth="2.6" pathLength="100" d="M8 56 q5 -7 10 0 t10 0 t10 0" />
    <g className="quill-pen">
      <path className="a" d="M52 4 Q63 9 58 25 Q53 39 34 51 Q38 38 41 31 Q30 38 24 47 Q28 22 52 4 Z" />
      <path className="st-w" strokeWidth="1.4" strokeOpacity=".7" d="M25 46 Q40 28 54 9" />
      <path className="ink" d="M23 47 L19 55 L29 51 Z" />
    </g>
  </Svg>
);

/** Raketa: zatřese se, vzlétne, zmizí a z druhé strany se vrátí. */
const Rocket = (p) => (
  <Svg name="rocket" {...p}>
    <circle className="white rocket-puff" cx="26" cy="56" r="6" />
    <circle className="white rocket-puff rp2" cx="38" cy="58" r="7" />
    <circle className="white rocket-puff rp3" cx="32" cy="62" r="5" />
    <g className="rocket-wrap">
      <path className="orange rocket-flame" d="M25 46 Q32 68 39 46 Z" />
      <path className="yellow rocket-flame rocket-flame-in" d="M28 46 Q32 60 36 46 Z" />
      <path className="a" d="M20 36 L7 50 L20 46 Z" />
      <path className="a" d="M44 36 L57 50 L44 46 Z" />
      <path className="white" d="M32 3 Q47 15 44 38 V47 H20 V38 Q17 15 32 3 Z" />
      <path className="a" d="M32 3 Q41 9 43.5 20 H20.5 Q23 9 32 3 Z" />
      <circle className="a" cx="32" cy="29" r="8" />
      <circle className="sky" cx="32" cy="29" r="5.6" />
      <path className="white" fillOpacity=".7" d="M29 26 q2 -2.5 5 -1 q-3 0 -5 3.5 Z" />
    </g>
  </Svg>
);

/** Mince, která se točí a poskakuje. */
const Coin = (p) => (
  <Svg name="coin" {...p}>
    <ellipse className="ink coin-shadow" cx="32" cy="60" rx="14" ry="3" fillOpacity=".18" />
    <g className="coin-hop">
      <g className="coin-spin">
        <circle className="gold2" cx="32" cy="30" r="23" />
        <circle className="gold" cx="32" cy="30" r="18.5" />
        <path className="gold2" stroke="#92400e" strokeWidth="1.2" strokeLinejoin="round" d="M32.0 18.0 L35.2 26.1 L43.9 26.6 L37.1 32.2 L39.3 40.6 L32.0 35.9 L24.7 40.6 L26.9 32.2 L20.1 26.6 L28.8 26.1 Z" />
        <path className="st-w" strokeWidth="2.4" strokeOpacity=".65" d="M17 24 Q20 15 29 12" />
      </g>
    </g>
  </Svg>
);

/** Pohár, přes který přejede lesk a kolem kterého blikají jiskry. */
const Trophy = (p) => (
  <Svg name="trophy" {...p}>
    <defs><clipPath id="lvTrophyClip"><path d="M14 8 H50 V24 Q50 42 32 44 Q14 42 14 24 Z" /></clipPath></defs>
    <g className="trophy-wrap">
      <path className="st-gold2" strokeWidth="4" d="M14 13 Q2 13 4 25 Q6 34 18 36 M50 13 Q62 13 60 25 Q58 34 46 36" />
      <path className="gold" d="M14 8 H50 V24 Q50 42 32 44 Q14 42 14 24 Z" />
      <rect className="gold2" x="28" y="44" width="8" height="8" />
      <rect className="a" x="17" y="52" width="30" height="8" rx="2" />
      <path className="white" fillOpacity=".9" transform="translate(32 25) scale(.9)" d={SPARK} />
      <g clipPath="url(#lvTrophyClip)"><rect className="white trophy-shine" x="-12" y="0" width="9" height="50" /></g>
    </g>
    <g transform="translate(56 8)"><path className="gold spark" d={SPARK} /></g>
    <g transform="translate(8 6) scale(.7)"><path className="gold spark sk2" d={SPARK} /></g>
    <g transform="translate(60 40) scale(.6)"><path className="sky spark sk3" d={SPARK} /></g>
  </Svg>
);

/** Plamen: tři vrstvy se každá chvěje jinak a nahoru lítají jiskry. */
const Flame = (p) => (
  <Svg name="flame" {...p}>
    <ellipse className="orange flame-glow" cx="32" cy="60" rx="18" ry="3.6" />
    <path className="orange fl1" d="M32 2 C42 16 54 26 52 42 C50 56 40 62 32 62 C24 62 14 56 12 42 C10 28 22 22 24 12 C28 16 30 10 32 2 Z" />
    <path className="yellow fl2" d="M32 20 C38 30 46 36 44 46 C43 56 37 60 32 60 C27 60 21 56 20 46 C19 38 27 32 28 26 C30 28 31 24 32 20 Z" />
    <path className="white fl3" d="M32 38 C36 44 39 48 37 54 C36 58 34 60 32 60 C30 60 28 58 27 54 C26 49 30 44 32 38 Z" fillOpacity=".92" />
    <circle className="orange flame-ember" cx="20" cy="34" r="1.8" />
    <circle className="yellow flame-ember fe2" cx="46" cy="30" r="1.6" />
    <circle className="orange flame-ember fe3" cx="38" cy="14" r="1.4" />
  </Svg>
);

/** Gamepad: tlačítka se střídavě mačkají a ovladač se zachvěje. */
const Gamepad = (p) => (
  <Svg name="gamepad" {...p}>
    <g className="pad-wrap">
      <path className="a" d="M10 26 Q10 17 21 17 H43 Q54 17 54 26 L58 44 Q60 55 52 55 Q46 55 42 46 H22 Q18 55 12 55 Q4 55 6 44 Z" />
      <path className="white" d="M17 29 h4 v-4 h4 v4 h4 v4 h-4 v4 h-4 v-4 h-4 z" />
      <circle className="gold pad-btn" cx="44" cy="26" r="3.4" />
      <circle className="sky pad-btn pb2" cx="50" cy="32" r="3.4" />
      <circle className="pink pad-btn pb3" cx="38" cy="32" r="3.4" />
      <rect className="white" fillOpacity=".5" x="29" y="27" width="6" height="3" rx="1.5" />
    </g>
  </Svg>
);

/** Koruna, která se houpe a jejíž drahokamy blikají. */
const Crown = (p) => (
  <Svg name="crown" {...p}>
    <g className="crown-wrap">
      <path className="gold" d="M8 22 L20 34 L32 12 L44 34 L56 22 L50 52 H14 Z" />
      <rect className="a" x="13" y="46" width="38" height="9" rx="2" />
      <circle className="pink crown-gem" cx="32" cy="38" r="4" />
      <circle className="sky crown-gem cg2" cx="21" cy="50.5" r="2.4" />
      <circle className="white crown-gem cg3" cx="43" cy="50.5" r="2.4" />
      <circle className="white" cx="8" cy="21" r="3" />
      <circle className="white" cx="32" cy="11" r="3.4" />
      <circle className="white" cx="56" cy="21" r="3" />
      <path className="white crown-shine" fillOpacity=".5" d="M24 26 L28 36 L22 32 Z" />
    </g>
  </Svg>
);

/** Motýl: křídla mávají, barvy jde zadat přes --c1 a --c2. */
const Butterfly = (p) => (
  <Svg name="butterfly" vb="0 0 40 32" {...p}>
    <g className="bf-wing">
      <path className="bf1" d="M20 16 C14 1 1 3 3 14 C4 20 14 20 20 16 Z" />
      <path className="bf2" d="M20 17 C14 21 6 30 12 30 C17 30 20 23 20 17 Z" />
      <circle className="white" fillOpacity=".7" cx="10" cy="11" r="2.2" />
    </g>
    <g className="bf-wing">
      <path className="bf1" d="M20 16 C26 1 39 3 37 14 C36 20 26 20 20 16 Z" />
      <path className="bf2" d="M20 17 C26 21 34 30 28 30 C23 30 20 23 20 17 Z" />
      <circle className="white" fillOpacity=".7" cx="30" cy="11" r="2.2" />
    </g>
    <rect className="ink" x="18.8" y="8" width="2.4" height="17" rx="1.2" />
    <path className="st-ink" strokeWidth=".9" d="M19.4 8.5 Q17 4 14.5 3.5 M20.6 8.5 Q23 4 25.5 3.5" />
  </Svg>
);

/** Papírové letadlo. */
const Plane = (p) => (
  <Svg name="plane" vb="0 0 48 32" {...p}>
    <path className="plane-top" d="M2 14 L46 3 L22 18 Z" />
    <path className="plane-bot" d="M22 18 L46 3 L30 29 Z" />
    <path className="plane-keel" d="M22 18 L30 29 L19 26 Z" />
  </Svg>
);

/** Housenka s brýlemi, která leze po dolním okraji. Vlnu pohybu řídí --i u každého článku. */
const Worm = (p) => (
  <Svg name="worm" vb="0 0 72 30" {...p}>
    {[8, 19, 30, 41].map((x, i) => <circle key={x} className={`${i % 2 ? 'a2' : 'a'} worm-seg`} style={{ '--i': i }} cx={x} cy="21" r="6.4" />)}
    <g className="worm-seg" style={{ '--i': 4 }}>
      <circle className="a" cx="56" cy="19" r="9" />
      <circle className="white" cx="52" cy="16" r="3.6" />
      <circle className="white" cx="61" cy="16" r="3.6" />
      <circle className="ink" cx="53" cy="16.4" r="1.6" />
      <circle className="ink" cx="62" cy="16.4" r="1.6" />
      <path className="st-ink" strokeWidth=".9" d="M48.4 16 a3.6 3.6 0 1 1 7.2 0 a3.6 3.6 0 1 1 -7.2 0 M57.4 16 a3.6 3.6 0 1 1 7.2 0 a3.6 3.6 0 1 1 -7.2 0 M55.6 15.4 h1.8" />
      <path className="st-ink" strokeWidth="1.2" d="M53 23 q3.5 3 7 0" />
    </g>
  </Svg>
);

export const SCENES = { Owl, Book, Coffee, Lamp, Moon, Quill, Rocket, Coin, Trophy, Flame, Gamepad, Crown, Butterfly, Plane, Worm };
