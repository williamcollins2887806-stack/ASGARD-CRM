import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { api } from '@/api/client';
import { patchRegistryField, patchRegistryStatus } from '@/api/tendersRegistry';
import {
  REGISTRY_STATUSES,
  REGISTRY_STATUS_LABELS,
  REGISTRY_STATUS_COLORS,
  SOURCE_META,
} from '@/lib/registryStatus';
import { formatDate, formatMoney } from '@/lib/utils';
import WinWorkSheet from './WinWorkSheet';

function SourceBadge({ kind, label }) {
  const meta = SOURCE_META[kind] || (label ? { ic: '·', label, fg: 'var(--text-tertiary)', bg: 'rgba(142,142,147,0.10)' } : null);
  if (!meta) return null;
  return (
    <span
      className="inline-flex items-center"
      style={{
        gap: 3, padding: '2px 6px', borderRadius: 999, fontSize: 10, fontWeight: 600,
        color: meta.fg, background: meta.bg, whiteSpace: 'nowrap',
      }}
    >
      <span>{meta.ic}</span>
      {meta.label}
    </span>
  );
}

function RegistryStatusBadge({ status }) {
  if (!status) return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{
        color: REGISTRY_STATUS_COLORS[status] || 'var(--text-tertiary)',
        background: `color-mix(in srgb, ${REGISTRY_STATUS_COLORS[status] || 'var(--text-tertiary)'} 14%, transparent)`,
      }}
    >
      {REGISTRY_STATUS_LABELS[status] || status}
    </span>
  );
}

export default function RegistryDetailSheet({ tender, open, onClose, onChanged }) {
  const haptic = useHaptic();
  const navigate = useNavigate();
  const [full, setFull] = useState(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [winSheet, setWinSheet] = useState(false);
  const [editField, setEditField] = useState(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    if (!open || !tender?.id) { setFull(null); return; }
    setLoading(true);
    api.get(`/tenders/${tender.id}`)
      .then((res) => setFull(res))
      .catch(() => setFull(null))
      .finally(() => setLoading(false));
  }, [open, tender?.id]);

  if (!tender) return null;

  const t = { ...tender, ...(full?.tender || {}) };
  const price = Number(t.tender_price) || 0;

  const changeRegistryStatus = async (next) => {
    if (next === t.registry_status) return;
    setActing(true);
    haptic.light();
    try {
      await patchRegistryStatus(t.id, next);
      if (next === 'выиграли') {
        setWinSheet(true);
      } else {
        haptic.success();
        onChanged?.();
        onClose?.();
      }
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Не удалось сменить статус');
    } finally {
      setActing(false);
    }
  };

  const saveField = async () => {
    if (!editField) return;
    setActing(true);
    try {
      let val = editValue;
      if (editField === 'tender_price') val = editValue ? Number(editValue) : null;
      await patchRegistryField(t.id, editField, val);
      haptic.success();
      setEditField(null);
      onChanged?.();
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Ошибка сохранения');
    } finally {
      setActing(false);
    }
  };

  const startEdit = (field, current) => {
    setEditField(field);
    setEditValue(current ?? '');
  };

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={t.customer_name || `Тендер #${t.id}`}>
        <div className="flex flex-col gap-3 pb-4">
          {t.registry_status && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 c-tertiary">
                Статус реестра
              </p>
              <div className="flex flex-wrap gap-1.5">
                {REGISTRY_STATUSES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    disabled={acting}
                    onClick={() => changeRegistryStatus(st)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-semibold spring-tap"
                    style={{
                      background: t.registry_status === st
                        ? `color-mix(in srgb, ${REGISTRY_STATUS_COLORS[st]} 22%, transparent)`
                        : 'var(--bg-elevated)',
                      color: t.registry_status === st ? REGISTRY_STATUS_COLORS[st] : 'var(--text-tertiary)',
                      border: t.registry_status === st
                        ? `0.5px solid color-mix(in srgb, ${REGISTRY_STATUS_COLORS[st]} 40%, transparent)`
                        : '0.5px solid var(--border-norse)',
                    }}
                  >
                    {REGISTRY_STATUS_LABELS[st]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {t.tender_status && (
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={t.tender_status} />
              {t.registry_status && <RegistryStatusBadge status={t.registry_status} />}
              {(t.source_kind || t.source_label) && (
                <SourceBadge kind={t.source_kind} label={t.source_label} />
              )}
            </div>
          )}

          {t.score != null && (
            <div
              className="rounded-xl px-3 py-2 text-[12px]"
              style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-norse)' }}
            >
              Скоринг заказчика: <strong>{t.score.score ?? t.score.total ?? '—'}</strong>
            </div>
          )}

          {t.rp_review && (
            <div
              className="rounded-xl px-3 py-2 text-[12px]"
              style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-norse)' }}
            >
              РП: {t.rp_review.decision === 'submit' ? 'Подаём' : t.rp_review.decision === 'reject' ? 'Не подаём' : 'Ожидает'}
              {t.rp_review.calculator_name && ` · ${t.rp_review.calculator_name}`}
            </div>
          )}

          {loading ? (
            <SkeletonList count={3} />
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
              {[
                { label: 'Название', field: 'tender_title', value: t.tender_title },
                { label: 'Сумма', field: 'tender_price', value: price > 0 ? formatMoney(price) : '—', raw: t.tender_price },
                { label: 'Дедлайн', field: 'docs_deadline', value: t.docs_deadline ? formatDate(t.docs_deadline) : '—', raw: t.docs_deadline?.slice?.(0, 10) },
                { label: 'Период', value: t.period, readonly: true },
                { label: 'Ссылка', field: 'purchase_url', value: t.purchase_url || '—', raw: t.purchase_url },
                { label: 'Комментарий ТО', field: 'comment_to', value: t.comment_to || '—', raw: t.comment_to, multiline: true },
              ].filter((f) => f.value || f.field).map((f, i, arr) => (
                <button
                  key={f.label}
                  type="button"
                  disabled={!f.field || acting}
                  onClick={() => f.field && startEdit(f.field, f.raw ?? f.value === '—' ? '' : f.value)}
                  className="w-full text-left px-4 py-3 spring-tap"
                  style={{
                    background: 'var(--bg-surface)',
                    borderBottom: i < arr.length - 1 ? '0.5px solid var(--border-norse)' : 'none',
                  }}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>
                  <p className={`text-[14px] c-primary ${f.multiline ? 'whitespace-pre-wrap' : 'truncate'}`}>{f.value}</p>
                </button>
              ))}
            </div>
          )}

          {t.purchase_url && (
            <a
              href={t.purchase_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] font-semibold text-center py-2"
              style={{ color: 'var(--blue)' }}
            >
              Открыть площадку
            </a>
          )}
        </div>
      </BottomSheet>

      <BottomSheet
        open={!!editField}
        onClose={() => setEditField(null)}
        title="Редактирование"
      >
        <div className="flex flex-col gap-3 pb-4">
          {editField === 'comment_to' ? (
            <textarea
              className="input-field resize-none"
              rows={3}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
            />
          ) : (
            <input
              className="input-field"
              type={editField === 'tender_price' ? 'number' : editField === 'docs_deadline' ? 'date' : 'text'}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
            />
          )}
          <button type="button" onClick={saveField} disabled={acting} className="btn-primary spring-tap">
            Сохранить
          </button>
        </div>
      </BottomSheet>

      <WinWorkSheet
        tender={t}
        open={winSheet}
        onClose={() => { setWinSheet(false); onChanged?.(); onClose?.(); }}
        onDone={() => { onChanged?.(); navigate('/works'); }}
      />
    </>
  );
}

export { SourceBadge, RegistryStatusBadge };
