/**
 * Доп.соглашения (ДС) к выигранному тендеру.
 * Источник: vanilla tenders.js:2797-2907 (_openCreateAddendumModal + _loadAddenda).
 * Backend:
 *   GET /api/tenders/:id  → addenda[] + contract_value_main/_addenda/_total (src/routes/tenders.js:276)
 *   POST /api/works/addendum (src/routes/works.js:997) — создать ДС
 *   DELETE /api/works/:id — soft-delete ДС
 *
 * Создаются только PM/HEAD_PM/директором (см. ADDENDUM_ROLES в works.js:995).
 * Доступны только если есть основная (main) работа по тендеру.
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { ConfirmModal } from '@/modals';
import { Field, TextInput, MoneyInput, TextareaInput, NumberInput, DatePicker } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { loadTenderWithAddenda, createAddendum, deleteAddendum } from '../api';

const ADDENDA_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

/* ─── Модалка создания ДС ─── */
function AddDsModal({ parentWorkId, parentTitle, parentVatPct, onCreated }) {
  const { close } = useModal();
  const [form, setForm] = useState({
    work_title: '',
    contract_value: '',
    vat_pct: Number(parentVatPct) || 20,
    start_plan: '',
    end_plan: '',
    addendum_signed_date: '',
    addendum_reason: ''
  });
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    const value = Number(String(form.contract_value).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      return toast('ДС', 'Укажите сумму договора', 'warn');
    }
    setBusy(true);
    try {
      const res = await createAddendum({
        parent_work_id: parentWorkId,
        work_title: form.work_title.trim() || null,
        contract_value: value,
        vat_pct: Number(form.vat_pct) || 20,
        start_plan: form.start_plan || null,
        end_plan: form.end_plan || null,
        addendum_signed_date: form.addendum_signed_date || null,
        addendum_reason: form.addendum_reason.trim() || null
      });
      const num = res?.item?.addendum_number || '';
      toast('ДС', `Создано: ${num}`, 'ok');
      onCreated?.();
      close();
    } catch (e) {
      toast('ДС', String(e?.message || e), 'err');
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="📄" title="Создать доп. соглашение" subtitle={`К работе: ${parentTitle || ''}`} accent="gold" />
      <MBody>
        <div className="col gap-12">
          <Field label="Название ДС">
            <TextInput
              value={form.work_title}
              onChange={(v) => set('work_title', v)}
              placeholder="Название работ по ДС (необязательно)"
            />
          </Field>
          <Field label="Сумма договора, ₽" required>
            <MoneyInput value={form.contract_value} onChange={(v) => set('contract_value', v)} />
          </Field>
          <div className="grid-2 gap-10">
            <Field label="Дата подписания">
              <DatePicker value={form.addendum_signed_date} onChange={(v) => set('addendum_signed_date', v)} />
            </Field>
            <Field label="НДС, %">
              <NumberInput value={form.vat_pct} onChange={(v) => set('vat_pct', v)} min={0} max={30} />
            </Field>
          </div>
          <div className="grid-2 gap-10">
            <Field label="Плановое начало">
              <DatePicker value={form.start_plan} onChange={(v) => set('start_plan', v)} />
            </Field>
            <Field label="Плановое окончание">
              <DatePicker value={form.end_plan} onChange={(v) => set('end_plan', v)} />
            </Field>
          </div>
          <Field label="Основание">
            <TextareaInput
              value={form.addendum_reason}
              onChange={(v) => set('addendum_reason', v)}
              placeholder="Расширение объёма работ / изменение проекта / …"
              minRows={2}
              maxRows={5}
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>
          {busy ? 'Создаём…' : '💾 Создать ДС'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

/* ─── Вкладка ДС в карточке тендера ─── */
export default function AddendaTab({ tenderId }) {
  const { user } = useAuth();
  const modal = useModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    loadTenderWithAddenda(tenderId)
      .then((d) => setData(d || null))
      .finally(() => setLoading(false));
  }, [tenderId]);

  useEffect(() => {
    if (!tenderId) return;
    reload();
  }, [tenderId, reload]);

  if (loading) {
    return <div className="tnd-addenda-empty">⏳ Загружаем доп.соглашения…</div>;
  }
  if (!data) {
    return <div className="tnd-addenda-empty">Не удалось загрузить. Попробуйте позже.</div>;
  }

  const mainWork = (data.works || [])[0] || null;
  const addenda = data.addenda || [];
  const mv = data.contract_value_main || 0;
  const av = data.contract_value_addenda || 0;
  const tv = data.contract_value_total || (mv + av);
  const canCreate = mainWork && ADDENDA_ROLES.includes(user?.role);

  const openCreate = () => {
    if (!mainWork) {
      return toast('ДС', 'Сначала должна быть назначена основная работа по тендеру', 'warn');
    }
    modal.open(
      <AddDsModal
        parentWorkId={mainWork.id}
        parentTitle={mainWork.work_title}
        parentVatPct={mainWork.vat_pct}
        onCreated={reload}
      />
    );
  };

  const askDelete = (a) => {
    modal.open(
      <ConfirmModal
        title="Удалить ДС"
        message={`Удалить «${a.addendum_number}» на сумму ${fmtMoney(a.contract_value)}?`}
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteAddendum(a.id);
            toast('ДС', 'Удалено', 'ok');
            reload();
          } catch (e) {
            toast('Ошибка', String(e?.message || e), 'err');
          }
        }}
      />
    );
  };

  return (
    <div className="tnd-addenda">
      <div className="tnd-addenda-head">
        <strong>📑 Доп.соглашения</strong>
        {canCreate && (
          <Btn size="sm" variant="primary" onClick={openCreate}>＋ Создать ДС</Btn>
        )}
      </div>

      {(mv > 0 || av > 0) && (
        <div className="tnd-addenda-summary">
          <div className="tnd-addenda-sum-box">
            <div className="tnd-addenda-sum-label">Основной договор</div>
            <div className="tnd-addenda-sum-val">{fmtMoney(mv)}</div>
          </div>
          <div className="tnd-addenda-sum-box">
            <div className="tnd-addenda-sum-label">Доп.соглашения</div>
            <div className="tnd-addenda-sum-val">{fmtMoney(av)}</div>
          </div>
          <div className="tnd-addenda-sum-box tnd-addenda-sum-total">
            <div className="tnd-addenda-sum-label">Итого</div>
            <div className="tnd-addenda-sum-val">{fmtMoney(tv)}</div>
          </div>
        </div>
      )}

      {!mainWork && (
        <div className="tnd-addenda-empty">
          ДС появятся после того, как HEAD_TO назначит РП на работы (см. блок «🏆 Выиграны» в реестре).
        </div>
      )}

      {mainWork && !addenda.length && (
        <div className="tnd-addenda-empty">Нет доп.соглашений. {canCreate && 'Создайте первое — кнопкой выше.'}</div>
      )}

      {addenda.length > 0 && (
        <table className="tnd-addenda-table">
          <thead>
            <tr>
              <th>Номер</th>
              <th>Название</th>
              <th className="t-right">Сумма</th>
              <th>Подписан</th>
              <th>Статус</th>
              {canCreate && <th></th>}
            </tr>
          </thead>
          <tbody>
            {addenda.map((a) => (
              <tr key={a.id}>
                <td className="tnd-addenda-num">{a.addendum_number || '—'}</td>
                <td>{a.work_title || '—'}</td>
                <td className="t-right">{fmtMoney(a.contract_value)}</td>
                <td>{fmtDate(a.addendum_signed_date)}</td>
                <td>{a.work_status || '—'}</td>
                {canCreate && (
                  <td>
                    <Btn size="sm" variant="ghost" onClick={() => askDelete(a)} title="Удалить">×</Btn>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
