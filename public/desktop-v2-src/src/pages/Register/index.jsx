/**
 * /register — устаревший роут. Vanilla редиректит → #/welcome
 * (форма регистрации на /welcome через кнопку «Подать заявку»).
 * При необходимости можно открыть напрямую: #/welcome (там есть переключатель).
 */
import { useEffect } from 'react';

export default function RegisterPage() {
  useEffect(() => {
    // На странице Welcome есть STAGES.REGISTER — но мы туда сразу не толкаем
    // (можно повесить query-param если нужно). Пока — просто на /welcome.
    window.location.hash = '#/welcome';
  }, []);

  return (
    <div className="p-24 t-center c-t3">
      ⏳ Перенаправление на форму регистрации…
    </div>
  );
}
