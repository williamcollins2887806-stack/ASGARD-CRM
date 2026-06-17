/**
 * Страница /field-tariffs — Тарифная сетка Полевого модуля (CRM 2.0).
 *
 * Источник: vanilla `public/assets/js/field-tariffs.js` (282 строки) +
 * backend `src/routes/field-manage.js` (prefix `/api/field/manage`).
 *
 * 5 категорий тарифов (CATEGORY_ORDER):
 *   1. mlsp        — МЛСП (морские)
 *   2. ground      — Наземные (обычные)
 *   3. ground_hard — Наземные (тяжёлые)
 *   4. warehouse   — Склад/база
 *   5. special     — Специальные
 *
 * Поля каждого тарифа (field_tariff_grid):
 *   position_name, points, rate_per_shift, is_combinable, requires_approval, notes
 *
 * RBAC: ADMIN.
 *
 * Vanilla coverage checklist:
 *   [x] GET    /api/field/manage/tariffs?category=all
 *   [x] POST   /api/field/manage/tariffs                 (создание)
 *   [x] PUT    /api/field/manage/tariffs/:id             (правка)
 *   [x] DELETE /api/field/manage/tariffs/:id             (soft-delete)
 *   [x] Группировка по 5 категориям с сортировкой CATEGORY_ORDER
 *   [x] Поля: position_name, points, rate_per_shift, is_combinable, requires_approval, notes
 *   [x] Нота про point_value (500 ₽/балл) выводится из ответа сервера
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState, LoadingCard } from '@/blocks/Blocks';

import {
  SETTINGS_ROLES,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DEFAULT_POINT_VALUE,
  loadTariffs,
  deleteTariff,
  categoryLabel,
  fmtMoney,
} from './api';
import { TariffEditModal } from './TariffEditModal';
import './field-tariffs.css';

export default function FieldTariffsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [tariffs, setTariffs] = useState([]);
  const [pointValue, setPointValue] = useState(DEFAULT_POINT_VALUE);
  const [loading, setLoading] = useState(false);

  const canView = SETTINGS_ROLES.includes(user?.role);

  const reload = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const data = await loadTariffs();
      const all = [...(data.tariffs || []), ...(data.specials || [])];
      setTariffs(all);
      setPointValue(data.point_value ?? DEFAULT_POINT_VALUE);
    } catch (e) {
      toast.error('Не удалось загрузить тарифы: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => { reload(); }, [reload]);

  const onAdd = () =>
    modal.open(<TariffEditModal onSaved={reload} />, { size: 'wide' });

  const onEdit = (t) =>
    modal.open(<TariffEditModal tariff={t} onSaved={reload} />, { size: 'wide' });

  const onDelete = (t) => {
    modal.open(
      <ConfirmModal
        title="Удалить тариф?"
        message={`Тариф «${t.position_name}» (${categoryLabel(t.category)}) будет помечен неактивным.`}
        tone="danger"
        okText="Удалить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await deleteTariff(t.id);
            toast.success('Тариф удалён');
            reload();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  if (!user) return null;

  if (!canView) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Раздел" title="Тарифы поля" />
        <EmptyState
          icon="🔒"
          title="Нет доступа"
          hint="Раздел доступен только ADMIN"
        />
      </div>
    );
  }

  // Группируем по категории, сохраняя порядок CATEGORY_ORDER.
  const grouped = {};
  for (const t of tariffs) {
    const cat = t.category || 'special';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Раздел"
        title="Тарифы поля"
        subtitle={`Тарифная сетка полевого модуля · ${tariffs.length} записей · 1 балл = ${fmtMoney(pointValue)} ₽`}
        actions={
          <>
            <Btn variant="ghost" onClick={reload} disabled={loading}>
              {loading ? '⏳' : '↻'} Обновить
            </Btn>
            <Btn variant="primary" onClick={onAdd}>＋ Тариф</Btn>
          </>
        }
      />

      <div className="page-content">
        {loading ? (
          <LoadingCard text="Загружаем тарифы…" />
        ) : tariffs.length === 0 ? (
          <EmptyState
            icon="📋"
            title="Тарифов пока нет"
            hint="Добавьте первый через кнопку «＋ Тариф»."
            action={<Btn variant="primary" onClick={onAdd}>＋ Создать тариф</Btn>}
          />
        ) : (
          <div className="col gap-16">
            {CATEGORY_ORDER.map((cat) => {
              const items = grouped[cat];
              if (!items || items.length === 0) return null;
              return (
                <TariffSection
                  key={cat}
                  category={cat}
                  label={CATEGORY_LABELS[cat] || cat}
                  items={items}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              );
            })}
            <div className="fs-12 c-t3 mt-4">
              Стоимость 1 балла: {fmtMoney(pointValue)} ₽. Ставка = Баллы × {fmtMoney(pointValue)}.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Секция категории ───────────────────────────────────────────────────── */

function TariffSection({ category, label, items, onEdit, onDelete }) {
  return (
    <div className="card card-pad-overflow">
      <div className="ft-cat-head">
        <span className="ft-cat-title">{label}</span>
        <span className="ft-cat-count">{items.length}</span>
      </div>
      <div className="ov-x-auto">
        <table className="ft-table">
          <thead>
            <tr>
              <th>Должность</th>
              <th className="center">Баллы</th>
              <th className="right">Ставка ₽/смена</th>
              <th className="center">Комби</th>
              <th className="center">Согл.</th>
              <th>Заметки</th>
              <th className="right"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} data-cat={category}>
                <td>{t.position_name}</td>
                <td className="center">{t.points ?? 0}</td>
                <td className="right fw-700">{fmtMoney(t.rate_per_shift)} ₽</td>
                <td className="center">
                  {t.is_combinable ? <span className="ft-flag on">✓</span> : <span className="ft-flag off">—</span>}
                </td>
                <td className="center">
                  {t.requires_approval ? <span className="ft-flag on">✓</span> : <span className="ft-flag off">—</span>}
                </td>
                <td className="ft-notes" title={t.notes || ''}>{t.notes || ''}</td>
                <td className="right">
                  <Btn size="sm" variant="ghost" onClick={() => onEdit(t)} aria-label="Править">✎</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => onDelete(t)} aria-label="Удалить">🗑</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
