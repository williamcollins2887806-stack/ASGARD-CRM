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
    if(!items.length){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--t2)">Ведомостей нет</div>';return;}
    el.innerHTML=`<div class="asm-cards">${items.map(a=>{
      const pct=a.items_count>0?Math.round((a.packed_count/a.items_count)*100):0;
      return `<div class="asm-card" data-id="${a.id}">
        <div class="asm-card__header"><span class="asm-card__title">${esc(a.title||TYPE_LABELS[a.type]||'')}</span>${badge(a.status)}</div>
        <div class="asm-card__meta">${TYPE_LABELS[a.type]||a.type} • ${esc(a.work_title||'')} • ${a.items_count||0} поз. • ${a.pallets_count||0} мест</div>
        <div class="asm-card__meta">${a.destination?'→ '+esc(a.destination):''} ${a.planned_date?'• План: '+dt(a.planned_date):''}</div>
        <div class="asm-card__progress"><div class="asm-progress"><div class="asm-progress__bar" style="width:${pct}%"></div></div>
          <span style="font-size:11px;color:var(--t2)">${pct}% собрано</span></div>
      </div>`;
    }).join('')}</div>`;
    el.querySelectorAll('.asm-card[data-id]').forEach(c=>c.onclick=()=>openDetail(+c.dataset.id));
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
      <div class="asm-detail__header"><div><h2 style="margin:0">${esc(a.title||'#'+a.id)}</h2>${badge(a.status)}</div>
        <span>${TYPE_LABELS[a.type]||a.type}</span></div>
      <dl class="asm-detail__meta">
        <dt>Работа</dt><dd>${esc(a.work_title||'—')}</dd>
        <dt>Объект</dt><dd>${esc(a.destination||a.object_name||'—')}</dd>
        <dt>Создал</dt><dd>${esc(a.creator_name||'')} ${dtF(a.created_at)}</dd>
        ${a.planned_date?`<dt>План</dt><dd>${dt(a.planned_date)}</dd>`:''}
        ${a.actual_sent_at?`<dt>Отправлено</dt><dd>${dtF(a.actual_sent_at)}</dd>`:''}
        ${a.actual_received_at?`<dt>Принято</dt><dd>${dtF(a.actual_received_at)}</dd>`:''}
      </dl>
      <div class="asm-progress" style="margin-bottom:16px"><div class="asm-progress__bar" style="width:${pct}%"></div></div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:16px">Прогресс: ${pct}% (${items.filter(i=>i.packed).length}/${items.length})</div>`;

    // ── Compact summary + Visual Pallet Builder mount ──
    html += `<div class="asm-detail__section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:600;font-size:14px">Позиции и паллеты</span>
        <div style="display:flex;gap:14px;font-size:12px;color:var(--t2)">
          <span>📦 ${items.filter(i=>i.packed).length}/${items.length} собрано</span>
          <span>🏷️ ${items.filter(i=>i.pallet_id).length} распределено</span>
        </div>
      </div>
      ${canEdit ? '<button class="btn ghost" id="asm-add-item" style="font-size:12px;margin-bottom:12px">+ Добавить позицию вручную</button>' : ''}
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
    html+=`<a href="/api/assembly/${a.id}/checklist-pdf" target="_blank" class="btn ghost">🖨️ Чек-лист</a>`;
    html+=`<a href="/api/assembly/${a.id}/export-excel" target="_blank" class="btn ghost">📥 Excel</a>`;
    html+=`</div></div>`;

    showModal({title:`Ведомость #${a.id}`,html:html});

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
    const demobBtn=document.getElementById('asm-demob');
    if(demobBtn)demobBtn.onclick=async()=>{const r=await apiPost(`/api/assembly/${a.id}/create-demob`,{});if(r.error){toast('Ошибка',r.error,'err');return;}toast('Демоб создана','','ok');openDetail(r.item.id);};

    const receiveBtn=document.getElementById('asm-receive-all');
    if(receiveBtn)receiveBtn.onclick=async()=>{
      // return_status уже установлен через Visual Pallet Builder (badge popup)
      const r=await apiPut(`/api/assembly/${a.id}/receive-all`,{});
      if(r.error){toast('Ошибка',r.error,'err');return;}
      toast('Принято',`${r.returned} возвр., ${r.written_off} спис.`,'ok');closeModal();refresh();
    };

    const addItemBtn=document.getElementById('asm-add-item');
    if(addItemBtn)addItemBtn.onclick=()=>openAddItemDialog(a.id);
    // Паллеты, drag-drop, return_status — всё внутри AsgardAssemblyDnD
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
