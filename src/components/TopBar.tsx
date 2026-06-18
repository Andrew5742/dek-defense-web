import type { DefenseSession } from '../shared/types'
import { formatDefenseDate } from '../shared/utils'

type Page = 'admin' | 'student' | 'display' | 'agent'

function roleUrl(role: Page, sessionId?: string) {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('role', role)
  if (sessionId) url.searchParams.set('session', sessionId)
  if (role === 'student' || role === 'display') url.searchParams.set('locked', '1')
  return url.toString()
}

export function TopBar({ page, setPage, activeSession }: { page: Page; setPage: (p: Page) => void; activeSession?: DefenseSession }) {
  const sessionId = activeSession?.id
  return (
    <header className="topbar">
      <div>
        <div className="brand">DEK Defense</div>
        <div className="subbrand">адмінка секретаря · студентський запис відкривається окремим посиланням</div>
      </div>
      <nav className="nav">
        <button className={page === 'admin' ? 'active' : ''} onClick={() => setPage('admin')}>Адмінка</button>
        <button onClick={() => window.open(roleUrl('student', sessionId), '_blank', 'noopener,noreferrer')}>Відкрити студентську</button>
        <button onClick={() => window.open(roleUrl('display', sessionId), '_blank', 'noopener,noreferrer')}>Display</button>
        <button onClick={() => window.open(roleUrl('agent', sessionId), '_blank', 'noopener,noreferrer')}>Agent</button>
      </nav>
      <div className="session-mini">
        <strong>{activeSession?.title || 'Сесію не обрано'}</strong>
        <span>{formatDefenseDate(activeSession?.date)}</span>
      </div>
    </header>
  )
}
