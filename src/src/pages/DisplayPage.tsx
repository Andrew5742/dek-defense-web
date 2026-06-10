import type { AppState, DefenseSession } from '../shared/types'

export function DisplayPage({ state, activeSession, locked = false }: { state: AppState; activeSession?: DefenseSession; locked?: boolean }) {
  if (!activeSession) return <main className="display"><h1>Сесію не обрано</h1></main>
  const queue = state.queue.filter((q) => q.sessionId === activeSession.id).sort((a, b) => a.position - b.position)
  const students = new Map(state.students.map((s) => [s.id, s]))
  const current = queue.map((q) => students.get(q.studentId)).find((s) => s && s.defenseStatus === 'presenting')
  const next = queue.map((q) => students.get(q.studentId)).find((s) => s && s.defenseStatus === 'waiting')
  const waiting = queue.filter((q) => students.get(q.studentId)?.defenseStatus === 'waiting').length
  return <main className={locked ? 'display display-locked' : 'display'}>
    <div className="display-card">
      <h1>{activeSession.title}</h1>
      <p>{activeSession.date}</p>
      <section>
        <span>Зараз захищається</span>
        <strong>{current?.fullName || '—'}</strong>
        {current && <em>{current.defenseFormat === 'online' ? 'Онлайн' : 'Очно'}</em>}
      </section>
      <section>
        <span>Наступний</span>
        <strong>{next?.fullName || '—'}</strong>
        {next && <em>{next.defenseFormat === 'online' ? 'Онлайн' : 'Очно'}</em>}
      </section>
      <section>
        <span>Очікують</span>
        <strong>{waiting}</strong>
      </section>
    </div>
  </main>
}
