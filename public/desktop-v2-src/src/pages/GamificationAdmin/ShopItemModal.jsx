/**
 * ShopItemModal — создание/редактирование товара магазина.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn, Field } from '@/modals/parts';
import { TextInput, NumberInput, TextareaInput, SelectInput, Checkbox } from '@/inputs/Inputs';

import {
  createShopItem, updateShopItem,
  CAT_LABELS, TIER_LABELS, CAT_OPTIONS, TIER_OPTIONS,
} from './api';

export function ShopItemModal({ item, onSaved }) {
  const { close } = useModal();
  const isEdit = !!item;

  const [form, setForm] = useState({
    name: item?.name || '',
    description: item?.description || '',
    price_runes: item?.price_runes ?? '',
    icon: item?.icon || '',
    category: item?.category || 'food',
    rarity: item?.rarity || 'common',
    max_stock: item?.max_stock ?? '',
    current_stock: item?.current_stock ?? '',
    requires_delivery: !!item?.requires_delivery,
    is_active: item?.is_active !== false,
  });
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onSave = async () => {
    if (!form.name.trim()) { toast.error('Укажите название'); return; }
    const price = parseInt(form.price_runes);
    if (!price || price < 1) { toast.error('Укажите цену > 0'); return; }

    const body = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      price_runes: price,
      category: form.category,
      rarity: form.rarity,
      icon: form.icon.trim() || undefined,
      max_stock: form.max_stock !== '' ? parseInt(form.max_stock) : undefined,
      current_stock: form.current_stock !== '' ? parseInt(form.current_stock) : undefined,
      requires_delivery: form.requires_delivery,
      is_active: form.is_active,
    };

    setBusy(true);
    try {
      if (isEdit) {
        await updateShopItem(item.id, body);
        toast.success('Товар обновлён, рулетка синхронизирована');
      } else {
        await createShopItem(body);
        toast.success('Товар создан и добавлен в рулетку');
      }
      close();
      onSaved?.();
    } catch (e) {
      toast.error(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard>
      <MHead
        icon={isEdit ? '✏️' : '➕'}
        title={isEdit ? 'Редактировать товар' : 'Новый товар магазина'}
        accent={isEdit ? 'default' : 'success'}
        onClose={() => close()}
      />
      <MBody>
        <div className="ga-shop-form-grid">
          <div className="full">
            <Field label="Название" required>
              <TextInput value={form.name} onChange={(v) => set('name', v)} placeholder="Доширак Ролтон" />
            </Field>
          </div>
          <div className="full">
            <Field label="Описание">
              <TextareaInput value={form.description} onChange={(v) => set('description', v)} placeholder="Вкусный обед прямо на объекте" minRows={2} />
            </Field>
          </div>

          <Field label="Цена (ᚱ руны)" required>
            <NumberInput value={form.price_runes} onChange={(v) => set('price_runes', v)} min={1} />
          </Field>
          <Field label="Иконка (emoji)">
            <TextInput value={form.icon} onChange={(v) => set('icon', v)} placeholder="🍜" />
          </Field>

          <Field label="Категория">
            <SelectInput
              value={form.category}
              onChange={(v) => set('category', v)}
              options={CAT_OPTIONS.map((c) => ({ value: c, label: CAT_LABELS[c] || c }))}
            />
          </Field>
          <Field label="Редкость">
            <SelectInput
              value={form.rarity}
              onChange={(v) => set('rarity', v)}
              options={TIER_OPTIONS.map((t) => ({ value: t, label: TIER_LABELS[t] }))}
            />
          </Field>

          <Field label="Макс. запас" help="Пусто = ∞">
            <NumberInput value={form.max_stock} onChange={(v) => set('max_stock', v)} min={0} />
          </Field>
          <Field label="Текущий остаток">
            <NumberInput value={form.current_stock} onChange={(v) => set('current_stock', v)} min={0} />
          </Field>

          <div className="full">
            <Checkbox
              checked={form.requires_delivery}
              onChange={(v) => set('requires_delivery', v)}
              label="Физический товар (требует выдачи РП)"
            />
          </div>
          <div className="full">
            <Checkbox
              checked={form.is_active}
              onChange={(v) => set('is_active', v)}
              label="Активен (виден в магазине и рулетке)"
            />
          </div>
        </div>
        <div className="ga-tip mt-12" >
          💡 При сохранении товар <b className="c-gold">автоматически попадёт в рулетку</b>.
          Вероятность = обратная цене: дешевле → чаще выпадает.
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={onSave}>
          {busy ? 'Сохраняем…' : (isEdit ? '💾 Сохранить' : '✚ Создать')}
        </Btn>
      </MFoot>
    </MCard>
  );
}
