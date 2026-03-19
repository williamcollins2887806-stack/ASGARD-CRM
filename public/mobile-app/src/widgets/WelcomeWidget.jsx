import { useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';

const NORSE_QUOTES = [
  'Кто мудр — тот молчит, пока не спросят.',
  'Лучше живым быть, чем мёртвым; живой добудет добычу.',
  'Не спеши языком — спеши делом.',
  'С рассветом приходит победа, если ночь провёл в подготовке.',
  'Никто не знает свой срок — но каждый знает свой долг.',
  'Дерево узнаёшь по плодам, а человека — по делам.',
  'Кто не рискует — не пьёт из рога славы.',
  'Мудрый не тот, кто много знает, а тот, кто знает нужное.',
];

function getGreeting(hour) {
  if (hour < 6) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

/**
 * WelcomeWidget — герой-карточка приветствия (premium)
 */
export default function WelcomeWidget() {
  const user = useAuthStore((s) => s.user);

  const now = new Date();
  const hour = now.getHours();
  const greeting = getGreeting(hour);

  const dateStr = now.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const quote = useMemo(
    () => NORSE_QUOTES[Math.floor(Math.random() * NORSE_QUOTES.length)],
    []
  );

  return (
    <div
      className="rounded-3xl relative overflow-hidden"
      style={{
        background: 'var(--hero-gradient)',
        padding: 20,
        boxShadow: '0 8px 32px rgba(26, 74, 138, 0.2)',
        border: '0.5px solid rgba(255,255,255,0.08)',
        animation: 'widgetScaleIn var(--motion-normal) var(--ease-spring) forwards',
      }}
    >
      {/* Rune watermark background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='240'%3E%3Cg opacity='0.04' fill='%23D4A843'%3E%3Ctext x='20' y='40' font-size='28' font-family='serif'%3E%E1%9A%A0%3C/text%3E%3Ctext x='80' y='70' font-size='24' font-family='serif'%3E%E1%9A%B1%3C/text%3E%3Ctext x='150' y='50' font-size='30' font-family='serif'%3E%E1%9A%A6%3C/text%3E%3Ctext x='220' y='80' font-size='26' font-family='serif'%3E%E1%9B%8F%3C/text%3E%3Ctext x='40' y='120' font-size='22' font-family='serif'%3E%E1%9A%B9%3C/text%3E%3Ctext x='120' y='140' font-size='28' font-family='serif'%3E%E1%9B%97%3C/text%3E%3Ctext x='200' y='130' font-size='24' font-family='serif'%3E%E1%9A%A8%3C/text%3E%3Ctext x='60' y='190' font-size='26' font-family='serif'%3E%E1%9A%B7%3C/text%3E%3Ctext x='160' y='200' font-size='30' font-family='serif'%3E%E1%9B%9A%3C/text%3E%3C/g%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
        }}
      />

      {/* Decorative circles */}
      <div
        className="absolute -top-8 -right-8 w-32 h-32 rounded-full"
        style={{ background: 'rgba(255,255,255,0.04)' }}
      />
      <div
        className="absolute -bottom-4 -left-4 w-24 h-24 rounded-full"
        style={{ background: 'rgba(200, 168, 78, 0.06)' }}
      />

      {/* Content */}
      <div className="relative z-10">
        {/* Greeting with pulsing gold dot */}
        <div className="flex items-center gap-2">
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--gold)',
              animation: 'pulseGold 2s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          <h2
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1.2,
            }}
          >
            {greeting}, {user?.full_name || user?.login || 'Воин'}
          </h2>
        </div>

        <p
          className="mt-1.5 capitalize"
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
          }}
        >
          {dateStr}
        </p>

        {/* Quote with gold left-border (blockquote style) */}
        <div
          className="mt-3"
          style={{
            borderLeft: '2px solid var(--gold)',
            paddingLeft: 10,
          }}
        >
          <p
            style={{
              fontSize: 13,
              color: 'var(--gold)',
              fontStyle: 'italic',
              lineHeight: 1.4,
            }}
          >
            &laquo;{quote}&raquo;
          </p>
        </div>
      </div>
    </div>
  );
}
