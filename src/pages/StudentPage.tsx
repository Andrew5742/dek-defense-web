import { useEffect, useMemo, useState } from 'react'
import type { AppState, DefenseSession, Student } from '../shared/types'
import { canRegister } from '../shared/utils'
import { getAgentUploadPageUrl, updateStudent, cancelRegistration, addToQueue } from '../services/actions'
import { buildStudentTemporaryUrl, formatStudentTemporaryPath } from '../services/publicUrl'
import { StatusBadge } from '../components/StatusBadge'
import { FlashDriveUploader } from '../components/FlashDriveUploader'

type Props = {
  state: AppState
  setState: (next: AppState | ((prev: AppState) => AppState)) => void
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
  const [showUploader, setShowUploader] = useState(false)

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

  const selectedQueueItem = selected
    ? state.queue.find((item) => item.sessionId === selected.sessionId && item.studentId === selected.id)
    : undefined
  const selectedHasPresentation = selected?.presentationStatus === 'ready' || selected?.presentationStatus === 'conversion_required'
  const companionToken = selected?.token || selected?.id || ''
  const companionUrl = buildStudentTemporaryUrl(companionToken)

  function doCancelRegistration() {
    if (!selected || !activeSession) return
    if (confirm('Ви впевнені, що хочете скасувати реєстрацію та видалити презентацію?')) {
      setState(cancelRegistration(state, activeSession.id, selected.id))
      setSelectedId('')
    }
  }

  return (
    <main className="student-wrap">
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
          <b>Як записатися та як проходить захист:</b>
          <ol>
            <li>Введіть своє прізвище й оберіть себе зі списку.</li>
            <li>Уважно перевірте своє ПІБ, групу, тему та керівника.</li>
            <li>Якщо плануєте демонструвати роботу через Zoom, поставте відповідну галочку.</li>
            <li>Натисніть "Завантажити з флешки (або ПК)" та додайте презентацію (PDF, PPTX, PPT, ODP). Також можна додати відео.</li>
            <li>Відскануйте згенерований QR-код своїм смартфоном. Ваша мобільна сторінка підтвердить реєстрацію та збереже ваше місце в черзі.</li>
          </ol>
          <div style={{ background: '#f8fafc', padding: 16, marginTop: 16, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14 }}>
            <b>Під час захисту:</b>
            <ul style={{ paddingLeft: 20, marginTop: 8, color: '#334155' }}>
              <li style={{ marginBottom: 6 }}>Заходьте до аудиторії п'ятірками: очікуйте, поки вийде попередня п'ятірка студентів.</li>
              <li style={{ marginBottom: 6 }}>Обов'язково перевірте наявність усіх підписів (керівника тощо) у заліковій книжці та віддайте її комісії (покладіть на стіл).</li>
              <li style={{ marginBottom: 0 }}>Уважно слідкуйте за своїм статусом на мобільній сторінці — туди комісія може відправити зауваження до вашої роботи або оцінку.</li>
            </ul>
          </div>
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
          <p>
            <b>Статус:</b>{' '}
            <StatusBadge value={selected.registrationStatus} />{' '}
            <StatusBadge value={selected.presentationStatus} />{' '}
            {selected.hasVideo && <span className="status info">відео</span>}{' '}
            {selected.wantsZoomDemo && <span className="status info">показ результату в Zoom</span>}
            {selectedQueueItem && <span className="status ok" style={{ marginLeft: 6 }}>черга: №{selectedQueueItem.position}</span>}
          </p>

          {open ? <div className="upload-box">
            <h3>Щоб завершити запис, обов'язково завантажте презентацію</h3>
            <p>Дозволені формати презентації: PDF, PPTX, PPT, ODP. Відео є необов'язковим: MP4, MOV, AVI, MKV, WEBM.</p>
            <p className="hint">Файли зберігаються локально на цьому ПК захисту через Electron Agent. PPTX/PPT/ODP відкриваються через PowerPoint у повноекранному режимі.</p>

            {/* Step 3: Fully confirmed */}
            {selectedHasPresentation && selected.registrationConfirmed && (
              <div className="ok-box">✅ Запис повністю підтверджено: презентація є, мобільна сторінка відкрита. Місце в черзі №{selectedQueueItem?.position} збережено.</div>
            )}

            {/* Step 2: Has presentation, waiting for QR scan */}
            {selectedHasPresentation && !selected.registrationConfirmed && (
              <div className="qr-confirm-box" style={{ textAlign: 'center', background: '#0f172a', color: 'white', padding: 32, marginTop: 24, border: '1px solid #334155' }}>
                <h2 style={{ margin: '0 0 8px', fontSize: 24, color: '#4ade80' }}>Презентацію завантажено</h2>
                {selectedQueueItem && <p style={{ margin: '0 0 16px', color: '#94a3b8' }}>Ваш номер черги: <strong style={{ color: 'white', fontSize: 20 }}>#{selectedQueueItem.position}</strong></p>}
                <div style={{ background: 'white', padding: 16, display: 'inline-block', marginBottom: 24 }}>
                  <img alt="Mobile QR" src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(companionUrl)}`} style={{ display: 'block' }} />
                </div>
                <div style={{ background: '#b91c1c', padding: 16, fontSize: 20, fontWeight: 'bold' }}>Для завершення запису обов'язково відскануйте QR-код!</div>
                <p style={{ color: '#94a3b8', fontSize: 14, maxWidth: 400, margin: '16px auto 0', lineHeight: 1.5 }}>Без відкриття цієї сторінки запис не буде підтверджено. На ній буде ваш номер черги, поточний статус захисту та подальші вказівки комісії.</p>
                <div style={{ marginTop: 16, color: '#475569', fontSize: 13, fontFamily: 'monospace' }}>Тимчасова сторінка: {formatStudentTemporaryPath(companionToken)}</div>
                <div style={{ marginTop: 16 }}>
                  <button type="button" className="danger" style={{ fontSize: 13 }} onClick={doCancelRegistration}>Скасувати реєстрацію</button>
                </div>
              </div>
            )}

            {/* Step 1: No presentation yet */}
            {!selectedHasPresentation && (
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                {window.dekAgent?.uploadLocalFiles ? (
                  <button type="button" onClick={() => setShowUploader(true)}>Завантажити з флешки (або ПК)</button>
                ) : (
                  <div className="warn-box">Завантаження недоступне: запустіть Electron Agent</div>
                )}
                {selectedQueueItem && (
                  <button type="button" className="danger" onClick={doCancelRegistration}>Скасувати реєстрацію</button>
                )}
              </div>
            )}

            {showUploader && <FlashDriveUploader
              studentId={selected.id}
              sessionId={activeSession.id}
              onComplete={({ status, isVideo }) => {
                setShowUploader(false)
                setState((prevState) => {
                  const withPresentation = updateStudent(prevState, selected.id, { presentationStatus: status as any, hasVideo: isVideo }, 'student')
                  return addToQueue(withPresentation, selected.id, 'student')
                })
              }}
              onCancel={() => setShowUploader(false)}
            />}

            {selected.presentationStatus === 'error' && <div className="closed-box">
              Презентацію не передано в Electron Agent. Зверніться до секретаря або перевірте, що Agent запущений на ПК захисту.
              {selected.notes && <><br /><small>{selected.notes.split('\n').slice(-1)[0]}</small></>}
            </div>}
          </div> : <div className="closed-box">Запис закрито. Зверніться до секретаря.</div>}
        </div>}
      </div>
    </main>
  )
}
