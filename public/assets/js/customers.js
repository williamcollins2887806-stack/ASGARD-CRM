window.AsgardCustomersPage = (function(){
  const { $, $$, esc, toast, showModal } = AsgardUI;
  const V = AsgardValidate;

  let listState = {
    q: '', role: 'all', relation: 'all', quarantine: false,
    page: 1, pageSize: 40, items: [], loading: false
  };

  function normInn(v){ return String(v||'').replace(/\D/g,''); }
  function isoNow(){ return new Date().toISOString(); }

  async function authHeaders(){
    const auth = await AsgardAuth.getAuth();
    return { Authorization: 'Bearer ' + (auth && auth.token ? auth.token : ''), 'Content-Type': 'application/json' };
  }

  async function apiGet(url){
    const r = await fetch(url, { headers: await authHeaders() });
    const data = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  async function getCustomerByInn(inn){
    inn = normInn(inn);
    if (!inn) return null;
    try {
      const d = await apiGet('/api/customers/' + encodeURIComponent(inn));
      return d.customer || null;
    } catch (_) {
      return await AsgardDB.get('customers', inn);
    }
  }

  async function lookupByInn(inn){
    inn = normInn(inn);
    if (inn.length !== 10 && inn.length !== 12) throw new Error('ИНН должен быть 10 или 12 цифр');
    return apiGet('/api/customers/lookup/' + encodeURIComponent(inn));
  }

  async function upsertCustomer(rec){
    const inn = normInn(rec.inn);
    if (!(inn.length===10 || inn.length===12)) throw new Error('ИНН должен быть 10 или 12 цифр');
    const cur = await AsgardDB.get('customers', inn);
    const now = isoNow();
    const out = Object.assign({}, cur||{}, rec, {
      inn,
      name: String(rec.name||'').trim(),
      full_name: String(rec.full_name||'').trim(),
      kpp: String(rec.kpp||'').trim(),
      ogrn: String(rec.ogrn||'').trim(),
      address: String(rec.address||'').trim(),
      contacts: Array.isArray(rec.contacts) ? rec.contacts : undefined,
      contact_person: String(rec.contact_person||'').trim(),
      email: String(rec.email||'').trim(),
      phone: String(rec.phone||'').trim(),
      comment: String(rec.comment||'').trim(),
      notes: String(rec.comment || rec.notes || '').trim(),
      updated_at: now,
      created_at: (cur && cur.created_at) ? cur.created_at : now
    });
    if (V.isBlank(out.full_name) && V.isBlank(out.name)){
      toast('Валидация','Укажите наименование (краткое или полное)','err');
      return;
    }
    delete out.id;
    await AsgardDB.put('customers', out);
    return inn;
  }

  function loadContacts(c){
    if (Array.isArray(c?.contacts)) return c.contacts.map(normalizeContact);
    const raw = String(c?.contacts_json||'').trim();
    if (!raw) {
      if (c?.contact_person) return [normalizeContact({ name: c.contact_person, phone: c.phone, email: c.email, is_primary: true })];
      return [];
    }
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(normalizeContact) : [];
    } catch (_) { return []; }
  }

  function normalizeContact(c){
    return {
      name: String(c?.name || ''),
      role: String(c?.role || c?.position || ''),
      position: String(c?.role || c?.position || ''),
      phone: String(c?.phone || ''),
      phone2: String(c?.phone2 || ''),
      email: String(c?.email || ''),
      comment: String(c?.comment || ''),
      is_primary: !!c?.is_primary
    };
  }

  function contactsToPayload(list){
    return (list||[]).map((c)=>({
      name: c.name, position: c.role || c.position || '',
      phone: c.phone, phone2: c.phone2, email: c.email,
      is_primary: !!c.is_primary
    }));
  }

  function roleLabel(roles){
    if (roles === 'both') return { text: 'Покупатель · Поставщик', cls: 'cp-chip--both' };
    if (roles === 'supplier') return { text: 'Поставщик', cls: 'cp-chip--supplier' };
    return { text: 'Покупатель', cls: 'cp-chip--buyer' };
  }

  function relationLabel(st){
    if (st === 'active') return { text: 'Работаем', cls: 'cp-chip--active' };
    if (st === 'idle') return { text: 'Тихий', cls: 'cp-chip--idle' };
    return { text: 'Нет связей', cls: 'cp-chip--none' };
  }

  function riskChip(tl){
    if (!tl) return '';
    const map = {
      green: ['Надёжный', 'cp-chip--risk-ok'],
      yellow: ['Средний риск', 'cp-chip--risk-warn'],
      red: ['Высокий риск', 'cp-chip--risk-err'],
      gray: ['Новый', 'cp-chip--risk-gray']
    };
    const m = map[tl.color] || map.gray;
    return '<span class="cp-chip '+m[1]+'">'+esc(m[0])+'</span>';
  }

  function contactsTemplate(list){
    if (!list.length) return '<div class="help">Контактов пока нет.</div>';
    return list.map((c,i)=>`
      <div class="cp-contact${c.is_primary?' is-primary':''}">
        <div class="cp-contact__main">
          <div class="cp-contact__name">${esc(c.name||'')}${c.is_primary?' <span class="cp-chip">Главное</span>':''}</div>
          <div class="cp-contact__meta">${esc([c.role||c.position, c.phone, c.phone2, c.email].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="cp-contact__actions">
          <button type="button" class="btn ghost" data-edit-contact="${i}">Изменить</button>
          <button type="button" class="btn ghost" data-del-contact="${i}">Удалить</button>
        </div>
      </div>`).join('');
  }

  function openContactModal({ title, contact, onSave, isFirst }){
    const isPrimary = contact ? !!contact.is_primary : !!isFirst;
    const html = `
      <div class="cp-modal">
        <div class="cp-modal__grid">
          <div class="cp-field"><label>ФИО</label><input id="c_name" value="${esc(contact?.name||'')}"/></div>
          <div class="cp-field"><label>Должность</label><input id="c_role" value="${esc(contact?.role||contact?.position||'')}"/></div>
          <div class="cp-field"><label>Телефон 1</label><input id="c_phone" value="${esc(contact?.phone||'')}"/></div>
          <div class="cp-field"><label>Телефон 2</label><input id="c_phone2" value="${esc(contact?.phone2||'')}"/></div>
          <div class="cp-field cp-span-2" style="grid-column:1/-1"><label>Email</label><input id="c_email" value="${esc(contact?.email||'')}"/></div>
        </div>
        <label class="cp-modal__check"><input type="checkbox" id="c_primary"${isPrimary?' checked':''}/> Главное контактное лицо</label>
        <div class="cp-modal__foot">
          <button type="button" class="btn ghost" id="c_cancel">Отмена</button>
          <button type="button" class="btn" id="c_ok">Сохранить</button>
        </div>
      </div>`;
    showModal({
      title: title || 'Контакт',
      html,
      onMount: ({back})=>{
        $('#c_cancel',back).onclick = ()=>AsgardUI.hideModal();
        $('#c_ok',back).onclick = async ()=>{
          const obj = {
            name: $('#c_name',back).value.trim(),
            role: $('#c_role',back).value.trim(),
            position: $('#c_role',back).value.trim(),
            phone: $('#c_phone',back).value.trim(),
            phone2: $('#c_phone2',back).value.trim(),
            email: $('#c_email',back).value.trim(),
            comment: String(contact?.comment || '').trim(),
            is_primary: !!$('#c_primary',back)?.checked
          };
          if (!obj.name){ toast('Контакт','Укажите ФИО','err'); return; }
          try {
            const result = onSave(obj);
            if (result && typeof result.then === 'function') await result;
            AsgardUI.hideModal();
          } catch(e) {
            toast('Контакт', e.message || 'Не удалось сохранить', 'err');
          }
        };
      }
    });
  }

  function openCreateModal(){
    const html = `
      <div class="cp-modal">
        <div class="cp-field"><label>ИНН</label><input id="n_inn" placeholder="10 или 12 цифр" maxlength="12"/></div>
        <div id="n_preview" class="help" style="margin-top:10px;min-height:40px">Введите ИНН — подтянем данные из ЕГРЮЛ.</div>
        <div class="cp-modal__foot">
          <button type="button" class="btn ghost" id="n_cancel">Отмена</button>
          <button type="button" class="btn" id="n_ok" disabled>Создать и открыть</button>
        </div>
      </div>`;
    let suggestion = null;
    showModal({
      title: 'Новый контрагент',
      html,
      onMount: ({back})=>{
        const inp = $('#n_inn', back);
        const prev = $('#n_preview', back);
        const ok = $('#n_ok', back);
        $('#n_cancel', back).onclick = ()=>AsgardUI.hideModal();
        let t = null;
        const run = async ()=>{
          const inn = normInn(inp.value);
          suggestion = null;
          ok.disabled = true;
          if (inn.length !== 10 && inn.length !== 12) {
            prev.textContent = 'ИНН должен быть 10 или 12 цифр.';
            return;
          }
          prev.textContent = 'Ищем в ЕГРЮЛ…';
          try {
            const r = await lookupByInn(inn);
            if (r.found && r.suggestion) {
              suggestion = r.suggestion;
              prev.innerHTML = '<b>'+esc(suggestion.name||'')+'</b><br><span class="help">'+esc(suggestion.address||'')+'</span>';
              ok.disabled = false;
            } else {
              prev.textContent = r.message || 'Организация не найдена. Можно открыть пустую карточку.';
              suggestion = { inn, name: '' };
              ok.disabled = false;
            }
          } catch(e) {
            prev.textContent = e.message || 'Ошибка поиска';
          }
        };
        inp.addEventListener('input', ()=>{ clearTimeout(t); t = setTimeout(run, 400); });
        ok.onclick = async ()=>{
          const inn = normInn(inp.value);
          AsgardUI.hideModal();
          if (suggestion && suggestion.name) {
            try {
              await upsertCustomer({
                inn,
                name: suggestion.name,
                full_name: suggestion.full_name || '',
                kpp: suggestion.kpp || '',
                ogrn: suggestion.ogrn || '',
                address: suggestion.address || ''
              });
            } catch (_) { /* open anyway */ }
          }
          location.hash = '#/customer?inn=' + encodeURIComponent(inn) + (suggestion && suggestion.name ? '' : '&new=1');
        };
      }
    });
  }

  async function fetchDirectory(){
    const q = new URLSearchParams();
    if (listState.q) q.set('search', listState.q);
    if (listState.role !== 'all') q.set('role', listState.role);
    if (listState.relation !== 'all') q.set('relation', listState.relation);
    if (listState.quarantine) q.set('quarantine', '1');
    q.set('limit', String(listState.pageSize));
    q.set('offset', String((listState.page - 1) * listState.pageSize));
    const data = await apiGet('/api/customers/directory?' + q.toString());
    listState.items = data.items || [];
    return data;
  }

  function rowHtml(it){
    const rl = roleLabel(it.roles);
    const rel = relationLabel(it.relation_status);
    const c = it.counts || {};
    return `<a class="cp-row" href="#/customer?inn=${encodeURIComponent(it.inn||'')}">
      <div>
        <div class="cp-row__name">${esc(it.name||it.full_name||'—')}</div>
        <div class="cp-row__inn">ИНН ${esc(it.inn||'')}</div>
      </div>
      <div class="cp-row__chips">
        <span class="cp-chip ${rl.cls}">${esc(rl.text)}</span>
        <span class="cp-chip ${rel.cls}">${esc(rel.text)}</span>
      </div>
      <div class="cp-row__counts">
        <div class="cp-count"><b>${c.contracts||0}</b><span>Дог.</span></div>
        <div class="cp-count"><b>${c.tenders||0}</b><span>Тенд.</span></div>
        <div class="cp-count"><b>${c.works||0}</b><span>Раб.</span></div>
        <div class="cp-count"><b>${c.docs||0}</b><span>Счета</span></div>
      </div>
    </a>`;
  }

  async function renderList({layout, title}={}){
    const auth = await AsgardAuth.requireUser();
    if (!auth) return;

    const html = `
      <div class="cp-page">
        <div class="cp-top">
          <div>
            <p class="cp-top__eyebrow">Справочник</p>
            <h1 class="cp-top__h1">${esc(title||'Карта контрагентов')}</h1>
          </div>
          <div class="cp-top__actions">
            <button type="button" class="btn" id="btnNew">Новый контрагент</button>
          </div>
        </div>
        <div class="cp-toolbar">
          <div class="cp-field"><label>Поиск</label><input type="search" id="q" placeholder="ИНН или название" value="${esc(listState.q)}"/></div>
          <div class="cp-field"><label>Роль</label>
            <div class="cp-seg" id="segRole">
              <button type="button" data-role="all" class="${listState.role==='all'?'is-on':''}">Все</button>
              <button type="button" data-role="buyer" class="${listState.role==='buyer'?'is-on':''}">Покупатели</button>
              <button type="button" data-role="supplier" class="${listState.role==='supplier'?'is-on':''}">Поставщики</button>
            </div>
          </div>
          <div class="cp-field"><label>Связь</label>
            <div class="cp-seg" id="segRel">
              <button type="button" data-rel="all" class="${listState.relation==='all'?'is-on':''}">Все</button>
              <button type="button" data-rel="active" class="${listState.relation==='active'?'is-on':''}">Работаем</button>
              <button type="button" data-rel="idle" class="${listState.relation==='idle'?'is-on':''}">Тихие</button>
            </div>
          </div>
          <div class="cp-field"><label>Разбор</label>
            <div class="cp-seg" id="segQ">
              <button type="button" data-q="0" class="${!listState.quarantine?'is-on':''}">Основной</button>
              <button type="button" data-q="1" class="${listState.quarantine?'is-on':''}">На разбор</button>
            </div>
          </div>
        </div>
        <div class="cp-list" id="cpList"><div class="cp-empty">Загрузка…</div></div>
        <div class="cp-pager" id="cpPager"></div>
      </div>`;

    await layout('<div class="content">'+html+'</div>', { title, motto: 'Храни имена и печати — и договор будет крепок.' });

    const listEl = $('#cpList');
    const pager = $('#cpPager');

    async function reload(){
      listEl.innerHTML = '<div class="cp-empty">Загрузка…</div>';
      try {
        await fetchDirectory();
        if (!listState.items.length) {
          listEl.innerHTML = '<div class="cp-empty">Ничего не найдено.</div>';
        } else {
          listEl.innerHTML = listState.items.map(rowHtml).join('');
        }
        pager.innerHTML = `
          <button type="button" class="btn ghost" id="pgPrev" ${listState.page<=1?'disabled':''}>Назад</button>
          <span>стр. ${listState.page}</span>
          <button type="button" class="btn ghost" id="pgNext" ${listState.items.length<listState.pageSize?'disabled':''}>Вперёд</button>`;
        $('#pgPrev')?.addEventListener('click', ()=>{ listState.page--; reload(); });
        $('#pgNext')?.addEventListener('click', ()=>{ listState.page++; reload(); });
      } catch(e) {
        listEl.innerHTML = '<div class="cp-empty">'+esc(e.message||'Ошибка загрузки')+'</div>';
      }
    }

    const deb = window.AsgardDebounce
      ? AsgardDebounce((e)=>{ listState.q = e.target.value; listState.page = 1; reload(); }, 300)
      : ((e)=>{ clearTimeout(deb._t); deb._t=setTimeout(()=>{ listState.q=e.target.value; listState.page=1; reload(); },300); });
    $('#q').addEventListener('input', deb);

    $$('#segRole button').forEach((b)=>b.addEventListener('click', ()=>{
      listState.role = b.getAttribute('data-role'); listState.page = 1; reload();
      $$('#segRole button').forEach((x)=>x.classList.toggle('is-on', x===b));
    }));
    $$('#segRel button').forEach((b)=>b.addEventListener('click', ()=>{
      listState.relation = b.getAttribute('data-rel'); listState.page = 1; reload();
      $$('#segRel button').forEach((x)=>x.classList.toggle('is-on', x===b));
    }));
    $$('#segQ button').forEach((b)=>b.addEventListener('click', ()=>{
      listState.quarantine = b.getAttribute('data-q') === '1'; listState.page = 1; reload();
      $$('#segQ button').forEach((x)=>x.classList.toggle('is-on', x===b));
    }));
    $('#btnNew').addEventListener('click', ()=>openCreateModal());

    await reload();
  }

  /**
   * V475: вкладка «Договоры» — обычные и ОБС, ОБС с полосой лимита.
   *
   * Заказчик 08.11.2026: «в карточке контрагента мы должны видеть все ОБС
   * договора» и «если у него подходит лимит ОБС — сколько он выработал».
   */
  function contractsTabHtml(dash) {
    const regular = (dash && dash.contracts_list) || [];
    const obs = (dash && dash.obs_contracts_list) || [];
    const limits = (dash && dash.obs_limits) || null;

    const limitSummary = limits && limits.limit > 0 ? (() => {
      const pct = Math.min(100, Math.max(0, Number(limits.used_pct) || 0));
      const color = limits.exhausted_count > 0 ? 'var(--red)'
        : (limits.near_limit ? 'var(--amber)' : 'var(--green)');
      return `<div style="margin-bottom:14px;padding:12px 14px;border-radius:10px;background:var(--bg3);border:1px solid var(--brd)">
        <div style="font-size:13px;color:var(--t2)">
          ОБС-лимиты: использовано <b style="color:${color}">${esc(moneyRu(limits.spent))}</b>
          из ${esc(moneyRu(limits.limit))} (${pct}%)
        </div>
        <div style="height:6px;border-radius:3px;background:var(--bg4);overflow:hidden;margin:6px 0">
          <div style="height:100%;width:${pct}%;background:${color}"></div>
        </div>
        <div style="font-size:12px;color:${color};font-weight:600">
          Остаток ${esc(moneyRu(limits.remaining))}${
            limits.exhausted_count > 0 ? ' · есть выработанный договор' : ''
          }${limits.near_limit && limits.exhausted_count === 0 ? ' · остаток меньше 10%' : ''}
        </div>
      </div>`;
    })() : '';

    const rowsRegular = regular.length ? regular.map((c) => `
      <tr data-contract-id="${c.id}" data-contract-kind="contract" style="cursor:pointer">
        <td><b>${esc(c.number) || '—'}</b></td>
        <td>${c.date ? esc(String(c.date).slice(0, 10)) : '—'}</td>
        <td style="text-align:right">${c.amount != null ? esc(moneyRu(c.amount)) : '—'}</td>
        <td>${esc(typeLabelRu(c.type))}</td>
        <td>${c.docs_count || 0}</td>
        <td>${c.has_scan ? 'есть' : '—'}</td>
        <td>${esc(c.status) || '—'}</td>
      </tr>`).join('') : '';

    const rowsObs = obs.length ? obs.map((c) => {
      const l = c.limit || {};
      const pct = Math.min(100, Math.max(0, Number(l.used_pct) || 0));
      const color = l.exhausted ? 'var(--red)' : (pct >= 90 ? 'var(--amber)' : 'var(--green)');
      return `
      <tr data-contract-id="${c.id}" data-contract-kind="obs" style="cursor:pointer">
        <td><b>${esc(c.number) || '—'}</b>
          <div style="font-size:11px;color:var(--t3)">ОБС</div></td>
        <td>${c.date ? esc(String(c.date).slice(0, 10)) : '—'}</td>
        <td style="text-align:right">${esc(moneyRu(l.amount || 0))}</td>
        <td>${c.docs_count || 0}</td>
        <td style="min-width:160px">
          <div style="font-size:12px;color:${color};font-weight:600">
            ${esc(moneyRu(l.spent || 0))} / ${esc(moneyRu(l.amount || 0))}
          </div>
          <div style="height:5px;border-radius:3px;background:var(--bg4);overflow:hidden;margin-top:3px">
            <div style="height:100%;width:${pct}%;background:${color}"></div>
          </div>
          <div style="font-size:11px;color:var(--t3);margin-top:2px">
            остаток ${esc(moneyRu(l.remaining || 0))} · ${pct}%
            ${l.exhausted ? ' · выработан' : ''}
          </div>
        </td>
        <td>${l.exhausted ? '<span style="color:var(--red);font-weight:600">лимит исчерпан</span>' : 'действует'}</td>
      </tr>`;
    }).join('') : '';

    return `
      ${limitSummary}
      ${regular.length ? `<div class="cc-sec-title" style="margin-bottom:6px">Договоры</div>
      <table class="cp-table"><thead><tr>
        <th>Номер</th><th>Дата</th><th>Сумма</th><th>Тип</th><th>Счетов</th><th>Скан</th><th>Статус</th>
      </tr></thead><tbody>${rowsRegular}</tbody></table>` : ''}
      ${obs.length ? `<div class="cc-sec-title" style="margin:16px 0 6px">ОБС-договоры (субподряд)</div>
      <table class="cp-table"><thead><tr>
        <th>Номер</th><th>Дата</th><th>Лимит</th><th>Счетов</th><th>Выработано</th><th>Статус</th>
      </tr></thead><tbody>${rowsObs}</tbody></table>` : ''}
      ${!regular.length && !obs.length ? '<div class="help" style="padding:20px;text-align:center">Договоров и ОБС-договоров нет</div>' : ''}`;
  }

  /**
   * V475: вкладка «Счета» — входящие от контрагента и исходящие наши.
   * Раньше здесь были только три строчки-счётчика.
   */
  function docsTabHtml(dash) {
    const incoming = (dash && dash.docs_list) || [];
    const outgoing = (dash && dash.invoices_out_list) || [];
    const docsTotal = Number((dash && dash.docs_total) != null
      ? dash.docs_total
      : ((dash && dash.kpi && dash.kpi.docs_in) || incoming.length)) || incoming.length;

    const incomingRows = incoming.length ? incoming.map((r) => `
      <tr>
        <td><b>${esc(r.invoice_number) || 'б/н'}</b></td>
        <td>${r.invoice_date ? esc(String(r.invoice_date).slice(0, 10)) : '—'}</td>
        <td style="text-align:right">${r.amount != null ? esc(moneyRu(r.amount)) : '—'}</td>
        <td>${esc(r.work_number) || '—'}</td>
        <td>${esc(r.ops_status) || '—'}</td>
        <td>${esc(r.pay_status) || '—'}</td>
      </tr>`).join('') : '';

    const outgoingRows = outgoing.length ? outgoing.map((r) => `
      <tr>
        <td><b>${esc(r.number) || 'б/н'}</b></td>
        <td>${r.date ? esc(String(r.date).slice(0, 10)) : '—'}</td>
        <td style="text-align:right">${esc(moneyRu(r.amount || 0))}</td>
        <td style="text-align:right">${esc(moneyRu(r.paid || 0))}</td>
        <td style="text-align:right;color:${r.overdue ? 'var(--red)' : 'inherit'}">
          ${esc(moneyRu(r.outstanding || 0))}</td>
        <td>${esc(r.status) || '—'}${r.overdue ? ' · просрочен' : ''}</td>
      </tr>`).join('') : '';

    const moreIn = docsTotal > incoming.length
      ? `<div class="help" style="margin-top:6px">Показаны ${incoming.length} из ${docsTotal}</div>`
      : '';

    return `
      <div class="cc-sec-title" style="margin-bottom:6px">Входящие счета (от контрагента)${
        docsTotal ? ` · ${docsTotal}` : ''
      }</div>
      ${incoming.length ? `<table class="cp-table"><thead><tr>
        <th>Номер</th><th>Дата</th><th style="text-align:right">Сумма</th><th>Работа</th><th>Статус</th><th>Оплата</th>
      </tr></thead><tbody>${incomingRows}</tbody></table>${moreIn}`
        : '<div class="help" style="padding:14px 0">Входящих счетов нет</div>'}

      <div class="cc-sec-title" style="margin:18px 0 6px">Исходящие счета (наши)</div>
      ${outgoing.length ? `<table class="cp-table"><thead><tr>
        <th>Номер</th><th>Дата</th><th style="text-align:right">Сумма</th>
        <th style="text-align:right">Оплачено</th><th style="text-align:right">Долг</th><th>Статус</th>
      </tr></thead><tbody>${outgoingRows}</tbody></table>`
        : '<div class="help" style="padding:14px 0">Исходящих счетов нет</div>'}`;
  }

  /** V475: вкладка «Письма» — вся переписка, ОБС помечены. */
  function lettersTabHtml(dash) {
    const letters = (dash && dash.letters_list) || [];
    if (!letters.length) return '<div class="help" style="padding:20px;text-align:center">Писем нет</div>';
    return `<table class="cp-table"><thead><tr>
      <th>Номер</th><th>Дата</th><th>Вид</th><th>Тема</th><th>Счёт</th><th>Статус</th>
    </tr></thead><tbody>
      ${letters.map((r) => `
        <tr>
          <td><b>${esc(r.number) || 'б/н'}</b></td>
          <td>${r.date ? esc(String(r.date).slice(0, 10)) : '—'}</td>
          <td>${r.is_obs ? '<span style="color:var(--amber);font-weight:600">ОБС</span>'
            : esc(r.letter_kind || r.doc_type || '—')}</td>
          <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(r.subject) || '—'}</td>
          <td>${esc(r.invoice_number) || '—'}</td>
          <td>${esc(r.status) || '—'}</td>
        </tr>`).join('')}
    </tbody></table>`;
  }

  /**
   * V475: вкладка «История» — хронология контрагента.
   *
   * Собирается на сервере из всех источников (тендеры, работы, договоры,
   * счета, письма). Отдельной таблицы истории нет — `customer_score_events`
   * на проде пуста.
   */
  function timelineTabHtml(dash) {
    const tl = (dash && dash.timeline) || [];
    if (!tl.length) return '<div class="help" style="padding:20px;text-align:center">Событий пока нет</div>';
    const icon = {
      contract: '📄', obs_contract: '🤝', doc_in: '📥', doc_out: '📤',
      letter: '✉️', work: '🏗', tender: '🎯',
    };
    return `<div class="cp-timeline">
      ${tl.map((t) => `
        <div class="cp-timeline__item">
          <div class="cp-timeline__date">${t.date ? esc(String(t.date).slice(0, 10)) : ''}</div>
          <div class="cp-timeline__body">
            <span class="cp-timeline__icon">${icon[t.kind] || '•'}</span>
            <span>${esc(t.title)}</span>
            ${t.amount != null ? `<b style="margin-left:6px">${esc(moneyRu(t.amount))}</b>` : ''}
            ${t.note ? `<span class="cp-timeline__note">${esc(t.note)}</span>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
  }

  function typeLabelRu(v) {
    const map = { customer: 'Заказчик', supplier: 'Поставщик', supply: 'Поставка', obs: 'ОБС' };
    return map[v] || (v || '—');
  }

  /**
   * Деньги для вкладок карточки контрагента.
   * `String(Math.round(x))` давал «455987» — читать неудобно, а сумма лимита
   * на экране директора должна читаться сразу. Формат — как в реестре.
   */
  function moneyRu(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (typeof AsgardMoney !== 'undefined' && AsgardMoney.formatMoney) {
      return AsgardMoney.formatMoney(n);
    }
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
  }

  async function renderCard({layout, title, query}={}){
    const auth = await AsgardAuth.requireUser();
    if (!auth) return;
    const innQ = normInn(query?.inn||'');
    const isNew = String(query?.new||'') === '1';

    let c = innQ ? await getCustomerByInn(innQ) : null;
    let dash = null;
    if (c && c.inn) {
      try { dash = await apiGet('/api/customers/' + encodeURIComponent(c.inn) + '/dashboard'); } catch (_) { dash = null; }
    }
    if (!c && (isNew || innQ)) {
      c = { inn: innQ, name:'', full_name:'', kpp:'', ogrn:'', address:'', phone:'', email:'', comment:'', contacts_json:'' };
    }
    const contacts = loadContacts(c);
    const roles = dash?.roles || dash?.kpi && null;
    const rl = roleLabel(dash?.roles || (c?.inn ? 'buyer' : 'buyer'));
    const rel = relationLabel(dash?.relation_status || 'none');
    const kpi = dash?.kpi || { contracts:0, tenders:0, works:0, docs:0 };

    const html = `
      <div class="cp-page">
        <div class="cp-actions">
          <a class="btn ghost" href="#/customers">К списку</a>
          <div class="spacer"></div>
          <button type="button" class="btn ghost" id="btnLookup">ЕГРЮЛ</button>
          <button type="button" class="btn" id="btnSave">Сохранить</button>
          ${c?.inn && !isNew ? '<button type="button" class="btn ghost" id="btnDel">Удалить</button>' : ''}
          ${dash?.supplier_id ? '<a class="btn ghost" href="#/suppliers-catalog">К поставщику</a>' : ''}
        </div>

        <section class="cp-hero">
          <p class="cp-hero__kicker">Контрагент</p>
          <h1 class="cp-hero__title" id="cpHeroTitle">${esc(c?.name || c?.full_name || (isNew ? 'Новый контрагент' : '—'))}</h1>
          <p class="cp-hero__sub" id="cpHeroSub">ИНН ${esc(c?.inn||'—')}${c?.kpp?' · КПП '+esc(c.kpp):''}${c?.ogrn?' · ОГРН '+esc(c.ogrn):''}</p>
          <div class="cp-hero__chips">
            <span class="cp-chip ${rl.cls}">${esc(rl.text)}</span>
            <span class="cp-chip ${rel.cls}">${esc(rel.text)}</span>
            ${riskChip(dash?.traffic_light)}
          </div>
        </section>

        <div class="cp-kpi">
          <div class="cp-kpi__item"><b>${kpi.contracts||0}</b><span>Договоры</span></div>
          <div class="cp-kpi__item"><b>${kpi.tenders||0}</b><span>Тендеры</span></div>
          <div class="cp-kpi__item"><b>${kpi.works||0}</b><span>Работы</span></div>
          <div class="cp-kpi__item"><b>${kpi.docs||0}</b><span>Счета</span></div>
          ${dash?.tenders?.won_sum != null ? '<div class="cp-kpi__item"><b>'+esc(String(Math.round(Number(dash.tenders.won_sum)||0)))+'</b><span>Выиграно ₽</span></div>' : ''}
          ${dash?.finance?.invoices_outstanding != null ? '<div class="cp-kpi__item"><b>'+esc(String(Math.round(Number(dash.finance.invoices_outstanding)||0)))+'</b><span>Дебиторка</span></div>' : ''}
        </div>

        <div class="cp-tabs" id="cpTabs">
          <button type="button" data-tab="profile" class="is-on">Профиль</button>
          <button type="button" data-tab="contacts">Контакты</button>
          <button type="button" data-tab="contracts">Договоры</button>
          <button type="button" data-tab="deals">Сделки</button>
          <button type="button" data-tab="docs">Счета</button>
          <button type="button" data-tab="letters">Письма</button>
          <button type="button" data-tab="history">История</button>
        </div>

        <div class="cp-panel" data-panel="profile">
          <div class="cp-grid">
            <div class="cp-field cp-span-2">
              <div class="cp-inn-row">
                <div class="cp-field" style="flex:1"><label>ИНН</label>
                  <input id="inn" value="${esc(c?.inn||'')}" ${c?.inn && !isNew ? 'disabled' : ''} placeholder="10/12 цифр"/>
                </div>
              </div>
            </div>
            <div class="cp-field cp-span-2"><label>Название (краткое)</label><input id="name" value="${esc(c?.name||'')}"/></div>
            <div class="cp-field cp-span-2"><label>Наименование полное</label><input id="full" value="${esc(c?.full_name||'')}"/></div>
            <div class="cp-field"><label>КПП</label><input id="kpp" value="${esc(c?.kpp||'')}"/></div>
            <div class="cp-field"><label>ОГРН</label><input id="ogrn" value="${esc(c?.ogrn||'')}"/></div>
            <div class="cp-field cp-span-2"><label>Адрес</label><input id="addr" value="${esc(c?.address||'')}"/></div>
            <div class="cp-field"><label>Телефон</label><input id="phone" value="${esc(c?.phone||'')}"/></div>
            <div class="cp-field"><label>Email</label><input id="email" value="${esc(c?.email||'')}"/></div>
            <div class="cp-field"><label>БИК</label><input id="bik" value="${esc(c?.bik||'')}"/></div>
            <div class="cp-field"><label>Р/с</label><input id="bank_account" value="${esc(c?.bank_account||'')}"/></div>
            <div class="cp-field cp-span-2"><label>Банк</label><input id="bank_name" value="${esc(c?.bank_name||'')}"/></div>
            <div class="cp-field cp-span-2"><label>Комментарий</label><input id="comment" value="${esc(c?.comment||c?.notes||'')}"/></div>
          </div>
        </div>

        <div class="cp-panel" data-panel="contacts" hidden>
          <div id="contactsBox">${contactsTemplate(contacts)}</div>
          <div style="margin-top:12px"><button type="button" class="btn ghost" id="btnAddContact">Добавить контакт</button></div>
        </div>

        <div class="cp-panel" data-panel="contracts" hidden>
          <div id="cpContracts">${contractsTabHtml(dash)}</div>
        </div>

        <div class="cp-panel" data-panel="deals" hidden>
          <table class="cp-table"><thead><tr><th>Статус</th><th>Кол-во</th><th>Сумма</th></tr></thead>
          <tbody>
            ${(dash?.tenders?.by_status||[]).map((s)=>'<tr><td>'+esc(s.tender_status||'')+'</td><td>'+(+s.cnt||0)+'</td><td>'+esc(String(Math.round(+s.sum||0)))+'</td></tr>').join('')
              || '<tr><td colspan="3">Тендеров пока нет</td></tr>'}
          </tbody></table>
          <p class="help" style="margin-top:12px">Работы: ${(dash?.works?.total||0)} (активных ${(dash?.works?.active||0)})</p>
        </div>

        <div class="cp-panel" data-panel="docs" hidden>
          ${docsTabHtml(dash)}
        </div>

        <div class="cp-panel" data-panel="letters" hidden>
          ${lettersTabHtml(dash)}
        </div>

        <div class="cp-panel" data-panel="history" hidden id="cpHistory">
          ${timelineTabHtml(dash)}
        </div>
      </div>`;

    await layout('<div class="content">'+html+'</div>', { title: title||'Карточка контрагента', motto: 'Храни имена и печати.' });

    $$('#cpTabs button').forEach((b)=>{
      b.addEventListener('click', ()=>{
        const tab = b.getAttribute('data-tab');
        $$('#cpTabs button').forEach((x)=>x.classList.toggle('is-on', x===b));
        $$('[data-panel]').forEach((p)=>{ p.hidden = p.getAttribute('data-panel') !== tab; });
      });
    });

    // V475: договор в карточке открывает свою карточку (счета, письма, акты).
    $$('[data-contract-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-contract-id');
        const kind = row.getAttribute('data-contract-kind') || 'contract';
        if (window.AsgardContractsPage && AsgardContractsPage.openContractCard) {
          AsgardContractsPage.openContractCard(kind, id);
        }
      });
    });

    function buildCustomerRec(){
      const payload = contactsToPayload(contacts);
      const primary = payload.find((x)=>x.is_primary) || payload[0] || null;
      const companyPhone = ($('#phone').value || '').trim();
      return {
        inn: normInn($('#inn').value),
        name: $('#name').value,
        full_name: $('#full').value,
        kpp: $('#kpp').value,
        ogrn: $('#ogrn').value,
        address: $('#addr').value,
        phone: (primary && primary.phone) ? primary.phone : companyPhone,
        email: $('#email').value,
        bik: $('#bik')?.value || '',
        bank_account: $('#bank_account')?.value || '',
        bank_name: $('#bank_name')?.value || '',
        comment: $('#comment').value,
        notes: $('#comment').value,
        contacts: payload,
        contact_person: primary ? [primary.name, primary.position].filter(Boolean).join(' · ') : ''
      };
    }

    async function saveCustomerContacts(msg){
      const rec = buildCustomerRec();
      if (!rec.inn || (rec.inn.length !== 10 && rec.inn.length !== 12)) {
        toast('Контакт','Сначала укажите корректный ИНН','warn'); return false;
      }
      if (!rec.name && !rec.full_name) {
        toast('Контакт','Сначала укажите название организации','warn'); return false;
      }
      await upsertCustomer(rec);
      if (msg) toast('Контакт', msg, 'ok');
      return true;
    }

    function refreshContactsBox(){
      $('#contactsBox').innerHTML = contactsTemplate(contacts);
      $$('[data-edit-contact]').forEach((b)=>{
        b.addEventListener('click', ()=>{
          const i = Number(b.getAttribute('data-edit-contact'));
          if (i<0 || i>=contacts.length) return;
          openContactModal({
            title: 'Редактировать контакт',
            contact: contacts[i],
            onSave: async (obj)=>{
              contacts[i] = obj;
              if (obj.is_primary) contacts.forEach((c,j)=>{ c.is_primary = j===i; });
              else if (!contacts.some((c)=>c.is_primary)) contacts[0].is_primary = true;
              refreshContactsBox();
              await saveCustomerContacts('Контакт обновлён');
            }
          });
        });
      });
      $$('[data-del-contact]').forEach((b)=>{
        b.addEventListener('click', ()=>{
          const i = Number(b.getAttribute('data-del-contact'));
          if (i<0 || i>=contacts.length) return;
          const name = contacts[i].name || '';
          showModal({
            title: 'Удалить контакт?',
            html: `<div class="cp-modal"><p class="cp-modal__warn">Удалить контакт «${esc(name)}»?</p>
              <div class="cp-modal__foot">
                <button type="button" class="btn ghost" id="d_cancel">Отмена</button>
                <button type="button" class="btn red" id="d_ok">Удалить</button>
              </div></div>`,
            onMount: ({back})=>{
              $('#d_cancel',back).onclick = ()=>AsgardUI.hideModal();
              $('#d_ok',back).onclick = async ()=>{
                contacts.splice(i,1);
                refreshContactsBox();
                AsgardUI.hideModal();
                try { await saveCustomerContacts('Контакт удалён'); } catch(e) {
                  toast('Контакт', e.message||'Не удалось удалить','err');
                }
              };
            }
          });
        });
      });
    }
    refreshContactsBox();

    $('#btnAddContact').addEventListener('click', ()=>{
      openContactModal({
        title: 'Добавить контакт',
        isFirst: contacts.length === 0,
        onSave: async (obj)=>{
          if (obj.is_primary) contacts.forEach((c)=>{ c.is_primary = false; });
          contacts.push(obj);
          if (!contacts.some((c)=>c.is_primary)) contacts[0].is_primary = true;
          refreshContactsBox();
          await saveCustomerContacts('Контакт добавлен');
        }
      });
    });

    const btnLookup = $('#btnLookup');
    btnLookup.addEventListener('click', async ()=>{
      const inn = normInn($('#inn').value);
      if (inn.length !== 10 && inn.length !== 12) {
        toast('Поиск','ИНН должен быть 10 или 12 цифр','err'); return;
      }
      btnLookup.disabled = true;
      const prev = btnLookup.textContent;
      btnLookup.textContent = 'Загрузка…';
      try {
        const result = await lookupByInn(inn);
        if (result.found && result.suggestion) {
          const s = result.suggestion;
          if (s.name) $('#name').value = s.name;
          if (s.full_name) $('#full').value = s.full_name;
          if (s.kpp) $('#kpp').value = s.kpp;
          if (s.ogrn) $('#ogrn').value = s.ogrn;
          if (s.address) $('#addr').value = s.address;
          $('#cpHeroTitle').textContent = s.name || $('#cpHeroTitle').textContent;
          toast('ЕГРЮЛ','Данные обновлены из реестра','ok');
        } else {
          toast('ЕГРЮЛ', result.message || 'Организация не найдена','warn');
        }
      } catch(e) {
        toast('ЕГРЮЛ', e.message||'Ошибка','err');
      } finally {
        btnLookup.disabled = false;
        btnLookup.textContent = prev;
      }
    });

    $('#btnSave').addEventListener('click', async ()=>{
      try {
        const rec = buildCustomerRec();
        if (!rec.name && !rec.full_name) throw new Error('Укажите название организации');
        const inn = await upsertCustomer(rec);
        toast('Контрагент','Сохранено');
        location.hash = '#/customer?inn='+encodeURIComponent(inn);
      } catch(e) { toast('Контрагент', e.message||'Ошибка', 'err'); }
    });

    const btnDel = $('#btnDel');
    if (btnDel) {
      btnDel.addEventListener('click', ()=>{
        showModal({
          title: 'Удалить контрагента?',
          html: `<div class="cp-modal"><p class="cp-modal__warn">Удалить ${esc(c?.inn||'')} ${esc(c?.name||'')}?</p>
            <div class="cp-modal__foot">
              <button type="button" class="btn ghost" id="d_cancel">Отмена</button>
              <button type="button" class="btn red" id="d_ok">Удалить</button>
            </div></div>`,
          onMount: ({back})=>{
            $('#d_cancel',back).onclick = ()=>AsgardUI.hideModal();
            $('#d_ok',back).onclick = async ()=>{
              await AsgardDB.del('customers', c.inn);
              AsgardUI.hideModal();
              toast('Контрагент','Удалено');
              location.hash = '#/customers';
            };
          }
        });
      });
    }

    // Чек-листы анализа — ДОПОЛНИТЕЛЬНЫЙ блок внизу «Истории».
    // Раньше этот код перезаписывал вкладку целиком (`box.innerHTML = ...`),
    // и хронология контрагента исчезала, как только приходил ответ чек-листов.
    // Теперь дописываем отдельной секцией: хронология остаётся на месте.
    if (c?.inn) {
      apiGet('/api/customers/' + encodeURIComponent(c.inn) + '/analysis-checklists')
        .then((d)=>{
          const items = d.items || d.checklists || d.rows || [];
          const box = $('#cpHistory');
          if (!box || !items.length) return;
          const rowsHtml = '<table class="cp-table"><thead><tr><th>Дата</th><th>Тендер / работа</th><th>Статус</th></tr></thead><tbody>' +
            items.slice(0,30).map((x)=>'<tr><td>'+esc(String(x.created_at||x.updated_at||'').slice(0,10))+'</td><td>'+esc(x.tender_title||x.work_title||x.title||'—')+'</td><td>'+esc(x.status||'')+'</td></tr>').join('') +
            '</tbody></table>';
          box.insertAdjacentHTML('beforeend',
            '<div class="cc-sec-title" style="margin:20px 0 6px">Чек-листы анализа</div>' + rowsHtml);
        })
        .catch(()=>{ /* чек-листы необязательны: хронология уже отрисована */ });
    }
  }

  return { renderList, renderCard, upsertCustomer, getCustomerByInn, lookupByInn };
})();
