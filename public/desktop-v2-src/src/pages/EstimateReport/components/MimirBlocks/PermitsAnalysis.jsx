/**
 * PermitsAnalysis — допуска и нужное обучение.
 * Vanilla: estimate_report.js:970..997 (permits_status).
 * Поля: ms.permits_status = { available_crew[], training_needed[], summary }.
 */
import MimirAccordion from './MimirAccordion';
import { fmtMoney } from '../../api';

export default function PermitsAnalysis({ permits }) {
  const p = permits || null;
  const crew = p?.available_crew || [];
  const train = p?.training_needed || [];
  const hasAny = crew.length > 0 || train.length > 0 || !!p?.summary;

  return (
    <MimirAccordion icon="🛡" title="Допуска и персонал" accent="#4CAF50" empty={!hasAny}>
      {crew.length > 0 && (
        <table className="er-mimir-table">
          <thead>
            <tr>
              <th>Допуск</th>
              <th className="er-mimir-td-center">Нужно</th>
              <th className="er-mimir-td-center">Свободных</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {crew.map((r, i) => (
              <tr key={i}>
                <td>{r.permit || '—'}</td>
                <td className="er-mimir-td-center">{r.needed ?? '?'}</td>
                <td className="er-mimir-td-center">{r.available ?? '?'}</td>
                <td className={r.enough ? 'er-mimir-td-ok' : 'er-mimir-td-err'}>
                  {r.enough ? '✅ Хватает' : '⚠️ Не хватает'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {train.length > 0 && (
        <>
          <div className="er-mimir-sublabel er-mimir-sublabel--gold">📚 Нужно обучить:</div>
          {train.map((t, i) => (
            <p key={i} className="er-mimir-train">
              • {t.permit || '?'}: {t.people_count || 0} чел × {fmtMoney(t.cost_per_person || 0)} = <b>{fmtMoney(t.total || 0)}</b>
            </p>
          ))}
        </>
      )}
      {p?.summary && <p className="er-mimir-summary">{p.summary}</p>}
    </MimirAccordion>
  );
}
