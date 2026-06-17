import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, Btn } from './parts';
import { PromptModal } from './Prompt';

/**
 * Модалка согласования с 4 действиями.
 * Используется для: estimates, tkp, bonus_requests, procurement, etc.
 *
 * При выборе rework/question/reject — открывается ВЛОЖЕННАЯ модалка комментария
 * (демонстрация стека из 2 уровней).
 */
export function ApprovalModal({
  title = 'Согласование',
  subtitle,
  icon = '✓',
  accent = 'gold',
  summary,                  // JSX — что согласуют (карточка с инфой)
  onApprove,
  onRework,
  onQuestion,
  onReject,
  onClose
}) {
  const { open, close } = useModal();
  const handleClose = () => { onClose?.(); close(); };

  const askComment = (action, label, tone) => {
    open(
      <PromptModal
        title={action}
        subtitle={label}
        label="Комментарий"
        placeholder="Опишите, что именно нужно исправить / в чём вопрос…"
        multiline
        required
        accent={tone}
        icon="✎"
        okText="Отправить"
        onSubmit={(comment) => {
          if (action === 'На доработку') onRework?.(comment);
          if (action === 'Вопрос') onQuestion?.(comment);
          if (action === 'Отклонить') onReject?.(comment);
          // Закрываем И prompt И approval. PromptModal сам close() себя после onSubmit,
          // нам нужно дополнительно закрыть нижнюю approval.
          handleClose();
        }}
        /* при cancel/ESC у prompt — НЕ закрываем approval, юзер может выбрать другое действие */
      />,
      { size: 'center' }
    );
  };

  return (
    <MCard>
      <MHead icon={icon} title={title} subtitle={subtitle} accent={accent} onClose={handleClose} />
      <MBody>
        {summary}
      </MBody>
      <div style={{ padding: '6px 22px 18px' }}>
        <div className="m-approval">
          <Btn variant="success" onClick={() => { onApprove?.(); handleClose(); }}>✓ Согласовать</Btn>
          <Btn variant="warn" onClick={() => askComment('На доработку', 'Расчётчик доработает по комментарию', 'warn')}>↻ Доработать</Btn>
          <Btn variant="info" onClick={() => askComment('Вопрос', 'Уточнение по просчёту', 'info')}>❓ Вопрос</Btn>
          <Btn variant="danger" onClick={() => askComment('Отклонить', 'Тендер пометится как «Не подходит»', 'danger')}>✕ Отклонить</Btn>
        </div>
      </div>
    </MCard>
  );
}
