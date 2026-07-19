import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  orderBy, 
  limit, 
  doc, 
  setDoc,
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import type { Verdict } from './types';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Analytics may fail if config is invalid/placeholder — guard it
let analytics: ReturnType<typeof getAnalytics> | null = null;
try {
  if (firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('your_')) {
    analytics = getAnalytics(app);
  }
} catch (e) {
  console.warn('Firebase Analytics initialization skipped:', e);
}
export { analytics };

export const db = getFirestore(app);
export const auth = getAuth(app);

// Connectivity check — only run if config looks real
async function testConnection() {
  if (!firebaseConfig.projectId || firebaseConfig.projectId.startsWith('your_')) {
    console.warn('Firebase not configured — skipping connectivity check. Update your .env file with real Firebase credentials.');
    return;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration or internet connection.");
    }
  }
}
testConnection();

// Error handler helper
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function isFirebaseConfigured(): boolean {
  return !!(firebaseConfig.projectId && !firebaseConfig.projectId.startsWith('your_'));
}

/**
 * Saves a DRS decision to Firestore
 */
export async function saveDecision(decisionData: {
  match_id: string;
  batsman: string;
  bowler: string;
  decision_type: string;
  result: Verdict;
  details: any;
}) {
  if (!isFirebaseConfigured()) {
    console.warn('Firebase not configured — decision not saved.');
    return 'local-' + Date.now();
  }
  const path = 'decisions';
  try {
    const docRef = await addDoc(collection(db, path), {
      ...decisionData,
      timestamp: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Fetches recent decisions
 */
export async function getRecentDecisions(limitCount: number = 10) {
  if (!isFirebaseConfigured()) {
    console.warn('Firebase not configured — returning empty history.');
    return [];
  }
  const path = 'decisions';
  try {
    const q = query(
      collection(db, path), 
      orderBy('timestamp', 'desc'), 
      limit(limitCount)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

/**
 * Updates match statistics
 */
export async function updateMatchStats(matchId: string, stats: any) {
  if (!isFirebaseConfigured()) {
    console.warn('Firebase not configured — stats not saved.');
    return;
  }
  const path = `matches/${matchId}`;
  try {
    const matchRef = doc(db, 'matches', matchId);
    await setDoc(matchRef, { stats, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
