/**
 * OopsBubble — всплывающая подсказка при клике вне модалки (паритет с ваниль).
 *
 * Поведение: клик по overlay модалки → НЕ закрывает (как было раньше),
 * а показывает случайную фразу в позиции курсора на 1800мс с анимацией.
 *
 * Источник правды (verbatim): public/assets/js/ui.js:695-727 — OOPS_PHRASES + _showOopsBubble.
 * Стили + анимация — в public/desktop-v2-src/src/styles/modals.css (.oops-bubble + @keyframes oops-bubble).
 *
 * Рендерится через portal в document.body (поверх любых модалок,
 * вне modal-stack-root чтобы не наследовать его pointer-events).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// 20 фраз verbatim из vanilla ui.js:695-716 — НЕ ПРАВИТЬ.
export const OOPS_PHRASES = [
  'Закрыть можно крестиком',
  'Модалка не кусается!',
  'Нажми крестик для закрытия',
  'Так не закроешь :)',
  'Крестик наверху справа',
  'Попробуй кнопку «Закрыть»',
  'Мимо! Жми крестик',
  'Почти попал, но нет',
  'Тут ничего нет, а крестик — наверху',
  'Ещё чуть-чуть... шучу, жми крестик',
  'Эй, я тут! Закрой через крестик',
  'Не туда! Крестик правее',
  'Упс, промахнулся',
  'Клик в пустоту...',
  'А вот и нет!',
  'Сюда нажимать бесполезно',
  'Модалку так не закроешь',
  'Крестик ждёт тебя наверху',
  'Не-а, попробуй крестик',
  'Окно закрывается кнопкой «Закрыть»',
];

function pickPhrase() {
  return OOPS_PHRASES[Math.floor(Math.random() * OOPS_PHRASES.length)];
}

export default function OopsBubble({ x, y, onDone }) {
  // выбираем фразу один раз на инстанс через lazy init useState (стабильна на весь lifetime).
  const [phrase] = useState(pickPhrase);

  useEffect(() => {
    const id = setTimeout(() => {
      try { onDone?.(); } catch { /* noop */ }
    }, 1800);
    return () => clearTimeout(id);
  }, [onDone]);

  return createPortal(
    <div
      className="oops-bubble"
      style={{ left: x + 'px', top: y + 'px' }}
      aria-hidden="true"
    >
      {phrase}
    </div>,
    document.body
  );
}
