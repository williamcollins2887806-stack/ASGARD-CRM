/**
 * Массовое распределение тендеров (TO/HEAD_TO/ADMIN).
 * Использует POST /api/tenders/:id/assign-calculator { kind:'pm', user_id }
 * (src/routes/tenders.js:1203).
 *
 * Логика:
 *   • Один РП на все выбранные тендеры (или «без РП» — пропустить).
 *   • Каждый тендер должен быть в статусе «На анализе» — иначе бэк вернёт 400.
 *   • Идём по очереди, копим ok/err, в конце один toast.
 */
import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { loadUsers } from '../api';

export default function BulkAssignModal({ tenders, onDone }) {
  const { close } = useModal();
  const [pms, setPms] = useState([]);
  const [pmId, setPmId] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    loadUsers('PM').then(setPms);
  }, []);

  // Считаем сколько тендеров могут быть распределены.
  // Распределяется только из «На анализе» (см. assign-calculator 1216-1218).
  const eligible = tenders.filter((t) => t.tender_status === 'На анализе');
  const notEligible = tenders.length - eligible.length;

  const run = async () => {
    if (!pmId) return toast('Распределение', 'Выберите РП', 'warn');
    if (!eligible.length) return toast('Распределение', 'Нет тендеров в статусе «На анализе»', 'warn');
    setBusy(true);
    setProgress(0);
    let ok = 0, err = 0;
    for (let i = 0; i < eligible.length; i++) {
      const t = eligible[i];
      try {
        await api(`/api/tenders/${t.id}/assign-calculator`, {
          method: 'POST',
          body: { kind: 'pm', user_id: Number(pmId) }
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
      `${pmName}: распределено ${ok}${err ? `, ошибок ${err}` : ''}${notEligible ? `, пропущено (статус ≠ «На анализе»): ${notEligible}` : ''}`,
      err ? 'warn' : 'ok'
    );
    setBusy(false);
    onDone?.();
    close();
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
          <div className="fs-12 c-t3">
            • Тендеров в статусе «На анализе» (готовы к распределению): <strong>{eligible.length}</strong><br />
            {notEligible > 0 && (
              <>• В других статусах (будут пропущены): <strong>{notEligible}</strong></>
            )}
          </div>
          {busy && (
            <div className="fs-12">
              ⏳ Обработано {progress} / {eligible.length}…
            </div>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close} disabled={busy}>Отмена</Btn>
        <Btn
          variant="primary"
          disabled={busy || !pmId || !eligible.length}
          onClick={run}
        >
          {busy ? '…' : `→ Распределить ${eligible.length}`}
        </Btn>
      </MFoot>
    </MCard>
  );
}
