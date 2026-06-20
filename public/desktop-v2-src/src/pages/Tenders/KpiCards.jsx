/**
 * KPI-карточки хаба тендеров (4-5 шт. сверху).
 *
 * Считаются на клиенте из активной выборки tenders (без новых endpoints).
 * Дизайн 1:1 с vanilla S-13 .hub-kpi-grid + .hub-kpi(.warn|.gold).
 *
 * props:
 *   stats — { inbox_today, in_work, burn, addendum, won_month, win_pct }
 *   onJumpToBurn — обработчик клика по карточке «Дедлайн ≤ 3 дней» (фильтр)
 */
export default function KpiCards({ stats = {}, onJumpToBurn }) {
  const {
    inbox_today = 0,
    in_work = 0,
    burn = 0,
    addendum = 0,
    won_month = 0,
    win_pct = null
  } = stats;
  return (
    <div className="tnd-hub-kpi-grid">
      <div className="tnd-hub-kpi">
        <div className="tnd-hub-kpi-l">Входящих сегодня</div>
        <div className="tnd-hub-kpi-v gold">{inbox_today}</div>
        <div className="tnd-hub-kpi-s">приглашения + заявки</div>
      </div>
      <div className="tnd-hub-kpi">
        <div className="tnd-hub-kpi-l">В работе ТО</div>
        <div className="tnd-hub-kpi-v">{in_work}</div>
        <div className="tnd-hub-kpi-s">активная фаза</div>
      </div>
      <div
        className={'tnd-hub-kpi' + (burn > 0 ? ' alert' : '')}
        onClick={burn > 0 ? onJumpToBurn : undefined}
        style={burn > 0 ? { cursor: 'pointer' } : undefined}
        title={burn > 0 ? 'Показать горящие тендеры' : undefined}
      >
        <div className="tnd-hub-kpi-l">Дедлайн ≤ 3 дней</div>
        <div className="tnd-hub-kpi-v err">{burn}</div>
        <div className="tnd-hub-kpi-s">срочно поднять</div>
      </div>
      <div className="tnd-hub-kpi">
        <div className="tnd-hub-kpi-l">Дозапрос ждёт</div>
        <div className="tnd-hub-kpi-v warn">{addendum}</div>
        <div className="tnd-hub-kpi-s">ответ заказчику</div>
      </div>
      <div className="tnd-hub-kpi">
        <div className="tnd-hub-kpi-l">Выиграно в месяце</div>
        <div className="tnd-hub-kpi-v gold">{won_month}</div>
        <div className="tnd-hub-kpi-s">
          {win_pct != null ? `конверсия ${win_pct}%` : 'за 30 дней'}
        </div>
      </div>
    </div>
  );
}
