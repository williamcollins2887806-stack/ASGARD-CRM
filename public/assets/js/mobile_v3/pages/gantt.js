/**
 * ASGARD CRM — Mobile v3: Гантт (упрощённый)
 * Route: #/gantt
 * Не полноценный Гантт — список ближайших дедлайнов с таймлайном
 * API: GET /api/works
 */
const GanttPage = {
  async render() {
    const el = Utils.el;
    const t = DS.t;

    const page = el('div', { style: { paddingBottom: '100px' } });
    page.appendChild(M.Header({ title: 'Дедлайны', subtitle: 'ТАЙМЛАЙН', back: true, backHref: '/pm-works' }));

    // Loading
    const body = el('div', { style: { padding: '12px 0' } });
    body.appendChild(M.Skeleton({ type: 'card', count: 4 }));
    page.appendChild(body);

    try {
      const data = await API.fetch('/works?limit=500');
      const works = (Array.isArray(data) ? data : (data.works || data.data || []))
        .filter(w => w.end_date || w.start_date)
        .map(w => ({
          ...w,
          _start: w.start_date ? new Date(w.start_date) : null,
          _end: w.end_date ? new Date(w.end_date) : null,
        }))
        .sort((a, b) => {
          const da = a._end || a._start || new Date('2099-01-01');
          const db = b._end || b._start || new Date('2099-01-01');
          return da - db;
        });

      body.innerHTML = '';

      if (!works.length) {
        body.appendChild(M.Empty({ text: 'Нет работ с датами', icon: '📅' }));
        return page;
      }

      // Month tabs — horizontal scroll
      const now = new Date();
      const months = [];
      for (let i = -1; i <= 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push({ date: d, label: d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }) });
      }

      let activeMonth = 'all';

      const monthPills = M.FilterPills({
        items: [
          { label: 'Все', value: 'all', active: true },
          ...months.map(m => ({ label: m.label, value: m.date.toISOString() })),
        ],
        onChange: (val) => {
          activeMonth = val;
          renderTimeline();
        },
      });
      body.appendChild(monthPills);

      // Stats
      const overdue = works.filter(w => w._end && w._end < now && !['Работы сдали', 'Закрыто'].includes(w.work_status));
      const upcoming = works.filter(w => w._end && w._end >= now && w._end <= new Date(now.getTime() + 14 * 86400000));

      const statsWrap = el('div', { style: { margin: '12px 0 4px' } });
      statsWrap.appendChild(M.Stats({
        items: [
          { icon: '🚨', label: 'Просрочено', value: overdue.length, color: 'var(--red)' },
          { icon: '⏰', label: 'Ближ. 14 дней', value: upcoming.length, color: 'var(--orange)' },
          { icon: '📋', label: 'Всего с датами', value: works.length },
          { icon: '✅', label: 'Завершено', value: works.filter(w => ['Работы сдали', 'Закрыто'].includes(w.work_status)).length, color: 'var(--green)' },
        ],
      }));
      body.appendChild(statsWrap);

      // Timeline container
      const timelineContainer = el('div', { style: { padding: '12px 0' } });
      body.appendChild(timelineContainer);

      function renderTimeline() {
        timelineContainer.innerHTML = '';
        let filtered = works;

        if (activeMonth !== 'all') {
          const mDate = new Date(activeMonth);
          const mEnd = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0);
          filtered = works.filter(w => {
            const s = w._start || w._end;
            const e = w._end || w._start;
            return s <= mEnd && e >= mDate;
          });
        }

        if (!filtered.length) {
          timelineContainer.appendChild(M.Empty({ text: 'Нет работ в этом периоде', type: 'search' }));
          return;
        }

        const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });

        filtered.forEach((w, i) => {
          const isOverdue = w._end && w._end < now && !['Работы сдали', 'Закрыто'].includes(w.work_status);
          const isDone = ['Работы сдали', 'Закрыто'].includes(w.work_status);
          const progress = parseInt(w.progress || w.completion || 0);

          const card = el('div', {
            style: {
              background: t.surface,
              borderRadius: '18px',
              border: '1px solid ' + (isOverdue ? t.redBorder : t.border),
              borderLeft: '3px solid ' + (isOverdue ? t.red : isDone ? t.green : t.blue),
              padding: '14px 16px',
              boxShadow: t.shadow,
              ...DS.anim(i * 0.03),
            },
          });

          // Title row
          const topRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } });
          topRow.appendChild(el('div', {
            style: { ...DS.font('md'), color: t.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            textContent: w.customer_name || w.work_title || 'Работа #' + w.id,
          }));
          if (isOverdue) {
            topRow.appendChild(M.Badge({ text: 'Просрочено', color: 'danger' }));
          } else if (w.work_status) {
            topRow.appendChild(M.Badge({ text: w.work_status, color: isDone ? 'success' : 'info' }));
          }
          card.appendChild(topRow);

          // Date range bar
          const dateRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } });
          dateRow.appendChild(el('span', {
            style: { ...DS.font('sm'), color: t.textSec },
            textContent: w._start ? Utils.formatDate(w._start) : '?',
          }));
          dateRow.appendChild(el('div', {
            style: { flex: 1, height: '2px', background: isOverdue ? t.red : t.border, borderRadius: '1px' },
          }));
          dateRow.appendChild(el('span', {
            style: { ...DS.font('sm'), color: isOverdue ? t.red : t.textSec, fontWeight: isOverdue ? 700 : 400 },
            textContent: w._end ? Utils.formatDate(w._end) : '?',
          }));
          card.appendChild(dateRow);

          // Progress
          if (progress > 0) {
            card.appendChild(M.ProgressBar({ value: progress, label: progress + '%' }));
          }

          // Days remaining
          if (w._end && !isDone) {
            const days = Math.ceil((w._end - now) / 86400000);
            const daysText = days < 0
              ? Math.abs(days) + ' ' + Utils.plural(Math.abs(days), 'день', 'дня', 'дней') + ' назад'
              : days + ' ' + Utils.plural(days, 'день', 'дня', 'дней') + ' осталось';
            card.appendChild(el('div', {
              style: { ...DS.font('xs'), color: days < 0 ? t.red : days <= 7 ? t.orange : t.textTer, marginTop: '6px' },
              textContent: daysText,
            }));
          }

          card.style.cursor = 'pointer';
          card.addEventListener('click', () => Router.navigate('/pm-works/' + w.id));

          list.appendChild(card);
        });

        timelineContainer.appendChild(list);
      }

      renderTimeline();

    } catch (e) {
      body.innerHTML = '';
      body.appendChild(M.Empty({ text: 'Ошибка загрузки', type: 'error' }));
    }

    return page;
  },
};

Router.register('/gantt', GanttPage);
if (typeof window !== 'undefined') window.GanttPage = GanttPage;
