window.AsgardProcurementPage = (function() {
  const UI = window.AsgardUI || {};
  const $ = UI.$ || (s => document.querySelector(s));
  const esc = UI.esc || (s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const toast = UI.toast || ((t,m,type) => console.log(`[${type}] ${t}: ${m}`));
  const showModal = UI.showModal || (() => {});
  const closeModal = UI.closeModal || (() => {});

  let currentFilters = {};
  let _user = null;
  let _viewMode = localStorage.getItem('proc_view') || 'kanban'; // 'kanban' | 'table'
  let _groupMode = 'none'; // 'none' | 'category' | 'supplier' — группировка позиций в детали

  const STATUSES = {
    draft:{l:'Черновик',c:'proc-status--draft'},sent_to_proc:{l:'У закупщика',c:'proc-status--sent-to-proc'},
    proc_responded:{l:'Ответ закупщика',c:'proc-status--proc-responded'},pm_approved:{l:'РП согласовал',c:'proc-status--pm-approved'},
    dir_approved:{l:'Директор ✓',c:'proc-status--dir-approved'},dir_rework:{l:'На доработке',c:'proc-status--dir-rework'},
    dir_question:{l:'Вопрос',c:'proc-status--dir-question'},dir_rejected:{l:'Отклонена',c:'proc-status--dir-rejected'},
    paid:{l:'Оплачено',c:'proc-status--paid'},partially_delivered:{l:'Частичная',c:'proc-status--partially-delivered'},
    delivered:{l:'Доставлено',c:'proc-status--delivered'},closed:{l:'Закрыта',c:'proc-status--closed'}
  };

  const badge = s => { const st=STATUSES[s]||{l:s,c:''}; return `<span class="proc-status ${st.c}">${esc(st.l)}</span>`; };
  /** Демо/E2E-заголовки → «Заявка #id» (или «из корзины»). */
  function humanProcTitle(p) {
    if (!p) return 'Заявка';
    const raw = String(p.title || p.name || '').trim();
    const id = p.id != null ? p.id : '';
    if (/E2E|STORY\s*wave|WAVE\s*partial|FULL-BIZ|\d{10,}/i.test(raw)) {
      if (/cart|корзин/i.test(raw)) return 'Заявка из корзины';
      return id !== '' ? ('Заявка #' + id) : 'Заявка';
    }
    return raw || (id !== '' ? ('Заявка #' + id) : 'Заявка');
  }
  const INV_WAVE = {
    draft:{l:'Черновик',c:'proc-inv--draft'},
    awaiting_pm:{l:'На согласовании РП',c:'proc-inv--awaiting-pm'},
    pm_approved:{l:'РП согласовал',c:'proc-inv--pm-ok'},
    pm_returned:{l:'Вернул РП',c:'proc-inv--returned'},
    awaiting_dir:{l:'На оплату',c:'proc-inv--awaiting-dir'},
    dir_approved:{l:'К оплате',c:'proc-inv--dir-ok'},
    paid:{l:'Оплачен',c:'proc-inv--paid'}
  };
  const invBadge = s => { const st=INV_WAVE[s]||{l:s||'draft',c:'proc-inv--draft'}; return `<span class="proc-inv-badge ${st.c}">${esc(st.l)}</span>`; };
  const money = (v) => (AsgardUI.moneyRub || AsgardMoney.formatMoney)(v);
  const dt = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
  const dtFull = d => d ? new Date(d).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  function hdr() { const t=localStorage.getItem('asgard_token')||localStorage.getItem('auth_token'); return {'Authorization':'Bearer '+t,'Content-Type':'application/json'}; }
  async function apiFetch(url,opts={}) { const r=await fetch(url,{headers:hdr(),...opts}); if(!r.ok) throw new Error('HTTP '+r.status+': '+url); return r.json(); }
  async function apiPut(url,body) { return apiFetch(url,{method:'PUT',body:JSON.stringify(body||{})}); }
  async function apiPost(url,body) { return apiFetch(url,{method:'POST',body:JSON.stringify(body||{})}); }
  async function ensureUser() {
    if (_user && _user.role) return _user;
    try {
      const ud = await apiFetch('/api/users/me');
      _user = ud.user || ud;
    } catch (_) {
      try { _user = JSON.parse(localStorage.getItem('asgard_user') || 'null'); } catch (e) { _user = null; }
    }
    if (!_user) _user = { role: 'GUEST' };
    return _user;
  }
  function openCatalogProduct(pid) {
    const id = parseInt(pid, 10); if (!id) return;
    if (window.AsgardWarehouseV2 && typeof window.AsgardWarehouseV2.openProduct === 'function') {
      window.AsgardWarehouseV2.openProduct(id); return;
    }
    location.hash = '#/warehouse?product=' + id;
  }
  async function openCatalogSearch(name) {
    const q = String(name || '').trim();
    if (!q) { location.hash = '#/warehouse-v2'; return; }
    try {
      const d = await apiFetch('/api/products/search?q=' + encodeURIComponent(q) + '&limit=5');
      const hit = (d.items || d.products || [])[0];
      if (hit && hit.id) { openCatalogProduct(hit.id); return; }
    } catch (_) {}
    toast('Каталог', 'Совпадений нет — откройте склад и найдите вручную', 'warn');
    location.hash = '#/warehouse-v2';
  }
  async function invoiceWaveAction(procId, importId, action) {
    const comment = document.getElementById('proc-comment')?.value || '';
    try {
      const r = await apiPut(`/api/procurement/${procId}/invoice/${importId}/${action}`, { comment });
      if (r.error) { toast('Ошибка', r.error, 'err'); return; }
      if (action === 'send-to-dir' && r.payment_invoice_id) {
        toast('На оплату', `Счёт #${r.payment_invoice_id} у директора (очередь оплаты)`, 'ok');
      } else {
        toast('Готово', '', 'ok');
      }
      openDetail(procId);
    } catch (e) {
      toast('Ошибка', e.message || 'Не удалось', 'err');
    }
  }

  function payFileExt(name, url) {
    const s = String(name || '') + ' ' + String(url || '');
    const low = s.toLowerCase();
    if (low.includes('.pdf') || low.includes('application/pdf')) return 'pdf';
    if (/\.(png|jpe?g|gif|webp)(\?|$| )/i.test(low) || low.includes('image/')) return 'img';
    if (/\.(xlsx?|xls)(\?|$| )/i.test(low)) return 'xls';
    return 'other';
  }

  async function fetchAuthBlob(url) {
    const r = await fetch(url, { headers: { Authorization: hdr().Authorization } });
    if (!r.ok) throw new Error('Файл: HTTP ' + r.status);
    const blob = await r.blob();
    const ct = (r.headers.get('content-type') || blob.type || '').toLowerCase();
    return { blob, ct };
  }

  async function openAuthFile(url, fileName, asDownload) {
    try {
      const { blob } = await fetchAuthBlob(url);
      const u = URL.createObjectURL(blob);
      if (asDownload) {
        const a = document.createElement('a');
        a.href = u; a.download = fileName || 'invoice'; a.click();
        setTimeout(() => URL.revokeObjectURL(u), 60_000);
      } else {
        window.open(u, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(u), 120_000);
      }
    } catch (e) { toast('Файл', e.message || 'Не удалось открыть', 'err'); }
  }

  function payPreviewPane(fileUrl, fileName, opts) {
    const apiUrl = (opts && opts.apiUrl) || (fileUrl && String(fileUrl).startsWith('/api/') ? fileUrl : null);
    const staticUrl = (opts && opts.staticUrl) || (fileUrl && String(fileUrl).startsWith('/uploads/') ? fileUrl : null);
    const pay = opts && opts.pay;
    const src = staticUrl || null;
    if (!fileUrl && !apiUrl && !staticUrl && !pay) {
      return `<div class="proc-pay-modal__preview"><div class="proc-pay-modal__preview-head"><span>Файл счёта</span></div>
        <div class="proc-pay-modal__preview-empty"><strong>Нет файла счёта</strong><span>Без файла отправка на согласование недоступна</span></div></div>`;
    }
    let kind = payFileExt(fileName, fileUrl || apiUrl || staticUrl);
    const needLoad = !!apiUrl && !src && (kind === 'pdf' || kind === 'img' || kind === 'other');
    // Видимая «бумага» — всегда, даже если PDF-viewer в iframe пустой (headless / dark chrome)
    let paper = '';
    if (pay) {
      const lines = Array.isArray(pay.line_items_json) ? pay.line_items_json
        : (typeof pay.line_items_json === 'string' ? (() => { try { return JSON.parse(pay.line_items_json || '[]'); } catch (_) { return []; } })() : []);
      const lineHtml = lines.slice(0, 6).map(l =>
        `<div class="proc-pay-paper__row"><span>${esc(l.name || '—')}</span><span>${esc(String(l.qty ?? l.quantity ?? ''))}</span><span>${money(l.unit_price)}</span></div>`
      ).join('');
      paper = `<div class="proc-pay-paper" data-pay-paper="1">
        <div class="proc-pay-paper__brand">АСГАРД · СЧЁТ</div>
        <div class="proc-pay-paper__sum">${money(pay.amount)}</div>
        <div class="proc-pay-paper__meta">${esc(pay.supplier_name || '—')}<br>${esc(pay.basis_text || pay.basis_type || '')}</div>
        ${lineHtml ? `<div class="proc-pay-paper__lines">${lineHtml}</div>` : ''}
        <div class="proc-pay-paper__file">${esc(fileName || 'файл счёта')}${src || apiUrl ? ' · готов к открытию' : ''}</div>
      </div>`;
    }
    let media = '';
    if (needLoad) {
      media = `<div class="proc-pay-modal__preview-empty" data-pay-preview-load="1" style="min-height:120px"><strong>Загрузка файла…</strong></div>`;
    } else if (kind === 'pdf' && src) {
      media = `<iframe title="Счёт PDF" class="proc-pay-modal__pdf" src="${esc(src)}#toolbar=0&navpanes=0"></iframe>`;
    } else if (kind === 'img' && src) {
      media = `<img alt="Счёт" src="${esc(src)}">`;
    } else if (!paper) {
      media = `<div class="proc-pay-modal__preview-empty"><strong>Превью недоступно</strong><span>${esc(fileName || 'файл')} — скачайте или откройте</span></div>`;
    }
    const openUrl = apiUrl || staticUrl || fileUrl;
    return `<div class="proc-pay-modal__preview" data-pay-api="${esc(apiUrl || '')}" data-pay-static="${esc(staticUrl || '')}" data-pay-name="${esc(fileName || 'счёт')}" data-pay-kind="${kind}">
      <div class="proc-pay-modal__preview-head">
        <span title="${esc(fileName || 'счёт')}">${esc((fileName || 'Счёт').slice(0, 40))}</span>
        <div class="proc-pay-modal__preview-actions">
          <button type="button" class="btn ghost" data-pay-open="${esc(openUrl || '')}">Открыть</button>
          <button type="button" class="btn ghost" data-pay-dl="${esc(openUrl || '')}">Скачать</button>
        </div>
      </div>
      <div class="proc-pay-modal__preview-body">${paper}${media}</div>
    </div>`;
  }

  async function bindPayPreview(root) {
    const box = (root || document).querySelector('.proc-pay-modal__preview[data-pay-api]');
    if (!box) return;
    const apiUrl = box.getAttribute('data-pay-api');
    const staticUrl = box.getAttribute('data-pay-static');
    const name = box.getAttribute('data-pay-name') || 'счёт';
    let kind = box.getAttribute('data-pay-kind') || 'other';
    const openBtn = box.querySelector('[data-pay-open]');
    const dlBtn = box.querySelector('[data-pay-dl]');
    if (openBtn) openBtn.onclick = () => {
      const u = openBtn.getAttribute('data-pay-open') || staticUrl || apiUrl;
      if (!u) return;
      if (u.startsWith('/api/')) openAuthFile(u, name, false);
      else window.open(u, '_blank', 'noopener');
    };
    if (dlBtn) dlBtn.onclick = () => {
      const u = dlBtn.getAttribute('data-pay-dl') || staticUrl || apiUrl;
      if (!u) return;
      if (u.startsWith('/api/')) openAuthFile(u, name, true);
      else {
        const a = document.createElement('a'); a.href = u; a.download = name; a.click();
      }
    };
    if (!apiUrl || !box.querySelector('[data-pay-preview-load]')) return;
    try {
      const { blob, ct } = await fetchAuthBlob(apiUrl);
      if (kind === 'other') {
        if (ct.includes('pdf')) kind = 'pdf';
        else if (ct.startsWith('image/')) kind = 'img';
        else kind = payFileExt(name, ct);
      }
      const u = URL.createObjectURL(blob);
      const body = box.querySelector('.proc-pay-modal__preview-body');
      if (!body) return;
      const paper = body.querySelector('[data-pay-paper]');
      const paperHtml = paper ? paper.outerHTML : '';
      if (kind === 'pdf') body.innerHTML = paperHtml + `<iframe title="Счёт PDF" class="proc-pay-modal__pdf" src="${u}#toolbar=0"></iframe>`;
      else if (kind === 'img') body.innerHTML = paperHtml + `<img alt="Счёт" src="${u}">`;
      else if (!paperHtml) body.innerHTML = `<div class="proc-pay-modal__preview-empty"><strong>Превью недоступно</strong><span>${esc(name)} — откройте или скачайте</span></div>`;
      else body.innerHTML = paperHtml;
    } catch (e) {
      const body = box.querySelector('.proc-pay-modal__preview-body');
      if (body && !body.querySelector('[data-pay-paper]')) {
        body.innerHTML = `<div class="proc-pay-modal__preview-empty"><strong>Не удалось загрузить превью</strong><span>${esc(e.message || '')}</span></div>`;
      }
    }
  }

  function payStatusClass(pay) {
    if (pay.status === 'paid' || pay.payment_status === 'paid') return 'proc-pay-status--ok';
    if (pay.status === 'rejected') return 'proc-pay-status--bad';
    if (pay.payment_status === 'pending_payment' || pay.status === 'pending_payment') return 'proc-pay-status--pay';
    if (pay.status === 'awaiting_dir') return 'proc-pay-status--dir';
    return '';
  }

  async function openStandalonePaymentModal() {
    await ensureUser();
    let timing = 'immediate';
    const html = `<div class="proc-pay-modal">
      <div class="proc-pay-modal__layout">
        <div class="proc-pay-modal__main">
          <p class="proc-pay-modal__hint">Согласование оплаты без заявки закупки (ТО / операционные расходы). Директор получит письмо со счётом во вложении, затем счёт попадёт в очередь бухгалтерии.</p>
          <div class="proc-pay-modal__section">
            <div class="proc-pay-modal__section-title">Счёт <span class="proc-tooltip" title="PDF или скан счёта обязателен — без файла письмо не отправится">?</span></div>
            <label class="proc-pay-modal__label" for="sp-file">Файл счёта</label>
            <div class="proc-file" style="margin-bottom:10px">
              <label class="proc-file__btn" for="sp-file">Выбрать файл</label>
              <span class="proc-file__name" id="sp-file-name">файл не выбран</span>
              <input type="file" id="sp-file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png">
            </div>
            <label class="proc-pay-modal__label" for="sp-sup">Поставщик</label>
            <input id="sp-sup" class="proc-pay-modal__field" placeholder="ООО …" autocomplete="organization">
            <label class="proc-pay-modal__label" for="sp-amt">Сумма, ₽</label>
            <input id="sp-amt" class="proc-pay-modal__field" type="number" min="0" step="0.01" placeholder="0">
          </div>
          <div class="proc-pay-modal__section">
            <div class="proc-pay-modal__section-title">Основание</div>
            <label class="proc-pay-modal__label" for="sp-basis-type">Тип</label>
            <select id="sp-basis-type" class="proc-pay-modal__field">
              <option value="to">ТО / тендер</option><option value="work">Работа</option><option value="contract">Договор</option><option value="other">Прочее</option>
            </select>
            <label class="proc-pay-modal__label" for="sp-basis">Кратко: на что оплата <span class="proc-tooltip" title="Это увидит директор в письме и в CRM">?</span></label>
            <input id="sp-basis" class="proc-pay-modal__field" placeholder="Например: предоплата по ТО …">
            <label class="proc-pay-modal__label" for="sp-due">Срок оплаты</label>
            <input id="sp-due" class="proc-pay-modal__field" type="date">
          </div>
          <div class="proc-pay-modal__section">
            <div class="proc-pay-modal__section-title">Режим оплаты <span class="proc-tooltip" title="Сразу — бух платит после согласования. Отложенная — одобрено, ждёт даты">?</span></div>
            <div class="proc-pay-timing" id="sp-timing">
              <button type="button" class="proc-pay-timing__opt proc-pay-timing__opt--on" data-t="immediate"><strong>Сразу</strong><span>После согласования директора — в очередь буха</span></button>
              <button type="button" class="proc-pay-timing__opt" data-t="deferred"><strong>Отложенная</strong><span>Одобрено, оплата в указанный срок</span></button>
            </div>
          </div>
          <div class="proc-pay-modal__actions">
            <button class="btn primary" id="sp-submit" style="width:100%">Отправить директору</button>
          </div>
        </div>
        <div id="sp-preview-wrap">${payPreviewPane(null)}</div>
      </div>
    </div>`;
    showModal({ title: 'Новое согласование оплаты', html });
    const fileInp = document.getElementById('sp-file');
    const previewWrap = document.getElementById('sp-preview-wrap');
    let localUrl = null;
    if (fileInp) fileInp.onchange = () => {
      const n = document.getElementById('sp-file-name');
      const f = fileInp.files[0];
      if (n) n.textContent = (f && f.name) || 'файл не выбран';
      if (localUrl) URL.revokeObjectURL(localUrl);
      localUrl = f ? URL.createObjectURL(f) : null;
      if (previewWrap) previewWrap.innerHTML = payPreviewPane(localUrl, f && f.name);
    };
    document.getElementById('sp-timing').onclick = (e) => {
      const btn = e.target.closest('[data-t]');
      if (!btn) return;
      timing = btn.dataset.t;
      document.querySelectorAll('#sp-timing .proc-pay-timing__opt').forEach(el => {
        el.classList.toggle('proc-pay-timing__opt--on', el.dataset.t === timing);
      });
    };
    document.getElementById('sp-submit').onclick = async () => {
      const amount = parseFloat(document.getElementById('sp-amt').value);
      const supplier = document.getElementById('sp-sup').value.trim();
      const file = document.getElementById('sp-file').files[0];
      if (!file) { toast('Нужен файл', 'Прикрепите PDF или скан счёта', 'err'); return; }
      if (!supplier) { toast('Поставщик', 'Укажите поставщика', 'err'); return; }
      if (!amount || amount <= 0) { toast('Сумма', 'Укажите сумму больше нуля', 'err'); return; }
      try {
        const fd = new FormData();
        fd.append('file', file);
        const up = await fetch('/api/payment-invoices/upload', { method: 'POST', headers: { Authorization: hdr().Authorization }, body: fd });
        const uj = await up.json();
        if (!up.ok) throw new Error(uj.error || 'Не удалось загрузить файл');
        const body = {
          amount,
          supplier_name: supplier,
          basis_type: document.getElementById('sp-basis-type').value,
          basis_text: document.getElementById('sp-basis').value.trim() || null,
          due_date: document.getElementById('sp-due').value || null,
          file_path: uj.file_path,
          file_name: uj.file_name,
          pay_timing: timing
        };
        const r = await fetch('/api/payment-invoices', { method: 'POST', headers: hdr(), body: JSON.stringify(body) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Не создано');
        toast('Отправлено', `Счёт #${j.id} у директора`, 'ok');
        closeModal();
        if (j.mail && j.mail.dry_run && j.mail.link) console.info('[payment-mail dry-run]', j.mail.link, j.mail.to);
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
  }

  async function openPaymentInvoiceModal(payId) {
    try {
      await ensureUser();
      const pay = await apiFetch('/api/payment-invoices/' + payId);
      const lines = Array.isArray(pay.line_items_json) ? pay.line_items_json
        : (typeof pay.line_items_json === 'string' ? JSON.parse(pay.line_items_json || '[]') : []);
      const isDIR = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(_user.role);
      const fileApi = pay.file_url || (pay.id ? `/api/payment-invoices/${pay.id}/file` : null);
      const fileStatic = pay.file_path && String(pay.file_path).startsWith('/uploads/') ? pay.file_path : null;
      const lineRows = lines.map(l => `<tr><td>${esc(l.name||'—')}</td><td>${esc(String(l.qty??l.quantity??''))}</td><td>${money(l.unit_price)}</td></tr>`).join('');
      const stCls = payStatusClass(pay);
      let timing = pay.pay_timing === 'deferred' ? 'deferred' : 'immediate';
      const html = `<div class="proc-pay-modal">
        <div class="proc-pay-modal__layout">
          <div class="proc-pay-modal__main">
            <div class="proc-pay-modal__section">
              <div class="proc-pay-modal__section-title">Счёт</div>
              <div class="proc-pay-modal__sum">${money(pay.amount)}</div>
              <span class="proc-pay-status ${stCls}">${esc(pay.status_label || pay.status)}</span>
              <dl class="proc-pay-modal__meta" style="margin-top:12px">
                <dt>Поставщик</dt><dd>${esc(pay.supplier_name||'—')}</dd>
                <dt>Основание</dt><dd>${esc(pay.basis_text||pay.basis_type||'—')}</dd>
                ${pay.procurement_id?`<dt>Заявка</dt><dd>#${pay.procurement_id}</dd>`:''}
                ${pay.due_date?`<dt>Срок</dt><dd>${esc(String(pay.due_date).slice(0,10))}</dd>`:''}
                <dt>Оплата</dt><dd>${pay.pay_timing==='deferred'?'Отложенная':'Сразу'}</dd>
              </dl>
            </div>
            ${lineRows?`<div class="proc-pay-modal__section"><div class="proc-pay-modal__section-title">Позиции</div>
              <table class="proc-items-table"><thead><tr><th>Позиция</th><th>Кол-во</th><th>Цена</th></tr></thead><tbody>${lineRows}</tbody></table></div>`:''}
            ${isDIR && pay.status==='awaiting_dir' ? `<div class="proc-pay-modal__section">
              <div class="proc-pay-modal__section-title">Решение <span class="proc-tooltip" title="Согласовать — счёт уйдёт буху. Отказать — вернётся инициатору">?</span></div>
              <div class="proc-pay-timing" id="pi-timing">
                <button type="button" class="proc-pay-timing__opt ${timing==='immediate'?'proc-pay-timing__opt--on':''}" data-t="immediate"><strong>Сразу</strong><span>В очередь оплаты буху</span></button>
                <button type="button" class="proc-pay-timing__opt ${timing==='deferred'?'proc-pay-timing__opt--on':''}" data-t="deferred"><strong>Отложенная</strong><span>Одобрено, ждёт даты</span></button>
              </div>
              <div class="proc-pay-modal__actions" style="flex-direction:row;flex-wrap:wrap">
                <button class="btn primary" id="pi-ok">Согласовать</button>
                <button class="btn ghost" id="pi-no">Отказать</button>
              </div>
            </div>` : (pay.payment_status==='pending_payment' ? `<div class="proc-pay-modal__actions"><a class="btn primary" href="#/approval-payment">Перейти в очередь оплаты</a></div>` : '')}
          </div>
          ${payPreviewPane(fileApi || fileStatic, pay.file_name, { apiUrl: fileApi, staticUrl: fileStatic, pay })}
        </div>
      </div>`;
      showModal({ title: `Счёт на оплату #${pay.id}`, html });
      bindPayPreview(document);
      const timingBox = document.getElementById('pi-timing');
      if (timingBox) timingBox.onclick = (e) => {
        const btn = e.target.closest('[data-t]');
        if (!btn) return;
        timing = btn.dataset.t;
        timingBox.querySelectorAll('.proc-pay-timing__opt').forEach(el => {
          el.classList.toggle('proc-pay-timing__opt--on', el.dataset.t === timing);
        });
      };
      const ok = document.getElementById('pi-ok');
      const no = document.getElementById('pi-no');
      if (ok) ok.onclick = async () => {
        try { await apiPost(`/api/payment-invoices/${pay.id}/dir-approve`, { pay_timing: timing }); toast('Согласовано','Бухгалтерия в очереди','ok'); closeModal(); }
        catch(e){ toast('Ошибка', e.message,'err'); }
      };
      if (no) no.onclick = async () => {
        try { await apiPost(`/api/payment-invoices/${pay.id}/dir-reject`, {}); toast('Отклонено','','ok'); closeModal(); }
        catch(e){ toast('Ошибка', e.message,'err'); }
      };
    } catch (e) { toast('Ошибка', e.message || 'Не найден', 'err'); }
  }

  // -- Dashboard --
  async function renderDashboard(el) {
    if (!['PROC','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(_user.role)) return;
    try {
      const d = await apiFetch('/api/procurement/dashboard');
      const pendCnt = d.pending_proc?.length||0, overCnt = d.overdue?.length||0, upCnt = d.upcoming?.length||0;
      const paidCnt = (d.counts||[]).find(c=>c.status==='paid')?.cnt||0;
      el.innerHTML = `<div class="proc-dash-hero">
        <div class="proc-dash-hero__t">Очередь закупок</div>
        <div class="proc-dash-hero__s">Обрабатывайте заявки из работ и корзины склада. Здесь реестр и канбан — без создания «с нуля».</div>
        <div class="proc-dash-hero__tip">Куда жать: карточка «На обработке» → откройте заявку → цены/поставщик → дальше по статусам канбана. Excel справа — выгрузка/шаблон, не создание заявки.</div>
      </div>
      <div class="proc-dashboard">
        <div class="proc-dash-card proc-dash-card--pending" data-f="sent_to_proc"><div class="proc-dash-card__count">${pendCnt}</div><div class="proc-dash-card__label">На обработке</div></div>
        <div class="proc-dash-card proc-dash-card--overdue" data-f="paid"><div class="proc-dash-card__count">${overCnt}</div><div class="proc-dash-card__label">Просрочено</div></div>
        <div class="proc-dash-card proc-dash-card--upcoming" data-f="paid"><div class="proc-dash-card__count">${upCnt}</div><div class="proc-dash-card__label">Дедлайн &lt;7д</div></div>
        <div class="proc-dash-card" data-f="paid"><div class="proc-dash-card__count">${paidCnt}</div><div class="proc-dash-card__label">Ждут доставку</div></div>
      </div>`;
      el.querySelectorAll('[data-f]').forEach(c=>c.addEventListener('click',()=>{ currentFilters.status=c.dataset.f; refresh(); }));
    } catch(e) { console.warn('[Procurement] dashboard error:', e.message || e); }
  }

  // -- Filters --
  function renderFilters(el) {
    // «+ Новая заявка» убрана намеренно: заявки создаются ТОЛЬКО из карточки работы или из
    // корзины на складе. Закупщик заявки не создаёт — он их отрабатывает. Это реестр/просмотр.
    el.innerHTML = `<div class="proc-toolbar">
      <div class="proc-viewtoggle">
        <button class="proc-vt ${_viewMode==='kanban'?'proc-vt--on':''}" data-vm="kanban">Канбан</button>
        <button class="proc-vt ${_viewMode==='table'?'proc-vt--on':''}" data-vm="table">Таблица</button>
      </div>
      <div id="pf-status_w" style="display:${_viewMode==='table'?'inline-block':'none'};min-width:150px"></div>
      <input type="text" id="pf-search" class="proc-toolbar__search" placeholder="Поиск по заявке, работе, РП…">
      <div class="proc-toolbar__acts">
        <button type="button" class="proc-act" id="proc-new-pay">Новое согласование</button>
        <button type="button" class="proc-act" id="proc-export-xl">Excel</button>
        <button type="button" class="proc-act" id="proc-tpl-xl">Шаблон</button>
      </div>
    </div>`;
    el.querySelector('#proc-export-xl').onclick = () => window.open('/api/procurement/export/excel');
    el.querySelector('#proc-tpl-xl').onclick = () => window.open('/api/procurement/template/excel');
    const newPayBtn = el.querySelector('#proc-new-pay');
    if (newPayBtn) newPayBtn.onclick = () => openStandalonePaymentModal();
    el.querySelectorAll('[data-vm]').forEach(b => b.onclick = () => {
      _viewMode = b.dataset.vm; localStorage.setItem('proc_view', _viewMode);
      el.querySelectorAll('[data-vm]').forEach(x => x.classList.toggle('proc-vt--on', x.dataset.vm === _viewMode));
      el.querySelector('#pf-status_w').style.display = _viewMode === 'table' ? 'inline-block' : 'none';
      refresh();
    });
    el.querySelector('#pf-status_w')?.appendChild(CRSelect.create({ id: 'pf-status', options: [{ value: '', label: 'Все статусы' }, ...Object.entries(STATUSES).map(([k,v])=>({ value: k, label: v.l }))], value: currentFilters.status || '', onChange: v => { currentFilters.status = v; refresh(); } }));
    let tmr; el.querySelector('#pf-search').oninput = e => { clearTimeout(tmr); tmr = setTimeout(()=>{ currentFilters.search=e.target.value; refresh(); },300); };
  }

  // -- Table --
  function renderTable(items, el) {
    if (!items.length) { el.innerHTML='<div style="padding:40px;text-align:center;color:var(--t2)">Заявок нет</div>'; return; }
    el.innerHTML = `<div class="proc-table-wrap"><table class="proc-items-table">
      <thead><tr><th>№</th><th>Дата</th><th>Заявка</th><th>Работа</th><th>РП</th><th>Поз.</th><th>Сумма</th><th>Статус</th></tr></thead>
      <tbody>${items.map(r=>`<tr style="cursor:pointer" data-id="${r.id}">
        <td>${r.id}</td><td>${dt(r.created_at)}</td><td>${esc(humanProcTitle(r))}</td><td>${esc(r.work_title||'—')}</td>
        <td>${esc(r.pm_name||'—')}</td><td>${r.items_count||0}</td><td>${money(r.items_total)}</td><td>${badge(r.status)}</td>
      </tr>`).join('')}</tbody></table></div>`;
    el.querySelectorAll('tr[data-id]').forEach(tr=>tr.onclick=()=>openDetail(+tr.dataset.id));
  }

  // -- Detail modal --
  async function openDetail(id) {
    if (!_user) {
      try {
        const ud = await apiFetch('/api/users/me');
        _user = ud.user || ud;
      } catch (e) {
        toast('Ошибка', 'Не удалось загрузить профиль', 'err');
        return;
      }
    }
    const d = await apiFetch(`/api/procurement/${id}`);
    if (!d.item) { toast('Ошибка','Не найдена','err'); return; }
    const p = d.item, items = d.items||[], payments = d.payments||[], history = d.history||[], invoiceImports = d.invoice_imports||[];
    const actions = getActions(p);
    const isLocked = p.locked;
    const canEditItems = !isLocked && ['PM','HEAD_PM','PROC','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(_user.role);
    const isPROC = ['PROC','ADMIN'].includes(_user.role);

    const displaySum = (p.total_sum != null && Number(p.total_sum) > 0)
      ? Number(p.total_sum)
      : items.filter((it) => it.item_status !== 'cancelled')
          .reduce((s, it) => s + (Number(it.total_price) || ((Number(it.unit_price) || 0) * (Number(it.quantity) || 0))), 0);
    const activeParents = items.filter(it => !it.parent_item_id && it.item_status !== 'cancelled');
    const uncoveredCnt = activeParents.filter(it => !it.invoice_import_id).length;
    const coveredSum = activeParents.filter(it => it.invoice_import_id)
      .reduce((s, it) => s + (Number(it.total_price) || 0), 0);
    const awaitingPmInvs = invoiceImports.filter(iv => (iv.approval_status || 'draft') === 'awaiting_pm');
    const isPM = ['PM', 'HEAD_PM'].includes(_user.role);
    const isDIR = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(_user.role);
    const isBUH = ['BUH', 'ADMIN'].includes(_user.role);

    let howHint = '';
    if (isPROC && ['sent_to_proc', 'proc_responded', 'pm_approved'].includes(p.status)) {
      howHint = `<div class="proc-howto">
        <b>Как работать:</b>
        <ol>
          <li>Загрузите счёт поставщика (Excel/PDF) — позиции сматчятся автоматически</li>
          <li>Проверьте цены и привязку; при необходимости прикрепите счёт к строке вручную 📎</li>
          <li>Нажмите «На согласование РП» <em>по этому счёту</em> — остальные позиции можно закрывать другими счетами позже</li>
          <li>После ответа РП — «На оплату» по согласованному счёту</li>
        </ol>
      </div>`;
    } else if (isPM && (awaitingPmInvs.length || p.status === 'proc_responded')) {
      howHint = `<div class="proc-howto proc-howto--pm">
        <b>Согласование РП:</b> в блоке «Счета» — карточки «На согласовании РП». Согласуйте или верните <em>конкретный счёт</em>; остальные позиции закупщик закрывает параллельно.
      </div>`;
    }
    if (isPM && awaitingPmInvs.length) {
      howHint += `<div class="proc-pm-bar" id="proc-pm-bar">
        <div class="proc-pm-bar__t">На согласование: ${awaitingPmInvs.length} счёт(ов)</div>
        <div class="proc-pm-bar__acts">
          ${awaitingPmInvs.map(iv => `<button type="button" class="btn primary" data-inv-act="pm-approve" data-import-id="${iv.id}">✓ #${iv.id}${iv.total_sum!=null?' · '+money(iv.total_sum):''}</button>
            <button type="button" class="btn ghost" data-inv-act="pm-return" data-import-id="${iv.id}">↩ #${iv.id}</button>`).join('')}
        </div>
      </div>`;
    }

    let nextBanner = '';
    if (isPROC && !isLocked) {
      if (uncoveredCnt > 0) nextBanner = `<div class="proc-next-banner"><div class="proc-next-banner__t">Что делать дальше</div><div class="proc-next-banner__s">Загрузите счета на ${uncoveredCnt} поз. без покрытия → отправьте каждый счёт РП. Можно работать несколькими счетами параллельно.</div></div>`;
      else if (invoiceImports.some(iv => (iv.approval_status||'draft')==='draft' || iv.approval_status==='pm_returned'))
        nextBanner = `<div class="proc-next-banner"><div class="proc-next-banner__t">Что делать дальше</div><div class="proc-next-banner__s">Есть черновики счетов — отправьте их РП на согласование.</div></div>`;
      else if (invoiceImports.some(iv => iv.approval_status==='pm_approved'))
        nextBanner = `<div class="proc-next-banner"><div class="proc-next-banner__t">Что делать дальше</div><div class="proc-next-banner__s">РП согласовал счёт — нажмите «На оплату» (один или несколько). Нужен файл счёта.</div></div>`;
    } else if (isPM) {
      if (awaitingPmInvs.length)
        nextBanner = `<div class="proc-next-banner"><div class="proc-next-banner__t">Что делать дальше</div><div class="proc-next-banner__s">Проверьте счета ниже и согласуйте или верните. После согласования закупщик отправит на оплату директору.</div></div>`;
      else
        nextBanner = `<div class="proc-next-banner"><div class="proc-next-banner__t">Статус заявки</div><div class="proc-next-banner__s">Смотрите блок «Снабжение» и счета: что собрано, что в закупке, что в пути.</div></div>`;
    }

    let html = `<div class="proc-detail">
      <div class="proc-detail__header">
        <div class="proc-detail__status">${badge(p.status)}</div>
        ${isLocked?'<span class="badge" style="background:var(--warn-bg);color:var(--warn-t)">🔒 Заблокирована</span>':''}
        <div class="proc-detail__sum"><span class="proc-detail__sum-l">Сумма</span><strong>${money(displaySum)}</strong></div>
        <div class="proc-detail__tools">
          <button class="btn ghost" id="proc-export-xl" style="font-size:12px" title="Скачать Excel">📥 Excel</button>
          <button class="btn ghost" id="proc-clone" style="font-size:12px" title="Создать копию этой заявки">🔁 Повторить</button>
          <button class="btn ghost" id="proc-correspondence" style="font-size:12px" title="Журнал переписки по заявке">📜 Переписка</button>
          ${items.length?'<button class="btn ghost" id="proc-save-tpl" style="font-size:12px" title="Сохранить как шаблон">📋 В шаблон</button>':''}
        </div>
      </div>
      ${nextBanner}
      <div class="proc-detail__meta-cards">
        <div class="proc-meta-card"><span>Работа</span><b title="${esc(p.work_title||'')}">${esc(p.work_title||'—')}</b></div>
        <div class="proc-meta-card"><span>Заказчик</span><b>${esc(p.customer_name||'—')}</b></div>
        <div class="proc-meta-card"><span>РП</span><b>${esc(p.pm_name||'—')}</b></div>
        <div class="proc-meta-card"><span>Закупщик</span><b>${esc(p.proc_name||'не назначен')}</b></div>
        <div class="proc-meta-card"><span>Создана</span><b>${dtFull(p.created_at)}</b></div>
        <div class="proc-meta-card"><span>Без счёта</span><b>${uncoveredCnt} из ${activeParents.length}</b></div>
        <div class="proc-meta-card"><span>Закрыто счетами</span><b>${money(coveredSum)}</b></div>
        ${p.delivery_deadline?`<div class="proc-meta-card"><span>Дедлайн</span><b>${dt(p.delivery_deadline)}${p.delivered_at?'':p.delivery_deadline&&new Date(p.delivery_deadline)<new Date()?' <span class="proc-overdue">просрочено</span>':''}</b></div>`:''}
        ${p.paid_at?`<div class="proc-meta-card"><span>Оплачено</span><b>${dtFull(p.paid_at)}</b></div>`:''}
        ${p.delivered_at?`<div class="proc-meta-card"><span>Доставлено</span><b>${dtFull(p.delivered_at)}</b></div>`:''}
      </div>
      ${howHint}
      ${p.work_id?`<div class="proc-detail__section" id="pm-board-host"><div class="proc-detail__section-title">Снабжение по позициям</div><div style="color:var(--t2);font-size:12px">Загрузка…</div></div>`:''}`;

    // Счета сверху — главный рабочий контур закупщика / РП
    {
      const readyForDir = invoiceImports.filter(iv => (iv.approval_status || '') === 'pm_approved' && iv.file_path);
      let invBlock = `<div class="proc-detail__section proc-inv-section"><div class="proc-detail__section-title">Счета поставщиков (${invoiceImports.length})</div>`;
      if (isPROC && !isLocked) {
        invBlock += `<div class="proc-inv-cta"><button class="btn primary" id="proc-invoice-top">Загрузить новый счёт</button>
          <span class="proc-inv-cta__hint">Можно несколько счетов. Каждый уходит на РП и оплату отдельно или группой.</span></div>`;
        if (readyForDir.length > 1) {
          invBlock += `<div class="proc-inv-cta" style="margin-top:8px">
            <button class="btn primary" id="proc-send-dir-bulk">На оплату: все готовые (${readyForDir.length})</button>
            <button class="btn ghost" id="proc-send-dir-selected">На оплату: выбранные</button>
            <span class="proc-inv-cta__hint">Отметьте чекбоксы на карточках или отправьте все с файлом.</span>
          </div>`;
        }
      }
      if (invoiceImports.length) {
        invoiceImports.forEach(iv => {
          const st = iv.approval_status || 'draft';
          const linkedIds = Array.isArray(iv.linked_item_ids) ? iv.linked_item_ids : (iv.linked_item_ids ? String(iv.linked_item_ids).replace(/[{}]/g,'').split(',').filter(Boolean) : []);
          const linkedItems = items.filter(it => linkedIds.map(Number).includes(+it.id));
          const linkedRows = linkedItems.map(it => {
            const nameHtml = it.product_id
              ? `<button type="button" class="proc-product-name-link" data-product-id="${it.product_id}">${esc(it.name)}</button>`
              : esc(it.name);
            const linkBtn = it.product_id
              ? `<button type="button" class="proc-product-link" data-product-id="${it.product_id}">↗</button>`
              : '';
            return `<div class="proc-inv-line">
              <span class="proc-inv-line__name">${nameHtml}${linkBtn}</span>
              <span class="proc-inv-line__qty">${esc(String(it.quantity))} ${esc(it.unit||'')}</span>
              <span class="proc-inv-line__price">${money(it.unit_price)}</span>
              <span class="proc-inv-line__sum">${money(it.total_price)}</span>
            </div>`;
          }).join('');
          let waveBtns = '';
          if (isPROC && !isLocked && (st === 'draft' || st === 'pm_returned')) {
            waveBtns += `<button class="btn primary" data-inv-act="send-to-pm" data-import-id="${iv.id}">→ На согласование РП</button>`;
          }
          if (isPM && st === 'awaiting_pm') {
            waveBtns += `<button class="btn primary" data-inv-act="pm-approve" data-import-id="${iv.id}">✓ Согласовать счёт</button>`;
            waveBtns += `<button class="btn ghost" data-inv-act="pm-return" data-import-id="${iv.id}">↩ Вернуть</button>`;
          }
          if (isPROC && !isLocked && st === 'pm_approved') {
            waveBtns += `<button class="btn primary" data-inv-act="send-to-dir" data-import-id="${iv.id}">→ На оплату</button>`;
          }
          if (st === 'awaiting_dir' || st === 'dir_approved' || st === 'paid') {
            waveBtns += `<button class="btn primary" data-open-pay-import="${iv.id}">Открыть в очереди оплаты</button>`;
          }
          const bulkChk = (isPROC && !isLocked && st === 'pm_approved')
            ? `<label class="proc-inv-card__chk" title="Выбрать для групповой отправки"><input type="checkbox" data-dir-pick="${iv.id}" ${iv.file_path ? 'checked' : 'disabled'}> на оплату</label>`
            : '';
          invBlock += `<div class="proc-inv-card ${INV_WAVE[st]?.c||''}${st==='awaiting_pm'?' proc-inv-card--need-pm':''}" id="proc-inv-card-${iv.id}" data-import-id="${iv.id}">
            <div class="proc-inv-card__top">
              <div class="proc-inv-card__title">${bulkChk}<b>Счёт #${iv.id}</b> ${invBadge(st)}
                ${iv.supplier_name?`<span class="proc-inv-card__sup">${esc(iv.supplier_name)}</span>`:''}
              </div>
              <div class="proc-inv-card__sum">${iv.total_sum!=null?money(iv.total_sum):'—'}</div>
            </div>
            <div class="proc-inv-card__meta">
              <span>${linkedItems.length||iv.matched_count||0} поз.</span>
              ${iv.delivery_days?`<span>${iv.delivery_days} дн.</span>`:''}
              ${iv.file_path?`<a href="${esc(iv.file_path)}" target="_blank" class="proc-invoice-badge__link" title="Открыть файл счёта">Открыть счёт · ${esc(iv.file_name||'файл')}</a>`:'<span class="proc-inv-card__nofile">без файла — нельзя отправить на оплату</span>'}
              <span class="proc-inv-card__who">${esc(iv.uploaded_by_name||'')} ${dtFull(iv.created_at)}</span>
            </div>
            ${linkedRows?`<div class="proc-inv-card__lines"><div class="proc-inv-line proc-inv-line--head"><span>Позиция</span><span>Кол-во</span><span>Цена</span><span>Сумма</span></div>${linkedRows}</div>`:''}
            ${iv.pm_comment?`<div class="proc-inv-card__comment">Комментарий РП: ${esc(iv.pm_comment)}</div>`:''}
            ${waveBtns?`<div class="proc-inv-card__actions">${waveBtns}</div>`:''}
          </div>`;
        });
      } else {
        invBlock += `<div class="proc-inv-empty">Счетов пока нет. Загрузите счёт — парсинг отметит закрытые позиции, остальные ждут следующих счетов.</div>`;
      }
      invBlock += `</div>`;
      html += invBlock;
    }

    // Items — родители + дочерние (сплит), опц. группировка
    const parents = items.filter(it => !it.parent_item_id);
    const childrenOf = pid => items.filter(it => it.parent_item_id === pid);
    const statusCell = it => it.item_status==='delivered'
        ? (it.equipment_id
          ? '<span class="proc-eq-badge proc-eq-badge--delivered" onclick="location.hash=\'#/equipment?id='+it.equipment_id+'\'">📦 #'+it.equipment_id+'</span>'
          : '<span class="proc-eq-badge proc-eq-badge--delivered">✅ Принято</span>')
        : it.item_status==='cancelled'
          ? '<span class="proc-eq-badge proc-eq-badge--pending">✕ Отменена</span>'
          : '<span class="proc-eq-badge proc-eq-badge--transit">⏳ Ожидает</span>';
    const rowHtml = (it, idx, isChild) => {
      const kids = isChild ? [] : childrenOf(it.id);
      const isSplit = kids.length > 0;
      const icon = (!isChild && window.AsgardGoodsIcon && (it.icon_path || it.icon_slug))
        ? window.AsgardGoodsIcon.placeholder({ slug: it.icon_slug, path: it.icon_path, size: 28, alt: it.name })
        : '';
      const nameCell = it.product_id
        ? `<button type="button" class="proc-product-name-link" data-product-id="${it.product_id}" title="Открыть в каталоге">${esc(it.name)}</button>`
        : (canEditItems && !isSplit
          ? `<input class="proc-items-table__input" value="${esc(it.name)}" data-id="${it.id}" data-field="name">`
          : esc(it.name));
      const productBtn = it.product_id
        ? `<button type="button" class="proc-product-link" data-product-id="${it.product_id}" title="Товар #${it.product_id}">↗ #${it.product_id}</button>`
        : `<button type="button" class="proc-product-link proc-product-link--find" data-product-q="${esc(it.name)}" title="Найти в каталоге склада">↗ найти</button>`;
      const nameWrap = `<span class="proc-name-cell">${icon?`<span class="proc-name-cell__icon">${icon}</span>`:''}<span class="proc-name-cell__text">${nameCell}</span>${productBtn}</span>`;
      const isCancelled = it.item_status === 'cancelled';
      const canCancel = !isChild && !isSplit && !isCancelled
        && (it.item_status === 'pending' || it.item_status === 'ordered' || !it.item_status);
      const rowStyle = isCancelled ? ' style="text-decoration:line-through;opacity:0.5"' : '';
      const rowCls = `${isChild?'proc-row-child':''}${isCancelled?' proc-item-cancelled':''}${!it.invoice_import_id&&!isCancelled&&!isChild?' proc-row--uncovered':''}`.trim();
      const invImp = it.invoice_import_id ? invoiceImports.find(x => +x.id === +it.invoice_import_id) : null;
      const waveSt = invImp ? (invImp.approval_status || 'draft') : null;
      const coverCell = invImp
        ? `<button type="button" class="proc-cover proc-cover--ok" data-scroll-inv="${invImp.id}" title="К карточке счёта #${invImp.id}">#${invImp.id} · ${esc((INV_WAVE[waveSt]||{}).l||waveSt)}</button>`
        : (it.invoice_file_name ? '<span class="proc-cover proc-cover--file">файл</span>' : '<span class="proc-cover proc-cover--miss">нет счёта</span>');
      const invoiceCell = it.invoice_file_name
        ? `<span class="proc-invoice-badge"><a href="${esc(it.invoice_file_path)}" class="proc-invoice-badge__link" target="_blank">📎 ${esc(it.invoice_file_name)}</a></span>`
        : (isPROC && canEditItems && !isSplit && !isCancelled
          ? `<button class="btn ghost proc-attach-inv" style="font-size:11px;padding:2px 6px" data-attach-item="${it.id}" title="Прикрепить счёт вручную">📎 счёт</button>`
          : '—');
      return `<tr class="${rowCls}" data-row-id="${it.id}"${rowStyle}>
        <td>${isChild?'↳':(idx+1)}</td>
        <td>${nameWrap}${isSplit?' <span class="proc-kbadge">разбито</span>':''}</td>
        <td>${esc(it.article||'')}</td>
        <td>${esc(it.unit)}</td>
        <td>${canEditItems&&!isSplit&&!isCancelled?`<input class="proc-items-table__input proc-items-table__input--qty" type="number" step="any" value="${Number(it.quantity)}" data-id="${it.id}" data-field="quantity" title="${Number(it.quantity)}">`:esc(String(it.quantity))}</td>
        <td>${isPROC&&canEditItems&&!isSplit&&!isCancelled?`<input class="proc-items-table__input" value="${esc(it.supplier||'')}" data-id="${it.id}" data-field="supplier" title="${esc(it.supplier||'')}">`:esc(it.supplier||'—')}${it.supplier_delivery_days?` <span class="proc-kbadge">${it.supplier_delivery_days}д</span>`:''}</td>
        <td>${isSplit?'—':(isPROC&&canEditItems&&!isCancelled?`<input class="proc-items-table__input proc-items-table__input--price" type="number" step="any" value="${it.unit_price!=null&&it.unit_price!==''?Number(it.unit_price):''}" data-id="${it.id}" data-field="unit_price">`:money(it.unit_price))}<div class="proc-hint" data-hint-for="${it.id}"></div></td>
        <td class="proc-td-money">${money(it.total_price)}</td>
        <td>${statusCell(it)}</td>
        <td>${coverCell}</td>
        <td>${invoiceCell}</td>
        ${canEditItems?`<td style="white-space:nowrap">
          ${!isCancelled&&!isChild&&!isSplit&&parseFloat(it.quantity)>=2?`<button class="btn ghost" style="font-size:11px;padding:2px 5px" data-split-id="${it.id}" title="Разбить по поставщикам">✂️</button>`:''}
          ${!isCancelled&&isSplit?`<button class="btn ghost" style="font-size:11px;padding:2px 5px" data-unsplit-id="${it.id}" title="Схлопнуть">⇲</button>`:''}
          ${canCancel?`<button class="btn ghost" style="font-size:11px;padding:2px 5px;color:var(--warn,#c8a84e)" onclick="AsgardProcurementPage._cancelItem(${p.id},${it.id})" title="Отменить позицию">🚫</button>`:''}
          ${!isChild&&!isCancelled?`<button class="btn ghost" style="font-size:11px;padding:2px 5px;color:var(--err)" onclick="AsgardProcurementPage._deleteItem(${p.id},${it.id})">✕</button>`:''}
        </td>`:''}
      </tr>`;
    };
    html += `<div class="proc-detail__section"><div class="proc-detail__section-title">Позиции (${parents.length})</div>`;
    if (parents.length) {
      const thead = `<thead><tr><th>№</th><th>Наименование</th><th>Артикул</th><th>Ед.</th><th>Кол-во</th>
        <th>Поставщик</th><th>Цена</th><th>Сумма</th><th>Статус</th><th>Покрытие</th><th>Файл</th>${canEditItems?'<th></th>':''}</tr></thead>`;
      if (_groupMode && _groupMode !== 'none') {
        // группировка по категории/поставщику
        const keyOf = it => _groupMode==='supplier' ? (it.supplier||'Без поставщика') : (it.category_name||'Без категории');
        const groups = {}; parents.forEach(it => { const k=keyOf(it); (groups[k]=groups[k]||[]).push(it); });
        html += `<table class="proc-items-table">${thead}<tbody>`;
        Object.keys(groups).sort().forEach(g => {
          const sum = groups[g].reduce((s,x)=>s+(parseFloat(x.total_price)||0)+childrenOf(x.id).reduce((s2,c)=>s2+(parseFloat(c.total_price)||0),0),0);
          html += `<tr class="proc-grp-row"><td colspan="7"><b>▸ ${esc(g)}</b> <span style="color:var(--t2)">(${groups[g].length})</span></td><td><b>${money(sum)}</b></td><td colspan="${canEditItems?4:3}"></td></tr>`;
          groups[g].forEach((it,idx)=>{ html+=rowHtml(it,idx,false); childrenOf(it.id).forEach(c=>html+=rowHtml(c,0,true)); });
        });
        html += `</tbody></table>`;
      } else {
        html += `<table class="proc-items-table">${thead}<tbody>`;
        parents.forEach((it,idx)=>{ html+=rowHtml(it,idx,false); childrenOf(it.id).forEach(c=>html+=rowHtml(c,0,true)); });
        html += `</tbody></table>`;
      }
      if (canEditItems) html += `<div class="proc-detail__toolbar">
        <div class="proc-detail__toolbar-main">
          <button class="btn ghost" id="proc-save-items">💾 Сохранить</button>
          <button class="btn ghost" id="proc-add-item">+ Позиция</button>
        </div>
        <div class="proc-detail__toolbar-more">
          <button class="btn ghost" id="proc-grp" title="Группировка">🗂️ Группировать</button>
          <button class="btn ghost" id="proc-showcase">🛒 Из каталога</button>
          <button class="btn ghost" id="proc-add-text">📝 Текстом</button>
          <button class="btn ghost" id="proc-export-xl-2">📥 Excel</button>
        </div>
      </div>
      <details class="proc-detail__fold"><summary>Дополнительно · AI по ТЗ (не разбор счёта)</summary>
        <div style="padding:0 0 12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost" id="proc-ai-parse">🤖 AI по ТЗ</button>
          <span style="font-size:12px;color:var(--t2);align-self:center">Заполняет позиции из текста ТЗ без цен — не путать с загрузкой счёта.</span>
        </div>
      </details>`;
    } else {
      html += `<div style="color:var(--t2);padding:var(--sp-3)">Позиций нет</div>`;
      if (canEditItems) html += `<div style="margin-top:var(--sp-2);display:flex;gap:var(--sp-2);flex-wrap:wrap">
        <button class="btn primary" id="proc-showcase">🛒 Из каталога</button>
        <button class="btn ghost" id="proc-add-item">+ Позиция</button>
        <button class="btn ghost" id="proc-add-text">📝 Списком</button>
        <button class="btn ghost" id="proc-import-xl">📥 Импорт Excel</button>
      </div>
      <details class="proc-detail__fold"><summary>Дополнительно · AI по ТЗ</summary>
        <div style="padding:0 0 12px"><button class="btn ghost" id="proc-ai-parse">🤖 AI по ТЗ</button></div>
      </details>`;
    }
    html += `</div>`;

    // Payments
    if (payments.length) {
      html += `<div class="proc-detail__section"><div class="proc-detail__section-title">Платёжки (${payments.length})</div>`;
      payments.forEach(pay => {
        html += `<div style="padding:var(--sp-2);border-bottom:1px solid var(--brd);font-size:13px">
          ${money(pay.amount)} — ${dt(pay.payment_date)} ${pay.payment_number?'№'+esc(pay.payment_number):''}
          ${pay.original_name?` <a href="${esc(pay.download_url)}" target="_blank">📎 ${esc(pay.original_name)}</a>`:''}
          <span style="color:var(--t3);margin-left:8px">${esc(pay.uploader_name||'')} ${dtFull(pay.created_at)}</span>
        </div>`;
      });
      html += `</div>`;
    }

    // History — свёрнуто, чтобы не шуметь
    if (history.length) {
      html += `<details class="proc-detail__fold"><summary>История (${history.length})</summary><div class="proc-timeline">`;
      history.forEach(h => {
        html += `<div class="proc-timeline__entry">
          <div class="proc-timeline__date">${dtFull(h.created_at)}</div>
          <div class="proc-timeline__text"><span class="proc-timeline__actor">${esc(h.actor_name||'')}</span> — ${esc(h.action)} ${h.comment?`<br><em style="color:var(--t2)">${esc(h.comment)}</em>`:''}</div>
        </div>`;
      });
      html += `</div></details>`;
    }

    // Legacy whole-request actions — вторичные, волны по счетам главные
    if (actions.length) {
      html += `<details class="proc-detail__fold"><summary>Действия по заявке целиком (${actions.length})</summary>
        <div class="proc-detail__actions">${actions.map(a=>
          `<button class="btn ${a.css}" data-action="${a.action}">${esc(a.label)}</button>`
        ).join('')}</div></details>`;
    }

    // Comment + foot (без sticky — иначе textarea перекрывает таблицу)
    html += `<div class="proc-detail__foot">
      <textarea id="proc-comment" rows="2" placeholder="Комментарий к согласованию / возврату..." class="proc-detail__comment"></textarea>
      <div class="proc-detail__foot-row">
        <span class="proc-detail__foot-hint">${uncoveredCnt ? `Без счёта: <b>${uncoveredCnt}</b> поз.` : 'Все позиции привязаны к счетам'}</span>
      </div>
    </div>`;
    html += `</div>`;

    showModal({ title: humanProcTitle(p), html: html, wide: true });

    if (p.work_id) {
      (async () => {
        const host = document.getElementById('pm-board-host');
        if (!host) return;
        try {
          const board = await apiFetch('/api/assembly/board?work_id=' + p.work_id);
          const rows = board.board || [];
          const chip = (ok, label) => `<span class="pm-board__chip ${ok?'pm-board__chip--ok':'pm-board__chip--miss'}">${label}</span>`;
          host.innerHTML = `<div class="proc-detail__section-title">Снабжение по позициям</div>
            <div class="pm-board">
              <div class="pm-board__row pm-board__row--head"><span>Позиция</span><span>Резерв</span><span>Собрано</span><span>В пути</span><span>Закупка</span><span>Оплачено</span><span>Ещё</span></div>
              ${rows.length ? rows.map(r => {
                const cancelled = !!(r.flags && r.flags.cancelled) || r.line_status === 'cancelled';
                const buying = !!(r.flags && r.flags.in_procurement) && !(r.flags && r.flags.paid);
                const extra = cancelled ? '<span class="pm-board__chip pm-board__chip--miss">отменено</span>'
                  : (buying ? '<span class="pm-board__chip" style="border-color:rgba(201,168,76,.45)">в закупке</span>' : '—');
                return `<div class="pm-board__row">
                <span title="${esc(r.line_status||'')}">${esc(r.name)} · ${esc(String(r.qty||''))}</span>
                ${chip(r.flags.reserved,'да')}
                ${chip(r.flags.assembled,'да')}
                ${chip(r.flags.in_transit,'да')}
                ${chip(r.flags.in_procurement, r.invoice_wave || 'да')}
                ${chip(r.flags.paid,'да')}
                <span>${extra} ${r.assembly_id?`<button type="button" class="btn ghost" style="font-size:11px;padding:2px 6px" data-asm-open="${r.assembly_id}">сборка</button>`:''}</span>
              </div>`;
              }).join('') : '<div style="color:var(--t2);font-size:13px;padding:8px 0">Нет строк сборки по этой работе</div>'}
            </div>`;
          host.querySelectorAll('[data-asm-open]').forEach(b => {
            b.onclick = () => { location.hash = '#/assembly?id=' + b.dataset.asmOpen; };
          });
        } catch (e) {
          host.innerHTML = `<div class="proc-detail__section-title">Снабжение по позициям</div><div style="color:var(--t2);font-size:12px">${esc(e.message||'нет данных')}</div>`;
        }
      })();
    }

    // SVG-иконки каталога — inline fetch (наследование --icon-ink/--icon-accent)
    if (window.AsgardGoodsIcon) {
      const modalHost = document.querySelector('.modal-body, .modal__body, .modal') || document;
      window.AsgardGoodsIcon.hydrate(modalHost);
    }

    // Handlers
    document.querySelectorAll('.proc-detail__actions [data-action]').forEach(btn => {
      btn.onclick = async () => {
        const act = btn.dataset.action;
        const comment = document.getElementById('proc-comment')?.value || '';
        let url = `/api/procurement/${p.id}/${act}`;
        if (act === 'deliver-items') { await openDeliverModal(p.id); return; }
        const r = await apiPut(url, { comment });
        if (r.error) { toast('Ошибка', r.error, 'err'); return; }
        toast('Готово', '', 'ok'); closeModal(); refresh();
      };
    });

    // Save inline edits
    const saveBtn = document.getElementById('proc-save-items');
    if (saveBtn) saveBtn.onclick = async () => {
      const inputs = document.querySelectorAll('.proc-items-table__input[data-id]');
      const changes = {};
      inputs.forEach(inp => {
        const id = inp.dataset.id, field = inp.dataset.field;
        if (!changes[id]) changes[id] = {};
        changes[id][field] = inp.type === 'number' ? (inp.value || null) : inp.value;
      });
      for (const [itemId, body] of Object.entries(changes)) {
        await fetch(`/api/procurement/${p.id}/items/${itemId}`, { method: 'PUT', headers: hdr(), body: JSON.stringify(body) });
      }
      toast('Сохранено', '', 'ok'); openDetail(p.id);
    };

    // Витрина каталога — главный способ добавления позиций
    const showcaseBtn = document.getElementById('proc-showcase');
    if (showcaseBtn) showcaseBtn.onclick = () => openShowcase(p.id);

    // 🧾 Загрузить счёт → авто-матчинг → массово проставить цены
    const invBtn = document.getElementById('proc-invoice');
    if (invBtn) invBtn.onclick = () => openInvoiceModal(p.id);
    const invBtnTop = document.getElementById('proc-invoice-top');
    if (invBtnTop) invBtnTop.onclick = () => openInvoiceModal(p.id);
    const invBtnFoot = document.getElementById('proc-invoice-foot');
    if (invBtnFoot) invBtnFoot.onclick = () => openInvoiceModal(p.id);
    const exportXl = () => window.open(`/api/procurement/${p.id}/export/excel?group=supplier`);
    const xl1 = document.getElementById('proc-export-xl');
    const xl2 = document.getElementById('proc-export-xl-2');
    if (xl1) xl1.onclick = exportXl;
    if (xl2) xl2.onclick = exportXl;
    document.querySelectorAll('[data-inv-act]').forEach(btn => {
      btn.onclick = () => invoiceWaveAction(p.id, +btn.dataset.importId, btn.dataset.invAct);
    });
    async function sendDirBulk(ids) {
      if (!ids.length) { toast('Выбор', 'Нет счетов для отправки', 'warn'); return; }
      try {
        const r = await apiPut(`/api/procurement/${p.id}/invoices/send-to-dir-bulk`, { import_ids: ids });
        if (r.error) { toast('Ошибка', r.error, 'err'); return; }
        const mail = r.mail || {};
        toast('На оплату', `Группа: ${ids.length} сч.` + (mail.dry_run ? ' · письмо dry-run' : ' · письмо директору'), 'ok');
        openDetail(p.id);
      } catch (e) {
        toast('Ошибка', e.message || 'Не отправлено', 'err');
      }
    }
    const bulkAll = document.getElementById('proc-send-dir-bulk');
    if (bulkAll) bulkAll.onclick = () => {
      const ids = [...document.querySelectorAll('[data-dir-pick]:not(:disabled)')].map(el => +el.dataset.dirPick);
      sendDirBulk(ids);
    };
    const bulkSel = document.getElementById('proc-send-dir-selected');
    if (bulkSel) bulkSel.onclick = () => {
      const ids = [...document.querySelectorAll('[data-dir-pick]:checked')].map(el => +el.dataset.dirPick);
      sendDirBulk(ids);
    };
    document.querySelectorAll('[data-open-pay-import]').forEach(btn => {
      btn.onclick = async () => {
        try {
          const list = await apiFetch('/api/payment-invoices?status=awaiting_dir');
          const all = await apiFetch('/api/payment-invoices');
          const items = (all.items || list.items || []);
          const hit = items.find(x => +x.invoice_import_id === +btn.dataset.openPayImport);
          if (hit) openPaymentInvoiceModal(hit.id);
          else location.hash = '#/approval-payment';
        } catch (_) { location.hash = '#/approval-payment'; }
      };
    });
    document.querySelectorAll('.proc-product-link[data-product-id], .proc-product-name-link[data-product-id]').forEach(btn => {
      btn.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); openCatalogProduct(btn.dataset.productId); };
    });
    document.querySelectorAll('.proc-product-link[data-product-q]').forEach(btn => {
      btn.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); openCatalogSearch(btn.dataset.productQ); };
    });
    document.querySelectorAll('[data-scroll-inv]').forEach(btn => {
      btn.onclick = (ev) => {
        ev.preventDefault();
        const card = document.getElementById('proc-inv-card-' + btn.dataset.scrollInv);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          card.classList.add('proc-inv-card--flash');
          setTimeout(() => card.classList.remove('proc-inv-card--flash'), 1200);
        }
      };
    });
    document.querySelectorAll('[data-attach-item]').forEach(btn => {
      btn.onclick = () => _attachInvoice(p.id, +btn.dataset.attachItem);
    });
    // 🗂️ Группировка
    const grpBtn = document.getElementById('proc-grp');
    if (grpBtn) grpBtn.onclick = () => _cycleGroup(p.id);
    // подсказки цен в строке + кнопки сплита
    _attachItemHints(p.id, items, isPROC);
    document.querySelectorAll('[data-split-id]').forEach(b => b.onclick = () => openSplitForm(p.id, +b.dataset.splitId, items.find(x=>x.id===+b.dataset.splitId)));
    document.querySelectorAll('[data-unsplit-id]').forEach(b => b.onclick = async () => {
      if (!confirm('Схлопнуть разбивку позиции?')) return;
      const r = await fetch(`/api/procurement/${p.id}/items/${b.dataset.unsplitId}/split`, { method:'DELETE', headers: hdr() });
      if (r.ok) { toast('Готово','Сплит отменён','ok'); openDetail(p.id); } else toast('Ошибка','Не удалось','err');
    });

    // Add item — с подсказкой цены из базы
    const addBtn = document.getElementById('proc-add-item');
    if (addBtn) addBtn.onclick = async () => {
      const html = `<div style="display:flex;flex-direction:column;gap:var(--sp-2)">
        <label>Наименование<input id="pa-name" placeholder="напр. Цемент М400" style="width:100%;padding:var(--sp-2);border:1px solid var(--brd);border-radius:var(--r-sm)"></label>
        <div style="display:flex;gap:var(--sp-2)">
          <label style="flex:1">Кол-во<input id="pa-qty" type="number" value="1" min="0" step="0.001" style="width:100%;padding:var(--sp-2);border:1px solid var(--brd);border-radius:var(--r-sm)"></label>
          <label style="flex:1">Ед.<input id="pa-unit" value="шт" style="width:100%;padding:var(--sp-2);border:1px solid var(--brd);border-radius:var(--r-sm)"></label>
        </div>
        <div id="pa-hint" style="font-size:13px;color:var(--t2);min-height:18px"></div>
        <button class="btn primary" id="pa-submit">Добавить</button>
      </div>`;
      showModal({ title: '+ Позиция', html: html });
      const nameInp = document.getElementById('pa-name');
      setTimeout(() => nameInp?.focus(), 100);
      // Подсказка цены при вводе названия (debounce)
      let hintTmr;
      nameInp.oninput = () => {
        clearTimeout(hintTmr);
        const val = nameInp.value.trim();
        const hintEl = document.getElementById('pa-hint');
        if (val.length < 3) { hintEl.innerHTML = ''; return; }
        hintTmr = setTimeout(async () => {
          try {
            const h = await apiFetch(`/api/price-records/hint?name=${encodeURIComponent(val)}`);
            if (h && h.last) {
              const d = h.last.recorded_at ? new Date(h.last.recorded_at).toLocaleDateString('ru-RU') : '';
              let s = `💡 В прошлый раз: <strong>${money(h.last.unit_price)}</strong>${h.last.supplier_name?' у '+esc(h.last.supplier_name):''} <span style="color:var(--t3)">(${d})</span>`;
              if (h.stats && h.stats.sample_count >= 3) s += `<br><span style="color:var(--t3)">Рынок: ср. ${money(h.stats.avg_price)}, мин ${money(h.stats.min_price)}</span>`;
              hintEl.innerHTML = s;
            } else { hintEl.innerHTML = '<span style="color:var(--t3)">Нет истории цен по этой позиции</span>'; }
          } catch(e) { hintEl.innerHTML = ''; }
        }, 400);
      };
      document.getElementById('pa-submit').onclick = async () => {
        const name = nameInp.value.trim(); if (!name) { toast('Введите наименование', '', 'err'); return; }
        const quantity = parseFloat(document.getElementById('pa-qty').value) || 1;
        const unit = document.getElementById('pa-unit').value || 'шт';
        await apiPost(`/api/procurement/${p.id}/items`, { name, unit, quantity });
        closeModal(); openDetail(p.id);
      };
    };

    // Add by text (списком)
    const textBtn = document.getElementById('proc-add-text');
    if (textBtn) textBtn.onclick = () => {
      const html = `<div style="display:flex;flex-direction:column;gap:var(--sp-2)">
        <div style="color:var(--t2);font-size:13px">Введите позиции — по одной в строке. Можно указать количество и единицу:</div>
        <div style="color:var(--t3);font-size:12px;line-height:1.6">
          Например:<br>10 мешков цемента<br>арматура 12мм - 5 шт<br>кран манипулятор - 2 смены<br>Кабель ВВГнг 3x2.5
        </div>
        <textarea id="proc-text-input" rows="8" placeholder="Каждая позиция с новой строки..." style="width:100%;padding:var(--sp-2);border:1px solid var(--brd);border-radius:var(--r-sm);font-size:14px;resize:vertical;font-family:inherit"></textarea>
        <button class="btn primary" id="proc-text-submit">Добавить позиции</button>
      </div>`;
      showModal({ title: '📝 Добавить позиции списком', html: html });
      setTimeout(() => document.getElementById('proc-text-input')?.focus(), 100);
      document.getElementById('proc-text-submit').onclick = async () => {
        const text = document.getElementById('proc-text-input')?.value || '';
        if (!text.trim()) { toast('Пусто', 'Введите хотя бы одну позицию', 'err'); return; }
        const r = await apiPost(`/api/procurement/${p.id}/items/import-text`, { text });
        if (r.error) { toast('Ошибка', r.error, 'err'); return; }
        toast('Добавлено', `${r.count} позиций`, 'ok'); closeModal(); openDetail(p.id);
      };
    };

    // AI-разбор ТЗ
    const aiBtn = document.getElementById('proc-ai-parse');
    if (aiBtn) aiBtn.onclick = () => {
      const html = `<div style="display:flex;flex-direction:column;gap:var(--sp-2)">
        <div style="color:var(--t2);font-size:13px">Вставьте техзадание или описание работ — AI выделит позиции для закупки (без цен).</div>
        <textarea id="proc-ai-input" rows="10" placeholder="Вставьте ТЗ сюда..." style="width:100%;padding:var(--sp-2);border:1px solid var(--brd);border-radius:var(--r-sm);font-size:13px;resize:vertical;font-family:inherit"></textarea>
        <div id="proc-ai-status" style="font-size:13px;color:var(--t2);min-height:18px"></div>
        <button class="btn primary" id="proc-ai-submit">🤖 Разобрать ТЗ</button>
      </div>`;
      showModal({ title: '🤖 AI-разбор техзадания', html: html });
      setTimeout(() => document.getElementById('proc-ai-input')?.focus(), 100);
      document.getElementById('proc-ai-submit').onclick = async () => {
        const text = document.getElementById('proc-ai-input')?.value || '';
        if (!text.trim()) { toast('Пусто', 'Вставьте ТЗ', 'err'); return; }
        const btn = document.getElementById('proc-ai-submit'), stEl = document.getElementById('proc-ai-status');
        btn.disabled = true; btn.innerHTML = '<span class="mimir-spinner"></span> AI анализирует...';
        stEl.textContent = 'Это может занять до минуты...';
        try {
          const r = await apiPost(`/api/procurement/${p.id}/items/ai-parse`, { text });
          if (r.error) { toast('Ошибка', r.error, 'err'); btn.disabled = false; btn.textContent = '🤖 Разобрать ТЗ'; return; }
          if (r.count > 0) { toast('Готово', `AI добавил ${r.count} позиций`, 'ok'); closeModal(); openDetail(p.id); }
          else { stEl.textContent = r.message || 'AI не нашёл позиций'; btn.disabled = false; btn.textContent = '🤖 Разобрать ТЗ'; }
        } catch(e) { toast('Ошибка', 'AI недоступен', 'err'); btn.disabled = false; btn.textContent = '🤖 Разобрать ТЗ'; }
      };
    };

    // Clone (повторить заявку)
    const cloneBtn = document.getElementById('proc-clone');
    if (cloneBtn) cloneBtn.onclick = async () => {
      if (!confirm('Создать копию этой заявки со всеми позициями?')) return;
      const r = await apiPost(`/api/procurement/${p.id}/clone`, {});
      if (r.error) { toast('Ошибка', r.error, 'err'); return; }
      toast('Создана копия', '', 'ok'); closeModal(); openDetail(r.item.id);
    };

    // Correspondence journal
    const corrBtn = document.getElementById('proc-correspondence');
    if (corrBtn) {
      corrBtn.onclick = () => {
        location.hash = `#/correspondence?parent_entity_type=request&parent_entity_id=${p.id}`;
      };
    }

    // Save as template
    const saveTplBtn = document.getElementById('proc-save-tpl');
    if (saveTplBtn) saveTplBtn.onclick = async () => {
      const name = prompt('Название шаблона:', p.title || 'Шаблон закупки');
      if (!name) return;
      const r = await apiPost(`/api/procurement/templates/from-request/${p.id}`, { name });
      if (r.error) { toast('Ошибка', r.error, 'err'); return; }
      toast('Сохранено как шаблон', name, 'ok');
    };

    // Import Excel
    const impBtn = document.getElementById('proc-import-xl');
    if (impBtn) impBtn.onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls';
      inp.onchange = async () => {
        const file = inp.files[0]; if (!file) return;
        const fd = new FormData(); fd.append('file', file);
        const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
        const r = await fetch(`/api/procurement/${p.id}/items/import-excel`, { method: 'POST', body: fd, headers: { 'Authorization': 'Bearer ' + t } });
        const data = await r.json();
        if (data.error) { toast('Ошибка', data.error, 'err'); return; }
        toast('Импортировано', `${data.count} позиций`, 'ok'); openDetail(p.id);
      };
      inp.click();
    };
  }

  // -- WOW Deliver modal --
  const ITEM_ICONS = ['📦','🔩','⚙️','🔧','🛠️','🧱','🪣','🔌','🧰','💡'];
  function _itemIcon(name) { let h=0; for(let i=0;i<name.length;i++) h=((h<<5)-h)+name.charCodeAt(i); return ITEM_ICONS[Math.abs(h)%ITEM_ICONS.length]; }
  function _ding() { try { const ac=new(window.AudioContext||window.webkitAudioContext)();const o=ac.createOscillator();const g=ac.createGain();o.connect(g);g.connect(ac.destination);o.frequency.value=880;o.type='sine';g.gain.value=0.08;o.start();g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.3);o.stop(ac.currentTime+0.3); } catch(e){} }
  function _spawnParticles(card) {
    for(let i=0;i<8;i++){const p=document.createElement('span');p.className='proc-gold-particle';const a=Math.random()*Math.PI*2;const d=40+Math.random()*60;
    p.style.cssText=`left:50%;top:50%;--dx:${Math.cos(a)*d}px;--dy:${Math.sin(a)*d}px`;card.appendChild(p);setTimeout(()=>p.remove(),1100);}
  }

  async function openDeliverModal(procId) {
    const d = await apiFetch(`/api/procurement/${procId}`);
    const allItems = d.items || [];
    const undelivered = allItems.filter(i => i.item_status !== 'delivered' && i.item_status !== 'cancelled');
    if (!undelivered.length) { toast('Всё доставлено', '', 'info'); return; }

    // Раскладка по ячейкам: подгружаем активные ячейки склада (для позиций на склад).
    let cells = [];
    try { const lc = await apiFetch('/api/warehouse/locations?is_active=true&limit=500'); cells = (lc.items || lc.rows || lc.locations || (Array.isArray(lc) ? lc : []) || []); if (!Array.isArray(cells)) cells = []; } catch (_) { cells = []; }
    const cellOpts = '<option value="">— без ячейки —</option>' + cells.map(c => `<option value="${c.id}">${esc(c.label || ('#' + c.id))}</option>`).join('');

    const selected = new Set(undelivered.map(i => i.id));
    let html = `<div class="proc-deliver">
      <div class="proc-deliver__title">📦 Приёмка позиций <span style="font-size:13px;font-weight:400;color:var(--t2)">${undelivered.length} из ${allItems.length}</span></div>
      <div class="proc-deliver__progress"><div class="proc-deliver__progress-bar" id="dlv-bar"></div></div>
      <div id="dlv-cards">`;
    undelivered.forEach(it => {
      const toWarehouse = (it.delivery_target || 'warehouse') === 'warehouse';
      html += `<div class="proc-deliver-card" data-id="${it.id}">
        <div class="proc-deliver-card__icon">${_itemIcon(it.name)}</div>
        <div class="proc-deliver-card__info">
          <div class="proc-deliver-card__name">${esc(it.name)}</div>
          <div class="proc-deliver-card__meta">
            <span>${it.quantity} ${esc(it.unit)}</span>
            ${it.unit_price ? '<span>'+Number(it.unit_price).toLocaleString('ru-RU')+' ₽</span>' : ''}
            ${it.supplier ? '<span>'+esc(it.supplier)+'</span>' : ''}
          </div>
          ${toWarehouse && cells.length ? `<div class="proc-deliver-card__cell"><span style="font-size:11px;color:var(--t2)">📍 Ячейка:</span> <select class="proc-deliver-card__loc" data-loc="${it.id}">${cellOpts}</select></div>` : ''}
        </div>
        <div class="proc-deliver-card__check checked" data-check="${it.id}">✓</div>
      </div>`;
    });
    html += `</div>
      <div class="proc-deliver__footer">
        <button class="proc-deliver__btn proc-deliver__btn--primary" id="dlv-confirm">✅ Принять выбранные (${undelivered.length})</button>
      </div>
    </div>`;

    showModal({ title: 'Приёмка заявки #' + procId, html: html });

    // Toggle selection
    // Клик по select ячейки не должен переключать выбор карточки.
    document.querySelectorAll('.proc-deliver-card__loc').forEach(sel => { sel.onclick = (e) => e.stopPropagation(); sel.onchange = (e) => e.stopPropagation(); });
    document.querySelectorAll('.proc-deliver-card').forEach(card => {
      card.onclick = (e) => {
        if (card.classList.contains('accepted')) return;
        if (e.target && e.target.classList && e.target.classList.contains('proc-deliver-card__loc')) return;
        const id = +card.dataset.id;
        const ch = card.querySelector('.proc-deliver-card__check');
        if (selected.has(id)) { selected.delete(id); ch.classList.remove('checked'); ch.textContent = ''; }
        else { selected.add(id); ch.classList.add('checked'); ch.textContent = '✓'; }
        const btn = document.getElementById('dlv-confirm');
        if (btn) { btn.textContent = '✅ Принять выбранные (' + selected.size + ')'; btn.disabled = !selected.size; }
      };
    });

    // Confirm delivery
    document.getElementById('dlv-confirm').onclick = async () => {
      const btn = document.getElementById('dlv-confirm');
      btn.disabled = true; btn.innerHTML = '<span class="mimir-spinner"></span> Принимаю...';
      const ids = [...selected];
      let done = 0, eqCreated = 0;
      const bar = document.getElementById('dlv-bar');
      const total = ids.length;

      for (const itemId of ids) {
        const locSel = document.querySelector(`.proc-deliver-card__loc[data-loc="${itemId}"]`);
        const locId = locSel && locSel.value ? parseInt(locSel.value) : null;
        const r = await apiPut(`/api/procurement/${procId}/items/${itemId}/deliver`, locId ? { location_id: locId } : {});
        done++;
        if (bar) bar.style.width = Math.round(done / total * 100) + '%';

        const card = document.querySelector(`.proc-deliver-card[data-id="${itemId}"]`);
        if (card) {
          card.classList.add('accepted');
          card.querySelector('.proc-deliver-card__check').classList.add('checked');
          card.querySelector('.proc-deliver-card__check').textContent = '✓';
          // Если создалось оборудование — golden glow
          if (r.item && r.item.equipment_id) {
            eqCreated++;
            card.classList.add('eq-created');
            _spawnParticles(card);
          }
          _ding();
          await new Promise(ok => setTimeout(ok, 300));
        }
      }

      // Финальный экран
      await new Promise(ok => setTimeout(ok, 400));
      const container = document.querySelector('.proc-deliver');
      if (container) {
        container.innerHTML = `<div class="proc-deliver-done">
          <div class="proc-deliver-done__icon">🎉</div>
          <div class="proc-deliver-done__title">Приёмка завершена!</div>
          <div class="proc-deliver-done__sub">Заявка #${procId} — все позиции приняты на склад</div>
          <div class="proc-deliver-done__stats">
            <div class="proc-deliver-done__stat">
              <div class="proc-deliver-done__stat-val">${done}</div>
              <div class="proc-deliver-done__stat-label">Принято</div>
            </div>
            ${eqCreated ? `<div class="proc-deliver-done__stat">
              <div class="proc-deliver-done__stat-val proc-deliver-done__stat-val--gold">${eqCreated}</div>
              <div class="proc-deliver-done__stat-label">Оборудование</div>
            </div>` : ''}
          </div>
          ${eqCreated ? '<a class="proc-deliver-done__link" href="#/equipment">Перейти на склад →</a>' : ''}
        </div>`;
      }
      refresh();
    };
  }

  // -- Actions matrix --
  function getActions(p) {
    const a = [], s = p.status, r = _user.role;
    if (s==='draft'&&['PM','HEAD_PM'].includes(r)) a.push({label:'Отправить закупщику',action:'send-to-proc',css:'primary'});
    // Целиком — запасной путь; основной сценарий — кнопки на карточках счетов
    if (s==='draft'&&['PM','HEAD_PM','ADMIN'].includes(r)) a.push({label:'→ Закупщику',action:'send-to-proc',css:'primary'});
    if (s==='sent_to_proc'&&['PROC','ADMIN'].includes(r)) a.push({label:'Ответить РП (вся заявка)',action:'proc-respond',css:'ghost'});
    if (s==='proc_responded'&&['PM','HEAD_PM'].includes(r)){a.push({label:'Согласовать всё',action:'pm-approve',css:'ghost'});a.push({label:'Вернуть всё',action:'return-to-proc',css:'ghost'});}
    // DIR/BUH не действуют в модалке заявки — только payment_invoices / #/approval-payment
    if (['paid','partially_delivered'].includes(s)&&['WAREHOUSE','PM','HEAD_PM','ADMIN'].includes(r)) a.push({label:'Принять',action:'deliver-items',css:'primary'});
    if (s==='delivered'&&['PM','HEAD_PM','ADMIN'].includes(r)) a.push({label:'Закрыть',action:'close',css:'ghost'});
    return a;
  }

  // -- Attach invoice (ручная привязка файла + черновик волны счёта) --
  function _attachInvoice(procId, itemId) {
    const inp = document.createElement('input'); inp.type='file'; inp.accept='.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx';
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      const fd = new FormData(); fd.append('file', file); fd.append('entity_type', 'procurement_items'); fd.append('entity_id', itemId);
      const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
      const r = await fetch('/api/files', { method: 'POST', body: fd, headers: { 'Authorization': 'Bearer ' + t } });
      const data = await r.json();
      if (data.id) {
        try {
          await apiPost(`/api/procurement/${procId}/invoice/manual-attach`, {
            item_id: itemId, document_id: data.id, file_name: data.original_name || file.name, file_path: data.download_url || null
          });
          toast('Счёт прикреплён', 'Можно отправить на согласование РП', 'ok');
        } catch (e) {
          await fetch(`/api/procurement/${procId}/items/${itemId}`, { method: 'PUT', headers: hdr(), body: JSON.stringify({ invoice_doc_id: data.id }) });
          toast('Счёт прикреплён', '', 'ok');
        }
        openDetail(procId);
      }
    };
    inp.click();
  }

  // -- Delete item --
  async function _deleteItem(procId, itemId) {
    if (!confirm('Удалить позицию?')) return;
    await fetch(`/api/procurement/${procId}/items/${itemId}`, { method: 'DELETE', headers: hdr() });
    openDetail(procId);
  }

  // -- Cancel item (мягкая отмена с сохранением истории) --
  async function _cancelItem(procId, itemId) {
    if (!confirm('Отменить позицию? Данные сохранятся в истории.')) return;
    try {
      const r = await fetch(`/api/procurement/${procId}/items/${itemId}/cancel`, {
        method: 'PUT', headers: hdr(), body: JSON.stringify({})
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast('Ошибка', d.error || `HTTP ${r.status}`, 'err');
        return;
      }
      toast('Готово', 'Позиция отменена', 'ok');
      openDetail(procId);
    } catch (e) {
      toast('Ошибка', e.message || 'Не удалось отменить', 'err');
    }
  }

  // -- Create modal --
  // ═══ ВИТРИНА КАТАЛОГА: выбор позиций с остатком/ценой → корзина → bulk в заявку ═══
  const _cart = {}; // product_id|name → {name,unit,article,product_id,available,last_price,need}
  async function openShowcase(procId) {
    let rows = [];
    showModal({ title: '🛒 Каталог закупки', html: `<div style="padding:30px;text-align:center;color:var(--t2)">Загрузка каталога…</div>` });
    try { const d = await apiFetch('/api/products/catalog-procurement?include_equipment=true&limit=400'); rows = d.items || []; }
    catch (e) { toast('Ошибка', e.message, 'err'); return; }
    drawShowcase(procId, rows, '');
  }
  function _cartKey(it) { return it.product_id ? 'p' + it.product_id : 'n:' + (it.name || '').toLowerCase(); }
  function drawShowcase(procId, rows, search) {
    const flt = search ? rows.filter(r => (r.name + ' ' + (r.article || '')).toLowerCase().includes(search.toLowerCase())) : rows;
    const cartArr = Object.values(_cart);
    const inCart = it => !!_cart[_cartKey(it)];
    const money = (v) => (AsgardUI.moneyRub || AsgardMoney.formatMoney)(v);
    const num = v => Number(v || 0).toLocaleString('ru-RU');
    const html = `<div style="min-width:560px;max-width:760px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
        <input id="sc-q" placeholder="Поиск по каталогу…" value="${esc(search || '')}" style="flex:1;padding:9px 12px;border:1px solid var(--brd);border-radius:8px">
        <span class="badge" style="background:var(--warn-bg,rgba(200,168,78,.15));padding:4px 10px;border-radius:14px">🛒 ${cartArr.length}</span>
      </div>
      <div style="border:1px solid var(--brd);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="position:sticky;top:0;background:var(--bg-card,#1a1f29)">
            <th style="text-align:left;padding:8px 10px">Наименование</th><th style="padding:8px">В наличии</th>
            <th style="padding:8px">Посл. цена</th><th style="padding:8px"></th></tr></thead>
          <tbody>${!flt.length ? '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--t2)">Ничего не найдено</td></tr>' :
        flt.map(it => `<tr style="border-top:1px solid var(--brd)">
            <td style="padding:7px 10px"><b>${esc(it.name)}</b>${it.article ? ' <span style="opacity:.5">' + esc(it.article) + '</span>' : ''}
              <div style="font-size:11px;color:var(--t2)">${esc(it.category_name || '')}${it.source === 'equipment' ? ' · оборудование' : ''}</div></td>
            <td style="padding:7px;text-align:center">${Number(it.available_qty) > 0 ? '<span style="color:var(--ok-t,#30d158)">' + num(it.available_qty) + ' ' + esc(it.unit || 'шт') + '</span>' : '<span style="opacity:.5">нет</span>'}</td>
            <td style="padding:7px;text-align:center">${money(it.last_price)}${it.last_supplier ? '<div style="font-size:10px;color:var(--t2)">' + esc(it.last_supplier) + '</div>' : ''}</td>
            <td style="padding:7px;text-align:right"><button class="btn ${inCart(it) ? 'ghost' : 'primary'}" data-add='${esc(JSON.stringify({ k: _cartKey(it), name: it.name, unit: it.unit, article: it.article, product_id: it.product_id, available: Number(it.available_qty) || 0, last_price: it.last_price }))}' style="font-size:12px;padding:4px 10px">${inCart(it) ? '✓' : '+'}</button></td>
          </tr>`).join('')}</tbody></table>
      </div>
      ${cartArr.length ? `<div style="margin-top:14px;border-top:2px solid var(--brd);padding-top:12px">
        <div style="font-weight:600;margin-bottom:8px">Корзина — укажите сколько нужно (показано: докупить)</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          ${cartArr.map(c => { const toBuy = Math.max(0, (c.need || 1) - (c.available || 0)); return `<tr style="border-top:1px solid var(--brd)">
            <td style="padding:6px 8px">${esc(c.name)}</td>
            <td style="padding:6px"><input data-need="${esc(c.k)}" type="number" min="0" value="${c.need || 1}" style="width:70px;padding:4px;border:1px solid var(--brd);border-radius:6px"> ${esc(c.unit || 'шт')}</td>
            <td style="padding:6px;text-align:center;color:var(--t2)">в наличии ${num(c.available || 0)}</td>
            <td style="padding:6px;text-align:center"><b style="color:${toBuy > 0 ? 'var(--warn,#e0a800)' : 'var(--ok-t,#30d158)'}">докупить ${num(toBuy)}</b></td>
            <td style="padding:6px;text-align:right"><button class="btn ghost" data-rm="${esc(c.k)}" style="font-size:12px;padding:2px 8px">✕</button></td></tr>`; }).join('')}
        </table>
        <button class="btn primary" id="sc-submit" style="margin-top:12px;width:100%">Добавить в заявку (${cartArr.length})</button>
      </div>` : '<div style="margin-top:12px;color:var(--t2);font-size:13px">Отметьте товары из каталога кнопкой «+». Нет нужного — добавьте вручную в заявке.</div>'}
      <div style="margin-top:10px;text-align:center">
        <button class="btn ghost" id="sc-to-detail" style="font-size:13px">Открыть заявку (добавить вручную / текстом / Excel) →</button>
      </div>
    </div>`;
    showModal({ title: '🛒 Каталог закупки', html: html });
    const qEl = document.getElementById('sc-q');
    if (qEl) { qEl.oninput = () => drawShowcase(procId, rows, qEl.value); setTimeout(() => { qEl.focus(); qEl.setSelectionRange(qEl.value.length, qEl.value.length); }, 30); }
    document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const it = JSON.parse(b.dataset.add); if (_cart[it.k]) delete _cart[it.k]; else _cart[it.k] = { ...it, need: (it.available || 0) + 1 }; drawShowcase(procId, rows, qEl ? qEl.value : ''); });
    document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { delete _cart[b.dataset.rm]; drawShowcase(procId, rows, qEl ? qEl.value : ''); });
    document.querySelectorAll('[data-need]').forEach(inp => inp.oninput = () => { const c = _cart[inp.dataset.need]; if (c) { c.need = parseFloat(inp.value) || 0; drawShowcase(procId, rows, qEl ? qEl.value : ''); setTimeout(() => { const ni = document.querySelector('[data-need="' + inp.dataset.need + '"]'); if (ni) ni.focus(); }, 20); } });
    const sub = document.getElementById('sc-submit');
    if (sub) sub.onclick = async () => {
      // Заказываем «докупить» = нужно − в наличии (что уже есть — не заказываем).
      const items = Object.values(_cart)
        .map(c => ({ name: c.name, unit: c.unit || 'шт', article: c.article || null, product_id: c.product_id || null, quantity: Math.max(0, (c.need || 0) - (c.available || 0)), unit_price: c.last_price || null }))
        .filter(it => it.quantity > 0);
      if (!items.length) { toast('Всё в наличии', 'Докупать нечего — увеличьте «нужно», если требуется заказать сверх остатка', 'warn'); return; }
      // 23.06.2026 BUG-FIX (🟡 P-14): добавлен try/catch + обработка 409 stock_changed.
      // Раньше apiPost при !ok бросал Error без UI-обратной связи — пользователь не понимал,
      // почему ничего не добавилось.
      let r;
      try {
        r = await apiPost(`/api/procurement/${procId}/items/bulk`, { items });
      } catch (e) {
        const msg = String(e && e.message || e);
        if (/HTTP 409/.test(msg)) {
          toast('Остатки изменились', 'Кто-то уже что-то изменил со склада. Обновите витрину и проверьте остатки.', 'warn');
          try { const d = await apiFetch('/api/products/catalog-procurement?include_equipment=true&limit=400'); drawShowcase(procId, d.items || [], qEl ? qEl.value : ''); } catch (_) { /* no-op */ }
        } else {
          toast('Ошибка', msg, 'err');
        }
        return;
      }
      if (r.error) { toast('Ошибка', r.error, 'err'); return; }
      toast('Добавлено', `${r.count} позиций`, 'ok'); Object.keys(_cart).forEach(k => delete _cart[k]); closeModal(); openDetail(procId);
    };
    const toDetail = document.getElementById('sc-to-detail');
    if (toDetail) toDetail.onclick = () => { closeModal(); openDetail(procId); };
  }

  async function openCreateModal(workId, opts) {
    const autoShowcase = !(opts && opts.autoShowcase === false); // по умолчанию открываем витрину после создания
    let workOpts = [{ value: '', label: '— без работы —' }];
    try {
      const wr = await apiFetch('/api/works?limit=200');
      (wr.works || wr.items || wr.rows || []).forEach(w => {
        workOpts.push({ value: String(w.id), label: w.work_title || '#' + w.id });
      });
    } catch(e) {}

    // Загрузим шаблоны для опции «из шаблона»
    let templates = [];
    try { const tr = await apiFetch('/api/procurement/templates'); templates = tr.items || []; } catch(e) {}
    const tplBlock = templates.length ? `<div class="proc-create-tpl" style="margin-bottom:var(--sp-3);padding:var(--sp-2);background:var(--warn-bg,rgba(200,168,78,0.08));border-radius:var(--r-sm)">
      <label style="display:block;margin-bottom:4px">📋 Создать из шаблона (для постоянных работ)<div id="pc-tpl_w" style="margin-top:4px"></div></label>
      <button class="btn ghost" id="pc-from-tpl" style="margin-top:6px;font-size:13px">Создать из выбранного шаблона →</button>
    </div>` : '';

    const html = `<div class="proc-create-form">
      ${tplBlock}
      <div style="color:var(--t3);font-size:12px;margin-bottom:var(--sp-2)">${templates.length ? '— или создайте новую заявку вручную —' : ''}</div>
      <label>Название<input id="pc-title" value="Заявка на закупку" required></label>
      <label>Работа${workId ? ' <span style="font-size:11px;color:var(--ok-t,#30d158)">(определена автоматически)</span>' : ''}<div id="pc-work_w"></div></label>
      <label>Приоритет<div id="pc-priority_w"></div></label>
      <label>Ценовой сегмент<div id="pc-segment_w"></div></label>
      <label>Лимит бюджета, ₽ (необязательно)<input id="pc-budget" type="number" min="0" placeholder="—"></label>
      <label>Примечание<textarea id="pc-notes" rows="3"></textarea></label>
      <button class="btn primary" id="pc-submit">${autoShowcase ? 'Создать и выбрать товары из каталога →' : 'Создать заявку'}</button>
    </div>`;
    showModal({ title: 'Новая заявка', html: html });
    if (templates.length) {
      document.getElementById('pc-tpl_w')?.appendChild(CRSelect.create({ id: 'pc-tpl', options: [{ value: '', label: '— выберите шаблон —' }, ...templates.map(t => ({ value: String(t.id), label: `${t.name} (${t.items_count||0} поз.)` }))], value: '', dropdownClass: 'z-modal' }));
      const fromTplBtn = document.getElementById('pc-from-tpl');
      if (fromTplBtn) fromTplBtn.onclick = async () => {
        const tplId = CRSelect.getValue('pc-tpl');
        if (!tplId) { toast('Выберите шаблон', '', 'err'); return; }
        const fw = document.getElementById('pc-work-fixed');
        const wid = fw ? (fw.value || null) : (CRSelect.getValue('pc-work') || null);
        const r = await apiPost(`/api/procurement/from-template/${tplId}`, { work_id: wid });
        if (r.error) { toast('Ошибка', r.error, 'err'); return; }
        toast('Создано из шаблона', '', 'ok'); closeModal(); openDetail(r.item.id);
      };
    }
    // Если работа задана из карточки работы — показываем её зафиксированной (не нужно выбирать).
    if (workId) {
      const w = workOpts.find(o => o.value === String(workId));
      const wEl = document.getElementById('pc-work_w');
      if (wEl) wEl.innerHTML = `<div style="padding:9px 12px;background:var(--bg2,rgba(48,209,88,.08));border:1px solid var(--ok-t,#30d158);border-radius:8px;font-weight:600">🔧 ${esc((w && w.label) || ('#' + workId))}</div><input type="hidden" id="pc-work-fixed" value="${workId}">`;
    } else {
      document.getElementById('pc-work_w')?.appendChild(CRSelect.create({ id: 'pc-work', options: workOpts, value: '', searchable: true, dropdownClass: 'z-modal' }));
    }
    document.getElementById('pc-priority_w')?.appendChild(CRSelect.create({ id: 'pc-priority', options: [{ value: 'normal', label: 'Обычный' }, { value: 'high', label: 'Высокий' }, { value: 'urgent', label: 'Срочный' }], value: 'normal', dropdownClass: 'z-modal' }));
    document.getElementById('pc-segment_w')?.appendChild(CRSelect.create({ id: 'pc-segment', options: [{ value: '', label: '— не указан —' }, { value: 'cheap', label: '💰 Подешевле' }, { value: 'medium', label: '⚖️ Средний' }, { value: 'premium', label: '⭐ Премиум' }], value: '', dropdownClass: 'z-modal' }));
    document.getElementById('pc-submit').onclick = async () => {
      const fixedWork = document.getElementById('pc-work-fixed');
      const body = {
        title: document.getElementById('pc-title').value,
        work_id: fixedWork ? (fixedWork.value || null) : (CRSelect.getValue('pc-work') || null),
        priority: CRSelect.getValue('pc-priority') || 'normal',
        price_segment: CRSelect.getValue('pc-segment') || null,
        budget_limit: parseFloat(document.getElementById('pc-budget').value) || null,
        notes: document.getElementById('pc-notes').value || null
      };
      const r = await apiPost('/api/procurement', body);
      if (r.error) { toast('Ошибка', r.error, 'err'); return; }
      toast('Создано', '', 'ok'); closeModal();
      // Витрина каталога сразу — чтобы пользователь видел, как добавлять товары.
      if (autoShowcase) openShowcase(r.item.id); else openDetail(r.item.id);
    };
  }

  // -- Refresh --
  let _tableEl = null;
  async function refresh() {
    if (!_tableEl) return;
    _tableEl.innerHTML = '<div class="proc-skel">' + Array.from({length:4}).map(()=>'<div class="proc-skel-row"></div>').join('') + '</div>';
    const params = new URLSearchParams();
    // в канбане статус-фильтр не применяем (показываем все колонки)
    Object.entries(currentFilters).forEach(([k,v])=>{ if(v && !(k==='status' && _viewMode==='kanban')) params.append(k,v); });
    params.append('limit', '400');
    let d; try { d = await apiFetch('/api/procurement?' + params.toString()); } catch(e){ _tableEl.innerHTML = `<div class="proc-empty">⚠️ ${esc(e.message)}</div>`; return; }
    const items = d.items || [];
    if (_viewMode === 'kanban') renderKanban(items, _tableEl);
    else renderTable(items, _tableEl);
  }

  // -- Kanban --
  // Группы-колонки: объединяем «родственные» статусы в понятные этапы.
  const KANBAN_COLS = [
    { key: 'new',      label: 'Новые',         statuses: ['sent_to_proc'],                 to: null },
    { key: 'work',     label: 'В работе',       statuses: ['proc_responded'],               to: null },
    { key: 'approve',  label: 'Согласование',   statuses: ['pm_approved','dir_question','dir_rework'], to: null },
    { key: 'paid',     label: 'Оплачено',       statuses: ['dir_approved','paid'],          to: null },
    { key: 'delivery', label: 'Доставка',       statuses: ['partially_delivered','delivered'], to: null },
    { key: 'done',     label: 'Закрыто',        statuses: ['closed','dir_rejected'],        to: null },
  ];
  const _isUrgent = r => r.priority === 'urgent' || (r.delivery_deadline && new Date(r.delivery_deadline) < new Date(Date.now()+3*864e5));
  function renderKanban(items, el) {
    const byStatus = {};
    items.forEach(r => { (byStatus[r.status] = byStatus[r.status] || []).push(r); });
    const colCards = col => {
      const cards = [];
      col.statuses.forEach(s => (byStatus[s]||[]).forEach(r => cards.push(r)));
      // горящие сверху
      cards.sort((a,b) => (_isUrgent(b)?1:0) - (_isUrgent(a)?1:0));
      return cards;
    };
    const emptyCols = KANBAN_COLS.filter((col) => !colCards(col).length);
    const filledCount = KANBAN_COLS.length - emptyCols.length;
    const rail = emptyCols.length
      ? `<div class="proc-krail" role="toolbar" aria-label="Пустые этапы">
          <span class="proc-krail__lab">Пустые · ${emptyCols.length}</span>
          ${emptyCols.map((c) => `<button type="button" class="proc-krail__chip" data-show-col="${c.key}">${c.label}</button>`).join('')}
        </div>`
      : '';
    el.innerHTML = `<div class="proc-kanban-wrap">${rail}<div class="proc-kanban${filledCount <= 2 ? ' proc-kanban--sparse' : ''}">${KANBAN_COLS.map(col => {
      const cards = colCards(col);
      return `<div class="proc-kcol${cards.length ? '' : ' proc-kcol--empty'}" data-col="${col.key}">
        <div class="proc-kcol__h">${col.label}<span class="proc-kcol__cnt">${cards.length}</span></div>
        <div class="proc-kcol__body" data-drop="${col.key}">
          ${cards.length ? cards.map(r => _kCard(r)).join('') : '<div class="proc-kcol__empty">перетащите сюда</div>'}
        </div></div>`;
    }).join('')}</div></div>`;
    const board = el.querySelector('.proc-kanban');
    el.querySelectorAll('[data-show-col]').forEach((btn) => {
      btn.onclick = () => {
        const col = el.querySelector('.proc-kcol[data-col="' + btn.dataset.showCol + '"]');
        if (!col) return;
        col.classList.add('proc-kcol--force');
        btn.classList.add('proc-krail__chip--on');
        col.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      };
    });
    // открытие карточки
    el.querySelectorAll('.proc-kcard[data-id]').forEach(c => {
      c.onclick = ev => { if (ev.target.closest('[data-nodrag]')) return; openDetail(+c.dataset.id); };
      c.setAttribute('draggable', 'true');
      c.ondragstart = ev => {
        ev.dataTransfer.setData('text/plain', c.dataset.id + ':' + c.dataset.status);
        c.classList.add('proc-kcard--drag');
        if (board) board.classList.add('proc-kanban--dragging');
      };
      c.ondragend = () => {
        c.classList.remove('proc-kcard--drag');
        if (board) board.classList.remove('proc-kanban--dragging');
      };
    });
    // drop-зоны = попытка перехода
    el.querySelectorAll('[data-drop]').forEach(zone => {
      zone.ondragover = ev => { ev.preventDefault(); zone.classList.add('proc-kcol__body--over'); };
      zone.ondragleave = () => zone.classList.remove('proc-kcol__body--over');
      zone.ondrop = async ev => {
        ev.preventDefault(); zone.classList.remove('proc-kcol__body--over');
        if (board) board.classList.remove('proc-kanban--dragging');
        const [id, fromStatus] = (ev.dataTransfer.getData('text/plain')||'').split(':');
        const col = KANBAN_COLS.find(c => c.key === zone.dataset.drop);
        await _kanbanMove(+id, fromStatus, col);
      };
    });
  }
  function _kCard(r) {
    const unpriced = r.unpriced_count || 0;
    const title = humanProcTitle(r);
    const shortTitle = title.length > 52 ? title.slice(0, 49) + '…' : title;
    const sum = money(r.items_total);
    return `<div class="proc-kcard ${_isUrgent(r)?'proc-kcard--urgent':''}" data-id="${r.id}" data-status="${r.status}">
      <div class="proc-kcard__top"><b>#${r.id}</b> ${esc(shortTitle)}${_isUrgent(r)?' <span class="proc-kbadge proc-kbadge--over">срочно</span>':''}</div>
      <div class="proc-kcard__work">${esc(r.work_title||'без работы')}</div>
      <div class="proc-kcard__row">
        <div class="proc-kcard__meta">
          <span>${esc(r.pm_name||'—')}</span>
          <span>${r.items_count||0} поз.</span>
        </div>
        <div class="proc-kcard__sum">${sum}</div>
      </div>
      <div class="proc-kcard__badges">
        ${badge(r.status)}
        ${unpriced>0?`<span class="proc-kbadge proc-kbadge--warn">без цен: ${unpriced}</span>`:''}
        ${r.delivery_deadline?`<span class="proc-kbadge ${new Date(r.delivery_deadline)<new Date()?'proc-kbadge--over':''}">${dt(r.delivery_deadline)}</span>`:''}
      </div>
    </div>`;
  }
  // Перетаскивание карточки в колонку = соответствующий переход (только разрешённый роли/статусу).
  async function _kanbanMove(id, fromStatus, col) {
    if (!col || col.statuses.includes(fromStatus)) return; // та же колонка
    const r = _user.role;
    const PM = ['PM','HEAD_PM'].includes(r), PROC = ['PROC','ADMIN'].includes(r), DIR = ['DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','ADMIN'].includes(r), BUH = ['BUH','ADMIN'].includes(r);
    let action = null;
    // карта разрешённых drag-переходов (целевая колонка → действие, из соответствующего статуса)
    if (col.key === 'work'    && fromStatus === 'sent_to_proc'   && PROC) action = 'proc-respond';
    else if (col.key === 'approve' && fromStatus === 'proc_responded' && PM)   action = 'pm-approve';
    else if (col.key === 'paid'    && fromStatus === 'pm_approved'    && DIR)  action = 'dir-approve';
    else if (col.key === 'paid'    && fromStatus === 'dir_approved'   && BUH)  action = 'mark-paid';
    else if (col.key === 'done'    && fromStatus === 'delivered'      && (PM||DIR)) action = 'close';
    if (!action) { toast('Перемещение', 'Этот переход недоступен (роль/статус) — откройте заявку для действий', 'warn'); return; }
    try {
      await apiPut(`/api/procurement/${id}/${action}`, {});
      toast('Готово', 'Статус изменён', 'ok');
      refresh();
    } catch (e) { toast('Ошибка', e.message, 'err'); refresh(); }
  }

  // -- Render --
  async function render({ layout, title }) {
    const ud = await apiFetch('/api/users/me');
    _user = ud.user || ud;
    currentFilters = {};

    await layout('', { title: title || 'Закупки' });
    const layoutEl = document.getElementById('layout');
    layoutEl.innerHTML = '';
    const page = document.createElement('div'); page.className = 'proc-page';
    const dashEl = document.createElement('div');
    const filtEl = document.createElement('div');
    _tableEl = document.createElement('div');
    page.append(dashEl, filtEl, _tableEl);
    layoutEl.appendChild(page);

    await renderDashboard(dashEl);
    renderFilters(filtEl);
    await refresh();
    // deep-link #/procurement?id=NN → открыть карточку заявки
    try {
      const h = String(location.hash || '');
      const qi = h.indexOf('?');
      if (qi >= 0) {
        const sp = new URLSearchParams(h.slice(qi + 1));
        const deepId = parseInt(sp.get('id'), 10);
        if (deepId) setTimeout(() => openDetail(deepId), 120);
      }
    } catch (_) {}
  }

  // ═══ ЗАКУПЩИК: счёт, группировка, подсказки, сплит ═══

  // Цикл группировки: нет → категории → поставщики → нет
  function _cycleGroup(procId) {
    _groupMode = _groupMode === 'none' ? 'category' : _groupMode === 'category' ? 'supplier' : 'none';
    openDetail(procId);
  }

  // Подсказки цен в строках (батч). Под ценой: «посл. 350₽ (ООО А) · ср.рынок 340₽».
  async function _attachItemHints(procId, items, isPROC) {
    const need = items.filter(it => !it.parent_item_id && (it.product_id || it.name));
    if (!need.length) return;
    let res; try { res = await apiPost(`/api/procurement/${procId}/price-hints`, { items: need.map(it => ({ key: 'i' + it.id, product_id: it.product_id || null, name: it.name })) }); } catch (_) { return; }
    const hints = res.hints || {};
    need.forEach(it => {
      const h = hints['i' + it.id]; if (!h || (!h.last && !h.stats)) return;
      const el = document.querySelector(`[data-hint-for="${it.id}"]`); if (!el) return;
      const cur = document.querySelector(`.proc-items-table__input[data-id="${it.id}"][data-field="unit_price"]`);
      const curVal = cur ? parseFloat(cur.value) : parseFloat(it.unit_price);
      const lastPrice = h.last && parseFloat(h.last.unit_price);
      el.title = [
        h.last ? `Последняя: ${money(h.last.unit_price)}${h.last.supplier_name ? ' (' + h.last.supplier_name + ')' : ''}` : '',
        h.stats && h.stats.avg_price ? `Средний рынок: ${money(h.stats.avg_price)}` : ''
      ].filter(Boolean).join(' · ');
      // не шумим подсказкой, если цена уже равна последней
      if (isPROC && h.last && !(curVal > 0 && Math.abs(curVal - lastPrice) < 0.01)) {
        el.innerHTML = `посл. ${money(h.last.unit_price)} <a href="#" class="proc-hint__use" data-use="${it.id}" data-price="${h.last.unit_price}">подставить</a>`;
      } else if (h.last) {
        el.innerHTML = '';
        el.title = el.title || ('посл. ' + money(h.last.unit_price));
      } else {
        el.innerHTML = '';
      }
    });
    document.querySelectorAll('.proc-hint__use').forEach(a => a.onclick = (ev) => {
      ev.preventDefault();
      const inp = document.querySelector(`.proc-items-table__input[data-id="${a.dataset.use}"][data-field="unit_price"]`);
      if (inp) { inp.value = a.dataset.price; inp.focus(); }
    });
  }

  // Форма сплита позиции по поставщикам
  async function openSplitForm(procId, itemId, item) {
    if (!item) return;
    const qty = parseFloat(item.quantity) || 0;
    let suppliers = [];
    try { const s = await apiFetch('/api/suppliers?limit=300'); suppliers = s.items || []; } catch (_) {}
    const supOpts = '<option value="">— поставщик —</option>' + suppliers.map(s => `<option value="${s.id}" data-name="${esc(s.name)}">${esc(s.name)}</option>`).join('');
    const partRow = (i) => `<div class="proc-split-row" data-pi="${i}">
      <input type="number" min="0" step="any" class="ps-qty" placeholder="кол-во" style="width:80px">
      <select class="ps-sup" style="flex:1;min-width:120px">${supOpts}</select>
      <input type="number" min="0" step="any" class="ps-price" placeholder="цена" style="width:80px">
      <input type="number" min="0" class="ps-days" placeholder="срок,дн" style="width:80px">
      <button class="btn ghost ps-rm" style="padding:2px 8px">✕</button>
    </div>`;
    const html = `<div style="min-width:480px">
      <div style="font-size:13px;color:var(--t2);margin-bottom:10px">Разбить «<b>${esc(item.name)}</b>» (всего ${qty} ${esc(item.unit)}) между поставщиками. Сумма частей должна равняться ${qty}.</div>
      <div id="ps-rows">${partRow(0)}${partRow(1)}</div>
      <button class="btn ghost" id="ps-add" style="margin-top:8px">+ Ещё часть</button>
      <div id="ps-sum" style="margin-top:10px;font-size:13px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn ghost" id="ps-cancel">Отмена</button>
        <button class="btn primary" id="ps-submit">Разбить</button>
      </div></div>`;
    showModal({ title: '✂️ Разбить позицию', html });
    let cnt = 2;
    const recalc = () => {
      let s = 0; document.querySelectorAll('.ps-qty').forEach(q => s += parseFloat(q.value) || 0);
      const el = document.getElementById('ps-sum');
      el.innerHTML = `Сумма частей: <b style="color:${Math.abs(s - qty) < 0.001 ? 'var(--ok-t,#30d158)' : 'var(--err)'}">${s}</b> / ${qty}`;
    };
    const bind = () => {
      document.querySelectorAll('.ps-qty').forEach(q => q.oninput = recalc);
      document.querySelectorAll('.ps-rm').forEach(b => b.onclick = () => { if (document.querySelectorAll('.proc-split-row').length > 2) { b.closest('.proc-split-row').remove(); recalc(); } });
      recalc();
    };
    bind();
    document.getElementById('ps-add').onclick = () => { document.getElementById('ps-rows').insertAdjacentHTML('beforeend', partRow(cnt++)); bind(); };
    document.getElementById('ps-cancel').onclick = () => closeModal();
    document.getElementById('ps-submit').onclick = async () => {
      const parts = [];
      document.querySelectorAll('.proc-split-row').forEach(row => {
        const q = parseFloat(row.querySelector('.ps-qty').value) || 0; if (q <= 0) return;
        const sel = row.querySelector('.ps-sup'); const sid = sel.value || null; const sname = sel.selectedOptions[0]?.dataset.name || null;
        parts.push({ quantity: q, supplier_id: sid ? +sid : null, supplier_name: sname, unit_price: parseFloat(row.querySelector('.ps-price').value) || null, delivery_days: parseInt(row.querySelector('.ps-days').value) || null });
      });
      if (parts.length < 2) { toast('Внимание', 'Нужно минимум 2 части', 'warn'); return; }
      const r = await fetch(`/api/procurement/${procId}/items/${itemId}/split`, { method: 'POST', headers: hdr(), body: JSON.stringify({ parts }) });
      const d = await r.json();
      if (!r.ok) { toast('Ошибка', d.error || 'Не удалось разбить', 'err'); return; }
      toast('Готово', 'Позиция разбита', 'ok'); closeModal(); openDetail(procId);
    };
  }

  // Модалка загрузки счёта → парс → авто-матчинг → массово проставить цены
  async function openInvoiceModal(procId) {
    let suppliers = [];
    try { const s = await apiFetch('/api/suppliers?limit=300'); suppliers = s.items || []; } catch (_) {}
    const supOpts = '<option value="">— выберите/впишите —</option>' + suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    const html = `<div style="min-width:540px" id="inv-root">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:12px">
        <label style="flex:1;min-width:180px">Поставщик<select id="inv-sup" style="width:100%;padding:8px;border:1px solid var(--brd);border-radius:8px">${supOpts}</select></label>
        <label style="min-width:120px">или вписать<input id="inv-supname" placeholder="ООО ..." style="width:100%;padding:8px;border:1px solid var(--brd);border-radius:8px"></label>
        <label style="width:110px">Срок, дней<input id="inv-days" type="number" min="0" placeholder="—" style="width:100%;padding:8px;border:1px solid var(--brd);border-radius:8px"></label>
      </div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:8px">Excel — разбирается сразу. PDF/фото — текст распознаётся в браузере. Столбцы: наименование · артикул · количество · цена.</div>
      <label class="btn primary" style="cursor:pointer;display:inline-block">📎 Выбрать файл счёта<input type="file" id="inv-file" accept=".xlsx,.xls,.pdf,image/*" style="display:none"></label>
      <span id="inv-status" style="font-size:12px;color:var(--gold);margin-left:8px"></span>
      <div id="inv-preview" style="margin-top:12px"></div>
    </div>`;
    showModal({ title: '🧾 Загрузить счёт поставщика', html });
    const setStatus = t => { const s = document.getElementById('inv-status'); if (s) s.textContent = t || ''; };
    document.getElementById('inv-file').onchange = async (ev) => {
      const file = ev.target.files && ev.target.files[0]; if (!file) return;
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const supId = document.getElementById('inv-sup').value || '';
      const supName = document.getElementById('inv-supname').value.trim() || (document.getElementById('inv-sup').selectedOptions[0]?.textContent !== '— выберите/впишите —' ? document.getElementById('inv-sup').selectedOptions[0]?.textContent : '') || '';
      const days = document.getElementById('inv-days').value || '';
      try {
        let d;
        if (ext === 'xlsx' || ext === 'xls') {
          setStatus('Разбор Excel…');
          const fd = new FormData(); if (supId) fd.append('supplier_id', supId); if (supName) fd.append('supplier_name', supName); if (days) fd.append('delivery_days', days); fd.append('file', file);
          const r = await fetch(`/api/procurement/${procId}/invoice/parse`, { method: 'POST', headers: { Authorization: hdr().Authorization }, body: fd });
          d = await r.json(); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        } else {
          // PDF/фото → извлекаем текст в браузере (реюз warehouse extractDocText недоступен здесь — простая загрузка через FormData с конвертацией не делаем; шлём текст если есть)
          setStatus('Распознавание…');
          const text = await _extractText(file, setStatus);
          d = await apiPost(`/api/procurement/${procId}/invoice/parse`, { text, supplier_id: supId || null, supplier_name: supName || null, delivery_days: days || null });
        }
        setStatus('');
        if (d.ai_unavailable) { document.getElementById('inv-preview').innerHTML = `<div class="proc-empty">🤖 ${esc(d.message || 'AI недоступен')}</div>`; return; }
        _drawInvoicePreview(procId, d);
      } catch (e) { setStatus(''); toast('Ошибка', e.message, 'err'); }
    };
  }
  // Извлечение текста из PDF/фото (CDN pdf.js/Tesseract — как на складе)
  function _loadScript(src) { return new Promise((res, rej) => { if (document.querySelector('script[data-pi-lib="' + src + '"]')) return res(); const s = document.createElement('script'); s.src = src; s.async = true; s.dataset.piLib = src; s.onload = () => res(); s.onerror = () => rej(new Error('Не удалось загрузить ' + src)); document.head.appendChild(s); }); }
  async function _extractText(file, onP) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') {
      await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      const pdfjs = window.pdfjsLib; if (!pdfjs) throw new Error('PDF-движок недоступен');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const buf = await file.arrayBuffer(); const doc = await pdfjs.getDocument({ data: buf }).promise; let text = '';
      for (let pp = 1; pp <= Math.min(doc.numPages, 15); pp++) { onP && onP('Стр ' + pp + '…'); const page = await doc.getPage(pp); const tc = await page.getTextContent(); text += tc.items.map(i => i.str).join(' ') + '\n'; }
      if (text.replace(/\s/g, '').length < 30) throw new Error('PDF без текста — сфотографируйте');
      return text;
    }
    onP && onP('OCR…'); await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js');
    if (!window.Tesseract) throw new Error('OCR недоступен');
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(file); });
    const out = await window.Tesseract.recognize(dataUrl, 'rus+eng');
    return (out && out.data && out.data.text) || '';
  }
  function _drawInvoicePreview(procId, d) {
    const host = document.getElementById('inv-preview'); if (!host) return;
    const matches = d.matches || [], unmatched = d.unmatched || [];
    const itemsOpts = (sel) => '<option value="">— не привязывать —</option>' + (d.items_for_match || []).map(it => `<option value="${it.id}" ${sel === it.id ? 'selected' : ''}>${esc(it.name)}${it.has_price ? ' ✓' : ''}</option>`).join('');
    const confBadge = c => c >= 0.8 ? `<span class="proc-kbadge" style="background:rgba(48,209,88,.16);color:var(--ok,#30d158)">${Math.round(c*100)}%</span>` : c >= 0.5 ? `<span class="proc-kbadge proc-kbadge--warn">${Math.round(c*100)}%</span>` : `<span class="proc-kbadge">${Math.round(c*100)}%</span>`;
    const allRows = [
      ...matches.map((m, i) => ({ ...m, _i: i, auto: true })),
      ...unmatched.map((u, i) => ({ ...u, item_id: null, confidence: 0, _i: matches.length + i, auto: false }))
    ];
    let rows = allRows.map((m) => {
      const checked = m.auto && m.item_id && m.unit_price != null ? 'checked' : '';
      return `<tr data-inv-i="${m._i}" data-mid="${m.item_id || ''}">
      <td><input type="checkbox" class="proc-wiz-check inv-pick" data-i="${m._i}" ${checked}></td>
      <td>${esc(m.invoice_name)}${m.auto ? '' : ' <span class="proc-kbadge proc-kbadge--warn">вручную</span>'}</td>
      <td>${m.auto ? confBadge(m.confidence) : '—'}</td>
      <td><select class="inv-link" data-i="${m._i}" style="min-width:160px;padding:4px;border:1px solid var(--brd);border-radius:6px">${itemsOpts(m.item_id)}</select></td>
      <td><input type="number" class="inv-price" data-i="${m._i}" value="${m.unit_price != null ? m.unit_price : ''}" style="width:80px;padding:4px;border:1px solid var(--brd);border-radius:6px"></td>
    </tr>`;
    }).join('');
    host.innerHTML = `<div class="proc-wiz">
      <div class="proc-wiz__steps">
        <span class="proc-wiz__step proc-wiz__step--done">1. Файл</span>
        <span class="proc-wiz__step proc-wiz__step--done">2. Разбор</span>
        <span class="proc-wiz__step proc-wiz__step--on">3. Сопоставление</span>
        <span class="proc-wiz__step">4. На РП</span>
      </div>
      <div style="font-weight:600">Отметьте строки для применения (${matches.length} авто · ${unmatched.length} вручную)</div>
      <div style="border:1px solid var(--brd);border-radius:8px;overflow:auto">
        <table class="proc-items-table proc-wiz-table" style="margin:0"><thead><tr><th></th><th>Строка счёта</th><th>%</th><th>Позиция заявки</th><th>Цена</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="padding:14px;text-align:center;color:var(--t2)">Нет строк</td></tr>'}</tbody></table>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn ghost" id="inv-pick-all">Выбрать все с ценой</button>
        <button class="btn primary" id="inv-apply">✅ Применить отмеченные</button>
      </div>
    </div>`;
    const pickAll = document.getElementById('inv-pick-all');
    if (pickAll) pickAll.onclick = () => {
      host.querySelectorAll('tbody tr').forEach(tr => {
        const i = tr.dataset.invI;
        const price = parseFloat(host.querySelector(`.inv-price[data-i="${i}"]`)?.value);
        const itemId = host.querySelector(`.inv-link[data-i="${i}"]`)?.value;
        const cb = host.querySelector(`.inv-pick[data-i="${i}"]`);
        if (cb) cb.checked = !!(itemId && price > 0);
      });
    };
    document.getElementById('inv-apply').onclick = async () => {
      const applyRows = [];
      host.querySelectorAll('tbody tr').forEach(tr => {
        const i = tr.dataset.invI;
        const picked = host.querySelector(`.inv-pick[data-i="${i}"]`)?.checked;
        if (!picked) return;
        const itemId = host.querySelector(`.inv-link[data-i="${i}"]`)?.value;
        const price = parseFloat(host.querySelector(`.inv-price[data-i="${i}"]`)?.value);
        if (itemId && price > 0) applyRows.push({ item_id: +itemId, unit_price: price });
      });
      if (!applyRows.length) { toast('Внимание', 'Отметьте строки с привязкой и ценой', 'warn'); return; }
      const r = await fetch(`/api/procurement/${procId}/invoice/${d.import_id}/apply`, { method: 'POST', headers: hdr(), body: JSON.stringify({ rows: applyRows, supplier_id: d.supplier_id, supplier_name: d.supplier_name, delivery_days: d.delivery_days }) });
      const res = await r.json();
      if (!r.ok) { toast('Ошибка', res.error || 'Не удалось', 'err'); return; }
      toast('Готово', `Цены проставлены: ${res.applied}`, 'ok');
      host.innerHTML = `<div class="proc-inv-after">
        <div class="proc-wiz__steps">
          <span class="proc-wiz__step proc-wiz__step--done">1. Файл</span>
          <span class="proc-wiz__step proc-wiz__step--done">2. Разбор</span>
          <span class="proc-wiz__step proc-wiz__step--done">3. Сопоставление</span>
          <span class="proc-wiz__step proc-wiz__step--on">4. На РП</span>
        </div>
        <div class="proc-inv-after__ok">✓ Цены проставлены: <b>${res.applied}</b> поз.${res.total_sum!=null?' · '+money(res.total_sum):''}</div>
        <p>Остальные позиции заявки можно закрыть следующими счетами позже.</p>
        <div class="proc-inv-after__acts">
          <button class="btn primary" id="inv-send-pm">→ На согласование РП</button>
          <button class="btn ghost" id="inv-later">К заявке</button>
        </div>
      </div>`;
      document.getElementById('inv-send-pm').onclick = async () => {
        try {
          await apiPut(`/api/procurement/${procId}/invoice/${d.import_id}/send-to-pm`, {});
          toast('Отправлено РП', 'Счёт на согласовании', 'ok');
        } catch (e) { toast('Ошибка', e.message || 'Не удалось', 'err'); }
        closeModal(); openDetail(procId);
      };
      document.getElementById('inv-later').onclick = () => { closeModal(); openDetail(procId); };
    };
  }

  return { render, openDetail, openCreateModal, openPaymentInvoiceModal, openStandalonePaymentModal, openInvoiceModal, _attachInvoice, _deleteItem, _cancelItem, openCatalogProduct, openCatalogSearch };
})();
