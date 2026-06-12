import { useMemo, useState } from 'react'
import type { AppState, DefenseSession, ImportReview, ProtocolRow, ProtocolSnapshot, Student } from '../shared/types'
import { downloadTextFile, formatLocalDateTime, nowIso } from '../shared/utils'
import { addManualStudent, addToQueue, confirmImportReview, createSession, removeFromQueue, removeSession, removeStudent, reorderQueue, requestOpenPresentation, requestOpenZoom, requestShowDisplay, requestStartDefenses, saveImportReview, saveProtocol, setDefenseStatus, setRegistrationLock, updateImportReview, updateStudent } from '../services/actions'
import { importDocx, importFromPastedText } from '../services/importService'
import { isFirebaseEnabled } from '../services/firebaseAdapter'
import { StatusBadge } from '../components/StatusBadge'
import { StudentEditor } from '../components/StudentEditor'

type Props = { state: AppState; setState: (s: AppState) => void; activeSession?: DefenseSession; setActiveSessionId: (id: string) => void }

export function AdminPage({ state, setState, activeSession, setActiveSessionId }: Props) {
  const [tab, setTab] = useState<'overview' | 'import' | 'students' | 'queue' | 'protocol' | 'diagnostics'>('overview')
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)

  return (
    <main className="layout">
      <aside className="side">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Огляд</button>
        <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>Імпорт</button>
        <button className={tab === 'students' ? 'active' : ''} onClick={() => setTab('students')}>Студенти</button>
        <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>Черга</button>
        <button className={tab === 'protocol' ? 'active' : ''} onClick={() => setTab('protocol')}>Протокол</button>
        <button className={tab === 'diagnostics' ? 'active' : ''} onClick={() => setTab('diagnostics')}>Діагностика</button>
      </aside>
      <section className="content">
        {tab === 'overview' && <Overview state={state} setState={setState} activeSession={activeSession} setActiveSessionId={setActiveSessionId} />}
        {tab === 'import' && activeSession && <ImportPanel state={state} setState={setState} session={activeSession} />}
        {tab === 'students' && activeSession && <StudentsPanel state={state} setState={setState} session={activeSession} onEdit={setEditingStudent} />}
        {tab === 'queue' && activeSession && <QueuePanel state={state} setState={setState} session={activeSession} onEdit={setEditingStudent} />}
        {tab === 'protocol' && activeSession && <ProtocolPanel state={state} setState={setState} session={activeSession} />}
        {tab === 'diagnostics' && <DiagnosticsPanel state={state} activeSession={activeSession} />}
        {!activeSession && tab !== 'overview' && <div className="empty">Спочатку створіть або оберіть сесію захисту.</div>}
      </section>
      {editingStudent && (
        <StudentEditor
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSave={(patch) => {
            setState(updateStudent(state, editingStudent.id, patch))
            setEditingStudent(null)
          }}
        />
      )}
    </main>
  )
}

function Overview({ state, setState, activeSession, setActiveSessionId }: Props) {
  const [title, setTitle] = useState('Захист')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState('08:00')
  const [to, setTo] = useState('09:00')
  const [start, setStart] = useState('09:05')
  const [zoomUrl, setZoomUrl] = useState('')

  const students = activeSession ? state.students.filter((s) => s.sessionId === activeSession.id) : []
  const registered = students.filter((s) => s.registrationStatus !== 'not_registered').length
  const ready = students.filter((s) => s.presentationStatus === 'ready' || s.presentationStatus === 'conversion_required').length
  const defended = students.filter((s) => s.defenseStatus === 'defended').length
  const problems = students.filter((s) => s.defenseStatus === 'problem' || s.presentationStatus === 'error').length

  return (
    <div>
      <h1>Адмінка секретаря</h1>
      <div className="panel">
        <h2>Сесії захистів</h2>
        <div className="inline-form">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Назва" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          <input className="wide" value={zoomUrl} onChange={(e) => setZoomUrl(e.target.value)} placeholder="Zoom link / zoommtg://..." />
          <button className="primary" onClick={() => {
            const next = createSession(state, { title, date, registrationOpenFrom: from, registrationOpenTo: to, defenseStartsAt: start, zoomUrl })
            setState(next)
            setActiveSessionId(next.sessions[0].id)
          }}>Створити</button>
        </div>
        <table>
          <thead><tr><th>Назва</th><th>Дата</th><th>Запис</th><th>Групи</th><th>Дії</th></tr></thead>
          <tbody>{state.sessions.map((s) => <tr key={s.id} className={activeSession?.id === s.id ? 'selected-row' : ''}>
            <td>{s.title}</td><td>{s.date}</td><td>{s.registrationOpenFrom}–{s.registrationOpenTo}</td><td>{s.groupNames.join(', ') || '—'}</td>
            <td className="actions compact-actions">
              <button onClick={() => {
                setActiveSessionId(s.id)
                setState({ ...state, activeSessionId: s.id })
              }}>Обрати</button>
              <button className="danger" onClick={() => {
                if (!confirm(`Видалити сесію захисту?\n\n${s.title} · ${s.date}\n\nРазом із нею буде видалено студентів, чергу, презентації, команди та протоколи цієї сесії.`)) return
                const next = removeSession(state, s.id)
                setState(next)
                setActiveSessionId(next.activeSessionId || next.sessions[0]?.id || '')
              }}>Видалити</button>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
      {activeSession && <div className="panel">
        <h2>Режим захистів</h2>
        <div className="toolbar">
          <button className="primary" onClick={() => setState(requestStartDefenses(state, activeSession.id))}>Почати захисти</button>
          <button onClick={() => setState(requestShowDisplay(state, activeSession.id))}>Показати Display на ПК захисту</button>
          <button onClick={() => setState(requestOpenZoom(state, activeSession.id))}>Відкрити Zoom meeting</button>
        </div>
        <small>ПК для захисту отримає команду через спільний стан/Firebase і відкриє потрібний екран у себе.</small>
      </div>}
      {activeSession && <div className="stats-grid">
        <div className="stat"><span>Студентів</span><strong>{students.length}</strong></div>
        <div className="stat"><span>Записано</span><strong>{registered}</strong></div>
        <div className="stat"><span>Презентації</span><strong>{ready}</strong></div>
        <div className="stat"><span>Захистились</span><strong>{defended}</strong></div>
        <div className="stat bad"><span>Проблеми</span><strong>{problems}</strong></div>
      </div>}
    </div>
  )
}

function ImportPanel({ state, setState, session }: { state: AppState; setState: (s: AppState) => void; session: DefenseSession }) {
  const [paste, setPaste] = useState('')
  const review = state.importReviews.find((x) => x.sessionId === session.id)

  async function handleFile(file?: File) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.docx')) {
      alert('У локальній веб-версії зараз стабільно підтримано DOCX. Для PDF використай copy-paste або DOCX-джерело.')
      return
    }
    const imported = await importDocx(file, session.id)
    setState(saveImportReview(state, imported))
  }

  function updateReview(next: ImportReview) {
    setState(updateImportReview(state, next))
  }

  return (
    <div>
      <h1>Імпорт списку</h1>
      <div className="panel">
        <h2>Файл DOCX або вставлений текст</h2>
        <input type="file" accept=".docx" onChange={(e) => void handleFile(e.target.files?.[0])} />
        <textarea className="paste" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Або встав таблицю з Google Docs / Word / Excel..." />
        <button onClick={() => setState(saveImportReview(state, importFromPastedText(paste, session.id)))}>Розпізнати вставлений текст</button>
      </div>
      {review && <div className="panel">
        <div className="panel-head">
          <div><h2>Import Review</h2><p>Група: <b>{review.groupName}</b>; спеціальність: {review.specialtyCode || '—'} {review.specialtyName || ''}; знайдено: {review.students.length}</p></div>
          <button className="primary" onClick={() => setState(confirmImportReview(state, review.id))}>Підтвердити імпорт</button>
        </div>
        <table className="compact">
          <thead><tr><th>✓</th><th>№</th><th>ПІБ</th><th>Група</th><th>Тема</th><th>Керівник</th><th>Попередження</th><th>Дії</th></tr></thead>
          <tbody>{review.students.map((s, idx) => <tr key={s.tempId}>
            <td><input type="checkbox" checked={s.selected} onChange={(e) => {
              const students = [...review.students]; students[idx] = { ...s, selected: e.target.checked }; updateReview({ ...review, students })
            }} /></td>
            <td>{s.rowNumber}</td>
            <td><input value={s.fullName} onChange={(e) => { const students = [...review.students]; students[idx] = { ...s, fullName: e.target.value }; updateReview({ ...review, students }) }} /></td>
            <td><input value={s.groupName} onChange={(e) => { const students = [...review.students]; students[idx] = { ...s, groupName: e.target.value }; updateReview({ ...review, students }) }} /></td>
            <td><textarea value={s.thesisTitle} onChange={(e) => { const students = [...review.students]; students[idx] = { ...s, thesisTitle: e.target.value }; updateReview({ ...review, students }) }} /></td>
            <td><textarea value={s.supervisor} onChange={(e) => { const students = [...review.students]; students[idx] = { ...s, supervisor: e.target.value }; updateReview({ ...review, students }) }} /></td>
            <td>{s.warning || '—'}</td>
            <td className="nowrap"><button className="danger" onClick={() => {
              const students = review.students.filter((x) => x.tempId !== s.tempId)
              updateReview({ ...review, students })
            }}>Видалити</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </div>
  )
}

function StudentsPanel({ state, setState, session, onEdit }: { state: AppState; setState: (s: AppState) => void; session: DefenseSession; onEdit: (s: Student) => void }) {
  const [q, setQ] = useState('')
  const [manual, setManual] = useState({ fullName: '', groupName: session.groupNames[0] || '', thesisTitleEdited: '', supervisorEdited: '' })
  const students = state.students.filter((s) => s.sessionId === session.id && [s.fullName, s.groupName, s.thesisTitleEdited, s.supervisorEdited].join(' ').toLowerCase().includes(q.toLowerCase()))
  return <div>
    <h1>Студенти</h1>
    <div className="panel">
      <h2>Ручне додавання</h2>
      <div className="inline-form wide-inputs">
        <input placeholder="ПІБ" value={manual.fullName} onChange={(e) => setManual({ ...manual, fullName: e.target.value })} />
        <input placeholder="Група" value={manual.groupName} onChange={(e) => setManual({ ...manual, groupName: e.target.value })} />
        <input placeholder="Тема" value={manual.thesisTitleEdited} onChange={(e) => setManual({ ...manual, thesisTitleEdited: e.target.value })} />
        <input placeholder="Керівник" value={manual.supervisorEdited} onChange={(e) => setManual({ ...manual, supervisorEdited: e.target.value })} />
        <button onClick={() => setState(addManualStudent(state, session.id, manual))}>Додати</button>
      </div>
    </div>
    <div className="panel">
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пошук ПІБ / тема / керівник / група" />
      <table>
        <thead><tr><th>ПІБ</th><th>Група</th><th>Тема</th><th>Керівник</th><th>Запис</th><th>Преза</th><th>Захист</th><th>Дії</th></tr></thead>
        <tbody>{students.map((s) => <tr key={s.id}>
          <td>{s.fullName}</td><td>{s.groupName}</td><td className="topic">{s.thesisTitleEdited}</td><td>{s.supervisorEdited}</td>
          <td><StatusBadge value={s.registrationStatus} /></td><td><StatusBadge value={s.presentationStatus} /></td><td><StatusBadge value={s.defenseStatus} /></td>
          <td className="actions compact-actions">
            <button onClick={() => onEdit(s)}>Редагувати</button>
            <button className="danger" onClick={() => {
              if (confirm(`Видалити студента з системи?\n\n${s.fullName}\n\nБуде прибрано з черги, протоколів і статусів презентації.`)) {
                setState(removeStudent(state, s.id))
              }
            }}>Видалити</button>
          </td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>
}

function QueuePanel({ state, setState, session, onEdit }: { state: AppState; setState: (s: AppState) => void; session: DefenseSession; onEdit: (s: Student) => void }) {
  const queue = state.queue.filter((q) => q.sessionId === session.id).sort((a, b) => a.position - b.position)
  const students = state.students.filter((s) => s.sessionId === session.id)
  const byId = new Map(students.map((s) => [s.id, s]))
  const notQueued = students.filter((s) => !queue.some((q) => q.studentId === s.id))
  const defended = students.filter((s) => s.defenseStatus === 'defended')
  return <div>
    <h1>Черга захисту</h1>
    <div className="toolbar">
      <button onClick={() => setState(setRegistrationLock(state, session.id, true, false))}>Закрити запис</button>
      <button onClick={() => setState(setRegistrationLock(state, session.id, false, true))}>Ручне розблокування</button>
      <button className="primary" onClick={() => setState(requestStartDefenses(state, session.id))}>Почати захисти</button>
      <button onClick={() => setState(requestShowDisplay(state, session.id))}>Display fullscreen</button>
      <button onClick={() => setState(requestOpenZoom(state, session.id))}>Відкрити Zoom meeting</button>
      <button onClick={() => downloadTextFile(`backup_${session.date}.json`, JSON.stringify(state, null, 2))}>Експорт backup</button>
    </div>
    <div className="panel">
      <h2>Поточна черга</h2>
      <table>
        <thead><tr><th>№</th><th>ПІБ</th><th>Формат</th><th>Преза</th><th>Захист</th><th>Дії</th></tr></thead>
        <tbody>{queue.map((q) => {
          const s = byId.get(q.studentId); if (!s) return null
          return <tr key={q.id}>
            <td>{q.position}</td><td><b>{s.fullName}</b><br/><small>{s.groupName} · {s.thesisTitleEdited}</small></td>
            <td><StatusBadge value={s.defenseFormat || 'offline'} /><br/><button onClick={() => setState(updateStudent(state, s.id, { defenseFormat: (s.defenseFormat || 'offline') === 'online' ? 'offline' : 'online' }))}>{(s.defenseFormat || 'offline') === 'online' ? 'Зробити очно' : 'Зробити онлайн'}</button></td>
            <td><StatusBadge value={s.presentationStatus} /></td><td><StatusBadge value={s.defenseStatus} /></td>
            <td className="actions">
              <button onClick={() => setState(reorderQueue(state, session.id, s.id, -1))}>↑</button>
              <button onClick={() => setState(reorderQueue(state, session.id, s.id, 1))}>↓</button>
              <button onClick={() => setState(requestOpenPresentation(state, session.id, s.id))}>{(s.defenseFormat || 'offline') === 'online' ? 'Відкрити Zoom' : 'Відкрити презу'}</button>
              <button onClick={() => setState(requestShowDisplay(state, session.id))}>Повернути Display</button>
              <button onClick={() => setState(setDefenseStatus(state, s.id, 'defended'))}>Захистився</button>
              <button onClick={() => setState(removeFromQueue(setDefenseStatus(state, s.id, 'defended'), session.id, s.id))}>Захистився + прибрати</button>
              <button onClick={() => setState(setDefenseStatus(state, s.id, 'absent'))}>Відсутній</button>
              <button onClick={() => {
                const note = prompt('Опишіть проблему захисту')?.trim()
                if (note === undefined) return
                const withNote = note ? updateStudent(state, s.id, { notes: [s.notes, note].filter(Boolean).join('\n') }) : state
                setState(setDefenseStatus(withNote, s.id, 'problem'))
              }}>Проблема</button>
              <button onClick={() => onEdit(s)}>Ред.</button>
              <button onClick={() => setState(removeFromQueue(state, session.id, s.id))}>Прибрати з черги</button>
              <button className="danger" onClick={() => {
                if (confirm(`Видалити студента з системи?\n\n${s.fullName}\n\nБуде прибрано з черги, протоколів і статусів презентації.`)) {
                  setState(removeStudent(state, s.id))
                }
              }}>Видалити</button>
            </td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <div className="panel">
      <h2>Не в черзі</h2>
      {notQueued.map((s) => <div className="list-row" key={s.id}><span>{s.fullName} · {s.groupName}</span><div className="actions compact-actions"><button onClick={() => setState(addToQueue(state, s.id, 'admin'))}>Додати вручну</button><button className="danger" onClick={() => {
        if (confirm(`Видалити студента з системи?\n\n${s.fullName}\n\nБуде прибрано з черги, протоколів і статусів презентації.`)) {
          setState(removeStudent(state, s.id))
        }
      }}>Видалити</button></div></div>)}
    </div>
    <details className="panel"><summary>Захистились за {session.date} — {defended.length}</summary>{defended.map((s) => <div className="list-row" key={s.id}><span>{s.fullName}</span><button onClick={() => setState(requestOpenPresentation(state, session.id, s.id))}>Відкрити презентацію</button></div>)}</details>
  </div>
}

function normalizeProtocolGroup(value: string): string {
  return value.trim().toLocaleUpperCase('uk-UA').replace(/\s+/g, '')
}

function protocolGroupKey(groupName: string): string {
  const value = normalizeProtocolGroup(groupName)
  if (/^(ІСТС|ІСТ|ICTS|ICT|ISTS|IST)/.test(value)) return 'ist'
  if (/^(КІС|KIS)/.test(value)) return 'kis'
  if (/^(КІ|KI)/.test(value)) return 'ki'
  return value ? `other_${value.replace(/[^A-ZА-ЯІЇЄҐ0-9]+/g, '_')}` : 'other'
}

function protocolGroupLabel(groupKey: string, students: Student[]): string {
  if (groupKey === 'ist') return 'ІСТ / ІСТс'
  if (groupKey === 'ki') return 'КІ'
  if (groupKey === 'kis') return 'КІс'
  return students[0]?.groupName || 'Інша група'
}

function buildProtocol(session: DefenseSession, groupKey: string, groupLabel: string, protocolDate: string, students: Student[], defaults: Partial<ProtocolRow>, existing?: ProtocolSnapshot): ProtocolSnapshot {
  const savedRows = new Map((existing?.rows || []).map((row) => [row.studentId, row]))
  const rows = students.map((student, idx) => {
    const saved = savedRows.get(student.id)
    return {
      studentId: student.id,
      order: saved?.order || idx + 1,
      groupName: saved?.groupName || student.groupName,
      studentName: saved?.studentName || student.fullName,
      thesisTitle: saved?.thesisTitle || student.thesisTitleEdited,
      supervisor: saved?.supervisor || student.supervisorEdited,
      pagesCount: saved?.pagesCount ?? defaults.pagesCount,
      drawingsCount: saved?.drawingsCount ?? defaults.drawingsCount,
      supervisorReview: saved?.supervisorReview ?? defaults.supervisorReview,
      reviewerGrade: saved?.reviewerGrade ?? defaults.reviewerGrade,
      commissionMembersCount: saved?.commissionMembersCount ?? defaults.commissionMembersCount,
      questions: saved?.questions ?? defaults.questions ?? '',
      commissionDecision: saved?.commissionDecision ?? defaults.commissionDecision,
      diplomaType: saved?.diplomaType ?? defaults.diplomaType
    }
  }).sort((a, b) => a.order - b.order)
  const now = nowIso()
  return {
    id: `protocol_${session.id}_${groupKey}`,
    sessionId: session.id,
    title: `Протокол ${groupLabel}${protocolDate ? ` ${protocolDate}` : ''}`,
    date: protocolDate,
    groupName: groupLabel,
    groupKey,
    rows,
    defaultValues: defaults,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
}

function ProtocolPanel({ state, setState, session }: { state: AppState; setState: (s: AppState) => void; session: DefenseSession }) {
  const [defaults, setDefaults] = useState<Partial<ProtocolRow>>({ pagesCount: '60', drawingsCount: '3', supervisorReview: 'робота виконана на задовільному рівні', reviewerGrade: 'добре', commissionMembersCount: '5', commissionDecision: 'бакалавра з інформаційних систем та технологій', diplomaType: 'звичайного зразка', questions: '' })
  const [selectedGroupKey, setSelectedGroupKey] = useState('')
  const [protocolDate, setProtocolDate] = useState('')
  const [drafts, setDrafts] = useState<Record<string, ProtocolSnapshot>>({})
  const studentsById = useMemo(() => new Map(state.students.map((s) => [s.id, s])), [state.students])
  const protocolBuckets = useMemo(() => {
    const queueOrder = new Map(state.queue.filter((q) => q.sessionId === session.id).map((q) => [q.studentId, q.position]))
    const defendedStudents = state.students
      .filter((s) => s.sessionId === session.id && s.defenseStatus === 'defended')
      .sort((a, b) => {
        const aq = queueOrder.get(a.id) ?? 9999
        const bq = queueOrder.get(b.id) ?? 9999
        return aq - bq || a.groupName.localeCompare(b.groupName, 'uk') || a.fullName.localeCompare(b.fullName, 'uk')
      })
    const grouped = defendedStudents.reduce<Record<string, Student[]>>((acc, student) => {
      const key = protocolGroupKey(student.groupName)
      acc[key] = [...(acc[key] || []), student]
      return acc
    }, {})
    return Object.entries(grouped).flatMap(([baseKey, students]) => {
      const baseLabel = protocolGroupLabel(baseKey, students)
      const chunks: Array<{ key: string; label: string; students: Student[] }> = []
      for (let index = 0; index < students.length; index += 12) {
        const chunkIndex = Math.floor(index / 12) + 1
        chunks.push({
          key: `${baseKey}_${chunkIndex}`,
          label: students.length > 12 ? `${baseLabel}, протокол ${chunkIndex}` : baseLabel,
          students: students.slice(index, index + 12)
        })
      }
      return chunks
    })
  }, [state.students, state.queue, session.id])
  const groupKeys = protocolBuckets.map((bucket) => bucket.key)
  const currentGroupKey = groupKeys.includes(selectedGroupKey) ? selectedGroupKey : groupKeys[0] || 'other'
  const currentBucket = protocolBuckets.find((bucket) => bucket.key === currentGroupKey)
  const currentStudents = currentBucket?.students || []
  const groupLabel = currentBucket?.label || 'Протокол'
  const savedProtocol = state.protocols.find((p) => p.sessionId === session.id && (p.groupKey === currentGroupKey || (!p.groupKey && p.groupName === groupLabel)))
  const effectiveProtocolDate = protocolDate || savedProtocol?.date || ''
  const protocol = useMemo(() => buildProtocol(session, currentGroupKey, groupLabel, effectiveProtocolDate, currentStudents, defaults, drafts[currentGroupKey] || savedProtocol), [session, currentGroupKey, groupLabel, effectiveProtocolDate, currentStudents, defaults, drafts, savedProtocol])

  function updateDraft(next: ProtocolSnapshot) {
    setDrafts((prev) => ({ ...prev, [currentGroupKey]: { ...next, updatedAt: nowIso() } }))
  }

  function updateRow(studentId: string, patch: Partial<ProtocolRow>) {
    updateDraft({
      ...protocol,
      rows: protocol.rows.map((row) => row.studentId === studentId ? { ...row, ...patch } : row)
    })
  }

  function applyDefaultsToRows() {
    updateDraft({
      ...protocol,
      defaultValues: defaults,
      rows: protocol.rows.map((row) => ({ ...row, ...defaults }))
    })
  }

  function printProtocol() {
    const html = document.getElementById('protocol-preview')?.innerHTML || ''
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<html><head><title>${protocol.title}</title><style>body{font-family:Times New Roman,serif;font-size:11px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:3px;vertical-align:top}.center{text-align:center}</style></head><body>${html}</body></html>`)
    w.document.close(); w.print()
  }

  return <div>
    <h1>Протокол</h1>
    <div className="panel">
      <h2>Окремі протоколи за групами</h2>
      <div className="toolbar">
        {protocolBuckets.map((bucket) => <button key={bucket.key} className={bucket.key === currentGroupKey ? 'active' : ''} onClick={() => setSelectedGroupKey(bucket.key)}>{bucket.label} ({bucket.students.length})</button>)}
      </div>
      <p className="hint">Протокол заповнюється тільки студентами зі статусом “Захистився”. Один протокол містить максимум 12 осіб. ІСТ та ІСТс формуються разом, КІ і КІс окремо.</p>
      {!protocolBuckets.length && <p className="hint">Поки немає підтверджених захистів. Натисніть “Захистився” у черзі, і студент зʼявиться тут.</p>}
    </div>
    <div className="panel">
      <h2>Значення за замовчуванням</h2>
      <label className="single-field">Дата протоколу<input value={effectiveProtocolDate} onChange={(e) => setProtocolDate(e.target.value)} placeholder="Заповните вручну пізніше" /></label>
      <div className="form-grid">
        {Object.entries(defaults).map(([k, v]) => <label key={k}>{k}<input value={String(v || '')} onChange={(e) => setDefaults({ ...defaults, [k]: e.target.value })} /></label>)}
      </div>
      <div className="toolbar">
        <button onClick={applyDefaultsToRows}>Застосувати до рядків</button>
        <button className="primary" onClick={() => setState(saveProtocol(state, { ...protocol, updatedAt: nowIso() }))}>Зберегти протокол</button>
        <button onClick={printProtocol}>Друк / PDF</button>
      </div>
    </div>
    <div className="panel">
      <h2>Редагування протоколу: {groupLabel}</h2>
      <table className="compact">
        <thead><tr><th>№</th><th>Група</th><th>ПІБ</th><th>Тема</th><th>Керівник</th><th>Стор.</th><th>Арк.</th><th>Відгук</th><th>Оц. рец.</th><th>К-ть</th><th>Питання</th><th>Рішення</th><th>Диплом</th></tr></thead>
        <tbody>{protocol.rows.map((row) => {
          const student = studentsById.get(row.studentId)
          return <tr key={row.studentId}>
            <td><input className="tiny-input" value={row.order} onChange={(e) => updateRow(row.studentId, { order: Number(e.target.value) || row.order })} /></td>
            <td><input value={row.groupName || student?.groupName || ''} onChange={(e) => updateRow(row.studentId, { groupName: e.target.value })} /></td>
            <td><textarea value={row.studentName || student?.fullName || ''} onChange={(e) => updateRow(row.studentId, { studentName: e.target.value })} /></td>
            <td><textarea value={row.thesisTitle || student?.thesisTitleEdited || ''} onChange={(e) => updateRow(row.studentId, { thesisTitle: e.target.value })} /></td>
            <td><textarea value={row.supervisor || student?.supervisorEdited || ''} onChange={(e) => updateRow(row.studentId, { supervisor: e.target.value })} /></td>
            <td><input className="tiny-input" value={row.pagesCount || ''} onChange={(e) => updateRow(row.studentId, { pagesCount: e.target.value })} /></td>
            <td><input className="tiny-input" value={row.drawingsCount || ''} onChange={(e) => updateRow(row.studentId, { drawingsCount: e.target.value })} /></td>
            <td><textarea value={row.supervisorReview || ''} onChange={(e) => updateRow(row.studentId, { supervisorReview: e.target.value })} /></td>
            <td><input value={row.reviewerGrade || ''} onChange={(e) => updateRow(row.studentId, { reviewerGrade: e.target.value })} /></td>
            <td><input className="tiny-input" value={row.commissionMembersCount || ''} onChange={(e) => updateRow(row.studentId, { commissionMembersCount: e.target.value })} /></td>
            <td><textarea value={row.questions || ''} onChange={(e) => updateRow(row.studentId, { questions: e.target.value })} /></td>
            <td><textarea value={row.commissionDecision || ''} onChange={(e) => updateRow(row.studentId, { commissionDecision: e.target.value })} /></td>
            <td><input value={row.diplomaType || ''} onChange={(e) => updateRow(row.studentId, { diplomaType: e.target.value })} /></td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <div className="panel protocol" id="protocol-preview">
      <h3 className="center">ПРОТОКОЛ № ___ від “___” __________ 20__ р.</h3>
      <p className="center">по розгляду дипломних проєктів / робіт. Дата: {effectiveProtocolDate || '________________'}. Група: {groupLabel}</p>
      <table><thead><tr><th>№</th><th>ПІБ студента</th><th>Група</th><th>Тема дипломного проєкту / роботи</th><th>Керівник</th><th>Стор.</th><th>Арк.</th><th>Відгук</th><th>Оц. рец.</th><th>К-ть членів</th><th>Питання</th><th>Рішення</th><th>Диплом</th></tr></thead>
      <tbody>{protocol.rows.map((row, idx) => <tr key={row.studentId}><td>{row.order || idx + 1}</td><td>{row.studentName}</td><td>{row.groupName}</td><td>{row.thesisTitle}</td><td>{row.supervisor}</td><td>{row.pagesCount}</td><td>{row.drawingsCount}</td><td>{row.supervisorReview}</td><td>{row.reviewerGrade}</td><td>{row.commissionMembersCount}</td><td>{row.questions}</td><td>{row.commissionDecision}</td><td>{row.diplomaType}</td></tr>)}</tbody></table>
    </div>
  </div>
}

function DiagnosticsPanel({ state, activeSession }: { state: AppState; activeSession?: DefenseSession }) {
  const pendingCommands = state.commands.filter((c) => c.status === 'pending').length
  const failedCommands = state.commands.filter((c) => c.status === 'error').length
  const onlineStations = state.stations.filter((station) => station.online)
  const activeSessionStudents = activeSession ? state.students.filter((s) => s.sessionId === activeSession.id).length : 0
  return <div><h1>Діагностика</h1><div className="panel"><h2>Стан системи</h2>
    <ul className="checklist">
      <li>Web UI запущено</li>
      <li>Firebase config: {isFirebaseEnabled() ? 'підключено' : 'не знайдено env-конфіг'}</li>
      <li>Активна сесія: {activeSession ? activeSession.title + ' · ' + activeSession.date : 'не обрано'}</li>
      <li>Студенти активної сесії: {activeSessionStudents}</li>
      <li>Electron Agent онлайн: {onlineStations.length ? onlineStations.map((s) => s.name || s.id).join(', ') : 'не бачимо станцію'}</li>
      <li>Upload URL Agent: {onlineStations.length ? onlineStations.map((s) => s.lanUploadUrl || s.localUploadUrl || 'без upload URL').join(', ') : '—'}</li>
      <li>Команди агента pending: {pendingCommands}</li>
      <li>Команди з помилкою: {failedCommands}</li>
    </ul>
    {!onlineStations.length && <p className="hint">Якщо презентації мають відкриватися на ПК захисту, запустіть Electron Agent на цьому ПК і перевірте Firestore rules для dek_stations/dek_commands.</p>}
  </div></div>
}
