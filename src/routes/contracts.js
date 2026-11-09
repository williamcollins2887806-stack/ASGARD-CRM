'use strict';

/**
 * src/routes/contracts.js
 *
 * V475: карточка договора — всё, что к нему относится.
 *
 * ЗАЧЕМ. Заказчик 08.11.2026: «в реестре договоров тоже должна быть
 * информация по счетам, работам и всему, что относится к договору. Письма,
 * ОБС, счета, работы, акты и прочее». До этого реестр показывал только
 * реквизиты — чтобы понять «сколько по договору прошло», нужно было идти
 * в реестр счетов и фильтровать вручную.
 *
 * ЧТО ЗДЕСЬ.
 *   GET /           — список договоров с числом счетов и суммой (для колонок)
 *   GET /full       — карточка договора: счета, письма, акты, работы, расходы
 *   GET /:id/full   — то же, id в пути (удобно для ссылок)
 *
 * ОБС-договоры (`subcontract_agreements`) живут отдельно от `contracts`, но
 * заказчику нужен ОДИН реестр. Поэтому список отдаёт оба вида с полем
 * `kind`: 'contract' | 'obs'.
 */

const { logError } = require('../lib/log-error');

/** Кто видит реестр договоров (совпадает с проверкой в contracts.js). */
const CONTRACT_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'DIRECTOR',
  'OFFICE_MANAGER', 'BUH', 'PROC', 'TO', 'HEAD_TO', 'PM', 'HEAD_PM',
];

function num(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Каст дат: pg отдаёт Date, наружу нужно YYYY-MM-DD. */
function d(v) {
  if (!v) return null;
  try {
    const dt = new Date(v);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  } catch (_) {
    return null;
  }
}

/** Только цифры ИНН (иначе ИНН с пробелами не совпадёт в SQL). */
function inn(v) {
  return String(v || '').replace(/\D/g, '');
}

/**
 * Необязательный запрос карточки: часть блоков (акты, расходы) может быть
 * недоступна или пуста — карточка не должна падать целиком. Но и молчать
 * нельзя: ошибка уходит в лог, иначе дефект «пустая вкладка» ищут неделями.
 */
function quiet(e, what) {
  if (e && e.code === '42P01') return { rows: [] }; // нет таблицы — блок не нужен
  if (e && e.message) console.warn('[contracts] ' + what + ': ' + e.message);
  return { rows: [] };
}

async function register(fastify) {
  const db = fastify.db || fastify.pg;

  // ───────────────────────────────────────────────────────────────────────
  // Общая сборка карточки — «всё про договор» одним ответом
  // ───────────────────────────────────────────────────────────────────────
  async function buildContractCard(kindHint, id) {
    let contract = null;
    let isObs = kindHint === 'obs';

    if (isObs) {
      const r = await db.query(
        `SELECT id, number, agreement_date, customer_name, customer_inn, counterparty_id,
                work_id, limit_amount, currency, is_active, note, created_at, updated_at
           FROM subcontract_agreements WHERE id = $1`, [id]);
      contract = r.rows[0] || null;
    } else {
      const r = await db.query(
        `SELECT ct.*, (ct.file_path IS NOT NULL OR ct.file_url IS NOT NULL) AS has_scan
           FROM contracts ct WHERE ct.id = $1`, [id]);
      contract = r.rows[0] || null;

      // Если id не нашёлся среди обычных договоров — возможно, фронт открыл
      // ОБС-строку без kind. Отдаём её, а не 404: id уникальны в своей таблице,
      // но пользователь видит один реестр и разницы не знает.
      if (!contract) {
        const alt = await db.query(
          `SELECT id, number, agreement_date, customer_name, customer_inn, counterparty_id,
                  work_id, limit_amount, currency, is_active, note, created_at, updated_at
             FROM subcontract_agreements WHERE id = $1`, [id]);
        if (alt.rows[0]) {
          contract = alt.rows[0];
          isObs = true;
        }
      }
    }
    if (!contract) return { notFound: true };

    // Лимит существенности считается функцией из V439 — второй раз не пишем.
    if (isObs) {
      const st = await db.query('SELECT * FROM subcontract_limit_state($1)', [id])
        .catch((e) => quiet(e, 'query'));
      const s = st.rows[0];
      contract.limit = s ? {
        amount: num(s.limit_amount),
        spent: num(s.spent_amount),
        remaining: num(s.remaining),
        used_pct: num(s.used_pct),
        exhausted: !!s.exhausted,
      } : null;
    } else {
      contract.limit = null;
    }

    // Ключ связи строк реестра: обычный договор → contract_id, ОБС → subcontract_id.
    const linkCol = isObs ? 'd.subcontract_id' : 'd.contract_id';
    const cpInn = inn(contract.customer_inn);

    // ── Счета (входящие, Doc Hub) ──
    // СТРОГО по связи договора: обычный → contract_id, ОБС → subcontract_id.
    // Счета по объекту сюда НЕ подмешиваем: на клоне 08.11.2026 карточка
    // КР-433п26 показывала 9 счетов, из которых 2 — КР320п26, а остальные
    // вообще без привязки. Лимит считается по конкретному договору, и списки
    // обязаны совпадать с расчётом, иначе цифры в карточке не сходятся.
    const docsIn = await db.query(
      `SELECT d.id, d.invoice_number, d.invoice_date, d.amount_gross, d.amount_net,
              d.vat_amount, d.ops_status, d.pay_status, d.payment_source,
              d.counterparty_name, d.counterparty_inn, d.contract_label,
              d.obs_account_id, d.obs_letter_doc_id, d.package_type,
              COALESCE(a.name, '') AS obs_account_name,
              COALESCE(w.work_number, '') AS work_number,
              COALESCE(w.object_name, w.work_title, '') AS object_name
         FROM doc_registry d
         LEFT JOIN obs_accounts a ON a.id = d.obs_account_id
         LEFT JOIN works w ON w.id = d.work_id
        WHERE d.deleted_at IS NULL AND d.package_type <> 'letter'
          AND ${linkCol} = $1
        ORDER BY d.invoice_date DESC NULLS LAST, d.id DESC
        LIMIT 500`, [id]).catch((e) => quiet(e, 'docs_in'));

    // ── ОБС-счета объекта БЕЗ привязки к договору ──
    // Отдельный блок, а не общий список: это работа для человека — выбрать
    // договор. Показываем только для ОБС-карточки, чтобы видеть «сколько
    // ещё не разложено по лимитам».
    const docsUnlinked = (isObs && contract.work_id) ? await db.query(
      `SELECT d.id, d.invoice_number, d.invoice_date, d.amount_gross,
              d.counterparty_name, d.contract_label
         FROM doc_registry d
        WHERE d.deleted_at IS NULL AND d.package_type <> 'letter'
          AND d.payment_source = 'obs'
          AND d.subcontract_id IS NULL
          AND d.work_id = $1
        ORDER BY d.invoice_date DESC NULLS LAST, d.id DESC
        LIMIT 100`, [contract.work_id]).catch((e) => quiet(e, 'docs_unlinked'))
      : { rows: [] };
    // Связь в несколько шагов: письмо → счёт (obs_invoice_doc_id) → договор;
    // плюс письма по ИНН контрагента; плюс письма по объекту договора —
    // у ОБС письмо выписано поставщику, а не заказчику субподряда.
    const letters = await db.query(
      `SELECT DISTINCT c.id, c.number, c.date, c.letter_kind, c.doc_type, c.subject,
              c.counterparty, c.counterparty_inn, c.status, c.file_path,
              c.obs_invoice_doc_id, c.obs_account_id,
              COALESCE(a.name, '') AS obs_account_name,
              COALESCE(dd.invoice_number, '') AS invoice_number
         FROM correspondence c
         LEFT JOIN obs_accounts a ON a.id = c.obs_account_id
         LEFT JOIN doc_registry dd ON dd.id = c.obs_invoice_doc_id
        WHERE c.deleted_at IS NULL
          AND (
            c.obs_invoice_doc_id IN (
              SELECT dd2.id FROM doc_registry dd2
               WHERE dd2.deleted_at IS NULL
                 AND dd2.${isObs ? 'subcontract_id' : 'contract_id'} = $1
            )
            ${cpInn ? `OR regexp_replace(COALESCE(c.counterparty_inn,''), '\\D', '', 'g') = $2` : ''}
            ${contract.work_id ? `OR c.work_id = $${cpInn ? 3 : 2}` : ''}
          )
        ORDER BY c.date DESC NULLS LAST, c.id DESC
        LIMIT 300`,
      cpInn
        ? (contract.work_id ? [id, cpInn, contract.work_id] : [id, cpInn])
        : (contract.work_id ? [id, contract.work_id] : [id])
    ).catch((e) => quiet(e, 'query'));

    // ── Строки-письма в самом реестре (package_type='letter') ──
    // До V473 письма жили только здесь — показываем отдельным блоком, чтобы
    // старые ИСХ не пропали из карточки.
    const registryLetters = await db.query(
      `SELECT d.id, d.invoice_number, d.invoice_date, d.dir, d.counterparty_name,
              d.obs_letter_doc_id, d.original_path_url
         FROM doc_registry d
        WHERE d.deleted_at IS NULL AND d.package_type = 'letter' AND ${linkCol} = $1
        ORDER BY d.invoice_date DESC NULLS LAST, d.id DESC
        LIMIT 200`, [id]).catch((e) => quiet(e, 'query'));

    // ── Акты по контрагенту ──
    const acts = cpInn ? await db.query(
      `SELECT id, act_number, act_date, status, amount, total_amount, description, signed_date
         FROM acts
        WHERE regexp_replace(COALESCE(customer_inn,''), '\\D', '', 'g') = $1
        ORDER BY act_date DESC NULLS LAST, id DESC
        LIMIT 200`, [cpInn]).catch((e) => quiet(e, 'query')) : { rows: [] };

    // ── Работы ──
    // Прямого contract_id у `works` НЕТ (проверено: V001, works.contract_id не
    // существует). Связываем по work_id договора, а если он пуст — по ИНН
    // заказчика. Работы «по заказчику» помечаем `link='customer'`, чтобы их
    // не выдавали за работы именно этого договора.
    let works = [];
    if (contract.work_id) {
      const r = await db.query(
        `SELECT id, work_number, work_title, object_name, work_status,
                contract_value AS amount, customer_inn
           FROM works WHERE id = $1 AND deleted_at IS NULL`, [contract.work_id])
        .catch((e) => quiet(e, 'query'));
      works = (r.rows || []).map((x) => ({ ...x, link: 'contract' }));
    }
    if (cpInn) {
      const r = await db.query(
        `SELECT id, work_number, work_title, object_name, work_status,
                contract_value AS amount, customer_inn
           FROM works
          WHERE deleted_at IS NULL
            AND regexp_replace(COALESCE(customer_inn,''), '\\D', '', 'g') = $1
            AND id <> $2
          ORDER BY id DESC LIMIT 50`,
        [cpInn, contract.work_id || 0]).catch((e) => quiet(e, 'query'));
      works = works.concat((r.rows || []).map((x) => ({ ...x, link: 'customer' })));
    }

    // ── Расходы по найденным работам ──
    // Колонки: `category` (не expense_type), `date` (не expense_date).
    const workIdsForExp = works.map((w) => w.id).filter(Boolean);
    const expenses = workIdsForExp.length ? await db.query(
      `SELECT id, work_id, category AS expense_type, amount, date AS expense_date, description
         FROM work_expenses
        WHERE work_id = ANY($1::int[])
        ORDER BY date DESC NULLS LAST, id DESC
        LIMIT 200`, [workIdsForExp]).catch((e) => quiet(e, 'expenses')) : { rows: [] };

    const docsRows = docsIn.rows || [];
    const docsSum = docsRows.reduce((s, r) => s + num(r.amount_gross), 0);
    const paidSum = docsRows
      .filter((r) => r.pay_status === 'paid')
      .reduce((s, r) => s + num(r.amount_gross), 0);
    const actsRows = acts.rows || [];

    return {
      kind: isObs ? 'obs' : 'contract',
      contract,
      docs_in: docsRows.map((r) => ({
        id: r.id,
        invoice_number: r.invoice_number,
        invoice_date: d(r.invoice_date),
        amount: num(r.amount_gross),
        amount_net: num(r.amount_net),
        vat_amount: num(r.vat_amount),
        ops_status: r.ops_status,
        pay_status: r.pay_status,
        payment_source: r.payment_source,
        counterparty_name: r.counterparty_name,
        counterparty_inn: r.counterparty_inn,
        contract_label: r.contract_label,
        obs_account_id: r.obs_account_id,
        obs_account_name: r.obs_account_name || null,
        obs_letter_doc_id: r.obs_letter_doc_id,
        work_number: r.work_number || null,
        object_name: r.object_name || null,
      })),
      docs_unlinked: (docsUnlinked.rows || []).map((r) => ({
        id: r.id,
        invoice_number: r.invoice_number,
        invoice_date: d(r.invoice_date),
        amount: num(r.amount_gross),
        counterparty_name: r.counterparty_name,
        contract_label: r.contract_label,
      })),
      letters: (letters.rows || []).map((r) => ({
        id: r.id,
        number: r.number,
        date: d(r.date),
        letter_kind: r.letter_kind,
        doc_type: r.doc_type,
        subject: r.subject,
        counterparty: r.counterparty,
        counterparty_inn: r.counterparty_inn,
        status: r.status,
        has_file: !!r.file_path,
        obs_invoice_doc_id: r.obs_invoice_doc_id,
        obs_account_name: r.obs_account_name || null,
        invoice_number: r.invoice_number || null,
      })),
      registry_letters: (registryLetters.rows || []).map((r) => ({
        id: r.id,
        number: r.invoice_number,
        date: d(r.invoice_date),
        dir: r.dir,
        counterparty_name: r.counterparty_name,
        link_doc_id: r.obs_letter_doc_id,
        file_url: r.original_path_url || null,
      })),
      acts: actsRows.map((r) => ({
        id: r.id,
        number: r.act_number,
        date: d(r.act_date),
        status: r.status,
        amount: num(r.total_amount || r.amount),
        description: r.description,
      })),
      works: works.map((r) => ({
        id: r.id,
        number: r.work_number,
        title: r.work_title,
        object_name: r.object_name,
        status: r.work_status,
        amount: r.amount != null ? num(r.amount) : null,
        link: r.link,
      })),
      expenses: (expenses.rows || []).map((r) => ({
        id: r.id,
        work_id: r.work_id,
        type: r.expense_type,
        amount: num(r.amount),
        date: d(r.expense_date),
        description: r.description,
      })),
      totals: {
        docs_count: docsRows.length,
        docs_sum: docsSum,
        paid_sum: paidSum,
        unpaid_sum: Math.max(0, docsSum - paidSum),
        letters_count: (letters.rows || []).length + (registryLetters.rows || []).length,
        acts_count: actsRows.length,
        acts_sum: actsRows.reduce((s, r) => s + num(r.total_amount || r.amount), 0),
        works_count: works.length,
        obs_docs_sum: docsRows
          .filter((r) => r.payment_source === 'obs')
          .reduce((s, r) => s + num(r.amount_gross), 0),
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // GET / — список договоров + агрегаты
  // ───────────────────────────────────────────────────────────────────────
  fastify.get('/', { preHandler: [fastify.requireRoles(CONTRACT_ROLES)] }, async (req, reply) => {
    try {
      const search = String(req.query.search || '').trim();
      const kind = String(req.query.kind || '').trim();     // '' | 'contract' | 'obs'
      const status = String(req.query.status || '').trim();
      const includeObs = kind !== 'contract';

      const params = [];
      const conds = [];
      if (search) {
        params.push('%' + search.toLowerCase() + '%');
        conds.push(`(lower(COALESCE(number,'')) LIKE $${params.length}
                     OR lower(COALESCE(counterparty_name,'')) LIKE $${params.length})`);
      }
      if (status) {
        params.push(status);
        conds.push(`status = $${params.length}`);
      }
      const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

      const consRes = await db.query(
        `SELECT ct.id, ct.number, ct.type, ct.status, ct.subject, ct.amount,
                ct.start_date, ct.end_date, ct.is_perpetual,
                ct.counterparty_id, ct.counterparty_name, ct.customer_inn,
                ct.customer_name, ct.work_id, ct.tender_id,
                (ct.file_path IS NOT NULL OR ct.file_url IS NOT NULL) AS has_scan,
                COALESCE(agg.docs_count, 0)::int AS docs_count,
                COALESCE(agg.docs_amount, 0)::numeric AS docs_amount,
                COALESCE(agg.letters_count, 0)::int AS letters_count
           FROM contracts ct
           LEFT JOIN LATERAL (
             SELECT count(*) FILTER (WHERE d.package_type <> 'letter')::int AS docs_count,
                    COALESCE(sum(d.amount_gross) FILTER (WHERE d.package_type <> 'letter'), 0) AS docs_amount,
                    count(*) FILTER (WHERE d.package_type = 'letter')::int AS letters_count
               FROM doc_registry d
              WHERE d.deleted_at IS NULL AND d.contract_id = ct.id
           ) agg ON TRUE
           ${where}
          ORDER BY ct.start_date DESC NULLS LAST, ct.id DESC
          LIMIT 1000`, params).catch((e) => {
        logError(fastify, '[contracts] list', e, req);
        return { rows: [] };
      });

      let obsRows = [];
      if (includeObs) {
        const obsRes = await db.query(
          `SELECT a.id, a.number, a.agreement_date, a.customer_name, a.customer_inn,
                  a.counterparty_id, a.work_id, a.limit_amount, a.is_active,
                  COALESCE(agg.docs_count, 0)::int AS docs_count,
                  COALESCE(agg.docs_amount, 0)::numeric AS docs_amount,
                  COALESCE(agg.letters_count, 0)::int AS letters_count,
                  COALESCE(st.spent_amount, 0)::numeric AS spent_amount,
                  COALESCE(st.remaining, a.limit_amount)::numeric AS remaining,
                  COALESCE(st.used_pct, 0)::numeric AS used_pct,
                  COALESCE(st.exhausted, FALSE) AS exhausted
             FROM subcontract_agreements a
             LEFT JOIN LATERAL (
               SELECT count(*) FILTER (WHERE d.package_type <> 'letter')::int AS docs_count,
                      COALESCE(sum(d.amount_gross) FILTER (WHERE d.package_type <> 'letter'), 0) AS docs_amount,
                      count(*) FILTER (WHERE d.package_type = 'letter')::int AS letters_count
                 FROM doc_registry d
                WHERE d.deleted_at IS NULL AND d.subcontract_id = a.id
             ) agg ON TRUE
             LEFT JOIN LATERAL subcontract_limit_state(a.id) st ON TRUE
            WHERE a.is_active = TRUE
            ORDER BY a.agreement_date DESC NULLS LAST, a.id DESC`).catch((e) => {
        logError(fastify, '[contracts] list obs', e, req);
        return { rows: [] };
      });
        obsRows = obsRes.rows || [];
      }

      const items = [
        ...consRes.rows.map((r) => ({
          kind: 'contract',
          id: r.id,
          number: r.number,
          type: r.type,
          status: r.status,
          subject: r.subject,
          amount: r.amount != null ? num(r.amount) : null,
          start_date: d(r.start_date),
          end_date: d(r.end_date),
          is_perpetual: !!r.is_perpetual,
          counterparty_name: r.counterparty_name || r.customer_name,
          counterparty_inn: r.customer_inn,
          counterparty_id: r.counterparty_id,
          work_id: r.work_id,
          tender_id: r.tender_id,
          has_scan: !!r.has_scan,
          docs_count: num(r.docs_count),
          docs_amount: num(r.docs_amount),
          letters_count: num(r.letters_count),
          limit: null,
        })),
        ...obsRows.map((r) => ({
          kind: 'obs',
          id: r.id,
          number: r.number,
          type: 'obs',
          status: r.is_active ? 'active' : 'terminated',
          subject: 'Договор субподряда (ОБС)',
          amount: r.limit_amount != null ? num(r.limit_amount) : null,
          start_date: d(r.agreement_date),
          end_date: null,
          is_perpetual: false,
          counterparty_name: r.customer_name,
          counterparty_inn: r.customer_inn,
          counterparty_id: r.counterparty_id,
          work_id: r.work_id,
          tender_id: null,
          has_scan: false,
          docs_count: num(r.docs_count),
          docs_amount: num(r.docs_amount),
          letters_count: num(r.letters_count),
          limit: {
            amount: num(r.limit_amount),
            spent: num(r.spent_amount),
            remaining: num(r.remaining),
            used_pct: num(r.used_pct),
            exhausted: !!r.exhausted,
          },
        })),
      ];

      // ОБС-строки первыми: по ним чаще спрашивают «сколько осталось».
      items.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'obs' ? -1 : 1;
        return String(b.start_date || '').localeCompare(String(a.start_date || ''));
      });

      return { items, total: items.length };
    } catch (err) {
      logError(fastify, '[contracts] GET /', err, req);
      return reply.code(500).send({ error: 'Не удалось получить договоры' });
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /full — карточка договора
  // ───────────────────────────────────────────────────────────────────────
  // Параметры: ?kind=contract|obs&id=N  (или ?contract_id=N / ?subcontract_id=N)
  fastify.get('/full', { preHandler: [fastify.requireRoles(CONTRACT_ROLES)] }, async (req, reply) => {
    try {
      const kind = String(req.query.kind || 'contract');
      const rawId = req.query.id
        || (kind === 'obs' ? req.query.subcontract_id : req.query.contract_id);
      const id = parseInt(rawId, 10);
      if (!id || isNaN(id)) return reply.code(400).send({ error: 'Нужен id договора' });

      const card = await buildContractCard(kind, id);
      if (card.notFound) return reply.code(404).send({ error: 'Договор не найден' });
      return card;
    } catch (err) {
      logError(fastify, '[contracts] GET /full', err, req);
      return reply.code(500).send({ error: 'Не удалось собрать карточку договора' });
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /:id/full — то же, id в пути
  // ───────────────────────────────────────────────────────────────────────
  fastify.get('/:id/full', { preHandler: [fastify.requireRoles(CONTRACT_ROLES)] }, async (req, reply) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return reply.code(400).send({ error: 'Неверный id' });
      const kind = String(req.query.kind || 'contract');

      const card = await buildContractCard(kind, id);
      if (card.notFound) return reply.code(404).send({ error: 'Договор не найден' });
      return card;
    } catch (err) {
      logError(fastify, '[contracts] GET /:id/full', err, req);
      return reply.code(500).send({ error: 'Не удалось собрать карточку договора' });
    }
  });
}

module.exports = register;
