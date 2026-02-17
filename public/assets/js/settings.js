window.AsgardSettingsPage = (function(){
  const { $, esc, toast } = AsgardUI;

  function num(v, def){
    const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : def;
  }

  function uniqNonEmpty(arr){
    const out=[];
    const seen=new Set();
    for(const x of (arr||[])){
      const s=String(x||"").trim();
      if(!s) continue;
      const key=s.toLowerCase();
      if(seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  }

  function parseLines(txt){
    return uniqNonEmpty(String(txt||"")
      .split(/\r?\n/)
      .map(s=>s.trim())
      .filter(Boolean));
  }

  function dateFromIso(iso){
    if(!iso) return "";
    try{
      const d = new Date(iso);
      if(!isNaN(d.getTime())) return d.toISOString().slice(0,10);
    }catch(_){ }
    if(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(iso))) return String(iso);
    return "";
  }

  function isoFromDateInput(ymd){
    if(!ymd) return null;
    const d = new Date(`${ymd}T00:00:00.000Z`);
    if(isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function safeParseJSON(txt, fallback){
    try{
      const v = JSON.parse(txt || "null");
      return (v && typeof v === "object") ? v : (fallback ?? null);
    }catch(_){
      return (fallback ?? null);
    }
  }

  async function getSettingsObj(key, defObj){
    const s = await AsgardDB.get("settings", key);
    if(!s) return defObj || {};
    try{
      const obj = JSON.parse(s.value_json || "{}");
      return (obj && typeof obj === "object") ? obj : (defObj || {});
    }catch(_){
      return defObj || {};
    }
  }

  async function saveSettingsObj(key, obj){
    await AsgardDB.put("settings", {
      key,
      value_json: JSON.stringify(obj || {}),
      updated_at: new Date().toISOString()
    });
  }

  function hasAccess(role){
    return role === "ADMIN" || (window.AsgardAuth&&AsgardAuth.isDirectorRole?AsgardAuth.isDirectorRole(role):String(role||"").startsWith("DIRECTOR_"));
  }

  async function render({layout, title}){
    const auth = await AsgardAuth.requireUser();
    if(!auth){ location.hash = "#/login"; return; }
    const user = auth.user;

    if(!hasAccess(user.role)){
      toast("Доступ","Раздел доступен только директору и администратору","err");
      location.hash = "#/home";
      return;
    }

    const app = await getSettingsObj("app", (window.AsgardSeed&&AsgardSeed.DEFAULT_SETTINGS)||{});
    const refs = await getSettingsObj("refs", (window.AsgardSeed&&AsgardSeed.DEFAULT_REFS)||{});
    const customers = (await AsgardDB.all("customers")).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"ru"));
    try{ await AsgardTemplates.ensureDefaultDocsSettings(); }catch(_){ }
    let docsTpl = {};
    try{ docsTpl = await AsgardTemplates.getDocsSettings(); }catch(_){ docsTpl = {}; }

    const company = app.company_profile || {};
    const docTypes = Array.isArray(app.doc_types) ? app.doc_types : [];

    const calc = app.calc || {};
    const sla = app.sla || {};
    const limits = app.limits || {};
    const schedules = app.schedules || {};

    // defaults / migrations
    if(!app.work_close_trigger_status) app.work_close_trigger_status = "Подписание акта";

    const statusColors = app.status_colors || {};
    const offColors = statusColors.office || (AsgardSeed?.DEFAULT_SETTINGS?.status_colors?.office) || {};
    const wkColors  = statusColors.workers || (AsgardSeed?.DEFAULT_SETTINGS?.status_colors?.workers) || {};

    const OFFICE_STATUS = [
      {code:"оф", label:"В офисе"},
      {code:"уд", label:"Удалёнка"},
      {code:"бн", label:"Больничный"},
      {code:"сс", label:"За свой счёт"},
      {code:"км", label:"Командировка"},
      {code:"пг", label:"Встреча/переговоры"},
      {code:"уч", label:"Учёба"},
      {code:"ск", label:"Склад"},
      {code:"вх", label:"Выходной"},
    ];
    const WORKER_STATUS = [
      {code:"free", label:"Свободен"},
      {code:"office", label:"Офис"},
      {code:"trip", label:"Командировка"},
      {code:"work", label:"Работа (контракт)"},
      {code:"note", label:"Заметка"},
    ];

    function colorRowsHtml(prefix, items, colors){
      return items.map(it=>{
        const id = `${prefix}_${it.code}`;
        const val = String(colors[it.code]||"#cccccc");
        return `
          <div class="row" style="justify-content:space-between; gap:10px; align-items:center">
            <label for="${esc(id)}" style="flex:1">${esc(it.label)} <span class="muted">(${esc(it.code)})</span></label>
            <input id="${esc(id)}" type="color" value="${esc(val)}" style="width:52px; height:34px; padding:0; border:none; background:transparent"/>
            <input data-color-copy="${esc(id)}" class="inp" value="${esc(val)}" style="max-width:120px"/>
          </div>
        `;
      }).join("");
    }

    const html = `
      <div class="panel">
        <div class="help">
          Настройки синхронизируются с сервером.
          Для переноса между ПК используйте «Экспорт/Импорт» внизу меню.
        </div>
        <hr class="hr"/>

        <div class="grid2">
          <div class="card">
            <h3>Параметры приложения</h3>
            <div class="formrow" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
              <div>
                <label for="s_vat">НДС, %</label>
                <input id="s_vat" type="number" min="0" max="30" step="0.01" value="${esc(String(app.vat_pct ?? 20))}"/>
              </div>
              <div>
                <label for="s_gantt">Старт общего Ганта</label>
                <input id="s_gantt" type="date" value="${esc(dateFromIso(app.gantt_start_iso || "2026-01-01T00:00:00.000Z"))}"/>
              </div>
              <div>
                <label for="s_docs_hint">Подсказка по папке документов</label>
                <input id="s_docs_hint" placeholder="например: Я.Диск / проекты / ..." value="${esc(String(app.docs_folder_hint || ""))}"/>
              </div>
              <div style="grid-column:1/-1">
                <label class="row" style="gap:8px; align-items:center">
                  <input id="s_req_docs" type="checkbox" ${app.require_docs_on_handoff!==false ? "checked" : ""}/>
                  <span>Требовать документы при передаче тендера в просчёт</span>
                </label>
              </div>
              <div style="grid-column:1/-1">
                <label class="row" style="gap:8px; align-items:center">
                  <input id="s_req_answer" type="checkbox" ${app.require_answer_on_question!==false ? "checked" : ""}/>
                  <span>Требовать ответ на вопрос перед закрытием (QA)</span>
                </label>
              </div>
            </div>
          </div>

          <div class="card">
            <h3>📬 Корреспонденция</h3>
            <div class="help">Настройки автонумерации исходящих документов. Формат: АС-ИСХ-ГГГГ-NNNNNN</div>
            <div class="formrow" style="grid-template-columns:repeat(2,1fr)">
              <div>
                <label for="corr_start_num">Стартовый номер (для нового года)</label>
                <input id="corr_start_num" type="number" min="1" step="1" value="${esc(String(app.correspondence_start_number ?? 1))}"/>
                <div class="help">Нумерация сбрасывается 1 января каждого года</div>
              </div>
              <div>
                <label>Пример следующего номера</label>
                <div style="padding:10px;background:rgba(212,175,55,.15);border-radius:6px;font-family:monospace;color:#D4AF37;font-weight:600">
                  АС-ИСХ-${new Date().getFullYear()}-${String(app.correspondence_start_number ?? 1).padStart(6,'0')}
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <h3>SLA / уведомления и лимиты (под этап 3)</h3>
            <div class="help">Сейчас сохраняем параметры. Движок уведомлений будет использовать их на этапе 3.</div>
            <div class="formrow" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
              <div>
                <label for="sla_docs">Дедлайн заявки: напоминать за N дней</label>
                <input id="sla_docs" type="number" min="0" step="1" value="${esc(String(sla.docs_deadline_notice_days ?? 5))}"/>
              </div>
              <div>
                <label for="sla_bday">ДР: напоминать за N дней</label>
                <input id="sla_bday" type="number" min="0" step="1" value="${esc(String(sla.birthday_notice_days ?? 5))}"/>
              </div>
              <div>
                <label for="sla_pm">РП: срок просчёта, рабочих дней</label>
                <input id="sla_pm" type="number" min="0" step="1" value="${esc(String(sla.pm_calc_due_workdays ?? 3))}"/>
              </div>
              <div>
                <label for="sla_dir">Ярл: срок согласования, рабочих дней</label>
                <input id="sla_dir" type="number" min="0" step="1" value="${esc(String(sla.director_approval_due_workdays ?? 2))}"/>
              </div>
              <div>
                <label for="sla_rework">РП: срок доработки, рабочих дней</label>
                <input id="sla_rework" type="number" min="0" step="1" value="${esc(String(sla.pm_rework_due_workdays ?? 1))}"/>
              </div>
              <div>
                <label for="sla_reminder_del">Автоудаление напоминаний, часов</label>
                <input id="sla_reminder_del" type="number" min="1" step="1" value="${esc(String(app.reminder_auto_delete_hours ?? 48))}"/>
                <div class="help">Завершённые напоминания удаляются через N часов</div>
              </div>
              <div>
                <label for="lim_pm">Лимит активных просчётов на 1 РП</label>
                <input id="lim_pm" type="number" min="1" step="1" value="${esc(String(limits.pm_active_calcs_limit ?? 5))}"/>
              </div>
              <div>
                <label for="sla_direct_req">Прямой запрос: дедлайн по умолчанию, дней</label>
                <input id="sla_direct_req" type="number" min="0" step="1" value="${esc(String(sla.direct_request_deadline_days ?? 5))}"/>
              </div>
              <div>
                <label for="tkp_followup_days">TKP Follow-up: первое напоминание через N дней</label>
                <input id="tkp_followup_days" type="number" min="1" step="1" value="${esc(String(sla.tkp_followup_first_delay_days ?? 3))}"/>
              </div>
              <div style="grid-column:1/-1">
                <label for="lim_pm_done">Просчёт НЕ считается активным при статусах (через запятую)</label>
                <input id="lim_pm_done" type="text" value="${esc(String(limits.pm_active_calcs_done_statuses ?? "Согласование ТКП, ТКП согласовано, Клиент согласился, Клиент отказался"))}"/>
                <div class="help">Используется для лимита активных просчётов (этап 6).</div>
              </div>
              <div class="help" style="grid-column:1/-1">
                <b>TKP Follow-up:</b> Для "Прямой запрос" после статуса "ТКП отправлено" PM получит напоминание через указанное число дней, затем ежедневно до закрытия.
              </div>

              <div style="grid-column:1/-1; margin-top:6px">
                <h4 style="margin:8px 0 6px">Календарь: правила (этап 6)</h4>
                <label class="row" style="gap:8px; align-items:center">
                  <input id="sch_off_strict" type="checkbox" ${schedules.office_strict_own!==false?"checked":""}/>
                  <span>Офис: строго «только свои статусы»</span>
                </label>
                <label style="margin-top:10px" for="sch_shift">Рабочие: кто может сдвигать/править бронь (логины, через запятую)</label>
                <input id="sch_shift" value="${esc(String((schedules.workers_shift_logins||["trukhin"]).join(",")))}" placeholder="trukhin"/>
                <label class="row" style="gap:8px; align-items:center; margin-top:10px">
                  <input id="sch_conflict" type="checkbox" ${schedules.block_on_conflict!==false?"checked":""}/>
                  <span>Запрет согласования заявки персонала при конфликте брони</span>
                </label>

                <div style="margin-top:12px">
                  <label for="app_close_trigger">Контракты: статус, при котором доступна кнопка «Работы завершены»</label>
                  <select id="app_close_trigger">
                    ${(refs.work_statuses||[]).map(s=>`<option value="${esc(s)}" ${app.work_close_trigger_status===s?"selected":""}>${esc(s)}</option>`).join("")}
                  </select>
                  <div class="help">РП сможет закрывать контракт через мастер «Работы завершены» только при этом статусе.</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="grid2" style="margin-top:14px">
          <div class="card">
            <h3>Справочники статусов и причин</h3>
            <div class="help">По одному значению в строке. Уникальные значения сохраняются как справочник.</div>
            <div class="formrow" style="grid-template-columns:1fr">
              <div>
                <label for="r_tender">tender_status (включая «Новый»)</label>
                <textarea id="r_tender" rows="8" style="width:100%">${esc((refs.tender_statuses||[]).join("\n"))}</textarea>
              </div>
              <div>
                <label for="r_work">work_status</label>
                <textarea id="r_work" rows="8" style="width:100%">${esc((refs.work_statuses||[]).join("\n"))}</textarea>
              </div>
              <div>
                <label for="r_rej">reject_reason</label>
                <textarea id="r_rej" rows="6" style="width:100%">${esc((refs.reject_reasons||[]).join("\n"))}</textarea>
              </div>
              <div>
                <label for="r_perm">Допуски/разрешения (справочник)</label>
                <textarea id="r_perm" rows="6" style="width:100%">${esc((refs.permits||[]).join("\n"))}</textarea>
                <div class="help">Используется в личном деле сотрудников и фильтрах (этап 8).</div>
              </div>
            </div>
          </div>

          <div class="card">
            <h3>Справочник заказчиков (ИНН)</h3>
            <div class="help">Офлайн-справочник. Используется в тендерах: вводите ИНН → выбирайте из списка. Можно пополнять вручную.</div>
            <div class="formrow" style="grid-template-columns:220px 1fr auto; align-items:end">
              <div>
                <label for="cust_inn">ИНН</label>
                <input id="cust_inn" placeholder="10 или 12 цифр" />
                <input id="cust_edit_inn" type="hidden" />
              </div>
              <div>
                <label for="cust_name">Название</label>
                <input id="cust_name" placeholder="АО ..." />
              </div>
              <div class="row" style="gap:8px">
                <button class="btn" id="cust_add">Добавить/обновить</button>
                <button class="btn ghost" id="cust_clear">Очистить</button>
              </div>
            </div>
            <div style="overflow:auto; max-height:320px; margin-top:10px">
              <table class="tbl" style="min-width:520px">
                <thead><tr><th>ИНН</th><th>Название</th><th style="width:160px">Действия</th></tr></thead>
                <tbody>
                  ${(customers||[]).map(c=>`
                    <tr>
                      <td><code>${esc(c.inn||"")}</code></td>
                      <td>${esc(c.name||"")}</td>
                      <td class="row" style="gap:6px">
                        <button class="btn ghost" data-cust-edit="${esc(c.inn||"")}">Править</button>
                        <button class="btn ghost" data-cust-del="${esc(c.inn||"")}">Удалить</button>
                      </td>
                    </tr>
                  `).join("") || `<tr><td colspan="3"><div class="help">Пока пусто. Добавьте контрагентов или импортируйте через экспорт/импорт базы.</div></td></tr>`}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <h3>ᚱ Рунический Калькулятор — нормы и коэффициенты</h3>
            <div class="formrow" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
              <div>
                <label for="c_minppd">Мин. прибыль/чел‑день (жёлтая), ₽</label>
                <input id="c_minppd" type="number" min="0" step="1000" value="${esc(String(calc.min_profit_per_person_day ?? 20000))}"/>
              </div>
              <div>
                <label for="c_normppd">Норма прибыли/чел‑день (зелёная), ₽</label>
                <input id="c_normppd" type="number" min="0" step="1000" value="${esc(String(calc.norm_profit_per_person_day ?? 25000))}"/>
              </div>
              <div>
                <label for="c_over">Накладные расходы, %</label>
                <input id="c_over" type="number" min="0" step="0.5" value="${esc(String(calc.overhead_pct ?? 10))}"/>
              </div>
              <div>
                <label for="c_fot">Налоги на ФОТ, %</label>
                <input id="c_fot" type="number" min="0" step="1" value="${esc(String(calc.fot_tax_pct ?? 50))}"/>
              </div>
              <div>
                <label for="c_pt">Налог на прибыль, %</label>
                <input id="c_pt" type="number" min="0" step="1" value="${esc(String(calc.profit_tax_pct ?? 20))}"/>
              </div>
              <div>
                <label for="c_base">Базовая ставка рабочего, ₽</label>
                <input id="c_base" type="number" min="0" step="100" value="${esc(String(calc.base_rate ?? 5500))}"/>
              </div>
              <div>
                <label for="c_days_mult">Коэфф. запаса сроков</label>
                <input id="c_days_mult" type="number" min="1" max="2" step="0.05" value="${esc(String(calc.auto_days_multiplier ?? 1.2))}"/>
              </div>
              <div>
                <label for="c_people_mult">Коэфф. запаса бригады</label>
                <input id="c_people_mult" type="number" min="1" max="2" step="0.05" value="${esc(String(calc.auto_people_multiplier ?? 1.1))}"/>
              </div>
            </div>
            <div class="help" style="margin-top:10px">
              Справочники химии, оборудования и городов загружаются из файлов calc_*.js.<br>
              Для редактирования ролей и транспорта используйте JSON ниже.
            </div>

            <div style="margin-top:10px">
              <label for="c_roles">Ставки ролей (role_rates), JSON</label>
              <textarea id="c_roles" rows="6" style="width:100%">${esc(JSON.stringify(calc.role_rates || {}, null, 2))}</textarea>
            </div>

            <div style="margin-top:10px">
              <label for="c_chems">Химсоставы (chemicals), JSON</label>
              <textarea id="c_chems" rows="7" style="width:100%">${esc(JSON.stringify(calc.chemicals || [], null, 2))}</textarea>
            </div>

            <div style="margin-top:10px">
              <label for="c_trans">Транспорт (transport), JSON</label>
              <textarea id="c_trans" rows="9" style="width:100%">${esc(JSON.stringify(calc.transport || calc.transport_options || [], null, 2))}</textarea>
            </div>
          </div>
        </div>

        <div class="grid2" style="margin-top:14px">
          <div class="card">
            <h3>🤖 AI-ассистент (YandexGPT)</h3>
            <div class="help">Настройка подключения к YandexGPT для AI-помощника. Получите ключи в <a href="https://console.cloud.yandex.ru" target="_blank" style="color:#60a5fa">Yandex Cloud Console</a>.</div>
            <div class="formrow" style="grid-template-columns:1fr">
              <div>
                <label for="ai_folder">Folder ID (идентификатор каталога)</label>
                <input id="ai_folder" type="text" value="" placeholder="b1gxxxxxxxxxx"/>
                <div class="help">Консоль → Ваш каталог → ID в URL или настройках</div>
              </div>
              <div>
                <label for="ai_key">API Key</label>
                <input id="ai_key" type="password" value="" placeholder="AQVN..."/>
                <div class="help">Сервисные аккаунты → Создать → Роль ai.languageModels.user → Создать API-ключ</div>
              </div>
            </div>
            <div style="margin-top:12px">
              <button class="btn ghost" id="btnTestAI">🧪 Проверить подключение</button>
              <span id="aiTestResult" style="margin-left:12px"></span>
            </div>
          </div>

          <div class="card">
            <h3>Цвета статусов календарей</h3>
            <div class="help">Цвета применяются в календарях «Офис» и «Рабочие». Меняются локально и сразу.</div>
            <div class="grid2" style="margin-top:10px">
              <div>
                <h4 style="margin:0 0 8px 0">Офис</h4>
                <div class="stack" style="gap:8px">${colorRowsHtml("col_off", OFFICE_STATUS, offColors)}</div>
              </div>
              <div>
                <h4 style="margin:0 0 8px 0">Рабочие</h4>
                <div class="stack" style="gap:8px">${colorRowsHtml("col_wk", WORKER_STATUS, wkColors)}</div>
              </div>
            </div>
            <div class="help" style="margin-top:8px">Поле справа — HEX (можно копировать/вставлять). Изменения сохраняются по кнопке «Сохранить».</div>
          </div>

          <div class="card">
            <h3>Профиль компании</h3>
            <div class="formrow" style="grid-template-columns:repeat(2,1fr)">
              <div style="grid-column:1/-1">
                <label for="c_name">Наименование</label>
                <input id="c_name" value="${esc(String(company.company_name || ""))}" placeholder="ООО «АСГАРД‑Сервис»"/>
              </div>
              <div style="grid-column:1/-1">
                <label for="c_dir">Директор (ФИО)</label>
                <input id="c_dir" value="${esc(String(company.director_fio || ""))}" placeholder="Фамилия Имя Отчество"/>
              </div>
              <div>
                <label for="c_inn">ИНН</label>
                <input id="c_inn" value="${esc(String(company.inn || ""))}"/>
              </div>
              <div>
                <label for="c_kpp">КПП</label>
                <input id="c_kpp" value="${esc(String(company.kpp || ""))}"/>
              </div>
              <div>
                <label for="c_ogrn">ОГРН</label>
                <input id="c_ogrn" value="${esc(String(company.ogrn || ""))}"/>
              </div>
              <div>
                <label for="c_phone">Телефон</label>
                <input id="c_phone" value="${esc(String(company.phone || ""))}"/>
              </div>
              <div style="grid-column:1/-1">
                <label for="c_email">Email</label>
                <input id="c_email" value="${esc(String(company.email || ""))}"/>
              </div>
              <div style="grid-column:1/-1">
                <label for="c_addr">Адрес</label>
                <input id="c_addr" value="${esc(String(company.address || ""))}"/>
              </div>
              <div style="grid-column:1/-1">
                <label for="c_web">Сайт</label>
                <input id="c_web" value="${esc(String(company.website || ""))}"/>
              </div>
            </div>
          </div>

          <div class="card">
            <h3>Типы документов (doc_types)</h3>
            <div class="help">Редактирование — через JSON. Формат: массив объектов { key, label, scope, required_on_handoff }.</div>
            <textarea id="doc_types" rows="14" style="width:100%; margin-top:10px">${esc(JSON.stringify(docTypes, null, 2))}</textarea>
          </div>

          <div class="card">
            <h3>Документы и шаблоны</h3>
            <div class="help">Шаблоны используются при создании «Запрос / ТКП / Сопроводительное» и хранятся на сервере.</div>
            <div class="formrow" style="grid-template-columns:repeat(2,1fr)">
              <div>
                <label for="d_vat">НДС, %</label>
                <input id="d_vat" type="number" min="0" step="0.1" value="${esc(String(docsTpl.vat_pct ?? 20))}"/>
              </div>
              <div>
                <label for="d_contacts">Контакты</label>
                <input id="d_contacts" value="${esc(String(docsTpl.contacts || ""))}" placeholder="email • телефон"/>
              </div>
              <div style="grid-column:1/-1">
                <label for="d_pay">Условия оплаты (по умолчанию)</label>
                <input id="d_pay" value="${esc(String(docsTpl.payment_terms || ""))}"/>
              </div>
              <div style="grid-column:1/-1">
                <label for="d_req">Шаблон — Запрос (текст)</label>
                <textarea id="d_req" rows="4" style="width:100%">${esc(String(docsTpl.request_extra || ""))}</textarea>
              </div>
              <div style="grid-column:1/-1">
                <label for="d_tkp">Шаблон — ТКП (текст)</label>
                <textarea id="d_tkp" rows="4" style="width:100%">${esc(String(docsTpl.tkp_extra || ""))}</textarea>
              </div>
              <div>
                <label for="d_cov_subj">Сопроводительное — тема</label>
                <input id="d_cov_subj" value="${esc(String(docsTpl.cover_subject || ""))}"/>
              </div>
              <div style="grid-column:1/-1">
                <label for="d_cov">Сопроводительное — текст</label>
                <textarea id="d_cov" rows="4" style="width:100%">${esc(String(docsTpl.cover_body || ""))}</textarea>
              </div>
            </div>
            <div class="help" style="margin-top:8px">Кнопки «Скачать» и «Добавить в комплект» используют эти значения.</div>
          </div>
        </div>

        <div class="grid2" style="margin-top:14px">
          ${window.AsgardPush ? '<div id="pushSettingsSection">' + AsgardPush.renderSettingsSection() + '</div>' : ''}
          ${window.AsgardWebAuthn ? AsgardWebAuthn.renderDevicesSection() : ''}
        </div>

        <div class="row" style="justify-content:flex-end; gap:8px; margin-top:12px; flex-wrap:wrap">
          <button class="btn ghost" id="btnReset">Сбросить к дефолту</button>
          <button class="btn" id="btnSave">Сохранить</button>
        </div>
      </div>
    `;

    await layout(html, { title: title || "Кузница Настроек" });

    // Init push notification settings and WebAuthn device management
    try { if (window.AsgardPush) AsgardPush.bindSettingsEvents(); } catch(e) {}
    try { if (window.AsgardWebAuthn) AsgardWebAuthn.loadDevices(); } catch(e) {}

    // Sync color pickers <-> HEX inputs (for easy copy/paste)
    document.querySelectorAll("[data-color-copy]").forEach((inp)=>{
      const id = inp.getAttribute("data-color-copy");
      const col = document.getElementById(id);
      if(!col) return;
      // HEX -> picker
      inp.addEventListener("input", ()=>{
        const v = String(inp.value||"").trim();
        if(/^#([0-9a-fA-F]{6})$/.test(v)) col.value = v;
      });
      // picker -> HEX
      col.addEventListener("input", ()=>{
        inp.value = col.value;
      });
    });

    // Customers directory (INN)
    const normInn = (v)=>String(v||"").replace(/\D/g, "");
    const clearCustomerForm = ()=>{
      $("#cust_inn").value = "";
      $("#cust_name").value = "";
      $("#cust_edit_inn").value = "";
    };
    $("#cust_clear")?.addEventListener("click", (e)=>{ e.preventDefault(); clearCustomerForm(); });
    $("#cust_add")?.addEventListener("click", async (e)=>{
      e.preventDefault();
      const inn = normInn($("#cust_inn")?.value);
      const name = String($("#cust_name")?.value||"").trim();
      if(!inn || !(inn.length===10 || inn.length===12)){
        toast("Проверка","ИНН должен быть 10 или 12 цифр","err");
        return;
      }
      if(!name){ toast("Проверка","Укажите название контрагента","err"); return; }

      const editInn = normInn($("#cust_edit_inn")?.value);
      // If INN changed during edit: delete old key
      if(editInn && editInn !== inn){
        await AsgardDB.del("customers", editInn);
      }
      await AsgardDB.put("customers", {
        inn,
        name,
        updated_at: new Date().toISOString(),
        created_at: (await AsgardDB.get("customers", inn))?.created_at || new Date().toISOString()
      });
      toast("Сохранено","Контрагент записан","ok");
      location.hash = "#/settings"; // re-render
    });
    document.querySelectorAll("[data-cust-edit]").forEach((b)=>{
      b.addEventListener("click", async ()=>{
        const inn = normInn(b.getAttribute("data-cust-edit"));
        const c = await AsgardDB.get("customers", inn);
        if(!c) return;
        $("#cust_inn").value = c.inn||"";
        $("#cust_name").value = c.name||"";
        $("#cust_edit_inn").value = c.inn||"";
      });
    });
    document.querySelectorAll("[data-cust-del]").forEach((b)=>{
      b.addEventListener("click", async ()=>{
        const inn = normInn(b.getAttribute("data-cust-del"));
        await AsgardDB.del("customers", inn);
        toast("Удалено","Контрагент удалён","ok");
        location.hash = "#/settings";
      });
    });

    $("#btnSave").onclick = async ()=>{
      // --- docs/templates (separate settings key: docs) ---
      const nextDocsTpl = Object.assign({}, docsTpl, {
        vat_pct: num($("#d_vat")?.value, docsTpl.vat_pct ?? 20),
        contacts: ($("#d_contacts")?.value || "").trim(),
        payment_terms: ($("#d_pay")?.value || "").trim(),
        request_extra: ($("#d_req")?.value || "").trim(),
        tkp_extra: ($("#d_tkp")?.value || "").trim(),
        cover_subject: ($("#d_cov_subj")?.value || "").trim(),
        cover_body: ($("#d_cov")?.value || "").trim(),
      });

      // --- app ---
      const nextApp = Object.assign({}, app);

      nextApp.vat_pct = num($("#s_vat").value, 20);
      nextApp.gantt_start_iso = isoFromDateInput($("#s_gantt").value) || nextApp.gantt_start_iso || "2026-01-01T00:00:00.000Z";
      nextApp.docs_folder_hint = ($("#s_docs_hint").value || "").trim();
      nextApp.require_docs_on_handoff = !!$("#s_req_docs").checked;
      nextApp.require_answer_on_question = !!$("#s_req_answer").checked;
      
      // Корреспонденция: стартовый номер
      nextApp.correspondence_start_number = Math.max(1, Math.round(num($("#corr_start_num")?.value, 1)));

      nextApp.sla = Object.assign({}, sla, {
        docs_deadline_notice_days: Math.max(0, Math.round(num($("#sla_docs").value, 5))),
        direct_request_deadline_days: Math.max(0, Math.round(num($("#sla_direct_req").value, 5))),
        birthday_notice_days: Math.max(0, Math.round(num($("#sla_bday").value, 5))),
        pm_calc_due_workdays: Math.max(0, Math.round(num($("#sla_pm").value, 3))),
        director_approval_due_workdays: Math.max(0, Math.round(num($("#sla_dir").value, 2))),
        pm_rework_due_workdays: Math.max(0, Math.round(num($("#sla_rework").value, 1))),
        tkp_followup_first_delay_days: Math.max(1, Math.round(num($("#tkp_followup_days")?.value, 3))),
      });

      // Автоудаление напоминаний (часы)
      nextApp.reminder_auto_delete_hours = Math.max(1, Math.round(num($("#sla_reminder_del")?.value, 48)));

      nextApp.limits = Object.assign({}, limits, {
        pm_active_calcs_limit: Math.max(1, Math.round(num($("#lim_pm").value, 6)))
      });

      // calendar / business rules (stage 6)
      const shiftLogins = String($("#sch_shift")?.value||"")
        .split(",")
        .map(s=>s.trim())
        .filter(Boolean);
      nextApp.schedules = Object.assign({}, schedules, {
        office_strict_own: !!$("#sch_off_strict")?.checked,
        workers_shift_logins: uniqNonEmpty(shiftLogins),
        block_on_conflict: !!$("#sch_conflict")?.checked
      });

      // status colors for calendars
      nextApp.status_colors = Object.assign({}, nextApp.status_colors||{});
      nextApp.status_colors.office = Object.assign({}, offColors);
      nextApp.status_colors.workers = Object.assign({}, wkColors);
      OFFICE_STATUS.forEach(it=>{
        const v = (document.getElementById(`col_off_${it.code}`)?.value || "").trim();
        if(/^#([0-9a-fA-F]{6})$/.test(v)) nextApp.status_colors.office[it.code] = v;
      });
      WORKER_STATUS.forEach(it=>{
        const v = (document.getElementById(`col_wk_${it.code}`)?.value || "").trim();
        if(/^#([0-9a-fA-F]{6})$/.test(v)) nextApp.status_colors.workers[it.code] = v;
      });

      // calculator settings v2
      const nextCalc = Object.assign({}, calc);
      nextCalc.min_profit_per_person_day = Math.max(0, Math.round(num($("#c_minppd").value, 20000)));
      nextCalc.norm_profit_per_person_day = Math.max(0, Math.round(num($("#c_normppd")?.value, 25000)));
      nextCalc.overhead_pct = Math.max(0, num($("#c_over").value, 10));
      nextCalc.fot_tax_pct = Math.max(0, num($("#c_fot").value, 50));
      nextCalc.profit_tax_pct = Math.max(0, num($("#c_pt").value, 20));
      nextCalc.base_rate = Math.max(0, Math.round(num($("#c_base")?.value, 5500)));
      nextCalc.auto_days_multiplier = Math.max(1, Math.min(2, num($("#c_days_mult")?.value, 1.2)));
      nextCalc.auto_people_multiplier = Math.max(1, Math.min(2, num($("#c_people_mult")?.value, 1.1)));

      // JSON blocks
      const rr = safeParseJSON($("#c_roles").value || "{}", null);
      if(rr === null || Array.isArray(rr)){
        toast("Калькулятор","role_rates: ожидается JSON-объект","err", 7000);
        return;
      }
      nextCalc.role_rates = rr;

      const chems = safeParseJSON($("#c_chems").value || "[]", null);
      if(!Array.isArray(chems)){
        toast("Калькулятор","chemicals: ожидается JSON-массив","err", 7000);
        return;
      }
      nextCalc.chemicals = chems;

      const trans = safeParseJSON($("#c_trans").value || "[]", null);
      if(!Array.isArray(trans)){
        toast("Калькулятор","transport: ожидается JSON-массив","err", 7000);
        return;
      }
      nextCalc.transport = trans;
      // backward compatibility key
      delete nextCalc.transport_options;

      nextApp.calc = nextCalc;

      // company profile
      nextApp.company_profile = Object.assign({}, company, {
        company_name: ($("#c_name").value || "").trim(),
        director_fio: ($("#c_dir").value || "").trim(),
        inn: ($("#c_inn").value || "").trim(),
        kpp: ($("#c_kpp").value || "").trim(),
        ogrn: ($("#c_ogrn").value || "").trim(),
        address: ($("#c_addr").value || "").trim(),
        email: ($("#c_email").value || "").trim(),
        phone: ($("#c_phone").value || "").trim(),
        website: ($("#c_web").value || "").trim(),
      });

      // doc_types
      try{
        const parsed = JSON.parse($("#doc_types").value || "[]");
        nextApp.doc_types = Array.isArray(parsed) ? parsed : docTypes;
      }catch(_){
        toast("Документы","Ошибка JSON в doc_types. Сохранение отменено.","err", 7000);
        return;
      }

      // --- refs ---
      const nextRefs = Object.assign({}, refs);
      let tenderStatuses = parseLines($("#r_tender").value);
      if(!tenderStatuses.find(s=>s==="Черновик")) tenderStatuses = ["Черновик", ...tenderStatuses];
      if(!tenderStatuses.find(s=>s.toLowerCase()==="новый")) tenderStatuses.splice(1, 0, "Новый");
      nextRefs.tender_statuses = tenderStatuses;
      nextRefs.work_statuses = parseLines($("#r_work").value);
      nextRefs.reject_reasons = parseLines($("#r_rej").value);
      nextRefs.permits = parseLines($("#r_perm").value);
      nextRefs.permits = parseLines($("#r_perm").value);

      await saveSettingsObj("app", nextApp);
      await saveSettingsObj("refs", nextRefs);
      try{ await AsgardTemplates.setDocsSettings(nextDocsTpl); }catch(e){}
      toast("Готово","Настройки сохранены");
    };

    $("#btnReset").onclick = async ()=>{
      const defApp = (window.AsgardSeed && AsgardSeed.DEFAULT_SETTINGS) ? JSON.parse(JSON.stringify(AsgardSeed.DEFAULT_SETTINGS)) : {};
      const defRefs = (window.AsgardSeed && AsgardSeed.DEFAULT_REFS) ? JSON.parse(JSON.stringify(AsgardSeed.DEFAULT_REFS)) : {};
      await saveSettingsObj("app", defApp);
      await saveSettingsObj("refs", defRefs);
      toast("Готово","Сброшено к дефолтным настройкам");
      location.hash = "#/settings";
    };
  }

  return { render };
})();
