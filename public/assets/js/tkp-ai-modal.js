/**
 * ASGARD CRM — «ТКП через ИИ» из реестра тендеров (vanilla)
 * ═══════════════════════════════════════════════════════════════════════════
 * Открывается из реестра ТО, когда просчёт РП закрыт (`is_final` + «подаём»)
 * и по тендеру ещё нет ТКП.
 *
 * Поток:
 *   1. Выбор варианта: «Краткое ТКП (= КП)» или «Полное КП».
 *   2. POST /api/tkp/ai-draft — черновик БЕЗ записи в БД (только предпросмотр).
 *   3. Правка текста, «Предпросмотр PDF», «Сохранить».
 *   4. «Сохранить» → POST /api/tkp с attach_pdf_only: создаётся ТКП + PDF
 *      прикрепляется к карточке тендера. Статус тендера не меняется.
 *
 * Ответственность за чистоту документа — на сервере (линтер + гейт PDF).
 * Здесь поля с найденным мусором подсвечиваются, чтобы ТО видел, что убрано.
 * ═══════════════════════════════════════════════════════════════════════════
 */
window.AsgardTkpAi = (function () {
  'use strict';

  const ROLE_OK = ['TO', 'HEAD_TO', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
  const STATE_IDLE = 'idle';
  const STATE_LOADING = 'loading';
  const STATE_READY = 'ready';
  const STATE_SAVING = 'saving';

  let modalEl = null;
  let state = null;

  /* ───────────── утилиты ───────────── */

  function currentUser() {
    try { return JSON.parse(localStorage.getItem('asgard_user') || '{}') || {}; } catch (_) { return {}; }
  }

  function token() {
    return localStorage.getItem('asgard_token') || '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtMoney(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function toast(title, msg, type) {
    if (window.AsgardUI && typeof AsgardUI.toast === 'function') {
      return AsgardUI.toast(title, msg, type || 'ok');
    }
    console.log('[tkp-ai]', title, msg);
  }

  function canCreate() {
    const u = currentUser();
    return ROLE_OK.indexOf(u.role) !== -1;
  }

  /* ───────────── стили ───────────── */

  let _stylesInjected = false;
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const css = document.createElement('style');
    css.id = 'tkpAiStyles';
    css.textContent = [
      '.tkpai-wrap{display:flex;flex-direction:column;gap:14px}',
      '.tkpai-variants{display:grid;gap:10px}',
      '.tkpai-variant{text-align:left;padding:14px 16px;border:1px solid var(--brd,#e2e6ef);border-radius:10px;background:var(--bg2,#fff);cursor:pointer;width:100%;font:inherit;color:inherit;transition:border-color .15s,background .15s}',
      '.tkpai-variant:hover{border-color:var(--gold,#d4a843);background:rgba(212,168,67,.06)}',
      '.tkpai-variant b{display:block;margin-bottom:4px;font-size:13.5px}',
      '.tkpai-variant span{font-size:12px;color:var(--t3,#6b7280)}',
      '.tkpai-variant-gold{border-color:rgba(212,168,67,.45);background:rgba(212,168,67,.07)}',
      '.tkpai-steps{display:flex;flex-direction:column;gap:8px;font-size:12.5px}',
      '.tkpai-step{display:flex;align-items:center;gap:8px;color:var(--t3,#6b7280)}',
      '.tkpai-step.active{color:var(--t1,#1f2937);font-weight:600}',
      '.tkpai-step.done{color:#1b7339}',
      '.tkpai-dot{width:8px;height:8px;border-radius:50%;background:currentColor;opacity:.35;flex:0 0 auto}',
      '.tkpai-step.active .tkpai-dot{opacity:1;animation:tkpaiPulse 1.1s infinite}',
      '.tkpai-step.done .tkpai-dot{opacity:1}',
      '@keyframes tkpaiPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.5);opacity:.55}}',
      '.tkpai-sums{display:flex;gap:16px;flex-wrap:wrap;padding:10px 14px;border-radius:10px;background:rgba(27,115,57,.07);border:1px solid rgba(27,115,57,.2);font-size:12.5px}',
      '.tkpai-sums b{font-size:14px}',
      '.tkpai-sums .tkpai-note{margin-left:auto;font-size:11px;color:var(--t3,#6b7280);align-self:center}',
      '.tkpai-field{display:flex;flex-direction:column;gap:4px}',
      '.tkpai-field label{font-size:11.5px;font-weight:600;color:var(--t2,#4b5563);text-transform:uppercase;letter-spacing:.02em}',
      '.tkpai-field textarea,.tkpai-field input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--brd,#e2e6ef);border-radius:8px;background:var(--bg2,#fff);color:inherit;font:inherit;font-size:13px;resize:vertical}',
      '.tkpai-field.warn textarea,.tkpai-field.warn input{border-color:#d4a843;box-shadow:0 0 0 2px rgba(212,168,67,.18)}',
      '.tkpai-hint{font-size:11px;color:#b07d1a}',
      '.tkpai-table{width:100%;border-collapse:collapse;font-size:12.5px}',
      '.tkpai-table th{background:var(--bg3,#f5f7fa);text-align:left;font-weight:600;padding:6px 8px;border-bottom:1px solid var(--brd,#e2e6ef);font-size:11px;text-transform:uppercase;color:var(--t3,#6b7280)}',
      '.tkpai-table td{padding:5px 8px;border-bottom:1px solid var(--brd,#eef1f6);vertical-align:top}',
      '.tkpai-table td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.tkpai-table input{width:100%;box-sizing:border-box;border:1px solid transparent;border-radius:5px;background:transparent;padding:3px 5px;font:inherit;font-size:12.5px;color:inherit}',
      '.tkpai-table input:focus{border-color:var(--blue,#2b6cb0);background:var(--bg2,#fff);outline:none}',
      '.tkpai-badge{display:inline-block;padding:2px 7px;border-radius:99px;font-size:10.5px;font-weight:700;letter-spacing:.02em}',
      '.tkpai-badge.ok{background:rgba(27,115,57,.12);color:#1b7339}',
      '.tkpai-badge.warn{background:rgba(212,168,67,.18);color:#8a6415}',
      '.tkpai-badge.err{background:rgba(197,48,48,.12);color:#c53030}',
      '.tkpai-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}',
      '.tkpai-btn{padding:8px 16px;border-radius:8px;border:1px solid var(--brd,#e2e6ef);background:var(--bg2,#fff);color:inherit;font:inherit;font-size:13px;cursor:pointer}',
      '.tkpai-btn:hover{border-color:var(--blue,#2b6cb0)}',
      '.tkpai-btn.primary{background:var(--blue,#2b6cb0);border-color:var(--blue,#2b6cb0);color:#fff;font-weight:600}',
      '.tkpai-btn.primary:disabled,.tkpai-btn:disabled{opacity:.55;cursor:not-allowed}',
      '.tkpai-btn.ghost{background:transparent}',
      '.tkpai-hits{margin:0;padding:10px 12px 10px 28px;border-radius:8px;background:rgba(197,48,48,.07);border:1px solid rgba(197,48,48,.25);font-size:12px;max-height:180px;overflow:auto}',
      '.tkpai-hits li{margin-bottom:4px}',
      '.tkpai-hits code{font-size:11px;background:rgba(0,0,0,.06);padding:1px 4px;border-radius:3px}',
      '.tkpai-scroll{max-height:52vh;overflow:auto;padding-right:4px}',
      '.tkpai-muted{font-size:11.5px;color:var(--t3,#6b7280)}'
    ].join('\n');
    document.head.appendChild(css);
  }

  /* ───────────── API ───────────── */

  async function apiJson(url, opts) {
    const o = opts || {};
    const headers = Object.assign({ Authorization: 'Bearer ' + token() }, o.headers || {});
    if (o.body && !(o.body instanceof FormData)) headers['Content-Type'] = 'application/json';

    const resp = await fetch(url, {
      method: o.method || 'GET',
      headers,
      body: o.body instanceof FormData ? o.body : (o.body ? JSON.stringify(o.body) : undefined)
    });

    let data = null;
    try { data = await resp.json(); } catch (_) { data = null; }

    if (!resp.ok) {
      const err = new Error((data && data.error) || ('HTTP ' + resp.status));
      err.status = resp.status;
      err.code = data && data.code;
      err.hits = data && data.hits;
      throw err;
    }
    return data;
  }

  /* ───────────── модалка ───────────── */

  function shell(innerHtml, opts) {
    const o = opts || {};
    return '' +
      '<div class="tkpai-wrap">' +
      (o.subtitle ? '<div class="tkpai-muted">' + esc(o.subtitle) + '</div>' : '') +
      innerHtml +
      '</div>';
  }

  function showModal(title, subtitle, innerHtml) {
    injectStyles();

    if (window.AsgardUI && typeof AsgardUI.showModal === 'function') {
      // ВАЖНО (D-226): showModal возвращает overlay, и искать свои элементы нужно
      // ВНУТРИ него. document.getElementById при наложенных модалках возвращает
      // элементы нижней, уже уходящей модалки — она «мёртвая», без обработчиков.
      const overlay = AsgardUI.showModal({
        title: title,
        icon: '🤖',
        subtitle: subtitle,
        html: '<div class="tkpai-root">' + innerHtml + '</div>',
        wide: true,
        onMount: function (ctx) {
          modalEl = (ctx && ctx.body) || overlay;
        }
      });
      modalEl = overlay.querySelector('.tkpai-root') || overlay;
      return;
    }

    // Fallback без AsgardUI — минимальная модалка, чтобы модуль не падал.
    let host = document.getElementById('tkpAiFallbackHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'tkpAiFallbackHost';
      host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:24px';
      document.body.appendChild(host);
    }
    host.innerHTML = '<div style="background:var(--bg2,#fff);border-radius:14px;max-width:900px;width:100%;max-height:90vh;overflow:auto;padding:20px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
      + '<b style="font-size:15px">' + esc(title) + '</b>'
      + '<button type="button" class="tkpai-btn ghost" id="tkpAiClose">✕</button></div>'
      + subtitleHtml(subtitle)
      + '<div class="tkpai-root">' + innerHtml + '</div></div>';
    modalEl = host.querySelector('.tkpai-root');
    document.getElementById('tkpAiClose').addEventListener('click', close);
  }

  function subtitleHtml(s) {
    return s ? '<div class="tkpai-muted" style="margin-bottom:10px">' + esc(s) + '</div>' : '';
  }

  function close() {
    if (window.AsgardUI && typeof AsgardUI.hideModal === 'function') {
      try { AsgardUI.hideModal(); } catch (_) {}
    }
    const host = document.getElementById('tkpAiFallbackHost');
    if (host) host.remove();
    modalEl = null;
    state = null;
  }

  function render(html) {
    if (!modalEl) return;
    modalEl.innerHTML = html;
  }

  /* ───────────── шаг 1: выбор варианта ───────────── */

  function stepVariant() {
    const tender = state.tender;
    const sums = state.pricingPreview;

    const html = shell(
      '<div class="tkpai-sums">' +
        '<div>Цена без НДС<br><b>' + fmtMoney(sums.price_no_vat) + ' ₽</b></div>' +
        '<div>НДС ' + esc(String(sums.vat_pct)) + '%<br><b>' + fmtMoney(sums.vat_with) + ' ₽</b></div>' +
        '<div>Итого с НДС<br><b>' + fmtMoney(sums.price_with_vat) + ' ₽</b></div>' +
        '<div class="tkpai-note">Суммы берём из просчёта РП — ИИ их не считает</div>' +
      '</div>' +
      '<div class="tkpai-variants">' +
        '<button type="button" class="tkpai-variant" data-variant="classic">' +
          '<b>Краткое ТКП (КП)</b>' +
          '<span>Заказчик, предмет, таблица работ, условия оплаты, срок действия. 1–2 страницы.</span>' +
        '</button>' +
        '<button type="button" class="tkpai-variant tkpai-variant-gold" data-variant="full">' +
          '<b>Полное КП</b>' +
          '<span>Развёрнутый шаблон: периметр, условия, аппараты и транспорт, сдача результата.</span>' +
        '</button>' +
      '</div>' +
      '<div class="tkpai-actions">' +
        '<button type="button" class="tkpai-btn ghost" data-act="cancel">Отмена</button>' +
      '</div>',
      { subtitle: tender.customer_name ? (tender.customer_name + ' · ' + (tender.tender_title || '')) : (tender.tender_title || '') }
    );

    render(html);

    modalEl.querySelectorAll('[data-variant]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        startGeneration(btn.dataset.variant);
      });
    });
    modalEl.querySelector('[data-act="cancel"]').addEventListener('click', close);
  }

  /* ───────────── шаг 2: генерация ───────────── */

  function stepLoading(variant) {
    const steps = [
      { id: 'collect', label: 'Собираю тендер, просчёт, чек-лист и документы' },
      { id: 'ai', label: 'ИИ готовит формулировки (суммы не трогает)' },
      { id: 'clean', label: 'Проверяю текст: без внутренней кухни и ИИ-штампов' },
      { id: 'sums', label: 'Сверяю суммы с просчётом' }
    ];

    render(shell(
      '<div class="tkpai-steps" id="tkpAiSteps">' + steps.map(function (s) {
        return '<div class="tkpai-step" data-step="' + s.id + '"><span class="tkpai-dot"></span><span>' + esc(s.label) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="tkpai-muted" id="tkpAiTimer">Обычно 20–60 секунд. Можно закрыть и вернуться — данные не потеряются.</div>' +
      '<div class="tkpai-actions"><button type="button" class="tkpai-btn ghost" data-act="cancel">Отмена</button></div>',
      { subtitle: variant === 'full' ? 'Полное КП' : 'Краткое ТКП (КП)' }
    ));

    modalEl.querySelector('[data-act="cancel"]').addEventListener('click', close);

    const startedAt = Date.now();
    let stepIdx = 0;

    function paintSteps() {
      const nodes = modalEl ? modalEl.querySelectorAll('.tkpai-step') : [];
      nodes.forEach(function (n, i) {
        n.classList.toggle('done', i < stepIdx);
        n.classList.toggle('active', i === stepIdx);
      });
    }

    function tick() {
      if (!modalEl) return;
      const timer = modalEl.querySelector('#tkpAiTimer');
      if (timer) {
        const sec = Math.round((Date.now() - startedAt) / 1000);
        timer.textContent = 'Идёт генерация… ' + sec + ' с. Обычно 20–60 секунд.';
      }
      if (stepIdx < 2) { stepIdx += 1; paintSteps(); }
    }

    paintSteps();
    const t1 = setTimeout(tick, 1800);
    const t2 = setTimeout(tick, 6000);

    const cancelTimers = function () { clearTimeout(t1); clearTimeout(t2); };
    state._cancelTimers = cancelTimers;

    (async function () {
      try {
        const res = await apiJson('/api/tkp/ai-draft', {
          method: 'POST',
          body: { tender_id: state.tenderId, variant: variant }
        });
        cancelTimers();
        if (!modalEl) return; // пользователь закрыл — не рисуем поверх другой модалки

        stepIdx = 3;
        paintSteps();

        state.variant = variant;
        state.draft = res.draft;
        state.meta = res.meta || {};
        state.pricing = res.pricing || state.pricingPreview;
        state.phase = STATE_READY;

        // Дать шагу «сверяю суммы» мгновение визуально завершиться.
        setTimeout(function () { if (state && state.phase === STATE_READY) stepEditor(); }, 220);
      } catch (err) {
        cancelTimers();
        if (!modalEl) return;
        stepError(err);
      }
    })();
  }

  function stepError(err) {
    const hits = Array.isArray(err.hits) ? err.hits : [];
    render(shell(
      '<div class="tkpai-hits" style="background:rgba(197,48,48,.07)">' +
        '<b>Не удалось сформировать ТКП</b>' +
        '<div style="margin-top:6px">' + esc(err.message || 'ошибка') + '</div>' +
        (hits.length
          ? '<ul style="margin-top:8px">' + hits.slice(0, 10).map(function (h) {
              return '<li>' + esc(h.field || '') + ': <code>' + esc(h.phrase || '') + '</code>' + (h.context ? ' — ' + esc(h.context) : '') + '</li>';
            }).join('') + '</ul>'
          : '') +
      '</div>' +
      '<div class="tkpai-actions">' +
        '<button type="button" class="tkpai-btn ghost" data-act="cancel">Закрыть</button>' +
        '<button type="button" class="tkpai-btn primary" data-act="retry">Повторить</button>' +
      '</div>',
      { subtitle: state && state.tender ? (state.tender.customer_name || '') : '' }
    ));

    modalEl.querySelector('[data-act="cancel"]').addEventListener('click', close);
    modalEl.querySelector('[data-act="retry"]').addEventListener('click', function () {
      stepVariant();
    });
  }

  /* ───────────── шаг 3: редактор ───────────── */

  function replacedSet() {
    const m = (state.meta && state.meta.replaced_fields) || [];
    return new Set(Array.isArray(m) ? m : []);
  }

  function stepEditor() {
    const d = state.draft;
    const items = (d.items && d.items.items) || [];
    const rep = replacedSet();
    const degraded = !!(state.meta && state.meta.degraded);

    const badge = degraded
      ? '<span class="tkpai-badge warn">ИИ недоступен — текст по шаблону</span>'
      : (state.meta && state.meta.cached
        ? '<span class="tkpai-badge ok">ИИ · из кэша</span>'
        : '<span class="tkpai-badge ok">ИИ</span>');

    const rows = items.map(function (it, i) {
      return '<tr>' +
        '<td class="num" style="width:34px">' + (i + 1) + '</td>' +
        '<td><input data-item-name="' + i + '" value="' + esc(it.name) + '"></td>' +
        '<td style="width:70px"><input data-item-unit="' + i + '" value="' + esc(it.unit || '') + '"></td>' +
        '<td class="num" style="width:70px">' + esc(String(it.qty)) + '</td>' +
        '<td class="num" style="width:120px">' + fmtMoney(it.price) + '</td>' +
        '<td class="num" style="width:130px"><b>' + fmtMoney(it.total) + '</b></td>' +
        '</tr>';
    }).join('');

    const hintFor = function (f) {
      return rep.has(f) ? '<span class="tkpai-hint">ИИ предложил недопустимую формулировку — подставлен шаблон. Проверьте текст.</span>' : '';
    };

    render(shell(
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' + badge +
        '<span class="tkpai-muted">Черновик не сохранён. Правьте текст — суммы менять нельзя, они из просчёта.</span></div>' +

      '<div class="tkpai-sums">' +
        '<div>Без НДС<br><b>' + fmtMoney(state.pricing.price_no_vat) + ' ₽</b></div>' +
        '<div>НДС ' + esc(String(state.pricing.vat_pct)) + '%<br><b>' + fmtMoney(state.pricing.price_with_vat - state.pricing.price_no_vat) + ' ₽</b></div>' +
        '<div>Итого<br><b>' + fmtMoney(state.pricing.price_with_vat) + ' ₽</b></div>' +
        '<div class="tkpai-note">Позиций: ' + items.length + ' · сумма строк сверена с просчётом</div>' +
      '</div>' +

      '<div class="tkpai-scroll">' +
        '<div class="tkpai-field' + (rep.has('subject') ? ' warn' : '') + '" style="margin-bottom:10px">' +
          '<label>Предмет предложения</label>' +
          '<input data-field="subject" value="' + esc(d.subject || '') + '">' + hintFor('subject') +
        '</div>' +

        '<div class="tkpai-field' + (rep.has('work_description') ? ' warn' : '') + '" style="margin-bottom:10px">' +
          '<label>Описание работ</label>' +
          '<textarea data-field="work_description" rows="4">' + esc(d.work_description || '') + '</textarea>' + hintFor('work_description') +
        '</div>' +

        '<div class="tkpai-field' + (rep.has('deadline_text') ? ' warn' : '') + '" style="margin-bottom:10px">' +
          '<label>Срок выполнения</label>' +
          '<input data-field="deadline_text" value="' + esc(d.deadline_text || '') + '">' + hintFor('deadline_text') +
        '</div>' +

        '<div class="tkpai-field' + (rep.has('payment_terms_text') ? ' warn' : '') + '" style="margin-bottom:10px">' +
          '<label>Условия оплаты</label>' +
          '<textarea data-field="payment_terms_text" rows="2">' + esc(d.payment_terms_text || '') + '</textarea>' + hintFor('payment_terms_text') +
        '</div>' +

        '<div class="tkpai-field" style="margin-bottom:12px">' +
          '<label>Таблица работ</label>' +
          '<table class="tkpai-table"><thead><tr>' +
            '<th>№</th><th>Наименование</th><th>Ед.</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table>' +
        '</div>' +
      '</div>' +

      '<div id="tkpAiEditorMsg"></div>' +

      '<div class="tkpai-actions">' +
        '<button type="button" class="tkpai-btn ghost" data-act="back">← Другой вариант</button>' +
        '<button type="button" class="tkpai-btn" data-act="preview">Предпросмотр PDF</button>' +
        '<button type="button" class="tkpai-btn primary" data-act="save">Сохранить ТКП</button>' +
      '</div>',
      { subtitle: (state.tender.customer_name || '') + (state.variant === 'full' ? ' · Полное КП' : ' · Краткое ТКП') }
    ));

    // Правки полей
    modalEl.querySelectorAll('[data-field]').forEach(function (el) {
      el.addEventListener('input', function () {
        state.draft[el.dataset.field] = el.value;
        const wrap = el.closest('.tkpai-field');
        if (wrap) wrap.classList.remove('warn');
      });
    });

    modalEl.querySelectorAll('[data-item-name]').forEach(function (el) {
      el.addEventListener('input', function () {
        const i = Number(el.dataset.itemName);
        if (state.draft.items && state.draft.items.items[i]) {
          state.draft.items.items[i].name = el.value;
        }
      });
    });

    modalEl.querySelectorAll('[data-item-unit]').forEach(function (el) {
      el.addEventListener('input', function () {
        const i = Number(el.dataset.itemUnit);
        if (state.draft.items && state.draft.items.items[i]) {
          state.draft.items.items[i].unit = el.value;
        }
      });
    });

    modalEl.querySelector('[data-act="back"]').addEventListener('click', function () { stepVariant(); });
    modalEl.querySelector('[data-act="preview"]').addEventListener('click', previewPdf);
    modalEl.querySelector('[data-act="save"]').addEventListener('click', saveTkp);
  }

  function collectDraftForSave() {
    const d = state.draft;
    // Пересобрать items после правки названий: total не трогаем.
    const itemsObj = Object.assign({}, d.items || {});
    const items = Array.isArray(itemsObj.items) ? itemsObj.items.slice() : [];
    const subtotal = items.reduce(function (s, it) { return s + (Number(it.total) || 0); }, 0);
    const vatPct = Number(itemsObj.vat_pct) || 22;
    const vatSum = Math.round(subtotal * vatPct) / 100;
    itemsObj.items = items;
    itemsObj.subtotal = subtotal;
    itemsObj.vat_sum = vatSum;
    itemsObj.total_with_vat = Math.round((subtotal + vatSum) * 100) / 100;

    return Object.assign({}, d, {
      items: itemsObj,
      total_sum: subtotal,
      tender_id: state.tenderId,
      source: 'ai_tender',
      kp_variant: state.variant,
      link_type: 'tender',
      attach_pdf_only: true
    });
  }

  /* ───────────── предпросмотр PDF ───────────── */

  async function previewPdf() {
    const msg = modalEl.querySelector('#tkpAiEditorMsg');
    const btn = modalEl.querySelector('[data-act="preview"]');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Готовлю PDF…';
    if (msg) msg.innerHTML = '';

    try {
      const body = collectDraftForSave();
      const resp = await fetch('/api/tkp/preview-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        let e = {};
        try { e = await resp.json(); } catch (_) {}
        throw new Error(e.error || ('HTTP ' + resp.status));
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    } catch (err) {
      if (msg) {
        msg.innerHTML = '<div class="tkpai-hits"><b>Предпросмотр не открылся</b><div style="margin-top:6px">'
          + esc(err.message || 'ошибка') + '</div></div>';
      }
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /* ───────────── сохранение ───────────── */

  async function saveTkp() {
    const msg = modalEl.querySelector('#tkpAiEditorMsg');
    const btn = modalEl.querySelector('[data-act="save"]');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = 'Сохраняю…';
    if (msg) msg.innerHTML = '';

    try {
      const body = collectDraftForSave();
      const res = await apiJson('/api/tkp', { method: 'POST', body: body });
      const id = res && res.item ? res.item.id : null;

      toast('ТКП сохранено', 'PDF прикреплён к карточке тендера', 'ok');

      render(shell(
        '<div class="tkpai-sums" style="background:rgba(27,115,57,.09)">' +
          '<div><b>ТКП №' + esc(String(id || '—')) + ' сохранено</b><br>' +
          '<span class="tkpai-muted">PDF прикреплён к карточке тендера. Статус тендера не менялся — отправку КП делаете штатно.</span></div>' +
        '</div>' +
        '<div class="tkpai-actions">' +
          '<button type="button" class="tkpai-btn ghost" data-act="close">Закрыть</button>' +
          '<button type="button" class="tkpai-btn primary" data-act="open">Открыть ТКП</button>' +
        '</div>',
        { subtitle: state.tender.customer_name || '' }
      ));

      modalEl.querySelector('[data-act="close"]').addEventListener('click', function () {
        const doneCb = state && state.onDone;
        close();
        if (doneCb) doneCb();
      });
      modalEl.querySelector('[data-act="open"]').addEventListener('click', function () {
        const doneCb = state && state.onDone;
        close();
        if (doneCb) doneCb();
        if (id && window.AsgardTkpPage && typeof AsgardTkpPage.openEdit === 'function') {
          AsgardTkpPage.openEdit(id);
        } else if (id) {
          window.location.hash = '#tkp?id=' + id;
        }
      });

      if (state) state.savedId = id;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = old;
      const hits = Array.isArray(err.hits) ? err.hits : [];
      if (msg) {
        msg.innerHTML = '<div class="tkpai-hits"><b>' + esc(err.message || 'Не удалось сохранить') + '</b>' +
          (hits.length
            ? '<ul style="margin-top:8px">' + hits.slice(0, 12).map(function (h) {
                return '<li>' + esc(h.field || '') + ': <code>' + esc(h.phrase || '') + '</code>' +
                  (h.context ? ' — ' + esc(h.context) : '') + '</li>';
              }).join('') + '</ul>'
            : '') +
          '</div>';
      }
      // Подсветить поля, на которые ругается сервер
      const fields = new Set(hits.map(function (h) { return String(h.field || '').split('[')[0]; }));
      fields.forEach(function (f) {
        const el = modalEl.querySelector('[data-field="' + f + '"]');
        if (el) {
          const wrap = el.closest('.tkpai-field');
          if (wrap) wrap.classList.add('warn');
        }
      });
    }
  }

  /* ───────────── старт генерации ───────────── */

  function startGeneration(variant) {
    if (!state) return;
    state.phase = STATE_LOADING;
    stepLoading(variant);
  }

  /* ───────────── публичный API ───────────── */

  /**
   * Открыть модалку «ТКП через ИИ».
   * @param {object} p { tenderId, row, onDone }
   */
  function open(p) {
    const o = p || {};
    if (!canCreate()) {
      toast('Недоступно', 'Создавать ТКП могут ТО, HEAD_TO и ADMIN', 'warn');
      return;
    }
    const tenderId = Number(o.tenderId || (o.row && o.row.id));
    if (!Number.isFinite(tenderId) || tenderId <= 0) {
      toast('Ошибка', 'Не указан тендер', 'err');
      return;
    }

    const row = o.row || {};
    const rev = row.rp_review || {};

    // Цена без НДС по канону D-173: work_price (без НДС), дубль — смета.
    let priceNoVat = Number(rev.work_price_ex_vat || rev.work_price || 0) || 0;
    let priceWithVat = 0;
    let vatPct = 22;

    try {
      let rj = rev.report_json;
      if (typeof rj === 'string') rj = JSON.parse(rj || '{}');
      const smeta = rj && rj.asgard_smeta;
      if (smeta && smeta.totals) {
        if (!priceNoVat) priceNoVat = Number(smeta.totals.price_no_vat) || 0;
        priceWithVat = Number(smeta.totals.price_with_vat) || 0;
        const v = Number(smeta.totals.vat_pct);
        if (v > 0) vatPct = v;
      }
    } catch (_) {}

    if (!priceWithVat && priceNoVat) priceWithVat = Math.round(priceNoVat * (1 + vatPct / 100) * 100) / 100;

    state = {
      tenderId: tenderId,
      tender: {
        id: tenderId,
        customer_name: row.customer_name || '',
        tender_title: row.tender_title || row.title || ''
      },
      pricingPreview: {
        price_no_vat: priceNoVat,
        price_with_vat: priceWithVat,
        vat_pct: vatPct,
        vat_with: Math.max(0, priceWithVat - priceNoVat)
      },
      variant: 'classic',
      phase: STATE_IDLE,
      onDone: typeof o.onDone === 'function' ? o.onDone : null
    };

    showModal('ТКП через ИИ', 'Просчёт РП закрыт — формируем КП по нему', '');
    stepVariant();
  }

  /** Есть ли смысл показывать кнопку в строке реестра. */
  function canOffer(row) {
    if (!row || !canCreate()) return false;
    if (row.tkp_exists) return false;
    const rev = row.rp_review || {};
    if (!rev.is_final) return false;
    // Директор отклонил — ТКП не формируем. В ячейке реестра для этого состояния
    // рисуется «✕ Отклонено», и предлагать рядом кнопку ИИ было бы противоречием.
    if (rev.director_review_status === 'rejected') return false;
    // Ждём решения директора — цена ещё не зафиксирована.
    if (rev.director_review_status === 'pending') return false;
    // Просчёт закрыт «подаём» либо согласован директором.
    if (rev.decision === 'submit') return true;
    return rev.director_review_status === 'approved';
  }

  return {
    open: open,
    canOffer: canOffer,
    canCreate: canCreate
  };
})();
