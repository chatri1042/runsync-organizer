'use client';

import { useEffect, useRef } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MarkerClusterer, SuperClusterAlgorithm } from '@googlemaps/markerclusterer';
import { Runner, STATUS_CONFIG } from '@/lib/types';

// ─── GPX Parser ───────────────────────────────────────────────────────────────
function parseGPX(text: string): google.maps.LatLngLiteral[] {
  const parser = new DOMParser();
  const xml    = parser.parseFromString(text, 'application/xml');
  const points: google.maps.LatLngLiteral[] = [];
  const nodes  = xml.querySelectorAll('trkpt, rtept, wpt');
  nodes.forEach(node => {
    const lat = parseFloat(node.getAttribute('lat') ?? '');
    const lng = parseFloat(node.getAttribute('lon') ?? '');
    if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng });
  });
  return points;
}

// ─── KML Parser ───────────────────────────────────────────────────────────────
function parseKML(text: string): google.maps.LatLngLiteral[] {
  const parser = new DOMParser();
  const xml    = parser.parseFromString(text, 'application/xml');
  const points: google.maps.LatLngLiteral[] = [];
  xml.querySelectorAll('coordinates').forEach(node => {
    node.textContent?.trim().split(/\s+/).forEach(coord => {
      const [lngStr, latStr] = coord.split(',');
      const lat = parseFloat(latStr);
      const lng = parseFloat(lngStr);
      if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng });
    });
  });
  return points;
}

export { parseGPX, parseKML };

// ─── GPX Route Polyline ───────────────────────────────────────────────────────
function GpxRoute({ points }: { points: google.maps.LatLngLiteral[] }) {
  const map     = useMap();
  const mapsLib = useMapsLibrary('maps');

  useEffect(() => {
    if (!map || !mapsLib || points.length === 0) return;

    // เส้น glow ด้านหลัง
    const glowLine = new mapsLib.Polyline({
      map,
      path:          points,
      strokeColor:   '#A855F7',
      strokeOpacity: 0.25,
      strokeWeight:  10,
    });

    // เส้นหลัก solid สีม่วง
    const mainLine = new mapsLib.Polyline({
      map,
      path:          points,
      strokeColor:   '#A855F7',
      strokeOpacity: 0.9,
      strokeWeight:  4,
    });

    const bounds = new google.maps.LatLngBounds();
    points.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, 60);

    return () => { glowLine.setMap(null); mainLine.setMap(null); };
  }, [map, mapsLib, points]);

  return null;
}

// ─── Leader trail (เส้นทางของผู้นำ สีส้มเหมือนในแอป) ─────────────────────────
// หมายเหตุ: Firestore เก็บเฉพาะตำแหน่งล่าสุด เส้นนี้จึงสะสมจากตอนเปิด dashboard เป็นต้นไป
function LeaderTrail({ points }: { points: google.maps.LatLngLiteral[] }) {
  const map     = useMap();
  const mapsLib = useMapsLibrary('maps');

  useEffect(() => {
    if (!map || !mapsLib || points.length < 2) return;
    const glow = new mapsLib.Polyline({
      map, path: points, strokeColor: '#F1642E', strokeOpacity: 0.25, strokeWeight: 10,
    });
    const main = new mapsLib.Polyline({
      map, path: points, strokeColor: '#F1642E', strokeOpacity: 0.95, strokeWeight: 4,
    });
    return () => { glow.setMap(null); main.setMap(null); };
  }, [map, mapsLib, points]);

  return null;
}

// ─── SVG icons (data URI) สำหรับ google.maps.Marker ──────────────────────────
function dotIconSvg(color: string, r = 8): string {
  const s = r * 2 + 6;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">
    <circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="${color}" stroke="white" stroke-width="2.5"/></svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function clusterIconSvg(d: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">
    <circle cx="${d / 2}" cy="${d / 2}" r="${d / 2 - 3}" fill="rgba(241,100,46,0.92)" stroke="white" stroke-width="3"/></svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// ─── Clustered runner markers ────────────────────────────────────────────────
// นักวิ่งปกติ (กำลังวิ่ง/เข้าเส้นชัย และไม่หลุดเส้นทาง) รวมเป็นก้อนตัวเลข
// คนที่ต้องสนใจ (SOS/หยุดนิ่ง/สัญญาณหาย/หลุดเส้นทาง) ไม่ถูก cluster — ดู AlertMarkers
function ClusteredRunnerMarkers({ runners, onRunnerClick }: {
  runners: Runner[]; onRunnerClick: (r: Runner) => void;
}) {
  const map = useMap();
  const clustererRef = useRef<MarkerClusterer | null>(null);

  useEffect(() => {
    if (!map) return;
    if (!clustererRef.current) {
      clustererRef.current = new MarkerClusterer({
        map,
        algorithm: new SuperClusterAlgorithm({ radius: 80, maxZoom: 16 }),
        renderer: {
          render: ({ count, position }) => {
            const d = count < 25 ? 36 : count < 120 ? 46 : 58;
            return new google.maps.Marker({
              position,
              zIndex: 200,
              icon: { url: clusterIconSvg(d), scaledSize: new google.maps.Size(d, d), anchor: new google.maps.Point(d / 2, d / 2) },
              label: { text: String(count), color: '#fff', fontWeight: '700',
                       fontSize: count < 120 ? '13px' : '15px', fontFamily: 'Inter, sans-serif' },
            });
          },
        },
      });
    }

    // เฉพาะคนกำลังวิ่ง (จุดส้ม) — finished ไม่ขึ้นแผนที่แล้ว (ความเป็นส่วนตัวหลังจบ)
    const markers = runners
      .filter(r => r.runnerStatus === 'active' && !r.offRoute && r.lat !== 0)
      .map(r => {
        const color = STATUS_CONFIG.active.color;
        const m = new google.maps.Marker({
          position: { lat: r.lat, lng: r.lng },
          icon: { url: dotIconSvg(color), scaledSize: new google.maps.Size(22, 22), anchor: new google.maps.Point(11, 11) },
          title: `${r.displayName}${r.bibNumber ? ' · ' + r.bibNumber : ''}`,
        });
        m.addListener('click', () => onRunnerClick(r));
        return m;
      });

    clustererRef.current.clearMarkers();
    clustererRef.current.addMarkers(markers);

    return () => { clustererRef.current?.clearMarkers(); };
  }, [map, runners, onRunnerClick]);

  // cleanup ตอน unmount
  useEffect(() => () => { clustererRef.current?.setMap(null); clustererRef.current = null; }, []);

  return null;
}

// ─── Leader Marker ────────────────────────────────────────────────────────────
function LeaderMarker({ runners }: { runners: Runner[] }) {
  const leader = runners.find(r => r.rank === 1 && r.runnerStatus === 'active' && r.lat !== 0);
  if (!leader) return null;

  return (
    <AdvancedMarker position={{ lat: leader.lat, lng: leader.lng }} zIndex={300}>
      <div className="relative flex flex-col items-center">
        <div className="absolute w-10 h-10 rounded-full bg-brand opacity-20 animate-ping" />
        <div className="relative w-9 h-9 rounded-full bg-brand border-2 border-white
                        flex items-center justify-center shadow-xl">
          <span className="text-base">🥇</span>
        </div>
        <div className="mt-1 bg-brand text-white text-xs font-bold
                        px-2 py-0.5 rounded-full whitespace-nowrap shadow">
          {leader.displayName.split(' ')[0]}
        </div>
      </div>
    </AdvancedMarker>
  );
}

// ─── Alert Markers (ไม่ถูก cluster) ──────────────────────────────────────────
function AlertMarkers({ runners, onRunnerClick }: {
  runners: Runner[]; onRunnerClick: (r: Runner) => void;
}) {
  const alerts = runners.filter(r =>
    r.lat !== 0 && (
      r.runnerStatus === 'sos' ||
      r.runnerStatus === 'stationary' ||
      r.runnerStatus === 'no_signal' ||
      (r.offRoute && r.runnerStatus === 'active')
    ));
  return (
    <>
      {alerts.map(runner => (
        <AdvancedMarker
          key={runner.userId}
          position={{ lat: runner.lat, lng: runner.lng }}
          onClick={() => onRunnerClick(runner)}
          zIndex={runner.runnerStatus === 'sos' ? 999 : 100}
        >
          <MarkerPin runner={runner} />
        </AdvancedMarker>
      ))}
    </>
  );
}

function MarkerPin({ runner }: { runner: Runner }) {
  if (runner.runnerStatus === 'sos') {
    return (
      <div className="sos-pulse relative flex items-center justify-center">
        <div className="absolute w-10 h-10 rounded-full bg-red-600 opacity-30" />
        <div className="relative w-8 h-8 rounded-full bg-red-600 border-2 border-white
                        flex items-center justify-center shadow-lg">
          <span className="text-white text-[11px] font-black">SOS</span>
        </div>
      </div>
    );
  }
  // หลุดเส้นทาง (ยังวิ่งอยู่แต่ห่างเส้น GPX เกินกำหนด)
  if (runner.offRoute && runner.runnerStatus === 'active') {
    return (
      <div className="w-5 h-5 rounded-full border-2 border-purple-500 bg-purple-100
                      flex items-center justify-center shadow" title={`${runner.displayName} · หลุดเส้นทาง`}>
        <span className="text-[9px] text-purple-700 font-bold">?</span>
      </div>
    );
  }
  if (runner.runnerStatus === 'stationary') {
    return (
      <div className="w-6 h-6 rounded-full border-2 border-white bg-yellow-500
                      flex items-center justify-center shadow-md" title={runner.displayName}>
        <span className="text-[10px] text-black font-bold">!</span>
      </div>
    );
  }
  return <div className="w-5 h-5 rounded-full border-2 border-white bg-gray-600 shadow-md"
              title={runner.displayName} />;
}

// ─── Tracked / Selected ───────────────────────────────────────────────────────
function TrackedFollow({ runners, trackedUserId }: { runners: Runner[]; trackedUserId: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !trackedUserId) return;
    const r = runners.find(r => r.userId === trackedUserId);
    if (r && r.lat !== 0) map.panTo({ lat: r.lat, lng: r.lng });
  }, [map, trackedUserId, runners]);
  return null;
}

function SelectedHighlight({ runners, selectedRunner }: {
  runners: Runner[]; selectedRunner: Runner | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || !selectedRunner) return;
    const r = runners.find(r => r.userId === selectedRunner.userId);
    if (r && r.lat !== 0) { map.panTo({ lat: r.lat, lng: r.lng }); map.setZoom(16); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedRunner?.userId]);

  // finished = ไม่โชว์ตำแหน่งบนแผนที่แล้ว (ความเป็นส่วนตัว)
  if (!selectedRunner || selectedRunner.lat === 0 || selectedRunner.runnerStatus === 'finished') return null;
  const isSos = selectedRunner.runnerStatus === 'sos';
  return (
    <AdvancedMarker position={{ lat: selectedRunner.lat, lng: selectedRunner.lng }} zIndex={1000}>
      <div className="relative">
        {/* วงแหวนไฮไลต์ ตรงตำแหน่งจริงของนักวิ่ง */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                        w-14 h-14 rounded-full border-2 border-brand opacity-60 animate-ping" />
        {/* จุดไฮไลต์สีส้มตรงตำแหน่งจริง — ให้เด่นกว่าหมุดดำอื่น (SOS มีวงแดงอยู่แล้ว) */}
        {!isSos && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                          w-5 h-5 rounded-full bg-brand border-2 border-white shadow-lg" />
        )}
        {/* ป้ายชื่อ — ยกขึ้นเหนือหมุด + หางสามเหลี่ยมชี้ลง ไม่ให้วง SOS บังชื่อ */}
        <div className="absolute left-1/2 -translate-x-1/2 -translate-y-[66px]
                        flex flex-col items-center">
          <div className="bg-white text-ink text-sm font-bold px-3 py-1.5 rounded-full
                          shadow-xl whitespace-nowrap border-2 border-brand">
            📍 {selectedRunner.displayName}
          </div>
          <div className="w-0 h-0 -mt-px border-l-[6px] border-r-[6px] border-t-[7px]
                          border-l-transparent border-r-transparent border-t-brand" />
        </div>
      </div>
    </AdvancedMarker>
  );
}

// ─── Main Map Component ───────────────────────────────────────────────────────
interface OrganizerMapProps {
  runners:        Runner[];
  trackedUserId:  string | null;
  selectedRunner: Runner | null;
  gpxPoints:      google.maps.LatLngLiteral[];
  leaderTrail:    google.maps.LatLngLiteral[];
  showLegend:     boolean;
  onRunnerClick:  (r: Runner) => void;
  centerLat?:     number;
  centerLng?:     number;
}

export default function OrganizerMap({
  runners, trackedUserId, selectedRunner, gpxPoints, leaderTrail, showLegend, onRunnerClick,
  centerLat = 13.7563, centerLng = 100.5018,
}: OrganizerMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

  return (
    <APIProvider apiKey={apiKey} libraries={['maps', 'marker']}>
      <div className="absolute inset-0">
        <Map
          mapId="39cc42d9824655864cbd9c34"
          defaultCenter={{ lat: centerLat, lng: centerLng }}
          defaultZoom={13}
          disableDefaultUI
          gestureHandling="greedy"
          className="w-full h-full"
        >
          {gpxPoints.length > 0 && <GpxRoute points={gpxPoints} />}
          {leaderTrail.length >= 2 && <LeaderTrail points={leaderTrail} />}
          <ClusteredRunnerMarkers runners={runners} onRunnerClick={onRunnerClick} />
          <LeaderMarker runners={runners} />
          <AlertMarkers runners={runners} onRunnerClick={onRunnerClick} />
          <TrackedFollow runners={runners} trackedUserId={trackedUserId} />
          <SelectedHighlight runners={runners} selectedRunner={selectedRunner} />
        </Map>

        {/* Legend — ซ่อนได้ด้วยโหมดคลีน / z ต่ำกว่าแผงตารางล่าง (z-20) */}
        {showLegend && (
          <div className="absolute bottom-20 left-4 bg-white/95 backdrop-blur border border-line
                          rounded-2xl p-3.5 space-y-2 shadow-soft z-10">
            <p className="text-[13px] text-faint font-semibold uppercase tracking-wide mb-1">สัญลักษณ์</p>
            {(['sos', 'stationary', 'no_signal', 'active'] as const).map(s => (
              <div key={s} className="flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: STATUS_CONFIG[s].color }} />
                <span className="text-[14px] text-sub">{STATUS_CONFIG[s].label}</span>
              </div>
            ))}
            <div className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-full border-2 border-purple-500 bg-purple-100" />
              <span className="text-[14px] text-sub">หลุดเส้นทาง</span>
            </div>
            <div className="flex items-center gap-2.5 pt-1.5 border-t border-line">
              <div className="w-7 border-t-2 border-solid border-purple-500" />
              <span className="text-[14px] text-sub">เส้นทาง GPX/KML</span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-7 border-t-2 border-solid border-brand" />
              <span className="text-[14px] text-sub">เส้นทางผู้นำ 🥇</span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full bg-brand/90 border-2 border-white shadow
                              flex items-center justify-center text-white text-[9px] font-bold">n</div>
              <span className="text-[14px] text-sub">กลุ่มนักวิ่ง (ซูมเพื่อแตก)</span>
            </div>
            <p className="text-[13px] text-faint pt-1.5 border-t border-line">เข้าเส้นชัยแล้วไม่แสดงบนแผนที่</p>
          </div>
        )}
      </div>
    </APIProvider>
  );
}
