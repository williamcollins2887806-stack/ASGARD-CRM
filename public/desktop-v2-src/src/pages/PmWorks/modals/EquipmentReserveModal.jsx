/**
 * EquipmentReserveModal — бронирование оборудования под работу.
 * Источник vanilla: openEquipmentForWork в pm_works.js:1690-1756.
 * Бэк:
 *   GET /api/equipment/work/:id/equipment  → забронированное под работу
 *   GET /api/equipment/available           → доступное оборудование
 *   POST /api/equipment/reserve            → {equipment_id, work_id, reserved_from, reserved_to}
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { Field, DatePicker, Checkbox, SearchInput } from '@/inputs/Inputs';
import { TabsBar, EmptyState } from '@/blocks/Blocks';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';

/** ISO-дата без таймстампа (без зависимости от локали). */
function toIsoDate(v) {
  if (!v) return '';
  return String(v).slice(0, 10);
}

export function EquipmentReserveModal({ work }) {
  const { close } = useModal();
  const [tab, setTab] = useState('reserved');
  const [reserved, setReserved] = useState([]);
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [from, setFrom] = useState(toIsoDate(work.start_date || work.start_plan || work.start_fact));
  const [to, setTo] = useState(toIsoDate(work.end_plan || work.end_fact));

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api(`/api/equipment/work/${work.id}/equipment`).then((d) => d?.items || d?.rows || (Array.isArray(d) ? d : [])).catch(() => []),
      api('/api/equipment/available').then((d) => d?.items || d?.rows || (Array.isArray(d) ? d : [])).catch(() => [])
    ]).then(([r, av]) => {
      setReserved(r);
      setAvailable(av);
    }).finally(() => setLoading(false));
  }, [work.id]);

  const toggleSel = (id) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const matchesQ = (eq) => {
    if (!q.trim()) return true;
    const lq = q.trim().toLowerCase();
    return (eq.name || '').toLowerCase().includes(lq)
        || (eq.inventory_number || '').toLowerCase().includes(lq)
        || String(eq.id || '').includes(lq);
  };

  const filteredAvail = available.filter(matchesQ);

  const book = async () => {
    if (!selected.size) return toast('Бронирование', 'Выбери хотя бы одну единицу', 'warn');
    if (!from || !to) return toast('Период', 'Укажи даты «с» и «по»', 'warn');
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const equipment_id of selected) {
      try {
        await api('/api/equipment/reserve', {
          method: 'POST',
          body: {
            equipment_id: Number(equipment_id),
            work_id: work.id,
            reserved_from: from,
            reserved_to: to
          }
        });
        ok++;
      } catch (e) {
        fail++;
      }
    }
    setBusy(false);
    if (ok) toast('🧰 Забронировано', `${ok} ед.${fail ? ` (${fail} с ошибкой)` : ''}`, fail ? 'warn' : 'ok');
    else toast('Ошибка', `Не удалось забронировать (${fail} ошибок)`, 'err');
    if (ok) {
      // перезагружаем списки
      const [r, av] = await Promise.all([
        api(`/api/equipment/work/${work.id}/equipment`).then((d) => d?.items || d?.rows || (Array.isArray(d) ? d : [])).catch(() => []),
        api('/api/equipment/available').then((d) => d?.items || d?.rows || (Array.isArray(d) ? d : [])).catch(() => [])
      ]);
      setReserved(r);
      setAvailable(av);
      setSelected(new Set());
    }
  };

  const tabs = [
    { id: 'reserved',  label: 'Забронировано', count: reserved.length },
    { id: 'available', label: 'Доступное',     count: available.length }
  ];

  return (
    <MCard className="modal-lg">
      <MHead
        icon="🧰"
        title={`Оборудование — Работа #${work.id}`}
        subtitle={work.work_title || work.customer_name || ''}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <TabsBar tabs={tabs} active={tab} onChange={setTab} />

        {tab === 'reserved' && (
          loading ? (
            <div className="loader-inline">⏳ Загружаем…</div>
          ) : reserved.length === 0 ? (
            <EmptyState icon="🧰" title="Ничего не забронировано" hint="Перейди на вкладку «Доступное» и выбери оборудование" />
          ) : (
            <div className="col gap-6 mt-10">
              {reserved.map((eq) => (
                <div key={eq.id} className="item-card">
                  <div>
                    <strong>{eq.name || eq.equipment_name || `#${eq.id}`}</strong>
                    {eq.quantity != null && (
                      <span className="item-pick-meta">
                        — {eq.quantity} {eq.unit || 'шт'}
                      </span>
                    )}
                    {eq.inventory_number && (
                      <div className="item-pick-sub">инв.№ {eq.inventory_number}</div>
                    )}
                  </div>
                  {eq.status && <Pill tone="approved">{eq.status}</Pill>}
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'available' && (
          <div className="mt-10">
            <div className="mb-10">
              <SearchInput value={q} onChange={setQ} placeholder="Поиск по названию / инв. №" />
            </div>

            {loading ? (
              <div className="loader-inline">⏳ Загружаем…</div>
            ) : filteredAvail.length === 0 ? (
              <EmptyState icon="🔍" title="Нет доступного оборудования" hint={q ? 'Попробуй сбросить поиск' : 'Всё уже занято или нет совпадений'} />
            ) : (
              <div className="scroll-list">
                {filteredAvail.map((eq) => {
                  const isSel = selected.has(eq.id);
                  return (
                    <label
                      key={eq.id}
                      className={'item-pick' + (isSel ? ' is-selected' : '')}
                    >
                      <Checkbox checked={isSel} onChange={() => toggleSel(eq.id)} />
                      <div className="item-pick-main">
                        <strong>{eq.name || `#${eq.id}`}</strong>
                        {eq.quantity != null && (
                          <span className="item-pick-meta">
                            — {eq.quantity} {eq.unit || 'шт'}
                          </span>
                        )}
                        {eq.inventory_number && (
                          <div className="item-pick-sub">инв.№ {eq.inventory_number}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="dates-box">
              <Field label="С" required>
                <DatePicker value={from} onChange={setFrom} />
              </Field>
              <Field label="По" required>
                <DatePicker value={to} onChange={setTo} />
              </Field>
            </div>
          </div>
        )}
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Закрыть</Btn>
        {tab === 'available' && (
          <Btn variant="primary" disabled={busy || !selected.size} onClick={book}>
            {busy ? 'Бронируем…' : `🧰 Забронировать (${selected.size})`}
          </Btn>
        )}
      </MFoot>
    </MCard>
  );
}
