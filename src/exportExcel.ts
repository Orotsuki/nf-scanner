import * as XLSX from 'xlsx'
import type { NotaFiscal } from './types'

export function exportToXlsx(notes: NotaFiscal[]): void {
  const rows = notes.map((note) => ({
    'Número da NF': note.numeroNF,
    'CNPJ do emitente': note.cnpjEmitente,
    'Fornecedor': note.fornecedor,
    'Valor': note.valor,
    'Chave de acesso': note.chaveAcesso,
  }))

  const worksheet = XLSX.utils.json_to_sheet(rows)
  worksheet['!cols'] = [
    { wch: 16 },
    { wch: 18 },
    { wch: 36 },
    { wch: 16 },
    { wch: 50 },
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'NF-es')

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `Notas_Fiscais_${stamp}.xlsx`, { compression: true })
}
