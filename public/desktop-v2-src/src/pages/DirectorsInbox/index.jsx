/**
 * Страница /director-inbox — корзина входящих заявок для распределения РП.
 *
 * RBAC: ADMIN / DIRECTOR / HEAD_PM (см. backend POST /assign-pm).
 *
 * Coverage:
 *   ✅ Фильтры: «Все / Неназначенные / На рассмотрении / Назначенные / Архив»
 *   ✅ Поиск по теме/отправителю/AI-summary
 *   ✅ Карточка с AI-разбором + статус + цвет
 *   ✅ AssignPmModal — назначить РП (защита от 409 already_assigned)
 *   ✅ RejectModal — отклонить (с автоответом)
 *   ✅ EmailPreviewModal — «Прочитать письмо целиком»
 *   ✅ archive / under_review (быстрые действия)
 *   ✅ Deep-link `?id=NN`
 *   ✅ SSE-канал `inbox_applications:*`
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState, LoadingCard, TabsBar } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
import { StatusBadge } from '@/modals/Notifications';
import {
  loadList, loadStats, archive, review,
  STATUSES, COLORS, statusInfo, colorInfo, fmtDate
} from './api';
import AssignPmModal from './AssignPmModal';
import RejectModal from './RejectModal';
import EmailPreviewModal from './EmailPreview';
import DirectFromDirectorModal from './DirectFromDirectorModal';

const ALLOWED = ['ADMIN', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

// Быстрые фильтры (бакеты)
const QUICK_FILTERS = [
  { id: 'unassigned', label: 'Неназначенные', matches: (it) => !it.assigned_pm_id && ['new', 'ai_processed'].includes(it.status) },
  { id: 'under_review', label: 'На рассмотрении', matches: (it) => it.status === 'under_review' },
  { id: 'assigned',   label: 'Назначены',    matches: (it) => it.status === 'assigned' || (it.assigned_pm_id && it.status !== 'archived') },
  { id: 'archived',   label: 'Архив',        matches: (it) => it.status === 'archived' },
  { id: 'all',        label: 'Все',          matches: () => true }
];

export default function DirectorsInboxPage() {
  const { user } = useAuth();
  const modal = useModal();

  const allowed = !!user && ALLOWED.includes(user.role);

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState('unassigned');
  const [color, setColor] = useState('');
  const [search, setSearch] = useState('');

  const refresh = () => {
    if (!allowed) return;
    setLoading(true);
    Promise.all([
      loadList({ search, color }),
      loadStats()
    ])
      .then(([list, st]) => { setItems(list); setStats(st); })
      .catch((e) => toast.error('Не удалось загрузить заявки: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, color, allowed]);

  useEffect(() => {
    const onCh = () => refresh();
    window.addEventListener('asgard:director-inbox:changed', onCh);
    const onSSE = (ev) => {
      const t = ev?.detail?.type || '';
      if (t.startsWith('inbox_applications:')) refresh();
    };
    window.addEventListener('asgard:sse', onSSE);
    return () => {
      window.removeEventListener('asgard:director-inbox:changed', onCh);
      window.removeEventListener('asgard:sse', onSSE);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link `?id=NN`
  useEffect(() => {
    const check = () => {
      const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
      if (m && m[1]) {
        modal.open(<EmailPreviewModal id={Number(m[1])} onChanged={refresh} />, { size: 'lg' });
        window.location.hash = '#/director-inbox';
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const bk = QUICK_FILTERS.find((x) => x.id === bucket) || QUICK_FILTERS[0];
    return items.filter(bk.matches);
  }, [items, bucket]);

  const buckets = useMemo(() => QUICK_FILTERS.map((b) => ({
    id: b.id,
    label: b.label,
    count: items.filter(b.matches).length
  })), [items]);

  const onAssign = (it) => modal.open(
    <AssignPmModal application={it} onAssigned={refresh} />,
    { size: 'lg' }
  );
  const onReject = (it) => modal.open(
    <RejectModal application={it} onRejected={refresh} />,
    { size: 'md' }
  );
  const onPreview = (it) => modal.open(
    <EmailPreviewModal id={it.id} onChanged={refresh} />,
    { size: 'lg' }
  );
  const onArchive = async (it) => {
    if (!window.confirm('Архивировать заявку?')) return;
    try {
      await archive(it.id);
      toast.success('Заявка в архиве');
      refresh();
    } catch (e) {
      toast.error('Не удалось архивировать: ' + (e?.message || e));
    }
  };
  const onUnderReview = async (it) => {
    try {
      await review(it.id);
      toast.success('Заявка взята «на рассмотрение»');
      refresh();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  if (user && !allowed) {
    return (
      <div className="card p-32 t-center">
        <div className="fs-32 mb-12">🛡</div>
        <div className="fs-16 fw-700 mb-6">Нет доступа</div>
        <div className="c-t3">Корзина заявок доступна руководству (директор, глава РП, админ).</div>
      </div>
    );
  }

  const byColor = stats.byColor || {};
  const byStatus = stats.byStatus || {};

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Корзина заявок"
        title="Распределение РП"
        subtitle={`Всего ${stats.total || items.length} · 🟢 ${byColor.green || 0} · 🟡 ${byColor.yellow || 0} · 🔴 ${byColor.red || 0} · Новых ${(byStatus.new || 0) + (byStatus.ai_processed || 0)}`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={() => { window.location.hash = '#/inbox-applications'; }}>
              📨 Все заявки
            </Btn>
            <Btn variant="primary" onClick={() => modal.open(<DirectFromDirectorModal onCreated={refresh} />, { size: 'lg' })}>
              ＋ Прямая заявка от меня
            </Btn>
          </>
        }
      />

      <div className="row gap-12 u-wrap">
        <div style={{ flex: 1, minWidth: 220 }}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Поиск по теме, отправителю, AI-summary…"
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }} role="radiogroup" aria-label="Фильтр по AI-цвету">
          {[{ v: '', label: 'Все цвета' }, ...COLORS.map((c) => ({ v: c.value, label: c.label }))].map((b) => (
            <button
              key={b.v}
              type="button"
              role="radio"
              aria-checked={color === b.v}
              className={'pk-tab' + (color === b.v ? ' is-active' : '')}
              onClick={() => setColor(b.v)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <TabsBar tabs={buckets} active={bucket} onChange={setBucket} />

      {loading ? (
        <LoadingCard text="Загружаем заявки…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📭"
          title="Заявок пока нет"
          hint={
            bucket === 'unassigned'
              ? 'Нет неназначенных заявок — отличная работа!'
              : 'В этой корзине ничего нет.'
          }
          action={
            bucket !== 'all' && (
              <Btn variant="ghost" onClick={() => setBucket('all')}>Показать все</Btn>
            )
          }
        />
      ) : (
        <div className="col gap-8" role="list" aria-label="Список заявок">
          {filtered.map((it) => (
            <ApplicationCard
              key={it.id}
              item={it}
              onAssign={() => onAssign(it)}
              onReject={() => onReject(it)}
              onPreview={() => onPreview(it)}
              onArchive={() => onArchive(it)}
              onUnderReview={() => onUnderReview(it)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicationCard({ item, onAssign, onReject, onPreview, onArchive, onUnderReview }) {
  const st = statusInfo(item.status);
  const col = colorInfo(item.ai_color);
  const isAssigned = !!item.assigned_pm_id;
  const isArchived = item.status === 'archived';
  const isRejected = item.status === 'rejected';

  const borderLeft = col.value === 'green' ? '4px solid var(--ok)'
                  : col.value === 'yellow' ? '4px solid var(--amber)'
                  : col.value === 'red'   ? '4px solid var(--err)'
                  : '4px solid var(--brd-1)';

  return (
    <div
      className="card p-14"
      style={{ borderLeft }}
      role="listitem"
    >
      <div className="row-spread gap-12 mb-8">
        <div className="fw-700 fs-14 flex-1 ellipsis">
          #{item.id} · {item.subject || '(без темы)'}
        </div>
        <StatusBadge tone={st.tone} label={st.label} />
      </div>
      <div className="row gap-12 u-wrap fs-12 c-t3 mb-8">
        <span>👤 {item.source_name || item.source_email || '—'}</span>
        {item.ai_classification && <span>· {item.ai_classification}</span>}
        {item.ai_confidence != null && <span>· AI {Math.round(item.ai_confidence * 100)}%</span>}
        <span>· {fmtDate(item.created_at)}</span>
        {item.attachment_count > 0 && <span>· 📎 {item.attachment_count}</span>}
        {isAssigned && <span>· 🎯 Назначено</span>}
      </div>
      {item.ai_summary && (
        <div className="fs-12 c-t2 mb-8" style={{ padding: '6px 10px', background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)' }}>
          🤖 {item.ai_summary}
        </div>
      )}
      <div className="row gap-6 u-wrap">
        <Btn variant="ghost" onClick={onPreview} aria-label="Прочитать письмо">📄 Письмо</Btn>
        {!isAssigned && !isArchived && !isRejected && (
          <>
            <Btn variant="primary" onClick={onAssign}>🎯 Назначить РП</Btn>
            <Btn variant="ghost" onClick={onUnderReview}>🔍 На рассмотрение</Btn>
            <Btn variant="ghost" onClick={onReject}>✕ Отклонить</Btn>
          </>
        )}
        {!isArchived && (
          <Btn variant="ghost" onClick={onArchive}>🗑 В архив</Btn>
        )}
      </div>
    </div>
  );
}
