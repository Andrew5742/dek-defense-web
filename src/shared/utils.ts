import type { AppState } from './types'

export const nowIso = () => new Date().toISOString()

export function todayLocalDate(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function extOf(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : ''
}

export function isAllowedPresentationExt(ext: string): boolean {
  return ['pdf', 'pptx', 'ppt', 'odp'].includes(ext.toLowerCase())
}

export function sanitizeFilePart(value: string): string {
  return normalizeText(value)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s/g, '_')
    .slice(0, 80)
}

export function emptyState(): AppState {
  return {
    sessions: [],
    groups: [],
    students: [],
    presentations: [],
    queue: [],
    commands: [],
    stations: [],
    protocols: [],
    events: [],
    importReviews: []
  }
}

export function downloadTextFile(fileName: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function formatLocalDateTime(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('uk-UA')
}

export function canRegister(session: { date: string; registrationOpenFrom: string; registrationOpenTo: string; manualRegistrationOpen: boolean; isRegistrationLocked: boolean; isClosed?: boolean }) {
  if (session.isClosed) return false
  if (session.manualRegistrationOpen) return true
  if (session.isRegistrationLocked) return false
  return true
}
