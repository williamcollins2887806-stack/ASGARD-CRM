/**
 * Модалка экспорта данных из CRM в ERP.
 * POST /api/integrations/erp/connections/:id/export
 *   { entity_type: 'payroll'|'bank'|'tenders'|'counterparties', date_from, date_to }
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';

import { EXPORT_ENTITIES, exportToErp } from './api';

export function ExportModal({ connection, onDone }) {
  const { close } = useModal();
  const [entity, setEntity] = useState('payroll');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await exportToErp(connection.id, {
        entity_type: entity,
        date_from: dateFrom || null,
        date_to: dateTo || null
      });
      setResult(r);
      toast.success(`Экспорт ${entity}: ${r?.records ?? 0} записей`);
      onDone?.();
    } catch (e) {
      toast.error('Ошибка экспорта: ' + (e?.message || e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon="📤"
        title="Экспорт в ERP"
        subtitle={connection?.name}
        onClose={close}
      />
      <MBody>
        <div className="m-grid-2">
          <div className="col-span-2">
            <Field label="Что выгружать" required>
              <SelectInput value={entity} onChange={setEntity} options={EXPORT_ENTITIES} />
            </Field>
          </div>

          <Field label="Период от">
            <input
              type="date"
              className="inp-text"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </Field>
          <Field label="Период до">
            <input
              type="date"
              className="inp-text"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </Field>
        </div>

        {result && (
          <div
            style={{
              marginTop: 14,
              padding: 10,
              background: 'var(--inner-bg)',
              border: '1px solid var(--brd-2)',
              borderRadius: 'var(--r-sm)',
              fontSize: 13
            }}
          >
            <div style={{ color: 'var(--t-1)', fontWeight: 600, marginBottom: 4 }}>
              ✓ Выгружено: <span className="c-gold">{result.records}</span> запис
              {pluralize(result.records)}
            </div>
            <div className="c-t3 fs-11">
              entity_type: <code>{result.entity_type}</code>
            </div>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        <Btn variant="primary" onClick={submit} disabled={running}>
          {running ? 'Выгружаем…' : 'Выгрузить'}
        </Btn>
      </MFoot>
    </MCard>
  );
}

function pluralize(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'ей';
  if (b > 1 && b < 5) return 'и';
  if (b === 1) return 'ь';
  return 'ей';
}
