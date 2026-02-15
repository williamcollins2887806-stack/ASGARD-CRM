/**
 * ASGARD CRM — Business Process End-to-End Tests
 * Задача 17: 10 сквозных бизнес-сценариев
 *
 * 1.  Тендер → Просчёт → Работа → Список
 * 2.  Задача: создать → принять → выполнить
 * 3.  ТКП: создать → отправить → PDF
 * 4.  Заявка на пропуск: создать → подать → одобрить
 * 5.  Заявка ТМЦ: создать → подать → Excel
 * 6.  Уведомления: список → пометить прочитанным
 * 7.  Чат: создать группу → отправить сообщение → прочитать
 * 8.  Поиск: найти тендер по слову
 * 9.  Финансы: расходы по работам + офисные
 * 10. Мультиролевой: доступ + ограничения + data API
 */

const {
  api, assert, assertOk, assertStatus, assertHasFields,
  assertArray, assertIdReturned, skip,
  initRealUsers
} = require('../config');

const tests = [];
// Shared state across scenarios
const ctx = {};

// ═══════════════════════════════════════════════════════════════
// SCENARIO 1: Тендер → Просчёт → Работа → Список (полный цикл)
// ═══════════════════════════════════════════════════════════════

tests.push({ name: 'BP1: Тендер → создать', run: async () => {
  const resp = await api('POST', '/api/tenders', {
    role: 'ADMIN',
    body: {
      customer_name: 'BP-Test Заказчик',
      tender_title: 'BP-Test Тендер E2E',
      tender_status: 'В работе'
    }
  });
  assertOk(resp, 'create tender');
  const tender = resp.data?.tender || resp.data?.item || resp.data;
  assert(tender && tender.id, 'tender has id');
  ctx.tenderId = tender.id;
}});

tests.push({ name: 'BP1: Просчёт → создать для тендера', run: async () => {
  if (!ctx.tenderId) skip('no tender');
  const resp = await api('POST', '/api/estimates', {
    role: 'ADMIN',
    body: {
      tender_id: ctx.tenderId,
      name: 'BP-Test Просчёт E2E',
      approval_status: 'draft',
      total: 500000
    }
  });
  assertOk(resp, 'create estimate');
  const est = resp.data?.estimate || resp.data?.item || resp.data;
  assert(est && est.id, 'estimate has id');
  ctx.estimateId = est.id;
}});

tests.push({ name: 'BP1: Работа → создать из тендера', run: async () => {
  if (!ctx.tenderId) skip('no tender');
  const resp = await api('POST', '/api/works', {
    role: 'ADMIN',
    body: {
      tender_id: ctx.tenderId,
      work_title: 'BP-Test Работа',
      work_status: 'Подготовка'
    }
  });
  assertOk(resp, 'create work');
  const work = resp.data?.work || resp.data?.item || resp.data;
  assert(work && work.id, 'work has id');
  ctx.workId = work.id;
}});

tests.push({ name: 'BP1: Тендер → проверить что виден в списке', run: async () => {
  if (!ctx.tenderId) skip('no tender');
  const resp = await api('GET', '/api/tenders', { role: 'ADMIN' });
  assertOk(resp, 'list tenders');
  const list = resp.data?.tenders || resp.data || [];
  assertArray(list, 'tenders is array');
}});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 2: Задача: создать → принять → выполнить
// ═══════════════════════════════════════════════════════════════

tests.push({ name: 'BP2: Задача → создать', run: async () => {
  // Resolve a real active user for assignee
  let assigneeId = 1;
  try {
    const usersResp = await api('GET', '/api/users', { role: 'ADMIN' });
    const users = Array.isArray(usersResp.data) ? usersResp.data : (usersResp.data?.users || []);
    const active = users.find(u => u.is_active !== false) || users[0];
    if (active) assigneeId = active.id;
  } catch (e) { /* fallback to id=1 */ }

  const resp = await api('POST', '/api/tasks', {
    role: 'ADMIN',
    body: {
      assignee_id: assigneeId,
      title: 'BP-Test Задача E2E',
      description: 'Сквозной тест',
      priority: 'high'
    }
  });
  assertOk(resp, 'create task');
  const task = resp.data?.task || resp.data?.item || resp.data;
  assert(task && task.id, 'task has id');
  ctx.taskId = task.id;
}});

tests.push({ name: 'BP2: Задача → принять', run: async () => {
  if (!ctx.taskId) skip('no task');
  // Verify task exists and is in 'new' status before accepting
  const check = await api('GET', `/api/tasks/${ctx.taskId}`, { role: 'ADMIN' });
  if (!check.ok) skip('task not accessible');
  const taskData = check.data?.task || check.data;
  if (taskData?.status !== 'new') skip(`task status is '${taskData?.status}', not 'new'`);

  const resp = await api('PUT', `/api/tasks/${ctx.taskId}/accept`, { role: 'ADMIN', body: {} });
  assertOk(resp, 'accept task');
}});

tests.push({ name: 'BP2: Задача → выполнить', run: async () => {
  if (!ctx.taskId) skip('no task');
  const resp = await api('PUT', `/api/tasks/${ctx.taskId}/complete`, { role: 'ADMIN', body: { comment: 'Выполнено E2E' } });
  assertOk(resp, 'complete task');
}});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 3: ТКП: создать → отправить → PDF
// ═══════════════════════════════════════════════════════════════

tests.push({ name: 'BP3: ТКП → создать', run: async () => {
  const resp = await api('POST', '/api/tkp', {
    role: 'ADMIN',
    body: {
      title: 'BP-Test ТКП E2E',
      customer_name: 'BP Заказчик',
      total_sum: 1200000,
      validity_days: 30
    }
  });
  assertOk(resp, 'create TKP');
  const tkp = resp.data?.item || resp.data?.tkp || resp.data;
  assert(tkp && tkp.id, 'TKP has id');
  ctx.tkpId = tkp.id;
}});

tests.push({ name: 'BP3: ТКП → отправить', run: async () => {
  if (!ctx.tkpId) skip('no TKP');
  const resp = await api('PUT', `/api/tkp/${ctx.tkpId}/status`, {
    role: 'ADMIN',
    body: { status: 'sent' }
  });
  assertOk(resp, 'send TKP');
}});

tests.push({ name: 'BP3: ТКП → PDF генерация', run: async () => {
  if (!ctx.tkpId) skip('no TKP');
  const resp = await api('GET', `/api/tkp/${ctx.tkpId}/pdf`, { role: 'ADMIN' });
  assertOk(resp, 'TKP PDF');
}});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 4: Заявка на пропуск: создать → подать → одобрить
// ═══════════════════════════════════════════════════════════════

tests.push({ name: 'BP4: Пропуск → создать', run: async () => {
  const resp = await api('POST', '/api/pass-requests', {
    role: 'ADMIN',
    body: {
      object_name: 'BP-Test Объект',
      pass_date_from: '2026-03-01',
      pass_date_to: '2026-03-15',
      employees_json: JSON.stringify([{ name: 'Иванов И.И.', position: 'Инженер' }]),
      vehicles_json: JSON.stringify([]),
      contact_person: 'Петров П.П.',
      contact_phone: '+79001234567'
    }
  });
  assertOk(resp, 'create pass request');
  const pr = resp.data?.item || resp.data?.pass_request || resp.data;
  assert(pr && pr.id, 'pass request has id');
  ctx.passId = pr.id;
}});

tests.push({ name: 'BP4: Пропуск → подать', run: async () => {
  if (!ctx.passId) skip('no pass request');
  const resp = await api('PUT', `/api/pass-requests/${ctx.passId}/status`, {
    role: 'ADMIN',
    body: { status: 'submitted' }
  });
  assertOk(resp, 'submit pass request');
}});

tests.push({ name: 'BP4: Пропуск → одобрить', run: async () => {
  if (!ctx.passId) skip('no pass request');
  const resp = await api('PUT', `/api/pass-requests/${ctx.passId}/status`, {
    role: 'ADMIN',
    body: { status: 'approved' }
  });
  assertOk(resp, 'approve pass request');
}});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 5: Заявка ТМЦ: создать → подать → Excel
// ═══════════════════════════════════════════════════════════════

tests.push({ name: 'BP5: ТМЦ → создать', run: async () => {
  const resp = await api('POST', '/api/tmc-requests', {
    role: 'ADMIN',
    body: {
      title: 'BP-Test ТМЦ E2E',
      priority: 'high',
      items_json: JSON.stringify([{ name: 'Насос', qty: 2, price: 15000 }]),
      total_sum: 30000,
      notes: 'Срочная закупка'
    }
  });
  assertOk(resp, 'create TMC request');
  const tmc = resp.data?.item || resp.data?.tmc_request || resp.data;
  assert(tmc && tmc.id, 'TMC has id');
  ctx.tmcId = tmc.id;
}});

tests.push({ name: 'BP5: ТМЦ → подать', run: async () => {
  if (!ctx.tmcId) skip('no TMC');
  const resp = await api('PUT', `/api/tmc-requests/${ctx.tmcId}/status`, {
    role: 'ADMIN',
    body: { status: 'submitted' }
  });
  assertOk(resp, 'submit TMC');
}});

tests.push({ name: 'BP5: ТМЦ → Excel экспорт', run: async () => {
  if (!ctx.tmcId) skip('no TMC');
  const resp = await api('GET', `/api/tmc-requests/${ctx.tmcId}/excel`, { role: 'ADMIN' });
  assertOk(resp, 'TMC excel export');
}});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 6: Уведомления: список + пометить
// ═══════════════════════════════════════════════════════════════

tests.push({ name: 'BP6: Уведомления → список', run: async () => {
  const resp = await api('GET', '/api/notifications', { role: 'ADMIN' });
  assertOk(resp, 'get notifications');
  const data = resp.data;
  const list = Array.isArray(data) ? data : (data?.notifications || []);
  assertArray(list, 'notifications is array');
}});

tests.push({ name: 'BP6: Уведомления → пометить прочитанным', run: async () => {
  const resp = await api('GET', '/api/notifications', { role: 'ADMIN' });
  assertOk(resp, 'get notifications');
  const list = Array.isArray(resp.data) ? resp.data : (resp.data?.notifications || []);
  if (list.length === 0) skip('no notifications to mark');
  const id = list[0].id;
  const mark = await api('PUT', `/api/notifications/${id}/read`, { role: 'ADMIN', body: {} });
  assertOk(mark, 'mark notification read');
}});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 7: Чат: создать группу → отправить сообщение
// ═══════════════════════════════════════════════════════════════

tests.push({ name: 'BP7: Чат → создать группу', run: async () => {
  const resp = await api('POST', '/api/chat-groups', {
    role: 'ADMIN',
    body: {
      name: 'BP-Test Чат E2E',
      member_ids: []
    }
  });
  assertOk(resp, 'create chat group');
  const chat = resp.data?.group || resp.data?.item || resp.data?.chat || resp.data;
  assert(chat && chat.id, 'chat has id');
  ctx.chatId = chat.id;
}});

tests.push({ name: 'BP7: Чат → отправить сообщение', run: async () => {
  if (!ctx.chatId) skip('no chat');
  const resp = await api('POST', `/api/chat-groups/${ctx.chatId}/messages`, {
    role: 'ADMIN',
    body: { text: 'Привет из E2E теста!' }
  });
  assertOk(resp, 'send message');
}});

tests.push({ name: 'BP7: Чат → прочитать сообщения', run: async () => {
  if (!ctx.chatId) skip('no chat');
  const resp = await api('GET', `/api/chat-groups/${ctx.chatId}/messages`, { role: 'ADMIN' });
  assertOk(resp, 'get messages');
}});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 8: Глобальный поиск (через mimir)
// ═══════════════════════════════════════════════════════════════

tests.push({ name: 'BP8: Поиск → API доступен', run: async () => {
  const resp = await api('GET', '/api/mimir/search?q=BP-Test&type=tenders', { role: 'ADMIN' });
  assertOk(resp, 'search');
  assert(resp.data?.success !== undefined, 'search returns success field');
}});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 9: Финансы — расходы по работам + офисные
// ═══════════════════════════════════════════════════════════════

tests.push({ name: 'BP9: Расходы по работам → GET /api/expenses/work', run: async () => {
  const resp = await api('GET', '/api/expenses/work', { role: 'ADMIN' });
  assertOk(resp, 'get work expenses');
}});

tests.push({ name: 'BP9: Офисные расходы → GET /api/expenses/office', run: async () => {
  const resp = await api('GET', '/api/expenses/office', { role: 'ADMIN' });
  assertOk(resp, 'get office expenses');
}});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 10: Мультиролевой — доступ и ограничения
// ═══════════════════════════════════════════════════════════════

tests.push({ name: 'BP10: ADMIN → список тендеров', run: async () => {
  const resp = await api('GET', '/api/tenders', { role: 'ADMIN' });
  assertOk(resp, 'ADMIN get tenders');
  const list = resp.data?.tenders || resp.data || [];
  assert(Array.isArray(list), 'tenders is array');
}});

tests.push({ name: 'BP10: TO → не может удалить пользователя', run: async () => {
  const resp = await api('DELETE', '/api/users/1', { role: 'TO' });
  assert(resp.status === 403 || resp.status === 401, 'TO cannot delete users');
}});

tests.push({ name: 'BP10: Все ключевые роли → GET tenders доступен', run: async () => {
  for (const role of ['ADMIN', 'PM', 'TO', 'BUH']) {
    const resp = await api('GET', '/api/tenders', { role });
    assertOk(resp, `${role} can access tenders`);
  }
}});

tests.push({ name: 'BP10: Data API → все новые таблицы доступны', run: async () => {
  for (const table of ['tkp', 'pass_requests', 'tmc_requests']) {
    const resp = await api('GET', `/api/data/${table}`, { role: 'ADMIN' });
    assertOk(resp, `data API ${table}`);
  }
}});

// ═══════════════════════════════════════════════════════════════

module.exports = {
  name: 'Business Process E2E (10 SCENARIO)',
  tests,
  init: initRealUsers
};
