import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { MessageCircle } from 'lucide-react';

export default function Chat() {
  return (
    <PageShell title="Хугинн">
      <EmptyState
        icon={MessageCircle}
        iconColor="#7B68EE"
        iconBg="rgba(123, 104, 238, 0.1)"
        title="Мессенджер Хугинн"
        description="Чаты команды, файлы и ИИ-помощник Мимир — всё в одном месте"
        badge="Мимир ✦"
      />

      {/* Skeleton preview */}
      <div className="mt-2 px-1" style={{ opacity: 0.5 }}>
        <p
          className="text-xs font-medium mb-3 pl-1"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Превью чатов
        </p>
        <SkeletonList count={4} />
      </div>
    </PageShell>
  );
}
