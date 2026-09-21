/**
 * analysis_checklist.js — общий UI чек-листа анализа тендера (D-203).
 *
 * Одна верстка и логика на два места:
 *   • вкладка «Чек-лист» в модалке анализа (редактирование) — rp_review_modal.js;
 *   • блок «Чек-лист» на странице просчёта (только чтение) — rp_calc_modal.js.
 *
 * Источник данных — GET /api/tenders/:id/analysis-checklist (шаблон + сохранённые ответы).
 * Шаблон редактируется из настроек и приходит с бэка: хардкода вопросов здесь нет.
 */
window.AsgardAnalysisChecklist = (function () {
  const esc = (s) => (window.AsgardUI && AsgardUI.esc) ? AsgardUI.esc(s) : String(s == null ? '' : s);

  function api() { return window.AsgardRegistryApi || {}; }

  // Стабильные id строк, чтобы не путать DOM-узлы между перерисовками.
  function rowIds() {
    return {
      base: (i) => 'rpClQ_' + i,
      free: (i) => 'rpClF_' + i
    };
  }

  function isFree(q) { return q && q.kind === 'free'; }

  /**
   * HTML формы чек-листа.
   * @param {Array} template — список вопросов с бэка
   * @param {Object} answers — { questionId: answer }
   * @param {Array} freeAnswers — [{ id, text, answer }] (свои вопросы аналитика)
   * @param {{readOnly?: boolean, tenderId?: number, wordUrl?: string}} opts
   */
  function html(template, answers, freeAnswers, opts) {
    opts = opts || {};
    const ro = !!opts.readOnly;
    const tpl = Array.isArray(template) ? template : [];
    const a = (answers && typeof answers === 'object') ? answers : {};
    const free = Array.isArray(freeAnswers) ? freeAnswers : [];

    if (!tpl.length) {
      return '<div class="rp-cl rp-cl-empty"><p class="muted">Шаблон чек-листа пуст. ' +
        (ro ? '' : 'Настройте вопросы в разделе «Настройки → Чек-лист анализа».') + '</p></div>';
    }

    let h = '<div class="rp-cl" data-rp-cl' + (ro ? ' data-rp-cl-ro="1"' : '') + '>';

    // Порядок работы: ТЗ → компания → свои вопросы → звонок → чек-лист.
    h += '<div class="rp-cl-steps">' +
      '<div class="rp-cl-step"><span class="rp-cl-step-n">1</span> Прочитайте ТЗ (файлы тендера ниже)</div>' +
      '<div class="rp-cl-step"><span class="rp-cl-step-n">2</span> Изучите компанию-заказчика</div>' +
      '<div class="rp-cl-step"><span class="rp-cl-step-n">3</span> Выпишите свои вопросы</div>' +
      '<div class="rp-cl-step"><span class="rp-cl-step-n">4</span> Позвоните клиенту и заполните ответы</div>' +
      '</div>';

    h += '<div class="rp-cl-head"><strong>Звонок по тендеру</strong>' +
      (opts.wordUrl ? '<a class="btn mini ghost" href="' + esc(opts.wordUrl) + '" target="_blank" rel="noreferrer">Скачать (Word)</a>' : '') +
      '</div>';

    const qs = tpl.filter((q) => !isFree(q));
    const freeTpl = tpl.filter(isFree);

    h += '<div class="rp-cl-list">';
    qs.forEach((q, i) => {
      const val = a[q.id] != null ? String(a[q.id]) : '';
      h += '<div class="rp-cl-item">' +
        '<label class="rp-cl-label" for="' + rowIds().base(i) + '">' +
        esc(q.text) + (q.required ? ' <span class="req">*</span>' : '') +
        '</label>' +
        '<textarea class="inp rp-cl-answer" id="' + rowIds().base(i) + '" data-cl-id="' + esc(q.id) + '" rows="2"' +
        (ro ? ' readonly' : '') + '>' + esc(val) + '</textarea>' +
        '</div>';
    });
    h += '</div>';

    // Свободные строки: ТО/РП дописывает свои вопросы, ответ идёт в Word.
    h += '<div class="rp-cl-free-head">Свои вопросы <span class="muted">(необязательно)</span></div>';
    h += '<div class="rp-cl-free">';
    const maxFree = Math.max(freeTpl.length, free.length, 2);
    for (let i = 0; i < maxFree; i++) {
      const src = free[i] || freeTpl[i] || {};
      const text = src.text && src.text.indexOf('Свободный вопрос') !== 0 ? src.text : '';
      h += '<div class="rp-cl-free-row">' +
        '<input class="inp rp-cl-free-q" id="' + rowIds().free(i) + '" data-cl-free-q="' + i + '"' +
        ' placeholder="Ваш вопрос"' + (ro ? ' readonly' : '') + ' value="' + esc(text) + '"/>' +
        '<textarea class="inp rp-cl-free-a" data-cl-free-a="' + i + '" rows="2" placeholder="Ответ"' +
        (ro ? ' readonly' : '') + '>' + esc(src.answer || '') + '</textarea>' +
        '</div>';
    }
    h += '</div>';

    if (!ro) {
      h += '<div class="rp-cl-actions">' +
        '<button type="button" class="btn mini ghost" id="rpClSave">Сохранить чек-лист</button>' +
        '<span class="muted rp-cl-status" id="rpClStatus"></span>' +
        '</div>';
    }
    h += '</div>';
    return h;
  }

  /** Собирает ответы из DOM. Возвращает { answers, free_answers, missing } */
  function collect(root) {
    root = root || document;
    const answers = {};
    root.querySelectorAll('[data-cl-id]').forEach((el) => {
      const id = el.getAttribute('data-cl-id');
      const v = (el.value || '').trim();
      if (v) answers[id] = v;
    });
    const free_answers = [];
    const seen = new Set();
    root.querySelectorAll('[data-cl-free-q]').forEach((el) => {
      const i = Number(el.getAttribute('data-cl-free-q'));
      seen.add(i);
      const text = (el.value || '').trim();
      const answer = (root.querySelector('[data-cl-free-a="' + i + '"]')?.value || '').trim();
      if (text || answer) {
        free_answers.push({ id: 'free' + (i + 1), text: text || ('Свободный вопрос ' + (i + 1)), answer });
      }
    });

    // Что обязательно и не заполнено — по разметке (метка .req внутри .rp-cl-item).
    const missing = [];
    root.querySelectorAll('.rp-cl-item').forEach((item) => {
      const lab = item.querySelector('.rp-cl-label');
      const ta = item.querySelector('[data-cl-id]');
      if (!lab || !ta) return;
      if (!lab.querySelector('.req')) return;
      if (!(ta.value || '').trim()) {
        missing.push({ id: ta.getAttribute('data-cl-id'), text: lab.textContent.replace('*', '').trim() });
      }
    });

    return { answers, free_answers, missing };
  }

  /** Сохранение. requireComplete=true — жёсткая проверка обязательных. */
  async function save(tenderId, root, opts) {
    opts = opts || {};
    const payload = collect(root || document);
    if (opts.requireComplete && payload.missing.length) {
      const err = new Error('Заполните обязательные вопросы чек-листа');
      err.code = 'CHECKLIST_INCOMPLETE';
      err.missing = payload.missing;
      throw err;
    }
    const body = {
      answers: payload.answers,
      free_answers: payload.free_answers,
      require_complete: !!opts.requireComplete
    };
    return api().saveAnalysisChecklist(tenderId, body);
  }

  /** Загружает шаблон + ответы. Никогда не бросает — возвращает safe-дефолт. */
  async function load(tenderId) {
    try {
      const d = await api().loadAnalysisChecklist(tenderId);
      return {
        template: d.template || [],
        answers: (d.checklist && d.checklist.answers) || {},
        free_answers: (d.checklist && d.checklist.free_answers) || [],
        tender: d.tender || null,
        saved: !!d.checklist
      };
    } catch (_) {
      return { template: [], answers: {}, free_answers: [], tender: null, saved: false, error: true };
    }
  }

  /** Внутримодальный просмотр с загрузкой (для просчёта). */
  function renderInto(hostId, tenderId, opts) {
    opts = opts || {};
    const host = document.getElementById(hostId);
    if (!host) return Promise.resolve();
    host.innerHTML = '<p class="muted">Загрузка чек-листа…</p>';
    return load(tenderId).then((d) => {
      const wordUrl = opts.wordUrl || (api().analysisChecklistWordUrl ? api().analysisChecklistWordUrl(tenderId) : '');
      host.innerHTML = d.saved
        ? html(d.template, d.answers, d.free_answers, { readOnly: true, wordUrl })
        : '<p class="muted">Чек-лист ещё не заполнен.</p>';
      return d;
    });
  }

  return { html, collect, save, load, renderInto, isFree };
})();
