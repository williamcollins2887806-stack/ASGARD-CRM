import { useState, useEffect, useCallback } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Briefcase, ChevronRight } from 'lucide-react';

const fmtMoney = (n) => n != null ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—';

const STATUS_LABELS = {
  active: 'Работает', unpaid_leave: 'Отпуск за свой счёт',
  maternity: 'Декрет', sick_leave: 'Больничный', fired: 'Уволен',
};
const STATUS_COLORS = {
  active: 'var(--green)', unpaid_leave: 'var(--warn-t)',
  maternity: '#A855F7', sick_leave: 'var(--err-t)', fired: 'var(--text-tertiary)',
};

export default function OfficialEmployees() {
  const haptic = useHaptic();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  // Edit form
  const [editSalary, setEditSalary] = useState('');
  const [editNonBurnable, setEditNonBurnable] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/payroll-dashboard/official-employees');
      setEmployees(api.extractRows(res) || []);
    } catch {
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openDetail = (emp) => {
    haptic.light();
    setDetail(emp);
    setEditSalary(emp.official_salary?.toString() || '');
    setEditNonBurnable(emp.official_non_burnable?.toString() || '');
    setEditStatus(emp.official_status || 'active');
  };

  const handleSave = async () => {
    if (!detail) return;
    haptic.medium();
    setSaving(true);
    try {
      await api.put(`/payroll-dashboard/official-employees/${detail.id}`, {
        official_salary: Number(editSalary) || 0,
        official_non_burnable: Number(editNonBurnable) || 0,
        official_status: editStatus,
      });
      haptic.success();
      setDetail(null);
      await fetchData();
    } catch (e) {
      haptic.error();
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell title="Официально устроенные">
      <PullToRefresh onRefresh={fetchData}>
        {loading ? <SkeletonList count={5} /> : employees.length === 0 ? (
          <EmptyState icon={Briefcase} iconColor="var(--blue)" iconBg="rgba(30,77,140,0.1)"
            title="Нет данных" description="Нет официально устроенных сотрудников" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {employees.map((emp, i) => {
              const stColor = STATUS_COLORS[emp.official_status] || 'var(--text-tertiary)';
              return (
                <button key={emp.id} onClick={() => openDetail(emp)}
                  className="card-glass w-full text-left px-4 py-3 spring-tap"
                  style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold truncate c-primary">{emp.fio || '—'}</p>
                      <p className="text-[11px] mt-0.5 c-secondary">
                        Оклад: <b>{fmtMoney(emp.official_salary)}</b>
                        {emp.official_non_burnable > 0 && (
                          <span> · Несгор.: {fmtMoney(emp.official_non_burnable)}</span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: `color-mix(in srgb, ${stColor} 15%, transparent)`,
                            color: stColor,
                          }}>
                          {STATUS_LABELS[emp.official_status] || emp.official_status}
                        </span>
                        {emp.official_hire_date && (
                          <span className="text-[10px] c-tertiary">
                            с {new Date(emp.official_hire_date).toLocaleDateString('ru-RU')}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={16} className="c-tertiary shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      {/* Edit BottomSheet */}
      <BottomSheet open={!!detail} onClose={() => setDetail(null)} title={detail?.fio || 'Редактирование'}>
        {detail && (
          <div className="flex flex-col gap-3 pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Оклад</p>
              <input type="number" value={editSalary} onChange={e => setEditSalary(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Несгораемая сумма</p>
              <input type="number" value={editNonBurnable} onChange={e => setEditNonBurnable(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Статус</p>
              <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <button onClick={handleSave} disabled={saving}
              className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--green), #166534)', color: '#fff' }}>
              {saving ? 'Сохраняю...' : '💾 Сохранить'}
            </button>
          </div>
        )}
      </BottomSheet>
    </PageShell>
  );
}
