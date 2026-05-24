/**
 * FieldAcademyQuiz.jsx — Испытание (тест)
 * 10-15 вопросов, 20 мин, 2 попытки, 80% для прохождения
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  rune: '#7b61ff', green: '#22c55e', red: '#ef4444',
  amber: '#f59e0b', text: '#e8e8f0', muted: '#6b7280',
};

const TIME_LIMIT = 20 * 60; // 20 minutes in seconds

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function ProgressBar({ current, total }) {
  return (
    <div style={{ height: 4, background: '#ffffff11', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        width: `${(current / total) * 100}%`,
        background: `linear-gradient(90deg, ${C.rune}, ${C.gold})`,
        transition: 'width 0.3s',
      }} />
    </div>
  );
}

function ResultScreen({ result, lessonId, navigate }) {
  const isPassed = result.passed;
  const needReread = !isPassed && (result.need_reread || result.attempts_left === 0);
  const color = isPassed ? C.green : C.red;

  return (
    <div style={{
      minHeight: '100vh', background: C.bg,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 24,
    }}>
      <div style={{ fontSize: 80, marginBottom: 16 }}>
        {isPassed ? '⚔️' : '🛡️'}
      </div>

      <div style={{ fontSize: 24, fontWeight: 900, color, marginBottom: 8, textAlign: 'center' }}>
        {isPassed ? 'Испытание пройдено!' : 'Ещё не готов...'}
      </div>

      <div style={{ fontSize: 56, fontWeight: 900, color, marginBottom: 4 }}>
        {result.score}%
      </div>

      <div style={{ fontSize: 14, color: C.muted, marginBottom: 24, textAlign: 'center' }}>
        {result.correct} из {result.total} правильных ответов
      </div>

      {isPassed && result.reward && (
        <div style={{
          background: `${C.gold}11`, border: `1px solid ${C.gold}44`,
          borderRadius: 16, padding: 16, marginBottom: 24, width: '100%',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Награда</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.rune }}>+{result.reward.runes}</div>
              <div style={{ fontSize: 11, color: C.muted }}>🔮 Руны</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.amber }}>+{result.reward.xp}</div>
              <div style={{ fontSize: 11, color: C.muted }}>⚡ XP</div>
            </div>
            {result.reward.streak_bonus && (
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.gold }}>🔥</div>
                <div style={{ fontSize: 11, color: C.muted }}>Стрик!</div>
              </div>
            )}
          </div>
        </div>
      )}

      {!isPassed && (
        <div style={{
          background: `${needReread ? C.red : C.amber}11`,
          border: `1px solid ${needReread ? C.red : C.amber}33`,
          borderRadius: 12, padding: 14, marginBottom: 24, width: '100%',
          fontSize: 13, color: needReread ? C.red : C.amber,
          lineHeight: 1.5, textAlign: 'center',
        }}>
          {needReread
            ? 'Попытки исчерпаны. Перечитай Руну внимательно — получишь 2 новые попытки сразу.'
            : `У тебя ещё ${result.attempts_left} попытка. Перечитай Руну и возвращайся.`}
        </div>
      )}

      {/* Answers review */}
      <div style={{ width: '100%', marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.muted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
          Разбор ответов
        </div>
        {(result.answers || []).map((ans, i) => (
          <div key={i} style={{
            background: C.card, borderRadius: 10, padding: 12, marginBottom: 8,
            border: `1px solid ${ans.is_correct ? C.green + '44' : C.red + '44'}`,
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: ans.explanation ? 6 : 0 }}>
              <span style={{ fontSize: 16 }}>{ans.is_correct ? '✅' : '❌'}</span>
              <span style={{ fontSize: 12, color: C.muted }}>Вопрос {i + 1}</span>
            </div>
            {!ans.is_correct && ans.explanation && (
              <div style={{ fontSize: 12, color: '#a0a0b0', lineHeight: 1.5, paddingLeft: 24 }}>
                {ans.explanation}
              </div>
            )}
          </div>
        ))}
      </div>

      {needReread ? (
        // После 2 провалов — одна большая кнопка, ведёт сразу на лекцию
        <div style={{ width: '100%' }}>
          <button
            onClick={() => navigate(`/field/academy/lesson/${lessonId}`)}
            style={{
              width: '100%', padding: '16px 0',
              background: `linear-gradient(90deg, ${C.gold}, #a87d20)`,
              border: 'none', borderRadius: 12, color: '#000',
              fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: `0 4px 14px ${C.gold}33`,
            }}
          >
            📖 Перечитать Руну и попробовать снова
          </button>
          <button
            onClick={() => navigate('/field/academy')}
            style={{
              width: '100%', marginTop: 10, padding: '11px 0',
              background: 'transparent', border: 'none',
              color: C.muted, fontSize: 13, cursor: 'pointer',
            }}
          >
            ← Вернуться в Чертоги
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          {!isPassed && result.attempts_left > 0 && (
            <button
              onClick={() => navigate(`/field/academy/lesson/${lessonId}`)}
              style={{
                flex: 1, padding: '13px 0',
                background: `${C.amber}22`, border: `1px solid ${C.amber}44`,
                borderRadius: 12, color: C.amber, fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              📖 Перечитать
            </button>
          )}
          <button
            onClick={() => navigate('/field/academy')}
            style={{
              flex: 1, padding: '13px 0',
              background: isPassed
                ? `linear-gradient(90deg, ${C.green}, #16a34a)`
                : `${C.card}`,
              border: isPassed ? 'none' : `1px solid #ffffff22`,
              borderRadius: 12, color: isPassed ? '#000' : C.text,
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {isPassed ? '🏛️ В Чертоги' : '← Назад'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function FieldAcademyQuiz() {
  const navigate = useNavigate();
  const { lessonId } = useParams();

  const [questions, setQuestions] = useState([]);
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({}); // {question_id: option_id}
  const [selected, setSelected] = useState(null);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const timerRef = useRef(null);
  const submitRef = useRef(null); // always points to latest handleSubmit

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fieldApi.get(`/academy/lessons/${lessonId}/quiz`);
      setQuestions(data.questions || []);
      setAttemptNumber(data.attempt_number || 1);
      setTimeLeft(TIME_LIMIT);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => { load(); }, [load]);

  // Timer — uses submitRef to avoid stale closure over answers
  useEffect(() => {
    if (loading || result) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          submitRef.current(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [loading, result]);

  function selectOption(qId, optId) {
    if (result) return;
    setSelected(optId);
    setAnswers(prev => ({ ...prev, [qId]: optId }));
  }

  function nextQuestion() {
    setSelected(answers[questions[current + 1]?.id] || null);
    setCurrent(c => c + 1);
  }

  function prevQuestion() {
    const prev = current - 1;
    setSelected(answers[questions[prev]?.id] || null);
    setCurrent(prev);
  }

  async function handleSubmit(auto = false) {
    if (submitting) return;
    clearInterval(timerRef.current);
    setSubmitting(true);

    const currentAnswers = answers; // captured from this render's closure
    const payload = questions.map(q => ({
      question_id: q.id,
      selected_option_id: currentAnswers[q.id] || null,
    }));

    try {
      const res = await fieldApi.post(`/academy/lessons/${lessonId}/quiz`, { answers: payload });
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }
  submitRef.current = handleSubmit; // keep ref fresh on every render

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.gold, fontSize: 32 }}>⚡</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, padding: '80px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⛔</div>
        <div style={{ color: C.red, marginBottom: 16 }}>{error}</div>
        <button onClick={() => navigate(-1)} style={{ color: C.gold, background: 'none', border: 'none', cursor: 'pointer', fontSize: 15 }}>
          ← Назад
        </button>
      </div>
    );
  }

  if (result) {
    return <ResultScreen result={result} lessonId={lessonId} navigate={navigate} />;
  }

  if (!questions.length) return null;

  const q = questions[current];
  const totalQ = questions.length;
  const answeredCount = Object.keys(answers).length;
  const timeColor = timeLeft < 120 ? C.red : timeLeft < 300 ? C.amber : C.muted;
  const isLast = current === totalQ - 1;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '48px 16px 12px',
        background: 'linear-gradient(180deg, #1a0d2e 0%, transparent 100%)',
        position: 'sticky', top: 0, zIndex: 10, backdropFilter: 'blur(8px)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: C.muted }}>
            Вопрос {current + 1} из {totalQ}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: timeColor }}>
            ⏱ {formatTime(timeLeft)}
          </div>
        </div>
        <ProgressBar current={current + 1} total={totalQ} />
      </div>

      {/* Question */}
      <div style={{ flex: 1, padding: '16px 16px 120px' }}>
        <div style={{
          background: C.card, borderRadius: 16, padding: 20,
          border: '1px solid #ffffff11', marginBottom: 16,
        }}>
          {q.image_url && (
            <img src={q.image_url} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 12, objectFit: 'cover', maxHeight: 200 }} />
          )}
          <div style={{ fontSize: 11, color: C.rune, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {q.question_type === 'truefalse' ? 'Верно или Неверно' :
             q.question_type === 'scenario' ? 'Разбор ситуации' : 'Выбери ответ'}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.55 }}>
            {q.question_text}
          </div>
        </div>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(q.options || []).map((opt) => {
            const isSelected = answers[q.id] === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => selectOption(q.id, opt.id)}
                style={{
                  width: '100%', textAlign: 'left', padding: '14px 16px',
                  background: isSelected ? `${C.rune}22` : C.card,
                  border: `2px solid ${isSelected ? C.rune : '#ffffff11'}`,
                  borderRadius: 12, color: isSelected ? C.text : '#b0b0c0',
                  fontSize: 14, fontWeight: isSelected ? 700 : 400,
                  cursor: 'pointer', lineHeight: 1.45,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  display: 'inline-block', width: 22, height: 22,
                  borderRadius: 11, border: `2px solid ${isSelected ? C.rune : '#ffffff33'}`,
                  marginRight: 10, verticalAlign: 'middle',
                  background: isSelected ? C.rune : 'transparent',
                  flexShrink: 0,
                }} />
                {opt.text}
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '12px 16px 32px',
        background: `linear-gradient(transparent, ${C.bg} 30%)`,
      }}>
        {/* Answer count */}
        <div style={{ textAlign: 'center', fontSize: 12, color: C.muted, marginBottom: 8 }}>
          Отвечено: {answeredCount} / {totalQ}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {current > 0 && (
            <button onClick={prevQuestion} style={{
              padding: '13px 20px', background: '#ffffff11',
              border: 'none', borderRadius: 12, color: C.text,
              fontSize: 14, cursor: 'pointer',
            }}>←</button>
          )}

          {!isLast ? (
            <button
              onClick={nextQuestion}
              style={{
                flex: 1, padding: '13px 0',
                background: answers[q.id]
                  ? `linear-gradient(90deg, ${C.rune}, #9b59b6)`
                  : '#ffffff11',
                border: 'none', borderRadius: 12, color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Далее →
            </button>
          ) : (
            <button
              onClick={() => handleSubmit()}
              disabled={submitting}
              style={{
                flex: 1, padding: '13px 0',
                background: submitting
                  ? '#ffffff22'
                  : `linear-gradient(90deg, ${C.gold}, #a87d20)`,
                border: 'none', borderRadius: 12, color: '#000',
                fontSize: 15, fontWeight: 800, cursor: submitting ? 'default' : 'pointer',
              }}
            >
              {submitting ? 'Отправляем...' : `⚔️ Сдать Испытание (${answeredCount}/${totalQ})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
