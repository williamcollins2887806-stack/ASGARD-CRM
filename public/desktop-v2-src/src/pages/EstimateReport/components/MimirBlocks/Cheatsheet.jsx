/**
 * Cheatsheet — «Шпаргалка Мимира».
 * Vanilla: estimate_report.js:883..918.
 * Поля: mn.cheatsheet (text), client_questions[], implementation_tips[], risk_areas[].
 */
import MimirAccordion from './MimirAccordion';

export default function Cheatsheet({ mimirNotes }) {
  const mn = mimirNotes || {};
  const hasAny = mn.cheatsheet ||
    (mn.client_questions && mn.client_questions.length) ||
    (mn.implementation_tips && mn.implementation_tips.length) ||
    (mn.risk_areas && mn.risk_areas.length);

  return (
    <MimirAccordion icon="🧠" title="Шпаргалка Мимира — рекомендации по проекту" accent="#4a6ff5" empty={!hasAny}>
      {mn.cheatsheet && (
        <div className="er-mimir-cs__summary">
          {String(mn.cheatsheet).split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      {mn.client_questions?.length > 0 && (
        <>
          <div className="er-mimir-cs__label">❓ Уточнить у клиента</div>
          <ul className="er-mimir-cs__list">
            {mn.client_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </>
      )}
      {mn.implementation_tips?.length > 0 && (
        <>
          <div className="er-mimir-cs__label">💡 Рекомендации по выполнению</div>
          <ul className="er-mimir-cs__list">
            {mn.implementation_tips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </>
      )}
      {mn.risk_areas?.length > 0 && (
        <>
          <div className="er-mimir-cs__label">⚠️ Потенциальные сложности</div>
          {mn.risk_areas.map((r, i) => (
            <div key={i} className="er-mimir-cs__risk">
              <div className="er-mimir-cs__risk-title">{r.title}</div>
              <div className="er-mimir-cs__risk-desc">{r.description}</div>
              {r.mitigation && (
                <div className="er-mimir-cs__risk-mit">→ {r.mitigation}</div>
              )}
            </div>
          ))}
        </>
      )}
    </MimirAccordion>
  );
}
