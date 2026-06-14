import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { confirmMobileRegistration, expireMobileStudentPage, subscribeMobileCompanion, type MobileCompanionSnapshot } from '../services/firebaseAdapter'

type Props = {
  token: string
}

export function MobileCompanionPage({ token }: Props) {
  const [snapshot, setSnapshot] = useState<MobileCompanionSnapshot>({ studentPage: null, mobileDisplay: null })
  const [loaded, setLoaded] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const unsubscribe = subscribeMobileCompanion(token, (next) => {
      setSnapshot(next)
      setLoaded(true)
    })
    return unsubscribe
  }, [token])

  useEffect(() => {
    if (!snapshot.studentPage || snapshot.studentPage.registrationConfirmed) return
    void confirmMobileRegistration(token).catch((error) => console.warn('Mobile registration confirmation failed', error))
  }, [snapshot.studentPage?.token, snapshot.studentPage?.registrationConfirmed, token])

  const student = snapshot.studentPage
  const display = snapshot.mobileDisplay
  const expiresMs = student?.expiresAt ? Date.parse(student.expiresAt) : 0
  const isExpired = Boolean(expiresMs && Number.isFinite(expiresMs) && expiresMs <= nowMs)
  const allVisible = useMemo(() => [...(display?.currentlyDefending || []), ...(display?.nextDefending || [])], [display])
  const isNext = (display?.nextDefending || []).slice(0, 3).some((item) => item.studentId === student?.studentId)
  const isCurrent = (display?.currentlyDefending || []).some((item) => item.studentId === student?.studentId)

  useEffect(() => {
    if (!expiresMs || !Number.isFinite(expiresMs)) return
    const timeout = window.setTimeout(() => setNowMs(Date.now()), Math.max(1000, expiresMs - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [expiresMs])

  useEffect(() => {
    if (!isExpired) return
    void expireMobileStudentPage(token).catch((error) => console.warn('Mobile page cleanup failed', error))
  }, [isExpired, token])
  if (!loaded) return <Screen><div style={styles.muted}>Завантаження...</div></Screen>
  if (!student || isExpired) return <UnavailableScreen />
  if (display && !display.enabled) {
    return <Screen><div style={styles.muted}>Відображення тимчасово вимкнено комісією. Очікуйте оновлень або зверніться до секретаря.</div></Screen>
  }

  const problemResolved = student.defenseStatus === 'defended' && student.problemDetails?.resolved
  const defendedClean = student.defenseStatus === 'defended' && !student.problemDetails?.resolved
  const hasProblem = student.defenseStatus === 'problem'

  return (
    <Screen>
      <header style={styles.header}>
        <div style={styles.successBadge}>Реєстрацію підтверджено</div>
        <h1 style={styles.title}>{student.fullName}</h1>
        <p style={styles.subtitle}>{student.groupName} · {student.thesisTitle}</p>
      </header>

      {display?.publicMessage && <div style={styles.publicMessage}>{display.publicMessage}</div>}

      {hasProblem ? (
        <section style={styles.problemBox}>
          <h2 style={styles.problemTitle}>Зауваження до роботи</h2>
          <p>{student.problemDetails?.note || 'Комісія повернула роботу на доопрацювання.'}</p>
          {student.problemDetails?.deadline && <p><b>Внести правки до:</b> {new Date(student.problemDetails.deadline).toLocaleString()}</p>}
          {student.problemDetails?.returnedToStudent && <p style={styles.warningText}>Роботу передано студенту на руки.</p>}
          <div style={styles.problemWarning}>Після внесення правок обов’язково повідомте керівника, комісію або секретаря.</div>
        </section>
      ) : problemResolved ? (
        <section style={styles.successBox}>Проблеми вирішено, роботу прийнято. Сторінка деактивується через 15 хвилин.</section>
      ) : defendedClean ? (
        <section style={styles.successBox}>Захист завершено успішно. Якщо проблем не виявлено, сторінка деактивується через 15 хвилин.</section>
      ) : student.defenseStatus === 'presenting' || isCurrent ? (
        <section style={styles.defendingBox}>
          <div style={styles.pulseIndicator} />
          <h2 style={{ margin: 0 }}>Ви захищаєтесь</h2>
          <p style={styles.muted}>Слідкуйте за вказівками комісії.</p>
        </section>
      ) : (
        <>
          <section style={styles.queueCard}>
            <div style={styles.queueNumberLabel}>Ваш номер черги</div>
            <div style={styles.queueNumber}>{student.queuePosition || allVisible.find((item) => item.studentId === student.studentId)?.position || '-'}</div>
          </section>

          {isNext && <section style={styles.alertBox}>Ви в наступній черзі, готуйтесь.</section>}

          <QueueSection title="Зараз захищаються студенти" rows={display?.currentlyDefending || []} studentId={student.studentId} />
          <QueueSection title="Готуються наступні студенти" rows={display?.nextDefending || []} studentId={student.studentId} />

          <section style={styles.zoomHint}>
            <b>Zoom-інструкція</b>
            <p>Якщо потрібно демонструвати результати роботи у Zoom, збережіть посилання собі в месенджер або відкрийте його на власному пристрої.</p>
            {display?.zoomUrl
              ? <a href={display.zoomUrl} target="_blank" rel="noreferrer" style={styles.link}>{display.zoomUrl}</a>
              : <span style={styles.muted}>Zoom-посилання ще не задано комісією.</span>}
          </section>
        </>
      )}
    </Screen>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main style={styles.container}>{children}</main>
}

function UnavailableScreen() {
  return <Screen>
    <section style={styles.unavailableBox}>
      <h1 style={styles.unavailableTitle}>Сторінка більше не доступна</h1>
      <p style={styles.muted}>Тимчасову сторінку захисту завершено, а персональні дані прибрано з публічного доступу.</p>
    </section>
  </Screen>
}

function QueueSection({ title, rows, studentId }: { title: string; rows: Array<{ studentId: string; fullName: string; groupName: string; position: number }>; studentId: string }) {
  return <section style={styles.section}>
    <h3 style={styles.sectionTitle}>{title}</h3>
    {rows.length === 0 && <div style={styles.emptyText}>Черга порожня</div>}
    {rows.map((row) => (
      <div key={`${row.studentId}-${row.position}`} style={styles.studentRow}>
        <span style={styles.rowPos}>{row.position}</span>
        <span style={{ fontWeight: row.studentId === studentId ? 800 : 500, color: row.studentId === studentId ? '#38bdf8' : '#e2e8f0' }}>{row.fullName}</span>
      </div>
    ))}
  </section>
}

const styles = {
  container: {
    backgroundColor: '#020617',
    color: '#f8fafc',
    minHeight: '100vh',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    padding: '24px 16px',
    boxSizing: 'border-box' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16
  },
  header: { marginBottom: 8 },
  successBadge: {
    display: 'inline-block',
    background: '#064e3b',
    color: '#34d399',
    padding: '6px 12px',
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 16,
    border: '1px solid #047857'
  },
  title: { margin: '0 0 4px 0', fontSize: 22, fontWeight: 800 },
  subtitle: { margin: 0, color: '#94a3b8', fontSize: 14 },
  publicMessage: { background: '#0369a1', color: 'white', padding: 16, fontWeight: 700, fontSize: 15, border: '1px solid #0284c7' },
  queueCard: { background: '#0f172a', border: '1px solid #334155', padding: 20, textAlign: 'center' as const },
  queueNumberLabel: { color: '#94a3b8', fontSize: 14, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 },
  queueNumber: { fontSize: 48, fontWeight: 900, color: '#ffffff' },
  alertBox: { background: '#d97706', color: '#fff', padding: 16, fontWeight: 800, textAlign: 'center' as const, fontSize: 18 },
  section: { background: '#0f172a', border: '1px solid #334155', padding: 16 },
  sectionTitle: { margin: '0 0 16px 0', fontSize: 16, color: '#cbd5e1' },
  studentRow: { display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #1e293b' },
  rowPos: { color: '#64748b', width: 28 },
  zoomHint: { background: '#0f172a', border: '1px solid #334155', padding: 16, fontSize: 14, color: '#cbd5e1', lineHeight: 1.5 },
  link: { color: '#38bdf8', wordBreak: 'break-all' as const, display: 'block', marginTop: 8 },
  muted: { color: '#94a3b8', lineHeight: 1.5 },
  emptyText: { color: '#64748b', fontSize: 14, fontStyle: 'italic' },
  error: { color: '#ef4444', textAlign: 'center' as const, marginTop: 40 },
  unavailableBox: { marginTop: 80, background: '#0f172a', border: '1px solid #334155', padding: 24, textAlign: 'center' as const },
  unavailableTitle: { color: '#e2e8f0', fontSize: 24, margin: '0 0 12px' },
  problemBox: { background: '#1e293b', border: '1px solid #ef4444', padding: 20, lineHeight: 1.5 },
  problemTitle: { color: '#ef4444', margin: '0 0 12px' },
  warningText: { margin: '0 0 16px', color: '#f59e0b', fontWeight: 700 },
  problemWarning: { background: '#7f1d1d', padding: 16, color: 'white', fontWeight: 700 },
  successBox: { background: '#064e3b', border: '1px solid #34d399', padding: 20, color: '#d1fae5', lineHeight: 1.5 },
  defendingBox: { background: '#0f172a', border: '1px solid #3b82f6', padding: 40, textAlign: 'center' as const, display: 'flex', flexDirection: 'column' as const, alignItems: 'center' },
  pulseIndicator: { width: 24, height: 24, borderRadius: 12, background: '#3b82f6', marginBottom: 20, boxShadow: '0 0 20px #3b82f6' }
}
