/**
 * TenderCalcModal — главная модалка просчёта для PM.
 * Источник: openTender в pm_calcs.js (~450 строк).
 * Показывает: данные тендера, статус, версии оценок, кнопки действий.
 */
import { useState, useEffect } from 'react';
import '../_pmc-modal.css';
import { useModal } from '@/modals';
import { EstimateMethodPicker } from '@/modals/EstimateMethodPicker';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Field, MoneyInput, NumberInput, SelectInput as _SelectInput, TextareaInput, Checkbox } from '@/inputs/Inputs';
import { StatusBadge, toast } from '@/modals/Notifications';
import { useAuth } from '@/api/useAuth';
import { api as _api } from '@/api/client';
import { openProtected } from '@/api/download';
import {
  CALC_STATUSES, loadEstimates, loadTenderFiles, createEstimate, updateEstimate, updateTender,
  fmtMoney, fmtDate, calcMargin, calcProfitPerManDay
} from '../api';

const DIR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

/** Может ли пользователь редактировать просчёт/смету (vanilla pm_calcs.js:1171, 1225, 1240). */
function canEditCalc(user, tender) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role === 'PM' || user.role === 'HEAD_PM') {
    // PM редактирует только если он ответственный (vanilla 1176, 1113)
    return user.role === 'HEAD_PM' || Number(tender?.responsible_pm_id) === Number(user.id);
  }
  return false;
}

/** Может ли пользователь менять финальный статус тендера (vanilla 885, 957). */
function canEditTenderStatus(user, tender) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role === 'PM') return Number(tender?.responsible_pm_id) === Number(user.id);
  return false;
}

/** Может ли пользователь финализировать смету как директор (vanilla pm_calcs.js:957). */
function canFinalize(user) {
  if (!user) return false;
  return user.role === 'ADMIN' || DIR_ROLES.includes(user.role);
}

export function TenderCalcModal({ tender }) {
  const modal = useModal();
  const { close } = modal;
  const { user } = useAuth();
  const [t, setT] = useState(tender);
  const [estimates, setEstimates] = useState([]);
  const [files, setFiles] = useState([]);
  const [activeEstimateIdx, setActiveEstimateIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const canEdit = canEditCalc(user, t);
  const _canStatus = canEditTenderStatus(user, t);
  const canFinal = canFinalize(user);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setT(tender); }, [tender?.id]);
  useEffect(() => {
    if (!t?.id) return;
    Promise.all([loadEstimates(t.id), loadTenderFiles(t.id)]).then(([est, f]) => {
      setEstimates(est);
      setFiles(f);
      if (est.length > 0) setActiveEstimateIdx(est.length - 1);
    });
  }, [t?.id]);

  const active = estimates[activeEstimateIdx];

  const startEdit = () => {
    if (!canEdit) {
      return toast('Права', 'Редактировать просчёт может только назначенный РП или ADMIN', 'err');
    }
    setEditForm(active ? { ...active } : {
      tender_id: t.id, version_no: (estimates.length || 0) + 1,
      price: t.tender_price || '', cost: '', people: '', days: '',
      probability: 50, approval_status: 'draft', note: '',
      requires_payment: false
    });
    setEditing(true);
  };

  const saveDraft = async () => {
    if (!canEdit) return toast('Права', 'Только РП/админ', 'err');
    if (!editForm) return;
    setBusy(true);
    try {
      const payload = {
        tender_id: t.id,
        version_no: editForm.version_no,
        price_tkp: Number(editForm.price) || 0,
        cost: Number(editForm.cost) || 0,
        crew_count: Number(editForm.people) || null,
        work_days: Number(editForm.days) || null,
        probability_pct: Number(editForm.probability) || 50,
        approval_status: 'draft',
        comment: editForm.note || null
      };
      if (editForm.id) {
        await updateEstimate(editForm.id, payload);
      } else {
        await createEstimate(payload);
      }
      const reloaded = await loadEstimates(t.id);
      setEstimates(reloaded);
      setActiveEstimateIdx(reloaded.length - 1);
      setEditing(false);
      toast('Сохранено', 'Черновик', 'ok');
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const sendToApproval = async () => {
    if (!canEdit) return toast('Права', 'Только РП/админ', 'err');
    if (!editForm) return;
    if (!editForm.cover_letter?.trim() && !editForm.note?.trim()) {
      return toast('Сопроводительное', 'Заполни сопроводительное письмо или заметку', 'warn');
    }
    if (!editForm.price || Number(editForm.price) <= 0) {
      return toast('Проверка', 'Укажите цену ТКП (должна быть > 0)', 'warn');
    }
    setBusy(true);
    try {
      const payload = {
        tender_id: t.id,
        version_no: editForm.version_no,
        price_tkp: Number(editForm.price) || 0,
        cost: Number(editForm.cost) || 0,
        crew_count: Number(editForm.people) || null,
        work_days: Number(editForm.days) || null,
        probability_pct: Number(editForm.probability) || 50,
        approval_status: 'sent',
        cover_letter: editForm.cover_letter || null,
        comment: editForm.note || null
      };
      if (editForm.id) {
        await updateEstimate(editForm.id, payload);
      } else {
        await createEstimate(payload);
      }
      await updateTender(t.id, { tender_status: 'Согласование ТКП' });
      setT({ ...t, tender_status: 'Согласование ТКП' });
      const reloaded = await loadEstimates(t.id);
      setEstimates(reloaded);
      setActiveEstimateIdx(reloaded.length - 1);
      setEditing(false);
      window.dispatchEvent(new CustomEvent('asgard:pmcalcs:changed'));
      toast('📤 Отправлено', 'На согласование руководства', 'ok');
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Финализация статуса тендера директором/админом (vanilla pm_calcs.js:957).
   * Директор может отметить «Готово к отправке КП» после согласования.
   */
  const finalizeStatus = async (newStatus) => {
    if (!canFinal) return toast('Права', 'Финализация доступна только директорам и ADMIN', 'err');
    setBusy(true);
    try {
      await updateTender(t.id, { tender_status: newStatus });
      setT({ ...t, tender_status: newStatus });
      window.dispatchEvent(new CustomEvent('asgard:pmcalcs:changed'));
      window.dispatchEvent(new CustomEvent('asgard:tenders:changed'));
      toast('Статус', `Установлен «${CALC_STATUSES.find((s) => s.value === newStatus)?.label || newStatus}»`, 'ok');
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const onRunMimir = () => {
    // Закрываем модалку текущего просчёта и открываем выбор метода.
    // EstimateMethodPicker сам стартует run и редиректит на /conductor-estimate.
    close();
    modal.open(<EstimateMethodPicker tender={t} />);
  };

  const statusMeta = CALC_STATUSES.find((s) => s.value === t.tender_status) || { label: t.tender_status || '—', tone: 'draft' };

  return (
    <MCard className="modal-xl">
      <MHead
        icon="🧮"
        title={`Просчёт #${t.id}`}
        subtitle={t.customer_name || t.tender_name || ''}
        accent="gold"
        onClose={close}
      />
      <MBody>
        <div className="tcm-grid">
          {/* Левая колонка: данные тендера */}
          <div className="col gap-12">
            <div className="tcm-tender-card">
              <div className="row-spread mb-8">
                <strong className="fs-13">{t.customer_name}</strong>
                <StatusBadge tone={statusMeta.tone} label={statusMeta.label} />
              </div>
              <div className="tcm-tender-meta">
                {t.tender_name && <div>📋 {t.tender_name}</div>}
                {t.inn && <div>ИНН {t.inn}</div>}
                {t.tag && <div>🏷 {t.tag}</div>}
                {t.deadline_at && <div>⏰ Дедлайн: {fmtDate(t.deadline_at)}</div>}
                <div>📅 Создан: {fmtDate(t.created_at)}</div>
              </div>
              {t.comment && (
                <div className="tcm-comment">
                  💬 {t.comment}
                </div>
              )}
              <div className="row gap-6 mt-10 u-wrap">
                <Btn size="sm" variant="primary" onClick={onRunMimir}>⚡ Просчитать (AI)</Btn>
                {/* Vanilla pm_calcs.js:988 — кнопка «📝 Быстрый просчёт» (ручной ввод итоговых цифр без детализации).
                    В v2 это переключение TenderCalcModal в режим editing для активной версии. */}
                {canEdit && !editing && (
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      // Если активная версия есть — редактируем её, иначе создаём новую (как в vanilla quick-edit).
                      if (active) {
                        setEditForm({ ...active });
                      } else {
                        startEdit();
                        return;
                      }
                      setEditing(true);
                    }}
                    title="Ручной ввод итоговых цифр без детализации"
                  >📝 Быстрый просчёт</Btn>
                )}
                <Btn size="sm" variant="ghost" onClick={() => { window.location.hash = `#/tenders?id=${t.id}`; close(); }}>📋 Открыть тендер</Btn>
              </div>
            </div>

            {/* Документы тендера */}
            <div>
              <strong className="section-eyebrow">
                📁 Документы ({files.length})
              </strong>
              {files.length === 0 ? (
                <div className="tcm-files-empty">Документов не приложено</div>
              ) : (
                <div className="tcm-files-list">
                  {files.map((f) => {
                    // Бэкенд: GET /api/files/download/:filename (src/routes/files.js:203).
                    // Open через blob с Authorization-header — БЕЗ токена в URL (security: D-4).
                    const fname = encodeURIComponent(f.filename || '');
                    const label = f.original_name || f.filename || f.name || `Файл #${f.id}`;
                    return (
                      <button
                        type="button"
                        key={f.id}
                        onClick={() => openProtected('/api/files/download/' + fname, label).catch((e) => toast.error('Файл: ' + (e?.message || e)))}
                        className="tcm-file-row"
                        style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer' }}
                      >
                        <span>📄 {label}</span>
                        <span className="muted">{fmtDate(f.created_at)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Правая колонка: версии оценок */}
          <div className="col gap-10">
            <div className="row-spread">
              <strong className="section-eyebrow">
                Версии оценок ({estimates.length})
              </strong>
              {!editing && canEdit && <Btn size="sm" variant="primary" onClick={startEdit}>+ Новая версия</Btn>}
              {!editing && !canEdit && (
                <span className="tcm-ro-label" title="Редактировать может только назначенный РП или ADMIN">
                  только просмотр
                </span>
              )}
            </div>

            {/* Список версий */}
            {!editing && (
              estimates.length === 0 ? (
                <div className="tcm-empty">
                  📭 Версий ещё нет. Нажми «+ Новая версия» или «⚡ Просчитать (AI)»
                </div>
              ) : (
                <div className="tcm-versions-list">
                  {estimates.map((e, idx) => {
                    const margin = calcMargin(e.price, e.cost);
                    const isActive = idx === activeEstimateIdx;
                    return (
                      <div
                        key={e.id || idx}
                        onClick={() => setActiveEstimateIdx(idx)}
                        className={'tcm-version-row' + (isActive ? ' is-active' : '')}
                      >
                        <div className="row-spread">
                          <strong className="fs-13">v{e.version_no || idx + 1}</strong>
                          <StatusBadge
                            tone={e.approval_status === 'approved' ? 'approved' : e.approval_status === 'rejected' ? 'rejected' : e.approval_status === 'sent' ? 'sent' : 'draft'}
                            label={e.approval_status || 'draft'}
                          />
                        </div>
                        <div className="tcm-version-meta">
                          <span>💰 {fmtMoney(e.price)}</span>
                          <span>📉 {fmtMoney(e.cost)}</span>
                          <span>📊 Маржа: <strong style={{ color: margin < 5 ? 'var(--err)' : margin < 15 ? 'var(--amber)' : 'var(--ok)' }}>{margin == null ? '—' : margin.toFixed(1) + '%'}</strong></span>
                          <span>{e.created_at && fmtDate(e.created_at)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* Форма редактирования */}
            {editing && editForm && (
              <div className="tcm-edit-form">
                <div className="fs-12 muted">Версия #{editForm.version_no}</div>
                <Field label="Цена">
                  <MoneyInput value={editForm.price} onChange={(v) => setEditForm({ ...editForm, price: v })} />
                </Field>
                <Field label="Себестоимость">
                  <MoneyInput value={editForm.cost} onChange={(v) => setEditForm({ ...editForm, cost: v })} />
                </Field>
                <div className="grid-2 gap-8">
                  <Field label="Человек">
                    <NumberInput value={editForm.people || ''} onChange={(v) => setEditForm({ ...editForm, people: v })} min={1} />
                  </Field>
                  <Field label="Дней">
                    <NumberInput value={editForm.days || ''} onChange={(v) => setEditForm({ ...editForm, days: v })} min={1} />
                  </Field>
                </div>
                <Field label="Вероятность %">
                  <NumberInput value={editForm.probability} onChange={(v) => setEditForm({ ...editForm, probability: v })} min={0} max={100} />
                </Field>
                <Field label="Сопроводительное письмо" help="Обязательно при отправке на согласование">
                  <TextareaInput value={editForm.cover_letter || ''} onChange={(v) => setEditForm({ ...editForm, cover_letter: v })} minRows={2} maxRows={4} />
                </Field>
                <Field label="Заметка для коллег">
                  <TextareaInput value={editForm.note || ''} onChange={(v) => setEditForm({ ...editForm, note: v })} minRows={1} maxRows={3} />
                </Field>

                {/* requires_payment — паритет с vanilla pm_calcs.js:1027-1031 */}
                <Field label="" help="Если включено — после согласования директора смета уйдёт в бухгалтерию">
                  <Checkbox
                    checked={!!editForm.requires_payment}
                    onChange={(v) => setEditForm({ ...editForm, requires_payment: v })}
                    label="Требуется оплата / участие бухгалтерии"
                  />
                </Field>

                {/* Превью KPI */}
                <div className="tcm-kpi-preview">
                  <span>Маржа: <strong>{(calcMargin(editForm.price, editForm.cost) ?? 0).toFixed(1)}%</strong></span>
                  <span>Прибыль: <strong>{fmtMoney((+editForm.price || 0) - (+editForm.cost || 0))}</strong></span>
                  <span>₽/чел·день: <strong>{fmtMoney(calcProfitPerManDay(editForm.price, editForm.cost, editForm.people, editForm.days) || 0)}</strong></span>
                </div>

                <div className="row-spread gap-6">
                  <Btn size="sm" onClick={() => setEditing(false)}>Отмена</Btn>
                  <div className="row gap-6">
                    <Btn size="sm" variant="ghost" disabled={busy} onClick={saveDraft}>💾 Сохранить черновик</Btn>
                    <Btn size="sm" variant="primary" disabled={busy} onClick={sendToApproval}>📤 На согласование</Btn>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Закрыть</Btn>
        <div className="row-wrap gap-6">
          {/* Финализация статуса — только для директора/ADMIN (vanilla pm_calcs.js:957) */}
          {canFinal && t.tender_status === 'ТКП согласовано' && (
            <Btn
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => finalizeStatus('КП отправлено')}
              title="Перевести тендер в «КП отправлено»"
            >
              📤 КП отправлено
            </Btn>
          )}
          {canFinal && t.tender_status === 'КП отправлено' && (
            <>
              <Btn size="sm" variant="primary" disabled={busy} onClick={() => finalizeStatus('Выиграли')}>🏆 Выиграли</Btn>
              <Btn size="sm" variant="ghost" disabled={busy} onClick={() => finalizeStatus('Проиграли')}>✕ Проиграли</Btn>
            </>
          )}
        </div>
      </MFoot>
    </MCard>
  );
}
