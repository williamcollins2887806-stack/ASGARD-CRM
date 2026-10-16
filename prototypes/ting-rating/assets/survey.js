/* ═══════════════════════════════════════════════════════════════════════════
   ASGARD · прототип — форма Тинга (опрос). Живая: выбор 10, порядок, поиск.
   Используется и в телефоне, и в веб-версии по ссылке.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';
  var T = w.TING;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function brand(sub) {
    return '<div style="display:flex;align-items:center;gap:12px;">' +
      '<span style="display:inline-grid;place-items:center;width:42px;height:42px;border-radius:13px;' +
      'background:linear-gradient(145deg,#cfb53b,#B8922E);color:#241B06;font-size:21px;font-weight:800;">⚔</span>' +
      '<div><div style="font-size:17px;font-weight:800;letter-spacing:1px;color:#EDEDF2;">Тинг Асгарда</div>' +
      '<div style="font-size:11px;color:var(--t3);letter-spacing:1.2px;text-transform:uppercase;">' + esc(sub) + '</div></div></div>';
  }

  function stateMsg(kind) {
    var cfg = {
      done: { icon: '✅', title: 'Спасибо! Ваш голос учтён', text: 'Токен погашен. Голос анонимный и пересмотру не подлежит. Итоги Дружина увидит после завершения Тинга.' },
      already: { icon: '🔒', title: 'Вы уже прошли Тинг', text: 'Токен одноразовый — повторное голосование невозможно. Результаты появятся в CRM после закрытия опроса.' },
      closed: { icon: '⏳', title: 'Тинг закрыт', text: 'Опрос завершён, последний голос получен. Итоги рейтинга ТОП-10 Дружины АСГАРД уже считаются.' }
    }[kind];
    return '<div style="text-align:center;padding:26px 6px 10px;">' +
      '<div style="font-size:44px;margin-bottom:10px;">' + cfg.icon + '</div>' +
      '<h2 style="color:#EDEDF2;font-size:21px;margin:0 0 10px;">' + cfg.title + '</h2>' +
      '<p style="color:var(--t2);font-size:13.5px;line-height:1.6;margin:0 auto;max-width:360px;">' + cfg.text + '</p>' +
      '<div style="margin-top:22px;"><a href="' + esc(T.META.crmUrl) + '/" data-goto="crm" class="tr-btn tr-btn--ghost">Открыть CRM →</a></div>' +
      '</div>';
  }

  function render(el, opts) {
    opts = opts || {};
    var mobile = !!opts.mobile;
    var state = opts.state || 'form';       // form | done | already | closed
    var picks = [];                          // [{id}] до 10
    var query = '';

    function placeOf(id) {
      for (var i = 0; i < picks.length; i++) if (picks[i].id === id) return i + 1;
      return 0;
    }

    function shell(inner) {
      return '<div class="' + (mobile ? '' : 'survey-page') + '">' + inner + '</div>';
    }

    function draw() {
      if (state !== 'form') { el.innerHTML = shell('<div class="tr-card" style="max-width:520px;margin:0 auto;padding:22px 22px 28px;">' + brand('опрос завершён') + stateMsg(state) + '</div>'); bind(); return; }

      var full = picks.length >= 10;
      var crew = T.CREW.filter(function (c) {
        if (!query) return true;
        var q = query.toLowerCase();
        return (c.fio + ' ' + c.role + ' ' + c.dept + ' ' + c.area).toLowerCase().indexOf(q) >= 0;
      });

      var listHtml = crew.map(function (c) {
        var place = placeOf(c.id);
        var tone = T.tone(c.id);
        return '<div class="sv-row' + (place ? ' is-picked' : '') + '">' +
          '<span class="tr-ava tr-ava--t' + tone + '">' + T.initials(c.fio) + '</span>' +
          '<div class="tr-row__body">' +
            '<div class="tr-row__name">' + esc(c.fio) + '</div>' +
            '<div class="tr-row__meta">' + esc(c.role) + ' · ' + esc(c.dept) + '</div>' +
            '<div class="tr-row__area">' + esc(c.area) + '</div>' +
          '</div>' +
          (place
            ? '<button class="sv-picknum" data-act="unpick" data-id="' + c.id + '" title="Убрать из рейтинга">' + place + ' <span style="opacity:.7">место</span> ×</button>'
            : '<button class="tr-btn tr-btn--ghost tr-btn--sm" data-act="pick" data-id="' + c.id + '"' + (full ? ' disabled' : '') + '>В рейтинг +</button>') +
          '</div>';
      }).join('') || '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px;">Никого не найдено</div>';

      var slots = '';
      for (var i = 1; i <= 10; i++) {
        var p = picks[i - 1];
        if (p) {
          var c = T.byId[p.id];
          var tone = T.tone(c.id);
          slots += '<div class="sv-slot is-filled" draggable="true" data-slot="' + i + '">' +
            '<span class="tr-medal tr-medal--' + (i <= 3 ? i : 'core') + '">' + i + '</span>' +
            '<span class="tr-ava tr-ava--t' + tone + '" style="width:28px;height:28px;border-radius:9px;font-size:10.5px;">' + T.initials(c.fio) + '</span>' +
            '<span class="sv-slot__name">' + esc(T.shortName(c.fio)) + '</span>' +
            '<span class="sv-slot__ctrls">' +
              '<button data-act="up" data-id="' + c.id + '" title="Выше"' + (i === 1 ? ' disabled' : '') + '>▲</button>' +
              '<button data-act="down" data-id="' + c.id + '" title="Ниже"' + (i === 10 || i === picks.length ? ' disabled' : '') + '>▼</button>' +
              '<button data-act="unpick" data-id="' + c.id + '" title="Убрать">✕</button>' +
            '</span>' +
          '</div>';
        } else {
          slots += '<div class="sv-slot is-empty" data-slot="' + i + '">' +
            '<span class="tr-medal' + (i <= 3 ? ' tr-medal--' + i : '') + '">' + i + '</span>' +
            '<span class="sv-slot__hint">выберите из списка слева</span>' +
          '</div>';
        }
      }

      var lead = T.LEADERSHIP.map(function (l) {
        return '<div class="sv-lockrow"><span class="sv-lock" title="Выбрать нельзя">🔒</span>' +
          '<span>' + esc(l.fio) + '</span><span class="tr-dim">· ' + esc(l.role) + '</span></div>';
      }).join('');

      el.innerHTML = shell(
        '<div class="sv-top">' + brand('рейтинг ТОП-10 · вопрос 1 из 1') +
          '<span class="tr-chip tr-chip--gold">🔒 анонимно</span>' +
        '</div>' +

        '<div class="sv-q tr-card">' +
          '<h1 class="sv-q__title">Сформируй рейтинг ТОП-10 Дружины АСГАРД</h1>' +
          '<p class="sv-q__lead">Расставь сотрудников по местам с 1-го по 10-е из общего списка Коллег. ' +
            '<b>1 место</b> — самый незаменимый и ценный для компании сотрудник, <b>10 место</b> — десятый по значимости. ' +
            'Нужно определить <b>ровно 10 человек</b> в порядке убывания.</p>' +
          '<p class="sv-q__lead" style="margin-bottom:0;">Учитывай результаты, знания и опыт, вклад в процессы, командное взаимодействие, надёжность, ответственность и верность Дружине АСГАРД. ' +
            '<b>Себя и руководство выбрать нельзя.</b> Голос анонимный, проголосовать можно один раз.</p>' +
        '</div>' +

        '<div class="sv-grid">' +
          '<div class="sv-col tr-card">' +
            '<div class="sv-col__head">' +
              '<span class="tr-eyebrow">Дружина · ' + T.CREW.length + ' человек</span>' +
              '<div class="sv-search"><span>🔎</span><input id="svQuery" placeholder="Поиск по ФИО, должности, отделу…" value="' + esc(query) + '"></div>' +
            '</div>' +
            '<div class="sv-list">' + listHtml + '</div>' +
            '<div class="sv-lead"><div class="tr-eyebrow" style="margin-bottom:8px;">Не участвуют в выборе</div>' + lead + '</div>' +
          '</div>' +

          '<div class="sv-col sv-col--side tr-card' + (full ? ' is-full' : '') + '">' +
            '<div class="sv-side__head">' +
              '<span class="tr-eyebrow">Ваш рейтинг</span>' +
              '<span class="sv-count">' + picks.length + '<span style="color:var(--t3)">/10</span></span>' +
            '</div>' +
            '<div class="tr-prog"><i style="width:' + (picks.length * 10) + '%"></i></div>' +
            '<div class="sv-slots">' + slots + '</div>' +
            '<div class="sv-side__foot">' +
              '<label class="sv-agree' + (full ? '' : ' is-off') + '"><input type="checkbox" id="svAgree"' + (full ? '' : ' disabled') + '>' +
                '<span>Я понимаю: голос анонимный и изменить его после отправки нельзя.</span></label>' +
              '<button class="tr-btn tr-btn--gold tr-btn--block tr-btn--lg" id="svSubmit" disabled>' +
                (full ? 'Отправить голос' : 'Выберите ещё ' + (10 - picks.length) + ' ' + plural(10 - picks.length)) +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="sv-footnote">Токен персональный и одноразовый · Себя и руководство выбрать нельзя · Ответы хранятся отдельно от персональных данных</div>'
      );
      bind();
    }

    function plural(n) {
      var n10 = n % 10, n100 = n % 100;
      if (n10 >= 2 && n10 <= 4 && !(n100 >= 12 && n100 <= 14)) return 'человека';
      return 'человек';
    }

    function syncSubmit() {
      var agree = el.querySelector('#svAgree');
      var btn = el.querySelector('#svSubmit');
      if (!btn) return;
      var ok = picks.length === 10 && agree && agree.checked;
      btn.disabled = !ok;
      btn.textContent = picks.length < 10 ? 'Выберите ещё ' + (10 - picks.length) + ' ' + plural(10 - picks.length) : 'Отправить голос';
    }

    function bind() {
      var q = el.querySelector('#svQuery');
      if (q) q.addEventListener('input', function () {
        query = q.value;
        var pos = q.selectionStart;
        draw();
        var nq = el.querySelector('#svQuery');
        if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) {} }
      });

      el.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
          if (act === 'pick') { if (picks.length < 10) picks.push({ id: id }); }
          else if (act === 'unpick') picks = picks.filter(function (p) { return p.id !== id; });
          else if (act === 'up' || act === 'down') {
            var i = picks.findIndex(function (p) { return p.id === id; });
            var j = act === 'up' ? i - 1 : i + 1;
            if (i >= 0 && j >= 0 && j < picks.length) { var t = picks[i]; picks[i] = picks[j]; picks[j] = t; }
          }
          draw();
        });
      });

      var ag = el.querySelector('#svAgree');
      if (ag) ag.addEventListener('change', syncSubmit);
      var sb = el.querySelector('#svSubmit');
      if (sb) sb.addEventListener('click', function () {
        if (picks.length !== 10 || !(ag && ag.checked)) return;
        state = 'done';
        if (opts.onDone) opts.onDone();
        draw();
      });
      syncSubmit();

      // drag&drop порядок (desktop)
      var dragId = null;
      el.querySelectorAll('.sv-slot.is-filled').forEach(function (s) {
        s.addEventListener('dragstart', function (e) {
          dragId = picks[parseInt(s.getAttribute('data-slot'), 10) - 1].id;
          e.dataTransfer.effectAllowed = 'move';
        });
        s.addEventListener('dragover', function (e) { e.preventDefault(); s.classList.add('is-over'); });
        s.addEventListener('dragleave', function () { s.classList.remove('is-over'); });
        s.addEventListener('drop', function (e) {
          e.preventDefault(); s.classList.remove('is-over');
          var targetIdx = parseInt(s.getAttribute('data-slot'), 10) - 1;
          var from = picks.findIndex(function (p) { return p.id === dragId; });
          if (from < 0 || targetIdx < 0) return;
          var moved = picks.splice(from, 1)[0];
          picks.splice(Math.min(targetIdx, picks.length), 0, moved);
          draw();
        });
      });
    }

    draw();
  }

  w.TING_SURVEY = { render: render, setState: null };
})(window);
