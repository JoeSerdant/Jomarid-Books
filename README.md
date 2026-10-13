# Jomarid Books

Digitální čítárna s postupem: knihy, odznaky, mince, minihry a oznámení do zařízení.

## Složky
- `jomarid-books/` – aplikace (React 18, Vite 5, Tailwind 3, react-router 6). Nasazuje se na Vercelu, `vercel.json` je v téhle složce.
- `jomarid-books/db/` – SQL a funkce pro Supabase. Seznam SQL souborů, pořadí spouštění a testy: `jomarid-books/db/README.md`. Oznámení do zařízení: návod v `jomarid-books/db/push/README.md`.

## Backend
Přihlášení, databáze a úložiště textů knih běží na Supabase. Adresa projektu a veřejný klíč jsou v `jomarid-books/src/lib/supabase.ts`.
Většina funkcí a tabulek je jen v databázi Supabase (v repu je jen SQL k oznámením a ke změně e-mailu).

## Příkazy
Ve složce `jomarid-books/`:

- `npm run dev` – vývojový server
- `npm run build` – sestavení pro nasazení
- `npm test` – testy
- `npm run lint` – kontrola kódu

## Verze
Číslo verze je jen v `jomarid-books/src/appInfo.js`.
