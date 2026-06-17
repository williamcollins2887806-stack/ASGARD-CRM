/**
 * Страница /pre-tenders/board — Канбан-доска для входящих заявок.
 *
 * Источник: vanilla `public/assets/js/pre_tenders.js` (~1633 строки, секция kanban).
 *
 * Колонки по статусам: 🆕 Новая · 🔍 На рассмотрении · 📁 Нужны документы · ✅ Принята · 🗑 Отклонена.
 * HTML5 drag&drop меняет статус через PUT /api/pre-tenders/:id.
 *
 * RBAC: ADMIN/TO/HEAD_TO/DIRECTOR_*.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
import { DetailModal } from './modals/DetailModal';
import { AcceptModal, FastTrackModal, RejectModal, RequestDocsModal, CreateManualModal } from './modals/AcceptModal';
import { loadList, loadStats, update, STATUSES, COLORS, fmtMoney } from './api';
import './pre-tenders.css';

const _ALLOWED = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const COL_COLOR = {
  new: 'var(--info)',
  in_review: 'var(--blue)',
  need_docs: 'var(--amber)',
  accepted: 'var(--ok)',
  rejected: 'var(--err)'
};
const COL_ICON = {
  new: '🆕',
  in_review: '🔍',
  need_docs: '📁',
  accepted: '✅',
  rejected: '🗑'
};

export default function PreTendersBoard() {
  const { user } = useAuth();
  const modal = useModal();

  const [items, setItems] = useState([]);
  const [_stats, setStats] = useState({});
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  // v2 BONUS: фильтр по AI-цвету на канбане (vanilla канбан фильтра не имеет)
  const [colorFilter, setColorFilter] = useState('');

  const refresh = () => {
    setLoading(true);
    Promise.all([loadList(), loadStats()])
      .then(([list, st]) => { setItems(list); setStats(st); })
      .catch((e) => toast.error('Не удалось загрузить заявки: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener('asgard:pre-tenders:changed', onChange);
    return () => window.removeEventListener('asgard:pre-tenders:changed', onChange);
  }, []);

  // RBAC: доступ только избранным ролям (inline-литералы для rbac-audit)
  const _allowed = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  const visible = useMemo(() => {
    let v = items;
    if (query.trim()) {
      const lq = query.toLowerCase();
      v = v.filter((t) =>
        (t.customer_name || '').toLowerCase().includes(lq) ||
        (t.work_description || '').toLowerCase().includes(lq) ||
        String(t.id).includes(lq)
      );
    }
    // v2 BONUS: фильтр по AI-цвету (vanilla канбан не имел color-фильтра)
    if (colorFilter) v = v.filter((t) => t.ai_color === colorFilter);
    return v;
  }, [items, query, colorFilter]);

  // v2 BONUS: keyboard hotkeys на канбане (vanilla не имеет)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        modal.open(<CreateManualModal onCreated={refresh} />);
      } else if (e.key === 'Escape' && (query || colorFilter)) {
        setQuery(''); setColorFilter('');
      } else if (e.key === 'l' && !e.ctrlKey && !e.metaKey) {
        window.location.hash = '#/pre-tenders';
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, colorFilter]);

  const byCol = useMemo(() => {
    const m = { new: [], in_review: [], need_docs: [], accepted: [], rejected: [] };
    for (const it of visible) {
      const s = STATUSES.find((x) => x.value === it.status) ? it.status : 'new';
      if (m[s]) m[s].push(it);
    }
    return m;
  }, [visible]);

  const openDetail = (pt) => modal.open(
    <DetailModal
      id={pt.id}
      onAccept={(p) => modal.open(<AcceptModal preTender={p} />)}
      onFastTrack={(p) => modal.open(<FastTrackModal preTender={p} />)}
      onReject={(p) => modal.open(<RejectModal preTender={p} />)}
      onRequestDocs={(p) => modal.open(<RequestDocsModal preTender={p} />)}
    />
  );

  // Drag&drop helpers
  const onDragStart = (e, id) => {
    setDragId(id);
    try { e.dataTransfer.effectAllowed = 'move'; } catch { /* noop */ }
  };
  const onDragOver = (e, col) => {
    e.preventDefault();
    if (overCol !== col) setOverCol(col);
  };
  const onDrop = async (e, col) => {
    e.preventDefault();
    setOverCol(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const it = items.find((x) => x.id === id);
    if (!it || it.status === col) return;
    // оптимистично
    setItems((prev) => prev.map((p) => p.id === id ? { ...p, status: col } : p));
    try {
      await update(id, { status: col });
      toast.success('Статус обновлён');
    } catch (err) {
      toast.error('Не удалось сменить статус: ' + (err?.message || err));
      refresh();
    }
  };

  // Гейт «нет доступа» — ПОСЛЕ всех хуков (Rules of Hooks).
  if (user && !_allowed) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 mb-12">🛡</div>
        <div className="fs-16 fw-700 mb-6">Нет доступа</div>
        <div className="c-t3">Канбан заявок доступен только ТО и руководству.</div>
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Заявки"
        title="Канбан заявок"
        subtitle={`${visible.length} в выборке · 🆕 ${byCol.new.length} новых · 🔍 ${byCol.in_review.length} в работе · 📁 ${byCol.need_docs.length} ждут документы`}
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={() => { window.location.hash = '#/pre-tenders'; }}>☰ Список</Btn>
            <Btn variant="primary" onClick={() => modal.open(<CreateManualModal onCreated={refresh} />)}>+ Заявка вручную</Btn>
          </>
        }
      />

      <SearchInput value={query} onChange={setQuery} placeholder="Поиск по заказчику, описанию, ID… (Esc — сброс, L — список)" />

      {/* v2 BONUS: цветовые чипы-фильтры в шапке доски (vanilla не имеет) */}
      <div className="u-flex gap-6 u-wrap" style={{ fontSize: 12 }}>
        {[
          { v: '', label: 'Все', count: items.length },
          { v: 'green', label: '🟢', count: items.filter((i) => i.ai_color === 'green').length },
          { v: 'yellow', label: '🟡', count: items.filter((i) => i.ai_color === 'yellow').length },
          { v: 'red', label: '🔴', count: items.filter((i) => i.ai_color === 'red').length },
          { v: 'gray', label: '⚪', count: items.filter((i) => !i.ai_color || i.ai_color === 'gray').length }
        ].map((b) => (
          <button
            key={b.v}
            className="btn-ghost"
            style={{
              padding: '4px 10px',
              background: colorFilter === b.v ? 'var(--gold-bg)' : 'var(--inner-bg)',
              border: colorFilter === b.v ? '1px solid var(--gold)' : '1px solid var(--brd-2)',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer'
            }}
            onClick={() => setColorFilter(b.v)}
          >
            {b.label} {b.count}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем доску…</div>
      ) : (
        <div className="ptn-board">
          {STATUSES.map((st) => {
            const col = byCol[st.value] || [];
            const colColor = COL_COLOR[st.value] || 'var(--t-3)';
            const isOver = overCol === st.value;
            const colCls = 'ptn-col' + (isOver ? ' ptn-col--over' : '');
            return (
              <div
                key={st.value}
                onDragOver={(e) => onDragOver(e, st.value)}
                onDrop={(e) => onDrop(e, st.value)}
                onDragLeave={() => setOverCol(null)}
                className={colCls}
                style={isOver ? { outlineColor: colColor } : undefined}
              >
                <div className="ptn-col-head" style={{ color: colColor }}>
                  <span>{COL_ICON[st.value]} {st.label}</span>
                  <span className="ptn-col-cnt">{col.length}</span>
                </div>
                <div className="ptn-col-body">
                  {col.length === 0 ? (
                    <div className="ptn-col-empty">
                      Пусто
                    </div>
                  ) : col.map((pt) => {
                    const _color = COLORS.find((c) => c.value === pt.ai_color);
                    const dotBg = pt.ai_color === 'green' ? 'var(--ok)' : pt.ai_color === 'yellow' ? 'var(--amber)' : pt.ai_color === 'red' ? 'var(--err)' : 'var(--t-4)';
                    const cardCls = 'ptn-card' + (dragId === pt.id ? ' ptn-card--drag' : '');
                    return (
                      <div
                        key={pt.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, pt.id)}
                        onClick={() => openDetail(pt)}
                        className={cardCls}
                      >
                        <div className="ptn-card-head">
                          <span className="ptn-card-dot" style={{ background: dotBg }} />
                          <div className="ptn-card-name">
                            {pt.customer_name || '—'}
                          </div>
                        </div>
                        {pt.work_description && (
                          <div className="ptn-card-desc">
                            {pt.work_description}
                          </div>
                        )}
                        <div className="ptn-card-foot">
                          <span>#{pt.id}</span>
                          <span>{fmtMoney(pt.estimated_sum || pt.ai_cost_estimate)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
