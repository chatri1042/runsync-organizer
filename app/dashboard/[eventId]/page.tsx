'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  Runner, EventStats, OrganizerEvent,
  computeRunnerStatus,
} from '@/lib/types';
import OrganizerMap from '@/components/OrganizerMap';
import AlertSidebar from '@/components/AlertSidebar';

export default function DashboardPage({ params }: { params: { eventId: string } }) {
  const router  = useRouter();
  const eventId = params.eventId;

  const [runners,        setRunners]        = useState<Runner[]>([]);
  const [event,          setEvent]          = useState<OrganizerEvent | null>(null);
  const [selectedRunner, setSelectedRunner] = useState<Runner | null>(null);
  const [trackedUserId,  setTrackedUserId]  = useState<string | null>(null);
  const [lastUpdate,     setLastUpdate]     = useState<Date>(new Date());
  const [authChecked,    setAuthChecked]    = useState(false);
  const [gpxPoints,      setGpxPoints]      = useState<{lat:number;lng:number}[]>([]);

  function handleGpxFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'application/xml');
      const pts: {lat:number;lng:number}[] = [];
      xml.querySelectorAll('trkpt, rtept, wpt').forEach(node => {
        const lat = parseFloat(node.getAttribute('lat') ?? '');
        const lng = parseFloat(node.getAttribute('lon') ?? '');
        if (!isNaN(lat) && !isNaN(lng)) pts.push({ lat, lng });
      });
      if (pts.length > 0) setGpxPoints(pts);
      else alert('ไม่พบข้อมูลพิกัดใน GPX file');
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ── Auth check ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = sessionStorage.getItem('organizer_auth');
    if (!raw) { router.replace('/'); return; }
    try {
      const auth = JSON.parse(raw);
      if (auth.eventId !== eventId || Date.now() > auth.expiresAt) {
        sessionStorage.removeItem('organizer_auth');
        router.replace('/');
        return;
      }
    } catch { router.replace('/'); return; }
    setAuthChecked(true);
  }, [eventId, router]);

  // ── Load event info ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authChecked) return;
    getDoc(doc(db, 'organizer_events', eventId)).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setEvent({ eventId, eventName: d.eventName, password: d.password,
                   isActive: d.isActive, totalDistance: d.totalDistance });
      }
    });
  }, [authChecked, eventId]);

  // ── Live location listener ────────────────────────────────────────────────────
  useEffect(() => {
    if (!authChecked) return;
    const q = collection(db, 'events', eventId, 'liveLocations');
    const unsubscribe = onSnapshot(q, snapshot => {
      const now  = new Date();
      const list: Runner[] = [];
      snapshot.docs.forEach(d => {
        const data      = d.data();
        const lat       = (data.lat as number | undefined) ?? 0;
        const lng       = (data.lon as number | undefined) ?? (data.lng as number | undefined) ?? 0;
        if (lat === 0 && lng === 0) return;
        const updatedAt = data.updatedAt?.toDate?.() ?? new Date(0);
        const status    = (data.status as string | undefined) ?? 'running';
        list.push({
          userId:      (data.userId      as string) ?? d.id,
          displayName: (data.displayName as string) ?? 'Unknown',
          photoURL:    data.photoURL     as string | undefined,
          lat, lng,
          distance:    (data.distance    as number) ?? 0,
          speed:       (data.speed       as number) ?? 0,
          heading:     (data.heading     as number) ?? 0,
          status,
          teamId:      data.teamId    as string | undefined,
          bibNumber:   data.bibNumber as string | undefined,
          updatedAt,
          runnerStatus: computeRunnerStatus(status, updatedAt, now),
          rank: 0,
        });
      });
      list.sort((a, b) => b.distance - a.distance);
      list.forEach((r, i) => { r.rank = i + 1; });
      setRunners(list);
      setLastUpdate(now);
    });
    return () => unsubscribe();
  }, [authChecked, eventId]);

  const stats: EventStats = {
    total:      runners.length,
    active:     runners.filter(r => r.runnerStatus === 'active').length,
    stationary: runners.filter(r => r.runnerStatus === 'stationary').length,
    noSignal:   runners.filter(r => r.runnerStatus === 'no_signal').length,
    sos:        runners.filter(r => r.runnerStatus === 'sos').length,
  };

  function handleLogout() {
    sessionStorage.removeItem('organizer_auth');
    router.replace('/');
  }

  if (!authChecked) {
    return (
      <div className="h-screen bg-bg flex items-center justify-center">
        <div className="text-gray-400">กำลังตรวจสอบสิทธิ์...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-bg flex flex-col overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-3
                         bg-surface border-b border-border shrink-0">
        {/* Left: Logo + Event name */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight">
              {event?.eventName ?? 'Loading...'}
            </h1>
            <p className="text-[11px] text-gray-500">Organizer Dashboard · {eventId}</p>
          </div>
        </div>

        {/* Center: stats + GPX button */}
        <div className="hidden md:flex items-center gap-5">
          <LiveBadge color="#22C55E" label="กำลังวิ่ง"   value={stats.active} />
          <LiveBadge color="#F59E0B" label="หยุดนิ่ง"    value={stats.stationary} />
          <LiveBadge color="#6B7280" label="ไม่มีสัญญาณ" value={stats.noSignal} />
          {stats.sos > 0 && <LiveBadge color="#EF4444" label="SOS" value={stats.sos} pulse />}

          {/* GPX Upload Button ── อยู่ใน header ── */}
          <div className="h-5 w-px bg-border" />
          <label className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                             text-xs font-medium transition-all border
                             ${gpxPoints.length > 0
                               ? 'bg-green-900/40 border-green-600 text-green-400'
                               : 'bg-bg border-border text-gray-300 hover:border-brand hover:text-brand'}`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            {gpxPoints.length > 0 ? `✓ GPX (${gpxPoints.length} จุด)` : 'อัพโหลด GPX Route'}
            <input type="file" accept=".gpx" className="hidden" onChange={handleGpxFile} />
          </label>
          {gpxPoints.length > 0 && (
            <button onClick={() => setGpxPoints([])}
                    className="text-[11px] text-gray-500 hover:text-red-400 transition-colors">
              ✕ ลบเส้นทาง
            </button>
          )}
        </div>

        {/* Right: time + logout */}
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[11px] text-gray-400">Live</span>
            </div>
            <div className="text-[11px] text-gray-500">
              {lastUpdate.toLocaleTimeString('th-TH')}
            </div>
          </div>
          <button onClick={handleLogout}
                  className="text-[11px] text-gray-500 hover:text-white transition-colors px-2 py-1">
            ออกจากระบบ
          </button>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <OrganizerMap
          runners={runners}
          trackedUserId={trackedUserId}
          selectedRunner={selectedRunner}
          gpxPoints={gpxPoints}
          onRunnerClick={setSelectedRunner}
        />
        <AlertSidebar
          runners={runners}
          stats={stats}
          selectedRunner={selectedRunner}
          trackedUserId={trackedUserId}
          onSelectRunner={setSelectedRunner}
          onTrackRunner={setTrackedUserId}
        />
      </div>

      {/* ── SOS Banner ────────────────────────────────────────────────────────── */}
      {stats.sos > 0 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 sos-pulse">
          <div className="bg-red-600 text-white px-6 py-2.5 rounded-full shadow-2xl
                          flex items-center gap-2.5 font-semibold">
            <span className="text-lg">🚨</span>
            <span>SOS Alert: {stats.sos} คน ต้องการความช่วยเหลือ!</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LiveBadge({ color, label, value, pulse }: {
  color: string; label: string; value: number; pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${pulse ? 'sos-pulse' : ''}`}
           style={{ backgroundColor: color }} />
      <span className="text-sm font-semibold text-white tabular-nums">{value}</span>
      <span className="text-[11px] text-gray-400">{label}</span>
    </div>
  );
}
