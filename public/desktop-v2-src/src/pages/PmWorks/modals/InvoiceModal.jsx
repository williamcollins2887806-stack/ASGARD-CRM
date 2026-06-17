/**
 * InvoiceModal — выставление счёта по работе.
 * Источник: AsgardWorkDocuments.openInvoiceModal (work-documents.js:260-422).
 * Бэк: POST /api/invoices — принимает поля:
 *   invoice_number, invoice_date, invoice_type, status, work_id, act_id,
 *   customer_name, customer_inn, description, amount, vat_pct, total_amount,
 *   due_date, paid_amount
 * (см. src/routes/invoices.js:98-134).
 * Backend требует invoice_date + amount (400 без них).
 *
 * D-3 FIX (2026-06-14): vanilla-parity.
 *   - Было `issue_date` → надо `invoice_date` (вызывало 400 «Required fields: invoice_date»).
 *   - Было `pay_due_date` → надо `due_date` (silently дропалось бэком).
 *   - Было `note` → бэк его не принимает (silent drop). Поле удалено из payload.
 *   - НЕ слали customer_name/customer_inn/description/vat_pct/total_amount — счёт создавался без контрагента.
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, MoneyInput, DatePicker, TextareaInput, TextInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';

function todayIso() { return new Date().toISOString().slice(0, 10); }

function calcTotal(amount, vatPct) {
  const a = Number(amount) || 0;
  const v = Number(vatPct) || 0;
  return Math.round(a * (1 + v / 100) * 100) / 100;
}

function getToken() {
  try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; }
}

export function InvoiceModal({ work, invoice }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);
  // savedId — id выставленного счёта (текущей сессии модалки или переданного снаружи).
  // Используется для активации кнопки «📄 Скачать PDF» — vanilla work-documents.js:348-352:
  // PDF доступен только после успешного создания (есть invoice.id).
  const [savedId, setSavedId] = useState(invoice?.id || null);
  const [savedNumber, setSavedNumber] = useState(invoice?.invoice_number || '');
  const [form, setForm] = useState({
    work_id: work.id,
    invoice_number: invoice?.invoice_number || '',
    invoice_date: invoice?.invoice_date?.slice(0, 10) || todayIso(),
    invoice_type: invoice?.invoice_type || 'prepayment',
    customer_name: invoice?.customer_name || work.customer_name || '',
    customer_inn: invoice?.customer_inn || work.customer_inn || '',
    description: invoice?.description || work.work_title || '',
    amount: invoice?.amount ?? '',
    vat_pct: invoice?.vat_pct ?? 20,
    due_date: invoice?.due_date?.slice(0, 10) || ''
  });
  const [existing, setExisting] = useState([]);

  useEffect(() => {
    api('/api/invoices/next-number')
      .then((d) => {
        const n = d?.number || d?.next_number;
        if (n) setForm((s) => (s.invoice_number ? s : { ...s, invoice_number: n }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api(`/api/invoices?work_id=${work.id}`)
      .then((d) => setExisting(d.invoices || d.items || []))
      .catch(() => setExisting([]));
  }, [work.id]);

  const totalWithVat = calcTotal(form.amount, form.vat_pct);

  const save = async () => {
    if (!form.amount || Number(form.amount) <= 0) {
      return toast('Сумма', 'Укажи сумму счёта', 'warn');
    }
    if (!form.customer_name?.trim()) {
      return toast('Контрагент', 'Укажи контрагента', 'warn');
    }
    setBusy(true);
    try {
      const created = await api('/api/invoices', {
        method: 'POST',
        body: {
          // Vanilla-parity payload (work-documents.js:368-380), без `notes` (бэк не принимает).
          invoice_number: form.invoice_number?.trim() || undefined,
          invoice_date: form.invoice_date || todayIso(),   // ОБЯЗАТЕЛЬНО для бэка
          invoice_type: form.invoice_type,
          status: 'sent',                                  // vanilla ставит 'sent'
          work_id: work.id || undefined,
          customer_name: form.customer_name.trim(),
          customer_inn: form.customer_inn?.trim() || undefined,
          description: form.description?.trim() || undefined,
          amount: Number(form.amount),
          vat_pct: Number(form.vat_pct) || 0,
          total_amount: totalWithVat,
          due_date: form.due_date || undefined
        }
      });
      // vanilla work-documents.js:386-414: после успешного POST остаёмся в модалке,
      // показываем success-state с PDF-кнопкой. id берётся из created.invoice.id.
      const inv = created?.invoice || created;
      const newId = inv?.id || created?.id;
      const newNum = inv?.invoice_number || created?.invoice_number || '';
      if (newId) {
        setSavedId(newId);
        setSavedNumber(newNum || `#${newId}`);
      }
      toast('Счёт выставлен', `№ ${newNum || newId || ''}`, 'ok');
      window.dispatchEvent(new CustomEvent('asgard:works:changed'));
      setBusy(false);
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  // Открыть PDF в новой вкладке — vanilla pattern из work-documents.js:351:
  // `/api/invoices/${id}/pdf?token=${encodeURIComponent(token)}`.
  // Backend требует Bearer в query-token при window.open (нет JS-доступа к заголовкам).
  const openPdf = () => {
    if (!savedId) return;
    const token = getToken();
    window.open(`/api/invoices/${savedId}/pdf?token=${encodeURIComponent(token)}`, '_blank', 'noopener');
  };

  return (
    <MCard className="modal-md">
      <MHead icon="💰" title="Выставить счёт" subtitle={`Работа #${work.id} · ${work.customer_name || ''}`} accent="gold" onClose={close} />
      <MBody>
        <div className="col gap-12">
          <div className="grid-2 gap-8">
            <Field label="№ счёта" help="Пусто → авто">
              <TextInput value={form.invoice_number} onChange={(v) => setForm({ ...form, invoice_number: v })} placeholder="Напр. СЧ-2026-0145" />
            </Field>
            <Field label="Дата выставления" required>
              <DatePicker value={form.invoice_date} onChange={(v) => setForm({ ...form, invoice_date: v })} />
            </Field>
          </div>
          <Field label="Тип счёта">
            <SelectInput value={form.invoice_type} onChange={(v) => setForm({ ...form, invoice_type: v })} options={[
              { value: 'prepayment',   label: 'Авансовый' },
              { value: 'milestone',    label: 'Промежуточный (этап)' },
              { value: 'final',        label: 'Окончательный' },
              { value: 'other',        label: 'Другое' }
            ]} />
          </Field>
          <Field label="Контрагент" required>
            <TextInput value={form.customer_name} onChange={(v) => setForm({ ...form, customer_name: v })} placeholder="Наименование организации" />
          </Field>
          <div className="grid-2 gap-8">
            <Field label="ИНН">
              <TextInput value={form.customer_inn} onChange={(v) => setForm({ ...form, customer_inn: v })} placeholder="0000000000" />
            </Field>
            <Field label="Срок оплаты">
              <DatePicker value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} />
            </Field>
          </div>
          <Field label="Описание">
            <TextareaInput value={form.description} onChange={(v) => setForm({ ...form, description: v })} minRows={2} maxRows={6} placeholder="Описание выполненных работ" />
          </Field>
          <div className="grid-2 gap-8">
            <Field label="Сумма без НДС, ₽" required>
              <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
            </Field>
            <Field label="НДС, %">
              <TextInput value={String(form.vat_pct)} onChange={(v) => setForm({ ...form, vat_pct: v })} placeholder="20" />
            </Field>
          </div>

          <div className="existing-box" style={{ background: 'var(--bg-accent, rgba(0,0,0,.04))', padding: 10, borderRadius: 6 }}>
            <div className="existing-box-title">ИТОГО С НДС</div>
            <strong className="fs-18">{totalWithVat.toLocaleString('ru-RU')} ₽</strong>
          </div>

          {existing.length > 0 && (
            <div className="existing-box">
              <div className="existing-box-title">
                По этой работе уже выставлено · {existing.length}
              </div>
              {existing.slice(0, 5).map((i) => (
                <div key={i.id} className="existing-row">
                  <span>{i.invoice_number || `#${i.id}`} · {i.invoice_type || ''}</span>
                  <strong>{Number(i.total_amount || i.amount).toLocaleString('ru-RU')} ₽</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>{savedId ? 'Закрыть' : 'Отмена'}</Btn>
        <div className="row gap-6">
          {savedId && (
            <Btn variant="ghost" onClick={openPdf} title={`Скачать PDF счёта ${savedNumber || '#' + savedId}`}>
              📄 Скачать PDF
            </Btn>
          )}
          {!savedId && (
            <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : '💰 Выставить'}</Btn>
          )}
        </div>
      </MFoot>
    </MCard>
  );
}
