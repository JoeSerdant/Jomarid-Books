# Oznámení do telefonu (Web Push): nastavení

Oznámení z appky (Nastavení → Oznámení, u správce i Správa → Upozornění) se po tomhle nastavení ukážou i jako oznámení v telefonu nebo
počítači. Nastavuje se jednou, ručně, protože appka (web) nemá k Supabase žádný klíč na správu. **Nic z toho neposílej do chatu ani do repozitáře**: tajné
hodnoty patří jen do Supabase.

Na iPhonu a iPadu oznámení fungují **jen v appce přidané na plochu** (Nastavení → Aplikace), v obyčejném Safari ne. Android a počítač (Chrome, Edge, Firefox) fungují i v prohlížeči.

## 1. SQL v databázi
Supabase → **SQL Editor** → vlož celý soubor `db/push-notifications.sql` → Run. Je bezpečné pustit ho víckrát.

## 2. Klíče (VAPID)
V appce jako správce: **Správa → Upozornění → Oznámení do telefonu → Vygenerovat klíče**. Veřejný klíč se uloží sám, **soukromý se ukáže jen jednou**:
nech okno otevřené, než ho vložíš do Supabase v kroku 4.
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
Nastavení → **Oznámení** → **Zapnout oznámení v tomhle zařízení** → **Poslat zkušební oznámení**. Do pár vteřin má přijít oznámení.
Nepřišlo? Supabase → Edge Functions → `send-push` → **Logs** (a Database → Logs, `net._http_response`).

## 7. Motivační oznámení (série, rozečtená kniha, cíl, novinky)
Po kroku 1–5 fungují i připomínky ve stylu „série je v ohrožení“. Nic dalšího se nenastavuje, jen musí běžet hodinový plánovač:
- SQL z kroku 1 ho zapne samo (rozšíření **pg_cron**). Kdyby SQL při spuštění vypsalo, že pg_cron nejde zapnout, zapni ho v Supabase:
  **Database → Extensions → pg_cron**, pak znovu spusť soubor z kroku 1. Nebo ručně **Integrations → Cron** → nový úkol typu SQL snippet
  `select public.push_engagement_tick();` každou hodinu.
- Čtenář dostane **nejvýš jedno oznámení denně**, jen **mezi 16. a 19. hodinou pražského času** (každý má svou hodinu), nikdy v noci.
  Vybírá se podle toho, co se hodí nejvíc: série v ohrožení → milník série (3, 7, 14, 30, 50, 100, 200, 365 dní) → návrat po pauze (3, 7, 14, 30 dní)
  → rozečtená kniha → měsíční cíl → mince na novou knihu → nová kniha v knihovně → jemné popostrčení. Kdo dnes už četl, dostane jen milník nebo novinku.
- Texty jsou v `db/push/send-push.ts` (funkce `compose`): u každého druhu je víc variant, losují se. Chceš je upravit? Změň texty a funkci znovu nasaď (krok 5).
- **Nové knihy** se oznamují stejnou cestou jako ostatní připomínky (ne hned): kniha, která se právě zveřejnila, čeká ve frontě a čtenář o ní dostane
  oznámení v době 16–19 h, nejvýš jedno oznámení denně (nová kniha má přednost před jemným popostrčením, ne před sérií, cílem apod.). Novinky se
  neposílají autorovi, ani tomu, kdo knihu už má, a stejné oznámení dostane čtenář nejdřív za 2 dny (hromadné vkládání knih nikoho nezaplaví).
  Kdo dnes už četl, dostane novinku místo mlčení.
- Každý čtenář si připomínky a novinky vypne v **Nastavení → Oznámení** (zaškrtávátko „Připomínky a novinky“). Oznámení z appky (dary, odpovědi správce...) zůstávají.
- Ukázky: **Správa → Upozornění → Ukázky motivačních oznámení** pošle na tvoje zařízení vzorek každého druhu s ukázkovými údaji.
- Už máš funkci `send-push` nasazenou z dřívějška? Vlož do ní nový obsah `db/push/send-push.ts` a nasaď znovu, jinak se motivační texty neskládají.
