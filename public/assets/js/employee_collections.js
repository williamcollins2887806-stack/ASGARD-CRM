/**
 * ASGARD CRM — Подборки Дружины (Employee Collections)
 * HR создаёт именные подборки лучших сотрудников
 */
window.AsgardEmployeeCollections = (function(){
  const { $, $$, esc, toast, showModal, hideModal } = AsgardUI;

  let collections = [];
  let currentCollection = null;
  let authToken = null;

  async function getToken() {
    if (authToken) return authToken;
    const auth = await AsgardAuth.getAuth();
    authToken = auth?.token;
    return authToken;
  }

  async function api(method, path, body) {
    const token = await getToken();
    const opts = {
      method,
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch("/api/employee-collections" + path, opts);
    if (!resp.ok) { toast("Ошибка", "Сервер: " + resp.status, "err"); return {success:false, error:"HTTP "+resp.status}; }
    return await resp.json();
  }

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = "#/login"; return; }
    const user = auth.user;
    const isHR = ["ADMIN","HR","HR_MANAGER"].includes(user.role) || (user.role||"").startsWith("DIRECTOR");
    if (!isHR) { toast("Доступ","Недостаточно прав","err"); location.hash="#/home"; return; }

    const html = '<div class="panel">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">' +
        '<div><div class="help">Именные подборки лучших сотрудников. Создавай, называй, управляй.</div></div>' +
        '<button class="btn primary" id="btnNewCol">+ Новая подборка</button>' +
      '</div>' +
      '<hr class="hr"/>' +
      '<div id="colGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">' +
        '<div class="help">Загрузка...</div>' +
      '</div>' +
    '</div>';
    await layout(html, { title: title || "Подборки Дружины" });

    await loadCollections();
    $("#btnNewCol")?.addEventListener("click", function(){ showCreateModal(); });
  }

  async function loadCollections() {
    const data = await api("GET", "/");
    collections = data.collections || [];
    renderGrid();
  }

  function renderGrid() {
    const grid = $("#colGrid");
    if (!grid) return;
    if (!collections.length) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--t3)"><div style="font-size:48px;margin-bottom:12px">' + String.fromCodePoint(0x1F4CB) + '</div><div>Подборок пока нет</div><div class="help">Создайте первую подборку</div></div>';
      return;
    }
    grid.innerHTML = collections.map(function(c) {
      return '<div class="col-card" data-id="' + c.id + '" style="background:var(--bg3);border:1px solid var(--brd);border-radius:var(--r-md);padding:20px;cursor:pointer;transition:all 0.15s;position:relative">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
          '<div>' +
            '<div style="font-size:16px;font-weight:700;color:var(--gold)">' + esc(c.name) + '</div>' +
            (c.description ? '<div style="font-size:12px;color:var(--t2);margin-top:4px">' + esc(c.description) + '</div>' : '') +
          '</div>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="btn ghost mini" data-act="edit" data-id="' + c.id + '" title="Редактировать">' + String.fromCodePoint(0x270F) + '</button>' +
            '<button class="btn ghost mini" data-act="del" data-id="' + c.id + '" title="Удалить" style="color:var(--red)">' + String.fromCodePoint(0x1F5D1) + '</button>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:12px;display:flex;gap:16px;font-size:13px">' +
          '<div><span style="color:var(--t3)">Сотрудников:</span> <b style="color:var(--t1)">' + (c.employee_count || 0) + '</b></div>' +
          (c.created_by_name ? '<div><span style="color:var(--t3)">Автор:</span> ' + esc(c.created_by_name) + '</div>' : '') +
        '</div>' +
        '<div style="margin-top:8px;font-size:11px;color:var(--t3)">' + (c.updated_at ? new Date(c.updated_at).toLocaleDateString("ru-RU") : "") + '</div>' +
      '</div>';
    }).join("");

    $$(".col-card").forEach(function(card) {
      card.addEventListener("click", function(e) {
        if (e.target.closest("[data-act]")) return;
        openCollection(Number(card.dataset.id));
      });
    });

    $$("[data-act='edit']").forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        var c = collections.find(function(x) { return x.id === Number(btn.dataset.id); });
        if (c) showEditModal(c);
      });
    });
    $$("[data-act='del']").forEach(function(btn) {
      btn.addEventListener("click", async function(e) {
        e.stopPropagation();
        if (!confirm("Удалить подборку?")) return;
        await api("DELETE", "/" + btn.dataset.id);
        toast("Подборки", "Удалено");
        await loadCollections();
      });
    });
  }

  function showCreateModal() {
    var h = '<div style="display:flex;flex-direction:column;gap:12px">' +
      '<div><label style="font-weight:600;font-size:13px;color:var(--t2)">Название подборки</label>' +
        '<input id="col_name" class="inp" placeholder="Лучшие сварщики, Топ электрики..." style="margin-top:4px"/></div>' +
      '<div><label style="font-weight:600;font-size:13px;color:var(--t2)">Описание (необязательно)</label>' +
        '<input id="col_desc" class="inp" placeholder="Краткое описание..." style="margin-top:4px"/></div>' +
      '<button class="btn primary" id="btnCreateCol" style="margin-top:8px">Создать</button>' +
    '</div>';
    showModal("Новая подборка", h);
    $("#btnCreateCol")?.addEventListener("click", async function() {
      var name = ($("#col_name")?.value || "").trim();
      if (!name) { toast("Подборки", "Укажите название", "err"); return; }
      var desc = ($("#col_desc")?.value || "").trim();
      var res = await api("POST", "/", { name: name, description: desc });
      if (res.success) {
        hideModal();
        toast("Подборки", "Подборка создана");
        await loadCollections();
        openCollection(res.collection.id);
      } else {
        toast("Ошибка", res.error || "Не удалось создать", "err");
      }
    });
  }

  function showEditModal(col) {
    var h = '<div style="display:flex;flex-direction:column;gap:12px">' +
      '<div><label style="font-weight:600;font-size:13px;color:var(--t2)">Название</label>' +
        '<input id="col_name" class="inp" value="' + esc(col.name) + '" style="margin-top:4px"/></div>' +
      '<div><label style="font-weight:600;font-size:13px;color:var(--t2)">Описание</label>' +
        '<input id="col_desc" class="inp" value="' + esc(col.description||"") + '" style="margin-top:4px"/></div>' +
      '<button class="btn primary" id="btnUpdateCol" style="margin-top:8px">Сохранить</button>' +
    '</div>';
    showModal("Редактировать: " + esc(col.name), h);
    $("#btnUpdateCol")?.addEventListener("click", async function() {
      var name = ($("#col_name")?.value || "").trim();
      if (!name) { toast("Подборки", "Укажите название", "err"); return; }
      var desc = ($("#col_desc")?.value || "").trim();
      await api("PUT", "/" + col.id, { name: name, description: desc });
      hideModal();
      toast("Подборки", "Сохранено");
      await loadCollections();
    });
  }

  async function openCollection(colId) {
    var data = await api("GET", "/" + colId);
    if (!data.success) { toast("Ошибка", data.error || "Не найдено", "err"); return; }
    currentCollection = data.collection;
    var employees = data.employees || [];

    var empHtml = employees.length ? employees.map(function(e) {
      return '<div class="col-emp" style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;font-size:13px;color:var(--t1)">' + esc(e.fio||e.full_name||"") + '</div>' +
          '<div style="font-size:11px;color:var(--t2)">' + esc(e.role_tag||"") + (e.city?" \u00B7 "+esc(e.city):"") + (e.phone?" \u00B7 "+esc(e.phone):"") + '</div>' +
          '<div style="font-size:11px;color:var(--t3);margin-top:2px">' +
            (e.rating_avg ? "\u2605 "+Number(e.rating_avg).toFixed(1) : "Без рейтинга") +
            (e.grade ? " \u00B7 Разряд: "+esc(e.grade) : "") +
            (!e.is_active ? ' \u00B7 <span style="color:var(--red)">Неактивен</span>' : "") +
          '</div>' +
        '</div>' +
        '<button class="btn ghost mini" data-rm="' + e.id + '" style="color:var(--red)" title="Удалить из подборки">\u2715</button>' +
      '</div>';
    }).join("") : '<div class="help" style="text-align:center;padding:20px">Нет сотрудников в подборке</div>';

    var h = '<div style="display:flex;flex-direction:column;gap:12px;max-height:75vh;overflow-y:auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--gold)">' + esc(currentCollection.name) + '</div>' +
          (currentCollection.description ? '<div style="font-size:12px;color:var(--t2)">' + esc(currentCollection.description) + '</div>' : '') +
        '</div>' +
        '<button class="btn" id="btnAddEmps" style="white-space:nowrap">+ Добавить сотрудников</button>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--t3)">' + employees.length + ' сотрудников</div>' +
      '<div id="colEmpList" style="display:flex;flex-direction:column;gap:6px">' + empHtml + '</div>' +
    '</div>';
    showModal("Подборка: " + esc(currentCollection.name), h);

    $("#btnAddEmps")?.addEventListener("click", async function() {
      var allEmps = await AsgardDB.all("employees");
      var existingSet = new Set(employees.map(function(e){ return e.id; }));
      var available = (allEmps || []).filter(function(e){ return e.is_active && !existingSet.has(e.id) && (e.fio||e.full_name||'').trim(); });

      var pickHtml = '<div style="max-height:60vh;overflow-y:auto">' +
        '<input id="empSearch" class="inp" placeholder="Поиск по ФИО, должности, городу..." style="margin-bottom:12px"/>' +
        '<div id="empPickList" class="emp-selector" style="max-height:50vh">' +
        available.map(function(e) {
          var _n = e.fio||e.full_name||'';
          var _colors = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#85C1E9'];
          var _h = 0; for(var j=0;j<_n.length;j++) _h = _n.charCodeAt(j)+((_h<<5)-_h);
          var _bg = _colors[Math.abs(_h) % _colors.length];
          var _ini = _n.split(' ').map(function(w){return w[0]||'';}).join('').substring(0,2).toUpperCase() || '??';
          return '<label class="emp-selector-item col-pick-emp" data-name="' + esc(_n.toLowerCase()) + '" data-role="' + esc((e.role_tag||"").toLowerCase()) + '" data-city="' + esc((e.city||"").toLowerCase()) + '">' +
            '<input type="checkbox" value="' + e.id + '"/>' +
            '<div class="emp-selector-check">✓</div>' +
            '<div class="emp-selector-avatar" style="background:' + _bg + '">' + _ini + '</div>' +
            '<div class="emp-selector-info">' +
              '<div class="emp-selector-name">' + esc(_n) + '</div>' +
              '<div class="emp-selector-role">' + esc(e.role_tag||"") + (e.city?" · "+esc(e.city):"") + (e.rating_avg?" · ★"+Number(e.rating_avg).toFixed(1):"") + '</div>' +
            '</div>' +
          '</label>';
        }).join("") +
        '</div>' +
        '<button class="btn primary" id="btnConfirmAdd" style="margin-top:12px;width:100%">Добавить выбранных</button>' +
      '</div>';
      showModal("Добавить сотрудников", pickHtml);

      $("#empSearch")?.addEventListener("input", function() {
        var q = ($("#empSearch")?.value || "").toLowerCase().trim();
        $$(".col-pick-emp").forEach(function(el) {
          var n = el.dataset.name || "";
          var r = el.dataset.role || "";
          var c = el.dataset.city || "";
          el.style.display = (!q || n.includes(q) || r.includes(q) || c.includes(q)) ? "" : "none";
        });
      });

      $("#btnConfirmAdd")?.addEventListener("click", async function() {
        var ids = $$(".col-pick-emp input:checked").map(function(cb){ return Number(cb.value); }).filter(Boolean);
        if (!ids.length) { toast("Подборки", "Выберите сотрудников", "err"); return; }
        var res = await api("POST", "/" + colId + "/employees", { employee_ids: ids });
        if (res.success) {
          hideModal();
          toast("Подборки", "Добавлено " + res.added + " сотр.");
          openCollection(colId);
        }
      });
    });

    $$("[data-rm]").forEach(function(btn) {
      btn.addEventListener("click", async function() {
        var empId = btn.dataset.rm;
        await api("DELETE", "/" + colId + "/employees/" + empId);
        toast("Подборки", "Удалён из подборки");
        openCollection(colId);
      });
    });
  }

  async function getCollectionsList() {
    var data = await api("GET", "/");
    return data.collections || [];
  }

  async function getCollectionEmployees(colId) {
    var data = await api("GET", "/" + colId);
    return data.employees || [];
  }

  return { render: render, getCollectionsList: getCollectionsList, getCollectionEmployees: getCollectionEmployees, openCollection: openCollection };
})();
