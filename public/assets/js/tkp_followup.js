// Stage 25: TKP Follow-up — контроль обратной связи
// Только для "Прямой запрос" + "ТКП отправлено"
// Ежедневные напоминания PM до закрытия

window.AsgardTkpFollowup = (function(){
  
  const FOLLOWUP_STATUSES = {
    ok: { label: 'Цена устроила / готовы дальше', color: 'var(--ok-t)' },
    expensive: { label: 'Дорого / отказ', color: 'var(--err-t)' },
    thinking: { label: 'Думают / вернутся позже', color: 'var(--amber)' },
    rework: { label: 'Нужны правки ТКП', color: 'var(--info)' },
    no_answer: { label: 'Не дозвонился', color: 'var(--purple)' },
    other: { label: 'Прочее', color: 'var(--t2)' }
  };

  const DIRECTOR_ROLES = ['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];

  function isoNow(){ return new Date().toISOString(); }
  function today(){ return new Date().toISOString().slice(0,10); }

  function addDays(dateStr, days){
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0,10);
  }

  // Получить настройки follow-up
  async function getSettings(){
    try {
      const settings = await AsgardDB.get('settings', 'core');
      return {
        tkp_followup_first_delay_days: settings?.tkp_followup_first_delay_days ?? 3,
        tkp_followup_repeat_daily: true,
        tkp_followup_time: settings?.tkp_followup_time || '10:00'
      };
    } catch(e){
      return {
        tkp_followup_first_delay_days: 3,
        tkp_followup_repeat_daily: true,
        tkp_followup_time: '10:00'
      };
    }
  }

  // Активировать follow-up при переходе в "ТКП отправлено"
  async function activateFollowup(tender){
    if(!tender) return;
    
    // Только для "Прямой запрос"
    if(tender.request_type !== 'direct' && tender.type_request !== 'Прямой запрос') return;
    
    // Только при статусе "ТКП отправлено"
    if(tender.tender_status !== 'ТКП отправлено') return;
    
    // Уже активен или закрыт?
    if(tender.tkp_followup_state === 'active' || tender.tkp_followup_state === 'closed') return;
    
    const settings = await getSettings();
    const nextAt = addDays(today(), settings.tkp_followup_first_delay_days);
    
    tender.tkp_sent_at = isoNow();
    tender.tkp_followup_state = 'active';
    tender.tkp_followup_next_at = nextAt;
    
    await AsgardDB.put('tenders', tender);
    
    console.log(`[TKP Followup] Activated for tender #${tender.id}, next reminder: ${nextAt}`);
    return tender;
  }

  // Проверить и создать напоминания (вызывается при старте приложения)
  async function checkAndCreateReminders(){
    // Только роли с доступом к тендерам
    const auth = await AsgardAuth.getAuth();
    const role = auth?.user?.role || '';
    const dataRoles = ['ADMIN','PM','TO','HEAD_PM','HEAD_TO'];
    if (!dataRoles.includes(role) && !role.startsWith('DIRECTOR')) return;
    const tenders = await AsgardDB.all('tenders');
    const users = await AsgardDB.all('users');
    const notifications = await AsgardDB.all('notifications');
    
    const settings = await getSettings();
    const todayStr = today();
    
    let created = 0;
    
    for(const tender of tenders){
      // Только активные follow-up
      if(tender.tkp_followup_state !== 'active') continue;
      
      // Проверяем дату
      if(tender.tkp_followup_next_at > todayStr) continue;
      
      // Есть ли PM?
      const pmId = tender.responsible_pm_id;
      if(!pmId) continue;
      
      // Уже есть открытое уведомление?
      const existingNotif = notifications.find(n => 
        n.user_id === pmId && 
        n.type === 'tkp_followup' && 
        n.tender_id === tender.id &&
        !n.is_read
      );
      
      if(existingNotif) continue;
      
      // Создаём уведомление
      const notif = {
        user_id: pmId,
        type: 'tkp_followup',
        tender_id: tender.id,
        title: 'Контроль ТКП',
        message: `Напомните клиенту о ТКП: ${tender.customer_name} — ${tender.tender_title || ''}`,
        link_hash: `#/tenders?open=${tender.id}`,
        is_read: false,
        created_at: isoNow()
      };
      
      await AsgardDB.add('notifications', notif);
      created++;
      
      // Обновляем next_at на завтра (ежедневно)
      tender.tkp_followup_next_at = addDays(todayStr, 1);
      await AsgardDB.put('tenders', tender);
    }
    
    if(created > 0){
      console.log(`[TKP Followup] Created ${created} reminders`);
    }
    
    return created;
  }

  // Закрыть follow-up с результатом
  async function closeFollowup(tenderId, result, statusKey, userId){
    const tender = await AsgardDB.get('tenders', tenderId);
    if(!tender) throw new Error('Тендер не найден');
    
    tender.tkp_followup_state = 'closed';
    tender.tkp_followup_closed_at = isoNow();
    tender.tkp_followup_result = result;
    tender.tkp_followup_status = statusKey;
    tender.tkp_followup_closed_by = userId;
    
    await AsgardDB.put('tenders', tender);
    
    // Запись в историю (audit_log)
    await AsgardDB.add('audit_log', {
      actor_user_id: userId,
      entity_type: 'tender',
      entity_id: tenderId,
      action: 'tkp_followup_closed',
      payload: JSON.stringify({ result, status: statusKey }),
      created_at: isoNow()
    });
    
    // Уведомления директорам
    const users = await AsgardDB.all('users');
    const directors = users.filter(u => 
      u.is_active && !u.is_blocked &&
      (DIRECTOR_ROLES.includes(u.role) || u.role === 'ADMIN')
    );
    
    const statusLabel = FOLLOWUP_STATUSES[statusKey]?.label || statusKey;
    
    for(const dir of directors){
      await AsgardDB.add('notifications', {
        user_id: dir.id,
        type: 'tkp_followup_result',
        tender_id: tenderId,
        title: 'Результат контроля ТКП',
        message: `${tender.customer_name}: ${statusLabel}`,
        link_hash: `#/tenders?open=${tenderId}`,
        is_read: false,
        created_at: isoNow()
      });
    }
    
    // Помечаем уведомление PM как прочитанное
    const notifications = await AsgardDB.all('notifications');
    for(const n of notifications){
      if(n.type === 'tkp_followup' && n.tender_id === tenderId && !n.is_read){
        n.is_read = true;
        n.read_at = isoNow();
        await AsgardDB.put('notifications', n);
      }
    }
    
    console.log(`[TKP Followup] Closed for tender #${tenderId}: ${statusKey}`);
    return tender;
  }

  // UI: Модалка результата follow-up
  function openResultModal(tender, onSave){
    const { $, esc, showModal, toast } = AsgardUI;
    
    const statusOpts = Object.entries(FOLLOWUP_STATUSES)
      .map(([key, info]) => ({ value: key, label: info.label }));
    
    const html = `
      <div class="help" style="margin-bottom:15px">
        <b>${esc(tender.customer_name)}</b> — ${esc(tender.tender_title || '')}
        <div style="color:var(--muted); font-size:12px; margin-top:5px">
          ТКП отправлено: ${tender.tkp_sent_at ? new Date(tender.tkp_sent_at).toLocaleDateString('ru-RU') : '—'}
        </div>
      </div>
      
      <div class="formrow">
        <div style="grid-column:1/-1">
          <label>Результат разговора с клиентом</label>
          <textarea id="tkp_result" rows="3" placeholder="Кратко опишите результат звонка/встречи..."></textarea>
        </div>
      </div>
      
      <div class="formrow">
        <div>
          <label>Решение клиента</label>
          <div id="crw_tkp_status"></div>
        </div>
      </div>
      
      <hr class="hr"/>
      
      <button class="btn primary" id="btnSendResult">📤 Отправить директору и закрыть</button>
    `;
    
    showModal('Контроль ТКП', html);

    $('#crw_tkp_status')?.appendChild(CRSelect.create({
      id: 'tkp_status', fullWidth: true,
      options: statusOpts, value: statusOpts[0]?.value || '',
      dropdownClass: 'z-modal'
    }));

    $('#btnSendResult')?.addEventListener('click', async () => {
      const result = $('#tkp_result')?.value?.trim();
      const status = CRSelect.getValue('tkp_status');
      
      if(!result){
        toast('Ошибка', 'Опишите результат разговора', 'err');
        return;
      }
      
      try {
        if(onSave) await onSave(result, status);
        toast('Готово', 'Результат отправлен директору');
        AsgardUI.hideModal();
      } catch(e){
        toast('Ошибка', e.message, 'err');
      }
    });
  }

  return {
    FOLLOWUP_STATUSES,
    getSettings,
    activateFollowup,
    checkAndCreateReminders,
    closeFollowup,
    openResultModal
  };
})();
