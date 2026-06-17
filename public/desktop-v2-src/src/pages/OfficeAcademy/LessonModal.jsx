/**
 * LessonModal — просмотр урока: контент-блоки + кнопки «Прочитал»/«Испытание».
 * Внутри: heartbeat каждые 30с (если вкладка видна), запуск QuizModal.
 */
import { useState, useEffect, useRef } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';

import LessonBlocks from './LessonBlocks';
import { QuizModal } from './QuizModal';
import { loadLesson, heartbeatLesson, completeLesson } from './api';

export function LessonModal({ lessonId, onChanged }) {
  const { close, open } = useModal();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const hbRef = useRef(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    loadLesson(lessonId)
      .then((d) => setData(d))
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [lessonId]);

  // Heartbeat — копит read_time_seconds на бэке (нужно для MIN_READ_SECONDS=60).
  useEffect(() => {
    if (!data?.lesson) return;
    const tick = () => {
      if (document.hidden) return;
      heartbeatLesson(lessonId).catch(() => {});
    };
    hbRef.current = setInterval(tick, 30000);
    return () => { if (hbRef.current) { clearInterval(hbRef.current); hbRef.current = null; } };
  }, [lessonId, data?.lesson]);

  const stopHeartbeat = () => {
    if (hbRef.current) { clearInterval(hbRef.current); hbRef.current = null; }
  };

  if (loading) {
    return (
      <MCard>
        <MHead icon="🏛️" title="Свиток" onClose={() => { stopHeartbeat(); close(); }} />
        <MBody>
          <div className="p-32 t-center c-t3">
            ⏳ Загружаю свиток…
          </div>
        </MBody>
      </MCard>
    );
  }

  if (error) {
    return (
      <MCard>
        <MHead icon="⚠️" title="Не удалось открыть свиток" accent="warn" onClose={() => { stopHeartbeat(); close(); }} />
        <MBody>
          <div className="p-16 c-err">{error}</div>
        </MBody>
        <MFoot>
          <Btn variant="ghost" onClick={() => { stopHeartbeat(); close(); }}>Закрыть</Btn>
          <Btn variant="primary" onClick={refresh}>Повторить</Btn>
        </MFoot>
      </MCard>
    );
  }

  const lesson = data?.lesson || {};
  const questions = data?.questions || [];
  const retry = data?.retry || {};
  const passed = !!lesson.passed;
  const needsReread = retry.needs_reread;

  const onMarkRead = async () => {
    setBusy(true);
    try {
      stopHeartbeat();
      const res = await completeLesson(lessonId);
      if (res?.error === 'read_more') {
        toast.warn(`Подержи свиток открытым ещё — нужно ${res.min_required || 60} сек чтения`);
        // Возобновляем heartbeat — пользователь может ещё подождать
        hbRef.current = setInterval(() => { if (!document.hidden) heartbeatLesson(lessonId).catch(() => {}); }, 30000);
        return;
      }
      if (res?.attempts_reset) {
        toast.success('Попытки сброшены — можешь пройти испытание заново');
      } else {
        toast.success('Свиток отмечен прочитанным');
      }
      onChanged?.();
      close();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onStartQuiz = () => {
    stopHeartbeat();
    close();
    // Открываем новый шаг как отдельную модалку
    open(<QuizModal lessonId={lessonId} questions={questions} onChanged={onChanged} />, { size: 'wide' });
  };

  return (
    <MCard>
      <MHead
        icon={lesson.cover_icon || '🏛️'}
        title={lesson.title || 'Свиток'}
        subtitle={[
          lesson.saga,
          lesson.estimated_minutes ? `⏱ ${lesson.estimated_minutes} мин` : null,
          questions.length > 0 ? `❓ ${questions.length} вопросов` : null,
          passed ? `✓ Сдан · ${lesson.score || 0}%` : null
        ].filter(Boolean).join(' · ')}
        accent={passed ? 'success' : 'default'}
        onClose={() => { stopHeartbeat(); close(); }}
      />
      <MBody>
        {needsReread && (
          <div className="oa-reread-card">
            <div className="oa-reread-title">📖 Перечитай свиток</div>
            <div className="oa-reread-hint">
              Все попытки использованы. Прочитай заново (мин. {retry.min_read_seconds || 60} сек) для новых попыток.
            </div>
          </div>
        )}

        <LessonBlocks blocks={lesson.blocks} />
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => { stopHeartbeat(); close(); }}>Закрыть</Btn>

        {!passed && !needsReread && !lesson.read_completed_at && (
          <Btn variant="success" disabled={busy} onClick={onMarkRead}>
            {busy ? 'Сохраняем…' : '✓ Прочитал'}
          </Btn>
        )}

        {needsReread && (
          <Btn variant="warn" disabled={busy} onClick={onMarkRead}>
            {busy ? 'Сохраняем…' : '✓ Прочитал заново'}
          </Btn>
        )}

        {questions.length > 0 && !needsReread && (
          <Btn variant="primary" onClick={onStartQuiz}>
            {passed ? '🔄 Повторить испытание' : '⚔️ Начать испытание'}
          </Btn>
        )}
      </MFoot>
    </MCard>
  );
}
