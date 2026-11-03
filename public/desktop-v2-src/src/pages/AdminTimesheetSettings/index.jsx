/**
 * Страница /admin/timesheet-settings — ставки этапов табеля (₽).
 *
 * С 01.11.2026: UI в ₽ (rate_rub), шаг 10. Title «Ставки этапов».
 *
 * API:
 *   GET  /api/timesheet/v2/settings/position-points  — { position_points, position_rates }
 *   PUT  /api/timesheet/v2/settings/position-points  — { type, position, rate_rub }
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn, Field, Input } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { getSettings, updateSettings } from '@/pages/Timesheet/api';
import { snapRubStep10 } from '@/lib/moneyCompact';

const EDIT_ROLES = ['ADMIN', 'DIRECTOR_GEN'];

const SECTIONS = [
  {
    id: 'warehouse',
    title: '📦 Склад',
    hint: 'Ставка ₽ за день на складе. Зависит от должности.',
    items: [
      { type: 'warehouse', position: 'слесарь', label: 'Слесарь' },
      { type: 'warehouse', position: 'мастер',  label: 'Мастер' }
    ]
  },
  {
    id: 'medical',
    title: '🏥 Медосмотр',
    hint: 'Ставка ₽ за день медосмотра. Ставят ТО / Рук. ТО.',
    items: [
      { type: 'medical', position: null, label: 'Медосмотр' }
    ]
  },
  {
    id: 'training',
    title: '🎓 Обучение',
    hint: 'Ставка ₽ за день обучения. Ставят ТО / Рук. ТО.',
    items: [
      { type: 'training', position: null, label: 'Обучение' }
    ]
  },
  {
    id: 'travel',
    title: '✈️ Дорога',
    hint: 'Ставка ₽ за день в дороге (наземный транспорт).',
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
  },
  {
    id: 'helicopter',
    title: '🚁 Вертолёт',
    hint: 'Иной транспорт — вертолёт. Ставят ТО / Рук. ТО.',
    items: [
      { type: 'helicopter', position: null, label: 'Вертолёт' }
    ]
  }
];

function keyOf(type, position) {
  return position ? `${type}:${position}` : type;
}

/** Парсит ответ → плоский объект { key: rate_rub }. */
function parseResponse(res) {
  const map = {};
  const rates = res?.position_rates;
  if (rates && typeof rates === 'object') {
    for (const [k, v] of Object.entries(rates)) {
      map[k] = Number(v) || 0;
    }
  }
  // Fallback: legacy points × 500
  if (!Object.keys(map).length) {
    const pts = res?.position_points;
    if (pts && typeof pts === 'object') {
      for (const [k, v] of Object.entries(pts)) {
        if (typeof v === 'object' && v !== null) {
          for (const [pos, p] of Object.entries(v)) {
            map[`${k}:${pos}`] = (Number(p) || 0) * 500;
          }
        } else {
          map[k] = (Number(v) || 0) * 500;
        }
      }
    }
  }
  return map;
}

const DEFAULT_RATES = {
  'warehouse:слесарь': 5000,
  'warehouse:мастер': 6000,
  medical: 3500,
  training: 3500,
  travel: 3000,
  ship: 6000,
  helicopter: 3000
};

export default function AdminTimesheetSettingsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const hasAccess = useMemo(() => !!(user && EDIT_ROLES.includes(user.role)), [user]);

  const [original, setOriginal] = useState({});
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = () => {
    setLoading(true);
    getSettings()
      .then((r) => {
        const map = parseResponse(r);
        const merged = { ...DEFAULT_RATES, ...map };
        setOriginal(merged);
        setValues(merged);
      })
      .catch((e) => {
        toast.error('Не удалось загрузить настройки: ' + (e?.message || e));
        setOriginal(DEFAULT_RATES);
        setValues(DEFAULT_RATES);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (hasAccess) refresh();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess]);

  const onChange = (k, v) => {
    const num = snapRubStep10(Math.max(0, Number(v) || 0));
    setValues((prev) => ({ ...prev, [k]: num }));
  };

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
      if (base === 0) return d.after > 0;
      const ratio = Math.abs((d.after - base) / base);
      return ratio > 0.5;
    });
  }, [dirtyEntries]);

  const persist = async () => {
    setSaving(true);
    try {
      for (const d of dirtyEntries) {
        await updateSettings({
          type: d.type,
          position: d.position,
          rate_rub: snapRubStep10(d.after)
        });
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
                    <b>{d.label}</b>: {d.before.toLocaleString('ru-RU')} ₽ → <b>{d.after.toLocaleString('ru-RU')} ₽</b>
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

  if (!hasAccess) {
    return (
      <AccessDenied
        allowed={EDIT_ROLES}
        userRole={user?.role || '—'}
        title="Ставки этапов"
        message={`Эта страница доступна для ролей: ${EDIT_ROLES.join(', ')}.`}
      />
    );
  }

  if (loading) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Кузница" title="Ставки этапов" />
        <div className="card card-empty">⏳ Загружаем…</div>
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Кузница"
        title="Ставки этапов"
        subtitle="Ставки ₽ за день по типу: склад / медосмотр / дорога"
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
                      <Field label={it.label} help={changed ? `Было: ${Number(before).toLocaleString('ru-RU')} ₽` : ' '}>
                        <Input
                          type="number"
                          min="0"
                          step="10"
                          inputMode="numeric"
                          value={after ?? 0}
                          onChange={(e) => onChange(k, e.target.value)}
                          aria-label={`${it.label} — ₽`}
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
