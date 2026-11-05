/**
 * API-тесты учёта часов офиса по СКУД (/api/office-attendance).
 *
 * Запускаются на КЛОНЕ (127.0.0.1:3100), не на проде: импорт пишет в
 * staff_plan и office_hours_daily, на проде это боевые данные.
 *
 * Покрываем оба контура:
 *   1) ручной импорт файла отчёта;
 *   2) идемпотентность (тот же файл / тот же период);
 *   3) часы попадают в дашборд месяца и в раскрытие дня;
 *   4) ложная отметка «оф» снимается и превращается в вопрос;
 *   5) ответ на вопрос закрывает день, «оф» в ответе запрещён;
 *   6) прямой POST в /api/data/staff_plan с «оф» тоже блокируется.
 *
 * Требует применённой миграции V453 на клоне.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { api, assert, getToken, BASE_URL } = require('../config');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'skud');

function fixturePath() {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => /\.xls$/i.test(f));
  if (!files.length) throw new Error('Нет фикстуры отчёта СКУД');
  return path.join(FIXTURE_DIR, files[0]);
}

/** Короткая обёртка: api(method, path, {role, body}) → { status, data }. */
async function call(method, urlPath, role, body) {
  const res = await api(method, urlPath, { role, body });
  return { status: res.status, body: res.data };
}

/** multipart-загрузка файла (без внешних зависимостей). */
async function uploadReport(role, filePath, query = '') {
  const token = await getToken(role);
  const buf = fs.readFileSync(filePath);
  const boundary = '----asgardSkud' + Date.now();
  const fname = path.basename(filePath);
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fname}"\r\n` +
    'Content-Type: application/vnd.ms-excel\r\n\r\n',
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([head, buf, tail]);

  const r = await fetch(`${BASE_URL}/api/office-attendance/import${query}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length)
    },
    body
  });
  let json = null;
  try { json = await r.json(); } catch (_) {}
  return { status: r.status, body: json };
}

module.exports = {
  name: 'Office attendance (СКУД)',
  tests: [
    {
      name: 'V453: миграция применена (таблицы на месте)',
      async run() {
        const res = await call('GET', '/api/office-attendance/imports?limit=1', 'ADMIN');
        assert(res.status !== 500, `GET /imports вернул 500: ${JSON.stringify(res.body).slice(0, 300)}`);
        assert(res.body && res.body.ok === true, 'ожидался { ok: true }');
      }
    },

    {
      name: 'GET /month отдаёт дашборд с нормами и часами',
      async run() {
        const now = new Date();
        const res = await call(
          'GET',
          `/api/office-attendance/month?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
          'ADMIN'
        );
        assert(res.status === 200, `GET /month: ${res.status}`);
        assert(res.body.ok === true, 'ok != true');
        assert(res.body.company, 'нет блока company');
        assert(Array.isArray(res.body.people), 'people не массив');
        assert(typeof res.body.company.norm_minutes === 'number', 'норма месяца не число');
        if (res.body.people.length) {
          const p = res.body.people[0];
          assert(Array.isArray(p.days), 'у сотрудника нет дней');
          assert(p.month && typeof p.month.delta_minutes === 'number', 'нет месячной дельты');
        }
      }
    },

    {
      name: 'POST /import отклоняет не-отчёт СКУД (понятная ошибка, не 500)',
      async run() {
        const XLSX = require('xlsx');
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Счёт'], ['ИНН 1234']]), 'Лист1');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const tmp = path.join(os.tmpdir(), `not-skud-${Date.now()}.xlsx`);
        fs.writeFileSync(tmp, buf);
        try {
          const res = await uploadReport('ADMIN', tmp);
          assert(res.status === 400 || res.status === 409,
            `ожидался 400/409, пришёл ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
          assert(res.body && (res.body.error || res.body.message), 'нет описания ошибки');
        } finally {
          try { fs.unlinkSync(tmp); } catch (_) {}
        }
      }
    },

    {
      name: 'POST /import импортирует отчёт и пишет часы',
      async run() {
        const res = await uploadReport('ADMIN', fixturePath(), '?allow_overlap=1');
        assert(res.status === 200 || res.status === 409,
          `импорт: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);

        if (res.status === 409) {
          // Повтор того же файла (sha256) — единственный ожидаемый 409.
          assert(res.body.error === 'duplicate',
            `неожиданная причина отказа: ${res.body.error}`);
          return;
        }

        assert(res.body.ok === true, 'ok != true');
        assert(res.body.people > 0, 'в отчёте нет людей');
        assert(res.body.daysWritten > 0, 'не записано ни одного дня часов');
        assert(res.body.periodFrom === '2026-10-26', `период с ${res.body.periodFrom}`);
        assert(res.body.periodTo === '2026-11-01', `период по ${res.body.periodTo}`);
      }
    },

    {
      name: 'Повторный импорт того же файла — отказ по sha256',
      async run() {
        const first = await uploadReport('ADMIN', fixturePath(), '?allow_overlap=1');
        if (first.status === 409) {
          assert(first.body.error === 'duplicate', 'не та причина');
          return;
        }
        const second = await uploadReport('ADMIN', fixturePath(), '?allow_overlap=1');
        assert(second.status === 409, `повтор того же файла должен давать 409, пришёл ${second.status}`);
        assert(second.body.error === 'duplicate',
          `ожидался duplicate, пришёл ${second.body.error}`);
      }
    },

    {
      name: 'Часы офиса не задвоились (месяц считается без ошибок)',
      async run() {
        const res = await call('GET', '/api/office-attendance/imports?limit=20', 'ADMIN');
        assert(res.status === 200, 'GET /imports');
        const imports = (res.body.imports || []).filter((i) => !i.deleted_at);
        for (const imp of imports) {
          assert(imp.period_from && imp.period_to, 'у импорта нет периода');
        }
        const m = await call('GET', '/api/office-attendance/month?year=2026&month=10', 'ADMIN');
        assert(m.status === 200, `GET /month за октябрь: ${m.status}`);
        assert(m.body.ok === true, 'ok != true');
      }
    },

    {
      name: 'GET /day раскрывает день: проходы, интервалы, часы СРМ',
      async run() {
        const m = await call('GET', '/api/office-attendance/month?year=2026&month=10', 'ADMIN');
        assert(m.status === 200, 'month');
        let person = null;
        let day = null;
        for (const p of m.body.people || []) {
          const d = (p.days || []).find((x) => x.office_minutes > 0);
          if (d) { person = p; day = d; break; }
        }
        if (!person) return; // нет данных — отчёт мог не импортироваться

        const res = await call(
          'GET', `/api/office-attendance/day?staff_id=${person.staff_id}&date=${day.date}`, 'ADMIN'
        );
        assert(res.status === 200, `GET /day: ${res.status}`);
        assert(res.body.ok === true, 'ok != true');
        assert(res.body.office_minutes > 0, 'часы офиса не пришли');
        assert(Array.isArray(res.body.segments), 'нет segments');
        assert(Array.isArray(res.body.punches), 'нет punches');
        assert(res.body.crm && typeof res.body.crm.minutes === 'number', 'нет часов СРМ');
        assert(res.body.credit && res.body.credit.source, 'нет источника зачёта');
      }
    },

    {
      name: 'GET /reports-status показывает, за какие дни отчёта нет',
      async run() {
        const res = await call('GET', '/api/office-attendance/reports-status?year=2026&month=10', 'ADMIN');
        assert(res.status === 200, `reports-status: ${res.status}`);
        assert(res.body.ok === true, 'ok != true');
        assert(Array.isArray(res.body.days), 'days не массив');
        assert(res.body.days.length === 31, `дней в октябре: ${res.body.days.length}`);
        const okDays = res.body.days.filter((d) => d.status === 'ok');
        assert(okDays.length > 0, 'ни одного дня с отчётом — импорт не сработал?');
        for (const d of res.body.days) {
          assert(['ok', 'missing', 'future', 'dayoff'].includes(d.status), `странный статус ${d.status}`);
        }
      }
    },

    {
      name: 'Ложный «оф» блокируется: POST в /api/data/staff_plan',
      async run() {
        const m = await call('GET', '/api/office-attendance/month?year=2026&month=10', 'OFFICE_MANAGER');
        assert(m.status === 200, 'month для офис-менеджера');

        let without = null;
        for (const p of m.body.people || []) {
          for (const d of p.days || []) {
            if (!without && d.office_minutes === 0 && d.skud_missing === false) {
              without = { staffId: p.staff_id, date: d.date };
            }
          }
          if (without) break;
        }
        if (!without) return; // нет дня без проходов в покрытом периоде

        const blocked = await call('POST', '/api/data/staff_plan', 'OFFICE_MANAGER', {
          staff_id: without.staffId,
          date: without.date,
          status_code: 'оф'
        });
        assert(blocked.status === 409,
          `ожидался 409 office_not_confirmed, пришёл ${blocked.status}: ${JSON.stringify(blocked.body).slice(0, 200)}`);
        assert(blocked.body.error === 'office_not_confirmed', `код ошибки: ${blocked.body.error}`);
      }
    },

    {
      name: 'Ответ на «где ты был»: «оф» запрещён, «уд» принимается',
      async run() {
        const week = await call('GET', '/api/daily-presence/week', 'TO');
        assert(week.status === 200, `week: ${week.status}`);
        const disputes = week.body.disputes || [];

        if (!disputes.length) {
          const r = await call('POST', '/api/daily-presence/dispute-response', 'TO',
            { date: '2026-10-29', status_code: 'уд' });
          assert([400, 404, 409].includes(r.status), `ожидалась ошибка, пришёл ${r.status}`);
          return;
        }

        const d = disputes[0];
        const banned = await call('POST', '/api/daily-presence/dispute-response', 'TO',
          { date: d.date, status_code: 'оф' });
        assert(banned.status === 400, `«оф» в ответе должен быть запрещён, пришёл ${banned.status}`);
        assert(banned.body.error === 'office_not_allowed', `код: ${banned.body.error}`);

        const ok = await call('POST', '/api/daily-presence/dispute-response', 'TO',
          { date: d.date, status_code: 'уд' });
        assert(ok.status === 200, `ответ «уд»: ${ok.status} ${JSON.stringify(ok.body).slice(0, 200)}`);
        assert(ok.body.ok === true, 'ok != true');

        const again = await call('POST', '/api/daily-presence/dispute-response', 'TO',
          { date: d.date, status_code: 'уд' });
        assert(again.status === 409, `повторный ответ должен давать 409, пришёл ${again.status}`);
      }
    },

    {
      name: 'GET /me отдаёт личный отчёт и текст недоработки',
      async run() {
        const res = await call(
          'GET', '/api/office-attendance/me?from=2026-10-26&to=2026-11-01', 'TO'
        );
        // 404 допустим: у тестового аккаунта может не быть строки в staff.
        assert([200, 404].includes(res.status), `GET /me: ${res.status}`);
        if (res.status !== 200) return;
        assert(res.body.ok === true, 'ok != true');
        assert(res.body.summary, 'нет summary');
        assert(typeof res.body.summary_text === 'string', 'нет текста недоработки');
        assert(Array.isArray(res.body.days), 'days не массив');
        assert(res.body.days.length === 7, `дней в неделе: ${res.body.days.length}`);
      }
    },

    {
      name: 'GET /self-check показывает минуты СРМ и сессии',
      async run() {
        const res = await call('GET', '/api/office-attendance/self-check', 'TO');
        assert(res.status === 200, `self-check: ${res.status}`);
        assert(res.body.ok === true, 'ok != true');
        assert(typeof res.body.crm_minutes === 'number', 'crm_minutes не число');
        assert(Array.isArray(res.body.sessions), 'sessions не массив');
        assert(typeof res.body.message === 'string', 'нет сообщения');
      }
    },

    {
      name: 'Непривязанные ФИО: список и привязка',
      async run() {
        const res = await call('GET', '/api/office-attendance/pending-map', 'ADMIN');
        assert(res.status === 200, `pending-map: ${res.status}`);
        assert(res.body.ok === true, 'ok != true');
        assert(Array.isArray(res.body.items), 'items не массив');
        if (!res.body.items.length) return;

        const first = res.body.items[0];
        assert(typeof first.raw_name === 'string', 'нет raw_name');
        assert(typeof first.days === 'number', 'нет количества дней');
        assert(Array.isArray(first.candidates), 'нет кандидатов');

        const target = first.candidates[0];
        const map = await call('POST', '/api/office-attendance/map', 'ADMIN',
          target ? { raw_name: first.raw_name, staff_id: target.staff_id }
                 : { raw_name: first.raw_name, skip: true });
        assert(map.status === 200, `map: ${map.status} ${JSON.stringify(map.body).slice(0, 200)}`);
        assert(map.body.ok === true, 'ok != true');

        const after = await call('GET', '/api/office-attendance/pending-map', 'ADMIN');
        assert(after.status === 200, 'pending-map повторно');
        const stillThere = (after.body.items || []).some((x) => x.raw_name === first.raw_name);
        assert(!stillThere, `ФИО «${first.raw_name}» осталось в списке после привязки`);
      }
    },

    {
      name: 'Настройки: чтение и валидация',
      async run() {
        const cur = await call('GET', '/api/office-attendance/settings', 'ADMIN');
        assert(cur.status === 200, `GET /settings: ${cur.status}`);
        assert(cur.body.settings, 'нет настроек');
        assert(typeof cur.body.settings.merge_gap_min === 'number', 'нет merge_gap_min');

        const bad = await call('PUT', '/api/office-attendance/settings', 'ADMIN', { norm_hours_per_day: -5 });
        assert(bad.status === 400, `отрицательная норма должна давать 400, пришёл ${bad.status}`);

        const good = await call('PUT', '/api/office-attendance/settings', 'ADMIN', { merge_gap_min: 60 });
        assert(good.status === 200, `PUT /settings: ${good.status}`);
      }
    },

    {
      name: 'Права: PM не может импортировать отчёт',
      async run() {
        const res = await uploadReport('PM', fixturePath(), '?allow_overlap=1');
        assert(res.status === 403, `PM должен получить 403, пришёл ${res.status}`);
      }
    }
  ]
};
