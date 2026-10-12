/* ASGARD CRM — дашборд разработки. Vanilla, без сборки. */
'use strict';

(function () {
  var API = '/api/dev-roadmap';
  var POLL_MS = 15000;
  var LS_KEY = 'asgard_dev_roadmap_key';
  var LS_THEME = 'asgard_dev_roadmap_theme';

  var $ = function (sel) { return document.querySelector(sel); };
  var state = null;
  var activeTab = 'overview';
  var pendingCp = null;      // { id, title, done }
  var pendingAction = 'close';
  var selectedSigner = null;
  var timer = null;

  // ── Секретный ключ: из URL ?k=..., иначе из localStorage (чтобы пережить refresh) ──
  var KEY = (function () {
    var fromUrl = new URLSearchParams(location.search).get('k');
    if (fromUrl) {
      try { localStorage.setItem(LS_KEY, fromUrl); } catch (e) {}
      return fromUrl;
    }
    try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; }
  })();

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'X-Roadmap-Key': KEY }, opts.headers || {});
    return fetch(API + path, opts);
  }

  // ── Дата/время ──
  function parseDate(d) {
    if (!d) return null;
    var s = String(d).slice(0, 10);
    var p = s.split('-');
    if (p.length !== 3) return null;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  var MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  function fmtDate(d) {
    var dt = parseDate(d);
    if (!dt) return '—';
    return dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
  }
  function daysLeft(d) {
    var dt = parseDate(d);
    if (!dt) return null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((dt - today) / 86400000);
  }
  function humanLeft(n) {
    if (n == null) return '';
    if (n > 1) return 'через ' + n + ' дн.';
    if (n === 1) return 'завтра';
    if (n === 0) return 'сегодня';
    if (n === -1) return 'просрочено на 1 день';
    return 'просрочено на ' + Math.abs(n) + ' дн.';
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (sameDay) return 'сегодня ' + hm;
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + hm;
  }

  // ── Кольцо прогресса (SVG) ──
  function ring(percent, size, stroke, cls) {
    var r = (size - stroke) / 2;
    var c = 2 * Math.PI * r;
    var off = c * (1 - Math.max(0, Math.min(100, percent)) / 100);
    var cx = size / 2;
    return '<div class="ring ' + (cls || '') + (size >= 140 ? ' big' : '') + '" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg width="' + size + '" height="' + size + '">' +
        '<circle class="bgc" cx="' + cx + '" cy="' + cx + '" r="' + r + '" stroke-width="' + stroke + '"/>' +
        '<circle class="fgc" cx="' + cx + '" cy="' + cx + '" r="' + r + '" stroke-width="' + stroke + '" ' +
          'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/>' +
      '</svg>' +
      '<div class="num"><b>' + percent + '%</b><i>готово</i></div>' +
    '</div>';
  }

  function initials(name) {
    if (!name) return '—';
    return name.trim().slice(0, 2).toUpperCase();
  }

  // ── Обзор ──
  function renderOverview() {
    var st = state;
    var ov = st.overall;

    // Ближайший незакрытый дедлайн среди этапов/пунктов
    var nearest = null;
    st.stages.forEach(function (s) {
      s.items.forEach(function (it) {
        if (it.progress.percent >= 100) return;
        var dl = it.deadline || s.deadline;
        var n = daysLeft(dl);
        if (n == null) return;
        if (!nearest || n < nearest.n) nearest = { n: n, dl: dl, title: it.title };
      });
    });

    var ovChip = ov.percent >= 70 ? 'ok' : (ov.percent >= 35 ? 'warn' : 'blue');
    var ovLabel = ov.percent >= 100 ? 'План закрыт' : (ov.percent >= 70 ? 'Основное сделано' : (ov.percent >= 35 ? 'Идёт работа' : 'Старт'));

    var html = '';
    html += '<section class="grid overview-top" style="margin-bottom:16px">';

    // Общее кольцо
    html += '<div class="card"><h3>Общее выполнение</h3><div class="ring-box">' +
      ring(ov.percent, 156, 13, '') +
      '<div class="ring-meta">' +
        '<div class="frac">Закрыто <b>' + ov.done + '</b> из <b>' + ov.total + '</b> чек-поинтов</div>' +
        '<div class="meta-line">' + st.stages.length + ' этапов · ' + st.stages.reduce(function (a, s) { return a + s.items.length; }, 0) + ' пунктов</div>' +
        '<div class="chip ' + ovChip + '">' + ovLabel + '</div>' +
      '</div></div></div>';

    // Прогресс-бар + дедлайн
    html += '<div class="card"><h3>До ближайшего дедлайна</h3>';
    html += '<div class="bar-head"><b>' + ov.percent + '%</b><span>общего плана</span></div>';
    html += '<div class="bar"><span class="seg-ok" style="width:' + ov.percent + '%"></span><span class="seg-left" style="width:' + (100 - ov.percent) + '%"></span></div>';
    if (nearest) {
      var dlNum = nearest.n;
      var dlCls = dlNum < 0 ? 'bad' : (dlNum <= 7 ? 'warn' : 'blue');
      html += '<div class="deadline-row">' +
        '<span>Ближайшая незакрытая: <b>' + esc(nearest.title) + '</b></span>' +
        '<span class="chip ' + dlCls + '">' + fmtDate(nearest.dl) + ' · ' + humanLeft(dlNum) + '</span>' +
      '</div>';
    } else {
      html += '<div class="deadline-row"><span class="chip ok">Все дедлайны закрыты</span></div>';
    }
    html += '<div class="legend">' +
      '<span><i style="background:var(--ok)"></i>закрыто</span>' +
      '<span><i style="background:var(--blue);opacity:.55"></i>в работе</span>' +
      '</div></div>';
    html += '</section>';

    // Плитки этапов
    html += '<section class="grid stage-rings" style="margin-bottom:16px">';
    st.stages.forEach(function (s) {
      html += '<div class="card ring-card" data-stage="' + esc(s.code) + '">' +
        ring(s.progress.percent, 104, 10, s.color) +
        '<div class="ttl">' + esc(s.short_title || s.title) + '</div>' +
        '<div class="sub">' + s.progress.done + ' / ' + s.progress.total + ' · до ' + fmtDate(s.deadline) + '</div>' +
      '</div>';
    });
    html += '</section>';

    // Гант + лента
    html += '<section class="grid overview-top">';
    html += '<div class="card"><h3>Лента подписей</h3><div class="events">' + renderEvents() + '</div></div>';
    html += '<div class="card gantt"><h3>Диаграмма Ганта</h3><div class="gantt-inner">' + renderGantt() + '</div></div>';
    html += '</section>';

    $('#view').innerHTML = html;
    bindStageCards();
  }

  function renderEvents() {
    var evs = state.events || [];
    if (!evs.length) return '<div class="empty">Пока никто не закрывал чек-поинты</div>';
    return evs.map(function (e) {
      var cls = e.action === 'close' ? 'close' : 'reopen';
      var verb = e.action === 'close' ? 'закрыл' : 'снял';
      return '<div class="ev">' +
        '<div class="av ' + cls + '">' + esc(initials(e.signer_name)) + '</div>' +
        '<div class="txt"><div><b>' + esc(e.signer_name) + '</b> ' + verb + ' «' + esc(e.cp_title || e.cp_code) + '»' +
          (e.item_title ? ' <span style="color:var(--t3)">· ' + esc(e.item_title) + '</span>' : '') + '</div>' +
          (e.note ? '<div class="t">' + esc(e.note) + '</div>' : '') +
          '<div class="t">' + fmtTime(e.created_at) + '</div>' +
        '</div></div>';
    }).join('');
  }

  // ── Гант: полосы по этапам и пунктам ──
  function renderGantt() {
    var rows = [];
    var minD = null, maxD = null;
    state.stages.forEach(function (s) {
      s.items.forEach(function (it) {
        var st = parseDate(it.start_date || s.start_date);
        var en = parseDate(it.deadline || s.deadline);
        if (!st || !en) return;
        if (en < st) en = st;
        if (!minD || st < minD) minD = st;
        if (!maxD || en > maxD) maxD = en;
        rows.push({ stage: s, item: it, start: st, end: en });
      });
    });
    if (!rows.length || !minD || !maxD) return '<div class="empty">Нет дат для диаграммы</div>';

    var pad = 3 * 86400000;
    var lo = new Date(minD.getTime() - pad);
    var hi = new Date(maxD.getTime() + pad);
    var span = hi - lo || 1;

    function pos(d) { return ((d - lo) / span) * 100; }

    // Месяцы
    var months = [];
    var cur = new Date(lo.getFullYear(), lo.getMonth(), 1);
    while (cur <= hi) {
      var mStart = new Date(Math.max(cur, lo));
      var next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      var mEnd = new Date(Math.min(next, hi));
      months.push({ label: MONTHS[cur.getMonth()], left: pos(mStart), width: pos(mEnd) - pos(mStart) });
      cur = next;
    }

    var colors = { blue: 'var(--blue)', gold: 'var(--gold)', ok: 'var(--ok)', red: 'var(--red)' };
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var todayLeft = (today >= lo && today <= hi) ? pos(today) : -1;

    var s = '';
    s += '<div class="g-month">' + months.map(function (m) {
      return '<div style="flex:0 0 ' + m.width + '%;max-width:' + m.width + '%">' + m.label + '</div>';
    }).join('') + '</div>';

    // Этап-строка + его пункты
    state.stages.forEach(function (stg) {
      var items = rows.filter(function (r) { return r.stage.code === stg.code; });
      if (!items.length) return;
      var color = colors[stg.color] || 'var(--blue)';

      var sStart = items.reduce(function (a, r) { return r.start < a ? r.start : a; }, items[0].start);
      var sEnd = items.reduce(function (a, r) { return r.end > a ? r.end : a; }, items[0].end);
      s += '<div class="g-row">' +
        '<div class="g-lbl"><span class="dot" style="background:' + color + '"></span><span class="nm"><b>' + esc(stg.short_title || stg.title) + '</b></span></div>' +
        '<div class="g-track">' + gridLines(months) + (todayLeft >= 0 ? '<div class="g-today" style="left:' + todayLeft + '%"></div>' : '') +
          '<div class="g-bar" style="left:' + pos(sStart) + '%;width:' + Math.max(pos(sEnd) - pos(sStart), 0.6) + '%;background:' + color + '">' +
            '<span class="fill" style="width:' + stg.progress.percent + '%"></span>' +
            '<span class="txt">' + stg.progress.percent + '%</span>' +
          '</div>' +
        '</div></div>';

      items.forEach(function (r) {
        s += '<div class="g-row">' +
          '<div class="g-lbl"><span class="nm" style="color:var(--t2)">' + esc(r.item.title) + '</span></div>' +
          '<div class="g-track">' + gridLines(months) + (todayLeft >= 0 ? '<div class="g-today" style="left:' + todayLeft + '%"></div>' : '') +
            '<div class="g-bar" style="left:' + pos(r.start) + '%;width:' + Math.max(pos(r.end) - pos(r.start), 0.6) + '%;background:' + color + ';opacity:.88">' +
              '<span class="fill" style="width:' + r.item.progress.percent + '%"></span>' +
              '<span class="txt">' + r.item.progress.done + '/' + r.item.progress.total + '</span>' +
            '</div>' +
          '</div></div>';
      });
    });
    return s;
  }

  function gridLines(months) {
    var acc = 0;
    return months.map(function (m) {
      acc += m.width;
      return '<div class="grid-line" style="left:' + acc + '%"></div>';
    }).join('');
  }

  // ── Вид этапа ──
  function renderStage(code) {
    var s = state.stages.find(function (x) { return x.code === code; });
    if (!s) { renderOverview(); return; }
    var html = '';
    html += '<section class="card" style="margin-bottom:16px"><div class="ring-box">' +
      ring(s.progress.percent, 128, 12, s.color) +
      '<div class="ring-meta">' +
        '<div class="frac">Этап: <b>' + esc(s.title) + '</b></div>' +
        '<div class="frac" style="margin-top:4px">Закрыто <b>' + s.progress.done + '</b> из <b>' + s.progress.total + '</b></div>' +
        '<div class="meta-line">Старт ' + fmtDate(s.start_date) + ' · дедлайн ' + fmtDate(s.deadline) + '</div>' +
        '<div class="chip ' + (s.progress.percent >= 100 ? 'ok' : 'blue') + '" style="margin-top:10px">' + humanLeft(daysLeft(s.deadline)) + '</div>' +
      '</div></div></section>';

    s.items.forEach(function (it) {
      html += '<div class="item">' +
        '<div class="item-head">' +
          '<div class="left">' +
            '<h4>' + esc(it.title) + '</h4>' +
            (it.description ? '<div class="desc">' + esc(it.description) + '</div>' : '') +
            '<div class="meta">' +
              (it.owner_name ? '<span class="owner"><span class="avatar">' + esc(initials(it.owner_name)) + '</span>' + esc(it.owner_name) + '</span>' : '') +
              '<span class="chip ' + (it.progress.percent >= 100 ? 'ok' : 'blue') + '">' + it.progress.percent + '%</span>' +
              '<span class="chip">до ' + fmtDate(it.deadline) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="right">' +
            '<span class="chip ' + (it.progress.done === it.progress.total ? 'ok' : 'warn') + '">' + it.progress.done + ' / ' + it.progress.total + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="cps">' + it.checkpoints.map(renderCp).join('') + '</div>' +
      '</div>';
    });

    $('#view').innerHTML = html;
    $('#view').querySelectorAll('.cp').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = Number(el.getAttribute('data-id'));
        var done = el.getAttribute('data-done') === '1';
        openModal(id, el.getAttribute('data-title'), done);
      });
    });
  }

  function renderCp(cp) {
    var dl = daysLeft(cp.deadline);
    var dlCls = cp.done ? '' : (dl != null && dl < 0 ? 'bad' : (dl != null && dl <= 3 ? 'warn' : ''));
    var sub = '<span class="kind">' + esc(cp.kind_label) + '</span>';
    if (cp.done) {
      sub += '<span class="sign"><span class="sign-badge">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg>' +
        'закрыл ' + esc(cp.done_by_name || cp.done_by) + '</span></span>';
      if (cp.done_at) sub += '<span>' + fmtTime(cp.done_at) + '</span>';
    } else {
      if (cp.owner_name) sub += '<span>' + esc(cp.owner_name) + '</span>';
      if (cp.deadline) sub += '<span style="' + (dlCls === 'bad' ? 'color:var(--red-l)' : (dlCls === 'warn' ? 'color:var(--gold)' : '')) + '">до ' + fmtDate(cp.deadline) + '</span>';
    }
    return '<div class="cp' + (cp.done ? ' done' : '') + '" data-id="' + cp.id + '" data-done="' + (cp.done ? 1 : 0) + '"' +
        ' data-title="' + esc(cp.title) + '" role="button" tabindex="0">' +
      '<div class="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div>' +
      '<div class="body"><div class="ttl">' + esc(cp.title) + '</div><div class="sub">' + sub + '</div>' +
        (cp.note ? '<div class="note">' + esc(cp.note) + '</div>' : '') +
      '</div></div>';
  }

  // ── Вкладки ──
  function renderTabs() {
    var html = '<button class="tab' + (activeTab === 'overview' ? ' is-on' : '') + '" data-tab="overview">Обзор' +
      '<span class="pct">' + state.overall.percent + '%</span></button>';
    state.stages.forEach(function (s) {
      html += '<button class="tab' + (activeTab === s.code ? ' is-on' : '') + '" data-tab="' + esc(s.code) + '">' +
        esc(s.short_title || s.title) + '<span class="pct">' + s.progress.percent + '%</span></button>';
    });
    $('#tabs').innerHTML = html;
    $('#tabs').querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () {
        activeTab = b.getAttribute('data-tab');
        renderTabs();
        if (activeTab === 'overview') renderOverview(); else renderStage(activeTab);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  function bindStageCards() {
    $('#view').querySelectorAll('.ring-card').forEach(function (c) {
      c.addEventListener('click', function () {
        activeTab = c.getAttribute('data-stage');
        renderTabs();
        renderStage(activeTab);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  // ── Модалка подписи ──
  function openModal(id, title, done) {
    pendingCp = { id: id, title: title, done: done };
    pendingAction = done ? 'reopen' : 'close';
    selectedSigner = null;
    $('#mErr').textContent = '';
    $('#mPin').value = '';
    $('#mNote').value = '';
    $('#mTitle').textContent = done ? 'Снять подпись' : 'Подпись закрытия';
    $('#mCpTitle').textContent = title;
    $('#mOk').textContent = done ? 'Снять галочку' : 'Подтвердить';
    $('#mOk').className = 'btn ' + (done ? 'btn-danger' : 'btn-primary');
    $('#mSigners').innerHTML = state.signers.map(function (s) {
      return '<button class="signer" data-sid="' + esc(s.id) + '">' + esc(s.name) + '</button>';
    }).join('');
    $('#mSigners').querySelectorAll('.signer').forEach(function (b) {
      b.addEventListener('click', function () {
        selectedSigner = b.getAttribute('data-sid');
        $('#mSigners').querySelectorAll('.signer').forEach(function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
      });
    });
    $('#modalBg').classList.add('is-on');
    setTimeout(function () { $('#mPin').focus(); }, 60);
  }

  function closeModal() { $('#modalBg').classList.remove('is-on'); pendingCp = null; }

  function submitSignature() {
    if (!pendingCp) return;
    if (!selectedSigner) { $('#mErr').textContent = 'Выберите, кто закрывает'; return; }
    var pin = $('#mPin').value.trim();
    if (!pin) { $('#mErr').textContent = 'Введите PIN'; return; }

    $('#mOk').disabled = true;
    $('#mErr').textContent = '';

    var url = API + '/checkpoint/' + pendingCp.id + '/' + (pendingAction === 'reopen' ? 'reopen' : 'close');
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Roadmap-Key': KEY },
      body: JSON.stringify({ signer: selectedSigner, pin: pin, note: $('#mNote').value.trim() })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    }).then(function (res) {
      $('#mOk').disabled = false;
      if (!res.ok) {
        $('#mErr').textContent = res.body.error || ('Ошибка ' + res.status);
        return;
      }
      // Мгновенный пересчёт из ответа сервера.
      state.stages = res.body.state.stages;
      state.overall = res.body.state.overall;
      state.events = res.body.state.events;
      state.signers = res.body.state.signers;
      closeModal();
      renderTabs();
      if (activeTab === 'overview') renderOverview(); else renderStage(activeTab);
      setLive('ok', 'подписано: ' + res.body.signed_by);
    }).catch(function (e) {
      $('#mOk').disabled = false;
      $('#mErr').textContent = 'Сеть недоступна: ' + e.message;
    });
  }

  // ── Загрузка ──
  function setLive(mode, text) {
    var el = $('#live');
    el.classList.toggle('is-err', mode === 'err');
    $('#liveText').textContent = text;
  }

  function load() {
    api('/state').then(function (r) {
      if (r.status === 404) {
        setLive('err', 'нет доступа');
        $('#view').innerHTML = '<div class="empty">Доступ по ссылке не настроен или ключ неверен.<br>Откройте ссылку вида <code>?k=…</code> полностью.</div>';
        return null;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!data) return;
      state = data;
      renderTabs();
      if (activeTab === 'overview' || !state.stages.some(function (s) { return s.code === activeTab; })) {
        renderOverview();
      } else {
        renderStage(activeTab);
      }
      setLive('ok', 'обновлено ' + fmtTime(data.generated_at));
    }).catch(function (e) {
      setLive('err', 'ошибка связи');
      if (!state) $('#view').innerHTML = '<div class="empty">Не удалось загрузить данные: ' + esc(e.message) + '</div>';
    });
  }

  // ── Тема ──
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(LS_THEME, t); } catch (e) {}
  }

  function init() {
    var savedTheme = 'light';
    try { savedTheme = localStorage.getItem(LS_THEME) || 'light'; } catch (e) {}
    applyTheme(savedTheme);

    $('#themeBtn').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    });
    $('#refreshBtn').addEventListener('click', function () { load(); });
    $('#mCancel').addEventListener('click', closeModal);
    $('#mOk').addEventListener('click', submitSignature);
    $('#mPin').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitSignature(); });
    $('#modalBg').addEventListener('click', function (e) { if (e.target === $('#modalBg')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

    if (!KEY) {
      $('#view').innerHTML = '<div class="empty">Нет ключа доступа. Откройте полную ссылку с параметром <code>?k=…</code>.</div>';
      setLive('err', 'нет ключа');
      return;
    }

    load();
    timer = setInterval(function () { load(); }, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) load();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
