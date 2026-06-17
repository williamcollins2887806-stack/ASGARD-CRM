/**
 * Страница /office-schedule — Календарь офиса.
 * Источник: vanilla `public/assets/js/office_schedule.js` (~364 строки).
 *
 * Что умеет:
 *   • Календарная сетка месяц × сотрудники со статусами дней
 *   • Клик по ячейке → модалка выбора статуса (StatusPickerModal)
 *   • Сотрудник редактирует только свою строку; OFFICE_MANAGER / ADMIN /
 *     директора (если выключен officeStrictOwn в settings) — любую
 *   • Сид staff из активных пользователей при первом заходе
 *   • Навигация по месяцам (◀ / ▶)
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, EmptyState } from '@/blocks/Blocks';
import { api } from '@/api/client';

import {
  STATUS, MONTHS_RU,
  ymd, isWeekend, daysInMonth,
  ensureStaffSeed, loadPlan, upsertPlan, toRGBA, isDirectorRole
} from './api';
import { StatusPickerModal } from './StatusPickerModal';
import './office-schedule.css';

const STATUS_BY_CODE = Object.fromEntries(STATUS.map((s) => [s.code, s]));

async function loadOfficeStrictOwn() {
  try {
    const d = await api('/api/data/settings/app');
    const val = d?.value_json || d?.item?.value_json || null;
    if (val) {
      const cfg = typeof val === 'string' ? JSON.parse(val) : val;
      if (cfg?.schedules?.office_strict_own != null) {
        return !!cfg.schedules.office_strict_own;
      }
    }
  } catch (_) { /* noop */ }
  return true;
}

export default function OfficeSchedulePage() {
  const { user } = useAuth();
  const modal = useModal();

  const now = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [staff, setStaff] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [strictOwn, setStrictOwn] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([ensureStaffSeed(), loadPlan(), loadOfficeStrictOwn()])
      .then(([s, p, strict]) => {
        setStaff(s);
        setPlans(p);
        setStrictOwn(strict);
      })
      .catch((e) => toast.error('Не удалось загрузить расписание: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const planMap = useMemo(() => {
    const m = new Map();
    const startIso = ymd(new Date(viewYear, viewMonth, 1));
    const endIso = ymd(new Date(viewYear, viewMonth, daysInMonth(viewYear, viewMonth)));
    for (const p of plans) {
      if (!p?.date) continue;
      const d = ymd(p.date);
      if (d < startIso || d > endIso) continue;
      m.set(`${p.staff_id}|${d}`, p.status_code || '');
    }
    return m;
  }, [plans, viewYear, viewMonth]);

  const canEditRow = useCallback((s) => {
    if (!user) return false;
    if (s.user_id === user.id) return true;
    if (user.role === 'OFFICE_MANAGER') return true;
    if (!strictOwn && (user.role === 'ADMIN' || isDirectorRole(user.role))) return true;
    return false;
  }, [user, strictOwn]);

  const onPrev = () => {
    setViewMonth((m) => {
      if (m <= 0) { setViewYear((y) => y - 1); return 11; }
      return m - 1;
    });
  };
  const onNext = () => {
    setViewMonth((m) => {
      if (m >= 11) { setViewYear((y) => y + 1); return 0; }
      return m + 1;
    });
  };

  const numDays = daysInMonth(viewYear, viewMonth);
  const days = useMemo(() => {
    const arr = [];
    const todayIso = ymd(now);
    for (let d = 1; d <= numDays; d++) {
      const dt = new Date(viewYear, viewMonth, d);
      const iso = ymd(dt);
      arr.push({
        d, iso,
        weekend: isWeekend(dt),
        today: iso === todayIso
      });
    }
    return arr;
  }, [viewYear, viewMonth, numDays, now]);

  const onCellClick = (s, day) => {
    if (!canEditRow(s)) {
      toast.warn('Можно редактировать только свою строку');
      return;
    }
    const key = `${s.id}|${day.iso}`;
    const current = planMap.get(key) || (day.weekend ? 'вх' : '');
    modal.open(
      <StatusPickerModal
        staffName={s.name}
        dateIso={day.iso}
        currentCode={current}
        onPick={async (code) => {
          try {
            await upsertPlan(s.id, day.iso, code, plans);
            // Локально обновим планы
            setPlans((arr) => {
              const cleaned = arr.filter(
                (p) => !(p.staff_id === s.id && ymd(p.date) === day.iso)
              );
              if (code) {
                cleaned.push({
                  id: `tmp_${s.id}_${day.iso}_${Date.now()}`,
                  staff_id: s.id,
                  date: day.iso,
                  status_code: code,
                  updated_at: new Date().toISOString()
                });
              }
              return cleaned;
            });
            // Полное обновление чтобы получить настоящие id
            const fresh = await loadPlan();
            setPlans(fresh);
            const label = STATUS_BY_CODE[code]?.label || '—';
            toast.success(`Сохранено: ${day.iso} — ${label}`);
          } catch (e) {
            toast.error('Не удалось сохранить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  return (
    <div className="sched-card">
      <TopActionsBar
        kicker="Дружина"
        title="График офиса"
        subtitle="Порядок в строю — ясность в делах"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
          </>
        }
      />

      <div className="sched-header">
        <Btn variant="ghost" onClick={onPrev}>← Назад</Btn>
        <div className="sched-period">{MONTHS_RU[viewMonth]} {viewYear}</div>
        <Btn variant="ghost" onClick={onNext}>Вперёд →</Btn>
      </div>

      <div className="sched-legend">
        {STATUS.map((s) => (
          <span key={s.code} className="sched-legend-item">
            <span className="sched-legend-box" style={{ background: s.color }} />
            <span>{s.label}</span>
          </span>
        ))}
      </div>

      {loading ? (
        <div className="sched-wrap">
          <div className="sched-empty">⏳ Загружаем расписание…</div>
        </div>
      ) : staff.length === 0 ? (
        <div className="sched-wrap">
          <EmptyState
            icon="👥"
            title="Нет сотрудников в графике"
            hint="Добавьте активных сотрудников в системе — они появятся в графике офиса автоматически."
          />
        </div>
      ) : (
        <div className="sched-wrap">
          <div className="sched-grid">
            <div className="sched-head">
              <div className="sched-name head">Сотрудник</div>
              <div className="sched-days">
                {days.map((d) => (
                  <div
                    key={d.iso}
                    className={
                      'sched-day' +
                      (d.weekend ? ' weekend' : '') +
                      (d.today ? ' today' : '')
                    }
                  >
                    {d.d}
                  </div>
                ))}
              </div>
            </div>
            <div className="sched-body">
              {staff.map((s) => {
                const isMe = s.user_id === user?.id;
                const locked = !canEditRow(s);
                return (
                  <div key={s.id} className="sched-row">
                    <div className="sched-name">
                      <span>{s.name || '—'}</span>
                      {isMe && <span className="sched-mybadge">вы</span>}
                    </div>
                    <div className="sched-cells">
                      {days.map((day) => {
                        const key = `${s.id}|${day.iso}`;
                        let code = planMap.get(key) || '';
                        if (!code && day.weekend) code = 'вх';
                        const def = STATUS_BY_CODE[code];
                        const bg = code && def ? toRGBA(def.color, 0.5) : '';
                        const title = code
                          ? `${day.iso}: ${def?.label || code}`
                          : day.iso;
                        return (
                          <button
                            key={day.iso}
                            type="button"
                            className={
                              'sched-cell' +
                              (day.weekend ? ' weekend' : '') +
                              (day.today ? ' today' : '')
                            }
                            style={{ background: bg }}
                            title={title}
                            data-locked={locked ? '1' : '0'}
                            onClick={() => onCellClick(s, day)}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
