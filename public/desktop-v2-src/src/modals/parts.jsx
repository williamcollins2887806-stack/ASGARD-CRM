/* Общие части модалок — Head/Body/Foot, Field, ButtonRow. */
import { cloneElement, isValidElement, useId } from 'react';
import { useMaximize } from './ModalProvider';

export function MHead({ icon, title, subtitle, accent = 'default', onClose }) {
  const max = useMaximize();
  return (
    <div className={'m-head m-acc-' + accent}>
      {icon && <div className="ico" aria-hidden="true">{icon}</div>}
      <div className="ttl-wrap">
        <h2>{title}</h2>
        {subtitle && <div className="subt">{subtitle}</div>}
      </div>
      {max && (
        <button
          type="button"
          className="maximize-btn"
          onClick={max.toggle}
          aria-label={max.maximized ? 'Свернуть из полноэкранного' : 'Развернуть на весь экран'}
          title={max.maximized ? 'Свернуть' : 'Развернуть на весь экран'}
        >{max.maximized ? '⮌' : '⛶'}</button>
      )}
      {onClose && (
        <button
          type="button"
          className="close-btn"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(e); }}
          aria-label="Закрыть"
        >×</button>
      )}
    </div>
  );
}

export function MCard({ children, className = '', ...rest }) {
  return <div className={'m-card ' + className} {...rest}>{children}</div>;
}

export function MBody({ children, style }) {
  return <div className="m-body" style={style}>{children}</div>;
}

export function MFoot({ children, align = 'end' }) {
  const cls = align === 'spread' ? 'spread' : align === 'center' ? 'center' : align === 'start' ? 'start' : '';
  return <div className={'m-foot ' + cls}>{children}</div>;
}

export function Btn({ variant = 'ghost', size, block, ...rest }) {
  const cls = ['m-btn', variant, size, block ? 'block' : ''].filter(Boolean).join(' ');
  return <button className={cls} {...rest} />;
}

export function Field({ label, required, help, error, children, htmlFor, id }) {
  // S-002: FormModal передаёт error={errMsg} (Form.jsx:112) — рендерим под полем.
  // Дублируем ARIA на input: aria-invalid/aria-describedby/aria-required для a11y.
  const reactMetaId = useId();
  const metaId = id ? id + '-meta' : reactMetaId;
  const hasMeta = !!(error || help);

  let childWithAria = children;
  if (isValidElement(children)) {
    childWithAria = cloneElement(children, {
      'aria-invalid': error ? true : undefined,
      'aria-describedby': hasMeta ? metaId : undefined,
      'aria-required': required ? true : undefined,
    });
  }

  return (
    <div className="m-field">
      {label && (
        <label htmlFor={htmlFor}>
          {label}
          {required && <span className="req" aria-hidden="true">*</span>}
          {required && <span className="sr-only"> (обязательно)</span>}
        </label>
      )}
      {childWithAria}
      {hasMeta && (
        <div
          className={'m-field-meta ' + (error ? 'err' : '')}
          id={metaId}
          role={error ? 'alert' : undefined}
        >
          {error && <span aria-hidden="true">⚠ </span>}{error || help}
        </div>
      )}
    </div>
  );
}

export function Input(props) { return <input className="m-input" {...props} />; }
export function Textarea(props) { return <textarea className="m-textarea" {...props} />; }
export function Select(props) { return <select className="m-select" {...props} />; }

export function Pill({ tone = 'default', children }) {
  return <span className={'m-pill ' + tone}>{children}</span>;
}
