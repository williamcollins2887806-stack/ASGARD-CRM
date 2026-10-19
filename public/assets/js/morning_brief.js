/**
 * Утренний брифинг — ежедневное окно для ТО/РП (ванильный десктоп).
 *
 * D-249 (19.10.2026): переписан с «<ul> со списком» на премиальный экран —
 * герой-баннер, полоса KPI, секции-карточки с цветным акцентом, кликабельные
 * строки тендеров и живой срок («сегодня», «+3 дн.», «−4 дн.»).
 *
 * Что чинилось по логике (серверная часть — src/routes/tenders-registry.js):
 *  - дата бралась через toISOString() → уезжала на день назад;
 *  - в «пора подаваться» попадали карточки с вердиктом РП «не подаём» и
 *    просроченные на два месяца;
 *  - просроченные без отчёта в брифинг не попадали вовсе;
 *  - кнопка «напомнить РП» слала пустой body → сервер отвечал 400.
 */
window.AsgardMorningBrief = (function () {
  const esc = (AsgardUI && AsgardUI.esc) || ((s) => String(s ?? ''));
  const toast = (AsgardUI && AsgardUI.toast) || (() => {});
  const showModal = (AsgardUI && AsgardUI.showModal) || null;
  const hideModal = (AsgardUI && AsgardUI.hideModal) || (() => {});

  /** Сумма для чипа на карточке «готово к подаче». */
  const money = (v) => {
    if (v == null || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (window.AsgardMoney && AsgardMoney.formatMoneyShort) return AsgardMoney.formatMoneyShort(n);
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' млн ₽';
    if (n >= 1e3) return Math.round(n / 1e3) + ' тыс ₽';
    return Math.round(n).toLocaleString('ru-RU') + ' ₽';
  };

  function storageKey(userId, date) {
    return 'morning-brief:' + date + ':' + userId;
  }

  /** Срок словами: «сегодня», «завтра», «+3 дн.», «−4 дн.», «нет срока». */
  function deadlineChip(daysLeft, isoDate) {
    const n = daysLeft == null || daysLeft === '' ? null : Number(daysLeft);
    if (n == null || !Number.isFinite(n)) {
      return { cls: '', text: isoDate ? fmtDl(isoDate) : 'без срока' };
    }
    if (n < 0) return { cls: 'is-over', text: '−' + Math.abs(n) + ' дн.' };
    if (n === 0) return { cls: 'is-today', text: 'сегодня' };
    if (n === 1) return { cls: 'is-today', text: 'завтра' };
    if (n <= 5) return { cls: 'is-soon', text: '+' + n + ' дн.' };
    return { cls: '', text: '+' + n + ' дн.' };
  }

  function fmtDl(v) {
    if (!v) return '—';
    const s = String(v).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? (m[3] + '.' + m[2] + '.' + m[1].slice(2)) : s;
  }

  /** «19 октября 2026, понедельник». */
  function prettifyDate(iso, weekday) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso || '';
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const month = months[Number(m[2]) - 1] || '';
    const base = Number(m[3]) + ' ' + month + ' ' + m[1];
    return weekday ? base + ', ' + weekday : base;
  }

  /** Склонение: 1 тендер, 2 тендера, 5 тендеров. */
  function plural(n, one, few, many) {
    const a = Math.abs(Number(n) || 0) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }

  function tenderRow(t) {
    const dl = deadlineChip(t.days_left, t.docs_deadline);
    const price = money(t.work_price != null ? t.work_price : t.work_price_ex_vat);
    const title = String(t.tender_title || '').trim();
    const cust = String(t.customer_name || '').trim() || 'Без названия';
    // Название дублирует заказчика — не рисуем его второй строкой.
    const sub = title && title !== cust ? title : '';
    return '<button type="button" class="mbk-row" data-tender-id="' + esc(t.id) + '">' +
      '<span class="mbk-row-id">#' + esc(t.id) + '</span>' +
      '<span class="mbk-row-main">' +
        '<span class="mbk-row-cust" title="' + esc(cust) + '">' + esc(cust) + '</span>' +
        (sub ? '<span class="mbk-row-ttl" title="' + esc(sub) + '">' + esc(sub) + '</span>' : '') +
      '</span>' +
      '<span class="mbk-row-side">' +
        (price ? '<span class="mbk-pm">' + esc(price) + '</span>' : '') +
        (t.pm_name ? '<span class="mbk-pm">' + esc(t.pm_name) + '</span>' : '') +
        '<span class="mbk-dl ' + dl.cls + '">' + esc(dl.text) + '</span>' +
        '<span class="mbk-row-go" aria-hidden="true">›</span>' +
      '</span>' +
    '</button>';
  }

  function section(opts) {
    const items = opts.items || [];
    if (!items.length) return '';
    const shown = items.slice(0, opts.limit || 8);
    const rest = items.length - shown.length;
    return '<section class="mbk-sec tone-' + (opts.tone || 'default') + '"' +
        (opts.key ? ' data-sec="' + esc(opts.key) + '"' : '') + '>' +
      '<header class="mbk-sec-h">' +
        '<h3>' + esc(opts.title) + '</h3>' +
        '<span class="mbk-n">' + items.length + '</span>' +
        (opts.hint ? '<span class="mbk-hint">' + esc(opts.hint) + '</span>' : '') +
        (opts.action ? '<span class="mbk-sec-act">' + opts.action + '</span>' : '') +
      '</header>' +
      shown.map(tenderRow).join('') +
      (rest > 0
        ? '<div class="mbk-crit">и ещё ' + rest + ' — смотрите в реестре</div>'
        : '') +
    '</section>';
  }

  function kpi(label, value, tone, key) {
    const zero = !Number(value);
    return '<button type="button" class="mbk-kpi' +
      (tone ? ' is-' + tone : '') + (zero ? ' is-zero' : '') +
      '"' + (key ? ' data-scroll-to="' + esc(key) + '"' : '') + '>' +
      '<span class="mbk-kpi-l">' + esc(label) + '</span>' +
      '<span class="mbk-kpi-v">' + esc(value) + '</span>' +
    '</button>';
  }

  function openModal(data) {
    if (!showModal) return;
    const to = data.to || {};
    const pm = data.pm || {};
    const c = data.counts || {};

    const overdue = to.overdue_report || [];
    const todayRep = to.today_report || [];
    const soon = to.soon_report || [];
    const ready = to.ready_no_submit || [];
    const missed = to.missed_submit || [];
    const needAssign = to.need_assign || [];
    const duty = pm.duty_analysis || [];
    const myCalcs = pm.my_calcs || [];

    const totalFocus = overdue.length + todayRep.length + soon.length + ready.length +
      needAssign.length + duty.length + myCalcs.length;

    // ── Герой ────────────────────────────────────────────────────────────────
    const parts = [];
    if (todayRep.length) {
      parts.push('<b>' + todayRep.length + '</b> ' +
        plural(todayRep.length, 'дедлайн', 'дедлайна', 'дедлайнов') + ' сегодня');
    }
    if (overdue.length) {
      parts.push('<b>' + overdue.length + '</b> ' +
        plural(overdue.length, 'просрочен', 'просрочено', 'просрочено') + ' без отчёта');
    }
    if (!parts.length && ready.length) {
      parts.push('<b>' + ready.length + '</b> ' +
        plural(ready.length, 'тендер готов', 'тендера готовы', 'тендеров готовы') + ' к подаче');
    }
    if (!parts.length && !ready.length) {
      parts.push('Горящих задач нет — можно работать по плану');
    }

    let body = '<div class="mbk">';
    body += '<div class="mbk-hero">' +
      '<div class="mbk-hero-main">' +
        '<div class="mbk-kicker">Утренний брифинг</div>' +
        '<h2 class="mbk-title">' + esc(prettifyDate(data.date, data.weekday)) + '</h2>' +
        '<p class="mbk-sub">' + parts.join(' · ') +
          (totalFocus ? ' · всего в фокусе <b>' + totalFocus + '</b>' : '') +
        '</p>' +
      '</div>' +
      '<div class="mbk-hero-ic" aria-hidden="true">☀<span class="mbk-hero-pulse"></span></div>' +
    '</div>';

    // ── Полоса KPI ───────────────────────────────────────────────────────────
    const kpiCells = [];
    if (todayRep.length) kpiCells.push(kpi('Сегодня', todayRep.length, 'warn', 'today'));
    if (overdue.length) kpiCells.push(kpi('Просрочено', overdue.length, 'err', 'overdue'));
    if (ready.length) kpiCells.push(kpi('К подаче', ready.length, 'ok', 'ready'));
    if (needAssign.length) kpiCells.push(kpi('Без считающего', needAssign.length, 'gold', 'assign'));
    if (duty.length) kpiCells.push(kpi('Дежурство', duty.length, 'gold', 'duty'));
    if (myCalcs.length) kpiCells.push(kpi('Мои просчёты', myCalcs.length, '', 'calcs'));
    if (kpiCells.length) body += '<div class="mbk-kpis">' + kpiCells.join('') + '</div>';

    // ── Секции ───────────────────────────────────────────────────────────────
    // Кнопка «Напомнить РП» ставится ровно в одну секцию — «Сегодня», если она есть,
    // иначе в «Ближайшие 5 дней». Раньше условие смотрело только на todayRep, и при
    // наличии просрочки кнопка появлялась дважды.
    const nudgeAllowed = ['TO', 'HEAD_TO', 'ADMIN'].includes(data.role) &&
      (todayRep.length + overdue.length + soon.length) > 0;
    const nudgeHtml = '<button type="button" class="btn mini" id="mbNudge">Напомнить РП</button>';
    const nudgeInToday = nudgeAllowed && todayRep.length > 0;
    const nudgeInSoon = nudgeAllowed && todayRep.length === 0 && soon.length > 0;
    const nudgeInOverdue = nudgeAllowed && todayRep.length === 0 && soon.length === 0 && overdue.length > 0;

    body += section({
      title: 'Просрочено — отчёта РП нет',
      tone: 'err',
      key: 'overdue',
      items: overdue,
      hint: 'сроки уже прошли',
      action: nudgeInOverdue ? nudgeHtml : ''
    });
    body += section({
      title: 'Сегодня последний день',
      tone: 'warn',
      key: 'today',
      items: todayRep,
      action: nudgeInToday ? nudgeHtml : ''
    });
    body += section({
      title: 'Ближайшие 5 дней',
      tone: 'info',
      key: 'soon',
      items: soon,
      action: nudgeInSoon ? nudgeHtml : ''
    });
    body += section({
      title: 'Готово — пора подаваться',
      tone: 'ok',
      key: 'ready',
      items: ready,
      hint: 'РП закрыл отчёт с вердиктом «подаём»'
    });
    body += section({
      title: 'Срок ушёл, а статус не обновлён',
      tone: 'warn',
      key: 'missed',
      items: missed,
      hint: 'проставить «подались» или в архив'
    });
    body += section({
      title: 'Анализ готов — нет считающего',
      tone: 'gold',
      key: 'assign',
      items: needAssign
    });
    body += section({
      title: 'Дежурство: анализ до конца смены',
      tone: 'gold',
      key: 'duty',
      items: duty,
      hint: pm.duty
        ? fmtDl(pm.duty.period_start) + ' — ' + fmtDl(pm.duty.period_end)
        : ''
    });
    body += section({
      title: 'Мои просчёты в работе',
      tone: 'info',
      key: 'calcs',
      items: myCalcs
    });

    // Канбан заявок
    if (pm.kanban && (pm.kanban.waiting || pm.kanban.in_work || pm.kanban.overdue)) {
      body += '<section class="mbk-sec tone-info">' +
        '<header class="mbk-sec-h"><h3>Канбан заявок</h3>' +
          '<span class="mbk-n">' + ((pm.kanban.waiting || 0) + (pm.kanban.in_work || 0)) + '</span>' +
        '</header>' +
        '<div class="mbk-stats">' +
          '<div><span>Ждут</span><b>' + (pm.kanban.waiting || 0) + '</b></div>' +
          '<div><span>В работе</span><b>' + (pm.kanban.in_work || 0) + '</b></div>' +
          '<div class="' + (pm.kanban.overdue ? 'is-bad' : '') + '"><span>Зависшие</span><b>' +
            (pm.kanban.overdue || 0) + '</b></div>' +
        '</div>' +
        (pm.kanban.overdue
          ? '<div class="mbk-crit">' + (pm.kanban.critical || [])
              .map((x) => esc(x.title) + ' · ' + esc(x.status)).join('<br>') + '</div>'
          : '') +
        '<div class="mbk-link"><a href="#/personal-kanban">Открыть личный канбан →</a></div>' +
      '</section>';
    }

    if (!totalFocus && !kpiCells.length) {
      body += '<div class="mbk-zero"><div class="mbk-zero-ic">🛡</div>' +
        'На сегодня ничего не горит.<br>Брифинг покажет задачи, как только появятся сроки.</div>';
    }

    body += '<div class="mbk-foot">' +
      '<a class="btn mini ghost" href="#/tenders" id="mbToRegistry">Весь реестр →</a>' +
      '<span class="mbk-foot-note">Показывается один раз в день</span>' +
      '<button type="button" class="btn primary" id="mbClose">К работе</button>' +
    '</div>';
    body += '</div>';

    const overlay = showModal({
      title: 'Утренний брифинг',
      subtitle: prettifyDate(data.date, data.weekday),
      icon: '☀',
      html: body,
      wide: true,
      onMount: (ctx) => {
        const root = (ctx && ctx.body) || overlay;
        if (!root) return;
        root.querySelector('#mbClose')?.addEventListener('click', () => hideModal(overlay));
        root.querySelector('#mbToRegistry')?.addEventListener('click', () => hideModal(overlay));

        // Клик по строке тендера — закрыть брифинг и открыть карточку в реестре.
        root.querySelectorAll('.mbk-row').forEach((el) => {
          el.addEventListener('click', () => {
            const id = Number(el.getAttribute('data-tender-id'));
            if (!id) return;
            hideModal(overlay);
            location.hash = '#/tenders?open=' + id;
          });
        });

        // Полоса KPI работает как оглавление: прокрутить к одноимённой секции.
        root.querySelectorAll('.mbk-kpi[data-scroll-to]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-scroll-to');
            const target = key && root.querySelector('.mbk-sec[data-sec="' + key + '"]');
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
        });

        const nudge = root.querySelector('#mbNudge');
        if (nudge) {
          nudge.addEventListener('click', async () => {
            // D-249: раньше уходил пустой body — сервер отвечал 400 «Укажите tender_ids».
            const ids = overdue.concat(todayRep, soon).map((t) => Number(t.id)).filter(Boolean);
            if (!ids.length) return;
            nudge.disabled = true;
            const label = nudge.textContent;
            nudge.textContent = 'Отправка…';
            try {
              const a = await AsgardAuth.getAuth();
              const res = await fetch('/api/tenders/morning-brief/nudge-email', {
                method: 'POST',
                headers: {
                  Authorization: 'Bearer ' + a.token,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ tender_ids: ids })
              });
              const d = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
              if (!d.recipients) {
                toast('Не отправлено', 'У этих тендеров не указан РП с почтой', 'warn');
              } else {
                toast('Готово',
                  'Писем: ' + d.sent + ' · получателей: ' + d.recipients,
                  'ok');
              }
            } catch (e) {
              toast('Ошибка', e.message || 'Не удалось отправить', 'err');
            } finally {
              nudge.disabled = false;
              nudge.textContent = label;
            }
          });
        }
      }
    });
    return overlay;
  }

  async function maybeShow(opts) {
    try {
      const a = await AsgardAuth.getAuth();
      if (!a || !a.token) return;
      const user = a.user || JSON.parse(localStorage.getItem('asgard_user') || '{}');
      const role = user.role || '';
      if (!['TO', 'HEAD_TO', 'PM', 'HEAD_PM', 'ADMIN'].includes(role)) return;

      // Дата по Москве, а не по UTC: иначе в 00:00–03:00 МСК ключ «вчерашний»
      // и окно показывается повторно.
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
      const key = storageKey(user.id, date);
      if (!opts || !opts.force) {
        if (localStorage.getItem(key)) return;
      }

      const res = await fetch('/api/tenders/morning-brief', {
        headers: { Authorization: 'Bearer ' + a.token }
      });
      if (!res.ok) return;
      const d = await res.json();
      if (!opts || !opts.force) localStorage.setItem(key, '1');
      if (!d || !d.show) return;
      openModal(d);
    } catch (_) { /* ignore */ }
  }

  return { maybeShow, openModal, money };
})();
