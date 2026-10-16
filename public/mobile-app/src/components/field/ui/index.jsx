'use strict';
/**
 * ASGARD Field — дизайн-система полевого приложения (Фаза 2).
 *
 * ЕДИНЫЙ источник визуальных примитивов. Правило: экран не рисует тени/градиенты
 * вручную — только эти компоненты и токены из index.css.
 *
 * ЗАКОН ЦВЕТА (зафиксирован в плане и tools/field-front-verify.js):
 *   цвет = значение, не украшение. Нет смысла → нейтраль.
 *   accent (синий)  = ДЕЙСТВИЕ;     value (золото) = ЗАРАБОТАНО;
 *   danger (красный)= ОПАСНОСТЬ;    status (зелёный)= только СТАТУС.
 * На экране бюджеты: 1 синий акцент, ≤1 крупная золотая поверхность + ≤2 бейджа,
 * ≤3 красных объекта, ≤1 тяжёлая (2px) цветная рамка.
 *
 * Тема (тёмная/светлая) — только через токены, ни одного литерального цвета.
 */
import { createContext, useContext } from 'react';
import { ChevronRight, X } from 'lucide-react';
import './ui.css';

/* ── Sheet / Modal / ConfirmDialog: обёртки над существующим BottomSheet ───── */
export { BottomSheet } from '@/components/shared/BottomSheet';
export { default as StatusBadge } from '@/components/shared/StatusBadge';
export { EmptyState } from '@/components/shared/EmptyState';
export { ProgressBar } from '@/components/shared/ProgressBar';

/* ══ Card ═══════════════════════════════════════════════════════════════════
   variant: 'flat' | 'raised' | 'nested' | 'tinted'
   tone:    'neutral' | 'accent' | 'value' | 'danger' | 'status'             */
export function Card({ variant = 'raised', tone = 'neutral', as: As = 'div', className = '', style, children, ...rest }) {
  const cls = ['ui-card', `ui-card--${variant}`, tone !== 'neutral' && `ui-card--${tone}`, className]
    .filter(Boolean).join(' ');
  return <As className={cls} style={style} {...rest}>{children}</As>;
}

/* ══ IconTile ══════════════════════════════════════════════════════════════
   Один нейтральный объёмный материал + 4 смысловых состояния.
   size: число (px). shape: 'squircle' | 'circle'.                          */
export function IconTile({ icon: Icon, size = 42, tone = 'neutral', shape = 'squircle', className = '', iconSize, style }) {
  const cls = ['ui-tile', `ui-tile--${tone}`, shape === 'circle' && 'ui-tile--circle', className]
    .filter(Boolean).join(' ');
  return (
    <span className={cls} style={{ width: size, height: size, ...style }} aria-hidden="true">
      {Icon ? <Icon size={iconSize || Math.round(size * 0.5)} strokeWidth={1.9} /> : null}
    </span>
  );
}

/* ══ KeyButton ═════════════════════════════════════════════════════════════
   Физическая кнопка-«клавиша»: ощутимое нажатие (уходит вниз на 4px).
   tone: 'accent' | 'value' | 'danger' | 'neutral' | 'ghost'
   size: 'sm' | 'md' | 'lg';  block — на всю ширину.                         */
export function KeyButton({ tone = 'accent', size = 'md', block = false, icon: Icon, className = '', style, children, ...rest }) {
  const cls = ['ui-key', `ui-key--${tone}`, `ui-key--${size}`, block && 'ui-key--block', className]
    .filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} style={style} {...rest}>
      {Icon ? <Icon size={size === 'sm' ? 15 : 17} strokeWidth={2.2} /> : null}
      {children}
    </button>
  );
}

/* ══ SectionLabel ══════════════════════════════════════════════════════════ */
export function SectionLabel({ children, action, onAction, className = '' }) {
  return (
    <div className={`ui-section ${className}`}>
      <span>{children}</span>
      {action ? (
        <button type="button" className="ui-section__action" onClick={onAction}>{action}</button>
      ) : null}
    </div>
  );
}

/* ══ AppBar ════════════════════════════════════════════════════════════════
   Шапка с учётом safe-area (челка/динамический остров). sticky по умолчанию. */
export function AppBar({ title, sub, onBack, right, sticky = true, transparent = false, children }) {
  return (
    <header className={`ui-appbar ${sticky ? 'ui-appbar--sticky' : ''} ${transparent ? 'ui-appbar--plain' : ''}`}>
      <div className="ui-appbar__row">
        {onBack ? (
          <button type="button" className="ui-appbar__back" onClick={onBack} aria-label="Назад">
            <ChevronRight size={22} strokeWidth={2.4} style={{ transform: 'rotate(180deg)' }} />
          </button>
        ) : null}
        <div className="ui-appbar__titles">
          {title ? <h1 className="ui-appbar__title">{title}</h1> : null}
          {sub ? <p className="ui-appbar__sub">{sub}</p> : null}
        </div>
        {right ? <div className="ui-appbar__right">{right}</div> : null}
      </div>
      {children}
    </header>
  );
}

/* ══ BottomBar ═════════════════════════════════════════════════════════════
   Нижняя панель с safe-area (раньше safe-bottom терялся на 2 экранах).      */
export function BottomBar({ children, className = '' }) {
  return <div className={`ui-bottombar ${className}`}>{children}</div>;
}

/* ══ Banner ════════════════════════════════════════════════════════════════
   tone: 'neutral' | 'accent' | 'value' | 'danger' | 'status'
   dismissible — кнопка ×.                                                   */
export function Banner({ tone = 'accent', icon: Icon, title, text, action, onAction, onDismiss, className = '' }) {
  return (
    <div className={`ui-banner ui-banner--${tone} ${className}`} role="status">
      {Icon ? (
        <span className="ui-banner__icon"><Icon size={19} strokeWidth={2} /></span>
      ) : null}
      <div className="ui-banner__body">
        {title ? <p className="ui-banner__title">{title}</p> : null}
        {text ? <p className="ui-banner__text">{text}</p> : null}
      </div>
      {action ? (
        <button type="button" className="ui-banner__action" onClick={onAction}>{action}</button>
      ) : null}
      {onDismiss ? (
        <button type="button" className="ui-banner__x" onClick={onDismiss} aria-label="Скрыть">
          <X size={16} strokeWidth={2.4} />
        </button>
      ) : null}
    </div>
  );
}

/* ══ ListRow ═══════════════════════════════════════════════════════════════ */
export function ListRow({ icon: Icon, tone = 'neutral', title, sub, value, chevron = false, onClick, right, className = '' }) {
  const As = onClick ? 'button' : 'div';
  return (
    <As type={onClick ? 'button' : undefined} className={`ui-row ${onClick ? 'ui-row--tap' : ''} ${className}`} onClick={onClick}>
      {Icon ? <IconTile icon={Icon} size={38} tone={tone} /> : null}
      <span className="ui-row__body">
        <span className="ui-row__title">{title}</span>
        {sub ? <span className="ui-row__sub">{sub}</span> : null}
      </span>
      {value ? <span className="ui-row__value">{value}</span> : null}
      {right || null}
      {chevron ? <ChevronRight size={18} strokeWidth={2.2} className="ui-row__chev" /> : null}
    </As>
  );
}

/* ══ Segmented ═════════════════════════════════════════════════════════════
   Внутренние табы/фильтр. Заменяет 4 самодельных реестра табов.             */
export function Segmented({ items = [], value, onChange, className = '' }) {
  return (
    <div className={`ui-seg ${className}`} role="tablist">
      {items.map((it) => {
        const id = typeof it === 'string' ? it : it.id;
        const label = typeof it === 'string' ? it : it.label;
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`ui-seg__item ${active ? 'is-active' : ''}`}
            onClick={() => onChange?.(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ══ Chip ══════════════════════════════════════════════════════════════════ */
export function Chip({ icon: Icon, tone = 'neutral', active = false, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      className={`ui-chip ui-chip--${tone} ${active ? 'is-active' : ''} ${className}`}
      onClick={onClick}
    >
      {Icon ? <Icon size={13} strokeWidth={2.2} /> : null}
      {children}
    </button>
  );
}

/* ══ Shield ════════════════════════════════════════════════════════════════
   Кастомный объёмный щит ASGARD (синяя+красная половины, золотая руна).
   Единственный многокрасочный элемент — носитель бренда. id уникальны (S-фикс). */
let _shieldSeq = 0;
export function Shield({ size = 40, className = '' }) {
  const u = `sh${(_shieldSeq += 1)}`;
  return (
    <svg className={`ui-shield ${className}`} width={size} height={size * 1.1} viewBox="0 0 40 44" aria-hidden="true">
      <defs>
        <linearGradient id={`${u}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7FB6FF" /><stop offset=".5" stopColor="#2F7BFF" /><stop offset="1" stopColor="#1447AE" />
        </linearGradient>
        <linearGradient id={`${u}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8593" /><stop offset=".5" stopColor="#E5484D" /><stop offset="1" stopColor="#971B2E" />
        </linearGradient>
        <linearGradient id={`${u}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF3C4" /><stop offset=".48" stopColor="#F0C24A" /><stop offset="1" stopColor="#A9780F" />
        </linearGradient>
        <clipPath id={`${u}c`}>
          <path d="M20 1.6 37.4 7v12.1C37.4 28.7 29.9 35.9 20 39.5 10.1 35.9 2.6 28.7 2.6 19.1V7z" />
        </clipPath>
      </defs>
      <path d="M20 1.6 37.4 7v12.1C37.4 28.7 29.9 35.9 20 39.5 10.1 35.9 2.6 28.7 2.6 19.1V7z" fill="#08101E" />
      <g clipPath={`url(#${u}c)`}>
        <rect x="2.6" y="1.6" width="18.2" height="39" fill={`url(#${u}b)`} />
        <rect x="20.4" y="1.6" width="17.4" height="39" fill={`url(#${u}r)`} />
        <path d="M20 1.6v38.2" stroke="#F0C24A" strokeOpacity=".55" strokeWidth=".8" />
        <rect x="2.6" y="1.6" width="35.2" height="15" fill="#fff" fillOpacity=".18" />
        <path d="M2.6 24c4 8 10 12.6 17.4 15.5 7.4-2.9 13.4-7.5 17.4-15.5v-2.9c-4.6 8.6-10.6 12.7-17.4 15-6.8-2.3-12.8-6.4-17.4-15z" fill="#000" fillOpacity=".22" />
        <path d="M20 1.6 37.4 7v12.1C37.4 28.7 29.9 35.9 20 39.5 10.1 35.9 2.6 28.7 2.6 19.1V7z" fill="none" stroke={`url(#${u}g)`} strokeWidth="1.7" />
      </g>
      <path d="M20 11.4 22 17.9l6.8.3-5.4 4.2 1.9 6.6-5.3-3.9-5.3 3.9 1.9-6.6-5.4-4.2 6.8-.3z"
        fill={`url(#${u}g)`} stroke="#6E4E0A" strokeWidth=".6" />
      <path d="M20 11.4 22 17.9l6.8.3-5.4 4.2 1.9 6.6-5.3-3.9z" fill="#fff" fillOpacity=".28" />
    </svg>
  );
}

/* ══ Тема-хелпер ══════════════════════════════════════════════════════════
   Даёт компонентам знать текущую тему (для случаев, где токенов мало —
   напр. выбора иконки солнце/луна).                                         */
const ThemeCtx = createContext('dark');
export const ThemeProvider = ThemeCtx.Provider;
export const useFieldTheme = () => useContext(ThemeCtx);
