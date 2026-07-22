// ── Firebase Admin (server-only) ────────────────────────────────────────────
// ใช้เฉพาะใน API routes (route handlers) เท่านั้น — ห้าม import เข้า client component
// ตรวจรหัสผ่าน event ฝั่ง server + mint custom token โดยไม่เปิดเผย service account ให้ client
import {
  initializeApp, getApps, cert, applicationDefault, type App,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

function buildCredential() {
  // 0) วิธีง่ายสุดสำหรับ Vercel: service account ทั้งไฟล์ encode เป็น base64 ใน env เดียว
  //    (ไม่ต้องกังวลเรื่อง \n / เครื่องหมายคำพูดของ private key)
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64) {
    const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return cert(sa);
  }

  // 1) Production (Vercel): ใส่ค่าผ่าน env vars
  const projectId  = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  let   privateKey  = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    // Vercel เก็บ \n เป็น literal — แปลงกลับเป็น newline จริง
    privateKey = privateKey.replace(/\\n/g, '\n');
    return cert({ projectId, clientEmail, privateKey });
  }

  // 2) Dev (local): ใช้ไฟล์ serviceAccount.json ที่ root ของโปรเจกต์ (../serviceAccount.json)
  //    *อย่า* commit ไฟล์นี้เข้า git
  const localPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(process.cwd(), '..', 'serviceAccount.json');
  if (fs.existsSync(localPath)) {
    const sa = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    return cert(sa);
  }

  // 3) สุดท้าย: ลอง Application Default Credentials
  return applicationDefault();
}

let app: App;
if (getApps().length === 0) {
  app = initializeApp({ credential: buildCredential() });
} else {
  app = getApps()[0]!;
}

export const adminAuth = getAuth(app);
export const adminDb   = getFirestore(app);
