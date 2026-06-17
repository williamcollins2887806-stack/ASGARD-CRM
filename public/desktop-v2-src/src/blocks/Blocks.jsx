/**
 * Blocks — переиспользуемые блоки страниц CRM v2.
 *
 * Экспортируется только то, что реально используется на боевых страницах:
 *   - TopActionsBar  — шапка страницы (kicker/title/subtitle/actions)
 *   - EmptyState     — заглушка «нет данных»
 *   - TabsBar        — управляемые табы (tabs/active/onChange)
 *   - LoadingCard    — доступный inline-loader с aria-busy + sr-only
 *   - SkeletonRows   — скелетон строк таблицы (заранее задаём count чтобы layout не прыгал)
 *   - SkeletonCards  — скелетон карточек (для grid-страниц)
 *
 * Демо-компоненты (WinPanel/DistPanel/StatCardRow/FilterBar/AlertStrip/ListItemRow)
 * с моковыми данными удалены 14.06.2026 — они использовались только в каталоге
 * `/modals` (дизайн-система для ADMIN). По требованию пользователя «никаких mock-данных
 * в проде» удалены вместе с их секциями в pages/Modals.jsx.
 */
import { useState } from 'react';

export function TopActionsBar({ kicker = 'Раздел', title, subtitle, actions } = {}) {
  return (
    <div className="blk-top">
      <div>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700 }}>{kicker}</div>
        {title && <h2 style={{ margin: '2px 0 0', fontSize: 24, fontWeight: 900 }}>{title}</h2>}
        {subtitle && <div className="fs-13 c-t3 mt-4">{subtitle}</div>}
      </div>
      {actions && <div className="row gap-10">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action } = {}) {
  return (
    <div className="blk-empty">
      <div className="ic">{icon ?? '📭'}</div>
      <div className="ttl">{title ?? 'Пока пусто'}</div>
      {hint && <div className="sub">{hint}</div>}
      {action}
    </div>
  );
}

/**
 * LoadingCard — доступный inline-loader для страниц (НЕ модалок).
 * Использовать вместо «card card-empty» с текстом «⏳ Загружаем…».
 * Накатывает aria-busy + sr-only-текст для скринридеров (был промах G-9).
 *
 *   {loading ? <LoadingCard text="Загружаем акты…" /> : list.length === 0 ? <EmptyState ... /> : ...}
 */
export function LoadingCard({ text = 'Загрузка…' } = {}) {
  return (
    <div className="card card-empty" role="status" aria-live="polite" aria-busy="true">
      <span aria-hidden="true">⏳ </span>
      {text}
      <span className="sr-only"> (идёт загрузка)</span>
    </div>
  );
}

/**
 * SkeletonRows — скелетон для табличных страниц.
 *  - count подбирается чтобы примерно совпасть с реальным количеством строк PAGE-1
 *  - rowHeight близкий к реальной высоте строки таблицы (44px по умолчанию)
 *  - Layout НЕ скачет на «загружено» (использовать тот же контейнер .card)
 *
 *   {loading ? <SkeletonRows count={10} /> : <table>...</table>}
 */
export function SkeletonRows({ count = 8, rowHeight = 44 } = {}) {
  return (
    <div
      className="skel-rows"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Загрузка данных таблицы"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skel" style={{ height: rowHeight, marginBottom: 6 }} />
      ))}
      <span className="sr-only">Загружаем строки таблицы…</span>
    </div>
  );
}

/**
 * SkeletonCards — скелетон для grid-страниц (карточки).
 */
export function SkeletonCards({ count = 6, cardHeight = 160, cols = 3 } = {}) {
  return (
    <div
      className="skel-grid"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Загрузка карточек"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skel" style={{ height: cardHeight }} />
      ))}
      <span className="sr-only">Загружаем карточки…</span>
    </div>
  );
}

export function TabsBar({ tabs, active, onChange } = {}) {
  // Управляемые табы. Если tabs не переданы — рендерим пусто (для каталога заглушка).
  const [iTab, setITab] = useState(0);
  if (!Array.isArray(tabs)) return null;
  const isControlled = active !== undefined && typeof onChange === 'function';
  const current = isControlled ? active : (tabs[iTab]?.id ?? tabs[iTab]?.lab);
  const handleClick = (t) => {
    const v = t.id ?? t.lab;
    if (isControlled) onChange(v);
    else setITab(tabs.findIndex((x) => (x.id ?? x.lab) === v));
  };
  return (
    <div className="blk-tabs">
      {tabs.map((t) => (
        <button
          key={t.id ?? t.lab ?? t.label}
          className={current === (t.id ?? t.lab) ? 'on' : ''}
          onClick={() => handleClick(t)}
        >
          <span>{t.label ?? t.lab}</span>
          {t.count !== undefined && t.count !== null && <span className="cnt">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
