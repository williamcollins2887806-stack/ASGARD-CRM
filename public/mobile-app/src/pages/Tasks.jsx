import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { CheckSquare } from 'lucide-react';

export default function Tasks() {
  return (
    <PageShell title="Задачи">
      <EmptyState
        icon={CheckSquare}
        iconColor="var(--blue)"
        iconBg="rgba(74, 144, 217, 0.1)"
        title="Управление задачами"
        description="Создание, назначение и контроль задач с удобным интерфейсом"
        badge="Скоро"
      />

      {/* Skeleton preview */}
      <div className="mt-2 px-1" style={{ opacity: 0.5 }}>
        <p
          className="text-xs font-medium mb-3 pl-1"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Превью интерфейса
        </p>
        <SkeletonList count={3} />
      </div>
    </PageShell>
  );
}
