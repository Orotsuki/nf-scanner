import type { NotaFiscal } from './types'

const STORAGE_KEY = 'nf-scanner:notes:v1'

export function loadNotes(): NotaFiscal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as NotaFiscal[]) : []
  } catch {
    return []
  }
}

export function saveNotes(notes: NotaFiscal[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
}
