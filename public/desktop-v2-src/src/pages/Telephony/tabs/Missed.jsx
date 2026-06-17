/**
 * Telephony / Таб «Пропущенные».
 *
 * Источник vanilla: public/assets/js/telephony.js (раздел renderMissedTab,
 * GET /api/telephony/missed) + telephony.js:934 backend.
 *
 *   • Список пропущенных звонков (call_type='missed') с фильтром по
 *     `Только непросмотренные` (`acknowledged=false`).
 *   • Бейдж непросмотренных (`unacknowledged`) поднимается через onCountChange
 *     в родительский TabsBar — там виден прямо в title таба.
 *   • Кнопка «📞 Перезвонить» в строке открывает MakeCallModal с предзаполненным
 *     номером — реюзает существующий модуль исходящего звонка.
 *   • Кнопка «Просмотрено» снимает unacknowledged.
 *
 * Никаких заглушек.
 */
import { useEffect, useState, useCallback } from 'react';
import { useModal } from '@/modals';
import { Btn } from '@/modals/parts';
import { EmptyState } from '@/blocks/Blocks';
import { StatusBadge } from '@/modals/Notifications';
import { Switch } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { CallDetailModal } from '../modals/CallDetailModal';
import { MakeCallModal } from '../modals/MakeCallModal';
import { loadMissed, ackMissed, fmtDateTime, fmtPhone } from '../api';

export default function MissedTab({ onCountChange }) {
  const modal = useModal();
  const [items, setItems] = useState([]);
  const [unack, setUnack] = useState(0);
  const [onlyUnack, setOnlyUnack] = useState(true);
  const [loading, setLoading] = useState(true);
  const [acking, setAcking] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    loadMissed({ acknowledged: onlyUnack ? false : undefined, limit: 500 })
      .then((d) => {
        setItems(d.items || []);
        setUnack(d.unacknowledged || 0);
        if (typeof onCountChange === 'function') onCountChange(d.unacknowledged || 0);
      })
      .finally(() => setLoading(false));
  }, [onlyUnack, onCountChange]);

  useEffect(() => { refresh(); }, [refresh]);

  // SSE: новый пропущенный → обновляем счётчик + список.
  useEffect(() => {
    const onCall = () => refresh();
    window.addEventListener('asgard:call:incoming', onCall);
    window.addEventListener('asgard:call:ended', onCall);
    return () => {
      window.removeEventListener('asgard:call:incoming', onCall);
      window.removeEventListener('asgard:call:ended', onCall);
    };
  }, [refresh]);

  const handleAck = async (id) => {
    setAcking(id);
    try {
      await ackMissed(id);
      toast.success('Отмечено как просмотренное');
      refresh();
    } catch (e) {
      toast.error('Не удалось отметить');
    } finally {
      setAcking(null);
    }
  };

  const handleCallback = (call) => {
    const phone = call.from_number || call.caller_number || '';
    modal.open(<MakeCallModal defaultPhone={phone} contactName={call.client_name || ''} />);
  };

  return (
    <div className="col gap-12">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 0' }}>
        <Switch checked={onlyUnack} onChange={setOnlyUnack} label="Только непросмотренные" />
        <span className="c-t3 fs-12">
          {unack > 0 ? `☎ ${unack} непросмотренных` : 'Все пропущенные просмотрены'}
        </span>
      </div>

      {loading ? (
        <div className="card card-empty">⏳ Загружаем пропущенные…</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="✓"
          title={onlyUnack ? 'Нет непросмотренных пропущенных' : 'Пропущенных звонков нет'}
          hint="Все звонки обработаны"
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="t-list w-full tbl-base">
              <thead>
                <tr className="bg-inner tbl-row-brd">
                  <th className="w-50">#</th>
                  <th>От кого</th>
                  <th className="w-200">Клиент</th>
                  <th className="w-160">Когда</th>
                  <th className="w-120">Статус</th>
                  <th className="w-220" style={{ textAlign: 'right' }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const fromPhone = c.from_number || c.caller_number || '';
                  return (
                    <tr key={c.id} className="row-hover">
                      <td className="c-t3 fs-12">#{c.id}</td>
                      <td>
                        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, cursor: 'pointer' }}
                             onClick={() => modal.open(<CallDetailModal call={c} />)}>
                          {fmtPhone(fromPhone)}
                        </div>
                      </td>
                      <td>
                        {c.client_name && <div className="fw-600">{c.client_name}</div>}
                        {c.client_contact && <div className="fs-11-5 c-t3">{c.client_contact}</div>}
                        {!c.client_name && <span className="c-t3 fs-12">— неизвестный —</span>}
                      </td>
                      <td className="fs-12 c-t3">{fmtDateTime(c.created_at || c.started_at)}</td>
                      <td>
                        <StatusBadge
                          tone={c.missed_acknowledged ? 'approved' : 'rejected'}
                          label={c.missed_acknowledged ? 'Просмотрено' : 'Новый'}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          {!c.missed_acknowledged && (
                            <Btn
                              size="sm"
                              variant="ghost"
                              disabled={acking === c.id}
                              onClick={() => handleAck(c.id)}
                            >
                              ✓ Просмотрено
                            </Btn>
                          )}
                          <Btn
                            size="sm"
                            variant="primary"
                            disabled={!fromPhone}
                            onClick={() => handleCallback(c)}
                          >
                            📞 Перезвонить
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
