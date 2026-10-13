// Změna e-mailu přes správce: čistá logika (bez Reactu) pro Nastavení a Admin. Funkce v databázi: db/email-change.sql.

// Stejný výraz jako v db/email-change.sql: tečky jen mezi částmi domény (ne na začátku, na konci ani dvě za sebou).
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
export const EMAIL_MAX = 254;

// Porovnává se vždy bez mezer na krajích a bez ohledu na velikost písmen.
export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();
export const sameEmail = (a, b) => normalizeEmail(a) === normalizeEmail(b);
export const isValidEmail = (value) => {
  const v = normalizeEmail(value);
  return v.length > 0 && v.length <= EMAIL_MAX && EMAIL_RE.test(v);
};

// Typ upozornění pro správce a druhy oznámení pro čtenáře (stejné názvy jako v db/email-change.sql).
export const EMAIL_REQUEST_KIND = 'email_change_request';
export const EMAIL_CHANGED_KIND = 'email_changed';
export const EMAIL_REJECTED_KIND = 'email_change_rejected';

// Texty chyb podle kódu, který vrací databáze (raise exception '<kód>'). Klíče nesmí být podřetězcem jiného klíče:
// hledá se podle toho, jestli zpráva kód obsahuje.
export const REQUEST_ERRORS = {
  not_authenticated: 'Nejdřív se přihlas.',
  invalid_email: 'Zadej platný e-mail.',
  same_email: 'To je tvůj současný e-mail.',
  request_already_open: 'Žádost už čeká na správce. Můžeš ji zrušit a poslat novou.',
  too_many_requests: 'Příliš mnoho žádostí. Zkus to za pár hodin.',
};

export const ADMIN_EMAIL_ERRORS = {
  invalid_email: 'Neplatný e-mail.',
  same_email: 'Účet už tenhle e-mail má.',
  email_taken: 'Tenhle e-mail už používá jiný účet.',
  email_mismatch: 'Tenhle e-mail není ten, o který uživatel žádal. Obnov upozornění a zkus to znovu.',
  cannot_change_own_email: 'Vlastní e-mail si změnit nejde - požádej druhého správce, nebo ho změň v Supabase (Authentication → Users).',
  profile_email_not_synced: 'E-mail se nepodařilo zapsat do profilu, nic se nezměnilo. Zkus to znovu.',
};

/** Srozumitelný text pro chybu z databáze: najde první známý kód ve zprávě, jinak vrátí náhradní text. */
export const explainEmailError = (error, table, fallback) => {
  const msg = String(error?.message ?? error ?? '');
  const code = Object.keys(table).find((k) => msg.includes(k));
  return code ? table[code] : fallback;
};
