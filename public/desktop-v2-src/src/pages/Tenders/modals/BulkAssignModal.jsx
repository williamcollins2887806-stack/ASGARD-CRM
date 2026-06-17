/**
 * Массовое распределение тендеров (TO/HEAD_TO/ADMIN).
 * Использует POST /api/tenders/:id/assign-calculator { kind:'pm', user_id }
 * (src/routes/tenders.js:1203).
 *
 * Логика:
 *   • Один РП на все выбранные тендеры (или «без РП» — пропустить).
 *   • Фильтр по статусу (byStatus counts из props.tenders) — применять
 *     bulk-assign только к тендерам выбранного статуса.
 *   • Бэкенд распределяет ТОЛЬКО из «На анализе» (assign-calculator 1216-1218).
 *     Если выбран другой статус — тендеры будут отфильтрованы, но bulk
 *     завершится с err для каждого (бэк отдаст 400). Поэтому опции в селекте
 *     помечают, какие статусы реально eligible.
 *   • Поле «Причина переназначения» (reason) — обязательно.
 *   • Перед apply — ConfirmModal: «Назначить {pm} на {N} тендеров? Причина: {reason}».
 *   • После confirm — идём по очереди, копим ok/err, в конце один toast.
 */
import { useState, useEffect, useMemo } from 'react';
import { api } from '@/api/client';
import { useModal } from '@/modals';
import { ConfirmModal } from '@/modals/Confirm';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, SelectInput, TextInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { loadUsers } from '../api';

// Бэк-гейт: распределять можно ТОЛЬКО из «На анализе»
// (см. src/routes/tenders.js:1216-1218 assign-calculator).
const ELIGIBLE_STATUS = 'На анализе';

export default function BulkAssignModal({ tenders, onDone }) {
  const modal = useModal();
  const { close } = modal;
  const [pms, setPms] = useState([]);
  const [pmId, setPmId] = useState('');
  const [statusFilter, setStatusFilter] = useState(ELIGIBLE_STATUS);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    loadUsers('PM').then(setPms);
  }, []);

  // Считаем кол-во тендеров по статусам — для опций селекта «Статус».
  const byStatus = useMemo(() => {
    const acc = {};
    for (const t of tenders) {
      const k = t?.tender_status || '—';
      acc[k] = (acc[k] || 0) + 1;
    }
    return acc;
  }, [tenders]);

  // Опции селекта статусов (count по каждому статусу из props.tenders).
  // Дефолт — «На анализе» (единственный eligible на бэке), если такие есть;
  // иначе — первый по списку.
  const statusOptions = useMemo(() => {
    const entries = Object.entries(byStatus);
    return entries.map(([k, c]) => ({ value: k, label: `${k} (${c})` }));
  }, [byStatus]);

  useEffect(() => {
    // Если текущий statusFilter отсутствует в актуальных опциях — переключим
    // на первый доступный (или на ELIGIBLE_STATUS, если он есть).
    if (!statusOptions.length) return;
    const has = statusOptions.some((o) => o.value === statusFilter);
    if (!has) {
      const elig = statusOptions.find((o) => o.value === ELIGIBLE_STATUS);
      setStatusFilter(elig ? elig.value : statusOptions[0].value);
    }
  }, [statusOptions, statusFilter]);

  // Тендеры, к которым применим bulk-assign по выбранному статус-фильтру.
  // На бэке eligible == ELIGIBLE_STATUS, но пользователь может явно выбрать
  // другой статус (например, чтобы увидеть, сколько таких в выборке).
  const filtered = useMemo(
    () => tenders.filter((t) => (t?.tender_status || '—') === statusFilter),
    [tenders, statusFilter]
  );
  const filteredEligible = useMemo(
    () => filtered.filter((t) => t?.tender_status === ELIGIBLE_STATUS),
    [filtered]
  );
  const notEligibleInFilter = filtered.length - filteredEligible.length;

  const doApply = async () => {
    setBusy(true);
    setProgress(0);
    let ok = 0, err = 0;
    for (let i = 0; i < filtered.length; i++) {
      const t = filtered[i];
      try {
        await api(`/api/tenders/${t.id}/assign-calculator`, {
          method: 'POST',
          body: { kind: 'pm', user_id: Number(pmId), reason: reason.trim() }
        });
        ok++;
      } catch (e) {
        err++;
        // Сообщаем точную ошибку первого фейла, остальные молча — иначе спам.
        if (err === 1) toast(`Тендер #${t.id}`, String(e?.message || e), 'warn');
      }
      setProgress(i + 1);
    }
    const pmName = pms.find((u) => String(u.id) === String(pmId))?.name || 'РП';
    toast(
      'Распределение',
      `${pmName}: распределено ${ok}${err ? `, ошибок ${err}` : ''}${notEligibleInFilter ? `, не по статусу: ${notEligibleInFilter}` : ''}`,
      err ? 'warn' : 'ok'
    );
    setBusy(false);
    onDone?.();
    close();
  };

  const run = () => {
    if (!pmId) return toast('Распределение', 'Выберите РП', 'warn');
    const reasonClean = reason.trim();
    if (!reasonClean) {
      setReasonErr('Укажите причину переназначения');
      return toast('Распределение', 'Укажите причину переназначения', 'warn');
    }
    setReasonErr('');
    if (!filtered.length) {
      return toast('Распределение', `Нет тендеров в статусе «${statusFilter}»`, 'warn');
    }
    const pmName = pms.find((u) => String(u.id) === String(pmId))?.name || 'РП';
    // ConfirmModal перед apply (требование задачи D-71).
    modal.open(
      <ConfirmModal
        title="Массовое распределение"
        message={`Назначить ${pmName} на ${filtered.length} тендеров? Причина: ${reasonClean}`}
        tone="info"
        okText={`→ Назначить ${filtered.length}`}
        onConfirm={doApply}
      />
    );
  };

  return (
    <MCard className="modal-sm">
      <MHead
        icon="📤"
        title={`Распределить ${tenders.length} ${tenders.length === 1 ? 'тендер' : 'тендеров'}`}
        subtitle="Назначить расчётчиком — одного РП"
        accent="info"
      />
      <MBody>
        <div className="col gap-12">
          <Field label="Статус" required help={`Применить bulk-assign только к тендерам этого статуса. Бэк разрешает только «${ELIGIBLE_STATUS}».`}>
            <SelectInput
              value={statusFilter}
              onChange={setStatusFilter}
              options={statusOptions.length ? statusOptions : [{ value: '', label: '— нет тендеров —' }]}
            />
          </Field>
          <Field label="РП-расчётчик" required>
            <SelectInput
              value={pmId}
              onChange={setPmId}
              options={[
                { value: '', label: '— выбрать —' },
                ...pms.map((u) => ({ value: String(u.id), label: u.name || u.login }))
              ]}
            />
          </Field>
          <Field label="Причина переназначения" required error={reasonErr || undefined}>
            <TextInput
              value={reason}
              onChange={(v) => { setReason(v); if (reasonErr) setReasonErr(''); }}
              placeholder="Например: перераспределение нагрузки"
              maxLength={500}
            />
          </Field>
          <div className="fs-12 c-t3">
            • По статусу «{statusFilter}»: <strong>{filtered.length}</strong><br />
            {statusFilter !== ELIGIBLE_STATUS && filtered.length > 0 && (
              <>• Бэк отклонит — статус ≠ «{ELIGIBLE_STATUS}» (нужно перевести вручную)<br /></>
            )}
            {statusFilter === ELIGIBLE_STATUS && notEligibleInFilter > 0 && (
              <>• Несоответствующих статусу: <strong>{notEligibleInFilter}</strong></>
            )}
          </div>
          {busy && (
            <div className="fs-12">
              ⏳ Обработано {progress} / {filtered.length}…
            </div>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close} disabled={busy}>Отмена</Btn>
        <Btn
          variant="primary"
          disabled={busy || !pmId || !reason.trim() || !filtered.length}
          onClick={run}
        >
          {busy ? '…' : `→ Распределить ${filtered.length}`}
        </Btn>
      </MFoot>
    </MCard>
  );
}
