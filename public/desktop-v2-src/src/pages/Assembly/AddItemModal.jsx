/**
 * Быстрое добавление позиции в ведомость с автокомплитом по каталогу.
 * Источник: vanilla `assembly-page.js` → openAddItemDialog.
 */
import { useState, useEffect, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, NumberInput, SelectInput } from '@/inputs/Inputs';
import { Popover } from '@/inputs/Popover';
import { toast } from '@/modals/Notifications';
import { quickAddItem, searchProducts } from './api';

export function AddItemModal({ assemblyId, onAdded }) {
  const { close } = useModal();
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState('шт');
  const [source, setSource] = useState('from_warehouse');
  const [selectedPid, setSelectedPid] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSug, setShowSug] = useState(false);
  const [busy, setBusy] = useState(false);
  const debRef = useRef(null);
  const anchorRef = useRef(null);

  useEffect(() => {
    clearTimeout(debRef.current);
    if (name.trim().length < 2) {
      setSuggestions([]);
      setShowSug(false);
      return;
    }
    debRef.current = setTimeout(() => {
      searchProducts(name.trim())
        .then((items) => {
          setSuggestions(items);
          setShowSug(items.length > 0);
        })
        .catch(() => {
          setSuggestions([]);
          setShowSug(false);
        });
    }, 280);
    return () => clearTimeout(debRef.current);
  }, [name]);

  const onPickSuggestion = (it) => {
    setSelectedPid(it.id);
    setName(it.name);
    if (it.unit) setUnit(it.unit);
    setShowSug(false);
  };

  const save = async () => {
    if (!name.trim()) return toast.warn('Укажите наименование');
    const qty = Number(quantity);
    if (!qty || qty <= 0) return toast.warn('Количество должно быть > 0');
    setBusy(true);
    try {
      await quickAddItem(assemblyId, {
        name:       name.trim(),
        quantity:   qty,
        unit:       unit.trim() || 'шт',
        source,
        product_id: selectedPid || undefined
      });
      toast.success('Позиция добавлена');
      onAdded?.();
      close();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead icon="➕" title="Добавить позицию" accent="gold" onClose={close} />
      <MBody>
        <div className="col gap-12">
          <Field label="Наименование" required help="Поиск по каталогу при вводе">
            <div ref={anchorRef}>
              <TextInput
                value={name}
                onChange={(v) => { setName(v); setSelectedPid(null); }}
                placeholder="Труба 89×6, Электрод…"
              />
            </div>
            <Popover
              anchorRef={anchorRef}
              open={showSug && suggestions.length > 0}
              onClose={() => setShowSug(false)}
              maxHeight={240}
            >
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  className="inp-pop-i"
                  onClick={() => onPickSuggestion(s)}
                  style={{ display: 'block' }}
                >
                  <div className="fs-13">{s.name}</div>
                  <div className="fs-11 c-t3">
                    {s.category_name || ''}{s.article ? ' · ' + s.article : ''}
                  </div>
                </div>
              ))}
            </Popover>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10 }}>
            <Field label="Количество" required>
              <NumberInput value={quantity} onChange={setQuantity} min={0} step={0.01} />
            </Field>
            <Field label="Ед.">
              <TextInput value={unit} onChange={setUnit} />
            </Field>
          </div>

          <Field label="Источник">
            <SelectInput
              value={source}
              onChange={setSource}
              options={[
                { value: 'from_warehouse',   label: 'Со склада' },
                { value: 'on_site_purchase', label: 'Куплено на объекте' },
                { value: 'manual',           label: 'Вручную / прочее' }
              ]}
            />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={save}>{busy ? '…' : '✓ Добавить'}</Btn>
      </MFoot>
    </MCard>
  );
}
