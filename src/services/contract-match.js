'use strict';

/**
 * V404 (замечание заказчика 17.10.2026): сопоставить основание из счёта с
 * договором в CRM и подтянуть объект/работу.
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик: «счёт выставили, а договора-основания, который в нём указан, нет
 * в СРМ — проверь, как создастся договор или как это подсветится».
 * Ответ: договор НЕ создаём молча (это документ с юр. последствиями) —
 * помечаем `contract_missing=true`, и директор/бух видят красную плашку
 * «Договор № X не найден в CRM». Это закрывает риск оплаты «по воздуху».
 *
 * Сопоставление — по нормализованному номеру (без пробелов/кавычек/№), сначала
 * точное, затем по вхождению номера. Сравниваем и с контрагентом, если он есть.
 */

/** Нормализовать номер договора: «ДП-2025/01», «№ ДП 2025 01» → «дп2025/01».
 * D-319 (верификатор 21.10.2026): точку НЕ оставляем. Раньше JS сохранял точку
 * («12.03/1339»), а SQL-нормализация ниже точку вырезала («1203/1339») — номера
 * никогда не сходились, и договоры с точкой (на проде их 10) не находились ВСЕГДА.
 * Из-за этого у счетов «Безопасности Труда» висел ложный «договор не найден». */
function normContractNo(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[№#«»"'`]/g, '')
    .replace(/[.\s]+/g, '')
    .trim();
}

/**
 * Найти договор по основанию из счёта.
 * @param {object} db
 * @param {{number?:string, date?:string, counterpartyInn?:string, counterpartyName?:string}} basis
 * @returns {Promise<{found:boolean, contract?:object, candidates?:Array, reason:string}>}
 */
async function matchContract(db, basis = {}) {
  const num = normContractNo(basis.number);
  if (!num) return { found: false, reason: 'no_number' };

  // Нормализация номера на стороне Postgres: убираем №, кавычки, пробелы.
  const NORM_SQL = `regexp_replace(coalesce(number,''), '[^a-zA-Z0-9а-яА-ЯёЁ/\\-]', '', 'g')`;
  const inn = String(basis.counterpartyInn || '').replace(/\D/g, '');
  const cpName = String(basis.counterpartyName || '').trim();

  // 1. Точное совпадение по нормализованному номеру.
  // ВАЖНО: при дублях номеров выбор ОБЯЗАН быть детерминированным (LIMIT 1 без
  // ORDER BY давал то один, то другой договор между прогонами). Приоритет —
  // совпадение контрагента (ИНН, затем имя), далее самый ранний id.
  //
  // D-293 (аудит 20.10.2026): номер договора НЕ уникален между контрагентами.
  // На проде счёт ООО «Электротехническая компания» (ИНН 3015042714) привязался
  // к договору 56201 другого контрагента — ООО «ТМХ-ЭЛЕКТРОТЕХ» (ИНН 7704469592),
  // только потому что номер совпал. Формально "ORDER BY" ставил совпадение ИНН
  // первым, но при отсутствии такого договора всё равно возвращал ЧУЖОЙ —
  // и код ставил зелёный флаг «договор найден».
  // Теперь: если в счёте есть ИНН контрагента, а у найденного договора ИНН
  // ДРУГОЙ — это НЕ совпадение. Возвращаем found:false с причиной, чтобы UI
  // подсветил «договора нет», а не врал зелёным.
  const exact = await db.query(
    `SELECT id, number, counterparty_name, customer_inn, start_date, end_date, status, work_id,
            CASE WHEN $2 <> '' AND regexp_replace(coalesce(customer_inn,''), '\\D', '', 'g') = $2 THEN true ELSE false END AS inn_match
       FROM contracts
      WHERE lower(${NORM_SQL}) = $1
      ORDER BY
        CASE WHEN $2 <> '' AND regexp_replace(coalesce(customer_inn,''), '\\D', '', 'g') = $2 THEN 0 ELSE 1 END,
        CASE WHEN $3 <> '' AND lower(coalesce(counterparty_name,'')) = lower($3) THEN 0 ELSE 1 END,
        id ASC
      LIMIT 1`,
    [num, inn, cpName]
  );
  if (exact.rows[0]) {
    const hit = exact.rows[0];
    // Если ИНН в счёте известен и в договоре известен, но НЕ совпадают —
    // это чужой договор с тем же номером.
    const contractInn = String(hit.customer_inn || '').replace(/\D/g, '');
    if (inn && contractInn && contractInn !== inn) {
      return {
        found: false,
        reason: 'number_taken_by_other_counterparty',
        candidates: [hit],
        conflict: { wanted_inn: inn, contract_inn: contractInn, contract_id: hit.id, number: hit.number }
      };
    }
    return { found: true, contract: hit, reason: 'exact' };
  }

  // 2. По вхождению номера (в счёте могут дописать «оплата по ДП-2025/01 от …»).
  // ВАЖНО (FAIL верификатора 17.10.2026): короткий обобщённый номер («26») давал
  // ЛОЖНУЮ привязку чужого договора («ГНШ-26/11000/00120/Р») → зелёный флаг там,
  // где заказчик ждёт красную подсветку. Нечёткий поиск разрешаем только для
  // достаточно длинных номеров, в которых есть БУКВА или разделитель (специфичность).
  const fuzzyOk = num.length >= 5 && /[a-zа-яё/\\-]/i.test(num);
  if (!fuzzyOk) {
    // Отдельно: если номер целиком из цифр — ищем точное совпадение с нормализованным
    // номером, а не подстроку (иначе «26» цепляет «.../26/...»).
    //
    // FAIL верификатора 22.10.2026, п.4a: у номера без цифр («б/н», «АКТ», «ABC»)
    // `replace(/\D/g,'')` даёт ПУСТУЮ строку, и запрос `= ''` возвращал ПЕРВЫЙ
    // договор, у которого в номере тоже нет цифр — на проде это «Счет-оферта»
    // ООО «РВБ» (#30). Счёт с основанием «б/н» привязывался к ЧУЖОМУ договору
    // (11 документов уже привязано). Пустой номер — не ключ: не ищем вовсе.
    const digitsOnly = num.replace(/\D/g, '');
    if (!digitsOnly) return { found: false, reason: 'not_found', candidates: [] };
    const exactNum = await db.query(
      `SELECT id, number, counterparty_name, customer_inn, status
         FROM contracts
        WHERE regexp_replace(coalesce(number,''), '\\D', '', 'g') = $1
          AND $2 <> ''
          AND ($2 = '' OR regexp_replace(coalesce(customer_inn,''), '\\D', '', 'g') = $2
               OR coalesce(customer_inn,'') = '')
        ORDER BY id ASC LIMIT 1`,
      [digitsOnly, inn]
    );
    if (exactNum.rows[0]) return { found: true, contract: exactNum.rows[0], reason: 'exact_digits' };
    return { found: false, reason: 'not_found', candidates: [] };
  }
  const like = await db.query(
    `SELECT id, number, counterparty_name, customer_inn, start_date, end_date, status, work_id
       FROM contracts
      WHERE lower(${NORM_SQL}) LIKE '%' || $1 || '%'
      ORDER BY
        CASE WHEN $2 <> '' AND regexp_replace(coalesce(customer_inn,''), '\\D', '', 'g') = $2 THEN 0 ELSE 1 END,
        id ASC
      LIMIT 5`,
    [num, inn]
  );
  if (like.rows.length === 1) return { found: true, contract: like.rows[0], reason: 'contains' };
  if (like.rows.length > 1) return { found: false, reason: 'ambiguous', candidates: like.rows };

  // 3. Не нашли — возвращаем возможные похожие (для подсказки человеку).
  const tail = num.replace(/[^а-яёa-z0-9]/g, '').slice(-6);
  let candidates = [];
  if (tail.length >= 3) {
    const cand = await db.query(
      `SELECT id, number, counterparty_name, status
         FROM contracts
        WHERE lower(${NORM_SQL}) LIKE '%' || $1 || '%'
        LIMIT 5`,
      [tail]
    ).catch(() => ({ rows: [] }));
    candidates = cand.rows;
  }
  return { found: false, reason: 'not_found', candidates };
}

/**
 * Подтянуть работу (объект) по подсказке из счёта/письма.
 *
 * Заказчик 18.10.2026: «люди постоянно пишут неправильно — сделай, чтобы привязывал».
 * Поэтому сопоставление многоступенчатое и ПРОЩАЮЩЕЕ к формулировке:
 *   0. нормализация подсказки (убрать «Объект:», «корпус N», литеры, лишние запятые);
 *   1. ТОЧНОЕ совпадение названия/объекта;
 *   2. номер работы ИЛИ номер в подсказке («объект № 123» ↔ work_number);
 *   3. ПОЛНОЕ вхождение (подсказка внутри названия);
 *   4. ВСЕ значимые слова подсказки присутствуют (мультислово, любой порядок);
 *   5. похожесть через pg_trgm (опечатки: «Севернный» ≈ «Северный»);
 *   6. адрес/город/заказчик (people пишут «Объект: Казань, ул. Ленина»).
 *
 * Решаем ПРИВЯЗАТЬ только когда лидер ОДНОЗНАЧЕН: либо один кандидат, либо
 * заметный отрыв по score. Иначе возвращаем candidates — UI показывает выбор
 * (заказчик подтвердил, что так нужно). Ничего не создаём: чужая работа хуже пустой.
 *
 * @param {object} db
 * @param {string} hint
 * @returns {Promise<{found:boolean, work?:object, reason:string, candidates?:Array}>}
 */
async function matchWork(db, hint) {
  let h = String(hint || '').trim();
  if (h.length < 3) return { found: false, reason: 'no_hint' };

  // ── 0. Нормализация ──────────────────────────────────────────────────────
  // ВАЖНО: \b в JS НЕ работает с кириллицей (не входит в \w) — границы явными классами.
  const NB = '(^|[^а-яёa-z])';
  const rawNorm = h.replace(/\s+/g, ' ').trim();
  h = h.replace(/^(объект[а-яё]*|на\s+объект[а-яё]*|работа[а-яё]*|проект[а-яё]*)\s*[:\-—]?\s*/i, '')
    .replace(new RegExp(NB + '(корпус[а-яё]*|лит[а-яё]*|секци[а-яё]*|этаж[а-яё]*)\\s*[№]?\\s*[\\wа-яё-]*', 'gi'), '$1 ')
    .replace(new RegExp(NB + '(стр\\.?\\s*\\d+)', 'gi'), '$1 ')
    .replace(/\s*,\s*(?=,|$)/g, '')
    .replace(/\s*,\s*$/, '')
    .replace(/[,;]+$/g, '')
    .replace(/\s+/g, ' ').trim();
  if (h.length < 3) h = rawNorm; // если нормализация всё съела — вернёмся к исходной строке

  // Номер объекта в подсказке: «№ 123», «об. 45/1», «объект 123-А».
  const numM = rawNorm.match(/[№#]\s*([\wа-яё\-/]{2,20})/i) || h.match(new RegExp(NB + '(?:об\\.?|объект[а-яё]*)\\s*([\\wа-яё/-]{2,20})', 'i'));
  const hintNumber = numM ? numM[1].replace(/^[-/]+|[-/]+$/g, '') : null;

  // P0 (верификатор 18.10.2026): дискриминаторы подсказки. Если у работы «свои»
  // корпус/литера/код и они НЕ совпадают с подсказкой — работа ЧУЖАЯ, привязку
  // запрещаем, даже если названия похожи на 100%.
  const hintDisc = discriminators(rawNorm + ' ' + h);
  /** Отсев чужих объектов по дискриминаторам. */
  const foreign = (w) => {
    const wtxt = [w.work_title, w.object_name, w.address, w.object_address].filter(Boolean).join(' ');
    return hasDiscriminatorConflict(hintDisc, discriminators(wtxt), rawNorm, wtxt);
  };

  /** Оценка совпадения строки с работой: доля слов подсказки + trgm. */
  const scoreRow = (w) => {
    const hay = [w.work_title, w.object_name, w.address, w.object_address, w.city, w.customer_name]
      .filter(Boolean).join(' ').toLowerCase();
    if (!hay) return 0;
    const hayWords = hay.split(/[\s,;.()]+/).filter((x) => x.length >= 3);
    const words = h.toLowerCase().split(/[\s,;.()]+/).filter((x) => x.length >= 3);
    let hit = 0;
    for (const wd of words) {
      // Слово считается совпавшим и при опечатке: «севрный» ≈ «северный».
      // Сравниваем через расстояние Левенштейна (1–2 буквы) — это честнее trgm,
      // который на коротких словах с пропуском буквы падает до 0.5.
      if (hay.includes(wd) || hayWords.some((hw) => wordClose(wd, hw))) hit++;
    }
    const wordScore = words.length ? hit / words.length : 0;
    const sim = simTrgm(h.toLowerCase(), hay);
    // Коды оборудования сверяем отдельно: «V99001» и «V49001» — разные машины,
    // хотя словами почти совпадают. Совпал код → небольшой бонус, не совпал → штраф.
    const hd = hintDisc.c; const wd = discriminators([w.work_title, w.object_name].filter(Boolean).join(' ')).c;
    let codeAdj = 0;
    if (hd.size && wd.size) {
      let inter = false;
      for (const x of hd) if (wd.has(x)) { inter = true; break; }
      codeAdj = inter ? 0.15 : -0.35;   // штраф сильнее бонуса: ошибка дороже
    }
    // Слова важнее «похожести букв»; номер/точные совпадения обрабатываются выше.
    return Math.max(0, Math.round((wordScore * 0.75 + sim * 0.25 + codeAdj) * 1000) / 1000);
  };

  // ── 1. Точное совпадение ─────────────────────────────────────────────────
  const exactW = await db.query(
    `SELECT id, work_title, object_name, address, city, customer_name
       FROM works
      WHERE deleted_at IS NULL AND (lower(work_title) = lower($1) OR lower(object_name) = lower($1))
      LIMIT 1`,
    [h]
  ).catch(() => ({ rows: [] }));
  if (exactW.rows[0] && !foreign(exactW.rows[0])) return { found: true, work: exactW.rows[0], reason: 'exact' };

  // ── 2. Номер работы ──────────────────────────────────────────────────────
  // Точное совпадение с work_number — сильнее любых дискриминаторов: если человек
  // назвал НОМЕР работы, он знает, какую работу имеет в виду (auto-теги вида
  // «A-100-MW-123» не должны блокировать такую привязку).
  if (hintNumber) {
    const exactNum = await db.query(
      `SELECT id, work_title, object_name, address, city, customer_name
         FROM works
        WHERE deleted_at IS NULL AND work_number = $1
        LIMIT 3`,
      [hintNumber]
    ).catch(() => ({ rows: [] }));
    if (exactNum.rows.length === 1) return { found: true, work: exactNum.rows[0], reason: 'work_number' };
    if (exactNum.rows.length > 1) return { found: false, reason: 'ambiguous', candidates: exactNum.rows };

    const byNum = await db.query(
      `SELECT id, work_title, object_name, address, city, customer_name
         FROM works
        WHERE deleted_at IS NULL
          AND (work_number ILIKE $1 || '%' OR work_number ILIKE '%' || $1)
        LIMIT 3`,
      [hintNumber]
    ).catch(() => ({ rows: [] }));
    const okNum = byNum.rows.filter((w) => !foreign(w));
    if (okNum.length === 1) return { found: true, work: okNum[0], reason: 'work_number' };
    if (okNum.length > 1) return { found: false, reason: 'ambiguous', candidates: okNum };
  }

  // ── 3. Полное вхождение ──────────────────────────────────────────────────
  const full = await db.query(
    `SELECT id, work_title, object_name, address, city, customer_name
       FROM works
      WHERE deleted_at IS NULL
        AND (work_title ILIKE '%' || $1 || '%' OR object_name ILIKE '%' || $1 || '%'
             OR address ILIKE '%' || $1 || '%' OR object_address ILIKE '%' || $1 || '%')
      LIMIT 5`,
    [h]
  ).catch(() => ({ rows: [] }));
  const fullOk = full.rows.filter((w) => !foreign(w));
  if (fullOk.length === 1) return { found: true, work: fullOk[0], reason: 'full' };
  if (fullOk.length > 1) {
    const scored = fullOk.map((w) => ({ ...w, _score: scoreRow(w) })).sort((a, b) => b._score - a._score);
    // Явный лидер? (отрыв ≥0.25) — привязываем, иначе отдаём выбор человеку.
    if (scored[0]._score - (scored[1] ? scored[1]._score : 0) >= 0.25 && scored[0]._score >= 0.5) {
      return { found: true, work: scored[0], reason: 'full_leader' };
    }
    return { found: false, reason: 'ambiguous', candidates: scored.slice(0, 5) };
  }

  // ── 4–6. Мультислово + опечатки + адрес/город/заказчик ──────────────────
  const words = h.split(/[\s,;.()]+/).filter((w) => w.length >= 4);
  const probeRaw = words.slice().sort((a, b) => b.length - a.length)[0]
    || h.split(/[\s,;.()]+/).filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
  // ВАЖНО: не выбрасываем дефис — «TR-68441» и «TR68441» это разные строки для LIKE.
  // Ищем по обоим вариантам (с разделителем и без), иначе номер с дефисом не находится.
  const probeNoSep = probeRaw.replace(/[^\wа-яё]/gi, '');
  // D-325 (21.10.2026): русское склонение ломало LIKE. Подсказка «Новошахтинский
  // НПЗ» искалась как `%Новошахтинский%`, а в базе работа называется
  // «…АО «НЗНП» (Новошахтинск)» — окончание «-ий» лишнее, вхождение = 0.
  // Поэтому добавляем ОСНОВУ слова (обрезаем окончание) как отдельный проб:
  // «Новошахтинский» → «Новошахтинск», что находит и «Новошахтинск», и «-ий».
  const stem = (w) => {
    const s = String(w || '');
    if (s.length < 6) return s;
    // Отрезаем типичные русские окончания прилагательных/существительных.
    return s.replace(/(ский|цкий|ской|цкой|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ов|ев|ин|ах|ях|ам|ям|ом|ем|а|я|ы|и|е|у|ю|о)$/i, '') || s;
  };
  const probes = [...new Set([
    probeRaw, probeNoSep, stem(probeRaw), stem(probeNoSep)
  ].filter((x) => x && x.length >= 4))];
  if (!probes.length) return { found: false, reason: 'not_found' };

  // trgm считаем по КОРОТКИМ полям (название+объект+адрес), а НЕ по склейке со всеми
  // реквизитами: на длинной строке одна опечатка давала сходство ниже порога 0.3,
  // и кандидат не попадал в пул (проверено: «Севрный» против полной склейки).
  const likeClause = probes.map((_, i) => `(work_title ILIKE '%' || $${i + 2} || '%' OR object_name ILIKE '%' || $${i + 2} || '%'
             OR address ILIKE '%' || $${i + 2} || '%' OR object_address ILIKE '%' || $${i + 2} || '%'
             OR customer_name ILIKE '%' || $${i + 2} || '%' OR city ILIKE '%' || $${i + 2} || '%'
             OR work_number ILIKE '%' || $${i + 2} || '%')`).join(' OR ');
  const trgmExpr = `lower(coalesce(work_title,'') || ' ' || coalesce(object_name,'') || ' ' ||
                     coalesce(address,'') || ' ' || coalesce(customer_name,''))`;
  const pool = await db.query(
    `SELECT id, work_title, object_name, address, object_address, city, customer_name,
            similarity(${trgmExpr}, lower($1)) AS sim
       FROM works
      WHERE deleted_at IS NULL
        AND ((${likeClause}) OR ${trgmExpr} % lower($1))
      ORDER BY sim DESC NULLS LAST
      LIMIT 12`,
    [h, ...probes]
  ).catch(() => ({ rows: [] }));

  const scored = pool.rows
    .filter((w) => !foreign(w))               // P0: чужие корпуса/коды отсекаем до скоринга
    .map((w) => ({ ...w, _score: scoreRow(w) }))
    .filter((w) => w._score >= 0.25)          // отсекаем явный мусор (опечатки дают ниже — оставляем)
    .sort((a, b) => b._score - a._score);
  if (!scored.length) return { found: false, reason: 'not_found' };

  const top = scored[0];
  const second = scored[1];
  // Привязываем при явном лидере. Порог для ОДИНОЧНОГО кандидата ниже (0.4):
  // если во всей базе нашлась единственная похожая работа, человек почти наверняка
  // имел в виду её — а иначе подсказка просто потеряется. При конкуренции
  // требуем заметный отрыв, чтобы не привязать чужую.
  if (!second) {
    if (top._score >= 0.4) return { found: true, work: top, reason: 'fuzzy_single' };
    return { found: false, reason: 'weak_single', candidates: scored.slice(0, 5) };
  }
  if (top._score - second._score >= 0.25 && top._score >= 0.6) {
    return { found: true, work: top, reason: 'fuzzy_leader' };
  }
  return { found: false, reason: 'ambiguous', candidates: scored.slice(0, 5) };
}

/**
 * Дискриминаторы объекта — то, что ОТЛИЧАЕТ одну работу от другой:
 * номер корпуса/литеры/секции/№, а также буквенно-цифровые коды (V99001, PH-M 1100/2).
 *
 * ЗАЧЕМ (P0 верификатора 18.10.2026): нормализация вырезает «корпус N», после чего
 * «Гидроузел Павловский, корпус 9» становилось неотличимо от «…, корпус 3», и система
 * МОЛЧА привязывала чужую работу (влияет на расходы проекта!). То же с кодами:
 * подсказка «Промывка деаэратора V99001» цепляла «…V49001».
 *
 * Правило: если у подсказки И у работы есть дискриминаторы ОДНОГО типа и они не
 * пересекаются — это РАЗНЫЕ объекты → привязку запрещаем (veto).
 */
function discriminators(s) {
  const t = String(s || '').toLowerCase();
  const out = { n: new Set(), c: new Set() };
  if (!t) return out;
  // Структурные уточнения объекта (сильный сигнал «это другой корпус/литера»).
  // ВАЖНО: сюда НЕ входят «№» и «стр.» — в счёте рядом пишут номер счёта/договора,
  // и если смешать их с номером корпуса, получим ложный конфликт и потеряем привязку.
  for (const m of t.matchAll(/(?:корпус[а-яё]*|литер[а-яё]*|секци[яи][а-яё]*|дом[а-яё]*|строени[а-яё]*)\s*[№]?\s*([\wа-яё/-]{1,12})/gi)) {
    const v = String(m[1] || '').replace(/^[-/]+|[-/]+$/g, '');
    if (v) out.n.add(v);
  }
  // Коды оборудования: обязателен и БУКВА, и ЦИФРА (V99001, PH-M1100, A-100).
  // Чистые числа намеренно не берём: «1185» — это номер счёта, а не признак объекта.
  for (const m of t.matchAll(/(?:^|[^a-zа-яё0-9])([a-zа-яё]{1,4}-?\d{2,}[a-zа-яё0-9-]*)/gi)) {
    const v = String(m[1] || '').replace(/^[-]+|[-]+$/g, '');
    if (v && /\d/.test(v) && /[a-zа-яё]/i.test(v) && v.length >= 4) out.c.add(v);
  }
  return out;
}

/** Есть ли КОНФЛИКТ дискриминаторов: оба набора непусты по типу и не пересекаются. */
function hasDiscriminatorConflict(hintDisc, workDisc, hintText, workText) {
  for (const k of ['n', 'c']) {
    const a = hintDisc[k]; const b = workDisc[k];
    if (!a.size || !b.size) continue;
    let inter = false;
    for (const x of a) if (b.has(x)) { inter = true; break; }
    if (!inter) return true;   // есть «свои» номера/коды, но ни один не совпал → чужой объект
  }
  // Дополнительно (P0-уточнение): код того же ТИПА, но с другим номером.
  // Пример: подсказка «V99001», работа «V49001» — префикс один (v), цифры разные.
  // Без этого правила общий «мусорный» код в обеих строках (номер договора, тег)
  // давал ложное совпадение и veto не срабатывал.
  for (const x of hintDisc.c) {
    const mx = String(x).match(/^([a-zа-яё]*)(\d+)/i);
    if (!mx) continue;
    for (const y of workDisc.c) {
      if (x === y) continue;
      const my = String(y).match(/^([a-zа-яё]*)(\d+)/i);
      if (!my) continue;
      if (mx[1] === my[1] && mx[2] !== my[2]) return true;   // тот же префикс — другой номер
    }
  }
  return false;
}
function levenshtein(a, b) {
  const s = String(a); const t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,                 // удаление
        cur[j - 1] + 1,              // вставка
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)  // замена
      );
    }
    prev = cur;
  }
  return prev[t.length];
}

/**
 * «То же слово с опечаткой»: 1 правка для коротких слов, 2 — для длинных.
 * «Севрный»/«Северный» (1), «Инструменты»/«Инструменыт» (2) — совпадение;
 * «Сокол»/«Стол» (2 при длине 5) — нет.
 */
function wordClose(a, b) {
  const s = String(a); const t = String(b);
  if (!s || !t) return false;
  if (Math.abs(s.length - t.length) > 2) return false;
  if (s === t) return true;
  if (s.length <= 4 || t.length <= 4) return levenshtein(s, t) <= 1;
  return levenshtein(s, t) <= 2;
}

/** Похожесть строк через pg_trgm-совместимую эвристику (без обращения к БД).
 *  Используется как добавка к словесному счёту; точные сравнения — в SQL. */
function simTrgm(a, b) {
  const grams = (s) => {
    const t = ' ' + String(s).replace(/\s+/g, ' ').trim() + ' ';
    const out = new Set();
    for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
    return out;
  };
  const A = grams(a); const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

module.exports = { normContractNo, matchContract, matchWork };
