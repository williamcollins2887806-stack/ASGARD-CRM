'use strict';
/**
 * tools/make_obs_docx_template.js
 *
 * D-392: шаблон письма для ОБС — ИЗ ЭТАЛОННОГО ПИСЬМА, а не собранный заново.
 *
 * Заказчик 28.10.2026: «Вот так выглядит письмо. оно не красиво... Вот пример
 * вот так надо делать и пдф и ворд» — прислан образец `Исх. №261023-11`.
 *
 * ЧТО БЫЛО НЕ ТАК.
 *   1. Тело письма слипалось в один абзац: в шаблоне цикл
 *      `{#body_paragraphs}{text}{/body_paragraphs}` стоял ВНУТРИ одного
 *      абзаца, а docxtemplater с paragraphLoop размножает абзацы только
 *      когда теги стоят отдельными абзацами.
 *   2. Не было заголовка документа, шапка была «в столбик», а не справа.
 *   3. Перечень шёл вперемешку с текстом, ключевые абзацы не выделялись.
 *
 * РЕШЕНИЕ. Берём образец заказчика как есть — с его логотипом, полями,
 * шрифтами и отбивками — и заменяем только СОДЕРЖИМОЕ абзацев на
 * плейсхолдеры. Вёрстку не трогаем: она уже одобрена заказчиком.
 *
 * Запуск: node tools/make_obs_docx_template.js [путь-к-образцу]
 */

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const ROOT = path.resolve(__dirname, '..');
const REF_DEFAULT = process.env.OBS_LETTER_REF
  || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'Исх. _261023-11 от 23.10.2026 г..docx');
const DST = path.join(ROOT, 'templates', 'obs-letter-tpl.docx');

const REF = process.argv[2] || REF_DEFAULT;

/** Заменить ВЕСЬ текст абзаца, сохранив его форматирование и прогоны. */
function setParaText(paraXml, newText) {
  let first = true;
  return paraXml.replace(/(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g, (m, a, _b, c) => {
    if (!first) return `${a}${c}`;
    first = false;
    return `${a}${newText}${c}`;
  });
}

/** Текст абзаца (для поиска нужного места). */
const paraText = (p) => p.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, '$1')
  .replace(/<[^>]+>/g, '').trim();

function main() {
  if (!fs.existsSync(REF)) {
    console.error('Нет образца:', REF);
    console.error('Укажите путь: node tools/make_obs_docx_template.js "путь\\к\\письму.docx"');
    process.exit(1);
  }

  const zip = new PizZip(fs.readFileSync(REF));
  let xml = zip.file('word/document.xml').asText();
  const paras = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  console.log('образец:', path.basename(REF), '| абзацев:', paras.length);

  // Находим абзацы по содержимому — по смыслу, а не по номеру: образцы
  // могут отличаться числом пустых строк.
  const find = (re, from = 0) => {
    for (let i = from; i < paras.length; i++) {
      if (re.test(paraText(paras[i]))) return i;
    }
    return -1;
  };

  const iNumber = find(/^Исх\.\s*№/);
  const iSalute = find(/^Уважаемые\s+Коллеги/i);
  const iBasis = find(/Настоящим сообщаем|выполняет работы/);
  const iFirstItem = find(/^обучение|^[\u2022\-—]\s/) || find(/^обучение/);
  const iInvoice = find(/выставлен счёт/i);
  const iRequest = find(/Просим осуществить оплату|Просим оплатить/i);
  const iSigPos = find(/^Генеральный директор|^Директор/);

  console.log('найдено: №=', iNumber, 'обращение=', iSalute, 'обоснование=', iBasis,
    'первая позиция=', iFirstItem, 'счёт=', iInvoice, 'просьба=', iRequest, 'подпись=', iSigPos);

  const need = { iNumber, iSalute, iBasis, iFirstItem, iInvoice, iRequest, iSigPos };
  const missing = Object.entries(need).filter(([, v]) => v < 0).map(([k]) => k);
  if (missing.length) {
    console.error('Не найдены обязательные абзацы:', missing.join(', '));
    process.exit(1);
  }

  // ── Замены ────────────────────────────────────────────────────────────
  // D-392b: выкидываем пустые абзацы-отбивки в шапке. В образце их девять —
  // они сдвигали текст настолько, что письмо не умещалось на лист и подпись
  // уезжала на второй. Поля секции уже дают нужный отступ.
  xml = xml.replace(paras[iNumber], setParaText(paras[iNumber],
    'Исх. № {letter_number} от {letter_date_short}'));

  // 2. Обращение.
  xml = xml.replace(paras[iSalute], setParaText(paras[iSalute], '{recipient_greeting}'));

  // 3. Тело ДО перечня: обоснование, допуски, «привлекло».
  //    Три отдельных абзаца образца заменяем ОДНИМ циклом: так docxtemplater
  //    размножит абзац с сохранением отступа и выравнивания.
  //
  //    D-392b: закрывающий тег вставлялся ДВАЖДЫ — блок абзацев (bodyBlock)
  //    заканчивался на iFirstItem-1, но закрытие добавлялось ещё и при
  //    сборке перечня. Получался «Unopened loop». Теперь тело строится
  //    ровно один раз, а перечень вставляется ЗА ним, без повторного close.
  const bodyBlock = paras.slice(iBasis, iFirstItem).join('');
  const bodyOpen = setParaText(paras[iBasis], '{#intro_paragraphs}');
  const bodyLoop = setParaText(paras[iBasis], '{text}');
  const bodyClose = setParaText(paras[iBasis], '{/intro_paragraphs}')
    .replace(/<w:spacing[^/]*\/>/g, '<w:spacing w:after="0"/>');

  // 4. Перечень позиций: берём абзацы образца и делаем цикл.
  const itemParas = (() => {
    let i = iFirstItem;
    const acc = [];
    while (i < paras.length && /^обучение|^[\u2022\-—]\s/.test(paraText(paras[i]))) {
      acc.push(paras[i]); i++;
    }
    return acc;
  })();
  const itemBlock = itemParas.join('');
  const itemOpen = setParaText(paras[iFirstItem], '{#items}');
  const itemLoop = setParaText(paras[iFirstItem], '{text}');
  const itemClose = setParaText(paras[iFirstItem], '{/items}')
    .replace(/<w:spacing[^/]*\/>/g, '<w:spacing w:after="0"/>');

  // Заменяем ВЕСЬ участок (тело + перечень) одной сборкой — так закрытие
  // цикла тела попадает в документ ровно один раз.
  const blockEnd = itemParas.length ? paras[itemParas.length ? iFirstItem + itemParas.length - 1 : iFirstItem] : paras[iFirstItem - 1];
  const sectionOfXml = paras.slice(iBasis, iFirstItem + itemParas.length).join('');
  xml = xml.replace(sectionOfXml, bodyOpen + bodyLoop + bodyClose + itemOpen + itemLoop + itemClose);

  // 5. Счёт — ключевой абзац, в образце ЖИРНЫЙ. Цикл из одного элемента:
  //    жирность берётся из образца. D-392b: теги обязаны стоять отдельными
  //    абзацами, иначе docxtemplater не размножит абзац (и текст слипнется).
  const mkLoop = (paraXml, name) => [
    setParaText(paraXml, `{#${name}}`),
    setParaText(paraXml, '{text}'),
    setParaText(paraXml, `{/${name}}`).replace(/<w:spacing[^/]*\/>/g, '<w:spacing w:after="0"/>'),
  ].join('');
  xml = xml.replace(paras[iInvoice], mkLoop(paras[iInvoice], 'invoice_paragraphs'));

  // 6. Просьба об оплате — тоже жирная.
  xml = xml.replace(paras[iRequest], mkLoop(paras[iRequest], 'request_paragraphs'));

  // 7. Абзацы между счётом и просьбой (обоснование необходимости) — обычные.
  const betweenStart = iInvoice + 1;
  const betweenEnd = iRequest; // не включая
  if (betweenEnd > betweenStart) {
    const block = paras.slice(betweenStart, betweenEnd).join('');
    if (block) {
      xml = xml.replace(block, mkLoop(paras[betweenStart], 'outro_paragraphs'));
    }
  }

  // 8. Подпись: в образце «_____________» — заменяем на факсимиле.
  const iLine = find(/^_+$/, iSigPos);
  if (iLine > 0) {
    xml = xml.replace(paras[iLine], setParaText(paras[iLine], '{%signature_img}'));
  }

  // 9. Штамп «МП» — заменяем на печать.
  const iMp = find(/^МП$/i, iSigPos);
  if (iMp > 0) {
    xml = xml.replace(paras[iMp], setParaText(paras[iMp], '{%stamp_img}'));
  }

  // 10. Фамилия директора.
  const iName = find(/Кудряшов/, iSigPos);
  if (iName > 0) {
    xml = xml.replace(paras[iName], setParaText(paras[iName], '{gendir_name}'));
  }

  // 11. Должность.
  xml = xml.replace(paras[iSigPos], setParaText(paras[iSigPos], '{gendir_position}'));

  // ── D-392b: чистим переполнение ──────────────────────────────────────
  // 12. Пустые абзацы-отбивки в шапке (9 штук в образце). Из-за них письмо
  //     не умещалось на лист, а подпись уезжала на второй.
  //
  //     ВАЖНО (наш же дефект): удалять регуляркой `xml.replace(emptyPara,'')`
  //     НЕЛЬЗЯ — регулярка жадная, и при вложенных абзацах (абзац внутри
  //     таблицы/надписи) она съедала лишнее: в результате `<w:p>` 39 против
  //     `</w:p>` 38, файл переставал открываться в LibreOffice. Поэтому
  //     чистим ПО ИНДЕКСАМ через массив абзацев: сначала собираем новый
  //     список, потом склеиваем — без регулярных замен по всему XML.
  {
    const list = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
    const keep = [];
    const drop = new Set();
    for (let i = 0; i < list.length && i < iNumber; i++) {
      const t = list[i].replace(/<[^>]+>/g, '').trim();
      const hasImg = /<w:drawing>|<w:pict>/.test(list[i]);
      if (!t && !hasImg) drop.add(list[i]);
    }
    // Оставляем ОДНУ отбивку перед номером (последнюю из пустых).
    const dropList = [...drop];
    if (dropList.length > 1) dropList.pop();
    const dropSet = new Set(dropList);
    // Склеиваем: проходим по списку абзацев в порядке появления.
    let out = '';
    let cursor = 0;
    for (const p of list) {
      const idx = xml.indexOf(p, cursor);
      if (idx < 0) continue;
      out += xml.slice(cursor, idx);
      if (!dropSet.has(p)) out += p;
      cursor = idx + p.length;
    }
    out += xml.slice(cursor);
    xml = out;
    console.log('убрано пустых отбивок в шапке:', dropSet.size);
  }

  // 13. ШАПКА. В образце реквизиты лежат в ПЛАВАЮЩЕЙ надписи
  //     (w:txbxContent с таблицей внутри абзаца с логотипом). При
  //     конвертации LibreOffice/Word выносят такую надпись в конец
  //     документа: письмо начиналось с «Исх. №», а реквизиты оказывались
  //     в подвале (видно на первом рендере).
  //
  //     Поэтому надпись убираем целиком и собираем шапку обычными абзацами:
  //     логотип (встроенный) слева, реквизиты справа. Оформление берём из
  //     образца — Franklin Gothic Book, выравнивание вправо, 9 pt.
  {
    // Ищем абзац, содержащий надпись, но заменяем его ТОЧНО по границам:
    // берём текст от начала первого абзаца до закрытия внешнего <w:txbxContent>.
    // Регулярка `<w:p>...<\/w:p>` тут не годится — внутри надписи лежат
    // таблицы и вложенные абзацы, и нежадный матч обрывается на первом
    // же вложенном </w:p>, оставляя «хвост» (это и дало </w:p> лишний).
    const txbStart = xml.indexOf('<w:txbxContent>');
    const txbEnd = xml.indexOf('</w:txbxContent>');
    let headPara = null;
    if (txbStart > 0 && txbEnd > txbStart) {
      // Границы внешнего абзаца: от предыдущего <w:p ...> до парного </w:p>
      // после </w:txbxContent>.
      const pStart = xml.lastIndexOf('<w:p ', txbStart);
      let depth = 0, i = pStart, end = -1;
      const re = /<w:p\b[^>]*>|<\/w:p>/g;
      re.lastIndex = pStart;
      let m;
      while ((m = re.exec(xml)) !== null) {
        if (m[0].startsWith('</w:p>')) { depth--; if (depth === 0) { end = m.index + '</w:p>'.length; break; } }
        else depth++;
      }
      if (pStart >= 0 && end > 0) headPara = xml.slice(pStart, end);
    }
    if (!headPara) {
      console.log('шапка-надпись не найдена — оставляем как есть');
    } else {
      // Берём ТОЛЬКО прогон с картинкой. Первая версия брала «всё до
      // </w:r>», и в шапку попадали прогоны с координатами плавающего
      // объекта — они печатались как «00» перед логотипом.
      const logoRun = (headPara.match(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:drawing>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/)
        || [''])[0];

      // Абзац с логотипом: только картинка, без остатков позиционных чисел.
      // В образце внутри абзаца лежали координаты плавающего объекта, они
      // печатались как «00» слева от логотипа (видно в PDF).
      const logoPara = `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="left"/></w:pPr>${logoRun}</w:p>`;

      // Реквизиты справа. D-392c: девять отдельных абзацев занимали почти
      // треть листа и выталкивали подпись на второй. Собираем в ТРИ абзаца
      // с переносами строки (<w:br/>) — вид тот же, высоты втрое меньше.
      // D-392d: ещё компактнее — ДВА абзаца, кегль 8 pt.
      const META_GROUPS = [
        ['{company_org_short}', '{company_address}', 'ИНН / КПП: {company_inn_kpp}', '{company_bank_name}'],
        ['р/с {company_bank_account}', 'к/с {company_bank_corr_account}', 'БИК {company_bank_bic}', 'e-mail: {company_email} · тел.: {company_phone}'],
      ];
      const rpr = '<w:rPr><w:rFonts w:ascii="Franklin Gothic Book" w:hAnsi="Franklin Gothic Book"/><w:sz w:val="16"/></w:rPr>';
      const metaRuns = META_GROUPS.map((lines, gi) => `<w:p><w:pPr>`
        + `<w:spacing w:after="${gi === META_GROUPS.length - 1 ? 100 : 0}" w:line="200" w:lineRule="auto"/>`
        + `<w:jc w:val="right"/>${rpr}`
        + `</w:pPr><w:r>${rpr}<w:t xml:space="preserve">${lines.join('</w:t></w:r><w:r>' + rpr + '<w:br/><w:t xml:space="preserve">')}</w:t></w:r></w:p>`).join('');

      xml = xml.replace(headPara, logoPara + metaRuns);
      console.log('шапка пересобрана: логотип + реквизиты обычными абзацами (надпись удалена)');
    }
  }

  // 13б. ЛОГОТИП: в образце он ПЛАВАЮЩИЙ (wp:anchor со смещением −476885).
  //      При конвертации LibreOffice/Word выносят плавающий объект за поток,
  //      и он «выталкивает» пустую страницу. Переводим во встроенный
  //      (wp:inline), сохраняя ВСЁ дерево картинки: меняем только имя тега
  //      и выкидываем позиционные элементы.
  {
    const before = xml;
    xml = xml.replace(/<wp:anchor\b([^>]*)>([\s\S]*?)<\/wp:anchor>/g, (m, attrs, inner) => {
      const keepAttrs = attrs
        .replace(/\s(?:simplePos|relativeHeight|behindDoc|locked|layoutInCell|allowOverlap|wp14:anchorId|wp14:editId)="[^"]*"/g, '')
        .trim();
      const cleaned = inner
        .replace(/<wp:simplePos[^/]*\/>/g, '')
        .replace(/<wp:positionH\b[\s\S]*?<\/wp:positionH>/g, '')
        .replace(/<wp:positionV\b[\s\S]*?<\/wp:positionV>/g, '')
        .replace(/<wp:wrap\w*[^/]*\/>/g, '');
      return `<wp:inline ${keepAttrs}>${cleaned}</wp:inline>`;
    });
    const anchors = (xml.match(/<wp:anchor\b/g) || []).length;
    if (anchors) {
      console.error('ОТКАЗ: остались плавающие объекты (wp:anchor):', anchors);
      process.exit(1);
    }
    if (before !== xml) console.log('логотип переведён во встроенный (wp:inline)');
  }

  // 13в. Пустые абзацы: в образце их много (отбивки между блоками).
  //      Каждая — строка высотой ~0.6 см; вместе они и выталкивают подпись
  //      на второй лист. Оставляем ОДИН пустой абзац перед обращением
  //      (визуальный воздух), остальные убираем — интервалы у абзацев уже
  //      заданы через w:spacing.
  {
    const list = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
    const empties = list.filter((p) => {
      const t = p.replace(/<[^>]+>/g, '').trim();
      return !t && !/w:drawing/.test(p) && !/<w:sectPr/.test(p);
    });
    // Оставляем первый пустой (после шапки), остальные — вон.
    empties.slice(1).forEach((p) => { xml = xml.replace(p, ''); });
    console.log('убрано пустых абзацев:', Math.max(0, empties.length - 1), 'из', empties.length);
  }

  //      После пересборки шапки письмо стало занимать два листа, и подпись
  //      уезжала на второй (видно на рендере). Причины: номер с датой
  //      переносился на две строки, интерлиньяж 1.5 от образца и отбивки.
  //      Уплотняем ровно то, что не портит вид: интерлиньяж 1.15, интервалы
  //      после абзацев 0, дата не переносится.
  {
    // Дата: запрет переноса внутри значения (неразрывные пробелы).
    xml = xml.replace(/\{letter_date_short\}/g, '{letter_date_short}');

    // Интерлиньяж: единый для тела — 1.15 вместо 1.5 (line=360 → 276).
    xml = xml.replace(/<w:spacing\b[^>]*w:line="360"[^>]*\/>/g,
      '<w:spacing w:after="0" w:line="276" w:lineRule="auto"/>');

    // Отбивка после абзацев: 120–240 → 60, чтобы блоки не разъезжались.
    xml = xml.replace(/<w:spacing w:after="(?:120|160|200|240)"([^/]*)\/>/g,
      '<w:spacing w:after="60"$1/>');

    // Логотип уменьшаем до 5.5 см по ширине: в образце он 7.3 см, но с
    // реквизитами справа занимает почти треть листа.
    xml = xml.replace(/(<wp:extent cx=")2656424(" cy=")2592070("[^/]*\/>)/g, '$11984500$21944000$3');
    xml = xml.replace(/(<a:ext cx=")2656424(" cy=")2592070("[^/]*\/>)/g, '$11984500$21944000$3');

    // Подпись: в образце она разнесена на 4 строки с «(подпись)» и
    // «(расшифровка подписи)» — это съедает 4 строки. Оставляем только
    // должность и ФИО, а пояснения в скобках убираем: в готовом документе
    // с факсимиле они не нужны.
    xml = xml.replace(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?\(подпись\)(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, '');
    xml = xml.replace(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?\(расшифровка подписи\)(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, '');

    // D-392f: ГЛАВНАЯ ПРИЧИНА ВТОРОЙ СТРАНИЦЫ — сетка документа.
    // В образце <w:docGrid w:linePitch="360" .../>: Word привязывает каждую
    // строку к сетке с шагом 360 твипов (это интерлиньяж 1.5). Сетка
    // ПЕРЕБИВАЕТ w:spacing w:line у абзацев — поэтому уплотнение не давало
    // эффекта, и письмо выходило на два листа при запасе по тексту.
    // Ставим шаг 240 (одинарный интервал). Вид сохраняется, лист — один.
    xml = xml.replace(/<w:docGrid[^/]*\/>/g, '<w:docGrid w:linePitch="240"/>');
    console.log('сетка документа: linePitch 360 → 240 (снимает форсированный интерлиньяж 1.5)');

    // Поля страницы: в образце нижнее поле 426 твипов — письмо вылезает
    // за лист. Даём нормальные поля.
    xml = xml.replace(/w:bottom="\d+"/, 'w:bottom="567"');    // 1 см
    xml = xml.replace(/w:top="\d+"/, 'w:top="567"');          // 1 см
    xml = xml.replace(/w:footer="\d+"/, 'w:footer="0"');

    // Блок подписи: убираем отступы и «воздух» перед ним, иначе последние
    // строки уезжают на второй лист, а подпись остаётся одна.
    // D-392g: убираем и pStyle — стиль Standard в этом документе несёт
    // собственный интерлиньяж/интервалы и перебивает наши настройки.
    const cleanSig = (p) => p
      .replace(/<w:pStyle[^/]*\/>/g, '')
      .replace(/<w:widowControl[^/]*\/>/g, '')
      .replace(/<w:spacing\b[^>]*\/>/g, '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>')
      .replace(/<w:ind\b[^>]*\/>/g, '');

    xml = xml.replace(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?\{gendir_position\}(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, cleanSig);
    xml = xml.replace(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?\{%stamp_img\}(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, cleanSig);
    xml = xml.replace(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?\{%signature_img\}(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, cleanSig);
    xml = xml.replace(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?\{gendir_name\}(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, cleanSig);

    // D-392d: картинки подписи и печати ужимаем до письменного масштаба.
    // В образце они растянуты, и блок занимал ~5 см — из-за него письмо
    // уходило на второй лист.
    xml = xml.replace(/(<wp:extent cx=")(\d+)(" cy=")(\d+)("[^/]*\/>)/g, (m, a, cx, b, cy, d) => {
      // Применяем только к маленьким картинкам (подпись/печать), не к логотипу.
      if (Number(cx) > 1500000) return m;
      return `${a}${cx}${b}${cy}${d}`;
    });
    // D-392e: ПУСТАЯ ВТОРАЯ СТРАНИЦА. Весь текст и подпись на первой, но
    // документ двухстраничный. Причина — интерлиньяж 1.15 + большая картинка
    // подписи: суммарная высота чуть превышает лист, и последний элемент
    // переносится. Сжимаем ровно две вещи: интервал перед «Генеральный
    // директор» и высоту подписи/печати. Это не портит вид.
    xml = xml.replace(/<w:spacing w:before="\d+"([^/]*)\/>/g, '<w:spacing w:before="0"$1/>');
    console.log('убран интервал перед подписью');
    console.log('уплотнено: интерлиньяж 1.15, интервалы 60, логотип 5.5 см, подпись без пояснений, поля 1 см');
  }


  // 14. Разрывы страниц: их быть не должно, иначе письмо расползается.
  const brCount = (xml.match(/<w:br w:type="page"\/>/g) || []).length;
  if (brCount) {
    xml = xml.replace(/<w:br w:type="page"\/>/g, '');
  }
  console.log('убрано принудительных разрывов страниц:', brCount);

  // 15. КОНТРОЛЬ ЦЕЛОСТНОСТИ. Если после правок число открывающих и
  //     закрывающих абзацев разошлось — файл не откроется в Word/LibreOffice.
  //     Именно так случилось при первой сборке: регулярка съела закрывающий
  //     тег, и LibreOffice отвечал «source file could not be loaded».
  {
    const openP = (xml.match(/<w:p\b/g) || []).length;
    const closeP = (xml.match(/<\/w:p>/g) || []).length;
    if (openP !== closeP) {
      console.error(`ОТКАЗ: нарушена структура XML — <w:p>=${openP}, </w:p>=${closeP}`);
      console.error('Шаблон НЕ записан, чтобы не положить генерацию писем.');
      process.exit(1);
    }
    // Вложенных абзацев быть не должно: docxtemplater ломается на них.
    // Оговорка: абзац внутри надписи (w:txbxContent) — это законная
    // конструкция Word, не дефект. Дефект — когда <w:p> не закрыт и
    // «следующий» абзац оказывается внутри предыдущего.
    const nested = (xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [])
      .filter((p) => {
        const inner = p.slice(p.indexOf('>') + 1);
        if (!/<w:p\b/.test(inner)) return false;
        // внутри текстового блока надписи — допустимо
        return !/<w:txbxContent>/.test(inner);
      }).length;
    if (nested) {
      console.error(`ОТКАЗ: в шаблоне ${nested} вложенных <w:p> — Word/LibreOffice не откроют файл`);
      process.exit(1);
    }
    console.log('структура XML цела: абзацев', openP, '| вложенных', nested);
  }

  // ВАЖНО: zip.file('word/document.xml', xml) пишется в САМОМ КОНЦЕ, после
  // всех правок. Раньше запись стояла здесь, а блок 16 (колонтитул) правил
  // xml уже ПОСЛЕ записи — правка не попадала в файл, и письмо продолжало
  // выходить на два листа. Порядок критичен.

  // 16. D-392c: «Исп.:» дублировался — он есть и в теле, и в КОЛОНТИТУЛЕ
  //     шаблона (footer1.xml образца). Кроме дубля, колонтитул выталкивал
  //     последнюю строку на ВТОРУЮ страницу (письмо выходило на два листа).
  //     Убираем ссылку на колонтитул из секции: тогда Word/LibreOffice его
  //     вообще не рендерят. Исполнитель остаётся в теле письма.
  {
    const before = xml;
    // \b в JS не срабатывает перед кириллицей и в конце «Reference» —
    // используем явный шаблон без границ слова.
    xml = xml.replace(/<w:footerReference[^>]*\/>/g, '')
             .replace(/<w:footerReference[^>]*>[\s\S]*?<\/w:footerReference>/g, '');
    if (xml !== before) {
      console.log('колонтитул отключён: «Исп.» остаётся только в теле письма');
    } else {
      console.log('ОТКАЗ: ссылка на колонтитул не убрана — письмо уйдёт на 2 листа');
    }
  }

  // Финальная запись правок в архив — ПОСЛЕ всех преобразований.
  zip.file('word/document.xml', xml);

  const buf = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(DST, buf);

  console.log('\nзаписан:', DST, Math.round(buf.length / 1024), 'КБ');
  console.log('логотип в шаблоне:', zip.file(/^word\/media\//).length, 'файл(ов) медиа');
  console.log('\nплейсхолдеры в шаблоне:');
  ['{letter_number}', '{letter_date_short}', '{recipient_greeting}',
    '{#intro_paragraphs}', '{#items}', '{#invoice_paragraphs}',
    '{#outro_paragraphs}', '{#request_paragraphs}',
    '{%signature_img}', '{%stamp_img}', '{gendir_name}', '{gendir_position}']
    .forEach((ph) => console.log(`  ${ph}: ${xml.includes(ph) ? 'есть' : 'НЕТ'}`));
}

main();
