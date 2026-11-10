// Společné volání serveru pro online hru (jeden klient na celou appku).
import { supabase } from '../lib/supabase';
import { createMpApi } from './api.js';

export const mpApi = createMpApi(supabase);
