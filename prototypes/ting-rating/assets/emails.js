/* ═══════════════════════════════════════════════════════════════════════════
   ASGARD · прототип — 7 писем «Тинга Асгарда»
   Письма свёрстаны e-mail-таблицами и инлайн-стилями — так, как их увидит
   Яндекс.Почта и мобильный клиент. Тёмная «асгардовская» карточка, золото,
   ⚔️ и руны (SVG инлайном). Всё кликается: ссылки ведут в живой опрос.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';
  var T = w.TING;

  var GOLD = '#cfb53b', GOLD2 = '#B8922E';
  var CARD = 'linear-gradient(135deg,#1a1a24 0%,#12121a 100%)';
  var HEAD = 'linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)';
  var T2 = 'rgba(255,255,255,0.72)';
  var T3 = 'rgba(255,255,255,0.45)';
  var BRD = '1px solid rgba(207,181,59,0.28)';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function rune(mark, size) {
    size = size || 34;
    return '<span style="display:inline-grid;place-items:center;width:' + size + 'px;height:' + size +
      'px;border-radius:' + Math.round(size * 0.3) + 'px;background:linear-gradient(145deg,' + GOLD + ',' + GOLD2 +
      ');color:#241B06;font-size:' + Math.round(size * 0.5) + 'px;font-weight:800;line-height:1;">' + mark + '</span>';
  }

  function header(sub) {
    return '' +
      '<tr><td style="background:' + HEAD + ';padding:26px 30px;text-align:center;border-bottom:2px solid rgba(207,181,59,0.45);">' +
        '<div style="margin-bottom:10px;">' + rune('⚔', 40) + '</div>' +
        '<div style="color:' + GOLD + ';font-size:22px;font-weight:800;letter-spacing:3px;">АСГАРД</div>' +
        '<div style="color:' + T3 + ';font-size:12px;letter-spacing:1.4px;text-transform:uppercase;margin-top:5px;">' + esc(sub) + '</div>' +
      '</td></tr>';
  }

  function footer() {
    return '' +
      '<tr><td style="padding:22px 30px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">' +
        '<p style="color:rgba(255,255,255,0.32);font-size:12px;margin:0;line-height:1.6;">' +
          '⚔️ АСГАРД CRM · АСГАРД-СЕРВИС &copy; 2026<br>Это письмо отправлено автоматически, отвечать на него не нужно.' +
        '</p>' +
        '<p style="color:rgba(255,255,255,0.2);font-size:11px;margin:8px 0 0;">' +
          'Письмо содержит персональную ссылку. Не пересылайте его коллегам.' +
        '</p>' +
      '</td></tr>';
  }

  function card(inner, extra) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;' +
      'background:' + CARD + ';border-radius:16px;border:' + BRD + ';overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.5);' +
      (extra || '') + '">' + inner + '</table>';
  }

  function metricCard(label, value, accent) {
    return '<td width="33.33%" style="padding:0 5px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;">' +
      '<tr><td style="padding:16px 12px;text-align:center;">' +
        '<div style="font-size:26px;font-weight:800;color:' + (accent || GOLD) + ';line-height:1;font-family:monospace;">' + value + '</div>' +
        '<div style="font-size:10.5px;color:' + T3 + ';text-transform:uppercase;letter-spacing:1px;margin-top:7px;">' + label + '</div>' +
      '</td></tr></table></td>';
  }

  function cta(href, text, sub, goto) {
    return '' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0 4px;">' +
        '<a href="' + esc(href) + '" data-goto="' + (goto || 'survey') + '" style="display:inline-block;background:linear-gradient(135deg,' + GOLD + ',' + GOLD2 +
          ');color:#241B06;padding:15px 40px;border-radius:10px;text-decoration:none;font-weight:800;font-size:15.5px;letter-spacing:.4px;">' +
          esc(text) + '</a>' +
        (sub ? '<div style="color:' + T3 + ';font-size:11.5px;margin-top:10px;">' + sub + '</div>' : '') +
      '</td></tr></table>';
  }

  function quote(text) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(207,181,59,0.06);border-left:3px solid ' + GOLD + ';border-radius:0 8px 8px 0;">' +
      '<tr><td style="padding:14px 18px;">' +
      '<p style="color:' + T3 + ';font-size:10.5px;text-transform:uppercase;letter-spacing:1.4px;margin:0 0 6px;">⚡ Слово Тинга</p>' +
      '<p style="color:' + T2 + ';font-style:italic;margin:0;line-height:1.55;font-size:13.5px;">' + text + '</p>' +
      '</td></tr></table>';
  }

  function instrRows(items, color) {
    var rows = items.map(function (it, i) {
      return '<tr><td width="30" valign="top" style="padding:5px 0;">' +
        '<span style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:rgba(207,181,59,0.14);color:' +
        (color || GOLD) + ';font-size:11.5px;font-weight:800;">' + (i + 1) + '</span></td>' +
        '<td style="padding:5px 0;color:' + T2 + ';font-size:13.5px;line-height:1.5;">' + it + '</td></tr>';
    }).join('');
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rows + '</table>';
  }

  function p(text, extra) {
    return '<p style="color:' + T2 + ';font-size:14px;line-height:1.65;margin:0 0 14px;' + (extra || '') + '">' + text + '</p>';
  }
  function h2(text) {
    return '<h2 style="color:#EDEDF2;font-size:19px;font-weight:700;margin:0 0 12px;">' + text + '</h2>';
  }
  function divider() {
    return '<div style="height:1px;background:rgba(255,255,255,0.07);margin:22px 0;"></div>';
  }

  // ── медаль для 1/2/3 мест ───────────────────────────────────────────────
  var MEDALS = {
    1: { mark: '🥇', ring: '#E8C35A', label: 'ПЕРВОЕ МЕСТО', grad: 'linear-gradient(145deg,#F2D480,#B8922E)', ink: '#2A1F05' },
    2: { mark: '🥈', ring: '#C8D2E0', label: 'ВТОРОЕ МЕСТО', grad: 'linear-gradient(145deg,#E6ECF5,#9AA8BE)', ink: '#1A2130' },
    3: { mark: '🥉', ring: '#CD8A4B', label: 'ТРЕТЬЕ МЕСТО', grad: 'linear-gradient(145deg,#E2A86B,#A2642F)', ink: '#2A1705' }
  };

  function topCore(n) {
    return T.core().slice(0, n || 10).map(function (e, i) {
      var m = i === 0 ? MEDALS[1] : i === 1 ? MEDALS[2] : i === 2 ? MEDALS[3] : null;
      return '<tr><td style="padding:5px 0;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:10px;">' +
        '<tr>' +
          '<td width="42" style="padding:8px 0 8px 10px;">' +
            '<span style="display:inline-grid;place-items:center;width:26px;height:26px;border-radius:8px;font-size:12px;font-weight:800;' +
            (m ? 'background:' + m.grad + ';color:' + m.ink + ';' : 'background:rgba(207,181,59,0.12);color:' + GOLD + ';') + '">' +
            (i + 1) + '</span></td>' +
          '<td style="padding:8px 8px;"><div style="color:#EDEDF2;font-size:13.5px;font-weight:600;">' + esc(e.fio) + '</div>' +
            '<div style="color:' + T3 + ';font-size:11px;margin-top:1px;">' + esc(e.role) + '</div></td>' +
          '<td align="right" style="padding:8px 12px 8px 0;color:' + GOLD + ';font-size:13px;font-weight:800;font-family:monospace;">' + e.points + '</td>' +
        '</tr></table></td></tr>';
    }).join('');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 1. ПРИГЛАШЕНИЕ
  // ═════════════════════════════════════════════════════════════════════════
  function invite() {
    return card(
      header('Тинг Асгарда · опрос') +
      '<tr><td style="padding:30px 30px 8px;">' +
        h2('Приветствуем, Роман!') +
        p('Дружина собирается на <b style="color:' + GOLD + '">Тинг Асгарда</b> — анонимный опрос, где каждый сотрудник ' +
          'формирует рейтинг ТОП-10 и определяет ядро компании.') +
        p('Это займёт около <b style="color:#EDEDF2">5 минут</b>. Проголосовать можно один раз, до <b style="color:#EDEDF2">' + T.META.deadline + '</b>.') +
      '</td></tr>' +
      '<tr><td style="padding:6px 30px 0;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
          '<tr>' + metricCard('в списке', T.CREW.length) + metricCard('мест', 10) + metricCard('до конца', '11.10', '#4A90D9') + '</tr>' +
        '</table>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 30px 0;">' +
        '<div style="background:rgba(207,181,59,0.07);border:1px solid rgba(207,181,59,0.22);border-radius:12px;padding:20px 22px;">' +
          '<p style="color:' + T3 + ';font-size:10.5px;text-transform:uppercase;letter-spacing:1.2px;margin:0 0 12px;">Как это работает</p>' +
          instrRows([
            'Полный список Коллег — с должностью, отделом и зоной ответственности.',
            'Выбери <b style="color:#EDEDF2">ровно 10 человек</b> и расставь по местам: 1-е — самый незаменимый.',
            'Себя и руководство выбрать нельзя.',
            'Голосование анонимное. Токен в ссылке одноразовый.'
          ]) +
        '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:24px 30px 8px;">' +
        cta(T.META.crmUrl + '/k7f3q9', 'Пройти Тинг →', 'Ссылка персональная · действует один раз') +
      '</td></tr>' +
      '<tr><td style="padding:8px 30px 0;">' +
        '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:12px 16px;">' +
          '<p style="color:' + T3 + ';font-size:10.5px;text-transform:uppercase;letter-spacing:1.2px;margin:0 0 4px;">Если кнопка не работает</p>' +
          '<p style="color:#7FB0E8;font-size:12.5px;margin:0;word-break:break-all;">' + esc(T.META.crmUrl + '/k7f3q9') + '</p>' +
        '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:20px 30px 28px;">' +
        quote('Мы знаем вклад каждого — но истинное ядро видит Дружина.') +
      '</td></tr>' +
      footer()
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 2. НАПОМИНАНИЕ
  // ═════════════════════════════════════════════════════════════════════════
  function reminder() {
    return card(
      header('Тинг Асгарда · напоминание') +
      '<tr><td style="padding:30px 30px 0;">' +
        '<span style="display:inline-block;background:rgba(200,41,59,0.14);border:1px solid rgba(200,41,59,0.35);color:#E8475A;' +
        'font-size:11px;font-weight:700;letter-spacing:.6px;padding:5px 12px;border-radius:999px;margin-bottom:14px;">⏳ ОСТАЛОСЬ 2 ДНЯ</span>' +
        h2('Роман, ваш голос ещё не учтён') +
        p('Вы ещё не прошли Тинг. Мы не видим, кого вы выбираете, — и не увидим. Но мы видим, что голос не отдан.') +
        p('Тинг закроется <b style="color:#EDEDF2">' + T.META.deadline + '</b>, после последнего голоса. Успейте повлиять на состав Ядра.') +
      '</td></tr>' +
      '<tr><td style="padding:8px 30px 0;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
          '<tr>' + metricCard('уже прошли', T.META.votes + '/' + T.META.total) + metricCard('осталось времени', '2 дня', '#E8475A') + '</tr>' +
        '</table>' +
      '</td></tr>' +
      '<tr><td style="padding:24px 30px 12px;">' + cta(T.META.crmUrl + '/k7f3q9', 'Пройти Тинг →', 'Займёт 5 минут') + '</td></tr>' +
      '<tr><td style="padding:0 30px 28px;">' + quote('Голос, который промолчал, не слышит никто.') + '</td></tr>' +
      footer()
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 3. РЕЙТИНГ ОПУБЛИКОВАН (всем)
  // ═════════════════════════════════════════════════════════════════════════
  function published() {
    return card(
      header('Рейтинг опубликован') +
      '<tr><td style="padding:30px 30px 0;text-align:center;">' +
        '<div style="font-size:34px;margin-bottom:8px;">🏆</div>' +
        h2('Ядро Дружины АСГАРД определёно') +
        p('Тинг завершён. Спасибо, что отдали голос — вместе Дружина сформировала ТОП-10. ' +
          'На главной странице CRM на неделю закреплён ваш виджет с рейтингом.') +
      '</td></tr>' +
      '<tr><td style="padding:8px 30px 0;">' +
        '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:16px 18px;">' +
          '<p style="color:' + GOLD + ';font-size:11px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;margin:0 0 12px;text-align:center;">⚔ Ядро Дружины АСГАРД · ТОП-10</p>' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + topCore(10) + '</table>' +
        '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:20px 30px 0;">' +
        '<div style="background:rgba(30,77,140,0.16);border:1px solid rgba(30,77,140,0.4);border-radius:12px;padding:16px 18px;text-align:center;">' +
          '<div style="color:' + T3 + ';font-size:11px;text-transform:uppercase;letter-spacing:1.2px;">Ваша позиция</div>' +
          '<div style="color:#EDEDF2;font-size:22px;font-weight:800;margin:6px 0 2px;">11 место из 20</div>' +
          '<div style="color:' + T3 + ';font-size:12.5px;">До Ядра — <b style="color:' + GOLD + '">6 баллов</b></div>' +
        '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 30px 8px;">' +
        cta(T.META.crmUrl + '/', 'Открыть CRM →', 'Рейтинг закреплён на 7 дней', 'crm') +
      '</td></tr>' +
      '<tr><td style="padding:16px 30px 28px;">' +
        '<p style="color:' + T3 + ';font-size:11.5px;line-height:1.6;margin:0;text-align:center;">' +
          'Публично показан только ТОП-10. Полный рейтинг и зоны развития — у руководства.</p>' +
      '</td></tr>' +
      footer()
    );
  }

  // ── 3b. личное письмо: сотрудник вошёл в Ядро ───────────────────────────
  function inCore() {
    return card(
      header('Рейтинг опубликован'),
      'border-color:rgba(232,195,90,0.55);box-shadow:0 0 40px rgba(207,181,59,0.18);' +
    '' +
      '<tr><td style="padding:34px 30px 0;text-align:center;">' +
        '<div style="margin-bottom:14px;">' + rune('★', 46) + '</div>' +
        '<div style="color:' + GOLD + ';font-size:12px;font-weight:800;letter-spacing:2.4px;text-transform:uppercase;">Вы в Ядре Дружины АСГАРД</div>' +
        '<h2 style="color:#EDEDF2;font-size:24px;margin:12px 0 8px;">Екатерина, Дружина назвала вас в ТОП-10</h2>' +
        p('Это признание коллег — реального вклада, а не должности. Спасибо за то, что держите планку.', 'max-width:420px;margin:0 auto 14px;') +
      '</td></tr>' +
      '<tr><td style="padding:6px 30px 0;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
          '<tr>' + metricCard('место', '10', GOLD) + metricCard('баллов', '51', GOLD) + metricCard('голосов', '9', GOLD) + '</tr>' +
        '</table>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 30px 0;">' +
        '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(207,181,59,0.22);border-radius:12px;padding:14px 18px;">' +
          '<p style="color:' + T3 + ';font-size:10.5px;text-transform:uppercase;letter-spacing:1.2px;margin:0 0 6px;text-align:center;">Ваше место в Ядре</p>' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + topCore(10) + '</table>' +
        '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 30px 28px;">' + cta(T.META.crmUrl + '/', 'Открыть CRM →', 'Виджет закреплён на неделю', 'crm') + '</td></tr>' +
      footer()
    );
  }

  // ── письма-поздравления 1/2/3 места ─────────────────────────────────────
  function podium(place) {
    var m = MEDALS[place];
    var e = T.core()[place - 1];
    var copy = {
      1: ['Вы на вершине Тинга', 'Дружина назвала вас самым незаменимым сотрудником АСГАРД. Это высшее признание команды — вклад, который видят все.'],
      2: ['Второе место Тинга', 'Дружина поставила вас на второе место. Ваш вклад — опора компании, и команда это подтвердила.'],
      3: ['Третье место Тинга', 'Дружина назвала вас в тройке сильнейших. Ваша работа — одна из опор АСГАРД.']
    }[place];

    return card(
      '<tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:34px 30px 26px;text-align:center;border-bottom:2px solid rgba(207,181,59,0.45);">' +
        '<div style="margin-bottom:16px;"><span style="display:inline-grid;place-items:center;width:96px;height:96px;border-radius:28px;' +
          'background:' + m.grad + ';box-shadow:0 12px 40px rgba(0,0,0,.5);font-size:52px;line-height:1;">' + m.mark + '</span></div>' +
        '<div style="color:' + GOLD + ';font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;">' + m.label + '</div>' +
        '<div style="color:rgba(255,255,255,0.45);font-size:12px;letter-spacing:1.4px;margin-top:6px;">РЕЙТИНГ ТОП-10 ДРУЖИНЫ АСГАРД</div>' +
      '</td></tr>' +
      '<tr><td style="padding:32px 30px 0;text-align:center;">' +
        '<h2 style="color:#EDEDF2;font-size:24px;margin:0 0 12px;">' + copy[0] + '</h2>' +
        '<p style="color:' + T2 + ';font-size:14px;line-height:1.65;margin:0 auto 6px;max-width:440px;">' + copy[1] + '</p>' +
      '</td></tr>' +
      '<tr><td style="padding:18px 30px 0;">' +
        '<div style="background:rgba(255,255,255,0.03);border:1px solid ' + m.ring + '55;border-radius:14px;padding:22px;text-align:center;">' +
          '<div style="color:' + T3 + ';font-size:11px;text-transform:uppercase;letter-spacing:1.4px;">' + esc(e.fio) + '</div>' +
          '<div style="color:' + T3 + ';font-size:12px;margin-top:4px;">' + esc(e.role) + ' · ' + esc(e.dept) + '</div>' +
          '<div style="color:#EDEDF2;font-size:44px;font-weight:900;letter-spacing:-1px;margin:12px 0 2px;font-family:monospace;">' + e.points + '</div>' +
          '<div style="color:' + T3 + ';font-size:11.5px;letter-spacing:.4px;">баллов · <b style="color:' + GOLD + '">' + e.firsts + '</b> первых мест</div>' +
        '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 30px 0;text-align:center;">' +
        '<span style="display:inline-block;background:rgba(207,181,59,0.1);border:1px solid rgba(207,181,59,0.3);border-radius:999px;' +
        'padding:8px 18px;color:' + GOLD + ';font-size:12.5px;font-weight:700;">⚔ Ядро Дружины АСГАРД · ' + place + ' место</span>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 30px 0;">' + cta(T.META.crmUrl + '/', 'Открыть рейтинг в CRM →', 'Виджет на главной закреплён на неделю', 'crm') + '</td></tr>' +
      '<tr><td style="padding:20px 30px 28px;">' +
        quote('Сила Дружины — в тех, на кого можно опереться в любую бурю.') +
      '</td></tr>' +
      footer()
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  var EMAILS = [
    {
      id: 'invite', label: 'Приглашение на Тинг', render: invite,
      from: { name: 'АСГАРД CRM', email: 'crm@asgard-service.com', initials: 'АС' },
      subject: '⚔️ Тинг Асгарда: определи ТОП-10 Дружины',
      preview: 'Приветствуем, Роман! Дружина собирается на Тинг Асгарда — анонимный опрос…',
      when: 'сегодня, 09:05', unread: true, tag: 'Тинг'
    },
    {
      id: 'reminder', label: 'Напоминание (не прошёл)', render: reminder,
      from: { name: 'АСГАРД CRM', email: 'crm@asgard-service.com', initials: 'АС' },
      subject: '⏳ Тинг закрывается: ваш голос ещё не учтён',
      preview: 'Вы ещё не прошли Тинг. Мы не видим, кого вы выбираете, — и не увидим…',
      when: 'вчера, 16:20', unread: true, tag: 'Тинг'
    },
    {
      id: 'published', label: 'Рейтинг опубликован (всем)', render: published,
      from: { name: 'АСГАРД CRM', email: 'crm@asgard-service.com', initials: 'АС' },
      subject: '🏆 Ядро Дружины АСГАРД определёно — рейтинг опубликован',
      preview: 'Ядро Дружины АСГАРД определёно. На главной CRM закреплён ваш виджет…',
      when: 'пн, 12:00', unread: true, tag: 'Тинг'
    },
    {
      id: 'incore', label: 'Личное — вы в Ядре', render: inCore,
      from: { name: 'АСГАРД CRM', email: 'crm@asgard-service.com', initials: 'АС' },
      subject: '⭐ Вы в Ядре Дружины АСГАРД',
      preview: 'Екатерина, Дружина назвала вас в ТОП-10. Это признание коллег — реального вклада…',
      when: 'пн, 12:01', unread: true, tag: 'Тинг'
    },
    {
      id: 'rank1', label: 'Поздравление · 1 место', render: function () { return podium(1); },
      from: { name: 'АСГАРД CRM', email: 'crm@asgard-service.com', initials: 'АС' },
      subject: '🥇 Вы — №1 Тинга Асгарда. Ядро Дружины АСГАРД',
      preview: 'Дружина назвала вас самым незаменимым сотрудником АСГАРД…',
      when: 'пн, 12:01', unread: true, tag: 'Тинг'
    },
    {
      id: 'rank2', label: 'Поздравление · 2 место', render: function () { return podium(2); },
      from: { name: 'АСГАРД CRM', email: 'crm@asgard-service.com', initials: 'АС' },
      subject: '🥈 Второе место Тинга Асгарда. Ядро Дружины АСГАРД',
      preview: 'Дружина поставила вас на второе место. Ваш вклад — опора компании…',
      when: 'пн, 12:01', unread: true, tag: 'Тинг'
    },
    {
      id: 'rank3', label: 'Поздравление · 3 место', render: function () { return podium(3); },
      from: { name: 'АСГАРД CRM', email: 'crm@asgard-service.com', initials: 'АС' },
      subject: '🥉 Третье место Тинга Асгарда. Ядро Дружины АСГАРД',
      preview: 'Дружина назвала вас в тройке сильнейших. Ваша работа — одна из опор АСГАРД…',
      when: 'пн, 12:01', unread: true, tag: 'Тинг' }
  ];

  w.TING_EMAILS = EMAILS;
})(window);
