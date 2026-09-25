import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import Scanner from './Scanner'
import { explainNFeError, parseNFe } from './nfe'
import { exportToXlsx } from './exportExcel'
import { loadNotes, saveNotes } from './storage'
import type { NotaFiscal } from './types'
import {
  deleteAllCloudNotes,
  deleteCloudNote,
  fetchCloudNotes,
  fetchSuppliers,
  findSupplierByCnpj,
  getSession,
  mergeLocalNotesIntoCloud,
  signOut,
  subscribeToAuthChanges,
  subscribeToCloudChanges,
  updateCloudNote,
  upsertCloudNote,
  upsertSupplier,
} from './cloud'
import { isSupabaseConfigured } from './supabase'
import { signInUsername, signUpUsername } from './auth'

const SAMPLE_KEY = '31260922545180000120550010001176811053342306'

type SyncStatus = 'local' | 'connecting' | 'online' | 'offline'

export default function App() {
  const [notes, setNotes] = useState<NotaFiscal[]>(() => loadNotes())
  const [scannerOpen, setScannerOpen] = useState(true)
  const [scanTrigger, setScanTrigger] = useState(0)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualValue, setManualValue] = useState('')
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSupabaseConfigured ? 'connecting' : 'local')
  const [supplierMap, setSupplierMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false)
      return
    }

    let active = true

    void getSession()
      .then((currentSession) => {
        if (active) setSession(currentSession)
      })
      .catch(() => {
        if (active) setSession(null)
      })
      .finally(() => {
        if (active) setAuthLoading(false)
      })

    const unsubscribe = subscribeToAuthChanges((nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        setNotes(loadNotes())
        setSupplierMap({})
        setSyncStatus('local')
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session || !isSupabaseConfigured) return

    let cancelled = false
    let unsubscribe: () => void = () => undefined

    const refreshFromCloud = async () => {
      try {
        const [cloudNotes, suppliers] = await Promise.all([
          fetchCloudNotes(),
          fetchSuppliers(),
        ])

        if (cancelled) return

        setNotes(cloudNotes)
        setSupplierMap(toSupplierMap(suppliers))
        setSyncStatus('online')
      } catch {
        if (!cancelled) setSyncStatus('offline')
      }
    }

    const hydrate = async () => {
      setSyncStatus('connecting')

      try {
        await mergeLocalNotesIntoCloud(loadNotes())

        if (cancelled) return

        await refreshFromCloud()

        if (cancelled) return

        unsubscribe = subscribeToCloudChanges(session.user.id, () => {
          void refreshFromCloud()
        })
      } catch {
        if (!cancelled) {
          setSyncStatus('offline')
          setToast({
            type: 'warning',
            text: 'Não foi possível sincronizar agora. Os registros continuam neste aparelho.',
          })
        }
      }
    }

    void hydrate()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [session?.user.id])

  useEffect(() => {
    saveNotes(notes)
  }, [notes])

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const addNoteFromRaw = useCallback(async (raw: string) => {
    const parsed = parseNFe(raw)

    if (!parsed) {
      setToast({ type: 'error', text: explainNFeError(raw) })
      return
    }

    if (notes.some((note) => note.chaveAcesso === parsed.chaveAcesso)) {
      setToast({ type: 'warning', text: `NF ${parsed.numeroNF} já foi lida.` })
      return
    }

    let fornecedor = supplierMap[parsed.cnpjEmitente] ?? ''

    if (!fornecedor && session && isSupabaseConfigured) {
      try {
        const knownSupplier = await findSupplierByCnpj(parsed.cnpjEmitente)
        if (knownSupplier) {
          fornecedor = knownSupplier.nome
          setSupplierMap((current) => ({
            ...current,
            [parsed.cnpjEmitente]: knownSupplier.nome,
          }))
        }
      } catch {
        // A consulta de fornecedor é opcional; a leitura continua normalmente.
      }
    }

    const note: NotaFiscal = {
      ...parsed,
      id: crypto.randomUUID(),
      fornecedor,
      valor: null,
      dataLeitura: new Date().toISOString(),
    }

    setNotes((current) => [note, ...current])

    if (session && isSupabaseConfigured) {
      try {
        await upsertCloudNote(note)
        setSyncStatus('online')
      } catch {
        setSyncStatus('offline')
        setToast({
          type: 'warning',
          text: `NF ${parsed.numeroNF} salva neste aparelho, mas não foi sincronizada ainda.`,
        })
      }
    }

    if (fornecedor) {
      setToast({ type: 'success', text: `NF ${parsed.numeroNF} adicionada.` })
    } else {
      setToast({ type: 'success', text: `NF ${parsed.numeroNF} adicionada. Cadastre o fornecedor nesta linha.` })
    }

    setManualValue('')
    setManualOpen(false)

    if ('vibrate' in navigator) navigator.vibrate?.(70)
    playBeep()
  }, [notes, session, supplierMap])

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase()

    if (!q) return notes

    return notes.filter((note) =>
      note.numeroNF.toLowerCase().includes(q) ||
      note.cnpjEmitente.toLowerCase().includes(q) ||
      note.fornecedor.toLowerCase().includes(q) ||
      String(note.valor ?? '').includes(q) ||
      note.chaveAcesso.includes(q),
    )
  }, [notes, search])

  async function persistNote(note: NotaFiscal): Promise<void> {
    setNotes((current) => current.map((item) => item.id === note.id ? note : item))

    if (!session || !isSupabaseConfigured) return

    try {
      if (note.fornecedor.trim()) {
        await upsertSupplier(note.cnpjEmitente, note.fornecedor)
        setSupplierMap((current) => ({
          ...current,
          [note.cnpjEmitente]: note.fornecedor.trim(),
        }))
      }

      await updateCloudNote(note)
      setSyncStatus('online')
    } catch {
      setSyncStatus('offline')
      setToast({
        type: 'warning',
        text: 'A alteração ficou salva neste aparelho, mas não foi sincronizada.',
      })
    }
  }

  async function removeNote(id: string) {
    const note = notes.find((item) => item.id === id)
    if (!note) return

    if (session && isSupabaseConfigured) {
      try {
        await deleteCloudNote(id)
      } catch {
        setSyncStatus('offline')
        setToast({ type: 'error', text: 'Não foi possível excluir a nota da nuvem.' })
        return
      }
    }

    setNotes((current) => current.filter((item) => item.id !== id))
  }

  async function clearNotes() {
    if (!notes.length) return

    if (!window.confirm('Excluir todas as notas armazenadas?')) return

    if (session && isSupabaseConfigured) {
      try {
        await deleteAllCloudNotes()
      } catch {
        setSyncStatus('offline')
        setToast({ type: 'error', text: 'Não foi possível limpar as notas da nuvem.' })
        return
      }
    }

    setNotes([])
    setToast({ type: 'success', text: 'Lista limpa.' })
  }

  async function handleSignOut() {
    try {
      if (session && isSupabaseConfigured) {
        await signOut()
      }
    } catch {
      setToast({ type: 'error', text: 'Não foi possível sair agora.' })
    }
  }

  function requestScan() {
    setScannerOpen(true)
    setScanTrigger((value) => value + 1)
  }

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  if (isSupabaseConfigured && authLoading) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand-mark large">NF</div>
          <h1>NF Scanner</h1>
          <p>Verificando acesso…</p>
        </div>
      </div>
    )
  }

  if (isSupabaseConfigured && !session) {
    return <AuthScreen />
  }

  const syncLabel = {
    local: 'Somente neste aparelho',
    connecting: 'Sincronizando…',
    online: 'Sincronizado',
    offline: 'Sem conexão com a nuvem',
  }[syncStatus]

  const username = String(session?.user.user_metadata?.username ?? 'usuário')
  const summaryFoot = session
    ? `Usuário: ${username} • ${syncLabel}`
    : 'A nuvem ainda não foi configurada neste projeto.'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">NF</div>
          <div>
            <div className="brand-title">NF Scanner</div>
            <div className="brand-subtitle">Leitura rápida de NF-e</div>
          </div>
        </div>
        <div className="top-actions">
          {installPrompt && (
            <button className="btn ghost" onClick={installApp}>Instalar</button>
          )}
          {session && (
            <div className={`sync-badge ${syncStatus}`} title={session.user.email ?? undefined}>
              <span className="sync-dot" />
              <span>{syncLabel}</span>
            </div>
          )}
          {session && (
            <button className="icon-btn" onClick={() => void handleSignOut()} aria-label="Sair">↪</button>
          )}
          <button className="icon-btn" onClick={() => setManualOpen((value) => !value)} aria-label="Abrir digitação manual">⌨</button>
        </div>
      </header>

      <main className="content">
        <section className="hero-grid">
          <div className="scanner-panel">
            <div className="section-heading">
              <div>
                <h1>Escanear NF-e</h1>
                <p>Use a câmera para ler o código de barras ou QR Code.</p>
              </div>
              <button className="btn secondary" onClick={() => setScannerOpen((value) => !value)}>
                {scannerOpen ? 'Fechar câmera' : 'Abrir câmera'}
              </button>
            </div>

            {scannerOpen && (
              <Scanner
                enabled={scannerOpen}
                onDetected={addNoteFromRaw}
                scanTrigger={scanTrigger}
              />
            )}

            <div className="scan-actions">
              <button className="btn primary" onClick={requestScan}>Ler código</button>
              <button className="btn secondary" onClick={() => setManualOpen(true)}>Digitar chave</button>
              <button className="btn ghost" onClick={() => void addNoteFromRaw(SAMPLE_KEY)}>Testar com exemplo</button>
            </div>

            {manualOpen && (
              <div className="manual-box">
                <label htmlFor="manual-key">Chave de acesso</label>
                <div className="manual-row">
                  <input
                    id="manual-key"
                    inputMode="numeric"
                    autoComplete="off"
                    value={manualValue}
                    maxLength={54}
                    onChange={(event) => setManualValue(event.target.value)}
                    placeholder="Digite ou cole a chave de 44 dígitos ou 50 posições"
                  />
                  <button className="btn primary" onClick={() => void addNoteFromRaw(manualValue)}>Adicionar</button>
                </div>
                <div className="field-help">Também aceita chave com espaços ou formatação.</div>
              </div>
            )}
          </div>

          <aside className="summary-card">
            <div className="summary-label">Documentos armazenados</div>
            <div className="summary-number">{notes.length}</div>
            <div className="summary-foot">{summaryFoot}</div>
            <div className="summary-actions">
              <button className="btn primary full" disabled={!notes.length} onClick={() => exportToXlsx(notes)}>Exportar XLSX</button>
              <button className="btn ghost full" disabled={!notes.length} onClick={() => void clearNotes()}>Limpar tudo</button>
            </div>
          </aside>
        </section>

        <section className="list-panel">
          <div className="section-heading compact">
            <div>
              <h2>Notas lidas</h2>
              <p>{filteredNotes.length} de {notes.length} registros</p>
            </div>
            <div className="search-wrap">
              <span>⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar NF, CNPJ, fornecedor ou chave" />
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Número da NF</th>
                  <th>CNPJ do emitente</th>
                  <th>Fornecedor</th>
                  <th>Valor</th>
                  <th>Chave de acesso</th>
                  <th>Leitura</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {filteredNotes.map((note) => (
                  <EditableNoteRow
                    key={note.id}
                    note={note}
                    onSave={persistNote}
                    onDelete={removeNote}
                  />
                ))}
                {!filteredNotes.length && (
                  <tr>
                    <td colSpan={7} className="empty-row">
                      {notes.length ? 'Nenhum registro encontrado para a pesquisa.' : 'Nenhuma NF foi lida ainda.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}
    </div>
  )
}

function EditableNoteRow({
  note,
  onSave,
  onDelete,
}: {
  note: NotaFiscal
  onSave: (note: NotaFiscal) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [fornecedor, setFornecedor] = useState(note.fornecedor)
  const [valor, setValor] = useState(note.valor == null ? '' : formatMoney(note.valor))

  useEffect(() => {
    setFornecedor(note.fornecedor)
  }, [note.fornecedor])

  useEffect(() => {
    setValor(note.valor == null ? '' : formatMoney(note.valor))
  }, [note.valor])

  return (
    <tr>
      <td><strong>{note.numeroNF}</strong></td>
      <td>{note.cnpjEmitente}</td>
      <td>
        <input
          className={`editable-cell-input ${fornecedor ? '' : 'pending'}`}
          value={fornecedor}
          placeholder="Cadastrar fornecedor"
          aria-label={`Fornecedor da NF ${note.numeroNF}`}
          onChange={(event) => setFornecedor(event.target.value)}
          onBlur={() => {
            const trimmed = fornecedor.trim()
            if (trimmed !== note.fornecedor) {
              void onSave({ ...note, fornecedor: trimmed })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      </td>
      <td>
        <input
          className="editable-cell-input amount-input"
          inputMode="decimal"
          value={valor}
          placeholder="0,00"
          aria-label={`Valor da NF ${note.numeroNF}`}
          onChange={(event) => setValor(event.target.value)}
          onBlur={() => {
            const parsedValue = parseMoney(valor)
            if (parsedValue !== note.valor) {
              void onSave({ ...note, valor: parsedValue })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      </td>
      <td><code>{note.chaveAcesso}</code></td>
      <td>{formatDate(note.dataLeitura)}</td>
      <td className="action-cell">
        <button className="delete-btn" onClick={() => void onDelete(note.id)} aria-label={`Excluir NF ${note.numeroNF}`}>×</button>
      </td>
    </tr>
  )
}

function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [registrationCode, setRegistrationCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  async function submit() {
    const normalizedUsername = username.trim().toLowerCase()

    if (!/^[\p{L}\p{N}._-]{3,30}$/u.test(normalizedUsername)) {
      setMessage({
        type: 'error',
        text: 'O usuário deve ter de 3 a 30 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.',
      })
      return
    }

    if (password.length < 6 || password.length > 72) {
      setMessage({
        type: 'error',
        text: 'A senha deve ter entre 6 e 72 caracteres.',
      })
      return
    }

    setBusy(true)
    setMessage(null)

    try {
      if (mode === 'login') {
        await signInUsername(normalizedUsername, password)
      } else {
        await signUpUsername(normalizedUsername, password, registrationCode)
      }
    } catch (cause: unknown) {
      setMessage({
        type: 'error',
        text: getAuthErrorMessage(cause),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand-mark large">NF</div>
        <h1>NF Scanner</h1>
        <p className="auth-subtitle">Entre para usar a mesma base no celular e no computador.</p>

        <div className="auth-form">
          <label htmlFor="auth-username">Usuário</label>
          <input
            id="auth-username"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Ex.: almoxarifado"
          />

          {mode === 'signup' && (
            <>
              <label htmlFor="auth-registration-code">Código de cadastro</label>
              <input
                id="auth-registration-code"
                type="password"
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                value={registrationCode}
                onChange={(event) => setRegistrationCode(event.target.value)}
                placeholder="Código fornecido pelo administrador"
              />
            </>
          )}

          <label htmlFor="auth-password">Senha</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Mínimo de 6 caracteres"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />

          {message && <div className={`auth-message ${message.type}`}>{message.text}</div>}

          <button className="btn primary full" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar usuário'}
          </button>

          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setMode((current) => current === 'login' ? 'signup' : 'login')
              setMessage(null)
            }}
          >
            {mode === 'login' ? 'Primeiro acesso? Criar usuário' : 'Já tenho usuário. Entrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function toSupplierMap(suppliers: Array<{ cnpj: string; nome: string }>): Record<string, string> {
  return suppliers.reduce<Record<string, string>>((map, supplier) => {
    map[supplier.cnpj.replace(/\D/g, '')] = supplier.nome
    return map
  }, {})
}

function formatMoney(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function parseMoney(value: string): number | null {
  const text = value.trim().replace(/\s/g, '')
  if (!text) return null

  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text

  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function getAuthErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.toLowerCase() : ''

  if (message.includes('invalid login credentials')) {
    return 'Usuário ou senha incorretos.'
  }

  if (message.includes('already exists') || message.includes('already registered')) {
    return 'Este usuário já existe. Entre com ele.'
  }

  if (message.includes('user not found')) {
    return 'Usuário ou senha incorretos.'
  }

  return cause instanceof Error ? cause.message : 'Não foi possível concluir o acesso.'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function playBeep() {
  try {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 950
    gain.gain.value = 0.04
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.07)
    oscillator.addEventListener('ended', () => context.close().catch(() => undefined))
  } catch {
    // Audio feedback is optional.
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  }
}
