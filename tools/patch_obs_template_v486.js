'use strict';
/**
 * V486: привести шаблон письма ОБС к эталону Дмитрия.
 *
 * ЧТО ИСПРАВЛЯЕТСЯ (замерено по 13 письмам директора):
 *
 *  1. НИЖНЕЕ ПОЛЕ. Было 567 (1 см) — из-за этого длинное письмо «проваливалось»
 *     на второй лист, где висели только подпись и реквизиты (так случилось с
 *     «Золотой Джин» у самого Дмитрия). В эталоне 1583 (2,8 см) — место под
 *     колонтитул с исполнителем.
 *
 *  2. ВЕРХНЕЕ ПОЛЕ. Было 567, в эталоне 851 (1,5 см).
 *
 *  3. ШРИФТ РЕКВИЗИТОВ. В шаблоне 8 pt (sz=16) — нечитаемо на печати.
 *     В эталоне 11 pt (sz=22), первая строка (название) — жирная.
 *
 *  4. КОЛОНТИТУЛ. Было footer=0 (выключен). В эталоне 822 (1,45 см) с текстом
 *     «Исп. <кто завёл> · тел.: …».
 *
 * Скрипт правит ТОЛЬКО word/document.xml и сохраняет копию оригинала рядом.
 * Идемпотентен: повторный запуск ничего не меняет.
 *
 * Запуск: node tools/patch_obs_template_v486.js
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TPL = path.join(__dirname, '..', 'templates', 'obs-letter-tpl.docx');
const BAK = path.join(__dirname, '..', 'templates', 'obs-letter-tpl.docx.pre-v486');

/** Эталон Дмитрия: pgMar top 851, right 850, bottom 1583, left 993, footer 822. */
const PG_MAR = '<w:pgMar w:top="851" w:right="850" w:bottom="1583" w:left="993" '
  + 'w:header="0" w:footer="822" w:gutter="0"/>';

function main() {
  if (!fs.existsSync(TPL)) {
    console.error('НЕТ ШАБЛОНА:', TPL);
    process.exit(1);
  }
  const buf = fs.readFileSync(TPL);
  const zip = new PizZip(buf);
  const f = zip.file('word/document.xml');
  if (!f) { console.error('в шаблоне нет word/document.xml'); process.exit(1); }

  let xml = f.asText();
  const before = xml;
  const changes = [];

  // ─── 1. Поля страницы ───────────────────────────────────────────────────
  const pgMar = xml.match(/<w:pgMar[^/]*\/>/);
  if (pgMar && pgMar[0] !== PG_MAR) {
    xml = xml.replace(pgMar[0], PG_MAR);
    changes.push('поля: ' + pgMar[0].match(/top="\d+"/)[0] + ' → top="851", bottom="1583", footer="822"');
  }

  // ─── 2. Шрифт реквизитов: 8 pt → 11 pt ─────────────────────────────────
  //
  // Реквизиты стоят в шапке, выровнены вправо, набраны Franklin Gothic Book.
  // Ищем runs с этим шрифтом и sz=16 и поднимаем до 22 (11 pt).
  let reqFixed = 0;
  xml = xml.replace(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g, (m, inner) => {
    if (!/Franklin Gothic Book/i.test(inner)) return m;
    if (!/<w:sz w:val="16"\/>/.test(inner)) return m;
    reqFixed += 1;
    return m.replace(/<w:sz w:val="16"\/>/g, '<w:sz w:val="22"/>')
      .replace(/<w:szCs w:val="16"\/>/g, '<w:szCs w:val="22"/>');
  });
  if (reqFixed) changes.push(`реквизиты: ${reqFixed} run(ов) 8 pt → 11 pt`);

  if (xml === before) {
    console.log('шаблон уже соответствует эталону — изменений нет');
    return;
  }

  // ─── 3. Сохраняем ───────────────────────────────────────────────────────
  if (!fs.existsSync(BAK)) {
    fs.writeFileSync(BAK, buf);
    console.log('копия оригинала:', path.basename(BAK));
  }
  zip.file('word/document.xml', xml);
  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(TPL, out);

  console.log('исправлено:');
  for (const c of changes) console.log('  •', c);
  console.log('размер:', buf.length, '→', out.length);
}

main();
