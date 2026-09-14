/**
 * RpReviewModal — structured report (analysis / calc) + TO decision panel
 * Parity: public/assets/js/rp_review_modal.js + rp-review-modal.css
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { MCard, MHead, MBody, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import {
  loadRpReview, saveRpReview, saveRpMyDraft, importRpDraft, mimirApplyRpReview,
  inviteRpCollaborator, revokeRpCollaborator, uploadRpEstimate, uploadRpReport, uploadRpTkp,
  uploadRpDraftFile,
  toDecisionRpReview, directorDecisionRpReview, archiveRegistryRow,
  fmtRegistryDate
} from '../api';
import {
  MISSING_FLAGS, REJECT_PRESETS, LOG_LABELS, REJECT_TEMPLATE,
  FEASIBILITY_OPTS, COMPETITION_OPTS,
  parseRj, fmtMoney, feasibilityLabel, competitionLabel, rejectPresetLabel,
  priceRangeLabel, progressPct, leadSubtitle, getAnalysisSnapshot
} from './rpReviewHelpers';
import RpReviewThread from './RpReviewThread';
import TenderDocsReadOnly from './TenderDocsReadOnly';

import '../../../../../assets/css/rp-review-modal.css';

const TABS = [
  { id: 'report', label: 'Отчёт' },
  { id: 'tender', label: 'Тендер' },
  { id: 'history', label: 'История' },
  { id: 'team', label: 'Команда' },
  { id: 'thread', label: 'Вопросы' }
];

function Ro({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="rp-review-ro">
      {label ? <div className="lbl">{label}</div> : null}
      <div>{value}</div>
    </div>
  );
}

function Seg({ options, value, disabled, onChange }) {
  return (
    <div className="rp-review-seg">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={value === o.id ? 'on' : ''}
          disabled={disabled}
          onClick={() => onChange(o.id)}
        >{o.label}</button>
      ))}
    </div>
  );
}

function Section({ id, title, collapsed, onToggle, children }) {
  return (
    <div className={'rp-review-section' + (collapsed ? ' collapsed' : '')}>
      <button type="button" className="rp-review-section-head" onClick={() => onToggle(id)}>
        {title}
        <span className="rp-section-chevron">{collapsed ? '▶' : '▼'}</span>
      </button>
      <div className="rp-review-section-body">{children}</div>
    </div>
  );
}

function HeaderBadges({ review, mode, isLocked }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {review?.director_review_status === 'pending' && (
        <span className="rp-review-badge" style={{ background: '#7c2d12', color: '#fdba74' }}>Согласование директора</span>
      )}
      {review?.director_review_status === 'approved' && (
        <span className="rp-review-badge" style={{ background: 'var(--ok-bg)', color: 'var(--ok-t)' }}>Цена согласована</span>
      )}
      {review?.director_review_status === 'rejected' && (
        <span className="rp-review-badge reject">Отклонено директором</span>
      )}
      {review?.is_final && <span className="rp-review-badge final">Готов</span>}
      {!review?.is_final && review?.analysis_finalized_at && mode === 'calc' && (
        <span className="rp-review-badge" style={{ background: '#1e3a5f', color: '#93c5fd' }}>Анализ закрыт</span>
      )}
      {!review?.is_final && !review?.analysis_finalized_at && !isLocked && (
        <span className="rp-review-badge draft">Черновик</span>
      )}
      <span className={'rp-review-badge mode-' + (mode === 'calc' ? 'calc' : 'analysis')}>
        {mode === 'calc' ? 'Полный просчёт' : 'Быстрый анализ'}
      </span>
    </div>
  );
}

function MetaBar({ tender, review }) {
  const score = tender.score?.win_chance_pct;
  const calcName = review?.finalized_by_name || review?.analysis_finalized_by_name
    || tender.calculator_user_name || review?.calculator_name;
  return (
    <div className="rp-review-meta">
      <span>НМЦ <strong>{fmtMoney(tender.tender_price)}</strong></span>
      <span>Срок <strong>{fmtRegistryDate(tender.docs_deadline)}</strong></span>
      {score != null && <span>Скор <strong>{score}%</strong></span>}
      {calcName && <span>Считает <strong>{calcName}</strong></span>}
      {tender.registry_status && <span>Статус <strong>{tender.registry_status}</strong></span>}
      {tender.purchase_url && (
        <span>
          <a href={tender.purchase_url} target="_blank" rel="noopener noreferrer">↗ Закупка</a>
        </span>
      )}
    </div>
  );
}

function TenderToDocsBlock({ tenderId }) {
  if (!tenderId) return null;
  return <TenderDocsReadOnly tenderId={tenderId} title="Документы ТО (ТЗ и прочее)" />;
}

function ReadonlySummary({ review, rj, workPrice }) {
  const dec = review?.decision;
  const cls = dec === 'submit' ? 'submit' : (dec === 'reject' ? 'reject' : '');
  const label = dec === 'submit' ? '✓ Подаём' : (dec === 'reject' ? '✕ Не подаём' : 'Ожидает решения');
  const priceTxt = priceRangeLabel(rj, workPrice);
  return (
    <div className={'rp-review-summary-card ' + cls}>
      <strong>{label}</strong>
      {dec === 'submit' && priceTxt !== '—' && <> · {priceTxt}</>}
      {rj.recommendation && <p style={{ margin: '8px 0 0', fontSize: 13 }}>{rj.recommendation}</p>}
    </div>
  );
}

function DecisionCards({ decision, disabled, onSelect }) {
  if (disabled) return null;
  return (
    <div className="rp-review-decision-row">
      <button
        type="button"
        className={'rp-review-decision-card' + (decision === 'submit' ? ' selected submit' : '')}
        onClick={() => onSelect('submit')}
      >
        <div className="rp-dec-icon">✓</div>
        <div className="rp-dec-title">Подаём</div>
        <div className="rp-dec-hint">Рекомендуем участие</div>
      </button>
      <button
        type="button"
        className={'rp-review-decision-card' + (decision === 'reject' ? ' selected reject' : '')}
        onClick={() => onSelect('reject')}
      >
        <div className="rp-dec-icon">✕</div>
        <div className="rp-dec-title">Не подаём</div>
        <div className="rp-dec-hint">С указанием причин</div>
      </button>
    </div>
  );
}

function AnalysisRefBlock({ snap, missingFlags }) {
  if (!snap) return null;
  const dec = snap.decision;
  const cls = dec === 'submit' ? 'submit' : (dec === 'reject' ? 'reject' : '');
  const label = dec === 'submit' ? '✓ Подаём' : (dec === 'reject' ? '✕ Не подаём' : '—');
  const who = snap.finalized_by_name || 'дежурный РП';
  const when = snap.finalized_at
    ? new Date(snap.finalized_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';
  const pr = priceRangeLabel(snap, null);
  const missLabels = MISSING_FLAGS.filter((f) => missingFlags.includes(f.id)).map((f) => f.label);
  return (
    <div className="rp-review-analysis-ref">
      <div className="rp-review-analysis-ref-head">
        <strong>Анализ дежурного РП</strong>
        <span className="muted">{who}{when ? ' · ' + when : ''}</span>
      </div>
      <div className={'rp-review-summary-card ' + cls} style={{ margin: '0 0 10px' }}>
        <strong>{label}</strong>
        {dec === 'submit' && pr !== '—' && <> · {pr}</>}
      </div>
      <Ro label="Выполнимость" value={feasibilityLabel(snap.feasibility)} />
      <Ro label="Конкуренция" value={competitionLabel(snap.competition)} />
      <Ro label="Суть для ТО" value={snap.summary} />
      <Ro label="Риски" value={snap.risks} />
      <Ro label="Рекомендация" value={snap.recommendation} />
      {missLabels.length > 0 && <Ro label="Не хватает данных" value={missLabels.join(', ')} />}
    </div>
  );
}

function MissingChips({ selected, disabled, onToggle }) {
  return (
    <div className="rp-review-chips">
      {MISSING_FLAGS.map((f) => (
        <button
          key={f.id}
          type="button"
          className={'rp-review-chip' + (selected.includes(f.id) ? ' on' : '')}
          disabled={disabled}
          onClick={() => onToggle(f.id)}
        >{f.label}</button>
      ))}
    </div>
  );
}

export default function RpReviewModal({
  tender,
  pms = [],
  onClose,
  onSaved,
  readOnly = false,
  mode: modeProp = 'calc',
  role = '',
  initialTab = 'report'
}) {
  const isTo = role === 'to';
  const isDirector = role === 'director';
  const isViewer = role === 'viewer';
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(initialTab || 'report');
  const [threadUnread, setThreadUnread] = useState(0);
  const [review, setReview] = useState(null);
  const [logs, setLogs] = useState([]);
  const [collabs, setCollabs] = useState([]);
  const [estimateFile, setEstimateFile] = useState(null);
  const [reportFile, setReportFile] = useState(null);
  const [tkpFile, setTkpFile] = useState(null);
  const [decision, setDecision] = useState('submit');
  const [reportKind, setReportKind] = useState('work');
  const [reportJson, setReportJson] = useState(() => parseRj(null, modeProp));
  const [workPrice, setWorkPrice] = useState('');
  const [missingFlags, setMissingFlags] = useState([]);
  const [collapsed, setCollapsed] = useState({});
  const [invitePm, setInvitePm] = useState('');
  const [toComment, setToComment] = useState('');
  const [dirComment, setDirComment] = useState('');
  const [mode, setMode] = useState(modeProp);
  const [locked, setLocked] = useState(readOnly || role === 'viewer');
  const [analysisSnapshot, setAnalysisSnapshot] = useState(null);
  const [isFinalOwner, setIsFinalOwner] = useState(true);
  const [isRealFinalOwner, setIsRealFinalOwner] = useState(true);
  const [canFinalize, setCanFinalize] = useState(true);
  const [finalOwnerName, setFinalOwnerName] = useState('');
  const [finalOwnerUserId, setFinalOwnerUserId] = useState(null);
  const [myDraft, setMyDraft] = useState(null);
  const [teamDrafts, setTeamDrafts] = useState([]);
  const [teamSummary, setTeamSummary] = useState(null);
  const [editingParticipantDraft, setEditingParticipantDraft] = useState(false);

  const patchRj = useCallback((patch) => {
    setReportJson((rj) => ({ ...rj, ...patch }));
  }, []);

  useEffect(() => {
    if (!tender?.id) return;
    setLoading(true);
    loadRpReview(tender.id).then((d) => {
      const rev = d.review;
      setReview(rev);
      setLogs(d.logs || []);
      setCollabs(d.collaborators || []);
      setEstimateFile(d.estimate_file || null);
      setReportFile(d.report_file || null);
      setTkpFile(d.tkp_file || null);
      setThreadUnread(d.thread_unread || 0);
      setIsFinalOwner(d.is_final_owner !== false);
      setIsRealFinalOwner(
        d.is_real_final_owner != null
          ? !!d.is_real_final_owner
          : (!d.final_owner_user_id || Number(d.final_owner_user_id) === Number(JSON.parse(localStorage.getItem('asgard_user') || '{}').id || 0))
      );
      setCanFinalize(!!d.can_finalize);
      setFinalOwnerName(d.final_owner_name || '');
      setFinalOwnerUserId(d.final_owner_user_id != null ? Number(d.final_owner_user_id) : null);
      setMyDraft(d.my_draft || null);
      setTeamDrafts(d.team_drafts || []);
      setTeamSummary(d.team_summary || null);
      const snap = getAnalysisSnapshot(rev?.report_json, rev, d.analysis_snapshot);
      setAnalysisSnapshot(snap);
      let dec = rev?.decision && rev.decision !== 'pending' ? rev.decision : 'submit';
      const m = modeProp != null ? modeProp : (parseRj(rev?.report_json, 'calc').mode || 'calc');
      if (snap?.decision && m === 'calc') {
        dec = snap.decision === 'reject' ? 'reject' : 'submit';
      }
      setDecision(dec);
      setReportKind(rev?.report_kind || (dec === 'reject' ? 'reject' : 'work'));
      setMode(m);
      const isLocked = readOnly || isViewer || !!rev?.is_final;
      setLocked(isLocked);
      const asCollab = !isLocked && !isTo && !isDirector && !isViewer && d.is_final_owner === false;
      setEditingParticipantDraft(asCollab);
      if (asCollab && d.my_draft?.draft_json) {
        setReportJson(parseRj(d.my_draft.draft_json, m));
        if (d.my_draft.estimate_file) setEstimateFile(d.my_draft.estimate_file);
        if (d.my_draft.report_file) setReportFile(d.my_draft.report_file);
        if (d.my_draft.tkp_file) setTkpFile(d.my_draft.tkp_file);
        if (d.my_draft.draft_json.work_price != null) setWorkPrice(d.my_draft.draft_json.work_price);
      } else {
        setReportJson(parseRj(rev?.report_json, m));
        setWorkPrice(rev?.work_price ?? '');
      }
      setMissingFlags(Array.isArray(rev?.missing_info_flags) ? [...rev.missing_info_flags] : []);
    }).catch((e) => toast(e.message || 'Сбой', null, 'err'))
      .finally(() => setLoading(false));
  }, [tender?.id, modeProp, readOnly, isTo, isDirector, isViewer]);

  const toggleSec = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  const onDecisionSelect = (dec) => {
    setDecision(dec);
    setReportKind(dec === 'reject' ? 'reject' : 'work');
    if (dec === 'reject' && !(reportJson.points || []).length) {
      patchRj({ points: [...REJECT_TEMPLATE] });
    }
  };

  const toggleFlag = (id) => {
    setMissingFlags((flags) => (
      flags.includes(id) ? flags.filter((f) => f !== id) : [...flags, id]
    ));
  };

  const collectPayload = (finalize, overrideAsAdmin) => {
    const body = {
      decision,
      report_kind: reportKind,
      report_json: { ...reportJson, mode },
      missing_info_flags: missingFlags,
      work_price: workPrice ? Number(workPrice) : null,
      finalize: !!finalize,
      expected_updated_at: review?.updated_at || null
    };
    if (overrideAsAdmin) body.override_as_admin = true;
    return body;
  };

  const confirmAdminOverrideIfNeeded = (finalize) => {
    let uid = 0;
    try { uid = Number(JSON.parse(localStorage.getItem('asgard_user') || '{}').id) || 0; } catch { /* ignore */ }
    const ownerId = finalOwnerUserId ? Number(finalOwnerUserId) : null;
    if (!ownerId || !uid || ownerId === uid || isRealFinalOwner || !isFinalOwner) {
      return { ok: true, override: false };
    }
    const who = finalOwnerName || `#${ownerId}`;
    const msg = finalize
      ? `Вы не хозяин фазы (${who}). Закрыть финал от его имени?`
      : `Вы не хозяин фазы (${who}). Перезаписать финальный отчёт?`;
    return { ok: window.confirm(msg), override: true };
  };

  const save = async (finalize = false, draftReady = false) => {
    if (editingParticipantDraft) {
      try {
        const d = await saveRpMyDraft(tender.id, {
          phase: mode === 'calc' ? 'calc' : 'analysis',
          draft_json: reportJson,
          status: draftReady ? 'ready' : 'working',
          expected_updated_at: myDraft?.updated_at
        });
        setMyDraft(d.draft || myDraft);
        toast(draftReady ? 'Готово — ответственный РП уведомлён' : 'Черновик сохранён', null, 'ok');
        onSaved?.();
      } catch (e) {
        toast(e.message || 'Ошибка сохранения', null, 'err');
      }
      return;
    }
    if (finalize && decision !== 'submit' && decision !== 'reject') {
      toast('Выберите решение: Подаём или Не подаём', null, 'err');
      return;
    }
    if (finalize && mode === 'analysis' && decision === 'submit') {
      if (!String(reportJson.summary || '').trim()) {
        toast('Для закрытия укажите «Суть для ТО»', null, 'err');
        return;
      }
      if (!reportJson.feasibility) {
        toast('Укажите выполнимость (да / условно / нет)', null, 'err');
        return;
      }
    }
    if (finalize && mode === 'analysis' && decision === 'reject') {
      const points = reportJson.points || [];
      const hasReason = points.some((p) => String(p.point || '').trim() || String(p.reason || '').trim())
        || String(reportJson.reject_preset || '').trim();
      if (!hasReason) {
        toast('Укажите причину «Не подаём» (категория или пункт)', null, 'err');
        return;
      }
    }
    if (finalize && mode === 'calc' && decision === 'submit' && !tkpFile) {
      toast('Приложите ТКП к отчёту просчёта', null, 'err');
      return;
    }
    if (finalize) {
      const isAnalysis = mode === 'analysis';
      const msg = isAnalysis
        ? 'Закрыть анализ?\n\nПосле закрытия вы больше не сможете его править — анализ уйдёт ТО.\n\nЧтобы просто выйти со страницы — нажмите крестик, не эту кнопку.'
        : 'Закрыть отчёт?\n\nПосле закрытия вы больше не сможете его править.\n\nЧтобы просто выйти — нажмите крестик, не эту кнопку.';
      if (!window.confirm(msg)) return;
    }
    const ov = confirmAdminOverrideIfNeeded(finalize);
    if (!ov.ok) return;
    saveRpReview(tender.id, collectPayload(finalize, ov.override)).then((d) => {
      setReview(d.review);
      toast(finalize ? (mode === 'analysis' ? 'Анализ закрыт' : 'Отчёт закрыт') : 'Сохранено', null, 'ok');
      onSaved?.();
      if (finalize) onClose?.();
    }).catch((e) => {
      const msg = e.message || 'Ошибка сохранения';
      toast(msg, null, 'err');
      if (/изменился|REVIEW_CONFLICT|конфликт/i.test(msg)) {
        loadRpReview(tender.id).then((d) => {
          if (d.review) setReview(d.review);
          if (d.logs) setLogs(d.logs);
          toast('Форма обновлена с сервера — проверьте и сохраните снова', null, 'ok');
        }).catch(() => {});
      }
    });
  };

  const openMimir = () => {
    if (typeof window !== 'undefined' && window.AsgardMimirQuick?.openForRpReview) {
      window.AsgardMimirQuick.openForRpReview({
        tenderId: tender.id,
        phase: mode === 'calc' ? 'calc' : 'analysis',
        tender,
        isFinalOwner: isFinalOwner && !editingParticipantDraft,
        onApplied: (result) => {
          if (result.field_patch) patchRj(result.field_patch);
          if (result.work_price != null) setWorkPrice(result.work_price);
          if (result.estimate_file && !editingParticipantDraft) setEstimateFile(result.estimate_file);
          if (result.report_file && !editingParticipantDraft) setReportFile(result.report_file);
          if (result.draft) setMyDraft(result.draft);
          if (result.review) {
            setReview(result.review);
            setReportJson(parseRj(result.review.report_json, mode));
            setWorkPrice(result.review.work_price ?? '');
          }
          toast('Мимир применён к форме', null, 'ok');
          onSaved?.();
        }
      });
      return;
    }
    toast('Мимир-Quick загружается из shell — обновите страницу или откройте через vanilla', null, 'err');
  };

  const invite = () => {
    if (!invitePm) return;
    inviteRpCollaborator(tender.id, Number(invitePm)).then(() => {
      toast('РП привлечён к совместной работе', null, 'ok');
      return loadRpReview(tender.id);
    }).then((d) => {
      setCollabs(d.collaborators || []);
      setTeamDrafts(d.team_drafts || []);
      setTeamSummary(d.team_summary || null);
    }).catch((e) => toast(e.message || 'Сбой', null, 'err'));
  };

  const revokeCollab = (pmId) => {
    if (!window.confirm('Отозвать привлечение РП?')) return;
    revokeRpCollaborator(tender.id, pmId).then(() => loadRpReview(tender.id)).then((d) => {
      setCollabs(d.collaborators || []);
      setTeamDrafts(d.team_drafts || []);
      toast('Привлечение отозвано', null, 'ok');
    }).catch((e) => toast(e.message || 'Сбой', null, 'err'));
  };

  const importDraft = (draftId, includeFiles) => {
    const ok = window.confirm(
      includeFiles
        ? 'Заменить поля финала и вложения черновиком коллеги?'
        : 'Заменить только поля финала черновиком коллеги?'
    );
    if (!ok) return;
    importRpDraft(tender.id, { draft_id: draftId, include_files: includeFiles }).then(async () => {
      const full = await loadRpReview(tender.id);
      setReview(full.review);
      setReportJson(parseRj(full.review?.report_json, mode));
      setWorkPrice(full.review?.work_price ?? '');
      setEstimateFile(full.estimate_file || null);
      setReportFile(full.report_file || null);
      setTkpFile(full.tkp_file || null);
      setTeamDrafts(full.team_drafts || []);
      setTab('report');
      toast('Черновик взят в финал', null, 'ok');
    }).catch((e) => toast(e.message || 'Сбой', null, 'err'));
  };

  const onEstimate = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const phase = mode === 'calc' ? 'calc' : 'analysis';
    const p = editingParticipantDraft
      ? uploadRpDraftFile(tender.id, 'estimate', file, phase)
      : uploadRpEstimate(tender.id, file);
    p.then((d) => {
      if (editingParticipantDraft && d.draft) {
        setMyDraft(d.draft);
        setEstimateFile(d.draft.estimate_file || d.file || null);
      } else {
        setEstimateFile(d.estimate_file || null);
      }
      toast('Смета прикреплена', null, 'ok');
    }).catch((err) => toast(err.message, null, 'err'));
  };

  const onReport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const phase = mode === 'calc' ? 'calc' : 'analysis';
    const p = editingParticipantDraft
      ? uploadRpDraftFile(tender.id, 'report', file, phase)
      : uploadRpReport(tender.id, file);
    p.then((d) => {
      if (editingParticipantDraft && d.draft) {
        setMyDraft(d.draft);
        setReportFile(d.draft.report_file || d.file || null);
      } else {
        setReportFile(d.report_file || null);
      }
      toast('Отчёт прикреплён', null, 'ok');
    }).catch((err) => toast(err.message, null, 'err'));
  };

  const onTkp = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const phase = mode === 'calc' ? 'calc' : 'analysis';
    const p = editingParticipantDraft
      ? uploadRpDraftFile(tender.id, 'tkp', file, phase)
      : uploadRpTkp(tender.id, file);
    p.then((d) => {
      if (editingParticipantDraft && d.draft) {
        setMyDraft(d.draft);
        setTkpFile(d.draft.tkp_file || d.file || null);
      } else {
        setTkpFile(d.tkp_file || null);
      }
      toast('ТКП прикреплено', null, 'ok');
    }).catch((err) => toast(err.message, null, 'err'));
  };

  const directorDecision = (action) => {
    const comment = dirComment.trim();
    if (action === 'reject' && !comment) {
      toast('Укажите причину отказа', null, 'err');
      return;
    }
    directorDecisionRpReview(tender.id, {
      action,
      comment: comment || undefined
    }).then(() => {
      toast(action === 'submit' ? 'Одобрено — ТО может подавать' : 'Тендер отклонён', null, 'ok');
      onSaved?.();
      onClose?.();
    }).catch((e) => toast(e.message || 'Сбой', null, 'err'));
  };

  const toDecision = (action) => {
    const comment = toComment.trim();
    if ((action === 'rework' || action === 'reject') && !comment) {
      toast(action === 'rework' ? 'Укажите комментарий — что доработать' : 'Укажите причину отклонения', null, 'err');
      return;
    }
    const body = action === 'accept'
      ? { action, comment: comment || undefined }
      : action === 'rework'
        ? { action, comment }
        : { action, reject_reason: comment };
    toDecisionRpReview(tender.id, body).then(() => {
      toast(action === 'accept' ? 'Принято — статус «Готовим»' : (action === 'rework' ? 'Отправлено на доработку' : 'Тендер отклонён'), 'ok');
      onSaved?.();
      onClose?.();
    }).catch((e) => toast(e.message || 'Сбой', null, 'err'));
  };

  const archiveFromReject = () => {
    archiveRegistryRow(tender.id, 'РП: не подаём — подтверждено ТО').then(() => {
      toast('Тендер в архиве', null, 'ok');
      onSaved?.();
      onClose?.();
    }).catch((e) => toast(e.message || 'Сбой', null, 'err'));
  };

  const pr = useMemo(
    () => progressPct(reportJson, mode, decision, workPrice, !!estimateFile),
    [reportJson, mode, decision, workPrice, estimateFile]
  );

  const points = reportJson.points?.length ? reportJson.points : REJECT_TEMPLATE;
  const questions = (reportJson.questions_for_customer || []).length
    ? reportJson.questions_for_customer
    : [''];

  const showToBar = isTo && !isViewer && review?.is_final && review.decision !== 'reject'
    && review?.director_review_status !== 'pending';
  const showRejectArchiveBar = isTo && !isViewer && review?.is_final && review.decision === 'reject'
    && review?.director_review_status !== 'pending';
  const showDirectorBar = isDirector && review?.director_review_status === 'pending';
  const showFooter = !showToBar && !showRejectArchiveBar && !showDirectorBar;
  const hasSnap = mode === 'calc' && analysisSnapshot;
  const calcNoSnap = mode === 'calc' && !analysisSnapshot && !locked;

  const renderReportTab = () => (
    <>
      {hasSnap && <AnalysisRefBlock snap={analysisSnapshot} missingFlags={missingFlags} />}
      {calcNoSnap && (
        <div className="alert" style={{ marginBottom: 12, fontSize: 13 }}>
          Анализ дежурного РП ещё не закрыт. Можно начать просчёт, но рекомендации анализа пока недоступны.
        </div>
      )}

      {locked && review ? (
        <ReadonlySummary review={review} rj={hasSnap ? analysisSnapshot : reportJson} workPrice={workPrice} />
      ) : hasSnap ? (
        <div className={'rp-review-summary-card ' + (decision === 'submit' ? 'submit' : 'reject')} style={{ marginBottom: 10 }}>
          <strong>{decision === 'submit' ? '✓ Подаём' : '✕ Не подаём'}</strong>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>Решение из анализа дежурного РП</p>
        </div>
      ) : (
        <DecisionCards decision={decision} disabled={locked} onSelect={onDecisionSelect} />
      )}

      {!locked && (
        <div className="rp-review-progress">
          Заполнено {pr.done}/{pr.total} разделов
          <bar><i style={{ width: pr.pct + '%' }} /></bar>
        </div>
      )}

      {decision === 'reject' && mode !== 'calc' && (
        <Section id="reject" title="Причины отказа" collapsed={!!collapsed.reject} onToggle={toggleSec}>
          {locked && reportJson.reject_preset ? (
            <Ro label="Категория" value={rejectPresetLabel(reportJson.reject_preset)} />
          ) : (
            <div className="rp-review-field">
              <label>Категория</label>
              <Seg
                options={REJECT_PRESETS}
                value={reportJson.reject_preset || ''}
                disabled={locked}
                onChange={(v) => patchRj({ reject_preset: v })}
              />
            </div>
          )}
          {points.map((p, i) => (
            locked ? (
              <Ro key={i} label={'Пункт ' + (i + 1)} value={(p.point || '') + (p.reason ? ' — ' + p.reason : '')} />
            ) : (
              <div key={i} className="rp-review-field">
                <input
                  className="inp"
                  placeholder="Пункт ТЗ / требование"
                  value={p.point || ''}
                  onChange={(e) => {
                    const next = [...points];
                    next[i] = { ...next[i], point: e.target.value };
                    patchRj({ points: next });
                  }}
                />
                <input
                  className="inp"
                  placeholder="Почему не подаём"
                  value={p.reason || ''}
                  style={{ marginTop: 4 }}
                  onChange={(e) => {
                    const next = [...points];
                    next[i] = { ...next[i], reason: e.target.value };
                    patchRj({ points: next });
                  }}
                />
              </div>
            )
          ))}
          {!locked && (
            <button
              type="button"
              className="btn mini ghost"
              onClick={() => patchRj({ points: [...points, { point: '', reason: '' }] })}
            >+ Пункт</button>
          )}
        </Section>
      )}

      {decision === 'submit' && (
        <>
          {(mode === 'analysis' || (mode === 'calc' && !hasSnap)) && (
          <Section id="assess" title="Оценка и рекомендация" collapsed={!!collapsed.assess} onToggle={toggleSec}>
            <div className="rp-review-field-row">
              <div className="rp-review-field">
                <label>Выполнимость{!locked && <span className="req"> *</span>}</label>
                {locked ? (
                  <Ro value={feasibilityLabel(reportJson.feasibility)} />
                ) : (
                  <Seg
                    options={FEASIBILITY_OPTS}
                    value={reportJson.feasibility}
                    onChange={(v) => patchRj({ feasibility: v })}
                  />
                )}
              </div>
              <div className="rp-review-field">
                <label>Конкуренция</label>
                {locked ? (
                  <Ro value={competitionLabel(reportJson.competition)} />
                ) : (
                  <Seg
                    options={COMPETITION_OPTS}
                    value={reportJson.competition}
                    onChange={(v) => patchRj({ competition: v })}
                  />
                )}
              </div>
            </div>

            {mode === 'analysis' && !locked && (
              <>
                <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
                  Ориентир до детального просчёта — оба значения без НДС.
                </p>
                <div className="rp-review-field-row">
                  <div className="rp-review-field">
                    <label>Ориентир цены от (без НДС)</label>
                    <input
                      className="inp"
                      type="text"
                      value={reportJson.price_range_min ?? ''}
                      onChange={(e) => patchRj({ price_range_min: e.target.value || null })}
                      placeholder="например: 5 млн или по КП"
                    />
                  </div>
                  <div className="rp-review-field">
                    <label>до (без НДС)</label>
                    <input
                      className="inp"
                      type="text"
                      value={reportJson.price_range_max ?? ''}
                      onChange={(e) => patchRj({ price_range_max: e.target.value || null })}
                      placeholder="цифры или текст"
                    />
                  </div>
                </div>
              </>
            )}
            {mode === 'analysis' && locked && priceRangeLabel(reportJson, workPrice) !== '—' && (
              <Ro label="Ориентир цены" value={priceRangeLabel(reportJson, workPrice)} />
            )}
            {mode === 'calc' && locked && workPrice && (
              <Ro label="Цена работ (с НДС)" value={fmtMoney(workPrice)} />
            )}

            <div className="rp-review-field">
              <label>Суть для ТО{!locked && <span className="req"> *</span>}</label>
              {locked ? (
                <Ro value={reportJson.summary} />
              ) : (
                <textarea
                  className="inp"
                  rows={3}
                  value={reportJson.summary || ''}
                  onChange={(e) => patchRj({ summary: e.target.value })}
                />
              )}
            </div>
            <div className="rp-review-field">
              <label>Риски</label>
              {locked ? (
                <Ro value={reportJson.risks} />
              ) : (
                <textarea
                  className="inp"
                  rows={2}
                  value={reportJson.risks || ''}
                  onChange={(e) => patchRj({ risks: e.target.value })}
                />
              )}
            </div>
            <div className="rp-review-field">
              <label>Рекомендация РП</label>
              {locked ? (
                <Ro value={reportJson.recommendation} />
              ) : (
                <textarea
                  className="inp"
                  rows={2}
                  value={reportJson.recommendation || ''}
                  onChange={(e) => patchRj({ recommendation: e.target.value })}
                />
              )}
            </div>
          </Section>
          )}

          {mode === 'calc' && (
            <>
              <Section id="scope" title="Объём и сроки" collapsed={!!collapsed.scope} onToggle={toggleSec}>
                <div className="rp-review-field">
                  <label>Объём работ (scope)</label>
                  {locked ? (
                    <Ro value={reportJson.scope} />
                  ) : (
                    <textarea
                      className="inp"
                      rows={3}
                      value={reportJson.scope || ''}
                      onChange={(e) => patchRj({ scope: e.target.value })}
                    />
                  )}
                </div>
                <div className="rp-review-field-row">
                  <div className="rp-review-field">
                    <label>Срок выполнения, дней</label>
                    {locked ? (
                      <Ro value={reportJson.duration_days} />
                    ) : (
                      <input
                        className="inp"
                        type="number"
                        value={reportJson.duration_days ?? ''}
                        onChange={(e) => patchRj({ duration_days: e.target.value ? Number(e.target.value) : null })}
                      />
                    )}
                  </div>
                  <div className="rp-review-field">
                    <label>Ресурсы (бригада / техника)</label>
                    {locked ? (
                      <Ro value={reportJson.resources} />
                    ) : (
                      <input
                        className="inp"
                        value={reportJson.resources || ''}
                        onChange={(e) => patchRj({ resources: e.target.value })}
                      />
                    )}
                  </div>
                </div>
                <div className="rp-review-field">
                  <label>Вопросы заказчику</label>
                  {locked ? (
                    questions.filter(Boolean).map((q, i) => <Ro key={i} value={q} />)
                  ) : (
                    <>
                      <div className="rp-review-questions">
                        {questions.map((q, i) => (
                          <div key={i} className="rp-review-q-row">
                            <input
                              className="inp"
                              value={q}
                              onChange={(e) => {
                                const next = [...questions];
                                next[i] = e.target.value;
                                patchRj({ questions_for_customer: next });
                              }}
                            />
                            {questions.length > 1 && (
                              <button
                                type="button"
                                className="btn mini ghost"
                                onClick={() => patchRj({
                                  questions_for_customer: questions.filter((_, idx) => idx !== i)
                                })}
                              >✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn mini ghost"
                        onClick={() => patchRj({ questions_for_customer: [...questions, ''] })}
                      >+ Вопрос</button>
                    </>
                  )}
                </div>
              </Section>

              <Section id="finance" title="Финансы" collapsed={!!collapsed.finance} onToggle={toggleSec}>
                <div className="rp-review-field">
                  <label>Себестоимость, ₽ (без НДС)</label>
                  {locked ? (
                    <Ro value={reportJson.cost_without_vat != null ? fmtMoney(reportJson.cost_without_vat) : '—'} />
                  ) : (
                    <input
                      className="inp"
                      type="number"
                      value={reportJson.cost_without_vat ?? ''}
                      onChange={(e) => patchRj({ cost_without_vat: e.target.value ? Number(e.target.value) : null })}
                    />
                  )}
                </div>
                <div className="rp-review-field">
                  <label>Цена работ, ₽ (с НДС){!locked && <span className="req"> *</span>}</label>
                  {locked ? (
                    <Ro value={fmtMoney(workPrice)} />
                  ) : (
                    <input
                      className="inp"
                      type="number"
                      value={workPrice}
                      onChange={(e) => setWorkPrice(e.target.value)}
                    />
                  )}
                </div>
                {estimateFile ? (
                  <div className="rp-review-estimate has-file">
                    <strong>{estimateFile.original_name || 'Смета'}</strong>
                    {estimateFile.size ? (
                      <span className="muted"> {Math.round(estimateFile.size / 1024)} КБ</span>
                    ) : null}
                    <a
                      className="btn mini"
                      href={estimateFile.download_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ marginLeft: 8 }}
                    >Скачать</a>
                  </div>
                ) : !locked ? (
                  <div className="rp-review-estimate rp-review-estimate-drop">
                    <strong>Перетащите файл сметы сюда</strong>
                    <span className="muted" style={{ fontSize: 12 }}>или выберите .xlsx, .pdf, .csv</span>
                    <input
                      type="file"
                      className="inp"
                      accept=".xlsx,.xls,.pdf,.csv"
                      style={{ marginTop: 10, width: '100%' }}
                      onChange={onEstimate}
                    />
                  </div>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>Смета не прикреплена</p>
                )}
                {reportFile ? (
                  <div className="rp-review-estimate has-file" style={{ marginTop: 10 }}>
                    <strong>{reportFile.original_name || 'Отчёт'}</strong>
                    {reportFile.size ? (
                      <span className="muted"> {Math.round(reportFile.size / 1024)} КБ</span>
                    ) : null}
                    <a
                      className="btn mini"
                      href={reportFile.download_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ marginLeft: 8 }}
                    >Скачать отчёт</a>
                  </div>
                ) : !locked ? (
                  <div className="rp-review-estimate rp-review-estimate-drop" style={{ marginTop: 10 }}>
                    <strong>Прикрепить файл отчёта</strong>
                    <span className="muted" style={{ fontSize: 12 }}>.docx, .pdf</span>
                    <input
                      type="file"
                      className="inp"
                      accept=".docx,.doc,.pdf"
                      style={{ marginTop: 10, width: '100%' }}
                      onChange={onReport}
                    />
                  </div>
                ) : (
                  <p className="muted" style={{ margin: '8px 0 0' }}>Файл отчёта не прикреплён</p>
                )}
                <div className="rp-review-field" style={{ marginTop: 12 }}>
                  <label>ТКП{!locked && <span className="req"> *</span>}</label>
                  {tkpFile ? (
                    <div className="rp-review-estimate has-file">
                      <strong>{tkpFile.original_name || 'ТКП'}</strong>
                      {tkpFile.size ? (
                        <span className="muted"> {Math.round(tkpFile.size / 1024)} КБ</span>
                      ) : null}
                      <a
                        className="btn mini"
                        href={tkpFile.download_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ marginLeft: 8 }}
                      >Скачать</a>
                    </div>
                  ) : !locked ? (
                    <div className="rp-review-estimate rp-review-estimate-drop">
                      <strong>Прикрепить ТКП</strong>
                      <span className="muted" style={{ fontSize: 12 }}>.pdf, .docx, .xlsx</span>
                      <input
                        type="file"
                        className="inp"
                        accept=".pdf,.docx,.doc,.xlsx,.xls"
                        style={{ marginTop: 10, width: '100%' }}
                        onChange={onTkp}
                      />
                    </div>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>ТКП не прикреплено</p>
                  )}
                </div>
              </Section>
            </>
          )}

          <Section id="missing" title="Не хватает данных" collapsed={!!collapsed.missing} onToggle={toggleSec}>
            <MissingChips selected={missingFlags} disabled={locked} onToggle={toggleFlag} />
          </Section>
        </>
      )}
    </>
  );

  if (!tender) return null;

  return (
    <MCard>
      <MHead
        icon="📊"
        title={'Отчёт РП · #' + tender.id}
        subtitle={leadSubtitle(tender)}
        onClose={onClose}
      />
      <MBody>
        {loading ? (
          <p className="muted">Загрузка отчёта…</p>
        ) : (
          <div className="rp-review-modal">
            <HeaderBadges review={review} mode={mode} isLocked={locked} />
            <p className="rp-review-lead">{leadSubtitle(tender)}</p>
            <MetaBar tender={tender} review={review} />
            {!locked && !isTo && !isDirector && (
              <>
                {editingParticipantDraft ? (
                  <div className="alert" style={{ margin: '0 0 12px', fontSize: 13 }}>
                    Вы готовите <b>личный черновик</b> для {finalOwnerName || 'хозяина фазы'}.
                    Закрыть анализ/отчёт может только он.
                  </div>
                ) : null}
                {isFinalOwner && teamSummary && (teamSummary.drafts_count > 0 || collabs.length > 0) ? (
                  <div className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
                    Команда: {collabs.length} привлечённых · черновиков: {teamSummary.drafts_count || 0}
                    {teamSummary.ready_count ? ` · готовых: ${teamSummary.ready_count}` : ''} · вкладка «Команда»
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button type="button" className="btn mini" onClick={openMimir}>🚀 Просчёт Мимир</button>
                </div>
              </>
            )}
            <TenderToDocsBlock tenderId={tender.id} />

            <div className="rp-review-tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={'rp-review-tab' + (tab === t.id ? ' active' : '')}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  {t.id === 'thread' && threadUnread > 0 && (
                    <span className="rp-review-tab-badge">{threadUnread}</span>
                  )}
                </button>
              ))}
            </div>

            {tab === 'report' && renderReportTab()}
            {tab === 'tender' && (
              <div className="rp-review-field">
                <Ro label="Заказчик" value={tender.customer_name} />
                <Ro label="Тендер" value={tender.tender_title} />
                <Ro label="Комментарий ТО" value={tender.comment_to} />
                {tender.purchase_url && (
                  <p>
                    <a href={tender.purchase_url} target="_blank" rel="noopener" className="btn mini">
                      ↗ Открыть закупку
                    </a>
                  </p>
                )}
              </div>
            )}
            {tab === 'history' && (() => {
              const TO_FINAL_ACTIONS = new Set([
                'finalize', 'finalize_analysis', 'finalize_reject',
                'attach_estimate', 'attach_report', 'attach_tkp',
                'to_accept', 'to_reject', 'to_rework',
                'invite_collaborator', 'revoke_collaborator'
              ]);
              let visible = logs;
              let hiddenNote = null;
              if (isTo && !isDirector) {
                const compact = logs.filter((l) => TO_FINAL_ACTIONS.has(l.action));
                const hidden = logs.length - compact.length;
                visible = compact;
                if (hidden > 0) {
                  hiddenNote = `Показаны финальные действия для ТО. В памяти тендера ещё ${hidden} записей черновиков/Мимира (доступны РП и админам).`;
                }
              }
              if (!visible.length) {
                return (
                  <>
                    {hiddenNote ? <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>{hiddenNote}</p> : null}
                    <p className="muted">Пока нет действий</p>
                  </>
                );
              }
              return (
                <>
                  {hiddenNote ? <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>{hiddenNote}</p> : null}
                  <ul className="rp-review-timeline">
                    {visible.map((l) => {
                      let extra = '';
                      if (l.payload_json) {
                        try {
                          const p = typeof l.payload_json === 'string' ? JSON.parse(l.payload_json) : l.payload_json;
                          if (p.comment) extra = ' — ' + p.comment;
                          if (l.action === 'mimir_apply' && p.session_uid) extra += ` · сессия ${String(p.session_uid).slice(0, 8)}`;
                          if (l.action === 'import_draft_to_final' && p.author_user_id) extra += ` · от РП #${p.author_user_id}`;
                        } catch { /* ignore */ }
                      }
                      return (
                        <li key={l.id || l.created_at}>
                          <div className="tl-time">
                            {new Date(l.created_at).toLocaleString('ru-RU')} · {l.actor_name || '—'}
                          </div>
                          <div className="tl-action">{(LOG_LABELS[l.action] || l.action) + extra}</div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              );
            })()}
            {tab === 'team' && (
              <>
                {finalOwnerName ? (
                  <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
                    Хозяин финала: <b>{finalOwnerName}</b>
                  </p>
                ) : null}
                {collabs.length ? (
                  <ul style={{ paddingLeft: 0, margin: '0 0 12px', listStyle: 'none' }}>
                    {collabs.map((c) => (
                      <li key={c.id || c.pm_user_id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}>
                        <span style={{ flex: 1 }}>{c.pm_name}</span>
                        {!locked && isFinalOwner ? (
                          <button type="button" className="btn mini ghost" onClick={() => revokeCollab(c.pm_user_id)}>Отозвать</button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ margin: '0 0 12px' }}>Нет привлечённых РП — параллельная работа, не перевод тендера</p>
                )}
                {!locked && isFinalOwner && (
                  <div className="rp-review-field">
                    <label>Привлечь РП к совместному {mode === 'calc' ? 'просчёту' : 'анализу'}</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select className="inp" style={{ flex: 1 }} value={invitePm} onChange={(e) => setInvitePm(e.target.value)}>
                        <option value="">— выберите —</option>
                        {pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <button type="button" className="btn mini" onClick={invite}>Пригласить</button>
                    </div>
                  </div>
                )}
                <h4 style={{ margin: '16px 0 8px', fontSize: 13 }}>Черновики команды</h4>
                {!teamDrafts.length ? (
                  <p className="muted" style={{ margin: 0 }}>Пока нет чужих черновиков</p>
                ) : teamDrafts.map((d) => {
                  const dj = d.draft_json || {};
                  return (
                    <div key={d.id} className="rp-review-summary-card" style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <strong>{d.author_name || 'РП'}{d.status === 'ready' ? ' · готово' : ''}</strong>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {d.updated_at ? new Date(d.updated_at).toLocaleString('ru-RU') : ''}
                        </span>
                      </div>
                      {dj.summary ? <div style={{ fontSize: 12, marginTop: 6 }}>{String(dj.summary).slice(0, 220)}</div> : null}
                      {isFinalOwner && !locked ? (
                        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className="btn mini" onClick={() => importDraft(d.id, true)}>Взять в финал (поля+файлы)</button>
                          <button type="button" className="btn mini ghost" onClick={() => importDraft(d.id, false)}>Только поля</button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </>
            )}
            {tab === 'thread' && (
              <RpReviewThread
                tenderId={tender.id}
                threadLocked={!!review?.is_final && !['pending', 'approved'].includes(review?.director_review_status || '')}
              />
            )}

            {showDirectorBar && (
              <div className="rp-review-to-bar" style={{ borderColor: '#c2410c' }}>
                <h4>Решение директора</h4>
                <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
                  Просчёт РП от 10 млн ₽ без НДС. Подтвердите подачу или отклоните тендер.
                </p>
                <div className="rp-review-to-comment">
                  <label className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                    Комментарий (обязателен при отказе)
                  </label>
                  <textarea
                    className="inp"
                    rows={2}
                    placeholder="Причина отказа…"
                    value={dirComment}
                    onChange={(e) => setDirComment(e.target.value)}
                  />
                </div>
                <div className="rp-review-to-actions">
                  <Btn onClick={() => directorDecision('submit')}>Подавать</Btn>
                  <Btn variant="ghost" style={{ color: '#f87171' }} onClick={() => directorDecision('reject')}>
                    Не подавать
                  </Btn>
                </div>
              </div>
            )}

            {showRejectArchiveBar && (
              <div className="rp-review-to-bar rp-review-to-bar-reject">
                <h4>РП рекомендует: Не подаём</h4>
                <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
                  Тендер остаётся в активном реестре. Подтвердите архив или верните отчёт РП на доработку.
                </p>
                <div className="rp-review-to-comment">
                  <label className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                    Комментарий (для «На доработку» — обязателен)
                  </label>
                  <textarea
                    className="inp"
                    rows={2}
                    placeholder="Комментарий…"
                    value={toComment}
                    onChange={(e) => setToComment(e.target.value)}
                  />
                </div>
                <div className="rp-review-to-actions">
                  <button type="button" className="btn rp-to-archive-btn" onClick={archiveFromReject}>
                    В архив
                  </button>
                  <Btn variant="ghost" onClick={() => toDecision('rework')}>На доработку</Btn>
                </div>
              </div>
            )}

            {showToBar && (
              <div className="rp-review-to-bar">
                <h4>Решение ТО</h4>
                <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
                  Отчёт РП готов. Подтвердите или верните на доработку.
                </p>
                <div className="rp-review-to-comment">
                  <label className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                    Комментарий для РП
                  </label>
                  <textarea
                    className="inp"
                    rows={2}
                    placeholder="Для «На доработку» и «Отклонить» — обязателен"
                    value={toComment}
                    onChange={(e) => setToComment(e.target.value)}
                  />
                </div>
                <div className="rp-review-to-actions">
                  <Btn onClick={() => toDecision('accept')}>Принять → Готовим</Btn>
                  <Btn variant="ghost" onClick={() => toDecision('rework')}>На доработку</Btn>
                  <Btn variant="ghost" style={{ color: '#f87171' }} onClick={() => toDecision('reject')}>Отклонить</Btn>
                </div>
              </div>
            )}

            {showFooter && (
              <div className="rp-review-footer">
                <Btn variant="ghost" onClick={onClose}>{locked ? 'Закрыть' : 'Выход'}</Btn>
                {!locked && (
                  <>
                    <span className="spacer" />
                    <Btn variant="ghost" onClick={() => save(false)}>Сохранить черновик</Btn>
                    {editingParticipantDraft ? (
                      <Btn variant="primary" onClick={() => save(false, true)}>Отметить готовым</Btn>
                    ) : canFinalize ? (
                      <Btn variant="primary" onClick={() => save(true)}>
                        {mode === 'analysis' ? 'Закрыть анализ' : 'Закрыть отчёт'}
                      </Btn>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </MBody>
    </MCard>
  );
}
