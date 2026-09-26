# Backup gratuito no Google Drive

O NF Scanner pode usar o Google Apps Script como uma pequena ponte para gravar o backup no Google Drive sem depender do conector do ChatGPT.

## Como funciona

1. Criar um projeto em Google Apps Script.
2. Colar o conteúdo de `Code.gs`.
3. Alterar o valor de `BACKUP_TOKEN` na função `setBackupToken()` para um token forte.
4. Executar `setBackupToken()` uma vez e autorizar o acesso ao Drive.
5. Fazer **Implantar > Nova implantação > App da Web**.
6. Configurar para executar como a sua conta e fornecer acesso conforme a configuração escolhida.
7. O projeto retornará uma URL `/exec`.

O sistema será configurado depois para enviar o backup para essa URL.

O script cria a pasta **NF Scanner Backups**, grava um JSON por backup e remove arquivos com mais de 30 dias.

O Google oferece 15 GB de armazenamento gratuito por conta Google, compartilhados entre Drive, Gmail e Google Fotos. O Apps Script possui quotas diárias, mas o volume esperado do NF Scanner é muito pequeno para esse tipo de rotina.