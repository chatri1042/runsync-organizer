// ============================================================
// /api/broadcast — ประกาศฉุกเฉินจากผู้จัดไปยังนักวิ่ง
//
// POST   { code, message, target, userIds? }  → สร้างประกาศ (→ Cloud Function ส่ง push)
// DELETE { code, broadcastId }                → ยกเลิกประกาศ (active=false)
//
// สิทธิ์: owner/staff ของงาน (เหมือน /api/team) — เช็คฝั่ง server เสมอ
// เขียนใต้ events/{realEventId}/broadcasts ให้ตรงกับที่แอปอ่าน (id เดียวกับ liveLocations)
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
  if (caller.organizerOf === code) return 'owner';
  if (!caller.email) return null;
  const adminDoc = await adminDb.collection('admins').doc(caller.email).get();
  if (adminDoc.exists) return 'owner';
  const mem = await adminDb.collection('organizer_events').doc(code)
    .collection('members').doc(caller.email).get();
  if (!mem.exists) return null;
  return (mem.data()!.role as string) === 'owner' ? 'owner' : 'staff';
}

// resolve realEventId (เหมือนหน้า dashboard) + ชื่อผู้จัดสำหรับแสดงในแบนเนอร์
async function resolveEvent(code: string): Promise<{ realId: string; senderName: string }> {
  const org = await adminDb.collection('organizer_events').doc(code).get();
  const data = org.exists ? org.data()! : {};
  return {
    realId: (data.realEventId as string) || code,
    senderName: (data.eventName as string) || 'ผู้จัดงาน',
  };
}

export async function POST(req: NextRequest) {
  try {
    const { code, message, target, userIds } = await req.json();
    if (typeof code !== 'string' || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 });
    }
    const caller = await getCaller(req);
    if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!(await callerRole(caller, code))) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ในงานนี้' }, { status: 403 });
    }

    const tgt = target === 'selected' ? 'selected' : 'all';
    const ids = tgt === 'selected' && Array.isArray(userIds)
      ? userIds.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
      : [];
    if (tgt === 'selected' && ids.length === 0) {
      return NextResponse.json({ error: 'เลือกผู้รับอย่างน้อย 1 คน' }, { status: 400 });
    }

    const { realId, senderName } = await resolveEvent(code);

    // ⏰ ห้ามส่งหลังงานจบเกิน 2 ชม. (กันรบกวน) — อิง finishedAt ก่อน, ถ้าไม่มีใช้ endTime
    const GRACE_MS = 2 * 60 * 60 * 1000;
    const [evSnap, peSnap] = await Promise.all([
      adminDb.collection('events').doc(realId).get(),
      adminDb.collection('public_events').doc(realId).get(),
    ]);
    const finishedAt = evSnap.exists ? evSnap.data()?.finishedAt : null;
    const endTime = (evSnap.exists ? evSnap.data()?.endTime : null)
      ?? (peSnap.exists ? peSnap.data()?.endTime : null);
    let cutoffMs: number | null = null;
    if (finishedAt && typeof finishedAt.toMillis === 'function') {
      cutoffMs = finishedAt.toMillis() + GRACE_MS;
    } else if (endTime && typeof endTime.toMillis === 'function') {
      cutoffMs = endTime.toMillis() + GRACE_MS;
    }
    if (cutoffMs !== null && Date.now() > cutoffMs) {
      return NextResponse.json(
        { error: 'งานนี้จบเกิน 2 ชั่วโมงแล้ว — ส่งประกาศไม่ได้' },
        { status: 403 },
      );
    }

    const ref = await adminDb.collection('events').doc(realId).collection('broadcasts').add({
      message: message.trim(),
      target: tgt,
      userIds: ids,
      active: true,
      createdByName: senderName,
      createdBy: caller.email ?? `password-login (${code})`,
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ id: ref.id, sentTarget: tgt, count: ids.length });
  } catch (e) {
    console.error('broadcast POST error:', e);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { code, broadcastId } = await req.json();
    if (typeof code !== 'string' || typeof broadcastId !== 'string') {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบ' }, { status: 400 });
    }
    const caller = await getCaller(req);
    if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!(await callerRole(caller, code))) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ในงานนี้' }, { status: 403 });
    }
    const { realId } = await resolveEvent(code);
    await adminDb.collection('events').doc(realId).collection('broadcasts').doc(broadcastId)
      .set({ active: false, canceledAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ canceled: broadcastId });
  } catch (e) {
    console.error('broadcast DELETE error:', e);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
