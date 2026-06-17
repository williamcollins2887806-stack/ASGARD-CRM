/**
 * Страница /gamification-leaderboard — Зал Одина (рейтинг рабочих + турнир).
 *
 * Источник: vanilla `public/assets/js/gamification-leaderboard.js` (366 строк).
 * Backend: GET /api/gamification/admin/leaderboard
 * RBAC: ADMIN/PM/HEAD_PM/HR/DIRECTOR_*
 *
 *   ✅ Hero-стат (5 KPI)
 *   ✅ Сортировка (Руны/XP/Смены/Месяц)
 *   ✅ Подиум 1-2-3
 *   ✅ Таблица топ-N
 *   ✅ Турнирная сетка (4 раунда)
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState, TabsBar } from '@/blocks/Blocks';

import {
  loadLeaderboard, RANK_COLORS, PODIUM_COLORS, MEDALS,
  fmt, sortByMetric, valueOf, labelOf, initials,
} from './api';

import './gamification-leaderboard.css';

const ROUND_LABELS = ['1/8 финала', 'Четвертьфинал', 'Полуфинал', 'Финал'];

export default function GamificationLeaderboardPage() {
  const { user: _user } = useAuth();
  const [data, setData] = useState({ leaderboard: [], tournament: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState('runes');
  const [tab, setTab] = useState('rating');

  const refresh = () => {
    setLoading(true);
    setError(null);
    loadLeaderboard()
      .then((d) => setData({ leaderboard: d?.leaderboard || [], tournament: d?.tournament || null }))
      .catch((e) => {
        const m = String(e?.message || e);
        setError(m);
        toast.error('Не удалось загрузить рейтинг: ' + m);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const { leaderboard, tournament } = data;

  const totals = useMemo(() => ({
    runes: leaderboard.reduce((s, p) => s + (parseInt(p.earned_runes) || 0), 0),
    xp: leaderboard.reduce((s, p) => s + (parseInt(p.earned_xp) || 0), 0),
    shifts: leaderboard.reduce((s, p) => s + (parseInt(p.total_shifts) || 0), 0),
    leader: leaderboard[0]?.fio?.split(' ')[0] || '—',
  }), [leaderboard]);

  const sorted = useMemo(() => sortByMetric(leaderboard, sortBy), [leaderboard, sortBy]);
  const top3 = sorted.slice(0, 3);

  return (
    <div className="col gap-16">
      <TopActionsBar
        kicker="Геймификация"
        title="🏆 Зал Одина — Рейтинг рабочих"
        subtitle={loading ? 'Загрузка…' : `${leaderboard.length} воинов · ${fmt(totals.runes)} ᚱ суммарно заработано`}
        actions={<Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>}
      />

      <TabsBar
        tabs={[
          { id: 'rating', label: '⚔️ Рейтинг' },
          { id: 'tournament', label: '🏆 Турнир' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* KPI */}
      <div className="gl-stats">
        <Stat ico="⚔️" val={fmt(leaderboard.length)} label="Воинов" color="var(--gold)" />
        <Stat ico="ᚱ" val={fmt(totals.runes)} label="Рун выдано" color="var(--gold)" />
        <Stat ico="⚡" val={fmt(totals.xp)} label="XP суммарно" color="var(--purple)" />
        <Stat ico="📅" val={fmt(totals.shifts)} label="Смен всего" color="var(--blue)" />
        <Stat ico="🔥" val={totals.leader} label="Лидер месяца" color="var(--orange)" />
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаю рейтинг…
        </div>
      ) : error ? (
        <EmptyState icon="⚠️" title="Ошибка" hint={error} action={<Btn variant="primary" onClick={refresh}>Повторить</Btn>} />
      ) : leaderboard.length === 0 ? (
        <EmptyState icon="🏰" title="Зал Одина пуст" hint="Воины ещё не накопили ни одной руны." />
      ) : tab === 'rating' ? (
        <>
          {/* Sort */}
          <div className="gl-sort-row">
            <span>Сортировка:</span>
            <button className={'gl-sort-btn' + (sortBy === 'runes' ? ' active' : '')} onClick={() => setSortBy('runes')}>ᚱ Руны</button>
            <button className={'gl-sort-btn' + (sortBy === 'xp' ? ' active' : '')} onClick={() => setSortBy('xp')}>⚡ XP</button>
            <button className={'gl-sort-btn' + (sortBy === 'shifts' ? ' active' : '')} onClick={() => setSortBy('shifts')}>📅 Смены</button>
            <button className={'gl-sort-btn' + (sortBy === 'monthly' ? ' active' : '')} onClick={() => setSortBy('monthly')}>📆 За месяц</button>
          </div>

          {/* Podium */}
          <div className="gl-podium-wrap">
            <div className="gl-podium-title">— ВАЛГАЛЛА —</div>
            <Podium top3={top3} sortBy={sortBy} />
          </div>

          {/* Table */}
          <RatingTable sorted={sorted} sortBy={sortBy} />
        </>
      ) : (
        <Tournament tournament={tournament} />
      )}
    </div>
  );
}

function Stat({ ico, val, label, color }) {
  return (
    <div className="gl-stat">
      <div className="gl-stat-ico">{ico}</div>
      <div className="gl-stat-v" style={{ color }}>{val}</div>
      <div className="gl-stat-l">{label}</div>
    </div>
  );
}

function Podium({ top3, sortBy }) {
  const order = [top3[1], top3[0], top3[2]]; // 2-1-3
  const ranks = [2, 1, 3];
  const heights = { 1: 26, 2: 18, 3: 10 };

  return (
    <div className="gl-podium">
      {order.map((p, i) => {
        const rank = ranks[i];
        const c = PODIUM_COLORS[rank - 1];
        if (!p) {
          return <div key={i} className="flex-1" />;
        }
        const rt = p.rank_title || {};
        const rc = RANK_COLORS[rt.title] || 'var(--t-3)';
        return (
          <div key={i} className="gl-podium-col">
            <div className={'gl-podium-medal' + (rank === 1 ? ' big' : '')}>{MEDALS[rank - 1]}</div>
            <div
              className={'gl-podium-avatar' + (rank === 1 ? ' big' : '')}
              style={{ background: c, border: '2px solid ' + c }}
            >
              {initials(p.fio)}
            </div>
            <div className="gl-podium-card" style={{ borderColor: c }}>
              <div className="gl-podium-name">{(p.fio || '').split(' ')[0] || '?'}</div>
              <div className="gl-podium-val" style={{ color: c }}>{labelOf(p, sortBy)}</div>
              <div className="gl-podium-rank" style={{ background: rc + '22', color: rc }}>
                {rt.icon || '⚔'} {rt.title || ''}
              </div>
            </div>
            <div
              className="gl-podium-bar"
              style={{ height: heights[rank], background: 'linear-gradient(180deg, ' + c + '88, ' + c + '22)' }}
            />
          </div>
        );
      })}
    </div>
  );
}

function RatingTable({ sorted, sortBy }) {
  const maxVal = valueOf(sorted[0] || {}, sortBy) || 1;

  return (
    <div className="gl-table-wrap">
      <table className="gl-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'center', width: 40 }}>#</th>
            <th>Воин</th>
            <th className="t-right">ᚱ Всего</th>
            <th className="t-right">ᚱ Месяц</th>
            <th className="t-right">XP</th>
            <th className="t-right">Смен</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const rank = i + 1;
            const isTop3 = rank <= 3;
            const rt = p.rank_title || {};
            const rc = RANK_COLORS[rt.title] || 'var(--t-3)';
            const val = valueOf(p, sortBy);
            const pct = Math.round((val / maxVal) * 100);

            return (
              <tr key={p.employee_id || p.id || i}>
                <td className={'gl-rank-cell' + (isTop3 ? ' top' : '')}>
                  {isTop3 ? MEDALS[rank - 1] : '#' + rank}
                </td>
                <td>
                  <div className="gl-warrior-cell">
                    <div
                      className={'gl-avatar' + (isTop3 ? '' : ' idle')}
                      style={isTop3 ? { background: PODIUM_COLORS[rank - 1], border: '1px solid ' + PODIUM_COLORS[rank - 1] } : undefined}
                    >
                      {initials(p.fio)}
                    </div>
                    <div className="gl-warrior-info">
                      <div className="gl-warrior-name">{p.fio || ''}</div>
                      <div className="gl-warrior-meta">
                        <span className="gl-warrior-rank" style={{ background: rc + '22', color: rc, border: '1px solid ' + rc + '44' }}>
                          {rt.icon || ''} {rt.title || ''}
                        </span>
                        <span className="gl-warrior-level">Ур.{p.level || 1}</span>
                        {p.streak > 0 && <span className="gl-warrior-streak">🔥 {p.streak}</span>}
                      </div>
                      <div className="gl-bar">
                        <div className="gl-bar-fill" style={{ width: pct + '%' }} />
                      </div>
                    </div>
                  </div>
                </td>
                <td className="gl-num-cell gold">{fmt(p.earned_runes)} ᚱ</td>
                <td className="gl-num-cell month">{fmt(p.monthly_runes)} ᚱ</td>
                <td className="gl-num-cell xp">{fmt(p.earned_xp)} XP</td>
                <td className="gl-num-cell shifts">{fmt(p.total_shifts)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Tournament({ tournament }) {
  if (!tournament) {
    return (
      <div className="gl-table-wrap">
        <div className="gl-tourney-empty">Недостаточно данных для турнира</div>
      </div>
    );
  }
  const { month, week, rounds = [], champion } = tournament;

  return (
    <div className="gl-table-wrap">
      <div className="gl-tourney-title">
        <h3>⚔️ Битва за Вальхаллу</h3>
        <div className="gl-tourney-sub">{month} · Неделя {week}/4</div>
        {champion && (
          <div className="gl-tourney-champ">
            👑 Текущий лидер: {champion.name} ({fmt(champion.monthly_runes)} ᚱ за месяц)
          </div>
        )}
      </div>
      <div className="gl-bracket-wrap">
        <div className="gl-bracket">
          {rounds.map((round, ri) => {
            const gaps = [8, 24, 48, 96];
            return (
              <div key={ri} className="gl-round">
                <div className="gl-round-title">{ROUND_LABELS[ri] || `Раунд ${ri + 1}`}</div>
                <div className="gl-round-col" style={{ gap: gaps[ri] || 8 }}>
                  {round.map((match, mi) => (
                    <MatchCard
                      key={mi}
                      match={match}
                      hasArrow={ri < rounds.length - 1}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="gl-tourney-note">Лидер каждого матча — по рунам за текущий месяц</p>
    </div>
  );
}

function MatchCard({ match, hasArrow }) {
  if (!match) return null;
  const { p1, p2, winner_id } = match;
  const PLine = (p) => {
    if (!p) {
      return <div className="gl-match-row"><span className="gl-match-tbd">TBD</span></div>;
    }
    const isW = winner_id === p.employee_id;
    return (
      <div className={'gl-match-row' + (isW ? ' winner' : '')}>
        <span className={'gl-match-name' + (isW ? ' winner-name' : '')}>{p.name || '?'}</span>
        <span className={'gl-match-val' + (isW ? ' winner-val' : '')}>{fmt(p.monthly_runes)} ᚱ</span>
      </div>
    );
  };
  return (
    <div className="gl-match-pair">
      <div className="gl-match">
        {PLine(p1)}
        <div className="gl-divider" />
        {PLine(p2)}
      </div>
      {hasArrow && <div className="gl-match-arrow">→</div>}
    </div>
  );
}
