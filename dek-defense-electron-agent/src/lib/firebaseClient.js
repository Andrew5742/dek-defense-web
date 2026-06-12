const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  updateDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  getDocs,
  orderBy,
  limit
} = require('firebase/firestore');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB73d8DbCSEXWfJbjvsbaQoTN5u1Nsmv38',
  authDomain: 'dek-defence.firebaseapp.com',
  projectId: 'dek-defence',
  storageBucket: 'dek-defence.firebasestorage.app',
  messagingSenderId: '89291910928',
  appId: '1:89291910928:web:b872d6aa4d8b33b1947f95'
};

function getFirebaseConfigFromEnv() {
  return {
    apiKey: process.env.FIREBASE_API_KEY || DEFAULT_FIREBASE_CONFIG.apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || DEFAULT_FIREBASE_CONFIG.authDomain,
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_CONFIG.projectId,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_CONFIG.storageBucket,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
    appId: process.env.FIREBASE_APP_ID || DEFAULT_FIREBASE_CONFIG.appId
  };
}

function assertFirebaseEnv() {
  const config = getFirebaseConfigFromEnv();
  const missing = Object.entries({
    FIREBASE_API_KEY: config.apiKey,
    FIREBASE_AUTH_DOMAIN: config.authDomain,
    FIREBASE_PROJECT_ID: config.projectId,
    FIREBASE_APP_ID: config.appId
  }).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing Firebase env values: ${missing.join(', ')}`);
  }
}

async function createFirebaseClient() {
  assertFirebaseEnv();
  const app = initializeApp(getFirebaseConfigFromEnv());
  const db = getFirestore(app);
  const auth = getAuth(app);

  const email = process.env.FIREBASE_EMAIL || 'kiis_student@gmail.com';
  const password = process.env.FIREBASE_PASSWORD || 'kiis_stud2026';
  if (email && password) {
    await signInWithEmailAndPassword(auth, email, password);
  }

  return {
    app,
    db,
    auth,
    doc,
    getDoc,
    setDoc,
    addDoc,
    collection,
    updateDoc,
    query,
    where,
    onSnapshot,
    serverTimestamp,
    getDocs,
    orderBy,
    limit
  };
}

module.exports = { createFirebaseClient };
