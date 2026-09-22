import type { ParsedNFe } from './types'

export function cleanDigits(value: string): string {
  return value.replace(/\D/g, '')
}

export function extractAccessKey(raw: string): string | null {
  const decoded = decodeURIComponentSafely(raw)
  const match = decoded.match(/\d{44}/)
  return match?.[0] ?? (cleanDigits(decoded).length === 44 ? cleanDigits(decoded) : null)
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function formatCnpj(cnpj: string): string {
  const digits = cleanDigits(cnpj)
  if (digits.length !== 14) return cnpj
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`
}

export function unformatCnpj(cnpj: string): string {
  return cleanDigits(cnpj)
}

export function validateNFeKey(chave: string): { valid: boolean; reason?: string } {
  if (!/^\d{44}$/.test(chave)) {
    return { valid: false, reason: 'A chave deve conter exatamente 44 dígitos.' }
  }

  const model = chave.slice(20, 22)
  if (model !== '55') {
    return { valid: false, reason: `Modelo ${model}. Esta versão está configurada para NF-e modelo 55.` }
  }

  const body = chave.slice(0, 43)
  const expected = modulo11(body)
  const actual = Number(chave[43])

  if (expected !== actual) {
    return { valid: false, reason: `Dígito verificador inválido. Esperado ${expected}, recebido ${actual}.` }
  }

  return { valid: true }
}

function modulo11(body: string): number {
  let weight = 2
  let sum = 0

  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }

  const remainder = sum % 11
  return remainder === 0 || remainder === 1 ? 0 : 11 - remainder
}

export function parseNFe(raw: string): ParsedNFe | null {
  const chave = extractAccessKey(raw)
  if (!chave) return null

  const validation = validateNFeKey(chave)
  if (!validation.valid) return null

  const cnpj = chave.slice(6, 20)
  const numero = chave.slice(25, 34).replace(/^0+/, '') || '0'

  return {
    numeroNF: numero,
    cnpjEmitente: formatCnpj(cnpj),
    chaveAcesso: chave,
  }
}

export function explainNFeError(raw: string): string {
  const chave = extractAccessKey(raw)
  if (!chave) return 'Não foi encontrada uma chave de NF-e com 44 dígitos.'
  const validation = validateNFeKey(chave)
  return validation.valid ? 'Chave válida.' : validation.reason ?? 'Chave inválida.'
}
