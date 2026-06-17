/**
 * Страница /auto-reports — отчёты по периодам (месяц/квартал/год) + список сохранённых.
 * Источник: vanilla `public/assets/js/auto_reports.js` (448 LOC).
 *
 * Endpoints (src/routes/reports.js):
 *   GET  /api/reports/generate/:type
 *   GET  /api/reports/download/:type
 *   GET  /api/reports/saved
 *   POST /api/reports/auto-generate (ADMIN)
 *
 * RBAC: ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV, BUH, HEAD_PM, HEAD_TO.
 * Бэкенд требует только authenticate, но семантика — для руководства.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { TopActionsBar, EmptyState, LoadingCard } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { Btn, Field } from '@/modals/parts';
import { SelectInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import {
  REPORT_TYPES, MONTHS, fmtMoneyR,
  generateReport, downloadReport, loadSavedReports,
  parsePeriodCode, triggerAutoGenerate
} from './api';
import './auto-reports.css';

// RBAC inline-литералы (для скрипта rbac-audit).
const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH', 'HEAD_PM', 'HEAD_TO'];

const TABS = [
  { key: 'generate', label: 'Создать отчёт' },
  { key: 'saved',    label: 'Сохранённые' },
  { key: 'settings', label: 'Настройки' }
];

const AUTO_SETTINGS_KEY = 'asgard_auto_reports_settings';

const QUARTERS = [
  { value: '1', label: '1 квартал' },
  { value: '2', label: '2 квартал' },
  { value: '3', label: '3 квартал' },
  { value: '4', label: '4 квартал' }
];

export default function AutoReportsPage() {
  const { user } = useAuth();
  const now = new Date();
  const curYear  = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const curQuart = Math.ceil(curMonth / 3);

  const [tab, setTab]         = useState('generate');
  const [preview, setPreview] = useState(null);
  const [previewType, setPreviewType] = useState(null);
  const [busy, setBusy]       = useState({}); // {monthly_preview: true, ...}

  // Управляемые селекты
  const [mYear, setMYear]   = useState(String(curYear));
  const [mMonth, setMMonth] = useState(String(curMonth));
  const [qYear, setQYear]   = useState(String(curYear));
  const [qQuart, setQQuart] = useState(String(curQuart));
  const [yYear, setYYear]   = useState(String(curYear - 1));

  // Сохранённые
  const [saved, setSaved]       = useState([]);
  const [savedLoad, setSavedLoad] = useState(false);

  // Расписание (хранится в localStorage)
  const [autoMonthly, setAutoMonthly]     = useState(true);
  const [autoQuarterly, setAutoQuarterly] = useState(true);
  const [autoYearly, setAutoYearly]       = useState(true);

  // Подгружаем расписание из LS
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTO_SETTINGS_KEY);
      if (raw) {
        const cfg = JSON.parse(raw);
        setAutoMonthly(cfg.monthly !== false);
        setAutoQuarterly(cfg.quarterly !== false);
        setAutoYearly(cfg.yearly !== false);
      }
    } catch { /* noop */ }
  }, []);

  // Подгружаем «сохранённые» при открытии вкладки
  useEffect(() => {
    if (tab !== 'saved') return;
    setSavedLoad(true);
    loadSavedReports().then(setSaved).finally(() => setSavedLoad(false));
  }, [tab]);

  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Автоотчёты недоступны"
        message="Раздел открыт руководству (директора, HEAD_PM/HEAD_TO), бухгалтерии и ADMIN."
      />
    );
  }

  const isAdmin = user?.role === 'ADMIN';

  const yearOpts4 = [curYear, curYear - 1, curYear - 2, curYear - 3].map((y) => ({ value: String(y), label: String(y) }));
  const yearOpts3 = [curYear, curYear - 1, curYear - 2].map((y) => ({ value: String(y), label: String(y) }));
  const monthOpts = MONTHS.slice(1).map((m, i) => ({ value: String(i + 1), label: m }));

  const getParams = (type) => {
    if (type === 'monthly')   return { year: parseInt(mYear, 10), month: parseInt(mMonth, 10) };
    if (type === 'quarterly') return { year: parseInt(qYear, 10), quarter: parseInt(qQuart, 10) };
    return { year: parseInt(yYear, 10) };
  };

  const onPreview = async (type) => {
    setBusy({ ...busy, [type + '_preview']: true });
    try {
      const rep = await generateReport(type, getParams(type));
      setPreview(rep);
      setPreviewType(type);
    } catch (e) {
      toast.error('Не удалось загрузить отчёт: ' + (e?.message || e));
    } finally {
      setBusy((s) => ({ ...s, [type + '_preview']: false }));
    }
  };

  const onDownload = async (type) => {
    setBusy({ ...busy, [type + '_dl']: true });
    try {
      await downloadReport(type, getParams(type));
      toast.success('Excel сохранён');
    } catch (e) {
      toast.error('Не удалось скачать: ' + (e?.message || e));
    } finally {
      setBusy((s) => ({ ...s, [type + '_dl']: false }));
    }
  };

  const onSaveSettings = () => {
    const cfg = { enabled: true, monthly: autoMonthly, quarterly: autoQuarterly, yearly: autoYearly };
    try {
      localStorage.setItem(AUTO_SETTINGS_KEY, JSON.stringify(cfg));
      toast.success('Настройки сохранены');
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
    }
  };

  const onRunNow = async () => {
    setBusy({ ...busy, autogen: true });
    try {
      const r = await triggerAutoGenerate();
      const cnt = (r?.generated || []).length;
      toast.success(`Запуск выполнен. Сгенерировано: ${cnt}`);
    } catch (e) {
      toast.error('Ошибка запуска: ' + (e?.message || e));
    } finally {
      setBusy((s) => ({ ...s, autogen: false }));
    }
  };

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Отчёты"
        title="Автоотчёты"
        subtitle="Месячные, квартальные и годовые сводки с экспортом в Excel"
      />

      <div className="ar-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={'ar-tab ' + (t.key === tab ? 'active' : '')}
            onClick={() => setTab(t.key)}
            type="button"
          >{t.label}</button>
        ))}
      </div>

      {tab === 'generate' && (
        <>
          <div className="ar-grid">
            {/* Месячный */}
            <div className="ar-card">
              <h3>📅 Месячный отчёт</h3>
              <div className="ar-row">
                <Field label="Год">
                  <SelectInput value={mYear} onChange={setMYear} options={yearOpts3} placeholder="" />
                </Field>
                <Field label="Месяц">
                  <SelectInput value={mMonth} onChange={setMMonth} options={monthOpts} placeholder="" />
                </Field>
              </div>
              <div className="row gap-10 mt-12">
                <Btn variant="ghost"   onClick={() => onPreview('monthly')}  disabled={!!busy.monthly_preview}>
                  {busy.monthly_preview ? '⏳' : '👁'} Просмотр
                </Btn>
                <Btn variant="primary" onClick={() => onDownload('monthly')} disabled={!!busy.monthly_dl}>
                  {busy.monthly_dl ? '⏳' : '📥'} Excel
                </Btn>
              </div>
            </div>

            {/* Квартальный */}
            <div className="ar-card">
              <h3>📊 Квартальный отчёт</h3>
              <div className="ar-row">
                <Field label="Год">
                  <SelectInput value={qYear} onChange={setQYear} options={yearOpts3} placeholder="" />
                </Field>
                <Field label="Квартал">
                  <SelectInput value={qQuart} onChange={setQQuart} options={QUARTERS} placeholder="" />
                </Field>
              </div>
              <div className="row gap-10 mt-12">
                <Btn variant="ghost"   onClick={() => onPreview('quarterly')}  disabled={!!busy.quarterly_preview}>
                  {busy.quarterly_preview ? '⏳' : '👁'} Просмотр
                </Btn>
                <Btn variant="primary" onClick={() => onDownload('quarterly')} disabled={!!busy.quarterly_dl}>
                  {busy.quarterly_dl ? '⏳' : '📥'} Excel
                </Btn>
              </div>
            </div>

            {/* Годовой */}
            <div className="ar-card">
              <h3>📈 Годовой отчёт</h3>
              <div className="ar-row">
                <Field label="Год">
                  <SelectInput value={yYear} onChange={setYYear} options={yearOpts4} placeholder="" />
                </Field>
              </div>
              <div className="row gap-10 mt-12">
                <Btn variant="ghost"   onClick={() => onPreview('yearly')}  disabled={!!busy.yearly_preview}>
                  {busy.yearly_preview ? '⏳' : '👁'} Просмотр
                </Btn>
                <Btn variant="primary" onClick={() => onDownload('yearly')} disabled={!!busy.yearly_dl}>
                  {busy.yearly_dl ? '⏳' : '📥'} Excel
                </Btn>
              </div>
            </div>
          </div>

          {preview && <ReportPreview report={preview} type={previewType} />}
        </>
      )}

      {tab === 'saved' && (
        <SavedReportsTab loading={savedLoad} saved={saved} />
      )}

      {tab === 'settings' && (
        <SettingsTab
          isAdmin={isAdmin}
          monthly={autoMonthly}   setMonthly={setAutoMonthly}
          quarterly={autoQuarterly} setQuarterly={setAutoQuarterly}
          yearly={autoYearly}     setYearly={setAutoYearly}
          busyAutogen={!!busy.autogen}
          onSave={onSaveSettings}
          onRunNow={onRunNow}
        />
      )}
    </div>
  );
}

/* ─── Preview (Vanilla auto_reports.js:302..369 renderReportPreview) ─── */
function ReportPreview({ report, type }) {
  const d = report?.data || {};
  const profitColor = (d.profit || 0) >= 0 ? 'var(--ok)' : 'var(--err)';

  return (
    <div className="ar-preview-card">
      <h2>📊 {report.period}</h2>

      <div className="ar-stats">
        <div className="ar-stat">
          <div className="ar-stat-label">Тендеры</div>
          <div className="ar-stat-val">{d.tenders?.total || 0}</div>
          <div className="ar-stat-sub">
            ✅ Выиграно: {d.tenders?.won || 0} ❌ Проиграно: {d.tenders?.lost || 0}
          </div>
        </div>
        <div className="ar-stat">
          <div className="ar-stat-label">Работы</div>
          <div className="ar-stat-val">{d.works?.total || 0}</div>
          <div className="ar-stat-sub">✅ Завершено: {d.works?.completed || 0}</div>
        </div>
        <div className="ar-stat">
          <div className="ar-stat-label">Доходы</div>
          <div className="ar-stat-val" style={{ color: 'var(--ok)' }}>{fmtMoneyR(d.incomes?.total)}</div>
        </div>
        <div className="ar-stat">
          <div className="ar-stat-label">Расходы</div>
          <div className="ar-stat-val" style={{ color: 'var(--err)' }}>{fmtMoneyR(d.expenses?.total)}</div>
        </div>
        <div className="ar-stat span-2">
          <div className="ar-stat-label">Прибыль</div>
          <div className="ar-stat-val" style={{ color: profitColor, fontSize: 28 }}>{fmtMoneyR(d.profit)}</div>
        </div>
      </div>

      {Array.isArray(d.top_customers) && d.top_customers.length > 0 && (
        <>
          <h3 style={{ marginTop: 22, fontSize: 16 }}>🏆 Топ заказчики</h3>
          <table className="ar-tbl">
            <thead><tr><th>Заказчик</th><th>Тендеров</th><th>Сумма</th></tr></thead>
            <tbody>
              {d.top_customers.map((c, i) => (
                <tr key={i}>
                  <td>{c.customer_name || '—'}</td>
                  <td>{c.count}</td>
                  <td>{fmtMoneyR(c.sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {type === 'quarterly' && Array.isArray(report.months) && report.months.length > 0 && (
        <>
          <h3 style={{ marginTop: 22, fontSize: 16 }}>📆 По месяцам</h3>
          <table className="ar-tbl">
            <thead><tr><th>Период</th><th>Доходы</th><th>Расходы</th><th>Прибыль</th></tr></thead>
            <tbody>
              {report.months.map((m, i) => (
                <tr key={i}>
                  <td>{m.period}</td>
                  <td>{fmtMoneyR(m.data?.incomes?.total)}</td>
                  <td>{fmtMoneyR(m.data?.expenses?.total)}</td>
                  <td>{fmtMoneyR(m.data?.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {type === 'yearly' && Array.isArray(report.quarters) && report.quarters.length > 0 && (
        <>
          <h3 style={{ marginTop: 22, fontSize: 16 }}>📅 По кварталам</h3>
          <table className="ar-tbl">
            <thead><tr><th>Период</th><th>Доходы</th><th>Расходы</th><th>Прибыль</th></tr></thead>
            <tbody>
              {report.quarters.map((q, i) => (
                <tr key={i}>
                  <td>{q.period}</td>
                  <td>{fmtMoneyR(q.data?.incomes?.total)}</td>
                  <td>{fmtMoneyR(q.data?.expenses?.total)}</td>
                  <td>{fmtMoneyR(q.data?.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div style={{ marginTop: 18, textAlign: 'right' }}>
        <small className="c-t3">Сформирован: {report.generated_at ? new Date(report.generated_at).toLocaleString('ru-RU') : '—'}</small>
      </div>
    </div>
  );
}

/* ─── Saved tab ──────────────────────────────────────────────────────── */
function SavedReportsTab({ loading, saved }) {
  if (loading) return <LoadingCard text="Загружаем сохранённые отчёты…" />;
  if (saved.length === 0) {
    return (
      <EmptyState
        icon="📂"
        title="Сохранённых отчётов нет"
        hint="Отчёты сохраняются автоматически 1-го числа (планировщик /api/reports/auto-generate)."
      />
    );
  }
  return (
    <div className="card p-16">
      <table className="ar-tbl">
        <thead>
          <tr><th>Тип</th><th>Период</th><th>Создан</th><th>Действия</th></tr>
        </thead>
        <tbody>
          {saved.map((r, i) => {
            const meta = REPORT_TYPES[r.type] || { icon: '📄', label: r.type };
            return (
              <tr key={r.id || (r.period_code + '-' + i)}>
                <td>{meta.icon} {meta.label}</td>
                <td>{r.period}</td>
                <td>{r.created_at ? new Date(r.created_at).toLocaleDateString('ru-RU') : '—'}</td>
                <td>
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        const params = parsePeriodCode(r.period_code);
                        await downloadReport(r.type, params);
                        toast.success('Excel сохранён');
                      } catch (e) {
                        toast.error('Не удалось скачать: ' + (e?.message || e));
                      }
                    }}
                  >📥 Excel</Btn>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Settings tab ───────────────────────────────────────────────────── */
function SettingsTab({ isAdmin, monthly, setMonthly, quarterly, setQuarterly, yearly, setYearly, busyAutogen, onSave, onRunNow }) {
  return (
    <div className="ar-settings-card">
      <h3 style={{ margin: 0, fontSize: 16 }}>⚙️ Автоматические отчёты</h3>

      <label className="ar-checkbox-row">
        <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
        <span>Месячный отчёт (1-го числа каждого месяца)</span>
      </label>
      <label className="ar-checkbox-row">
        <input type="checkbox" checked={quarterly} onChange={(e) => setQuarterly(e.target.checked)} />
        <span>Квартальный отчёт (после завершения квартала)</span>
      </label>
      <label className="ar-checkbox-row">
        <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} />
        <span>Годовой отчёт (1 января)</span>
      </label>

      <div className="ar-help-note">
        Отчёты автоматически создаются и отправляются директорам в Telegram + уведомление на сайте.
        Планировщик: <code>POST /api/reports/auto-generate</code> (cron 0 6 1 * *).
      </div>

      <div className="row gap-10 mt-12">
        <Btn variant="primary" onClick={onSave}>💾 Сохранить настройки</Btn>
        {isAdmin && (
          <Btn variant="ghost" onClick={onRunNow} disabled={busyAutogen}>
            {busyAutogen ? '⏳ Запуск…' : '▶ Запустить сейчас'}
          </Btn>
        )}
      </div>
    </div>
  );
}
