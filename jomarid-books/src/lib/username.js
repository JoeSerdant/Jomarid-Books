// Pravidla uživatelského jména na jednom místě (registrace, Nastavení, Admin). Server hlídá totéž.
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,18}[A-Za-z0-9]$/;
