import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, MapPin, Phone, ArrowRight, ArrowLeft, ClipboardList, Calendar, Users, Banknote, UserRound } from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { formatMoney } from '@/lib/utils';
import { Card, IconTile, KeyButton, SectionLabel, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

function shortenName(fio) {
  if (!fio) return '';
  const parts = fio.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 3) return `${parts[0]} ${parts[1]} ${parts[2][0]}.`;
  if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
  return fio;
}
function Skeleton() {
  return (
    <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
      <SkeletonList count={3} />
    </div>
  );
}

function ProjectCard({ project, isActive, navigate, haptic }) {
  return (
    <Card variant="raised" className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{project.object_name || project.name}</h3>
        <div className="flex items-center gap-1 mt-1">
          <MapPin size={13} style={{ color: 'var(--text-tertiary)' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {[project.city, project.customer_name].filter(Boolean).join(' · ')}
          </span>
        </div>
        {(project.date_from || project.date_to) && (
          <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
            <Calendar size={11} strokeWidth={2.4} aria-hidden />
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
            <p className="text-sm font-medium" style={{ color: 'var(--value-ink)' }}>{formatMoney(project.total_earned)}</p>
          </div>
        )}
      </div>
      {/* Contacts */}
      {(project.pm_name || project.master_name) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1" style={{ borderTop: '1px solid var(--tile-brd)' }}>
          {project.pm_name && (
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>РП:</span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{shortenName(project.pm_name)}</span>
              {project.pm_phone && (
                <a href={`tel:${project.pm_phone}`} className="ml-1" aria-label="Позвонить РП"><Phone size={12} style={{ color: 'var(--value-ink)' }} /></a>
              )}
            </div>
          )}
          {project.masters?.length > 0 ? project.masters.map((m, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Мастер:</span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{shortenName(m.fio || m.name)}</span>
              {(m.phone) && (
                <a href={`tel:${m.phone}`} className="ml-1" aria-label="Позвонить мастеру"><Phone size={12} style={{ color: 'var(--value-ink)' }} /></a>
              )}
            </div>
          )) : project.master_name ? (
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Мастер:</span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{shortenName(project.master_name)}</span>
              {project.master_phone && (
                <a href={`tel:${project.master_phone}`} className="ml-1" aria-label="Позвонить мастеру"><Phone size={12} style={{ color: 'var(--value-ink)' }} /></a>
              )}
            </div>
          ) : null}
        </div>
      )}
      {/* Action */}
      {isActive ? (
        <KeyButton tone="value" block icon={ArrowRight} onClick={() => { haptic.medium(); navigate('/field/shift'); }}>
          На смену
        </KeyButton>
      ) : (
        <KeyButton tone="neutral" block icon={ClipboardList} onClick={() => { haptic.light(); navigate('/field/timesheet'); }}>
          Табель
        </KeyButton>
      )}
    </Card>
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
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content space-y-4">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate(-1)} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Briefcase} tone="value" size={40} />
          <h1 className="fs-head__title">Мои проекты</h1>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <Card variant="raised" className="p-3 text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <IconTile icon={Briefcase} tone="neutral" size={30} />
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{projects.length}</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Объекты</p>
          </Card>
          <Card variant="raised" className="p-3 text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <IconTile icon={Users} tone="accent" size={30} />
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{totalShifts}</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Смены</p>
          </Card>
          <Card variant="raised" className="p-3 text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <IconTile icon={Banknote} tone="value" size={30} />
            <p className="text-lg font-bold" style={{ color: 'var(--value-ink)' }}>{formatMoney(totalEarned)}</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Заработано</p>
          </Card>
        </div>

        {/* Active */}
        {active.length > 0 && (
          <div className="space-y-3">
            <SectionLabel>
              <span className="inline-flex items-center gap-1.5">
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />
                Активные
              </span>
            </SectionLabel>
            {active.map((p, i) => <ProjectCard key={p.id || i} project={p} isActive navigate={navigate} haptic={haptic} />)}
          </div>
        )}

        {/* Completed */}
        {completed.length > 0 && (
          <div className="space-y-3">
            <SectionLabel>
              <span className="inline-flex items-center gap-1.5">
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text-tertiary)', display: 'inline-block' }} />
                Завершённые
              </span>
            </SectionLabel>
            {completed.map((p, i) => <ProjectCard key={p.id || i} project={p} isActive={false} navigate={navigate} haptic={haptic} />)}
          </div>
        )}

        {/* Empty state */}
        {projects.length === 0 && (
          <EmptyState icon={Briefcase} title="У вас пока нет проектов" description="Проекты появятся после назначения" />
        )}
      </div>
    </div>
  );
}
