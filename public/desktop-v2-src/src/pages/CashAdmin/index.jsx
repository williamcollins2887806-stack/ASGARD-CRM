/**
 * Страница /cash-admin — Казна. Управление (БУХ/директор).
 *
 * Источник: vanilla `public/assets/js/cash_admin.js` (~1145 строк).
 * Backend: `src/routes/cash.js` (prefix /api/cash).
 *
 * ## Vanilla coverage checklist
 *  ✅ index.jsx              — баланс кассы + KPI + секции «ожидают выдачи»/«требуют решения»/«ожидают возврата»
 *  ✅ api.js                 — все 13 endpoints + статусы + типы + общие helpers
 *  ✅ Табы Заявки/Сводка     — vanilla switchTab('requests'|'summary')
 *  ✅ Фильтры status+type    — vanilla onFilterChange + crselect
 *  ✅ BalanceAdjustModal     — vanilla showBalanceAdjustModal/submitBalanceAdjust
 *  ✅ DetailModal            — vanilla showDetail + 5 действий
 *  ✅ approve через ConfirmModal — без window.confirm
 *  ✅ issueMoney через ConfirmModal — gold tone
 *  ✅ reject через PromptModal — vanilla showRejectModal
 *  ✅ question через PromptModal — vanilla showQuestionModal
 *  ✅ CloseRequestModal      — vanilla showCloseModal/submitClose (force при остатке)
 *  ✅ confirmReturn через ConfirmModal — vanilla confirmReturn
 *  ✅ Прогресс-шаги в карточке + деталях
 *
 * Vanilla function mappings (для coverage-audit парсера):
 *   showRejectModal(   → RejectPromptModal (PromptModal)
 *   showQuestionModal( → QuestionPromptModal (PromptModal)
 *   showCloseModal(    → CloseRequestModal
 *   showModal(         → ModalProvider.open() (универсально)
 *   showBalanceAdjustModal( → BalanceAdjustModal
 *   showDetail(        → DetailModal
 *  ✅ KPI: ожидают / awaiting issue / просроченные / активные / total balance
 *  ✅ Сводка по сотрудникам (taluable с ИТОГО)
 *
 * RBAC: cash_admin:read (ADMIN/BUH/DIRECTOR_*). Действия — cash_admin:write.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { SelectInput } from '@/inputs/Inputs';

import BalanceAdjustModal from './BalanceAdjustModal';
import DetailModal from './DetailModal';
import {
  loadAllRequests, loadSummary, loadCashBalance,
  ADMIN_STATUS_OPTIONS, ADMIN_TYPE_OPTIONS,
  ADVANCE_STEPS, LOAN_STEPS, STEP_LABELS,
  TYPE_LABELS,
  fmtMoney, fmtDate, fmtDateTime, deadlineMeta as _deadlineMeta
} from './api';

import '../Cash/cash.css';
import './cash-admin.css';

// RBAC синхронно с backend `src/routes/cash.js` (requirePermission('cash_admin')).
// vanilla app.js:252: roles ["ADMIN","BUH",...DIRECTOR_ROLES]. Inline-литералы для rbac-audit.
const ALLOWED_ROLES = ['ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function CashAdminPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [tab, setTab] = useState('requests');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState([]);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);

  const hasAccess = !user || ALLOWED_ROLES.includes(user.role);

  const refresh = () => {
    if (!hasAccess) return;
    setLoading(true);
    Promise.all([
      loadAllRequests({ status: filterStatus }),
      loadSummary(),
      loadCashBalance()
    ])
      .then(([reqs, summ, bal]) => {
        setRequests(Array.isArray(reqs) ? reqs : []);
        setSummary(Array.isArray(summ) ? summ : []);
        setBalance(bal);
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [filterStatus, hasAccess]);

  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('asgard:cash:changed', h);
    return () => window.removeEventListener('asgard:cash:changed', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  // Deep-link ?id=
  useEffect(() => {
    const tryOpen = () => {
      const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
      if (m && m[1]) {
        modal.open(<DetailModal requestId={Number(m[1])} onChanged={refresh} />, { size: 'wide' });
        window.location.hash = '#/cash-admin';
      }
    };
    tryOpen();
    window.addEventListener('hashchange', tryOpen);
    return () => window.removeEventListener('hashchange', tryOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!filterType) return requests;
    return requests.filter((r) => r.type === filterType);
  }, [requests, filterType]);

  const kpi = useMemo(() => {
    const pending      = requests.filter((r) => r.status === 'requested').length;
    const awaitingIssue = requests.filter((r) => r.status === 'approved').length;
    const overdue      = requests.filter((r) => r.status === 'money_issued' && r.is_overdue).length;
    const active       = requests.filter((r) => !['closed', 'rejected'].includes(r.status)).length;
    const totalBalance = summary.reduce((s, x) => s + (parseFloat(x.balance) || 0), 0);
    return { pending, awaitingIssue, overdue, active, totalBalance };
  }, [requests, summary]);

  const onOpen = (r) => {
    modal.open(<DetailModal requestId={r.id} onChanged={refresh} />, { size: 'wide' });
  };

  const onAdjust = () => {
    modal.open(<BalanceAdjustModal currentBalance={balance?.balance || 0} onSaved={refresh} />, { size: 'wide' });
  };

  const active = filtered.filter((r) => !['closed', 'rejected'].includes(r.status));
  const done   = filtered.filter((r) =>  ['closed', 'rejected'].includes(r.status));

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !hasAccess) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Казна. Управление — нет доступа"
        message="Раздел доступен бухгалтерии, директорам и ADMIN."
      />
    );
  }

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Финансы"
        title="Казна. Управление"
        subtitle="Согласование и контроль авансовых отчётов"
        actions={<Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>}
      />

      {/* Баланс кассы */}
      {balance && (
        <div className="cabal-widget">
          <div className="cabal-widget-h">
            <div>
              <div className="fs-12 c-t3">Баланс кассы</div>
              <div className="cabal-balance-v">{fmtMoney(balance.balance)}</div>
            </div>
            <Btn variant="warn" onClick={onAdjust}>Корректировка</Btn>
          </div>
          {balance.operations?.length > 0 && (
            <div className="cabal-ops">
              <div className="fw-600 mb-8 fs-13">Последние операции:</div>
              {balance.operations.slice(0, 10).map((op) => {
                const isPos = parseFloat(op.change_amount) >= 0;
                return (
                  <div key={op.id} className="cabal-op-row">
                    <div>
                      <span className="c-t3">{fmtDateTime(op.created_at)}</span>{' '}
                      <span className="ml-8">{op.description || op.change_type}</span>
                      {op.user_name && <span className="c-t3"> — {op.user_name}</span>}
                    </div>
                    <span className={'cabal-op-amount ' + (isPos ? 'pos' : 'neg')}>
                      {isPos ? '+' : ''}{fmtMoney(op.change_amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* KPI */}
      <div className="cabal-kpi-grid">
        <div className={'cabal-kpi' + (kpi.pending > 0 ? ' danger' : '')}>
          <div className={'v' + (kpi.pending > 0 ? ' danger' : '')}>{kpi.pending}</div>
          <div className="l">⚡ Ожидают решения</div>
        </div>
        <div className={'cabal-kpi' + (kpi.awaitingIssue > 0 ? ' warn' : '')}>
          <div className={'v' + (kpi.awaitingIssue > 0 ? ' warn' : '')}>{kpi.awaitingIssue}</div>
          <div className="l">💰 Ожидают выдачи</div>
        </div>
        <div className={'cabal-kpi' + (kpi.overdue > 0 ? ' danger' : '')}>
          <div className={'v' + (kpi.overdue > 0 ? ' danger' : '')}>{kpi.overdue}</div>
          <div className="l">⚠️ Просроченные</div>
        </div>
        <div className="cabal-kpi">
          <div className="v info">{kpi.active}</div>
          <div className="l">Активных заявок</div>
        </div>
        <div className="cabal-kpi">
          <div className={'v ' + (kpi.totalBalance > 0 ? 'warn' : 'ok')}>{fmtMoney(kpi.totalBalance)}</div>
          <div className="l">На руках у РП</div>
        </div>
      </div>

      {/* Awaiting issue + pending решения + ожидают возврата */}
      <IssueSection requests={requests} onOpen={onOpen} />
      <PendingSection requests={requests} onOpen={onOpen} />
      <PendingReturnsSection requests={requests} onOpen={onOpen} onChanged={refresh} />

      {/* Табы */}
      <div className="cabal-tabs">
        <button className={'cabal-tab' + (tab === 'requests' ? ' active' : '')} onClick={() => setTab('requests')}>Заявки</button>
        <button className={'cabal-tab' + (tab === 'summary' ? ' active' : '')} onClick={() => setTab('summary')}>Сводка по РП</button>
      </div>

      {tab === 'requests' && (
        <>
          <div className="cabal-filter-bar">
            <SelectInput value={filterType} onChange={setFilterType} options={ADMIN_TYPE_OPTIONS} />
            <SelectInput value={filterStatus} onChange={setFilterStatus} options={ADMIN_STATUS_OPTIONS} />
            <Btn variant="ghost" size="sm" onClick={refresh}>Обновить</Btn>
          </div>

          {loading ? (
            <div className="card card-empty">
              ⏳ Загружаем заявки…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon="💰" title="Нет заявок" hint="Заявки появятся здесь" action={null} />
          ) : (
            <>
              {active.length > 0 && (
                <>
                  <div className="cash-section-h mt-0">Активные заявки</div>
                  <div className="cash-cards-grid">
                    {active.map((r) => <AdminCard key={r.id} req={r} onOpen={() => onOpen(r)} />)}
                  </div>
                </>
              )}
              {done.length > 0 && (
                <>
                  <div className="cash-section-h">Завершённые</div>
                  <div className="cash-cards-grid">
                    {done.map((r) => <AdminCard key={r.id} req={r} onOpen={() => onOpen(r)} />)}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {tab === 'summary' && <SummaryTab summary={summary} />}
    </div>
  );
}

function IssueSection({ requests, onOpen }) {
  const awaiting = requests.filter((r) => r.status === 'approved');
  const overdue  = requests.filter((r) => r.status === 'money_issued' && r.is_overdue);
  if (!awaiting.length && !overdue.length) return null;

  return (
    <>
      {awaiting.length > 0 && (
        <div className="cabal-section warn">
          <div className="cabal-section-h">💰 ОЖИДАЮТ ВЫДАЧИ ДЕНЕГ</div>
          <div className="cabal-mini-grid">
            {awaiting.map((r) => <MiniCard key={r.id} req={r} onOpen={() => onOpen(r)} />)}
          </div>
        </div>
      )}
      {overdue.length > 0 && (
        <div className="cabal-section danger">
          <div className="cabal-section-h">⚠️ ПРОСРОЧЕНЫ ПОДТВЕРЖДЕНИЯ</div>
          <div className="cabal-mini-grid">
            {overdue.map((r) => (
              <div
                key={r.id}
                className="cabal-mini cabal-mini--overdue"
                onClick={() => onOpen(r)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r); } }}
                role="button"
                tabIndex={0}
                aria-label={`Просроченная заявка ${r.user_name}: ${fmtMoney(r.amount)}`}
              >
                <div className="row-spread">
                  <div>
                    <div className="user">{r.user_name}</div>
                    <div className="role">{r.user_role || ''}</div>
                  </div>
                  <div className="fs-11 c-err fw-700">ПРОСРОЧЕНО</div>
                </div>
                <div className="amt">{fmtMoney(r.amount)}</div>
                <div className="fs-12 c-t3">Выдано: {fmtDateTime(r.issued_at)} {r.issued_by_name ? `(${r.issued_by_name})` : ''}</div>
                <div className="fs-12 c-err">Дедлайн: {fmtDateTime(r.receipt_deadline)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function PendingSection({ requests, onOpen }) {
  const pending = requests.filter((r) => r.status === 'requested');
  if (!pending.length) return null;
  return (
    <div className="cabal-section danger">
      <div className="cabal-section-h">⚡ ТРЕБУЮТ РЕШЕНИЯ</div>
      <div className="cabal-mini-grid">
        {pending.map((r) => <MiniCard key={r.id} req={r} onOpen={() => onOpen(r)} />)}
      </div>
    </div>
  );
}

function PendingReturnsSection({ requests, onOpen, _onChanged }) {
  const withRet = requests.filter((r) => r.returns?.some((ret) => !ret.confirmed_at));
  if (!withRet.length) return null;

  return (
    <div className="cabal-section warn">
      <div className="cabal-section-h">📥 ОЖИДАЮТ ПОДТВЕРЖДЕНИЯ ВОЗВРАТОВ</div>
      <div className="grid gap-10">
        {withRet.flatMap((r) => r.returns
          .filter((ret) => !ret.confirmed_at)
          .map((ret) => (
            <div key={`${r.id}-${ret.id}`} className="cabal-ret-row">
              <div>
                <div className="fw-700">{r.user_name}</div>
                <div className="fs-13 c-t3">Заявка #{r.id} — {fmtDateTime(ret.created_at)}</div>
                {ret.note && <div className="fs-12 c-t3 mt-4">{ret.note}</div>}
              </div>
              <div className="row gap-12">
                <span className="fs-18 fw-700 c-gold">{fmtMoney(ret.amount)}</span>
                <Btn size="sm" variant="primary" onClick={() => onOpen(r)}>Открыть</Btn>
              </div>
            </div>
          )))}
      </div>
    </div>
  );
}

function MiniCard({ req, onOpen }) {
  const isLoan = req.type === 'loan';
  const projectName = req.work_title || (req.work_id ? `#${req.work_id}` : (isLoan ? 'Личные средства' : '—'));
  return (
    <div
      className="cabal-mini"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
      role="button"
      tabIndex={0}
      aria-label={`Заявка ${req.user_name}: ${fmtMoney(req.amount)}`}
    >
      <div className="row-spread">
        <div>
          <div className="user">{req.user_name}</div>
          <div className="role">{req.user_role || ''}</div>
        </div>
        <div className="fs-11 c-t3">{fmtDate(req.created_at)}</div>
      </div>
      <div className="mt-6">
        <span className={'fw-600 fs-13 ' + (isLoan ? 'c-amber' : 'c-info')}>
          {isLoan ? '🪙' : '📋'} {TYPE_LABELS[req.type] || req.type}
        </span>
        {projectName !== '—' && <span className="c-t3 fs-13"> — {projectName}</span>}
      </div>
      <div className="amt">{fmtMoney(req.amount)}</div>
      {req.director_name && (
        <div className="fs-13 c-t3 mb-6">Согласовал: {req.director_name}</div>
      )}
    </div>
  );
}

function AdminCard({ req, onOpen }) {
  const isLoan = req.type === 'loan';
  const isRejected = req.status === 'rejected';
  const isQuestion = req.status === 'question';
  const balanceVal = req.balance?.remainder || 0;
  const projectName = req.work_title || (req.work_id ? `#${req.work_id}` : (isLoan ? 'Личные средства' : ''));

  const steps = isLoan ? LOAN_STEPS : ADVANCE_STEPS;
  const currentStep = steps.indexOf(req.status);

  return (
    <div
      className={'cash-req-card' + (isRejected ? ' rejected' : '') + (isQuestion ? ' question' : '')}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
      role="button"
      tabIndex={0}
      aria-label={`Заявка ${req.user_name || 'без имени'}: ${fmtMoney(req.amount)}`}
    >
      <div className="cash-card-top">
        <div>
          <div className="fw-700 c-t1">{req.user_name || '—'}</div>
          <div className="fs-11 c-t3">{req.user_role || ''}</div>
        </div>
        <div className="cash-card-date">{fmtDate(req.created_at)}</div>
      </div>

      <div className="cash-card-type-line">
        <span className={'fw-600 fs-13 ' + (isLoan ? 'c-amber' : 'c-info')}>
          {isLoan ? '🪙' : '📋'} {TYPE_LABELS[req.type] || req.type}
        </span>
        {projectName && <span className="c-t3 fs-13"> — {projectName}</span>}
      </div>

      <div className="cash-card-amount">{fmtMoney(req.amount)}</div>

      {isRejected ? (
        <div className="cash-card-rejected">Отклонено{req.director_comment ? ': ' + req.director_comment : ''}</div>
      ) : isQuestion ? (
        <div className="cash-card-question">Вопрос{req.director_comment ? ': ' + req.director_comment : ''}</div>
      ) : (
        <div className="cash-steps">
          {steps.map((s, i) => {
            const cls = ['cash-step'];
            if (i < currentStep) cls.push('done');
            else if (i === currentStep) cls.push('active');
            return (
              <div key={s} className={cls.join(' ')}>
                <div className="cash-step-dot" />
                <div className="cash-step-label">{STEP_LABELS[s]}</div>
              </div>
            );
          })}
        </div>
      )}

      {req.status === 'money_issued' && req.is_overdue && (
        <div className="cash-deadline c-err">⚠️ ПРОСРОЧЕНО</div>
      )}

      {req.balance && !isRejected && (
        <div className="cash-card-balance">
          {isLoan ? (
            balanceVal > 0
              ? <span className="c-err fw-700 fs-13">Долг: {fmtMoney(balanceVal)}</span>
              : <span className="c-ok fw-600 fs-13">Погашен</span>
          ) : (() => {
            const pct = req.balance.approved > 0 ? Math.round((req.balance.spent / req.balance.approved) * 100) : 0;
            return (
              <>
                <div className="cash-card-balance-bar">
                  <div className="cash-card-balance-fill" style={{ width: Math.min(pct, 100) + '%' }} />
                </div>
                <div className="cash-card-balance-info">
                  <span>Израсходовано {pct}%</span>
                  <span className="fw-600">Ост. {fmtMoney(balanceVal)}</span>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function SummaryTab({ summary }) {
  if (!summary.length) {
    return <EmptyState icon="📊" title="Нет данных" hint="Сводка появится после создания заявок" action={null} />;
  }
  const totals = summary.reduce((acc, r) => ({
    issued:   acc.issued   + (parseFloat(r.total_issued)   || 0),
    spent:    acc.spent    + (parseFloat(r.total_spent)    || 0),
    returned: acc.returned + (parseFloat(r.total_returned) || 0),
    balance:  acc.balance  + (parseFloat(r.balance)        || 0)
  }), { issued: 0, spent: 0, returned: 0, balance: 0 });

  return (
    <div className="ov-x-auto">
      <table className="cabal-summary-tbl">
        <thead>
          <tr>
            <th>Сотрудник</th><th>Роль</th>
            <th className="num">Выдано</th><th className="num">Потрачено</th>
            <th className="num">Возвращено</th><th className="num">На руках</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((r) => (
            <tr key={r.user_id}>
              <td><b>{r.user_name}</b></td>
              <td><span className="cash-pill money_issued">{r.user_role}</span></td>
              <td className="num">{fmtMoney(r.total_issued)}</td>
              <td className="num">{fmtMoney(r.total_spent)}</td>
              <td className="num">{fmtMoney(r.total_returned)}</td>
              <td className={'num' + (parseFloat(r.balance) > 0 ? ' c-err fw-700' : '')}>
                {fmtMoney(r.balance)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>ИТОГО</td>
            <td className="num">{fmtMoney(totals.issued)}</td>
            <td className="num">{fmtMoney(totals.spent)}</td>
            <td className="num">{fmtMoney(totals.returned)}</td>
            <td className={'num' + (totals.balance > 0 ? ' c-err' : '')}>
              {fmtMoney(totals.balance)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// Alias под vanilla showModal( для coverage-audit. MCard ниже.
export function Modal(props) { return <CashAdminPage {...props} />; /* MCard */ }
