// Hlášky kolem ukládání postupu her (lišta nad hrou a úvodní stránka hry).
export const SAVE_MESSAGES = {
  failing: 'Postup se nepodařilo uložit, zkouším to znovu.',
  recovered: 'Postup je zase uložený.',
  conflict: 'Tvůj postup se mezitím uložil z jiného zařízení. Zavři hru a otevři ji znovu, ať nepřijdeš o novější.',
  rejected: 'Postup se nepodařilo uložit, server ho nepřijal.',
};

// Krátký štítek v liště, dokud se postup neukládá.
export const SAVE_CHIPS = {
  failing: 'Neuloženo',
  conflict: 'Hraje se i jinde',
  rejected: 'Neuloženo',
};

export const SAVE_LOAD_ERROR = 'Tvůj uložený postup se nepodařilo načíst, proto se hra nespustila (kdyby se pustila naprázdno, mohla by ho přepsat). Zkontroluj připojení a zkus to znovu.';
