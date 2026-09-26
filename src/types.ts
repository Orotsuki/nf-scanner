export type NotaFiscal = {
  id: string
  numeroNF: string
  cnpjEmitente: string
  fornecedor: string
  valor: number | null
  chaveAcesso: string
  dataCadastro: string
  dataEnvio: string | null
  syncPending?: boolean
}

export type ParsedNFe = {
  numeroNF: string
  cnpjEmitente: string
  chaveAcesso: string
}
