// Stage 21: Экспорт в Excel (XLSX)
// Использует SheetJS (xlsx) или простой CSV fallback

window.AsgardExport = (function(){
  
  // Генерация CSV
  function toCSV(headers, rows){
    const escape = (val) => {
      if(val === null || val === undefined) return '';
      const str = String(val);
      if(str.includes(',') || str.includes('"') || str.includes('\n')){
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    
    const lines = [headers.map(escape).join(',')];
    for(const row of rows){
      lines.push(row.map(escape).join(','));
    }
    return '\ufeff' + lines.join('\r\n'); // BOM for Excel
  }

  // Скачивание файла
  function download(content, filename, type = 'text/csv;charset=utf-8'){
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Форматирование даты
  function fmtDate(d){
    if(!d) return '';
    const dt = new Date(d);
    if(isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('ru-RU');
  }

  // Форматирование денег
  function fmtMoney(n){
    if(n === null || n === undefined || n === '') return '';
    const num = Number(n);
    if(isNaN(num)) return String(n);
    return num.toLocaleString('ru-RU');
  }

  // ============================================
  // Экспорт тендеров
  // ============================================
  async function exportTenders(filters = {}){
    const tenders = await AsgardDB.all('tenders');
    const users = await AsgardDB.all('users');
    const usersMap = new Map(users.map(u => [u.id, u.name || u.login]));

    let filtered = tenders;
    if(filters.year) filtered = filtered.filter(t => t.year === filters.year);
    if(filters.status) filtered = filtered.filter(t => t.tender_status === filters.status);

    const headers = ['Период', 'Год', 'Заказчик', 'Название тендера', 'Статус', 'Цена', 'PM', 'Причина отказа'];
    const rows = filtered.map(t => [
      t.period || '',
      t.year || '',
      t.customer_name || '',
      t.tender_title || '',
      t.tender_status || '',
      fmtMoney(t.tender_price),
      usersMap.get(t.responsible_pm_id) || '',
      t.reject_reason || ''
    ]);

    const csv = toCSV(headers, rows);
    const filename = `tenders_${filters.year || 'all'}_${new Date().toISOString().slice(0,10)}.csv`;
    download(csv, filename);
    
    return { count: rows.length, filename };
  }

  // ============================================
  // Экспорт работ
  // ============================================
  async function exportWorks(filters = {}){
    const works = await AsgardDB.all('works');
    const users = await AsgardDB.all('users');
    const usersMap = new Map(users.map(u => [u.id, u.name || u.login]));

    let filtered = works;
    if(filters.year){
      filtered = filtered.filter(w => {
        const d = w.work_start_fact || w.work_start_plan;
        return d && new Date(d).getFullYear() === filters.year;
      });
    }
    if(filters.status) filtered = filtered.filter(w => w.work_status === filters.status);

    const headers = ['Название', 'Статус', 'PM', 'Старт (план)', 'Старт (факт)', 'Окончание (план)', 'Окончание (факт)', 'Контракт', 'План', 'Факт'];
    const rows = filtered.map(w => [
      w.work_title || '',
      w.work_status || '',
      usersMap.get(w.pm_id) || '',
      fmtDate(w.work_start_plan),
      fmtDate(w.work_start_fact),
      fmtDate(w.work_end_plan),
      fmtDate(w.work_end_fact),
      fmtMoney(w.contract_sum),
      fmtMoney(w.plan_total),
      fmtMoney(w.fact_total)
    ]);

    const csv = toCSV(headers, rows);
    const filename = `works_${filters.year || 'all'}_${new Date().toISOString().slice(0,10)}.csv`;
    download(csv, filename);
    
    return { count: rows.length, filename };
  }

  // ============================================
  // Экспорт расходов по работам
  // ============================================
  async function exportWorkExpenses(filters = {}){
    let expenses = [];
    try { expenses = await AsgardDB.all('work_expenses'); } catch(e){}
    
    const works = await AsgardDB.all('works');
    const users = await AsgardDB.all('users');
    const worksMap = new Map(works.map(w => [w.id, w.work_title || `Работа #${w.id}`]));
    const usersMap = new Map(users.map(u => [u.id, u.name || u.login]));

    let filtered = expenses;
    if(filters.year){
      filtered = filtered.filter(e => {
        const d = e.date;
        return d && new Date(d).getFullYear() === filters.year;
      });
    }
    if(filters.workId) filtered = filtered.filter(e => e.work_id === filters.workId);

    const headers = ['Дата', 'Работа', 'Категория', 'Описание', 'Сумма', 'Создал'];
    const rows = filtered.map(e => [
      fmtDate(e.date),
      worksMap.get(e.work_id) || '',
      e.category || '',
      e.description || '',
      fmtMoney(e.amount),
      usersMap.get(e.created_by) || ''
    ]);

    const csv = toCSV(headers, rows);
    const filename = `work_expenses_${new Date().toISOString().slice(0,10)}.csv`;
    download(csv, filename);
    
    return { count: rows.length, filename };
  }

  // ============================================
  // Экспорт офисных расходов
  // ============================================
  async function exportOfficeExpenses(filters = {}){
    let expenses = [];
    try { expenses = await AsgardDB.all('office_expenses'); } catch(e){}
    
    const users = await AsgardDB.all('users');
    const usersMap = new Map(users.map(u => [u.id, u.name || u.login]));

    let filtered = expenses;
    if(filters.year){
      filtered = filtered.filter(e => {
        const d = e.date;
        return d && new Date(d).getFullYear() === filters.year;
      });
    }

    const headers = ['Дата', 'Категория', 'Описание', 'Сумма', 'Статус', 'Создал'];
    const rows = filtered.map(e => [
      fmtDate(e.date),
      e.category || '',
      e.description || '',
      fmtMoney(e.amount),
      e.status || '',
      usersMap.get(e.created_by) || ''
    ]);

    const csv = toCSV(headers, rows);
    const filename = `office_expenses_${new Date().toISOString().slice(0,10)}.csv`;
    download(csv, filename);
    
    return { count: rows.length, filename };
  }

  // ============================================
  // Экспорт командировочных расходов
  // ============================================
  async function exportTravelExpenses(filters = {}){
    let expenses = [];
    try { expenses = await AsgardDB.all('travel_expenses'); } catch(e){}
    
    const works = await AsgardDB.all('works');
    const employees = await AsgardDB.all('employees');
    const users = await AsgardDB.all('users');
    const worksMap = new Map(works.map(w => [w.id, w.work_title || `Работа #${w.id}`]));
    const employeesMap = new Map(employees.map(e => [e.id, e.fio || `Сотрудник #${e.id}`]));
    const usersMap = new Map(users.map(u => [u.id, u.name || u.login]));

    let filtered = expenses;
    if(filters.year){
      filtered = filtered.filter(e => {
        const d = e.date;
        return d && new Date(d).getFullYear() === filters.year;
      });
    }

    const headers = ['Дата', 'Тип', 'Работа', 'Сотрудник', 'Описание', 'Сумма', 'Поставщик', 'Создал'];
    const rows = filtered.map(e => [
      fmtDate(e.date),
      e.expense_type || '',
      worksMap.get(e.work_id) || '',
      employeesMap.get(e.employee_id) || '',
      e.description || '',
      fmtMoney(e.amount),
      e.supplier || '',
      usersMap.get(e.created_by) || ''
    ]);

    const csv = toCSV(headers, rows);
    const filename = `travel_expenses_${new Date().toISOString().slice(0,10)}.csv`;
    download(csv, filename);
    
    return { count: rows.length, filename };
  }

  // ============================================
  // Экспорт сотрудников
  // ============================================
  async function exportEmployees(){
    const employees = await AsgardDB.all('employees');

    const headers = ['ФИО', 'Роль', 'Разряд', 'Дата рождения', 'Телефон', 'Паспорт', 'Активен'];
    const rows = employees.map(e => [
      e.fio || '',
      e.role || '',
      e.grade || '',
      fmtDate(e.birth_date),
      e.phone || '',
      e.passport_data || '',
      e.is_active ? 'Да' : 'Нет'
    ]);

    const csv = toCSV(headers, rows);
    const filename = `employees_${new Date().toISOString().slice(0,10)}.csv`;
    download(csv, filename);
    
    return { count: rows.length, filename };
  }

  // ============================================
  // Экспорт пользователей
  // ============================================
  async function exportUsers(){
    const users = await AsgardDB.all('users');

    const headers = ['Логин', 'Имя', 'Роль', 'Дата рождения', 'Трудоустройство', 'Активен', 'Заблокирован', 'Последний вход'];
    const rows = users.map(u => [
      u.login || '',
      u.name || '',
      u.role || '',
      fmtDate(u.birth_date),
      fmtDate(u.employment_date),
      u.is_active ? 'Да' : 'Нет',
      u.is_blocked ? 'Да' : 'Нет',
      fmtDate(u.last_login_at)
    ]);

    const csv = toCSV(headers, rows);
    const filename = `users_${new Date().toISOString().slice(0,10)}.csv`;
    download(csv, filename);
    
    return { count: rows.length, filename };
  }

  // ============================================
  // Экспорт корреспонденции
  // ============================================
  async function exportCorrespondence(filters = {}){
    let items = [];
    try { items = await AsgardDB.all('correspondence'); } catch(e){}

    let filtered = items;
    if(filters.year){
      filtered = filtered.filter(c => {
        const d = c.date;
        return d && new Date(d).getFullYear() === filters.year;
      });
    }
    if(filters.direction) filtered = filtered.filter(c => c.direction === filters.direction);

    const headers = ['Дата', 'Номер', 'Направление', 'Тип', 'Контрагент', 'Тема', 'Примечание'];
    const rows = filtered.map(c => [
      fmtDate(c.date),
      c.number || '',
      c.direction === 'in' ? 'Входящий' : 'Исходящий',
      c.doc_type || '',
      c.counterparty || '',
      c.subject || '',
      c.note || ''
    ]);

    const csv = toCSV(headers, rows);
    const filename = `correspondence_${new Date().toISOString().slice(0,10)}.csv`;
    download(csv, filename);
    
    return { count: rows.length, filename };
  }

  // ============================================
  // Сводный отчёт (дашборд)
  // ============================================
  async function exportDashboard(year){
    const currentYear = year || new Date().getFullYear();
    
    const [tenders, works, workExpenses, officeExpenses, travelExpenses] = await Promise.all([
      AsgardDB.all('tenders'),
      AsgardDB.all('works'),
      AsgardDB.all('work_expenses').catch(() => []),
      AsgardDB.all('office_expenses').catch(() => []),
      AsgardDB.all('travel_expenses').catch(() => [])
    ]);

    const yearTenders = tenders.filter(t => t.year === currentYear);
    const yearWorks = works.filter(w => {
      const d = w.work_start_fact || w.work_start_plan;
      return d && new Date(d).getFullYear() === currentYear;
    });

    const stats = {
      'Тендеры: всего': yearTenders.length,
      'Тендеры: выиграно': yearTenders.filter(t => t.tender_status === 'Клиент согласился').length,
      'Тендеры: проиграно': yearTenders.filter(t => t.tender_status === 'Клиент отказался').length,
      'Работы: всего': yearWorks.length,
      'Работы: завершено': yearWorks.filter(w => w.work_status === 'Работы сдали').length,
      'Работы: проблемы': yearWorks.filter(w => w.work_status === 'Проблема').length,
      'Выручка (контракты)': yearWorks.reduce((s, w) => s + (Number(w.contract_sum) || 0), 0),
      'План (расходы)': yearWorks.reduce((s, w) => s + (Number(w.plan_total) || 0), 0),
      'Факт (расходы)': yearWorks.reduce((s, w) => s + (Number(w.fact_total) || 0), 0),
      'Расходы по работам': workExpenses.filter(e => e.date && new Date(e.date).getFullYear() === currentYear).reduce((s, e) => s + (Number(e.amount) || 0), 0),
      'Офисные расходы': officeExpenses.filter(e => e.date && new Date(e.date).getFullYear() === currentYear).reduce((s, e) => s + (Number(e.amount) || 0), 0),
      'Командировочные': travelExpenses.filter(e => e.date && new Date(e.date).getFullYear() === currentYear).reduce((s, e) => s + (Number(e.amount) || 0), 0)
    };

    const headers = ['Показатель', 'Значение'];
    const rows = Object.entries(stats).map(([k, v]) => [k, typeof v === 'number' ? fmtMoney(v) : v]);

    const csv = toCSV(headers, rows);
    const filename = `dashboard_${currentYear}_${new Date().toISOString().slice(0,10)}.csv`;
    download(csv, filename);
    
    return { count: rows.length, filename };
  }

  return {
    toCSV,
    download,
    exportTenders,
    exportWorks,
    exportWorkExpenses,
    exportOfficeExpenses,
    exportTravelExpenses,
    exportEmployees,
    exportUsers,
    exportCorrespondence,
    exportDashboard
  };
})();
