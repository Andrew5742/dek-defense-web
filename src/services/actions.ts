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
import { extOf, isAllowedPresentationExt, nowIso, sanitizeFilePart, todayLocalDate, uid } from '../shared/utils'
import { getBlob, saveBlob } from './localRepository'

export function addEvent(state: AppState, event: Omit<EventLogItem, 'id' | 'createdAt'>): AppState {
  return {
    ...state,
    events: [{ id: uid('event'), createdAt: nowIso(), ...event }, ...state.events].slice(0, 1000)
  }
}

export function createSession(state: AppState, input: Partial<DefenseSession>): AppState {
  const now = nowIso()
  const session: DefenseSession = {
    id: uid('session'),
    title: input.title || 'Захист',
    date: input.date || todayLocalDate(),
    groupNames: input.groupNames || [],
    registrationOpenFrom: input.registrationOpenFrom || '08:00',
    registrationOpenTo: input.registrationOpenTo || '23:59',
    defenseStartsAt: input.defenseStartsAt || '09:05',
    manualRegistrationOpen: false,
    isRegistrationLocked: false,
    publicToken: uid('pub'),
    stationId: input.stationId || 'station_local_demo',
    createdAt: now,
    updatedAt: now
  }
  return addEvent({ ...state, activeSessionId: session.id, sessions: [session, ...state.sessions] }, {
    sessionId: session.id,
    type: 'SESSION_CREATED',
    actor: 'admin',
    message: `Створено сесію ${session.title}`,
    payload: { sessionId: session.id }
  })
}

export function saveImportReview(state: AppState, review: ImportReview): AppState {
  return addEvent({ ...state, importReviews: [review, ...state.importReviews.filter((x) => x.id !== review.id)] }, {
    sessionId: review.sessionId,
    type: 'IMPORT_REVIEW_CREATED',
    actor: 'admin',
    message: `Імпортовано чернетку: ${review.sourceName}, студентів: ${review.students.length}`
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
  const groupName = review.groupName || selected[0]?.groupName || 'Без групи'
  let group = state.groups.find((x) => x.sessionId === review.sessionId && x.name === groupName)
  const groups = [...state.groups]
  if (!group) {
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
  }
  const existingNames = new Set(state.students.filter((s) => s.sessionId === review.sessionId).map((s) => s.fullName.toLowerCase()))
  const students: Student[] = selected
    .filter((draft) => !existingNames.has(draft.fullName.toLowerCase()))
    .map((draft) => ({
      id: uid('student'),
      sessionId: review.sessionId,
      groupId: group!.id,
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
      registrationStatus: 'not_registered',
      presentationStatus: 'missing',
      defenseStatus: 'waiting',
      createdAt: now,
      updatedAt: now
    }))
  const next = {
    ...state,
    groups,
    students: [...state.students, ...students],
    importReviews: state.importReviews.filter((x) => x.id !== reviewId),
    sessions: state.sessions.map((s) =>
      s.id === review.sessionId
        ? { ...s, groupNames: Array.from(new Set([...s.groupNames, groupName])), updatedAt: now }
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
    students: state.students.map((s) => (s.id === studentId ? { ...s, ...patch, updatedAt: nowIso() } : s))
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
  const existing = state.queue.find((q) => q.studentId === studentId)
  let next = state
  let queuePosition = existing?.position
  if (!existing) {
    const max = Math.max(0, ...state.queue.filter((q) => q.sessionId === student.sessionId).map((q) => q.position))
    queuePosition = max + 1
    const item: QueueItem = { id: uid('queue'), sessionId: student.sessionId, studentId, position: queuePosition, createdAt: nowIso(), updatedAt: nowIso() }
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

export function removeFromQueue(state: AppState, sessionId: string, studentId: string): AppState {
  const queue = state.queue.filter((q) => !(q.sessionId === sessionId && q.studentId === studentId))
    .filter((q) => q.sessionId !== sessionId)
  const sessionQueue = state.queue
    .filter((q) => q.sessionId === sessionId && q.studentId !== studentId)
    .sort((a, b) => a.position - b.position)
    .map((q, idx) => ({ ...q, position: idx + 1, updatedAt: nowIso() }))
  return { ...state, queue: [...queue, ...sessionQueue] }
}

export async function uploadPresentation(state: AppState, studentId: string, file: File, actor: 'student' | 'admin' = 'student'): Promise<AppState> {
  const student = state.students.find((s) => s.id === studentId)
  if (!student) return state
  const ext = extOf(file.name)
  if (!isAllowedPresentationExt(ext)) {
    return updateStudent(state, studentId, { presentationStatus: 'error', notes: `${student.notes || ''}\nНедозволений формат презентації: ${ext}` }, actor)
  }
  const previous = state.presentations.filter((p) => p.studentId === studentId)
  const version = previous.length + 1
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
    status: ext === 'pdf' ? 'ready' : 'conversion_required',
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
  const command: Command = {
    id: uid('cmd'),
    sessionId,
    type: 'open_presentation',
    studentId,
    targetStationId: state.sessions.find((s) => s.id === sessionId)?.stationId || 'station_local_demo',
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  return addEvent({ ...state, commands: [command, ...state.commands] }, {
    sessionId,
    type: 'PRESENTATION_OPEN_REQUESTED',
    actor: 'admin',
    message: 'Створено команду відкриття презентації',
    payload: { commandId: command.id, studentId }
  })
}

function openPdfBlob(blob: Blob, title: string) {
  const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
  const url = URL.createObjectURL(pdfBlob)
  document.getElementById('local-pdf-viewer-overlay')?.remove()

  const overlay = document.createElement('section')
  overlay.id = 'local-pdf-viewer-overlay'
  overlay.setAttribute('aria-label', title)
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:9999',
    'background:#111827',
    'display:grid',
    'grid-template-rows:auto 1fr'
  ].join(';')

  const bar = document.createElement('div')
  bar.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:12px',
    'padding:8px 10px',
    'background:#0f172a',
    'border-bottom:1px solid #334155',
    'color:#fff',
    'font:14px Arial,sans-serif'
  ].join(';')

  const label = document.createElement('strong')
  label.textContent = title
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Закрити'
  close.style.cssText = 'border:1px solid #94a3b8;background:#fff;color:#0f172a;padding:6px 10px;cursor:pointer'
  close.onclick = () => {
    if (document.fullscreenElement === overlay) void document.exitFullscreen().catch(() => undefined)
    overlay.remove()
    URL.revokeObjectURL(url)
  }
  bar.append(label, close)

  const iframe = document.createElement('iframe')
  iframe.src = `${url}#toolbar=0&navpanes=0&scrollbar=1`
  iframe.title = title
  iframe.style.cssText = 'width:100%;height:100%;border:0;background:#111827'
  overlay.append(bar, iframe)
  document.body.appendChild(overlay)
  void overlay.requestFullscreen?.().catch(() => undefined)
}

export async function openLatestPresentation(state: AppState, studentId: string, presentationId?: string): Promise<AppState> {
  const student = state.students.find((s) => s.id === studentId)
  const pres = presentationId
    ? state.presentations.find((p) => p.id === presentationId && p.studentId === studentId)
    : state.presentations.filter((p) => p.studentId === studentId).sort((a, b) => b.version - a.version)[0]
  if (!student || !pres?.storageKey) return state

  if (pres.extension !== 'pdf' || !pres.convertedPdfReady) {
    const message = `Файл ${pres.originalFileName} завантажено, але у web-режимі його не можна відкрити напряму. Потрібен Local Defense Agent для конвертації в PDF на ПК доповідача.`
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
    students: state.students.map((s) => {
      if (s.id === studentId) return { ...s, defenseStatus: 'presenting', updatedAt: nowIso() }
      if (s.sessionId === student.sessionId && s.defenseStatus === 'presenting') return { ...s, defenseStatus: 'waiting', updatedAt: nowIso() }
      return s
    }),
    commands: state.commands.map((c) => c.studentId === studentId && c.status === 'pending' ? { ...c, status: 'done', updatedAt: nowIso() } : c)
  }, {
    sessionId: student.sessionId,
    type: 'PRESENTATION_OPENED',
    actor: 'agent',
    message: `Відкрито PDF-презентацію: ${student.fullName}`,
    payload: { studentId, presentationId: pres.id }
  })
}

export function setDefenseStatus(state: AppState, studentId: string, defenseStatus: DefenseStatus, problemNote?: string): AppState {
  const student = state.students.find((s) => s.id === studentId)
  if (!student) return state
  const note = defenseStatus === 'problem' && problemNote?.trim()
    ? `${student.notes || ''}\nПроблема захисту: ${problemNote.trim()}`.trim()
    : student.notes
  return addEvent({
    ...state,
    students: state.students.map((s) => {
      if (s.id === studentId) return { ...s, defenseStatus, notes: note, updatedAt: nowIso() }
      if (defenseStatus === 'presenting' && s.sessionId === student.sessionId && s.defenseStatus === 'presenting') {
        return { ...s, defenseStatus: 'waiting', updatedAt: nowIso() }
      }
      return s
    })
  }, {
    sessionId: student.sessionId,
    type: 'DEFENSE_STATUS_CHANGED',
    actor: 'admin',
    message: `${student.fullName}: ${defenseStatus}${problemNote ? ` (${problemNote})` : ''}`,
    payload: { studentId, defenseStatus, problemNote }
  })
}

export function saveProtocol(state: AppState, protocol: ProtocolSnapshot): AppState {
  const exists = state.protocols.some((p) => p.id === protocol.id)
  return {
    ...state,
    protocols: exists ? state.protocols.map((p) => p.id === protocol.id ? protocol : p) : [protocol, ...state.protocols]
  }
}
