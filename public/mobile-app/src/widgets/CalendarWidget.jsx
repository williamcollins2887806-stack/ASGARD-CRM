import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { WidgetShell } from '@/widgets/WidgetShell';

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * CalendarWidget — текущая неделя (Пн-Вс)
 * NO API — данные из Date
 */
export default function CalendarWidget() {
  const navigate = useNavigate();
  const haptic = useHaptic();

  const { days, todayIndex } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find Monday of current week
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon...
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);

    const result = [];
    let todayIdx = -1;

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      if (d.getTime() === today.getTime()) todayIdx = i;
      result.push({
        name: DAY_NAMES[i],
        number: d.getDate(),
      });
    }

    return { days: result, todayIndex: todayIdx };
  }, []);

  return (
    <WidgetShell name="Календарь" icon="📅">
      <button
        className="flex justify-between w-full spring-tap"
        onClick={() => {
          haptic.light();
          navigate('/meetings');
        }}
      >
        {days.map((day, i) => {
          const isToday = i === todayIndex;
          return (
            <div
              key={i}
              className="flex flex-col items-center gap-1"
              style={{
                minWidth: 34,
                padding: '6px 4px',
                borderRadius: 12,
                backgroundColor: isToday ? 'var(--red)' : 'transparent',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: isToday ? 'rgba(255,255,255,0.7)' : 'var(--text-tertiary)',
                }}
              >
                {day.name}
              </span>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: isToday ? 700 : 500,
                  color: isToday ? '#fff' : 'var(--text-primary)',
                }}
              >
                {day.number}
              </span>
            </div>
          );
        })}
      </button>
    </WidgetShell>
  );
}
