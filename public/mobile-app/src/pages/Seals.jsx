import { useState, useEffect, useCallback } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Stamp, ChevronRight } from 'lucide-react';

const STATUS_MAP = {
  available: { label: 'Доступна', color: 'var(--green)' },
  issued: { label: 'Выдана', color: 'var(--gold)' },
};

export default function Seals() {
  const haptic = useHaptic();
  const [seals, setSeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/data/seals?limit=100'); setSeals(api.extractRows(res) || []); }
    catch { setSeals([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <PageShell title="Печати">
      <PullToRefresh onRefresh={fetchData}>
        {loading ? <SkeletonList count={4} /> : seals.length === 0 ? (
          <EmptyState icon={Stamp} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)" title="Нет печатей" description="Печати появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {seals.map((seal, i) => {
              const st = STATUS_MAP[seal.status] || STATUS_MAP.available;
              return (
                <button key={seal.id} onClick={() => { haptic.light(); setDetail(seal); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', backdropFilter: 'blur(8px)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{seal.name || seal.title || `Печать #${seal.id}`}</p>
                    <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {seal.number && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>№{seal.number}</span>}
                    {seal.holder_name && <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{seal.holder_name}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <SealDetailSheet seal={detail} onClose={() => setDetail(null)} onTransferred={fetchData} />
    </PageShell>
  );
}

function SealDetailSheet({ seal, onClose, onTransferred }) {
  const haptic = useHaptic();
  const [showTransfer, setShowTransfer] = useState(false);
  const [toUser, setToUser] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  if (!seal) return null;
  const st = STATUS_MAP[seal.status] || STATUS_MAP.available;
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    seal.number && { label: '№', value: seal.number },
    seal.type && { label: 'Тип', value: seal.type },
    seal.holder_name && { label: 'Держатель', value: seal.holder_name },
    seal.issued_date && { label: 'Выдана', value: seal.issued_date },
    (seal.note || seal.comment) && { label: 'Примечание', value: seal.note || seal.comment, full: true },
  ].filter(Boolean);

  const handleTransfer = async () => {
    if (!toUser.trim()) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/data/seal_transfers', { seal_id: seal.id, to_user_name: toUser.trim(), comment: comment || null });
      haptic.success(); setShowTransfer(false); setToUser(''); setComment(''); onClose(); onTransferred();
    } catch {} setSaving(false);
  };

  const is = { background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: '0.5px solid var(--border-norse)', caretColor: 'var(--gold)' };

  return (
    <BottomSheet open={!!seal} onClose={onClose} title={seal.name || seal.title || 'Печать'}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] ${f.full ? 'whitespace-pre-wrap' : ''}`} style={{ color: 'var(--text-primary)' }}>{f.value}</p>}</div>)}
        {!showTransfer ? (
          <button onClick={() => setShowTransfer(true)} className="w-full py-3 rounded-xl font-semibold text-[14px] spring-tap mt-1" style={{ background: 'var(--bg-elevated)', color: 'var(--blue)' }}>Передать</button>
        ) : (
          <div className="flex flex-col gap-2 mt-2">
            <input type="text" value={toUser} onChange={(e) => setToUser(e.target.value)} placeholder="Кому (ФИО)" className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none" style={is} />
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий..." rows={2} className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none resize-none" style={is} />
            <button onClick={handleTransfer} disabled={!toUser.trim() || saving} className="w-full py-3 rounded-xl font-semibold text-[14px] spring-tap" style={{ background: toUser.trim() ? 'var(--gold-gradient)' : 'var(--bg-elevated)', color: toUser.trim() ? '#fff' : 'var(--text-tertiary)', opacity: saving ? 0.6 : 1 }}>{saving ? 'Передаём...' : 'Передать печать'}</button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
