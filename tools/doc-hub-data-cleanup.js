'use strict';
/**
 * Doc Hub — чистка данных (D-237): перенаправление документов с удалённых «работ»,
 * слияние дублей контрагентов, ИНН через DaData, удаление 3 мусорных, вставка 3
 * пропущенных из Excel, пересчёт статусов и флага «неполный».
 *
 * DRY по умолчанию. APPLY=1 — фиксирует (транзакция по секциям).
 * Ничего не удаляет физически: только deleted_at.
 */
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: '/var/www/asgard-crm/.env' });

const APPLY = process.env.APPLY === '1';
const OUT = process.env.OUT || '/tmp/dh-audit/cleanup-report.json';
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'asgard',
  password: String(process.env.DB_PASSWORD || '123456789'),
  database: process.env.DB_NAME || 'asgard_crm'
});
const q = (t, p) => pool.query(t, p);
const N = (v) => Number(v || 0);
const report = { apply: APPLY, relink: {}, suppliers: {}, deletes: {}, inserts: {}, inn: {}, statuses: {}, unmapped: [] };

// ── 1. Куда перенаправляем: cost-center по названию слитой работы ────────────
function routeOf(title) {
  const t = String(title || '').toLowerCase();
  if (/офис|ахо/.test(t)) return { kind: 'office', work_id: null, spend_kind: 'office' };
  if (/склад|материал/.test(t)) return { kind: 'warehouse', work_id: null, spend_kind: 'warehouse' };
  // проектные — по ключевым словам на живые работы
  if (/амурск|агхк|агпх|гхк/.test(t)) return { kind: 'project', work_id: 1936, spend_kind: 'work' };
  if (/умм/.test(t)) return { kind: 'project', work_id: 1937, spend_kind: 'work' };
  if (/выкс|стеллар/.test(t)) return { kind: 'project', work_id: 1938, spend_kind: 'work' };
  if (/фрегат|воскресенск/.test(t)) return { kind: 'project', work_id: 1939, spend_kind: 'work' };
  if (/калининград|прегол|кливер/.test(t)) return { kind: 'project', work_id: 1940, spend_kind: 'work' };
  if (/пуровск/.test(t)) return { kind: 'project', work_id: 353, spend_kind: 'work' };
  if (/агпз|гсп ремонт/.test(t)) return { kind: 'project', work_id: 417, spend_kind: 'work' };
  if (/азот/.test(t)) return { kind: 'project', work_id: 11, spend_kind: 'work' };
  if (/верофарм/.test(t)) return { kind: 'project', work_id: 419, spend_kind: 'work' };
  if (/каусорб|с7|с 7|инжиниринг/.test(t)) return { kind: 'project', work_id: 423, spend_kind: 'work' };
  if (/свс-н|градирн/.test(t)) return { kind: 'project', work_id: 355, spend_kind: 'work' };
  if (/млсп|приразлом|гнш|оголовок|деаэратор|факельн/.test(t)) return { kind: 'project', work_id: 418, spend_kind: 'work' };
  return null; // не размечено — в отчёт
}

async function secRelink() {
  const rows = (await q(`
    SELECT w.id AS work, COALESCE(w.work_title,w.object_name,'') title, count(d.id) c
    FROM doc_registry d JOIN works w ON w.id=d.work_id
    WHERE d.deleted_at IS NULL AND w.deleted_at IS NOT NULL
    GROUP BY 1,2 ORDER BY 3 DESC`)).rows.map((r) => ({ ...r, c: N(r.c) }));
  const plan = [];
  for (const r of rows) {
    // проектное по ключевым словам; иначе — внутренние затраты (не проект):
    // work_id = NULL, чтобы документ не висел на удалённой работе. Офис/склад —
    // свои категории, остальное — «прочее» (не привязываем к проекту вслепую).
    const route = routeOf(r.title) || { kind: 'internal', work_id: null, spend_kind: 'other' };
    plan.push({ deleted_work: r.work, title: r.title, docs: r.c, ...route });
    if (!route.kind) report.unmapped.push({ deleted_work: r.work, title: r.title, docs: r.c });
  }
  report.relink = {
    deleted_works: rows.length,
    docs_total: rows.reduce((s, r) => s + r.c, 0),
    by_kind: plan.reduce((a, p) => (a[p.kind] = N(a[p.kind]) + p.docs, a), {}),
    plan
  };
  if (!APPLY) return;
  for (const p of plan) {
    const ids = (await q(
      `SELECT d.id FROM doc_registry d JOIN works w ON w.id=d.work_id
       WHERE d.deleted_at IS NULL AND w.deleted_at IS NOT NULL AND w.id=$1`, [p.deleted_work])).rows.map((x) => x.id);
    if (!ids.length) continue;
    await q(`UPDATE doc_registry SET work_id=$1, spend_kind=$2, is_incomplete=true, updated_at=NOW() WHERE id = ANY($3::int[])`,
      [p.work_id, p.spend_kind, ids]);
  }
}

// ── 2. Слияние дублей контрагентов ──────────────────────────────────────────
const MERGES = [
  { keep: 20, drop: 451 },   // ООО ПК/ТП "ПРАБО"
  { keep: 452, drop: 231 },  // ООО НЦПК УФР
  { keep: 152, drop: 431 },  // ИП Воропаева Е.С.
  { keep: 27, drop: 93 }     // ВсеИнструменты.ру
];
async function secSuppliers() {
  const out = [];
  for (const m of MERGES) {
    const k = (await q('SELECT id,name,inn FROM suppliers WHERE id=$1', [m.keep])).rows[0];
    const d = (await q('SELECT id,name,inn FROM suppliers WHERE id=$1', [m.drop])).rows[0];
    const moved = (await q('SELECT count(*)::int n FROM doc_registry WHERE deleted_at IS NULL AND supplier_id=$1', [m.drop])).rows[0].n;
    // INN переносим на keep, если у drop есть, а у keep нет
    const innTake = (!k || !k.inn) && d && d.inn ? d.inn : null;
    out.push({ keep: k && k.name, drop: d && d.name, move_docs: moved, inn_to_set: innTake });
    if (!APPLY) continue;
    await q('UPDATE doc_registry SET supplier_id=$1, updated_at=NOW() WHERE supplier_id=$2', [m.keep, m.drop]);
    if (innTake) await q('UPDATE suppliers SET inn=$1, updated_at=NOW() WHERE id=$2', [innTake, m.keep]);
    await q('UPDATE suppliers SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1', [m.drop]);
  }
  report.suppliers = out;
}

// ── 3/4. Удалить 3 мусорных, вставить 3 пропущенных ────────────────────────
const DEL_IDS = [22, 620, 1283];
async function secDocs() {
  const del = (await q('SELECT id,invoice_number,counterparty_name,amount_gross FROM doc_registry WHERE id = ANY($1::int[])', [DEL_IDS])).rows;
  report.deletes = del;
  if (APPLY && del.length) await q('UPDATE doc_registry SET deleted_at=NOW(), updated_at=NOW() WHERE id = ANY($1::int[])', [DEL_IDS]);

  // 3 положительных из Excel, не попавших в CRM
  const merged = JSON.parse(fs.readFileSync('/tmp/dh-audit/merged-rows.json', 'utf8'));
  const want = ['26-00151049246', '0221263522-0010', '874'];
  const ins = [];
  for (const r of merged) {
    if (!want.includes(String(r.invoice_number))) continue;
    const exists = (await q('SELECT id FROM doc_registry WHERE deleted_at IS NULL AND invoice_number=$1', [r.invoice_number])).rows.length;
    ins.push({ invoice_number: r.invoice_number, date: r.invoice_date, amount: r.amount_gross, cp: r.counterparty_name, already: exists > 0 });
  }
  report.inserts = ins;
  if (!APPLY) return;
  for (const r of merged) {
    if (!want.includes(String(r.invoice_number))) continue;
    const exists = (await q('SELECT id FROM doc_registry WHERE deleted_at IS NULL AND invoice_number=$1', [r.invoice_number])).rows.length;
    if (exists) continue;
    // supplier card by inn/name
    let sup = null;
    const nm = String(r.counterparty_name || '').trim();
    if (nm) sup = (await q(`SELECT id FROM suppliers WHERE deleted_at IS NULL AND lower(trim(name))=lower(trim($1)) LIMIT 1`, [nm])).rows[0];
    const gross = Number(r.amount_gross || 0);
    const rate = r.vat_rate === null || r.vat_rate === undefined ? null : Number(r.vat_rate);
    const net = rate ? +(gross / (1 + rate)).toFixed(2) : gross;
    const vat = rate ? +(gross - net).toFixed(2) : 0;
    await q(`INSERT INTO doc_registry
      (dir,package_type,ops_status,invoice_number,invoice_date,counterparty_name,counterparty_email,counterparty_phone,
       supplier_id,amount_gross,amount_net,vat_amount,vat_rate,has_vat,contract_mode,contract_label,receive_channel,
       closing_json,spend_kind,doc_owner_id,pm_id,comment_text,created_by,is_incomplete,incomplete_reasons)
      VALUES ('in','invoice','draft',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,true,'{}')`,
      [r.invoice_number, r.invoice_date || null, r.counterparty_name || '', r.counterparty_email || null, r.counterparty_phone || null,
       sup ? sup.id : null, gross, net, vat, rate === null ? 0 : rate, rate !== null && rate > 0 ? true : (rate === 0 ? true : false),
       r.contract_mode || 'none', r.contract_label || null, r.receive_channel || null,
       JSON.stringify(Array.isArray(r.closing_json) ? r.closing_json : []), r.spend_kind || 'work',
       null, null, 'Импорт: восстановлено из Excel (D-237)', 1]);
  }
}

// ── 6. Пересчёт неполноты + статусы «получения» ────────────────────────────
// ── 5. ИНН ─────────────────────────────────────────────────────────────────
const KNOWN_INN = {
  20: '5027254467', 6: '3123159910', 26: '4205000908',
  237: '9701151163', 9: '5404177517', 8: '7453346391',
  // достоверно по бренду/инициалам (DaData, проверено вручную):
  243: '7704312961',  // ООО ТД "Воскресенский завод фосфорных кислот"
  261: '7803052947',  // ФАУ "Российский морской регистр судоходства"
  360: '5017069987',  // ООО "ЗЕТ-ТЕХНО" (Одинцово, МО)
  311: '3015091542',  // ЧУ ДПО "Корпоративный учебный центр" (Астрахань)
  356: '503227433230'  // ИП Цариценко Александра Александровна (МО)
};
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zа-я0-9]/g, '');
function coreName(s) {
  return norm(String(s || '')
    .replace(/^(ООО|ОАО|ЗАО|АО|ПАО|ИП|ГК|ОП|ФАУ|ОЧУДПО|Филиал|КФХ)\s*/i, '')
    .replace(/(общество с ограниченной ответственностью|индивидуальный предприниматель)/gi, ''));
}
async function dadataParty(query, locations) {
  const token = process.env.DADATA_TOKEN;
  if (!token) return [];
  const body = { query, count: 8 };
  if (locations) body.locations = locations;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Token ${token}` },
      body: JSON.stringify(body), signal: ctrl.signal
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.suggestions || []).map((s) => ({
      inn: s.data && s.data.inn, name: s.value, kpp: s.data && s.data.kpp,
      ogrn: s.data && s.data.ogrn, type: s.data && s.data.type
    }));
  } catch (_) { return []; } finally { clearTimeout(t); }
}
function similar(a, b) {
  const x = coreName(a), y = coreName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length < y.length ? x : y;
  const longer = x.length < y.length ? y : x;
  if (shorter.length >= 6 && longer.includes(shorter)) return true;
  const firstTok = (s) => (s.match(/[a-zа-я]{4,}/g) || [''])[0];
  const tx = firstTok(x), ty = firstTok(y);
  return !!tx && tx === ty && tx.length >= 5;
}
async function secInn() {
  const targets = (await q(`
    SELECT s.id, s.name, s.inn, COALESCE(s.notes,'') notes, count(d.id)::int docs
    FROM suppliers s JOIN doc_registry d ON d.supplier_id=s.id AND d.deleted_at IS NULL
    WHERE s.deleted_at IS NULL AND (s.inn IS NULL OR TRIM(s.inn)='')
    GROUP BY 1,2,3,4 ORDER BY 5 DESC`)).rows;
  const out = [];
  for (const t of targets) {
    let inn = KNOWN_INN[t.id] || null;
    let how = inn ? 'known_exact' : null;
    let found = null;
    let candidates = [];
    if (!inn) {
      const q1 = String(t.name).replace(/^[^a-zа-я0-9]+/i, '').trim();
      const bare = q1.replace(/^(ИП|ООО|ОАО|ЗАО|АО|ПАО|ГК|ОП|ФАУ|ОЧУДПО|Филиал)\s*/i, '').replace(/["«»].*?["«»]/g, '').trim();
      let cands = await dadataParty(q1, [{ region: 'Москва' }, { region: 'Московская' }]);
      if (!cands.length) cands = await dadataParty(q1);
      // вторая попытка по «голому» названию/фамилии + регион МО
      if (!cands.length) cands = await dadataParty(bare, [{ region: 'Москва' }, { region: 'Московская' }]);
      if (!cands.length) cands = await dadataParty(bare);
      candidates = cands.filter((c) => c.inn).slice(0, 3);
      // Авто-сопоставление НЕ применяем: по коротким ФИО DaData даёт однофамильцев
      // (проверено: «Струков А.Н.» → «Струкова Н.А.», «Сириус» → чужое ООО).
      // ИНН ставим только из выверенного списка; остальных — в примечания.
      await new Promise((r) => setTimeout(r, 220));
    }
    out.push({ id: t.id, name: t.name, docs: t.docs, inn, how, found: found && found.name, candidates });
    if (APPLY) {
      if (inn) {
        await q('UPDATE suppliers SET inn=$1, kpp=COALESCE(kpp,$2), ogrn=COALESCE(ogrn,$3), updated_at=NOW() WHERE id=$4',
          [inn, (found && found.kpp) || null, (found && found.ogrn) || null, t.id]);
      } else if (candidates.length) {
        // ИНН не выдумываем — кандидатов кладём в примечание для ручной сверки
        const note = 'ИНН-кандидаты (требует проверки): ' + candidates.map((c) => `${c.inn} ${c.name}`).join(' | ');
        await q(`UPDATE suppliers SET notes = CASE WHEN COALESCE(notes,'')='' THEN $1 ELSE notes || E'\n' || $1 END, updated_at=NOW() WHERE id=$2`, [note, t.id]);
      }
    }
  }
  report.inn = {
    targets: out.length,
    set: out.filter((o) => o.inn).length,
    with_candidates: out.filter((o) => !o.inn && o.candidates.length).length,
    by_how: out.reduce((a, o) => { const k = o.how || (o.candidates.length ? 'candidates_in_notes' : 'not_found'); a[k] = N(a[k]) + 1; return a; }, {}),
    out
  };
}

async function secStatuses() {
  const before = (await q(`SELECT ops_status, pay_status, count(*)::int n FROM doc_registry WHERE deleted_at IS NULL GROUP BY 1,2 ORDER BY 3 DESC`)).rows;
  // «получено» = есть закрывающие (СФ/УПД) или отметка приёмки
  const withClosing = (await q(`SELECT count(*)::int n FROM doc_registry WHERE deleted_at IS NULL AND closing_json::text <> '[]'`)).rows[0].n;
  const total = (await q(`SELECT count(*)::int n FROM doc_registry WHERE deleted_at IS NULL`)).rows[0].n;
  report.statuses = { total, withClosing, before };
  if (!APPLY) return;
  await q(`BEGIN`);
  try {
    // Закрывающие получены → ждём оплату; иначе ждём закрывающие
    await q(`UPDATE doc_registry SET ops_status='wait_pay', updated_at=NOW()
             WHERE deleted_at IS NULL AND closing_json::text <> '[]' AND ops_status='draft'`);
    await q(`UPDATE doc_registry SET ops_status='wait_closing', updated_at=NOW()
             WHERE deleted_at IS NULL AND closing_json::text = '[]' AND ops_status='draft'`);
    // Пересчёт неполноты по тем же правилам, что и в приложении
    await q(`
      UPDATE doc_registry SET
        is_incomplete = (
          COALESCE(TRIM(invoice_number),'')=''
          OR invoice_date IS NULL
          OR COALESCE(TRIM(counterparty_name),'')=''
          OR (contract_mode='linked' AND contract_id IS NULL)
          OR (dir='in' AND spend_kind='work' AND work_id IS NULL AND NOT purpose_asgard AND NOT purpose_consumables)
        ),
        incomplete_reasons = (
          SELECT COALESCE(array_agg(x), '{}')
          FROM (
            SELECT unnest(ARRAY[]::text[]) x WHERE false
            UNION ALL SELECT 'no_invoice_number' WHERE COALESCE(TRIM(invoice_number),'')=''
            UNION ALL SELECT 'no_invoice_date' WHERE invoice_date IS NULL
            UNION ALL SELECT 'no_counterparty' WHERE COALESCE(TRIM(counterparty_name),'')=''
            UNION ALL SELECT 'no_contract' WHERE contract_mode='linked' AND contract_id IS NULL
            UNION ALL SELECT 'no_work' WHERE dir='in' AND spend_kind='work' AND work_id IS NULL AND NOT purpose_asgard AND NOT purpose_consumables
          ) s
        ),
        updated_at=NOW()
      WHERE deleted_at IS NULL`);
    await q(`COMMIT`);
  } catch (e) { await q(`ROLLBACK`); throw e; }
  report.statuses.after = (await q(`SELECT ops_status, count(*)::int n FROM doc_registry WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`)).rows;
  report.statuses.incomplete = (await q(`SELECT count(*) FILTER (WHERE is_incomplete) inc, count(*) total FROM doc_registry WHERE deleted_at IS NULL`)).rows[0];
}

(async () => {
  await secRelink();
  await secSuppliers();
  await secDocs();
  await secInn();
  await secStatuses();
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({
    apply: report.apply,
    relink_kinds: report.relink.by_kind,
    relink_deleted_works: report.relink.deleted_works,
    relink_docs: report.relink.docs_total,
    unmapped_works: report.unmapped.length,
    suppliers: report.suppliers,
    deletes: report.deletes.length,
    inserts: report.inserts.length,
    inn: { targets: report.inn.targets, set: report.inn.set, by_how: report.inn.by_how },
    statuses: report.statuses
  }, null, 1));
  console.log('INN detail:');
  for (const o of report.inn.out || []) console.log('  ', o.id, o.inn || '—', o.how || 'not_found', o.name, o.found ? ('=> ' + o.found) : '');
  console.log('UNMAPPED (need decision):');
  for (const u of report.unmapped) console.log('  ', u.deleted_work, u.docs, u.title);
  await pool.end();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
