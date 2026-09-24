import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vcdnqllluagmaxtwrnmf.supabase.co'
const supabaseKey = 'sb_publishable_bUOqlH__G6I20FTiowth0w_-MIZrAiM'

export const supabase = createClient(supabaseUrl, supabaseKey)
