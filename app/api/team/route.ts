// ============================================================
// /api/team — จัดการทีมงานของงาน (organizer_events/{code}/members)
//
// GET    ?code=X            → รายชื่อทีมงาน (สมาชิกทุกคนดูได้)
// POST   { code, email }    → เพิ่มทีมงาน (เฉพาะ owner / session แบบรหัสผ่าน / admin)
// DELETE { code, email }    → ลบทีมงาน (เงื่อนไขเดียวกัน, ห้ามลบ owner)
//
// สิทธิ์: caller ต้องเป็นหนึ่งใน
//  - custom token จาก login แบบรหัสผ่าน (claim organizerOf == code) = เจ้าของงาน
//  - Google user ที่มี members/{email} role 'owner' ของงานนี้
//  - admin ระบบ (มี doc ใน admins/{email})
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Caller = { email?: string; organizerOf?: string };

async function getCaller(req: NextRequest): Promise<Caller | null> {
  const m = (req.headers.get('authorization') ?? '').match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(m[1]);
    return { email: decoded.email?.toLowerCase(), organizerOf: decoded.organizerOf as string | undefined };
  } catch {
    return null;
  }
}

async function callerRole(caller: Caller, code: string): Promise<'owner' | 'staff' | null> {
  if (caller.organizerOf === code) return 'owner';   // login แบบรหัสผ่าน = สิทธิ์เจ้าของ
  if (!caller.email) return null;
  const adminDoc = await adminDb.collection('admins').doc(caller.email).get();
  if (adminDoc.exists) return 'owner';               // admin ระบบทำได้ทุกอย่าง
  const mem = await adminDb.collection('organizer_events').doc(code)
    .collection('members').doc(caller.email).get();
  if (!mem.exists) return null;
  return (mem.data()!.role as string) === 'owner' ? 'owner' : 'staff';
}

export async function GET(req: NextRequest) {
  try {
    const code = new URL(req.url).searchParams.get('code') ?? '';
    if (!code) return NextResponse.json({ error: 'ต้องระบุ code' }, { status: 400 });
    const caller = await getCaller(req);
    if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const role = await callerRole(caller, code);
    if (!role) return NextResponse.json({ error: 'ไม่มีสิทธิ์ในงานนี้' }, { status: 403 });

    const snap = await adminDb.collection('organizer_events').doc(code)
      .collection('members').orderBy('addedAt').get();
    const members = snap.docs.map(d => ({
      email: d.id,
      role: (d.data().role as string) ?? 'staff',
      addedBy: d.data().addedBy ?? null,
    }));
    return NextResponse.json({ members, callerRole: role });
  } catch (e) {
    console.error('team GET error:', e);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { code, email } = await req.json();
    if (typeof code !== 'string' || typeof email !== 'string') {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 });
    }
    const target = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      return NextResponse.json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' }, { status: 400 });
    }
    const caller = await getCaller(req);
    if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (await callerRole(caller, code) !== 'owner') {
      return NextResponse.json({ error: 'เฉพาะเจ้าของงานเท่านั้นที่เพิ่มทีมงานได้' }, { status: 403 });
    }

    await adminDb.collection('organizer_events').doc(code)
      .collection('members').doc(target).set({
        email: target,
        role: 'staff',
        addedBy: caller.email ?? `password-login (${code})`,
        addedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

    return NextResponse.json({ added: target });
  } catch (e) {
    console.error('team POST error:', e);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { code, email } = await req.json();
    if (typeof code !== 'string' || typeof email !== 'string') {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 });
    }
    const target = email.trim().toLowerCase();
    const caller = await getCaller(req);
    if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (await callerRole(caller, code) !== 'owner') {
      return NextResponse.json({ error: 'เฉพาะเจ้าของงานเท่านั้นที่ลบทีมงานได้' }, { status: 403 });
    }

    const ref = adminDb.collection('organizer_events').doc(code).collection('members').doc(target);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'ไม่พบทีมงานคนนี้' }, { status: 404 });
    if (snap.data()!.role === 'owner') {
      return NextResponse.json({ error: 'ลบเจ้าของงานไม่ได้ (ให้แอดมิน RunSync จัดการ)' }, { status: 403 });
    }
    await ref.delete();
    return NextResponse.json({ removed: target });
  } catch (e) {
    console.error('team DELETE error:', e);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
