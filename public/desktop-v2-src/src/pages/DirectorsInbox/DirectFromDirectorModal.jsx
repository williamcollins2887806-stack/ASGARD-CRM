/**
 * DirectFromDirectorModal — обёртка над DirectApplicationModal из PersonalKanban.
 *
 * Назначение: на странице /director-inbox у директора есть кнопка
 * «+ Прямая заявка от меня», которая открывает ту же multipart-форму,
 * что и у РП, но с обязательным выбором PM (`assign_pm_user_id`).
 *
 * Backend: POST /api/inbox-applications/direct — единый endpoint для PM и DIR.
 */
import DirectApplicationModal from '@/pages/PersonalKanban/DirectApplicationModal';

export default function DirectFromDirectorModal({ onCreated }) {
  return <DirectApplicationModal onCreated={onCreated} />;
}
