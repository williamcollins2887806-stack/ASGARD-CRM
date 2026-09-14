/**
 * ND Word QA matrix — локально, без прода.
 * Синтетические permits (не требует полной БД). Пишет 10 docx + report.json.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const { buildPermitDocx } = require('../src/services/nd-docx');
const { normalizeSectionsJson, defaultEnabledBlocks } = require('../src/lib/nd-blocks');

const OUT = path.join(__dirname, 'reports', 'nd-docx-qa');

const FORMS = [
  {
    code: '924n_rpo',
    title: 'Наряд-допуск на работы повышенной опасности (924н)',
    legal_basis: 'Приказ Минтруда РФ от 11.12.2020 № 924н',
    blocks: [
      'persons', 'work', 'dates', 'crew', 'equipment', 'prep', 'risks', 'ppe', 'emergency',
      'daily', 'extension', 'acks', 'closing', 'loto',
    ],
  },
  {
    code: '528_gas',
    title: 'Наряд-допуск на газоопасные работы (ФНП 528)',
    legal_basis: 'Приказ Ростехнадзора от 15.12.2020 № 528',
    blocks: [
      'persons', 'work', 'dates', 'crew', 'equipment', 'prep', 'risks', 'gas_analysis',
      'ppe', 'emergency', 'daily', 'extension', 'acks', 'closing',
    ],
  },
  {
    code: '528_fire',
    title: 'Наряд-допуск на огневые работы (ФНП 528)',
    legal_basis: 'Приказ Ростехнадзора от 15.12.2020 № 528',
    blocks: [
      'persons', 'work', 'dates', 'crew', 'equipment', 'prep', 'risks', 'fire_watch',
      'ppe', 'emergency', 'daily', 'extension', 'acks', 'closing',
    ],
  },
  {
    code: '528_repair',
    title: 'Наряд-допуск на ремонтные работы (ФНП 528)',
    legal_basis: 'Приказ Ростехнадзора от 15.12.2020 № 528',
    blocks: [
      'persons', 'work', 'dates', 'crew', 'equipment', 'prep', 'risks', 'ppe', 'emergency',
      'daily', 'extension', 'acks', 'closing',
    ],
  },
  {
    code: 'ozp',
    title: 'Наряд-допуск на работы в ОЗП',
    legal_basis: 'Правила работ в ограниченных и замкнутых пространствах',
    blocks: [
      'persons', 'work', 'dates', 'crew', 'equipment', 'prep', 'risks', 'atmosphere',
      'ppe', 'emergency', 'daily', 'extension', 'acks', 'closing',
    ],
  },
];

function schemaOf(form) {
  return {
    blocks: form.blocks.map((id) => ({
      id,
      title: id,
      default_on: !['daily'].includes(id),
    })),
    default_risk_codes: [],
  };
}

function sampleSections(schema, mode) {
  const enabled =
    mode === 'full'
      ? defaultEnabledBlocks(schema)
      : ['persons', 'work', 'dates', 'crew', 'risks', 'ppe', 'emergency'].filter((id) =>
          (schema.blocks || []).some((b) => b.id === id)
        );
  const base = normalizeSectionsJson({ enabled_blocks: enabled }, schema);
  if (mode === 'full') {
    base.persons = [
      { role: 'Выдающий', fio: 'Иванов И.И.', note: 'РП' },
      { role: 'Производитель', fio: 'Петров П.П.', note: '' },
    ];
    base.prep = [{ title: 'Отключить насос', done: true }];
    base.gas_analysis = [
      { at: '04.09.2026 09:00', place: 'люк', component: 'O2', value: '20.9%', fio: 'Сидоров' },
    ];
    base.fire_watch = {
      person: 'Козлов К.К.',
      extinguishers: 'ОП-5 ×2',
      watch_hours: '2 ч',
    };
    base.atmosphere = [{ at: '09:10', o2: '20.8', lel: '0', co: '0', h2s: '0', fio: 'Сидоров' }];
    base.loto = [{ device: 'Щит ЩР-1', action: 'Откл. QF1', lock: 'Замок №12' }];
    base.daily_rows = [{ date: '04.09', start: '08:00', end: '17:00', producer: 'Петров', admitter: 'Сидоров' }];
    base.extension_rows = [{ until: '11.09.2026', status: 'заявка', note: '' }];
    base.acks_rows = [{ fio: 'Рабочий 1', at: '08:05', sign: '' }];
    base.closing = { finished_at: '', handed_over: '', note: '' };
  }
  return base;
}

function makePermit(form, mode) {
  const schema = schemaOf(form);
  const sections = sampleSections(schema, mode);
  return {
    id: `qa_${form.code}_${mode}`,
    number: `QA-${form.code}-${mode}`,
    status: 'draft',
    form_code: form.code,
    form_title: form.title,
    legal_basis: form.legal_basis,
    work_content: `QA ${mode}: контрольная выгрузка бланка ${form.code}`,
    work_place: 'Площадка QA, корпус А',
    ppe_text: 'Каска, очки, перчатки, спецобувь',
    emergency_text: 'Остановить работы, сообщить допускающему',
    starts_at: new Date('2026-09-04T08:00:00'),
    ends_at: new Date('2026-09-07T17:00:00'),
    sections_json: sections,
    schema_json: schema,
    template_snapshot: { schema_json: schema, code: form.code, title: form.title },
    crew: [
      { fio: 'Петров П.П.', profession: 'слесарь', role_in_permit: 'producer' },
      { fio: 'Сидоров С.С.', profession: 'мастер', role_in_permit: 'admitter' },
    ],
    equipment: [{ name: 'Насос переносной', qty: '1', note: '' }],
    risks: [
      {
        risk_title: 'Химический ожог',
        measure_titles: ['СИЗ', 'Промывка водой'],
        measure_ids: [1, 2],
        closure: { is_closed: false },
      },
      {
        risk_title: 'Пожар / воспламенение',
        measure_titles: ['Огнетушитель', 'Постовой'],
        measure_ids: [3],
        closure: { is_closed: false },
      },
    ],
    customer_name: 'QA Customer',
    work_title: 'QA работа',
    work_number: 'QA-100',
    work_id: 1,
    object_name: 'Объект QA',
    city: 'Кировск',
    address: 'ул. Тестовая 1',
    created_by_name: 'QA РП',
  };
}

function assertXml(xml, form, mode, sections) {
  const checks = {
    has_table: xml.includes('<w:tbl>'),
    has_title: xml.includes('НАРЯД-ДОПУСК'),
    yellow: xml.includes('FFF2A8'),
    fixed_layout: xml.includes('tblLayout'),
    crew: xml.includes('Петров'),
    risks: xml.includes('Химический ожог'),
  };
  if (mode === 'full' && sections.enabled_blocks.includes('gas_analysis')) {
    checks.gas = /газовоздушн|Анализ ГВС|Анализ газо/i.test(xml);
  }
  if (mode === 'full' && sections.enabled_blocks.includes('fire_watch')) {
    checks.fire = /Постовой огневой|огневой охраны/i.test(xml);
  }
  if (mode === 'full' && sections.enabled_blocks.includes('atmosphere')) {
    checks.atm = /атмосфер|O₂|ОЗП/i.test(xml);
  }
  if (mode === 'minimal') {
    checks.no_gas_when_off =
      !sections.enabled_blocks.includes('gas_analysis') || !/газовоздушн/i.test(xml);
  }
  return checks;
}

fs.mkdirSync(OUT, { recursive: true });
const report = [];

for (const form of FORMS) {
  for (const mode of ['full', 'minimal']) {
    const permit = makePermit(form, mode);
    const buf = buildPermitDocx(permit);
    const name = `qa_${form.code}_${mode}.docx`;
    fs.writeFileSync(path.join(OUT, name), buf);
    const xml = new PizZip(buf).file('word/document.xml').asText();
    const checks = assertXml(xml, form, mode, permit.sections_json);
    report.push({ file: name, form: form.code, mode, size: buf.length, ...checks });
    const ok = checks.has_table && checks.has_title && checks.yellow && buf.length > 2500;
    console.log(ok ? 'OK' : 'FAIL', name, buf.length, Object.entries(checks).filter(([, v]) => v === false).map(([k]) => k));
  }
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

// Visual kit reference page (open in browser for screenshots)
const kitHtml = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"/>
<title>ND Control Kit — visual gate</title>
<link rel="stylesheet" href="../../../public/assets/css/design-tokens.css"/>
<link rel="stylesheet" href="../../../public/assets/css/nd-permits.css"/>
<style>body{margin:0;padding:24px;background:#0a0e14;color:#e8eef7;font-family:system-ui,sans-serif}
h1{font-size:18px;color:#f5e6c8} .row{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0;align-items:center}
.panel{background:#080c11;border:1px solid rgba(212,168,67,.35);border-radius:12px;padding:16px;max-width:480px}
</style></head><body>
<div class="nd-hazard" style="max-width:320px"></div>
<h1>ND Control Kit — visual gate</h1>
<div class="panel">
  <div class="row">
    <button class="nd-btn nd-btn-primary">Primary</button>
    <button class="nd-btn nd-btn-secondary">Secondary</button>
    <button class="nd-btn nd-btn-ghost">Ghost</button>
    <button class="nd-btn nd-btn-danger">Удалить</button>
  </div>
  <label class="nd-lbl">Input</label>
  <input class="nd-field" placeholder="Текст поля"/>
  <label class="nd-lbl">Select</label>
  <select class="nd-select"><option>528_fire</option><option>528_gas</option></select>
  <label class="nd-lbl">Datetime</label>
  <input type="datetime-local" class="nd-field" value="2026-09-04T09:00"/>
  <div class="row" style="margin-top:12px">
    <label class="nd-check"><input type="checkbox" checked/><span class="nd-check-box"></span><span>Риск включён</span></label>
  </div>
  <div class="nd-switch-row">
    <div><div class="nd-switch-title">Газоанализ</div><div class="nd-switch-hint">Блок бланка</div></div>
    <label class="nd-switch"><input type="checkbox" checked/><span class="nd-switch-track"></span></label>
  </div>
  <div class="nd-acc open" style="margin-top:10px">
    <div class="nd-acc-h">
      <label class="nd-check"><input type="checkbox" checked/><span class="nd-check-box"></span><span class="nd-acc-title">Пожар / воспламенение</span></label>
      <span class="nd-acc-count">2 меры</span><span class="nd-acc-chev">▸</span>
    </div>
    <div class="nd-acc-b">
      <label class="nd-check"><input type="checkbox" checked/><span class="nd-check-box"></span><span>Огнетушитель в зоне</span></label>
      <label class="nd-check"><input type="checkbox"/><span class="nd-check-box"></span><span>Постовой</span></label>
    </div>
  </div>
  <div class="nd-chips" style="margin-top:10px"><span class="nd-chip">Иванов И.И. <button>×</button></span></div>
</div>
<p style="color:#7d8798;font-size:12px;margin-top:16px">Скриншотить эту панель для visual gate. Файлы Word: tests/reports/nd-docx-qa/</p>
</body></html>`;
fs.writeFileSync(path.join(OUT, 'control-kit-preview.html'), kitHtml);

const failed = report.filter((r) => !r.has_table || !r.has_title || !r.yellow || r.size < 2500);
if (failed.length) {
  console.error('Matrix FAIL', failed);
  process.exit(1);
}
console.log('Matrix PASS:', report.length, '→', OUT);
