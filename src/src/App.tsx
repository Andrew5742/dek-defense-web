import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, Command } from './shared/types'
import { emptyState } from './shared/utils'
import { localRepository } from './services/localRepository'
import { markCommandDone, openLatestPresentation } from './services/actions'
import { AdminPage } from './pages/AdminPage'
import { StudentPage } from './pages/StudentPage'
import { DisplayPage } from './pages/DisplayPage'
import { AgentPage } from './pages/AgentPage'

type Page = 'admin' | 'student' | 'display' | 'agent'
type DeviceRole = 'unset' | 'admin' | 'defense'

const ROLE_STORAGE_KEY = 'dek-defense-device-role'
const ADMIN_AUTH_KEY = 'dek-defense-admin-auth'
const DISPLAY_LOCK_KEY = 'dek-defense-display-locked'
const FAKE_ADMIN_EMAIL = 'admin@dek.local'
const FAKE_ADMIN_PASSWORD = 'dek2026'
const DISPLAY_EXIT_PASSWORD = '0987Kiis'

function normalizeDefensePage(value: string | null): Page {
  if (value === 'agent' || value === 'display' || value === 'student') return value
  if (value === 'presentation' || value === 'station' || value === 'defense') return 'student'
  return 'student'
}

function readInitialRole(): { role: DeviceRole; page: Page } {
  const params = new URLSearchParams(location.search)
  const roleFromUrl = params.get('role') || params.get('view')

  if (roleFromUrl === 'student' || roleFromUrl === 'agent' || roleFromUrl === 'display' || roleFromUrl === 'defense' || roleFromUrl === 'station') {
    return { role: 'defense', page: normalizeDefensePage(roleFromUrl) }
  }

  const savedRole = localStorage.getItem(ROLE_STORAGE_KEY)
  const isAdminAuthed = localStorage.getItem(ADMIN_AUTH_KEY) === '1'

  if (savedRole === 'admin' && isAdminAuthed) return { role: 'admin', page: 'admin' }
  if (savedRole === 'defense') return { role: 'defense', page: 'student' }

  return { role: 'unset', page: 'admin' }
}

function writeUrlForRole(role: DeviceRole, page: Page) {
  const url = new URL(window.location.href)
  url.search = ''
  if (role === 'admin') url.searchParams.set('role', 'admin')
  if (role === 'defense') url.searchParams.set('role', page)
  window.history.replaceState(null, '', url.toString())
}

function requestAppFullscreen() {
  document.documentElement.requestFullscreen?.().catch(() => {})
}

function EntryGate({ onAdminLogin, onDefenseMode }: { onAdminLogin: () => void; onDefenseMode: () => void }) {
  const [email, setEmail] = useState(FAKE_ADMIN_EMAIL)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function submitAdmin() {
    if (email.trim().toLowerCase() === FAKE_ADMIN_EMAIL && password === FAKE_ADMIN_PASSWORD) {
      setError('')
      onAdminLogin()
      return
    }
    setError('Невірний тестовий акаунт. Для локального режиму: admin@dek.local / dek2026')
  }

  return (
    <main className="entry-page">
      <section className="entry-shell">
        <div className="entry-title-row">
          <div>
            <div className="role-kicker">DEK Defense</div>
            <h1>Вибір ролі цього ПК</h1>
          </div>
          <div className="entry-env">локальний режим · Firebase буде підключено пізніше</div>
        </div>

        <div className="entry-grid">
          <section className="entry-card admin-login-card">
            <h2>Адміністрування</h2>
            <p>Вхід для секретаря / викладача. Після входу студентський режим на цьому ПК заблокований.</p>
            <label>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </label>
            <label>
              Пароль
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitAdmin() }} autoComplete="current-password" placeholder="dek2026" />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button className="primary full-width" onClick={submitAdmin}>Увійти в адмінку</button>
            <div className="login-hint">Тестовий акаунт до Firebase Auth: <b>{FAKE_ADMIN_EMAIL}</b> / <b>{FAKE_ADMIN_PASSWORD}</b></div>
          </section>

          <section className="entry-card defense-card">
            <h2>Це ПК для захисту</h2>
            <p>Режим для аудиторії / ПК доповідача: пошук студента, запис, завантаження презентації, display і станція показу.</p>
            <ul>
              <li>Адмінка на цьому ПК буде заблокована.</li>
              <li>У Display fullscreen навігаційні кнопки приховуються.</li>
              <li>Вихід із захисного fullscreen — через пароль {DISPLAY_EXIT_PASSWORD}.</li>
            </ul>
            <button className="secondary strong full-width" onClick={onDefenseMode}>Це ПК для захисту</button>
          </section>
        </div>
      </section>
    </main>
  )
}

function RoleHeader({ role, page, setPage, resetRole, activeSessionTitle }: {
  role: DeviceRole
  page: Page
  setPage: (p: Page) => void
  resetRole: () => void
  activeSessionTitle?: string
}) {
  const isDefense = role === 'defense'
  return (
    <header className="locked-role-header">
      <div>
        <div className="brand">DEK Defense</div>
        <div className="subbrand">
          {role === 'admin' ? 'адміністрування · студентський інтерфейс заблоковано' : 'ПК для захисту · адмінка заблокована'}
          {activeSessionTitle ? ` · ${activeSessionTitle}` : ''}
        </div>
      </div>
      {isDefense && (
        <nav className="nav locked-nav">
          <button className={page === 'student' ? 'active' : ''} onClick={() => setPage('student')}>Запис студентів</button>
          <button className={page === 'agent' ? 'active' : ''} onClick={() => setPage('agent')}>Станція показу</button>
          <button className={page === 'display' ? 'active' : ''} onClick={() => setPage('display')}>Display</button>
        </nav>
      )}
      <button className="secondary danger-lite" onClick={resetRole}>Змінити роль ПК</button>
    </header>
  )
}

function FullscreenLockOverlay({ onUnlock, onReturnFullscreen }: { onUnlock: () => void; onReturnFullscreen: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  function submit() {
    if (password === DISPLAY_EXIT_PASSWORD) {
      setError('')
      onUnlock()
      return
    }
    setError('Невірний пароль виходу')
  }
  return <div className="fullscreen-lock-overlay">
    <div className="fullscreen-lock-card">
      <h2>Режим захистів активний</h2>
      <p>Display/презентація працюють далі. Для виходу з режиму введіть пароль.</p>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="Пароль виходу" autoFocus />
      {error && <div className="form-error">{error}</div>}
      <div className="toolbar no-margin">
        <button className="primary" onClick={onReturnFullscreen}>Повернути fullscreen</button>
        <button onClick={submit}>Вийти з режиму</button>
      </div>
    </div>
  </div>
}

export default function App() {
  const [state, setStateRaw] = useState<AppState>(emptyState())
  const [loaded, setLoaded] = useState(false)
  const [initialRoute] = useState(readInitialRole)
  const [deviceRole, setDeviceRole] = useState<DeviceRole>(initialRoute.role)
  const [page, setPageRaw] = useState<Page>(initialRoute.page)
  const [activeSessionId, setActiveSessionId] = useState<string>('')
  const [displayLocked, setDisplayLocked] = useState(() => localStorage.getItem(DISPLAY_LOCK_KEY) === '1')
  const [showLockOverlay, setShowLockOverlay] = useState(false)
  const handlingCommandRef = useRef(false)

  useEffect(() => {
    localRepository.getState().then((s) => {
      setStateRaw(s)
      const params = new URLSearchParams(location.search)
      const sessionFromUrl = params.get('session')
      setActiveSessionId(sessionFromUrl || s.sessions[0]?.id || '')
      setLoaded(true)
    })
  }, [])

  function setState(next: AppState) {
    setStateRaw(next)
    void localRepository.saveState(next)
    if (!activeSessionId && next.sessions[0]) setActiveSessionId(next.sessions[0].id)
  }

  useEffect(() => {
    function onFullscreenChange() {
      if (displayLocked && !document.fullscreenElement) setShowLockOverlay(true)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [displayLocked])

  useEffect(() => {
    if (!loaded || deviceRole !== 'defense' || handlingCommandRef.current) return
    const pending = state.commands.find((c) => c.status === 'pending' && (!activeSessionId || c.sessionId === activeSessionId))
    if (!pending) return
    handlingCommandRef.current = true
    void handleDefenseCommand(pending).finally(() => { handlingCommandRef.current = false })
  }, [state.commands, loaded, deviceRole, activeSessionId])

  async function handleDefenseCommand(command: Command) {
    if (command.type === 'start_defense_display' || command.type === 'show_display') {
      localStorage.setItem(DISPLAY_LOCK_KEY, '1')
      setDisplayLocked(true)
      setShowLockOverlay(false)
      setPageRaw('display')
      writeUrlForRole('defense', 'display')
      requestAppFullscreen()
      setState(markCommandDone(state, command.id))
      return
    }

    if (command.type === 'open_zoom') {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      setDisplayLocked(false)
      localStorage.removeItem(DISPLAY_LOCK_KEY)
      const session = state.sessions.find((s) => s.id === command.sessionId)
      const zoomUrl = command.zoomUrl || session?.zoomUrl || 'zoommtg://zoom.us/join'
      window.open(zoomUrl, '_blank', 'noopener,noreferrer')
      setState(markCommandDone(state, command.id))
      return
    }

    if (command.type === 'open_presentation' && command.studentId) {
      const next = await openLatestPresentation(state, command.studentId)
      setState(next)
      return
    }

    setState(markCommandDone(state, command.id))
  }

  function loginAdmin() {
    localStorage.setItem(ROLE_STORAGE_KEY, 'admin')
    localStorage.setItem(ADMIN_AUTH_KEY, '1')
    localStorage.removeItem(DISPLAY_LOCK_KEY)
    setDisplayLocked(false)
    setDeviceRole('admin')
    setPageRaw('admin')
    writeUrlForRole('admin', 'admin')
  }

  function chooseDefense() {
    localStorage.setItem(ROLE_STORAGE_KEY, 'defense')
    localStorage.removeItem(ADMIN_AUTH_KEY)
    setDeviceRole('defense')
    setPageRaw('student')
    writeUrlForRole('defense', 'student')
  }

  function resetRole() {
    localStorage.removeItem(ROLE_STORAGE_KEY)
    localStorage.removeItem(ADMIN_AUTH_KEY)
    localStorage.removeItem(DISPLAY_LOCK_KEY)
    const url = new URL(window.location.href)
    url.search = ''
    window.history.replaceState(null, '', url.toString())
    setDisplayLocked(false)
    setShowLockOverlay(false)
    setDeviceRole('unset')
    setPageRaw('admin')
  }

  function setPage(nextPage: Page) {
    if (displayLocked && nextPage !== 'display') {
      setShowLockOverlay(true)
      return
    }
    if (deviceRole === 'admin') {
      setPageRaw('admin')
      writeUrlForRole('admin', 'admin')
      return
    }
    if (deviceRole === 'defense') {
      const allowed: Page = nextPage === 'admin' ? 'student' : nextPage
      setPageRaw(allowed)
      writeUrlForRole('defense', allowed)
      return
    }
    setPageRaw(nextPage)
  }

  const activeSession = useMemo(
    () => state.sessions.find((s) => s.id === activeSessionId) || state.sessions[0],
    [state.sessions, activeSessionId]
  )

  if (!loaded) return <div className="boot">Завантаження...</div>

  if (deviceRole === 'unset') {
    return <EntryGate onAdminLogin={loginAdmin} onDefenseMode={chooseDefense} />
  }

  if (deviceRole === 'admin') {
    return (
      <>
        <RoleHeader role="admin" page="admin" setPage={setPage} resetRole={resetRole} activeSessionTitle={activeSession?.title} />
        <AdminPage state={state} setState={setState} activeSession={activeSession} setActiveSessionId={setActiveSessionId} />
      </>
    )
  }

  const defensePage = page === 'admin' ? 'student' : page
  const hideHeader = displayLocked && defensePage === 'display'

  return (
    <>
      {!hideHeader && <RoleHeader role="defense" page={defensePage} setPage={setPage} resetRole={resetRole} activeSessionTitle={activeSession?.title} />}
      {defensePage === 'student' && <StudentPage state={state} setState={setState} activeSession={activeSession} publicMode />}
      {defensePage === 'agent' && <AgentPage state={state} setState={setState} activeSession={activeSession} />}
      {defensePage === 'display' && <DisplayPage state={state} activeSession={activeSession} locked={displayLocked} />}
      {showLockOverlay && <FullscreenLockOverlay
        onReturnFullscreen={() => { setShowLockOverlay(false); requestAppFullscreen() }}
        onUnlock={() => {
          localStorage.removeItem(DISPLAY_LOCK_KEY)
          setDisplayLocked(false)
          setShowLockOverlay(false)
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
        }}
      />}
    </>
  )
}
