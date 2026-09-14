/**
 * KPI хаба тендеров — компактная аналитика уровня топ-CRM.
 */
import { formatMoney } from '@/lib/money';

function KpiTile({ label, value, hint, tone, onClick, alert }) {
  const cls = [
    'tnd-hub-kpi',
    tone ? `tone-${tone}` : '',
    alert ? 'alert' : '',
    onClick ? 'is-clickable' : ''
  ].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      title={onClick ? 'Показать в реестре' : undefined}
    >
      <div className="tnd-hub-kpi-l">{label}</div>
      <div className={'tnd-hub-kpi-v' + (tone ? ` ${tone}` : '')}>{value}</div>
      {hint ? <div className="tnd-hub-kpi-s">{hint}</div> : null}
    </div>
  );
}

function PeriodMetric({ label, value, tone }) {
  return (
    <div className={'tnd-hub-metric' + (tone ? ` tone-${tone}` : '')}>
      <span className="tnd-hub-metric-l">{label}</span>
      <span className="tnd-hub-metric-v">{value}</span>
    </div>
  );
}

export default function KpiCards({ stats = {}, onJumpToBurn }) {
  const {
    inbox_today = 0,
    in_work = 0,
    burn = 0,
    addendum = 0,
    won_month = 0,
    win_pct = null,
    week = {},
    month = {}
  } = stats;

  return (
    <div className="tnd-hub-kpi-wrap">
      <div className="tnd-hub-kpi-grid">
        <KpiTile label="Входящих сегодня" value={inbox_today} hint="тендеры + заявки" tone="gold" />
        <KpiTile label="В работе ТО" value={in_work} hint="готовим + подались" />
        <KpiTile
          label="Дедлайн ≤ 3 дней"
          value={burn}
          hint={burn > 0 ? 'нажмите, чтобы открыть' : 'срочно поднять'}
          tone="err"
          alert={burn > 0}
          onClick={burn > 0 ? onJumpToBurn : undefined}
        />
        <KpiTile label="Дозапрос ждёт" value={addendum} hint="ответ заказчику" tone="warn" />
        <KpiTile
          label="Выиграно в месяце"
          value={won_month}
          hint={win_pct != null ? `конверсия ${win_pct}%` : 'с 1-го числа'}
          tone="gold"
        />
      </div>

      <div className="tnd-hub-kpi-periods">
        <div className="tnd-hub-kpi-period">
          <div className="tnd-hub-kpi-period-h">
            <span>Неделя</span>
            <span className="tnd-hub-kpi-period-badge">пн–вс</span>
          </div>
          <div className="tnd-hub-metric-row">
            <PeriodMetric label="Входящие" value={week.inbox ?? 0} />
            <PeriodMetric label="Подачи" value={week.submitted ?? 0} />
            <PeriodMetric label="Выиграно" value={week.won ?? 0} tone="ok" />
            <PeriodMetric label="Проиграно" value={week.lost ?? 0} tone="err" />
          </div>
        </div>
        <div className="tnd-hub-kpi-period">
          <div className="tnd-hub-kpi-period-h">
            <span>Месяц</span>
            <span className="tnd-hub-kpi-period-badge">с 1-го</span>
          </div>
          <div className="tnd-hub-metric-row">
            <PeriodMetric label="Входящие" value={month.inbox ?? 0} />
            <PeriodMetric label="Подачи" value={month.submitted ?? 0} />
            <PeriodMetric label="Выиграно" value={month.won ?? 0} tone="ok" />
            <PeriodMetric label="Проиграно" value={month.lost ?? 0} tone="err" />
            <PeriodMetric label="Сумма подач" value={formatMoney(month.submission_sum || 0)} tone="gold" />
          </div>
        </div>
      </div>
    </div>
  );
}
