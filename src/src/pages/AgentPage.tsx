import type { AppState, DefenseSession } from '../shared/types'
import { markCommandDone, openLatestPresentation } from '../services/actions'
import { getBlob } from '../services/localRepository'
import { StatusBadge } from '../components/StatusBadge'

type Props = { state: AppState; setState: (s: AppState) => void; activeSession?: DefenseSession }

async function localFallbackOpen(storageKey?: string, fileName = 'presentation') {
  if (!storageKey) return
  const blob = await getBlob(storageKey)
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function AgentPage({ state, setState, activeSession }: Props) {
  if (!activeSession) return <main className="content solo"><h1>Agent</h1><div className="empty">Сесію не обрано.</div></main>
  const pending = state.commands.filter((c) => c.sessionId === activeSession.id && c.status === 'pending')
  const commands = state.commands.filter((c) => c.sessionId === activeSession.id).slice(0, 20)
  const students = new Map(state.students.map((s) => [s.id, s]))
  const latestPresentation = (studentId?: string) => studentId ? state.presentations.filter((p) => p.studentId === studentId).sort((a,b)=>b.version-a.version)[0] : undefined

  return <main className="content solo">
    <h1>Станція показу — ПК для захисту</h1>
    <div className="panel">
      <h2>Стан станції</h2>
      <p><b>Сесія:</b> {activeSession.title}</p>
      <p><b>Автоматизація:</b> у режимі Firebase/GitHub ця сторінка слухає команди адмінки. Команди відкриття презентації, Zoom та Display виконуються на цьому ПК.</p>
      <p><b>Поточний web-режим:</b> PDF відкривається у власному viewer “1 клік = 1 слайд”. PPTX/PPT/ODP не завантажуються назад автоматично; для них доступна кнопка “Локальний запуск” як аварійний fallback.</p>
      {activeSession.zoomUrl && <p><b>Zoom:</b> {activeSession.zoomUrl}</p>}
    </div>
    <div className="panel">
      <h2>Команди від адмінки</h2>
      {pending.length === 0 && <div className="empty">Немає pending-команд.</div>}
      {pending.map((cmd) => {
        const s = cmd.studentId ? students.get(cmd.studentId) : undefined
        const p = latestPresentation(cmd.studentId)
        return <div className="list-row" key={cmd.id}>
          <span>
            <b>{cmd.type}</b> · {s?.fullName || cmd.studentId || 'сесія'}<br />
            <small>{p ? `${p.originalFileName} · ${p.extension.toUpperCase()} · ${p.status}` : cmd.type === 'open_zoom' ? 'Zoom meeting' : cmd.type === 'start_defense_display' ? 'Display fullscreen' : 'презентації немає'}</small>
          </span>
          <div className="actions compact-actions">
            {cmd.type === 'open_presentation' && cmd.studentId && <button onClick={async () => setState(await openLatestPresentation(state, cmd.studentId!))}>Виконати</button>}
            {cmd.type === 'open_zoom' && <button onClick={() => {
              window.open(cmd.zoomUrl || activeSession.zoomUrl || 'zoommtg://zoom.us/join', '_blank', 'noopener,noreferrer')
              setState(markCommandDone(state, cmd.id))
            }}>Відкрити Zoom</button>}
            {(cmd.type === 'start_defense_display' || cmd.type === 'show_display') && <button onClick={() => {
              document.documentElement.requestFullscreen?.().catch(() => {})
              setState(markCommandDone(state, cmd.id))
            }}>Виконати Display</button>}
          </div>
        </div>
      })}
    </div>
    <div className="panel">
      <h2>Презентації в локальному сховищі браузера</h2>
      <table><thead><tr><th>Студент</th><th>Файл</th><th>Формат</th><th>Версія</th><th>Статус</th><th>Дія</th></tr></thead><tbody>{state.presentations.filter((p) => p.sessionId === activeSession.id).map((p) => {
        const s = students.get(p.studentId)
        return <tr key={p.id}>
          <td>{s?.fullName}</td><td>{p.originalFileName}</td><td>{p.extension.toUpperCase()}</td><td>{p.version}</td><td><StatusBadge value={p.status} /></td>
          <td className="actions compact-actions">
            <button onClick={async () => setState(await openLatestPresentation(state, p.studentId))}>{p.extension === 'pdf' ? 'Відкрити PDF' : 'Перевірити'}</button>
            <button onClick={() => void localFallbackOpen(p.storageKey, p.originalFileName)}>Локальний запуск</button>
          </td>
        </tr>
      })}</tbody></table>
    </div>
    <div className="panel">
      <h2>Останні команди</h2>
      {commands.length === 0 && <div className="empty">Команд ще немає.</div>}
      {commands.map((c) => <div className="list-row" key={c.id}><span>{c.type} · {students.get(c.studentId || '')?.fullName || c.studentId || 'сесія'} · <StatusBadge value={c.status} />{c.error ? <><br/><small>{c.error}</small></> : null}</span></div>)}
    </div>
  </main>
}
