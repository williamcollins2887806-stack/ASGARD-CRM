/**
 * SelfCheck — самопроверка Мимира (соответствие ТЗ + области неуверенности).
 * Vanilla: estimate_report.js:1029..1046 (self_check).
 * Поля: ms.self_check = { tz_compliance, uncertainty_areas[] }.
 */
import MimirAccordion from './MimirAccordion';

export default function SelfCheck({ selfCheck }) {
  const sc = selfCheck || null;
  const hasAny = sc && (sc.tz_compliance || (sc.uncertainty_areas && sc.uncertainty_areas.length > 0));

  return (
    <MimirAccordion icon="🔍" title="Самопроверка Мимира" accent="#8888ee" empty={!hasAny}>
      {sc?.tz_compliance && (
        <>
          <div className="er-mimir-sc__label">Соответствие ТЗ:</div>
          <p className="er-mimir-sc__text">{sc.tz_compliance}</p>
        </>
      )}
      {sc?.uncertainty_areas?.length > 0 && (
        <>
          <div className="er-mimir-sc__label er-mimir-sc__label--warn">⚠️ Где Мимир не уверен:</div>
          <ul className="er-mimir-cs__list">
            {sc.uncertainty_areas.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </>
      )}
    </MimirAccordion>
  );
}
