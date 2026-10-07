// Jedna sdílená synchronizace nastavení s účtem pro celou appku a hák, kterým Nastavení ukazuje její stav.
import { useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { createSettingsSync } from './settingsSync.js';

export const settingsSync = createSettingsSync({ client: supabase });

export const useSyncStatus = () => useSyncExternalStore(settingsSync.subscribe, () => settingsSync.status);
