import { supabase, supabasePublishableKey, supabaseUrl } from './supabase'

export type ManagedUser = {
  id: string
  username: string
  role: 'admin' | 'user'
  created_at: string
  last_sign_in_at: string | null
}

function endpoint(): string {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('A conexão com a nuvem não está configurada.')
  }

  return `${supabaseUrl}/functions/v1/admin-users`
}

async function callAdmin(
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error('A conexão com a nuvem não está configurada.')

  const { data, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !data.session) {
    throw new Error('Sua sessão expirou. Entre novamente.')
  }

  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('apikey', supabasePublishableKey)
  headers.set('Authorization', `Bearer ${data.session.access_token}`)

  const response = await fetch(`${endpoint()}${path}`, {
    ...init,
    headers,
  })

  const payload = await response.json().catch(() => ({} as Record<string, unknown>))

  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível concluir a operação.',
    )
  }

  return payload
}

export async function fetchManagedUsers(): Promise<ManagedUser[]> {
  const payload = await callAdmin('', { method: 'GET' })
  return Array.isArray(payload.users) ? payload.users as ManagedUser[] : []
}

export async function createManagedUser(
  username: string,
  password: string,
): Promise<ManagedUser> {
  const payload = await callAdmin('', {
    method: 'POST',
    body: JSON.stringify({
      action: 'create',
      username,
      password,
    }),
  })

  return payload.user as ManagedUser
}

export async function resetManagedUserPassword(
  userId: string,
  password: string,
): Promise<void> {
  await callAdmin('', {
    method: 'POST',
    body: JSON.stringify({
      action: 'reset_password',
      userId,
      password,
    }),
  })
}

export async function deleteManagedUser(userId: string): Promise<void> {
  await callAdmin('', {
    method: 'DELETE',
    body: JSON.stringify({ userId }),
  })
}
