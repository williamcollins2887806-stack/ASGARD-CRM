/**
 * FieldAcademy.jsx — Чертоги Мимира
 * Главная страница академии: текущая Руна + факт дня + статистика
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Flame, Check, Ban, BookOpen, Swords, ScrollText, Target, Sparkles, Zap, Circle, BookMarked,
  ArrowDown, Info, Library, ArrowLeft,
} from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { Card, IconTile, KeyButton, SectionLabel, Chip } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

const RANK_TONE = {
  'Новобранец': 'var(--text-secondary)',
  'Дружинник':  'var(--acc)',
  'Хирдман':    'var(--acc)',
  'Ярл':        'var(--value)',
};

function RankBadge({ rank, icon }) {
  const color = RANK_TONE[rank] || 'var(--text-tertiary)';
  return (
    <span style={{
      background: `color-mix(in oklab, ${color} 14%, transparent)`,
      border: `1px solid color-mix(in oklab, ${color} 34%, transparent)`,
      color,
      borderRadius: 20,
      padding: '3px 11px',
      fontSize: 12,
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
    }}>
      {icon ? `${icon} ` : ''}{rank}
    </span>
  );
}

function SectionBlock({ title, subtitle, tone }) {
  return (
    <div style={{ margin: '20px 4px 10px' }}>
      <div style={{ fontSize: 12, fontWeight: 850, letterSpacing: '.1em', textTransform: 'uppercase', color: tone || 'var(--text-tertiary)' }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{subtitle}</div>
      )}
    </div>
  );
}

function StreakBadge({ streak }) {
  if (!streak) return null;
  const color = streak >= 4 ? 'var(--value)' : streak >= 2 ? 'var(--value-ink)' : 'var(--text-tertiary)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color }}>
      <Flame size={16} strokeWidth={2.2} />
      <span style={{ fontSize: 13, fontWeight: 700 }}>
        {streak} {streak % 10 === 1 && streak % 100 !== 11 ? 'неделя' : [2, 3, 4].includes(streak % 10) && ![12, 13, 14].includes(streak % 100) ? 'недели' : 'недель'}
      </span>
    </div>
  );
}

function DailyFactCard({ fact, onView }) {
  const [viewed, setViewed] = useState(fact?.viewed || false);
  if (!fact) return null;

  const catColors = {
    construction: 'var(--value)', history: 'var(--acc)', health: 'var(--ok)',
    tool: 'var(--acc)', law: 'var(--text-tertiary)', science: 'var(--acc)',
    geography: 'var(--ok)', viking: 'var(--value)', general: 'var(--text-tertiary)',
  };
  const catColor = catColors[fact.category] || 'var(--text-tertiary)';

  function handleView() {
    if (!viewed) {
      setViewed(true);
      onView(fact.id);
    }
  }

  return (
    <Card
      variant="raised"
      onClick={handleView}
      style={{ marginBottom: 16, cursor: 'pointer', borderColor: `color-mix(in oklab, ${catColor} 30%, transparent)`, overflow: 'hidden' }}
    >
      <div style={{
        position: 'absolute', top: 0, right: 0, width: 90, height: 90, pointerEvents: 'none',
        background: `radial-gradient(circle, color-mix(in oklab, ${catColor} 16%, transparent) 0%, transparent 70%)`,
      }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, position: 'relative' }}>
        <span style={{ fontSize: 30, lineHeight: 1 }} aria-hidden>{fact.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: catColor, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 }}>
              Факт дня
            </span>
            {viewed && (
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Check size={12} strokeWidth={2.6} /> просмотрено
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{fact.title}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{fact.body}</div>
        </div>
      </div>
    </Card>
  );
}

function CurrentLessonCard({ lesson, navigate, isOnboarding = false, isBlocking = false }) {
  if (!lesson) {
    return (
      <Card variant="flat" className="text-center" style={{ marginBottom: 16 }}>
        <IconTile icon={BookOpen} tone="accent" size={48} style={{ margin: '0 auto 10px' }} />
        <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Нет активной Руны на этой неделе</div>
      </Card>
    );
  }

  const isPassed = lesson.passed;
  const isBlocked = lesson.is_blocked;
  const attemptsLeft = lesson.attempts_left || 0;
  const deadline = lesson.deadline ? new Date(lesson.deadline) : null;
  const daysLeft = deadline ? Math.ceil((deadline - Date.now()) / 86400000) : null;

  const statusColor = isPassed ? 'var(--ok)' : isBlocked ? 'var(--danger)' : daysLeft <= 1 ? 'var(--danger)' : 'var(--value)';
  const statusText = isPassed
    ? `Пройдено — ${lesson.score}%`
    : isBlocked
      ? 'Перечитай Руну'
      : !lesson.read_completed_at
        ? 'Нужно прочитать'
        : `Пройди Испытание (${attemptsLeft} попытки)`;
  const StatusIcon = isPassed ? Check : isBlocked ? Ban : !lesson.read_completed_at ? BookOpen : Swords;

  return (
    <Card
      variant="raised"
      onClick={() => navigate(`/field/academy/lesson/${lesson.id}`)}
      style={{
        marginBottom: 16, cursor: 'pointer',
        borderColor: isPassed ? 'color-mix(in oklab, var(--ok) 30%, transparent)' : 'color-mix(in oklab, var(--value) 24%, transparent)',
        background: lesson.cover_color
          ? `linear-gradient(135deg, color-mix(in oklab, ${lesson.cover_color} 22%, var(--bg-surface)) 0%, var(--bg-surface) 100%)`
          : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            {isOnboarding ? 'Первый вход в чертоги' : isBlocking ? 'Для выхода на смену' : `Руна недели · ${lesson.saga}`}
          </div>
          <div style={{ fontSize: 26, marginBottom: 6, lineHeight: 1 }} aria-hidden>{lesson.cover_icon}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>{lesson.title}</div>
        </div>
        {isPassed && (
          <div style={{
            width: 46, height: 46, borderRadius: 23,
            background: 'var(--soft-ok)',
            border: '2px solid var(--ok)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--on-soft-ok)', flexShrink: 0,
          }}><Check size={22} strokeWidth={2.6} /></div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: statusColor, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <StatusIcon size={14} strokeWidth={2.4} />
          {isPassed ? statusText : statusText}
        </span>
        {daysLeft !== null && !isPassed && (
                <span style={{ fontSize: 12, color: daysLeft <= 1 ? 'var(--danger-ink)' : 'var(--text-secondary)' }}>
            {daysLeft <= 0 ? 'Сегодня дедлайн!' : `${daysLeft}д до дедлайна`}
          </span>
        )}
      </div>

      {lesson.read_completed_at && !isPassed && !isBlocked && (
        <KeyButton
          tone="accent"
          block
          icon={Swords}
          className="mt-3"
          onClick={(e) => { e.stopPropagation(); navigate(`/field/academy/quiz/${lesson.id}`); }}
        >
          Начать Испытание
        </KeyButton>
      )}

      {(!lesson.read_completed_at || isBlocked) && !isPassed && (
        <KeyButton
          tone="value"
          block
          icon={BookOpen}
          className="mt-3"
          onClick={(e) => { e.stopPropagation(); navigate(`/field/academy/lesson/${lesson.id}`); }}
        >
          {isBlocked ? 'Перечитать Руну' : 'Читать Руну'}
        </KeyButton>
      )}

      {isBlocked && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger-ink)', textAlign: 'center' }}>
          Прочитай внимательно — получишь 2 новые попытки
        </div>
      )}

      {!lesson.is_mandatory && !isPassed && (
        <div style={{
          marginTop: 10, fontSize: 11, color: 'var(--text-tertiary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          background: 'var(--bg-surface-alt)',
          padding: '5px 8px', borderRadius: 8,
        }}>
          <Info size={12} strokeWidth={2.4} aria-hidden />
          <span>Необязательная руна — за дополнительные XP/руны</span>
        </div>
      )}
    </Card>
  );
}

// Компактная строка-карточка для секции «Догнать» и «Для опытных»
function LessonRow({ lesson, navigate, primaryHint }) {
  const isPassed = lesson.passed;
  const needReread = lesson.need_reread;
  const isRead = !!lesson.read_completed_at;

  let badge = 'Читать';
  let badgeIcon = BookOpen;
  let badgeColor = 'var(--value)';
  if (isPassed) {
    badge = `${lesson.score}%`;
    badgeIcon = Check;
    badgeColor = 'var(--ok)';
  } else if (needReread) {
    badge = 'Перечитать';
    badgeIcon = BookOpen;
    badgeColor = 'var(--danger)';
  } else if (isRead) {
    badge = 'Испытание';
    badgeIcon = Swords;
    badgeColor = 'var(--acc)';
  }
  const BadgeIcon = badgeIcon;

  return (
    <Card
      variant="raised"
      onClick={() => navigate(`/field/academy/lesson/${lesson.id}`)}
      style={{
        marginBottom: 8, cursor: 'pointer',
        borderColor: primaryHint ? 'color-mix(in oklab, var(--value) 40%, transparent)' : undefined,
        boxShadow: primaryHint ? '0 6px 18px color-mix(in oklab, var(--value) 16%, transparent)' : undefined,
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {lesson.cover_icon
          ? <span style={{ fontSize: 24, flexShrink: 0, width: 44, textAlign: 'center' }} aria-hidden>{lesson.cover_icon}</span>
          : <IconTile icon={BookMarked} tone="value" size={44} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 2 }}>
            Неделя {lesson.week_number} · {lesson.saga}
          </div>
          <div style={{
            fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {lesson.title}
          </div>
          {primaryHint && (
            <div style={{ fontSize: 11, color: 'var(--value-ink)', marginTop: 2, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ArrowDown size={12} strokeWidth={2.6} /> Начни отсюда
            </div>
          )}
        </div>
        <span style={{
          fontSize: 12, fontWeight: 700, color: badgeColor,
          background: `color-mix(in oklab, ${badgeColor} 12%, transparent)`,
          border: `1px solid color-mix(in oklab, ${badgeColor} 30%, transparent)`,
          padding: '5px 10px', borderRadius: 10, flexShrink: 0, whiteSpace: 'nowrap',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <BadgeIcon size={13} strokeWidth={2.4} />
          {badge}
        </span>
      </div>
    </Card>
  );
}

function StatsRow({ stats }) {
  if (!stats) return null;
  const pct = stats.lessons_total > 0 ? Math.round((stats.lessons_passed / stats.lessons_total) * 100) : 0;

  return (
    <Card variant="raised" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Твой путь</span>
        <RankBadge rank={stats.rank} icon={stats.rank_icon} />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {[
          { label: 'Рун пройдено', value: `${stats.lessons_passed}/${stats.lessons_total}`, Icon: ScrollText },
          { label: 'Средний балл', value: `${stats.avg_score}%`, Icon: Target },
          { label: 'Руны заработано', value: stats.runes_total, Icon: Sparkles },
        ].map((s) => (
          <div key={s.label} style={{ flex: 1, background: 'var(--bg-surface-alt)', borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
            <s.Icon size={18} strokeWidth={2} style={{ color: 'var(--value-ink)' }} />
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Прогресс</span>
        <span style={{ fontSize: 12, color: 'var(--value-ink)', fontWeight: 700 }}>{pct}%</span>
      </div>
      <div style={{ height: 7, background: 'var(--bg-surface-alt)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--value), var(--acc))', borderRadius: 4, transition: 'width .5s' }} />
      </div>

      {stats.streak > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--tile-brd)' }}>
          <StreakBadge streak={stats.streak} />
        </div>
      )}
    </Card>
  );
}

export default function FieldAcademy() {
  const navigate = useNavigate();
  const [data, setData] = useState({
    primary: null,
    blocking: null,
    blocking_reason: null,
    archive_pending: [],
    current_week: null,
    optional: [],
  });
  const [fact, setFact] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, f, s] = await Promise.all([
        fieldApi.get('/academy/current-lesson'),
        fieldApi.get('/academy/daily-fact'),
        fieldApi.get('/academy/stats'),
      ]);
      setData({
        primary: l.primary || l.blocking || l.lesson || null,
        blocking: l.blocking || null,
        blocking_reason: l.blocking_reason || null,
        archive_pending: l.archive_pending || l.pending_mandatory || [],
        current_week: l.current_week || null,
        optional: l.optional || [],
      });
      setFact(f.fact);
      setStats(s);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleFactView(factId) {
    try { await fieldApi.post(`/academy/daily-fact/${factId}/view`); } catch { /* silent */ }
  }

  if (loading) {
    return (
      <div className="fs-root p-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        <SkeletonList count={4} />
      </div>
    );
  }

  const { primary, blocking, blocking_reason, archive_pending, current_week, optional } = data;

  const showCurrentWeekSection = current_week
    && (!blocking || current_week.id !== blocking.id)
    && (!primary || current_week.id !== primary.id);

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate(-1)} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Library} tone="accent" size={44} />
          <div>
            <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 2 }}>ЧЕРТОГИ МИМИРА</div>
            <h1 className="fs-head__title">Академия воина</h1>
            <p className="fs-head__sub">Знание — лучшая броня</p>
          </div>
        </div>

        {/* Daily Fact */}
        {fact && <DailyFactCard fact={fact} onView={handleFactView} />}

        {/* === БЛОКИРУЮЩАЯ РУНА (для чекина) === */}
        {blocking && (
          <>
            <SectionBlock title="Для выхода на смену" subtitle="Нужна одна руна для смены" tone="var(--danger)" />
            <CurrentLessonCard
              lesson={blocking}
              navigate={navigate}
              isOnboarding={blocking_reason === 'onboarding'}
              isBlocking
            />
          </>
        )}

        {/* === РУНА ЭТОЙ НЕДЕЛИ (напоминание, если не блокирует) === */}
        {!blocking && primary && (
          <CurrentLessonCard lesson={primary} navigate={navigate} />
        )}

        {showCurrentWeekSection && (
          <>
            <SectionBlock title="Руна этой недели" subtitle="Успей до конца недели — за руны и XP" tone="var(--value-ink)" />
            <CurrentLessonCard lesson={current_week} navigate={navigate} />
          </>
        )}

        {/* === ЛЕТОПИСЬ — для саморазвития (не блокируют смену) === */}
        {archive_pending.length > 0 && (
          <>
            <SectionBlock
              title={`Летопись — для рун и XP (${archive_pending.length})`}
              subtitle="Не блокируют выход на смену"
            />
            {archive_pending.map((l) => (
              <LessonRow key={`archive-${l.id}`} lesson={l} navigate={navigate} />
            ))}
          </>
        )}

        {/* === ДЛЯ ОПЫТНЫХ (необязательные) === */}
        {optional.length > 0 && (
          <>
            <SectionBlock
              title="Для опытных"
              subtitle="Необязательные руны — за XP и руны"
              tone="var(--ok)"
            />
            {optional.map((l) => (
              <LessonRow key={`opt-${l.id}`} lesson={l} navigate={navigate} />
            ))}
          </>
        )}

        {/* Stats */}
        <div style={{ marginTop: 20 }}>
          <StatsRow stats={stats} />
        </div>

        {/* Library button */}
        <KeyButton tone="value" block icon={BookOpen} onClick={() => navigate('/field/academy/library')}>
          Летопись — все Руны
        </KeyButton>
      </div>
    </div>
  );
}
