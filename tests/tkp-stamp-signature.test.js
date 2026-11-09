'use strict';

/**
 * Печать и подпись в Word-выгрузке ТКП.
 *
 * ── Что было сломано (09.11.2026) ─────────────────────────────────────────
 * 1. Маршрут /api/tkp/:id/docx не читал флаги stamp/signature вообще —
 *    кнопка «Word» отдавала документ БЕЗ печати.
 * 2. В шаблоне уже есть подпись, а код добавлял свою → в PDF выходило
 *    ДВЕ подписи, а в Word оставалась одна (что и видел владелец).
 * 3. Координаты картинок считались от края СТРАНИЦЫ с жёстким 104 pt по
 *    вертикали — это верхняя треть листа, поэтому печать падала в шапку,
 *    «между текстом».
 * 4. Ошибка вставки глушилась `catch (_)`, и печать молча исчезала.
 *
 * Тесты держат ровно эти четыре вещи.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

process.env.DB_PASSWORD = process.env.DB_PASSWORD || '123456789';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

const svc = require('../src/services/tkp-full-kp.js');

const tkp = {
  id: 999999,
  tkp_number: 'АС-ТЕСТ',
  created_at: new Date('2026-11-09'),
  customer_name: 'ООО «Тестовый заказчик»',
  subject: 'Очистка теплообменного оборудования',
  items: JSON.stringify({
    items: [{ name: 'Очистка', qty: 1, unit: 'компл.', price: 500000, total: 500000 }],
    vat_pct: 20
  }),
  kp_variant: 'full',
  vat_pct: 20
};
const company = {
  name: 'ООО «АСГАРД-Сервис»',
  phone: '+7 (499) 322-30-62',
  director_name: 'Кудряшов Олег Сергеевич',
  director_title: 'Генеральный директор'
};

function docx(opts) {
  const buf = svc.generateFullKpDocxBuffer(tkp, company, opts);
  const z = new PizZip(buf);
  const xml = z.file('word/document.xml').asText();
  return { buf, xml, media: Object.keys(z.files).filter((f) => f.startsWith('word/media')) };
}

(async () => {
  await check('без флагов печати нет', () => {
    const d = docx({});
    assert.ok(!d.media.some((m) => /stamp/.test(m)), 'печать появилась без запроса');
  });

  await check('с печатью в документе ровно одна печать', () => {
    const d = docx({ stamp: true, signature: true });
    const stamps = d.media.filter((m) => /stamp/.test(m));
    assert.strictEqual(stamps.length, 1, 'печатей: ' + stamps.length);
  });

  await check('подпись не дублируется (шаблон уже её содержит)', () => {
    const d = docx({ stamp: true, signature: true });
    const sigs = d.media.filter((m) => /signature/.test(m));
    // 0 — если пользуемся подписью шаблона, 1 — если своей. Двух быть не может.
    assert.ok(sigs.length <= 1, 'подписей: ' + sigs.length);
    const anchors = (d.xml.match(/<wp:anchor/g) || []).length;
    // шапка (лого) + подпись шаблона + печать
    assert.ok(anchors <= 3, 'плавающих картинок: ' + anchors);
  });

  await check('координаты от абзаца, а не от страницы', () => {
    // Координаты от страницы = печать в шапке («между текстом»).
    // Ищем именно позиционирование wp:positionH/V. Служебные
    // wp14:sizeRelH/V (масштаб относительно листа) безобидны — не считаем.
    const d = docx({ stamp: true, signature: true });
    const posH = d.xml.match(/<wp:positionH relativeFrom="([^"]+)"/g) || [];
    const posV = d.xml.match(/<wp:positionV relativeFrom="([^"]+)"/g) || [];
    const bad = [...posH, ...posV].filter((s) => /"page"/.test(s));
    assert.strictEqual(bad.length, 0, 'привязка к странице: ' + bad.join(', '));
    assert.ok(/<wp:positionV relativeFrom="paragraph"/.test(d.xml), 'нет привязки к абзацу');
  });

  await check('картинки лежат слоем поверх, без обтекания', () => {
    // wrapSquare/wrapTight раздвигают текст — выглядит как «вставлено между».
    const d = docx({ stamp: true, signature: true });
    assert.ok(!/<wp:wrapSquare/.test(d.xml), 'появилось обтекание');
    assert.ok(!/<wp:wrapTight/.test(d.xml), 'появилось обтекание');
    assert.ok(/<wp:wrapNone\/>/.test(d.xml), 'нет плавающего слоя');
  });

  await check('ошибка вставки больше не глушится', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'tkp-full-kp.js'), 'utf8'
    );
    assert.ok(/печать\/подпись не вставлены/.test(src), 'нет диагностики сбоя');
  });

  await check('маршрут /docx принимает флаги печати', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'tkp.js'), 'utf8'
    );
    // Ищем именно ветку docx, а не pdf.
    const docxRoute = src.slice(src.indexOf("'/:id/docx'"));
    assert.ok(/stamp/.test(docxRoute.slice(0, 3000)), 'флаг stamp не читается в /docx');
    assert.ok(/signature/.test(docxRoute.slice(0, 3000)), 'флаг signature не читается в /docx');
  });

  const failed = results.filter((r) => !r.ok);
  console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
  process.exit(failed.length ? 1 : 0);
})();
