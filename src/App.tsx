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
import { signInUsername } from './auth'
import {
  createManagedUser,
  deleteManagedUser,
  fetchManagedUsers,
  resetManagedUserPassword,
  type ManagedUser,
} from './adminUsers'

type SyncStatus = 'local' | 'connecting' | 'online' | 'offline'

function isDesktopDevice(): boolean {
  if (typeof window === 'undefined') return false

  return (
    window.matchMedia('(min-width: 981px)').matches &&
    window.matchMedia('(pointer: fine)').matches
  )
}

export default function App() {
  const [notes, setNotes] = useState<NotaFiscal[]>(() => loadNotes())
  const [scannerOpen, setScannerOpen] = useState(() => !isDesktopDevice())
  const [scanTrigger, setScanTrigger] = useState(0)
  const [manualOpen, setManualOpen] = useState(() => isDesktopDevice())
  const [manualValue, setManualValue] = useState('')
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSupabaseConfigured ? 'connecting' : 'local')
  const [supplierMap, setSupplierMap] = useState<Record<string, string>>({})
  const [userManagementOpen, setUserManagementOpen] = useState(false)
  const [topMenuOpen, setTopMenuOpen] = useState(false)

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
  const isAdmin = session?.user.app_metadata?.role === 'admin'
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
            <div className="top-menu-wrap">
              <button
                className="icon-btn menu-trigger"
                onClick={() => setTopMenuOpen((value) => !value)}
                aria-label="Abrir menu"
                aria-expanded={topMenuOpen}
                title="Menu"
              >
                <span />
                <span />
                <span />
              </button>

              {topMenuOpen && (
                <div className="top-menu" role="menu">
                  <div className="top-menu-user">
                    <div className="top-menu-user-info">
                      <strong>{username}</strong>
                      <span>{isAdmin ? 'Administrador' : 'Usuário'}</span>
                    </div>

                    <button
                      className="top-menu-signout"
                      type="button"
                      onClick={() => {
                        setTopMenuOpen(false)
                        void handleSignOut()
                      }}
                    >
                      SAIR
                    </button>
                  </div>

                  {isAdmin && (
                    <button
                      className="top-menu-item"
                      type="button"
                      onClick={() => {
                        setTopMenuOpen(false)
                        setUserManagementOpen(true)
                      }}
                    >
                      <span className="top-menu-icon">⚙</span>
                      <span>
                        <strong>Gestão de usuários</strong>
                        <small>Adicionar, remover e redefinir senhas</small>
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
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
                    <td colSpan={6} className="empty-row">
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

      {userManagementOpen && isAdmin && (
        <UserManagement onClose={() => setUserManagementOpen(false)} currentUserId={session.user.id} />
      )}
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
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function submit() {
    const normalizedUsername = username.trim().toLowerCase()

    if (!/^[\p{L}\p{N}._-]{3,30}$/u.test(normalizedUsername)) {
      setMessage('O usuário deve ter de 3 a 30 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.')
      return
    }

    if (password.length < 6 || password.length > 72) {
      setMessage('A senha deve ter entre 6 e 72 caracteres.')
      return
    }

    setBusy(true)
    setMessage(null)

    try {
      await signInUsername(normalizedUsername, password)
    } catch (cause: unknown) {
      setMessage(getAuthErrorMessage(cause))
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
            placeholder="Ex.: andre.mendonca"
          />

          <label htmlFor="auth-password">Senha</label>
          <input
            id="auth-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Sua senha"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />

          {message && <div className="auth-message error">{message}</div>}

          <button className="btn primary full" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function UserManagement({
  onClose,
  currentUserId,
}: {
  onClose: () => void
  currentUserId: string
}) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [resetOpen, setResetOpen] = useState<string | null>(null)
  const [resetValues, setResetValues] = useState<Record<string, string>>({})

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await fetchManagedUsers())
      setMessage(null)
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível carregar os usuários.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  async function handleCreate() {
    const username = newUsername.trim().toLowerCase()

    if (!/^[\p{L}\p{N}._-]{3,30}$/u.test(username)) {
      setMessage('Informe um usuário válido.')
      return
    }

    if (newPassword.length < 6 || newPassword.length > 72) {
      setMessage('A senha deve ter entre 6 e 72 caracteres.')
      return
    }

    setBusy(true)
    setMessage(null)

    try {
      await createManagedUser(username, newPassword)
      setNewUsername('')
      setNewPassword('')
      setAddUserOpen(false)
      await loadUsers()
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível criar o usuário.')
    } finally {
      setBusy(false)
    }
  }

  async function handleReset(user: ManagedUser) {
    const password = resetValues[user.id] ?? ''

    if (password.length < 6 || password.length > 72) {
      setMessage('A nova senha deve ter entre 6 e 72 caracteres.')
      return
    }

    setBusy(true)
    setMessage(null)

    try {
      await resetManagedUserPassword(user.id, password)
      setResetValues((current) => ({ ...current, [user.id]: '' }))
      setResetOpen(null)
      setMessage(`Senha de ${user.username} redefinida.`)
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível redefinir a senha.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(user: ManagedUser) {
    if (user.id === currentUserId) return

    if (!window.confirm(`Remover o usuário "${user.username}"?`)) return

    setBusy(true)
    setMessage(null)

    try {
      await deleteManagedUser(user.id)
      await loadUsers()
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível remover o usuário.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="user-management">
        <div className="user-management-header">
          <div>
            <h2>Gestão de usuários</h2>
            <p>Adicionar, remover e redefinir senhas.</p>
          </div>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Fechar">×</button>
        </div>

        <button
          className="btn primary add-user-toggle"
          type="button"
          onClick={() => {
            setAddUserOpen((value) => !value)
            setMessage(null)
          }}
        >
          {addUserOpen ? 'Fechar cadastro' : 'Adicionar usuário'}
        </button>

        {addUserOpen && (
          <div className="user-create-box">
            <div className="user-create-grid">
              <input
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
                placeholder="Usuário"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
              />
              <input
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                type="password"
                placeholder="Senha inicial"
                autoComplete="new-password"
              />
              <button className="btn primary" disabled={busy} onClick={() => void handleCreate()}>
                Adicionar
              </button>
            </div>
          </div>
        )}

        {message && <div className="auth-message error">{message}</div>}

        <div className="user-list-title">Lista de usuários:</div>

        <div className="user-list">
          {loading ? (
            <div className="user-empty">Carregando usuários…</div>
          ) : users.map((user) => (
            <div className="user-row" key={user.id}>
              <div className="user-main">
                <div className="user-name">{user.username}</div>
                <div className="user-meta">
                  {user.role === 'admin' ? 'Administrador' : 'Usuário'}
                  {' • '}
                  Criado em {formatDate(user.created_at)}
                </div>
              </div>

              <div className="user-actions">
                {resetOpen === user.id ? (
                  <div className="user-reset">
                    <input
                      type="password"
                      value={resetValues[user.id] ?? ''}
                      onChange={(event) => setResetValues((current) => ({
                        ...current,
                        [user.id]: event.target.value,
                      }))}
                      placeholder="Nova senha"
                      autoComplete="new-password"
                    />
                    <button
                      className="btn secondary"
                      disabled={busy || !(resetValues[user.id] ?? '')}
                      onClick={() => void handleReset(user)}
                    >
                      Salvar
                    </button>
                    <button
                      className="btn ghost"
                      disabled={busy}
                      onClick={() => {
                        setResetOpen(null)
                        setResetValues((current) => ({ ...current, [user.id]: '' }))
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => {
                      setResetOpen(user.id)
                      setMessage(null)
                    }}
                  >
                    Redefinir senha
                  </button>
                )}

                <button
                  className="btn danger"
                  disabled={busy || user.id === currentUserId || user.role === 'admin'}
                  onClick={() => void handleDelete(user)}
                >
                  Remover
                </button>
              </div>
            </div>
          ))}

          {!loading && !users.length && (
            <div className="user-empty">Nenhum usuário encontrado.</div>
          )}
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
