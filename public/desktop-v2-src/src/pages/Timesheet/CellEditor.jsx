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
 *
 * Props:
 *   anchorRef — реф ячейки-якоря
 *   open      — открыт?
 *   onClose   — закрытие popover
 *   onSave    — async (type, opts) => {}
 *   onDelete  — async () => {} (если ячейка не пустая)
 *   editableTypes — массив доступных типов ('day'|'night'|'warehouse'|'medical'|'travel'|'waiting')
 *   currentEntry  — { type, points, amount, entered_by_fio, entered_by_role, entered_at, is_mine } | null
 *   fio           — имя сотрудника
 *   dateIso       — YYYY-MM-DD
 *   workTitle     — название работы (для day/night, может быть пусто)
 *   requireWorkForDayNight — если true и нет work_id и тип=day/night → блокируем
 *   readonly      — если true (lock) — показываем только инфо, без кнопок
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Popover } from '@/inputs/Popover';
import { Btn } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { TYPE_META, fmtDateTime, fmtNum, roleShort, REQUIRE_WORK_ID, loadWorks } from './api';

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
  requireWorkForDayNight = false,
  // resolvedWorkId — work_id который удалось вычислить (primary/last_work_id).
  // Если null — для типов из REQUIRE_WORK_ID показываем picker.
  resolvedWorkId = null,
  readonly = false
}) {
  const [busy, setBusy] = useState(false);
  const firstBtnRef = useRef(null);

  // Work-picker state: если юзер кликнул тип требующий work_id и нет workId,
  // показываем select со списком работ и кнопку «Подтвердить».
  const [pickerType, setPickerType] = useState(null);  // type который выбрали
  const [worksList, setWorksList] = useState(null);    // null=загружаем, []=пусто
  const [pickedWorkId, setPickedWorkId] = useState('');

  // Ленивая загрузка списка работ при открытии picker'а
  useEffect(() => {
    if (!pickerType || worksList !== null) return;
    let cancelled = false;
    loadWorks().then((arr) => {
      if (cancelled) return;
      setWorksList(arr || []);
      // Если ровно одна работа — авто-выбираем
      if (arr && arr.length === 1) setPickedWorkId(String(arr[0].id));
    });
    return () => { cancelled = true; };
  }, [pickerType, worksList]);

  // Esc/Enter — но Esc уже обрабатывает Popover; Enter — наш
  const handleSave = useCallback(async (type) => {
    if (busy || readonly) return;
    // Если тип требует work_id и нет resolvedWorkId — открыть picker вместо save
    if (REQUIRE_WORK_ID.has(type) && !resolvedWorkId) {
      setPickerType(type);
      return;
    }
    setBusy(true);
    try {
      await onSave?.(type);
      onClose?.();
    } finally {
      setBusy(false);
    }
  }, [busy, readonly, resolvedWorkId, onSave, onClose]);

  // Подтверждение из picker'а — сохраняем с выбранным work_id
  const handlePickerConfirm = useCallback(async () => {
    if (busy || !pickedWorkId || !pickerType) return;
    setBusy(true);
    try {
      await onSave?.(pickerType, { workId: Number(pickedWorkId) });
      onClose?.();
    } finally {
      setBusy(false);
      setPickerType(null);
      setPickedWorkId('');
    }
  }, [busy, pickedWorkId, pickerType, onSave, onClose]);

  const handlePickerCancel = useCallback(() => {
    setPickerType(null);
    setPickedWorkId('');
  }, []);

  const handleDelete = useCallback(async () => {
    if (busy || readonly || !currentEntry) return;
    setBusy(true);
    try {
      await onDelete?.();
      onClose?.();
    } finally {
      setBusy(false);
    }
  }, [busy, readonly, currentEntry, onDelete, onClose]);

  // Глобальные хоткеи: Enter (сохранить первый тип) / Del (удалить)
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentEntry) return; // Enter без выбора при существующей — ничего не делаем
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
  }, [open, editableTypes, currentEntry, readonly, handleSave, handleDelete]);

  // Авто-фокус на первой кнопке для tab-navigation
  useEffect(() => {
    if (open && firstBtnRef.current) {
      setTimeout(() => firstBtnRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const needsWork = editableTypes.includes('day') || editableTypes.includes('night');
  const warnNoWork = needsWork && requireWorkForDayNight && !workTitle;

  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} matchWidth={false} maxHeight={420}>
      <div className="ts-pop" role="dialog" aria-label="Редактирование отметки табеля">
        <div className="ts-pop-title">{fio || '—'}</div>
        <div className="ts-pop-subtitle">
          {dateIso}{workTitle ? ` · ${workTitle}` : ''}
        </div>

        {/* Если ячейка не пустая — показать кто и когда внёс (FIX 8 — телефон) */}
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
          </div>
        )}

        {/* Work-picker — если кликнули тип требующий work_id и нет workId */}
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

        {!readonly && !pickerType && editableTypes.length > 0 && (
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
          {currentEntry && !readonly ? (
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
