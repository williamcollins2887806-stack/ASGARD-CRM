/**
 * WorkExpensesModal — реестр расходов работы + позиции расхода + аттач чеков.
 *
 * E-6b (2026-06-14): миграция с legacy `expenses` страницы → React.
 * Vanilla: public/assets/js/work_expenses.js
 * Endpoints:
 *   GET  /api/expenses/work?work_id=…       — список расходов
 *   POST /api/expenses/work                 — создать расход
 *   GET  /api/expenses/items/:id            — позиции
 *   POST /api/expenses/items/:id            — добавить позицию
 *   POST /api/expenses/items/:id/bulk       — пакетно
 *   POST /api/expenses/attach/:id (multipart) — чек
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import {
  TextInput, MoneyInput, TextareaInput, SelectInput, DatePicker, FileDrop
} from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  loadWorkExpenses, loadExpenseItems, addExpense,
  addExpenseItem, attachExpenseFile, fmtMoney, fmtDate, loadExpenseCategories
} from '../api';
import { validateFile, MAX_ATTACHMENT_SIZE } from '@/api/upload';

// Канонические категории (см. src/services/expense-tax.js + работают с TAX_CATEGORIES).
// Категории, получающие 55%-нагрузку: cash, subcontract, per_diem, fot.
// Категории без 55% (но с НДС-вычетом если vat_amount явно > 0): materials, tickets,
// accommodation, transfer, other.
const DEFAULT_CATEGORIES = [
  { value: 'cash',        label: '💵 Наличные расходы (55%)' },
  { value: 'subcontract', label: '🤝 Субподряд / самозанятый (55%)' },
  { value: 'per_diem',    label: '🍽 Суточные (55%)' },
  { value: 'fot',         label: '👷 ФОТ — зарплата (55%)' },
  { value: 'materials',     label: '📦 Материалы (безнал)' },
  { value: 'tickets',       label: '✈️ Билеты (безнал)' },
  { value: 'accommodation', label: '🏨 Проживание (безнал)' },
  { value: 'transfer',      label: '🚚 Логистика (безнал)' },
  { value: 'other',         label: '📋 Прочее' }
];

// Подкатегории под 'cash' — детализация куда конкретно ушли наличные.
const DEFAULT_CASH_SUBCATEGORIES = [
  { value: '',                 label: '— не указана —' },
  { value: 'gsm',              label: '⛽ ГСМ' },
  { value: 'accommodation',    label: '🏨 Аренда жилья' },
  { value: 'transport',        label: '🚗 Транспорт / такси / аренда авто' },
  { value: 'food',             label: '🍽 Питание бригады' },
  { value: 'supplies',         label: '📦 Расходники / материалы' },
  { value: 'representational', label: '🎁 Представительские' },
  { value: 'services',         label: '🛠 Услуги' },
  { value: 'other',            label: '📋 Прочее' }
];

const DEFAULT_SUB_SUBCATEGORIES = [
  { value: '',                 label: '— не указана —' },
  { value: 'lathe',            label: '⚙️ Токарь' },
  { value: 'welder',           label: '🔥 Сварщик' },
  { value: 'other_contractor', label: '👷 Прочий подрядчик' }
];

const DEFAULT_PAYMENT_METHODS = [
  { value: 'cash', label: '💵 Наличные' },
  { value: 'card', label: '💳 Карта на месте' },
  { value: 'bank', label: '🏦 Безнал по счёту' },
  { value: 'self', label: '👤 Самозанятый' }
];

// Подкатегории по основной категории. NULL если детализация не нужна.
function getSubcategoryOptions(category, subcategories = {}) {
  if (category === 'cash') return subcategories.cash || DEFAULT_CASH_SUBCATEGORIES;
  if (category === 'subcontract') return subcategories.subcontract || DEFAULT_SUB_SUBCATEGORIES;
  return null;
}

// По умолчанию payment_method выбирается из основной категории.
function defaultPaymentMethod(category) {
  if (category === 'cash' || category === 'subcontract') return 'cash';
  if (category === 'fot' || category === 'per_diem') return 'auto';
  return 'bank';
}

export function WorkExpensesModal({ work, initialView }) {
  const { close } = useModal();
  const [expenses, setExpenses] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [items, setItems] = useState({}); // expense_id → items[]
  const [loading, setLoading] = useState(true);
  const [taxo, setTaxo] = useState({
    categories: DEFAULT_CATEGORIES,
    subcategories: { cash: DEFAULT_CASH_SUBCATEGORIES, subcontract: DEFAULT_SUB_SUBCATEGORIES },
    payment_methods: DEFAULT_PAYMENT_METHODS
  });
  // initialView='add' — открыть форму добавления расхода с чеком сразу (Кошелёк проекта).
  const [showAdd, setShowAdd] = useState(initialView === 'add');

  const refresh = () => {
    setLoading(true);
    loadWorkExpenses(work.id)
      .then(setExpenses)
      .catch(() => setExpenses([]))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [work?.id]);

  useEffect(() => {
    let off = false;
    loadExpenseCategories().then((d) => {
      if (off) return;
      setTaxo({
        categories: d.categories?.length ? d.categories.map((c) => ({ value: c.value, label: `${c.icon || '📋'} ${c.label}` })) : DEFAULT_CATEGORIES,
        subcategories: {
          cash: (d.subcategories?.cash || []).map((s) => ({ value: s.value, label: `${s.icon || '📋'} ${s.label}` })),
          subcontract: (d.subcategories?.subcontract || []).map((s) => ({ value: s.value, label: `${s.icon || '📋'} ${s.label}` }))
        },
        payment_methods: d.payment_methods?.length
          ? d.payment_methods.map((m) => ({ value: m.value, label: `${m.icon || '💳'} ${m.label}` }))
          : DEFAULT_PAYMENT_METHODS
      });
    });
    return () => { off = true; };
  }, []);

  const toggleItems = async (expId) => {
    if (expanded === expId) { setExpanded(null); return; }
    setExpanded(expId);
    if (!items[expId]) {
      const rows = await loadExpenseItems(expId);
      setItems((s) => ({ ...s, [expId]: rows }));
    }
  };

  const total = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return (
    <MCard className="modal-lg">
      <MHead
        icon="💰"
        title={'Расходы по работе #' + work.id}
        subtitle={work.work_title || ''}
        onClose={close}
      />
      <MBody>
        <div className="col gap-10">
          <div className="row-spread">
            <div className="fs-13 c-t2">
              Всего расходов: <b style={{ color: 'var(--gold)' }}>{fmtMoney(total)}</b> · позиций {expenses.length}
            </div>
            <Btn variant="primary" onClick={() => setShowAdd(true)}>+ Добавить расход</Btn>
          </div>

          {showAdd && (
            <AddExpenseForm
              work={work}
              taxo={taxo}
              onCancel={() => setShowAdd(false)}
              onSaved={() => { setShowAdd(false); refresh(); }}
            />
          )}

          {loading ? (
            <div className="c-t3 p-12">⏳ Загружаем…</div>
          ) : expenses.length === 0 ? (
            <div className="c-t3 p-12">📭 Расходов нет — добавь первый.</div>
          ) : (
            <div className="col gap-6">
              {expenses.map((e) => {
                const catLabel = taxo.categories.find((c) => c.value === e.category)?.label || ('📋 ' + (e.category || '—'));
                const subOpts = getSubcategoryOptions(e.category, taxo.subcategories);
                const subLabel = e.subcategory && subOpts
                  ? (subOpts.find((s) => s.value === e.subcategory)?.label || e.subcategory)
                  : null;
                const payLabel = taxo.payment_methods.find((p) => p.value === e.payment_method)?.label;
                return (
                <div key={e.id} className="p-10 bg-inner r-md">
                  <div className="row-spread">
                    <div className="col gap-2">
                      <strong>
                        {catLabel} {fmtMoney(e.amount)}
                      </strong>
                      <div className="c-t3 fs-12">
                        {fmtDate(e.date || e.created_at)}
                        {subLabel ? ' · ' + subLabel : ''}
                        {payLabel ? ' · ' + payLabel : ''}
                        {e.supplier ? ' · ' + e.supplier : ''}
                        {e.doc_number ? ' · №' + e.doc_number : ''}
                        {Number(e.vat_amount) > 0 ? ` · НДС ${fmtMoney(e.vat_amount)} к вычету` : ''}
                        {e.has_attachment || e.attachment_url ? ' · 📎 чек прикреплён' : ''}
                      </div>
                      {e.comment && <div className="fs-12">{e.comment}</div>}
                    </div>
                    <div className="row gap-4">
                      <Btn size="sm" variant="ghost" onClick={() => toggleItems(e.id)}>
                        {expanded === e.id ? '▼ Позиции' : '▶ Позиции'}
                      </Btn>
                      <AttachButton expense={e} onAttached={refresh} />
                    </div>
                  </div>
                  {expanded === e.id && (
                    <ExpenseItemsList
                      items={items[e.id] || []}
                      expenseId={e.id}
                      onAdded={async () => {
                        const rows = await loadExpenseItems(e.id);
                        setItems((s) => ({ ...s, [e.id]: rows }));
                      }}
                    />
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      </MBody>
      <MFoot align="end">
        <Btn onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

function AddExpenseForm({ work, taxo, onCancel, onSaved }) {
  const [form, setForm] = useState({
    category: 'cash',
    subcategory: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    supplier: '',
    doc_number: '',
    comment: '',
    payment_method: 'cash',
    vat_rate: '',
    vat_amount: ''
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  // Когда меняется основная категория — сбросить подкатегорию + поправить payment_method
  const setCategory = (v) => setForm((s) => ({
    ...s, category: v, subcategory: '', payment_method: defaultPaymentMethod(v)
  }));
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const subOptions = getSubcategoryOptions(form.category, taxo?.subcategories);
  const taxableSelected = ['cash', 'subcontract', 'per_diem', 'fot'].includes(form.category);

  const save = async () => {
    if (!(Number(form.amount) > 0)) return toast.error('Укажите сумму');
    setBusy(true);
    try {
      const created = await addExpense({
        work_id: work.id,
        category: form.category,
        subcategory: form.subcategory || null,
        amount: Number(form.amount),
        date: form.date || null,
        supplier: form.supplier || null,
        doc_number: form.doc_number || null,
        comment: form.comment || null,
        payment_method: form.payment_method,
        vat_rate: form.vat_rate ? Number(form.vat_rate) : null,
        vat_amount: form.vat_amount ? Number(form.vat_amount) : null,
        amount_ex_vat: (form.vat_amount && form.amount)
          ? Math.max(0, Number(form.amount) - Number(form.vat_amount))
          : null
      });
      const newId = created?.id || created?.expense?.id || created?.item?.id;
      if (file && newId) {
        try { await attachExpenseFile(newId, file); }
        catch (e) { toast('Файл', 'Не удалось прикрепить: ' + (e?.message || e), 'warn'); }
      }
      toast.success('Расход добавлен');
      onSaved?.();
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <div className="p-12 bg-inner r-md col gap-8">
      <div className="grid-2 gap-10">
        <Field label="Категория">
          <SelectInput value={form.category} onChange={setCategory} options={taxo?.categories || DEFAULT_CATEGORIES} />
        </Field>
        <Field label="Дата">
          <DatePicker value={form.date} onChange={(v) => set('date', v || '')} />
        </Field>
        {subOptions && (
          <Field label="Подкатегория">
            <SelectInput value={form.subcategory} onChange={(v) => set('subcategory', v)} options={subOptions} />
          </Field>
        )}
        <Field label="Сумма, ₽" required>
          <MoneyInput value={form.amount} onChange={(v) => set('amount', v)} />
        </Field>
        <Field label="Поставщик / получатель">
          <TextInput value={form.supplier} onChange={(v) => set('supplier', v)} />
        </Field>
        <Field label="Способ оплаты">
          <SelectInput value={form.payment_method} onChange={(v) => set('payment_method', v)} options={taxo?.payment_methods || DEFAULT_PAYMENT_METHODS} />
        </Field>
        <Field label="№ документа">
          <TextInput value={form.doc_number} onChange={(v) => set('doc_number', v)} />
        </Field>
        <Field label="НДС, % (если есть счёт-фактура)">
          <TextInput value={form.vat_rate} onChange={(v) => set('vat_rate', v)} placeholder="20 / 22 / 10" />
        </Field>
        <Field label="Сумма НДС, ₽">
          <MoneyInput value={form.vat_amount} onChange={(v) => set('vat_amount', v)} />
        </Field>
        <Field label="Комментарий">
          <TextInput value={form.comment} onChange={(v) => set('comment', v)} />
        </Field>
      </div>
      {taxableSelected && (
        <div className="fs-12 c-t3 p-6 bg-card r-sm">
          ℹ️ На эту запись начислится <b>55% налоговая нагрузка</b> (источник правды — payment_method).
          {form.vat_amount > 0 && <span> Указанная сумма НДС пойдёт в вычет.</span>}
        </div>
      )}
      <Field label="📎 Чек / счёт (PDF, JPG, PNG)">
        <FileDrop
          accept=".pdf,.jpg,.jpeg,.png"
          hint={file ? '📎 ' + file.name : 'Перетащи или выбери файл'}
          onFiles={(fs) => setFile(fs[0])}
        />
      </Field>
      <div className="row gap-6 items-end">
        <Btn onClick={onCancel}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : '💾 Сохранить'}</Btn>
      </div>
    </div>
  );
}

function ExpenseItemsList({ items, expenseId, onAdded }) {
  const [showAdd, setShowAdd] = useState(false);
  const [pos, setPos] = useState({ name: '', quantity: 1, price: '', unit: 'шт' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pos.name?.trim()) return toast.error('Укажите наименование');
    setBusy(true);
    try {
      await addExpenseItem(expenseId, {
        name: pos.name.trim(),
        quantity: Number(pos.quantity) || 1,
        price: Number(pos.price) || 0,
        unit: pos.unit || 'шт',
        amount: (Number(pos.quantity) || 1) * (Number(pos.price) || 0)
      });
      setPos({ name: '', quantity: 1, price: '', unit: 'шт' });
      setShowAdd(false);
      toast.success('Позиция добавлена');
      onAdded?.();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8 p-8 bg-card r-sm">
      <div className="row-spread mb-6">
        <strong className="fs-12">Позиции расхода ({items.length})</strong>
        {!showAdd && <Btn size="sm" variant="ghost" onClick={() => setShowAdd(true)}>+ Позиция</Btn>}
      </div>
      {items.length === 0 ? (
        <div className="c-t3 fs-12">Позиций нет</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--brd, #243049)', color: 'var(--t-3)' }}>
              <th style={{ textAlign: 'left', padding: '4px' }}>Наименование</th>
              <th style={{ textAlign: 'center', padding: '4px' }}>Кол-во</th>
              <th style={{ textAlign: 'right', padding: '4px' }}>Цена</th>
              <th style={{ textAlign: 'right', padding: '4px' }}>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--brd, #243049)' }}>
                <td style={{ padding: '3px 4px' }}>{r.name || '—'}</td>
                <td style={{ padding: '3px 4px', textAlign: 'center', color: 'var(--t-3)' }}>{r.quantity} {r.unit || ''}</td>
                <td style={{ padding: '3px 4px', textAlign: 'right', color: 'var(--t-3)' }}>{fmtMoney(r.price)}</td>
                <td style={{ padding: '3px 4px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(r.amount || (r.quantity * r.price))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showAdd && (
        <div className="mt-8 row gap-4 items-end">
          <TextInput value={pos.name} onChange={(v) => setPos({ ...pos, name: v })} placeholder="Наименование" />
          <TextInput value={pos.quantity} onChange={(v) => setPos({ ...pos, quantity: v })} placeholder="Кол-во" inputMode="numeric" />
          <TextInput value={pos.unit} onChange={(v) => setPos({ ...pos, unit: v })} placeholder="ед" />
          <MoneyInput value={pos.price} onChange={(v) => setPos({ ...pos, price: v })} />
          <Btn size="sm" disabled={busy} variant="primary" onClick={submit}>{busy ? '…' : '+'}</Btn>
          <Btn size="sm" onClick={() => setShowAdd(false)}>×</Btn>
        </div>
      )}
    </div>
  );
}

function AttachButton({ expense, onAttached }) {
  const [busy, setBusy] = useState(false);
  const onChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // G-5: размер/тип чека.
    try {
      validateFile(f, { maxSize: MAX_ATTACHMENT_SIZE, accept: '.pdf,.jpg,.jpeg,.png' });
    } catch (vErr) {
      toast.error(vErr?.message || 'Файл не подходит'); e.target.value = ''; return;
    }
    setBusy(true);
    try {
      await attachExpenseFile(expense.id, f);
      toast.success('Файл прикреплён');
      onAttached?.();
    } catch (err) {
      toast.error('Ошибка: ' + (err?.message || err));
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };
  return (
    <label className="btn-ghost" style={{ cursor: 'pointer', padding: '4px 8px', fontSize: 12 }}>
      {busy ? '⏳' : '📎 Чек'}
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={onChange} />
    </label>
  );
}
