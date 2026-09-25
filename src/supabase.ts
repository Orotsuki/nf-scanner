import { createClient } from '@supabase/supabase-js'

type BrowserConfig = {
  supabaseUrl?: string
  supabasePublishableKey?: string
}

declare global {
  interface Window {
    NF_SCANNER_CONFIG?: BrowserConfig
  }
}

const config = window.NF_SCANNER_CONFIG ?? {}
export const supabaseUrl = config.supabaseUrl?.trim() ?? ''
export const supabasePublishableKey = config.supabasePublishableKey?.trim() ?? ''

export const isSupabaseConfigured =
  /^https:\/\/[^\s]+\.supabase\.co\/?$/.test(supabaseUrl) &&
  supabasePublishableKey.length > 20

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
