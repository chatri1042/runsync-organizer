import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { scryptSync, timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';        // ต้องใช้ Node runtime (firebase-admin + crypto)
export const dynamic = 'force-dynamic';

// ── ตรวจรหัสผ่าน (scrypt, ไม่ต้องลง dependency เพิ่ม) — ต้องตรงกับ migration script ──
function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const calc = scryptSync(plain, salt, 32);
  const want = Buffer.from(hash, 'hex');
  return calc.length === want.length && timingSafeEqual(calc, want);
}

export async function POST(req: NextRequest) {
  try {
    const { eventCode, password } = await req.json();
    if (typeof eventCode !== 'string' || typeof password !== 'string'
        || !eventCode.trim() || !password) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 });
    }
    // 1) อ่าน event (public fields) ฝั่ง server
    // ลองตามที่พิมพ์ก่อน (id งาน run club เป็น auto-id case-sensitive) แล้วค่อย fallback ตัวใหญ่
    const raw = eventCode.trim();
    let eventId = raw;
    let evSnap = await adminDb.collection('organizer_events').doc(raw).get();
    if (!evSnap.exists && raw !== raw.toUpperCase()) {
      eventId = raw.toUpperCase();
      evSnap = await adminDb.collection('organizer_events').doc(eventId).get();
    }
    if (!evSnap.exists) {
      return NextResponse.json({ error: 'ไม่พบ Event Code นี้' }, { status: 404 });
    }
    const ev = evSnap.data()!;
    if (ev.isActive === false) {
      return NextResponse.json({ error: 'งานนี้ยังไม่เปิด หรือปิดแล้ว' }, { status: 403 });
    }

    // 2) อ่านรหัสผ่านจาก subcollection ที่ client อ่านไม่ได้ (อ่านได้เฉพาะ admin SDK)
    const credSnap = await adminDb
      .collection('organizer_events').doc(eventId)
      .collection('private').doc('credentials').get();

    let ok = false;
    if (credSnap.exists && credSnap.data()?.passwordHash) {
      ok = verifyPassword(password, credSnap.data()!.passwordHash as string);
    } else if (typeof ev.password === 'string') {
      // fallback ชั่วคราว: event เก่าที่ยังเก็บ password แบบ plaintext (ก่อน migrate)
      ok = ev.password === password;
    }

    if (!ok) {
      return NextResponse.json({ error: 'Password ไม่ถูกต้อง' }, { status: 401 });
    }

    // 3) mint custom token ผูก claim organizerOf = eventId
    const uid = `org_${eventId}`;
    const token = await adminAuth.createCustomToken(uid, { organizerOf: eventId });

    const expiresAt = ev.endTime?.toMillis?.() ?? Date.now() + 86400000;
    // ส่ง eventId ตัวจริงกลับด้วย (เผื่อ client พิมพ์คนละ case)
    return NextResponse.json({ token, eventId, eventName: ev.eventName ?? eventId, expiresAt });
  } catch (e) {
    console.error('organizer-login error:', e);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' }, { status: 500 });
  }
}
