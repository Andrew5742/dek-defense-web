import type { AppRepository, AppState } from '../shared/types'
import { emptyState } from '../shared/utils'

type StateCallback = (state: AppState) => void
export type LocalServerConnectionStatus = 'connecting' | 'online' | 'offline'
type StatusCallback = (status: LocalServerConnectionStatus) => void

function isLocalOrLanHost(hostname: string) {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)
}

function getLocalServerBaseUrl() {
  const configured = import.meta.env.VITE_LOCAL_SERVER_URL as string | undefined
  if (configured) return configured.replace(/\/$/, '')
  if (isLocalOrLanHost(window.location.hostname)) {
    if (window.location.port === '3050') return window.location.origin.replace(/\/$/, '')
    return `http://${window.location.hostname}:3050`
  }
  return 'http://localhost:3050'
}

function wsUrlFromHttp(httpUrl: string) {
  return httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {})
    }
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Local DB request failed: ${response.status}`)
  }
  const text = await response.text()
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const preview = text.trim().slice(0, 80)
    throw new Error(
      `Local DB Agent returned non-JSON response from ${url}. ` +
      `Open the app through Electron Agent or make sure http://localhost:3050 is running. ` +
      `Response: ${preview}`
    )
  }
  try {
    return JSON.parse(text) as T
  } catch (error) {
    const preview = text.trim().slice(0, 80)
    throw new Error(
      `Local DB Agent returned invalid JSON from ${url}: ${error instanceof Error ? error.message : String(error)}. ` +
      `Response: ${preview}`
    )
  }
}

export class LocalServerRepository implements AppRepository {
  readonly baseUrl = getLocalServerBaseUrl()

  async getState(): Promise<AppState> {
    const state = await fetchJson<AppState>(`${this.baseUrl}/api/state`)
    return { ...emptyState(), ...state }
  }

  async saveState(state: AppState): Promise<AppState> {
    return fetchJson<AppState>(`${this.baseUrl}/api/state`, {
      method: 'POST',
      body: JSON.stringify(state)
    })
  }

  subscribe(callback: StateCallback, onStatus?: StatusCallback): () => void {
    let disposed = false
    let socket: WebSocket | null = null
    let retryTimer = 0

    const connect = () => {
      if (disposed) return
      onStatus?.('connecting')
      socket = new WebSocket(`${wsUrlFromHttp(this.baseUrl)}/ws`)
      socket.onopen = () => onStatus?.('online')
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload?.type === 'state' && payload.state) {
            callback({ ...emptyState(), ...payload.state })
          }
        } catch {
          // Ignore malformed realtime payloads; the next server broadcast will resync.
        }
      }
      socket.onclose = () => {
        if (!disposed) {
          onStatus?.('offline')
          retryTimer = window.setTimeout(connect, 1200)
        }
      }
      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()
    return () => {
      disposed = true
      window.clearTimeout(retryTimer)
      socket?.close()
    }
  }
}

export const localServerRepository = new LocalServerRepository()
export const localServerBaseUrl = localServerRepository.baseUrl
