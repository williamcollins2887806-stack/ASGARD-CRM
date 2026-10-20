'use strict';
/**
 * ЧЕЛОВЕЧЕСКИЕ ОШИБКИ ДЛЯ ПОЛЬЗОВАТЕЛЯ.
 * ═══════════════════════════════════════════════════════════════════════════
 * Правило продукта: любая ошибка должна говорить пользователю
 *   1) ЧТО случилось (message) — простыми словами, без кода и SQL;
 *   2) ЧТО делать (hint) — конкретный следующий шаг.
 * «Ошибка сервера», «HTTP 500» и стек — недопустимы в ответе клиенту.
 *
 * Как пользоваться в ручках:
 *   const { sendHuman } = require('../lib/human-error');
 *   } catch (err) {
 *     logError(fastify, '[payouts] POST /pay', err, req);
 *     return sendHuman(reply, err, { action: 'Выплата не проведена — деньги не ушли.' });
 *   }
 *
 * Формат ответа (совместим с фронтами: они читают message || error):
 *   { error: '<машинный код>', message: '<что случилось>', hint: '<что делать>', statusCode }
 */

/**
 * Описание ошибки по её коду/типу: что случилось и что делать.
 * Возвращает { statusCode, code, message, hint }.
 */
function describeError(err) {
  // ── Ошибки Fastify (маршрутизация/тело) — англ. текст в err.message ────
  const fcode = err && (err.code || '');
  switch (fcode) {
    case 'FST_ERR_BAD_URL':
      return {
        statusCode: 400, code: 'bad_url',
        message: 'Адрес запроса содержит недопустимые символы.',
        hint: 'Обновите страницу (F5) и повторите действие. Если повторяется — сообщите администратору.',
      };
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
    case 'FST_ERR_CTP_INVALID_CONTENT_TYPE':
      return {
        statusCode: 415, code: 'unsupported_media_type',
        message: 'Данные отправлены в неподдерживаемом формате.',
        hint: 'Обновите страницу (F5) и повторите действие. Если прикладываете файл — проверьте его формат.',
      };
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return {
        statusCode: 400, code: 'bad_request_body',
        message: 'Запрос передан в неверном формате.',
        hint: 'Обновите страницу (F5) и повторите действие.',
      };
    case 'FST_ERR_BAD_REQUEST':
      return {
        statusCode: 400, code: 'bad_request',
        message: 'Запрос передан в неверном формате.',
        hint: 'Обновите страницу (F5) и повторите действие.',
      };
    case 'FST_ERR_VALIDATION':
      return {
        statusCode: 400, code: 'validation_failed',
        message: 'Не все поля заполнены верно.',
        hint: 'Проверьте выделенные поля и повторите.',
      };
    case 'FST_ERR_NOT_FOUND':
      return {
        statusCode: 404, code: 'not_found',
        message: 'Запрашиваемый раздел не найден.',
        hint: 'Обновите страницу — возможно, ссылка устарела.',
      };
    case 'HPE_HEADER_OVERFLOW':
      return {
        statusCode: 431, code: 'headers_too_large',
        message: 'Слишком большой размер заголовков запроса.',
        hint: 'Обновите страницу (F5) и повторите действие. Если ошибка повторяется — сообщите администратору.',
      };
    case 'ERR_HTTP_REQUEST_TIMEOUT':
      return {
        statusCode: 408, code: 'request_timeout',
        message: 'Время ожидания запроса истекло.',
        hint: 'Проверьте соединение и повторите действие.',
      };
    default: break;
  }

  // Ошибки HTTP-парсера (битый метод/URL) приходят без кода Fastify — их
  // ловим по тексту и даём предметный совет.
  if (/Client Error|HTTP Version Not Supported|Invalid Preflight/i.test(String(err && err.message || ''))) {
    return {
      statusCode: 400, code: 'bad_request',
      message: 'Запрос передан в неверном формате.',
      hint: 'Обновите страницу (F5) и повторите действие. Если ошибка повторяется — сообщите администратору.',
    };
  }

  // ── Ошибки PostgreSQL ────────────────────────────────────────────────
  const pg = err && (err.code || err.pgCode);
  switch (pg) {
    case '23505': // unique_violation
      return {
        statusCode: 409, code: 'duplicate_record',
        message: 'Такая запись уже существует — повторное создание не требуется.',
        hint: 'Обновите страницу: возможно, запись уже создана ранее. Если это не так — сообщите администратору.',
      };
    case '23503': // foreign_key_violation
      return {
        statusCode: 409, code: 'related_missing',
        message: 'Одна из связанных записей не найдена (например, сотрудник или объект удалён).',
        hint: 'Обновите страницу и выберите запись заново. Если повторяется — сообщите администратору.',
      };
    case '23502': // not_null_violation
      return {
        statusCode: 400, code: 'required_field_missing',
        message: 'Не заполнены обязательные данные.',
        hint: 'Проверьте форму: заполните все обязательные поля (отмечены *) и повторите.',
      };
    case '23514': // check_violation
    case '22P02': // invalid_text_representation
      return {
        statusCode: 400, code: 'invalid_value',
        message: 'Одно из значений введено в недопустимом виде.',
        hint: 'Проверьте суммы и даты: только числа (например 15000 или 15000.50), даты — в формате календаря. Затем повторите.',
      };
    case '40001': case '40P01': // serialization/deadlock
      return {
        statusCode: 409, code: 'conflict_retry',
        message: 'Запись одновременно изменил другой пользователь.',
        hint: 'Обновите страницу и повторите действие — данные уже актуальны.',
      };
    case '42P01': case '42703': case '42883': // нет таблицы/колонки/функции
      return {
        statusCode: 503, code: 'schema_unavailable',
        message: 'Раздел временно недоступен: идёт обновление данных.',
        hint: 'Повторите попытку через пару минут. Если не помогает — сообщите администратору.',
      };
    case '57014': case 'ETIMEDOUT': // запрос отменён / таймаут
      return {
        statusCode: 504, code: 'timeout',
        message: 'Сервер не успел обработать запрос за отведённое время.',
        hint: 'Повторите попытку. Если данных много — сузьте период.',
      };
    default: break;
  }

  // ── Сетевые ошибки (БД/внешний сервис недоступен) ─────────────────────
  const net = err && (err.code || '');
  if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'EPIPE'].includes(net)) {
    return {
      statusCode: 503, code: 'service_unavailable',
      message: 'Сервис данных временно недоступен.',
      hint: 'Подождите немного и повторите действие. Деньги при этом не списываются.',
    };
  }

  // ── Fastify: кривое тело запроса ─────────────────────────────────────
  if (net === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || net === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
    return {
      statusCode: 400, code: 'bad_request_body',
      message: 'Запрос передан в неверном формате.',
      hint: 'Обновите страницу (F5) и повторите действие.',
    };
  }
  if (net === 'FST_ERR_VALIDATION' && Array.isArray(err.validation)) {
    return {
      statusCode: 400, code: 'validation_failed',
      message: 'Не все поля заполнены верно.',
      hint: 'Проверьте выделенные поля и повторите.',
    };
  }

  // ── Прочее (непредвиденное) ──────────────────────────────────────────
  const sc = (err && err.statusCode) || 500;
  if (sc < 500) {
    return {
      statusCode: sc, code: 'bad_request',
      message: (err && err.message) ? String(err.message) : 'Не удалось выполнить действие.',
      hint: statusHint(sc),
    };
  }
  return {
    statusCode: 500,
    code: 'server_error',
    message: 'Не удалось выполнить операцию из-за внутренней ошибки.',
    hint: 'Данные не изменены — повторите попытку. Если ошибка повторяется, сообщите администратору и укажите номер запроса из журнала.',
  };
}

/**
 * Готовит объект ответа. `action` — что именно не произошло (контекст),
 * добавляется к «что делать», чтобы совет был предметным.
 */
function humanError(err, opts = {}) {
  const d = describeError(err);
  const action = (opts && opts.action) ? String(opts.action) : '';
  return {
    statusCode: d.statusCode,
    error: d.code,
    message: d.message,
    hint: action ? (action + ' ' + d.hint) : d.hint,
  };
}

/** Отправить человеческую ошибку из fastify-ручки. Возвращает reply (для `return`). */
function sendHuman(reply, err, opts = {}) {
  const h = humanError(err, opts);
  return reply.code(h.statusCode).send({ error: h.error, message: h.message, hint: h.hint, statusCode: h.statusCode });
}

// ── Известные машинные коды → что случилось и что делать ──────────────────
// Используется хуком onSend (src/index.js): если ручка вернула код без
// человеческого message/hint — подставляем отсюда. Одна точка на все ручки.
const CODE_HINTS = {
  approval_required: {
    message: 'Выплата не согласована директором.',
    hint: 'Соберите список выплат на странице «Выплаты» и отправьте его директору на согласование.',
  },
  amount_exceeds_approved: {
    message: 'Сумма превышает согласованную директором.',
    hint: 'Уменьшите сумму выплаты или согласуйте новую сумму у директора.',
  },
  no_period_data: {
    message: 'За этот период нет начислений и нет согласованного списка.',
    hint: 'Проверьте период или согласуйте выплату с директором.',
  },
  period_change_blocked: {
    message: 'Выплата участвует в согласовании за этот период — перенести её нельзя.',
    hint: 'Согласуйте выплату на новую дату и проведите её заново.',
  },
  reason_required: {
    message: 'Не указана причина.',
    hint: 'Заполните поле причины — она попадёт в табель, ведомость и архив.',
  },
  self_approval_forbidden: {
    message: 'Нельзя согласовать список, который вы создали сами.',
    hint: 'Попросите другого директора согласовать этот список.',
  },
  payout_requires_approval: {
    message: 'Прямая правка выплат запрещена.',
    hint: 'Проведите выплату через страницу «Выплаты» — там она пройдёт согласование.',
  },
  approval_check_unavailable: {
    message: 'Не удалось проверить согласование выплаты (временный сбой).',
    hint: 'Повторите попытку через минуту. Деньги при этом не списываются.',
  },
  duplicate_payment: {
    message: 'Похоже на повторную выплату.',
    hint: 'Если это действительно новая выплата — подтвердите повтор.',
  },
  salary_already_paid_in_period: {
    message: 'За этот период зарплата уже выплачивалась.',
    hint: 'Подтвердите повторную выплату, если она действительно нужна.',
  },
  salary_already_paid: {
    message: 'За этот период зарплата уже выплачивалась.',
    hint: 'Проверьте ведомость: возможно, выплата уже проведена.',
  },
  period_closed: {
    message: 'Период закрыт для изменений.',
    hint: 'Обратитесь к директору или бухгалтерию, чтобы открыть период.',
  },
  insufficient_funds: {
    message: 'Недостаточно средств.',
    hint: 'Пополните кассу или выберите другой способ выплаты.',
  },
  no_access: {
    message: 'Недостаточно прав для этого действия.',
    hint: 'Обратитесь к администратору, чтобы получить доступ.',
  },
  forbidden: {
    message: 'Недостаточно прав для этого действия.',
    hint: 'Обратитесь к администратору, чтобы получить доступ.',
  },
};

/** Подсказка по HTTP-статусу, когда конкретный код неизвестен. */
function statusHint(status) {
  if (status === 400) return 'Проверьте заполненные поля и повторите действие.';
  if (status === 401) return 'Войдите в систему заново.';
  if (status === 403) return 'Обратитесь к администратору, чтобы получить доступ.';
  if (status === 404) return 'Обновите страницу — возможно, запись уже удалена или перемещена.';
  if (status === 409) return 'Обновите страницу: данные уже изменились. Затем повторите действие.';
  if (status === 413) return 'Файл слишком большой — выберите файл меньшего размера.';
  if (status === 422) return 'Проверьте данные и повторите действие.';
  if (status === 429) return 'Слишком много запросов — подождите минуту и повторите.';
  if (status >= 500) return 'Данные не изменены — повторите попытку. Если ошибка повторяется, сообщите администратору.';
  return 'Повторите действие.';
}

/**
 * Текст, который НЕ должен видеть пользователь: имена таблиц/колонок SQL,
 * английские сообщения парсера/валидации, упоминания стека.
 */
const TECH_RE = /(not present in table|violates (not-null|unique|check|foreign key)|invalid input syntax|relation |column .* of relation|Key \(|syntax error|undefined|node_modules|at Object|INSERT INTO|UPDATE .* SET|SELECT .* FROM|Unsupported Media Type|is not a valid url|Bad Request|Invalid (id|user|chat|token)|Bad ID|Not a (chat )?member|\bTypeError\b|\bReferenceError\b)/i;
function looksTechnical(msg) {
  if (!msg) return true;
  const s = String(msg);
  // Машинный код вида approval_required.
  if (/^[a-z][a-z0-9_]*$/.test(s) && s.length > 3) return true;
  if (TECH_RE.test(s)) return true;
  // ⚠️ Английский текст без кириллицы — технотекст. Любое пользовательское
  // сообщение у нас на русском, поэтому кириллица — надёжный признак
  // «человеческого» текста. Раньше требовалось латинское слово ≥4 букв, из-за
  // чего проходили короткие служебные тексты: `bad run id`, `Bad pm id`,
  // `dir: in|out` (найдено верификатором 16.10.2026). Теперь: нет кириллицы
  // и есть хотя бы 2 латинские буквы → технический.
  if (!/[А-Яа-яЁё]/.test(s) && /[A-Za-z]{2,}/.test(s)) return true;
  return false;
}

/**
 * Гарантирует, что в теле ошибки есть понятные message и hint.
 * Возвращает новое тело (объект) — вызывающий сам решает, сериализовать ли.
 * Используется хуком onSend: одна точка на ВСЕ ручки.
 *
 * D-313: если `error` — одиночное латинское слово (машинный код вроде
 * `unauthorized`), клиент показывал его пользователю как текст ошибки
 * (на экране PIN вместо сообщения вылезало «unauthorized»).Теперь для такого
 * поля всегда подставляется русский `message`; при наличии известного кода
 * (`body.code`) он остаётся в `code`, а не в пользовательском тексте.
 */
function ensureHumanFields(body, statusCode) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const errStr = typeof body.error === 'string' ? body.error : '';
  const isMachine = !!errStr && /^[a-z][a-z0-9_]*$/.test(errStr);
  const known = CODE_HINTS[errStr] || null;
  let changed = false;

  // Русский текст для машинного кода: клиент показывает `error`, поэтому
  // именно он (и `message`) должен быть читаемым.
  const HUMAN_BY_CODE = {
    unauthorized: 'Требуется авторизация',
    forbidden: 'Доступ запрещён',
    not_found: 'Запись не найдена',
    bad_request: 'Некорректный запрос',
    validation_failed: 'Проверьте заполненные поля',
    rate_limited: 'Слишком много попыток — подождите немного',
    server_error: 'Не удалось выполнить операцию',
    unsupported_media_type: 'Неподдерживаемый формат файла',
    conflict: 'Данные уже изменены — обновите страницу',
  };
  if (isMachine) {
    const human = HUMAN_BY_CODE[errStr];
    if (human) {
      // Код сохраняем отдельно, пользователю — русский текст.
      if (body.code === undefined) body.code = errStr;
      if (typeof body.message !== 'string' || looksTechnical(body.message)) body.message = human;
      // `error` тоже делаем читаемым: клиенты берут именно его.
      body.error = human;
      changed = true;
    }
  }

  // ── message: должен быть человеческим ─────────────────────────────────
  const cur = typeof body.message === 'string' ? body.message : '';
  const curErr = typeof body.error === 'string' ? body.error : '';
  if (!cur) {
    if (known) { body.message = known.message; changed = true; }
    else if (curErr && !isMachine && !looksTechnical(curErr)) { body.message = curErr; changed = true; }
    else { body.message = statusCode >= 500 ? 'Не удалось выполнить операцию из-за внутренней ошибки.' : 'Не удалось выполнить действие.'; changed = true; }
  } else if (looksTechnical(cur)) {
    // Технотекст (PG/англ.) → человеческая замена.
    if (known) body.message = known.message;
    else body.message = statusCode >= 500 ? 'Не удалось выполнить операцию из-за внутренней ошибки.' : 'Не удалось выполнить действие.';
    changed = true;
  }

  // ── error: не оставляем англ./технотекст наружу ────────────────────────
  // D-313: машинные коды (`unauthorized`) уже заменены выше на русский текст.
  // Здесь добиваем оставшийся англо-технотекст (PG-ошибки, `Bad Request`).
  if (typeof body.error === 'string' && body.error && looksTechnical(body.error)) {
    const std = {
      'Bad Request': 'bad_request', 'Forbidden': 'forbidden', 'Unauthorized': 'unauthorized',
      'Not Found': 'not_found', 'Conflict': 'conflict', 'Too Many Requests': 'rate_limited',
      'Unsupported Media Type': 'unsupported_media_type', 'Precondition Failed': 'precondition_failed',
      'Not Acceptable': 'not_acceptable', 'Gone': 'gone', 'Internal Server Error': 'server_error',
    }[body.error];
    body.error = std || (statusCode >= 500 ? 'server_error' : 'bad_request');
    changed = true;
  }

  // ── hint: обязателен ──────────────────────────────────────────────────
  if (!body.hint) {
    body.hint = known ? known.hint : statusHint(statusCode);
    changed = true;
  }

  // ── Внутренние технические поля наружу не отдаём ───────────────────────
  // `detail` (сырой текст PostgreSQL) и `code` PG раскрывают структуру БД —
  // пользователю они не нужны, и это утечка (найдено верификатором 16.10.2026).
  if (body.detail !== undefined) { delete body.detail; changed = true; }
  if (body.sqlState !== undefined) { delete body.sqlState; changed = true; }

  return changed ? body : null;
}

module.exports = { describeError, humanError, sendHuman, ensureHumanFields, looksTechnical, CODE_HINTS };
