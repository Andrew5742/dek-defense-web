import { useMemo, useState } from 'react'
import type { AppState, DefenseSession, ImportReview, ProtocolSnapshot, Student } from '../shared/types'
import { downloadTextFile, formatLocalDateTime, nowIso, uid } from '../shared/utils'
import { addManualStudent, addToQueue, confirmImportReview, createSession, removeFromQueue, removeStudent, reorderQueue, requestOpenPresentation, requestOpenZoom, requestShowDisplay, requestStartDefenses, saveImportReview, saveProtocol, setDefenseStatus, setRegistrationLock, updateImportReview, updateStudent } from '../services/actions'
import { importDocx, importFromPastedText } from '../services/importService'
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
          <thead><tr><th>Назва</th><th>Дата</th><th>Запис</th><th>Групи</th><th></th></tr></thead>
          <tbody>{state.sessions.map((s) => <tr key={s.id} className={activeSession?.id === s.id ? 'selected-row' : ''}>
            <td>{s.title}</td><td>{s.date}</td><td>{s.registrationOpenFrom}–{s.registrationOpenTo}</td><td>{s.groupNames.join(', ') || '—'}</td>
            <td><button onClick={() => setActiveSessionId(s.id)}>Обрати</button></td>
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

function ProtocolPanel({ state, setState, session }: { state: AppState; setState: (s: AppState) => void; session: DefenseSession }) {
  const queueStudents = state.queue.filter((q) => q.sessionId === session.id).sort((a,b)=>a.position-b.position).map((q) => state.students.find((s) => s.id === q.studentId)).filter(Boolean) as Student[]
  const selected = queueStudents.slice(0, 12)
  const [defaults, setDefaults] = useState({ pagesCount: '60', drawingsCount: '3', supervisorReview: 'робота виконана на задовільному рівні', reviewerGrade: 'добре', commissionMembersCount: '5', commissionDecision: 'бакалавра з інформаційних систем та технологій', diplomaType: 'звичайного зразка' })
  const protocol = useMemo<ProtocolSnapshot>(() => ({
    id: uid('protocol'), sessionId: session.id, title: `Протокол ${session.date}`, date: session.date,
    rows: selected.map((s, idx) => ({ studentId: s.id, order: idx + 1, ...defaults })), defaultValues: defaults,
    createdAt: nowIso(), updatedAt: nowIso()
  }), [session.id, session.date, selected.length, JSON.stringify(defaults)])

  function printProtocol() {
    const html = document.getElementById('protocol-preview')?.innerHTML || ''
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<html><head><title>Протокол</title><style>body{font-family:Times New Roman,serif;font-size:11px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:3px;vertical-align:top}.center{text-align:center}</style></head><body>${html}</body></html>`)
    w.document.close(); w.print()
  }

  return <div>
    <h1>Протокол</h1>
    <div className="panel">
      <h2>Автозаповнення колонок</h2>
      <div className="form-grid">
        {Object.entries(defaults).map(([k, v]) => <label key={k}>{k}<input value={v} onChange={(e) => setDefaults({ ...defaults, [k]: e.target.value })} /></label>)}
      </div>
      <div className="toolbar"><button onClick={() => setState(saveProtocol(state, protocol))}>Зберегти snapshot</button><button onClick={printProtocol}>Друк / PDF</button></div>
    </div>
    <div className="panel protocol" id="protocol-preview">
      <h3 className="center">ПРОТОКОЛ № ___ від “___” __________ 20__ р.</h3>
      <p className="center">по розгляду дипломних проєктів / робіт. Дата: {session.date}</p>
      <table><thead><tr><th>№</th><th>ПІБ студента</th><th>Тема дипломного проєкту / роботи</th><th>Керівник</th><th>Стор.</th><th>Арк.</th><th>Відгук</th><th>Оц. рец.</th><th>К-ть членів</th><th>Питання</th><th>Рішення</th><th>Диплом</th></tr></thead>
      <tbody>{selected.map((s, idx) => <tr key={s.id}><td>{idx+1}</td><td>{s.fullName}</td><td>{s.thesisTitleEdited}</td><td>{s.supervisorEdited}</td><td>{defaults.pagesCount}</td><td>{defaults.drawingsCount}</td><td>{defaults.supervisorReview}</td><td>{defaults.reviewerGrade}</td><td>{defaults.commissionMembersCount}</td><td></td><td>{defaults.commissionDecision}</td><td>{defaults.diplomaType}</td></tr>)}</tbody></table>
    </div>
  </div>
}

function DiagnosticsPanel({ state, activeSession }: { state: AppState; activeSession?: DefenseSession }) {
  const pendingCommands = state.commands.filter((c) => c.status === 'pending').length
  return <div><h1>Діагностика</h1><div className="panel"><h2>Preflight local/demo</h2>
    <ul className="checklist">
      <li>✅ Web UI запущений локально</li>
      <li>{activeSession ? '✅' : '⚠️'} Активна сесія</li>
      <li>{state.students.length ? '✅' : '⚠️'} Імпортовані студенти</li>
      <li>{pendingCommands ? '⚠️' : '✅'} Команди агента: {pendingCommands} pending</li>
      <li>⚠️ Firebase ще не підключено</li>
      <li>⚠️ Реальний Local Defense Agent для файлового диску буде наступним модулем</li>
    </ul>
  </div></div>
}
