/**
 * Telephony / Таб «Аналитика» — AI-разборы и DaData-обогащение по звонкам.
 *
 * Источник vanilla: public/assets/js/telephony.js (renderAnalyticsTab) +
 * backend:
 *   POST /api/telephony/calls/:id/analyze (telephony.js:786) — перезапуск ИИ-анализа
 *   GET  /api/telephony/calls              (telephony.js:599) — фильтр по менеджеру,
 *                                                                has_transcript=true
 *   Поля DaData: dadata_region/dadata_operator/dadata_city на call_history
 *   (telephony.js:1338 enrichPhoneData по DADATA_TOKEN).
 *
 *   • Фильтр по менеджеру (если ADMIN/HEAD_PM/директор) — иначе свои.
 *   • Для каждого звонка — бейдж DaData (регион/оператор + название компании,
 *     если customer.name резолвится по client_inn → client_name).
 *   • Кнопка «🧙 Анализ» — POST /calls/:id/analyze (статус queued); рядом
 *     отображается ai_summary / ai_sentiment / ai_lead_data из БД после
 *     фоновой обработки. Если сейчас транскрипт не готов — кнопка дизейблена
 *     с tooltip-объяснением.
 *
 * Никаких заглушек: backend и под analyze, и под DaData — реальный.
 */
import { useEffect, useState, useMemo } from 'react';
import { useModal } from '@/modals';
import { useAuth } from '@/api/useAuth';
import { Btn } from '@/modals/parts';
import { SelectInput, Segmented } from '@/inputs/Inputs';
import { StatusBadge, toast } from '@/modals/Notifications';
import { EmptyState } from '@/blocks/Blocks';
import { CallDetailModal } from '../modals/CallDetailModal';
import { loadCalls, loadManagers, analyzeCall, getDadataFromCall, fmtDateTime, fmtPhone, fmtDuration } from '../api';

const ADMIN_LIKE = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'HEAD_TO'];

function SentimentBadge({ sentiment }) {
  if (!sentiment) return <span className="c-t3 fs-12">—</span>;
  const s = String(sentiment).toLowerCase();
  const tone = s.includes('pos') || s === 'positive' ? 'approved'
             : s.includes('neg') || s === 'negative' ? 'rejected'
             : s.includes('neu') ? 'draft' : 'sent';
  const label = s.includes('pos') ? '😊 позитив'
              : s.includes('neg') ? '😟 негатив'
              : s.includes('neu') ? '😐 нейтрально' : sentiment;
  return <StatusBadge tone={tone} label={label} />;
}

function DadataBadge({ call }) {
  const d = getDadataFromCall(call);
  if (!d) return <span className="c-t3 fs-12">—</span>;
  const parts = [];
  if (d.client_name) parts.push(d.client_name);
  if (d.city || d.region) parts.push([d.city, d.region].filter(Boolean).join(', '));
  if (d.operator) parts.push(d.operator);
  if (!parts.length) return <span className="c-t3 fs-12">—</span>;
  return (
    <div title={parts.join(' · ')} style={{
      display: 'inline-flex', flexDirection: 'column', gap: 1,
      maxWidth: 220, overflow: 'hidden'
    }}>
      {d.client_name && <span className="fw-600 fs-12" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🏢 {d.client_name}</span>}
      {(d.city || d.region) && <span className="c-t3 fs-11" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📍 {[d.city, d.region].filter(Boolean).join(', ')}</span>}
      {d.operator && <span className="c-t3 fs-11" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📡 {d.operator}</span>}
    </div>
  );
}

export default function AnalyticsTab() {
  const { user } = useAuth();
  const modal = useModal();
  const isAdmin = !!user && ADMIN_LIKE.includes(user.role);

  const [filter, setFilter] = useState('with_recording'); // with_recording | analyzed | targets
  const [manager, setManager] = useState('');
  const [managers, setManagers] = useState([]);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState({});

  useEffect(() => {
    if (isAdmin) loadManagers().then(setManagers);
  }, [isAdmin]);

  const refresh = () => {
    setLoading(true);
    const params = { limit: 500 };
    if (manager) params.user_id = manager;
    loadCalls(params).then((items) => {
      setCalls(items);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [manager]);

  const visible = useMemo(() => {
    let v = calls;
    if (filter === 'with_recording') v = v.filter((c) => c.has_recording || c.recording_url || c.recording_id);
    if (filter === 'analyzed') v = v.filter((c) => !!c.ai_summary);
    if (filter === 'targets') v = v.filter((c) => c.ai_is_target === true);
    return v;
  }, [calls, filter]);

  const handleAnalyze = async (call) => {
    if (analyzing[call.id]) return;
    setAnalyzing((s) => ({ ...s, [call.id]: true }));
    try {
      await analyzeCall(call.id);
      toast.success('🧙 Анализ запущен. Результаты появятся в карточке звонка через ~1 минуту');
      // Мягкое обновление через 6с — pipeline.processCall типично 5–20с.
      setTimeout(refresh, 6000);
    } catch (e) {
      const msg = String(e?.message || e || '');
      if (msg.includes('Транскрипт не готов') || /400/.test(msg)) {
        toast.warn('Сначала нужна транскрибация. Откройте карточку звонка → «Транскрибировать»');
      } else {
        toast.error('Не удалось запустить анализ');
      }
    } finally {
      setAnalyzing((s) => { const n = { ...s }; delete n[call.id]; return n; });
    }
  };

  return (
    <div className="col gap-12">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'with_recording', label: '🎵 С записью' },
            { value: 'analyzed', label: '🧙 Проанализированные' },
            { value: 'targets', label: '🎯 Целевые' }
          ]}
          aria-label="Фильтр по типу"
        />
        {isAdmin && managers.length > 0 && (
          <div style={{ minWidth: 220 }}>
            <SelectInput
              value={manager}
              onChange={setManager}
              options={[{ value: '', label: 'Все менеджеры' }, ...managers.map((m) => ({ value: String(m.id), label: m.name }))]}
            />
          </div>
        )}
        <span className="c-t3 fs-12">{visible.length} звонков</span>
        <div style={{ marginLeft: 'auto' }}>
          <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
        </div>
      </div>

      {loading ? (
        <div className="card card-empty">⏳ Загружаем звонки…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="🧙"
          title="Нечего анализировать"
          hint="Поменяйте фильтр или дождитесь записанных звонков"
        />
      ) : (
        <div className="card card-pad-overflow">
          <div className="ov-x-auto">
            <table className="t-list w-full tbl-base">
              <thead>
                <tr className="bg-inner tbl-row-brd">
                  <th className="w-50">#</th>
                  <th className="w-160">Номер</th>
                  <th>DaData / Клиент</th>
                  <th className="w-110">Длит.</th>
                  <th className="w-110">Тональность</th>
                  <th>AI-Summary</th>
                  <th className="w-150">Когда</th>
                  <th className="w-160" style={{ textAlign: 'right' }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const transcriptReady = c.transcript_status === 'done';
                  const hasSummary = !!c.ai_summary;
                  const isTarget = c.ai_is_target === true;
                  return (
                    <tr key={c.id} className="row-hover">
                      <td className="c-t3 fs-12">#{c.id}</td>
                      <td>
                        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, cursor: 'pointer' }}
                             onClick={() => modal.open(<CallDetailModal call={c} />)}>
                          {fmtPhone(c.from_number || c.caller_number)}
                        </div>
                        <div className="c-t3 fs-11">{c.operator_name || c.manager_name || ''}</div>
                      </td>
                      <td><DadataBadge call={c} /></td>
                      <td style={{ fontFamily: 'ui-monospace, monospace' }}>{fmtDuration(c.duration_seconds)}</td>
                      <td><SentimentBadge sentiment={c.ai_sentiment} /></td>
                      <td>
                        {hasSummary ? (
                          <div style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            fontSize: 12.5,
                            color: 'var(--t-2)',
                            maxWidth: 360,
                            cursor: 'pointer'
                          }}
                            title={c.ai_summary}
                            onClick={() => modal.open(<CallDetailModal call={c} />)}>
                            {c.ai_summary}
                          </div>
                        ) : <span className="c-t3 fs-12">— нет анализа —</span>}
                        {isTarget && <div style={{ marginTop: 4 }}><StatusBadge tone="approved" label="🎯 целевой" /></div>}
                      </td>
                      <td className="fs-12 c-t3">{fmtDateTime(c.started_at || c.created_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <Btn
                          size="sm"
                          variant={hasSummary ? 'ghost' : 'primary'}
                          disabled={!transcriptReady || !!analyzing[c.id]}
                          title={!transcriptReady ? 'Нужен готовый транскрипт. Откройте карточку звонка → Транскрибировать' : ''}
                          onClick={() => handleAnalyze(c)}
                        >
                          {analyzing[c.id] ? '⏳ Анализ…' : hasSummary ? '🔄 Переанализ' : '🧙 Анализ'}
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
