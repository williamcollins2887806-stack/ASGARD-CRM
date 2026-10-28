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
  // 1. Номер и дата: в образце «Исх. №261023-11 от 23.10.2026 г.», дата
  //    числовая — оставляем этот вид, он одобрен заказчиком.
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
