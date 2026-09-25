import type { ParsedNFe } from './types'

export function cleanDigits(value: string): string {
  return value.replace(/\D/g, '')
}

export function extractAccessKey(raw: string): string | null {
  const decoded = decodeURIComponentSafely(raw).toUpperCase()

  // NFS-e padrão nacional: 50 posições.
  const nfseMatch = decoded.match(/[0-9]{9}[0-9A-Z]{14}[0-9]{27}/)
  if (nfseMatch?.[0]) return nfseMatch[0]

  // NF-e/NFC-e: 44 dígitos.
  const nfeMatch = decoded.match(/\d{44}/)
  return nfeMatch?.[0] ?? (cleanDigits(decoded).length === 44 ? cleanDigits(decoded) : null)
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
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

function validateNFSeKey(chave: string): { valid: boolean; reason?: string } {
  if (!/^[0-9A-Z]{50}$/.test(chave)) {
    return { valid: false, reason: 'A chave da NFS-e deve conter 50 posições.' }
  }

  if (!/^\d{9}[0-9A-Z]{14}\d{27}$/.test(chave)) {
    return { valid: false, reason: 'Formato da chave da NFS-e inválido.' }
  }

  const body = chave.slice(0, 49)
  const expected = modulo11(body)
  const actual = Number(chave[49])

  if (expected !== actual) {
    return { valid: false, reason: `Dígito verificador da NFS-e inválido. Esperado ${expected}, recebido ${actual}.` }
  }

  return { valid: true }
}

function modulo11(body: string): number {
  let weight = 2
  let sum = 0

  for (let i = body.length - 1; i >= 0; i -= 1) {
    const value = Number(body[i])
    if (Number.isNaN(value)) return -1
    sum += value * weight
    weight = weight === 9 ? 2 : weight + 1
  }

  const remainder = sum % 11
  return remainder === 0 || remainder === 1 ? 0 : 11 - remainder
}

export function parseNFe(raw: string): ParsedNFe | null {
  const chave = extractAccessKey(raw)
  if (!chave) return null

  if (chave.length === 50) {
    const validation = validateNFSeKey(chave)
    if (!validation.valid) return null

    const tipoInscricao = chave[8]
    const inscricao = cleanDigits(chave.slice(9, 23))
    const numero = chave.slice(23, 36).replace(/^0+/, '') || '0'

    return {
      numeroNF: numero,
      cnpjEmitente: tipoInscricao === '1' ? inscricao.slice(-11) : inscricao,
      chaveAcesso: chave,
    }
  }

  const validation = validateNFeKey(chave)
  if (!validation.valid) return null

  const cnpj = cleanDigits(chave.slice(6, 20))
  const numero = chave.slice(25, 34).replace(/^0+/, '') || '0'

  return {
    numeroNF: numero,
    cnpjEmitente: cnpj,
    chaveAcesso: chave,
  }
}

export function explainNFeError(raw: string): string {
  const chave = extractAccessKey(raw)
  if (!chave) return 'Não foi encontrada uma chave de NF-e (44 dígitos) ou NFS-e (50 posições).'

  const validation = chave.length === 50
    ? validateNFSeKey(chave)
    : validateNFeKey(chave)

  return validation.valid ? 'Chave válida.' : validation.reason ?? 'Chave inválida.'
}
