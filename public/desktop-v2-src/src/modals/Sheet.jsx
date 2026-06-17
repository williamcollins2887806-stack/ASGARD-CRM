import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot } from './parts';

/**
 * Bottom Sheet — выезжающий снизу. На десктопе используется редко
 * (мобильный паттерн), но для action-sheet и picker'ов полезен.
 */
export function BottomSheet({ title, subtitle, icon = '↑', accent = 'default', children, footer, onClose }) {
  const { close } = useModal();
  const handleClose = () => { onClose?.(); close(); };
  return (
    <MCard>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
        <div style={{ width: 40, height: 4, background: 'var(--brd-1)', borderRadius: 999 }} />
      </div>
      {title && <MHead icon={icon} title={title} subtitle={subtitle} accent={accent} onClose={handleClose} />}
      <MBody>{children}</MBody>
      {footer && <MFoot align="center">{footer}</MFoot>}
    </MCard>
  );
}
