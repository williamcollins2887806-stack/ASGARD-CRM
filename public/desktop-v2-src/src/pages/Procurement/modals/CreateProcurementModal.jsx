/**
 * Модалка создания новой заявки.
 *
 * Шаги:
 *   1. (опц.) Выбор шаблона — POST /api/procurement/from-template/:tplId с work_id
 *   2. Ручное создание: title, work_id, priority, price_segment, budget_limit, notes
 *
 * Если workId задан (из карточки работы) — он фиксируется.
 * После создания опционально открывается витрина каталога (autoShowcase=true).
 *
 * Источник: openCreateModal в vanilla.
 */
import { useState, useEffect } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadWorks, loadTemplates, createProcurement, fromTemplate
} from '../api';
import {  openDetailModal } from './ProcurementDetail';
import { ShowcaseModal as _ShowcaseModal, openShowcaseModal } from './ShowcaseModal';

/** Открыть модалку создания заявки (1:1 с vanilla openCreateModal). */
export function openCreateModal(modal, workId, onCreated) {
  modal.open(<CreateProcurementModal workId={workId} autoShowcase onCreated={onCreated} />);
}
/** Алиас короткого имени (для соответствия vanilla `openCreate`). */
export function CreateModal(props) { return <CreateProcurementModal {...props} />; }

export function CreateProcurementModal({ workId, autoShowcase = true, onCreated }) {
  const { close, open } = useModal();
  const [works, setWorks] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [tplId, setTplId] = useState('');
  const [form, setForm] = useState({
    title: 'Заявка на закупку',
    work_id: workId ? String(workId) : '',
    priority: 'normal',
    price_segment: '',
    budget_limit: '',
    notes: ''
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([loadWorks(200), loadTemplates()])
      .then(([w, t]) => { setWorks(w); setTemplates(t); })
      .catch(() => {});
  }, []);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    if (!form.title.trim()) { toast.warn('Введите название'); return; }
    setBusy(true);
    try {
      const r = await createProcurement({
        title: form.title.trim(),
        work_id: form.work_id || null,
        priority: form.priority,
        price_segment: form.price_segment || null,
        budget_limit: parseFloat(form.budget_limit) || null,
        notes: form.notes || null
      });
      toast.success('Заявка #' + r.item.id + ' создана');
      onCreated?.(r.item);
      close();
      if (autoShowcase) {
        // openShowcaseModal принимает open-функцию первым параметром (НЕ объект modal).
        openShowcaseModal(open, r.item.id, () => onCreated?.(r.item));
      } else {
        // openDetailModal принимает modal-объект {open}.
        openDetailModal({ open }, r.item.id, onCreated);
      }
    } catch (e) { toast.error(e?.message || 'Ошибка'); setBusy(false); }
  };

  const submitFromTemplate = async () => {
    if (!tplId) { toast.warn('Выберите шаблон'); return; }
    setBusy(true);
    try {
      const r = await fromTemplate(tplId, form.work_id || null);
      toast.success('Создано из шаблона');
      onCreated?.(r.item);
      close();
      openDetailModal({ open }, r.item.id, onCreated);
    } catch (e) { toast.error(e?.message || 'Ошибка'); setBusy(false); }
  };

  const workOptions = [
    { value: '', label: '— без работы —' },
    ...works.map((w) => ({ value: String(w.id), label: w.work_title || ('#' + w.id) }))
  ];
  const lockedWork = workId ? works.find((w) => String(w.id) === String(workId)) : null;

  return (
    <MCard>
      <MHead icon="🛒" title="Новая заявка" accent="gold" onClose={close} />
      <MBody>
        {/* Из шаблона */}
        {templates.length > 0 && (
          <div className="proc-modal-info-box">
            <label className="proc-modal-info-label">
              📋 Создать из шаблона (для постоянных работ)
            </label>
            <select
              className="m-select proc-modal-input"
              value={tplId}
              onChange={(e) => setTplId(e.target.value)}
            >
              <option value="">— выберите шаблон —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.items_count || 0} поз.)</option>
              ))}
            </select>
            <Btn
              variant="ghost"
              size="sm"
              style={{ marginTop: 8, fontSize: 13 }}
              disabled={!tplId || busy}
              onClick={submitFromTemplate}
            >
              Создать из выбранного шаблона →
            </Btn>
            <div className="proc-modal-info-hint">
              — или создайте новую заявку вручную —
            </div>
          </div>
        )}

        <div className="proc-modal-stack">
          <label>
            <span className="proc-modal-label-sub">Название</span>
            <input className="m-input proc-modal-input" value={form.title} onChange={(e) => set('title', e.target.value)} />
          </label>

          {workId ? (
            <div className="proc-modal-work-locked">
              🔧 {(lockedWork?.work_title) || ('#' + workId)}
              <div className="proc-modal-work-locked-sub">работа определена автоматически</div>
            </div>
          ) : (
            <label>
              <span className="proc-modal-label-sub">Работа</span>
              <select className="m-select proc-modal-input" value={form.work_id} onChange={(e) => set('work_id', e.target.value)}>
                {workOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}

          <div className="proc-modal-grid-2">
            <label>
              <span className="proc-modal-label-sub">Приоритет</span>
              <select className="m-select proc-modal-input" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                <option value="normal">Обычный</option>
                <option value="high">Высокий</option>
                <option value="urgent">Срочный</option>
              </select>
            </label>
            <label>
              <span className="proc-modal-label-sub">Ценовой сегмент</span>
              <select className="m-select proc-modal-input" value={form.price_segment} onChange={(e) => set('price_segment', e.target.value)}>
                <option value="">— не указан —</option>
                <option value="cheap">💰 Подешевле</option>
                <option value="medium">⚖️ Средний</option>
                <option value="premium">⭐ Премиум</option>
              </select>
            </label>
          </div>

          <label>
            <span className="proc-modal-label-sub">Лимит бюджета, ₽ (необязательно)</span>
            <input
              className="m-input proc-modal-input" type="number" min="0"
              placeholder="—" value={form.budget_limit}
              onChange={(e) => set('budget_limit', e.target.value)}
            />
          </label>
          <label>
            <span className="proc-modal-label-sub">Примечание</span>
            <textarea
              className="m-textarea proc-modal-input" rows={3} value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </label>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {autoShowcase ? 'Создать и выбрать товары из каталога →' : 'Создать заявку'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
