/**
 * Страница /admin/timesheet-settings — настройка баллов табеля.
 *
 * Источник: TIMESHEET_V2_CONTRACT.md (раздел position_points).
 *
 * RBAC: ADMIN + DIRECTOR_GEN. RBAC-проверка — на роуте через <Protected roles=…>,
 * здесь повторно мягко проверяем для UX.
 *
 * API:
 *   GET  /api/timesheet/v2/settings/position-points  — текущие баллы (массив { type, position, points })
 *   PUT  /api/timesheet/v2/settings/position-points  — обновление одной строки { type, position, points }
 *
 * UI — 3 секции:
 *   1. Склад           — слесарь, мастер
 *   2. Медосмотр       — 1 число
 *   3. Дорога          — 1 число
 *
 * Подтверждение если меняется > 50% — это применится ко всем будущим отметкам.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn, Field, Input } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { getSettings, updateSettings } from '@/pages/Timesheet/api';

const EDIT_ROLES = ['ADMIN', 'DIRECTOR_GEN'];

/* Конфиг секций — массив { id (для key), title, hint, items: [{ type, position, label }] } */
// V255 (23.06.2026): medical → «Медосмотр / Обучение» (ТО ставит одной кнопкой 7 баллов),
// добавлен 'ship' — Корабль (альтернатива «Дороги» за повышенную ставку 12 баллов).
const SECTIONS = [
  {
    id: 'warehouse',
    title: '📦 Склад',
    hint: 'Сколько баллов начислять рабочему за день на складе. Зависит от должности.',
    items: [
      { type: 'warehouse', position: 'слесарь', label: 'Слесарь' },
      { type: 'warehouse', position: 'мастер',  label: 'Мастер' }
    ]
  },
  {
    id: 'medical',
    title: '🏥 Медосмотр / Обучение',
    hint: 'Баллы за день медосмотра или обучения. Ставят ТО / Рук. ТО.',
    items: [
      { type: 'medical', position: null, label: 'Медосмотр / Обучение' }
    ]
  },
  {
    id: 'travel',
    title: '✈️ Дорога',
    hint: 'Баллы за день в дороге (наземный транспорт).',
    items: [
      { type: 'travel', position: null, label: 'Дорога' }
    ]
  },
  {
    id: 'ship',
    title: '🚢 Корабль',
    hint: 'Альтернативный вид дороги — пароход / паром. Повышенная ставка. Ставят ТО / Рук. ТО.',
    items: [
      { type: 'ship', position: null, label: 'Корабль' }
    ]
  }
];

/* Ключ для словаря текущих значений: "warehouse:слесарь" / "medical" */
function keyOf(type, position) {
  return position ? `${type}:${position}` : type;
}

/* Парсит ответ /settings/position-points в плоский объект { "warehouse:слесарь": 10, "medical": 6, ... } */
function parseResponse(res) {
  const map = {};
  // Сервер может вернуть либо массив, либо объект — поддержим обе формы.
  if (Array.isArray(res)) {
    for (const r of res) map[keyOf(r.type, r.position)] = Number(r.points) || 0;
  } else if (res && typeof res === 'object') {
    // Форма { position_points: {...} } или { warehouse: { слесарь: 10 }, medical: 6, ... }
    const src = res.position_points || res.settings || res;
    for (const [k, v] of Object.entries(src || {})) {
      if (typeof v === 'object' && v !== null) {
        for (const [pos, pts] of Object.entries(v)) map[`${k}:${pos}`] = Number(pts) || 0;
      } else if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) {
        map[k] = Number(v) || 0;
      }
    }
  }
  return map;
}

export default function AdminTimesheetSettingsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const hasAccess = useMemo(() => !!(user && EDIT_ROLES.includes(user.role)), [user]);

  const [original, setOriginal] = useState({});     // снимок с сервера для расчёта дельты
  const [values, setValues] = useState({});         // редактируемые значения
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /* ─── Загрузка ─── */
  const refresh = () => {
    setLoading(true);
    getSettings()
      .then((r) => {
        const map = parseResponse(r);
        // Заполняем дефолты по контракту, если сервер вернул не все ключи.
        // V255: medical 7, ship 12.
        const defaults = { 'warehouse:слесарь': 10, 'warehouse:мастер': 12, medical: 7, travel: 6, ship: 12 };
        const merged = { ...defaults, ...map };
        setOriginal(merged);
        setValues(merged);
      })
      .catch((e) => {
        toast.error('Не удалось загрузить настройки: ' + (e?.message || e));
        // Дефолты — чтобы форма всё равно отрисовалась
        const defaults = { 'warehouse:слесарь': 10, 'warehouse:мастер': 12, medical: 7, travel: 6, ship: 12 };
        setOriginal(defaults);
        setValues(defaults);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (hasAccess) refresh();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess]);

  /* ─── Изменение значения ─── */
  const onChange = (k, v) => {
    // Только целые неотрицательные
    const num = Math.max(0, Math.round(Number(v) || 0));
    setValues((prev) => ({ ...prev, [k]: num }));
  };

  /* ─── Сохранение (с подтверждением, если > 50% от любой строки) ─── */
  const dirtyEntries = useMemo(() => {
    const out = [];
    for (const sec of SECTIONS) {
      for (const it of sec.items) {
        const k = keyOf(it.type, it.position);
        const before = original[k];
        const after = values[k];
        if (before === after) continue;
        out.push({ ...it, before, after });
      }
    }
    return out;
  }, [original, values]);

  const isDirty = dirtyEntries.length > 0;

  const hugeChanges = useMemo(() => {
    return dirtyEntries.filter((d) => {
      const base = d.before || 0;
      if (base === 0) return d.after > 0; // c нуля — фактически большое изменение
      const ratio = Math.abs((d.after - base) / base);
      return ratio > 0.5;
    });
  }, [dirtyEntries]);

  const persist = async () => {
    setSaving(true);
    try {
      // PUT по одной строке (контракт)
      for (const d of dirtyEntries) {
        await updateSettings({ type: d.type, position: d.position, points: d.after });
      }
      toast.success('Сохранено');
      setOriginal({ ...values });
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.serverMsg || e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const onSave = () => {
    if (!isDirty || saving) return;
    if (hugeChanges.length > 0) {
      modal.open(
        <ConfirmModal
          title="Точно сохранить?"
          message={(
            <div className="col gap-8">
              <div>Эти изменения больше чем на 50% от текущего значения:</div>
              <ul style={{ paddingLeft: 16, lineHeight: 1.7 }}>
                {hugeChanges.map((d) => (
                  <li key={keyOf(d.type, d.position)}>
                    <b>{d.label}</b>: {d.before} → <b>{d.after}</b>
                  </li>
                ))}
              </ul>
              <div className="c-t3" style={{ fontSize: 12 }}>
                Это применится ко всем БУДУЩИМ отметкам в табеле. Уже выставленные — не пересчитаются.
              </div>
            </div>
          )}
          tone="warn"
          okText="Да, сохранить"
          cancelText="Отмена"
          onConfirm={persist}
        />
      );
    } else {
      persist();
    }
  };

  /* ─── Render ─── */
  if (!hasAccess) {
    return (
      <AccessDenied
        allowed={EDIT_ROLES}
        userRole={user?.role || '—'}
        title="Настройки баллов табеля"
        message={`Эта страница доступна для ролей: ${EDIT_ROLES.join(', ')}.`}
      />
    );
  }

  if (loading) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Кузница" title="Настройки баллов табеля" />
        <div className="card card-empty">⏳ Загружаем…</div>
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Кузница"
        title="Настройки баллов табеля"
        subtitle="Баллы за день работы по типу: склад / медосмотр / дорога"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={onSave} disabled={!isDirty || saving}>
              {saving ? 'Сохраняем…' : (isDirty ? `Сохранить (${dirtyEntries.length})` : 'Сохранить')}
            </Btn>
          </>
        }
      />

      <div className="card">
        <div className="card-body col gap-16" style={{ padding: 20 }}>
          {SECTIONS.map((sec) => (
            <section key={sec.id} className="col gap-8" data-test={`ts-settings-section-${sec.id}`}>
              <header className="row gap-8" style={{ alignItems: 'baseline' }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--t-1)' }}>{sec.title}</h3>
              </header>
              <div className="c-t3" style={{ fontSize: 12, lineHeight: 1.5 }}>{sec.hint}</div>

              <div className="row gap-16" style={{ flexWrap: 'wrap' }}>
                {sec.items.map((it) => {
                  const k = keyOf(it.type, it.position);
                  const before = original[k];
                  const after = values[k];
                  const changed = before !== after;
                  return (
                    <div key={k} style={{ minWidth: 200 }}>
                      <Field label={it.label} help={changed ? `Было: ${before}` : ' '}>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={after ?? 0}
                          onChange={(e) => onChange(k, e.target.value)}
                          aria-label={`${it.label} — баллов`}
                          data-test={`ts-settings-input-${it.type}-${it.position || 'all'}`}
                        />
                      </Field>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {isDirty && (
            <div
              className="row gap-8"
              style={{
                padding: 12,
                background: 'var(--warn-bg, rgba(245,158,11,0.10))',
                border: '1px solid var(--warn, #f59e0b)',
                borderRadius: 8,
                color: 'var(--t-1)',
                fontSize: 13
              }}
            >
              ⚠ Несохранённые изменения: <b>{dirtyEntries.length}</b>
              {hugeChanges.length > 0 && (
                <span className="c-t3">· из них {hugeChanges.length} больше 50% от текущего</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
