# NF Scanner — PWA

Leitor de NF-e para Android e desktop. A aplicação lê código de barras/QR Code pela câmera, extrai o número da NF, CNPJ do emitente e chave de acesso, salva os registros no dispositivo e exporta para `.xlsx`.

## Funcionalidades da v0.1

- Leitura de QR Code e Code 128 pela câmera.
- Modo de leitura contínua para operação em lote.
- Entrada manual da chave de acesso.
- Validação de 44 dígitos, modelo 55 e dígito verificador.
- Bloqueio de duplicidade pela chave.
- Busca por NF, CNPJ ou chave.
- Exclusão individual e limpeza de lote.
- Armazenamento local no navegador.
- Exportação XLSX.
- PWA instalável.
- Interface responsiva para celular e computador.

## Requisitos

Node.js 22+ é recomendado para o ambiente atual do projeto.

## Executar localmente

```bash
npm install
npm run dev
```

Abra a URL exibida pelo Vite. Para testar a câmera no celular durante desenvolvimento, use um endereço HTTPS ou um túnel HTTPS; o acesso à câmera não funciona em uma página `file://` comum.

## Build de produção

```bash
npm run build
npm run preview
```

A pasta `dist` pode ser publicada em qualquer hospedagem estática que ofereça HTTPS.

## Teste rápido

Na tela inicial existe o botão **Testar com exemplo**, usando a chave:

`31260922545180000120550010001176811053342306`

A aplicação deve adicionar a NF 117681 e o CNPJ 22.545.180/0001-20.

## Observação sobre XLSX

A dependência do SheetJS é referenciada diretamente no pacote oficial 0.20.3 via URL de tarball. A documentação oficial do SheetJS mostra o uso do `writeFile` para geração client-side de XLSX e a instalação local via o tarball oficial.

## Estrutura

```text
src/
  App.tsx           interface e regras de operação
  Scanner.tsx       câmera + ZXing
  nfe.ts            extração/validação da chave
  exportExcel.ts    geração de XLSX
  storage.ts        persistência local
  types.ts          modelos
public/
  sw.js             service worker
  icons/            ícones PWA
```
