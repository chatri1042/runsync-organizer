// ============================================================
// /api/event-allowlist — รายชื่อผู้ลงทะเบียน (allowlist) ของงานคลับวิ่ง
// ล็อกงานจริงให้เฉพาะคนที่ลงทะเบียนมาสมัครได้ — match ด้วย "อีเมล" (Google login)
//
// GET    ?code=...              → { registrationLock, count, emails[] }
// POST   { code, text|emails }  → เพิ่มอีเมล + เปิด registrationLock
// DELETE { code, email? }       → email → ลบรายคน ; ไม่ส่ง email → ล้างทั้งหมด + ปิด lock
//
// สิทธิ์: owner/staff ของงาน (เหมือน /api/broadcast) — เช็ค server เสมอ
// เก็บที่ run_club_events/{realEventId}/allowlist/email_{อีเมลตัวพิมพ์เล็ก}
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
  if (caller.email) {
    const adminDoc = await adminDb.collection('admins').doc(caller.email).get();
    if (adminDoc.exists) return 'owner';
    const mem = await adminDb.collection('organizer_events').doc(code).collection('members').doc(caller.email).get();
    if (mem.exists) return (mem.data()!.role as string) === 'owner' ? 'owner' : 'staff';
  }
  return null;
}

async function resolveRealId(code: string): Promise<string> {
  const org = await adminDb.collection('organizer_events').doc(code).get();
  return (org.exists ? (org.data()!.realEventId as string) : '') || code;
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
function extractEmails(body: unknown): string[] {
  const b = (body ?? {}) as { emails?: unknown[]; text?: unknown };
  const bag: string[] = [];
  if (Array.isArray(b.emails)) bag.push(...b.emails.map(String));
  if (typeof b.text === 'string') bag.push(b.text);
  const found = bag.join('\n').match(EMAIL_RE) ?? [];
  return [...new Set(found.map(e => e.trim().toLowerCase()).filter(Boolean))];
}

const docId = (email: string) => `email_${email}`;

type AuthOk = { realId: string; email?: string };
type AuthErr = { error: string; status: number };
async function authorize(req: NextRequest, code: string): Promise<AuthOk | AuthErr> {
  const caller = await getCaller(req);
  if (!caller) return { error: 'unauthorized', status: 401 };
  const role = await callerRole(caller, code);
  if (!role) return { error: 'forbidden', status: 403 };
  const realId = await resolveRealId(code);
  const club = await adminDb.collection('run_club_events').doc(realId).get();
  if (!club.exists) return { error: 'ใช้ได้เฉพาะงานคลับวิ่ง', status: 400 };
  return { realId, email: caller.email };
}

export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'ต้องระบุ code' }, { status: 400 });
  const a = await authorize(req, code);
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status });
  const evRef = adminDb.collection('run_club_events').doc(a.realId);
  const [ev, al] = await Promise.all([evRef.get(), evRef.collection('allowlist').get()]);
  const emails = al.docs
    .map(d => (d.data()?.email as string) ?? (d.id.startsWith('email_') ? d.id.slice(6) : ''))
    .filter(Boolean).sort();
  return NextResponse.json({ registrationLock: ev.data()?.registrationLock === true, count: emails.length, emails });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const code = (body as { code?: string })?.code;
  if (!code) return NextResponse.json({ error: 'ต้องระบุ code' }, { status: 400 });
  const a = await authorize(req, code);
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status });
  const emails = extractEmails(body);
  if (!emails.length) return NextResponse.json({ error: 'ไม่พบอีเมลที่ถูกต้องในข้อมูลที่ส่งมา' }, { status: 400 });
  const evRef = adminDb.collection('run_club_events').doc(a.realId);
  const CHUNK = 450;
  for (let i = 0; i < emails.length; i += CHUNK) {
    const batch = adminDb.batch();
    for (const email of emails.slice(i, i + CHUNK)) {
      batch.set(evRef.collection('allowlist').doc(docId(email)),
        { email, addedAt: FieldValue.serverTimestamp(), addedBy: a.email ?? null }, { merge: true });
    }
    await batch.commit();
  }
  await evRef.update({ registrationLock: true });
  const total = await evRef.collection('allowlist').get();
  return NextResponse.json({ ok: true, added: emails.length, total: total.size, registrationLock: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const code = (body as { code?: string })?.code;
  if (!code) return NextResponse.json({ error: 'ต้องระบุ code' }, { status: 400 });
  const a = await authorize(req, code);
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status });
  const evRef = adminDb.collection('run_club_events').doc(a.realId);
  const email = (body as { email?: string })?.email;
  if (email) {
    await evRef.collection('allowlist').doc(docId(String(email).trim().toLowerCase())).delete();
    const total = await evRef.collection('allowlist').get();
    return NextResponse.json({ ok: true, total: total.size });
  }
  const al = await evRef.collection('allowlist').get();
  const CHUNK = 450;
  for (let i = 0; i < al.docs.length; i += CHUNK) {
    const batch = adminDb.batch();
    for (const d of al.docs.slice(i, i + CHUNK)) batch.delete(d.ref);
    await batch.commit();
  }
  await evRef.update({ registrationLock: false });
  return NextResponse.json({ ok: true, cleared: al.docs.length, registrationLock: false });
}
