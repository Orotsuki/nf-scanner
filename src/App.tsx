import { useCallback, useEffect, useMemo, useState } from 'react'
import Scanner from './Scanner'
import { explainNFeError, parseNFe } from './nfe'
import { exportToXlsx } from './exportExcel'
import { loadNotes, saveNotes } from './storage'
import type { NotaFiscal } from './types'

const SAMPLE_KEY = '31260922545180000120550010001176811053342306'

export default function App() {
  const [notes, setNotes] = useState<NotaFiscal[]>(() => loadNotes())
  const [scannerOpen, setScannerOpen] = useState(true)
  const [scanTrigger, setScanTrigger] = useState(0)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualValue, setManualValue] = useState('')
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)

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
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const addNoteFromRaw = useCallback((raw: string) => {
    const parsed = parseNFe(raw)
    if (!parsed) {
      setToast({ type: 'error', text: explainNFeError(raw) })
      return
    }

    if (notes.some((note) => note.chaveAcesso === parsed.chaveAcesso)) {
      setToast({ type: 'warning', text: `NF ${parsed.numeroNF} já foi lida.` })
      return
    }

    const note: NotaFiscal = {
      ...parsed,
      id: crypto.randomUUID(),
      dataLeitura: new Date().toISOString(),
    }

    setNotes((current) => [note, ...current])
    setToast({ type: 'success', text: `NF ${parsed.numeroNF} adicionada.` })
    setManualValue('')
    setManualOpen(false)

    if ('vibrate' in navigator) navigator.vibrate?.(70)
    playBeep()
  }, [notes])

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((note) =>
      note.numeroNF.toLowerCase().includes(q) ||
      note.cnpjEmitente.toLowerCase().includes(q) ||
      note.chaveAcesso.includes(q),
    )
  }, [notes, search])

  function removeNote(id: string) {
    setNotes((current) => current.filter((note) => note.id !== id))
  }

  function clearNotes() {
    if (!notes.length) return
    if (window.confirm('Excluir todas as notas armazenadas neste dispositivo?')) {
      setNotes([])
      setToast({ type: 'success', text: 'Lista limpa.' })
    }
  }

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  function requestScan() {
    setScannerOpen(true)
    setScanTrigger((value) => value + 1)
  }

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
              <button className="btn ghost" onClick={() => addNoteFromRaw(SAMPLE_KEY)}>Testar com exemplo</button>
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
                    placeholder="Digite ou cole a chave de 44 dígitos"
                  />
                  <button className="btn primary" onClick={() => addNoteFromRaw(manualValue)}>Adicionar</button>
                </div>
                <div className="field-help">Também aceita chave com espaços ou formatação.</div>
              </div>
            )}
          </div>

          <aside className="summary-card">
            <div className="summary-label">Documentos armazenados</div>
            <div className="summary-number">{notes.length}</div>
            <div className="summary-foot">Os dados ficam salvos neste dispositivo.</div>
            <div className="summary-actions">
              <button className="btn primary full" disabled={!notes.length} onClick={() => exportToXlsx(notes)}>Exportar XLSX</button>
              <button className="btn ghost full" disabled={!notes.length} onClick={clearNotes}>Limpar tudo</button>
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
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar NF, CNPJ ou chave" />
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Número da NF</th>
                  <th>CNPJ do emitente</th>
                  <th>Chave de acesso</th>
                  <th>Leitura</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {filteredNotes.map((note) => (
                  <tr key={note.id}>
                    <td><strong>{note.numeroNF}</strong></td>
                    <td>{note.cnpjEmitente}</td>
                    <td><code>{note.chaveAcesso}</code></td>
                    <td>{formatDate(note.dataLeitura)}</td>
                    <td className="action-cell">
                      <button className="delete-btn" onClick={() => removeNote(note.id)} aria-label={`Excluir NF ${note.numeroNF}`}>×</button>
                    </td>
                  </tr>
                ))}
                {!filteredNotes.length && (
                  <tr>
                    <td colSpan={5} className="empty-row">
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
