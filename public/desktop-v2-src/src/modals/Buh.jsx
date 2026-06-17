/**
 * Финансовые модалки бухгалтерии — НЕ покрытые первой волной.
 * Реальные точки в проекте: approval_modals.js, approval_payment.js, cash.js.
 *
 *  1. BuhPayBankModal       — оплата через ПП (комментарий + файл платёжки)
 *  2. BuhIssueCashModal     — выдача наличных из кассы (показывает баланс + валидация)
 *  3. CashReceivedConfirm   — инициатор подтверждает «деньги получены»
 *  4. ExpenseReportModal    — инициатор прикладывает чеки + описание
 *  5. ReturnCashModal       — возврат остатка в кассу
 *  6. CashLimitWarning      — «недостаточно средств / превышен лимит»
 */
import { useState, useRef } from 'react';
import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input, Textarea } from './parts';

function money(n) {
  return (Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
}

/** Баланс-плашка для модалок над кассой */
function BalanceBadge({ balance, requested }) {
  const enough = requested ? requested <= balance : true;
  return (
    <div
      className="row-spread gap-16 r-md mb-14"
      style={{
        padding: '14px 18px',
        background: enough ? 'var(--ok-bg)' : 'var(--err-bg)',
        border: '1.5px solid ' + (enough ? 'color-mix(in srgb, var(--ok) 35%, transparent)' : 'color-mix(in srgb, var(--err) 35%, transparent)')
      }}
    >
      <div>
        <div className="fs-10 fw-700 c-t3 upper ls-wide">Баланс кассы</div>
        <div className="fs-22 fw-900 mt-2" style={{ color: enough ? 'var(--ok)' : 'var(--err)' }}>
          {money(balance)}
        </div>
      </div>
      {requested != null && (
        <div className="t-right">
          <div className="fs-10 fw-700 c-t3 upper ls-wide">
            {enough ? 'После выдачи' : 'Не хватает'}
          </div>
          <div className="fs-18 fw-800 c-t1 mt-2">
            {enough ? money(balance - requested) : money(requested - balance)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Загрузка файла (placeholder) */
function FileDrop({ onFile }) {
  const ref = useRef(null);
  const [name, setName] = useState('');
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="u-hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) { setName(f.name); onFile?.(f); }
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="w-full r-md bg-inner c-t2 col-center gap-6 cur-p"
        style={{
          padding: '20px 16px',
          border: '2px dashed var(--brd-1)',
          fontFamily: 'inherit'
        }}
      >
        <span className="fs-28">📎</span>
        {name ? (
          <span className="fw-600 c-gold">{name}</span>
        ) : (
          <>
            <span className="fw-600">Перетащите файл или нажмите</span>
            <span className="fs-11-5 c-t3">PDF / JPG / PNG / Excel — до 10 МБ</span>
          </>
        )}
      </button>
    </>
  );
}

/* 1. Оплата через ПП */
export function BuhPayBankModal({ requestTitle, amount, onSubmit, onClose }) {
  const { close } = useModal();
  const [comment, setComment] = useState('');
  const [file, setFile] = useState(null);
  const handleClose = () => { onClose?.(); close(); };
  const ok = file && comment.trim();
  return (
    <MCard>
      <MHead icon="💳" title="Оплата через ПП" subtitle={requestTitle} accent="info" onClose={handleClose} />
      <MBody>
        <div className="r-md bg-info mb-14" style={{ padding: '12px 16px', border: '1.5px solid color-mix(in srgb, var(--info) 25%, transparent)' }}>
          <div className="section-eyebrow">К оплате</div>
          <div className="fs-22 fw-900 c-info mt-2">{money(amount)}</div>
        </div>
        <Field label="Реквизиты платежа" required help="Номер ПП, банк, дата">
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="ПП №427 от 13.06.2026, Альфа-Банк" />
        </Field>
        <Field label="Скан платёжного поручения" required>
          <FileDrop onFile={setFile} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={handleClose}>Отмена</Btn>
        <Btn variant="info" disabled={!ok} onClick={() => { onSubmit?.({ comment, file }); close(); }}>✅ Подтвердить оплату</Btn>
      </MFoot>
    </MCard>
  );
}

/* 2. Выдача наличных из кассы (с балансом) */
export function BuhIssueCashModal({ requestTitle, amount: requested, balance = 0, onSubmit, onClose }) {
  const { close } = useModal();
  const [amount, setAmount] = useState(String(requested || ''));
  const [comment, setComment] = useState('');
  const handleClose = () => { onClose?.(); close(); };
  const num = Number(amount) || 0;
  const enough = num <= balance && num > 0;
  return (
    <MCard>
      <MHead icon="💵" title="Выдать из кассы" subtitle={requestTitle} accent="gold" onClose={handleClose} />
      <MBody>
        <BalanceBadge balance={balance} requested={num} />
        <Field label="Сумма к выдаче, ₽" required>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Комментарий">
          <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Дополнительно — для журнала кассы" />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={handleClose}>Отмена</Btn>
        <Btn variant="primary" disabled={!enough} onClick={() => { onSubmit?.({ amount: num, comment }); close(); }}>
          {enough ? '💵 Выдать ' + money(num) : 'Недостаточно средств'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/* 3. Инициатор подтверждает получение наличных */
export function CashReceivedConfirm({ amount, fromName = 'кассы', onSubmit, onClose }) {
  const { close } = useModal();
  const handleClose = () => { onClose?.(); close(); };
  return (
    <MCard>
      <MHead icon="✓" title="Подтверждение получения" subtitle="Вы получили деньги из кассы?" accent="success" onClose={handleClose} />
      <MBody>
        <div className="t-center" style={{ padding: '14px 0 6px' }}>
          <div className="fs-48 mb-12">💵</div>
          <div className="fs-28 fw-900 c-ok">{money(amount)}</div>
          <div className="fs-13 c-t3 mt-8">от {fromName}</div>
          <div className="fs-12 c-t3" style={{ maxWidth: 380, margin: '14px auto 0' }}>
            Подтвердив, вы признаёте получение этой суммы. После использования прикрепите чеки в разделе «Отчёт о расходах».
          </div>
        </div>
      </MBody>
      <MFoot align="center">
        <Btn variant="success" onClick={() => { onSubmit?.(); close(); }}>✓ Деньги получены</Btn>
      </MFoot>
    </MCard>
  );
}

/* 4. Отчёт о расходах с чеками */
export function ExpenseReportModal({ requestTitle, amount, onSubmit, onClose }) {
  const { close } = useModal();
  const [file, setFile] = useState(null);
  const [desc, setDesc] = useState('');
  const handleClose = () => { onClose?.(); close(); };
  const ok = file || desc.trim();
  return (
    <MCard>
      <MHead icon="📤" title="Отчёт о расходах" subtitle={requestTitle} accent="purple" onClose={handleClose} />
      <MBody>
        <div className="fs-13 c-t3 mb-14">
          Приложите чеки и/или опишите, на что потрачены <b className="c-gold">{money(amount)}</b>.
        </div>
        <Field label="Чеки одним файлом" help="Можно сшить в один PDF / архив">
          <FileDrop onFile={setFile} />
        </Field>
        <Field label="Описание расходов">
          <Textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Купил каску ×2, тросы ×10м, отвёртки набор. Чеки в файле." />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={handleClose}>Позже</Btn>
        <Btn variant="primary" disabled={!ok} onClick={() => { onSubmit?.({ file, desc }); close(); }}>📤 Отправить отчёт</Btn>
      </MFoot>
    </MCard>
  );
}

/* 5. Возврат остатка в кассу */
export function ReturnCashModal({ maxAmount, onSubmit, onClose }) {
  const { close } = useModal();
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const handleClose = () => { onClose?.(); close(); };
  const num = Number(amount) || 0;
  const ok = num > 0 && num <= maxAmount;
  return (
    <MCard>
      <MHead icon="↩️" title="Вернуть остаток в кассу" subtitle="Неиспользованная часть аванса" accent="success" onClose={handleClose} />
      <MBody>
        <div className="r-md bg-ok mb-14" style={{ padding: '12px 16px', border: '1.5px solid color-mix(in srgb, var(--ok) 30%, transparent)' }}>
          <div className="fs-11 c-t3 upper fw-700" style={{ letterSpacing: '0.12em' }}>На руках сейчас</div>
          <div className="fs-22 fw-900 c-ok mt-2">{money(maxAmount)}</div>
        </div>
        <Field label="Сумма к возврату, ₽" required>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" max={maxAmount} />
        </Field>
        <Field label="Комментарий">
          <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={handleClose}>Отмена</Btn>
        <Btn variant="success" disabled={!ok} onClick={() => { onSubmit?.({ amount: num, comment }); close(); }}>↩️ Вернуть {ok && money(num)}</Btn>
      </MFoot>
    </MCard>
  );
}

/* 6. Предупреждение «недостаточно средств / лимит» */
export function CashLimitWarning({ required, available, limit, onClose }) {
  const { close } = useModal();
  const handleClose = () => { onClose?.(); close(); };
  return (
    <MCard>
      <MHead icon="⛔" title="Недостаточно средств" accent="danger" onClose={handleClose} />
      <MBody>
        <div className="grid-2 gap-12">
          <div className="p-14 bg-inner r-md">
            <div className="fs-11 c-t3 upper fw-700">Требуется</div>
            <div className="fs-20 fw-900 c-err mt-2">{money(required)}</div>
          </div>
          <div className="p-14 bg-inner r-md">
            <div className="fs-11 c-t3 upper fw-700">В кассе</div>
            <div className="fs-20 fw-900 c-gold mt-2">{money(available)}</div>
          </div>
        </div>
        {limit != null && (
          <div className="mt-14 fs-13 c-t2">
            Лимит выдачи на сотрудника: <b>{money(limit)}</b>.
          </div>
        )}
        <div className="mt-14 fs-12-5 c-t3">
          Дождитесь пополнения кассы или попросите оплату через ПП.
        </div>
      </MBody>
      <MFoot align="center">
        <Btn variant="ghost" onClick={handleClose}>Понятно</Btn>
      </MFoot>
    </MCard>
  );
}
