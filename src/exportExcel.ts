import * as XLSX from 'xlsx'
import type { NotaFiscal } from './types'

export function exportToXlsx(notes: NotaFiscal[]): void {
  const rows = notes.map((note) => ({
    'Número da NF': note.numeroNF,
    'CNPJ do emitente': note.cnpjEmitente,
    'Chave de acesso': note.chaveAcesso,
    'Data/hora da leitura': formatDateForExcel(note.dataLeitura),
  }))

  const worksheet = XLSX.utils.json_to_sheet(rows)
  worksheet['!cols'] = [
    { wch: 16 },
    { wch: 22 },
    { wch: 50 },
    { wch: 23 },
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'NF-es')

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `Notas_Fiscais_${stamp}.xlsx`, { compression: true })
}

function formatDateForExcel(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(iso))
}
