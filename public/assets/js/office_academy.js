/**
 * Office Academy v2 — Desktop CRM (Залы Асгарда)
 * Full block renderer, quiz with feedback, retry logic, track filter, search, ranks
 */
window.AsgardOfficeAcademyPage = (function () {
  const { $, esc, toast, showModal, closeModal, formatDate } = AsgardUI;

  const TRACK_LABELS = {
    pm: '⚙️ Управление проектами', hr: '👥 Кадры', finance: '💰 Финансы',
    procurement: '📦 Закупки', management: '🏛️ Менеджмент', all: '📚 Общие знания'
  };
  const TRACK_COLORS = {
    pm: '#3b82f6', hr: '#22c55e', finance: '#f59e0b',
    procurement: '#ef4444', management: '#8b5cf6', all: '#6b7280'
  };
  const RANK_ICONS = { 'Мастер': '👑', 'Воин': '⚔️', 'Страж': '🛡️', 'Ученик': '📜' };

  let allLessons = [];
  let currentFilter = null;
  let searchQuery = '';

  async function api(method, path, body) {
    var token = localStorage.getItem('asgard_token');
    var opts = {
      method: method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    var resp = await fetch('/api/office-academy' + path, opts);
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    return data;
  }

  // ── Block Renderer (all 15 types) ─────────────────────────────
  function renderBlock(b) {
    if (!b) return '';
    if (typeof b === 'string') return '<div class="oa-block oa-text">' + esc(b) + '</div>';

    switch (b.type) {
      case 'cover':
        return '<div class="oa-block oa-cover-block" style="text-align:center;padding:20px;background:linear-gradient(135deg,rgba(123,97,255,.1),transparent);border-radius:12px;border:1px solid rgba(123,97,255,.2)">' +
          '<div style="font-size:48px;margin-bottom:8px">' + esc(b.icon || '🏛️') + '</div>' +
          '<div style="font-size:18px;font-weight:800;color:var(--t1)">' + esc(b.title || '') + '</div>' +
          (b.subtitle ? '<div style="font-size:13px;color:var(--t3);margin-top:6px">' + esc(b.subtitle) + '</div>' : '') +
          '</div>';

      case 'intro':
        return '<div class="oa-block" style="font-size:14px;line-height:1.8;color:var(--t2);padding-left:14px;border-left:3px solid rgba(200,168,75,.4)">' + esc(b.text || '') + '</div>';

      case 'text_block':
        return '<div class="oa-block">' +
          (b.title ? '<h3 style="margin:0 0 8px;font-size:15px;font-weight:800;color:var(--t1)">' + esc(b.title) + '</h3>' : '') +
          '<div style="font-size:13px;line-height:1.8;color:var(--t2)">' + esc(b.text || '') + '</div></div>';

      case 'icon_grid':
        return '<div class="oa-block" style="background:var(--bg2);border:1px solid var(--brd);border-radius:12px;padding:14px">' +
          (b.title ? '<div style="font-size:13px;font-weight:800;color:#c8a84b;margin-bottom:10px">' + esc(b.title) + '</div>' : '') +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          (b.items || []).map(function (item) {
            return '<div style="display:flex;gap:8px;align-items:flex-start;background:rgba(255,255,255,.03);border-radius:8px;padding:8px 10px">' +
              '<span style="font-size:20px;flex-shrink:0">' + esc(item.icon || '') + '</span>' +
              '<div><div style="font-size:12px;font-weight:700;color:var(--t1)">' + esc(item.label || '') + '</div>' +
              (item.desc ? '<div style="font-size:11px;color:var(--t3);margin-top:2px">' + esc(item.desc) + '</div>' : '') +
              '</div></div>';
          }).join('') +
          '</div></div>';

      case 'steps':
        return '<div class="oa-block" style="background:linear-gradient(135deg,rgba(13,26,13,.5),var(--bg2));border:1px solid rgba(34,197,94,.2);border-radius:12px;padding:14px">' +
          (b.title ? '<div style="font-size:13px;font-weight:800;color:#22c55e;margin-bottom:10px">📋 ' + esc(b.title) + '</div>' : '') +
          (b.items || []).map(function (step, i) {
            return '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px">' +
              '<div style="width:22px;height:22px;border-radius:50%;background:rgba(34,197,94,.2);border:1px solid rgba(34,197,94,.4);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#22c55e;flex-shrink:0">' + (i + 1) + '</div>' +
              '<div style="font-size:13px;color:var(--t2);line-height:1.6;padding-top:1px">' + esc(step) + '</div></div>';
          }).join('') +
          '</div>';

      case 'fact_card':
        return '<div class="oa-block" style="background:linear-gradient(135deg,rgba(26,21,5,.5),var(--bg2));border:1px solid rgba(200,168,75,.25);border-radius:12px;padding:14px;display:flex;gap:12px;align-items:flex-start">' +
          '<span style="font-size:28px;flex-shrink:0">' + esc(b.icon || '💡') + '</span>' +
          '<div style="font-size:13px;color:#d8d0b8;line-height:1.7;font-style:italic">' + esc(b.text || '') + '</div></div>';

      case 'heading':
        return '<h3 style="font-size:17px;font-weight:800;color:var(--t1);margin:20px 0 8px">' + esc(b.text || '') + '</h3>';

      case 'subheading':
        return '<div style="font-size:14px;font-weight:800;color:#c8a84b;margin:14px 0 6px">' + esc(b.text || '') + '</div>';

      case 'text':
        return '<div class="oa-block oa-text" style="font-size:13px;line-height:1.8;color:var(--t2)">' + esc(b.content || b.text || '') + '</div>';

      case 'list':
        return '<ul style="margin:0 0 14px;padding-left:20px">' +
          (b.items || []).map(function (x) { return '<li style="margin:4px 0;font-size:13px;color:var(--t2);line-height:1.6">' + esc(x) + '</li>'; }).join('') +
          '</ul>';

      case 'numbered':
        return '<ol style="margin:0 0 14px;padding-left:22px">' +
          (b.items || []).map(function (x) { return '<li style="margin:4px 0;font-size:13px;color:var(--t2);line-height:1.6">' + esc(x) + '</li>'; }).join('') +
          '</ol>';

      case 'highlight':
        return '<div class="oa-block" style="background:linear-gradient(135deg,rgba(123,97,255,.1),rgba(59,130,246,.06));border:1px solid rgba(123,97,255,.3);border-left:4px solid rgba(123,97,255,.6);border-radius:12px;padding:12px 14px">' +
          '<div style="font-size:13px;color:var(--t1);line-height:1.7;font-weight:600">💡 ' + esc(b.text || '') + '</div></div>';

      case 'warning': {
        var isDanger = b.level === 'danger';
        var wc = isDanger ? '#ef4444' : '#f59e0b';
        return '<div class="oa-block" style="background:' + wc + '12;border:1px solid ' + wc + '40;border-left:4px solid ' + wc + ';border-radius:12px;padding:12px 14px">' +
          '<div style="font-size:12px;font-weight:800;color:' + wc + ';margin-bottom:4px">' + (isDanger ? '🚨 ОПАСНО' : '⚠️ ВАЖНО') + '</div>' +
          '<div style="font-size:13px;color:var(--t2);line-height:1.7">' + esc(b.text || '') + '</div></div>';
      }

      case 'quote':
        return '<div class="oa-block" style="background:rgba(200,168,75,.05);border:1px solid rgba(200,168,75,.2);border-left:3px solid #c8a84b;border-radius:10px;padding:12px 14px">' +
          '<div style="font-size:13px;color:var(--t1);line-height:1.7;font-style:italic">«' + esc(b.text || '') + '»</div>' +
          (b.author ? '<div style="font-size:12px;color:var(--t3);margin-top:6px">— ' + esc(b.author) + '</div>' : '') +
          '</div>';

      case 'scenario':
        return '<div class="oa-block" style="background:linear-gradient(135deg,rgba(26,16,48,.5),var(--bg2));border:1px solid rgba(123,97,255,.2);border-radius:12px;padding:14px">' +
          '<div style="font-size:11px;font-weight:800;color:#7b61ff;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📋 ' + esc(b.title || 'Ситуация из практики') + '</div>' +
          '<div style="font-size:13px;color:var(--t2);line-height:1.7">' + esc(b.text || '') + '</div>' +
          (b.resolution ? '<div style="background:rgba(34,197,94,.05);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:10px 12px;margin-top:8px"><div style="font-size:12px;font-weight:700;color:#22c55e;margin-bottom:4px">✓ Правильное решение</div><div style="font-size:12px;color:var(--t2);line-height:1.6">' + esc(b.resolution) + '</div></div>' : '') +
          '</div>';

      case 'checklist':
        return '<div class="oa-block" style="background:var(--bg2);border:1px solid var(--brd);border-radius:12px;padding:14px">' +
          (b.title ? '<div style="font-size:13px;font-weight:800;color:#c8a84b;margin-bottom:10px">✅ ' + esc(b.title) + '</div>' : '') +
          (b.items || []).map(function (item) {
            return '<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.03)">' +
              '<span style="color:var(--t3)">☐</span>' +
              '<span style="font-size:13px;color:var(--t2);line-height:1.5">' + esc(item) + '</span></div>';
          }).join('') +
          '</div>';

      case 'stat':
        return '<div class="oa-block" style="background:linear-gradient(135deg,rgba(26,24,48,.5),var(--bg2));border:1px solid rgba(123,97,255,.2);border-radius:12px;padding:16px;text-align:center">' +
          '<div style="font-size:32px;font-weight:900;color:#7b61ff;line-height:1">' + esc(b.value || '') + '</div>' +
          '<div style="font-size:13px;color:var(--t3);margin-top:6px">' + esc(b.label || '') + '</div>' +
          (b.source ? '<div style="font-size:11px;color:rgba(255,255,255,.15);margin-top:4px">Источник: ' + esc(b.source) + '</div>' : '') +
          '</div>';

      case 'divider':
        return '<hr style="border:none;height:1px;background:rgba(255,255,255,.06);margin:18px 0"/>';

      case 'image':
        return b.url ? '<div class="oa-block"><img src="' + esc(b.url) + '" style="max-width:100%;border-radius:8px"/></div>' : '';

      default:
        return '<div class="oa-block oa-text" style="font-size:13px;line-height:1.7;color:var(--t2)">' + esc(b.text || b.content || '') + '</div>';
    }
  }

  // ── Main Render ───────────────────────────────────────────────
  async function render(opts) {
    var layout = opts.layout;
    var title = opts.title;
    var auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }

    var body = '\
      <style>\
        .oa-stats { display:flex; gap:14px; flex-wrap:wrap; margin:14px 0 22px; }\
        .oa-stat { background:var(--bg2); border:1px solid var(--brd); border-radius:12px; padding:14px 18px; flex:1; min-width:140px; }\
        .oa-stat-v { font-size:24px; font-weight:700; color:var(--gold,#c8a84e); }\
        .oa-stat-l { font-size:12px; color:var(--t3); margin-top:4px; text-transform:uppercase; letter-spacing:.05em; }\
        .oa-rank-badge { display:inline-flex; align-items:center; gap:6px; padding:4px 12px; border-radius:8px; font-weight:700; font-size:13px; }\
        .oa-filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }\
        .oa-filter-btn { padding:6px 14px; border-radius:20px; border:1px solid var(--brd); background:transparent; color:var(--t3); font-size:12px; font-weight:600; cursor:pointer; transition:all .15s; }\
        .oa-filter-btn.active { border-color:rgba(123,97,255,.5); background:rgba(123,97,255,.12); color:#7b61ff; }\
        .oa-search { width:100%; padding:10px 12px 10px 36px; border-radius:12px; background:var(--bg2); border:1px solid var(--brd); color:var(--t1); font-size:13px; box-sizing:border-box; margin-bottom:16px; }\
        .oa-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px; }\
        .oa-card { background:var(--bg2); border:1px solid var(--brd); border-radius:14px; overflow:hidden; cursor:pointer; transition:transform .15s, border-color .15s, box-shadow .15s; display:flex; flex-direction:column; }\
        .oa-card:hover { transform:translateY(-3px); border-color:rgba(200,168,78,.4); box-shadow:0 8px 24px rgba(0,0,0,.3); }\
        .oa-cover { padding:20px 18px; display:flex; align-items:center; gap:14px; color:#fff; min-height:80px; }\
        .oa-cover-icon { font-size:36px; line-height:1; }\
        .oa-cover-title { font-size:14px; font-weight:700; line-height:1.3; }\
        .oa-cover-saga { font-size:11px; opacity:.7; margin-top:3px; }\
        .oa-body { padding:14px 18px; flex:1; display:flex; flex-direction:column; gap:8px; }\
        .oa-meta { display:flex; gap:8px; flex-wrap:wrap; font-size:11px; color:var(--t3); }\
        .oa-pill { padding:3px 8px; border-radius:99px; background:var(--bg3); font-weight:600; font-size:10px; }\
        .oa-pill.ok { background:rgba(46,204,113,.15); color:#2ecc71; }\
        .oa-pill.warn { background:rgba(241,196,15,.15); color:#f1c40f; }\
        .oa-pill.must { background:rgba(231,76,60,.15); color:#e74c3c; }\
        .oa-pill.track { font-weight:700; }\
        .oa-pill.xp { background:rgba(123,97,255,.15); color:#7b61ff; }\
        .oa-block { margin-bottom:14px; }\
        .oa-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:18px; flex-wrap:wrap; }\
        .oa-q { background:var(--bg3); border:1px solid var(--brd); border-radius:12px; padding:14px 16px; margin-bottom:12px; }\
        .oa-q-text { font-weight:600; margin-bottom:10px; font-size:13px; line-height:1.5; }\
        .oa-q-opt { display:flex; align-items:flex-start; gap:8px; padding:8px 10px; border-radius:8px; cursor:pointer; transition:background .12s; }\
        .oa-q-opt:hover { background:var(--bg2); }\
        .oa-q-opt input { margin-top:3px; }\
        .oa-q-opt.correct { background:rgba(46,204,113,.12); }\
        .oa-q-opt.wrong { background:rgba(231,76,60,.12); }\
        .oa-feedback { margin-top:8px; padding:8px 10px; border-radius:8px; font-size:12px; line-height:1.5; }\
        .oa-feedback.ok { background:rgba(46,204,113,.08); border:1px solid rgba(46,204,113,.2); color:#2ecc71; }\
        .oa-feedback.err { background:rgba(59,130,246,.08); border:1px solid rgba(59,130,246,.2); color:#5b8def; }\
      </style>\
      <div class="panel">\
        <div class="help">\
          <b>🏛️ Залы Асгарда</b> — корпоративное обучение. Изучай свитки по своей роли, проходи испытания.\
          За правильные ответы — опыт (XP) и место в Зале Славы.\
        </div>\
        <hr class="hr"/>\
        <div id="oa_stats" class="oa-stats">\
          <div class="oa-stat"><div class="oa-stat-v" id="s_total">—</div><div class="oa-stat-l">Свитков доступно</div></div>\
          <div class="oa-stat"><div class="oa-stat-v" id="s_passed">—</div><div class="oa-stat-l">Пройдено</div></div>\
          <div class="oa-stat"><div class="oa-stat-v" id="s_mandatory">—</div><div class="oa-stat-l">Обяз. не сданы</div></div>\
          <div class="oa-stat"><div id="s_rank"></div><div class="oa-stat-l">Ранг</div></div>\
          <div class="oa-stat"><button class="btn ghost" id="btnLeaderboard" style="width:100%">🏆 Зал Славы</button></div>\
        </div>\
        <div id="oa_filters" class="oa-filters"></div>\
        <div style="position:relative;margin-bottom:16px">\
          <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:14px;color:var(--t3)">🔍</span>\
          <input type="text" id="oa_search" class="oa-search" placeholder="Поиск свитка..."/>\
        </div>\
        <div id="oa_grid" class="oa-grid"><div class="help">Загружаю...</div></div>\
      </div>';

    await layout(body, { title: title || 'Залы Асгарда' });

    try {
      var data = await api('GET', '/lessons');
      allLessons = data.lessons || [];
      $('#s_total').textContent = data.total || 0;
      $('#s_passed').textContent = data.passed || 0;
      $('#s_mandatory').textContent = data.mandatory_pending || 0;

      // Rank
      if (data.rank) {
        var ri = RANK_ICONS[data.rank.name] || '📜';
        $('#s_rank').innerHTML = '<span class="oa-rank-badge" style="background:' + (data.rank.color || '#6b7280') + '18;color:' + (data.rank.color || '#6b7280') + '">' + ri + ' ' + esc(data.rank.name) + '</span>';
      }

      renderFilters();
      renderGrid(allLessons);
    } catch (e) {
      $('#oa_grid').innerHTML = '<div class="help" style="color:var(--err-t)">Ошибка загрузки: ' + esc(e.message) + '</div>';
    }

    $('#btnLeaderboard').addEventListener('click', openLeaderboard);
    $('#oa_search').addEventListener('input', function (e) {
      searchQuery = e.target.value.toLowerCase();
      applyFilters();
    });
  }

  function renderFilters() {
    var tracks = {};
    allLessons.forEach(function (l) { tracks[l.track] = true; });
    var container = $('#oa_filters');
    var html = '<button class="oa-filter-btn active" data-track="">Все</button>';
    Object.keys(tracks).forEach(function (t) {
      html += '<button class="oa-filter-btn" data-track="' + t + '">' + (TRACK_LABELS[t] || t) + '</button>';
    });
    container.innerHTML = html;
    container.querySelectorAll('.oa-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.oa-filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentFilter = btn.dataset.track || null;
        applyFilters();
      });
    });
  }

  function applyFilters() {
    var filtered = allLessons;
    if (currentFilter) filtered = filtered.filter(function (l) { return l.track === currentFilter; });
    if (searchQuery) filtered = filtered.filter(function (l) {
      return l.title.toLowerCase().indexOf(searchQuery) !== -1 ||
        (l.saga || '').toLowerCase().indexOf(searchQuery) !== -1;
    });
    renderGrid(filtered);
  }

  function renderGrid(lessons) {
    var grid = $('#oa_grid');
    if (!lessons.length) {
      grid.innerHTML = '<div class="help">Свитков не найдено</div>';
      return;
    }
    grid.innerHTML = lessons.map(function (L) {
      var passed = !!L.passed;
      var needsReread = L.attempts >= 2 && !L.passed && !L.read_completed_at;
      var trackLbl = TRACK_LABELS[L.track] || L.track;
      var tc = TRACK_COLORS[L.track] || '#6b7280';
      return '\
        <div class="oa-card" data-id="' + L.id + '">\
          <div class="oa-cover" style="background:' + esc(L.cover_color || '#1e2840') + '">\
            <div class="oa-cover-icon">' + esc(L.cover_icon || '🏛️') + '</div>\
            <div>\
              <div class="oa-cover-title">' + esc(L.title || '') + '</div>\
              ' + (L.saga ? '<div class="oa-cover-saga">' + esc(L.saga) + '</div>' : '') + '\
            </div>\
          </div>\
          <div class="oa-body">\
            <div class="oa-meta">\
              <span class="oa-pill track" style="background:' + tc + '18;color:' + tc + '">' + esc(trackLbl) + '</span>\
              ' + (L.is_mandatory ? '<span class="oa-pill must">⚠️ Обязательно</span>' : '') + '\
              ' + (L.estimated_minutes ? '<span class="oa-pill">⏱ ' + L.estimated_minutes + ' мин</span>' : '') + '\
              ' + (L.xp_earned > 0 ? '<span class="oa-pill xp">⚡' + L.xp_earned + '</span>' : '') + '\
            </div>\
            <div style="margin-top:auto;display:flex;gap:6px;flex-wrap:wrap">\
              ' + (passed ? '<span class="oa-pill ok">✓ Пройдено · ' + (L.score || 0) + '%</span>' :
                needsReread ? '<span class="oa-pill warn">📖 Перечитай</span>' :
                L.attempts > 0 ? '<span class="oa-pill warn">Попыток: ' + L.attempts + '</span>' :
                '<span class="oa-pill">Не начато</span>') + '\
            </div>\
          </div>\
        </div>';
    }).join('');
    grid.querySelectorAll('.oa-card').forEach(function (card) {
      card.addEventListener('click', function () { openLesson(Number(card.dataset.id)); });
    });
  }

  // ── Open Lesson ───────────────────────────────────────────────
  async function openLesson(lessonId) {
    var data;
    try {
      data = await api('GET', '/lessons/' + lessonId);
    } catch (e) {
      toast('Ошибка', 'Не удалось открыть свиток: ' + e.message, 'err');
      return;
    }
    var lesson = data.lesson || data;
    var blocks = Array.isArray(lesson.blocks) ? lesson.blocks : (typeof lesson.blocks === 'string' ? JSON.parse(lesson.blocks || '[]') : []);
    var questions = data.questions || [];
    var retry = data.retry || {};
    var passed = !!lesson.passed;
    var needsReread = retry.needs_reread;

    var html = '\
      <div class="help" style="margin-bottom:14px">\
        ' + (lesson.saga ? '<b>' + esc(lesson.saga) + '</b> · ' : '') + '\
        ' + (lesson.estimated_minutes ? '⏱ ' + lesson.estimated_minutes + ' мин' : '') + '\
        ' + (questions.length > 0 ? ' · ❓ ' + questions.length + ' вопросов' : '') + '\
        ' + (passed ? ' · <span style="color:#2ecc71;font-weight:700">✓ Сдан · ' + (lesson.score || 0) + '%</span>' : '') + '\
      </div>';

    if (needsReread) {
      html += '<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:12px 14px;margin-bottom:14px">\
        <div style="font-weight:700;color:#f59e0b;margin-bottom:4px">📖 Перечитай свиток</div>\
        <div style="font-size:12px;color:var(--t3)">Все попытки использованы. Прочитай заново (мин. 60 сек) для новых попыток.</div>\
      </div>';
    }

    html += '<div id="oa_blocks">' +
      (blocks.map(function (b) { return renderBlock(b); }).join('') || '<div class="help">Контент свитка пока не подготовлен</div>') +
      '</div>';

    html += '<div class="oa-actions">\
      <button class="btn ghost" id="btnLessonClose">Закрыть</button>';

    if (!passed && !needsReread && !lesson.read_completed_at) {
      html += '<button class="btn" id="btnComplete" style="background:#27ae60;color:#fff">✓ Прочитал</button>';
    }
    if (needsReread) {
      html += '<button class="btn" id="btnReread" style="background:#f59e0b;color:#000;font-weight:700">✓ Прочитал заново</button>';
    }
    if (questions.length > 0 && !needsReread) {
      html += '<button class="btn" id="btnQuiz" style="background:#c8a84e;color:#1a1000;font-weight:700">' + (passed ? '🔄 Повторить испытание' : '⚔️ Начать испытание') + '</button>';
    }
    html += '</div>';

    showModal({ title: lesson.title || 'Свиток', icon: lesson.cover_icon || '🏛️', html: html, wide: true });

    // Heartbeat — копит read_time_seconds на бэке, без него /complete отказывает
    // по MIN_READ_SECONDS=60 даже после реального чтения.
    startReadHeartbeat(lessonId);

    document.getElementById('btnLessonClose').onclick = function () { stopReadHeartbeat(); closeModal(); };

    var btnC = document.getElementById('btnComplete');
    if (btnC) btnC.onclick = async function () {
      try {
        stopReadHeartbeat();
        await api('POST', '/lessons/' + lessonId + '/complete');
        toast('Готово', 'Свиток отмечен прочитанным', 'ok');
        closeModal();
        render({ layout: window.AsgardLayout ? AsgardLayout.layout : null, title: 'Залы Асгарда' });
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };

    var btnR = document.getElementById('btnReread');
    if (btnR) btnR.onclick = async function () {
      try {
        stopReadHeartbeat();
        var res = await api('POST', '/lessons/' + lessonId + '/complete');
        if (res.attempts_reset) {
          toast('Готово', 'Попытки сброшены! Можешь пройти испытание заново', 'ok');
        } else {
          toast('Готово', 'Свиток прочитан', 'ok');
        }
        closeModal();
        render({ layout: window.AsgardLayout ? AsgardLayout.layout : null, title: 'Залы Асгарда' });
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };

    var btnQ = document.getElementById('btnQuiz');
    if (btnQ) btnQ.onclick = function () { stopReadHeartbeat(); closeModal(); openQuiz(lessonId, questions); };
  }

  // ── Heartbeat: каждые 30 сек POST /lessons/:id/heartbeat ─────
  var _hbTimer = null;
  function startReadHeartbeat(lessonId) {
    stopReadHeartbeat();
    // первый удар через 30с (по согласованию с MIN_READ_SECONDS=60 хватит двух)
    _hbTimer = setInterval(function () {
      if (document.hidden) return; // не считаем время если вкладка скрыта
      api('POST', '/lessons/' + lessonId + '/heartbeat').catch(function () {});
    }, 30000);
  }
  function stopReadHeartbeat() {
    if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
  }

  // ── Quiz with full feedback ───────────────────────────────────
  async function openQuiz(lessonId, questions) {
    if (!questions.length) { toast('Испытание', 'Вопросов нет', 'warn'); return; }

    var html = '<div style="margin-bottom:14px;font-size:13px;color:var(--t3)">Проходной балл: 80% · ' + questions.length + ' вопросов</div>';
    html += questions.map(function (q, i) {
      var opts = Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? JSON.parse(q.options || '[]') : []);
      return '\
        <div class="oa-q" data-qid="' + q.id + '">\
          <div class="oa-q-text">' + (i + 1) + '. ' + esc(q.question_text || '') + '</div>\
          ' + opts.map(function (opt, oi) {
            return '<label class="oa-q-opt" data-oi="' + oi + '">\
              <input type="radio" name="q_' + q.id + '" value="' + oi + '"/>\
              <span>' + esc(opt.text || '') + '</span>\
            </label>';
          }).join('') + '\
        </div>';
    }).join('');

    html += '<div class="oa-actions">\
      <button class="btn ghost" id="btnQuizCancel">Отмена</button>\
      <button class="btn" id="btnQuizSubmit" style="background:#c8a84e;color:#1a1000;font-weight:700">⚔️ Сдать испытание</button>\
    </div>';

    showModal({ title: '⚔️ Испытание', icon: '⚔️', html: html, wide: true });

    document.getElementById('btnQuizCancel').onclick = function () { closeModal(); };
    document.getElementById('btnQuizSubmit').onclick = async function () {
      var answers = {};
      questions.forEach(function (q) {
        var sel = document.querySelector('input[name="q_' + q.id + '"]:checked');
        answers[q.id] = sel ? Number(sel.value) : -1;
      });

      // Check all answered
      var unanswered = questions.filter(function (q) { return answers[q.id] === -1; });
      if (unanswered.length > 0) {
        toast('Испытание', 'Ответь на все вопросы (' + unanswered.length + ' без ответа)', 'warn');
        return;
      }

      try {
        var r = await api('POST', '/lessons/' + lessonId + '/quiz', { answers: answers });
        closeModal();
        showQuizResults(lessonId, r, questions, answers);
      } catch (e) {
        if (e.message && e.message.indexOf('needs_reread') !== -1) {
          toast('Испытание', 'Перечитай свиток для новых попыток', 'warn');
          closeModal();
        } else {
          toast('Испытание', e.message, 'err');
        }
      }
    };
  }

  // ── Quiz Results Modal ────────────────────────────────────────
  function showQuizResults(lessonId, result, questions, answers) {
    var score = result.score || 0;
    var passed = result.passed;
    var feedback = result.feedback || [];
    var xp = result.xp || 0;
    var retry = result.retry || {};

    var html = '<div style="text-align:center;margin-bottom:20px">\
      <div style="font-size:48px;margin-bottom:8px">' + (passed ? (score === 100 ? '🏆' : '⚔️') : '🛡️') + '</div>\
      <div style="font-size:36px;font-weight:900;color:' + (passed ? '#22c55e' : '#f59e0b') + '">' + score + '%</div>\
      <div style="font-size:16px;font-weight:700;color:var(--t1);margin-top:4px">' + (passed ? 'Испытание пройдено!' : 'Ещё не готов...') + '</div>\
      <div style="font-size:13px;color:var(--t3);margin-top:4px">' + result.correct + ' из ' + result.total + ' правильных</div>\
      ' + (xp > 0 ? '<div style="margin-top:8px"><span style="background:rgba(123,97,255,.15);color:#7b61ff;padding:4px 12px;border-radius:20px;font-weight:700;font-size:13px">⚡ +' + xp + ' XP</span></div>' : '') + '\
    </div>';

    if (!passed && retry.needs_reread) {
      html += '<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:12px 14px;margin-bottom:14px">\
        <div style="font-weight:700;color:#f59e0b">📖 Перечитай свиток для новых попыток</div>\
      </div>';
    } else if (!passed) {
      html += '<div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#5b8def">\
        ⚔️ Осталось попыток: ' + (retry.attempts_left || 0) + ' из ' + (retry.max_attempts || 2) + '\
      </div>';
    }

    html += '<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px">📋 Разбор ответов</div>';

    questions.forEach(function (q, qi) {
      var fb = feedback.find(function (f) { return f.question_id === q.id; });
      var isCorrect = fb ? fb.is_correct : false;
      var correctIdx = fb ? fb.correct_index : -1;
      var selectedIdx = answers[q.id];
      var opts = Array.isArray(q.options) ? q.options : [];

      html += '<div class="oa-q" style="border-color:' + (isCorrect ? 'rgba(46,204,113,.3)' : 'rgba(231,76,60,.2)') + '">\
        <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px">\
          <span style="font-size:16px">' + (isCorrect ? '✅' : '❌') + '</span>\
          <div class="oa-q-text" style="margin-bottom:0"><span style="color:var(--t3)">' + (qi + 1) + '.</span> ' + esc(q.question_text || '') + '</div>\
        </div>';

      opts.forEach(function (opt, oi) {
        var isSelected = selectedIdx === oi;
        var isCorrOpt = oi === correctIdx;
        var cls = isCorrOpt ? 'correct' : (isSelected && !isCorrOpt ? 'wrong' : '');
        html += '<div class="oa-q-opt ' + cls + '" style="cursor:default">\
          <span style="font-size:13px;color:' + (isCorrOpt ? '#2ecc71' : isSelected ? '#e74c3c' : 'var(--t3)') + '">' + (isCorrOpt ? '✓' : isSelected ? '✗' : '○') + '</span>\
          <span style="font-size:13px;color:' + (isCorrOpt || isSelected ? 'var(--t1)' : 'var(--t3)') + ';font-weight:' + (isCorrOpt || isSelected ? '600' : '400') + '">' + esc(opt.text || '') + '</span>\
        </div>';
      });

      if (fb && fb.explanation) {
        html += '<div class="oa-feedback err">💡 ' + esc(fb.explanation) + '</div>';
      }
      html += '</div>';
    });

    html += '<div class="oa-actions">\
      <button class="btn ghost" id="btnResultClose">Закрыть</button>';
    if (retry.needs_reread) {
      html += '<button class="btn" id="btnResultReread" style="background:#f59e0b;color:#000;font-weight:700">📖 Перечитать свиток</button>';
    }
    html += '</div>';

    showModal({ title: passed ? '⚔️ Победа!' : '🛡️ Результат', html: html, wide: true });

    document.getElementById('btnResultClose').onclick = function () {
      closeModal();
      render({ layout: window.AsgardLayout ? AsgardLayout.layout : null, title: 'Залы Асгарда' });
    };

    var btnRR = document.getElementById('btnResultReread');
    if (btnRR) btnRR.onclick = function () {
      closeModal();
      openLesson(lessonId);
    };
  }

  // ── Leaderboard ───────────────────────────────────────────────
  async function openLeaderboard() {
    var data;
    try { data = await api('GET', '/leaderboard'); }
    catch (e) { toast('Зал Славы', e.message, 'err'); return; }
    var items = data.leaderboard || [];
    var medals = ['🥇', '🥈', '🥉'];
    var html = items.length ? '\
      <table class="asg" style="width:100%">\
        <thead><tr><th>#</th><th>Сотрудник</th><th>Ранг</th><th>Пройдено</th><th>Средний балл</th><th>XP</th></tr></thead>\
        <tbody>' +
          items.map(function (row, i) {
            var ri = row.rank ? (RANK_ICONS[row.rank.name] || '📜') : '📜';
            return '<tr>\
              <td>' + (i < 3 ? medals[i] : (i + 1)) + '</td>\
              <td>' + esc(row.fio || '—') + '</td>\
              <td>' + ri + ' ' + esc(row.rank ? row.rank.name : '') + '</td>\
              <td>' + (row.lessons_passed || 0) + '</td>\
              <td>' + (row.avg_score ? Math.round(row.avg_score) + '%' : '—') + '</td>\
              <td>⚡' + (row.total_xp || 0) + '</td>\
            </tr>';
          }).join('') +
        '</tbody>\
      </table>' : '<div class="help">Зал Славы пуст — стань первым!</div>';
    showModal({ title: '🏆 Зал Славы Асгарда', html: html, wide: false });
  }

  return { render: render };
})();
