import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api/client';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

export default function OfficeAcademyQuiz() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [title, setTitle]         = useState('');
  const [icon, setIcon]           = useState('🏛️');
  const [loading, setLoad]        = useState(true);
  const [answers, setAnswers]     = useState({}); // { [questionId]: optionIndex }
  const [submitting, setSubmit]   = useState(false);
  const [result, setResult]       = useState(null); // { score, passed, correct, total, feedback }
  const [error, setError]         = useState('');

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

  function selectAnswer(qId, idx) {
    if (result) return;
    setAnswers(prev => ({ ...prev, [qId]: idx }));
  }

  async function handleSubmit() {
    if (Object.keys(answers).length < questions.length) {
      setError('Ответьте на все вопросы перед отправкой');
      return;
    }
    setError('');
    setSubmit(true);
    try {
      const res = await api.post(`/office-academy/lessons/${id}/quiz`, { answers });
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmit(false);
    }
  }

  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount >= questions.length;

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 36 }}>❓</div>
    </div>
  );

  // ── Results screen ──────────────────────────────────────────────
  if (result) {
    const { score, passed, correct, total, feedback = [] } = result;
    return (
      <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 40 }}>
        <div style={{ padding: '52px 16px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>{passed ? '🎉' : '📚'}</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: passed ? C.green : C.amber }}>
            {score}%
          </div>
          <div style={{ fontSize: 15, color: C.text, marginTop: 4, marginBottom: 4 }}>
            {passed ? 'Тест пройден!' : 'Тест не сдан'}
          </div>
          <div style={{ fontSize: 13, color: C.muted }}>
            {correct} из {total} правильных · проходной балл 70%
          </div>
        </div>

        <div style={{ padding: '0 16px 20px' }}>
          {/* Per-question feedback */}
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
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{isCorrect ? '✅' : '❌'}</span>
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

                {q.correct_explanation && !isCorrect && (
                  <div style={{
                    marginTop: 8, background: C.blue + '0d',
                    border: `1px solid ${C.blue}25`, borderRadius: 10,
                    padding: '8px 10px', fontSize: 12, color: C.blue, lineHeight: 1.6,
                  }}>
                    💡 {q.correct_explanation}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: '0 16px', display: 'flex', gap: 10 }}>
          <button
            onClick={() => navigate(`/office-academy/${id}`)}
            style={{
              flex: 1, padding: '14px 0', borderRadius: 14,
              background: C.rune, color: '#fff', fontWeight: 800,
              fontSize: 15, border: 'none', cursor: 'pointer',
            }}>
            ← К уроку
          </button>
          {!passed && (
            <button
              onClick={() => { setResult(null); setAnswers({}); }}
              style={{
                flex: 1, padding: '14px 0', borderRadius: 14,
                background: C.gold, color: '#000', fontWeight: 800,
                fontSize: 15, border: 'none', cursor: 'pointer',
              }}>
              🔄 Повторить
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Quiz form ──────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 100 }}>
      {/* Header */}
      <div style={{ padding: '52px 16px 16px', background: 'linear-gradient(180deg, #1a0d2e 0%, transparent 100%)' }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
          ← Назад
        </button>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>{icon} Тест</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{title}</div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Progress */}
        <div style={{
          background: C.card, borderRadius: 12, padding: '10px 14px', marginBottom: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 13, color: C.muted }}>
            Отвечено: <span style={{ color: allAnswered ? C.green : C.text, fontWeight: 700 }}>{answeredCount} / {questions.length}</span>
          </span>
          <span style={{ fontSize: 12, color: C.muted }}>Проходной балл: 70%</span>
        </div>

        {/* Questions */}
        {questions.map((q, qi) => {
          const opts = Array.isArray(q.options) ? q.options : [];
          const selected = answers[q.id];

          return (
            <div key={q.id} style={{
              background: C.card, border: `1px solid ${selected !== undefined ? C.rune + '40' : '#ffffff0d'}`,
              borderRadius: 16, padding: '16px', marginBottom: 12,
            }}>
              <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6, marginBottom: 12 }}>
                <span style={{ color: C.muted, fontWeight: 700 }}>{qi + 1}. </span>
                {q.question_text}
              </div>

              {opts.map((opt, oi) => {
                const isSelected = selected === oi;
                return (
                  <button
                    key={oi}
                    onClick={() => selectAnswer(q.id, oi)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '11px 14px',
                      borderRadius: 12, border: `1px solid ${isSelected ? C.rune + '80' : '#ffffff10'}`,
                      background: isSelected ? C.rune + '20' : '#ffffff05',
                      color: isSelected ? C.text : C.muted,
                      fontWeight: isSelected ? 600 : 400,
                      fontSize: 13, cursor: 'pointer', marginBottom: 6,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${isSelected ? C.rune : '#ffffff20'}`,
                      background: isSelected ? C.rune : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isSelected && <span style={{ fontSize: 10, color: '#fff' }}>✓</span>}
                    </span>
                    {opt.text}
                  </button>
                );
              })}
            </div>
          );
        })}

        {error && (
          <div style={{
            background: C.red + '12', border: `1px solid ${C.red}35`,
            borderRadius: 12, padding: '10px 14px', marginBottom: 14,
            fontSize: 13, color: C.red, textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || !allAnswered}
          style={{
            width: '100%', padding: '16px 0', borderRadius: 16,
            background: allAnswered ? C.gold : '#ffffff10',
            color: allAnswered ? '#000' : C.muted,
            fontWeight: 800, fontSize: 16, border: 'none',
            cursor: allAnswered ? 'pointer' : 'not-allowed',
            opacity: submitting ? .7 : 1,
          }}>
          {submitting ? 'Проверяю...' : allAnswered ? '📝 Отправить ответы' : `Ответьте на все вопросы (${answeredCount}/${questions.length})`}
        </button>
      </div>
    </div>
  );
}
