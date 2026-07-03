/**
 * CorrViewModal — карточка просмотра документа корреспонденции.
 *
 * Источник vanilla: openViewModal() в correspondence.js (S-11A, ~1160-1295).
 *
 * V252 поля:
 *   - signing_status pill (draft/finalized/sent) — токены тем
 *   - letter_kind chip
 *   - version_no / parent_correspondence_id — баннер «Редакция v2 от № …»
 *   - doc_title / doc_sub / header_subline / procedure_number / lot_number / lot_title
 *   - ai_model — в footer
 *
 * Действия (RBAC через api.js):
 *   ✎ Редактировать      — canEditItem
 *   📄 PDF                — canDownloadLetter (finalized | sent outgoing)
 *   📝 Word               — canDownloadLetter
 *   🔒 Финализировать     — canFinalizeItem (draft outgoing)
 *   🔁 Новая редакция     — canNewRevision (sent outgoing)
 *   🗑 Удалить            — canDelete (ADMIN + DIRECTOR_GEN)
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { openProtected } from '@/api/download';

import {
  getDirInfo, getDocTypeInfo, getSigningStatus, getLetterKindLabel,
  fmtDate, fmtDateTime,
  loadUsers, loadOne,
  finalizeCorrespondence, createNewRevision, deleteCorrespondence,
  letterRenderUrl, letterFileBase,
  canEditItem, canFinalizeItem, canNewRevision, canDownloadLetter, canDelete
} from './api';
import { CorrFormModal } from './CorrFormModal';

export function CorrViewModal({ item, onChanged }) {
  const { close, open } = useModal();
  const { user } = useAuth();
  const [users, setUsers] = useState({});

  useEffect(() => {
    loadUsers().then((arr) => {
      const map = {};
      arr.forEach((u) => { map[u.id] = u; });
      setUsers(map);
    });
  }, []);

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
  const sstatusKey = item.signing_status || (isOutgoing && !item.number ? 'draft' : 'finalized');
  const sstatus = getSigningStatus(sstatusKey);
  const kindLabel = getLetterKindLabel(item.letter_kind);
  const verNo = Number(item.version_no || 1);
  const isRevision = item.parent_correspondence_id != null || verNo > 1;

  const allowEdit       = canEditItem(user, item);
  const allowPdf        = canDownloadLetter(user, item);
  const allowDocx       = canDownloadLetter(user, item);
  const allowFinalize   = canFinalizeItem(user, item);
  const allowNewRev     = canNewRevision(user, item);
  const allowDelete     = canDelete(user);

  const onEdit = () => {
    if (!allowEdit) {
      toast.warn(sstatusKey !== 'draft'
        ? 'Финализированное письмо нельзя редактировать — создайте новую редакцию'
        : 'Нет прав на редактирование этого письма');
      return;
    }
    close();
    setTimeout(() => open(<CorrFormModal item={item} onSaved={onChanged} />), 50);
  };

  const onDelete = () => {
    open(
      <ConfirmModal
        title="Удалить документ?"
        message={`Документ «${item.subject || 'без темы'}» №${item.number || item.id} будет удалён безвозвратно (soft delete).`}
        tone="danger"
        okText="🗑 Удалить"
        onConfirm={async () => {
          try {
            await deleteCorrespondence(item.id);
            toast.success('Документ удалён');
            window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
            onChanged?.();
            close();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onPdf = () => {
    const url = letterRenderUrl(item.id, 'pdf', { with_signature: true, with_stamp: true });
    openProtected(url, letterFileBase(item) + '.pdf')
      .catch((err) => toast.error('PDF: ' + (err?.message || err)));
  };

  const onDocx = () => {
    const url = letterRenderUrl(item.id, 'docx');
    openProtected(url, letterFileBase(item) + '.docx')
      .catch((err) => toast.error('Word: ' + (err?.message || err)));
  };

  const onFinalize = () => {
    open(
      <ConfirmModal
        title="Финализировать письмо?"
        message="После финализации будет присвоен Исх.№ и редактирование закроется. Создать новую редакцию можно будет позже."
        tone="warning"
        okText="🔒 Финализировать"
        onConfirm={async () => {
          try {
            const resp = await finalizeCorrespondence(item.id);
            toast.success('Письмо финализировано · № ' + (resp?.number || ''));
            window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
            onChanged?.();
            close();
          } catch (e) {
            toast.error('Не удалось финализировать: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onNewRevision = async () => {
    const note = (window.prompt('Краткое примечание к новой редакции (опц.):', '') || '').trim();
    try {
      const resp = await createNewRevision(item.id, note || undefined);
      toast.success('Создана редакция v' + (resp?.version_no || '?'));
      window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
      onChanged?.();
      const newId = resp?.new_id;
      if (newId) {
        const fresh = await loadOne(newId);
        close();
        if (fresh) {
          // Если есть права редактировать — сразу в форму, иначе в карточку.
          setTimeout(() => {
            if (canEditItem(user, fresh)) open(<CorrFormModal item={fresh} onSaved={onChanged} />);
            else open(<CorrViewModal item={fresh} onChanged={onChanged} />);
          }, 50);
        }
      }
    } catch (e) {
      toast.error('Не удалось создать редакцию: ' + (e?.message || e));
    }
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
            <div className="subtitle">
              {dir.label} · {dtype.label}
              {kindLabel && <span className="corr-kind-chip" style={{ marginLeft: 8 }}>{kindLabel}</span>}
            </div>
          </div>
          <span className={'corr-sstatus tone-' + sstatus.toneClass} title={sstatus.label}>
            {sstatus.icon} {sstatus.label}
          </span>
        </div>

        {isRevision && (
          <div className="corr-revision-banner">
            <span>🔁</span>
            <span>
              <b>Редакция v{verNo}</b>
              {item.parent_correspondence_id ? ` (родитель #${item.parent_correspondence_id})` : ''}
            </span>
          </div>
        )}

        <div className="corr-kv">
          <span className="lbl">Номер</span>
          <span className="val">
            {item.number
              ? <span className="corr-number">{item.number}</span>
              : (sstatusKey === 'draft'
                  ? <span className="corr-number corr-number--placeholder">🔒 присвоится при finalize</span>
                  : <span className="c-t3">—</span>)
            }
          </span>

          <span className="lbl">Дата</span>
          <span className="val">{fmtDate(item.date)}</span>

          {(item.doc_title || item.doc_sub) && (
            <>
              <span className="lbl">Заголовок</span>
              <span className="val">
                <div className="fw-600">{item.doc_title || '—'}</div>
                {item.doc_sub && <div className="c-t3 fs-12" style={{ fontStyle: 'italic' }}>{item.doc_sub}</div>}
              </span>
            </>
          )}

          {item.header_subline && (
            <>
              <span className="lbl">Подпрефикс</span>
              <span className="val">{item.header_subline}</span>
            </>
          )}

          {item.procedure_number && (
            <>
              <span className="lbl">№ процедуры</span>
              <span className="val" style={{ fontFamily: 'ui-monospace, monospace' }}>{item.procedure_number}</span>
            </>
          )}
          {item.lot_number && (
            <>
              <span className="lbl">№ лота</span>
              <span className="val" style={{ fontFamily: 'ui-monospace, monospace' }}>{item.lot_number}</span>
            </>
          )}
          {item.lot_title && (
            <>
              <span className="lbl">Название лота</span>
              <span className="val">{item.lot_title}</span>
            </>
          )}

          <span className="lbl">{isOutgoing ? 'Получатель' : 'Отправитель'}</span>
          <span className="val fw-600">{item.counterparty || '—'}</span>

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
              <span className="val u-prewrap">{item.note}</span>
            </>
          )}

          {item.file_path && (
            <>
              <span className="lbl">📎 Вложение</span>
              <span className="val">
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

        {/* PDF / Word — кнопки для готовых outgoing-писем */}
        {(allowPdf || allowDocx) && (
          <div className="corr-dl-btns">
            {allowPdf && (
              <Btn variant="ghost" onClick={onPdf} title="PDF с подписью и печатью">📄 PDF</Btn>
            )}
            {allowDocx && (
              <Btn variant="ghost" onClick={onDocx} title="Редактируемый Word">📝 Word</Btn>
            )}
          </div>
        )}

        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--brd-2)', color: 'var(--t-3)', fontSize: 11 }}>
          Создал: <b className="c-t2">{creator?.full_name || creator?.login || '—'}</b>
          {' · '}{fmtDateTime(item.created_at)}
          {item.ai_model && (<> {' · '}AI: <b className="c-t2">{item.ai_model}</b></>)}
        </div>
      </MBody>
      <MFoot>
        {allowDelete && (
          <Btn variant="ghost" onClick={onDelete} title="Удалить (soft delete)">🗑 Удалить</Btn>
        )}
        <div className="flex-1" />
        {allowNewRev && (
          <Btn variant="ghost" onClick={onNewRevision} title="Создать новую редакцию">🔁 Новая редакция</Btn>
        )}
        {allowFinalize && (
          <Btn variant="ghost" onClick={onFinalize} title="Аллоцировать Исх.№ и заблокировать">🔒 Финализировать</Btn>
        )}
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        {allowEdit && (
          <Btn variant="primary" onClick={onEdit}>✎ Редактировать</Btn>
        )}
      </MFoot>
    </MCard>
  );
}
