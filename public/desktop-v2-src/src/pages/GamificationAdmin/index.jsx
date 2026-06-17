/**
 * Страница /gamification-admin — Кузница геймификации.
 *
 * Источник: vanilla `public/assets/js/gamification-crud.js` (616 строк).
 * Backend:
 *   /api/gamification/crud/{shop-items,prizes,quests,winners}
 *   /api/gamification/admin/dashboard
 *
 *   ✅ 4 таба: Товары · Рулетка · Квесты · Победители
 *   ✅ Шапка-сводка из dashboard
 *   ✅ Полный CRUD товаров + квестов через FormModal
 *   ✅ Toggle призов (включить/отключить)
 *   ✅ Фильтр победителей (статус + период) + действия выдачи
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { ConfirmModal, PromptModal } from '@/modals';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';

import {
  loadDashboard, loadShopItems, deactivateShopItem,
  loadPrizes, togglePrize,
  loadQuests, deactivateQuest,
  loadWinners, markDelivery,
  TIER_COLORS, TIER_LABELS, CAT_LABELS, DELIVERY_LABELS, DELIVERY_TONE,
  fmt, fmtDate,
} from './api';
import { ShopItemModal } from './ShopItemModal';
import { QuestModal } from './QuestModal';

import './gamification-admin.css';

export default function GamificationAdminPage() {
  const { user } = useAuth();
  const modal = useModal();
  const navigate = useNavigate();

  const [tab, setTab] = useState('shop');
  const [dashboard, setDashboard] = useState(null);

  useEffect(() => {
    loadDashboard()
      .then(setDashboard)
      .catch(() => { /* без шапки страница работает */ });
  }, []);

  const kpi = dashboard?.kpi || {};

  return (
    <div className="col gap-16">
      <TopActionsBar
        kicker="Геймификация"
        title="⚔ Кузница геймификации"
        subtitle={
          dashboard
            ? `${fmt(kpi.runes_in_circulation)} ᚱ в обороте · ${kpi.spins_today || 0} спинов сегодня · ${kpi.prizes_delivered_month || 0} выдач за месяц`
            : 'Магазин, рулетка, квесты, призы — управление в одном месте.'
        }
        actions={<Btn variant="ghost" onClick={() => navigate('/gamification-leaderboard')}>🏆 Рейтинг рабочих</Btn>}
      />

      <TabsBar
        tabs={[
          { id: 'shop', label: '🛍 Товары магазина' },
          { id: 'prizes', label: '🎰 Рулетка' },
          { id: 'quests', label: '⚔ Квесты' },
          { id: 'winners', label: '🏆 Победители' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'shop' && <ShopTab user={user} modal={modal} />}
      {tab === 'prizes' && <PrizesTab user={user} modal={modal} />}
      {tab === 'quests' && <QuestsTab user={user} modal={modal} />}
      {tab === 'winners' && <WinnersTab user={user} modal={modal} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * SHOP TAB
 * ═══════════════════════════════════════════════════════════════════════ */
function ShopTab({ modal }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadShopItems()
      .then((d) => setItems(d?.items || []))
      .catch((e) => toast.error(String(e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const onAdd = () => modal.open(<ShopItemModal onSaved={refresh} />);
  const onEdit = (item) => modal.open(<ShopItemModal item={item} onSaved={refresh} />);
  const onDeactivate = (item) => modal.open(
    <ConfirmModal
      icon="🗑"
      title="Деактивировать товар?"
      message={`"${item.name}" исчезнет из магазина и рулетки. Восстановить можно через редактирование (флаг "Активен").`}
      tone="danger"
      confirmLabel="Деактивировать"
      onConfirm={async () => {
        try {
          await deactivateShopItem(item.id);
          toast.success('Товар деактивирован');
          refresh();
        } catch (e) {
          toast.error(String(e?.message || e));
        }
      }}
    />
  );

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div className="fs-13 c-t3">{items.length} товаров в магазине</div>
        <Btn variant="primary" onClick={onAdd}>+ Добавить товар</Btn>
      </div>

      {loading ? (
        <div className="card t-center p-32 c-t3" >⏳ Загружаю…</div>
      ) : items.length === 0 ? (
        <EmptyState icon="🛍" title="Магазин пуст" hint="Добавьте первый товар — он автоматически попадёт в рулетку." action={<Btn variant="primary" onClick={onAdd}>+ Добавить товар</Btn>} />
      ) : (
        <div className="ga-grid">
          {items.map((item) => (
            <ShopCard key={item.id} item={item} onEdit={() => onEdit(item)} onDeactivate={() => onDeactivate(item)} />
          ))}
        </div>
      )}
    </>
  );
}

function ShopCard({ item, onEdit, onDeactivate }) {
  const tierColor = TIER_COLORS[item.rarity] || 'var(--t-3)';
  const rouletteInfo = item.roulette_pct
    ? <span style={{ color: 'var(--gold)', fontSize: 11 }}>🎰 {item.roulette_pct}% в рулетке</span>
    : <span className="fs-11 c-t3">не в рулетке</span>;

  return (
    <div className={'ga-card' + (item.is_active ? '' : ' inactive')}>
      <div className="ga-card-row">
        <div className="ga-card-icon">{item.icon || '📦'}</div>
        <div className="flex-1">
          <div className="ga-card-name">{item.name}</div>
          <div className="ga-card-desc">{item.description || ''}</div>
          <div className="ga-card-pills">
            <span className="ga-pill price">{item.price_runes} ᚱ</span>
            <span className="ga-pill" style={{ background: tierColor + '22', color: tierColor }}>
              {TIER_LABELS[item.rarity] || item.rarity}
            </span>
            <span className="ga-pill">{CAT_LABELS[item.category] || item.category}</span>
          </div>
        </div>
      </div>
      <div className="ga-card-foot">
        <div className="ga-card-foot-info">
          {rouletteInfo}
          <span>Запас: {item.max_stock ? `${item.current_stock}/${item.max_stock}` : '∞'}</span>
        </div>
        <div className="ga-card-actions">
          <Btn variant="ghost" size="sm" onClick={onEdit}>✏ Изменить</Btn>
          <Btn variant="danger-ghost" size="sm" onClick={onDeactivate}>✕</Btn>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * PRIZES TAB
 * ═══════════════════════════════════════════════════════════════════════ */
function PrizesTab() {
  const [data, setData] = useState({ prizes: [], total_weight: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadPrizes()
      .then((d) => setData({ prizes: d?.prizes || [], total_weight: d?.total_weight || 0 }))
      .catch((e) => toast.error(String(e?.message || e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  const onToggle = async (p) => {
    try {
      const r = await togglePrize(p.id);
      toast.success(r?.is_active ? 'Приз включён' : 'Приз отключён');
      refresh();
    } catch (e) {
      toast.error(String(e?.message || e));
    }
  };

  const activeCnt = data.prizes.filter((p) => p.is_active).length;

  return (
    <>
      <div className="ga-info-banner">
        🎰 <b>Все призы рулетки — это товары магазина.</b> Чтобы добавить приз — добавьте товар на вкладке «Товары».
        Суммарный вес: <b className="c-t1">{data.total_weight}</b>.
        Активных призов: <b className="c-ok">{activeCnt}</b>.
      </div>

      {loading ? (
        <div className="card t-center p-32 c-t3" >⏳ Загружаю…</div>
      ) : data.prizes.length === 0 ? (
        <EmptyState icon="🎰" title="Призов нет" hint="Призы появятся, как только вы добавите товары." />
      ) : (
        <div className="ga-table ov-x-auto" >
          <table className="ga-table">
            <thead>
              <tr>
                <th></th>
                <th>Товар</th>
                <th>Редкость</th>
                <th>Категория</th>
                <th>Цена</th>
                <th>Вес</th>
                <th>% шанс</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {data.prizes.map((p) => {
                const tc = TIER_COLORS[p.tier] || 'var(--t-3)';
                return (
                  <tr key={p.id}>
                    <td><span className={'dot ' + (p.is_active ? 'on' : 'off')}>●</span></td>
                    <td>
                      <b>{p.name}</b>
                      <div className="fs-11 c-t3">{p.description || ''}</div>
                    </td>
                    <td><span style={{ color: tc, fontWeight: 700 }}>{TIER_LABELS[p.tier] || p.tier}</span></td>
                    <td>{CAT_LABELS[p.item_category] || (p.item_category || '—')}</td>
                    <td>{p.price_runes ? `${p.price_runes} ᚱ` : '—'}</td>
                    <td>{p.weight}</td>
                    <td>{p.is_active ? <b className="c-gold">{p.roulette_pct}%</b> : <span className="c-t3">0%</span>}</td>
                    <td>
                      <Btn variant={p.is_active ? 'danger-ghost' : 'success-ghost'} size="sm" onClick={() => onToggle(p)}>
                        {p.is_active ? 'Отключить' : 'Включить'}
                      </Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * QUESTS TAB
 * ═══════════════════════════════════════════════════════════════════════ */
function QuestsTab({ modal }) {
  const [quests, setQuests] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadQuests()
      .then((d) => setQuests(d?.quests || []))
      .catch((e) => toast.error(String(e?.message || e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  const onAdd = () => modal.open(<QuestModal onSaved={refresh} />);
  const onEdit = (q) => modal.open(<QuestModal quest={q} onSaved={refresh} />);
  const onDeactivate = (q) => modal.open(
    <ConfirmModal
      icon="🗑"
      title="Деактивировать квест?"
      message={`Квест "${q.name}" перестанет начисляться. Можно вернуть через редактирование.`}
      tone="danger"
      confirmLabel="Деактивировать"
      onConfirm={async () => {
        try {
          await deactivateQuest(q.id);
          toast.success('Квест деактивирован');
          refresh();
        } catch (e) {
          toast.error(String(e?.message || e));
        }
      }}
    />
  );

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Btn variant="primary" onClick={onAdd}>+ Добавить квест</Btn>
      </div>

      {loading ? (
        <div className="card t-center p-32 c-t3" >⏳ Загружаю…</div>
      ) : quests.length === 0 ? (
        <EmptyState icon="⚔" title="Квестов нет" hint="Создайте первый квест — рабочие смогут получать руны/XP за выполнение." action={<Btn variant="primary" onClick={onAdd}>+ Добавить квест</Btn>} />
      ) : (
        <div className="ov-x-auto">
          <table className="ga-table">
            <thead>
              <tr>
                <th></th>
                <th>Тип</th>
                <th>Название</th>
                <th>Цель</th>
                <th>Награда</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {quests.map((q) => (
                <tr key={q.id}>
                  <td><span className={'dot ' + (q.is_active ? 'on' : 'off')}>●</span></td>
                  <td>{q.quest_type}</td>
                  <td>
                    <b>{q.name}</b>
                    <div className="fs-11 c-t3">{q.description || ''}</div>
                  </td>
                  <td>{q.target_action} × {q.target_count}</td>
                  <td><b className="c-gold">{q.reward_amount} {q.reward_type}</b></td>
                  <td>
                    <Btn variant="ghost" size="sm" onClick={() => onEdit(q)}>✏</Btn>
                    {' '}
                    <Btn variant="danger-ghost" size="sm" onClick={() => onDeactivate(q)}>✕</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * WINNERS TAB
 * ═══════════════════════════════════════════════════════════════════════ */
function WinnersTab({ modal }) {
  const [filter, setFilter] = useState({ status: '', from: '', to: '' });
  const [data, setData] = useState({ wins: [], stats: {} });
  const [loading, setLoading] = useState(true);

  const refresh = (f = filter) => {
    setLoading(true);
    loadWinners(f)
      .then((d) => setData({ wins: d?.wins || [], stats: d?.stats || {} }))
      .catch((e) => toast.error(String(e?.message || e)))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const apply = () => refresh(filter);
  const reset = () => {
    const f = { status: '', from: '', to: '' };
    setFilter(f);
    refresh(f);
  };

  const onMarkReady = async (fid) => {
    try {
      await markDelivery(fid, 'ready');
      toast.success('Статус: готово к выдаче');
      refresh();
    } catch (e) {
      toast.error(String(e?.message || e));
    }
  };
  const onMarkDelivered = (fid) => {
    modal.open(
      <PromptModal
        icon="✅"
        title="Подтвердить выдачу"
        label="Комментарий к выдаче (необязательно)"
        placeholder="Например: выдано на объекте ул. Ленина"
        multiline
        onSubmit={async (note) => {
          try {
            await markDelivery(fid, 'delivered', (note || '').trim() || undefined);
            toast.success('Приз отмечен как выданный');
            refresh();
          } catch (e) {
            toast.error(String(e?.message || e));
          }
        }}
      />
    );
  };

  const { stats, wins } = data;

  return (
    <>
      <div className="ga-filter-bar">
        <div>
          <label>Статус</label>
          <select
            value={filter.status}
            onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
            className="w-160 m-select"
          >
            <option value="">Все</option>
            <option value="pending">⏳ Ожидает выдачи</option>
            <option value="delivered">✅ Выдано</option>
          </select>
        </div>
        <div>
          <label>С даты</label>
          <input
            type="date"
            value={filter.from}
            onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))}
            className="m-input w-160"
          />
        </div>
        <div>
          <label>По дату</label>
          <input
            type="date"
            value={filter.to}
            onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
            className="m-input w-160"
          />
        </div>
        <Btn variant="primary" onClick={apply}>Применить</Btn>
        <Btn variant="ghost" onClick={reset}>Сбросить</Btn>
      </div>

      <div className="ga-stats">
        <div className="ga-stat"><div className="ga-stat-v c-t1" >{stats.total_spins || 0}</div><div className="ga-stat-l">Всего спинов</div></div>
        <div className="ga-stat"><div className="ga-stat-v c-amber" >{stats.pending_deliveries || 0}</div><div className="ga-stat-l">Ждут выдачи</div></div>
        <div className="ga-stat"><div className="ga-stat-v c-ok" >{stats.delivered || 0}</div><div className="ga-stat-l">Выдано</div></div>
        <div className="ga-stat"><div className="ga-stat-v c-gold" >{stats.rare_wins || 0}</div><div className="ga-stat-l">Редких призов</div></div>
      </div>

      {loading ? (
        <div className="card t-center p-32 c-t3" >⏳ Загружаю…</div>
      ) : wins.length === 0 ? (
        <EmptyState icon="🏆" title="Нет данных" hint="Под выбранные фильтры выигрышей не найдено." />
      ) : (
        <div className="ov-x-auto">
          <table className="ga-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Сотрудник</th>
                <th>Объект</th>
                <th>Приз</th>
                <th>Редкость</th>
                <th>Статус</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {wins.map((w, i) => {
                const tc = TIER_COLORS[w.tier] || 'var(--t-3)';
                const tone = DELIVERY_TONE[w.delivery_status] || 'default';
                const statusLabel = DELIVERY_LABELS[w.delivery_status] || (w.delivery_status ? w.delivery_status : '—');
                const icon = w.item_icon ? `${w.item_icon} ` : '';

                let actionCell;
                if (w.fulfillment_id && w.delivery_status === 'pending') {
                  actionCell = <Btn variant="info-ghost" size="sm" onClick={() => onMarkReady(w.fulfillment_id)}>📦 Готово</Btn>;
                } else if (w.fulfillment_id && w.delivery_status === 'ready') {
                  actionCell = <Btn variant="success-ghost" size="sm" onClick={() => onMarkDelivered(w.fulfillment_id)}>✅ Выдать</Btn>;
                } else if (w.delivery_status === 'delivered') {
                  actionCell = <span className="fs-11 c-t3">{w.delivered_at ? fmtDate(w.delivered_at) : '✓'}</span>;
                } else {
                  actionCell = '—';
                }

                return (
                  <tr key={w.spin_id || i}>
                    <td className="u-nowrap">{fmtDate(w.spin_at)}</td>
                    <td>
                      <b>{w.employee_name || '—'}</b>
                      <div className="fs-11 c-t3">{w.employee_phone || ''}</div>
                    </td>
                    <td><span className="c-t2">{w.work_name || '—'}</span></td>
                    <td><b>{icon}{w.prize_name}</b></td>
                    <td><span style={{ color: tc, fontWeight: 700 }}>{TIER_LABELS[w.tier] || w.tier}</span></td>
                    <td><Pill tone={tone}>{statusLabel}</Pill></td>
                    <td>{actionCell}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
