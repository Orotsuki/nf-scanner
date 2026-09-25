import { isSupabaseConfigured, supabase } from './supabase'

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

function validateUsername(username: string): void {
  if (!/^[\p{L}\p{N}._-]{3,30}$/u.test(username)) {
    throw new Error('O usuário deve ter de 3 a 30 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.')
  }
}

async function usernameEmail(username: string): Promise<string> {
  const normalized = normalizeUsername(username)
  const bytes = new TextEncoder().encode(normalized)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(hash))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')

  return `u-${hex}@auth.nfscanner.app`
}

export async function signInUsername(username: string, password: string) {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error('A sincronização na nuvem ainda não foi configurada.')
  }

  const normalized = normalizeUsername(username)
  validateUsername(normalized)

  const email = await usernameEmail(normalized)
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) throw error
  return data.session
}
