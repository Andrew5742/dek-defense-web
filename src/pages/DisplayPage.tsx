import type { AppState, DefenseSession } from '../shared/types'
import { QRCodeSVG } from 'qrcode.react'

export function DisplayPage({ state, activeSession, locked = false }: { state: AppState; activeSession?: DefenseSession; locked?: boolean }) {
  if (!activeSession) return <main className="display"><h1>Сесію не обрано</h1></main>
  
  const queue = state.queue.filter((q) => q.sessionId === activeSession.id).sort((a, b) => a.position - b.position)
  const students = new Map(state.students.map((s) => [s.id, s]))
  
  const current = queue.map((q) => students.get(q.studentId)).find((s) => s && s.defenseStatus === 'presenting')
  const next = queue.map((q) => students.get(q.studentId)).find((s) => s && s.defenseStatus === 'waiting')
  const waiting = queue.filter((q) => students.get(q.studentId)?.defenseStatus === 'waiting').length

  const registerUrl = 'https://dek-defence.web.app/' // Base URL for students to register

  return (
    <main className={locked ? 'display display-locked' : 'display'}>
      <div className="display-header">
        <div className="display-header-text">
          <h1>{activeSession.title}</h1>
          <p>{activeSession.date}</p>
        </div>
      </div>
      
      <div className="display-content">
        <div className="display-card">
          <section>
            <span>Зараз захищається</span>
            <strong>{current?.fullName || '—'}</strong>
            {current && <em>{current.defenseFormat === 'online' ? 'Онлайн' : 'Очно'}</em>}
          </section>
        </div>

        <div className="display-card">
          <section>
            <span>Наступний</span>
            <strong>{next?.fullName || '—'}</strong>
            {next && <em>{next.defenseFormat === 'online' ? 'Онлайн' : 'Очно'}</em>}
          </section>
          <section>
            <span>Очікують у черзі</span>
            <strong>{waiting}</strong>
          </section>
        </div>
      </div>
    </main>
  )
}
