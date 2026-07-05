/**
 * RegistryTab — spreadsheet-style TO tender entry
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadRegistry, createRegistryRow, patchRegistryField, patchRegistryStatus,
  REGISTRY_STATUSES
} from './api';
import CustomerSuggestCell from './CustomerSuggestCell';

function useDebouncedSave(delay = 400) {
  const timers = useRef({});
  return useCallback((key, fn) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, delay);
  }, [delay]);
}

export default function RegistryTab({ subtab = 'registry', onOpenWin, onRefresh }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const debounce = useDebouncedSave();

  const refresh = useCallback(() => {
    setLoading(true);
    loadRegistry({ subtab })
      .then(d => setRows(d.items || []))
      .catch(e => toast('Ошибка загрузки: ' + e.message, 'err'))
      .finally(() => setLoading(false));
  }, [subtab]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveField = (id, field, value) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    debounce(`${id}:${field}`, () => {
      patchRegistryField(id, field, value)
        .then(() => onRefresh?.())
        .catch(e => toast(e.message, 'err'));
    });
  };

  const saveStatus = (id, registry_status) => {
    patchRegistryStatus(id, registry_status)
      .then(d => {
        setRows(prev => prev.map(r => r.id === id ? { ...r, ...d.tender } : r));
        if (registry_status === 'выиграли') onOpenWin?.(d.tender);
        onRefresh?.();
      })
      .catch(e => toast(e.message, 'err'));
  };

  const addRow = () => {
    createRegistryRow({ customer_name: 'Новый заказчик', tender_title: 'Новый тендер' })
      .then(d => {
        setRows(prev => [d.tender, ...prev]);
        toast('Строка добавлена', 'ok');
        onRefresh?.();
      })
      .catch(e => toast(e.message, 'err'));
  };

  return (
    <div className="registry-tab">
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <Btn onClick={addRow}>+ Добавить строку</Btn>
        <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
      </div>
      {loading && <p>Загрузка…</p>}
      <div style={{ overflowX: 'auto' }}>
        <table className="tnd-table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th>Заказчик</th>
              <th>Тендер</th>
              <th>НМЦ</th>
              <th>Срок</th>
              <th>Статус</th>
              <th>Кто считает</th>
              <th>РП</th>
              <th>Скор</th>
              <th>↗</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td>
                  <CustomerSuggestCell
                    value={row.customer_name || ''}
                    inn={row.customer_inn}
                    onChange={(name, inn) => {
                      saveField(row.id, 'customer_name', name);
                      if (inn) saveField(row.id, 'customer_inn', inn);
                    }}
                  />
                </td>
                <td>
                  <input
                    className="inp"
                    value={row.tender_title || ''}
                    onChange={e => saveField(row.id, 'tender_title', e.target.value)}
                    style={{ width: '100%', minWidth: 140 }}
                  />
                </td>
                <td>
                  <input
                    className="inp"
                    type="number"
                    value={row.tender_price ?? ''}
                    onChange={e => saveField(row.id, 'tender_price', e.target.value ? Number(e.target.value) : null)}
                    style={{ width: 90 }}
                  />
                </td>
                <td>
                  <input
                    className="inp"
                    type="date"
                    value={row.docs_deadline ? String(row.docs_deadline).slice(0, 10) : ''}
                    onChange={e => saveField(row.id, 'docs_deadline', e.target.value || null)}
                  />
                </td>
                <td>
                  <select
                    className="inp"
                    value={row.registry_status || 'рассмотрение'}
                    onChange={e => saveStatus(row.id, e.target.value)}
                  >
                    {REGISTRY_STATUSES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </td>
                <td>{row.calculator_user_name || row.rp_review?.calculator_name || '—'}</td>
                <td>
                  {row.rp_review?.decision === 'submit' && <span className="pill ok">Подаём</span>}
                  {row.rp_review?.decision === 'reject' && <span className="pill err">Не подаём</span>}
                  {(!row.rp_review || row.rp_review.decision === 'pending') && <span className="pill">ожидает</span>}
                </td>
                <td title={row.score ? JSON.stringify(row.score.top_reject_reasons) : ''}>
                  {row.score ? `${row.score.win_chance_pct}% (${row.score.tenders_count})` : '—'}
                </td>
                <td>
                  {row.purchase_url ? (
                    <a href={row.purchase_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">↗</a>
                  ) : (
                    <input
                      className="inp"
                      placeholder="URL"
                      value={row.purchase_url || ''}
                      onChange={e => saveField(row.id, 'purchase_url', e.target.value)}
                      style={{ width: 80 }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && <p className="muted">Нет записей</p>}
    </div>
  );
}
