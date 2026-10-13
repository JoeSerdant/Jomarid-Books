# Databáze (Supabase)

SQL soubory, které se spouštějí ručně v Supabase. Oba jdou spustit víckrát bez ztráty dat (funkce se jen nahrazují; `push-notifications.sql` navíc odstraní zařízení s nepovolenou adresou).

Jak soubor spustit: na GitHubu ho otevři → **Copy raw file** → v Supabase otevři **SQL Editor** → vlož → **Run**.

| Soubor | K čemu je |
| --- | --- |
| `push-notifications.sql` | Oznámení do zařízení (push), motivační připomínky a plánovač. Postup celého nastavení (včetně Edge Function): [`push/README.md`](push/README.md). |
| `email-change.sql` | Změna e-mailu přes správce: žádost čtenáře, zrušení, provedení a zamítnutí správcem. |

## Pořadí a předpoklady

1. `push-notifications.sql` podle [`push/README.md`](push/README.md).
2. `email-change.sql`. Potřebuje, aby v databázi už byly tabulky `profiles`, `admin_notifications`, `user_notifications`, `system_logs`, funkce `notif_require_admin()` a trigger `trg_sync_profile_email` na `auth.users` (seznam je i na začátku souboru). Na `push-notifications.sql` nezávisí, ale když je spuštěné, nová upozornění správci se posílají i jako oznámení do zařízení.

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
