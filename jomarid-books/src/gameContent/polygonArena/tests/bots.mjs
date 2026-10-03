// Měření obtížností a režimů: hráče řídí stejná AI jako boty ("hráč-bot") a zjišťuje se, jak dlouho přežije první život
// (medián přes několik seedů), jak vysoko se dostane a kolikrát vyhraje. Hra běží v Node bez prohlížeče.
// Slouží k ladění tabulky DIFFS v core.js a režimů v modes.js - obtížnosti by se měly řadit lehká > střední > těžká > Peklo.
//
//   npm run polygon:bots                                    # Klasika, všechny obtížnosti, 8 běhů po 240 s
//   node src/gameContent/polygonArena/tests/bots.mjs survival normal,hard,hell 8 600
//   node src/gameContent/polygonArena/tests/bots.mjs ffa hell 12 240 '{"hell":{"focus":0.5}}'   # vyzkouší jiné hodnoty
import { loadGame } from './stub.mjs';

const [mode = 'ffa', diffs = 'easy,normal,hard,hell', runs = '8', maxS = '240', override = ''] = process.argv.slice(2);
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const ASAI = 'controlPlayer = (p, dt) => { if (!p.ai) newPersona(p); botControl(p, dt); }';

console.log(`režim ${mode}, ${runs} běhů po nejvýš ${maxS} s (hráč-bot)\n`);
for (const d of diffs.split(',')) {
  const res = [];
  for (let r = 0; r < +runs; r++) {
    const g = loadGame({ seed: 1000 + r * 17 }), A = g.arena;
    if (override) { const o = JSON.parse(override); for (const k in o) Object.assign(A.DIFFS[k], o[k]); }
    g.run(ASAI);
    A.setDiff(d); A.mode = mode; A.startGame(true); g.run('player.ai = null; newPersona(player)');
    let first = -1, steps = 0, deaths = 0;
    for (; steps < 60 * +maxS; steps++) {
      A.update(1 / 60);
      if (A.state !== 'play') {
        if (first < 0) first = steps / 60;
        if (A.world.over) break;                                  // konec zápasu (výhra nebo smrt v režimu bez znovuzrození)
        deaths++; A.startGame(false); g.run('player.ai = null; newPersona(player)');
        if (deaths > 60) break;
      }
    }
    res.push({ first: first < 0 ? +maxS : first, lvl: A.player.level, deaths, win: A.world.win });
  }
  console.log(`${d.padEnd(7)} první smrt: medián ${med(res.map((x) => x.first)).toFixed(0).padStart(4)} s  [${res.map((x) => x.first.toFixed(0)).join(' ')}]   úroveň ${med(res.map((x) => x.lvl))}   smrtí ${med(res.map((x) => x.deaths))}   výher ${res.filter((x) => x.win).length}/${res.length}`);
}
