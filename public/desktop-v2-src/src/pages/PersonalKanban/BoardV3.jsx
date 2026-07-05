/**
 * Канбан v3 — 9-колоночный вид «По воронке»
 *   📥 Новые → 🧮 Просчёт → ⚖️ На согласовании → 📋 КП готовится →
 *   📤 КП отправлено → ❓ Дозапрос → 🏆 Выиграно / ❌ Проиграно → 🏗 В работе
 *
 * Один файл: Board + Drawer + 5 модалок (Quick / Conductor / References / TKPConstructor / Send).
 * Реюз: useModal/Btn/toast из @/modals, токены theme.css.
 *
 * S-21 (Tenders-Hub Wave-7):
 *   • 9-я колонка 'addendum' (Дозапрос) между 'sent' и 'win' с pulse-анимацией
 *   • scope=auto|owner|to_personal|to_team|all + owner_id шлются в backend (S-9)
 *   • HEAD_TO toggle «Мои / Отдел» (localStorage 'pk3_v2_scope_to')
 *   • TO/HEAD_TO видят только tender-flow (flow-tabs скрыты, backend форсит)
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import {
  V3_COL_META, V3_COLUMNS, V3_STAGE_LABELS,
  loadV3Board, loadV3Counts, v3Transition, v3StartQuick, v3StartConductor,
  v3ConvertToPretender, v3SearchReferences,
  tkpFromCard, tkpLoadBlocks, tkpSaveBlocks, tkpRenderPdf, tkpAttachToCard, tkpSendToClient,
  patchCard,
} from './api';
// S-31.1 F-1: «＋ Создать вручную» теперь открывает реальный wizard (раньше — toast-stub).
import { TenderEditorModal } from '../Tenders/modals/TenderEditor.dispatch';
// 22.06.2026 P0-F2/F3: customer picker + noteboard (паритет с vanilla personal_kanban.js)
import NoteBoard from './NoteBoard';
import CustomerPicker from './CustomerPicker';
import CreateCustomerModal from './CreateCustomerModal';
import { FilePreviewModal } from '@/modals/FilePreview';

// 22.06.2026 P0-F1: шутки для click-guard на overlay (паритет с
// personal_kanban.js:3186-3199). Юзер случайно кликал на оверлей и терял работу.
const OVERLAY_JOKES = [
  'Эй, не клацай в пустоту 😅 Закрой крестиком',
  'Закрыть карту? Жми ✕ справа сверху, не лень же 🙃',
  'Тут пусто, как в холодильнике перед зарплатой 🥪 Жми ✕',
  'Тык-тык по воздуху не помогает. Крестик в углу 🎯',
  'Стой, куда! Карта закрывается только через ✕ 🛑',
];

const FLOW_TABS = [
  { id: 'all',         label: 'Все типы' },
  { id: 'application', label: '📥 Заявки' },
  { id: 'pre_tender',  label: '🗂 Пре-тендеры' },
  { id: 'tender',      label: '📋 Тендеры' },
  { id: 'work',        label: '🏗 Работы' },
];
// S-21: 9 стадий (addendum=5; win/lose/work сдвинулись на +1). Соответствует V3_STAGE_LABELS.
const COL_TO_STAGE = { new: 0, calc: 1, addendum: 2, kp_prep: 3, approval: 4, sent: 5, win: 6, lose: 7, work: 8 };

// S-21: localStorage ключ HEAD_TO toggle Мои/Отдел.
const STORAGE_SCOPE_TO = 'pk3_v2_scope_to'; // 'owner' | 'to_team', дефолт 'to_team'.

function isToRoleFn(role) { return role === 'TO' || role === 'HEAD_TO'; }
function computeScopeFn(role, headToToggle) {
  if (role === 'TO') return 'to_personal';
  if (role === 'HEAD_TO') return headToToggle === 'owner' ? 'owner' : 'to_team';
  // PM / HEAD_PM / ADMIN / DIRECTOR_* — auto (backend сам резолвит)
  return 'auto';
}
function scopeTitleFn(role, scope) {
  if (role === 'TO') return 'Канбан · Мои тендеры (ТО)';
  if (role === 'HEAD_TO') return scope === 'owner' ? 'Канбан · Мои тендеры' : 'Канбан · Весь отдел ТО';
  if (role === 'ADMIN' || (role && role.startsWith('DIRECTOR_'))) return 'Канбан · Все';
  return 'Канбан · полный цикл';
}
function scopeSubtitleFn(isTo) {
  return isTo
    ? '📥 → 🧮 → ⚖️ → 📋 → 📤 → ❓ → 🏆/❌ · только тендеры'
    : '📥 → 🧮 → ⚖️ → 📋 → 📤 → ❓ → 🏆/❌ → 🏗 · с просчётом и ТКП внутри карты';
}

export default function BoardV3({ onSwitchToSubstages }) {
  const { user } = useAuth();
  const { open } = useModal();
  const role = user?.role || '';
  const isToRole = isToRoleFn(role);

  // S-21: scope-toggle для HEAD_TO (Мои / Отдел), персистится в LS.
  const [headToToggle, setHeadToToggle] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_SCOPE_TO);
      return (v === 'owner' || v === 'to_team') ? v : 'to_team';
    } catch { return 'to_team'; }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_SCOPE_TO, headToToggle); } catch { /* noop */ }
  }, [headToToggle]);

  const scope = useMemo(() => computeScopeFn(role, headToToggle), [role, headToToggle]);

  // Для TO/HEAD_TO принудительно tender-flow (UI-форс — backend и так форсит, но прячем табы для согласованности).
  const [flowFilterRaw, setFlowFilter] = useState('all');
  const flowFilter = isToRole ? 'tender' : flowFilterRaw;

  const [search, setSearch] = useState('');
  const [columns, setColumns] = useState({});
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState(null);
  const [drawerCard, setDrawerCard] = useState(null);

  async function reload() {
    setLoading(true);
    try {
      const [board, cnts] = await Promise.all([
        loadV3Board(flowFilter, scope, null, isToRole),
        loadV3Counts(flowFilter, scope, null, isToRole),
      ]);
      // S-21: гарантируем 9 ключей даже если backend на устаревшем клоне вернул 8 (graceful fallback).
      const cols = board.columns || {};
      for (const k of V3_COLUMNS) if (!Array.isArray(cols[k])) cols[k] = [];
      // 23.06.2026 BUG-FIX (D-1 BLOCKER): backend отдаёт `card.v3_column`,
      // а карточный код ожидает `card.col` (секции, _tkpStatus, drag-checks, action-bar).
      // Без нормализации раздел ТКП заблокирован, кнопки контекста не показываются.
      // Паритет с vanilla `personal_kanban.js:2724-2731`.
      for (const colKey of Object.keys(cols)) {
        for (const card of (cols[colKey] || [])) {
          if (card && !card.col) card.col = card.v3_column || colKey;
        }
      }
      setColumns(cols);
      const c = cnts || {};
      if (typeof c.addendum !== 'number') c.addendum = 0;
      setCounts(c);
    } catch (e) {
      toast.error('Не удалось загрузить канбан: ' + e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [flowFilter, scope]);

  // SSE
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener('asgard:sse:personal_kanban:card_moved', handler);
    window.addEventListener('asgard:sse:personal_kanban:card_converted', handler);
    window.addEventListener('asgard:sse:personal_kanban:card_document_added', handler);
    window.addEventListener('asgard:sse:tkp_constructor:created', handler);
    window.addEventListener('asgard:sse:tkp_constructor:sent', handler);
    return () => {
      window.removeEventListener('asgard:sse:personal_kanban:card_moved', handler);
      window.removeEventListener('asgard:sse:personal_kanban:card_converted', handler);
      window.removeEventListener('asgard:sse:personal_kanban:card_document_added', handler);
      window.removeEventListener('asgard:sse:tkp_constructor:created', handler);
      window.removeEventListener('asgard:sse:tkp_constructor:sent', handler);
    };
    /* eslint-disable-next-line */
  }, [flowFilter, scope]);

  async function doTransition(cardId, toCol, opts = {}) {
    const res = await v3Transition(cardId, toCol, opts.note, opts.confirm);
    if (res && res.error === 'confirm_required') {
      if (window.confirm(res.message || 'Подтвердите переход')) {
        return doTransition(cardId, toCol, { ...opts, confirm: true });
      }
      return;
    }
    if (res && res.error) {
      toast.error(res.message || res.error);
      return;
    }
    toast.success('Карта перемещена');
    reload();
  }

  function cardFiltered(c) {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.title || '').toLowerCase().includes(q)
      || (c.customer || '').toLowerCase().includes(q)
      || (c.code || '').toLowerCase().includes(q);
  }

  // S-21: динамические header-тексты по scope и подтипу пользователя.
  const h2Title = scopeTitleFn(role, scope);
  const h2Sub = scopeSubtitleFn(isToRole);

  return (
    <div className="pk3-shell">
      <div className="pk3-top-actions">
        <div className="pk3-titles">
          <div className="pk3-kicker">САГА ТЕНДЕРОВ</div>
          <h1 className="pk3-h2">{h2Title}</h1>
          <div className="pk3-h2-sub">{h2Sub}</div>
        </div>
        {role === 'HEAD_TO' && (
          <div className="pk3-scope-toggle" title="Переключить scope">
            <button
              className={headToToggle === 'owner' ? 'pk3-active' : ''}
              onClick={() => setHeadToToggle('owner')}
            >🟦 Мои</button>
            <button
              className={headToToggle === 'to_team' ? 'pk3-active' : ''}
              onClick={() => setHeadToToggle('to_team')}
            >👑 Отдел</button>
          </div>
        )}
        {/* S-21: для TO/HEAD_TO substages-режим не доступен — родитель передаёт undefined, прячем тогглер. */}
        {onSwitchToSubstages && (
          <div className="pk3-view-toggle">
            <button onClick={onSwitchToSubstages}>📋 По под-этапам</button>
            <button className="pk3-active">📊 По воронке</button>
          </div>
        )}
        <input
          className="pk3-search-input"
          placeholder="🔍 поиск по клиенту, теме, ИНН…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Btn variant="gold" onClick={() => open(<TenderEditorModal />, { size: 'wide' })}>＋ Создать вручную</Btn>
      </div>

      {/* S-21: для TO/HEAD_TO flow-tabs скрыты (видят только tender). */}
      {!isToRole && (
        <div className="pk3-tabs-bar">
          {FLOW_TABS.map(t => (
            <div
              key={t.id}
              className={'pk3-tab' + (flowFilter === t.id ? ' pk3-active' : '')}
              onClick={() => setFlowFilter(t.id)}
            >
              {t.label} <span className="pk3-cnt">{flowFilter === t.id ? (counts.total || 0) : '—'}</span>
            </div>
          ))}
        </div>
      )}

      {/* S-31.1 F-6: глобальный banner «ничего не найдено» при активном поиске. */}
      {search && !loading && V3_COLUMNS.reduce(
        (s, k) => s + (columns[k] || []).filter(cardFiltered).length, 0
      ) === 0 && (
        <div className="pk3-search-no-results" role="status" aria-live="polite">
          <span className="pk3-search-no-results-ic" aria-hidden="true">🔍</span>
          <span className="pk3-search-no-results-txt">
            Ничего не найдено по запросу «{search}»
          </span>
          <button
            type="button"
            className="pk3-search-no-results-reset"
            onClick={() => setSearch('')}
          >
            ✕ Сбросить
          </button>
        </div>
      )}

      <div className="pk3-board">
        {V3_COLUMNS.map(colId => {
          const meta = V3_COL_META[colId];
          const cards = (columns[colId] || []).filter(cardFiltered);
          // S-21: colCls берётся из V3_COL_META[].cls (win/lose/addendum), fallback ''.
          const colCls = meta?.cls ? ' ' + meta.cls : '';
          return (
            <div key={colId} className={'pk3-col' + colCls}>
              <div className="pk3-col-head">
                <span className="pk3-col-icon">{meta.ic}</span>
                <span className="pk3-col-title">{meta.title}</span>
                <span className="pk3-col-count">{cards.length}</span>
              </div>
              <div
                className="pk3-col-body"
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('pk3-drop-hover'); }}
                onDragLeave={e => e.currentTarget.classList.remove('pk3-drop-hover')}
                onDrop={async e => {
                  e.preventDefault(); e.currentTarget.classList.remove('pk3-drop-hover');
                  if (draggingId) {
                    await doTransition(draggingId, colId);
                    setDraggingId(null);
                  }
                }}
              >
                {cards.map(c => (
                  <CardV3
                    key={c.id}
                    c={c}
                    onClick={() => setDrawerCard(c)}
                    onDragStart={() => setDraggingId(c.id)}
                    onDragEnd={() => setDraggingId(null)}
                  />
                ))}
                {!cards.length && (
                  <div style={{ color: 'var(--t-3)', fontSize: 11, padding: 12, textAlign: 'center' }}>
                    {loading ? 'Загружаю…' : '—'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {drawerCard && (
        <DrawerV3
          card={drawerCard}
          onClose={() => setDrawerCard(null)}
          onChanged={reload}
          openModal={open}
        />
      )}
    </div>
  );
}

function CardV3({ c, onClick, onDragStart, onDragEnd }) {
  const kind = (c.kind || c.entity_kind || '').split('_')[0];
  const color = c.color || 'green';
  const extraCls = c.col === 'win' ? ' pk3-win' : (c.col === 'lose' ? ' pk3-lose' : '');
  const meta = c.meta || [];
  // S-21: 9-этапная шкала прогресса. Backwards-compat: если backend прислал 8 — дотягиваем 9-м нулём.
  let progress = c.progress || [0, 0, 0, 0, 0, 0, 0, 0, 0];
  if (progress.length < 9) progress = [...progress, ...new Array(9 - progress.length).fill(0)];
  // S-21: маркер дозапроса в правом верхнем углу карточки в колонке addendum (с днями, если backend прислал).
  const addendumMark = c.col === 'addendum'
    ? (c.addendum_days != null ? c.addendum_days + 'д' : '!')
    : null;
  return (
    <div
      className={`pk3-card pk3-${color}${extraCls}`}
      draggable="true"
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {addendumMark != null && <div className="pk3-card-addendum-mark">{addendumMark}</div>}
      <div className="pk3-card-top">
        <span className={`pk3-badge pk3-${kind}`}>{c.kindLabel || kind}</span>
        <span className="pk3-card-id">{c.code || '#' + c.id}</span>
      </div>
      <div className="pk3-card-title">{c.title || ''}</div>
      <div className="pk3-card-customer">{c.customer || ''}</div>
      <div className="pk3-card-meta">
        {meta.map((m, i) => <span key={i} className="pk3-pill">{m}</span>)}
      </div>
      <div className="pk3-card-progress">
        {progress.map((s, i) => (
          <div key={i} className={'pk3-dot ' + (s === 2 ? 'pk3-done' : (s === 1 ? 'pk3-now' : ''))} />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Drawer 920px — 8 секций + sticky nav + контекстные actions
 * ═══════════════════════════════════════════════════════════════════════════ */
function DrawerV3({ card, onClose, onChanged, openModal }) {
  const [openSections, setOpenSections] = useState({
    'sec-ai': true, 'sec-client': true, 'sec-work': true, 'sec-calc': true,
    'sec-docs': true, 'sec-fin': true, 'sec-tkp': true, 'sec-hist': false,
  });
  const drawerRef = useRef(null);
  const activeStage = COL_TO_STAGE[card.col] ?? 0;
  const fin = card.finance || {
    cost_planned: card.cost_planned,
    kp_price_without_vat: card.kp_price_without_vat,
    kp_price_with_vat: card.kp_price_with_vat,
    vat_rate_pct: card.vat_rate_pct,
    margin_planned_pct: card.margin_planned_pct
  };
  const aiSummary = card.ai_summary || '(AI ещё не разобрал заявку)';
  const tkpAttached = !!card.tkp_attached;

  // 22.06.2026 P0-F2: локальное состояние клиента, синк с card.* на маунте.
  // Любой выбор/изменение → PATCH /cards/:id/update (backend whitelist в
  // src/routes/personal-kanban.js:854; работает только для pre_tender и tender).
  const [customer, setCustomer] = useState({
    id: null,
    name: card.customer_name || card.customer || '',
    inn: card.customer_inn || '',
    email: card.customer_email || '',
    phone: card.contact_phone || '',
    contact_person: card.contact_person || '',
    address: card.customer_city || card.work_location || '',
  });
  // Когда меняется карта (открыли другую) — обновить customer.
  useEffect(() => {
    setCustomer({
      id: null,
      name: card.customer_name || card.customer || '',
      inn: card.customer_inn || '',
      email: card.customer_email || '',
      phone: card.contact_phone || '',
      contact_person: card.contact_person || '',
      address: card.customer_city || card.work_location || '',
    });
  }, [card.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Состояние пикеров (используется только в pre_tender/tender — для прочих
  // entity_kind backend вернёт 400 entity_not_editable).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const canEditCustomer = card.entity_kind === 'pre_tender' || card.entity_kind === 'tender';

  async function applyCustomer(c) {
    // c: {name, inn, email, phone, address, contact_person}
    setCustomer((prev) => ({ ...prev, ...c }));
    if (!canEditCustomer) {
      toast.info('Контрагент выбран. Сохранение в карту недоступно для этого типа.');
      return;
    }
    try {
      const body = {
        customer_name: c.name || null,
        customer_inn: c.inn || null,
        customer_email: c.email || null,
        contact_phone: c.phone || null,
        contact_person: c.contact_person || null,
        work_location: c.address || null,
      };
      const r = await patchCard(card.id, body);
      if (r && r.error) {
        toast.error(r.message || r.error);
      } else {
        toast.success('Контрагент: ' + (c.name || '—'));
        // Подмешиваем в card на месте, чтобы при следующем reopen не перезатёрло.
        Object.assign(card, {
          customer_name: c.name, customer: c.name,
          customer_inn: c.inn, customer_email: c.email,
          contact_phone: c.phone, contact_person: c.contact_person,
          work_location: c.address,
        });
      }
    } catch (e) {
      toast.error('Сохранение: ' + (e?.message || e));
    }
  }

  function scrollTo(id) {
    const el = drawerRef.current?.querySelector(`#${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function toggle(id) {
    setOpenSections(s => ({ ...s, [id]: !s[id] }));
  }

  async function onAction(act) {
    if (act === 'open-quick')      return openModal(<QuickWizardV3 card={card} onClose={() => {}} onOpenTKP={() => openModal(<TKPConstructorV3 card={card} onClose={() => {}} onAttached={() => { onChanged(); }} />)} />);
    if (act === 'open-conductor')  return openModal(<ConductorV3 card={card} onClose={() => {}} />);
    if (act === 'open-references') return openModal(<ReferencesV3 card={card} onClose={() => {}} />);
    if (act === 'open-tkp')        return openModal(<TKPConstructorV3 card={card} onClose={() => {}} onAttached={() => { onChanged(); }} />);
    if (act === 'open-send')       return openModal(<SendV3 card={card} onClose={() => {}} onSent={() => { onChanged(); onClose(); }} />);
    if (act === 'convert-pretender') {
      if (!window.confirm('Конвертировать заявку в пре-тендер? Карта изменится на 🗂.')) return;
      const r = await v3ConvertToPretender(card.id);
      if (r && !r.error) { toast.success('Заявка → пре-тендер'); onChanged(); onClose(); }
      else toast.error((r && r.error) || 'Не удалось');
      return;
    }
    // 21.06.2026: открыть автосозданную работу (после tender→win хук в personal-kanban.js:2076-2159
    // автоматически создал works запись). РП кликает кнопку → переходит на /pm-works.
    // Backend пока не поддерживает transition tender→work (см. personal-kanban.js:368 default null).
    if (act === 'open-work') {
      // Ищем работу: для tender-карточки — по tender_id, для pre_tender — по source_pre_tender_id
      // (заявочная работа создаётся с tender_id=NULL, связь через source_pre_tender_id).
      try {
        const q = card.entity_kind === 'pre_tender'
          ? `source_pre_tender_id=${card.entity_id}`
          : `tender_id=${card.entity_id || card.tender_id}`;
        const r = await fetch(`/api/works?${q}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('asgard_token') || ''}` }
        });
        const j = await r.json().catch(() => ({}));
        const works = (j && (j.works || j.items || j.data)) || (Array.isArray(j) ? j : []);
        const work = Array.isArray(works) && works[0];
        if (work && work.id) {
          window.location.hash = `#/pm-works?work_id=${work.id}`;
        } else {
          window.location.hash = '#/pm-works';
        }
        onClose();
      } catch (_) {
        window.location.hash = '#/pm-works';
        onClose();
      }
      return;
    }
    if (act.startsWith('trans-')) {
      const toCol = act.replace('trans-', '');
      let note = null;
      if (toCol === 'lose' || toCol === 'kp_prep' || toCol === 'approval') {
        note = window.prompt('Комментарий (опц.):') || null;
      } else if (toCol === 'addendum') {
        // S-21: prompt про дозапрос — что прислал заказчик.
        note = window.prompt('Что прислал заказчик в дозапросе?') || null;
      } else if (toCol === 'sent' && card.col === 'addendum') {
        // S-21: возврат addendum → sent — что ответили.
        note = window.prompt('Что ответили на дозапрос?') || null;
      }
      const r = await v3Transition(card.id, toCol, note, true);
      if (r && r.error) toast.error(r.message || r.error);
      else { toast.success('Карта перемещена'); onChanged(); onClose(); }
    }
  }

  function ctxActions() {
    const ghost = [
      <Btn key="save" variant="ghost">💾 Сохранить</Btn>,
      <Btn key="note" variant="ghost">📝 Заметка</Btn>,
      <Btn key="rem" variant="ghost">⏰ Напоминание</Btn>,
    ];
    let ctx = [];
    if (card.col === 'new') ctx = [
      <Btn key="cp" onClick={() => onAction('convert-pretender')}>📄 В пре-тендер</Btn>,
      <Btn key="tc" variant="gold" onClick={() => onAction('trans-calc')}>🚀 К просчёту</Btn>,
    ];
    else if (card.col === 'calc') ctx = [
      <Btn key="ad" onClick={() => onAction('trans-addendum')}>❓ Дозапрос клиенту</Btn>,
      <Btn key="tk" variant="gold" onClick={() => onAction('trans-kp_prep')}>📋 Готовим КП</Btn>,
      <Btn key="ta" variant="primary" onClick={() => onAction('trans-approval')}>⚖️ На согласование</Btn>,
    ];
    else if (card.col === 'addendum' && card.flow_type === 'tender') ctx = [
      <Btn key="ts" variant="gold" onClick={() => onAction('trans-sent')}>✅ Ответили</Btn>,
      <Btn key="tw" variant="primary" onClick={() => onAction('trans-win')}>🏆 Выиграли</Btn>,
      <Btn key="tl" variant="danger" onClick={() => onAction('trans-lose')}>❌ Проиграли</Btn>,
    ];
    else if (card.col === 'addendum') ctx = [
      <Btn key="tk" variant="gold" onClick={() => onAction('trans-kp_prep')}>✅ Ответ получен, готовим КП</Btn>,
      <Btn key="tl" variant="danger" onClick={() => onAction('trans-lose')}>❌ Проиграли</Btn>,
    ];
    else if (card.col === 'approval') ctx = [
      <Btn key="tl" variant="danger" onClick={() => onAction('trans-lose')}>❌ Отклонить</Btn>,
      <Btn key="tc" onClick={() => onAction('trans-calc')}>↩ На доработку</Btn>,
      <Btn key="ts" variant="primary" onClick={() => onAction('trans-sent')}>📤 КП ушло</Btn>,
    ];
    else if (card.col === 'kp_prep') ctx = [
      <Btn key="ot" onClick={() => onAction('open-tkp')}>🛠 Конструктор ТКП</Btn>,
      <Btn key="ta" variant="primary" onClick={() => onAction('trans-approval')}>⚖️ На согласование</Btn>,
      ...(tkpAttached ? [<Btn key="os" variant="gold" onClick={() => onAction('open-send')}>📧 Отправить клиенту</Btn>] : []),
    ];
    else if (card.col === 'sent') ctx = [
      <Btn key="ta" onClick={() => onAction('trans-addendum')}>❓ Дозапрос</Btn>,
      <Btn key="tl" variant="danger" onClick={() => onAction('trans-lose')}>❌ Проиграли</Btn>,
      <Btn key="tw" variant="primary" onClick={() => onAction('trans-win')}>🏆 Выиграли</Btn>,
    ];
    // 21.06.2026: в win-колонке работа уже создана автохуком при tender→win
    // (personal-kanban.js:2076-2159). Раньше кнопка trans-work вызывала transition
    // который backend отбивал 409. Теперь — прямой переход в карточку работы.
    else if (card.col === 'win')  ctx = [<Btn key="ow" variant="gold" onClick={() => onAction('open-work')}>🏗 Открыть работу</Btn>];
    else if (card.col === 'work') ctx = [<Btn key="cl" variant="gold" onClick={() => toast.info('Закрытие актом — через /works')}>📦 Закрыть актом</Btn>];
    return [...ghost, <div key="sp" style={{flex:1}}/>, ...ctx];
  }

  // 22.06.2026 P0-F1: click-guard на overlay — НЕ закрывать, показать joke-toast.
  // Зыкрытие только через ✕ в шапке drawer. Паритет с vanilla 3186-3199.
  const onOverlayClick = (e) => {
    if (e.target !== e.currentTarget) return;
    const msg = OVERLAY_JOKES[Math.floor(Math.random() * OVERLAY_JOKES.length)];
    toast.info(msg);
  };

  return (
    <>
      {/* P0-F3: NoteBoard рендерим ВНУТРИ overlay — backdrop-filter создаёт
          новый stacking context, дочерние элементы overlay рендерятся НАД
          размытием (паритет с personal_kanban.js:3206-3210). */}
      <div className="pk3-drawer-overlay" onClick={onOverlayClick}>
        <NoteBoard cardId={card.id} />
      </div>
      <div className="pk3-drawer" ref={drawerRef} onClick={e => e.stopPropagation()}>
      {pickerOpen && (
        <CustomerPicker
          onClose={() => setPickerOpen(false)}
          onPicked={(c) => { setPickerOpen(false); applyCustomer(c); }}
          onNew={() => { setPickerOpen(false); setCreateOpen(true); }}
        />
      )}
      {createOpen && (
        <CreateCustomerModal
          onClose={() => setCreateOpen(false)}
          onCreated={(c) => { setCreateOpen(false); applyCustomer(c); }}
        />
      )}
        <div className="pk3-drawer-head">
          <div className="pk3-row1">
            <span className={`pk3-badge pk3-${(card.kind || '').split('_')[0]}`}>{card.kindLabel || ''}</span>
            <h2>{card.title || ''}</h2>
            <button className="pk3-btn-icon" onClick={onClose}>✕</button>
          </div>
          <div className="pk3-meta">
            <span>📅 {card.created_at_label || '—'}</span>
            <span>👤 РП: {card.owner_label || '—'}</span>
            <span>📨 {card.customer || '—'}</span>
            <span>🆔 {card.code || '#' + card.id}</span>
          </div>
        </div>
        <div className="pk3-stages">
          {V3_STAGE_LABELS.map((lbl, i) => {
            const cls = i < activeStage ? 'pk3-done' : (i === activeStage ? 'pk3-now' : '');
            return <div key={i} className={`pk3-stage ${cls}`}>{lbl}</div>;
          })}
        </div>
        <div className="pk3-drawer-nav">
          {[
            ['sec-ai', '🤖 AI'], ['sec-client', '👤 Клиент'], ['sec-work', '🔧 Работа'],
            ['sec-calc', '🧮 Просчёт'], ['sec-docs', '📎 Документы'],
            ['sec-fin', '💰 Финансы'], ['sec-tkp', '📋 ТКП'], ['sec-hist', '🕘 История'],
          ].map(([id, lbl]) => (
            <span key={id} className="pk3-dnav-link" onClick={() => scrollTo(id)}>{lbl}</span>
          ))}
        </div>

        <Section id="sec-ai" ic="🤖" title="AI разбор" open={openSections['sec-ai']} onToggle={() => toggle('sec-ai')}>
          <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:10}}>
            <span className={`pk3-tag pk3-${card.color === 'green' ? 'ok' : (card.color === 'yellow' ? 'warn' : (card.color === 'red' ? 'err' : 'info'))}`}>
              {card.color === 'green' ? '🟢' : (card.color === 'yellow' ? '🟡' : (card.color === 'red' ? '🔴' : '⚪'))} {card.ai_classification || card.kind || ''}
            </span>
            {card.ai_confidence != null && <span className="pk3-tag pk3-info">confidence {Math.round(card.ai_confidence * 100)}%</span>}
          </div>
          <div className="pk3-ai-block">
            <p style={{margin:0}}>{aiSummary}</p>
            {card.ai_recommendation && <p style={{marginTop:7}}><b>💡 Рекомендация:</b> {card.ai_recommendation}</p>}
          </div>
        </Section>

        <Section id="sec-client" ic="👤" title="Клиент и контакты" open={openSections['sec-client']} onToggle={() => toggle('sec-client')}>
          {/* P0-F2: pill «Заказчик» + ✎ (открыть picker) и «＋ Новый».
              Паритет с personal_kanban.js:3522-3540 (_secClient). */}
          <Row label="Заказчик">
            <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
              <input
                value={customer.name}
                readOnly
                placeholder="Кликни — выбрать из справочника"
                onClick={() => canEditCustomer && setPickerOpen(true)}
                style={{ cursor: canEditCustomer ? 'pointer' : 'not-allowed', flex: 1 }}
                title={canEditCustomer ? 'Выбрать контрагента из справочника' : 'Недоступно для этого типа карты'}
              />
              <Btn
                variant="ghost"
                size="sm"
                onClick={() => canEditCustomer && setPickerOpen(true)}
                disabled={!canEditCustomer}
                title="Найти в справочнике"
              >✎</Btn>
              <Btn
                variant="gold"
                size="sm"
                onClick={() => canEditCustomer && setCreateOpen(true)}
                disabled={!canEditCustomer}
                title="Создать нового контрагента"
              >＋ Новый</Btn>
            </div>
          </Row>
          <Row label="ИНН">
            <input
              value={customer.inn}
              readOnly
              placeholder="будет подставлен"
              style={{ background: 'var(--bg-3,var(--bg3))', color: 'var(--t-2,var(--t2))' }}
            />
          </Row>
          <Row label="Контактное лицо">
            <input
              value={customer.contact_person}
              onChange={(e) => setCustomer({ ...customer, contact_person: e.target.value })}
              onBlur={() => canEditCustomer && patchCard(card.id, { contact_person: customer.contact_person || null }).catch(() => {})}
            />
          </Row>
          <Row label="Email">
            <input
              value={customer.email}
              onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
              onBlur={() => canEditCustomer && patchCard(card.id, { customer_email: customer.email || null }).catch(() => {})}
            />
          </Row>
          <Row label="Телефон">
            <input
              value={customer.phone}
              onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
              onBlur={() => canEditCustomer && patchCard(card.id, { contact_phone: customer.phone || null }).catch(() => {})}
              placeholder="+7 (___) ___-__-__"
            />
          </Row>
          <Row label="Город / Объект">
            <input
              value={customer.address}
              onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
              onBlur={() => canEditCustomer && patchCard(card.id, { work_location: customer.address || null }).catch(() => {})}
            />
          </Row>
        </Section>

        <Section id="sec-work" ic="🔧" title="Что делать" open={openSections['sec-work']} onToggle={() => toggle('sec-work')}>
          <Row label="Тип работ"><select><option>Гидромеханическая очистка</option><option>Химическая промывка</option><option>Антикоррозионная обработка</option><option>Монтажные работы</option><option>Диагностика</option><option>Вентиляция</option><option>Другое</option></select></Row>
          <Row label="Описание"><textarea defaultValue={card.work_description || ''} /></Row>
          <Row label="Объём"><div className="pk3-twocol"><input placeholder="число"/><select><option>м³</option><option>часов</option><option>точек</option><option>тонн</option></select></div></Row>
          <Row label="Дедлайн КП"><input type="date" defaultValue={card.work_deadline || ''} /></Row>
          <Row label="Сроки работ"><div className="pk3-twocol"><input type="date"/><input type="date"/></div></Row>
        </Section>

        <Section id="sec-calc" ic="🧮" title="Просчёт сметы" open={openSections['sec-calc']} onToggle={() => toggle('sec-calc')}>
          <div className="pk3-calc-panel">
            <div className="pk3-calc-card pk3-q" onClick={() => onAction('open-quick')}>
              <span className="pk3-ic">🚀</span>
              <div className="pk3-title">Быстрый просчёт</div>
              <div className="pk3-sub">Мимир-Quick · 4 шага · ~10 мин</div>
            </div>
            <div className="pk3-calc-card pk3-c" onClick={() => onAction('open-conductor')}>
              <span className="pk3-ic">🎼</span>
              <div className="pk3-title">Полный просчёт</div>
              <div className="pk3-sub">Кондуктор · вопросы клиенту · 2-7 дней</div>
            </div>
            <div className="pk3-calc-card pk3-r" onClick={() => onAction('open-references')}>
              <span className="pk3-ic">📚</span>
              <div className="pk3-title">Найти эталоны</div>
              <div className="pk3-sub">База завершённых работ · похожие по типу</div>
            </div>
          </div>
          <div className="pk3-hint">
            💡 <b>Quick</b> — для типовых работ. <b>Кондуктор</b> — когда нужны письма клиенту. <b>Эталоны</b> — прикинуть цену по похожему проекту.
          </div>
        </Section>

        <Section id="sec-docs" ic="📎" title="Документы" count={(card.email_attachments?.length || 0) + (card.pm_documents?.length || 0) + (card.calc_documents?.length || 0)} open={openSections['sec-docs']} onToggle={() => toggle('sec-docs')}>
          <DocGroup title="📧 Из письма клиента" items={card.email_attachments || []} empty="Нет вложений" card={card} src="email" openModal={openModal} />
          <DocGroup title="📤 Загружено РП" items={card.pm_documents || []} addLabel="+ Перетащите файлы или нажмите чтобы выбрать" card={card} src="manual" openModal={openModal} />
          <DocGroup title="🧮 Расчёты и сметы" items={card.calc_documents || []} empty="Сметы появятся после Quick/Кондуктора" card={card} src="calc" openModal={openModal} />
        </Section>

        <Section id="sec-fin" ic="💰" title="Финансы" open={openSections['sec-fin']} onToggle={() => toggle('sec-fin')}>
          <div className="pk3-fin-grid">
            <FinCard label="Плановая с/с" v={fmtMoney(fin.cost_planned)}/>
            <FinCard label="Цена КП без НДС" v={fmtMoney(fin.kp_price_without_vat)}/>
            <FinCard label="С НДС 20%" v={fmtMoney(fin.kp_price_with_vat)}/>
            <FinCard label="Маржа" v={fin.margin_planned_pct != null ? Number(fin.margin_planned_pct).toFixed(1) + '%' : '— %'} margin />
          </div>
          <div className="fs-11 c-t3 mb-8">Ручной ввод — можно заполнить без Quick/ТКП для перехода на согласование.</div>
          <Row label="Плановая с/с"><input id="pk3-f-cost" type="number" defaultValue={fin.cost_planned || ''} placeholder="например 920 000"/></Row>
          <Row label="Цена КП без НДС"><input id="pk3-f-kp" type="number" defaultValue={fin.kp_price_without_vat || ''} placeholder="например 1 200 000"/></Row>
          <Row label="НДС"><select id="pk3-f-vat" defaultValue={String(fin.vat_rate_pct ?? 20)}><option value="20">20% (общая)</option><option value="0">0% (УСН)</option><option value="10">10%</option></select></Row>
          <div style={{ marginTop: 8 }}><Btn variant="primary" onClick={() => saveFinance(card, onChanged)}>💾 Сохранить финансы</Btn></div>
        </Section>

        <Section id="sec-tkp" ic="📋" title="ТКП клиенту" open={openSections['sec-tkp']} onToggle={() => toggle('sec-tkp')}>
          <TkpStatus card={card} tkpAttached={tkpAttached} onAction={onAction} />
        </Section>

        <Section id="sec-hist" ic="🕘" title="История" count={card.history?.length || 0} open={openSections['sec-hist']} onToggle={() => toggle('sec-hist')}>
          {(card.history || []).length ? (card.history || []).map((h, i) => {
            // Backend /personal-kanban/history отдаёт `moved_at` (ISO timestamp)
            // + `moved_by_name`/`actor_name` + `event_label`/`note`. Раньше JSX
            // читал h.when/h.who/h.action — этих полей не существует, поэтому
            // вся история отображалась пустой.
            const ts = h.moved_at || h.when || h.created_at;
            const tsLabel = ts ? new Date(ts).toLocaleString('ru-RU') : '';
            const who = h.moved_by_name || h.actor_name || h.who_name || h.who || '';
            const action = h.event_label || h.action_label || h.action || h.event || '';
            return (
              <div key={i} style={{padding:'6px 0',borderBottom:'1px solid var(--brd-2)',fontSize:12,color:'var(--t-2)'}}>
                <b>{tsLabel}</b>{who ? ` · ${who}` : ''}{action ? ` — ${action}` : ''}
                {h.note && <div style={{color:'var(--t-3)',fontSize:11,marginTop:2}}>{h.note}</div>}
              </div>
            );
          }) : <div style={{color:'var(--t-3)',fontSize:12}}>История пока пуста</div>}
        </Section>

        <div style={{height:80}}/>
        <div className="pk3-actions-bar">{ctxActions()}</div>
      </div>
    </>
  );
}

function Section({ id, ic, title, count, open, onToggle, children }) {
  return (
    <div className="pk3-section" id={id}>
      <div className="pk3-section-head" onClick={onToggle}>
        <span className="pk3-ico">{ic}</span>
        <h3>{title}</h3>
        {count != null && <span className="pk3-count">{count}</span>}
        <span className="pk3-chev">{open ? '▾' : '▸'}</span>
      </div>
      {open && <div className="pk3-section-body">{children}</div>}
    </div>
  );
}
function Row({ label, children }) {
  return <div className="pk3-row"><label>{label}</label>{children}</div>;
}
function FinCard({ label, v, margin }) {
  return (
    <div className={'pk3-fin-card' + (margin ? ' pk3-margin' : '')}>
      <label>{label}</label>
      <div className="pk3-v">{v}</div>
    </div>
  );
}
function fmtMoney(n) {
  if (n == null) return '— ₽';
  return Number(n).toLocaleString('ru-RU') + ' ₽';
}
function DocGroup({ title, items, empty, addLabel, card, src, openModal }) {
  const ptId = card?.entity_id;
  const token = (() => { try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; } })();
  const tokenQs = token ? `?token=${encodeURIComponent(token)}` : '';

  const docUrl = (d, i) => {
    if (!ptId || src === 'calc') return null;
    if (src === 'email') return `/api/pre-tenders/${ptId}/email-attachments/${d.id}/download${tokenQs}`;
    return `/api/pre-tenders/${ptId}/documents/${d._idx ?? i}/download${tokenQs}`;
  };

  const onView = (d, i) => {
    const url = docUrl(d, i);
    if (!url) { toast.info('Скоро'); return; }
    openModal(
      <FilePreviewModal title={d.original_filename || d.filename || 'файл'} fileUrl={url} mime={d.mime_type || ''} downloadUrl={url} />,
      { size: 'xl' }
    );
  };

  return (
    <div className="pk3-doc-group">
      <h4>{title}</h4>
      {items.length ? items.map((d, i) => (
        <div key={d.id || i} className="pk3-doc-row">
          <span className="pk3-doc-ic">{docIcon(d.mime_type || d.original_filename || d.filename)}</span>
          <span className="pk3-doc-name">{d.original_filename || d.filename || d.name || 'файл'}</span>
          <span className="pk3-doc-size">{d.size ? fmtBytes(d.size) : ''}</span>
          <div className="pk3-doc-actions">
            <button type="button" onClick={() => onView(d, i)}>👁</button>
            {docUrl(d, i) && <a href={docUrl(d, i)} download target="_blank" rel="noreferrer">⬇</a>}
          </div>
        </div>
      )) : (addLabel ? <div className="pk3-doc-add">{addLabel}</div> : <div style={{color:'var(--t-3)',fontSize:11.5}}>{empty || '—'}</div>)}
    </div>
  );
}

async function saveFinance(card, onChanged) {
  const ptId = card?.entity_id;
  if (!ptId) { toast.error('Нет pre_tender'); return; }
  const cost = Number(document.getElementById('pk3-f-cost')?.value);
  const kpNoVat = Number(document.getElementById('pk3-f-kp')?.value);
  const vatRate = Number(document.getElementById('pk3-f-vat')?.value ?? 20);
  const body = {
    cost_planned: Number.isFinite(cost) ? cost : null,
    kp_price_without_vat: Number.isFinite(kpNoVat) ? kpNoVat : null,
    kp_price_with_vat: Number.isFinite(kpNoVat) ? Math.round(kpNoVat * (1 + vatRate / 100) * 100) / 100 : null,
    vat_rate_pct: vatRate,
    margin_planned_pct: (Number.isFinite(cost) && Number.isFinite(kpNoVat) && kpNoVat > 0)
      ? Math.round((1 - cost / kpNoVat) * 1000) / 10
      : null
  };
  try {
    await patchCard(card.id, body);
    toast.success('Финансы сохранены');
    onChanged?.();
  } catch (e) {
    toast.error('Не сохранилось: ' + (e?.message || e));
  }
}
function docIcon(s) {
  s = (s || '').toLowerCase();
  if (s.includes('pdf')) return '📄';
  if (s.includes('sheet') || /\.(xlsx?|xls)/.test(s)) return '📊';
  if (s.includes('word') || /\.(docx?|doc)/.test(s)) return '📝';
  if (s.includes('image') || /\.(jpe?g|png|gif|webp)/.test(s)) return '🖼️';
  return '📎';
}
function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return n + ' Б';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' КБ';
  return (n / (1024 * 1024)).toFixed(1) + ' МБ';
}
function TkpStatus({ card, tkpAttached, onAction }) {
  let stat;
  if (card.col === 'new')                              stat = { tag: '—',          cls: 'info', text: 'Раздел станет доступен с этапа «Просчёт».', lock: true };
  else if (card.col === 'calc' && !tkpAttached)        stat = { tag: 'не начат',   cls: 'warn', text: 'Черновик ТКП можно собирать параллельно с просчётом.', lock: false };
  else if (card.col === 'calc' &&  tkpAttached)        stat = { tag: 'черновик',   cls: 'warn', text: 'Черновик в карте. Можно дорабатывать или отправить на согласование.', lock: false };
  else if (card.col === 'approval')                    stat = { tag: 'на согл.',   cls: 'info', text: 'ТКП ушло директору. Изменения после возврата на доработку.', lock: false };
  else if (card.col === 'kp_prep' && !tkpAttached)     stat = { tag: 'утверждено', cls: 'ok',   text: 'Директор согласовал. Финализируй и отправь клиенту.', lock: false };
  else if (card.col === 'kp_prep' &&  tkpAttached)     stat = { tag: 'к отправке', cls: 'ok',   text: 'ТКП готово. Нажми «Отправить клиенту» внизу карты.', lock: false };
  else if (card.col === 'sent')                        stat = { tag: 'отправлено', cls: 'ok',   text: 'ТКП ушло клиенту. Ждём ответ.', lock: true };
  // S-21: addendum — клиент прислал дозапрос; РП отвечает и карта возвращается в sent.
  else if (card.col === 'addendum')                    stat = { tag: 'дозапрос',   cls: 'warn', text: 'Клиент прислал дозапрос. Ответь — карта вернётся в «КП отправлено».', lock: false };
  else if (card.col === 'win' || card.col === 'work')  stat = { tag: 'принято',    cls: 'ok',   text: 'Клиент принял ТКП.', lock: true };
  else if (card.col === 'lose')                        stat = { tag: 'отклонено',  cls: 'err',  text: 'Клиент отклонил.', lock: true };
  else                                                 stat = { tag: '—',          cls: 'info', text: '', lock: true };

  return (
    <>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:11}}>
        <span className={`pk3-tag pk3-${stat.cls}`}>{stat.tag}</span>
        <span style={{fontSize:12,color:'var(--t-2)'}}>{stat.text}</span>
      </div>
      {stat.lock && !tkpAttached ? null : tkpAttached ? (
        <>
          <div className="pk3-ai-block">
            <p style={{margin:0}}><b>📄 Прикреплено к карте.</b> Документ в разделе «📤 Загружено РП».</p>
          </div>
          <div style={{marginTop:9,display:'flex',gap:7,flexWrap:'wrap'}}>
            <Btn onClick={() => onAction('open-tkp')}>✏️ Открыть в конструкторе</Btn>
            <Btn onClick={() => onAction('tkp-pdf')}>📥 Скачать PDF</Btn>
            {card.col === 'kp_prep' && <Btn variant="gold" onClick={() => onAction('open-send')}>📧 Отправить клиенту</Btn>}
          </div>
        </>
      ) : (
        <>
          <div className="pk3-calc-panel" style={{gridTemplateColumns:'1fr 1fr',marginBottom:10}}>
            <div className="pk3-calc-card pk3-r" onClick={() => onAction('open-tkp')} style={{borderColor:'var(--gold)',background:'var(--gold-bg)'}}>
              <span className="pk3-ic">🛠</span>
              <div className="pk3-title">Конструктор ТКП</div>
              <div className="pk3-sub">блоки + превью + шаблон</div>
            </div>
            <div className="pk3-calc-card pk3-c">
              <span className="pk3-ic">📥</span>
              <div className="pk3-title">Загрузить готовый</div>
              <div className="pk3-sub">если есть свой Word/PDF</div>
            </div>
          </div>
          <div className="pk3-hint">💡 После сохранения файл попадёт в «📤 Загружено РП» и привяжется к карте.</div>
        </>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 модалок: Quick / Conductor / References / TKPConstructor / Send
 * ═══════════════════════════════════════════════════════════════════════════ */

function QuickWizardV3({ card, onClose, onOpenTKP }) {
  const [step, setStep] = useState(0);
  const [sessionUid, setSessionUid] = useState(null);
  const steps = ['Загрузка ТЗ', 'AI задаёт вопросы', 'Черновик сметы', 'Финальный ТКП'];

  async function ensureSession() {
    if (sessionUid) return sessionUid;
    const r = await v3StartQuick(card.id);
    if (r && r.session_uid) { setSessionUid(r.session_uid); return r.session_uid; }
    return null;
  }
  async function save(thenTKP) {
    const uid = await ensureSession();
    if (thenTKP) { onClose(); onOpenTKP && onOpenTKP({ prefillFromSession: uid }); return; }
    toast.success('Просчёт сохранён, карта пойдёт на согласование');
    onClose();
  }

  return (
    <div className="pk3-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pk3-modal">
        <div className="pk3-modal-head">
          <span style={{fontSize:20,color:'var(--info)'}}>🚀</span>
          <h3>Быстрый просчёт через Мимир-Quick</h3>
          <span className="pk3-tag pk3-info">~10 мин</span>
          <button className="pk3-btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="pk3-modal-body">
          <div className="pk3-wiz-steps">
            {steps.map((lbl, i) => (
              <div key={i} className={'pk3-wiz-step ' + (i < step ? 'pk3-done' : (i === step ? 'pk3-now' : ''))}>
                <span className="pk3-num">{i + 1}</span>{lbl}
              </div>
            ))}
          </div>
          {step === 0 && (
            <div>
              <p style={{marginBottom:14,color:'var(--t-2)'}}>Документы ТЗ из заявки <b>уже загружены</b>. AI распознал:</p>
              <div className="pk3-ai-block">
                <p><b>Содержимое вложений</b>: AI прочитал и извлёк {card.email_attachments_count || '4'} файла.</p>
                <p style={{marginTop:7}}><b>Сводка</b>: {card.ai_summary || 'AI собрал ТЗ. Готов задать уточняющие вопросы.'}</p>
              </div>
              <Row label="Дополнительный контекст"><textarea placeholder="опционально — что сказал клиент, дедлайны"/></Row>
            </div>
          )}
          {step === 1 && (
            <div>
              <p style={{marginBottom:12,color:'var(--t-2)'}}>AI задаёт 4 уточняющих вопроса:</p>
              <Row label="1. Режим работ?"><select><option>Дневная смена (8 ч)</option><option>Круглосуточно (24/7)</option><option>2 смены по 12 ч</option></select></Row>
              <Row label="2. Требуется остановка?"><select><option>Да, плановая остановка</option><option>Без остановки</option><option>Уточнить у клиента</option></select></Row>
              <Row label="3. Логистика реагентов"><select><option>Везём со своего склада</option><option>Покупаем на месте</option><option>Поставщик клиента</option></select></Row>
              <Row label="4. Размещение бригады"><select><option>Гостиница за наш счёт</option><option>Клиент предоставляет</option><option>Своя мобильная база</option></select></Row>
            </div>
          )}
          {step === 2 && (
            <div>
              <p style={{marginBottom:12,color:'var(--t-2)'}}>🤖 AI собрал черновик сметы. Правь прямо здесь.</p>
              <div style={{background:'var(--bg-2)',border:'1px solid var(--brd-2)',borderRadius:10,padding:'11px 13px'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead><tr style={{borderBottom:'1px solid var(--brd-2)'}}>
                    <th style={{textAlign:'left',padding:'7px 6px',color:'var(--t-3)',fontSize:11}}>№</th>
                    <th style={{textAlign:'left',padding:'7px 6px',color:'var(--t-3)',fontSize:11}}>Позиция</th>
                    <th style={{textAlign:'right',padding:'7px 6px',color:'var(--t-3)',fontSize:11}}>Кол-во</th>
                    <th style={{textAlign:'right',padding:'7px 6px',color:'var(--t-3)',fontSize:11}}>Цена</th>
                    <th style={{textAlign:'right',padding:'7px 6px',color:'var(--t-3)',fontSize:11}}>Сумма</th>
                  </tr></thead>
                  <tbody>
                    {[['1','Подготовка','1','25 000','25 000'],['2','Основные работы','42','12 000','504 000'],['3','Контроль качества','16','2 500','40 000'],['4','Логистика','1','120 000','120 000'],['5','Реагенты','1','88 000','88 000']].map((r,i) => (
                      <tr key={i} style={{borderBottom:'1px solid var(--brd-2)'}}>
                        {r.map((c, j) => <td key={j} style={{padding:'6px',color:'var(--t-2)',textAlign:j < 2 ? 'left' : 'right'}}>{c}</td>)}
                      </tr>
                    ))}
                    <tr style={{borderTop:'2px solid var(--brd-1)'}}>
                      <td colSpan={4} style={{padding:9,textAlign:'right',color:'var(--t-1)',fontWeight:600}}>Итого с/с:</td>
                      <td style={{padding:9,textAlign:'right',color:'var(--gold-l)',fontWeight:700,fontFamily:'monospace'}}>920 000 ₽</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Row label="Маржа, %"><input type="number" defaultValue="30"/></Row>
              <Row label="Итоговое КП без НДС"><input type="number" defaultValue="1200000"/></Row>
            </div>
          )}
          {step === 3 && (
            <div>
              <p style={{marginBottom:12,color:'var(--t-2)'}}>✅ Черновик готов. Что дальше?</p>
              <div className="pk3-fin-grid">
                <FinCard label="Плановая с/с" v="920 К ₽"/>
                <FinCard label="Цена КП без НДС" v="1.20 М ₽"/>
                <FinCard label="С НДС 20%" v="1.44 М ₽"/>
                <FinCard label="Маржа" v="23.3%" margin/>
              </div>
              <div className="pk3-ai-block" style={{marginTop:14}}>
                <p><b>📊 После «Сохранить»:</b></p>
                <ul style={{marginTop:5,paddingLeft:18,lineHeight:1.6}}>
                  <li>Финансовые поля карты заполнятся</li>
                  <li>Смета сохранится в «🧮 Расчёты»</li>
                  <li>Можно сразу собрать ТКП</li>
                  <li>Или → на согласование (ТКП позже)</li>
                </ul>
              </div>
            </div>
          )}
        </div>
        <div className="pk3-modal-foot">
          {step > 0 && <Btn variant="ghost" onClick={() => setStep(step - 1)}>← Назад</Btn>}
          <div style={{flex:1}}/>
          {step < 3 ? (
            <>
              <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
              <Btn variant="gold" onClick={() => setStep(step + 1)}>Далее →</Btn>
            </>
          ) : (
            <>
              <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
              <Btn onClick={() => save(true)}>🛠 Сохранить и собрать ТКП</Btn>
              <Btn variant="primary" onClick={() => save(false)}>✅ Сохранить и на согласование</Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConductorV3({ card, onClose }) {
  useEffect(() => { v3StartConductor(card.id).catch(() => {}); /* eslint-disable-next-line */ }, []);
  const journal = [
    { role: 'ai',     who: 'Мимир',         when: '17.06 22:15', status: 'sent',     text: 'Сформировал 5 уточняющих вопросов. Письмо «АС-2026-06-17/Q001» отправлено клиенту.' },
    { role: 'pm',     who: 'РП',            when: '17.06 22:18',                     text: 'Подтвердил отправку.' },
    { role: 'client', who: 'Клиент',        when: '18.06 09:42', status: 'received', text: 'Прислал ответы на 3 из 5 вопросов. Чертежи в приложении.' },
    { role: 'ai',     who: 'Мимир',         when: '18.06 09:46', status: 'draft',    text: 'Готов сформировать письмо-напоминание по 2 оставшимся вопросам.' },
  ];
  return (
    <div className="pk3-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pk3-modal">
        <div className="pk3-modal-head">
          <span style={{fontSize:20,color:'var(--purple)'}}>🎼</span>
          <h3>Мимир-Кондуктор · сессия</h3>
          <span className="pk3-tag pk3-warn">в работе · итерация 2/4</span>
          <button className="pk3-btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="pk3-modal-body">
          <div style={{display:'grid',gridTemplateColumns:'200px 1fr',gap:18}}>
            <div>
              <div style={{fontSize:10.5,color:'var(--t-3)',textTransform:'uppercase',marginBottom:7,letterSpacing:.4}}>ПРОГРЕСС</div>
              <div className="pk3-ai-block" style={{padding:'9px 11px',fontSize:11}}>
                <p style={{margin:0}}>✅ Анализ ТЗ · 100%</p>
                <p style={{margin:'5px 0 0'}}>✅ Вопросы клиенту · 5/5</p>
                <p style={{margin:'5px 0 0'}}>🔄 Получение ответов · 3/5</p>
                <p style={{margin:'5px 0 0'}}>⏳ Уточняющая итерация</p>
                <p style={{margin:'5px 0 0',opacity:.5}}>⏳ Итоговая смета</p>
                <p style={{margin:'5px 0 0',opacity:.5}}>⏳ ТКП</p>
              </div>
              <div style={{marginTop:11,fontSize:10.5,color:'var(--t-3)'}}><b>Токены:</b><br/>47К / 80К</div>
            </div>
            <div>
              <div style={{fontSize:10.5,color:'var(--t-3)',textTransform:'uppercase',marginBottom:7,letterSpacing:.4}}>ЖУРНАЛ ПЕРЕПИСКИ</div>
              {journal.map((m, i) => (
                <div key={i} className={`pk3-cond-msg pk3-${m.role}`}>
                  <div className="pk3-cond-ava">{m.role === 'ai' ? '🧙' : (m.role === 'client' ? '📨' : '👤')}</div>
                  <div className="pk3-cond-content">
                    <div className="pk3-cond-head">
                      <span className="pk3-cond-name">{m.who}</span>
                      <span className="pk3-cond-time">{m.when}</span>
                      {m.status && <span className={`pk3-cond-status pk3-${m.status}`}>{m.status}</span>}
                    </div>
                    <div className="pk3-cond-text">{m.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="pk3-modal-foot">
          <Btn variant="ghost" onClick={onClose}>Закрыть</Btn>
          <div style={{flex:1}}/>
          <Btn onClick={() => toast.info('Напоминание клиенту')}>📨 Напомнить</Btn>
          <Btn variant="gold" onClick={() => toast.info('Откроется страница сметы')}>📊 К смете</Btn>
        </div>
      </div>
    </div>
  );
}

function ReferencesV3({ card, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    v3SearchReferences({
      work_type: card.work_type,
      volume_min: card.volume_estimate ? Math.round(card.volume_estimate * 0.7) : undefined,
      volume_max: card.volume_estimate ? Math.round(card.volume_estimate * 1.3) : undefined,
      limit: 10,
    }).then(r => {
      setItems((r && (r.items || r.references)) || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [card]);
  const top = items[0];
  return (
    <div className="pk3-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pk3-modal" style={{maxWidth:1200,height:'auto',maxHeight:'88vh'}}>
        <div className="pk3-modal-head">
          <span style={{fontSize:20,color:'var(--gold)'}}>📚</span>
          <h3>Эталонные проекты · найдено {items.length}</h3>
          <button className="pk3-btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="pk3-modal-body">
          {loading ? <div style={{color:'var(--t-3)',padding:14}}>Загружаю эталоны…</div> : (
            <>
              <p style={{marginBottom:12,color:'var(--t-2)',fontSize:12.5}}>База эталонов содержит завершённые работы. По типу «{card.work_type || 'наш профиль'}» найдено {items.length} совпадений:</p>
              <div className="pk3-ref-row" style={{background:'var(--bg-3)',fontWeight:600,fontSize:10.5,color:'var(--t-3)',textTransform:'uppercase',letterSpacing:.4}}>
                <div>Проект</div>
                <div className="pk3-right">Сумма</div>
                <div className="pk3-right">Маржа</div>
                <div className="pk3-right">Дни</div>
                <div className="pk3-right">% совп.</div>
                <div className="pk3-right">—</div>
              </div>
              {items.map(it => (
                <div key={it.id} className="pk3-ref-row">
                  <div>
                    <div className="pk3-name">{it.code || 'REF-' + it.id} · {it.work_type || it.object_name || ''}</div>
                    <div className="pk3-nameSub">{it.customer_name || ''}</div>
                  </div>
                  <div className="pk3-num">{fmtMoneyShort(it.contract_value_actual || it.contract_value_planned)}</div>
                  <div className={'pk3-num pk3-pct ' + ((it.margin_actual_pct || 0) >= 22 ? 'pk3-good' : 'pk3-bad')}>{fmtPct(it.margin_actual_pct || it.margin_planned_pct)}</div>
                  <div className="pk3-num">{it.duration_actual_calendar_days || '—'}</div>
                  <div className="pk3-num" style={{color: (it.similarity_pct || 0) >= 90 ? 'var(--ok)' : ((it.similarity_pct || 0) >= 75 ? 'var(--amber)' : 'var(--err)')}}>{(it.similarity_pct || '?') + '%'}</div>
                  <Btn size="sm" variant="gold">→</Btn>
                </div>
              ))}
              {top && (
                <div className="pk3-ai-block" style={{marginTop:15}}>
                  <b style={{color:'var(--gold-l)',fontSize:13}}>🤖 Рекомендация Мимира:</b>
                  <p style={{marginTop:5,fontSize:12.5,lineHeight:1.5}}>Базовый эталон — <b>{top.code || 'REF-' + top.id}</b> ({top.similarity_pct || 0}% совпадение). Скорректируй на: <b>+5% логистика</b>, <b>+2% сезон</b>.</p>
                  <div style={{marginTop:8,display:'flex',gap:7}}>
                    <Btn variant="gold">📋 Скопировать смету в Quick</Btn>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="pk3-modal-foot">
          <Btn variant="ghost" onClick={onClose}>Закрыть</Btn>
        </div>
      </div>
    </div>
  );
}
function fmtMoneyShort(n) { return n != null ? (Math.round(Number(n) / 1000) + ' К') : '—'; }
function fmtPct(n) { return n != null ? (Number(n).toFixed(1) + '%') : '—'; }

const TKP_DEFAULT_BLOCKS = [
  { block_key: 'title',    block_icon: '📋', block_title: 'Шапка',         block_order: 100, is_required: true,  block_data: {} },
  { block_key: 'preamble', block_icon: '📜', block_title: 'Преамбула',    block_order: 200, is_required: false, block_data: {} },
  { block_key: 'smeta',    block_icon: '📊', block_title: 'Смета работ',  block_order: 300, is_required: false, block_data: { items: [] } },
  { block_key: 'terms',    block_icon: '💳', block_title: 'Условия платежа', block_order: 400, is_required: false, block_data: {} },
  { block_key: 'warranty', block_icon: '🛡', block_title: 'Гарантии',     block_order: 500, is_required: false, block_data: {} },
  { block_key: 'attach',   block_icon: '📎', block_title: 'Приложения',   block_order: 600, is_required: false, block_data: {} },
  { block_key: 'sign',     block_icon: '✍️', block_title: 'Подпись',       block_order: 700, is_required: true,  block_data: {} },
];
const TKP_AVAILABLE = [
  { block_key: 'logistics', block_icon: '🚚', block_title: 'Логистика' },
  { block_key: 'safety',    block_icon: '🦺', block_title: 'ОТ и ТБ' },
  { block_key: 'schedule',  block_icon: '📅', block_title: 'График работ' },
  { block_key: 'team',      block_icon: '👷', block_title: 'Состав бригады' },
];

function TKPConstructorV3({ card, onClose, onAttached }) {
  const [tkpId, setTkpId] = useState(card.tkp_id || null);
  const [blocks, setBlocks] = useState(TKP_DEFAULT_BLOCKS);
  const [active, setActive] = useState('title');
  const [dirty, setDirty] = useState(false);
  const [autosaveText, setAutosaveText] = useState('—');
  const autoTimer = useRef(null);

  useEffect(() => {
    (async () => {
      if (!tkpId) {
        const r = await tkpFromCard(card.id, 'universal');
        if (r && r.tkp_id) {
          setTkpId(r.tkp_id);
          if (r.blocks && r.blocks.length) setBlocks(r.blocks);
        } else if (r && r.error === 'tkp_already_exists' && r.tkp_id) {
          setTkpId(r.tkp_id);
          const g = await tkpLoadBlocks(r.tkp_id);
          if (g && g.blocks) setBlocks(g.blocks);
        }
      } else {
        const g = await tkpLoadBlocks(tkpId);
        if (g && g.blocks) setBlocks(g.blocks);
      }
    })();
    /* eslint-disable-next-line */
  }, []);

  useEffect(() => {
    autoTimer.current = setInterval(async () => {
      if (!dirty || !tkpId) return;
      const r = await tkpSaveBlocks(tkpId, blocks.map((b, i) => ({ ...b, block_order: (i + 1) * 100, is_active: true })));
      if (r && !r.error) { setDirty(false); setAutosaveText('только что'); }
    }, 10000);
    return () => clearInterval(autoTimer.current);
  }, [dirty, tkpId, blocks]);

  function removeBlock(key) { setBlocks(bs => bs.filter(b => b.block_key !== key)); setDirty(true); }
  function addBlock(b)      { setBlocks(bs => [...bs.slice(0, -1), { ...b, block_order: 0, block_data: {} }, bs[bs.length - 1]]); setDirty(true); }
  function moveBlock(i, dir) {
    setBlocks(bs => {
      const a = [...bs]; const j = i + dir;
      if (j < 0 || j >= a.length) return a;
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });
    setDirty(true);
  }
  async function saveDraft() {
    if (!tkpId) return;
    const r = await tkpSaveBlocks(tkpId, blocks.map((b, i) => ({ ...b, block_order: (i + 1) * 100, is_active: true })));
    if (r && !r.error) { setDirty(false); setAutosaveText('только что'); toast.success('Сохранено'); }
    else toast.error('Не сохранилось');
  }
  async function downloadPdf() {
    await saveDraft();
    const r = await tkpRenderPdf(tkpId);
    if (r && r.pdf_path) {
      const t = localStorage.getItem('asgard_token');
      window.open(`/uploads/${r.pdf_path.replace(/^uploads\//, '')}?token=${encodeURIComponent(t || '')}`, '_blank');
    } else toast.error('PDF не сгенерирован');
  }
  async function attachToCard() {
    await saveDraft();
    const r = await tkpRenderPdf(tkpId);
    if (!r || r.error) { toast.error('PDF не сгенерирован'); return; }
    const a = await tkpAttachToCard(tkpId, card.id);
    if (a && !a.error) {
      toast.success('ТКП прикреплено к карте');
      clearInterval(autoTimer.current);
      onClose();
      onAttached && onAttached(a.document_id);
    } else toast.error('Не привязано');
  }

  return (
    <div className="pk3-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pk3-modal" style={{maxWidth:1400}}>
        <div className="pk3-modal-head">
          <span style={{fontSize:20,color:'var(--gold)'}}>🛠</span>
          <h3>Конструктор ТКП #{tkpId || 'NEW'}</h3>
          <span className="pk3-tag pk3-info">черновик · автосохранение 10с</span>
          <button className="pk3-btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="pk3-modal-body" style={{padding:'14px 18px'}}>
          <div className="pk3-tkp-layout">
            <div className="pk3-tkp-blocks">
              <h4>Блоки документа</h4>
              {blocks.map((b, i) => (
                <div
                  key={b.block_key}
                  className={'pk3-tkp-block-item' + (active === b.block_key ? ' pk3-active' : '')}
                  onClick={() => setActive(b.block_key)}
                >
                  <span className="pk3-ic">{b.block_icon}</span>
                  <span className="pk3-name">{b.block_title}</span>
                  <div className="pk3-actions">
                    {i > 0 && <button onClick={e => { e.stopPropagation(); moveBlock(i, -1); }}>↑</button>}
                    {i < blocks.length - 1 && <button onClick={e => { e.stopPropagation(); moveBlock(i, 1); }}>↓</button>}
                    {!b.is_required && <button onClick={e => { e.stopPropagation(); removeBlock(b.block_key); }}>✕</button>}
                  </div>
                </div>
              ))}
              <div className="pk3-tkp-add-block">
                <h4>+ Добавить блок</h4>
                <div className="pk3-tkp-add-options">
                  {TKP_AVAILABLE.filter(a => !blocks.find(b => b.block_key === a.block_key)).map(a => (
                    <button key={a.block_key} onClick={() => addBlock(a)}>{a.block_icon} {a.block_title}</button>
                  ))}
                </div>
              </div>
              <div style={{marginTop:12,paddingTop:9,borderTop:'1px solid var(--brd-2)'}}>
                <h4>Шаблон</h4>
                <select style={{width:'100%',background:'var(--bg-3)',border:'1px solid var(--brd-2)',color:'var(--t-1)',padding:'5px 7px',borderRadius:5,fontSize:11}}>
                  <option value="chemcleaning">🚿 Хим/гидромех. промывка</option>
                  <option value="assembly">🔧 Монтажные работы</option>
                  <option value="anticor">🎨 Антикоррозия</option>
                  <option value="diagnostics">📐 Диагностика</option>
                  <option value="vent">🌬 Вентиляция и ОВ</option>
                  <option value="universal">📋 Универсальный</option>
                </select>
              </div>
            </div>
            <div className="pk3-tkp-preview">
              <h1>ТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</h1>
              <div className="pk3-tkp-num">№ АС-{new Date().toISOString().slice(0,10)}/{tkpId || 'X'} от {new Date().toLocaleDateString('ru-RU')}</div>
              {blocks.find(b => b.block_key === 'title') && (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18,marginBottom:16,fontSize:12}}>
                  <div>
                    <b style={{fontFamily:'Cinzel,serif',color:'#5a3a0a'}}>ИСПОЛНИТЕЛЬ:</b><br/>
                    ООО «АСГАРД-Сервис»<br/>ИНН: 7727285690<br/>Москва<br/>+7 (495) 234-56-78
                  </div>
                  <div>
                    <b style={{fontFamily:'Cinzel,serif',color:'#5a3a0a'}}>ЗАКАЗЧИК:</b><br/>
                    {card.customer_name || card.customer || '—'}<br/>
                    {card.contact_person || '—'}<br/>
                    {card.customer_city || card.work_location || '—'}<br/>
                    {card.customer_email || '—'}
                  </div>
                </div>
              )}
              {blocks.find(b => b.block_key === 'preamble') && (<><h2>Преамбула</h2><p>ООО «АСГАРД-Сервис» благодарит вас за обращение и предлагает выполнить работы согласно ТЗ.</p><p>Настоящее ТКП действительно 30 календарных дней. Стоимость в рублях без НДС / с НДС 20%.</p></>)}
              {blocks.find(b => b.block_key === 'smeta') && (
                <SmetaTableEditable
                  block={blocks.find(b => b.block_key === 'smeta')}
                  onChange={(newData) => {
                    setBlocks(bs => bs.map(b => b.block_key === 'smeta' ? { ...b, block_data: newData } : b));
                    setDirty(true);
                  }}
                />
              )}
              {false && (
                <><h2>Смета работ</h2><table>
                  <thead><tr><th>№</th><th>Наименование</th><th className="pk3-right">Ед.</th><th className="pk3-right">Кол-во</th><th className="pk3-right">Цена</th><th className="pk3-right">Сумма</th></tr></thead>
                  <tbody>
                    <tr><td>1</td><td>Подготовка</td><td className="pk3-right">шт</td><td className="pk3-right">1</td><td className="pk3-right">28 500</td><td className="pk3-right">28 500</td></tr>
                    <tr><td>2</td><td>Основные работы</td><td className="pk3-right">м²</td><td className="pk3-right">42</td><td className="pk3-right">14 500</td><td className="pk3-right">609 000</td></tr>
                    <tr><td>3</td><td>Контроль качества</td><td className="pk3-right">точек</td><td className="pk3-right">16</td><td className="pk3-right">3 000</td><td className="pk3-right">48 000</td></tr>
                    <tr><td>4</td><td>Логистика</td><td className="pk3-right">компл</td><td className="pk3-right">1</td><td className="pk3-right">144 000</td><td className="pk3-right">144 000</td></tr>
                    <tr><td>5</td><td>Реагенты</td><td className="pk3-right">компл</td><td className="pk3-right">1</td><td className="pk3-right">370 500</td><td className="pk3-right">370 500</td></tr>
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={5} className="pk3-right">Итого без НДС:</td><td className="pk3-right">1 200 000</td></tr>
                    <tr><td colSpan={5} className="pk3-right">НДС 20%:</td><td className="pk3-right">240 000</td></tr>
                    <tr><td colSpan={5} className="pk3-right" style={{fontSize:13}}><b>Итого с НДС:</b></td><td className="pk3-right" style={{fontSize:13}}><b>1 440 000</b></td></tr>
                  </tfoot>
                </table></>
              )}
              {blocks.find(b => b.block_key === 'terms') && (<><h2>Условия платежа</h2><ul><li>Аванс <b>30%</b> в течение 10 банковских дней</li><li>Окончательный расчёт — 30 дней после акта</li><li>Безналичный расчёт</li></ul></>)}
              {blocks.find(b => b.block_key === 'warranty') && (<><h2>Гарантийные обязательства</h2><ul><li>Срок гарантии — <b>12 месяцев</b></li><li>Покрывает дефекты выполнения работ</li><li>Не распространяется на нормальный износ</li></ul></>)}
              {blocks.find(b => b.block_key === 'logistics') && (<><h2>Логистика и размещение</h2><p>Бригада из <b>6 человек</b>. Размещение в гостинице 3*. Доставка инструментов — собственным транспортом.</p></>)}
              {blocks.find(b => b.block_key === 'safety') && (<><h2>Охрана труда и ТБ</h2><ul><li>Допуски: Ростехнадзор, газоспасатели, высотные работы</li><li>Вводный инструктаж от Заказчика</li><li>СИЗ, отчётность</li></ul></>)}
              {blocks.find(b => b.block_key === 'schedule') && (<><h2>График работ</h2><table><thead><tr><th>Этап</th><th>Дни</th><th>Описание</th></tr></thead><tbody>
                <tr><td>1</td><td>1-2</td><td>Мобилизация, допуски</td></tr>
                <tr><td>2</td><td>3-9</td><td>Основные работы</td></tr>
                <tr><td>3</td><td>10-12</td><td>Контроль качества</td></tr>
                <tr><td>4</td><td>13-14</td><td>Демобилизация, акты</td></tr>
              </tbody></table></>)}
              {blocks.find(b => b.block_key === 'team') && (<><h2>Состав бригады</h2><ul><li>Руководитель работ — 1</li><li>Инженер ПНР — 1</li><li>Газоспасатель — 1</li><li>Монтажники — 3</li></ul></>)}
              {blocks.find(b => b.block_key === 'attach') && (<><h2>Приложения</h2><ul><li>Копии лицензий и допусков</li><li>Акты с аналогичных объектов</li><li>Сертификаты реагентов (МСДС)</li></ul></>)}
              {blocks.find(b => b.block_key === 'sign') && (
                <div className="pk3-sign-block">
                  <div>
                    <b style={{fontFamily:'Cinzel,serif'}}>ИСПОЛНИТЕЛЬ</b><br/>
                    Генеральный директор<br/>ООО «АСГАРД-Сервис»
                    <div className="pk3-sign-line"/>
                    Иванов И.И. / М.П.
                  </div>
                  <div>
                    <b style={{fontFamily:'Cinzel,serif'}}>ДАТА ВЫПУСКА</b><br/>{new Date().toLocaleDateString('ru-RU')}
                    <div style={{marginTop:18,fontSize:11,opacity:.7}}>ТКП действительно 30 дней</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="pk3-modal-foot">
          <Btn variant="ghost" onClick={onClose}>← Отмена</Btn>
          <span style={{color:'var(--t-3)',fontSize:11}}>Автосохранение: {autosaveText}</span>
          <div style={{flex:1}}/>
          <Btn onClick={saveDraft}>💾 Сохранить</Btn>
          <Btn onClick={downloadPdf}>📄 PDF</Btn>
          <Btn variant="gold" onClick={attachToCard}>✅ Готово · прикрепить</Btn>
        </div>
      </div>
    </div>
  );
}

function SendV3({ card, onClose, onSent }) {
  const [to, setTo]           = useState(card.customer_email || '');
  const [cc, setCc]           = useState('');
  const [subject, setSubject] = useState(`ТКП на работы по ${card.work_description ? card.work_description.slice(0, 60) : 'вашему запросу'}`);
  const [body, setBody]       = useState([
    `Уважаемый ${(card.contact_person || 'коллега').split(' ')[0]}!`,
    '', 'Благодарю за ваш запрос. Высылаю наше ТКП.', '',
    'Ключевые параметры:', '• Стоимость: 1 200 000 ₽ без НДС / 1 440 000 ₽ с НДС',
    '• Сроки выполнения: 14 рабочих дней', '• Гарантия: 12 месяцев', '• Аванс: 30%',
    '', 'Готов обсудить детали в удобное вам время.', '',
    'С уважением,', 'РП проекта', 'ООО «АСГАРД-Сервис»'
  ].join('\n'));
  const [sending, setSending] = useState(false);

  // FIX B1: XSS защита — escape HTML перед инжектом + отправкой как HTML.
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
  async function send() {
    if (!to || !to.includes('@')) { toast.error('Укажи корректный email'); return; }
    if (!subject) { toast.error('Укажи тему'); return; }
    setSending(true);
    const r = await tkpSendToClient(card.id, {
      tkp_id: card.tkp_id,
      to, cc: cc || undefined, subject,
      body_text: body, body_html: escapeHtml(body).replace(/\n/g, '<br>'),
      attach_pdf: true, attach_estimate: true,
    });
    setSending(false);
    if (r && !r.error) {
      toast.success('КП отправлено, карта перейдёт в «КП отправлено»');
      onClose(); onSent && onSent();
    } else toast.error((r && (r.message || r.error)) || 'Не отправилось');
  }

  return (
    <div className="pk3-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pk3-modal" style={{maxWidth:1100,maxHeight:'88vh'}}>
        <div className="pk3-modal-head">
          <span style={{fontSize:20,color:'var(--gold)'}}>📧</span>
          <h3>Отправка КП клиенту</h3>
          <button className="pk3-btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="pk3-modal-body">
          <div className="pk3-compose-grid">
            <div className="pk3-compose-form">
              <Row label="Кому *"><input value={to} onChange={e => setTo(e.target.value)}/></Row>
              <Row label="Копия"><input value={cc} onChange={e => setCc(e.target.value)} placeholder="дополнительные адресаты"/></Row>
              <Row label="От кого"><select><option>crm@asgard-service.com</option></select></Row>
              <Row label="Тема"><input value={subject} onChange={e => setSubject(e.target.value)}/></Row>
              <div className="pk3-row" style={{gridTemplateColumns:'150px 1fr'}}>
                <label>Текст письма</label>
                <textarea value={body} onChange={e => setBody(e.target.value)} style={{minHeight:200}}/>
              </div>
              <Row label="Вложения">
                <div style={{display:'flex',flexDirection:'column',gap:5}}>
                  <div className="pk3-doc-row"><span className="pk3-doc-ic">📄</span><span className="pk3-doc-name">ТКП.pdf</span><span className="pk3-doc-size">~340 КБ</span></div>
                  <div className="pk3-doc-row"><span className="pk3-doc-ic">📊</span><span className="pk3-doc-name">Смета.xlsx</span><span className="pk3-doc-size">~62 КБ</span></div>
                </div>
              </Row>
              <div style={{marginTop:11,padding:'9px 12px',background:'var(--bg-3)',border:'1px solid var(--brd-2)',borderRadius:5,fontSize:11,color:'var(--t-3)'}}>
                💡 После отправки карта переедет в «📤 КП отправлено».
              </div>
            </div>
            <div className="pk3-compose-preview">
              <div style={{borderBottom:'1px solid #cdb87e',paddingBottom:9,marginBottom:11,fontSize:11,color:'#7a5a22'}}>
                <b>От:</b> crm@asgard-service.com<br/>
                <b>Кому:</b> {to}<br/>
                <b>Тема:</b> {subject}
              </div>
              <div dangerouslySetInnerHTML={{ __html: escapeHtml(body).replace(/\n/g, '<br>') }}/>
              <div style={{marginTop:14,paddingTop:11,borderTop:'1px solid #cdb87e',fontSize:11,color:'#7a5a22'}}>
                📎 <b>2 вложения:</b> ТКП.pdf, Смета.xlsx
              </div>
            </div>
          </div>
        </div>
        <div className="pk3-modal-foot">
          <Btn variant="ghost" onClick={onClose}>← Отмена</Btn>
          <div style={{flex:1}}/>
          <Btn>💾 Черновик</Btn>
          <Btn variant="gold" onClick={send} disabled={sending}>{sending ? '⏳ Отправка…' : '📧 Отправить'}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SmetaTableEditable — Excel-style редактируемая таблица сметы.
 * РП может изменить название/единицу/количество/цену любой позиции,
 * добавить новую, удалить, изменить НДС. Авто-пересчёт сумм.
 * Сохраняется в block_data.items[] и block_data.vat_pct через onChange.
 * ═══════════════════════════════════════════════════════════════════════════ */
function SmetaTableEditable({ block, onChange }) {
  const DEFAULT_ITEMS = [
    { name: 'Подготовка',         unit: 'шт',     qty: 1,  price: 28500  },
    { name: 'Основные работы',    unit: 'м²',     qty: 42, price: 14500  },
    { name: 'Контроль качества',  unit: 'точек',  qty: 16, price: 3000   },
    { name: 'Логистика',          unit: 'компл',  qty: 1,  price: 144000 },
    { name: 'Реагенты',           unit: 'компл',  qty: 1,  price: 370500 },
  ];
  const data = block.block_data || {};
  const items = (Array.isArray(data.items) && data.items.length) ? data.items : DEFAULT_ITEMS;
  const vatPct = data.vat_pct != null ? Number(data.vat_pct) : 20;

  function update(newItems, newVat) {
    onChange({
      ...data,
      items: newItems,
      vat_pct: newVat != null ? newVat : vatPct,
    });
  }
  function changeRow(i, field, value) {
    const arr = [...items];
    const v = (field === 'qty' || field === 'price') ? (parseFloat(value) || 0) : value;
    arr[i] = { ...arr[i], [field]: v };
    update(arr);
  }
  function addRow() {
    update([...items, { name: '', unit: 'шт', qty: 1, price: 0 }]);
  }
  function delRow(i) {
    const arr = items.filter((_, j) => j !== i);
    update(arr.length ? arr : DEFAULT_ITEMS);
  }
  function changeVat(v) {
    update(items, parseFloat(v) || 0);
  }
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
  const total = items.reduce((s, it) => s + ((Number(it.qty) || 0) * (Number(it.price) || 0)), 0);
  const vatAmount = total * vatPct / 100;
  const totalWithVat = total + vatAmount;

  const inputStyle = {
    width:'100%', background:'transparent', border:'1px solid transparent',
    padding:'3px 4px', color:'#2a1f0a', font:'inherit',
  };
  const inputFocusable = (e) => { e.target.style.border = '1px solid #b89860'; e.target.style.background = '#fff'; };
  const inputBlur     = (e) => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; };

  return (
    <>
      <h2 style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span>Смета работ</span>
        <span style={{fontSize:11,color:'#7a5a22',fontStyle:'italic',fontWeight:'normal'}}>✏️ Редактируйте поля прямо в таблице</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th style={{width:28}}>№</th>
            <th>Наименование</th>
            <th style={{width:60}} className="pk3-right">Ед.</th>
            <th style={{width:70}} className="pk3-right">Кол-во</th>
            <th style={{width:110}} className="pk3-right">Цена</th>
            <th style={{width:130}} className="pk3-right">Сумма</th>
            <th style={{width:24}}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const sum = (Number(it.qty) || 0) * (Number(it.price) || 0);
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><input type="text"   value={it.name || ''} onChange={e => changeRow(i, 'name', e.target.value)}  onFocus={inputFocusable} onBlur={inputBlur} style={inputStyle}/></td>
                <td><input type="text"   value={it.unit || ''} onChange={e => changeRow(i, 'unit', e.target.value)}  onFocus={inputFocusable} onBlur={inputBlur} style={{...inputStyle, textAlign:'right'}}/></td>
                <td><input type="number" min="0" step="0.01" value={Number(it.qty) || 0}   onChange={e => changeRow(i, 'qty', e.target.value)}   onFocus={inputFocusable} onBlur={inputBlur} style={{...inputStyle, textAlign:'right'}}/></td>
                <td><input type="number" min="0" step="1"    value={Number(it.price) || 0} onChange={e => changeRow(i, 'price', e.target.value)} onFocus={inputFocusable} onBlur={inputBlur} style={{...inputStyle, textAlign:'right'}}/></td>
                <td className="pk3-right" style={{fontWeight:600}}>{fmt(sum)}</td>
                <td><button onClick={() => delRow(i)} title="Удалить" style={{background:'transparent',border:0,color:'#a94440',cursor:'pointer',fontSize:14}}>✕</button></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={7} style={{padding:'7px 4px'}}>
              <button onClick={addRow} style={{background:'#e8d8a8',border:'1px solid #b89860',padding:'5px 10px',borderRadius:4,color:'#3d2a08',cursor:'pointer',fontWeight:600,fontFamily:'Cinzel,serif'}}>+ Добавить позицию</button>
            </td>
          </tr>
          <tr><td colSpan={5} className="pk3-right">Итого без НДС:</td><td className="pk3-right">{fmt(total)}</td><td/></tr>
          <tr>
            <td colSpan={5} className="pk3-right">
              НДС <input type="number" min="0" max="100" step="1" value={vatPct} onChange={e => changeVat(e.target.value)} style={{width:42,background:'transparent',border:'1px solid #b89860',padding:'1px 4px',color:'#2a1f0a',font:'inherit',textAlign:'right'}}/>%:
            </td>
            <td className="pk3-right">{fmt(vatAmount)}</td><td/>
          </tr>
          <tr><td colSpan={5} className="pk3-right" style={{fontSize:13}}><b>Итого с НДС:</b></td><td className="pk3-right" style={{fontSize:13}}><b>{fmt(totalWithVat)}</b></td><td/></tr>
        </tfoot>
      </table>
    </>
  );
}
