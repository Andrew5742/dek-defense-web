import type { AppState, DefenseSession } from '../shared/types'
import { openLatestPresentation, clearOldCommands } from '../services/actions'
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
  const onlineStations = state.stations.filter((station) => station.online)

  return <main className="content solo">
    <h1>Станція показу — ПК для захисту</h1>
    <div className="panel">
      <h2>Стан станції</h2>
      <p><b>Сесія:</b> {activeSession.title}</p>
      <p><b>Онлайн Electron Agent:</b> {onlineStations.length ? onlineStations.map((station) => `${station.name || station.id} (${station.id})`).join(', ') : 'не видно активного локального агента'}</p>
      <p><b>Важливо:</b> ця web-сторінка більше не виконує команди відкриття презентацій. PPT/PPTX/PDF відкриває тільки Electron Agent на ПК захисту.</p>
      <p><b>Поточний web-режим:</b> можна лише переглянути статус і за потреби завантажити файл із браузерного fallback-сховища.</p>
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
            <small>
              {p ? `${p.originalFileName} · ${p.extension.toUpperCase()} · ${p.status}` : cmd.type === 'open_zoom' ? 'Zoom meeting' : cmd.type === 'start_defense_display' ? 'Display fullscreen' : 'презентації немає'}
              {cmd.targetStationId ? ` · station: ${cmd.targetStationId}` : ''}
            </small>
          </span>
          <div className="actions compact-actions">
            <span className="hint inline-hint">Очікує Electron Agent</span>
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
            {p.extension === 'pdf' && p.storageKey && <button onClick={async () => setState(await openLatestPresentation(state, p.studentId))}>Відкрити PDF</button>}
            {p.storageKey && <button onClick={() => void localFallbackOpen(p.storageKey, p.originalFileName)}>Завантажити файл</button>}
            {!p.storageKey && <span className="hint inline-hint">Файл у Electron Agent</span>}
          </td>
        </tr>
      })}</tbody></table>
    </div>
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Останні команди</h2>
        <button className="secondary" onClick={() => setState(clearOldCommands(state, activeSession.id))}>Очистити історію</button>
      </div>
      {commands.length === 0 && <div className="empty">Команд ще немає.</div>}
      {commands.map((c) => <div className="list-row" key={c.id}><span>{c.type} · {students.get(c.studentId || '')?.fullName || c.studentId || 'сесія'} · <StatusBadge value={c.status} />{c.targetStationId ? <><br/><small>station: {c.targetStationId}</small></> : null}{c.error ? <><br/><small>{c.error}</small></> : null}</span></div>)}
    </div>
  </main>
}
