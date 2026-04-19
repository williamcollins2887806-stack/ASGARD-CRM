import { Zap } from 'lucide-react';

const SUGGESTIONS = [
  'Какие тендеры в работе?',
  'Покажи задачи на сегодня',
  'Сводка по финансам',
  'Кто на объекте?',
];

/**
 * MimirWelcome — пустое состояние Мимира с подсказками
 */
export function MimirWelcome({ onSuggest }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
      {/* Big icon */}
      <div
        className="flex items-center justify-center rounded-full mb-6"
        style={{
          width: 80,
          height: 80,
          background: 'var(--gold-gradient)',
          boxShadow: '0 0 40px rgba(200, 168, 78, 0.2)',
        }}
      >
        <Zap size={36} color="#fff" />
      </div>

      <h2
        className="text-[20px] font-bold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        Спроси Мимира
      </h2>
      <p
        className="text-[13px] text-center mb-8"
        style={{ color: 'var(--text-secondary)', maxWidth: 280 }}
      >
        AI-ассистент ASGARD. Задайте вопрос о тендерах, задачах, финансах или
        сотрудниках.
      </p>

      {/* Suggestion chips */}
      <div className="flex flex-col gap-2 w-full max-w-sm">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onSuggest(s)}
            className="w-full text-left px-4 py-3 rounded-xl spring-tap text-[14px]"
            style={{
              border: '1px solid color-mix(in srgb, var(--gold) 25%, var(--border-norse))',
              color: 'var(--gold)',
              background: 'color-mix(in srgb, var(--gold) 3%, transparent)',
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
