/**
 * Страница /awaiting-customer — Просчёты в ожидании заказчика.
 *
 * Источник: vanilla `public/conductor-estimate.html` + `public/awaiting-customer.html`
 *           + `public/assets/js/awaiting-customer.js` (266 строк).
 * Backend: /api/mimir/conductor/awaiting-customer + letter/*.
 *
 *   ✅ Список просчётов BLOCKED_BY_CUSTOMER с днями ожидания
 *   ✅ Скачивание PDF/DOCX (через blob)
 *   ✅ "Сформировать письмо" (если ещё не было)
 *   ✅ "Отметить отправленным" / "Получен ответ"
 *   ✅ ReplyModal: парсинг ответа + разметка вопросов
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';

import {
  loadAwaiting, loadRun, generateLetter, markLetterSent, downloadLetter,
} from './api';
import { ReplyModal } from './ReplyModal';

import './awaiting-customer.css';

// RBAC синхронно с backend `src/routes/mimir-conductor.js:30` (ALLOWED_ROLES + ADMIN).
// Conductor запускают PM/HEAD_PM/TO/HEAD_TO/директора — у них же в очереди ответы заказчика.
const ALLOWED_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function AwaitingCustomerPage() {
  const { user } = useAuth();
  const modal = useModal();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // v2 BONUS: сортировка/фильтр по дням ожидания (vanilla не имеет)
  const [sortMode, setSortMode] = useState('hottest_first'); // hottest_first | newest_first | open_questions
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  const refresh = () => {
    setLoading(true);
    loadAwaiting()
      .then((d) => setItems(d?.items || []))
      .catch((e) => toast.error('Ошибка загрузки: ' + String(e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  // v2 BONUS: hotkeys (R обновить, O горячие только, S переключение сортировки) — vanilla не имеет
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'r') refresh();
      else if (e.key === 'o') setOnlyOverdue((v) => !v);
      else if (e.key === 's') setSortMode((s) =>
        s === 'hottest_first' ? 'newest_first' :
        s === 'newest_first' ? 'open_questions' : 'hottest_first');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // v2 BONUS: visible с применением сортировки + фильтра (vanilla показывал как было)
  const visibleItems = (() => {
    let v = items;
    if (onlyOverdue) v = v.filter((i) => (i.days_waiting ?? 0) >= 5);
    if (sortMode === 'hottest_first') v = [...v].sort((a, b) => (b.days_waiting ?? 0) - (a.days_waiting ?? 0));
    else if (sortMode === 'newest_first') v = [...v].sort((a, b) => (a.days_waiting ?? 0) - (b.days_waiting ?? 0));
    else if (sortMode === 'open_questions') v = [...v].sort((a, b) => (b.open_questions || 0) - (a.open_questions || 0));
    return v;
  })();

  const onDownload = async (letterId, format) => {
    try {
      const blob = await downloadLetter(letterId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `letter_${letterId}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Не удалось скачать: ' + String(e?.message || e));
    }
  };

  const onGenLetter = async (runId) => {
    try {
      const det = await loadRun(runId);
      const ids = (det?.clarifications || [])
        .filter((c) => c.channel === 'CUSTOMER' && c.status === 'OPEN')
        .map((c) => c.id);
      if (!ids.length) {
        toast.warn('Открытых вопросов к заказчику не найдено');
        return;
      }
      const res = await generateLetter(runId, ids);
      toast.success('Письмо сформировано: исх. № ' + res.letterNumber);
      refresh();
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    }
  };

  const onMarkSent = async (letterId) => {
    try {
      await markLetterSent(letterId, 'manual');
      toast.success('Письмо отмечено отправленным');
      refresh();
    } catch (e) {
      toast.error('Ошибка: ' + String(e?.message || e));
    }
  };

  const onUploadReply = (letterId) => {
    modal.open(<ReplyModal letterId={letterId} onApplied={refresh} />, { size: 'wide' });
  };

  // Inline-RBAC-гейт после всех хуков (Rules of Hooks).
  if (user && !ALLOWED_ROLES.includes(user.role)) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Просчёты в ожидании заказчика — нет доступа"
        message="Раздел открыт PM/HEAD_PM, ТО/HEAD_TO, директорам и ADMIN — тем, кто запускает Conductor."
      />
    );
  }

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Conductor"
        title="📭 Просчёты в ожидании заказчика"
        subtitle={loading ? 'Загрузка…' : `${visibleItems.length} из ${items.length} в очереди · сортировка: ${sortMode === 'hottest_first' ? 'горячие сверху' : sortMode === 'newest_first' ? 'свежие сверху' : 'по вопросам'}`}
        actions={
          <>
            {/* v2 BONUS: переключатели сортировки и фильтра (vanilla не имел) */}
            <Btn
              variant={onlyOverdue ? 'primary' : 'ghost'}
              onClick={() => setOnlyOverdue((v) => !v)}
              title="O — только просрочка ≥5 дн."
            >
              {onlyOverdue ? '🔥 Только горящие' : '🔥 Горящие'}
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => setSortMode((s) =>
                s === 'hottest_first' ? 'newest_first' :
                s === 'newest_first' ? 'open_questions' : 'hottest_first')}
              title="S — циклическое переключение"
            >
              {sortMode === 'hottest_first' ? '⏳ Горячие ↑' : sortMode === 'newest_first' ? '🕐 Свежие ↑' : '❓ Вопросы ↑'}
            </Btn>
            <Btn variant="ghost" onClick={refresh} title="R">↻ Обновить</Btn>
          </>
        }
      />

      {loading ? (
        <div className="card t-center p-32 c-t3" >
          ⏳ Загружаю…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🎉"
          title="Нет ожидающих просчётов"
          hint="Все ответы заказчиков получены — просчёты идут своим ходом."
        />
      ) : (
        <div className="ac-list">
          {/* v2 BONUS: visibleItems с сортировкой/фильтром */}
          {visibleItems.map((it) => {
            const days = it.days_waiting ?? 0;
            const daysCls = days >= 10 ? ' danger' : (days >= 5 ? ' warn' : '');
            const title = it.tender_title || ('Просчёт #' + it.run_id);
            return (
              <div className="ac-card" key={it.run_id}>
                <div className="ac-card-head">
                  <div className="ac-card-title">{title}</div>
                  <span className={'ac-days' + daysCls}>⏳ {days} дн.</span>
                </div>
                <div className="ac-card-sub">
                  Заказчик: <b>{it.customer_name || '—'}</b> · открытых вопросов: {it.open_questions || 0}
                </div>

                {it.letter_id ? (
                  <div className="ac-letter">
                    <div className="ac-letter-text">
                      📄 Письмо <b>{it.letter_number || ''}</b> — <i>{it.letter_status || '—'}</i>
                    </div>
                    <div className="ac-letter-btns">
                      <Btn variant="ghost" size="sm" onClick={() => onDownload(it.letter_id, 'pdf')}>PDF</Btn>
                      <Btn variant="ghost" size="sm" onClick={() => onDownload(it.letter_id, 'docx')}>DOCX</Btn>
                      {it.letter_status === 'DRAFTED' ? (
                        <Btn variant="primary" size="sm" onClick={() => onMarkSent(it.letter_id)}>✉ Отметить отправленным</Btn>
                      ) : (
                        <Btn variant="primary" size="sm" onClick={() => onUploadReply(it.letter_id)}>📥 Получен ответ</Btn>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="ac-letter">
                    <div className="ac-letter-text">
                      Письмо ещё не сформировано. Открытых вопросов: {it.open_questions || 0}
                    </div>
                    <Btn variant="primary" size="sm" onClick={() => onGenLetter(it.run_id)}>📄 Сформировать письмо</Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
