// Jomarid Online Games - dvě coop hry jen pro online pod jednou kartou ve Hrách (Games.jsx).
//
// Tenhle dokument je jen menu se dvěma hrami: tlačítko Hrát online u každé otevře okno s hledáním parťáka (src/mp) s předvybraným režimem.
// Samotné hry jsou vlastní dokumenty: Katakomby (gameContent/katakomby.js) a Chaos Aréna (gameContent/chaosArena.js), obě se načtou až při zápasu.
import shell from './onlineGames/index.html?raw';
import css from './onlineGames/style.css?raw';

// Funkce jako náhrada (ne řetězec), aby se v kódu nevykládaly speciální sekvence jako "$&".
export const ONLINE_GAMES_HTML = shell.replace('/*__CSS__*/', () => css);
