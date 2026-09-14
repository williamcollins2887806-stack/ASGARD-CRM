import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';
import { useHaptic } from '@/hooks/useHaptic';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Mail,
  ShieldCheck,
  AlertTriangle,
  Play,
  Square,
  Clock,
} from 'lucide-react';

const ST = {
  draft: { label: 'ЧЕРНОВИК', color: '#94a3b8' },
  issued: { label: 'УТВЕРЖДЁН', color: '#16a34a' },
  active: { label: 'ДЕЙСТВУЕТ', color: '#ca8a04' },
  extended: { label: 'ПРОДЛЁН', color: '#0284c7' },
  closed: { label: 'ЗАКРЫТ', color: '#64748b' },
  cancelled: { label: 'АННУЛИРОВАН', color: '#dc2626' },
};

const READ_LABELS = {
  work: 'Содержание',
  risks: 'Риски',
  ppe: 'СИЗ',
  emergency: 'Авария',
};

async function downloadDocx(id) {
  const token = localStorage.getItem('field_token');
  const r = await fetch(`/api/field/nd/${id}/docx`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'Не удалось скачать Word');
  }
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `naryad_${id}.docx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function FieldPermitDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const haptic = useHaptic();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState({ work: false, risks: false, ppe: false, emergency: false });
  const [emailTo, setEmailTo] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editPlace, setEditPlace] = useState('');
  const [editPpe, setEditPpe] = useState('');
  const [editEmer, setEditEmer] = useState('');

  async function load() {
    const res = await fieldApi.get(`/nd/${id}`);
    setData(res);
    setEditContent(res.permit?.work_content || '');
    setEditPlace(res.permit?.work_place || '');
    setEditPpe(res.permit?.ppe_text || '');
    setEditEmer(res.permit?.emergency_text || '');
    if (res.meta?.acknowledged) {
      setRead({ work: true, risks: true, ppe: true, emergency: true });
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [id]);

  const permit = data?.permit;
  const meta = data?.meta || {};
  const st = ST[permit?.status] || ST.draft;
  const allRead = read.work && read.risks && read.ppe && read.emergency;
  const openRisks = useMemo(
    () => (permit?.risks || []).filter((r) => !(r.closure && r.closure.is_closed)),
    [permit]
  );

  async function run(fn) {
    try {
      setBusy(true);
      setError(null);
      await fn();
      if (typeof haptic.success === 'function') haptic.success();
      else haptic.medium();
      await load();
    } catch (e) {
      if (typeof haptic.error === 'function') haptic.error();
      else haptic.heavy();
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function mark(section) {
    setRead((r) => ({ ...r, [section]: true }));
  }

  if (!permit && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ background: '#070a0e', color: 'var(--text-tertiary)' }}>
        Загрузка наряда…
      </div>
    );
  }

  if (!permit) {
    return (
      <div className="min-h-screen p-6" style={{ background: '#070a0e' }}>
        <button type="button" onClick={() => navigate('/field/permits')} className="text-sm mb-4" style={{ color: 'var(--gold)' }}>
          ← Назад
        </button>
        <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(239,68,68,.12)', color: '#fca5a5' }}>
          {error || 'Наряд не найден'}
        </div>
      </div>
    );
  }

  const needsAck = !meta.is_master && permit.status !== 'draft' && !meta.acknowledged;
  const sec = permit.sections_json && typeof permit.sections_json === 'object' ? permit.sections_json : {};
  const blockOn = (id) => {
    const list = sec.enabled_blocks;
    if (Array.isArray(list) && list.length) return list.includes(id);
    // Нет явного списка — спецблоки только если есть данные
    if (['gas_analysis', 'fire_watch', 'atmosphere', 'loto', 'height_gear'].includes(id)) {
      const v = sec[id];
      if (Array.isArray(v)) return v.length > 0;
      if (v && typeof v === 'object') return Object.keys(v).some((k) => v[k]);
      return false;
    }
    return true;
  };

  return (
    <div className="min-h-screen pb-28" style={{ background: '#070a0e' }}>
      <div
        className="sticky top-0 z-20 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'rgba(7,10,14,.94)',
          backdropFilter: 'blur(14px)',
          borderBottom: '1px solid rgba(212,168,67,.28)',
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/field/permits')}
          className="p-2 rounded-xl"
          style={{ background: 'rgba(255,255,255,.05)' }}
        >
          <ArrowLeft size={18} style={{ color: 'var(--gold)' }} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-mono truncate" style={{ color: 'var(--gold)' }}>
            {permit.number || `черновик #${id}`}
          </div>
          <div className="font-extrabold text-sm truncate" style={{ color: '#f5e6c8' }}>
            {permit.form_title}
          </div>
        </div>
        <span
          className="text-[9px] font-black px-2 py-1 rounded border tracking-wide"
          style={{ color: st.color, borderColor: st.color }}
        >
          {st.label}
        </span>
      </div>

      <div style={{ height: 5, background: 'repeating-linear-gradient(-45deg,#111 0 8px,#f5c518 8px 16px)' }} />

      <div className="p-4 space-y-3">
        {error && (
          <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(239,68,68,.12)', color: '#fca5a5' }}>
            {error}
          </div>
        )}

        {/* Official paper */}
        <div
          className="rounded-lg overflow-hidden"
          style={{
            background: 'linear-gradient(180deg,#fbf6ea,#efe6d2)',
            color: '#1a1520',
            boxShadow: '0 16px 48px rgba(0,0,0,.5)',
          }}
        >
          <div style={{ height: 7, background: 'repeating-linear-gradient(-45deg,#111 0 7px,#f5c518 7px 14px)' }} />
          <div className="p-4">
            <div className="text-[9px] uppercase tracking-wider mb-2" style={{ color: '#6b6254' }}>
              ООО «АСГАРД-СЕРВИС» · электронный наряд-допуск
            </div>
            <div className="text-center mb-4">
              <div className="text-lg font-black tracking-[0.12em]">НАРЯД-ДОПУСК</div>
              <div className="text-xs font-bold mt-1">{permit.form_title}</div>
              <div className="text-[10px] mt-1.5 leading-snug" style={{ color: '#5c5346' }}>
                {permit.legal_basis}
              </div>
            </div>

            <PaperSec n="1" title="Место производства работ" text={permit.work_place} />
            <PaperSec
              n="2"
              title="Содержание работ"
              text={permit.work_content}
              gate={needsAck}
              opened={read.work}
              onOpen={() => mark('work')}
            />
            <PaperSec
              n="3"
              title="Срок"
              text={`${fmt(permit.starts_at)} — ${fmt(permit.ends_at)}`}
            />
            <div className="mt-3 pt-2 border-t border-black/10">
              <SecHead n="4" title={`Состав бригады (${(permit.crew || []).length})`} />
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      {['№', 'ФИО', 'Профессия', 'Роль'].map((h) => (
                        <th key={h} className="border border-black/30 bg-[#e8e0d0] px-1.5 py-1 text-left font-bold uppercase tracking-wide text-[9px]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(permit.crew || []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="border border-black/30 bg-[#fff2a8] px-1.5 py-1">
                          —
                        </td>
                      </tr>
                    )}
                    {(permit.crew || []).map((c, i) => (
                      <tr key={c.id || i}>
                        <td className="border border-black/30 bg-[#fff2a8] px-1.5 py-1">{i + 1}</td>
                        <td className="border border-black/30 bg-[#fff2a8] px-1.5 py-1">{c.fio}</td>
                        <td className="border border-black/30 bg-[#fff2a8] px-1.5 py-1">{c.profession || ''}</td>
                        <td className="border border-black/30 bg-[#fff2a8] px-1.5 py-1">{c.role_in_permit || 'member'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-black/10">
              <SecHead n="5" title={`Оборудование (${(permit.equipment || []).length})`} />
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      {['№', 'Наименование', 'Кол-во'].map((h) => (
                        <th key={h} className="border border-black/30 bg-[#e8e0d0] px-1.5 py-1 text-left font-bold uppercase tracking-wide text-[9px]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(permit.equipment || []).length === 0 && (
                      <tr>
                        <td colSpan={3} className="border border-black/30 bg-[#fff2a8] px-1.5 py-1">
                          —
                        </td>
                      </tr>
                    )}
                    {(permit.equipment || []).map((e, i) => (
                      <tr key={e.id || i}>
                        <td className="border border-black/30 bg-[#fff2a8] px-1.5 py-1">{i + 1}</td>
                        <td className="border border-black/30 bg-[#fff2a8] px-1.5 py-1">{e.name}</td>
                        <td className="border border-black/30 bg-[#fff2a8] px-1.5 py-1">{e.qty || '1'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {blockOn('gas_analysis') && (
              <div className="mt-3 pt-2 border-t border-black/10">
                <SecHead n="G" title="Анализ газовоздушной среды" />
                <div className="text-xs space-y-1">
                  {(sec.gas_analysis || []).length === 0 && (
                    <div className="bg-[#fff2a8] px-2 py-1.5 rounded">Строки заполняются при допуске</div>
                  )}
                  {(sec.gas_analysis || []).map((g, i) => (
                    <div key={i} className="bg-[#fff2a8] px-2 py-1.5 rounded">
                      {g.at || '—'} · {g.place || ''} · {g.component || ''} = {g.value || ''} · {g.fio || ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {blockOn('fire_watch') && (
              <div className="mt-3 pt-2 border-t border-black/10">
                <SecHead n="F" title="Постовой огневой охраны" />
                <div className="text-sm bg-[#fff2a8] px-2 py-1.5 rounded leading-snug">
                  {(sec.fire_watch || {}).person || '—'} · {(sec.fire_watch || {}).extinguishers || ''} ·{' '}
                  {(sec.fire_watch || {}).watch_hours || ''}
                </div>
              </div>
            )}
            {blockOn('atmosphere') && (
              <div className="mt-3 pt-2 border-t border-black/10">
                <SecHead n="A" title="Контроль атмосферы ОЗП" />
                <div className="text-xs space-y-1">
                  {(sec.atmosphere || []).map((a, i) => (
                    <div key={i} className="bg-[#fff2a8] px-2 py-1.5 rounded">
                      O₂ {a.o2 || '—'} · LEL {a.lel || '—'} · CO {a.co || '—'} · H₂S {a.h2s || '—'} · {a.fio || ''}
                    </div>
                  ))}
                  {!(sec.atmosphere || []).length && (
                    <div className="bg-[#fff2a8] px-2 py-1.5 rounded">Ожидает замеров</div>
                  )}
                </div>
              </div>
            )}
            {blockOn('loto') && (
              <div className="mt-3 pt-2 border-t border-black/10">
                <SecHead n="L" title="Отключения / LOTO" />
                <div className="text-xs space-y-1">
                  {(sec.loto || []).map((p, i) => (
                    <div key={i} className="bg-[#fff2a8] px-2 py-1.5 rounded">
                      {p.device || '—'} → {p.action || ''} / {p.lock || ''}
                    </div>
                  ))}
                  {!(sec.loto || []).length && <div className="bg-[#fff2a8] px-2 py-1.5 rounded">—</div>}
                </div>
              </div>
            )}
            <div className="mt-3 pt-2 border-t border-black/10">
              <div className="flex items-center justify-between gap-2 mb-2">
                <SecHead n="6" title="Опасные факторы и барьеры" />
                {needsAck && !read.risks && (
                  <button
                    type="button"
                    className="text-[10px] font-black underline shrink-0"
                    style={{ color: '#9b2c2c' }}
                    onClick={() => mark('risks')}
                  >
                    прочитано
                  </button>
                )}
                {read.risks && needsAck && <span className="text-[10px] font-bold" style={{ color: '#166534' }}>✓</span>}
              </div>
              {(permit.risks || []).length === 0 && <div className="text-sm" style={{ color: '#6b6254' }}>Риски не указаны</div>}
              {(permit.risks || []).map((r) => {
                const closed = r.closure?.is_closed;
                return (
                  <div
                    key={r.id}
                    className="mb-2 rounded-md p-2.5"
                    style={{
                      background: closed ? 'rgba(34,197,94,.1)' : 'rgba(155,44,44,.08)',
                      borderLeft: `3px solid ${closed ? '#16a34a' : '#9b2c2c'}`,
                      opacity: needsAck && !read.risks ? 0.4 : 1,
                    }}
                  >
                    <div className="font-bold text-sm flex justify-between gap-2">
                      <span>{r.risk_title}</span>
                      <span className="text-[9px] font-black tracking-wide">{closed ? 'ЗАКРЫТ' : 'ОТКРЫТ'}</span>
                    </div>
                    <div className="text-xs mt-1 leading-snug" style={{ color: '#4a4338' }}>
                      {(r.measure_titles || []).join(' · ') || 'Меры не заданы'}
                    </div>
                    {meta.is_master && permit.status !== 'draft' && permit.status !== 'closed' && (
                      <button
                        type="button"
                        disabled={busy}
                        className="mt-2 text-[11px] font-bold px-2.5 py-1.5 rounded-md"
                        style={{ background: closed ? '#334155' : '#166534', color: '#fff' }}
                        onClick={() =>
                          run(async () => {
                            if (closed) await fieldApi.post(`/nd/${id}/risks/${r.id}/reopen`);
                            else
                              await fieldApi.post(`/nd/${id}/risks/${r.id}/close`, {
                                evidence_text: 'Мероприятия выполнены',
                              });
                          })
                        }
                      >
                        {closed ? 'Открыть снова' : 'Закрыть риск ✓'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <PaperSec
              n="7"
              title="СИЗ"
              text={permit.ppe_text}
              gate={needsAck}
              opened={read.ppe}
              onOpen={() => mark('ppe')}
            />
            <PaperSec
              n="8"
              title="Действия при аварии"
              text={permit.emergency_text}
              gate={needsAck}
              opened={read.emergency}
              onOpen={() => mark('emergency')}
            />

            <div className="grid grid-cols-2 gap-3 mt-5 pt-3 border-t border-black/15 text-[10px]" style={{ color: '#5c5346' }}>
              <div>
                Выдал (РП)
                <div className="mt-1 font-semibold text-xs" style={{ color: '#1a1520' }}>
                  {permit.created_by_name || '—'}
                </div>
                <div className="border-b border-black/40 mt-2 h-4" />
              </div>
              <div>
                Утвердил (мастер)
                <div className="mt-1 font-semibold text-xs" style={{ color: '#1a1520' }}>
                  {permit.issued_by_name || '—'}
                </div>
                <div className="border-b border-black/40 mt-2 h-4" />
              </div>
            </div>
          </div>
        </div>

        {/* Master draft */}
        {meta.is_master && permit.status === 'draft' && (
          <div
            className="rounded-2xl p-3.5 space-y-2.5"
            style={{ border: '1px solid rgba(245,158,11,.45)', background: 'rgba(245,158,11,.08)' }}
          >
            <div className="text-xs font-extrabold" style={{ color: '#fbbf24' }}>
              Проверка мастера перед утверждением
            </div>
            <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Содержание
            </label>
            <textarea
              className="w-full rounded-xl p-2.5 text-sm"
              style={fieldStyle}
              rows={3}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
            />
            <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Место
            </label>
            <input
              className="w-full rounded-xl px-2.5 py-2 text-sm"
              style={fieldStyle}
              value={editPlace}
              onChange={(e) => setEditPlace(e.target.value)}
            />
            <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              СИЗ
            </label>
            <textarea
              className="w-full rounded-xl p-2.5 text-sm"
              style={fieldStyle}
              rows={2}
              value={editPpe}
              onChange={(e) => setEditPpe(e.target.value)}
            />
            <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Авария
            </label>
            <textarea
              className="w-full rounded-xl p-2.5 text-sm"
              style={fieldStyle}
              rows={2}
              value={editEmer}
              onChange={(e) => setEditEmer(e.target.value)}
            />
            <button
              type="button"
              disabled={busy}
              className="w-full rounded-xl py-2.5 text-sm font-semibold"
              style={{ background: 'rgba(255,255,255,.08)', color: '#e8eef7' }}
              onClick={() =>
                run(async () => {
                  await fieldApi.put(`/nd/${id}`, {
                    work_content: editContent,
                    work_place: editPlace,
                    ppe_text: editPpe,
                    emergency_text: editEmer,
                  });
                })
              }
            >
              Сохранить правки
            </button>
            <button
              type="button"
              disabled={busy}
              className="w-full rounded-xl py-3.5 text-sm font-black flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#e0b34a,#b8860b)', color: '#1a1205' }}
              onClick={() =>
                run(async () => {
                  await fieldApi.put(`/nd/${id}`, {
                    work_content: editContent,
                    work_place: editPlace,
                    ppe_text: editPpe,
                    emergency_text: editEmer,
                  });
                  await fieldApi.post(`/nd/${id}/issue`);
                })
              }
            >
              <ShieldCheck size={18} /> Утвердить наряд
            </button>
          </div>
        )}

        {/* Worker ack */}
        {needsAck && (
          <div
            className="rounded-2xl p-3.5 space-y-2.5"
            style={{ border: '1px solid rgba(56,189,248,.4)', background: 'rgba(56,189,248,.08)' }}
          >
            <div className="text-xs font-extrabold" style={{ color: '#7dd3fc' }}>
              Обязательное ознакомление
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Откройте разделы бланка (содержание, риски, СИЗ, авария) и подтвердите. Без этого нельзя работать по наряду.
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              {Object.keys(READ_LABELS).map((k) => (
                <div key={k} className="font-semibold" style={{ color: read[k] ? '#22c55e' : '#94a3b8' }}>
                  {read[k] ? '✓' : '○'} {READ_LABELS[k]}
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={busy || !allRead}
              className="w-full rounded-xl py-3.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: '#0369a1', color: '#fff' }}
              onClick={() =>
                run(async () => {
                  await fieldApi.post(`/nd/${id}/ack`, {
                    sections_read: Object.keys(read).filter((k) => read[k]),
                  });
                })
              }
            >
              <CheckCircle2 size={18} /> Ознакомлен, инструктаж понятен
            </button>
          </div>
        )}

        {/* Ops */}
        {meta.is_master && permit.status !== 'draft' && permit.status !== 'closed' && permit.status !== 'cancelled' && (
          <div
            className="rounded-2xl p-3.5 space-y-2.5"
            style={{ border: '1px solid rgba(212,168,67,.28)', background: 'rgba(255,255,255,.03)' }}
          >
            <div className="text-xs font-extrabold" style={{ color: 'var(--gold)' }}>
              Смена / продление
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-xl py-2.5 text-xs font-bold flex items-center justify-center gap-1"
                style={{ background: '#166534', color: '#fff' }}
                onClick={() => run(() => fieldApi.post(`/nd/${id}/daily`, { action: 'start' }))}
              >
                <Play size={14} /> Допуск на день
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-xl py-2.5 text-xs font-bold flex items-center justify-center gap-1"
                style={{ background: '#334155', color: '#fff' }}
                onClick={() => run(() => fieldApi.post(`/nd/${id}/daily`, { action: 'end' }))}
              >
                <Square size={14} /> Окончание дня
              </button>
            </div>
            {(permit.extensions || [])
              .filter((e) => e.status === 'pending')
              .map((e) => (
                <div key={e.id} className="rounded-xl p-2.5 text-xs" style={{ background: 'rgba(245,158,11,.12)' }}>
                  Запрос продления до {e.requested_until ? new Date(e.requested_until).toLocaleString('ru-RU') : '—'}
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      className="flex-1 py-2 rounded-lg font-bold"
                      style={{ background: '#166534', color: '#fff' }}
                      onClick={() => run(() => fieldApi.post(`/nd/${id}/extensions/${e.id}/decide`, { approve: true }))}
                    >
                      Одобрить
                    </button>
                    <button
                      type="button"
                      className="flex-1 py-2 rounded-lg font-bold"
                      style={{ background: '#7f1d1d', color: '#fff' }}
                      onClick={() => run(() => fieldApi.post(`/nd/${id}/extensions/${e.id}/decide`, { approve: false }))}
                    >
                      Отклонить
                    </button>
                  </div>
                </div>
              ))}
            {openRisks.length > 0 && (
              <div className="text-[11px] flex items-center gap-1.5 font-semibold" style={{ color: '#fbbf24' }}>
                <AlertTriangle size={12} /> Открытых рисков: {openRisks.length} — закройте перед сдачей
              </div>
            )}
            <button
              type="button"
              disabled={busy}
              className="w-full rounded-xl py-2.5 text-xs font-bold"
              style={{ background: 'rgba(239,68,68,.15)', color: '#fca5a5' }}
              onClick={() =>
                run(async () => {
                  try {
                    await fieldApi.post(`/nd/${id}/close`, {});
                  } catch (e) {
                    if (String(e.message || '').includes('Открытых рисков')) {
                      const ok = window.confirm(`${e.message}\n\nЗакрыть наряд принудительно?`);
                      if (!ok) throw e;
                      await fieldApi.post(`/nd/${id}/close`, { force: true });
                    } else {
                      throw e;
                    }
                  }
                })
              }
            >
              Закрыть наряд
            </button>
          </div>
        )}

        {meta.in_crew && permit.status !== 'draft' && permit.status !== 'closed' && permit.status !== 'cancelled' && (
          <button
            type="button"
            disabled={busy}
            className="w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: 'rgba(56,189,248,.12)', color: '#7dd3fc', border: '1px solid rgba(56,189,248,.3)' }}
            onClick={() => run(() => fieldApi.post(`/nd/${id}/extensions`, {}))}
          >
            <Clock size={16} /> Запросить продление
          </button>
        )}

        {(meta.is_master || meta.acknowledged || permit.status === 'draft') && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded-xl py-3 text-xs font-bold flex items-center justify-center gap-1"
              style={{ background: 'rgba(212,168,67,.15)', color: '#f5e6c8' }}
              onClick={() => run(() => downloadDocx(id))}
            >
              <Download size={14} /> Word
            </button>
            {meta.is_master && permit.status !== 'draft' && (
              <button
                type="button"
                className="rounded-xl py-3 text-xs font-bold flex items-center justify-center gap-1"
                style={{ background: 'rgba(255,255,255,.06)', color: '#e8eef7' }}
                onClick={() => setShowEmail((v) => !v)}
              >
                <Mail size={14} /> Почта
              </button>
            )}
          </div>
        )}
        {showEmail && (
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl px-3 text-sm"
              style={fieldStyle}
              placeholder="email@"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
            />
            <button
              type="button"
              disabled={busy || !emailTo.trim()}
              className="px-4 rounded-xl font-bold text-sm"
              style={{ background: 'var(--gold)', color: '#1a1205' }}
              onClick={() =>
                run(async () => {
                  await fieldApi.post(`/nd/${id}/email`, { to: emailTo.trim() });
                  setShowEmail(false);
                })
              }
            >
              OK
            </button>
          </div>
        )}

        {(permit.acks || []).length > 0 && (
          <div className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            Ознакомлены: {(permit.acks || []).map((a) => a.fio).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

const fieldStyle = {
  background: '#121820',
  color: '#e8eef7',
  border: '1px solid #2c3648',
};

function fmt(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_) {
    return '—';
  }
}

function SecHead({ n, title }) {
  return (
    <div className="flex items-baseline gap-2 mb-1">
      <span className="text-[11px] font-black" style={{ color: '#9b2c2c' }}>
        {n}.
      </span>
      <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#6b6254' }}>
        {title}
      </span>
    </div>
  );
}

function PaperSec({ n, title, text, gate, opened, onOpen }) {
  const gated = gate && !opened;
  return (
    <div className="mt-3 pt-2 border-t border-black/10">
      <div className="flex items-center justify-between gap-2 mb-1">
        <SecHead n={n} title={title} />
        {gate && !opened && (
          <button type="button" className="text-[10px] font-black underline shrink-0" style={{ color: '#9b2c2c' }} onClick={onOpen}>
            открыть
          </button>
        )}
        {gate && opened && (
          <span className="text-[10px] font-bold" style={{ color: '#166534' }}>
            ✓
          </span>
        )}
      </div>
      <div
        className="text-sm whitespace-pre-wrap leading-snug"
        style={{
          opacity: gated ? 0.35 : 1,
          maxHeight: gated ? 44 : 'none',
          overflow: 'hidden',
        }}
      >
        {text || '—'}
      </div>
    </div>
  );
}
