/**
 * MimirBlocks — 7 аналитических подсекций Мимира в одном контейнере.
 * Vanilla: estimate_report.js:871..1050 (renderMimirBlocks).
 *
 * Подсекции (все аккордеоны):
 *   1. Cheatsheet        — шпаргалка (cheatsheet/client_questions/implementation_tips/risk_areas)
 *   2. CrewAnalysis      — рекомендованный состав бригады (recommended_crew)
 *   3. EquipmentAnalysis — оборудование (equipment_status)
 *   4. PermitsAnalysis   — допуска (permits_status)
 *   5. RouteAnalysis     — маршрут (route_plan)
 *   6. Scenarios         — альтернативные сценарии (scenarios)
 *   7. SelfCheck         — самопроверка (self_check)
 *   + Warnings           — предупреждения (warnings) — бонус (vanilla показывал в PDF)
 *
 * Если mimir_suggestions === null → плашка «Мимир ещё не считал» с CTA «Авторасчёт».
 */
import { getMimirSuggestions } from '../../api';
import Cheatsheet from './Cheatsheet';
import CrewAnalysis from './CrewAnalysis';
import EquipmentAnalysis from './EquipmentAnalysis';
import PermitsAnalysis from './PermitsAnalysis';
import RouteAnalysis from './RouteAnalysis';
import Scenarios from './Scenarios';
import SelfCheck from './SelfCheck';
import Warnings from './Warnings';

export default function MimirBlocks({ calcData }) {
  const ms = getMimirSuggestions(calcData);

  if (!ms) {
    return (
      <div className="card er-mimir-blocks-empty">
        <div className="er-mimir-blocks-empty__title">🧙 Анализ Мимира не запускался</div>
        <div className="er-mimir-blocks-empty__hint">
          Нажмите «Авторасчёт» в верхней панели — Мимир оценит бригаду, оборудование, допуска, маршрут и предложит сценарии.
        </div>
      </div>
    );
  }

  return (
    <div className="er-mimir-blocks">
      <Cheatsheet mimirNotes={ms.mimir_notes} />
      <CrewAnalysis crew={ms.recommended_crew} />
      <EquipmentAnalysis equipment={ms.equipment_status} />
      <PermitsAnalysis permits={ms.permits_status} />
      <RouteAnalysis route={ms.route_plan} />
      <Scenarios scenarios={ms.scenarios} />
      <SelfCheck selfCheck={ms.self_check} />
      <Warnings warnings={ms.warnings} />
    </div>
  );
}
