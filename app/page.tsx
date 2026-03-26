'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export default function LoginPage() {
  const router = useRouter();
  const [eventCode, setEventCode] = useState('');
  const [password, setPassword]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!eventCode.trim() || !password.trim()) return;

    setLoading(true);
    setError('');

    try {
      const eventRef = doc(db, 'organizer_events', eventCode.trim().toUpperCase());
      const snap = await getDoc(eventRef);

      if (!snap.exists()) {
        setError('ไม่พบ Event Code นี้');
        return;
      }

      const data = snap.data();

      if (!data.isActive) {
        setError('งานนี้ยังไม่เปิด หรือปิดแล้ว');
        return;
      }

      if (data.password !== password.trim()) {
        setError('Password ไม่ถูกต้อง');
        return;
      }

      // Store auth in sessionStorage (ปิด tab = logout อัตโนมัติ)
      const authData = {
        eventId:   eventCode.trim().toUpperCase(),
        eventName: data.eventName,
        expiresAt: data.endTime?.toMillis() ?? Date.now() + 86400000,
      };
      sessionStorage.setItem('organizer_auth', JSON.stringify(authData));

      router.push(`/dashboard/${eventCode.trim().toUpperCase()}`);
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
          <div className="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">RunSync</h1>
          <p className="text-sm text-gray-400 mt-1">Organizer Dashboard</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="bg-surface border border-border rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-2">EVENT CODE</label>
            <input
              type="text"
              value={eventCode}
              onChange={e => setEventCode(e.target.value.toUpperCase())}
              placeholder="เช่น TRAIL2025"
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-white
                         placeholder-gray-600 focus:outline-none focus:border-brand
                         font-mono tracking-widest text-lg"
              autoCapitalize="characters"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-2">PASSWORD</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-white
                         placeholder-gray-600 focus:outline-none focus:border-brand"
              required
            />
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand hover:bg-orange-500 disabled:opacity-50
                       text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ Dashboard'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-600 mt-6">
          RunSync Organizer · Powered by RunSync
        </p>
      </div>
    </div>
  );
}
