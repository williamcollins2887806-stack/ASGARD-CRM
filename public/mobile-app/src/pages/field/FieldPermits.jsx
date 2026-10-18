import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, ScrollText, RefreshCw, ShieldAlert, CheckCircle2, Bell } from 'lucide-react';
import { Card, IconTile, KeyButton, SectionLabel } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

const ST = {
  draft: { label: 'Черновик', color: 'var(--text-secondary)' },
  issued: { label: 'Утверждён', color: 'var(--ok)' },
  active: { label: 'Действует', color: 'var(--value)' },
  extended: { label: 'Продлён', color: 'var(--acc)' },
  closed: { label: 'Закрыт', color: 'var(--text-tertiary)' },
  cancelled: { label: 'Аннулирован', color: 'var(--danger)' },
};

export default function FieldPermits() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [permits, setPermits] = useState([]);
  const [isMaster, setIsMaster] = useState(false);
  const [inbox, setInbox] = useState([]);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const [my, box] = await Promise.all([
        fieldApi.get('/nd/my'),
        fieldApi.get('/nd/inbox').catch(() => ({ items: [] })),
      ]);
      setDrafts(my.drafts || []);
      setPermits(my.permits || []);
      setIsMaster(!!my.is_master);
      setInbox((box.items || []).filter((i) => !i.is_read).slice(0, 8));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function open(id) {
    haptic.light();
    navigate(`/field/permits/${id}`);
  }

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div
        className="flex items-center gap-3"
        style={{
          position: 'sticky', top: 0, zIndex: 20,
          paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: 12, paddingInline: 16,
          background: 'color-mix(in oklab, var(--bg-primary) 88%, transparent)',
          WebkitBackdropFilter: 'blur(14px) saturate(1.5)', backdropFilter: 'blur(14px) saturate(1.5)',
          borderBottom: '1px solid color-mix(in oklab, var(--value) 24%, transparent)',
        }}
      >
        <button onClick={() => navigate('/field/home')} className="fs-head__btn" aria-label="Назад" style={{ marginLeft: -8 }}>
          <ArrowLeft size={20} strokeWidth={2.3} />
        </button>
        <IconTile icon={ShieldAlert} tone="value" size={38} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] tracking-[0.2em] font-extrabold" style={{ color: 'var(--value-ink)' }}>
            ОТ · ПБ · ASGARD
          </div>
          <div className="font-extrabold text-base truncate" style={{ color: 'var(--text-primary)' }}>
            Электронные наряды
          </div>
        </div>
        <button
          onClick={() => { haptic.light(); load(); }}
          className="fs-head__btn" aria-label="Обновить"
        >
          <RefreshCw size={16} strokeWidth={2.3} />
        </button>
      </div>

      <div
        style={{
          height: 5,
          background: 'repeating-linear-gradient(-45deg,var(--bg-primary) 0 8px,var(--value) 8px 16px)',
        }}
      />

      <div className="fs-content space-y-4" style={{ paddingTop: 16 }}>
        {error && (
          <Card variant="flat" tone="danger" className="p-3 text-sm" style={{ color: 'var(--danger-ink)' }}>
            {error}
          </Card>
        )}

        {inbox.length > 0 && (
          <Card variant="raised" tone="value" className="p-3 space-y-2">
            <div className="text-xs font-extrabold flex items-center gap-1.5" style={{ color: 'var(--value-ink)' }}>
              <Bell size={13} strokeWidth={2.5} /> Уведомления
            </div>
            {inbox.map((i) => (
              <button
                key={i.id}
                type="button"
                className="w-full text-left rounded-xl p-2.5"
                style={{ background: 'var(--bg-surface-alt)' }}
                onClick={async () => {
                  await fieldApi.post(`/nd/inbox/${i.id}/read`).catch(() => {});
                  if (i.permit_id) open(i.permit_id);
                  else load();
                }}
              >
                <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {i.title}
                </div>
                {i.body && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    {i.body}
                  </div>
                )}
              </button>
            ))}
          </Card>
        )}

        {loading ? (
          <SkeletonList count={4} />
        ) : (
          <>
            {isMaster && (
              <section>
                <SectionLabel>
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldAlert size={12} strokeWidth={2.5} style={{ color: 'var(--value-ink)' }} aria-hidden />
                    На утверждении ({drafts.length})
                  </span>
                </SectionLabel>
                {drafts.length === 0 ? (
                  <Empty hint="Нет черновиков от РП. Когда РП создаст наряд в CRM — он появится здесь." />
                ) : (
                  <div className="space-y-2.5">
                    {drafts.map((p) => (
                      <PermitCard key={p.id} p={p} onOpen={() => open(p.id)} badge="Проверить и утвердить" urgent />
                    ))}
                  </div>
                )}
              </section>
            )}

            <section>
              <SectionLabel>
                <span className="inline-flex items-center gap-1.5">
                  <ScrollText size={12} strokeWidth={2.5} style={{ color: 'var(--value-ink)' }} aria-hidden />
                  {isMaster ? 'Утверждённые' : 'Мои наряды'} ({permits.length})
                </span>
              </SectionLabel>
              {permits.length === 0 ? (
                <Empty hint={isMaster ? 'После утверждения наряды появятся здесь' : 'Утверждённых нарядов пока нет'} />
              ) : (
                <div className="space-y-2.5">
                  {permits.map((p) => (
                    <PermitCard
                      key={p.id}
                      p={p}
                      onOpen={() => open(p.id)}
                      badge={!p.acknowledged ? 'Прочитать инструктаж' : null}
                      ack={p.acknowledged}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ hint }) {
  return (
    <div
      className="rounded-2xl p-5 text-sm text-center leading-relaxed"
      style={{ color: 'var(--text-tertiary)', border: '1px dashed color-mix(in oklab, var(--value) 28%, transparent)', background: 'var(--bg-surface-alt)' }}
    >
      {hint}
    </div>
  );
}

function PermitCard({ p, onOpen, badge, ack, urgent }) {
  const st = ST[p.status] || ST.draft;
  return (
    <Card
      as="button"
      variant="raised"
      onClick={onOpen}
      className="w-full text-left p-3.5 active:scale-[0.99]"
      style={{
        borderColor: urgent
          ? 'color-mix(in oklab, var(--danger) 42%, transparent)'
          : 'color-mix(in oklab, var(--value) 24%, transparent)',
        boxShadow: 'var(--tile-shadow)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-mono tracking-wide" style={{ color: 'var(--value-ink)' }}>
            {p.number || `черновик #${p.id}`}
          </div>
          <div className="font-bold text-sm mt-0.5 truncate" style={{ color: 'var(--text-primary)' }}>
            {p.form_title || p.form_code}
          </div>
          <div className="text-xs mt-1.5 line-clamp-2 leading-snug" style={{ color: 'var(--text-tertiary)' }}>
            {p.work_content || p.work_title || 'Без содержания'}
          </div>
        </div>
        <span
          className="text-[9px] font-black px-2 py-1 rounded border shrink-0 tracking-wide uppercase"
          style={{ color: st.color, borderColor: st.color }}
        >
          {st.label}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        {badge && (
          <span className="text-[11px] font-bold" style={{ color: 'var(--value-ink)' }}>
            {badge}
          </span>
        )}
        {ack && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--ok)' }}>
            <CheckCircle2 size={12} /> ознакомлен
          </span>
        )}
      </div>
    </Card>
  );
}
