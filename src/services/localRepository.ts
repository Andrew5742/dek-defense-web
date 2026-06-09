import type { AppRepository, AppState } from '../shared/types'
import { emptyState } from '../shared/utils'

const STORAGE_KEY = 'dek-defense-hybrid-state-v1'

export class LocalRepository implements AppRepository {
  async getState(): Promise<AppState> {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    try {
      return { ...emptyState(), ...JSON.parse(raw) }
    } catch {
      return emptyState()
    }
  }

  async saveState(state: AppState): Promise<void> {
    const backup = localStorage.getItem(STORAGE_KEY)
    if (backup) localStorage.setItem(`${STORAGE_KEY}.bak`, backup)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export const localRepository = new LocalRepository()

const DB_NAME = 'dek-defense-files-v1'
const STORE_NAME = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const db = await openDb()
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result as Blob | undefined)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return blob
}

export async function removeBlob(key: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
