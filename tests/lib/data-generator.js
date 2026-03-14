/**
 * Test data factories - generates TEST_AUTO_ prefixed data for all entity types
 */

const { TEST_PREFIX } = require('../config');

let _counter = 0;
function uid() { return `${Date.now()}_${++_counter}`; }

function futureDate(daysAhead = 30) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0];
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPhone() {
  return `+7${randomInt(900, 999)}${String(randomInt(1000000, 9999999))}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Entity factories
// ═══════════════════════════════════════════════════════════════════════════

function tender(overrides = {}) {
  const id = uid();
  return {
    customer_name: `${TEST_PREFIX}Customer_${id}`,
    tender_title: `${TEST_PREFIX}Tender_${id}`,
    tender_type: 'Текущий ремонт',
    tender_status: 'Драфт',
    docs_deadline: futureDate(30),
    budget_estimate: randomInt(100000, 5000000),
    period: currentPeriod(),
    group_tag: `${TEST_PREFIX}Group`,
    ...overrides,
  };
}

function work(overrides = {}) {
  const id = uid();
  return {
    work_title: `${TEST_PREFIX}Work_${id}`,
    work_status: 'Подготовка',
    customer_name: `${TEST_PREFIX}Customer_${id}`,
    contract_sum: randomInt(50000, 2000000),
    start_date: new Date().toISOString().split('T')[0],
    start_plan: futureDate(7),
    end_date_plan: futureDate(60),
    ...overrides,
  };
}

function workExpense(workId, overrides = {}) {
  const id = uid();
  return {
    work_id: workId,
    expense_type: 'Материалы',
    amount: randomInt(10000, 500000),
    description: `${TEST_PREFIX}Expense_${id}`,
    date: new Date().toISOString().split('T')[0],
    ...overrides,
  };
}

function invoice(overrides = {}) {
  const id = uid();
  return {
    invoice_number: `${TEST_PREFIX}INV_${id}`,
    comment: `${TEST_PREFIX}Invoice_${id}`,
    amount: randomInt(50000, 1000000),
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: futureDate(30),
    status: 'Новый',
    ...overrides,
  };
}

function act(overrides = {}) {
  const id = uid();
  return {
    name: `${TEST_PREFIX}Act_${id}`,
    act_number: `ACT-${TEST_PREFIX}${id}`,
    amount: randomInt(50000, 1000000),
    act_date: new Date().toISOString().split('T')[0],
    status: 'Новый',
    ...overrides,
  };
}

function cashRequest(overrides = {}) {
  const id = uid();
  return {
    purpose: `${TEST_PREFIX}Cash_${id}`,
    amount: randomInt(10000, 500000),
    urgency: 'Обычная',
    status: 'Новая',
    ...overrides,
  };
}

function employee(overrides = {}) {
  const id = uid();
  return {
    full_name: `${TEST_PREFIX}Employee_${id}`,
    phone: randomPhone(),
    email: `test_auto_${id}@example.com`,
    position: 'Тестовая должность',
    department: 'Тестовый отдел',
    hire_date: new Date().toISOString().split('T')[0],
    birth_date: '1990-01-15',
    status: 'Работает',
    inn: `${randomInt(100000000000, 999999999999)}`,
    passport_series: `${randomInt(1000, 9999)}`,
    passport_number: `${randomInt(100000, 999999)}`,
    address: `${TEST_PREFIX}Address_${id}`,
    ...overrides,
  };
}

function permit(overrides = {}) {
  const id = uid();
  return {
    permit_name: `${TEST_PREFIX}Permit_${id}`,
    permit_type: 'Допуск к работам',
    issue_date: new Date().toISOString().split('T')[0],
    expiry_date: futureDate(365),
    status: 'Действующий',
    ...overrides,
  };
}

function equipment(overrides = {}) {
  const id = uid();
  return {
    name: `${TEST_PREFIX}Equipment_${id}`,
    inventory_number: `INV-${TEST_PREFIX}${id}`,
    category: 'Инструмент',
    status: 'В наличии',
    location: 'Склад',
    ...overrides,
  };
}

function task(overrides = {}) {
  const id = uid();
  return {
    title: `${TEST_PREFIX}Task_${id}`,
    description: `${TEST_PREFIX}TaskDescription_${id}`,
    status: 'Новая',
    priority: 'Обычный',
    due_date: futureDate(7),
    ...overrides,
  };
}

function calendarEvent(overrides = {}) {
  const id = uid();
  return {
    title: `${TEST_PREFIX}Event_${id}`,
    description: `${TEST_PREFIX}EventDescription_${id}`,
    start_date: futureDate(1),
    end_date: futureDate(1),
    event_type: 'Встреча',
    ...overrides,
  };
}

function customer(overrides = {}) {
  const id = uid();
  return {
    name: `${TEST_PREFIX}Customer_${id}`,
    inn: `${randomInt(1000000000, 9999999999)}`,
    phone: randomPhone(),
    email: `test_auto_customer_${id}@example.com`,
    address: `${TEST_PREFIX}Address_${id}`,
    ...overrides,
  };
}

function payrollSheet(overrides = {}) {
  const id = uid();
  return {
    name: `${TEST_PREFIX}Payroll_${id}`,
    period: currentPeriod(),
    status: 'Черновик',
    ...overrides,
  };
}

function purchaseRequest(overrides = {}) {
  const id = uid();
  return {
    title: `${TEST_PREFIX}Purchase_${id}`,
    description: `${TEST_PREFIX}PurchaseDesc_${id}`,
    amount: randomInt(5000, 200000),
    status: 'Новая',
    ...overrides,
  };
}

function bonusRequest(overrides = {}) {
  const id = uid();
  return {
    reason: `${TEST_PREFIX}Bonus_${id}`,
    amount: randomInt(5000, 100000),
    status: 'Новая',
    ...overrides,
  };
}

function staffPlan(overrides = {}) {
  const id = uid();
  return {
    position: `${TEST_PREFIX}Position_${id}`,
    department: 'Тестовый отдел',
    count: randomInt(1, 5),
    ...overrides,
  };
}

module.exports = {
  uid,
  futureDate,
  currentPeriod,
  randomInt,
  randomPhone,
  tender,
  work,
  workExpense,
  invoice,
  act,
  cashRequest,
  employee,
  permit,
  equipment,
  task,
  calendarEvent,
  customer,
  payrollSheet,
  purchaseRequest,
  bonusRequest,
  staffPlan,
  TEST_PREFIX,
};
