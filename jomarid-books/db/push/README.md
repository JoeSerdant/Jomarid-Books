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
