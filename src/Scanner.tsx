import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

type Props = {
  enabled: boolean
  onDetected: (value: string) => void
  scanTrigger?: number
}

type CameraDevice = {
  deviceId: string
  label: string
}

type NativeDetector = {
  detect: (
    source: HTMLVideoElement,
  ) => Promise<Array<{ rawValue?: string; format?: string }>>
}

type NativeDetectorConstructor = new (options?: { formats?: string[] }) => NativeDetector

const CAMERA_STORAGE_KEY = 'nfscanner-selected-camera'

function cameraKind(label: string): 'back' | 'front' | 'unknown' {
  const text = label.toLowerCase()

  if (/front|frontal|selfie|user/.test(text)) return 'front'
  if (/back|rear|traseira|environment|facing\s*back/.test(text)) return 'back'
  if (/facing\s*front/.test(text)) return 'front'

  return 'unknown'
}

function scoreCamera(label: string): number {
  const text = label.toLowerCase()
  let score = 0
  const kind = cameraKind(label)

  if (kind === 'front') score -= 1000
  if (kind === 'back') score += 100

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

function getNativeDetectorConstructor(): NativeDetectorConstructor | null {
  const candidate = (globalThis as typeof globalThis & {
    BarcodeDetector?: NativeDetectorConstructor
  }).BarcodeDetector

  return typeof candidate === 'function' ? candidate : null
}

async function createNativeDetector(): Promise<NativeDetector | null> {
  const Constructor = getNativeDetectorConstructor()
  if (!Constructor) return null

  try {
    const supported =
      typeof (Constructor as typeof Constructor & {
        getSupportedFormats?: () => Promise<string[]>
      }).getSupportedFormats === 'function'
        ? await (
            Constructor as typeof Constructor & {
              getSupportedFormats: () => Promise<string[]>
            }
          ).getSupportedFormats()
        : []

    const desired = ['code_128', 'qr_code'].filter((format) =>
      supported.includes(format),
    )

    return desired.length
      ? new Constructor({ formats: desired })
      : new Constructor()
  } catch {
    return null
  }
}

function extract44DigitKey(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw)
    const match = decoded.match(/\d{44}/)
    return match?.[0] ?? null
  } catch {
    const match = raw.match(/\d{44}/)
    return match?.[0] ?? null
  }
}

export default function Scanner({ enabled, onDetected, scanTrigger = 0 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const nativeDetectorRef = useRef<NativeDetector | null>(null)
  const nativeTimerRef = useRef<number | null>(null)
  const nativeBusyRef = useRef(false)
  const lastResultRef = useRef('')
  const onDetectedRef = useRef(onDetected)

  const [cameras, setCameras] = useState<CameraDevice[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState('')
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [loadingCameras, setLoadingCameras] = useState(false)
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false)
  const [flashSupported, setFlashSupported] = useState(false)
  const [flashOn, setFlashOn] = useState(false)

  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  const reportDecodedValue = (raw: string) => {
    const key = extract44DigitKey(raw)

    // Reject partial or noisy reads before they reach App.
    if (!key || key === lastResultRef.current) return

    lastResultRef.current = key
    onDetectedRef.current(key)

    window.setTimeout(() => {
      if (lastResultRef.current === key) lastResultRef.current = ''
    }, 1200)
  }

  const stopNativeDetector = () => {
    if (nativeTimerRef.current !== null) {
      window.clearTimeout(nativeTimerRef.current)
      nativeTimerRef.current = null
    }
    nativeBusyRef.current = false
    nativeDetectorRef.current = null
  }

  const stopScanner = () => {
    stopNativeDetector()
    setFlashSupported(false)
    setFlashOn(false)
    controlsRef.current?.stop()
    controlsRef.current = null
    readerRef.current = null

    const stream = videoRef.current?.srcObject as MediaStream | null
    stream?.getTracks().forEach((track) => track.stop())
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const startNativeLoop = async () => {
    const video = videoRef.current
    if (!video) return

    const detector = await createNativeDetector()
    if (!detector) return

    nativeDetectorRef.current = detector

    const loop = async () => {
      if (!enabled || !nativeDetectorRef.current || !video || video.readyState < 2) {
        nativeTimerRef.current = window.setTimeout(loop, 250)
        return
      }

      if (!nativeBusyRef.current) {
        nativeBusyRef.current = true
        try {
          const codes = await nativeDetectorRef.current.detect(video)
          for (const code of codes) {
            if (code.rawValue) {
              const key = extract44DigitKey(code.rawValue)
              if (key) {
                reportDecodedValue(key)
                break
              }
            }
          }
        } catch {
          // Native detection is best-effort; ZXing continues as fallback.
        } finally {
          nativeBusyRef.current = false
        }
      }

      nativeTimerRef.current = window.setTimeout(loop, 120)
    }

    nativeTimerRef.current = window.setTimeout(loop, 120)
  }

  const startScanner = async (deviceId?: string) => {
    if (!videoRef.current) return

    stopScanner()
    setStarting(true)
    setError('')

    const hints = new Map<DecodeHintType, unknown>()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.QR_CODE,
    ])
    hints.set(DecodeHintType.TRY_HARDER, true)

    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 100,
      delayBetweenScanSuccess: 750,
      tryPlayVideoTimeout: 7000,
    })

    readerRef.current = reader

    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30, max: 30 },
            }
          : {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30, max: 30 },
            },
        audio: false,
      }

      const controls = await reader.decodeFromConstraints(
        constraints,
        videoRef.current,
        (result) => {
          if (!result) return
          reportDecodedValue(result.getText())
        },
      )

      controlsRef.current = controls

      const stream = videoRef.current.srcObject as MediaStream | null
      const track = stream?.getVideoTracks()[0]

      if (track) {
        const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
          focusMode?: string[]
          torch?: boolean
        }

        setFlashSupported(capabilities.torch === true)
        setFlashOn(false)

        if (capabilities.focusMode?.includes('continuous')) {
          try {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
            })
          } catch {
            // Autofocus request is optional.
          }
        }
      }

      await videoRef.current.play().catch(() => undefined)
      setStarting(false)
      void startNativeLoop()
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

  useEffect(() => {
    if (!enabled || scanTrigger === 0) return

    const video = videoRef.current
    const detector = nativeDetectorRef.current
    const reader = readerRef.current

    const oneShot = async () => {
      if (video && detector && video.readyState >= 2 && !nativeBusyRef.current) {
        nativeBusyRef.current = true
        try {
          const codes = await detector.detect(video)
          for (const code of codes) {
            if (code.rawValue) {
              const key = extract44DigitKey(code.rawValue)
              if (key) {
                reportDecodedValue(key)
                return
              }
            }
          }
        } catch {
          // Fall through to the ZXing frame scan below.
        } finally {
          nativeBusyRef.current = false
        }
      }

      if (!reader || !video) return

      try {
        const result = await reader.decodeOnceFromVideoElement(video)
        reportDecodedValue(result.getText())
      } catch {
        // A scan attempt failing is not a fatal camera error.
      }
    }

    void oneShot()
  }, [enabled, scanTrigger])

  const toggleFlash = async () => {
    const stream = videoRef.current?.srcObject as MediaStream | null
    const track = stream?.getVideoTracks()[0]
    if (!track || !flashSupported) return

    const next = !flashOn
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      })
      setFlashOn(next)
    } catch {
      setError('Não foi possível alterar o flash desta câmera.')
    }
  }

  const changeCamera = async (deviceId: string) => {
    const camera = cameras.find((item) => item.deviceId === deviceId)
    if (!camera) return

    setSelectedCameraId(deviceId)
    localStorage.setItem(CAMERA_STORAGE_KEY, deviceId)
    setCameraMenuOpen(false)
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

        <div className="scanner-tools">
          <button
            type="button"
            className={`scanner-menu-btn ${cameraMenuOpen ? 'active' : ''}`}
            onClick={() => setCameraMenuOpen((value) => !value)}
            aria-label="Opções da câmera"
            aria-expanded={cameraMenuOpen}
          >
            ⋯
          </button>

          {cameraMenuOpen && (
            <div className="scanner-menu" role="dialog" aria-label="Opções da câmera">
              <div className="scanner-menu-title">Opções da câmera</div>

              <label htmlFor="camera-select">Câmera</label>
              <select
                id="camera-select"
                value={selectedCameraId}
                onChange={(event) => void changeCamera(event.target.value)}
              >
                {cameras.map((camera, index) => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {friendlyCameraLabel(camera, selectedCameraId, index)}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className={`flash-toggle ${flashOn ? 'on' : ''}`}
                disabled={!flashSupported}
                onClick={() => void toggleFlash()}
              >
                <span>{flashOn ? 'Desligar flash' : 'Ligar flash'}</span>
                <span className="flash-state">{flashSupported ? (flashOn ? 'Ligado' : 'Desligado') : 'Indisponível'}</span>
              </button>

              {!flashSupported && (
                <div className="field-help">O flash não é disponibilizado pelo navegador para esta câmera.</div>
              )}
            </div>
          )}
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

      {cameraMenuOpen && cameras.length === 0 && (
        <div className="camera-selector-fallback">Nenhuma câmera disponível para seleção.</div>
      )}
    </div>
  )
}
