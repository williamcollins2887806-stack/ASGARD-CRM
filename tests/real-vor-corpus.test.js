'use strict';

/**
 * Корпусный тест на РЕАЛЬНЫХ документах заказчика (оракул).
 *
 * ── Зачем этот файл ────────────────────────────────────────────────────────
 * 21 круг правок шёл без оракула: верификатор придумывал формат, исполнитель
 * латал, следующая эвристика ломала предыдущую. Тесты были синтетическими.
 *
 * Здесь ожидаемые числа берутся из САМИХ ДОКУМЕНТОВ: в файле «Дефектная
 * ведомость» на листе «0_Читать» заказчик написал «Позиций | 673».
 *
 * Тест пропускается, если файлов нет на диске (на сервере их не будет).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mod = require(path.join(__dirname, '..', 'src', 'services', 'table-row-count.js'));

const ROOT = 'C:\\Users\\Nikita-ASGARD\\Desktop\\Документы';

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

function skip(name, why) {
  results.push({ name, ok: true, skipped: true });
  console.log('SKIP ' + name + ' — ' + why);
}

function findAll(dir, out) {
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) findAll(full, out);
    else if (/\.(xlsx|xls)$/i.test(it.name)) out.push(full);
  }
  return out;
}

function findByName(list, fragment) {
  return list.find((f) => path.basename(f).toLowerCase().includes(fragment.toLowerCase())) || null;
}

(async () => {
  const exists = fs.existsSync(ROOT);
  const files = exists ? findAll(ROOT, []) : [];
  if (!exists) console.log('папка документов не найдена — корпус пропущен');

  // ── 1. Дефектная ведомость: 673 позиции по эталону заказчика ────────────
  const defectFile = findByName(files, 'Дефектная_ведомость');
  if (!defectFile) {
    skip('дефектная ведомость: 673 позиции', 'файл не найден');
  } else {
    await check('дефектная ведомость: 673 позиции (эталон заказчика)', async () => {
      // Эталон — из самого документа: лист «0_Читать» содержит «Позиций | 673».
      // Сверяем ЛИСТ ведомости, а не всю книгу: остальные листы — сводки по
      // типам и методам, это не перечни работ. Считать их позициями нельзя
      // (иначе 686 вместо 673).
      const XLSX = require('xlsx');
      const wb = XLSX.read(fs.readFileSync(defectFile), { type: 'buffer' });
      const sheetName = wb.SheetNames.find((n) => /дефектная_ведомость/i.test(n)) || wb.SheetNames[1];
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
        header: 1, blankrows: false, defval: ''
      });
      const r = mod.countTableRows(aoa);
      assert.strictEqual(r.positions, 673, 'получено ' + r.positions + ' вместо 673');
    });
  }

  // ── 2. Реестр очищаемого оборудования: 68 позиций (проверено глазами) ───
  const registryFile = findByName(files, 'Приложение 10');
  if (!registryFile) {
    skip('реестр очищаемого оборудования: 68', 'файл не найден');
  } else {
    await check('реестр очищаемого оборудования: 68 позиций', async () => {
      const buf = fs.readFileSync(registryFile);
      const r = await mod.countPositionsFromBuffer({ buf, originalName: path.basename(registryFile) });
      assert.strictEqual(r.positions, 68, 'получено ' + r.positions + ' вместо 68');
    });
  }

  // ── 3. Единица внутри имени колонки ─────────────────────────────────────
  await check('единица внутри имени колонки («Площадь_м2», «Объем_емкости_м3»)', () => {
    // Так устроена реальная ведомость заказчика. Без этого вся она давала 0.
    const g = [['№', 'Наименование', 'Площадь_м2', 'Объем_емкости_м3']];
    for (let k = 1; k <= 50; k += 1) g.push([k, 'Очистка ' + k, 10 + k, 100 + k]);
    const r = mod.countTableRows(g);
    assert.strictEqual(r.positions, 50, 'получено ' + r.positions);
    assert.ok(r.headerUnit, 'единица из имени колонки не найдена');
  });

  await check('«Ед. изм.» не считается единицей из имени колонки', () => {
    // Обозначение колонки единиц — не единица: она будет в данных.
    const g = [['№', 'Наименование', 'Ед. изм.', 'Кол-во']];
    for (let k = 1; k <= 50; k += 1) g.push([k, 'Очистка ' + k, 'м3', 10 + k]);
    const r = mod.countTableRows(g);
    assert.strictEqual(r.positions, 50);
  });

  // ── 4. График не даёт фантомов ──────────────────────────────────────────
  const scheduleFile = findByName(files, 'График_чисток');
  if (!scheduleFile) {
    skip('график чисток не даёт фантомов', 'файл не найден');
  } else {
    await check('график чисток не даёт сотни фантомных позиций', async () => {
      const buf = fs.readFileSync(scheduleFile);
      const r = await mod.countPositionsFromBuffer({ buf, originalName: path.basename(scheduleFile) });
      assert.ok(r.positions < 100,
        'график дал ' + r.positions + ' позиций — похоже на фантомы');
    });
  }

  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped).length;
  console.log('');
  console.log('итог: ' + (results.length - failed.length - skipped) + ' PASS, '
    + failed.length + ' FAIL, ' + skipped + ' SKIP');
  process.exit(failed.length ? 1 : 0);
})();
