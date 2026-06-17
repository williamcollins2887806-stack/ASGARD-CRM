import { useRef, useState } from 'react';
import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Pill } from './parts';

/**
 * Детальный просмотр карточки с табами + timeline + key-value таблица.
 * Используется для: тендер/работа/заявка/сотрудник/контрагент.
 *
 * props.tabs = [{ key, label, render: () => JSX }]
 */
export function DetailsModal({
  title,
  subtitle,
  icon = '📄',
  accent = 'default',
  status,        // { label, tone }
  tabs = [],
  actions,
  onClose
}) {
  const { close } = useModal();
  const [activeTab, setActiveTab] = useState(tabs[0]?.key);
  const handleClose = () => { onClose?.(); close(); };
  const cur = tabs.find((t) => t.key === activeTab) || tabs[0];

  // G-1: WAI-ARIA tablist (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
  // - role="tablist" + role="tab" с aria-selected + aria-controls
  // - role="tabpanel" с aria-labelledby
  // - стрелки ←→ перебирают вкладки (с цикличностью), Home/End на края
  const tablistId = useRef('dt-' + Math.random().toString(36).slice(2, 8));
  const tabRefs = useRef({});

  const onTabKey = (e, idx) => {
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    const nextKey = tabs[next].key;
    setActiveTab(nextKey);
    // фокус на новую вкладку
    setTimeout(() => tabRefs.current[nextKey]?.focus(), 0);
  };

  return (
    <MCard>
      <MHead icon={icon} title={title} subtitle={subtitle} accent={accent} onClose={handleClose} />
      {status && (
        <div style={{ padding: '0 22px 12px' }}>
          <Pill tone={status.tone}>{status.label}</Pill>
        </div>
      )}
      {tabs.length > 1 && (
        <div className="m-tabs" role="tablist" aria-label="Разделы карточки">
          {tabs.map((t, idx) => {
            const isActive = t.key === activeTab;
            return (
              <button
                key={t.key}
                ref={(el) => { tabRefs.current[t.key] = el; }}
                className={'m-tab ' + (isActive ? 'active' : '')}
                onClick={() => setActiveTab(t.key)}
                onKeyDown={(e) => onTabKey(e, idx)}
                role="tab"
                aria-selected={isActive}
                aria-controls={`${tablistId.current}-panel-${t.key}`}
                id={`${tablistId.current}-tab-${t.key}`}
                tabIndex={isActive ? 0 : -1}
                type="button"
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
      <MBody>
        {tabs.length > 1 ? (
          <div
            role="tabpanel"
            id={`${tablistId.current}-panel-${cur?.key}`}
            aria-labelledby={`${tablistId.current}-tab-${cur?.key}`}
            tabIndex={0}
          >
            {cur?.render?.() ?? null}
          </div>
        ) : (
          cur?.render?.() ?? null
        )}
      </MBody>
      {actions && <MFoot align="spread">{actions}</MFoot>}
    </MCard>
  );
}

/** Helper: key-value таблица */
export function KV({ rows }) {
  return (
    <div className="m-kv">
      {rows.map((r, i) => (
        <span key={i} className="contents">
          <div className="k">{r.k}</div>
          <div className="v">{r.v}</div>
        </span>
      ))}
    </div>
  );
}

/** Helper: лента событий */
export function Timeline({ events }) {
  return (
    <div className="m-timeline">
      {events.map((e, i) => (
        <div key={i} className="ev">
          <div className={'dot ' + (e.tone || '')} />
          <div>
            <div className="when">{e.when}</div>
            <div className="what">{e.what}</div>
            {e.by && <div className="by">{e.by}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
