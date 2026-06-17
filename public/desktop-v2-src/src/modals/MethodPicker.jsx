import { useModal } from './ModalProvider';
import { MCard, MHead, MBody } from './parts';

/**
 * Picker из 2-4 крупных вариантов (как mimir-method-picker).
 * options: [{ key, icon, title, desc, meta, featured? }]
 */
export function MethodPicker({
  title = 'Выбор способа',
  subtitle = 'Сравните и выберите подходящий вариант',
  icon = '🪄',
  accent = 'purple',
  options = [],
  onChoose,
  onClose
}) {
  const { close } = useModal();
  const handleClose = () => { onClose?.(); close(); };

  return (
    <MCard>
      <MHead icon={icon} title={title} subtitle={subtitle} accent={accent} onClose={handleClose} />
      <MBody>
        <div className="m-methods">
          {options.map((o) => (
            <button
              key={o.key}
              className={'m-method ' + (o.featured ? 'featured' : '')}
              onClick={() => { onChoose?.(o.key, o); close(); }}
            >
              <div className="ic">{o.icon}</div>
              <div className="ttl">{o.title}</div>
              <div className="desc">{o.desc}</div>
              {o.meta && <div className="meta">{o.meta}</div>}
            </button>
          ))}
        </div>
        <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--t-4)', marginTop: 12 }}>
          Не уверены? Начните с быстрого — полный можно запустить позже.
        </div>
      </MBody>
    </MCard>
  );
}
