'use strict';
/**
 * ГЕЙТ: универсальная шапка таблицы стоимости полного КП (D-182).
 *
 * Версионированный и самодостаточный: работает из чистого клона, без _tmp_* фикстур
 * и без .env.audit (нужные переменные окружения подставляются заглушками — к БД гейт
 * не обращается, только рендерит DOCX в память).
 *
 * Проверяет то, что уезжает клиенту и что нельзя проверить на проде после выкатки:
 *   · шаблон templates/full-kp-nika-tpl.docx — параметрический (плейсхолдеры {tbl_*},
 *     ни старых литералов «под аппараты», ни внутренних слов про себестоимость);
 *   · ТКП без переопределений печатает прежнюю корректную шапку (обратная совместимость
 *     старых записей в БД) — и в DOCX, и в HTML-fallback;
 *   · items.full.table_labels реально меняет печать (включая алиасы и приоритет
 *     канонических ключей), пустое значение = дефолт, чужие ключи не ломают рендер;
 *   · арифметика итогов и NBSP-форматирование денег;
 *   · дефолты трёх файлов (сервис ↔ форма v1 ↔ форма v2) совпадают ПО КЛЮЧАМ,
 *     и сверка на самом деле ловит подмену (mutation-самопроверка в памяти);
 *   · форма v1 умеет переопределять подписи (без неё «универсальность» недостижима из прода).
 *
 * Запуск: node tools/verify_tkp_full_template.js     (exit 0 — гейт зелёный)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// db.js требует DB_PASSWORD уже на require, хотя гейт к БД не ходит. Реальный .env
// подхватываем, если он есть; иначе — заглушка (никаких настоящих паролей в репозитории).
(function preloadEnv() {
  for (const rel of ['.env', '.env.audit']) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'gate-placeholder';
  process.env.DB_USER = process.env.DB_USER || 'asgard';
  process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm';
})();

const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const svc = require(path.join(ROOT, 'src/services/tkp-full-kp.js'));
const mirror = require(path.join(ROOT, 'tools/tkp_label_mirror.js'));

const TPL = path.join(ROOT, 'templates', 'full-kp-nika-tpl.docx');
const V1_FORM = path.join(ROOT, 'public/assets/js/tkp-full-form.js');

const log = [];
let fail = 0;
function check(label, ok, evidence) {
  if (!ok) fail++;
  log.push(`  [${ok ? 'OK' : '*** FAIL ***'}] ${label}${evidence ? ' — ' + evidence : ''}`);
}
function head(title) {
  log.push('');
  log.push('='.repeat(78));
  log.push(title);
  log.push('='.repeat(78));
}
const plain = (s) => String(s == null ? '' : s).replace(/\u00a0/g, ' ');
const money = (n) => plain(Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const num = (s) => Number(String(s).replace(/[\s\u00a0]/g, '').replace(',', '.'));

// ─── фикстуры ────────────────────────────────────────────────────────────────
// Легаси-payload: ключи, как в реальных записях БД (equipment/inventory_no/tube_data),
// table_labels отсутствует вовсе.
const POSITIONS = [
  { equipment: 'Гидропневматическая предпромывка', inventory_no: 'компл.', tube_data: 'L=200 м; Ø160', qty: '1 компл.', amount_no_vat: 1000000 },
  { equipment: 'Щелочная промывка', inventory_no: 'компл.', tube_data: 'L=200 м; Ø160', qty: '1 компл.', amount_no_vat: 1500000 },
  { equipment: 'Дезинфекция и дехлорирование', inventory_no: 'компл.', tube_data: 'V=9,4 м³', qty: '1 компл.', amount_no_vat: 250000 }
];
const TRANSPORT = 600000;
const TKP_LEGACY = {
  id: 9001, tkp_number: 'АС-9001', customer_name: 'ООО «ТЕСТ»', subject: 'Промывка сетей', validity_days: 30,
  items: { vat_pct: 22, full: { object_name: 'Объект', apparatus: POSITIONS, transport_amount: TRANSPORT } }
};
const TKP_OVERRIDE = {
  id: 9002, tkp_number: 'АС-9002', customer_name: 'ООО «ТЕСТ»', subject: 'Промывка сетей',
  items: {
    vat_pct: 22, full: {
      object_name: 'Объект', apparatus: POSITIONS, transport_amount: TRANSPORT,
      table_labels: {
        tbl_title: 'СВОЯ ШАПКА', col1: 'Работы', tbl_col5: 'Сумма, руб.',
        transport_label: 'Доставка на объект', tbl_col2: '   '
      }
    }
  }
};
const TKP_COLLISION = {
  id: 9003, tkp_number: 'АС-9003', customer_name: 'ООО «ТЕСТ»', subject: 'Промывка сетей',
  items: {
    vat_pct: 22, full: {
      apparatus: POSITIONS, transport_amount: TRANSPORT,
      table_labels: { section_title: 'Дружественное имя', tbl_title: 'Канон побеждает' }
    }
  }
};
const TKP_FOREIGN = {
  id: 9004, tkp_number: 'АС-9004', customer_name: 'ООО «ТЕСТ»', subject: 'Промывка сетей',
  items: {
    vat_pct: 22, full: {
      apparatus: POSITIONS, transport_amount: TRANSPORT,
      table_labels: { nonsense: 'нет такого плейсхолдера', tbl_col9: 'тоже нет', col_amount_typo: 'и это' }
    }
  }
};
const TKP_NEUTRAL = {
  id: 9005, tkp_number: 'АС-9005', customer_name: 'ООО «ТЕСТ»', subject: 'Монтаж',
  items: { vat_pct: 22, full: { apparatus: [{ name: 'Позиция по нейтральным ключам', unit: 'шт', details: 'L=10 м; Ø100', qty: '2', amount_no_vat: 1000 }] } }
};
const TKP_ESCAPE = {
  id: 9006, tkp_number: 'АС-9006', customer_name: 'ООО «ТЕСТ»', subject: 'Тест',
  items: { vat_pct: 22, full: { apparatus: POSITIONS, transport_amount: TRANSPORT, table_labels: { tbl_col1: 'A & B <C> "D"' } } }
};
// table_labels пришёл мусором (массив / строка) — рендер обязан выжить на дефолтах.
const TKP_JUNK_LABELS = {
  id: 9007, tkp_number: 'АС-9007', customer_name: 'ООО «ТЕСТ»', subject: 'Тест',
  items: { vat_pct: 22, full: { apparatus: POSITIONS, transport_amount: TRANSPORT, table_labels: ['мусор'] } }
};

function renderDocx(tkp) {
  const zip = new PizZip(fs.readFileSync(TPL));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  doc.render(svc.buildFullKpTemplateData(tkp));
  const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  const xml = new PizZip(buf).files['word/document.xml'].asText();
  const txt = xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  return { buf, xml, txt: plain(txt) };
}
function textHtml(tkp) {
  return plain(svc.buildFullKpHtml(tkp, { company: { name: 'ООО «АСГАРД-Сервис»', phone: '+7 499 322-30-62' } })
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '));
}

// ─── 0. Шаблон ───────────────────────────────────────────────────────────────
head('0. ШАБЛОН templates/full-kp-nika-tpl.docx');
const tplXml = new PizZip(fs.readFileSync(TPL)).files['word/document.xml'].asText();
const PH = ['tbl_title', 'tbl_col1', 'tbl_col2', 'tbl_col3', 'tbl_col4', 'tbl_col5', 'tbl_transport_label'];
for (const ph of PH) check(`плейсхолдер {${ph}} в шаблоне`, tplXml.includes('{' + ph + '}'));
for (const bad of ['ПО АППАРАТАМ', 'Инвентарный', 'трубкам', 'аппарат']) {
  check(`в шаблоне нет старого литерала «${bad}»`, !tplXml.includes(bad));
}
for (const internal of ['себестоимост', 'прибыл', 'наценк', 'маржинальн', 'рентабельн']) {
  check(`в шаблоне нет внутреннего слова «${internal}»`, !new RegExp(internal, 'i').test(tplXml));
}

// ─── 1. Совместимость: ТКП без table_labels ──────────────────────────────────
head('1. ТКП БЕЗ ПЕРЕОПРЕДЕЛЕНИЙ (старые записи в БД) — печатается прежняя шапка');
const r1 = renderDocx(TKP_LEGACY);
const D = svc.TABLE_LABELS_DEFAULT;
const html1 = textHtml(TKP_LEGACY);
for (const [key, val] of Object.entries(D)) {
  const inDocx = r1.txt.includes(val);
  const inHtml = html1.includes(val);
  check(`дефолт ${key} = «${val}» в DOCX + HTML`, inDocx && inHtml,
    [inDocx ? 'DOCX' : null, inHtml ? 'HTML' : null].filter(Boolean).join(' + ') || 'нет ни там, ни там');
}
check('в DOCX не осталось нераскрытых плейсхолдеров', !/\{[a-z_][\w]*\}/i.test(r1.txt),
  (r1.txt.match(/\{[a-z_][\w]*\}/i) || ['нет'])[0]);
check('в DOCX нет следов бывшей вилки шаблонов (template_kind)', !r1.txt.includes('template_kind'));
for (const p of POSITIONS) {
  check(`позиция напечатана целиком: «${p.equipment}»`, r1.txt.includes(p.equipment) && r1.txt.includes(p.tube_data));
}
check('транспортная строка берёт подпись из шапки', r1.txt.includes(D.tbl_transport_label) && r1.txt.includes(money(TRANSPORT)));

head('1б. АРИФМЕТИКА (НДС 22 %, NBSP)');
const d1 = svc.buildFullKpTemplateData(TKP_LEGACY);
const posSum = POSITIONS.reduce((s, r) => s + r.amount_no_vat, 0);
const expSub = posSum + TRANSPORT;
const expVat = Math.round(expSub * 22) / 100;
const expTot = expSub + expVat;
check('subtotal = позиции + транспорт', Math.abs(num(d1.subtotal) - expSub) < 0.005, `${d1.subtotal} = ${posSum} + ${TRANSPORT}`);
check('НДС 22 % посчитан от subtotal', Math.abs(num(d1.vat_sum) - expVat) < 0.005, `${d1.vat_sum} vs ${money(expVat)}`);
check('итого = subtotal + НДС', Math.abs(num(d1.total) - expTot) < 0.005, `${d1.total} vs ${money(expTot)}`);
check('в печатной форме стоит итог с НДС и разделители разрядов', r1.txt.includes(money(expTot)), money(expTot));
check('итог без НДС напечатан', r1.txt.includes(money(expSub)), money(expSub));

// ─── 2. Переопределения ──────────────────────────────────────────────────────
head('2. ПЕРЕОПРЕДЕЛЕНИЕ ЧЕРЕЗ items.full.table_labels');
const r2 = renderDocx(TKP_OVERRIDE);
const over = TKP_OVERRIDE.items.full.table_labels;
check('заголовок раздела переопределён', r2.txt.includes(over.tbl_title) && !r2.txt.includes(D.tbl_title));
check('канонический ключ колонки переопределён', r2.txt.includes(over.tbl_col5) && !r2.txt.includes(D.tbl_col5));
check('дружественный алиас col1 переопределил колонку 1', r2.txt.includes(over.col1) && !r2.txt.includes(D.tbl_col1));
check('подпись транспорта переопределена', r2.txt.includes(over.transport_label));
check('НЕпереопределённые колонки остались дефолтными',
  r2.txt.includes(D.tbl_col3) && r2.txt.includes(D.tbl_col4), `${D.tbl_col3} | ${D.tbl_col4}`);
check('пробельное значение = дефолт (не пустили пустую подпись)',
  r2.txt.includes(D.tbl_col2), `tbl_col2=${JSON.stringify(over.tbl_col2)} → «${D.tbl_col2}»`);

const rc = renderDocx(TKP_COLLISION);
check('коллизия: канонический tbl_title побеждает дружественное section_title',
  rc.txt.includes('Канон побеждает') && !rc.txt.includes('Дружественное имя'));

const rf = renderDocx(TKP_FOREIGN);
check('чужие ключи игнорируются, шапка остаётся дефолтной',
  Object.values(D).every((v) => rf.txt.includes(v)));
check('чужие ключи не напечатались', !rf.txt.includes('нет такого плейсхолдера'));

const rj = renderDocx(TKP_JUNK_LABELS);
check('table_labels-мусор (массив) не ломает рендер', Object.values(D).every((v) => rj.txt.includes(v)) && rj.buf.length > 10000);

const re = renderDocx(TKP_ESCAPE);
check('спецсимволы в подписи не превращаются в разметку',
  re.txt.includes('A & B <C> "D"') && !re.xml.includes('<C>'), 'raw тега <C> в XML нет');
check('экранирование в XML корректное', re.xml.includes('A &amp; B &lt;C&gt;'));

const rn = renderDocx(TKP_NEUTRAL);
check('нейтральные ключи позиции (name/unit/details) печатаются',
  rn.txt.includes('Позиция по нейтральным ключам') && rn.txt.includes('L=10 м; Ø100'));

// ─── 3. Зеркало дефолтов в трёх файлах ───────────────────────────────────────
head('3. ДЕФОЛТЫ: сервис ↔ форма v1 (прод) ↔ форма v2 (/v2/) — сверка ПО КЛЮЧАМ');
const cmp = mirror.compare(ROOT);
check('источник истины разобран в src/services/tkp-full-kp.js', !!cmp.truth && Object.keys(cmp.truth).length === PH.length,
  cmp.truth ? `${Object.keys(cmp.truth).length} ключей` : 'не разобрал');
check('рантайм-дефолты сервиса == разобранный литерал',
  JSON.stringify(svc.TABLE_LABELS_DEFAULT) === JSON.stringify(cmp.truth));
for (const row of cmp.rows) {
  check(`зеркало ${row.name} (${row.rel})`, row.ok, row.notes.join('; ') || 'совпадает по всем ключам');
}
check('заголовок раздела капсом (как соседние разделы шаблона)',
  D.tbl_title === D.tbl_title.toUpperCase(), D.tbl_title);

// Мутация в памяти: сверка обязана покраснеть, иначе гейт тавтологичен.
const mutated = mirror.collect(ROOT).map((s) =>
  s.name === 'v2 react' ? { ...s, defaults: { ...s.defaults, tbl_col1: 'СЛОМАНО-МУТАЦИЕЙ' } } : s);
const mutRes = mirror.compareSources(mutated);
check('mutation-самопроверка: подмена дефолта v2 краснит сверку',
  mutRes.problems.some((p) => p.includes('СЛОМАНО-МУТАЦИЕЙ')), mutRes.problems[0] || 'сверка НЕ заметила подмену');

// ─── 4. Форма v1 (она обслуживает прод-страницу /#/tkp) ─────────────────────
head('4. ФОРМА v1 VANILLA — переопределение подписей достижимо из прода');
const v1 = fs.readFileSync(V1_FORM, 'utf8');
for (const needle of ['TABLE_LABEL_DEFAULTS', 'resolveTblLabels', 'tblLabelsInputsHtml', 'collectTblLabels', 'LBL_TO_ROWCLASS']) {
  check(`в v1 есть ${needle}`, v1.includes(needle));
}
check('в v1 есть блок UI «Шапка таблицы» (кнопка + поля)',
  v1.includes('fullTblLabelsToggle') && v1.includes('fullTblLabels') && v1.includes('data-lbl'));
check('в v1 подсказки позиций берутся из действующих подписей, а не хардкодятся',
  /placeholder="'\s*\+\s*esc\(L\.tbl_col1\)/.test(v1) || v1.includes('esc(L.tbl_col1)'));

// ─── итог ────────────────────────────────────────────────────────────────────
log.push('');
log.push(fail === 0
  ? `ИТОГ: ГОТОВО — ${log.filter((l) => l.includes('[OK]')).length} проверок пройдено, 0 провалов`
  : `ИТОГ: FAIL — ${fail} провал(ов)`);
process.stdout.write(log.join('\n') + '\n');
process.exit(fail === 0 ? 0 : 1);
