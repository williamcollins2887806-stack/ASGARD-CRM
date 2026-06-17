/**
 * AssemblyModal — мобилизация / демобилизация (сбор) под работу.
 * Источник vanilla: openAssemblyForWork в pm_works.js:1759-1801.
 * Бэк:
 *   GET /api/assembly?work_id=:id  → существующие ведомости
 *   POST /api/assembly             → {work_id, type, destination}
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { Field, TextInput, SelectInput } from '@/inputs/Inputs';
import { EmptyState } from '@/blocks/Blocks';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';

const ASSEMBLY_TYPES = [
  { value: 'mobilization',   label: '🚛 Мобилизация (с базы на объект)' },
  { value: 'demobilization', label: '🏠 Демобилизация (с объекта на базу)' },
  { value: 'transfer',       label: '↔️ Перемещение' }
];

function typeLabel(t) {
  return ASSEMBLY_TYPES.find((x) => x.value === t)?.label || t;
}

function statusTone(s) {
  if (s === 'closed' || s === 'received') return 'approved';
  if (s === 'in_transit') return 'sent';
  if (s === 'packing') return 'question';
  return 'draft';
}

export function AssemblyModal({ work }) {
  const { close } = useModal();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    type: 'mobilization',
    destination: work.object_name || work.object_place || ''
  });

  const reload = () => {
    setLoading(true);
    api(`/api/assembly?work_id=${work.id}`)
      .then((d) => setItems(d?.items || d?.orders || (Array.isArray(d) ? d : [])))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [work.id]);

  const create = async () => {
    if (!form.type) return toast('Тип', 'Выбери тип сбора', 'warn');
    setBusy(true);
    try {
      const r = await api('/api/assembly', {
        method: 'POST',
        body: {
          work_id: work.id,
          type: form.type,
          destination: form.destination || ''
        }
      });
      const newId = r?.item?.id || r?.id;
      toast('🏗 Создано', `Ведомость ${typeLabel(form.type)}${newId ? ` #${newId}` : ''}`, 'ok');
      if (newId) {
        window.location.hash = `#/assembly?id=${newId}`;
        close();
      } else {
        reload();
      }
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="🏗"
        title={`Сбор — Работа #${work.id}`}
        subtitle={work.work_title || work.customer_name || ''}
        accent="gold"
        onClose={close}
      />
      <MBody>
        {/* Список существующих ведомостей */}
        <div className="mb-14">
          <strong className="section-eyebrow">
            Существующие ведомости ({items.length})
          </strong>
          {loading ? (
            <div className="loader-inline">⏳ Загружаем…</div>
          ) : items.length === 0 ? (
            <EmptyState icon="🏗" title="Ведомостей нет" hint="Создай первую ведомость сборки ниже" />
          ) : (
            <div className="grid-auto-280 gap-8 mt-8">
              {items.map((a) => {
                const pct = a.items_count > 0 ? Math.round(((a.packed_count || 0) / a.items_count) * 100) : 0;
                return (
                  <div
                    key={a.id}
                    onClick={() => { window.location.hash = `#/assembly?id=${a.id}`; close(); }}
                    className="asm-card"
                  >
                    <div className="row-spread gap-6">
                      <strong className="fs-13">{a.title || typeLabel(a.type)}</strong>
                      <Pill tone={statusTone(a.status)}>{a.status || '—'}</Pill>
                    </div>
                    <div className="asm-card-meta">
                      {typeLabel(a.type)} • {a.items_count || 0} поз. • {a.pallets_count || 0} мест
                    </div>
                    {a.items_count > 0 && (
                      <>
                        <div className="asm-bar">
                          <div className="asm-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="asm-bar-lab">{pct}% собрано</div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Форма создания новой ведомости */}
        <div className="card-soft-md col gap-10">
          <strong className="section-eyebrow">
            Новая ведомость
          </strong>
          <Field label="Тип сбора" required>
            <SelectInput
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v })}
              options={ASSEMBLY_TYPES}
            />
          </Field>
          <Field label="Назначение" help="Куда / откуда (объект, адрес)">
            <TextInput
              value={form.destination}
              onChange={(v) => setForm({ ...form, destination: v })}
              placeholder="Объект / склад"
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Закрыть</Btn>
        <Btn variant="primary" disabled={busy} onClick={create}>
          {busy ? 'Создаём…' : '+ Создать ведомость'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
