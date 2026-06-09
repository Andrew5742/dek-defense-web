import { useEffect, useMemo, useState } from 'react'
import type { AppRepository, AppState } from './shared/types'
import { emptyState } from './shared/utils'
import { localRepository } from './services/localRepository'
import { firebaseRepository, getCurrentFirebaseUser, isFirebaseEnabled, signInAdmin, signOutAdmin } from './services/firebaseAdapter'
import { AdminPage } from './pages/AdminPage'
import { StudentPage } from './pages/StudentPage'
import { DisplayPage } from './pages/DisplayPage'
import { AgentPage } from './pages/AgentPage'

type Page = 'admin' | 'student' | 'display' | 'agent'
type DeviceRole = 'unset' | 'admin' | 'defense'

const ROLE_STORAGE_KEY = 'dek-defense-device-role'
const ADMIN_AUTH_KEY = 'dek-defense-admin-auth'
const FAKE_ADMIN_EMAIL = 'admin@dek.local'
const FAKE_ADMIN_PASSWORD = 'dek2026'
const repository: AppRepository = firebaseRepository || localRepository

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

function EntryGate({ onAdminLogin, onDefenseMode, syncWarning }: { onAdminLogin: (email: string, password: string) => Promise<void>; onDefenseMode: () => void; syncWarning?: string }) {
  const [email, setEmail] = useState(isFirebaseEnabled() ? '' : FAKE_ADMIN_EMAIL)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitAdmin() {
    setBusy(true)
    try {
      setError('')
      await onAdminLogin(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося увійти в адмінку')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="entry-page">
      <section className="entry-shell">
        <div className="entry-title-row">
          <div>
            <div className="role-kicker">DEK Defense</div>
            <h1>Вибір ролі цього ПК</h1>
          </div>
          <div className="entry-env">{isFirebaseEnabled() ? 'Firebase sync увімкнено' : 'локальний режим · Firebase config не знайдено'}</div>
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
            <button className="primary full-width" onClick={submitAdmin} disabled={busy}>{busy ? 'Вхід...' : 'Увійти в адмінку'}</button>
            <div className="login-hint">
              {isFirebaseEnabled()
                ? 'Використовується Firebase Auth. Введіть email і пароль створеного адміна.'
                : <>Локальний тестовий акаунт: <b>{FAKE_ADMIN_EMAIL}</b> / <b>{FAKE_ADMIN_PASSWORD}</b></>}
            </div>
          </section>

          <section className="entry-card defense-card">
            <h2>Це ПК для захисту</h2>
            <p>Режим для аудиторії / ПК доповідача: пошук студента, запис, завантаження презентації, display і станція показу.</p>
            <ul>
              <li>Адмінка на цьому ПК буде заблокована.</li>
              <li>Студенти бачать тільки пошук себе і завантаження презентації.</li>
              <li>Презентації у фінальній версії зберігатимуться локально на цьому ПК.</li>
            </ul>
            <button className="secondary strong full-width" onClick={onDefenseMode}>Це ПК для захисту</button>
          </section>
        </div>
        {syncWarning && <div className="form-error sync-warning">{syncWarning}</div>}
      </section>
    </main>
  )
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms)
    })
  ])
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

export default function App() {
  const [state, setStateRaw] = useState<AppState>(emptyState())
  const [loaded, setLoaded] = useState(false)
  const [initialRoute] = useState(readInitialRole)
  const [deviceRole, setDeviceRole] = useState<DeviceRole>(initialRoute.role)
  const [page, setPageRaw] = useState<Page>(initialRoute.page)
  const [activeSessionId, setActiveSessionId] = useState<string>('')
  const [activeRepository, setActiveRepository] = useState<AppRepository>(repository)
  const [syncWarning, setSyncWarning] = useState('')

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let cancelled = false

    async function load() {
      let repo = repository
      let loadedState: AppState
      try {
        loadedState = await withTimeout(repo.getState(), 6000, 'Firebase не відповів за 6 секунд')
      } catch (err) {
        repo = localRepository
        setActiveRepository(localRepository)
        setSyncWarning(`${err instanceof Error ? err.message : 'Firebase недоступний'}. Тимчасово увімкнено локальний режим. Перевірте, що Firestore створений і rules опубліковані.`)
        loadedState = await localRepository.getState()
      }

      if (cancelled) return
      setStateRaw(loadedState)
      const params = new URLSearchParams(location.search)
      const sessionFromUrl = params.get('session')
      setActiveSessionId(sessionFromUrl || loadedState.sessions[0]?.id || '')
      setLoaded(true)
      unsubscribe = repo.subscribe?.((nextState) => {
        setStateRaw(nextState)
        setActiveSessionId((current) => current || nextState.sessions[0]?.id || '')
      })
    }

    void load()
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  function setState(next: AppState) {
    setStateRaw(next)
    void activeRepository.saveState(next).catch((err) => {
      setSyncWarning(`${err instanceof Error ? err.message : 'Не вдалося зберегти стан'}. Дані на цьому ПК можуть бути не синхронізовані.`)
    })
    if (!activeSessionId && next.sessions[0]) setActiveSessionId(next.sessions[0].id)
  }

  async function loginAdmin(email: string, password: string) {
    if (isFirebaseEnabled()) {
      await signInAdmin(email.trim(), password)
    } else if (email.trim().toLowerCase() !== FAKE_ADMIN_EMAIL || password !== FAKE_ADMIN_PASSWORD) {
      throw new Error('Невірний тестовий акаунт. Для локального режиму: admin@dek.local / dek2026')
    }
    localStorage.setItem(ROLE_STORAGE_KEY, 'admin')
    localStorage.setItem(ADMIN_AUTH_KEY, '1')
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

  async function resetRole() {
    if (deviceRole === 'admin' && getCurrentFirebaseUser()) {
      await signOutAdmin()
    }
    localStorage.removeItem(ROLE_STORAGE_KEY)
    localStorage.removeItem(ADMIN_AUTH_KEY)
    const url = new URL(window.location.href)
    url.search = ''
    window.history.replaceState(null, '', url.toString())
    setDeviceRole('unset')
    setPageRaw('admin')
  }

  function setPage(nextPage: Page) {
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
    return <EntryGate onAdminLogin={loginAdmin} onDefenseMode={chooseDefense} syncWarning={syncWarning} />
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

  return (
    <>
      <RoleHeader role="defense" page={defensePage} setPage={setPage} resetRole={resetRole} activeSessionTitle={activeSession?.title} />
      {defensePage === 'student' && <StudentPage state={state} setState={setState} activeSession={activeSession} publicMode />}
      {defensePage === 'agent' && <AgentPage state={state} setState={setState} activeSession={activeSession} />}
      {defensePage === 'display' && <DisplayPage state={state} activeSession={activeSession} />}
    </>
  )
}
