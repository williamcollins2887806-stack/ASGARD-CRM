/**
 * Страница /inbox-applications — Входящие заявки (AI-парсинг).
 *
 * Источник: vanilla `public/assets/js/inbox_applications.js` (392 строки).
 *
 * Coverage:
 *   ✅ Статистика: всего / новые / 🟢🟡🔴 / за неделю
 *   ✅ Фильтры: статус (6 опций), цвет AI (4 опции), поиск
 *   ✅ Список карточек (subject + meta + AI-summary с цветом)
 *   ✅ Карточка: AI Анализ + рекомендация + бюджет + срок + ключевые
 *   ✅ Текст письма + вложения (collapsible)
 *   ✅ Действия: Принять (создать тендер) / Отклонить (с причиной) / На рассмотрение
 *   ✅ Запустить / Переанализ AI
 *   ✅ Архивировать
 *   ✅ Решение (decision_by + рассказ + ссылка на тендер)
 *   ✅ Workload snapshot
 *   ✅ Hash deep-link `?id=NN`
 *
 * RBAC: backend требует только authenticate, фильтры в backend по роли.
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput, SelectInput } from '@/inputs/Inputs';
import { StatusBadge } from '@/modals/Notifications';
import { loadList, loadStats, STATUSES, COLORS, statusInfo, colorInfo, fmtDate, CLASSIFICATIONS } from './api';
import { InboxDetailModal } from './InboxDetailModal';

export default function InboxApplicationsPage() {
  const { user: _user } = useAuth();
  const modal = useModal();

  const [list, setList] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', color: '', search: '' });
  // v2 BONUS: переключение сортировки (newest|oldest|color_red_first) — vanilla только newest
  const [sortMode, setSortMode] = useState('newest');

  const refresh = () => {
    setLoading(true);
    Promise.all([
      loadList({ status: filters.status, color: filters.color, search: filters.search }),
      loadStats()
    ])
      .then(([items, st]) => {
        setList(items);
        setStats(st);
      })
      .catch((e) => toast.error('Не удалось загрузить: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.color, filters.search]);

  useEffect(() => {
    const on = () => refresh();
    window.addEventListener('asgard:inbox-applications:changed', on);
    return () => window.removeEventListener('asgard:inbox-applications:changed', on);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const check = () => {
      const m = (window.location.hash || '').match(/[?&]id=(\d+)/);
      if (m && m[1]) {
        modal.open(<InboxDetailModal id={Number(m[1])} onChanged={refresh} />, { size: 'xl' });
        window.location.hash = '#/inbox-applications';
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const byColor = stats?.byColor || {};
    const byStatus = stats?.byStatus || {};
    return {
      total:      stats.total || 0,
      newOnes:    (byStatus.new || 0) + (byStatus.ai_processed || 0),
      green:      byColor.green || 0,
      yellow:     byColor.yellow || 0,
      red:        byColor.red || 0,
      recentWeek: stats.recentWeek || 0
    };
  }, [stats]);

  const onOpen = (item) => modal.open(<InboxDetailModal id={item.id} onChanged={refresh} />, { size: 'xl' });

  // v2 BONUS: применяем сортировку (vanilla показывал только newest_first)
  const sortedList = useMemo(() => {
    const arr = [...list];
    if (sortMode === 'newest') arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    else if (sortMode === 'oldest') arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (sortMode === 'color_red_first') {
      const ord = { red: 0, yellow: 1, green: 2, gray: 3 };
      arr.sort((a, b) => (ord[a.ai_color] ?? 4) - (ord[b.ai_color] ?? 4));
    }
    return arr;
  }, [list, sortMode]);

  // v2 BONUS: hotkeys (/ поиск, Esc сброс, R обновить, S сортировка cycle) — vanilla не имеет
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); document.querySelector('input[data-searchbox="inbox"]')?.focus(); }
      else if (e.key === 'r') refresh();
      else if (e.key === 's') setSortMode((s) => s === 'newest' ? 'oldest' : s === 'oldest' ? 'color_red_first' : 'newest');
      else if (e.key === 'Escape' && (filters.search || filters.status || filters.color)) {
        setFilters({ status: '', color: '', search: '' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.status, filters.color]);

  // v2 BONUS: export CSV (vanilla — нет)
  const exportCsv = () => {
    if (!sortedList.length) { toast.warn('Список пуст'); return; }
    const rows = [['ID', 'Тема', 'Отправитель', 'Email', 'Статус', 'AI цвет', 'AI conf', 'AI summary', 'Создано']];
    for (const it of sortedList) {
      rows.push([
        it.id,
        (it.subject || '').replace(/[\r\n]+/g, ' '),
        it.source_name || '',
        it.source_email || '',
        it.status || '',
        it.ai_color || '',
        it.ai_confidence ?? '',
        (it.ai_summary || '').replace(/[\r\n]+/g, ' '),
        it.created_at || ''
      ]);
    }
    const csv = '﻿' + rows.map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inbox-applications_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Экспорт CSV: ${sortedList.length} заявок`);
  };

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="МиМир (AI)"
        title="Входящие заявки"
        subtitle={`Парсинг писем от заказчиков, цветовой анализ, конверсия в тендер`}
        actions={
          <>
            {/* v2 BONUS: cycle сортировки + CSV (vanilla не имеет) */}
            <Btn
              variant="ghost"
              onClick={() => setSortMode((s) => s === 'newest' ? 'oldest' : s === 'oldest' ? 'color_red_first' : 'newest')}
              title="S — циклическая смена сортировки"
            >
              {sortMode === 'newest' ? '🕐 Новые ↑' : sortMode === 'oldest' ? '⏰ Старые ↑' : '🔴 Красные ↑'}
            </Btn>
            <Btn variant="ghost" onClick={exportCsv} title="Экспорт CSV">📊 CSV</Btn>
            <Btn variant="ghost" onClick={refresh} title="R">↻ Обновить</Btn>
          </>
        }
      />

      {/* Статистика */}
      {/* v2 BONUS: цветовые карточки теперь кликабельные (drill-down фильтра по цвету) */}
      <div className="grid-6 gap-10">
        <StatCard val={totals.total}   lbl="Всего" onClick={() => setFilters({ status: '', color: '', search: '' })} />
        <StatCard val={totals.newOnes} lbl="Новые"        color="var(--info)" onClick={() => setFilters((f) => ({ ...f, status: 'new' }))} />
        <StatCard val={totals.green}   lbl="🟢 Зелёные"   color="var(--ok)" onClick={() => setFilters((f) => ({ ...f, color: 'green' }))} />
        <StatCard val={totals.yellow}  lbl="🟡 Жёлтые"    color="var(--amber)" onClick={() => setFilters((f) => ({ ...f, color: 'yellow' }))} />
        <StatCard val={totals.red}     lbl="🔴 Красные"    color="var(--err)" onClick={() => setFilters((f) => ({ ...f, color: 'red' }))} />
        <StatCard val={totals.recentWeek} lbl="За неделю" />
      </div>

      {/* Фильтры */}
      <div className="filter-grid-3">
        {/* v2 BONUS: data-searchbox для "/" hotkey */}
        <SearchInput
          data-searchbox="inbox"
          value={filters.search}
          onChange={(v) => setFilters({ ...filters, search: v })}
          placeholder="Поиск по теме, отправителю, AI summary… (/ фокус)"
        />
        <SelectInput
          value={filters.status}
          onChange={(v) => setFilters({ ...filters, status: v })}
          options={[{ value: '', label: 'Все статусы' }, ...STATUSES.map((s) => ({ value: s.value, label: s.label }))]}
        />
        <SelectInput
          value={filters.color}
          onChange={(v) => setFilters({ ...filters, color: v })}
          options={[{ value: '', label: 'Все цвета AI' }, ...COLORS.map((c) => ({ value: c.value, label: c.label }))]}
        />
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : list.length === 0 ? (
        <EmptyState
          icon="📨"
          title="Заявок нет"
          hint="Заявки приходят автоматически из почтового ящика (через IMAP-классификатор) или создаются вручную"
        />
      ) : (
        <div className="col gap-8">
          {/* v2 BONUS: используем sortedList */}
          {sortedList.map((item) => (
            <InboxCard key={item.id} item={item} onOpen={() => onOpen(item)} />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxCard({ item, onOpen }) {
  const st = statusInfo(item.status);
  const col = colorInfo(item.ai_color);
  const cl = CLASSIFICATIONS[item.ai_classification] || item.ai_classification || '';
  const isAI = !item.created_by;
  const creator = item.created_by_name || 'МиМир (AI)';

  const borderLeft = col.value === 'green' ? '4px solid var(--ok)'
                  : col.value === 'yellow' ? '4px solid var(--amber)'
                  : col.value === 'red'   ? '4px solid var(--err)'
                  : '4px solid var(--brd-1)';

  const aiBg = col.value === 'green' ? 'rgba(22,163,74,0.08)'
            : col.value === 'yellow' ? 'rgba(234,179,8,0.08)'
            : col.value === 'red'    ? 'rgba(220,38,38,0.08)'
            : 'var(--inner-bg)';

  return (
    <div
      className="card p-14 cur-p inbox-card"
      onClick={onOpen}
      style={{ borderLeft }}
    >
      <div className="row-spread gap-12 mb-8">
        <div className="fw-700 fs-14 flex-1 ellipsis">
          {col.value && col.value !== 'gray' && (col.value === 'green' ? '🟢 ' : col.value === 'yellow' ? '🟡 ' : '🔴 ')}
          {item.subject || '(без темы)'}
        </div>
        <StatusBadge tone={st.tone} label={st.label} />
      </div>
      <div className="row gap-12 u-wrap fs-12 c-t3">
        <span>{item.source_name || item.source_email || '—'}</span>
        {cl && <span>· {cl}</span>}
        {item.ai_confidence && <span>· AI: {Math.round(item.ai_confidence * 100)}%</span>}
        <span>· {fmtDate(item.created_at)}</span>
        {item.attachment_count > 0 && <span>· 📎 {item.attachment_count}</span>}
        <span style={{ color: isAI ? 'var(--purple)' : 'var(--t-3)' }}>· {isAI ? '🤖 ' : ''}{creator}</span>
      </div>
      {item.ai_summary && (
        <div className="mt-8 r-sm fs-13" style={{ padding: '8px 12px', background: aiBg }}>
          {item.ai_summary}
        </div>
      )}
    </div>
  );
}

function StatCard({ val, lbl, color, onClick }) {
  // v2 BONUS: поддержка onClick для drill-down (vanilla не имел)
  return (
    <div
      className="card p-14 t-center"
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
      title={onClick ? 'Клик — отфильтровать список' : undefined}
    >
      <div className="fs-26 fw-800" style={{ color: color || 'var(--gold)' }}>{val}</div>
      <div className="label-cap mt-4">{lbl}</div>
    </div>
  );
}
