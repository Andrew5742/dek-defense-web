import type { AppState, DefenseSession } from '../shared/types'
import { openLatestPresentation } from '../services/actions'
import { StatusBadge } from '../components/StatusBadge'

type Props = { state: AppState; setState: (s: AppState) => void; activeSession?: DefenseSession }

export function AgentPage({ state, setState, activeSession }: Props) {
  if (!activeSession) return <main className="content solo"><h1>Agent</h1><div className="empty">Сесію не обрано.</div></main>
  const pending = state.commands.filter((c) => c.sessionId === activeSession.id && c.status === 'pending')
  const commands = state.commands.filter((c) => c.sessionId === activeSession.id).slice(0, 20)
  const students = new Map(state.students.map((s) => [s.id, s]))
  const latestPresentation = (studentId?: string) => studentId ? state.presentations.filter((p) => p.studentId === studentId).sort((a,b)=>b.version-a.version)[0] : undefined

  return <main className="content solo">
    <h1>Local Defense Agent — локальний режим</h1>
    <div className="panel">
      <h2>Стан агента</h2>
      <p><b>Сесія:</b> {activeSession.title}</p>
      <p><b>Роль:</b> у фінальній версії саме цей модуль на ПК доповідача зберігає презентації, конвертує PPTX/PPT/ODP у PDF через LibreOffice і відкриває PDF fullscreen за командою з адмінки.</p>
      <p><b>Поточний GitHub Pages режим:</b> PDF відкривається всередині системи fullscreen overlay. PPTX/PPT/ODP отримують статус “потрібна конвертація”, бо браузер без Local Defense Agent не може запускати LibreOffice.</p>
    </div>
    <div className="panel">
      <h2>Команди від адмінки</h2>
      {pending.length === 0 && <div className="empty">Немає pending-команд.</div>}
      {pending.map((cmd) => {
        const s = cmd.studentId ? students.get(cmd.studentId) : undefined
        const p = latestPresentation(cmd.studentId)
        return <div className="list-row" key={cmd.id}>
          <span>
            <b>{cmd.type}</b> · {s?.fullName || cmd.studentId}<br />
            <small>{p ? `${p.originalFileName} · ${p.extension.toUpperCase()} · ${p.status}` : 'презентації немає'}</small>
          </span>
          <button onClick={async () => {
            if (!cmd.studentId) return
            const next = await openLatestPresentation(state, cmd.studentId)
            setState(next)
          }}>Виконати на Agent</button>
        </div>
      })}
    </div>
    <div className="panel">
      <h2>Презентації в локальному сховищі браузера</h2>
      <table><thead><tr><th>Студент</th><th>Файл</th><th>Формат</th><th>Версія</th><th>Статус</th><th>Дія</th></tr></thead><tbody>{state.presentations.filter((p) => p.sessionId === activeSession.id).map((p) => {
        const s = students.get(p.studentId)
        return <tr key={p.id}>
          <td>{s?.fullName}</td><td>{p.originalFileName}</td><td>{p.extension.toUpperCase()}</td><td>{p.version}</td><td><StatusBadge value={p.status} /></td>
          <td><button onClick={async () => setState(await openLatestPresentation(state, p.studentId))}>{p.extension === 'pdf' ? 'Відкрити PDF' : 'Перевірити / потрібна конвертація'}</button></td>
        </tr>
      })}</tbody></table>
    </div>
    <div className="panel">
      <h2>Останні команди</h2>
      {commands.length === 0 && <div className="empty">Команд ще немає.</div>}
      {commands.map((c) => <div className="list-row" key={c.id}><span>{c.type} · {students.get(c.studentId || '')?.fullName || c.studentId} · <StatusBadge value={c.status} />{c.error ? <><br/><small>{c.error}</small></> : null}</span></div>)}
    </div>
  </main>
}
