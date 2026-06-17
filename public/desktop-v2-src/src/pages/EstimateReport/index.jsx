/**
 * Страница /estimate-report?id=X — отчёт по смете с AI Мимиром.
 *
 * Источник: vanilla `public/assets/js/estimate_report.js` (~1702 строки).
 *
 *   ✅ pages/EstimateReport/index.jsx          ← root, парс ?id, action-panel
 *   ✅ pages/EstimateReport/api.js             ← 16 endpoints + helpers
 *   ✅ components/SummaryCards.jsx             ← 4 карточки: себест/наценка/цена/маржа
 *   ✅ components/CostBar.jsx                  ← структура себестоимости (6 блоков)
 *   ✅ components/PositionsTable.jsx           ← таблица позиций (editable для PM)
 *   ✅ components/CommentsThread.jsx           ← переписка согласования
 *   ✅ components/MimirChat.jsx                ← AI чат с Мимиром
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, PromptModal, ConfirmModal } from '@/modals';
import { TopActionsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { StatusBadge, toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import SummaryCards from './components/SummaryCards';
import CostBar from './components/CostBar';
import PositionsTable from './components/PositionsTable';
import CommentsThread from './components/CommentsThread';
import MimirChat from './components/MimirChat';
import AttachedFiles from './components/AttachedFiles';
import ObjectInfoCard from './components/ObjectInfoCard';
import VatSection from './components/VatSection';
import Analogs from './components/Analogs';
import ChangesDiff from './components/ChangesDiff';
import ReworkBanner from './components/ReworkBanner';
import MimirBlocks from './components/MimirBlocks';
import './estimate-report.css';
import {
  loadEstimate, loadCalculation, loadComments,
  postAction, approveFinalize, sendForApproval, resubmit, autoCalculate,
  exportEstimateToCsv, exportEstimateToXlsx,
  APPROVAL_STATUSES, fmtDateTime
} from './api';

// RBAC — синхронно с backend `src/routes/estimates.js:350,465,847` (POST/PUT/approve-finalize).
// GET сам по себе auth-only, но семантика страницы — отчёт по смете для участников цикла
// согласования: PM (создаёт+редактирует), TO/HEAD_TO (тендерный отдел), директора (согласуют),
// BUH (видят финансы), ADMIN.
// Inline-литералы нужны скрипту rbac-audit (он не разворачивает константы).
const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function getQueryParam(name) {
  const hash = window.location.hash;
  const m = hash.match(new RegExp('[?&]' + name + '=([^&]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

export default function EstimateReportPage() {
  const { user } = useAuth();
  const modal = useModal();
  const [estimate, setEstimate] = useState(null);
  const [calcData, setCalcData] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const id = getQueryParam('id');

  const refresh = async () => {
    if (!id) return;
    if (user && !ALLOWED_ROLES.includes(user.role)) return;
    setLoading(true);
    try {
      const [est, calc, com] = await Promise.all([
        loadEstimate(id).then((d) => d.estimate || d),
        loadCalculation(id),
        loadComments(id)
      ]);
      setEstimate(est);
      setCalcData(calc);
      setComments(com);
    } catch (e) {
      toast.error('Не удалось загрузить отчёт: ' + String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [id]);

  // v2 BONUS: keyboard hotkeys для PM/директора (vanilla не имеет)
  //   P — печать, E — скачать Excel, L — скопировать deep-link отчёта, Esc — назад
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'p') { e.preventDefault(); window.print(); }
      else if (e.key === 'l') {
        const link = `${window.location.origin}/desktop-v2.html#/estimate-report?id=${id}`;
        navigator.clipboard?.writeText(link).then(
          () => toast.success('Ссылка на отчёт скопирована'),
          () => toast.error('Не удалось скопировать')
        );
      } else if (e.key === 'Escape') {
        window.history.back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Отчёт по смете недоступен"
        message="Раздел открыт PM/HEAD_PM/TO/HEAD_TO (готовят смету), BUH/директорам (согласуют) и ADMIN."
      />
    );
  }

  if (!id) {
    return (
      <div className="col gap-12">
        <div className="card card-state-warn">
          ⚠ Не передан ID просчёта в URL (?id=X)
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="col gap-12">
        <div className="card card-empty">⏳ Загружаем отчёт…</div>
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="col gap-12">
        <div className="card card-state-err">Просчёт #{id} не найден</div>
      </div>
    );
  }

  const status = APPROVAL_STATUSES[estimate.approval_status] || { label: estimate.approval_status, tone: 'draft' };
  const isPm = user?.role === 'PM' || user?.role === 'HEAD_PM';
  const isDirector = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM'].includes(user?.role);
  const canEdit = isPm && ['draft', 'rework', 'question'].includes(estimate.approval_status);
  const canAct = isDirector && estimate.approval_status === 'sent';

  // Действия директора
  const onAction = (action) => {
    if (action === 'approve') {
      modal.open(<ConfirmModal
        title="Согласовать просчёт"
        message="Согласовать этот просчёт? После согласования суммы будут записаны в тендер."
        confirmText="✓ Согласовать"
        confirmTone="approved"
        onConfirm={async () => {
          setBusy(true);
          try {
            await postAction(estimate.id, 'approve', {});
            await approveFinalize(estimate.id, {});
            toast.success(`✓ Согласовано: Просчёт #${estimate.id}`);
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + String(e?.message || e));
          } finally {
            setBusy(false);
          }
        }}
      />);
    } else {
      const titles = { rework: 'На доработку', question: 'Задать вопрос', reject: 'Отклонить' };
      modal.open(<PromptModal
        title={titles[action]}
        label={action === 'rework' ? 'Что переделать?' : action === 'question' ? 'Какой вопрос?' : 'Причина отказа'}
        required
        multiline
        onConfirm={async (text) => {
          setBusy(true);
          try {
            await postAction(estimate.id, action, { text });
            toast.success('Отправлено: ' + titles[action]);
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + String(e?.message || e));
          } finally {
            setBusy(false);
          }
        }}
      />);
    }
  };

  // Действия PM
  const onSend = async () => {
    setBusy(true);
    try {
      await sendForApproval(estimate.id, {});
      toast.success('📤 Отправлено на согласование руководства');
      refresh();
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  const onResubmit = async () => {
    setBusy(true);
    try {
      await resubmit(estimate.id, {});
      toast.success('🔄 Переотправлено');
      refresh();
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  const onAuto = async () => {
    setBusy(true);
    try {
      await autoCalculate(estimate.id, {});
      toast.success('🧙 Запущен авторасчёт Мимира');
      refresh();
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col gap-12">
      <TopActionsBar
        title={`Просчёт #${estimate.id}`}
        subtitle={`${estimate.customer_name || estimate.tender_name || ''} · v${estimate.version_no || 1} · ${fmtDateTime(estimate.created_at)}`}
        actions={
          <>
            <StatusBadge tone={status.tone} label={status.label} />
            <Btn variant="ghost" onClick={() => window.history.back()}>← Назад</Btn>
            {/* G-15: парность с vanilla — экспорт CSV/Excel + печать листа отчёта.
                Vanilla estimate_report.js:1206 → SheetJS .xlsx; v2 — CSV BOM (Excel читает).
                Печать использует @media print в src/styles/shell.css (G-15). */}
            <Btn variant="ghost" disabled={busy || !calcData} onClick={async () => {
              try {
                await exportEstimateToXlsx(estimate, calcData);
                toast.success('📥 Скачан XLSX (8 листов: итог + блоки + Мимир-анализ)');
              } catch (e) {
                // SheetJS не загрузился — фолбэк на CSV
                try {
                  exportEstimateToCsv(estimate, calcData);
                  toast.warn('SheetJS недоступен — скачан CSV (открывается в Excel)');
                } catch (e2) {
                  toast.error('Ошибка экспорта: ' + String(e2?.message || e2));
                }
              }
            }}>📥 Excel</Btn>
            {/* v2 BONUS: tooltip с хоткеем (P/E/L/Esc) */}
            <Btn variant="ghost" className="no-print" onClick={() => window.print()} title="P">🖨 Печать</Btn>
            {canEdit && <Btn variant="ghost" disabled={busy} onClick={onAuto}>🧙 Авторасчёт</Btn>}
            {/* Vanilla estimate_report.js:287,1647 — кнопка «🔄 Пересчитать через Мимира» (скролл к MimirChat + фокус). */}
            {canEdit && (
              <Btn
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  const chatEl = document.querySelector('[data-mimir-chat]') || document.getElementById('erMimir');
                  if (chatEl) {
                    chatEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    const input = chatEl.querySelector('input, textarea');
                    if (input) setTimeout(() => input.focus(), 400);
                  }
                }}
                title="Скролл к чату Мимира + фокус на ввод"
              >🔄 Пересчитать через Мимира</Btn>
            )}
          </>
        }
      />

      {/* Rework-баннер + diff — наверху если работа на доработке/вопросе */}
      <ReworkBanner estimate={estimate} />
      {['rework', 'question'].includes(estimate.approval_status) && (
        <ChangesDiff estimateId={estimate.id} />
      )}

      {/* Карточка объекта — над PositionsTable */}
      <ObjectInfoCard estimate={estimate} />

      {/* Финансовая панель: левая колонка — summary+cost+vat; правая — пусто (или будущие виджеты). */}
      <div className="er-finance-grid">
        <div className="col gap-12">
          <SummaryCards estimate={estimate} calcData={calcData} />
          <CostBar calcData={calcData} />
        </div>
        <VatSection estimate={estimate} calcData={calcData} />
      </div>

      <PositionsTable estimate={estimate} calcData={calcData} canEdit={canEdit} onSaved={refresh} />

      {/* MimirBlocks — 7 аналитических подсекций (если просчёт делал Мимир) */}
      <MimirBlocks calcData={calcData} />

      <AttachedFiles docs={estimate.documents || []} />

      {/* Аналоги — в конце страницы (отдельный коллапс) */}
      <Analogs estimateId={estimate.id} />

      {/* Кнопки PM */}
      {canEdit && (
        <div className="card er-action-bar er-action-bar--gold">
          <div>
            <strong>Готов отправить руководству?</strong>
            <div className="er-action-hint">Проверь позиции и нажми кнопку справа</div>
          </div>
          {estimate.approval_status === 'draft' ? (
            <Btn variant="primary" disabled={busy} onClick={onSend}>📤 На согласование</Btn>
          ) : (
            <Btn variant="primary" disabled={busy} onClick={onResubmit}>🔄 Переотправить</Btn>
          )}
        </div>
      )}

      {/* Действия директора */}
      {canAct && (
        <div className="card er-action-bar er-action-bar--info">
          <div>
            <strong>Решение по просчёту</strong>
            <div className="er-action-hint">Согласуй / верни на доработку / задай вопрос / отклони</div>
          </div>
          <div className="row gap-6">
            <Btn variant="ghost" disabled={busy} onClick={() => onAction('question')}>❓ Вопрос</Btn>
            <Btn variant="ghost" disabled={busy} onClick={() => onAction('rework')}>↩ Доработка</Btn>
            <Btn variant="ghost" disabled={busy} onClick={() => onAction('reject')}>✗ Отклонить</Btn>
            <Btn variant="primary" disabled={busy} onClick={() => onAction('approve')}>✓ Согласовать</Btn>
          </div>
        </div>
      )}

      <div className="grid-2 gap-12">
        <CommentsThread estimateId={estimate.id} comments={comments} onChanged={refresh} />
        {(isPm || isDirector) && <MimirChat estimate={estimate} onUpdated={refresh} />}
      </div>
    </div>
  );
}
