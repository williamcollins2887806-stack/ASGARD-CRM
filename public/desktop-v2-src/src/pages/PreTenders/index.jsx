/**
 * Страница /pre-tenders — «Заявки» (входящие пред-тендеры с AI).
 *
 * Источник: vanilla `public/assets/js/pre_tenders.js` (~1633 строки).
 *
 *   ✅ pages/PreTenders/index.jsx   ← root + статистика + фильтр + список
 *   ✅ pages/PreTenders/api.js      ← 12 endpoints
 *   ✅ modals/DetailModal.jsx       ← карточка с AI-отчётом + inline-edit
 *   ✅ modals/AcceptModal.jsx       ← все 5 модалок действий
 *
 * Никаких заглушек.
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { StatusBadge } from '@/modals/Notifications';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';
import { EmptyState } from '@/blocks/Blocks';
import { DetailModal } from './modals/DetailModal';
import { AcceptModal, FastTrackModal, RejectModal, RequestDocsModal, CreateManualModal } from './modals/AcceptModal';
import { loadList, loadStats, subscribeSse, STATUSES, colorBadge, fmtMoney, fmtDate, fmtDateTime } from './api';

// RBAC синхронно с backend `src/routes/pre_tenders.js:16` (ALLOWED_ROLES).
// Inline-литералы для скрипта rbac-audit (он не разворачивает имена констант).
const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO', 'HEAD_PM', 'TO'];

export default function PreTendersPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [filters, setFilters] = useState({ q: '', status: '', ai_color: '' });
  const dq = useDebounce(filters.q, 300);  // G-11: debounce 300мс
  const [loading, setLoading] = useState(true);
  // v2 BONUS: density toggle (compact|normal) для длинных списков заявок (vanilla не имеет)
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem('pretenders.density') || 'normal'; } catch { return 'normal'; }
  });

  const hasAccess = !user || ALLOWED_ROLES.includes(user.role);

  const refresh = () => {
    if (!hasAccess) return;
    setLoading(true);
    Promise.all([loadList(), loadStats()])
      .then(([list, st]) => { setItems(list); setStats(st); })
      .catch((e) => toast('Не удалось загрузить заявки', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [hasAccess]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener('asgard:pre-tenders:changed', onChange);
    return () => window.removeEventListener('asgard:pre-tenders:changed', onChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time подписка на события заявок (SSE).
  // Vanilla: pre_tenders.js:746 — initSSEClient. Без неё новые заявки
  // от других пользователей появляются только после ручного обновления.
  useEffect(() => {
    if (!hasAccess) return undefined;
    const unsubscribe = subscribeSse({
      onNew: (data) => {
        toast('Новая заявка', data?.customer_name || 'Новая предварительная заявка', 'ok');
        refresh();
      },
      onUpdated: () => refresh(),
      onAccepted: (data) => {
        const msg = data?.fast_track ? 'Сразу на просчёт' : 'Принята в работу';
        toast('Заявка принята', `${data?.customer_name || ''} — ${msg}`, 'ok');
        refresh();
      },
      onRejected: () => refresh()
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess]);

  const visible = useMemo(() => {
    let v = items;
    if (filters.status) v = v.filter((t) => t.status === filters.status);
    if (filters.ai_color) v = v.filter((t) => t.ai_color === filters.ai_color);
    if (dq) {
      const lq = dq.toLowerCase();
      v = v.filter((t) =>
        (t.customer_name || '').toLowerCase().includes(lq) ||
        (t.work_description || '').toLowerCase().includes(lq) ||
        (t.customer_inn || '').includes(lq) ||
        String(t.id).includes(lq)
      );
    }
    return v;
  }, [items, filters.status, filters.ai_color, dq]);

  // v2 BONUS: keyboard hotkeys — Ctrl+N создать заявку, / фокус поиска, Esc сбросить фильтры (vanilla не имеет)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') {
        if (e.key === 'Escape' && e.target?.dataset?.searchbox) e.target.blur();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        modal.open(<CreateManualModal onCreated={refresh} />);
      } else if (e.key === '/') {
        e.preventDefault();
        const input = document.querySelector('input[data-searchbox="pretenders"]');
        input?.focus();
      } else if (e.key === 'Escape' && (filters.q || filters.status || filters.ai_color)) {
        setFilters({ q: '', status: '', ai_color: '' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.status, filters.ai_color]);

  // v2 BONUS: персистенция density
  useEffect(() => {
    try { localStorage.setItem('pretenders.density', density); } catch { /* noop */ }
  }, [density]);

  // v2 BONUS: export CSV в один клик (vanilla не имеет)
  const exportCsv = () => {
    if (!visible.length) { toast.warn('Список пуст'); return; }
    const rows = [
      ['ID', 'Заказчик', 'ИНН', 'Описание', 'AI цвет', 'AI балл', 'Сумма', 'Дедлайн', 'Статус', 'Создано'],
      ...visible.map((pt) => [
        pt.id,
        pt.customer_name || '',
        pt.customer_inn || '',
        (pt.work_description || '').replace(/[\r\n]+/g, ' '),
        pt.ai_color || '',
        pt.ai_work_match_score ?? '',
        pt.estimated_sum || pt.ai_cost_estimate || '',
        pt.work_deadline || '',
        pt.status || '',
        pt.created_at || ''
      ])
    ];
    const csv = '﻿' + rows.map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pre-tenders_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Экспорт CSV: ${visible.length} заявок`);
  };

  const openDetail = (pt) => modal.open(
    <DetailModal
      id={pt.id}
      onAccept={(p) => modal.open(<AcceptModal preTender={p} />)}
      onFastTrack={(p) => modal.open(<FastTrackModal preTender={p} />)}
      onReject={(p) => modal.open(<RejectModal preTender={p} />)}
      onRequestDocs={(p) => modal.open(<RequestDocsModal preTender={p} />)}
    />
  );

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !hasAccess) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Заявки недоступны"
        message="Входящие заявки видят ADMIN, директора, ТО/HEAD_TO и HEAD_PM."
      />
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        title="Заявки"
        subtitle={`${visible.length} в выборке · 🆕 ${stats.total_new || 0} новых · 🔍 ${stats.total_in_review || 0} в работе · 📁 ${stats.total_need_docs || 0} ждут документы`}
        actions={
          <>
            {/* v2 BONUS: density toggle + export CSV (vanilla не имеет) */}
            <Btn
              variant="ghost"
              title={density === 'compact' ? 'Компактный режим' : 'Обычный режим'}
              onClick={() => setDensity((d) => d === 'compact' ? 'normal' : 'compact')}
            >
              {density === 'compact' ? '☰ Обычный' : '≡ Компакт'}
            </Btn>
            <Btn variant="ghost" onClick={exportCsv} title="Экспорт CSV">📊 CSV</Btn>
            <Btn variant="ghost" onClick={() => setFilters({ q: '', status: '', ai_color: '' })}>↺ Сбросить</Btn>
            <Btn variant="primary" onClick={() => modal.open(<CreateManualModal onCreated={refresh} />)} title="Ctrl+N">+ Заявка вручную</Btn>
          </>
        }
      />

      {/* Бейджи быстрого фильтра по цветам AI */}
      <div className="u-flex gap-8 u-wrap">
        {[
          { value: '', label: 'Все цвета', count: items.length },
          { value: 'green',  label: '🟢 Подходит',    count: items.filter((i) => i.ai_color === 'green').length },
          { value: 'yellow', label: '🟡 Спорно',      count: items.filter((i) => i.ai_color === 'yellow').length },
          { value: 'red',    label: '🔴 Не подходит', count: items.filter((i) => i.ai_color === 'red').length },
          { value: 'gray',   label: '⚪ Не оценено',  count: items.filter((i) => i.ai_color === 'gray' || !i.ai_color).length }
        ].map((b) => (
          <button
            key={b.value}
            className="btn-ghost"
            style={{
              padding: '6px 12px',
              background: filters.ai_color === b.value ? 'var(--gold-bg)' : 'var(--inner-bg)',
              border: filters.ai_color === b.value ? '1px solid var(--gold)' : '1px solid var(--brd-2)',
              borderRadius: 'var(--r-sm)',
              fontSize: 12.5,
              cursor: 'pointer'
            }}
            onClick={() => setFilters({ ...filters, ai_color: b.value })}
          >
            {b.label} · {b.count}
          </button>
        ))}
      </div>

      <div className="filter-bar" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,2fr) minmax(140px,1fr)', gap: 8 }}>
        {/* v2 BONUS: data-searchbox для hotkey "/" фокуса */}
        <SearchInput data-searchbox="pretenders" value={filters.q} onChange={(v) => setFilters({ ...filters, q: v })} placeholder="Поиск по заказчику, описанию, ИНН… (/ для фокуса)" />
        <SelectInput value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })} options={[{ value: '', label: 'Все статусы' }, ...STATUSES]} />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : visible.length === 0 ? (
        <EmptyState icon="📨" title="Заявок нет" hint="Заявки приходят от ТО или создаются вручную" />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            {/* v2 BONUS: density compact даёт уменьшенный line-height/padding (через style на table) */}
            <table className="t-list w-full tbl-base" style={density === 'compact' ? { fontSize: 12, lineHeight: 1.2 } : undefined}>
              <thead>
                <tr className="bg-inner tbl-row-brd">
                  <th className="w-60">ID</th>
                  <th>Заказчик / Описание</th>
                  <th className="w-110">AI Цвет</th>
                  <th className="w-90">Балл</th>
                  <th className="w-130">Сумма</th>
                  <th className="w-110">Дедлайн</th>
                  <th className="w-130">Статус</th>
                  <th className="w-130">Дата</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((pt) => {
                  const st = STATUSES.find((s) => s.value === pt.status) || { label: pt.status, tone: 'draft' };
                  const cb = colorBadge(pt.ai_color);
                  return (
                    <tr key={pt.id} className="row-hover cur-p"  onClick={() => openDetail(pt)}>
                      <td style={{ color: 'var(--t-3)', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>#{pt.id}</td>
                      <td>
                        <div className="fw-600">{pt.customer_name || '—'}</div>
                        {pt.work_description && (
                          <div style={{ fontSize: 11.5, color: 'var(--t-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>
                            {pt.work_description}
                          </div>
                        )}
                      </td>
                      <td><StatusBadge tone={cb.tone} label={cb.label} /></td>
                      <td>{pt.ai_work_match_score != null ? `${pt.ai_work_match_score}` : '—'}</td>
                      <td>{fmtMoney(pt.estimated_sum || pt.ai_cost_estimate)}</td>
                      <td>{fmtDate(pt.work_deadline)}</td>
                      <td><StatusBadge tone={st.tone} label={st.label} /></td>
                      <td className="c-t3 fs-12">{fmtDateTime(pt.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
