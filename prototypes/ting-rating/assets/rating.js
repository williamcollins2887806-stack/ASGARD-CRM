/* ═══════════════════════════════════════════════════════════════════════════
   ASGARD · прототип — результат Тинга: виджет в CRM (на 1 неделю)
   и управленческий отчёт руководству.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';
  var T = w.TING;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ava(fio, id, size) {
    var s = size || 36;
    return '<span class="tr-ava tr-ava--t' + T.tone(id) + '" style="width:' + s + 'px;height:' + s +
      'px;border-radius:' + Math.round(s * 0.29) + 'px;font-size:' + Math.round(s * 0.34) + 'px;">' + T.initials(fio) + '</span>';
  }
  function medal(rankBody) {
    return '<span class="tr-medal tr-medal--' + rankBody + '">' + rankBody + '</span>';
  }

  function coreRow(e, i) {
    var cls = i === 0 ? '1' : i === 1 ? '2' : i === 2 ? '3' : 'core';
    return '<div class="crm-core-row">' +
      '<span class="tr-medal tr-medal--' + cls + '">' + (i + 1) + '</span>' +
      ava(e.fio, e.id, 30) +
      '<span class="crm-core-name"><b>' + esc(e.fio) + '</b><i>' + esc(e.role) + '</i></span>' +
      '<span class="crm-core-pts tnum">' + e.points + '</span>' +
      '</div>';
  }

  // ── Виджет-баннер (главная CRM, закреплён на неделю) ────────────────────
  function renderBanner(el, variant) {
    var CORE = T.core();
    var me = T.byId['e-tihonov'];                         // «Тихонов» — 11 место
    var meRank = T.rankById['e-tihonov'];
    var inCore = variant === 'core';
    var meCore = T.byId['e-morozova'];                    // «Морозова» — 10 место
    var meCoreRank = T.rankById['e-morozova'];

    var myRank = inCore ? meCoreRank : meRank;
    var myName = inCore ? meCore : me;
    var toNext = 0;
    if (!inCore) toNext = CORE[9].points - meRank.points;                 // до Ядра
    var toNextPos = 0;
    if (inCore && meCoreRank.rank > 1) toNextPos = T.rankById[CORE[meCoreRank.rank - 2].id].points - meCoreRank.points + 1;
    else if (!inCore) toNextPos = 0;

    el.innerHTML = '' +
      '<div class="crm-shell' + (inCore ? ' is-core' : '') + '">' +
        '<div class="crm-top">' +
          '<div class="crm-top__brand"><span class="crm-mark">⚔</span> АСГАРД CRM</div>' +
          '<div class="crm-top__tabs"><span>Дашборд</span><span>Тендеры</span><span>Работы</span><span>Персонал</span></div>' +
          '<div class="crm-top__user"><span class="crm-top__bell">🔔</span>' + ava(myName.fio, myName.id, 30) + '</div>' +
        '</div>' +
        '<div class="crm-content">' +
          '<div class="crm-hello">' +
            '<h2>Добрый день, ' + esc(myName.fio.split(' ')[1]) + '!</h2>' +
            '<p class="tr-muted">Рейтинг Тинга Асгарда закреплён на главной на 7 дней — до пн, 19 октября.</p>' +
          '</div>' +

          '<div class="crm-banner' + (inCore ? ' crm-banner--core' : '') + '">' +
            '<button class="crm-banner__close" title="Свернуть виджет">✕</button>' +
            '<div class="crm-banner__left">' +
              '<div class="crm-banner__eyebrow">⚔ Тинг Асгарда · итоги</div>' +
              (inCore
                ? '<div class="crm-banner__headline crm-banner__headline--gold">Вы в Ядре Дружины АСГАРД</div>' +
                  '<div class="crm-banner__sub">' + myRank.rank + ' место из ' + T.META.total + ' · ' + myRank.points + ' баллов</div>'
                : '<div class="crm-banner__headline">Ваша позиция — ' + myRank.rank + ' из ' + T.META.total + '</div>' +
                  '<div class="crm-banner__sub">До Ядра — <b>' + toNext + '</b> баллов</div>') +
              '<div class="crm-banner__chips">' +
                (inCore
                  ? '<span class="tr-chip tr-chip--gold">★ в ТОП-10 · ' + myRank.rank + ' место</span><span class="tr-chip">' + myRank.points + ' баллов</span>'
                  : '<span class="tr-chip tr-chip--red">до Ядра: ' + toNext + ' б.</span><span class="tr-chip tr-chip--blue">следующая ступень: ' + esc(T.byId[CORE[9].id].fio.split(' ')[0]) + '</span>') +
              '</div>' +
            '</div>' +
            '<div class="crm-banner__right">' +
              '<div class="crm-banner__ring' + (inCore ? ' is-gold' : '') + '">' +
                '<div class="crm-banner__ring-num">' + myRank.rank + '</div>' +
                '<div class="crm-banner__ring-lbl">место</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="crm-cols">' +
            '<div class="tr-card crm-core tr-card--gold">' +
              '<div class="crm-core__head">' +
                '<span class="tr-eyebrow">Ядро Дружины АСГАРД · публичный ТОП-10</span>' +
                '<span class="tr-chip tr-chip--ok">опубликовано</span>' +
              '</div>' +
              '<div class="crm-core__list">' + CORE.map(coreRow).join('') + '</div>' +
              '<div class="crm-core__foot">Нижняя часть рейтинга публично не показывается.</div>' +
            '</div>' +

            '<div class="crm-side">' +
              '<div class="tr-card crm-stat"><div class="tr-eyebrow">Явка</div>' +
                '<div class="crm-stat__val tnum">' + T.META.votes + '<span>/' + T.META.total + '</span></div>' +
                '<div class="tr-prog tr-prog--blue"><i style="width:' + Math.round(T.META.votes / T.META.total * 100) + '%"></i></div>' +
                '<div class="tr-dim" style="font-size:11.5px;margin-top:8px;">Проголосовало сотрудников</div>' +
              '</div>' +
              '<div class="tr-card crm-stat"><div class="tr-eyebrow">Максимум баллов</div>' +
                '<div class="crm-stat__val tnum">' + CORE[0].points + '<span>/180</span></div>' +
                '<div class="tr-dim" style="font-size:11.5px;margin-top:8px;">у ' + esc(CORE[0].fio.split(' ')[0]) + ' — ' + CORE[0].firsts + ' первых мест</div>' +
              '</div>' +
              '<div class="tr-card crm-tip"><b>Как читать рейтинг</b><p>1 место = 10 баллов, 10 место = 1 балл. При равенстве учитываются первые, затем вторые места.</p></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── Управленческий отчёт ────────────────────────────────────────────────
  function renderReport(el) {
    var R = T.RANKING.map(function (r) {
      return Object.assign({}, T.byId[r.id], { rank: r.rank, points: r.points, firsts: r.firsts });
    });
    var rankRow = function (e) {
      var cls = e.rank === 1 ? '1' : e.rank === 2 ? '2' : e.rank === 3 ? '3' : (e.rank <= 10 ? 'core' : '');
      var zone = e.rank <= 10 ? ['is-core', 'ядро'] : (e.rank <= 15 ? ['is-mid', 'середина'] : ['is-risk', 'внимание']);
      var barPct = Math.round(e.points / R[0].points * 100);
      return '<tr class="' + zone[0] + '">' +
        '<td class="rep-rank"><span class="tr-medal' + (cls ? ' tr-medal--' + cls : '') + '">' + e.rank + '</span></td>' +
        '<td><div class="rep-name"><b>' + esc(e.fio) + '</b><span>' + esc(e.role) + ' · ' + esc(e.dept) + '</span></div></td>' +
        '<td class="rep-pts tnum"><b>' + e.points + '</b><div class="rep-bar"><i style="width:' + barPct + '%"></i></div></td>' +
        '<td class="tnum rep-c">' + e.firsts + '</td>' +
        '<td class="tnum rep-c">' + Math.max(0, Math.round(e.points / 7)) + '</td>' +
        '<td><span class="rep-zone rep-zone--' + zone[0].slice(3) + '">' + zone[1] + '</span></td>' +
        '</tr>';
    };

    var hidden = R.filter(function (e) { return e.rank <= 10 && /инженер|мастер|сварщик|слесарь|диспетчер|специалист|программист/i.test(e.role); }).slice(0, 3);
    var risk = R.filter(function (e) { return e.rank > 10 && /начальник|руководитель|директор|главн/i.test(e.role); });
    var outside = R.filter(function (e) { return e.rank > 10; });

    var rec = [
      ['Жуков Р. А.', '1', 'Удержание: пересмотреть зону ответственности и уровень. Кандидат в наставники Ядра.'],
      ['Новиков Д. И.', '2', 'Развитие: масштабировать автоматизацию на смежные процессы. Премия за вклад.'],
      ['Белова М. А.', '3', 'Удержание: ведущий специалист по тендерам. Обучение на старшего сметчика.'],
      ['Тихонов В. О.', '11', 'Точка роста: 6 баллов до Ядра. ИПР на квартал, наставник из ТОП-10.'],
      ['Дементьева О. Н.', '12', 'Развитие: видимость вклада перед командой, участие в общих проектах.'],
      ['Абрамов Н. И.', '20', 'Внимание: пересмотр зон ответственности, план адаптации и наставник.']
    ].map(function (r) {
      return '<tr><td><b>' + r[0] + '</b></td><td class="tnum">' + r[1] + '</td><td>' + r[2] + '</td></tr>';
    }).join('');

    el.innerHTML = '' +
      '<div class="rep">' +
        '<div class="rep-head">' +
          '<div>' +
            '<div class="tr-eyebrow">Управленческий отчёт · только руководство</div>' +
            '<h1 class="tr-h1" style="margin-top:6px;">Итоги Тинга Асгарда</h1>' +
            '<p class="tr-muted" style="margin:8px 0 0;">Полный рейтинг Дружины АСГАРД · закрыт ' + T.META.deadline + ' · явка ' +
              T.META.votes + '/' + T.META.total + '</p>' +
          '</div>' +
          '<div class="rep-head__actions">' +
            '<button class="tr-btn tr-btn--ghost">⤓ Экспорт в Excel</button>' +
            '<button class="tr-btn tr-btn--primary">Отправить наставникам</button>' +
          '</div>' +
        '</div>' +

        '<div class="rep-kpis">' +
          kpi('Явка', T.META.votes + '/' + T.META.total, '2 не прошли', 'var(--blue-l)') +
          kpi('Ядро (ТОП-10)', '10', 'порог ' + R[9].points + ' баллов', 'var(--gold)') +
          kpi('Скрытых лидеров', String(hidden.length), 'в ТОП-10 без руководящей должности', 'var(--ok-t)') +
          kpi('Зона риска', String(risk.length), 'должность без подтверждения вклада', 'var(--red-l)') +
        '</div>' +

        '<div class="tr-card rep-block">' +
          '<div class="rep-block__head"><h2 class="tr-h2">Полный рейтинг · 20 мест</h2>' +
            '<div class="rep-legend"><span class="rep-zone rep-zone--core">ядро</span><span class="rep-zone rep-zone--mid">середина</span><span class="rep-zone rep-zone--risk">внимание</span></div>' +
          '</div>' +
          '<div class="rep-tablewrap"><table class="rep-table">' +
            '<thead><tr><th>#</th><th>Сотрудник</th><th>Баллы</th><th class="rep-c">1-х мест</th><th class="rep-c">голосов</th><th>Зона</th></tr></thead>' +
            '<tbody>' + R.map(rankRow).join('') + '</tbody>' +
          '</table></div>' +
        '</div>' +

        '<div class="rep-grid">' +
          '<div class="tr-card rep-block">' +
            '<h2 class="tr-h2">Скрытые лидеры</h2>' +
            '<p class="tr-dim" style="font-size:12px;margin:6px 0 12px;">Высоко в рейтинге, но не на руководящей должности — на кого Дружина опирается по факту.</p>' +
            hidden.map(function (e) {
              return '<div class="rep-mini">' + ava(e.fio, e.id, 34) +
                '<div class="rep-mini__b"><b>' + esc(e.fio) + '</b><span>' + esc(e.role) + '</span></div>' +
                '<div class="rep-mini__r"><b>' + e.rank + '</b><span>место</span></div></div>';
            }).join('') +
          '</div>' +

          '<div class="tr-card rep-block rep-block--risk">' +
            '<h2 class="tr-h2">Зона риска</h2>' +
            '<p class="tr-dim" style="font-size:12px;margin:6px 0 12px;">Занимает должность, но не подтверждает её реальным вкладом в глазах команды.</p>' +
            risk.map(function (e) {
              return '<div class="rep-mini rep-mini--risk">' + ava(e.fio, e.id, 34) +
                '<div class="rep-mini__b"><b>' + esc(e.fio) + '</b><span>' + esc(e.role) + '</span></div>' +
                '<div class="rep-mini__r"><b>' + e.rank + '</b><span>место</span></div></div>';
            }).join('') +
          '</div>' +
        '</div>' +

        '<div class="tr-card rep-block">' +
          '<h2 class="tr-h2">Вне Ядра · зона управленческого внимания</h2>' +
          '<p class="tr-dim" style="font-size:12px;margin:6px 0 12px;">Не «список на увольнение». Опублично не показывается — работаем точечно.</p>' +
          '<div class="rep-outside">' + outside.map(function (e) {
            return '<div class="rep-out-chip"><span class="tnum">' + e.rank + '</span>' + esc(e.fio) + '</div>';
          }).join('') + '</div>' +
        '</div>' +

        '<div class="tr-card rep-block">' +
          '<h2 class="tr-h2">Рекомендации: развитие · наставник · ИПР · удержание</h2>' +
          '<div class="rep-tablewrap"><table class="rep-table rep-table--rec">' +
            '<thead><tr><th>Сотрудник</th><th>Место</th><th>Рекомендация</th></tr></thead>' +
            '<tbody>' + rec + '</tbody>' +
          '</table></div>' +
        '</div>' +

        '<div class="rep-foot tr-dim">Отчёт внутренний. Не использовать рейтинг как единственное основание для кадровых решений или премирования.</div>' +
      '</div>';
  }

  function kpi(label, val, sub, color) {
    return '<div class="tr-card rep-kpi"><div class="rep-kpi__l">' + label + '</div>' +
      '<div class="rep-kpi__v tnum" style="color:' + color + '">' + val + '</div>' +
      '<div class="rep-kpi__s">' + sub + '</div></div>';
  }

  w.TING_RATING = { renderBanner: renderBanner, renderReport: renderReport };
})(window);
