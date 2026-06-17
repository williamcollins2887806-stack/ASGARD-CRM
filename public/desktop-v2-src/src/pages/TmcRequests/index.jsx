/**
 * Страница /tmc-requests — Заявки на ТМЦ (товарно-материальные ценности).
 *
 * Источник: vanilla `public/assets/js/tmc-requests-page.js` (192 строки).
 *
 * Coverage:
 *   ✅ Список заявок (таблица: ID/название/проект/сумма/приоритет/статус/дата)
 *   ✅ Создание/редактирование (форма с позициями: name|unit|qty|price)
 *   ✅ Автоматический расчёт суммы по позициям
 *   ✅ Подача (draft→submitted) + смена статусов директорами/BUH
 *   ✅ Excel-экспорт массовый + одной заявки (через blob + Authorization header — без токена в URL)
 *   ✅ Действия: одобрить/отклонить/заказан/доставлен/закрыть (по статусу+роли)
 *   ✅ Фильтры: статус, приоритет, поиск
 *   ✅ Hash deep-link `?id=NN` открывает карточку
 *
 * RBAC: WRITE = ADMIN, PM, HEAD_PM, TO, HEAD_TO, DIRECTOR_GEN, DIRECTOR_COMM, BUH
 *       APPROVE = ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, BUH
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { StatusBadge } from '@/modals/Notifications';
import { ConfirmModal, PromptModal } from '@/modals';
import {
  loadList, setStatus, STATUSES, PRIORITIES, statusInfo, priorityInfo,
  fmtDate, fmtMoney, emitChanged
} from './api';
import { openProtected } from '@/api/download';
import { TmcRequestModal } from './TmcRequestModal';

const WRITE_ROLES   = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH'];
const APPROVE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'BUH'];

export default function TmcRequestsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const canWrite   = WRITE_ROLES.includes(user?.role);
  const canApprove = APPROVE_ROLES.includes(user?.role);

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', priority: '', search: '' });
  // v2 BONUS: sortable columns по любому полю (vanilla — только по дате) + density toggle
  const [sort, setSort] = useState({ key: 'created_at', dir: -1 });
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem('tmc.density') || 'normal'; } catch { return 'normal'; }
  });
  useEffect(() => {
    try { localStorage.setItem('tmc.density', density); } catch { /* noop */ }
  }, [density]);

  const refresh = () => {
    setLoading(true);
    loadList({ status: filters.status, priority: filters.priority })
      .then(setList)
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [filters.status, filters.priority]);

  useEffect(() => {
    const on = () => refresh();
    window.addEventListener('asgard:tmc-requests:changed', on);
    return () => window.removeEventListener('asgard:tmc-requests:changed', on);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const check = () => {
      const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
      if (m && m[1]) {
        modal.open(<TmcRequestModal id={Number(m[1])} onSaved={refresh} />, { size: 'xl' });
        window.location.hash = '#/tmc-requests';
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const filtered = !q ? list : list.filter((it) =>
      (it.title || '').toLowerCase().includes(q) ||
      (it.work_title || '').toLowerCase().includes(q) ||
      String(it.id).includes(q)
    );
    // v2 BONUS: client sort (vanilla не имеет — фиксированный порядок)
    const arr = [...filtered];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      const va = a?.[key]; const vb = b?.[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'ru') * dir;
    });
    return arr;
  }, [list, filters.search, sort]);

  const onSort = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }));
  const arrow = (k) => sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : '';

  // v2 BONUS: keyboard hotkeys — "/" фокус поиска, Esc сброс, "n" новая (vanilla не имеет)
  useEffect(() => {
    const onKey = (e) => {
      const inField = /input|textarea|select/i.test((e.target?.tagName || ''));
      if (e.key === '/' && !inField) {
        e.preventDefault();
        document.querySelector('[data-searchbox="tmc"] input')?.focus();
      } else if (e.key === 'Escape' && (filters.search || filters.status || filters.priority)) {
        setFilters({ status: '', priority: '', search: '' });
      } else if (!inField && (e.key === 'n' || e.key === 'N') && canWrite) {
        e.preventDefault();
        onCreate();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, canWrite]);

  // v2 BONUS: CSV client export текущей выборки (vanilla — только Excel /export)
  const exportCsv = () => {
    if (!visible.length) { toast.warn('Список пуст'); return; }
    const head = ['№','Название','Проект','Сумма','Приоритет','Статус','Дата'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[;,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = visible.map((it) => [
      it.id, it.title || '', it.work_title || '', it.total_sum || 0,
      priorityInfo(it.priority).label, statusInfo(it.status).label, fmtDate(it.created_at)
    ].map(esc).join(';'));
    const csv = '﻿' + head.join(';') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tmc_requests_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('CSV скачан');
  };

  const summary = useMemo(() => {
    return {
      total: list.length,
      total_sum: list.reduce((s, i) => s + Number(i.total_sum || 0), 0),
      pending: list.filter((i) => i.status === 'submitted').length,
      delivered: list.filter((i) => ['delivered', 'closed'].includes(i.status)).length
    };
  }, [list]);

  const onOpen = (it) => modal.open(<TmcRequestModal id={it.id} onSaved={refresh} />, { size: 'xl' });

  const onCreate = () => {
    if (!canWrite) return toast.warn('Нет прав на создание');
    modal.open(<TmcRequestModal onSaved={refresh} />, { size: 'xl' });
  };

  const onStatusChange = (it, newStatus, requireReason) => {
    if (requireReason) {
      modal.open(
        <PromptModal
          title={'Сменить статус: ' + (statusInfo(newStatus).label)}
          placeholder="Причина / комментарий"
          required
          onConfirm={async (_reason) => {
            try {
              await setStatus(it.id, newStatus);
              toast.success('Статус обновлён');
              emitChanged();
              refresh();
            } catch (e) {
              toast.error('Не удалось: ' + (e?.message || e));
            }
          }}
        />
      );
    } else {
      modal.open(
        <ConfirmModal
          tone={newStatus === 'rejected' ? 'danger' : 'success'}
          title={'Сменить статус: ' + statusInfo(newStatus).label + '?'}
          message={`Заявка «${it.title}»`}
          confirmLabel="Подтвердить"
          onConfirm={async () => {
            try {
              await setStatus(it.id, newStatus);
              toast.success('Статус обновлён');
              emitChanged();
              refresh();
            } catch (e) {
              toast.error('Не удалось: ' + (e?.message || e));
            }
          }}
        />
      );
    }
  };

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Закупки"
        title="Заявки на ТМЦ"
        subtitle={`${summary.total} ${pluralize(summary.total, ['заявка', 'заявки', 'заявок'])} · ${fmtMoney(summary.total_sum)} · 📨 ${summary.pending} ожидают / 📦 ${summary.delivered} доставлено`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={() => openProtected('/api/tmc-requests/export', 'tmc_requests.xlsx').catch((e) => toast.error('Excel: ' + (e?.message || e)))}>📥 Excel</Btn>
            {/* v2 BONUS: density toggle + CSV-выборки (vanilla не имеет) */}
            <Btn variant="ghost" size="sm" onClick={() => setDensity((d) => d === 'compact' ? 'normal' : 'compact')} title="Плотность">
              {density === 'compact' ? '🔼' : '🔽'}
            </Btn>
            <Btn variant="ghost" onClick={exportCsv} title="CSV видимой выборки">📤 CSV</Btn>
            {canWrite && <Btn onClick={onCreate} title="(N)">+ Новая заявка</Btn>}
          </>
        }
      />

      <div data-searchbox="tmc" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(140px, 1fr) minmax(140px, 1fr)', gap: 8 }}>
        <SearchInput
          value={filters.search}
          onChange={(v) => setFilters({ ...filters, search: v })}
          placeholder="Поиск по названию, работе, ID… (/ для фокуса)"
        />
        <SelectInput
          value={filters.status}
          onChange={(v) => setFilters({ ...filters, status: v })}
          options={[{ value: '', label: 'Все статусы' }, ...STATUSES.map((s) => ({ value: s.value, label: s.label }))]}
        />
        <SelectInput
          value={filters.priority}
          onChange={(v) => setFilters({ ...filters, priority: v })}
          options={[{ value: '', label: 'Все приоритеты' }, ...PRIORITIES.map((p) => ({ value: p.value, label: p.label }))]}
        />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📦"
          title={filters.search || filters.status || filters.priority ? 'Ничего не нашли' : 'Заявок нет'}
          hint={canWrite ? 'Создайте первую через «+ Новая заявка»' : 'Заявки появятся, когда РП их создадут'}
        />
      ) : (
        <div className="card card-pad-overflow">
          {/* v2 BONUS: sticky thead + sortable columns + density (vanilla не имеет) */}
          <div className="ov-x-auto" style={{ maxHeight: '70vh' }}>
            <table className="sup-table" style={density === 'compact' ? { fontSize: 12, lineHeight: 1.25 } : undefined}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--card-bg)' }}>
                <tr>
                  <th className="w-60 cur-p" onClick={() => onSort('id')}>№{arrow('id')}</th>
                  <th className="cur-p" onClick={() => onSort('title')}>Название{arrow('title')}</th>
                  <th className="cur-p" onClick={() => onSort('work_title')}>Проект{arrow('work_title')}</th>
                  <th className="w-130 cur-p" onClick={() => onSort('total_sum')}>Сумма{arrow('total_sum')}</th>
                  <th className="w-100 cur-p" onClick={() => onSort('priority')}>Приоритет{arrow('priority')}</th>
                  <th className="w-130 cur-p" onClick={() => onSort('status')}>Статус{arrow('status')}</th>
                  <th className="w-110 cur-p" onClick={() => onSort('created_at')}>Дата{arrow('created_at')}</th>
                  <th className="w-280"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((it) => {
                  const st = statusInfo(it.status);
                  const pr = priorityInfo(it.priority);
                  return (
                    <tr key={it.id} onClick={() => onOpen(it)}>
                      <td style={{ color: 'var(--t-3)', fontFamily: 'ui-monospace, monospace' }}>#{it.id}</td>
                      <td><strong>{it.title || '—'}</strong></td>
                      <td className="c-t3">{it.work_title || '—'}</td>
                      <td className="t-right">{fmtMoney(it.total_sum)}</td>
                      <td style={{ color: pr.color, fontWeight: 600 }}>{pr.label}</td>
                      <td><StatusBadge tone={st.tone} label={st.label} /></td>
                      <td className="c-t3 fs-12">{fmtDate(it.created_at)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="u-flex gap-4 u-wrap">
                          <button
                            type="button"
                            className="m-btn ghost"
                            style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
                            onClick={() => openProtected(`/api/tmc-requests/${it.id}/excel`, `tmc_${it.id}.xlsx`).catch((e) => toast.error('Excel: ' + (e?.message || e)))}
                            title="Excel"
                          >📥</button>
                          {canApprove && it.status === 'submitted' && (
                            <>
                              <Btn size="sm" variant="primary" onClick={() => onStatusChange(it, 'approved')}>✓</Btn>
                              <Btn size="sm" variant="ghost"   onClick={() => onStatusChange(it, 'rejected', true)}>✗</Btn>
                            </>
                          )}
                          {canApprove && it.status === 'approved' && (
                            <Btn size="sm" onClick={() => onStatusChange(it, 'ordered')}>🛒 Заказан</Btn>
                          )}
                          {canApprove && it.status === 'ordered' && (
                            <Btn size="sm" onClick={() => onStatusChange(it, 'delivered')}>📦 Доставлен</Btn>
                          )}
                          {canApprove && it.status === 'delivered' && (
                            <Btn size="sm" variant="ghost" onClick={() => onStatusChange(it, 'closed')}>Закрыть</Btn>
                          )}
                        </div>
                      </td>
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

function pluralize(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
