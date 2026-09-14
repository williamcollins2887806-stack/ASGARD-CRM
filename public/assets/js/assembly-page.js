window.AsgardAssemblyPage = (function() {
  const UI = window.AsgardUI || {};
  const esc = UI.esc || (s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const toast = UI.toast || ((t,m,tp) => console.log(`[${tp}] ${t}: ${m}`));
  const showModal = UI.showModal || (() => {});
  const closeModal = UI.closeModal || (() => {});

  let _user = null, _tableEl = null;
  const STATUSES = {draft:'Черновик',confirmed:'Подтверждена',packing:'Сборка',packed:'Собрано',in_transit:'В пути',received:'Принято',returned:'Возвращено',closed:'Закрыта'};
  const TYPE_LABELS = {mobilization:'🚛 Мобилизация',demobilization:'🏠 Демобилизация',transfer:'↔️ Перемещение'};

  function hdr(){const t=localStorage.getItem('asgard_token')||localStorage.getItem('auth_token');return{'Authorization':'Bearer '+t,'Content-Type':'application/json'};}
  async function apiFetch(url,o={}){const r=await fetch(url,{headers:hdr(),...o});return r.json();}
  async function apiPut(u,b){return apiFetch(u,{method:'PUT',body:JSON.stringify(b||{})});}
  async function apiPost(u,b){return apiFetch(u,{method:'POST',body:JSON.stringify(b||{})});}
  const dt=d=>d?new Date(d).toLocaleDateString('ru-RU'):'—';
  const dtF=d=>d?new Date(d).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
  const badge=s=>`<span class="asm-status asm-status--${(s||'').replace(/_/g,'-')}">${STATUSES[s]||s}</span>`;
  /** Демо/E2E-заголовки сборок → «Сборка #id» + объект при наличии. */
  function humanAsmTitle(a) {
    if (!a) return 'Сборка';
    const raw = String(a.work_title || a.title || a.name || '').trim();
    const id = a.id != null ? a.id : '';
    const obj = String(a.destination || a.object_name || '').trim();
    if (/FULL-BIZ|E2E|Монтаж\s*тест|STORY\s*wave|WAVE\s*partial|\d{10,}/i.test(raw) || !raw) {
      const base = id !== '' ? ('Сборка #' + id) : 'Сборка';
      return obj ? (base + ' · ' + obj) : base;
    }
    return raw;
  }

  function renderFilters(el){
    el.innerHTML=`<div class="asm-toolbar">
      <div id="af-type_w" style="display:inline-block"></div>
      <div id="af-status_w" style="display:inline-block"></div>
    </div>`;
    el.querySelector('#af-type_w').appendChild(CRSelect.create({ id: 'af-type', options: [
      { value: '', label: 'Все типы' }, { value: 'mobilization', label: 'Мобилизация' }, { value: 'demobilization', label: 'Демобилизация' }
    ], onChange: v => { _filters.type = v; refresh(); } }));
    el.querySelector('#af-status_w').appendChild(CRSelect.create({ id: 'af-status', options: [
      { value: '', label: 'Все статусы' }, ...Object.entries(STATUSES).map(([k,v]) => ({ value: k, label: v }))
    ], onChange: v => { _filters.status = v; refresh(); } }));
  }

  let _filters={};
  async function refresh(){
    const params=new URLSearchParams();
    Object.entries(_filters).forEach(([k,v])=>{if(v)params.append(k,v);});
    const d=await apiFetch('/api/assembly?'+params.toString());
    renderCards(d.items||[],_tableEl);
  }

  function renderCards(items,el){
    if(!items.length){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--t2)">Очередь пуста — нет сборок к комплектации</div>';return;}
    el.innerHTML=`<div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:13px;color:var(--t2)">Что собрать · для кого</div>
      <button type="button" class="btn primary" id="asm-q-refresh">Обновить очередь</button>
    </div>
      <div class="asm-queue">${items.map(a=>{
      const pct=a.items_count>0?Math.round((a.packed_count/a.items_count)*100):0;
      const who=a.pm_name||a.creator_name||'—';
      return `<div class="asm-queue__card" data-id="${a.id}">
        <div class="asm-queue__top">
          <div>
            <div class="asm-queue__who">${esc(humanAsmTitle(a))}</div>
            <div class="asm-queue__meta">Для: <b>${esc(who)}</b> · ${TYPE_LABELS[a.type]||a.type} · ${a.items_count||0} поз.${a.planned_date?' · план '+dt(a.planned_date):''}${a.destination?' · → '+esc(a.destination):''}</div>
          </div>
          <div style="text-align:right">
            ${badge(a.status)}
            <div class="asm-queue__pct" style="margin-top:6px">${pct}%</div>
          </div>
        </div>
        <div class="asm-queue__bar"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join('')}</div>`;
    const ref=el.querySelector('#asm-q-refresh');
    if(ref) ref.onclick=()=>refresh();
    el.querySelectorAll('.asm-queue__card[data-id]').forEach(c=>c.onclick=()=>openDetail(+c.dataset.id));
  }

  async function openDetail(id){
    const d=await apiFetch(`/api/assembly/${id}`);
    if(!d.item){toast('Ошибка','Не найдена','err');return;}
    const a=d.item,items=d.items||[],pallets=d.pallets||[];
    const isDemob=a.type==='demobilization';
    const canPack=['confirmed','packing'].includes(a.status)&&
      ['PM','HEAD_PM','WAREHOUSE','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(_user.role);
    const canEdit=['draft','confirmed','packing'].includes(a.status);
    const pct=items.length?Math.round(items.filter(i=>i.packed).length/items.length*100):0;

    let html=`<div class="asm-detail">
      <div class="asm-detail__header" style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--t2);font-weight:600;margin-bottom:4px">Сборка для работы</div>
          <h2 style="margin:0;font-size:20px;letter-spacing:-.02em">${esc(humanAsmTitle(a))}</h2>
          <div style="margin-top:6px;font-size:13px;color:var(--t2)">${TYPE_LABELS[a.type]||a.type} · РП: ${esc(a.creator_name||'—')}</div>
        </div>
        ${badge(a.status)}
      </div>
      <dl class="asm-detail__meta" style="margin-top:14px">
        <dt>Объект</dt><dd>${esc(a.destination||a.object_name||'—')}</dd>
        <dt>Создано</dt><dd>${dtF(a.created_at)}</dd>
        ${a.planned_date?`<dt>План</dt><dd>${dt(a.planned_date)}</dd>`:''}
        ${a.actual_sent_at?`<dt>Отправлено</dt><dd>${dtF(a.actual_sent_at)}</dd>`:''}
      </dl>
      <div class="asm-progress" style="margin:14px 0 8px"><div class="asm-progress__bar" style="width:${pct}%"></div></div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:16px">Собрано ${items.filter(i=>i.packed).length} из ${items.length} · ${pct}%</div>`;

    // ── Compact summary + Visual Pallet Builder mount ──
    html += `<div class="asm-detail__section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:600;font-size:14px">Позиции и паллеты</span>
        <div style="display:flex;gap:14px;font-size:12px;color:var(--t2)">
          <span>📦 ${items.filter(i=>i.packed).length}/${items.length} собрано</span>
          <span>🏷️ ${items.filter(i=>i.pallet_id).length} распределено</span>
        </div>
      </div>
      ${canEdit ? '<button class="btn primary" id="asm-add-item" style="font-size:12px;margin-bottom:12px">+ Добавить позицию вручную</button>' : ''}
      <div id="asm-dnd-mount"></div>
    </div>`;

    // Кнопки
    html+=`<div class="asm-detail__actions">`;
    if(a.status==='draft'&&[...['PM','HEAD_PM'],...['ADMIN','DIRECTOR_GEN']].includes(_user.role))
      html+=`<button class="btn primary" id="asm-confirm">✅ Подтвердить</button>`;
    if(['confirmed','packing','packed'].includes(a.status)&&[...['PM','HEAD_PM'],...['WAREHOUSE','ADMIN']].includes(_user.role))
      html+=`<button class="btn primary" id="asm-send">🚛 Отправить</button>`;
    if(a.type==='mobilization'&&!['draft'].includes(a.status))
      html+=`<button class="btn ghost" id="asm-demob">🏠 Создать демоб</button>`;
    if(a.type==='demobilization'&&['in_transit','received'].includes(a.status)&&['WAREHOUSE','ADMIN'].includes(_user.role))
      html+=`<button class="btn primary" id="asm-receive-all">📦 Принять на склад</button>`;
    if(a.type==='mobilization'&&['in_transit','packed','received'].includes(a.status)&&['WAREHOUSE','ADMIN','PM','HEAD_PM'].includes(_user.role))
      html+=`<button class="btn ghost" id="asm-site-bulk">📋 Отметить получение списком (ОПО)</button>`;
    if(canEdit&&['confirmed','packing','packed','draft'].includes(a.status)&&['PM','HEAD_PM','WAREHOUSE','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'].includes(_user.role))
      html+=`<button class="btn ghost" id="asm-change-order">✏️ Изменение состава</button>`;
    html+=`<button type="button" class="btn ghost" data-asm-pdf="/api/assembly/${a.id}/checklist-pdf">Чек-лист / упак. лист</button>`;
    html+=`<a href="/api/assembly/${a.id}/export-excel" target="_blank" class="btn ghost">Excel</a>`;
    if(pallets.length){
      pallets.slice(0,8).forEach(p=>{
        html+=`<button type="button" class="btn ghost" data-asm-pdf="/api/assembly/${a.id}/pallets/${p.id}/label-pdf" title="Бирка паллета">Бирка #${p.id}</button>`;
      });
    }
    if(a.type==='demobilization'&&['received','in_transit'].includes(a.status)&&['WAREHOUSE','ADMIN','PM','HEAD_PM'].includes(_user.role))
      html+=`<button class="btn ghost" id="asm-reconcile">Сверка демоб (variance)</button>`;
    html+=`</div>
      <div id="asm-live-bar" style="margin-top:12px;font-size:12px;color:var(--t2)">Онлайн: обновление…</div>
    </div>`;

    showModal({title:`Ведомость #${a.id}`,html:html});

    document.querySelectorAll('[data-asm-pdf]').forEach(btn=>{
      btn.onclick=async()=>{
        try{
          const r=await fetch(btn.getAttribute('data-asm-pdf'),{headers:hdr()});
          if(!r.ok) throw new Error('HTTP '+r.status);
          const blob=await r.blob();
          const u=URL.createObjectURL(blob);
          window.open(u,'_blank','noopener');
          setTimeout(()=>URL.revokeObjectURL(u),120000);
        }catch(e){toast('PDF',e.message||'Не удалось открыть','err');}
      };
    });

    // live poll
    if(window.__asmLiveTimer) clearInterval(window.__asmLiveTimer);
    async function tickLive(){
      const bar=document.getElementById('asm-live-bar');
      if(!bar){clearInterval(window.__asmLiveTimer);return;}
      try{
        const live=await apiFetch(`/api/assembly/${a.id}/live`);
        const packed=live.packed_count!=null?live.packed_count:(live.packed||0);
        const total=live.total_count!=null?live.total_count:(live.total||items.length);
        const lp=total?Math.round(100*packed/total):0;
        bar.textContent=`Онлайн: собрано ${packed} из ${total} (${lp}%) · обновлено ${new Date().toLocaleTimeString('ru-RU')}`;
        const prog=document.querySelector('.asm-progress__bar');
        if(prog) prog.style.width=lp+'%';
      }catch(_){ bar.textContent='Онлайн: нет данных'; }
    }
    tickLive();
    window.__asmLiveTimer=setInterval(tickLive,5000);

    // ── Init Visual Pallet Builder (WOW Edition) ──
    setTimeout(() => {
      const mount = document.getElementById('asm-dnd-mount');
      if (mount && window.AsgardAssemblyDnD) {
        AsgardAssemblyDnD.init(mount, {
          assemblyId: a.id,
          items: items,
          pallets: pallets,
          canEdit: canPack,
          isDemob: isDemob,
          onUpdate: () => {}
        });
      }
    }, 80);

    const confirmBtn=document.getElementById('asm-confirm');
    if(confirmBtn)confirmBtn.onclick=async()=>{await apiPut(`/api/assembly/${a.id}/confirm`,{});toast('Подтверждено','','ok');openDetail(a.id);};
    const sendBtn=document.getElementById('asm-send');
    if(sendBtn)sendBtn.onclick=async()=>{const r=await apiPut(`/api/assembly/${a.id}/send`,{});if(r.error){toast('Ошибка',r.error,'err');return;}toast('Отправлено','','ok');openDetail(a.id);};
    const reconcileBtn=document.getElementById('asm-reconcile');
    if(reconcileBtn)reconcileBtn.onclick=async()=>{
      try{
        const r=await apiPost(`/api/assembly/${a.id}/reconcile`,{});
        const lost=r.lost||r.missing||[];
        const ok=r.received||r.ok||[];
        const still=r.still_on_site||r.on_site||[];
        showModal({title:'Сверка демоб',html:`<div class="proc-pay-modal" style="max-width:520px">
          <div class="proc-pay-modal__section"><div class="proc-pay-modal__section-title">Приехало</div><div>${(ok.length||r.received_count||0)} поз.</div></div>
          <div class="proc-pay-modal__section"><div class="proc-pay-modal__section-title">Утрачено / не найдено</div><div>${Array.isArray(lost)?lost.map(x=>esc(x.name||x)).join('<br>')||'—':esc(String(lost))}</div></div>
          <div class="proc-pay-modal__section"><div class="proc-pay-modal__section-title">Ещё на объекте</div><div>${Array.isArray(still)?still.map(x=>esc(x.name||x)).join('<br>')||'—':esc(String(still))}</div></div>
          <pre style="font-size:11px;color:var(--t3);max-height:160px;overflow:auto">${esc(JSON.stringify(r,null,2).slice(0,2000))}</pre>
        </div>`});
      }catch(e){toast('Ошибка',e.message,'err');}
    };
    const demobBtn=document.getElementById('asm-demob');
    if(demobBtn)demobBtn.onclick=async()=>{const r=await apiPost(`/api/assembly/${a.id}/create-demob`,{});if(r.error){toast('Ошибка',r.error,'err');return;}toast('Демоб создана','','ok');openDetail(r.item.id);};

    const receiveBtn=document.getElementById('asm-receive-all');
    if(receiveBtn)receiveBtn.onclick=async()=>{
      // return_status уже установлен через Visual Pallet Builder (badge popup)
      const r=await apiPut(`/api/assembly/${a.id}/receive-all`,{});
      if(r.error){toast('Ошибка',r.error,'err');return;}
      toast('Принято',`${r.returned} возвр., ${r.written_off} спис.`,'ok');closeModal();refresh();
    };

    const siteBulk=document.getElementById('asm-site-bulk');
    if(siteBulk)siteBulk.onclick=()=>openSiteReceiptBulk(a.id, items);

    const coBtn=document.getElementById('asm-change-order');
    if(coBtn)coBtn.onclick=()=>openChangeOrder(a.id, items);

    const addItemBtn=document.getElementById('asm-add-item');
    if(addItemBtn)addItemBtn.onclick=()=>openAddItemDialog(a.id);
    // Паллеты, drag-drop, return_status — всё внутри AsgardAssemblyDnD
  }

  function openSiteReceiptBulk(asmId, items){
    const pending=(items||[]).filter(i=>!i.received);
    const html=`<div style="min-width:340px;max-width:520px">
      <div style="font-size:13px;color:var(--t2);margin-bottom:10px">ОПО без телефона — отметьте позиции, фактически принятые на объекте.</div>
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button class="btn ghost" id="asm-sr-all" style="font-size:12px">Выбрать все</button>
        <button class="btn ghost" id="asm-sr-none" style="font-size:12px">Снять все</button>
      </div>
      <div style="max-height:320px;overflow:auto;border:1px solid var(--border,#262c38);border-radius:10px;padding:8px 10px">
        ${(items||[]).length? (items||[]).map(it=>`<label style="display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--border,#1e2430);font-size:13px">
          <input type="checkbox" data-sri="${it.id}" ${it.received?'disabled':(pending.length?'checked':'')}>
          <span>${esc(it.name||'')} · ${it.quantity||1} ${esc(it.unit||'шт')}${it.received?' <span style="color:var(--ok-t,#30d158)">✓ получено</span>':''}</span>
        </label>`).join('') : '<div style="padding:20px;color:var(--t2);text-align:center">Нет позиций</div>'}
      </div>
      <button class="btn primary" id="asm-sr-go" style="margin-top:12px;width:100%">Отметить выбранные</button>
    </div>`;
    showModal({title:'📋 ОПО — получение списком',html});
    document.getElementById('asm-sr-all').onclick=()=>document.querySelectorAll('[data-sri]:not(:disabled)').forEach(c=>{c.checked=true;});
    document.getElementById('asm-sr-none').onclick=()=>document.querySelectorAll('[data-sri]:not(:disabled)').forEach(c=>{c.checked=false;});
    document.getElementById('asm-sr-go').onclick=async()=>{
      const ids=[...document.querySelectorAll('[data-sri]:checked')].map(c=>+c.dataset.sri);
      if(!ids.length){toast('Внимание','Ничего не выбрано','warn');return;}
      const r=await apiPost(`/api/assembly/${asmId}/site-receipt-bulk`,{item_ids:ids,note:'ОПО без телефона'});
      if(r.error){toast('Ошибка',r.error,'err');return;}
      toast('Получение','Отмечено позиций: '+(r.updated||0),'ok');
      closeModal();openDetail(asmId);
    };
  }

  function openChangeOrder(asmId, items){
    const html=`<div style="min-width:360px;max-width:560px;display:flex;flex-direction:column;gap:12px">
      <div style="font-size:13px;color:var(--t2)">Корзина уже создала сборку. Здесь — дозаказ / снятие позиции после submit (change-order).</div>
      <div style="border:1px solid var(--border,#262c38);border-radius:10px;padding:8px 10px;max-height:220px;overflow:auto">
        ${(items||[]).length?(items||[]).map(it=>`<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border,#1e2430);font-size:13px">
          <div style="flex:1;min-width:0">${esc(it.name||'')} · ${it.quantity||1} ${esc(it.unit||'шт')}
            <div style="font-size:11px;color:var(--t2)">${esc(it.source||'')} · ${esc(it.line_status||'')}${it.packed?' · на паллете':''}</div>
          </div>
          <button class="btn ghost" data-co-rm="${it.id}" style="font-size:12px;padding:4px 8px">${it.packed||it.pallet_id?'↩ Unpick':'Убрать'}</button>
        </div>`).join(''):'<div style="padding:12px;color:var(--t2)">Позиций нет</div>'}
      </div>
      <div style="font-weight:600;font-size:13px">Добавить</div>
      <input id="asm-co-name" placeholder="Наименование" style="padding:10px 12px;border-radius:10px;border:1px solid var(--border,#262c38);background:var(--bg-input,#10141b);color:var(--t1,#e6e9ef)">
      <div style="display:flex;gap:8px">
        <input id="asm-co-qty" type="number" value="1" min="0" step="any" style="flex:1;padding:10px 12px;border-radius:10px;border:1px solid var(--border,#262c38);background:var(--bg-input,#10141b);color:var(--t1,#e6e9ef)">
        <select id="asm-co-act" style="flex:1;padding:10px 12px;border-radius:10px;border:1px solid var(--border,#262c38);background:var(--bg-input,#10141b);color:var(--t1,#e6e9ef)">
          <option value="add_stock">Со склада (add_stock)</option>
          <option value="procure">В закупку (procure)</option>
        </select>
      </div>
      <button class="btn primary" id="asm-co-add">Добавить позицию</button>
      <button class="btn ghost" id="asm-co-back">← К ведомости</button>
    </div>`;
    showModal({title:`Изменение состава · #${asmId}`,html});
    document.querySelectorAll('[data-co-rm]').forEach(b=>b.onclick=async()=>{
      const r=await apiPost(`/api/assembly/${asmId}/change-order`,{action:'remove',item_id:+b.dataset.coRm});
      if(r.error){toast('Ошибка',r.error,'err');return;}
      toast(r.unpick_requested?'Unpick':'Удалено',r.unpick_requested?'В очереди склада':'','ok');
      openChangeOrder(asmId, (await apiFetch(`/api/assembly/${asmId}`)).items||[]);
    });
    document.getElementById('asm-co-add').onclick=async()=>{
      const name=(document.getElementById('asm-co-name').value||'').trim();
      if(!name){toast('Внимание','Укажите наименование','warn');return;}
      const action=document.getElementById('asm-co-act').value;
      const quantity=parseFloat(document.getElementById('asm-co-qty').value)||1;
      const r=await apiPost(`/api/assembly/${asmId}/change-order`,{action,name,quantity});
      if(r.error){toast('Ошибка',r.error,'err');return;}
      toast('Добавлено','','ok');
      openChangeOrder(asmId, (await apiFetch(`/api/assembly/${asmId}`)).items||[]);
    };
    document.getElementById('asm-co-back').onclick=()=>{closeModal();openDetail(asmId);};
  }

  // Быстрое добавление позиции с автокомплитом каталога (вместо prompt)
  function openAddItemDialog(asmId){
    const html=`<div style="display:flex;flex-direction:column;gap:12px;min-width:340px">
      <div style="position:relative">
        <input id="asm-ai-name" placeholder="Наименование (поиск по каталогу)…" autocomplete="off"
          style="width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--border,#262c38);background:var(--bg-input,#10141b);color:var(--t1,#e6e9ef);outline:none">
        <div id="asm-ai-sug" style="position:absolute;left:0;right:0;top:46px;z-index:5;background:var(--bg-card,#161a22);border:1px solid var(--border,#262c38);border-radius:10px;max-height:220px;overflow:auto;display:none"></div>
      </div>
      <div style="display:flex;gap:10px">
        <input id="asm-ai-qty" type="number" value="1" min="0" step="any" placeholder="Кол-во" style="flex:1;padding:11px 12px;border-radius:10px;border:1px solid var(--border,#262c38);background:var(--bg-input,#10141b);color:var(--t1,#e6e9ef)">
        <input id="asm-ai-unit" value="шт" placeholder="Ед." style="width:90px;padding:11px 12px;border-radius:10px;border:1px solid var(--border,#262c38);background:var(--bg-input,#10141b);color:var(--t1,#e6e9ef)">
      </div>
      <select id="asm-ai-src" style="padding:11px 12px;border-radius:10px;border:1px solid var(--border,#262c38);background:var(--bg-input,#10141b);color:var(--t1,#e6e9ef)">
        <option value="from_warehouse">Со склада</option>
        <option value="on_site_purchase">Куплено на объекте</option>
        <option value="manual">Вручную / прочее</option>
      </select>
      <button class="btn primary" id="asm-ai-save" style="padding:11px">Добавить</button>
    </div>`;
    showModal({title:'➕ Позиция',html});
    let selectedPid=null,deb;
    const nameEl=document.getElementById('asm-ai-name');
    const sugEl=document.getElementById('asm-ai-sug');
    nameEl.oninput=()=>{
      selectedPid=null;const q=nameEl.value.trim();
      clearTimeout(deb);
      if(q.length<2){sugEl.style.display='none';return;}
      deb=setTimeout(async()=>{
        try{
          const d=await apiFetch('/api/products/search?q='+encodeURIComponent(q));
          const items=d.items||[];
          if(!items.length){sugEl.style.display='none';return;}
          sugEl.innerHTML=items.map(it=>`<div class="asm-ai-opt" data-pid="${it.id}" data-name="${esc(it.name)}" data-unit="${esc(it.unit||'шт')}"
            style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border,#1e2430)">
            <div style="font-size:13px">${esc(it.name)}</div>
            <div style="font-size:11px;color:var(--t2,#8b93a3)">${esc(it.category_name||'')}${it.article?' • '+esc(it.article):''}</div></div>`).join('');
          sugEl.style.display='block';
          sugEl.querySelectorAll('.asm-ai-opt').forEach(o=>o.onclick=()=>{
            selectedPid=+o.dataset.pid;nameEl.value=o.dataset.name;
            document.getElementById('asm-ai-unit').value=o.dataset.unit;sugEl.style.display='none';
          });
        }catch(_){sugEl.style.display='none';}
      },280);
    };
    document.getElementById('asm-ai-save').onclick=async()=>{
      const name=nameEl.value.trim();if(!name){toast('Внимание','Введите наименование','warn');return;}
      const body={name,quantity:parseFloat(document.getElementById('asm-ai-qty').value)||1,
        unit:document.getElementById('asm-ai-unit').value.trim()||'шт',
        source:document.getElementById('asm-ai-src').value,product_id:selectedPid||undefined};
      try{const r=await apiPost(`/api/assembly/${asmId}/items/quick`,body);
        if(r.error){toast('Ошибка',r.error,'err');return;}
        toast('Добавлено','','ok');closeModal();openDetail(asmId);
      }catch(e){toast('Ошибка',e.message,'err');}
    };
  }

  async function render({layout,title}){
    const ud=await apiFetch('/api/users/me');_user=ud.user||ud;_filters={};
    await layout('', { title: title || 'Сбор' });
    const layoutEl=document.getElementById('layout');
    layoutEl.innerHTML='';const page=document.createElement('div');page.className='asm-page';
    const filtEl=document.createElement('div');_tableEl=document.createElement('div');
    page.append(filtEl,_tableEl);layoutEl.appendChild(page);
    renderFilters(filtEl);await refresh();
  }

  return {render};
})();
