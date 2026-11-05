import { tk } from '../i18n/mark.js';

// Role účtu. Hodnoty jsou tak, jak je drží databáze (profiles.role), proto s diakritikou.
export const ROLE_READER = 'uživatel';
export const ROLE_PUBLISHER = 'nakladatel';
export const ROLE_ADMIN = 'správce';

// Jak se role jmenuje v rozhraní (jednotné číslo). Český text je klíč překladu, v rozhraní se vypisuje přes t(ROLE_LABELS[role]).
export const ROLE_LABELS = {
  [ROLE_READER]: tk('Čtenář'),
  [ROLE_PUBLISHER]: tk('Nakladatel'),
  [ROLE_ADMIN]: tk('Správce'),
};
