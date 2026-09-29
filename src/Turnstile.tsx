import { useEffect, useRef } from 'react'

type TurnstileInstance = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      theme?: 'light' | 'dark' | 'auto'
      size?: 'normal' | 'compact'
      appearance?: 'always' | 'execute' | 'interaction-only'
      callback?: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: (errorCode?: string) => void
    },
  ) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileInstance
  }
}

const SCRIPT_ID = 'cloudflare-turnstile-api'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type Props = {
  siteKey: string
  resetKey?: number
  onToken: (token: string) => void
  onReset: () => void
  onError: () => void
}

export default function Turnstile({ siteKey, resetKey = 0, onToken, onReset, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!siteKey || !containerRef.current) return

    let cancelled = false

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return

      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // Ignore stale widget cleanup errors.
        }
        widgetIdRef.current = null
      }

      containerRef.current.innerHTML = ''
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'dark',
        size: 'normal',
        appearance: 'always',
        callback: onToken,
        'expired-callback': onReset,
        'error-callback': onError,
      })
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
      if (!script) {
        script = document.createElement('script')
        script.id = SCRIPT_ID
        script.src = SCRIPT_SRC
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }

      script.addEventListener('load', renderWidget, { once: true })
    }

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // Ignore stale widget cleanup errors.
        }
      }
      widgetIdRef.current = null
    }
  }, [siteKey, resetKey, onToken, onReset, onError])

  if (!siteKey) return null

  return <div ref={containerRef} className="turnstile-widget" aria-label="Verificação de segurança" />
}
