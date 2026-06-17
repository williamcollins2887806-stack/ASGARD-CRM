/**
 * ConfiguratorModal — управление подэтапами выбранного flow_type+main_status.
 * - CRUD: add/rename/recolor/delete
 * - Native HTML5 DnD для смены порядка (sort_order, дробный)
 * - Шаблон «Подготовка ТКП» (batch INSERT)
 * - Удаление с гардом «есть карты» → 409 → диалог переноса в другой подэтап.
 */
import { useEffect, useState, useRef } from 'react';
import { MCard, MHead, MBody, MFoot, Btn, Field, Input } from '@/modals/parts';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import {
  loadSubstages, createSubstage, patchSubstage, deleteSubstage,
  moveCardsToSubstage,
  COLOR_PALETTE, SUBSTAGE_TEMPLATES, MAIN_STATUSES, mainStatusLabel
} from './api';

export default function ConfiguratorModal({ flow_type, main_status, onChanged }) {
  const { close } = useModal();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newColor, setNewColor] = useState(COLOR_PALETTE[0]);
  const dragRef = useRef(null);

  const refresh = () => {
    setLoading(true);
    loadSubstages({ flow_type, main_status })
      .then(setItems)
      .catch((e) => toast.error('Ошибка загрузки: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [flow_type, main_status]);

  const handleAdd = async () => {
    const t = newTitle.trim();
    if (t.length < 2 || t.length > 40) {
      toast.warn('Название: 2..40 символов');
      return;
    }
    setAdding(true);
    try {
      await createSubstage({ flow_type, main_status, title: t, color: newColor });
      setNewTitle('');
      toast.success('Подэтап создан');
      refresh();
      onChanged?.();
    } catch (e) {
      toast.error('Не удалось создать: ' + (e?.message || e));
    } finally {
      setAdding(false);
    }
  };

  const handleRename = async (item, value) => {
    const v = (value || '').trim();
    if (v === item.title) return;
    if (v.length < 2 || v.length > 40) {
      toast.warn('Название: 2..40 символов');
      return;
    }
    try {
      const upd = await patchSubstage(item.id, { title: v, version: item.version });
      setItems((arr) => arr.map((x) => (x.id === item.id ? upd : x)));
      onChanged?.();
    } catch (e) {
      if (e?.status === 409) {
        toast.warn('Конфликт версий — обновляем список');
        refresh();
      } else {
        toast.error('Не удалось переименовать: ' + (e?.message || e));
      }
    }
  };

  const handleRecolor = async (item, color) => {
    try {
      const upd = await patchSubstage(item.id, { color, version: item.version });
      setItems((arr) => arr.map((x) => (x.id === item.id ? upd : x)));
      onChanged?.();
    } catch (e) {
      if (e?.status === 409) refresh();
      else toast.error('Не удалось сменить цвет: ' + (e?.message || e));
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Удалить подэтап «${item.title}»?`)) return;
    try {
      await deleteSubstage(item.id);
      toast.success('Подэтап удалён');
      refresh();
      onChanged?.();
    } catch (e) {
      if (e?.status === 409 && e?.body?.error === 'has_cards') {
        const others = items.filter((x) => x.id !== item.id);
        const suggestId = e.body.suggest_target_id;
        if (others.length === 0) {
          toast.warn(`В подэтапе ${e.body.cards_count} карт. Создайте другой подэтап и сначала перенесите карты.`);
          return;
        }
        const suggest = others.find((x) => x.id === suggestId) || others[0];
        if (!window.confirm(`В подэтапе ${e.body.cards_count} карт. Перенести их в «${suggest.title}» и удалить?`)) return;
        try {
          await moveCardsToSubstage(item.id, suggest.id);
          await deleteSubstage(item.id);
          toast.success('Карты перенесены, подэтап удалён');
          refresh();
          onChanged?.();
        } catch (e2) {
          toast.error('Не удалось завершить удаление: ' + (e2?.message || e2));
        }
      } else {
        toast.error('Не удалось удалить: ' + (e?.message || e));
      }
    }
  };

  /* ── DnD reorder ────────────────────────────────────────── */
  const onRowDragStart = (item, el) => { dragRef.current = item; el?.classList.add('is-dragging'); };
  const onRowDragEnd = (_, el) => { el?.classList.remove('is-dragging'); dragRef.current = null; };
  const onRowDropTo = async (targetItem) => {
    const dragged = dragRef.current;
    dragRef.current = null;
    if (!dragged || dragged.id === targetItem.id) return;
    const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
    const targetIdx = sorted.findIndex((x) => x.id === targetItem.id);
    if (targetIdx < 0) return;
    // Вычисляем новое sort_order как среднее между соседями.
    const prev = sorted[targetIdx - 1];
    const next = sorted[targetIdx];
    let newSort;
    if (!prev) newSort = (next?.sort_order || 1000) - 500;
    else newSort = (prev.sort_order + next.sort_order) / 2;
    if (!Number.isFinite(newSort)) newSort = (next?.sort_order || 1000) + 1000;
    try {
      const upd = await patchSubstage(dragged.id, { sort_order: newSort, version: dragged.version });
      setItems((arr) => arr.map((x) => (x.id === dragged.id ? upd : x)).sort((a, b) => a.sort_order - b.sort_order));
      onChanged?.();
    } catch (e) {
      if (e?.status === 409) refresh();
      else toast.error('Не удалось переставить: ' + (e?.message || e));
    }
  };

  /* ── Шаблон «Подготовка ТКП» ───────────────────────────── */
  const tpl = SUBSTAGE_TEMPLATES.pretkp_in_review;
  const canApplyTpl = tpl.flow_type === flow_type && tpl.main_status === main_status && items.length === 0;

  const applyTemplate = async () => {
    if (!canApplyTpl) return;
    if (!window.confirm(`Загрузить шаблон «${tpl.label}»? Будет создано ${tpl.items.length} подэтапов.`)) return;
    try {
      let sort = 1000;
      for (const it of tpl.items) {
        await createSubstage({ flow_type, main_status, title: it.title, color: it.color, sort_order: sort });
        sort += 1000;
      }
      toast.success('Шаблон применён');
      refresh();
      onChanged?.();
    } catch (e) {
      toast.error('Шаблон не применился: ' + (e?.message || e));
    }
  };

  return (
    <MCard className="lg">
      <MHead
        icon="⚙"
        title={`Подэтапы — ${mainStatusLabel(flow_type, main_status)}`}
        subtitle="Перетащите ▤ для смены порядка. Цвет — кликом по палитре."
        onClose={close}
      />
      <MBody>
        {loading ? (
          <div className="c-t3 p-12">⏳ Загружаем…</div>
        ) : (
          <>
            {items.length === 0 ? (
              <div className="card card-empty t-center p-16">
                У вас ещё нет подэтапов в этом статусе.
                {canApplyTpl && (
                  <div className="mt-12">
                    <Btn variant="primary" onClick={applyTemplate}>
                      Применить шаблон «{tpl.label}» ({tpl.items.length} подэтапов)
                    </Btn>
                  </div>
                )}
              </div>
            ) : (
              <div className="pk-cfg-list">
                {items
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((it) => (
                    <ConfigureRow
                      key={it.id}
                      item={it}
                      onRename={(v) => handleRename(it, v)}
                      onRecolor={(c) => handleRecolor(it, c)}
                      onDelete={() => handleDelete(it)}
                      onDragStart={onRowDragStart}
                      onDragEnd={onRowDragEnd}
                      onDropTo={onRowDropTo}
                    />
                  ))}
              </div>
            )}

            <div className="card p-12 mt-16">
              <div className="fw-700 mb-8 fs-13">+ Новый подэтап</div>
              <div className="row gap-10 u-wrap">
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Field label="Название">
                    <Input
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="Напр. Согласование с клиентом"
                      maxLength={40}
                    />
                  </Field>
                </div>
                <div>
                  <Field label="Цвет">
                    <div className="pk-cfg-palette" role="radiogroup" aria-label="Палитра цветов">
                      {COLOR_PALETTE.map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={newColor === c}
                          aria-label={`Цвет ${c}`}
                          className={'pk-cfg-palette-cell ' + (newColor === c ? 'is-sel' : '')}
                          style={{ background: c }}
                          onClick={() => setNewColor(c)}
                        />
                      ))}
                    </div>
                  </Field>
                </div>
                <div style={{ alignSelf: 'flex-end' }}>
                  <Btn variant="primary" onClick={handleAdd} disabled={adding || newTitle.trim().length < 2}>
                    {adding ? '…' : 'Добавить'}
                  </Btn>
                </div>
              </div>
            </div>
          </>
        )}
      </MBody>
      <MFoot align="end">
        <Btn variant="ghost" onClick={close}>Готово</Btn>
      </MFoot>
    </MCard>
  );
}

function ConfigureRow({ item, onRename, onRecolor, onDelete, onDragStart, onDragEnd, onDropTo }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.title);
  const [pickColor, setPickColor] = useState(false);

  // sync если item изменился извне (refresh после patch)
  useEffect(() => { setVal(item.title); }, [item.title]);

  return (
    <div
      className="pk-cfg-row"
      draggable
      data-substage-id={item.id}
      onDragStart={(e) => {
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(item.id)); } catch { /* noop */ }
        onDragStart?.(item, e.currentTarget);
      }}
      onDragEnd={(e) => onDragEnd?.(item, e.currentTarget)}
      onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch { /* noop */ } }}
      onDrop={(e) => { e.preventDefault(); onDropTo?.(item); }}
    >
      <span className="pk-cfg-grip" aria-hidden="true" title="Перетащите для перестановки">▤</span>

      {editing ? (
        <Input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => { setEditing(false); onRename?.(val); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { setEditing(false); onRename?.(val); }
            if (e.key === 'Escape') { setEditing(false); setVal(item.title); }
          }}
          maxLength={40}
        />
      ) : (
        <button
          type="button"
          className="m-input"
          style={{ background: 'transparent', textAlign: 'left', cursor: 'text' }}
          onClick={() => setEditing(true)}
          title="Клик — переименовать"
        >
          {item.title}
        </button>
      )}

      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className="m-btn ghost"
          onClick={() => setPickColor((x) => !x)}
          title="Сменить цвет"
          aria-label="Сменить цвет"
        >
          <span className="pk-cfg-color-swatch">
            <span className="pk-cfg-color-swatch-dot" style={{ background: item.color }} />
          </span>
        </button>
        {pickColor && (
          <div style={{
            position: 'absolute', top: '110%', right: 0, zIndex: 10,
            background: 'var(--card-bg)', border: '1px solid var(--brd-1)',
            borderRadius: 'var(--r-sm)', boxShadow: 'var(--sh-card)', padding: 8
          }}>
            <div className="pk-cfg-palette" role="radiogroup" aria-label="Цвет подэтапа">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={item.color === c}
                  aria-label={`Цвет ${c}`}
                  className={'pk-cfg-palette-cell ' + (item.color === c ? 'is-sel' : '')}
                  style={{ background: c }}
                  onClick={() => { onRecolor?.(c); setPickColor(false); }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <span className="c-t3 fs-11 t-center">sort {Number(item.sort_order).toFixed(0)}</span>

      <Btn variant="ghost" onClick={onDelete} title="Удалить подэтап" aria-label="Удалить">×</Btn>
    </div>
  );
}
