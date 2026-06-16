import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut, type Auth, type User } from 'firebase/auth'
import { collection, deleteDoc, doc, getDoc, getDocs, getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, onSnapshot, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore'
import type { AppRepository, AppState, Command, DefenseSession, PresentationMeta, QueueItem, Station, ProtocolSnapshot, Student } from '../shared/types'
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

  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  })
  return { app, db, auth: getAuth(app) }
}

const runtime = createFirebaseRuntime()
const APP_STATE_COLLECTION = 'dek_app'
const APP_STATE_DOC = 'state'
const COMMANDS_COLLECTION = 'dek_commands'
const PRESENTATIONS_COLLECTION = 'dek_presentations'
const STATIONS_COLLECTION = 'dek_stations'
const STUDENT_PAGES_COLLECTION = 'student_pages'
const MOBILE_DISPLAY_COLLECTION = 'mobile_display'
const MOBILE_PAGE_TTL_MS = 15 * 60 * 1000

export interface PublicStudentPage {
  token: string
  studentId: string
  sessionId: string
  fullName: string
  groupName: string
  thesisTitle: string
  queuePosition?: number
  registrationConfirmed: boolean
  defenseStatus: Student['defenseStatus']
  presentationStatus: Student['presentationStatus']
  wantsZoomDemo?: boolean
  problemDetails?: Student['problemDetails']
  expiresAt?: string
  updatedAt: string
}

export interface PublicMobileDisplay {
  sessionId: string
  enabled: boolean
  publicMessage: string
  zoomUrl: string
  currentlyDefending: Array<{ studentId: string; fullName: string; groupName: string; position: number }>
  nextDefending: Array<{ studentId: string; fullName: string; groupName: string; position: number }>
  updatedAt: string
}

export interface MobileCompanionSnapshot {
  studentPage: PublicStudentPage | null
  mobileDisplay: PublicMobileDisplay | null
}

function normalizeState(value: unknown): AppState {
  if (!value || typeof value !== 'object') return emptyState()
  const val = value as Record<string, unknown>
  return {
    ...emptyState(),
    sessions: Array.isArray(val.sessions) ? val.sessions : [],
    groups: Array.isArray(val.groups) ? val.groups : [],
    queue: Array.isArray(val.queue) ? val.queue : [],
    events: Array.isArray(val.events) ? val.events : [],
    students: Array.isArray(val.students) ? val.students : [],
    protocols: Array.isArray(val.protocols) ? val.protocols : [],
    importReviews: Array.isArray(val.importReviews) ? val.importReviews : []
  } as AppState
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

function clearedSessionCommandsTimestamps(state: AppState) {
  const keys = new Map<string, number>()
  for (const event of state.events) {
    if (event.type !== 'OLD_COMMANDS_CLEARED') continue
    const sessionId = event.payload?.sessionId
    const clearedAt = Date.parse(event.createdAt)
    if (typeof sessionId === 'string' && Number.isFinite(clearedAt)) {
      keys.set(sessionId, Math.max(keys.get(sessionId) || 0, clearedAt))
    }
  }
  return keys
}

function mergeStateForSave(remote: AppState, local: AppState): AppState {
  const deletedStudentIds = deletedIds(local, 'STUDENT_DELETED')
  const deletedSessionIds = deletedIds(local, 'SESSION_DELETED')
  const removedQueue = removedQueueTimestamps(local)
  const clearedCommandsMap = clearedSessionCommandsTimestamps(local)
  
  const keepSession = (sessionId?: string) => !sessionId || !deletedSessionIds.has(sessionId)
  const keepStudent = (studentId?: string) => !studentId || !deletedStudentIds.has(studentId)
  const keepQueueItem = (item: { sessionId: string; studentId: string; updatedAt?: string; createdAt?: string }) => {
    if (!keepSession(item.sessionId) || !keepStudent(item.studentId)) return false
    const removedAt = removedQueue.get(`${item.sessionId}:${item.studentId}`)
    if (!removedAt) return true
    const itemAt = Date.parse(item.updatedAt || item.createdAt || '')
    return Number.isFinite(itemAt) && itemAt > removedAt
  }
  const keepCommand = (item: { sessionId: string; studentId?: string; updatedAt?: string; createdAt?: string; status?: string }) => {
    if (!keepSession(item.sessionId) || !keepStudent(item.studentId)) return false
    const clearedAt = clearedCommandsMap.get(item.sessionId)
    if (!clearedAt) return true
    const itemAt = Date.parse(item.updatedAt || item.createdAt || '')
    return Number.isFinite(itemAt) && itemAt >= clearedAt
  }
  const keepPresentation = (item: { sessionId: string; studentId: string; uploadedAt?: string; updatedAt?: string; createdAt?: string }) => {
    if (!keepSession(item.sessionId) || !keepStudent(item.studentId)) return false
    const clearedAt = clearedCommandsMap.get(item.sessionId)
    if (!clearedAt) return true
    const itemAt = Date.parse(item.uploadedAt || item.updatedAt || item.createdAt || '')
    return Number.isFinite(itemAt) && itemAt >= clearedAt
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
    presentations: mergePreferNewest(remote.presentations, local.presentations).filter(keepPresentation),
    queue: mergePreferNewest(remote.queue, local.queue).filter(keepQueueItem),
    commands: mergePreferNewest(remote.commands, local.commands).filter(keepCommand),
    stations: mergePreferNewest(remote.stations, local.stations),
    protocols: mergePreferNewest(remote.protocols, local.protocols).filter((item) => keepSession(item.sessionId)),
    importReviews: mergePreferNewest(remote.importReviews, local.importReviews).filter((item) => keepSession(item.sessionId)),
    events: mergePreferNewest(remote.events, local.events).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 100)
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
  const lastHeartbeat = toIso(value.lastHeartbeat || value.updatedAt)
  const isHeartbeatRecent = Date.now() - Date.parse(lastHeartbeat) < 5 * 60 * 1000
  return {
    id: String(value.id || value.stationId || id),
    name: String(value.name || 'Defense station'),
    activeSessionId: value.activeSessionId ? String(value.activeSessionId) : undefined,
    online: value.online === true && isHeartbeatRecent,
    localUploadUrl: value.localUploadUrl ? String(value.localUploadUrl) : undefined,
    lanUploadUrl: value.lanUploadUrl ? String(value.lanUploadUrl) : undefined,
    currentStudentId: value.currentStudentId ? String(value.currentStudentId) : undefined,
    lastHeartbeat
  }
}

function mergeExternalState(base: AppState, external: Partial<AppState>): AppState {
  const sessionIds = new Set(base.sessions.map((session) => session.id))
  const commands = (external.commands || []).filter((command) => sessionIds.has(command.sessionId))
  const presentations = (external.presentations || []).filter((presentation) => sessionIds.has(presentation.sessionId))

  // For students and queue: prefer the version with the newer updatedAt timestamp
  // This prevents old Firebase data from overwriting freshly saved local state
  const mergedStudents = external.students
    ? mergePreferNewest(base.students, external.students)
    : base.students

  // Merge queue by updatedAt if queue is available in external (from dek_app/state snapshot)
  const externalQueue = (external as any).queue as typeof base.queue | undefined
  const finalQueue = externalQueue
    ? mergePreferNewest(base.queue, externalQueue)
    : base.queue

  return {
    ...base,
    commands: mergeById(base.commands, commands),
    presentations: mergeById(base.presentations, presentations),
    stations: mergeById(base.stations, external.stations || []),
    students: mergedStudents,
    queue: finalQueue,
    protocols: external.protocols ? mergePreferNewest(base.protocols, external.protocols) : base.protocols
  }
}

function publicQueueItems(state: AppState, session: DefenseSession) {
  const studentById = new Map(state.students.map((student) => [student.id, student]))
  return state.queue
    .filter((item) => item.sessionId === session.id)
    .sort((a, b) => a.position - b.position)
    .map((item) => ({ queue: item, student: studentById.get(item.studentId) }))
    .filter((item): item is { queue: QueueItem; student: Student } => {
      const student = item.student
      if (!student) return false
      return student.defenseStatus !== 'defended' &&
        student.defenseStatus !== 'absent' &&
        student.defenseStatus !== 'problem'
    })
}

function addMs(iso: string | undefined, ms: number): string | undefined {
  const base = Date.parse(iso || '')
  if (!Number.isFinite(base)) return undefined
  return new Date(base + ms).toISOString()
}

function getStudentPageExpiresAt(student: Student): string | undefined {
  if (student.defenseStatus !== 'defended') return undefined
  return student.mobilePageExpiresAt || addMs(student.updatedAt, MOBILE_PAGE_TTL_MS)
}

function isStudentPageExpired(student: Student, nowMs = Date.now()): boolean {
  const expiresAt = getStudentPageExpiresAt(student)
  if (!expiresAt) return false
  const expiresMs = Date.parse(expiresAt)
  return Number.isFinite(expiresMs) && expiresMs <= nowMs
}

function buildPublicStudentPage(student: Student, queueItem?: QueueItem): PublicStudentPage | null {
  if (isStudentPageExpired(student)) return null
  const token = student.token || student.id
  return {
    token,
    studentId: student.id,
    sessionId: student.sessionId,
    fullName: student.fullName,
    groupName: student.groupName,
    thesisTitle: student.thesisTitleEdited,
    queuePosition: queueItem?.position || student.queuePosition,
    registrationConfirmed: student.registrationConfirmed === true,
    defenseStatus: student.defenseStatus,
    presentationStatus: student.presentationStatus,
    wantsZoomDemo: student.wantsZoomDemo === true,
    problemDetails: student.problemDetails,
    expiresAt: getStudentPageExpiresAt(student),
    updatedAt: student.updatedAt || new Date().toISOString()
  }
}

function buildPublicMobileDisplay(state: AppState, session: DefenseSession): PublicMobileDisplay {
  const settings = session.mobileDisplaySettings || {
    enabled: true,
    currentlyDefendingCount: 5,
    nextDefendingCount: 7,
    publicMessage: ''
  }
  const queue = publicQueueItems(state, session)
  const toPublic = (item: { queue: QueueItem; student: Student }) => ({
    studentId: item.student.id,
    fullName: item.student.fullName,
    groupName: item.student.groupName,
    position: item.queue.position
  })
  return {
    sessionId: session.id,
    enabled: settings.enabled !== false && session.isRegistrationLocked === true,
    publicMessage: settings.publicMessage || '',
    zoomUrl: session.zoomUrl || '',
    currentlyDefending: queue.slice(0, settings.currentlyDefendingCount || 5).map(toPublic),
    nextDefending: queue
      .slice(settings.currentlyDefendingCount || 5, (settings.currentlyDefendingCount || 5) + (settings.nextDefendingCount || 7))
      .map(toPublic),
    updatedAt: session.updatedAt || new Date().toISOString()
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
    let remoteState: AppState | undefined;
    try {
      const snapshot = await getDoc(this.stateRef())
      if (snapshot.exists()) {
        remoteState = normalizeState(snapshot.data().state)
        stateToSave = mergeStateForSave(remoteState, state)
      }
    } catch (error) {
      console.warn('Firestore pre-save merge failed, saving local state', error)
    }

    const cleanState = withoutUndefined({
      ...stateToSave,
      commands: [],
      presentations: [],
      events: (stateToSave.events || []).slice(0, 50)
    })
    await setDoc(this.stateRef(), {
      state: cleanState,
      updatedAt: serverTimestamp()
    }, { merge: true })

    const batches = [writeBatch(runtime.db)]
    let currentBatchWrites = 0
    let hasWrites = false
    const getBatch = () => {
      if (currentBatchWrites >= 450) {
        batches.push(writeBatch(runtime!.db))
        currentBatchWrites = 0
      }
      currentBatchWrites++
      hasWrites = true
      return batches[batches.length - 1]
    }

    const commandsToDelete = remoteState ? remoteState.commands.filter(c => !stateToSave.commands.find(s => s.id === c.id)) : []
    for (const command of commandsToDelete) {
      getBatch().delete(doc(runtime.db, COMMANDS_COLLECTION, command.id))
    }

    for (const command of stateToSave.commands) {
      const payload = withoutUndefined({ ...command, errorMessage: command.error })
      if (remoteState) {
        const remoteCmd = remoteState.commands.find(c => c.id === command.id)
        if (remoteCmd && JSON.stringify(withoutUndefined({ ...remoteCmd, errorMessage: remoteCmd.error })) === JSON.stringify(payload)) continue
      }
      getBatch().set(doc(runtime.db, COMMANDS_COLLECTION, command.id), payload, { merge: true })
    }

    const presentationsToDelete = remoteState ? remoteState.presentations.filter(c => !stateToSave.presentations.find(s => s.id === c.id)) : []
    for (const presentation of presentationsToDelete) {
      getBatch().delete(doc(runtime.db, PRESENTATIONS_COLLECTION, presentation.id))
    }

    for (const presentation of stateToSave.presentations) {
      if (remoteState) {
        const remotePresentation = remoteState.presentations.find(c => c.id === presentation.id)
        if (remotePresentation && JSON.stringify(withoutUndefined(remotePresentation)) === JSON.stringify(withoutUndefined(presentation))) continue
      }
      getBatch().set(doc(runtime.db, PRESENTATIONS_COLLECTION, presentation.id), withoutUndefined(presentation), { merge: true })
    }

    const deletedStudentIds = deletedIds(stateToSave, 'STUDENT_DELETED')
    for (const id of deletedStudentIds) {
      getBatch().delete(doc(runtime.db, 'dek_students', id))
    }
    for (const student of stateToSave.students) {
      if (remoteState) {
        const remoteStudent = remoteState.students.find(c => c.id === student.id)
        if (remoteStudent && JSON.stringify(withoutUndefined(remoteStudent)) === JSON.stringify(withoutUndefined(student))) continue
      }
      getBatch().set(doc(runtime.db, 'dek_students', student.id), withoutUndefined(student), { merge: true })
    }

    const protocolsToDelete = remoteState ? remoteState.protocols.filter(c => !stateToSave.protocols.find(s => s.id === c.id)) : []
    for (const protocol of protocolsToDelete) {
      getBatch().delete(doc(runtime.db, 'dek_protocols', protocol.id))
    }
    for (const protocol of stateToSave.protocols) {
      if (remoteState) {
        const remoteProtocol = remoteState.protocols.find(c => c.id === protocol.id)
        if (remoteProtocol && JSON.stringify(withoutUndefined(remoteProtocol)) === JSON.stringify(withoutUndefined(protocol))) continue
      }
      getBatch().set(doc(runtime.db, 'dek_protocols', protocol.id), withoutUndefined(protocol), { merge: true })
    }

    const queueByStudent = new Map(stateToSave.queue.map((item) => [item.studentId, item]))
    const remoteQueueByStudent = new Map(remoteState?.queue.map((item) => [item.studentId, item]) || [])
    
    for (const student of stateToSave.students) {
      const token = student.token || student.id
      if (isStudentPageExpired(student)) {
        if (!remoteState || remoteState.students.find(s => s.id === student.id && !isStudentPageExpired(s))) {
          getBatch().delete(doc(runtime.db, STUDENT_PAGES_COLLECTION, token))
        }
        continue
      }
      const page = buildPublicStudentPage(student, queueByStudent.get(student.id))
      if (!page) continue
      const payload = withoutUndefined(page)
      if (remoteState) {
        const remoteStudent = remoteState.students.find(s => s.id === student.id)
        if (remoteStudent) {
          const remotePage = buildPublicStudentPage(remoteStudent, remoteQueueByStudent.get(student.id))
          if (remotePage && JSON.stringify(withoutUndefined(remotePage)) === JSON.stringify(payload)) continue
        }
      }
      getBatch().set(doc(runtime.db, STUDENT_PAGES_COLLECTION, page.token), payload, { merge: true })
    }

    for (const session of stateToSave.sessions) {
      const payload = withoutUndefined(buildPublicMobileDisplay(stateToSave, session))
      if (remoteState) {
        const remoteSession = remoteState.sessions.find(s => s.id === session.id)
        if (remoteSession && JSON.stringify(withoutUndefined(buildPublicMobileDisplay(remoteState, remoteSession))) === JSON.stringify(payload)) continue
      }
      getBatch().set(doc(runtime.db, MOBILE_DISPLAY_COLLECTION, session.id), payload, { merge: true })
    }

    if (!hasWrites) return;

    for (const b of batches) {
      await b.commit().catch((error) => {
        console.warn('Firestore agent mirror write failed for batch', error)
      })
    }
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
    const [commandsSnap, presentationsSnap, stationsSnap, studentsSnap, protocolsSnap] = await Promise.all([
      safeGetDocs(COMMANDS_COLLECTION),
      safeGetDocs(PRESENTATIONS_COLLECTION),
      safeGetDocs(STATIONS_COLLECTION),
      safeGetDocs('dek_students'),
      safeGetDocs('dek_protocols')
    ])

    return {
      commands: (commandsSnap?.docs || [])
        .map((snap) => normalizeCommand(snap.id, snap.data()))
        .filter(Boolean) as Command[],
      presentations: (presentationsSnap?.docs || [])
        .map((snap) => normalizePresentation(snap.id, snap.data()))
        .filter(Boolean) as PresentationMeta[],
      stations: (stationsSnap?.docs || []).map((snap) => normalizeStation(snap.id, snap.data())),
      students: (studentsSnap?.docs || []).map((snap) => snap.data() as Student),
      protocols: (protocolsSnap?.docs || []).map((snap) => snap.data() as ProtocolSnapshot)
    }
  }

  subscribe(callback: (state: AppState) => void): () => void {
    if (!runtime) return () => undefined

    let base = emptyState()
    let commands: Command[] = []
    let presentations: PresentationMeta[] = []
    let stations: Station[] = []
    let students: Student[] = []
    let protocols: ProtocolSnapshot[] = []

    const emit = () => callback(mergeExternalState(base, { commands, presentations, stations, students, protocols }))
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
      }, (error) => console.warn('Firestore stations listener failed', error)),
      onSnapshot(collection(runtime.db, 'dek_students'), (snapshot) => {
        students = snapshot.docs.map((snap) => snap.data() as Student)
        emit()
      }, (error) => console.warn('Firestore students listener failed', error)),
      onSnapshot(collection(runtime.db, 'dek_protocols'), (snapshot) => {
        protocols = snapshot.docs.map((snap) => snap.data() as ProtocolSnapshot)
        emit()
      }, (error) => console.warn('Firestore protocols listener failed', error))
    ]

    return () => unsubs.forEach((unsub) => unsub())
  }
}

export async function publishFirebaseStatePatch(state: AppState): Promise<void> {
  if (!runtime) return
  const { commands, presentations, stations, ...coreState } = state
  await setDoc(doc(runtime.db, APP_STATE_COLLECTION, APP_STATE_DOC), {
      state: withoutUndefined({
        ...coreState,
        commands: [],
        presentations: [],
        events: (coreState.events || []).slice(0, 50)
      }),
      updatedAt: serverTimestamp()
    }, { merge: true })
}

function normalizePublicStudentPage(value: unknown): PublicStudentPage | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (!data.token || !data.studentId || !data.sessionId) return null
  return {
    token: String(data.token),
    studentId: String(data.studentId),
    sessionId: String(data.sessionId),
    fullName: String(data.fullName || ''),
    groupName: String(data.groupName || ''),
    thesisTitle: String(data.thesisTitle || ''),
    queuePosition: data.queuePosition ? Number(data.queuePosition) : undefined,
    registrationConfirmed: data.registrationConfirmed === true,
    defenseStatus: (data.defenseStatus as Student['defenseStatus']) || 'waiting',
    presentationStatus: (data.presentationStatus as Student['presentationStatus']) || 'missing',
    wantsZoomDemo: data.wantsZoomDemo === true,
    problemDetails: data.problemDetails as Student['problemDetails'],
    expiresAt: data.expiresAt ? toIso(data.expiresAt) : undefined,
    updatedAt: toIso(data.updatedAt)
  }
}

function normalizePublicMobileDisplay(value: unknown): PublicMobileDisplay | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (!data.sessionId) return null
  const normalizeRows = (rows: unknown) => Array.isArray(rows)
    ? rows.map((row) => {
      const item = row as Record<string, unknown>
      return {
        studentId: String(item.studentId || ''),
        fullName: String(item.fullName || ''),
        groupName: String(item.groupName || ''),
        position: Number(item.position || 0)
      }
    }).filter((row) => row.studentId)
    : []
  return {
    sessionId: String(data.sessionId),
    enabled: data.enabled !== false,
    publicMessage: String(data.publicMessage || ''),
    zoomUrl: String(data.zoomUrl || ''),
    currentlyDefending: normalizeRows(data.currentlyDefending),
    nextDefending: normalizeRows(data.nextDefending),
    updatedAt: toIso(data.updatedAt)
  }
}

export function subscribeMobileCompanion(token: string, callback: (snapshot: MobileCompanionSnapshot) => void): () => void {
  if (!runtime || !token) {
    window.setTimeout(() => callback({ studentPage: null, mobileDisplay: null }), 0)
    return () => undefined
  }
  let studentPage: PublicStudentPage | null = null
  let mobileDisplay: PublicMobileDisplay | null = null
  let displayUnsub: (() => void) | undefined
  const emit = () => callback({ studentPage, mobileDisplay })

  const studentUnsub = onSnapshot(doc(runtime.db, STUDENT_PAGES_COLLECTION, token), (snapshot) => {
    studentPage = snapshot.exists() ? normalizePublicStudentPage(snapshot.data()) : null
    displayUnsub?.()
    displayUnsub = undefined
    if (studentPage?.sessionId) {
      displayUnsub = onSnapshot(doc(runtime.db, MOBILE_DISPLAY_COLLECTION, studentPage.sessionId), (displaySnap) => {
        mobileDisplay = displaySnap.exists() ? normalizePublicMobileDisplay(displaySnap.data()) : null
        emit()
      }, (error) => {
        console.warn('Mobile display listener failed', error)
        mobileDisplay = null
        emit()
      })
    } else {
      mobileDisplay = null
    }
    emit()
  }, (error) => {
    console.warn('Student page listener failed', error)
    studentPage = null
    mobileDisplay = null
    emit()
  })

  return () => {
    studentUnsub()
    displayUnsub?.()
  }
}

export async function confirmMobileRegistration(token: string): Promise<void> {
  if (!runtime || !token) return
  const pageRef = doc(runtime.db, STUDENT_PAGES_COLLECTION, token)
  const pageSnap = await getDoc(pageRef)
  if (!pageSnap.exists()) return
  const page = normalizePublicStudentPage(pageSnap.data())
  if (!page || page.registrationConfirmed) return

  await setDoc(pageRef, {
    registrationConfirmed: true,
    updatedAt: serverTimestamp()
  }, { merge: true })

  const stateRef = doc(runtime.db, APP_STATE_COLLECTION, APP_STATE_DOC)
  const stateSnap = await getDoc(stateRef)
  if (!stateSnap.exists() || !stateSnap.data()?.state) return
  const state = normalizeState(stateSnap.data().state)
  const next: AppState = {
    ...state,
    students: state.students.map((student) => student.token === token || student.id === page.studentId
      ? { ...student, registrationConfirmed: true, updatedAt: new Date().toISOString() }
      : student)
  }
  await setDoc(stateRef, {
    state: withoutUndefined(next),
    updatedAt: serverTimestamp()
  }, { merge: true })
}

export async function expireMobileStudentPage(token: string): Promise<void> {
  if (!runtime || !token) return
  await deleteDoc(doc(runtime.db, STUDENT_PAGES_COLLECTION, token))
}

export const firebaseRepository = runtime ? new FirebaseRepository() : null
