// Role účtu. Hodnoty jsou tak, jak je drží databáze (profiles.role), proto s diakritikou.
export const ROLE_READER = 'uživatel';
export const ROLE_PUBLISHER = 'nakladatel';
export const ROLE_ADMIN = 'správce';

// Jak se role jmenuje v rozhraní (jednotné číslo).
export const ROLE_LABELS = {
  [ROLE_READER]: 'Čtenář',
  [ROLE_PUBLISHER]: 'Nakladatel',
  [ROLE_ADMIN]: 'Správce',
};
