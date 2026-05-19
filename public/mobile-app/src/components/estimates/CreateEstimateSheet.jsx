import { useState, useEffect, useCallback } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { Plus, ChevronDown } from 'lucide-react';

const WORK_TYPES = [
  'ОПС', 'СКС', 'СКУД', 'Видеонаблюдение', 'СМР', 'Химчистка',
  'CHEM', 'Электрика', 'Сантехника', 'Вентиляция', 'Слаботочка',
  'Комплексная', 'Другое',
];

/**
 * CreateEstimateSheet — создание нового просчёта (BottomSheet)
 * Props:
 *   open        — boolean
 *   onClose     — callback
 *   onCreated   — callback(estimate) при успехе
 *   defaultTenderId — предзаполнить тендер
 */
export function CreateEstimateSheet({ open, onClose, onCreated, defaultTenderId }) {
  const haptic = useHaptic();
  const user = useAuthStore((s) => s.user);
  const [tenders, setTenders] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    tender_id: defaultTenderId || '',
    object_name: '',
    object_city: '',
    work_type: '',
    crew_count: '',
    work_days: '',
    road_days: '',
    object_distance_km: '',
  });

  useEffect(() => {
    if (!open) return;
    // Сброс формы при открытии
    setForm({
      title: '',
      tender_id: defaultTenderId || '',
      object_name: '',
      object_city: '',
      work_type: '',
      crew_count: '',
      work_days: '',
      road_days: '',
      object_distance_km: '',
    });
  }, [open, defaultTenderId]);

  useEffect(() => {
    if (!open) return;
    api.get('/tenders?limit=200').then((res) => {
      const rows = api.extractRows(res) || [];
      setTenders(rows.filter((t) => !['Отклонён', 'Проиграли', 'Выиграли'].includes(t.tender_status)));
    }).catch(() => {});
  }, [open]);

  const set = (field, value) => setForm((p) => ({ ...p, [field]: value }));

  const handleCreate = useCallback(async (sendForApproval = false) => {
    if (!form.title.trim() && !form.object_name.trim()) {
      haptic.error();
      return;
    }
    setSaving(true);
    haptic.light();
    try {
      const body = {
        title: form.title.trim() || form.object_name.trim(),
        pm_id: user?.id,
        approval_status: sendForApproval ? 'sent' : 'draft',
      };
      if (form.tender_id) body.tender_id = Number(form.tender_id);
      if (form.object_name.trim()) body.object_name = form.object_name.trim();
      if (form.object_city.trim()) body.object_city = form.object_city.trim();
      if (form.work_type) body.work_type = form.work_type;
      if (form.crew_count) body.crew_count = Number(form.crew_count);
      if (form.work_days) body.work_days = Number(form.work_days);
      if (form.road_days) body.road_days = Number(form.road_days);
      if (form.object_distance_km) body.object_distance_km = Number(form.object_distance_km);

      const res = await api.post('/estimates', body);
      haptic.success();
      onCreated?.(res.estimate || res);
      onClose?.();
    } catch (e) {
      haptic.error();
      window.dispatchEvent(new CustomEvent('asgard:toast', {
        detail: { message: e.message || 'Ошибка создания', type: 'error' }
      }));
    } finally {
      setSaving(false);
    }
  }, [form, user, haptic, onCreated, onClose]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Новый просчёт">
      <div className="flex flex-col gap-3 pb-6">

        {/* Название */}
        <div>
          <p className="input-label">Название просчёта</p>
          <input
            className="input-field"
            placeholder="Например: Склад Логистика v1"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
          />
        </div>

        {/* Тендер */}
        {tenders.length > 0 && (
          <div>
            <p className="input-label">Тендер (опционально)</p>
            <div className="relative">
              <select
                className="input-field appearance-none pr-10"
                value={form.tender_id}
                onChange={(e) => set('tender_id', e.target.value)}
                style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              >
                <option value="">— Без тендера —</option>
                {tenders.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tender_title || t.title || t.customer_name || `Тендер #${t.id}`}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="c-tertiary absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        )}

        {/* Объект */}
        <div>
          <p className="input-label">Название объекта</p>
          <input
            className="input-field"
            placeholder="Завод, склад, офис..."
            value={form.object_name}
            onChange={(e) => set('object_name', e.target.value)}
          />
        </div>

        {/* Город */}
        <div>
          <p className="input-label">Город</p>
          <input
            className="input-field"
            placeholder="Москва, Екатеринбург..."
            value={form.object_city}
            onChange={(e) => set('object_city', e.target.value)}
          />
        </div>

        {/* Тип работ */}
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

        {/* Бригада + дни — в ряд */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="input-label">Бригада (чел.)</p>
            <input
              className="input-field"
              type="number"
              inputMode="numeric"
              placeholder="8"
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
              placeholder="21"
              value={form.work_days}
              onChange={(e) => set('work_days', e.target.value)}
            />
          </div>
        </div>

        {/* Дни в дороге + расстояние */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="input-label">Дней в дороге</p>
            <input
              className="input-field"
              type="number"
              inputMode="numeric"
              placeholder="2"
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
              placeholder="1200"
              value={form.object_distance_km}
              onChange={(e) => set('object_distance_km', e.target.value)}
            />
          </div>
        </div>

        {/* Кнопки */}
        <div className="flex flex-col gap-2 mt-2">
          <button
            onClick={() => handleCreate(false)}
            disabled={saving || (!form.title.trim() && !form.object_name.trim())}
            className="btn-primary spring-tap flex items-center justify-center gap-2"
            style={{ opacity: saving ? 0.5 : 1 }}
          >
            <Plus size={16} />
            {saving ? 'Создание...' : 'Создать черновик'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
