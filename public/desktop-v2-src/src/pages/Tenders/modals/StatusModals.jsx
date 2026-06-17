/**
 * Простые модалки изменения статуса тендера: Won / Lost / Cancel / Archive / Unarchive / ChangeAuthor.
 * Все идут через одинаковый паттерн: Form-with-textarea + Save-button.
 */
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextareaInput, SelectInput, MoneyInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { loadArchiveReasons, loadUsers, postArchive, postUnarchive, postChangeAuthor } from '../api';

function emitChanged() {
  window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
}

/* ─── Выигрыш ─── */
/* Источник: vanilla tenders.js → openWonModal (~3867..3938) + POST /api/tenders/:id/win.
   Поля payload: submission_price (без НДС), submission_price_with_vat, win_comment.
   Цена подачи без НДС обязательна; "с НДС" авто-пересчёт по vat_pct (по умолч. 22%, fetch /api/settings/vat_default_pct). */
const VAT_DEFAULT_PCT = 22;

export function WonModal({ tender }) {
  const { close } = useModal();
  const [vatPct, setVatPct] = useState(VAT_DEFAULT_PCT);
  const vatMul = 1 + vatPct / 100;
  const initNoVat = Number(tender?.submission_price || tender?.tender_price || 0) || '';
  const initWithVat = initNoVat ? Math.round(initNoVat * (1 + VAT_DEFAULT_PCT / 100) * 100) / 100 : '';

  const [priceNoVat, setPriceNoVat] = useState(String(initNoVat || ''));
  const [priceWithVat, setPriceWithVat] = useState(String(initWithVat || ''));
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [vatTouched, setVatTouched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('/api/settings/vat_default_pct')
      .then((res) => {
        if (cancelled) return;
        const v = Number(res?.value);
        if (Number.isFinite(v) && v >= 0 && v <= 100) {
          setVatPct(v);
          // Если пользователь ещё не трогал — пересчитать "с НДС" по реальной ставке
          if (!vatTouched && priceNoVat) {
            const n = Number(priceNoVat);
            if (n > 0) setPriceWithVat(String(Math.round(n * (1 + v / 100) * 100) / 100));
          }
        }
      })
      .catch(() => { /* fallback to VAT_DEFAULT_PCT */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNoVat = (v) => {
    setVatTouched(true);
    setPriceNoVat(v);
    const n = Number(v);
    setPriceWithVat(n > 0 ? String(Math.round(n * vatMul * 100) / 100) : '');
  };
  const handleWithVat = (v) => {
    setVatTouched(true);
    setPriceWithVat(v);
    const n = Number(v);
    setPriceNoVat(n > 0 ? String(Math.round((n / vatMul) * 100) / 100) : '');
  };

  const save = async () => {
    const finalNoVat = Number(priceNoVat) || (priceWithVat ? Math.round((Number(priceWithVat) / vatMul) * 100) / 100 : 0);
    const finalWithVat = Number(priceWithVat) || (priceNoVat ? Math.round(Number(priceNoVat) * vatMul * 100) / 100 : 0);
    if (!finalNoVat && !finalWithVat) {
      return toast('Проверка', 'Укажите цену подачи', 'warn');
    }

    setBusy(true);
    try {
      await api(`/api/tenders/${tender.id}/win`, {
        method: 'POST',
        body: {
          submission_price: finalNoVat,
          submission_price_with_vat: finalWithVat,
          win_comment: comment.trim()
        }
      });
      toast('🏆 Тендер выигран', `#${tender.id} — рук. ТО назначит РП на работы`, 'ok');
      emitChanged();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="🏆" title="Отметить выигрыш" subtitle={`#${tender.id} · ${tender.customer_name || ''}`} accent="gold" />
      <MBody>
        <div className="col gap-14">
          <div className="grid-2 gap-12">
            <Field label="Цена подачи без НДС, ₽" required>
              <MoneyInput value={priceNoVat} onChange={handleNoVat} />
            </Field>
            <Field label={`Цена подачи с НДС ${vatPct}%, ₽`}>
              <MoneyInput value={priceWithVat} onChange={handleWithVat} />
            </Field>
          </div>
          <div className="fs-12 c-t3 hint-tight">
            Из «Цена подачи». Поправьте, если победили по другой сумме (торги/переторжка). НМЦ не изменится.
          </div>
          <Field label="Комментарий">
            <TextareaInput value={comment} onChange={setComment} placeholder="Торги / переторжка / особые условия" />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : '🏆 Подтвердить победу'}</Btn>
      </MFoot>
    </MCard>
  );
}

/* ─── Проигрыш ─── */
/* Источник: vanilla tenders.js → openLostModal (~3944..4004) + POST /api/tenders/:id/lose.
   Поля payload: reject_reason, cover_letter (анализ для команды, мин. 20 символов), winner_name. */
const LOST_REASONS = [
  { value: 'Цена выше конкурента',           label: 'Цена выше конкурента' },
  { value: 'Сроки не подошли заказчику',     label: 'Сроки не подошли заказчику' },
  { value: 'Выбрали другого подрядчика',     label: 'Выбрали другого подрядчика' },
  { value: 'Не прошли квалификацию',         label: 'Не прошли квалификацию' },
  { value: 'Отказались от выполнения',       label: 'Отказались от выполнения' },
  { value: 'Технические требования',         label: 'Технические требования' },
  { value: 'Конкурент с админ. ресурсом',    label: 'Конкурент с админ. ресурсом' },
  { value: 'Другое',                         label: 'Другое' }
];

export function LostModal({ tender }) {
  const { close } = useModal();
  const [rejectReason, setRejectReason] = useState('');
  const [winnerName, setWinnerName] = useState('');
  const [coverLetter, setCoverLetter] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!rejectReason) return toast('Проверка', 'Выберите причину', 'warn');
    if (!coverLetter.trim() || coverLetter.trim().length < 20) {
      return toast('Проверка', 'Сопроводительное письмо: минимум 20 символов', 'warn');
    }
    setBusy(true);
    try {
      await api(`/api/tenders/${tender.id}/lose`, {
        method: 'POST',
        body: {
          reject_reason: rejectReason,
          cover_letter: coverLetter.trim(),
          winner_name: winnerName.trim()
        }
      });
      toast('Зафиксировано', `#${tender.id} — поражение и анализ сохранены`, 'ok');
      emitChanged();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="❌" title="Отметить проигрыш" subtitle={`#${tender.id} · ${tender.customer_name || ''}`} accent="red" />
      <MBody>
        <div className="col gap-14">
          <div className="alert-err-soft">
            Зафиксируем причину для аналитики и сопроводительное письмо — поможет команде сделать выводы.
          </div>
          <Field label="Причина проигрыша" required>
            <SelectInput
              value={rejectReason}
              onChange={setRejectReason}
              options={[{ value: '', label: '— выберите —' }, ...LOST_REASONS]}
            />
          </Field>
          <Field label="Кто выиграл (если известно)">
            <TextareaInput
              value={winnerName}
              onChange={setWinnerName}
              placeholder="Название организации-победителя"
              minRows={1}
              maxRows={2}
            />
          </Field>
          <Field
            label="Сопроводительное письмо — анализ для команды"
            required
            help="Это видят все — РП, директора, Рук. ТО. Помогает развивать компанию. Минимум 20 символов."
          >
            <TextareaInput
              value={coverLetter}
              onChange={setCoverLetter}
              placeholder="Что узнали, какие выводы, что учесть в следующий раз…"
              minRows={4}
              maxRows={8}
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : '❌ Зафиксировать поражение'}</Btn>
      </MFoot>
    </MCard>
  );
}

/* ─── Отмена ─── */
/* Источник: vanilla tenders.js → openCancelModal (~4009..4047) + POST /api/tenders/:id/cancel.
   Поле payload: cancel_reason (минимум 5 символов). */
export function CancelModal({ tender }) {
  const { close } = useModal();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!reason.trim() || reason.trim().length < 5) {
      return toast('Проверка', 'Укажите причину (минимум 5 символов)', 'warn');
    }
    setBusy(true);
    try {
      await api(`/api/tenders/${tender.id}/cancel`, {
        method: 'POST',
        body: { cancel_reason: reason.trim() }
      });
      toast('Сохранено', `#${tender.id} — тендер отменён и перенесён в архив`, 'ok');
      emitChanged();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="🚫" title="Тендер отменён" subtitle={`#${tender.id}`} accent="red" />
      <MBody>
        <div className="fs-13 muted-2 mb-10">
          Заказчик отменил тендер. Опишите кратко обстоятельства.
        </div>
        <Field label="Причина отмены" required>
          <TextareaInput
            value={reason}
            onChange={setReason}
            placeholder="Заказчик переиграл закупку / нет финансирования / отложили на год…"
            minRows={3}
            maxRows={6}
          />
        </Field>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Назад</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : '⊘ Подтвердить отмену'}</Btn>
      </MFoot>
    </MCard>
  );
}

/* ─── В архив ─── */
export function ArchiveModal({ tender }) {
  const { close } = useModal();
  const [reasonId, setReasonId] = useState('');
  const [comment, setComment] = useState('');
  const [reasons, setReasons] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadArchiveReasons().then((rs) => setReasons(rs.map((r) => ({ value: String(r.id || r), label: r.name || r.label || String(r) }))));
  }, []);

  const save = async () => {
    if (!reasonId && !comment.trim()) return toast('Укажи причину', '', 'warn');
    setBusy(true);
    try {
      await postArchive(tender.id, { reason_id: reasonId || null, comment });
      toast('📁 В архиве', `#${tender.id}`, 'ok');
      emitChanged();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="📁" title="В архив" subtitle={`#${tender.id}`} />
      <MBody>
        <div className="col gap-14">
          <Field label="Причина">
            <SelectInput value={reasonId} onChange={setReasonId} options={[{ value: '', label: '— из списка —' }, ...reasons]} />
          </Field>
          <Field label="Комментарий">
            <TextareaInput value={comment} onChange={setComment} placeholder="Если нужно дополнить" />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : '📁 В архив'}</Btn>
      </MFoot>
    </MCard>
  );
}

/* ─── Из архива ─── */
export function UnarchiveModal({ tender }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await postUnarchive(tender.id);
      toast('♻️ Из архива', `#${tender.id}`, 'ok');
      emitChanged();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="♻️" title="Восстановить из архива" subtitle={`#${tender.id}`} />
      <MBody>
        <p className="muted-2">
          Тендер #{tender.id} ({tender.customer_name}) вернётся в активные.
        </p>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Восстанавливаем…' : '♻️ Восстановить'}</Btn>
      </MFoot>
    </MCard>
  );
}

/* ─── Смена автора (ADMIN) ─── */
export function ChangeAuthorModal({ tender }) {
  const { close } = useModal();
  const [newAuthorId, setNewAuthorId] = useState('');
  const [comment, setComment] = useState('');
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadUsers().then((list) => setUsers(list.map((u) => ({ value: String(u.id), label: `${u.name || u.login} · ${u.role || ''}` }))));
  }, []);

  const save = async () => {
    if (!newAuthorId) return toast('Выберите автора', '', 'warn');
    setBusy(true);
    try {
      await postChangeAuthor(tender.id, { new_author_id: Number(newAuthorId), comment });
      toast('Автор изменён', `#${tender.id}`, 'ok');
      emitChanged();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="👤" title="Сменить автора тендера" subtitle={`#${tender.id}`} />
      <MBody>
        <div className="col gap-14">
          <Field label="Новый автор" required>
            <SelectInput value={newAuthorId} onChange={setNewAuthorId} options={[{ value: '', label: '— выбрать —' }, ...users]} />
          </Field>
          <Field label="Причина смены">
            <TextareaInput value={comment} onChange={setComment} />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Подтвердить'}</Btn>
      </MFoot>
    </MCard>
  );
}
