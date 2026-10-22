'use strict';
/**
 * D-340: тесты автосоздания договора. Главное — «не создать, когда нельзя».
 * Ложный договор хуже отсутствующего: он врёт, что основание проверено.
 */
const assert = require('assert');
const { ensureContractFromInvoice } = require('../src/services/contract-auto');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); fail++; }
}

/** Мок БД: настраивается на каждый сценарий. */
function makeDb(cfg = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push(String(sql).trim().split('\n')[0].slice(0, 60));
      const s = String(sql);
      if (/^BEGIN|^COMMIT|^ROLLBACK/.test(s.trim())) return { rows: [] };
      // Поиск matchContract (точный номер)
      if (/FROM contracts/.test(s) && /lower\(regexp_replace/.test(s) && !/INSERT/.test(s)) {
        return { rows: cfg.matchRows || [] };
      }
      // Вторая проверка внутри транзакции
      if (/FROM contracts/.test(s) && /LIMIT 1/.test(s) && !/INSERT/.test(s)) {
        return { rows: cfg.recheckRows || [] };
      }
      if (/INSERT INTO contracts/.test(s)) {
        if (cfg.insertError) { const e = new Error('boom'); e.code = cfg.insertError; throw e; }
        return { rows: [{ id: 999, number: params[0], counterparty_name: params[1], customer_inn: params[2] }] };
      }
      return { rows: [] };
    }
  };
}

(async () => {
  console.log('=== 1. МАТЧ НАЙДЕН → не создаём ===');
  await t('договор уже есть → action=exists', async () => {
    const db = makeDb({ matchRows: [{ id: 5, number: '1302АСГ-УО/У-ХВ', customer_inn: '6101006049' }] });
    const r = await ensureContractFromInvoice(db, {
      number: '1302АСГ-УО/У-ХВ', counterpartyInn: '6101006049', counterpartyName: 'ООО "Утилизация отходов"'
    });
    assert.strictEqual(r.action, 'exists');
    assert.strictEqual(r.contract.id, 5);
  });

  console.log('\n=== 2. ОТКАЗНЫЕ ПРИЧИНЫ → не создаём ===');
  await t('без номера → skipped', async () => {
    const db = makeDb({});
    const r = await ensureContractFromInvoice(db, { number: '', counterpartyInn: '6101006049' });
    assert.strictEqual(r.action, 'skipped');
    assert.strictEqual(r.reason, 'no_number');
  });

  await t('номер занят другим контрагентом → skipped, не создаём', async () => {
    // matchContract вернёт number_taken_by_other_counterparty
    const db = {
      query: async (sql) => {
        const s = String(sql);
        if (/FROM contracts/.test(s) && !/INSERT/.test(s)) {
          return { rows: [{ id: 77, number: '56201', customer_inn: '7704469592' }] };
        }
        return { rows: [] };
      }
    };
    const r = await ensureContractFromInvoice(db, {
      number: '56201', counterpartyInn: '3015042714', counterpartyName: 'ООО "Электротехническая компания"'
    });
    assert.strictEqual(r.action, 'skipped', 'должен отказаться: номер принадлежит другому');
    assert.strictEqual(r.reason, 'number_taken_by_other_counterparty');
  });

  await t('без ИНН → skipped (нельзя доказать, что номер не чужой)', async () => {
    const db = makeDb({});
    const r = await ensureContractFromInvoice(db, {
      number: 'УНИКАЛЬНЫЙ-999', counterpartyInn: null, counterpartyName: 'ООО "Без ИНН"'
    });
    assert.strictEqual(r.action, 'skipped');
    assert.strictEqual(r.reason, 'no_inn');
  });

  await t('без названия контрагента → skipped', async () => {
    const db = makeDb({});
    const r = await ensureContractFromInvoice(db, {
      number: 'УНИКАЛЬНЫЙ-888', counterpartyInn: '6101006049', counterpartyName: ''
    });
    assert.strictEqual(r.action, 'skipped');
    assert.strictEqual(r.reason, 'no_counterparty');
  });

  console.log('\n=== 3. ДОГОВОРА ТОЧНО НЕТ → создаём ===');
  await t('новый договор создаётся с ИНН и пометкой', async () => {
    let inserted = null;
    const db = {
      query: async (sql, params) => {
        const s = String(sql);
        if (/^BEGIN|^COMMIT|^ROLLBACK/.test(s.trim())) return { rows: [] };
        if (/INSERT INTO contracts/.test(s)) { inserted = params; return { rows: [{ id: 1001, number: params[0] }] }; }
        return { rows: [] };   // matchContract и recheck — пусто
      }
    };
    const r = await ensureContractFromInvoice(db, {
      number: '1302АСГ-УО/У-ХВ', counterpartyInn: '6101006049',
      counterpartyName: 'ООО "УТИЛИЗАЦИЯ ОТХОДОВ"', amount: 62850, date: '2026-10-22', docId: 1599
    });
    assert.strictEqual(r.action, 'created');
    assert.ok(inserted, 'INSERT должен выполниться');
    assert.strictEqual(inserted[0], '1302АСГ-УО/У-ХВ');
    assert.strictEqual(inserted[2], '6101006049');
    assert.ok(String(inserted[5]).includes('Создан автоматически'), 'пометка о происхождении');
    assert.ok(String(inserted[5]).includes('#1599'), 'ссылка на счёт-источник');
  });

  console.log('\n=== 4. ГОНКА ===');
  await t('после BEGIN договор уже появился → exists, второй не создаём', async () => {
    let insertCalled = false;
    const db = {
      query: async (sql) => {
        const s = String(sql);
        if (/^BEGIN|^COMMIT|^ROLLBACK/.test(s.trim())) return { rows: [] };
        if (/INSERT INTO contracts/.test(s)) { insertCalled = true; return { rows: [{ id: 1 }] }; }
        // matchContract (точный номер, есть lower(regexp_replace...)) → пусто
        if (/lower\(regexp_replace/.test(s)) return { rows: [] };
        // вторая проверка внутри транзакции (есть customer_inn = $2) → уже создан
        if (/customer_inn/.test(s) && /LIMIT 1/.test(s)) {
          return { rows: [{ id: 555, number: 'X', customer_inn: '6101006049' }] };
        }
        return { rows: [] };
      }
    };
    const r = await ensureContractFromInvoice(db, {
      number: 'X-777', counterpartyInn: '6101006049', counterpartyName: 'ООО Тест'
    });
    assert.strictEqual(r.action, 'exists');
    assert.strictEqual(r.reason, 'race_recheck');
    assert.strictEqual(insertCalled, false, 'INSERT не должен вызываться');
  });

  await t('UNIQUE-конфликт при вставке → exists через перечитку', async () => {
    let recheckCount = 0;
    const db = {
      query: async (sql) => {
        const s = String(sql);
        if (/^BEGIN|^COMMIT|^ROLLBACK/.test(s.trim())) return { rows: [] };
        if (/INSERT INTO contracts/.test(s)) { const e = new Error('dup'); e.code = '23505'; throw e; }
        if (/lower\(regexp_replace/.test(s)) return { rows: [] };   // matchContract пусто
        if (/customer_inn/.test(s) && /LIMIT 1/.test(s)) {
          recheckCount++;
          // первая перечитка (в транзакции) — пусто; после UNIQUE — нашлась строка
          return { rows: recheckCount > 1 ? [{ id: 777, number: 'Y' }] : [] };
        }
        return { rows: [] };
      }
    };
    const r = await ensureContractFromInvoice(db, {
      number: 'Y-888', counterpartyInn: '6101006049', counterpartyName: 'ООО Тест'
    });
    assert.strictEqual(r.action, 'exists');
    assert.strictEqual(r.reason, 'unique_violation');
  });

  console.log('\n=== 5. DRY-RUN ===');
  await t('dry-run не пишет в БД', async () => {
    let insertCalled = false;
    const db = {
      query: async (sql) => {
        if (/INSERT/.test(String(sql))) { insertCalled = true; }
        return { rows: [] };
      }
    };
    const r = await ensureContractFromInvoice(db, {
      number: 'DRY-1', counterpartyInn: '6101006049', counterpartyName: 'ООО Тест'
    }, { dryRun: true });
    assert.strictEqual(r.action, 'created');
    assert.strictEqual(insertCalled, false);
  });

  console.log('\n=== 6. Нормализация номера совпадает с поиском ===');
  await t('«№ 1302АСГ-УО/У-ХВ» ищется тем же каноном', async () => {
    const { normContractNo } = require('../src/services/contract-match');
    const a = normContractNo('№ 1302АСГ-УО/У-ХВ');
    const b = normContractNo('1302АСГ-УО/У-ХВ');
    assert.strictEqual(a, b, 'номер с «№» и без должны нормализоваться одинаково');
  });

  console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
  if (fail) process.exitCode = 1;
})();
