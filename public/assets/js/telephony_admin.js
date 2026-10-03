/**
 * ASGARD CRM — PBX admin settings & reports (vanilla)
 */
window.AsgardTelephonyAdmin = (function () {
  'use strict';

  var esc = function (s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s)));
    return d.innerHTML;
  };
  var toast = function (title, msg, type) {
    if (window.AsgardUI && AsgardUI.toast) AsgardUI.toast(title, msg || '', type || 'ok');
  };

  function token() {
    return localStorage.getItem('asgard_token') || '';
  }

  function pbxApi(path, opts) {
    opts = opts || {};
    var headers = { Authorization: 'Bearer ' + token() };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch('/api/telephony/pbx' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body || undefined,
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = {};
        try { j = t ? JSON.parse(t) : {}; } catch (_) { j = { raw: t }; }
        if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
        return j;
      });
    });
  }

  var _sub = 'settings';

  function renderShell(container) {
    container.innerHTML =
      '<div class="pbx-admin">' +
        '<div class="pbx-subtabs" id="pbxSubtabs">' +
          '<button type="button" class="pbx-subtab" data-sub="settings">Настройки PBX</button>' +
          '<button type="button" class="pbx-subtab" data-sub="journal">Журнал PBX</button>' +
          '<button type="button" class="pbx-subtab" data-sub="staff">Операторы</button>' +
          '<button type="button" class="pbx-subtab" data-sub="missed">Пропущенные</button>' +
          '<button type="button" class="pbx-subtab" data-sub="health">Состояние</button>' +
        '</div>' +
        '<div id="pbxAdminBody" class="pbx-panel">Загрузка…</div>' +
      '</div>';
    container.querySelectorAll('.pbx-subtab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _sub = btn.getAttribute('data-sub');
        paintSubtabs(container);
        loadSub(container.querySelector('#pbxAdminBody'));
      });
    });
    paintSubtabs(container);
    loadSub(container.querySelector('#pbxAdminBody'));
  }

  function paintSubtabs(container) {
    container.querySelectorAll('.pbx-subtab').forEach(function (b) {
      b.classList.toggle('pbx-subtab--active', b.getAttribute('data-sub') === _sub);
    });
  }

  function loadSub(body) {
    if (!body) return;
    body.innerHTML = '<div class="skeleton" style="height:120px;border-radius:8px"></div>';
    if (_sub === 'settings') renderSettings(body);
    else if (_sub === 'journal') renderJournal(body);
    else if (_sub === 'staff') renderStaff(body);
    else if (_sub === 'missed') renderMissed(body);
    else if (_sub === 'health') renderHealth(body);
  }

  function renderSettings(body) {
    pbxApi('/settings').then(function (cfg) {
      cfg = cfg || {};
      var lines = cfg.lines || cfg.trunks || [];
      var linesHtml = Array.isArray(lines) && lines.length
        ? lines.map(function (l, i) {
            return '<div class="pbx-field"><label>Линия ' + (i + 1) +
              '<input type="text" data-line="' + i + '" value="' + esc(l.name || l.did || '') + '"></label></div>';
          }).join('')
        : '<p style="color:var(--t3);font-size:13px">Входящие линии ещё не настроены. Добавьте номера в разделе настроек PBX или обратитесь к администратору.</p>';

      var strategy = cfg.routing_mode || cfg.dial_strategy || 'duty_first';
      if (strategy === 'parallel') strategy = 'simultaneous';
      var whFrom = (cfg.work_hours && cfg.work_hours.mon && cfg.work_hours.mon.start) || cfg.work_hours_from || '09:00';
      var whTo = (cfg.work_hours && cfg.work_hours.mon && cfg.work_hours.mon.end) || cfg.work_hours_to || '18:00';

      body.innerHTML =
        '<div class="pbx-settings-shell">' +
          '<div class="pbx-settings-scroll">' +
            '<div class="pbx-grid">' +
              '<div class="pbx-field"><label>Стратегия дозвона<select id="pbxDialStrategy">' +
                [
                  { v: 'duty_first', l: 'Сначала дежурный РП' },
                  { v: 'round_robin', l: 'По кругу' },
                  { v: 'ordered', l: 'Строго по порядку' },
                  { v: 'simultaneous', l: 'Всем сразу' },
                ].map(function (o) {
                  return '<option value="' + o.v + '"' + (strategy === o.v ? ' selected' : '') + '>' + o.l + '</option>';
                }).join('') +
              '</select></label></div>' +
              '<div class="pbx-field"><label>Начало рабочего дня<input type="time" id="pbxWorkFrom" value="' + esc(whFrom) + '"></label></div>' +
              '<div class="pbx-field"><label>Конец рабочего дня<input type="time" id="pbxWorkTo" value="' + esc(whTo) + '"></label></div>' +
              '<div class="pbx-field"><label><input type="checkbox" id="pbxRec"' + (cfg.recording_enabled !== false ? ' checked' : '') + '> Запись разговоров</label></div>' +
              '<div class="pbx-field"><label><input type="checkbox" id="pbxAi"' + (cfg.ai_postcall_enabled ? ' checked' : '') + '> AI после звонка</label></div>' +
            '</div>' +
            '<div class="pbx-field" style="margin-top:12px"><label>Текст приветствия<textarea id="pbxGreeting" rows="2">' + esc(cfg.greeting_text || '') + '</textarea></label></div>' +
            '<div class="pbx-field"><label>Текст вне часов<textarea id="pbxAfterHours" rows="2">' + esc(cfg.after_hours_text || '') + '</textarea></label></div>' +
            '<h4 style="margin:16px 0 8px;color:var(--t2)">Линии</h4>' + linesHtml +
          '</div>' +
          '<div class="pbx-settings-footer">' +
            '<button type="button" class="btn btn--primary" id="pbxSaveSettings">Сохранить</button>' +
          '</div>' +
        '</div>';

      body.querySelector('#pbxSaveSettings').addEventListener('click', function () {
        var strat = (body.querySelector('#pbxDialStrategy') || {}).value || 'duty_first';
        var from = (body.querySelector('#pbxWorkFrom') || {}).value || '09:00';
        var to = (body.querySelector('#pbxWorkTo') || {}).value || '18:00';
        var routing = strat === 'simultaneous' ? 'parallel' : strat;
        var next = Object.assign({}, cfg, {
          routing_mode: routing,
          dial_strategy: strat,
          parallel_ring: routing === 'parallel',
          work_hours_from: from,
          work_hours_to: to,
          work_hours: {
            mon: { start: from, end: to },
            tue: { start: from, end: to },
            wed: { start: from, end: to },
            thu: { start: from, end: to },
            fri: { start: from, end: to },
            sat: null,
            sun: null,
          },
          recording_enabled: !!(body.querySelector('#pbxRec') && body.querySelector('#pbxRec').checked),
          ai_postcall_enabled: !!(body.querySelector('#pbxAi') && body.querySelector('#pbxAi').checked),
          greeting_text: (body.querySelector('#pbxGreeting') || {}).value,
          after_hours_text: (body.querySelector('#pbxAfterHours') || {}).value,
        });
        pbxApi('/settings', { method: 'PUT', body: JSON.stringify(next) })
          .then(function () { toast('PBX', 'Настройки сохранены', 'ok'); })
          .catch(function (e) { toast('PBX', e.message, 'err'); });
      });
    }).catch(function (e) {
      body.innerHTML = '<p style="color:var(--err-t)">' + esc(e.message) + '</p>';
    });
  }

  function renderJournal(body) {
    pbxApi('/reports/journal?limit=80').then(function (data) {
      var items = data.items || [];
      if (!items.length) {
        body.innerHTML = '<p style="color:var(--t3)">Записей пока нет</p>';
        return;
      }
      body.innerHTML =
        '<table class="pbx-table"><thead><tr><th>Время</th><th>От</th><th>Кому</th><th>Тип</th><th>Исход</th><th></th></tr></thead><tbody>' +
        items.map(function (row) {
          var t = row.started_at ? new Date(row.started_at).toLocaleString('ru-RU') : '—';
          return '<tr>' +
            '<td>' + esc(t) + '</td>' +
            '<td>' + esc(row.from_number || '') + '</td>' +
            '<td>' + esc(row.to_number || '') + '</td>' +
            '<td>' + esc(row.call_type || '') + '</td>' +
            '<td>' + esc(row.outcome || '') + '</td>' +
            '<td><button type="button" class="btn btn--sm" data-timeline="' + esc(row.pbx_uid || row.id) + '">Таймлайн</button></td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
      body.querySelectorAll('[data-timeline]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          openTimeline(btn.getAttribute('data-timeline'));
        });
      });
    }).catch(function (e) {
      body.innerHTML = '<p style="color:var(--err-t)">' + esc(e.message) + '</p>';
    });
  }

  function openTimeline(callId) {
    pbxApi('/reports/timeline/' + encodeURIComponent(callId)).then(function (data) {
      var legs = data.legs || [];
      var html = '<div style="max-height:360px;overflow:auto"><ul style="margin:0;padding-left:18px;color:var(--t2)">';
      legs.forEach(function (leg) {
        html += '<li>' + esc(leg.leg_type || leg.event || 'leg') + ' — ' + esc(leg.started_at || '') + '</li>';
      });
      html += '</ul></div>';
      if (window.AsgardUI && AsgardUI.showModal) {
        AsgardUI.showModal({ title: 'Таймлайн ' + callId, html: html, wide: true });
      }
    }).catch(function (e) { toast('Таймлайн', e.message, 'err'); });
  }

  function renderStaff(body) {
    pbxApi('/reports/staff').then(function (data) {
      var staff = data.staff || [];
      body.innerHTML =
        '<table class="pbx-table"><thead><tr><th>Сотрудник</th><th>Роль</th><th>На линии</th><th>Режим</th><th>SIP</th><th>Miss streak</th></tr></thead><tbody>' +
        staff.map(function (s) {
          return '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.role) + '</td><td>' + (s.on_line ? 'да' : 'нет') +
            '</td><td>' + esc(s.receive_mode || '') + '</td><td>' + (s.webrtc_registered ? 'ok' : '—') +
            '</td><td>' + (s.miss_streak != null ? s.miss_streak : '') + '</td></tr>';
        }).join('') +
        '</tbody></table>';
    }).catch(function (e) {
      body.innerHTML = '<p style="color:var(--err-t)">' + esc(e.message) + '</p>';
    });
  }

  function renderMissed(body) {
    pbxApi('/reports/missed').then(function (data) {
      var items = data.items || [];
      if (!items.length) {
        body.innerHTML = '<p style="color:var(--t3)">Пропущенных нет</p>';
        return;
      }
      body.innerHTML =
        '<table class="pbx-table"><thead><tr><th>Время</th><th>Номер</th><th>Ожидание, с</th><th>ИНН</th></tr></thead><tbody>' +
        items.map(function (r) {
          return '<tr><td>' + esc(r.started_at ? new Date(r.started_at).toLocaleString('ru-RU') : '') +
            '</td><td>' + esc(r.from_number || '') + '</td><td>' + (r.wait_seconds != null ? r.wait_seconds : '') +
            '</td><td>' + esc(r.client_inn || '') + '</td></tr>';
        }).join('') +
        '</tbody></table>';
    }).catch(function (e) {
      body.innerHTML = '<p style="color:var(--err-t)">' + esc(e.message) + '</p>';
    });
  }

  function renderHealth(body) {
    pbxApi('/health').then(function (h) {
      var ok = h && (h.ok === true || h.status === 'ok');
      body.innerHTML =
        '<p class="' + (ok ? 'pbx-health-ok' : 'pbx-health-bad') + '">' +
          (ok ? 'PBX command channel доступен' : 'Проблема: ' + esc(h.error || h.message || 'unknown')) +
        '</p><pre style="margin-top:12px;font-size:12px;color:var(--t3);overflow:auto">' + esc(JSON.stringify(h, null, 2)) + '</pre>';
    }).catch(function (e) {
      body.innerHTML = '<p class="pbx-health-bad">' + esc(e.message) + '</p>';
    });
  }

  return {
    renderTab: function (container) {
      renderShell(container);
    },
  };
})();
