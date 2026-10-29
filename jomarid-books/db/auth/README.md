# Přihlašovací kód: nastavení

Čtenář si v **Nastavení → Zabezpečení → Přihlašovací kód** vygeneruje dlouhý náhodný kód (osm skupin po čtyřech znacích, např. `3F9A-0C12-...`) a může se jím přihlásit **místo hesla**:
na přihlašovací stránce volba **Přihlásit se kódem**. Heslo zůstává, kód je druhý způsob. Nový kód předchozí zneplatní, ztracený kód se nahradí novým.

Server kód nikdy neukládá, jen jeho otisk (SHA-256). Kód se ukáže jen jednou při vytvoření. Pokusy o jeho uhodnutí se omezují (10 neúspěšných za 10 minut z jedné adresy).

Potřebuje dvě věci, obě jednorázově:

## 1. SQL
Supabase → **SQL Editor** → vlož celý `jomarid-books/db/login-code.sql` → **Run**. Jde spustit víckrát, nic nemaže.

## 2. Edge Function `code-login`
Supabase → **Edge Functions → Deploy a new function → Via Editor** → název **`code-login`** (přesně takhle, malými písmeny s pomlčkou) → vlož obsah
`jomarid-books/db/auth/code-login.ts` → **Deploy**. **„Verify JWT“ vypni**: funkci volá nepřihlášený čtenář (právě se přihlašuje), kód si ověřuje sama.
Tajné hodnoty (Secrets) nejsou potřeba: `SUPABASE_URL` a `SUPABASE_SERVICE_ROLE_KEY` dodává Supabase sám. Klíč `service_role` je jen ve funkci, do prohlížeče se nedostane.

## 3. Zkouška
Přihlas se heslem → Nastavení → Zabezpečení → **Vytvořit přihlašovací kód** → zkopíruj ho → odhlas se → **Přihlásit se kódem** → vlož kód.

## Kdyby to nešlo
| Hláška v appce | Co to znamená |
| --- | --- |
| „Přihlášení kódem teď není dostupné“ | Funkce `code-login` není nasazená nebo má jiný název. |
| „Kód nesedí“ | Překlep, nebo je kód nahrazený novějším. V Nastavení po přihlášení heslem vygeneruj nový. |
| „Moc pokusů“ | Omezení po sérii chybných pokusů, uvolní se za deset minut. |
| „Přihlášení kódem se teď nepovedlo“ | Funkce spadla (chybí `login-code.sql`, nebo vypadl Auth). Podívej se do **Logs** funkce. |
