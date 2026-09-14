import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import { ArrowLeft, ScrollText, RefreshCw, ShieldAlert, CheckCircle2, Bell } from 'lucide-react';

const ST = {
  draft: { label: 'Черновик', color: '#94a3b8' },
  issued: { label: 'Утверждён', color: '#16a34a' },
  active: { label: 'Действует', color: '#ca8a04' },
  extended: { label: 'Продлён', color: '#0284c7' },
  closed: { label: 'Закрыт', color: '#64748b' },
  cancelled: { label: 'Аннулирован', color: '#dc2626' },
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
    <div
      className="min-h-screen pb-24"
      style={{
        background:
          'radial-gradient(ellipse 90% 50% at 50% -10%, rgba(212,168,67,.12), transparent 55%), linear-gradient(180deg,#070a0e 0%,#10161f 45%,#070a0e 100%)',
      }}
    >
      <div
        className="sticky top-0 z-20 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'rgba(7,10,14,.92)',
          backdropFilter: 'blur(14px)',
          borderBottom: '1px solid rgba(212,168,67,.28)',
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/field/home')}
          className="p-2 rounded-xl"
          style={{ background: 'rgba(255,255,255,.05)' }}
        >
          <ArrowLeft size={18} style={{ color: 'var(--gold)' }} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] tracking-[0.2em] font-extrabold" style={{ color: 'var(--gold)' }}>
            ОТ · ПБ · ASGARD
          </div>
          <div className="font-extrabold text-base truncate" style={{ color: '#f5e6c8' }}>
            Электронные наряды
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            haptic.light();
            load();
          }}
          className="p-2 rounded-xl"
          style={{ background: 'rgba(255,255,255,.05)' }}
        >
          <RefreshCw size={16} style={{ color: 'var(--text-tertiary)' }} />
        </button>
      </div>

      <div
        style={{
          height: 5,
          background: 'repeating-linear-gradient(-45deg,#111 0 8px,#f5c518 8px 16px)',
        }}
      />

      <div className="p-4 space-y-4">
        {error && (
          <div
            className="rounded-xl p-3 text-sm"
            style={{ background: 'rgba(239,68,68,.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,.3)' }}
          >
            {error}
          </div>
        )}

        {inbox.length > 0 && (
          <div
            className="rounded-2xl p-3 space-y-2"
            style={{ border: '1px solid rgba(212,168,67,.4)', background: 'rgba(212,168,67,.08)' }}
          >
            <div className="text-xs font-extrabold flex items-center gap-1.5" style={{ color: 'var(--gold)' }}>
              <Bell size={13} /> Уведомления
            </div>
            {inbox.map((i) => (
              <button
                key={i.id}
                type="button"
                className="w-full text-left rounded-xl p-2.5"
                style={{ background: 'rgba(0,0,0,.28)' }}
                onClick={async () => {
                  await fieldApi.post(`/nd/inbox/${i.id}/read`).catch(() => {});
                  if (i.permit_id) open(i.permit_id);
                  else load();
                }}
              >
                <div className="text-sm font-semibold" style={{ color: '#f5e6c8' }}>
                  {i.title}
                </div>
                {i.body && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    {i.body}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Загрузка нарядов…
          </div>
        ) : (
          <>
            {isMaster && (
              <section>
                <div className="flex items-center gap-2 mb-2.5">
                  <ShieldAlert size={16} style={{ color: '#f59e0b' }} />
                  <h2 className="text-sm font-extrabold" style={{ color: '#f5e6c8' }}>
                    На утверждении ({drafts.length})
                  </h2>
                </div>
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
              <div className="flex items-center gap-2 mb-2.5 mt-1">
                <ScrollText size={16} style={{ color: 'var(--gold)' }} />
                <h2 className="text-sm font-extrabold" style={{ color: '#f5e6c8' }}>
                  {isMaster ? 'Утверждённые' : 'Мои наряды'} ({permits.length})
                </h2>
              </div>
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
      style={{ color: 'var(--text-tertiary)', border: '1px dashed rgba(212,168,67,.28)', background: 'rgba(255,255,255,.02)' }}
    >
      {hint}
    </div>
  );
}

function PermitCard({ p, onOpen, badge, ack, urgent }) {
  const st = ST[p.status] || ST.draft;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-2xl p-3.5 active:scale-[0.99] transition-transform"
      style={{
        background: urgent
          ? 'linear-gradient(145deg, rgba(245,158,11,.14), rgba(14,18,24,.98))'
          : 'linear-gradient(145deg, rgba(30,36,48,.95), rgba(14,18,24,.98))',
        border: urgent ? '1px solid rgba(245,158,11,.45)' : '1px solid rgba(212,168,67,.22)',
        boxShadow: '0 10px 28px rgba(0,0,0,.38)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-mono tracking-wide" style={{ color: 'var(--gold)' }}>
            {p.number || `черновик #${p.id}`}
          </div>
          <div className="font-bold text-sm mt-0.5 truncate" style={{ color: '#f5e6c8' }}>
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
          <span className="text-[11px] font-bold" style={{ color: urgent ? '#fbbf24' : '#fbbf24' }}>
            {badge}
          </span>
        )}
        {ack && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: '#22c55e' }}>
            <CheckCircle2 size={12} /> ознакомлен
          </span>
        )}
      </div>
    </button>
  );
}
