/**
 * API-клиент страницы /office-academy (Залы Асгарда).
 * Источник: vanilla `public/assets/js/office_academy.js` (~584 строки)
 * Backend: src/routes/office-academy.js (prefix /api/office-academy).
 */
import { api } from '@/api/client';

export const TRACK_LABELS = {
  pm: '⚙️ Управление проектами',
  hr: '👥 Кадры',
  finance: '💰 Финансы',
  procurement: '📦 Закупки',
  management: '🏛️ Менеджмент',
  all: '📚 Общие знания'
};

export const TRACK_COLORS = {
  pm: '#3b82f6',
  hr: '#22c55e',
  finance: '#f59e0b',
  procurement: '#ef4444',
  management: '#8b5cf6',
  all: '#6b7280'
};

export const RANK_ICONS = {
  'Мастер': '👑',
  'Воин': '⚔️',
  'Страж': '🛡️',
  'Ученик': '📜'
};

export const ADMIN_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];

/** GET /api/office-academy/lessons — список уроков + статистика пользователя */
export function loadLessons() {
  return api('/api/office-academy/lessons');
}

/** GET /api/office-academy/lessons/:id — урок + вопросы (вопросы санитизированы пока не пройдено) */
export function loadLesson(id) {
  return api(`/api/office-academy/lessons/${id}`);
}

/** POST /api/office-academy/lessons/:id/start — отметить начало чтения */
export function startLesson(id) {
  return api(`/api/office-academy/lessons/${id}/start`, { method: 'POST' });
}

/** POST /api/office-academy/lessons/:id/heartbeat — копит read_time_seconds */
export function heartbeatLesson(id, seconds = 30) {
  return api(`/api/office-academy/lessons/${id}/heartbeat`, {
    method: 'POST',
    body: { seconds }
  });
}

/** POST /api/office-academy/lessons/:id/complete — отметить прочитанным */
export function completeLesson(id) {
  return api(`/api/office-academy/lessons/${id}/complete`, { method: 'POST' });
}

/** POST /api/office-academy/lessons/:id/quiz — отправить ответы */
export function submitQuiz(id, answers) {
  return api(`/api/office-academy/lessons/${id}/quiz`, {
    method: 'POST',
    body: { answers }
  });
}

/** GET /api/office-academy/leaderboard — топ-20 по департаменту */
export function loadLeaderboard() {
  return api('/api/office-academy/leaderboard');
}

/** GET /api/office-academy/stats — личная статистика */
export function loadStats() {
  return api('/api/office-academy/stats');
}

/** Helper: фильтрация по поиску */
export function filterByQuery(items, query) {
  if (!query || !query.trim()) return items;
  const q = query.trim().toLowerCase();
  return items.filter((l) =>
    (l.title || '').toLowerCase().includes(q) ||
    (l.saga || '').toLowerCase().includes(q)
  );
}

/** Helper: уникальные треки из списка */
export function getTracksFromLessons(lessons) {
  const set = new Set();
  lessons.forEach((l) => { if (l.track) set.add(l.track); });
  return Array.from(set);
}

/* Note: loadOfficeAcademyRoot удалён 2026-06-14 — не импортировался, fake-метрика. */
