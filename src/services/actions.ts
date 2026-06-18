import type {
  AppState,
  Command,
  DefenseSession,
  DefenseStatus,
  EventLogItem,
  Group,
  ImportReview,
  PresentationMeta,
  ProtocolSnapshot,
  QueueItem,
  Student
} from '../shared/types'
import { extOf, isAllowedPresentationExt, normalizeText, nowIso, sanitizeFilePart, uid } from '../shared/utils'
import { getBlob, saveBlob } from './localRepository'

const MOBILE_PAGE_TTL_MS = 15 * 60 * 1000

function mobilePageExpiresAt(fromIso = nowIso()) {
  const base = Date.parse(fromIso)
  return new Date((Number.isFinite(base) ? base : Date.now()) + MOBILE_PAGE_TTL_MS).toISOString()
}

function applyStudentPatch(student: Student, patch: Partial<Student>): Student {
  const now = nowIso()
  const next: Student = { ...student, ...patch, updatedAt: now }
  if (patch.defenseStatus === 'defended' && !patch.mobilePageExpiresAt && !student.mobilePageExpiresAt) {
    next.mobilePageExpiresAt = mobilePageExpiresAt(now)
  }
  if (patch.defenseStatus && patch.defenseStatus !== 'defended') {
    next.mobilePageExpiresAt = undefined
  }
  return next
}

export function addEvent(state: AppState, event: Omit<EventLogItem, 'id' | 'createdAt'>): AppState {
  return {
    ...state,
    events: [{ id: uid('event'), createdAt: nowIso(), ...event }, ...state.events].slice(0, 100)
  }
}

function targetStationId(state: AppState, session?: DefenseSession): string {
  const now = Date.now()
  const recentStations = state.stations
    .filter((station) => {
      const heartbeat = Date.parse(station.lastHeartbeat || '')
      return station.online && Number.isFinite(heartbeat) && now - heartbeat < 45_000
    })
    .sort((a, b) => Date.parse(b.lastHeartbeat || '') - Date.parse(a.lastHeartbeat || ''))
  const sessionStation = recentStations.find((station) => station.id === session?.stationId)
  if (sessionStation?.id) return sessionStation.id
  if (recentStations[0]?.id) return recentStations[0].id
  if (session?.stationId && session.stationId !== 'station_local_demo') return session.stationId
  const newestStation = [...state.stations].sort((a, b) => Date.parse(b.lastHeartbeat || '') - Date.parse(a.lastHeartbeat || ''))[0]
  return newestStation?.id || 'station_local_demo'
}

function isSessionClosed(state: AppState, sessionId: string): boolean {
  return state.sessions.find((session) => session.id === sessionId)?.isClosed === true
}

function isFinalDefenseStatus(status: DefenseStatus): boolean {
  return status === 'defended' || status === 'problem' || status === 'absent'
}

type StudentRosterFields = Student & {
  rosterKey?: string
  centralStudentId?: string
  recoverySource?: string
}

function rosterKeyForStudent(student: Student): string {
  const extra = student as StudentRosterFields
  if (extra.rosterKey) return extra.rosterKey
  if (extra.centralStudentId) return extra.centralStudentId
  return normalizeText(`${student.groupName || ''} ${student.fullName || ''}`).toLocaleLowerCase('uk-UA')
}

function compactLetters(value: string | undefined): string {
  return normalizeText(value || '')
    .toLocaleLowerCase('uk-UA')
    .replace(/[’'`ьъ\s\-().]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function compactGroup(value: string | undefined): string {
  return normalizeText(value || '')
    .toLocaleLowerCase('uk-UA')
    .replace(/\s+/g, '')
    .replace(/-/g, '')
}

function nameWords(value: string | undefined): string[] {
  return normalizeText(value || '')
    .toLocaleLowerCase('uk-UA')
    .replace(/[().]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function diceCoefficient(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  const grams = (value: string) => {
    const map = new Map<string, number>()
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2)
      map.set(gram, (map.get(gram) || 0) + 1)
    }
    return map
  }
  const leftGrams = grams(left)
  const rightGrams = grams(right)
  let overlap = 0
  let total = 0
  for (const count of leftGrams.values()) total += count
  for (const count of rightGrams.values()) total += count
  for (const [gram, count] of leftGrams) overlap += Math.min(count, rightGrams.get(gram) || 0)
  return total ? (2 * overlap) / total : 0
}

function recoveredMatchScore(recovered: Student, source: Student): { value: number; sameGroup: boolean; surname: boolean; firstName: boolean } {
  const sameGroup = compactGroup(recovered.groupName) === compactGroup(source.groupName)
  const recoveredName = compactLetters(recovered.fullName)
  const sourceName = compactLetters(source.fullName)
  const recoveredWords = nameWords(recovered.fullName)
  const sourceWords = nameWords(source.fullName)
  const surname = !!recoveredWords[0] && !!sourceWords[0] && compactLetters(recoveredWords[0]) === compactLetters(sourceWords[0])
  const firstName = !!recoveredWords[1] && !!sourceWords[1] && compactLetters(recoveredWords[1]) === compactLetters(sourceWords[1])
  let value = diceCoefficient(recoveredName, sourceName)
  if (sameGroup) value += 0.25
  if (surname) value += 0.2
  if (firstName) value += 0.15
  if (recoveredName && sourceName && (recoveredName.includes(sourceName) || sourceName.includes(recoveredName))) value += 0.15
  return { value, sameGroup, surname, firstName }
}

function inferredFinalRosterKey(student: Student, sourceStudents: Student[]): string {
  if (!sourceStudents.length || !isRecoveredHistoricalStudent(student)) return rosterKeyForStudent(student)
  const ranked = sourceStudents
    .map((source) => ({ source, ...recoveredMatchScore(student, source) }))
    .sort((left, right) => right.value - left.value)
  const best = ranked[0]
  const second = ranked[1]
  const confident = best && best.value >= 0.82 && (
    best.value - (second?.value || 0) >= 0.08 ||
    (best.sameGroup && best.surname && best.firstName)
  )
  return confident ? rosterKeyForStudent(best.source) : rosterKeyForStudent(student)
}

function isRecoveredHistoricalStudent(student: Student): boolean {
  const extra = student as StudentRosterFields
  return typeof extra.recoverySource === 'string' && extra.recoverySource.length > 0
}

export function getAvailableStudentsForNewDate(state: AppState, blockedStudentIds = new Set<string>(), sourceSessionId?: string): Student[] {
  const sourceStudents = sourceSessionId
    ? state.students.filter((student) => student.sessionId === sourceSessionId && !isRecoveredHistoricalStudent(student))
    : []
  const candidateStudents = sourceStudents.length
    ? sourceStudents
    : state.students.filter((student) => !isRecoveredHistoricalStudent(student))
  const blockedRosterKeys = new Set(
    state.students
      .filter((student) => blockedStudentIds.has(student.id))
      .map(rosterKeyForStudent)
  )
  const finalRosterKeys = new Set(
    state.students
      .filter((student) => isFinalDefenseStatus(student.defenseStatus))
      .map((student) => inferredFinalRosterKey(student, sourceStudents))
  )
  const byRosterKey = new Map<string, Student>()
  for (const student of candidateStudents) {
    const key = rosterKeyForStudent(student)
    if (!key || blockedRosterKeys.has(key) || finalRosterKeys.has(key)) continue
    if (isRecoveredHistoricalStudent(student)) continue
    if (!byRosterKey.has(key)) byRosterKey.set(key, student)
  }
  return Array.from(byRosterKey.values())
}

function collectAvailableStudentsForNewDate(state: AppState, blockedStudentIds = new Set<string>(), sourceSessionId?: string): Student[] {
  return getAvailableStudentsForNewDate(state, blockedStudentIds, sourceSessionId)
}

function createSessionGroupsForStudents(state: AppState, sessionId: string, groupNames: string[]): { groups: Group[]; groupMap: Map<string, Group> } {
  const groupMap = new Map<string, Group>()
  const groups = [...state.groups]
  for (const groupName of groupNames) {
    const sourceGroup = [...state.groups].reverse().find((group) => group.name === groupName)
    const group: Group = {
      id: uid('group'),
      sessionId,
      name: groupName,
      specialtyCode: sourceGroup?.specialtyCode,
      specialtyName: sourceGroup?.specialtyName,
      educationProgram: sourceGroup?.educationProgram,
      studyForm: sourceGroup?.studyForm
    }
    groupMap.set(groupName, group)
    groups.push(group)
  }
  return { groups, groupMap }
}

function resetStudentForNewSession(student: Student, sessionId: string, groupId: string | undefined, now: string): Student {
  return {
    ...student,
    token: uid('token'),
    registrationConfirmed: false,
    sessionId,
    groupId: groupId || student.groupId,
    registrationStatus: 'not_registered',
    presentationStatus: 'missing',
    defenseStatus: 'waiting',
    registeredAt: undefined,
    queuePosition: undefined,
    wantsZoomDemo: false,
    hasVideo: false,
    mobilePageExpiresAt: undefined,
    updatedAt: now
  }
}

export function getOnlineUploadUrl(state: AppState): string | undefined {
  const station = state.stations.find((item) => item.online && (item.lanUploadUrl || item.localUploadUrl)) || state.stations.find((item) => item.lanUploadUrl || item.localUploadUrl)
  return (station?.lanUploadUrl || station?.localUploadUrl)?.replace(/\/+$/, '')
}

export function getAgentUploadPageUrl(state: AppState, student: Student): string | undefined {
  const uploadUrl = getOnlineUploadUrl(state)
  if (!uploadUrl || typeof window === 'undefined') return undefined
  const session = state.sessions.find((item) => item.id === student.sessionId)
  try {
    const url = new URL(`${uploadUrl}/upload-page`)
    url.searchParams.set('sessionId', student.sessionId)
    url.searchParams.set('studentId', student.id)
    url.searchParams.set('studentName', student.fullName)
    url.searchParams.set('returnUrl', window.location.href)
    if (session?.zoomUrl) url.searchParams.set('zoomUrl', session.zoomUrl)
    if (student.wantsZoomDemo) url.searchParams.set('wantsZoomDemo', '1')
    return url.toString()
  } catch {
    return undefined
  }
}

export function createSession(state: AppState, input: Partial<DefenseSession>): AppState {
  const now = nowIso()
  const blockedStudentIds = new Set(state.queue.filter((item) => item.sessionId === state.activeSessionId).map((item) => item.studentId))
  const availableStudents = collectAvailableStudentsForNewDate(state, blockedStudentIds)
  const groupNames = input.groupNames?.length
    ? input.groupNames
    : Array.from(new Set(availableStudents.map((student) => student.groupName).filter(Boolean)))
  const session: DefenseSession = {
    id: uid('session'),
    title: input.title || 'Захист',
    date: input.date || new Date().toISOString().slice(0, 10),
    groupNames,
    registrationOpenFrom: input.registrationOpenFrom || '08:00',
    registrationOpenTo: input.registrationOpenTo || '09:00',
    defenseStartsAt: input.defenseStartsAt || '09:05',
    zoomUrl: input.zoomUrl || '',
    manualRegistrationOpen: false,
    isRegistrationLocked: false,
    publicToken: uid('pub'),
    stationId: input.stationId || state.stations.find((station) => station.online)?.id || state.stations[0]?.id || 'station_local_demo',
    createdAt: now,
    updatedAt: now
  }
  const { groups, groupMap } = createSessionGroupsForStudents(state, session.id, groupNames)
  const movedStudentIds = new Set(availableStudents.map((student) => student.id))
  const students = movedStudentIds.size
    ? state.students.map((student) => {
      if (!movedStudentIds.has(student.id)) return student
      const group = groupMap.get(student.groupName)
      return resetStudentForNewSession(student, session.id, group?.id, now)
    })
    : state.students

  return addEvent({ ...state, activeSessionId: session.id, sessions: [session, ...state.sessions], groups, students }, {
    sessionId: session.id,
    type: 'SESSION_CREATED',
    actor: 'admin',
    message: availableStudents.length
      ? `Створено сесію ${session.title}: додано незахищених студентів (${availableStudents.length})`
      : `Створено сесію ${session.title}`,
    payload: { sessionId: session.id, carriedStudentCount: availableStudents.length }
  })
}

export function updateSession(state: AppState, sessionId: string, patch: Partial<DefenseSession>): AppState {
  const session = state.sessions.find((s) => s.id === sessionId)
  if (!session) return state
  const next = {
    ...state,
    sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch, id: s.id, updatedAt: nowIso() } : s))
  }
  return addEvent(next, {
    sessionId,
    type: 'SESSION_UPDATED',
    actor: 'admin',
    message: `Оновлено сесію ${patch.title || session.title}`,
    payload: { sessionId, patch }
  })
}

export function createContinuationSession(state: AppState, sourceSessionId: string, input: Partial<DefenseSession>): AppState {
  const sourceSession = state.sessions.find((session) => session.id === sourceSessionId)
  if (!sourceSession) return state
  const now = nowIso()
  const blockedStudentIds = new Set(state.queue.filter((item) => item.sessionId === sourceSessionId).map((item) => item.studentId))
  const remainingStudents = collectAvailableStudentsForNewDate(state, blockedStudentIds, sourceSessionId)
  const groupNames = Array.from(new Set(remainingStudents.map((student) => student.groupName).filter(Boolean)))
  const session: DefenseSession = {
    id: uid('session'),
    title: input.title || sourceSession.title || 'Захист',
    date: input.date || new Date().toISOString().slice(0, 10),
    groupNames,
    registrationOpenFrom: input.registrationOpenFrom || sourceSession.registrationOpenFrom || '08:00',
    registrationOpenTo: input.registrationOpenTo || sourceSession.registrationOpenTo || '09:00',
    defenseStartsAt: input.defenseStartsAt || sourceSession.defenseStartsAt || '09:05',
    zoomUrl: input.zoomUrl ?? sourceSession.zoomUrl ?? '',
    manualRegistrationOpen: false,
    isRegistrationLocked: false,
    publicToken: uid('pub'),
    stationId: input.stationId || sourceSession.stationId || state.stations.find((station) => station.online)?.id || state.stations[0]?.id || 'station_local_demo',
    createdAt: now,
    updatedAt: now
  }

  const { groups, groupMap } = createSessionGroupsForStudents(state, session.id, groupNames)

  const movedStudentIds = new Set(remainingStudents.map((student) => student.id))
  const students: Student[] = state.students.map((student) => {
    if (!movedStudentIds.has(student.id)) return student
    const group = groupMap.get(student.groupName)
    return resetStudentForNewSession(student, session.id, group?.id, now)
  })

  return addEvent({
    ...state,
    activeSessionId: session.id,
    sessions: [session, ...state.sessions],
    groups,
    students
  }, {
    sessionId: session.id,
    type: 'SESSION_CREATED',
    actor: 'admin',
    message: `Створено наступну сесію з незахищених: ${remainingStudents.length} студентів`,
    payload: { sourceSessionId, sessionId: session.id, count: remainingStudents.length }
  })
}

export function populateSessionWithAvailableStudents(state: AppState, sessionId: string, sourceSessionId?: string): AppState {
  const session = state.sessions.find((item) => item.id === sessionId)
  if (!session || session.isClosed) return state
  const now = nowIso()
  const blockedStudentIds = sourceSessionId && sourceSessionId !== sessionId
    ? new Set(state.queue.filter((item) => item.sessionId === sourceSessionId).map((item) => item.studentId))
    : new Set<string>()
  const availableStudents = collectAvailableStudentsForNewDate(state, blockedStudentIds, sourceSessionId)
  const studentsToMove = availableStudents.filter((student) => student.sessionId !== sessionId)
  if (!studentsToMove.length) return state

  const nextGroupNames = Array.from(new Set([
    ...session.groupNames,
    ...studentsToMove.map((student) => student.groupName).filter(Boolean)
  ]))
  const existingSessionGroups = state.groups.filter((group) => group.sessionId === sessionId)
  const existingGroupNames = new Set(existingSessionGroups.map((group) => group.name))
  const missingGroupNames = nextGroupNames.filter((groupName) => !existingGroupNames.has(groupName))
  const { groups: groupsWithNew, groupMap: newGroupMap } = createSessionGroupsForStudents(state, sessionId, missingGroupNames)
  const groupMap = new Map<string, Group>()
  for (const group of groupsWithNew.filter((item) => item.sessionId === sessionId)) groupMap.set(group.name, group)
  for (const [groupName, group] of newGroupMap) groupMap.set(groupName, group)

  const movedStudentIds = new Set(studentsToMove.map((student) => student.id))
  const students = state.students.map((student) => {
    if (!movedStudentIds.has(student.id)) return student
    const group = groupMap.get(student.groupName)
    return resetStudentForNewSession(student, sessionId, group?.id, now)
  })

  return addEvent({
    ...state,
    activeSessionId: sessionId,
    sessions: state.sessions.map((item) => item.id === sessionId ? { ...item, groupNames: nextGroupNames, updatedAt: now } : item),
    groups: groupsWithNew,
    students
  }, {
    sessionId,
    type: 'SESSION_UPDATED',
    actor: 'admin',
    message: `Підтягнуто незахищених студентів у сесію: ${studentsToMove.length}`,
    payload: { sessionId, sourceSessionId, count: studentsToMove.length }
  })
}

export function removeSession(state: AppState, sessionId: string): AppState {
  const session = state.sessions.find((s) => s.id === sessionId)
  if (!session) return state
  const remainingSessions = state.sessions.filter((s) => s.id !== sessionId)
  const nextActiveSessionId = state.activeSessionId === sessionId ? remainingSessions[0]?.id : state.activeSessionId
  return addEvent({
    ...state,
    activeSessionId: nextActiveSessionId,
    sessions: remainingSessions,
    groups: state.groups.filter((g) => g.sessionId !== sessionId),
    students: state.students.filter((s) => s.sessionId !== sessionId),
    presentations: state.presentations.filter((p) => p.sessionId !== sessionId),
    queue: state.queue.filter((q) => q.sessionId !== sessionId),
    commands: state.commands.filter((c) => c.sessionId !== sessionId),
    protocols: state.protocols.filter((p) => p.sessionId !== sessionId),
    importReviews: state.importReviews.filter((r) => r.sessionId !== sessionId)
  }, {
    sessionId,
    type: 'SESSION_DELETED',
    actor: 'admin',
    message: `Видалено сесію ${session.title}`,
    payload: { sessionId }
  })
}

export function reorderSession(state: AppState, sessionId: string, direction: -1 | 1): AppState {
  const currentSorted = [...state.sessions].sort((a, b) => (a.sortOrder ?? state.sessions.indexOf(a)) - (b.sortOrder ?? state.sessions.indexOf(b)))
  const idx = currentSorted.findIndex((s) => s.id === sessionId)
  if (idx < 0) return state
  const swapIdx = idx + direction
  if (swapIdx < 0 || swapIdx >= currentSorted.length) return state
  
  const temp = currentSorted[idx]
  currentSorted[idx] = currentSorted[swapIdx]
  currentSorted[swapIdx] = temp

  const now = nowIso()
  const updatedSessions = state.sessions.map((s) => {
    const newIdx = currentSorted.findIndex((x) => x.id === s.id)
    if (s.sortOrder !== newIdx) {
      return { ...s, sortOrder: newIdx, updatedAt: now }
    }
    return s
  })

  return addEvent({ ...state, sessions: updatedSessions }, {
    sessionId,
    type: 'SESSION_UPDATED',
    actor: 'admin',
    message: 'Змінено порядок сесій'
  })
}

function activeCommandStatuses(status: Command['status']) {
  return status === 'pending' || status === 'running'
}

function commandDedupeKey(command: Command): string {
  return [
    command.targetStationId || 'station_local_demo',
    command.type,
    command.sessionId,
    command.studentId || '',
    command.zoomUrl || ''
  ].join('|')
}

function commandExpiresAt(fromIso = nowIso()) {
  const base = Date.parse(fromIso)
  return new Date((Number.isFinite(base) ? base : Date.now()) + 2 * 60 * 1000).toISOString()
}

function nextCommandVersion(state: AppState, stationId?: string) {
  const stationCommands = state.commands.filter((command) => (command.targetStationId || 'station_local_demo') === (stationId || 'station_local_demo'))
  return Math.max(Date.now(), Math.max(0, ...stationCommands.map((command) => command.commandVersion || 0)) + 1)
}

function pruneCommands(commands: Command[], nextCommand?: Command): Command[] {
  const now = Date.now()
  const keepRecentMs = 5 * 60 * 1000
  const nextStation = nextCommand?.targetStationId || ''
  const nextKey = nextCommand?.dedupeKey || ''
  const filtered = commands.filter((command) => {
    if (nextCommand && (command.targetStationId || '') === nextStation && activeCommandStatuses(command.status)) return false
    if (nextCommand && command.dedupeKey && command.dedupeKey === nextKey) return false
    if (command.status === 'done' || command.status === 'cancelled' || command.status === 'expired') {
      return now - Date.parse(command.updatedAt || command.createdAt) < keepRecentMs
    }
    if (command.status === 'error') {
      return now - Date.parse(command.updatedAt || command.createdAt) < keepRecentMs
    }
    return true
  })
  return (nextCommand ? [nextCommand, ...filtered] : filtered).slice(0, 20)
}

function requestFreshCommand(state: AppState, command: Command, event: Omit<EventLogItem, 'id' | 'createdAt'>): AppState {
  const createdAt = command.createdAt || nowIso()
  const prepared: Command = {
    ...command,
    status: 'pending',
    audience: command.audience || 'agent',
    attempt: 1,
    maxAttempts: command.maxAttempts || 5,
    commandVersion: nextCommandVersion(state, command.targetStationId),
    dedupeKey: command.dedupeKey || commandDedupeKey(command),
    expiresAt: command.expiresAt || commandExpiresAt(createdAt),
    createdAt,
    updatedAt: createdAt
  }
  return addEvent({ ...state, commands: pruneCommands(state.commands, prepared) }, {
    ...event,
    payload: { ...(event.payload || {}), commandId: prepared.id, commandVersion: prepared.commandVersion }
  })
}

function importDraftKey(value: { fullName: string; groupName?: string }) {
  return `${normalizeText(value.fullName).toLowerCase()}::${normalizeText(value.groupName || '').toLowerCase()}`
}

function mergeImportStudents(primary: ImportReview, incoming: ImportReview): ImportReview {
  const seen = new Set<string>()
  const students = [...primary.students, ...incoming.students].filter((student) => {
    const key = importDraftKey(student)
    if (!student.fullName || seen.has(key)) return false
    seen.add(key)
    return true
  }).map((student, idx) => ({ ...student, rowNumber: idx + 1 }))
  const sourceNames = Array.from(new Set([...primary.sourceName.split('; '), ...incoming.sourceName.split('; ')].filter(Boolean)))
  const groupNames = Array.from(new Set(students.map((student) => student.groupName).filter(Boolean)))

  return {
    ...primary,
    sourceName: sourceNames.join('; '),
    specialtyCode: primary.specialtyCode || incoming.specialtyCode,
    specialtyName: primary.specialtyName || incoming.specialtyName,
    educationProgram: primary.educationProgram || incoming.educationProgram,
    studyForm: primary.studyForm || incoming.studyForm,
    groupName: groupNames.length === 1 ? groupNames[0] : 'Кілька груп',
    students,
    createdAt: primary.createdAt
  }
}

export function saveImportReview(state: AppState, review: ImportReview): AppState {
  const existing = state.importReviews.find((x) => x.sessionId === review.sessionId)
  const nextReview = existing && existing.id !== review.id ? mergeImportStudents(existing, review) : mergeImportStudents(review, { ...review, students: [] })
  return addEvent({ ...state, importReviews: [nextReview, ...state.importReviews.filter((x) => x.id !== nextReview.id && x.sessionId !== nextReview.sessionId)] }, {
    sessionId: review.sessionId,
    type: 'IMPORT_REVIEW_CREATED',
    actor: 'admin',
    message: `Імпортовано чернетку: ${nextReview.sourceName}, студентів: ${nextReview.students.length}`
  })
}

export function updateImportReview(state: AppState, review: ImportReview): AppState {
  return { ...state, importReviews: state.importReviews.map((x) => (x.id === review.id ? review : x)) }
}

export function confirmImportReview(state: AppState, reviewId: string): AppState {
  const review = state.importReviews.find((x) => x.id === reviewId)
  if (!review) return state
  const now = nowIso()
  const selected = review.students.filter((x) => x.selected)
  const groups = [...state.groups]
  const ensureGroup = (groupName: string) => {
    let group = groups.find((x) => x.sessionId === review.sessionId && x.name === groupName)
    if (group) return group
    group = {
      id: uid('group'),
      sessionId: review.sessionId,
      name: groupName,
      specialtyCode: review.specialtyCode,
      specialtyName: review.specialtyName,
      educationProgram: review.educationProgram,
      studyForm: review.studyForm
    }
    groups.push(group)
    return group
  }
  const existingKeys = new Set(state.students.filter((s) => s.sessionId === review.sessionId).map(importDraftKey))
  const importedKeys = new Set<string>()
  const students: Student[] = selected
    .filter((draft) => {
      const key = importDraftKey(draft)
      if (existingKeys.has(key) || importedKeys.has(key)) return false
      importedKeys.add(key)
      return true
    })
    .map((draft) => {
      const groupName = draft.groupName || review.groupName || 'Без групи'
      const group = ensureGroup(groupName)
      return {
      id: uid('student'),
      token: uid('token'),
      registrationConfirmed: false,
      sessionId: review.sessionId,
      groupId: group.id,
      groupName: draft.groupName || groupName,
      fullName: draft.fullName,
      thesisTitleOriginal: draft.thesisTitle,
      thesisTitleEdited: draft.thesisTitle,
      supervisorOriginal: draft.supervisor,
      supervisorEdited: draft.supervisor,
      consultant: draft.consultant,
      specialtyCode: review.specialtyCode,
      specialtyName: review.specialtyName,
      educationProgram: review.educationProgram,
      studyForm: review.studyForm,
      isAllowedToRegister: true,
      defenseFormat: 'offline',
      registrationStatus: 'not_registered',
      presentationStatus: 'missing',
      defenseStatus: 'waiting',
      createdAt: now,
      updatedAt: now
      }
    })
  const importedGroupNames = Array.from(new Set(students.map((student) => student.groupName)))
  const next = {
    ...state,
    groups,
    students: [...state.students, ...students],
    importReviews: state.importReviews.filter((x) => x.id !== reviewId),
    sessions: state.sessions.map((s) =>
      s.id === review.sessionId
        ? { ...s, groupNames: Array.from(new Set([...s.groupNames, ...importedGroupNames])), updatedAt: now }
        : s
    )
  }
  return addEvent(next, {
    sessionId: review.sessionId,
    type: 'IMPORT_CONFIRMED',
    actor: 'admin',
    message: `Підтверджено імпорт: ${students.length} студентів`,
    payload: { reviewId, count: students.length }
  })
}

export function updateStudent(state: AppState, studentId: string, patch: Partial<Student>, actor: 'admin' | 'student' = 'admin'): AppState {
  const next = {
    ...state,
    students: state.students.map((s) => (s.id === studentId ? applyStudentPatch(s, patch) : s))
  }
  const student = next.students.find((s) => s.id === studentId)
  return addEvent(next, {
    sessionId: student?.sessionId,
    type: 'STUDENT_EDITED',
    actor,
    message: `Оновлено студента: ${student?.fullName || studentId}`,
    payload: { studentId, patch }
  })
}

export function removeStudent(state: AppState, studentId: string): AppState {
  const student = state.students.find((s) => s.id === studentId)
  if (!student) return state

  const remainingQueue = state.queue
    .filter((q) => !(q.sessionId === student.sessionId && q.studentId === studentId))

  const reindexedSessionQueue = remainingQueue
    .filter((q) => q.sessionId === student.sessionId)
    .sort((a, b) => a.position - b.position)
    .map((q, idx) => ({ ...q, position: idx + 1, updatedAt: nowIso() }))

  const queue = [
    ...remainingQueue.filter((q) => q.sessionId !== student.sessionId),
    ...reindexedSessionQueue
  ]

  const next: AppState = {
    ...state,
    students: state.students.filter((s) => s.id !== studentId),
    queue,
    presentations: state.presentations.filter((p) => p.studentId !== studentId),
    commands: state.commands.filter((c) => c.studentId !== studentId),
    protocols: state.protocols.map((p) => ({
      ...p,
      rows: p.rows.filter((r) => r.studentId !== studentId).map((r, idx) => ({ ...r, order: idx + 1 })),
      updatedAt: nowIso()
    }))
  }

  return addEvent(next, {
    sessionId: student.sessionId,
    type: 'STUDENT_DELETED',
    actor: 'admin',
    message: `Видалено студента: ${student.fullName}`,
    payload: { studentId, fullName: student.fullName }
  })
}

export function addManualStudent(state: AppState, sessionId: string, input: Pick<Student, 'fullName' | 'groupName' | 'thesisTitleEdited' | 'supervisorEdited'>): AppState {
  const now = nowIso()
  let group = state.groups.find((g) => g.sessionId === sessionId && g.name === input.groupName)
  const groups = [...state.groups]
  if (!group) {
    group = { id: uid('group'), sessionId, name: input.groupName }
    groups.push(group)
  }
  const student: Student = {
    id: uid('student'),
    sessionId,
    groupId: group.id,
    groupName: input.groupName,
    fullName: input.fullName,
    thesisTitleOriginal: input.thesisTitleEdited,
    thesisTitleEdited: input.thesisTitleEdited,
    supervisorOriginal: input.supervisorEdited,
    supervisorEdited: input.supervisorEdited,
    isAllowedToRegister: true,
    defenseFormat: 'offline',
    registrationStatus: 'manually_added',
    presentationStatus: 'missing',
    defenseStatus: 'waiting',
    createdAt: now,
    updatedAt: now
  }
  return addEvent({ ...state, groups, students: [...state.students, student] }, {
    sessionId,
    type: 'STUDENT_EDITED',
    actor: 'admin',
    message: `Додано студента вручну: ${student.fullName}`
  })
}

export function setRegistrationLock(state: AppState, sessionId: string, locked: boolean, manualOpen?: boolean): AppState {
  const next = {
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === sessionId
        ? { ...s, isRegistrationLocked: locked, manualRegistrationOpen: manualOpen ?? s.manualRegistrationOpen, updatedAt: nowIso() }
        : s
    )
  }
  return addEvent(next, {
    sessionId,
    type: 'REGISTRATION_LOCK_CHANGED',
    actor: 'admin',
    message: locked ? 'Запис заблоковано' : 'Запис розблоковано'
  })
}

export function addToQueue(state: AppState, studentId: string, actor: 'admin' | 'student' = 'admin'): AppState {
  const student = state.students.find((s) => s.id === studentId)
  if (!student) return state
  if (isSessionClosed(state, student.sessionId)) {
    return addEvent(state, {
      sessionId: student.sessionId,
      type: 'STUDENT_REGISTERED',
      actor,
      message: 'День захисту закрито: додавання в чергу заблоковано',
      payload: { studentId, blocked: true }
    })
  }
  const existing = state.queue.find((q) => q.studentId === studentId)
  let next = state
  let queuePosition = existing?.position
  if (!existing) {
    const max = Math.max(0, ...state.queue.filter((q) => q.sessionId === student.sessionId).map((q) => q.position))
    const item: QueueItem = { id: uid('queue'), sessionId: student.sessionId, studentId, position: max + 1, createdAt: nowIso(), updatedAt: nowIso() }
    queuePosition = item.position
    next = { ...state, queue: [...state.queue, item] }
  }
  next = {
    ...next,
    students: next.students.map((s) =>
      s.id === studentId
        ? { ...s, registrationStatus: actor === 'student' ? 'registered' : s.registrationStatus === 'not_registered' ? 'manually_added' : s.registrationStatus, registeredAt: s.registeredAt || nowIso(), queuePosition, updatedAt: nowIso() }
        : s
    )
  }
  return addEvent(next, {
    sessionId: student.sessionId,
    type: 'STUDENT_REGISTERED',
    actor,
    message: `Студент у черзі: ${student.fullName}`,
    payload: { studentId }
  })
}

export function reorderQueue(state: AppState, sessionId: string, studentId: string, direction: -1 | 1): AppState {
  if (isSessionClosed(state, sessionId)) return state
  const queue = state.queue.filter((q) => q.sessionId === sessionId).sort((a, b) => a.position - b.position)
  const idx = queue.findIndex((q) => q.studentId === studentId)
  const swapIdx = idx + direction
  if (idx < 0 || swapIdx < 0 || swapIdx >= queue.length) return state
  const a = queue[idx]
  const b = queue[swapIdx]
  const updated = state.queue.map((q) => {
    if (q.id === a.id) return { ...q, position: b.position, updatedAt: nowIso() }
    if (q.id === b.id) return { ...q, position: a.position, updatedAt: nowIso() }
    return q
  })
  return addEvent({ ...state, queue: updated }, {
    sessionId,
    type: 'QUEUE_REORDERED',
    actor: 'admin',
    message: 'Змінено порядок черги',
    payload: { studentId, direction }
  })
}

export function setQueuePositionAbsolute(state: AppState, sessionId: string, studentId: string, targetPosition: number): AppState {
  if (isSessionClosed(state, sessionId)) return state
  const sessionQueue = state.queue.filter((q) => q.sessionId === sessionId).sort((a, b) => a.position - b.position)
  const idx = sessionQueue.findIndex((q) => q.studentId === studentId)
  if (idx < 0) return state
  let pos = targetPosition
  if (pos < 1) pos = 1
  if (pos > sessionQueue.length) pos = sessionQueue.length

  const target = sessionQueue[idx]
  const rest = sessionQueue.filter((_, i) => i !== idx)
  rest.splice(pos - 1, 0, target)

  const updatedQueue = state.queue.map((q) => {
    if (q.sessionId !== sessionId) return q
    const newIdx = rest.findIndex((x) => x.id === q.id)
    if (newIdx >= 0) {
      return { ...q, position: newIdx + 1, updatedAt: nowIso() }
    }
    return q
  })

  return addEvent({ ...state, queue: updatedQueue }, {
    sessionId,
    type: 'QUEUE_REORDERED',
    actor: 'admin',
    message: `Змінено позицію в черзі на ${pos}`,
    payload: { studentId, targetPosition: pos }
  })
}

export function makeNextInQueue(state: AppState, sessionId: string, studentId: string): AppState {
  if (isSessionClosed(state, sessionId)) return state
  const sessionQueue = state.queue.filter((q) => q.sessionId === sessionId).sort((a, b) => a.position - b.position)
  const idx = sessionQueue.findIndex((q) => q.studentId === studentId)
  if (idx <= 0) return state

  const firstStudent = state.students.find(s => s.id === sessionQueue[0].studentId)
  const insertIdx = firstStudent?.defenseStatus === 'presenting' ? 1 : 0

  if (idx === insertIdx) return state

  const item = sessionQueue.splice(idx, 1)[0]
  sessionQueue.splice(insertIdx, 0, item)

  const updatedQueue = state.queue.map(q => {
    if (q.sessionId !== sessionId) return q
    const newPosIdx = sessionQueue.findIndex(sq => sq.id === q.id)
    return { ...q, position: newPosIdx + 1, updatedAt: nowIso() }
  })

  return addEvent({ ...state, queue: updatedQueue }, {
    sessionId,
    type: 'QUEUE_REORDERED',
    actor: 'admin',
    message: 'Студента перенесено на початок черги',
    payload: { studentId }
  })
}

export function removeFromQueue(state: AppState, sessionId: string, studentId: string): AppState {
  if (isSessionClosed(state, sessionId)) return state
  // Keep all queue items EXCEPT the one for this student in this session
  const otherSessions = state.queue.filter((q) => q.sessionId !== sessionId)
  const sessionQueue = state.queue
    .filter((q) => q.sessionId === sessionId && q.studentId !== studentId)
    .sort((a, b) => a.position - b.position)
    .map((q, idx) => ({ ...q, position: idx + 1, updatedAt: nowIso() }))
  const student = state.students.find((s) => s.id === studentId)
  return addEvent({ ...state, queue: [...otherSessions, ...sessionQueue] }, {
    sessionId,
    type: 'QUEUE_REMOVED',
    actor: 'admin',
    message: `Прибрано з черги: ${student?.fullName || studentId}`,
    payload: { sessionId, studentId }
  })
}

export function cancelRegistration(state: AppState, sessionId: string, studentId: string): AppState {
  if (isSessionClosed(state, sessionId)) return state
  const updatedStudents = state.students.map((s) =>
    s.id === studentId
      ? {
          ...s,
          registrationStatus: 'not_registered' as const,
          presentationStatus: 'missing' as const,
          registrationConfirmed: false,
          registeredAt: undefined,
          queuePosition: undefined,
          token: '',
          hasVideo: false,
          updatedAt: nowIso()
        }
      : s
  )
  // Remove from queue and renumber remaining entries
  const otherSessions = state.queue.filter((q) => q.sessionId !== sessionId)
  const sessionQueue = state.queue
    .filter((q) => q.sessionId === sessionId && q.studentId !== studentId)
    .sort((a, b) => a.position - b.position)
    .map((q, idx) => ({ ...q, position: idx + 1, updatedAt: nowIso() }))
  const updatedPresentations = state.presentations.filter((p) => p.studentId !== studentId)

  if (window.dekAgent?.deletePresentation) {
    window.dekAgent.deletePresentation(sessionId, studentId).catch(() => {})
  }

  const nextState = { ...state, students: updatedStudents, queue: [...otherSessions, ...sessionQueue], presentations: updatedPresentations }
  return addEvent(nextState, {
    sessionId,
    type: 'QUEUE_REMOVED',
    actor: 'admin',
    message: `Скасовано реєстрацію: ${state.students.find((s) => s.id === studentId)?.fullName || studentId}`,
    payload: { sessionId, studentId }
  })
}

export async function uploadPresentation(state: AppState, studentId: string, file: File, actor: 'student' | 'admin' = 'student'): Promise<AppState> {
  const student = state.students.find((s) => s.id === studentId)
  if (!student) return state
  if (isSessionClosed(state, student.sessionId)) {
    return addEvent(state, {
      sessionId: student.sessionId,
      type: 'PRESENTATION_UPLOADED',
      actor,
      message: 'День захисту закрито: завантаження презентацій заблоковано',
      payload: { studentId, blocked: true }
    })
  }
  const ext = extOf(file.name)
  if (!isAllowedPresentationExt(ext)) {
    return updateStudent(state, studentId, { presentationStatus: 'error', notes: `${student.notes || ''}\nНедозволений формат презентації: ${ext}` }, actor)
  }
  const previous = state.presentations.filter((p) => p.studentId === studentId)
  const version = previous.length + 1
  const agentUploadUrl = getOnlineUploadUrl(state)
  let agentUploadError = ''
  if (agentUploadUrl) {
    try {
      const body = new FormData()
      body.append('presentation', file)
      body.append('sessionId', student.sessionId)
      body.append('studentId', studentId)
      const response = await fetch(`${agentUploadUrl}/upload?sessionId=${encodeURIComponent(student.sessionId)}&studentId=${encodeURIComponent(studentId)}`, {
        method: 'POST',
        body
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Agent upload failed: ${response.status}`)
      const uploaded = payload?.presentation || {}
      const rawAgentStatus = uploaded.status || 'ready'
      const agentStatus = rawAgentStatus === 'converting' || rawAgentStatus === 'conversion_required' ? 'ready' : rawAgentStatus
      const meta: PresentationMeta = {
        id: `${student.sessionId}_${studentId}`,
        sessionId: student.sessionId,
        studentId,
        fileName: uploaded.storedName || `${sanitizeFilePart(student.fullName)}_v${version}.${ext}`,
        originalFileName: uploaded.fileName || file.name,
        fileSize: uploaded.size || file.size,
        mimeType: file.type || 'application/octet-stream',
        extension: uploaded.format || ext,
        version,
        status: agentStatus,
        uploadedAt: uploaded.uploadedAt || nowIso(),
        localOnly: true,
        convertedPdfReady: uploaded.convertedPdfReady === true,
        error: uploaded.errorMessage || uploaded.error
      }
      let next: AppState = {
        ...state,
        presentations: [...state.presentations.filter((p) => p.id !== meta.id), meta],
        students: state.students.map((s) =>
          s.id === studentId
            ? { ...s, presentationStatus: meta.status, registrationStatus: 'registered', registeredAt: s.registeredAt || nowIso(), updatedAt: nowIso() }
            : s
        )
      }
      next = addToQueue(next, studentId, actor)
      return addEvent(next, {
        sessionId: student.sessionId,
        type: 'PRESENTATION_UPLOADED',
        actor,
        message: `Завантажено презентацію в Local Defense Agent: ${student.fullName}`,
        payload: { studentId, fileName: file.name, version, uploadUrl: agentUploadUrl }
      })
    } catch (error) {
      agentUploadError = error instanceof Error ? error.message : String(error)
      console.warn('Local Defense Agent upload failed', error)
    }
  }
  if (ext !== 'pdf') {
    const message = agentUploadUrl
      ? `Не вдалося передати презентацію в Local Defense Agent (${agentUploadUrl}): ${agentUploadError || 'невідома помилка'}`
      : 'Local Defense Agent не знайдено в мережі. Запустіть Electron Agent на ПК захисту і перезавантажте сторінку.'
    return addEvent({
      ...state,
      students: state.students.map((s) =>
        s.id === studentId
          ? { ...s, presentationStatus: 'error', notes: [s.notes, message].filter(Boolean).join('\n'), updatedAt: nowIso() }
          : s
      )
    }, {
      sessionId: student.sessionId,
      type: 'PRESENTATION_UPLOADED',
      actor,
      message,
      payload: { studentId, fileName: file.name, uploadUrl: agentUploadUrl, error: agentUploadError }
    })
  }
  const storageKey = `${student.sessionId}/${studentId}/v${version}_${sanitizeFilePart(file.name)}`
  await saveBlob(storageKey, file)
  const meta: PresentationMeta = {
    id: uid('pres'),
    sessionId: student.sessionId,
    studentId,
    fileName: `${sanitizeFilePart(student.fullName)}_v${version}.${ext}`,
    originalFileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    extension: ext,
    version,
    status: 'ready',
    uploadedAt: nowIso(),
    localOnly: true,
    storageKey,
    convertedPdfReady: ext === 'pdf'
  }
  let next: AppState = {
    ...state,
    presentations: [...state.presentations, meta],
    students: state.students.map((s) =>
      s.id === studentId
        ? { ...s, presentationStatus: meta.status, registrationStatus: 'registered', registeredAt: s.registeredAt || nowIso(), updatedAt: nowIso() }
        : s
    )
  }
  next = addToQueue(next, studentId, actor)
  return addEvent(next, {
    sessionId: student.sessionId,
    type: 'PRESENTATION_UPLOADED',
    actor,
    message: `Завантажено презентацію: ${student.fullName}`,
    payload: { studentId, fileName: file.name, version }
  })
}

export function requestOpenPresentation(state: AppState, sessionId: string, studentId: string): AppState {
  const student = state.students.find((s) => s.id === studentId)
  const session = state.sessions.find((s) => s.id === sessionId)
  const type: Command['type'] = student?.defenseFormat === 'online' ? 'open_zoom' : 'open_presentation'
  const command: Command = {
    id: uid('cmd'),
    sessionId,
    type,
    studentId,
    targetStationId: targetStationId(state, session),
    zoomUrl: session?.zoomUrl || '',
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  return requestFreshCommand(state, command, {
    sessionId,
    type: type === 'open_zoom' ? 'ZOOM_OPEN_REQUESTED' : 'PRESENTATION_OPEN_REQUESTED',
    actor: 'admin',
    message: type === 'open_zoom' ? 'Створено команду відкриття Zoom для онлайн-захисту' : 'Створено команду відкриття презентації',
    payload: { commandId: command.id, studentId }
  })
}

export function requestOpenZoom(state: AppState, sessionId: string, studentId?: string): AppState {
  const session = state.sessions.find((s) => s.id === sessionId)
  if (!session?.zoomUrl?.trim()) {
    return addEvent(state, {
      sessionId,
      type: 'ZOOM_OPEN_REQUESTED',
      actor: 'admin',
      message: 'Zoom link / Meeting ID не задано в сесії захисту',
      payload: { studentId }
    })
  }
  const command: Command = {
    id: uid('cmd'),
    sessionId,
    type: 'open_zoom',
    studentId,
    targetStationId: targetStationId(state, session),
    zoomUrl: session?.zoomUrl || '',
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  return requestFreshCommand(state, command, {
    sessionId,
    type: 'ZOOM_OPEN_REQUESTED',
    actor: 'admin',
    message: 'Створено команду відкриття Zoom meeting',
    payload: { commandId: command.id, studentId }
  })
}

export function requestOpenUploadPage(state: AppState, sessionId: string, studentId: string): AppState {
  const session = state.sessions.find((s) => s.id === sessionId)
  const student = state.students.find((s) => s.id === studentId)
  const command: Command = {
    id: uid('cmd'),
    sessionId,
    type: 'open_upload_page',
    studentId,
    studentName: student?.fullName || '',
    targetStationId: targetStationId(state, session),
    zoomUrl: session?.zoomUrl || '',
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  return requestFreshCommand(state, command, {
    sessionId,
    type: 'UPLOAD_PAGE_OPEN_REQUESTED',
    actor: 'admin',
    message: `Відкрито сторінку завантаження презентації: ${student?.fullName || studentId}`,
    payload: { commandId: command.id, studentId }
  })
}

export function requestStartDefenses(state: AppState, sessionId: string): AppState {
  const session = state.sessions.find((s) => s.id === sessionId)
  const command: Command = {
    id: uid('cmd'),
    sessionId,
    type: 'start_defense_display',
    targetStationId: targetStationId(state, session),
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  return requestFreshCommand(state, command, {
    sessionId,
    type: 'START_DEFENSES_REQUESTED',
    actor: 'admin',
    message: 'Запущено режим захистів на ПК показу',
    payload: { commandId: command.id }
  })
}

export function clearOldCommands(state: AppState, sessionId: string): AppState {
  const remainingCommands = state.commands.filter((c) => c.sessionId !== sessionId)
  
  return addEvent({ 
    ...state, 
    commands: remainingCommands
  }, {
    sessionId,
    type: 'OLD_COMMANDS_CLEARED',
    actor: 'admin',
    message: 'Очищено історію команд',
    payload: { sessionId }
  })
}

export function requestShowDisplay(state: AppState, sessionId: string): AppState {
  const session = state.sessions.find((s) => s.id === sessionId)
  const command: Command = {
    id: uid('cmd'),
    sessionId,
    type: 'show_display',
    targetStationId: targetStationId(state, session),
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  return requestFreshCommand(state, command, {
    sessionId,
    type: 'DISPLAY_STARTED',
    actor: 'admin',
    message: 'Повернення Display на ПК показу',
    payload: { commandId: command.id }
  })
}

export function markCommandDone(state: AppState, commandId: string, error?: string): AppState {
  return {
    ...state,
    commands: state.commands.map((c) => c.id === commandId ? {
      ...c,
      status: error ? 'error' : 'done',
      error,
      updatedAt: nowIso()
    } : c)
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch] || ch))
}

function openPdfBlob(blob: Blob, title: string) {
  const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
  const url = URL.createObjectURL(pdfBlob)
  const w = window.open('', '_blank', 'noopener,noreferrer')
  if (!w) return
  const safeTitle = escapeHtml(title)
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050816;color:#fff;font-family:Arial,sans-serif}
    #stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#050816;cursor:pointer}
    canvas{max-width:100vw;max-height:100vh;box-shadow:0 0 0 1px #1f2937;background:#fff}
    #counter{position:fixed;right:14px;bottom:12px;background:rgba(0,0,0,.55);border:1px solid #4b5563;padding:5px 8px;font-size:12px;color:#e5e7eb}
    #hint{position:fixed;left:14px;bottom:12px;background:rgba(0,0,0,.55);border:1px solid #4b5563;padding:5px 8px;font-size:12px;color:#cbd5e1}
    #error{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:40px;text-align:center;background:#111827;color:#fff}
    button{border:1px solid #6b7280;background:#111827;color:#fff;padding:8px 10px;margin-top:12px}
  </style></head><body><div id="stage"><canvas id="canvas"></canvas></div><div id="hint">Клік / Space / → наступний · ← попередній</div><div id="counter">—</div><div id="error"><div><h1>Не вдалося відкрити PDF viewer</h1><p>Перевірте інтернет для завантаження PDF.js або відкрийте PDF локально.</p><button onclick="location.href='${url}'">Відкрити PDF напряму</button></div></div><script type="module">
    const pdfUrl = ${JSON.stringify(url)};
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const counter = document.getElementById('counter');
    const error = document.getElementById('error');
    let pdf = null; let pageNum = 1; let rendering = false;
    async function renderPage(num){
      if(!pdf || rendering) return; rendering = true;
      const page = await pdf.getPage(num);
      const viewport0 = page.getViewport({ scale: 1 });
      const scale = Math.min(window.innerWidth / viewport0.width, window.innerHeight / viewport0.height) * 0.985;
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      counter.textContent = num + ' / ' + pdf.numPages;
      rendering = false;
    }
    function next(){ if(pdf && pageNum < pdf.numPages){ pageNum++; renderPage(pageNum); } }
    function prev(){ if(pdf && pageNum > 1){ pageNum--; renderPage(pageNum); } }
    document.getElementById('stage').addEventListener('click', next);
    window.addEventListener('keydown', (e) => { if(e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') next(); if(e.key === 'ArrowLeft' || e.key === 'PageUp') prev(); });
    window.addEventListener('resize', () => renderPage(pageNum));
    try {
      const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
      pdf = await pdfjsLib.getDocument(pdfUrl).promise;
      await renderPage(1);
      document.documentElement.requestFullscreen?.().catch(() => {});
    } catch (e) { console.error(e); error.style.display = 'flex'; }
  </script></body></html>`)
  w.document.close()
}

export async function openLatestPresentation(state: AppState, studentId: string): Promise<AppState> {
  const student = state.students.find((s) => s.id === studentId)
  const pres = state.presentations.filter((p) => p.studentId === studentId).sort((a, b) => b.version - a.version)[0]
  if (!student || !pres?.storageKey) return state

  if (pres.extension !== 'pdf' || !pres.convertedPdfReady) {
    const message = `Файл ${pres.originalFileName} завантажено, але web-версія не має стабільної локальної конвертації. Потрібен Electron Defense Station / Local Agent або WASM-конвертер.`
    return addEvent({
      ...state,
      students: state.students.map((s) => s.id === studentId ? { ...s, presentationStatus: 'conversion_required', updatedAt: nowIso() } : s),
      commands: state.commands.map((c) => c.studentId === studentId && c.status === 'pending' ? { ...c, status: 'error', error: message, updatedAt: nowIso() } : c)
    }, {
      sessionId: student.sessionId,
      type: 'PRESENTATION_OPEN_REQUESTED',
      actor: 'agent',
      message,
      payload: { studentId, presentationId: pres.id, extension: pres.extension }
    })
  }

  const blob = await getBlob(pres.storageKey)
  if (!blob) {
    const message = `Не знайдено локальний файл презентації для ${student.fullName}`
    return addEvent({
      ...state,
      students: state.students.map((s) => s.id === studentId ? { ...s, presentationStatus: 'error', updatedAt: nowIso() } : s),
      commands: state.commands.map((c) => c.studentId === studentId && c.status === 'pending' ? { ...c, status: 'error', error: message, updatedAt: nowIso() } : c)
    }, {
      sessionId: student.sessionId,
      type: 'PRESENTATION_OPEN_REQUESTED',
      actor: 'agent',
      message,
      payload: { studentId, presentationId: pres.id }
    })
  }

  openPdfBlob(blob, `${student.fullName} — презентація`)

  return addEvent({
    ...state,
    students: state.students.map((s) => s.id === studentId ? { ...s, defenseStatus: 'presenting', updatedAt: nowIso() } : s),
    commands: state.commands.map((c) => c.studentId === studentId && c.status === 'pending' ? { ...c, status: 'done', updatedAt: nowIso() } : c)
  }, {
    sessionId: student.sessionId,
    type: 'PRESENTATION_OPENED',
    actor: 'agent',
    message: `Відкрито PDF-презентацію: ${student.fullName}`,
    payload: { studentId, presentationId: pres.id }
  })
}

export function setDefenseStatus(state: AppState, studentId: string, defenseStatus: DefenseStatus): AppState {
  const student = state.students.find((s) => s.id === studentId)
  if (!student) return state
  const defendedPatch = defenseStatus === 'defended'
    ? { defendedAt: nowIso(), defendedSessionId: student.sessionId }
    : {}
  let next = addEvent({
    ...state,
    students: state.students.map((s) => s.id === studentId ? applyStudentPatch(s, { defenseStatus, ...defendedPatch }) : s)
  }, {
    sessionId: student.sessionId,
    type: 'DEFENSE_STATUS_CHANGED',
    actor: 'admin',
    message: `${student.fullName}: ${defenseStatus}`,
    payload: { studentId, defenseStatus }
  })
  if ((defenseStatus === 'defended' || defenseStatus === 'problem' || defenseStatus === 'absent') && student.defenseFormat === 'online') {
    const sessionQueue = next.queue.filter((q) => q.sessionId === student.sessionId).sort((a, b) => a.position - b.position)
    const currentIndex = sessionQueue.findIndex((q) => q.studentId === studentId)
    const nextStudent = sessionQueue
      .slice(currentIndex + 1)
      .map((q) => next.students.find((s) => s.id === q.studentId))
      .find((s) => s && s.defenseStatus === 'waiting')
    if (nextStudent && nextStudent.defenseFormat !== 'online') {
      next = requestShowDisplay(next, student.sessionId)
    }
  }
  return next
}

export function unsetDefendedStatus(state: AppState, studentId: string): AppState {
  const student = state.students.find((s) => s.id === studentId)
  if (!student || student.defenseStatus !== 'defended') return state
  return addEvent({
    ...state,
    students: state.students.map((s) => s.id === studentId
      ? applyStudentPatch(s, {
          defenseStatus: 'waiting',
          defendedAt: undefined,
          defendedSessionId: undefined,
          mobilePageExpiresAt: undefined
        })
      : s)
  }, {
    sessionId: student.sessionId,
    type: 'DEFENSE_STATUS_CHANGED',
    actor: 'admin',
    message: `Знято статус "захистився": ${student.fullName}`,
    payload: { studentId, defenseStatus: 'waiting' }
  })
}

export function closeDefenseDay(state: AppState, sessionId: string): AppState {
  const session = state.sessions.find((item) => item.id === sessionId)
  if (!session || session.isClosed) return state
  const closedAt = nowIso()
  const queue = state.queue
    .filter((item) => item.sessionId === sessionId)
    .sort((a, b) => a.position - b.position)
  const queuedStudentIds = queue.map((item) => item.studentId)
  const queuedSet = new Set(queuedStudentIds)
  const command: Command = {
    id: uid('cmd'),
    sessionId,
    type: 'close_day',
    targetStationId: targetStationId(state, session),
    status: 'pending',
    createdAt: closedAt,
    updatedAt: closedAt
  }
  const next: AppState = {
    ...state,
    sessions: state.sessions.map((item) => item.id === sessionId
      ? {
          ...item,
          isClosed: true,
          isRegistrationLocked: true,
          manualRegistrationOpen: false,
          closedAt,
          closedQueueStudentIds: queuedStudentIds,
          updatedAt: closedAt
        }
      : item),
    students: state.students.map((student) => {
      if (!queuedSet.has(student.id)) return student
      if (student.defenseStatus === 'defended' || student.defenseStatus === 'problem' || student.defenseStatus === 'absent') {
        return applyStudentPatch(student, {
          registrationStatus: student.registrationStatus === 'not_registered' ? 'manually_added' : student.registrationStatus,
          mobilePageExpiresAt: student.mobilePageExpiresAt || mobilePageExpiresAt(closedAt),
          defendedSessionId: student.defendedSessionId || sessionId,
          defendedAt: student.defendedAt || closedAt
        })
      }
      return applyStudentPatch(student, {
        registrationStatus: student.registrationStatus === 'not_registered' ? 'manually_added' : student.registrationStatus,
        defenseStatus: 'defended',
        mobilePageExpiresAt: mobilePageExpiresAt(closedAt),
        defendedSessionId: sessionId,
        defendedAt: closedAt
      })
    })
  }
  return requestFreshCommand(addEvent(next, {
    sessionId,
    type: 'SESSION_UPDATED',
    actor: 'admin',
    message: `Закрито день захисту: ${session.title} · ${session.date}`,
    payload: { sessionId, count: queuedStudentIds.length }
  }), command, {
    sessionId,
    type: 'SESSION_UPDATED',
    actor: 'admin',
    message: 'Створено команду очищення локальних презентацій після закриття дня',
    payload: { sessionId }
  })
}

export function saveProtocol(state: AppState, protocol: ProtocolSnapshot): AppState {
  const exists = state.protocols.some((p) => p.id === protocol.id)
  return {
    ...state,
    protocols: exists ? state.protocols.map((p) => p.id === protocol.id ? protocol : p) : [protocol, ...state.protocols]
  }
}
