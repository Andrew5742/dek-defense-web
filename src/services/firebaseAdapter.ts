import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut, type Auth, type User } from 'firebase/auth'
import { doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import type { AppRepository, AppState } from '../shared/types'
import { emptyState } from '../shared/utils'

export interface FirebaseRuntime {
  app: FirebaseApp
  db: Firestore
  auth: Auth
}

export function createFirebaseRuntime(): FirebaseRuntime | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
  const appId = import.meta.env.VITE_FIREBASE_APP_ID

  if (!apiKey || !authDomain || !projectId || !appId) return null

  const app = initializeApp({
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId
  })

  return { app, db: getFirestore(app), auth: getAuth(app) }
}

const runtime = createFirebaseRuntime()
const APP_STATE_COLLECTION = 'dek_app'
const APP_STATE_DOC = 'state'

function normalizeState(value: unknown): AppState {
  if (!value || typeof value !== 'object') return emptyState()
  return { ...emptyState(), ...(value as Partial<AppState>) }
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => withoutUndefined(item)) as T
  }

  if (value && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) cleaned[key] = withoutUndefined(item)
    }
    return cleaned as T
  }

  return value
}

export function isFirebaseEnabled(): boolean {
  return runtime !== null
}

export function getCurrentFirebaseUser(): User | null {
  return runtime?.auth.currentUser || null
}

export async function signInAdmin(email: string, password: string): Promise<User> {
  if (!runtime) throw new Error('Firebase не налаштований')
  const credential = await signInWithEmailAndPassword(runtime.auth, email, password)
  return credential.user
}

export async function signOutAdmin(): Promise<void> {
  if (!runtime) return
  await signOut(runtime.auth)
}

export class FirebaseRepository implements AppRepository {
  private stateRef() {
    if (!runtime) throw new Error('Firebase не налаштований')
    return doc(runtime.db, APP_STATE_COLLECTION, APP_STATE_DOC)
  }

  async getState(): Promise<AppState> {
    if (!runtime) return emptyState()
    const snapshot = await getDoc(this.stateRef())
    if (!snapshot.exists()) {
      await this.saveState(emptyState())
      return emptyState()
    }
    return normalizeState(snapshot.data().state)
  }

  async saveState(state: AppState): Promise<void> {
    if (!runtime) return
    await setDoc(this.stateRef(), {
      state: withoutUndefined(state),
      updatedAt: serverTimestamp()
    }, { merge: true })
  }

  subscribe(callback: (state: AppState) => void): () => void {
    if (!runtime) return () => undefined
    return onSnapshot(this.stateRef(), (snapshot) => {
      if (!snapshot.exists()) return
      callback(normalizeState(snapshot.data().state))
    })
  }
}

export const firebaseRepository = runtime ? new FirebaseRepository() : null
