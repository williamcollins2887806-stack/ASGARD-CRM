/**
 * MimirAccordion — переиспользуемая карточка-аккордеон с заголовком.
 * Используется всеми 7 подсекциями анализа Мимира.
 * Если пропс `empty` true — рендерит «Мимир ещё не считал» (не stub).
 */
import { useState } from 'react';

export default function MimirAccordion({
  icon,
  title,
  accent = '#4a6ff5',
  defaultOpen = true,
  empty = false,
  children
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={'er-mimir-block' + (open ? ' er-mimir-block--open' : '')}>
      <button
        type="button"
        className="er-mimir-block__head"
        style={{ borderLeftColor: accent }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="er-mimir-block__icon" aria-hidden="true">{icon}</span>
        <span className="er-mimir-block__title" style={{ color: accent }}>{title}</span>
        <span className="er-mimir-block__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="er-mimir-block__body">
          {empty ? (
            <div className="er-mimir-empty">Мимир ещё не считал эту секцию</div>
          ) : children}
        </div>
      )}
    </div>
  );
}
