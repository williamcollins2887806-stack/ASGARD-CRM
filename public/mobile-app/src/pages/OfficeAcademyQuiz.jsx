import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api/client';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

const QUIZ_TIME_LIMIT = 20 * 60; // 20 minutes in seconds

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// QUIZ TIMER
// ═══════════════════════════════════════════════════════════════
function QuizTimer({ seconds, total }) {
  const remaining = Math.max(0, total - seconds);
  const pct = (remaining / total) * 100;
  const color = remaining < 120 ? C.red : remaining < 300 ? C.amber : C.muted;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        ⏱ {fmtTime(remaining)}
      </span>
      <div style={{ width: 40, height: 4, background: '#ffffff0d', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', background: color, borderRadius: 2,
          width: `${pct}%`, transition: 'width 1s linear',
        }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RESULT SCREEN
// ═══════════════════════════════════════════════════════════════
function ResultScreen({ result, questions, answers, lessonId, navigate }) {
  const { score, passed, correct, total, feedback = [], xp = 0, retry = {} } = result;
  const needsReread = retry.needs_reread;
  const attemptsLeft = retry.attempts_left;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 40 }}>
      {/* Hero */}
      <div style={{
        padding: '52px 16px 24px', textAlign: 'center',
        background: `linear-gradient(180deg, ${passed ? '#0d1a0d' : '#1a0d0d'} 0%, transparent 100%)`,
      }}>
        <div style={{ fontSize: 64, marginBottom: 12 }}>
          {passed ? (score === 100 ? '🏆' : '⚔️') : '🛡️'}
        </div>
        <div style={{
          fontSize: 48, fontWeight: 900,
          color: passed ? C.green : C.amber,
          lineHeight: 1,
        }}>
          {score}%
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginTop: 8 }}>
          {passed
            ? (score === 100 ? 'Безупречная победа!' : 'Испытание пройдено!')
            : 'Ещё не готов...'}
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
          {correct} из {total} правильных · проходной балл {retry.pass_threshold || 80}%
        </div>

        {/* XP reward */}
        {passed && xp > 0 && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: C.rune + '20', border: `1px solid ${C.rune}40`,
            borderRadius: 20, padding: '6px 16px', marginTop: 12,
          }}>
            <span style={{ fontSize: 18 }}>⚡</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: C.rune }}>+{xp} XP</span>
          </div>
        )}
      </div>

      {/* Retry info */}
      {!passed && (
        <div style={{
          margin: '0 16px 16px',
          background: needsReread ? C.amber + '12' : C.blue + '12',
          border: `1px solid ${needsReread ? C.amber : C.blue}35`,
          borderRadius: 14, padding: '14px 16px',
        }}>
          {needsReread ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.amber, marginBottom: 4 }}>
                📖 Перечитай свиток
              </div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                Все попытки использованы. Вернись к свитку, прочитай его заново (минимум 60 сек),
                и получишь 2 новые попытки.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: C.blue }}>
              ⚔️ Осталось попыток: {attemptsLeft} из {retry.max_attempts}
            </div>
          )}
        </div>
      )}

      {/* Per-question feedback */}
      <div style={{ padding: '0 16px 20px' }}>
        <div style={{
          fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 12,
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          📋 Разбор ответов
        </div>

        {questions.map((q, qi) => {
          const fb = feedback.find(f => f.question_id === q.id);
          const isCorrect = fb?.is_correct;
          const correctIdx = fb?.correct_index ?? -1;
          const selectedIdx = answers[q.id];
          const opts = Array.isArray(q.options) ? q.options : [];

          return (
            <div key={q.id} style={{
              background: C.card,
              border: `1px solid ${isCorrect ? C.green + '40' : C.red + '30'}`,
              borderRadius: 14, padding: '14px 16px', marginBottom: 10,
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{isCorrect ? '✅' : '❌'}</span>
                <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>
                  <span style={{ color: C.muted }}>{qi + 1}. </span>{q.question_text}
                </div>
              </div>

              {opts.map((opt, oi) => {
                const isSelected = selectedIdx === oi;
                const isCorrOpt = oi === correctIdx;
                let color = C.muted;
                let bg = 'transparent';
                if (isCorrOpt) { color = C.green; bg = C.green + '0d'; }
                else if (isSelected && !isCorrOpt) { color = C.red; bg = C.red + '0d'; }

                return (
                  <div key={oi} style={{
                    display: 'flex', gap: 8, padding: '5px 8px',
                    borderRadius: 8, background: bg, marginBottom: 2,
                  }}>
                    <span style={{ fontSize: 13, color, flexShrink: 0 }}>
                      {isCorrOpt ? '✓' : isSelected ? '✗' : '○'}
                    </span>
                    <span style={{ fontSize: 13, color, fontWeight: isCorrOpt || isSelected ? 600 : 400 }}>
                      {opt.text}
                    </span>
                  </div>
                );
              })}

              {fb?.explanation && (
                <div style={{
                  marginTop: 8, background: C.blue + '0d',
                  border: `1px solid ${C.blue}25`, borderRadius: 10,
                  padding: '8px 10px', fontSize: 12, color: C.blue, lineHeight: 1.6,
                }}>
                  💡 {fb.explanation}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div style={{ padding: '0 16px', display: 'flex', gap: 10 }}>
        <button
          onClick={() => navigate(`/office-academy/${lessonId}`)}
          style={{
            flex: 1, padding: '14px 0', borderRadius: 14,
            background: needsReread ? `linear-gradient(90deg, ${C.gold}, ${C.amber})` : C.rune,
            color: needsReread ? '#000' : '#fff',
            fontWeight: 800, fontSize: 15, border: 'none', cursor: 'pointer',
          }}>
          {needsReread ? '📖 Перечитать свиток' : '← К свитку'}
        </button>
        {!passed && !needsReread && (
          <button
            onClick={() => window.location.reload()}
            style={{
              flex: 1, padding: '14px 0', borderRadius: 14,
              background: C.gold, color: '#000', fontWeight: 800,
              fontSize: 15, border: 'none', cursor: 'pointer',
            }}>
            🔄 Повторить
          </button>
        )}
        {passed && (
          <button
            onClick={() => navigate('/office-academy')}
            style={{
              flex: 1, padding: '14px 0', borderRadius: 14,
              background: C.green + '20', color: C.green, fontWeight: 800,
              fontSize: 15, border: `1px solid ${C.green}40`, cursor: 'pointer',
            }}>
            🏛️ К Залам Асгарда
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN QUIZ COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function OfficeAcademyQuiz() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [title, setTitle]         = useState('');
  const [icon, setIcon]           = useState('🏛️');
  const [loading, setLoad]        = useState(true);
  const [answers, setAnswers]     = useState({});
  const [currentQ, setCurrentQ]   = useState(0);
  const [submitting, setSubmit]   = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState('');
  const [elapsed, setElapsed]     = useState(0);
  const [timeUp, setTimeUp]       = useState(false);
  const timerRef = useRef(null);
  const handleSubmitRef = useRef(null);

  useEffect(() => {
    api.get(`/office-academy/lessons/${id}`)
      .then(d => {
        setQuestions(d.questions || []);
        setTitle(d.lesson?.title || '');
        setIcon(d.lesson?.cover_icon || '🏛️');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoad(false));
  }, [id]);

  // Quiz timer — uses setTimeUp to trigger submit via separate effect (avoids stale closure)
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(prev => {
        if (prev + 1 >= QUIZ_TIME_LIMIT) {
          clearInterval(timerRef.current);
          setTimeUp(true);
          return prev + 1;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  function selectAnswer(qId, idx) {
    if (result) return;
    setAnswers(prev => ({ ...prev, [qId]: idx }));
  }

  const handleSubmit = useCallback(async (force = false) => {
    if (!force && Object.keys(answers).length < questions.length) {
      setError('Ответь на все вопросы перед отправкой');
      setTimeout(() => setError(''), 3000);
      return;
    }
    clearInterval(timerRef.current);
    setError('');
    setSubmit(true);
    try {
      const res = await api.post(`/office-academy/lessons/${id}/quiz`, { answers });
      setResult(res);
    } catch (e) {
      if (e.message?.includes('needs_reread') || e.response?.data?.error === 'needs_reread') {
        navigate(`/office-academy/${id}`);
        return;
      }
      setError(e.message || 'Ошибка отправки');
    } finally {
      setSubmit(false);
    }
  }, [answers, questions, id, navigate]);

  // Keep ref always pointing to latest handleSubmit (for timer auto-submit)
  handleSubmitRef.current = handleSubmit;

  // Auto-submit when time is up (separate effect avoids stale closure)
  useEffect(() => {
    if (timeUp && !result) {
      handleSubmitRef.current?.(true);
    }
  }, [timeUp, result]);

  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount >= questions.length;

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36 }}>⚔️</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>Загружаю испытание...</div>
      </div>
    </div>
  );

  // ── Results screen ──
  if (result) {
    return (
      <ResultScreen
        result={result}
        questions={questions}
        answers={answers}
        lessonId={id}
        navigate={navigate}
      />
    );
  }

  // ── Quiz form — one question at a time ──
  const q = questions[currentQ];
  const opts = q ? (Array.isArray(q.options) ? q.options : []) : [];
  const selected = q ? answers[q.id] : undefined;
  const progressPct = questions.length > 0 ? ((currentQ + 1) / questions.length) * 100 : 0;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 100 }}>
      {/* Header */}
      <div style={{
        padding: '52px 16px 16px',
        background: `linear-gradient(180deg, #1a0d2e 0%, transparent 100%)`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <button onClick={() => navigate(-1)}
            style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, padding: 0 }}>
            ← Назад
          </button>
          <QuizTimer seconds={elapsed} total={QUIZ_TIME_LIMIT} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>⚔️ Испытание</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{title}</div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Progress bar */}
        <div style={{
          background: C.card, borderRadius: 12, padding: '10px 14px', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: C.muted }}>
              Вопрос <span style={{ color: C.text, fontWeight: 700 }}>{currentQ + 1}</span> из {questions.length}
            </span>
            <span style={{ fontSize: 12, color: allAnswered ? C.green : C.muted }}>
              Отвечено: {answeredCount}/{questions.length}
            </span>
          </div>
          <div style={{ height: 4, background: '#ffffff0d', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2, width: `${progressPct}%`,
              background: `linear-gradient(90deg, ${C.rune}, ${C.gold})`,
              transition: 'width .3s ease',
            }} />
          </div>
        </div>

        {/* Question card */}
        {q && (
          <div style={{
            background: C.card, border: `1px solid ${selected !== undefined ? C.rune + '40' : '#ffffff0d'}`,
            borderRadius: 18, padding: '20px 18px', marginBottom: 16,
          }}>
            {/* Question type badge */}
            <div style={{
              fontSize: 10, fontWeight: 700, color: C.rune,
              background: C.rune + '15', borderRadius: 6, padding: '2px 8px',
              display: 'inline-block', marginBottom: 10, textTransform: 'uppercase',
            }}>
              {q.question_type === 'truefalse' ? 'Верно/Неверно'
                : q.question_type === 'scenario' ? 'Ситуация'
                : 'Выбери ответ'}
            </div>

            <div style={{ fontSize: 15, color: C.text, lineHeight: 1.6, marginBottom: 16, fontWeight: 600 }}>
              {q.question_text}
            </div>

            {opts.map((opt, oi) => {
              const isSelected = selected === oi;
              return (
                <button
                  key={oi}
                  onClick={() => selectAnswer(q.id, oi)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '13px 14px',
                    borderRadius: 14, border: `1px solid ${isSelected ? C.rune + '80' : '#ffffff10'}`,
                    background: isSelected ? C.rune + '20' : '#ffffff05',
                    color: isSelected ? C.text : '#b0b0c0',
                    fontWeight: isSelected ? 600 : 400,
                    fontSize: 14, cursor: 'pointer', marginBottom: 8,
                    display: 'flex', alignItems: 'center', gap: 12,
                    transition: 'all .15s',
                  }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${isSelected ? C.rune : '#ffffff20'}`,
                    background: isSelected ? C.rune : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all .15s',
                  }}>
                    {isSelected && <span style={{ fontSize: 11, color: '#fff', fontWeight: 900 }}>✓</span>}
                  </span>
                  {opt.text}
                </button>
              );
            })}
          </div>
        )}

        {/* Question dots navigation */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap',
        }}>
          {questions.map((qq, i) => {
            const answered = answers[qq.id] !== undefined;
            const isCurrent = i === currentQ;
            return (
              <button key={i} onClick={() => setCurrentQ(i)} style={{
                width: 28, height: 28, borderRadius: '50%',
                border: isCurrent ? `2px solid ${C.rune}` : '1px solid #ffffff15',
                background: answered ? (isCurrent ? C.rune : C.rune + '40') : (isCurrent ? C.rune + '20' : 'transparent'),
                color: answered || isCurrent ? '#fff' : C.muted,
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</button>
            );
          })}
        </div>

        {/* Navigation buttons */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <button
            onClick={() => setCurrentQ(Math.max(0, currentQ - 1))}
            disabled={currentQ === 0}
            style={{
              flex: 1, padding: '12px 0', borderRadius: 12,
              background: currentQ > 0 ? C.card : '#ffffff08',
              border: '1px solid #ffffff0d',
              color: currentQ > 0 ? C.text : C.muted,
              fontWeight: 700, fontSize: 14, cursor: currentQ > 0 ? 'pointer' : 'not-allowed',
            }}>← Назад</button>
          {currentQ < questions.length - 1 ? (
            <button
              onClick={() => setCurrentQ(currentQ + 1)}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12,
                background: selected !== undefined ? C.rune + '30' : C.card,
                border: `1px solid ${selected !== undefined ? C.rune + '40' : '#ffffff0d'}`,
                color: C.text, fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}>Далее →</button>
          ) : (
            <button
              onClick={() => handleSubmit(false)}
              disabled={submitting || !allAnswered}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12,
                background: allAnswered ? `linear-gradient(90deg, ${C.gold}, ${C.amber})` : '#ffffff10',
                color: allAnswered ? '#000' : C.muted,
                fontWeight: 800, fontSize: 14, border: 'none',
                cursor: allAnswered ? 'pointer' : 'not-allowed',
                opacity: submitting ? .7 : 1,
              }}>
              {submitting ? '⏳ Проверяю...' : allAnswered ? `⚔️ Сдать (${answeredCount}/${questions.length})` : `Ответь на все (${answeredCount}/${questions.length})`}
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: C.red + '12', border: `1px solid ${C.red}35`,
            borderRadius: 12, padding: '10px 14px',
            fontSize: 13, color: C.red, textAlign: 'center',
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
