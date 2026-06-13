import { useEffect, useMemo, useState } from 'react'
import type { AppState } from './shared/types'
import { emptyState } from './shared/utils'
import { localRepository } from './services/localRepository'
import { firebaseRepository, isFirebaseEnabled, signInAdmin } from './services/firebaseAdapter'
import { AdminPage } from './pages/AdminPage'
import { StudentPage } from './pages/StudentPage'
import { DisplayPage } from './pages/DisplayPage'
import { AgentPage } from './pages/AgentPage'

type Page = 'admin' | 'student' | 'display' | 'agent'

const ADMIN_AUTH_KEY = 'dek-defense-admin-auth'
const DISPLAY_LOCK_KEY = 'dek-defense-display-locked'
const STUDENT_LOCK_KEY = 'dek-defense-student-locked'
const DISPLAY_EXIT_PASSWORD = '0987Kiis'

function isDesktopDefenseRuntime() {
  const params = new URLSearchParams(window.location.search)
  return params.get('desktop') === 'defense' || window.dekAgent?.isDesktop === true
}

function normalizeDefensePage(value: string | null): Exclude<Page, 'admin'> {
  if (value === 'agent' || value === 'display' || value === 'student') return value
  if (value === 'presentation' || value === 'station' || value === 'defense') return 'student'
  return 'student'
}

function readInitialPage(): Page {
  if (!isDesktopDefenseRuntime()) return 'admin'
  const params = new URLSearchParams(window.location.search)
  return normalizeDefensePage(params.get('role') || params.get('view'))
}

function writeDesktopUrl(page: Page) {
  if (!isDesktopDefenseRuntime()) return
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('desktop', 'defense')
  url.searchParams.set('role', page === 'admin' ? 'student' : page)
  if (page === 'display') url.searchParams.set('display', '1')
  window.history.replaceState(null, '', url.toString())
}

function requestAppFullscreen() {
  document.documentElement.requestFullscreen?.().catch(() => {})
}

function AdminLogin({ onAdminLogin }: { onAdminLogin: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitAdmin() {
    setBusy(true)
    try {
      if (isFirebaseEnabled()) await signInAdmin(email.trim(), password)
      localStorage.setItem(ADMIN_AUTH_KEY, '1')
      setError('')
      onAdminLogin()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="entry-page">
      <section className="entry-shell admin-only-entry">
        <div className="entry-title-row">
          <div>
            <div className="role-kicker">DEK Defense</div>
            <h1>Адмінка комісії</h1>
          </div>
          <div className="entry-env">GitHub Pages + Firebase</div>
        </div>

        <section className="entry-card admin-login-card">
          <h2>Вхід секретаря / комісії</h2>
          <p>GitHub Pages версія містить тільки адмінку. Запис студентів, display і локальне відкриття презентацій працюють у desktop Electron застосунку на ПК захисту.</p>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </label>
          <label>
            Пароль
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submitAdmin() }} autoComplete="current-password" />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary full-width" disabled={busy} onClick={() => void submitAdmin()}>{busy ? 'Вхід...' : 'Увійти в адмінку'}</button>
          <div className="login-hint">Для одночасної роботи кількох людей можна використовувати той самий Firebase акаунт: зміни мержаться перед записом у Firestore.</div>
        </section>
      </section>
    </main>
  )
}

function AdminHeader({ activeSessionTitle, onLogout }: { activeSessionTitle?: string; onLogout: () => void }) {
  return (
    <header className="locked-role-header">
      <div>
        <div className="brand">DEK Defense</div>
        <div className="subbrand">адмінка комісії{activeSessionTitle ? ` · ${activeSessionTitle}` : ''}</div>
      </div>
      <button className="secondary danger-lite" onClick={onLogout}>Вийти</button>
    </header>
  )
}

function DefenseHeader({ page, setPage, activeSessionTitle }: {
  page: Exclude<Page, 'admin'>
  setPage: (p: Exclude<Page, 'admin'>) => void
  activeSessionTitle?: string
}) {
  return (
    <header className="locked-role-header">
      <div>
        <div className="brand">DEK Defense Station</div>
        <div className="subbrand">desktop ПК захисту · агент запущений під капотом{activeSessionTitle ? ` · ${activeSessionTitle}` : ''}</div>
      </div>
      <nav className="nav locked-nav">
        <button className={page === 'student' ? 'active' : ''} onClick={() => setPage('student')}>Запис студентів</button>
        <button className={page === 'agent' ? 'active' : ''} onClick={() => setPage('agent')}>Станція показу</button>
        <button className={page === 'display' ? 'active' : ''} onClick={() => setPage('display')}>Display</button>
      </nav>
      <button className="secondary" onClick={() => window.dekAgent?.openStorage?.()}>Папка презентацій</button>
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
      <h2>Режим захисту активний</h2>
      <p>Для виходу з display/fullscreen введіть пароль.</p>
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
  const desktopDefense = isDesktopDefenseRuntime()
  const [state, setStateRaw] = useState<AppState>(emptyState())
  const [loaded, setLoaded] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [page, setPageRaw] = useState<Page>(readInitialPage)
  const [adminAuthed, setAdminAuthed] = useState(() => desktopDefense || localStorage.getItem(ADMIN_AUTH_KEY) === '1')
  const [activeSessionId, setActiveSessionId] = useState<string>('')
  const [displayLocked, setDisplayLocked] = useState(() => desktopDefense && page === 'display' && localStorage.getItem(DISPLAY_LOCK_KEY) === '1')
  const [studentLocked, setStudentLocked] = useState(() => desktopDefense && page === 'student' && localStorage.getItem(STUDENT_LOCK_KEY) === '1')
  const [showLockOverlay, setShowLockOverlay] = useState(false)
  const repository = firebaseRepository || localRepository

  useEffect(() => {
    let disposed = false
    if (page !== 'display') localStorage.removeItem(DISPLAY_LOCK_KEY)
    if (page !== 'student') localStorage.removeItem(STUDENT_LOCK_KEY)

    let timeoutId = 0
    const loadState = Promise.race([
      repository.getState(),
      new Promise<AppState>((resolve) => {
        timeoutId = window.setTimeout(() => {
          setSyncError('Firebase не відповів за 8 секунд, відкрито локальний порожній стан')
          resolve(emptyState())
        }, 8000)
      })
    ])

    loadState.then((s) => {
      if (disposed) return
      window.clearTimeout(timeoutId)
      setStateRaw(s)
      const params = new URLSearchParams(location.search)
      const sessionFromUrl = params.get('session')
      setActiveSessionId(sessionFromUrl || s.activeSessionId || s.sessions[0]?.id || '')
      setLoaded(true)
    }).catch((error) => {
      if (disposed) return
      window.clearTimeout(timeoutId)
      setSyncError(error instanceof Error ? error.message : String(error))
      setLoaded(true)
    })

    const unsubscribe = firebaseRepository?.subscribe((next) => {
      if (disposed) return
      setStateRaw(next)
      setActiveSessionId((current) => current || next.activeSessionId || next.sessions[0]?.id || '')
    })

    return () => {
      disposed = true
      window.clearTimeout(timeoutId)
      unsubscribe?.()
    }
  }, [])

  function setState(next: AppState) {
    setStateRaw(next)
    setSyncError('')
    void repository.saveState(next).catch((error) => {
      setSyncError(error instanceof Error ? error.message : String(error))
    })
    if (!activeSessionId && next.sessions[0]) setActiveSessionId(next.sessions[0].id)
  }

  useEffect(() => {
    function onFullscreenChange() {
      if ((displayLocked || studentLocked) && !document.fullscreenElement) setShowLockOverlay(true)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [displayLocked, studentLocked])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (desktopDefense && (page === 'display' || studentLocked) && event.key === 'Escape') setShowLockOverlay(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [desktopDefense, page, studentLocked])

  function logoutAdmin() {
    localStorage.removeItem(ADMIN_AUTH_KEY)
    setAdminAuthed(false)
  }

  function exitDisplayMode() {
    localStorage.removeItem(DISPLAY_LOCK_KEY)
    localStorage.removeItem(STUDENT_LOCK_KEY)
    setDisplayLocked(false)
    setStudentLocked(false)
    setShowLockOverlay(false)
    setPageRaw('student')
    writeDesktopUrl('student')
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }

  function setDefensePage(nextPage: Exclude<Page, 'admin'>) {
    if ((displayLocked && nextPage !== 'display') || (studentLocked && nextPage !== 'student')) {
      setShowLockOverlay(true)
      return
    }
    if (nextPage === 'display') {
      localStorage.removeItem(STUDENT_LOCK_KEY)
      localStorage.setItem(DISPLAY_LOCK_KEY, '1')
      setStudentLocked(false)
      setDisplayLocked(true)
      requestAppFullscreen()
    } else {
      localStorage.removeItem(DISPLAY_LOCK_KEY)
      setDisplayLocked(false)
    }
    setPageRaw(nextPage)
    writeDesktopUrl(nextPage)
  }

  function startStudentFullscreen() {
    if (!desktopDefense) return
    localStorage.setItem(STUDENT_LOCK_KEY, '1')
    setStudentLocked(true)
    requestAppFullscreen()
  }

  const activeSession = useMemo(
    () => state.sessions.find((s) => s.id === activeSessionId) || state.sessions[0],
    [state.sessions, activeSessionId]
  )

  if (!loaded) return <div className="boot">Завантаження...</div>

  if (!desktopDefense && !adminAuthed) {
    return <AdminLogin onAdminLogin={() => setAdminAuthed(true)} />
  }

  if (!desktopDefense) {
    return (
      <>
        <AdminHeader activeSessionTitle={activeSession?.title} onLogout={logoutAdmin} />
        {syncError && <div className="sync-error">{syncError}. Дані на цьому ПК можуть бути не синхронізовані.</div>}
        <AdminPage state={state} setState={setState} activeSession={activeSession} setActiveSessionId={setActiveSessionId} />
      </>
    )
  }

  const defensePage = page === 'admin' ? 'student' : page
  const hideHeader = defensePage === 'display' || studentLocked

  return (
    <>
      {!hideHeader && <DefenseHeader page={defensePage} setPage={setDefensePage} activeSessionTitle={activeSession?.title} />}
      {syncError && defensePage !== 'display' && <div className="sync-error">{syncError}. Дані на цьому ПК можуть бути не синхронізовані.</div>}
      {defensePage === 'student' && <StudentPage state={state} setState={setState} activeSession={activeSession} publicMode onStartFullscreen={startStudentFullscreen} />}
      {defensePage === 'agent' && <AgentPage state={state} setState={setState} activeSession={activeSession} />}
      {defensePage === 'display' && <DisplayPage state={state} activeSession={activeSession} locked={displayLocked} />}
      {defensePage === 'display' && <button className="display-exit-button" onClick={() => setShowLockOverlay(true)}>Вийти</button>}
      {defensePage === 'student' && studentLocked && <button className="display-exit-button" onClick={() => setShowLockOverlay(true)}>Вийти</button>}
      {showLockOverlay && <FullscreenLockOverlay
        onReturnFullscreen={() => { setShowLockOverlay(false); requestAppFullscreen() }}
        onUnlock={exitDisplayMode}
      />}
    </>
  )
}
