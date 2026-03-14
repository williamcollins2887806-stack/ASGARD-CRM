// ============================================================================
// АСГАРД CRM — Профессиональный Excel-экспорт из Рунического Калькулятора
// Формат: полный отчёт «Просчёт стоимости работ» для директора / печати А4
// Библиотека: xlsx-js-style (поддержка стилей ячеек)
// ============================================================================

(function() {
  'use strict';

  // ═══════════════════════════════════════════
  // Сумма прописью (русский язык)
  // ═══════════════════════════════════════════
  function sumInWords(n) {
    n = Math.round(Math.abs(n));
    if (n === 0) return 'Ноль рублей 00 копеек';
    const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять',
      'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
      'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
    const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
    const hunds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
    function group(num, fem) {
      let r = '';
      const h = Math.floor(num / 100), t = Math.floor((num % 100) / 10), o = num % 10;
      if (h) r += hunds[h] + ' ';
      if (t >= 2) { r += tens[t] + ' '; if (o) r += (fem && o <= 2 ? (o === 1 ? 'одна' : 'две') : ones[o]) + ' '; }
      else if (num % 100 >= 1 && num % 100 <= 19) { r += (fem && num % 100 <= 2 ? (num % 100 === 1 ? 'одна' : 'две') : ones[num % 100]) + ' '; }
      return r;
    }
    function decline(n, f1, f2, f5) {
      const m = n % 100;
      if (m >= 11 && m <= 19) return f5;
      const d = m % 10;
      if (d === 1) return f1;
      if (d >= 2 && d <= 4) return f2;
      return f5;
    }
    let result = '';
    const billions = Math.floor(n / 1e9);
    const millions = Math.floor((n % 1e9) / 1e6);
    const thousands = Math.floor((n % 1e6) / 1e3);
    const remainder = n % 1e3;
    if (billions) result += group(billions, false) + decline(billions, 'миллиард ', 'миллиарда ', 'миллиардов ');
    if (millions) result += group(millions, false) + decline(millions, 'миллион ', 'миллиона ', 'миллионов ');
    if (thousands) result += group(thousands, true) + decline(thousands, 'тысяча ', 'тысячи ', 'тысяч ');
    if (remainder) result += group(remainder, false);
    result = result.trim();
    result += ' ' + decline(remainder || (thousands ? thousands : 0), 'рубль', 'рубля', 'рублей') + ' 00 копеек';
    return result.charAt(0).toUpperCase() + result.slice(1);
  }

  // ═══════════════════════════════════════════
  // Хелпер: установить стиль ячейки
  // ═══════════════════════════════════════════
  function sc(ws, r, c, style) {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (!ws[ref]) ws[ref] = { v: '', t: 's' };
    ws[ref].s = style;
  }

  function scRange(ws, r1, c1, r2, c2, style) {
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        sc(ws, r, c, style);
      }
    }
  }

  function setNumFmt(ws, r, c, fmt) {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (ws[ref]) ws[ref].z = fmt;
  }

  // ═══════════════════════════════════════════
  // Стили (ASGARD Brand: темно-синий + золото)
  // ═══════════════════════════════════════════
  const BRAND_DARK  = '0D1428';  // Основной тёмно-синий
  const BRAND_NAVY  = '1A2D52';  // Шапка таблицы
  const BRAND_GOLD  = 'C8A85C';  // Золотой акцент
  const BRAND_LIGHT = 'F2F6FC';  // Светлый фон чередования
  const WHITE       = 'FFFFFF';
  const GRAY_TEXT   = '666666';
  const BLACK       = '000000';
  const GOLD_FILL   = 'FFF8E7';  // Очень светлый золотой

  const BORDER_THIN = {
    top:    { style: 'thin', color: { rgb: '999999' } },
    bottom: { style: 'thin', color: { rgb: '999999' } },
    left:   { style: 'thin', color: { rgb: '999999' } },
    right:  { style: 'thin', color: { rgb: '999999' } }
  };
  const BORDER_MEDIUM = {
    top:    { style: 'medium', color: { rgb: BRAND_NAVY } },
    bottom: { style: 'medium', color: { rgb: BRAND_NAVY } },
    left:   { style: 'medium', color: { rgb: BRAND_NAVY } },
    right:  { style: 'medium', color: { rgb: BRAND_NAVY } }
  };
  const BORDER_BOTTOM_DOUBLE = {
    top:    { style: 'thin', color: { rgb: '999999' } },
    bottom: { style: 'double', color: { rgb: BRAND_NAVY } },
    left:   { style: 'thin', color: { rgb: '999999' } },
    right:  { style: 'thin', color: { rgb: '999999' } }
  };
  const BORDER_TOP_MEDIUM = {
    top:    { style: 'medium', color: { rgb: BRAND_NAVY } },
    bottom: { style: 'thin', color: { rgb: '999999' } },
    left:   { style: 'thin', color: { rgb: '999999' } },
    right:  { style: 'thin', color: { rgb: '999999' } }
  };

  const FMT_NUM  = '#,##0';
  const FMT_NUM2 = '#,##0.00';

  // ═══════════════════════════════════════════
  // Главная функция экспорта
  // ═══════════════════════════════════════════
  window._asgardCalcExcelExport = function(st, s, sum, toast) {

    // Fallback на txt если XLSX не загружен
    if (typeof XLSX === 'undefined') {
      const money = (n) => Math.round(Number(n || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' р.';
      const txt = [
        'АСГАРД СЕРВИС',
        '═══════════════════════════════════════',
        'ПРОСЧЁТ СТОИМОСТИ РАБОТ',
        '',
        'Заказчик: ' + (st.customer_name || '—'),
        'Объект: ' + (st.tender_title || '—'),
        'Город: ' + (st.city || '—') + ' (' + (st.distance_km || 0) + ' км)',
        'Бригада: ' + sum.people_count + ' чел',
        'Сроки: ' + sum.work_days + ' дней',
        '',
        'Цена без НДС: ' + money(sum.price_no_vat),
        'НДС ' + sum.vat_pct + '%: ' + money(sum.price_with_vat - sum.price_no_vat),
        'ИТОГО С НДС: ' + money(sum.price_with_vat),
        '',
        'Дата: ' + new Date().toLocaleDateString('ru-RU')
      ].join('\n');
      const blob = new Blob([txt], { type: 'text/plain' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'calc_' + (st.tender_id || 'new') + '.txt'; a.click();
      toast('Экспорт', 'Файл скачан (TXT — XLSX не загружен)');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();
      const dateNow = new Date().toLocaleDateString('ru-RU');
      const wt = s.work_types ? s.work_types.find(function(w) { return w.id === st.work_type_id; }) : null;
      const vatPct = sum.vat_pct || 22;
      const vatMult = vatPct / 100;

      // ════════════════════════════════════════════════════════════
      //  ЛИСТ 1: ПРОСЧЁТ СТОИМОСТИ РАБОТ (основной отчёт)
      //  8 колонок: №, Наименование, Ед.изм., Кол-во,
      //             Цена без НДС, Сумма без НДС, НДС, Сумма с НДС
      // ════════════════════════════════════════════════════════════

      // --- Строки данных (расчёт сумм) ---
      function line(n, name, unit, qty, priceNoVat) {
        const sumNoVat = Math.round(priceNoVat);
        const vatAmt   = Math.round(sumNoVat * vatMult);
        const sumVat   = sumNoVat + vatAmt;
        const unitPrice = qty > 0 ? Math.round(sumNoVat / qty) : 0;
        return [n, name, unit, qty, unitPrice, sumNoVat, vatAmt, sumVat];
      }

      // Себестоимость по статьям -> пересчёт в цену через маржу
      // Цена без НДС = себестоимость / (1 - margin%)
      // Для каждой статьи: доля_статьи_в_себестоимости * price_no_vat
      const costTotal = sum.cost_total || 1;
      function priceShare(costItem) {
        return Math.round((costItem / costTotal) * sum.price_no_vat);
      }

      var dataRows = [
        line(1,  'Фонд оплаты труда (работа, подготовка, демобилизация)', 'чел-дн', sum.people_count * sum.total_days, priceShare(sum.payroll_total)),
        line(2,  'Налоги и отчисления на ФОТ (' + (s.fot_tax_pct || 50) + '%)', 'усл.',   1, priceShare(sum.fot_tax)),
        line(3,  'Суточные', 'чел-дн', sum.people_count * sum.total_days, priceShare(sum.per_diem_total)),
        line(4,  'Проживание', 'чел-дн', sum.people_count * sum.total_days, priceShare(sum.lodging_total)),
        line(5,  'Мобилизация / демобилизация персонала', 'чел',   sum.people_count * 2, priceShare(sum.mobilization_total)),
        line(6,  'Химические реагенты и составы', 'компл.', 1, priceShare(sum.chem_total)),
        line(7,  'Расходные материалы', 'компл.', 1, priceShare(sum.consumables)),
        line(8,  'Оборудование и инструмент', 'компл.', 1, priceShare(sum.equip_total)),
        line(9,  'Логистика (' + (sum.transport ? sum.transport.name : 'авто') + ', ' + (st.distance_km || 0) + ' км x 2)', 'рейс', 1, priceShare(sum.logistics_total)),
        line(10, 'Средства индивидуальной защиты (СИЗ)', 'чел',   sum.people_count, priceShare(sum.ppe_total)),
        line(11, 'Накладные расходы (' + (sum.overhead_pct || 10) + '%)', 'усл.',   1, priceShare(sum.overhead))
      ];

      // Итоги
      var totalNoVat = Math.round(sum.price_no_vat);
      var totalVatAmt = Math.round(sum.price_with_vat - sum.price_no_vat);
      var totalWithVat = Math.round(sum.price_with_vat);

      // --- Сборка данных листа ---
      // ROW 0: пустая (место для лого)
      // ROW 1: АСГАРД СЕРВИС
      // ROW 2: Полное наименование
      // ROW 3: Адрес
      // ROW 4: Контакты
      // ROW 5: пустая
      // ROW 6: линия-разделитель (gold)
      // ROW 7: ПРОСЧЁТ СТОИМОСТИ РАБОТ
      // ROW 8: линия-разделитель (gold)
      // ROW 9: пустая
      // ROW 10: Заказчик:  ...         Дата:  ...
      // ROW 11: Объект:    ...         Вид работ: ...
      // ROW 12: Город:     ...         Бригада: ... чел, ... дней
      // ROW 13: пустая
      // ROW 14: шапка таблицы
      // ROW 15-25: данные (11 строк)
      // ROW 26: ИТОГО без НДС
      // ROW 27: НДС
      // ROW 28: ИТОГО С НДС
      // ROW 29: пустая
      // ROW 30: Сумма прописью
      // ROW 31: пустая
      // ROW 32: Допущения (если есть)
      // ROW 33: пустая
      // ROW 34: Подпись
      // ROW 35: пустая
      // ROW 36: Footer (реквизиты)
      // ROW 37: Footer (контакты)

      var aoa = [];
      // Row 0 — logo placeholder
      aoa.push(['', '', '', '', '', '', '', '']);
      // Row 1 — company name
      aoa.push(['АСГАРД СЕРВИС', '', '', '', '', '', '', '']);
      // Row 2 — full legal name
      aoa.push(['ООО "Асгард-Сервис"', '', '', '', '', '', '', '']);
      // Row 3 — address
      aoa.push(['Большая Почтовая ул., д. 55/59, стр. 1, помещ. №37, Москва, 105082', '', '', '', '', '', '', '']);
      // Row 4 — contacts
      aoa.push(['Тел.: +7 (499) 322-30-62  |  info@asgard-service.ru  |  www.asgard-service.ru', '', '', '', '', '', '', '']);
      // Row 5 — empty
      aoa.push(['', '', '', '', '', '', '', '']);
      // Row 6 — decorative line (merged)
      aoa.push(['', '', '', '', '', '', '', '']);
      // Row 7 — report title
      aoa.push(['ПРОСЧЁТ СТОИМОСТИ РАБОТ', '', '', '', '', '', '', '']);
      // Row 8 — decorative line (merged)
      aoa.push(['', '', '', '', '', '', '', '']);
      // Row 9 — empty
      aoa.push(['', '', '', '', '', '', '', '']);
      // Row 10 — client info left + date right
      aoa.push(['Заказчик:', st.customer_name || '—', '', '', '', 'Дата расчёта:', dateNow, '']);
      // Row 11 — object + work type
      aoa.push(['Объект:', st.tender_title || '—', '', '', '', 'Вид работ:', (wt ? wt.name : '—'), '']);
      // Row 12 — city + crew summary
      aoa.push(['Город:', (st.city || '—') + (st.distance_km ? ' (' + st.distance_km + ' км)' : ''), '', '', '', 'Бригада:', sum.people_count + ' чел, ' + sum.total_days + ' дней', '']);
      // Row 13 — empty
      aoa.push(['', '', '', '', '', '', '', '']);
      // Row 14 — table header
      aoa.push(['№', 'Наименование работ / услуг', 'Ед. изм.', 'Кол-во', 'Цена без НДС, руб.', 'Сумма без НДС, руб.', 'НДС (' + vatPct + '%), руб.', 'Сумма с НДС, руб.']);
      // Rows 15-25 — data (11 rows)
      for (var i = 0; i < dataRows.length; i++) {
        aoa.push(dataRows[i]);
      }
      // Row 26 — subtotal (no VAT)
      aoa.push(['', 'Итого без НДС:', '', '', '', totalNoVat, '', '']);
      // Row 27 — VAT
      aoa.push(['', 'НДС (' + vatPct + '%):', '', '', '', '', totalVatAmt, '']);
      // Row 28 — TOTAL with VAT
      aoa.push(['', 'ИТОГО С НДС:', '', '', '', '', '', totalWithVat]);
      // Row 29 — empty
      aoa.push(['', '', '', '', '', '', '', '']);
      // Row 30 — sum in words
      aoa.push(['Итого к оплате: ' + sumInWords(totalWithVat), '', '', '', '', '', '', '']);
      // Row 31 — empty
      aoa.push(['', '', '', '', '', '', '', '']);

      var assumptionsRow = -1;
      if (st.assumptions && st.assumptions.trim()) {
        // Row 32 — assumptions header + text
        aoa.push(['Допущения и примечания: ' + st.assumptions.trim(), '', '', '', '', '', '', '']);
        assumptionsRow = aoa.length - 1;
        aoa.push(['', '', '', '', '', '', '', '']);
      }

      // Signature row
      var signRow = aoa.length;
      aoa.push(['Расчёт подготовил:', '', '_____________________', '', '/', '_____________________', '/', '']);
      aoa.push(['', '', '(подпись)', '', '', '(Ф.И.О.)', '', '']);

      // Empty row
      aoa.push(['', '', '', '', '', '', '', '']);

      // Footer — company details
      var footerRow1 = aoa.length;
      aoa.push(['ООО "Асгард-Сервис"  |  ИНН: 7736244785  |  КПП: 770101001  |  ОГРН: 1157746216498', '', '', '', '', '', '', '']);
      var footerRow2 = aoa.length;
      aoa.push(['Тел.: +7 (499) 322-30-62  |  info@asgard-service.ru  |  Большая Почтовая ул., д. 55/59, стр. 1, Москва, 105082', '', '', '', '', '', '', '']);

      // --- Создание листа ---
      var ws = XLSX.utils.aoa_to_sheet(aoa);

      // --- Ширины столбцов (оптимизировано для А4 альбомная) ---
      ws['!cols'] = [
        { wch: 4  },  // A: №
        { wch: 38 },  // B: Наименование
        { wch: 8  },  // C: Ед.изм.
        { wch: 8  },  // D: Кол-во
        { wch: 15 },  // E: Цена без НДС
        { wch: 16 },  // F: Сумма без НДС
        { wch: 14 },  // G: НДС
        { wch: 16 }   // H: Сумма с НДС
      ];

      // --- Высоты строк ---
      ws['!rows'] = [];
      ws['!rows'][0]  = { hpt: 50 };  // Logo area
      ws['!rows'][1]  = { hpt: 28 };  // Company name
      ws['!rows'][6]  = { hpt: 4 };   // Gold line
      ws['!rows'][7]  = { hpt: 30 };  // Title
      ws['!rows'][8]  = { hpt: 4 };   // Gold line
      ws['!rows'][14] = { hpt: 36 };  // Table header (tall for wrapping)

      // --- Merge cells ---
      ws['!merges'] = [
        // Header area (cols A-H merged)
        { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },   // Logo row
        { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },   // Company name
        { s: { r: 2, c: 0 }, e: { r: 2, c: 7 } },   // Legal name
        { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } },   // Address
        { s: { r: 4, c: 0 }, e: { r: 4, c: 7 } },   // Contacts
        { s: { r: 6, c: 0 }, e: { r: 6, c: 7 } },   // Gold line
        { s: { r: 7, c: 0 }, e: { r: 7, c: 7 } },   // Title
        { s: { r: 8, c: 0 }, e: { r: 8, c: 7 } },   // Gold line

        // Info rows: left side B-E merged, right side G-H merged
        { s: { r: 10, c: 1 }, e: { r: 10, c: 4 } },
        { s: { r: 11, c: 1 }, e: { r: 11, c: 4 } },
        { s: { r: 12, c: 1 }, e: { r: 12, c: 4 } },

        // Totals: "Итого без НДС" label B-E
        { s: { r: 26, c: 1 }, e: { r: 26, c: 4 } },
        // "НДС" label B-E
        { s: { r: 27, c: 1 }, e: { r: 27, c: 5 } },
        // "ИТОГО" label B-E
        { s: { r: 28, c: 1 }, e: { r: 28, c: 6 } },

        // Sum in words (full width)
        { s: { r: 30, c: 0 }, e: { r: 30, c: 7 } },

        // Footer (full width)
        { s: { r: footerRow1, c: 0 }, e: { r: footerRow1, c: 7 } },
        { s: { r: footerRow2, c: 0 }, e: { r: footerRow2, c: 7 } }
      ];

      // Add assumptions merge if present
      if (assumptionsRow >= 0) {
        ws['!merges'].push({ s: { r: assumptionsRow, c: 0 }, e: { r: assumptionsRow, c: 7 } });
      }

      // ════════════════════════════════════════
      // СТИЛИ
      // ════════════════════════════════════════

      // -- Row 0: Logo placeholder --
      scRange(ws, 0, 0, 0, 7, {
        fill: { fgColor: { rgb: BRAND_DARK } },
        font: { bold: true, sz: 20, color: { rgb: BRAND_GOLD }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' }
      });
      // Put a nice text in the logo area (since we can't embed images in SheetJS)
      var logoRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
      ws[logoRef].v = 'ASGARD';

      // -- Row 1: Company name --
      sc(ws, 1, 0, {
        font: { bold: true, sz: 18, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' }
      });

      // -- Row 2: Legal name --
      sc(ws, 2, 0, {
        font: { sz: 10, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' }
      });

      // -- Row 3: Address --
      sc(ws, 3, 0, {
        font: { sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' }
      });

      // -- Row 4: Contacts --
      sc(ws, 4, 0, {
        font: { sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' }
      });

      // -- Row 6: Gold decorative line --
      sc(ws, 6, 0, {
        fill: { fgColor: { rgb: BRAND_GOLD } },
        font: { sz: 2, color: { rgb: BRAND_GOLD } }
      });

      // -- Row 7: Report title --
      sc(ws, 7, 0, {
        font: { bold: true, sz: 16, color: { rgb: BRAND_DARK }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' },
        fill: { fgColor: { rgb: GOLD_FILL } }
      });

      // -- Row 8: Gold decorative line --
      sc(ws, 8, 0, {
        fill: { fgColor: { rgb: BRAND_GOLD } },
        font: { sz: 2, color: { rgb: BRAND_GOLD } }
      });

      // -- Rows 10-12: Client/project info --
      for (var infoR = 10; infoR <= 12; infoR++) {
        // Label column A
        sc(ws, infoR, 0, {
          font: { bold: true, sz: 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
          alignment: { horizontal: 'right', vertical: 'center' }
        });
        // Value column B (merged to E)
        sc(ws, infoR, 1, {
          font: { sz: 10, color: { rgb: BLACK }, name: 'Calibri' },
          alignment: { horizontal: 'left', vertical: 'center' },
          border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } }
        });
        // Right label column F
        sc(ws, infoR, 5, {
          font: { bold: true, sz: 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
          alignment: { horizontal: 'right', vertical: 'center' }
        });
        // Right value column G
        sc(ws, infoR, 6, {
          font: { sz: 10, color: { rgb: BLACK }, name: 'Calibri' },
          alignment: { horizontal: 'left', vertical: 'center' },
          border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } }
        });
      }

      // -- Row 14: Table header --
      var headerStyle = {
        font: { bold: true, sz: 9, color: { rgb: WHITE }, name: 'Calibri' },
        fill: { fgColor: { rgb: BRAND_NAVY } },
        border: BORDER_MEDIUM,
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
      };
      for (var hc = 0; hc <= 7; hc++) {
        sc(ws, 14, hc, headerStyle);
      }

      // -- Rows 15-25: Data rows --
      for (var dr = 0; dr < 11; dr++) {
        var rowIdx = 15 + dr;
        var isAlt = (dr % 2 === 1);
        var bgFill = isAlt ? { fgColor: { rgb: BRAND_LIGHT } } : undefined;

        // Col A (№)
        sc(ws, rowIdx, 0, {
          font: { sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
          border: BORDER_THIN,
          alignment: { horizontal: 'center', vertical: 'center' },
          fill: bgFill
        });

        // Col B (name)
        sc(ws, rowIdx, 1, {
          font: { sz: 9, color: { rgb: BLACK }, name: 'Calibri' },
          border: BORDER_THIN,
          alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
          fill: bgFill
        });

        // Col C (unit)
        sc(ws, rowIdx, 2, {
          font: { sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
          border: BORDER_THIN,
          alignment: { horizontal: 'center', vertical: 'center' },
          fill: bgFill
        });

        // Col D (qty)
        sc(ws, rowIdx, 3, {
          font: { sz: 9, color: { rgb: BLACK }, name: 'Calibri' },
          border: BORDER_THIN,
          alignment: { horizontal: 'center', vertical: 'center' },
          fill: bgFill
        });

        // Cols E-H (money columns)
        for (var mc = 4; mc <= 7; mc++) {
          sc(ws, rowIdx, mc, {
            font: { sz: 9, color: { rgb: BLACK }, name: 'Calibri' },
            border: BORDER_THIN,
            alignment: { horizontal: 'right', vertical: 'center' },
            fill: bgFill
          });
          setNumFmt(ws, rowIdx, mc, FMT_NUM);
        }
      }

      // -- Last data row: bottom double border --
      for (var bc = 0; bc <= 7; bc++) {
        var lastDataRef = XLSX.utils.encode_cell({ r: 25, c: bc });
        if (ws[lastDataRef] && ws[lastDataRef].s) {
          ws[lastDataRef].s.border = BORDER_BOTTOM_DOUBLE;
        }
      }

      // -- Row 26: Subtotal without VAT --
      sc(ws, 26, 0, { font: { sz: 1, color: { rgb: WHITE } } });
      sc(ws, 26, 1, {
        font: { bold: true, sz: 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
        alignment: { horizontal: 'right', vertical: 'center' }
      });
      sc(ws, 26, 5, {
        font: { bold: true, sz: 11, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
        border: BORDER_TOP_MEDIUM,
        alignment: { horizontal: 'right', vertical: 'center' }
      });
      setNumFmt(ws, 26, 5, FMT_NUM);
      // Empty styled cells for G, H
      sc(ws, 26, 6, { font: { sz: 9 }, border: { top: { style: 'medium', color: { rgb: BRAND_NAVY } } } });
      sc(ws, 26, 7, { font: { sz: 9 }, border: { top: { style: 'medium', color: { rgb: BRAND_NAVY } } } });

      // -- Row 27: VAT --
      sc(ws, 27, 1, {
        font: { bold: true, sz: 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
        alignment: { horizontal: 'right', vertical: 'center' }
      });
      sc(ws, 27, 6, {
        font: { bold: true, sz: 11, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
        border: BORDER_THIN,
        alignment: { horizontal: 'right', vertical: 'center' }
      });
      setNumFmt(ws, 27, 6, FMT_NUM);
      sc(ws, 27, 7, { font: { sz: 9 } });

      // -- Row 28: TOTAL WITH VAT (highlighted) --
      sc(ws, 28, 0, { fill: { fgColor: { rgb: GOLD_FILL } } });
      sc(ws, 28, 1, {
        font: { bold: true, sz: 12, color: { rgb: BRAND_DARK }, name: 'Calibri' },
        alignment: { horizontal: 'right', vertical: 'center' },
        fill: { fgColor: { rgb: GOLD_FILL } }
      });
      for (var tc = 2; tc <= 6; tc++) {
        sc(ws, 28, tc, { fill: { fgColor: { rgb: GOLD_FILL } } });
      }
      sc(ws, 28, 7, {
        font: { bold: true, sz: 14, color: { rgb: BRAND_DARK }, name: 'Calibri' },
        border: {
          top:    { style: 'medium', color: { rgb: BRAND_GOLD } },
          bottom: { style: 'double', color: { rgb: BRAND_GOLD } },
          left:   { style: 'medium', color: { rgb: BRAND_GOLD } },
          right:  { style: 'medium', color: { rgb: BRAND_GOLD } }
        },
        alignment: { horizontal: 'right', vertical: 'center' },
        fill: { fgColor: { rgb: GOLD_FILL } }
      });
      setNumFmt(ws, 28, 7, FMT_NUM);

      // -- Row 30: Sum in words --
      sc(ws, 30, 0, {
        font: { italic: true, sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true }
      });

      // -- Assumptions row (if present) --
      if (assumptionsRow >= 0) {
        sc(ws, assumptionsRow, 0, {
          font: { italic: true, sz: 9, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
          alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
          border: { top: { style: 'thin', color: { rgb: 'CCCCCC' } }, bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } }
        });
        ws['!rows'][assumptionsRow] = { hpt: 30 };
      }

      // -- Signature row --
      sc(ws, signRow, 0, {
        font: { sz: 10, color: { rgb: BLACK }, name: 'Calibri' },
        alignment: { horizontal: 'left', vertical: 'bottom' }
      });
      sc(ws, signRow, 2, {
        font: { sz: 10, color: { rgb: BLACK }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'bottom' },
        border: { bottom: { style: 'thin', color: { rgb: BLACK } } }
      });
      sc(ws, signRow, 5, {
        font: { sz: 10, color: { rgb: BLACK }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'bottom' },
        border: { bottom: { style: 'thin', color: { rgb: BLACK } } }
      });
      // Hints under signature
      sc(ws, signRow + 1, 2, {
        font: { sz: 8, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
        alignment: { horizontal: 'center' }
      });
      sc(ws, signRow + 1, 5, {
        font: { sz: 8, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
        alignment: { horizontal: 'center' }
      });

      // -- Footer rows --
      sc(ws, footerRow1, 0, {
        font: { sz: 8, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: { top: { style: 'thin', color: { rgb: BRAND_GOLD } } }
      });
      sc(ws, footerRow2, 0, {
        font: { sz: 8, color: { rgb: GRAY_TEXT }, name: 'Calibri' },
        alignment: { horizontal: 'center', vertical: 'center' }
      });

      // --- Print settings ---
      ws['!print'] = { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 1 };
      ws['!margins'] = { left: 0.4, right: 0.4, top: 0.3, bottom: 0.3, header: 0.2, footer: 0.2 };

      XLSX.utils.book_append_sheet(wb, ws, 'Просчёт стоимости');


      // ════════════════════════════════════════════════════════════
      //  ЛИСТ 2: ДЕТАЛИ РАСЧЁТА (внутренний, для PM)
      // ════════════════════════════════════════════════════════════
      var detailsData = [
        ['ДЕТАЛИ КАЛЬКУЛЯЦИИ (внутренний документ)', '', ''],
        [],
        ['Статья расходов', 'Себестоимость, руб.', 'Примечание'],
        ['ФОТ (работа + подготовка + демоб.)', Math.round(sum.payroll_total), sum.people_count + ' чел x ' + sum.work_days + ' дней работы'],
        ['Налоги на ФОТ', Math.round(sum.fot_tax), (s.fot_tax_pct || 50) + '%'],
        ['Суточные', Math.round(sum.per_diem_total), sum.total_days + ' дней'],
        ['Проживание', Math.round(sum.lodging_total), st.lodging_type],
        ['Мобилизация', Math.round(sum.mobilization_total), sum.mobilization_type],
        ['Химия', Math.round(sum.chem_total), (st.chemicals ? st.chemicals.length : 0) + ' позиций'],
        ['Расходные материалы', Math.round(sum.consumables), (s.consumables_pct || 5) + '%'],
        ['Оборудование', Math.round(sum.equip_total), (st.equipment ? st.equipment.length : 0) + ' позиций'],
        ['Логистика', Math.round(sum.logistics_total), (sum.transport ? sum.transport.name : 'авто') + ', ' + (st.distance_km * 2) + ' км'],
        ['СИЗ', Math.round(sum.ppe_total), sum.people_count + ' чел'],
        ['Накладные', Math.round(sum.overhead), (sum.overhead_pct || 10) + '%'],
        [],
        ['ИТОГО себестоимость:', Math.round(sum.cost_total), ''],
        ['Маржа:', sum.margin_pct + '%', ''],
        ['Цена без НДС:', Math.round(sum.price_no_vat), ''],
        ['НДС (' + vatPct + '%):', Math.round(sum.price_with_vat - sum.price_no_vat), ''],
        ['ЦЕНА С НДС:', Math.round(sum.price_with_vat), ''],
        [],
        ['Чистая прибыль:', Math.round(sum.net_profit), ''],
        ['Прибыль / чел-день:', Math.round(sum.profit_per_day), sum.status === 'green' ? 'ЗЕЛЁНАЯ ЗОНА' : (sum.status === 'yellow' ? 'ЖЁЛТАЯ ЗОНА' : 'КРАСНАЯ ЗОНА')]
      ];

      var wsDetails = XLSX.utils.aoa_to_sheet(detailsData);
      wsDetails['!cols'] = [{ wch: 35 }, { wch: 20 }, { wch: 30 }];
      wsDetails['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }
      ];

      // Title style
      sc(wsDetails, 0, 0, {
        font: { bold: true, sz: 14, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
        alignment: { horizontal: 'center' }
      });

      // Header row (row 2)
      for (var dh = 0; dh <= 2; dh++) {
        sc(wsDetails, 2, dh, {
          font: { bold: true, sz: 10, color: { rgb: WHITE }, name: 'Calibri' },
          fill: { fgColor: { rgb: BRAND_NAVY } },
          border: BORDER_THIN,
          alignment: { horizontal: 'center' }
        });
      }

      // Data rows (3-13) — borders + alternating
      for (var ddr = 3; ddr <= 13; ddr++) {
        var dAlt = (ddr - 3) % 2 === 1;
        for (var ddc = 0; ddc <= 2; ddc++) {
          sc(wsDetails, ddr, ddc, {
            font: { sz: 9, color: { rgb: BLACK }, name: 'Calibri' },
            border: BORDER_THIN,
            alignment: ddc === 1 ? { horizontal: 'right' } : { horizontal: 'left' },
            fill: dAlt ? { fgColor: { rgb: BRAND_LIGHT } } : undefined
          });
          if (ddc === 1) setNumFmt(wsDetails, ddr, ddc, FMT_NUM);
        }
      }

      // Totals (rows 15-19)
      for (var tr = 15; tr <= 19; tr++) {
        sc(wsDetails, tr, 0, {
          font: { bold: true, sz: 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
          alignment: { horizontal: 'right' }
        });
        sc(wsDetails, tr, 1, {
          font: { bold: tr === 19, sz: tr === 19 ? 12 : 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
          alignment: { horizontal: 'right' },
          fill: tr === 19 ? { fgColor: { rgb: GOLD_FILL } } : undefined,
          border: tr === 15 ? BORDER_TOP_MEDIUM : BORDER_THIN
        });
        if (tr !== 16) setNumFmt(wsDetails, tr, 1, FMT_NUM);
      }

      // Profit rows (21-22)
      for (var pr = 21; pr <= 22; pr++) {
        sc(wsDetails, pr, 0, {
          font: { bold: true, sz: 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
          alignment: { horizontal: 'right' }
        });
        sc(wsDetails, pr, 1, {
          font: { bold: true, sz: 11, name: 'Calibri',
            color: { rgb: sum.status === 'green' ? '22C55E' : (sum.status === 'yellow' ? 'F59E0B' : 'E03A4A') } },
          alignment: { horizontal: 'right' }
        });
        setNumFmt(wsDetails, pr, 1, FMT_NUM);
        sc(wsDetails, pr, 2, {
          font: { bold: true, sz: 10, name: 'Calibri',
            color: { rgb: sum.status === 'green' ? '22C55E' : (sum.status === 'yellow' ? 'F59E0B' : 'E03A4A') } },
          alignment: { horizontal: 'left' }
        });
      }

      wsDetails['!print'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1 };
      XLSX.utils.book_append_sheet(wb, wsDetails, 'Детали');


      // ════════════════════════════════════════════════════════════
      //  ЛИСТ 3: БРИГАДА
      // ════════════════════════════════════════════════════════════
      var crewData = [['Роль', 'Кол-во', 'Ставка/день, руб.', 'Суточные, руб.', 'Итого за работу, руб.']];
      var crewTotalPay = 0;
      var crewArr = st.crew || [];
      for (var ci = 0; ci < crewArr.length; ci++) {
        var c = crewArr[ci];
        var role = s.roles ? s.roles.find(function(r) { return r.id === c.role_id; }) : null;
        if (!role) continue;
        var rate = window.calcRateWithSurcharges ? window.calcRateWithSurcharges(c.role_id, st.surcharges, s) : (s.base_rate * role.coef);
        var perDiem = role.per_diem || 1000;
        var crewLineTotal = rate * c.count * sum.work_days + perDiem * c.count * sum.total_days;
        crewTotalPay += crewLineTotal;
        crewData.push([role.name || c.role_id, c.count, Math.round(rate), Math.round(perDiem), Math.round(crewLineTotal)]);
      }
      crewData.push(['', '', '', 'ИТОГО:', Math.round(crewTotalPay)]);

      if (crewData.length > 2) {
        var wsCrew = XLSX.utils.aoa_to_sheet(crewData);
        wsCrew['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 20 }];

        // Header
        for (var chc = 0; chc <= 4; chc++) {
          sc(wsCrew, 0, chc, {
            font: { bold: true, sz: 10, color: { rgb: WHITE }, name: 'Calibri' },
            fill: { fgColor: { rgb: BRAND_NAVY } },
            border: BORDER_THIN,
            alignment: { horizontal: 'center', wrapText: true }
          });
        }
        // Data rows
        for (var cdr = 1; cdr < crewData.length - 1; cdr++) {
          var cAlt = (cdr - 1) % 2 === 1;
          for (var cdc = 0; cdc <= 4; cdc++) {
            sc(wsCrew, cdr, cdc, {
              font: { sz: 9, color: { rgb: BLACK }, name: 'Calibri' },
              border: BORDER_THIN,
              alignment: cdc >= 2 ? { horizontal: 'right' } : (cdc === 1 ? { horizontal: 'center' } : { horizontal: 'left' }),
              fill: cAlt ? { fgColor: { rgb: BRAND_LIGHT } } : undefined
            });
            if (cdc >= 2) setNumFmt(wsCrew, cdr, cdc, FMT_NUM);
          }
        }
        // Total row
        var crewTotalRow = crewData.length - 1;
        sc(wsCrew, crewTotalRow, 3, {
          font: { bold: true, sz: 10, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
          alignment: { horizontal: 'right' },
          border: BORDER_TOP_MEDIUM
        });
        sc(wsCrew, crewTotalRow, 4, {
          font: { bold: true, sz: 11, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
          alignment: { horizontal: 'right' },
          border: BORDER_TOP_MEDIUM
        });
        setNumFmt(wsCrew, crewTotalRow, 4, FMT_NUM);

        wsCrew['!print'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1 };
        XLSX.utils.book_append_sheet(wb, wsCrew, 'Бригада');
      }


      // ════════════════════════════════════════════════════════════
      //  ЛИСТ 4: ПАРАМЕТРЫ
      // ════════════════════════════════════════════════════════════
      var paramsData = [['Параметр', 'Значение']];
      if (st.params) {
        var paramKeys = Object.keys(st.params);
        for (var pi = 0; pi < paramKeys.length; pi++) {
          var pk = paramKeys[pi];
          var pv = st.params[pk];
          if (pv !== null && pv !== undefined && pv !== '') {
            paramsData.push([pk, pv]);
          }
        }
      }
      paramsData.push(['Маржа, %', st.margin_pct]);
      paramsData.push(['Подготовка, дн.', st.prep_days]);
      paramsData.push(['Работа, дн.', st.work_days]);
      paramsData.push(['Демобилизация, дн.', st.demob_days]);
      paramsData.push(['Расстояние, км', st.distance_km]);
      paramsData.push(['Транспорт', st.transport_id]);
      paramsData.push(['Проживание', st.lodging_type]);
      if (st.assumptions) paramsData.push(['Допущения', st.assumptions]);

      var wsParams = XLSX.utils.aoa_to_sheet(paramsData);
      wsParams['!cols'] = [{ wch: 28 }, { wch: 35 }];

      // Header
      for (var phc = 0; phc <= 1; phc++) {
        sc(wsParams, 0, phc, {
          font: { bold: true, sz: 10, color: { rgb: WHITE }, name: 'Calibri' },
          fill: { fgColor: { rgb: BRAND_NAVY } },
          border: BORDER_THIN,
          alignment: { horizontal: 'center' }
        });
      }
      // Data rows
      for (var pdr = 1; pdr < paramsData.length; pdr++) {
        var pAlt = (pdr - 1) % 2 === 1;
        sc(wsParams, pdr, 0, {
          font: { bold: true, sz: 9, color: { rgb: BRAND_NAVY }, name: 'Calibri' },
          border: BORDER_THIN,
          alignment: { horizontal: 'left' },
          fill: pAlt ? { fgColor: { rgb: BRAND_LIGHT } } : undefined
        });
        sc(wsParams, pdr, 1, {
          font: { sz: 9, color: { rgb: BLACK }, name: 'Calibri' },
          border: BORDER_THIN,
          alignment: { horizontal: 'left', wrapText: true },
          fill: pAlt ? { fgColor: { rgb: BRAND_LIGHT } } : undefined
        });
      }

      wsParams['!print'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1 };
      XLSX.utils.book_append_sheet(wb, wsParams, 'Параметры');


      // ════════════════════════════════════════════════════════════
      //  Генерация файла
      // ════════════════════════════════════════════════════════════
      var objName = (st.tender_title || st.city || 'объект').replace(/[^\w\u0400-\u04FF\s-]/g, '').substring(0, 30).trim();
      var filename = 'Просчёт_' + objName + '_' + dateNow.replace(/\./g, '-') + '.xlsx';

      XLSX.writeFile(wb, filename);
      toast('Экспорт', 'Excel-отчёт скачан');

    } catch (err) {
      console.error('Excel export error:', err);
      toast('Ошибка', 'Не удалось экспортировать: ' + (err.message || err), 'err');
    }
  };

  console.log('[CALC] Excel export module loaded');
})();
