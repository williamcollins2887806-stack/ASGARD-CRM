/**
 * AccessDenied — inline-RBAC заглушка для страниц.
 *
 * Зачем: backend `requireRoles` отвечает 403, но без явного UI пользователь
 * видит «пустую страницу» — это нарушение UX. Inline-gate показывает,
 * какие роли допущены и какая у текущего пользователя.
 *
 * Использование:
 *   const { user } = useAuth();
 *   const ALLOWED = ['ADMIN', 'PM'];
 *   if (user && !ALLOWED.includes(user.role)) {
 *     return <AccessDenied allowed={ALLOWED} userRole={user.role} />;
 *   }
 *
 *   // Или с кастомным сообщением:
 *   <AccessDenied
 *     allowed={ALLOWED}
 *     userRole={user.role}
 *     title="Доступ закрыт"
 *     message="Раздел только для администраторов и директоров"
 *   />
 *
 * ВАЖНО: проверка ДОЛЖНА быть ПОСЛЕ всех хуков (useState/useEffect/useMemo),
 * иначе React выдаст «Rendered fewer hooks than expected».
 */
export default function AccessDenied({
  allowed = [],
  userRole = '',
  title = 'Нет доступа',
  message = ''
}) {
  const allowedStr = Array.isArray(allowed) && allowed.length
    ? allowed.join(', ')
    : '—';
  const roleStr = userRole || 'не определена';

  return (
    <div
      className="card access-denied"
      role="alert"
      aria-live="polite"
    >
      <div className="access-denied-icon" aria-hidden="true">🚫</div>
      <h2 className="access-denied-title">
        {title}
      </h2>
      {message && (
        <p className="access-denied-msg">
          {message}
        </p>
      )}
      <div className="access-denied-roles">
        <div>
          <b className="c-t1">Доступные роли:</b>{' '}
          <span className="font-mono fs-12-5">
            {allowedStr}
          </span>
        </div>
        <div className="mt-4">
          <b className="c-t1">Ваша роль:</b>{' '}
          <span className="font-mono fs-12-5 c-err">
            {roleStr}
          </span>
        </div>
      </div>
      <p className="access-denied-foot">
        Если доступ нужен — обратитесь к администратору.
      </p>
    </div>
  );
}
