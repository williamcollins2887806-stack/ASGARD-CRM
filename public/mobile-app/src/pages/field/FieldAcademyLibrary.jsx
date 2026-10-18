/**
 * FieldAcademyLibrary.jsx — Летопись (архив всех Рун)
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HardHat, Hand, Mountain, Flame, Biohazard, CircleDashed, Zap, Plane, BookOpen, Landmark,
  ScrollText, Pill, Scale, Wrench, ArrowLeft, Library, Lock, Check, Swords, XCircle,
} from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { Card, IconTile, KeyButton, Chip, EmptyState } from '@/components/field/ui';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import './field-screens.css';

const TAG_META = {
  safety: { label: 'ТБ', icon: HardHat },
  ppe: { label: 'СИЗ', icon: Hand },
  height: { label: 'Высота', icon: Mountain },
  fire: { label: 'Пожар', icon: Flame },
  gas: { label: 'Газ', icon: Biohazard },
  confined: { label: 'Замкнутые', icon: CircleDashed },
  electrical: { label: 'Электро', icon: Zap },
  helicopter: { label: 'Вертолёт', icon: Plane },
  basiet: { label: 'БАСИЕТ', icon: Plane },
  knowledge: { label: 'Знания', icon: BookOpen },
  materials: { label: 'Материалы', icon: Landmark },
  history: { label: 'История', icon: ScrollText },
  health: { label: 'Здоровье', icon: Pill },
  law: { label: 'Закон', icon: Scale },
  tool: { label: 'Инструмент', icon: Wrench },
};

function Tag({ tag }) {
  const meta = TAG_META[tag];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, color: 'var(--text-tertiary)', background: 'var(--bg-surface-alt)',
      padding: '2px 7px', borderRadius: 8,
    }}>
      <Icon size={10} strokeWidth={2.4} aria-hidden />
      {meta.label}
    </span>
  );
}

function LessonCard({ lesson, navigate }) {
  const isPassed = lesson.passed;
  const isRead = !!lesson.read_completed_at;
  const isOptional = lesson.is_mandatory === false; // явный false (true либо undefined = обязательная по умолчанию)

  let statusIcon = Lock;
  let statusColor = 'var(--text-tertiary)';
  let statusText = 'Не начата';

  if (isPassed) {
    statusIcon = Check;
    statusColor = 'var(--ok)';
    statusText = `${lesson.score}%`;
  } else if (isRead) {
    statusIcon = Swords;
    statusColor = 'var(--value-ink)';
    statusText = 'Прочитана';
  } else if (!isRead && lesson.attempts > 0) {
    // read_completed_at was reset after 2 failed attempts
    statusIcon = XCircle;
    statusColor = 'var(--danger)';
    statusText = 'Перечитай';
  }
  const StatusIcon = statusIcon;

  return (
    <Card
      variant="raised"
      onClick={() => navigate(`/field/academy/lesson/${lesson.id}`)}
      style={{
        marginBottom: 10, cursor: 'pointer',
        borderColor: isPassed ? 'color-mix(in oklab, var(--ok) 30%, transparent)' : undefined,
      }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: lesson.cover_color
            ? `color-mix(in oklab, ${lesson.cover_color} 40%, var(--bg-surface-alt))`
            : 'var(--bg-surface-alt)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, flexShrink: 0,
        }} aria-hidden>
          {lesson.cover_icon || <Library size={22} color="var(--text-tertiary)" />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>{lesson.saga} · Неделя {lesson.week_number}</span>
            {isOptional && (
              <span style={{
                fontSize: 9, color: 'var(--on-soft-ok)', background: 'var(--soft-ok)',
                padding: '1px 6px', borderRadius: 6, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                По желанию
              </span>
            )}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lesson.title}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {(lesson.tags || []).slice(0, 2).map((tag) => <Tag key={tag} tag={tag} />)}
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>~{lesson.estimated_minutes} мин</span>
          </div>
        </div>

        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <StatusIcon size={20} strokeWidth={2.4} style={{ color: statusColor }} aria-hidden />
          <div style={{ fontSize: 11, color: statusColor, fontWeight: 700 }}>{statusText}</div>
          {lesson.runes_earned > 0 && (
            <div style={{ fontSize: 10, color: 'var(--value-ink)', marginTop: 2 }}>+{lesson.runes_earned}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function FieldAcademyLibrary() {
  const navigate = useNavigate();
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('catchup'); // catchup | all | passed | unread

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fieldApi.get('/academy/lessons');
      setLessons(data.lessons || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Догнать = обязательные несданные с прошедшим release_monday,
  // отсортировать по week_number ↑ (то есть от старых к новым)
  const today = new Date().toISOString().split('T')[0];
  const catchupLessons = lessons
    .filter((l) => l.is_mandatory !== false && !l.passed && l.release_monday && l.release_monday <= today)
    .sort((a, b) => a.week_number - b.week_number);

  const filtered = filter === 'catchup'
    ? catchupLessons
    : lessons.filter((l) => {
        if (filter === 'passed') return l.passed;
        if (filter === 'unread') return !l.read_completed_at;
        return true;
      });

  const passedCount = lessons.filter((l) => l.passed).length;
  const totalCount = lessons.length;

  return (
    <div className="fs-root" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
      <div className="fs-scene" aria-hidden><span className="fs-orb fs-orb--a" /><span className="fs-orb fs-orb--b" /></div>

      <div className="fs-content">
        {/* Header */}
        <div className="fs-head">
          <button onClick={() => navigate('/field/academy')} className="fs-head__btn" aria-label="Назад">
            <ArrowLeft size={20} strokeWidth={2.3} />
          </button>
          <IconTile icon={Library} tone="value" size={42} />
          <div>
            <h1 className="fs-head__title">Летопись</h1>
            <p className="fs-head__sub">Пройдено {passedCount} из {totalCount} Рун</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
          <Chip tone="danger" active={filter === 'catchup'} onClick={() => setFilter('catchup')}>
            Что догнать{catchupLessons.length ? ` (${catchupLessons.length})` : ''}
          </Chip>
          <Chip tone="accent" active={filter === 'all'} onClick={() => setFilter('all')}>Все</Chip>
          <Chip tone="accent" active={filter === 'unread'} onClick={() => setFilter('unread')}>Не прочитаны</Chip>
          <Chip tone="status" active={filter === 'passed'} onClick={() => setFilter('passed')}>Пройденные</Chip>
        </div>

        <div>
          {loading ? (
            <SkeletonList count={5} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={filter === 'catchup' ? Check : Library}
              title={filter === 'catchup' ? 'Все обязательные руны сданы. Можно работать спокойно!' : 'Нет Рун в этом разделе'}
              description={filter === 'catchup' ? '' : 'Попробуй другой фильтр'}
            />
          ) : (
            filtered.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} navigate={navigate} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
