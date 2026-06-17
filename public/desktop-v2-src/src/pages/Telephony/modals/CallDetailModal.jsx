/**
 * CallDetailModal — D-54.
 * Источник истины: vanilla telephony.js:1598-1879 (renderDetailBody / renderAiAnalysis /
 * renderTranscript / WaveformPlayer wiring).
 *
 * Блоки:
 *   1. DadataChips     — распознанные ИНН/регион/город/оператор (копируется по клику).
 *   2. Header info     — направление/от/линия/длительность/менеджер/статус транскрипта.
 *   3. WaveformPlayer  — wavesurfer.js (dynamic import — bundle не раздувать).
 *   4. TranscriptViewer— сегменты с MM:SS badge, speaker badge, поиск, auto-scroll.
 *   5. AiAnalyticsBlock— sentiment emoji, summary, key_requirements ☑, извлечённые поля.
 *   6. Actions         — createLead / retranscribe / reanalyze (+ заметка + тег).
 *
 * ВАЖНО: wavesurfer.js — большая зависимость, ОБЯЗАТЕЛЬНО динамический импорт
 * (lazy при наличии recording_url, чтобы не тянуть в общий чанк).
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn, Pill } from '@/modals/parts';
import { Field, TextareaInput, SelectInput, TextInput } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { api } from '@/api/client';
import {
  loadCallDetail, loadRecordingBlobUrl, postCallNote, tagCall, analyzeCall,
  fmtDuration, fmtDateTime, fmtPhone, CALL_OUTCOMES
} from '../api';

/* ─────────────────────────────────────────────────────────────────────────
 *  Локальные справочники (повторяют vanilla telephony.js:22-50, 1809-1812)
 * ──────────────────────────────────────────────────────────────────────── */
const DIR_LABELS = { inbound: 'Входящий', outbound: 'Исходящий', missed: 'Пропущенный', internal: 'Внутренний' };
const DIR_ICONS  = { inbound: '↙', outbound: '↗', missed: '↩', internal: '⇄' };
const SENT_LABEL = { positive: 'Позитивный', neutral: 'Нейтральный', negative: 'Негативный', aggressive: 'Агрессивный' };
const SENT_EMOJI = { positive: '😊', neutral: '😐', negative: '😞', aggressive: '😠' };
const SENT_TONE  = { positive: 'approved', neutral: 'draft', negative: 'rejected', aggressive: 'rejected' };
const URG_LABEL  = { critical: 'Критическая', high: 'Высокая', medium: 'Средняя', low: 'Низкая' };
const URG_TONE   = { critical: 'rejected', high: 'sent', medium: 'draft', low: 'approved' };
const CLASS_LABEL = {
  new_inquiry: 'Новый запрос', repeat_order: 'Повторный', complaint: 'Жалоба',
  warranty_claim: 'Гарантия', information_request: 'Инфо', partnership_proposal: 'Партнёрство',
  supplier_offer: 'Поставщик', spam: 'Спам', wrong_number: 'Ошибка'
};
const WT_LABEL = {
  chemical_cleaning: 'Хим. очистка', hydro_cleaning: 'ГДО', hvac_maintenance: 'ТО ОВКВ',
  hvac_repair: 'Ремонт ОВКВ', hvac_installation: 'Монтаж',
  industrial_service: 'Пром. сервис', consultation: 'Консультация', other: 'Прочее'
};
const STATUS_LABELS = {
  none: '—', pending: 'В очереди', processing: 'Обработка', done: 'Готов', error: 'Ошибка'
};

function parseLeadData(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function parseSegments(raw) {
  if (!raw) return [];
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  return v.map((s, i) => ({
    start: Number(s.start) || 0,
    end:   Number(s.end) || 0,
    speaker: s.speaker != null ? Number(s.speaker) : (i % 2),
    text: String(s.text || '').trim()
  })).filter(s => s.text);
}

/* ─────────────────────────────────────────────────────────────────────────
 *  WaveformPlayer — wavesurfer.js (DYNAMIC import).
 *  Колбэк onTime(sec) — для подсветки текущего сегмента в TranscriptViewer.
 * ──────────────────────────────────────────────────────────────────────── */
function WaveformPlayer({ blobUrl, onTime }) {
  const ref = useRef(null);
  const wsRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!blobUrl || !ref.current) return;
    let cancelled = false;
    let ws = null;
    // Dynamic import — wavesurfer.js не попадает в общий чанк
    import('wavesurfer.js').then(({ default: WaveSurfer }) => {
      if (cancelled || !ref.current) return;
      // Цвета — ТОЛЬКО токены темы (без хардкод-fallback'ов)
      const css = getComputedStyle(document.documentElement);
      const waveColor = css.getPropertyValue('--t-3').trim();
      const progressColor = css.getPropertyValue('--gold').trim();
      const cursorColor = css.getPropertyValue('--gold-l').trim();
      ws = WaveSurfer.create({
        container: ref.current,
        waveColor, progressColor, cursorColor,
        barWidth: 2, barGap: 1, barRadius: 2, height: 60, normalize: true
      });
      wsRef.current = ws;
      ws.load(blobUrl);
      ws.on('ready', () => { if (!cancelled) { setReady(true); setDur(ws.getDuration()); } });
      ws.on('audioprocess', (t) => { if (!cancelled) { setCur(t); onTime && onTime(t); } });
      ws.on('seeking',     (t) => { if (!cancelled) { setCur(t); onTime && onTime(t); } });
      ws.on('play',  () => { if (!cancelled) setPlaying(true); });
      ws.on('pause', () => { if (!cancelled) setPlaying(false); });
      ws.on('finish', () => { if (!cancelled) setPlaying(false); });
      ws.on('error', (e) => { if (!cancelled) setErr(String(e?.message || e)); });
    }).catch((e) => { if (!cancelled) setErr('Не удалось загрузить wavesurfer: ' + (e?.message || e)); });
    return () => { cancelled = true; try { ws && ws.destroy(); } catch {} wsRef.current = null; };
  }, [blobUrl, onTime]);

  const toggle = useCallback(() => {
    const ws = wsRef.current; if (!ws) return;
    ws.isPlaying() ? ws.pause() : ws.play();
  }, []);

  if (err) {
    return (
      <div style={{ padding: 10, background: 'var(--card-bg)', borderRadius: 'var(--r-sm)', border: '1px solid var(--brd-2)' }}>
        <div className="fs-11 c-t3 upper mb-6">🎤 Запись разговора</div>
        <audio controls src={blobUrl} style={{ width: '100%' }} />
        <div className="fs-11" style={{ color: 'var(--err)', marginTop: 6 }}>{err}</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 10, background: 'var(--card-bg)', borderRadius: 'var(--r-sm)', border: '1px solid var(--brd-2)' }}>
      <div className="fs-11 c-t3 upper mb-6">🎤 Запись разговора</div>
      <div ref={ref} style={{ width: '100%', minHeight: 60 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <button
          type="button"
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? 'Пауза' : 'Воспроизвести'}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '1px solid var(--brd-1)', background: 'var(--gold-bg)',
            color: 'var(--gold)', cursor: ready ? 'pointer' : 'not-allowed',
            fontSize: 14
          }}
        >{playing ? '⏸' : '▶'}</button>
        <div className="fs-12 c-t2" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fmtDuration(Math.round(cur))} / {fmtDuration(Math.round(dur))}
        </div>
        {!ready && <div className="fs-11 c-t3">Готовим waveform…</div>}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  TranscriptViewer — сегменты с MM:SS badge, speaker badge, поиск, auto-scroll.
 *  highlightTime — секунда, по которой подсвечиваем активный сегмент (от плеера).
 * ──────────────────────────────────────────────────────────────────────── */
function TranscriptViewer({ segments, highlightTime }) {
  const [q, setQ] = useState('');
  const listRef = useRef(null);
  const activeIdx = useMemo(() => {
    if (highlightTime == null) return -1;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (highlightTime >= s.start && highlightTime <= (s.end || s.start + 5)) return i;
    }
    return -1;
  }, [segments, highlightTime]);

  // Auto-scroll к активному сегменту (если плеер играет) либо к концу при mount/новых сегментах.
  useEffect(() => {
    const c = listRef.current;
    if (!c) return;
    if (activeIdx >= 0) {
      const el = c.querySelector('[data-seg-idx="' + activeIdx + '"]');
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeIdx]);

  useEffect(() => {
    // первый рендер — к концу (как в vanilla)
    const c = listRef.current;
    if (c && segments.length) c.scrollTop = c.scrollHeight;
  }, [segments.length]);

  const ql = q.trim().toLowerCase();
  const filtered = ql ? segments.map((s, i) => ({ s, i })).filter(x => x.s.text.toLowerCase().includes(ql)) : null;

  const copyAll = () => {
    const txt = segments.map(s => (s.speaker === 0 ? 'Менеджер' : 'Клиент') + ' [' + fmtDuration(Math.round(s.start)) + ']: ' + s.text).join('\n');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(txt).then(
        () => toast('Скопировано', '', 'ok'),
        () => toast('Не удалось скопировать', '', 'err')
      );
    }
  };

  const SpeakerBadge = ({ speaker }) => {
    const isAgent = speaker === 0;
    const label = isAgent ? 'Агент' : 'Клиент';
    const dotColor = isAgent ? 'var(--info)' : 'var(--gold)';
    const bg = isAgent ? 'var(--info-bg)' : 'var(--gold-bg)';
    const fg = isAgent ? 'var(--info)' : 'var(--gold)';
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 999, background: bg, color: fg,
        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap'
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor }} />
        {label}
      </span>
    );
  };

  const renderRow = (seg, idx) => {
    const isActive = idx === activeIdx;
    return (
      <div
        key={idx}
        data-seg-idx={idx}
        style={{
          display: 'grid', gridTemplateColumns: '54px 92px 1fr', gap: 8,
          padding: '6px 8px', borderRadius: 'var(--r-sm)',
          background: isActive ? 'var(--gold-bg)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--gold)' : '2px solid transparent',
          marginBottom: 4
        }}
      >
        <span style={{
          fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11,
          color: 'var(--t-3)', alignSelf: 'center'
        }}>{fmtDuration(Math.round(seg.start))}</span>
        <span style={{ alignSelf: 'center' }}><SpeakerBadge speaker={seg.speaker} /></span>
        <span style={{ color: 'var(--t-1)', fontSize: 13, lineHeight: 1.45 }}>{seg.text}</span>
      </div>
    );
  };

  return (
    <div style={{ padding: 10, background: 'var(--card-bg)', borderRadius: 'var(--r-sm)', border: '1px solid var(--brd-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div className="fs-11 c-t3 upper" style={{ flex: 1 }}>📝 Транскрипция · {segments.length} сегментов</div>
        <button
          type="button"
          onClick={copyAll}
          title="Скопировать всю транскрипцию"
          style={{
            padding: '4px 8px', borderRadius: 'var(--r-sm)',
            border: '1px solid var(--brd-1)', background: 'transparent',
            color: 'var(--t-2)', cursor: 'pointer', fontSize: 12
          }}
        >📋 Копировать</button>
      </div>
      <div style={{ marginBottom: 8 }}>
        <TextInput value={q} onChange={setQ} placeholder="Поиск по тексту…" clearable />
      </div>
      <div
        ref={listRef}
        style={{
          maxHeight: 280, overflowY: 'auto',
          background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)', padding: 6
        }}
      >
        {(filtered || segments.map((s, i) => ({ s, i }))).map(({ s, i }) => renderRow(s, i))}
        {filtered && filtered.length === 0 && (
          <div className="fs-12 c-t3" style={{ padding: 10, textAlign: 'center' }}>Совпадений нет</div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  AiAnalyticsBlock — sentiment + summary + key_requirements + поля.
 * ──────────────────────────────────────────────────────────────────────── */
function AiAnalyticsBlock({ call }) {
  const ld = parseLeadData(call.ai_lead_data) || {};
  if (!call.ai_summary && !call.ai_lead_data && !call.ai_sentiment && call.ai_is_target == null) return null;

  const sent = call.ai_sentiment;
  const qs = ld.quality_score != null ? (parseInt(ld.quality_score) || 0) : null;

  return (
    <div style={{ padding: 10, background: 'var(--card-bg)', borderRadius: 'var(--r-sm)', border: '1px solid var(--brd-2)' }}>
      <div className="fs-11 c-t3 upper mb-6">🤖 ИИ-анализ</div>

      {/* sentiment + tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {sent && (
          <Pill tone={SENT_TONE[sent] || 'default'}>
            {SENT_EMOJI[sent] || ''} {SENT_LABEL[sent] || sent}
          </Pill>
        )}
        {call.ai_is_target != null && (
          <Pill tone={call.ai_is_target ? 'approved' : 'rejected'}>
            {call.ai_is_target ? '🎯 Целевой' : '✗ Нецелевой'}
          </Pill>
        )}
        {ld.classification && <Pill tone="default">{CLASS_LABEL[ld.classification] || ld.classification}</Pill>}
        {ld.urgency && <Pill tone={URG_TONE[ld.urgency] || 'default'}>⚡ {URG_LABEL[ld.urgency] || ld.urgency}</Pill>}
      </div>

      {/* summary */}
      {call.ai_summary && (
        <div style={{
          padding: 8, background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)',
          fontSize: 13, color: 'var(--t-1)', lineHeight: 1.5, marginBottom: 8,
          whiteSpace: 'pre-wrap'
        }}>{call.ai_summary}</div>
      )}

      {/* key_requirements — список с галочками */}
      {Array.isArray(ld.key_requirements) && ld.key_requirements.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div className="fs-11 c-t3 upper mb-6">Ключевые требования</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {ld.key_requirements.map((r, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, padding: '4px 0', color: 'var(--t-1)', fontSize: 13 }}>
                <span style={{ color: 'var(--ok)', flex: '0 0 16px' }}>✓</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* извлечённые поля */}
      {(ld.company_name || ld.contact_person || ld.work_type || ld.object_description || ld.location) && (
        <div style={{ marginBottom: 8 }}>
          <div className="fs-11 c-t3 upper mb-6">Извлечённые данные</div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px 10px', fontSize: 13 }}>
            {ld.company_name      && (<><span className="c-t3">Компания</span><span className="c-t1">{ld.company_name}</span></>)}
            {ld.contact_person    && (<><span className="c-t3">Контакт</span><span className="c-t1">{ld.contact_person}</span></>)}
            {ld.contact_phone     && (<><span className="c-t3">Телефон</span><span className="c-t1">{ld.contact_phone}</span></>)}
            {ld.contact_email     && (<><span className="c-t3">Email</span><span className="c-t1">{ld.contact_email}</span></>)}
            {ld.work_type         && (<><span className="c-t3">Тип работ</span><span className="c-t1">{WT_LABEL[ld.work_type] || ld.work_type}</span></>)}
            {ld.object_description&& (<><span className="c-t3">Объект</span><span className="c-t1">{ld.object_description}</span></>)}
            {ld.location          && (<><span className="c-t3">Адрес</span><span className="c-t1">{ld.location}</span></>)}
            {ld.desired_timeline  && (<><span className="c-t3">Сроки</span><span className="c-t1">{ld.desired_timeline}</span></>)}
            {ld.estimated_volume  && (<><span className="c-t3">Объём</span><span className="c-t1">{ld.estimated_volume}</span></>)}
            {ld.source            && (<><span className="c-t3">Источник</span><span className="c-t1">{ld.source}</span></>)}
          </div>
        </div>
      )}

      {/* next_steps */}
      {Array.isArray(ld.next_steps) && ld.next_steps.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div className="fs-11 c-t3 upper mb-6">Рекомендации</div>
          <ul style={{ paddingLeft: 18, margin: 0, color: 'var(--t-1)', fontSize: 13 }}>
            {ld.next_steps.map((s, i) => <li key={i} style={{ marginBottom: 2 }}>{s}</li>)}
          </ul>
        </div>
      )}

      {/* quality_score */}
      {qs != null && (
        <div>
          <div className="fs-11 c-t3 upper mb-6">Качество разговора: {qs}/10</div>
          <div style={{ height: 6, background: 'var(--bg-4)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: (qs * 10) + '%', height: '100%',
              background: qs >= 8 ? 'var(--ok)' : qs >= 5 ? 'var(--amber)' : 'var(--err)'
            }} />
          </div>
          {ld.quality_notes && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--t-3)' }}>{ld.quality_notes}</div>}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  DadataChips — ИНН/ОГРН/название/регион/город/оператор, клик = копия.
 * ──────────────────────────────────────────────────────────────────────── */
function DadataChips({ call }) {
  const ld = parseLeadData(call.ai_lead_data) || {};
  const items = [];
  if (call.dadata_region)   items.push({ icon: '🏔', label: 'Регион',   v: call.dadata_region });
  if (call.dadata_city)     items.push({ icon: '🏙', label: 'Город',    v: call.dadata_city });
  if (call.dadata_operator) items.push({ icon: '📶', label: 'Оператор', v: call.dadata_operator });
  if (ld.inn      || call.client_inn)      items.push({ icon: '🆔', label: 'ИНН',  v: ld.inn || call.client_inn });
  if (ld.ogrn     || call.client_ogrn)     items.push({ icon: '🏛', label: 'ОГРН', v: ld.ogrn || call.client_ogrn });
  if (ld.company_name || call.client_name) items.push({ icon: '🏢', label: 'Клиент', v: ld.company_name || call.client_name });
  if (!items.length) return null;

  const copy = (v) => {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(String(v)).then(
      () => toast('Скопировано', String(v), 'ok'),
      () => toast('Не удалось', '', 'err')
    );
  };

  return (
    <div style={{ padding: 10, background: 'var(--card-bg)', borderRadius: 'var(--r-sm)', border: '1px solid var(--brd-2)' }}>
      <div className="fs-11 c-t3 upper mb-6">🔎 Данные клиента</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((it, i) => (
          <button
            key={i}
            type="button"
            onClick={() => copy(it.v)}
            title={'Скопировать ' + it.label}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 999,
              background: 'var(--inner-bg)', border: '1px solid var(--brd-2)',
              color: 'var(--t-1)', cursor: 'pointer', fontSize: 12
            }}
          >
            <span aria-hidden="true">{it.icon}</span>
            <span className="c-t3">{it.label}:</span>
            <strong>{it.v}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  Главный компонент.
 * ──────────────────────────────────────────────────────────────────────── */
export function CallDetailModal({ call: callProp }) {
  const { close } = useModal();
  const [call, setCall] = useState(callProp);
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState(callProp.outcome || '');
  const [busy, setBusy] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [playerTime, setPlayerTime] = useState(null);
  const [leadCreated, setLeadCreated] = useState(!!callProp.lead_id);
  const [retranBusy, setRetranBusy] = useState(false);
  const [reanBusy, setReanBusy] = useState(false);

  /* Обновляем call деталями с сервера. */
  useEffect(() => {
    if (callProp?.id) {
      loadCallDetail(callProp.id).then((d) => {
        if (d) {
          setCall(d);
          setLeadCreated(!!d.lead_id);
        }
      });
    }
  }, [callProp?.id]);

  /* Запись звонка — blob+Authorization (токен НЕ в URL). */
  useEffect(() => {
    if (!call?.id) return;
    if (!(call.has_recording || call.recording_url || call.record_path || call.recording_id)) return;
    let cancelled = false;
    let url = '';
    loadRecordingBlobUrl(call.id)
      .then((u) => { if (cancelled) URL.revokeObjectURL(u); else { url = u; setRecordingUrl(u); } })
      .catch(() => { /* запись недоступна */ });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [call?.id, call?.has_recording, call?.recording_url, call?.record_path, call?.recording_id]);

  const segments = useMemo(() => parseSegments(call.transcript_segments), [call.transcript_segments]);
  const hasRecording = !!(call.has_recording || call.recording_url || call.record_path || call.recording_id);
  const dir = call.call_type || call.type || 'missed';

  const saveNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await postCallNote(call.id, { note });
      setNote('');
      toast('Заметка сохранена', '', 'ok');
      setCall({ ...call, notes: [...(call.notes || []), { note, created_at: new Date().toISOString() }] });
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const saveTag = async (newOutcome) => {
    setOutcome(newOutcome);
    try {
      await tagCall(call.id, { outcome: newOutcome });
      toast('Тег сохранён', '', 'ok');
      setCall({ ...call, outcome: newOutcome });
    } catch (e) {
      toast('Ошибка', String(e?.message || e), 'err');
    }
  };

  /* Actions (vanilla telephony.js:1747-1798): createLead/retranscribe/reanalyze. */
  const createLead = async () => {
    if (leadCreated) return;
    try {
      const res = await api(`/api/telephony/calls/${call.id}/create-lead`, { method: 'POST', body: {} });
      setLeadCreated(true);
      if (res?.lead_id) setCall({ ...call, lead_id: res.lead_id });
      toast('Заявка создана', '', 'ok');
    } catch (e) {
      toast('Ошибка создания заявки', String(e?.message || e), 'err');
    }
  };

  const retranscribe = async () => {
    setRetranBusy(true);
    try {
      const res = await api(`/api/telephony/calls/${call.id}/transcribe`, { method: 'POST', body: {} });
      toast(res?.message || 'Транскрибация запущена', '', 'ok');
      setCall({ ...call, transcript_status: 'pending', transcript: null, transcript_segments: null });
    } catch (e) {
      toast(String(e?.message || e), '', 'err');
    } finally {
      setRetranBusy(false);
    }
  };

  const reanalyze = async () => {
    setReanBusy(true);
    try {
      const res = await analyzeCall(call.id);
      toast(res?.message || 'ИИ-анализ запущен', '', 'ok');
      setCall({ ...call, ai_summary: null, ai_lead_data: null, ai_sentiment: null, ai_is_target: null });
    } catch (e) {
      toast(String(e?.message || e), '', 'err');
    } finally {
      setReanBusy(false);
    }
  };

  return (
    <MCard className="modal-lg">
      <MHead
        icon="📞"
        title={`Звонок #${call.id}`}
        subtitle={fmtPhone(call.from_number) + ' → ' + fmtPhone(call.to_number || call.line_number)}
        onClose={close}
      />
      <MBody>
        <div className="col gap-10">

          <DadataChips call={call} />

          {/* Header info */}
          <div style={{ padding: 10, background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '4px 10px' }}>
              <span className="c-t3">Направление</span>
              <span className="c-t1">{DIR_ICONS[dir] || ''} {DIR_LABELS[dir] || dir}</span>
              <span className="c-t3">От</span>
              <span className="c-t1">{fmtPhone(call.from_number)}</span>
              <span className="c-t3">Линия</span>
              <span className="c-t1">{fmtPhone(call.line_number || call.to_number)}</span>
              <span className="c-t3">Длительность</span>
              <span className="c-t1">{fmtDuration(call.duration_seconds)}</span>
              <span className="c-t3">Дата/время</span>
              <span className="c-t1">{fmtDateTime(call.started_at || call.created_at)}</span>
              {call.manager_name && (<><span className="c-t3">Менеджер</span><span className="c-t1">{call.manager_name}</span></>)}
              <span className="c-t3">Транскрипт</span>
              <span className="c-t1">{STATUS_LABELS[call.transcript_status] || '—'}</span>
            </div>
          </div>

          {/* Waveform player (dynamic wavesurfer.js) */}
          {hasRecording && recordingUrl && (
            <WaveformPlayer blobUrl={recordingUrl} onTime={setPlayerTime} />
          )}
          {hasRecording && !recordingUrl && (
            <div style={{ padding: 10, background: 'var(--card-bg)', borderRadius: 'var(--r-sm)', border: '1px solid var(--brd-2)' }}>
              <div className="fs-11 c-t3 upper mb-6">🎤 Запись разговора</div>
              <div className="c-t3 fs-12">Загружаем запись…</div>
            </div>
          )}

          {/* Transcript viewer (если есть сегменты) */}
          {segments.length > 0 && (
            <TranscriptViewer segments={segments} highlightTime={playerTime} />
          )}

          {/* Plain transcript fallback (если только string) */}
          {segments.length === 0 && call.transcript && (
            <div style={{ padding: 10, background: 'var(--card-bg)', borderRadius: 'var(--r-sm)', border: '1px solid var(--brd-2)' }}>
              <div className="fs-11 c-t3 upper mb-6">📝 Транскрипция</div>
              <div style={{
                whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5,
                color: 'var(--t-1)', background: 'var(--inner-bg)',
                padding: 10, borderRadius: 'var(--r-sm)', maxHeight: 260, overflowY: 'auto'
              }}>{call.transcript}</div>
            </div>
          )}

          {/* AI analytics block */}
          <AiAnalyticsBlock call={call} />

          {/* Action buttons (createLead / retranscribe / reanalyze) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {call.ai_is_target && !leadCreated && (
              <Btn variant="primary" onClick={createLead}>📋 Создать заявку</Btn>
            )}
            {leadCreated && (
              <Pill tone="approved">✓ Заявка{call.lead_id ? ' #' + call.lead_id : ''} создана</Pill>
            )}
            {hasRecording && (
              <Btn onClick={retranscribe} disabled={retranBusy}>{retranBusy ? 'Запущено…' : '🔄 Перетранскрибировать'}</Btn>
            )}
            {call.transcript && (
              <Btn onClick={reanalyze} disabled={reanBusy}>{reanBusy ? 'Запущено…' : '🤖 Переанализировать'}</Btn>
            )}
          </div>

          {/* Outcome tag */}
          <Field label="Тег результата">
            <SelectInput
              value={outcome}
              onChange={saveTag}
              options={[{ value: '', label: '— не задан —' }, ...CALL_OUTCOMES]}
            />
          </Field>

          {/* Notes log */}
          {(call.notes || []).length > 0 && (
            <div style={{ padding: 10, background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)' }}>
              <div className="fs-11 c-t3 upper mb-6">💬 Заметки ({call.notes.length})</div>
              {call.notes.map((n, i) => (
                <div key={i} style={{
                  padding: 6, marginBottom: 4, background: 'var(--card-bg)',
                  borderRadius: 'var(--r-sm)', fontSize: 12.5
                }}>
                  <div className="fs-10 c-t3">{fmtDateTime(n.created_at)}</div>
                  <div className="u-prewrap">{n.note}</div>
                </div>
              ))}
            </div>
          )}

          <Field label="Добавить заметку">
            <TextareaInput value={note} onChange={setNote} minRows={2} maxRows={4} placeholder="О чём договорились" />
          </Field>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Закрыть</Btn>
        <Btn variant="primary" disabled={busy || !note.trim()} onClick={saveNote}>
          {busy ? 'Сохраняем…' : '💬 Сохранить заметку'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
