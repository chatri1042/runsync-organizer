// ============================================================
// /api/route — เก็บเส้นทางวิ่ง (GPX/KML) ถาวรผูกกับงาน
//
// POST   { code, points: [{lat,lng}] } → เซฟเส้นทางลง organizer_events/{code}.routePoints
// DELETE { code }                      → ลบเส้นทาง
//
// สิทธิ์แก้ไข: เจ้าของงาน (claim organizerOf / member role owner) หรือ admin ระบบ
// การอ่านไม่ต้องผ่าน API — dashboard อ่าน organizer_events doc ตรงอยู่แล้ว
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_POINTS = 1500;   // กัน doc ใหญ่เกิน (Firestore จำกัด 1MB/doc)

async function isOwner(req: NextRequest, code: string): Promise<boolean> {
  const m = (req.headers.get('authorization') ?? '').match(/^Bearer (.+)$/);
  if (!m) return false;
  try {
    const decoded = await adminAuth.verifyIdToken(m[1]);
    if ((decoded.organizerOf as string) === code) return true;   // login แบบรหัสผ่าน
    const email = decoded.email?.toLowerCase();
    if (!email) return false;
    const adminDoc = await adminDb.collection('admins').doc(email).get();
    if (adminDoc.exists) return true;
    const mem = await adminDb.collection('organizer_events').doc(code)
      .collection('members').doc(email).get();
    return mem.exists && mem.data()!.role === 'owner';
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { code, points } = await req.json();
    if (typeof code !== 'string' || !Array.isArray(points) || points.length < 2) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 });
    }
    if (!(await isOwner(req, code))) {
      return NextResponse.json({ error: 'เฉพาะเจ้าของงานเท่านั้นที่แก้เส้นทางได้' }, { status: 403 });
    }

    // ตรวจ + ย่อจำนวนจุด (เว้นช่วงเท่าๆ กัน เก็บจุดแรก/สุดท้ายเสมอ)
    const clean = points
      .filter((p: { lat: unknown; lng: unknown }) => typeof p.lat === 'number' && typeof p.lng === 'number')
      .map((p: { lat: number; lng: number }) => ({ lat: p.lat, lng: p.lng }));
    if (clean.length < 2) return NextResponse.json({ error: 'จุดพิกัดไม่ถูกต้อง' }, { status: 400 });

    let saved = clean;
    if (clean.length > MAX_POINTS) {
      const stride = (clean.length - 1) / (MAX_POINTS - 1);
      saved = Array.from({ length: MAX_POINTS }, (_, i) => clean[Math.round(i * stride)]);
    }

    await adminDb.collection('organizer_events').doc(code).set({
      routePoints: saved,
      routeUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ saved: saved.length });
  } catch (e) {
    console.error('route POST error:', e);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { code } = await req.json();
    if (typeof code !== 'string') return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 });
    if (!(await isOwner(req, code))) {
      return NextResponse.json({ error: 'เฉพาะเจ้าของงานเท่านั้นที่แก้เส้นทางได้' }, { status: 403 });
    }
    await adminDb.collection('organizer_events').doc(code).update({
      routePoints: FieldValue.delete(),
      routeUpdatedAt: FieldValue.delete(),
    });
    return NextResponse.json({ deleted: true });
  } catch (e) {
    console.error('route DELETE error:', e);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
