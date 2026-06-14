import { useEffect, useMemo, useState } from 'react'
import type { AppState, DefenseSession, Student } from '../shared/types'
import { canRegister } from '../shared/utils'
import { getAgentUploadPageUrl, updateStudent } from '../services/actions'
import { StatusBadge } from '../components/StatusBadge'

type Props = {
  state: AppState
  setState: (s: AppState) => void
  activeSession?: DefenseSession
  publicMode?: boolean
  onStartFullscreen?: () => void
}

function buildUploadPageUrl(baseUrl: string, student: Student, session?: DefenseSession) {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/upload-page`)
  url.searchParams.set('sessionId', student.sessionId)
  url.searchParams.set('studentId', student.id)
  url.searchParams.set('studentName', student.fullName)
  url.searchParams.set('returnUrl', window.location.href)
  if (session?.zoomUrl) url.searchParams.set('zoomUrl', session.zoomUrl)
  if (student.wantsZoomDemo) url.searchParams.set('wantsZoomDemo', '1')
  return url.toString()
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function StudentPage({ state, setState, activeSession, publicMode = false, onStartFullscreen }: Props) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [desktopUploadPageUrl, setDesktopUploadPageUrl] = useState('')

  const selected = selectedId ? state.students.find((student) => student.id === selectedId) || null : null

  useEffect(() => {
    let disposed = false
    setDesktopUploadPageUrl('')
    if (!selected || !window.dekAgent?.getStatus) return
    window.dekAgent.getStatus().then((status) => {
      if (disposed) return
      const base = status.lanUploadUrl || status.uploadUrl
      if (base) setDesktopUploadPageUrl(buildUploadPageUrl(base, selected, activeSession))
    }).catch(() => undefined)
    return () => { disposed = true }
  }, [selected?.id, activeSession?.zoomUrl])

  const open = activeSession ? canRegister(activeSession) : false
  const search = normalizeSearch(query)
  const students = useMemo(() => {
    if (!activeSession) return []
    return state.students
      .filter((student) => student.sessionId === activeSession.id && student.isAllowedToRegister)
      .filter((student) => normalizeSearch([student.fullName, student.groupName, student.thesisTitleEdited].join(' ')).includes(search))
      .slice(0, 20)
  }, [activeSession?.id, state.students, search])

  if (!activeSession) {
    return <main className="student-wrap"><div className="student-box"><h1>Сесію не обрано</h1></div></main>
  }

  const selectedAgentUploadPageUrl = selected ? getAgentUploadPageUrl(state, selected) || desktopUploadPageUrl : undefined
  const selectedQueueItem = selected ? state.queue.find((item) => item.sessionId === selected.sessionId && item.studentId === selected.id) : undefined
  const selectedHasPresentation = selected?.presentationStatus === 'ready' || selected?.presentationStatus === 'conversion_required'
  const companionToken = selected?.token || selected?.id || ''
  const companionUrl = `${import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin}/s/${companionToken}`

  function patchSelected(patch: Partial<Student>) {
    if (!selected) return
    setState(updateStudent(state, selected.id, patch, 'student'))
  }

  return <main className="student-wrap">
    <div className="student-box">
      <div className="student-head">
        <div>
          <h1>Запис на захист</h1>
          <p>{activeSession.title} · {activeSession.date} · запис {activeSession.registrationOpenFrom}-{activeSession.registrationOpenTo}</p>
          {publicMode && <small className="role-note">Desktop-режим ПК захисту. Адмінка з цієї сторінки недоступна.</small>}
        </div>
        {publicMode && onStartFullscreen && <button type="button" onClick={onStartFullscreen}>Повноекранний запис</button>}
      </div>

      <div className="student-instruction">
        <b>Як записатися:</b>
        <ol>
          <li>Введіть своє прізвище й оберіть себе зі списку.</li>
          <li>Перевірте ПІБ, групу, тему та керівника.</li>
          <li>Якщо треба показувати результат роботи в Zoom, поставте відповідну галочку.</li>
          <li>Натисніть “Відкрити завантаження через Electron Agent” і завантажте презентацію.</li>
          <li>Після успішного завантаження натисніть “Підтвердити запис”.</li>
        </ol>
        <p>Обов’язкова презентація: PDF, PPTX, PPT або ODP. Відео можна додати за потреби: MP4, MOV, AVI, MKV або WEBM.</p>
      </div>

      {!open && <div className="closed-box">Запис на захист закрито. Якщо ви не встигли записатися, зверніться до представників комісії.</div>}

      {!selected && <>
        <label className="big-search">Введіть своє прізвище
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Наприклад: Яковчук" />
        </label>
        <div className="student-results">
          {query.length > 1 && students.map((student) => <button className="student-result" key={student.id} onClick={() => setSelectedId(student.id)} disabled={!open}>
            <b>{student.fullName}</b>
            <span>{student.groupName}</span>
            <small>{student.thesisTitleEdited}</small>
          </button>)}
          {query.length > 1 && students.length === 0 && <div className="empty">Не знайдено. Перевірте ПІБ або зверніться до секретаря.</div>}
        </div>
      </>}

      {selected && <div className="confirm-card">
        <button onClick={() => setSelectedId('')}>← Назад до пошуку</button>
        <h2>{selected.fullName}</h2>
        <p><b>Група:</b> {selected.groupName}</p>
        <p><b>Тема:</b> {selected.thesisTitleEdited}</p>
        <p><b>Керівник:</b> {selected.supervisorEdited}</p>
        <p><b>Статус:</b> <StatusBadge value={selected.registrationStatus} /> <StatusBadge value={selected.presentationStatus} /> {selected.hasVideo && <span className="status info">відео</span>} {selected.wantsZoomDemo && <span className="status info">показ результату в Zoom</span>}</p>

        {selectedQueueItem && <div className="ok-box">Ви вже в черзі під номером {selectedQueueItem.position}. Повторно записуватися не потрібно.</div>}

        {open ? <div className="upload-box">
          <h3>Щоб завершити запис, обов’язково завантажте презентацію</h3>
          <p>Дозволені формати презентації: PDF, PPTX, PPT, ODP. Відео є необов’язковим: MP4, MOV, AVI, MKV, WEBM.</p>
          <p className="hint">Файли зберігаються локально на цьому ПК захисту через Electron Agent. PPTX/PPT/ODP відкриваються через PowerPoint у повноекранному режимі.</p>

          <label className="check-row">
            <input type="checkbox" checked={selected.wantsZoomDemo === true} onChange={(event) => patchSelected({ wantsZoomDemo: event.target.checked })} />
            Бажаю демонструвати в Zoom результати роботи
          </label>
          {selected.wantsZoomDemo && activeSession.zoomUrl && <div className="zoom-help">
            <b>Zoom для демонстрації:</b>
            <a href={activeSession.zoomUrl} target="_blank" rel="noreferrer">{activeSession.zoomUrl}</a>
            <button type="button" onClick={() => navigator.clipboard?.writeText(activeSession.zoomUrl || '')}>Скопіювати</button>
            <small>Можна відсканувати QR телефоном і переслати посилання собі в месенджер.</small>
          </div>}

          {selectedQueueItem && selectedHasPresentation && selected.registrationConfirmed
            ? <div className="ok-box">Запис повністю підтверджено: презентація є, мобільна сторінка відкрита. Місце в черзі збережено.</div>
            : selectedQueueItem && selectedHasPresentation && !selected.registrationConfirmed
            ? <div className="qr-confirm-box" style={{ textAlign: 'center', background: '#0f172a', color: 'white', padding: 32, marginTop: 24, border: '1px solid #334155' }}>
                <h2 style={{ margin: '0 0 16px', fontSize: 24, color: '#4ade80' }}>Презентацію завантажено</h2>
                <div style={{ background: 'white', padding: 16, display: 'inline-block', marginBottom: 24 }}>
                  <img alt="Mobile QR" src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(companionUrl)}`} style={{ display: 'block' }} />
                </div>
                <div style={{ background: '#b91c1c', padding: 16, fontSize: 20, fontWeight: 'bold' }}>Для завершення запису обов'язково відскануйте QR-код!</div>
                <p style={{ color: '#94a3b8', fontSize: 14, maxWidth: 400, margin: '16px auto 0', lineHeight: 1.5 }}>Без відкриття цієї сторінки запис не буде підтверджено. На ній буде ваш номер черги, поточний статус захисту та подальші вказівки комісії.</p>
                <div style={{ marginTop: 16, color: '#475569', fontSize: 13, fontFamily: 'monospace' }}>Тимчасова сторінка /s/{companionToken.slice(0, 8)}</div>
              </div>
            : selectedAgentUploadPageUrl
              ? <p><button type="button" onClick={() => { window.location.href = selectedAgentUploadPageUrl }}>Відкрити завантаження через Electron Agent</button></p>
              : <div className="closed-box">Electron Agent ще не передав адресу завантаження. Перевірте, що desktop-апка запущена саме на ПК захисту.</div>}

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
