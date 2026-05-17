import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import PmTabBar from '@/components/pm/PmTabBar';

const C = {
  bg: '#0d0d12', card: '#16161f', gold: '#c8a84b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', rune: '#7b61ff', text: '#e8e8f0', muted: '#6b7280',
};

// Ближайший понедельник начиная от даты (включительно)
function nearestMonday(from = new Date()) {
  const d = new Date(from);
  const day = d.getDay(); // 0=вс, 1=пн
  if (day !== 1) d.setDate(d.getDate() + ((8 - day) % 7 || 7));
  return d.toISOString().split('T')[0];
}

// Следующий понедельник после последней занятой даты
function suggestNextRelease(published) {
  const mondays = published
    .map(p => p.release_monday)
    .filter(Boolean)
    .sort();
  if (!mondays.length) return nearestMonday();
  const last = new Date(mondays[mondays.length - 1]);
  last.setDate(last.getDate() + 7);
  const today = new Date();
  return last > today ? last.toISOString().split('T')[0] : nearestMonday();
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function isMonday(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr).getDay() === 1;
}

export default function PmAcademy() {
  const navigate = useNavigate();
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [lesson, setLesson]       = useState(null);
  const [rejectText, setRejectText] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [releaseDate, setReleaseDate] = useState('');
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState('');
  const [editingRelease, setEditingRelease] = useState(null); // id урока для редактирования даты

  const load = () => {
    setLoading(true);
    api.get('/pm/academy')
      .then(d => { setData(d); })
      .catch(e => setMsg(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  async function openLesson(id) {
    setSelected(id);
    try {
      const res = await api.get(`/pm/academy/lesson/${id}`);
      setLesson(res);
      // Авто-подсказка даты при открытии черновика
      setReleaseDate(suggestNextRelease(data?.published || []));
    } catch (e) { setMsg('Ошибка загрузки: ' + e.message); }
  }

  async function handleApprove(id) {
    if (!releaseDate) { setMsg('Укажи дату начала недели'); return; }
    if (!isMonday(releaseDate)) { setMsg('Дата должна быть понедельником'); return; }
    setSaving(true);
    try {
      await api.post(`/pm/academy/${id}/approve`, { release_monday: releaseDate });
      setMsg(`✅ Урок опубликован! Блокировка смен с ${fmtDate(new Date(releaseDate).toISOString().split('T')[0].replace(/-/g, '-'))} + 7 дней.`);
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

  async function handleSetRelease(lessonId, date) {
    if (!isMonday(date)) { setMsg('Дата должна быть понедельником'); return; }
    setSaving(true);
    try {
      await api.put(`/pm/academy/${lessonId}/release-date`, { release_monday: date });
      setMsg('Дата блокировки обновлена');
      setEditingRelease(null);
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

  // ═══ Детальный просмотр черновика ═══
  if (lesson && selected) {
    const hasQuestions = (lesson.questions || []).length > 0;
    const mon = new Date(releaseDate);
    const sun = new Date(releaseDate);
    sun.setDate(mon.getDate() + 6);
    const blockFrom = new Date(releaseDate);
    blockFrom.setDate(mon.getDate() + 7);

    return (
      <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 90 }}>
        <div style={{ padding: '48px 16px 16px' }}>
          <button onClick={() => { setSelected(null); setLesson(null); }}
            style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, marginBottom: 10, padding: 0 }}>
            ← Назад
          </button>

          {/* Обложка */}
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

          {/* Дата-пикер — обязательный шаг */}
          <div style={{ background: C.card, borderRadius: 14, padding: '14px 16px', marginBottom: 14, border: `1px solid ${C.gold}30` }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.gold, marginBottom: 10 }}>
              📅 Расписание блокировки
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.6 }}>
              Укажи понедельник недели когда рабочие должны пройти этот урок.
              Смены блокируются со следующего понедельника если не сдали.
            </div>

            <input
              type="date"
              value={releaseDate}
              onChange={e => setReleaseDate(e.target.value)}
              style={{
                width: '100%', background: '#1a1a2e', border: `1px solid ${releaseDate && !isMonday(releaseDate) ? C.red : '#ffffff15'}`,
                borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14,
                marginBottom: 8, boxSizing: 'border-box',
              }}
            />

            {releaseDate && !isMonday(releaseDate) && (
              <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>
                ⚠️ Должен быть понедельник. Выбрано: {new Date(releaseDate).toLocaleDateString('ru-RU', { weekday: 'long' })}
              </div>
            )}

            {releaseDate && isMonday(releaseDate) && (
              <div style={{ background: C.green + '12', border: `1px solid ${C.green}30`, borderRadius: 10, padding: '10px 12px', fontSize: 12 }}>
                <div style={{ color: C.text, marginBottom: 4 }}>
                  📖 <strong>Учёба:</strong> {fmtDate(releaseDate)} — {fmtDate(sun.toISOString().split('T')[0])}
                </div>
                <div style={{ color: C.amber }}>
                  🚫 <strong>Блокировка смен</strong> с {fmtDate(blockFrom.toISOString().split('T')[0])} (если не сдали)
                </div>
              </div>
            )}
          </div>

          {/* Превью контента */}
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

          {/* Вопросы */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Вопросы квиза ({(lesson.questions || []).length})
            </div>
            {!hasQuestions ? (
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

          {lesson.lesson.status === 'draft' && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => handleApprove(selected)}
                disabled={saving || !hasQuestions || !releaseDate || !isMonday(releaseDate)}
                style={{
                  flex: 2, padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
                  background: (!hasQuestions || !releaseDate || !isMonday(releaseDate)) ? '#ffffff10' : C.green,
                  color: (!hasQuestions || !releaseDate || !isMonday(releaseDate)) ? C.muted : '#000',
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
        <PmTabBar />
      </div>
    );
  }

  // ═══ Главный экран академии ═══
  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 90 }}>
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

        {/* Черновики */}
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

        {/* Текущий урок + прогресс */}
        {current_lesson && (
          <>
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Текущий урок
            </div>
            <div style={{ background: C.card, borderRadius: 14, padding: '14px 16px', marginBottom: 8, border: `1px solid ${C.green}25` }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{current_lesson.title}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                Неделя {current_lesson.week_number}
                {current_lesson.release_monday && ` · с ${fmtDate(current_lesson.release_monday)}`}
              </div>

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
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Опубликованные уроки — расписание */}
        {published.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 8px' }}>
              Расписание уроков
            </div>
            {published.map(p => {
              const isEditing = editingRelease === p.id;
              const [editDate, setEditDate] = useState(p.release_monday || '');
              const hasDate = !!p.release_monday;

              return (
                <div key={p.id} style={{
                  background: C.card, borderRadius: 12, padding: '12px 14px', marginBottom: 8,
                  border: !hasDate ? `1px solid ${C.amber}30` : '1px solid #ffffff0d',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{p.cover_icon} {p.title}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Неделя {p.week_number}</div>
                      {hasDate ? (
                        <div style={{ fontSize: 11, color: C.blue, marginTop: 3 }}>
                          📅 {fmtDate(p.release_monday)} · 🚫 с {fmtDate(new Date(new Date(p.release_monday).getTime() + 7 * 864e5).toISOString().split('T')[0])}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: C.amber, marginTop: 3 }}>⚠️ Дата не установлена — смены не блокируются</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>✓ {p.passed_count}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>прошли</div>
                      <button
                        onClick={() => { setEditingRelease(isEditing ? null : p.id); }}
                        style={{ marginTop: 4, fontSize: 10, color: C.blue, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        {isEditing ? 'Отмена' : '✏️ Дата'}
                      </button>
                    </div>
                  </div>

                  {isEditing && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="date"
                        value={editDate}
                        onChange={e => setEditDate(e.target.value)}
                        style={{
                          flex: 1, background: '#1a1a2e', border: `1px solid ${editDate && !isMonday(editDate) ? C.red : '#ffffff15'}`,
                          borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 13, boxSizing: 'border-box',
                        }}
                      />
                      <button
                        onClick={() => handleSetRelease(p.id, editDate)}
                        disabled={saving || !editDate || !isMonday(editDate)}
                        style={{
                          padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                          background: editDate && isMonday(editDate) ? C.blue : '#ffffff10',
                          color: editDate && isMonday(editDate) ? '#fff' : C.muted,
                          fontWeight: 700, fontSize: 12, flexShrink: 0,
                        }}>
                        {saving ? '...' : 'Сохранить'}
                      </button>
                    </div>
                  )}
                  {isEditing && editDate && !isMonday(editDate) && (
                    <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>
                      Выбери понедельник ({new Date(editDate).toLocaleDateString('ru-RU', { weekday: 'long' })})
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
      <PmTabBar />
    </div>
  );
}
