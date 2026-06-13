export type RegistrationStatus =
  | 'not_registered'
  | 'started'
  | 'registered'
  | 'manually_added'
  | 'late_registered'

export type PresentationStatus =
  | 'missing'
  | 'uploading'
  | 'uploaded'
  | 'validating'
  | 'converting'
  | 'converted'
  | 'ready'
  | 'error'
  | 'open_error'
  | 'conversion_required'

export type DefenseStatus =
  | 'waiting'
  | 'presenting'
  | 'defended'
  | 'absent'
  | 'problem'
  | 'postponed'

export type DefenseFormat = 'offline' | 'online'

export type EventType =
  | 'SESSION_CREATED'
  | 'SESSION_UPDATED'
  | 'SESSION_DELETED'
  | 'IMPORT_REVIEW_CREATED'
  | 'IMPORT_CONFIRMED'
  | 'STUDENT_EDITED'
  | 'STUDENT_DELETED'
  | 'STUDENT_REGISTERED'
  | 'QUEUE_REMOVED'
  | 'PRESENTATION_UPLOADED'
  | 'QUEUE_REORDERED'
  | 'REGISTRATION_LOCK_CHANGED'
  | 'PRESENTATION_OPEN_REQUESTED'
  | 'PRESENTATION_OPENED'
  | 'UPLOAD_PAGE_OPEN_REQUESTED'
  | 'START_DEFENSES_REQUESTED'
  | 'DISPLAY_STARTED'
  | 'ZOOM_OPEN_REQUESTED'
  | 'DEFENSE_STATUS_CHANGED'
  | 'NOTE_ADDED'
  | 'BACKUP_EXPORTED'

export interface DefenseSession {
  id: string
  title: string
  date: string
  groupNames: string[]
  registrationOpenFrom: string
  registrationOpenTo: string
  defenseStartsAt: string
  zoomUrl?: string
  manualRegistrationOpen: boolean
  isRegistrationLocked: boolean
  publicToken: string
  stationId?: string
  createdAt: string
  updatedAt: string
}

export interface Group {
  id: string
  name: string
  sessionId: string
  specialtyCode?: string
  specialtyName?: string
  educationProgram?: string
  studyForm?: string
}

export interface Student {
  id: string
  sessionId: string
  groupId: string
  groupName: string
  fullName: string
  thesisTitleOriginal: string
  thesisTitleEdited: string
  supervisorOriginal: string
  supervisorEdited: string
  consultant?: string
  specialtyCode?: string
  specialtyName?: string
  educationProgram?: string
  studyForm?: string
  isAllowedToRegister: boolean
  defenseFormat?: DefenseFormat
  wantsZoomDemo?: boolean
  hasVideo?: boolean
  registrationStatus: RegistrationStatus
  presentationStatus: PresentationStatus
  defenseStatus: DefenseStatus
  registeredAt?: string
  queuePosition?: number
  pagesCount?: string
  drawingsCount?: string
  workLevel?: string
  reviewerGrade?: string
  projectGrade?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface PresentationMeta {
  id: string
  sessionId: string
  studentId: string
  fileName: string
  originalFileName: string
  fileSize: number
  mimeType: string
  extension: string
  version: number
  status: PresentationStatus
  uploadedAt: string
  localOnly: boolean
  storageKey?: string
  convertedPdfReady?: boolean
  error?: string
}

export interface QueueItem {
  id: string
  sessionId: string
  studentId: string
  position: number
  createdAt: string
  updatedAt: string
}

export interface Command {
  id: string
  sessionId: string
  type: 'open_presentation' | 'close_presentation' | 'set_current_student' | 'start_defense_display' | 'show_display' | 'open_zoom' | 'open_upload_page'
  studentId?: string
  studentName?: string
  targetStationId?: string
  zoomUrl?: string
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
  createdAt: string
  updatedAt: string
}

export interface Station {
  id: string
  name: string
  activeSessionId?: string
  online: boolean
  localUploadUrl?: string
  lanUploadUrl?: string
  currentStudentId?: string
  lastHeartbeat: string
}

export interface ProtocolRow {
  studentId: string
  order: number
  groupName?: string
  studentName?: string
  thesisTitle?: string
  supervisor?: string
  pagesCount?: string
  drawingsCount?: string
  workLevel?: string
  supervisorReview?: string
  reviewerGrade?: string
  projectGrade?: string
  commissionMembersCount?: string
  questions?: string
  commissionDecision?: string
  diplomaType?: string
}

export interface ProtocolSnapshot {
  id: string
  sessionId: string
  title: string
  date: string
  groupName?: string
  groupKey?: string
  rows: ProtocolRow[]
  defaultValues: Partial<ProtocolRow>
  createdAt: string
  updatedAt: string
}

export interface EventLogItem {
  id: string
  sessionId?: string
  type: EventType
  actor: 'admin' | 'student' | 'agent' | 'system'
  message: string
  payload?: Record<string, unknown>
  createdAt: string
}

export interface ImportDraftStudent {
  tempId: string
  selected: boolean
  rowNumber?: number
  fullName: string
  groupName: string
  thesisTitle: string
  supervisor: string
  consultant?: string
  warning?: string
}

export interface ImportReview {
  id: string
  sessionId: string
  sourceName: string
  specialtyCode?: string
  specialtyName?: string
  educationProgram?: string
  studyForm?: string
  groupName: string
  students: ImportDraftStudent[]
  createdAt: string
}

export interface AppState {
  activeSessionId?: string
  sessions: DefenseSession[]
  groups: Group[]
  students: Student[]
  presentations: PresentationMeta[]
  queue: QueueItem[]
  commands: Command[]
  stations: Station[]
  protocols: ProtocolSnapshot[]
  events: EventLogItem[]
  importReviews: ImportReview[]
}

export interface AppRepository {
  getState(): Promise<AppState>
  saveState(state: AppState): Promise<void>
}
