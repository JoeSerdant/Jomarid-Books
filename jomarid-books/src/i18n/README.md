# Čeština / angličtina

Appka má dva jazyky, výchozí je čeština. Přepínač je v horní liště a v Nastavení → Vzhled, volba se ukládá v zařízení
(`localStorage`, klíč `jomarid-lang`) a synchronizuje s účtem jako ostatní nastavení. Texty knih se nepřekládají.

## Jak se píšou texty

Klíčem překladu je původní české znění, takže kód zůstává čitelný a nevymýšlejí se názvy klíčů.

```jsx
import { t, tx } from '../i18n';

<button title={t('Hledat knihy')}>{t('Uložit')}</button>
t('Máš {n} knih', { n })                                  // parametry se píšou do složených závorek
t.p(n, '{n} kniha', '{n} knihy', '{n} knih', { n })        // tvary podle počtu (česky 1 / 2–4 / 5+, anglicky jednotné / množné)
tx('Klepni na {tlacitko} v liště.', { tlacitko: <b>Sdílet</b> })   // parametr smí být prvek Reactu, pořadí určuje překlad
```

- `t` se nikdy nevolá na úrovni modulu (běžela by dřív, než se načte jazyk). Texty v konstantách se označují `tk('…')`
  (vrátí text beze změny) a přeloží se až při vykreslení: `t(polozka.label)`.
- Při přepnutí jazyka se obsah appky vykreslí znovu (`App.jsx`, `key={lang}`), takže komponenty nemusí nic hlídat.
- Brand a názvy, které se nepřekládají (Jomarid Books, shortB), mají v prvku `translate="no"`.
- Data a čísla: `formatDate`, `formatDateTime`, `formatNumber` (ne `toLocaleString('cs-CZ')`). Řazení českých názvů knih zůstává `'cs'`.
- Moduly bez Reactu a datové soubory berou `t` z `i18n/core.js`, `tk` z `i18n/mark.js`.

## Slovník

`src/i18n/en/<oblast>.js`: `{ 'Česky': 'English' }`, plurály `{ 'kniha|knihy|knih': ['book', 'books'] }`. Stahuje se až při
použití angličtiny (nezvětšuje start české appky). Soubory zapisuje nástroj:

```
npm run i18n:codemod -- --strings cesta/Soubor.jsx   # obalí JSX texty, atributy a řetězce do t(...), plural() převede na t.p(...)
npm run i18n:extract -- ukoly.txt                    # vypíše české klíče, které nemají překlad (řádky  číslo|česky)
npm run i18n:apply -- oblast ukoly.txt odpovedi.txt  # odpovědi  číslo|English  zapíše do en/oblast.js
npm run i18n:baseline                                # přegeneruje seznam toho, co ještě není přeložené
```

## Hlídání (src/tests/i18n.test.mjs)

- každý text v `t`, `tx`, `tk`, `t.p` má anglický záznam a ve slovníku není nic nepoužitého,
- překlad má stejné `{parametry}`, nemá českou diakritiku a nesmí být shodný s klíčem (kromě `IDENTICAL_OK`),
- `t` je importované, nikde nepřekryté a nevolané na úrovni modulu,
- konstanta s `tk` se při vypsání vždy překládá přes `t`,
- v kódu nepřibyl nepřeložený český text: seznam `tools/baseline.json` je zároveň seznam úkolů, po přeložení souboru ho přegeneruj.
