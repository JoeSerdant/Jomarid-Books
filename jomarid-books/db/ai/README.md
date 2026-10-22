# AI v appce (Gemini): nastavení

Dvě Edge Functions: **`shortb-ai`** (psaní shortB ve Studiu, níže) a **`help-bot`** (chat pomocník pro všechny přihlášené, kapitola na konci).

# AI pomocník pro shortB (Gemini): nastavení

Ve Studiu (Nakladatelský panel → záložka shortB → Nový shortB) je panel **Napsat s AI**. Nakladatel napíše zadání, AI navrhne **text** a vloží ho do formuláře.
Název a žánry AI navrhne (do formuláře se vyplní jen prázdná pole), sérii vyplňuje nakladatel sám, nic se neukládá samo a návrh si nakladatel před zveřejněním přečte a upraví. U série je tlačítko
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
| `GEMINI_MODEL` | nepovinné; název modelu z AI Studia. Výchozí je `gemini-3.8-flash` (rychlý a levný; Google starší 2.5-flash novým uživatelům zrušil). Kdyby ho Google zrušil, dej sem aktuální název |

`SUPABASE_URL` a `SUPABASE_ANON_KEY` dodává Supabase sám.

## 2. Nasazení funkce
Supabase → **Edge Functions → Deploy a new function → Via Editor** → název **`shortb-ai`** → vlož obsah `jomarid-books/db/ai/shortb-ai.ts` → Deploy.
**„Verify JWT“ (v nastavení funkce) vypni**, stejně jako u `send-push`. Funkce si přihlášení ověřuje sama (token ověří Supabase Auth) a roli nakladatel nebo správce
kontroluje taky sama, takže bez zapnutého ověření nic neriskuješ. Zapnuté ověření v některých projektech (s novými klíči) přihlášeného uživatele odmítne dřív, než se funkce vůbec spustí.

## 3. Zkouška
Přihlas se jako nakladatel nebo správce → Studio → **shortB** → **Nový shortB** → **Napsat s AI** → zadání (třeba „Horor o opuštěném majáku“) → **Napsat text**.
Do pole Text se vloží návrh (může to trvat až půl minuty).

## Kdyby to nešlo
| Hláška v appce | Co to znamená |
| --- | --- |
| „Funkce shortb-ai nebyla nalezena“ | Funkce má jiný název. V Edge Functions musí být přesně `shortb-ai` (malými písmeny, s pomlčkou). |
| „Funkce shortb-ai se nespustila“ | Funkce spadla hned při startu (třeba chyba při vložení kódu: vlož celý soubor `shortb-ai.ts` od první do poslední řádky) nebo má špatný název. Detail je v Edge Functions → `shortb-ai` → **Logs**. |
| „Nepodařilo se spojit s funkcí“ | Spojení se nepovedlo: funkce není nasazená, je vypnutá, nebo selhala síť. Zkus to znovu a podívej se do **Logs**. |
| „Funkce shortb-ai odmítla přihlášení“ | Je zapnuté „Verify JWT“. Vypni ho v nastavení funkce a ulož. |

Hlášky jsou pro uživatele lidské a technická příčina je pod nimi ve sbalené části **„Technické podrobnosti“** (rozklikni ji a pošli mi řádek, pokud si nevíš rady).

| Hláška v appce | Co to znamená |
| --- | --- |
| „Promiň! AI teď zažívá závratě…“ | Google vrátil 5xx (nejčastěji 503: model je přetížený) nebo se funkce nespustila správně (chybí nebo nesedí `GEMINI_API_KEY`, model neexistuje v `GEMINI_MODEL`). Přetížení přejde samo, funkce to sama zkusí znovu. Detail je v Technických podrobnostech a v Edge Functions → `shortb-ai` → **Logs**. |
| „Pomalu, pomalu! AI má teď plno…“ | Google vrátil 429: překročený limit klíče nebo zdarma dostupných dotazů (v podrobnostech je, jestli za minutu nebo za den). Zkus později, přepni `GEMINI_MODEL` na „lite“ model, nebo dej do `GEMINI_API_KEY` klíč z jiného projektu. |
| „AI přemýšlí nějak dlouho“ | Model neodpověděl v časovém limitu. Zkus znovu; pomůže lehčí model v `GEMINI_MODEL`. |
| „S tímhle zadáním AI nepomůže“ | Bezpečnostní filtr Googlu. Zadání přeformuluj. |
| „ShortB smí psát jen nakladatel nebo správce“ | Účet nemá roli nakladatel ani správce. |

## Cena a limity
Appka žádný limit nemá (jedno generování je jeden dotaz ke Gemini). Kolik dotazů je zdarma a kolik stojí placené, určuje Google a mění se: zkontroluj to v AI Studiu
a využití sleduj tam. Kdyby se jedno generování zneužívalo, dá se doplnit denní limit na účet (stačí tabulka s počtem volání a kontrola ve funkci).

## Testy
`npm run test:shortsai` zkouší funkci s falešným modelem (bez sítě): oprávnění, kontrolu vstupu, uklizení textu, oříznutí na 6 000 znaků, chyby a to, že klíč není v appce ani v repu.

# Pomocník v appce (chat, funkce `help-bot`)

Plovoucí tlačítko vpravo dole pro každého přihlášeného (mimo čtečku, hry a feed shortB). Odpovídá **jen na otázky o používání appky** podle příručky, která je přímo
v kódu funkce (`APP_GUIDE` v `help-bot.ts`; změní-li se appka, uprav příručku). Na cokoli jiného (kód, eseje, úkoly, obecné otázky) odpoví pevnou větou.
Používá **lehčí a rychlejší model** než shortb-ai, odpověď je krátká (do 700 znaků) a každý uživatel má **40 otázek denně**.

## Jak je zajištěný proti zneužití
Žádná ochrana není stoprocentní, proto je jich víc: přihlášení; denní limit započítaný dřív, než se model zavolá; vstup se čistí (jen zprávy uživatele a pomocníka, krátké, nejvýš 8 posledních);
přísné pokyny; a hlavně model vrací strukturovaně `{onTopic, answer}` a když není `onTopic` pravda (nebo odpověď obsahuje kód), server odpověď modelu **zahodí**
a pošle pevnou větu, takže z modelu nic nevyteče. Strop odpovědi i denní limit omezují škodu, kdyby někdo našel trhlinu.

## 1. SQL (limit otázek)
Spusť `db/help-bot.sql` v Supabase SQL Editoru (stejně jako ostatní soubory v `db/`). **Před** nasazením funkce.

## 2. Tajné hodnoty
Přidej **`HELP_BOT_API_KEY`**: vlastní klíč z Google AI Studia jen pro pomocníka (má pak vlastní limity, nezávislé na shortb-ai). Když ho nepřidáš, použije se `GEMINI_API_KEY` z shortb-ai. Klíč nedávej do chatu ani do repozitáře, jen sem. Nepovinně `HELP_BOT_MODEL`: název modelu z AI Studia (výchozí `gemini-3.5-flash-lite`, nejlehčí a nejlevnější model řady). Kdyby ho Google zrušil, dej sem aktuální název.

## 3. Nasazení funkce
Supabase → **Edge Functions → Deploy a new function → Via Editor** → název **`help-bot`** (přesně) → vlož obsah `jomarid-books/db/ai/help-bot.ts` → Deploy.
**„Verify JWT“ vypni**, stejně jako u shortb-ai (funkce si přihlášení ověřuje sama).

## 4. Zkouška
Přihlas se → tlačítko vpravo dole → „Jak získám Jomarid Coins?“ → odpověď. Pak zkus „napiš mi esej o Máchovi“: musí přijít „S tímhle ti tady nepomůžu…“.

## Kdyby to nešlo
Hlášky jsou stejné jako u shortb-ai (kapitola výš), jen s názvem `help-bot`. Navíc: „nepodařilo se ověřit denní limit“ = nespuštěné `db/help-bot.sql`; „Dnešní limit otázek je vyčerpaný“ = uživatel vyčerpal 40 otázek
(limit je konstanta `DAILY_LIMIT` v `help-bot.ts`).

## Testy
`npm run test:helpbot` zkouší funkci s falešným modelem (bez sítě): přihlášení, čištění vstupu, zahazování odpovědí mimo téma, limit a vrácení otázky, klíč není v kódu; plus klienta.
`bash db/tests/run.sh` zkouší SQL limit.
