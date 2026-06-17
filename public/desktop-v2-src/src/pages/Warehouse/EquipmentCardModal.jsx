import { useState, useEffect } from 'react';
import { useModal, PromptModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadEquipmentItem, returnEquipment as _returnEquipment, isAdmin,
  STATUS_META, CONDITION_META, MOVE_META,
  formatDate, money, fmt, eqIcon,
  equipmentSendToRepair
} from './api';
import { EquipmentFormModal } from './EquipmentFormModal';
import { EquipmentIssueModal } from './EquipmentIssueModal';
import { EquipmentReturnModal } from './EquipmentReturnModal';
import { EquipmentTransferModal } from './EquipmentTransferModal';
import { EquipmentPhotoPanel } from './EquipmentPhotoPanel';
import { EquipmentMaintenanceModal } from './EquipmentMaintenanceModal';

/** Карточка единицы оборудования с табами (vanilla openCard / openEquipmentCard). */
export function EquipmentCardModal({ equipmentId, currentUser, onChanged }) {
  const { close, open } = useModal();
  const [item, setItem] = useState(null);
  const [moves, setMoves] = useState([]);
  const [maint, setMaint] = useState([]);
  const [tab, setTab] = useState('info');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEquipmentItem(equipmentId)
      .then((d) => {
        setItem(d.equipment || d.item || d);
        setMoves(d.movements || []);
        setMaint(d.maintenance || []);
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, [equipmentId]);

  if (loading || !item) {
    return (
      <MCard>
        <MHead icon="🛠️" title="Оборудование" accent="info" onClose={close} />
        <MBody>
          <div className="p-24 t-center c-t3">⏳ Загрузка…</div>
        </MBody>
      </MCard>
    );
  }

  const e = item;
  const st = STATUS_META[e.status] || { label: e.status, tone: 'mute', icon: '•' };
  const cond = CONDITION_META[e.condition];
  const admin = isAdmin(currentUser?.role);
  const canReturn = (admin || e.current_holder_id === currentUser?.id) && e.status === 'issued';

  const onChangeRefresh = () => {
    onChanged?.();
    setLoading(true);
    loadEquipmentItem(equipmentId).then((d) => {
      setItem(d.equipment || d.item || d);
      setMoves(d.movements || []);
      setMaint(d.maintenance || []);
    }).finally(() => setLoading(false));
  };

  // Hero-превью: фото имеет приоритет; иначе крупный emoji custom_icon; иначе fallback eqIcon.
  const heroPhoto = e.photo_url && !String(e.photo_url).startsWith('icon:');
  const heroIcon = !heroPhoto ? (e.custom_icon || eqIcon(e)) : null;

  return (
    <MCard>
      <MHead
        icon={eqIcon(e)}
        title={`${e.name}`}
        subtitle={[
          e.inventory_number ? '№ ' + e.inventory_number : '',
          e.category_name || ''
        ].filter(Boolean).join(' · ')}
        accent="info"
        onClose={close}
      />
      <MBody>
        {/* Hero: мини-превью фото или крупный emoji */}
        <div className="row gap-12 mb-14 u-wrap" style={{ alignItems: 'center' }}>
          <div style={{
            width: 72,
            height: 72,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--r-md)',
            background: 'var(--bg-card, rgba(255,255,255,0.04))',
            border: '1px solid var(--border)',
            flex: '0 0 auto',
            overflow: 'hidden'
          }}>
            {heroPhoto ? (
              <img
                src={e.photo_url}
                alt={e.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 40, lineHeight: 1 }}>{heroIcon}</span>
            )}
          </div>
          <div className="row gap-8 u-wrap" style={{ flex: 1 }}>
            <span className={'wh-chip wh-chip--' + (st.tone || 'mute')}>{st.icon} {st.label}</span>
            {cond && <span className={'wh-chip wh-chip--' + cond.tone}>● {cond.label}</span>}
          </div>
        </div>

        {/* Табы */}
        <div className="wh-eq-tabs">
          {[
            { id: 'info', label: 'Инфо' },
            { id: 'photo', label: '📷 Фото' },
            { id: 'moves', label: `Перемещения${moves.length ? ' (' + moves.length + ')' : ''}` },
            { id: 'maint', label: `ТО${maint.length ? ' (' + maint.length + ')' : ''}` },
            { id: 'qr',    label: 'QR' }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={'wh-eq-tab' + (tab === t.id ? ' wh-eq-tab--active' : '')}
            >{t.label}</button>
          ))}
        </div>

        {tab === 'info' && (
          <div className="grid-auto-220 gap-12">
            <Panel title="Основное">
              <Kv k="Серийный №" v={e.serial_number || '—'} />
              <Kv k="Штрихкод" v={e.barcode || '—'} />
              <Kv k="Бренд / модель" v={[e.brand, e.model].filter(Boolean).join(' ') || '—'} />
              <Kv k="Количество" v={`${fmt(e.quantity || 1)} ${e.unit || 'шт'}`} />
            </Panel>
            <Panel title="Местоположение">
              <Kv k="Склад" v={e.warehouse_name || '—'} />
              <Kv k="Ячейка" v={e.location_label || '—'} />
              <Kv k="Ответственный" v={e.holder_name || '—'} />
              <Kv k="Объект" v={e.object_name || '—'} />
            </Panel>
            <Panel title="Финансы">
              <Kv k="Стоимость" v={money(e.purchase_price)} />
              <Kv k="Куплено" v={formatDate(e.purchase_date)} />
              {(e.book_value != null || e.accumulated_depreciation != null) && (
                <>
                  <Kv k="Балансовая стоимость" v={money(e.book_value)} />
                  <Kv k="Накоплено амортизации" v={money(e.accumulated_depreciation)} />
                </>
              )}
            </Panel>
            <Panel title="ТО и гарантия">
              <Kv k="Гарантия до" v={formatDate(e.warranty_end)} />
              <Kv k="След. ТО" v={formatDate(e.next_maintenance)} />
              <Kv k="Поверка" v={formatDate(e.next_calibration)} />
            </Panel>
            {e.notes && (
              <Panel title="Примечания" wide>
                <div className="fs-13 c-t1">{e.notes}</div>
              </Panel>
            )}
          </div>
        )}

        {tab === 'photo' && (
          <div style={{ maxWidth: 520, margin: '0 auto' }}>
            <EquipmentPhotoPanel
              eqId={e.id}
              photoUrl={e.photo_url}
              customIcon={e.custom_icon}
              onSaved={onChangeRefresh}
            />
            <div className="fs-12 c-t3 mt-10 t-center">
              Фото или иконка отображаются в карточке, списках оборудования и QR-этикетках.
            </div>
          </div>
        )}

        {tab === 'moves' && (
          moves.length === 0 ? (
            <div className="wh-empty">
              <div className="wh-empty__ic">📜</div>
              <div>Перемещений нет</div>
            </div>
          ) : (
            <div className="mh-380 ov-y-auto">
              {moves.map((m, i) => {
                const meta = MOVE_META[m.movement_type] || { icon: '•', label: m.movement_type };
                return (
                  <div key={i} className="wh-mv">
                    <div className="wh-mv__ic">{meta.icon}</div>
                    <div className="flex-1">
                      <div className="fw-600">{meta.label}</div>
                      <div className="fs-12 c-t3">
                        {m.from_holder_name ? 'От: ' + m.from_holder_name : (m.from_warehouse_name ? 'Со склада: ' + m.from_warehouse_name : '')}
                        {m.to_holder_name ? ' → ' + m.to_holder_name : (m.to_warehouse_name ? ' → ' + m.to_warehouse_name : '')}
                      </div>
                      {m.work_title && (
                        <div className="fs-12 c-t3">📋 {m.work_number || ''} {m.work_title}</div>
                      )}
                      {m.notes && (
                        <div className="fs-12 c-t3 mt-4">{m.notes}</div>
                      )}
                    </div>
                    <div className="fs-11 c-t3 t-right">
                      {formatDate(m.created_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {tab === 'maint' && (
          <>
            {/* Vanilla warehouse-v2-equipment.js:openMaintenanceForm — кнопка добавления записи ТО */}
            {admin && (
              <div className="row gap-8 mb-12">
                <Btn variant="primary" size="sm" onClick={() => open(<EquipmentMaintenanceModal eq={e} onSaved={onChangeRefresh} />)}>
                  ➕ Добавить ТО / ремонт / поверку
                </Btn>
              </div>
            )}
            {maint.length === 0 ? (
              <div className="wh-empty">
                <div className="wh-empty__ic">🔧</div>
                <div>Записей ТО нет</div>
              </div>
            ) : (
              <div className="mh-380 ov-y-auto">
                {maint.map((m, i) => (
                  <div key={i} className="wh-mv">
                    <div className="wh-mv__ic">🔧</div>
                    <div className="flex-1">
                      <div className="fw-600">{m.maintenance_type || m.type || 'ТО'}</div>
                      <div className="fs-12 c-t3">{m.description || '—'}</div>
                      {Array.isArray(m.spare_parts) && m.spare_parts.length > 0 && (
                        <div className="fs-11 c-t3 mt-2">Запчасти: {m.spare_parts.join(', ')}</div>
                      )}
                      {m.next_date && (
                        <div className="fs-11 c-t3 mt-2">След. ТО: {formatDate(m.next_date)}</div>
                      )}
                    </div>
                    <div className="fs-11 c-t3 t-right">
                      {formatDate(m.completed_at || m.created_at)}
                      {m.cost && <div>{Number(m.cost).toLocaleString('ru-RU')} ₽</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'qr' && (
          <div className="t-center p-16">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(e.qr_uuid || e.inventory_number || ('EQ-' + e.id))}`}
              alt="QR-код"
              style={{ borderRadius: 'var(--r-md)', background: '#fff', padding: 8 }}
            />
            <div className="mt-10 fs-13 c-t3">
              {e.qr_uuid || e.inventory_number || '—'}
            </div>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Закрыть</Btn>
        {admin && (
          <Btn variant="ghost" onClick={() => open(<EquipmentFormModal eq={e} onSaved={onChangeRefresh} />)}>
            ✎ Редактировать
          </Btn>
        )}
        {admin && e.status === 'on_warehouse' && (
          <Btn variant="primary" onClick={() => open(<EquipmentIssueModal eq={e} onSaved={onChangeRefresh} />)}>
            📤 Выдать
          </Btn>
        )}
        {canReturn && (
          <Btn variant="primary" onClick={() => open(<EquipmentReturnModal eq={e} onSaved={onChangeRefresh} />)}>
            📥 Вернуть
          </Btn>
        )}
        {e.status === 'issued' && (
          <Btn variant="ghost" onClick={() => open(<EquipmentTransferModal eq={e} onSaved={onChangeRefresh} />)}>
            🔄 Передача
          </Btn>
        )}
        {/* Vanilla warehouse-v2-equipment.js:283 — кнопка «🔧 В ремонт» ADMIN-only, любой статус кроме repair/written_off */}
        {admin && !['repair', 'written_off'].includes(e.status) && (
          <Btn variant="ghost" onClick={() => open(<PromptModal
            title={'В ремонт: ' + e.name}
            icon="🔧"
            accent="warn"
            label="Причина / описание неисправности"
            multiline
            required
            onSubmit={async (description) => {
              try {
                await equipmentSendToRepair({ equipment_id: e.id, description });
                toast.success('Отправлено в ремонт');
                onChangeRefresh();
              } catch (err) { toast.error('Ошибка: ' + (err?.message || err)); }
            }}
          />)}>
            🔧 В ремонт
          </Btn>
        )}
      </MFoot>
    </MCard>
  );
}

function Panel({ title, children, wide }) {
  return (
    <div className={'wh-eq-panel' + (wide ? ' wh-eq-panel--wide' : '')}>
      <h4 className="wh-eq-panel-h4">{title}</h4>
      {children}
    </div>
  );
}

function Kv({ k, v }) {
  return (
    <div className="mt-4">
      <div className="fs-11 c-t3">{k}</div>
      <div className="fs-13 c-t1 fw-600">{v || '—'}</div>
    </div>
  );
}
