/**
 * Страница /tkp-followup — Контроль ТКП (follow-up по решению клиента).
 *
 * Источник: vanilla `public/assets/js/tkp_followup.js` (~263 строки).
 * Vanilla хранил состояние в IndexedDB (AsgardDB) и слал лишь напоминания PM.
 * В v2 переписано на реальные серверные endpoints (`/api/tkp/followup`,
 * `/api/tkp/:id/followup`, `/api/tkp/:id/client-decision`) с записью в audit_log
 * и каскадом client-decision на тендер.
 *
 *   ✅ pages/TkpFollowup/index.jsx                    — реестр + фильтры + действия
 *   ✅ pages/TkpFollowup/api.js                       — 4 endpoint + buckets/labels
 *   ✅ pages/TkpFollowup/tkp-followup.css             — кастомные стили реестра
 *   ✅ pages/TkpFollowup/modals/LogContactModal.jsx   — call/email/meeting/other/note
 *   ✅ pages/TkpFollowup/modals/DecisionModal.jsx     — Победили/Проиграли/Нет ответа
 *   ✅ pages/TkpFollowup/modals/HistoryModal.jsx      — журнал всех событий по ТКП
 *
 * Никаких заглушек. Все 4 кнопки строки работают.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast, StatusBadge } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
import AccessDenied from '@/blocks/AccessDenied';
import { useDebounce } from '@/api/useListHelpers';

import { LogContactModal } from './modals/LogContactModal';
import { DecisionModal } from './modals/DecisionModal';
import { HistoryModal } from './modals/HistoryModal';
import {
  loadFollowup, BUCKETS, ACTION_LABELS, DECISION_LABELS,
  fmtMoney, fmtDate, fmtDateTime, daysTone
} from './api';
import './tkp-followup.css';

// Backend `tkp.js:1846` GET /followup — fastify.authenticate (любой), но семантика:
// PM/HEAD_PM/TO/HEAD_TO видят свои отправленные, остальные SEE_ALL_ROLES — все.
// POST /:id/followup — EDIT_ROLES (без BUH). BUH можно показать как read-only,
// но кнопки контакта пусть видят только пишущие роли.
const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const WRITE_ROLES   = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function TkpFollowupPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [bucket, setBucket] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  const hasAccess = !user || ALLOWED_ROLES.includes(user.role);
  const canWrite = !!user && WRITE_ROLES.includes(user.role);

  const refresh = () => {
    if (!hasAccess) return;
    setLoading(true);
    // Запрашиваем без фильтра — стата по всем bucket'ам нужна для бейджей.
    loadFollowup('')
      .then(({ items: it, stats: st }) => {
        setItems(it);
        setStats(st);
      })
      .catch((e) => toast('Не удалось загрузить', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [hasAccess]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener('asgard:tkp-followup:changed', onChange);
    window.addEventListener('asgard:tkp:changed', onChange);
    return () => {
      window.removeEventListener('asgard:tkp-followup:changed', onChange);
      window.removeEventListener('asgard:tkp:changed', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v2 BONUS: hotkeys 1/2/3/4 быстрая фильтрация по bucket (vanilla не имел buckets) + / фокус поиска + Esc сброс
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); document.querySelector('input[data-searchbox="tkp-followup"]')?.focus(); }
      else if (e.key === 'Escape' && (q || bucket)) { setBucket(''); setQ(''); }
      else if (e.key === '1') setBucket('needs_contact');
      else if (e.key === '2') setBucket('in_progress');
      else if (e.key === '3') setBucket('decided');
      else if (e.key === '4') setBucket('archive');
      else if (e.key === '0') setBucket('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q, bucket]);

  const visible = useMemo(() => {
    let v = items;
    if (bucket) v = v.filter((t) => t.followup_bucket === bucket);
    if (dq) {
      const lq = dq.toLowerCase();
      v = v.filter((t) =>
        (t.customer_name || '').toLowerCase().includes(lq) ||
        (t.subject || '').toLowerCase().includes(lq) ||
        (t.tkp_number || '').toLowerCase().includes(lq) ||
        (t.customer_inn || '').includes(lq) ||
        String(t.id).includes(lq)
      );
    }
    // Сортировка: сначала горящие (needs_contact), потом in_progress по dayssince убыв.
    return [...v].sort((a, b) => {
      const ord = (b.followup_bucket === 'needs_contact') - (a.followup_bucket === 'needs_contact');
      if (ord) return ord;
      return (b.days_since_last_contact || 0) - (a.days_since_last_contact || 0);
    });
  }, [items, bucket, dq]);

  // Inline RBAC-гейт после хуков.
  if (user && !hasAccess) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Контроль ТКП недоступен"
        message="Раздел открыт PM/HEAD_PM, TO/HEAD_TO, BUH, директорам и ADMIN."
      />
    );
  }

  const openLog = (tkp, kind) => modal.open(<LogContactModal tkp={tkp} kind={kind} onDone={refresh} />);
  const openDecision = (tkp, decision) => modal.open(<DecisionModal tkp={tkp} decision={decision} onDone={refresh} />);
  const openHistory = (tkp) => modal.open(<HistoryModal tkp={tkp} />);

  const bucketsWithCounts = BUCKETS.map((b) => ({
    ...b,
    count: b.value === '' ? items.length : (stats[b.value] ?? items.filter((i) => i.followup_bucket === b.value).length)
  }));

  return (
    <div className="col gap-12">
      <TopActionsBar
        title="Контроль ТКП"
        subtitle={`${visible.length} в выборке · 🔴 ${stats.needs_contact || 0} требуют контакта · ⏳ ${stats.in_progress || 0} в работе · ✅ ${stats.decided || 0} с решением`}
        actions={
          <Btn variant="ghost" onClick={() => { setBucket(''); setQ(''); }}>↺ Сбросить</Btn>
        }
      />

      {/* Сводка */}
      <div className="tfu-summary">
        <SummaryTile lbl="Требуют контакта" value={stats.needs_contact || 0} tone="rejected" />
        <SummaryTile lbl="В работе"         value={stats.in_progress || 0}   tone="sent" />
        <SummaryTile lbl="Решение принято"  value={stats.decided || 0}       tone="approved" />
        <SummaryTile lbl="Архив"            value={stats.archive || 0}       tone="draft" />
      </div>

      {/* Фильтр-бейджи */}
      <div className="tfu-filters">
        {bucketsWithCounts.map((b) => (
          <button
            key={b.value || 'all'}
            type="button"
            className={`tfu-chip ${bucket === b.value ? 'is-active' : ''}`}
            onClick={() => setBucket(b.value)}
          >
            <span aria-hidden="true">{b.icon}</span>
            {b.label}
            <span className="tfu-chip__count">· {b.count}</span>
          </button>
        ))}
      </div>

      {/* v2 BONUS: data-searchbox + hotkey hint */}
      <SearchInput data-searchbox="tkp-followup" value={q} onChange={setQ} placeholder="Поиск по заказчику, №, ИНН, теме ТКП… (/ фокус · 1-4 фильтр)" />

      {loading ? (
        <div className="card card-empty">⏳ Загружаем…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📨"
          title="Нет отправленных ТКП"
          hint="Когда ТКП будет отправлено клиенту, оно появится здесь для контроля решения."
        />
      ) : (
        <div className="col gap-8">
          {visible.map((t) => (
            <FollowupCard
              key={t.id}
              t={t}
              canWrite={canWrite}
              onLog={(kind) => openLog(t, kind)}
              onDecide={(decision) => openDecision(t, decision)}
              onHistory={() => openHistory(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryTile({ lbl, value, tone }) {
  const colors = {
    rejected: 'var(--err)',
    sent:     'var(--info)',
    approved: 'var(--ok)',
    draft:    'var(--t-3)'
  };
  return (
    <div className="tfu-summary__tile">
      <div className="lbl">{lbl}</div>
      <strong style={{ color: colors[tone] }}>{value}</strong>
    </div>
  );
}

function FollowupCard({ t, canWrite, onLog, onDecide, onHistory }) {
  const days = t.days_since_last_contact;
  const tone = daysTone(days);
  const stale = days != null && days > 7 && t.followup_bucket !== 'decided' && t.followup_bucket !== 'archive';
  const decision = DECISION_LABELS[t.client_decision];
  const lastEvent = (t.followup_log || [])[0];
  const lastMeta = lastEvent ? ACTION_LABELS[lastEvent.action] || { label: lastEvent.action, icon: '•' } : null;

  return (
    <div className={`tfu-card ${stale ? 'tfu-card--stale' : ''}`}>
      <div className={`tfu-days tone-${tone}`}>
        <span className="tfu-days__n">{days != null ? days : '—'}</span>
        <span className="tfu-days__lbl">дн.</span>
      </div>

      <div className="col gap-4">
        <div className="row-spread u-flex u-wrap gap-8">
          <div>
            <div className="fw-600">{t.customer_name || '—'}</div>
            <div className="fs-12 c-t3">
              {t.tkp_number ? `№ ${t.tkp_number} · ` : ''}{t.subject || '—'}
            </div>
          </div>
          <div className="u-flex gap-6 u-wrap">
            {decision && <StatusBadge tone={decision.tone} label={decision.label} />}
            {!decision && t.followup_bucket === 'needs_contact' && (
              <StatusBadge tone="rejected" label="Требует контакта" />
            )}
            {!decision && t.followup_bucket === 'in_progress' && (
              <StatusBadge tone="sent" label="В работе" />
            )}
          </div>
        </div>

        <div className="tfu-meta">
          <span>💰 {fmtMoney(t.total_sum)}</span>
          <span>📨 Отправлено: {fmtDate(t.sent_at || t.created_at)}</span>
          {t.contact_person && <span>👤 {t.contact_person}</span>}
          {t.contact_phone && <span>📞 {t.contact_phone}</span>}
          {t.author_name && <span>✍ {t.author_name}</span>}
        </div>

        {lastEvent && lastMeta && (
          <div className="fs-12 c-t2">
            <span aria-hidden="true">{lastMeta.icon}</span>{' '}
            <strong>{lastMeta.label}</strong> · {fmtDateTime(lastEvent.created_at)}
            {lastEvent.details ? ` — ${lastEvent.details.slice(0, 120)}` : ''}
          </div>
        )}
      </div>

      <div className="tfu-actions">
        {canWrite ? (
          <>
            <Btn size="sm" variant="ghost" onClick={() => onLog('call')}>📞 Позвонил</Btn>
            <Btn size="sm" variant="ghost" onClick={() => onLog('email')}>📧 Написал</Btn>
            <Btn size="sm" variant="success" onClick={() => onDecide('accepted')}>✅ Победили</Btn>
            <Btn size="sm" variant="danger" onClick={() => onDecide('rejected')}>❌ Проиграли</Btn>
            <Btn size="sm" variant="ghost" onClick={onHistory}>📜 История</Btn>
          </>
        ) : (
          <Btn size="sm" variant="ghost" onClick={onHistory}>📜 История</Btn>
        )}
      </div>
    </div>
  );
}
