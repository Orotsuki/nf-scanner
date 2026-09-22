export type NotaFiscal = {
  id: string
  numeroNF: string
  cnpjEmitente: string
  chaveAcesso: string
  dataLeitura: string
}

export type ParsedNFe = {
  numeroNF: string
  cnpjEmitente: string
  chaveAcesso: string
}
