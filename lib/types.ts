export type RunnerStatus = 'active' | 'stationary' | 'no_signal' | 'sos';

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
}

export interface EventStats {
  total: number;
  active: number;
  stationary: number;
  noSignal: number;
  sos: number;
}

export interface OrganizerEvent {
  eventId: string;
  eventName: string;
  password: string;
  isActive: boolean;
  startTime?: Date;
  endTime?: Date;
  totalDistance?: number; // race distance in km
}

// Compute status from raw data
export function computeRunnerStatus(
  rawStatus: string,
  updatedAt: Date,
  now: Date = new Date()
): RunnerStatus {
  if (rawStatus === 'sos') return 'sos';
  const minutesAgo = (now.getTime() - updatedAt.getTime()) / 60000;
  if (minutesAgo > 15) return 'no_signal';
  if (minutesAgo > 10) return 'stationary';
  return 'active';
}

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
  sos:        { label: 'SOS',        color: '#EF4444', bgColor: '#2D1515', dotColor: 'bg-red-500',    priority: 0 },
  stationary: { label: 'หยุดนิ่ง',  color: '#F59E0B', bgColor: '#2D2510', dotColor: 'bg-yellow-500', priority: 1 },
  no_signal:  { label: 'ไม่มีสัญญาณ', color: '#6B7280', bgColor: '#1E2028', dotColor: 'bg-gray-500',   priority: 2 },
  active:     { label: 'กำลังวิ่ง', color: '#22C55E', bgColor: '#152218', dotColor: 'bg-green-500',   priority: 3 },
};
