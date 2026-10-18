/* ASGARD CRM — прототип графика отпусков: роутер экранов + интерактив. */
(function () {
  'use strict';
  var D = window.VS_DATA, V = window.VS_VIEWS, S = V.S, esc = V.esc;

  var SCREENS = {
    'me':       { nav: 'Сотрудник · Мои дни',        role: 'me',       render: function () { return V.scheduleScreen(); } },
    'director': { nav: 'Директор · Согласование',    role: 'director', render: function () { return V.scheduleScreen(); } },
    'buh':      { nav: 'Бухгалтерия · Настройка дней', role: 'buh',    render: function () { return V.buhScreen(); } },
    'docs':     { nav: 'Документы отпуска',          render: function () { return V.docsScreen(); } },
    'office':   { nav: 'График офиса · наложение',   render: function () { return V.officeScreen(); } },
    'mail-dir': { nav: 'Письмо директору',           render: function () { return V.mailDirectorScreen(); } },
    'mail-ok':  { nav: 'Письмо сотруднику · согласовано', render: function () { return V.mailEmployeeScreen('ok'); } },
    'mail-no':  { nav: 'Письмо сотруднику · не согласовано', render: function () { return V.mailEmployeeScreen('no'); } },
    'mail-auto':{ nav: 'Письмо сотруднику · автоснятие', render: function () { return V.mailEmployeeScreen('auto'); } }
  };

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }

  function render() {
    var hash = (location.hash || '#me').slice(1);
    var view = SCREENS[hash] ? hash : 'me';
    var sc = SCREENS[view];
    if (sc.role) S.role = sc.role;

    var host = $('#viewHost');
    host.innerHTML = sc.render();
    $('#crumb').innerHTML = sc.nav + '<small>прототип · график отпусков офиса</small>';
    document.body.className = 'view-' + view;
    $$('.side__item[data-nav]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-nav') === view); });
    $('#vsCartN').textContent = V.pendingAll().length;
    window.scrollTo(0, 0);
    closeModal();
    bindDocInputs();
  }

  function closeModal() { $$('.vsp-ov, .vs-ov').forEach(function (o) { o.remove(); }); }

  /** Снять «rejected»-период, который сотрудник заменяет новым. */
  function absorbRejected(start, end) {
    var list = D.VAC[D.me.id] || [];
    D.VAC[D.me.id] = list.filter(function (r) {
      if (r.status !== 'rejected') return true;
      return (end < r.start || start > r.end);
    });
  }

  /* ═══ Действия ═══════════════════════════════════════════════════════ */
  function toggleMonth(m) {
    m = +m;
    if (S.expansion && S.openMonth === m) { S.expansion = false; S.openMonth = null; }
    else {
      S.expansion = true; S.openMonth = m;
      if (S.role === 'me') S.cal = { y: S.year, m: m };
    }
    S.sel = {}; S.rangeStart = null; S.editingId = null;
    render();
  }

  function toggleDay(iso, empId) {
    if (S.role !== 'me' || S.closed) return;
    if (empId !== D.me.id) { V.toast('Это чужие дни', 'Править можно только свои дни', 'warn'); return; }
    if (S.sel[iso]) delete S.sel[iso]; else S.sel[iso] = true;
    render();
  }

  function clearSel() { S.sel = {}; S.editingId = null; S.rangeStart = null; render(); }

  function savePeriod() {
    var days = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).sort();
    if (!days.length) return;
    var start = days[0], end = days[days.length - 1];
    var v = D.validate(D.me.id, start, end, { ignoreId: S.editingId, blocked: D.blockedDays() });
    if (!v.ok) { V.toast('Нельзя поставить', v.msg, 'err'); return; }

    absorbRejected(start, end);

    var list = D.VAC[D.me.id];
    if (S.editingId) {
      var r = list.filter(function (x) { return x.id === S.editingId; })[0];
      if (r) {
        r.start = start; r.end = end; r.days = v.days; r.calDays = v.calDays; r.hol = v.hol;
        r.status = 'pending'; r.submitted_at = 'сегодня'; r.approves = [];
      }
      V.toast('Правка сохранена', D.fmtRange(start, end) + ' · снова на согласование', 'ok');
    } else {
      list.push({
        id: 'R' + Math.floor(9000 + Math.random() * 900), start: start, end: end,
        days: v.days, calDays: v.calDays, hol: v.hol, status: 'pending', submitted_at: 'сегодня', approves: []
      });
      V.toast('Отпуск поставлен', D.fmtRange(start, end) + ' · ' + V.daysWord(v.days) + ' · на согласование', 'ok');
    }
    S.sel = {}; S.editingId = null;
    render();
  }

  function submitAll() {
    var n = 0;
    D.rangesOf(D.me.id).forEach(function (r) { if (r.status === 'draft') { r.status = 'pending'; n++; } });
    S.notifySent = true;
    S.note = { type: 'ok', msg: 'График отправлен на согласование. Директора увидят его в очереди; за ' + D.RULES.noticeDays + ' дней до каждого отпуска придёт письмо с кнопками «Да / Нет», напоминания — раз в сутки.' };
    V.toast('Готово и согласовать', 'Отправлено директорам' + (n ? ' · ' + n + ' ' + V.plural(n, 'период', 'периода', 'периодов') : ''), 'ok');
    render();
  }

  function approveAllPending() {
    var n = 0;
    V.pendingAll().forEach(function (x) {
      x.r.approves = D.DIRECTORS.map(function (d) { return d.id; });
      x.r.status = 'approved'; n++;
    });
    V.toast('Согласовано', n + ' ' + V.plural(n, 'период', 'периода', 'периодов') + ' подтверждено всеми директорами', 'ok');
    S.note = { type: 'ok', msg: 'Все отправленные периоды согласованы. Уведомления сотрудникам и формы заявлений отправлены — можно закрывать график.' };
    render();
  }

  function closeSchedule() {
    S.closed = true;
    V.toast('График закрыт', 'Редактирование отключено у всех', 'warn');
    render();
  }

  function hidePerson(id) {
    S.hiddenPeople[id] = true;
    V.toast('Скрыт', D.byId(id).fio.split(' ')[0] + ' — строка скрыта', 'warn');
    render();
  }
  function unhidePerson(id) { delete S.hiddenPeople[id]; render(); }
  function hideGroup(k) { S.hiddenGroups[k] = true; render(); }
  function unhideGroup(k) { delete S.hiddenGroups[k]; render(); }
  function toggleDeptOnly() {
    S.deptOnly = !S.deptOnly;
    if (S.deptOnly) { S.hiddenGroups = {}; S.hiddenPeople = {}; }
    V.toast(S.deptOnly ? 'Только мой отдел' : 'Все отделы', S.deptOnly ? 'Показаны только сотрудники вашего отдела' : 'Строки всех отделов возвращены', 'ok');
    render();
  }
  function showAll() { S.hiddenGroups = {}; S.hiddenPeople = {}; S.deptOnly = false; V.toast('Показать всех', 'Все строки возвращены', 'ok'); render(); }

  /* ── Карточка сотрудника (взгляд директора) ──────────────────────────── */
  function openPersonCard(empId) {
    var e = D.byId(empId);
    var b = D.balance(empId);
    var rs = D.rangesOf(empId).slice().sort(function (a, c) { return a.start < c.start ? -1 : 1; });
    var lines = rs.length ? rs.map(function (r) {
      var st = D.ST[r.status];
      var isPend = r.status === 'pending';
      var pr = D.approveProgress(r);
      var votes = D.DIRECTORS.map(function (d) {
        var yes = D.approvesOf(r).indexOf(d.id) >= 0;
        return '<span class="vs-vote' + (yes ? ' is-yes' : '') + '" title="' + esc(d.fio) + ' — ' + (yes ? 'согласовал' : 'ждём') + '">' +
          V.initials(d.fio) + '</span>';
      }).join('');
      var clashes = D.clashesWith(empId, r.start, r.end);
      return '' +
        '<div class="vs-pc-line" data-stop>' +
          '<div class="vs-pc-line__t">' + esc(D.fmtRange(r.start, r.end)) +
            ' <span class="vs-chip ' + st.cls + '">' + st.label + '</span>' +
            '<span class="vs-pc-line__d">' + V.daysWord(r.days) + (r.hol ? ' +' + r.hol + ' празд.' : '') + '</span>' +
            (r.days >= 14 ? '<span class="badge gold">основной</span>' : '') +
          '</div>' +
          (isPend ? '<div class="vs-pc-line__voteline"><span>Согласовали ' + pr.done + ' из ' + pr.total + '</span>' + votes + '</div>' : '') +
          (clashes.length ? '<div class="vs-pc-line__clash">' + V.ic('warn') + 'Пересечение: ' +
            clashes.map(function (c) { return esc(c.fio.split(' ')[0]) + ' · ' + c.overlapDays + ' дн.'; }).join(', ') + '</div>' : '') +
          (r.reason ? '<div class="vs-pc-line__r">' + V.ic('doc') + 'причина: ' + esc(r.reason) + ' <span class="dim">· ' + esc(r.decided_by || 'директор') + '</span></div>' : '') +
          (isPend ? '<div class="vs-pc-line__acts">' +
            '<button class="btn ok sm" data-vs-decide="' + empId + '|' + r.id + '|approve">' + V.ic('check') + 'Согласовать</button>' +
            '<button class="btn danger sm" data-vs-decide="' + empId + '|' + r.id + '|reject">' + V.ic('x') + 'Не согласовать</button>' +
          '</div>' : '') +
        '</div>';
    }).join('') : '<div class="empty-state"><div class="icon">🌴</div><div class="title">Отпусков нет</div></div>';

    var ov = document.createElement('div');
    ov.className = 'vsp-ov';
    ov.setAttribute('data-vs-close', '1');
    ov.innerHTML = '' +
      '<div class="vsp-sheet vs-pc" data-stop>' +
        '<div class="vs-pc__h">' +
          '<span class="vs-ava">' + V.initials(e.fio) + '</span>' +
          '<div><div class="vs-pc__n">' + esc(e.fio) + '</div><div class="vs-pc__r">' + esc(D.roleRu(e.role)) + ' · ' + esc(V.groupTitle(e.group)) + '</div></div>' +
          '<button class="vsp-x" data-vs-close="1">' + V.IC.x + '</button>' +
        '</div>' +
        '<div class="vs-pc__kpis">' +
          '<div class="vs-pc__k"><b class="num">' + b.availableOnJan1 + '</b><span>доступно на 01.01</span></div>' +
          '<div class="vs-pc__k"><b class="num">' + b.lastYearUnused + '</b><span>перенос ' + (S.year - 1) + '</span></div>' +
          '<div class="vs-pc__k"><b class="num">' + b.plannedTotal + '</b><span>запланировано</span></div>' +
          '<div class="vs-pc__k' + (b.left < 0 ? ' is-neg' : '') + '"><b class="num">' + b.left + '</b><span>остаток</span></div>' +
        '</div>' +
        '<div class="vs-pc__body">' + lines + '</div>' +
        (rs.some(function (r) { return r.status === 'pending'; })
          ? '<div class="vs-pc__foot"><button class="btn ok" data-vs-decide-all="' + empId + '">' + V.ic('check') + 'Согласовать все периоды сотрудника</button></div>'
          : '') +
      '</div>';
    document.body.appendChild(ov);
  }

  function decide(empId, periodId, action) {
    var list = D.VAC[empId] || [];
    var r = list.filter(function (x) { return x.id === periodId; })[0];
    if (!r) return;
    if (action === 'approve') {
      if (!r.approves) r.approves = [];
      if (r.approves.indexOf(D.ME_DIRECTOR) < 0) r.approves.push(D.ME_DIRECTOR);
      var left = D.directorsLeft(r);
      if (!left.length) {
        r.status = 'approved';
        V.toast('Согласовано всеми директорами', D.byId(empId).fio.split(' ')[0] + ' · ' + D.fmtRange(r.start, r.end) + ' · сотруднику ушло письмо', 'ok');
      } else {
        V.toast('Ваш голос учтён', 'Осталось ' + left.length + ': ' + left.map(function (d) { return d.fio.split(' ')[0]; }).join(', '), 'ok');
      }
      closeModal(); render(); return;
    }
    openRejectModal(empId, r);
  }

  /* ── Отклонение: комментарий ОБЯЗАТЕЛЕН ──────────────────────────────── */
  function openRejectModal(empId, r) {
    closeModal();
    var e = D.byId(empId);
    var ov = document.createElement('div');
    ov.className = 'vsp-ov';
    ov.innerHTML = '' +
      '<div class="vsp-sheet vs-reject" data-stop>' +
        '<div class="vsp-sheet__h"><span class="vsp-sheet__ic is-bad">' + V.IC.x + '</span><b>Не согласовать отпуск</b>' +
          '<button class="vsp-x" data-vs-close="1">' + V.IC.x + '</button></div>' +
        '<div class="vs-reject__who">' + esc(e.fio) + ' · ' + esc(D.fmtRange(r.start, r.end)) + ' · ' + V.daysWord(r.days) + '</div>' +
        '<label class="lbl">Комментарий сотруднику — <b class="vs-bad">обязательно</b></label>' +
        '<textarea class="input vs-reject__ta" id="vsRejectText" rows="3" placeholder="Почему не согласовано и когда лучше взять (например: «Сдача объекта 1–15 мая, возьми после 20-го»). Сотрудник увидит этот текст."></textarea>' +
        '<div class="vs-reject__hint">' + V.ic('warn') + 'Дни будут сняты: сотрудник получит уведомление и письмо, а система запомнит эти даты — поставить их повторно не даст.</div>' +
        '<div class="vs-reject__acts">' +
          '<button class="btn ghost" data-vs-close="1">Отмена</button>' +
          '<button class="btn danger" data-vs-reject-confirm="' + empId + '|' + r.id + '">' + V.ic('x') + 'Не согласовать и уведомить</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    setTimeout(function () { var t = $('#vsRejectText'); if (t) t.focus(); }, 40);
  }

  function confirmReject(empId, periodId) {
    var ta = $('#vsRejectText');
    var txt = (ta && ta.value || '').trim();
    if (!txt) {
      if (ta) { ta.classList.add('is-err'); ta.focus(); }
      V.toast('Нужен комментарий', 'Без причины отклонять нельзя — сотрудник должен понять, когда взять отпуск', 'err');
      return;
    }
    var list = D.VAC[empId] || [];
    var r = list.filter(function (x) { return x.id === periodId; })[0];
    if (r) {
      var days = D.expand(r.start, r.end);
      if (!S.blocked) S.blocked = {};
      days.forEach(function (d) { S.blocked[d] = true; });
      r.status = 'rejected'; r.reason = txt; r.decided_by = 'Кудряшов О.С.';
      D.REJECTED.push({ empId: empId, periodId: periodId, days: days, reason: txt, by: 'Кудряшов О.С.', byId: D.ME_DIRECTOR, at: 'сегодня' });
    }
    V.toast('Не согласовано', 'Сотруднику ушли уведомление и письмо с причиной', 'warn');
    closeModal(); render();
  }

  /* ── Почта ───────────────────────────────────────────────────────────── */
  function mailYes() {
    var rs = D.rangesOf(D.me.id);
    var r = rs.filter(function (x) { return x.status === 'pending'; })[0] || rs[rs.length - 1];
    if (r) { r.approves = D.DIRECTORS.map(function (d) { return d.id; }); r.status = 'approved'; }
    V.toast('Да, согласовать', 'Сотруднику ушло уведомление и форма заявления', 'ok');
    location.hash = '#mail-ok';
  }
  function mailNo() {
    var rs = D.rangesOf(D.me.id);
    var r = rs.filter(function (x) { return x.status === 'pending'; })[0] || rs[rs.length - 1];
    if (r) { r.status = 'rejected'; r.reason = 'На май выпадает сдача объекта по Северной башне — нужны все РП. Возьми отпуск после 20 мая.'; r.decided_by = 'Кудряшов О.С.'; }
    V.toast('Нет, снять', 'Отпуск снят, сотруднику отправлена причина', 'warn');
    location.hash = '#mail-no';
  }

  function saveBuh() {
    $$('[data-buh-avail]').forEach(function (inp) {
      var v = parseInt(inp.value, 10); if (!Number.isFinite(v)) v = 0;
      D.DAYS[inp.getAttribute('data-buh-avail')] = D.DAYS[inp.getAttribute('data-buh-avail')] || {};
      D.DAYS[inp.getAttribute('data-buh-avail')].availableOnJan1 = Math.max(0, Math.min(90, v));
    });
    $$('[data-buh-carry]').forEach(function (inp) {
      var v = parseInt(inp.value, 10); if (!Number.isFinite(v)) v = 0;
      D.DAYS[inp.getAttribute('data-buh-carry')] = D.DAYS[inp.getAttribute('data-buh-carry')] || {};
      D.DAYS[inp.getAttribute('data-buh-carry')].lastYearUnused = Math.max(0, Math.min(90, v));
    });
    V.toast('Сохранено', 'Количество дней обновлено — график пересчитан', 'ok');
    render();
  }

  function bindDocInputs() {
    $$('[data-buh-avail],[data-buh-carry]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var carry = inp.getAttribute('data-buh-carry');
        if (carry) {
          var v = parseInt(inp.value, 10) || 0;
          inp.classList.toggle('is-warn', v > 12);   // ст. 124 ТК: перенос не более 12 дней
        }
      });
    });
  }

  /* ═══ Делегирование клик ═══════════════════════════════════════════════ */
  var SEL = '[data-nav],[data-month],[data-month-nav],[data-day],[data-vs-clear],[data-vs-save],' +
    '[data-vs-submit],[data-vs-hide],[data-vs-unhide],[data-vs-hidegroup],[data-vs-unhidegroup],' +
    '[data-vs-dept-only],[data-vs-show-all],[data-vs-open],[data-vs-open-after],[data-vs-close],' +
    '[data-vs-close-modal-manual],[data-vs-close-graph],[data-vs-rules],[data-vs-rules-close],' +
    '[data-vs-approve-all],[data-period],[data-vs-decide],[data-vs-decide-all],[data-vs-reject-confirm],' +
    '[data-vs-mail-yes],[data-vs-mail-no],[data-vs-buh-save],[data-vs-why],[data-vs-blocked],' +
    '[data-theme-btn],[data-vs-docs],[data-vs-docs-back],[data-vs-doc-tab],[data-vs-doc-print],' +
    '[data-vs-doc-download],[data-vs-docs-open],[data-vs-look-comment]';

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest(SEL);
    if (!t) {
      if (ev.target.classList && (ev.target.classList.contains('vsp-ov') || ev.target.classList.contains('vs-ov'))) closeModal();
      return;
    }
    var a = function (k) { return t.hasAttribute(k) ? t.getAttribute(k) : null; };

    if (a('data-nav') !== null) { location.hash = '#' + a('data-nav'); return; }
    if (a('data-theme-btn')) { setTheme(a('data-theme-btn')); return; }
    if (t.hasAttribute('data-vs-close')) { closeModal(); return; }
    if (t.hasAttribute('data-vs-close-modal-manual')) { location.hash = '#office'; return; }
    if (t.hasAttribute('data-vs-close-graph')) { closeSchedule(); return; }
    if (t.hasAttribute('data-vs-approve-all')) { approveAllPending(); return; }

    if (a('data-month') !== null) { toggleMonth(a('data-month')); return; }
    if (a('data-month-nav') !== null) { toggleMonth(a('data-month-nav')); return; }
    if (a('data-day')) { toggleDay(a('data-day'), +a('data-emp')); return; }
    if (t.hasAttribute('data-vs-why')) { V.toast('Чужой период', 'Видно всем, правит только владелец', 'warn'); return; }
    if (t.hasAttribute('data-vs-blocked')) { V.toast('Эти дни недоступны', 'Директор не согласовал их — поставьте другие дни', 'err'); return; }
    if (t.hasAttribute('data-vs-clear')) { clearSel(); return; }
    if (t.hasAttribute('data-vs-save')) { savePeriod(); return; }
    if (t.hasAttribute('data-vs-submit')) { submitAll(); return; }
    if (a('data-vs-hide')) { hidePerson(+a('data-vs-hide')); return; }
    if (a('data-vs-unhide')) { unhidePerson(+a('data-vs-unhide')); return; }
    if (a('data-vs-hidegroup')) { hideGroup(a('data-vs-hidegroup')); return; }
    if (a('data-vs-unhidegroup')) { unhideGroup(a('data-vs-unhidegroup')); return; }
    if (t.hasAttribute('data-vs-dept-only')) { toggleDeptOnly(); return; }
    if (t.hasAttribute('data-vs-show-all')) { showAll(); return; }
    if (t.hasAttribute('data-vs-open')) { location.hash = '#me'; return; }
    if (t.hasAttribute('data-vs-open-after')) { S.note = { type: 'ok', msg: 'Откройте месяц и поставьте новые дни — прежние (снятые) недоступны, система их помнит.' }; location.hash = '#me'; return; }
    if (t.hasAttribute('data-vs-rules')) { S._rules = true; render(); return; }
    if (t.hasAttribute('data-vs-rules-close')) { S._rules = false; render(); return; }

    /* документы */
    if (t.hasAttribute('data-vs-docs')) { location.hash = '#docs'; return; }
    if (t.hasAttribute('data-vs-docs-back')) { location.hash = '#me'; return; }
    if (a('data-vs-docs-open')) { S.docsTab = a('data-vs-docs-open'); location.hash = '#docs'; return; }
    if (a('data-vs-doc-tab')) { S.docsTab = a('data-vs-doc-tab'); render(); return; }
    if (t.hasAttribute('data-vs-doc-print')) { window.print(); return; }
    if (t.hasAttribute('data-vs-doc-download')) { docDownload(); return; }
    if (t.hasAttribute('data-vs-look-comment')) { location.hash = '#mail-no'; return; }

    if (t.hasAttribute('data-period')) { openPersonCard(+a('data-emp') || D.me.id); return; }
    if (a('data-vs-decide')) {
      var p = a('data-vs-decide').split('|');
      decide(+p[0], p[1], p[2]); return;
    }
    if (a('data-vs-decide-all')) {
      var id = +a('data-vs-decide-all');
      D.rangesOf(id).forEach(function (r) {
        if (r.status === 'pending') { r.approves = D.DIRECTORS.map(function (d) { return d.id; }); r.status = 'approved'; }
      });
      V.toast('Согласовано', 'Все периоды сотрудника подтверждены', 'ok');
      closeModal(); render(); return;
    }
    if (a('data-vs-reject-confirm')) {
      var q = a('data-vs-reject-confirm').split('|');
      confirmReject(+q[0], q[1]); return;
    }
    if (t.hasAttribute('data-vs-mail-yes')) { mailYes(); return; }
    if (t.hasAttribute('data-vs-mail-no')) { mailNo(); return; }
    if (t.hasAttribute('data-vs-buh-save')) { saveBuh(); return; }
  });

  /** Скачивание документа: в прототипе — печать/сохранение как PDF; в проде — .docx по форме. */
  function docDownload() {
    var names = { zayav: 'Заявление_на_отпуск', prikaz: 'Приказ_Т-6_отпуск', t7: 'График_отпусков_Т-7' };
    V.toast('Скачивание', names[S.docsTab] + '.docx — в проде формируется по присланной форме. Сейчас откройте предпросмотр и сохраните в PDF.',
      S.docsTab === 't7' || S.docsTab === 'prikaz' ? 'ok' : 'ok');
  }

  /* ── Клик по ФИО директором ──────────────────────────────────────────── */
  document.addEventListener('click', function (ev) {
    if (S.role !== 'director') return;
    var w = ev.target.closest('.vs-who__n');
    if (!w) return;
    var row = w.closest('.vs-row'); if (!row) return;
    var nm = (w.textContent || '').trim();
    var found = D.ALL.filter(function (e) { return nm.indexOf(e.fio) === 0; })[0];
    if (found) openPersonCard(found.id);
  });

  /* ── Клавиатура по дням ──────────────────────────────────────────────── */
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var d = ev.target.closest && ev.target.closest('[data-day]');
    if (!d) return;
    ev.preventDefault();
    toggleDay(d.getAttribute('data-day'), +d.getAttribute('data-emp'));
  });

  /* ═══ Тема ═══════════════════════════════════════════════════════════ */
  function setTheme(th) {
    document.documentElement.setAttribute('data-theme', th);
    S.theme = th;
    try { localStorage.setItem('vs-theme', th); } catch (_) {}
    $$('[data-theme-btn]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-theme-btn') === th); });
  }

  window.addEventListener('hashchange', render);
  var savedTheme = 'dark';
  try { savedTheme = localStorage.getItem('vs-theme') || 'dark'; } catch (_) {}
  setTheme(savedTheme);
  if (!location.hash) location.hash = '#me';
  render();

  window.VS_APP = { setTheme: setTheme, render: render };
})();
