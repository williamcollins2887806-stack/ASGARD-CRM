/**
 * Страница /head-to-approvals — очередь согласования просчётов ТО (Рук. ТО, Хосе).
 *
 * RBAC inline (для аудита):
 *   • HEAD_TO  — основной получатель
 *   • ADMIN    — может всё
 *   • Остальным — доступ закрыт
 *
 * Источник: vanilla `public/assets/js/head_to_approvals.js` (217 строк).
 *
 * Действия (через generic /api/approval/estimates/:id/*):
 *   ✓ Согласовать  (комментарий опционально)
 *   ↻ На доработку (комментарий обязателен)
 *   ❓ Вопрос       (комментарий обязателен)
 *   ✕ Отклонить    (комментарий обязателен)
 *
 * Бэкенд знает, что для kind='to' согласует HEAD_TO.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, PromptModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar } from '@/blocks/Blocks';

import {
  loadPendingQueue,
  approveEstimate, reworkEstimate, questionEstimate, rejectEstimate,
  fmtMoney, fmtDateTime
} from './api';
import './head-to-approvals.css';

export default function HeadToApprovalsPage() {
  const { user } = useAuth();
  const modal = useModal();

  // RBAC inline — литералы для аудита.
  const canAccess = ['HEAD_TO', 'ADMIN'].includes(user?.role);

  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!canAccess) { setLoading(false); return; }
    setLoading(true);
    try {
      const items = await loadPendingQueue();
      setQueue(items);
    } catch (e) {
      toast.error('Не удалось загрузить очередь: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [user?.id, user?.role]);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:tenders:changed', onChanged);
    window.addEventListener('asgard:estimates:changed', onChanged);
    return () => {
      window.removeEventListener('asgard:tenders:changed', onChanged);
      window.removeEventListener('asgard:estimates:changed', onChanged);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // v2 BONUS: hotkey R обновить очередь (vanilla не имеет)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'r') refresh();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v2 BONUS: сортировка очереди — старейшие отправки сверху (vanilla — в порядке backend, который случаен)
  const [sortMode, setSortMode] = useState('oldest_first');
  const sortedQueue = (sortMode === 'oldest_first'
    ? [...queue].sort((a, b) => new Date(a.estimate.sent_for_approval_at) - new Date(b.estimate.sent_for_approval_at))
    : sortMode === 'newest_first'
      ? [...queue].sort((a, b) => new Date(b.estimate.sent_for_approval_at) - new Date(a.estimate.sent_for_approval_at))
      : queue);

  const onApprove = (estId) => {
    modal.open(
      <PromptModal
        title="Согласовать просчёт"
        label="Комментарий (необязательно)"
        placeholder="Например: «Маржа в порядке, можно делать ТКП»"
        multiline
        required={false}
        okText="✓ Согласовать"
        accent="success"
        icon="✓"
        onSubmit={async (cmt) => {
          try {
            await approveEstimate(estId, cmt || '');
            toast.success('Просчёт согласован');
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onRework = (estId) => {
    modal.open(
      <PromptModal
        title="Отправить на доработку"
        label="Что нужно доработать"
        placeholder="Опишите, что нужно изменить"
        multiline
        required
        okText="↻ На доработку"
        accent="warning"
        icon="↻"
        onSubmit={async (cmt) => {
          try {
            await reworkEstimate(estId, cmt);
            toast.success('Отправлено на доработку');
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onQuestion = (estId) => {
    modal.open(
      <PromptModal
        title="Задать вопрос ТО"
        label="Ваш вопрос"
        placeholder="Например: «По какой методике считаешь химию?»"
        multiline
        required
        okText="❓ Задать вопрос"
        accent="info"
        icon="❓"
        onSubmit={async (cmt) => {
          try {
            await questionEstimate(estId, cmt);
            toast.success('Вопрос отправлен ТО');
            refresh();
          } catch (e) {
            toast.error('Ошибка: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  const onReject = (estId) => {
    modal.open(
      <PromptModal
        title="Отклонить просчёт"
        label="Причина отклонения"
        placeholder="Опишите причину"
        multiline
        required
        okText="✕ Отклонить"
        accent="danger"
        icon="✕"
        onSubmit={async (cmt) => {
          modal.open(
            <ConfirmModal
              title="Точно отклонить?"
              message="Просчёт будет переведён в статус «Отклонён». Это решение можно изменить только новым просчётом."
              tone="danger"
              okText="Да, отклонить"
              onConfirm={async () => {
                try {
                  await rejectEstimate(estId, cmt);
                  toast.success('Просчёт отклонён');
                  refresh();
                } catch (e) {
                  toast.error('Ошибка: ' + (e?.message || e));
                }
              }}
            />
          );
        }}
      />
    );
  };

  const onOpenTender = (tid) => {
    window.location.hash = `#/tenders?id=${tid}`;
  };

  if (!canAccess) {
    return (
      <div className="card p-28 t-center" >
        <div className="fs-30">🔒</div>
        <h3 className="mt-10">Доступно только Рук. тендерного отдела</h3>
        <div className="c-t3">
          Эта очередь — для HEAD_TO (Хосе) и ADMIN.
          Обычные согласования РП → у директоров (страница «Согласования»).
        </div>
      </div>
    );
  }

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Тендерный отдел"
        title="Согласование просчётов ТО"
        subtitle={`Хосе, на твоё решение ждут: ${queue.length}`}
        actions={
          <>
            {/* v2 BONUS: переключение сортировки и hotkey hint (vanilla не имеет) */}
            <Btn
              variant="ghost"
              onClick={() => setSortMode((s) => s === 'oldest_first' ? 'newest_first' : 'oldest_first')}
              title={sortMode === 'oldest_first' ? 'Старейшие сверху' : 'Новейшие сверху'}
            >
              {sortMode === 'oldest_first' ? '⏰ Старые ↑' : '🕐 Новые ↑'}
            </Btn>
            <Btn variant="ghost" onClick={refresh} title="R">↻ Обновить</Btn>
          </>
        }
      />

      <div className="hta-intro">
        <h2>📋 Согласование просчётов тендерного отдела</h2>
        <p>
          Здесь только те просчёты, которые ТО считал САМ (calculator_kind='to') и
          отправил на твоё согласование. Обычные просчёты РП по-прежнему идут директорам.
        </p>
      </div>

      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаем очередь…
        </div>
      ) : queue.length === 0 ? (
        <div className="hta-empty">
          <div className="fs-36">📭</div>
          <h3>Очередь пуста</h3>
          <div>Ждём отправок от ТО.</div>
        </div>
      ) : (
        <>
          <div className="hta-list-header">
            <h3>К рассмотрению</h3>
            <span className="cnt">{queue.length}</span>
          </div>
          {/* v2 BONUS: используем sortedQueue вместо queue */}
          {sortedQueue.map(({ tender: t, estimate: e }) => {
            const sum = e.price_tkp || e.total_sum || t.tender_price;
            const margin = e.margin_pct || e.margin_percent;
            return (
              <div key={e.id} className="hta-card">
                <div>
                  <div className="hta-card-title">
                    {(t.customer_name || '—') + ' — ' + (t.tender_title || '')}
                  </div>
                  <div className="hta-card-sub">
                    Тип: <b>{t.tender_type || '—'}</b>
                    {' · Сумма ТКП: '}<b>{fmtMoney(sum)}</b>
                    {margin ? <> · Маржа: <b>{margin}%</b></> : null}
                  </div>
                  <div className="hta-card-meta">
                    Просчёт #{e.id}, версия {e.version_no || e.version || 1},
                    отправлен {fmtDateTime(e.sent_for_approval_at)}
                  </div>
                </div>
                <div className="hta-card-actions">
                  <Btn variant="success" size="sm" onClick={() => onApprove(e.id)}>
                    ✓ Согласовать
                  </Btn>
                  <Btn variant="warn" size="sm" onClick={() => onRework(e.id)}>
                    ↻ Доработать
                  </Btn>
                  <Btn variant="info" size="sm" onClick={() => onQuestion(e.id)}>
                    ❓ Вопрос
                  </Btn>
                  <Btn variant="danger" size="sm" onClick={() => onReject(e.id)}>
                    ✕ Отклонить
                  </Btn>
                  <Btn variant="ghost" size="sm" onClick={() => onOpenTender(t.id)}>
                    📝 Карточка
                  </Btn>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
