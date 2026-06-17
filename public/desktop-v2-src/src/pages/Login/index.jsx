/**
 * /login — устаревший роут. Vanilla тоже редиректит сюда → #/welcome
 * (всё авторизационное теперь на /welcome).
 * Если уже залогинен — на /home.
 */
import { useEffect } from 'react';
import { useAuth } from '@/api/useAuth';

export default function LoginPage() {
  const { user, ready } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (user) {
      // сохранённый return_url имеет приоритет
      let returnUrl = null;
      try { returnUrl = sessionStorage.getItem('asgard_return_url'); } catch { /* noop */ }
      try { sessionStorage.removeItem('asgard_return_url'); } catch { /* noop */ }
      window.location.hash = returnUrl || '#/home';
    } else {
      window.location.hash = '#/welcome';
    }
  }, [user, ready]);

  return (
    <div className="p-24 t-center c-t3">
      ⏳ Перенаправление…
    </div>
  );
}
