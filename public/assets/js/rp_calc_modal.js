/**
 * RP Calc Modal — просчёт (vanilla desktop)
 * window.AsgardRpCalcModal = { open, openDemo, buildEmailPreviewHtml, renderSmetaTableHtml }
 */
window.AsgardRpCalcModal = (function () {
  'use strict';

  const UI = window.AsgardUI || {};
  const esc = UI.esc || function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  const toast = UI.toast || function () {};
  const showModal = UI.showModal || function () {};
  const hideModal = UI.hideModal || UI.closeModal || function () {};
  const replaceModal = UI.replaceModal || null;

  const TABS = [
    { id: 'inputs', label: 'Вводные' },
    { id: 'smeta', label: 'Смета' },
    { id: 'files', label: 'Файлы' },
    { id: 'tender', label: 'Тендер' }
  ];

  const PCT_KEYS = { fot_tax: 1, overhead: 1, contingency: 1, consumables_pct: 1, vat: 1 };
  const SMETA_UNITS = [
    'чел·смен', 'чел', 'чел·дн', 'чел·ночь', 'чел·поездка',
    'компл', 'рейс', 'шт', 'сут', 'дн', 'смен', 'усл.'
  ];
  const DEFAULT_DIRECTOR_ACTION = 'Согласовать цену и подачу тендера — или отклонить с комментарием';

  function pctLabel(fraction) {
    const n = Number(fraction);
    if (!Number.isFinite(n)) return '';
    const pct = Math.round(n * 1000) / 10;
    return Number.isInteger(pct) ? String(Math.round(pct)) : String(pct);
  }

  function unitSelectHtml(current) {
    const cur = String(current || '').trim();
    const opts = SMETA_UNITS.slice();
    if (cur && opts.indexOf(cur) < 0) opts.unshift(cur);
    return '<select class="rp-calc-unit" data-fld="unit" title="Единица измерения">' +
      opts.map(function (u) {
        return '<option value="' + esc(u) + '"' + (u === cur ? ' selected' : '') + '>' + esc(u) + '</option>';
      }).join('') +
      '</select>';
  }

  function rollupDisplayName(r, params) {
    const p = params || {};
    if (r.sumExpr === 'fot_tax') {
      return 'Налог / взносы на ФОТ (' + pctLabel(p.fot_tax != null ? p.fot_tax : 0.55) + '%)';
    }
    if (r.sumExpr === 'overhead') {
      return 'Накладные расходы (' + pctLabel(p.overhead != null ? p.overhead : 0) + '%)';
    }
    if (r.sumExpr === 'contingency') {
      return 'Непредвиденные (' + pctLabel(p.contingency != null ? p.contingency : 0) + '%)';
    }
    return r.name || '';
  }

  // Адресное согласование: ровно 4 получателя, минимум один. Порог — 10 млн без НДС.
  const DIRECTOR_THRESHOLD = 10000000;
  const APPROVAL_RECIPIENTS = [
    { code: 'DIRECTOR_GEN', label: 'Генеральный директор' },
    { code: 'DIRECTOR_DEV', label: 'Директор по развитию' },
    { code: 'DIRECTOR_COMM', label: 'Коммерческий директор' },
    { code: 'HEAD_TO', label: 'Рук. тендерного отдела (Хосе)' }
  ];

  function recipientLabelByCode(code) {
    const f = APPROVAL_RECIPIENTS.filter(function (x) { return x.code === code; })[0];
    return f ? f.label : code;
  }

  /* ── helpers ───────────────────────────────────────────── */

  function fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (UI.moneyRub) return UI.moneyRub(n);
    if (window.AsgardMoney && AsgardMoney.formatMoney) return AsgardMoney.formatMoney(n);
    return Math.round(n).toLocaleString('ru-RU') + ' ₽';
  }

  function fmtDate(v) {
    if (!v) return '—';
    const s = String(v).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + '.' + m[2] + '.' + m[1] : s;
  }

  function authToken() {
    try {
      if (window.AsgardAuth && typeof AsgardAuth.getAuth === 'function') {
        const a = AsgardAuth.getAuth();
        if (a && a.token) return a.token;
      }
    } catch (_) { /* ignore */ }
    return localStorage.getItem('asgard_token') || localStorage.getItem('auth_token') || '';
  }

  function api() {
    return window.AsgardRegistryApi || null;
  }

  function loadRpReview(tenderId) {
    const A = api();
    if (A && typeof A.getRpReview === 'function') return A.getRpReview(tenderId);
    if (A && typeof A.loadRpReview === 'function') return A.loadRpReview(tenderId);
    return fetch('/api/tenders/' + tenderId + '/rp-review', {
      headers: { Authorization: 'Bearer ' + authToken(), Accept: 'application/json' }
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
        return d;
      });
    });
  }

  function saveRpReview(tenderId, body) {
    const A = api();
    if (A && typeof A.saveRpReview === 'function') return A.saveRpReview(tenderId, body);
    return fetch('/api/tenders/' + tenderId + '/rp-review', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + authToken(),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
        return d;
      });
    });
  }

  function uploadKind(kind, tenderId, file) {
    const A = api();
    if (kind === 'estimate' && A && A.uploadRpEstimate) return A.uploadRpEstimate(tenderId, file);
    if (kind === 'tkp' && A && A.uploadRpTkp) return A.uploadRpTkp(tenderId, file);
    if (kind === 'report' && A && A.uploadRpReport) return A.uploadRpReport(tenderId, file);
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/tenders/' + tenderId + '/rp-review/' + kind, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + authToken() },
      body: fd
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
        return d;
      });
    });
  }

  function deadlineTone(deadline) {
    if (!deadline) return { cls: 'none', label: 'Срок не указан' };
    const d = new Date(String(deadline).slice(0, 10) + 'T23:59:59');
    if (!Number.isFinite(d.getTime())) return { cls: 'none', label: fmtDate(deadline) };
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    if (days < 0) return { cls: 'over', label: 'Просрочен · ' + fmtDate(deadline) };
    if (days <= 2) return { cls: 'hot', label: 'Горит · ' + fmtDate(deadline) };
    return { cls: 'ok', label: 'До ' + fmtDate(deadline) };
  }

  function parseReportJson(raw) {
    let r = raw;
    if (typeof r === 'string') {
      try { r = JSON.parse(r || '{}'); } catch (_) { r = {}; }
    }
    return r && typeof r === 'object' ? r : {};
  }

  function S() {
    return window.AsgardSmeta || null;
  }

  function ensureEstimate(seed) {
    const sm = S();
    if (!sm || typeof sm.recalcAsgardSmeta !== 'function') {
      return seed && seed.totals ? seed : {
        template: 'asgard_v1',
        meta: {},
        params: {},
        rows: [],
        totals: { cost: 0, price_no_vat: 0, price_with_vat: 0 }
      };
    }
    if (seed && seed.template === 'asgard_v1' && Array.isArray(seed.rows) && seed.rows.length) {
      return sm.recalcAsgardSmeta(seed);
    }
    const base = {
      template: 'asgard_v1',
      meta: (seed && seed.meta) || {},
      params: (seed && seed.params) || (sm.DEFAULT_PARAMS ? { ...sm.DEFAULT_PARAMS } : {}),
      rows: (sm.skeletonRows && sm.skeletonRows()) || []
    };
    return sm.recalcAsgardSmeta(base);
  }

  function demoTender() {
    return {
      id: null,
      registry_no: 'DEMO-1042',
      customer_name: 'Крупный промышленный заказчик',
      tender_title: 'Очистка ёмкостей и трубопроводов на производственной площадке',
      tender_price: 12840000,
      docs_deadline: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
      work_start: '2026-10-12',
      work_end: '2026-10-28',
      region: 'Мурманская область',
      object_name: 'Площадка №3 — участок ХВО',
      purchase_url: '',
      nmck: 12840000,
      platform: 'ЭТП (демо)',
      registry_status: 'анализ'
    };
  }

  function demoEstimate(tender) {
    const sm = S();
    const params = sm && sm.segezhaFixtureParams
      ? sm.segezhaFixtureParams()
      : {
        shifts_per_day: 2,
        workers_per_shift: 6,
        masters_per_shift: 1,
        work_days: 14,
        road_days: 2,
        mob_days: 3,
        trip_count: 2,
        rate_worker: 6000,
        rate_master: 7500,
        rate_itr: 10000,
        rate_road: 3000,
        meals: 1000,
        lodging: 1400,
        siz: 15000,
        fot_tax: 0.55,
        overhead: 0.12,
        contingency: 0.07,
        markup: 1.45,
        material_markup: 1.25,
        vat: 0.22
      };
    return ensureEstimate({
      template: 'asgard_v1',
      meta: {
        title: 'Просчёт — демо',
        customer: tender.customer_name,
        object: tender.object_name || '',
        executor: 'ООО «АСГАРД-Сервис»',
        work_schedule: '14 раб.сут · 2 смены · 2 выезда',
        terms: 'Аванс 30% · окончательный расчёт по акту'
      },
      params
    });
  }

  function demoFiles() {
    return {
      estimate: { name: 'Смета_просчёт_v3.xlsx', size: 184320 },
      tkp: { name: 'ТКП_заказчику.pdf', size: 256000 },
      report: { name: 'Отчёт_РП.docx', size: 92160 },
      mockList: [
        { kind: 'estimate', name: 'Смета_просчёт_v3.xlsx', size: '180 КБ' },
        { kind: 'tkp', name: 'ТКП_заказчику.pdf', size: '250 КБ' },
        { kind: 'report', name: 'Отчёт_РП.docx', size: '90 КБ' },
        { kind: 'tz', name: 'ТЗ_площадка.pdf', size: '1.2 МБ' }
      ]
    };
  }

  /* ── email / smeta HTML (export) ───────────────────────── */

  function renderSmetaTableHtml(estimate) {
    const est = estimate && estimate.totals ? estimate : ensureEstimate(estimate || {});
    const rows = est.rows || [];
    let body = '';
    let pendingSection = null;
    let sectionHasLines = false;

    function flushSection() {
      if (pendingSection && sectionHasLines) {
        body += pendingSection;
      }
      pendingSection = null;
      sectionHasLines = false;
    }

    rows.forEach(function (r) {
      if (r.kind === 'section') {
        flushSection();
        pendingSection = '<tr style="background:#1b2a4a;color:#fff">' +
          '<td colspan="6" style="padding:9px 10px;font-weight:700;font-size:12px;letter-spacing:.04em">' +
          esc(r.name || '') + '</td></tr>';
        return;
      }
      if (r.kind === 'line') {
        const sum = Number(r.sum) || 0;
        if (!(sum > 0)) return;
        if (pendingSection) {
          body += pendingSection;
          pendingSection = null;
        }
        sectionHasLines = true;
        body += '<tr>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #eef1f6;color:#6b7280;font-size:12px">' + esc(r.code || '') + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #eef1f6;font-size:13px">' + esc(r.name || '') + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #eef1f6;font-size:12px;color:#6b7280">' + esc(r.unit || '') + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #eef1f6;text-align:right;font-size:13px">' + esc(String(r.qty != null ? r.qty : '')) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #eef1f6;text-align:right;font-size:13px">' + esc(fmtMoneyPlain(r.price).replace(' ₽', '')) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #eef1f6;text-align:right;font-weight:700;font-size:13px">' + esc(fmtMoneyPlain(r.sum)) + '</td>' +
          '</tr>';
        return;
      }
      if (r.kind === 'subtotal' || r.kind === 'rollup') {
        if (r.kind === 'subtotal' && !sectionHasLines && !(Number(r.sum) > 0)) return;
        flushSection();
        const strong = r.sumExpr === 'cost' || r.sumExpr === 'price_with_vat' || r.sumExpr === 'price_no_vat' || r.sumExpr === 'direct';
        const label = r.kind === 'rollup' ? rollupDisplayName(r, est.params || {}) : (r.name || '');
        body += '<tr style="background:' + (strong ? '#faf6e8' : '#f8fafc') + '">' +
          '<td colspan="5" style="padding:8px 10px;text-align:right;font-weight:700;font-size:13px;color:#1b2a4a">' + esc(label) + '</td>' +
          '<td style="padding:8px 10px;text-align:right;font-weight:800;font-size:13px;color:' + (strong ? '#a8862e' : '#1b2a4a') + '">' +
          esc(fmtMoneyPlain(r.sum)) + '</td></tr>';
      }
    });
    flushSection();

    return '<table style="width:100%;border-collapse:collapse;margin:12px 0 4px;font-family:Arial,Helvetica,sans-serif">' +
      '<thead><tr style="background:#f8fafc">' +
      '<th style="text-align:left;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Код</th>' +
      '<th style="text-align:left;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Статья</th>' +
      '<th style="text-align:left;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Ед.</th>' +
      '<th style="text-align:right;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Кол-во</th>' +
      '<th style="text-align:right;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Цена, ₽</th>' +
      '<th style="text-align:right;padding:8px 10px;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb">Сумма</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function fmtMoneyPlain(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return Math.round(n).toLocaleString('ru-RU') + ' ₽';
  }

  function textBlock(label, value) {
    const v = String(value || '').trim();
    if (!v) return '';
    return '<div style="margin:0 0 12px">' +
      '<div style="font-size:11px;color:#6b7280;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px">' +
      esc(label) + '</div>' +
      '<div style="font-size:14px;line-height:1.5;white-space:pre-wrap">' + esc(v) + '</div></div>';
  }

  function buildEmailPreviewHtml(opts) {
    opts = opts || {};
    const tender = opts.tender || {};
    const review = opts.review || {};
    const estimate = opts.estimate && opts.estimate.totals
      ? opts.estimate
      : ensureEstimate(opts.estimate || {});
    const t = estimate.totals || {};
    const decideUrl = opts.decideUrl || '#';
    const filesUrl = opts.filesUrl || '#';
    const title = tender.tender_title || tender.title || 'Просчёт по тендеру';
    const when = [fmtDate(tender.work_start || tender.work_start_plan), fmtDate(tender.work_end)]
      .filter(function (x) { return x && x !== '—'; }).join(' — ') ||
      (estimate.meta && estimate.meta.work_schedule) || '—';
    const where = tender.object_name || tender.region ||
      (estimate.meta && estimate.meta.object) || '—';
    const rj = parseReportJson(review.report_json);
    const pmName = opts.pmName || review.calculator_name || review.finalized_by_name || 'РП';
    const decisionUntil = opts.decisionUntil || tender.docs_deadline || null;
    const decisionUntilLabel = decisionUntil
      ? (fmtDate(decisionUntil) + ' (дедлайн подачи документации)')
      : '72 часа с момента письма';
    const actionNeeded = rj.director_action || rj.action_needed || DEFAULT_DIRECTOR_ACTION;
    const workDesc = rj.summary || rj.work_description ||
      (estimate.meta && estimate.meta.title) || title;
    const rpComment = rj.recommendation || rj.rp_comment || rj.comment || '';
    const expectedFrom = String(opts.expectedFrom || '').trim();
    const recipientLabel = String(opts.recipientLabel || '').trim();

    const filesList = Array.isArray(opts.files) ? opts.files : [];
    const rpFiles = filesList.filter(function (f) {
      return /estimate|tkp|report|просч|ткп|отчёт|отчет|смет/i.test(String(f.kind || f.kind_label || f.name || ''));
    });
    const tenderFiles = filesList.filter(function (f) {
      return rpFiles.indexOf(f) < 0;
    });
    function filesMini(list, empty) {
      if (!list.length) return '<div style="font-size:13px;color:#6b7280">' + esc(empty) + '</div>';
      return list.map(function (f) {
        return '<div style="font-size:13px;padding:4px 0;border-bottom:1px solid #eef1f6">📎 ' +
          esc(f.name || f.original_name || 'файл') +
          (f.kind_label || f.kind ? ' <span style="color:#6b7280">· ' + esc(f.kind_label || f.kind) + '</span>' : '') +
          '</div>';
      }).join('');
    }

    return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Просчёт</title></head>' +
      '<body style="margin:0;padding:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;color:#1b2a4a;">' +
      '<div style="max-width:680px;margin:0 auto;padding:20px 16px 40px;">' +
      '<div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(27,42,74,.08);">' +
      '<div style="background:#1b2a4a;color:#fff;padding:20px 22px;">' +
      '<div style="font-size:12px;letter-spacing:.08em;color:#c9a227;font-weight:700;">АСГАРД · ПРОСЧЁТ НА СОГЛАСОВАНИЕ</div>' +
      '<div style="font-size:19px;font-weight:700;margin-top:6px;line-height:1.3">' + esc(title) + '</div>' +
      (recipientLabel ? '<div style="margin-top:10px;font-size:14px;color:#e8eefc">Здравствуйте, ' + esc(recipientLabel) + '.</div>' : '') +
      '<div style="margin-top:12px;display:inline-block;background:rgba(201,162,39,.2);border:1px solid rgba(201,162,39,.45);' +
      'color:#f5e6b0;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:700">' +
      'Решить до: ' + esc(decisionUntilLabel) + '</div>' +
      '</div>' +
      '<div style="padding:22px 22px 28px;">' +
      '<div style="padding:14px 16px;background:#fff8e6;border:1px solid #f0d78c;border-radius:10px;margin-bottom:16px">' +
      '<div style="font-size:11px;font-weight:800;letter-spacing:.05em;color:#8a6d1a;text-transform:uppercase;margin-bottom:6px">Решение для директора</div>' +
      '<div style="font-size:15px;line-height:1.45;font-weight:600">' + esc(actionNeeded) + '</div>' +
      (expectedFrom ? '<div style="font-size:13px;color:#5c4a00;margin-top:10px;padding-top:10px;border-top:1px solid #f0d78c">' +
        '<b>Согласование ожидается от:</b> ' + esc(expectedFrom) + '</div>' : '') +
      '<div style="font-size:12px;color:#8a6d1a;margin-top:8px">Ссылка на решение действует 72 часа.</div></div>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:14px">' +
      '<tr><td style="padding:6px 0;color:#6b7280;width:120px">Заказчик</td><td style="padding:6px 0;font-weight:700">' +
      esc(tender.customer_name || (estimate.meta && estimate.meta.customer) || '—') + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#6b7280">№</td><td style="padding:6px 0;font-weight:700">' +
      esc(tender.registry_no || tender.id || '—') + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#6b7280">Когда</td><td style="padding:6px 0;font-weight:700">' + esc(when) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#6b7280">Где</td><td style="padding:6px 0;font-weight:700">' + esc(where) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#6b7280">Считал</td><td style="padding:6px 0;font-weight:700">' + esc(pmName) + '</td></tr>' +
      '</table>' +
      textBlock('Описание работ', workDesc) +
      textBlock('Комментарий РП', rpComment) +
      '<div style="font-size:13px;font-weight:800;color:#1b2a4a;margin:18px 0 6px;letter-spacing:.04em">СМЕТА</div>' +
      renderSmetaTableHtml(estimate) +
      '<div style="margin:18px 0 8px;padding:16px 18px;background:linear-gradient(180deg,#faf6e8,#f8fafc);border-radius:12px;border:1px solid #e8dfc0">' +
      '<div style="font-size:11px;color:#8a6d1a;margin-bottom:8px;font-weight:800;letter-spacing:.05em;text-transform:uppercase">Итоги для решения</div>' +
      '<div style="font-size:14px;margin:4px 0">Себестоимость без НДС: <b>' + esc(fmtMoneyPlain(t.cost)) + '</b></div>' +
      '<div style="font-size:14px;margin:4px 0">Цена без НДС: <b>' + esc(fmtMoneyPlain(t.price_no_vat)) + '</b></div>' +
      '<div style="font-size:26px;font-weight:800;margin-top:10px;color:#1b2a4a;letter-spacing:-.02em">С НДС: ' +
      esc(fmtMoneyPlain(t.price_with_vat || review.work_price)) + '</div></div>' +
      '<a href="' + esc(decideUrl) + '" style="display:block;background:#15803d;color:#fff;text-decoration:none;text-align:center;' +
      'padding:16px 18px;border-radius:12px;font-weight:800;font-size:17px;margin:20px 0 10px;">Согласовать</a>' +
      '<a href="' + esc(decideUrl) + '" style="display:block;background:#b91c1c;color:#fff;text-decoration:none;text-align:center;' +
      'padding:16px 18px;border-radius:12px;font-weight:800;font-size:17px;">Отказать</a>' +
      '<a href="' + esc(filesUrl) + '" style="display:block;background:#1b2a4a;color:#fff;text-decoration:none;text-align:center;' +
      'padding:18px 18px;border-radius:12px;font-weight:800;font-size:17px;margin:18px 0 8px;">Файлы тендера и просчёта</a>' +
      '<div style="margin-top:14px;padding:12px 14px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb">' +
      '<div style="font-size:12px;font-weight:800;color:#1b2a4a;margin-bottom:6px">Файлы РП (просчёт)</div>' +
      filesMini(rpFiles, 'Пока не прикреплены') +
      '<div style="font-size:12px;font-weight:800;color:#1b2a4a;margin:12px 0 6px">Файлы тендера</div>' +
      filesMini(tenderFiles, 'См. по кнопке выше') +
      '</div>' +
      '<p style="font-size:12px;color:#6b7280;margin:16px 0 0;line-height:1.45">Ссылка действует 72 ч.</p>' +
      '</div></div></div></body></html>';
  }

  /* ── render shell ──────────────────────────────────────── */

  function renderShell(state) {
    const t = state.tender || {};
    const dl = deadlineTone(t.docs_deadline);
    const est = state.estimate || {};
    const totals = est.totals || {};
    const tab = state.tab || 'inputs';
    const demo = !!state.demo;

    const tabsHtml = TABS.map(function (tb) {
      return '<button type="button" class="rp-calc-tab' + (tab === tb.id ? ' is-active' : '') +
        '" data-rp-tab="' + tb.id + '" role="tab" aria-selected="' + (tab === tb.id ? 'true' : 'false') + '">' +
        esc(tb.label) + '</button>';
    }).join('');

    return '<div class="rp-calc-modal' + (state.embedded ? ' rp-calc-modal--embedded' : '') + '" data-rp-calc-root="1">' +
      '<div class="rp-calc-hero">' +
      '<div class="rp-calc-hero__main">' +
      '<div class="rp-calc-hero__kicker">АСГАРД · ПРОСЧЁТ' + (demo ? ' · DEMO' : '') + '</div>' +
      '<h2 class="rp-calc-hero__title">Просчёт</h2>' +
      '<div class="rp-calc-hero__sub">' +
      '<span>№ <b>' + esc(t.registry_no || t.id || '—') + '</b></span>' +
      '<span>' + esc(t.customer_name || '—') + '</span>' +
      '</div></div>' +
      '<div class="rp-calc-hero__side">' +
      '<span class="rp-calc-badge">' + (demo ? 'Демо' + (state.readOnly ? '' : '') : 'РП') + '</span>' +
      '<span class="rp-calc-dl rp-calc-dl--' + dl.cls + '">' + esc(dl.label) + '</span>' +
      '</div></div>' +
      '<div class="rp-calc-tabs-wrap"><div class="rp-calc-tabs" role="tablist">' + tabsHtml + '</div></div>' +
      '<div class="rp-calc-body">' +
      renderInputs(state) +
      renderSmeta(state) +
      renderFiles(state) +
      renderTender(state) +
      '</div>' +
      '<div class="rp-calc-footer">' +
      '<div class="rp-calc-footer__kpis">' +
      '<div class="rp-calc-footer__kpi"><span>Себестоимость</span><b data-kpi="cost">' + esc(fmtMoney(totals.cost)) + '</b></div>' +
      '<div class="rp-calc-footer__kpi"><span>Цена без НДС</span><b data-kpi="price_no_vat">' + esc(fmtMoney(totals.price_no_vat)) + '</b></div>' +
      '<div class="rp-calc-footer__kpi is-gold"><span>Цена с НДС</span><b data-kpi="price_with_vat">' + esc(fmtMoney(totals.price_with_vat)) + '</b></div>' +
      '</div>' +
      '<div class="rp-calc-footer__acts">' +
      (state.readOnly
        ? '<span class="muted" style="font-size:12px">Только просмотр</span>'
        : (demo
          ? '<button type="button" class="btn ghost" data-rp-act="demo-draft">Сохранить черновик</button>' +
            '<button type="button" class="btn primary" data-rp-act="demo-send">Отправить директору</button>'
          : '<button type="button" class="btn ghost" data-rp-act="save-draft"' + (state.busy ? ' disabled' : '') + '>Сохранить черновик</button>' +
            '<button type="button" class="btn primary" data-rp-act="send-director"' + (state.busy ? ' disabled' : '') + '>Отправить директору</button>')) +
      '</div></div></div>';
  }

  function renderInputs(state) {
    const est = state.estimate || {};
    const meta = est.meta || {};
    const p = est.params || {};
    const sm = S();
    const labels = (sm && sm.PARAM_LABELS) || [];
    const active = state.tab === 'inputs' ? ' is-active' : '';
    const rj = parseReportJson(state.review && state.review.report_json);
    const summary = state.brief && state.brief.summary != null ? state.brief.summary : (rj.summary || '');
    const rpComment = state.brief && state.brief.rp_comment != null ? state.brief.rp_comment : (rj.recommendation || rj.rp_comment || '');
    const directorAction = state.brief && state.brief.director_action != null
      ? state.brief.director_action
      : (rj.director_action || DEFAULT_DIRECTOR_ACTION);

    let paramRows = labels.map(function (metaRow) {
      let val = p[metaRow.key];
      let show = val;
      let step = 'any';
      let unit = metaRow.unit || '';
      if (PCT_KEYS[metaRow.key]) {
        show = Math.round(Number(val) * 10000) / 100;
        step = '0.1';
        unit = '%';
      }
      return '<tr><td>' + esc(metaRow.label) + '</td>' +
        '<td><input type="number" step="' + step + '" data-rp-param="' + esc(metaRow.key) + '" value="' + esc(show) + '"/></td>' +
        '<td class="unit">' + esc(unit) + '</td>' +
        '<td class="note">' + esc(metaRow.note || '') + '</td></tr>';
    }).join('');

    return '<div class="rp-calc-panel' + active + '" data-panel="inputs">' +
      '<p class="rp-calc-hint">Метаданные, описание для директора и параметры бригады. Параметры пересчитывают смету.</p>' +
      '<div class="rp-calc-card"><div class="rp-calc-card__head">Объект и условия</div>' +
      '<div class="rp-calc-grid">' +
      field('customer', 'Заказчик', meta.customer || state.tender.customer_name || '') +
      field('object', 'Объект', meta.object || state.tender.object_name || '') +
      field('work_schedule', 'График / сроки', meta.work_schedule || '') +
      field('terms', 'Условия оплаты', meta.terms || '') +
      '</div></div>' +
      '<div class="rp-calc-card"><div class="rp-calc-card__head">Для директора</div>' +
      '<div class="rp-calc-field" style="margin-bottom:12px"><label>Описание работ</label>' +
      '<textarea class="inp" rows="3" data-rp-brief="summary" placeholder="Что за работа, объём, особенности…">' +
      esc(summary) + '</textarea></div>' +
      '<div class="rp-calc-field" style="margin-bottom:12px"><label>Комментарий РП</label>' +
      '<textarea class="inp" rows="3" data-rp-brief="rp_comment" placeholder="Риски, допущения, на что обратить внимание…">' +
      esc(rpComment) + '</textarea></div>' +
      '<div class="rp-calc-field"><label>Решение для директора</label>' +
      '<textarea class="inp" rows="2" data-rp-brief="director_action" placeholder="Согласовать цену и подачу — или отклонить с комментарием">' +
      esc(directorAction) + '</textarea></div>' +
      '</div>' +
      '<div class="rp-calc-card"><div class="rp-calc-card__head">Параметры расчёта</div>' +
      '<table class="rp-calc-params"><thead><tr>' +
      '<th>Параметр</th><th>Значение</th><th>Ед.</th><th>Примечание</th>' +
      '</tr></thead><tbody>' + (paramRows || '<tr><td colspan="4" class="muted">AsgardSmeta не загружен</td></tr>') +
      '</tbody></table></div></div>';
  }

  function field(key, label, value) {
    return '<div class="rp-calc-field"><label>' + esc(label) + '</label>' +
      '<input class="inp" data-rp-meta="' + esc(key) + '" value="' + esc(value) + '"/></div>';
  }

  function renderSmeta(state) {
    const est = state.estimate || {};
    const rows = est.rows || [];
    const totals = est.totals || {};
    const params = est.params || {};
    const active = state.tab === 'smeta' ? ' is-active' : '';
    let pendingSec = '';
    let secOpen = false;
    const parts = [];
    rows.forEach(function (r) {
      if (r.kind === 'section') {
        pendingSec = '<tr class="rp-calc-sec"><td colspan="6">' + esc(r.name || '') + '</td></tr>';
        secOpen = false;
        return;
      }
      if (r.kind === 'line') {
        // Письмо: скрываем sum≤0. В модалке скрываем только пустые (qty=0 и sum=0),
        // чтобы РП мог ввести цену по строкам с дефолтным qty (оборудование и т.п.).
        if (!(Number(r.sum) > 0) && !(Number(r.qty) > 0) && !r.override) return;
        if (pendingSec) { parts.push(pendingSec); pendingSec = ''; }
        secOpen = true;
        parts.push('<tr class="rp-calc-line' + (r.override ? ' is-override' : '') + '" data-row-id="' + esc(r.id) + '">' +
          '<td>' + esc(r.code || '') + '</td>' +
          '<td><input class="rp-calc-cell-name" data-fld="name" value="' + esc(r.name || '') +
          '" placeholder="Название статьи" title="Статья сметы"/></td>' +
          '<td class="rp-calc-unit-cell">' + unitSelectHtml(r.unit) + '</td>' +
          '<td class="num"><input class="rp-calc-cell" type="number" step="0.01" data-fld="qty" ' +
          'value="' + esc(r.qty != null ? r.qty : 0) + '" placeholder="кол-во" title="Количество в выбранных единицах"/></td>' +
          '<td class="num"><input class="rp-calc-cell" type="number" step="1" data-fld="price" ' +
          'value="' + esc(r.price != null ? r.price : 0) + '" placeholder="₽ за ед." title="Цена за единицу, ₽"/></td>' +
          '<td class="num" data-fld="sum">' + esc(fmtMoney(r.sum)) + '</td></tr>');
        return;
      }
      if (r.kind === 'subtotal' && !secOpen) return;
      pendingSec = '';
      const strong = r.sumExpr === 'cost' || r.sumExpr === 'price_with_vat' || r.sumExpr === 'price_no_vat';
      const cls = r.kind === 'rollup' ? 'rp-calc-rollup' : 'rp-calc-subtotal';
      const label = r.kind === 'rollup' ? rollupDisplayName(r, params) : (r.name || '');
      parts.push('<tr class="' + cls + (strong ? ' is-strong' : '') + '"' +
        (r.sumExpr ? ' data-sum-expr="' + esc(r.sumExpr) + '"' : '') + '>' +
        '<td colspan="5" class="num">' + esc(label) + '</td>' +
        '<td class="num">' + esc(fmtMoney(r.sum)) + '</td></tr>');
    });
    const body = parts.join('');
    const taxPct = pctLabel(params.fot_tax != null ? params.fot_tax : 0.55);

    return '<div class="rp-calc-panel' + active + '" data-panel="smeta">' +
      '<p class="rp-calc-hint">Строки с нулевой суммой скрыты. Ед. — выпадающий список. ' +
      'Кол-во и цена: правка фиксирует override. Налог на ФОТ сейчас <b>' + esc(taxPct) + '%</b> (параметры на вкладке «Вводные»).</p>' +
      '<div class="rp-calc-smeta-wrap"><table class="rp-calc-smeta">' +
      '<thead><tr><th>Код</th><th>Статья</th><th>Ед.</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th></tr></thead>' +
      '<tbody>' + (body || '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--muted)">Нет строк</td></tr>') +
      '</tbody></table>' +
      '<div class="rp-calc-smeta-totals">' +
      '<div class="kpi"><span>Себестоимость</span><b>' + esc(fmtMoney(totals.cost)) + '</b></div>' +
      '<div class="kpi"><span>Без НДС</span><b>' + esc(fmtMoney(totals.price_no_vat)) + '</b></div>' +
      '<div class="kpi is-gold"><span>С НДС</span><b>' + esc(fmtMoney(totals.price_with_vat)) + '</b></div>' +
      '</div></div></div>';
  }

  function renderFiles(state) {
    const active = state.tab === 'files' ? ' is-active' : '';
    const files = state.files || {};
    const kinds = [
      { id: 'estimate', title: 'Смета', hint: 'XLSX / PDF' },
      { id: 'tkp', title: 'ТКП', hint: 'PDF / DOCX' },
      { id: 'report', title: 'Отчёт РП', hint: 'DOCX / PDF' }
    ];
    const drops = kinds.map(function (k) {
      const f = files[k.id];
      const name = f && (f.name || f.original_name || f.file_name);
      return '<div class="rp-calc-drop' + (name ? ' has-file' : '') + '" data-drop="' + k.id + '" tabindex="0">' +
        '<strong>' + esc(k.title) + '</strong>' +
        '<div class="hint">' + (name ? 'Заменено — перетащите новый файл' : 'Перетащите файл или кликните · ' + k.hint) + '</div>' +
        (name ? '<div class="fname">📎 ' + esc(name) + '</div>' : '') +
        '<input type="file" hidden data-file-input="' + k.id + '" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"/>' +
        '</div>';
    }).join('');

    let list = '';
    if (state.demo && Array.isArray(files.mockList) && files.mockList.length) {
      list = '<ul class="rp-calc-file-list">' + files.mockList.map(function (f) {
        return '<li><span class="tag">' + esc(f.kind) + '</span><span style="flex:1">' + esc(f.name) +
          '</span><span class="muted">' + esc(f.size || '') + '</span></li>';
      }).join('') + '</ul>';
    }

    return '<div class="rp-calc-panel' + active + '" data-panel="files">' +
      '<p class="rp-calc-hint">Вложения к просчёту. В демо загрузка опциональна — показан пример комплекта файлов.</p>' +
      '<div class="rp-calc-drops">' + drops + '</div>' + list + '</div>';
  }

  function renderTender(state) {
    const t = state.tender || {};
    const active = state.tab === 'tender' ? ' is-active' : '';
    function ro(label, value) {
      return '<div class="rp-calc-ro"><div class="lbl">' + esc(label) + '</div><div class="val">' + esc(value || '—') + '</div></div>';
    }
    return '<div class="rp-calc-panel' + active + '" data-panel="tender">' +
      '<p class="rp-calc-hint">Карточка тендера только для чтения.</p>' +
      '<div class="rp-calc-card">' +
      ro('Реестр №', t.registry_no || t.id) +
      ro('Заказчик', t.customer_name) +
      ro('Предмет', t.tender_title) +
      ro('НМЦ / цена', t.tender_price != null ? fmtMoney(t.tender_price) : (t.nmck != null ? fmtMoney(t.nmck) : '—')) +
      ro('Срок подачи', fmtDate(t.docs_deadline)) +
      ro('Регион', t.region) +
      ro('Объект', t.object_name) +
      ro('Площадка', t.platform) +
      ro('Статус реестра', t.registry_status) +
      (t.purchase_url
        ? '<div class="rp-calc-ro"><div class="lbl">Ссылка</div><div class="val"><a href="' + esc(t.purchase_url) +
          '" target="_blank" rel="noreferrer">' + esc(t.purchase_url) + '</a></div></div>'
        : '') +
      '</div></div>';
  }

  /* ── session / bind ────────────────────────────────────── */

  function createSession(initial) {
    const state = {
      tender: initial.tender || {},
      review: initial.review || null,
      estimate: ensureEstimate(initial.estimate),
      files: initial.files || { estimate: null, tkp: null, report: null },
      tab: initial.tab || 'inputs',
      demo: !!initial.demo,
      embedded: !!initial.embedded,
      busy: false,
      onRefresh: initial.onRefresh || null,
      root: null,
      hostEl: initial.hostEl || null,
      pms: initial.pms || []
    };

    function getRoot() {
      if (state.hostEl && state.hostEl.isConnected) {
        const inner = state.hostEl.querySelector('[data-rp-calc-root]');
        if (inner) return inner;
      }
      if (state.root && state.root.isConnected) return state.root;
      return document.querySelector('[data-rp-calc-root]');
    }

    function paint(keepFocus) {
      let focusParam = null;
      let focusRowId = null;
      let focusFld = null;
      if (keepFocus) {
        const active = document.activeElement;
        if (active && active.getAttribute) {
          focusParam = active.getAttribute('data-rp-param');
          focusFld = active.getAttribute('data-fld');
          const tr = active.closest && active.closest('[data-row-id]');
          focusRowId = tr && tr.getAttribute('data-row-id');
        }
      }
      const html = renderShell(state);
      if (state.embedded && state.hostEl) {
        state.hostEl.innerHTML = html;
        state.root = state.hostEl.querySelector('[data-rp-calc-root]') || state.hostEl.firstElementChild;
      } else if (replaceModal) {
        replaceModal({
          title: 'Просчёт',
          subtitle: state.tender.customer_name || '',
          icon: '🧮',
          html: html,
          wide: true,
          fullscreen: true
        });
        state.root = document.querySelector('[data-rp-calc-root]');
      } else if (state.root) {
        const parent = state.root.parentNode;
        if (parent) {
          const wrap = document.createElement('div');
          wrap.innerHTML = html;
          const next = wrap.firstElementChild;
          parent.replaceChild(next, state.root);
          state.root = next;
        }
      }
      bind();
      if (keepFocus) {
        const root = getRoot();
        if (!root) return;
        setTimeout(function () {
          if (focusParam) {
            const el = root.querySelector('[data-rp-param="' + focusParam + '"]');
            if (el) { el.focus(); if (el.select) el.select(); }
          } else if (focusRowId && focusFld) {
            const el = root.querySelector(
              'tr[data-row-id="' + focusRowId + '"] [data-fld="' + focusFld + '"]'
            );
            if (el) { el.focus(); if (el.select) el.select(); }
          }
        }, 0);
      }
    }

    function syncMetaFromDom(root) {
      if (!root) return;
      state.estimate.meta = state.estimate.meta || {};
      state.brief = state.brief || {};
      root.querySelectorAll('[data-rp-meta]').forEach(function (inp) {
        state.estimate.meta[inp.getAttribute('data-rp-meta')] = inp.value;
      });
      root.querySelectorAll('[data-rp-brief]').forEach(function (inp) {
        state.brief[inp.getAttribute('data-rp-brief')] = inp.value;
      });
    }

    function recalc(keepFocus) {
      const sm = S();
      if (sm && sm.recalcAsgardSmeta) {
        state.estimate = sm.recalcAsgardSmeta(state.estimate);
      }
      paint(keepFocus);
    }

    function bind() {
      const root = getRoot();
      if (!root) return;
      state.root = root;

      root.querySelectorAll('[data-rp-tab]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          syncMetaFromDom(root);
          state.tab = btn.getAttribute('data-rp-tab');
          paint();
        });
      });

      root.querySelectorAll('[data-rp-meta]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          state.estimate.meta = state.estimate.meta || {};
          state.estimate.meta[inp.getAttribute('data-rp-meta')] = inp.value;
        });
      });

      root.querySelectorAll('[data-rp-param]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          const key = inp.getAttribute('data-rp-param');
          let v = Number(inp.value);
          if (!Number.isFinite(v)) v = 0;
          if (PCT_KEYS[key]) v = v / 100;
          state.estimate.params = state.estimate.params || {};
          state.estimate.params[key] = v;
          recalc(true);
        });
      });

      root.querySelectorAll('tr[data-row-id] [data-fld]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          const tr = inp.closest('tr[data-row-id]');
          const id = tr && tr.getAttribute('data-row-id');
          const row = (state.estimate.rows || []).find(function (r) { return r.id === id; });
          if (!row) return;
          const fld = inp.getAttribute('data-fld');
          if (fld === 'qty' || fld === 'price') {
            row[fld] = Number(inp.value) || 0;
            row.override = true;
          } else if (fld === 'unit') {
            row.unit = inp.value;
            row.override = true;
          } else {
            row[fld] = inp.value;
          }
          recalc(true);
        });
      });

      root.querySelectorAll('[data-drop]').forEach(function (zone) {
        const kind = zone.getAttribute('data-drop');
        const fileInp = zone.querySelector('[data-file-input="' + kind + '"]');
        zone.addEventListener('click', function () { if (fileInp) fileInp.click(); });
        zone.addEventListener('dragover', function (e) {
          e.preventDefault();
          zone.classList.add('is-drag');
        });
        zone.addEventListener('dragleave', function () { zone.classList.remove('is-drag'); });
        zone.addEventListener('drop', function (e) {
          e.preventDefault();
          zone.classList.remove('is-drag');
          const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) handleFile(kind, f);
        });
        if (fileInp) {
          fileInp.addEventListener('change', function () {
            const f = fileInp.files && fileInp.files[0];
            if (f) handleFile(kind, f);
            fileInp.value = '';
          });
        }
      });

      root.querySelectorAll('[data-rp-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const act = btn.getAttribute('data-rp-act');
          if (act === 'save-draft') save(false);
          else if (act === 'send-director') openSendPreview();
          else if (act === 'demo-draft') toast('Демо', 'Черновик сохранён локально (без API)', 'ok');
          else if (act === 'demo-send') openSendPreview();
        });
      });
    }

    function handleFile(kind, file) {
      if (state.demo) {
        state.files[kind] = { name: file.name, size: file.size };
        if (!state.files.mockList) state.files.mockList = [];
        state.files.mockList = state.files.mockList.filter(function (x) { return x.kind !== kind; });
        state.files.mockList.unshift({
          kind: kind,
          name: file.name,
          size: Math.round(file.size / 1024) + ' КБ'
        });
        paint();
        toast('Файл', file.name + ' (демо)', 'ok');
        return;
      }
      if (!state.tender || !state.tender.id) {
        toast('Ошибка', 'Нет ID тендера', 'err');
        return;
      }
      state.busy = true;
      paint();
      uploadKind(kind, state.tender.id, file).then(function (d) {
        const f = d.estimate_file || d.tkp_file || d.report_file || d.file || { name: file.name };
        state.files[kind] = f;
        if (d.review) state.review = d.review;
        toast('Загружено', file.name, 'ok');
      }).catch(function (e) {
        toast('Ошибка', e.message || 'Не удалось загрузить', 'err');
      }).finally(function () {
        state.busy = false;
        paint();
      });
    }

    function approvalNeeded() {
      const totals = (state.estimate && state.estimate.totals) || {};
      const noVat = Number(totals.price_no_vat);
      return Number.isFinite(noVat) && noVat >= DIRECTOR_THRESHOLD;
    }

    function selectedRecipients() {
      const list = Array.isArray(state.approvalRecipients) && state.approvalRecipients.length
        ? state.approvalRecipients
        : ['DIRECTOR_GEN'];
      return list.slice();
    }

    function buildPayload(finalize) {
      syncMetaFromDom(getRoot());
      const sm = S();
      if (sm && sm.recalcAsgardSmeta) state.estimate = sm.recalcAsgardSmeta(state.estimate);
      const totals = state.estimate.totals || {};
      const rj = parseReportJson(state.review && state.review.report_json);
      rj.mode = 'calc';
      rj.asgard_smeta = state.estimate;
      rj.cost_without_vat = totals.cost != null ? Math.round(totals.cost) : null;
      if (state.brief) {
        if (state.brief.summary != null) rj.summary = state.brief.summary;
        if (state.brief.rp_comment != null) {
          rj.recommendation = state.brief.rp_comment;
          rj.rp_comment = state.brief.rp_comment;
        }
        if (state.brief.director_action != null) rj.director_action = state.brief.director_action;
      }
      if (state.estimate.meta) {
        if (state.estimate.meta.work_schedule) rj.duration_note = state.estimate.meta.work_schedule;
        if (state.estimate.meta.terms) rj.payment_terms = state.estimate.meta.terms;
      }
      const body = {
        decision: 'submit',
        report_kind: 'work',
        report_json: rj,
        work_price: totals.price_with_vat != null ? Math.round(totals.price_with_vat) : null,
        finalize: !!finalize,
        expected_updated_at: state.review && state.review.updated_at ? state.review.updated_at : null
      };
      // Согласование нужно только от 10 млн без НДС; получателей шлём адресно.
      if (finalize && approvalNeeded()) body.approval_recipients = selectedRecipients();
      return body;
    }

    function collectFilesForEmail() {
      const out = [];
      const files = state.files || {};
      ['estimate', 'tkp', 'report'].forEach(function (k) {
        const f = files[k];
        if (!f) return;
        out.push({
          name: f.name || f.original_name || f.file_name || k,
          kind: k,
          kind_label: k === 'estimate' ? 'Смета' : (k === 'tkp' ? 'ТКП' : 'Отчёт РП')
        });
      });
      if (Array.isArray(files.mockList)) {
        files.mockList.forEach(function (f) {
          out.push(f);
        });
      }
      return out;
    }

    function openSendPreview() {
      syncMetaFromDom(getRoot());
      const sm = S();
      if (sm && sm.recalcAsgardSmeta) state.estimate = sm.recalcAsgardSmeta(state.estimate);
      const rj = parseReportJson(state.review && state.review.report_json);
      if (state.brief) {
        rj.summary = state.brief.summary || rj.summary;
        rj.recommendation = state.brief.rp_comment || rj.recommendation;
        rj.rp_comment = state.brief.rp_comment || rj.rp_comment;
        rj.director_action = state.brief.director_action || rj.director_action;
      }
      const need = approvalNeeded();
      const totals = (state.estimate && state.estimate.totals) || {};
      const noVat = Number(totals.price_no_vat) || 0;

      function buildHtml() {
        const codes = need ? selectedRecipients() : [];
        const expectedFrom = codes.map(recipientLabelByCode).join(', ');
        return buildEmailPreviewHtml({
          tender: state.tender,
          review: Object.assign({}, state.review || {}, { report_json: rj }),
          estimate: state.estimate,
          decideUrl: '#',
          filesUrl: '#',
          pmName: (state.review && (state.review.calculator_name || state.review.finalized_by_name)) || 'РП',
          decisionUntil: state.tender && state.tender.docs_deadline,
          files: collectFilesForEmail(),
          expectedFrom: expectedFrom,
          recipientLabel: codes.length === 1 ? recipientLabelByCode(codes[0]) : ''
        });
      }

      // Фиксированный оверлей на весь viewport — иначе дежурство/реестр
      // «просвечивают» и склеиваются с письмом на одном кадре.
      document.querySelectorAll('.rp-calc-mail-preview').forEach(function (el) {
        try { el.remove(); } catch (_) {}
      });
      const overlay = document.createElement('div');
      overlay.className = 'rp-calc-mail-preview';
      const toBlock = need
        ? ('<div class="rp-calc-mail-preview__to">' +
            '<div class="rp-calc-mail-preview__to-head">Кому на согласование' +
            '<span class="rp-calc-mail-preview__to-hint">достаточно согласия любого одного</span></div>' +
            '<div class="rp-calc-mail-preview__to-list">' +
            APPROVAL_RECIPIENTS.map(function (r) {
              const on = selectedRecipients().indexOf(r.code) >= 0;
              return '<label class="rp-calc-mail-preview__to-item' + (on ? ' is-on' : '') + '" title="' + esc(r.label) + '">' +
                '<input type="checkbox" data-rcpt="' + r.code + '"' + (on ? ' checked' : '') + '>' +
                '<span class="rp-calc-mail-preview__chip">' + esc(r.label) + '</span></label>';
            }).join('') +
            '</div>' +
            '<div class="rp-calc-mail-preview__to-warn" hidden>Выберите хотя бы одного получателя</div>' +
          '</div>')
        : ('<div class="rp-calc-mail-preview__skip">Согласование не требуется: цена без НДС ' +
            esc(fmtMoney(noVat)) + ' ниже 10 млн. Тендер сразу уйдёт в «Готовим», письмо не отправляется.</div>');
      overlay.innerHTML =
        '<div class="rp-calc-mail-preview__bar">' +
        '<div><strong>Предпросмотр письма директору</strong>' +
        '<div class="muted" style="font-size:12px;margin-top:2px">Так письмо уйдёт на почту. Проверьте и подтвердите.</div></div>' +
        '<div class="rp-calc-mail-preview__acts">' +
        '<button type="button" class="btn ghost" data-mail-prev="back">Назад · править</button>' +
        '<button type="button" class="btn primary" data-mail-prev="ok">' +
        (state.demo ? 'ОК (демо)' : (need ? 'ОК · отправить на согласование' : 'ОК · завершить просчёт')) + '</button>' +
        '</div></div>' +
        toBlock +
        '<iframe class="rp-calc-mail-preview__frame" title="Предпросмотр письма"></iframe>';
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      const frame = overlay.querySelector('.rp-calc-mail-preview__frame');
      function paintFrame() {
        if (!frame) return;
        const html = buildHtml();
        try { frame.srcdoc = html; } catch (_) {
          const doc = frame.contentDocument || frame.contentWindow.document;
          doc.open(); doc.write(html); doc.close();
        }
      }
      paintFrame();

      if (need) {
        overlay.querySelectorAll('[data-rcpt]').forEach(function (cb) {
          cb.addEventListener('change', function () {
            const on = [];
            overlay.querySelectorAll('[data-rcpt]').forEach(function (x) {
              if (x.checked) on.push(x.getAttribute('data-rcpt'));
              const lbl = x.closest('.rp-calc-mail-preview__to-item');
              if (lbl) lbl.classList.toggle('is-on', x.checked);
            });
            state.approvalRecipients = on;
            const warn = overlay.querySelector('.rp-calc-mail-preview__to-warn');
            if (warn) warn.hidden = on.length > 0;
            paintFrame();
          });
        });
      }

      function closeMailPreview() {
        overlay.remove();
        if (!document.querySelector('.cr-m-overlay.cr-m-overlay--visible')) {
          document.body.style.overflow = '';
        }
      }

      overlay.querySelector('[data-mail-prev="back"]').addEventListener('click', function () {
        closeMailPreview();
      });
      overlay.querySelector('[data-mail-prev="ok"]').addEventListener('click', function () {
        if (need && selectedRecipients().length === 0) {
          const warn = overlay.querySelector('.rp-calc-mail-preview__to-warn');
          if (warn) warn.hidden = false;
          return;
        }
        overlay.remove();
        if (!document.querySelector('.cr-m-overlay.cr-m-overlay--visible')) {
          document.body.style.overflow = '';
        }
        if (state.demo) {
          toast('Демо', 'Письмо подтверждено (без отправки)', 'ok');
          return;
        }
        save(true);
      });
    }

    function save(finalize) {
      if (state.demo) return;
      if (!state.tender || !state.tender.id) {
        toast('Ошибка', 'Нет ID тендера', 'err');
        return;
      }
      state.busy = true;
      paint();
      const body = buildPayload(finalize);
      saveRpReview(state.tender.id, body).then(function (d) {
        if (d.review) state.review = d.review;
        toast(finalize ? 'Отправлено' : 'Сохранено',
          finalize ? 'Просчёт ушёл директору' : 'Черновик просчёта сохранён', 'ok');
        if (typeof state.onRefresh === 'function') {
          try { state.onRefresh(); } catch (_) { /* ignore */ }
        }
        if (finalize) hideModal();
        else paint();
      }).catch(function (e) {
        toast('Ошибка', e.message || 'Не удалось сохранить', 'err');
      }).finally(function () {
        state.busy = false;
        if (!finalize) paint();
      });
    }

    return { state: state, paint: paint, bind: bind, recalc: recalc };
  }

  /* ── public API ────────────────────────────────────────── */

  function open(tender, pms, onRefresh, opts) {
    opts = opts || {};
    tender = tender || {};
    const session = createSession({
      tender: tender,
      pms: pms || [],
      onRefresh: onRefresh,
      tab: opts.tab || 'inputs',
      demo: false,
      embedded: false,
      estimate: null,
      files: { estimate: null, tkp: null, report: null }
    });

    showModal({
      title: 'Просчёт',
      subtitle: tender.customer_name || '',
      icon: '🧮',
      html: '<div class="rp-calc-modal"><p class="muted" style="padding:24px">Загрузка просчёта…</p></div>',
      wide: true,
      fullscreen: true,
      onMount: function () {
        if (!tender.id) {
          toast('Ошибка', 'Не указан тендер', 'err');
          return;
        }
        loadRpReview(tender.id).then(function (d) {
          if (d.tender) Object.assign(session.state.tender, d.tender);
          session.state.review = d.review || null;
          const rj = parseReportJson(d.review && d.review.report_json);
          const seed = rj.asgard_smeta || null;
          session.state.estimate = ensureEstimate(seed || {
            meta: {
              customer: session.state.tender.customer_name || '',
              object: session.state.tender.object_name || '',
              title: 'Просчёт',
              executor: 'ООО «АСГАРД-Сервис»'
            }
          });
          session.state.files = {
            estimate: d.estimate_file || null,
            tkp: d.tkp_file || null,
            report: d.report_file || null
          };
          session.paint();
        }).catch(function (e) {
          toast('Ошибка', e.message || 'Не удалось загрузить', 'err');
        });
      }
    });
  }

  function openDemo(containerEl) {
    const tender = demoTender();
    const files = demoFiles();
    const estimate = demoEstimate(tender);
    const embedded = !!(containerEl && containerEl.nodeType === 1);

    const session = createSession({
      tender: tender,
      estimate: estimate,
      files: files,
      demo: true,
      embedded: embedded,
      tab: 'inputs',
      review: {
        decision: 'submit',
        work_price: estimate.totals && estimate.totals.price_with_vat,
        report_json: {
          mode: 'calc',
          asgard_smeta: estimate,
          cost_without_vat: estimate.totals && estimate.totals.cost
        }
      }
    });

    if (embedded) {
      containerEl.setAttribute('data-rp-calc-host', '1');
      session.state.hostEl = containerEl;
      session.paint();
      return session;
    }

    showModal({
      title: 'Просчёт (демо)',
      subtitle: tender.customer_name,
      icon: '🧮',
      html: renderShell(session.state),
      wide: true,
      fullscreen: true,
      onMount: function () {
        session.state.root = document.querySelector('[data-rp-calc-root]');
        session.bind();
      }
    });
    return session;
  }

  return {
    open: open,
    openDemo: openDemo,
    buildEmailPreviewHtml: buildEmailPreviewHtml,
    renderSmetaTableHtml: renderSmetaTableHtml
  };
})();
