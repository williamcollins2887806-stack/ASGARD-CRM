import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { formatMoney } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';

/**
 * EstimatePinnedCard — sticky карточка просчёта сверху чата
 */

const STATUS_MAP = {
  draft: { label: 'Черновик', color: '#888888' },
  sent: { label: 'На согласовании', color: '#1F6FEB' },
  rework: { label: 'На доработке', color: '#D4A843' },
  question: { label: 'Вопрос', color: '#D4A843' },
  approved: { label: 'Согласован', color: '#3FB950' },
  rejected: { label: 'Отклонён', color: '#F85149' },
};

export function EstimatePinnedCard({ metadata, flash }) {
  const navigate = useNavigate();
  if (!metadata) return null;

  const st = STATUS_MAP[metadata.status] || STATUS_MAP.draft;

  return (
    <div
      className="mx-3 my-2"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: '#161b22',
        border: '1px solid rgba(212,168,67,0.2)',
        borderRadius: 14,
        padding: '12px 14px',
        animation: flash ? 'pinnedFlash 600ms ease-out' : undefined,
      }}
      onClick={() => navigate(`/estimate-report/${metadata.estimate_id}`)}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span style={{ fontSize: 14 }}>📊</span>
          <span
            className="truncate"
            style={{ fontSize: 13, fontWeight: 600, color: '#D4A843' }}
          >
            Просчёт #{metadata.estimate_id} v.{metadata.version_no || 1}
          </span>
        </div>
        <div
          className="shrink-0 flex items-center gap-1"
          style={{ fontSize: 12, color: '#58a6ff' }}
        >
          <span>Отчёт</span>
          <ChevronRight size={14} />
        </div>
      </div>

      {/* Title */}
      {(metadata.title || metadata.tender_title) && (
        <p
          className="truncate mt-1"
          style={{ fontSize: 12, color: 'var(--text-secondary)' }}
        >
          {metadata.title || metadata.tender_title}
        </p>
      )}
      {/* Info: customer, city, work_type */}
      {(metadata.customer || metadata.object_city) && (
        <p
          className="truncate"
          style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}
        >
          {[metadata.customer, metadata.object_city, metadata.work_type].filter(Boolean).join(' \u2022 ')}
        </p>
      )}

      {/* Metrics row */}
      <div className="flex items-center gap-4 mt-2">
        {metadata.total_cost != null && (
          <div>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Себес</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginLeft: 4 }}>
              {formatMoney(metadata.total_cost, { short: true })}
            </span>
          </div>
        )}
        {metadata.margin_pct != null && (
          <div>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Маржа</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginLeft: 4 }}>
              {metadata.margin_pct}%
            </span>
          </div>
        )}
        {metadata.total_with_margin != null && (
          <div>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Итого</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginLeft: 4 }}>
              {formatMoney(metadata.total_with_margin, { short: true })}
            </span>
          </div>
        )}
      </div>

      {/* Status badge */}
      <div className="mt-2">
        <span
          className="inline-flex items-center gap-1"
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 6,
            background: `${st.color}18`,
            color: st.color,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color }} />
          {st.label}
        </span>
      </div>
    </div>
  );
}
