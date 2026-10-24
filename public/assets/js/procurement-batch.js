/**
 * ASGARD CRM — СОГЛАСОВАНИЕ СЧЕТОВ (D-316, переработка V411)
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик 20.10.2026:
 *   • «почему я закрыл и вышел, а счета ушли директору без подтверждения»;
 *   • «нужна модалка подтверждения и возможность создать черновик, сохранить,
 *      выйти, зайти заново, удалить счёт или заменить, подредактировать — а не
 *      сразу отправлять»;
 *   • «нет раскрытия предпросмотра, увеличения, где указывать сроки оплаты»;
 *   • «инпуты, кнопки, селекторы и вкладки модалки — не премиум».
 *
 * ЧТО БЫЛО СЛОМАНО (корень, а не косметика):
 *   1. На КАЖДЫЙ загруженный файл модуль звал POST /api/payment-invoices, а тот
 *      создавал заявку в статусе 'awaiting_dir' и ТУТ ЖЕ отправлял письмо
 *      директору. Кнопка «Отправить директору» была бутафорией: письма уже
 *      ушли. Закрытие модалки ничего не отменяло — отсюда жалоба.
 *   2. PATCH/DELETE для счёта не существовали вовсе: правки полей и «Удалить
 *      счёт» шли в 404, а ошибка глоталась `.catch(() => {})`. Пользователь
 *      «правил» сумму, а в базу уходило распознанное.
 *
 * ЧТО ТЕПЕРЬ:
 *   • загрузка → ЧЕРНОВИК (status='draft'), писем нет;
 *   • «Сохранить черновик» — явно; закрытие модалки ничего не отправляет;
 *   • «Мои черновики» — вернуться, заменить файл, удалить, дозаполнить;
 *   • отправка директору — отдельная кнопка + модалка подтверждения со сводкой;
 *   • превью с зумом, полноэкранным просмотром и листанием;
 *   • сроки оплаты, тип оплаты и график — в своей вкладке, а не в куче полей.
 *
 * Вкладки: «Счёт» · «Условия» · «Проверка». Внутри — сетка превью + форма.
 */
window.AsgardPaymentBatch = (function () {
  const UI = window.AsgardUI || {};
  const $ = UI.$ || ((s) => document.querySelector(s));
  const esc = UI.esc || ((s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const toast = UI.toast || ((t, m) => console.log(t, m));
  const showModal = UI.showModal || (() => {});
  const closeModal = UI.closeModal || (() => {});

  function hdr() {
    const t = localStorage.getItem('asgard_token') || '';
    return t ? { Authorization: 'Bearer ' + t } : {};
  }
  async function api(url, opts) {
    const r = await fetch(url, { ...(opts || {}), headers: { ...hdr(), ...((opts && opts.headers) || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.hint || j.error || ('HTTP ' + r.status));
    return j;
  }
  const money2 = (v) => (Number(v || 0)).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';

  const STATUS_LABEL = { upload: 'Загрузка', ocr: 'Распознавание', ready: 'Готов', error: 'Ошибка' };
  const TAB_LABEL = { main: 'Счёт', terms: 'Условия', review: 'Проверка' };

  let S = null;
  /** @type {{items:Array,activeIdx:number,tab:string,sent:boolean,zoom:number,draftsShown:boolean}} */
  function newState() {
    return {
      items: [],       // { localId, file, invoiceId, draft, status, progress, fields, error, savedAt }
      activeIdx: 0,
      tab: 'main',
      sent: false,
      zoom: 1,
      full: false,
      showDrafts: false,
      drafts: [],
      dirty: false
    };
  }

  // ═══ ОТКРЫТИЕ ══════════════════════════════════════════════════════════════
  async function open() {
    S = newState();
    const html = `
      <div class="pbm">
        <div class="pbm__hero">
          <div class="pbm__hero-main">
            <div class="pbm__eyebrow">Финансы · согласование</div>
            <h3 class="pbm__title">Счета на оплату</h3>
            <p class="pbm__sub">Загрузите счета — они станут <b>черновиками</b>. Директор увидит их только после того, как вы сами нажмёте «Отправить».</p>
          </div>
          <div class="pbm__hero-side">
            <button type="button" class="pbm-btn pbm-btn--ghost" id="pbm-drafts">Мои черновики</button>
            <div class="pbm__badge" id="pbm-count">0</div>
          </div>
        </div>

        <!-- Компактная зона загрузки: строка, а не экран. Пока счетов нет —
             она главная; как только счёт загружен — становится тонкой полосой,
             чтобы не отнимать рабочую площадь. -->
        <label class="pbm-drop" id="pbm-drop" for="pbm-file">
          <input type="file" id="pbm-file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp">
          <span class="pbm-drop__ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
          </span>
          <span class="pbm-drop__txt">
            <span class="pbm-drop__t">Добавить счета</span>
            <span class="pbm-drop__s">PDF, PNG, JPG · можно несколько сразу</span>
          </span>
        </label>

        <div class="pbm__layout" id="pbm-layout" hidden>
          <aside class="pbm__side">
            <div class="pbm__side-head">
              <span>Счета в работе</span>
              <span class="pbm__side-n" id="pbm-side-n">0</span>
            </div>
            <div class="pbm__list" id="pbm-list"></div>
          </aside>
          <section class="pbm__work" id="pbm-work"></section>
        </div>

        <div class="pbm__empty" id="pbm-empty">
          <div class="pbm__empty-t">Пока нет ни одного счёта</div>
          <p class="pbm__empty-s">Загрузите файл выше или вернитесь к сохранённым черновикам — они ждут вас.</p>
        </div>

        <footer class="pbm__foot">
          <div class="pbm__total">
            <span class="pbm__total-k">Итого к оплате</span>
            <b class="pbm__total-v" id="pbm-total">0,00 ₽</b>
          </div>
          <div class="pbm__foot-hint" id="pbm-hint">Черновики не отправляются сами — даже если закрыть окно.</div>
          <div class="pbm__acts">
            <button type="button" class="pbm-btn pbm-btn--quiet" id="pbm-close">Закрыть</button>
            <button type="button" class="pbm-btn pbm-btn--ghost" id="pbm-save" disabled>Сохранить черновик</button>
            <button type="button" class="pbm-btn pbm-btn--primary" id="pbm-submit" disabled>Отправить директору</button>
          </div>
        </footer>
      </div>`;
    showModal({ title: 'Согласование счетов', html, wide: true, icon: '₽' });
    bind();
    render();
    // Подтягиваем сохранённые черновики, чтобы было видно «зашёл заново».
    loadDrafts().catch(() => {});
  }

  function bind() {
    const inp = document.getElementById('pbm-file');
    const drop = document.getElementById('pbm-drop');
    if (inp) inp.onchange = () => { addFiles([...inp.files]); inp.value = ''; };
    if (drop) {
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
      drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) addFiles([...e.dataTransfer.files]); });
    }
    document.getElementById('pbm-close').onclick = () => onClose();
    document.getElementById('pbm-save').onclick = () => saveDrafts();
    document.getElementById('pbm-submit').onclick = () => confirmAndSend();
    document.getElementById('pbm-drafts').onclick = () => toggleDrafts();
    // Esc/клик по фону не должны «выкидывать» молча, если есть несохранённое.
    document.addEventListener('keydown', onKey, { once: false });
  }

  function onKey(e) {
    if (!document.getElementById('pbm-layout')) return;
    if (e.key === 'Escape') {
      if (S && S.full) { S.full = false; renderWork(); e.preventDefault(); e.stopPropagation(); }
    }
  }

  function onClose() {
    if (S && S.dirty) {
      const ok = window.confirm('В черновиках есть несохранённые правки. Сохранить перед закрытием?\n\nОК — сохранить и закрыть · Отмена — закрыть без сохранения.');
      if (ok) { saveDrafts().then(() => { closeModal(); }); return; }
    }
    closeModal();
  }

  // ═══ ЗАГРУЗКА ══════════════════════════════════════════════════════════════
  function addFiles(files) {
    const ok = files.filter((f) => /pdf|image\//i.test(f.type || '') || /\.(pdf|png|jpe?g|webp)$/i.test(f.name));
    if (!ok.length) { toast('Файлы', 'Нужны PDF или изображения счёта', 'err'); return; }
    for (const f of ok) {
      S.items.push({
        localId: 'l' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        file: f, invoiceId: null, draft: true, status: 'upload', progress: 0,
        fields: {}, error: null, savedAt: null, replacedFile: false
      });
    }
    if (S.items.length === ok.length) S.activeIdx = 0;
    render();
    // Последовательно: не душим сервер пачкой OCR.
    (async () => {
      for (const it of S.items) {
        if (it.status === 'upload') await processItem(it);
      }
    })();
  }

  /** Загрузка файла → ЧЕРНОВИК → OCR → поля. Никаких писем. */
  async function processItem(it) {
    try {
      it.status = 'upload'; it.progress = 8; it.error = null; render();
      const fd = new FormData();
      fd.append('file', it.file);
      const up = await fetch('/api/payment-invoices/upload', { method: 'POST', headers: hdr(), body: fd });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(uj.error || 'Не удалось загрузить файл');
      it.progress = 34; render();

      if (it.invoiceId) {
        // Замена файла в существующем черновике — PATCH, а не новая карточка.
        await api('/api/payment-invoices/' + it.invoiceId, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_path: uj.file_path, file_name: uj.file_name })
        });
        it.replacedFile = true;
      } else {
        const created = await api('/api/payment-invoices', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: 0,
            supplier_name: 'Распознаётся…',
            file_path: uj.file_path,
            file_name: uj.file_name,
            basis_type: 'other'
          })
        });
        it.invoiceId = created.id;
        it.draft = true;
      }
      it.progress = 58; it.status = 'ocr'; render();

      const rec = await api('/api/payment-invoices/' + it.invoiceId + '/recognize', { method: 'POST' });
      it.fields = rec.fields || {};
      // Распознанное подставляем, только если человек ещё не правил руками.
      if (it.fields.amount != null) it.fields.amount = Number(it.fields.amount) || 0;
      it.engine = rec.engine;
      it.confidence = rec.confidence;
      it.progress = 100; it.status = 'ready';
      S.dirty = true;
      render();
    } catch (e) {
      it.status = 'error'; it.error = e.message; it.progress = 100; render();
    }
  }

  function readyItems() { return S.items.filter((x) => (x.status === 'ready' || x.status === 'saved') && x.invoiceId); }
  function totalSum() { return readyItems().reduce((s, x) => s + Number((x.fields && x.fields.amount) || 0), 0); }

  // ═══ РЕНДЕР ════════════════════════════════════════════════════════════════
  function render() {
    if (!S) return;
    const layout = document.getElementById('pbm-layout');
    const empty = document.getElementById('pbm-empty');
    const cnt = document.getElementById('pbm-count');
    const tot = document.getElementById('pbm-total');
    const saveBtn = document.getElementById('pbm-save');
    const subBtn = document.getElementById('pbm-submit');
    const hint = document.getElementById('pbm-hint');
    if (!cnt) return;

    const n = S.items.length;
    cnt.textContent = n ? String(n) : '0';
    if (layout) layout.hidden = n === 0;
    if (empty) empty.hidden = n > 0;
    if (tot) tot.textContent = money2(totalSum());
    if (saveBtn) saveBtn.disabled = !readyItems().length || S.sent;
    if (subBtn) subBtn.disabled = !readyItems().length || S.sent;
    if (hint) {
      hint.textContent = S.sent
        ? 'Отправлено директору. Дальше решение принимает он.'
        : (readyItems().length
          ? 'Проверьте суммы и нажмите «Отправить» — только тогда директор получит письмо.'
          : 'Черновики не отправляются сами — даже если закрыть окно.');
    }
    renderList();
    renderWork();
  }

  function statLabel(it) {
    if (it.savedAt && it.status === 'saved') return 'Сохранён';
    return STATUS_LABEL[it.status] || it.status;
  }

  function renderList() {
    const list = document.getElementById('pbm-list');
    const sideN = document.getElementById('pbm-side-n');
    if (!list) return;
    if (sideN) sideN.textContent = String(S.items.length);
    list.innerHTML = S.items.map((it, i) => {
      const f = it.fields || {};
      const sum = f.amount ? money2(f.amount) : '—';
      const sup = f.supplier_name && f.supplier_name !== 'Распознаётся…' ? f.supplier_name : (it.status === 'ready' ? 'не распознан' : '—');
      const cls = it.status === 'saved' ? 'ready' : it.status;
      return `<button type="button" class="pbm-item ${i === S.activeIdx ? 'is-active' : ''} pbm-item--${cls}" data-idx="${i}">
        <span class="pbm-item__top">
          <span class="pbm-item__n">Счёт ${i + 1}</span>
          <span class="pbm-item__st pbm-item__st--${cls}">${esc(statLabel(it))}</span>
        </span>
        <span class="pbm-item__sup">${esc(sup)}</span>
        <span class="pbm-item__row"><span>${esc(f.invoice_number || 'б/н')}</span><b>${sum}</b></span>
        ${it.status !== 'ready' && it.status !== 'saved' ? `<span class="pbm-item__bar"><i style="width:${it.progress}%"></i></span>` : ''}
        ${it.error ? `<span class="pbm-item__err">${esc(it.error)}</span>` : ''}
      </button>`;
    }).join('');
    list.querySelectorAll('[data-idx]').forEach((b) => {
      b.onclick = () => { S.activeIdx = +b.getAttribute('data-idx'); S.zoom = 1; S.tab = 'main'; render(); };
    });
  }

  function renderWork() {
    const work = document.getElementById('pbm-work');
    if (!work) return;
    const it = S.items[S.activeIdx];
    if (!it) { work.innerHTML = ''; return; }

    if (it.status === 'upload' || it.status === 'ocr') {
      const stage = it.status === 'upload' ? 'Загружаем файл' : 'Распознаём счёт';
      work.innerHTML = `<div class="pbm-load">
        <div class="pbm-load__spin" aria-hidden="true"></div>
        <div class="pbm-load__t">${stage}…</div>
        <div class="pbm-load__bar"><i style="width:${it.progress}%"></i></div>
        <div class="pbm-load__s">${it.progress}% · это черновик, директору ничего не ушло</div>
      </div>`;
      return;
    }
    if (it.status === 'error') {
      work.innerHTML = `<div class="pbm-err">
        <div class="pbm-err__t">Не удалось обработать счёт</div>
        <div class="pbm-err__s">${esc(it.error || '')}</div>
        <div class="pbm-err__acts">
          <button type="button" class="pbm-btn pbm-btn--ghost" data-retry>Загрузить заново</button>
          <button type="button" class="pbm-btn pbm-btn--quiet" data-remove>Убрать</button>
        </div>
      </div>`;
      work.querySelector('[data-retry]').onclick = () => retryItem(S.activeIdx);
      work.querySelector('[data-remove]').onclick = () => removeItem(S.activeIdx);
      return;
    }

    const f = it.fields || {};
    const conf = Math.round((it.confidence || 0) * 100);
    work.innerHTML = `
      <div class="pbm-split">
        ${previewHtml(it)}
        <div class="pbm-form">
          <div class="pbm-tabs" role="tablist">
            ${['main', 'terms', 'review'].map((t) => `
              <button type="button" role="tab" aria-selected="${S.tab === t}"
                      class="pbm-tab ${S.tab === t ? 'is-on' : ''}" data-tab="${t}">${TAB_LABEL[t]}</button>`).join('')}
          </div>
          <div class="pbm-form__body" role="tabpanel">
            ${S.tab === 'main' ? tabMain(it, f, conf) : (S.tab === 'terms' ? tabTerms(it, f) : tabReview(it, f))}
          </div>
        </div>
      </div>`;
    bindWork(work, it);
  }

  function previewHtml(it) {
    const tok = encodeURIComponent(localStorage.getItem('asgard_token') || '');
    const src = `/api/payment-invoices/preview/${it.invoiceId}?token=${tok}`;
    const fileUrl = `/api/payment-invoices/${it.invoiceId}/file`;
    const z = S.zoom || 1;
    return `<div class="pbm-prev ${S.full ? 'is-full' : ''}">
      <div class="pbm-prev__head">
        <span class="pbm-prev__t">${esc(it.file ? it.file.name : (it.draftFile || 'Скан счёта'))}</span>
        <div class="pbm-prev__tools">
          <button type="button" class="pbm-ico" data-zoom="-1" title="Уменьшить">−</button>
          <span class="pbm-prev__z">${Math.round(z * 100)}%</span>
          <button type="button" class="pbm-ico" data-zoom="1" title="Увеличить">+</button>
          <button type="button" class="pbm-ico" data-zoom="reset" title="Сбросить масштаб">⤾</button>
          <button type="button" class="pbm-ico" data-full title="${S.full ? 'Свернуть' : 'На весь экран'}">${S.full ? '⤡' : '⤢'}</button>
          <a class="pbm-ico" href="${fileUrl}" target="_blank" rel="noopener" title="Открыть оригинал">↗</a>
        </div>
      </div>
      <div class="pbm-prev__stage">
        <img class="pbm-prev__img" src="${src}" alt="Скан счёта"
             style="transform:scale(${z})"
             onerror="this.closest('.pbm-prev__stage').innerHTML='<div class=pbm-prev__err>Превью недоступно<br><a href=&quot;${fileUrl}&quot; target=_blank rel=noopener>Открыть оригинал</a></div>'">
      </div>
      <div class="pbm-prev__nav">
        <button type="button" class="pbm-btn pbm-btn--quiet pbm-btn--sm" data-nav="-1" ${S.activeIdx === 0 ? 'disabled' : ''}>‹ Пред.</button>
        <span class="pbm-prev__count">${S.activeIdx + 1} из ${S.items.length}</span>
        <button type="button" class="pbm-btn pbm-btn--quiet pbm-btn--sm" data-nav="1" ${S.activeIdx >= S.items.length - 1 ? 'disabled' : ''}>След. ›</button>
      </div>
    </div>`;
  }

  function field(label, key, val, type, opts) {
    const o = opts || {};
    const v = type === 'date' ? String(val || '').slice(0, 10) : (val == null ? '' : val);
    return `<label class="pbm-f ${o.wide ? 'pbm-f--wide' : ''}">
      <span class="pbm-f__l">${label}${o.req ? ' <i class="pbm-f__req">*</i>' : ''}</span>
      <input class="pbm-in" type="${type || 'text'}" data-f="${key}"
             value="${esc(v)}" ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ''}
             ${o.min != null ? `min="${o.min}"` : ''} ${o.step ? `step="${o.step}"` : ''} />
      ${o.help ? `<span class="pbm-f__h">${esc(o.help)}</span>` : ''}
    </label>`;
  }

  function tabMain(it, f, conf) {
    const gross = Number(f.amount) || 0;
    const rate = f.vat_rate;
    const vat = Number(f.vat_amount) || 0;
    const net = rate && rate > 0 ? Math.round((gross - vat) * 100) / 100 : gross;
    const sup = f.supplier_name && f.supplier_name !== 'Распознаётся…' ? f.supplier_name : '';
    // Карточка контрагента из базы (если выбран из подсказки).
    const card = it.supplierCard || null;
    return `
      <div class="pbm-sec">
        <div class="pbm-sec__h">
          <span>Поставщик</span>
          ${conf ? `<span class="pbm-conf ${conf >= 70 ? 'is-ok' : 'is-warn'}">распознано ${conf}%${it.engine === 'ai' ? ' · ИИ' : ''}</span>` : ''}
        </div>

        <div class="pbm-cp" id="pbm-cp-${it.localId}">
          <input class="pbm-in" data-cp-search autocomplete="off"
                 value="${esc(sup)}"
                 placeholder="Название или ИНН — подскажем из базы" />
          <div class="pbm-cp__drop" data-cp-drop hidden></div>
        </div>

        ${card ? `
        <div class="pbm-card">
          <div class="pbm-card__top">
            <div class="pbm-card__name">${esc(card.name)}</div>
            ${card.inn ? `<div class="pbm-card__inn">ИНН ${esc(card.inn)}</div>` : ''}
          </div>
          <div class="pbm-card__stats">
            <span class="pbm-stat ${card.docs_count ? 'is-on' : ''}">
              <b>${card.docs_count || 0}</b> ${plural(card.docs_count || 0, 'счёт', 'счёта', 'счетов')} в реестре
            </span>
            <span class="pbm-stat ${card.contracts_count ? 'is-on' : ''}">
              <b>${card.contracts_count || 0}</b> ${plural(card.contracts_count || 0, 'договор', 'договора', 'договоров')}
            </span>
            ${card.contracts_count ? `<span class="pbm-badge-ok">работаем по договору</span>` : '<span class="pbm-badge-warn">договора в базе нет</span>'}
          </div>
          ${(card.phone || card.email) ? `<div class="pbm-card__contacts">${esc([card.phone, card.email].filter(Boolean).join(' · '))}</div>` : ''}
        </div>` : (sup ? `<div class="pbm-card pbm-card--warn">
          <div class="pbm-card__top"><div class="pbm-card__name">${esc(sup)}</div></div>
          <div class="pbm-card__stats"><span class="pbm-badge-warn">нет в базе поставщиков — проверьте название или ИНН</span></div>
        </div>` : '')}

        <div class="pbm-grid">
          ${field('ИНН', 'inn', f.inn, 'text', { placeholder: '10 или 12 цифр' })}
          ${field('Номер счёта', 'invoice_number', f.invoice_number, 'text', { placeholder: 'например 1185' })}
          ${field('Дата счёта', 'invoice_date', f.invoice_date, 'date')}
        </div>
      </div>

      <div class="pbm-sec">
        <div class="pbm-sec__h"><span>Суммы</span></div>
        <div class="pbm-money">
          <label class="pbm-money__main">
            <span>Сумма с НДС</span>
            <input class="pbm-money__in" type="number" step="0.01" min="0" data-f="amount" value="${f.amount != null ? f.amount : ''}" placeholder="0,00" />
          </label>
          <div class="pbm-money__side">
            <div class="pbm-money__row"><span>Без НДС</span><b data-net>${money2(net)}</b></div>
            <div class="pbm-money__row"><span>НДС</span><b data-vat>${money2(vat)}</b></div>
          </div>
        </div>
        <div class="pbm-vat">
          <span class="pbm-f__l">Ставка НДС</span>
          <div class="pbm-chips" data-vat-chips>
            ${[null, 0, 5, 7, 10, 20, 22].map((r) => `
              <button type="button" class="pbm-chip ${String(rate == null ? '' : rate) === String(r == null ? '' : r) ? 'is-on' : ''}"
                      data-vat="${r == null ? '' : r}">${r == null ? 'без НДС' : r + '%'}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="pbm-sec">
        <div class="pbm-sec__h"><span>Файл</span></div>
        <div class="pbm-file">
          <div class="pbm-file__info">
            <b>${esc(it.file ? it.file.name : 'загружен')}</b>
            <span>Можно заменить — счёт останется тем же черновиком</span>
          </div>
          <label class="pbm-btn pbm-btn--ghost pbm-btn--sm" for="pbm-replace">Заменить</label>
          <input type="file" id="pbm-replace" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden />
        </div>
      </div>`;
  }

  /** Склонение для счётчиков: 1 счёт / 2 счёта / 5 счетов. */
  function plural(n, one, few, many) {
    const a = Math.abs(Number(n) || 0) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function tabTerms(it, f) {
    const sk = f.spend_kind || it.spend_kind || 'work';
    const ctype = f.contract_type || 'none';
    const cfound = it.contractFound;
    return `
      <div class="pbm-sec">
        <div class="pbm-sec__h"><span>Вид расхода</span></div>
        <div class="pbm-chips" data-spend-chips>
          ${[['work', 'Работы / объект'], ['warehouse', 'Склад / материалы'], ['office', 'Офис / АХО'], ['other', 'Прочее']]
            .map(([v, l]) => `<button type="button" class="pbm-chip ${sk === v ? 'is-on' : ''}" data-spend="${v}">${l}</button>`).join('')}
        </div>
        <span class="pbm-f__h">${sk === 'work'
          ? 'Для работ объект обязателен — расход попадёт в смету объекта.'
          : 'Офис/склад/прочее — объект не нужен, расход идёт в общий реестр.'}</span>
      </div>

      ${sk === 'work' ? `
      <div class="pbm-sec" data-work-sec>
        <div class="pbm-sec__h"><span>Объект / работа</span>${f.work_id ? '<span class="pbm-conf is-ok">выбран</span>' : '<span class="pbm-conf is-warn">не выбран</span>'}</div>
        ${f.work_id ? `<div class="pbm-picked">
          <div class="pbm-picked__main">
            <b>${esc(f.work_label || ('#' + f.work_id))}</b>
            ${f.work_object ? `<span>${esc(f.work_object)}</span>` : ''}
            ${f.work_customer ? `<span>${esc(f.work_customer)}</span>` : ''}
          </div>
          <button type="button" class="pbm-btn pbm-btn--quiet pbm-btn--sm" data-work-clear>Сменить</button>
        </div>` : `
        <div class="pbm-cp"><input class="pbm-in" data-work-search placeholder="Название, адрес, город, номер или заказчик" autocomplete="off" />
          <div class="pbm-cp__drop" data-work-drop hidden></div></div>
        <span class="pbm-f__h">Начните вводить — покажем объекты из базы</span>`}
      </div>` : `
      <input type="hidden" data-f="work_id" value="" />
      <input type="hidden" data-f="work_label" value="" />`}

      <div class="pbm-sec">
        <div class="pbm-sec__h"><span>Договор</span>${cfound === true ? '<span class="pbm-conf is-ok">найден в базе</span>' : (cfound === false ? '<span class="pbm-conf is-warn">не найден</span>' : '')}</div>
        <div class="pbm-grid">
          <label class="pbm-f pbm-f--wide">
            <span class="pbm-f__l">Договор-основание</span>
            <select class="pbm-in" data-f="contract_type">
              <option value="none" ${ctype === 'none' ? 'selected' : ''}>Без договора</option>
              <option value="general" ${ctype === 'general' ? 'selected' : ''}>Общий / рамочный (заявки без номера)</option>
              <option value="once" ${ctype === 'once' ? 'selected' : ''}>Разовая поставка</option>
              <option value="contract" ${ctype === 'contract' ? 'selected' : ''}>Есть договор — указать номер</option>
            </select>
          </label>
          ${ctype === 'contract' ? `
            ${field('Номер договора', 'contract_number', f.contract_number, 'text', { placeholder: 'например ДП-2025/14' })}
            ${field('Дата договора', 'contract_date', f.contract_date, 'date')}
            <div class="pbm-f pbm-f--wide">
              <button type="button" class="pbm-btn pbm-btn--ghost pbm-btn--sm" data-contract-pick>
                ${f.contract_id ? '✓ Договор выбран — сменить' : 'Выбрать договор из базы'}
              </button>
              ${cfound === false ? `<span class="pbm-warn-line">Договор с таким номером у этого поставщика не найден. Проверьте номер или выберите из базы.</span>` : ''}
              ${cfound === true ? `<span class="pbm-ok-line">Договор есть в базе — расход привяжется к нему.</span>` : ''}
            </div>` : ''}
        </div>
      </div>

      <div class="pbm-sec">
        <div class="pbm-sec__h"><span>Сроки</span></div>
        <div class="pbm-grid">
          ${field('Срок оплаты', 'payment_due_at', f.payment_due_at, 'date', { help: 'Когда должны оплатить по договору' })}
          ${field('Срок ожидания СФ', 'sf_due_at', f.sf_due_at, 'date', { help: 'Когда ждём закрывающий документ' })}
          ${field('Услуга оказана', 'service_done_at', f.service_done_at, 'date')}
        </div>
      </div>

      <div class="pbm-sec">
        <div class="pbm-sec__h"><span>Порядок оплаты</span></div>
        <div class="pbm-grid">
          <label class="pbm-f">
            <span class="pbm-f__l">Тип оплаты</span>
            <select class="pbm-in" data-f="pay_timing">
              <option value="immediate" ${(f.pay_timing || 'immediate') === 'immediate' ? 'selected' : ''}>Сразу после согласования</option>
              <option value="deferred" ${f.pay_timing === 'deferred' ? 'selected' : ''}>Отложенная — к указанному сроку</option>
            </select>
          </label>
          <label class="pbm-f">
            <span class="pbm-f__l">Основание СФ</span>
            <select class="pbm-in" data-f="sf_basis">
              <option value="invoice" ${(f.sf_basis || 'invoice') === 'invoice' ? 'selected' : ''}>По счёту</option>
              <option value="service" ${f.sf_basis === 'service' ? 'selected' : ''}>По оказанию услуги</option>
            </select>
          </label>
          ${field('Сумма НДС', 'vat_amount', f.vat_amount, 'number', { min: 0, step: '0.01', help: vatHint(f) })}
        </div>
      </div>`;
  }

  function tabReview(it, f) {
    const rows = [
      ['Поставщик', f.supplier_name === 'Распознаётся…' ? '—' : f.supplier_name],
      ['Счёт', [f.invoice_number || 'б/н', f.invoice_date].filter(Boolean).join(' · ')],
      ['Сумма с НДС', f.amount != null ? money2(f.amount) : '—'],
      ['НДС', f.vat_rate == null ? 'без НДС' : (f.vat_rate + '% · ' + money2(f.vat_amount || 0))],
      ['Срок оплаты', f.payment_due_at || 'не указан'],
      ['Тип оплаты', f.pay_timing === 'deferred' ? 'отложенная' : 'сразу после согласования'],
      ['Основание', f.contract_number || f.basis_type || '—'],
      ['Объект', f.work_hint || '—']
    ];
    const ready = f.supplier_name && f.supplier_name !== 'Распознаётся…' && Number(f.amount) > 0;
    return `
      <div class="pbm-sec">
        <div class="pbm-sec__h"><span>Что увидит директор</span></div>
        <dl class="pbm-review">
          ${rows.map(([k, v]) => `<div class="pbm-review__row"><dt>${esc(k)}</dt><dd>${esc(String(v == null || v === '' ? '—' : v))}</dd></div>`).join('')}
        </dl>
      </div>
      <div class="pbm-sec">
        <div class="pbm-checks">
          <div class="pbm-check ${ready ? 'is-ok' : 'is-bad'}">
            <span class="pbm-check__i">${ready ? '✓' : '!'}</span>
            <span class="pbm-check__t">${ready ? 'Обязательные поля заполнены' : 'Заполните поставщика и сумму'}</span>
          </div>
          <div class="pbm-check is-ok">
            <span class="pbm-check__i">✓</span>
            <span class="pbm-check__t">Файл счёта приложен — директор увидит скан</span>
          </div>
          <div class="pbm-check is-ok">
            <span class="pbm-check__i">✓</span>
            <span class="pbm-check__t">Это черновик: письмо уйдёт только после вашего подтверждения</span>
          </div>
        </div>
      </div>`;
  }

  function vatHint(f) {
    const gross = Number(f.amount) || 0;
    const rate = f.vat_rate;
    const vat = Number(f.vat_amount) || 0;
    if (rate == null || rate === '') return gross ? 'без НДС' : '';
    const r = Number(rate);
    if (!gross) return r + '%';
    const expect = Math.round(gross * r / (100 + r) * 100) / 100;
    if (Math.abs(expect - vat) < 1) return r + '% · сумма НДС сходится';
    return `${r}% · ожидается ${expect.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
  }

  // ═══ ОБРАБОТЧИКИ ═══════════════════════════════════════════════════════════
  function bindWork(work, it) {
    // Вкладки
    work.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => { S.tab = b.getAttribute('data-tab'); renderWork(); };
    });
    // Поля → состояние (и флаг «есть несохранённое»)
    work.querySelectorAll('[data-f]').forEach((inp) => {
      const ev = inp.tagName === 'SELECT' ? 'change' : 'input';
      inp.addEventListener(ev, () => {
        const k = inp.getAttribute('data-f');
        if (!it.fields) it.fields = {};
        it.fields[k] = inp.type === 'number' ? (parseFloat(inp.value) || 0) : inp.value;
        S.dirty = true;
        // D-369 (раунд 14): при правке СУММЫ пересчитываем нетто/НДС, если ставка
        // уже выбрана. Иначе «ввёл 1000 → нажал 22 % → исправил на 500» оставляло
        // net/vat от 1000, и в реестр уходила карточка «нетто 819,67 при сумме 500»:
        // нетто больше брутто, числа не сходятся ни в карточке, ни в платёжке.
        if (k === 'amount' && it.fields.vat_rate != null) {
          const g = Number(it.fields.amount) || 0;
          const r = Number(it.fields.vat_rate);
          if (g > 0 && r >= 0) {
            const v = Math.round(g * r / (100 + r) * 100) / 100;
            it.fields.vat_amount = v;
            it.fields.amount_net = Math.round((g - v) * 100) / 100;
            const vInp = work.querySelector('[data-f="vat_amount"]');
            if (vInp) vInp.value = it.fields.vat_amount;
          }
        }
        // Пересчёт сумм на месте, без перерисовки (чтобы не терять фокус).
        if (k === 'amount' || k === 'vat_amount') updateMoneyDom(work, it);
      });
    });
    // Ставка НДС
    work.querySelectorAll('[data-vat]').forEach((b) => {
      b.onclick = () => {
        const raw = b.getAttribute('data-vat');
        if (!it.fields) it.fields = {};
        it.fields.vat_rate = raw === '' ? null : Number(raw);
        const gross = Number(it.fields.amount) || 0;
        const r = it.fields.vat_rate;
        if (r != null && gross > 0) {
          it.fields.vat_amount = Math.round(gross * r / (100 + r) * 100) / 100;
        } else {
          it.fields.vat_amount = 0;
        }
        S.dirty = true;
        renderWork();
      };
    });
    // Превью: зум / полный экран / листание
    work.querySelectorAll('[data-zoom]').forEach((b) => {
      b.onclick = () => {
        const v = b.getAttribute('data-zoom');
        if (v === 'reset') S.zoom = 1;
        else S.zoom = Math.min(3, Math.max(0.5, (S.zoom || 1) + (v === '1' ? 0.25 : -0.25)));
        const img = work.querySelector('.pbm-prev__img');
        if (img) img.style.transform = `scale(${S.zoom})`;
        const zl = work.querySelector('.pbm-prev__z');
        if (zl) zl.textContent = Math.round(S.zoom * 100) + '%';
      };
    });
    work.querySelector('[data-full]')?.addEventListener('click', () => { S.full = !S.full; renderWork(); });
    work.querySelectorAll('[data-nav]').forEach((b) => {
      b.onclick = () => {
        const d = +b.getAttribute('data-nav');
        const next = S.activeIdx + d;
        if (next >= 0 && next < S.items.length) { S.activeIdx = next; S.zoom = 1; renderWork(); }
      };
    });
    // Замена файла
    const repl = work.querySelector('#pbm-replace');
    if (repl) {
      repl.onchange = async () => {
        const f = repl.files && repl.files[0];
        if (!f) return;
        it.file = f;
        it.status = 'upload'; it.progress = 10;
        render();
        await processItem(it);
        toast('Файл заменён', 'Счёт остался тем же черновиком', 'ok');
      };
    }
    // ── Вид расхода: работы → нужен объект; офис/склад/прочее → нет ──
    work.querySelectorAll('[data-spend]').forEach((b) => {
      b.onclick = () => {
        if (!it.fields) it.fields = {};
        it.fields.spend_kind = b.getAttribute('data-spend');
        // Смена вида расхода сбрасывает объект: для офиса он не нужен и
        // унаследованный work_id дал бы ложную привязку в реестре.
        if (it.fields.spend_kind !== 'work') {
          it.fields.work_id = null;
          it.fields.work_label = '';
          it.fields.work_object = '';
        }
        S.dirty = true;
        renderWork();
      };
    });
    work.querySelector('[data-work-clear]')?.addEventListener('click', () => {
      if (!it.fields) it.fields = {};
      it.fields.work_id = null; it.fields.work_label = ''; it.fields.work_object = '';
      S.dirty = true;
      renderWork();
    });

    // ── Договор: смена типа ──
    work.querySelector('[data-f="contract_type"]')?.addEventListener('change', (e) => {
      if (!it.fields) it.fields = {};
      const v = e.target.value;
      it.fields.contract_type = v;
      // basis_type — то, что уходит в заявку/реестр (совместимость с бэком).
      it.fields.basis_type = v === 'contract' ? 'contract' : v;
      if (v !== 'contract') {
        it.fields.contract_number = null;
        it.fields.contract_id = null;
        it.contractFound = null;
      }
      S.dirty = true;
      renderWork();
    });
    // ── Договор: проверка номера по базе + выбор ──
    work.querySelector('[data-f="contract_number"]')?.addEventListener('change', () => {
      checkContractNumber(it).then(() => renderWork());
    });
    work.querySelector('[data-contract-pick]')?.addEventListener('click', () => pickContract(it));

    bindSupplierSearch(work, it);
    bindWorkSearch(work, it);
  }

  // ═══ ПОСТАВЩИК: подсказки с реальными счётчиками ═══════════════════════════
  function bindSupplierSearch(work, it) {
    const wrap = work.querySelector('.pbm-cp');
    const inp = work.querySelector('[data-cp-search]');
    const drop = work.querySelector('[data-cp-drop]');
    if (!wrap || !inp || !drop) return;
    let tmr = null;
    let items = [];

    const paint = () => {
      if (!items.length) { drop.hidden = true; drop.innerHTML = ''; return; }
      drop.hidden = false;
      drop.innerHTML = items.map((c, i) => {
        const docs = Number(c.docs_count) || 0;
        const ctr = Number(c.contracts_count) || 0;
        return `<button type="button" class="pbm-cp__item" data-ci="${i}">
          <span class="pbm-cp__name">${esc(c.name)}</span>
          <span class="pbm-cp__sub">
            ${c.inn ? `ИНН ${esc(c.inn)} · ` : ''}${docs} ${plural(docs, 'счёт', 'счёта', 'счетов')} · ${ctr} ${plural(ctr, 'договор', 'договора', 'договоров')}
          </span>
        </button>`;
      }).join('');
      drop.querySelectorAll('[data-ci]').forEach((b) => {
        b.onclick = () => {
          const c = items[+b.getAttribute('data-ci')];
          if (!c) return;
          if (!it.fields) it.fields = {};
          it.fields.supplier_name = c.name;
          it.fields.supplier_id = c.id || null;
          if (c.inn) it.fields.inn = c.inn;
          if (c.phone) it.fields.counterparty_phone = c.phone;
          if (c.email) it.fields.counterparty_email = c.email;
          // Карточка «работаем по договору / N счетов» — из тех же данных.
          it.supplierCard = {
            name: c.name, inn: c.inn, phone: c.phone, email: c.email,
            docs_count: Number(c.docs_count) || 0,
            contracts_count: Number(c.contracts_count) || 0
          };
          S.dirty = true;
          items = []; drop.hidden = true;
          renderWork();
        };
      });
    };

    inp.oninput = () => {
      const q = inp.value.trim();
      clearTimeout(tmr);
      if (q.length < 2) { items = []; paint(); return; }
      tmr = setTimeout(async () => {
        try {
          const j = await api('/api/customers/registry-suggest?q=' + encodeURIComponent(q) + '&limit=10');
          items = (j && j.suppliers) || [];
        } catch (_) { items = []; }
        paint();
      }, 220);
    };
    // По Enter / потере фокуса без выбора — фиксируем введённое название как есть.
    inp.addEventListener('change', () => {
      const v = inp.value.trim();
      if (!it.fields) it.fields = {};
      if (v && v !== (it.fields.supplier_name || '')) {
        it.fields.supplier_name = v;
        it.supplierCard = null;     // выбранного из базы больше нет
        S.dirty = true;
        renderWork();
      }
    });
    inp.onblur = () => { setTimeout(() => { drop.hidden = true; }, 180); };
  }

  // ═══ ОБЪЕКТ: выбор из базы, а не свободный текст ═══════════════════════════
  function bindWorkSearch(work, it) {
    const inp = work.querySelector('[data-work-search]');
    const drop = work.querySelector('[data-work-drop]');
    if (!inp || !drop) return;
    let tmr = null;
    let items = [];

    const paint = () => {
      if (!items.length) {
        drop.hidden = false;
        drop.innerHTML = '<div class="pbm-cp__empty">Ничего не нашлось. Уточните запрос.</div>';
        return;
      }
      drop.hidden = false;
      drop.innerHTML = items.map((w, i) => `<button type="button" class="pbm-cp__item" data-wi="${i}">
        <span class="pbm-cp__name">${esc(w.label)}</span>
        <span class="pbm-cp__sub">${esc([w.object_name, w.address, w.customer].filter(Boolean).join(' · ') || 'без адреса')}</span>
      </button>`).join('');
      drop.querySelectorAll('[data-wi]').forEach((b) => {
        b.onclick = () => {
          const w = items[+b.getAttribute('data-wi')];
          if (!w) return;
          if (!it.fields) it.fields = {};
          it.fields.work_id = w.id;
          it.fields.work_label = w.label;
          it.fields.work_object = w.object_name || '';
          it.fields.work_customer = w.customer || '';
          S.dirty = true;
          items = []; drop.hidden = true;
          renderWork();
        };
      });
    };

    const search = async (term) => {
      try {
        const j = await api('/api/payment-invoices/work-search?limit=20' + (term ? '&q=' + encodeURIComponent(term) : ''));
        items = (j && j.items) || [];
      } catch (_) { items = []; }
      paint();
    };

    inp.oninput = () => {
      const q = inp.value.trim();
      clearTimeout(tmr);
      tmr = setTimeout(() => search(q), 250);
    };
    inp.onfocus = () => { if (!items.length) search(''); };
    inp.onblur = () => { setTimeout(() => { drop.hidden = true; }, 200); };
  }

  // ═══ ДОГОВОР: проверка номера и выбор из базы ══════════════════════════════
  async function checkContractNumber(it) {
    const f = it.fields || {};
    const num = String(f.contract_number || '').trim();
    if (!num) { it.contractFound = null; return; }
    try {
      // Ищем договор по номеру у выбранного поставщика (или вообще, если
      // поставщик ещё не выбран — тогда только подтверждаем существование).
      // D-370: идём на РЕАЛЬНЫЙ эндпоинт. Раньше здесь был `/api/contracts`,
      // которого не существует (404) — ошибка глоталась, и подпись «Проверяем
      // по реестру договоров» висела вечно, а договор к счёту не привязывался.
      const res = await api('/api/payment-invoices/contract-search?q=' + encodeURIComponent(num) + '&limit=20');
      const list = Array.isArray(res) ? res : (res.items || []);
      const cpName = String(f.supplier_name || '').toLowerCase().trim();
      const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
      const hit = list.find((c) => norm(c.number) === norm(num)
        && (!cpName || norm(c.counterparty_name || c.customer_name || '').includes(norm(cpName).slice(0, 12))))
        || list.find((c) => norm(c.number) === norm(num));
      if (hit) {
        it.contractFound = true;
        it.fields.contract_id = hit.id;
        it.fields.contract_number = hit.number || num;
        it.fields.contract_date = String(hit.signed_date || hit.start_date || '').slice(0, 10) || f.contract_date;
      } else {
        it.contractFound = false;
        it.fields.contract_id = null;
      }
    } catch (_) { it.contractFound = null; }
  }

  async function pickContract(it) {
    // Используем штатный реестр договоров CRM (тот же, что в Doc Hub).
    try {
      // D-370: тот же реальный эндпоинт. Пустой `q` не принимается сервером
      // (там минимум 2 символа), поэтому ищем по началу названия контрагента.
      const seed = String((it.fields && it.fields.supplier_name) || '').trim().slice(0, 24) || 'ДП';
      const res = await api('/api/payment-invoices/contract-search?q=' + encodeURIComponent(seed) + '&limit=50');
      const list = Array.isArray(res) ? res : (res.items || []);
      const cpName = String((it.fields && it.fields.supplier_name) || '').toLowerCase();
      const mine = cpName
        ? list.filter((c) => String(c.counterparty_name || c.customer_name || '').toLowerCase().includes(cpName.slice(0, 12)))
        : list;
      const pool = (mine.length ? mine : list).slice(0, 200);
      if (!pool.length) { toast('Договоры', 'В базе нет договоров — заполните номер вручную', 'warn'); return; }

      const html = `<div class="pbm-pick">
        <input class="pbm-in" id="pbm-pick-q" placeholder="Поиск по номеру, предмету, контрагенту" autocomplete="off" />
        <div class="pbm-pick__list" id="pbm-pick-list"></div>
      </div>`;
      showModal({ title: 'Выберите договор', html, icon: '§' });
      const root = document.querySelector('.pbm-pick');
      if (!root) return;
      const listEl = root.querySelector('#pbm-pick-list');
      const qEl = root.querySelector('#pbm-pick-q');
      const paint = (term) => {
        const s = String(term || '').toLowerCase().trim();
        const hit = pool.filter((c) => !s || [c.number, c.subject, c.counterparty_name, c.customer_name]
          .filter(Boolean).join(' ').toLowerCase().includes(s));
        listEl.innerHTML = hit.length ? hit.map((c) => `
          <button type="button" class="pbm-pick__item" data-id="${c.id}" data-num="${esc(c.number || '')}"
                  data-date="${esc(String(c.signed_date || c.start_date || '').slice(0, 10))}">
            <span class="pbm-pick__n">№ ${esc(c.number || 'б/н')}</span>
            <span class="pbm-pick__s">${esc([c.subject, c.counterparty_name || c.customer_name].filter(Boolean).join(' · ') || '—')}</span>
          </button>`).join('') : '<div class="pbm-cp__empty">Ничего не найдено</div>';
        listEl.querySelectorAll('[data-id]').forEach((b) => {
          b.onclick = () => {
            if (!it.fields) it.fields = {};
            it.fields.contract_id = Number(b.getAttribute('data-id'));
            it.fields.contract_number = b.getAttribute('data-num');
            it.fields.contract_date = b.getAttribute('data-date') || null;
            it.fields.contract_type = 'contract';
            it.fields.basis_type = 'contract';
            it.contractFound = true;
            S.dirty = true;
            closeModal();
            renderWork();
            toast('Договор выбран', 'Найден в базе — привяжется к заявке', 'ok');
          };
        });
      };
      paint('');
      qEl.oninput = () => paint(qEl.value);
    } catch (e) {
      toast('Договоры', e.message || 'Не удалось открыть реестр', 'err');
    }
  }

  function updateMoneyDom(work, it) {
    const f = it.fields || {};
    const gross = Number(f.amount) || 0;
    const vat = Number(f.vat_amount) || 0;
    const net = gross - vat;
    const nEl = work.querySelector('[data-net]');
    const vEl = work.querySelector('[data-vat]');
    if (nEl) nEl.textContent = money2(net > 0 ? net : 0);
    if (vEl) vEl.textContent = money2(vat);
  }


  function retryItem(idx) {
    const it = S.items[idx];
    if (!it) return;
    Object.assign(it, { status: 'upload', progress: 0, error: null });
    render();
    processItem(it);
  }

  async function removeItem(idx) {
    const it = S.items[idx];
    if (!it) return;
    if (it.invoiceId) {
      try { await api('/api/payment-invoices/' + it.invoiceId, { method: 'DELETE' }); }
      catch (e) {
        // Не глотаем: удалить отправленный счёт нельзя — говорим почему.
        toast('Не удалено', e.message || 'Счёт уже отправлен', 'err');
        return;
      }
    }
    S.items.splice(idx, 1);
    if (S.activeIdx >= S.items.length) S.activeIdx = Math.max(0, S.items.length - 1);
    S.dirty = false;
    render();
    toast('Удалено', 'Счёт убран из черновиков', 'ok');
  }

  // ═══ ЧЕРНОВИКИ ═════════════════════════════════════════════════════════════
  async function saveDrafts() {
    const ready = readyItems();
    if (!ready.length) return;
    const btn = document.getElementById('pbm-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…'; }
    let okN = 0;
    for (const it of ready) {
      try {
        await api('/api/payment-invoices/' + it.invoiceId, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draftPayload(it))
        });
        okN++;
        it.savedAt = new Date();
        it.status = 'saved';
      } catch (e) {
        toast('Не сохранено', `Счёт ${it.invoiceId}: ${e.message}`, 'err');
      }
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Сохранить черновик'; }
    S.dirty = false;
    render();
    if (okN) toast('Черновик сохранён', `${okN === 1 ? 'Счёт' : okN + ' счетов'} в «Мои черновики». Директору ничего не ушло.`, 'ok');
  }

  async function loadDrafts() {
    try {
      const j = await api('/api/payment-invoices/drafts');
      S.drafts = (j.items || []);
      const btn = document.getElementById('pbm-drafts');
      if (btn && S.drafts.length) btn.textContent = `Мои черновики · ${S.drafts.length}`;
    } catch (_) { /* необязательно */ }
  }

  async function toggleDrafts() {
    await loadDrafts().catch(() => {});
    if (!S.drafts.length) { toast('Черновиков нет', 'Загрузите счёт — он станет черновиком', 'ok'); return; }
    const work = document.getElementById('pbm-work');
    const layout = document.getElementById('pbm-layout');
    if (layout) layout.hidden = false;
    if (!work) return;
    work.innerHTML = `<div class="pbm-drafts">
      <div class="pbm-drafts__h">Мои черновики <span>${S.drafts.length}</span></div>
      ${S.drafts.map((d) => `
        <div class="pbm-drafts__row">
          <div class="pbm-drafts__main">
            <b>${esc(d.supplier_name || 'без поставщика')}</b>
            <span>${esc([d.invoice_number, d.invoice_date && String(d.invoice_date).slice(0, 10)].filter(Boolean).join(' · ') || 'без номера')}</span>
          </div>
          <div class="pbm-drafts__sum">${d.amount ? money2(d.amount) : '—'}</div>
          <button type="button" class="pbm-btn pbm-btn--ghost pbm-btn--sm" data-open="${d.id}">Открыть</button>
          <button type="button" class="pbm-icon-btn" data-del="${d.id}" title="Удалить черновик">✕</button>
        </div>`).join('')}
    </div>`;
    work.querySelectorAll('[data-open]').forEach((b) => {
      b.onclick = () => openDraft(Number(b.getAttribute('data-open')));
    });
    work.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.getAttribute('data-del'));
        if (!window.confirm('Удалить черновик? Действие необратимо, но директор его не видел.')) return;
        try {
          await api('/api/payment-invoices/' + id, { method: 'DELETE' });
          toast('Удалено', 'Черновик удалён', 'ok');
          await loadDrafts();
          toggleDrafts();
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
    });
  }

  /** Открыть сохранённый черновик как элемент очереди. */
  async function openDraft(id) {
    try {
      const d = await api('/api/payment-invoices/' + id);
      const fields = {
        supplier_name: d.supplier_name || '',
        supplier_id: d.supplier_id || null,
        inn: d.counterparty_inn || '',
        invoice_number: d.invoice_number || '',
        invoice_date: d.invoice_date ? String(d.invoice_date).slice(0, 10) : '',
        payment_due_at: d.due_date ? String(d.due_date).slice(0, 10) : '',
        amount: d.amount != null ? Number(d.amount) : '',
        vat_amount: d.vat_amount != null ? Number(d.vat_amount) : '',
        vat_rate: d.vat_rate != null ? Number(d.vat_rate) * (Number(d.vat_rate) <= 1 ? 100 : 1) : null,
        basis_type: d.basis_type || 'other',
        contract_type: d.basis_type === 'contract' ? 'contract' : (d.basis_type || 'none'),
        contract_id: d.contract_id || null,
        contract_number: d.contract_basis_number || '',
        work_id: d.work_id || null,
        work_label: d.work_hint || (d.work_id ? '#' + d.work_id : ''),
        pay_timing: d.pay_timing || 'immediate',
        // D-369 (дефект найден верификатором): вид расхода УГАДЫВАЛСЯ по work_id
        // и basis_type. Сотрудник заполнял «Офис/АХО» с телефона, открывал тот же
        // черновик на компьютере, нажимал «Сохранить» — и вид расхода молча
        // превращался в «работы»/«прочее». Теперь берём реальное значение.
        spend_kind: d.spend_kind
          || (d.work_id ? 'work' : (d.basis_type === 'other' ? 'other' : 'work')),
        // Остальные поля, которые мобилка уже заполняет, а десктоп не
        // восстанавливал: пересохранение обнуляло их (тот же класс дефекта).
        sf_due_at: d.sf_due_at ? String(d.sf_due_at).slice(0, 10) : '',
        service_done_at: d.service_done_at ? String(d.service_done_at).slice(0, 10) : '',
        sf_basis: d.sf_basis || 'invoice',
        comment_text: d.comment_text || ''
      };
      const exists = S.items.some((x) => Number(x.invoiceId) === Number(id));
      if (!exists) {
        const item = {
          localId: 'd' + id, file: null, invoiceId: Number(id), draft: true,
          status: 'saved', progress: 100, fields, error: null, savedAt: new Date()
        };
        S.items.push(item);
        S.activeIdx = S.items.length - 1;
        S.tab = 'main'; S.zoom = 1; S.full = false;
        // Сначала рисуем форму, ПОТОМ доливаем карточку контрагента — иначе
        // renderWork() отработает по ещё не вставленному DOM и карточка
        // потеряется (так и было: hasSupplierCard=false при живом API).
        render();
        if (d.supplier_id || d.supplier_name) {
          hydrateSupplierCard(item, d.supplier_name, d.supplier_id).catch(() => {});
        }
        if (d.work_id) hydrateWorkLabel(item, d.work_id).catch(() => {});
        return;
      }
      S.activeIdx = S.items.findIndex((x) => Number(x.invoiceId) === Number(id));
      S.tab = 'main'; S.zoom = 1; S.full = false;
      render();
    } catch (e) { toast('Ошибка', e.message || 'Не удалось открыть черновик', 'err'); }
  }

  /**
   * Дозаполнить карточку контрагента реальными счётчиками (счетов/договоров)
   * из той же точки, что и подсказки в реестре счетов.
   */
  async function hydrateSupplierCard(it, name, supplierId) {
    const nm = String(name || '').trim();
    if (!nm) return;
    const j = await api('/api/customers/registry-suggest?q=' + encodeURIComponent(nm) + '&limit=10');
    const list = (j && j.suppliers) || [];
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    const hit = list.find((c) => (supplierId && Number(c.id) === Number(supplierId)) || norm(c.name) === norm(nm));
    if (!hit) { it.supplierCard = null; if (document.getElementById('pbm-work')) renderWork(); return; }
    it.supplierCard = {
      name: hit.name, inn: hit.inn, phone: hit.phone, email: hit.email,
      docs_count: Number(hit.docs_count) || 0,
      contracts_count: Number(hit.contracts_count) || 0
    };
    if (!it.fields.supplier_id) it.fields.supplier_id = hit.id;
    if (!it.fields.inn && hit.inn) it.fields.inn = hit.inn;
    if (document.getElementById('pbm-work')) renderWork();
  }

  /** Подтянуть название/объект выбранной работы (для блока «Объект»). */
  async function hydrateWorkLabel(it, workId) {
    try {
      const j = await api('/api/payment-invoices/work-search?limit=50');
      const items = (j && j.items) || [];
      let hit = items.find((w) => Number(w.id) === Number(workId));
      if (!hit) {
        // Работа может быть вне первых 50 — ищем точечно.
        const j2 = await api('/api/payment-invoices/work-search?q=' + encodeURIComponent('#' + workId) + '&limit=20');
        hit = ((j2 && j2.items) || []).find((w) => Number(w.id) === Number(workId));
      }
      if (hit) {
        it.fields.work_label = hit.label;
        it.fields.work_object = hit.object_name || '';
        it.fields.work_customer = hit.customer || '';
      } else if (!it.fields.work_label) {
        it.fields.work_label = '#' + workId;
      }
      // renderWork может не найти контейнер (карточку закрыли) — это не ошибка.
      if (document.getElementById('pbm-work')) renderWork();
    } catch (_) { /* подсказка не критична — не ломаем карточку */ }
  }

  // ═══ ОТПРАВКА С ПОДТВЕРЖДЕНИЕМ ════════════════════════════════════════════
  function confirmAndSend() {
    const ready = readyItems();
    if (!ready.length) return;
    const bad = ready.filter((it) => {
      const f = it.fields || {};
      return !f.supplier_name || f.supplier_name === 'Распознаётся…' || !(Number(f.amount) > 0);
    });
    const total = totalSum();
    const rows = ready.map((it) => {
      const f = it.fields || {};
      const incomplete = !f.supplier_name || f.supplier_name === 'Распознаётся…' || !(Number(f.amount) > 0);
      return `<li class="pbm-confirm__row ${incomplete ? 'is-bad' : ''}">
        <span class="pbm-confirm__n">${esc(f.invoice_number || 'б/н')}</span>
        <span class="pbm-confirm__s">${esc(f.supplier_name === 'Распознаётся…' ? 'поставщик не указан' : (f.supplier_name || 'поставщик не указан'))}</span>
        <b class="pbm-confirm__v">${incomplete ? 'нет данных' : money2(f.amount)}</b>
      </li>`;
    }).join('');

    const html = `<div class="pbm-confirm">
      <div class="pbm-confirm__head">
        <div class="pbm-confirm__ico">!</div>
        <div>
          <h4>Отправить директору?</h4>
          <p>Он получит письмо со счетами и решение примет он. После отправки изменить счёт будет нельзя.</p>
        </div>
      </div>
      <ul class="pbm-confirm__list">${rows}</ul>
      <div class="pbm-confirm__total">
        <span>Итого</span><b>${money2(total)}</b>
      </div>
      ${bad.length ? `<div class="pbm-confirm__warn">В ${bad.length} ${bad.length === 1 ? 'счёте' : 'счетах'} не заполнены поставщик или сумма — директор не сможет согласовать. Дозаполните или уберите их из отправки.</div>` : ''}
      <div class="pbm-confirm__acts">
        <button type="button" class="pbm-btn pbm-btn--quiet" data-cancel>Вернуться и проверить</button>
        <button type="button" class="pbm-btn pbm-btn--ghost" data-draft>Сохранить как черновик</button>
        <button type="button" class="pbm-btn pbm-btn--primary" data-go ${bad.length ? 'disabled' : ''}>
          ${bad.length ? 'Дозаполните счета' : `Отправить ${ready.length === 1 ? 'счёт' : ready.length + ' счетов'}`}
        </button>
      </div>
    </div>`;

    // Вложенная модалка: showModal поддерживает стек.
    showModal({ title: 'Подтверждение отправки', html, icon: '?' });
    const root = document.querySelector('.pbm-confirm');
    if (!root) return;
    root.querySelector('[data-cancel]').onclick = () => closeModal();
    root.querySelector('[data-draft]').onclick = async () => { await saveDrafts(); closeModal(); };
    const go = root.querySelector('[data-go]');
    if (go && !bad.length) go.onclick = () => sendNow(ready);
  }

  /**
   * D-316b: ОДНА точка сборки тела для сохранения черновика.
   * Раньше поля собирались в двух местах (saveDrafts и sendNow) копипастой —
   * из-за этого новые поля (объект, тип договора, ИНН) терялись при отправке.
   */
  function draftPayload(it) {
    const f = it.fields || {};
    const num = (v) => (v != null && v !== '' ? Number(v) : null);
    return {
      amount: Number(f.amount) || 0,
      supplier_name: (f.supplier_name && f.supplier_name !== 'Распознаётся…') ? f.supplier_name : null,
      supplier_id: num(f.supplier_id),
      invoice_number: f.invoice_number || null,
      invoice_date: f.invoice_date || null,
      due_date: f.payment_due_at || null,
      vat_amount: num(f.vat_amount),
      vat_rate: num(f.vat_rate),
      amount_net: num(f.amount_net),
      basis_type: f.basis_type || 'other',
      contract_basis_number: f.contract_number || null,
      contract_id: num(f.contract_id),
      work_id: num(f.work_id),
      // work_hint — человекочитаемая подсказка: нужна, если work_id не выбран.
      work_hint: f.work_id ? (f.work_label || null) : (f.work_hint || null),
      pay_timing: f.pay_timing || 'immediate',
      comment_text: f.comment_text || null,
      // D-368 (23.10.2026): ЭТИ ПОЛЯ РАНЬШЕ ТЕРЯЛИСЬ.
      // Пользователь выбирал «Офис / АХО», а до сервера вид расхода не доезжал:
      // в реестр счёт падал как «работы». Офисный расход не попадал в свой
      // реестр, а проектный привязывался не туда. Сроки и основание СФ тоже
      // нужны бухгалтерии, чтобы планировать закрывающие документы.
      spend_kind: ['work', 'warehouse', 'office', 'other'].includes(String(f.spend_kind || ''))
        ? f.spend_kind : null,
      sf_due_at: f.sf_due_at || null,
      service_done_at: f.service_done_at || null,
      sf_basis: ['invoice', 'service'].includes(String(f.sf_basis || '')) ? f.sf_basis : null
    };
  }

  async function sendNow(ready) {
    const go = document.querySelector('.pbm-confirm [data-go]');
    if (go) { go.disabled = true; go.textContent = 'Отправляем…'; }
    try {
      // Сначала сохраняем правки (иначе директор увидит распознанное, а не ваше).
      for (const it of ready) {
        try {
          await api('/api/payment-invoices/' + it.invoiceId, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draftPayload(it))
          });
        } catch (e) {
          // Черновик могли отправить в другой вкладке — не молчим.
          toast('Не сохранено', `Счёт ${it.invoiceId}: ${e.message}`, 'err');
          throw e;
        }
      }
      const ids = ready.map((x) => x.invoiceId);
      const res = await api('/api/payment-invoices/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      const sent = (res.submitted || []).length;
      const skipped = res.skipped || [];
      const recognizing = res.recognizing || [];
      S.sent = true;
      S.dirty = false;
      closeModal();   // закрываем подтверждение
      render();
      if (sent) {
        toast('Отправлено директору', `${sent} ${sent === 1 ? 'счёт' : 'счетов'} · заявка ушла на согласование`, 'ok');
      }
      // D-320: счёт ещё распознаётся — директор его не увидит, пока не появятся
      // поставщик и сумма. Говорим прямо, а не молча пропускаем.
      if (recognizing.length) {
        toast('Распознаём', `${recognizing.length} ${recognizing.length === 1 ? 'счёт ещё распознаётся' : 'счетов ещё распознаются'} — директор увидит ${recognizing.length === 1 ? 'его' : 'их'} после распознавания поставщика и суммы. Откройте «Мои черновики» и отправьте, когда данные появятся.`, 'warn');
      }
      const rest = skipped.filter((s) => s.reason !== 'recognizing');
      if (rest.length) {
        const why = rest.map((s) => s.reason === 'no_file' ? 'нет файла' : 'уже отправлен').join(', ');
        toast('Часть не ушла', `${rest.length} шт. пропущено: ${why}`, 'warn');
      }
    } catch (e) {
      toast('Ошибка отправки', e.message, 'err');
      if (go) { go.disabled = false; go.textContent = 'Повторить отправку'; }
    }
  }

  return { open, newState, openDraft };
})();
