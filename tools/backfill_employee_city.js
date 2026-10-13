#!/usr/bin/env node
'use strict';
/**
 * tools/backfill_employee_city.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Разовый перенос: выделить город из адресов в employees.city (V389).
 *
 * ПРИОРИТЕТ ИСТОЧНИКОВ (решение Никиты, 13.10.2026):
 *   1) registration_address  — адрес регистрации
 *   2) address               — адрес проживания (фолбэк)
 *   3) city                  — если уже был город, но с примесью адреса
 *   4) birth_place           — где нет адреса вообще (17 записей), но помечается
 *                              city_source='birth_place_region' → ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ
 *
 * ЧЕГО СКРИПТ НЕ ДЕЛАЕТ (осознанно):
 *   • не трогает 30 записей, где city УЖЕ заполнен, но противоречит адресам
 *     (решение: manual_list) — выводит их списком в отчёт;
 *   • не перезаписывает city там, где он уже является чистым городом;
 *   • не пишет город, если адрес обрезан и город не извлечён (флаг low) —
 *     такие записи уходят в отчёт «ТРЕБУЕТ ПРОВЕРКИ»;
 *   • не придумывает город из паспорта/места рождения молча.
 *
 * Использование:
 *   node tools/backfill_employee_city.js --dry-run          # отчёт, ничего не пишет
 *   node tools/backfill_employee_city.js --apply            # записать в БД
 *   node tools/backfill_employee_city.js --apply --only-confidence   # только уверенные
 *   node tools/backfill_employee_city.js --report out.md    # сохранить отчёт
 *
 * Переменные окружения: DATABASE_URL либо PG* (по умолчанию — локальный asgard/asgard_crm_dev).
 * Идемпотентно: повторный --apply ничего не меняет (значения уже нормализованы).
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { extractCity, looksLikeAddress, isAcceptableCity } = require('../src/lib/city');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ONLY_CONFIDENCE = argv.includes('--only-confidence');
const reportIdx = argv.indexOf('--report');
const REPORT_PATH = reportIdx >= 0 ? argv[reportIdx + 1] : null;

const DEFAULTS = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'asgard',
  password: process.env.PGPASSWORD || '123456789',
  database: process.env.PGDATABASE || 'asgard_crm_dev'
};

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
const isPlaceholder = (s) => /^(?:-+|—+|нет|н\/д|не указан|не указано|неизвестно)$/i.test(norm(s));
const looksRegionOnly = (s) =>
  /(?:обл\.?|область|край|респ\.?|республика|округ|р-н\.?|р-он\.?|район)\s*$/i.test(norm(s));

/** Русская транслитерация (ГОСТ-подобная) — чтобы сверить «Saratov» ↔ «Саратов». */
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};
function translitRu(s) {
  return norm(s).split('').map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch)).join('').replace(/\s+/g, '');
}

const SELECT = `
  SELECT id, fio, city, address, registration_address,
         birth_place, city_source
    FROM employees
   ORDER BY id
`;

/**
 * Действие: 'set' | 'skip' | 'report_conflict' | 'report_low' | 'report_birth' | 'report_empty'
 * Чистая функция — удобно тестировать.
 */
function planOne(row) {
  const city = (row.city || '').trim();
  const reg = (row.registration_address || '').trim();
  const addr = (row.address || '').trim();
  const birth = (row.birth_place || '').trim();

  const fromReg = isPlaceholder(reg) ? null : extractCity(reg);
  const fromAddr = isPlaceholder(addr) ? null : extractCity(addr);
  const fromCity = isPlaceholder(city) ? null : extractCity(city);
  const hasAddresses = !!(addr || reg);

  // ── Есть ли уверенно извлекаемый город из адресов (регистрация → проживание).
  let pick = fromReg || fromAddr;
  let source = fromReg ? 'registration_address' : (fromAddr ? 'address' : null);
  if (fromReg && fromReg.low && fromAddr && !fromAddr.low) {
    pick = fromAddr; source = 'address';       // регистрация дала лишь остаток
  }

  // ═══ A. city ПУСТ ═════════════════════════════════════════════════════════
  // Читаем и пишем по ОДНОМУ контракту (isAcceptableCity): иначе бэкфилл
  // записывает значение, которое потом отвергает валидация при повторной записи
  // (read/write-асимметрия, найденная верификатором).
  if (!city) {
    if (pick && !pick.low && isAcceptableCity(pick.city)) {
      return { action: 'set', reason: 'из ' + source, value: pick.city, source, confidence: 'high' };
    }
    if (fromCity && !fromCity.low) {
      const norm1 = extractCity(fromCity.city);
      if (norm1 && !norm1.low && isAcceptableCity(norm1.city)) {
        return { action: 'set', reason: 'из city', value: norm1.city, source: 'city', confidence: 'high' };
      }
    }
    if (pick && pick.low) {
      return { action: 'report_low', reason: 'адрес обрезан', value: pick.city, source, candidates: { fromReg: fromReg && fromReg.city, fromAddr: fromAddr && fromAddr.city } };
    }
    if (birth && !isPlaceholder(birth)) {
      const b = extractCity(birth);
      const bn = b && extractCity(b.city);
      if (bn && !bn.low && isAcceptableCity(bn.city)) {
        return { action: 'report_birth', reason: 'адреса нет; место рождения — только ориентир', value: bn.city, source: 'birth_place' };
      }
    }
    return { action: 'report_empty', reason: 'нет данных', value: null, source: null };
  }

  // ═══ B. city ЗАПОЛНЕН ════════════════════════════════════════════════════

  // B0. Адресов нет вообще — сверять не с чем. Проверяем ДО B1, иначе регион
  //     (#10161 «Волгоградская обл») попадает в «ручной разбор» и остаётся
  //     в «Городе», хотя это прямо запрещено критерием. Но сначала пробуем
  //     нормализовать само значение: «Москва(Московская область)» → «Москва».
  if (!hasAddresses) {
    const fromSelf = extractCity(city);
    if (fromSelf && !fromSelf.low && isAcceptableCity(fromSelf.city)) {
      return fromSelf.city === city
        ? { action: 'skip', reason: 'city уже город', value: city, source: 'keep' }
        : { action: 'set', reason: 'city нормализован', value: fromSelf.city, source: 'city', confidence: 'high', wasAddress: city };
    }
    // Регион / маркер / латиница / улица / мусор в «Городе» не храним.
    return { action: 'set', reason: 'city = не-город без адресов → обнуляем', value: null, source: null, confidence: 'high', wasAddress: city };
  }

  // B1. В «Городе» лежит адрес/регион/мусор — нормализуем, если уверенный город
  //     есть в адресах ИЛИ в самом значении city (кейсы #10227, #10228: адресов
  //     нет вообще, но в city лежит полный адрес с городом внутри).
  if (looksLikeAddress(city) || isPlaceholder(city)) {
    const fromCityItself =
      fromCity && !fromCity.low && !looksRegionOnly(fromCity.city) && !looksLikeAddress(fromCity.city)
        ? fromCity
        : null;
    const sourcePick = pick && !pick.low && isAcceptableCity(pick.city)
      ? { res: pick, source }
      : (fromCityItself && isAcceptableCity(fromCityItself.city) ? { res: fromCityItself, source: 'city' } : null);
    if (sourcePick) {
      return {
        action: 'set',
        reason: 'city был адресом → из ' + sourcePick.source,
        value: sourcePick.res.city,
        source: sourcePick.source,
        confidence: 'high',
        wasAddress: city
      };
    }
    // Нормализовать не удалось. Если само значение — не город (регион/страна/
    // маркер), в «Городе» его оставлять НЕЛЬЗЯ: обнуляем. Иначе бэкфилл записывает
    // значение, которое потом отвергает валидация (read/write-асимметрия, id=27
    // «Казахстан» — найдено верификатором).
    if (!isAcceptableCity(city)) {
      return { action: 'set', reason: 'city = не-город, город из адреса не извлекается → обнуляем', value: null, source: null, confidence: 'high', wasAddress: city };
    }
    return { action: 'report_conflict', reason: 'city = адрес/регион, город уверенно не извлекается', value: city, candidates: { fromReg: fromReg && fromReg.city, fromAddr: fromAddr && fromAddr.city } };
  }

  // B2. Конфликт: city не встречается ни в одном адресе → РУЧНОЙ РАЗБОР.
  //     Исключение — чистая транслитерация: city='Saratov', адрес='Саратов'.
  //     Это тот же город, просто латиницей; приводим к кириллической форме
  //     (детерминированно, только при точном совпадении транслита).
  const inReg = norm(reg).includes(norm(city));
  const inAddr = norm(addr).includes(norm(city));
  if (!inReg && !inAddr) {
    for (const cand of [fromReg && fromReg.city, fromAddr && fromAddr.city]) {
      if (cand && translitRu(cand) === norm(city)) {
        return { action: 'set', reason: 'латиница → ' + cand, value: cand, source: source || 'city', confidence: 'high', wasAddress: city };
      }
    }
    return { action: 'report_conflict', reason: 'city противоречит обоим адресам', value: city, candidates: { fromReg: fromReg && fromReg.city, fromAddr: fromAddr && fromAddr.city } };
  }

  // B4. city — уже чистый город и не противоречит адресам → не трогаем.
  //     Кириллицу проверяем и здесь: латиница в «Городе» недопустима.
  if (!/[А-ЯЁа-яё]/.test(city)) {
    const cand = (fromReg && !fromReg.low && fromReg.city) || (fromAddr && !fromAddr.low && fromAddr.city);
    if (cand) return { action: 'set', reason: 'латиница → ' + cand, value: cand, source, confidence: 'high', wasAddress: city };
    return { action: 'set', reason: 'city = не-кириллица → обнуляем', value: null, source: null, confidence: 'high', wasAddress: city };
  }
  return { action: 'skip', reason: 'city уже город', value: city, source: 'keep' };
}

function fmtRow(r) {
  const v = (x) => (x == null || x === '' ? '—' : String(x));
  const cand = r.candidates
    ? [r.candidates.fromReg, r.candidates.fromAddr].filter(Boolean).join(' / ')
    : '';
  return `| ${r.id} | ${v(r.fio).slice(0, 22)} | ${v(r.city).slice(0, 34)} | ${v(r.address || r.registration_address).slice(0, 40)} | ${v(r.reason)} | ${v(cand) || v(r.source)} |`;
}

async function main() {
  const client = new Client(DEFAULTS);
  await client.connect();

  const { rows } = await client.query(SELECT);
  const buckets = {
    set: [], skip: [], report_conflict: [], report_low: [], report_birth: [], report_empty: []
  };
  for (const row of rows) {
    const plan = planOne(row);
    buckets[plan.action].push({ ...row, ...plan });
  }

  const set = buckets.set;
  const willChange = set.filter((r) => (r.value || '') !== (r.city || '').trim());

  const lines = [];
  lines.push('# V389 — Выделение города из адресов (employees.city)');
  lines.push('');
  lines.push(`Дата: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
  lines.push(`Режим: ${APPLY ? '**APPLY (запись в БД)**' : 'DRY-RUN (только отчёт)'}`);
  lines.push(`Всего записей: **${rows.length}**`);
  lines.push('');
  lines.push('| Итог | Кол-во |');
  lines.push('|---|---:|');
  lines.push(`| Будет установлен город (уверенно) | ${willChange.length} |`);
  lines.push(`| Пропущено (city уже город / без изменений) | ${buckets.skip.length} |`);
  lines.push(`| ⚠ Конфликт city ↔ адрес (ручной разбор) | ${buckets.report_conflict.length} |`);
  lines.push(`| ⚠ Адрес обрезан (ручной разбор) | ${buckets.report_low.length} |`);
  lines.push(`| ⚠ Только место рождения (подтвердить) | ${buckets.report_birth.length} |`);
  lines.push(`| Нет данных | ${buckets.report_empty.length} |`);
  lines.push('');

  const section = (title, arr) => {
    if (!arr.length) return;
    lines.push(`## ${title} (${arr.length})`);
    lines.push('');
    lines.push('| id | ФИО | city сейчас | адрес | причина | город-кандидат |');
    lines.push('|---|---|---|---|---|---|');
    arr.forEach((r) => lines.push(fmtRow(r)));
    lines.push('');
  };
  section('Будет установлен город', willChange);
  section('⚠ Конфликт city ↔ адрес — решает человек', buckets.report_conflict);
  section('⚠ Адрес обрезан — нужен город вручную', buckets.report_low);
  section('⚠ Определён только по месту рождения — НЕ город проживания', buckets.report_birth);
  section('Нет данных для города', buckets.report_empty);

  const report = lines.join('\n');
  if (REPORT_PATH) {
    fs.writeFileSync(REPORT_PATH, report, 'utf8');
    console.log('Отчёт: ' + path.resolve(REPORT_PATH));
  }
  console.log(report.split('\n').slice(0, 14).join('\n'));

  if (!APPLY) {
    console.log('\n[dry-run] Изменений в БД не внесено. Для записи: --apply');
    await client.end();
    return;
  }

  // ── Запись ────────────────────────────────────────────────────────────────
  // Снимок в city_legacy повторяем ТОЛЬКО пока V389 не помечена в реестре
  // миграций. Иначе каждый прогон бэкфилла сбивал бы аудит-снимок на уже
  // очищенный город (реальная дыра, найденная верификатором).
  let updated = 0, skippedLow = 0, cleared = 0;
  await client.query('BEGIN');
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);
    const mig = await client.query(
      `SELECT 1 FROM migrations WHERE name = 'V389__employee_city_split'`
    );
    if (mig.rowCount === 0) {
      await client.query(`
        UPDATE employees e
           SET city_legacy = e.city
          FROM (SELECT unnest($1::int[]) AS id) t
         WHERE e.id = t.id
           AND e.city_legacy IS NULL
           AND e.city IS NOT NULL
           AND btrim(e.city) <> ''
      `, [willChange.map((r) => r.id)]);
    }

    for (const r of willChange) {
      if (ONLY_CONFIDENCE && r.confidence !== 'high') { skippedLow++; continue; }
      await client.query(
        `UPDATE employees
            SET city = $1,
                city_source = $2,
                city_updated_at = NOW(),
                updated_at = NOW()
          WHERE id = $3`,
        [r.value, r.value === null ? null : (r.source || 'migrated_v389'), r.id]
      );
      if (r.value === null) cleared++; else updated++;
    }

    // ── Constraint длины: ставим ТОЛЬКО ПОСЛЕ очистки (в БД был адрес на 81
    //    символ, который иначе блокирует собственную правку). NOT VALID —
    //    действует на новые INSERT/UPDATE немедленно, старые строки валидируем
    //    отдельно и не падаем, если ручной разбор ещё не закончен.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_employees_city_length') THEN
          ALTER TABLE employees
            ADD CONSTRAINT chk_employees_city_length
            CHECK (city IS NULL OR char_length(btrim(city)) <= 60)
            NOT VALID;
        END IF;
      END $$;
    `);
    const left = await client.query(
      `SELECT count(*)::int AS n FROM employees
        WHERE city IS NOT NULL AND char_length(btrim(city)) > 60`
    );
    if (left.rows[0].n === 0) {
      await client.query('ALTER TABLE employees VALIDATE CONSTRAINT chk_employees_city_length');
      console.log('[apply] constraint chk_employees_city_length провалидирован (все строки ≤60 символов)');
    } else {
      console.log(`[apply] constraint добавлен NOT VALID — осталось длинных city: ${left.rows[0].n} (ручной разбор)`);
    }

    // ── Реестр миграций: помечаем V389 выполненной, чтобы `node migrations/run.js`
    //    не пытался применить её повторно. Идемпотентно.
    await client.query(
      `INSERT INTO migrations (name) VALUES ('V389__employee_city_split') ON CONFLICT (name) DO NOTHING`
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
  console.log(`\n[apply] Обновлено: ${updated}` + (cleared ? `, обнулено (регион/не-город): ${cleared}` : '') + (skippedLow ? `, пропущено (low): ${skippedLow}` : ''));
  await client.end();
}

if (require.main === module) {
  main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
}

module.exports = { planOne };
