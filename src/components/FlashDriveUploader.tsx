import { useEffect, useState } from 'react'

type Drive = { path: string; name: string; description: string }
type FileItem = { name: string; isDirectory: boolean; path: string }

type Props = {
  studentId: string
  sessionId: string
  onComplete: (payload: { uploaded: any[], status: string, isVideo: boolean }) => void
  onCancel: () => void
}

export function FlashDriveUploader({ studentId, sessionId, onComplete, onCancel }: Props) {
  const [drives, setDrives] = useState<Drive[]>([])
  const [currentPath, setCurrentPath] = useState<string>('')
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadDrives()
  }, [])

  async function loadDrives() {
    try {
      const list = await window.dekAgent?.listDrives?.()
      setDrives(list || [])
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function openDir(dirPath: string) {
    try {
      setLoading(true)
      setError('')
      const list = await window.dekAgent?.readDir?.(dirPath)
      setFiles((list || []).sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      }))
      setCurrentPath(dirPath)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleFileSelect(filePath: string) {
    if (!filePath.match(/\.(pptx|ppt|pdf|odp|mp4|mov|avi|mkv|webm)$/i)) {
      setError('Непідтримуваний формат файлу. Оберіть презентацію або відео.')
      return
    }
    
    try {
      setLoading(true)
      setError('')
      const uploaded = await window.dekAgent?.uploadLocalFiles?.([filePath], studentId, sessionId)
      if (uploaded && uploaded.length > 0) {
        const exts = uploaded.map((u: any) => {
          if (typeof u === 'string') return u.split('.').pop()?.toLowerCase() || '';
          return (u.extension || u.originalFileName?.split('.').pop() || u.path?.split('.').pop() || '').toLowerCase();
        });
        const isVideo = exts.some(ext => ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext));
        const isPresentation = exts.some(ext => ['pptx', 'ppt', 'pdf', 'odp'].includes(ext));
        const status = isPresentation ? 'ready' : (isVideo ? 'ready' : 'error');

        if (status === 'error') {
          setError('Помилка: не вдалося визначити формат файлу після завантаження. ' + JSON.stringify(uploaded));
          return;
        }

        onComplete({ uploaded, status, isVideo });
      } else {
        setError('Не вдалося завантажити файл')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return <div className="flash-uploader-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div className="flash-uploader-modal" style={{ background: '#fff', padding: 24, borderRadius: 8, width: 600, maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
      <div className="flash-uploader-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Завантаження з флешки (або локального диска)</h2>
        <button onClick={onCancel} className="close-btn" style={{ padding: '4px 8px' }}>✕</button>
      </div>

      {error && <div className="warn-box" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="flash-uploader-body" style={{ overflow: 'auto', flex: 1 }}>
        {currentPath ? (
          <>
            <div className="path-bar" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <button onClick={() => {
                const parts = currentPath.split(/\\|\//)
                parts.pop()
                let parent = parts.join('\\')
                if (!parent || !parent.includes(':')) setCurrentPath('')
                else openDir(parent + (parent.endsWith(':') ? '\\' : ''))
              }}>← Назад</button>
              <span style={{ fontSize: 14, wordBreak: 'break-all' }}>{currentPath}</span>
            </div>
            {loading ? <div className="empty">Завантаження...</div> : (
              <div className="file-list" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {files.map(f => (
                  <button key={f.path} className="file-item" style={{ textAlign: 'left', padding: '12px 16px', display: 'flex', gap: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4 }} onClick={() => f.isDirectory ? openDir(f.path) : handleFileSelect(f.path)}>
                    <span className="icon">{f.isDirectory ? '📁' : '📄'}</span>
                    <span className="name">{f.name}</span>
                  </button>
                ))}
                {files.length === 0 && <div className="empty">Папка порожня</div>}
              </div>
            )}
          </>
        ) : (
          <div className="drive-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 style={{ margin: '0 0 8px' }}>Оберіть диск або флешку:</h3>
            {drives.map(d => (
              <button key={d.path} className="drive-item" style={{ textAlign: 'left', padding: '16px', display: 'flex', flexDirection: 'column', gap: 4, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4 }} onClick={() => openDir(d.path + '\\')}>
                <span><span className="icon">💽</span> <span className="name" style={{ fontWeight: 'bold' }}>{d.name || 'Диск'} ({d.path})</span></span>
                {d.description && <small style={{ color: '#64748b' }}>{d.description}</small>}
              </button>
            ))}
            {drives.length === 0 && <div className="empty">Диски не знайдено</div>}
            <button className="secondary" onClick={loadDrives} style={{ marginTop: 16 }}>Оновити список дисків</button>
          </div>
        )}
      </div>
    </div>
  </div>
}
