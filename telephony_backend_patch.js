#!/usr/bin/env node
/**
 * Patch script for /var/www/asgard-crm/src/routes/telephony.js
 *
 * Changes:
 *   1. Add fallback user_id matching by phone number + AGI log in webhook summary handler
 *   2. Add new endpoints: /managers, /internal/agi-event, /call-control/settings,
 *      /call-control/toggle-dispatcher, /employees  (before HEALTH CHECK section)
 *
 * Usage:
 *   node telephony_backend_patch.js
 *
 * The script reads the file, applies both patches, writes it back, and reports results.
 */

const fs = require('fs');
const path = require('path');

const TARGET = '/var/www/asgard-crm/src/routes/telephony.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function bail(msg) {
  console.error('[PATCH ERROR] ' + msg);
  process.exit(1);
}

// ─── main ───────────────────────────────────────────────────────────────────

(function main() {
  console.log('[PATCH] Reading ' + TARGET);

  if (!fs.existsSync(TARGET)) {
    bail('File not found: ' + TARGET);
  }

  let src = fs.readFileSync(TARGET, 'utf8');
  const originalLength = src.length;
  let appliedPatches = [];

  // ====================================================================
  // PATCH 1 — fallback user_id matching after extension search
  // ====================================================================
  // We look for the pattern:
  //   if (u.rows.length) userId = u.rows[0].user_id;
  //   }
  // and insert the fallback code right after the closing brace of that block.
  // We need to be precise — this sits inside the summary webhook handler.

  const PATCH1_ANCHOR = 'if (u.rows.length) userId = u.rows[0].user_id;';

  if (src.includes(PATCH1_ANCHOR)) {
    // Find the anchor, then find the next closing brace `}` on its own line
    const anchorIdx = src.indexOf(PATCH1_ANCHOR);

    // Walk forward from anchor to find the `}` that closes the
    // "if (mangoExt) { ... }" block.  It is the first `}` on a line by itself
    // (with optional whitespace) after the anchor line.
    let searchFrom = anchorIdx + PATCH1_ANCHOR.length;

    // Find end of the line containing the anchor
    let eol = src.indexOf('\n', searchFrom);
    if (eol === -1) eol = src.length;

    // Now find the next `}` that closes the outer if-block.
    // We look for a line that is just whitespace + `}` (the closing brace of the
    // "if (mangoExt)" or similar block).
    let closingBraceIdx = -1;
    let pos = eol;
    // Track brace depth starting from the anchor line.  We want depth 0 → first `}`.
    // Simple approach: just find the very next `}` that starts a new line (with indent).
    const afterAnchor = src.substring(eol);
    const braceMatch = afterAnchor.match(/\n([ \t]*)\}/);
    if (braceMatch) {
      closingBraceIdx = eol + braceMatch.index + braceMatch[0].length;
    }

    if (closingBraceIdx === -1) {
      console.warn('[PATCH] WARNING: Could not locate closing brace after anchor for Patch 1. Skipping.');
    } else {
      // Determine indentation of the block we are inside (use the anchor line indent)
      const lineStart = src.lastIndexOf('\n', anchorIdx) + 1;
      const anchorLine = src.substring(lineStart, anchorIdx);
      // The indent before the `if (u.rows.length)` line — go one level up
      const innerIndent = anchorLine.match(/^([ \t]*)/)[1];
      // The block-level indent is one level less — but we insert at the same level as
      // the existing if-block, so use the indent of the closing brace we found.
      const braceLineStart = src.lastIndexOf('\n', closingBraceIdx - 1) + 1;
      const braceIndent = src.substring(braceLineStart, closingBraceIdx).match(/^([ \t]*)/)[1];

      // Build the code to insert.  We use the same indent as the closing brace for the
      // outer statements, +2 spaces for inner code.
      const ind = braceIndent;       // base indent (same as closing `}`)
      const ind2 = ind + '  ';       // one level deeper
      const ind3 = ind2 + '  ';      // two levels deeper
      const ind4 = ind3 + '  ';      // three levels deeper

      const patch1Code = `
${ind}// Fallback: ищем по номеру телефона (для переводов через SIP-транк на мобильный)
${ind}if (!userId) {
${ind2}const managerNumber = direction === 'inbound' ? toNum : fromNum;
${ind2}if (managerNumber) {
${ind3}const normMgr = normalizePhone(managerNumber);
${ind3}const phoneSearch = await db.query(
${ind4}\`SELECT user_id FROM user_call_status WHERE replace(replace(fallback_mobile, '+', ''), '-', '') LIKE $1 LIMIT 1\`,
${ind4}['%' + normMgr.slice(-10)]
${ind3});
${ind3}if (phoneSearch.rows.length) userId = phoneSearch.rows[0].user_id;
${ind2}}
${ind}}

${ind}// Fallback 2: check AGI log for matching call
${ind}if (!userId) {
${ind2}try {
${ind3}const agiLog = await db.query(
${ind4}\`SELECT payload FROM telephony_events_log
${ind4} WHERE event_type = 'agi_call'
${ind4} AND created_at >= NOW() - interval '10 minutes'
${ind4} AND payload::text LIKE $1
${ind4} ORDER BY created_at DESC LIMIT 1\`,
${ind4}['%' + (fromNum || '').slice(-10) + '%']
${ind3});
${ind3}if (agiLog.rows.length) {
${ind4}const agiPayload = typeof agiLog.rows[0].payload === 'string' ? JSON.parse(agiLog.rows[0].payload) : agiLog.rows[0].payload;
${ind4}if (agiPayload.route_to) {
${ind4}  const routeNorm = normalizePhone(agiPayload.route_to);
${ind4}  const u2 = await db.query(
${ind4}    \`SELECT user_id FROM user_call_status WHERE replace(replace(fallback_mobile, '+', ''), '-', '') LIKE $1 LIMIT 1\`,
${ind4}    ['%' + routeNorm.slice(-10)]
${ind4}  );
${ind4}  if (u2.rows.length) userId = u2.rows[0].user_id;
${ind4}}
${ind3}}
${ind2}} catch (e) { /* non-critical */ }
${ind}}
`;

      src = src.substring(0, closingBraceIdx) + '\n' + patch1Code + src.substring(closingBraceIdx);
      appliedPatches.push('Patch 1: fallback user_id matching (phone + AGI log)');
      console.log('[PATCH] Applied Patch 1 — fallback user_id matching');
    }
  } else {
    console.warn('[PATCH] WARNING: Anchor for Patch 1 not found. Trying alternative anchor...');

    // Alternative: search for a broader pattern
    const ALT_ANCHOR = 'u.rows[0].user_id';
    const altIdx = src.indexOf(ALT_ANCHOR);
    if (altIdx !== -1) {
      console.log('[PATCH] Found alternative anchor at position ' + altIdx + '. Please verify manually.');
    }
    console.warn('[PATCH] Patch 1 NOT applied. Manual intervention required.');
  }

  // ====================================================================
  // PATCH 2 — new endpoints before HEALTH CHECK
  // ====================================================================
  // Look for the HEALTH CHECK section marker.

  let patch2Anchor = null;
  let patch2AnchorIdx = -1;

  // Try several possible markers
  const markers = [
    '// HEALTH CHECK',
    '// ========================================\n  // HEALTH',
    '// ======',    // broad match — we will pick the one closest to health check
  ];

  for (const marker of markers) {
    const idx = src.indexOf(marker);
    if (idx !== -1) {
      // Verify it is near "health" text
      const nearby = src.substring(idx, idx + 200).toLowerCase();
      if (nearby.includes('health')) {
        patch2Anchor = marker;
        patch2AnchorIdx = idx;
        break;
      }
    }
  }

  // If still not found, try to find the fastify.get('/health') or similar
  if (patch2AnchorIdx === -1) {
    const healthIdx = src.indexOf("'/health'");
    if (healthIdx === -1) {
      const healthIdx2 = src.indexOf('"/health"');
      if (healthIdx2 !== -1) {
        // Go backwards to find a comment line before it
        patch2AnchorIdx = src.lastIndexOf('\n', healthIdx2);
        if (patch2AnchorIdx === -1) patch2AnchorIdx = healthIdx2;
        else patch2AnchorIdx += 1; // after newline
        patch2Anchor = '__position__';
      }
    } else {
      patch2AnchorIdx = src.lastIndexOf('\n', healthIdx);
      if (patch2AnchorIdx === -1) patch2AnchorIdx = healthIdx;
      else patch2AnchorIdx += 1;
      patch2Anchor = '__position__';
    }
  }

  if (patch2AnchorIdx === -1) {
    console.warn('[PATCH] WARNING: Could not find HEALTH CHECK section. Patch 2 NOT applied.');
  } else {
    // We want to go to the beginning of the line that contains our anchor.
    // If the anchor is a comment like "// HEALTH CHECK", we go to the line
    // *before* it (possibly a separator line).
    let insertPos = patch2AnchorIdx;

    // Walk backwards to include any preceding separator/blank lines that
    // belong to the HEALTH CHECK section header.
    // Find beginning of the anchor line.
    let lineBegin = src.lastIndexOf('\n', insertPos - 1);
    if (lineBegin === -1) lineBegin = 0; else lineBegin += 1;

    // Check if there is a separator comment (===) on the line before
    const prevLineEnd = lineBegin - 1;
    if (prevLineEnd > 0) {
      const prevLineStart = src.lastIndexOf('\n', prevLineEnd - 1) + 1;
      const prevLine = src.substring(prevLineStart, prevLineEnd).trim();
      if (prevLine.match(/^\/\/\s*=+/)) {
        // The separator belongs to the health check heading — insert before it
        lineBegin = prevLineStart;
      }
    }

    insertPos = lineBegin;

    const patch2Code = `  // --- Список менеджеров (для фильтра) ---
  fastify.get('/managers', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const res = await db.query(
      \`SELECT u.id, u.name, u.role FROM users u
       WHERE u.is_active = true
       AND u.role IN ('PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'BUH', 'PROC', 'CHIEF_ENGINEER', 'OFFICE_MANAGER', 'WAREHOUSE')
       ORDER BY u.name\`
    );
    reply.send({ managers: res.rows });
  });

  // --- Внутренний API для AGI-событий (только localhost) ---
  fastify.post('/internal/agi-event', async (request, reply) => {
    // Проверяем что запрос от localhost
    const ip = request.ip;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return reply.code(403).send({ error: 'Localhost only' });
    }

    const event = request.body;
    if (!event || !event.type) {
      return reply.code(400).send({ error: 'type required' });
    }

    console.log(\`[Telephony] AGI event: \${event.type} caller=\${event.caller || 'unknown'}\`);

    // Логируем
    await logEvent('agi_live', event);

    // Определяем кому отправить SSE
    // Отправляем пользователю с активным мониторингом
    if (sseBroadcast) {
      sseBroadcast('call:agi_event', event);
    }

    // Также обновляем call_history если есть данные
    if (event.type === 'call_end' && event.caller) {
      try {
        const normCaller = normalizePhone(event.caller);
        // Ищем user_id по route_to
        let routeUserId = null;
        if (event.route_to) {
          const normRoute = normalizePhone(event.route_to);
          const u = await db.query(
            \`SELECT user_id FROM user_call_status WHERE replace(replace(fallback_mobile, '+', ''), '-', '') LIKE $1 LIMIT 1\`,
            ['%' + normRoute.slice(-10)]
          );
          if (u.rows.length) routeUserId = u.rows[0].user_id;
        }

        // Обновляем последнюю запись call_history для этого номера
        const updateFields = [];
        const updateParams = [];
        let pIdx = 1;

        if (routeUserId) {
          updateFields.push(\`user_id = $\${pIdx++}\`);
          updateParams.push(routeUserId);
        }
        if (event.ai_summary) {
          updateFields.push(\`ai_summary = $\${pIdx++}\`);
          updateParams.push(event.ai_summary);
        }
        if (event.intent) {
          updateFields.push(\`ai_is_target = $\${pIdx++}\`);
          updateParams.push(!['spam', 'unknown'].includes(event.intent));
        }
        if (event.collected_data) {
          updateFields.push(\`ai_lead_data = $\${pIdx++}\`);
          updateParams.push(JSON.stringify(event.collected_data));
        }

        if (updateFields.length > 0) {
          updateFields.push('updated_at = NOW()');
          updateParams.push(normCaller.slice(-10));
          await db.query(
            \`UPDATE call_history SET \${updateFields.join(', ')}
             WHERE id = (SELECT id FROM call_history WHERE from_number LIKE $\${pIdx} ORDER BY created_at DESC LIMIT 1)\`,
            [...updateParams, '%' + normCaller.slice(-10)]
          );
        }
      } catch (e) {
        console.error('[Telephony] AGI call_end update error:', e.message);
      }
    }

    reply.send({ status: 'ok' });
  });

  // --- Настройки мониторинга звонков ---
  fastify.get('/call-control/settings', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    // Кто сейчас активный диспетчер
    const dispatcher = await db.query(
      \`SELECT ucs.user_id, u.name FROM user_call_status ucs
       JOIN users u ON u.id = ucs.user_id
       WHERE ucs.is_call_dispatcher = true LIMIT 1\`
    );

    // Настройки текущего пользователя
    const mySettings = await db.query(
      'SELECT receive_call_push, is_call_dispatcher FROM user_call_status WHERE user_id = $1',
      [request.user.id]
    );

    reply.send({
      active_dispatcher: dispatcher.rows.length ? {
        user_id: dispatcher.rows[0].user_id,
        name: dispatcher.rows[0].name
      } : null,
      my_settings: mySettings.rows.length ? mySettings.rows[0] : {
        receive_call_push: false,
        is_call_dispatcher: false
      }
    });
  });

  // --- Активация/деактивация диспетчера ---
  fastify.post('/call-control/toggle-dispatcher', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { enable } = request.body;
    const userId = request.user.id;

    if (enable) {
      // Проверяем нет ли уже активного диспетчера
      const existing = await db.query(
        \`SELECT ucs.user_id, u.name FROM user_call_status ucs
         JOIN users u ON u.id = ucs.user_id
         WHERE ucs.is_call_dispatcher = true AND ucs.user_id != $1\`,
        [userId]
      );

      if (existing.rows.length) {
        return reply.code(409).send({
          error: 'Dispatcher already active',
          active_dispatcher: {
            user_id: existing.rows[0].user_id,
            name: existing.rows[0].name
          }
        });
      }

      // Активируем
      await db.query(
        \`INSERT INTO user_call_status (user_id, is_call_dispatcher, receive_call_push, updated_at)
         VALUES ($1, true, true, NOW())
         ON CONFLICT (user_id) DO UPDATE SET is_call_dispatcher = true, receive_call_push = true, updated_at = NOW()\`,
        [userId]
      );
    } else {
      // Деактивируем
      await db.query(
        'UPDATE user_call_status SET is_call_dispatcher = false, updated_at = NOW() WHERE user_id = $1',
        [userId]
      );
    }

    reply.send({ status: 'ok', is_dispatcher: !!enable });
  });

  // --- Список сотрудников для перевода ---
  fastify.get('/employees', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const res = await db.query(
      \`SELECT u.id, u.name, u.role, ucs.fallback_mobile
       FROM users u
       LEFT JOIN user_call_status ucs ON ucs.user_id = u.id
       WHERE u.is_active = true AND u.role NOT IN ('ADMIN', 'HR', 'HR_MANAGER')
       ORDER BY u.name\`
    );
    reply.send({ employees: res.rows });
  });

`;

    src = src.substring(0, insertPos) + patch2Code + src.substring(insertPos);
    appliedPatches.push('Patch 2: new endpoints (managers, agi-event, call-control, employees)');
    console.log('[PATCH] Applied Patch 2 — new endpoints before HEALTH CHECK');
  }

  // ====================================================================
  // Write result
  // ====================================================================

  if (appliedPatches.length === 0) {
    bail('No patches were applied. Aborting — file was NOT modified.');
  }

  // Backup original
  const backupPath = TARGET + '.bak.' + Date.now();
  console.log('[PATCH] Creating backup at ' + backupPath);
  fs.copyFileSync(TARGET, backupPath);

  console.log('[PATCH] Writing patched file (' + src.length + ' bytes, was ' + originalLength + ')');
  fs.writeFileSync(TARGET, src, 'utf8');

  console.log('');
  console.log('=== PATCH SUMMARY ===');
  appliedPatches.forEach(p => console.log('  [OK] ' + p));
  console.log('');
  console.log('Backup saved to: ' + backupPath);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run migration:  PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f /path/to/telephony_migration.sql');
  console.log('  2. Restart service: systemctl restart asgard-crm');
  console.log('');
})();
