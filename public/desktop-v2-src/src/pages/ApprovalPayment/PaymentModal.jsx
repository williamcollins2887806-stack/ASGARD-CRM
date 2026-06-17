/**
 * Модалка выбора способа оплаты для бухгалтера.
 * Источник vanilla: showPaymentModal() в public/assets/js/approval_payment.js.
 *
 * 2 опции (карточки):
 *   💳 Платёжное поручение (ПП): только комментарий → /pay-bank
 *   💵 Наличные из кассы: сумма + комментарий → /issue-cash
 *
 * + Кнопки «На доработку» и «Вопрос» — через PromptModal.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { PromptModal } from '@/modals';
import { TextInput, MoneyInput, TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  payByBank, issueCash, rework, ask, loadComments,
  fmtMoney, fmtDateTime, entityLabel, paymentMeta
} from './api';

export function PaymentModal({ item, cashBalance, onDone }) {
  const { close, open } = useModal();
  const [method, setMethod] = useState(null); // 'bank' | 'cash' | null
  const [bankComment, setBankComment] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [cashComment, setCashComment] = useState('');
  const [comments, setComments] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadComments(item.entity_type, item.id).then((c) => !cancelled && setComments(c));
    return () => { cancelled = true; };
  }, [item.entity_type, item.id]);

  const payBank = async () => {
    setBusy(true);
    try {
      await payByBank(item.entity_type, item.id, bankComment.trim());
      toast('Оплачено', 'Платёж через ПП зафиксирован', 'ok');
      window.dispatchEvent(new CustomEvent('asgard:approval-payment:changed'));
      onDone?.();
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  const issueC = async () => {
    const amount = Number(cashAmount);
    if (!amount || amount <= 0) {
      toast('Проверьте сумму', 'Сумма должна быть положительной', 'err');
      return;
    }
    if (amount > Number(cashBalance || 0)) {
      toast('Недостаточно средств', `В кассе ${fmtMoney(cashBalance)}`, 'err');
      return;
    }
    setBusy(true);
    try {
      const r = await issueCash(item.entity_type, item.id, amount, cashComment.trim());
      toast('Выдано', `${fmtMoney(amount)} выдано из кассы. Баланс: ${fmtMoney(r?.cash_balance)}`, 'ok');
      window.dispatchEvent(new CustomEvent('asgard:approval-payment:changed'));
      onDone?.();
      close();
    } catch (e) {
      const msg = String(e?.message || e);
      toast('Ошибка', msg, 'err');
      setBusy(false);
    }
  };

  const askComment = (title, fn) => {
    open(
      <PromptModal
        title={title}
        label="Комментарий"
        placeholder="Напишите причину"
        multiline
        required
        accent={title === 'На доработку' ? 'warn' : 'info'}
        icon="✎"
        okText="Отправить"
        onSubmit={async (comm) => {
          try {
            await fn(item.entity_type, item.id, comm);
            toast('Отправлено', '', 'ok');
            window.dispatchEvent(new CustomEvent('asgard:approval-payment:changed'));
            onDone?.();
            close();
          } catch (e) {
            toast('Ошибка', String(e?.message || e), 'err');
          }
        }}
      />,
      { size: 'center' }
    );
  };

  const meta = paymentMeta(item.payment_status);

  return (
    <MCard className="modal-lg">
      <MHead
        icon="💸"
        title={`${entityLabel(item.entity_type)} #${item.id}`}
        subtitle={item.label || ''}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {/* Сводка */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 12,
            background: 'var(--inner-bg)',
            borderRadius: 'var(--r-md)',
            marginBottom: 14
          }}
        >
          <div>
            <div className="fs-11 c-t3 upper fw-700 ls-wide">
              Статус
            </div>
            <div className="mt-4">
              <Pill tone={meta.tone}>{meta.label}</Pill>
            </div>
          </div>
          <div className="t-right">
            <div className="fs-11 c-t3">Обновлено</div>
            <div className="fs-13 c-t2 fw-600">{fmtDateTime(item.updated_at)}</div>
          </div>
        </div>

        {/* Выбор метода */}
        <div className="label-cap-lg mb-8">
          Способ оплаты
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <button
            type="button"
            className={'pay-opt ' + (method === 'bank' ? 'pay-opt--on pay-opt--bank' : '')}
            onClick={() => setMethod('bank')}
          >
            <div className="pay-opt-ic">💳</div>
            <div className="pay-opt-ttl">Платёжное поручение</div>
            <div className="pay-opt-sub">Оплата через банк</div>
          </button>
          <button
            type="button"
            className={'pay-opt ' + (method === 'cash' ? 'pay-opt--on pay-opt--cash' : '')}
            onClick={() => setMethod('cash')}
          >
            <div className="pay-opt-ic">💵</div>
            <div className="pay-opt-ttl">Наличные из кассы</div>
            <div className="pay-opt-sub">Баланс: <b>{fmtMoney(cashBalance)}</b></div>
          </button>
        </div>

        {/* Форма ПП */}
        {method === 'bank' && (
          <div className="pay-form">
            <div className="pay-form-ttl">💳 Платёжное поручение</div>
            <label className="pay-lab">Комментарий</label>
            <TextInput
              value={bankComment}
              onChange={setBankComment}
              placeholder="Номер ПП, дата и т.д."
            />
            <Btn
              variant="info"
              block
              disabled={busy}
              onClick={payBank}
              className="mt-10"
            >
              {busy ? '…' : '💳 Оплачено'}
            </Btn>
          </div>
        )}

        {/* Форма Наличные */}
        {method === 'cash' && (
          <div className="pay-form pay-form--cash">
            <div className="pay-form-ttl">💵 Выдача наличных</div>
            <div className="pay-cash-banner">
              <div className="pay-cash-banner-lab">Баланс кассы</div>
              <div className="pay-cash-banner-val">{fmtMoney(cashBalance)}</div>
            </div>

            <label className="pay-lab">Сумма выдачи, ₽</label>
            <MoneyInput value={cashAmount} onChange={setCashAmount} />

            <label className="pay-lab mt-8" >Комментарий</label>
            <TextareaInput
              value={cashComment}
              onChange={setCashComment}
              placeholder="Кому, на что"
              minRows={2}
              maxRows={4}
            />

            <Btn
              variant="success"
              block
              disabled={busy}
              onClick={issueC}
              className="mt-10"
            >
              {busy ? '…' : '💵 Выдать наличные'}
            </Btn>
          </div>
        )}

        {/* Лента комментариев */}
        {comments.length > 0 && (
          <div className="mt-18">
            <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--t-3)', fontWeight: 700, marginBottom: 8 }}>
              Лента согласования ({comments.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflow: 'auto' }}>
              {comments.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: 8,
                    background: 'var(--inner-bg)',
                    borderRadius: 'var(--r-sm)',
                    fontSize: 12.5
                  }}
                >
                  <div className="u-flex" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
                    <strong>{c.user_name || '—'} <span style={{ color: 'var(--t-3)', fontWeight: 400 }}>· {c.action}</span></strong>
                    <span className="fs-11 c-t3">{fmtDateTime(c.created_at)}</span>
                  </div>
                  <div className="u-prewrap">{c.comment}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        <div className="u-flex gap-6">
          <Btn variant="warn" onClick={() => askComment('На доработку', rework)}>🔄 Доработать</Btn>
          <Btn variant="info" onClick={() => askComment('Вопрос', ask)}>❓ Вопрос</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
