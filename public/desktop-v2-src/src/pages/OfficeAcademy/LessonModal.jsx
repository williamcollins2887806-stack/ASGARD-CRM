/**
 * LessonModal — просмотр урока: контент-блоки + рейтинг + «Прочитал»/«Испытание».
 * Внутри: heartbeat каждые 30с (если вкладка видна), запуск QuizModal.
 */
import { useState, useEffect, useRef } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';

import LessonBlocks from './LessonBlocks';
import { QuizModal } from './QuizModal';
import { loadLesson, heartbeatLesson, completeLesson, rateLesson } from './api';

function InterestRating({ value, onChange, disabled }) {
  return (
    <div className="oa-rating" role="group" aria-label="Насколько интересно">
      <span className="oa-rating-label">Интересно?</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={'oa-rating-star' + (value >= n ? ' on' : '')}
          disabled={disabled}
          onClick={() => onChange?.(n)}
          aria-label={`${n} из 5`}
        >
          ★
        </button>
      ))}
      {value ? <span className="oa-rating-val">{value}/5</span> : null}
    </div>
  );
}

export function LessonModal({ lessonId, onChanged }) {
  const { close, open } = useModal();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [readDone, setReadDone] = useState(false);
  const [myScore, setMyScore] = useState(0);
  const [scrollPct, setScrollPct] = useState(0);
  const [chapterLabel, setChapterLabel] = useState('');
  const hbRef = useRef(null);
  const bodyRef = useRef(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    loadLesson(lessonId)
      .then((d) => {
        setData(d);
        setReadDone(!!(d?.lesson?.read_completed_at || d?.lesson?.passed));
        setMyScore(Number(d?.lesson?.my_interest_score) || 0);
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [lessonId]);

  useEffect(() => {
    if (!data?.lesson) return;
    const tick = () => {
      if (document.hidden) return;
      heartbeatLesson(lessonId).catch(() => {});
    };
    hbRef.current = setInterval(tick, 30000);
    return () => { if (hbRef.current) { clearInterval(hbRef.current); hbRef.current = null; } };
  }, [lessonId, data?.lesson]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      const pct = max > 0 ? Math.min(100, Math.round((el.scrollTop / max) * 100)) : 0;
      setScrollPct(pct);
      const chapters = el.querySelectorAll('.oa-chapter-title');
      let label = '';
      chapters.forEach((ch) => {
        const top = ch.getBoundingClientRect().top;
        const bodyTop = el.getBoundingClientRect().top;
        if (top - bodyTop < 80) label = ch.textContent || '';
      });
      setChapterLabel(label);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [data?.lesson]);

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
      const res = await completeLesson(lessonId);
      if (res?.error === 'read_more') {
        toast.warn(`Подержи свиток открытым ещё — нужно ${res.min_required || 60} сек чтения`);
        return;
      }
      if (res?.attempts_reset) {
        toast.success('Попытки сброшены — можешь пройти испытание заново');
      } else {
        toast.success('Свиток отмечен прочитанным');
      }
      setReadDone(true);
      onChanged?.();
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onRate = async (score) => {
    setBusy(true);
    try {
      const res = await rateLesson(lessonId, score);
      setMyScore(res?.my_score || score);
      toast.success('Спасибо за оценку!');
      onChanged?.();
    } catch (e) {
      toast.error(e?.message || 'Не удалось сохранить оценку');
    } finally {
      setBusy(false);
    }
  };

  const onStartQuiz = () => {
    stopHeartbeat();
    close();
    open(<QuizModal lessonId={lessonId} questions={questions} onChanged={onChanged} />, { size: 'wide' });
  };

  return (
    <MCard className="oa-lesson-modal">
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
      <div className="oa-read-progress">
        <div className="oa-read-progress-bar" style={{ width: `${scrollPct}%` }} />
        <div className="oa-read-progress-meta">
          <span>{scrollPct}%</span>
          {chapterLabel ? <span className="oa-read-chapter">{chapterLabel}</span> : null}
        </div>
      </div>
      <MBody className="oa-lesson-body-wrap">
        <div ref={bodyRef} className="oa-lesson-body">
        {needsReread && (
          <div className="oa-reread-card">
            <div className="oa-reread-title">📖 Перечитай свиток</div>
            <div className="oa-reread-hint">
              Все попытки использованы. Прочитай заново (мин. {retry.min_read_seconds || 60} сек) для новых попыток.
            </div>
          </div>
        )}

        <LessonBlocks blocks={lesson.blocks} />
        </div>
      </MBody>
      <MFoot>
        <div className="oa-lesson-foot">
          {(readDone || passed) && (
            <InterestRating value={myScore} onChange={onRate} disabled={busy} />
          )}
          <div className="oa-lesson-foot-actions">
            <Btn variant="ghost" onClick={() => { stopHeartbeat(); close(); }}>Закрыть</Btn>

            {!passed && !needsReread && !readDone && (
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
          </div>
        </div>
      </MFoot>
    </MCard>
  );
}
