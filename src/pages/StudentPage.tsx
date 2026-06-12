import { useEffect, useState } from 'react'
import type { AppState, DefenseSession, Student } from '../shared/types'
import { canRegister } from '../shared/utils'
import { getAgentUploadPageUrl } from '../services/actions'
import { StatusBadge } from '../components/StatusBadge'

type Props = { state: AppState; setState: (s: AppState) => void; activeSession?: DefenseSession; publicMode?: boolean }

function buildUploadPageUrl(baseUrl: string, student: Student) {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/upload-page`)
  url.searchParams.set('sessionId', student.sessionId)
  url.searchParams.set('studentId', student.id)
  url.searchParams.set('studentName', student.fullName)
  url.searchParams.set('returnUrl', window.location.href)
  return url.toString()
}

export function StudentPage({ state, activeSession, publicMode = false }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Student | null>(null)
  const [desktopUploadPageUrl, setDesktopUploadPageUrl] = useState('')

  useEffect(() => {
    let disposed = false
    setDesktopUploadPageUrl('')
    if (!selected || !window.dekAgent?.getStatus) return
    window.dekAgent.getStatus().then((status) => {
      if (disposed) return
      const base = status.lanUploadUrl || status.uploadUrl
      if (base) setDesktopUploadPageUrl(buildUploadPageUrl(base, selected))
    }).catch(() => undefined)
    return () => { disposed = true }
  }, [selected])

  if (!activeSession) return <main className="student-wrap"><div className="student-box"><h1>Сесію не обрано</h1></div></main>

  const open = canRegister(activeSession)
  const students = state.students
    .filter((s) => s.sessionId === activeSession.id && s.isAllowedToRegister)
    .filter((s) => [s.fullName, s.groupName, s.thesisTitleEdited].join(' ').toLowerCase().includes(query.toLowerCase()))
    .slice(0, 20)
  const selectedAgentUploadPageUrl = selected ? getAgentUploadPageUrl(state, selected) || desktopUploadPageUrl : undefined

  return <main className="student-wrap">
    <div className="student-box">
      <div className="student-head">
        <h1>Запис на захист</h1>
        <p>{activeSession.title} · {activeSession.date} · запис {activeSession.registrationOpenFrom}-{activeSession.registrationOpenTo}</p>
        {publicMode && <small className="role-note">Desktop-режим ПК захисту. Адмінка з цієї сторінки недоступна.</small>}
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
          <p className="hint">Файл зберігається локально на цьому ПК захисту через Electron Agent. PPTX/PPT/ODP буде відкрито напряму через PowerPoint у повноекранному режимі.</p>
          {selectedAgentUploadPageUrl
            ? <p><button type="button" onClick={() => { window.location.href = selectedAgentUploadPageUrl }}>Відкрити завантаження через Electron Agent</button></p>
            : <div className="closed-box">Electron Agent ще не передав адресу завантаження. Перевірте, що десктопна апка запущена саме на ПК захисту.</div>}
          {selected.presentationStatus === 'ready' && <div className="ok-box">Презентація завантажена і готова до відкриття.</div>}
          {selected.presentationStatus === 'conversion_required' && <div className="warn-box">Презентація завантажена. Для PPT/PPTX/ODP система відкриє файл напряму через PowerPoint.</div>}
          {selected.presentationStatus === 'error' && <div className="closed-box">
            Презентацію не передано в Electron Agent. Зверніться до секретаря або перевірте, що Agent запущений на ПК захисту.
            {selected.notes && <><br /><small>{selected.notes.split('\n').slice(-1)[0]}</small></>}
          </div>}
        </div> : <div className="closed-box">Запис закрито. Зверніться до секретаря.</div>}
      </div>}
    </div>
  </main>
}
