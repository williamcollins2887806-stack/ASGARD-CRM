'use strict';

/**
 * Назначение документа в тендере и отсев мусора перед промптом.
 * ═══════════════════════════════════════════════════════════════════════════
 * ЗАЧЕМ (замечание РП 06.11.2026):
 * В тендер грузятся десятки файлов из архивов. В промпт Мимира уходили
 * договоры на 200 страниц, наши же ТКП, шаблоны и по 5 копий одного ТЗ.
 * Модель получала ~1,3 млн символов, 60–70 % из которых не несли объёмов.
 *
 * ЧТО ДЕЛАЕМ:
 *   1. Определяем назначение каждого файла: ВОР, ТЗ, смета, договор,
 *      наше ТКП, шаблон, счёт, акт, прочее.
 *   2. Помечаем «полезность» для разбора объёмов: объёмы и ТЗ нужны,
 *      договор и ТКП — нет.
 *   3. Схлопываем копии: одинаковый нормализованный текст = один документ.
 *
 * Определение ИМЕНИ работает без ИИ и бесплатно, покрывает почти всё:
 * имена файлов в тендерах говорящие («ТЗ на чистку…», «ВОР.xlsx»).
 * Текстовая эвристика — второй эшелон по первым строкам.
 * ИИ подключается только для неясных имён (role='unknown') — это
 * отдельная задача и здесь не обязательна.
 */

const crypto = require('crypto');

// Роли, которые дают объёмы и условия работ.
// weight — доля бюджета промпта относительно остальных.
const ROLES = {
  vor:      { title: 'Ведомость объёмов', weight: 5, use: true },
  tz:       { title: 'Техническое задание', weight: 4, use: true },
  estimate: { title: 'Смета / расчёт', weight: 3, use: true },
  spec:     { title: 'Спецификация / перечень', weight: 3, use: true },
  act:      { title: 'Акт / дефектная ведомость', weight: 4, use: true },
  contract: { title: 'Договор / контракт', weight: 0, use: false },
  tkp:      { title: 'Наше ТКП / КП', weight: 0, use: false },
  template: { title: 'Шаблон / форма', weight: 0, use: false },
  invoice:  { title: 'Счёт / платёжный документ', weight: 0, use: false },
  letter:   { title: 'Письмо / переписка', weight: 0, use: false },
  cert:     { title: 'Сертификат / свидетельство', weight: 0, use: false },
  // Нормативная документация заказчика: ПВД, СТО, инструкции, положения,
  // правила безопасности, требования к пропускам. В этих документах
  // НЕ БЫВАЕТ объёмов работ — только порядок допуска и оформления.
  // Тендер 2158 (Апатит): 7 таких файлов на 800 тыс. символов, все уходили
  // в промпт под видом «Приложение №N» и вытесняли настоящее ТЗ.
  regdoc:   { title: 'Нормативный документ заказчика', weight: 0, use: false },
  other:    { title: 'Прочее', weight: 1, use: false },
  unknown:  { title: 'Не определено', weight: 1, use: true }
};

// ── Определение по имени файла ──────────────────────────────────────────────
// Порядок важен: «Акт дефектовки» — это акт с объёмами, а не «акт приёмки».
const NAME_RULES = [
  // ВОР и ведомости объёмов.
  [/(^|[^а-яё])(вор|в\.о\.р)([^а-яё]|$)/i, 'vor'],
  [/(ведомост[ья].*(объ[её]м|работ)|объ[её]м.*работ|перечень\s+работ)/i, 'vor'],
  // Дефектная ведомость — тоже источник объёмов.
  [/дефектн/i, 'act'],
  // ТЗ.
  [/(^|[^а-яё])(тз|т\.з\.)([^а-яё]|$)/i, 'tz'],
  [/техническ\S*\s+задани/i, 'tz'],
  [/техзадани/i, 'tz'],
  // Шаблоны и формы — ВЫШЕ сметы: «Шаблон сметы.xlsx» это не смета,
  // а пустой бланк, объёмов в нём нет.
  [/шаблон/i, 'template'],
  [/(^|[^а-яё])форм[аы]([^а-яё]|$)/i, 'template'],
  [/опросн/i, 'template'],
  // Смета.
  [/(^|[^а-яё])(смета|сметы|лср|кс-2|кс-3)([^а-яё]|$)/i, 'estimate'],
  [/локальн\S*\s+смет/i, 'estimate'],
  [/расч[её]т\S*\s+(стоимост|цены)/i, 'estimate'],
  // Спецификация.
  [/спецификаци/i, 'spec'],
  [/перечень/i, 'spec'],
  [/описи?\s+оборудован/i, 'spec'],
  // Договоры — в промпт не идут.
  [/договор/i, 'contract'],
  [/контракт/i, 'contract'],
  [/соглашени/i, 'contract'],
  // Нормативная документация заказчика — объёмов там не бывает.
  // Проверяем ДО «Приложение N»: у Апатита все СТО и ПВД идут приложениями.
  [/(^|[^а-яё])(пвд|сто|стп|фнп)([^а-яё]|$)/i, 'regdoc'],
  [/стандарт\S*\s+организац/i, 'regdoc'],
  [/положени[ея]\s/i, 'regdoc'],
  [/инструкци[яию]/i, 'regdoc'],
  [/правил[ао]\s+(безопасн|дорожн|охраны|пропускн|внутренн)/i, 'regdoc'],
  [/требовани[яй]\s+в\s+област[иь]/i, 'regdoc'],
  [/пропускн\S*\s+режим/i, 'regdoc'],
  [/охраны\s+труда/i, 'regdoc'],
  [/политик[аи]\s+(в\s+област|качества)/i, 'regdoc'],
  // Бланки допуска и пропусков: «Оформление разового пропуска»,
  // «Согласование транспортного пропуска». У Апатита их десятки на тендер,
  // объёмов работ в них нет — только порядок оформления.
  [/пропуск/i, 'regdoc'],
  [/оформлени[ея]\s+(разов|транспортн|материальн|инструментальн|временн)/i, 'regdoc'],
  [/согласовани[ея]\s+.*(допуск|пропуск|работ)/i, 'regdoc'],
  [/наряд[-\s]?допуск/i, 'regdoc'],
  [/(^|[^а-яё])лко([^а-яё]|$)/i, 'regdoc'],
  [/форма\s+по\s+лко/i, 'regdoc'],
  // Наши ТКП и предложения.
  [/(^|[^а-яё])(ткп|кп)([^а-яё]|$)/i, 'tkp'],
  [/коммерческ\S*\s+предложен/i, 'tkp'],
  // Шаблоны и формы.
  // Платёжные.
  [/сч[её]т/i, 'invoice'],
  [/акт\s+(при[её]мк|выполненн|оказанн)/i, 'act'],
  // Прочее.
  [/письмо/i, 'letter'],
  [/презентац/i, 'letter'],
  [/опис[ьи]\s+документ/i, 'template'],
  [/сертификат|свидетельств/i, 'cert']
];

// ── Определение по тексту (первые строки) ───────────────────────────────────
const TEXT_RULES = [
  [/дефектн\S*\s+ведомост/i, 'act'],
  [/ведомост\S*\s+(объ[её]мов|потребност)/i, 'vor'],
  [/техническ\S*\s+задани/i, 'tz'],
  [/^\s*(договор|контракт)\b/im, 'contract'],
  [/локальн\S*\s+смет/i, 'estimate'],
  [/коммерческ\S*\s+предложен/i, 'tkp'],
  // Нормативные документы узнаём по шапке: «ПОЛОЖЕНИЕ О…», «СТАНДАРТ
  // ОРГАНИЗАЦИИ», «ИНСТРУКЦИЯ ПО…». У них крупный заголовок в начале.
  [/(положение\s+(о|об)\s|стандарт\s+организац|инструкция\s+(по|о)\s|правила\s+(по\s+)?(охраны|безопасн|дорожн))/i, 'regdoc'],
  [/(краткое\s+изложение\s+требований|порядок\s+управления\s+организационно)/i, 'regdoc'],
  // Бланки пропусков: имя файла часто обезличено («extracted_7336e2.docx»),
  // а назначение видно в первой строке.
  [/^\s*оформлени[ея]\s+(разов|транспортн|материальн|инструментальн|временн)/i, 'regdoc'],
  [/^\s*согласовани[ея]\s+.*(пропуск|допуск)/i, 'regdoc'],
  [/^\s*форма\s+по\s+лко/i, 'regdoc'],
  [/^\s*наряд[-\s]?допуск/i, 'regdoc']
];

function headOf(text, lines = 12) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 2).slice(0, lines).join('\n');
}

/**
 * Назначение документа по имени, затем по тексту.
 * @param {{name?:string, text?:string}} doc
 * @returns {{role:string, title:string, use:boolean, weight:number, source:string}}
 */
function detectRole(doc) {
  const o = doc || {};
  const name = String(o.name || o.original_name || '');
  const text = String(o.text || o.ocr_text || '');

  for (const [re, role] of NAME_RULES) {
    if (re.test(name)) return describe(role, 'name');
  }
  const head = headOf(text);
  for (const [re, role] of TEXT_RULES) {
    if (re.test(head)) return describe(role, 'text');
  }
  // Без имени и без признаков — не выбрасываем: может быть ВОР без названия.
  return describe('unknown', 'none');
}

function describe(role, source) {
  const r = ROLES[role] || ROLES.unknown;
  return { role, title: r.title, use: r.use, weight: r.weight, source };
}

/**
 * Отпечаток содержимого для схлопывания копий.
 * Нормализуем: убираем пробелы, регистр, служебные символы.
 * Один и тот же документ из разных архивов даёт один и тот же хеш.
 */
function contentHash(text) {
  const t = normalizeForHash(text);
  if (t.length < 40) return null;   // слишком коротко — не рискуем схлопывать
  return crypto.createHash('sha1').update(t).digest('hex');
}

/** Нормализация под сравнение: без пробелов, регистра и пунктуации. */
function normalizeForHash(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[«»"'`.,;:!?()[\]{}\-–—/\\|]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Похожесть нормализованных текстов, 0..1.
 * Нужна потому, что копии одного PDF распознаются по-разному: OCR путает
 * «3» и «З», теряет пробелы. Хеш у них разный, а документ — один.
 * Тендер 2138: 6 копий «Техническое задание.pdf» дали 6 разных хешей.
 */
function similarity(a, b) {
  const A = normalizeForHash(a);
  const B = normalizeForHash(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const shortLen = Math.min(A.length, B.length);
  const longLen = Math.max(A.length, B.length);
  if (shortLen < 40) return 0;
  // Разная длина больше чем на четверть — это разные документы.
  if (shortLen / longLen < 0.75) return 0;

  // Сравниваем начало (первые 2000 знаков достаточно для отпечатка).
  const a2 = A.slice(0, 2000);
  const b2 = B.slice(0, 2000);
  const grams = new Set();
  for (let i = 0; i + 3 <= a2.length; i += 1) grams.add(a2.slice(i, i + 3));
  if (!grams.size) return 0;
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 3 <= b2.length; i += 1) {
    total += 1;
    if (grams.has(b2.slice(i, i + 3))) hit += 1;
  }
  return total ? hit / total : 0;
}

/**
 * Отбор документов для промпта: назначение + схлопывание копий.
 *
 * @param {Array} documents — [{original_name, text}]
 * @param {{includeUnknown?:boolean}} [opts]
 * @returns {{selected:Array, dropped:Array, duplicates:Array, stats:object}}
 */
function selectForPrompt(documents, opts) {
  const o = opts || {};
  const includeUnknown = o.includeUnknown !== false;
  const list = Array.isArray(documents) ? documents : [];

  const dropped = [];
  const duplicates = [];
  const kept = [];
  const seen = new Map();   // hash → первый документ

  for (const d of list) {
    const name = d.original_name || d.filename || d.name || 'документ';
    const text = String(d.text || d.ocr_text || d.content || '').trim();
    if (!text) {
      dropped.push({ name, role: 'empty', reason: 'нет текста' });
      continue;
    }

    const role = detectRole({ name, text });
    const useful = role.use || (role.role === 'unknown' && includeUnknown);

    const hash = contentHash(text);
    if (hash && seen.has(hash)) {
      const first = seen.get(hash);
      duplicates.push({ name, copy_of: first.name, chars: text.length, match: 'точное' });
      continue;
    }

    // Копия уже отобранного документа — не тратим бюджет.
    // Сначала точный хеш, затем нечёткое сравнение: копии одного PDF
    // распознаются по-разному, хеш у них разный, а документ один.
    //
    // ПОРОГ 0.97 (было 0.9). Два РАЗНЫХ документа с общими юридическими
    // формулировками («Договор поставки…», «Настоящий договор…») давали
    // похожесть выше 0.9 и схлопывались как копия. В результате ВОР или
    // дефектная ведомость отбрасывались, и модель разбирала пустоту.
    // Копия одного файла отличается от оригинала на единицы процентов,
    // поэтому 0.97 разделяет «копия» и «похожий по стилю документ».
    //
    // Дополнительная защита: разные размеры текста при высокой похожести —
    // это всё-таки разные документы (копия не может быть вдвое короче).
    const twin = kept.find((k) => {
      if (similarity(k.text, text) < 0.97) return false;
      const a = k.text.length;
      const b = text.length;
      const smaller = Math.min(a, b);
      const bigger = Math.max(a, b);
      // Разница в размере больше 15 % — не копия, а другой документ.
      return bigger > 0 && smaller / bigger >= 0.85;
    });
    if (twin) {
      duplicates.push({ name, copy_of: twin.original_name, chars: text.length, match: 'распознано иначе' });
      continue;
    }

    if (!useful) {
      dropped.push({ name, role: role.role, title: role.title, reason: 'не нужен для объёмов', chars: text.length });
      continue;
    }

    if (hash) seen.set(hash, { name });
    kept.push({
      original_name: name,
      text,
      doc_role: role.role,
      doc_role_title: role.title,
      doc_weight: role.weight,
      doc_role_source: role.source
    });
  }

  // Внутри одной роли — от большего к меньшему: содержательный документ
  // получит место раньше короткой выписки.
  kept.sort((a, b) => (b.doc_weight - a.doc_weight) || (b.text.length - a.text.length));

  const stats = {
    total: list.length,
    selected: kept.length,
    dropped: dropped.length,
    duplicates: duplicates.length,
    chars_before: list.reduce((s, d) => s + String(d.text || d.ocr_text || d.content || '').length, 0),
    chars_after: kept.reduce((s, d) => s + d.text.length, 0)
  };
  stats.saved_pct = stats.chars_before > 0
    ? Math.round((1 - stats.chars_after / stats.chars_before) * 100)
    : 0;

  return { selected: kept, dropped, duplicates, stats };
}

/**
 * Что реально ушло в промпт — для журнала и разбора.
 * Пишется в лог анализа, чтобы РП видел, а не догадывался.
 */
function describeSelection(sel) {
  const s = (sel && sel.stats) || {};
  const lines = [
    `документов: ${s.total}, в промпт: ${s.selected}, отсеяно: ${s.dropped}, копий схлопнуто: ${s.duplicates}`,
    `символов: ${Number(s.chars_before || 0).toLocaleString('ru')} → ${Number(s.chars_after || 0).toLocaleString('ru')} (−${s.saved_pct || 0} %)`
  ];
  const dropped = (sel && sel.dropped) || [];
  if (dropped.length) {
    lines.push('отсеяно: ' + dropped.slice(0, 8).map((d) => `${String(d.name).slice(0, 30)} (${d.title || d.role})`).join('; '));
  }
  return lines.join('\n');
}

module.exports = {
  ROLES,
  detectRole,
  contentHash,
  similarity,
  selectForPrompt,
  describeSelection
};
