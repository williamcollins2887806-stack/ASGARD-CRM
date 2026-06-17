/**
 * FoldersTree — иерархия системных и кастомных папок (vanilla my_mail.js:348..400).
 *
 * Реализует:
 *  - системные папки сверху (inbox, sent, drafts, spam, trash)
 *  - кастомные под разделителем
 *  - счётчики непрочитанных
 *  - drag&drop писем в папку (vanilla строки 373..388)
 *  - context menu (rename/delete) для кастомных
 *  - кнопка «+ Папка» через PromptModal
 */
import { useModal, ConfirmModal, PromptModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { folderIcon, SYSTEM_FOLDER_TYPES, createFolder, renameFolder, deleteFolder, moveMessage } from './api';

export function FoldersTree({ folders, activeId, onSelect, onChanged }) {
  const modal = useModal();

  const system = folders.filter((f) => SYSTEM_FOLDER_TYPES.includes(f.folder_type));
  const custom = folders.filter((f) => !SYSTEM_FOLDER_TYPES.includes(f.folder_type));

  const handleDrop = async (folderId, ev) => {
    ev.preventDefault();
    ev.currentTarget.classList.remove('mm-folder--drop');
    const raw = ev.dataTransfer.getData('text/plain');
    const id = parseInt(raw, 10);
    if (!id || !folderId) return;
    try {
      await moveMessage(id, folderId);
      toast('Письмо перемещено', '', 'ok');
      onChanged?.();
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  const openCreate = () => {
    modal.open(<PromptModal
      title="Создать папку"
      label="Название новой папки"
      placeholder="Например: Клиенты"
      okText="Создать"
      onSubmit={async (name) => {
        try {
          await createFolder(name.trim());
          toast('Папка создана', '', 'ok');
          onChanged?.();
        } catch (e) { toast('Ошибка', String(e?.message || e), 'err'); }
      }}
    />);
  };

  const openRename = (folder) => {
    modal.open(<PromptModal
      title="Переименовать папку"
      label="Новое название"
      initial={folder.name}
      okText="Сохранить"
      onSubmit={async (name) => {
        try {
          await renameFolder(folder.id, name.trim());
          toast('Папка переименована', '', 'ok');
          onChanged?.();
        } catch (e) { toast('Ошибка', String(e?.message || e), 'err'); }
      }}
    />);
  };

  const openDelete = (folder) => {
    modal.open(<ConfirmModal
      title="Удалить папку?"
      message={`Папка «${folder.name}» будет удалена, письма перемещены во Входящие.`}
      okText="🗑 Удалить"
      tone="danger"
      onConfirm={async () => {
        try {
          await deleteFolder(folder.id);
          toast('Папка удалена', '', 'ok');
          onChanged?.();
        } catch (e) { toast('Ошибка', String(e?.message || e), 'err'); }
      }}
    />);
  };

  const renderFolder = (f) => {
    const isActive = activeId === f.id;
    const unread = Number(f.unread_count) || 0;
    return (
      <div
        key={f.id}
        className={'mm-folder' + (isActive ? ' mm-folder--active' : '')}
        onClick={() => onSelect?.(f)}
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('mm-folder--drop'); }}
        onDragLeave={(e) => { e.currentTarget.classList.remove('mm-folder--drop'); }}
        onDrop={(e) => handleDrop(f.id, e)}
        onContextMenu={(e) => {
          if (f.folder_type !== 'custom') return;
          e.preventDefault();
          // простое меню — два пункта через confirm/prompt модалки
          modal.open(<ConfirmModal
            title={f.name}
            message="Что сделать с папкой?"
            okText="✎ Переименовать"
            cancelText="🗑 Удалить"
            onConfirm={() => openRename(f)}
            onCancel={() => openDelete(f)}
          />);
        }}
        title={f.folder_type === 'custom' ? 'ПКМ — переименовать/удалить' : ''}
      >
        <span className="mm-folder__icon" aria-hidden="true">{folderIcon(f.folder_type)}</span>
        <span className="mm-folder__name">{f.name}</span>
        {unread > 0 && <span className="mm-folder__badge">{unread}</span>}
      </div>
    );
  };

  return (
    <div className="mm-tree">
      <div className="mm-tree__section">
        {system.map(renderFolder)}
      </div>
      {custom.length > 0 && (
        <>
          <div className="mm-tree__divider" />
          <div className="mm-tree__section">
            {custom.map(renderFolder)}
          </div>
        </>
      )}
      <div className="mm-tree__divider" />
      <button type="button" className="mm-tree__add" onClick={openCreate}>
        <span aria-hidden="true">＋</span>
        <span>Новая папка</span>
      </button>
    </div>
  );
}
