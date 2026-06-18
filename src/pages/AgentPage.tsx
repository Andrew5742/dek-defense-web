import type { AppState, DefenseSession } from '../shared/types'
import { clearOldCommands, openLatestPresentation, requestOpenPresentation } from '../services/actions'
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

  const pending = state.commands.filter((command) => command.sessionId === activeSession.id && command.status === 'pending')
  const commands = state.commands.filter((command) => command.sessionId === activeSession.id).slice(0, 20)
  const students = new Map(state.students.map((student) => [student.id, student]))
  const latestPresentation = (studentId?: string) => studentId
    ? state.presentations.filter((presentation) => presentation.studentId === studentId).sort((a, b) => b.version - a.version)[0]
    : undefined
  const onlineStations = state.stations.filter((station) => station.online)
  const queue = state.queue
    .filter((item) => item.sessionId === activeSession.id)
    .sort((a, b) => a.position - b.position)
    .map((item) => ({ item, student: students.get(item.studentId), presentation: latestPresentation(item.studentId) }))
    .filter((row) => row.student && !['defended', 'absent'].includes(row.student.defenseStatus))

  return <main className="content solo agent-page">
    <h1>Станція показу — ПК для захисту</h1>
    <div className="agent-layout">
      <div className="agent-main">
        <div className="panel">
          <h2>Стан станції</h2>
          <p><b>Сесія:</b> {activeSession.title}</p>
          <p><b>Онлайн Agent:</b> {onlineStations.length
            ? onlineStations.map((station) => `${station.name || station.id} (${station.id})`).join(', ')
            : 'очікується підключення'}</p>
          <p><b>Стан:</b> локальна БД і команди активні. Презентації відкриває Agent на цьому ПК.</p>
          {onlineStations[0]?.lanUploadUrl && <p><b>Адреса для комісії:</b> {onlineStations[0].lanUploadUrl}</p>}
          {activeSession.zoomUrl && <p><b>Zoom:</b> {activeSession.zoomUrl}</p>}
        </div>

        <div className="panel">
          <h2>Команди від адмінки</h2>
          {pending.length === 0 && <div className="empty">Немає команд в очікуванні.</div>}
          {pending.map((command) => {
            const student = command.studentId ? students.get(command.studentId) : undefined
            const presentation = latestPresentation(command.studentId)
            return <div className="list-row" key={command.id}>
              <span>
                <b>{command.type}</b> · {student?.fullName || command.studentId || 'сесія'}<br />
                <small>
                  {presentation
                    ? `${presentation.originalFileName} · ${presentation.extension.toUpperCase()} · ${presentation.status}`
                    : command.type === 'open_zoom' ? 'Zoom meeting' : command.type === 'start_defense_display' ? 'Display fullscreen' : 'презентації немає'}
                </small>
              </span>
              <span className="hint inline-hint">Виконується Agent</span>
            </div>
          })}
        </div>

        <div className="panel">
          <h2>Презентації</h2>
          <table><thead><tr><th>Студент</th><th>Файл</th><th>Формат</th><th>Статус</th><th>Дія</th></tr></thead><tbody>
            {state.presentations.filter((presentation) => presentation.sessionId === activeSession.id).map((presentation) => {
              const student = students.get(presentation.studentId)
              return <tr key={presentation.id}>
                <td>{student?.fullName}</td><td>{presentation.originalFileName}</td><td>{presentation.extension.toUpperCase()}</td>
                <td><StatusBadge value={presentation.status} /></td>
                <td className="actions compact-actions">
                  {presentation.extension === 'pdf' && presentation.storageKey && <button onClick={async () => setState(await openLatestPresentation(state, presentation.studentId))}>Відкрити PDF</button>}
                  {presentation.storageKey && <button onClick={() => void localFallbackOpen(presentation.storageKey, presentation.originalFileName)}>Завантажити файл</button>}
                  {!presentation.storageKey && <span className="hint inline-hint">Файл у Agent</span>}
                </td>
              </tr>
            })}
          </tbody></table>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Останні команди</h2>
            <button className="secondary" onClick={() => setState(clearOldCommands(state, activeSession.id))}>Очистити історію</button>
          </div>
          {commands.length === 0 && <div className="empty">Команд ще немає.</div>}
          {commands.map((command) => <div className="list-row" key={command.id}>
            <span>{command.type} · {students.get(command.studentId || '')?.fullName || command.studentId || 'сесія'} · <StatusBadge value={command.status} />
              {command.humanError || command.error ? <><br /><small>{command.humanError || command.error}</small></> : null}
            </span>
          </div>)}
        </div>
      </div>

      <aside className="panel agent-queue-panel">
        <div className="agent-queue-head">
          <div><h2>Черга захисту</h2><small>{queue.length} очікують</small></div>
        </div>
        {queue.length === 0 && <div className="empty">Черга порожня.</div>}
        <div className="agent-queue-list">
          {queue.map(({ item, student, presentation }) => student && <button
            className={`agent-queue-row ${student.defenseStatus === 'presenting' ? 'is-presenting' : ''}`}
            key={item.id}
            disabled={!presentation || !['ready', 'uploaded', 'conversion_required'].includes(presentation.status)}
            onClick={() => setState(requestOpenPresentation(state, activeSession.id, student.id))}
            title={presentation ? 'Відкрити презентацію на цьому ПК' : 'Презентацію не завантажено'}
          >
            <span className="agent-queue-position">{item.position}</span>
            <span className="agent-queue-info">
              <b>{student.fullName}</b>
              <small>{student.groupName} · {student.defenseFormat === 'online' ? 'Онлайн' : 'Очно'}</small>
              <small>Презентація: {presentation ? presentation.status : 'відсутня'}</small>
            </span>
          </button>)}
        </div>
      </aside>
    </div>
  </main>
}
