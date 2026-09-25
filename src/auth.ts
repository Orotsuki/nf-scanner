import { isSupabaseConfigured, supabase, supabasePublishableKey, supabaseUrl } from './supabase'

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

function authClient() {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error('A sincronização na nuvem ainda não foi configurada.')
  }
  return supabase
}

export async function signInUsername(username: string, password: string) {
  const normalized = normalizeUsername(username)
  validateUsername(normalized)

  const email = await usernameEmail(normalized)
  const { data, error } = await authClient().auth.signInWithPassword({
    email,
    password,
  })

  if (error) throw error
  return data.session
}

export async function signUpUsername(username: string, password: string, registrationCode: string) {
  const normalized = normalizeUsername(username)
  const normalizedRegistrationCode = registrationCode.trim().toUpperCase()
  validateUsername(normalized)

  if (password.length < 6 || password.length > 72) {
    throw new Error('A senha deve ter entre 6 e 72 caracteres.')
  }

  if (!normalizedRegistrationCode) {
    throw new Error('Informe o código de cadastro.')
  }

  const endpoint = `${supabaseUrl}/functions/v1/username-auth`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${supabasePublishableKey}`,
    },
    body: JSON.stringify({
      username: normalized,
      password,
      registrationCode: normalizedRegistrationCode,
    }),
  })

  const payload = await response.json().catch(() => ({} as Record<string, unknown>))

  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível criar o usuário.',
    )
  }

  return signInUsername(normalized, password)
}
