import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { api } from '@/api/client';
import {
  patchRegistryField, patchRegistryStatus, suggestCustomers, archiveRegistryRow,
  loadRpReview, loadTenderFiles, loadRpReviewMessages, loadAnalysisChecklist,
} from '@/api/tendersRegistry';
import {
  REGISTRY_STATUSES,
  REGISTRY_STATUS_LABELS,
  REGISTRY_STATUS_COLORS,
  SOURCE_META,
} from '@/lib/registryStatus';
import { formatDate, formatMoney } from '@/lib/utils';
import { FileText, Eye, Download, ListChecks } from 'lucide-react';
import DocPreviewSheet from './DocPreviewSheet';
import { fileDownloadUrl, downloadProtected } from '@/lib/fileDownload';
import WinWorkSheet from './WinWorkSheet';

/**
 * Вкладки детального экрана тендера (D-341).
 *
 * До этого директор видел только карточку полей реестра: ни сметы, ни чек-листа,
 * ни предпросмотра документов. Вторая половина требований заказчика — «видно
 * всю смету, все ответы от РП, чек-лист, документы с предпросмотром» — теперь
 * закрыта здесь, в общем компоненте реестра, а не в отдельной странице.
 */
const SHEET_TABS = [
  { id: 'overview', label: 'Обзор' },
  { id: 'estimate', label: 'Смета' },
  { id: 'checklist', label: 'Чек-лист' },
  { id: 'report', label: 'Отчёт' },
  { id: 'docs', label: 'Документы' },
];

function parseReportJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

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
  const [suggestions, setSuggestions] = useState([]);
  // D-341: богатые вкладки — смета, чек-лист, отчёт, документы
  const [tab, setTab] = useState('overview');
  const [reviewData, setReviewData] = useState(null);
  const [files, setFiles] = useState([]);
  const [checklist, setChecklist] = useState(null);
  const [preview, setPreview] = useState(null);

  // Данные для вкладок грузим при открытии и БЕЗ «выдумывания»: если эндпоинт
  // не ответил — показываем «нет данных», а не пустые нули.
  const loadTabs = useCallback(async (id) => {
    if (!id) return;
    const [rev, fls, chk] = await Promise.all([
      loadRpReview(id).catch(() => null),
      loadTenderFiles(id).catch(() => []),
      loadAnalysisChecklist(id).catch(() => null),
    ]);
    setReviewData(rev);
    setFiles(Array.isArray(fls) ? fls : []);
    setChecklist(chk);
  }, []);

  useEffect(() => {
    if (open && tender?.id) {
      setTab('overview');
      loadTabs(tender.id);
    }
  }, [open, tender?.id, loadTabs]);

  const onDownloadFile = async (file) => {
    try {
      await downloadProtected(file.download_url || file, file.original_name || file.filename);
    } catch {
      const href = fileDownloadUrl(file);
      if (href) window.open(href, '_blank', 'noopener');
    }
  };

  useEffect(() => {
    if (editField !== 'customer_name' || editValue.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      suggestCustomers(editValue.trim()).then(setSuggestions).catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(t);
  }, [editField, editValue]);

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
  const submissionWithVat = Number(t.submission_price_with_vat) || Number(t.submission_price) || 0;
  const rev = t.rp_review;
  const isRpReject = !!(rev && rev.is_final && rev.decision === 'reject' && t.registry_status !== 'отмена');

  const archiveReject = async () => {
    if (!window.confirm('Отправить тендер в архив? Статус станет «отмена».')) return;
    setActing(true);
    haptic.light();
    try {
      await archiveRegistryRow(t.id, 'РП: не подаём — подтверждено ТО');
      haptic.success();
      onChanged?.();
      onClose?.();
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Не удалось архивировать');
    } finally {
      setActing(false);
    }
  };

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
      if (editField === 'customer_name' && suggestions.length) {
        const hit = suggestions.find((s) => (s.value || s.name) === editValue);
        const inn = hit?.data?.inn || hit?.inn;
        if (inn) await patchRegistryField(t.id, 'customer_inn', inn);
      }
      haptic.success();
      setEditField(null);
      setSuggestions([]);
      onChanged?.();
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Ошибка сохранения');
    } finally {
      setActing(false);
    }
  };

  const pickSuggestion = async (item) => {
    const name = item.value || item.name || item.label || '';
    const inn = item.data?.inn || item.inn || '';
    setActing(true);
    try {
      await patchRegistryField(t.id, 'customer_name', name);
      if (inn) await patchRegistryField(t.id, 'customer_inn', inn);
      haptic.success();
      setEditField(null);
      setSuggestions([]);
      onChanged?.();
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Ошибка');
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
          {/* Вкладки детали: обзор реестра, смета, чек-лист, отчёт, документы (D-341) */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {SHEET_TABS.map((x) => (
              <button
                key={x.id}
                type="button"
                data-active={tab === x.id}
                className="filter-pill spring-tap"
                style={{ flexShrink: 0 }}
                onClick={() => { haptic.light(); setTab(x.id); }}
              >
                {x.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
          <>
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

          {t.score && (
            <div
              className="rounded-xl px-3 py-2 text-[12px]"
              style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-norse)' }}
              title={(t.score.top_reject_reasons || []).map((r) => `${r.reason || r.label || r}${r.count ? ` (${r.count})` : ''}`).join('\n')}
            >
              <p className="font-semibold mb-1">
                Шанс выигрыша: {t.score.win_chance_pct != null ? `${t.score.win_chance_pct}%` : '—'}
                {t.score.tenders_count != null ? ` · тендеров: ${t.score.tenders_count}` : ''}
              </p>
              {(t.score.top_reject_reasons || []).length > 0 && (
                <ul className="list-disc pl-4 c-tertiary text-[11px] space-y-0.5">
                  {t.score.top_reject_reasons.slice(0, 3).map((r, i) => (
                    <li key={i}>{r.reason || r.label || String(r)}{r.count ? ` (${r.count})` : ''}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isRpReject && (
            <div
              className="rounded-xl px-3 py-3 text-[12px] flex flex-col gap-2"
              style={{
                background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                border: '0.5px solid color-mix(in srgb, var(--danger) 35%, transparent)',
              }}
            >
              <p className="font-semibold" style={{ color: 'var(--danger-ink)' }}>РП: не подаём</p>
              <p className="c-tertiary text-[11px]">Тендер остаётся в реестре, пока ТО не отправит в архив.</p>
              <button
                type="button"
                disabled={acting}
                onClick={archiveReject}
                className="px-3 py-2 rounded-xl text-[13px] font-semibold spring-tap"
                style={{ background: 'var(--danger)', color: 'var(--on-danger)' }}
              >
                В архив
              </button>
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
                { label: 'Заказчик', field: 'customer_name', value: t.customer_name, raw: t.customer_name },
                { label: 'Название', field: 'tender_title', value: t.tender_title },
                { label: 'Сумма', field: 'tender_price', value: price > 0 ? formatMoney(price) : '—', raw: t.tender_price },
                {
                  label: 'Подача',
                  value: submissionWithVat > 0 ? formatMoney(submissionWithVat) : '—',
                  readonly: true,
                },
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
          </>
          )}

          {/* ── СМЕТА ── */}
          {tab === 'estimate' && (
            <div className="flex flex-col gap-3">
              {!reviewData?.estimate_file ? (
                <EmptyState
                  icon={FileText}
                  iconColor="var(--gold)"
                  iconBg="color-mix(in srgb, var(--gold) 12%, transparent)"
                  title="Смета не прикреплена"
                  description="Файл сметы к этому тендеру не загружен"
                />
              ) : (
                <>
                  <div
                    className="rounded-xl px-3 py-3 flex items-center gap-3"
                    style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-norse)' }}
                  >
                    <FileText size={20} style={{ color: 'var(--gold)', flexShrink: 0 }} />
                    <div className="min-w-0 flex-1">
                      <p className="c-primary text-[14px] font-semibold truncate">
                        {reviewData.estimate_file.original_name || 'Смета'}
                      </p>
                      {reviewData.estimate_file.size ? (
                        <p className="c-tertiary text-[11px]">
                          {Math.round(reviewData.estimate_file.size / 1024)} КБ
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 spring-tap"
                      style={{
                        minHeight: 48, borderRadius: 14, border: 'none',
                        background: 'var(--blue)', color: '#fff',
                        fontSize: 14, fontWeight: 700,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                      onClick={() => setPreview({ docId: reviewData.estimate_file.id, title: 'Смета' })}
                    >
                      <Eye size={17} /> Открыть смету
                    </button>
                    <button
                      type="button"
                      className="spring-tap"
                      aria-label="Скачать смету"
                      style={{
                        minWidth: 48, minHeight: 48, borderRadius: 14,
                        background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                        border: '0.5px solid var(--border-norse)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      onClick={() => onDownloadFile(reviewData.estimate_file)}
                    >
                      <Download size={18} />
                    </button>
                  </div>
                  {reviewData?.tkp_file && (
                    <div
                      className="rounded-xl px-3 py-3 flex items-center gap-3"
                      style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-norse)' }}
                    >
                      <FileText size={18} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                      <p className="c-primary text-[13px] min-w-0 flex-1 truncate">
                        {reviewData.tkp_file.original_name || 'ТКП'}
                      </p>
                      <button
                        type="button"
                        className="spring-tap"
                        aria-label="Открыть ТКП"
                        style={{ background: 'none', border: 'none', color: 'var(--blue)' }}
                        onClick={() => setPreview({ docId: reviewData.tkp_file.id, title: 'ТКП' })}
                      >
                        <Eye size={17} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── ЧЕК-ЛИСТ ── */}
          {tab === 'checklist' && (
            <div className="flex flex-col gap-2">
              {!checklist ? (
                <p className="c-tertiary text-[13px]">Чек-лист не заполнен</p>
              ) : (() => {
                // Форма ответа (проверено по src/services/analysis-checklist.js):
                //   template — массив { id, text, required }
                //   checklist.answers — объект { [id]: ответ }
                const tpl = Array.isArray(checklist.template) ? checklist.template : [];
                const answers = (checklist.checklist && checklist.checklist.answers) || {};
                if (!tpl.length && !Object.keys(answers).length) {
                  return (
                    <EmptyState
                      icon={ListChecks}
                      iconColor="var(--blue)"
                      iconBg="color-mix(in srgb, var(--blue) 12%, transparent)"
                      title="Чек-лист не заполнен"
                      description="РП не заполнял чек-лист анализа по этому тендеру"
                    />
                  );
                }
                return (
                  <>
                    <p className="c-tertiary text-[12px] mb-1">
                      Заполнил РП · основание решения о подаче
                    </p>
                    {tpl.map((q, i) => {
                      const key = q.id != null ? String(q.id) : String(i);
                      const label = q.text || q.label || q.title || `Пункт ${i + 1}`;
                      const val = answers[key];
                      const shown = val == null || val === '' ? '—'
                        : typeof val === 'boolean' ? (val ? 'да' : 'нет')
                          : Array.isArray(val) ? val.join(', ')
                            : String(val);
                      return (
                        <div
                          key={key}
                          className="rounded-xl px-3 py-3"
                          style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-norse)' }}
                        >
                          <p className="c-secondary text-[12.5px] mb-1.5">{label}</p>
                          <p
                            className={shown === '—' ? 'c-tertiary' : 'c-primary'}
                            style={{ fontSize: 14, fontWeight: shown === '—' ? 500 : 600, whiteSpace: 'pre-wrap' }}
                          >
                            {shown}
                          </p>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          )}

          {/* ── ОТЧЁТ ── */}
          {tab === 'report' && (
            <div className="flex flex-col gap-2">
              {!reviewData ? (
                <p className="c-tertiary text-[13px]">Загрузка…</p>
              ) : (() => {
                const rj = parseReportJson(reviewData.review?.report_json);
                const rows = [
                  ['Суть', rj.summary],
                  ['Риски', rj.risks],
                  ['Рекомендация РП', rj.recommendation],
                  ['Цена с НДС', reviewData.review?.work_price != null ? formatMoney(reviewData.review.work_price) : null],
                  ['Цена без НДС', reviewData.review?.work_price_ex_vat != null ? formatMoney(reviewData.review.work_price_ex_vat) : null],
                  ['Себестоимость без НДС', rj.cost_without_vat != null ? formatMoney(rj.cost_without_vat) : null],
                ];
                const hasAny = rows.some(([, v]) => v != null && v !== '');
                if (!hasAny) {
                  return <p className="c-tertiary text-[13px]">Отчёт РП не заполнен</p>;
                }
                return rows
                  .filter(([, v]) => v != null && v !== '')
                  .map(([label, v]) => (
                    <div
                      key={label}
                      className="rounded-xl px-3 py-3"
                      style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-norse)' }}
                    >
                      <p className="c-tertiary text-[11px] mb-1">{label}</p>
                      <p className="c-primary text-[14px] leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>{v}</p>
                    </div>
                  ));
              })()}
            </div>
          )}

          {/* ── ДОКУМЕНТЫ ── */}
          {tab === 'docs' && (
            <div className="flex flex-col gap-2">
              {!files.length ? (
                <EmptyState
                  icon={FileText}
                  iconColor="var(--blue)"
                  iconBg="color-mix(in srgb, var(--blue) 12%, transparent)"
                  title="Документы не загружены"
                  description="Файлы к этому тендеру не приложены"
                />
              ) : files.map((f) => {
                const isArch = /\.(zip|rar|7z)$/i.test(f.original_name || f.filename || '');
                return (
                  <div
                    key={f.id}
                    className="rounded-xl px-3 py-3 flex items-center gap-3"
                    style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-norse)' }}
                  >
                    <FileText size={18} style={{ color: isArch ? 'var(--gold)' : 'var(--blue)', flexShrink: 0 }} />
                    <div className="min-w-0 flex-1">
                      <p className="c-primary text-[13.5px] font-medium truncate">
                        {f.original_name || f.filename}
                      </p>
                      <p className="c-tertiary text-[11px]">
                        {f.size ? `${Math.round(f.size / 1024)} КБ` : ''}{isArch ? ' · архив' : ''}
                      </p>
                    </div>
                    {/* Архив предпросмотром не открыть — оставляем только скачивание */}
                    {!isArch && f.id && (
                      <button
                        type="button"
                        className="spring-tap"
                        aria-label="Просмотр документа"
                        style={{ background: 'none', border: 'none', color: 'var(--blue)', flexShrink: 0 }}
                        onClick={() => setPreview({ docId: f.id, title: f.original_name || f.filename })}
                      >
                        <Eye size={17} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="spring-tap"
                      aria-label="Скачать документ"
                      style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', flexShrink: 0 }}
                      onClick={() => onDownloadFile(f)}
                    >
                      <Download size={17} />
                    </button>
                  </div>
                );
              })}
            </div>
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
          {editField === 'customer_name' && suggestions.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
              {suggestions.slice(0, 6).map((s, i) => {
                const name = s.value || s.name || s.label || '';
                const inn = s.data?.inn || s.inn || '';
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    className="w-full text-left px-3 py-2 spring-tap text-[13px]"
                    style={{ background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border-norse)' }}
                  >
                    {name}{inn ? ` · ИНН ${inn}` : ''}
                  </button>
                );
              })}
            </div>
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

      {/* Предпросмотр документа внутри приложения (D-341) */}
      <DocPreviewSheet
        open={!!preview}
        onClose={() => setPreview(null)}
        tenderId={t.id}
        docId={preview?.docId}
        title={preview?.title}
      />
    </>
  );
}

export { SourceBadge, RegistryStatusBadge };
