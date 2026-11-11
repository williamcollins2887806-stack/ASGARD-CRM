'use strict';
/**
 * V488: вернуть шаблон письма ОБС к эталону Дмитрия.
 *
 * ЧТО ИСПРАВЛЯЕТСЯ (замерено по файлу заказчика и по 13 письмам директора):
 *
 *  1. ЛОГОТИП. В шаблоне `wp:inline` — потому что `make_obs_docx_template.js`
 *     НАРОЧНО переводил anchor → inline, чтобы плавающий объект не выталкивал
 *     пустую страницу. Побочный эффект: логотип перестал быть плавающим и
 *     «уехал» относительно реквизитов (жалоба 11.11.2026: «контитул с
 *     карточкой асгарда куда-то уехал»). В эталоне он `wp:anchor`,
 *     `wrapNone`, `posOffset -141823 / -477323`.
 *
 *  2. ШРИФТ. `docDefaults` = Liberation Serif — след конвертации из Linux.
 *     В эталоне тело набрано Calibri 12 pt. Сейчас документ целиком уходил в
 *     Franklin Gothic Book, и заказчик справедливо заметил «шрифты разные».
 *
 * Скрипт правит только `word/document.xml` и `word/styles.xml`, сохраняет
 * копию рядом. Идемпотентен: повторный запуск ничего не меняет.
 *
 * Запуск: node tools/patch_obs_template_v488.js
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TPL = path.join(__dirname, '..', 'templates', 'obs-letter-tpl.docx');
const BAK = path.join(__dirname, '..', 'templates', 'obs-letter-tpl.docx.pre-v488');

// Эталон Дмитрия: 209,2 x 204,1 мм картинка-логотип, смещение -11,2 / -37,6 мм.
const LOGO_ANCHOR = {
  posH: -141823,
  posV: -477323,
  cx: 2656424,
  cy: 2592070,
};

function main() {
  if (!fs.existsSync(TPL)) {
    console.error('НЕТ ШАБЛОНА:', TPL);
    process.exit(1);
  }
  const buf = fs.readFileSync(TPL);
  const zip = new PizZip(buf);
  const docFile = zip.file('word/document.xml');
  const stylesFile = zip.file('word/styles.xml');
  if (!docFile) { console.error('нет word/document.xml'); process.exit(1); }

  let xml = docFile.asText();
  const beforeDoc = xml;
  const changes = [];

  // ─── 1. Логотип: inline → anchor (плавающий, как в эталоне) ─────────────
  //
  // Берём ПЕРВЫЙ inline-drawing — это логотип в шапке (в шаблоне он один).
  {
    const re = /<wp:inline\b([^>]*)>([\s\S]*?)<\/wp:inline>/;
    const m = xml.match(re);
    if (m) {
      const inner = m[2]
        .replace(/<wp:extent\b[^/]*\/>/g, '')
        .replace(/<wp:effectExtent\b[^/]*\/>/g, '');
      const anchor = '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" '
        + 'simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" '
        + 'layoutInCell="1" allowOverlap="1">'
        + '<wp:simplePos x="0" y="0"/>'
        + `<wp:positionH relativeFrom="column"><wp:posOffset>${LOGO_ANCHOR.posH}</wp:posOffset></wp:positionH>`
        + `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${LOGO_ANCHOR.posV}</wp:posOffset></wp:positionV>`
        + `<wp:extent cx="${LOGO_ANCHOR.cx}" cy="${LOGO_ANCHOR.cy}"/>`
        + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
        + '<wp:wrapNone/>'
        + inner
        + '</wp:anchor>';
      xml = xml.replace(m[0], anchor);
      changes.push('логотип: inline → anchor (плавающий, как в эталоне)');
    }
  }

  // ─── 2. docDefaults: Liberation Serif → Calibri ────────────────────────
  let styles = stylesFile ? stylesFile.asText() : '';
  const beforeStyles = styles;
  if (styles) {
    styles = styles.replace(
      /(<w:rPrDefault><w:rPr><w:rFonts[^>]*w:ascii=")Liberation Serif(")/,
      '$1Calibri$2'
    ).replace(
      /(<w:rPrDefault><w:rPr><w:rFonts[^>]*w:hAnsi=")Liberation Serif(")/,
      '$1Calibri$2'
    );
    // Размер по умолчанию — 12 pt (24 half-points), как в эталоне.
    if (!/<w:rPrDefault>[\s\S]*?<w:sz w:val="24"\/>/.test(styles)) {
      styles = styles.replace(
        /(<w:rPrDefault><w:rPr>[\s\S]*?)(<\/w:rPr><\/w:rPrDefault>)/,
        '$1<w:sz w:val="24"/><w:szCs w:val="24"/>$2'
      );
    }
    if (styles !== beforeStyles) changes.push('docDefaults: Liberation Serif → Calibri, 12 pt');
  }

  if (xml === beforeDoc && styles === beforeStyles) {
    console.log('шаблон уже соответствует эталону — изменений нет');
    return;
  }

  if (!fs.existsSync(BAK)) {
    fs.writeFileSync(BAK, buf);
    console.log('копия оригинала:', path.basename(BAK));
  }

  zip.file('word/document.xml', xml);
  if (styles) zip.file('word/styles.xml', styles);
  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(TPL, out);

  console.log('исправлено:');
  for (const c of changes) console.log('  •', c);
  console.log('размер:', buf.length, '→', out.length);
}

main();
