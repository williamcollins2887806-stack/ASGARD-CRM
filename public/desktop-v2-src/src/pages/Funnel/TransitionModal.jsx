/**
 * Модалка перехода статуса при drag&drop карточки в воронке.
 * Источник логики: vanilla showTransitionModal в funnel.js.
 *
 * Сценарии:
 *  • Новый статус «Не подходит» — выбор категории отсева + комментарий → POST /archive
 *  • Новый «Проиграли» — причина (textarea) + кто победил → PUT (lost)
 *  • Новый «Выиграли» — сумма контракта → PUT (won)
 *  • Текущий «Не подходит» → «Новый» — комментарий → POST /unarchive
 *  • Текущий «Проиграли» → «Новый» — комментарий → PUT
 *  • Любой backward step — комментарий → PUT
 *  • Прямой переход вперёд (без особой логики) — без модалки (autoConfirm)
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextareaInput, SelectInput, MoneyInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  STAGES, loadArchiveReasons, postArchive, postUnarchive, putTender
} from './api';

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
}

function stageIndexOfStatus(status) {
  return STAGES.findIndex((s) => s.statuses.includes(status));
}

export function isBackwardTransition(currentStatus, newStatus) {
  const a = stageIndexOfStatus(currentStatus);
  const b = stageIndexOfStatus(newStatus);
  if (a < 0 || b < 0) return false;
  return b < a;
}

/** «Простой» прямой переход — без модалки, сразу PUT. */
export async function applySimpleTransition(tenderId, newStatus) {
  try {
    await putTender(tenderId, { tender_status: newStatus });
    toast.success('Статус: ' + newStatus);
    emitChanged();
    return true;
  } catch (e) {
    toast.error('Не удалось сменить статус: ' + (e?.message || e));
    return false;
  }
}

/* ── Архив (Не подходит) ───────────────────────────────────────────────── */
export function ArchiveTransitionModal({ tender }) {
  const { close } = useModal();
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [reasons, setReasons] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadArchiveReasons().then((rs) => {
      const arr = (rs || []).map((r) => (typeof r === 'string' ? r : (r.name || r.label || String(r))));
      setReasons(arr.map((s) => ({ value: s, label: s })));
    });
  }, []);

  const save = async () => {
    if (!reason) return toast.warn('Выберите категорию отсева');
    if (!comment.trim()) return toast.warn('Комментарий обязателен');
    setBusy(true);
    try {
      await postArchive(tender.id, { reason, comment });
      toast.success('Тендер #' + tender.id + ' отсеян');
      emitChanged();
      close();
    } catch (e) {
      toast.error('Не удалось отсеять: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead
        icon="📁"
        title="Отсеять тендер"
        subtitle={`#${tender.id} · ${tender.customer_name || ''}`}
        accent="warn"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Категория отсева" required>
            <SelectInput
              value={reason}
              onChange={setReason}
              options={reasons}
              placeholder="— Выберите категорию —"
            />
          </Field>
          <Field label="Комментарий" required>
            <TextareaInput
              value={comment}
              onChange={setComment}
              placeholder="Почему тендер не подходит?"
              minRows={3}
              maxRows={6}
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? 'Сохраняем…' : '📁 Отсеять'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/* ── Проигрыш ──────────────────────────────────────────────────────────── */
export function LostTransitionModal({ tender }) {
  const { close } = useModal();
  const [reason, setReason] = useState('');
  const [winner, setWinner] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!reason.trim()) return toast.warn('Укажите причину отказа');
    setBusy(true);
    try {
      await putTender(tender.id, {
        tender_status: 'Проиграли',
        reject_reason: reason,
        winner_name: winner || null
      });
      toast.success('Тендер #' + tender.id + ' → Проиграли');
      emitChanged();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead
        icon="❌"
        title="Проиграли тендер"
        subtitle={`#${tender.id} · ${tender.customer_name || ''}`}
        accent="danger"
        onClose={close}
      />
      <MBody>
        <div className="col gap-14">
          <Field label="Причина отказа" required>
            <TextareaInput
              value={reason}
              onChange={setReason}
              placeholder="Почему проиграли тендер?"
              minRows={3}
              maxRows={6}
            />
          </Field>
          <Field label="Кто победил">
            <TextareaInput
              value={winner}
              onChange={setWinner}
              placeholder="Название компании-победителя"
              minRows={1}
              maxRows={3}
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? 'Сохраняем…' : 'Подтвердить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/* ── Выигрыш ──────────────────────────────────────────────────────────── */
export function WonTransitionModal({ tender }) {
  const { close } = useModal();
  const [sum, setSum] = useState(tender.tender_price || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const n = Number(sum);
    if (!Number.isFinite(n) || n <= 0) return toast.warn('Укажите сумму контракта');
    setBusy(true);
    try {
      await putTender(tender.id, {
        tender_status: 'Выиграли',
        contract_sum: n
      });
      toast.success('🏆 Тендер #' + tender.id + ' выигран');
      emitChanged();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead
        icon="🏆"
        title="Выиграли тендер"
        subtitle={`#${tender.id} · ${tender.customer_name || ''}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <Field label="Сумма контракта" required>
          <MoneyInput value={sum} onChange={setSum} />
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? 'Сохраняем…' : 'Подтвердить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/* ── Возврат из архива (Не подходит → Новый) ─────────────────────────── */
export function UnarchiveTransitionModal({ tender }) {
  const { close } = useModal();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await postUnarchive(tender.id, { comment: comment || 'Возврат из архива' });
      toast.success('Тендер #' + tender.id + ' возвращён');
      emitChanged();
      close();
    } catch (e) {
      toast.error('Не удалось вернуть: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead
        icon="♻️"
        title="Вернуть из архива"
        subtitle={`#${tender.id}`}
        onClose={close}
      />
      <MBody>
        <Field label="Причина перезапуска">
          <TextareaInput
            value={comment}
            onChange={setComment}
            placeholder="Почему возвращаем тендер?"
            minRows={3}
            maxRows={6}
          />
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? 'Восстанавливаем…' : '♻️ Вернуть'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/* ── Любой обратный шаг (через PUT с comment) ────────────────────────── */
export function BackwardTransitionModal({ tender, newStatus }) {
  const { close } = useModal();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const body = { tender_status: newStatus };
      if (comment.trim()) body.status_comment = comment.trim();
      await putTender(tender.id, body);
      toast.success('Статус: ' + newStatus);
      emitChanged();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead
        icon="↩️"
        title="Вернуть на предыдущий этап"
        subtitle={`#${tender.id} → ${newStatus}`}
        onClose={close}
      />
      <MBody>
        <Field label="Комментарий">
          <TextareaInput
            value={comment}
            onChange={setComment}
            placeholder="Причина возврата"
            minRows={3}
            maxRows={6}
          />
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? 'Сохраняем…' : 'Подтвердить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
