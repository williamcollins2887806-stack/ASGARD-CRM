/**
 * CorrViewModal — карточка просмотра документа корреспонденции.
 *
 * Источник vanilla: openViewModal() в correspondence.js.
 *
 * Действия:
 *   - ✎ Редактировать → закрыть текущую, открыть CorrFormModal с item.
 *   - 🗑 Удалить → ConfirmModal → DELETE /api/data/correspondence/:id.
 *   - 📥 Скачать вложение.
 *   - Открыть привязанный тендер/работу/заказчика — через href.
 */
import { useState, useEffect } from 'react';
import { useModal, ConfirmModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';

import {
  getDirInfo, getDocTypeInfo, fmtDate, fmtDateTime,
  loadUsers, deleteOne
} from './api';
import { openProtected } from '@/api/download';
import { CorrFormModal } from './CorrFormModal';

export function CorrViewModal({ item, onChanged }) {
  const { close, open } = useModal();
  const [users, setUsers] = useState({});

  useEffect(() => {
    loadUsers().then((arr) => {
      const map = {};
      arr.forEach((u) => { map[u.id] = u; });
      setUsers(map);
    });
  }, []);

  // Раньше: return null — модалка молча схлопывалась если родитель передал falsy item.
  // Теперь рендерим явный fallback с кнопкой закрытия (пользователь видит почему).
  if (!item) {
    return (
      <MCard>
        <MHead icon="📄" title="Документ не найден" onClose={close} />
        <MBody>
          <div className="p-24 t-center c-t3">Не удалось открыть документ — данные не получены.</div>
        </MBody>
        <MFoot><Btn onClick={close}>Закрыть</Btn></MFoot>
      </MCard>
    );
  }
  const dir = getDirInfo(item.direction);
  const dtype = getDocTypeInfo(item.doc_type);
  const creator = users[item.created_by];
  const isOutgoing = item.direction === 'outgoing';

  const onEdit = () => {
    close();
    setTimeout(() => open(<CorrFormModal item={item} onSaved={onChanged} />), 50);
  };

  const onDelete = () => {
    open(
      <ConfirmModal
        title="Удалить документ?"
        message={`Документ «${item.subject || 'без темы'}» №${item.number || item.id} будет удалён безвозвратно.`}
        tone="danger"
        okText="🗑 Удалить"
        onConfirm={async () => {
          try {
            await deleteOne(item.id);
            toast.success('Документ удалён');
            window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
            onChanged?.();
            close();
          } catch (e) {
            toast.error('Не удалось: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon={dir.icon}
        title={`Документ #${item.id}`}
        subtitle={`${dir.label} · ${dtype.label}`}
        onClose={close}
      />
      <MBody>
        <div className="corr-view-head">
          <div className="icon">{dir.icon}</div>
          <div className="flex-1">
            <h3>{item.subject || 'Без темы'}</h3>
            <div className="subtitle">{dir.label} · {dtype.label}</div>
          </div>
        </div>

        <div className="corr-kv">
          <span className="lbl">Номер</span>
          <span className="val">
            <span className="corr-number">{item.number || '—'}</span>
          </span>

          <span className="lbl">Дата</span>
          <span className="val">{fmtDate(item.date)}</span>

          <span className="lbl">{isOutgoing ? 'Получатель' : 'Отправитель'}</span>
          <span className="val fw-600" >{item.counterparty || '—'}</span>

          <span className="lbl">Контактное лицо</span>
          <span className="val">{item.contact_person || '—'}</span>

          {item.customer_id && (
            <>
              <span className="lbl">Заказчик</span>
              <span className="val">
                <a href={`#/customers?id=${item.customer_id}`} className="c-gold">
                  Карточка заказчика #{item.customer_id} →
                </a>
              </span>
            </>
          )}

          {item.tender_id && (
            <>
              <span className="lbl">Тендер</span>
              <span className="val">
                <a href={`#/tenders?open=${item.tender_id}`} className="c-gold">
                  Тендер #{item.tender_id} →
                </a>
              </span>
            </>
          )}

          {item.work_id && (
            <>
              <span className="lbl">Работа</span>
              <span className="val">
                <a href={`#/pm-works?id=${item.work_id}`} className="c-gold">
                  Работа #{item.work_id} →
                </a>
              </span>
            </>
          )}

          {item.note && (
            <>
              <span className="lbl">Примечание</span>
              <span className="val u-prewrap" >{item.note}</span>
            </>
          )}

          {item.file_path && (
            <>
              <span className="lbl">📎 Вложение</span>
              <span className="val">
                {/* G-5: blob-download через Authorization header — направит /api/files/download/* без токена в URL. */}
                <button
                  type="button"
                  onClick={() =>
                    openProtected(item.file_path, (item.file_path.split('/').pop() || 'attachment'))
                      .catch((err) => toast.error('Файл: ' + (err?.message || err)))
                  }
                  style={{ background: 'none', border: 0, padding: 0, color: 'var(--gold)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Скачать
                </button>
              </span>
            </>
          )}
        </div>

        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--brd-2)', color: 'var(--t-3)', fontSize: 11 }}>
          Создал: <b className="c-t2">{creator?.full_name || creator?.login || '—'}</b>
          {' · '}{fmtDateTime(item.created_at)}
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={onDelete}>🗑 Удалить</Btn>
        <div className="flex-1" />
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        <Btn variant="primary" onClick={onEdit}>✎ Редактировать</Btn>
      </MFoot>
    </MCard>
  );
}
