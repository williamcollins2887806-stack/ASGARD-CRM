/**
 * Страница /gamification-dashboard — Director's Gamification Overview.
 *
 * Источник: vanilla `public/assets/js/gamification-dashboard.js` (~146 строк).
 *
 *   ✅ index.jsx — KPI экономики геймификации + топ призов + топ рабочих + последние операции
 *
 * Endpoint: GET /api/gamification/admin/dashboard
 *
 * RBAC: ADMIN, DIRECTOR_*, HR, HEAD_PM.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';

const _ALLOWED = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HR', 'HR_MANAGER', 'HEAD_PM', 'HEAD_TO'];

const OP_LABEL = {
  spin_win: '🎰 Спин',
  shop_buy: '🛍 Покупка',
  convert:  '🔄 Конверт',
  quest_claim: '⚔ Квест'
};

export default function GamificationDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // RBAC inline-литералы
  const _allowed = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HR', 'HR_MANAGER', 'HEAD_PM', 'HEAD_TO'].includes(user?.role);

  const refresh = () => {
    setLoading(true);
    api('/api/gamification/admin/dashboard')
      .then(setData)
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    if (!_allowed) {
      toast.error('Раздел доступен HR/руководству');
      window.location.hash = '#/home';
      return;
    }
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  if (user && !_allowed) return null;

  const kpi = data?.kpi || {};
  const topPrizes = data?.top_prizes || [];
  const topWorkers = data?.top_workers || [];
  const recentOps = data?.recent_operations || [];

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Геймификация"
        title="Дашборд геймификации"
        subtitle="Экономика и активность рабочих"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={() => { window.location.hash = '#/gamification-leaderboard'; }}>🏆 Зал Одина</Btn>
            <Btn variant="primary" onClick={() => { window.location.hash = '#/gamification-admin'; }}>⚙ Управление</Btn>
          </>
        }
      />

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : !data ? (
        <EmptyState icon="📊" title="Нет данных" hint="Возможно, бэкенд недоступен." action={null} />
      ) : (
        <>
          {/* KPI */}
          <div className="grid-auto-200 gap-12">
            <KpiCard
              icon="💰" label="Монет в обращении"
              value={fmtNum(kpi.runes_in_circulation)} color="gold"
            />
            <KpiCard
              icon="🎰" label="Круток сегодня"
              value={fmtNum(kpi.spins_today)} color="err"
            />
            <KpiCard
              icon="🎁" label="Призов (30 дн)"
              value={fmtNum(kpi.prizes_delivered_month)} color="ok"
            />
            <KpiCard
              icon="👥" label="Активных (7 дн)"
              value={fmtNum(kpi.active_workers_7d)} color="info"
            />
          </div>

          {/* Top prizes + Top workers */}
          <div className="grid-auto-300 gap-12">
            <Card title="🏆 Топ призов">
              {topPrizes.length === 0 ? (
                <Empty>Нет данных</Empty>
              ) : (
                <TopTable items={topPrizes} keyA="prize_name" keyB="cnt" suffix="x" />
              )}
            </Card>
            <Card title="⚔ Топ рабочих">
              {topWorkers.length === 0 ? (
                <Empty>Нет данных</Empty>
              ) : (
                <TopTable items={topWorkers} keyA="name" keyB="spins" suffix=" спинов" />
              )}
            </Card>
          </div>

          {/* Recent operations */}
          {recentOps.length > 0 && (
            <Card title="📜 Последние операции">
              <div className="ov-x-auto">
                <table className="tbl-base fs-12">
                  <thead>
                    <tr className="c-t3 tbl-row-brd">
                      <Th>Время</Th>
                      <Th>Рабочий</Th>
                      <Th>Тип</Th>
                      <Th align="right">Сумма</Th>
                      <Th>Операция</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOps.map((op, i) => (
                      <tr key={i} className="tbl-row-brd-2">
                        <Td>
                          <span className="c-t3 u-nowrap-cell">
                            {fmtDateTime(op.created_at)}
                          </span>
                        </Td>
                        <Td>{op.employee_name || '—'}</Td>
                        <Td><span className="c-t2">{op.currency}</span></Td>
                        <Td align="right">
                          <span className="fw-700" style={{ color: op.amount > 0 ? 'var(--ok)' : 'var(--err)' }}>
                            {op.amount > 0 ? '+' : ''}{op.amount}
                          </span>
                        </Td>
                        <Td><span className="c-t3">{OP_LABEL[op.operation] || op.operation}</span></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({ icon, label, value, color }) {
  const tones = { gold: 'var(--gold)', err: 'var(--err)', ok: 'var(--ok)', info: 'var(--info)' };
  return (
    <div className="p-20 r-md bg-inner brd-2">
      <div className="row gap-8 mb-8">
        <span className="fs-24">{icon}</span>
        <span className="fs-11 fw-700 upper" style={{ color: tones[color], letterSpacing: '0.05em' }}>{label}</span>
      </div>
      <div className="fs-32 fw-900 tabular" style={{ color: tones[color] }}>{value || '—'}</div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="r-md bg-card brd ov-hidden">
      <div className="fw-700 fs-14" style={{ padding: '12px 16px', borderBottom: '1px solid var(--brd-2)' }}>{title}</div>
      <div className="p-12">{children}</div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="empty-cell-lg">{children}</div>;
}

function TopTable({ items, keyA, keyB, suffix }) {
  return (
    <table className="w-full fs-13">
      <tbody>
        {items.map((p, i) => (
          <tr key={i} className="tbl-row-brd-2">
            <td className="c-t3" style={{ padding: '6px 0', width: 20 }}>{i + 1}.</td>
            <td className="c-t1 fw-600" style={{ padding: '6px 8px' }}>{p[keyA] || '—'}</td>
            <td className="t-right c-gold fw-700 pad-cell-y6">
              {p[keyB] || 0}{suffix}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children, align = 'left' }) {
  return <th className="fw-700 fs-11 pad-cell-sm" style={{ textAlign: align, letterSpacing: '0.1em' }}>{children}</th>;
}
function Td({ children, align = 'left' }) {
  return <td className="pad-cell-sm" style={{ textAlign: align }}>{children}</td>;
}
function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('ru-RU');
}
function fmtDateTime(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}
