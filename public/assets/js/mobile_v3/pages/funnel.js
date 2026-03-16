/**
 * ASGARD CRM — Mobile v3: Воронка тендеров
 * Route: #/funnel
 * Данные: AsgardDB.all('tenders')
 */
window.MobileFunnel = (function () {
  'use strict';

  var el = Utils.el;

  var STAGES = [
    { id: 'new',         label: 'Новый',       color: 'var(--text-sec)', statuses: ['Черновик', 'Новый', 'Получен'] },
    { id: 'calc',        label: 'Просчёт',     color: 'var(--blue)',     statuses: ['В просчёте', 'На просчёте'] },
    { id: 'negotiation', label: 'Согласование', color: 'var(--orange)',   statuses: ['КП отправлено', 'ТКП отправлено', 'Согласование ТКП', 'Переговоры', 'На согласовании', 'ТКП согласовано'] },
    { id: 'prep',        label: 'Подготовка',   color: 'var(--gold)',     statuses: ['Выиграли', 'Клиент согласился', 'Контракт'] },
    { id: 'work',        label: 'Работа',       color: 'var(--green)',    statuses: ['В работе', 'Выполняется', 'Мобилизация'] },
  ];

  function getStageId(status) {
    if (!status) return 'new';
    var s = status.toLowerCase();
    for (var i = 0; i < STAGES.length; i++) {
      for (var j = 0; j < STAGES[i].statuses.length; j++) {
        if (s.includes(STAGES[i].statuses[j].toLowerCase()) || STAGES[i].statuses[j].toLowerCase().includes(s)) {
          return STAGES[i].id;
        }
      }
    }
    return 'new';
  }

  function money(v) { return v ? Number(v).toLocaleString('ru-RU') + ' ₽' : '—'; }
  function fmt(v) { return v ? new Date(v).toLocaleDateString('ru-RU') : ''; }

  async function loadTenders() {
    return API.fetchCached('tenders', '/data/tenders');
  }

  /* ── Модалка перемещения ── */
  function openMoveSheet(tender, currentStageId, onMoved) {
    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    content.appendChild(el('div', { style: { ...DS.font('sm'), color: 'var(--text-sec)', marginBottom: '4px' }, textContent: 'Переместить «' + (tender.name || tender.title || '') + '»:' }));

    STAGES.forEach(function (stage) {
      var isActive = stage.id === currentStageId;
      var btn = el('button', {
        style: {
          display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
          padding: '14px 16px', borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit',
          border: isActive ? '2px solid var(--blue)' : '1px solid var(--border)',
          background: isActive ? 'var(--blue-bg)' : 'var(--surface)',
          color: isActive ? 'var(--blue)' : 'var(--text)', fontSize: '14px', fontWeight: 600,
          textAlign: 'left',
        },
        onClick: async function () {
          if (isActive) return;
          try {
            var newStatus = stage.statuses[0];
            await API.fetch('/data/tenders/' + tender.id, { method: 'PUT', body: { status: newStatus } });
            M.Toast({ message: 'Перемещён → ' + stage.label, type: 'success' });
            document.querySelectorAll('.asgard-sheet-overlay').forEach(function (o) { o.remove(); });
            Utils.unlockScroll();
            if (onMoved) onMoved();
          } catch (e) {
            M.Toast({ message: 'Ошибка: ' + e.message, type: 'error' });
          }
        },
      });
      var dot = el('div', { style: { width: '10px', height: '10px', borderRadius: '50%', background: stage.color, flexShrink: 0 } });
      btn.appendChild(dot);
      btn.appendChild(el('span', {}, stage.label));
      if (isActive) btn.appendChild(el('span', { style: { marginLeft: 'auto', fontSize: '12px', color: 'var(--blue)' } }, '← сейчас'));
      content.appendChild(btn);
    });

    M.BottomSheet({ title: 'Переместить тендер', content: content });
  }

  /* ── Детальная модалка тендера ── */
  function openTenderDetail(tender) {
    var fields = [];
    if (tender.customer_name || tender.client) fields.push({ label: 'Заказчик', value: tender.customer_name || tender.client });
    if (tender.amount || tender.price) fields.push({ label: 'Сумма', value: money(tender.amount || tender.price) });
    if (tender.manager_name || tender.rp) fields.push({ label: 'РП', value: tender.manager_name || tender.rp });
    if (tender.deadline || tender.submission_deadline) fields.push({ label: 'Дедлайн', value: fmt(tender.deadline || tender.submission_deadline) });
    fields.push({ label: 'Статус', value: tender.status || '—', type: 'badge', badgeColor: 'info' });

    var content = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
    content.appendChild(M.DetailFields({ fields: fields }));

    if (tender.description) {
      var desc = el('div', { style: { padding: '12px', background: 'var(--surface-alt)', borderRadius: '12px' } });
      desc.appendChild(el('div', { style: { ...DS.font('xs'), color: 'var(--text-ter)', marginBottom: '4px' }, textContent: 'Описание' }));
      desc.appendChild(el('div', { style: { ...DS.font('sm'), color: 'var(--text-sec)', lineHeight: '1.5' }, textContent: tender.description }));
      content.appendChild(desc);
    }

    M.BottomSheet({ title: tender.name || tender.title || 'Тендер', content: content, fullscreen: true });
  }

  /* ── Рендер ── */
  function render() {
    var t = DS.t;
    var page = el('div', { style: { background: t.bg, minHeight: '100vh' } });

    page.appendChild(M.Header({
      title: 'Воронка',
      subtitle: 'Тендеры',
      back: true,
      backHref: '/home',
      actions: [{
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v16h16"/><path d="M4 20l4-4 4 4 4-8 4 4"/></svg>',
        onClick: function () { Router.navigate('/tenders'); },
      }],
    }));

    // Stats row
    var statsWrap = el('div', { style: { padding: '12px 0 4px' } });
    page.appendChild(statsWrap);

    // Horizontal scroll container
    var scroll = el('div', {
      className: 'asgard-no-scrollbar',
      style: {
        display: 'flex', gap: '12px', overflowX: 'auto', padding: '8px 20px 120px',
        scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
      },
    });
    page.appendChild(scroll);

    // Show skeleton immediately — data loads in background
    scroll.appendChild(M.Skeleton({ type: 'card', count: 5 }));

    var tenders = [];
    var groups = {};

    // Render columns
    function renderColumns() {
      scroll.replaceChildren();
      STAGES.forEach(function (stage, si) {
        var items = groups[stage.id] || [];
        var colSum = 0;
        items.forEach(function (it) { colSum += Number(it.amount || it.price || 0); });

        var col = el('div', {
          style: {
            minWidth: '280px', maxWidth: '300px', flexShrink: 0, scrollSnapAlign: 'start',
            display: 'flex', flexDirection: 'column', gap: '8px',
            ...DS.anim(si * 0.05),
          },
        });

        // Column header
        var header = el('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', background: t.surface, borderRadius: '14px',
            border: '1px solid ' + t.border, marginBottom: '4px',
          },
        });
        var headerLeft = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
        headerLeft.appendChild(el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: stage.color } }));
        headerLeft.appendChild(el('span', { style: { ...DS.font('sm'), color: t.text, fontWeight: 700 }, textContent: stage.label }));
        header.appendChild(headerLeft);
        var headerRight = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } });
        headerRight.appendChild(el('span', {
          style: {
            minWidth: '22px', height: '22px', borderRadius: '11px', background: stage.color + '20',
            color: stage.color, fontSize: '12px', fontWeight: 700, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: '0 6px',
          },
          textContent: '' + items.length,
        }));
        header.appendChild(headerRight);
        col.appendChild(header);

        // Sum
        if (colSum > 0) {
          col.appendChild(el('div', {
            style: { ...DS.font('xs'), color: t.textTer, padding: '0 4px', textAlign: 'right' },
            textContent: '∑ ' + money(colSum),
          }));
        }

        // Cards
        if (items.length === 0) {
          var empty = el('div', {
            style: {
              padding: '24px 12px', textAlign: 'center', color: t.textTer, fontSize: '13px',
              border: '1px dashed ' + t.border, borderRadius: '12px',
            },
            textContent: 'Пусто',
          });
          col.appendChild(empty);
        } else {
          items.forEach(function (tender, idx) {
            var card = M.Card({
              title: tender.customer_name || tender.client || tender.name || 'Тендер',
              subtitle: tender.name || tender.title || '',
              fields: [
                { label: 'Сумма', value: money(tender.amount || tender.price) },
              ],
              time: fmt(tender.deadline || tender.submission_deadline),
              onClick: function () { openTenderDetail(tender); },
              animDelay: idx * 0.03,
            });

            // Long press to move
            var pressTimer;
            card.addEventListener('touchstart', function () {
              pressTimer = setTimeout(function () {
                try { navigator.vibrate(30); } catch (_) {}
                openMoveSheet(tender, stage.id, async function () {
                  var reloaded = await loadTenders();
                  tenders.length = 0;
                  tenders.push.apply(tenders, reloaded);
                  groups = {};
                  STAGES.forEach(function (s) { groups[s.id] = []; });
                  tenders.forEach(function (t) {
                    var sid = getStageId(t.status);
                    if (groups[sid]) groups[sid].push(t);
                    else groups.new.push(t);
                  });
                  renderColumns();
                });
              }, 500);
            }, { passive: true });
            card.addEventListener('touchend', function () { clearTimeout(pressTimer); }, { passive: true });
            card.addEventListener('touchmove', function () { clearTimeout(pressTimer); }, { passive: true });

            col.appendChild(card);
          });
        }

        scroll.appendChild(col);
      });
    }

    // Load data in background
    loadTenders().then(function (loaded) {
      tenders = loaded;
      scroll.replaceChildren();

      if (!tenders.length) {
        scroll.style.display = 'flex';
        scroll.style.justifyContent = 'center';
        scroll.appendChild(M.Empty({ text: 'Нет тендеров в воронке', icon: '📊' }));
        return;
      }

      // Group by stage
      groups = {};
      STAGES.forEach(function (s) { groups[s.id] = []; });
      tenders.forEach(function (tender) {
        var sid = getStageId(tender.status);
        if (groups[sid]) groups[sid].push(tender);
        else groups.new.push(tender);
      });

      // Stats
      var totalSum = 0;
      tenders.forEach(function (item) { totalSum += Number(item.amount || item.price || 0); });
      statsWrap.appendChild(M.Stats({
        items: [
          { icon: '📋', value: tenders.length, label: 'Всего', color: t.blue },
          { icon: '💰', value: Math.round(totalSum / 1000000) || 0, label: 'Млн ₽', color: t.green },
          { icon: '🏆', value: (groups.prep || []).length + (groups.work || []).length, label: 'Выиграно', color: t.gold },
          { icon: '⚡', value: (groups.new || []).length, label: 'Новых', color: t.orange },
        ],
      }));

      renderColumns();
    }).catch(function () {
      scroll.replaceChildren();
      scroll.style.display = 'flex';
      scroll.style.justifyContent = 'center';
      scroll.appendChild(M.Empty({ text: 'Ошибка загрузки', icon: '⚠️' }));
      M.Toast({ message: 'Ошибка загрузки тендеров', type: 'error' });
    });

    return page;
  }

  return { render: render };
})();

if (typeof Router !== 'undefined') {
  Router.register('/funnel', window.MobileFunnel);
}
