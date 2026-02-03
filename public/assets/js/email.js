/**
 * АСГАРД CRM — Email интеграция
 * 
 * Функции:
 * - Отправка документов по email
 * - Шаблоны писем
 * - История отправок
 */
window.AsgardEmail = (function(){
  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  
  // Шаблоны писем
  const EMAIL_TEMPLATES = {
    tkp: {
      name: 'Коммерческое предложение',
      subject: 'Коммерческое предложение от ООО «Асгард Сервис»',
      body: `Добрый день!

Направляем Вам коммерческое предложение на выполнение работ.

Детали предложения во вложении.

С уважением,
ООО «Асгард Сервис»
Тел: +7 (XXX) XXX-XX-XX
Email: info@asgard-service.ru`
    },
    invoice: {
      name: 'Счёт на оплату',
      subject: 'Счёт на оплату №{invoice_number}',
      body: `Добрый день!

Направляем Вам счёт на оплату №{invoice_number} от {invoice_date}.
Сумма к оплате: {total_amount}

Счёт во вложении.

С уважением,
ООО «Асгард Сервис»`
    },
    act: {
      name: 'Акт выполненных работ',
      subject: 'Акт выполненных работ №{act_number}',
      body: `Добрый день!

Направляем Вам акт выполненных работ №{act_number} от {act_date}.
Просим подписать и вернуть скан-копию.

С уважением,
ООО «Асгард Сервис»`
    },
    reminder: {
      name: 'Напоминание об оплате',
      subject: 'Напоминание об оплате счёта №{invoice_number}',
      body: `Добрый день!

Напоминаем об оплате счёта №{invoice_number} от {invoice_date}.
Сумма к оплате: {total_amount}
Срок оплаты: {due_date}

Просим произвести оплату в ближайшее время.

С уважением,
ООО «Асгард Сервис»`
    },
    custom: {
      name: 'Произвольное письмо',
      subject: '',
      body: ''
    }
  };
  
  // История отправок
  async function getHistory() {
    return await AsgardDB.all('email_history') || [];
  }
  
  async function saveToHistory(email) {
    email.id = email.id || undefined;
    email.sent_at = new Date().toISOString();
    await AsgardDB.put('email_history', email);
    return email;
  }
  
  // Заполнение шаблона переменными
  function fillTemplate(template, data) {
    let subject = template.subject;
    let body = template.body;
    
    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{${key}}`;
      subject = subject.replace(new RegExp(placeholder, 'g'), value || '');
      body = body.replace(new RegExp(placeholder, 'g'), value || '');
    }
    
    return { subject, body };
  }
  
  // Отправка email через сервер
  async function sendEmail(to, subject, body, attachments = []) {
    try {
      const auth = await AsgardAuth.getAuth();
      const response = await fetch('/api/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (auth?.token || '')
        },
        body: JSON.stringify({ to, subject, body, attachments })
      });
      
      if (response.ok) {
        const result = await response.json();
        
        // Сохраняем в историю
        await saveToHistory({
          to,
          subject,
          body,
          attachments: attachments.map(a => a.name || a),
          status: 'sent',
          user_id: auth?.user?.id
        });
        
        return { success: true, message: 'Письмо отправлено' };
      } else {
        const error = await response.json();
        return { success: false, error: error.message || 'Ошибка отправки' };
      }
    } catch (e) {
      console.error('Email send error:', e);
      return { success: false, error: e.message };
    }
  }
  
  // Модальное окно отправки email
  async function openEmailModal(options = {}) {
    const {
      to = '',
      templateType = 'custom',
      data = {},
      attachments = [],
      entityType = null,
      entityId = null
    } = options;
    
    const template = EMAIL_TEMPLATES[templateType] || EMAIL_TEMPLATES.custom;
    const filled = fillTemplate(template, data);
    
    const templateOptions = Object.entries(EMAIL_TEMPLATES).map(([k, v]) =>
      `<option value="${k}" ${k === templateType ? 'selected' : ''}>${v.name}</option>`
    ).join('');
    
    const html = `
      <div class="stack" style="gap:16px">
        <div class="formrow">
          <div style="grid-column:1/-1">
            <label>Кому (email)</label>
            <input class="inp" id="email_to" type="email" value="${esc(to)}" placeholder="example@company.ru"/>
          </div>
        </div>
        
        <div class="formrow">
          <div>
            <label>Шаблон</label>
            <select class="inp" id="email_template">${templateOptions}</select>
          </div>
        </div>
        
        <div>
          <label>Тема письма</label>
          <input class="inp" id="email_subject" value="${esc(filled.subject)}"/>
        </div>
        
        <div>
          <label>Текст письма</label>
          <textarea class="inp" id="email_body" rows="8" style="font-family:monospace;font-size:13px">${esc(filled.body)}</textarea>
        </div>
        
        <div>
          <label>Вложения</label>
          <div id="email_attachments" class="stack" style="gap:8px">
            ${attachments.length ? attachments.map((a, i) => `
              <div class="row" style="gap:8px;align-items:center">
                <span>📎 ${esc(a.name || a)}</span>
                <button class="btn mini ghost" data-remove-attach="${i}">✕</button>
              </div>
            `).join('') : '<div class="muted">Нет вложений</div>'}
          </div>
          <button class="btn ghost mini" id="btnAddAttach" style="margin-top:8px">+ Добавить файл</button>
        </div>
        
        <div class="row" style="gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn ghost" id="emailCancel">Отмена</button>
          <button class="btn primary" id="emailSend">📤 Отправить</button>
        </div>
      </div>
    `;
    
    showModal('📧 Отправить email', html);
    
    // Смена шаблона
    $('#email_template')?.addEventListener('change', () => {
      const type = $('#email_template').value;
      const tpl = EMAIL_TEMPLATES[type];
      const filled = fillTemplate(tpl, data);
      $('#email_subject').value = filled.subject;
      $('#email_body').value = filled.body;
    });
    
    $('#emailCancel')?.addEventListener('click', closeModal);
    
    $('#emailSend')?.addEventListener('click', async () => {
      const emailTo = $('#email_to').value.trim();
      const subject = $('#email_subject').value.trim();
      const body = $('#email_body').value.trim();
      
      if (!emailTo) {
        toast('Ошибка', 'Укажите email получателя', 'err');
        return;
      }
      
      if (!subject) {
        toast('Ошибка', 'Укажите тему письма', 'err');
        return;
      }
      
      $('#emailSend').disabled = true;
      $('#emailSend').textContent = '⏳ Отправка...';
      
      const result = await sendEmail(emailTo, subject, body, attachments);
      
      $('#emailSend').disabled = false;
      $('#emailSend').textContent = '📤 Отправить';
      
      if (result.success) {
        closeModal();
        toast('Email', 'Письмо отправлено', 'ok');
      } else {
        toast('Ошибка', result.error || 'Не удалось отправить', 'err');
      }
    });
  }
  
  // Отправить счёт по email
  async function sendInvoice(invoiceId) {
    const invoice = await AsgardDB.get('invoices', invoiceId);
    if (!invoice) {
      toast('Ошибка', 'Счёт не найден', 'err');
      return;
    }
    
    // Получаем email заказчика
    let customerEmail = '';
    if (invoice.customer_inn) {
      const customer = await AsgardDB.get('customers', invoice.customer_inn);
      customerEmail = customer?.email || '';
    }
    
    openEmailModal({
      to: customerEmail,
      templateType: 'invoice',
      data: {
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString('ru-RU') : '',
        total_amount: (invoice.total_amount || 0).toLocaleString('ru-RU') + ' ₽',
        due_date: invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('ru-RU') : ''
      },
      entityType: 'invoice',
      entityId: invoiceId
    });
  }
  
  // Отправить акт по email
  async function sendAct(actId) {
    const act = await AsgardDB.get('acts', actId);
    if (!act) {
      toast('Ошибка', 'Акт не найден', 'err');
      return;
    }
    
    let customerEmail = '';
    if (act.customer_inn) {
      const customer = await AsgardDB.get('customers', act.customer_inn);
      customerEmail = customer?.email || '';
    }
    
    openEmailModal({
      to: customerEmail,
      templateType: 'act',
      data: {
        act_number: act.act_number,
        act_date: act.act_date ? new Date(act.act_date).toLocaleDateString('ru-RU') : ''
      },
      entityType: 'act',
      entityId: actId
    });
  }
  
  // Отправить напоминание об оплате
  async function sendPaymentReminder(invoiceId) {
    const invoice = await AsgardDB.get('invoices', invoiceId);
    if (!invoice) return;
    
    let customerEmail = '';
    if (invoice.customer_inn) {
      const customer = await AsgardDB.get('customers', invoice.customer_inn);
      customerEmail = customer?.email || '';
    }
    
    openEmailModal({
      to: customerEmail,
      templateType: 'reminder',
      data: {
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString('ru-RU') : '',
        total_amount: (invoice.total_amount || 0).toLocaleString('ru-RU') + ' ₽',
        due_date: invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('ru-RU') : ''
      },
      entityType: 'invoice',
      entityId: invoiceId
    });
  }
  
  return {
    openEmailModal,
    sendEmail,
    sendInvoice,
    sendAct,
    sendPaymentReminder,
    getHistory,
    fillTemplate,
    EMAIL_TEMPLATES
  };
})();
