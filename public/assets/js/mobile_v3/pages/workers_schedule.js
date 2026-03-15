/**
 * ASGARD CRM — Mobile v3 / График рабочих
 * Окно 3, Сессия 9 — 14.03.2026
 * Календарная сетка: горизонтальный скролл по дням, карточки рабочих
 */
const WorkersSchedulePage = {
  async render() {
    const t = DS.t;
    const el = Utils.el;

    const STATUS_KINDS = [
      { code: 'free',    label: 'Свободен',          color: t.textTer,  bg: 'transparent' },
      { code: 'office',  label: 'Офис',              color: t.blue,     bg: t.blueBg },
      { code: 'trip',    label: 'Командировка',      color: 'var(--purple, #9333ea)',  bg: 'rgba(147,51,234,0.1)' },
      { code: 'work',    label: 'Работа (контракт)', color: t.green,    bg: t.greenBg },
      { code: 'note',    label: 'Заметка',           color: t.orange,   bg: t.orangeBg },
      { code: 'reserve', label: 'Бронь',             color: 'var(--purple, #9333ea)',  bg: 'rgba(147,51,234,0.1)' },
    ];

    const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

    function kindInfo(code) { return STATUS_KINDS.find(s => s.code === code) || STATUS_KINDS[0]; }
    function ymd(d) { return d.toISOString().slice(0, 10); }
    function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
    function weekdayIdx(y, m, d) {
      const dow = new Date(y, m, d).getDay();
      return dow === 0 ? 6 : dow - 1; // Mon=0 .. Sun=6
    }

    const now = new Date();
    let viewYear = now.getFullYear();
    let viewMonth = now.getMonth();
    let filterStatus = 'all';

    let employees = [];
    let scheduleData = [];

    const page = el('div', { style: { background: t.bg, paddingBottom: '100px' } });

    // Header
    page.appendChild(M.Header({ title: 'График рабочих', subtitle: 'РАСПИСАНИЕ', back: true, backHref: '/home' }));

    // Month navigation
    const monthNav = el('div', { style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 20px', background: t.surface, borderBottom: '1px solid ' + t.border,
    } });
    const prevBtn = el('button', { style: {
      background: 'none', border: 'none', color: t.text, fontSize: '20px',
      padding: '10px', cursor: 'pointer', minWidth: '44px', minHeight: '44px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    } }, '‹');
    const monthLabel = el('div', { style: { ...DS.font('md'), color: t.text, textAlign: 'center' } });
    const nextBtn = el('button', { style: {
      background: 'none', border: 'none', color: t.text, fontSize: '20px',
      padding: '10px', cursor: 'pointer', minWidth: '44px', minHeight: '44px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    } }, '›');

    prevBtn.addEventListener('click', () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } loadAndRender(); });
    nextBtn.addEventListener('click', () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } loadAndRender(); });

    monthNav.appendChild(prevBtn);
    monthNav.appendChild(monthLabel);
    monthNav.appendChild(nextBtn);
    page.appendChild(monthNav);

    // Status filter (horizontal pills)
    const filterWrap = el('div', { style: { padding: '8px 20px' } });
    function renderFilter() {
      filterWrap.replaceChildren();
      const pills = [{ label: 'Все', value: 'all' }, ...STATUS_KINDS.map(s => ({ label: s.label, value: s.code }))];
      filterWrap.appendChild(M.FilterPills({
        items: pills.map(p => ({ ...p, active: p.value === filterStatus })),
        onChange: (val) => { filterStatus = val; renderGrid(); },
      }));
    }
    page.appendChild(filterWrap);

    // Grid container
    const gridContainer = el('div', { style: { padding: '0 0 20px' } });
    page.appendChild(gridContainer);

    // Legend
    const legend = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px 20px' } });
    STATUS_KINDS.forEach(s => {
      if (s.code === 'free') return;
      const item = el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } });
      item.appendChild(el('div', { style: { width: '10px', height: '10px', borderRadius: '3px', background: s.color, flexShrink: 0 } }));
      item.appendChild(el('span', { style: { ...DS.font('xs'), color: t.textSec } }, s.label));
      legend.appendChild(item);
    });
    page.appendChild(legend);

    // ── Load data ──
    async function loadData() {
      try {
        const [empResp, schedResp] = await Promise.all([
          API.fetch('/staff/employees?limit=1000'),
          API.fetch('/staff/schedule?date_from=' + ymd(new Date(viewYear, viewMonth, 1)) + '&date_to=' + ymd(new Date(viewYear, viewMonth, daysInMonth(viewYear, viewMonth)))),
        ]);
        employees = Array.isArray(empResp) ? empResp : (empResp.items || empResp.data || []);
        // Filter to field workers only (no user_id = not office staff)
        employees = employees.filter(e => !e.user_id && e.deleted !== true && e.is_active !== false);
        employees.sort((a, b) => String(a.fio || '').localeCompare(String(b.fio || ''), 'ru'));
        scheduleData = schedResp.schedule || schedResp.items || (Array.isArray(schedResp) ? schedResp : []);
      } catch (e) {
        console.error('[Schedule] load error', e);
      }
    }

    // ── Build plan map: "empId|date" → kind ──
    function buildPlanMap() {
      const map = new Map();
      scheduleData.forEach(p => {
        if (p.employee_id && p.date) {
          const key = p.employee_id + '|' + (p.date || '').slice(0, 10);
          map.set(key, p);
        }
      });
      return map;
    }

    // ── Render grid ──
    function renderGrid() {
      gridContainer.replaceChildren();
      const numDays = daysInMonth(viewYear, viewMonth);
      const planMap = buildPlanMap();

      // Filter employees
      let filtered = employees;
      if (filterStatus !== 'all') {
        filtered = employees.filter(emp => {
          // Check if any day in month has this status
          for (let d = 1; d <= numDays; d++) {
            const key = emp.id + '|' + ymd(new Date(viewYear, viewMonth, d));
            const plan = planMap.get(key);
            if (plan && (plan.kind || 'free') === filterStatus) return true;
          }
          if (filterStatus === 'free') {
            // Employee is "free" if they have no plans at all
            let hasAny = false;
            for (let d = 1; d <= numDays; d++) {
              const key = emp.id + '|' + ymd(new Date(viewYear, viewMonth, d));
              if (planMap.has(key)) { hasAny = true; break; }
            }
            return !hasAny;
          }
          return false;
        });
      }

      if (!filtered.length) {
        gridContainer.appendChild(M.Empty({ text: 'Нет сотрудников', icon: '📅' }));
        return;
      }

      // Employee cards with inline calendar strip
      filtered.forEach((emp, empIdx) => {
        const card = el('div', { style: {
          background: t.surface, borderRadius: '16px', border: '1px solid ' + t.border,
          margin: '0 20px 8px', overflow: 'hidden',
          ...DS.anim(empIdx * 0.02),
        } });

        // Employee header row
        const header = el('div', { style: {
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '12px 14px', borderBottom: '1px solid ' + t.border,
          cursor: 'pointer',
        } });

        header.appendChild(M.Avatar({ name: emp.fio || emp.name || '?', size: 36 }));
        const info = el('div', { style: { flex: 1, minWidth: 0 } });
        info.appendChild(el('div', { style: { ...DS.font('sm'), fontWeight: 600, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, emp.fio || emp.name || '—'));
        info.appendChild(el('div', { style: { ...DS.font('xs'), color: t.textSec } }, emp.role_tag || emp.specialization || ''));
        header.appendChild(info);

        // Today status badge
        const todayKey = emp.id + '|' + ymd(now);
        const todayPlan = planMap.get(todayKey);
        const todayKind = todayPlan ? kindInfo(todayPlan.kind) : kindInfo('free');
        if (todayPlan && todayPlan.kind !== 'free') {
          header.appendChild(M.Badge({ text: todayKind.label, color: todayKind.code === 'work' ? 'success' : (todayKind.code === 'trip' ? 'info' : 'warning') }));
        }

        header.addEventListener('click', () => openEmpSchedule(emp, planMap));
        card.appendChild(header);

        // Calendar strip — horizontal scroll of day cells
        const strip = el('div', { style: {
          display: 'flex', overflowX: 'auto',
          padding: '6px 8px', gap: '2px',
          scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
        } });
        strip.className = 'asgard-no-scrollbar';

        for (let d = 1; d <= numDays; d++) {
          const dateStr = ymd(new Date(viewYear, viewMonth, d));
          const key = emp.id + '|' + dateStr;
          const plan = planMap.get(key);
          const kind = plan ? kindInfo(plan.kind) : kindInfo('free');
          const wdIdx = weekdayIdx(viewYear, viewMonth, d);
          const isWeekend = wdIdx >= 5;
          const isToday = dateStr === ymd(now);

          const cell = el('div', { style: {
            minWidth: '32px', height: '44px',
            borderRadius: '6px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            background: plan && plan.kind !== 'free' ? kind.bg : (isWeekend ? t.surfaceAlt : 'transparent'),
            border: isToday ? '2px solid ' + t.red : '1px solid transparent',
            cursor: 'pointer', position: 'relative',
          } });

          // Day number
          cell.appendChild(el('div', { style: {
            fontSize: '10px', fontWeight: isToday ? 700 : 500,
            color: plan && plan.kind !== 'free' ? kind.color : (isWeekend ? t.textTer : t.textSec),
            lineHeight: 1,
          } }, String(d)));

          // Weekday label
          cell.appendChild(el('div', { style: {
            fontSize: '7px', color: t.textTer, lineHeight: 1, marginTop: '1px',
          } }, WEEKDAYS_SHORT[wdIdx]));

          // Dot for non-free status
          if (plan && plan.kind !== 'free') {
            cell.appendChild(el('div', { style: {
              position: 'absolute', bottom: '2px',
              width: '4px', height: '4px', borderRadius: '50%',
              background: kind.color,
            } }));
          }

          cell.addEventListener('click', (e) => {
            e.stopPropagation();
            openDayDetail(emp, dateStr, plan);
          });
          strip.appendChild(cell);
        }

        // Auto-scroll to today
        card.appendChild(strip);
        setTimeout(() => {
          const todayD = now.getDate();
          if (viewYear === now.getFullYear() && viewMonth === now.getMonth()) {
            const scrollTo = Math.max(0, (todayD - 3)) * 30;
            strip.scrollLeft = scrollTo;
          }
        }, 50);

        gridContainer.appendChild(card);
      });
    }

    // ── Employee full schedule ──
    function openEmpSchedule(emp, planMap) {
      const content = el('div');
      const numDays = daysInMonth(viewYear, viewMonth);

      // Header with avatar
      const hdr = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' } });
      hdr.appendChild(M.Avatar({ name: emp.fio || '?', size: 48 }));
      const hInfo = el('div');
      hInfo.appendChild(el('div', { style: { ...DS.font('md'), color: t.text } }, emp.fio || '—'));
      hInfo.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec } }, emp.role_tag || emp.specialization || ''));
      if (emp.city) hInfo.appendChild(el('div', { style: { ...DS.font('xs'), color: t.textTer } }, emp.city));
      hdr.appendChild(hInfo);
      content.appendChild(hdr);

      // Status summary for the month
      const counts = {};
      for (let d = 1; d <= numDays; d++) {
        const key = emp.id + '|' + ymd(new Date(viewYear, viewMonth, d));
        const plan = planMap.get(key);
        const kind = plan ? (plan.kind || 'free') : 'free';
        counts[kind] = (counts[kind] || 0) + 1;
      }

      const statRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' } });
      STATUS_KINDS.forEach(s => {
        if (counts[s.code]) {
          statRow.appendChild(M.Badge({ text: s.label + ': ' + counts[s.code] + ' дн', color: s.code === 'free' ? 'neutral' : (s.code === 'work' ? 'success' : (s.code === 'trip' ? 'info' : 'warning')) }));
        }
      });
      content.appendChild(statRow);

      // Day-by-day list (only non-free days)
      const daysList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
      let hasEntries = false;
      for (let d = 1; d <= numDays; d++) {
        const dateStr = ymd(new Date(viewYear, viewMonth, d));
        const key = emp.id + '|' + dateStr;
        const plan = planMap.get(key);
        if (!plan || plan.kind === 'free') continue;
        hasEntries = true;
        const kind = kindInfo(plan.kind);

        const row = el('div', { style: {
          display: 'flex', gap: '10px', alignItems: 'center',
          padding: '8px 12px', borderRadius: '10px',
          background: kind.bg, border: '1px solid ' + t.border,
        } });
        row.appendChild(el('div', { style: { ...DS.font('sm'), fontWeight: 600, color: kind.color, minWidth: '24px' } }, String(d)));
        const dayInfo = el('div', { style: { flex: 1 } });
        dayInfo.appendChild(el('div', { style: { ...DS.font('sm'), color: t.text } }, kind.label));
        if (plan.note || plan.work_title) {
          dayInfo.appendChild(el('div', { style: { ...DS.font('xs'), color: t.textSec } }, plan.note || plan.work_title || ''));
        }
        row.appendChild(dayInfo);
        daysList.appendChild(row);
      }

      if (!hasEntries) {
        daysList.appendChild(el('div', { style: { ...DS.font('sm'), color: t.textSec, textAlign: 'center', padding: '20px 0' } }, 'Весь месяц свободен'));
      }
      content.appendChild(daysList);

      if (emp.phone) {
        const btns = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } });
        btns.appendChild(M.FullWidthBtn({ label: '📞 Позвонить', variant: 'secondary', onClick: () => { window.location.href = 'tel:' + emp.phone; } }));
        content.appendChild(btns);
      }

      M.BottomSheet({ title: emp.fio || 'Сотрудник', content, fullscreen: true });
    }

    // ── Day detail for single cell ──
    function openDayDetail(emp, dateStr, plan) {
      const kind = plan ? kindInfo(plan.kind) : kindInfo('free');
      const d = new Date(dateStr);
      const dayName = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

      const content = el('div');
      const fields = [
        { label: 'Сотрудник', value: emp.fio || '—' },
        { label: 'Дата', value: dayName },
        { label: 'Статус', value: kind.label, type: 'badge', badgeColor: kind.code === 'work' ? 'success' : (kind.code === 'free' ? 'neutral' : 'info') },
      ];
      if (plan && plan.note) fields.push({ label: 'Заметка', value: plan.note });
      if (plan && plan.work_title) fields.push({ label: 'Работа', value: plan.work_title });

      content.appendChild(M.DetailFields({ fields }));

      // Quick status set buttons
      const label = el('div', { style: { ...DS.font('sm'), color: t.textSec, marginTop: '16px', marginBottom: '8px' } });
      label.textContent = 'Установить статус';
      content.appendChild(label);

      const btnsRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
      STATUS_KINDS.forEach(s => {
        const statusStyle = DS.status(s.code === 'work' ? 'success' : (s.code === 'trip' || s.code === 'reserve' ? 'info' : (s.code === 'free' ? 'neutral' : 'warning')));
        const btn = el('button', { style: {
          flex: '1 0 auto', minWidth: '80px',
          padding: '10px 8px', borderRadius: '10px',
          border: '1px solid ' + statusStyle.border, background: statusStyle.bg,
          color: statusStyle.color, fontSize: '11px', fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
        } }, s.label);
        btn.addEventListener('click', async () => {
          try {
            if (plan && plan.id) {
              await API.fetch('/staff/schedule/' + plan.id, { method: 'PUT', body: { kind: s.code } });
            } else {
              await API.fetch('/staff/schedule', { method: 'POST', body: { employee_id: emp.id, date: dateStr, kind: s.code } });
            }
            M.Toast({ message: kind.label + ' → ' + s.label, type: 'success' });
            await loadData();
            renderGrid();
          } catch (e) { M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' }); }
        });
        btnsRow.appendChild(btn);
      });
      content.appendChild(btnsRow);

      M.BottomSheet({ title: dayName, content });
    }

    // ── Load and render ──
    async function loadAndRender() {
      monthLabel.textContent = MONTHS_RU[viewMonth] + ' ' + viewYear;
      gridContainer.replaceChildren();
      gridContainer.appendChild(M.Skeleton({ type: 'card', count: 5 }));
      await loadData();
      renderFilter();
      renderGrid();
    }

    await loadAndRender();

    return page;
  },
};

Router.register('/workers-schedule', WorkersSchedulePage);
if (typeof window !== 'undefined') window.WorkersSchedulePage = WorkersSchedulePage;
