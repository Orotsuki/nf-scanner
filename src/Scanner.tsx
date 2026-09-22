import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

type Props = {
  enabled: boolean
  onDetected: (value: string) => void
}

type CameraDevice = {
  deviceId: string
  label: string
}

const CAMERA_STORAGE_KEY = 'nfscanner-selected-camera'

function scoreCamera(label: string): number {
  const text = label.toLowerCase()
  let score = 0

  // Prefer rear-facing cameras and avoid front/ultra-wide/macro/tele lenses.
  if (/front|frontal|selfie|user/.test(text)) score -= 100
  if (/back|rear|traseira|environment/.test(text)) score += 30
  if (/ultra\s*-?\s*wide|ultrawide|wide\s*-?\s*angle|0[.,][56]\s*x|0\.5x|0\.6x/.test(text)) score -= 80
  if (/macro/.test(text)) score -= 50
  if (/tele|zoom|\b2x\b|\b3x\b|\b5x\b/.test(text)) score -= 20
  if (/main|principal|primary|camera\s*0|camera\s*1/.test(text)) score += 15

  return score
}

function choosePreferredCamera(cameras: CameraDevice[]): CameraDevice | undefined {
  if (!cameras.length) return undefined

  const savedId = localStorage.getItem(CAMERA_STORAGE_KEY)
  const saved = cameras.find((camera) => camera.deviceId === savedId)
  if (saved) return saved

  return [...cameras].sort((a, b) => scoreCamera(b.label) - scoreCamera(a.label))[0]
}

export default function Scanner({ enabled, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const lastResultRef = useRef('')
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)

  const [cameras, setCameras] = useState<CameraDevice[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState('')
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [loadingCameras, setLoadingCameras] = useState(false)

  const stopScanner = () => {
    controlsRef.current?.stop()
    controlsRef.current = null
    readerRef.current = null
  }

  const startScanner = async (deviceId?: string) => {
    if (!videoRef.current) return

    stopScanner()
    setStarting(true)
    setError('')

    const hints = new Map<DecodeHintType, unknown>()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.CODE_128,
    ])

    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 250,
      delayBetweenScanSuccess: 800,
      tryPlayVideoTimeout: 7000,
    })

    readerRef.current = reader

    try {
      const controls = await reader.decodeFromVideoDevice(
        deviceId || undefined,
        videoRef.current,
        (result) => {
          if (!result) return

          const text = result.getText()
          if (!text || text === lastResultRef.current) return

          lastResultRef.current = text
          onDetected(text)

          window.setTimeout(() => {
            if (lastResultRef.current === text) {
              lastResultRef.current = ''
            }
          }, 1200)
        },
      )

      controlsRef.current = controls
      setStarting(false)
    } catch (cause: unknown) {
      setStarting(false)

      const message =
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'Permissão da câmera negada. Autorize a câmera no navegador.'
          : 'Não foi possível iniciar esta câmera. Selecione outra câmera abaixo.'

      setError(message)
    }
  }

  const loadCameras = async () => {
    setLoadingCameras(true)

    try {
      // Asking for permission first makes camera labels available on many browsers.
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })

      permissionStream.getTracks().forEach((track) => track.stop())

      const devices = await BrowserMultiFormatReader.listVideoInputDevices()
      const mapped = devices.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Câmera ${index + 1}`,
      }))

      setCameras(mapped)

      const preferred = choosePreferredCamera(mapped)
      if (preferred) {
        setSelectedCameraId(preferred.deviceId)
        localStorage.setItem(CAMERA_STORAGE_KEY, preferred.deviceId)
        await startScanner(preferred.deviceId)
      } else {
        await startScanner()
      }
    } catch (cause: unknown) {
      const message =
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'Permissão da câmera negada. Autorize a câmera no navegador.'
          : 'Não foi possível acessar as câmeras disponíveis.'

      setError(message)
      setStarting(false)
    } finally {
      setLoadingCameras(false)
    }
  }

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    const run = async () => {
      await loadCameras()
      if (cancelled) stopScanner()
    }

    void run()

    return () => {
      cancelled = true
      stopScanner()
    }
    // Scanner is mounted/unmounted by App; when enabled changes we restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const changeCamera = async (deviceId: string) => {
    setSelectedCameraId(deviceId)
    localStorage.setItem(CAMERA_STORAGE_KEY, deviceId)
    await startScanner(deviceId)
  }

  return (
    <div className="scanner-card">
      <div className="scanner-viewport">
        <video
          ref={videoRef}
          className="scanner-video"
          muted
          playsInline
          autoPlay
        />

        <div className="scanner-mask" aria-hidden="true">
          <div className="scanner-frame" />
        </div>

        {loadingCameras && (
          <div className="scanner-status">Identificando câmeras…</div>
        )}

        {!loadingCameras && starting && (
          <div className="scanner-status">Iniciando câmera…</div>
        )}

        {!loadingCameras && !starting && !error && enabled && (
          <div className="scanner-help">
            Aponte para o código de barras ou QR Code
          </div>
        )}

        {error && <div className="scanner-error">{error}</div>}
      </div>

      {cameras.length > 1 && (
        <div
          className="camera-selector"
          style={{ marginTop: 10, display: 'grid', gap: 6 }}
        >
          <label htmlFor="camera-select" style={{ fontWeight: 600 }}>
            Câmera
          </label>
          <select
            id="camera-select"
            value={selectedCameraId}
            onChange={(event) => void changeCamera(event.target.value)}
            style={{
              width: '100%',
              minHeight: 42,
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid #d5d9e2',
              background: '#fff',
              fontSize: 14,
            }}
          >
            {cameras.map((camera, index) => (
              <option key={camera.deviceId} value={camera.deviceId}>
                {camera.label || `Câmera ${index + 1}`}
              </option>
            ))}
          </select>
          <div className="field-help">
            O aplicativo tenta selecionar automaticamente a câmera traseira principal e memoriza sua escolha.
          </div>
        </div>
      )}
    </div>
  )
}
