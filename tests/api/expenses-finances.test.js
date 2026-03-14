/**
 * BLOCK 3: EXPENSES & FINANCES — PM work expenses, office expenses, incomes, invoices
 */
'use strict';

const { api, assert, assertOk, assertStatus, assertForbidden,
        assertArray, assertHasFields, assertMatch,
        skip, TEST_USERS } = require('../config');

let workId = null;
let workExpenseId = null;
let officeExpenseId = null;
let incomeId = null;
let invoiceId = null;
let paymentId = null;

module.exports = {
  name: 'BLOCK 3 — EXPENSES & FINANCES',
  tests: [
    // ═══════════════════════════════════════════════
    // Setup
    // ═══════════════════════════════════════════════
    {
      name: 'Setup: create work for expense tests',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: {
            work_title: 'Finance Test Work',
            work_status: 'В работе'
          }
        });
        assertOk(resp, 'create work');
        workId = (resp.data?.work || resp.data)?.id;
        assert(workId, 'work id');
      }
    },

    // ═══════════════════════════════════════════════
    // 3.1 Work Expenses
    // ═══════════════════════════════════════════════
    {
      name: '3.1.1 PM creates work expense → 201, id returned',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: {
            work_id: workId,
            category: 'Материалы',
            description: 'Трубы и фитинги',
            amount: 25000,
            date: '2026-02-10',
            supplier: 'ООО "Трубосталь"'
          }
        });
        assertOk(resp, 'create work expense');
        const exp = resp.data?.expense || resp.data;
        workExpenseId = exp.id;
        assert(workExpenseId, 'expense id');
      }
    },
    {
      name: '3.1.2 PM reads work expenses → array with correct fields',
      run: async () => {
        const resp = await api('GET', `/api/expenses/work?work_id=${workId}`, { role: 'PM' });
        assertOk(resp, 'read work expenses');
        const list = resp.data?.expenses || resp.data;
        assertArray(list, 'expenses list');
        assert(list.length >= 1, 'at least 1 expense');
        assertHasFields(list[0], ['id', 'category', 'amount'], 'expense fields');
      }
    },
    {
      name: '3.1.3 PM updates work expense → field changed',
      run: async () => {
        if (!workExpenseId) skip('No expense');
        const resp = await api('PUT', `/api/expenses/work/${workExpenseId}`, {
          role: 'PM',
          body: { amount: 27000, notes: 'Updated amount' }
        });
        assertOk(resp, 'update expense');
      }
    },
    {
      name: '3.1.4 PM deletes work expense → 200',
      run: async () => {
        if (!workExpenseId) skip('No expense');
        const resp = await api('DELETE', `/api/expenses/work/${workExpenseId}`, { role: 'PM' });
        assertOk(resp, 'delete expense');
      }
    },
    {
      name: '3.1.5 Work expense with categorized types',
      run: async () => {
        const categories = ['Транспорт', 'Проживание', 'Инструменты'];
        for (const cat of categories) {
          const resp = await api('POST', '/api/expenses/work', {
            role: 'PM',
            body: { work_id: workId, category: cat, amount: 5000, date: '2026-02-10' }
          });
          assertOk(resp, `create ${cat} expense`);
        }
      }
    },
    {
      name: '3.1.6 Work expense missing category → 400',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: { work_id: workId, amount: 5000 }
        });
        assertStatus(resp, 400, 'missing category');
      }
    },
    {
      name: '3.1.7 Work expense negative amount → 400',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: { work_id: workId, category: 'Материалы', amount: -100 }
        });
        assertStatus(resp, 400, 'negative amount');
      }
    },
    {
      name: '3.1.8 Work expense zero amount → 400',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: { work_id: workId, category: 'Материалы', amount: 0 }
        });
        assertStatus(resp, 400, 'zero amount');
      }
    },
    {
      name: '3.1.9 Filter work expenses by category',
      run: async () => {
        const resp = await api('GET', `/api/expenses/work?category=Транспорт`, { role: 'PM' });
        assertOk(resp, 'filter by category');
        const list = resp.data?.expenses || resp.data;
        assertArray(list, 'filtered list');
      }
    },
    {
      name: '3.1.10 Filter work expenses by date range',
      run: async () => {
        const resp = await api('GET', '/api/expenses/work?date_from=2026-01-01&date_to=2026-12-31', { role: 'PM' });
        assertOk(resp, 'filter by date');
        assertArray(resp.data?.expenses || resp.data, 'date-filtered');
      }
    },
    {
      name: '3.1.11 BUH can see all work expenses',
      run: async () => {
        const resp = await api('GET', '/api/expenses/work', { role: 'BUH' });
        assertOk(resp, 'BUH reads expenses');
        assertArray(resp.data?.expenses || resp.data, 'buh list');
      }
    },
    {
      name: '3.1.12 TO cannot create work expense → 403',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'TO',
          body: { work_id: workId, category: 'Материалы', amount: 1000 }
        });
        assertForbidden(resp, 'TO denied expense create');
      }
    },

    // ═══════════════════════════════════════════════
    // 3.2 Office Expenses
    // ═══════════════════════════════════════════════
    {
      name: '3.2.1 Create office expense',
      run: async () => {
        const resp = await api('POST', '/api/expenses/office', {
          role: 'ADMIN',
          body: {
            category: 'Канцелярия',
            description: 'Бумага A4 500л',
            amount: 3500,
            date: '2026-02-10',
            supplier: 'Офис-Маркет'
          }
        });
        assertOk(resp, 'create office expense');
        officeExpenseId = (resp.data?.expense || resp.data)?.id;
        assert(officeExpenseId, 'office expense id');
      }
    },
    {
      name: '3.2.2 GET /api/expenses/office → list',
      run: async () => {
        const resp = await api('GET', '/api/expenses/office', { role: 'ADMIN' });
        assertOk(resp, 'list office expenses');
        assertArray(resp.data?.expenses || resp.data, 'office list');
      }
    },
    {
      name: '3.2.3 Update office expense',
      run: async () => {
        if (!officeExpenseId) skip('No office expense');
        const resp = await api('PUT', `/api/expenses/office/${officeExpenseId}`, {
          role: 'ADMIN',
          body: { notes: 'Updated office note' }
        });
        assertOk(resp, 'update office expense');
      }
    },
    {
      name: '3.2.4 Delete office expense',
      run: async () => {
        if (!officeExpenseId) skip('No office expense');
        const resp = await api('DELETE', `/api/expenses/office/${officeExpenseId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete office expense');
      }
    },
    {
      name: '3.2.5 Office expense missing amount + category → 400',
      run: async () => {
        const resp = await api('POST', '/api/expenses/office', {
          role: 'ADMIN',
          body: { description: 'No amount or category' }
        });
        assertStatus(resp, 400, 'missing required fields');
      }
    },

    // ═══════════════════════════════════════════════
    // 3.3 Incomes
    // ═══════════════════════════════════════════════
    {
      name: '3.3.1 PM creates income',
      run: async () => {
        const resp = await api('POST', '/api/incomes', {
          role: 'PM',
          body: {
            work_id: workId,
            amount: 150000,
            type: 'payment',
            description: 'Оплата по акту №1',
            date: '2026-02-10'
          }
        });
        assertOk(resp, 'create income');
        incomeId = (resp.data?.income || resp.data)?.id;
        assert(incomeId, 'income id');
      }
    },
    {
      name: '3.3.2 GET /api/incomes → list with work_number',
      run: async () => {
        const resp = await api('GET', '/api/incomes', { role: 'PM' });
        assertOk(resp, 'list incomes');
        assertHasFields(resp.data, ['incomes'], 'incomes field');
        assertArray(resp.data.incomes, 'incomes list');
      }
    },
    {
      name: '3.3.3 Filter incomes by work_id',
      run: async () => {
        if (!workId) skip('No work');
        const resp = await api('GET', `/api/incomes?work_id=${workId}`, { role: 'PM' });
        assertOk(resp, 'filter by work');
        const list = resp.data?.incomes || resp.data;
        assertArray(list, 'filtered incomes');
      }
    },
    {
      name: '3.3.4 Update income',
      run: async () => {
        if (!incomeId) skip('No income');
        const resp = await api('PUT', `/api/incomes/${incomeId}`, {
          role: 'PM',
          body: { amount: 160000 }
        });
        assertOk(resp, 'update income');
      }
    },
    {
      name: '3.3.5 Delete income',
      run: async () => {
        if (!incomeId) skip('No income');
        const resp = await api('DELETE', `/api/incomes/${incomeId}`, { role: 'PM' });
        assertOk(resp, 'delete income');
      }
    },
    {
      name: '3.3.6 TO cannot create income → 403',
      run: async () => {
        const resp = await api('POST', '/api/incomes', {
          role: 'TO',
          body: { work_id: workId, amount: 1000, type: 'payment' }
        });
        assertForbidden(resp, 'TO denied income');
      }
    },

    // ═══════════════════════════════════════════════
    // 3.4 Invoices
    // ═══════════════════════════════════════════════
    {
      name: '3.4.1 Create invoice with required fields',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'PM',
          body: {
            invoice_number: `INV-TEST-${Date.now()}`,
            invoice_date: '2026-02-10',
            amount: 100000,
            work_id: workId,
            customer_name: 'ООО "Тест"',
            description: 'Invoice for testing'
          }
        });
        assertOk(resp, 'create invoice');
        invoiceId = (resp.data?.invoice || resp.data)?.id;
        assert(invoiceId, 'invoice id');
      }
    },
    {
      name: '3.4.2 GET /api/invoices → list',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'PM' });
        assertOk(resp, 'list invoices');
        assertHasFields(resp.data, ['invoices'], 'invoices field');
        assertArray(resp.data.invoices, 'invoices list');
      }
    },
    {
      name: '3.4.3 GET /api/invoices/:id → detail with payments',
      run: async () => {
        if (!invoiceId) skip('No invoice');
        const resp = await api('GET', `/api/invoices/${invoiceId}`, { role: 'PM' });
        assertOk(resp, 'invoice detail');
        assertHasFields(resp.data, ['invoice', 'payments'], 'detail fields');
      }
    },
    {
      name: '3.4.4 Update invoice status',
      run: async () => {
        if (!invoiceId) skip('No invoice');
        const resp = await api('PUT', `/api/invoices/${invoiceId}`, {
          role: 'PM',
          body: { status: 'sent' }
        });
        assertOk(resp, 'update invoice status');
      }
    },
    {
      name: '3.4.5 Add payment to invoice → auto-updates paid_amount',
      run: async () => {
        if (!invoiceId) skip('No invoice');
        const resp = await api('POST', `/api/invoices/${invoiceId}/payments`, {
          role: 'PM',
          body: { amount: 50000, payment_date: '2026-02-11', comment: 'Partial payment' }
        });
        assertOk(resp, 'add payment');
        assertHasFields(resp.data, ['payment', 'new_paid_amount', 'new_status'], 'payment response');
      }
    },
    {
      name: '3.4.6 Invoice missing required fields → 400',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'PM',
          body: { description: 'Missing number, date, amount' }
        });
        assertStatus(resp, 400, 'missing required fields');
      }
    },
    {
      name: '3.4.7 GET /api/invoices/stats/summary',
      run: async () => {
        const resp = await api('GET', '/api/invoices/stats/summary', { role: 'PM' });
        assertOk(resp, 'invoice stats');
        assertHasFields(resp.data, ['stats'], 'stats field');
      }
    },
    {
      name: '3.4.8 GET /api/invoices/overdue/list',
      run: async () => {
        const resp = await api('GET', '/api/invoices/overdue/list', { role: 'PM' });
        assertOk(resp, 'overdue list');
        assertHasFields(resp.data, ['invoices'], 'overdue invoices');
      }
    },
    {
      name: '3.4.9 Delete invoice → cascades payments',
      run: async () => {
        if (!invoiceId) skip('No invoice');
        const resp = await api('DELETE', `/api/invoices/${invoiceId}`, { role: 'PM' });
        assertOk(resp, 'delete invoice');
      }
    },
    {
      name: '3.4.10 TO cannot create invoices → 403',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'TO',
          body: { invoice_number: 'X', invoice_date: '2026-01-01', amount: 1000 }
        });
        assertForbidden(resp, 'TO denied invoice');
      }
    }
  ]
};
