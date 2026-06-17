/**
 * Страница /finances — Финансовая аналитика (Расходы / Поступления).
 * Источник: vanilla `public/assets/js/finances.js` (~530 строк).
 *
 *   ✅ index.jsx     — табы режима + переключатель года + сводка + графики
 *   ✅ PieChart.jsx  — кольцо по категориям расходов
 *   ✅ api.js        — endpoints + агрегация + хелперы форматирования
 *
 * RBAC: ADMIN, BUH, директора (DIRECTOR_*).
 * Кнопка «Импорт выписки» переводит на `/bank-import` (см. pages/BankImport).
 * Полный модуль `AsgardBankImport` мигрирован в React v2 — миграция #C16.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';

import PieChart from './PieChart';
import {
  loadWorkExpenses, loadOfficeExpenses, loadWorks,
  collectData, fmtMoney, moneyShort,
  MONTHS_SHORT, MONTHS_FULL
} from './api';
import './finances.css';

const ALLOWED_ROLES = ['ADMIN', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR'];

export default function FinancesPage() {
  const { user } = useAuth();

  const currentYear = new Date().getFullYear();
  const [mode, setMode] = useState('expenses');   // 'expenses' | 'income'
  const [year, setYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(null);

  const [works, setWorks]                   = useState([]);
  const [workExpenses, setWorkExpenses]     = useState([]);
  const [officeExpenses, setOfficeExpenses] = useState([]);
  const [loading, setLoading] = useState(true);

  // Жёсткий RBAC: если роль не в списке — редирект на главную
  useEffect(() => {
    if (user && !ALLOWED_ROLES.includes(user.role)) {
      toast.error('Раздел доступен директорам и бухгалтерии');
      window.location.hash = '#/home';
    }
  }, [user]);

  const refresh = (y = year) => {
    setLoading(true);
    Promise.all([
      loadWorks(),
      loadWorkExpenses(y),
      loadOfficeExpenses(y)
    ])
      .then(([w, we, oe]) => {
        setWorks(w);
        setWorkExpenses(we);
        setOfficeExpenses(oe);
      })
      .catch((e) => toast.error('Не удалось загрузить данные: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(year); /* eslint-disable-next-line */ }, [year]);

  const data = useMemo(
    () => collectData(year, { works, workExpenses, officeExpenses }),
    [year, works, workExpenses, officeExpenses]
  );

  const currentData = mode === 'expenses' ? data.expenses : data.income;
  const totalYear   = currentData.months.reduce((a, b) => a + b, 0);
  const maxMonth    = Math.max(...currentData.months);
  const maxMonthIdx = currentData.months.indexOf(maxMonth);
  const avgMonth    = totalYear / 12;

  const onPickMonth = (i) => {
    setSelectedMonth((cur) => (cur === i ? null : i));
  };

  const onImportBank = () => {
    // Импорт выписок мигрирован в React v2 — переходим на /bank-import (см. pages/BankImport)
    window.location.hash = '#/bank-import';
  };

  const subtitle = mode === 'expenses'
    ? `Расходы по компании · ${year}`
    : `Поступления по компании · ${year}`;

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Финансы"
        title={mode === 'expenses' ? '📤 Расходы' : '📥 Поступления'}
        subtitle={subtitle}
        actions={
          <>
            <Btn variant="ghost" onClick={() => refresh()}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={onImportBank}>📄 Импорт выписки</Btn>
          </>
        }
      />

      <div className="fin-toolbar">
        <div className="fin-tabs">
          <button
            className={mode === 'expenses' ? 'on' : ''}
            onClick={() => { setMode('expenses'); setSelectedMonth(null); }}
          >📤 Расходы</button>
          <button
            className={mode === 'income' ? 'on' : ''}
            onClick={() => { setMode('income'); setSelectedMonth(null); }}
          >📥 Поступления</button>
        </div>
        <div className="fin-year-nav">
          <button
            className="fin-arrow"
            disabled={year <= 2020}
            onClick={() => { setYear((y) => Math.max(2020, y - 1)); setSelectedMonth(null); }}
          >◀</button>
          <div className="year">{year}</div>
          <button
            className="fin-arrow"
            disabled={year >= currentYear}
            onClick={() => { setYear((y) => Math.min(currentYear, y + 1)); setSelectedMonth(null); }}
          >▶</button>
        </div>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем данные…
        </div>
      ) : (
        <>
          <div className="fin-summary">
            <div className="fin-card">
              <div className="fin-card-label">{mode === 'expenses' ? 'Расходы за год' : 'Поступления за год'}</div>
              <div className="fin-card-value">{fmtMoney(totalYear)}</div>
              <div className="fin-card-sub">{year} год</div>
            </div>
            <div className="fin-card">
              <div className="fin-card-label">Среднее в месяц</div>
              <div className="fin-card-value">{fmtMoney(avgMonth)}</div>
              <div className="fin-card-sub">за {year}</div>
            </div>
            <div className="fin-card">
              <div className="fin-card-label">Максимум</div>
              <div className="fin-card-value">{fmtMoney(maxMonth)}</div>
              <div className="fin-card-sub">{maxMonthIdx >= 0 ? MONTHS_SHORT[maxMonthIdx] : '—'} {year}</div>
            </div>
          </div>

          {selectedMonth === null ? (
            <div className="fin-chart">
              <h3 className="fin-chart-title">
                {mode === 'expenses' ? '📊 Расходы по месяцам' : '📊 Поступления по месяцам'}
                <span className="help">Нажмите на столбик для детализации</span>
              </h3>
              <div className="fin-bars">
                {currentData.months.map((val, i) => {
                  const h = maxMonth > 0 ? Math.max(4, (val / maxMonth) * 170) : 4;
                  return (
                    <div
                      key={i}
                      className="fin-bar-wrap"
                      onClick={() => onPickMonth(i)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickMonth(i); } }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${MONTHS_SHORT[i]}: ${moneyShort(val)}`}
                    >
                      <div className={'fin-bar ' + (mode === 'expenses' ? 'exp' : 'inc')} style={{ height: h + 'px' }}>
                        <div className="fin-bar-value">{moneyShort(val)}</div>
                      </div>
                      <div className="fin-bar-label">{MONTHS_SHORT[i]}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="fin-chart">
              <h3 className="fin-chart-title">
                <button className="fin-back-btn" onClick={() => setSelectedMonth(null)}>← Назад к году</button>
                {MONTHS_FULL[selectedMonth]} {year}
              </h3>
              <div className="fin-summary mb-16" >
                <div className="fin-card">
                  <div className="fin-card-label">{mode === 'expenses' ? 'Расходы за месяц' : 'Поступления за месяц'}</div>
                  <div className="fin-card-value">{fmtMoney(currentData.months[selectedMonth] || 0)}</div>
                  <div className="fin-card-sub">{MONTHS_FULL[selectedMonth]} {year}</div>
                </div>
              </div>
              {mode === 'expenses' && (
                <PieChart
                  categories={data.expenses.byMonth[selectedMonth]}
                  total={currentData.months[selectedMonth]}
                />
              )}
            </div>
          )}

          {mode === 'expenses' && selectedMonth === null && totalYear > 0 && (
            <PieChart
              title={`📈 Структура расходов за ${year}`}
              categories={data.expenses.categories}
              total={totalYear}
            />
          )}
        </>
      )}
    </div>
  );
}
