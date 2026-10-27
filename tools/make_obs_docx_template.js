'use strict';

/**
 * tools/make_obs_docx_template.js
 *
 * D-384: собрать шаблон бланка для письма ОБС из официального
 * `templates/customer-letter-tpl.docx`.
 *
 * ЗАЧЕМ. Заказчик хочет Word «как шаблон Димы 1в1 на оф бланке с логотипом».
 * Официальный бланк (`customer-letter-tpl.docx`) для этого подходит: в нём
 * логотип, реквизиты, банк, поля подписи и печати. Но он рассчитан на
 * тендерную переписку и печатает то, чего в письме ОБС быть не должно:
 *
 *   «Реестровый номер процедуры: {procedure_number}»
 *   «Лот № {lot_number} «{lot_title}».»
 *
 * При пустых значениях получается «Лот № «».» — видимый брак в документе,
 * который уходит внешнему получателю.
 *
 * ЧТО ДЕЛАЕТ. Копирует шаблон и убирает те два абзаца ЦЕЛИКОМ (вместе с
 * параграфами, чтобы не осталось пустых строк). Остальная вёрстка —
 * логотип, реквизиты, подпись, печать — не трогается: это и есть «1в1».
 *
 * Идемпотентно: повторный запуск даёт тот же результат.
 *
 * Запуск: node tools/make_obs_docx_template.js
 */

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'templates', 'customer-letter-tpl.docx');
const DST = path.join(ROOT, 'templates', 'obs-letter-tpl.docx');

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('Нет исходного шаблона:', SRC);
    process.exit(1);
  }

  const zip = new PizZip(fs.readFileSync(SRC, 'binary'));
  let xml = zip.file('word/document.xml').asText();

  const before = xml.length;

  // Вырезаем ЦЕЛЫЕ параграфы, содержащие эти плейсхолдеры.
  // Регулярка ищет <w:p ...> ... </w:p>, внутри которого есть нужный тег.
  const removeParagraphWith = (tag) => {
    const re = new RegExp(
      '<w:p\\b[^>]*>(?:(?!</w:p>)[\\s\\S])*?' + tag + '(?:(?!</w:p>)[\\s\\S])*?</w:p>',
      'g'
    );
    const replaced = xml.replace(re, '');
    const removed = xml.length !== replaced.length;
    xml = replaced;
    return removed;
  };

  const r1 = removeParagraphWith('\\{procedure_number\\}');
  const r2 = removeParagraphWith('\\{lot_number\\}');
  const r3 = removeParagraphWith('\\{lot_title\\}');

  console.log(`процедура удалена: ${r1 ? 'да' : 'нет'}`);
  console.log(`лот № удалён:     ${r2 ? 'да' : 'нет'}`);
  console.log(`лот title удалён: ${r3 ? 'да' : 'нет'}`);
  console.log(`document.xml: ${before} → ${xml.length} (снято ${before - xml.length} символов)`);

  if (before === xml.length) {
    console.log('ВНИМАНИЕ: ничего не вырезано — проверьте шаблон вручную.');
  }

  zip.file('word/document.xml', xml);
  const buf = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(DST, buf);
  console.log(`\nготово: ${DST} (${Math.round(buf.length / 1024)} КБ)`);
}

main();
