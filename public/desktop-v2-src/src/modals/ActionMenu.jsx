import { useModal } from './ModalProvider';
import { MCard, MHead } from './parts';

/**
 * Контекстное меню действий. Используется когда у элемента 5+ действий.
 * items: [{ icon, label, desc?, meta?, danger?, onClick, soon? }, '---' (разделитель) ]
 */
export function ActionMenu({ title = 'Действия', subtitle, icon = '⋯', accent = 'default', items = [], onClose }) {
  const { close } = useModal();
  const handleClose = () => { onClose?.(); close(); };

  return (
    <MCard>
      <MHead icon={icon} title={title} subtitle={subtitle} accent={accent} onClose={handleClose} />
      <div className="m-menu" style={{ padding: '8px 4px 14px' }}>
        {items.map((it, i) => {
          if (it === '---' || it?.sep) return <div key={'s' + i} className="sep" />;
          if (it?.group) return <div key={'g' + i} className="grp">{it.group}</div>;
          return (
            <button
              key={'i' + i}
              className={'item ' + (it.danger ? 'danger' : '')}
              disabled={it.disabled || it.soon}
              onClick={() => { it.onClick?.(); close(); }}
            >
              <span className="ic">{it.icon}</span>
              <span className="flex-1">
                <span className="u-block">{it.label}</span>
                {it.desc && <span className="desc">{it.desc}</span>}
              </span>
              {it.meta && <span className="meta">{it.meta}</span>}
            </button>
          );
        })}
      </div>
    </MCard>
  );
}
