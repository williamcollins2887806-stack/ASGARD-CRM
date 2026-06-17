/**
 * Warnings — предупреждения Мимира (critical/warning/info).
 * Vanilla: используются в PDF-отчёте директора (estimates.js:998..1008).
 * Поля: ms.warnings[]={level,title,text}.
 */
import MimirAccordion from './MimirAccordion';

const LEVEL_META = {
  critical: { color: '#ef4444', icon: '🔴' },
  warning:  { color: '#f59e0b', icon: '🟡' },
  info:     { color: '#6366f1', icon: '🔵' }
};

export default function Warnings({ warnings }) {
  const list = Array.isArray(warnings) ? warnings : [];
  return (
    <MimirAccordion icon="⚡" title="Предупреждения Мимира" accent="#f59e0b" empty={!list.length}>
      {list.map((w, i) => {
        const meta = LEVEL_META[w.level] || LEVEL_META.info;
        return (
          <div key={i} className="er-mimir-warn" style={{ borderLeftColor: meta.color }}>
            <div className="er-mimir-warn__title" style={{ color: meta.color }}>
              {meta.icon} {w.title || ''}
            </div>
            <div className="er-mimir-warn__text">{w.text || ''}</div>
          </div>
        );
      })}
    </MimirAccordion>
  );
}
