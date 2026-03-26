'use client';

import { useEffect, useRef } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
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
      strokeColor:   '#4CAF50',
      strokeOpacity: 0.15,
      strokeWeight:  12,
    });

    // เส้นหลัก dotted สีเขียวเหมือนแอป
    const mainLine = new mapsLib.Polyline({
      map,
      path:          points,
      strokeOpacity: 0,
      strokeWeight:  4,
      icons: [{
        icon: {
          path:          'M 0,-1 0,1',
          strokeOpacity: 1,
          scale:         4,
          strokeColor:   '#4CAF50',
          strokeWeight:  3,
        },
        offset: '0',
        repeat: '16px',
      }],
    });

    const bounds = new google.maps.LatLngBounds();
    points.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, 60);

    return () => { glowLine.setMap(null); mainLine.setMap(null); };
  }, [map, mapsLib, points]);

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
        <div className="mt-1 bg-brand text-white text-[9px] font-bold
                        px-2 py-0.5 rounded-full whitespace-nowrap shadow">
          {leader.displayName.split(' ')[0]}
        </div>
      </div>
    </AdvancedMarker>
  );
}

// ─── Heatmap Layer ───────────────────────────────────────────────────────────
function HeatmapLayer({ runners }: { runners: Runner[] }) {
  const map           = useMap();
  const visualization = useMapsLibrary('visualization');
  const heatmapRef    = useRef<google.maps.visualization.HeatmapLayer | null>(null);

  useEffect(() => {
    if (!map || !visualization) return;
    const points = runners
      .filter(r => r.runnerStatus === 'active' && r.lat !== 0)
      .map(r => ({ location: new google.maps.LatLng(r.lat, r.lng), weight: 1 }));
    if (!heatmapRef.current) {
      heatmapRef.current = new visualization.HeatmapLayer({
        map, data: points, radius: 30, opacity: 0.75,
        gradient: [
          'rgba(0,255,255,0)', 'rgba(0,255,255,1)', 'rgba(0,191,255,1)',
          'rgba(0,127,255,1)', 'rgba(0,63,255,1)',  'rgba(0,0,255,1)',
          'rgba(255,0,0,1)',   'rgba(255,128,0,1)', 'rgba(255,255,0,1)',
          'rgba(255,255,255,1)',
        ],
      });
    } else {
      heatmapRef.current.setData(points);
    }
    return () => { heatmapRef.current?.setMap(null); heatmapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, visualization]);

  useEffect(() => {
    if (!heatmapRef.current || !window.google) return;
    const points = runners
      .filter(r => r.runnerStatus === 'active' && r.lat !== 0)
      .map(r => ({ location: new google.maps.LatLng(r.lat, r.lng), weight: 1 }));
    heatmapRef.current.setData(points);
  }, [runners]);

  return null;
}

// ─── Alert Markers ────────────────────────────────────────────────────────────
function AlertMarkers({ runners, onRunnerClick }: {
  runners: Runner[]; onRunnerClick: (r: Runner) => void;
}) {
  return (
    <>
      {runners.filter(r => r.runnerStatus !== 'active' && r.lat !== 0).map(runner => (
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
        <div className="absolute w-10 h-10 rounded-full bg-red-500 opacity-30" />
        <div className="relative w-7 h-7 rounded-full bg-red-500 border-2 border-white
                        flex items-center justify-center shadow-lg">
          <span className="text-white text-[9px] font-black">SOS</span>
        </div>
      </div>
    );
  }
  if (runner.runnerStatus === 'stationary') {
    return (
      <div className="w-5 h-5 rounded-full border-2 border-yellow-400 bg-yellow-500/80
                      flex items-center justify-center shadow" title={runner.displayName}>
        <span className="text-[8px] text-black font-bold">!</span>
      </div>
    );
  }
  return <div className="w-4 h-4 rounded-full border border-gray-500 bg-gray-600/80 shadow" />;
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

  if (!selectedRunner || selectedRunner.lat === 0) return null;
  return (
    <AdvancedMarker position={{ lat: selectedRunner.lat, lng: selectedRunner.lng }} zIndex={500}>
      <div className="relative flex items-center justify-center">
        <div className="absolute w-14 h-14 rounded-full border-2 border-white opacity-60 animate-ping" />
        <div className="relative bg-white text-black text-xs font-bold
                        px-2.5 py-1.5 rounded-full shadow-xl whitespace-nowrap border-2 border-brand">
          📍 {selectedRunner.displayName}
        </div>
      </div>
    </AdvancedMarker>
  );
}

// ─── GPX Upload Button ────────────────────────────────────────────────────────
function GpxUploadButton({ onLoad, hasRoute, onClear }: {
  onLoad:   (pts: google.maps.LatLngLiteral[]) => void;
  hasRoute: boolean;
  onClear:  () => void;
}) {
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const pts = parseGPX(ev.target?.result as string);
      if (pts.length > 0) onLoad(pts);
      else alert('ไม่พบข้อมูลพิกัดใน GPX file');
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div className="flex items-center gap-2">
      <label className={`cursor-pointer flex items-center gap-1.5 px-3 py-2 rounded-xl
                         text-xs font-medium transition-all border shadow-lg backdrop-blur
                         ${hasRoute
                           ? 'bg-green-900/60 border-green-500 text-green-300'
                           : 'bg-surface/90 border-border text-gray-300 hover:border-brand hover:text-brand'}`}>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        {hasRoute ? `✓ GPX โหลดแล้ว (${(0).toLocaleString()} จุด)` : 'อัพโหลด GPX Route'}
        <input type="file" accept=".gpx" className="hidden" onChange={handleFile} />
      </label>
      {hasRoute && (
        <button onClick={onClear}
                className="bg-surface/90 border border-border backdrop-blur
                           text-[11px] text-gray-400 hover:text-red-400
                           px-2 py-2 rounded-xl transition-colors shadow-lg">
          ✕
        </button>
      )}
    </div>
  );
}

// ─── Main Map Component ───────────────────────────────────────────────────────
interface OrganizerMapProps {
  runners:        Runner[];
  trackedUserId:  string | null;
  selectedRunner: Runner | null;
  gpxPoints:      google.maps.LatLngLiteral[];
  onRunnerClick:  (r: Runner) => void;
  centerLat?:     number;
  centerLng?:     number;
}

export default function OrganizerMap({
  runners, trackedUserId, selectedRunner, gpxPoints, onRunnerClick,
  centerLat = 13.7563, centerLng = 100.5018,
}: OrganizerMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

  return (
    <APIProvider apiKey={apiKey} libraries={['visualization', 'maps']}>
      <div className="flex-1 relative">
        <Map
          mapId="runsync-organizer-map"
          defaultCenter={{ lat: centerLat, lng: centerLng }}
          defaultZoom={13}
          disableDefaultUI
          gestureHandling="greedy"
          className="w-full h-full"
          colorScheme="DARK"
          styles={[
            { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
            { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
          ]}
        >
          {gpxPoints.length > 0 && <GpxRoute points={gpxPoints} />}
          <LeaderMarker runners={runners} />
          <HeatmapLayer runners={runners} />
          <AlertMarkers runners={runners} onRunnerClick={onRunnerClick} />
          <TrackedFollow runners={runners} trackedUserId={trackedUserId} />
          <SelectedHighlight runners={runners} selectedRunner={selectedRunner} />
        </Map>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-surface/90 backdrop-blur border border-border
                        rounded-xl p-3 space-y-2">
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Legend</p>
          {(['sos', 'stationary', 'no_signal', 'active'] as const).map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_CONFIG[s].color }} />
              <span className="text-xs text-gray-300">{STATUS_CONFIG[s].label}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1 border-t border-border">
            <div className="w-8 border-t-2 border-dashed border-green-500" />
            <span className="text-xs text-gray-300">เส้นทางวิ่ง GPX</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-brand" />
            <span className="text-xs text-gray-300">ผู้นำ 🥇</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-2 rounded"
                 style={{ background: 'linear-gradient(to right, rgba(0,255,255,0.3), #ff0000)' }} />
            <span className="text-xs text-gray-300">Heatmap</span>
          </div>
        </div>
      </div>
    </APIProvider>
  );
}
