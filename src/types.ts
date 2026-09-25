export type NotaStatus = 'Pendente' | 'Conferida' | 'Finalizada'

export type NotaFiscal = {
  id: string
  numeroNF: string
  cnpjEmitente: string
  fornecedor: string
  valor: number | null
  chaveAcesso: string
  dataCadastro: string
  dataControladoria: string | null
  status: NotaStatus
}

export type ParsedNFe = {
  numeroNF: string
  cnpjEmitente: string
  chaveAcesso: string
}
