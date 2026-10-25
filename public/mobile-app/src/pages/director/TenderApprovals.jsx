import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { StatCard, StatRow } from '@/components/shared/StatCard';
import { StatusBadge } from '@/components/shared/StatusBadge';
import DocPreviewSheet from '@/components/tenders/DocPreviewSheet';
import EstimateInline from '@/components/tenders/EstimateInline';
import { Check, X as XIcon, MessageCircle, Clock, ChevronRight, Eye, Download, AlertTriangle, FileText, ListChecks, ExternalLink } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import {
  loadDirectorReviewQueue, markDirectorReviewSeen, directorDecisionRpReview,
  loadRpReview, loadTenderFiles, loadRpReviewMessages, postRpReviewMessage,
  loadAnalysisChecklist,
} from '@/api/tendersRegistry';
import { fileDownloadUrl, downloadProtected } from '@/lib/fileDownload';

const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];
const TABS = [
  { id: 'summary', label: 'Сводка' },
  { id: 'estimate', label: 'Смета' },
  { id: 'checklist', label: 'Чек-лист' },
  { id: 'report', label: 'Отчёт' },
  { id: 'tz', label: 'Документы' },
  { id: 'chat', label: 'Чат' },
];

function fmtDate(v) {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

/** Дней до дедлайна: отрицательное — просрочено. null — срока нет. */
function daysLeft(v) {
  if (!v) return null;
  const d = new Date(String(v).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function parseRj(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function isArchiveFile(f) {
  if (!f) return true;
  const name = String(f.original_name || f.filename || '').toLowerCase();
  const mime = String(f.mime_type || '').toLowerCase();
  return mime.includes('zip') || mime.includes('rar') || mime.includes('7z')
    || /\.(zip|rar|7z)$/i.test(name);
}

/** Строка «показатель → значение» на дизайн-токенах (замена самодельного BriefKv). */
function Kv({ label, value, accent, tone }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 12,
        background: accent
          ? 'color-mix(in srgb, var(--gold) 12%, transparent)'
          : 'var(--bg-surface-alt)',
        border: '0.5px solid var(--border-norse)',
      }}
    >
      <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div
        className={tone === 'danger' ? undefined : 'c-primary'}
        style={{
          fontSize: accent ? 15 : 14,
          fontWeight: accent ? 800 : 600,
          lineHeight: 1.35,
          color: tone === 'danger' ? 'var(--danger-ink)' : undefined,
          wordBreak: 'break-word',
        }}
      >{value}</div>
    </div>
  );
}

function DocRow({ label, file, onPreview, onDownload }) {
  if (!file) return null;
  const arch = isArchiveFile(file);
  const kb = file.size ? `${Math.round(file.size / 1024)} КБ` : '';
  return (
    <div
      className="card-glass"
      style={{ padding: 12, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}
    >
      <FileText size={18} style={{ color: arch ? 'var(--gold)' : 'var(--blue)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="c-tertiary" style={{ fontSize: 12 }}>{label}</div>
        <div className="c-primary" style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.original_name || label}
        </div>
        <div className="c-tertiary" style={{ fontSize: 11 }}>
          {kb}{arch ? ' · архив' : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {/* Архив предпросмотром не откроем — даём скачать, но не оставляем пустоту. */}
        {!arch && file.id && (
          <button
            type="button"
            className="btn-icon spring-tap"
            onClick={() => onPreview(file, label)}
            aria-label={`Просмотр: ${label}`}
          >
            <Eye size={16} />
          </button>
        )}
        {(file.download_url || file.file_url) && (
          <button
            type="button"
            className="btn-icon spring-tap"
            onClick={() => onDownload(file)}
            aria-label={`Скачать: ${label}`}
          >
            <Download size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function TenderCard({ row, onOpen }) {
  const dl = daysLeft(row.docs_deadline);
  // «Горит», если ждёт решения больше суток или срок подачи на исходе/просрочен.
  const waitingLong = row.director_notify_at
    && (Date.now() - new Date(row.director_notify_at).getTime() > 24 * 3600 * 1000);
  const dlTone = dl != null && dl <= 0 ? 'danger' : (dl != null && dl <= 2 ? 'warn' : 'normal');

  return (
    <button
      type="button"
      className="card-glass spring-tap w-full text-left"
      style={{
        padding: '14px 16px',
        marginBottom: 10,
        borderColor: waitingLong ? 'color-mix(in srgb, var(--danger) 40%, var(--border-norse))' : undefined,
      }}
      onClick={() => onOpen(row)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="c-primary" style={{ fontWeight: 700, fontSize: 15 }}>
            {row.customer_name || '—'}
          </div>
          <div className="c-secondary" style={{ fontSize: 13, marginTop: 4 }}>
            {(row.tender_title || '—').slice(0, 90)}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <span className="c-tertiary" style={{ fontSize: 12 }}>
              НМЦ: <strong style={{ color: 'var(--text-primary)' }}>{formatMoney(row.tender_price)}</strong>
            </span>
            <span className="c-tertiary" style={{ fontSize: 12 }}>
              РП: <strong style={{ color: 'var(--gold)' }}>{formatMoney(row.work_price_ex_vat)}</strong> без НДС
            </span>
          </div>

          {/* Дедлайн: заметный, с остатком дней. Просрочка — красным. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 12, fontWeight: 600,
                color: dlTone === 'danger' ? 'var(--danger-ink)'
                  : dlTone === 'warn' ? 'var(--gold)' : 'var(--text-secondary)',
              }}
            >
              <Clock size={12} />
              {fmtDate(row.docs_deadline)}
              {dl != null && (
                <span style={{ opacity: 0.85 }}>
                  {dl < 0 ? `· просрочен на ${Math.abs(dl)} дн.`
                    : dl === 0 ? '· последний день'
                      : `· ${dl} дн.`}
                </span>
              )}
            </span>
            {row.duration_days != null && (
              <span className="c-tertiary" style={{ fontSize: 11 }}>{row.duration_days} дн. работ</span>
            )}
            {waitingLong && (
              <StatusBadge status="просрочено" label="ждёт >24 ч" />
            )}
          </div>
        </div>
        <ChevronRight size={18} className="c-tertiary" style={{ flexShrink: 0, marginTop: 4 }} />
      </div>
    </button>
  );
}

function DetailSheet({ row, open, onClose, onChanged, initialTab }) {
  const haptic = useHaptic();
  const [tab, setTab] = useState(initialTab || 'summary');
  const [reviewData, setReviewData] = useState(null);
  const [docs, setDocs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [checklist, setChecklist] = useState(null);
  const [chatText, setChatText] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  const loadDetail = useCallback(async () => {
    if (!row?.id) return;
    const [rev, files, msgs, chk] = await Promise.all([
      loadRpReview(row.id).catch(() => null),
      loadTenderFiles(row.id).catch(() => []),
      loadRpReviewMessages(row.id).catch(() => ({ messages: [] })),
      // Чек-лист анализа — обоснование решения РП о подаче (D-203).
      loadAnalysisChecklist(row.id).catch(() => null),
    ]);
    setReviewData(rev);
    setDocs(files);
    setMessages(msgs?.messages || []);
    setChecklist(chk);
  }, [row?.id]);

  useEffect(() => {
    if (open && row) {
      markDirectorReviewSeen(row.id).catch(() => {});
      loadDetail();
      setTab(initialTab && TABS.some((t) => t.id === initialTab) ? initialTab : 'summary');
      setComment('');
    }
  }, [open, row, loadDetail, initialTab]);

  const decide = async (action) => {
    if (action === 'reject' && !comment.trim()) {
      haptic?.error?.();
      return;
    }
    setBusy(true);
    haptic?.medium?.();
    try {
      await directorDecisionRpReview(row.id, {
        action,
        comment: comment.trim() || undefined,
      });
      onChanged?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const sendChat = async () => {
    const body = chatText.trim();
    if (!body) return;
    setBusy(true);
    try {
      const res = await postRpReviewMessage(row.id, body);
      if (res?.message) setMessages((m) => [...m, res.message]);
      setChatText('');
    } finally {
      setBusy(false);
    }
  };

  const onDownload = async (file) => {
    try {
      await downloadProtected(file.download_url || file, file.original_name || file.filename);
    } catch {
      const href = fileDownloadUrl(file);
      if (href) window.open(href, '_blank', 'noopener');
    }
  };

  if (!row) return null;
  const review = reviewData?.review;
  const rj = parseRj(review?.report_json);
  const estimate = reviewData?.estimate_file;
  const tkp = reviewData?.tkp_file;
  const report = reviewData?.report_file;
  /**
   * Смета просчёта для показа НА СТРАНИЦЕ (24.10.2026).
   *
   * Проверено на живом API: `asgard_smeta` лежит в `report_json`, а у тендеров,
   * закрытых только по анализу — в `analysis_snapshot.asgard_smeta`. Бомбы нет:
   * если структуры нет ни там, ни там, компонент `EstimateInline` честно скажет
   * «смета не заполнена», а не покажет пустые нули.
   */
  const estimateSmeta = rj?.asgard_smeta
    || reviewData?.analysis_snapshot?.asgard_smeta
    || review?.analysis_snapshot?.asgard_smeta
    || null;
  const chatOpen = !review?.is_final || ['pending', 'approved'].includes(review?.director_review_status || '');

  const calcName = review?.finalized_by_name
    || review?.calculator_name
    || row.calculator_name
    || '—';
  const priceInc = review?.work_price != null ? Number(review.work_price) : null;
  const priceEx = review?.work_price_ex_vat != null
    ? Number(review.work_price_ex_vat)
    : (row.work_price_ex_vat != null
      ? Number(row.work_price_ex_vat)
      : (Number.isFinite(priceInc) ? Math.round((priceInc / 1.22) * 100) / 100 : null));
  const duration = rj.duration_days ?? row.duration_days;
  const dec = review?.decision;
  const decLabel = dec === 'submit' ? 'РП: подаём' : (dec === 'reject' ? 'РП: не подаём' : 'Решение РП не зафиксировано');
  const showDecision = !review || review.director_review_status === 'pending' || row.director_review_status === 'pending';

  const footer = showDecision ? (
    <div>
      <label className="input-label">Комментарий (обязателен при отказе)</label>
      <textarea
        className="input-field"
        rows={2}
        style={{ width: '100%', marginTop: 6, marginBottom: 10, resize: 'none' }}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Причина отказа…"
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button
          type="button"
          className="spring-tap"
          style={{
            minHeight: 52, borderRadius: 14, border: 'none',
            fontSize: 15, fontWeight: 700,
            background: 'var(--ok)', color: 'var(--on-ok)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: busy ? 0.6 : 1,
          }}
          disabled={busy}
          onClick={() => decide('submit')}
        >
          <Check size={18} /> Подавать
        </button>
        <button
          type="button"
          className="spring-tap"
          style={{
            minHeight: 52, borderRadius: 14, fontSize: 15, fontWeight: 700,
            background: 'var(--bg-elevated)', color: 'var(--danger-ink)',
            border: '0.5px solid color-mix(in srgb, var(--danger) 40%, var(--border-norse))',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: (busy || !comment.trim()) ? 0.5 : 1,
          }}
          disabled={busy || !comment.trim()}
          onClick={() => decide('reject')}
        >
          <XIcon size={18} /> Не подавать
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title={`Тендер #${row.registry_no || row.id}`}
        maxHeight="92vh"
        footer={footer}
      >
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', paddingBottom: 2 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              // Активное состояние задаётся атрибутом data-active — как в остальном
              // приложении (Invoices, Payroll, Permits). Класса is-active в CSS нет.
              data-active={tab === t.id}
              className="filter-pill spring-tap"
              style={{ flexShrink: 0, minHeight: 36 }}
              onClick={() => { haptic?.light?.(); setTab(t.id); }}
            >{t.label}</button>
          ))}
        </div>

        {tab === 'summary' && (
          <div style={{ paddingBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <div className="c-primary" style={{ fontWeight: 700, fontSize: 15 }}>Просчёт на согласование</div>
              <StatusBadge
                status={dec === 'submit' ? 'согласован' : dec === 'reject' ? 'отклонено' : 'в работе'}
                label={decLabel}
              />
            </div>

            {/* Ключевые цифры — компонент дизайн-системы */}
            <StatRow>
              <StatCard label="Сумма подачи (с НДС)" color="var(--green)" value={formatMoney(priceInc)} />
              <StatCard label="Без НДС" color="var(--gold)" value={formatMoney(priceEx)} />
              <StatCard label="НМЦ" color="var(--blue)" value={formatMoney(row.tender_price, { short: true })} />
            </StatRow>

            {/* Дедлайн — крупно и заметно */}
            {(() => {
              const dl = daysLeft(row.docs_deadline);
              const tone = dl != null && dl <= 0 ? 'var(--danger-ink)' : dl != null && dl <= 2 ? 'var(--gold)' : 'var(--text-primary)';
              return (
                <div
                  style={{
                    marginTop: 12, padding: '12px 14px', borderRadius: 12,
                    background: 'var(--bg-surface-alt)',
                    border: '0.5px solid var(--border-norse)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  }}
                >
                  <span className="c-secondary" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={14} /> Срок подачи
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: tone }}>
                    {fmtDate(row.docs_deadline)}
                    {dl != null && (
                      <span style={{ fontWeight: 600, marginLeft: 6, fontSize: 13 }}>
                        {dl < 0 ? `просрочен на ${Math.abs(dl)} дн.` : dl === 0 ? 'последний день' : `${dl} дн.`}
                      </span>
                    )}
                  </span>
                </div>
              );
            })()}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
              <Kv label="РП (считал)" value={calcName} />
              <Kv label="Заказчик" value={row.customer_name || '—'} />
              <Kv label="Себестоимость без НДС" value={formatMoney(rj.cost_without_vat)} />
              <Kv label="Сумма подачи с НДС" value={formatMoney(priceInc)} accent />
              <Kv label="Сумма подачи без НДС" value={formatMoney(priceEx)} />
              <Kv label="Срок выполнения" value={duration != null && duration !== '' ? `${duration} дн.` : '—'} />
            </div>
            <div style={{ marginTop: 8 }}>
              <Kv label="Предмет" value={row.tender_title || '—'} />
            </div>
            {(rj.recommendation || rj.summary) && (
              <div style={{
                marginTop: 12, padding: 12, borderRadius: 12,
                background: 'var(--bg-surface-alt)',
                border: '0.5px solid var(--border-norse)', fontSize: 13, lineHeight: 1.45,
              }}>
                <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 4 }}>
                  {rj.recommendation ? 'Рекомендация РП' : 'Суть'}
                </div>
                <span className="c-primary">{rj.recommendation || String(rj.summary || '').slice(0, 280)}</span>
              </div>
            )}

            {row.purchase_url && (
              <a
                className="spring-tap"
                href={row.purchase_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
                  minHeight: 44, padding: '0 14px', borderRadius: 12,
                  background: 'var(--bg-elevated)', color: 'var(--blue-fill)',
                  border: '0.5px solid var(--border-norse)',
                  fontSize: 14, fontWeight: 600, textDecoration: 'none',
                }}
              >
                <ExternalLink size={16} /> Открыть на площадке
              </a>
            )}
          </div>
        )}

        {/* ── СМЕТА: сама смета НА СТРАНИЦЕ + файл как дополнение ──
            Требование заказчика (24.10.2026): директору нужно видеть смету из
            просчёта прямо на экране, а не открывать файл. Файл оставляем ниже —
            если сотрудник приложил свой документ, его тоже надо увидеть. */}
        {tab === 'estimate' && (
          <div style={{ paddingBottom: 8 }}>
            <EstimateInline smeta={estimateSmeta} />

            {estimate && (
              <div style={{ marginTop: 14 }}>
                <div className="c-tertiary" style={{ fontSize: 11, marginBottom: 6 }}>
                  Прикреплённый файл сметы
                </div>
                <DocRow
                  label="Смета"
                  file={estimate}
                  onPreview={(f, label) => setPreview({ docId: f.id, title: label })}
                  onDownload={onDownload}
                />
                <button
                  type="button"
                  className="spring-tap"
                  style={{
                    width: '100%', minHeight: 46, borderRadius: 14, marginTop: 8,
                    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                    border: '0.5px solid var(--border-norse)',
                    fontSize: 14, fontWeight: 600,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                  onClick={() => setPreview({ docId: estimate.id, title: 'Смета' })}
                >
                  <Eye size={16} /> Открыть файл сметы
                </button>
              </div>
            )}

            {!estimate && !estimateSmeta && (
              <div style={{ marginTop: 12 }}>
                <EmptyState
                  icon={FileText}
                  iconColor="var(--gold)"
                  iconBg="color-mix(in srgb, var(--gold) 12%, transparent)"
                  title="Смета недоступна"
                  description="РП не заполнил смету в просчёте и не приложил файл"
                />
              </div>
            )}

            {/* Отчёт и ТКП — рядом, чтобы директор видел полный комплект */}
            {report && (
              <div style={{ marginTop: 14 }}>
                <DocRow
                  label="Отчёт РП"
                  file={report}
                  onPreview={(f, label) => setPreview({ docId: f.id, title: label })}
                  onDownload={onDownload}
                />
              </div>
            )}
            {tkp && (
              <DocRow
                label="ТКП"
                file={tkp}
                onPreview={(f, label) => setPreview({ docId: f.id, title: label })}
                onDownload={onDownload}
              />
            )}
          </div>
        )}

        {/* ── ЧЕК-ЛИСТ: основание решения о подаче (D-203) ── */}
        {tab === 'checklist' && (
          <div style={{ paddingBottom: 8 }}>
            {!checklist ? (
              <p className="c-tertiary" style={{ fontSize: 13 }}>Загрузка…</p>
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
                  <div className="c-tertiary" style={{ fontSize: 12, marginBottom: 10 }}>
                    Заполнил РП · это основание решения о подаче
                  </div>
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
                        className="card-glass"
                        style={{ padding: 12, marginBottom: 8 }}
                      >
                        <div className="c-secondary" style={{ fontSize: 12.5, marginBottom: 6, lineHeight: 1.35 }}>
                          {label}
                        </div>
                        <div
                          className={shown === '—' ? 'c-tertiary' : 'c-primary'}
                          style={{ fontSize: 14, fontWeight: shown === '—' ? 500 : 600, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}
                        >
                          {shown}
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}

        {tab === 'chat' && (
          <div style={{ paddingBottom: 8 }}>
            <div style={{ maxHeight: '36vh', overflowY: 'auto', marginBottom: 12 }}>
              {!messages.length ? (
                <p className="c-tertiary" style={{ fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
                  Сообщений пока нет — задайте вопрос РП, если что-то непонятно
                </p>
              ) : messages.map((m) => (
                <div key={m.id} style={{ marginBottom: 12, fontSize: 13 }}>
                  <div className="c-tertiary" style={{ fontSize: 11 }}>
                    {m.user_name} · {new Date(m.created_at).toLocaleString('ru-RU')}
                  </div>
                  <div className="c-primary" style={{ marginTop: 2, lineHeight: 1.4 }}>{m.body}</div>
                </div>
              ))}
            </div>
            {chatOpen ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  className="input-field"
                  rows={2}
                  style={{ flex: 1, resize: 'none' }}
                  placeholder="Сообщение РП…"
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                />
                <button
                  type="button"
                  className="spring-tap"
                  disabled={busy || !chatText.trim()}
                  onClick={sendChat}
                  aria-label="Отправить сообщение"
                  style={{
                    minWidth: 48, minHeight: 48, borderRadius: 14, border: 'none',
                    background: 'var(--blue-fill)', color: 'var(--on-ok)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    opacity: (busy || !chatText.trim()) ? 0.5 : 1,
                  }}
                >
                  <MessageCircle size={18} />
                </button>
              </div>
            ) : (
              <p className="c-tertiary" style={{ fontSize: 13 }}>Чат закрыт — решение принято</p>
            )}
          </div>
        )}
      </BottomSheet>

      <DocPreviewSheet
        open={!!preview}
        onClose={() => setPreview(null)}
        tenderId={row.id}
        docId={preview?.docId}
        title={preview?.title}
      />
    </>
  );
}

export default function DirectorTenderApprovals() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const haptic = useHaptic();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState(null);

  const role = user?.role || '';
  if (!DIRECTOR_ROLES.includes(role)) {
    return (
      <PageShell title="Согласование тендеров">
        <EmptyState title="Нет доступа" description="Только для директоров" />
      </PageShell>
    );
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loadDirectorReviewQueue();
      setItems(res.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const id = params.get('id');
    if (!id || !items.length) return;
    const row = items.find((r) => String(r.id) === String(id));
    if (row) setOpened(row);
  }, [items, params]);

  const openRow = (row) => {
    haptic?.light?.();
    setOpened(row);
    navigate(`/director-tender-approvals?id=${row.id}`, { replace: true });
  };

  const initialTab = params.get('tab') || 'summary';

  return (
    <PageShell
      title="Согласование тендеров"
      subtitle={items.length ? `${items.length} в очереди` : 'Очередь пуста'}
    >
      <PullToRefresh onRefresh={fetchData}>
        {loading ? (
          <SkeletonList count={4} />
        ) : !items.length ? (
          <EmptyState
            icon={Check}
            iconColor="var(--green)"
            iconBg="color-mix(in srgb, var(--green) 12%, transparent)"
            title="Очередь пуста"
            description="Нет просчётов, ожидающих вашего решения"
          />
        ) : (
          items.map((row) => (
            <TenderCard key={row.id} row={row} onOpen={openRow} />
          ))
        )}
      </PullToRefresh>

      <DetailSheet
        row={opened}
        open={!!opened}
        initialTab={initialTab}
        onClose={() => {
          setOpened(null);
          navigate('/director-tender-approvals', { replace: true });
        }}
        onChanged={fetchData}
      />
    </PageShell>
  );
}
