import { useState, useEffect } from 'react';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { EmptyState } from '@/blocks/Blocks';
import {
  STATUS_MAP, loadPlannedByProject, fmtDate,
} from './api';

export function PlannedByProjectView({ onOpenEmployee }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState({});

  const refresh = () => {
    setLoading(true);
    loadPlannedByProject()
      .then(setProjects)
      .catch((e) => toast.error('Не удалось загрузить план: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:personnel:changed', onChanged);
    return () => window.removeEventListener('asgard:personnel:changed', onChanged);
  }, []);

  if (loading) {
    return <div className="card card-empty">Загружаем план по проектам…</div>;
  }

  if (!projects.length) {
    return (
      <EmptyState
        icon="📋"
        title="Нет планируемого привлечения"
        hint="Назначьте проект в карточке рабочего — блок «Планируемое привлечение»"
      />
    );
  }

  return (
    <div className="prs-by-project">
      {projects.map((p) => {
        const open = collapsed[p.work_id] !== true;
        return (
          <div key={p.work_id} className="prs-by-project-block">
            <button
              type="button"
              className="prs-by-project-head"
              onClick={() => setCollapsed((c) => ({ ...c, [p.work_id]: open }))}
            >
              <span className="prs-by-project-chevron">{open ? '▼' : '▶'}</span>
              <span className="prs-by-project-title">{p.work_title}</span>
              <span className="prs-by-project-meta">
                {p.workers.length} чел. · РП {p.pm_name || '—'}
              </span>
            </button>
            {open && (
              <table className="prs-table prs-by-project-table">
                <thead>
                  <tr>
                    <th>ФИО</th>
                    <th>Специальность</th>
                    <th>Сейчас</th>
                    <th>Период плана</th>
                    <th>Примечание</th>
                  </tr>
                </thead>
                <tbody>
                  {p.workers.map((w) => {
                    const st = STATUS_MAP[w.readiness_status] || STATUS_MAP[w.effective_status];
                    const period = [w.planned_from, w.planned_to].filter(Boolean).map(fmtDate).join(' — ');
                    return (
                      <tr
                        key={w.employee_id}
                        className="prs-row"
                        onClick={() => onOpenEmployee?.({ id: w.employee_id, fio: w.fio })}
                      >
                        <td><div className="prs-fio">{w.fio}</div></td>
                        <td className="prs-spec">{w.role_tag || w.position || '—'}</td>
                        <td>
                          {w.on_site_info ? (
                            <div>
                              <span className="prs-plan-chip prs-plan-chip--onsite">На объекте</span>
                              <div className="prs-work fs-12">{w.on_site_info.work_title}</div>
                            </div>
                          ) : (
                            st ? <span className="prs-plan-chip">{st.label}</span> : '—'
                          )}
                        </td>
                        <td className="prs-dim">{period || '—'}</td>
                        <td className="prs-dim fs-12">{w.note || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
