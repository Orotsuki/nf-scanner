const FOLDER_NAME = 'NF Scanner Backups'
const TOKEN_PROPERTY = 'BACKUP_TOKEN'
const KEEP_DAYS = 30

function setBackupToken() {
  PropertiesService.getScriptProperties().setProperty(
    TOKEN_PROPERTY,
    'COLOQUE-AQUI-UM-TOKEN-FORTE-E-NAO-PUBLIQUE'
  )
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}')
    const configuredToken = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY) || ''

    if (!configuredToken || body.token !== configuredToken) {
      return output({ ok: false, error: 'Não autorizado.' }, 401)
    }

    const payload = typeof body.payload === 'string'
      ? body.payload
      : JSON.stringify(body.payload ?? {})

    const folder = getOrCreateFolder(FOLDER_NAME)
    const timestamp = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone() || 'America/Sao_Paulo',
      'yyyy-MM-dd_HH-mm-ss'
    )

    folder.createFile(
      `NF_Scanner_Backup_${timestamp}.json`,
      payload,
      MimeType.PLAIN_TEXT
    )

    removeOldBackups(folder)

    return output({ ok: true, timestamp })
  } catch (error) {
    return output({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

function getOrCreateFolder(name) {
  const folders = DriveApp.getFoldersByName(name)
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name)
}

function removeOldBackups(folder) {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
  const files = folder.getFiles()

  while (files.hasNext()) {
    const file = files.next()
    if (file.getDateCreated().getTime() < cutoff) {
      file.setTrashed(true)
    }
  }
}

function output(body, status) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON)
}
