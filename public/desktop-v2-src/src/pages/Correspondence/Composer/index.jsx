/**
 * Composer/index.jsx — главная страница composer'а GNSH-письма (React v2, S-13H).
 *
 * Контракт: tests/reports/letters/_LETTER_CONTRACT.md §7 (Composer), §8 (state machine).
 * Маршруты (оба смонтированы в App.jsx):
 *   /v2/#/correspondence/composer        — новый черновик
 *   /v2/#/correspondence/composer/:id    — открыть существующий
 * Также читает URL-params: parent_entity_type, parent_entity_id, correspondence_id.
 *
 * Layout 3 колонки:
 *   ┌───────────┬──────────────────────────┬──────────────────────┐
 *   │ Шапка     │  TipTap editor (бланк)   │ Мимир чат            │
 *   │ + подпись │  + переключатель Preview │  (3 модели, 2 режима)│
 *   └───────────┴──────────────────────────┴──────────────────────┘
 *
 * Автосейв через 2с debounce.
 *
 * ⚠️ КРИТИЧНО ([[feedback-letter-executor]]): «Исп.» в превью = useAuth().user.
 *  Никаких хардкодов 'Андросов Никита Андреевич'.
 *
 * До S-13H этот файл был bridge-композером на базе CorrFormModal (vanilla-паритет).
 * Теперь — полноценный TipTap-композер. CorrFormModal остаётся доступным
 * для быстрого создания «без бланка» через реестр (кнопка «📥 Входящее»).
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/api/useAuth';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';

import { hasAccess as hasCorrAccess } from '../api';
import {
  getLetterKinds, getCorrespondence, saveDraft, finalizeCorrespondence,
  createNewRevision, loadParentContext, renderLetterUrl, templateHealth,
  DEFAULT_MODEL_ID, DEFAULT_KINDS
} from './api';
import { TipTapEditor } from './TipTapEditor';
import { HeaderForm } from './HeaderForm';
import { SignatureBlock } from './SignatureBlock';
import { LetterPreview } from './LetterPreview';
import { MimirChat } from './MimirChat';

// 23.06.2026 BUG-FIX (Mail Y1 🟡): паритет FINALIZE_ROLES к vanilla.
// До фикса: v2 пускал OFFICE_MANAGER → кнопка «Финализировать» была видна,
// но при клике она в реальном workflow vanilla отсутствует (vanilla
// correspondence.js §5 / canFinalize: OFFICE_MANAGER — только просмотр+скачивание).
// Backend correspondence.js:275 ВСЁ ЕЩЁ пускает OFFICE_MANAGER (WRITE_OVERRIDE),
// то есть UI-фронт расходится с API. По указанию юзера выровнено НА VANILLA
// (vanilla = источник истины поведения, см. CLAUDE.md). Backend трогать
// не стали — там OFFICE_MANAGER оставлен «на всякий случай», но через v2 UI
// он этой кнопкой больше не пользуется.
const FINALIZE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

// При открытии composer URL может содержать ?return_to=<URL>. По выходу
// (Закрыть / после finalize) возвращаем юзера туда — обычно в vanilla, откуда
// он зашёл (карточка тендера / реестр писем / hub). Это убирает «застревание»
// юзера в React v2 после составления письма.
function goBackOrFallback(navigate, returnTo, fallback) {
  if (returnTo) {
    try {
      const url = decodeURIComponent(returnTo);
      // Если URL абсолютный (тот же origin или vanilla hash) — full reload,
      // потому что HashRouter не умеет переключаться на vanilla без перезагрузки.
      if (/^https?:\/\//i.test(url) || url.startsWith('/')) {
        window.location.href = url;
        return;
      }
    } catch (_) { /* fall through */ }
  }
  navigate(fallback || '/correspondence');
}

function emptyDraft() {
  return {
    direction: 'outgoing',
    letter_kind: 'free',
    doc_title: '',
    doc_sub: '',
    header_subline: '',
    subject: '',
    counterparty: '',
    contact_person: '',
    procedure_number: '',
    lot_number: '',
    lot_title: '',
    body_html: '',
    body_json: null,
    tender_id: null,
    work_id: null,
    calc_id: null,
    pre_tender_id: null,
    signature_on: true,
    stamp_on: true,
    ai_model: DEFAULT_MODEL_ID,
    doc_type: 'letter',
    date: new Date().toISOString().slice(0, 10)
  };
}

function parseHashQuery() {
  // HashRouter: window.location.hash = '#/correspondence/edit/123?parent_entity_type=tender&...'
  const h = window.location.hash || '';
  const qIdx = h.indexOf('?');
  if (qIdx === -1) return {};
  const usp = new URLSearchParams(h.slice(qIdx + 1));
  const out = {};
  for (const [k, v] of usp.entries()) out[k] = v;
  return out;
}

export default function CorrespondenceComposer() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const location = useLocation();
  const access = hasCorrAccess(user);

  const params = useMemo(parseHashQuery, [location.hash]);
  const correspondenceIdInitial = routeId || params.correspondence_id || null;

  // ─── State ────────────────────────────────────────────────────────────
  const [correspondenceId, setCorrespondenceId] = useState(correspondenceIdInitial ? Number(correspondenceIdInitial) : null);
  const [draft, setDraft] = useState(emptyDraft());
  const [signingStatus, setSigningStatus] = useState('draft');
  const [versionNo, setVersionNo] = useState(1);
  const [number, setNumber] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [aiModel, setAiModel] = useState(DEFAULT_MODEL_ID);
  const [kinds, setKinds] = useState(DEFAULT_KINDS);
  const [loading, setLoading] = useState(!!correspondenceIdInitial);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [splitView, setSplitView] = useState('editor');  // 'editor' | 'preview'
  const [tplHealth, setTplHealth] = useState(null);

  const editorRef = useRef(null);

  // ─── Author/executor ([[feedback-letter-executor]]) ───────────────────
  // КРИТИЧНО (23.06.2026 BUG-FIX R1): «Исп.» = АВТОР письма (тот кто его создал),
  // а НЕ текущий зритель. До фикса при открытии чужого финализированного письма
  // подпись «Исп.» подменялась на ФИО открывшего → нарушение [[feedback-letter-executor]].
  // Логика: если draft содержит created_by != current user, отдельно подгружаем автора.
  const [authorUser, setAuthorUser] = useState(null);
  useEffect(() => {
    const authorId = draft?.created_by;
    if (!authorId || !user || Number(authorId) === Number(user.id)) {
      setAuthorUser(null);
      return;
    }
    fetch(`/api/users/${Number(authorId)}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((u) => { if (u) setAuthorUser(u.user || u); })
      .catch(() => {});
  }, [draft?.created_by, user]);
  const executorSource = authorUser || user;

  const executorName = useMemo(() => {
    const u = executorSource;
    if (!u) return '';
    const parts = [u.last_name, u.first_name, u.patronymic]
      .filter(Boolean)
      .map((s) => String(s).trim())
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
    return u.full_name || u.name || u.login || '';
  }, [executorSource]);

  const executorPhoneEmail = useMemo(() => {
    const u = executorSource;
    if (!u) return '';
    const bits = [];
    if (u.phone) bits.push(`Тел.: ${u.phone}`);
    if (u.email) bits.push(`E-mail: ${u.email}`);
    return bits.join('   ');
  }, [executorSource]);

  // ─── Загрузка kinds + template health (один раз) ──────────────────────
  useEffect(() => {
    getLetterKinds().then((items) => {
      if (Array.isArray(items) && items.length) setKinds(items);
    }).catch(() => {});
    templateHealth().then(setTplHealth).catch(() => {});
  }, []);

  // ─── Загрузка существующего correspondence ────────────────────────────
  useEffect(() => {
    if (!correspondenceIdInitial) return;
    setLoading(true);
    getCorrespondence(correspondenceIdInitial).then((it) => {
      if (!it) {
        toast?.error?.('Письмо не найдено') || toast?.('Письмо', 'Не найдено', 'err');
        goBackOrFallback(navigate, params.return_to, '/correspondence');
        return;
      }
      setCorrespondenceId(Number(it.id));
      setSigningStatus(it.signing_status || 'draft');
      setVersionNo(it.version_no || 1);
      setNumber(it.number || null);
      setConversationId(it.ai_thread_id || null);
      setAiModel(it.ai_model || DEFAULT_MODEL_ID);
      setDraft({
        ...emptyDraft(),
        ...it,
        // boolean'ы с дефолтом true (БД отдаст true|false, без NULL).
        signature_on: it.signature_on !== false,
        stamp_on:     it.stamp_on     !== false
      });
    }).catch((e) => {
      toast?.error?.(String(e?.message || e)) || toast?.('Ошибка', String(e?.message || e), 'err');
    }).finally(() => setLoading(false));
  }, [correspondenceIdInitial, navigate]);

  // ─── Авто-подтягивание контекста родителя ─────────────────────────────
  useEffect(() => {
    const pt = params.parent_entity_type;
    const pi = params.parent_entity_id;
    if (!pt || !pi || correspondenceIdInitial) return;
    loadParentContext({ parent_entity_type: pt, parent_entity_id: pi }).then((ctx) => {
      if (!ctx) return;
      setDraft((d) => {
        const patch = {};
        if (!d.counterparty) {
          patch.counterparty = ctx.customer_name || ctx.counterparty || ctx.contractor_name || ctx.customer?.name || '';
        }
        if (!d.procedure_number && ctx.procedure_number) patch.procedure_number = ctx.procedure_number;
        if (!d.lot_number       && ctx.lot_number)       patch.lot_number       = ctx.lot_number;
        if (!d.lot_title        && (ctx.lot_title || ctx.tender_title)) patch.lot_title = ctx.lot_title || ctx.tender_title;
        if (pt === 'tender')     patch.tender_id     = Number(pi);
        if (pt === 'work')       patch.work_id       = Number(pi);
        if (pt === 'calc' || pt === 'estimate') patch.calc_id = Number(pi);
        if (pt === 'pre_tender') patch.pre_tender_id = Number(pi);
        return { ...d, ...patch };
      });
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.parent_entity_type, params.parent_entity_id]);

  // ─── Patch draft ──────────────────────────────────────────────────────
  const patchDraft = useCallback((patch) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  // ─── TipTap onUpdate ───────────────────────────────────────────────────
  const onEditorUpdate = useCallback((json, html) => {
    setDraft((d) => ({ ...d, body_json: json, body_html: html }));
  }, []);

  // ─── Save (manual + debounced auto) ───────────────────────────────────
  const saveNow = useCallback(async () => {
    if (signingStatus !== 'draft') return null;          // finalized / sent — заблокировано
    if (saving) return null;
    if (!draft.subject?.trim() || !draft.counterparty?.trim()) return null;  // не сохраняем неполные

    setSaving(true);
    try {
      const payload = {
        ...draft,
        id: correspondenceId || undefined,
        ai_model: aiModel,
        ai_thread_id: conversationId || null
      };
      const res = await saveDraft(payload);
      const newId = res?.id || res?.item?.id || res?.row?.id || correspondenceId;
      if (newId && !correspondenceId) {
        setCorrespondenceId(Number(newId));
        // Подменим URL без перезагрузки:
        try {
          const newHash = `#/correspondence/composer/${newId}`;
          if (window.location.hash !== newHash) window.history.replaceState(null, '', newHash);
        } catch { /* noop */ }
      }
      return newId;
    } catch (e) {
      toast?.error?.('Не удалось сохранить: ' + (e?.message || e)) ||
      toast?.('Ошибка', String(e?.message || e), 'err');
      return null;
    } finally {
      setSaving(false);
    }
  }, [draft, signingStatus, saving, correspondenceId, aiModel, conversationId]);

  // Debounced autosave (2с)
  const autosaveTimer = useRef(null);
  useEffect(() => {
    if (signingStatus !== 'draft') return;
    if (!draft.subject?.trim() || !draft.counterparty?.trim()) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { saveNow(); }, 2000);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, signingStatus]);

  // ─── Finalize ─────────────────────────────────────────────────────────
  const canFinalize = useMemo(() => {
    if (!user) return false;
    if (!FINALIZE_ROLES.includes(user.role)) return false;
    return signingStatus === 'draft' && !!correspondenceId;
  }, [user, signingStatus, correspondenceId]);

  const doFinalize = async () => {
    if (!canFinalize) return;
    if (!window.confirm('Финализировать письмо? Будет присвоен Исх. № и текст блокируется.')) return;
    setFinalizing(true);
    try {
      await saveNow();
      const res = await finalizeCorrespondence(correspondenceId);
      if (res?.number) setNumber(res.number);
      setSigningStatus('finalized');
      toast?.success?.(`Письмо финализировано: ${res?.number || ''}`) ||
      toast?.('Финализировано', res?.number || '', 'ok');
      window.dispatchEvent(new CustomEvent('asgard:correspondence:changed'));
    } catch (e) {
      toast?.error?.(String(e?.message || e)) || toast?.('Ошибка', String(e?.message || e), 'err');
    } finally {
      setFinalizing(false);
    }
  };

  // ─── New revision ─────────────────────────────────────────────────────
  const doNewRevision = async () => {
    if (!correspondenceId) return;
    const note = window.prompt('Краткое описание правок в этой редакции (опц.):', '');
    if (note == null) return;
    try {
      const res = await createNewRevision(correspondenceId, note);
      const newId = res?.new_id || res?.id;
      if (newId) {
        toast?.success?.(`Создана редакция v${res?.version_no || ''}`) ||
        toast?.('Новая редакция', `v${res?.version_no || ''}`, 'ok');
        navigate(`/correspondence/composer/${newId}`);
      }
    } catch (e) {
      toast?.error?.(String(e?.message || e)) || toast?.('Ошибка', String(e?.message || e), 'err');
    }
  };

  // ─── Render gate ──────────────────────────────────────────────────────
  if (!user) return null;
  if (!access) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Документы" title="Композер письма" />
        <EmptyState icon="🔒" title="Нет доступа" hint="Раздел доступен офис-менеджерам, директорам и тендерному отделу." />
      </div>
    );
  }
  if (loading) {
    return <div className="card p-32 t-center c-t3">⏳ Загружаем письмо…</div>;
  }

  const readOnly = signingStatus !== 'draft';

  return (
    <div className="col gap-12" style={{ height: 'calc(100vh - var(--topbar-h, 56px) - 24px)' }}>
      <TopActionsBar
        kicker={`Письмо · ${signingStatus === 'draft' ? 'черновик' : signingStatus === 'finalized' ? 'финализировано' : 'отправлено'} · v${versionNo}`}
        title={number ? `${number}` : 'Новое письмо'}
        subtitle={draft.subject || 'Без темы'}
        actions={
          <>
            <Btn variant="ghost" onClick={() => goBackOrFallback(navigate, params.return_to, '/correspondence')}>← Реестр</Btn>
            <Btn
              variant="ghost"
              onClick={() => setSplitView(splitView === 'editor' ? 'preview' : 'editor')}
            >
              {splitView === 'editor' ? '👁 Превью' : '✎ Редактировать'}
            </Btn>
            {signingStatus === 'draft' && (
              <Btn variant="ghost" disabled={saving} onClick={saveNow}>
                {saving ? '💾 Сохраняем…' : '💾 Сохранить'}
              </Btn>
            )}
            {correspondenceId && (
              <>
                <Btn
                  variant="ghost"
                  onClick={() => window.open(renderLetterUrl(correspondenceId, 'docx', { with_signature: draft.signature_on, with_stamp: draft.stamp_on }), '_blank')}
                  title="Скачать DOCX"
                >⬇ DOCX</Btn>
                <Btn
                  variant="ghost"
                  onClick={() => window.open(renderLetterUrl(correspondenceId, 'pdf', { with_signature: draft.signature_on, with_stamp: draft.stamp_on }), '_blank')}
                  title="Скачать PDF"
                >⬇ PDF</Btn>
              </>
            )}
            {canFinalize && (
              <Btn variant="primary" disabled={finalizing} onClick={doFinalize}>
                {finalizing ? '⏳ Финализируем…' : '✓ Финализировать'}
              </Btn>
            )}
            {(signingStatus === 'finalized' || signingStatus === 'sent') && (
              <Btn variant="primary" onClick={doNewRevision}>+ Новая редакция</Btn>
            )}
          </>
        }
      />

      {tplHealth && tplHealth.ok === false ? (
        <div className="card" style={{
          padding: 10,
          background: 'var(--warn-bg)',
          border: '1px solid var(--warn, var(--gold))',
          color: 'var(--t-1)',
          fontSize: 13
        }}>
          ⚠️ Шаблон бланка на сервере не найден ({tplHealth.error || 'templates/customer-letter-tpl.docx'}). DOCX-скачивание может вернуть 500.
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr) minmax(300px, 380px)',
          gap: 12,
          flex: 1,
          minHeight: 0
        }}
      >
        {/* ── Левая колонка: формы шапки + подпись ─────────────────── */}
        <div
          style={{
            overflowY: 'auto',
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}
        >
          <HeaderForm draft={draft} onChange={patchDraft} kinds={kinds} disabled={readOnly} />
          <SignatureBlock draft={draft} onChange={patchDraft} disabled={readOnly} />
          <div style={{ fontSize: 11, color: 'var(--t-3)', padding: 4 }}>
            Исп.: <b>{executorName || '—'}</b>
            {executorPhoneEmail ? <div style={{ marginTop: 2 }}>{executorPhoneEmail}</div> : null}
          </div>
        </div>

        {/* ── Центр: TipTap editor либо Preview ─────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 8 }}>
          {splitView === 'editor' ? (
            <TipTapEditor
              value={draft.body_json}
              htmlFallback={draft.body_html}
              onUpdate={onEditorUpdate}
              readOnly={readOnly}
              editorRefOut={editorRef}
            />
          ) : (
            <div style={{ overflowY: 'auto', padding: 16, background: 'var(--bg1)' }}>
              <LetterPreview
                draft={draft}
                number={number}
                date={draft.date}
                signingStatus={signingStatus}
                executorName={executorName}
                executorPhoneEmail={executorPhoneEmail}
              />
            </div>
          )}
        </div>

        {/* ── Правая колонка: Мимир чат ─────────────────────────────── */}
        <div style={{ minHeight: 0 }}>
          <MimirChat
            correspondenceId={correspondenceId}
            conversationId={conversationId}
            setConversationId={setConversationId}
            model={aiModel}
            onModelChange={setAiModel}
            editorRef={editorRef}
            getCurrentDoc={() => editorRef.current?.getJSON?.() || draft.body_json}
            onAfterEdit={() => {
              try {
                const json = editorRef.current?.getJSON?.();
                const html = editorRef.current?.getHTML?.();
                if (json) setDraft((d) => ({ ...d, body_json: json, body_html: html }));
              } catch { /* noop */ }
            }}
            disabled={readOnly}
          />
        </div>
      </div>
    </div>
  );
}
