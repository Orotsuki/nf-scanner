import type { NotaFiscal } from './types'

const STORAGE_KEY = 'nf-scanner:notes:v1'

function normalizeNote(value: Partial<NotaFiscal>): NotaFiscal {
  const legacy = value as Partial<NotaFiscal> & { dataLeitura?: string; dataControladoria?: string | null }

  return {
    id: value.id ?? crypto.randomUUID(),
    numeroNF: value.numeroNF ?? '',
    cnpjEmitente: (value.cnpjEmitente ?? '').replace(/\D/g, ''),
    fornecedor: value.fornecedor ?? '',
    valor: typeof value.valor === 'number' ? value.valor : null,
    chaveAcesso: value.chaveAcesso ?? '',
    dataCadastro: value.dataCadastro ?? legacy.dataLeitura ?? new Date().toISOString(),
    dataEnvio: value.dataEnvio ?? legacy.dataControladoria ?? null,
  }
}

export function loadNotes(): NotaFiscal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.map((item) => normalizeNote(item as Partial<NotaFiscal>))
  } catch {
    return []
  }
}

export function saveNotes(notes: NotaFiscal[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes.map(normalizeNote)))
}
