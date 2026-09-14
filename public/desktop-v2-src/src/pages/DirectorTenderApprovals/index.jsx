import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';
import { useModal } from '@/modals';
import {
  loadDirectorReviewQueue, markDirectorReviewSeen, fmtRegistryDate
} from '../Tenders/api';
import { fmtMoney } from '../Tenders/modals/rpReviewHelpers';
import RpReviewModal from '../Tenders/modals/RpReviewModal';
import '../Tenders/registry-tab.css';

const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];

function canAccess(user) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  const rs = user.roles?.length ? user.roles : (user.role ? [user.role] : []);
  return rs.some((r) => DIRECTOR_ROLES.includes(r));
}

export default function DirectorTenderApprovals() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const { openModal, closeModal } = useModal();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchQueue = useCallback(() => {
    setLoading(true);
    return loadDirectorReviewQueue()
      .then((d) => setItems(d.items || []))
      .catch((e) => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const openDetail = useCallback((row) => {
    markDirectorReviewSeen(row.id).catch(() => {});
    const initialTab = params.get('tab') === 'chat' ? 'thread' : 'report';
    openModal(
      <RpReviewModal
        tender={row}
        pms={[]}
        role="director"
        readOnly
        mode="calc"
        initialTab={initialTab}
        onClose={closeModal}
        onSaved={() => { closeModal(); fetchQueue(); }}
      />
    );
  }, [openModal, closeModal, fetchQueue, params]);

  useEffect(() => {
    const id = params.get('id');
    if (!id || !items.length) return;
    const row = items.find((r) => String(r.id) === String(id));
    if (row) openDetail(row);
  }, [items, params, openDetail]);

  if (!canAccess(user)) {
    return <div className="card"><p>Доступ только для директоров</p></div>;
  }

  return (
    <div>
      <div className="page-head" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Согласование тендеров</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          Просчёты РП от 10 млн ₽ без НДС · {items.length} в очереди
        </p>
        <button type="button" className="btn mini ghost" style={{ marginTop: 8 }} onClick={fetchQueue}>
          Обновить
        </button>
      </div>

      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : !items.length ? (
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <p className="muted">Нет тендеров, ожидающих согласования</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="tbl" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th>№</th>
                <th>Заказчик</th>
                <th>Работа</th>
                <th>НМЦ</th>
                <th>Цена РП без НДС</th>
                <th>Срок подачи</th>
                <th>Срок работ</th>
                <th>РП</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  className={(row.director_unread || row.thread_unread) ? 'reg-row-unread' : ''}
                  style={{ cursor: 'pointer' }}
                  onClick={() => openDetail(row)}
                >
                  <td>{row.registry_no || row.id}</td>
                  <td>{row.customer_name || '—'}</td>
                  <td>{(row.tender_title || '—').slice(0, 60)}</td>
                  <td>{fmtMoney(row.tender_price)}</td>
                  <td><strong>{fmtMoney(row.work_price_ex_vat)}</strong></td>
                  <td>{fmtRegistryDate(row.docs_deadline)}</td>
                  <td>{row.duration_days != null ? `${row.duration_days} дн.` : '—'}</td>
                  <td>{row.calculator_name || '—'}</td>
                  <td>
                    <button type="button" className="btn mini" onClick={(e) => { e.stopPropagation(); openDetail(row); }}>
                      Открыть
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
