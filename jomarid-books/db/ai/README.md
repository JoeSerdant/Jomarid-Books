# AI pomocník pro shortB (Gemini): nastavení

Ve Studiu (Nakladatelský panel → záložka shortB → Nový shortB) je panel **Napsat s AI**. Nakladatel napíše zadání, AI navrhne **text** a vloží ho do formuláře.
Název, žánry a sérii vyplňuje nakladatel sám, nic se neukládá samo a návrh si nakladatel před zveřejněním přečte a upraví. U série je tlačítko
**Napsat další díl**: naváže na nejvyšší díl téže série, který už je mezi shortB. Žádný denní limit.

Volání Gemini jde přes Edge Function **`shortb-ai`**, protože klíč nesmí být v appce (kdokoli by ho z prohlížeče vytáhl). Funkci smí zavolat jen přihlášený
nakladatel nebo správce. Nasazuje se jednou, ručně, stejně jako push oznámení. **Klíč nedávej do repozitáře, do chatu ani nikam jinam než do Supabase.**

## 0. Klíč z Google AI Studia
Klíč vytvoříš v [Google AI Studiu](https://aistudio.google.com/apikey) (API keys → Create API key). Jestli jsi klíč někde ukázal (screenshot, chat, e-mail),
ber ho jako vyzrazený: v AI Studiu ho **smaž** a vytvoř nový.

## 1. Tajné hodnoty
Supabase → **Edge Functions → Secrets** → přidej:

| Název | Hodnota |
| --- | --- |
| `GEMINI_API_KEY` | klíč z kroku 0 |
| `GEMINI_MODEL` | nepovinné; název modelu z AI Studia. Výchozí je `gemini-2.5-flash` (rychlý a levný). Kdyby ho Google zrušil, dej sem aktuální název |

`SUPABASE_URL` a `SUPABASE_ANON_KEY` dodává Supabase sám.

## 2. Nasazení funkce
Supabase → **Edge Functions → Deploy a new function → Via Editor** → název **`shortb-ai`** → vlož obsah `jomarid-books/db/ai/shortb-ai.ts` → Deploy.
**„Verify JWT“ nech zapnuté** (funkce ji volá přihlášený uživatel z appky; roli nakladatel nebo správce si funkce navíc kontroluje sama).

## 3. Zkouška
Přihlas se jako nakladatel nebo správce → Studio → **shortB** → **Nový shortB** → **Napsat s AI** → zadání (třeba „Horor o opuštěném majáku“) → **Napsat text**.
Do pole Text se vloží návrh (může to trvat až půl minuty).

## Kdyby to nešlo
| Hláška v appce | Co to znamená |
| --- | --- |
| „AI pomocník zatím není nastavený“ | Funkce `shortb-ai` není nasazená, nebo má jiný název. Zkontroluj krok 2. |
| „AI teď neodpovídá“ | Chybí nebo nesedí `GEMINI_API_KEY`, nebo model neexistuje (`GEMINI_MODEL`). Detail je v Edge Functions → `shortb-ai` → **Logs**. |
| „AI má teď plno nebo vyčerpaný limit“ | Google vrátil 429: překročený limit klíče nebo zdarma dostupných dotazů. Zkus později, nebo v AI Studiu zkontroluj využití a nastavení účtu. |
| „AI tohle zadání odmítla“ | Bezpečnostní filtr Googlu. Zadání přeformuluj. |
| „ShortB smí psát jen nakladatel nebo správce“ | Účet nemá roli nakladatel ani správce. |

## Cena a limity
Appka žádný limit nemá (jedno generování je jeden dotaz ke Gemini). Kolik dotazů je zdarma a kolik stojí placené, určuje Google a mění se: zkontroluj to v AI Studiu
a využití sleduj tam. Kdyby se jedno generování zneužívalo, dá se doplnit denní limit na účet (stačí tabulka s počtem volání a kontrola ve funkci).

## Testy
`npm run test:shortsai` zkouší funkci s falešným modelem (bez sítě): oprávnění, kontrolu vstupu, uklizení textu, oříznutí na 6 000 znaků, chyby a to, že klíč není v appce ani v repu.
