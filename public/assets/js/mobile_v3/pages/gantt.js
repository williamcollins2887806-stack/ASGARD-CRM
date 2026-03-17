/**
 * ASGARD CRM — Mobile v3: Диаграмма Ганта
 * Route: #/gantt
 * Landscape-only: в портрете — оверлей "Переверните телефон"
 * API: GET /api/works
 */
var GanttPage = (function () {
  'use strict';

  var el = Utils.el;

  var STATUS_COLORS = {
    'Работы сдали': 'var(--green)',
    'Закрыто': 'var(--green)',
    'Завершена': 'var(--green)',
    'В работе': 'var(--blue)',
    'Работы начались': 'var(--blue)',
    'Приступили': 'var(--blue)',
    'Новая': 'var(--orange)',
    'Проект': 'var(--orange)',
  };

  function statusColor(status) {
    return STATUS_COLORS[status] || 'var(--text-ter)';
  }

  function isLandscape() {
    if (screen.orientation && screen.orientation.type) {
      return screen.orientation.type.indexOf('landscape') !== -1;
    }
    return window.innerWidth > window.innerHeight;
  }

  function onOrientationChange(callback) {
    if (screen.orientation) {
      screen.orientation.addEventListener('change', callback);
    }
    window.addEventListener('resize', callback);
    return function () {
      if (screen.orientation) screen.orientation.removeEventListener('change', callback);
      window.removeEventListener('resize', callback);
    };
  }

  function renderOrientationOverlay() {
    var t = DS.t;
    var overlay = el('div', { style: {
      position: 'absolute', inset: '0', background: t.bg,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '20px', zIndex: '50',
    } });

    var icon = el('div', { style: {
      fontSize: '64px',
      animation: 'asgard-rotate-phone 2s ease-in-out infinite',
    } }, '📱');
    overlay.appendChild(icon);

    overlay.appendChild(el('div', { style: Object.assign({}, DS.font('lg'), {
      color: t.text, fontWeight: '700', textAlign: 'center',
    }) }, 'Переверните телефон'));

    overlay.appendChild(el('div', { style: Object.assign({}, DS.font('sm'), {
      color: t.textSec, textAlign: 'center', maxWidth: '260px', lineHeight: '1.5',
    }) }, 'Диаграмма Ганта доступна только в горизонтальном режиме'));

    var backBtn = el('button', { style: {
      marginTop: '20px', padding: '12px 32px', borderRadius: '14px',
      border: '1px solid ' + t.border, background: 'transparent',
      color: t.textSec, fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit',
    } }, '← Назад');
    backBtn.addEventListener('click', function () { Router.navigate('/home'); }, { passive: true });
    overlay.appendChild(backBtn);

    return overlay;
  }

  function openGanttDetail(work) {
    var t = DS.t;
    var content = el('div');

    var fields = [
      { label: 'Статус', value: work.work_status || '—', type: 'badge', badgeColor: statusColor(work.work_status).indexOf('green') !== -1 ? 'success' : statusColor(work.work_status).indexOf('blue') !== -1 ? 'info' : 'warning' },
      { label: 'Объект', value: work.object_name || work.customer_name || '—' },
      { label: 'План начало', value: work.start_plan ? new Date(work.start_plan).toLocaleDateString('ru-RU') : '—' },
      { label: 'План конец', value: (work.end_plan || work.end_date_plan) ? new Date(work.end_plan || work.end_date_plan).toLocaleDateString('ru-RU') : '—' },
      { label: 'Факт начало', value: work.start_fact ? new Date(work.start_fact).toLocaleDateString('ru-RU') : '—' },
      { label: 'Факт конец', value: work.end_fact ? new Date(work.end_fact).toLocaleDateString('ru-RU') : '—' },
      { label: 'Ответственный', value: work.pm_name || work.manager_name || '—' },
    ];

    if (work.contract_sum) {
      fields.push({ label: 'Бюджет', value: Utils.formatMoney(parseFloat(work.contract_sum)) + ' ₽' });
    }

    content.appendChild(M.DetailFields({ fields: fields }));
    M.BottomSheet({ title: work.work_title || work.customer_name || 'Работа', content: content });
  }

  function renderGanttChart(works) {
    var t = DS.t;
    var wrap = el('div', { style: {
      display: 'flex', flexDirection: 'column', height: 'calc(var(--vh, 1vh) * 100)',
      background: t.bg, overflow: 'hidden',
    } });

    // Header
    var header = el('div', { style: {
      display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 12px',
      borderBottom: '1px solid ' + t.border, flexShrink: '0', background: t.surface,
    } });
    var backBtn = el('button', { style: {
      width: '32px', height: '32px', borderRadius: '8px', border: 'none',
      background: t.surfaceAlt, color: t.text, fontSize: '16px', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    } }, '←');
    backBtn.addEventListener('click', function () { Router.navigate('/home'); }, { passive: true });
    header.appendChild(backBtn);
    header.appendChild(el('div', { style: Object.assign({}, DS.font('md'), { color: t.text, fontWeight: '700' }) }, 'Диаграмма Ганта'));
    header.appendChild(el('div', { style: Object.assign({}, DS.font('xs'), { color: t.textSec, marginLeft: 'auto' }) }, works.length + ' работ'));
    wrap.appendChild(header);

    if (!works.length) {
      var emptyWrap = el('div', { style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
      emptyWrap.appendChild(M.Empty({ text: 'Нет работ с датами', icon: '📅' }));
      wrap.appendChild(emptyWrap);
      return wrap;
    }

    // Вычислить диапазон дат
    var now = new Date();
    var minDate = new Date(now);
    var maxDate = new Date(now);
    works.forEach(function (w) {
      var s = w._start || w._end;
      var e = w._end || w._start;
      if (s && s < minDate) minDate = new Date(s);
      if (e && e > maxDate) maxDate = new Date(e);
    });

    // Расширить на месяц в каждую сторону
    minDate.setMonth(minDate.getMonth() - 1);
    minDate.setDate(1);
    maxDate.setMonth(maxDate.getMonth() + 2);
    maxDate.setDate(0);

    var totalDays = Math.ceil((maxDate - minDate) / 86400000);
    var dayWidth = 3; // px на день
    var nameColWidth = 150;
    var rowHeight = 36;
    var timelineWidth = totalDays * dayWidth;

    function dateToPx(date) {
      if (!date) return 0;
      return Math.round(((date - minDate) / 86400000) * dayWidth);
    }

    // Контейнер для синхронизированного скролла
    var scrollContainer = el('div', { style: { display: 'flex', flex: '1', overflow: 'hidden' } });

    // Левая колонка (имена — фиксированная)
    var namesCol = el('div', { style: {
      width: nameColWidth + 'px', minWidth: nameColWidth + 'px', flexShrink: '0',
      overflowY: 'auto', borderRight: '1px solid ' + t.border,
      background: t.surface,
    } });
    namesCol.className = 'asgard-no-scrollbar';

    // Правая часть (таймлайн — горизонтальный скролл)
    var rightPart = el('div', { style: {
      flex: '1', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    } });

    // Заголовок таймлайна (месяцы)
    var timeHeader = el('div', { style: {
      height: '28px', minHeight: '28px', overflowX: 'hidden',
      borderBottom: '1px solid ' + t.border, position: 'relative',
      background: t.surface, flexShrink: '0',
    } });
    var timeHeaderInner = el('div', { style: { position: 'relative', width: timelineWidth + 'px', height: '100%' } });

    // Рисуем месяцы
    var d = new Date(minDate);
    while (d <= maxDate) {
      var monthStart = dateToPx(d);
      var nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      var monthEnd = dateToPx(nextMonth);
      var label = d.toLocaleDateString('ru-RU', { month: 'short' });
      var monthEl = el('div', { style: {
        position: 'absolute', left: monthStart + 'px', width: (monthEnd - monthStart) + 'px',
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRight: '1px solid ' + t.border, color: t.textSec, fontSize: '11px', fontWeight: '500',
      } }, label);
      timeHeaderInner.appendChild(monthEl);
      d = nextMonth;
    }
    timeHeader.appendChild(timeHeaderInner);
    rightPart.appendChild(timeHeader);

    // Область строк (скроллируемая)
    var rowsArea = el('div', { style: { flex: '1', overflowX: 'auto', overflowY: 'auto' } });
    var rowsInner = el('div', { style: { position: 'relative', width: timelineWidth + 'px', minHeight: works.length * rowHeight + 'px' } });

    // Заголовок имён
    var namesHeader = el('div', { style: {
      height: '28px', minHeight: '28px', display: 'flex', alignItems: 'center',
      padding: '0 8px', borderBottom: '1px solid ' + t.border,
      color: t.textSec, fontSize: '11px', fontWeight: '500',
    } }, 'Работа');
    namesCol.appendChild(namesHeader);

    var namesBody = el('div', { style: { overflowY: 'hidden' } });
    namesBody.className = 'asgard-no-scrollbar';

    // Текущая дата — вертикальная линия
    var todayPx = dateToPx(now);
    var todayLine = el('div', { style: {
      position: 'absolute', left: todayPx + 'px', top: '0', bottom: '0',
      width: '2px', background: 'var(--red)', zIndex: '5', opacity: '0.7',
    } });
    rowsInner.appendChild(todayLine);

    // Рисуем строки
    works.forEach(function (w, i) {
      var isDone = ['Работы сдали', 'Закрыто', 'Завершена'].indexOf(w.work_status) !== -1;
      var isOverdue = w._end && w._end < now && !isDone;
      var name = (w.work_title || w.customer_name || 'Работа #' + w.id);
      if (name.length > 22) name = name.substring(0, 20) + '…';

      // Имя в левой колонке
      var nameRow = el('div', { style: {
        height: rowHeight + 'px', display: 'flex', alignItems: 'center',
        padding: '0 8px', borderBottom: '1px solid ' + t.border,
        cursor: 'pointer', fontSize: '12px', color: isOverdue ? t.red : t.text,
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      } }, name);
      nameRow.addEventListener('click', function () { openGanttDetail(w); }, { passive: true });
      namesBody.appendChild(nameRow);

      // Полоска в таймлайне
      var rowBg = el('div', { style: {
        position: 'absolute', left: '0', right: '0',
        top: i * rowHeight + 'px', height: rowHeight + 'px',
        borderBottom: '1px solid ' + t.border,
        background: i % 2 === 0 ? 'transparent' : 'rgba(128,128,128,0.03)',
      } });
      rowsInner.appendChild(rowBg);

      var start = w._start || w._end;
      var end = w._end || w._start;
      if (start && end) {
        var barLeft = dateToPx(start);
        var barRight = dateToPx(end);
        var barWidth = Math.max(barRight - barLeft, 6);
        var barColor = isOverdue ? 'var(--red)' : isDone ? 'var(--green)' : statusColor(w.work_status);

        var bar = el('div', { style: {
          position: 'absolute', left: barLeft + 'px',
          top: (i * rowHeight + 8) + 'px', height: (rowHeight - 16) + 'px',
          width: barWidth + 'px', borderRadius: '4px',
          background: barColor, opacity: '0.85', cursor: 'pointer',
          transition: 'opacity 0.15s ease',
        } });
        bar.addEventListener('click', function () { openGanttDetail(w); }, { passive: true });
        bar.addEventListener('touchstart', function () { bar.style.opacity = '1'; }, { passive: true });
        bar.addEventListener('touchend', function () { bar.style.opacity = '0.85'; }, { passive: true });
        rowsInner.appendChild(bar);
      }
    });

    namesCol.appendChild(namesBody);
    rowsArea.appendChild(rowsInner);
    rightPart.appendChild(rowsArea);

    scrollContainer.appendChild(namesCol);
    scrollContainer.appendChild(rightPart);
    wrap.appendChild(scrollContainer);

    // Синхронизация вертикального скролла
    rowsArea.addEventListener('scroll', function () {
      namesBody.style.transform = 'translateY(-' + rowsArea.scrollTop + 'px)';
      timeHeaderInner.style.transform = 'translateX(-' + rowsArea.scrollLeft + 'px)';
    }, { passive: true });

    // Начальная позиция — прокрутить к сегодня
    setTimeout(function () {
      var scrollTo = Math.max(todayPx - rowsArea.clientWidth / 2, 0);
      rowsArea.scrollLeft = scrollTo;
    }, 100);

    return wrap;
  }

  return {
    render: function () {
      var t = DS.t;
      var page = el('div', { style: { position: 'relative', height: 'calc(var(--vh, 1vh) * 100)', overflow: 'hidden' } });

      var overlay = renderOrientationOverlay();
      var chartWrap = el('div', { style: { height: '100%' } });

      page.appendChild(overlay);
      page.appendChild(chartWrap);

      // Загрузка данных
      chartWrap.appendChild(M.Skeleton({ type: 'card', count: 5 }));

      API.fetchCached('works', '/works?limit=500').then(function (data) {
        var works = (Array.isArray(data) ? data : API.extractRows(data))
          .filter(function (w) { return w.start_plan || w.start_fact || w.start_date || w.end_plan || w.end_date_plan || w.end_fact; })
          .map(function (w) {
            return Object.assign({}, w, {
              _start: w.start_fact ? new Date(w.start_fact) : (w.start_plan ? new Date(w.start_plan) : (w.start_date ? new Date(w.start_date) : null)),
              _end: w.end_fact ? new Date(w.end_fact) : (w.end_plan ? new Date(w.end_plan) : (w.end_date_plan ? new Date(w.end_date_plan) : null)),
            });
          })
          .sort(function (a, b) {
            var da = a._start || a._end || new Date('2099-01-01');
            var db = b._start || b._end || new Date('2099-01-01');
            return da - db;
          });

        chartWrap.replaceChildren();
        chartWrap.appendChild(renderGanttChart(works));
      }).catch(function (e) {
        chartWrap.replaceChildren();
        chartWrap.appendChild(M.ErrorBanner({ onRetry: function () { Router.navigate('/gantt', { replace: true }); } }));
      });

      function updateView() {
        if (isLandscape()) {
          overlay.style.display = 'none';
          chartWrap.style.display = 'flex';
        } else {
          // Закрыть модалки перед показом оверлея
          document.querySelectorAll('.asgard-sheet-overlay, .asgard-sheet').forEach(function (o) { o.remove(); });
          if (typeof Utils !== 'undefined' && typeof Utils.unlockScroll === 'function') Utils.unlockScroll();
          overlay.style.display = 'flex';
          chartWrap.style.display = 'none';
        }
      }

      updateView();
      var _ganttTimer;
      function debouncedUpdateView() {
        clearTimeout(_ganttTimer);
        _ganttTimer = setTimeout(updateView, 200);
      }
      var cleanupOrientation = onOrientationChange(debouncedUpdateView);

      // Lifecycle cleanup
      if (typeof Router !== 'undefined' && Router.onLeave) {
        Router.onLeave(cleanupOrientation);
      }

      return page;
    },
  };
})();

Router.register('/gantt', GanttPage);
if (typeof window !== 'undefined') window.GanttPage = GanttPage;
