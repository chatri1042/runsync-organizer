'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, doc, getDoc, query, where, orderBy, updateDoc, addDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth, waitForAuth } from '@/lib/firebase';
import {
  Runner, Participant, EventStats, OrganizerEvent, RunnerStatus,
  computeRunnerStatus, distanceToRouteMeters, OFF_ROUTE_THRESHOLD_M,
  formatDistance, formatPace, formatTimeAgo, buildCsv, buildLocationMessage,
  STATUS_CONFIG,
} from '@/lib/types';
import OrganizerMap from '@/components/OrganizerMap';

type FilterMode = 'all' | 'sos' | 'stationary' | 'no_signal' | 'off_route' | 'finished' | 'not_started' | 'top20';

// ผู้นำ (🥇) จะถูกครองก็ต่อเมื่อ: งานเริ่มแล้ว + วิ่งเกินระยะขั้นต่ำ (กัน GPS drift ตอนเพิ่งกดเริ่ม)
const LEADER_MIN_DISTANCE_M = 100;
const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// ─── Small SVG icons (Feather style) ─────────────────────────────────────────
function Icon({ d, size = 18, className = '' }: { d: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
const IC = {
  menu:    'M4 7h16M4 12h16M4 17h16',
  map:     'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-1 .57M8 2v16M16 6v16',
  trophy:  'M6 9H4.5a2.5 2.5 0 0 1 0-5H6m12 5h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M18 2H6v7a6 6 0 0 0 12 0V2Z',
  chart:   'M18 20V10M12 20V4M6 20v-6',
  shield:  'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  alert:   'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01',
  search:  'M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  down:    'M6 9l6 6 6-6',
  export:  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  route:   'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  flag:    'M4 22V4c0-.6.4-1 1-1h14l-4 5 4 5H5',
  eye:     'M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  pin:     'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  team:    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  x:       'M18 6L6 18M6 6l12 12',
};

// ─── Avatar (รูปโปรไฟล์ + fallback ตัวอักษรแรกของชื่อ) ────────────────────────
function Avatar({ src, name, size = 32, ring = false }: {
  src?: string; name: string; size?: number; ring?: boolean;
}) {
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  const ringCls = ring ? 'ring-2 ring-brand ring-offset-1' : 'border border-line';
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} width={size} height={size}
         referrerPolicy="no-referrer"
         className={`rounded-full object-cover shrink-0 ${ringCls}`}
         style={{ width: size, height: size }} />
  ) : (
    <div className={`rounded-full shrink-0 flex items-center justify-center bg-brand/15 text-brand font-semibold ${ringCls}`}
         style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initial}
    </div>
  );
}

export default function DashboardPage({ params }: { params: { eventId: string } }) {
  const router  = useRouter();
  const eventId = params.eventId;

  const [rawRunners,     setRawRunners]     = useState<Omit<Runner, 'runnerStatus' | 'rank'>[]>([]);
  const [participants,   setParticipants]   = useState<Participant[]>([]);
  const [partByUid,      setPartByUid]      = useState<Record<string, { docId: string; bib?: string }>>({});
  const [bibEdit,        setBibEdit]        = useState<string | null>(null);
  const [bibDraft,       setBibDraft]       = useState('');
  const [clubRegs,       setClubRegs]       = useState<Participant[]>([]);
  const [isClubEvent,    setIsClubEvent]    = useState(false);
  // id จริงของงานใน events/ — Event Code อาจเป็นชื่อจำง่ายที่ admin ตั้ง (organizer_events.realEventId)
  const [srcId,          setSrcId]          = useState<string | null>(null);
  const [event,          setEvent]          = useState<OrganizerEvent | null>(null);
  const [selectedRunner, setSelectedRunner] = useState<Runner | null>(null);
  const [contact, setContact] = useState<{ phoneSelf: string; emergencyName: string; emergencyPhone: string } | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [trackedUserId,  setTrackedUserId]  = useState<string | null>(null);

  // ── ดึงเบอร์โทร + ผู้ติดต่อฉุกเฉิน (private) จาก server เมื่อเลือกนักวิ่ง ──
  useEffect(() => {
    const uid = selectedRunner?.userId;
    if (!uid) { setContact(null); return; }
    let cancelled = false;
    setContact(null);
    setContactLoading(true);
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(
          `/api/runner-contact?code=${encodeURIComponent(eventId)}&userId=${encodeURIComponent(uid)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) setContact({
          phoneSelf: data.phoneSelf ?? '',
          emergencyName: data.emergencyName ?? '',
          emergencyPhone: data.emergencyPhone ?? '',
        });
      } catch {
        if (!cancelled) setContact({ phoneSelf: '', emergencyName: '', emergencyPhone: '' });
      } finally {
        if (!cancelled) setContactLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRunner?.userId, eventId]);
  const [lastUpdate,     setLastUpdate]     = useState<Date>(new Date());
  const [authChecked,    setAuthChecked]    = useState(false);
  const [gpxPoints,      setGpxPoints]      = useState<{lat:number;lng:number}[]>([]);
  const [sideOpen,       setSideOpen]       = useState(true);
  const [panelMin,       setPanelMin]       = useState(false);
  const [panelFull,      setPanelFull]      = useState(false);
  const [cleanMode,      setCleanMode]      = useState(false);
  const [toast,          setToast]          = useState('');
  const [teamOpen,       setTeamOpen]       = useState(false);
  const [allowOpen,      setAllowOpen]      = useState(false);
  const [broadcastOpen,  setBroadcastOpen]  = useState(false);
  const [leaderTrail,    setLeaderTrail]    = useState<{lat:number;lng:number}[]>([]);
  const [serverTrail,    setServerTrail]    = useState<{lat:number;lng:number}[]>([]);
  const leaderTrailRef = useRef<{ userId: string | null; pts: {lat:number;lng:number}[] }>({ userId: null, pts: [] });

  // ลิงก์กลับเว็บหลัก RunSync (ตั้ง NEXT_PUBLIC_MAIN_SITE_URL ตอน deploy)
  const MAIN_SITE = process.env.NEXT_PUBLIC_MAIN_SITE_URL ?? 'https://runsync.app';
  const [search,         setSearch]         = useState('');
  const [filterMode,     setFilterMode]     = useState<FilterMode>('all');

  // ── GPX/KML upload ──────────────────────────────────────────────────────────
  function handleGpxFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text  = ev.target?.result as string;
      const isKml = file.name.toLowerCase().endsWith('.kml');
      const parser = new DOMParser();
      const xml    = parser.parseFromString(text, 'application/xml');
      const pts: {lat:number;lng:number}[] = [];
      if (isKml) {
        xml.querySelectorAll('coordinates').forEach(node => {
          node.textContent?.trim().split(/\s+/).forEach(coord => {
            const [lngStr, latStr] = coord.split(',');
            const lat = parseFloat(latStr);
            const lng = parseFloat(lngStr);
            if (!isNaN(lat) && !isNaN(lng)) pts.push({ lat, lng });
          });
        });
      } else {
        xml.querySelectorAll('trkpt, rtept, wpt').forEach(node => {
          const lat = parseFloat(node.getAttribute('lat') ?? '');
          const lng = parseFloat(node.getAttribute('lon') ?? '');
          if (!isNaN(lat) && !isNaN(lng)) pts.push({ lat, lng });
        });
      }
      if (pts.length > 0) {
        setGpxPoints(pts);
        saveRoute(pts);   // เซฟถาวรผูกกับงาน — เปิดใหม่เส้นก็ยังอยู่
      } else {
        alert(`ไม่พบข้อมูลพิกัดใน ${isKml ? 'KML' : 'GPX'} file`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // เซฟ/ลบเส้นทางลง Firestore ผ่าน API (ตรวจสิทธิ์เจ้าของงานฝั่ง server)
  async function saveRoute(pts: { lat: number; lng: number }[]) {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: eventId, points: pts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToast('บันทึกเส้นทางไว้กับงานแล้ว — เปิดครั้งหน้าเส้นขึ้นอัตโนมัติ');
    } catch (e) {
      setToast(`เส้นแสดงชั่วคราว (บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : 'error'})`);
    } finally {
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function clearRoute() {
    setGpxPoints([]);
    try {
      const token = await auth.currentUser?.getIdToken();
      await fetch('/api/route', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: eventId }),
      });
    } catch { /* เส้นถูกเอาออกจากจอแล้ว */ }
  }

  // ── Auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const raw = sessionStorage.getItem('organizer_auth');
    if (!raw) { router.replace('/'); return; }
    try {
      const a = JSON.parse(raw);
      if (a.eventId !== eventId || Date.now() > a.expiresAt) {
        sessionStorage.removeItem('organizer_auth');
        router.replace('/');
        return;
      }
    } catch { router.replace('/'); return; }
    setAuthChecked(true);
  }, [eventId, router]);

  // ── Load event info ─────────────────────────────────────────────────────────
  // งานปกติอ่านจาก organizer_events; ถ้าเป็นงานของ run club (มี doc ใน run_club_events
  // ด้วย id เดียวกัน — แอปใช้ id นี้เขียน liveLocations อยู่แล้ว) ใช้ชื่อ/ระยะจากที่นั่นแทน
  useEffect(() => {
    if (!authChecked) return;
    (async () => {
      try {
        // 1) organizer_events/{code} → หา id จริง (realEventId) ก่อน
        const orgSnap = await getDoc(doc(db, 'organizer_events', eventId));
        const org = orgSnap.exists() ? orgSnap.data() : null;
        const realId = (org?.realEventId as string) ?? eventId;
        setSrcId(realId);

        // เส้นทางวิ่งที่เซฟถาวรไว้กับงาน (อัพ GPX ครั้งเดียว เปิดใหม่ก็ยังอยู่)
        if (Array.isArray(org?.routePoints) && org.routePoints.length >= 2) {
          setGpxPoints(org.routePoints as { lat: number; lng: number }[]);
        }

        // 2) เช็คว่าเป็นงาน run club มั้ย (ใช้ id จริง)
        const clubSnap = await getDoc(doc(db, 'run_club_events', realId));
        const club = clubSnap.exists() ? clubSnap.data() : null;
        setIsClubEvent(!!club);
        setEvent({
          eventId,
          realEventId:   realId,
          eventName:     (club?.name as string) ?? org?.eventName ?? eventId,
          isActive:      org?.isActive ?? true,
          totalDistance: (club?.routeDistanceKm as number) ?? org?.totalDistance,
          // งานคลับวิ่ง: liveRunActive = organizer กด Start Run แล้ว; งานปกติไม่มีสัญญาณนี้ → ถือว่าเริ่ม
          isLive:        club ? ((club.liveRunActive as boolean) ?? false) : true,
          startTime:     (club?.liveStartedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
        });
      } catch (err) {
        console.error('event info load error:', err);
        setSrcId(eventId);   // fallback: ใช้ code ตรงๆ (แบบเดิม)
      }
    })();
  }, [authChecked, eventId]);

  // ── Live location listener ──────────────────────────────────────────────────
  useEffect(() => {
    if (!authChecked || !srcId) return;
    let cancelled = false;
    let unsubscribe = () => {};

    // ต้องมี Firebase auth (custom token จากตอน login) ก่อน ไม่งั้น Firestore rules
    // ของ liveLocations (allow read: if isSignedIn()) จะปฏิเสธ → อ่านหมุดนักวิ่งไม่ได้
    waitForAuth().then(user => {
      if (cancelled) return;
      if (!user) { router.replace('/'); return; }
      const q = collection(db, 'events', srcId, 'liveLocations');
      unsubscribe = onSnapshot(q, snapshot => {
        const list: Omit<Runner, 'runnerStatus' | 'rank'>[] = [];
        snapshot.docs.forEach(d => {
          const data = d.data();
          const lat  = (data.lat as number | undefined) ?? 0;
          const lng  = (data.lon as number | undefined) ?? (data.lng as number | undefined) ?? 0;
          if (lat === 0 && lng === 0) return;
          list.push({
            userId:      (data.userId      as string) ?? d.id,
            displayName: (data.displayName as string) ?? 'Unknown',
            photoURL:    data.photoURL     as string | undefined,
            lat, lng,
            distance:    (data.distance    as number) ?? 0,
            speed:       (data.speed       as number) ?? 0,
            heading:     (data.heading     as number) ?? 0,
            status:      (data.status      as string) ?? 'running',
            teamId:      data.teamId    as string | undefined,
            bibNumber:   data.bibNumber as string | undefined,
            updatedAt:   data.updatedAt?.toDate?.() ?? new Date(0),
          });
        });
        setRawRunners(list);
        setLastUpdate(new Date());
      }, err => {
        console.error('liveLocations read error:', err);
      });
    }).catch(err => {
      console.error('auth wait failed:', err);
    });

    return () => { cancelled = true; unsubscribe(); };
  }, [authChecked, srcId, router]);

  // ── Participants listener (คน register งานนี้ — รวมคนที่ยังไม่เริ่มวิ่ง) ──────
  // อ่านจาก collection แบบ flat `event_participants` (rules อนุญาตทุก signed-in user)
  // หมายเหตุ: ห้ามใช้ subcollection events/{id}/participants — rule จำกัดเจ้าของ doc
  useEffect(() => {
    if (!authChecked || !srcId) return;
    let cancelled = false;
    let unsubscribe = () => {};
    waitForAuth().then(user => {
      if (cancelled || !user) return;
      const q = query(collection(db, 'event_participants'), where('eventId', '==', srcId));
      unsubscribe = onSnapshot(q, snapshot => {
        const seen = new Map<string, Participant>();
        const pmap: Record<string, { docId: string; bib?: string }> = {};
        snapshot.docs.forEach(d => {
          const data = d.data();
          // ✅ ตัดคนใน waitlist (คิวรอ) ออกจากรายชื่อหลัก — ให้ตรงกับฝั่ง registrations
          //    ยอดผู้เข้าร่วมจะนับเฉพาะคน confirmed จริง (ไม่รวมคิวรอ)
          const pStatus = (data.status as string) ?? 'confirmed';
          if (pStatus === 'waitlisted') return;
          const userId = (data.userId as string) ?? d.id;
          if (!pmap[userId]) pmap[userId] = { docId: d.id, bib: data.bibNumber as string | undefined };
          if (seen.has(userId)) return;   // กัน join ซ้ำหลาย doc
          seen.set(userId, {
            userId,
            // schema ไม่คงที่: บาง doc ใช้ userName/userPhotoUrl บาง doc ใช้ displayName/photoURL
            displayName: (data.userName as string) ?? (data.displayName as string) ?? 'Runner',
            photoURL:    (data.userPhotoUrl as string) ?? (data.photoURL as string) ?? undefined,
            role:        data.role as string | undefined,
            teamName:    data.teamName as string | undefined,
          });
        });
        setParticipants(Array.from(seen.values()));
        setPartByUid(pmap);
      }, err => {
        console.error('event_participants read error:', err);
      });
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [authChecked, srcId]);

  // ── Registrations ของงาน run club (subcollection คนละ path กับ event ปกติ) ──
  useEffect(() => {
    if (!authChecked || !isClubEvent || !srcId) { setClubRegs([]); return; }
    let cancelled = false;
    let unsubscribe = () => {};
    waitForAuth().then(user => {
      if (cancelled || !user) return;
      const q = collection(db, 'run_club_events', srcId, 'registrations');
      unsubscribe = onSnapshot(q, snapshot => {
        const list: Participant[] = [];
        snapshot.docs.forEach(d => {
          const data = d.data();
          // นับเฉพาะคนที่ยังอยู่ในงานจริง (ตัด waitlist/ยกเลิก/no-show)
          const status = (data.status as string) ?? 'registered';
          if (!['registered', 'confirmed', 'attended'].includes(status)) return;
          list.push({
            userId:      (data.userId as string) ?? d.id,
            displayName: (data.displayName as string) ?? 'Runner',
            photoURL:    (data.photoUrl as string) ?? undefined,
            role:        'runner',
          });
        });
        setClubRegs(list);
      }, err => console.error('run_club registrations read error:', err));
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [authChecked, srcId, isClubEvent]);

  // ── รูปโปรไฟล์ตาม userId (fallback ให้หมุด/การ์ด เผื่อ liveLocations ไม่มี photoURL) ──
  const photoByUid = useMemo(() => {
    const m: Record<string, string> = {};
    [...participants, ...clubRegs].forEach(p => {
      if (p.photoURL && !m[p.userId]) m[p.userId] = p.photoURL;
    });
    return m;
  }, [participants, clubRegs]);

  // ── Enrich: สถานะ + อันดับ + off-route (คำนวณใหม่เมื่อข้อมูล/route เปลี่ยน) ──
  const runners: Runner[] = useMemo(() => {
    const now = new Date();
    const list = rawRunners.map(r => {
      const runnerStatus = computeRunnerStatus(r.status, r.updatedAt, now, r.distance, event?.totalDistance);
      const offRoute = gpxPoints.length >= 2 && r.lat !== 0
        ? distanceToRouteMeters(r.lat, r.lng, gpxPoints) > OFF_ROUTE_THRESHOLD_M
        : false;
      return {
        ...r,
        photoURL: r.photoURL || photoByUid[r.userId],
        bibNumber: partByUid[r.userId]?.bib ?? r.bibNumber,
        runnerStatus, offRoute, rank: 0,
      };
    });
    list.sort((a, b) => b.distance - a.distance);
    list.forEach((r, i) => { r.rank = i + 1; });
    return list;
  }, [rawRunners, event?.totalDistance, gpxPoints, lastUpdate, partByUid, photoByUid]);

  async function saveBib(userId: string) {
    const bib = bibDraft.trim();
    const existing = partByUid[userId];
    try {
      if (existing?.docId) {
        await updateDoc(doc(db, 'event_participants', existing.docId), { bibNumber: bib });
      } else if (srcId) {
        await addDoc(collection(db, 'event_participants'), { eventId: srcId, userId, bibNumber: bib });
      }
    } catch (e) { console.error('save bib error', e); }
    setBibEdit(null);
  }

  // ── งานเริ่มจริงหรือยัง (club: กด Start Run = liveRunActive; กันค้างข้ามวันด้วยวันที่เริ่ม) ──
  const raceStarted = useMemo(() => {
    if (!event) return false;
    if (event.isLive === false) return false;                              // คลับที่ยังไม่กด Start Run
    if (event.startTime && !isSameDay(event.startTime, new Date())) return false;  // เริ่มค้างจากวันก่อน
    return true;
  }, [event]);

  // ── ผู้นำ: อันดับ 1 ที่ "งานเริ่มแล้ว + วิ่งเกิน 100 ม." เท่านั้น (กัน GPS drift ก่อนออกตัว) ──
  const leader = useMemo(
    () => (raceStarted
      ? runners.find(r =>
          r.rank === 1 && r.runnerStatus === 'active' && r.lat !== 0 &&
          r.distance > LEADER_MIN_DISTANCE_M) ?? null
      : null),
    [runners, raceStarted]);

  // ── เส้นทางผู้นำจาก history จริง (iOS เขียน liveLocations/{uid}/history ตั้งแต่ออกตัว) ──
  const leaderId = leader?.userId ?? null;

  useEffect(() => {
    if (!authChecked || !leaderId || !srcId) { setServerTrail([]); return; }
    const q = query(
      collection(db, 'events', srcId, 'liveLocations', leaderId, 'history'),
      orderBy('timestamp'));
    const unsub = onSnapshot(q, snap => {
      const pts = snap.docs.map(d => {
        const v = d.data();
        return { lat: (v.lat as number) ?? 0, lng: (v.lon as number) ?? (v.lng as number) ?? 0 };
      }).filter(p => p.lat !== 0 || p.lng !== 0);
      setServerTrail(pts);
    }, err => console.error('leader history read error:', err));
    return () => unsub();
  }, [authChecked, srcId, leaderId]);

  // ── fallback: สะสมพิกัดสดฝั่งเว็บ (เผื่อเครื่องนักวิ่งรุ่นเก่าไม่เขียน history) ──
  useEffect(() => {
    if (!leader) return;
    const t = leaderTrailRef.current;
    if (t.userId !== leader.userId) { t.userId = leader.userId; t.pts = []; }  // ผู้นำเปลี่ยนคน → เริ่มเส้นใหม่
    const last = t.pts[t.pts.length - 1];
    if (!last || Math.abs(last.lat - leader.lat) + Math.abs(last.lng - leader.lng) > 0.00005) {
      t.pts.push({ lat: leader.lat, lng: leader.lng });
      if (t.pts.length > 3000) t.pts.shift();
      setLeaderTrail([...t.pts]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runners]);

  // ── คนที่ถูก track อยู่แล้วเข้าเส้นชัย → หยุดติดตามอัตโนมัติ (ความเป็นส่วนตัว) ──
  useEffect(() => {
    if (!trackedUserId) return;
    const r = runners.find(r => r.userId === trackedUserId);
    if (r?.runnerStatus === 'finished') setTrackedUserId(null);
  }, [runners, trackedUserId]);

  // ── รวมผู้ลงทะเบียนสองแหล่ง (event ปกติ + run club) แล้วหาคนยังไม่เริ่มวิ่ง ──
  const allParticipants: Participant[] = useMemo(() => {
    const seen = new Map<string, Participant>();
    [...participants, ...clubRegs].forEach(p => { if (!seen.has(p.userId)) seen.set(p.userId, p); });
    return Array.from(seen.values());
  }, [participants, clubRegs]);

  const notStarted: Participant[] = useMemo(() => {
    const running = new Set(runners.map(r => r.userId));
    return allParticipants.filter(p => p.role !== 'spectator' && !running.has(p.userId));
  }, [allParticipants, runners]);

  const stats: EventStats = {
    total:      runners.length,
    active:     runners.filter(r => r.runnerStatus === 'active').length,
    stationary: runners.filter(r => r.runnerStatus === 'stationary').length,
    noSignal:   runners.filter(r => r.runnerStatus === 'no_signal').length,
    sos:        runners.filter(r => r.runnerStatus === 'sos').length,
    finished:   runners.filter(r => r.runnerStatus === 'finished').length,
    offRoute:   runners.filter(r => r.offRoute).length,
    notStarted: notStarted.length,
  };

  // ── Filter + search สำหรับตาราง ─────────────────────────────────────────────
  const filteredRunners = useMemo(() => {
    let list = [...runners];
    switch (filterMode) {
      case 'sos':        list = list.filter(r => r.runnerStatus === 'sos');        break;
      case 'stationary': list = list.filter(r => r.runnerStatus === 'stationary'); break;
      case 'no_signal':  list = list.filter(r => r.runnerStatus === 'no_signal');  break;
      case 'off_route':  list = list.filter(r => r.offRoute);                      break;
      case 'finished':   list = list.filter(r => r.runnerStatus === 'finished');   break;
      case 'not_started': list = []; break;   // แสดงจาก notStarted แทน
      case 'top20':      list = list.slice(0, 20); break;
      default:
        // SOS ปักบนสุดเสมอ ที่เหลือเรียงตามอันดับ
        list.sort((a, b) =>
          (a.runnerStatus === 'sos' ? -1 : 0) - (b.runnerStatus === 'sos' ? -1 : 0) ||
          a.rank - b.rank);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r =>
        r.displayName.toLowerCase().includes(q) || r.bibNumber?.toLowerCase().includes(q));
    }
    return list;
  }, [runners, filterMode, search]);

  const filteredNotStarted = useMemo(() => {
    if (filterMode !== 'not_started') return [];
    const q = search.trim().toLowerCase();
    return q ? notStarted.filter(p => p.displayName.toLowerCase().includes(q)) : notStarted;
  }, [filterMode, notStarted, search]);

  // ── Export CSV ──────────────────────────────────────────────────────────────
  function handleExport() {
    const csv  = buildCsv(runners, notStarted);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `runsync_${eventId}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleLogout() {
    sessionStorage.removeItem('organizer_auth');
    signOut(auth).catch(() => {});
    router.replace('/');
  }

  // ── Share location: คัดลอกข้อความพร้อมพิกัด+ลิงก์นำทาง ส่ง LINE ได้เลย ──
  function copyLocation(r: Runner) {
    navigator.clipboard.writeText(buildLocationMessage(r)).then(() => {
      setToast(`คัดลอกตำแหน่งของ ${r.displayName} แล้ว — วางส่งในไลน์ทีมงานได้เลย`);
      setTimeout(() => setToast(''), 2500);
    }).catch(() => {
      setToast('คัดลอกไม่สำเร็จ');
      setTimeout(() => setToast(''), 2000);
    });
  }

  if (!authChecked) {
    return (
      <div className="h-screen bg-bg flex items-center justify-center">
        <div className="text-sub text-lg">กำลังตรวจสอบสิทธิ์...</div>
      </div>
    );
  }

  const FILTERS: { mode: FilterMode; label: string; count?: number }[] = [
    { mode: 'all',         label: 'ทั้งหมด' },
    { mode: 'sos',         label: 'SOS',           count: stats.sos },
    { mode: 'stationary',  label: 'หยุดนิ่ง',     count: stats.stationary },
    { mode: 'no_signal',   label: 'ไม่มีสัญญาณ',   count: stats.noSignal },
    ...(gpxPoints.length >= 2 ? [{ mode: 'off_route' as FilterMode, label: 'หลุดเส้นทาง', count: stats.offRoute }] : []),
    { mode: 'finished',    label: 'เข้าเส้นชัย',  count: stats.finished },
    { mode: 'not_started', label: 'ยังไม่เริ่ม',  count: stats.notStarted },
    { mode: 'top20',       label: 'Top 20' },
  ];

  return (
    <div className="h-screen bg-bg flex flex-col overflow-hidden">

      {/* ── Top bar ── */}
      <header className="relative flex items-center gap-4 px-5 h-16 bg-surface border-b border-line shrink-0 z-30">
        <button onClick={() => setSideOpen(o => !o)}
                className="w-10 h-10 rounded-xl border border-line text-sub hover:text-ink hover:bg-bg
                           flex items-center justify-center transition-colors" title="ซ่อน/แสดงเมนู">
          <Icon d={IC.menu} />
        </button>
        {/* โลโก้กดกลับเว็บหลัก runsync ได้ */}
        <a href={MAIN_SITE} className="flex items-center gap-2.5 group" title="กลับเว็บหลัก RunSync">
          <div className="w-9 h-9 bg-brand rounded-xl flex items-center justify-center shadow-brand">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="hidden lg:inline font-en font-extrabold text-lg tracking-tight group-hover:opacity-80 transition-opacity">
            RUNSYNC <span className="text-brand">RACE CONTROL</span>
          </span>
        </a>

        {/* ชื่องาน (มือถือ/แท็บเล็ต) */}
        <div className="lg:hidden min-w-0 flex-1">
          <div className="font-bold text-[15px] text-ink truncate leading-tight">{event?.eventName ?? ''}</div>
          <div className="text-[11px] text-faint font-en truncate">{eventId}</div>
        </div>
        <a href={MAIN_SITE}
           className="hidden md:flex items-center gap-1.5 text-[14.5px] text-faint hover:text-brand transition-colors">
          ← เว็บหลัก
        </a>

        {/* ชื่องานกลางจอ (desktop) */}
        <div className="hidden lg:flex flex-col items-center absolute left-1/2 -translate-x-1/2 max-w-[34%] pointer-events-none">
          <div className="text-[16px] font-bold text-ink truncate max-w-full">{event?.eventName ?? ''}</div>
          <div className="text-[12px] text-faint font-en">{eventId}</div>
        </div>

        <div className="ml-auto flex items-center gap-4">
          {/* โหมดคลีน: ซ่อนกล่องข้อมูล/สัญลักษณ์บนแผนที่ */}
          <button onClick={() => setCleanMode(c => !c)}
                  title={cleanMode ? 'แสดงกล่องข้อมูล' : 'โหมดคลีน (ซ่อนกล่องข้อมูล)'}
                  className={`h-10 px-3.5 rounded-xl border text-[14.5px] flex items-center gap-2 transition-colors
                              ${cleanMode
                                ? 'bg-brand text-white border-brand shadow-brand'
                                : 'border-line text-sub hover:text-ink hover:bg-bg'}`}>
            <Icon d={IC.eye} size={16} /> โหมดคลีน
          </button>
          <div className="text-right hidden sm:block">
            <div className="flex items-center justify-end gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-600 soft-pulse" />
              <span className="text-[14px] text-sub font-en font-semibold">LIVE</span>
            </div>
            <div className="text-[13.5px] text-faint">
              อัพเดท {lastUpdate.toLocaleTimeString('th-TH')}
            </div>
          </div>
          <button onClick={handleLogout}
                  className="h-10 px-4 rounded-xl border border-line text-[15px] text-sub
                             hover:text-ink hover:bg-bg transition-colors">
            ออกจากระบบ
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar (ซ่อน/แสดงได้) ── */}
        <aside className={`w-60 bg-surface border-r border-line flex flex-col shrink-0
                           transition-all duration-300 ${sideOpen ? 'ml-0' : '-ml-60'}`}>
          <div className="flex items-center gap-3 p-4 border-b border-line">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-[#E8794D]
                            flex items-center justify-center text-white">
              <Icon d={IC.flag} />
            </div>
            <div className="min-w-0">
              <div className="text-[16px] font-semibold truncate">{event?.eventName ?? 'กำลังโหลด...'}</div>
              <div className="text-[13.5px] text-faint font-en truncate">
                {eventId}{isClubEvent && <span className="ml-1.5 text-brand font-thai">· งานคลับวิ่ง</span>}
              </div>
            </div>
          </div>

          <nav className="p-2.5 space-y-0.5">
            <button className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[15.5px]
                               bg-brand/10 text-brand font-medium">
              <Icon d={IC.map} /> แผนที่สด
            </button>
            <button onClick={() => setTeamOpen(true)}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[15.5px]
                               text-sub hover:bg-bg hover:text-ink transition-colors">
              <Icon d={IC.team} /> ทีมงาน
            </button>
            {isClubEvent && (
              <button onClick={() => setAllowOpen(true)}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[15.5px]
                                 text-sub hover:bg-bg hover:text-ink transition-colors">
                <Icon d={IC.shield} /> รายชื่อผู้ลงทะเบียน
              </button>
            )}
            {[
              { ic: IC.trophy, t: 'กระดานผู้นำ' },
              { ic: IC.chart,  t: 'สถิติ' },
              { ic: IC.shield, t: 'ความปลอดภัย' },
            ].map(item => (
              <button key={item.t} disabled
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[15.5px]
                                 text-faint cursor-not-allowed">
                <Icon d={item.ic} /> {item.t}
                <span className="ml-auto text-[12.5px] bg-bg border border-line rounded-full px-2 py-0.5">เร็วๆ นี้</span>
              </button>
            ))}
          </nav>

          <div className="flex-1" />

          {/* Emergency broadcast — เปิด modal ส่งประกาศจริง */}
          <button
            onClick={() => setBroadcastOpen(true)}
            className="mx-3.5 mb-3.5 h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[15.5px]
                       font-medium flex items-center justify-center gap-2 shadow-[0_2px_10px_rgba(220,38,38,.3)]
                       transition-colors">
            <Icon d={IC.alert} size={17} /> ประกาศฉุกเฉิน
          </button>
        </aside>

        {/* ── Map stage ── */}
        <div className="relative flex-1 overflow-hidden">
          <OrganizerMap
            runners={runners}
            leader={leader}
            trackedUserId={trackedUserId}
            selectedRunner={selectedRunner}
            gpxPoints={gpxPoints}
            leaderTrail={serverTrail.length >= 2 ? serverTrail : leaderTrail}
            showLegend={!cleanMode}
            onRunnerClick={setSelectedRunner}
          />

          {/* การ์ดลอย: จำนวนนักวิ่ง */}
          <div className={`absolute top-4 left-4 z-20 bg-surface border border-line rounded-2xl
                          shadow-float px-5 py-3.5 ${cleanMode ? 'hidden' : ''}`}>
            <div className="flex items-center gap-2 text-[13px] font-en font-semibold uppercase tracking-wide text-faint">
              <span className="w-2 h-2 rounded-full bg-green-600 soft-pulse" /> นักวิ่งในสนาม
            </div>
            <div className="font-num text-[34px] font-extrabold leading-tight">{stats.total.toLocaleString()}</div>
            {allParticipants.length > 0 && (
              <div className="text-[13.5px] text-sub">
                ลงทะเบียน {allParticipants.filter(p => p.role !== 'spectator').length.toLocaleString()} ·
                ยังไม่เริ่ม <span className="font-semibold">{stats.notStarted.toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* การ์ดลอย: สถานะ (กดเพื่อกรองตาราง) */}
          <div className={`absolute top-4 right-4 z-20 bg-surface border border-line rounded-2xl
                          shadow-float px-4 py-3 space-y-1.5 min-w-[190px] ${cleanMode ? 'hidden' : ''}`}>
            {([
              ['active',     stats.active]     as const,
              ['stationary', stats.stationary] as const,
              ['no_signal',  stats.noSignal]   as const,
              ['finished',   stats.finished]   as const,
              ['sos',        stats.sos]        as const,
            ]).map(([s, v]) => (
              <button key={s}
                      onClick={() => setFilterMode(prev => prev === s ? 'all' : s as FilterMode)}
                      className={`w-full flex items-center gap-2.5 text-[14.5px] rounded-lg px-1.5 py-0.5
                                  transition-colors hover:bg-bg
                                  ${filterMode === s ? 'bg-bg' : ''}
                                  ${s === 'sos' && v > 0 ? 'text-red-600 font-semibold' : 'text-sub'}`}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_CONFIG[s].color }} />
                {STATUS_CONFIG[s].label}
                <span className={`font-num font-bold ml-auto pl-4 ${s === 'sos' && v > 0 ? '' : 'text-ink'}`}>{v}</span>
              </button>
            ))}
            {gpxPoints.length >= 2 && (
              <button onClick={() => setFilterMode(prev => prev === 'off_route' ? 'all' : 'off_route')}
                      className={`w-full flex items-center gap-2.5 text-[14.5px] rounded-lg px-1.5 py-0.5
                                  hover:bg-bg transition-colors text-purple-700
                                  ${filterMode === 'off_route' ? 'bg-bg' : ''}`}>
                <span className="w-2.5 h-2.5 rounded-full border-2 border-purple-500 bg-purple-100" />
                หลุดเส้นทาง
                <span className="font-num font-bold ml-auto pl-4">{stats.offRoute}</span>
              </button>
            )}
          </div>

          {/* การ์ดนักวิ่งที่เลือก — คัดลอกตำแหน่งส่งทีมงานได้จากตรงนี้ */}
          {selectedRunner && (() => {
            const r = runners.find(x => x.userId === selectedRunner.userId) ?? selectedRunner;
            const cfg = STATUS_CONFIG[r.runnerStatus];
            return (
              <div className="absolute top-36 left-4 z-30 bg-surface border border-line rounded-2xl
                              shadow-float px-5 py-4 w-[290px]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <Avatar src={r.photoURL} name={r.displayName} size={46} ring />
                    <div className="min-w-0">
                    <div className="text-[17px] font-semibold truncate">
                      {r.displayName}
                      {r.bibNumber && <span className="font-num text-[14px] text-faint ml-1.5">{r.bibNumber}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium px-2.5 py-0.5 rounded-full"
                            style={{ color: cfg.color, backgroundColor: cfg.bgColor }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                        {cfg.label}
                      </span>
                      {r.offRoute && (
                        <span className="text-[12.5px] text-purple-700 bg-purple-50 border border-purple-200
                                         rounded-full px-2 py-0.5">หลุดเส้นทาง</span>
                      )}
                    </div>
                    </div>
                  </div>
                  <button onClick={() => setSelectedRunner(null)}
                          className="p-1 rounded-lg text-faint hover:text-ink hover:bg-bg shrink-0">
                    <Icon d={IC.x} size={15} />
                  </button>
                </div>
                <div className="text-[14.5px] text-sub mt-2.5 space-y-0.5">
                  <div>ระยะ <span className="font-num font-semibold text-ink">{formatDistance(r.distance)}</span>
                    {' · '}เพซ <span className="font-num font-semibold text-ink">{formatPace(r.speed)}</span></div>
                  <div>อัพเดต {formatTimeAgo(r.updatedAt)}</div>
                  <div className="font-num text-[13.5px] text-faint">{r.lat.toFixed(6)}, {r.lng.toFixed(6)}</div>
                </div>
                {/* BIB — ผู้จัดกำหนด/แก้ได้ (เขียนลง event_participants) */}
                <div className="mt-3 flex items-center gap-2 text-[14px]">
                  <span className="text-faint w-[52px] shrink-0">BIB</span>
                  {bibEdit === r.userId ? (
                    <>
                      <input autoFocus value={bibDraft} onChange={e => setBibDraft(e.target.value)}
                             onKeyDown={e => { if (e.key === 'Enter') saveBib(r.userId); }}
                             placeholder="เช่น B-0001"
                             className="flex-1 h-8 px-2 rounded-lg border border-brand outline-none font-num text-[14px]" />
                      <button onClick={() => saveBib(r.userId)} className="text-brand font-medium text-[13px]">บันทึก</button>
                      <button onClick={() => setBibEdit(null)} className="text-faint text-[13px]">ยกเลิก</button>
                    </>
                  ) : (
                    <>
                      <span className="font-num font-semibold text-ink flex-1">{r.bibNumber || '—'}</span>
                      <button onClick={() => { setBibEdit(r.userId); setBibDraft(r.bibNumber ?? ''); }}
                              className="text-brand text-[13px] hover:underline shrink-0">{r.bibNumber ? 'แก้' : 'กำหนด'}</button>
                    </>
                  )}
                </div>
                {/* เบอร์โทร + ผู้ติดต่อฉุกเฉิน (private — ดึงจาก server ด้วย Admin SDK) */}
                <div className="mt-3 pt-3 border-t border-line space-y-1.5 text-[14px]">
                  {contactLoading ? (
                    <div className="text-faint text-[13.5px]">กำลังโหลดเบอร์โทร…</div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-faint w-[92px] shrink-0">เบอร์นักวิ่ง</span>
                        {contact?.phoneSelf
                          ? <a href={`tel:${contact.phoneSelf}`} className="font-num font-semibold text-brand hover:underline">{contact.phoneSelf}</a>
                          : <span className="text-faint">— ไม่ได้กรอก</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-faint w-[92px] shrink-0">ผู้ติดต่อฉุกเฉิน</span>
                        <span className="text-ink truncate">{contact?.emergencyName || '—'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-faint w-[92px] shrink-0">เบอร์ฉุกเฉิน</span>
                        {contact?.emergencyPhone
                          ? <a href={`tel:${contact.emergencyPhone}`} className="font-num font-semibold text-red-600 hover:underline">{contact.emergencyPhone}</a>
                          : <span className="text-faint">—</span>}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => copyLocation(r)}
                          className="flex-1 h-10 rounded-xl bg-brand hover:bg-brand-dk text-white text-[14.5px]
                                     font-medium flex items-center justify-center gap-1.5 shadow-brand transition-colors">
                    <Icon d={IC.pin} size={15} /> คัดลอกตำแหน่ง
                  </button>
                  <button onClick={() => setTrackedUserId(prev => prev === r.userId ? null : r.userId)}
                          title={trackedUserId === r.userId ? 'หยุดติดตาม' : 'ติดตามคนนี้'}
                          className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-colors
                                      ${trackedUserId === r.userId
                                        ? 'bg-brand text-white border-brand'
                                        : 'bg-surface text-sub border-line hover:text-brand hover:border-brand'}`}>
                    <Icon d={IC.eye} size={16} />
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Toast คัดลอกแล้ว */}
          {toast && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-40 bg-ink text-white
                            text-[14.5px] px-5 py-2.5 rounded-full shadow-float whitespace-nowrap">
              {toast}
            </div>
          )}

          {/* SOS banner */}
          {stats.sos > 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 sos-pulse">
              <button onClick={() => setFilterMode('sos')}
                      className="bg-red-600 text-white px-6 py-2.5 rounded-full shadow-2xl
                                 flex items-center gap-2.5 font-semibold text-[16px]">
                🚨 SOS: {stats.sos} คน ต้องการความช่วยเหลือ
              </button>
            </div>
          )}

          {/* ── Bottom panel: รายชื่อนักวิ่ง ── */}
          <div className={`absolute left-4 right-4 bottom-3 z-20 bg-surface border border-line rounded-2xl
                           shadow-float flex flex-col overflow-hidden transition-all duration-300
                           ${panelFull ? 'top-3' : ''}
                           ${!panelFull && panelMin ? 'translate-y-[calc(100%-60px)]' : ''}`}
               style={{ maxHeight: panelFull ? 'none' : '46%' }}>
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line shrink-0 overflow-x-auto">
              <button onClick={() => setPanelMin(m => !m)}
                      title={panelMin ? 'ขยายรายชื่อ' : 'ย่อรายชื่อ'}
                      className="shrink-0 p-1.5 rounded-lg text-faint hover:text-ink hover:bg-bg transition-colors">
                <Icon d={IC.down} className={`transition-transform duration-300 ${panelMin ? 'rotate-180' : ''}`} />
              </button>
              <span className="text-[16px] font-semibold whitespace-nowrap shrink-0">รายชื่อนักวิ่ง</span>
              <button onClick={() => { setPanelFull(f => !f); setPanelMin(false); }}
                      title={panelFull ? 'ย่อกลับ' : 'ดูเต็มจอ'}
                      className="shrink-0 h-8 px-2.5 rounded-lg border border-line text-[13px] text-sub
                                 hover:text-ink hover:bg-bg transition-colors whitespace-nowrap">
                {panelFull ? 'ย่อ' : 'เต็มจอ'}
              </button>

              <div className="flex-1 min-w-[120px] flex items-center gap-2 h-10 px-3.5 rounded-xl bg-bg border border-line
                              focus-within:border-brand transition-colors text-faint">
                <Icon d={IC.search} size={16} />
                <input value={search} onChange={e => setSearch(e.target.value)}
                       placeholder="ค้นหาชื่อ หรือ BIB..."
                       className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-ink placeholder:text-faint" />
              </div>

              {/* GPX upload */}
              <label className={`shrink-0 h-10 px-3.5 rounded-xl border text-[14px] font-medium flex items-center gap-2
                                 cursor-pointer transition-colors whitespace-nowrap
                                 ${gpxPoints.length > 0
                                   ? 'border-green-600 text-green-700 bg-green-50'
                                   : 'border-line text-sub hover:border-brand hover:text-brand bg-surface'}`}>
                <Icon d={IC.route} size={16} />
                {gpxPoints.length > 0 ? `เส้นทางโหลดแล้ว` : 'อัพโหลด GPX/KML'}
                <input type="file" accept=".gpx,.kml" className="hidden" onChange={handleGpxFile} />
              </label>
              {gpxPoints.length > 0 && (
                <button onClick={clearRoute} title="ลบเส้นทางออกจากงาน"
                        className="shrink-0 text-[14px] text-faint hover:text-red-600 transition-colors">✕</button>
              )}

              <button onClick={handleExport}
                      className="shrink-0 h-10 px-4 rounded-xl bg-brand hover:bg-brand-dk text-white text-[14.5px]
                                 font-medium flex items-center gap-2 shadow-brand transition-colors whitespace-nowrap">
                <Icon d={IC.export} size={16} /> ส่งออก CSV
              </button>
            </div>

            {/* Filter chips */}
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-line overflow-x-auto shrink-0">
              {FILTERS.map(f => (
                <button key={f.mode}
                        onClick={() => setFilterMode(prev => prev === f.mode ? 'all' : f.mode)}
                        className={`shrink-0 h-8 px-3 rounded-lg text-[14px] font-medium transition-colors
                                    ${filterMode === f.mode
                                      ? 'bg-brand text-white'
                                      : 'bg-bg text-sub border border-line hover:border-faint'}`}>
                  {f.label}{typeof f.count === 'number' ? ` (${f.count})` : ''}
                </button>
              ))}
              <span className="ml-auto text-[13.5px] text-faint whitespace-nowrap pl-3">
                แสดง {(filterMode === 'not_started' ? filteredNotStarted : filteredRunners).length} คน
              </span>
            </div>

            {/* Table */}
            <div className="overflow-y-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-[13px] font-en font-semibold uppercase tracking-wide text-faint">
                    <th className="sticky top-0 bg-surface px-4 py-2.5 border-b border-line w-16">อันดับ</th>
                    <th className="sticky top-0 bg-surface px-4 py-2.5 border-b border-line">ชื่อนักวิ่ง</th>
                    <th className="sticky top-0 bg-surface px-4 py-2.5 border-b border-line">BIB</th>
                    <th className="sticky top-0 bg-surface px-4 py-2.5 border-b border-line">เพซ</th>
                    <th className="sticky top-0 bg-surface px-4 py-2.5 border-b border-line">ระยะทาง</th>
                    <th className="sticky top-0 bg-surface px-4 py-2.5 border-b border-line">อัพเดท</th>
                    <th className="sticky top-0 bg-surface px-4 py-2.5 border-b border-line text-right">สถานะ</th>
                    <th className="sticky top-0 bg-surface px-4 py-2.5 border-b border-line w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {filterMode === 'not_started' ? (
                    filteredNotStarted.length === 0 ? (
                      <tr><td colSpan={8} className="text-center text-faint py-8 text-[15px]">
                        {allParticipants.length === 0 ? 'ยังไม่มีข้อมูลผู้ลงทะเบียน' : 'ทุกคนเริ่มวิ่งแล้ว 🎉'}
                      </td></tr>
                    ) : filteredNotStarted.map(p => (
                      <tr key={p.userId} className="hover:bg-bg/60">
                        <td className="px-4 py-2.5 border-b border-line/50 font-num text-faint">—</td>
                        <td className="px-4 py-2.5 border-b border-line/50 text-[16px] font-medium">
                          <div className="flex items-center gap-2.5">
                            <Avatar src={p.photoURL} name={p.displayName} size={32} />
                            <span>
                              {p.displayName}
                              {p.teamName && <span className="text-[13.5px] text-faint ml-2">({p.teamName})</span>}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 border-b border-line/50 text-faint">—</td>
                        <td className="px-4 py-2.5 border-b border-line/50 text-faint">—</td>
                        <td className="px-4 py-2.5 border-b border-line/50 text-faint">—</td>
                        <td className="px-4 py-2.5 border-b border-line/50 text-faint">—</td>
                        <td className="px-4 py-2.5 border-b border-line/50 text-right">
                          <span className="inline-flex items-center gap-1.5 text-[13.5px] font-medium px-3 py-1 rounded-full
                                           bg-bg text-sub border border-line">ยังไม่เริ่มวิ่ง</span>
                        </td>
                        <td className="px-4 py-2.5 border-b border-line/50"></td>
                      </tr>
                    ))
                  ) : filteredRunners.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-faint py-8 text-[15px]">
                      {search ? 'ไม่พบนักวิ่งที่ค้นหา' : 'ไม่มีนักวิ่งในกลุ่มนี้'}
                    </td></tr>
                  ) : filteredRunners.map(r => {
                    const cfg = STATUS_CONFIG[r.runnerStatus];
                    const isSel = selectedRunner?.userId === r.userId;
                    return (
                      <tr key={r.userId}
                          onClick={() => setSelectedRunner(isSel ? null : r)}
                          className={`cursor-pointer transition-colors
                                      ${r.runnerStatus === 'sos' ? 'bg-red-50' : isSel ? 'bg-brand/5' : 'hover:bg-bg/60'}`}>
                        <td className={`px-4 py-2.5 border-b border-line/50 font-num font-bold
                                        ${r.rank <= 3 ? 'text-brand' : 'text-faint'}`}>
                          {String(r.rank).padStart(2, '0')}
                        </td>
                        <td className="px-4 py-2.5 border-b border-line/50 text-[16px] font-medium">
                          <div className="flex items-center gap-2.5">
                            <Avatar src={r.photoURL} name={r.displayName} size={32}
                                    ring={selectedRunner?.userId === r.userId} />
                            <span>
                              {r.displayName}
                              {r.offRoute && (
                                <span className="ml-2 text-[12.5px] text-purple-700 bg-purple-50 border border-purple-200
                                                 rounded-full px-2 py-0.5">หลุดเส้นทาง</span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 border-b border-line/50 font-num text-[15px] text-sub">
                          {r.bibNumber ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 border-b border-line/50 font-num text-[15px] text-sub">
                          {formatPace(r.speed)}
                        </td>
                        <td className="px-4 py-2.5 border-b border-line/50 font-num text-[15px] text-sub">
                          {formatDistance(r.distance)}
                        </td>
                        <td className="px-4 py-2.5 border-b border-line/50 text-[14px] text-faint">
                          {formatTimeAgo(r.updatedAt)}
                        </td>
                        <td className="px-4 py-2.5 border-b border-line/50 text-right">
                          <span className="inline-flex items-center gap-1.5 text-[13.5px] font-medium px-3 py-1 rounded-full"
                                style={{ color: cfg.color, backgroundColor: cfg.bgColor }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 border-b border-line/50">
                          <div className="flex gap-1.5 justify-end">
                            <button onClick={e => { e.stopPropagation(); copyLocation(r); }}
                                    title="คัดลอกตำแหน่ง (ส่งทีมงาน)"
                                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors
                                               bg-bg text-faint hover:text-brand border border-line">
                              <Icon d={IC.pin} size={15} />
                            </button>
                            <button onClick={e => {
                                      e.stopPropagation();
                                      setTrackedUserId(prev => prev === r.userId ? null : r.userId);
                                    }}
                                    title={trackedUserId === r.userId ? 'หยุดติดตาม' : 'ติดตามคนนี้'}
                                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors
                                                ${trackedUserId === r.userId
                                                  ? 'bg-brand text-white'
                                                  : 'bg-bg text-faint hover:text-brand border border-line'}`}>
                              <Icon d={IC.eye} size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modal จัดการทีมงาน ── */}
      {teamOpen && (
        <TeamModal eventCode={eventId} onClose={() => setTeamOpen(false)} />
      )}

      {/* ── Modal ประกาศฉุกเฉิน ── */}
      {broadcastOpen && (
        <BroadcastModal eventCode={eventId} srcId={srcId} runners={runners}
                        onClose={() => setBroadcastOpen(false)} />
      )}

      {/* ── Modal รายชื่อผู้ลงทะเบียน (allowlist) ── */}
      {allowOpen && (
        <AllowlistModal eventCode={eventId} onClose={() => setAllowOpen(false)} />
      )}
    </div>
  );
}

// ─── ประกาศฉุกเฉิน: พิมพ์ข้อความ → ส่ง push หานักวิ่ง (ทุกคน/เลือกเฉพาะ) ──────────
function BroadcastModal({ eventCode, srcId, runners, onClose }: {
  eventCode: string; srcId: string | null; runners: Runner[]; onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [target, setTarget]   = useState<'all' | 'selected'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [err, setErr]         = useState('');
  const [active, setActive]   = useState<{ id: string; message: string; target: string }[]>([]);
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('all');

  useEffect(() => {
    if (!srcId) return;
    const qq = query(collection(db, 'events', srcId, 'broadcasts'), where('active', '==', true));
    const unsub = onSnapshot(qq, snap => {
      setActive(snap.docs.map(d => ({ id: d.id, ...(d.data() as { message: string; target: string }) })));
    }, () => {});
    return () => unsub();
  }, [srcId]);

  const toggle = (uid: string) => setSelected(prev => {
    const n = new Set(prev); if (n.has(uid)) n.delete(uid); else n.add(uid); return n;
  });

  async function send() {
    setErr('');
    if (!message.trim()) { setErr('พิมพ์ข้อความก่อน'); return; }
    if (target === 'selected' && selected.size === 0) { setErr('เลือกผู้รับอย่างน้อย 1 คน'); return; }
    setSending(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: eventCode, message: message.trim(), target,
          userIds: target === 'selected' ? Array.from(selected) : [],
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'ส่งไม่สำเร็จ'); }
      setMessage(''); setSelected(new Set()); setTarget('all');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ส่งไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  }

  async function cancel(id: string) {
    try {
      const token = await auth.currentUser?.getIdToken();
      await fetch('/api/broadcast', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: eventCode, broadcastId: id }),
      });
    } catch { /* ignore */ }
  }

  // ── กรอง + ค้นหา ผู้รับ (สำหรับงานใหญ่ 1000+ คน) ──
  const RUNNING = ['active', 'stationary', 'no_signal'];
  const slowThreshold = (() => {
    const ds = runners.filter(r => RUNNING.includes(r.runnerStatus)).map(r => r.distance).sort((a, b) => a - b);
    if (ds.length === 0) return -1;
    return ds[Math.min(Math.floor(ds.length * 0.3), ds.length - 1)];
  })();
  const filtered = runners.filter(r => {
    if (filter === 'running' && r.runnerStatus !== 'active') return false;
    if (filter === 'stationary' && r.runnerStatus !== 'stationary') return false;
    if (filter === 'no_signal' && r.runnerStatus !== 'no_signal') return false;
    if (filter === 'finished' && r.runnerStatus !== 'finished') return false;
    if (filter === 'sos' && r.runnerStatus !== 'sos') return false;
    if (filter === 'off_route' && !r.offRoute) return false;
    if (filter === 'slow' && !(RUNNING.includes(r.runnerStatus) && r.distance <= slowThreshold)) return false;
    const q = search.trim().toLowerCase();
    if (q && !r.displayName.toLowerCase().includes(q) && !(r.bibNumber ?? '').toLowerCase().includes(q)) return false;
    return true;
  });
  const selectAllShown = () => setSelected(prev => { const n = new Set(prev); filtered.forEach(r => n.add(r.userId)); return n; });
  const CHIPS: [string, string][] = [
    ['all', 'ทั้งหมด'], ['running', 'กำลังวิ่ง'], ['stationary', 'หยุดนิ่ง'],
    ['no_signal', 'ไม่มีสัญญาณ'], ['slow', 'วิ่งช้า'], ['off_route', 'หลุดเส้นทาง'],
    ['finished', 'เข้าเส้นชัย'], ['sos', 'SOS'],
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface w-full max-w-lg rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-500 text-white flex items-center justify-center">
              <Icon d={IC.alert} size={18} />
            </div>
            <div className="text-[17px] font-semibold">ประกาศฉุกเฉิน</div>
          </div>
          <button onClick={onClose} className="p-1 text-faint hover:text-ink"><Icon d={IC.x} size={16} /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {active.length > 0 && (
            <div className="space-y-2">
              <div className="text-[13px] font-bold text-faint">กำลังประกาศอยู่</div>
              {active.map(b => (
                <div key={b.id} className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                  <div className="flex-1 text-[14px] text-ink">{b.message}
                    <span className="ml-2 text-[12px] text-faint">
                      {b.target === 'selected' ? 'เฉพาะที่เลือก' : 'ทุกคน'}
                    </span>
                  </div>
                  <button onClick={() => cancel(b.id)}
                          className="text-[13px] text-red-600 font-medium hover:underline shrink-0">ยกเลิก</button>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="text-[13px] font-bold text-faint">ข้อความ</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} maxLength={280}
                      placeholder="เช่น พายุฝนเข้า หยุดวิ่งและกลับจุดสตาร์ท"
                      className="mt-1.5 w-full rounded-xl border border-line focus:border-brand outline-none
                                 p-3 text-[15px] resize-none" />
          </div>

          <div>
            <label className="text-[13px] font-bold text-faint">ส่งหา</label>
            <div className="mt-1.5 flex gap-2">
              {([['all', 'ทุกคน'], ['selected', 'เลือกเฉพาะคน']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setTarget(v)}
                        className={`flex-1 h-10 rounded-xl border-2 text-[14.5px] font-medium transition-colors
                                    ${target === v ? 'border-brand bg-brand/5 text-brand' : 'border-line text-sub'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {target === 'selected' && (
            <div className="space-y-2">
              <input value={search} onChange={e => setSearch(e.target.value)}
                     placeholder="ค้นหาชื่อ หรือ BIB..."
                     className="w-full h-10 px-3 rounded-xl border border-line focus:border-brand outline-none text-[14.5px]" />
              <div className="flex flex-wrap gap-1.5">
                {CHIPS.map(([v, l]) => (
                  <button key={v} onClick={() => setFilter(v)}
                          className={`h-8 px-3 rounded-lg text-[13px] font-medium transition-colors
                                      ${filter === v ? 'bg-brand text-white' : 'bg-bg text-sub border border-line'}`}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-[13px]">
                <button onClick={selectAllShown} className="text-brand font-medium hover:underline">
                  เลือกทั้งหมดที่แสดง ({filtered.length})
                </button>
                <button onClick={() => setSelected(new Set())} className="text-faint hover:underline">ล้าง</button>
                <span className="ml-auto text-faint">เลือกแล้ว {selected.size} คน</span>
              </div>
              <div className="border border-line rounded-xl max-h-52 overflow-y-auto divide-y divide-line/60">
                {filtered.length === 0 && <div className="p-3 text-[14px] text-faint">ไม่พบนักวิ่ง</div>}
                {filtered.map(r => (
                  <label key={r.userId} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-bg">
                    <input type="checkbox" checked={selected.has(r.userId)} onChange={() => toggle(r.userId)}
                           className="w-4 h-4 accent-brand" />
                    <span className="text-[15px] flex-1">{r.displayName}</span>
                    {r.bibNumber && <span className="text-[13px] text-faint font-num">#{r.bibNumber}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {err && <div className="text-[13.5px] text-red-600">{err}</div>}
        </div>

        <div className="px-5 py-4 border-t border-line">
          <button onClick={send} disabled={sending}
                  className="w-full h-12 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60
                             text-white text-[16px] font-semibold flex items-center justify-center gap-2">
            <Icon d={IC.alert} size={17} /> {sending ? 'กำลังส่ง...' : 'ส่งประกาศ'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── จัดการทีมงาน: เจ้าของงานเพิ่ม/ลบ email ทีมงานเองได้ ─────────────────────
// ─── รายชื่อผู้ลงทะเบียน (allowlist): ล็อกงานให้เฉพาะคนที่ลงทะเบียนจริง (match อีเมล Google) ───
function AllowlistModal({ eventCode, onClose }: { eventCode: string; onClose: () => void }) {
  const [emails, setEmails] = useState<string[]>([]);
  const [lock,   setLock]   = useState(false);
  const [text,   setText]   = useState('');
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState('');

  async function load() {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/event-allowlist?code=${encodeURIComponent(eventCode)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setEmails(j.emails ?? []); setLock(j.registrationLock === true);
    } catch (e) { setErr(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ'); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function save() {
    if (!text.trim()) return;
    setBusy(true); setErr('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/event-allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: eventCode, text }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'บันทึกไม่สำเร็จ');
      setText(''); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function removeOne(email: string) {
    setBusy(true); setErr('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/event-allowlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: eventCode, email }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'ลบไม่สำเร็จ'); }
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'ลบไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function clearAll() {
    setBusy(true); setErr('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/event-allowlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: eventCode }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'ล้างไม่สำเร็จ'); }
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'ล้างไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface w-full max-w-lg rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand text-white flex items-center justify-center">
              <Icon d={IC.shield} size={18} />
            </div>
            <div>
              <div className="text-[17px] font-semibold">รายชื่อผู้ลงทะเบียน</div>
              <div className={`text-[12.5px] ${lock ? 'text-brand' : 'text-faint'}`}>
                {lock ? '● ล็อก: เฉพาะคนในรายชื่อสมัครได้' : '○ ยังไม่ล็อก (ใครก็สมัครได้)'}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-faint hover:text-ink text-[15px]">ปิด</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="text-[13.5px] text-sub leading-relaxed">
            วางอีเมลผู้ลงทะเบียน (จากชีตรับสมัคร) — คั่นด้วยขึ้นบรรทัด/คอมมา วางทั้งคอลัมน์ได้เลย ระบบดึงเฉพาะอีเมลให้อัตโนมัติ ·
            นักวิ่งที่อีเมล Google ตรงกับรายชื่อถึงจะกดเข้าร่วมได้
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
                    placeholder={'somchai@gmail.com\nnok@hotmail.com\n...'}
                    className="w-full border border-line rounded-xl px-3 py-2.5 text-[14px] bg-bg
                               focus:outline-none focus:ring-2 focus:ring-brand/40 resize-y font-en" />
          {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-[13.5px]">{err}</div>}
          <button onClick={save} disabled={busy || !text.trim()}
                  className="w-full h-11 rounded-xl bg-brand text-white text-[15px] font-medium disabled:opacity-50 transition-colors">
            {busy ? 'กำลังบันทึก...' : '+ เพิ่มเข้ารายชื่อ & ล็อกงาน'}
          </button>

          <div className="flex items-center justify-between pt-1">
            <div className="text-[14px] font-semibold">ในรายชื่อ {emails.length} คน</div>
            {emails.length > 0 && (
              <button onClick={clearAll} disabled={busy}
                      className="text-[13px] text-red-600 hover:text-red-700 disabled:opacity-50">
                ล้างทั้งหมด &amp; ปลดล็อก
              </button>
            )}
          </div>
          <div className="divide-y divide-line rounded-xl border border-line max-h-[35vh] overflow-y-auto">
            {emails.length === 0 ? (
              <div className="text-center text-faint py-6 text-[13.5px]">ยังไม่มีรายชื่อ</div>
            ) : emails.map(em => (
              <div key={em} className="flex items-center justify-between px-4 py-2.5 text-[13.5px]">
                <span className="truncate font-en">{em}</span>
                <button onClick={() => removeOne(em)} disabled={busy}
                        className="text-[12.5px] text-red-500 hover:text-red-700 ml-2 flex-shrink-0 disabled:opacity-50">ลบ</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamModal({ eventCode, onClose }: { eventCode: string; onClose: () => void }) {
  const [members,  setMembers]  = useState<{ email: string; role: string; addedBy?: string | null }[]>([]);
  const [role,     setRole]     = useState<'owner' | 'staff' | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');

  async function api(method: 'GET' | 'POST' | 'DELETE', body?: object) {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch(`/api/team${method === 'GET' ? `?code=${encodeURIComponent(eventCode)}` : ''}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');
    return data;
  }

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const data = await api('GET');
      setMembers(data.members ?? []);
      setRole(data.callerRole ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [eventCode]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await api('POST', { code: eventCode, email: newEmail.trim() });
      setNewEmail('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'เพิ่มไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(email: string) {
    if (!confirm(`ลบ ${email} ออกจากทีมงาน?`)) return;
    setBusy(true);
    setErr('');
    try {
      await api('DELETE', { code: eventCode, email });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ลบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-float max-w-md w-full p-6 max-h-[80vh] flex flex-col"
           onClick={e => e.stopPropagation()}>
        <h2 className="text-[18px] font-semibold">ทีมงานของงานนี้</h2>
        <p className="text-[14px] text-sub mt-1">
          ทีมงาน login ด้วย Google (email ที่เพิ่มไว้) แล้วเห็นงานนี้ได้เลย ไม่ต้องใช้รหัสผ่าน
        </p>

        {err && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-[14px]">
            {err}
          </div>
        )}

        <div className="mt-4 flex-1 overflow-y-auto divide-y divide-line/60">
          {loading ? (
            <p className="text-center text-faint py-6 text-[15px]">กำลังโหลด...</p>
          ) : members.length === 0 ? (
            <p className="text-center text-faint py-6 text-[15px]">
              ยังไม่มีทีมงาน — เพิ่ม email ด้านล่างได้เลย
            </p>
          ) : members.map(m => (
            <div key={m.email} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium truncate font-en">{m.email}</div>
                <div className="text-[13px] text-faint">
                  {m.role === 'owner' ? '👑 เจ้าของงาน' : 'ทีมงาน'}
                </div>
              </div>
              {role === 'owner' && m.role !== 'owner' && (
                <button onClick={() => removeMember(m.email)} disabled={busy}
                        className="text-[13.5px] text-faint hover:text-red-600 px-2 py-1 transition-colors">
                  ลบ
                </button>
              )}
            </div>
          ))}
        </div>

        {role === 'owner' && (
          <form onSubmit={addMember} className="mt-4 flex gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="email@gmail.com ของทีมงาน"
              className="flex-1 h-11 bg-bg border border-line rounded-xl px-4 text-[15px]
                         focus:outline-none focus:border-brand transition-colors"
            />
            <button type="submit" disabled={busy || !newEmail.trim()}
                    className="h-11 px-5 rounded-xl bg-brand hover:bg-brand-dk text-white text-[15px]
                               font-medium shadow-brand transition-colors disabled:opacity-50">
              เพิ่ม
            </button>
          </form>
        )}

        <button onClick={onClose} className="w-full mt-3 text-[14px] text-faint hover:text-ink py-2">
          ปิด
        </button>
      </div>
    </div>
  );
}
