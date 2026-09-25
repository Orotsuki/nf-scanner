# NF Scanner — PWA

Leitor de NF-e e NFS-e para Android e desktop. A aplicação lê código de barras/QR Code pela câmera, extrai o número do documento, CNPJ/documento do emitente e chave de acesso, permite completar fornecedor e valor e exporta para `.xlsx`.

## Funcionalidades atuais

- Leitura de QR Code e Code 128 pela câmera.
- Suporte a NF-e de 44 dígitos e NFS-e de 50 posições.
- Entrada manual da chave de acesso.
- Validação da chave e dígito verificador.
- CNPJ/documento armazenado somente com números.
- Cadastro automático de fornecedor por CNPJ/documento.
- Valor da NF preenchido manualmente.
- Sincronização da base entre celular e computador por conta de usuário.
- Armazenamento local como cache/fallback.
- Exportação XLSX.
- PWA instalável.
- Interface responsiva.

## Sincronização entre celular e PC

A sincronização usa Supabase Auth + Postgres + Row Level Security. O mesmo usuário pode entrar no celular e no PC e visualizar a mesma base. Dados de um usuário não ficam disponíveis para outro.

O projeto inclui:

- `supabase/schema.sql`: criação das tabelas e políticas de segurança.
- `public/config.js`: configuração pública do projeto Supabase.
- `src/cloud.ts`: autenticação, leitura/escrita e sincronização.
- `src/supabase.ts`: inicialização do cliente Supabase.

### Configuração do Supabase

1. Crie um projeto no Supabase.
2. No SQL Editor, execute `supabase/schema.sql`.
3. No painel de Authentication, habilite acesso por e-mail e senha.
4. Em Project Settings, copie a URL do projeto e a chave **Publishable**.
5. Preencha `public/config.js`:

~~~js
window.NF_SCANNER_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabasePublishableKey: 'sb_publishable_...',
}
~~~

Não coloque a chave `secret`/`service_role` no navegador.

Depois de criar o primeiro usuário, o mesmo e-mail e senha podem ser usados no celular e no PC.

## Fornecedores

Quando uma NF é lida, o sistema procura o CNPJ/documento na tabela de fornecedores.

- Se já existir, o fornecedor é preenchido automaticamente.
- Se não existir, a célula fica marcada para cadastro manual.
- Ao cadastrar o nome uma vez, a associação fica salva para as próximas NFs.

## Valor

O valor permanece manual nesta versão. Ele pode ser preenchido diretamente na tabela e também é exportado para o XLSX.

## Executar localmente

~~~bash
npm install
npm run dev
~~~

Abra a URL exibida pelo Vite. Para testar a câmera no celular durante desenvolvimento, use HTTPS ou um túnel HTTPS.

## Build de produção

~~~bash
npm run build
npm run preview
~~~

A pasta `dist` pode ser publicada em qualquer hospedagem estática que ofereça HTTPS.

## Teste rápido

Na tela inicial existe o botão **Testar com exemplo**, usando a chave:

`31260922545180000120550010001176811053342306`

A aplicação deve adicionar a NF 117681 e o CNPJ `22545180000120`.

## Estrutura

~~~text
src/
  App.tsx
  Scanner.tsx
  nfe.ts
  exportExcel.ts
  storage.ts
  cloud.ts
  supabase.ts
  types.ts
public/
  config.js
  sw.js
  icons/
supabase/
  schema.sql
~~~
