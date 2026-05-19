import { useState, useEffect, useCallback } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { Save, ChevronDown } from 'lucide-react';

const WORK_TYPES = [
  'ОПС', 'СКС', 'СКУД', 'Видеонаблюдение', 'СМР', 'Химчистка',
  'CHEM', 'Электрика', 'Сантехника', 'Вентиляция', 'Слаботочка',
  'Комплексная', 'Другое',
];

/**
 * EditEstimateMetadataSheet — редактирование полей объекта и параметров просчёта
 * Props:
 *   estimate  — объект просчёта
 *   open      — boolean
 *   onClose   — callback
 *   onSaved   — callback(updatedEstimate)
 */
export function EditEstimateMetadataSheet({ estimate, open, onClose, onSaved }) {
  const haptic = useHaptic();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    if (!open || !estimate) return;
    setForm({
      title: estimate.title || '',
      object_name: estimate.object_name || '',
      object_city: estimate.object_city || estimate.city || '',
      work_type: estimate.work_type || '',
      crew_count: estimate.crew_count || '',
      work_days: estimate.work_days || '',
      road_days: estimate.road_days || '',
      object_distance_km: estimate.object_distance_km || '',
      work_start_date: estimate.work_start_date ? estimate.work_start_date.split('T')[0] : '',
      work_end_date: estimate.work_end_date ? estimate.work_end_date.split('T')[0] : '',
    });
  }, [open, estimate]);

  const set = (field, value) => setForm((p) => ({ ...p, [field]: value }));

  const handleSave = useCallback(async () => {
    if (!estimate) return;
    setSaving(true);
    haptic.light();
    try {
      const body = {};
      if (form.title.trim()) body.title = form.title.trim();
      if (form.object_name.trim()) body.object_name = form.object_name.trim();
      if (form.object_city.trim()) body.object_city = form.object_city.trim();
      if (form.work_type) body.work_type = form.work_type;
      if (form.crew_count !== '') body.crew_count = Number(form.crew_count) || null;
      if (form.work_days !== '') body.work_days = Number(form.work_days) || null;
      if (form.road_days !== '') body.road_days = Number(form.road_days) || null;
      if (form.object_distance_km !== '') body.object_distance_km = Number(form.object_distance_km) || null;
      if (form.work_start_date) body.work_start_date = form.work_start_date;
      if (form.work_end_date) body.work_end_date = form.work_end_date;

      const res = await api.put(`/estimates/${estimate.id}`, body);
      haptic.success();
      onSaved?.(res.estimate || { ...estimate, ...body });
      onClose?.();
    } catch (e) {
      haptic.error();
      window.dispatchEvent(new CustomEvent('asgard:toast', {
        detail: { message: e.message || 'Ошибка сохранения', type: 'error' }
      }));
    } finally {
      setSaving(false);
    }
  }, [form, estimate, haptic, onSaved, onClose]);

  if (!estimate) return null;

  return (
    <BottomSheet open={open} onClose={onClose} title="Редактировать объект">
      <div className="flex flex-col gap-3 pb-6">

        <div>
          <p className="input-label">Название просчёта</p>
          <input
            className="input-field"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
          />
        </div>

        <div>
          <p className="input-label">Объект</p>
          <input
            className="input-field"
            placeholder="Название объекта"
            value={form.object_name}
            onChange={(e) => set('object_name', e.target.value)}
          />
        </div>

        <div>
          <p className="input-label">Город</p>
          <input
            className="input-field"
            placeholder="Город"
            value={form.object_city}
            onChange={(e) => set('object_city', e.target.value)}
          />
        </div>

        <div>
          <p className="input-label">Тип работ</p>
          <div className="relative">
            <select
              className="input-field appearance-none pr-10"
              value={form.work_type}
              onChange={(e) => set('work_type', e.target.value)}
              style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            >
              <option value="">— Выбрать —</option>
              {WORK_TYPES.map((wt) => (
                <option key={wt} value={wt}>{wt}</option>
              ))}
            </select>
            <ChevronDown size={16} className="c-tertiary absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="input-label">Бригада (чел.)</p>
            <input
              className="input-field"
              type="number"
              inputMode="numeric"
              value={form.crew_count}
              onChange={(e) => set('crew_count', e.target.value)}
            />
          </div>
          <div>
            <p className="input-label">Раб. дней</p>
            <input
              className="input-field"
              type="number"
              inputMode="numeric"
              value={form.work_days}
              onChange={(e) => set('work_days', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="input-label">Дней в дороге</p>
            <input
              className="input-field"
              type="number"
              inputMode="numeric"
              value={form.road_days}
              onChange={(e) => set('road_days', e.target.value)}
            />
          </div>
          <div>
            <p className="input-label">Расстояние (км)</p>
            <input
              className="input-field"
              type="number"
              inputMode="numeric"
              value={form.object_distance_km}
              onChange={(e) => set('object_distance_km', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="input-label">Дата начала</p>
            <input
              className="input-field"
              type="date"
              value={form.work_start_date}
              onChange={(e) => set('work_start_date', e.target.value)}
              style={{ colorScheme: 'dark' }}
            />
          </div>
          <div>
            <p className="input-label">Дата окончания</p>
            <input
              className="input-field"
              type="date"
              value={form.work_end_date}
              onChange={(e) => set('work_end_date', e.target.value)}
              style={{ colorScheme: 'dark' }}
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary spring-tap flex items-center justify-center gap-2 mt-2"
          style={{ opacity: saving ? 0.5 : 1 }}
        >
          <Save size={16} />
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </BottomSheet>
  );
}
