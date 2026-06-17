/**
 * Страница /approvals — очередь согласования просчётов CRM 2.0.
 *
 * Источник vanilla: public/assets/js/approvals.js (~641 строка, AsgardApprovalsPage).
 *
 *   ✅ pages/Approvals/index.jsx                 ← root + state + фильтры + список
 *   ✅ pages/Approvals/api.js                    ← endpoints + helpers
 *   ✅ pages/Approvals/EstimateApprovalModal.jsx ← модалка с контекстом + 4 действия + лента комментариев
 *
 * Доступ: ADMIN, DIRECTOR_*, HEAD_TO (для просчётов с calculator_kind='to').
 * РП (PM) могут смотреть свои входящие согласования, но решений не принимают.
 *
 * Endpoints:
 *   GET  /api/estimates?status=sent
 *   POST /api/approval/estimates/:id/approve|rework|question|reject
 *   GET/POST /api/approval/estimates/:id/comments
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import { EstimateApprovalModal } from './EstimateApprovalModal';
import {
  loadEstimates, loadPms, loadAppSettings, loadQaCountsForEstimates,
  MODE_OPTIONS, statusMeta,
  fmtMoney, fmtDateTime, calcMargin, filterByQuery, filterByPm,
  getDirectorApprovalDueWorkdays, isOverdue
} from './api';
import './approvals.css';

const PAGE = 25;

export default function ApprovalsPage() {
  const { user } = useAuth();
  const modal = useModal();
  const _role = user?.role;
  // Эксплицитный список ролей — синхронно с vanilla approvals.js:3,221:
  // ADMIN + три директора + HEAD_TO. Inline-литералы нужны скрипту rbac-audit
  // (он не разворачивает имя массива в литералы и не видит startsWith('DIRECTOR')).
  const isAllowed = ['ADMIN', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);
  // Право принимать решения по очереди — только директоры/ADMIN (не HEAD_TO).
  const _canDecide = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  const [mode, setMode] = useState('sent');
  const [pmId, setPmId] = useState('all');
  const [q, setQ] = useState('');
  // Debounce поиска 300мс (G-11): без него filterByQuery дёргается на каждый символ.
  const dq = useDebounce(q, 300);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [pms, setPms] = useState([]);
  const [loading, setLoading] = useState(true);
  // SLA: /api/settings/app → sla.director_approval_due_workdays (default 5 рабочих дней).
  // Используется и для подсветки overdue-строк, и для бэйджа Просрочено в EstimateApprovalModal.
  const [dueWorkdays, setDueWorkdays] = useState(5);
  // QA: count qa_messages per estimate_id — батч одним запросом /api/data/qa_messages.
  const [qaCounts, setQaCounts] = useState({});

  const refresh = () => {
    setLoading(true);
    const tasks = [
      // mode='sent' → только sent; mode='all' → не фильтруем (но дальше сольём список из 4 статусов)
      mode === 'sent'
        ? loadEstimates({ status: 'sent', limit: 2000 })
        : Promise.all([
            loadEstimates({ status: 'sent',     limit: 2000 }),
            loadEstimates({ status: 'approved', limit: 2000 }),
            loadEstimates({ status: 'rework',   limit: 2000 }),
            loadEstimates({ status: 'question', limit: 2000 }),
            loadEstimates({ status: 'rejected', limit: 2000 })
          ]).then((arrays) => arrays.flat()),
      loadPms().then(setPms),
      loadAppSettings().then((s) => setDueWorkdays(getDirectorApprovalDueWorkdays(s)))
    ];
    Promise.all(tasks)
      .then(([list]) => {
        const safe = Array.isArray(list) ? list : [];
        setItems(safe);
        // Подтягиваем счётчики QA только для видимого списка id.
        const ids = safe.map((e) => e.id).filter((x) => x != null);
        return loadQaCountsForEstimates(ids).then(setQaCounts);
      })
      .catch((e) => toast('Ошибка загрузки', String(e?.message || e), 'err'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [mode]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:approvals:changed', onChanged);
    return () => window.removeEventListener('asgard:approvals:changed', onChanged);
    // eslint-disable-next-line
  }, [mode]);

  const visible = useMemo(() => {
    let v = items;
    v = filterByPm(v, pmId);
    v = filterByQuery(v, dq);
    // Сортировка: новейшие сверху
    v = [...v].sort((a, b) => {
      const ta = a.sent_for_approval_at || a.created_at || '';
      const tb = b.sent_for_approval_at || b.created_at || '';
      return String(tb).localeCompare(String(ta));
    });
    return v;
  }, [items, pmId, dq]);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = visible.slice((safePage - 1) * PAGE, safePage * PAGE);
  // Auto-reset page=1 при смене фильтров/режима (G-11): иначе page=5 + фильтр на 4 элемента = пустая страница.
  useEffect(() => { setPage(1); }, [mode, pmId, dq]);

  const pmOptions = useMemo(() => [
    { value: 'all', label: 'РП: все' },
    ...pms
      .filter((u) => !String(u.login || '').startsWith('test_') && u.login !== 'mimir_bot')
      .map((u) => ({ value: String(u.id), label: u.name || u.login }))
  ], [pms]);

  // Гейт «нет доступа» — ПОСЛЕ всех хуков (Rules of Hooks).
  if (!isAllowed) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 opacity-half mb-12">🔒</div>
        <div className="fs-16 fw-700 mb-6">Доступ закрыт</div>
        <div className="c-t3">
          Очередь согласования доступна только директорам, ADMIN и руководителю ТО.
        </div>
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <div className="appr-head">
        <div>
          <div className="appr-eyebrow">Слово Ярла</div>
          <h2 className="appr-title">Согласования</h2>
          <div className="appr-motto">
            Закон опирается на счёт. ✓ согласовать · 🔄 доработка · ❓ вопрос · ✗ отклонить.
          </div>
          <div className="appr-count">{visible.length} {visible.length === 1 ? 'просчёт' : 'просчётов'} в очереди</div>
        </div>
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={() => { setQ(''); setPmId('all'); setMode('sent'); }}>↺ Сбросить</Btn>
          <Btn onClick={refresh}>↻ Обновить</Btn>
        </div>
      </div>

      <div className="card appr-filters">
        <div style={{ flex: '1 1 280px', maxWidth: 420, minWidth: 220 }}>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Поиск: заказчик / тендер / РП / ID"
          />
        </div>
        <div className="min-w-220">
          <SelectInput value={mode} onChange={setMode} options={MODE_OPTIONS} />
        </div>
        <div className="min-w-220">
          <SelectInput value={pmId} onChange={setPmId} options={pmOptions} />
        </div>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем просчёты…
        </div>
      ) : visible.length === 0 ? (
        <div className="card p-40 t-center" >
          <div className="fs-48 opacity-half mb-12">📭</div>
          <div className="fs-16 fw-700 mb-6">В очереди пусто</div>
          <div className="c-t3">
            {mode === 'sent'
              ? 'Все отправленные на согласование просчёты решены.'
              : 'Нет просчётов под выбранные фильтры.'}
          </div>
        </div>
      ) : (
        <>
          <div className="appr-list">
            {slice.map((e) => (
              <ApprovalRow
                key={e.id}
                item={e}
                overdue={isOverdue(e, dueWorkdays)}
                qaCount={qaCounts[String(e.id)] || 0}
                onOpen={() => modal.open(<EstimateApprovalModal estimate={e} onChanged={refresh} />)}
              />
            ))}
          </div>

          {pages > 1 && (
            <div className="row-center gap-12">
              <Btn variant="ghost" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</Btn>
              <span className="c-t3 fs-13">
                {safePage} / {pages} · {visible.length} шт.
              </span>
              <Btn variant="ghost" disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ApprovalRow({ item, onOpen, overdue = false, qaCount = 0 }) {
  const meta = statusMeta(item.approval_status);
  const margin = calcMargin(item.price_tkp, item.cost_plan);
  // .row--overdue + .appr-row--overdue: первый класс — глобальный селектор по спецификации D-18,
  // второй — локальный (контекстный для CSS-модулей страницы). Оба применяют красную заливку
  // фона + 3px бордер слева (var(--err-bg) / var(--err)).
  const rowCls = `appr-row${overdue ? ' appr-row--overdue row--overdue' : ''}`;
  return (
    <div
      className={rowCls}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
      role="button"
      tabIndex={0}
      aria-label={`Просчёт ${item.title || item.tender_title || item.id}${overdue ? ' (просрочено)' : ''} — открыть`}
    >
      <div className="appr-row-left">
        <div className="appr-row-customer">{item.customer || item.customer_name || '—'}</div>
        <div className="appr-row-title">{item.title || item.tender_title || `Просчёт #${item.id}`}</div>
        <div className="appr-row-meta">
          <span>v{item.version_no ?? item.current_version_no ?? 1}</span>
          <span>·</span>
          <span>РП: <b>{item.pm_name || '—'}</b></span>
          {item.sent_for_approval_at && (
            <>
              <span>·</span>
              <span>отправлено: {fmtDateTime(item.sent_for_approval_at)}</span>
            </>
          )}
          {overdue && (
            <>
              <span>·</span>
              <span className="appr-row-overdue-tag" aria-label="просрочено">⏰ Просрочено</span>
            </>
          )}
          {qaCount > 0 && (
            <>
              <span>·</span>
              <span className="appr-row-qa-badge" aria-label={`Вопросов и ответов: ${qaCount}`}>
                ❓ {qaCount}
              </span>
            </>
          )}
          {Number.isFinite(item.comments_count) && item.comments_count > 0 && (
            <>
              <span>·</span>
              <span>💬 {item.comments_count}</span>
            </>
          )}
        </div>
      </div>

      <div className="appr-row-kpi">
        <div className="appr-row-kpi-cell">
          <div className="appr-row-kpi-lab">Цена</div>
          <div className="appr-row-kpi-val gold">{fmtMoney(item.price_tkp)}</div>
        </div>
        <div className="appr-row-kpi-cell">
          <div className="appr-row-kpi-lab">Себест.</div>
          <div className="appr-row-kpi-val">{fmtMoney(item.cost_plan)}</div>
        </div>
        <div className="appr-row-kpi-cell">
          <div className="appr-row-kpi-lab">Маржа</div>
          <div
            className="appr-row-kpi-val"
            style={{ color: margin === null ? 'var(--t-3)' : margin < 10 ? 'var(--err)' : margin < 20 ? 'var(--amber)' : 'var(--ok)' }}
          >
            {margin === null ? '—' : `${margin}%`}
          </div>
        </div>
      </div>

      <div className="appr-row-right">
        <Pill tone={meta.tone}>{meta.label}</Pill>
        <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          Открыть →
        </Btn>
      </div>
    </div>
  );
}
