import { useState, useEffect, useCallback } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import {
  GraduationCap, ChevronRight, Upload, CheckCircle, Clock, AlertTriangle,
} from 'lucide-react';

const STATUS_CONFIG = {
  pending:     { label: 'Ожидает',    color: 'var(--warn-t)', icon: Clock },
  in_progress: { label: 'В процессе', color: 'var(--blue)',   icon: Clock },
  completed:   { label: 'Завершено',  color: 'var(--green)',  icon: CheckCircle },
  cancelled:   { label: 'Отменено',   color: 'var(--text-tertiary)', icon: AlertTriangle },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function TrainingBoard() {
  const haptic = useHaptic();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [completing, setCompleting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/training/pending');
      setItems(api.extractRows(res) || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleUpload = async (trainingId) => {
    haptic.medium();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const token = localStorage.getItem('asgard_token');
        const resp = await fetch(`/api/training/upload/${trainingId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (!resp.ok) throw new Error('Ошибка загрузки');
        haptic.success();
        await fetchData();
        // Refresh detail
        if (detail?.id === trainingId) {
          const updated = await api.get(`/training/${trainingId}`);
          setDetail(updated);
        }
      } catch (err) {
        haptic.error();
        alert(err.message);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const handleComplete = async (trainingId) => {
    haptic.medium();
    setCompleting(true);
    try {
      await api.put(`/training/${trainingId}/complete`);
      haptic.success();
      setDetail(null);
      await fetchData();
    } catch (e) {
      haptic.error();
      alert(e.message);
    } finally {
      setCompleting(false);
    }
  };

  return (
    <PageShell title="Обучение и допуски">
      <PullToRefresh onRefresh={fetchData}>
        {loading ? <SkeletonList count={5} /> : items.length === 0 ? (
          <EmptyState icon={GraduationCap} iconColor="#7B68EE" iconBg="rgba(123,104,238,0.1)"
            title="Нет обучений" description="Все допуски в порядке" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {items.map((item, i) => {
              const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
              const isOverdue = item.deadline && new Date(item.deadline) < new Date() && item.status !== 'completed';
              return (
                <button key={item.id} onClick={() => { haptic.light(); setDetail(item); }}
                  className="card-glass w-full text-left px-4 py-3 spring-tap"
                  style={{
                    animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both`,
                    borderLeft: `3px solid ${isOverdue ? 'var(--err-t)' : cfg.color}`,
                  }}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold truncate c-primary">{item.fio || item.employee_name || '—'}</p>
                      <p className="text-[11px] mt-0.5 c-secondary">
                        {item.title || item.permit_name || '—'}
                        {item.work_title && <span className="c-tertiary"> · {item.work_title}</span>}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: `color-mix(in srgb, ${cfg.color} 15%, transparent)`,
                            color: cfg.color,
                          }}>
                          {cfg.label}
                        </span>
                        {item.deadline && (
                          <span className="text-[10px]" style={{ color: isOverdue ? 'var(--err-t)' : 'var(--text-tertiary)' }}>
                            {isOverdue ? '⛔ Просрочено' : `до ${fmtDate(item.deadline)}`}
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

      {/* Detail BottomSheet */}
      <BottomSheet open={!!detail} onClose={() => setDetail(null)} title={detail?.title || 'Обучение'}>
        {detail && (
          <div className="flex flex-col gap-3 pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">Рабочий</p>
              <p className="text-[14px] c-primary">{detail.fio || detail.employee_name || '—'}</p>
            </div>
            {detail.work_title && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">Объект</p>
                <p className="text-[14px] c-primary">{detail.work_title}</p>
              </div>
            )}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">Тип</p>
              <p className="text-[14px] c-primary">{detail.training_type || '—'}</p>
            </div>
            {detail.deadline && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">Дедлайн</p>
                <p className="text-[14px] c-primary">{fmtDate(detail.deadline)}</p>
              </div>
            )}
            {detail.certificate_file && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">Сертификат</p>
                <a href={detail.certificate_file} target="_blank" rel="noopener noreferrer"
                  className="text-[14px] c-blue">📄 {detail.certificate_original_name || 'Скачать'}</a>
              </div>
            )}

            {/* Actions */}
            {detail.status !== 'completed' && detail.status !== 'cancelled' && (
              <div className="flex gap-2 mt-2">
                <button onClick={() => handleUpload(detail.id)} disabled={uploading}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 spring-tap"
                  style={{
                    background: 'color-mix(in srgb, var(--blue) 15%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--blue) 35%, transparent)',
                    color: 'var(--blue)',
                  }}>
                  <Upload size={16} /> {uploading ? 'Загрузка...' : 'Загрузить файл'}
                </button>
                <button onClick={() => handleComplete(detail.id)} disabled={completing}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 spring-tap"
                  style={{
                    background: 'color-mix(in srgb, var(--green) 15%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)',
                    color: 'var(--green)',
                  }}>
                  <CheckCircle size={16} /> {completing ? '...' : 'Завершить'}
                </button>
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </PageShell>
  );
}
