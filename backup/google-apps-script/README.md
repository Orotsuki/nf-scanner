# Backup diário do NF Scanner no Google Drive

Este script roda na sua conta Google e salva dois arquivos por execução:

- um JSON com notas fiscais e fornecedores do Supabase;
- um ZIP com o estado do repositório GitHub (sistema).

Ele usa um trigger de tempo do Google Apps Script para executar diariamente na faixa das 23h e mantém os últimos 30 dias de backups.

## Configuração

1. Acesse `script.google.com` com a mesma conta Google que deve receber os backups.
2. Crie um projeto de **Script**.
3. Abra o arquivo `Code.gs` e substitua o conteúdo pelo arquivo `backup/google-apps-script/Code.gs` deste repositório.
4. No Apps Script, abra **Configurações do projeto > Propriedades do script**.
5. Crie a propriedade `SUPABASE_URL` com o endereço do projeto Supabase.
6. Crie a propriedade `SUPABASE_SECRET_KEY` com a **Secret key** do Supabase.
7. Salve.
8. Em **Configurações do projeto**, confirme o fuso horário `America/Sao_Paulo` / Brasília.
9. No editor, selecione a função `backupNow` e clique em **Executar** uma vez. Autorize o acesso ao Google Drive quando solicitado.
10. Abra o Google Drive e confirme a criação da pasta **NF Scanner Backups** e dos arquivos de backup.
11. Volte ao Apps Script, selecione `createDailyBackupTrigger` e execute uma vez.
12. Em **Acionadores**, confirme o trigger diário de `backupNow`.

## Segurança

A Secret key do Supabase é uma credencial de backend com acesso elevado. Ela deve ficar apenas nas Propriedades do script e nunca no GitHub, no código do NF Scanner ou em mensagens.

## Observação sobre o horário

O trigger `atHour(23).everyDays(1)` executa na faixa das 23h; o Google pode deslocar o minuto exato dentro dessa janela.

## Retenção

O script mantém aproximadamente 30 dias. Backups mais antigos são movidos para a lixeira do Google Drive.