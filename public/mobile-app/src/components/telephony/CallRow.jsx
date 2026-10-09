import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, Plus } from 'lucide-react';
import { useHaptic } from '@/hooks/useHaptic';
import {
  avatarGradient,
  digitsForTel,
  groupByDay,
  initialsFrom,
  rowSurface,
  taskFromCallPath,
} from '@/components/telephony/telUi';

export function formatCallTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

export function formatDuration(sec) {
  const n = Number(sec) || 0;
  if (n <= 0) return '—';
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function callTitle(row) {
  return row.client_name || row.client_contact || row.from_number || row.to_number || row.caller_number || 'Звонок';
}

export function CallRow({ row, to }) {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const startX = useRef(0);
  const swiped = useRef(false);
  const [dx, setDx] = useState(0);
  const missed = row.call_type === 'missed';
  const outbound = row.direction === 'outbound' || row.call_type === 'outbound';
  const Icon = missed ? PhoneMissed : outbound ? PhoneOutgoing : PhoneIncoming;
  const color = missed ? 'var(--red)' : outbound ? 'var(--blue)' : 'var(--green)';
  const title = callTitle(row);
  const tel = digitsForTel(row.from_number || row.caller_number || row.to_number);

  const onStart = (e) => {
    startX.current = e.touches ? e.touches[0].clientX : e.clientX;
  };
  const onMove = (e) => {
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    setDx(Math.max(-88, Math.min(88, x - startX.current)));
  };
  const onEnd = () => {
    if (dx > 64 && tel) {
      swiped.current = true;
      haptic.medium();
      window.location.href = `tel:${tel}`;
    } else if (dx < -64) {
      swiped.current = true;
      haptic.medium();
      navigate(taskFromCallPath(`Звонок: ${title}`));
    } else if (Math.abs(dx) > 16) {
      swiped.current = true;
    }
    setDx(0);
  };

  return (
    <div className="relative overflow-hidden rounded-[18px]">
      <div
        className="absolute inset-y-0 left-0 flex items-center pl-4"
        style={{ color: 'var(--green)', opacity: Math.min(1, Math.max(0, dx) / 56) }}
        aria-hidden
      >
        <Phone size={18} />
      </div>
      <div
        className="absolute inset-y-0 right-0 flex items-center pr-4"
        style={{ color: 'var(--gold)', opacity: Math.min(1, Math.max(0, -dx) / 56) }}
        aria-hidden
      >
        <Plus size={18} />
      </div>
      <button
        type="button"
        className="w-full flex items-center gap-3 text-left relative"
        style={{
          minHeight: 64,
          padding: '12px 14px',
          borderRadius: 18,
          transform: `translateX(${dx}px)`,
          transition: dx ? 'none' : 'transform 180ms var(--ease-spring)',
          ...rowSurface,
        }}
        onClick={() => {
          if (swiped.current) {
            swiped.current = false;
            return;
          }
          haptic.light();
          navigate(to || `/telephony/calls/${row.id}`);
        }}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
      >
        <div className="relative shrink-0">
          <div
            className="flex items-center justify-center rounded-full font-extrabold"
            style={{
              width: 44,
              height: 44,
              fontSize: 13,
              letterSpacing: '0.02em',
              background: avatarGradient(title),
              color: 'var(--text-primary)',
            }}
          >
            {initialsFrom(title)}
          </div>
          <span
            className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full"
            style={{
              width: 16,
              height: 16,
              backgroundColor: 'var(--bg-primary)',
              color,
              boxShadow: `0 0 0 1.5px color-mix(in srgb, ${color} 40%, transparent)`,
            }}
          >
            <Icon size={9} strokeWidth={2.5} />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate" style={{ fontSize: 16, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
            {title}
          </div>
          <div className="truncate mt-0.5" style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)' }}>
            {missed ? 'Пропущенный' : outbound ? 'Исходящий' : 'Входящий'}
            {Number(row.duration_seconds || row.duration) > 0
              ? ` · ${formatDuration(row.duration_seconds || row.duration)}`
              : ''}
          </div>
        </div>
        <span style={{ fontSize: 14, fontWeight: 400, fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>
          {formatCallTime(row.created_at)}
        </span>
      </button>
    </div>
  );
}

export function CallList({ items }) {
  const groups = groupByDay(items);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.key}>
          <div
            className="sticky top-0 z-[1] py-1 mb-2 text-xs font-semibold uppercase tracking-wide"
            style={{
              color: 'var(--text-secondary)',
              background: 'color-mix(in srgb, var(--bg-primary) 92%, transparent)',
            }}
          >
            {g.key}
          </div>
          <div className="flex flex-col gap-2">
            {g.items.map((row) => <CallRow key={row.id} row={row} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
