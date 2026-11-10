// Online režimy her (multiplayer). Jedno místo pro to, co se o režimech ví v appce: které hry a režimy existují, jaké volby se před zápasem nabízejí
// a kolik Coinů dá výhra. Čísla odměn a názvy režimů musí odpovídat serveru (db/multiplayer.sql, funkce mp_cfg a mp_clean_params);
// test src/tests/multiplayer.test.mjs hlídá, že si odpovídají. `ready` zapíná tlačítko „Hrát online“ u hry; hry se zapínají postupně.
import { tk } from '../i18n/mark.js';

// kind: turn (tahová hra se střídáním), race (závod), realtime (rychlé zprávy), arena (sdílený server bez zápasů)
export const MP_GAMES = {
  chess: {
    ready: true,
    kind: 'turn',
    modes: [{ id: 'duel', title: tk('Partie 1 na 1'), text: tk('Hraješ proti náhodnému živému soupeři. Hodiny běží na serveru, nápověda ani vrácení tahu nejsou.'), reward: 30 }],
    options: [{ key: 'tc', title: tk('Hodiny'), choices: [{ value: '3+2', label: '3 + 2' }, { value: '5+3', label: '5 + 3' }, { value: '10+5', label: '10 + 5' }], def: '5+3' }],
  },
  koulovikamosi: {
    ready: false,
    kind: 'turn',
    modes: [{ id: 'duel', title: tk('Souboj v jedné míse'), text: tk('Střídáte se v pouštění koulí do společné misky. Komu koule vypadne první, prohrává.'), reward: 20 }],
    options: [],
  },
  warroom: {
    ready: false,
    kind: 'turn',
    modes: [{ id: 'duel', title: tk('Souboj velitelů'), text: tk('Střídáte se v tazích. Denní tlak je útok soupeře.'), reward: 35 }],
    options: [],
  },
  hannibal: {
    ready: false,
    kind: 'turn',
    modes: [{ id: 'duel', title: tk('Souboj armád'), text: tk('Náhodná mapa a stejně velká armáda pro oba.'), reward: 40 }],
    options: [{ key: 'preset', title: tk('Velikost armády'), choices: [{ value: 'small', labelKey: tk('Malá') }, { value: 'medium', labelKey: tk('Střední') }, { value: 'large', labelKey: tk('Velká') }], def: 'medium' }],
  },
  cityclicker: {
    ready: false,
    kind: 'race',
    modes: [{ id: 'race', title: tk('Závod o peníze'), text: tk('Oba začnete od nuly. Vyhrává, kdo první vydělá cílový obnos.'), reward: 40 }],
    options: [{ key: 'goal', title: tk('Cíl závodu'), choices: [{ value: 'quick', labelKey: tk('Rychlý') }, { value: 'standard', labelKey: tk('Standardní') }, { value: 'long', labelKey: tk('Dlouhý') }], def: 'standard' }],
  },
  rocket: {
    ready: false,
    kind: 'realtime',
    modes: [
      { id: 'coop', title: tk('Spolupráce'), text: tk('Dvě rakety proti nepřátelům. Vyhráváte nebo prohráváte společně.'), reward: 25 },
      { id: 'pvp', title: tk('Souboj raket'), text: tk('Rakety stojí proti sobě a soupeř je pro tebe boss. Nepřátelé jedou na oba.'), reward: 35 },
    ],
    options: [],
  },
  polygonarena: { ready: false, kind: 'arena', modes: [], options: [] },
};

export const mpGame = (gameId) => MP_GAMES[gameId] || null;

// Hra s alespoň jedním zápasovým režimem, který je zapnutý v appce.
export const hasOnline = (gameId) => { const g = MP_GAMES[gameId]; return !!(g && g.ready && g.modes.length > 0); };

// Výchozí volby režimu (jen ty, které si hra vybírá před zápasem).
export function defaultParams(gameId) {
  const out = {};
  for (const o of (MP_GAMES[gameId]?.options || [])) out[o.key] = o.def;
  return out;
}

// Očištěné volby: jen známé klíče a hodnoty, jinak výchozí (server stejně neplatnou volbu odmítne).
export function cleanParams(gameId, params) {
  const out = defaultParams(gameId);
  for (const o of (MP_GAMES[gameId]?.options || [])) {
    const v = params && typeof params === 'object' ? params[o.key] : undefined;
    if (o.choices.some((c) => c.value === v)) out[o.key] = v;
  }
  return out;
}
