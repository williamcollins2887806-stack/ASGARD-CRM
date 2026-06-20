/**
 * Timesheet v2 — Dashboard (Phase 1E + Stage S, 2026-06-20).
 *
 * Переработан: компактнее и понятнее. Старые 5 KPI-карточек (где Возврат всегда 0
 * и Баланс дублировал «Из кассы») заменены на:
 *   1) Шапка-чипы: рабочих/чел-дней/типы выплат
 *   2) Большая карточка «Заработали» (+ премии/штрафы)
 *   3) Две колонки: «На карту (банк)» + «Из кассы (нал)»
 *      (со подстрокой «Осталось …» когда уже есть выплаты в поле)
 *   4) Stage S — «📤 Уже выплачено в поле» (показывается ТОЛЬКО если total_paid_total > 0)
 *   5) Карточка «🏦 КАССА — хватит ли нала на ЗП?»
 *   6) Компактные лимиты СЗ (мес+год)
 *
 * Phase 1E добавляет fetch `GET /api/payroll-dashboard/cash-coverage/:y/:m`.
 *
 * Props:
 *   summary: { ... }           — из /api/timesheet/v2/:y/:m
 *   cashCoverage: { ... }|null — из /cash-coverage/:y/:m (передаётся из index.jsx)
 *   employees: [...]           — из /api/timesheet/v2/:y/:m (для разбивки paid_breakdown)
 *
 * Если summary == null — компонент возвращает null.
 */
import { fmtMoney, fmtNum } from './api';

export default function Dashboard({ summary, cashCoverage, employees = [] }) {
  if (summary == null) return null;

  const byType = summary.by_type || { self_employed: 0, official: 0, cash: 0 };
  const limits = summary.limits || {};

  const totalBonus   = Number(summary.total_bonus   || 0);
  const totalPenalty = Number(summary.total_penalty || 0);

  /* Stage S — суммы уже выплаченных в поле */
  const paidCash     = Number(summary.total_paid_cash     || 0);
  const paidTransfer = Number(summary.total_paid_transfer || 0);
  const paidTotal    = Number(summary.total_paid_total    || 0);
  const cashNeededRemaining = Number(summary.total_cash_needed_remaining || 0);
  const transferRemaining   = Number(summary.total_transfer_remaining    || 0);

  /* ─── Лимиты СЗ ─── */
  const monthCapacity =
    Number(limits.total_monthly_capacity) ||
    (Number(limits.monthly) * Number(limits.se_count || byType.self_employed || 0)) ||
    Number(limits.monthly) || 0;
  const yearCapacity =
    Number(limits.total_yearly_capacity) ||
    (Number(limits.yearly) * Number(limits.se_count || byType.self_employed || 0)) ||
    Number(limits.yearly) || 0;

  const monthRemaining = limits.month_remaining_company != null
    ? Number(limits.month_remaining_company)
    : Math.max(0, monthCapacity - Number(limits.month_used_company || 0));
  const yearRemaining = limits.year_remaining_company != null
    ? Number(limits.year_remaining_company)
    : Math.max(0, yearCapacity - Number(limits.year_used_company || 0));

  const haveLimits = monthCapacity > 0 || yearCapacity > 0;

  return (
    <div className="ts-dashboard ts-dashboard--v2">
      {/* 1) Шапка-чипы */}
      <div className="ts-dash-headrow">
        <Chip className="ts-dash-chip--bold">👥 {fmtNum(summary.employees_count || 0)} раб</Chip>
        {summary.days_total != null && (
          <Chip className="ts-dash-chip--mute">📅 {fmtNum(summary.days_total)} дн</Chip>
        )}
        <span className="ts-dash-dot">·</span>
        <Chip dot="green">СЗ: {fmtNum(byType.self_employed)}</Chip>
        <Chip dot="blue">Оф: {fmtNum(byType.official)}</Chip>
        <Chip dot="grey">Нал: {fmtNum(byType.cash)}</Chip>
      </div>

      {/* 2) Большая карточка «Заработали» */}
      <div className="ts-dash-earned-big">
        <div className="ts-dash-earned-label">Σ Заработано за месяц</div>
        <div className="ts-dash-earned-value">{fmtMoney(summary.total_earned)}</div>
        {(totalBonus > 0 || totalPenalty > 0) && (
          <div className="ts-dash-earned-sub">
            <span className="ts-dash-sub-inclnote">в т.ч.:</span>
            {totalBonus > 0 && (
              <span className="ts-dash-sub-bonus" title="Премии за месяц (уже включены в Σ Заработано)">{fmtMoney(totalBonus)} премий</span>
            )}
            {totalPenalty > 0 && (
              <span className="ts-dash-sub-penalty" title="Штрафы (уже вычтены из Σ Заработано)">{fmtMoney(totalPenalty)} штрафов вычтено</span>
            )}
          </div>
        )}
      </div>

      {/* 3) 2 колонки: На карту + Из кассы */}
      <div className="ts-dash-split">
        <SplitCard
          color="blue"
          icon="💳"
          label="На карту (банк)"
          value={summary.total_transfer}
          hint="СЗ через банк + оф оклады"
          remainingValue={paidTransfer > 0 ? transferRemaining : null}
        />
        <SplitCard
          color="orange"
          icon="💵"
          label="Из кассы (нал)"
          value={summary.total_cash_payout}
          hint="Доплаты нал-рабочим"
          remainingValue={paidCash > 0 ? cashNeededRemaining : null}
        />
      </div>

      {/* Stage S — Уже выплачено в поле (рендер только если есть выплаты) */}
      {paidTotal > 0 && (
        <PaidInFieldCard summary={summary} employees={employees} />
      )}

      {/* Stage U — 🏢 Официально устроены (рендер только если есть оф-сотрудники) */}
      {Number(summary.total_official_count || 0) > 0 && (
        <OfficialEmploymentCard summary={summary} />
      )}

      {/* 4) Касса — хватает ли нала на ЗП */}
      {cashCoverage && <CashCoverageCard data={cashCoverage} />}

      {/* 5) Компактные лимиты СЗ */}
      {haveLimits && (
        <div className="ts-dash-limits-card">
          <div className="ts-dash-limits-title">🟢 Лимиты СЗ — не исчерпаны?</div>
          {monthCapacity > 0 && (
            <LimitRow
              label="Мес"
              remaining={monthRemaining}
              capacity={monthCapacity}
            />
          )}
          {yearCapacity > 0 && (
            <LimitRow
              label="Год"
              remaining={yearRemaining}
              capacity={yearCapacity}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ Sub-компоненты ═══════════════════ */

function Chip({ children, dot, className = '' }) {
  return (
    <span className={`ts-dash-chip ${dot ? `ts-dash-chip--dot-${dot}` : ''} ${className}`}>
      {dot && <span className="ts-dash-chip-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

function SplitCard({ color, icon, label, value, hint, remainingValue }) {
  return (
    <div className={`ts-dash-split-card ts-dash-split-card--${color}`}>
      <div className="ts-dash-split-label">
        <span className="ts-dash-split-icon" aria-hidden="true">{icon}</span>
        {label}
      </div>
      <div className="ts-dash-split-value">{fmtMoney(value)}</div>
      {hint && <div className="ts-dash-split-hint">{hint}</div>}
      {/* Stage S — подстрока «осталось» рендерится ТОЛЬКО когда уже есть выплаты в поле */}
      {remainingValue != null && (
        <div className="ts-remaining-hint">
          Осталось: {fmtMoney(remainingValue)} ₽
        </div>
      )}
    </div>
  );
}

/* ─── Stage U: «🏢 Официально устроены» (бух vs директор) ───
 * Источник: summary.total_official_{count,to_pay_by_buh,paid_by_buh,remaining_by_buh}.
 * Экспортируется для реюза на /payroll-dashboard. */
export function OfficialEmploymentCard({ summary }) {
  const count  = Number(summary?.total_official_count || 0);
  const toPay  = Number(summary?.total_official_to_pay_by_buh || 0);
  const paid   = Number(summary?.total_official_paid_by_buh   || 0);
  const remain = Number(summary?.total_official_remaining_by_buh || 0);
  return (
    <div className="ts-dash-official">
      <div className="ts-dash-official-title">🏢 Официально устроены ({count} чел)</div>
      <div className="ts-dash-official-row">
        <span>К выплате бухом</span>
        <span>{fmtMoney(toPay)} ₽</span>
      </div>
      <div className="ts-dash-official-row">
        <span>Уже выплачено бухом</span>
        <span>{fmtMoney(paid)} ₽</span>
      </div>
      <div className="ts-dash-official-row total">
        <span>Осталось бух</span>
        <span>{fmtMoney(remain)} ₽</span>
      </div>
    </div>
  );
}

/* ─── Stage S: «📤 Уже выплачено в поле» ─── */
function PaidInFieldCard({ summary, employees }) {
  // breakdown суммируем по типам из employees[].paid_breakdown
  const breakdown = { per_diem: 0, salary: 0, advance: 0, bonus: 0 };
  (employees || []).forEach((e) => {
    const b = e?.paid_breakdown || {};
    breakdown.per_diem += Number(b.per_diem || 0);
    breakdown.salary   += Number(b.salary   || 0);
    breakdown.advance  += Number(b.advance  || 0);
    breakdown.bonus    += Number(b.bonus    || 0);
  });
  const hints = [];
  if (breakdown.bonus > 0)    hints.push(`${fmtMoney(breakdown.bonus)} премии`);
  if (breakdown.per_diem > 0) hints.push(`${fmtMoney(breakdown.per_diem)} суточные`);
  if (breakdown.salary > 0)   hints.push(`${fmtMoney(breakdown.salary)} зп`);
  if (breakdown.advance > 0)  hints.push(`${fmtMoney(breakdown.advance)} авансы`);

  return (
    <div className="ts-dash-paid">
      <div className="ts-dash-paid-title">📤 Уже выплачено в поле</div>
      <div className="ts-dash-paid-row">
        <span>Налом (РП в поле)</span>
        <span>{fmtMoney(summary.total_paid_cash)} ₽</span>
      </div>
      <div className="ts-dash-paid-row">
        <span>Переводом</span>
        <span>{fmtMoney(summary.total_paid_transfer)} ₽</span>
      </div>
      <div className="ts-dash-paid-row total">
        <span>Всего</span>
        <span>{fmtMoney(summary.total_paid_total)} ₽</span>
      </div>
      {hints.length > 0 && (
        <div className="ts-dash-paid-hint">💡 {hints.join(' · ')}</div>
      )}
    </div>
  );
}

function LimitRow({ label, remaining, capacity }) {
  const remainingNum = Math.max(0, Number(remaining) || 0);
  const capacityNum = Number(capacity) || 0;
  const pctFree = capacityNum > 0
    ? Math.min(100, Math.max(0, (remainingNum / capacityNum) * 100))
    : 0;
  const pctRound = Math.round(pctFree);
  const toneCls = pctFree >= 50 ? 'remain-ok' : (pctFree >= 20 ? 'remain-warn' : 'remain-low');
  const badge = pctFree >= 50 ? '✓' : (pctFree >= 20 ? '⚠' : '⛔');

  return (
    <div className="ts-dash-limit-row">
      <div className="ts-dash-limit-label">
        {label}: <b>{fmtMoney(remainingNum)}</b> из {fmtMoney(capacityNum)}
      </div>
      <div className="ts-dash-limit-bar"
           role="progressbar"
           aria-label={`${label}: осталось ${pctRound}% из ${fmtMoney(capacityNum)}`}
           aria-valuenow={pctRound} aria-valuemin={0} aria-valuemax={100}>
        <div className={`ts-dash-limit-fill ${toneCls}`} style={{ width: `${pctFree}%` }} />
      </div>
      <div className="ts-dash-limit-pct">{pctRound}% свободно {badge}</div>
    </div>
  );
}

/**
 * 🏦 Касса — есть ли деньги на ЗП?
 * Источник: GET /api/payroll-dashboard/cash-coverage/:year/:month
 * Cтатусы: ok / ok_with_returns / tight / shortage.
 *
 * Экспортируется отдельно — реюзаем на /payroll-dashboard.
 */
export function CashCoverageCard({ data }) {
  if (!data) return null;

  const balance = Number(data.cash_balance || 0);
  const needed = Number(data.cash_needed || 0);
  const pending = Number(data.pending_returns || 0);
  const effective = Number(data.effective_balance != null
    ? data.effective_balance
    : (balance + pending));
  const diff = Number(data.diff != null ? data.diff : (effective - needed));
  const pct = Number(data.coverage_pct != null
    ? data.coverage_pct
    : (needed > 0 ? Math.round(effective / needed * 100) : 100));
  const advancesSum = Number(data.advances_outstanding || 0);
  const advancesCnt = Number(data.advances_count || 0);
  const status = data.status || 'ok';
  const statusLabel = data.status_label || '';

  const statusCls = `cash-status-${status}`;
  const statusIcon = (
    status === 'ok'              ? '✅'
  : status === 'ok_with_returns' ? '🟢'
  : status === 'tight'           ? '⚠'
  : /* shortage */                 '❌'
  );

  const barPct = Math.min(100, Math.max(0, pct));
  const diffAbs = Math.abs(diff);
  const diffSign = diff < 0 ? '−' : (diff > 0 ? '+' : '');
  const diffCls = diff < 0 ? 'cash-diff-neg' : (diff > 0 ? 'cash-diff-pos' : 'cash-diff-zero');

  const advancesPlural =
    advancesCnt === 1 ? 'заявка' : (advancesCnt < 5 ? 'заявки' : 'заявок');

  return (
    <div className={`ts-dash-cash ${statusCls}`}>
      <div className="ts-dash-cash-title">🏦 Касса — есть ли деньги на ЗП?</div>

      <div className="ts-dash-cash-grid">
        <div className="ts-dash-cash-col">
          <CashRow label="В кассе:" value={fmtMoney(balance)} />
          <CashRow label="+ Ожидается возвратов:" value={fmtMoney(pending)} muted />
          <CashRow
            label="= Эффективно:"
            value={fmtMoney(effective)}
            sep
            bold
          />
        </div>
        <div className="ts-dash-cash-col">
          <CashRow label="Нужно на ЗП:" value={fmtMoney(needed)} />
          <CashRow
            label={diff < 0 ? 'Дефицит:' : 'Профицит:'}
            value={`${diffSign}${fmtMoney(diffAbs)}`}
            sep
            bold
            valueCls={diffCls}
          />
          <div className="ts-dash-cash-pct">{pct}% покрыто</div>
        </div>
      </div>

      <div className="ts-dash-cash-bar">
        <div className={`ts-dash-cash-bar-fill ${statusCls}`} style={{ width: `${barPct}%` }} />
      </div>

      <div className={`ts-dash-cash-action ${diff < 0 ? 'cash-action-bad' : 'cash-action-good'}`}>
        {statusIcon} {statusLabel}{diff < 0 ? ` — нужно пополнить ${fmtMoney(diffAbs)}` : ''}
      </div>

      {advancesSum > 0 && (
        <div className="ts-dash-cash-advances">
          💡 Дополнительно — <b>{fmtMoney(advancesSum)}</b> выданы РП на руках ({advancesCnt} {advancesPlural})
        </div>
      )}
    </div>
  );
}

function CashRow({ label, value, muted, sep, bold, valueCls = '' }) {
  return (
    <div className={`ts-dash-cash-row ${sep ? 'ts-dash-cash-row--sep' : ''}`}>
      <span className={`ts-dash-cash-label ${bold ? 'ts-dash-cash-label--bold' : ''}`}>
        {label}
      </span>
      <span className={`ts-dash-cash-num ${bold ? 'ts-dash-cash-num--bold' : ''} ${muted ? 'ts-dash-cash-num--mut' : ''} ${valueCls}`}>
        {value}
      </span>
    </div>
  );
}
