/**
 * AsgardAdminTimesheetSettingsPage — ставки этапов табеля в ₽.
 * ═══════════════════════════════════════════════════════════
 * Роут: #/admin/timesheet-settings  |  Доступ: ADMIN, DIRECTOR_GEN
 *
 * Endpoints:
 *   GET /api/timesheet/v2/settings/position-points
 *   PUT /api/timesheet/v2/settings/position-points { type, position, rate_rub }
 *
 * 3 секции: Склад (слесарь/мастер), Медосмотр, Дорога. Кнопка «Сохранить» —
 * PUT по строкам, у которых изменилось значение. При изменении > 50% —
 * подтверждение (confirm()).
 */
window.AsgardAdminTimesheetSettingsPage = (function () {
  'use strict';

  const { $, $$, esc, toast } = AsgardUI;

  /** Заголовок Bearer */
  function hdr() {
    const auth = (window.AsgardAuth && AsgardAuth.getAuth) ? AsgardAuth.getAuth() : null;
    const tok = (auth && auth.token) ||
                localStorage.getItem('asgard_token') ||
                localStorage.getItem('auth_token');
    return { 'Authorization': 'Bearer ' + (tok || ''), 'Content-Type': 'application/json' };
  }

  function snap10(n) {
    if (window.AsgardMoneyCompact && AsgardMoneyCompact.snapRubStep10) {
      return AsgardMoneyCompact.snapRubStep10(n);
    }
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return 0;
    return Math.round(v / 10) * 10;
  }

  function fmtRub(n) {
    if (window.AsgardMoneyCompact && AsgardMoneyCompact.fmtMoneyRub) {
      return AsgardMoneyCompact.fmtMoneyRub(n);
    }
    return Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
  }

  // Дефолты в ₽ (бывшие баллы × 500).
  const SECTIONS = [
    {
      id: 'warehouse',
      title: '📦 Склад',
      hint: 'Ставка рабочему за день на складе, ₽.',
      items: [
        { type: 'warehouse', position: 'слесарь', label: 'Слесарь' },
        { type: 'warehouse', position: 'мастер',  label: 'Мастер'  }
      ]
    },
    {
      id: 'medical',
      title: '🏥 Медосмотр',
      hint: 'Ставка за день медосмотра (ставит ТО / Рук. ТО), ₽.',
      items: [{ type: 'medical', position: null, label: 'Медосмотр' }]
    },
    {
      id: 'training',
      title: '🎓 Обучение',
      hint: 'Ставка за день обучения. Ставят ТО / Рук. ТО, ₽.',
      items: [{ type: 'training', position: null, label: 'Обучение' }]
    },
    {
      id: 'travel',
      title: '✈️ Дорога',
      hint: 'Ставка за день в дороге (наземный транспорт), ₽.',
      items: [{ type: 'travel', position: null, label: 'Дорога' }]
    },
    {
      id: 'ship',
      title: '🚢 Корабль',
      hint: 'Альтернативный вид дороги — пароход / паром. Повышенная ставка, ₽.',
      items: [{ type: 'ship', position: null, label: 'Корабль' }]
    },
    {
      id: 'helicopter',
      title: '🚁 Вертолёт',
      hint: 'Иной транспорт — вертолёт. Ставят ТО / Рук. ТО, ₽.',
      items: [{ type: 'helicopter', position: null, label: 'Вертолёт' }]
    }
  ];

  const DEFAULTS = {
    'warehouse:слесарь': 5000,
    'warehouse:мастер':  6000,
    'medical': 3500,
    'training': 3500,
    'travel':  3000,
    'ship':    6000,
    'helicopter': 3000
  };

  function keyOf(type, position) {
    return position ? (type + ':' + position) : type;
  }

  function parseResponse(res) {
    const map = {};
    if (!res) return map;
    const rates = res.position_rates || {};
    for (const k in rates) {
      if (rates[k] != null) map[k] = Number(rates[k]) || 0;
    }
    if (Array.isArray(res)) {
      for (const r of res) {
        const k = keyOf(r.type, r.position);
        const rub = r.rate_rub != null ? Number(r.rate_rub) : (Number(r.points) || 0) * 500;
        map[k] = rub;
      }
      return map;
    }
    const src = res.position_points || res.settings || {};
    for (const k in src) {
      if (map[k] != null) continue;
      const v = src[k];
      if (v && typeof v === 'object') {
        for (const pos in v) {
          const kk = k + ':' + pos;
          if (map[kk] == null) map[kk] = (Number(v[pos]) || 0) * 500;
        }
      } else if (v != null && map[k] == null) {
        map[k] = (Number(v) || 0) * 500;
      }
    }
    return map;
  }

  let _original = {};
  let _values   = {};

  async function loadSettings() {
    try {
      const r = await fetch('/api/timesheet/v2/settings/position-points', { headers: hdr() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const map = parseResponse(data);
      const merged = Object.assign({}, DEFAULTS, map);
      _original = merged;
      _values   = Object.assign({}, merged);
      return merged;
    } catch (err) {
      toast && toast('Настройки', 'Не удалось загрузить, используем дефолты', 'err');
      _original = Object.assign({}, DEFAULTS);
      _values   = Object.assign({}, DEFAULTS);
      return _values;
    }
  }

  function buildDirtyList() {
    const dirty = [];
    for (const sec of SECTIONS) {
      for (const it of sec.items) {
        const k = keyOf(it.type, it.position);
        if (_original[k] !== _values[k]) {
          dirty.push({
            type: it.type, position: it.position, label: it.label,
            before: _original[k], after: _values[k]
          });
        }
      }
    }
    return dirty;
  }

  async function saveAll() {
    const dirty = buildDirtyList();
    if (dirty.length === 0) {
      toast && toast('Настройки', 'Нет изменений', 'ok');
      return;
    }
    const huge = dirty.filter(function (d) {
      const base = d.before || 0;
      if (base === 0) return d.after > 0;
      return Math.abs((d.after - base) / base) > 0.5;
    });
    if (huge.length > 0) {
      const msg = 'Изменение больше 50% по строкам:\n\n' +
                  huge.map(function (d) { return '• ' + d.label + ': ' + fmtRub(d.before) + ' → ' + fmtRub(d.after); }).join('\n') +
                  '\n\nЭто применится ко ВСЕМ будущим отметкам в табеле. Точно сохранить?';
      if (!confirm(msg)) return;
    }
    let okCount = 0;
    let errMsg = null;
    for (const d of dirty) {
      try {
        const body = { type: d.type, position: d.position, rate_rub: d.after };
        const r = await fetch('/api/timesheet/v2/settings/position-points', {
          method: 'PUT', headers: hdr(), body: JSON.stringify(body)
        });
        if (!r.ok) {
          errMsg = (await r.json().catch(function () { return {}; })).error || ('HTTP ' + r.status);
          break;
        }
        okCount++;
      } catch (e) {
        errMsg = String(e && e.message || e);
        break;
      }
    }
    if (errMsg) {
      toast && toast('Ошибка', 'Сохранено ' + okCount + ' из ' + dirty.length + ': ' + errMsg, 'err');
    } else {
      _original = Object.assign({}, _values);
      toast && toast('Настройки', 'Сохранено ' + okCount, 'ok');
      renderForm(document.getElementById('atsForm'));
    }
  }

  function renderForm(formRoot) {
    if (!formRoot) return;
    formRoot.innerHTML = '';

    for (const sec of SECTIONS) {
      const section = document.createElement('section');
      section.style.cssText = 'margin-bottom:20px;padding:16px;background:var(--card-bg,#1c1c22);border:1px solid var(--brd-1,#2a2a36);border-radius:10px';

      const h = document.createElement('h3');
      h.textContent = sec.title;
      h.style.cssText = 'margin:0 0 4px 0;font-size:16px;font-weight:700;color:var(--t-1,#F5F5F7)';
      section.appendChild(h);

      const hint = document.createElement('div');
      hint.textContent = sec.hint;
      hint.style.cssText = 'font-size:12px;color:var(--t-3,#7c7c87);margin-bottom:12px;line-height:1.5';
      section.appendChild(hint);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap';

      for (const it of sec.items) {
        const k = keyOf(it.type, it.position);
        const wrap = document.createElement('div');
        wrap.style.cssText = 'min-width:160px;display:flex;flex-direction:column;gap:4px';

        const lab = document.createElement('label');
        lab.textContent = it.label + ', ₽';
        lab.style.cssText = 'font-size:12px;color:var(--t-2,#8E8E93);font-weight:600';
        wrap.appendChild(lab);

        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0';
        inp.step = '10';
        inp.inputMode = 'numeric';
        inp.value = String(_values[k] != null ? _values[k] : 0);
        inp.style.cssText = 'padding:8px 10px;background:var(--inp-bg,#0a0a0c);border:1px solid var(--brd-2,#2a2a36);border-radius:6px;color:var(--t-1,#F5F5F7);font-size:14px;width:120px';
        inp.setAttribute('data-key', k);
        inp.addEventListener('input', function () {
          const v = snap10(inp.value);
          _values[k] = v;
          const meta = wrap.querySelector('.ats-meta');
          if (meta) {
            if (_original[k] !== v) meta.textContent = 'Было: ' + (_original[k] != null ? fmtRub(_original[k]) : '—');
            else meta.textContent = '';
          }
        });
        inp.addEventListener('blur', function () {
          const v = snap10(inp.value);
          inp.value = String(v);
          _values[k] = v;
        });
        wrap.appendChild(inp);

        const meta = document.createElement('div');
        meta.className = 'ats-meta';
        meta.style.cssText = 'font-size:11px;color:var(--warn,#f59e0b);min-height:14px';
        meta.textContent = (_original[k] !== _values[k])
          ? ('Было: ' + (_original[k] != null ? fmtRub(_original[k]) : '—'))
          : '';
        wrap.appendChild(meta);

        row.appendChild(wrap);
      }

      section.appendChild(row);
      formRoot.appendChild(section);
    }
  }

  async function render({ layout, title }) {
    await layout('', { title: title || 'Ставки этапов, ₽' });
    const root = document.getElementById('layout');
    if (!root) return;

    root.innerHTML = ''
      + '<div id="atsPage" style="padding:16px;max-width:900px;margin:0 auto">'
      +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">'
      +     '<div>'
      +       '<h2 style="margin:0;font-size:20px;font-weight:800;color:var(--t-1,#F5F5F7)">⚙ Ставки этапов, ₽</h2>'
      +       '<div style="font-size:12px;color:var(--t-3,#7c7c87);margin-top:4px">Склад / МО / дорога в рублях (шаг 10 ₽)</div>'
      +     '</div>'
      +     '<button id="atsSave" class="btn gold" style="font-size:13px;padding:8px 18px">Сохранить</button>'
      +   '</div>'
      +   '<div id="atsForm">⏳ Загрузка…</div>'
      + '</div>';

    await loadSettings();
    renderForm(document.getElementById('atsForm'));
    const btn = document.getElementById('atsSave');
    if (btn) btn.addEventListener('click', function () { saveAll(); });
  }

  return { render: render };
})();
