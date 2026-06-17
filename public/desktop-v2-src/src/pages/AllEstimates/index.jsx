/**
 * Страница /all-estimates — Свод Расчётов (CRM 2.0).
 *
 * Простое согласование: РП → директор (4 действия) → готово.
 * Без бухгалтерии, без оплаты. Просчёт — это калькуляция.
 *
 * Источник: vanilla `public/assets/js/all_estimates.js` (~301 строк).
 *
 *   ✅ pages/AllEstimates/index.jsx              ← state + layout + урл-параметр ?id=
 *   ✅ pages/AllEstimates/api.js                 ← endpoints + helpers
 *   ✅ pages/AllEstimates/EstimateFilter.jsx     ← фильтры
 *   ✅ pages/AllEstimates/EstimatesList.jsx      ← таблица + сортировка + пагинация
 *   ✅ pages/AllEstimates/EstimateRow.jsx        ← строка
 *   ✅ pages/AllEstimates/modals/EstimateDetail.jsx ← карточка + действия согласования
 *
 * Действия директора (POST /api/approval/estimates/:id/{approve,rework,question,reject}):
 *   ✓ Согласовать — без комментария
 *   ↻ Доработка / ❓ Вопрос / ✕ Отклонить — с комментарием через PromptModal
 *   📤 Отправить повторно (POST /api/approval/estimates/:id/resubmit) — для PM при rework/question
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';

import EstimateFilter from './EstimateFilter';
import EstimatesList from './EstimatesList';
import { EstimateDetailModal } from './modals/EstimateDetail';
import {
  loadEstimates, loadUsers,
  filterByPeriod, filterByQuery, filterByMatch
} from './api';

export default function AllEstimatesPage() {
  const { user: _user } = useAuth();
  const modal = useModal();

  const [filters, setFilters] = useState({ q: '', period: 'all', pm: '', status: '' });
  const [sort, setSort] = useState({ key: 'sent_for_approval_at', dir: -1 });
  const [estimates, setEstimates] = useState([]);
  const [pms, setPms] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      loadEstimates({ limit: 2000 }),
      loadUsers()
    ])
      .then(([list, users]) => {
        setEstimates(list);
        // фильтруем по ролям, способным быть РП
        const pmRoles = new Set(['PM', 'HEAD_PM']);
        setPms(users.filter((u) => pmRoles.has(u.role) && u.is_active !== false));
      })
      .catch((e) => toast.error(`Не удалось загрузить просчёты: ${e?.message || e}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:estimates:changed', onChanged);
    return () => window.removeEventListener('asgard:estimates:changed', onChanged);
  }, []);

  // Открыть просчёт по ?id= в URL (deep-link)
  useEffect(() => {
    if (loading || !estimates.length) return;
    const hash = String(window.location.hash || '');
    const i = hash.indexOf('?');
    if (i < 0) return;
    const params = new URLSearchParams(hash.slice(i + 1));
    const id = Number(params.get('id'));
    if (id > 0) {
      const found = estimates.find((e) => e.id === id);
      if (found) {
        modal.open(<EstimateDetailModal estimate={found} onChanged={refresh} />);
        // Чистим параметр, чтобы при возврате не открывалось второй раз
        const clean = hash.slice(0, i);
        window.history.replaceState(null, '', clean);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const visible = useMemo(() => {
    let v = estimates;
    v = filterByPeriod(v, filters.period);
    v = filterByQuery(v, filters.q);
    v = filterByMatch(v, 'approval_status', filters.status);
    if (filters.pm) v = v.filter((e) => String(e.pm_id) === filters.pm);
    return v;
  }, [estimates, filters]);

  const counts = useMemo(() => {
    return estimates.reduce(
      (acc, e) => {
        if (e.approval_status === 'sent') acc.sent++;
        if (e.approval_status === 'approved') acc.approved++;
        return acc;
      },
      { sent: 0, approved: 0 }
    );
  }, [estimates]);

  const onOpen = (estimate) =>
    modal.open(<EstimateDetailModal estimate={estimate} onChanged={refresh} />);
  const onResetFilters = () => setFilters({ q: '', period: 'all', pm: '', status: '' });

  // v2 BONUS: KPI-чипы для быстрой фильтрации по approval_status (vanilla только текстовая подпись) — клик = фильтр
  const kpiChip = (label, status, count, tone) => (
    <button
      key={label}
      className="btn-ghost"
      onClick={() => setFilters((f) => ({ ...f, status: f.status === status ? '' : status }))}
      style={{
        padding: '6px 10px',
        background: filters.status === status ? 'var(--gold-bg)' : 'var(--inner-bg)',
        border: filters.status === status ? `1px solid ${tone}` : '1px solid var(--brd-2)',
        borderRadius: 'var(--r-sm)',
        fontSize: 12.5,
        cursor: 'pointer'
      }}
    >
      {label} <strong>{count}</strong>
    </button>
  );

  // v2 BONUS: hotkeys / для фокуса поиска, Esc сброс
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.querySelector('input[data-searchbox="estimates"]')?.focus();
      } else if (e.key === 'Escape' && (filters.q || filters.status || filters.pm)) {
        onResetFilters();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.status, filters.pm]);

  const totals = useMemo(() => {
    const total = visible.reduce((s, e) => s + Number(e.price_tkp || 0), 0);
    return { total };
  }, [visible]);

  const subtitle =
    `${visible.length} ${pluralize(visible.length, ['просчёт', 'просчёта', 'просчётов'])} · ` +
    `на согласовании ${counts.sent} · согласовано ${counts.approved} · ` +
    `сумма ${fmtRub(totals.total)}`;

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Раздел"
        title="Свод Расчётов"
        subtitle={subtitle}
        actions={
          <>
            <Btn variant="ghost" onClick={onResetFilters}>↺ Сбросить</Btn>
            <Btn
              variant="ghost"
              onClick={() => { window.location.hash = '#/approvals'; }}
            >
              📥 Очередь согласований
            </Btn>
          </>
        }
      />

      {/* v2 BONUS: KPI-чипы быстрой фильтрации по статусу (vanilla не имеет drill-down) */}
      <div className="u-flex gap-8 u-wrap">
        {kpiChip('📤 Отправлено', 'sent', counts.sent, 'var(--blue)')}
        {kpiChip('✓ Согласовано', 'approved', counts.approved, 'var(--ok)')}
      </div>

      <EstimateFilter filters={filters} onChange={setFilters} pms={pms} />

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем просчёты…
        </div>
      ) : (
        <EstimatesList
          estimates={visible}
          onOpen={onOpen}
          sort={sort}
          onSortChange={(key) =>
            setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))
          }
          vatPct={22}
        />
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

function fmtRub(n) {
  if (!Number.isFinite(+n) || n === 0) return '0 ₽';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн ₽';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + ' тыс. ₽';
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}
