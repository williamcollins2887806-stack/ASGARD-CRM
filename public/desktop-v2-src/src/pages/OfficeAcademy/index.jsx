/**
 * Страница /office-academy — Залы Асгарда (корпоративное обучение).
 *
 * Источник: vanilla `public/assets/js/office_academy.js` (~584 строки, AsgardOfficeAcademyPage).
 * Backend: src/routes/office-academy.js (prefix /api/office-academy).
 *
 *   ✅ index.jsx              ← root + статистика + фильтры + сетка карточек
 *   ✅ api.js                 ← endpoints + helpers + константы (треки, ранги)
 *   ✅ LessonBlocks.jsx       ← рендерер 15+ типов блоков урока
 *   ✅ LessonModal.jsx        ← просмотр урока + heartbeat + кнопки прочитал/испытание
 *   ✅ QuizModal.jsx          ← испытание + экран результатов с разбором
 *   ✅ LeaderboardModal.jsx   ← Зал Славы (топ-20)
 *
 * Никаких заглушек: все кнопки работают, redirect-нет.
 */
import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
import { useDebounce } from '@/api/useListHelpers';

import {
  loadLessons,
  TRACK_LABELS, TRACK_COLORS, RANK_ICONS,
  filterByQuery, getTracksFromLessons
} from './api';
// Закрытие долга КРУГ A-5: LessonModal и Leaderboard выносим в отдельные чанки.
// Они открываются только по клику (карточка/кнопка) — нет смысла грузить с initial бандлом.
// LessonModal внутри уже динамически грузит QuizModal (см. LessonModal.jsx), а QuizModal
// динамически грузит LessonModal обратно — циклическую зависимость убрала КРУГ A-5
// прошлой волной (QuizModal.jsx комментарий «убран статический import LessonModal»).
const LessonModal = lazy(() =>
  import('./LessonModal').then((m) => ({ default: m.LessonModal }))
);
const LeaderboardModal = lazy(() =>
  import('./LeaderboardModal').then((m) => ({ default: m.LeaderboardModal }))
);

import './office-academy.css';

// Маленький fallback для Suspense — модалка грузится миллисекунды, но если медленный канал —
// пользователь увидит «⏳ Открываю…» вместо пустоты.
function LessonModalFallback() {
  return (
    <div style={{ background: 'var(--card-bg)', padding: 48, textAlign: 'center', borderRadius: 'var(--r-md)', color: 'var(--t-3)' }}>
      ⏳ Открываю свиток…
    </div>
  );
}

export default function OfficeAcademyPage() {
  const { user: _user } = useAuth();
  const modal = useModal();

  const [lessons, setLessons] = useState([]);
  const [stats, setStats] = useState({ total: 0, passed: 0, mandatory_pending: 0, total_xp: 0, rank: null });
  const [trackFilter, setTrackFilter] = useState('');
  const [query, setQuery] = useState('');
  const dQuery = useDebounce(query, 300);  // G-11: debounce 300мс
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    loadLessons()
      .then((d) => {
        setLessons(d?.lessons || []);
        setStats({
          total: d?.total || 0,
          passed: d?.passed || 0,
          mandatory_pending: d?.mandatory_pending || 0,
          total_xp: d?.total_xp || 0,
          rank: d?.rank || null
        });
      })
      .catch((e) => {
        const m = String(e?.message || e);
        setError(m);
        toast.error('Не удалось загрузить уроки: ' + m);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener('asgard:office-academy:changed', onChanged);
    return () => window.removeEventListener('asgard:office-academy:changed', onChanged);
  }, []);

  const tracks = useMemo(() => getTracksFromLessons(lessons), [lessons]);

  const visible = useMemo(() => {
    let v = lessons;
    if (trackFilter) v = v.filter((l) => l.track === trackFilter);
    v = filterByQuery(v, dQuery);
    return v;
  }, [lessons, trackFilter, dQuery]);

  const onOpenLesson = (lesson) => {
    // Lazy-чанк LessonModal — оборачиваем в Suspense, чтобы не упасть пока импорт скачивается.
    modal.open(
      <Suspense fallback={<LessonModalFallback />}>
        <LessonModal lessonId={lesson.id} onChanged={refresh} />
      </Suspense>,
      { size: 'wide' }
    );
  };

  const onOpenLeaderboard = () => {
    modal.open(
      <Suspense fallback={<LessonModalFallback />}>
        <LeaderboardModal />
      </Suspense>,
      { size: 'wide' }
    );
  };

  const rank = stats.rank;
  const rankIcon = rank ? (RANK_ICONS[rank.name] || '📜') : '📜';

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Академия"
        title="Залы Асгарда"
        subtitle="Корпоративное обучение. Изучай свитки по своей роли, проходи испытания. За правильные ответы — опыт (XP) и место в Зале Славы."
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={onOpenLeaderboard}>🏆 Зал Славы</Btn>
          </>
        }
      />

      {/* Статистика пользователя */}
      <div className="oa-stats">
        <div className="oa-stat">
          <div className="oa-stat-v">{stats.total}</div>
          <div className="oa-stat-l">Свитков доступно</div>
        </div>
        <div className="oa-stat">
          <div className="oa-stat-v" style={{ color: 'var(--ok-t)' }}>{stats.passed}</div>
          <div className="oa-stat-l">Пройдено</div>
        </div>
        <div className="oa-stat">
          <div className="oa-stat-v" style={{ color: stats.mandatory_pending > 0 ? 'var(--err-t)' : 'var(--t-2)' }}>
            {stats.mandatory_pending}
          </div>
          <div className="oa-stat-l">Обяз. не сданы</div>
        </div>
        <div className="oa-stat">
          <div className="oa-stat-v c-purple" >⚡ {stats.total_xp}</div>
          <div className="oa-stat-l">Опыт</div>
        </div>
        <div className="oa-stat">
          {rank ? (
            <span
              className="oa-stat-rank"
              style={{ background: (rank.color || 'var(--t-3)') + '20', color: rank.color || 'var(--t-1)' }}
            >
              {rankIcon} {rank.name}
            </span>
          ) : (
            <div className="oa-stat-v">—</div>
          )}
          <div className="oa-stat-l">Ранг</div>
        </div>
      </div>

      {/* Фильтры по трекам */}
      {tracks.length > 0 && (
        <div className="oa-filters">
          <button
            className={'oa-filter-btn' + (trackFilter === '' ? ' active' : '')}
            onClick={() => setTrackFilter('')}
          >
            Все
          </button>
          {tracks.map((t) => (
            <button
              key={t}
              className={'oa-filter-btn' + (trackFilter === t ? ' active' : '')}
              onClick={() => setTrackFilter(t)}
            >
              {TRACK_LABELS[t] || t}
            </button>
          ))}
        </div>
      )}

      {/* Поиск */}
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Поиск свитка по названию или саге…"
      />

      {/* Сетка карточек */}
      {loading ? (
        <div className="card card-empty" >
          ⏳ Загружаю свитки…
        </div>
      ) : error ? (
        <div className="card p-32 t-center" >
          <div className="fs-32 opacity-half mb-12">⚠️</div>
          <div className="fs-16 fw-700 mb-6">Ошибка загрузки</div>
          <div className="c-t3 mb-12">{error}</div>
          <Btn variant="primary" onClick={refresh}>Повторить</Btn>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📚"
          title={query || trackFilter ? 'Свитков не найдено' : 'Свитков пока нет'}
          hint={query || trackFilter ? 'Попробуйте изменить фильтр или поиск' : 'Свитки появятся, как только администратор опубликует их.'}
          action={(query || trackFilter) ? <Btn variant="ghost" onClick={() => { setQuery(''); setTrackFilter(''); }}>↺ Сбросить</Btn> : null}
        />
      ) : (
        <div className="oa-grid">
          {visible.map((L) => (
            <LessonCard key={L.id} lesson={L} onOpen={() => onOpenLesson(L)} />
          ))}
        </div>
      )}
    </div>
  );
}

function LessonCard({ lesson, onOpen }) {
  const passed = !!lesson.passed;
  const needsReread = lesson.attempts >= 2 && !lesson.passed && !lesson.read_completed_at;
  const trackLabel = TRACK_LABELS[lesson.track] || lesson.track;
  const tc = TRACK_COLORS[lesson.track] || 'var(--t-3)';

  return (
    <div
      className="oa-card"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
      role="button"
      tabIndex={0}
      aria-label={`Урок ${lesson.title || 'без названия'}`}
    >
      <div
        className="oa-card-cover"
        style={{ background: lesson.cover_color || 'linear-gradient(135deg, var(--purple), var(--blue))' }}
      >
        <div className="oa-card-icon">{lesson.cover_icon || '🏛️'}</div>
        <div>
          <div className="oa-card-cover-title">{lesson.title || ''}</div>
          {lesson.saga && <div className="oa-card-cover-saga">{lesson.saga}</div>}
        </div>
      </div>

      <div className="oa-card-body">
        <div className="oa-meta-pills">
          <span className="oa-pill track" style={{ background: tc + '20', color: tc }}>
            {trackLabel}
          </span>
          {lesson.is_mandatory && <span className="oa-pill must">⚠️ Обязательно</span>}
          {lesson.estimated_minutes && <span className="oa-pill">⏱ {lesson.estimated_minutes} мин</span>}
          {lesson.xp_earned > 0 && <span className="oa-pill xp">⚡ {lesson.xp_earned}</span>}
        </div>

        <div className="oa-status-row">
          {passed ? (
            <span className="oa-pill ok">✓ Пройдено · {lesson.score || 0}%</span>
          ) : needsReread ? (
            <span className="oa-pill warn">📖 Перечитай</span>
          ) : lesson.attempts > 0 ? (
            <span className="oa-pill warn">Попыток: {lesson.attempts}</span>
          ) : (
            <span className="oa-pill">Не начато</span>
          )}
        </div>
      </div>
    </div>
  );
}
