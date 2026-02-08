/**
 * АСГАРД CRM — Модуль уведомлений
 * Telegram + сайт уведомления для всех событий
 */
window.AsgardNotify = (function(){
  const {toast} = AsgardUI || {};
  
  // Отправка уведомления через сервер
  async function sendTelegram(userId, message, options = {}) {
    try {
      const auth = await AsgardAuth?.getAuth();
      if (!auth?.token) return false;
      
      const response = await fetch('/api/notifications/telegram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.token
        },
        body: JSON.stringify({ userId, message, ...options })
      });
      
      return response.ok;
    } catch(e) {
      console.error('sendTelegram error:', e);
      return false;
    }
  }
  
  // Создание уведомления на сайте
  async function createSiteNotification(userId, title, message, link = null, type = 'info') {
    try {
      await AsgardDB.add('notifications', {
        user_id: userId,
        title,
        message,
        link,
        type,
        is_read: false,
        created_at: new Date().toISOString()
      });
      return true;
    } catch(e) {
      return false;
    }
  }
  
  // Отправить и на сайт, и в Telegram
  async function notifyUser(userId, title, message, link = null) {
    // Сайт
    await createSiteNotification(userId, title, message, link);
    
    // Telegram
    const tgMessage = `🔔 *${title}*\n\n${message}${link ? '\n\n🔗 Открыть: ' + link : ''}`;
    await sendTelegram(userId, tgMessage);
  }
  
  // === УВЕДОМЛЕНИЯ ДЛЯ СОГЛАСОВАНИЙ ===
  
  // Согласование премий
  async function notifyBonusRequest(bonusRequest, action) {
    const admins = await getAdmins();
    const pm = await AsgardDB.get('users', bonusRequest.pm_id);
    
    if (action === 'created') {
      // Уведомляем директоров о новом запросе
      for (const admin of admins) {
        await notifyUser(
          admin.id,
          '💰 Запрос на премии',
          `РП ${pm?.name || 'Неизвестный'} запросил согласование премий.\nСумма: ${bonusRequest.total_amount?.toLocaleString('ru-RU')} ₽`,
          '#/bonus-approvals'
        );
      }
    } else if (action === 'approved') {
      // Уведомляем РП об одобрении
      await notifyUser(
        bonusRequest.pm_id,
        '✅ Премии одобрены',
        `Ваш запрос на премии одобрен директором.`,
        '#/pm-works/' + bonusRequest.work_id
      );
    } else if (action === 'rejected') {
      await notifyUser(
        bonusRequest.pm_id,
        '❌ Премии отклонены',
        `Ваш запрос на премии отклонён. Причина: ${bonusRequest.reject_reason || 'Не указана'}`,
        '#/pm-works/' + bonusRequest.work_id
      );
    }
  }
  
  // Заявки на персонал
  async function notifyStaffRequest(request, action) {
    const admins = await getAdmins();
    const pm = await AsgardDB.get('users', request.pm_id);
    
    if (action === 'created') {
      for (const admin of admins) {
        await notifyUser(
          admin.id,
          '👥 Заявка на персонал',
          `РП ${pm?.name || '?'} запросил персонал.\nДолжность: ${request.position || '?'}\nКоличество: ${request.quantity || 1}`,
          '#/staff-requests'
        );
      }
    } else if (action === 'approved') {
      await notifyUser(
        request.pm_id,
        '✅ Заявка на персонал одобрена',
        `Ваша заявка на персонал одобрена.`,
        '#/staff-requests/' + request.id
      );
    } else if (action === 'rejected') {
      await notifyUser(
        request.pm_id,
        '❌ Заявка отклонена',
        `Заявка на персонал отклонена.`,
        '#/staff-requests/' + request.id
      );
    }
  }
  
  // Заявки на закупку
  async function notifyPurchaseRequest(request, action) {
    const admins = await getAdmins();
    const pm = await AsgardDB.get('users', request.pm_id);
    
    if (action === 'created') {
      for (const admin of admins) {
        await notifyUser(
          admin.id,
          '🛒 Заявка на закупку',
          `РП ${pm?.name || '?'} создал заявку на закупку.\n${request.description || ''}`,
          '#/purchase-requests'
        );
      }
    } else if (action === 'approved') {
      await notifyUser(
        request.pm_id,
        '✅ Закупка одобрена',
        `Заявка на закупку одобрена.`,
        '#/purchase-requests/' + request.id
      );
    }
  }
  
  // Передача тендера в просчёт
  async function notifyTenderHandoff(tender, pmId) {
    const fmtDate = AsgardUI.formatDate || (d => d ? new Date(d).toLocaleDateString('ru-RU') : 'Не указан');
    await notifyUser(
      pmId,
      '📋 Новый тендер на просчёт',
      `Вам передан тендер: ${tender.customer || tender.customer_name || 'Без названия'}\nДедлайн: ${fmtDate(tender.docs_deadline)}`,
      '#/tenders/' + tender.id
    );
  }
  
  // Новое сообщение в чате
  async function notifyChatMessage(chatId, senderId, messageText) {
    try {
      const chat = await AsgardDB.get('chats', chatId);
      if (!chat) return;
      
      const sender = await AsgardDB.get('users', senderId);
      
      // Получаем всех участников чата
      const participants = chat.participants || [];
      
      for (const participantId of participants) {
        if (participantId === senderId) continue; // Не уведомляем отправителя
        
        await notifyUser(
          participantId,
          '💬 Новое сообщение',
          `${sender?.name || 'Пользователь'}: ${(messageText || '').slice(0, 100)}`,
          '#/chat/' + chatId
        );
      }
    } catch(e) {
      console.error('notifyChatMessage error:', e);
    }
  }
  
  // === АВТООТЧЁТЫ ===
  
  // Генерация месячного отчёта
  async function generateMonthlyReport(year, month) {
    const startDate = `${year}-${String(month).padStart(2,'0')}-01`;
    const endDate = month === 12 
      ? `${year + 1}-01-01` 
      : `${year}-${String(month + 1).padStart(2,'0')}-01`;
    
    const report = {
      period: `${month}.${year}`,
      type: 'monthly',
      generated_at: new Date().toISOString(),
      data: {}
    };
    
    try {
      // Тендеры
      const tenders = await AsgardDB.all('tenders') || [];
      const periodTenders = tenders.filter(t => t.created_at >= startDate && t.created_at < endDate);
      report.data.tenders = {
        total: periodTenders.length,
        byStatus: {}
      };
      periodTenders.forEach(t => {
        const status = t.tender_status || 'Новый';
        report.data.tenders.byStatus[status] = (report.data.tenders.byStatus[status] || 0) + 1;
      });
      
      // Работы
      const works = await AsgardDB.all('works') || [];
      const periodWorks = works.filter(w => w.created_at >= startDate && w.created_at < endDate);
      report.data.works = {
        total: periodWorks.length,
        byStatus: {}
      };
      periodWorks.forEach(w => {
        const status = w.work_status || 'Новая';
        report.data.works.byStatus[status] = (report.data.works.byStatus[status] || 0) + 1;
      });
      
      // Доходы
      const incomes = await AsgardDB.all('incomes') || [];
      const periodIncomes = incomes.filter(i => i.date >= startDate && i.date < endDate);
      report.data.incomes = {
        total: periodIncomes.reduce((sum, i) => sum + (i.amount || 0), 0),
        count: periodIncomes.length,
        byType: {}
      };
      periodIncomes.forEach(i => {
        const type = i.type || 'other';
        report.data.incomes.byType[type] = (report.data.incomes.byType[type] || 0) + (i.amount || 0);
      });
      
      // Расходы офисные
      const officeExp = await AsgardDB.all('office_expenses') || [];
      const periodOffice = officeExp.filter(e => e.date >= startDate && e.date < endDate);
      
      // Расходы по работам
      const workExp = await AsgardDB.all('work_expenses') || [];
      const periodWork = workExp.filter(e => e.date >= startDate && e.date < endDate);
      
      report.data.expenses = {
        office: periodOffice.reduce((sum, e) => sum + (e.amount || 0), 0),
        work: periodWork.reduce((sum, e) => sum + (e.amount || 0), 0),
        total: 0,
        byCategory: {}
      };
      report.data.expenses.total = report.data.expenses.office + report.data.expenses.work;
      
      [...periodOffice, ...periodWork].forEach(e => {
        const cat = e.category || 'other';
        report.data.expenses.byCategory[cat] = (report.data.expenses.byCategory[cat] || 0) + (e.amount || 0);
      });
      
      // Прибыль
      report.data.profit = report.data.incomes.total - report.data.expenses.total;
      
      // Сохраняем отчёт
      await AsgardDB.add('reports', {
        ...report,
        id: `report_${year}_${month}`
      });
      
    } catch(e) {
      console.error('generateMonthlyReport error:', e);
    }
    
    return report;
  }
  
  // Генерация квартального отчёта
  async function generateQuarterlyReport(year, quarter) {
    const months = quarter === 1 ? [1,2,3] : quarter === 2 ? [4,5,6] : quarter === 3 ? [7,8,9] : [10,11,12];
    
    const report = {
      period: `Q${quarter} ${year}`,
      type: 'quarterly',
      generated_at: new Date().toISOString(),
      data: { tenders: {total:0, byStatus:{}}, works: {total:0}, incomes: {total:0}, expenses: {total:0}, profit: 0 },
      monthly: []
    };
    
    for (const month of months) {
      const monthlyReport = await generateMonthlyReport(year, month);
      report.monthly.push(monthlyReport);
      
      // Суммируем
      report.data.tenders.total += monthlyReport.data.tenders?.total || 0;
      report.data.works.total += monthlyReport.data.works?.total || 0;
      report.data.incomes.total += monthlyReport.data.incomes?.total || 0;
      report.data.expenses.total += monthlyReport.data.expenses?.total || 0;
    }
    
    report.data.profit = report.data.incomes.total - report.data.expenses.total;
    
    return report;
  }
  
  // Генерация годового отчёта
  async function generateYearlyReport(year) {
    const report = {
      period: `${year}`,
      type: 'yearly',
      generated_at: new Date().toISOString(),
      data: { tenders: {total:0}, works: {total:0}, incomes: {total:0}, expenses: {total:0}, profit: 0 },
      quarterly: []
    };
    
    for (let q = 1; q <= 4; q++) {
      const qReport = await generateQuarterlyReport(year, q);
      report.quarterly.push(qReport);
      
      report.data.tenders.total += qReport.data.tenders?.total || 0;
      report.data.works.total += qReport.data.works?.total || 0;
      report.data.incomes.total += qReport.data.incomes?.total || 0;
      report.data.expenses.total += qReport.data.expenses?.total || 0;
    }
    
    report.data.profit = report.data.incomes.total - report.data.expenses.total;
    
    return report;
  }
  
  // Уведомление о готовом отчёте
  async function notifyReportReady(reportType, period, downloadUrl) {
    const admins = await getAdmins();
    
    const titles = {
      monthly: '📊 Месячный отчёт готов',
      quarterly: '📊 Квартальный отчёт готов',
      yearly: '📊 Годовой отчёт готов'
    };
    
    for (const admin of admins) {
      await notifyUser(
        admin.id,
        titles[reportType] || '📊 Отчёт готов',
        `Отчёт за ${period} готов к просмотру.\nНажмите для скачивания.`,
        downloadUrl || '#/reports'
      );
    }
  }
  
  // Проверка и запуск авто-отчётов (вызывается при загрузке)
  async function checkAutoReports() {
    try {
      const settings = await AsgardDB.get('settings', 'auto_reports');
      if (!settings?.value_json) return;
      
      const config = JSON.parse(settings.value_json);
      if (!config.enabled) return;
      
      const now = new Date();
      const today = now.getDate();
      const month = now.getMonth() + 1;
      
      // Месячный отчёт - 1 числа
      if (today === 1 && config.monthly) {
        const lastMonth = month === 1 ? 12 : month - 1;
        const lastYear = month === 1 ? now.getFullYear() - 1 : now.getFullYear();
        
        const report = await generateMonthlyReport(lastYear, lastMonth);
        await notifyReportReady('monthly', report.period, '#/reports?type=monthly');
      }
      
      // Квартальный отчёт - 1 января, апреля, июля, октября
      if (today === 1 && [1, 4, 7, 10].includes(month) && config.quarterly) {
        const lastQuarter = month === 1 ? 4 : Math.floor((month - 1) / 3);
        const qYear = month === 1 ? now.getFullYear() - 1 : now.getFullYear();
        
        const report = await generateQuarterlyReport(qYear, lastQuarter);
        await notifyReportReady('quarterly', report.period, '#/reports?type=quarterly');
      }
      
      // Годовой отчёт - 1 января
      if (today === 1 && month === 1 && config.yearly) {
        const report = await generateYearlyReport(now.getFullYear() - 1);
        await notifyReportReady('yearly', report.period, '#/reports?type=yearly');
      }
      
    } catch(e) {
      console.error('checkAutoReports error:', e);
    }
  }
  
  // Вспомогательные функции
  async function getAdmins() {
    const users = await AsgardDB.all('users') || [];
    return users.filter(u => u.role === 'ADMIN' || u.role === 'DIR' || u.role === 'FIN_DIR');
  }
  
  return {
    sendTelegram,
    createSiteNotification,
    notifyUser,
    notifyBonusRequest,
    notifyStaffRequest,
    notifyPurchaseRequest,
    notifyTenderHandoff,
    notifyChatMessage,
    generateMonthlyReport,
    generateQuarterlyReport,
    generateYearlyReport,
    notifyReportReady,
    checkAutoReports,
    getAdmins
  };
})();

// Проверяем авто-отчёты при загрузке
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => AsgardNotify?.checkAutoReports?.(), 5000);
});
