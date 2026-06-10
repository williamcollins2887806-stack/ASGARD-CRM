import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import {
  Users, Plus, ChevronRight, Send, Save, CheckCircle, Clock,
  AlertTriangle, UserPlus, XCircle, Briefcase,
} from 'lucide-react';

const STATUS_CONFIG = {
  draft:        { label: 'Черновик',     color: 'var(--text-tertiary)', icon: Save },
  new:          { label: 'Ожидает HR',   color: 'var(--warn-t)',        icon: Clock },
  in_progress:  { label: 'В работе',     color: 'var(--blue)',          icon: Users },
  sent_to_pm:   { label: 'На просмотре', color: 'var(--info-t)',             icon: Send },
  approved:     { label: 'Утверждена',   color: 'var(--green)',         icon: CheckCircle },
  added_to_crew:{ label: 'Добавлены',    color: 'var(--green)',         icon: UserPlus },
  rework:       { label: 'Доработка',    color: 'var(--err-t)',         icon: AlertTriangle },
  cancelled:    { label: 'Отменена',     color: 'var(--text-tertiary)', icon: XCircle },
};

const ROLES = [
  { key: 'master',    label: 'Мастера' },
  { key: 'fitter',    label: 'Слесари' },
  { key: 'welder',    label: 'Сварщики' },
  { key: 'pto',       label: 'ПТО' },
  { key: 'chemist',   label: 'Химики' },
  { key: 'insulator', label: 'Изолировщики' },
  { key: 'assembler', label: 'Монтажники' },
  { key: 'laborer',   label: 'Разнорабочие' },
];

const FOOD_OPTIONS = [
  { key: 'ration',  label: 'Паёк' },
  { key: 'canteen', label: 'Столовая' },
  { key: 'self',    label: 'Самостоятельно' },
];

const HOUSING_OPTIONS = [
  { key: 'wagon',    label: 'Вагон-городок' },
  { key: 'hotel',    label: 'Гостиница' },
  { key: 'dormitory',label: 'Общежитие' },
];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function StaffRequests() {
  const haptic = useHaptic();
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();
  const isPM = ['PM', 'HEAD_PM'].includes(user?.role);
  const isHR = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN'].includes(user?.role);

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [works, setWorks] = useState([]);
  const [tab, setTab] = useState(isPM ? 'my' : 'pending');

  // Create form
  const [formWorkId, setFormWorkId] = useState(searchParams.get('work_id') || '');
  const [formDateFrom, setFormDateFrom] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formFood, setFormFood] = useState('ration');
  const [formHousing, setFormHousing] = useState('wagon');
  const [formRotation, setFormRotation] = useState('45/15');
  const [formRoles, setFormRoles] = useState({});
  const [formSaving, setFormSaving] = useState(false);

  // Допуски (требования к объекту по должностям)
  const [permitTypes, setPermitTypes] = useState([]);
  const [workReqs, setWorkReqs] = useState([]);        // work_permit_requirements
  const [missingRoles, setMissingRoles] = useState([]); // подсветка из 409
  const [customName, setCustomName] = useState({});     // role_key -> name
  const [selType, setSelType] = useState({});           // role_key -> permit_type_id

  const loadWorkReqs = useCallback(async (wId) => {
    if (!wId) { setWorkReqs([]); return; }
    try {
      const r = await api.get(`/permits/work/${wId}/requirements`);
      setWorkReqs(r?.requirements || api.extractRows(r) || []);
    } catch { setWorkReqs([]); }
  }, []);

  const addReq = async (roleKey, permitTypeId) => {
    if (!formWorkId || !permitTypeId) return;
    haptic.medium();
    try {
      await api.post(`/permits/work/${formWorkId}/requirements`,
        { permit_type_id: Number(permitTypeId), role_key: roleKey || null, is_mandatory: true });
      setSelType(prev => ({ ...prev, [roleKey || '']: '' }));
      await loadWorkReqs(formWorkId);
    } catch (e) { haptic.error(); setFormError(e.message); }
  };

  const addNoReq = async (roleKey) => {
    if (!formWorkId) return;
    haptic.medium();
    try {
      await api.post(`/permits/work/${formWorkId}/requirements`,
        { no_permits_required: true, role_key: roleKey || null });
      await loadWorkReqs(formWorkId);
    } catch (e) { haptic.error(); setFormError(e.message); }
  };

  const addCustomReq = async (roleKey) => {
    const name = (customName[roleKey || ''] || '').trim();
    if (!formWorkId || name.length < 3) { setFormError('Название допуска — от 3 символов'); return; }
    haptic.medium();
    try {
      await api.post(`/permits/work/${formWorkId}/requirements/custom`,
        { name, category: 'special', role_key: roleKey || null, is_mandatory: true });
      setCustomName(prev => ({ ...prev, [roleKey || '']: '' }));
      const t = await api.get('/permits/types'); setPermitTypes(t?.types || api.extractRows(t) || []);
      await loadWorkReqs(formWorkId);
    } catch (e) { haptic.error(); setFormError(e.message); }
  };

  const delReq = async (id) => {
    if (!formWorkId) return;
    haptic.light();
    try {
      await api.delete(`/permits/work/${formWorkId}/requirements/${id}`);
      await loadWorkReqs(formWorkId);
    } catch (e) { haptic.error(); setFormError(e.message); }
  };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = tab === 'my' ? '/staff-requests/my' : '/staff-requests/pending';
      const res = await api.get(endpoint);
      setRequests(api.extractRows(res) || []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const openCreate = async () => {
    haptic.medium();
    try {
      const res = await api.get('/works?status=active&limit=100');
      setWorks(api.extractRows(res) || []);
    } catch { setWorks([]); }
    try {
      const t = await api.get('/permits/types');
      setPermitTypes(t?.types || api.extractRows(t) || []);
    } catch { setPermitTypes([]); }
    setMissingRoles([]);
    if (formWorkId) loadWorkReqs(formWorkId);
    setShowCreate(true);
  };

  // Перезагружать требования при смене объекта
  useEffect(() => {
    if (showCreate) { setMissingRoles([]); loadWorkReqs(formWorkId); }
  }, [formWorkId, showCreate, loadWorkReqs]);

  const [formError, setFormError] = useState(null);

  const buildBody = () => {
    const positions = ROLES.filter(r => (formRoles[r.key] || 0) > 0)
      .map(r => ({ role_key: r.key, role_label: r.label, required_count: formRoles[r.key] }));
    return {
      work_id: Number(formWorkId),
      date_from: formDateFrom || null,
      work_description: formDescription,
      work_conditions: { food: formFood, housing: formHousing, rotation: formRotation },
      positions,
    };
  };

  const handleSaveDraft = async () => {
    if (!formWorkId) return;
    haptic.medium();
    setFormSaving(true);
    setFormError(null);
    try {
      await api.post('/staff-requests', buildBody());
      haptic.success();
      setShowCreate(false);
      resetForm();
      await fetchRequests();
    } catch (e) {
      haptic.error();
      setFormError(e.message);
    } finally {
      setFormSaving(false);
    }
  };

  const handleSaveAndSubmit = async () => {
    if (!formWorkId) return;
    haptic.medium();
    setFormSaving(true);
    setFormError(null);
    try {
      // Сохраняем черновик и получаем ID
      const created = await api.post('/staff-requests', buildBody());
      const draftId = created?.id || created?.request?.id;
      if (draftId) {
        try {
          await api.put(`/staff-requests/${draftId}/submit`);
        } catch (e) {
          // 409 — не заданы требуемые допуска для должностей
          if (e.status === 409 && e.body && e.body.missing_roles) {
            setMissingRoles(e.body.missing_roles);
            setFormError(e.body.error || 'Заполните требуемые допуска для должностей');
            await loadWorkReqs(formWorkId);
            haptic.error();
            setFormSaving(false);
            await fetchRequests(); // черновик уже создан — обновим список
            return;
          }
          throw e;
        }
      }
      haptic.success();
      setShowCreate(false);
      resetForm();
      await fetchRequests();
    } catch (e) {
      haptic.error();
      setFormError(e.message);
    } finally {
      setFormSaving(false);
    }
  };

  const [actionError, setActionError] = useState(null);

  const handleSubmit = async (id) => {
    haptic.medium();
    setActionError(null);
    try {
      await api.put(`/staff-requests/${id}/submit`);
      haptic.success();
      setDetail(null);
      await fetchRequests();
    } catch (e) {
      haptic.error();
      setActionError(e.message);
    }
  };

  const handleTake = async (id) => {
    haptic.medium();
    setActionError(null);
    try {
      await api.put(`/staff-requests/${id}/take`);
      haptic.success();
      await fetchRequests();
      try { const updated = await api.get(`/staff-requests/${id}`); setDetail(updated); } catch {}
    } catch (e) {
      haptic.error();
      setActionError(e.message);
    }
  };

  const handleApprove = async (id) => {
    haptic.medium();
    setActionError(null);
    try {
      await api.put(`/staff-requests/${id}/approve`);
      haptic.success();
      setDetail(null);
      await fetchRequests();
    } catch (e) {
      haptic.error();
      setActionError(e.message);
    }
  };

  const handleAddToCrew = async (id) => {
    haptic.medium();
    setActionError(null);
    try {
      await api.put(`/staff-requests/${id}/add-to-crew`);
      haptic.success();
      setDetail(null);
      await fetchRequests();
    } catch (e) {
      haptic.error();
      setActionError(e.message);
    }
  };

  const resetForm = () => {
    setFormWorkId(''); setFormDateFrom(''); setFormDescription('');
    setFormFood('ration'); setFormHousing('wagon'); setFormRotation('45/15');
    setFormRoles({});
    setWorkReqs([]); setMissingRoles([]); setCustomName({}); setSelType({});
  };

  const updateRoleCount = (key, delta) => {
    haptic.light();
    setFormRoles(prev => ({
      ...prev,
      [key]: Math.max(0, (prev[key] || 0) + delta),
    }));
  };

  return (
    <PageShell title="Заявки на персонал">
      <PullToRefresh onRefresh={fetchRequests}>
        {/* Tabs */}
        {(isPM || isHR) && (
          <div className="flex gap-1.5 px-1 pb-3">
            {isPM && (
              <FilterPill active={tab === 'my'} label="Мои заявки"
                onClick={() => { haptic.light(); setTab('my'); }} />
            )}
            {isHR && (
              <>
                <FilterPill active={tab === 'pending'} label="Входящие"
                  onClick={() => { haptic.light(); setTab('pending'); }} />
                <FilterPill active={tab === 'all'} label="Все"
                  onClick={() => { haptic.light(); setTab('all'); }} />
              </>
            )}
          </div>
        )}

        {loading ? <SkeletonList count={5} /> : requests.length === 0 ? (
          <EmptyState icon={Users} iconColor="var(--info-t)" iconBg="color-mix(in srgb, var(--info-t) 10%, transparent)"
            title="Нет заявок" description={tab === 'my' ? 'Создайте первую заявку' : 'Нет входящих заявок'} />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {requests.map((req, i) => {
              const cfg = STATUS_CONFIG[req.status_v2 || req.status] || STATUS_CONFIG.new;
              const totalRequired = req.total_required || (req.positions || []).reduce((s, p) => s + (p.required_count || 0), 0);
              const totalFilled = req.total_filled || (req.positions || []).reduce((s, p) => s + (p.filled_count || 0), 0);
              return (
                <button key={req.id} onClick={() => { haptic.light(); setDetail(req); }}
                  className="card-glass w-full text-left px-4 py-3 spring-tap"
                  style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[14px] font-semibold truncate c-primary flex-1">
                      {req.work_title || `Заявка #${req.id}`}
                    </p>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ml-2"
                      style={{
                        background: `color-mix(in srgb, ${cfg.color} 15%, transparent)`,
                        color: cfg.color,
                      }}>
                      {cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] c-secondary">
                    {req.pm_name && <span>РП: {req.pm_name}</span>}
                    {req.date_from && <span>с {fmtDate(req.date_from)}</span>}
                    <span>{totalFilled}/{totalRequired} чел.</span>
                  </div>
                  {/* Progress bar */}
                  {totalRequired > 0 && (
                    <div style={{
                      height: 4, borderRadius: 2, marginTop: 6,
                      background: 'var(--bg-primary)', overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', borderRadius: 2,
                        width: `${Math.min(100, (totalFilled / totalRequired) * 100)}%`,
                        background: totalFilled >= totalRequired ? 'var(--green)' : 'var(--blue)',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      {/* Error toast */}
      {actionError && (
        <div className="fixed top-4 left-4 right-4 z-50 rounded-xl px-4 py-3 flex items-center gap-2"
          style={{ background: 'color-mix(in srgb, var(--err-t) 15%, var(--bg-elevated))', border: '1px solid color-mix(in srgb, var(--err-t) 40%, transparent)' }}
          onClick={() => setActionError(null)}>
          <AlertTriangle size={16} style={{ color: 'var(--err-t)', flexShrink: 0 }} />
          <span className="text-sm" style={{ color: 'var(--err-t)' }}>{actionError}</span>
        </div>
      )}

      {/* FAB */}
      {isPM && (
        <button onClick={openCreate}
          style={{
            position: 'fixed', bottom: 80, right: 20, zIndex: 50,
            width: 56, height: 56, borderRadius: 16,
            background: 'linear-gradient(135deg, var(--blue), var(--info))',
            boxShadow: '0 4px 16px color-mix(in srgb, var(--blue) 40%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff',
          }}
          className="spring-tap">
          <Plus size={24} />
        </button>
      )}

      {/* Detail BottomSheet */}
      <BottomSheet open={!!detail} onClose={() => setDetail(null)}
        title={detail?.work_title || `Заявка #${detail?.id || ''}`}>
        {detail && (
          <div className="flex flex-col gap-3 pb-4">
            {/* Status */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold"
                style={{ color: (STATUS_CONFIG[detail.status_v2 || detail.status] || STATUS_CONFIG.new).color }}>
                {(STATUS_CONFIG[detail.status_v2 || detail.status] || STATUS_CONFIG.new).label}
              </span>
            </div>

            {/* Positions progress */}
            {detail.positions && detail.positions.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Позиции</p>
                {detail.positions.map((p, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-sm c-primary">{p.role_label}</span>
                    <span className="text-sm font-semibold"
                      style={{ color: p.filled_count >= p.required_count ? 'var(--green)' : 'var(--text-primary)' }}>
                      {p.filled_count}/{p.required_count}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Assignments */}
            {detail.assignments && detail.assignments.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Назначенные</p>
                {detail.assignments.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-sm c-primary">{a.fio || a.employee_name || '—'}</span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                      style={{
                        background: a.status === 'approved' ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'var(--bg-primary)',
                        color: a.status === 'approved' ? 'var(--green)' : 'var(--text-secondary)',
                      }}>
                      {a.assigned_role} · {a.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {detail.work_description && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">Описание</p>
                <p className="text-[13px] c-primary">{detail.work_description}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-2 mt-2">
              {/* PM: submit draft */}
              {isPM && (detail.status_v2 === 'draft' || detail.status_v2 === 'rework') && (
                <button onClick={() => handleSubmit(detail.id)}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold spring-tap"
                  style={{ background: 'linear-gradient(135deg, var(--blue), var(--info))', color: '#fff' }}>
                  📨 Отправить HR
                </button>
              )}
              {/* PM: add to crew */}
              {isPM && detail.status_v2 === 'approved' && (
                <button onClick={() => handleAddToCrew(detail.id)}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold spring-tap"
                  style={{ background: 'linear-gradient(135deg, var(--green), var(--ok))', color: '#fff' }}>
                  👥 Добавить в бригаду
                </button>
              )}
              {/* HR: take */}
              {isHR && detail.status_v2 === 'new' && (
                <button onClick={() => handleTake(detail.id)}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold spring-tap"
                  style={{ background: 'linear-gradient(135deg, var(--blue), var(--info))', color: '#fff' }}>
                  📋 Взять в работу
                </button>
              )}
              {/* HR: approve */}
              {isHR && (detail.status_v2 === 'in_progress' || detail.status_v2 === 'sent_to_pm') && (
                <button onClick={() => handleApprove(detail.id)}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold spring-tap"
                  style={{ background: 'linear-gradient(135deg, var(--green), var(--ok))', color: '#fff' }}>
                  ✅ Утвердить
                </button>
              )}
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Create BottomSheet */}
      <BottomSheet open={showCreate} onClose={() => setShowCreate(false)} title="Запросить рабочих">
        <div className="flex flex-col gap-3 pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Объект</p>
            <select value={formWorkId} onChange={e => setFormWorkId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
              <option value="">Выберите объект</option>
              {works.map(w => (
                <option key={w.id} value={w.id}>{w.work_title || w.title}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Дата начала</p>
            <input type="date" value={formDateFrom} onChange={e => setFormDateFrom(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
          </div>

          {/* Role counters */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 c-tertiary">Количество по ролям</p>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map(r => (
                <div key={r.key} className="flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)' }}>
                  <span className="text-xs c-primary">{r.label}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateRoleCount(r.key, -1)}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold spring-tap"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>−</button>
                    <span className="text-sm font-semibold w-4 text-center c-primary">{formRoles[r.key] || 0}</span>
                    <button onClick={() => updateRoleCount(r.key, 1)}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold spring-tap"
                      style={{ background: 'color-mix(in srgb, var(--blue) 20%, transparent)', color: 'var(--blue)' }}>+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Требуемые допуска по должностям */}
          {formWorkId && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 c-tertiary">Требуемые допуска</p>
              {(() => {
                const activeRoles = ROLES.filter(r => (formRoles[r.key] || 0) > 0);
                const blocks = [{ key: '', label: 'Для всех должностей' }]
                  .concat(activeRoles.map(r => ({ key: r.key, label: r.label })));
                if (!activeRoles.length) {
                  return <p className="text-[11px] c-tertiary">Укажите количество по ролям выше, затем задайте допуска.</p>;
                }
                const byRole = {};
                workReqs.forEach(w => { const k = w.role_key || ''; (byRole[k] = byRole[k] || []).push(w); });
                return blocks.map(b => {
                  const list = byRole[b.key] || [];
                  const marker = list.find(x => x.no_permits_required);
                  const perms = list.filter(x => !x.no_permits_required && x.permit_type_id);
                  const isMissing = missingRoles.includes(b.key);
                  return (
                    <div key={b.key || '_all'} className="mb-2 px-3 py-2 rounded-lg"
                      style={{ backgroundColor: 'var(--bg-primary)',
                        border: `1px solid ${isMissing ? 'var(--err-t)' : 'var(--border-norse)'}` }}>
                      <p className="text-xs font-semibold mb-1 c-primary">
                        {b.label}{isMissing && <span style={{ color: 'var(--err-t)' }}> — заполните</span>}
                      </p>
                      {marker ? (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] c-tertiary">Допуска не требуются</span>
                          <button onClick={() => delReq(marker.id)} className="text-[11px]" style={{ color: 'var(--err-t)' }}>отменить</button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {perms.length ? perms.map(p => (
                            <span key={p.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]"
                              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                              {p.type_name || `#${p.permit_type_id}`}
                              <button onClick={() => delReq(p.id)} style={{ color: 'var(--err-t)' }}>✕</button>
                            </span>
                          )) : <span className="text-[11px] c-tertiary">—</span>}
                        </div>
                      )}
                      {!marker && (
                        <>
                          <div className="flex gap-1.5 mb-1.5">
                            <select value={selType[b.key] || ''} onChange={e => setSelType(prev => ({ ...prev, [b.key]: e.target.value }))}
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs"
                              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                              <option value="">+ из списка…</option>
                              {permitTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                            <button onClick={() => addReq(b.key, selType[b.key])}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold spring-tap"
                              style={{ background: 'color-mix(in srgb, var(--blue) 20%, transparent)', color: 'var(--blue)' }}>Добавить</button>
                          </div>
                          <div className="flex gap-1.5">
                            <input value={customName[b.key] || ''} onChange={e => setCustomName(prev => ({ ...prev, [b.key]: e.target.value }))}
                              placeholder="Свой допуск (нет в списке)…"
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs"
                              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
                            <button onClick={() => addCustomReq(b.key)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold spring-tap"
                              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>+ Своё</button>
                          </div>
                          <button onClick={() => addNoReq(b.key)} className="mt-1.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                            Допуска не требуются
                          </button>
                        </>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {/* Conditions */}
          <div className="flex gap-2">
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Питание</p>
              <select value={formFood} onChange={e => setFormFood(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                {FOOD_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Жильё</p>
              <select value={formHousing} onChange={e => setFormHousing(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                {HOUSING_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Описание</p>
            <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)}
              placeholder="Условия работы, особенности объекта..."
              rows={2} className="w-full px-3 py-2 rounded-lg text-sm resize-none"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }} />
          </div>

          {formError && (
            <div className="px-3 py-2 rounded-lg text-xs" style={{
              background: 'color-mix(in srgb, var(--err-t) 12%, transparent)',
              color: 'var(--err-t)', border: '1px solid var(--err-t)' }}>
              {formError}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2">
            <button onClick={handleSaveDraft} disabled={formSaving || !formWorkId}
              className="flex-1 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 spring-tap"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
              {formSaving ? '...' : '💾 Черновик'}
            </button>
            <button onClick={() => handleSaveAndSubmit()} disabled={formSaving || !formWorkId}
              className="flex-1 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 spring-tap"
              style={{ background: 'linear-gradient(135deg, var(--blue), var(--info))', color: '#fff' }}>
              {formSaving ? '...' : '📨 Отправить HR'}
            </button>
          </div>
        </div>
      </BottomSheet>
    </PageShell>
  );
}

function FilterPill({ active, label, onClick }) {
  return (
    <button onClick={onClick} className="filter-pill spring-tap" data-active={active ? 'true' : undefined}>
      {label}
    </button>
  );
}
