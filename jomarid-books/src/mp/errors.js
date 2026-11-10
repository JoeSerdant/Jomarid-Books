// Srozumitelné české věty pro chyby online hry. Server vrací krátké kódy (db/multiplayer.sql), appka je tu přeloží.
import { t } from '../i18n/core.js';
import { tk } from '../i18n/mark.js';

const MESSAGES = {
  not_authenticated: tk('Pro online hru se musíš přihlásit.'),
  unavailable: tk('Online hra zatím není na serveru zapnutá.'),
  network: tk('Nepodařilo se spojit se serverem. Zkontroluj připojení.'),
  profile_not_found: tk('Tvůj účet nemá profil, online hra nejde spustit.'),
  unknown_mode: tk('Tenhle režim online hry neexistuje.'),
  invalid_params: tk('Neplatné nastavení zápasu.'),
  already_in_match: tk('Už máš rozehraný zápas. Nejdřív ho dohraj nebo vzdej.'),
  room_not_found: tk('Místnost s tímhle kódem neexistuje nebo už vypršela.'),
  room_taken: tk('Do téhle místnosti už někdo vstoupil.'),
  own_room: tk('Do vlastní místnosti vstoupit nejde. Pošli kód kamarádovi.'),
  not_in_match: tk('Tenhle zápas už není tvůj nebo neexistuje.'),
  not_active: tk('Zápas už skončil.'),
  not_your_turn: tk('Teď nejsi na tahu.'),
  bad_seq: tk('Zápas se rozešel se serverem, načítám ho znovu.'),
  too_large: tk('Tah je příliš velký.'),
  too_many: tk('Zápas má příliš mnoho tahů.'),
  too_early: tk('Zatím to nejde, chvíli počkej.'),
  already_started: tk('Zápas už začal.'),
  too_soon: tk('Zatím to nejde, chvíli počkej.'),
};

const FALLBACK = tk('Něco se v online hře pokazilo. Zkus to znovu.');

// Kód chyby (not_your_turn, network...) z odpovědi serveru.
export function errorCode(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err.code && /^[a-z_]+$/.test(String(err.code)) && err.code !== 'network') return String(err.code);
  const msg = String(err.message || '').trim();
  if (/^[a-z_]+$/.test(msg)) return msg;
  return err.transient ? 'network' : '';
}

export const mpErrorText = (err) => t(MESSAGES[errorCode(err)] || FALLBACK);
