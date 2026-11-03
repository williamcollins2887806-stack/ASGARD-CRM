/**
 * GenerateSalaryModal — генерация ведомости ЗП за период из field_checkins.
 *
 * С 01.11.2026: суммы уже в ₽ в checkins; UI без «₽/балл».
 * Бэк: POST /api/worker-payments/generate-salary/:year/:month
 */
import { useState } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { SelectInput, NumberInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { useModal } from '@/modals';
import { generateSalary } from '../../api';

const MONTHS = [
  { value: '1',  label: 'Январь'    },
  { value: '2',  label: 'Февраль'   },
  { value: '3',  label: 'Март'      },
  { value: '4',  label: 'Апрель'    },
  { value: '5',  label: 'Май'       },
  { value: '6',  label: 'Июнь'      },
  { value: '7',  label: 'Июль'      },
  { value: '8',  label: 'Август'    },
  { value: '9',  label: 'Сентябрь'  },
  { value: '10', label: 'Октябрь'   },
  { value: '11', label: 'Ноябрь'    },
  { value: '12', label: 'Декабрь'   }
];

export function GenerateSalaryModal({ work, onSaved }) {
  const { close } = useModal();
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    const m = Number(month);
    const y = Number(year);
    if (!m || m < 1 || m > 12) { setErr('Некорректный месяц'); return; }
    if (!y || y < 2020 || y > 2099) { setErr('Некорректный год'); return; }

    setBusy(true);
    try {
      // point_value — legacy для бэка (вывод total_points); суммы берутся из amount_earned as-is.
      const r = await generateSalary(y, m, { point_value: 500, work_id: Number(work.id) });
      toast('Ведомость создана', `${r.count || 0} чел.`, 'ok');
      onSaved?.();
      close();
    } catch (e) {
      const msg = e?.message || String(e);
      setErr(msg.includes('409') || msg.toLowerCase().includes('уже')
        ? 'Ведомость за этот период уже создана. Удалите старые pending-выплаты в таблице ниже.'
        : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="📋" title="Сгенерировать ведомость ЗП" subtitle={work.work_title || `Работа #${work.id}`} accent="gold" onClose={close} />
      <MBody>
        {err && <div className="ft-pw-err" style={{ marginBottom: 10 }}>⚠ {err}</div>}

        <div className="ft-pay-modal-grid-3">
          <Field label="Месяц" required>
            <SelectInput value={month} onChange={setMonth} options={MONTHS} />
          </Field>
          <Field label="Год" required>
            <NumberInput value={year} onChange={setYear} min={2020} max={2099} />
          </Field>
        </div>

        <div className="ft-pw-preview" style={{ marginTop: 10 }}>
          <div className="ft-pw-preview-ttl">📋 Что произойдёт</div>
          <div className="ft-pw-preview-row" style={{ fontSize: 12 }}>
            Из <code>field_checkins</code> за {MONTHS[Number(month) - 1]?.label || '—'} {year} (только статус «completed»)
            агрегируются смены по сотрудникам. Для каждого создаётся
            <code> worker_payments </code> со статусом <strong>pending</strong> —
            сумма = заработок за период в ₽. Дальше можно отметить выплату кнопкой «💰 Выплатить»
            в строке таблицы.
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Генерируем…' : 'Сгенерировать'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
