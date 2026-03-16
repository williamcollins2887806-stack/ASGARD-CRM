/**
 * ASGARD CRM — Mobile v3: Гантт (упрощённый)
 * Route: #/gantt
 * Не полноценный Гантт — список ближайших дедлайнов с таймлайном
 * API: GET /api/works
 */
var GanttPage = (function () {
  'use strict';

  var el = Utils.el;

  return {
    render: function () {
      var page = el('div', { style: { paddingBottom: '100px' } });
      page.appendChild(M.Header({ title: 'Дедлайны', subtitle: 'ТАЙМЛАЙН', back: true, backHref: '/pm-works' }));

      var body = el('div', { style: { padding: '12px 0' } });
      body.appendChild(M.Skeleton({ type: 'stats', count: 1 }));
      body.appendChild(M.Skeleton({ type: 'card', count: 4 }));
      page.appendChild(body);

      setTimeout(async function () {
        try {
          var t = DS.t;
          var data = await API.fetch('/works?limit=500');
          var works = (Array.isArray(data) ? data : (data.works || data.data || []))
            .filter(function (w) { return w.end_date || w.start_date; })
            .map(function (w) {
              return Object.assign({}, w, {
                _start: w.start_date ? new Date(w.start_date) : null,
                _end: w.end_date ? new Date(w.end_date) : null,
              });
            })
            .sort(function (a, b) {
              var da = a._end || a._start || new Date('2099-01-01');
              var db = b._end || b._start || new Date('2099-01-01');
              return da - db;
            });

          body.replaceChildren();

          if (!works.length) {
            body.appendChild(M.Empty({ text: 'Нет работ с датами', icon: '📅' }));
            return;
          }

          var now = new Date();

          // Month pills
          var months = [];
          for (var mi = -1; mi <= 6; mi++) {
            var md = new Date(now.getFullYear(), now.getMonth() + mi, 1);
            months.push({ date: md, label: md.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }) });
          }

          var activeMonth = 'all';

          var monthPills = M.FilterPills({
            items: [
              { label: 'Все', value: 'all', active: true },
            ].concat(months.map(function (m) { return { label: m.label, value: m.date.toISOString() }; })),
            onChange: function (val) { activeMonth = val; renderTimeline(); },
          });
          body.appendChild(monthPills);

          // Stats
          var overdue = works.filter(function (w) { return w._end && w._end < now && ['Работы сдали', 'Закрыто'].indexOf(w.work_status) === -1; });
          var upcoming = works.filter(function (w) { return w._end && w._end >= now && w._end <= new Date(now.getTime() + 14 * 86400000); });

          var statsWrap = el('div', { style: { margin: '12px 0 4px' } });
          statsWrap.appendChild(M.Stats({
            items: [
              { icon: '🚨', label: 'Просрочено', value: overdue.length, color: 'var(--red)' },
              { icon: '⏰', label: 'Ближ. 14 дней', value: upcoming.length, color: 'var(--orange)' },
              { icon: '📋', label: 'Всего с датами', value: works.length },
              { icon: '✅', label: 'Завершено', value: works.filter(function (w) { return ['Работы сдали', 'Закрыто'].indexOf(w.work_status) !== -1; }).length, color: 'var(--green)' },
            ],
          }));
          body.appendChild(statsWrap);

          var timelineContainer = el('div', { style: { padding: '12px 0' } });
          body.appendChild(timelineContainer);

          function renderTimeline() {
            timelineContainer.replaceChildren();
            var filtered = works;

            if (activeMonth !== 'all') {
              var mDate = new Date(activeMonth);
              var mEnd = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0);
              filtered = works.filter(function (w) {
                var s = w._start || w._end;
                var e = w._end || w._start;
                return s <= mEnd && e >= mDate;
              });
            }

            if (!filtered.length) {
              timelineContainer.appendChild(M.Empty({ text: 'Нет работ в этом периоде', type: 'search' }));
              return;
            }

            var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } });

            filtered.forEach(function (w, i) {
              var isOverdue = w._end && w._end < now && ['Работы сдали', 'Закрыто'].indexOf(w.work_status) === -1;
              var isDone = ['Работы сдали', 'Закрыто'].indexOf(w.work_status) !== -1;
              var progress = parseInt(w.progress || w.completion || 0);

              var card = el('div', {
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

              var topRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } });
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

              var dateRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } });
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

              if (progress > 0) {
                card.appendChild(M.ProgressBar({ value: progress, label: progress + '%' }));
              }

              if (w._end && !isDone) {
                var days = Math.ceil((w._end - now) / 86400000);
                var daysText = days < 0
                  ? Math.abs(days) + ' ' + Utils.plural(Math.abs(days), 'день', 'дня', 'дней') + ' назад'
                  : days + ' ' + Utils.plural(days, 'день', 'дня', 'дней') + ' осталось';
                card.appendChild(el('div', {
                  style: { ...DS.font('xs'), color: days < 0 ? t.red : days <= 7 ? t.orange : t.textTer, marginTop: '6px' },
                  textContent: daysText,
                }));
              }

              card.style.cursor = 'pointer';
              card.addEventListener('click', function () { Router.navigate('/pm-works/' + w.id); });

              list.appendChild(card);
            });

            timelineContainer.appendChild(list);
          }

          renderTimeline();

        } catch (e) {
          body.replaceChildren();
          body.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(location.hash.slice(1) || '/home', { replace: true }); } }));
          M.Toast({ message: 'Ошибка загрузки: ' + (e.message || e), type: 'error' });
        }
      }, 0);

      return page;
    },
  };
})();

Router.register('/gantt', GanttPage);
if (typeof window !== 'undefined') window.GanttPage = GanttPage;
