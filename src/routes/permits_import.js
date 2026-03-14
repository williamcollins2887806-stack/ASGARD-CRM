'use strict';

/**
 * Импорт допусков из Excel — дополнительные роуты
 * Подключается из основного permits.js
 */

const ExcelJS = require('exceljs');

module.exports = function registerImportRoutes(fastify, db) {

  // ═══════════════════════════════════════════════════════════════
  // GET /api/permits/import-template — Скачать шаблон Excel
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/import-template', {
    preHandler: [fastify.requirePermission('permits', 'write')]
  }, async (request, reply) => {
    const { rows: types } = await db.query(
      'SELECT id, name, code, category, validity_months FROM permit_types WHERE is_active = true ORDER BY sort_order'
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ASGARD CRM';
    workbook.created = new Date();

    // Лист 1: Шаблон для заполнения
    const sheet = workbook.addWorksheet('Импорт допусков', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    });

    sheet.columns = [
      { header: 'ФИО сотрудника', key: 'fio', width: 35 },
      { header: 'Тип допуска', key: 'type', width: 40 },
      { header: 'Номер удостоверения', key: 'doc_number', width: 22 },
      { header: 'Кем выдан', key: 'issuer', width: 30 },
      { header: 'Дата выдачи (ДД.ММ.ГГГГ)', key: 'issue_date', width: 22 },
      { header: 'Дата окончания (ДД.ММ.ГГГГ)', key: 'expiry_date', width: 22 },
      { header: 'Примечания', key: 'notes', width: 25 }
    ];

    // Стили заголовков
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3358' } };
    headerRow.alignment = { vertical: 'middle', wrapText: true };
    headerRow.height = 30;

    // Пример строки
    sheet.addRow({
      fio: 'Иванов Иван Иванович',
      type: 'Электробезопасность (III группа)',
      doc_number: 'ЭБ-2024-001',
      issuer: 'Учебный центр',
      issue_date: '15.01.2024',
      expiry_date: '15.01.2025',
      notes: 'Пример (удалите эту строку)'
    });
    const exRow = sheet.getRow(2);
    exRow.font = { italic: true, color: { argb: 'FF888888' } };

    // Валидация: выпадающий список типов допусков
    const refRange = "'Справочник'!$A$2:$A$" + (types.length + 1);
    for (let r = 2; r <= 500; r++) {
      sheet.getCell('B' + r).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [refRange],
        showErrorMessage: true,
        errorTitle: 'Неверный тип',
        error: 'Выберите тип допуска из списка или перейдите на лист "Справочник"'
      };
    }

    // Лист 2: Справочник типов допусков
    const refSheet = workbook.addWorksheet('Справочник');
    refSheet.columns = [
      { header: 'Тип допуска', key: 'name', width: 40 },
      { header: 'Код', key: 'code', width: 15 },
      { header: 'Категория', key: 'category', width: 15 },
      { header: 'Срок (мес.)', key: 'months', width: 12 },
      { header: 'ID', key: 'id', width: 8 }
    ];
    const refHeader = refSheet.getRow(1);
    refHeader.font = { bold: true };
    refHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };

    const catNames = {
      safety: 'Безопасность', electric: 'Электрика', special: 'Спецработы',
      medical: 'Медицина', attest: 'Аттестация', offshore: 'Шельф',
      gas: 'Газоопасные', transport: 'Транспорт'
    };

    types.forEach(t => {
      refSheet.addRow({
        name: t.name,
        code: t.code,
        category: catNames[t.category] || t.category,
        months: t.validity_months || 'Бессрочный',
        id: t.id
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = encodeURIComponent('Шаблон_импорта_допусков.xlsx');
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', "attachment; filename=\"template.xlsx\"; filename*=UTF-8''" + filename)
      .send(Buffer.from(buffer));
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /api/permits/import-excel — Импорт допусков из Excel
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/import-excel', {
    preHandler: [fastify.requirePermission('permits', 'write')]
  }, async (request, reply) => {
    const parts = request.parts();
    let fileBuffer = null;

    for await (const part of parts) {
      if (part.file) {
        fileBuffer = await part.toBuffer();
      }
    }

    if (!fileBuffer) {
      return reply.code(400).send({ error: 'Файл не передан' });
    }

    // Загрузить типы и сотрудников для маппинга
    const { rows: types } = await db.query(
      'SELECT id, name, code, category FROM permit_types WHERE is_active = true'
    );
    const { rows: employees } = await db.query(
      'SELECT id, fio, full_name FROM employees WHERE is_active = true'
    );

    // Построить карты для поиска
    const typeByName = new Map();
    const typeByCode = new Map();
    types.forEach(t => {
      typeByName.set(t.name.toLowerCase().trim(), t);
      if (t.code) typeByCode.set(t.code.toLowerCase().trim(), t);
    });

    // Нечёткий поиск типа допуска
    function findType(str) {
      if (!str) return null;
      const s = str.toLowerCase().trim();
      if (typeByName.has(s)) return typeByName.get(s);
      if (typeByCode.has(s)) return typeByCode.get(s);
      for (const [name, t] of typeByName) {
        if (name.includes(s) || s.includes(name)) return t;
      }
      const keywords = {
        'высот': 'HEIGHT', 'электро': 'EB', 'отзп': 'OTZP', 'замкн': 'OTZP',
        'босиет': 'BOSIET', 'рукав': 'SLEEVE', 'мед.осмотр': 'MEDCHECK', 'медицинский': 'MEDCHECK',
        'охран': 'OT', 'пожар': 'PTM', 'птм': 'PTM', 'сиз': 'SIZ',
        'бмпо': 'BMPO', 'бмпво': 'BMPVO', 'накс': 'NAKS',
        'промбез': 'PROMBEZ', 'промышл': 'PROMBEZ',
        'драгер': 'DRAGER', 'фсб': 'FSB', 'пропуск': 'FSB',
        'score': 'SCORE', 'вик': 'VIK', 'пмп': 'PMP', 'первая помощь': 'PMP',
        'квалиф': 'QUAL', 'корь': 'MED_MEASLES', 'пцр': 'MED_PCR',
        'антител': 'MED_ANTIBODIES', 'умо': 'UMO', 'углубл': 'UMO'
      };
      for (const [kw, code] of Object.entries(keywords)) {
        if (s.includes(kw)) {
          const groupMatch = s.match(/(\d+)\s*группа|группа\s*(\d+)/i);
          const romanMatch = s.match(/(II|III|IV|V)\b/);
          let group = null;
          if (groupMatch) group = groupMatch[1] || groupMatch[2];
          if (!group && romanMatch) {
            const roman = { 'II': '2', 'III': '3', 'IV': '4', 'V': '5' };
            group = roman[romanMatch[1]];
          }
          if (group && ['HEIGHT', 'EB', 'OTZP'].includes(code)) {
            const fullCode = (code + '_' + group).toLowerCase();
            if (typeByCode.has(fullCode)) return typeByCode.get(fullCode);
          }
          if (typeByCode.has(code.toLowerCase())) return typeByCode.get(code.toLowerCase());
        }
      }
      return null;
    }

    function findEmployee(fio) {
      if (!fio) return null;
      const s = fio.toLowerCase().trim();
      for (const e of employees) {
        if ((e.fio || '').toLowerCase().trim() === s) return e;
        if ((e.full_name || '').toLowerCase().trim() === s) return e;
      }
      const parts = s.split(/\s+/);
      if (parts.length >= 1) {
        const surname = parts[0];
        for (const e of employees) {
          const eFio = (e.fio || '').toLowerCase();
          if (eFio.startsWith(surname + ' ')) return e;
        }
      }
      return null;
    }

    function parseDate(val) {
      if (!val) return null;
      if (val instanceof Date) {
        if (isNaN(val.getTime())) return null;
        return val.toISOString().slice(0, 10);
      }
      const s = String(val).trim();
      const m1 = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (m1) return m1[3] + '-' + m1[2] + '-' + m1[1];
      const m2 = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
      if (m2) {
        const y = parseInt(m2[3]) < 50 ? '20' + m2[3] : '19' + m2[3];
        return y + '-' + m2[2] + '-' + m2[1];
      }
      const m3 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m3) return m3[1] + '-' + m3[2] + '-' + m3[3];
      return null;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(fileBuffer);

      const sheet = workbook.getWorksheet(1);
      if (!sheet) {
        return reply.code(400).send({ error: 'Excel файл пуст или повреждён' });
      }

      const results = { created: 0, errors: [], skipped: 0 };
      const dataRows = [];

      sheet.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const fio = String(row.getCell(1).value || '').trim();
        const typeStr = String(row.getCell(2).value || '').trim();
        const docNumber = String(row.getCell(3).value || '').trim();
        const issuer = String(row.getCell(4).value || '').trim();
        const issueDateRaw = row.getCell(5).value;
        const expiryDateRaw = row.getCell(6).value;
        const notes = String(row.getCell(7).value || '').trim();
        if (!fio && !typeStr) return;
        dataRows.push({ rowNum, fio, typeStr, docNumber, issuer, issueDateRaw, expiryDateRaw, notes });
      });

      for (const r of dataRows) {
        const emp = findEmployee(r.fio);
        if (!emp) {
          results.errors.push({ row: r.rowNum, fio: r.fio, error: 'Сотрудник не найден' });
          continue;
        }
        const type = findType(r.typeStr);
        if (!type) {
          results.errors.push({ row: r.rowNum, fio: r.fio, type: r.typeStr, error: 'Тип допуска не найден' });
          continue;
        }
        const issueDate = parseDate(r.issueDateRaw);
        const expiryDate = parseDate(r.expiryDateRaw);
        if (r.notes && r.notes.includes('удалите эту строку')) {
          results.skipped++;
          continue;
        }
        try {
          // Check for duplicate (same employee + type + expiry)
          const { rows: existing } = await db.query(
            'SELECT id FROM employee_permits WHERE employee_id = $1 AND type_id = $2 AND expiry_date IS NOT DISTINCT FROM $3 AND is_active = true',
            [emp.id, type.id, expiryDate]
          );
          if (existing.length > 0) {
            results.skipped++;
            results.errors.push({ row: r.rowNum, fio: r.fio, error: 'Дубликат: такой допуск уже существует' });
            continue;
          }
          await db.query(
            'INSERT INTO employee_permits (employee_id, type_id, category, doc_number, issuer, issue_date, expiry_date, notes, is_active, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, NOW(), NOW())',
            [emp.id, type.id, type.category, r.docNumber || null, r.issuer || null, issueDate, expiryDate, r.notes || null, (request.user && request.user.id) || null]
          );
          results.created++;
        } catch (err) {
          results.errors.push({ row: r.rowNum, fio: r.fio, error: err.message });
        }
      }

      return {
        success: true,
        total_rows: dataRows.length,
        created: results.created,
        skipped: results.skipped,
        errors: results.errors.length,
        error_details: results.errors.slice(0, 50)
      };
    } catch (err) {
      return reply.code(500).send({ error: 'Ошибка обработки Excel: ' + err.message });
    }
  });
};
