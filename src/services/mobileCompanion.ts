import { localServerBaseUrl } from './localServerRepository'

export type MobileCompanionSnapshot = {
  studentPage: {
    token: string
    studentId: string
    sessionId: string
    fullName: string
    groupName: string
    thesisTitle: string
    queuePosition?: number | null
    registrationConfirmed?: boolean
    defenseStatus: string
    presentationStatus: string
    wantsZoomDemo?: boolean
    problemDetails?: {
      note?: string
      returnedToStudent?: boolean
      deadline?: string
      resolved?: boolean
    } | null
    expiresAt?: string
    updatedAt?: string
  } | null
  mobileDisplay: {
    sessionId: string
    enabled: boolean
    publicMessage: string
    zoomUrl?: string
    queuePositions?: Record<string, number>
    currentlyDefending: Array<{ studentId: string; fullName: string; groupName: string; position: number }>
    nextDefending: Array<{ studentId: string; fullName: string; groupName: string; position: number }>
    updatedAt?: string
  } | null
}

export type MobileConnectionStatus = 'connecting' | 'online' | 'offline'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {})
    }
  })
  if (!response.ok) throw new Error(await response.text().catch(() => `Request failed: ${response.status}`))
  return response.json() as Promise<T>
}

function wsUrlFromHttp(httpUrl: string) {
  return httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

export async function fetchMobileCompanion(token: string): Promise<MobileCompanionSnapshot> {
  return fetchJson<MobileCompanionSnapshot>(`${localServerBaseUrl}/api/mobile/${encodeURIComponent(token)}`)
}

export function subscribeMobileCompanion(
  token: string,
  callback: (snapshot: MobileCompanionSnapshot) => void,
  onStatus?: (status: MobileConnectionStatus) => void
): () => void {
  let disposed = false
  let socket: WebSocket | null = null
  let retryTimer = 0

  const refresh = () => {
    if (disposed) return
    void fetchMobileCompanion(token)
      .then((snapshot) => {
        if (!disposed) {
          onStatus?.('online')
          callback(snapshot)
        }
      })
      .catch(() => { if (!disposed) onStatus?.('offline') })
  }

  const connect = () => {
    if (disposed) return
    onStatus?.('connecting')
    socket = new WebSocket(`${wsUrlFromHttp(localServerBaseUrl)}/ws`)
    socket.onopen = () => {
      onStatus?.('online')
      refresh()
    }
    socket.onmessage = refresh
    socket.onclose = () => {
      if (!disposed) {
        onStatus?.('offline')
        retryTimer = window.setTimeout(connect, 1200)
      }
    }
    socket.onerror = () => socket?.close()
  }

  refresh()
  connect()
  return () => {
    disposed = true
    window.clearTimeout(retryTimer)
    socket?.close()
  }
}

export async function confirmMobileRegistration(token: string): Promise<void> {
  await fetchJson(`${localServerBaseUrl}/api/mobile/${encodeURIComponent(token)}/confirm`, { method: 'POST', body: '{}' })
}

export async function expireMobileStudentPage(token: string): Promise<void> {
  await fetchJson(`${localServerBaseUrl}/api/mobile/${encodeURIComponent(token)}/expire`, { method: 'POST', body: '{}' })
}

export async function fetchMobileQueuePosition(sessionId: string, studentId: string): Promise<number | undefined> {
  const payload = await fetchJson<{ position?: number | null }>(`${localServerBaseUrl}/api/mobile/queue-position/${encodeURIComponent(sessionId)}/${encodeURIComponent(studentId)}`)
  return payload.position || undefined
}
