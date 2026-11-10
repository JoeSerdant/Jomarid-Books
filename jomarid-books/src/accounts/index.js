// Přepínač účtů zapojený na skutečné služby appky (jedna sada na celý běh): hlavní klient Supabase, dočasný klient, úložiště, úklid dat účtu.
import { createClient } from '@supabase/supabase-js';
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase';
import { loginWithCode } from '../offline/loginCode';
import { purgeUserData } from '../offline/index.js';
import { clearCachedProfile } from '../offline/session';
import { cleanupOnLogout } from '../push/pushClient';
import { clearPersonalBrowseState } from '../browse/browseStore';
import { createAccountManager } from './accountManager.js';
import { VAULT_KEY } from './vault.js';

// Klient, který nic neukládá a sám se neobnovuje: přihlášení a ověření účtu se děje mimo hlavního klienta, ať aktuální účet zůstane nedotčený.
const makeTempClient = () => createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'jomarid-accounts-temp' },
});

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('jomarid-accounts') : null;

export const accounts = createAccountManager({
  client: supabase,
  makeTempClient,
  loginWithCode: (client, code) => loginWithCode(client, { url: supabaseUrl, key: supabaseKey }, code),
  storage: typeof localStorage !== 'undefined' ? localStorage : null,
  hooks: {
    // Zařízení nemá dál dostávat oznámení účtu, který opouštíme (relace je ještě jeho, takže jde zařízení u serveru odhlásit).
    beforeLeave: () => cleanupOnLogout({ client: supabase, nav: navigator, win: window }),
    // Odebraný účet na zařízení nic nenechá; data ostatních účtů zůstanou.
    afterForget: async (userId) => { clearCachedProfile(userId); await purgeUserData(userId); },
    resetPersonalState: () => clearPersonalBrowseState(),
  },
  reload: () => { window.location.assign('/app'); },
  notify: (msg) => { channel?.postMessage(msg); },
});

// Jiná karta přepnula účet: tahle se načte znovu, ať v ní nezůstane nic po předchozím účtu. Změna trezoru z jiné karty (odebrání účtu) obnoví seznam.
if (channel) channel.onmessage = (e) => { if (e.data?.type === 'switched') window.location.reload(); };
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === VAULT_KEY) accounts.refresh(); });
