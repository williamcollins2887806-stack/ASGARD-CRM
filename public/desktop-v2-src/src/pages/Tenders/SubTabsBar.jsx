/**
 * Sub-табы хаба (chips/pills под главными табами).
 *
 *   tenders → 📡 С площадок | 🧮 В работе ТО
 *   applications → 📧 Почта | 📞 Телефония | 👤 От РП
 *   all → не рендерится (sub=null)
 *
 * Дизайн 1:1 с vanilla S-13 .hub-sub-tabs + .hub-sub-pill (chips с
 * border-radius:9999px, var(--gold-bg) на активной).
 *
 * props:
 *   tabs — массив { id, icon, label, count?, hint? }
 *   active — текущий sub
 *   onChange — (id) => void
 *   hint — текст подсказки под табами (показывается под активной вкладкой,
 *           берётся из найденного по active объекта)
 */
export default function SubTabsBar({ tabs, active, onChange, showHint = true }) {
  if (!Array.isArray(tabs) || !tabs.length) return null;
  const activeTab = tabs.find((t) => t.id === active);
  return (
    <>
      <div className="tnd-sub-tabs" role="tablist">
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={'tnd-sub-pill' + (isActive ? ' on' : '')}
              onClick={() => onChange?.(t.id)}
            >
              <span className="tnd-sub-pill-ic" aria-hidden>{t.icon}</span>
              <span>{t.label}</span>
              {t.count != null && (
                <span className="tnd-sub-pill-cnt">{t.count}</span>
              )}
            </button>
          );
        })}
      </div>
      {showHint && activeTab?.hint && (
        <div className="tnd-sub-hint">
          <span aria-hidden>ℹ</span> {activeTab.hint}
        </div>
      )}
    </>
  );
}
