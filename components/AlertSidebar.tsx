'use client';

import { useState, useMemo } from 'react';
import {
  Runner,
  EventStats,
  RunnerStatus,
  STATUS_CONFIG,
  formatDistance,
  formatPace,
  formatTimeAgo,
} from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────
type FilterMode = 'all' | 'sos' | 'stationary' | 'no_signal' | 'top20' | 'bottom20';

interface AlertSidebarProps {
  runners:        Runner[];
  stats:          EventStats;
  selectedRunner: Runner | null;
  trackedUserId:  string | null;
  onSelectRunner: (r: Runner | null) => void;
  onTrackRunner:  (id: string | null) => void;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  label, value, color, pulse, onClick, active,
}: {
  label: string; value: number; color: string;
  pulse?: boolean; onClick: () => void; active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-xl px-3 py-2.5 text-center transition-all border
                  ${active ? 'border-current' : 'border-transparent hover:border-border'}`}
      style={{ backgroundColor: active ? `${color}20` : '#1A1D27', color }}
    >
      <div className={`text-xl font-bold tabular-nums ${pulse && value > 0 ? 'sos-pulse' : ''}`}>
        {value}
      </div>
      <div className="text-[10px] opacity-70 mt-0.5">{label}</div>
    </button>
  );
}

// ─── Runner Row ───────────────────────────────────────────────────────────────
function RunnerRow({
  runner, rank, isSelected, isTracked, onSelect, onTrack,
}: {
  runner: Runner; rank?: number;
  isSelected: boolean; isTracked: boolean;
  onSelect: () => void; onTrack: () => void;
}) {
  const cfg = STATUS_CONFIG[runner.runnerStatus];

  return (
    <div
      onClick={onSelect}
      className={`px-3 py-2.5 rounded-xl cursor-pointer transition-all border
                  ${isSelected ? 'border-brand bg-brand/10' : 'border-transparent hover:bg-surface'}`}
    >
      <div className="flex items-center gap-2.5">
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full shrink-0 ${runner.runnerStatus === 'sos' ? 'sos-pulse' : ''}`}
             style={{ backgroundColor: cfg.color }} />

        {/* Rank */}
        {rank !== undefined && (
          <span className="text-[10px] text-gray-500 w-5 shrink-0 tabular-nums">#{rank}</span>
        )}

        {/* Name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-white truncate">{runner.displayName}</span>
            {runner.bibNumber && (
              <span className="text-[10px] text-gray-500 shrink-0">{runner.bibNumber}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px]" style={{ color: cfg.color }}>{cfg.label}</span>
            <span className="text-[11px] text-gray-500">·</span>
            <span className="text-[11px] text-gray-500">{formatDistance(runner.distance)}</span>
          </div>
        </div>

        {/* Track button */}
        <button
          onClick={e => { e.stopPropagation(); onTrack(); }}
          className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all
                      ${isTracked ? 'bg-brand text-white' : 'bg-border text-gray-400 hover:bg-brand/30'}`}
          title={isTracked ? 'หยุด track' : 'Track คนนี้'}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7
                 -1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>
      </div>

      {/* Expanded detail when selected */}
      {isSelected && (
        <div className="mt-2.5 pt-2.5 border-t border-border grid grid-cols-3 gap-2">
          <DetailStat label="ระยะทาง"  value={formatDistance(runner.distance)} />
          <DetailStat label="เพซ"       value={formatPace(runner.speed)} />
          <DetailStat label="อัพเดท"   value={formatTimeAgo(runner.updatedAt)} />
        </div>
      )}
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-xs font-semibold text-white">{value}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────
const FILTERS: { mode: FilterMode; label: string; color?: string }[] = [
  { mode: 'all',       label: 'ทั้งหมด' },
  { mode: 'sos',       label: '🔴 SOS',     color: '#EF4444' },
  { mode: 'stationary', label: '🟡 หยุด',    color: '#F59E0B' },
  { mode: 'no_signal', label: '⚪ ไม่มีสัญญาณ', color: '#6B7280' },
  { mode: 'top20',     label: '🥇 Top 20' },
  { mode: 'bottom20',  label: '🐢 ท้าย 20' },
];

// ─── Main Sidebar ─────────────────────────────────────────────────────────────
export default function AlertSidebar({
  runners, stats, selectedRunner, trackedUserId, onSelectRunner, onTrackRunner,
}: AlertSidebarProps) {
  const [search,     setSearch]     = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  const filteredRunners = useMemo(() => {
    let list = [...runners];

    // Apply filter
    switch (filterMode) {
      case 'sos':        list = list.filter(r => r.runnerStatus === 'sos');        break;
      case 'stationary': list = list.filter(r => r.runnerStatus === 'stationary'); break;
      case 'no_signal':  list = list.filter(r => r.runnerStatus === 'no_signal');  break;
      case 'top20':      list = list.slice(0, 20);   break;
      case 'bottom20':   list = list.slice(-20).reverse(); break;
      default:
        // Sort: SOS first, then stationary, then no_signal, then active
        list.sort((a, b) =>
          STATUS_CONFIG[a.runnerStatus].priority - STATUS_CONFIG[b.runnerStatus].priority
        );
    }

    // Apply search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        r => r.displayName.toLowerCase().includes(q) ||
             r.bibNumber?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [runners, filterMode, search]);

  // Stats for each status (for stat cards)
  const statCards = [
    { label: 'กำลังวิ่ง',    value: stats.active,     color: '#22C55E', mode: 'all'       as FilterMode },
    { label: 'หยุดนิ่ง',     value: stats.stationary,  color: '#F59E0B', mode: 'stationary' as FilterMode },
    { label: 'ไม่มีสัญญาณ',  value: stats.noSignal,    color: '#6B7280', mode: 'no_signal'  as FilterMode },
    { label: 'SOS',           value: stats.sos,         color: '#EF4444', mode: 'sos'        as FilterMode, pulse: true },
  ];

  return (
    <div className="w-80 bg-bg border-l border-border flex flex-col overflow-hidden shrink-0">
      {/* Stats row */}
      <div className="p-3 border-b border-border">
        <div className="flex gap-1.5">
          {statCards.map(s => (
            <StatCard
              key={s.mode}
              label={s.label}
              value={s.value}
              color={s.color}
              pulse={s.pulse}
              active={filterMode === s.mode}
              onClick={() => setFilterMode(prev => prev === s.mode ? 'all' : s.mode)}
            />
          ))}
        </div>
        <div className="text-center text-[11px] text-gray-500 mt-2">
          รวม {stats.total} คน
          {trackedUserId && (
            <button onClick={() => onTrackRunner(null)}
                    className="ml-2 text-brand hover:underline">
              หยุด tracking
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-3">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
               fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ หรือ BIB..."
            className="w-full bg-surface border border-border rounded-xl pl-9 pr-4 py-2.5
                       text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand"
          />
          {search && (
            <button onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="px-3 pt-2 pb-1 flex gap-1.5 overflow-x-auto scrollbar-none">
        {FILTERS.map(f => (
          <button
            key={f.mode}
            onClick={() => setFilterMode(prev => prev === f.mode ? 'all' : f.mode)}
            className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all border
                        ${filterMode === f.mode
                          ? 'bg-brand border-brand text-white'
                          : 'bg-surface border-border text-gray-400 hover:border-gray-500'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Runner count */}
      <div className="px-3 py-1.5">
        <span className="text-[11px] text-gray-500">
          แสดง {filteredRunners.length} คน
        </span>
      </div>

      {/* Runner list */}
      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
        {filteredRunners.length === 0 ? (
          <div className="text-center text-gray-500 text-sm mt-8">
            {search ? 'ไม่พบนักวิ่งที่ค้นหา' : 'ไม่มีนักวิ่งในกลุ่มนี้'}
          </div>
        ) : (
          filteredRunners.map((runner, i) => (
            <RunnerRow
              key={runner.userId}
              runner={runner}
              rank={filterMode === 'all' || filterMode === 'top20' || filterMode === 'bottom20'
                ? runner.rank : undefined}
              isSelected={selectedRunner?.userId === runner.userId}
              isTracked={trackedUserId === runner.userId}
              onSelect={() => onSelectRunner(
                selectedRunner?.userId === runner.userId ? null : runner
              )}
              onTrack={() => onTrackRunner(
                trackedUserId === runner.userId ? null : runner.userId
              )}
            />
          ))
        )}
      </div>
    </div>
  );
}
