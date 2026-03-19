import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { Wrench } from 'lucide-react';

export default function Works() {
  return (
    <PageShell title="Работы">
      <EmptyState
        icon={Wrench}
        iconColor="var(--green)"
        iconBg="rgba(48, 209, 88, 0.1)"
        title="Работы и объекты"
        description="Управление строительными объектами, актами и отчётами"
        badge="Скоро"
      />

      {/* Skeleton preview */}
      <div className="mt-2 px-1" style={{ opacity: 0.5 }}>
        <p
          className="text-xs font-medium mb-3 pl-1"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Превью объектов
        </p>
        <SkeletonList count={3} />
      </div>
    </PageShell>
  );
}
