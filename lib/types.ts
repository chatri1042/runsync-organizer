export type RunnerStatus = 'active' | 'stationary' | 'no_signal' | 'sos' | 'finished';

export interface Runner {
  userId: string;
  displayName: string;
  photoURL?: string;
  lat: number;
  lng: number;
  distance: number;   // meters
  speed: number;      // m/s
  heading: number;
  status: string;     // raw status from app
  teamId?: string;
  bibNumber?: string;
  updatedAt: Date;
  runnerStatus: RunnerStatus;  // computed
  rank: number;       // 1 = leader (by distance)
  offRoute?: boolean; // computed: ห่างจากเส้น GPX เกิน threshold (เฉพาะตอนมี route)
}

// ผู้สมัคร event จาก collection `event_participants` (flat, filter ด้วย eventId)
// หมายเหตุ: schema ไม่คงที่ — บางจุดเขียน userName/userPhotoUrl บางจุดเขียน displayName/photoURL
export interface Participant {
  userId: string;
  displayName: string;
  photoURL?: string;
  role?: string;      // 'runner' | 'spectator'
  teamName?: string;
}

export interface EventStats {
  total: number;
  active: number;
  stationary: number;
  noSignal: number;
  sos: number;
  finished: number;
  offRoute: number;
  notStarted: number;
}

export interface OrganizerEvent {
  eventId: string;
  realEventId?: string; // doc id จริงใน events/ (กรณี Event Code เป็นชื่อจำง่ายที่ตั้งจาก admin)
  eventName: string;
  password?: string; // ไม่อ่านจาก client แล้ว — ตรวจฝั่ง server เท่านั้น
  isActive: boolean;
  startTime?: Date;       // club: liveStartedAt (เวลาที่กด Start Run)
  endTime?: Date;
  isLive?: boolean;       // club: liveRunActive — งานเริ่มวิ่งจริงแล้วหรือยัง
  totalDistance?: number; // race distance in km
}

// Compute status from raw data
export function computeRunnerStatus(
  rawStatus: string,
  updatedAt: Date,
  now: Date = new Date(),
  distanceMeters = 0,
  totalDistanceKm?: number,
): RunnerStatus {
  if (rawStatus === 'sos') return 'sos';
  // เข้าเส้นชัย: แอปส่ง status 'finished' หรือระยะถึง totalDistance ของงาน
  // ต้องเช็คก่อน no_signal — คนวิ่งจบแล้วหยุดส่งพิกัดเป็นเรื่องปกติ
  if (rawStatus === 'finished') return 'finished';
  if (totalDistanceKm && totalDistanceKm > 0 && distanceMeters >= totalDistanceKm * 1000) return 'finished';
  const minutesAgo = (now.getTime() - updatedAt.getTime()) / 60000;
  if (minutesAgo > 15) return 'no_signal';
  if (minutesAgo > 10) return 'stationary';
  return 'active';
}

// ── Off-route detection ────────────────────────────────────────────────────────
// ระยะ (เมตร) จากจุดหนึ่งไปยัง segment ที่ใกล้ที่สุดของเส้นทาง (equirectangular approx
// เพียงพอสำหรับระดับร้อยเมตร) — ใช้เช็คว่านักวิ่งหลุดเส้น GPX หรือยัง
const M_PER_DEG_LAT = 111_320;

export function distanceToRouteMeters(
  lat: number, lng: number,
  route: { lat: number; lng: number }[],
): number {
  if (route.length < 2) return Infinity;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const px = lng * mPerDegLng;
  const py = lat * M_PER_DEG_LAT;
  let best = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const ax = route[i].lng * mPerDegLng,     ay = route[i].lat * M_PER_DEG_LAT;
    const bx = route[i + 1].lng * mPerDegLng, by = route[i + 1].lat * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const cx = ax + t * dx, cy = ay + t * dy;
    best = Math.min(best, Math.hypot(px - cx, py - cy));
  }
  return best;
}

export const OFF_ROUTE_THRESHOLD_M = 100;

// Format distance
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

// Format pace (min/km) from speed (m/s)
export function formatPace(speedMs: number): string {
  if (speedMs <= 0) return '--:--';
  const secPerKm = 1000 / speedMs;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

// Format time ago
export function formatTimeAgo(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'เมื่อกี้';
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ชม. ${minutes % 60} นาทีที่แล้ว`;
}

export const STATUS_CONFIG: Record<RunnerStatus, {
  label: string;
  color: string;
  bgColor: string;
  dotColor: string;
  priority: number;
}> = {
  // active = สีส้มแบรนด์ ให้เด่นบนแผนที่โทนอ่อน (เข้าชุดกับ cluster)
  sos:        { label: 'SOS',          color: '#DC2626', bgColor: '#FEE2E2', dotColor: 'bg-red-600',    priority: 0 },
  stationary: { label: 'หยุดนิ่ง',    color: '#CA8A04', bgColor: '#FEF9C3', dotColor: 'bg-yellow-600', priority: 1 },
  no_signal:  { label: 'ไม่มีสัญญาณ',  color: '#4B5563', bgColor: '#F3F4F6', dotColor: 'bg-gray-600',   priority: 2 },
  active:     { label: 'กำลังวิ่ง',   color: '#F1642E', bgColor: '#FFEDD5', dotColor: 'bg-brand',      priority: 3 },
  finished:   { label: 'เข้าเส้นชัย', color: '#2563EB', bgColor: '#DBEAFE', dotColor: 'bg-blue-600',   priority: 4 },
};

// ข้อความ share location — คัดลอกส่ง LINE ทีมงาน/กู้ภัยได้ทันที
// มีทั้งลิงก์นำทาง (กดแล้วเข้าโหมดนำทาง Google Maps เลย) และพิกัดดิบ
// (เผื่อเน็ตอ่อนเปิดลิงก์ไม่ขึ้น จิ้มใส่แอป GPS offline หรือแจ้งวิทยุได้)
export function buildLocationMessage(r: Runner): string {
  const icon = r.runnerStatus === 'sos' ? '🚨' : '📍';
  const label = STATUS_CONFIG[r.runnerStatus].label;
  return [
    `${icon} ${label}: ${r.displayName}${r.bibNumber ? ` (${r.bibNumber})` : ''}`,
    `ระยะ ${formatDistance(r.distance)} · อัพเดตล่าสุด ${formatTimeAgo(r.updatedAt)}${r.offRoute ? ' · ⚠️ หลุดเส้นทาง' : ''}`,
    `พิกัด: ${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`,
    `นำทาง: https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`,
  ].join('\n');
}

// CSV export (มี BOM ให้เปิดใน Excel ภาษาไทยได้)
export function buildCsv(runners: Runner[], notStarted: Participant[]): string {
  const head = ['อันดับ', 'ชื่อ', 'BIB', 'ระยะทาง (km)', 'เพซ (นาที/กม.)', 'สถานะ', 'นอกเส้นทาง', 'อัพเดทล่าสุด'];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = runners.map(r => [
    String(r.rank),
    esc(r.displayName),
    esc(r.bibNumber ?? ''),
    (r.distance / 1000).toFixed(2),
    formatPace(r.speed),
    STATUS_CONFIG[r.runnerStatus].label,
    r.offRoute ? 'ใช่' : '',
    r.updatedAt.toISOString(),
  ].join(','));
  const nsRows = notStarted.map(p => [
    '', esc(p.displayName), '', '', '', 'ยังไม่เริ่มวิ่ง', '', '',
  ].join(','));
  return '\uFEFF' + [head.join(','), ...rows, ...nsRows].join('\n');
}
