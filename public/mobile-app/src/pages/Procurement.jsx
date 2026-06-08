import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import AsgardSelect from '@/components/ui/AsgardSelect';
import { formatMoney, relativeTime } from '@/lib/utils';
import {
  ShoppingCart, Plus, ChevronRight, FileText, Copy, Send,
  Check, Package, Truck, Sparkles,
} from 'lucide-react';

// ─── Справочник статусов ────────────────────────────────────────────────────
const STATUS_MAP = {
  draft:               { label: 'Черновик',          color: 'var(--text-tertiary)' },
  sent_to_proc:        { label: 'У закупщика',        color: 'var(--blue)' },
  proc_responded:      { label: 'Ответ закупщика',    color: 'var(--gold)' },
  pm_approved:         { label: 'РП согласовал',      color: 'var(--green)' },
  dir_approved:        { label: 'Директор ✓',         color: 'var(--green)' },
  dir_rework:          { label: 'На доработке',       color: 'var(--gold)' },
  dir_question:        { label: 'Вопрос',             color: 'var(--gold)' },
  dir_rejected:        { label: 'Отклонена',          color: 'var(--red-soft)' },
  paid:                { label: 'Оплачено',           color: 'var(--blue)' },
  partially_delivered: { label: 'Частично',           color: 'var(--gold)' },
  delivered:           { label: 'Доставлено',         color: 'var(--green)' },
  closed:              { label: 'Закрыта',            color: 'var(--text-tertiary)' },
};

const PRIORITY_MAP = {
  low:    { label: 'Низкий',   color: 'var(--text-tertiary)' },
  normal: { label: 'Обычный',  color: 'var(--blue)' },
  high:   { label: 'Срочно',   color: 'var(--gold)' },
  urgent: { label: 'Очень срочно', color: 'var(--red-soft)' },
};

const FILTERS = [
  { id: 'all',          label: 'Все' },
  { id: 'sent_to_proc', label: 'У закупщика' },
  { id: 'proc_responded', label: 'Ответ' },
  { id: 'delivered',    label: 'Доставлено' },
];

const PM_ROLES = ['PM', 'HEAD_PM'];
const CAN_ADD_ITEM_ROLES = ['PM', 'HEAD_PM', 'PROC', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

// Извлечение текста из PDF/фото счёта (CDN pdf.js / Tesseract). Excel шлём файлом напрямую.
function loadScriptOnce(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[data-inv-lib="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.async = true; s.dataset.invLib = src;
    s.onload = () => res(); s.onerror = () => rej(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
}
async function extractInvoiceText(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') {
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    const pdfjs = window.pdfjsLib; if (!pdfjs) throw new Error('PDF-движок недоступен');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const buf = await file.arrayBuffer(); const doc = await pdfjs.getDocument({ data: buf }).promise; let text = '';
    for (let p = 1; p <= Math.min(doc.numPages, 15); p++) { const page = await doc.getPage(p); const tc = await page.getTextContent(); text += tc.items.map((i) => i.str).join(' ') + '\n'; }
    if (text.replace(/\s/g, '').length < 30) throw new Error('PDF без текста — сфотографируйте счёт');
    return text;
  }
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js');
  if (!window.Tesseract) throw new Error('OCR недоступен');
  const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = (e) => res(e.target.result); r.onerror = rej; r.readAsDataURL(file); });
  const out = await window.Tesseract.recognize(dataUrl, 'rus+eng');
  return (out && out.data && out.data.text) || '';
}

// ─── Главный экран ──────────────────────────────────────────────────────────
export default function Procurement() {
  const haptic = useHaptic();
  const [requests, setRequests]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState('all');
  const [detail, setDetail]         = useState(null); // { id } чтобы открыть детали
  const [showCreate, setShowCreate] = useState(false);
  const [userRole, setUserRole]     = useState(null);

  // Получаем роль один раз
  useEffect(() => {
    api.get('/api/users/me')
      .then((res) => {
        const u = res?.user || res;
        setUserRole(u?.role || null);
      })
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/procurement?limit=50');
      const rows = res?.items || api.extractRows(res) || [];
      setRequests(rows);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  const handleCardClick = (req) => {
    haptic.light();
    setDetail(req);
  };

  return (
    <PageShell
      title="Закупки"
      headerRight={
        <button
          onClick={() => { haptic.light(); setShowCreate(true); }}
          className="btn-icon spring-tap c-blue"
        >
          <Plus size={22} />
        </button>
      }
    >
      <PullToRefresh onRefresh={fetchData}>
        {/* Фильтры */}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => { haptic.light(); setFilter(f.id); }}
              className="filter-pill spring-tap"
              data-active={filter === f.id}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Список */}
        {loading ? (
          <SkeletonList count={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            iconColor="var(--blue)"
            iconBg="rgba(74,144,217,0.1)"
            title="Нет заявок"
            description="Заявки на закупку появятся здесь"
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((req, i) => {
              const st = STATUS_MAP[req.status] || STATUS_MAP.draft;
              const pr = PRIORITY_MAP[req.priority];
              return (
                <button
                  key={req.id}
                  onClick={() => handleCardClick(req)}
                  className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass"
                  style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">
                      {req.title || req.work_title || `Заявка #${req.id}`}
                    </p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>

                  {req.work_title && req.title && (
                    <p className="text-[12px] c-secondary mt-0.5 leading-tight">{req.work_title}</p>
                  )}

                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {/* Статус */}
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{
                        background: `color-mix(in srgb, ${st.color} 15%, transparent)`,
                        color: st.color,
                      }}
                    >
                      {st.label}
                    </span>

                    {/* Приоритет */}
                    {pr && req.priority !== 'normal' && (
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{
                          background: `color-mix(in srgb, ${pr.color} 15%, transparent)`,
                          color: pr.color,
                        }}
                      >
                        {pr.label}
                      </span>
                    )}

                    {/* Позиции */}
                    {Number(req.items_count) > 0 && (
                      <span className="text-[10px] c-secondary">{req.items_count} поз.</span>
                    )}

                    {/* Сумма */}
                    {Number(req.items_total || req.total_sum) > 0 && (
                      <span className="text-[10px] font-semibold c-gold">
                        {formatMoney(req.items_total || req.total_sum, { short: true })}
                      </span>
                    )}

                    {/* РП */}
                    {req.pm_name && (
                      <span className="text-[10px] c-tertiary">{req.pm_name}</span>
                    )}

                    {/* Время */}
                    {req.created_at && (
                      <span className="text-[10px] c-tertiary">{relativeTime(req.created_at)}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      {/* Детали заявки */}
      <ProcDetailSheet
        request={detail}
        onClose={() => setDetail(null)}
        userRole={userRole}
        onRefresh={fetchData}
      />

      {/* Создание заявки */}
      <CreateMethodSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={fetchData}
      />
    </PageShell>
  );
}

// ─── Детали заявки ──────────────────────────────────────────────────────────
function ProcDetailSheet({ request, onClose, userRole, onRefresh }) {
  const haptic = useHaptic();
  const [full, setFull]       = useState(null); // полные данные из /api/procurement/:id
  const [loading, setLoading] = useState(false);
  const [acting, setActing]   = useState(null); // 'send'|'approve'|'return'|'clone'|'template'
  const [showAddItem, setShowAddItem] = useState(false);
  const [tplName, setTplName] = useState('');
  const [showTplInput, setShowTplInput] = useState(false);
  const [invoice, setInvoice] = useState(null); // {import_id,matches,unmatched,items_for_match,supplier_*} результат парса
  const [invBusy, setInvBusy] = useState(false);
  const [invSupName, setInvSupName] = useState('');
  const [invDays, setInvDays] = useState('');
  const invFileRef = useRef(null);

  useEffect(() => {
    if (!request) { setFull(null); return; }
    setLoading(true);
    api.get(`/api/procurement/${request.id}`)
      .then((res) => setFull(res?.item ? res : { item: res, items: res.items || [], history: res.history || [] }))
      .catch(() => setFull(null))
      .finally(() => setLoading(false));
  }, [request]);

  if (!request) return null;

  const item    = full?.item || request;
  const items   = full?.items || [];
  const history = full?.history || [];
  const invoiceImports = full?.invoice_imports || [];
  const st      = STATUS_MAP[item.status] || STATUS_MAP.draft;
  const pr      = PRIORITY_MAP[item.priority];

  const DIR_ROLES2 = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];
  const isPM         = PM_ROLES.includes(userRole);
  const isPROC       = ['PROC', 'ADMIN'].includes(userRole);
  const isDIR        = DIR_ROLES2.includes(userRole);
  const isBUH        = ['BUH', 'ADMIN'].includes(userRole);
  const canAddItem   = CAN_ADD_ITEM_ROLES.includes(userRole) && item.status === 'draft';
  const hasItems     = items.length > 0;

  const canSend      = isPM && item.status === 'draft';
  const canApprove   = isPM && item.status === 'proc_responded';
  const canReturn    = isPM && item.status === 'proc_responded';
  // закупщик: проставить цены + ответить РП
  const canProcRespond = isPROC && item.status === 'sent_to_proc';
  // директор: согласование с телефона (главное)
  const canDirAct    = isDIR && item.status === 'pm_approved';
  // бухгалтер: оплата
  const canMarkPaid  = isBUH && item.status === 'dir_approved';

  const doAction = async (endpoint, label, body) => {
    haptic.light();
    setActing(endpoint);
    try {
      await api.put(`/api/procurement/${item.id}/${endpoint}`, body || {});
      haptic.success();
      const res = await api.get(`/api/procurement/${item.id}`);
      setFull(res?.item ? res : { item: res, items: res.items || [], history: res.history || [] });
      onRefresh();
    } catch {
      haptic.error();
    } finally {
      setActing(null);
    }
  };
  const doActionAsk = (endpoint, label, promptText) => {
    const c = window.prompt(promptText || 'Комментарий:');
    if (c === null) return; // отмена
    doAction(endpoint, label, { comment: c });
  };

  // 🧾 Загрузка счёта с телефона: Excel — сразу; PDF/фото — текст распознаётся в браузере → AI.
  const onInvoiceFile = async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    e.target.value = '';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    setInvBusy(true); haptic.light();
    try {
      let res;
      if (ext === 'xlsx' || ext === 'xls') {
        const fd = new FormData();
        if (invSupName.trim()) fd.append('supplier_name', invSupName.trim());
        if (invDays) fd.append('delivery_days', invDays);
        fd.append('file', file);
        res = await api.postForm(`/procurement/${item.id}/invoice/parse`, fd);
      } else {
        const text = await extractInvoiceText(file);
        res = await api.post(`/procurement/${item.id}/invoice/parse`, { text, supplier_name: invSupName.trim() || null, delivery_days: invDays || null });
      }
      if (res.ai_unavailable) { window.alert(res.message || 'AI недоступен'); setInvBusy(false); return; }
      setInvoice({ ...res, rows: [...(res.matches || []).map((m) => ({ item_id: m.item_id, invoice_name: m.invoice_name, confidence: m.confidence, unit_price: m.unit_price })),
        ...(res.unmatched || []).map((u) => ({ item_id: '', invoice_name: u.invoice_name, confidence: 0, unit_price: u.unit_price, isNew: true }))] });
      haptic.success();
    } catch (err) { haptic.error(); window.alert('Ошибка: ' + (err.message || err)); }
    finally { setInvBusy(false); }
  };
  const applyInvoice = async () => {
    if (!invoice) return;
    const rows = invoice.rows.filter((r) => r.item_id && (parseFloat(r.unit_price) > 0)).map((r) => ({ item_id: +r.item_id, unit_price: parseFloat(r.unit_price) }));
    if (!rows.length) { window.alert('Нет строк с привязкой и ценой'); return; }
    setInvBusy(true);
    try {
      const res = await api.post(`/procurement/${item.id}/invoice/${invoice.import_id}/apply`, { rows, supplier_id: invoice.supplier_id, supplier_name: invoice.supplier_name || invSupName.trim() || null, delivery_days: invoice.delivery_days || invDays || null });
      haptic.success(); setInvoice(null); setInvSupName(''); setInvDays('');
      const r = await api.get(`/api/procurement/${item.id}`);
      setFull(r?.item ? r : { item: r, items: r.items || [], history: r.history || [] });
      onRefresh();
      window.alert(`Цены проставлены: ${res.applied}`);
    } catch (err) { haptic.error(); window.alert('Ошибка: ' + (err.message || err)); }
    finally { setInvBusy(false); }
  };

  const doClone = async () => {
    haptic.light();
    setActing('clone');
    try {
      await api.post(`/api/procurement/${item.id}/clone`, {});
      haptic.success();
      onClose();
      onRefresh();
    } catch {
      haptic.error();
    } finally {
      setActing(null);
    }
  };

  const doSaveTemplate = async () => {
    if (!tplName.trim()) return;
    haptic.light();
    setActing('template');
    try {
      await api.post(`/api/procurement/templates/from-request/${item.id}`, { name: tplName.trim() });
      haptic.success();
      setShowTplInput(false);
      setTplName('');
    } catch {
      haptic.error();
    } finally {
      setActing(null);
    }
  };

  const metaFields = [
    { label: 'Статус', value: st.label, color: st.color },
    pr && item.priority !== 'normal' && { label: 'Приоритет', value: pr.label, color: pr.color },
    item.work_title   && { label: 'Работа',     value: item.work_title },
    item.customer_name && { label: 'Заказчик',  value: item.customer_name },
    item.pm_name      && { label: 'РП',         value: item.pm_name },
    item.proc_name    && { label: 'Закупщик',   value: item.proc_name },
    item.delivery_deadline && { label: 'Дедлайн', value: relativeTime(item.delivery_deadline) },
    (item.items_total || item.total_sum) > 0 && {
      label: 'Сумма',
      value: formatMoney(item.items_total || item.total_sum),
    },
    item.paid_at      && { label: 'Оплачено',   value: relativeTime(item.paid_at) },
    item.delivered_at && { label: 'Доставлено', value: relativeTime(item.delivered_at) },
  ].filter(Boolean);

  return (
    <BottomSheet open={!!request} onClose={onClose} title={item.title || item.work_title || `Заявка #${item.id}`}>
      {loading ? (
        <SkeletonList count={3} />
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          {/* Мета-поля */}
          <div className="flex flex-col gap-2.5">
            {metaFields.map((f, i) => (
              <div key={i}>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>
                {f.color ? (
                  <span
                    className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block"
                    style={{
                      background: `color-mix(in srgb, ${f.color} 15%, transparent)`,
                      color: f.color,
                    }}
                  >
                    {f.value}
                  </span>
                ) : (
                  <p className="text-[14px] c-primary">{f.value}</p>
                )}
              </div>
            ))}
          </div>

          {/* Позиции */}
          {hasItems && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 c-tertiary">
                Позиции ({items.length})
              </p>
              <div className="flex flex-col gap-1.5">
                {items.map((it, i) => {
                  const itSt = it.item_status
                    ? (STATUS_MAP[it.item_status] || null)
                    : null;
                  return (
                    <div
                      key={it.id || i}
                      className="rounded-xl px-3 py-2"
                      style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium c-primary leading-tight truncate">
                            {it.name}
                            {it.article ? <span className="c-tertiary text-[11px] ml-1">({it.article})</span> : null}
                          </p>
                          <p className="text-[11px] c-secondary mt-0.5">
                            {it.quantity} {it.unit}
                            {it.supplier ? <span className="c-tertiary"> · {it.supplier}</span> : null}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {Number(it.total_price) > 0 && (
                            <p className="text-[13px] font-semibold c-gold">
                              {formatMoney(it.total_price, { short: true })}
                            </p>
                          )}
                          {Number(it.unit_price) > 0 && (
                            <p className="text-[10px] c-tertiary">
                              {formatMoney(it.unit_price, { short: true })} / {it.unit}
                            </p>
                          )}
                          {itSt && (
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                              style={{
                                background: `color-mix(in srgb, ${itSt.color} 15%, transparent)`,
                                color: itSt.color,
                              }}
                            >
                              {itSt.label}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Добавить позицию */}
          {canAddItem && (
            <div>
              {showAddItem ? (
                <AddItemForm
                  procId={item.id}
                  onDone={async () => {
                    setShowAddItem(false);
                    const res = await api.get(`/api/procurement/${item.id}`);
                    setFull(res?.item ? res : { item: res, items: res.items || [], history: res.history || [] });
                    onRefresh();
                  }}
                  onCancel={() => setShowAddItem(false)}
                />
              ) : (
                <button
                  onClick={() => { haptic.light(); setShowAddItem(true); }}
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] font-semibold c-blue spring-tap flex items-center justify-center gap-1.5"
                  style={{ border: '1.5px dashed var(--blue)', background: 'rgba(74,144,217,0.06)' }}
                >
                  <Plus size={15} /> Добавить позицию
                </button>
              )}
            </div>
          )}

          {/* Действия по статусу */}
          {(canSend || canApprove || canReturn) && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider c-tertiary">Действия</p>
              {canSend && (
                <button
                  onClick={() => doAction('send-to-proc', 'Отправить')}
                  disabled={acting === 'send-to-proc'}
                  className="btn-primary spring-tap flex items-center justify-center gap-2"
                >
                  <Send size={16} />
                  {acting === 'send-to-proc' ? 'Отправляю...' : 'Отправить закупщику'}
                </button>
              )}
              {canApprove && (
                <button
                  onClick={() => doAction('pm-approve', 'Согласовать')}
                  disabled={acting === 'pm-approve'}
                  className="btn-primary spring-tap flex items-center justify-center gap-2"
                >
                  <Check size={16} />
                  {acting === 'pm-approve' ? 'Согласовываю...' : 'Согласовать'}
                </button>
              )}
              {canReturn && (
                <button
                  onClick={() => doAction('return-to-proc', 'Вернуть')}
                  disabled={acting === 'return-to-proc'}
                  className="spring-tap flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold"
                  style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-secondary)' }}
                >
                  {acting === 'return-to-proc' ? 'Возвращаю...' : 'Вернуть закупщику'}
                </button>
              )}
            </div>
          )}

          {/* ЗАКУПЩИК: загрузить счёт → авто-цены + ответить РП */}
          {canProcRespond && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider c-tertiary">Закупщик</p>
              {!invoice && (
                <>
                  <div className="flex gap-2">
                    <input value={invSupName} onChange={(e) => setInvSupName(e.target.value)} placeholder="Поставщик (опц.)"
                      className="flex-1 rounded-xl px-3 py-2 text-[13px]" style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)', color: 'var(--text-primary)' }} />
                    <input value={invDays} onChange={(e) => setInvDays(e.target.value.replace(/\D/g, ''))} placeholder="срок,дн" inputMode="numeric"
                      className="w-20 rounded-xl px-3 py-2 text-[13px]" style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)', color: 'var(--text-primary)' }} />
                  </div>
                  <input ref={invFileRef} type="file" accept=".xlsx,.xls,.pdf,image/*" capture="environment" onChange={onInvoiceFile} style={{ display: 'none' }} />
                  <button onClick={() => invFileRef.current?.click()} disabled={invBusy}
                    className="spring-tap flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold"
                    style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                    <FileText size={16} /> {invBusy ? 'Разбираю счёт…' : '🧾 Загрузить счёт (фото/Excel)'}
                  </button>
                </>
              )}
              {invoice && (
                <div className="rounded-xl p-2" style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}>
                  <p className="text-[12px] font-semibold mb-1.5">Сопоставление ({(invoice.matches || []).length} авто, {(invoice.unmatched || []).length} вручную)</p>
                  <div className="flex flex-col gap-1.5" style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {invoice.rows.map((row, i) => (
                      <div key={i} className="rounded-lg p-2" style={{ background: row.isNew ? 'rgba(224,168,0,.08)' : 'var(--bg-surface)', border: '0.5px solid var(--border-norse)' }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-medium truncate">{row.invoice_name}</span>
                          <span className="text-[10px] flex-shrink-0" style={{ color: row.confidence >= 0.8 ? 'var(--green)' : row.confidence >= 0.5 ? 'var(--accent-gold)' : 'var(--text-tertiary)' }}>
                            {row.confidence ? Math.round(row.confidence * 100) + '%' : 'не найдено'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <select value={row.item_id || ''} onChange={(e) => { const v = e.target.value; setInvoice((s) => ({ ...s, rows: s.rows.map((r, j) => j === i ? { ...r, item_id: v } : r) })); }}
                            className="flex-1 rounded-lg px-2 py-1 text-[12px]" style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                            <option value="">— не привязывать —</option>
                            {(invoice.items_for_match || []).map((it) => (<option key={it.id} value={it.id}>{it.name}{it.has_price ? ' ✓' : ''}</option>))}
                          </select>
                          <input type="number" value={row.unit_price != null ? row.unit_price : ''} placeholder="цена" inputMode="decimal"
                            onChange={(e) => { const v = e.target.value; setInvoice((s) => ({ ...s, rows: s.rows.map((r, j) => j === i ? { ...r, unit_price: v } : r) })); }}
                            className="w-20 rounded-lg px-2 py-1 text-[12px]" style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)', color: 'var(--text-primary)' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => setInvoice(null)} className="flex-1 spring-tap rounded-xl px-3 py-2 text-[13px] font-semibold" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>Отмена</button>
                    <button onClick={applyInvoice} disabled={invBusy} className="btn-primary flex-1 spring-tap rounded-xl px-3 py-2 text-[13px] font-semibold">{invBusy ? '…' : '✅ Применить цены'}</button>
                  </div>
                </div>
              )}
              <button
                onClick={() => doAction('proc-respond', 'Ответить')}
                disabled={acting === 'proc-respond'}
                className="btn-primary spring-tap flex items-center justify-center gap-2"
              >
                <Check size={16} />
                {acting === 'proc-respond' ? 'Отправляю...' : 'Ответить РП'}
              </button>
            </div>
          )}

          {/* ДИРЕКТОР: согласование с телефона */}
          {canDirAct && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider c-tertiary">Согласование (директор)</p>
              <button
                onClick={() => doAction('dir-approve', 'Согласовать')}
                disabled={!!acting}
                className="btn-primary spring-tap flex items-center justify-center gap-2"
                style={{ background: 'var(--green)', color: '#04210d' }}
              >
                <Check size={16} />
                {acting === 'dir-approve' ? 'Согласовываю...' : '✓ Согласовать'}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => doActionAsk('dir-rework', 'Доработка', 'Что доработать?')}
                  disabled={!!acting}
                  className="flex-1 spring-tap rounded-xl px-3 py-2.5 text-[13px] font-semibold"
                  style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-secondary)' }}
                >↩ Доработка</button>
                <button
                  onClick={() => doActionAsk('dir-question', 'Вопрос', 'Ваш вопрос:')}
                  disabled={!!acting}
                  className="flex-1 spring-tap rounded-xl px-3 py-2.5 text-[13px] font-semibold"
                  style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-secondary)' }}
                >❓ Вопрос</button>
              </div>
              <button
                onClick={() => doActionAsk('dir-reject', 'Отклонить', 'Причина отклонения:')}
                disabled={!!acting}
                className="spring-tap rounded-xl px-3 py-2.5 text-[13px] font-semibold"
                style={{ background: 'rgba(255,92,92,.14)', color: 'var(--red)' }}
              >✕ Отклонить</button>
            </div>
          )}

          {/* БУХГАЛТЕР: оплата */}
          {canMarkPaid && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider c-tertiary">Бухгалтерия</p>
              <button
                onClick={() => doAction('mark-paid', 'Оплачено')}
                disabled={acting === 'mark-paid'}
                className="btn-primary spring-tap flex items-center justify-center gap-2"
              >
                💳 {acting === 'mark-paid' ? 'Отмечаю...' : 'Отметить оплаченным'}
              </button>
            </div>
          )}

          {/* Утилиты: повторить / в шаблон */}
          {hasItems && (
            <div className="flex gap-2">
              <button
                onClick={doClone}
                disabled={acting === 'clone'}
                className="flex-1 spring-tap rounded-xl px-3 py-2.5 text-[13px] font-semibold flex items-center justify-center gap-1.5"
                style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)', color: 'var(--text-primary)' }}
              >
                <Copy size={14} />
                {acting === 'clone' ? 'Копирую...' : 'Повторить'}
              </button>

              {!showTplInput ? (
                <button
                  onClick={() => { haptic.light(); setShowTplInput(true); }}
                  className="flex-1 spring-tap rounded-xl px-3 py-2.5 text-[13px] font-semibold flex items-center justify-center gap-1.5"
                  style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)', color: 'var(--text-primary)' }}
                >
                  <FileText size={14} />
                  В шаблон
                </button>
              ) : (
                <div className="flex-1 flex gap-1.5">
                  <input
                    type="text"
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    placeholder="Название шаблона"
                    className="input-field flex-1 text-[12px] py-2"
                    autoFocus
                  />
                  <button
                    onClick={doSaveTemplate}
                    disabled={!tplName.trim() || acting === 'template'}
                    className="btn-icon spring-tap c-gold"
                  >
                    <Check size={16} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Счета поставщиков (для директора при согласовании + бухгалтера при оплате) */}
          {invoiceImports.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 c-tertiary">
                🧾 Счета поставщиков ({invoiceImports.length})
              </p>
              <div className="flex flex-col gap-1.5">
                {invoiceImports.map((iv, i) => (
                  <div key={i} className="rounded-xl px-3 py-2" style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold c-primary">{iv.supplier_name || 'Поставщик'}</p>
                      {iv.total_sum != null && <span className="text-[12px] c-secondary">{Number(iv.total_sum).toLocaleString('ru-RU')} ₽</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] c-tertiary flex-wrap">
                      {iv.delivery_days ? <span>срок {iv.delivery_days} дн</span> : null}
                      <span>{iv.matched_count || 0} поз.</span>
                      {iv.file_path && <a href={iv.file_path} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-gold)' }}>📎 {iv.file_name || 'файл'}</a>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* История */}
          {history.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 c-tertiary">
                История
              </p>
              <div className="flex flex-col gap-1.5">
                {history.map((h, i) => (
                  <div
                    key={i}
                    className="rounded-xl px-3 py-2"
                    style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12px] font-semibold c-primary">{h.action}</p>
                      <span className="text-[10px] c-tertiary flex-shrink-0">{relativeTime(h.created_at)}</span>
                    </div>
                    {h.actor_name && (
                      <p className="text-[11px] c-secondary mt-0.5">{h.actor_name}</p>
                    )}
                    {h.comment && (
                      <p className="text-[11px] c-tertiary mt-0.5 italic">«{h.comment}»</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

// ─── Добавить позицию (мини-форма) ─────────────────────────────────────────
function AddItemForm({ procId, onDone, onCancel }) {
  const haptic = useHaptic();
  const [name, setName]     = useState('');
  const [qty, setQty]       = useState('');
  const [unit, setUnit]     = useState('шт');
  const [hint, setHint]     = useState(null);
  const [catalog, setCatalog] = useState([]); // витрина: товары с остатком
  const [productId, setProductId] = useState(null);
  const [available, setAvailable] = useState(null);
  const [saving, setSaving] = useState(false);
  const debounceRef         = useRef(null);
  const catRef              = useRef(null);

  const fetchHint = useCallback((val) => {
    clearTimeout(debounceRef.current);
    if (!val.trim() || val.trim().length < 3) { setHint(null); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get(`/api/price-records/hint?name=${encodeURIComponent(val.trim())}`);
        if (res?.last || res?.stats) setHint(res); else setHint(null);
      } catch { setHint(null); }
    }, 400);
  }, []);

  // Витрина каталога: подсказки товаров с остатком при вводе
  const fetchCatalog = useCallback((val) => {
    clearTimeout(catRef.current);
    if (!val.trim() || val.trim().length < 2) { setCatalog([]); return; }
    catRef.current = setTimeout(async () => {
      try {
        const res = await api.get(`/api/products/catalog-procurement?search=${encodeURIComponent(val.trim())}&limit=8`);
        setCatalog((res?.items || []).slice(0, 8));
      } catch { setCatalog([]); }
    }, 350);
  }, []);

  const handleNameChange = (v) => {
    setName(v); setProductId(null); setAvailable(null);
    fetchHint(v); fetchCatalog(v);
  };

  const pickCatalog = (it) => {
    setName(it.name); setUnit(it.unit || 'шт'); setProductId(it.product_id || it.id || null);
    setAvailable(Number(it.available_qty) || 0); setCatalog([]);
    if (it.last_price) setHint({ last: { unit_price: it.last_price, supplier_name: it.last_supplier } });
  };

  const handleSubmit = async () => {
    if (!name.trim() || !qty) return;
    haptic.light();
    setSaving(true);
    try {
      await api.post(`/api/procurement/${procId}/items`, {
        name: name.trim(),
        quantity: Number(qty),
        unit: unit.trim() || 'шт',
        ...(productId ? { product_id: productId } : {}),
      });
      haptic.success();
      onDone();
    } catch {
      haptic.error();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-2xl px-3 py-3 flex flex-col gap-2"
      style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider c-tertiary">Новая позиция</p>

      {/* Название */}
      <div>
        <label className="input-label">Наименование *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Кабель ВВГнг 3x2.5..."
          className="input-field"
          autoFocus
        />
        {/* Витрина каталога — выбор из имеющегося/покупавшегося */}
        {catalog.length > 0 && (
          <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)', background: 'var(--bg-surface)' }}>
            {catalog.map((it, i) => (
              <button key={i} onClick={() => pickCatalog(it)}
                className="w-full text-left px-2.5 py-2 flex items-center justify-between active:opacity-70"
                style={{ borderTop: i ? '0.5px solid var(--border-norse)' : 'none' }}>
                <span className="text-[13px] c-primary truncate">{it.name}</span>
                <span className="text-[11px] flex-shrink-0 ml-2" style={{ color: Number(it.available_qty) > 0 ? 'var(--c-green,#30d158)' : 'var(--c-tertiary)' }}>
                  {Number(it.available_qty) > 0 ? `${Number(it.available_qty)} ${it.unit || ''}` : 'нет'}{it.last_price ? ` · ${formatMoney(it.last_price)}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
        {/* Наличие выбранной позиции + докупить */}
        {available != null && (
          <div className="mt-1 px-2.5 py-1.5 rounded-xl text-[11px]" style={{ background: 'rgba(48,209,88,0.08)' }}>
            На складе: <b>{available}</b> {unit}
            {qty && Number(qty) > available && <span className="c-gold"> · докупить {Math.max(0, Number(qty) - available)}</span>}
          </div>
        )}
        {/* Подсказка цены */}
        {hint && (
          <div
            className="mt-1 px-2.5 py-1.5 rounded-xl text-[11px] flex flex-col gap-0.5"
            style={{ background: 'rgba(255,193,7,0.07)', border: '0.5px solid rgba(255,193,7,0.25)' }}
          >
            {hint.last && (
              <p className="c-gold font-semibold">
                Последняя цена: {formatMoney(hint.last.unit_price)}
                {hint.last.supplier_name && <span className="c-tertiary font-normal"> · {hint.last.supplier_name}</span>}
              </p>
            )}
            {hint.stats && hint.stats.sample_count > 1 && (
              <p className="c-secondary">
                Среднее {formatMoney(hint.stats.avg_price)} · от {formatMoney(hint.stats.min_price)} ({hint.stats.sample_count} покупок)
              </p>
            )}
          </div>
        )}
      </div>

      {/* Кол-во + ед. */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="input-label">Количество *</label>
          <input
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            className="input-field"
            inputMode="decimal"
          />
        </div>
        <div className="w-20">
          <label className="input-label">Ед.</label>
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="шт"
            className="input-field"
          />
        </div>
      </div>

      {/* Кнопки */}
      <div className="flex gap-2 mt-1">
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || !qty || saving}
          className="flex-1 btn-primary spring-tap text-[13px]"
        >
          {saving ? 'Добавляю...' : 'Добавить'}
        </button>
        <button
          onClick={onCancel}
          className="spring-tap rounded-xl px-4 py-2.5 text-[13px] font-semibold c-secondary"
          style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

// ─── Выбор способа создания ─────────────────────────────────────────────────
function CreateMethodSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [method, setMethod] = useState(null); // 'text'|'template'|'manual'

  const handleClose = () => {
    setMethod(null);
    onClose();
  };

  const handleCreated = () => {
    setMethod(null);
    onCreated();
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title={method ? (method === 'text' ? 'Новая заявка списком' : method === 'template' ? 'Из шаблона' : method === 'ai' ? 'AI по ТЗ' : 'Вручную') : 'Создать заявку'}
    >
      {/* Выбор метода */}
      {!method && (
        <div className="flex flex-col gap-3 pb-4">
          <p className="text-[13px] c-secondary text-center mb-1">Выберите способ создания</p>

          <button
            onClick={() => { haptic.light(); setMethod('text'); }}
            className="spring-tap rounded-2xl px-4 py-4 text-left card-glass"
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(74,144,217,0.12)' }}
              >
                <FileText size={20} style={{ color: 'var(--blue)' }} />
              </div>
              <div>
                <p className="text-[15px] font-semibold c-primary">Списком</p>
                <p className="text-[12px] c-secondary mt-0.5 leading-snug">
                  Вводите позиции по одной на строку — система сама разберёт название, кол-во и ед. измерения
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => { haptic.light(); setMethod('ai'); }}
            className="spring-tap rounded-2xl px-4 py-4 text-left card-glass"
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(168,85,247,0.12)' }}
              >
                <Sparkles size={20} style={{ color: '#a855f7' }} />
              </div>
              <div>
                <p className="text-[15px] font-semibold c-primary">AI по техзаданию</p>
                <p className="text-[12px] c-secondary mt-0.5 leading-snug">
                  Вставьте ТЗ или описание работ — AI сам выделит позиции для закупки
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => { haptic.light(); setMethod('template'); }}
            className="spring-tap rounded-2xl px-4 py-4 text-left card-glass"
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(255,193,7,0.12)' }}
              >
                <Package size={20} style={{ color: 'var(--gold)' }} />
              </div>
              <div>
                <p className="text-[15px] font-semibold c-primary">Из шаблона / повторить</p>
                <p className="text-[12px] c-secondary mt-0.5 leading-snug">
                  Использовать сохранённый шаблон или повторить прошлую заявку
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => { haptic.light(); setMethod('manual'); }}
            className="spring-tap rounded-2xl px-4 py-4 text-left card-glass"
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(16,185,129,0.12)' }}
              >
                <Truck size={20} style={{ color: 'var(--green)' }} />
              </div>
              <div>
                <p className="text-[15px] font-semibold c-primary">Вручную</p>
                <p className="text-[12px] c-secondary mt-0.5 leading-snug">
                  Создать пустую заявку и добавлять позиции по одной, с подсказками цен
                </p>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Форма «Списком» */}
      {method === 'text' && (
        <CreateByTextForm onCreated={handleCreated} onBack={() => setMethod(null)} />
      )}

      {/* Форма «AI по ТЗ» */}
      {method === 'ai' && (
        <CreateByAIForm onCreated={handleCreated} onBack={() => setMethod(null)} />
      )}

      {/* Форма «Из шаблона» */}
      {method === 'template' && (
        <CreateFromTemplateForm onCreated={handleCreated} onBack={() => setMethod(null)} />
      )}

      {/* Форма «Вручную» */}
      {method === 'manual' && (
        <CreateManualForm onCreated={handleCreated} onBack={() => setMethod(null)} />
      )}
    </BottomSheet>
  );
}

// ─── Хук: список работ ──────────────────────────────────────────────────────
function useWorks() {
  const [works, setWorks] = useState([]);
  useEffect(() => {
    api.get('/api/works?limit=200')
      .then((res) => {
        const rows = res?.items || api.extractRows(res) || [];
        setWorks(rows.map((w) => ({ value: w.id, label: w.work_title || `Работа #${w.id}` })));
      })
      .catch(() => {});
  }, []);
  return works;
}

// ─── Форма «Списком» ────────────────────────────────────────────────────────
function CreateByTextForm({ onCreated, onBack }) {
  const haptic  = useHaptic();
  const works   = useWorks();
  const [workId, setWorkId]     = useState('');
  const [title, setTitle]       = useState('');
  const [itemsText, setItemsText] = useState('');
  const [priority, setPriority] = useState('normal');
  const [saving, setSaving]     = useState(false);
  const [result, setResult]     = useState(null); // { count }

  const priorityOpts = Object.entries(PRIORITY_MAP).map(([v, m]) => ({ value: v, label: m.label }));

  const handleSubmit = async () => {
    if (!workId || !title.trim() || !itemsText.trim()) return;
    haptic.light();
    setSaving(true);
    try {
      // 1. Создаём заявку
      const createRes = await api.post('/api/procurement', {
        title: title.trim(),
        work_id: Number(workId),
        priority,
        notes: '',
      });
      const newId = createRes?.item?.id || createRes?.id;

      // 2. Импортируем позиции из текста
      const importRes = await api.post(`/api/procurement/${newId}/items/import-text`, {
        text: itemsText.trim(),
      });
      const count = importRes?.count ?? importRes?.items?.length ?? 0;

      haptic.success();
      setResult({ count, id: newId });
    } catch {
      haptic.error();
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <div className="flex flex-col items-center gap-4 pb-4 pt-2">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(16,185,129,0.12)' }}
        >
          <Check size={32} style={{ color: 'var(--green)' }} />
        </div>
        <div className="text-center">
          <p className="text-[16px] font-semibold c-primary">Заявка создана!</p>
          <p className="text-[13px] c-secondary mt-1">
            Добавлено позиций: <strong>{result.count}</strong>
          </p>
        </div>
        <button onClick={onCreated} className="btn-primary spring-tap w-full">Готово</button>
      </div>
    );
  }

  const valid = workId && title.trim() && itemsText.trim();
  return (
    <div className="flex flex-col gap-3 pb-4">
      <div>
        <label className="input-label">Работа *</label>
        <AsgardSelect
          options={works}
          value={workId}
          onChange={setWorkId}
          placeholder="Выберите работу..."
        />
      </div>

      <div>
        <label className="input-label">Название заявки *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Материалы для прокладки кабеля..."
          className="input-field"
        />
      </div>

      <div>
        <label className="input-label">Позиции (по одной на строку) *</label>
        <textarea
          value={itemsText}
          onChange={(e) => setItemsText(e.target.value)}
          placeholder={'10 мешков цемента\nКабель ВВГнг 3x2.5 50м\nАвтомат ABB 25A 3шт'}
          rows={6}
          className="input-field resize-none font-mono text-[13px]"
        />
        <p className="text-[11px] c-tertiary mt-1">
          Система сама разберёт название, кол-во и единицу
        </p>
      </div>

      <div>
        <label className="input-label">Приоритет</label>
        <AsgardSelect
          options={priorityOpts}
          value={priority}
          onChange={setPriority}
          placeholder="Обычный"
        />
      </div>

      <div className="flex gap-2 mt-1">
        <button
          onClick={handleSubmit}
          disabled={!valid || saving}
          className="flex-1 btn-primary spring-tap"
        >
          {saving ? 'Создаю...' : 'Создать заявку'}
        </button>
        <button
          onClick={onBack}
          className="spring-tap rounded-xl px-4 py-2.5 text-[14px] font-semibold c-secondary"
          style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}
        >
          Назад
        </button>
      </div>
    </div>
  );
}

// ─── Форма «AI по ТЗ» ───────────────────────────────────────────────────────
function CreateByAIForm({ onCreated, onBack }) {
  const haptic = useHaptic();
  const works  = useWorks();
  const [workId, setWorkId]   = useState('');
  const [title, setTitle]     = useState('');
  const [tz, setTz]           = useState('');
  const [priority, setPriority] = useState('normal');
  const [saving, setSaving]   = useState(false);
  const [info, setInfo]       = useState('');
  const [result, setResult]   = useState(null);

  const priorityOpts = Object.entries(PRIORITY_MAP).map(([v, m]) => ({ value: v, label: m.label }));

  const handleSubmit = async () => {
    if (!workId || !title.trim() || !tz.trim()) return;
    haptic.light();
    setSaving(true); setInfo('AI анализирует техзадание, это может занять до минуты...');
    try {
      const createRes = await api.post('/api/procurement', { title: title.trim(), work_id: Number(workId), priority, notes: '' });
      const newId = createRes?.item?.id || createRes?.id;
      const aiRes = await api.post(`/api/procurement/${newId}/items/ai-parse`, { text: tz.trim() });
      const count = aiRes?.count ?? 0;
      if (count > 0) { haptic.success(); setResult({ count, id: newId }); }
      else {
        // AI ничего не нашёл — заявка создана пустой, предложим заполнить вручную
        haptic.error();
        setInfo(aiRes?.message || 'AI не нашёл позиций. Заявка создана — добавьте позиции вручную.');
        setResult({ count: 0, id: newId, partial: true });
      }
    } catch {
      haptic.error();
      setInfo('AI недоступен. Попробуйте способ «Списком».');
    } finally { setSaving(false); }
  };

  if (result) {
    return (
      <div className="flex flex-col items-center gap-4 pb-4 pt-2">
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: result.partial ? 'rgba(255,193,7,0.12)' : 'rgba(16,185,129,0.12)' }}>
          {result.partial ? <Sparkles size={32} style={{ color: 'var(--gold)' }} /> : <Check size={32} style={{ color: 'var(--green)' }} />}
        </div>
        <div className="text-center">
          <p className="text-[16px] font-semibold c-primary">{result.partial ? 'Заявка создана' : 'AI разобрал ТЗ!'}</p>
          <p className="text-[13px] c-secondary mt-1">{result.partial ? info : <>AI добавил позиций: <strong>{result.count}</strong></>}</p>
        </div>
        <button onClick={onCreated} className="btn-primary spring-tap w-full">Готово</button>
      </div>
    );
  }

  const valid = workId && title.trim() && tz.trim();
  return (
    <div className="flex flex-col gap-3 pb-4">
      <div>
        <label className="input-label">Работа *</label>
        <AsgardSelect options={works} value={workId} onChange={setWorkId} placeholder="Выберите работу..." />
      </div>
      <div>
        <label className="input-label">Название заявки *</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Закупка по ТЗ..." className="input-field" />
      </div>
      <div>
        <label className="input-label">Техзадание / описание работ *</label>
        <textarea value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Вставьте текст ТЗ — AI выделит материалы и оборудование для закупки..." rows={7} className="input-field resize-none text-[13px]" />
        <p className="text-[11px] c-tertiary mt-1">AI выделит позиции (без цен). Цены подберёт закупщик.</p>
      </div>
      <div>
        <label className="input-label">Приоритет</label>
        <AsgardSelect options={priorityOpts} value={priority} onChange={setPriority} placeholder="Обычный" />
      </div>
      {saving && info && <p className="text-[12px] c-secondary text-center">{info}</p>}
      <div className="flex gap-2 mt-1">
        <button onClick={handleSubmit} disabled={!valid || saving} className="flex-1 btn-primary spring-tap">
          {saving ? 'AI анализирует...' : '🤖 Разобрать ТЗ'}
        </button>
        <button onClick={onBack} className="spring-tap rounded-xl px-4 py-2.5 text-[14px] font-semibold c-secondary" style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}>Назад</button>
      </div>
    </div>
  );
}

// ─── Форма «Из шаблона» ─────────────────────────────────────────────────────
function CreateFromTemplateForm({ onCreated, onBack }) {
  const haptic    = useHaptic();
  const works     = useWorks();
  const [templates, setTemplates]   = useState([]);
  const [loadingTpl, setLoadingTpl] = useState(true);
  const [selectedTpl, setSelectedTpl] = useState(null);
  const [workId, setWorkId]         = useState('');
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    setLoadingTpl(true);
    api.get('/api/procurement/templates')
      .then((res) => setTemplates(res?.items || api.extractRows(res) || []))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTpl(false));
  }, []);

  const handleCreate = async () => {
    if (!selectedTpl || !workId) return;
    haptic.light();
    setSaving(true);
    try {
      await api.post(`/api/procurement/from-template/${selectedTpl.id}`, { work_id: Number(workId) });
      haptic.success();
      onCreated();
    } catch {
      haptic.error();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-4">
      {loadingTpl ? (
        <SkeletonList count={3} />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={Package}
          iconColor="var(--gold)"
          iconBg="rgba(255,193,7,0.1)"
          title="Нет шаблонов"
          description="Сохраните заявку как шаблон, чтобы быстро повторять"
        />
      ) : (
        <>
          <p className="text-[12px] c-secondary">Выберите шаблон:</p>
          <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => { haptic.light(); setSelectedTpl(t); }}
                className="w-full text-left rounded-xl px-3 py-2.5 spring-tap"
                style={{
                  background: selectedTpl?.id === t.id
                    ? 'color-mix(in srgb, var(--gold) 12%, transparent)'
                    : 'var(--bg-surface-alt)',
                  border: `0.5px solid ${selectedTpl?.id === t.id ? 'var(--gold)' : 'var(--border-norse)'}`,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold c-primary truncate">{t.name}</p>
                    <p className="text-[11px] c-tertiary mt-0.5">
                      {t.items_count} поз.
                      {t.usage_count > 0 && ` · использован ${t.usage_count}×`}
                      {t.default_work_title && ` · ${t.default_work_title}`}
                    </p>
                  </div>
                  {selectedTpl?.id === t.id && <Check size={16} style={{ color: 'var(--gold)', flexShrink: 0 }} />}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {selectedTpl && (
        <div>
          <label className="input-label">Работа *</label>
          <AsgardSelect
            options={works}
            value={workId}
            onChange={setWorkId}
            placeholder="Выберите работу..."
          />
        </div>
      )}

      {selectedTpl && (
        <div className="flex gap-2 mt-1">
          <button
            onClick={handleCreate}
            disabled={!workId || saving}
            className="flex-1 btn-primary spring-tap"
          >
            {saving ? 'Создаю...' : 'Создать из шаблона'}
          </button>
          <button
            onClick={onBack}
            className="spring-tap rounded-xl px-4 py-2.5 text-[14px] font-semibold c-secondary"
            style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}
          >
            Назад
          </button>
        </div>
      )}

      {!selectedTpl && (
        <button
          onClick={onBack}
          className="spring-tap rounded-xl px-4 py-2.5 text-[14px] font-semibold c-secondary w-full"
          style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}
        >
          Назад
        </button>
      )}
    </div>
  );
}

// ─── Форма «Вручную» ─────────────────────────────────────────────────────────
function CreateManualForm({ onCreated, onBack }) {
  const haptic  = useHaptic();
  const works   = useWorks();
  const [workId, setWorkId]   = useState('');
  const [title, setTitle]     = useState('');
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [created, setCreated] = useState(null); // { id }

  const priorityOpts = Object.entries(PRIORITY_MAP).map(([v, m]) => ({ value: v, label: m.label }));

  const handleCreate = async () => {
    if (!workId || !title.trim()) return;
    haptic.light();
    setSaving(true);
    try {
      const res = await api.post('/api/procurement', {
        title: title.trim(),
        work_id: Number(workId),
        priority,
        notes: notes.trim() || null,
      });
      const newId = res?.item?.id || res?.id;
      haptic.success();
      setCreated({ id: newId });
    } catch {
      haptic.error();
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <div className="flex flex-col items-center gap-4 pb-4 pt-2">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(16,185,129,0.12)' }}
        >
          <Check size={32} style={{ color: 'var(--green)' }} />
        </div>
        <div className="text-center">
          <p className="text-[16px] font-semibold c-primary">Заявка создана!</p>
          <p className="text-[13px] c-secondary mt-1">
            Откройте её из списка, чтобы добавить позиции
          </p>
        </div>
        <button onClick={onCreated} className="btn-primary spring-tap w-full">Готово</button>
      </div>
    );
  }

  const valid = workId && title.trim();
  return (
    <div className="flex flex-col gap-3 pb-4">
      <div>
        <label className="input-label">Работа *</label>
        <AsgardSelect
          options={works}
          value={workId}
          onChange={setWorkId}
          placeholder="Выберите работу..."
        />
      </div>

      <div>
        <label className="input-label">Название заявки *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Материалы для электромонтажа..."
          className="input-field"
        />
      </div>

      <div>
        <label className="input-label">Приоритет</label>
        <AsgardSelect
          options={priorityOpts}
          value={priority}
          onChange={setPriority}
          placeholder="Обычный"
        />
      </div>

      <div>
        <label className="input-label">Примечание</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Доп. комментарий для закупщика..."
          rows={2}
          className="input-field resize-none"
        />
      </div>

      <div className="flex gap-2 mt-1">
        <button
          onClick={handleCreate}
          disabled={!valid || saving}
          className="flex-1 btn-primary spring-tap"
        >
          {saving ? 'Создаю...' : 'Создать заявку'}
        </button>
        <button
          onClick={onBack}
          className="spring-tap rounded-xl px-4 py-2.5 text-[14px] font-semibold c-secondary"
          style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}
        >
          Назад
        </button>
      </div>
    </div>
  );
}
