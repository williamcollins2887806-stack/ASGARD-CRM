import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import DocPreviewSheet from '@/components/tenders/DocPreviewSheet';
import { Check, X as XIcon, MessageCircle, Clock, ChevronRight, Eye, Download } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import {
  loadDirectorReviewQueue, markDirectorReviewSeen, directorDecisionRpReview,
  loadRpReview, loadTenderFiles, loadRpReviewMessages, postRpReviewMessage
} from '@/api/tendersRegistry';
import { fileDownloadUrl, downloadProtected } from '@/lib/fileDownload';

const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];
const TABS = [
  { id: 'summary', label: 'Сводка' },
  { id: 'report', label: 'Отчёт' },
  { id: 'tz', label: 'ТЗ' },
  { id: 'chat', label: 'Чат' },
];

function fmtDate(v) {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
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

function BriefKv({ label, value, highlight }) {
  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 12,
      background: highlight
        ? 'color-mix(in srgb, var(--gold) 12%, transparent)'
        : 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
      border: '0.5px solid var(--border-norse)',
    }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: highlight ? 700 : 600, lineHeight: 1.35 }}>{value}</div>
    </div>
  );
}

function DocRow({ label, file, onPreview, onDownload }) {
  if (!file) return null;
  const arch = isArchiveFile(file);
  const kb = file.size ? `${Math.round(file.size / 1024)} КБ` : '';
  return (
    <div
      className="m-card"
      style={{ padding: 12, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12 }} className="muted">{label}</div>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.original_name || label}
        </div>
        {kb ? <div className="muted" style={{ fontSize: 11 }}>{kb}</div> : null}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {!arch && file.id && (
          <button type="button" className="btn mini" onClick={() => onPreview(file, label)}>
            <Eye size={14} style={{ marginRight: 4 }} /> Просмотр
          </button>
        )}
        {(file.download_url || file.file_url) && (
          <button type="button" className="btn mini ghost" onClick={() => onDownload(file)}>
            <Download size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function TenderCard({ row, onOpen }) {
  const urgent = row.director_notify_at
    && (Date.now() - new Date(row.director_notify_at).getTime() > 24 * 3600 * 1000);
  return (
    <button
      type="button"
      className={'m-card' + (urgent ? ' border-red-500/40' : '')}
      style={{ width: '100%', textAlign: 'left', padding: '14px 16px', marginBottom: 10 }}
      onClick={() => onOpen(row)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{row.customer_name || '—'}</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            {(row.tender_title || '—').slice(0, 80)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, fontSize: 12 }}>
            <span>НМЦ: <strong>{formatMoney(row.tender_price)}</strong></span>
            <span>РП: <strong>{formatMoney(row.work_price_ex_vat)}</strong> без НДС</span>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Clock size={12} />
            Срок: {fmtDate(row.docs_deadline)}
            {row.duration_days != null ? ` · ${row.duration_days} дн.` : ''}
          </div>
        </div>
        <ChevronRight size={18} className="muted" style={{ flexShrink: 0, marginTop: 4 }} />
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
  const [chatText, setChatText] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  const loadDetail = useCallback(async () => {
    if (!row?.id) return;
    const [rev, files, msgs] = await Promise.all([
      loadRpReview(row.id).catch(() => null),
      loadTenderFiles(row.id).catch(() => []),
      loadRpReviewMessages(row.id).catch(() => ({ messages: [] })),
    ]);
    setReviewData(rev);
    setDocs(files);
    setMessages(msgs?.messages || []);
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
    haptic?.impact?.('medium');
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
      <label className="muted" style={{ fontSize: 12 }}>Комментарий (обязателен при отказе)</label>
      <textarea
        className="inp"
        rows={2}
        style={{ width: '100%', marginTop: 6, marginBottom: 10 }}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Причина отказа…"
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button
          type="button"
          className="btn"
          style={{ minHeight: 52, background: 'var(--success)' }}
          disabled={busy}
          onClick={() => decide('submit')}
        >
          <Check size={18} style={{ marginRight: 6 }} /> Подавать
        </button>
        <button
          type="button"
          className="btn ghost"
          style={{ minHeight: 52, color: 'var(--danger)' }}
          disabled={busy || !comment.trim()}
          onClick={() => decide('reject')}
        >
          <XIcon size={18} style={{ marginRight: 6 }} /> Не подавать
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
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={'btn mini' + (tab === t.id ? '' : ' ghost')}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </div>

        {tab === 'summary' && (
          <div style={{ paddingBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Просчёт на согласование</div>
              <span
                className="pill mini"
                style={{
                  background: dec === 'submit'
                    ? 'color-mix(in srgb, var(--success) 18%, transparent)'
                    : dec === 'reject'
                      ? 'color-mix(in srgb, var(--danger) 18%, transparent)'
                      : 'var(--bg-surface)',
                }}
              >{decLabel}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <BriefKv label="РП (считал)" value={calcName} />
              <BriefKv label="Заказчик" value={row.customer_name || '—'} />
              <BriefKv label="Себестоимость без НДС" value={formatMoney(rj.cost_without_vat)} />
              <BriefKv label="Сумма подачи с НДС" value={formatMoney(priceInc)} highlight />
              <BriefKv label="Сумма подачи без НДС" value={formatMoney(priceEx)} />
              <BriefKv label="Срок выполнения" value={duration != null && duration !== '' ? `${duration} дн.` : '—'} />
              <BriefKv label="Срок подачи документов" value={fmtDate(row.docs_deadline)} />
              <BriefKv label="НМЦ" value={formatMoney(row.tender_price)} />
            </div>
            <div style={{ marginTop: 10 }}>
              <BriefKv label="Предмет" value={row.tender_title || '—'} />
            </div>
            {(rj.recommendation || rj.summary) && (
              <div style={{
                marginTop: 12, padding: 12, borderRadius: 12,
                border: '0.5px solid var(--border-norse)', fontSize: 13, lineHeight: 1.45,
              }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                  {rj.recommendation ? 'Рекомендация РП' : 'Суть'}
                </div>
                {rj.recommendation || String(rj.summary || '').slice(0, 280)}
              </div>
            )}

            <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600, fontSize: 14 }}>Документы</div>
            {!estimate && !report && !tkp ? (
              <p className="muted" style={{ fontSize: 13 }}>Файлы просчёта не прикреплены</p>
            ) : (
              <>
                <DocRow
                  label="Смета"
                  file={estimate}
                  onPreview={(f, label) => setPreview({ docId: f.id, title: label })}
                  onDownload={onDownload}
                />
                <DocRow
                  label="Отчёт"
                  file={report}
                  onPreview={(f, label) => setPreview({ docId: f.id, title: label })}
                  onDownload={onDownload}
                />
                <DocRow
                  label="ТКП"
                  file={tkp}
                  onPreview={(f, label) => setPreview({ docId: f.id, title: label })}
                  onDownload={onDownload}
                />
              </>
            )}
            {row.purchase_url && (
              <a
                className="btn mini ghost"
                href={row.purchase_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginTop: 8, display: 'inline-flex' }}
              >↗ Закупка</a>
            )}
          </div>
        )}

        {tab === 'report' && (
          <div style={{ fontSize: 14, paddingBottom: 8 }}>
            {!reviewData ? <p className="muted">Загрузка…</p> : (
              <>
                <p><strong>Суть:</strong> {rj.summary || '—'}</p>
                <p><strong>Риски:</strong> {rj.risks || '—'}</p>
                <p><strong>Рекомендация:</strong> {rj.recommendation || '—'}</p>
                <p><strong>Цена с НДС:</strong> {formatMoney(review?.work_price)}</p>
                <p><strong>Себестоимость без НДС:</strong> {formatMoney(rj.cost_without_vat)}</p>
              </>
            )}
          </div>
        )}

        {tab === 'tz' && (
          <div style={{ paddingBottom: 8 }}>
            {!docs.length ? <p className="muted">Документы ТО не загружены</p> : docs.map((d) => (
              <a
                key={d.id}
                href={fileDownloadUrl(d.download_url || d)}
                target="_blank"
                rel="noreferrer"
                className="m-card"
                style={{ display: 'block', padding: 12, marginBottom: 8, fontSize: 14 }}
              >📄 {d.original_name || d.filename}</a>
            ))}
          </div>
        )}

        {tab === 'chat' && (
          <div style={{ paddingBottom: 8 }}>
            <div style={{ maxHeight: '36vh', overflowY: 'auto', marginBottom: 12 }}>
              {!messages.length ? <p className="muted">Нет сообщений</p> : messages.map((m) => (
                <div key={m.id} style={{ marginBottom: 10, fontSize: 13 }}>
                  <div className="muted" style={{ fontSize: 11 }}>{m.user_name} · {new Date(m.created_at).toLocaleString('ru-RU')}</div>
                  <div>{m.body}</div>
                </div>
              ))}
            </div>
            {chatOpen ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <textarea
                  className="inp"
                  rows={2}
                  style={{ flex: 1 }}
                  placeholder="Сообщение…"
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                />
                <button type="button" className="btn" disabled={busy} onClick={sendChat}>
                  <MessageCircle size={18} />
                </button>
              </div>
            ) : (
              <p className="muted">Чат закрыт</p>
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
    haptic?.selection?.();
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
          <EmptyState title="Очередь пуста" description="Нет тендеров, ожидающих согласования" />
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
