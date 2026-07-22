import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, type User } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
export const auth = getAuth(app);

// หน้า organizer ล็อกอินด้วย custom token (ได้มาจาก /api/organizer-login หลังตรวจรหัสผ่าน)
// custom token จะมี claim organizerOf=eventId และทำให้ request.auth != null → ผ่าน rule
// liveLocations (allow read: if isSignedIn()) โดยไม่ต้องเปิด Anonymous ให้คนทั้งโลก
//
// waitForAuth(): รอจน Firebase รู้สถานะ auth ครั้งแรก (rehydrate จาก persistence หรือ
// หลัง signInWithCustomToken) แล้วคืน user ปัจจุบัน (หรือ null ถ้ายังไม่ได้ล็อกอิน)
export function waitForAuth(): Promise<User | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise<User | null>(resolve => {
    const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
  });
}
