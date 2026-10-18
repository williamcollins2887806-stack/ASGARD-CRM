/* ASGARD CRM — прототип графика отпусков: экраны (живые DOM-функции, переносятся в ваниль 1:1). */
(function () {
  'use strict';
  var D = window.VS_DATA;

  /* ── Состояние прототипа ─────────────────────────────────────────────── */
  var S = {
    theme: 'dark',
    year: D.YEAR,
    openMonth: null,         // раскрытый месяц (только один). null — все свёрнуты
    expansion: false,        // есть ли раскрытый месяц
    role: 'me',              // 'me' | 'director' | 'buh'
    sel: {},                 // 'YYYY-MM-DD' -> true (текущее выделение)
    rangeStart: null,        // для протяжки диапазона
    editingId: null,         // какой период правим
    hiddenGroups: {},        // скрытые отделы
    hiddenPeople: {},        // скрытые сотрудники
    blocked: {},             // 'YYYY-MM-DD' -> true (отклонённые директором дни, повторно нельзя)
    deptOnly: false,         // «только мой отдел»
    note: null,              // {type,msg}
    closed: false,           // график закрыт (все согласованы)
    notifySent: false,       // отправлено на согласование
    cal: { y: D.YEAR, m: 4 } // месяц, показанный в модалке-календаре
  };

  window.VS_STATE = S;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function initials(fio) { var p = String(fio).split(' '); return (p[0][0] || '') + (p[1] ? p[1][0] : ''); }
  function toast(t, m, type) {
    var host = document.getElementById('toast'); if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'ok');
    el.innerHTML = '<b>' + esc(t) + '</b>' + (m ? '<span>' + esc(m) + '</span>' : '');
    host.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 300); }, 3200);
  }

  /* ── Стилизация ячеек ────────────────────────────────────────────────── */
  function cellState(empId, iso) {
    var rs = D.rangesOf(empId);
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      var inside = iso >= r.start && iso <= r.end;
      if (!inside) continue;
      if (r.status === 'rejected') return { code: 'rejected', r: r };
      return { code: r.status, r: r };
    }
    return null;
  }
  function cellCls(empId, iso, isMine, isSel, weekend) {
    var st = cellState(empId, iso);
    var c = ['vs-d'];
    if (weekend) c.push('is-wk');
    if (isMine) c.push('is-mine');
    if (isSel) c.push('is-sel');
    if (st) {
      c.push('is-vac');
      c.push(st.code === 'approved' ? 'v-ok' : st.code === 'pending' ? 'v-pend' : st.code === 'rejected' ? 'v-bad' : 'v-draft');
    }
    return c.join(' ');
  }

  /* ── Блок: два щита слева + «всего можно взять» справа ───────────────── */
  function balanceStrip(empId) {
    var b = D.balance(empId);
    var canTake = Math.max(0, b.left);
    return '' +
      '<div class="vs-bal">' +
        '<div class="vs-acc vs-acc--avail">' +
          '<div class="vs-acc__ic">🎯</div>' +
          '<div class="vs-acc__tx">' +
            '<div class="vs-acc__l">Доступно на 01.01.' + S.year + '</div>' +
            '<div class="vs-acc__v num">' + b.availableOnJan1 + ' <small>кал. дн.</small></div>' +
          '</div>' +
        '</div>' +
        '<div class="vs-acc vs-acc--carry">' +
          '<div class="vs-acc__ic">↩︎</div>' +
          '<div class="vs-acc__tx">' +
            '<div class="vs-acc__l">Не отгулено за ' + (S.year - 1) + '</div>' +
            '<div class="vs-acc__v num">' + b.lastYearUnused + ' <small>кал. дн.</small></div>' +
          '</div>' +
        '</div>' +
        '<div class="vs-acc vs-acc--can">' +
          '<div class="vs-acc__tx">' +
            '<div class="vs-acc__l">Можно взять ещё</div>' +
            '<div class="vs-acc__v num">' + canTake + ' <small>из ' + b.availableOnJan1 + '</small></div>' +
            '<div class="vs-acc__bars">' +
              '<i class="vs-b vs-b--ok" style="width:' + pct(b.approved, b.availableOnJan1) + '%"></i>' +
              '<i class="vs-b vs-b--pend" style="width:' + pct(b.pending, b.availableOnJan1) + '%"></i>' +
              '<i class="vs-b vs-b--free" style="width:' + pct(canTake, b.availableOnJan1) + '%"></i>' +
            '</div>' +
            '<div class="vs-acc__lg"><span><i class="vs-b vs-b--ok"></i>отгуляно ' + b.approved + '</span>' +
              '<span><i class="vs-b vs-b--pend"></i>на согласовании ' + b.pending + '</span>' +
              '<span><i class="vs-b vs-b--free"></i>свободно ' + canTake + '</span></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }
  function pct(v, total) { return total ? Math.max(0, Math.min(100, Math.round(v / total * 100))) : 0; }

  /* ── Помощник: имена периодов сотрудника (чипы) ──────────────────────── */
  function chipsOf(empId) {
    var rs = D.rangesOf(empId).slice().sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    if (!rs.length) return '<span class="vs-chip vs-chip--none">отпусков нет</span>';
    return rs.map(function (r) {
      var st = D.ST[r.status];
      var m = D.parseIso ? 0 : 0;
      var sm = D.MONTHS[Number(r.start.slice(5, 7)) - 1];
      var tail = st.short + ' ' + r.days + 'д';
      var title = D.fmtRange(r.start, r.end) + ' · ' + st.label + (r.reason ? ' · причина: ' + r.reason : '');
      return '<span class="vs-chip ' + st.cls + '" title="' + esc(title) + '" data-period="' + r.id + '" data-emp="' + empId + '">' +
        '<b>' + sm.slice(0, 3) + '</b> ' + tail + '</span>';
    }).join('');
  }

  /* ── Заголовок модалки ───────────────────────────────────────────────── */
  function modalHead() {
    var isDir = S.role === 'director';
    var isMe = S.role === 'me';
    var who = isDir ? { fio: 'Все директора', role: 'Согласование графика отпусков' } :
              isMe ? { fio: D.byId(D.me.id).fio, role: D.roleRu(D.me.role) } :
                     { fio: 'Бухгалтерия', role: 'Настройка дней' };
    return '' +
      '<div class="vs-mhead">' +
        '<div class="vs-mhead__ic">🗓</div>' +
        '<div class="vs-mhead__tx">' +
          '<div class="vs-mhead__t">График отпусков · ' + S.year + ' <span class="badge gold">офис</span></div>' +
          '<div class="vs-mhead__s">' + esc(who.fio) + ' · ' + esc(who.role) + ' · дни календарные</div>' +
        '</div>' +
        '<div class="vs-mhead__acts">' +
          '<button class="btn ghost sm" data-vs-rules>📋 Правила</button>' +
          (isDir ? '<button class="btn ok sm" data-vs-approve-all>Согласовать все отправленные</button>' : '') +
          (isDir ? '<button class="btn ghost sm" data-vs-close-graph>🔒 Закрыть график</button>' : '') +
          (isMe ? '<button class="btn gold sm" data-vs-submit>Готово и согласовать</button>' : '') +
          '<button class="pp-dr__x" data-vs-close-modal-manual title="Закрыть">✕</button>' +
        '</div>' +
      '</div>' +
      (S.closed ? '<div class="vs-closed">🔒 График согласован всеми директорами и закрыт. Редактирование недоступно.</div>' : '') +
      (isDir ? directorBar() : '') +
      (S.note ? '<div class="vs-note vs-note--' + S.note.type + '">' + esc(S.note.msg) + '</div>' : '');
  }

  /* ── Панель директора ────────────────────────────────────────────────── */
  function directorBar() {
    var pend = 0, filled = 0, total = D.ALL.length;
    D.ALL.forEach(function (e) {
      var rs = D.rangesOf(e.id);
      if (rs.some(function (r) { return r.status === 'pending'; })) pend++;
      var b = D.balance(e.id);
      if (b.plannedTotal > 0) filled++;
    });
    return '' +
      '<div class="vs-dirbar">' +
        '<div class="vs-dirbar__i"><b class="num">' + filled + '/' + total + '</b><span>заполнили график</span></div>' +
        '<div class="vs-dirbar__sep"></div>' +
        '<div class="vs-dirbar__i vs-dirbar__i--hot"><b class="num">' + pend + '</b><span>ждут согласования</span></div>' +
        '<div class="vs-dirbar__sep"></div>' +
        '<div class="vs-dirbar__hint">При отклонении <b>комментарий обязателен</b> — сотрудник увидит его и переставит дни. ' +
          'Отклонённые дни система запоминает и второй раз поставить не даст.</div>' +
      '</div>';
  }

  /* ── Единый grid-шаблон колонок (заголовок и строки совпадают) ───────── */
  var OPEN_W = 'minmax(340px, 1.32fr)';   // ширина раскрытого месяца
  var MINI_W = '21px';                    // ширина свёрнутого месяца
  function colTemplate() {
    var cols = ['var(--vs-name-w)'];
    for (var m = 0; m < 12; m++) {
      cols.push((S.expansion && S.openMonth === m) ? OPEN_W : MINI_W);
    }
    return cols.join(' ');
  }

  /* ── Месячная батарея (кнопки месяцев) + заголовок таблицы ───────────── */
  function monthsHeader(isMe) {
    var cells = '';
    for (var m = 0; m < 12; m++) {
      var open = S.expansion && S.openMonth === m;
      if (open) {
        cells += '<div class="vs-days vs-days--head" data-month-nav="' + m + '" title="Скрыть ' + D.MONTHS[m] + '">' +
          '<div class="vs-days__cap">' + D.MONTHS[m] + ' · нажмите, чтобы скрыть</div>' +
          '<div class="vs-days__wd">' + D.WEEKDAYS.map(function (w) {
            return '<div class="vs-d vs-d--wd">' + w + '</div>';
          }).join('') + '</div>' +
          '<div class="vs-days__nm">' + dayNums(m).map(function (cell) {
            return '<div class="vs-d vs-d--hd' + (cell.wk ? ' is-wk' : '') + '">' + cell.d + '</div>';
          }).join('') + '</div></div>';
      } else {
        var mk = isMe ? D.monthMark(D.me.id, m) : null;
        cells += '<div class="vs-mon' + (mk ? ' has-mark' : '') + ' vs-mon--head" data-month="' + m + '" title="Раскрыть ' + D.MONTHS[m] + '">' +
          '<span class="vs-mon__n">' + D.MONTHS[m].slice(0, 3) + '</span>' +
          (mk ? '<span class="vs-mon__mk ' + (mk.pending ? 'is-pend' : mk.rejected ? 'is-bad' : 'is-ok') + '">' + mk.days + '</span>' : '') +
          '</div>';
      }
    }
    return '<div class="vs-head" style="grid-template-columns:' + colTemplate() + '">' +
      '<div class="vs-name vs-name--head"><span>Сотрудник</span>' +
        '<small>отдел · должность · отпуска за год</small>' +
        (isMe ? '<button class="vs-hideall" data-vs-dept-only>' + (S.deptOnly ? '👥 Все отделы' : '🎯 Только мой отдел') + '</button>' : '') +
      '</div>' + cells + '</div>';
  }
  function dayNums(m) {
    var n = D.daysInMonth(S.year, m), out = [];
    for (var d = 1; d <= n; d++) out.push({ d: d, wk: D.isWeekend(S.year, m, d) });
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
          var iso = D.iso(S.year, m, cell.d);
          var sel = !!S.sel[iso] && (S.role === 'me' && isMine);
          var editable = S.role === 'me' && isMine && !S.closed;
          var st = cellState(emp.id, iso);
          var blocked = S.blocked && S.blocked[iso] && isMine;
          var c = cellCls(emp.id, iso, isMine, sel, cell.wk);
          if (blocked) c += ' is-blocked';
          var attrs = editable ? ' data-day="' + iso + '" data-emp="' + emp.id + '" role="button"' : '';
          if (!editable && st) attrs += ' data-vs-why="' + (isMine ? '' : 'Это дни другого сотрудника — их видно, но править нельзя') + '"';
          if (blocked) attrs += ' data-vs-blocked="' + iso + '"';
          var title = iso + (st ? ' · ' + D.ST[st.code].label : '') + (blocked ? ' · отклонено директором — повторно нельзя' : '');
          var lbl = (isMine && S.expansion && S.openMonth === m) ? cell.d : '';
          return '<div class="' + c + '"' + attrs + ' title="' + esc(title) + '">' +
            (st ? '<i class="vs-d__dot"></i>' : '') + lbl +
            '</div>';
        }).join('') + '</div>';
      } else {
        var mk = D.monthMark(emp.id, m);
        cells += '<div class="vs-mon' + (mk ? ' has-mark' : '') + '" title="' + D.MONTHS[m] + (mk ? ' · ' + mk.days + ' дн.' : '') + '">' +
          (mk ? '<span class="vs-mon__mk ' + (mk.pending ? 'is-pend' : mk.rejected ? 'is-bad' : 'is-ok') + '">' + mk.days + '</span>' : '') +
          '</div>';
      }
    }
    var leftCls = b.left < 0 ? ' is-neg' : '';
    return '' +
      '<div class="vs-row' + (isMine ? ' is-me' : '') + '" style="grid-template-columns:' + colTemplate() + '">' +
        '<div class="vs-name">' +
          '<div class="vs-who">' +
            '<span class="vs-ava">' + initials(emp.fio) + '</span>' +
            '<div class="vs-who__tx">' +
              '<div class="vs-who__n">' + esc(emp.fio) + (isMine ? ' <span class="vs-you">вы</span>' : '') + '</div>' +
              '<div class="vs-who__r">' + esc(D.roleRu(emp.role)) + '</div>' +
            '</div>' +
            (isMe || S.role === 'director' ? '<button class="vs-hide" data-vs-hide="' + emp.id + '" title="Скрыть строку — останутся только нужные люди">👁</button>' : '') +
          '</div>' +
          '<div class="vs-chips">' + chipsOf(emp.id) + '</div>' +
          '<div class="vs-left' + leftCls + '">остаток: <b class="num">' + b.left + '</b> дн.' +
            (b.lastYearUnused ? ' · перенос ' + b.lastYearUnused : '') + '</div>' +
        '</div>' +
        cells +
      '</div>';
  }

  /* ── Панель выделения (диапазон) ─────────────────────────────────────── */
  function selBar() {
    if (S.role !== 'me' || S.closed) return '';
    var days = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).sort();
    if (!days.length) return '';
    var start = days[0], end = days[days.length - 1];
    var v = D.validate(D.me.id, start, end, { ignoreId: S.editingId, blocked: D.blockedDays() });
    return '' +
      '<div class="vs-selbar">' +
        '<div class="vs-selbar__tx">' +
          '<div class="vs-selbar__r">' + D.fmtRange(start, end) + '</div>' +
          '<div class="vs-selbar__d">' + v.days + ' кал. дн. · ' +
            (v.ok ? (v.isLong ? 'основной отпуск (до 14)' : 'дополнительный (до 7)') : '<span class="vs-bad">' + esc(v.msg) + '</span>') +
          '</div>' +
        '</div>' +
        '<button class="btn ghost sm" data-vs-clear>Очистить</button>' +
        '<button class="btn primary sm" data-vs-save' + (v.ok ? '' : ' disabled title="' + esc(v.msg) + '"') + '>' +
          (S.editingId ? 'Сохранить правку' : 'Поставить отпуск') + '</button>' +
      '</div>';
  }

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
      return '<div class="vs-group"><span class="vs-group__t">' + esc(g.title) + '</span><span class="vs-group__c">' + members.length + ' чел.</span>' +
        (isMe ? '<button class="vs-hide vs-hide--grp" data-vs-hidegroup="' + g.key + '" title="Скрыть отдел «' + esc(g.title) + '»">👁 скрыть отдел</button>' : '') +
        '</div>' +
        members.map(function (m) { return personRow(m, isMe); }).join('');
    }).join('');

    var hiddenChips = Object.keys(S.hiddenGroups).map(function (k) {
      return '<button class="vs-chip vs-chip--none" data-vs-unhidegroup="' + k + '">показать отдел «' + esc(groupTitle(k)) + '»</button>';
    }).join('') + Object.keys(S.hiddenPeople || {}).map(function (id) {
      var e = D.byId(+id); return e ? '<button class="vs-chip vs-chip--none" data-vs-unhide="' + id + '">показать ' + esc(e.fio.split(' ')[0]) + '</button>' : '';
    }).join('');

    return '' +
      '<div class="vs-stage">' +
        '<div class="vs-modal">' +
          modalHead() +
          balanceStrip(meId) +
          '<div class="vs-legend">' +
            '<span class="vs-lg"><i class="vs-b vs-b--ok"></i>согласовано</span>' +
            '<span class="vs-lg"><i class="vs-b vs-b--pend"></i>на согласовании</span>' +
            '<span class="vs-lg"><i class="vs-b vs-b--bad"></i>не согласовано</span>' +
            '<span class="vs-lg"><i class="vs-b vs-b--wk"></i>выходной</span>' +
            '<span class="vs-lg"><i class="vs-b vs-b--blocked"></i>отклонено — повторно нельзя</span>' +
            '<span class="vs-lg vs-lg--hint">основной отпуск — 14 дн. разом один раз в год; остальные — до 7 дн.; дни календарные</span>' +
          '</div>' +
          (hiddenChips ? '<div class="vs-hiddenbar">' + hiddenChips + '</div>' : '') +
          '<div class="vs-tablewrap">' +
            monthsHeader(isMe) +
            '<div class="vs-body">' + (rows || '<div class="empty-state"><div class="icon">👥</div><div class="title">Отделы скрыты</div></div>') + '</div>' +
          '</div>' +
          selBar() +
          '<div class="vs-foot">' +
            '<div class="vs-foot__tx">' + footHint() + '</div>' +
            (S.role === 'me' && !S.closed ? '<button class="btn gold" data-vs-submit>Готово и согласовать</button>' : '') +
            (S.role === 'director' ? '<button class="btn ok" data-vs-approve-all>Согласовать все отправленные</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      rulesModalIfAny();
  }

  function groupTitle(k) {
    var t = k; D.GROUPS.forEach(function (g) { if (g.key === k) t = g.title; }); return t;
  }

  function footHint() {
    if (S.closed) return '🔒 График закрыт — правки невозможны.';
    if (S.role === 'director') return 'Нажмите на человека, чтобы разобрать его периоды. Отклонение — с обязательным комментарием.';
    if (S.role === 'me') return 'Нажмите месяц, затем дни. Только один месяц раскрыт за раз. Свои дни — правите вы, чужие — видите.';
    return 'Ввод количества дней — на экране «Настройка дней» (бухгалтерия).';
  }

  /* ── Модалка «Правила» ───────────────────────────────────────────────── */
  function rulesModalIfAny() {
    if (!S._rules) return '';
    return '' +
      '<div class="vs-ov" data-vs-rules-close>' +
        '<div class="vs-rules" data-stop>' +
          '<div class="vs-rules__h"><b>Правила графика отпусков (офис)</b><button class="pp-dr__x" data-vs-rules-close>✕</button></div>' +
          '<ul class="vs-rules__l">' +
            '<li>Основной отпуск — <b>14 календарных дней разом, один раз в год</b>.</li>' +
            '<li>Остальные отпуска — <b>не более 7 календарных дней</b>, не более ' + D.RULES.maxParts + ' периодов за год.</li>' +
            '<li>Дни считаются <b>календарные</b> (выходные входят в отпуск).</li>' +
            '<li>Сотрудник правит <b>только свои</b> дни, чужие видит — так видно пересечения.</li>' +
            '<li>Согласовывают <b>все директора</b>. Отклонение — только с комментарием; отклонённые дни второй раз поставить нельзя.</li>' +
            '<li>За ' + D.RULES.noticeDays + ' дней до начала отпуска директору уходит письмо с кнопками «Да / Нет».</li>' +
            '<li>График закрывается, когда все внесли и директора согласовали.</li>' +
          '</ul>' +
        '</div>' +
      '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: ГРАФИК ОФИСА (vanilla) + кнопка + наложение отпусков
     ═══════════════════════════════════════════════════════════════════════ */
  function officeScreen() {
    var statuses = [
      { c: 'оф', l: 'В офисе', col: 'var(--blue-l)' },
      { c: 'уд', l: 'Удалёнка', col: 'var(--info-t)' },
      { c: 'об', l: 'На объекте', col: 'var(--ok-t)' },
      { c: 'км', l: 'Командировка', col: 'var(--purple)' },
      { c: 'вх', l: 'Выходной', col: 'var(--t3)' },
      { c: 'о', l: 'Отпуск', col: 'var(--gold)' }
    ];
    var m = 4; // май
    var n = D.daysInMonth(S.year, m);
    var vac = {};
    D.busyInMonth(m).forEach(function (x) {
      D.expand(x.start, x.end).forEach(function (d) { if (D.monthOf(d) === m) vac[x.empId + '|' + d] = x; });
    });

    var head = '<div class="sched-head"><div class="sched-name head">Сотрудник</div><div class="sched-days">';
    for (var d = 1; d <= n; d++) head += '<div class="sched-day' + (D.isWeekend(S.year, m, d) ? ' weekend' : '') + '">' + d + '</div>';
    head += '</div></div>';

    var body = D.GROUPS.map(function (g) {
      return '<div class="os-g">' + g.title + '</div>' + g.members.map(function (emp) {
        var cells = '';
        for (var dd = 1; dd <= n; dd++) {
          var iso = D.iso(S.year, m, dd);
          var v = vac[emp.id + '|' + iso];
          var wk = D.isWeekend(S.year, m, dd);
          if (v) cells += '<div class="os-c v-vac" title="' + esc(emp.fio) + ' · отпуск"><span>ОТП</span></div>';
          else cells += '<div class="os-c' + (wk ? ' weekend' : '') + '"></div>';
        }
        return '<div class="os-row"><div class="sched-name">' + esc(emp.fio) + '</div><div class="os-cells">' + cells + '</div></div>';
      }).join('');
    }).join('');

    return '' +
      '<div class="os-wrap">' +
        '<div class="os-top">' +
          '<div><div class="os-top__t">🗓 График офиса · Май ' + S.year + '</div>' +
            '<div class="os-top__s">Кнопка «График отпусков» открывает полноэкранный график; отпуска ложатся поверх графика офиса.</div></div>' +
          '<button class="btn gold" data-vs-open><span class="ic">🗓</span>График отпусков</button>' +
        '</div>' +
        '<div class="os-legend">' + statuses.map(function (s) {
          return '<span class="vs-lg"><i class="vs-b" style="background:' + s.col + '"></i>' + s.l + '</span>';
        }).join('') + '<span class="vs-lg vs-lg--hint">«ОТП» = сотрудник в отпуске (данные графика отпусков).</span></div>' +
        '<div class="sched-wrap"><div class="sched-grid" style="min-width:max-content">' + head +
          '<div class="os-body">' + body + '</div>' +
        '</div></div>' +
      '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАНЫ: ПИСЬМА
     ═══════════════════════════════════════════════════════════════════════ */
  function mailShell(subject, from, to, when, bodyHtml, footHtml) {
    return '' +
      '<div class="ml-wrap">' +
        '<div class="ml-card">' +
          '<div class="ml-top">' +
            '<div class="ml-top__ic">✉️</div>' +
            '<div><div class="ml-top__t">' + esc(subject) + '</div>' +
              '<div class="ml-top__s">' + esc(from) + ' → ' + esc(to) + ' · ' + esc(when) + '</div></div>' +
            '<span class="badge info">письмо</span>' +
          '</div>' +
          '<div class="ml-body">' + bodyHtml + '</div>' +
          (footHtml ? '<div class="ml-foot">' + footHtml + '</div>' : '') +
        '</div>' +
      '</div>';
  }

  /** Письмо директору за 15 дней до отпуска. */
  function mailDirectorScreen() {
    var e = D.byId(D.me.id);
    var r = D.rangesOf(e.id).filter(function (x) { return x.start === '2027-05-01'; })[0];
    var body = '' +
      '<p>Здравствуйте!</p>' +
      '<p>Через ' + D.RULES.noticeDays + ' дней начинается отпуск сотрудника, который <b>требует вашего решения</b>:</p>' +
      '<table class="ml-tbl">' +
        '<tr><td>Сотрудник</td><td><b>' + esc(e.fio) + '</b></td></tr>' +
        '<tr><td>Должность</td><td>' + esc(D.roleRu(e.role)) + '</td></tr>' +
        '<tr><td>Период</td><td><b>' + D.fmtRange(r.start, r.end) + '</b></td></tr>' +
        '<tr><td>Длительность</td><td><b>' + r.days + ' календарных дней</b></td></tr>' +
        '<tr><td>Отдел</td><td>' + esc(groupTitle(e.group)) + '</td></tr>' +
        '<tr><td>Пересечения</td><td>нет (проверено по отделу)</td></tr>' +
      '</table>' +
      '<p>Согласуем отпуск или нет?</p>' +
      '<p class="ml-dim">Если «Нет» — отпуск будет снят, сотрудник получит уведомление и переставит дни. ' +
      'Второй раз поставить эти же дни система не даст.</p>';
    var foot = '' +
      '<button class="btn ok" data-vs-mail-yes>✓ Да, согласовать</button>' +
      '<button class="btn danger" data-vs-mail-no>✕ Нет, снять</button>' +
      '<span class="ml-foot__hint">Ответ придёт сотруднику письмом и уведомлением в CRM.</span>';
    return mailShell('График отпусков: ' + e.fio.split(' ')[0] + ' — ' + D.fmtRange(r.start, r.end),
      'ASGARD CRM <no-reply@asgard-service.ru>', 'Директора (все)', 'сегодня, 09:00', body, foot);
  }

  /** Письмо сотруднику: согласовано / не согласовано. */
  function mailEmployeeScreen(kind) {
    var e = D.byId(D.me.id);
    var r = D.rangesOf(e.id).filter(function (x) { return x.start === '2027-05-01'; })[0];
    var ok = kind !== 'no';
    var body = ok ? ('' +
      '<p>Здравствуйте, ' + esc(e.fio.split(' ')[0]) + '!</p>' +
      '<p>Ваш отпуск <b>согласован</b>:</p>' +
      '<table class="ml-tbl">' +
        '<tr><td>Период</td><td><b>' + D.fmtRange(r.start, r.end) + '</b></td></tr>' +
        '<tr><td>Длительность</td><td><b>' + r.days + ' календарных дней</b></td></tr>' +
        '<tr><td>Согласовал</td><td>Кудряшов Олег Сергеевич, генеральный директор</td></tr>' +
      '</table>' +
      '<p>Пожалуйста, напишите заявление на отпуск — реквизиты и форма приложены.</p>') : ('' +
      '<p>Здравствуйте, ' + esc(e.fio.split(' ')[0]) + '!</p>' +
      '<p>Ваш отпуск <b>не согласован</b> и снят:</p>' +
      '<table class="ml-tbl">' +
        '<tr><td>Период (снят)</td><td><b>' + D.fmtRange(r.start, r.end) + '</b></td></tr>' +
        '<tr><td>Причина (обязательно)</td><td><b class="vs-bad">«На май выпадает сдача объекта по Северной башне — нужны все РП. Возьми отпуск после 20 мая.»</b></td></tr>' +
      '</table>' +
      '<p>Откройте график отпусков и переставьте дни. <b>Прежние дни поставить повторно нельзя</b> — система их помнит.</p>');
    var foot = ok
      ? '<button class="btn primary" data-vs-open-after>Открыть график отпусков</button>' +
        '<button class="btn ghost">Скачать форму заявления</button>'
      : '<button class="btn primary" data-vs-open-after>Переставить отпуск</button>' +
        '<button class="btn ghost" data-vs-look-comment>Посмотреть комментарий</button>';
    return mailShell(ok ? 'Ваш отпуск согласован · ' + D.fmtRange(r.start, r.end)
                        : 'Отпуск не согласован · ' + D.fmtRange(r.start, r.end),
      'ASGARD CRM <no-reply@asgard-service.ru>', e.fio, 'сегодня, 09:05', body, foot);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ЭКРАН: НАСТРОЙКА ДНЕЙ (бухгалтерия)
     ═══════════════════════════════════════════════════════════════════════ */
  function buhScreen() {
    var rows = D.ALL.map(function (e) {
      var d = D.DAYS[e.id] || { availableOnJan1: 42, lastYearUnused: 0 };
      var b = D.balance(e.id);
      return '<tr>' +
        '<td><div class="vs-who__n">' + esc(e.fio) + '</div><div class="vs-who__r">' + esc(D.roleRu(e.role)) + '</div></td>' +
        '<td>' + esc(groupTitle(e.group)) + '</td>' +
        '<td class="right"><input class="input vs-inp" type="number" min="0" max="90" value="' + d.availableOnJan1 + '" data-buh-avail="' + e.id + '"><div class="vs-inp__h">положено за год</div></td>' +
        '<td class="right"><input class="input vs-inp" type="number" min="0" max="90" value="' + d.lastYearUnused + '" data-buh-carry="' + e.id + '"><div class="vs-inp__h">не отгулено за ' + (S.year - 1) + '</div></td>' +
        '<td class="right num">' + b.plannedTotal + '</td>' +
        '<td class="right num"><b>' + b.left + '</b></td>' +
        '</tr>';
    }).join('');
    return '' +
      '<div class="vs-stage">' +
        '<div class="vs-modal vs-modal--buh">' +
          '<div class="vs-mhead">' +
            '<div class="vs-mhead__ic">🧮</div>' +
            '<div class="vs-mhead__tx"><div class="vs-mhead__t">Настройка дней отпуска · ' + S.year + '</div>' +
              '<div class="vs-mhead__s">Бухгалтерия · только для офиса (не для рабочих)</div></div>' +
            '<div class="vs-mhead__acts"><button class="btn gold sm" data-vs-buh-save>💾 Сохранить</button></div>' +
          '</div>' +
          '<div class="vs-buhnote">Количество дней на 01.01.' + S.year + ' и не отгуленное за ' + (S.year - 1) + ' год вводит бухгалтерия. ' +
            'Отпускные дни (ст. 114–115 ТК): основной отпуск 28 календарных дней; остаток прошлого года переносится.</div>' +
          '<div class="tablewrap"><table class="asg">' +
            '<thead><tr><th>Сотрудник</th><th>Отдел</th><th class="right">Положено за год</th><th class="right">Не отгулено за ' + (S.year - 1) + '</th><th class="right">Запланировано</th><th class="right">Остаток</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div>' +
        '</div>' +
      '</div>';
  }

  /* ── Экспорт ─────────────────────────────────────────────────────────── */
  window.VS_VIEWS = {
    S: S, esc: esc, initials: initials, toast: toast,
    scheduleScreen: scheduleScreen, officeScreen: officeScreen,
    mailDirectorScreen: mailDirectorScreen, mailEmployeeScreen: mailEmployeeScreen,
    buhScreen: buhScreen, groupTitle: groupTitle, selBar: selBar, rulesModalIfAny: rulesModalIfAny
  };
})();
