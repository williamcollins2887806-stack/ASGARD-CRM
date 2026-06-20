/**
 * 3 главных таба хаба: 🛡 Тендеры / 📥 Заявки / 🌐 Все.
 *
 * Не используем общий <TabsBar>, потому что у хаба особый дизайн —
 * Cinzel-шрифт на активной вкладке + золотой индикатор-полоска снизу
 * (1:1 с vanilla S-13 .hub-main-tabs + .hub-tab.active + .hub-tab-cnt).
 *
 * props:
 *   active — 'tenders' | 'applications' | 'all'
 *   counts — { tenders, applications, all }
 *   onChange — (id) => void
 */
const MAIN_TABS = [
  { id: 'tenders',      icon: '🛡', label: 'Тендеры' },
  { id: 'applications', icon: '📥', label: 'Заявки'  },
  { id: 'all',          icon: '🌐', label: 'Все'     }
];

export default function HubMainTabs({ active, counts = {}, onChange }) {
  return (
    <div className="tnd-hub-tabs" role="tablist">
      {MAIN_TABS.map((t) => {
        const cnt = counts[t.id];
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={'tnd-hub-tab' + (isActive ? ' on' : '')}
            onClick={() => onChange?.(t.id)}
          >
            <span className="tnd-hub-tab-ic" aria-hidden>{t.icon}</span>
            <span className="tnd-hub-tab-lbl">{t.label}</span>
            {cnt != null && (
              <span className="tnd-hub-tab-cnt">{cnt}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
