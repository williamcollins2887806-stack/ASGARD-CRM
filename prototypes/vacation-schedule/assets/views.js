/* ASGARD CRM — прототип графика отпусков: экраны (живые DOM-функции, переносятся в ваниль 1:1).
   Дизайн: премиум-язык CRM — стекло, скругления, блики, только токены темы. */
(function () {
  'use strict';
  var D = window.VS_DATA;

  /* ── Иконки (inline SVG, единый штрих 1.6, currentColor) ─────────────── */
  function svg(path, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' + (extra || '') + '>' + path + '</svg>';
  }
  var IC = {
    cal:    svg('<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 3v3M16 3v3"/>'),
    eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.5 2-1.4 3.1M6.2 6.5C3.9 8 2.3 10.3 2.3 12c0 2.5 4 7 9.7 7 1.5 0 2.9-.4 4.1-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
    eye:    svg('<path d="M2.3 12C2.3 9.5 6.3 5 12 5s9.7 4.5 9.7 7-4 7-9.7 7-9.7-4.5-9.7-7Z"/><circle cx="12" cy="12" r="3"/>'),
    people: svg('<circle cx="9" cy="8" r="3.2"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M16.5 5.4a3.2 3.2 0 0 1 0 5.2M18 20h3.2a5.6 5.6 0 0 0-3.4-5.2"/>'),
    check:  svg('<path d="M4.5 12.6l4.6 4.6L19.5 6.8"/>'),
    x:      svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    clock:  svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>'),
    gift:   svg('<rect x="3" y="8.5" width="18" height="12" rx="2.5"/><path d="M3 13h18M12 8.5V21M12 8.5S10.5 3 7.8 3.8 8.4 8.5 12 8.5s4.9-2.4 4.2-4.7S12 8.5 12 8.5Z"/>'),
    undo:   svg('<path d="M9 7H5.5V3.5"/><path d="M5.9 7.2A8 8 0 1 1 4 12"/>'),
    board:  svg('<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8.5 4V2.5M15.5 4V2.5M8 13.5h3M8 17h6"/>'),
    doc:    svg('<path d="M6 2.8h7.5L18.5 8v13.2H6z"/><path d="M13.2 2.9V8h5.3M9 13h6M9 16.5h6"/>'),
    print:  svg('<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2.2"/><path d="M7 15h10v5.5H7z"/>'),
    down:   svg('<path d="M12 3.5v11M7.5 10.2 12 14.7l4.5-4.5M4.5 20h15"/>'),
    lock:   svg('<rect x="4.5" y="10.5" width="15" height="10.5" rx="3"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>'),
    warn:   svg('<path d="M12 3.6 21 19.5H3z"/><path d="M12 9.2v4.4M12 16.6h.01"/>'),
    ok:     svg('<circle cx="12" cy="12" r="9"/><path d="M8.2 12.4l2.6 2.6 5-5.2"/>'),
    bell:   svg('<path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15z"/><path d="M10 21h4"/>'),
    spark:  svg('<path d="M12 3.2l1.9 5.1 5.1 1.9-5.1 1.9L12 17.2l-1.9-5.1L5 10.2l5.1-1.9z"/><path d="M18.6 16.4l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/>'),
    chev:   svg('<path d="M8.5 9.5 12 6l3.5 3.5M8.5 14.5 12 18l3.5-3.5"/>'),
    seal:   svg('<path d="M12 3.5l2.3 1.6 2.8-.2.9 2.7 2.3 1.6-1.2 2.6 1.2 2.6-2.3 1.6-.9 2.7-2.8-.2L12 20.5l-2.3-1.6-2.8.2-.9-2.7L3.7 14.8l1.2-2.6-1.2-2.6 2.3-1.6.9-2.7 2.8.2z"/><path d="M9.3 12.2l1.9 1.9 3.6-3.9"/>')
  };
  function ic(name, cls) { return '<span class="vsp-ic ' + (cls || '') + '">' + (IC[name] || '') + '</span>'; }

  /* ── Состояние прототипа ─────────────────────────────────────────────── */
  var S = {
    theme: 'dark',
    year: D.YEAR,
    openMonth: null,
    expansion: false,
    role: 'me',              // 'me' | 'director' | 'buh'
    sel: {},
    rangeStart: null,
    editingId: null,
    hiddenGroups: {},
    hiddenPeople: {},
    blockedByEmp: {},       // empId -> { 'YYYY-MM-DD': true } — снятые директором дни, по сотруднику
    deptOnly: false,
    note: null,
    closed: false,
    notifySent: false,
    cal: { y: D.YEAR, m: 4 },
    docsTab: 'zayav',        // 'zayav' | 'prikaz' | 't7'
    dirQueueOnly: false,     // директор: показывать только очередь
    seenHolidays: {}         // подсказки по праздникам уже показаны
  };

  window.VS_STATE = S;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function initials(fio) { var p = String(fio).split(' '); return (p[0][0] || '') + (p[1] ? p[1][0] : ''); }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function daysWord(n) { return n + ' ' + plural(n, 'день', 'дня', 'дней'); }
  function toast(t, m, type) {
    var host = document.getElementById('toast'); if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'ok');
    el.innerHTML = '<b>' + esc(t) + '</b>' + (m ? '<span>' + esc(m) + '</span>' : '');
    host.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 300); }, 3600);
  }

  /* ── Стилизация ячеек ────────────────────────────────────────────────── */
  function cellState(empId, iso) {
    var rs = D.rangesOf(empId);
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (iso >= r.start && iso <= r.end) {
        if (r.status === 'rejected') return { code: 'rejected', r: r };
        return { code: r.status, r: r };
      }
    }
    return null;
  }
  function cellCls(empId, iso, isMine, isSel, wk) {
    var st = cellState(empId, iso);
    var c = ['vs-d'];
    if (wk) c.push('is-wk');
    if (D.isHoliday(iso)) c.push('is-hol');
    else if (D.isShifted(iso)) c.push('is-shift');
    if (isMine) c.push('is-mine');
    if (isSel) c.push('is-sel');
    if (st) {
      c.push('is-vac');
      c.push(st.code === 'approved' ? 'v-ok' : st.code === 'pending' ? 'v-pend' : st.code === 'rejected' ? 'v-bad' : 'v-draft');
    }
    return c.join(' ');
  }

  /* ── Баланс: два щита слева + «можно взять» справа ───────────────────── */
  function balanceStrip(empId) {
    var b = D.balance(empId);
    var canTake = Math.max(0, b.left);
    return '' +
      '<div class="vs-bal">' +
        accCard('gift', 'Доступно на 01.01.' + S.year, b.availableOnJan1, 'кал. дн.', 'avail',
          'Основной отпуск ' + Math.round(b.availableOnJan1 - b.lastYearUnused) + ' дн. + перенос ' + b.lastYearUnused) +
        accCard('undo', 'Не отгулено за ' + (S.year - 1), b.lastYearUnused, 'кал. дн.', 'carry',
          b.lastYearUnused ? 'Переносится на ' + S.year + ' год' : 'Переносов нет') +
        '<div class="vs-acc vs-acc--can">' +
          '<div class="vs-acc__glow"></div>' +
          '<div class="vs-acc__tx">' +
            '<div class="vs-acc__l">Можно взять ещё</div>' +
            '<div class="vs-acc__v num">' + canTake + ' <small>из ' + b.availableOnJan1 + '</small></div>' +
            '<div class="vs-acc__bars">' +
              '<i class="vs-b vs-b--ok" style="width:' + pct(b.approved, b.availableOnJan1) + '%"></i>' +
              '<i class="vs-b vs-b--pend" style="width:' + pct(b.pending, b.availableOnJan1) + '%"></i>' +
              '<i class="vs-b vs-b--free" style="width:' + pct(canTake, b.availableOnJan1) + '%"></i>' +
            '</div>' +
            '<div class="vs-acc__lg">' +
              '<span><i class="vs-b vs-b--ok"></i>отгуляно <b>' + b.approved + '</b></span>' +
              '<span><i class="vs-b vs-b--pend"></i>на согласовании <b>' + b.pending + '</b></span>' +
              '<span><i class="vs-b vs-b--free"></i>свободно <b>' + canTake + '</b></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }
  function accCard(iconName, label, value, unit, mod, hint) {
    return '' +
      '<div class="vs-acc vs-acc--' + mod + '" title="' + esc(hint) + '">' +
        '<div class="vs-acc__glow"></div>' +
        '<div class="vs-acc__ic">' + (IC[iconName] || '') + '</div>' +
        '<div class="vs-acc__tx">' +
          '<div class="vs-acc__l">' + esc(label) + '</div>' +
          '<div class="vs-acc__v num">' + value + ' <small>' + unit + '</small></div>' +
          '<div class="vs-acc__h">' + esc(hint) + '</div>' +
        '</div>' +
      '</div>';
  }
  function pct(v, total) { return total ? Math.max(0, Math.min(100, Math.round(v / total * 100))) : 0; }

  /* ── Чипы периодов сотрудника ─────────────────────────────────────────── */
  function chipsOf(empId) {
    var rs = D.rangesOf(empId).slice().sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    if (!rs.length) return '<span class="vs-chip vs-chip--none">отпусков нет</span>';
    return rs.map(function (r) {
      var st = D.ST[r.status];
      var sm = D.MONTHS[Number(r.start.slice(5, 7)) - 1];
      var title = D.fmtRange(r.start, r.end) + ' · ' + st.label +
        (r.hol ? ' · ' + r.hol + ' празд. продлевают' : '') +
        (r.reason ? ' · причина: ' + r.reason : '');
      return '<span class="vs-chip ' + st.cls + '" title="' + esc(title) + '" data-period="' + r.id + '" data-emp="' + empId + '">' +
        '<b>' + sm.slice(0, 3) + '</b> ' + st.short + ' ' + r.days + 'д</span>';
    }).join('');
  }

  /* ── Плашка сроков: с 01.11 внести, до 01.12 закрыть ─────────────────── */
  function deadlineBanner() {
    var notFilled = D.ALL.filter(function (e) { return D.balance(e.id).plannedTotal === 0; });
    var pctFilled = Math.round((D.ALL.length - notFilled.length) / D.ALL.length * 100);
    var dleft = D.daysToDeadline();
    var open = D.windowOpen();
    var stateCls = !open ? ' is-closed' : (dleft <= 7 ? ' is-soon' : '');
    var stateTxt = !open
      ? 'Окно внесения закрыто — правки только через директора'
      : (dleft > 0 ? 'до закрытия ' + daysWord(dleft) : 'сегодня последний день');
    return '' +
      '<div class="vs-deadline' + stateCls + '">' +
        '<div class="vs-deadline__ic">' + IC.clock + '</div>' +
        '<div class="vs-deadline__tx">' +
          '<div class="vs-deadline__t">График на ' + S.year + ' год — внесение с <b>1 ноября</b>, закрытие до <b>1 декабря ' + (S.year - 1) + '</b></div>' +
          '<div class="vs-deadline__s">Внесли ' + (D.ALL.length - notFilled.length) + ' из ' + D.ALL.length + ' офисных сотрудников. ' + esc(stateTxt) + '.</div>' +
        '</div>' +
        '<div class="vs-deadline__prog">' +
          '<div class="vs-deadline__bar"><i style="width:' + pctFilled + '%"></i></div>' +
          '<span class="num">' + pctFilled + '%</span>' +
        '</div>' +
      '</div>';
  }

  /* ── Легенда статусов ────────────────────────────────────────────────── */
  function legend() {
    return '' +
      '<div class="vs-legend">' +
        '<span class="vs-lg"><i class="vsp-sw v-ok"></i>согласовано</span>' +
        '<span class="vs-lg"><i class="vsp-sw v-pend"></i>ждёт согласования</span>' +
        '<span class="vs-lg"><i class="vsp-sw v-bad"></i>не согласовано</span>' +
        '<span class="vs-lg"><i class="vsp-sw is-hol"></i>праздник РФ (продлевает отпуск)</span>' +
        '<span class="vs-lg"><i class="vsp-sw is-wk"></i>выходной</span>' +
        '<span class="vs-lg"><i class="vsp-sw is-blocked"></i>дни сняты директором — повторно нельзя</span>' +
        '<span class="vs-lg vs-lg--hint">Основной отпуск — 14 дн. разом 1 раз в год; остальные — до 7 дн. Праздники (ст. 112 ТК) в отпуск не входят.</span>' +
      '</div>';
  }

  /* ── Шапка модалки ───────────────────────────────────────────────────── */
  function modalHead() {
    var isDir = S.role === 'director';
    var isMe = S.role === 'me';
    var who = isDir ? { fio: 'Директора', role: 'Согласование графика отпусков' } :
              isMe ? { fio: D.byId(D.me.id).fio, role: D.roleRu(D.me.role) } :
                     { fio: 'Бухгалтерия', role: 'Настройка дней' };
    return '' +
      '<div class="vs-mhead">' +
        '<div class="vs-mhead__ic">' + IC.cal + '</div>' +
        '<div class="vs-mhead__tx">' +
          '<div class="vs-mhead__t">График отпусков · ' + S.year + ' <span class="badge gold">офис</span>' +
            (S.closed ? ' <span class="badge muted">' + 'закрыт</span>' : '') + '</div>' +
          '<div class="vs-mhead__s">' + esc(who.fio) + ' · ' + esc(who.role) + ' · дни календарные, праздники не входят</div>' +
        '</div>' +
        '<div class="vs-mhead__acts">' +
          '<button class="btn ghost sm" data-vs-docs>' + ic('doc') + 'Документы</button>' +
          '<button class="btn ghost sm" data-vs-rules>' + ic('board') + 'Правила</button>' +
          (isDir ? '<button class="btn ok sm" data-vs-approve-all>' + ic('check') + 'Согласовать всё</button>' : '') +
          (isDir ? '<button class="btn ghost sm" data-vs-close-graph>' + ic('lock') + 'Закрыть график</button>' : '') +
          (isMe ? '<button class="btn gold sm" data-vs-submit>' + ic('check') + 'Готово и согласовать</button>' : '') +
          '<button class="vsp-x" data-vs-close-modal-manual title="Закрыть">' + IC.x + '</button>' +
        '</div>' +
      '</div>' +
      (S.closed ? '<div class="vs-closed">' + ic('lock') + 'График согласован всеми директорами и закрыт. Редактирование недоступно.</div>' : '') +
      (isDir ? directorBar() : '') +
      (S.note ? '<div class="vs-note vs-note--' + S.note.type + '">' + esc(S.note.msg) + '</div>' : '');
  }

  /* ── Панель директора + очередь на согласование ──────────────────────── */
  function pendingAll() {
    var out = [];
    D.ALL.forEach(function (e) {
      D.rangesOf(e.id).forEach(function (r) {
        if (r.status === 'pending') out.push({ emp: e, r: r });
      });
    });
    out.sort(function (a, b) { return a.r.start < b.r.start ? -1 : 1; });
    return out;
  }

  function directorBar() {
    var pend = pendingAll();
    var filled = D.ALL.filter(function (e) { return D.balance(e.id).plannedTotal > 0; }).length;
    return '' +
      '<div class="vs-dirbar">' +
        '<div class="vs-dirbar__i"><b class="num">' + filled + '/' + D.ALL.length + '</b><span>заполнили график</span></div>' +
        '<div class="vs-dirbar__sep"></div>' +
        '<div class="vs-dirbar__i vs-dirbar__i--hot"><b class="num">' + pend.length + '</b><span>' +
          plural(pend.length, 'период ждёт', 'периода ждут', 'периодов ждут') + ' решения</span></div>' +
        '<div class="vs-dirbar__sep"></div>' +
        '<div class="vs-dirbar__i"><b class="num">' + D.DIRECTORS.length + '</b><span>директора согласуют</span></div>' +
        '<div class="vs-dirbar__hint">' +
          'Согласовать может любой директор; период считается согласованным, когда «за» все трое. ' +
          'Отклонение — только с комментарием, снятые дни система запоминает.' +
        '</div>' +
      '</div>' +
      dirQueue(pend);
  }

  /** Очередь на согласование — простой список «согласовать / отклонить» в один клик. */
  function dirQueue(pend) {
    if (!pend.length) {
      return '<div class="vs-queue vs-queue--empty">' + ic('ok', 'vs-ok-ic') +
        '<div><b>Очередь пуста</b><span>Все отправленные периоды согласованы. Можно закрывать график.</span></div></div>';
    }
    var cards = pend.map(function (x) {
      var e = x.emp, r = x.r;
      var pr = D.approveProgress(r);
      var votes = D.DIRECTORS.map(function (d) {
        var yes = D.approvesOf(r).indexOf(d.id) >= 0;
        return '<span class="vs-vote' + (yes ? ' is-yes' : '') + '" title="' + esc(d.fio) + ' — ' +
          (yes ? 'согласовал' : 'ждём решения') + '">' + initials(d.fio) + '</span>';
      }).join('');
      var clashes = D.clashesWith(e.id, r.start, r.end);
      var clashTxt = clashes.length
        ? '<span class="vs-q__clash">' + ic('warn') + 'пересечение: ' +
            clashes.slice(0, 2).map(function (c) { return esc(c.fio.split(' ')[0]) + ' (' + c.overlapDays + ' дн.)'; }).join(', ') +
            (clashes.length > 2 ? ' и ещё ' + (clashes.length - 2) : '') + '</span>'
        : '<span class="vs-q__clear">' + ic('check') + 'пересечений нет</span>';
      return '' +
        '<div class="vs-q" data-stop>' +
          '<span class="vs-q__ava">' + initials(e.fio) + '</span>' +
          '<div class="vs-q__who">' +
            '<div class="vs-q__n">' + esc(e.fio) + ' <span class="vs-q__role">' + esc(D.roleRu(e.role)) + '</span></div>' +
            '<div class="vs-q__d">' + esc(D.fmtRange(r.start, r.end)) + ' · <b>' + daysWord(r.days) + '</b>' +
              (r.hol ? ' <span class="vs-q__hol">+' + r.hol + ' празд. продлевают</span>' : '') +
              (r.days >= 14 ? ' <span class="badge gold">основной</span>' : '') + '</div>' +
            '<div class="vs-q__meta">' + clashTxt + '<span class="vs-q__votes">' + votes + '</span></div>' +
          '</div>' +
          '<div class="vs-q__acts">' +
            '<button class="btn ok sm" data-vs-decide="' + e.id + '|' + r.id + '|approve">' + ic('check') + 'Согласовать</button>' +
            '<button class="btn danger sm" data-vs-decide="' + e.id + '|' + r.id + '|reject">' + ic('x') + 'Отклонить</button>' +
          '</div>' +
        '</div>';
    }).join('');
    return '' +
      '<div class="vs-queue">' +
        '<div class="vs-queue__h">' +
          '<span class="vs-queue__t">' + ic('bell') + 'Очередь на согласование</span>' +
          '<span class="vs-queue__c">' + pendingAll().length + ' ' + plural(pendingAll().length, 'период', 'периода', 'периодов') + '</span>' +
        '</div>' +
        '<div class="vs-queue__list">' + cards + '</div>' +
      '</div>';
  }

  /* ── Единый grid-шаблон колонок ──────────────────────────────────────────
     Все месяцы свёрнуты → 12 равных колонок на всю ширину (влезает полное
     название месяца). Месяц раскрыт → он занимает остаток, остальные сжимаются
     до 30px, чтобы 31 день помещался на ноутбуке 1280 без гориз. прокрутки. */
  var MINI_W = '26px';
  function colTemplate() {
    var cols = ['var(--vs-name-w)'];
    for (var m = 0; m < 12; m++) {
      if (!S.expansion) cols.push('minmax(0, 1fr)');
      else cols.push(S.openMonth === m ? 'minmax(0, 1fr)' : MINI_W);
    }
    return cols.join(' ');
  }

  /* ── Месячная батарея + шапка таблицы ────────────────────────────────── */
  function monthsHeader(isMe) {
    var cells = '';
    for (var m = 0; m < 12; m++) {
      var open = S.expansion && S.openMonth === m;
      if (open) {
        var holCount = D.rangeDays(D.iso(S.year, m, 1), D.iso(S.year, m, D.daysInMonth(S.year, m)))
          .filter(function (d) { return D.isHoliday(d); }).length;
        cells += '<div class="vs-days vs-days--head is-open" data-month-nav="' + m + '" title="Скрыть ' + D.MONTHS[m] + '">' +
          '<div class="vs-days__cap">' +
            '<span class="vs-days__m">' + D.MONTHS[m] + '</span>' +
            (holCount ? '<span class="vs-days__hol">' + holCount + ' празд.</span>' : '') +
            '<span class="vs-days__x">' + IC.chev + '</span>' +
          '</div>' +
          '<div class="vs-days__wd">' + D.WEEKDAYS.map(function (w) { return '<div class="vs-d vs-d--wd">' + w + '</div>'; }).join('') + '</div>' +
          '<div class="vs-days__nm">' + dayNums(m).map(function (cell) {
            var cls = 'vs-d vs-d--hd' + (cell.wk ? ' is-wk' : '') + (cell.hol ? ' is-hol' : '') + (cell.shift ? ' is-shift' : '');
            var tip = cell.hol ? D.holidayTitle(cell.iso) : (cell.shift ? D.shiftTitle(cell.iso) : '');
            return '<div class="' + cls + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + cell.d + '</div>';
          }).join('') + '</div></div>';
      } else {
        var mk = isMe ? D.monthMark(D.me.id, m) : null;
        var tip = D.MONTHS[m] + (mk ? ' · ' + mk.days + ' дн.: ' + mk.label : ' · отпусков нет');
        var tight = S.expansion;   // есть раскрытый месяц → колонки узкие
        cells += '<div class="vs-mon' + (mk ? ' has-mark' : '') + (tight ? ' is-tight' : '') + ' vs-mon--head" data-month="' + m + '" title="' + esc(tip) + '">' +
          '<span class="vs-mon__n">' + (tight ? D.MONTHS[m].slice(0, 3) : D.MONTHS[m]) + '</span>' +
          (mk ? '<span class="vs-mon__mk ' + (mk.pending ? 'is-pend' : mk.rejected ? 'is-bad' : 'is-ok') + '">' + mk.days + '</span>' : '') +
          '</div>';
      }
    }
    return '<div class="vs-head" style="grid-template-columns:' + colTemplate() + '">' +
      '<div class="vs-name vs-name--head">' +
        '<span class="vs-name__t">Сотрудник</span>' +
        '<small>отдел · должность · отпуска за год</small>' +
        (isMe ? '<div class="vs-name__acts">' +
          '<button class="vs-mini' + (S.deptOnly ? ' is-on' : '') + '" data-vs-dept-only>' + ic('people') + 'Только мой отдел</button>' +
          ((Object.keys(S.hiddenGroups).length || Object.keys(S.hiddenPeople).length || S.deptOnly)
            ? '<button class="vs-mini" data-vs-show-all>' + ic('eye') + 'Показать всех</button>' : '') +
        '</div>' : '') +
      '</div>' + cells + '</div>';
  }
  function dayNums(m) {
    var n = D.daysInMonth(S.year, m), out = [];
    for (var d = 1; d <= n; d++) {
      var iso2 = D.iso(S.year, m, d);
      out.push({ d: d, wk: D.isWeekend(S.year, m, d), hol: D.isHoliday(iso2), shift: D.isShifted(iso2), iso: iso2 });
    }
    return out;
  }

  /* ── Строка сотрудника ───────────────────────────────────────────────── */
  function personRow(emp, isMe) {
    var b = D.balance(emp.id);
    var isMine = emp.id === D.me.id;
    var cells = '';
    for (var m = 0; m < 12; m++) {
      var open = S.expansion && S.openMonth === m;
      if (open) {
        cells += '<div class="vs-days">' + dayNums(m).map(function (cell) {
          var iso2 = cell.iso;
          var sel = !!S.sel[iso2] && (S.role === 'me' && isMine);
          var editable = S.role === 'me' && isMine && !S.closed;
          var st = cellState(emp.id, iso2);
          var blocked = isMine && D.isBlocked(emp.id, iso2);
          var c = cellCls(emp.id, iso2, isMine, sel, cell.wk);
          if (blocked) c += ' is-blocked';
          var attrs = editable ? ' data-day="' + iso2 + '" data-emp="' + emp.id + '" role="button" tabindex="0"' : '';
          if (!editable && st) attrs += ' data-vs-why="' + (isMine ? '' : 'Это дни другого сотрудника — их видно, но править нельзя') + '"';
          if (blocked) attrs += ' data-vs-blocked="' + iso2 + '"';
          var tip = iso2 + (cell.hol ? ' · ' + D.holidayTitle(iso2) + ' (праздник, в отпуск не входит)' : '') +
            (cell.shift ? ' · ' + D.shiftTitle(iso2) : '') +
            (st ? ' · ' + D.ST[st.code].label : '') + (blocked ? ' · снято директором — повторно нельзя' : '');
          var lbl = (isMine && S.expansion && S.openMonth === m) ? cell.d : '';
          return '<div class="' + c + '"' + attrs + ' title="' + esc(tip) + '">' +
            (st ? '<i class="vs-d__dot"></i>' : '') + lbl + '</div>';
        }).join('') + '</div>';
      } else {
        var mk = D.monthMark(emp.id, m);
        var tip = D.MONTHS[m] + (mk ? ' · ' + mk.days + ' ' + plural(mk.days, 'день', 'дня', 'дней') + ': ' + mk.label : '');
        cells += '<div class="vs-mon' + (mk ? ' has-mark' : '') + (S.expansion ? ' is-tight' : '') + '" data-month="' + m + '" title="' + esc(tip) + '">' +
          (mk ? '<span class="vs-mon__mk ' + (mk.pending ? 'is-pend' : mk.rejected ? 'is-bad' : 'is-ok') + '">' + mk.days + '</span>' : '') +
          '</div>';
      }
    }
    var leftCls = b.left < 0 ? ' is-neg' : '';
    var hideBtn = (isMe && !isMine) || S.role === 'director'
      ? '<button class="vs-hide" data-vs-hide="' + emp.id + '" title="Скрыть строку — останутся только нужные люди">' +
          IC.eyeOff + '<span class="vs-hide__t">скрыть</span></button>' : '';
    return '' +
      '<div class="vs-row' + (isMine ? ' is-me' : '') + (S.role === 'director' && D.rangesOf(emp.id).some(function (r) { return r.status === 'pending'; }) ? ' has-pending' : '') +
        '" style="grid-template-columns:' + colTemplate() + '">' +
        '<div class="vs-name">' +
          '<div class="vs-who">' +
            '<span class="vs-ava' + (isMine ? ' is-me' : '') + '">' + initials(emp.fio) + '</span>' +
            '<div class="vs-who__tx">' +
              '<div class="vs-who__n">' + esc(emp.fio) + (isMine ? ' <span class="vs-you">вы</span>' : '') + '</div>' +
              '<div class="vs-who__r">' + esc(D.roleRu(emp.role)) + '</div>' +
            '</div>' +
            hideBtn +
          '</div>' +
          '<div class="vs-chips">' + chipsOf(emp.id) + '</div>' +
          '<div class="vs-left' + leftCls + '">остаток: <b class="num">' + b.left + '</b> дн.' +
            (b.lastYearUnused ? ' · перенос ' + b.lastYearUnused : '') +
            (b.pending ? ' · <span class="vs-left__p">на согласовании ' + b.pending + '</span>' : '') +
          '</div>' +
        '</div>' + cells +
      '</div>';
  }

  /* ── Панель выделения: диапазон, праздники, пересечения ──────────────── */
  function selBar() {
    if (S.role !== 'me' || S.closed) return '';
    var days = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).sort();
    if (!days.length) return '';
    var start = days[0], end = days[days.length - 1];
    var v = D.validate(D.me.id, start, end, { ignoreId: S.editingId, blocked: D.blockedDays(D.me.id) });
    var clashes = D.clashesWith(D.me.id, start, end);
    var clashHtml = clashes.length
      ? '<div class="vs-selbar__clash">' + ic('warn') +
          '<b>Пересечение:</b> ' + clashes.slice(0, 3).map(function (c) {
            return esc(c.fio.split(' ')[0]) + ' (' + c.overlapDays + ' ' + plural(c.overlapDays, 'день', 'дня', 'дней') + ')';
          }).join(', ') + (clashes.length > 3 ? ' и ещё ' + (clashes.length - 3) : '') +
          ' <span class="dim">— поставить можно, но проверьте пересечение</span></div>'
      : '<div class="vs-selbar__clash is-clear">' + ic('check') + 'Пересечений с коллегами нет</div>';
    var holHtml = v.hol
      ? '<div class="vs-selbar__hol">' + ic('spark') + 'Выделено ' + v.calDays + ' ' + plural(v.calDays, 'календарный день', 'календарных дня', 'календарных дней') +
          ', из них ' + v.hol + ' ' + plural(v.hol, 'праздник', 'праздника', 'праздников') + ' (' + esc(D.holidayNote(start, end).join('; ')) + ') — в отпуск не входят. ' +
          'Чтобы получить ' + v.calDays + ' оплачиваемых, продлите до <b>' + esc(fmtShort(D.extendEnd(start, v.calDays))) + '</b></div>'
      : '';
    return '' +
      '<div class="vs-selbar">' +
        '<div class="vs-selbar__tx">' +
          '<div class="vs-selbar__r">' + esc(D.fmtRange(start, end)) + '</div>' +
          '<div class="vs-selbar__d">' + daysWord(v.days) + ' оплачиваемых' +
            (v.hol ? ' · ' + v.hol + ' празд. не в счёт' : '') + ' · ' +
            (v.ok ? (v.isLong ? 'основной отпуск (до 14)' : 'дополнительный (до 7)') : '<span class="vs-bad">' + esc(v.msg) + '</span>') +
          '</div>' +
          holHtml + clashHtml +
        '</div>' +
        '<div class="vs-selbar__acts">' +
          '<button class="btn ghost sm" data-vs-clear>Очистить</button>' +
          '<button class="btn gold sm" data-vs-save' + (v.ok ? '' : ' disabled title="' + esc(v.msg) + '"') + '>' +
            ic('check') + (S.editingId ? 'Сохранить правку' : 'Поставить отпуск') + '</button>' +
        '</div>' +
      '</div>';
  }
  function fmtShort(isoStr) { var p = D.parseIso(isoStr); return p.d + ' ' + D.MONTHS_GEN[p.m]; }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: ГРАФИК ОТПУСКОВ (полноэкранная модалка)
     ═══════════════════════════════════════════════════════════════════════ */
  function scheduleScreen() {
    var isMe = S.role === 'me';
    var meId = D.me.id;
    var groups = D.GROUPS.filter(function (g) {
      if (S.hiddenGroups[g.key]) return false;
      if (S.deptOnly && g.key !== D.groupOf(meId)) return false;
      return true;
    });
    var rows = groups.map(function (g) {
      var members = g.members.filter(function (m) { return !(S.hiddenPeople || {})[m.id]; });
      if (!members.length) return '';
      var pendN = members.filter(function (m) { return D.rangesOf(m.id).some(function (r) { return r.status === 'pending'; }); }).length;
      return '<div class="vs-group">' +
        '<span class="vs-group__t">' + esc(g.title) + '</span>' +
        '<span class="vs-group__c">' + members.length + ' чел.' + (pendN ? ' · ' + pendN + ' ждут решения' : '') + '</span>' +
        '<span class="vs-group__line"></span>' +
        ((isMe || S.role === 'director') ? '<button class="vs-hide vs-hide--grp" data-vs-hidegroup="' + g.key + '" title="Скрыть отдел «' + esc(g.title) + '»">' + IC.eyeOff + '<span class="vs-hide__t">скрыть отдел</span></button>' : '') +
        '</div>' + members.map(function (m) { return personRow(m, isMe); }).join('');
    }).join('');

    var hiddenChips = Object.keys(S.hiddenGroups).map(function (k) {
      return '<button class="vs-chip vs-chip--restore" data-vs-unhidegroup="' + k + '">' + ic('eye') + 'показать отдел «' + esc(groupTitle(k)) + '»</button>';
    }).join('') + Object.keys(S.hiddenPeople || {}).map(function (id) {
      var e = D.byId(+id);
      return e ? '<button class="vs-chip vs-chip--restore" data-vs-unhide="' + id + '">' + ic('eye') + 'показать ' + esc(e.fio.split(' ')[0]) + '</button>' : '';
    }).join('');

    return '' +
      '<div class="vs-stage">' +
        '<div class="vs-modal">' +
          modalHead() +
          balanceStrip(meId) +
          deadlineBanner() +
          legend() +
          (hiddenChips ? '<div class="vs-hiddenbar">' + hiddenChips + '</div>' : '') +
          '<div class="vs-tablewrap">' +
            monthsHeader(isMe) +
            '<div class="vs-body">' + (rows || '<div class="empty-state"><div class="icon">' + IC.people + '</div><div class="title">Отделы скрыты</div><div class="hint">Нажмите «Показать всех», чтобы вернуть строки</div></div>') + '</div>' +
          '</div>' +
          selBar() +
          '<div class="vs-foot">' +
            '<div class="vs-foot__tx">' + footHint() + '</div>' +
            (S.role === 'me' && !S.closed ? '<button class="btn gold" data-vs-submit>' + ic('check') + 'Готово и согласовать</button>' : '') +
            (S.role === 'director' ? '<button class="btn ok" data-vs-approve-all>' + ic('check') + 'Согласовать всё</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      rulesModalIfAny();
  }

  function groupTitle(k) { var t = k; D.GROUPS.forEach(function (g) { if (g.key === k) t = g.title; }); return t; }

  function footHint() {
    if (S.closed) return 'График закрыт — правки невозможны.';
    if (S.role === 'director') return 'Согласуйте периоды в очереди выше в один клик. Отклонение — с обязательным комментарием.';
    if (S.role === 'me') return 'Нажмите месяц, затем дни 1–14 для основного отпуска. Раскрыт всегда один месяц. Свои дни правите вы, чужие — видите.';
    return 'Ввод количества дней — на экране «Настройка дней» (бухгалтерия).';
  }

  function rulesModalIfAny() {
    if (!S._rules) return '';
    return '' +
      '<div class="vsp-ov" data-vs-rules-close>' +
        '<div class="vsp-sheet" data-stop>' +
          '<div class="vsp-sheet__h"><span class="vsp-sheet__ic">' + IC.board + '</span><b>Правила графика отпусков (офис)</b>' +
            '<button class="vsp-x" data-vs-rules-close>' + IC.x + '</button></div>' +
          '<ul class="vs-rules__l">' +
            '<li>Основной отпуск — <b>14 календарных дней разом, один раз в год</b>.</li>' +
            '<li>Остальные отпуска — <b>не более 7 календарных дней</b>, не более ' + D.RULES.maxParts + ' периодов за год.</li>' +
            '<li>Дни считаются <b>календарные</b>. Но нерабочие праздники (ст. 112 ТК РФ) в отпуск <b>не входят</b> и продлевают его (ст. 120 ТК РФ).</li>' +
            '<li>Сотрудник правит <b>только свои</b> дни, чужие видит — так видно пересечения.</li>' +
            '<li>График вносится <b>с 1 ноября</b> и должен быть закрыт <b>до 1 декабря</b>.</li>' +
            '<li>Согласовывают <b>все директора</b>: период считается согласованным, когда «за» все трое.</li>' +
            '<li>Отклонение — только с комментарием; отклонённые дни система запоминает, повторно поставить нельзя.</li>' +
            '<li>За ' + D.RULES.noticeDays + ' дней до начала отпуска директору уходит письмо. Напоминания — раз в сутки, всего ' +
              D.RULES.remindMax + '; без ответа отпуск снимается автоматически.</li>' +
            '<li>График закрывается, когда все внесли и директора согласовали.</li>' +
          '</ul>' +
        '</div>' +
      '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: ГРАФИК ОФИСА + наложение отпусков
     ═══════════════════════════════════════════════════════════════════════ */
  function officeScreen() {
    var statuses = [
      { c: 'оф', l: 'В офисе', col: 'var(--blue-l)' },
      { c: 'уд', l: 'Удалёнка', col: 'var(--info-t)' },
      { c: 'об', l: 'На объекте', col: 'var(--ok-t)' },
      { c: 'км', l: 'Командировка', col: 'var(--purple)' },
      { c: 'отп', l: 'Отпуск', col: 'var(--gold)' }
    ];
    var m = 4; // май
    var n = D.daysInMonth(S.year, m);
    var vac = {};
    D.busyInMonth(m).forEach(function (x) {
      D.expand(x.start, x.end).forEach(function (d) { if (D.monthOf(d) === m) vac[x.empId + '|' + d] = x; });
    });

    var head = '<div class="sched-head"><div class="sched-name head">Сотрудник</div><div class="sched-days">';
    for (var d = 1; d <= n; d++) {
      var iso2 = D.iso(S.year, m, d);
      var cls = 'sched-day' + (D.isWeekend(S.year, m, d) ? ' weekend' : '') + (D.isHoliday(iso2) ? ' holiday' : '');
      head += '<div class="' + cls + '"' + (D.isHoliday(iso2) ? ' title="' + esc(D.holidayTitle(iso2)) + '"' : '') + '>' + d + '</div>';
    }
    head += '</div></div>';

    var body = D.GROUPS.map(function (g) {
      return '<div class="os-g">' + g.title + '</div>' + g.members.map(function (emp) {
        var cells = '';
        for (var dd = 1; dd <= n; dd++) {
          var iso3 = D.iso(S.year, m, dd);
          var v = vac[emp.id + '|' + iso3];
          var wk = D.isWeekend(S.year, m, dd);
          var hol = D.isHoliday(iso3);
          if (v) cells += '<div class="os-c v-vac' + (v.status === 'pending' ? ' is-pend' : '') + '" title="' + esc(emp.fio) + ' · отпуск ' + esc(D.fmtRange(v.start, v.end)) + (v.status === 'pending' ? ' (ждёт согласования)' : '') + '"><span>ОТП</span></div>';
          else cells += '<div class="os-c' + (wk ? ' weekend' : '') + (hol ? ' holiday' : '') + '"></div>';
        }
        return '<div class="os-row"><div class="sched-name">' + esc(emp.fio) + '</div><div class="os-cells">' + cells + '</div></div>';
      }).join('');
    }).join('');

    return '' +
      '<div class="os-wrap">' +
        '<div class="os-top">' +
          '<div class="os-top__ic">' + IC.cal + '</div>' +
          '<div class="os-top__tx">' +
            '<div class="os-top__t">График офиса · Май ' + S.year + '</div>' +
            '<div class="os-top__s">Отпуска накладываются на график офиса: ячейка «ОТП» = сотрудник в отпуске (данные графика отпусков).</div>' +
          '</div>' +
          '<button class="btn gold" data-vs-open>' + ic('cal') + 'График отпусков</button>' +
        '</div>' +
        '<div class="os-legend">' + statuses.map(function (s) {
          return '<span class="vs-lg"><i class="vs-b" style="background:' + s.col + '"></i>' + s.l + '</span>';
        }).join('') + '<span class="vs-lg"><i class="vs-b vs-b--hol"></i>праздник РФ</span>' +
          '<span class="vs-lg vs-lg--hint">«ОТП» = в отпуске; жёлтая рамка — период ждёт согласования директора.</span></div>' +
        '<div class="sched-wrap"><div class="sched-grid" style="min-width:max-content">' + head +
          '<div class="os-body">' + body + '</div>' +
        '</div></div>' +
      '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАНЫ: ПИСЬМА (с напоминаниями и автоснятием)
     ═══════════════════════════════════════════════════════════════════════ */
  function mailShell(subject, from, to, when, bodyHtml, footHtml, opts) {
    opts = opts || {};
    return '' +
      '<div class="ml-wrap">' +
        '<div class="ml-card">' +
          '<div class="ml-top">' +
            '<div class="ml-top__ic">' + IC.bell + '</div>' +
            '<div class="ml-top__tx"><div class="ml-top__t">' + esc(subject) + '</div>' +
              '<div class="ml-top__s">' + esc(from) + ' → ' + esc(to) + ' · ' + esc(when) + '</div></div>' +
            (opts.tag || '<span class="badge info">письмо</span>') +
          '</div>' +
          (opts.reminders ? reminderStrip(opts.reminders) : '') +
          '<div class="ml-body">' + bodyHtml + '</div>' +
          (footHtml ? '<div class="ml-foot">' + footHtml + '</div>' : '') +
        '</div>' +
      '</div>';
  }

  /** Полоса напоминаний: 3 письма через сутки, затем автоснятие. */
  function reminderStrip(r) {
    var steps = [];
    for (var i = 1; i <= D.RULES.remindMax; i++) {
      var state = i < r.count ? 'is-done' : (i === r.count ? (r.autoCancelled ? 'is-missed' : 'is-now') : '');
      steps.push('<span class="vs-rem__step ' + state + '">' +
        '<i>' + (i < r.count || r.answered ? IC.check : (i === r.count ? IC.bell : IC.clock)) + '</i>' +
        '<em>' + i + '-е письмо</em>' +
        '<small>' + (i === 1 ? 'за 15 дней' : '+' + (i - 1) + ' сут.') + '</small>' +
        '</span>');
    }
    steps.push('<span class="vs-rem__step ' + (r.autoCancelled ? 'is-missed' : '') + '">' +
      '<i>' + (r.autoCancelled ? IC.x : IC.warn) + '</i><em>автоснятие</em><small>без ответа</small></span>');
    return '' +
      '<div class="vs-rem">' +
        '<div class="vs-rem__h">' + ic('bell') + 'Напоминания директору — раз в сутки, всего ' + D.RULES.remindMax +
          '. Без ответа отпуск снимается автоматически.</div>' +
        '<div class="vs-rem__steps">' + steps.join('<span class="vs-rem__arrow">' + IC.chev + '</span>') + '</div>' +
      '</div>';
  }

  function mailDirectorScreen() {
    var e = D.byId(D.me.id);
    var r = D.rangesOf(e.id).filter(function (x) { return x.start === '2027-05-01' || x.start === '2027-05-15'; })[0] || D.rangesOf(e.id)[D.rangesOf(e.id).length - 1];
    var clashes = D.clashesWith(e.id, r.start, r.end);
    var body = '' +
      '<p>Здравствуйте!</p>' +
      '<p>Через ' + D.RULES.noticeDays + ' дней начинается отпуск сотрудника, который <b>требует вашего решения</b>:</p>' +
      '<table class="ml-tbl">' +
        '<tr><td>Сотрудник</td><td><b>' + esc(e.fio) + '</b></td></tr>' +
        '<tr><td>Должность</td><td>' + esc(D.roleRu(e.role)) + '</td></tr>' +
        '<tr><td>Период</td><td><b>' + D.fmtRange(r.start, r.end) + '</b></td></tr>' +
        '<tr><td>Длительность</td><td><b>' + daysWord(r.days) + '</b>' + (r.hol ? ' (+' + r.hol + ' празд. продлевают)' : '') + '</td></tr>' +
        '<tr><td>Отдел</td><td>' + esc(groupTitle(e.group)) + '</td></tr>' +
        '<tr><td>Пересечения</td><td>' + (clashes.length
            ? clashes.map(function (c) { return esc(c.fio.split(' ')[0]) + ' · ' + c.overlapDays + ' дн.'; }).join('; ')
            : 'нет (проверено по всем отделам)') + '</td></tr>' +
      '</table>' +
      '<p>Согласуем отпуск или нет? Период считается согласованным, когда «за» все директора: ' +
        D.DIRECTORS.map(function (d) { return esc(d.fio.split(' ')[0]); }).join(', ') + '.</p>' +
      '<p class="ml-dim">Если «Нет» — отпуск будет снят, сотрудник получит уведомление и комментарий, ' +
      'а система запомнит эти дни: второй раз поставить их не даст.</p>';
    var foot = '' +
      '<button class="btn ok" data-vs-mail-yes>' + ic('check') + 'Да, согласовать</button>' +
      '<button class="btn danger" data-vs-mail-no>' + ic('x') + 'Нет, снять</button>' +
      '<span class="ml-foot__hint">Ответ придёт сотруднику письмом и уведомлением в CRM.</span>';
    return mailShell('График отпусков: ' + e.fio.split(' ')[0] + ' — ' + D.fmtRange(r.start, r.end),
      'ASGARD CRM <no-reply@asgard-service.ru>', 'Директора', 'сегодня, 09:00', body, foot,
      { reminders: { count: 2, answered: false, autoCancelled: false } });
  }

  function mailEmployeeScreen(kind) {
    var e = D.byId(D.me.id);
    var rs = D.rangesOf(e.id);
    var r = rs.filter(function (x) { return x.start === '2027-05-01'; })[0] || rs[rs.length - 1];
    var ok = kind === 'ok';
    var auto = kind === 'auto';
    var body, foot, subject, tag;
    if (ok) {
      subject = 'Ваш отпуск согласован · ' + D.fmtRange(r.start, r.end);
      tag = '<span class="badge success">согласовано</span>';
      body = '' +
        '<p>Здравствуйте, ' + esc(e.fio.split(' ')[0]) + '!</p>' +
        '<p>Ваш отпуск <b>согласован всеми директорами</b>:</p>' +
        '<table class="ml-tbl">' +
          '<tr><td>Период</td><td><b>' + D.fmtRange(r.start, r.end) + '</b></td></tr>' +
          '<tr><td>Длительность</td><td><b>' + daysWord(r.days) + '</b>' + (r.hol ? ' (+' + r.hol + ' празд. продлевают)' : '') + '</td></tr>' +
          '<tr><td>Согласовали</td><td>' + D.DIRECTORS.map(function (d) { return esc(d.fio); }).join(', ') + '</td></tr>' +
        '</table>' +
        '<p>Напишите заявление на отпуск — форма откроется кнопкой ниже, приказ оформит бухгалтерия.</p>';
      foot = '<button class="btn gold" data-vs-docs-open="zayav">' + ic('doc') + 'Открыть заявление</button>' +
        '<button class="btn ghost" data-vs-docs-open="zayav">' + ic('down') + 'Скачать форму</button>';
    } else if (auto) {
      subject = 'Отпуск снят автоматически · ' + D.fmtRange(r.start, r.end);
      tag = '<span class="badge danger">автоснятие</span>';
      body = '' +
        '<p>Здравствуйте, ' + esc(e.fio.split(' ')[0]) + '!</p>' +
        '<p>Директор <b>не ответил</b> на три напоминания, поэтому отпуск <b>снят автоматически</b>:</p>' +
        '<table class="ml-tbl">' +
          '<tr><td>Период (снят)</td><td><b>' + D.fmtRange(r.start, r.end) + '</b></td></tr>' +
          '<tr><td>Причина</td><td>3 напоминания директору без ответа</td></tr>' +
        '</table>' +
        '<p>Откройте график и поставьте дни заново. <b>Прежние даты недоступны</b> — система их помнит.</p>';
      foot = '<button class="btn primary" data-vs-open-after>' + ic('cal') + 'Переставить отпуск</button>';
    } else {
      subject = 'Отпуск не согласован · ' + D.fmtRange(r.start, r.end);
      tag = '<span class="badge danger">не согласовано</span>';
      body = '' +
        '<p>Здравствуйте, ' + esc(e.fio.split(' ')[0]) + '!</p>' +
        '<p>Ваш отпуск <b>не согласован</b> и снят:</p>' +
        '<table class="ml-tbl">' +
          '<tr><td>Период (снят)</td><td><b>' + D.fmtRange(r.start, r.end) + '</b></td></tr>' +
          '<tr><td>Кто отклонил</td><td>Кудряшов Олег Сергеевич, генеральный директор</td></tr>' +
          '<tr><td>Комментарий (обязательно)</td><td><b class="vs-bad">«На май выпадает сдача объекта по Северной башне — нужны все РП. Возьми отпуск после 20 мая.»</b></td></tr>' +
        '</table>' +
        '<p>Откройте график и переставьте дни. <b>Прежние дни поставить нельзя</b> — система их помнит.</p>';
      foot = '<button class="btn primary" data-vs-open-after>' + ic('cal') + 'Переставить отпуск</button>' +
        '<button class="btn ghost" data-vs-look-comment>' + ic('doc') + 'Посмотреть комментарий</button>';
    }
    return mailShell(subject, 'ASGARD CRM <no-reply@asgard-service.ru>', e.fio, 'сегодня, 09:05', body, foot, { tag: tag });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: ДОКУМЕНТЫ (заявление · приказ Т-6 · график Т-7)
     ═══════════════════════════════════════════════════════════════════════ */
  function docsScreen() {
    var tabs = [
      { k: 'zayav',  t: 'Заявление сотрудника',      who: 'заполняет сотрудник',   icon: 'doc' },
      { k: 'prikaz', t: 'Приказ о предоставлении (Т-6)', who: 'печатает бухгалтерия или админ', icon: 'seal' },
      { k: 't7',     t: 'График отпусков (Т-7)',     who: 'печатает бухгалтерия или директор', icon: 'board' }
    ];
    var tabHtml = tabs.map(function (x) {
      return '<button class="vs-doc-tab' + (S.docsTab === x.k ? ' is-on' : '') + '" data-vs-doc-tab="' + x.k + '">' +
        ic(x.icon) + '<span>' + x.t + '</span></button>';
    }).join('');
    var cur = tabs.filter(function (x) { return x.k === S.docsTab; })[0] || tabs[0];
    return '' +
      '<div class="vs-stage">' +
        '<div class="vs-modal vs-modal--docs">' +
          '<div class="vs-mhead">' +
            '<div class="vs-mhead__ic">' + IC.doc + '</div>' +
            '<div class="vs-mhead__tx">' +
              '<div class="vs-mhead__t">Документы отпуска · ' + S.year + '</div>' +
              '<div class="vs-mhead__s">' + esc(cur.who) + ' · предпросмотр и скачивание</div>' +
            '</div>' +
            '<div class="vs-mhead__acts">' +
              '<button class="btn ghost sm" data-vs-doc-print>' + ic('print') + 'Печать</button>' +
              '<button class="btn gold sm" data-vs-doc-download>' + ic('down') + 'Скачать</button>' +
              '<button class="vsp-x" data-vs-docs-back title="Назад к графику">' + IC.x + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="vs-doc-tabs">' + tabHtml + '</div>' +
          '<div class="vs-doc-note">' + ic('warn') +
            'Предпросмотр — как документ будет напечатан. В проде «Скачать» отдаёт <b>.docx</b> по формам: заявление — сотрудник, приказ Т-6 и график Т-7 — бухгалтерия/админ.</div>' +
          '<div class="vs-doc-host" id="vsDocHost">' + docPreview(S.docsTab) + '</div>' +
        '</div>' +
      '</div>';
  }

  function docPreview(kind) {
    if (kind === 't7') return docT7();
    if (kind === 'prikaz') return docPrikaz();
    return docZayav();
  }

  /** Заявление — по образцу заказчика (плейсхолдеры {ОрганизацияНазвание} и др.). */
  function docZayav() {
    var e = D.byId(D.me.id);
    var r = D.rangesOf(e.id).filter(function (x) { return x.start === '2027-05-01'; })[0] || D.rangesOf(e.id)[D.rangesOf(e.id).length - 1];
    var need = r.days;
    var end = r.hol ? D.extendEnd(r.start, need) : r.end;
    function row(label, val) { return '<div class="doc-r"><span>' + esc(label) + '</span><b>' + esc(val) + '</b></div>'; }
    return '' +
      '<div class="doc-sheet" id="vsDocSheet">' +
        '<div class="doc-head">' +
          '<div class="doc-head__dir">Директору<br>ООО «Асгард-Сервис»<br>Кудряшову О. С.</div>' +
          '<div class="doc-head__from">' + esc(D.roleRu(e.role)) + '<br>' + esc(e.fio) + '<br>Офис · ' + esc(groupTitle(e.group)) + '</div>' +
        '</div>' +
        '<div class="doc-title">ЗАЯВЛЕНИЕ</div>' +
        '<div class="doc-body">Прошу предоставить мне ежегодный оплачиваемый отпуск с ' +
          '<b>' + esc(fmtShort(r.start)) + ' ' + S.year + '</b> по <b>' + esc(fmtShort(end)) + ' ' + S.year + '</b> ' +
          'сроком на <b>' + need + '</b> ' + plural(need, 'календарный день', 'календарных дня', 'календарных дней') + '.</div>' +
        (r.hol ? '<div class="doc-note">Нерабочие праздничные дни (' + esc(D.holidayNote(r.start, r.end).join('; ')) +
          ') в число календарных дней отпуска не включаются и продлевают отпуск (ст. 120 ТК РФ).</div>' : '') +
        '<div class="doc-sign">' +
          '<div class="doc-sign__line"><span>Дата</span><b>«___» __________ ' + S.year + ' г.</b></div>' +
          '<div class="doc-sign__line"><span>Подпись</span><b class="doc-hand">' + esc(e.fio) + '</b></div>' +
        '</div>' +
        '<div class="doc-stamp">Форма заполняется автоматически из графика отпусков</div>' +
      '</div>';
  }

  /** Приказ Т-6 (унифицированная форма, Постановление Госкомстата № 1). */
  function docPrikaz() {
    var e = D.byId(D.me.id);
    var r = D.rangesOf(e.id).filter(function (x) { return x.start === '2027-05-01'; })[0] || D.rangesOf(e.id)[D.rangesOf(e.id).length - 1];
    var end = r.hol ? D.extendEnd(r.start, r.days) : r.end;
    return '' +
      '<div class="doc-sheet doc-sheet--wide" id="vsDocSheet">' +
        '<div class="doc-form">Унифицированная форма № Т-6<br>Утверждена постановлением Госкомстата России от 05.01.2004 № 1</div>' +
        '<table class="doc-t"><tr><td>Код</td><td class="right">Форма по ОКУД</td><td class="right">0301005</td></tr>' +
          '<tr><td></td><td class="right">по ОКПО</td><td class="right">—</td></tr></table>' +
        '<div class="doc-org">ООО «Асгард-Сервис»</div>' +
        '<div class="doc-caption">(наименование организации)</div>' +
        '<table class="doc-t"><tr><td>Номер документа</td><td>Дата составления</td></tr>' +
          '<tr><td class="doc-b">__ / ______</td><td class="doc-b">«___» __________ ' + S.year + ' г.</td></tr></table>' +
        '<div class="doc-title2">ПРИКАЗ<br>(распоряжение)<br>о предоставлении отпуска работнику</div>' +
        '<table class="doc-t doc-t--cols">' +
          '<tr><td class="doc-lbl">Табельный номер</td><td class="doc-b">' + (r.empTab || '0231') + '</td></tr>' +
          '<tr><td class="doc-lbl">ФИО</td><td class="doc-b">' + esc(e.fio) + '</td></tr>' +
          '<tr><td class="doc-lbl">Структурное подразделение</td><td class="doc-b">' + esc(groupTitle(e.group)) + '</td></tr>' +
          '<tr><td class="doc-lbl">Должность</td><td class="doc-b">' + esc(D.roleRu(e.role)) + '</td></tr>' +
        '</table>' +
        '<div class="doc-range doc-workperiod">за период работы с «__» __________ ' + (S.year - 1) + ' г. по «__» __________ ' + S.year + ' г.</div>' +
        '<div class="doc-sec">А. ежегодный основной оплачиваемый отпуск на <b>' + r.days + '</b> календарных дней</div>' +
        '<div class="doc-range">с «<b>' + D.parseIso(r.start).d + '</b>» ' + D.MONTHS_GEN[D.parseIso(r.start).m] + ' ' + S.year + ' г. ' +
          'по «<b>' + D.parseIso(end).d + '</b>» ' + D.MONTHS_GEN[D.parseIso(end).m] + ' ' + S.year + ' г.</div>' +
        '<div class="doc-sec doc-sec--b">Б. ежегодный дополнительный оплачиваемый отпуск, учебный, без сохранения заработной платы и другие (указать) — <b>не предоставляется</b></div>' +
        '<div class="doc-sec">В. Всего отпуск на <b>' + r.days + '</b> календарных дней</div>' +
        '<div class="doc-range">с «<b>' + D.parseIso(r.start).d + '</b>» ' + D.MONTHS_GEN[D.parseIso(r.start).m] + ' ' + S.year + ' г. ' +
          'по «<b>' + D.parseIso(end).d + '</b>» ' + D.MONTHS_GEN[D.parseIso(end).m] + ' ' + S.year + ' г.</div>' +
        '<table class="doc-t doc-sign-t"><tr><td>Руководитель организации</td><td class="doc-b">Кудряшов О. С.</td></tr>' +
          '<tr><td class="doc-caption">(должность)</td><td class="doc-caption">(личная подпись) (расшифровка подписи)</td></tr></table>' +
        '<div class="doc-note">С приказом (распоряжением) работник ознакомлен: «___» __________ ' + S.year + ' г.  ____________</div>' +
      '</div>';
  }

  /** График отпусков Т-7 — таблица со всеми офисными сотрудниками (10 граф по форме 0301020). */
  function docT7() {
    var rows = D.GROUPS.map(function (g) {
      return g.members.map(function (e) {
        var rs = D.rangesOf(e.id).filter(function (r) { return r.status !== 'rejected'; })
          .slice().sort(function (a, b) { return a.start < b.start ? -1 : 1; });
        var first = rs.filter(function (r) { return r.days >= 14; })[0] || rs[0];
        var rest = rs.filter(function (r) { return r !== first; });
        var pend = rs.some(function (r) { return r.status === 'pending'; });
        return '<tr>' +
          '<td>' + esc(g.title) + '</td>' +                                                   /* 1 */
          '<td>' + esc(D.roleRu(e.role)) + '</td>' +                                          /* 2 */
          '<td>' + esc(e.fio) + '</td>' +                                                     /* 3 */
          '<td class="num">' + (2300 + e.id % 1000) + '</td>' +                               /* 4 */
          '<td class="num">' + (first ? first.days : '') + '</td>' +                          /* 5 количество дней */
          '<td>' + (first ? esc(fmtDot(first.start)) : '') + '</td>' +                        /* 6 запланированная */
          '<td>' + (first ? esc(fmtDot(first.end)) : '') + '</td>' +                          /* 7 фактическая */
          '<td>' + (rest.length ? esc(rest.map(function (r) { return r.days + ' дн. с ' + fmtDot(r.start); }).join('; ')) : '') + '</td>' + /* 8 основание */
          '<td>' + (rest.length ? esc(fmtDot(rest[0].start)) : '') + '</td>' +                /* 9 дата предполагаемого */
          '<td>' + (pend ? 'на согласовании' : (rs.length ? 'согласовано' : '')) + '</td>' +  /* 10 примечание */
        '</tr>';
      }).join('');
    }).join('');
    return '' +
      '<div class="doc-sheet doc-sheet--wide" id="vsDocSheet">' +
        '<div class="doc-form">Унифицированная форма № Т-7<br>Утверждена Постановлением Госкомстата России от 05.01.2004 № 1</div>' +
        '<table class="doc-t"><tr><td>Код</td><td class="right">Форма по ОКУД</td><td class="right">0301020</td></tr>' +
          '<tr><td></td><td class="right">по ОКПО</td><td class="right">—</td></tr></table>' +
        '<table class="doc-t doc-t--2col">' +
          '<tr><td>Номер документа</td><td>Дата составления</td><td>На год</td></tr>' +
          '<tr><td class="doc-b">__ / ______</td><td class="doc-b">«___» __________ ' + (S.year - 1) + ' г.</td><td class="doc-b">' + S.year + '</td></tr>' +
        '</table>' +
        '<div class="doc-title2">ГРАФИК ОТПУСКОВ</div>' +
        '<table class="doc-t doc-t--grid">' +
          '<thead>' +
            /* Шапка строго по форме 0301020: 3 ряда + нумерация.
               Графы 1–4 и 10 — вертикальное объединение на все ряды;
               «ОТПУСК» охватывает графы 5–9 (colspan=5) — дыры над 9–10 нет. */
            '<tr>' +
              '<th rowspan="3">Структурное подразделение</th>' +
              '<th rowspan="3">Должность (специальность, профессия) по штатному расписанию</th>' +
              '<th rowspan="3">Фамилия, имя, отчество</th>' +
              '<th rowspan="3">Табельный номер</th>' +
              '<th colspan="5">ОТПУСК</th>' +
              '<th rowspan="3">Примечание</th>' +
            '</tr>' +
            '<tr>' +
              '<th>количество календарных дней</th>' +
              '<th colspan="2">дата</th>' +
              '<th colspan="2">перенесение отпуска</th>' +
            '</tr>' +
            '<tr>' +
              '<th></th>' +
              '<th>запланированная</th>' +
              '<th>фактическая</th>' +
              '<th>основание (документ)</th>' +
              '<th>дата предполагаемого отпуска</th>' +
            '</tr>' +
            '<tr class="doc-nums"><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td><td>9</td><td>10</td></tr>' +
          '</thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
        '<table class="doc-t doc-sign-t"><tr><td>Руководитель кадровой службы</td><td class="doc-b">Лебедева И. П.</td></tr>' +
          '<tr><td class="doc-caption">(должность)</td><td class="doc-caption">(личная подпись) (расшифровка подписи)</td></tr></table>' +
      '</div>';
  }
  function fmtDot(iso) { var p = D.parseIso(iso); return D.pad(p.d) + '.' + D.pad(p.m + 1) + '.' + p.y; }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: НАСТРОЙКА ДНЕЙ (бухгалтерия)
     ═══════════════════════════════════════════════════════════════════════ */
  function buhScreen() {
    var rows = D.GROUPS.map(function (g) {
      return '<tr class="vs-buh-g"><td colspan="7">' + esc(g.title) + '</td></tr>' +
        g.members.map(function (e) {
          var d = D.DAYS[e.id] || { availableOnJan1: 42, lastYearUnused: 0 };
          var b = D.balance(e.id);
          return '<tr>' +
            '<td><div class="vs-who__n">' + esc(e.fio) + '</div><div class="vs-who__r">' + esc(D.roleRu(e.role)) + '</div></td>' +
            '<td>' + esc(g.title) + '</td>' +
            '<td class="right"><input class="input vs-inp" type="number" min="0" max="90" value="' + d.availableOnJan1 + '" data-buh-avail="' + e.id + '"><div class="vs-inp__h">положено за год</div></td>' +
            '<td class="right"><input class="input vs-inp" type="number" min="0" max="90" value="' + d.lastYearUnused + '" data-buh-carry="' + e.id + '"><div class="vs-inp__h">не отгулено за ' + (S.year - 1) + '</div></td>' +
            '<td class="right num">' + b.plannedTotal + '</td>' +
            '<td class="right num"><b>' + b.left + '</b></td>' +
            '<td><span class="vs-chip ' + (b.pending ? D.ST.pending.cls : D.ST.approved.cls) + '">' + (b.pending ? 'ждёт решения' : 'ок') + '</span></td>' +
          '</tr>';
        }).join('');
    }).join('');
    return '' +
      '<div class="vs-stage">' +
        '<div class="vs-modal vs-modal--buh">' +
          '<div class="vs-mhead">' +
            '<div class="vs-mhead__ic">' + IC.gift + '</div>' +
            '<div class="vs-mhead__tx"><div class="vs-mhead__t">Настройка дней отпуска · ' + S.year + '</div>' +
              '<div class="vs-mhead__s">Бухгалтерия · только офис (не для рабочих) · балансы и периоды видны</div></div>' +
            '<div class="vs-mhead__acts">' +
              '<button class="btn ghost sm" data-vs-docs>' + ic('doc') + 'Документы</button>' +
              '<button class="btn gold sm" data-vs-buh-save>' + ic('check') + 'Сохранить</button>' +
            '</div>' +
          '</div>' +
          '<div class="vs-buhnote">' + ic('warn') +
            'Основной отпуск — 28 календарных дней (ст. 115 ТК). «Положено за год» — сколько дней доступно сотруднику на 01.01.' + S.year +
            '; «не отгулено за ' + (S.year - 1) + '» переносится отдельной строкой. Переносить можно не более 12 дней (ст. 124 ТК) — ' +
            'проверяйте поле подсветкой.</div>' +
          '<div class="tablewrap"><table class="asg vs-buhtbl">' +
            '<thead><tr><th>Сотрудник</th><th>Отдел</th><th class="right">Положено за год</th>' +
              '<th class="right">Не отгулено за ' + (S.year - 1) + '</th><th class="right">Запланировано</th><th class="right">Остаток</th><th>Статус</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div>' +
        '</div>' +
      '</div>';
  }

  /* ── Экспорт ─────────────────────────────────────────────────────────── */
  window.VS_VIEWS = {
    S: S, esc: esc, initials: initials, toast: toast, ic: ic, IC: IC,
    scheduleScreen: scheduleScreen, officeScreen: officeScreen, docsScreen: docsScreen,
    mailDirectorScreen: mailDirectorScreen, mailEmployeeScreen: mailEmployeeScreen,
    buhScreen: buhScreen, groupTitle: groupTitle, selBar: selBar, rulesModalIfAny: rulesModalIfAny,
    docPreview: docPreview, pendingAll: pendingAll, plural: plural, daysWord: daysWord
  };
})();
