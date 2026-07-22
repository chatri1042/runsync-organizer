// ============================================================
// /api/my-events
// สำหรับ login แบบ Google: หาว่า email นี้เป็นทีมงานของงานไหนบ้าง
// (organizer_events/{code}/members/{email}) — ใช้ Admin SDK เพราะ
// members subcollection ไม่เปิดให้ client อ่านตรง
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const m = (req.headers.get('authorization') ?? '').match(/^Bearer (.+)$/);
    if (!m) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(m[1]);
    const email = decoded.email?.toLowerCase();
    if (!email) return NextResponse.json({ error: 'บัญชีนี้ไม่มีอีเมล' }, { status: 400 });

    const snap = await adminDb.collectionGroup('members')
      .where('email', '==', email).get();

    const events = (await Promise.all(snap.docs.map(async d => {
      const orgRef = d.ref.parent.parent;          // organizer_events/{code}
      if (!orgRef || orgRef.parent.id !== 'organizer_events') return null;
      const org = await orgRef.get();
      if (!org.exists || org.data()!.isActive === false) return null;
      return {
        code: orgRef.id,
        eventName: (org.data()!.eventName as string) ?? orgRef.id,
        role: (d.data().role as string) ?? 'staff',
      };
    }))).filter(Boolean);

    return NextResponse.json({ events });
  } catch (e) {
    console.error('my-events error:', e);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
