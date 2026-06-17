/**
 * EquipmentBulkCreateModal — массовое создание оборудования.
 *
 * E-6b (2026-06-14). Vanilla: warehouse.js:658.
 * Backend: equipment.js:713 (POST /api/equipment/bulk-create).
 *
 * Принимает Excel-формат (paste из таблицы / textarea CSV-like).
 * Формат строки: name; category_name; serial_number; inventory_number; condition
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextareaInput, SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { bulkCreateEquipment } from './api';
import { EquipmentQrPrintModal } from './EquipmentQrPrintModal';

const CONDITIONS = [
  { value: 'new', label: 'Новое' },
  { value: 'good', label: 'Хорошее' },
  { value: 'satisfactory', label: 'Удовлетворительное' },
  { value: 'poor', label: 'Плохое' }
];

const TEMPLATE = `# Формат: name; category; serial_number; inventory_number; condition
# Каждая строка — одна единица. Можно вставить из Excel (Tab/«;» как разделитель).
Перфоратор Bosch GBH 2-26; Электроинструмент; PER-001; INV-001; new
Сварочный аппарат Ресанта; Электроинструмент; WLD-002; INV-002; good`;

export function EquipmentBulkCreateModal({ onCreated }) {
  const { close, open } = useModal();
  const [raw, setRaw] = useState('');
  const [defCondition, setDefCondition] = useState('new');
  const [busy, setBusy] = useState(false);

  const parse = () => {
    return raw.split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const cells = line.split(/\t|;/).map((c) => c.trim());
        return {
          name: cells[0] || '',
          category_name: cells[1] || null,
          serial_number: cells[2] || null,
          inventory_number: cells[3] || null,
          condition: cells[4] || defCondition
        };
      })
      .filter((it) => it.name);
  };

  const preview = parse();

  const submit = async () => {
    const items = parse();
    if (items.length === 0) return toast.error('Введите хотя бы одну позицию');
    setBusy(true);
    try {
      const res = await bulkCreateEquipment(items);
      const created = res?.created || res?.items || res?.equipment || [];
      const createdCount = res?.created_count ?? created.length ?? items.length;
      toast.success(`Создано: ${createdCount}`);
      onCreated?.();
      // Если backend вернул ids — предложить печать QR
      const ids = created.map((c) => c.id).filter(Boolean);
      if (ids.length) {
        open(<EquipmentQrPrintModal equipmentIds={ids} />);
      } else {
        close();
      }
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="📦" title="Массовое создание оборудования" subtitle="Вставь из Excel или впиши вручную" onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Field label="Дефолтное состояние (для строк без значения)">
            <SelectInput value={defCondition} onChange={setDefCondition} options={CONDITIONS} />
          </Field>
          <Field label="Данные (одна позиция = одна строка)" help="Колонки: name; category; serial; inventory; condition">
            <TextareaInput
              value={raw}
              onChange={setRaw}
              minRows={10}
              maxRows={20}
              placeholder={TEMPLATE}
            />
          </Field>
          {preview.length > 0 && (
            <div className="bg-inner p-10 r-md">
              <strong className="fs-12">📋 Предпросмотр: {preview.length} позиций</strong>
              <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 6 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--brd, #243049)', color: 'var(--t-3)' }}>
                    <th style={{ textAlign: 'left', padding: 4 }}>Название</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>Категория</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>S/N</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>Inv</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>Состояние</th>
                  </tr></thead>
                  <tbody>
                    {preview.slice(0, 50).map((it, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--brd, #243049)' }}>
                        <td style={{ padding: 3 }}>{it.name}</td>
                        <td style={{ padding: 3, color: 'var(--t-3)' }}>{it.category_name || '—'}</td>
                        <td style={{ padding: 3, color: 'var(--t-3)' }}>{it.serial_number || '—'}</td>
                        <td style={{ padding: 3, color: 'var(--t-3)' }}>{it.inventory_number || '—'}</td>
                        <td style={{ padding: 3 }}>{CONDITIONS.find((c) => c.value === it.condition)?.label || it.condition}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 50 && <div className="c-t3 fs-11 mt-4">…и ещё {preview.length - 50}</div>}
              </div>
            </div>
          )}
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy || preview.length === 0} onClick={submit}>
          {busy ? 'Создаём…' : `✓ Создать ${preview.length}`}
        </Btn>
      </MFoot>
    </MCard>
  );
}
