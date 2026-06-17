/**
 * PalletItem — одна позиция в Visual Pallet Builder.
 *
 * Две формы рендера:
 *   variant="card"    — крупная карточка в пуле «Неразмещённые»
 *   variant="stacked" — компактная плашка-плитка стопкой на паллете
 *
 * На обеих формах:
 *   • HTML5 draggable + dragstart/dragend
 *   • Touch (pointer) drag через колбэк onPointerDragStart
 *   • Ripple-эффект клика на месте касания
 */
import { useRef } from 'react';

const SOURCE_COLORS = {
  reservation:           { l: 'Со склада',        c: 'var(--blue, #5aa0ff)' },
  procurement_warehouse: { l: 'Закупка→склад',     c: 'var(--ok, #4caf50)' },
  procurement_object:    { l: 'Закупка→объект',    c: 'var(--gold, #d4a13c)' },
  from_warehouse:        { l: 'Со склада (расх.)', c: 'var(--blue, #5aa0ff)' },
  manual:                { l: 'Вручную',           c: 'var(--t-3, #7a7e87)' },
  on_site_purchase:      { l: 'Купл. на объекте',  c: 'var(--warn, #ffa028)' }
};

const RETURN_LABELS = {
  returning: 'Возврат',
  damaged:   'Сломано',
  lost:      'Утеряно',
  consumed:  'Израсх.'
};

export function getSourceMeta(source) {
  return SOURCE_COLORS[source] || SOURCE_COLORS.manual;
}

export const SOURCE_COLORS_MAP = SOURCE_COLORS;

/**
 * @param {{
 *   item: { id:number, name:string, quantity:number|string, unit?:string, source?:string,
 *           article?:string, packed?:boolean, return_status?:string, pallet_id?:number|null },
 *   variant: 'card' | 'stacked',
 *   stackIdx?: number,
 *   draggable: boolean,
 *   isDemob?: boolean,
 *   onDragStart?: (e:DragEvent, id:number) => void,
 *   onDragEnd?:   (e:DragEvent, id:number) => void,
 *   onPointerDragStart?: (e:PointerEvent, id:number) => void,
 *   onUnassign?: (id:number) => void,
 *   onClickReturn?: (anchorEl:HTMLElement, id:number) => void
 * }} props
 */
export function PalletItem({
  item,
  variant = 'card',
  stackIdx = 0,
  draggable = true,
  isDemob = false,
  onDragStart,
  onDragEnd,
  onPointerDragStart,
  onUnassign,
  onClickReturn
}) {
  const elRef = useRef(null);
  const src = getSourceMeta(item.source);
  const ret = item.return_status || (isDemob ? 'returning' : '');

  const handleClickRipple = (e) => {
    const host = elRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const rip = document.createElement('span');
    rip.className = 'vpb__click-ripple';
    rip.style.left = (e.clientX - rect.left) + 'px';
    rip.style.top  = (e.clientY - rect.top)  + 'px';
    host.appendChild(rip);
    const cleanup = () => { rip.remove(); };
    rip.addEventListener('animationend', cleanup, { once: true });
    // safety cleanup
    setTimeout(cleanup, 800);
  };

  const handleDragStart = (e) => {
    if (!draggable) { e.preventDefault(); return; }
    if (onDragStart) onDragStart(e, item.id);
  };
  const handleDragEnd = (e) => {
    if (onDragEnd) onDragEnd(e, item.id);
  };
  const handlePointerDown = (e) => {
    if (!draggable) return;
    // touch / pen only — мышь ловит HTML5-drag
    if (e.pointerType === 'mouse') return;
    if (onPointerDragStart) onPointerDragStart(e, item.id);
  };

  if (variant === 'stacked') {
    const ml = (stackIdx % 3) * 2;
    return (
      <div
        ref={elRef}
        className="vpb__stacked"
        data-iid={item.id}
        data-ret={ret}
        draggable={draggable}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onPointerDown={handlePointerDown}
        onClick={handleClickRipple}
        onDoubleClick={() => onUnassign && onUnassign(item.id)}
        style={{ marginLeft: ml + 'px' }}
        title={draggable ? '✕ убрать · ⠿ перетащить на другой паллет' : ''}
      >
        <span className="vpb__stacked-color" style={{ background: src.c }} />
        <span className="vpb__stacked-name">{item.name}</span>
        <span className="vpb__stacked-qty">{item.quantity} {item.unit || 'шт'}</span>
        {isDemob && ret && (
          <span
            className="vpb__ret-badge"
            data-ret={ret}
            onClick={(e) => {
              e.stopPropagation();
              if (onClickReturn) onClickReturn(e.currentTarget, item.id);
            }}
            style={{
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: '6px',
              background: 'rgba(0,0,0,0.2)',
              cursor: 'pointer'
            }}
          >
            {RETURN_LABELS[ret] || ret}
          </span>
        )}
        {draggable && onUnassign && (
          <span
            className="vpb__stacked-x"
            onClick={(e) => { e.stopPropagation(); onUnassign(item.id); }}
            title="Убрать с паллета"
          >✕</span>
        )}
      </div>
    );
  }

  return (
    <div
      ref={elRef}
      className={'vpb__card' + (item.packed ? ' is-packed' : '')}
      data-iid={item.id}
      data-src={item.source || 'manual'}
      data-ret={ret}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onPointerDown={handlePointerDown}
      onClick={handleClickRipple}
    >
      <span className="vpb__card-grip">⠿</span>
      <div className="vpb__card-body">
        <div className="vpb__card-name">{item.name}</div>
        <div className="vpb__card-meta">
          <span className="vpb__card-dot" style={{ background: src.c }} />
          {src.l}{item.article ? ' · ' + item.article : ''}
        </div>
      </div>
      <span className="vpb__card-qty">{item.quantity} {item.unit || 'шт'}</span>
    </div>
  );
}
