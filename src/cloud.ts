import type { Session } from '@supabase/supabase-js'
import type { NotaFiscal } from './types'
import { isSupabaseConfigured, supabase } from './supabase'

export type SupplierRecord = {
  id: string
  user_id: string
  cnpj: string
  nome: string
  created_at: string
  updated_at: string
}

function client() {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error('A sincronização na nuvem ainda não foi configurada.')
  }
  return supabase
}

function cloudToNote(row: Record<string, unknown>): NotaFiscal {
  return {
    id: String(row.id),
    numeroNF: String(row.numero_nf ?? ''),
    cnpjEmitente: String(row.cnpj_emitente ?? '').replace(/\D/g, ''),
    fornecedor: String(row.fornecedor ?? ''),
    valor: typeof row.valor === 'number' ? row.valor : row.valor == null ? null : Number(row.valor),
    chaveAcesso: String(row.chave_acesso ?? ''),
    dataLeitura: String(row.data_leitura ?? new Date().toISOString()),
  }
}

export async function getSession(): Promise<Session | null> {
  if (!supabase || !isSupabaseConfigured) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export function subscribeToAuthChanges(
  callback: (session: Session | null) => void,
): () => void {
  if (!supabase || !isSupabaseConfigured) return () => undefined

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })

  return () => data.subscription.unsubscribe()
}

export async function signOut(): Promise<void> {
  const { error } = await client().auth.signOut()
  if (error) throw error
}


export async function fetchCloudNotes(): Promise<NotaFiscal[]> {
  const { data, error } = await client()
    .from('notas_fiscais')
    .select('*')
    .order('data_leitura', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row) => cloudToNote(row as Record<string, unknown>))
}

export async function fetchSuppliers(): Promise<SupplierRecord[]> {
  const { data, error } = await client()
    .from('fornecedores')
    .select('*')
    .order('nome', { ascending: true })

  if (error) throw error
  return (data ?? []) as SupplierRecord[]
}

export async function findSupplierByCnpj(cnpj: string): Promise<SupplierRecord | null> {
  const digits = cnpj.replace(/\D/g, '')
  if (!digits) return null

  const { data, error } = await client()
    .from('fornecedores')
    .select('*')
    .eq('cnpj', digits)
    .maybeSingle()

  if (error) throw error
  return (data as SupplierRecord | null) ?? null
}

export async function upsertSupplier(cnpj: string, nome: string): Promise<void> {
  const digits = cnpj.replace(/\D/g, '')
  const trimmed = nome.trim()

  if (!digits || !trimmed) return

  const { data: userData } = await client().auth.getUser()
  if (!userData.user) throw new Error('Usuário não autenticado.')

  const { error } = await client()
    .from('fornecedores')
    .upsert(
      {
        user_id: userData.user.id,
        cnpj: digits,
        nome: trimmed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,cnpj' },
    )

  if (error) throw error
}

export async function upsertCloudNote(note: NotaFiscal): Promise<void> {
  const { data: userData } = await client().auth.getUser()
  if (!userData.user) throw new Error('Usuário não autenticado.')

  const { error } = await client()
    .from('notas_fiscais')
    .upsert(
      {
        id: note.id,
        user_id: userData.user.id,
        numero_nf: note.numeroNF,
        cnpj_emitente: note.cnpjEmitente.replace(/\D/g, ''),
        fornecedor: note.fornecedor.trim(),
        valor: note.valor,
        chave_acesso: note.chaveAcesso,
        data_leitura: note.dataLeitura,
      },
      { onConflict: 'user_id,chave_acesso' },
    )

  if (error) throw error
}

export async function updateCloudNote(note: NotaFiscal): Promise<void> {
  const { error } = await client()
    .from('notas_fiscais')
    .update({
      numero_nf: note.numeroNF,
      cnpj_emitente: note.cnpjEmitente.replace(/\D/g, ''),
      fornecedor: note.fornecedor.trim(),
      valor: note.valor,
      chave_acesso: note.chaveAcesso,
      data_leitura: note.dataLeitura,
    })
    .eq('id', note.id)

  if (error) throw error
}

export async function deleteCloudNote(id: string): Promise<void> {
  const { error } = await client()
    .from('notas_fiscais')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function deleteAllCloudNotes(): Promise<void> {
  const { error } = await client()
    .from('notas_fiscais')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  if (error) throw error
}

export async function mergeLocalNotesIntoCloud(localNotes: NotaFiscal[]): Promise<void> {
  if (!localNotes.length) return

  const remoteNotes = await fetchCloudNotes()
  const remoteKeys = new Set(remoteNotes.map((note) => note.chaveAcesso))

  for (const note of localNotes) {
    if (note.fornecedor.trim()) {
      await upsertSupplier(note.cnpjEmitente, note.fornecedor)
    }

    if (!remoteKeys.has(note.chaveAcesso)) {
      await upsertCloudNote(note)
      remoteKeys.add(note.chaveAcesso)
    }
  }
}

export function subscribeToCloudChanges(
  userId: string,
  callback: () => void,
): () => void {
  if (!supabase || !isSupabaseConfigured) return () => undefined

  const supabaseClient = supabase
  const channel = supabaseClient
    .channel(`nf-scanner-sync-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notas_fiscais',
        filter: `user_id=eq.${userId}`,
      },
      callback,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'fornecedores',
        filter: `user_id=eq.${userId}`,
      },
      callback,
    )
    .subscribe()

  return () => {
    void supabaseClient.removeChannel(channel)
  }
}
