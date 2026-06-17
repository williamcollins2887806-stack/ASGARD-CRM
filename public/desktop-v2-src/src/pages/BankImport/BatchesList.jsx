/**
 * Список загруженных пачек банковских выписок.
 * GET /api/integrations/bank/batches — пагинация по 100 за раз.
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { EmptyState } from '@/blocks/Blocks';
import { loadBatches, loadTransactions, fmtDateTime } from './api';
import TransactionDetail from './TransactionDetail';

export default function BatchesList() {
  const modal = useModal();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [limit] = useState(100);
  const [offset, setOffset] = useState(0);

  const refresh = () => {
    setLoading(true);
    loadBatches(limit, offset)
      .then((r) => {
        if (r?.success) {
          setItems(r.items || []);
          setTotal(r.total || 0);
        } else {
          setItems([]); setTotal(0);
        }
      })
      .catch((e) => {
        toast.error('Не удалось загрузить пачки: ' + (e?.message || ''));
        setItems([]); setTotal(0);
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [offset]);

  const onShowTx = async (batchId) => {
    // Открываем первую транзакцию пачки — пользователь увидит детали + вернётся к списку
    try {
      const r = await loadTransactions({ batch_id: batchId, limit: 1 });
      if (r?.success && r.items?.length) {
        modal.open(<TransactionDetail id={r.items[0].id} onSaved={refresh} />, { size: 'wide' });
      } else {
        toast.warn('В пачке нет транзакций');
      }
    } catch (e) {
      toast.error('Не удалось открыть пачку: ' + (e?.message || ''));
    }
  };

  if (loading && !items.length) {
    return <div className="card p-32 t-center c-t3">⏳ Загружаем…</div>;
  }

  if (!items.length) {
    return <EmptyState icon="📦" title="Пачек нет" hint="Загрузите первую банковскую выписку — она появится здесь" />;
  }

  return (
    <div className="card card-pad-0 ov-hidden">
      <div className="bi-batch-head">
        <div>#</div>
        <div>Файл</div>
        <div>Формат</div>
        <div className="t-right">Всего</div>
        <div className="t-right">Новых</div>
        <div className="t-right">Дубли</div>
        <div className="t-right">Авто</div>
        <div className="t-right">К разноске</div>
        <div>Загрузил</div>
        <div>Когда</div>
        <div></div>
      </div>
      <div className="bi-batch-body">
        {items.map((b) => (
          <div key={b.id} className="bi-batch-row">
            <div>#{b.id}</div>
            <div className="bi-batch-fn" title={b.filename}>{b.filename || '—'}</div>
            <div>{b.source_format || '—'}</div>
            <div className="t-right">{b.total_rows ?? 0}</div>
            <div className="t-right c-ok">{b.new_rows ?? 0}</div>
            <div className="t-right c-err">{b.duplicate_rows ?? 0}</div>
            <div className="t-right c-blue">{b.auto_classified ?? 0}</div>
            <div className="t-right c-amber">{b.manual_needed ?? 0}</div>
            <div>{b.imported_by_name || '—'}</div>
            <div>{fmtDateTime(b.created_at)}</div>
            <div className="t-right">
              <Btn variant="ghost" size="sm" onClick={() => onShowTx(b.id)}>Открыть</Btn>
            </div>
          </div>
        ))}
      </div>
      <div className="bi-pager">
        <div className="bi-pager-info">Показано {items.length} из {total}</div>
        <div className="bi-pager-ctrl">
          <Btn variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>‹ Назад</Btn>
          <Btn variant="ghost" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Вперёд ›</Btn>
        </div>
      </div>
    </div>
  );
}
