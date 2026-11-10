# Multiplayer (online hra ve dvou)

Server je `db/multiplayer.sql` (fronta, zápasy, tahy, hlášení výsledku, odměny); tady je strana appky.

```
 hra v iframu (srcDoc)  <--postMessage-->  most (bridge.js)  <-->  řadič zápasu (session.js)  <--RPC-->  Supabase (mp_* funkce)
   window.jomaridMP                          ověřuje zprávy         dotazuje server, posílá tahy
```

- `catalog.js` – které hry a režimy existují, jaké mají volby a kolik dá výhra. Musí odpovídat `mp_cfg` a `mp_clean_params` v SQL (hlídá `src/tests/multiplayer.test.mjs`). `ready: true` zapíná tlačítko „Hrát online“.
- `api.js` – tenká obálka nad `supabase.rpc`; chyby mají krátký kód (`not_your_turn`, `bad_seq`...) a příznak `transient` (výpadek spojení).
- `session.js` – `MpSession`: pohled serveru na zápas, dotazování (`mp_state`, zároveň „jsem tu“), tahy po jednom v pořadí (opakování po výpadku je bezpečné, server stejný tah přijme jen jednou), hlášení výsledku, čas serveru. Bez DOM, zkouší se s falešným serverem.
- `inject.js` – dokument hry pro online zápas: čisté úložiště v paměti (`mp:<hra>`), cheat kódy nahrazené náhodným textem, před skripty hry rozhraní `window.jomaridMP`.
- `bridge.js` – most: žádosti hry (tah, výsledek, vzdání, průběh, odchod) jdou na server přes řadič, události zpět do hry. Přijímají se jen zprávy z okna té jedné hry.
- `MpSection.jsx` – lobby pod „Spustit hru“ (hledání soupeře, kamarád přes kód, návrat do rozehraného zápasu).
- `MpGameScreen.jsx` – obrazovka zápasu (lišta, iframe, pásy o výpadcích, konec zápasu a odměna).

## Rozhraní, které hra dostane (`window.jomaridMP`)

| | |
| --- | --- |
| `init` | co se o zápase ví hned: `game`, `mode`, `params`, `seed`, `slot` (1 nebo 2; místo 1 začíná), `me`, `opponent`, `kind`, `team`, `target`, `inc` |
| `on(událost, fn)` | `sync` (celá historie tahů a pohled na zápas po `listen()`), `moves` (nové tahy), `match` (nový pohled serveru: čas, hodiny, na tahu, průběh), `end` (konec zápasu), `connection` |
| `listen()` | hra má obsluhu zaregistrovanou; appka pošle `sync` |
| `move(payload, { endTurn })` | tah (JSON do 16 kB, u šachů 400 B); server hlídá pořadí a čas, obsah ne |
| `report(výsledek, důvod)` | `win`, `loss`, `draw` z pohledu hráče; platí, když souhlasí oba |
| `progress(hodnota)` | průběh v závodě (City Clicker); server hlídá cíl |
| `resign()`, `close()` | vzdání; `close` je „chci odejít“ (appka se zeptá) |
| `serverNow()` | čas serveru |

Hra o odměně nerozhoduje: Coiny vyplácí server podle pravidel v `mp_cfg` (výhra, délka zápasu, denní strop, soupeř).

## Jak se přidá další hra

1. Pravidla hry do `mp_cfg` a `mp_clean_params` v `db/multiplayer.sql` (už jsou pro všech sedm her) a do `catalog.js` (`ready: true`).
2. Ve hře: `if (window.jomaridMP && window.jomaridMP.enabled)` místo menu rovnou zápas; `jomaridMP.on(...)`, potom `jomaridMP.listen()`.
3. Online zápas nemá uložený postup, cheaty, sólové rekordy ani odměny (appka je zahodí).
4. Test s falešným `jomaridMP` v testech hry a pak dva hráči v prohlížeči proti skutečnému SQL.
