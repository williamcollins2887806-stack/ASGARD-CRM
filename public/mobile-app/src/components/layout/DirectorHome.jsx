import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

/** V391: у директора мобильный арсенал сужен до согласований (заказчик
 *  15.10.2026) — дашборд создаёт лишний шум. Домашний роут «/» уводим прямо
 *  на экран согласований. Десктоп не затрагивается: там у директора всё видно. */
export const DIRECTOR_ROLES = ['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];

export function isDirectorRole(role) {
  return DIRECTOR_ROLES.includes(role);
}

export default function DirectorHome({ children }) {
  const role = useAuthStore((s) => s.user?.role);
  if (isDirectorRole(role)) return <Navigate to="/director-approvals" replace />;
  return children;
}
