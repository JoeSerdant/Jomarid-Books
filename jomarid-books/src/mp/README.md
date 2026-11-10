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
- `entry.js` – vstup do online hry z menu samotné hry: ve zdroji každé hry je tlačítko (nebo karta) s atributem `data-jomarid-online`, ve hře spuštěné z appky ho appka ukáže (skript z `withOnlineEntry`, zprávy `online-ask` / `online`) a po kliknutí otevře okno Hrát online. Mimo appku a v online zápase je tlačítko schované (styl `html:not(.jomarid-online) [data-jomarid-online]` je ve hře).
- `MpLobbyDialog.jsx` – okno Hrát online nad hrou (portál): obsah je `MpSection` (hledání soupeře, kamarád přes kód, vstup do arény, návrat do rozehraného zápasu). Zavření při hledání soupeře hledání ukončí.
- `MpSection.jsx` – obsah okna a pomocné součásti: `useMpAvailability` (je multiplayer na serveru, `mp_ping`) a `MpResume` (na stránce hry už je jen pruh s rozehraným zápasem; jinak se tam o online nic nenabízí).
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
| `rt.open()`, `rt.send(payload, { force })`, `rt.track(stav)`, `rt.close()` | kanál v reálném čase pro rychlé hry (Rocket, aréna Polygonu): zprávy jdou přes Supabase Realtime Broadcast, ne přes databázi. `on('rt')` dá zprávu soupeře (`d.p`), `on('rt-status')` stav kanálu (`open`, `down`, `error`), `on('rt-presence')` kdo je v kanálu. Appka zprávy omezuje (nejvýš 50 za vteřinu, do 3000 znaků); `force: true` je pro důležité zprávy (konec, výsledek), které se neomezují odstupem |

Kanál `mp:<id zápasu>` pouští jen hráče zápasu (pravidla na `realtime.messages` v `db/multiplayer.sql`). Appka zkusí nejdřív soukromý kanál; kdyby ho projekt neměl zapnutý, zkusí obyčejný kanál stejného jména (číslo zápasu je náhodné a zná ho jen dvojice) a když nejde ani ten, hra to hráči řekne (`realtime.js`).

Hra o odměně nerozhoduje: Coiny vyplácí server podle pravidel v `mp_cfg` (výhra, délka zápasu, denní strop, soupeř).

## Společný svět (net.js): jak hry sdílejí jeden svět

Rychlé hry (Polygon aréna, Rocket) nepočítají každý svůj svět. Jeden hráč je **hostitel**: počítá celý svět jako v sólové hře (nepřátele, boty, střely, bonusy, zásahy). Ostatní jsou **hosté**: posílají hostiteli vstupy a od něj dostávají obraz světa, který kreslí stejným kreslením jako sólová hra. Všichni tak mají opravdu totéž. Stavební kameny jsou v `src/gameContent/shared/net.js` (vkládá se do dokumentu hry před jejím `mp.js`):

- `Replicator` (hostitel): z polí entit ve hře sestaví zprávu jen s tím, co se změnilo. Posílá se "odhad podle rychlosti": střela letící rovně se pošle jednou, tvar, který stojí, taky; entita se pošle znovu, až když se skutečnost rozejde s odhadem hosta víc než o toleranci, nebo po delší době. Každé 4 s přijde klíčová zpráva se stavem všeho (host podle ní odstraní, co už neexistuje); nově příchozí o úplnou zprávu i s popisy požádá.
- `Mirror` (host): zprávy skládá do tabulky entit a vrací jejich polohu odhadnutou podle rychlosti a vyhlazenou: při opravě se zbytek chyby plynule ztrácí (kolem 0,13 s), takže nic neskáče. Test se zpožděním 60 ms a kolísáním 40 ms: skoky mezi snímky do 6 jednotek.
- `Roster`: kdo je ve hře. Hostitelem je nejdřív příchozí. Kdo je hostitel doopravdy, určuje **číslo období** (term): každé převzetí ho zvýší a vyšší vyhrává, takže se vrátivší starý hostitel (třeba po uspání karty) nikoho nepřeskočí a stane se hostem.
- Když hostitel ztichne na 5 s nebo odejde, převezme to nejdřív příchozí z ostatních z toho, co měl na obrazovce (boti, tvary, hráči zůstanou, jen střely se zahodí).

Dvě omezení, která plynou z Realtime: každá zpráva se u Supabase počítá i za každého příjemce a bezplatný projekt snese **100 zpráv za vteřinu** a **2 miliony zpráv za měsíc**. Zprávy se proto posílají jen při změně a s víc hráči se zpomalují (`ratesFor` v `polygonArena/mp.js`: pro dva hráče asi 20 zpráv za vteřinu, pro šest ještě pod limit). Prohlížeč hostitele musí být vidět (uspaná karta se přestane počítat, hostitelství se pak předá).

## Sdílená aréna (Polygon aréna)

Žádné zápasy ani hledání soupeře: hráč vstoupí do jedné společné arény (`MpArenaScreen.jsx`, tlačítko Vstoupit do arény v okně Hrát online). Hra dostane `init.arena = true` (`initForArena`) a kanál `mp-arena:polygonarena`; most `attachArenaBridge` má jen operace kanálu (`rt-*`), `claim(sekundy, skóre)` (odměna za vyhrané kolo, server: `mp_arena_claim`) a `close`.

`polygonArena/mp.js` je deset míst: hráči a boti dohromady (když se připojí hráč, jeden bot zmizí; když odejde, bot se vrátí). Hostitel počítá celou arénu. Host si **pohyb svého tanku počítá sám** (odezva nic nestojí; hostitel mu polohu uvěří, jen ji omezí rychlostí, takže se nedá "teleportovat"). **Zdraví, zásahy, zkušenosti, třídy a výhody určuje hostitel**: host posílá jen vstupy (poloha, míření, střelba) a příkazy (koupit vlastnost, vybrat třídu nebo výhodu, skok, znovuzrození), které hostitel ověří (vlastnost jen za bod, třída a výhoda jen z nabídky). Pro rovné podmínky má aréna vlastní obtížnost bez bonusů pro hráče. Kolo trvá 160 s; vítěze kola oznámí hostitel a výherce o odměnu požádá server.

## Rocket: spolupráce jako společný svět

Spolupráce (dvě rakety) používá stejný základ: bojiště počítá **hostitel** (hráč na místě 1 v zápase) včetně druhé lodi, kterou řídí poloha od hosta; **host** (místo 2) dostává obraz (nepřátelé, bossové, střely, bonusy, paprsky a vlny) a posílá jen polohu své lodi a použití bomby. Nepřátelé míří na nejbližší živou loď, zásahy a bonusy druhé lodi počítá hostitel stejnými pravidly jako u jeho lodi (`rocket/mp.js`: `peerHits`). Zdraví lodí určuje hostitel. Boj dvou hráčů (souboj) zůstává u dvou samostatných polovin bojiště se stejnými vlnami podle společného času, protože tam se každý brání vlastním nepřátelům a jde o souboj lodí. Hostitel hry nemá zálohu: když jeho hra ztichne, host to uvidí a může hru ukončit, server pak zápas uzavře.

## Jak se přidá další hra

1. Pravidla hry do `mp_cfg` a `mp_clean_params` v `db/multiplayer.sql` (už jsou pro všech sedm her) a do `catalog.js` (`ready: true`). Do menu hry tlačítko s `data-jomarid-online` a styl, který ho schová (viz `entry.js`).
2. Ve hře: `if (window.jomaridMP && window.jomaridMP.enabled)` místo menu rovnou zápas; `jomaridMP.on(...)`, potom `jomaridMP.listen()`.
3. Online zápas nemá uložený postup, cheaty, sólové rekordy ani odměny (appka je zahodí).
4. Test s falešným `jomaridMP` v testech hry a pak dva hráči v prohlížeči proti skutečnému SQL.
