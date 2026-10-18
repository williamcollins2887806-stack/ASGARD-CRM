/* ASGARD CRM — прототип графика отпусков: роутер экранов + интерактив. */
(function () {
  'use strict';
  var D = window.VS_DATA, V = window.VS_VIEWS, S = V.S, esc = V.esc;

  var SCREENS = {
    'me':       { nav: 'Сотрудник · Мои дни',        role: 'me',       render: function () { return V.scheduleScreen(); } },
    'director': { nav: 'Директор · Согласование',    role: 'director', render: function () { return V.scheduleScreen(); } },
    'buh':      { nav: 'Бухгалтерия · Настройка дней', role: 'buh',    render: function () { return V.buhScreen(); } },
    'office':   { nav: 'График офиса · наложение',   render: function () { return V.officeScreen(); } },
    'mail-dir': { nav: 'Письмо директору',           render: function () { return V.mailDirectorScreen(); } },
    'mail-ok':  { nav: 'Письмо сотруднику · согласовано', render: function () { return V.mailEmployeeScreen('ok'); } },
    'mail-no':  { nav: 'Письмо сотруднику · не согласовано', render: function () { return V.mailEmployeeScreen('no'); } }
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
    $('#vsCartN').textContent = pendingCount();
    window.scrollTo(0, 0);
    closeModal();
  }

  function pendingCount() {
    var n = 0;
    D.ALL.forEach(function (e) {
      n += D.rangesOf(e.id).filter(function (r) { return r.status === 'pending'; }).length;
    });
    return n;
  }

  function closeModal() { $$('.vs-ov').forEach(function (o) { o.remove(); }); }

  /** Снять «rejected»-период, который сотрудник заменяет новым (система убрала не согласованный отпуск). */
  function absorbRejected(start, end) {
    var list = D.VAC[D.me.id] || [];
    D.VAC[D.me.id] = list.filter(function (r) {
      if (r.status !== 'rejected') return true;
      return (end < r.start || start > r.end);   // пересекается → убираем
    });
  }

  /* ═══ Действия ═══════════════════════════════════════════════════════ */
  function toggleMonth(m) {
    m = +m;
    if (S.expansion && S.openMonth === m) { S.expansion = false; S.openMonth = null; }
    else {
      S.expansion = true; S.openMonth = m;
      if (S.role === 'me') S.cal = { y: S.year, m: m };   // календарь идёт за раскрытым месяцем
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

    absorbRejected(start, end);   // система убирает не согласованный период, который сотрудник заменяет

    var list = D.VAC[D.me.id];
    if (S.editingId) {
      var r = list.filter(function (x) { return x.id === S.editingId; })[0];
      if (r) { r.start = start; r.end = end; r.days = v.days; r.status = 'pending'; r.submitted_at = 'сегодня'; }
      V.toast('Правка сохранена', D.fmtRange(start, end) + ' · снова на согласование', 'ok');
    } else {
      list.push({ id: 'R' + Math.floor(9000 + Math.random() * 900), start: start, end: end, days: v.days, status: 'pending', submitted_at: 'сегодня' });
      V.toast('Отпуск поставлен', D.fmtRange(start, end) + ' · ' + v.days + ' дн. · отправлено на согласование', 'ok');
    }
    S.sel = {}; S.editingId = null;
    render();
  }

  function submitAll() {
    var n = 0;
    D.rangesOf(D.me.id).forEach(function (r) { if (r.status === 'draft') { r.status = 'pending'; n++; } });
    S.notifySent = true;
    S.note = { type: 'ok', msg: 'График отправлен на согласование. Директора увидят его на своей странице; за ' + D.RULES.noticeDays + ' дней до каждого отпуска придёт письмо с кнопками «Да / Нет».' };
    V.toast('Готово и согласовать', 'Отправлено директорам' + (n ? ' · ' + n + ' периодов' : ''), 'ok');
    render();
  }

  function approveAllPending() {
    var n = 0;
    D.ALL.forEach(function (e) { D.rangesOf(e.id).forEach(function (r) { if (r.status === 'pending') { r.status = 'approved'; n++; } }); });
    V.toast('Согласовано', n + ' периодов подтверждено всеми директорами', 'ok');
    S.note = { type: 'ok', msg: 'Все отправленные периоды согласованы. Уведомления сотрудникам отправлены — можно закрывать график.' };
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
  function toggleDeptOnly() { S.deptOnly = !S.deptOnly; render(); }

  /* ── Карточка сотрудника (взгляд директора) ──────────────────────────── */
  function openPersonCard(empId) {
    var e = D.byId(empId);
    var b = D.balance(empId);
    var rs = D.rangesOf(empId).slice().sort(function (a, c) { return a.start < c.start ? -1 : 1; });
    var lines = rs.length ? rs.map(function (r) {
      var st = D.ST[r.status];
      var isPend = r.status === 'pending';
      return '' +
        '<div class="vs-pc-line" data-stop>' +
          '<div class="vs-pc-line__t">' + D.fmtRange(r.start, r.end) +
            ' <span class="vs-chip ' + st.cls + '">' + st.label + '</span>' +
            '<span class="vs-pc-line__d">' + r.days + ' кал. дн.</span>' +
            (r.days >= 14 ? '<span class="badge gold">основной</span>' : '') +
          '</div>' +
          (r.reason ? '<div class="vs-pc-line__r">📝 причина: ' + esc(r.reason) + ' <span class="dim">· ' + esc(r.decided_by || 'директор') + '</span></div>' : '') +
          (isPend ? '<div class="vs-pc-line__acts">' +
            '<button class="btn ok sm" data-vs-decide="' + empId + '|' + r.id + '|approve">✓ Согласовать</button>' +
            '<button class="btn danger sm" data-vs-decide="' + empId + '|' + r.id + '|reject">✕ Не согласовать</button>' +
          '</div>' : '') +
        '</div>';
    }).join('') : '<div class="empty-state"><div class="icon">🌴</div><div class="title">Отпусков нет</div></div>';

    var ov = document.createElement('div');
    ov.className = 'vs-ov';
    ov.setAttribute('data-vs-close', '1');
    ov.innerHTML = '' +
      '<div class="vs-pc" data-stop>' +
        '<div class="vs-pc__h">' +
          '<span class="vs-ava">' + V.initials(e.fio) + '</span>' +
          '<div><div class="vs-pc__n">' + esc(e.fio) + '</div><div class="vs-pc__r">' + esc(D.roleRu(e.role)) + ' · ' + esc(V.groupTitle(e.group)) + '</div></div>' +
          '<button class="pp-dr__x" data-vs-close="1">✕</button>' +
        '</div>' +
        '<div class="vs-pc__kpis">' +
          '<div class="vs-pc__k"><b class="num">' + b.availableOnJan1 + '</b><span>доступно на 01.01</span></div>' +
          '<div class="vs-pc__k"><b class="num">' + b.lastYearUnused + '</b><span>перенос ' + (S.year - 1) + '</span></div>' +
          '<div class="vs-pc__k"><b class="num">' + b.plannedTotal + '</b><span>запланировано</span></div>' +
          '<div class="vs-pc__k' + (b.left < 0 ? ' is-neg' : '') + '"><b class="num">' + b.left + '</b><span>остаток</span></div>' +
        '</div>' +
        '<div class="vs-pc__body">' + lines + '</div>' +
        (rs.some(function (r) { return r.status === 'pending'; })
          ? '<div class="vs-pc__foot"><button class="btn ok" data-vs-decide-all="' + empId + '">Согласовать все периоды сотрудника</button></div>'
          : '') +
      '</div>';
    document.body.appendChild(ov);
  }

  function decide(empId, periodId, action) {
    var list = D.VAC[empId] || [];
    var r = list.filter(function (x) { return x.id === periodId; })[0];
    if (!r) return;
    if (action === 'approve') {
      r.status = 'approved'; r.decided_by = 'Кудряшов О.С.';
      V.toast('Согласовано', D.byId(empId).fio.split(' ')[0] + ' · ' + D.fmtRange(r.start, r.end), 'ok');
      closeModal(); render(); return;
    }
    openRejectModal(empId, r);
  }

  /* ── Отклонение: комментарий ОБЯЗАТЕЛЕН ──────────────────────────────── */
  function openRejectModal(empId, r) {
    closeModal();
    var e = D.byId(empId);
    var ov = document.createElement('div');
    ov.className = 'vs-ov';
    ov.innerHTML = '' +
      '<div class="vs-reject" data-stop>' +
        '<div class="vs-reject__h"><b>Не согласовать отпуск</b><button class="pp-dr__x" data-vs-close="1">✕</button></div>' +
        '<div class="vs-reject__who">' + esc(e.fio) + ' · ' + D.fmtRange(r.start, r.end) + ' · ' + r.days + ' дн.</div>' +
        '<label class="lbl">Комментарий сотруднику — <b class="vs-bad">обязательно</b></label>' +
        '<textarea class="input vs-reject__ta" id="vsRejectText" rows="3" placeholder="Почему не согласовано и когда лучше взять (например: «Сдача объекта 1–15 мая, возьми после 20-го»). Сотрудник увидит этот текст."></textarea>' +
        '<div class="vs-reject__hint">Дни будут сняты: сотрудник получит уведомление и письмо, а система запомнит эти даты — поставить их повторно не даст.</div>' +
        '<div class="vs-reject__acts">' +
          '<button class="btn ghost" data-vs-close="1">Отмена</button>' +
          '<button class="btn danger" data-vs-reject-confirm="' + empId + '|' + r.id + '">Не согласовать и уведомить</button>' +
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
      // система помнит отклонённые дни — куда бы сотрудник их ни ставил, повторно нельзя
      if (!S.blocked) S.blocked = {};
      days.forEach(function (d) { S.blocked[d] = true; });
      r.status = 'rejected'; r.reason = txt; r.decided_by = 'Кудряшов О.С.';
    }
    V.toast('Не согласовано', 'Сотруднику ушли уведомление и письмо с причиной', 'warn');
    closeModal(); render();
  }

  function openRejectConfirm2() { /* noop */ }

  /* ── Почта ───────────────────────────────────────────────────────────── */
  function mailYes() {
    var list = D.rangesOf(D.me.id);
    var r = list.filter(function (x) { return x.start === '2027-05-01'; })[0];
    if (r) { r.status = 'approved'; r.decided_by = 'Кудряшов О.С.'; }
    V.toast('Да, согласовать', 'Сотруднику ушло уведомление и форма заявления', 'ok');
    location.hash = '#mail-ok';
  }
  function mailNo() {
    var list = D.rangesOf(D.me.id);
    var r = list.filter(function (x) { return x.start === '2027-05-01'; })[0];
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

  /* ═══ Делегирование клик ═══════════════════════════════════════════════ */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-nav],[data-month],[data-month-nav],[data-day],[data-vs-clear],[data-vs-save],[data-vs-submit],[data-vs-hide],[data-vs-unhide],[data-vs-hidegroup],[data-vs-unhidegroup],[data-vs-dept-only],[data-vs-open],[data-vs-open-after],[data-vs-close],[data-vs-close-modal-manual],[data-vs-close-graph],[data-vs-rules],[data-vs-rules-close],[data-vs-approve-all],[data-period],[data-vs-decide],[data-vs-decide-all],[data-vs-reject-confirm],[data-vs-mail-yes],[data-vs-mail-no],[data-vs-buh-save],[data-vs-why],[data-vs-blocked],[data-theme-btn]');
    if (!t) {
      // клик по затемнению — закрыть модалку
      if (ev.target.classList && ev.target.classList.contains('vs-ov')) closeModal();
      return;
    }
    if (t.hasAttribute('data-nav')) { location.hash = '#' + t.getAttribute('data-nav'); return; }
    if (t.hasAttribute('data-theme-btn')) { setTheme(t.getAttribute('data-theme-btn')); return; }
    if (t.hasAttribute('data-vs-close')) { closeModal(); return; }
    if (t.hasAttribute('data-vs-close-modal-manual')) { location.hash = '#office'; return; }
    if (t.hasAttribute('data-vs-close-graph')) { closeSchedule(); return; }
    if (t.hasAttribute('data-vs-approve-all')) { approveAllPending(); return; }

    if (t.hasAttribute('data-month')) { toggleMonth(t.getAttribute('data-month')); return; }
    if (t.hasAttribute('data-month-nav')) { toggleMonth(t.getAttribute('data-month-nav')); return; }
    if (t.hasAttribute('data-day')) { toggleDay(t.getAttribute('data-day'), +t.getAttribute('data-emp')); return; }
    if (t.hasAttribute('data-vs-why')) { V.toast('Чужой период', 'Видно всем, правит только владелец', 'warn'); return; }
    if (t.hasAttribute('data-vs-blocked')) { V.toast('Эти дни недоступны', 'Директор не согласовал их — поставьте другие дни', 'err'); return; }
    if (t.hasAttribute('data-vs-clear')) { clearSel(); return; }
    if (t.hasAttribute('data-vs-save')) { savePeriod(); return; }
    if (t.hasAttribute('data-vs-submit')) { submitAll(); return; }
    if (t.hasAttribute('data-vs-hide')) { hidePerson(+t.getAttribute('data-vs-hide')); return; }
    if (t.hasAttribute('data-vs-unhide')) { unhidePerson(+t.getAttribute('data-vs-unhide')); return; }
    if (t.hasAttribute('data-vs-hidegroup')) { hideGroup(t.getAttribute('data-vs-hidegroup')); return; }
    if (t.hasAttribute('data-vs-unhidegroup')) { unhideGroup(t.getAttribute('data-vs-unhidegroup')); return; }
    if (t.hasAttribute('data-vs-dept-only')) { toggleDeptOnly(); return; }
    if (t.hasAttribute('data-vs-open')) { location.hash = '#me'; return; }
    if (t.hasAttribute('data-vs-open-after')) { S.note = { type: 'ok', msg: 'Откройте месяц и поставьте новые дни — прежние (отклонённые) недоступны.' }; location.hash = '#me'; return; }
    if (t.hasAttribute('data-vs-rules')) { S._rules = true; render(); return; }
    if (t.hasAttribute('data-vs-rules-close')) { S._rules = false; render(); return; }

    if (t.hasAttribute('data-period')) { openPersonCard(+t.getAttribute('data-emp') || D.me.id); return; }
    if (t.hasAttribute('data-vs-decide')) {
      var p = t.getAttribute('data-vs-decide').split('|');
      decide(+p[0], p[1], p[2]); return;
    }
    if (t.hasAttribute('data-vs-decide-all')) {
      var id = +t.getAttribute('data-vs-decide-all');
      D.rangesOf(id).forEach(function (r) { if (r.status === 'pending') { r.status = 'approved'; r.decided_by = 'Кудряшов О.С.'; } });
      V.toast('Согласовано', 'Все периоды сотрудника подтверждены', 'ok');
      closeModal(); render(); return;
    }
    if (t.hasAttribute('data-vs-reject-confirm')) {
      var q = t.getAttribute('data-vs-reject-confirm').split('|');
      confirmReject(+q[0], q[1]); return;
    }
    if (t.hasAttribute('data-vs-mail-yes')) { mailYes(); return; }
    if (t.hasAttribute('data-vs-mail-no')) { mailNo(); return; }
    if (t.hasAttribute('data-vs-buh-save')) { saveBuh(); return; }
  });

  /* ── Клик по ФИО директором (открыть карточку по имени) ──────────────── */
  document.addEventListener('click', function (ev) {
    if (S.role !== 'director') return;
    var w = ev.target.closest('.vs-who__n');
    if (!w) return;
    var row = w.closest('.vs-row'); if (!row) return;
    var nm = (w.textContent || '').trim();
    var found = D.ALL.filter(function (e) { return nm.indexOf(e.fio) === 0; })[0];
    if (found) openPersonCard(found.id);
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
  window.addEventListener('load', function () { $$('[data-theme-btn]').forEach(function (b) { b.addEventListener('click', function () { setTheme(b.getAttribute('data-theme-btn')); }); }); });
  if (!location.hash) location.hash = '#me';
  render();
})();
