/**
 * Страница /pm-consents — Согласия РП на условия override-просьб.
 *
 * Источник: vanilla `public/assets/js/pm_consents.js` (~94 строки).
 *
 *   ✅ index.jsx — таблица запросов согласия + кнопки Согласен/Не согласен
 *
 * Backend: generic CRUD через `/api/data/pm_consents`. Связь с тендерами:
 *   запросы хранят tender_id; статус: pending/approved/declined.
 *
 * RBAC: PM (видит свои pending запросы), ADMIN/DIRECTOR_* (видят все).
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';
import { StatusBadge } from '@/modals/Notifications';

const STATUS_MAP = {
  pending:  { label: 'Ожидает',    tone: 'sent' },
  approved: { label: 'Согласовано', tone: 'approved' },
  declined: { label: 'Отклонено',   tone: 'rejected' }
};

export default function PmConsentsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [items, setItems] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const dq = useDebounce(filters.q, 300);  // G-11: debounce 300мс
  const [loading, setLoading] = useState(true);

  // RBAC inline-литералы
  const _isPm = user?.role === 'PM';
  const _isAdmin = ['ADMIN'].includes(user?.role);
  const _isDir = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);
  const _allowed = _isPm || _isAdmin || _isDir;

  const refresh = () => {
    if (!user?.id) return;
    setLoading(true);
    Promise.all([
      api('/api/data/pm_consents?limit=2000').then((d) => d?.items || d?.rows || []).catch(() => []),
      api('/api/tenders?limit=2000').then((d) => d?.tenders || []).catch(() => [])
    ])
      .then(([cons, tens]) => {
        // PM видит только свои, ADMIN/DIRECTOR — все
        const filtered = (_isAdmin || _isDir) ? cons : cons.filter((c) => Number(c.pm_id) === Number(user.id));
        setItems(filtered);
        setTenders(tens);
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    if (!_allowed) {
      toast.error('Раздел доступен РП и руководству');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  const tendersById = useMemo(() => Object.fromEntries(tenders.map((t) => [t.id, t])), [tenders]);

  const visible = useMemo(() => {
    let v = items;
    if (filters.status) v = v.filter((c) => c.status === filters.status);
    if (dq.trim()) {
      const lq = dq.toLowerCase();
      v = v.filter((c) => {
        const t = tendersById[c.tender_id];
        return (
          (c.type || '').toLowerCase().includes(lq) ||
          (t?.customer_name || '').toLowerCase().includes(lq) ||
          (t?.tender_title || '').toLowerCase().includes(lq) ||
          String(c.id).includes(lq)
        );
      });
    }
    v = [...v].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return v;
  }, [items, tendersById, filters.status, dq]);

  const stats = useMemo(() => ({
    total: items.length,
    pending: items.filter((c) => c.status === 'pending').length,
    approved: items.filter((c) => c.status === 'approved').length,
    declined: items.filter((c) => c.status === 'declined').length
  }), [items]);

  const onDecide = (c, action) => {
    modal.open(
      <ConfirmModal
        tone={action === 'approve' ? 'success' : 'warn'}
        title={action === 'approve' ? 'Согласовать?' : 'Отклонить?'}
        message={action === 'approve'
          ? 'Подтвердите согласие на пересечение сроков по тендеру.'
          : 'Запрос будет отклонён.'}
        onConfirm={async () => {
          try {
            await api(`/api/data/pm_consents/${c.id}`, {
              method: 'PUT',
              body: {
                ...c,
                status: action === 'approve' ? 'approved' : 'declined',
                decided_at: new Date().toISOString(),
                decided_by_user_id: user.id
              }
            });
            toast.success(action === 'approve' ? 'Согласовано' : 'Отклонено');
            refresh();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  if (user && !_allowed) return null;

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Согласования"
        title="Согласия РП"
        subtitle={`${visible.length} запросов · ${stats.pending} ждут ответа`}
        actions={<Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>}
      />

      <div className="grid-auto-160 gap-10">
        <Stat label="Всего" value={stats.total} />
        <Stat label="Ожидают" value={stats.pending} tone="amber" />
        <Stat label="Согласовано" value={stats.approved} tone="ok" />
        <Stat label="Отклонено" value={stats.declined} tone="err" />
      </div>

      <div className="filter-grid-2">
        <SearchInput value={filters.q} onChange={(v) => setFilters({ ...filters, q: v })} placeholder="Поиск по тендеру, типу, ID…" />
        <SelectInput
          value={filters.status}
          onChange={(v) => setFilters({ ...filters, status: v })}
          options={[
            { value: '', label: 'Все статусы' },
            ...Object.entries(STATUS_MAP).map(([v, m]) => ({ value: v, label: m.label }))
          ]}
        />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="✋"
          title="Запросов нет"
          hint="Здесь появятся запросы согласия на пересечение сроков."
          action={null}
        />
      ) : (
        <div className="card card-pad-overflow">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr className="bg-inner tbl-row-brd">
                <Th>Дата</Th>
                <Th>Тип</Th>
                <Th>Статус</Th>
                <Th>Тендер / Работа</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const t = tendersById[c.tender_id];
                const status = STATUS_MAP[c.status] || { label: c.status, tone: 'draft' };
                const isMine = Number(c.pm_id) === Number(user?.id);
                return (
                  <tr key={c.id} className="tbl-row-brd-2">
                    <Td><span className="c-t3">{fmtDateTime(c.created_at)}</span></Td>
                    <Td>{c.type || '—'}</Td>
                    <Td><StatusBadge tone={status.tone} label={status.label} /></Td>
                    <Td>
                      {t ? (
                        <>
                          <div className="fw-700">{t.customer_name || '—'}</div>
                          <div className="fs-11 c-t3">{t.tender_title || ''}</div>
                        </>
                      ) : '—'}
                    </Td>
                    <Td>
                      {c.status === 'pending' && isMine ? (
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button className="m-btn primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onDecide(c, 'approve')}>Согласен</button>
                          <button className="m-btn ghost" style={{ padding: '4px 10px', fontSize: 12, color: 'var(--err)' }} onClick={() => onDecide(c, 'decline')}>Не согласен</button>
                        </div>
                      ) : (
                        <span className="c-t3 fs-12">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, _tone = 'default' }) {
  const _colors = { default: 'var(--t-1)', ok: 'var(--ok)', amber: 'var(--amber)', err: 'var(--err)' };
  return (
    <div className="bg-inner r-md p-14">
      <div className="mini-kpi-label">{label}</div>
      <div className="mini-kpi-value">{value}</div>
    </div>
  );
}
function Th({ children }) {
  return <th className="pad-cell-lg tab-th">{children}</th>;
}
function Td({ children }) {
  return <td className="pad-cell-lg v-mid">{children}</td>;
}
function fmtDateTime(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}
