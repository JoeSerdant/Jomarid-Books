# Oznámení do telefonu (Web Push): nastavení

Oznámení z appky (Nastavení → Oznámení, u správce i Správa → Upozornění) se po tomhle nastavení ukážou i jako oznámení v telefonu nebo
počítači. Nastavuje se jednou, ručně, protože appka (web) nemá k Supabase žádný klíč na správu. **Nic z toho neposílej do chatu ani do repozitáře**: tajné
hodnoty patří jen do Supabase.

Na iPhonu a iPadu oznámení fungují **jen v appce přidané na plochu** (Nastavení → Aplikace), v obyčejném Safari ne. Android a počítač (Chrome, Edge, Firefox) fungují i v prohlížeči.

## 1. SQL v databázi
Supabase → **SQL Editor** → vlož celý soubor `db/push-notifications.sql` → Run. Je bezpečné pustit ho víckrát.

## 2. Klíče (VAPID)
V appce jako správce: **Správa → Upozornění → Oznámení do telefonu → Vygenerovat klíče**. Veřejný klíč se uloží sám, **soukromý se ukáže jen jednou**:
nech okno otevřené, než ho vložíš do Supabase v kroku 4. Veřejný klíč (potřebuješ ho v kroku 4 taky) uvidíš ve Správě → Upozornění i později a jde zkopírovat; soukromý ne.
(Znovu generovat klíče znamená, že si všichni musí oznámení zapnout znovu.)

## 3. Adresa funkce a sdílené heslo
V SQL Editoru spusť:
```sql
insert into public.push_settings (id, function_url, secret)
values (1, 'https://vcdnqllluagmaxtwrnmf.supabase.co/functions/v1/send-push', encode(gen_random_bytes(24), 'hex'))
on conflict (id) do update set function_url = excluded.function_url;

select secret from public.push_settings;
```
Výsledná hodnota `secret` je sdílené heslo mezi databází a funkcí: zkopíruj ji do kroku 4.

## 4. Tajné hodnoty funkce
Supabase → **Edge Functions → Secrets** → přidej:

| Název | Hodnota |
| --- | --- |
| `VAPID_PUBLIC_KEY` | veřejný klíč z kroku 2 |
| `VAPID_PRIVATE_KEY` | soukromý klíč z kroku 2 |
| `VAPID_SUBJECT` | `mailto:` a tvůj e-mail (např. `mailto:ty@example.cz`) |
| `PUSH_WEBHOOK_SECRET` | `secret` z kroku 3 |

## 5. Nasazení funkce
Supabase → **Edge Functions → Deploy a new function → Via Editor** → název **`send-push`** → vlož obsah `db/push/send-push.ts` → Deploy.
Ve vlastnostech funkce **vypni „Verify JWT“** (volá ji databáze s vlastním heslem, ne přihlášený uživatel).

## 6. Zkouška
Nastavení → **Oznámení** → **Zapnout oznámení v tomhle zařízení** → **Poslat zkušební oznámení (za 10 s)**. Oznámení se odešle **až za 10 sekund**, takže appku hned
zavři, přepni se na jinou kartu nebo zamkni telefon, ať ho opravdu uvidíš (v otevřené appce se na něj snadno nekoukne).

### Nepřišlo? Zjisti, kde to vázne
1. **Odešlo se vůbec něco?** V Supabase SQL Editoru:
   ```sql
   select id, status_code, left(content, 200) as odpoved, error_msg, created
   from net._http_response order by created desc limit 5;
   ```
   - `status_code 200` a v odpovědi `"sent":1` (nebo víc): server oznámení odeslal push službě prohlížeče. Pak je problém na zařízení: povolení oznámení v prohlížeči/systému,
     režim Nerušit, u iPhonu appka musí být přidaná na plochu a otevřená z ní.
   - `"sent":0,"total":0`: v databázi není žádné zařízení tohohle účtu. Zapni oznámení v Nastavení znovu.
   - `401`: heslo v databázi (`push_settings.secret`) nesedí s `PUSH_WEBHOOK_SECRET` v Edge Functions → Secrets. Dej tam stejnou hodnotu.
   - `404`: funkce `send-push` není nasazená, nebo adresa `function_url` v `push_settings` nesedí.
   - `500` nebo `db_error`: chyba v databázi, detail v Edge Functions → `send-push` → **Logs**.
   - Žádný řádek: databáze nic nevolala. Zkontroluj, že `push_settings` má vyplněnou `function_url` a `secret` (`select function_url, secret is not null from public.push_settings;`).
2. **Logy funkce:** Edge Functions → `send-push` → **Logs**. Chybějící nebo špatný klíč (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, musejí být ze stejného páru) se pozná tady.
3. **Verify JWT** u funkce musí být **vypnuté**.

## 7. Motivační oznámení (série, rozečtená kniha, cíl, novinky)
Po kroku 1–5 fungují i připomínky ve stylu „série je v ohrožení“. Nic dalšího se nenastavuje, jen musí běžet hodinový plánovač:
- SQL z kroku 1 ho zapne samo (rozšíření **pg_cron**). Kdyby SQL při spuštění vypsalo, že pg_cron nejde zapnout, zapni ho v Supabase:
  **Database → Extensions → pg_cron**, pak znovu spusť soubor z kroku 1. Nebo ručně **Integrations → Cron** → nový úkol typu SQL snippet
  `select public.push_engagement_tick();` každou hodinu.
- Čtenář dostane **víc oznámení během dne**: plánovač běží každou hodinu a posílá **od 8 do 21 h pražského času** (v noci je klid), s odstupem
  **3 hodiny** mezi dvěma oznámeními téhož čtenáře a **bez denního stropu**. Druhy se střídají (nikdy dvakrát po sobě totéž, pokud je z čeho vybírat).
  Vybírá se podle toho, co se hodí: série v ohrožení → návrat po pauze (3, 7, 14, 30 dní) → rozečtená kniha → měsíční cíl → mince na novou knihu →
  nová kniha v knihovně → jemné popostrčení. Kdo dnes už četl, dostane milník série (3, 7, 14, 30, 50, 100, 200, 365 dní), novinku a **pochvalu**,
  ale už žádné „přečti si“.
- **Četnost si upravíš jedním řádkem SQL** (bez nasazování; čísla jsou hodiny pražského času a minuty):
  ```sql
  update public.push_settings set engage_from = 8, engage_to = 21, engage_gap_minutes = 180, engage_max_per_day = null where id = 1;
  ```
  Častěji: `engage_gap_minutes = 60` (nejvýš jedno za hodinu) nebo `0` (každou hodinu, kdy plánovač běží). Kratší den: třeba `engage_from = 10, engage_to = 20`.
  Denní strop zapneš např. `engage_max_per_day = 3`, `null` znamená bez stropu. Nic z toho se nenasazuje, platí od další hodiny.
- Texty jsou v `db/push/send-push.ts` (funkce `compose`): u každého druhu je víc variant, losují se a mění se podle denní doby (ráno, přes den, večer, pozdě večer)
  a u popostrčení i podle dne v týdnu. Chceš je upravit? Změň texty a funkci znovu nasaď (krok 5).
- **Nové knihy** se oznamují stejnou cestou jako ostatní připomínky (ne hned): kniha, která se právě zveřejnila, čeká ve frontě a čtenář o ní dostane
  oznámení v okně hodin a s odstupem jako ostatní (nová kniha má přednost před jemným popostrčením, ne před sérií, cílem apod.). Novinky se
  neposílají autorovi, ani tomu, kdo knihu už má, a další novinka čtenáři nejdřív za 12 hodin (hromadné vkládání knih nikoho nezaplaví).
- Každý čtenář si připomínky a novinky vypne v **Nastavení → Oznámení** (zaškrtávátko „Připomínky a novinky“). Oznámení z appky (dary, odpovědi správce...) zůstávají.
- Ukázky: **Správa → Upozornění → Ukázky motivačních oznámení** pošle na tvoje zařízení vzorek každého druhu s ukázkovými údaji.
- Už máš funkci `send-push` nasazenou z dřívějška? Vlož do ní nový obsah `db/push/send-push.ts` a nasaď znovu, jinak se motivační texty neskládají.

## Testy SQL (pro vývoj)
`npm run test:sql` (nebo `bash db/tests/run.sh`) spustí `db/push-notifications.sql` na dočasném lokálním PostgreSQL proti zjednodušenému schématu Supabase
(`db/tests/mock_schema.sql`) a zkontroluje výběr oznámení, plánovač (okno hodin, odstup, strop, střídání druhů, souběh dvou průchodů), spouštěče, oprávnění a RLS.
Potřebuje PostgreSQL 14+ (`initdb`, `pg_ctl`, `psql`); bez něj se test přeskočí. Stejný test běží i v `npm test` (`src/tests/push.test.mjs`), je-li PostgreSQL k dispozici.
