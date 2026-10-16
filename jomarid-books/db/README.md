# Databáze (Supabase)

SQL soubory, které se spouštějí ručně v Supabase. Všechny jdou spustit víckrát bez ztráty dat (funkce se jen nahrazují; `push-notifications.sql` navíc odstraní zařízení s nepovolenou adresou; `game-records.sql` jen srovná seznam statistik a odznaků; `shop.sql` jen srovná seznam zboží; `game-saves.sql` nic nemaže, jen nahrazuje funkce).

Jak soubor spustit: na GitHubu ho otevři → **Copy raw file** → v Supabase otevři **SQL Editor** → vlož → **Run**.

| Soubor | K čemu je |
| --- | --- |
| `push-notifications.sql` | Oznámení do zařízení (push), motivační připomínky a plánovač. Postup celého nastavení (včetně Edge Function): [`push/README.md`](push/README.md). |
| `email-change.sql` | Změna e-mailu přes správce: žádost čtenáře, zrušení, provedení a zamítnutí správcem. |
| `game-records.sql` | Herní rekordy a odznaky: hry hlásí nejlepší výsledky, server je pamatuje u účtu, odemyká herní odznaky (jen XP) a dává data pro sekci Hry ve Statistikách a pro žebříčky. |
| `shop.sql` | Obchůdek: za Jomarid Coins se kupují tituly (u jména ve Statistikách a v žebříčku) a vzhledy her (barevný odstín hry). Nákup strhne mince a zapíše je do `coin_transactions`. |
| `game-saves.sql` | Uložený postup her: místo localStorage prohlížeče se postup každé hry (vylepšení, nastavení, rozehraná partie) ukládá u účtu, na všech zařízeních je stejný. |
| `game-coins.sql` | Jomarid Coins z her: denní strop 100 na jednu hru (dřív 75) a žádný strop za všechny hry dohromady (dřív 150), Kouloví Kámoši mezi hrami, které smějí o Coiny žádat, a zůstatek připsaný jednou (dřív dvakrát). Nahrazuje funkci `award_game_coins`. |

## Pořadí a předpoklady

1. `push-notifications.sql` podle [`push/README.md`](push/README.md).
2. `email-change.sql`. Potřebuje, aby v databázi už byly tabulky `profiles`, `admin_notifications`, `user_notifications`, `system_logs`, funkce `notif_require_admin()` a trigger `trg_sync_profile_email` na `auth.users` (seznam je i na začátku souboru). Na `push-notifications.sql` nezávisí, ale když je spuštěné, nová upozornění správci se posílají i jako oznámení do zařízení.
3. `game-records.sql`. Potřebuje jen tabulku `profiles` (sloupce `id`, `username`, `show_in_leaderboard`), na ostatních souborech nezávisí. Po něm se v appce nic dalšího nenastavuje. Jde ho spustit před nasazením nové verze appky i po něm; dokud neběží, appka funguje jako dřív: hry rekordy hlásí, ale server je nezapíše, sekce Hry ve Statistikách je prázdná a úroveň vychází bez herního XP. Znovu ho spusť jen po změně souboru (seznam statistik a odznaků je i v `src/gameRecords/catalog.js`, test `npm run test:gamerecords` hlídá, že si odpovídají).
4. `shop.sql`. Potřebuje hotové `game-records.sql` (některé tituly se odemykají herními odznaky) a tabulky `profiles` (sloupce `id`, `coins`, `username`, `show_in_leaderboard`) a `coin_transactions` (sloupce `user_id`, `amount`, `source_type`, ostatní sloupce musí mít výchozí hodnotu nebo smět být prázdné) se spouští `trg_update_coins`, která při zápisu do `coin_transactions` sama upraví `profiles.coins`. Nákup proto zůstatek v profilu přímo neupravuje, jen zapíše zápornou částku do `coin_transactions` (a před tím si, stejně jako `buy_streak_freeze`, nastaví `app.bypass_profile_column_guard`). Hned na začátku si soubor ověří zkušebním zápisem do `coin_transactions`, který vrátí zpět: když zápis nesníží zůstatek přesně o zapsanou částku (chybí spoušť, nebo dělá něco jiného) nebo tabulka zápis odmítne, soubor se zastaví s vysvětlením dřív, než cokoli změní. Dokud neběží, appka funguje jako dřív: obchůdek ve Statistikách se neukáže a hry se nepřebarvují. Znovu ho spusť jen po změně souboru (seznam zboží je i v `src/shop/catalog.js`, test `npm run test:shop` hlídá, že si odpovídají).
5. `game-saves.sql`. Potřebuje jen tabulku `profiles` (sloupec `id`), na ostatních souborech nezávisí. Hry si pořád "ukládají do localStorage", ale appka jim ho při spuštění nahradí pamětí a změny posílá sem (po odkladu pár sekund, při zavření hry hned). Při prvním spuštění každé hry po tomhle vydání appka postup z localStorage prohlížeče jednorázově přenese na server a z prohlížeče ho smaže; když už je na serveru jiný postup (z jiného zařízení), zůstane ten na serveru a starý z prohlížeče se uloží jen do sloupce `legacy_backup` (appka ho nikde nečte, jde ho případně obnovit ručně). Hra se bez načteného postupu ze serveru nespustí (kdyby běžela naprázdno, přepsala by uložený postup), takže **před nasazením nové verze appky ho spusť**; bez něj se žádná hra nespustí. Znovu ho spusť jen po změně souboru (meze a seznam her jsou i v `src/gameSave/catalog.js`, test `npm run test:gamesave` hlídá, že si odpovídají).
6. `game-coins.sql`. Jen nahrazuje funkci `award_game_coins`, která v databázi už je (když chybí, soubor se hned zastaví a nic nevytvoří). Mění čtyři věci: strop Coinů z jedné hry za den 75 → 100, strop ze všech her dohromady (dřív 150) se ruší (šest her tedy nejvýš 600 Coinů za den), do seznamu povolených her přidává `koulovikamosi` (dosud funkce každou žádost Kouloví Kámošů odmítla chybou `invalid_game_id`) a zůstatek se připisuje jednou: dřív ho zvýšila funkce sama a potom ještě spoušť `trg_update_coins` při zápisu do `coin_transactions`, takže hráč dostal dvojnásobek. Potřebuje spoušť `trg_update_coins`, která zápisem do `coin_transactions` zvýší `profiles.coins` přesně o zapsanou částku; hned na začátku si to ověří zkušebním zápisem, který vrátí zpět, a když to neplatí, soubor se zastaví a funkci nezmění (funkce zůstatek přímo neupravuje, bez spouště by hráči nedostali nic). Už připsané Coiny se nemění, změní se jen odměny od teď. Oprávnění funkce zůstávají. Appka na něm nezávisí, jde ho spustit před nasazením nové verze i po něm. Strop a seznam her hlídá test `src/tests/gameBar.test.mjs` (seznam her ve funkci musí odpovídat hrám v appce). Soubor už dvakrát běžel (stropy, Kouloví Kámoši, zůstatek); po zrušení celkového stropu ho spusť znovu.

Po `email-change.sql` se v appce nic dalšího nenastavuje. Znovu ho spusť jen po změně souboru. Jde ho spustit před nasazením nové verze appky i po něm; dokud neběží, Nastavení u změny e-mailu ukáže, že je dočasně nedostupná.

Supabase Auth umí e-mail změnit i přímým voláním API (`updateUser`); jestli ho potvrdí odkazem z nové schránky, záleží na nastavení projektu (Authentication → Providers → Email: **Confirm email**, **Secure email change**). `email-change.sql` tu cestu neblokuje.

Jediný správce si vlastní e-mail přes appku změnit nemůže (`cannot_change_own_email`). Změní si ho v Supabase → **Authentication** → **Users**; trigger `trg_sync_profile_email` pak zkopíruje e-mail do `profiles.email`.

### Kontrola e-mailů

E-mail v `auth.users` a `profiles` se má shodovat. Tenhle dotaz jen čte a měl by vrátit `0`:

```sql
select count(*) from auth.users u join public.profiles p on p.id = u.id where lower(u.email) is distinct from lower(p.email);
```

## Testy (`tests/`)

`bash db/tests/run.sh` (nebo `npm run test:sql`) spustí oba SQL soubory na dočasném lokálním PostgreSQL proti zjednodušenému schématu Supabase (`tests/mock_schema.sql`) a projde testy. Je to jen pro vývoj. `mock_schema.sql` maže schéma `public`, takže ho **nikdy nespouštěj v Supabase**.
