import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Btn } from './parts';

const PRESETS = {
  success: { icon: '✓', accent: 'success', defaultTitle: 'Готово!' },
  info:    { icon: 'ℹ️', accent: 'info',    defaultTitle: 'Информация' },
  warn:    { icon: '⚠️', accent: 'warn',    defaultTitle: 'Внимание' },
  danger:  { icon: '⛔', accent: 'danger',  defaultTitle: 'Ошибка' }
};

/**
 * Простой alert без выбора (только OK).
 * tone: success / info / warn / danger
 */
export function AlertModal({
  tone = 'info',
  title,
  message,
  okText = 'OK',
  icon,
  onClose
}) {
  const { close } = useModal();
  const p = PRESETS[tone] || PRESETS.info;
  const handleClose = () => { onClose?.(); close(); };

  return (
    <MCard>
      <MHead icon={null} title={null} accent={p.accent} onClose={handleClose} />
      <MBody>
        <div className="m-alert">
          <div className="big-icon">{icon ?? p.icon}</div>
          <h3>{title ?? p.defaultTitle}</h3>
          <p>{message}</p>
        </div>
      </MBody>
      <MFoot align="center">
        <Btn variant="primary" onClick={handleClose}>{okText}</Btn>
      </MFoot>
    </MCard>
  );
}
