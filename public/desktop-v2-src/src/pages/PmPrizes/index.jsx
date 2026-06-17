/**
 * Страница /pm-prizes — Призы воинов (запросы + история).
 *
 * Источник: vanilla `public/assets/js/pm-prizes.js` (451 строка).
 * Backend: /api/gamification/admin/{pending-deliveries, delivered-history, inventory/:id/deliver}
 *
 *   ✅ Табы Запросы / История
 *   ✅ Группировка по воинам с раскрытием
 *   ✅ Фильтры (поиск, статус, категория)
 *   ✅ DeliverModal через PromptModal (заметка о выдаче)
 *   ✅ Pulse на urgent карточках
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { PromptModal } from '@/modals';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import {
  loadPending, loadHistory, deliverPrize,
  STATUS_LABEL, STATUS_TONE, catMeta,
  fmtDateTime, initials,
} from './api';

import './pm-prizes.css';

export default function PmPrizesPage() {
  const { user: _user } = useAuth();
  const modal = useModal();

  const [tab, setTab] = useState('requests');
  const [deliveries, setDeliveries] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [pend, hist] = await Promise.all([loadPending(), loadHistory()]);
      const requested = pend?.requested || [];
      const won = pend?.won || [];
      setDeliveries([...requested, ...won]);
      setHistory(hist?.history || []);
    } catch (e) {
      toast.error('Не удалось загрузить призы: ' + String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const stats = useMemo(() => {
    const requested = deliveries.filter((d) => d.status === 'requested').length;
    const pending = deliveries.filter((d) => d.status === 'pending').length;
    const workers = new Set(deliveries.map((d) => d.employee_id)).size;
    return { requested, pending, workers };
  }, [deliveries]);

  const onDeliver = (row) => {
    modal.open(
      <PromptModal
        icon="⚔️"
        title="Выдача приза"
        subtitle={`${row.employee_name} — ${row.item_name}`}
        label="Заметка о выдаче (необязательно)"
        placeholder="Например: выдано на объекте ул. Ленина"
        multiline
        confirmLabel="⚔️ Подтвердить выдачу"
        accent="gold"
        onSubmit={async (note) => {
          try {
            await deliverPrize(row.id, (note || '').trim() || undefined);
            toast.success('Приз выдан — уведомление отправлено рабочему');
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + String(e?.message || e));
          }
        }}
      />
    );
  };

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Геймификация"
        title="⚔️ Призы воинов"
        subtitle="Запросы на выдачу и история призов"
        actions={<Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>}
      />

      <div className="pp-stats">
        <PpStat ico="⚔️" color="var(--gold)" v={stats.workers} l="Воинов с призами" />
        <PpStat ico="📩" color="var(--amber)" v={stats.requested} l="Запрошено" />
        <PpStat ico="⏳" color="var(--t-3)" v={stats.pending} l="Ожидают" />
      </div>

      <TabsBar
        tabs={[
          { id: 'requests', label: '📩 Запросы' },
          { id: 'history', label: '📜 История' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {loading ? (
        <div className="card t-center p-32 c-t3" >⚔️ Загрузка данных…</div>
      ) : tab === 'requests' ? (
        <RequestsTab deliveries={deliveries} onDeliver={onDeliver} />
      ) : (
        <HistoryTab history={history} />
      )}
    </div>
  );
}

function PpStat({ ico, color, v, l }) {
  return (
    <div className="pp-stat">
      <span className="pp-stat-ico">{ico}</span>
      <div>
        <div className="pp-stat-v" style={{ color }}>{v}</div>
        <div className="pp-stat-l">{l}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * REQUESTS TAB
 * ═══════════════════════════════════════════════════════════════════════ */
function RequestsTab({ deliveries, onDeliver }) {
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);  // G-11: debounce 300мс
  const [statusF, setStatusF] = useState('all');
  const [catF, setCatF] = useState('all');
  const [expanded, setExpanded] = useState(new Set());

  // Сгруппировать по воину
  const workers = useMemo(() => {
    const map = new Map();
    deliveries.forEach((row) => {
      if (!map.has(row.employee_id)) {
        map.set(row.employee_id, {
          id: row.employee_id,
          name: row.employee_name,
          phone: row.employee_phone,
          work: row.work_name,
          items: [],
        });
      }
      map.get(row.employee_id).items.push(row);
    });
    // Сортировка items
    map.forEach((w) => w.items.sort((a, b) => {
      if (a.status === 'requested' && b.status !== 'requested') return -1;
      if (b.status === 'requested' && a.status !== 'requested') return 1;
      return new Date(b.requested_at || b.created_at) - new Date(a.requested_at || a.created_at);
    }));
    // Сортировка воинов: urgent → имя
    return [...map.values()].sort((a, b) => {
      const aU = a.items.some((i) => i.status === 'requested') ? 0 : 1;
      const bU = b.items.some((i) => i.status === 'requested') ? 0 : 1;
      if (aU !== bU) return aU - bU;
      return (a.name || '').localeCompare(b.name || '', 'ru');
    });
  }, [deliveries]);

  const cats = useMemo(() => {
    const set = new Set();
    deliveries.forEach((d) => set.add(d.item_category || 'merch'));
    return [...set];
  }, [deliveries]);

  // Применить фильтр клиента
  const visible = useMemo(() => {
    const ql = dq.trim().toLowerCase();
    return workers
      .map((w) => {
        if (ql && !(w.name || '').toLowerCase().includes(ql)) return null;
        const items = w.items.filter((it) => {
          if (statusF !== 'all' && it.status !== statusF) return false;
          if (catF !== 'all' && (it.item_category || 'merch') !== catF) return false;
          return true;
        });
        if (!items.length) return null;
        return { ...w, items };
      })
      .filter(Boolean);
  }, [workers, dq, statusF, catF]);

  const cntAll = deliveries.length;
  const cntReq = deliveries.filter((d) => d.status === 'requested').length;
  const cntPend = deliveries.filter((d) => d.status === 'pending').length;

  const _toggle = (id) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (!deliveries.length) {
    return (
      <EmptyState icon="⚔️" title="Нет активных запросов" hint="Воины ещё не запросили свои призы" />
    );
  }

  return (
    <>
      <div className="pp-filters">
        <div style={{ minWidth: 220, maxWidth: 320, flex: 1 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Поиск по воину…" />
        </div>
        <div className="pp-chip-row">
          <Chip active={statusF === 'all'} onClick={() => setStatusF('all')}>Все ({cntAll})</Chip>
          <Chip active={statusF === 'requested'} onClick={() => setStatusF('requested')}>📩 Запрошено ({cntReq})</Chip>
          <Chip active={statusF === 'pending'} onClick={() => setStatusF('pending')}>⏳ Ожидают ({cntPend})</Chip>
        </div>
      </div>

      <div className="pp-chip-row">
        <Chip active={catF === 'all'} onClick={() => setCatF('all')}>Все категории</Chip>
        {cats.map((c) => {
          const m = catMeta(c);
          return (
            <Chip key={c} active={catF === c} onClick={() => setCatF(c)}>
              {m.icon} {m.label}
            </Chip>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="🔍" title="Ничего не найдено" hint="Попробуйте сбросить фильтры." />
      ) : (
        <div>
          {visible.map((w) => {
            const hasReq = w.items.some((i) => i.status === 'requested');
            const reqCnt = w.items.filter((i) => i.status === 'requested').length;
            const pendCnt = w.items.filter((i) => i.status === 'pending').length;
            const _isOpen = expanded.has(w.id) || true; // по умолчанию раскрыто (как в vanilla)
            // Чтобы был toggle:
            const open = !expanded.has('closed:' + w.id);

            return (
              <div key={w.id} className={'pp-wcard' + (hasReq ? ' urgent' : '')}>
                <div
                  className="pp-whdr"
                  onClick={() => setExpanded((s) => {
                    const next = new Set(s);
                    const key = 'closed:' + w.id;
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  })}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      setExpanded((s) => {
                        const next = new Set(s);
                        const key = 'closed:' + w.id;
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                      });
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  aria-label={`Сотрудник ${w.name}`}
                >
                  <div className={'pp-wavatar' + (hasReq ? ' urgent' : '')}>{initials(w.name)}</div>
                  <div className="flex-1">
                    <div className="pp-wname">{w.name}</div>
                    <div className="pp-wmeta">
                      {w.work && <span>🏗 {w.work}</span>}
                      {w.phone && <span>📞 {w.phone}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginRight: 10 }}>
                    {reqCnt > 0 && <span className="pp-cbadge req">📩 {reqCnt}</span>}
                    {pendCnt > 0 && <span className="pp-cbadge pend">⏳ {pendCnt}</span>}
                  </div>
                  <span className={'pp-chevron' + (open ? ' open' : '')}>▼</span>
                </div>
                {open && (
                  <div className="pp-wbody">
                    {w.items.map((row) => {
                      const m = catMeta(row.item_category || 'merch');
                      const isReq = row.status === 'requested';
                      const ts = row.requested_at ? fmtDateTime(row.requested_at) : fmtDateTime(row.created_at);
                      return (
                        <div key={row.id} className={'pp-item' + (isReq ? ' req' : '')}>
                          <div className="pp-iicon" style={{ background: m.color + '22', color: m.color }}>
                            {m.icon}
                          </div>
                          <div className="flex-1">
                            <div className="pp-iname">{row.item_name}</div>
                            <div className="pp-idate">{isReq ? '📩' : '📋'} {ts}</div>
                          </div>
                          <Pill tone={STATUS_TONE[row.status] || 'default'}>{STATUS_LABEL[row.status] || row.status}</Pill>
                          <Btn variant="primary" size="sm" onClick={() => onDeliver(row)}>⚔️ Выдать</Btn>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 13px',
        borderRadius: 'var(--r-pill)',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        border: '1.5px solid ' + (active ? 'var(--gold)' : 'var(--brd-1)'),
        background: active ? 'var(--gold-bg, rgba(200,168,75,0.12))' : 'var(--inner-bg)',
        color: active ? 'var(--gold)' : 'var(--t-3)',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        transition: 'all 0.17s',
      }}
    >
      {children}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * HISTORY TAB
 * ═══════════════════════════════════════════════════════════════════════ */
function HistoryTab({ history }) {
  if (!history.length) {
    return <EmptyState icon="📜" title="История пуста" hint="Ещё ни один приз не был выдан" />;
  }
  return (
    <div>
      {history.map((row) => (
        <div key={row.id} className="pp-history-row">
          <div className="pp-history-icon">✅</div>
          <div className="flex-1">
            <div className="pp-history-name">{row.item_name}</div>
            <div className="pp-history-meta">
              👤 {row.employee_name}
              {row.delivered_by_name && <> · Выдал: {row.delivered_by_name}</>}
            </div>
            {row.delivery_note && <div className="pp-history-note">«{row.delivery_note}»</div>}
          </div>
          <div className="t-right flex-shrink-0">
            <Pill tone="ok">{row.status === 'confirmed' ? 'Получен' : 'Выдан'}</Pill>
            <div className="fs-10 c-t3 mt-4">{fmtDateTime(row.delivered_at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
