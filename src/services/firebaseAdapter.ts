import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut, type Auth, type User } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, getFirestore, onSnapshot, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore'
import type { AppRepository, AppState, Command, PresentationMeta, Station } from '../shared/types'
import { emptyState } from '../shared/utils'

export interface FirebaseRuntime {
  app: FirebaseApp
  db: Firestore
  auth: Auth
}

export function createFirebaseRuntime(): FirebaseRuntime | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
  const appId = import.meta.env.VITE_FIREBASE_APP_ID

  if (!apiKey || !authDomain || !projectId || !appId) return null

  const app = initializeApp({
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId
  })

  return { app, db: getFirestore(app), auth: getAuth(app) }
}

const runtime = createFirebaseRuntime()
const APP_STATE_COLLECTION = 'dek_app'
const APP_STATE_DOC = 'state'
const COMMANDS_COLLECTION = 'dek_commands'
const PRESENTATIONS_COLLECTION = 'dek_presentations'
const STATIONS_COLLECTION = 'dek_stations'

function normalizeState(value: unknown): AppState {
  if (!value || typeof value !== 'object') return emptyState()
  return { ...emptyState(), ...(value as Partial<AppState>) }
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => withoutUndefined(item)) as T
  }

  if (value && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) cleaned[key] = withoutUndefined(item)
    }
    return cleaned as T
  }

  return value
}

function toIso(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString()
  }
  return new Date().toISOString()
}

function mergeById<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of local) map.set(item.id, item)
  for (const item of remote) map.set(item.id, { ...(map.get(item.id) || {}), ...item })
  return Array.from(map.values())
}

function newestIso(a?: string, b?: string): string {
  const aMs = a ? Date.parse(a) : 0
  const bMs = b ? Date.parse(b) : 0
  return aMs >= bMs ? (a || b || '') : (b || a || '')
}

function mergePreferNewest<T extends { id: string; updatedAt?: string; createdAt?: string }>(remote: T[], local: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of remote) map.set(item.id, item)
  for (const item of local) {
    const current = map.get(item.id)
    if (!current) {
      map.set(item.id, item)
      continue
    }
    const currentTime = Date.parse(current.updatedAt || current.createdAt || '')
    const nextTime = Date.parse(item.updatedAt || item.createdAt || '')
    map.set(item.id, Number.isFinite(nextTime) && nextTime >= currentTime ? { ...current, ...item } : { ...item, ...current })
  }
  return Array.from(map.values())
}

function deletedIds(state: AppState, eventType: 'STUDENT_DELETED' | 'SESSION_DELETED') {
  const ids = new Set<string>()
  for (const event of state.events) {
    if (event.type !== eventType) continue
    const key = eventType === 'STUDENT_DELETED' ? 'studentId' : 'sessionId'
    const id = event.payload?.[key]
    if (typeof id === 'string') ids.add(id)
  }
  return ids
}

function removedQueueTimestamps(state: AppState) {
  const keys = new Map<string, number>()
  for (const event of state.events) {
    if (event.type !== 'QUEUE_REMOVED') continue
    const sessionId = event.payload?.sessionId
    const studentId = event.payload?.studentId
    const removedAt = Date.parse(event.createdAt)
    if (typeof sessionId === 'string' && typeof studentId === 'string' && Number.isFinite(removedAt)) {
      const key = `${sessionId}:${studentId}`
      keys.set(key, Math.max(keys.get(key) || 0, removedAt))
    }
  }
  return keys
}

function mergeStateForSave(remote: AppState, local: AppState): AppState {
  const deletedStudentIds = deletedIds(local, 'STUDENT_DELETED')
  const deletedSessionIds = deletedIds(local, 'SESSION_DELETED')
  const removedQueue = removedQueueTimestamps(local)
  const keepSession = (sessionId?: string) => !sessionId || !deletedSessionIds.has(sessionId)
  const keepStudent = (studentId?: string) => !studentId || !deletedStudentIds.has(studentId)
  const keepQueueItem = (item: { sessionId: string; studentId: string; updatedAt?: string; createdAt?: string }) => {
    if (!keepSession(item.sessionId) || !keepStudent(item.studentId)) return false
    const removedAt = removedQueue.get(`${item.sessionId}:${item.studentId}`)
    if (!removedAt) return true
    const itemAt = Date.parse(item.updatedAt || item.createdAt || '')
    return Number.isFinite(itemAt) && itemAt > removedAt
  }
  const newestActiveSession = newestIso(local.events[0]?.createdAt, remote.events[0]?.createdAt) === local.events[0]?.createdAt
    ? local.activeSessionId
    : remote.activeSessionId

  return {
    ...remote,
    ...local,
    activeSessionId: newestActiveSession || local.activeSessionId || remote.activeSessionId,
    sessions: mergePreferNewest(remote.sessions, local.sessions).filter((item) => !deletedSessionIds.has(item.id)),
    groups: mergePreferNewest(remote.groups, local.groups).filter((item) => keepSession(item.sessionId)),
    students: mergePreferNewest(remote.students, local.students).filter((item) => keepSession(item.sessionId) && !deletedStudentIds.has(item.id)),
    presentations: mergePreferNewest(remote.presentations, local.presentations).filter((item) => keepSession(item.sessionId) && keepStudent(item.studentId)),
    queue: mergePreferNewest(remote.queue, local.queue).filter(keepQueueItem),
    commands: mergePreferNewest(remote.commands, local.commands).filter((item) => keepSession(item.sessionId) && keepStudent(item.studentId)),
    stations: mergePreferNewest(remote.stations, local.stations),
    protocols: mergePreferNewest(remote.protocols, local.protocols).filter((item) => keepSession(item.sessionId)),
    importReviews: mergePreferNewest(remote.importReviews, local.importReviews).filter((item) => keepSession(item.sessionId)),
    events: mergePreferNewest(remote.events, local.events).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 1000)
  }
}

function normalizeCommand(id: string, value: Record<string, unknown>): Command | null {
  if (!value.type || !value.sessionId) return null
  return {
    id: String(value.id || id),
    sessionId: String(value.sessionId),
    type: value.type as Command['type'],
    studentId: value.studentId ? String(value.studentId) : undefined,
    studentName: value.studentName ? String(value.studentName) : undefined,
    targetStationId: value.targetStationId ? String(value.targetStationId) : undefined,
    zoomUrl: value.zoomUrl ? String(value.zoomUrl) : undefined,
    status: (value.status as Command['status']) || 'pending',
    error: value.error ? String(value.error) : value.errorMessage ? String(value.errorMessage) : undefined,
    createdAt: toIso(value.createdAt),
    updatedAt: toIso(value.updatedAt)
  }
}

function normalizePresentation(id: string, value: Record<string, unknown>): PresentationMeta | null {
  if (!value.sessionId || !value.studentId) return null
  const extension = String(value.extension || value.format || value.fileName || '').split('.').pop()?.toLowerCase() || 'pdf'
  const status = (value.status as PresentationMeta['status']) || 'uploaded'
  return {
    id: String(value.id || id),
    sessionId: String(value.sessionId),
    studentId: String(value.studentId),
    fileName: String(value.fileName || value.originalFileName || value.storedName || id),
    originalFileName: String(value.originalFileName || value.fileName || value.storedName || id),
    fileSize: Number(value.fileSize || value.size || 0),
    mimeType: String(value.mimeType || 'application/octet-stream'),
    extension,
    version: Number(value.version || 1),
    status,
    uploadedAt: toIso(value.uploadedAt || value.createdAt || value.updatedAt),
    localOnly: value.localOnly !== false,
    storageKey: value.storageKey ? String(value.storageKey) : undefined,
    convertedPdfReady: value.convertedPdfReady === true || status === 'ready' || status === 'converted',
    error: value.error ? String(value.error) : value.errorMessage ? String(value.errorMessage) : undefined
  }
}

function normalizeStation(id: string, value: Record<string, unknown>): Station {
  return {
    id: String(value.id || value.stationId || id),
    name: String(value.name || 'Defense station'),
    activeSessionId: value.activeSessionId ? String(value.activeSessionId) : undefined,
    online: value.online === true,
    localUploadUrl: value.localUploadUrl ? String(value.localUploadUrl) : undefined,
    lanUploadUrl: value.lanUploadUrl ? String(value.lanUploadUrl) : undefined,
    currentStudentId: value.currentStudentId ? String(value.currentStudentId) : undefined,
    lastHeartbeat: toIso(value.lastHeartbeat || value.updatedAt)
  }
}

function mergeExternalState(base: AppState, external: Partial<AppState>): AppState {
  const sessionIds = new Set(base.sessions.map((session) => session.id))
  const commands = (external.commands || []).filter((command) => sessionIds.has(command.sessionId))
  const presentations = (external.presentations || []).filter((presentation) => sessionIds.has(presentation.sessionId))
  return {
    ...base,
    commands: mergeById(base.commands, commands),
    presentations: mergeById(base.presentations, presentations),
    stations: mergeById(base.stations, external.stations || [])
  }
}

export function isFirebaseEnabled(): boolean {
  return runtime !== null
}

export function getCurrentFirebaseUser(): User | null {
  return runtime?.auth.currentUser || null
}

export async function signInAdmin(email: string, password: string): Promise<User> {
  if (!runtime) throw new Error('Firebase не налаштований')
  const credential = await signInWithEmailAndPassword(runtime.auth, email, password)
  return credential.user
}

export async function signOutAdmin(): Promise<void> {
  if (!runtime) return
  await signOut(runtime.auth)
}

export class FirebaseRepository implements AppRepository {
  private stateRef() {
    if (!runtime) throw new Error('Firebase не налаштований')
    return doc(runtime.db, APP_STATE_COLLECTION, APP_STATE_DOC)
  }

  async getState(): Promise<AppState> {
    if (!runtime) return emptyState()
    const snapshot = await getDoc(this.stateRef())
    if (!snapshot.exists()) {
      await this.saveState(emptyState())
      return emptyState()
    }
    return mergeExternalState(normalizeState(snapshot.data().state), await this.getExternalState())
  }

  async saveState(state: AppState): Promise<void> {
    if (!runtime) return
    let stateToSave = state
    try {
      const snapshot = await getDoc(this.stateRef())
      if (snapshot.exists()) {
        stateToSave = mergeStateForSave(normalizeState(snapshot.data().state), state)
      }
    } catch (error) {
      console.warn('Firestore pre-save merge failed, saving local state', error)
    }

    const cleanState = withoutUndefined(stateToSave)
    await setDoc(this.stateRef(), {
      state: cleanState,
      updatedAt: serverTimestamp()
    }, { merge: true })

    const batch = writeBatch(runtime.db)
    let mirroredWrites = 0

    for (const command of stateToSave.commands) {
      batch.set(doc(runtime.db, COMMANDS_COLLECTION, command.id), withoutUndefined({
        ...command,
        errorMessage: command.error
      }), { merge: true })
      mirroredWrites += 1
    }

    for (const presentation of stateToSave.presentations) {
      batch.set(doc(runtime.db, PRESENTATIONS_COLLECTION, presentation.id), withoutUndefined(presentation), { merge: true })
      mirroredWrites += 1
    }

    if (!mirroredWrites) return
    await batch.commit().catch((error) => {
      console.warn('Firestore agent mirror write failed', error)
    })
  }

  private async getExternalState(): Promise<Partial<AppState>> {
    if (!runtime) return {}
    const safeGetDocs = async (collectionName: string) => {
      try {
        return await getDocs(collection(runtime.db, collectionName))
      } catch (error) {
        console.warn(`Firestore collection ${collectionName} is not readable yet`, error)
        return null
      }
    }
    const [commandsSnap, presentationsSnap, stationsSnap] = await Promise.all([
      safeGetDocs(COMMANDS_COLLECTION),
      safeGetDocs(PRESENTATIONS_COLLECTION),
      safeGetDocs(STATIONS_COLLECTION)
    ])

    return {
      commands: (commandsSnap?.docs || [])
        .map((snap) => normalizeCommand(snap.id, snap.data()))
        .filter(Boolean) as Command[],
      presentations: (presentationsSnap?.docs || [])
        .map((snap) => normalizePresentation(snap.id, snap.data()))
        .filter(Boolean) as PresentationMeta[],
      stations: (stationsSnap?.docs || []).map((snap) => normalizeStation(snap.id, snap.data()))
    }
  }

  subscribe(callback: (state: AppState) => void): () => void {
    if (!runtime) return () => undefined

    let base = emptyState()
    let commands: Command[] = []
    let presentations: PresentationMeta[] = []
    let stations: Station[] = []

    const emit = () => callback(mergeExternalState(base, { commands, presentations, stations }))
    const unsubs = [
      onSnapshot(this.stateRef(), (snapshot) => {
        if (snapshot.exists()) base = normalizeState(snapshot.data().state)
        emit()
      }, (error) => console.warn('Firestore state listener failed', error)),
      onSnapshot(collection(runtime.db, COMMANDS_COLLECTION), (snapshot) => {
        commands = snapshot.docs
          .map((snap) => normalizeCommand(snap.id, snap.data()))
          .filter(Boolean) as Command[]
        emit()
      }, (error) => console.warn('Firestore commands listener failed', error)),
      onSnapshot(collection(runtime.db, PRESENTATIONS_COLLECTION), (snapshot) => {
        presentations = snapshot.docs
          .map((snap) => normalizePresentation(snap.id, snap.data()))
          .filter(Boolean) as PresentationMeta[]
        emit()
      }, (error) => console.warn('Firestore presentations listener failed', error)),
      onSnapshot(collection(runtime.db, STATIONS_COLLECTION), (snapshot) => {
        stations = snapshot.docs.map((snap) => normalizeStation(snap.id, snap.data()))
        emit()
      }, (error) => console.warn('Firestore stations listener failed', error))
    ]

    return () => unsubs.forEach((unsub) => unsub())
  }
}

export async function publishFirebaseStatePatch(state: AppState): Promise<void> {
  if (!runtime) return
  await setDoc(doc(runtime.db, APP_STATE_COLLECTION, APP_STATE_DOC), {
      state: withoutUndefined(state),
      updatedAt: serverTimestamp()
    }, { merge: true })
}

export const firebaseRepository = runtime ? new FirebaseRepository() : null
