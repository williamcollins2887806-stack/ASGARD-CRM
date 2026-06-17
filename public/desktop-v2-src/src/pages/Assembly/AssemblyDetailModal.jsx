/**
 * Карточка ведомости сборки: позиции + паллеты + действия по статусу.
 * Источник: vanilla `assembly-page.js` → openDetail + `assembly-dnd.js`.
 *
 * Реализован весь функциональный набор vanilla:
 *   ✅ Список позиций + добавление вручную + удаление + отметка «собрано»
 *   ✅ Visual Pallet Builder: drag&drop палет + FLIP + ripple + Web Audio thud +
 *      ghost cursor + capacity-overfill + stretch-film overlay + touch DnD
 *      (см. PalletBuilder.jsx / PalletItem.jsx / assembly-dnd.css)
 *   ✅ Demob: для каждой позиции — return_status (returning/damaged/lost/consumed)
 *   ✅ Действия по статусу: confirm / send / receive-all / create-demob
 *   ✅ Скачать чек-лист PDF + Excel (через blob + Authorization header — без токена в URL)
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { useAuth } from '@/api/useAuth';
import { openProtected } from '@/api/download';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { toast, StatusBadge } from '@/modals/Notifications';
import { ConfirmModal, PromptModal } from '@/modals';
import {
  loadDetail, confirmAssembly, sendAssembly, receiveAll, createDemob,
  deleteItem, packItem, setReturnStatus,
  statusInfo, typeInfo, SOURCE_LABELS, RETURN_STATUSES,
  fmtDate, fmtDateTime, emitChanged
} from './api';
import { AddItemModal } from './AddItemModal';
import { PalletBuilder } from './PalletBuilder';

const PM_ROLES   = ['PM', 'HEAD_PM'];
const WH_ROLES   = ['WAREHOUSE', 'ADMIN'];
const DIR_ROLES  = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export function AssemblyDetailModal({ id }) {
  const { close, open } = useModal();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    setLoading(true);
    loadDetail(id)
      .then(setData)
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [id]);

  if (loading || !data?.item) {
    return (
      <MCard className="modal-xl">
        <MHead icon="🏗️" title="Загружаем ведомость…" onClose={close} />
        <MBody><div className="card-empty">⏳ Загружаем…</div></MBody>
      </MCard>
    );
  }

  const a = data.item;
  const items = data.items || [];
  const pallets = data.pallets || [];
  const role = user?.role;
  const isDemob = a.type === 'demobilization';

  const canEditList = ['draft', 'confirmed', 'packing'].includes(a.status);
  const canPack = ['confirmed', 'packing'].includes(a.status) &&
    [...PM_ROLES, ...WH_ROLES, ...DIR_ROLES].includes(role);
  const canConfirm = a.status === 'draft' &&
    [...PM_ROLES, ...DIR_ROLES].includes(role);
  const canSend = ['confirmed', 'packing', 'packed'].includes(a.status) &&
    [...PM_ROLES, ...WH_ROLES].includes(role);
  const canDemob = a.type === 'mobilization' && a.status !== 'draft' &&
    [...PM_ROLES, ...WH_ROLES].includes(role);
  const canReceive = isDemob && ['in_transit', 'received'].includes(a.status) &&
    WH_ROLES.includes(role);

  const packedCount = items.filter((i) => i.packed).length;
  const _palletizedCount = items.filter((i) => i.pallet_id).length;
  const pct = items.length ? Math.round((packedCount / items.length) * 100) : 0;

  const tType = typeInfo(a.type);
  const st = statusInfo(a.status);

  const onAddItem = () => open(<AddItemModal assemblyId={id} onAdded={reload} />);
  const onDeleteItem = (it) => open(
    <ConfirmModal
      tone="danger"
      title="Удалить позицию?"
      message={`«${it.name}» (${it.quantity} ${it.unit})`}
      confirmLabel="Удалить"
      onConfirm={async () => {
        try {
          await deleteItem(id, it.id);
          toast.success('Удалено');
          reload();
        } catch (e) {
          toast.error('Не удалось: ' + (e?.message || e));
        }
      }}
    />
  );

  const onPackItem = async (it) => {
    try {
      await packItem(id, it.id);
      toast.success('Отмечено как собрано');
      reload();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  const onChangeReturnStatus = (it, newStatus) => {
    if (['damaged', 'lost'].includes(newStatus)) {
      open(
        <PromptModal
          title="Укажите причину"
          placeholder={newStatus === 'damaged' ? 'Что сломано / почему?' : 'Где утеряно?'}
          required
          onConfirm={async (reason) => {
            try {
              await setReturnStatus(id, it.id, { return_status: newStatus, return_reason: reason });
              reload();
            } catch (e) {
              toast.error('Не удалось: ' + (e?.message || e));
            }
          }}
        />
      );
    } else {
      setReturnStatus(id, it.id, { return_status: newStatus })
        .then(reload)
        .catch((e) => toast.error('Не удалось: ' + (e?.message || e)));
    }
  };

  const onConfirm = () => open(
    <ConfirmModal
      tone="success"
      title="Подтвердить ведомость?"
      message="После подтверждения позиции и паллеты заморозятся для упаковки."
      confirmLabel="Подтвердить"
      onConfirm={async () => {
        setBusy(true);
        try {
          await confirmAssembly(id);
          toast.success('Подтверждено');
          emitChanged();
          reload();
        } catch (e) {
          toast.error('Не удалось: ' + (e?.message || e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );

  const onSend = () => open(
    <ConfirmModal
      tone="warn"
      title="Отправить на объект?"
      message="Ведомость перейдёт в статус «В пути». Кладовщику уйдёт уведомление."
      confirmLabel="Отправить"
      onConfirm={async () => {
        setBusy(true);
        try {
          await sendAssembly(id);
          toast.success('Отправлено');
          emitChanged();
          reload();
        } catch (e) {
          toast.error('Не удалось: ' + (e?.message || e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );

  const onDemob = () => open(
    <ConfirmModal
      tone="warn"
      title="Создать демобилизацию?"
      message="На основе текущей мобилизации создастся демоб-ведомость с теми же позициями."
      confirmLabel="Создать"
      onConfirm={async () => {
        setBusy(true);
        try {
          const r = await createDemob(id);
          toast.success('Демоб создана #' + r?.item?.id);
          emitChanged();
          close();
        } catch (e) {
          toast.error('Не удалось: ' + (e?.message || e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );

  const onReceiveAll = () => open(
    <ConfirmModal
      tone="success"
      title="Принять на склад?"
      message="Все позиции с return_status=returning вернутся в stock/equipment. Сломанные/утерянные — списываются."
      confirmLabel="Принять"
      onConfirm={async () => {
        setBusy(true);
        try {
          const r = await receiveAll(id);
          toast.success(`Принято: ${r?.returned || 0} возвр., ${r?.written_off || 0} спис.`);
          emitChanged();
          reload();
        } catch (e) {
          toast.error('Не удалось: ' + (e?.message || e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );

  return (
    <MCard className="modal-xl">
      <MHead
        icon={isDemob ? '🏠' : '🏗️'}
        title={a.title || ('Ведомость #' + a.id)}
        subtitle={`${tType.iconLabel} · ${a.work_title || '—'}`}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="col gap-18">
          {/* Шапка-статусы */}
          <div className="row gap-8 u-wrap">
            <StatusBadge tone={st.tone} label={st.label} />
            <Pill>{tType.label}</Pill>
            {a.destination && <Pill tone="info">→ {a.destination}</Pill>}
            {a.planned_date && <Pill>План: {fmtDate(a.planned_date)}</Pill>}
          </div>

          {/* KPI */}
          <div className="grid-4 gap-10">
            <StatCard val={items.length} lbl="Позиций" />
            <StatCard val={packedCount + '/' + items.length} lbl="Собрано" />
            <StatCard val={pct + '%'} lbl="Прогресс" tone={pct === 100 ? 'ok' : pct > 0 ? 'info' : 'draft'} />
            <StatCard val={pallets.length} lbl="Паллет" />
          </div>

          {/* Progress bar */}
          <div className="progress-8">
            <div className="bar-fill-gold" style={{ width: pct + '%' }} />
          </div>

          {/* Метаданные */}
          <div className="grid-2 gap-10 p-12 bg-inner r-md">
            <KV label="Создал"   value={`${a.creator_name || '—'} · ${fmtDateTime(a.created_at)}`} />
            {a.actual_sent_at     && <KV label="Отправлено" value={fmtDateTime(a.actual_sent_at)} />}
            {a.actual_received_at && <KV label="Принято"    value={fmtDateTime(a.actual_received_at)} />}
            {a.customer_name      && <KV label="Заказчик"   value={a.customer_name} />}
          </div>

          {/* Visual Pallet Builder — DnD сборка палет */}
          <Section
            title={`Визуальная сборка палет (${pallets.length} палет, ${items.filter((i) => i.pallet_id).length}/${items.length} размещено)`}
          >
            <PalletBuilder
              assemblyId={id}
              items={items}
              pallets={pallets}
              canEdit={canPack}
              isDemob={isDemob}
              onChanged={reload}
            />
          </Section>

          {/* Позиции */}
          <Section
            title={`Позиции (${items.length})`}
            action={canEditList && <Btn size="sm" onClick={onAddItem}>+ Позиция</Btn>}
          >
            {items.length === 0 ? (
              <div className="c-t3 fs-13">Позиций нет</div>
            ) : (
              <div className="ov-x-auto">
                <table className="sup-table">
                  <thead>
                    <tr>
                      <th>Наименование</th>
                      <th className="w-100">Кол-во</th>
                      <th className="w-130">Источник</th>
                      <th className="w-130">Палет</th>
                      {isDemob && <th className="w-150">Возврат</th>}
                      <th className="w-90">Собрано</th>
                      <th className="w-80">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const src = SOURCE_LABELS[it.source] || it.source || '—';
                      const pal = it.pallet_id ? pallets.find((p) => p.id === it.pallet_id) : null;
                      return (
                        <tr key={it.id}>
                          <td><strong>{it.name}</strong></td>
                          <td>{it.quantity} {it.unit || ''}</td>
                          <td className="c-t3">{src}</td>
                          <td className="fs-12">
                            {pal ? (
                              <Pill tone="info">№{pal.pallet_number}{pal.label ? ' · ' + pal.label : ''}</Pill>
                            ) : (
                              <span className="c-t3">— не размещён —</span>
                            )}
                          </td>
                          {isDemob && (
                            <td>
                              <SelectInput
                                value={it.return_status || 'returning'}
                                onChange={(v) => onChangeReturnStatus(it, v)}
                                options={RETURN_STATUSES.map((r) => ({ value: r.value, label: r.label }))}
                              />
                              {it.return_reason && (
                                <div className="fs-11 c-t3 mt-4">{it.return_reason}</div>
                              )}
                            </td>
                          )}
                          <td>
                            {it.packed ? (
                              <Pill tone="approved">✓</Pill>
                            ) : canPack ? (
                              <Btn size="sm" variant="ghost" onClick={() => onPackItem(it)}>Отметить</Btn>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            {canEditList && (
                              <Btn size="sm" variant="ghost" onClick={() => onDeleteItem(it)}>✕</Btn>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8 u-wrap">
          <button type="button" className="m-btn ghost" onClick={() => openProtected(`/api/assembly/${id}/checklist-pdf`, `assembly_${id}_checklist.pdf`).catch((e) => toast.error('PDF: ' + (e?.message || e)))}>🖨️ Чек-лист</button>
          <button type="button" className="m-btn ghost" onClick={() => openProtected(`/api/assembly/${id}/export-excel`, `assembly_${id}.xlsx`).catch((e) => toast.error('Excel: ' + (e?.message || e)))}>📥 Excel</button>
        </div>
        <div className="u-flex gap-8 u-wrap">
          {canConfirm && <Btn variant="primary" disabled={busy} onClick={onConfirm}>✅ Подтвердить</Btn>}
          {canSend    && <Btn variant="primary" disabled={busy} onClick={onSend}>🚛 Отправить</Btn>}
          {canDemob   && <Btn variant="ghost"   disabled={busy} onClick={onDemob}>🏠 Демоб</Btn>}
          {canReceive && <Btn variant="primary" disabled={busy} onClick={onReceiveAll}>📦 Принять</Btn>}
          <Btn onClick={close}>Закрыть</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}

function Section({ title, action, children }) {
  return (
    <div>
      <div className="sec-head">
        <div className="fw-600 fs-14">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function KV({ label, value }) {
  return (
    <div className="kv-row-140">
      <div className="c-t3 fs-13">{label}</div>
      <div className="fs-13">{value}</div>
    </div>
  );
}

function StatCard({ val, lbl, tone = 'draft' }) {
  return (
    <div className="bg-inner r-md p-12 t-center">
      <div className="fs-22 fw-700" style={{ color: tone === 'ok' ? 'var(--ok)' : tone === 'info' ? 'var(--info)' : 'var(--t-1)' }}>{val}</div>
      <div className="fs-11 c-t3 upper mt-4">{lbl}</div>
    </div>
  );
}

