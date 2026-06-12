import { useState } from 'react'
import type { AppState, DefenseSession, Student } from '../shared/types'
import { canRegister } from '../shared/utils'
import { uploadPresentation } from '../services/actions'
import { StatusBadge } from '../components/StatusBadge'

type Props = { state: AppState; setState: (s: AppState) => void; activeSession?: DefenseSession; publicMode?: boolean }

export function StudentPage({ state, setState, activeSession, publicMode = false }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Student | null>(null)
  const [busy, setBusy] = useState(false)
  if (!activeSession) return <main className="student-wrap"><div className="student-box"><h1>Сесія не обрана</h1></div></main>

  const open = canRegister(activeSession)
  const students = state.students
    .filter((s) => s.sessionId === activeSession.id && s.isAllowedToRegister)
    .filter((s) => [s.fullName, s.groupName, s.thesisTitleEdited].join(' ').toLowerCase().includes(query.toLowerCase()))
    .slice(0, 20)

  async function handleUpload(file?: File) {
    if (!file || !selected) return
    setBusy(true)
    const next = await uploadPresentation(state, selected.id, file, 'student')
    setState(next)
    const updated = next.students.find((s) => s.id === selected.id) || selected
    setSelected(updated)
    setBusy(false)
  }

  return <main className="student-wrap">
    <div className="student-box">
      <div className="student-head">
        <h1>Запис на захист</h1>
        <p>{activeSession.title} · {activeSession.date} · запис {activeSession.registrationOpenFrom}–{activeSession.registrationOpenTo}</p>
        {publicMode && <small className="role-note">Окремий студентський режим. Адмінка з цієї сторінки недоступна.</small>}
      </div>
      {!open && <div className="closed-box">Запис на захист закрито. Якщо ви не встигли записатися, будь ласка, зверніться до представників комісії.</div>}
      {!selected && <>
        <label className="big-search">Введіть своє прізвище<input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Наприклад: Яковчук" /></label>
        <div className="student-results">
          {query.length > 1 && students.map((s) => <button className="student-result" key={s.id} onClick={() => setSelected(s)} disabled={!open}>
            <b>{s.fullName}</b><span>{s.groupName}</span><small>{s.thesisTitleEdited}</small>
          </button>)}
          {query.length > 1 && students.length === 0 && <div className="empty">Не знайдено. Перевірте ПІБ або зверніться до секретаря.</div>}
        </div>
      </>}
      {selected && <div className="confirm-card">
        <button onClick={() => setSelected(null)}>← Назад до пошуку</button>
        <h2>{selected.fullName}</h2>
        <p><b>Група:</b> {selected.groupName}</p>
        <p><b>Тема:</b> {selected.thesisTitleEdited}</p>
        <p><b>Керівник:</b> {selected.supervisorEdited}</p>
        <p><b>Статус:</b> <StatusBadge value={selected.registrationStatus} /> <StatusBadge value={selected.presentationStatus} /></p>
        {open ? <div className="upload-box">
          <h3>Щоб завершити запис, обов’язково завантажте презентацію</h3>
          <p>Дозволені формати: PDF, PPTX, PPT, ODP.</p>
          <p className="hint">PPTX/PPT/ODP мають завантажуватися напряму в Electron Agent на ПК захисту. Якщо Agent недоступний у мережі, система покаже помилку і попросить звернутися до секретаря.</p>
          <input type="file" accept=".pdf,.pptx,.ppt,.odp" disabled={busy} onChange={(e) => void handleUpload(e.target.files?.[0])} />
          {busy && <p>Завантаження...</p>}
          {selected.presentationStatus === 'ready' && <div className="ok-box">Презентація завантажена і готова до відкриття.</div>}
          {selected.presentationStatus === 'conversion_required' && <div className="warn-box">Презентація завантажена. Потрібна конвертація в PDF через Local Defense Agent.</div>}
          {selected.presentationStatus === 'error' && <div className="closed-box">Презентацію не передано в Electron Agent. Зверніться до секретаря або перевірте, що Agent запущений на ПК захисту.</div>}
        </div> : <div className="closed-box">Запис закрито. Зверніться до секретаря.</div>}
      </div>}
    </div>
  </main>
}
