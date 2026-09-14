/**
 * CellEditor — popover редактирования ячейки табеля.
 *
 * Открывается по клику на ячейку (см. TimesheetGrid).
 * Реализован через Popover (createPortal) — не обрезается overflow таблицы.
 *
 * Hotkeys:
 *   Esc   — закрыть
 *   Enter — сохранить (если выбран тип)
 *   Del/Backspace — удалить отметку (если она есть)
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Popover } from '@/inputs/Popover';
import { Btn } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { TYPE_META, fmtDateTime, fmtNum, roleShort, typeRequiresWorkId, loadWorks, DIRECTION_TYPES } from './api';

/** Дорога / корабль / вертолёт и Дорога / Ожидание — «одна дата = одна отметка».
 *  Чужую отметку из набора можно заменить, если доступен свой тип из того же набора. */
const CROSS_EDIT_GROUPS = [
  new Set(['travel', 'ship', 'helicopter']), // транспорт
  new Set(['travel', 'waiting']),            // дорога / ожидание (⏳ = 6 баллов)
];

export function canManageCellType(editableTypes, entryType, mode) {
  if (!entryType) return false;
  if ((editableTypes || []).includes(entryType)) return true;
  // PM-режим — только свои смены; чужие дороги/ожидания не перезаписываем.
  if (mode === 'pm') return false;
  return CROSS_EDIT_GROUPS.some(
    (g) => g.has(entryType) && (editableTypes || []).some((t) => g.has(t))
  );
}

export default function CellEditor({
  anchorRef,
  open,
  onClose,
  onSave,
  onDelete,
  editableTypes = [],
  currentEntry = null,
  fio,
  dateIso,
  workTitle,
  mode = 'pm',
  requireWorkForDayNight = false,
  resolvedWorkId = null,
  readonly = false
}) {
  const [busy, setBusy] = useState(false);
  const firstBtnRef = useRef(null);

  const [pickerType, setPickerType] = useState(null);
  const [worksList, setWorksList] = useState(null);
  const [pickedWorkId, setPickedWorkId] = useState('');

  const [dirType, setDirType] = useState(null);
  const [pendingWorkId, setPendingWorkId] = useState(null);

  useEffect(() => {
    if (!open) {
      setPickerType(null);
      setWorksList(null);
      setPickedWorkId('');
      setDirType(null);
      setPendingWorkId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!pickerType || worksList !== null) return;
    let cancelled = false;
    loadWorks().then((arr) => {
      if (cancelled) return;
      setWorksList(arr || []);
      if (arr && arr.length === 1) setPickedWorkId(String(arr[0].id));
    });
    return () => { cancelled = true; };
  }, [pickerType, worksList]);

  const finishSave = useCallback(async (type, opts = {}) => {
    setBusy(true);
    try {
      await onSave?.(type, opts);
      onClose?.();
    } catch (e) {
      if (e?.cancelled) return;
      throw e;
    } finally {
      setBusy(false);
    }
  }, [onSave, onClose]);

  const handleSave = useCallback(async (type) => {
    if (busy || readonly) return;
    if (typeRequiresWorkId(mode, type) && !resolvedWorkId) {
      setPickerType(type);
      return;
    }
    if (DIRECTION_TYPES.has(type)) {
      setDirType(type);
      setPendingWorkId(resolvedWorkId || null);
      return;
    }
    await finishSave(type);
  }, [busy, readonly, resolvedWorkId, mode, finishSave]);

  const handlePickerConfirm = useCallback(async () => {
    if (busy || !pickedWorkId || !pickerType) return;
    const wid = Number(pickedWorkId);
    if (DIRECTION_TYPES.has(pickerType)) {
      setDirType(pickerType);
      setPendingWorkId(wid);
      setPickerType(null);
      return;
    }
    await finishSave(pickerType, { workId: wid });
    setPickerType(null);
    setPickedWorkId('');
  }, [busy, pickedWorkId, pickerType, finishSave]);

  const handlePickerCancel = useCallback(() => {
    setPickerType(null);
    setPickedWorkId('');
  }, []);

  const handleDirConfirm = useCallback(async (direction) => {
    if (busy || !dirType || !direction) return;
    const opts = { direction };
    if (pendingWorkId) opts.workId = pendingWorkId;
    await finishSave(dirType, opts);
    setDirType(null);
    setPendingWorkId(null);
  }, [busy, dirType, pendingWorkId, finishSave]);

  const handleDelete = useCallback(async () => {
    if (busy || readonly || !currentEntry) return;
    setBusy(true);
    try {
      await onDelete?.();
      onClose?.();
    } catch (e) {
      if (e?.cancelled) return;
      throw e;
    } finally {
      setBusy(false);
    }
  }, [busy, readonly, currentEntry, onDelete, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentEntry || dirType || pickerType) return;
        if (editableTypes[0]) handleSave(editableTypes[0]);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (currentEntry && !readonly) {
          e.preventDefault();
          handleDelete();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editableTypes, currentEntry, readonly, handleSave, handleDelete, dirType, pickerType]);

  useEffect(() => {
    if (open && firstBtnRef.current) {
      setTimeout(() => firstBtnRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const needsWork = editableTypes.includes('day') || editableTypes.includes('night');
  const warnNoWork = needsWork && requireWorkForDayNight && !workTitle;
  const dirLabel = currentEntry?.direction === 'to_site' ? ' · → Туда'
    : (currentEntry?.direction === 'from_site' ? ' · ← Обратно' : '');

  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} matchWidth={false} maxHeight={420}>
      <div className="ts-pop" role="dialog" aria-label="Редактирование отметки табеля">
        <div className="ts-pop-title">{fio || '—'}</div>
        <div className="ts-pop-subtitle">
          {dateIso}{workTitle ? ` · ${workTitle}` : ''}{dirLabel}
        </div>

        {currentEntry && (
          <div className="ts-pop-meta">
            {currentEntry.entered_by_fio && (
              <div>
                Внёс: <b style={{ color: 'var(--t-1)' }}>{currentEntry.entered_by_fio}</b>
                {currentEntry.entered_by_role && ` (${roleShort(currentEntry.entered_by_role)})`}
              </div>
            )}
            {currentEntry.entered_by_phone && (
              <div>📞 {currentEntry.entered_by_phone}</div>
            )}
            {currentEntry.entered_at && <div>{fmtDateTime(currentEntry.entered_at)}</div>}
            {currentEntry.points != null && <div>Баллов: <b style={{ color: 'var(--t-1)' }}>{currentEntry.points}</b></div>}
            {currentEntry.amount != null && <div>Сумма: <b style={{ color: 'var(--gold)' }}>{fmtNum(currentEntry.amount)} ₽</b></div>}
            {currentEntry.direction === 'to_site' && <div>Направление: → Туда</div>}
            {currentEntry.direction === 'from_site' && <div>Направление: ← Обратно</div>}
          </div>
        )}

        {pickerType && !readonly && (
          <div className="ts-pop-picker" role="group" aria-label="Выбор работы" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
            <div style={{ fontSize: 12, color: 'var(--t-2)' }}>
              Для отметки «{TYPE_META[pickerType]?.label || pickerType}» выберите работу:
            </div>
            {worksList === null ? (
              <div style={{ fontSize: 12, color: 'var(--t-2)' }}>⏳ Загружаем работы…</div>
            ) : worksList.length === 0 ? (
              <div className="ts-pop-warn" role="alert">Нет доступных работ</div>
            ) : (
              <SelectInput
                value={pickedWorkId}
                onChange={setPickedWorkId}
                placeholder="— выбрать работу —"
                options={worksList.map((w) => ({
                  value: String(w.id),
                  label: (w.work_title || w.title || `Объект #${w.id}`) + (w.city ? ` · ${w.city}` : '')
                }))}
                aria-label="Работа"
              />
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" onClick={handlePickerCancel} disabled={busy}>Отмена</Btn>
              <Btn variant="primary" onClick={handlePickerConfirm} disabled={busy || !pickedWorkId}>
                Подтвердить
              </Btn>
            </div>
          </div>
        )}

        {dirType && !readonly && (
          <div className="ts-pop-picker" role="group" aria-label="Направление" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
            <div style={{ fontSize: 12, color: 'var(--t-2)' }}>
              {TYPE_META[dirType]?.label || dirType}: направление поездки
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn variant="primary" onClick={() => handleDirConfirm('to_site')} disabled={busy}>→ Туда</Btn>
              <Btn variant="primary" onClick={() => handleDirConfirm('from_site')} disabled={busy}>← Обратно</Btn>
              <Btn variant="ghost" onClick={() => setDirType(null)} disabled={busy}>Отмена</Btn>
            </div>
          </div>
        )}

        {!readonly && !pickerType && !dirType && editableTypes.length > 0 && (
          <>
            <div className="ts-pop-types" role="group" aria-label="Тип отметки">
              {editableTypes.map((type, i) => {
                const meta = TYPE_META[type];
                if (!meta) return null;
                const isActive = currentEntry?.type === type;
                return (
                  <button
                    key={type}
                    ref={i === 0 ? firstBtnRef : undefined}
                    type="button"
                    className={'ts-pop-type-btn' + (isActive ? ' active' : '')}
                    onClick={() => handleSave(type)}
                    disabled={busy}
                    aria-pressed={isActive}
                  >
                    <span
                      className="ts-cell icon-only"
                      style={{
                        '--bg': `var(${meta.bgVar})`,
                        '--fg': `var(${meta.fgVar})`,
                        minWidth: 28
                      }}
                      aria-hidden="true"
                    >
                      {meta.icon}
                    </span>
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>

            {warnNoWork && (
              <div className="ts-pop-warn" role="alert">
                ⚠ Для «Дневная/Ночная смена» сотрудник должен быть привязан к работе.
              </div>
            )}
          </>
        )}

        {readonly && (
          <div className="ts-pop-warn" role="status">
            🔒 Месяц закрыт — изменение запрещено.
          </div>
        )}

        <div className="ts-pop-foot">
          {currentEntry && !readonly && canManageCellType(editableTypes, currentEntry.type, mode) ? (
            <Btn variant="ghost" onClick={handleDelete} disabled={busy}>
              🗑 Удалить
            </Btn>
          ) : <span />}
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Закрыть</Btn>
        </div>
      </div>
    </Popover>
  );
}
