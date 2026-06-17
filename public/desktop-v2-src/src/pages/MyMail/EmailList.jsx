/**
 * EmailList — список писем в выбранной папке (vanilla my_mail.js:438..557 renderEmailList).
 *
 * Реализует:
 *  - аватары + дата-группировка (Сегодня/Вчера/Неделя/Ранее)
 *  - draggable rows (источник для drag&drop в FoldersTree)
 *  - multi-select для bulk-операций (mark_read / archive / delete / move / star)
 *  - сортировка по дате/отправителю/теме (sort/order)
 *  - фильтры: непрочитанные / с вложениями / последние 7 дней
 *  - поиск по теме/отправителю/сниппету
 */
import { useMemo, useState, useCallback } from 'react';
import { Btn } from '@/modals/parts';
import { SearchInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { useModal, ConfirmModal } from '@/modals';
import { fmtDateTime, dateGroup, hashColor, avatarLetter, bulkAction, patchMessage } from './api';

const SORT_OPTS = [
  { value: 'date_desc', label: '↓ Дата (новые)' },
  { value: 'date_asc', label: '↑ Дата (старые)' },
  { value: 'from_asc', label: 'A→Я Отправитель' },
  { value: 'subject_asc', label: 'A→Я Тема' }
];

export function EmailList({
  emails, total, loading, folder,
  search, onSearchChange,
  filters, onFiltersChange,
  sortKey, onSortChange,
  selectedId, onSelect,
  selectedIds, onSelectedIdsChange,
  onChanged
}) {
  const modal = useModal();
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const out = [];
    let last = null;
    for (const e of emails) {
      const g = dateGroup(e.email_date);
      if (g !== last) { out.push({ type: 'group', label: g }); last = g; }
      out.push({ type: 'email', email: e });
    }
    return out;
  }, [emails]);

  const allSelected = emails.length > 0 && selectedIds.length === emails.length;

  const toggleAll = useCallback(() => {
    onSelectedIdsChange(allSelected ? [] : emails.map((e) => e.id));
  }, [allSelected, emails, onSelectedIdsChange]);

  const toggleOne = useCallback((id, ev) => {
    ev.stopPropagation();
    onSelectedIdsChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    );
  }, [selectedIds, onSelectedIdsChange]);

  const runBulk = useCallback(async (action) => {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      await bulkAction(selectedIds, action);
      toast('Готово', selectedIds.length + ' писем', 'ok');
      onSelectedIdsChange([]);
      onChanged?.();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  }, [selectedIds, onSelectedIdsChange, onChanged]);

  const confirmBulkDelete = () => {
    modal.open(<ConfirmModal
      title={'Удалить ' + selectedIds.length + ' писем?'}
      message="Письма попадут в корзину"
      okText="🗑 Удалить"
      tone="danger"
      onConfirm={() => runBulk('delete')}
    />);
  };

  const toggleStar = async (id, current, ev) => {
    ev.stopPropagation();
    try {
      await patchMessage(id, { is_starred: !current });
      onChanged?.();
    } catch (e) { toast('Ошибка', String(e?.message || e), 'err'); }
  };

  return (
    <div className="mm-list">
      {/* Тулбар поиска + фильтров */}
      <div className="mm-list__bar">
        <SearchInput value={search} onChange={onSearchChange} placeholder="Поиск по теме, отправителю, тексту…" />
        <div className="mm-list__filters">
          <label className="mm-chip">
            <input type="checkbox" checked={!!filters.unread} onChange={(e) => onFiltersChange({ ...filters, unread: e.target.checked })} />
            <span>Непрочитанные</span>
          </label>
          <label className="mm-chip">
            <input type="checkbox" checked={!!filters.withAttach} onChange={(e) => onFiltersChange({ ...filters, withAttach: e.target.checked })} />
            <span>📎 С вложениями</span>
          </label>
          <label className="mm-chip">
            <input type="checkbox" checked={!!filters.last7} onChange={(e) => onFiltersChange({ ...filters, last7: e.target.checked })} />
            <span>За 7 дней</span>
          </label>
          <select
            className="mm-list__sort"
            value={sortKey}
            onChange={(e) => onSortChange(e.target.value)}
            aria-label="Сортировка"
          >
            {SORT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Шапка со счётчиком и bulk-actions */}
      <div className="mm-list__head">
        <label className="mm-list__sel">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Выбрать все" />
        </label>
        <div className="mm-list__title">
          <span className="mm-list__folder">{folder?.name || 'Папка'}</span>
          <span className="mm-list__total">{loading ? '…' : `${emails.length} из ${total}`}</span>
        </div>
        {selectedIds.length > 0 && (
          <div className="mm-list__bulk" role="toolbar" aria-label="Массовые действия">
            <Btn size="sm" disabled={busy} onClick={() => runBulk('mark_read')}>✓ Прочитано</Btn>
            <Btn size="sm" disabled={busy} onClick={() => runBulk('mark_unread')}>● Непрочитано</Btn>
            <Btn size="sm" disabled={busy} onClick={() => runBulk('star')}>⭐</Btn>
            <Btn size="sm" disabled={busy} onClick={() => runBulk('archive')}>📦 Архив</Btn>
            <Btn size="sm" variant="danger" disabled={busy} onClick={confirmBulkDelete}>🗑</Btn>
          </div>
        )}
      </div>

      {/* Список */}
      <div className="mm-list__items">
        {loading ? (
          <div className="mm-list__loader">⏳ Загружаем…</div>
        ) : emails.length === 0 ? (
          <div className="mm-list__empty">
            <div className="mm-list__empty-ico" aria-hidden="true">📭</div>
            <div className="mm-list__empty-ttl">Нет писем</div>
            <div className="mm-list__empty-hint">
              {search || filters.unread || filters.withAttach || filters.last7
                ? 'Попробуй сбросить фильтры'
                : `В папке «${folder?.name || ''}» пусто`}
            </div>
          </div>
        ) : groups.map((row, i) => {
          if (row.type === 'group') {
            return <div key={'g-' + i} className="mm-list__group">{row.label}</div>;
          }
          const e = row.email;
          const checked = selectedIds.includes(e.id);
          const fromDisplay = e.direction === 'outbound'
            ? 'Кому: ' + (Array.isArray(e.to_emails) ? (e.to_emails[0]?.address || e.to_emails[0] || '…') : '…')
            : (e.from_name || e.from_email || '?');
          const senderForAvatar = e.direction === 'outbound'
            ? (Array.isArray(e.to_emails) ? (e.to_emails[0]?.address || e.to_emails[0] || 'O') : 'O')
            : (e.from_name || e.from_email || '?');
          return (
            <div
              key={e.id}
              className={
                'mm-item' +
                (e.id === selectedId ? ' mm-item--active' : '') +
                (e.is_read ? '' : ' mm-item--unread')
              }
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData('text/plain', String(e.id));
                ev.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => onSelect?.(e.id)}
            >
              <label className="mm-item__sel" onClick={(ev) => ev.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(ev) => toggleOne(e.id, ev)}
                  aria-label="Выбрать письмо"
                />
              </label>
              <span className="mm-avatar" style={{ background: hashColor(senderForAvatar) }}>
                {avatarLetter(e.from_name, e.from_email)}
              </span>
              <button
                type="button"
                className={'mm-item__star' + (e.is_starred ? ' is-on' : '')}
                onClick={(ev) => toggleStar(e.id, e.is_starred, ev)}
                aria-label={e.is_starred ? 'Снять звезду' : 'Поставить звезду'}
                title={e.is_starred ? 'Снять звезду' : 'Звезда'}
              >
                {e.is_starred ? '★' : '☆'}
              </button>
              <div className="mm-item__body">
                <div className="mm-item__from">{fromDisplay}</div>
                <div className="mm-item__subj">
                  {e.subject || '(без темы)'}
                  {e.snippet && <span className="mm-item__prev"> — {e.snippet}</span>}
                </div>
              </div>
              {e.has_attachments && <span className="mm-item__attach" title="Вложения" aria-label="Есть вложения">📎</span>}
              <span className="mm-item__date">{fmtDateTime(e.email_date)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
