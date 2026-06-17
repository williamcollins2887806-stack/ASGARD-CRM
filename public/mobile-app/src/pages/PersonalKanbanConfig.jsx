/**
 * PersonalKanbanConfig — Настройка подэтапов (§3.2).
 *
 * Возможности:
 *   - Выбор flow_type + main_status
 *   - Реалтайм-валидация title (2..40)
 *   - Изменение цвета (палитра 8 + custom)
 *   - Reorder через стрелки ▲▼ (дробный sort_order: среднее между соседями)
 *   - Soft-delete с гардом «есть N карт» → перенос на target → удаление
 *   - Кнопка «Загрузить шаблон Подготовка ТКП» (batch INSERT через цикл)
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  ChevronUp, ChevronDown, Trash2, Plus, Palette, Check, X, Sparkles,
} from 'lucide-react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { EmptyState } from '@/components/shared/EmptyState';

// Те же канонические main_status, что в PersonalKanban (синхронизированы с backend)
const CANONICAL_MAIN_STATUSES = {
  application: [
    { id: 'new',           label: 'Новые' },
    { id: 'ai_processed',  label: 'AI обработана' },
    { id: 'under_review',  label: 'На проверке' },
    { id: 'assigned',      label: 'Назначена' },
    { id: 'accepted',      label: 'Принята' },
    { id: 'rejected',      label: 'Отклонена' },
    { id: 'archived',      label: 'Архив' },
  ],
  tender: [
    { id: 'Черновик',                label: 'Черновик' },
    { id: 'Новый',                   label: 'Новый' },
    { id: 'На анализе',              label: 'На анализе' },
    { id: 'Отправлено на просчёт',   label: 'На просчёте' },
    { id: 'Согласование ТКП',        label: 'Согл. ТКП' },
    { id: 'ТКП согласовано',         label: 'ТКП согл.' },
    { id: 'Готово к отправке КП',    label: 'Готово к КП' },
    { id: 'КП отправлено',           label: 'КП отправлено' },
    { id: 'Выиграли',                label: 'Выиграли' },
    { id: 'Проиграли',               label: 'Проиграли' },
    { id: 'Не подходит',             label: 'Не подходит' },
  ],
  pre_tender: [
    { id: 'new',              label: 'Новые' },
    { id: 'in_review',        label: 'На проверке' },
    { id: 'need_docs',        label: 'Нужны документы' },
    { id: 'accepted',         label: 'Принят' },
    { id: 'rejected',         label: 'Отклонён' },
    { id: 'expired',          label: 'Истёк' },
    { id: 'pending_approval', label: 'Согласование' },
    { id: 'approved',         label: 'Согласован' },
    { id: 'pending_payment',  label: 'Ждёт оплаты' },
    { id: 'paid',             label: 'Оплачен' },
    { id: 'cash_issued',      label: 'Касса выдана' },
    { id: 'cash_received',    label: 'Касса получена' },
    { id: 'expense_reported', label: 'Отчёт сдан' },
  ],
  work: [
    { id: 'Новая',           label: 'Новая' },
    { id: 'Подготовка',      label: 'Подготовка' },
    { id: 'Мобилизация',     label: 'Мобилизация' },
    { id: 'В работе',        label: 'В работе' },
    { id: 'На паузе',        label: 'На паузе' },
    { id: 'Подписание акта', label: 'Подписание акта' },
    { id: 'Работы сдали',    label: 'Сданы' },
    { id: 'Закрыт',          label: 'Закрыт' },
  ],
};

const FLOW_TYPES = [
  { id: 'application', label: 'Заявки'     },
  { id: 'tender',      label: 'Тендеры'    },
  { id: 'pre_tender',  label: 'Пре-тендеры'},
  { id: 'work',        label: 'Работы'     },
];

const COLOR_PALETTE = [
  '#c8a84e', // gold
  '#4A90D9', // blue
  '#30d158', // green
  '#7B68EE', // purple
  '#ff453a', // red-soft
  '#ff9f0a', // orange
  '#5ac8fa', // cyan
  '#8a93a6', // grey (default)
];

const TEMPLATES = {
  'tkp_prep': {
    label: 'Подготовка ТКП',
    flow_type: 'pre_tender',
    main_status: 'in_review',
    substages: [
      { title: 'Входящая заявка',          color: '#5ac8fa' },
      { title: 'Созвон с клиентом',        color: '#4A90D9' },
      { title: 'Получение доп. информации',color: '#7B68EE' },
      { title: 'Осмотр объекта',           color: '#ff9f0a' },
      { title: 'Расчёт ТКП',               color: '#c8a84e' },
      { title: 'Согласование с директором',color: '#30d158' },
    ],
  },
};

export default function PersonalKanbanConfig() {
  const haptic = useHaptic();
  const [flowType,   setFlowType]   = useState('application');
  const [mainStatus, setMainStatus] = useState(CANONICAL_MAIN_STATUSES.application[0].id);
  const [substages,  setSubstages]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [creating,   setCreating]   = useState(false);
  const [newTitle,   setNewTitle]   = useState('');
  const [newColor,   setNewColor]   = useState(COLOR_PALETTE[0]);
  const [colorPickerFor, setColorPickerFor] = useState(null); // substage id
  const [deleteFor,  setDeleteFor]  = useState(null); // substage row
  const [editFor,    setEditFor]    = useState(null); // substage row для inline-rename

  // ─── Загрузка ──────────────────────────────────────────────────────────
  const fetchSubstages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/personal-kanban/substages?flow_type=${encodeURIComponent(flowType)}`);
      setSubstages(res?.items || []);
    } catch (e) {
      console.error('[personal-kanban-config] load', e);
      setSubstages([]);
    } finally {
      setLoading(false);
    }
  }, [flowType]);

  useEffect(() => { fetchSubstages(); }, [fetchSubstages]);

  useEffect(() => {
    const list = CANONICAL_MAIN_STATUSES[flowType] || [];
    if (list.length && !list.find((s) => s.id === mainStatus)) {
      setMainStatus(list[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowType]);

  // ─── Подэтапы текущего main_status ─────────────────────────────────────
  const visible = useMemo(
    () => substages.filter((s) => s.main_status === mainStatus),
    [substages, mainStatus]
  );

  // ─── Создание ──────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    const t = newTitle.trim();
    if (t.length < 2 || t.length > 40) {
      toast.error('Название: 2–40 символов');
      return;
    }
    setCreating(true);
    try {
      const res = await api.post('/personal-kanban/substages', {
        flow_type:   flowType,
        main_status: mainStatus,
        title:       t,
        color:       newColor,
      });
      haptic.success();
      toast.success('Подэтап создан');
      setNewTitle('');
      setNewColor(COLOR_PALETTE[0]);
      setSubstages((cur) => [...cur, res.item].sort((a, b) => a.sort_order - b.sort_order));
    } catch (e) {
      haptic.error();
      toast.error(e?.message || 'Не удалось создать');
    } finally {
      setCreating(false);
    }
  }, [newTitle, newColor, flowType, mainStatus, haptic]);

  // ─── Reorder ───────────────────────────────────────────────────────────
  const handleReorder = useCallback(async (substage, direction) => {
    const idx = visible.findIndex((s) => s.id === substage.id);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= visible.length) return;
    const prev = visible[swapIdx - (direction === 'up' ? 1 : 0)];
    const next = visible[swapIdx + (direction === 'up' ? 0 : 1)];
    let newSort;
    if (direction === 'up') {
      newSort = prev ? (prev.sort_order + visible[swapIdx].sort_order) / 2
                     : visible[swapIdx].sort_order - 500;
    } else {
      newSort = next ? (visible[swapIdx].sort_order + next.sort_order) / 2
                     : visible[swapIdx].sort_order + 500;
    }
    haptic.light();
    try {
      const res = await api.patch(`/personal-kanban/substages/${substage.id}`, {
        sort_order: newSort,
        version:    substage.version,
      });
      setSubstages((cur) =>
        cur.map((s) => (s.id === substage.id ? res.item : s)).sort((a, b) => a.sort_order - b.sort_order)
      );
    } catch (e) {
      haptic.error();
      if (e?.body?.error === 'version_conflict') {
        toast.error('Подэтап обновился — обновите страницу');
        await fetchSubstages();
      } else {
        toast.error(e?.message || 'Не удалось');
      }
    }
  }, [visible, haptic, fetchSubstages]);

  // ─── Изменение цвета ───────────────────────────────────────────────────
  const handleColorChange = useCallback(async (substage, color) => {
    setColorPickerFor(null);
    try {
      const res = await api.patch(`/personal-kanban/substages/${substage.id}`, {
        color,
        version: substage.version,
      });
      setSubstages((cur) =>
        cur.map((s) => (s.id === substage.id ? res.item : s))
      );
      haptic.success();
    } catch (e) {
      haptic.error();
      toast.error(e?.message || 'Не удалось');
    }
  }, [haptic]);

  // ─── Переименование ───────────────────────────────────────────────────
  const handleRename = useCallback(async (substage, newTitleVal) => {
    const t = (newTitleVal || '').trim();
    if (t.length < 2 || t.length > 40) {
      toast.error('Название: 2–40 символов');
      return;
    }
    if (t === substage.title) { setEditFor(null); return; }
    try {
      const res = await api.patch(`/personal-kanban/substages/${substage.id}`, {
        title: t,
        version: substage.version,
      });
      setSubstages((cur) =>
        cur.map((s) => (s.id === substage.id ? res.item : s))
      );
      haptic.success();
      setEditFor(null);
    } catch (e) {
      haptic.error();
      if (e?.body?.error === 'version_conflict') {
        toast.error('Подэтап обновился — обновите страницу');
        await fetchSubstages();
      } else {
        toast.error(e?.message || 'Не удалось');
      }
    }
  }, [haptic, fetchSubstages]);

  // ─── Удаление ──────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (substage) => {
    try {
      await api.delete(`/personal-kanban/substages/${substage.id}`);
      haptic.success();
      toast.success('Подэтап удалён');
      setSubstages((cur) => cur.filter((s) => s.id !== substage.id));
      setDeleteFor(null);
    } catch (e) {
      if (e?.body?.error === 'has_cards') {
        setDeleteFor({
          ...substage,
          cards_count: e.body.cards_count,
          suggest_target_id: e.body.suggest_target_id,
        });
        return;
      }
      haptic.error();
      toast.error(e?.message || 'Не удалось');
    }
  }, [haptic]);

  const handleMoveCardsAndDelete = useCallback(async (substage, targetId) => {
    try {
      await api.post(`/personal-kanban/substages/${substage.id}/move-cards-to/${targetId}`);
      await api.delete(`/personal-kanban/substages/${substage.id}`);
      haptic.success();
      toast.success('Карты перенесены, подэтап удалён');
      setSubstages((cur) => cur.filter((s) => s.id !== substage.id));
      setDeleteFor(null);
    } catch (e) {
      haptic.error();
      toast.error(e?.message || 'Не удалось');
    }
  }, [haptic]);

  // ─── Загрузка шаблона ──────────────────────────────────────────────────
  const handleLoadTemplate = useCallback(async (key) => {
    const tpl = TEMPLATES[key];
    if (!tpl) return;
    if (flowType !== tpl.flow_type) setFlowType(tpl.flow_type);
    if (mainStatus !== tpl.main_status) setMainStatus(tpl.main_status);
    // Batch INSERT через цикл
    let ok = 0; let fail = 0;
    for (const s of tpl.substages) {
      try {
        await api.post('/personal-kanban/substages', {
          flow_type:   tpl.flow_type,
          main_status: tpl.main_status,
          title:       s.title,
          color:       s.color,
        });
        ok++;
      } catch { fail++; }
    }
    haptic.success();
    toast.success(`Шаблон загружен (${ok}/${tpl.substages.length})`);
    if (fail > 0) toast.error(`${fail} подэтапов не создалось (возможно дубль)`);
    // Обновляем
    setFlowType(tpl.flow_type);
    setMainStatus(tpl.main_status);
    await fetchSubstages();
  }, [flowType, mainStatus, fetchSubstages, haptic]);

  return (
    <PageShell title="Подэтапы канбана" showBack>
      <div className="flex flex-col gap-3 pb-6">
        {/* Селектор flow_type */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pt-1">
          {FLOW_TYPES.map((ft) => {
            const active = ft.id === flowType;
            return (
              <button
                key={ft.id}
                onClick={() => { haptic.light(); setFlowType(ft.id); }}
                className="px-3.5 py-2 rounded-full spring-tap whitespace-nowrap text-[13px]"
                style={{
                  background: active
                    ? 'color-mix(in srgb, var(--gold) 20%, transparent)'
                    : 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                  border: active ? '0.5px solid var(--gold)' : '0.5px solid var(--border-norse)',
                  color: active ? 'var(--gold)' : 'var(--text-primary)',
                  fontWeight: active ? 700 : 500,
                  fontFamily: active ? 'Cinzel, "SF Pro Display", serif' : 'inherit',
                }}
              >
                {ft.label}
              </button>
            );
          })}
        </div>

        {/* Селектор main_status */}
        <div className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
          {(CANONICAL_MAIN_STATUSES[flowType] || []).map((ms) => {
            const active = ms.id === mainStatus;
            return (
              <button
                key={ms.id}
                onClick={() => { haptic.light(); setMainStatus(ms.id); }}
                className="px-3 py-1.5 rounded-lg spring-tap whitespace-nowrap text-[12px]"
                style={{
                  background: active
                    ? 'color-mix(in srgb, var(--gold) 15%, transparent)'
                    : 'transparent',
                  border: active
                    ? '0.5px solid color-mix(in srgb, var(--gold) 50%, transparent)'
                    : '0.5px solid var(--border-norse)',
                  color: active ? 'var(--gold)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 500,
                }}
              >
                {ms.label}
              </button>
            );
          })}
        </div>

        {/* Шаблоны (только для tender / Согласование ТКП) */}
        <div
          className="rounded-2xl p-3 mt-1"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
            border: '0.5px solid color-mix(in srgb, var(--gold) 25%, transparent)',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} style={{ color: 'var(--gold)' }} />
            <p className="text-[12px] font-semibold c-primary">Готовые шаблоны</p>
          </div>
          <button
            onClick={() => handleLoadTemplate('tkp_prep')}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] font-medium spring-tap text-left"
            style={{
              background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
              color: 'var(--gold)',
              border: '0.5px solid color-mix(in srgb, var(--gold) 35%, transparent)',
            }}
          >
            Загрузить шаблон «Подготовка ТКП»
            <span className="block text-[10px] mt-0.5 opacity-70" style={{ color: 'var(--text-secondary)' }}>
              Pre-tender · «На рассмотрении» · 6 подэтапов
            </span>
          </button>
        </div>

        {/* Список подэтапов */}
        <div className="mt-1">
          <p className="text-[11px] uppercase tracking-wider c-tertiary mb-2 px-1">
            Подэтапы · {visible.length}
          </p>
          {loading ? (
            <SkeletonList count={4} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={Palette}
              title="Нет подэтапов"
              description="Создайте первый подэтап в форме ниже"
            />
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((s, idx) => (
                <div
                  key={s.id}
                  className="rounded-2xl p-3"
                  style={{
                    background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                    border: '0.5px solid var(--border-norse)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setColorPickerFor(s.id)}
                      aria-label="Изменить цвет"
                      className="spring-tap"
                      style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: s.color,
                        border: '0.5px solid var(--border-light)',
                        flexShrink: 0,
                      }}
                    />
                    {editFor?.id === s.id ? (
                      <InlineRename
                        initial={s.title}
                        onSave={(t) => handleRename(s, t)}
                        onCancel={() => setEditFor(null)}
                      />
                    ) : (
                      <button
                        onClick={() => setEditFor(s)}
                        className="flex-1 text-left text-[14px] font-medium c-primary truncate"
                      >
                        {s.title}
                      </button>
                    )}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => handleReorder(s, 'up')}
                        disabled={idx === 0}
                        aria-label="Вверх"
                        className="spring-tap flex items-center justify-center"
                        style={{
                          width: 30, height: 30, borderRadius: 8,
                          opacity: idx === 0 ? 0.3 : 1,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        onClick={() => handleReorder(s, 'down')}
                        disabled={idx === visible.length - 1}
                        aria-label="Вниз"
                        className="spring-tap flex items-center justify-center"
                        style={{
                          width: 30, height: 30, borderRadius: 8,
                          opacity: idx === visible.length - 1 ? 0.3 : 1,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <ChevronDown size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        aria-label="Удалить"
                        className="spring-tap flex items-center justify-center"
                        style={{
                          width: 30, height: 30, borderRadius: 8,
                          color: 'var(--red-soft)',
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Форма создания */}
        <div
          className="rounded-2xl p-3 mt-2"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
            border: '0.5px solid var(--border-norse)',
          }}
        >
          <p className="text-[11px] uppercase tracking-wider c-tertiary mb-2 px-1">
            Новый подэтап
          </p>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Название (2–40 символов)"
            maxLength={40}
            className="w-full rounded-xl px-3.5 py-2.5 text-[14px] mb-2"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
              border: newTitle.length > 0 && (newTitle.trim().length < 2 || newTitle.length > 40)
                ? '0.5px solid var(--red-soft)'
                : '0.5px solid var(--border-norse)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          <div className="flex gap-1.5 flex-wrap mb-2">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                aria-label={`Цвет ${c}`}
                className="spring-tap"
                style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: c,
                  border: newColor === c
                    ? '2px solid var(--text-primary)'
                    : '0.5px solid var(--border-light)',
                }}
              />
            ))}
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || newTitle.trim().length < 2}
            className="w-full rounded-xl px-4 py-2.5 text-[14px] font-semibold spring-tap"
            style={{
              background: creating || newTitle.trim().length < 2
                ? 'var(--bg-elevated)'
                : 'var(--gold-gradient)',
              color: creating || newTitle.trim().length < 2
                ? 'var(--text-tertiary)'
                : '#fff',
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Plus size={16} />
              Создать
            </span>
          </button>
        </div>
      </div>

      {/* Color-picker BottomSheet */}
      <BottomSheet
        open={colorPickerFor != null}
        onClose={() => setColorPickerFor(null)}
        title="Цвет подэтапа"
      >
        <div className="grid grid-cols-4 gap-2 pb-3">
          {COLOR_PALETTE.map((c) => {
            const s = visible.find((x) => x.id === colorPickerFor);
            return (
              <button
                key={c}
                onClick={() => s && handleColorChange(s, c)}
                aria-label={`Цвет ${c}`}
                className="spring-tap rounded-xl flex items-center justify-center"
                style={{
                  height: 56,
                  background: c,
                  border: '0.5px solid var(--border-light)',
                }}
              >
                {s?.color === c && <Check size={20} style={{ color: '#fff' }} />}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* Delete sheet с переносом карт */}
      <BottomSheet
        open={deleteFor != null}
        onClose={() => setDeleteFor(null)}
        title={`Удалить «${deleteFor?.title || ''}»?`}
      >
        <div className="flex flex-col gap-3 pb-3">
          {deleteFor?.cards_count > 0 ? (
            <>
              <p className="text-[13px] c-primary">
                На подэтапе <b>{deleteFor.cards_count}</b> {deleteFor.cards_count === 1 ? 'карта' : 'карт'}.
                Куда перенести?
              </p>
              <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto scroll-container">
                {visible
                  .filter((s) => s.id !== deleteFor.id)
                  .map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleMoveCardsAndDelete(deleteFor, s.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl spring-tap text-left"
                      style={{
                        background: deleteFor.suggest_target_id === s.id
                          ? 'color-mix(in srgb, var(--gold) 12%, transparent)'
                          : 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
                        border: deleteFor.suggest_target_id === s.id
                          ? '0.5px solid color-mix(in srgb, var(--gold) 50%, transparent)'
                          : '0.5px solid var(--border-norse)',
                      }}
                    >
                      <span
                        style={{
                          width: 8, height: 22, borderRadius: 3,
                          background: s.color || 'var(--gold)',
                        }}
                      />
                      <span className="flex-1 text-[14px] c-primary">{s.title}</span>
                      {deleteFor.suggest_target_id === s.id && (
                        <span className="text-[10px] c-gold">рекомендуем</span>
                      )}
                    </button>
                  ))}
                {visible.filter((s) => s.id !== deleteFor.id).length === 0 && (
                  <p className="text-[13px] c-secondary text-center py-3">
                    Нет других подэтапов. Сначала создайте новый, потом удалите этот.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] c-primary">
                Подэтап будет помечен как неактивный (карт нет).
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteFor(null)}
                  className="flex-1 rounded-xl px-4 py-2.5 text-[14px] font-semibold spring-tap"
                  style={{
                    background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                    border: '0.5px solid var(--border-norse)',
                    color: 'var(--text-primary)',
                  }}
                >
                  Отмена
                </button>
                <button
                  onClick={() => handleDelete(deleteFor)}
                  className="flex-1 rounded-xl px-4 py-2.5 text-[14px] font-semibold spring-tap"
                  style={{
                    background: 'var(--red-soft)',
                    color: '#fff',
                  }}
                >
                  Удалить
                </button>
              </div>
            </>
          )}
        </div>
      </BottomSheet>
    </PageShell>
  );
}

function InlineRename({ initial, onSave, onCancel }) {
  const [val, setVal] = useState(initial);
  return (
    <div className="flex items-center gap-1.5 flex-1">
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(val);
          if (e.key === 'Escape') onCancel();
        }}
        maxLength={40}
        className="flex-1 rounded-lg px-2 py-1 text-[14px]"
        style={{
          background: 'color-mix(in srgb, var(--bg-elevated) 70%, transparent)',
          border: '0.5px solid var(--gold)',
          color: 'var(--text-primary)',
          outline: 'none',
        }}
      />
      <button
        onClick={() => onSave(val)}
        aria-label="Сохранить"
        className="spring-tap flex items-center justify-center"
        style={{ width: 28, height: 28, borderRadius: 8, color: 'var(--green)' }}
      >
        <Check size={16} />
      </button>
      <button
        onClick={onCancel}
        aria-label="Отмена"
        className="spring-tap flex items-center justify-center"
        style={{ width: 28, height: 28, borderRadius: 8, color: 'var(--text-secondary)' }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
