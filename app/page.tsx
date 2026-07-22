'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithCustomToken, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';

interface MyEvent { code: string; eventName: string; role: string }

export default function LoginPage() {
  const router = useRouter();
  const [eventCode, setEventCode] = useState('');
  const [password, setPassword]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [gLoading, setGLoading]   = useState(false);
  const [error, setError]         = useState('');
  const [myEvents, setMyEvents]   = useState<MyEvent[] | null>(null);

  // เข้างานที่เลือก (หลัง login Google)
  function enterEvent(ev: MyEvent) {
    sessionStorage.setItem('organizer_auth', JSON.stringify({
      eventId: ev.code,
      eventName: ev.eventName,
      expiresAt: Date.now() + 86400000,
      via: 'google',
    }));
    router.push(`/dashboard/${ev.code}`);
  }

  // ── Login ด้วย Google: เห็นเฉพาะงานที่ email ตัวเองเป็นทีมงาน ──
  async function handleGoogle() {
    setError('');
    setGLoading(true);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const token = await cred.user.getIdToken();
      const res = await fetch('/api/my-events', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'ตรวจสอบสิทธิ์ไม่สำเร็จ');
      const evs: MyEvent[] = data.events ?? [];
      if (evs.length === 0) {
        setError('บัญชีนี้ยังไม่ได้รับสิทธิ์ผู้จัดงาน — ติดต่อทีม RunSync หรือใช้ Event Code ด้านล่าง');
        return;
      }
      if (evs.length === 1) { enterEvent(evs[0]); return; }
      setMyEvents(evs);   // มีหลายงาน → ให้เลือก
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('popup-closed')) {
        setError(msg || 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ');
      }
      console.error(err);
    } finally {
      setGLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!eventCode.trim() || !password.trim()) return;

    setLoading(true);
    setError('');

    try {
      // ไม่บังคับตัวพิมพ์ใหญ่ — id ของงาน run club เป็น auto-id ที่ case-sensitive
      // server จะลองตามที่พิมพ์ก่อนแล้วค่อย fallback ตัวใหญ่ให้เอง
      const res = await fetch('/api/organizer-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventCode: eventCode.trim(), password: password.trim() }),
      });
      const result = await res.json();

      if (!res.ok) {
        setError(result.error ?? 'เข้าสู่ระบบไม่สำเร็จ');
        return;
      }
      const eventId: string = result.eventId ?? eventCode.trim();

      // ล็อกอิน Firebase ด้วย custom token → ได้สิทธิ์อ่าน liveLocations จริง
      await signInWithCustomToken(auth, result.token);

      // เก็บ sessionStorage ไว้เป็น gate ฝั่ง UI (ปิด tab = logout)
      const authData = {
        eventId,
        eventName: result.eventName,
        expiresAt: result.expiresAt ?? Date.now() + 86400000,
      };
      sessionStorage.setItem('organizer_auth', JSON.stringify(authData));

      router.push(`/dashboard/${eventId}`);
    } catch (err) {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-brand">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="font-en text-2xl font-extrabold tracking-tight">
            RUNSYNC <span className="text-brand">RACE CONTROL</span>
          </h1>
          <p className="text-[15px] text-sub mt-1">ศูนย์ควบคุมสำหรับผู้จัดงานวิ่ง</p>
        </div>

        {/* เลือกงาน (กรณี Google account เป็นทีมงานหลายงาน) */}
        {myEvents ? (
          <div className="bg-surface border border-line rounded-2xl p-6 shadow-float">
            <p className="text-[15.5px] font-medium mb-3">เลือกงานที่ต้องการเข้า</p>
            <div className="space-y-2">
              {myEvents.map(ev => (
                <button key={ev.code} onClick={() => enterEvent(ev)}
                        className="w-full text-left bg-bg border border-line rounded-xl px-4 py-3
                                   hover:border-brand transition-colors">
                  <div className="text-[16px] font-medium">{ev.eventName}</div>
                  <div className="text-[13.5px] text-faint font-en">
                    {ev.code} · {ev.role === 'owner' ? 'เจ้าของงาน' : 'ทีมงาน'}
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setMyEvents(null)}
                    className="w-full mt-3 text-[14px] text-faint hover:text-ink py-1.5">← กลับ</button>
          </div>
        ) : (
        <>
        {/* Google login — ทางหลักสำหรับผู้จัดที่ผูกอีเมลไว้แล้ว */}
        <button onClick={handleGoogle} disabled={gLoading}
                className="w-full bg-surface border border-line hover:border-faint rounded-2xl px-4 py-3.5
                           flex items-center justify-center gap-3 shadow-float transition-colors
                           disabled:opacity-60 text-[16px] font-medium">
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 40.2 44 35 44 24c0-1.3-.1-2.6-.4-3.9z"/>
          </svg>
          {gLoading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบด้วย Google'}
        </button>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-line" />
          <span className="text-[13.5px] text-faint">หรือใช้ Event Code + รหัสผ่าน</span>
          <div className="flex-1 h-px bg-line" />
        </div>

        {/* Form */}
        <form onSubmit={handleLogin}
              className="bg-surface border border-line rounded-2xl p-6 space-y-4 shadow-float">
          <div>
            <label className="block text-[13px] font-en font-semibold uppercase tracking-wide text-faint mb-2">
              Event Code
            </label>
            <input
              type="text"
              value={eventCode}
              onChange={e => setEventCode(e.target.value)}
              placeholder="เช่น TRAIL2026 หรือรหัสงานของคลับ"
              className="w-full bg-bg border border-line rounded-xl px-4 py-3 text-ink
                         placeholder:text-faint focus:outline-none focus:border-brand
                         font-num tracking-wide text-lg transition-colors"
              autoCapitalize="none"
              required
            />
          </div>

          <div>
            <label className="block text-[13px] font-en font-semibold uppercase tracking-wide text-faint mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-bg border border-line rounded-xl px-4 py-3 text-ink
                         placeholder:text-faint focus:outline-none focus:border-brand transition-colors"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-[14.5px]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand hover:bg-brand-dk disabled:opacity-50
                       text-white font-semibold py-3 rounded-xl transition-colors shadow-brand text-[16px]">
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ Dashboard'}
          </button>
        </form>
        </>
        )}

        <p className="text-center text-[13.5px] text-faint mt-6">
          RunSync Race Control · Powered by RunSync
        </p>
        <p className="text-center mt-3">
          <a href={process.env.NEXT_PUBLIC_MAIN_SITE_URL ?? 'https://runsync.app'}
             className="text-[14.5px] text-sub hover:text-brand transition-colors">
            ← กลับไปเว็บหลัก RunSync
          </a>
        </p>
      </div>
    </div>
  );
}
