/**
 * AI-характеристика Мимира.
 *
 * Источник: vanilla `employee.js` функция loadAiSummary (строки 699–752).
 * Endpoint: POST /api/mimir/employee-summary { employee_id }
 *   → { success, summary, data_sources: { has_profile, reviews_count, assignments_count, has_payroll } }
 *
 * UX: ленивая загрузка по нажатию кнопки (AI стоит токенов и думает несколько секунд).
 *     Кнопки «Обновить» / «Скрыть». Источники показываются под текстом.
 */
import { useState } from 'react';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { loadAiSummary } from './api';

export function EmployeeAiChar({ employeeId }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState('');
  const [sources, setSources] = useState(null);
  const [error, setError] = useState('');

  const fetchSummary = async () => {
    setOpen(true);
    setLoading(true);
    setError('');
    try {
      const data = await loadAiSummary(employeeId);
      if (data && data.success && data.summary) {
        setSummary(data.summary);
        setSources(data.data_sources || null);
      } else {
        setError(data?.message || 'Не удалось получить характеристику');
      }
    } catch (e) {
      const msg = e?.serverMsg || e?.message || 'Сетевая ошибка';
      setError(msg);
      toast.error('Мимир не ответил: ' + msg);
    } finally {
      setLoading(false);
    }
  };

  const sourcesLabel = (() => {
    if (!sources) return null;
    const parts = [];
    if (sources.has_profile) parts.push('анкета');
    if (sources.reviews_count > 0) parts.push(sources.reviews_count + ' отзывов');
    if (sources.assignments_count > 0) parts.push(sources.assignments_count + ' назначений');
    if (sources.has_payroll) parts.push('зарплата');
    return parts.length ? 'Источники: ' + parts.join(', ') : 'Источники: основные данные';
  })();

  if (!open) {
    return (
      <div className="emp-aichar-stub">
        <div className="emp-aichar-stub-txt">
          🧙 Мимир соберёт краткую характеристику сотрудника по анкете, отзывам РП,
          истории работ и зарплате.
        </div>
        <Btn onClick={fetchSummary}>🧙 Запустить Мимира</Btn>
      </div>
    );
  }

  return (
    <div className="emp-aichar">
      <div className="emp-aichar-head">
        <span className="emp-aichar-title">🧙 Характеристика от Мимира</span>
        <div className="row gap-6">
          <Btn variant="ghost" size="sm" disabled={loading} onClick={fetchSummary} title="Обновить">
            🔄
          </Btn>
          <Btn variant="ghost" size="sm" onClick={() => setOpen(false)} title="Скрыть">
            ×
          </Btn>
        </div>
      </div>
      {loading && (
        <div className="emp-aichar-loading">⏳ Мимир анализирует данные…</div>
      )}
      {!loading && error && (
        <div className="emp-aichar-err">Ошибка: {error}</div>
      )}
      {!loading && !error && summary && (
        <>
          <div className="emp-aichar-text">{summary}</div>
          {sourcesLabel && <div className="emp-aichar-meta">{sourcesLabel}</div>}
        </>
      )}
    </div>
  );
}
