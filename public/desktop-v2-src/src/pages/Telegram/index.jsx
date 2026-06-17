/**
 * Страница /telegram — Telegram интеграция (миграция из vanilla
 * `public/assets/js/telegram.js` → React v2).
 *
 *   ✅ index.jsx        — корень + табы Bot/Users/Test
 *   ✅ api.js           — все endpoints
 *   ✅ BotSettings.jsx  — токен, username, webhook, кнопка «Проверить бота»
 *   ✅ UsersList.jsx    — таблица всех юзеров CRM с inline-input chat_id +
 *                        кнопка «Отправить пароль через Telegram»
 *   ✅ TestSend.jsx     — выбор юзера + textarea + лог отправок (шаблоны)
 *
 * Что НЕ переносим из vanilla (по правилам zero-compromise / no-stubs,
 * см. MEMORY.md): bot_token из IndexedDB и прямой fetch к Telegram API
 * из браузера — теперь всё через backend-прокси `/api/telegram/*`.
 *
 * RBAC: ADMIN (backend /settings, /check-bot, /users, /test-message),
 * ADMIN/PM/HEAD_PM для /send.
 */
import { useState } from 'react';
import { TopActionsBar, TabsBar } from '@/blocks/Blocks';
import AccessDenied from '@/blocks/AccessDenied';
import { useAuth } from '@/api/useAuth';
import BotSettings from './BotSettings';
import UsersList from './UsersList';
import TestSend from './TestSend';

const TABS = [
  { id: 'bot',   label: '🤖 Бот' },
  { id: 'users', label: '👥 Пользователи' },
  { id: 'test',  label: '✈️ Тест-отправка' }
];

export default function TelegramPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('bot');

  // Defensive guard: страница доступна только ADMIN (роут-уровневая защита
  // уже есть в App.jsx, но дублируем здесь, чтобы любые попытки прямого
  // импорта компонента из других мест тоже блокировались).
  if (user && user.role !== 'ADMIN') {
    return <AccessDenied allowed={['ADMIN']} userRole={user.role} />;
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Связи"
        title="Telegram-бот"
        subtitle="Уведомления о тендерах, согласованиях, премиях, ДР"
        actions={null}
      />

      <TabsBar tabs={TABS} active={tab} onChange={setTab} />

      <div>
        {tab === 'bot'   && <BotSettings key="bot" />}
        {tab === 'users' && <UsersList key="users" />}
        {tab === 'test'  && <TestSend key="test" />}
      </div>
    </div>
  );
}
