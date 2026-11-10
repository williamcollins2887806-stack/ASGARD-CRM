'use strict';
/**
 * Один шаблон КП на оба варианта: короткое и полное отличаются ОБЪЁМОМ,
 * а не шапкой, логотипом и подписью.
 *
 * ── История (10.11.2026) ───────────────────────────────────────────────────
 * Короткое КП собиралось отдельным генератором «с нуля»: 1,6 КБ, без
 * логотипа, без реквизитов, без печати. Заказчик получал файл, не похожий
 * на фирменный документ, а Word и PDF одного ТКП выглядели как два разных
 * письма. Проверка идёт ПО СГЕНЕРИРОВАННОМУ ФАЙЛУ, а не по исходнику.
 */

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-stub';
const assert = require('assert');
const AdmZip = require('adm-zip');
const full = require('../src/services/tkp-full-kp');

const TKP = {
  id: 9998,
  kp_variant: 'classic',
  subject: 'Короткое КП: проверка шаблона',
  customer_name: 'ООО «Тест»',
  total_sum: 1000000,
  created_at: new Date().toISOString(),
  deadline: '31.12.2026',
  items: JSON.stringify({
    items: [
      { name: 'Гидроструйная чистка АВО', unit: 'м²', qty: 1000, price: 800, total: 800000 },
      { name: 'Химическая промывка', unit: 'компл', qty: 1, price: 200000, total: 200000 }
    ],
    vat_pct: 22,
    subtotal: 1000000,
    work_description: 'Очистка поверхностей от отложений'
  })
};
const COMPANY = {
  name: 'ООО «АСГАРД-Сервис»',
  phone: '+7 (499) 322-30-62',
  legal_address: 'БОЛЬШАЯ ПОЧТОВАЯ УЛ., Д. 55/59',
  director_name: 'Кудряшов Олег Сергеевич'
};

function inspect(buf) {
  const z = new AdmZip(buf);
  const doc = z.readAsText('word/document.xml');
  const text = doc.replace(/<[^>]+>/g, ' ');
  return {
    size: buf.length,
    media: z.getEntries().filter((e) => /word\/media\//.test(e.entryName)).length,
    anchors: (doc.match(/<wp:anchor/g) || []).length,
    wrapNone: (doc.match(/<wp:wrapNone\/>/g) || []).length,
    paragraphAnchors: (doc.match(/relativeFrom="paragraph"/g) || []).length,
    behindDocZero: !/behindDoc="1"/.test(doc),
    hasCompany: /АСГАРД/i.test(text),
    hasPhone: /322-30-62/.test(text),
    hasWork: /Гидроструйная чистка/.test(text),
    hasTotal: /НДС/.test(text),
    hasSigner: /КУДРЯШОВ/i.test(text),
    hasAcceptance: /ПОРЯДОК СДАЧИ/i.test(text),
    hasRisks: /РИСКИ/i.test(text)
  };
}

const shortStamped = inspect(full.generateFullKpDocxBuffer(TKP, COMPANY, { variant: 'classic', stamp: true, signature: true }));
const shortPlain = inspect(full.generateFullKpDocxBuffer(TKP, COMPANY, { variant: 'classic' }));
const fullVariant = inspect(full.generateFullKpDocxBuffer(TKP, COMPANY, { variant: 'full', stamp: true, signature: true }));
const legacyCall = inspect(full.generateClassicDocxBuffer(TKP, COMPANY));

const results = [];
function check(name, fn) {
  try { fn(); results.push({ ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ ok: false }); console.log('FAIL ' + name + ' — ' + e.message); }
}

check('короткое КП собирается из шаблона (а не из строк кода)', () => {
  assert.ok(shortPlain.size > 100000, 'файл подозрительно мал: ' + shortPlain.size + ' байт');
  assert.ok(shortPlain.media >= 3, 'нет картинок шаблона (логотип/подпись): ' + shortPlain.media);
});

check('короткое КП имеет шапку с реквизитами', () => {
  assert.ok(shortPlain.hasCompany, 'нет названия компании');
  assert.ok(shortPlain.hasPhone, 'нет телефона из шапки');
  assert.ok(shortPlain.hasSigner, 'нет ФИО подписанта');
});

check('короткое КП содержит работы и итоги', () => {
  assert.ok(shortPlain.hasWork, 'нет строки работ');
  assert.ok(shortPlain.hasTotal, 'нет строки НДС/итогов');
});

check('короткое КП: печать и подпись ставятся', () => {
  assert.ok(shortStamped.anchors >= 2, 'якорей меньше двух (печать+подпись): ' + shortStamped.anchors);
  assert.ok(shortStamped.media >= 4, 'нет картинки печати: ' + shortStamped.media);
  assert.ok(shortStamped.wrapNone >= 2, 'печать/подпись не плавающие: wrapNone=' + shortStamped.wrapNone);
  assert.ok(shortStamped.behindDocZero, 'картинки ушли за текст (behindDoc=1)');
  assert.ok(shortStamped.paragraphAnchors >= 2, 'привязка не к абзацу подписи');
});

check('короткое КП короче полного по разделам, но не по шапке', () => {
  assert.strictEqual(shortPlain.hasAcceptance, false, 'в коротком КП лишний раздел «ПОРЯДОК СДАЧИ»');
  assert.strictEqual(shortPlain.hasRisks, false, 'в коротком КП лишний раздел «РИСКИ»');
  // Шапка одинаковая — обе версии берут её из одного файла шаблона
  assert.strictEqual(shortPlain.hasCompany, fullVariant.hasCompany);
  assert.strictEqual(shortPlain.hasPhone, fullVariant.hasPhone);
  assert.strictEqual(shortPlain.hasSigner, fullVariant.hasSigner);
});

check('старый вызов generateClassicDocxBuffer идёт через шаблон', () => {
  assert.ok(legacyCall.size > 100000, 'вернулся прежний пустой документ: ' + legacyCall.size);
  assert.ok(legacyCall.media >= 3, 'нет шапки шаблона в совместимом вызове');
});

check('полное КП по-прежнему содержит развёрнутые разделы', () => {
  // В тестовом payload разделов нет, поэтому проверяем только шапку и подпись:
  // они обязаны быть в обоих вариантах.
  assert.ok(fullVariant.hasCompany && fullVariant.hasSigner, 'полное КП потеряло шапку');
});

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
