/**
 * PositionsTable — таблица позиций сметы по 6 блокам (vanilla `estimate_report.js:779..866 renderEditableTable`
 * + `:1432..1503 bindEditableTable` + `:1527..1554 saveCalculation`).
 *
 * Для роли PM (draft/rework/question) — полностью editable:
 *   - inline-редактирование любой ячейки
 *   - добавление/удаление строки (внутри блока)
 *   - дублирование строки
 *   - перемещение строк ↑/↓
 *   - переключение блока для строки (через select)
 *   - изменение % резерва (contingency)
 *   - изменение % маржи
 *   - заметки (notes) к расчёту
 *   - кнопки «💾 Сохранить» + «🧙 Сохранить как override» (calc-override)
 *   - авто-пересчёт row.total / block.subtotal / total / margin при каждом edit
 *
 * Для остальных ролей — компактная read-only консолидация по блокам.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { Btn } from '@/modals/parts';
import { TextareaInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { useModal, ConfirmModal } from '@/modals';
import {
  fmtMoney, saveCalculation, calcOverride,
  recalcRow, recalcAll, BLOCK_META, BLOCK_ORDER
} from '../api';

// Лейблы блоков для select-меню перевода строки в другой блок.
const BLOCK_OPTIONS = BLOCK_ORDER.filter((id) => id !== 'contingency').map((id) => ({
  value: id, label: BLOCK_META[id].icon + ' ' + BLOCK_META[id].name
}));

// Атрибуты, по которым строка считается «детальной» (есть формула).
// Если в строке только `total` — это override-строка (например, прочее), формулу не показываем.
const isDetailRow = (r) => (
  r && (r.qty != null || r.rate != null || r.days != null ||
        r.volume_m3 != null || r.rate_m3 != null ||
        r.qty_kg != null || r.rate_kg != null ||
        r.distance_km != null || r.rate_km != null ||
        r.percent != null)
);

// Создаёт уникальный ключ для каждой строки (React key + drag identity).
let _seq = 0;
const newKey = () => '_row_' + (++_seq) + '_' + Math.random().toString(36).slice(2, 7);
const ensureKeys = (parsed) => {
  if (!parsed?.blocks) return parsed;
  for (const b of parsed.blocks) {
    for (const r of (b.rows || [])) {
      if (!r._key) r._key = newKey();
    }
  }
  return parsed;
};

// Глубокий клон calc-data (используется при добавлении строк).
const cloneCalc = (parsed) => ({
  ...parsed,
  blocks: parsed.blocks.map((b) => ({ ...b, rows: b.rows.map((r) => ({ ...r })) })),
  summary: { ...(parsed.summary || {}) }
});

export default function PositionsTable({ estimate, calcData, canEdit, onSaved }) {
  // Локальный workingCopy редактируется свободно; снапшот синкается из props при перезагрузке родителя.
  const [parsed, setParsed] = useState(() => ensureKeys(calcData ? cloneCalc(calcData) : { blocks: [], summary: {} }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openBlocks, setOpenBlocks] = useState(() => new Set(['personnel', 'chemistry']));
  const [notes, setNotes] = useState(calcData?.notes || '');
  const [marginPct, setMarginPct] = useState(() => Number(calcData?.summary?.margin_pct) || 0);
  const initialSnapshot = useRef(null);
  const modal = useModal();

  // Перезагрузка при изменении props (refresh после save / authcalc).
  useEffect(() => {
    const next = calcData ? ensureKeys(cloneCalc(calcData)) : { blocks: [], summary: {} };
    setParsed(next);
    setNotes(calcData?.notes || '');
    setMarginPct(Number(calcData?.summary?.margin_pct) || 0);
    setDirty(false);
    initialSnapshot.current = JSON.stringify(next);
  }, [calcData]);

  // Глобальные итоги (после пересчёта).
  const totals = useMemo(() => {
    const baseBlocks = (parsed.blocks || []).filter((b) => b.id !== 'contingency');
    const baseCost = baseBlocks.reduce((s, b) => s + (Number(b.subtotal) || 0), 0);
    const contBlock = (parsed.blocks || []).find((b) => b.id === 'contingency');
    const contAmt = Number(contBlock?.subtotal) || 0;
    const totalCost = baseCost + contAmt;
    const price = totalCost * (1 + (Number(marginPct) || 0) / 100);
    return {
      baseCost, contAmt, totalCost,
      price,
      marginRub: price - totalCost,
      contPct: Number(contBlock?.rows?.[0]?.percent) || 5
    };
  }, [parsed, marginPct]);

  // ── мутации ───────────────────────────────────────────────────────────────
  const apply = (mutator) => {
    setParsed((prev) => {
      const next = cloneCalc(prev);
      next.summary = { ...(next.summary || {}), margin_pct: Number(marginPct) || 0 };
      mutator(next);
      recalcAll(next);
      return next;
    });
    setDirty(true);
  };

  const updateRow = (blockId, key, patch) => apply((p) => {
    const b = p.blocks.find((x) => x.id === blockId);
    if (!b) return;
    const r = b.rows.find((x) => x._key === key);
    if (!r) return;
    Object.assign(r, patch);
    // Если пользователь редактирует `total` напрямую (editable=['total']) — не пересчитываем формулу.
    if (!('total' in patch)) recalcRow(r);
  });

  const removeRow = (blockId, key) => apply((p) => {
    const b = p.blocks.find((x) => x.id === blockId);
    if (!b) return;
    b.rows = b.rows.filter((r) => r._key !== key);
  });

  const duplicateRow = (blockId, key) => apply((p) => {
    const b = p.blocks.find((x) => x.id === blockId);
    if (!b) return;
    const idx = b.rows.findIndex((r) => r._key === key);
    if (idx < 0) return;
    const copy = { ...b.rows[idx], _key: newKey(), item: (b.rows[idx].item || '') + ' (копия)' };
    b.rows.splice(idx + 1, 0, copy);
  });

  const moveRow = (blockId, key, delta) => apply((p) => {
    const b = p.blocks.find((x) => x.id === blockId);
    if (!b) return;
    const idx = b.rows.findIndex((r) => r._key === key);
    if (idx < 0) return;
    const j = idx + delta;
    if (j < 0 || j >= b.rows.length) return;
    [b.rows[idx], b.rows[j]] = [b.rows[j], b.rows[idx]];
  });

  const moveRowToBlock = (fromBlockId, key, toBlockId) => {
    if (fromBlockId === toBlockId || toBlockId === 'contingency') return;
    apply((p) => {
      const from = p.blocks.find((x) => x.id === fromBlockId);
      const to = p.blocks.find((x) => x.id === toBlockId);
      if (!from || !to) return;
      const idx = from.rows.findIndex((r) => r._key === key);
      if (idx < 0) return;
      const [row] = from.rows.splice(idx, 1);
      to.rows.push(row);
    });
    setOpenBlocks((s) => new Set([...s, toBlockId]));
  };

  const addRow = (blockId) => {
    apply((p) => {
      const b = p.blocks.find((x) => x.id === blockId);
      if (!b) return;
      b.rows.push({
        _key: newKey(),
        item: '',
        qty: 1,
        rate: 0,
        days: blockId === 'personnel' || blockId === 'travel' ? 1 : null,
        total: 0,
        editable: ['qty', 'rate', 'days', 'total']
      });
    });
    setOpenBlocks((s) => new Set([...s, blockId]));
  };

  const setContingencyPct = (val) => apply((p) => {
    const b = p.blocks.find((x) => x.id === 'contingency');
    if (!b) return;
    if (!b.rows[0]) b.rows[0] = { item: 'Буфер', percent: 5, editable: ['percent'] };
    b.rows[0].percent = Number(val) || 0;
    b.rows[0].item = 'Буфер ' + (Number(val) || 0) + '%';
  });

  const onMarginChange = (val) => {
    setMarginPct(val);
    setParsed((prev) => {
      const next = cloneCalc(prev);
      next.summary = { ...(next.summary || {}), margin_pct: Number(val) || 0 };
      recalcAll(next);
      return next;
    });
    setDirty(true);
  };

  const toggleBlock = (id) => setOpenBlocks((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── валидация перед сохранением ───────────────────────────────────────────
  const validate = (p) => {
    const errors = [];
    for (const b of p.blocks) {
      if (b.id === 'contingency') continue;
      for (let i = 0; i < b.rows.length; i++) {
        const r = b.rows[i];
        if (!r.item || !String(r.item).trim()) {
          errors.push(`${b.name}, строка ${i + 1}: пустое наименование`);
        }
        if (r.qty != null && Number(r.qty) < 0) {
          errors.push(`${b.name}, строка ${i + 1}: количество не может быть отрицательным`);
        }
        if (r.rate != null && Number(r.rate) < 0) {
          errors.push(`${b.name}, строка ${i + 1}: цена не может быть отрицательной`);
        }
      }
    }
    if (Number(marginPct) < -100) errors.push('Маржа не может быть меньше -100%');
    return errors;
  };

  // ── сохранение ────────────────────────────────────────────────────────────
  const save = async (asOverride = false) => {
    const errs = validate(parsed);
    if (errs.length) {
      toast.error('Не сохранено: ' + errs.slice(0, 3).join('; ') + (errs.length > 3 ? ` (+${errs.length - 3})` : ''));
      return;
    }
    setBusy(true);
    try {
      const payload = { ...parsed, notes, summary: { ...(parsed.summary || {}), margin_pct: Number(marginPct) || 0 } };
      await saveCalculation(estimate.id, payload);
      if (asOverride) {
        await calcOverride(estimate.id, { calc_data: payload });
      }
      toast.success(asOverride ? 'Override сохранён' : 'Расчёт сохранён');
      setDirty(false);
      onSaved?.();
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // Сброс изменений (restore initial snapshot).
  const resetChanges = () => {
    if (!initialSnapshot.current) return;
    modal.open(
      <ConfirmModal
        title="Откатить изменения?"
        message="Все ваши правки будут потеряны. Восстановить значения с момента загрузки?"
        confirmText="Откатить"
        confirmTone="rejected"
        onConfirm={() => {
          try {
            const restored = JSON.parse(initialSnapshot.current);
            setParsed(restored);
            setNotes(calcData?.notes || '');
            setMarginPct(Number(calcData?.summary?.margin_pct) || 0);
            setDirty(false);
          } catch { /* ignore */ }
        }}
      />
    );
  };

  // ── render ────────────────────────────────────────────────────────────────
  const blocks = parsed.blocks || [];
  if (!blocks.length || blocks.every((b) => !b.rows.length)) {
    return (
      <div className="card er-positions-card er-positions-empty-card">
        <strong className="fs-13">Позиции расчёта</strong>
        <div className="er-positions-empty">
          <p>Данные расчёта ещё не заполнены</p>
          <p className="fs-12 c-t-3 mt-4">Нажмите «🧙 Авторасчёт» — Мимир заполнит таблицу автоматически</p>
          {canEdit && (
            <div className="row gap-6 mt-10 row-center">
              {BLOCK_ORDER.filter((id) => id !== 'contingency').map((id) => (
                <Btn key={id} size="sm" variant="ghost" onClick={() => addRow(id)}>+ {BLOCK_META[id].icon} {BLOCK_META[id].name}</Btn>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card er-positions-card">
      <div className="er-positions-head">
        <div className="col gap-2">
          <strong className="fs-13">Позиции расчёта</strong>
          <span className="fs-11 c-t-3">
            {blocks.reduce((n, b) => n + b.rows.length, 0)} строк ·
            себестоимость {fmtMoney(totals.totalCost)} · цена {fmtMoney(totals.price)}
          </span>
        </div>
        {canEdit && (
          <div className="row gap-6 u-wrap">
            {dirty && <Btn size="sm" variant="ghost" disabled={busy} onClick={resetChanges}>↺ Откатить</Btn>}
            <Btn size="sm" variant="ghost" disabled={busy || !dirty} onClick={() => save(false)}>{busy ? 'Сохраняем…' : '💾 Сохранить'}</Btn>
            <Btn size="sm" variant="primary" disabled={busy || !dirty} onClick={() => save(true)}>{busy ? 'Сохраняем…' : '🧙 Сохранить + override'}</Btn>
          </div>
        )}
      </div>

      {/* Блоки */}
      <div className="er-blocks">
        {blocks.map((b) => {
          const isOpen = openBlocks.has(b.id);
          const meta = BLOCK_META[b.id] || {};
          const isCont = b.id === 'contingency';
          return (
            <div key={b.id} className={'er-block' + (isOpen ? ' er-block--open' : '')} style={{ borderLeft: `3px solid ${b.color || meta.color}` }}>
              <div className="er-block__head" onClick={() => toggleBlock(b.id)}>
                <span className="er-block__dot" style={{ background: b.color || meta.color }} />
                <span className="er-block__name">{meta.icon} {b.name || meta.name}</span>
                <span className="er-block__count">{b.rows.length}</span>
                <span className="er-block__sum">{fmtMoney(b.subtotal)}</span>
                <span className={'er-block__chev' + (isOpen ? ' er-block__chev--open' : '')}>▸</span>
              </div>

              {isOpen && (
                <div className="er-block__body">
                  {isCont ? (
                    <div className="row gap-12 align-center er-cont-row">
                      <label className="fs-12 c-t-2">Резерв (% от остальных блоков):</label>
                      {canEdit ? (
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="50"
                          className="m-input er-cont-pct"
                          value={totals.contPct}
                          onChange={(e) => setContingencyPct(e.target.value)}
                        />
                      ) : (
                        <strong className="fs-13">{totals.contPct}%</strong>
                      )}
                      <span className="c-t-3">→ {fmtMoney(b.subtotal)}</span>
                    </div>
                  ) : (
                    <div className="ov-x-auto">
                      <table className="t-list er-block__table">
                        <thead>
                          <tr>
                            <th className="er-col-26">#</th>
                            <th>Позиция</th>
                            {canEdit && <th className="er-col-110">Блок</th>}
                            <th className="er-col-80 t-right">Кол-во</th>
                            <th className="er-col-100 t-right">Ставка</th>
                            <th className="er-col-90 t-right">Дни/Объём</th>
                            <th className="er-col-120 t-right">Итого ₽</th>
                            {canEdit && <th className="er-col-110"></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {b.rows.length === 0 && (
                            <tr><td colSpan={canEdit ? 8 : 6} className="er-positions-empty">Нет позиций</td></tr>
                          )}
                          {b.rows.map((r, i) => (
                            <PositionRow
                              key={r._key}
                              row={r}
                              idx={i}
                              blockId={b.id}
                              canEdit={canEdit}
                              onChange={(patch) => updateRow(b.id, r._key, patch)}
                              onRemove={() => removeRow(b.id, r._key)}
                              onDuplicate={() => duplicateRow(b.id, r._key)}
                              onMove={(d) => moveRow(b.id, r._key, d)}
                              onChangeBlock={(toId) => moveRowToBlock(b.id, r._key, toId)}
                              isFirst={i === 0}
                              isLast={i === b.rows.length - 1}
                            />
                          ))}
                          <tr className="er-block__subtotal">
                            <td colSpan={canEdit ? 6 : 5} className="t-right fw-700 c-t-2">Итого «{b.name || meta.name}»:</td>
                            <td className="t-right fw-800">{fmtMoney(b.subtotal)}</td>
                            {canEdit && (
                              <td>
                                <Btn size="sm" variant="ghost" onClick={() => addRow(b.id)}>+ строка</Btn>
                              </td>
                            )}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Итоги + маржа */}
      <div className="er-grand-total">
        <div className="row-spread align-center gap-12 u-wrap">
          <div>
            <div className="fs-11 c-t-3">Базовые блоки + резерв</div>
            <strong className="fs-15">{fmtMoney(totals.totalCost)}</strong>
          </div>
          <div className="row align-center gap-6">
            <label className="fs-12 c-t-2" htmlFor="er-margin">Маржа %:</label>
            {canEdit ? (
              <input
                id="er-margin"
                type="number"
                step="0.5"
                min="-100"
                max="500"
                className="m-input er-margin-pct"
                value={marginPct}
                onChange={(e) => onMarginChange(e.target.value)}
              />
            ) : (
              <strong className="fs-13">{Number(marginPct).toFixed(1)}%</strong>
            )}
          </div>
          <div className="t-right">
            <div className="fs-11 c-t-3">Цена клиенту</div>
            <strong className="fs-15 c-gold">{fmtMoney(totals.price)}</strong>
            <div className="fs-11 c-t-3">маржа {fmtMoney(totals.marginRub)}</div>
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="er-positions-notes">
          <label className="fs-12 c-t-2 mb-4">📝 Заметки к расчёту</label>
          <TextareaInput
            value={notes}
            onChange={(v) => { setNotes(v); setDirty(true); }}
            minRows={2}
            maxRows={5}
            placeholder="Комментарий: на чём основаны цифры, что обсуждали с заказчиком, и т.п."
          />
        </div>
      )}
    </div>
  );
}

// ─── Row component ───────────────────────────────────────────────────────────
function PositionRow({ row, idx, blockId, canEdit, onChange, onRemove, onDuplicate, onMove, onChangeBlock, isFirst, isLast }) {
  // Какие поля редактируемые: либо подсказка с сервера, либо «все основные».
  const editable = Array.isArray(row.editable) && row.editable.length ? row.editable : null;
  const isEd = (f) => !editable || editable.includes(f);

  // Какое поле «ставка» (rate / rate_m3 / rate_kg / rate_km).
  const rateField = row.rate_m3 != null ? 'rate_m3'
                   : row.rate_kg != null ? 'rate_kg'
                   : row.rate_km != null ? 'rate_km'
                   : 'rate';
  // Какое поле «объём/дни» (days / volume_m3 / percent / distance_km).
  const volField = row.volume_m3 != null ? 'volume_m3'
                  : row.distance_km != null ? 'distance_km'
                  : row.percent != null ? 'percent'
                  : 'days';
  const volSuffix = volField === 'volume_m3' ? ' м³' : volField === 'distance_km' ? ' км' : volField === 'percent' ? '%' : '';

  const totalDirectlyEditable = editable && editable.length === 1 && editable[0] === 'total';

  const num = (v) => (v === '' || v == null) ? '' : v;
  const setNum = (f) => (e) => {
    const v = e.target.value;
    onChange({ [f]: v === '' ? null : (isNaN(+v) ? v : +v) });
  };

  if (!canEdit) {
    // read-only режим — компактная строка
    return (
      <tr>
        <td className="er-cell-idx">{idx + 1}</td>
        <td>{row.item || '—'} {row.source && <span className="er-src-tag">{row.source}</span>}</td>
        <td className="t-right num-mono">{row.qty != null ? row.qty : '—'}</td>
        <td className="t-right num-mono">{row[rateField] != null ? row[rateField] : '—'}</td>
        <td className="t-right num-mono">{row[volField] != null ? row[volField] + volSuffix : '—'}</td>
        <td className="t-right fw-700">{fmtMoney(row.total)}</td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="er-cell-idx">{idx + 1}</td>
      <td>
        <input
          className="m-input er-input-item"
          value={row.item || ''}
          placeholder="Наименование позиции"
          onChange={(e) => onChange({ item: e.target.value })}
          aria-label="Наименование"
        />
      </td>
      <td>
        <select className="m-select" value={blockId} onChange={(e) => onChangeBlock(e.target.value)} aria-label="Блок">
          {BLOCK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
      <td>
        {isEd('qty') ? (
          <input type="number" step="any" min="0" className="m-input t-right" value={num(row.qty)} onChange={setNum('qty')} aria-label="Количество" />
        ) : (
          <span className="num-mono">{row.qty ?? '—'}</span>
        )}
      </td>
      <td>
        {isEd(rateField) ? (
          <input type="number" step="any" min="0" className="m-input t-right" value={num(row[rateField])} onChange={setNum(rateField)} aria-label="Ставка" />
        ) : (
          <span className="num-mono">{row[rateField] ?? '—'}</span>
        )}
      </td>
      <td>
        {isEd(volField) ? (
          <div className="er-vol-cell">
            <input type="number" step="any" className="m-input t-right" value={num(row[volField])} onChange={setNum(volField)} aria-label="Дни/Объём" />
            {volSuffix && <span className="er-vol-suffix">{volSuffix}</span>}
          </div>
        ) : (
          <span className="num-mono">{row[volField] != null ? row[volField] + volSuffix : '—'}</span>
        )}
      </td>
      <td className="t-right">
        {totalDirectlyEditable ? (
          <input type="number" step="any" min="0" className="m-input t-right fw-700" value={num(row.total)} onChange={setNum('total')} aria-label="Итого" />
        ) : (
          <strong>{fmtMoney(row.total)}</strong>
        )}
      </td>
      <td className="er-row-actions">
        <button type="button" className="btn-ghost er-row-btn" title="Поднять" disabled={isFirst} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="btn-ghost er-row-btn" title="Опустить" disabled={isLast} onClick={() => onMove(+1)}>↓</button>
        <button type="button" className="btn-ghost er-row-btn" title="Дублировать" onClick={onDuplicate}>⎘</button>
        <button type="button" className="btn-ghost er-row-btn er-row-rm" title="Удалить" onClick={onRemove}>×</button>
      </td>
    </tr>
  );
}
