/**
 * ProjectsTab — вкладка «Проекты» (требования + готовность команды).
 * Источник: vanilla permits.js → renderProjectsTab.
 */
import { useState, useEffect } from 'react';
import { toast } from '@/modals/Notifications';
import { useModal } from '@/modals';
import { ConfirmModal } from '@/modals/Confirm';
import { Btn } from '@/modals/parts';
import { Combobox, SelectInput, Checkbox } from '@/inputs/Inputs';
import {
  loadWorks, loadWorkRequirements, loadWorkCompliance,
  addRequirement, deleteRequirement,
  CATEGORIES, POSITION_ROLES, ROLE_LABEL, WRITE_ROLES
} from './api';

export default function ProjectsTab({ user, types }) {
  const { open } = useModal();
  const [works, setWorks] = useState([]);
  const [workId, setWorkId] = useState('');
  const [reqs, setReqs] = useState([]);
  const [compliance, setCompliance] = useState(null);
  const [loading, setLoading] = useState(false);

  // Add-form state
  const [roleKey, setRoleKey] = useState('');
  const [typeIdAdd, setTypeIdAdd] = useState('');
  const [mandatory, setMandatory] = useState(true);

  const canWrite = WRITE_ROLES.includes(user?.role);

  useEffect(() => {
    loadWorks().then((list) => {
      setWorks(list.filter((w) => w.work_status !== 'Завершён'));
    });
  }, []);

  const refresh = async () => {
    if (!workId) return;
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        loadWorkRequirements(workId),
        loadWorkCompliance(workId)
      ]);
      setReqs(r);
      setCompliance(c);
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (workId) refresh(); else { setReqs([]); setCompliance(null); } }, [workId]);

  const reqGroups = {};
  reqs.forEach((r) => {
    const k = r.role_key || '';
    (reqGroups[k] = reqGroups[k] || []).push(r);
  });
  const groupOrder = ['', ...POSITION_ROLES.map((p) => p.key)].filter((k) => reqGroups[k]);

  const onAddReq = async () => {
    if (!typeIdAdd) { toast.warn('Выберите тип'); return; }
    try {
      await addRequirement(workId, {
        permit_type_id: Number(typeIdAdd),
        is_mandatory: mandatory,
        role_key: roleKey || null
      });
      toast.success('Добавлено');
      setTypeIdAdd('');
      refresh();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    }
  };

  const onNoReq = () => {
    const lbl = roleKey ? ROLE_LABEL(roleKey) : 'всех должностей';
    open(<ConfirmModal
      title={`Отметить, что для ${lbl} допуска не требуются?`}
      message="Это специальный маркер для проекта."
      tone="warn"
      okText="Подтвердить"
      onConfirm={async () => {
        try {
          await addRequirement(workId, { no_permits_required: true, role_key: roleKey || null });
          toast.success('Отмечено: допуска не требуются');
          refresh();
        } catch (e) {
          toast.error('Ошибка: ' + (e?.message || e));
        }
      }}
    />);
  };

  const onDelReq = (r) => {
    open(<ConfirmModal
      title="Удалить требование?"
      message={r.type_name || 'Это требование'}
      tone="danger"
      okText="Удалить"
      onConfirm={async () => {
        try { await deleteRequirement(workId, r.id); toast.success('Удалено'); refresh(); }
        catch (e) { toast.error('Ошибка: ' + (e?.message || e)); }
      }}
    />);
  };

  const workOpts = [{ value: '', label: '— Выберите —' },
    ...works.map((w) => ({ value: String(w.id), label: w.work_title || `Проект #${w.id}` }))];

  const roleOpts = [{ value: '', label: 'Для всех должностей' },
    ...POSITION_ROLES.map((p) => ({ value: p.key, label: p.label }))];

  const typeOpts = [{ value: '', label: '— Добавить тип —' },
    ...Object.entries(CATEGORIES).flatMap(([catId, cat]) =>
      types.filter((t) => t.category === catId).map((t) => ({ value: String(t.id), label: `${cat.icon} ${t.name}` }))
    )];

  return (
    <div className="col gap-14">
      <div className="pmt-filters">
        <div style={{ flex: 1, minWidth: 280 }}>
          <Combobox value={workId} onChange={(v) => setWorkId(v || '')} options={workOpts} placeholder="— Выберите работу —" />
        </div>
      </div>

      {!workId ? (
        <div className="card p-32 t-center c-t3">
          Выберите работу для просмотра требований и проверки команды
        </div>
      ) : loading ? (
        <div className="card card-empty" >⏳ Загружаем…</div>
      ) : (
        <>
          <div className="pmt-card">
            <h4>Требуемые допуски по должностям</h4>

            {canWrite && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
                <div className="min-w-160">
                  <div className="fs-11 c-t3 mb-4">Должность</div>
                  <SelectInput value={roleKey} onChange={setRoleKey} options={roleOpts} />
                </div>
                <div className="flex-1 min-w-220">
                  <div className="fs-11 c-t3 mb-4">Тип допуска</div>
                  <SelectInput value={typeIdAdd} onChange={setTypeIdAdd} options={typeOpts} />
                </div>
                <Checkbox checked={mandatory} onChange={setMandatory} label="Обязательный" />
                <Btn size="sm" variant="primary" onClick={onAddReq}>Добавить</Btn>
                <Btn size="sm" variant="ghost"   onClick={onNoReq}>Допуска не требуются</Btn>
              </div>
            )}

            {groupOrder.length === 0
              ? <div className="c-t3">Требования не заданы</div>
              : groupOrder.map((k) => {
                  const list = reqGroups[k];
                  const marker = list.find((r) => r.no_permits_required);
                  const perms  = list.filter((r) => !r.no_permits_required && r.permit_type_id);
                  return (
                    <div key={k || 'all'} className="pmt-req-group">
                      <div className="ttl">{k === '' ? 'Для всех должностей' : ROLE_LABEL(k)}</div>
                      {marker && (
                        <div className="fs-13 c-t2">
                          Допуска не требуются
                          {canWrite && <Btn size="sm" variant="ghost" onClick={() => onDelReq(marker)} className="ml-8">Отменить</Btn>}
                        </div>
                      )}
                      {perms.length > 0 ? (
                        <table className="pmt-tbl mt-8" >
                          <thead>
                            <tr><th>Тип допуска</th><th>Обязательный</th>{canWrite && <th></th>}</tr>
                          </thead>
                          <tbody>
                            {perms.map((r) => (
                              <tr key={r.id}>
                                <td>{r.type_name || '—'}</td>
                                <td>{r.is_mandatory ? <span className="c-ok">Да</span> : 'Нет'}</td>
                                {canWrite && <td><Btn size="sm" variant="ghost" onClick={() => onDelReq(r)}>Удалить</Btn></td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (!marker && <div className="c-t3">—</div>)}
                    </div>
                  );
                })}
          </div>

          {compliance && (
            <div className="pmt-card">
              <h4>
                Готовность команды
                <span className={'pmt-team-ready ' + (compliance.team_ready ? 'ok' : 'err')}>
                  {compliance.team_ready ? 'Готова' : 'Не готова'}
                </span>
              </h4>
              {compliance.compliance.length === 0
                ? <div className="c-t3">В команде проекта нет назначенных сотрудников</div>
                : (
                  <table className="pmt-tbl">
                    <thead><tr><th>Сотрудник</th><th>Допуски</th><th>Статус</th></tr></thead>
                    <tbody>
                      {compliance.compliance.map((c) => (
                        <tr key={c.employee_id}>
                          <td>{c.employee_name}</td>
                          <td className="u-wrap">
                            {c.checks.map((ch, i) => {
                              const t = types.find((x) => x.id === ch.type_id) || { name: ch.type_id };
                              return (
                                <span
                                  key={i}
                                  className={'pmt-check-badge ' + (ch.has ? 'has' : 'miss') + (ch.mandatory ? ' must' : '')}
                                  title={t.name}
                                >
                                  {ch.has ? '+ ' : '- '}{(t.name || '').substring(0, 25)}
                                </span>
                              );
                            })}
                          </td>
                          <td>
                            {c.mandatory_ok
                              ? <span className="c-ok">OK</span>
                              : <span className="c-err">Не хватает</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
