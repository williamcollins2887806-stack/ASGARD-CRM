/**
 * TkpForm — главная форма создания/редактирования ТКП.
 * Источник: openForm + buildFormHtml + addItemRow + recalcTotals в tkp_page.js.
 *
 * 4 секции:
 *  1. Заказчик (с поиском по ИНН/ДаДата)
 *  2. Предмет (название/тип/описание + AI-Мимир)
 *  3. Таблица работ (CRUD позиций + итоги без НДС / НДС / итого)
 *  4. Условия (сроки, способ оплаты, реквизиты автора)
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, TextInput, INNInput, PhoneInput, TextareaInput, SelectInput, NumberInput, Combobox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { useAuth } from '@/api/useAuth';
import {
  createTkp, updateTkp, loadTkp, customerByInn, lookupCustomers, mimirSuggest,
  previewTkpPdf, calcTotals, fmtMoney, VAT_PCT, PAYMENT_PRESETS
} from '../api';
import '../tkp.css';

// ── Auto-save черновика ТКП (vanilla паттерн как у TenderEditor) ─────────────
// Сохраняем форму нового ТКП каждые 10с в localStorage,
// при открытии — предлагаем восстановить.
const TKP_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function tkpDraftKey(userId) {
  return `tkp_form_draft_${userId || 'anon'}`;
}

function loadTkpDraft(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.updatedAt) return null;
    const age = Date.now() - new Date(obj.updatedAt).getTime();
    if (!Number.isFinite(age) || age > TKP_DRAFT_TTL_MS) {
      try { localStorage.removeItem(key); } catch { /* noop */ }
      return null;
    }
    return obj;
  } catch { return null; }
}

function saveTkpDraft(key, state) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
  } catch { /* quota / private mode — игнор */ }
}

function clearTkpDraft(key) {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

function isTkpFormDirty(state) {
  // Считаем форму «грязной» если есть customer_name / subject / items (>0).
  if (state?.customer_name?.trim()) return true;
  if (state?.subject?.trim()) return true;
  if (state?.description?.trim()) return true;
  if (Array.isArray(state?.items) && state.items.length > 0) return true;
  return false;
}

const EMPTY_FORM = {
  // 1. Заказчик
  customer_name: '', inn: '', kpp: '', address: '',
  contact_person: '', contact_phone: '', contact_email: '',
  // 2. Предмет
  subject: '', work_type: '', description: '',
  // 3. Таблица работ
  items: [],
  // 4. Условия
  validity_days: 30, term_days: '', payment_preset: '100_post',
  avans_pct: 0, postpay_days: 14, custom_payment_terms: '',
  author_name: '', author_position: '', author_phone: '', author_email: '',
  // Прочее
  tkp_number: '', tender_id: null
};

export function TkpFormModal({ editId, prefill }) {
  const { close } = useModal();
  const { user } = useAuth();
  const isNew = !editId;
  const draftKey = useMemo(() => (isNew ? tkpDraftKey(user?.id) : null), [isNew, user?.id]);

  // Восстановление черновика (новые ТКП без editId, без prefill — иначе перетрём).
  const [form, setForm] = useState(() => {
    const base = { ...EMPTY_FORM, ...(prefill || {}) };
    if (!isNew || prefill) return base;
    const draft = loadTkpDraft(tkpDraftKey(user?.id));
    if (!draft) return base;
    // Тихая проверка «есть ли что восстанавливать» (хоть одно осмысленное поле).
    if (!isTkpFormDirty(draft)) return base;
    // Восстанавливаем без подтверждения — UX как в vanilla (поля просто появятся).
    // Помечаем для последующего toast-уведомления.
    return { ...base, ...draft, __restored: true, updatedAt: undefined };
  });
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [companyOptions, setCompanyOptions] = useState([]);

  // Уведомить пользователя один раз о восстановлении.
  useEffect(() => {
    if (form?.__restored) {
      toast('Черновик восстановлен', 'Авто-сохранение каждые 10с', 'info');
      setForm((s) => ({ ...s, __restored: undefined }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editId) return;
    loadTkp(editId).then((data) => {
      if (!data) return;
      // Backend GET /api/tkp/:id отдаёт { item: {...} } (tkp.js:178).
      const t = data.item || data.tkp || data;
      // payment_terms приходит как JSON-строка из БД (text). Парсим обратно
      // в поля формы (payment_preset/avans_pct/postpay_days/custom_payment_terms).
      let payment_preset = EMPTY_FORM.payment_preset;
      let avans_pct = EMPTY_FORM.avans_pct;
      let postpay_days = EMPTY_FORM.postpay_days;
      let custom_payment_terms = '';
      if (t.payment_terms) {
        try {
          const pt = typeof t.payment_terms === 'string' ? JSON.parse(t.payment_terms) : t.payment_terms;
          if (pt && typeof pt === 'object') {
            payment_preset = pt.preset || payment_preset;
            if (pt.avans_pct != null) avans_pct = Number(pt.avans_pct);
            if (pt.postpay_days != null) postpay_days = Number(pt.postpay_days);
            custom_payment_terms = pt.custom || '';
          } else if (typeof pt === 'string') {
            custom_payment_terms = pt;
          }
        } catch { /* нечитаемый формат — оставляем дефолты */ }
      }
      // items — может быть JSON-строкой, массивом или объектом {items:[]}.
      let itemsArr = [];
      if (t.items) {
        if (Array.isArray(t.items)) itemsArr = t.items;
        else if (typeof t.items === 'string') {
          try { const parsed = JSON.parse(t.items); itemsArr = Array.isArray(parsed) ? parsed : (parsed?.items || []); } catch { itemsArr = []; }
        } else if (typeof t.items === 'object') {
          itemsArr = t.items.items || [];
        }
      }
      setForm({
        ...EMPTY_FORM,
        ...t,
        // Backend → frontend маппинг (обратное от POST tkp.js:191-195):
        address: t.customer_address || t.address || '',
        description: t.work_description || t.description || '',
        inn: t.customer_inn || t.inn || '',
        payment_preset,
        avans_pct,
        postpay_days,
        custom_payment_terms,
        items: itemsArr
      });
    });
  }, [editId]);

  // Auto-save каждые 10с (только для новых ТКП).
  const formRef = useRef(form);
  formRef.current = form;
  useEffect(() => {
    if (!draftKey) return;
    const id = setInterval(() => {
      const cur = formRef.current;
      if (!cur) return;
      // Не сохраняем пустую форму — чтобы не плодить мусор в LS.
      if (!isTkpFormDirty(cur)) return;
      saveTkpDraft(draftKey, cur);
    }, 10000);
    return () => clearInterval(id);
  }, [draftKey]);

  const totals = useMemo(() => calcTotals(form.items, VAT_PCT), [form.items]);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const addRow = () => {
    set('items', [...form.items, { id: Date.now(), name: '', unit: 'шт', qty: 1, price: 0 }]);
  };
  const updateRow = (idx, patch) => {
    const next = [...form.items];
    next[idx] = { ...next[idx], ...patch };
    set('items', next);
  };
  const removeRow = (idx) => {
    set('items', form.items.filter((_, i) => i !== idx));
  };

  const onInnLookup = async () => {
    if (!form.inn || form.inn.length < 10) return toast('ИНН', 'Введи 10 или 12 цифр', 'warn');
    setBusy(true);
    try {
      const res = await customerByInn(form.inn);
      if (res?.customer || res?.name) {
        const c = res.customer || res;
        setForm((s) => ({
          ...s,
          customer_name: c.name || c.full_name || s.customer_name,
          kpp: c.kpp || s.kpp,
          address: c.address || c.legal_address || s.address
        }));
        toast('ЕГРЮЛ', 'Заполнено из реестра', 'ok');
      } else {
        toast('ИНН', 'В реестре не найдено', 'warn');
      }
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const onAiDescription = async () => {
    if (!form.subject?.trim() && !form.work_type?.trim()) {
      return toast('Мимир', 'Заполни сначала Название работы или Тип', 'warn');
    }
    setAiBusy(true);
    try {
      const res = await mimirSuggest({ mode: 'description', subject: form.subject, work_type: form.work_type, customer_name: form.customer_name });
      if (res?.description) {
        set('description', res.description);
        toast('Мимир', 'Описание сгенерировано', 'ok');
      }
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setAiBusy(false);
    }
  };

  const onAiItems = async () => {
    if (!form.subject?.trim()) return toast('Мимир', 'Заполни Название работы', 'warn');
    setAiBusy(true);
    try {
      const res = await mimirSuggest({ mode: 'items', subject: form.subject, work_type: form.work_type, description: form.description });
      const items = res?.items || [];
      if (items.length === 0) return toast('Мимир', 'Не удалось сгенерировать позиции', 'warn');
      const generated = items.map((it, i) => ({
        id: Date.now() + i,
        name: it.name || it.title || '',
        unit: it.unit || 'шт',
        qty: it.qty || it.quantity || 1,
        price: it.price || it.cost || 0
      }));
      set('items', [...form.items, ...generated]);
      toast('Мимир', `Добавлено ${generated.length} позиций`, 'ok');
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setAiBusy(false);
    }
  };

  const onCustomerQuery = async (q) => {
    if (!q || q.length < 2) return;
    const opts = await lookupCustomers(q);
    setCompanyOptions(opts.map((c) => ({
      value: c.inn || c.id || c.name,
      label: `${c.name || c.full_name}${c.inn ? ' · ' + c.inn : ''}`,
      raw: c
    })));
  };

  const onPaymentPreset = (preset) => {
    const p = PAYMENT_PRESETS.find((x) => x.value === preset);
    if (!p) return;
    setForm((s) => ({
      ...s,
      payment_preset: preset,
      avans_pct: p.avans ?? s.avans_pct,
      postpay_days: p.postpay_days ?? s.postpay_days
    }));
  };

  const onPreviewPdf = async () => {
    if (!form.customer_name?.trim()) return toast('Заказчик', 'Укажи заказчика', 'warn');
    if (!form.items.length) return toast('Позиции', 'Добавь хотя бы одну позицию', 'warn');
    setBusy(true);
    try {
      const payload = {
        ...form,
        total_amount: totals.total,
        netto_amount: totals.netto,
        vat_amount: totals.vat,
        vat_pct: VAT_PCT,
        with_signature: true,
        with_stamp: true
      };
      const blob = await previewTkpPdf(payload);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const save = async (asReady = false) => {
    if (!form.customer_name?.trim()) return toast('Заказчик', 'Укажи заказчика', 'warn');
    if (!form.subject?.trim()) return toast('Предмет', 'Укажи название работы', 'warn');
    if (!form.items.length) return toast('Позиции', 'Добавь хотя бы одну позицию', 'warn');
    setBusy(true);
    try {
      const payload = {
        ...form,
        status: asReady ? 'ready' : 'draft',
        total_amount: totals.total,
        netto_amount: totals.netto,
        vat_amount: totals.vat,
        vat_pct: VAT_PCT
      };
      let saved;
      if (editId) {
        saved = await updateTkp(editId, payload);
      } else {
        saved = await createTkp(payload);
      }
      toast(asReady ? 'Готово' : 'Сохранено', `ТКП #${saved?.tkp?.id || saved?.id || ''}`, 'ok');
      window.dispatchEvent(new CustomEvent('asgard:tkp:changed'));
      // После успешного сохранения — удаляем LS-черновик новых ТКП.
      if (draftKey) clearTkpDraft(draftKey);
      close();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-xl">
      <MHead
        icon="📋"
        title={editId ? `ТКП #${editId}` : 'Новое ТКП'}
        subtitle={form.tkp_number ? `№ ${form.tkp_number}` : 'без номера'}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {/* 1. ЗАКАЗЧИК */}
        <Section title="1. Заказчик">
          <div className="tkp-grid-2">
            <Field label="Заказчик" required>
              <Combobox
                value={form.customer_name}
                onChange={(v, opt) => {
                  if (opt?.raw) {
                    setForm((s) => ({
                      ...s,
                      customer_name: opt.raw.name || opt.raw.full_name || v,
                      inn: opt.raw.inn || s.inn,
                      kpp: opt.raw.kpp || s.kpp,
                      address: opt.raw.address || s.address
                    }));
                  } else {
                    set('customer_name', v);
                  }
                }}
                options={companyOptions}
                onQuery={onCustomerQuery}
                placeholder="Начни вводить название или ИНН"
                allowFreeText
              />
            </Field>
            <Field label="ИНН">
              <div className="u-flex gap-6">
                <INNInput value={form.inn} onChange={(v) => set('inn', v)} />
                <Btn size="sm" variant="ghost" onClick={onInnLookup} title="Запрос в ЕГРЮЛ">🔄</Btn>
              </div>
            </Field>
            <Field label="КПП"><TextInput value={form.kpp} onChange={(v) => set('kpp', v)} maxLength={9} /></Field>
            <Field label="Адрес"><TextInput value={form.address} onChange={(v) => set('address', v)} /></Field>
            <Field label="Контактное лицо"><TextInput value={form.contact_person} onChange={(v) => set('contact_person', v)} /></Field>
            <Field label="Телефон"><PhoneInput value={form.contact_phone} onChange={(v) => set('contact_phone', v)} /></Field>
            <Field label="Email"><TextInput value={form.contact_email} onChange={(v) => set('contact_email', v)} /></Field>
          </div>
        </Section>

        {/* 2. ПРЕДМЕТ */}
        <Section title="2. Предмет ТКП">
          <Field label="Название работы" required>
            <TextInput value={form.subject} onChange={(v) => set('subject', v)} placeholder="Напр. «Капремонт кровли цеха №5»" />
          </Field>
          <div className="tkp-grid-1-2">
            <Field label="Тип работы">
              <SelectInput value={form.work_type} onChange={(v) => set('work_type', v)} options={[
                { value: '',         label: '—' },
                { value: 'repair',   label: 'Ремонт' },
                { value: 'install',  label: 'Монтаж' },
                { value: 'service',  label: 'Обслуживание' },
                { value: 'supply',   label: 'Поставка' },
                { value: 'other',    label: 'Другое' }
              ]} />
            </Field>
            <Field label="Описание работ" help="Можно сгенерировать через Мимира">
              <div className="tkp-ai-wrap">
                <TextareaInput value={form.description} onChange={(v) => set('description', v)} minRows={3} maxRows={8} />
                <div className="tkp-ai-btn">
                  <Btn size="sm" variant="ghost" disabled={aiBusy} onClick={onAiDescription} title="Мимир — сгенерировать описание">
                    {aiBusy ? '⏳' : '🧙'}
                  </Btn>
                </div>
              </div>
            </Field>
          </div>
        </Section>

        {/* 3. ТАБЛИЦА РАБОТ */}
        <Section title="3. Таблица работ" right={
          <div className="u-flex gap-6">
            <Btn size="sm" variant="ghost" disabled={aiBusy} onClick={onAiItems}>
              {aiBusy ? '⏳' : '🧙'} Сгенерировать позиции
            </Btn>
            <Btn size="sm" variant="primary" onClick={addRow}>+ Строка</Btn>
          </div>
        }>
          <div className="card tkp-items-card">
            <table className="t-list tkp-items-table">
              <thead>
                <tr className="tkp-items-thead-row">
                  <th className="tkp-col-40">№</th>
                  <th>Наименование</th>
                  <th className="tkp-col-80">Ед.</th>
                  <th className="tkp-col-90">Кол-во</th>
                  <th className="tkp-col-130">Цена</th>
                  <th className="tkp-col-130">Сумма</th>
                  <th className="tkp-col-40"></th>
                </tr>
              </thead>
              <tbody>
                {form.items.length === 0 && (
                  <tr><td colSpan={7} className="tkp-items-empty">
                    Позиций нет. Добавь через «+ Строка» или Мимир.
                  </td></tr>
                )}
                {form.items.map((it, i) => (
                  <tr key={it.id}>
                    <td className="tkp-cell-idx">{i + 1}</td>
                    <td><input className="m-input" value={it.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="Что делаем" /></td>
                    <td><input className="m-input" value={it.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} /></td>
                    <td><input className="m-input" type="number" min="0" step="0.01" value={it.qty} onChange={(e) => updateRow(i, { qty: e.target.value })} /></td>
                    <td><input className="m-input" type="number" min="0" step="0.01" value={it.price} onChange={(e) => updateRow(i, { price: e.target.value })} /></td>
                    <td className="t-right fw-600">{fmtMoney((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>
                    <td><button className="btn-ghost tkp-row-rm" onClick={() => removeRow(i)} title="Удалить">×</button></td>
                  </tr>
                ))}
                {form.items.length > 0 && (
                  <>
                    <tr className="bg-inner">
                      <td colSpan={5} className="tkp-totals-cell">Без НДС:</td>
                      <td className="tkp-totals-val">{fmtMoney(totals.netto)}</td>
                      <td></td>
                    </tr>
                    <tr className="bg-inner">
                      <td colSpan={5} className="tkp-totals-cell">НДС {VAT_PCT}%:</td>
                      <td className="t-right">{fmtMoney(totals.vat)}</td>
                      <td></td>
                    </tr>
                    <tr className="tkp-total-row">
                      <td colSpan={5} className="tkp-total-label">ИТОГО с НДС:</td>
                      <td className="tkp-total-val">{fmtMoney(totals.total)}</td>
                      <td></td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* 4. УСЛОВИЯ */}
        <Section title="4. Условия">
          <div className="tkp-grid-2">
            <Field label="Срок выполнения работ, дней">
              <NumberInput value={form.term_days} onChange={(v) => set('term_days', v)} min={1} />
            </Field>
            <Field label="Срок действия ТКП, дней">
              <NumberInput value={form.validity_days} onChange={(v) => set('validity_days', v)} min={1} />
            </Field>
            <Field label="Условия оплаты">
              <SelectInput value={form.payment_preset} onChange={onPaymentPreset} options={PAYMENT_PRESETS} />
            </Field>
            {form.payment_preset !== 'custom' ? (
              <div className="tkp-grid-1-1-tight">
                <Field label="Аванс %"><NumberInput value={form.avans_pct} onChange={(v) => set('avans_pct', v)} min={0} max={100} /></Field>
                <Field label="Постоплата дней"><NumberInput value={form.postpay_days} onChange={(v) => set('postpay_days', v)} min={0} /></Field>
              </div>
            ) : (
              <Field label="Свои условия оплаты">
                <TextareaInput value={form.custom_payment_terms} onChange={(v) => set('custom_payment_terms', v)} minRows={2} maxRows={4} />
              </Field>
            )}
          </div>

          <div className="tkp-author-box">
            <div className="tkp-author-eyebrow">
              Реквизиты автора (подпись под ТКП)
            </div>
            <div className="tkp-grid-2">
              <Field label="ФИО"><TextInput value={form.author_name} onChange={(v) => set('author_name', v)} /></Field>
              <Field label="Должность"><TextInput value={form.author_position} onChange={(v) => set('author_position', v)} /></Field>
              <Field label="Телефон"><PhoneInput value={form.author_phone} onChange={(v) => set('author_phone', v)} /></Field>
              <Field label="Email"><TextInput value={form.author_email} onChange={(v) => set('author_email', v)} /></Field>
            </div>
          </div>
        </Section>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <div className="u-flex gap-6">
          <Btn variant="ghost" disabled={busy} onClick={onPreviewPdf}>👁 Предпросмотр PDF</Btn>
          <Btn variant="ghost" disabled={busy} onClick={() => save(false)}>💾 Сохранить черновик</Btn>
          <Btn variant="primary" disabled={busy} onClick={() => save(true)}>✓ Готово</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}

function Section({ title, children, right }) {
  return (
    <div className="mb-18">
      <div className="tkp-section-head">
        <strong className="tkp-section-title">{title}</strong>
        {right}
      </div>
      <div className="col gap-10">{children}</div>
    </div>
  );
}
