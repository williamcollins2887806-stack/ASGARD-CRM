/**
 * QuizModal — испытание с переходом к результатам в одной модалке.
 * Шаги:
 *   1) ввод ответов (форма)
 *   2) разбор ответов (после submitQuiz)
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';

import { submitQuiz } from './api';
// КРУГ A п.5: убран статический import LessonModal — это создавало циклическую
// зависимость с LessonModal.jsx → QuizModal.jsx → LessonModal.jsx.
// Используется dynamic import при клике «Перечитать свиток».

export function QuizModal({ lessonId, questions, onChanged }) {
  const { close, open } = useModal();
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  // result = { score, passed, correct, total, feedback, xp, retry }

  const setAnswer = (qid, oi) => setAnswers((a) => ({ ...a, [qid]: oi }));

  const onSubmit = async () => {
    // Проверка — все вопросы отвечены
    const unanswered = questions.filter((q) => answers[q.id] === undefined);
    if (unanswered.length > 0) {
      toast.warn(`Ответь на все вопросы (${unanswered.length} без ответа)`);
      return;
    }

    setBusy(true);
    try {
      const payload = {};
      questions.forEach((q) => { payload[q.id] = answers[q.id]; });
      const r = await submitQuiz(lessonId, payload);
      setResult(r);
      // Не закрываем — переключаемся на экран результатов
      onChanged?.();
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('needs_reread')) {
        toast.warn('Перечитай свиток для новых попыток');
        close();
      } else {
        toast.error('Испытание: ' + msg);
      }
    } finally {
      setBusy(false);
    }
  };

  // ── Экран результатов ──
  if (result) {
    const passed = !!result.passed;
    const score = result.score || 0;
    const feedback = result.feedback || [];
    const retry = result.retry || {};
    const heroIcon = passed ? (score === 100 ? '🏆' : '⚔️') : '🛡️';

    return (
      <MCard>
        <MHead
          icon={passed ? '⚔️' : '🛡️'}
          title={passed ? 'Победа!' : 'Результат'}
          accent={passed ? 'success' : 'warn'}
          onClose={() => close()}
        />
        <MBody>
          <div className="oa-result-hero">
            <div className="oa-result-icon">{heroIcon}</div>
            <div className={'oa-result-score ' + (passed ? 'ok' : 'fail')}>{score}%</div>
            <div className="oa-result-label">{passed ? 'Испытание пройдено!' : 'Ещё не готов…'}</div>
            <div className="oa-result-sub">{result.correct} из {result.total} правильных</div>
            {result.xp > 0 && (
              <div className="oa-result-xp">⚡ +{result.xp} XP</div>
            )}
          </div>

          {!passed && retry.needs_reread && (
            <div className="oa-reread-card">
              <div className="oa-reread-title">📖 Перечитай свиток для новых попыток</div>
            </div>
          )}
          {!passed && !retry.needs_reread && (
            <div className="oa-feedback info">
              ⚔️ Осталось попыток: {retry.attempts_left || 0} из {retry.max_attempts || 2}
            </div>
          )}

          <div className="oa-result-section-title mt-18" >📋 Разбор ответов</div>

          {questions.map((q, qi) => {
            const fb = feedback.find((f) => f.question_id === q.id) || {};
            const isCorrect = !!fb.is_correct;
            const correctIdx = typeof fb.correct_index === 'number' ? fb.correct_index : -1;
            const selectedIdx = answers[q.id];
            const opts = Array.isArray(q.options) ? q.options : [];

            return (
              <div key={q.id} className="oa-q" style={{ borderColor: isCorrect ? 'var(--ok-t)' : 'var(--err-t)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                  <span className="fs-16">{isCorrect ? '✅' : '❌'}</span>
                  <div className="oa-q-text mb-0" >
                    <span className="c-t3">{qi + 1}.</span> {q.question_text || ''}
                  </div>
                </div>
                {opts.map((opt, oi) => {
                  const isSelected = selectedIdx === oi;
                  const isCorrOpt = oi === correctIdx;
                  const cls = isCorrOpt ? 'correct' : (isSelected && !isCorrOpt ? 'wrong' : '');
                  return (
                    <div key={oi} className={'oa-q-opt readonly ' + cls}>
                      <span className="fs-13">
                        {isCorrOpt ? '✓' : isSelected ? '✗' : '○'}
                      </span>
                      <span style={{ fontWeight: isCorrOpt || isSelected ? 600 : 400 }}>
                        {opt.text || ''}
                      </span>
                    </div>
                  );
                })}
                {fb.explanation && (
                  <div className="oa-feedback info">💡 {fb.explanation}</div>
                )}
              </div>
            );
          })}
        </MBody>
        <MFoot>
          <Btn variant="ghost" onClick={() => close()}>Закрыть</Btn>
          {retry.needs_reread && (
            <Btn
              variant="warn"
              onClick={async () => {
                close();
                // Динамический импорт убирает циклическую зависимость на уровне модуля.
                const { LessonModal } = await import('./LessonModal');
                setTimeout(() => open(<LessonModal lessonId={lessonId} onChanged={onChanged} />, { size: 'wide' }), 100);
              }}
            >
              📖 Перечитать свиток
            </Btn>
          )}
        </MFoot>
      </MCard>
    );
  }

  // ── Экран ввода ответов ──
  return (
    <MCard>
      <MHead
        icon="⚔️"
        title="Испытание"
        subtitle={`Проходной балл: 80% · ${questions.length} вопросов`}
        accent="default"
        onClose={() => close()}
      />
      <MBody>
        {questions.map((q, i) => {
          const opts = Array.isArray(q.options)
            ? q.options
            : (typeof q.options === 'string'
                ? (() => { try { return JSON.parse(q.options); } catch { return []; } })()
                : []);

          return (
            <div key={q.id} className="oa-q">
              <div className="oa-q-text">{i + 1}. {q.question_text || ''}</div>
              {opts.map((opt, oi) => (
                <label key={oi} className="oa-q-opt">
                  <input
                    type="radio"
                    name={`q_${q.id}`}
                    value={oi}
                    checked={answers[q.id] === oi}
                    onChange={() => setAnswer(q.id, oi)}
                  />
                  <span>{opt.text || ''}</span>
                </label>
              ))}
            </div>
          );
        })}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()}>Отмена</Btn>
        <Btn variant="primary" disabled={busy} onClick={onSubmit}>
          {busy ? 'Отправляем…' : '⚔️ Сдать испытание'}
        </Btn>
      </MFoot>
    </MCard>
  );
}
