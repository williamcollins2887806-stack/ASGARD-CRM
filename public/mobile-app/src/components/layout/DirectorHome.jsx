import { useAuthStore } from '@/stores/authStore';

/** 17.10.2026 (заказчик): директору вернули главную страницу с виджетами —
 *  «погорячился, когда сказал что директору закрываем все вкладки». Раньше
 *  здесь был безусловный редирект на /director-approvals, из-за чего единый
 *  виджет согласований и «К исполнению» на главной были не видны.
 *  Теперь главная рендерится как есть; согласования доступны и вкладкой,
 *  и тапом по виджету. Десктоп не затрагивается. */
export const DIRECTOR_ROLES = ['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];

export function isDirectorRole(role) {
  return DIRECTOR_ROLES.includes(role);
}

export default function DirectorHome({ children }) {
  // Роль читаем, чтобы компонент оставался стабильным при смене пользователя,
  // но больше НЕ редиректим: главная с виджетами — основной экран директора.
  useAuthStore((s) => s.user?.role);
  return children;
}
