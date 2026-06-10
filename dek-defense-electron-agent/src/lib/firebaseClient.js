const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  doc,
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

function getFirebaseConfigFromEnv() {
  return {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
  };
}

function assertFirebaseEnv() {
  const required = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing Firebase env values: ${missing.join(', ')}`);
  }
}

async function createFirebaseClient() {
  assertFirebaseEnv();
  const app = initializeApp(getFirebaseConfigFromEnv());
  const db = getFirestore(app);
  const auth = getAuth(app);

  if (process.env.FIREBASE_EMAIL && process.env.FIREBASE_PASSWORD) {
    await signInWithEmailAndPassword(auth, process.env.FIREBASE_EMAIL, process.env.FIREBASE_PASSWORD);
  }

  return {
    app,
    db,
    auth,
    doc,
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
