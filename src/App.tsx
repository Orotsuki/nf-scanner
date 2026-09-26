import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import Scanner from './Scanner'
import { explainNFeError, parseNFe } from './nfe'
import { loadNotes, saveNotes } from './storage'
import type { NotaFiscal }
import {
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
  updateCloudNotesDataEnvio,
  upsertCloudNote,
  upsertSupplier,
  deleteSupplier,
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
  const [manualOpen, setManualOpen] = useState(() => isDesktopDevice())
  const [manualValue, setManualValue] = useState('')
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSupabaseConfigured ? 'connecting' : 'local')
  const [supplierMap, setSupplierMap] = useState<Record<string, string>>({})
  const [supplierRecords, setSupplierRecords] = useState<Array<{ id: string; cnpj: string; nome: string }>>([])
  const [userManagementOpen, setUserManagementOpen] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [supplierManagementOpen, setSupplierManagementOpen] = useState(false)
  const [topMenuOpen, setTopMenuOpen] = useState(false)
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [bulkSendDate, setBulkSendDate] = useState('')
  const [recentNoteId, setRecentNoteId] = useState<string | null>(null)
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem('nf-scanner:dark-mode') === 'true'
    } catch {
      return false
    }
  })

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
        setSupplierRecords([])
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
        setSupplierRecords(suppliers)
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
    try {
      localStorage.setItem('nf-scanner:dark-mode', String(darkMode))
    } catch {
      // Preference persistence is optional.
    }
  }, [darkMode])

  useEffect(() => {
    document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light'
    return () => {
      document.documentElement.style.colorScheme = 'light'
    }
  }, [darkMode])

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
      setToast({ type: 'warning', text: `NF ${parsed.numeroNF} já está cadastrada.` })
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
      dataCadastro: new Date().toISOString(),
      dataEnvio: null,
    }

    setNotes((current) => [note, ...current])
    setRecentNoteId(note.id)
    window.setTimeout(() => {
      setRecentNoteId((current) => current === note.id ? null : current)
    }, 4500)

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

    return notes.filter((note) => {
      if (!q) return true

      return (
        note.numeroNF.toLowerCase().includes(q) ||
        note.cnpjEmitente.toLowerCase().includes(q) ||
        note.fornecedor.toLowerCase().includes(q) ||
        String(note.valor ?? '').includes(q) ||
        note.chaveAcesso.includes(q)
      )
    })
  }, [notes, search])

  const allFilteredSelected =
    filteredNotes.length > 0 &&
    filteredNotes.every((note) => selectedNoteIds.has(note.id))

  function toggleNoteSelection(id: string): void {
    setSelectedNoteIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFiltered(): void {
    setSelectedNoteIds((current) => {
      const next = new Set(current)
      if (allFilteredSelected) {
        filteredNotes.forEach((note) => next.delete(note.id))
      } else {
        filteredNotes.forEach((note) => next.add(note.id))
      }
      return next
    })
  }

  async function applyBulkSendDate(): Promise<void> {
    if (!bulkSendDate || !selectedNoteIds.size) return

    const ids = [...selectedNoteIds]

    try {
      await updateCloudNotesDataEnvio(ids, bulkSendDate)
      setNotes((current) =>
        current.map((note) =>
          selectedNoteIds.has(note.id)
            ? { ...note, dataEnvio: bulkSendDate }
            : note,
        ),
      )
      setSelectedNoteIds(new Set())
      setBulkSendDate('')
      setToast({
        type: 'success',
        text: 'Data de envio aplicada a ' + ids.length + ' NF' + (ids.length === 1 ? '' : 's') + '.',
      })
    } catch {
      setToast({
        type: 'error',
        text: 'Não foi possível aplicar a data de envio.',
      })
    }
  }


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

  async function handleSignOut() {
    try {
      if (session && isSupabaseConfigured) {
        await signOut()
      }
    } catch {
      setToast({ type: 'error', text: 'Não foi possível sair agora.' })
    }
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
  const recentNote = recentNoteId ? notes.find((note) => note.id === recentNoteId) ?? null : null

  async function handleSupplierSave(cnpj: string, nome: string): Promise<void> {
    await upsertSupplier(cnpj, nome)
    setSupplierMap((current) => ({ ...current, [cnpj]: nome }))
    setSupplierRecords((current) => {
      const existing = current.find((item) => item.cnpj === cnpj)
      if (existing) {
        return current.map((item) => item.cnpj === cnpj ? { ...item, nome } : item)
      }

      return [...current, { id: crypto.randomUUID(), cnpj, nome }].sort((a, b) => a.nome.localeCompare(b.nome))
    })
    setToast({ type: 'success', text: 'Fornecedor atualizado.' })
  }

  async function handleSupplierDelete(id: string): Promise<void> {
    const supplier = supplierRecords.find((item) => item.id === id)
    if (!supplier) return

    if (!window.confirm(`Remover o fornecedor "${supplier.nome}" da base?`)) return

    await deleteSupplier(id)
    setSupplierRecords((current) => current.filter((item) => item.id !== id))
    setSupplierMap((current) => {
      const next = { ...current }
      delete next[supplier.cnpj]
      return next
    })
    setToast({ type: 'success', text: 'Fornecedor removido da base.' })
  }

  return (
    <div className={`app-shell ${darkMode ? 'dark-theme' : ''}`}>
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

                  <button
                    className="top-menu-item"
                    type="button"
                    onClick={() => {
                      setTopMenuOpen(false)
                      setDashboardOpen(true)
                    }}
                  >
                    <span className="top-menu-icon">▥</span>
                    <span>
                      <strong>Dashboard</strong>
                      <small>Resumo das notas cadastradas</small>
                    </span>
                  </button>

                  <button
                    className="top-menu-item"
                    type="button"
                    onClick={() => {
                      setTopMenuOpen(false)
                      setSupplierManagementOpen(true)
                    }}
                  >
                    <span className="top-menu-icon">▤</span>
                    <span>
                      <strong>Fornecedores</strong>
                      <small>Consultar e atualizar cadastros</small>
                    </span>
                  </button>

                  <button
                    className="top-menu-item"
                    type="button"
                    onClick={() => setDarkMode((value) => !value)}
                  >
                    <span className="top-menu-icon">{darkMode ? '☀' : '☾'}</span>
                    <span className="top-menu-text">
                      <strong>Modo escuro</strong>
                      <small>{darkMode ? 'Ativado' : 'Desativado'}</small>
                    </span>
                    <span className={`menu-switch ${darkMode ? 'on' : ''}`} aria-hidden="true">
                      <span />
                    </span>
                  </button>
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
              <div className="camera-actions">
                <button
                  className="btn secondary"
                  onClick={() => {
                    const nextOpen = !scannerOpen
                    setScannerOpen(nextOpen)
                    if (nextOpen) setManualOpen(false)
                  }}
                >
                  {scannerOpen ? 'Fechar câmera' : 'Abrir câmera'}
                </button>
                <button
                  className="btn secondary"
                  onClick={() => {
                    setManualOpen(true)
                    setScannerOpen(false)
                  }}
                >
                  Digitar chave de acesso
                </button>
              </div>
            </div>

            {scannerOpen && (
              <Scanner
                enabled={scannerOpen}
                onDetected={addNoteFromRaw}
              />
            )}

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
        </section>

        {recentNote && (
          <div className="recent-note-banner" role="status">
            <div className="recent-note-icon">✓</div>
            <div className="recent-note-content">
              <strong>NF cadastrada com sucesso</strong>
              <span>
                Nº {recentNote.numeroNF} • CNPJ {recentNote.cnpjEmitente}
                {recentNote.fornecedor ? ` • ${recentNote.fornecedor}` : ' • Fornecedor pendente'}
              </span>
            </div>
            <button
              type="button"
              className="recent-note-close"
              onClick={() => setRecentNoteId(null)}
              aria-label="Fechar aviso"
            >
              ×
            </button>
          </div>
        )}

        <section className="list-panel">
          <div className="section-heading compact">
            <div>
              <h2>Notas fiscais cadastradas:</h2>
              <p>{filteredNotes.length} de {notes.length} registros</p>
            </div>
            <div className="search-wrap">
              <span>⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Pesquisar NF, CNPJ, fornecedor ou chave"
              />
            </div>
          </div>

          {selectedNoteIds.size > 0 && (
            <div className="bulk-toolbar">
              <div>
                <strong>{selectedNoteIds.size}</strong> NF{selectedNoteIds.size === 1 ? '' : 's'} selecionada{selectedNoteIds.size === 1 ? '' : 's'}
              </div>
              <div className="bulk-actions">
                <label htmlFor="bulk-send-date">Data de envio</label>
                <input
                  id="bulk-send-date"
                  type="date"
                  value={bulkSendDate}
                  onChange={(event) => setBulkSendDate(event.target.value)}
                />
                <button
                  className="btn primary"
                  disabled={!bulkSendDate}
                  onClick={() => void applyBulkSendDate()}
                >
                  Aplicar data
                </button>
                <button
                  className="btn ghost"
                  onClick={() => setSelectedNoteIds(new Set())}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="check-cell">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAllFiltered}
                      aria-label="Selecionar todas as notas exibidas"
                    />
                  </th>
                  <th>Número da NF</th>
                  <th>CNPJ do emitente</th>
                  <th>Fornecedor</th>
                  <th>Valor</th>
                  <th>Data Cadastro</th>
                  <th>Data Envio</th>
                  <th>Chave de acesso</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {filteredNotes.map((note) => (
                  <EditableNoteRow
                    key={note.id}
                    note={note}
                    recent={recentNoteId === note.id}
                    selected={selectedNoteIds.has(note.id)}
                    onSelect={() => toggleNoteSelection(note.id)}
                    onSave={persistNote}
                    onDelete={removeNote}
                  />
                ))}
                {!filteredNotes.length && (
                  <tr>
                    <td colSpan={9} className="empty-row">
                      {notes.length ? 'Nenhum registro encontrado para a pesquisa.' : 'Nenhuma NF foi cadastrada ainda.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {dashboardOpen && (
        <DashboardModal notes={notes} onClose={() => setDashboardOpen(false)} />
      )}

      {supplierManagementOpen && (
        <SupplierManagement
          suppliers={supplierRecords}
          onSave={handleSupplierSave}
          onDelete={handleSupplierDelete}
          onClose={() => setSupplierManagementOpen(false)}
        />
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}

      {userManagementOpen && isAdmin && (
        <UserManagement onClose={() => setUserManagementOpen(false)} currentUserId={session.user.id} />
      )}
    </div>
  )
}

function DashboardModal({
  notes,
  onClose,
}: {
  notes: NotaFiscal[]
  onClose: () => void
}) {
  const totalValue = notes.reduce((total, note) => total + (typeof note.valor === 'number' ? note.valor : 0), 0)
  const withoutSupplier = notes.filter((note) => !note.fornecedor.trim()).length
  const withoutValue = notes.filter((note) => note.valor == null).length
  const sentToController = notes.filter((note) => note.dataEnvio).length

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="dashboard-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="user-management-header">
          <div>
            <h2>Dashboard</h2>
            <p>Resumo das notas fiscais cadastradas.</p>
          </div>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Fechar">×</button>
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-card">
            <span>Notas cadastradas</span>
            <strong>{notes.length}</strong>
          </div>
          <div className="dashboard-card">
            <span>Sem fornecedor</span>
            <strong>{withoutSupplier}</strong>
          </div>
          <div className="dashboard-card">
            <span>Sem valor</span>
            <strong>{withoutValue}</strong>
          </div>
          <div className="dashboard-card checked">
            <span>Enviadas à controladoria</span>
            <strong>{sentToController}</strong>
          </div>
        </div>

        <div className="dashboard-value">
          <span>Valor total cadastrado</span>
          <strong>{formatMoney(totalValue)}</strong>
        </div>
      </div>
    </div>
  )
}

function SupplierManagement({
  onClose,
  suppliers,
  onSave,
  onDelete,
}: {
  onClose: () => void
  suppliers: Array<{ id: string; cnpj: string; nome: string }>
  onSave: (cnpj: string, nome: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [supplierRows, setSupplierRows] = useState(suppliers)
  const [addOpen, setAddOpen] = useState(false)
  const [newCnpj, setNewCnpj] = useState('')
  const [newName, setNewName] = useState('')
  const [searchSupplier, setSearchSupplier] = useState('')

  useEffect(() => setSupplierRows(suppliers), [suppliers])

  const filtered = supplierRows.filter((supplier) => {
    const q = searchSupplier.trim().toLowerCase()
    if (!q) return true
    return supplier.cnpj.includes(q.replace(/\D/g, '')) || supplier.nome.toLowerCase().includes(q)
  })

  async function saveNew() {
    const cnpj = newCnpj.replace(/\D/g, '')
    if (cnpj.length < 11 || cnpj.length > 14 || !newName.trim()) return

    await onSave(cnpj, newName.trim())

    setSupplierRows((current) => {
      const existing = current.find((item) => item.cnpj === cnpj)
      if (existing) {
        return current.map((item) => item.cnpj === cnpj ? { ...item, nome: newName.trim() } : item)
      }
      return [...current, { id: crypto.randomUUID(), cnpj, nome: newName.trim() }].sort((a, b) => a.nome.localeCompare(b.nome))
    })

    setNewCnpj('')
    setNewName('')
    setAddOpen(false)
  }

  async function removeSupplier(id: string) {
    await onDelete(id)
    setSupplierRows((current) => current.filter((item) => item.id !== id))
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="user-management supplier-management"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="user-management-header">
          <div>
            <h2>Fornecedores</h2>
            <p>Base de fornecedores associada ao CNPJ.</p>
          </div>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Fechar">×</button>
        </div>

        <button className="btn primary add-user-toggle" type="button" onClick={() => setAddOpen((value) => !value)}>
          {addOpen ? 'Fechar cadastro' : 'Adicionar fornecedor'}
        </button>

        {addOpen && (
          <div className="user-create-box">
            <div className="user-create-grid supplier-create-grid">
              <input
                value={newCnpj}
                onChange={(event) => setNewCnpj(event.target.value)}
                inputMode="numeric"
                placeholder="CNPJ somente números"
              />
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Razão social"
              />
              <button className="btn primary" onClick={() => void saveNew()}>
                Salvar
              </button>
            </div>
          </div>
        )}

        <div className="supplier-toolbar">
          <div className="user-list-title">Fornecedores cadastrados:</div>
          <div className="search-wrap supplier-search">
            <span>⌕</span>
            <input value={searchSupplier} onChange={(event) => setSearchSupplier(event.target.value)} placeholder="Pesquisar fornecedor ou CNPJ" />
          </div>
        </div>

        <div className="supplier-list-head">
          <span>CNPJ</span>
          <span>Razão social</span>
          <span>Ação</span>
        </div>

        <div className="supplier-list">
          {filtered.map((supplier) => (
            <SupplierRow
              key={supplier.id}
              supplier={supplier}
              onSave={onSave}
              onDelete={removeSupplier}
            />
          ))}
          {!filtered.length && <div className="user-empty">Nenhum fornecedor encontrado.</div>}
        </div>
      </div>
    </div>
  )
}

function SupplierRow({
  supplier,
  onSave,
  onDelete,
}: {
  supplier: { id: string; cnpj: string; nome: string }
  onSave: (cnpj: string, nome: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [nome, setNome] = useState(supplier.nome)

  useEffect(() => setNome(supplier.nome), [supplier.nome])

  return (
    <div className="supplier-row">
      <code>{supplier.cnpj}</code>
      <input
        className="editable-cell-input"
        value={nome}
        onChange={(event) => setNome(event.target.value)}
        onBlur={() => {
          if (nome.trim() !== supplier.nome) {
            void onSave(supplier.cnpj, nome.trim())
          }
        }}
      />
      <button
        type="button"
        className="btn danger"
        onClick={() => void onDelete(supplier.id)}
      >
        Remover
      </button>
    </div>
  )
}

function EditableNoteRow({
  note,
  recent,
  selected,
  onSelect,
  onSave,
  onDelete,
}: {
  note: NotaFiscal
  recent: boolean
  selected: boolean
  onSelect: () => void
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
    <tr className={recent ? 'new-note-row' : ''}>
      <td className="check-cell">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Selecionar NF ${note.numeroNF}`}
        />
      </td>
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
      <td className="date-cell">{formatDateTime(note.dataCadastro)}</td>
      <td>
        <input
          className="editable-cell-input control-date-input"
          type="date"
          value={note.dataEnvio ?? ''}
          aria-label={`Data de envio à controladoria da NF ${note.numeroNF}`}
          onChange={(event) => void onSave({
            ...note,
            dataEnvio: event.target.value || null,
          })}
        />
      </td>
      <td><code>{note.chaveAcesso}</code></td>
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
    <div
      className="modal-backdrop"
 <div
        className="user-management"
        onMouseDown={(event) => event.stopPropagation()}
      >      if (event.target === event.currentTarget) onClose()
      }}
    >
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
  }).format(new Date(value))
}

function formatDateTime(value: string): string {
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
