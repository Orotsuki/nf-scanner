import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

type Props = {
  enabled: boolean
  onDetected: (value: string) => void
}

type DecodeResult = {
  getText: () => string
}

export default function Scanner({ enabled, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const lastResultRef = useRef('')

  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!enabled || !videoRef.current) return

    let cancelled = false

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

    const handleResult = (
      result: DecodeResult | undefined,
      _error: unknown,
    ) => {
      if (cancelled || !result) return

      const text = result.getText()

      if (!text || text === lastResultRef.current) return

      lastResultRef.current = text
      onDetected(text)

      window.setTimeout(() => {
        if (lastResultRef.current === text) {
          lastResultRef.current = ''
        }
      }, 1200)
    }

    reader
      .decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        videoRef.current,
        handleResult,
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop()
          return
        }

        controlsRef.current = controls
        setStarting(false)
      })
      .catch((cause: unknown) => {
        if (cancelled) return

        setStarting(false)

        const message =
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Permissão da câmera negada. Autorize a câmera no navegador.'
            : 'Não foi possível iniciar a câmera. Verifique se o site está em HTTPS ou localhost.'

        setError(message)
      })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [enabled, onDetected])

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

        {starting && (
          <div className="scanner-status">
            Iniciando câmera…
          </div>
        )}

        {!starting && enabled && !error && (
          <div className="scanner-help">
            Aponte para o código de barras ou QR Code
          </div>
        )}

        {error && (
          <div className="scanner-error">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
