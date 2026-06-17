/**
 * Кнопки workflow в карточке тендера.
 * Источник: vanilla tenders.js:3788-3837.
 *   btnDist             — «📤 Отправить на анализ» (status → 'На анализе')
 *                          для TO/HEAD_TO/ADMIN, доступно из 'Новый'/'Черновик'.
 *   btnSentToClient     — «✉ КП отправлено клиенту» (status → 'КП отправлено')
 *                          доступно из 'Готово к отправке КП'.
 *   btnCreateTkp        — «📄 Создать ТКП» — открывает форму ТКП с прелитом из тендера.
 *
 * Все идут через выделенные endpoints (PUT /api/tenders/:id для смены статуса
 * и POST /api/tkp для создания ТКП). Никаких `gotoLegacy` / `location.href`.
 */
import { useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { ConfirmModal } from '@/modals';
import { TkpFormModal } from '@/pages/Tkp/modals/TkpForm';
import { markTenderSentToClient } from '../api';
import { api } from '@/api/client';

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
}

const DIST_ROLES = ['TO', 'HEAD_TO', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const SENT_ROLES = ['ADMIN', 'TO', 'HEAD_TO', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const TKP_ROLES  = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function WorkflowActions({ tender, onChanged }) {
  const { user } = useAuth();
  const modal = useModal();
  const [busy, setBusy] = useState(null);

  if (!tender || !user) return null;
  const status = tender.tender_status;

  const canDist = DIST_ROLES.includes(user.role) && (status === 'Новый' || status === 'Черновик');
  const canSent = SENT_ROLES.includes(user.role) && status === 'Готово к отправке КП';
  const canTkp  = TKP_ROLES.includes(user.role)  && status !== 'Не подходит' && status !== 'Проиграли';

  if (!canDist && !canSent && !canTkp) return null;

  /* btnDist (vanilla tenders.js:3788-3804) — sendToAnalysis. */
  const sendToAnalysis = () => {
    modal.open(
      <ConfirmModal
        title="Отправить тендер на анализ"
        message={`Тендер «${tender.customer_name || ''}» уйдёт Рук. ТО на анализ. Продолжить?`}
        tone="info"
        okText="📤 Отправить"
        onConfirm={async () => {
          setBusy('dist');
          try {
            await api(`/api/tenders/${tender.id}`, {
              method: 'PUT',
              body: { tender_status: 'На анализе' }
            });
            toast('Анализ', 'Тендер отправлен Рук. ТО', 'ok');
            emitChanged();
            onChanged?.();
          } catch (e) {
            toast('Ошибка', String(e?.message || e), 'err');
          } finally {
            setBusy(null);
          }
        }}
      />
    );
  };

  /* btnSentToClient (vanilla tenders.js:3823-3837). Бэк проверяет переход
     'Готово к отправке КП' → 'КП отправлено' (см. TENDER_TRANSITIONS, src/routes/tenders.js:16). */
  const markSent = () => {
    modal.open(
      <ConfirmModal
        title="КП отправлено клиенту"
        message="Отметить тендер как «КП отправлено клиенту»? Запустится follow-up по сроку ответа клиента."
        tone="info"
        okText="✉ Отправлено"
        onConfirm={async () => {
          setBusy('sent');
          try {
            await markTenderSentToClient(tender.id);
            toast('КП', 'Статус «КП отправлено» зафиксирован', 'ok');
            emitChanged();
            onChanged?.();
          } catch (e) {
            toast('Ошибка', String(e?.message || e), 'err');
          } finally {
            setBusy(null);
          }
        }}
      />
    );
  };

  /* btnCreateTkp (vanilla tenders.js:3808-3821). Открывает форму ТКП с tender_id-прелитом.
     На бэке POST /api/tkp выставит у тендера status='Готово к отправке КП' автоматически
     (см. src/routes/tkp.js + комментарий в tenders.js:7-8). */
  const openCreateTkp = () => {
    modal.open(
      <TkpFormModal
        editId={null}
        prefill={{
          tender_id: tender.id,
          customer_name: tender.customer_name || '',
          inn: tender.customer_inn || '',
          subject: `ТКП — ${tender.tender_title || tender.customer_name || ''}`
        }}
      />,
      { size: 'wide' }
    );
  };

  return (
    <div className="tnd-workflow row gap-8 wrap">
      {canDist && (
        <Btn
          variant="primary"
          size="sm"
          disabled={busy === 'dist'}
          onClick={sendToAnalysis}
          title="Передать тендер Рук. ТО на анализ"
        >{busy === 'dist' ? '…' : '📤 На анализ'}</Btn>
      )}
      {canSent && (
        <Btn
          variant="primary"
          size="sm"
          disabled={busy === 'sent'}
          onClick={markSent}
          title="Зафиксировать что КП отправлено клиенту"
        >{busy === 'sent' ? '…' : '✉ КП отправлено клиенту'}</Btn>
      )}
      {canTkp && (
        <Btn
          size="sm"
          onClick={openCreateTkp}
          title="Создать черновик ТКП по этому тендеру"
        >📄 Создать ТКП</Btn>
      )}
    </div>
  );
}
