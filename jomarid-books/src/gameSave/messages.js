import { tk } from '../i18n/mark.js';
// Hlášky kolem ukládání postupu her (lišta nad hrou a úvodní stránka hry).
export const SAVE_MESSAGES = {
  failing: tk('Postup se nepodařilo uložit, zkouším to znovu.'),
  recovered: tk('Postup je zase uložený.'),
  offline: tk('Jsi offline. Postup se ukládá do zařízení a po připojení se odešle.'),
  server_won: tk('Na jiném zařízení máš pokročilejší postup, ten platí. Postup z offline hraní je uložený jako záloha. Zavři hru a otevři ji znovu.'),
  conflict: tk('Tvůj postup se mezitím uložil z jiného zařízení. Zavři hru a otevři ji znovu, ať nepřijdeš o novější.'),
  rejected: tk('Postup se nepodařilo uložit, server ho nepřijal.'),
};

// Krátký štítek v liště, dokud se postup neukládá.
export const SAVE_CHIPS = {
  failing: tk('Neuloženo'),
  offline: 'Offline',
  conflict: 'Hraje se i jinde',
  rejected: tk('Neuloženo'),
};

export const SAVE_LOAD_ERROR = tk('Tvůj uložený postup se nepodařilo načíst, proto se hra nespustila (kdyby se pustila naprázdno, mohla by ho přepsat). Zkontroluj připojení a zkus to znovu.');

export const SAVE_NO_LOCAL_COPY = tk('Jsi offline a tahle hra na tomhle zařízení ještě nemá uložený postup. Můžeš hrát od začátku: po připojení se tvůj offline postup sloučí s účtem a platí ten pokročilejší (druhý se uloží jako záloha). Nebo počkej na připojení a hra načte postup z účtu.');
export const SAVE_PLAY_FRESH = tk('Hrát offline od začátku');
