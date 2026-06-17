/**
 * Scenarios — альтернативные сценарии расчёта (быстрый/средний/полный).
 * Источник: mimir_suggestions.scenarios[]={name,duration_days,cost,price,margin_pct,note}.
 * В vanilla структура присутствует в mimir-auto-estimate.js, но в estimate_report.js
 * отдельной рендер-функции не было — добавляем для парности с PDF-отчётом директора.
 */
import MimirAccordion from './MimirAccordion';
import { fmtMoney } from '../../api';

export default function Scenarios({ scenarios }) {
  const list = Array.isArray(scenarios) ? scenarios : [];
  return (
    <MimirAccordion icon="🎭" title="Альтернативные сценарии расчёта" accent="#a78bfa" empty={!list.length}>
      <table className="er-mimir-table">
        <thead>
          <tr>
            <th>Сценарий</th>
            <th className="er-mimir-td-center">Срок</th>
            <th className="er-mimir-td-right">Себест.</th>
            <th className="er-mimir-td-right">Цена</th>
            <th className="er-mimir-td-center">Маржа %</th>
            <th>Комментарий</th>
          </tr>
        </thead>
        <tbody>
          {list.map((sc, i) => (
            <tr key={i}>
              <td className="er-mimir-td-strong">{sc.name || '—'}</td>
              <td className="er-mimir-td-center">{sc.duration_days ? sc.duration_days + ' дн' : '—'}</td>
              <td className="er-mimir-td-right">{fmtMoney(sc.cost || 0)}</td>
              <td className="er-mimir-td-right">{fmtMoney(sc.price || 0)}</td>
              <td className="er-mimir-td-center">
                {sc.margin_pct != null ? Number(sc.margin_pct).toFixed(1) + '%' : '—'}
              </td>
              <td className="er-mimir-td-small">{sc.note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </MimirAccordion>
  );
}
