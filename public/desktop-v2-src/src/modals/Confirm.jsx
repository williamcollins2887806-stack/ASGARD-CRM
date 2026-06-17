import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Btn } from './parts';

/**
 * Типы:
 *   tone = 'info'    — синий, для нейтральных вопросов
 *          'success' — зелёный
 *          'warn'    — оранжевый
 *          'danger'  — красный (удаление, опасное действие)
 *          'gold'    — золотой (одобрение)
 */
const TONE = {
  info:    { accent: 'info',    icon: 'ℹ️', btn: 'info' },
  success: { accent: 'success', icon: '✓',  btn: 'success' },
  warn:    { accent: 'warn',    icon: '⚠️', btn: 'warn' },
  danger:  { accent: 'danger',  icon: '⚠️', btn: 'danger' },
  gold:    { accent: 'gold',    icon: '✓',  btn: 'primary' }
};

export function ConfirmModal({
  title,
  message,
  tone = 'info',
  okText = 'Подтвердить',
  cancelText = 'Отмена',
  icon,
  onConfirm,
  onCancel
}) {
  const { close } = useModal();
  const t = TONE[tone] || TONE.info;

  return (
    <MCard className="frame-inside">
      <MHead icon={icon ?? t.icon} title={title} accent={t.accent} onClose={() => { onCancel?.(); close(); }} />
      <MBody>
        <p style={{ fontSize: 14, lineHeight: 1.5 }}>{message}</p>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => { onCancel?.(); close(); }}>{cancelText}</Btn>
        <Btn variant={t.btn} onClick={() => { onConfirm?.(); close(); }}>{okText}</Btn>
      </MFoot>
    </MCard>
  );
}
