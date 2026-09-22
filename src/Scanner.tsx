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

function cameraKind(label: string): 'back' | 'front' | 'unknown' {
  const text = label.toLowerCase()

  if (/front|frontal|selfie|user/.test(text)) return 'front'
  if (/back|rear|traseira|environment/.test(text)) return 'back'

  // Some Android browsers expose only generic names such as
  // "camera 0, facing back". Keep this as a fallback.
  if (/facing\s*back/.test(text)) return 'back'
  if (/facing\s*front/.test(text)) return 'front'

  return 'unknown'
}

function scoreCamera(label: string): number {
  const text = label.toLowerCase()
  let score = 0
  const kind = cameraKind(label)

  if (kind === 'front') score -= 1000
  if (kind === 'back') score += 100

  // On the S24 FE tested with this project, "camera 0, facing back"
  // is the main 1× camera. Prefer this pattern when the browser exposes it.
  if (/camera\s*0.*facing\s*back/.test(text)) score += 250

  if (/main|principal|primary/.test(text)) score += 80
  if (/ultra\s*-?\s*wide|ultrawide|wide\s*-?\s*angle|0[.,][56]\s*x|0\.5x|0\.6x/.test(text)) score -= 140
  if (/macro/.test(text)) score -= 100
  if (/tele|zoom|\b2x\b|\b3x\b|\b5x\b/.test(text)) score -= 40

  return score
}

function choosePreferredCamera(cameras: CameraDevice[]): CameraDevice | undefined {
  if (!cameras.length) return undefined

  const savedId = localStorage.getItem(CAMERA_STORAGE_KEY)
  const saved = cameras.find((camera) => camera.deviceId === savedId)
  if (saved) return saved

  return [...cameras].sort((a, b) => scoreCamera(b.label) - scoreCamera(a.label))[0]
}

function friendlyCameraLabel(
  camera: CameraDevice,
  preferredId: string,
  index: number,
): string {
  const text = camera.label.toLowerCase()
  const kind = cameraKind(camera.label)

  if (kind === 'front') return 'Frontal'

  if (kind === 'back') {
    if (camera.deviceId === preferredId) return 'Traseira principal (1×)'
    if (/ultra\s*-?\s*wide|ultrawide|wide\s*-?\s*angle|0[.,][56]\s*x|0\.5x|0\.6x/.test(text)) {
      return 'Traseira ultrawide (0,6×)'
    }
    if (/macro/.test(text)) return 'Traseira macro'
    if (/tele|zoom|\b2x\b|\b3x\b|\b5x\b/.test(text)) {
      return 'Traseira teleobjetiva'
    }
    return `Traseira auxiliar ${index + 1}`
  }

  return `Câmera ${index + 1}`
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
      delayBetweenScanAttempts: 180,
      delayBetweenScanSuccess: 750,
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
          }, 1100)
        },
      )

      controlsRef.current = controls

      // Give the browser a moment to attach the selected stream, then request
      // continuous autofocus when the device exposes that capability.
      window.setTimeout(() => {
        const stream = videoRef.current?.srcObject as MediaStream | null
        const track = stream?.getVideoTracks()[0]
        if (!track) return

        const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
          focusMode?: string[]
        }

        if (capabilities.focusMode?.includes('continuous')) {
          void track.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
          })
        }
      }, 250)

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
    const camera = cameras.find((item) => item.deviceId === deviceId)
    if (!camera) return

    setSelectedCameraId(deviceId)
    localStorage.setItem(CAMERA_STORAGE_KEY, deviceId)
    await startScanner(deviceId)
  }

  const preferredId = selectedCameraId || cameras[0]?.deviceId || ''

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
            Enquadre o código dentro da área marcada
          </div>
        )}

        {error && <div className="scanner-error">{error}</div>}
      </div>

      {cameras.length > 1 && (
        <div className="camera-selector">
          <label htmlFor="camera-select">Câmera</label>
          <select
            id="camera-select"
            value={selectedCameraId}
            onChange={(event) => void changeCamera(event.target.value)}
          >
            {cameras.map((camera, index) => (
              <option key={camera.deviceId} value={camera.deviceId}>
                {friendlyCameraLabel(camera, preferredId, index)}
              </option>
            ))}
          </select>
          <div className="field-help">
            A principal 1× é usada por padrão. Sua escolha fica salva neste aparelho.
          </div>
        </div>
      )}
    </div>
  )
}
