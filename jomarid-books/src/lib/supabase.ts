import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vcdnqllluagmaxtwrnmf.supabase.co'
const supabaseKey = 'sb_publishable_bUOqlH__G6I20FTiowth0w_-MIZrAiM'

export const supabase = createClient(supabaseUrl, supabaseKey)

// Ověří heslo přihlášeného účtu (před změnou hesla / e-mailu / smazáním účtu)
// přes VLASTNÍHO, jednorázového klienta, který nic neukládá. Kdyby se to
// zkoušelo přes hlavního klienta, vyvolalo by to událost SIGNED_IN a všechny
// otevřené stránky (knihovna, čtečka...) by se znovu načetly.
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const temp = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'jomarid-verify-temp',
    },
  })
  const { error } = await temp.auth.signInWithPassword({ email, password })
  return !error
}

export const MIN_PASSWORD_LENGTH = 8

// Vrací text chyby, nebo prázdný řetězec, když je vše v pořádku.
// currentPw se předává jen tam, kde existuje "současné heslo" (změna v nastavení);
// u obnovy hesla přes e-mail žádné současné heslo není.
export const validateNewPassword = (newPw: string, confirmPw: string, currentPw?: string): string => {
  if (!newPw || newPw.length < MIN_PASSWORD_LENGTH) return `Nové heslo musí mít aspoň ${MIN_PASSWORD_LENGTH} znaků.`
  if (newPw !== confirmPw) return 'Hesla se neshodují.'
  if (currentPw !== undefined && newPw === currentPw) return 'Nové heslo musí být jiné než současné.'
  return ''
}

// Převede chybu ze Supabase Auth na srozumitelnou českou větu.
export const mapAuthError = (err: any): string => {
  const msg = String(err?.message || '').toLowerCase()
  if (err?.status === 429 || msg.includes('rate limit') || msg.includes('too many')) return 'Příliš mnoho pokusů. Zkus to za chvíli.'
  if (msg.includes('different from the old') || msg.includes('same as the old')) return 'Nové heslo musí být jiné než současné.'
  if (msg.includes('weak') || msg.includes('at least') || msg.includes('should contain')) return 'Heslo je příliš slabé - zvol delší a méně předvídatelné.'
  if (msg.includes('already been registered') || msg.includes('already registered') || msg.includes('already exists')) return 'Tento e-mail už používá jiný účet.'
  if (msg.includes('jwt') || msg.includes('session') || msg.includes('not authenticated')) return 'Přihlášení vypršelo, přihlas se prosím znovu.'
  return 'Něco se nepovedlo: ' + (err?.message || 'neznámá chyba')
}
