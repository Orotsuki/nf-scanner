const DRIVE_FOLDER_NAME = 'NF Scanner Backups'
const KEEP_DAYS = 30
const SUPABASE_URL_PROPERTY = 'SUPABASE_URL'
const SUPABASE_SECRET_KEY_PROPERTY = 'SUPABASE_SECRET_KEY'

function backupNow() {
  const config = getConfig()
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || 'America/Sao_Paulo',
    'yyyy-MM-dd_HH-mm-ss'
  )

  const folder = getOrCreateFolder(DRIVE_FOLDER_NAME)
  const data = {
    exported_at: new Date().toISOString(),
    source: 'nf-scanner',
    notas_fiscais: fetchAllRows(config.supabaseUrl, config.serviceRoleKey, 'notas_fiscais'),
    fornecedores: fetchAllRows(config.supabaseUrl, config.serviceRoleKey, 'fornecedores'),
  }

  folder.createFile(
    `NF_Scanner_Dados_${timestamp}.json`,
    JSON.stringify(data, null, 2),
    MimeType.PLAIN_TEXT
  )

  const githubZip = UrlFetchApp.fetch(
    'https://api.github.com/repos/Orotsuki/nf-scanner/zipball/main',
    {
      headers: { Accept: 'application/vnd.github+json' },
      muteHttpExceptions: true,
    }
  )

  if (githubZip.getResponseCode() >= 200 && githubZip.getResponseCode() < 300) {
    const zipBlob = githubZip.getBlob().setName(`NF_Scanner_Sistema_${timestamp}.zip`)
    folder.createFile(zipBlob)
  } else {
    console.log(
      `Não foi possível criar o backup do sistema. HTTP ${githubZip.getResponseCode()}`
    )
  }

  removeOldBackups(folder)

  console.log(`Backup concluído: ${timestamp}`)
}

function createDailyBackupTrigger() {
  const handler = 'backupNow'

  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === handler)
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger))

  ScriptApp.newTrigger(handler)
    .timeBased()
    .atHour(23)
    .everyDays(1)
    .create()

  console.log('Backup diário configurado para a faixa das 23h.')
}

function removeDailyBackupTriggers() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'backupNow')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger))
}

function getConfig() {
  const properties = PropertiesService.getScriptProperties()
  const supabaseUrl = properties.getProperty(SUPABASE_URL_PROPERTY)
  const serviceRoleKey = properties.getProperty(SUPABASE_SECRET_KEY_PROPERTY)

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Configure SUPABASE_URL e SUPABASE_SECRET_KEY nas propriedades do script.'
    )
  }

  return { supabaseUrl, serviceRoleKey }
}

function fetchAllRows(supabaseUrl, serviceRoleKey, table) {
  const rows = []
  const pageSize = 1000
  let offset = 0

  while (true) {
    const response = UrlFetchApp.fetch(
      `${supabaseUrl}/rest/v1/${table}?select=*&limit=${pageSize}&offset=${offset}`,
      {
        method: 'get',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        muteHttpExceptions: true,
      }
    )

    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      throw new Error(
        `Falha ao consultar ${table}: HTTP ${response.getResponseCode()} - ${response.getContentText()}`
      )
    }

    const page = JSON.parse(response.getContentText())
    rows.push(...page)

    if (page.length < pageSize) break
    offset += pageSize
  }

  return rows
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