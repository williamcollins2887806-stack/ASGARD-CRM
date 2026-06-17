/**
 * EquipmentAnalysis — оборудование (со склада + к закупке).
 * Vanilla: estimate_report.js:940..968 (equipment_status).
 * Поля: ms.equipment_status = { from_warehouse[], to_purchase[], summary }.
 */
import MimirAccordion from './MimirAccordion';
import { fmtMoney } from '../../api';

export default function EquipmentAnalysis({ equipment }) {
  const eq = equipment || null;
  const fromWh = eq?.from_warehouse || [];
  const toBuy = eq?.to_purchase || [];
  const hasAny = fromWh.length > 0 || toBuy.length > 0 || !!eq?.summary;

  return (
    <MimirAccordion icon="🔧" title="Оборудование" accent="#4D90E0" empty={!hasAny}>
      {fromWh.length > 0 && (
        <>
          <div className="er-mimir-sublabel er-mimir-sublabel--ok">✅ Со склада:</div>
          <table className="er-mimir-table">
            <tbody>
              {fromWh.map((r, i) => (
                <tr key={i}>
                  <td>{r.item || '—'}</td>
                  <td className="er-mimir-td-right">{r.quantity || 1} шт</td>
                  <td className="er-mimir-td-muted">{r.condition || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {toBuy.length > 0 && (
        <>
          <div className="er-mimir-sublabel er-mimir-sublabel--gold">🛒 Нужно купить:</div>
          <table className="er-mimir-table">
            <tbody>
              {toBuy.map((r, i) => (
                <tr key={i}>
                  <td>{r.item || '—'}</td>
                  <td className="er-mimir-td-right">{r.quantity || 1} шт</td>
                  <td className="er-mimir-td-right er-mimir-td-strong">{fmtMoney(r.total || r.price_estimate || 0)}</td>
                  <td className="er-mimir-td-muted er-mimir-td-small">{r.supplier_hint || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {eq?.summary && <p className="er-mimir-summary">{eq.summary}</p>}
    </MimirAccordion>
  );
}
