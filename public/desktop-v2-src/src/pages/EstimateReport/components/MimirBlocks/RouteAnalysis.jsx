/**
 * RouteAnalysis — маршрут командировки и логистика.
 * Vanilla: estimate_report.js:999..1027 (route_plan).
 * Поля: ms.route_plan = { legs[]={from,to,transport,duration_days,cost_per_person}, warehouse_stop, summary }.
 */
import MimirAccordion from './MimirAccordion';
import { fmtMoney } from '../../api';

export default function RouteAnalysis({ route }) {
  const r = route || null;
  const legs = r?.legs || [];
  const ws = r?.warehouse_stop || null;
  const hasAny = legs.length > 0 || !!ws || !!r?.summary;

  return (
    <MimirAccordion icon="🗺" title="Маршрут и логистика" accent="#D4A843" empty={!hasAny}>
      {legs.length > 0 && (
        <div className="er-mimir-route">
          {legs.map((leg, i) => (
            <div key={i} className="er-mimir-route__leg">
              <div className="er-mimir-route__stage">Этап {i + 1}</div>
              <div className="er-mimir-route__path">
                {leg.from || '?'} → {leg.to || '?'}
              </div>
              <div className="er-mimir-route__meta">
                {leg.transport || '?'} • {leg.duration_days || '?'} дн
                {leg.cost_per_person ? ' • ' + fmtMoney(leg.cost_per_person) + '/чел' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      {ws && (
        <div className="er-mimir-route__warehouse">
          <div className="er-mimir-route__warehouse-title">
            📦 Остановка на складе: {ws.location || 'Москва'} — {ws.days || 2} дн
          </div>
          <div className="er-mimir-route__warehouse-act">
            {ws.activities || 'Комплектация, погрузка, проверка СИЗ'}
          </div>
        </div>
      )}
      {r?.summary && <p className="er-mimir-summary">{r.summary}</p>}
    </MimirAccordion>
  );
}
