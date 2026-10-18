/**
 * FieldAcademyQuiz.jsx — Испытание (тест)
 * 10-15 вопросов, 20 мин, 2 попытки, 80% для прохождения
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Zap, Timer, Ban, Check, XCircle, BookOpen, Landmark, ArrowLeft, Swords, Shield, Gem, Flame, GraduationCap,
} from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { Card, IconTile, KeyButton, ProgressBar as UiProgress } from '@/components/field/ui';
import './field-screens.css';

const C = {
  bg: 'var(--bg-primary)', card: 'var(--bg-surface)', gold: 'var(--value)',
  rune: 'var(--acc)', green: 'var(--ok)', red: 'var(--danger)',
  amber: 'var(--value)', text: 'var(--text-primary)', muted: 'var(--text-secondary)',
};

const TIME_LIMIT = 20 * 60; // 20 minutes in seconds

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function ProgressBar({ current, total }) {
  return (
    <div style={{ height: 4, background: 'color-mix(in oklab, var(--text-primary) 7%, transparent)', borderRadius: 2, overflow: 'hidden' }}>
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
    <div className="fs-root" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 24,
      paddingTop: 'max(env(safe-area-inset-top), 24px)',
      paddingBottom: 'max(env(safe-area-inset-bottom), 24px)',
    }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div style={{ position: 'relative', zIndex: 5, width: '100%', maxWidth: 430, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <IconTile icon={isPassed ? Swords : Shield} tone={isPassed ? 'status' : 'danger'} size={84} iconSize={40} />

        <div style={{ fontSize: 24, fontWeight: 900, color, margin: '16px 0 8px', textAlign: 'center' }}>
          {isPassed ? 'Испытание пройдено!' : 'Ещё не готов...'}
        </div>

        <div style={{ fontSize: 56, fontWeight: 900, color, marginBottom: 4 }}>
          {result.score}%
        </div>

        <div style={{ fontSize: 14, color: C.muted, marginBottom: 24, textAlign: 'center' }}>
          {result.correct} из {result.total} правильных ответов
        </div>

        {isPassed && result.reward && (
          <Card variant="raised" tone="value" className="text-center" style={{ marginBottom: 24, width: '100%' }}>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Награда</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 20 }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--acc)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Gem size={18} strokeWidth={2.3} />+{result.reward.runes}
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>Руны</div>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--value-ink)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Zap size={18} strokeWidth={2.3} />+{result.reward.xp}
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>XP</div>
              </div>
              {result.reward.streak_bonus && (
                <div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--value-ink)' }} role="img" aria-label="Стрик">
                    <Flame size={22} strokeWidth={2.3} />
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>Стрик!</div>
                </div>
              )}
            </div>
          </Card>
        )}

        {!isPassed && (
          <div style={{
            background: needReread
              ? 'color-mix(in oklab, var(--danger) 9%, var(--bg-surface))'
              : 'color-mix(in oklab, var(--value) 9%, var(--bg-surface))',
            border: `1px solid ${needReread ? 'color-mix(in oklab, var(--danger) 26%, transparent)' : 'color-mix(in oklab, var(--value) 26%, transparent)'}`,
            borderRadius: 12, padding: 14, marginBottom: 24, width: '100%',
            fontSize: 13, color: needReread ? C.red : 'var(--value-ink)',
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
          <Card key={i} variant="raised" style={{
            padding: 12, marginBottom: 8,
            borderColor: ans.is_correct
              ? 'color-mix(in oklab, var(--ok) 30%, transparent)'
              : 'color-mix(in oklab, var(--danger) 30%, transparent)',
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: ans.explanation ? 6 : 0 }}>
              {ans.is_correct
                ? <Check size={16} strokeWidth={2.6} style={{ color: 'var(--ok)' }} />
                : <XCircle size={16} strokeWidth={2.6} style={{ color: 'var(--danger)' }} />}
              <span style={{ fontSize: 12, color: C.muted }}>Вопрос {i + 1}</span>
            </div>
            {!ans.is_correct && ans.explanation && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, paddingLeft: 24 }}>
                {ans.explanation}
              </div>
            )}
          </Card>
        ))}
      </div>

      {needReread ? (
        // После 2 провалов — одна большая кнопка, ведёт сразу на лекцию
        <div style={{ width: '100%' }}>
          <KeyButton tone="value" block icon={BookOpen} onClick={() => navigate(`/field/academy/lesson/${lessonId}`)}>
            Перечитать Руну и попробовать снова
          </KeyButton>
          <button
            onClick={() => navigate('/field/academy')}
            style={{
              width: '100%', marginTop: 10, padding: '11px 0',
              background: 'transparent', border: 'none',
              color: C.muted, fontSize: 13, cursor: 'pointer',
            }}
          >
            Вернуться в Чертоги
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          {!isPassed && result.attempts_left > 0 && (
            <KeyButton
              tone="value"
              icon={BookOpen}
              style={{ flex: 1 }}
              onClick={() => navigate(`/field/academy/lesson/${lessonId}`)}
            >
              Перечитать
            </KeyButton>
          )}
          <KeyButton
            tone={isPassed ? 'status' : 'neutral'}
            icon={isPassed ? Landmark : ArrowLeft}
            style={{ flex: 1 }}
            onClick={() => navigate('/field/academy')}
          >
            {isPassed ? 'В Чертоги' : 'Назад'}
          </KeyButton>
        </div>
      )}
      </div>
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
      const msg = e?.message || '';
      // Уже сдал — не ошибка, уводим в летопись
      if (e?.status === 400 && /уже пройден/i.test(msg)) {
        navigate('/field/academy', { replace: true });
        return;
      }
      setError(msg || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [lessonId, navigate]);

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
      <div className="fs-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Zap size={32} strokeWidth={2.2} style={{ color: C.gold }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="fs-root" style={{ padding: '80px 20px', textAlign: 'center' }}>
        <IconTile icon={Ban} tone="danger" size={72} iconSize={34} style={{ margin: '0 auto 16px' }} />
        <div style={{ color: C.red, marginBottom: 16 }}>{error}</div>
        <KeyButton tone="value" icon={ArrowLeft} onClick={() => navigate(-1)}>Назад</KeyButton>
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
    <div className="fs-root" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        paddingTop: 'max(env(safe-area-inset-top), 14px)', paddingInline: 16, paddingBottom: 12,
        background: 'color-mix(in oklab, var(--bg-primary) 88%, transparent)',
        WebkitBackdropFilter: 'blur(12px) saturate(1.5)', backdropFilter: 'blur(12px) saturate(1.5)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: C.muted }}>
            Вопрос {current + 1} из {totalQ}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: timeColor, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Timer size={14} strokeWidth={2.4} />
            {formatTime(timeLeft)}
          </div>
        </div>
        <UiProgress value={current + 1} max={totalQ} color="var(--acc)" />
      </div>

      {/* Question */}
      <div style={{ flex: 1, padding: '16px 16px 120px', position: 'relative', zIndex: 5 }}>
        <Card variant="raised" style={{ marginBottom: 16 }}>
          {q.image_url && (
            <img src={q.image_url} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 12, objectFit: 'cover', maxHeight: 200 }} />
          )}
          <div style={{ fontSize: 11, color: 'var(--acc)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {q.question_type === 'truefalse' ? 'Верно или Неверно' :
             q.question_type === 'scenario' ? 'Разбор ситуации' : 'Выбери ответ'}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.55 }}>
            {q.question_text}
          </div>
        </Card>

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
                  background: isSelected ? 'var(--ui-card-value-bg, var(--bg-surface-alt))' : 'var(--bg-surface)',
                  border: `2px solid ${isSelected ? 'var(--acc)' : 'var(--tile-brd)'}`,
                  borderRadius: 12, color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 14, fontWeight: isSelected ? 700 : 400,
                  cursor: 'pointer', lineHeight: 1.45,
                  transition: 'all .15s',
                  boxShadow: isSelected ? '0 4px 14px color-mix(in oklab, var(--acc) 24%, transparent)' : 'none',
                }}
              >
                <span style={{
                  display: 'inline-block', width: 22, height: 22,
                  borderRadius: 11, border: `2px solid ${isSelected ? 'var(--acc)' : 'var(--border-mid)'}`,
                  marginRight: 10, verticalAlign: 'middle',
                  background: isSelected ? 'var(--acc)' : 'transparent',
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
        padding: '12px 16px calc(env(safe-area-inset-bottom, 0px) + 18px)',
        background: 'linear-gradient(transparent, var(--bg-primary) 30%)',
      }}>
        {/* Answer count */}
        <div style={{ textAlign: 'center', fontSize: 12, color: C.muted, marginBottom: 8 }}>
          Отвечено: {answeredCount} / {totalQ}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {current > 0 && (
            <KeyButton tone="neutral" icon={ArrowLeft} onClick={prevQuestion} aria-label="Предыдущий вопрос" />
          )}

          {!isLast ? (
            <KeyButton
              tone="accent"
              block
              onClick={nextQuestion}
              style={{ flex: 1 }}
              disabled={!answers[q.id]}
            >
              Далее
            </KeyButton>
          ) : (
            <KeyButton
              tone="value"
              block
              icon={Swords}
              onClick={() => handleSubmit()}
              disabled={submitting}
              style={{ flex: 1 }}
            >
              {submitting ? 'Отправляем...' : `Сдать Испытание (${answeredCount}/${totalQ})`}
            </KeyButton>
          )}
        </div>
      </div>
    </div>
  );
}
