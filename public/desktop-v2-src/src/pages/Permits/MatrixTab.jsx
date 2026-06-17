/**
 * MatrixTab — вкладка «Матрица» (сотрудники × типы допусков).
 * Источник: vanilla permits.js → renderMatrixTab.
 */
import { useState, useEffect } from 'react';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { SelectInput, Combobox } from '@/inputs/Inputs';
import { loadMatrix, loadWorks, CATEGORIES, CATEGORY_FILTER_OPTIONS } from './api';

export default function MatrixTab() {
  const [category, setCategory] = useState('');
  const [workId, setWorkId]     = useState('');
  const [workOpts, setWorkOpts] = useState([]);
  const [matrix, setMatrix]     = useState(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    loadWorks().then((list) => {
      const opts = [{ value: '', label: 'Все типы' },
        ...list.filter((w) => w.work_status !== 'Завершён')
          .map((w) => ({ value: String(w.id), label: w.work_title || `Проект #${w.id}` }))];
      setWorkOpts(opts);
    });
  }, []);

  const onLoad = async () => {
    setLoading(true);
    try {
      const params = {};
      if (category) params.category = category;
      if (workId)   params.work_id  = workId;
      const d = await loadMatrix(params);
      setMatrix(d);
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="col gap-14">
      <div className="pmt-filters">
        <div className="min-w-200">
          <SelectInput value={category} onChange={setCategory} options={CATEGORY_FILTER_OPTIONS} />
        </div>
        <div style={{ minWidth: 280 }}>
          <Combobox value={workId} onChange={(v) => setWorkId(v || '')} options={workOpts} placeholder="Все типы" />
        </div>
        <Btn variant="primary" onClick={onLoad} disabled={loading}>{loading ? '...' : 'Показать'}</Btn>
      </div>

      {loading ? (
        <div className="card card-empty" >⏳ Загружаем матрицу…</div>
      ) : !matrix ? (
        <div className="card p-32 t-center c-t3">
          Выберите параметры и нажмите «Показать»
        </div>
      ) : matrix.types.length === 0 ? (
        <div className="card p-32 t-center c-t3">
          Нет типов допусков по заданным фильтрам
        </div>
      ) : (
        <div className="pmt-matrix">
          <table>
            <thead>
              <tr>
                <th>Сотрудник</th>
                {matrix.types.map((t) => {
                  const cat = CATEGORIES[t.category] || {};
                  const mandatory = matrix.required && matrix.required[t.id] === true;
                  return (
                    <th key={t.id} className="diag" title={t.name} style={{ borderLeftColor: cat.color || 'var(--brd-1)' }}>
                      {mandatory ? <b>*</b> : null}{(t.name || '').substring(0, 20)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {matrix.employees.map((emp) => (
                <tr key={emp.id}>
                  <td>{emp.fio}</td>
                  {matrix.types.map((t) => {
                    const cell = matrix.matrix[`${emp.id}_${t.id}`];
                    let icon = '—';
                    let cls  = '';
                    let title = 'Нет допуска';
                    if (cell) {
                      if (cell.status === 'expired') { icon = '✗'; cls = 'err'; title = 'Истёк'; }
                      else if (cell.status === 'expiring_14') { icon = '⚠'; cls = 'err';  title = `${cell.days_left} дн.`; }
                      else if (cell.status === 'expiring_30') { icon = '⚠'; cls = 'warn'; title = `${cell.days_left} дн.`; }
                      else { icon = '✓'; cls = 'ok'; title = 'Действует'; }
                    }
                    return <td key={t.id} className={'pmt-matrix-cell ' + cls} title={title}>{icon}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {matrix.required && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--t-3)' }}>
              <b>*</b> — обязательные допуски для проекта
            </div>
          )}
        </div>
      )}
    </div>
  );
}
