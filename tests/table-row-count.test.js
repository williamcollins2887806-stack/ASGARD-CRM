'use strict';

/**
 * Тесты структурного счёта позиций (src/services/table-row-count.js).
 *
 * ── Почему эти тесты существуют ────────────────────────────────────────────
 * 13 проходов верификатора на текстовом счётчике показали: любая эвристика
 * по строке ошибочна, потому что после рендера в текст структура теряется.
 * Здесь проверяется счёт по СЕТКЕ ЯЧЕЕК — он структуру сохраняет.
 *
 * Тесты построены так, чтобы различать способы счёта: если вернуть текстовую
 * эвристику, кейсы «единица в шапке», «docx-порядок колонок» и «разделы с
 * перезапуском» упадут.
 */

const assert = require('assert');
const path = require('path');

const mod = require(path.join(__dirname, '..', 'src', 'services', 'table-row-count.js'));

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

/** Строит сетку ведомости: шапка + N позиций. */
function vorGrid({ count, header, makeRow }) {
  const grid = [header];
  for (let k = 1; k <= count; k += 1) grid.push(makeRow(k));
  return grid;
}

/** Классические строки ведомости на N позиций. */
function classicRows(count) {
  const rows = [['№', 'Наименование', 'Ед. изм.', 'Кол-во']];
  for (let k = 1; k <= count; k += 1) rows.push([k, 'Очистка оборудования ' + k, 'м3', 100 + k]);
  return rows;
}

/**
 * Собирает настоящий .docx с таблицей.
 * rows = null → документ без таблиц, только текст `plainText`.
 */
function makeDocxBuffer(rows, plainText) {
  const JSZip = require('pizzip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>');

  let body;
  if (Array.isArray(rows) && rows.length) {
    const tr = rows.map((cells) => {
      const tc = cells.map((v) => (
        '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>'
        + '<w:p><w:r><w:t>' + escapeXml(v) + '</w:t></w:r></w:p></w:tc>'
      )).join('');
      return '<w:tr>' + tc + '</w:tr>';
    }).join('');
    body = '<w:tbl>' + tr + '</w:tbl>';
  } else {
    body = '<w:p><w:r><w:t>' + escapeXml(plainText || '') + '</w:t></w:r></w:p>';
  }

  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:body>' + body + '</w:body></w:document>');
  return zip.generate({ type: 'nodebuffer' });
}

/** Экранирование для WordprocessingML. */
function escapeXml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

(async () => {
  // ── 1. Классический порядок колонок ──────────────────────────────────────
  await check('классическая ведомость: № | Наименование | Ед | Кол-во', () => {
    const g = vorGrid({
      count: 300,
      header: ['№', 'Наименование', 'Ед. изм.', 'Кол-во'],
      makeRow: (k) => [k, 'Очистка оборудования ' + k, 'м3', 100 + k]
    });
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  // ── 2. Порядок «Кол-во» перед «Ед. изм.» ────────────────────────────────
  await check('колонка количества перед единицей', () => {
    // Так отдаёт mammoth для .docx: порядок колонок другой.
    const g = vorGrid({
      count: 300,
      header: ['№', 'Наименование', 'Кол-во', 'Ед.'],
      makeRow: (k) => [k, 'Очистка ' + k, 100 + k, 'м3']
    });
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  // ── 3. Единица в шапке таблицы ───────────────────────────────────────────
  await check('единица объявлена в шапке, в строках только число', () => {
    const g = vorGrid({
      count: 300,
      header: ['Наименование', 'Объём, м3'],
      makeRow: (k) => ['Очистка ' + k, 100 + k]
    });
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  // ── 4. Разделы с перезапуском нумерации ─────────────────────────────────
  await check('три раздела по 100 — нумерация перезапускается', () => {
    // Текстовый счётчик по нумерации давал 40 на этом кейсе: брал самую
    // длинную серию, а разделы начинаются заново с 1.
    //
    // Допуск +N на заголовки разделов: строка «Раздел 2» структурно
    // неотличима от позиции с незаполненным количеством в ведомости без
    // колонки №. Выбираем в пользу позиции — потеря десятков строк хуже
    // нескольких лишних заголовков.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let s = 0; s < 3; s += 1) {
      g.push(['Раздел ' + (s + 1), '', '', '']);
      for (let k = 1; k <= 100; k += 1) g.push([k, 'Работа ' + k, 'м3', 10 + k]);
    }
    const got = mod.countTableRows(g).positions;
    assert.ok(got >= 300, 'потеряны позиции: ' + got);
    assert.ok(got <= 303, 'лишние строки считаются позициями: ' + got);
  });

  // ── 5. Рваная нумерация ─────────────────────────────────────────────────
  await check('нумерация с пропуском номера', () => {
    // Текстовый счётчик резал 300 до 150 на одном пропущенном номере.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) {
      if (k === 150) continue;
      g.push([k, 'Работа ' + k, 'м3', 10 + k]);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 299);
  });

  // ── 6. Подстроки «в т.ч.» ───────────────────────────────────────────────
  await check('подстроки «в т.ч. ППР» не считаются позициями', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) {
      g.push([k, 'Очистка ' + k, 'м3', 100 + k]);
      g.push(['', 'в т.ч. ППР', 'м3', 10 + k]);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  // ── 7. Погонные метры ───────────────────────────────────────────────────
  await check('единица «п.м» распознаётся', () => {
    const g = vorGrid({
      count: 250,
      header: ['№', 'Наименование', 'Ед', 'Кол-во'],
      makeRow: (k) => [k, 'Замена участка ' + k, 'п.м', 100 + k]
    });
    assert.strictEqual(mod.countTableRows(g).positions, 250);
  });

  // ── 8. Тонны ────────────────────────────────────────────────────────────
  await check('единица «т» распознаётся', () => {
    const g = vorGrid({
      count: 200,
      header: ['№', 'Наименование', 'Ед', 'Кол-во'],
      makeRow: (k) => [k, 'Отходы металла ' + k, 'т', 50 + k]
    });
    assert.strictEqual(mod.countTableRows(g).positions, 200);
  });

  // ── 9. Итоговая строка ──────────────────────────────────────────────────
  await check('строка «Итого» не считается позицией', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 150; k += 1) g.push([k, 'Работа ' + k, 'м3', 10 + k]);
    g.push(['', 'Итого', '', '12345']);
    assert.strictEqual(mod.countTableRows(g).positions, 150);
  });

  // ── 10. ВОР + график в одном листе ──────────────────────────────────────
  await check('график работ рядом с ведомостью не добавляет позиций', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 40; k += 1) g.push([k, 'Работа ' + k, 'м3', 10 + k]);
    g.push(['Этап', 'Срок', 'Дней', '']);
    for (let k = 1; k <= 100; k += 1) g.push(['Этап ' + k, 'Неделя ' + k, k, '']);
    assert.strictEqual(mod.countTableRows(g).positions, 40);
  });

  // ── 11. Без нумерации ───────────────────────────────────────────────────
  await check('ведомость без колонки №', () => {
    const g = vorGrid({
      count: 300,
      header: ['Наименование', 'Объём, м3'],
      makeRow: (k) => ['Очистка ' + k, 100 + k]
    });
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  // ── 12. Мусорная таблица ────────────────────────────────────────────────
  await check('таблица без объёмов даёт 0', () => {
    const g = [['Этап', 'Ответственный', 'Срок']];
    for (let k = 1; k <= 50; k += 1) g.push(['Этап ' + k, 'Иванов ' + k, 'Неделя ' + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 0);
  });

  // ── 13. Пустые и невалидные входы ───────────────────────────────────────
  await check('пустой вход не падает', () => {
    assert.strictEqual(mod.countTableRows([]).positions, 0);
    assert.strictEqual(mod.countTableRows(null).positions, 0);
    assert.strictEqual(mod.countTableRows([null, undefined, []]).positions, 0);
  });

  // ── 14. Максимум по листам, не сумма ────────────────────────────────────
  await check('один перечень на двух листах не удваивается', () => {
    // «ВОР» и «Расчёт» на разных листах содержат один перечень. Сумма дала
    // бы 600 и ложный недобор, максимум — честные 300.
    const grid = [];
    grid.push(['№', 'Наименование', 'Ед', 'Кол-во']);
    for (let k = 1; k <= 300; k += 1) grid.push([k, 'Работа ' + k, 'м3', 10 + k]);
    const r = mod.countPositionsInSheets([
      { name: 'ВОР', rows: grid },
      { name: 'Расчёт', rows: grid }
    ]);
    assert.strictEqual(r.positions, 300);
  });

  // ── 15. Нумерация без объёмов ───────────────────────────────────────────
  await check('оглавление из одних номеров не считается позициями', () => {
    // Кейс, который ловит снятие отсева колонки-нумерации: строки содержат
    // только номер и название, объёма нет. Если нумерацию не отсеять, каждая
    // такая строка засчитается как позиция по «числу».
    const g = [['№', 'Наименование']];
    for (let k = 1; k <= 200; k += 1) g.push([k, 'Раздел ' + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 0);
  });

  // ── 16. Номер и объём — числа рядом ─────────────────────────────────────
  await check('номер позиции не считается объёмом при единице в шапке', () => {
    // Колонка № (1..300) и колонка объёма (101..400) — обе числа, обе идут
    // подряд. Отсев должен снять только первую: она начинается с 1.
    const g = [['№', 'Наименование', 'Объём, м3']];
    for (let k = 1; k <= 300; k += 1) g.push([k, 'Очистка ' + k, 100 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('объёмы, идущие подряд с 1, не принимаются за нумерацию', () => {
    // Опасный случай: в ведомости нет колонки №, а объёмы случайно идут
    // 1,2,3…N. Отсев не должен снять единственную числовую колонку —
    // иначе счёт обнулится.
    const g = [['Наименование', 'Объём, м3']];
    for (let k = 1; k <= 300; k += 1) g.push(['Очистка ' + k, k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  // ── 18. Названия на «Работы по…» не считаются шапкой ────────────────────
  await check('названия «Работы по очистке…» считаются позициями', () => {
    // Дефект, найденный верификатором: префиксная проверка шапки отбрасывала
    // любую ячейку, начинающуюся с «работы». На ведомости, где ВСЕ названия
    // такие, счёт падал вдвое, и недобор не замечался.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) {
      g.push([k, 'Работы по очистке резервуара Р-' + k, 'м3', 100 + k]);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  // ── 19. Объём, совпадающий с номером ────────────────────────────────────
  await check('объёмы 1..N при нумерации 1..N не обнуляют счёт', () => {
    // Дефект, найденный верификатором: обе колонки попадали в кандидаты
    // нумерации и обе снимались → 0 при 300 реальных позициях.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) g.push([k, 'Работа ' + k, 'шт', k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  // ── 20. Части перечня на разных листах суммируются ──────────────────────
  await check('раздел, разбитый на 3 листа, считается целиком', () => {
    // Дефект, найденный верификатором: брался максимум по листам, поэтому
    // 3 части по 100 давали 100, и разбор трети помечался полным.
    const part = (s) => {
      const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
      for (let k = 1; k <= 100; k += 1) g.push([k, `Часть ${s} поз ${k}`, 'м3', 10 + k]);
      return g;
    };
    const r = mod.countPositionsInSheets([
      { name: 'Часть 1', rows: part(1) },
      { name: 'Часть 2', rows: part(2) },
      { name: 'Часть 3', rows: part(3) }
    ]);
    assert.strictEqual(r.positions, 300);
  });

  // ── 21. docx: таблицы Word через mammoth HTML ───────────────────────────
  await check('docx: классическая ведомость на 300 позиций', async () => {
    // Дефект, найденный верификатором: docx шёл через extractRawText, который
    // отдаёт ячейку отдельной строкой — структура терялась, и детектор
    // работал вслепую. Теперь таблицы читаются из HTML через mammoth.
    const buf = makeDocxBuffer(classicRows(300));
    const r = await mod.countPositionsFromBuffer({ buf, originalName: 'ВОР.docx' });
    assert.strictEqual(r.positions, 300);
    assert.strictEqual(r.source, 'grid');
  });

  await check('docx: единица в шапке таблицы', async () => {
    const rows = [['Наименование', 'Объём, м3']];
    for (let k = 1; k <= 300; k += 1) rows.push(['Очистка ' + k, 100 + k]);
    const r = await mod.countPositionsFromBuffer({ buf: makeDocxBuffer(rows), originalName: 'ВОР.docx' });
    assert.strictEqual(r.positions, 300);
  });

  await check('docx: подстроки «в т.ч.» не считаются', async () => {
    const rows = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) {
      rows.push([k, 'Очистка ' + k, 'м3', 100 + k]);
      rows.push(['', 'в т.ч. ППР', 'м3', 10 + k]);
    }
    const r = await mod.countPositionsFromBuffer({ buf: makeDocxBuffer(rows), originalName: 'ВОР.docx' });
    assert.strictEqual(r.positions, 300);
  });

  await check('docx: разделы с перезапуском нумерации', async () => {
    const rows = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let s = 0; s < 3; s += 1) {
      for (let k = 1; k <= 100; k += 1) rows.push([k, `Раздел ${s + 1} поз ${k}`, 'м3', 10 + k]);
    }
    const r = await mod.countPositionsFromBuffer({ buf: makeDocxBuffer(rows), originalName: 'ВОР.docx' });
    assert.strictEqual(r.positions, 300);
  });

  await check('docx: погонные метры', async () => {
    const rows = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 250; k += 1) rows.push([k, 'Замена ' + k, 'п.м', 100 + k]);
    const r = await mod.countPositionsFromBuffer({ buf: makeDocxBuffer(rows), originalName: 'ВОР.docx' });
    assert.strictEqual(r.positions, 250);
  });

  await check('docx без таблиц даёт 0', async () => {
    const r = await mod.countPositionsFromBuffer({
      buf: makeDocxBuffer(null, 'Договор поставки. Условия оплаты и сроки.'),
      originalName: 'Договор.docx'
    });
    assert.strictEqual(r.positions, 0);
  });

  // ── 22. CSV и .xls ──────────────────────────────────────────────────────
  await check('csv без BOM читается', async () => {
    // Дефект, найденный верификатором: SheetJS получал буфер без указания
    // кодировки, и UTF-8 без BOM давал 0 при 300 реальных позициях.
    const csv = '№,Наименование,Ед,Кол-во\n'
      + Array.from({ length: 300 }, (_, i) => `${i + 1},Очистка ${i + 1},м3,${101 + i}`).join('\n');
    const r = await mod.countPositionsFromBuffer({
      buf: Buffer.from(csv, 'utf8'), originalName: 'ВОР.csv'
    });
    assert.strictEqual(r.positions, 300);
  });

  await check('csv с BOM читается', async () => {
    const csv = '\uFEFF№,Наименование,Ед,Кол-во\n'
      + Array.from({ length: 300 }, (_, i) => `${i + 1},Очистка ${i + 1},м3,${101 + i}`).join('\n');
    const r = await mod.countPositionsFromBuffer({
      buf: Buffer.from(csv, 'utf8'), originalName: 'ВОР.csv'
    });
    assert.strictEqual(r.positions, 300);
  });

  await check('.xls (BIFF8) читается', async () => {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['№', 'Наименование', 'Ед', 'Кол-во']]);
    for (let k = 1; k <= 200; k += 1) {
      XLSX.utils.sheet_add_aoa(ws, [[k, 'Очистка ' + k, 'м3', 100 + k]], { origin: -1 });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ВОР');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
    const r = await mod.countPositionsFromBuffer({ buf, originalName: 'ВОР.xls' });
    assert.strictEqual(r.positions, 200);
  });

  // ── 23. Дефекты из прохода верификатора (N-1…N-10) ──────────────────────
  await check('N-1 «Всего отходов вывезти, партия N» — позиции', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 120; k += 1) g.push([k, 'Всего отходов вывезти, партия ' + k, 'м3', 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 120);
  });

  await check('N-2 название одним словом «Работы» — позиции', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 100; k += 1) g.push([k, 'Работы', 'м3', 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 100);
  });

  await check('N-3 прочерки в объёме не ломают снятие нумерации', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 100; k += 1) g.push([k, 'Очистка ' + k, 'м3', k === 1 ? 10 : '-']);
    assert.strictEqual(mod.countTableRows(g).positions, 100);
  });

  await check('N-5 копия листа с обратным порядком строк', () => {
    const a = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) a.push([k, 'Работа ' + k, 'м3', 10 + k]);
    const b = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 300; k >= 1; k -= 1) b.push([k, 'Работа ' + k, 'м3', 10 + k]);
    const r = mod.countPositionsInSheets([{ name: 'A', rows: a }, { name: 'B', rows: b }]);
    assert.strictEqual(r.positions, 300);
  });

  await check('N-4 копия листа с заголовком отчёта над шапкой', () => {
    const a = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) a.push([k, 'Работа ' + k, 'м3', 10 + k]);
    const b = [['Ведомость объёмов работ за период']].concat(a);
    const r = mod.countPositionsInSheets([{ name: 'A', rows: a }, { name: 'B', rows: b }]);
    assert.strictEqual(r.positions, 300);
  });

  await check('N-10 шапка далеко от начала находится', () => {
    // Заголовок отчёта занимает 20 строк, шапка таблицы — на 22-й.
    // При окне поиска 15 строк детектор давал 0 и молча выключался.
    const g = [];
    for (let i = 1; i <= 20; i += 1) g.push(['Отчёт за период', '', '', '']);
    g.push(['Наименование', 'Объём, м3']);
    for (let k = 1; k <= 300; k += 1) g.push(['Очистка ' + k, 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  // ── 24. Третий проход верификатора: K-1…K-16 ────────────────────────────
  await check('K-1 график работ не считается ведомостью', () => {
    // Без единиц измерения это график, а не ведомость. Раньше засчитывался
    // как 140 позиций и давал ложный «недобор» на полном разборе.
    const g = [['№', 'Этап', 'Дней']];
    for (let k = 1; k <= 140; k += 1) g.push([k, 'Этап ' + k, k]);
    assert.strictEqual(mod.countTableRows(g).positions, 0);
  });

  await check('K-3 оглавление не считается ведомостью', () => {
    const g = [['№', 'Раздел', 'Стр.']];
    for (let k = 1; k <= 200; k += 1) g.push([k, 'Раздел ' + k, k]);
    assert.strictEqual(mod.countTableRows(g).positions, 0);
  });

  await check('K-4 шапка с годами не даёт фантомную позицию', () => {
    const g = [['Наименование', 'Объём, м3', '2025', '2026']];
    for (let k = 1; k <= 300; k += 1) g.push(['Очистка ' + k, 10 + k, 5, 6]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('K-5 итоги по разделам с колонкой Сумма', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во', 'Сумма']];
    for (let k = 1; k <= 300; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k, 1000 + k]);
    for (let i = 1; i <= 10; i += 1) g.push(['', 'Итого по разделу ' + i, '', 100, 5000]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('N-7 «в том числе:» и «• в т.ч.» не удваивают счёт', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) {
      g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
      g.push(['', 'в том числе: ППР', 'м3', 5]);
      g.push(['', '• в т.ч. ППР', 'м3', 5]);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('K-7 копия листа с одним прочерком схлопывается', () => {
    const a = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) a.push([k, 'Работа ' + k, 'м3', 10 + k]);
    const b = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) b.push([k, 'Работа ' + k, 'м3', k === 5 ? '-' : 10 + k]);
    const r = mod.countPositionsInSheets([{ name: 'A', rows: a }, { name: 'B', rows: b }]);
    assert.strictEqual(r.positions, 300);
  });

  await check('K-11 частично совпадающие листы не схлопываются', () => {
    // 60 общих названий из 100 — это две части перечня, а не копия.
    const a = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 100; k += 1) a.push([k, 'Общая ' + k, 'м3', 10 + k]);
    const b = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 100; k += 1) b.push([k, k <= 60 ? 'Общая ' + k : 'Своя ' + k, 'м3', 20 + k]);
    const r = mod.countPositionsInSheets([{ name: 'A', rows: a }, { name: 'B', rows: b }]);
    assert.strictEqual(r.positions, 200);
  });

  await check('N-3 доля прочерков не вызывает скачка счёта', () => {
    // Дефект, найденный верификатором: при доле строк с числом < 0.5 отсев
    // нумерации отменялся ЦЕЛИКОМ, и счёт прыгал 60 → 120 на одном прочерке.
    // Тест проверяет монотонность: больше заполненных объёмов — не меньше
    // позиций, без скачков вдвое.
    const build = (filled) => {
      const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
      for (let k = 1; k <= 120; k += 1) {
        g.push([k, 'Очистка ' + k, 'м3', k <= filled ? 10 + k : '-']);
      }
      return mod.countTableRows(g).positions;
    };
    const s60 = build(60);
    const s61 = build(61);
    assert.strictEqual(s60, 120, 'при 60 объёмах посчитано ' + s60);
    assert.strictEqual(s61, 120, 'при 61 объёме посчитано ' + s61);
  });

  await check('позиция с прочерком вместо объёма считается', () => {
    // Дефект, найденный верификатором: строки с прочерком в объёме
    // отбрасывались, и на ведомости с 60 прочерками из 120 счёт был 60 —
    // детектор сообщал о недоборе на полном разборе.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) g.push([k, 'Очистка ' + k, 'м3', k <= 150 ? 100 + k : '-']);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('фильтр подстрок работает (мутация ловится)', () => {
    // Без фильтра «в т.ч.» подстроки удваивают счёт: 300 → 600.
    // Тест отдельный и прямой, чтобы мутация снятия фильтра падала.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 100; k += 1) {
      g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
      g.push(['', 'в т.ч. ППР', 'м3', 5]);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 100,
      'подстроки посчитаны позициями');
  });

  await check('единица «м3» распознаётся (мутация ловится)', () => {
    // Если убрать «м3» из списка единиц, ведомость в кубометрах
    // перестаёт считаться. Прямая проверка самой единицы.
    assert.strictEqual(mod.isUnitCell('м3'), true, '«м3» не распознана');
    assert.strictEqual(mod.isUnitCell('м2'), true, '«м2» не распознана');
    assert.strictEqual(mod.isUnitCell('т'), true, '«т» не распознана');
    assert.strictEqual(mod.isUnitCell('шт'), true, '«шт» не распознана');
  });

  await check('«340 м3» в одной ячейке парсится (мутация ловится)', () => {
    // Формат выгрузок, где единица слилась с количеством. Без него
    // ведомость даёт 0 позиций.
    assert.strictEqual(mod.numCell('340 м3'), 340, '«340 м3» не разобрано');
    assert.strictEqual(mod.numCell('12,5 т'), 12.5, '«12,5 т» не разобрано');
    assert.strictEqual(mod.numCell('250 п.м'), 250, '«250 п.м» не разобрано');
  });

  // ── 25. Пятый проход: C-1…C-8 ───────────────────────────────────────────
  await check('C-1 «акт № N» в примечании не делает строку шапкой', () => {
    // Дефект: isHeaderRow срабатывал на слове «№» в ЛЮБОЙ ячейке, и колонка
    // «Примечание» со значением «акт № 5» обнуляла всю ведомость (0 из 300).
    const g = [['№', 'Наименование', 'Ед', 'Кол-во', 'Примечание']];
    for (let k = 1; k <= 300; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k, 'акт № ' + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('C-2 «Кол-во отходов…» в названии — позиция', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) g.push([k, 'Кол-во отходов на вывоз ' + k, 'м3', 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('C-3 заголовок раздела не срезает хвост ведомости', () => {
    // Дефект: после заголовка раздела единица выключалась до конца листа,
    // и хвост (150 позиций) выпадал: 4 из 300.
    const g = [['Наименование', 'Объём, м3']];
    for (let k = 1; k <= 150; k += 1) g.push(['Очистка ' + k, 10 + k]);
    g.push(['Раздел 2. Прочие работы', '']);
    for (let k = 151; k <= 300; k += 1) g.push(['Очистка ' + k, 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('C-5 итоги с единицей и суммой не считаются', () => {
    // Дефект: лимит «не больше 3 непустых ячеек» не покрывал сметную форму
    // «Итого по разделу | м3 | 1234 | 99999» → +10 позиций.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во', 'Сумма']];
    for (let k = 1; k <= 300; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k, 1000 + k]);
    for (let i = 1; i <= 10; i += 1) g.push(['', 'Итого по разделу ' + i, 'м3', 100, 5000]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('C-8 строки без объёма с примечанием — позиции', () => {
    // Дефект: 7 строк без объёма давали 42 вместо 300.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во', 'Примечание']];
    for (let k = 1; k <= 300; k += 1) {
      const empty = k > 293;
      g.push([k, 'Очистка ' + k, 'м3', empty ? '' : 10 + k, empty ? 'уточняется' : '']);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('C-6 двухстрочная шапка распознаётся', () => {
    // «Объём» и «м3» в разных строках — частая вёрстка с объединёнными
    // ячейками. Раньше давала 0.
    const g = [
      ['Наименование', 'Объём'],
      ['', 'м3']
    ];
    for (let k = 1; k <= 100; k += 1) g.push(['Очистка ' + k, 100 + k]);
    // Считаем либо через шапку первой строки, либо через единицу во второй.
    const got = mod.countTableRows(g).positions;
    assert.ok(got >= 100, 'двухстрочная шапка не распознана: ' + got);
  });

  // ── 26. Шестой проход: повтор шапки, итоги, молчаливый недобор ──────────
  await check('повтор шапки с единицей на каждый раздел', () => {
    // Дефект: единица применялась только к первой секции, и ведомость
    // с шапкой на каждый раздел давала 100 из 300.
    const g = [];
    for (let s = 0; s < 3; s += 1) {
      g.push(['№', 'Наименование', 'Объём, м3']);
      for (let k = 1; k <= 100; k += 1) g.push([k, `Раздел ${s + 1} поз ${k}`, 10 + k]);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('«Итого работ» и «Всего объёмов» не считаются', () => {
    // Дефект: фильтр итогов ловил только «Итого по …», а «Итого работ»
    // проходил как позиция (+2).
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 100; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
    g.push(['', 'Итого работ', 'м3', 999]);
    g.push(['', 'Всего объёмов', 'м3', 888]);
    assert.strictEqual(mod.countTableRows(g).positions, 100);
  });

  await check('подпись «Составил» внизу листа не рубит его', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 150; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
    g.push(['Составил', 'Иванов', '', '']);
    const r = mod.countPositionsInSheets([{ name: 'A', rows: g }]);
    assert.strictEqual(r.positions, 150);
  });

  await check('дубль перечня внутри одного листа схлопывается', () => {
    // Дефект: таблицу вставили дважды — счёт удваивался (150 → 300),
    // и детектор кричал «разбор неполный» на полном разборе.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 150; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
    for (let k = 1; k <= 150; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 150);
  });

  await check('разделы с одинаковыми строками НЕ схлопываются', () => {
    // Обратная сторона: разделы ведомости часто повторяются построчно.
    // Их нельзя считать дублем — между ними заголовок «Раздел N».
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let s = 0; s < 3; s += 1) {
      g.push(['Раздел ' + (s + 1), '', '', '']);
      for (let k = 1; k <= 100; k += 1) g.push([k, 'Работа ' + k, 'м3', 10 + k]);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  // ── 27. Седьмой проход: двухстрочная шапка, ТЗ, копии ───────────────────
  await check('D-1 повтор двухстрочной шапки на каждый раздел', () => {
    // Дефект: шапка «№ | Наименование | Объём» + строка «м3» повторяется
    // перед каждым разделом. Карта headerUnits работала только для одной
    // ячейки, и считался лишь первый раздел: 100 из 300.
    const g = [];
    for (let s = 0; s < 3; s += 1) {
      g.push(['№', 'Наименование', 'Объём']);
      g.push(['', '', 'м3']);
      for (let k = 1; k <= 100; k += 1) g.push([k, 'Работа ' + k, 10 + k]);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('D-6 двухстрочная шапка работает со строкой сверху', () => {
    // Дефект: «Приложение № 1 к договору» над шапкой обнуляло всё.
    const g = [['Приложение № 1 к договору', '', '']];
    g.push(['Наименование', 'Объём']);
    g.push(['', 'м3']);
    for (let k = 1; k <= 100; k += 1) g.push(['Очистка ' + k, 100 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 100);
  });

  await check('D-4 шапка «Кол-во, м3» не считается позицией', () => {
    // Дефект: regex заголовков не брал «Кол-во, м3» с запятой → +1.
    const g = [['№', 'Наименование', 'Кол-во, м3']];
    for (let k = 1; k <= 300; k += 1) g.push([k, 'Очистка ' + k, 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('D-5 строки сводки над шапкой не считаются', () => {
    // Дефект: firstHeaderRow выставлялся только при «Объём, м3», и при
    // классической шапке строки сводки шли в позиции (202 вместо 200).
    const g = [];
    for (let i = 1; i <= 2; i += 1) g.push(['Сводка ' + i, '', '', '']);
    g.push(['№', 'Наименование', 'Ед. изм.', 'Кол-во']);
    for (let k = 1; k <= 200; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 200);
  });

  // ── 28. Восьмой проход: N-1…N-9 ─────────────────────────────────────────
  await check('N-1 прочерк в объёме не рубит хвост ведомости', () => {
    // КРИТИЧНЫЙ дефект: строка ['Р-7', '-'] попадала под признак «новая
    // таблица» и обнуляла единицу. Хвост (150 из 301) выпадал молча.
    const g = [['Наименование', 'Объём, м3']];
    for (let k = 1; k <= 300; k += 1) g.push([' Позиция ' + k, k === 7 ? '-' : 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('N-2 заголовок раздела в двух ячейках', () => {
    const g = [['Наименование', 'Объём, м3']];
    for (let k = 1; k <= 150; k += 1) g.push(['Очистка ' + k, 10 + k]);
    g.push(['Раздел 2', 'прочие работы']);
    for (let k = 151; k <= 300; k += 1) g.push(['Очистка ' + k, 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('N-3 повторная шапка без единицы наследует её', () => {
    const g = [['Наименование', 'Объём, м3']];
    for (let k = 1; k <= 150; k += 1) g.push(['Очистка ' + k, 10 + k]);
    g.push(['Наименование', 'Кол-во']);
    for (let k = 151; k <= 300; k += 1) g.push(['Очистка ' + k, 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('N-4 сводка с числом над шапкой не даёт фантом', () => {
    const g = [];
    g.push(['Сводка объёмов за май', 'м3', 12345]);
    g.push(['№', 'Наименование', 'Ед. изм.', 'Кол-во']);
    for (let k = 1; k <= 200; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 200);
  });

  await check('N-9 три и более копий в одном листе схлопываются', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let c = 0; c < 3; c += 1) {
      for (let k = 1; k <= 100; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 100);
  });

  // ── 29. Девятый проход: N-11…N-14 ───────────────────────────────────────
  await check('N-11 пустая ячейка объёма не рубит позиции', () => {
    // КРИТИЧНЫЙ: строка из одной ячейки без чисел считалась заголовком
    // раздела. 150 пустых из 300 давали ровно 150 — потеря половины.
    const g = [['Наименование', 'Объём, м3']];
    for (let k = 1; k <= 300; k += 1) g.push(['Позиция ' + k, k % 2 === 0 ? '' : 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('N-11 все объёмы пустые — строки всё равно позиции', () => {
    const g = [['Наименование', 'Объём, м3']];
    for (let k = 1; k <= 300; k += 1) g.push(['Позиция ' + k, '']);
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('N-12 четыре и более копий схлопываются', () => {
    // Дефект: учитывались ровно две копии, 4 давали 200.
    for (const copies of [2, 3, 4, 5]) {
      const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
      for (let c = 0; c < copies; c += 1) {
        for (let k = 1; k <= 100; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
      }
      assert.strictEqual(mod.countTableRows(g).positions, 100,
        copies + ' копий дали ' + mod.countTableRows(g).positions);
    }
  });

  await check('N-13 график с «Сроком» не считается ведомостью', () => {
    // Дефект: требовалось 2 графиковых слова, а «№ | Наименование | Срок» —
    // одно. ВОР 50 + график 300 давало 350 при верных 50.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 50; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
    g.push(['№', 'Наименование', 'Срок']);
    for (let k = 1; k <= 300; k += 1) g.push([k, 'Этап ' + k, k]);
    assert.strictEqual(mod.countTableRows(g).positions, 50);
  });

  await check('N-14 ВОР + график + ВОР — обе ведомости считаются', () => {
    // Дефект: третья таблица выпадала целиком (600 → 300).
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 300; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
    g.push(['Этап', 'Срок', 'Дней']);
    for (let k = 1; k <= 40; k += 1) g.push(['Этап ' + k, 'Неделя ' + k, k]);
    g.push(['№', 'Наименование', 'Ед', 'Кол-во']);
    for (let k = 1; k <= 300; k += 1) g.push([k, 'Замена ' + k, 'п.м', 20 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 600);
  });

  // ── 30. Десятый проход: N-17…N-21 ───────────────────────────────────────
  await check('N-17 одинаковые строки — данные, а не копия', () => {
    // КРИТИЧНЫЙ: 60 одинаковых строк («Замена лампы | шт | 1», примечание
    // с помещением) схлопывались как копия таблицы: 12 из 60, и недобор
    // не был виден. Теперь копией считается только НЕОДНОРОДНЫЙ блок.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во', 'Примечание']];
    for (let k = 1; k <= 60; k += 1) g.push([k, 'Замена лампы', 'шт', 1, 'Помещение ' + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 60);
  });

  await check('N-17b часть одинаковых строк внутри ведомости', () => {
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let k = 1; k <= 100; k += 1) {
      g.push([k, k <= 20 ? 'Замена лампы' : 'Работа ' + k, 'шт', 1]);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 100);
  });

  await check('N-19 «Блок/Секция/Часть/Этап» в названии — не заголовок', () => {
    // Дефект: служебное слово в начале названия работы рубило позиции:
    // «Блок питания» → 0 из 100.
    for (const name of ['Блок питания', 'Секция трубопровода', 'Часть футеровки', 'Этап зачистки']) {
      const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
      for (let k = 1; k <= 100; k += 1) g.push([k, name + ' ' + k, 'шт', 1]);
      assert.strictEqual(mod.countTableRows(g).positions, 100,
        '«' + name + '» посчитан как ' + mod.countTableRows(g).positions);
    }
  });

  await check('N-21 нумерованный заголовок «1. Цех N» — граница раздела', () => {
    // Дефект: такие заголовки не распознавались, и три раздела
    // схлопывались как копия: 100 из 300.
    const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
    for (let s = 0; s < 3; s += 1) {
      g.push([(s + 1) + '. Цех ' + (s + 1), '', '', '']);
      for (let k = 1; k <= 100; k += 1) g.push([k, 'Работа ' + k, 'м3', 10 + k]);
    }
    assert.strictEqual(mod.countTableRows(g).positions, 300);
  });

  await check('N-18 три цеха с разными объёмами не схлопываются', () => {
    // Дефект: подпись листа бралась только по названиям, и три цеха с
    // одинаковым составом работ, но РАЗНЫМИ объёмами считались копией:
    // 100 из 300.
    const mk = (offset) => {
      const g = [['№', 'Наименование', 'Ед', 'Кол-во']];
      for (let k = 1; k <= 100; k += 1) g.push([k, 'Работа ' + k, 'м3', offset + k]);
      return g;
    };
    const r = mod.countPositionsInSheets([
      { name: 'Цех 1', rows: mk(0) },
      { name: 'Цех 2', rows: mk(1000) },
      { name: 'Цех 3', rows: mk(2000) }
    ]);
    assert.strictEqual(r.positions, 300);
  });

  await check('N-20 ведомость без единиц детектором НЕ считается (осознанно)', () => {
    // Таблица «Наименование | Количество» без единиц структурно неотличима
    // от графика работ «Этап | Дней» и оглавления «Раздел | Стр.».
    // Попытка угадать давала 140 позиций на графике и 200 на оглавлении —
    // ложную тревогу на полном разборе.
    //
    // Выбран нуль: детектор молчит, анализ идёт как раньше. Это честно —
    // молчаливый недобор (показать «полный разбор» при потере половины)
    // недопустим, ложная тревога тоже. Нуль не врёт, он выключает порог.
    const g = [['Наименование', 'Количество']];
    for (let k = 1; k <= 100; k += 1) g.push(['Очистка ' + k, 10 + k]);
    assert.strictEqual(mod.countTableRows(g).positions, 0,
      'без единиц детектор должен молчать, а не угадывать');
  });

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
  process.exit(failed.length ? 1 : 0);
})();
