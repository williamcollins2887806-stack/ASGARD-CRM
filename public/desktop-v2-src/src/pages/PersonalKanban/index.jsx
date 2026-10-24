/**
 * Страница /personal-kanban — Личный канбан (Сага Тендеров, 9 колонок воронки).
 *
 * 23.10.2026 — вид «По под-этапам» удалён полностью.
 *
 * Почему: кнопка «📋 По под-этапам» не работала — она выставляла viewMode, но
 * вид собирался из подэтапов пользователя, которых у большинства не было, и
 * экран оставался пустым. При этом сохранённый в localStorage
 * `asgard_v2_pk_view_mode = 'substages'` воспроизводил пустую страницу при
 * каждом заходе, то есть дефект возвращался сам.
 *
 * Теперь страница ОДНОЗНАЧНО рендерит воронку `BoardV3`: никакого выбора вида,
 * никакого чтения viewMode из localStorage. Мёртвые компоненты (Column,
 * ConfiguratorModal, DetailModal, DirectApplicationModal) больше не импортируются —
 * их файлы остались в репозитории, но в этот маршрут не входят.
 *
 * Backend: src/routes/personal-kanban.js, регистрация `/api/personal-kanban`.
 * Источник поведения: PERSONAL_KANBAN_AND_INBOX_PIPELINE.md §4.2.
 */
import { useAuth } from '@/api/useAuth';
import AccessDenied from '@/blocks/AccessDenied';
import BoardV3 from './BoardV3';
import './personal-kanban.css';

// S-21: TO/HEAD_TO добавлены — у них собственный режим scope (to_personal / to_team), а не PM-канбан.
const ALLOWED_ROLES = ['PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function PersonalKanbanPage() {
  const { user } = useAuth();
  const allowed = !!user && ALLOWED_ROLES.includes(user.role);

  if (allowed) {
    return <BoardV3 />;
  }

  // Гейт прав — S-31.1 F-5: используем общий <AccessDenied/> (как в Tenders/index.jsx).
  if (user && !allowed) {
    return (
      <AccessDenied
        allowed={ALLOWED_ROLES}
        userRole={user.role}
        title="Личный канбан недоступен"
        message="Раздел канбана видят РП, главы РП, тендерный отдел и директора."
      />
    );
  }

  // user ещё не загружен — пустой каркас вместо мигания «нет доступа».
  return null;
}
