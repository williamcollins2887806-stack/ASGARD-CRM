/**
 * CrewAnalysis — рекомендованный состав бригады.
 * Vanilla: estimate_report.js:920..938 (recommended_crew).
 * Поля: ms.recommended_crew[]={name, role, city, reason}.
 */
import MimirAccordion from './MimirAccordion';

export default function CrewAnalysis({ crew }) {
  const list = Array.isArray(crew) ? crew : [];
  return (
    <MimirAccordion icon="👷" title="Рекомендованный состав бригады" accent="#D4A843" empty={!list.length}>
      <table className="er-mimir-table">
        <thead>
          <tr>
            <th>Сотрудник</th>
            <th>Роль</th>
            <th>Город</th>
            <th>Обоснование</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p, i) => (
            <tr key={i}>
              <td className="er-mimir-td-strong">{p.name || '—'}</td>
              <td>{p.role || '—'}</td>
              <td className="er-mimir-td-muted">{p.city || '—'}</td>
              <td className="er-mimir-td-small">{p.reason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </MimirAccordion>
  );
}
