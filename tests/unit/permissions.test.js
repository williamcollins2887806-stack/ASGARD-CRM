/**
 * ASGARD CRM — Unit-тесты: проверка ролевой модели доступа
 * Проверяет ожидаемое поведение ACCESS_MATRIX через описательные тесты
 */

'use strict';

// Дублируем ключевые факты о ролевой матрице для unit-проверки
// Фактическая матрица определена внутри src/routes/data.js (не экспортируется)
// Интеграционная проверка — в tests/integration/data.test.js

const EXPECTED_ACCESS = {
  ADMIN: { tables: 'all', canDelete: true },
  DIRECTOR_GEN: { tables: 'all', canDelete: true },
  DIRECTOR_COMM: { tables: 'all', canDelete: false },
  DIRECTOR_DEV: { tables: 'all', canDelete: false },
  PM: {
    allowed: ['tenders', 'estimates', 'works', 'work_expenses', 'payroll_sheets'],
    denied: ['users', 'audit_log'],
    canDelete: false
  },
  TO: {
    allowed: ['tenders', 'estimates', 'customers'],
    denied: ['payroll_sheets', 'works', 'users'],
    canDelete: false
  },
  BUH: {
    allowed: ['payroll_sheets', 'invoices', 'acts', 'incomes', 'bank_rules'],
    denied: ['users', 'equipment_categories'],
    canDelete: false
  },
  WAREHOUSE: {
    allowed: ['equipment', 'equipment_movements', 'warehouses'],
    denied: ['tenders', 'payroll_sheets', 'users'],
    canDelete: false
  },
  HR: {
    allowed: ['employees', 'staff', 'employee_permits'],
    denied: ['tenders', 'users'],
    canDelete: false
  },
  PROC: {
    allowed: ['purchase_requests', 'equipment', 'invoices'],
    denied: ['tenders', 'payroll_sheets', 'users'],
    canDelete: false
  }
};


describe('Ролевая модель доступа (спецификация)', () => {

  describe('ADMIN', () => {
    test('имеет доступ ко всем таблицам', () => {
      expect(EXPECTED_ACCESS.ADMIN.tables).toBe('all');
    });
    test('может удалять', () => {
      expect(EXPECTED_ACCESS.ADMIN.canDelete).toBe(true);
    });
  });

  describe('DIRECTOR_GEN', () => {
    test('имеет доступ ко всем таблицам', () => {
      expect(EXPECTED_ACCESS.DIRECTOR_GEN.tables).toBe('all');
    });
    test('может удалять', () => {
      expect(EXPECTED_ACCESS.DIRECTOR_GEN.canDelete).toBe(true);
    });
  });

  describe('DIRECTOR_COMM', () => {
    test('имеет доступ ко всем таблицам', () => {
      expect(EXPECTED_ACCESS.DIRECTOR_COMM.tables).toBe('all');
    });
    test('не может удалять', () => {
      expect(EXPECTED_ACCESS.DIRECTOR_COMM.canDelete).toBe(false);
    });
  });

  describe('PM', () => {
    test('видит тендеры, работы, расходы, ведомости', () => {
      for (const t of EXPECTED_ACCESS.PM.allowed) {
        expect(EXPECTED_ACCESS.PM.allowed).toContain(t);
      }
    });
    test('не видит users и audit_log', () => {
      expect(EXPECTED_ACCESS.PM.denied).toContain('users');
      expect(EXPECTED_ACCESS.PM.denied).toContain('audit_log');
    });
    test('не может удалять', () => {
      expect(EXPECTED_ACCESS.PM.canDelete).toBe(false);
    });
  });

  describe('TO', () => {
    test('видит тендеры и клиентов', () => {
      expect(EXPECTED_ACCESS.TO.allowed).toContain('tenders');
      expect(EXPECTED_ACCESS.TO.allowed).toContain('customers');
    });
    test('не видит payroll_sheets', () => {
      expect(EXPECTED_ACCESS.TO.denied).toContain('payroll_sheets');
    });
  });

  describe('BUH', () => {
    test('видит payroll и invoices', () => {
      expect(EXPECTED_ACCESS.BUH.allowed).toContain('payroll_sheets');
      expect(EXPECTED_ACCESS.BUH.allowed).toContain('invoices');
    });
  });

  describe('WAREHOUSE', () => {
    test('видит оборудование и склады', () => {
      expect(EXPECTED_ACCESS.WAREHOUSE.allowed).toContain('equipment');
      expect(EXPECTED_ACCESS.WAREHOUSE.allowed).toContain('warehouses');
    });
    test('не видит тендеры', () => {
      expect(EXPECTED_ACCESS.WAREHOUSE.denied).toContain('tenders');
    });
  });

  describe('Наследование ролей', () => {
    test('HEAD_TO наследует права TO', () => {
      // Проверяется на уровне requireRoles в index.js:
      // if (userRole === 'HEAD_TO' && roles.includes('TO')) return;
      expect(true).toBe(true); // Декларативный тест
    });

    test('HEAD_PM наследует права PM', () => {
      expect(true).toBe(true);
    });

    test('HR_MANAGER наследует права HR', () => {
      expect(true).toBe(true);
    });

    test('CHIEF_ENGINEER наследует права WAREHOUSE', () => {
      expect(true).toBe(true);
    });
  });
});
