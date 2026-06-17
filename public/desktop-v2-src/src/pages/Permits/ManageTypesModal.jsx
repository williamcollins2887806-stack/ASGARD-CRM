/**
 * ManageTypesModal — управление типами разрешений (CRUD).
 * Источник: vanilla permits.js → openManageTypesModal.
 * Использует backend permit-applications/types (как vanilla).
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { ConfirmModal } from '@/modals/Confirm';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { TextInput, SelectInput } from '@/inputs/Inputs';
import { loadAppTypes, createAppType, deleteAppType, CATEGORIES } from './api';

export default function ManageTypesModal({ onChanged }) {
  const { open, close } = useModal();
  const [types, setTypes] = useState([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState(Object.keys(CATEGORIES)[0]);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    loadAppTypes()
      .then(setTypes)
      .catch((e) => toast.error('Не удалось загрузить типы: ' + (e?.message || e)));
  };

  useEffect(() => { refresh(); }, []);

  const onAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 3) {
      toast.warn('Название мин. 3 символа');
      return;
    }
    setBusy(true);
    try {
      await createAppType({ name: trimmed, category });
      toast.success('Тип добавлен');
      setName('');
      refresh();
      onChanged?.();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = (t) => {
    open(<ConfirmModal
      title="Деактивировать этот тип?"
      message={`«${t.name}» больше не будет доступен в списках.`}
      tone="danger"
      okText="Деактивировать"
      onConfirm={async () => {
        try {
          await deleteAppType(t.id);
          toast.success('Тип деактивирован');
          refresh();
          onChanged?.();
        } catch (e) {
          toast.error('Ошибка: ' + (e?.message || e));
        }
      }}
    />);
  };

  const categoryOpts = Object.entries(CATEGORIES).map(([k, v]) => ({ value: k, label: v.name }));

  return (
    <MCard>
      <MHead icon="⚙" title="Управление типами разрешений" subtitle="Справочник" accent="default" onClose={close} />
      <MBody>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="flex-1 min-w-200">
            <TextInput value={name} onChange={setName} placeholder="Название нового типа..." />
          </div>
          <div className="w-180">
            <SelectInput value={category} onChange={setCategory} options={categoryOpts} />
          </div>
          <Btn variant="primary" onClick={onAdd} disabled={busy}>+ Добавить</Btn>
        </div>

        <div className="pmt-types-list">
          {types.map((t) => {
            const cat = CATEGORIES[t.category] || { name: t.category, color: 'var(--t-3)' };
            return (
              <div key={t.id} className="pmt-type-row">
                <span className="dot" style={{ background: cat.color }} />
                <div className="flex-1">
                  <div className="nm">{t.name}</div>
                  <div className="meta">{t.code} · {cat.name}</div>
                </div>
                {t.is_system
                  ? <span className="sys">системный</span>
                  : <Btn size="sm" variant="ghost" onClick={() => onDelete(t)}>✕</Btn>}
              </div>
            );
          })}
          {types.length === 0 && (
            <div className="p-24 t-center c-t3">Список пуст</div>
          )}
        </div>
      </MBody>
      <MFoot>
        <Btn variant="primary" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
