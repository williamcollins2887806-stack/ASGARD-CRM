'use strict';

/**
 * ASGARD — Voice Agent Helpers
 * Общие функции для audiosocket-server.js и тестов.
 * Вынесены для переиспользования без запуска TCP-сервера.
 */

/* ══════════════════════════════════════════════════════
   CACHED INTENTS — кэшированные фразы с вариациями
   Мгновенный ответ без LLM для типовых запросов
   ══════════════════════════════════════════════════════ */

const CACHED_INTENTS = {
  greetings: {
    standard: [
      'Здравствуйте! Компания Асгард Сервис, меня зовут Фрейя. Чем могу помочь?',
      'Добрый день! Асгард Сервис, Фрейя на связи. Слушаю вас!',
      'Здравствуйте! Асгард Сервис. Подскажите, чем могу быть полезна?',
      'Добрый день! Компания Асгард Сервис. Рада вас слышать, чем помочь?',
    ],
    known_client: [
      'Здравствуйте, {name}! Рада снова слышать вас. Чем могу помочь?',
      'Добрый день, {name}! Как ваши дела? Слушаю вас.',
      '{name}, здравствуйте! На связи Фрейя. Чем могу помочь?',
    ],
    after_hours: [
      'Добрый вечер! Компания Асгард Сервис. Сейчас нерабочее время, но я могу записать ваш вопрос и передать специалистам. Они перезвонят в рабочие часы.',
      'Здравствуйте! Асгард Сервис. К сожалению, наши специалисты сейчас недоступны. Оставьте сообщение, и мы обязательно перезвоним.',
      'Добрый вечер! Сейчас офис закрыт, но я запишу ваше обращение. Наши специалисты свяжутся с вами в ближайший рабочий день.',
    ],
  },
  route_tender: [
    'Соединяю вас с тендерным отделом, с Хосе Александром. Одну секунду.',
    'Сейчас переведу на тендерный отдел. Хосе Александр вам поможет.',
    'Переключаю на Хосе Александра, он у нас отвечает за тендеры. Минуточку!',
  ],
  route_accounting: [
    'Соединяю вас с бухгалтерией. Одну минуту.',
    'Сейчас переведу на бухгалтерию, подождите секундочку.',
    'Переключаю на бухгалтерию. Не кладите трубку.',
  ],
  route_procurement: [
    'Соединяю с отделом закупок. Секундочку.',
    'Переключаю вас на отдел снабжения. Одну минуту.',
  ],
  refuse_director: [
    'К сожалению, руководство не принимает звонки напрямую. Но я обязательно передам вашу информацию. Подскажите, по какому вопросу вы звоните?',
    'Прямое соединение с руководством не предусмотрено, но я помогу разобраться с вашим вопросом. Расскажите подробнее?',
    'Руководство сейчас недоступно для звонков. Давайте я запишу ваш вопрос и передам, или может быть я смогу помочь?',
  ],
  silence_first: [
    'Алло? Слушаю вас!',
    'Алло, вы на связи?',
    'Алло? Я вас слушаю.',
  ],
  silence_second: [
    'Простите, не расслышала. Подскажите, чем могу помочь?',
    'Извините, плохо слышно. Повторите, пожалуйста?',
    'Не могу вас расслышать. Скажите ещё раз, пожалуйста.',
  ],
  silence_hangup: [
    'К сожалению, не слышу вас. Перезвоните, пожалуйста, когда будет удобно. До свидания!',
    'Видимо, связь прервалась. Перезвоните нам по номеру четыре девять девять, три два два, тридцать, шестьдесят два. До свидания!',
  ],
  spam: [
    'Спасибо, нам это не требуется. Всего доброго!',
    'Благодарю за предложение, но мы не заинтересованы. До свидания!',
    'Спасибо, не актуально. Хорошего дня!',
  ],
  route_specialist: [
    'Секундочку, соединю вас со специалистом.',
    'Одну минуту, переключаю на специалиста, который поможет.',
    'Сейчас переведу вас на нужного специалиста. Не кладите трубку.',
  ],
  record_message: [
    'Оставьте, пожалуйста, ваше имя, номер телефона и коротко суть вопроса. Мы перезвоним.',
    'Запишу ваше обращение. Назовите имя, контактный телефон и по какому вопросу звоните.',
  ],
  goodbye: [
    'Рада была помочь! Обращайтесь, если будут вопросы. До свидания!',
    'Всего доброго! Будем рады видеть вас среди наших клиентов.',
    'Спасибо за звонок! Хорошего дня!',
    'До свидания! Если что — звоните, мы всегда на связи.',
  ],
  confirm_tender: [
    'Соединяю с Хосе Александром из тендерного отдела, верно?',
    'Переключить на тендерный отдел, к Хосе Александру?',
  ],
  confirm_accounting: [
    'Переключить на бухгалтерию?',
    'Соединить с бухгалтерией, верно?',
  ],
  confirm_procurement: [
    'Переключить на отдел закупок?',
    'Соединить с отделом снабжения?',
  ],
};

/* ── Хелперы ── */

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fillTemplate(text, vars) {
  let result = text;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), val || '');
  }
  return result;
}

/* ══════════════════════════════════════════════════════
   INTENT DETECTION — быстрое определение без LLM
   ══════════════════════════════════════════════════════ */

function detectIntentByKeywords(text, context, pendingRoute) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // ── Подтверждение ожидающего перевода ──
  if (pendingRoute) {
    if (/да|верно|соединяй|переключай|конечно|давай|ага|угу|точно/i.test(lower)) {
      return {
        intent: pendingRoute.intent,
        response: pickRandom(CACHED_INTENTS['route_' + pendingRoute.department] || CACHED_INTENTS.route_specialist),
        action: 'route',
        route_to: pendingRoute.route_to,
        route_name: pendingRoute.route_name,
      };
    }
    if (/нет|не надо|не нужно|отмен|другой|другое/i.test(lower)) {
      return {
        intent: 'cancel_route',
        response: 'Хорошо, не переключаю. Чем ещё могу помочь?',
        action: 'continue',
        route_to: null,
        route_name: null,
      };
    }
    return null;
  }

  // ── ДИРЕКТОРА — отказ (только для внешних) ──
  if (!context.isInternal && /директор|руководител|руководств|генеральн|коммерческ|кудряшов|гажилиев|сторожев/i.test(lower)) {
    return {
      intent: 'refuse_director',
      response: pickRandom(CACHED_INTENTS.refuse_director),
      action: 'continue',
      route_to: null,
      route_name: null,
    };
  }

  // ── ТЕНДЕР / КОНКУРС — подтверждение ──
  if (/тендер|конкурс|аукцион|котировк|запрос.+предложен|торг/i.test(lower)) {
    const hose = (context.employees || []).find(e => /хосе|jose/i.test(e.name || e.display_name || ''));
    const phone = hose ? (hose.fallback_mobile || '').replace(/[^0-9]/g, '') : null;
    return {
      intent: 'tender',
      response: pickRandom(CACHED_INTENTS.confirm_tender),
      action: 'continue',
      route_to: null,
      route_name: null,
      _pendingRoute: { intent: 'tender', department: 'tender', route_to: phone, route_name: 'Хосе Александр' },
    };
  }

  // ── БУХГАЛТЕРИЯ — подтверждение ──
  if (/бухгалтер|бухгалтери|счёт|счет|акт.+сверк|налогов|ндс|платёж|оплат/i.test(lower)) {
    if (/предлага|услуг|аутсорс/i.test(lower)) return null;
    const buh = (context.employees || []).find(e => e.role === 'BUH' && e.fallback_mobile);
    const phone = buh ? buh.fallback_mobile.replace(/[^0-9]/g, '') : null;
    return {
      intent: 'accounting',
      response: pickRandom(CACHED_INTENTS.confirm_accounting),
      action: 'continue',
      route_to: null,
      route_name: null,
      _pendingRoute: { intent: 'accounting', department: 'accounting', route_to: phone, route_name: buh ? (buh.display_name || buh.name) : 'бухгалтерия' },
    };
  }

  // ── ЗАКУПКИ / СНАБЖЕНИЕ — подтверждение ──
  if (/закупк|снабжен|отдел.+закуп|поставщик/i.test(lower) && !/тендер/i.test(lower)) {
    const proc = (context.employees || []).find(e => e.role === 'PROC' && e.fallback_mobile);
    const phone = proc ? proc.fallback_mobile.replace(/[^0-9]/g, '') : null;
    return {
      intent: 'procurement',
      response: pickRandom(CACHED_INTENTS.confirm_procurement),
      action: 'continue',
      route_to: null,
      route_name: null,
      _pendingRoute: { intent: 'procurement', department: 'procurement', route_to: phone, route_name: proc ? (proc.display_name || proc.name) : 'отдел закупок' },
    };
  }

  // ── ЯВНЫЙ СПАМ ──
  if (/реклам|продвижен|seo|сео|кредит|лизинг|тренинг|вебинар|опрос|автоинформатор/i.test(lower)) {
    if (/очист|промыв|ремонт|теплообменник|котёл|котел|трубопровод/i.test(lower)) return null;
    return {
      intent: 'spam',
      response: pickRandom(CACHED_INTENTS.spam),
      action: 'hangup',
      route_to: null,
      route_name: null,
    };
  }

  // ── ПЕРЕВОД НА КОНКРЕТНОГО ЧЕЛОВЕКА ПО ИМЕНИ — сразу route ──
  if (/соедин|переведи|переключи|перевод|связ|позови|позвать/i.test(lower)) {
    for (const emp of (context.employees || [])) {
      const empName = (emp.display_name || emp.name || '').toLowerCase();
      const nameParts = empName.split(/\s+/);
      for (const part of nameParts) {
        if (part.length >= 3 && lower.includes(part)) {
          const phone = (emp.fallback_mobile || '').replace(/[^0-9]/g, '');
          if (phone && phone.length === 11) {
            return {
              intent: 'transfer_request',
              response: `Конечно, соединяю вас с ${emp.display_name || emp.name}. Одну секунду.`,
              action: 'route',
              route_to: phone,
              route_name: emp.display_name || emp.name,
            };
          }
        }
      }
    }
    return null;
  }

  // ── КАРЬЕРА / ВАКАНСИИ ──
  if (/вакансия|работа.+у.+вас|трудоустро|резюме|собеседован/i.test(lower)) {
    return {
      intent: 'career',
      response: 'Вакансии можно посмотреть на нашем сайте: асгард-сервис точка ком, раздел Карьера. Если хотите, я могу переключить на отдел кадров.',
      action: 'continue',
      route_to: null,
      route_name: null,
    };
  }

  return null;
}

/* ══════════════════════════════════════════════════════
   ПАРСЕР ОТВЕТА AI (text-first формат)
   ══════════════════════════════════════════════════════ */

function parseAIResponse(textPart, jsonPart) {
  const spokenText = (textPart || '').trim().slice(0, 300);

  // Пробуем парсить JSON-часть
  if (jsonPart && jsonPart.trim()) {
    let cleaned = jsonPart.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    try {
      const data = JSON.parse(cleaned);
      let routeTo = data.route_to || null;
      if (routeTo && typeof routeTo === 'string') {
        routeTo = routeTo.replace(/[^0-9]/g, '');
        if (routeTo.startsWith('8') && routeTo.length === 11) routeTo = '7' + routeTo.slice(1);
        if (routeTo.length !== 11) routeTo = null;
      }

      return {
        text: spokenText || String(data.text || '').slice(0, 300),
        action: ['route', 'record', 'hangup', 'continue'].includes(data.action) ? data.action : 'continue',
        route_to: routeTo,
        route_name: data.route_name || null,
        intent: data.intent || 'unknown',
        collected_data: data.collected_data || {},
        reason: data.reason || null
      };
    } catch (_) {
      // JSON parse failed
    }
  }

  // Fallback: может весь textPart — это старый JSON формат?
  if (!jsonPart && spokenText.startsWith('{')) {
    try {
      let cleaned = spokenText;
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      const data = JSON.parse(cleaned.trim());
      let routeTo = data.route_to || null;
      if (routeTo && typeof routeTo === 'string') {
        routeTo = routeTo.replace(/[^0-9]/g, '');
        if (routeTo.startsWith('8') && routeTo.length === 11) routeTo = '7' + routeTo.slice(1);
        if (routeTo.length !== 11) routeTo = null;
      }
      return {
        text: String(data.text || '').slice(0, 300),
        action: ['route', 'record', 'hangup', 'continue'].includes(data.action) ? data.action : 'continue',
        route_to: routeTo,
        route_name: data.route_name || null,
        intent: data.intent || 'unknown',
        collected_data: data.collected_data || {},
        reason: data.reason || null
      };
    } catch (_) {}
  }

  // Текст есть, JSON нет — считаем action=continue
  return {
    text: spokenText || '(нет ответа)',
    action: 'continue',
    route_to: null,
    route_name: null,
    intent: 'unknown',
    collected_data: {},
    reason: null
  };
}

module.exports = {
  CACHED_INTENTS,
  pickRandom,
  fillTemplate,
  detectIntentByKeywords,
  parseAIResponse,
};
