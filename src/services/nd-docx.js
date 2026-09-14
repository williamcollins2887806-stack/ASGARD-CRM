'use strict';

/**
 * ND DOCX — tabular OOXML blanks aligned with constructor blocks.
 */

const PizZip = require('pizzip');
const { isBlockEnabled, normalizeSectionsJson } = require('../lib/nd-blocks');

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function para(text, opts = {}) {
  const bold = opts.bold ? '<w:b/>' : '';
  const size = opts.size || 20;
  const align = opts.center ? '<w:jc w:val="center"/>' : '';
  const highlight = opts.yellow ? '<w:highlight w:val="yellow"/>' : '';
  const shd = opts.yellow ? '<w:shd w:val="clear" w:color="auto" w:fill="FFF2A8"/>' : '';
  const lines = String(text == null ? '' : text).split(/\n/);
  return lines
    .map((line) => {
      const t = escXml(line || ' ');
      return `<w:p><w:pPr>${align}${shd}<w:spacing w:after="40"/></w:pPr><w:r><w:rPr>${bold}${highlight}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    })
    .join('');
}

function cell(text, opts = {}) {
  const bold = opts.bold ? '<w:b/>' : '';
  const size = opts.size || 18;
  const yellow = opts.yellow;
  const fill = yellow ? 'FFF2A8' : opts.header ? 'E8E0D0' : 'FFFFFF';
  const width = opts.w || 2000;
  const t = escXml(text == null || text === '' ? ' ' : text);
  return `<w:tc>
    <w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/><w:tcBorders>
      <w:top w:val="single" w:sz="4" w:color="666666"/><w:left w:val="single" w:sz="4" w:color="666666"/>
      <w:bottom w:val="single" w:sz="4" w:color="666666"/><w:right w:val="single" w:sz="4" w:color="666666"/>
    </w:tcBorders></w:tcPr>
    <w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr>${bold}${yellow ? '<w:highlight w:val="yellow"/>' : ''}<w:sz w:val="${size}"/><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>
  </w:tc>`;
}

function table(headers, rows, colWidths) {
  const widths = colWidths || headers.map(() => Math.floor(9000 / headers.length));
  const hdr = `<w:tr>${headers.map((h, i) => cell(h, { bold: true, header: true, w: widths[i] })).join('')}</w:tr>`;
  const body = (rows.length ? rows : [headers.map(() => '')]).map(
    (row) =>
      `<w:tr>${row
        .map((c, i) => cell(c, { yellow: true, w: widths[i] }))
        .join('')}</w:tr>`
  );
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${hdr}${body.join('')}</w:tbl>`;
}

function fmtDt(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusRu(s) {
  return (
    {
      draft: 'ЧЕРНОВИК',
      issued: 'УТВЕРЖДЁН',
      active: 'ДЕЙСТВУЕТ',
      extended: 'ПРОДЛЁН',
      closed: 'ЗАКРЫТ',
      cancelled: 'АННУЛИРОВАН',
    }[s] || s
  );
}

function sectionTitle(n, title) {
  return para(`${n}. ${title}`, { bold: true, size: 22 });
}

function buildDocumentXml(permit) {
  const schema =
    (permit.template_snapshot && permit.template_snapshot.schema_json) ||
    permit.schema_json ||
    {};
  const sections = normalizeSectionsJson(permit.sections_json, schema);
  const on = (id) => isBlockEnabled(sections, id);

  const parts = [];
  parts.push(para('НАРЯД-ДОПУСК № ' + (permit.number || 'б/н'), { bold: true, size: 28, center: true }));
  parts.push(para(permit.form_title || permit.form_code, { bold: true, size: 22, center: true }));
  parts.push(para(permit.legal_basis || '', { size: 16, center: true }));
  parts.push(para('Статус: ' + statusRu(permit.status), { bold: true, size: 18, center: true }));
  parts.push(para(''));
  parts.push(para(`Организация: ООО «АСГАРД-СЕРВИС»`, { size: 18 }));
  parts.push(
    para(
      `Объект / работа: ${permit.customer_name || '—'} · ${permit.work_title || ''} (${permit.work_number || permit.work_id})`,
      { size: 18 }
    )
  );

  let n = 0;
  const next = () => {
    n += 1;
    return n;
  };

  if (on('persons')) {
    parts.push(sectionTitle(next(), 'Ответственные лица'));
    const rows = (sections.persons || []).map((p) => [p.role || '', p.fio || '', p.note || '']);
    while (rows.length < 4) rows.push(['', '', '']);
    parts.push(table(['Роль', 'ФИО', 'Примечание'], rows, [2200, 4000, 2800]));
    parts.push(para(''));
  }

  if (on('work')) {
    parts.push(sectionTitle(next(), 'Место производства работ'));
    parts.push(
      para(
        permit.work_place ||
          [permit.object_name, permit.city, permit.address].filter(Boolean).join(', ') ||
          '—',
        { yellow: true }
      )
    );
    parts.push(sectionTitle(next(), 'Содержание и объём работ'));
    parts.push(para(permit.work_content || '—', { yellow: true }));
    parts.push(para(''));
  }

  if (on('dates')) {
    parts.push(sectionTitle(next(), 'Сроки'));
    parts.push(
      table(
        ['Начать', 'Окончить'],
        [[fmtDt(permit.starts_at), fmtDt(permit.ends_at)]],
        [4500, 4500]
      )
    );
    parts.push(para(''));
  }

  if (on('crew')) {
    parts.push(sectionTitle(next(), 'Состав бригады'));
    const rows = (permit.crew || []).map((c, i) => [
      String(i + 1),
      c.fio || '',
      c.profession || '',
      c.role_in_permit || 'member',
    ]);
    if (!rows.length) rows.push(['', '', '', '']);
    parts.push(table(['№', 'ФИО', 'Профессия / разряд', 'Роль'], rows, [600, 3400, 3000, 2000]));
    parts.push(para(''));
  }

  if (on('equipment')) {
    parts.push(sectionTitle(next(), 'Оборудование и материалы'));
    const rows = (permit.equipment || []).map((e, i) => [
      String(i + 1),
      e.name || '',
      e.qty || '1',
      e.note || '',
    ]);
    if (!rows.length) rows.push(['', '', '', '']);
    parts.push(table(['№', 'Наименование', 'Кол-во', 'Примечание'], rows, [600, 4200, 1200, 3000]));
    parts.push(para(''));
  }

  if (on('prep')) {
    parts.push(sectionTitle(next(), 'Мероприятия по подготовке рабочего места'));
    const rows = (sections.prep || []).map((p, i) => [
      String(i + 1),
      p.title || p.text || '',
      p.done ? 'да' : '',
    ]);
    while (rows.length < 3) rows.push([String(rows.length + 1), '', '']);
    parts.push(table(['№', 'Мероприятие', 'Выполнено'], rows, [600, 7000, 1400]));
    parts.push(para(''));
  }

  if (on('loto')) {
    parts.push(sectionTitle(next(), 'Отключения и блокировки'));
    const rows = (sections.loto || []).map((p, i) => [
      String(i + 1),
      p.device || '',
      p.action || '',
      p.lock || '',
    ]);
    while (rows.length < 2) rows.push(['', '', '', '']);
    parts.push(table(['№', 'Оборудование', 'Отключение', 'Блокировка'], rows, [600, 3000, 3000, 2400]));
    parts.push(para(''));
  }

  if (on('height_gear')) {
    parts.push(sectionTitle(next(), 'СИЗ от падения / анкерные точки'));
    const rows = (sections.height_gear || []).map((p, i) => [
      String(i + 1),
      p.item || '',
      p.anchor || '',
      p.note || '',
    ]);
    while (rows.length < 2) rows.push(['', '', '', '']);
    parts.push(table(['№', 'СИЗ / система', 'Анкер', 'Примечание'], rows, [600, 3200, 2600, 2600]));
    parts.push(para(''));
  }

  if (on('risks')) {
    parts.push(sectionTitle(next(), 'Опасные факторы и компенсирующие мероприятия'));
    const rows = (permit.risks || []).map((r, i) => {
      const measures = (r.measure_titles || []).join('; ') || '—';
      const closed = r.closure && r.closure.is_closed ? 'закрыт' : 'открыт';
      return [String(i + 1), r.risk_title || '', measures, closed];
    });
    if (!rows.length) rows.push(['', '', '', '']);
    parts.push(table(['№', 'Опасный фактор', 'Мероприятия', 'Статус'], rows, [600, 2800, 4400, 1200]));
    parts.push(para(''));
  }

  if (on('gas_analysis')) {
    parts.push(sectionTitle(next(), 'Анализ газовоздушной среды'));
    const rows = (sections.gas_analysis || []).map((g) => [
      g.at || '',
      g.place || '',
      g.component || '',
      g.value || '',
      g.fio || '',
    ]);
    while (rows.length < 2) rows.push(['', '', '', '', '']);
    parts.push(
      table(['Дата/время', 'Место', 'Компонент', 'Значение', 'ФИО'], rows, [1800, 2000, 1800, 1400, 2000])
    );
    parts.push(para(''));
  }

  if (on('fire_watch')) {
    parts.push(sectionTitle(next(), 'Постовой огневой охраны'));
    const fw = sections.fire_watch || {};
    parts.push(
      table(
        ['Постовой (ФИО)', 'Средства тушения', 'Наблюдение после работ'],
        [[fw.person || '', fw.extinguishers || '', fw.watch_hours || '']],
        [3000, 3000, 3000]
      )
    );
    parts.push(para(''));
  }

  if (on('atmosphere')) {
    parts.push(sectionTitle(next(), 'Контроль атмосферы ОЗП'));
    const rows = (sections.atmosphere || []).map((a) => [
      a.at || '',
      a.o2 || '',
      a.lel || '',
      a.co || '',
      a.h2s || '',
      a.fio || '',
    ]);
    while (rows.length < 2) rows.push(['', '', '', '', '', '']);
    parts.push(table(['Время', 'O₂ %', 'LEL %', 'CO', 'H₂S', 'ФИО'], rows, [1500, 1200, 1200, 1200, 1200, 2700]));
    parts.push(para(''));
  }

  if (on('ppe')) {
    parts.push(sectionTitle(next(), 'СИЗ'));
    parts.push(para(permit.ppe_text || '—', { yellow: true }));
    parts.push(para(''));
  }

  if (on('emergency')) {
    parts.push(sectionTitle(next(), 'Действия при аварии'));
    parts.push(para(permit.emergency_text || '—', { yellow: true }));
    parts.push(para(''));
  }

  if (on('daily')) {
    parts.push(sectionTitle(next(), 'Ежедневный допуск к работе'));
    const fromDb = (permit.daily || []).map((d) => [
      fmtDt(d.work_date || d.started_at),
      fmtDt(d.started_at),
      fmtDt(d.ended_at),
      d.producer_name || '',
      d.admitter_name || '',
    ]);
    const fromSec = (sections.daily_rows || []).map((d) => [
      d.date || '',
      d.start || '',
      d.end || '',
      d.producer || '',
      d.admitter || '',
    ]);
    const rows = fromDb.length ? fromDb : fromSec;
    while (rows.length < 2) rows.push(['', '', '', '', '']);
    parts.push(
      table(['Дата', 'Начало', 'Окончание', 'Производитель', 'Допускающий'], rows, [
        1600, 1600, 1600, 2100, 2100,
      ])
    );
    parts.push(para(''));
  }

  if (on('extension')) {
    parts.push(sectionTitle(next(), 'Продление наряда'));
    const fromDb = (permit.extensions || []).map((e) => [
      fmtDt(e.requested_until),
      e.status || '',
      e.decision_note || '',
    ]);
    const fromSec = (sections.extension_rows || []).map((e) => [
      e.until || '',
      e.status || '',
      e.note || '',
    ]);
    const rows = fromDb.length ? fromDb : fromSec;
    while (rows.length < 1) rows.push(['', '', '']);
    parts.push(table(['Продлить до', 'Статус', 'Примечание'], rows, [3000, 2400, 3600]));
    parts.push(para(''));
  }

  if (on('acks')) {
    parts.push(sectionTitle(next(), 'Ознакомление бригады'));
    const fromDb = (permit.acks || []).map((a) => [a.fio || '', fmtDt(a.ack_at), '']);
    const fromSec = (sections.acks_rows || []).map((a) => [a.fio || '', a.at || '', a.sign || '']);
    const rows = fromDb.length ? fromDb : fromSec;
    while (rows.length < 3) rows.push(['', '', '']);
    parts.push(table(['ФИО', 'Дата/время', 'Подпись'], rows, [4000, 2500, 2500]));
    parts.push(para(''));
  }

  if (on('closing')) {
    parts.push(sectionTitle(next(), 'Закрытие наряда / сдача рабочего места'));
    const cl = sections.closing || {};
    parts.push(
      table(
        ['Работы окончены', 'РМ сдано', 'Примечание'],
        [[cl.finished_at || fmtDt(permit.closed_at) || '', cl.handed_over || '', cl.note || '']],
        [3000, 3000, 3000]
      )
    );
    parts.push(para(''));
  }

  parts.push(para('Оформление', { bold: true, size: 22 }));
  parts.push(para(`Создал (РП): ${permit.created_by_name || '—'}`, { yellow: true }));
  parts.push(
    para(`Утвердил (мастер): ${permit.issued_by_name || '—'} / ${fmtDt(permit.issued_at)}`, {
      yellow: true,
    })
  );
  parts.push(para(''));
  parts.push(
    para(
      'Документ сформирован ASGARD CRM. Жёлтые ячейки — редактируемые поля бланка.',
      { size: 14 }
    )
  );

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${parts.join('')}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>
  </w:body>
</w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

function buildPermitDocx(permit) {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels').file('.rels', RELS);
  zip.folder('word').file('document.xml', buildDocumentXml(permit));
  zip.folder('word').folder('_rels').file('document.xml.rels', DOC_RELS);
  return zip.generate({ type: 'nodebuffer' });
}

function filenameFor(permit) {
  const num = String(permit.number || permit.id || 'draft').replace(/[^\w\-А-Яа-яЁё]+/g, '_');
  return `Naryad_${num}.docx`;
}

module.exports = { buildPermitDocx, filenameFor, statusRu, fmtDt, buildDocumentXml };
