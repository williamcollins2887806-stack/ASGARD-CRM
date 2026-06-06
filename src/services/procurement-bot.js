'use strict';
/**
 * АСГАРД CRM — MAX-бот закупок (через Green API)
 * ═══════════════════════════════════════════════════════════════════════════
 * РП пишет боту в личку MAX список материалов → бот создаёт заявку на закупку.
 *
 * Диалоговый автомат (состояние в max_bot_sessions):
 *   idle → (любое сообщение) → определяем РП по телефону:
 *     - не найден → просим обратиться к админу
 *     - 0 активных работ → создаём заявку без работы, просим позиции
 *     - 1 работа → берём её, просим позиции
 *     - >1 работы → шлём нумерованный список, ждём выбора (awaiting_work)
 *   awaiting_work → (номер) → фиксируем работу, просим позиции (awaiting_items)
 *   awaiting_items → (текст списка) → парсим, создаём заявку sent_to_proc,
 *                    уведомляем закупщика, сбрасываем в idle
 *
 * Команды: «отмена»/«стоп» → сброс в idle. «новая»/«закупка» → начать заново.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const green = require('./green-api');

// Парсер строки списка — переиспользуем ту же логику, что в procurement.js
const PROC_UNITS = ['метров','мешков','штука','рулонов','литров','тонн','штук','мешок','рулон','метр','смены','смен','упак','компл','банка','пачка','вёдер','ведро','пара','пар','шт','кг','уп','м','т','л']
  .sort((a, b) => b.length - a.length);
const PROC_UNIT_RE = PROC_UNITS.join('|');

function parseTextLine(line) {
  const raw = line.trim();
  if (!raw) return null;
  let name = raw, quantity = 1, unit = 'шт';
  let m = raw.match(new RegExp('^(\\d+[.,]?\\d*)\\s*(' + PROC_UNIT_RE + ')\\.?\\s+(.+)$', 'i'));
  if (m) return { name: m[3].trim(), quantity: parseFloat(m[1].replace(',', '.')), unit: m[2].toLowerCase() };
  m = raw.match(new RegExp('^(.+?)\\s*[\\-–:]?\\s*(\\d+[.,]?\\d*)\\s*(' + PROC_UNIT_RE + ')\\.?$', 'i'));
  if (m && m[1].trim()) return { name: m[1].trim().replace(/[\s\-–:]+$/, ''), quantity: parseFloat(m[2].replace(',', '.')), unit: m[3].toLowerCase() };
  m = raw.match(/^(.+?)[\s\-–:]+(\d+[.,]?\d*)$/);
  if (m && m[1].trim()) return { name: m[1].trim(), quantity: parseFloat(m[2].replace(',', '.')), unit };
  m = raw.match(/^(\d+[.,]?\d*)\s+(.+)$/);
  if (m) return { name: m[2].trim(), quantity: parseFloat(m[1].replace(',', '.')), unit };
  return { name, quantity, unit };
}

function chatToPhone(chatId) {
  // '79991234567@c.us' → '79991234567'
  return green.toDigits(String(chatId || '').replace('@c.us', ''));
}

async function getSession(db, chatId) {
  const { rows } = await db.query('SELECT * FROM max_bot_sessions WHERE chat_id=$1', [chatId]);
  return rows[0] || null;
}

async function upsertSession(db, chatId, fields) {
  const phone = chatToPhone(chatId);
  const existing = await getSession(db, chatId);
  if (!existing) {
    const { rows } = await db.query(
      `INSERT INTO max_bot_sessions(chat_id,phone_digits,user_id,state,draft_json)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [chatId, phone, fields.user_id || null, fields.state || 'idle', JSON.stringify(fields.draft_json || {})]);
    return rows[0];
  }
  const upd = [], vals = []; let i = 1;
  if (fields.user_id !== undefined) { upd.push(`user_id=$${i++}`); vals.push(fields.user_id); }
  if (fields.state !== undefined) { upd.push(`state=$${i++}`); vals.push(fields.state); }
  if (fields.draft_json !== undefined) { upd.push(`draft_json=$${i++}`); vals.push(JSON.stringify(fields.draft_json)); }
  upd.push('updated_at=NOW()'); vals.push(chatId);
  const { rows } = await db.query(`UPDATE max_bot_sessions SET ${upd.join(',')} WHERE chat_id=$${i} RETURNING *`, vals);
  return rows[0];
}

async function resetSession(db, chatId, userId) {
  await upsertSession(db, chatId, { user_id: userId, state: 'idle', draft_json: {} });
}

// Найти пользователя CRM (РП) по телефону MAX
async function findUserByPhone(db, phoneDigits) {
  if (!phoneDigits) return null;
  // 1) напрямую users.phone
  let r = await db.query(
    `SELECT id, name, role FROM users
     WHERE REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g') = $1 AND is_active=true LIMIT 1`, [phoneDigits]);
  if (r.rows[0]) return r.rows[0];
  // 2) через employees.phone → employees.user_id (только phone — есть и локально, и на проде)
  r = await db.query(
    `SELECT u.id, u.name, u.role FROM employees e JOIN users u ON u.id=e.user_id
     WHERE u.is_active=true AND e.user_id IS NOT NULL
       AND REGEXP_REPLACE(COALESCE(e.phone,''),'[^0-9]','','g') = $1 LIMIT 1`, [phoneDigits]);
  return r.rows[0] || null;
}

// Активные работы РП
async function getActiveWorks(db, userId) {
  const { rows } = await db.query(
    `SELECT id, work_title, object_name, city FROM works
     WHERE pm_id=$1 AND completed_at IS NULL AND closed_at IS NULL
     ORDER BY created_at DESC LIMIT 15`, [userId]);
  return rows;
}

function workLabel(w) {
  return w.work_title || w.object_name || `Работа #${w.id}`;
}

// Создать заявку и позиции, отправить закупщику
async function createRequest(db, createNotification, { userId, workId, lines, botPhone }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const title = lines.length ? `Закупка из MAX (${lines.length} поз.)` : 'Закупка из MAX';
    const { rows: pr } = await client.query(
      `INSERT INTO procurement_requests(work_id,title,priority,author_id,pm_id,status)
       VALUES($1,$2,'normal',$3,$3,'sent_to_proc') RETURNING *`,
      [workId || null, title, userId]);
    const procId = pr[0].id;
    if (lines.length) {
      const n = [], q = [], u = [], o = [];
      lines.forEach((it, idx) => { n.push(it.name); q.push(it.quantity); u.push(it.unit); o.push(idx); });
      await client.query(
        `INSERT INTO procurement_items(procurement_id,name,quantity,unit,sort_order)
         SELECT $1,unnest($2::text[]),unnest($3::numeric[]),unnest($4::text[]),unnest($5::int[])`,
        [procId, n, q, u, o]);
      await client.query(`UPDATE procurement_requests SET total_sum=0 WHERE id=$1`, [procId]);
    }
    // назначить закупщика (первого активного PROC)
    const pu = await client.query("SELECT id FROM users WHERE role='PROC' AND is_active=true ORDER BY id LIMIT 1");
    if (pu.rows[0]) await client.query('UPDATE procurement_requests SET proc_id=$1 WHERE id=$2', [pu.rows[0].id, procId]);
    await client.query(
      `INSERT INTO procurement_history(procurement_id,actor_id,action,new_status,comment)
       VALUES($1,$2,'created_from_max','sent_to_proc',$3)`,
      [procId, userId, `Заявка из MAX-бота: ${lines.length} поз.`]);
    await client.query('COMMIT');

    // уведомить закупщиков в CRM
    const procs = await db.query("SELECT id FROM users WHERE role='PROC' AND is_active=true");
    for (const p of procs.rows) {
      createNotification(db, { user_id: p.id, title: `🛒 Заявка из MAX #${procId}`,
        message: `${lines.length} поз. от РП`, type: 'procurement', link: `#/procurement?id=${procId}` });
    }
    return { procId, count: lines.length };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

/**
 * Главный обработчик входящего личного текстового сообщения.
 * db — fastify.db / pg pool с .query и .pool
 * createNotification — из services/notify
 * chatId — '79991234567@c.us'
 * text — текст сообщения
 * reply(text) — функция отправки ответа (обычно green.sendMessage(phone,text))
 */
async function handleMessage(db, createNotification, chatId, text, reply) {
  const msg = String(text || '').trim();
  const lower = msg.toLowerCase();
  const phone = chatToPhone(chatId);

  // Команды сброса
  if (['отмена', 'стоп', 'cancel', '/cancel', 'сброс'].includes(lower)) {
    const u = await findUserByPhone(db, phone);
    await resetSession(db, chatId, u ? u.id : null);
    await reply('Отменено. Напишите список материалов, чтобы создать новую заявку на закупку.');
    return;
  }

  // Идентификация РП
  const user = await findUserByPhone(db, phone);
  if (!user) {
    await reply('👋 Здравствуйте! Ваш номер не привязан к АСГАРД CRM. Обратитесь к администратору, чтобы пользоваться ботом закупок.');
    return;
  }

  let session = await getSession(db, chatId);
  const state = session ? session.state : 'idle';

  // ── Состояние: ждём выбора работы ──
  if (state === 'awaiting_work') {
    const draft = session.draft_json || {};
    const opts = draft.work_options || [];
    const num = parseInt(msg);
    if (isNaN(num) || num < 1 || num > opts.length) {
      await reply(`Введите номер работы от 1 до ${opts.length} (или «отмена»).`);
      return;
    }
    const chosen = opts[num - 1];
    await upsertSession(db, chatId, { user_id: user.id, state: 'awaiting_items', draft_json: { ...draft, work_id: chosen.id, work_title: chosen.label } });
    await reply(`✅ Работа: ${chosen.label}\n\nТеперь пришлите список материалов — по одной позиции на строку.\nНапример:\n10 мешков цемента\nарматура 12мм - 5 шт\nкран манипулятор - 2 смены`);
    return;
  }

  // ── Состояние: ждём список позиций ──
  if (state === 'awaiting_items') {
    const draft = session.draft_json || {};
    const lines = msg.split(/\r?\n/).map(parseTextLine).filter(Boolean);
    if (!lines.length) {
      await reply('Не понял список. Пришлите материалы — по одной позиции на строку.');
      return;
    }
    const { procId, count } = await createRequest(db, createNotification, { userId: user.id, workId: draft.work_id || null, lines, botPhone: phone });
    await resetSession(db, chatId, user.id);
    const workStr = draft.work_title ? `\nРабота: ${draft.work_title}` : '';
    await reply(`✅ Заявка #${procId} создана и отправлена закупщику!${workStr}\nПозиций: ${count}\n\nЗакупщик обработает её в CRM. Чтобы создать ещё одну — пришлите новый список.`);
    return;
  }

  // ── idle: старт нового диалога ──
  // Если это приветствие/команда — покажем подсказку
  if (['привет', 'start', '/start', 'здравствуйте', 'закупка', 'новая'].includes(lower) || msg.length < 3) {
    const works = await getActiveWorks(db, user.id);
    if (works.length === 0) {
      await upsertSession(db, chatId, { user_id: user.id, state: 'awaiting_items', draft_json: {} });
      await reply(`👋 Здравствуйте, ${user.name || ''}!\nУ вас нет активных работ — заявку создам без привязки.\n\nПришлите список материалов (по строке на позицию).`);
      return;
    }
    await startWorkSelection(db, chatId, user, works, reply);
    return;
  }

  // idle + сразу прислали список (без выбора работы) — определим работу
  const works = await getActiveWorks(db, user.id);
  if (works.length === 1) {
    // одна работа — сразу парсим как позиции
    const lines = msg.split(/\r?\n/).map(parseTextLine).filter(Boolean);
    if (lines.length) {
      const { procId, count } = await createRequest(db, createNotification, { userId: user.id, workId: works[0].id, lines, botPhone: phone });
      await resetSession(db, chatId, user.id);
      await reply(`✅ Заявка #${procId} создана и отправлена закупщику!\nРабота: ${workLabel(works[0])}\nПозиций: ${count}`);
      return;
    }
  }
  if (works.length === 0) {
    const lines = msg.split(/\r?\n/).map(parseTextLine).filter(Boolean);
    if (lines.length) {
      const { procId, count } = await createRequest(db, createNotification, { userId: user.id, workId: null, lines, botPhone: phone });
      await resetSession(db, chatId, user.id);
      await reply(`✅ Заявка #${procId} создана и отправлена закупщику!\nПозиций: ${count}`);
      return;
    }
  }
  // несколько работ — спросим какую
  await startWorkSelection(db, chatId, user, works, reply, msg);
}

async function startWorkSelection(db, chatId, user, works, reply, pendingText) {
  const opts = works.map(w => ({ id: w.id, label: workLabel(w) }));
  const draft = { work_options: opts };
  if (pendingText) draft.pending_text = pendingText;
  await upsertSession(db, chatId, { user_id: user.id, state: 'awaiting_work', draft_json: draft });
  let list = works.map((w, i) => `${i + 1}. ${workLabel(w)}${w.city ? ' — ' + w.city : ''}`).join('\n');
  await reply(`👋 Здравствуйте, ${user.name || ''}!\nНа какую работу заявка? Отправьте номер:\n\n${list}`);
}

module.exports = { handleMessage, parseTextLine, findUserByPhone, getActiveWorks, _chatToPhone: chatToPhone };
