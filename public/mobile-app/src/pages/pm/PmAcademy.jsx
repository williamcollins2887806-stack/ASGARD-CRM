import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

export default function PmAcademy() {
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // выбранный черновик
  const [lesson, setLesson]   = useState(null);   // полный урок с вопросами
  const [rejectText, setRejectText] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState('');

  const load = () => {
    setLoading(true);
    api.get('/pm/academy')
      .then(setData)
      .catch(e => setMsg(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  async function openLesson(id) {
    setSelected(id);
    try {
      const res = await api.get(`/pm/academy/lesson/${id}`);
      setLesson(res);
    } catch (e) { setMsg('Ошибка загрузки: ' + e.message); }
  }

  async function handleApprove(id) {
    setSaving(true);
    try {
      await api.post(`/pm/academy/${id}/approve`, {});
      setMsg('✅ Урок опубликован! Рабочие увидят его в Чертогах Мимира.');
      setSelected(null); setLesson(null);
      load();
    } catch (e) { setMsg('Ошибка: ' + e.message); }
    finally { setSaving(false); }
  }

  async function handleReject(id) {
    setSaving(true);
    try {
      await api.post(`/pm/academy/${id}/reject`, { comment: rejectText });
      setMsg('Урок отклонён. Мимир создаст новый.');
      setSelected(null); setLesson(null); setShowReject(false); setRejectText('');
      load();
    } catch (e) { setMsg('Ошибка: ' + e.message); }
    finally { setSaving(false); }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 36, color: C.rune }}>🏛️</div>
    </div>
  );

  const { drafts = [], current_lesson, progress, published = [] } = data || {};

  // Детальный просмотр урока
  if (lesson && selected) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 40 }}>
        <div style={{ padding: '48px 16px 16px' }}>
          <button onClick={() => { setSelected(null); setLesson(null); }}
            style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
            ← Назад
          </button>

          {/* Обложка урока */}
          <div style={{
            background: lesson.lesson.cover_color || '#1a1a2e',
            borderRadius: 16, padding: '20px 16px', marginBottom: 16, textAlign: 'center',
          }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>{lesson.lesson.cover_icon}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>{lesson.lesson.title}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              Неделя {lesson.lesson.week_number} · {lesson.lesson.estimated_minutes} мин
              {lesson.lesson.generated_by === 'mimir' && ' · 🤖 Мимир'}
            </div>
          </div>

          {/* Контент блоки (превью) */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Содержание ({(lesson.lesson.blocks || []).length} блоков)
            </div>
            {(lesson.lesson.blocks || []).slice(0, 3).map((b, i) => (
              <div key={i} style={{ background: C.card, borderRadius: 10, padding: '10px 14px', marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: C.rune, textTransform: 'uppercase', marginBottom: 4 }}>{b.type}</div>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                  {typeof b.content === 'string' ? b.content.slice(0, 120) + (b.content.length > 120 ? '...' : '') : '[медиа-блок]'}
                </div>
              </div>
            ))}
            {(lesson.lesson.blocks || []).length > 3 && (
              <div style={{ fontSize: 12, color: C.muted, textAlign: 'center', padding: '4px 0' }}>
                + ещё {(lesson.lesson.blocks || []).length - 3} блоков
              </div>
            )}
          </div>

          {/* Вопросы квиза */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Вопросы квиза ({(lesson.questions || []).length})
            </div>
            {(lesson.questions || []).length === 0 ? (
              <div style={{ background: C.red + '15', border: `1px solid ${C.red}40`, borderRadius: 10, padding: '10px 14px', color: C.red, fontSize: 13 }}>
                ⚠️ Нет вопросов — публикация невозможна
              </div>
            ) : (
              (lesson.questions || []).map((q, i) => (
                <div key={q.id} style={{ background: C.card, borderRadius: 10, padding: '10px 14px', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, color: C.text, marginBottom: 6 }}>
                    <span style={{ color: C.muted }}>{i + 1}.</span> {q.question_text}
                  </div>
                  {(q.options || []).map((opt, oi) => (
                    <div key={oi} style={{
                      fontSize: 12, color: opt.is_correct ? C.green : C.muted,
                      padding: '2px 0', paddingLeft: 12,
                      fontWeight: opt.is_correct ? 700 : 400,
                    }}>
                      {opt.is_correct ? '✓ ' : '○ '}{opt.text}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {msg && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: C.card, color: C.green, fontSize: 13, marginBottom: 12, textAlign: 'center' }}>
              {msg}
            </div>
          )}

          {/* Форма отклонения */}
          {showReject && (
            <div style={{ background: C.card, borderRadius: 14, padding: 14, marginBottom: 12, border: `1px solid ${C.red}30` }}>
              <div style={{ fontSize: 13, color: C.red, fontWeight: 700, marginBottom: 8 }}>Причина отклонения</div>
              <textarea value={rejectText} onChange={e => setRejectText(e.target.value)}
                placeholder="Что нужно исправить? Мимир учтёт это при создании следующего урока..."
                rows={3}
                style={{ width: '100%', background: '#1a1a2e', border: '1px solid #ffffff15', borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 13, resize: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleReject(selected)} disabled={saving}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: C.red, color: '#fff', fontWeight: 700 }}>
                  {saving ? '...' : 'Отклонить'}
                </button>
                <button onClick={() => setShowReject(false)}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#ffffff10', color: C.muted, fontWeight: 700 }}>
                  Отмена
                </button>
              </div>
            </div>
          )}

          {/* Главные кнопки */}
          {lesson.lesson.status === 'draft' && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => handleApprove(selected)} disabled={saving || (lesson.questions || []).length === 0}
                style={{
                  flex: 2, padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
                  background: (lesson.questions || []).length === 0 ? '#ffffff10' : C.green,
                  color: (lesson.questions || []).length === 0 ? C.muted : '#000',
                  fontWeight: 800, fontSize: 15,
                }}>
                {saving ? '...' : '✅ Опубликовать'}
              </button>
              <button onClick={() => setShowReject(!showReject)} disabled={saving}
                style={{ flex: 1, padding: '14px 0', borderRadius: 14, border: `1px solid ${C.red}40`, cursor: 'pointer', background: C.red + '15', color: C.red, fontWeight: 700, fontSize: 14 }}>
                🔄 Переделать
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Главный экран академии
  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 30 }}>
      <div style={{ padding: '48px 16px 16px', background: 'linear-gradient(180deg, #1a0d2e 0%, transparent 100%)' }}>
        <button onClick={() => navigate('/pm')}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
          ← Назад
        </button>
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>🏛️ Чертоги Мимира</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Управление обучением рабочих</div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {msg && (
          <div style={{ padding: '12px 14px', borderRadius: 12, background: C.green + '15', color: C.green, fontSize: 13, marginBottom: 14, textAlign: 'center', border: `1px solid ${C.green}30` }}>
            {msg} <button onClick={() => setMsg('')} style={{ marginLeft: 6, background: 'none', border: 'none', color: C.muted, cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* Черновики на проверку */}
        {drafts.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: C.amber, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, fontWeight: 700 }}>
              ⏳ Ожидают проверки ({drafts.length})
            </div>
            {drafts.map(d => (
              <div key={d.id}
                onClick={() => openLesson(d.id)}
                style={{
                  background: 'linear-gradient(135deg, #1a1030, #16161f)',
                  border: `1px solid ${C.rune}40`,
                  borderRadius: 16, padding: '14px 16px', marginBottom: 10, cursor: 'pointer',
                }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontSize: 32 }}>{d.cover_icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{d.title}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      Неделя {d.week_number} · {d.estimated_minutes} мин
                      {d.generated_by === 'mimir' ? ' · 🤖 Мимир' : ' · ✍️ Ручной'}
                      {' · '}{d.quiz_count} вопросов
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.rune }}>Проверить →</div>
                </div>
              </div>
            ))}
            <div style={{ height: 1, background: '#ffffff08', margin: '16px 0' }} />
          </>
        )}

        {drafts.length === 0 && (
          <div style={{ background: C.green + '10', border: `1px solid ${C.green}30`, borderRadius: 12, padding: '12px 14px', marginBottom: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: C.green }}>✓ Нет черновиков на проверке</div>
          </div>
        )}

        {/* Текущий опубликованный урок + статистика */}
        {current_lesson && (
          <>
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Текущий урок
            </div>
            <div style={{ background: C.card, borderRadius: 14, padding: '14px 16px', marginBottom: 8, border: `1px solid ${C.green}25` }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{current_lesson.title}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                Неделя {current_lesson.week_number}
              </div>

              {/* Прогресс-бар */}
              {progress && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: C.muted }}>Прошли тест</span>
                    <span style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>
                      {progress.passed || 0} / {progress.total_workers || 0}
                    </span>
                  </div>
                  <div style={{ height: 6, background: '#ffffff10', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', background: C.green, borderRadius: 3,
                      width: `${progress.total_workers > 0 ? Math.round((progress.passed || 0) / progress.total_workers * 100) : 0}%`,
                    }} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: C.amber }}>⏳ Читают: {progress.reading || 0}</span>
                    <span style={{ fontSize: 11, color: C.muted }}>◌ Не начали: {progress.not_started || 0}</span>
                  </div>

                  {/* Список рабочих */}
                  {(progress.workers || []).length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      {(progress.workers || []).slice(0, 8).map(w => (
                        <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #ffffff06' }}>
                          <span style={{ fontSize: 12, color: C.text }}>{w.fio}</span>
                          <span style={{ fontSize: 12, color: w.passed ? C.green : w.attempts > 0 ? C.amber : C.muted, fontWeight: 700 }}>
                            {w.passed ? `✓ ${w.score}%` : w.attempts > 0 ? `${w.attempts} попытки` : '—'}
                          </span>
                        </div>
                      ))}
                      {(progress.workers || []).length > 8 && (
                        <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 4 }}>
                          + ещё {(progress.workers || []).length - 8}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* История опубликованных уроков */}
        {published.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 8px' }}>
              Опубликованные уроки
            </div>
            {published.map(p => (
              <div key={p.id} style={{ background: C.card, borderRadius: 12, padding: '10px 14px', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{p.cover_icon} {p.title}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>Неделя {p.week_number}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>✓ {p.passed_count}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>прошли</div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
