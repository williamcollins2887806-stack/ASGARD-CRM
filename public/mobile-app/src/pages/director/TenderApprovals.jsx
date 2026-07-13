import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Check, X as XIcon, MessageCircle, Clock, ChevronRight } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import {
  loadDirectorReviewQueue, markDirectorReviewSeen, directorDecisionRpReview,
  loadRpReview, loadTenderFiles, loadRpReviewMessages, postRpReviewMessage
} from '@/api/tendersRegistry';
import { fileDownloadUrl } from '@/lib/fileDownload';

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

function DetailSheet({ row, open, onClose, onChanged }) {
  const haptic = useHaptic();
  const [tab, setTab] = useState('summary');
  const [reviewData, setReviewData] = useState(null);
  const [docs, setDocs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [chatText, setChatText] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

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
      setTab('summary');
      setComment('');
    }
  }, [open, row, loadDetail]);

  const decide = async (action) => {
    if (action === 'reject' && !comment.trim()) return;
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

  if (!row) return null;
  const review = reviewData?.review;
  const rj = parseRj(review?.report_json);
  const estimate = reviewData?.estimate_file;
  const tkp = reviewData?.tkp_file;
  const report = reviewData?.report_file;
  const chatOpen = !review?.is_final || ['pending', 'approved'].includes(review?.director_review_status || '');

  return (
    <BottomSheet open={open} onClose={onClose} title={`Тендер #${row.registry_no || row.id}`} height="92vh">
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
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>
          <p><strong>Заказчик:</strong> {row.customer_name || '—'}</p>
          <p><strong>Работа:</strong> {row.tender_title || '—'}</p>
          <p><strong>НМЦ:</strong> {formatMoney(row.tender_price)}</p>
          <p><strong>Цена РП без НДС:</strong> {formatMoney(row.work_price_ex_vat)}</p>
          <p><strong>Срок подачи:</strong> {fmtDate(row.docs_deadline)}</p>
          <p><strong>Срок работ:</strong> {row.duration_days != null ? `${row.duration_days} дн.` : '—'}</p>
          <p><strong>РП:</strong> {row.calculator_name || '—'}</p>
        </div>
      )}

      {tab === 'report' && (
        <div style={{ fontSize: 14 }}>
          {!reviewData ? <p className="muted">Загрузка…</p> : (
            <>
              <p><strong>Суть:</strong> {rj.summary || '—'}</p>
              <p><strong>Риски:</strong> {rj.risks || '—'}</p>
              <p><strong>Рекомендация:</strong> {rj.recommendation || '—'}</p>
              <p><strong>Цена с НДС:</strong> {formatMoney(review?.work_price)}</p>
              <p><strong>Себестоимость без НДС:</strong> {formatMoney(rj.cost_without_vat)}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {estimate?.download_url && (
                  <a className="btn mini" href={fileDownloadUrl(estimate.download_url)} target="_blank" rel="noreferrer">Смета</a>
                )}
                {tkp?.download_url && (
                  <a className="btn mini" href={fileDownloadUrl(tkp.download_url)} target="_blank" rel="noreferrer">ТКП</a>
                )}
                {report?.download_url && (
                  <a className="btn mini" href={fileDownloadUrl(report.download_url)} target="_blank" rel="noreferrer">Отчёт</a>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'tz' && (
        <div>
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
        <div>
          <div style={{ maxHeight: '40vh', overflowY: 'auto', marginBottom: 12 }}>
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

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <label className="muted" style={{ fontSize: 12 }}>Комментарий (обязателен при отказе)</label>
        <textarea
          className="inp"
          rows={2}
          style={{ width: '100%', marginTop: 6, marginBottom: 12 }}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button
            type="button"
            className="btn"
            style={{ minHeight: 56, background: 'var(--success)' }}
            disabled={busy}
            onClick={() => decide('submit')}
          >
            <Check size={20} style={{ marginRight: 6 }} /> Подавать
          </button>
          <button
            type="button"
            className="btn ghost"
            style={{ minHeight: 56, color: 'var(--danger)' }}
            disabled={busy}
            onClick={() => decide('reject')}
          >
            <XIcon size={20} style={{ marginRight: 6 }} /> Не подавать
          </button>
        </div>
      </div>
    </BottomSheet>
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
        onClose={() => {
          setOpened(null);
          navigate('/director-tender-approvals', { replace: true });
        }}
        onChanged={fetchData}
      />
    </PageShell>
  );
}
