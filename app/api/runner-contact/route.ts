// ============================================================
// /api/runner-contact — เบอร์โทรนักวิ่ง + ผู้ติดต่อฉุกเฉิน (ข้อมูล private)
//
// GET ?code=<eventCode>&userId=<uid>  → { phoneSelf, emergencyName, emergencyPhone }
//
// อ่านจาก users/{uid}/private/emergency ด้วย Admin SDK (bypass rules)
// เพราะ client อ่านไม่ได้ (rule = isOwner || isAdmin เท่านั้น)
// สิทธิ์: caller ต้องเป็น owner/staff ของงานนั้น (เหมือน /api/team)
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
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
  if (caller.organizerOf === code) return 'owner';
  if (!caller.email) return null;
  const adminDoc = await adminDb.collection('admins').doc(caller.email).get();
  if (adminDoc.exists) return 'owner';
  const mem = await adminDb.collection('organizer_events').doc(code)
    .collection('members').doc(caller.email).get();
  if (!mem.exists) return null;
  return (mem.data()!.role as string) === 'owner' ? 'owner' : 'staff';
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code') ?? '';
    const userId = url.searchParams.get('userId') ?? '';
    if (!code || !userId) {
      return NextResponse.json({ error: 'ต้องระบุ code และ userId' }, { status: 400 });
    }
    const caller = await getCaller(req);
    if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const role = await callerRole(caller, code);
    if (!role) return NextResponse.json({ error: 'ไม่มีสิทธิ์ในงานนี้' }, { status: 403 });

    const snap = await adminDb.collection('users').doc(userId)
      .collection('private').doc('emergency').get();
    const d = (snap.exists ? (snap.data() ?? {}) : {}) as Record<string, unknown>;
    return NextResponse.json({
      phoneSelf: (d.phoneSelf as string) ?? '',
      emergencyName: (d.emergencyName as string) ?? '',
      emergencyPhone: (d.emergencyPhone as string) ?? '',
    });
  } catch (e) {
    console.error('runner-contact GET error:', e);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
