/* ═══════════════════════════════════════════════════════════════════════════
   ASGARD · прототип «Тинг Асгарда» — логика рендера
   Живой макет: можно потыкать все экраны.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';
  var T = w.TING, EMAILS = w.TING_EMAILS;

  var state = {
    view: 'overview',
    emailId: 'invite',
    crmVariant: 'mid',
    mobMailOpen: false,
    phone: 'iphone15'
  };

  var $ = function (s, r) { return (r || d).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function email(id) { for (var i = 0; i < EMAILS.length; i++) if (EMAILS[i].id === id) return EMAILS[i]; return EMAILS[0]; }

  /* ── письмо в iframe ─────────────────────────────────────────────────── */
  function emailDoc(html) {
    return '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>' +
      'html,body{margin:0;padding:0;background:#0f0f14;}' +
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#fff;}' +
      '.wrap{padding:22px 14px 30px;}' +
      'a{text-decoration:none;} b,i{font-style:normal;}' +
      'table{border-collapse:collapse;}' +
      'h2{font-family:inherit;}' +
      '@media(max-width:640px){.wrap{padding:12px 8px 22px;}}' +
      '</style></head><body><div class="wrap">' + html + '</div></body></html>';
  }

  function makeEmailFrame(id, mobile) {
    var ifr = d.createElement('iframe');
    ifr.className = 'mail-frame';
    ifr.setAttribute('title', 'Письмо');
    ifr.setAttribute('scrolling', 'no');
    ifr.srcdoc = emailDoc(email(id).render());
    ifr.addEventListener('load', function () {
      fit(ifr); bindMailLinks(ifr);
      setTimeout(function () { fit(ifr); }, 120);
      setTimeout(function () { fit(ifr); }, 420);
    });
    return ifr;
  }
  function fit(ifr) {
    try {
      var doc = ifr.contentDocument;
      var h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 720);
      ifr.style.height = (h + 4) + 'px';
      if (ifr.dataset) ifr.dataset.fittedH = String(h + 4);
    } catch (e) { ifr.style.height = '1200px'; }
  }

  /* ── ссылки внутри писем ─────────────────────────────────────────────── */
  function bindMailLinks(ifr) {
    try {
      var doc = ifr.contentDocument;
      $$('[data-goto]', doc).forEach(function (a) {
        a.style.cursor = 'pointer';
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var to = a.getAttribute('data-goto');
          if (to === 'survey') { go('survey-web'); toast('Кнопка из письма открыла опрос Тинга'); }
          else if (to === 'crm') { go('crm'); toast('Кнопка из письма открыла рейтинг в CRM'); }
          else { toast('Это ссылка на реальную CRM — в прототипе не открывается'); }
        });
      });
    } catch (e) {}
  }

  /* ── телефонная оболочка ─────────────────────────────────────────────── */
  function phoneScreen(inner, opts) {
    opts = opts || {};
    return '<div class="phone-shell"><div class="phone phone--' + state.phone + '">' +
      '<div class="phone__phone-notch phone__notch"></div>' +
      '<div class="phone__screen">' + inner + '</div>' +
      '<div class="phone__home' + (opts.light ? ' phone__home--light' : '') + '"></div>' +
      '</div></div>';
  }
  function statusBar(light, time) {
    return '<div class="phone__status' + (light ? ' phone__status--light' : '') + '">' +
      '<span>' + (time || '9:41') + '</span>' +
      '<span style="display:flex;gap:5px;align-items:center;font-size:11px;">' +
      '<span>●●●</span><span>📶</span><span>🔋</span></span></div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: ОБЗОР
     ═══════════════════════════════════════════════════════════════════════ */
  function viewOverview(host) {
    var flow = [
      ['01', 'Письмо на почту', 'Яндекс.Почта, ПК и телефон. Персональная ссылка с одноразовым токеном.', 'mail-desktop'],
      ['02', 'Уведомление в Telegram', 'Рабочий бот дублирует приглашение, чтобы письмо не потерялось.', 'tg'],
      ['03', 'Опрос «Тинг Асгарда»', 'Ровно 10 мест, себя и руководство выбрать нельзя, голос анонимный.', 'survey-web'],
      ['04', 'Рейтинг в CRM', 'Виджет на главной закреплён на 1 неделю: своё место + публичный ТОП-10.', 'crm'],
      ['05', 'Письма с итогами', 'Всем — «Рейтинг опубликован», в Ядро — личное, топ-3 — поздравления.', 'mail-desktop'],
      ['06', 'Отчёт руководству', 'Полный рейтинг, скрытые лидеры, зона риска, явка, рекомендации.', 'report']
    ];
    host.innerHTML = '<div class="ov">' +
      '<div class="ov__hero"><div class="ov__hero-txt">' +
        '<div class="tr-eyebrow">Прототип · живой рендер</div>' +
        '<h1 class="tr-h1" style="margin:8px 0 10px;">Тинг Асгарда<br>рейтинг ТОП-10 Дружины АСГАРД</h1>' +
        '<p class="tr-muted" style="max-width:640px;font-size:14px;line-height:1.65;">' +
          'Кликабельный макет всей кампании: письмо сотруднику → переход по ссылке → анонимный опрос → ' +
          'рейтинг в CRM на неделю → письма с итогами. Слева — все экраны, справа — как это выглядит на ПК и на телефоне. ' +
          'Сотрудники и цифры вымышлены.</p>' +
        '<div class="ov__hero-chips">' +
          '<span class="tr-chip tr-chip--gold">⚔ стилистика АСГАРД</span>' +
          '<span class="tr-chip">' + T.CREW.length + ' человек в списке</span>' +
          '<span class="tr-chip">ТОП-10 · 1 место = 10 баллов</span>' +
          '<span class="tr-chip tr-chip--ok">анонимно</span>' +
        '</div>' +
      '</div>' +
      '<div class="ov__hero-card tr-card tr-card--gold">' +
        '<div class="tr-eyebrow">Ядро Дружины АСГАРД</div>' +
        T.core().map(function (e, i) {
          return '<div class="crm-core-row" style="padding:5px 4px;">' +
            '<span class="tr-medal tr-medal--' + (i === 0 ? '1' : i === 1 ? '2' : i === 2 ? '3' : 'core') + '" style="width:24px;height:24px;font-size:11px;">' + (i + 1) + '</span>' +
            '<span class="crm-core-name"><b style="font-size:12.5px;">' + esc(T.shortName(e.fio)) + '</b></span>' +
            '<span class="crm-core-pts" style="font-size:12px;">' + e.points + '</span></div>';
        }).join('') +
      '</div>' +
      '</div>' +
      '<div class="ov__grid">' + flow.map(function (f) {
        return '<button class="ov-card tr-card" data-nav="' + f[3] + '">' +
          '<span class="ov-card__n">' + f[0] + '</span>' +
          '<span class="ov-card__t">' + f[1] + '</span>' +
          '<span class="ov-card__d">' + f[2] + '</span>' +
          '<span class="ov-card__go">Открыть экран →</span></button>';
      }).join('') + '</div>' +
      '<div class="ov__note tr-card">' +
        '<b>Что внутри макета</b>' +
        '<ul>' +
        '<li>Письмо-приглашение, напоминание, «рейтинг опубликован», личное письмо «вы в Ядре» и три поздравления (1/2/3 место).</li>' +
        '<li>Яндекс.Почта на компьютере и мобильный почтовый клиент — одно и то же письмо в двух видах.</li>' +
        '<li>Опрос: выбор ровно 10 человек, порядок мест, поиск, отправка. Себя и руководство выбрать нельзя — они закрыты замком.</li>' +
        '<li>CRM-виджет на неделю: своё место, баллы до Ядра, публичный ТОП-10. И управленческий отчёт — то, что сотрудникам не видно.</li>' +
        '</ul>' +
      '</div>' +
    '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: ЯНДЕКС.ПОЧТА (ПК)
     ═══════════════════════════════════════════════════════════════════════ */
  function viewMailDesktop(host) {
    var sel = email(state.emailId);
    var list = EMAILS.map(function (em) {
      return '<div class="ym__item ' + (em.id === sel.id ? 'is-sel ' : '') + (em.unread ? 'is-unread' : '') + '" data-email="' + em.id + '">' +
        '<span class="ym__dotnew"></span>' +
        '<div class="ym__itemtop"><span class="ym__from">АСГАРД CRM</span>' +
          '<span class="ym__when">' + esc(em.when) + '</span></div>' +
        '<div class="ym__subj">' + esc(em.subject) + '</div>' +
        '<div class="ym__snip">' + esc(em.preview) + '</div>' +
        (em.tag ? '<div style="margin-top:2px;"><span class="ym__tag ym__tag--ting">⚔ ' + em.tag + '</span></div>' : '') +
        '</div>';
    }).join('');

    host.innerHTML = '<div class="ym">' +
      '<div class="ym__top">' +
        '<div class="ym__brand"><span class="dot">Я</span> Яндекс Почта</div>' +
        '<div class="ym__search"><span>🔎</span><input placeholder="Найти письмо, документ или контакт" readonly></div>' +
        '<div class="ym__user"><span>roman.zhukov@asgard-service.com</span><span class="ym__uava">РЖ</span></div>' +
      '</div>' +
      '<div class="ym__body">' +
        '<div class="ym__nav">' +
          '<button class="ym__compose">✏️ Написать</button>' +
          '<div class="ym__fld is-active"><span class="ic">📥</span> Входящие <span class="cnt">' + EMAILS.length + '</span></div>' +
          '<div class="ym__fld"><span class="ic">⭐</span> Помеченные</div>' +
          '<div class="ym__fld"><span class="ic">📤</span> Отправленные</div>' +
          '<div class="ym__fld"><span class="ic">📝</span> Черновики</div>' +
          '<div class="ym__fld"><span class="ic">🗑</span> Удалённые <span class="cnt">0</span></div>' +
          '<div class="ym__sep"></div>' +
          '<div class="ym__navlabel">Метки</div>' +
          '<div class="ym__fld"><span class="ic">⚔</span> Тинг <span class="cnt">' + EMAILS.length + '</span></div>' +
          '<div class="ym__fld"><span class="ic">💰</span> Тендеры</div>' +
          '<div class="ym__fld"><span class="ic">🧾</span> Документы</div>' +
        '</div>' +

        '<div class="ym__list">' +
          '<div class="ym__listbar"><b>Входящие</b><span class="tools">' +
            '<button class="ym__tool" title="Обновить">⟳</button>' +
            '<button class="ym__tool" title="Фильтр">⚙</button></span></div>' +
          '<div class="ym__scroll" id="ymList">' + list + '</div>' +
        '</div>' +

        '<div class="ym__read">' +
          '<div class="ym__readbar">' +
            '<button class="ym__btn ym__btn--primary">↩ Ответить</button>' +
            '<button class="ym__btn">Переслать</button>' +
            '<span class="tools">' +
              '<button class="ym__tool" title="В архив">🗄</button>' +
              '<button class="ym__tool" title="Удалить">🗑</button>' +
              '<button class="ym__tool" title="Ещё">⋯</button>' +
            '</span>' +
          '</div>' +
          '<div class="ym__meta">' +
            '<h1 class="ym__subject">' + esc(sel.subject) + '</h1>' +
            '<div class="ym__sender">' +
              '<span class="ym__sava">' + sel.from.initials + '</span>' +
              '<div class="ym__sendinfo">' +
                '<div class="ym__sendname">' + esc(sel.from.name) + ' <span class="em">&lt;' + sel.from.email + '&gt;</span></div>' +
                '<div class="ym__sendto">кому: Роман Жуков &lt;roman.zhukov@asgard-service.com&gt;</div>' +
              '</div>' +
              '<span class="ym__whentag">' + esc(sel.when) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="ym__body-slot" id="ymBody"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

    var body = $('#ymBody', host);
    var ifr = makeEmailFrame(sel.id, false);
    body.appendChild(ifr);
    setTimeout(function () { bindMailLinks(ifr); }, 300);

    $$('[data-email]', host).forEach(function (it) {
      it.addEventListener('click', function () {
        state.emailId = it.getAttribute('data-email');
        renderView();
      });
    });
    var sc = $('.ym__scroll', host);
    if (sc) { var act = $('.ym__item.is-sel', sc); if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' }); }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: ПОЧТА НА ТЕЛЕФОНЕ
     ═══════════════════════════════════════════════════════════════════════ */
  function viewMailMobile(host) {
    if (!state.mobMailOpen) {
      var list = EMAILS.map(function (em) {
        return '<div class="mmail-item ' + (em.unread ? 'is-unread' : '') + '" data-memail="' + em.id + '">' +
          '<span class="mmail-ava">АС</span>' +
          '<span class="mmail-mid">' +
            '<span class="mmail-top"><b>АСГАРД CRM</b><i>' + esc(em.when.split(',')[0]) + '</i></span>' +
            '<span class="mmail-subj">' + esc(em.subject) + '</span>' +
            '<span class="mmail-snip">' + esc(em.preview) + '</span>' +
          '</span>' +
          '<span class="mmail-dot"></span>' +
          '</div>';
      }).join('');
      host.innerHTML = phoneScreen(
        statusBar(false, '9:41') +
        '<div class="mmail-head"><span class="mmail-head__t">Входящие</span><span class="mmail-head__ic">🔎 ⚙</span></div>' +
        '<div class="phone__content mmail-list">' + list + '</div>',
        { light: false }
      );
      $$('[data-memail]', host).forEach(function (it) {
        it.addEventListener('click', function () { state.emailId = it.getAttribute('data-memail'); state.mobMailOpen = true; renderView(); });
      });
      return;
    }
    var sel = email(state.emailId);
    host.innerHTML = phoneScreen(
      statusBar(false, '9:43') +
      '<div class="mmail-read-bar">' +
        '<button class="mmail-back" data-back="1">‹</button>' +
        '<span class="mmail-read-subj">' + esc(sel.subject) + '</span>' +
        '<span class="mmail-head__ic">⭐ ⋯</span>' +
      '</div>' +
      '<div class="mmail-readmeta">' +
        '<span class="mmail-ava" style="width:34px;height:34px;">АС</span>' +
        '<div style="min-width:0;"><div class="mmail-read-from">' + esc(sel.from.name) + '</div>' +
        '<div class="mmail-read-to">кому: мне · ' + esc(sel.when) + '</div></div>' +
      '</div>' +
      '<div class="phone__content mmail-body" id="mmailBody"></div>',
      { light: false }
    );
    var body = $('#mmailBody', host);
    var ifr = makeEmailFrame(sel.id, true);
    body.appendChild(ifr);
    setTimeout(function () { bindMailLinks(ifr); }, 300);
    $('[data-back]', host).addEventListener('click', function () { state.mobMailOpen = false; renderView(); });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: TELEGRAM
     ═══════════════════════════════════════════════════════════════════════ */
  function viewTg(host) {
    host.innerHTML = phoneScreen(
      '<div class="tg">' +
        statusBar(true, '9:12') +
        '<div class="tg__head">' +
          '<span class="tg__ava">⚔</span>' +
          '<div><div class="tg__name">АСГАРД · Дружина</div><div class="tg__sub">рабочий канал · 20 участников</div></div>' +
          '<span style="margin-left:auto;color:#6C7883;">🔍 ⋮</span>' +
        '</div>' +
        '<div class="tg__scroll">' +
          '<span class="tg__day">Сегодня</span>' +
          '<div class="tg__msg"><b>⚔ Тинг Асгарда открыт</b><br>' +
            'Пройди анонимный опрос до <b>11 октября</b> — это займёт 5 минут.<br>' +
            'Ссылка — в письме на рабочей почте.<br>' +
            '<a href="#" data-goto="survey">Перейти к опросу →</a>' +
            '<span class="tg__time">09:05</span></div>' +
          '<div class="tg__msg"><b>⏳ Напоминание</b><br>Кто ещё не прошёл Тинг — успейте до 11 октября. Голос анонимный, но важный.<span class="tg__time">09:12</span></div>' +
          '<div class="tg__msg tg__msg--out">Уже прошёл 👍<span class="tg__time">09:14</span></div>' +
          '<span class="tg__day">Понедельник</span>' +
          '<div class="tg__msg"><b>🏆 Ядро Дружины АСГАРД определено</b><br>Спасибо всем, кто отдал голос. Рейтинг опубликован в CRM — виджет на главной на неделю.' +
            '<a class="tg__btn" href="#" data-goto="crm">Открыть рейтинг</a>' +
            '<span class="tg__time">12:00</span></div>' +
        '</div>' +
        '<div class="tg__input"><div></div><span style="color:#6C7883;">🎤</span></div>' +
      '</div>',
      { light: true }
    );
    $$('[data-goto]', host).forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var to = a.getAttribute('data-goto');
        if (to === 'survey') { go('survey-web'); toast('Ссылка из Telegram открыла опрос'); }
        else { go('crm'); }
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: ОПРОС (ПК) — встроенный и как ссылка
     ═══════════════════════════════════════════════════════════════════════ */
  function viewSurveyWeb(host) {
    var bar = '<div class="sv-toolbar">' +
      '<div class="sv-urlbar"><span class="lock">🔒</span>' +
        '<span class="url">crm.asgard-service.com/ting/k7f3q9</span>' +
        '<span class="tr-chip tr-chip--ok" style="margin-left:auto;">токен активен</span></div>' +
      '<button class="tr-btn tr-btn--ghost tr-btn--sm" data-open-survey>Открыть в новой вкладке ↗</button>' +
      '</div>';
    host.innerHTML = bar + '<div id="svHost"></div>';
    w.TING_SURVEY.render($('#svHost', host), {});
    $('[data-open-survey]', host).addEventListener('click', function () { w.open('survey.html', '_blank'); });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: ОПРОС НА ТЕЛЕФОНЕ
     ═══════════════════════════════════════════════════════════════════════ */
  function renderMobileSurvey(container, opts) {
    opts = opts || {};
    var picks = [], done = false, query = '';

    function placeOf(id) { for (var i = 0; i < picks.length; i++) if (picks[i] === id) return i + 1; return 0; }

    function draw() {
      if (done) {
        container.innerHTML = statusBar(false, '9:48') +
          '<div class="mmail-read-bar"><span class="mmail-read-subj">Тинг Асгарда</span></div>' +
          '<div class="phone__content" style="display:flex;align-items:center;justify-content:center;padding:20px;">' +
            '<div style="text-align:center;max-width:300px;">' +
              '<div style="font-size:52px;margin-bottom:12px;">✅</div>' +
              '<h2 style="font-size:21px;margin:0 0 10px;">Спасибо! Ваш голос учтён</h2>' +
              '<p class="tr-muted" style="font-size:13px;line-height:1.6;">Токен погашен. Голос анонимный и пересмотру не подлежит. Итоги Дружина увидит после завершения Тинга.</p>' +
            '</div></div>';
        return;
      }
      var list = T.CREW.filter(function (c) {
        if (!query) return true;
        var q = query.toLowerCase();
        return (c.fio + ' ' + c.role + ' ' + c.dept).toLowerCase().indexOf(q) >= 0;
      }).map(function (c) {
        var place = placeOf(c.id);
        return '<div class="mob__row' + (place ? ' is-picked' : '') + '" data-mpick="' + c.id + '">' +
          '<span class="tr-ava tr-ava--t' + T.tone(c.id) + '" style="width:34px;height:34px;font-size:12px;">' + T.initials(c.fio) + '</span>' +
          '<div class="tr-row__body">' +
            '<div class="tr-row__name">' + esc(c.fio) + '</div>' +
            '<div class="tr-row__meta">' + esc(c.role) + ' · ' + esc(c.dept) + '</div>' +
          '</div>' +
          '<span class="mob__pick">' + (place || '+') + '</span>' +
          '</div>';
      }).join('');

      container.innerHTML = statusBar(false, '9:45') +
        '<div class="mob__head">' +
          '<span class="tr-medal tr-medal--core" style="background:var(--grad-gold);color:#241B06;border:0;font-size:15px;">⚔</span>' +
          '<div class="mob__prog"><div class="tr-prog"><i style="width:' + (picks.length * 10) + '%"></i></div>' +
            '<div class="tr-dim" style="font-size:10.5px;margin-top:4px;">выбрано ' + picks.length + ' из 10</div></div>' +
        '</div>' +
        '<div class="phone__content">' +
          '<div class="mob__q">' +
            '<h1>Рейтинг ТОП-10 Дружины АСГАРД</h1>' +
            '<p>Нажми на Коллегу, чтобы поставить его в рейтинг. Первое нажатие — 1 место, дальше по порядку. Нажми повторно, чтобы убрать.</p>' +
            '<p><b>Себя и руководство выбрать нельзя.</b> Голос анонимный, один раз.</p>' +
          '</div>' +
          '<div class="sv-search" style="margin:0 15px 8px;"><span>🔎</span><input id="mobQuery" placeholder="Поиск…" value="' + esc(query) + '"></div>' +
          '<div>' + list + '</div>' +
          '<div class="tr-dim" style="text-align:center;font-size:11px;padding:16px;">🔒 Руководство (4 человека) и вы сами в выборе не участвуют</div>' +
        '</div>' +
        '<div class="mob__sticky">' +
          '<button class="tr-btn tr-btn--gold tr-btn--block tr-btn--lg" id="mobSubmit"' + (picks.length === 10 ? '' : ' disabled') + '>' +
            (picks.length === 10 ? 'Отправить голос' : 'Выберите ещё ' + (10 - picks.length)) + '</button>' +
          '<div class="tr-dim" style="text-align:center;font-size:10.5px;margin-top:8px;">После отправки изменить голос нельзя</div>' +
        '</div>';

      var q = container.querySelector('#mobQuery');
      if (q) q.addEventListener('input', function () {
        query = q.value; var pos = q.selectionStart; draw();
        var nq = container.querySelector('#mobQuery'); if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) {} }
      });
      $$('[data-mpick]', container).forEach(function (r) {
        r.addEventListener('click', function () {
          var id = r.getAttribute('data-mpick');
          var i = picks.indexOf(id);
          if (i >= 0) picks.splice(i, 1);
          else if (picks.length < 10) picks.push(id);
          draw();
        });
      });
      var sb = container.querySelector('#mobSubmit');
      if (sb) sb.addEventListener('click', function () { if (picks.length === 10) { done = true; draw(); } });
    }
    draw();
  }

  function viewSurveyMobile(host) {
    host.innerHTML = phoneScreen('<div id="mobSurvey" style="display:flex;flex-direction:column;height:100%;"></div>', {});
    renderMobileSurvey($('#mobSurvey', host), {});
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: CRM-ВИДЖЕТ
     ═══════════════════════════════════════════════════════════════════════ */
  function viewCrm(host) {
    host.innerHTML = '<div class="crm-toolbar">' +
      '<div class="seg">' +
        '<button class="seg__b' + (state.crmVariant === 'mid' ? ' is-on' : '') + '" data-crm="mid">Сотрудник вне Ядра · 11 место</button>' +
        '<button class="seg__b' + (state.crmVariant === 'core' ? ' is-on' : '') + '" data-crm="core">Сотрудник в Ядре · 10 место</button>' +
      '</div>' +
      '<span class="tr-chip tr-chip--blue">виджет закреплён на 7 дней</span>' +
      '</div><div id="crmHost"></div>';
    w.TING_RATING.renderBanner($('#crmHost', host), state.crmVariant === 'core' ? 'core' : 'mid');
    $$('[data-crm]', host).forEach(function (b) {
      b.addEventListener('click', function () { state.crmVariant = b.getAttribute('data-crm'); renderView(); });
    });
    var cl = $('.crm-banner__close', host);
    if (cl) cl.addEventListener('click', function () { toast('Виджет можно свернуть — вернётся при обновлении страницы'); });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: ОТЧЁТ РУКОВОДСТВУ
     ═══════════════════════════════════════════════════════════════════════ */
  function viewReport(host) {
    host.innerHTML = '<div class="crm-toolbar"><span class="tr-chip tr-chip--red">🔒 только руководство · публично не показывается</span>' +
      '<span class="tr-dim" style="font-size:12px;">Видят: Соколов А. В. · Громов Д. О. · Ерёмин П. С.</span></div><div id="repoHost"></div>';
    w.TING_RATING.renderReport($('#repoHost', host));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     РОУТЕР ЭКРАНОВ
     ═══════════════════════════════════════════════════════════════════════ */
  var HOST = null;
  function renderView() {
    var v = state.view;
    HOST.innerHTML = '';
    var el = d.createElement('div');
    el.className = 'view view--' + v;
    HOST.appendChild(el);
    if (v === 'overview') viewOverview(el);
    else if (v === 'mail-desktop') viewMailDesktop(el);
    else if (v === 'mail-mobile') viewMailMobile(el);
    else if (v === 'tg') viewTg(el);
    else if (v === 'survey-web') viewSurveyWeb(el);
    else if (v === 'survey-mobile') viewSurveyMobile(el);
    else if (v === 'crm') viewCrm(el);
    else if (v === 'report') viewReport(el);

    $$('[data-nav]', el).forEach(function (b) {
      b.addEventListener('click', function () { go(b.getAttribute('data-nav')); });
    });
    $$('[data-nav]', d).forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-nav') === v);
    });
    var title = $('#crumb');
    if (title) {
      var n = $('.nav__item[data-nav="' + v + '"]');
      title.textContent = n ? n.getAttribute('data-label') : '';
    }
    var dev = $('#deviceBar');
    if (dev) dev.style.display = (v === 'mail-mobile' || v === 'survey-mobile' || v === 'tg') ? 'flex' : 'none';
  }

  function go(view) { state.view = view; window.scrollTo(0, 0); renderView(); }

  var toastT = null;
  function toast(text) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('is-on'); }, 3200);
  }

  /* ── init ────────────────────────────────────────────────────────────── */
  function init() {
    HOST = $('#viewHost');
    if (!HOST) return;                       // print-режим: страница без оболочки приложения
    $$('.nav__item').forEach(function (b) {
      b.addEventListener('click', function () {
        var em = b.getAttribute('data-email');
        if (em) state.emailId = em;
        state.mobMailOpen = false;
        go(b.getAttribute('data-nav'));
      });
    });
    $$('[data-phone]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.phone = b.getAttribute('data-phone');
        $$('[data-phone]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
        renderView();
      });
    });
    if (w.location.hash) {
      var h = w.location.hash.replace('#', '');
      if ($('.nav__item[data-nav="' + h + '"]')) state.view = h;
      else if ($('.nav__item[data-email="' + h + '"]')) state.emailId = h;   // ссылка вида index.html#invite
    }
    w.addEventListener('hashchange', function () {
      var hh = w.location.hash.replace('#', '');
      var item = $('.nav__item[data-nav="' + hh + '"]');
      if (item) { state.view = hh; state.mobMailOpen = false; renderView(); }
    });
    renderView();
    // при смене размера — пересчитать высоту письма
    w.addEventListener('resize', function () { $$('iframe.mail-frame').forEach(fit); });
  }

  w.TING_APP = { go: go, toast: toast, renderMobileSurvey: renderMobileSurvey, emailDoc: emailDoc, makeEmailFrame: makeEmailFrame, fit: fit, bindMailLinks: bindMailLinks, statusBar: statusBar };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
