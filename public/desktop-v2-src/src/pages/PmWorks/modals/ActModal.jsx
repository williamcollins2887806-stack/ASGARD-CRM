/**
 * ActModal — оформление акта выполненных работ.
 * Источник: AsgardWorkDocuments.openActModal (work-documents.js:423-579).
 * Бэк: POST /api/acts — принимает поля:
 *   act_number, act_date, status, work_id, customer_name, customer_inn,
 *   description, amount, vat_pct, total_amount, signed_date, paid_date
 * (см. src/routes/acts.js:87-121).
 *
 * D-3 FIX (2026-06-14): vanilla-parity — раньше React слал act_type/period_from/period_to,
 * которые бэк silently дропал, и НЕ слал customer_name/customer_inn/vat_pct/total_amount —
 * акт создавался без контрагента и без суммы С НДС. Возвращаем 1:1 vanilla payload.
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, MoneyInput, DatePicker, TextareaInput, TextInput } from '@/inputs/Inputs';
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

export function ActModal({ work, act }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);
  // savedId — id оформленного акта. Активирует кнопку «📄 Скачать PDF»
  // (vanilla work-documents.js:508-512 — PDF доступен только после успешного POST).
  const [savedId, setSavedId] = useState(act?.id || null);
  const [savedNumber, setSavedNumber] = useState(act?.act_number || '');
  const [form, setForm] = useState({
    work_id: work.id,
    act_number: act?.act_number || '',
    act_date: act?.act_date?.slice(0, 10) || todayIso(),
    customer_name: act?.customer_name || work.customer_name || '',
    customer_inn: act?.customer_inn || work.customer_inn || '',
    description: act?.description || work.work_title || '',
    amount: act?.amount ?? (Number(work.contract_value || 0) > 0 ? Number(work.contract_value) : ''),
    vat_pct: act?.vat_pct ?? 20,
    signed_date: act?.signed_date?.slice(0, 10) || ''
  });
  const [existing, setExisting] = useState([]);

  // Подтянуть авто-номер
  useEffect(() => {
    api('/api/acts/next-number')
      .then((d) => {
        const n = d?.number || d?.next_number;
        if (n) setForm((s) => (s.act_number ? s : { ...s, act_number: n }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api(`/api/acts?work_id=${work.id}`)
      .then((d) => setExisting(d.acts || d.items || []))
      .catch(() => setExisting([]));
  }, [work.id]);

  const totalWithVat = calcTotal(form.amount, form.vat_pct);

  const save = async () => {
    if (!form.amount || Number(form.amount) <= 0) return toast('Сумма', 'Укажи сумму акта', 'warn');
    if (!form.description?.trim()) return toast('Описание', 'Укажи что выполнено', 'warn');
    if (!form.customer_name?.trim()) return toast('Контрагент', 'Укажи контрагента', 'warn');
    setBusy(true);
    try {
      const created = await api('/api/acts', {
        method: 'POST',
        body: {
          // Vanilla-parity payload (work-documents.js:527-539). Все поля — из backend allowlist.
          act_number: form.act_number?.trim() || undefined,
          act_date: form.act_date || todayIso(),
          status: 'sent',                          // vanilla ставит 'sent' (не 'draft')
          work_id: work.id || undefined,
          customer_name: form.customer_name.trim(),
          customer_inn: form.customer_inn?.trim() || undefined,
          description: form.description.trim(),
          amount: Number(form.amount),
          vat_pct: Number(form.vat_pct) || 0,
          total_amount: totalWithVat,              // ОБЯЗАТЕЛЬНО: сумма С НДС (vanilla calcTotal)
          signed_date: form.signed_date || undefined
        }
      });
      // vanilla work-documents.js:544-571: после успешного POST остаёмся в модалке,
      // показываем success-state с PDF-кнопкой. id из created.act.id.
      const a = created?.act || created;
      const newId = a?.id || created?.id;
      const newNum = a?.act_number || created?.act_number || '';
      if (newId) {
        setSavedId(newId);
        setSavedNumber(newNum || `#${newId}`);
      }
      toast('Акт оформлен', `№ ${newNum || newId || ''}`, 'ok');
      window.dispatchEvent(new CustomEvent('asgard:works:changed'));
      setBusy(false);
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  // Открыть PDF в новой вкладке — vanilla pattern из work-documents.js:511:
  // `/api/acts/${id}/pdf?token=${encodeURIComponent(token)}`.
  // RFC 6266-кириллица в Content-Disposition в backend уже починена (см. задачу).
  const openPdf = () => {
    if (!savedId) return;
    const token = getToken();
    window.open(`/api/acts/${savedId}/pdf?token=${encodeURIComponent(token)}`, '_blank', 'noopener');
  };

  return (
    <MCard className="modal-md">
      <MHead icon="📋" title="Оформить акт" subtitle={`Работа #${work.id} · ${work.customer_name || ''}`} accent="gold" onClose={close} />
      <MBody>
        <div className="col gap-12">
          <div className="grid-2 gap-8">
            <Field label="№ акта">
              <TextInput value={form.act_number} onChange={(v) => setForm({ ...form, act_number: v })} placeholder="АКТ-2026-001" />
            </Field>
            <Field label="Дата акта">
              <DatePicker value={form.act_date} onChange={(v) => setForm({ ...form, act_date: v })} />
            </Field>
          </div>
          <Field label="Контрагент" required>
            <TextInput value={form.customer_name} onChange={(v) => setForm({ ...form, customer_name: v })} placeholder="Наименование организации" />
          </Field>
          <div className="grid-2 gap-8">
            <Field label="ИНН">
              <TextInput value={form.customer_inn} onChange={(v) => setForm({ ...form, customer_inn: v })} placeholder="0000000000" />
            </Field>
            <Field label="Дата подписания">
              <DatePicker value={form.signed_date} onChange={(v) => setForm({ ...form, signed_date: v })} />
            </Field>
          </div>
          <Field label="Что выполнено" required>
            <TextareaInput value={form.description} onChange={(v) => setForm({ ...form, description: v })} minRows={3} maxRows={8} placeholder="Перечень выполненных работ, объёмы, единицы измерения" />
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
                Уже оформлено актов · {existing.length}
              </div>
              {existing.slice(0, 5).map((a) => (
                <div key={a.id} className="existing-row">
                  <span>{a.act_number || `#${a.id}`} · {a.status || ''}</span>
                  <strong>{Number(a.total_amount || a.amount).toLocaleString('ru-RU')} ₽</strong>
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
            <Btn variant="ghost" onClick={openPdf} title={`Скачать PDF акта ${savedNumber || '#' + savedId}`}>
              📄 Скачать PDF
            </Btn>
          )}
          {!savedId && (
            <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : '📋 Оформить акт'}</Btn>
          )}
        </div>
      </MFoot>
    </MCard>
  );
}
