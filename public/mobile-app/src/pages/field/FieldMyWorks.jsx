import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, MapPin, Phone, ArrowRight, ClipboardList } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';

function formatMoney(val) {
  if (!val && val !== 0) return '0 \u20BD';
  return Number(val).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' \u20BD';
}

function shortenName(fio) {
  if (!fio) return '';
  const parts = fio.trim().split(/\s+/);
  if (parts.length < 2) return fio;
  return `${parts[0]} ${parts.slice(1).map(p => p[0] + '.').join('')}`;
}

function Skeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="h-6 w-36 rounded" style={{ backgroundColor: 'var(--border-norse)' }} />
      <div className="flex gap-3">
        {[1, 2, 3].map(i => <div key={i} className="flex-1 h-14 rounded-lg" style={{ backgroundColor: 'var(--border-norse)' }} />)}
      </div>
      {[1, 2].map(i => <div key={i} className="h-36 rounded-xl" style={{ backgroundColor: 'var(--border-norse)' }} />)}
    </div>
  );
}

function ProjectCard({ project, isActive, navigate, haptic }) {
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{project.object_name || project.name}</h3>
        <div className="flex items-center gap-1 mt-1">
          <MapPin size={13} style={{ color: 'var(--text-tertiary)' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {[project.city, project.customer_name].filter(Boolean).join(' · ')}
          </span>
        </div>
        {(project.date_from || project.date_to) && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {project.date_from ? new Date(project.date_from).toLocaleDateString('ru-RU') : '?'} — {project.date_to ? new Date(project.date_to).toLocaleDateString('ru-RU') : '...'}
          </p>
        )}
      </div>
      <div className="flex gap-4">
        {project.shifts_count != null && (
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Смены</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{parseInt(project.shifts_count) || 0}</p>
          </div>
        )}
        {project.total_earned != null && (
          <div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Заработано</p>
            <p className="text-sm font-medium" style={{ color: 'var(--gold)' }}>{formatMoney(project.total_earned)}</p>
          </div>
        )}
      </div>
      {/* Contacts */}
      {(project.pm_name || project.master_name) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t" style={{ borderColor: 'var(--border-norse)' }}>
          {project.pm_name && (
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>РП:</span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{shortenName(project.pm_name)}</span>
              {project.pm_phone && (
                <a href={`tel:${project.pm_phone}`} className="ml-1"><Phone size={12} style={{ color: 'var(--gold)' }} /></a>
              )}
            </div>
          )}
          {project.masters?.length > 0 ? project.masters.map((m, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Мастер:</span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{shortenName(m.fio || m.name)}</span>
              {(m.phone) && (
                <a href={`tel:${m.phone}`} className="ml-1"><Phone size={12} style={{ color: 'var(--gold)' }} /></a>
              )}
            </div>
          )) : project.master_name ? (
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Мастер:</span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{shortenName(project.master_name)}</span>
              {project.master_phone && (
                <a href={`tel:${project.master_phone}`} className="ml-1"><Phone size={12} style={{ color: 'var(--gold)' }} /></a>
              )}
            </div>
          ) : null}
        </div>
      )}
      {/* Action */}
      {isActive ? (
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium"
          style={{ backgroundColor: 'var(--gold)', color: 'var(--bg-primary)' }}
          onClick={() => { haptic.medium(); navigate('/field/shift'); }}
        >
          На смену <ArrowRight size={16} />
        </button>
      ) : (
        <button
          className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium"
          style={{ border: '1px solid var(--border-norse)', color: 'var(--text-secondary)' }}
          onClick={() => { haptic.light(); navigate('/field/history'); }}
        >
          <ClipboardList size={16} /> Табель
        </button>
      )}
    </div>
  );
}

export default function FieldMyWorks() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await fieldApi.get('/worker/projects');
        setProjects(Array.isArray(data) ? data : data?.projects || []);
      } catch (e) { /* auth redirect handled */ }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <Skeleton />;
  const active = projects.filter(p => p.is_active || p.status === 'active');
  const completed = projects.filter(p => !p.is_active && p.status !== 'active');
  const totalShifts = projects.reduce((s, p) => s + (parseInt(p.shifts_count) || 0), 0);
  const totalEarned = projects.reduce((s, p) => s + (parseFloat(p.total_earned) || 0), 0);

  return (
    <div className="p-4 pb-24 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Briefcase size={22} style={{ color: 'var(--gold)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Мои проекты</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{projects.length}</p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Объекты</p>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{totalShifts}</p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Смены</p>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-lg font-bold" style={{ color: 'var(--gold)' }}>{formatMoney(totalEarned)}</p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Заработано</p>
        </div>
      </div>

      {/* Active */}
      {active.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#16a34a' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Активные</span>
          </div>
          {active.map((p, i) => <ProjectCard key={p.id || i} project={p} isActive navigate={navigate} haptic={haptic} />)}
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--text-tertiary)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Завершённые</span>
          </div>
          {completed.map((p, i) => <ProjectCard key={p.id || i} project={p} isActive={false} navigate={navigate} haptic={haptic} />)}
        </div>
      )}

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <Briefcase size={32} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>У вас пока нет проектов</p>
        </div>
      )}
    </div>
  );
}
