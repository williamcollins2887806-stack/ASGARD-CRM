'use strict';

const { getCallAnalysisPrompt } = require('../prompts/call-analysis-prompt');

const OUTCOME_KINDS = new Set(['lead', 'task', 'none']);

class CallAnalyzer {
  constructor(aiProvider, db) {
    this.aiProvider = aiProvider;
    this.db = db;
  }

  async analyze(transcript, callData) {
    if (!transcript || transcript.trim().length < 20) {
      return {
        is_target: false,
        outcome_kind: 'none',
        summary: 'Слишком короткий разговор для анализа',
        sentiment: 'neutral',
        classification: 'wrong_number',
        quality_score: null,
        _skipped: true
      };
    }
    const systemPrompt = getCallAnalysisPrompt({
      callerNumber: callData.from_number || callData.caller_number,
      calledNumber: callData.to_number || callData.called_number,
      duration: callData.duration_seconds || callData.duration || 0,
      managerName: callData.manager_name,
      clientName: callData.client_name,
      clientCompany: callData.client_company,
      clientHistory: callData.client_history,
    });
    try {
      const completeFn = this.aiProvider.completeAnalytics || this.aiProvider.complete || this.aiProvider;
      const response = await completeFn({
        system: systemPrompt,
        messages: [{ role: 'user', content: transcript }],
        maxTokens: 3000,
        temperature: 0.1,
        model: process.env.CALL_ANALYSIS_MODEL || 'yandex-pro',
      });
      const text = typeof response === 'string' ? response : (response.text || response.content || '');
      return this._parseResponse(text);
    } catch (err) {
      // Infra/provider errors must bubble to pipeline → retryable status, NOT fake ai_summary.
      const code = err && (err.code || err.status);
      const retryable = this._isRetryableError(err);
      const wrapped = new Error(err.message || 'AI analysis failed');
      wrapped.code = typeof code === 'string' ? code : (retryable ? 'provider_error' : 'unknown');
      wrapped.retryable = retryable;
      wrapped.cause = err;
      throw wrapped;
    }
  }

  _isRetryableError(err) {
    if (!err) return true;
    const code = String(err.code || '').toLowerCase();
    if (['insufficient_funds', 'rate_limit', 'timeout', 'network', 'provider_error', 'upstream_error', 'empty_response'].includes(code)) {
      return true;
    }
    if (err.status === 402 || err.status === 429 || (err.status >= 500 && err.status < 600)) return true;
    const msg = String(err.message || '');
    if (/недостаточно средств|insufficient|rate.?limit|timeout|ECONN|ETIMEDOUT|socket hang up|fetch failed|50[0-4]\b/i.test(msg)) {
      return true;
    }
    if (/auth|unauthorized|401|403|bad_request/i.test(code + ' ' + msg)) return false;
    return true; // unknown → safer to retry
  }

  _parseResponse(text) {
    let cleaned = text.trim();
    const BT3 = String.fromCharCode(96, 96, 96);
    if (cleaned.startsWith(BT3 + 'json')) cleaned = cleaned.slice(BT3.length + 4);
    else if (cleaned.startsWith(BT3)) cleaned = cleaned.slice(3);
    if (cleaned.endsWith(BT3)) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd > jsonStart) cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    try {
      return this._normalizeFields(JSON.parse(cleaned));
    } catch (err) {
      const parseErr = new Error('AI JSON parse failed: ' + err.message);
      parseErr.code = 'json_parse_error';
      parseErr.retryable = true; // 1–2 retries then pipeline may mark error_final
      parseErr.raw = cleaned.slice(0, 500);
      throw parseErr;
    }
  }

  _inferOutcomeKind(data) {
    const raw = String(data.outcome_kind || '').trim().toLowerCase();
    if (OUTCOME_KINDS.has(raw)) return raw;

    const cls = String(data.classification || '').toLowerCase();
    const next = Array.isArray(data.next_steps) ? data.next_steps.join(' ').toLowerCase() : '';
    const summary = String(data.summary || '').toLowerCase();
    const blob = next + ' ' + summary;

    if (cls === 'spam' || cls === 'wrong_number' || cls === 'supplier_offer') return 'none';
    if (data.is_target === false) return 'none';

    const wantsKp = /кп\b|коммерческ|цен[аыу]|стоимость|промывк|расчёт|расчет|выезд|заказ/.test(blob)
      || cls === 'new_inquiry' || cls === 'repeat_order';
    const followUp = /перезвон|узнаю|уточн|скажу|подскажу|выясн|передам|спроси/.test(blob);

    if (wantsKp) return 'lead'; // mixed KP+callback → lead
    if (data.is_target === true && followUp) return 'task';
    if (data.is_target === true) return 'task'; // safer than junk lead
    return 'none';
  }

  _normalizeFields(data) {
    const VS = ['positive', 'neutral', 'negative', 'aggressive'];
    const VU = ['critical', 'high', 'medium', 'low'];
    const VC = ['new_inquiry', 'repeat_order', 'complaint', 'warranty_claim', 'information_request', 'partnership_proposal', 'supplier_offer', 'spam', 'wrong_number'];
    const VW = ['chemical_cleaning', 'hydro_cleaning', 'hvac_maintenance', 'hvac_repair', 'hvac_installation', 'industrial_service', 'consultation', 'other'];
    const VE = ['heat_exchanger', 'boiler', 'pipeline', 'chiller', 'ahu', 'cooling_tower', 'pump', 'valve', 'other'];
    const VSRC = ['website', 'referral', 'repeat_client', 'advertisement', 'search', 'exhibition', 'cold_call'];

    const outcome_kind = this._inferOutcomeKind(data);
    let is_target = typeof data.is_target === 'boolean' ? data.is_target : null;
    if (outcome_kind === 'lead' || outcome_kind === 'task') is_target = true;
    if (outcome_kind === 'none' && is_target == null) is_target = false;

    return {
      company_name: this._str(data.company_name), contact_person: this._str(data.contact_person),
      contact_phone: this._str(data.contact_phone), contact_email: this._str(data.contact_email),
      object_description: this._str(data.object_description),
      work_type: this._enum(data.work_type, VW), equipment_type: this._enum(data.equipment_type, VE),
      equipment_count: this._int(data.equipment_count), urgency: this._enum(data.urgency, VU),
      estimated_volume: this._str(data.estimated_volume), location: this._str(data.location),
      access_conditions: this._str(data.access_conditions), desired_timeline: this._str(data.desired_timeline),
      budget_mentioned: Boolean(data.budget_mentioned), source: this._enum(data.source, VSRC),
      summary: this._str(data.summary) || 'Резюме не сформировано',
      key_requirements: Array.isArray(data.key_requirements) ? data.key_requirements.map(String) : [],
      sentiment: this._enum(data.sentiment, VS) || 'neutral',
      is_target,
      outcome_kind,
      suggested_assignee_name: this._str(data.suggested_assignee_name),
      task_title: this._str(data.task_title),
      task_due_hint: this._str(data.task_due_hint),
      classification: this._enum(data.classification, VC),
      next_steps: Array.isArray(data.next_steps) ? data.next_steps.map(String) : [],
      quality_score: this._clamp(data.quality_score, 1, 10), quality_notes: this._str(data.quality_notes),
      company: { name: this._str(data.company_name), inn: null },
      contact: { name: this._str(data.contact_person), phone: this._str(data.contact_phone), email: this._str(data.contact_email) },
      object: { name: this._str(data.object_description), address: this._str(data.location) },
      work: { type: this._enum(data.work_type, VW), type_label: this._workTypeLabel(data.work_type), description: this._str(data.estimated_volume) }
    };
  }
  _str(v) { if (v === null || v === undefined) return null; const s = String(v).trim(); return s.length > 0 ? s : null; }
  _enum(v, valid) { if (!v) return null; const s = String(v).trim().toLowerCase(); return valid.includes(s) ? s : null; }
  _int(v) { if (v === null || v === undefined) return null; const n = parseInt(v, 10); return isNaN(n) || n < 0 ? null : n; }
  _clamp(v, min, max) { if (v === null || v === undefined) return null; const n = parseInt(v, 10); if (isNaN(n)) return null; return Math.max(min, Math.min(max, n)); }

  _workTypeLabel(wt) {
    const m = { chemical_cleaning: 'Химическая очистка', hydro_cleaning: 'ГДО', hvac_maintenance: 'ТО ОВКВ', hvac_repair: 'Ремонт ОВКВ', hvac_installation: 'Монтаж ОВКВ', industrial_service: 'Промышленный сервис', consultation: 'Консультация', other: 'Прочее' };
    return m[wt] || null;
  }

  _urgencyToPriority(urgency) {
    if (urgency === 'critical' || urgency === 'high') return 'high';
    if (urgency === 'low') return 'low';
    return 'normal';
  }

  /**
   * Найти активного пользователя по имени (частичное совпадение).
   */
  async resolveAssigneeByName(name) {
    const q = String(name || '').trim();
    if (!q || q.length < 2) return null;
    try {
      const r = await this.db.query(
        `SELECT id, name FROM users
          WHERE is_active = true
            AND (
              LOWER(name) = LOWER($1)
              OR LOWER(name) LIKE LOWER($2)
              OR LOWER(split_part(name, ' ', 1)) = LOWER($3)
            )
          ORDER BY CASE WHEN LOWER(name) = LOWER($1) THEN 0 ELSE 1 END, id
          LIMIT 1`,
        [q, '%' + q + '%', q.split(/\s+/)[0]]
      );
      return r.rows[0] ? r.rows[0].id : null;
    } catch (err) {
      console.warn('[CallAnalyzer] resolveAssigneeByName failed:', err.message);
      return null;
    }
  }

  async _fallbackAssigneeId(preferredUserId) {
    if (preferredUserId) return preferredUserId;
    try {
      const { getCurrentDuty } = require('./tender-registry-helpers');
      const duty = await getCurrentDuty(this.db);
      if (duty?.pm_user_id) return duty.pm_user_id;
    } catch (_) { /* ignore */ }
    try {
      const duty = await this.db.query(
        'SELECT user_id FROM user_call_status WHERE is_duty = true AND accepting = true LIMIT 1'
      );
      if (duty.rows.length) return duty.rows[0].user_id;
    } catch (_) { /* ignore */ }
    try {
      const dir = await this.db.query(
        `SELECT id FROM users
          WHERE role IN ('ADMIN','DIRECTOR_GEN','DIRECTOR_COMM') AND is_active = true
          ORDER BY id LIMIT 1`
      );
      if (dir.rows.length) return dir.rows[0].id;
    } catch (_) { /* ignore */ }
    return null;
  }

  /**
   * Найти «живую» заявку того же клиента за windowDays.
   */
  async findOpenPreTenderForClient({ phone, inn, company, windowDays = 30 }) {
    const digits = String(phone || '').replace(/\D/g, '').slice(-10);
    if (!digits && !inn && !company) return null;
    const params = [];
    const matches = [];
    if (digits.length === 10) {
      params.push(digits);
      matches.push(`right(regexp_replace(COALESCE(contact_phone, ''), '\\D', '', 'g'), 10) = $${params.length}`);
    }
    if (inn) {
      params.push(String(inn).trim());
      matches.push(`customer_inn = $${params.length}`);
    }
    if (company) {
      params.push(String(company).trim());
      matches.push(`LOWER(TRIM(customer_name)) = LOWER($${params.length})`);
    }
    if (!matches.length) return null;
    params.push(Number(windowDays) || 30);
    try {
      const r = await this.db.query(
        `SELECT id, work_title, work_description, status, created_at, assigned_to
           FROM pre_tender_requests
          WHERE COALESCE(status, '') NOT IN ('rejected', 'expired')
            AND created_tender_id IS NULL
            AND created_at >= NOW() - ($${params.length}::int * INTERVAL '1 day')
            AND (${matches.join(' OR ')})
          ORDER BY created_at DESC
          LIMIT 1`,
        params
      );
      return r.rows[0] || null;
    } catch (err) {
      console.warn('[CallAnalyzer] dedup lookup failed:', err.message);
      return null;
    }
  }

  async appendCallToPreTender(ptId, { summary, at }) {
    if (!ptId) return false;
    const when = at ? new Date(at) : new Date();
    const stamp = when.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Moscow'
    });
    const line = `Звонок ${stamp}: ${String(summary || 'без резюме').slice(0, 400)}`;
    try {
      await this.db.query(
        `UPDATE pre_tender_requests
            SET work_description = CASE
                  WHEN COALESCE(work_description, '') = '' THEN $2
                  ELSE work_description || chr(10) || $2
                END,
                updated_at = NOW()
          WHERE id = $1`,
        [ptId, line]
      );
      return true;
    } catch (err) {
      console.warn('[CallAnalyzer] append to pre-tender failed:', err.message);
      return false;
    }
  }

  async createDraftLead(ar, callId, managerId) {
    const kind = ar.outcome_kind || (ar.is_target ? 'lead' : 'none');
    if (kind !== 'lead' && !ar.is_target) return null;
    const db = this.db;
    const cn = ar.company_name || (ar.company && ar.company.name) || null;
    const ctn = ar.contact_person || (ar.contact && ar.contact.name) || null;
    const ctp = ar.contact_phone || (ar.contact && ar.contact.phone) || null;
    const cte = ar.contact_email || (ar.contact && ar.contact.email) || null;
    const od = ar.object_description || (ar.object && ar.object.name) || null;
    const loc = ar.location || (ar.object && ar.object.address) || ar.dadata_region || null;
    const wtl = ar.work ? (ar.work.type_label || this._workTypeLabel(ar.work.type)) : this._workTypeLabel(ar.work_type);
    const tt = wtl || 'Прочее';
    const workTitle = ([tt, od].filter(Boolean).join(' — ') || 'Заявка из звонка').slice(0, 200);
    const workDescription = [
      ar.estimated_volume || (ar.work && ar.work.description),
      od ? 'Объект: ' + od : null,
      loc ? 'Адрес: ' + loc : null,
      ar.desired_timeline ? 'Сроки: ' + ar.desired_timeline : null,
      ar.access_conditions ? 'Условия доступа: ' + ar.access_conditions : null,
      ar.key_requirements && ar.key_requirements.length > 0 ? 'Требования: ' + ar.key_requirements.join('; ') : null
    ].filter(Boolean).join('. ') || null;

    let callMeta = null;
    try {
      const c = await db.query(
        'SELECT from_number, to_number, caller_number, client_number, call_type, direction FROM call_history WHERE id = $1',
        [callId]
      );
      callMeta = c.rows[0] || null;
    } catch (_) { /* не критично */ }
    const direction = callMeta && (callMeta.direction || callMeta.call_type);
    const callerPhone = (callMeta && (callMeta.client_number
      || (direction === 'outbound' ? callMeta.to_number : callMeta.from_number)
      || callMeta.caller_number)) || ctp;

    try {
      const existing = await this.findOpenPreTenderForClient({
        phone: callerPhone || ctp,
        inn: ar.customer_inn || (ar.company && ar.company.inn) || null,
        company: cn,
        windowDays: 30
      });
      if (existing && existing.id) {
        await db.query(
          'UPDATE call_history SET pre_tender_id = $1, updated_at = NOW() WHERE id = $2',
          [existing.id, callId]
        );
        await this.appendCallToPreTender(existing.id, { summary: ar.summary });
        console.log('[CallAnalyzer] Call #' + callId + ' appended to existing pre-tender #' + existing.id);
        return existing.id;
      }
    } catch (err) {
      console.warn('[CallAnalyzer] dedup step skipped:', err.message);
    }

    try {
      const r = await db.query(
        `INSERT INTO pre_tender_requests (
           source_type, customer_name, customer_email, customer_inn,
           contact_person, contact_phone, work_description, work_location,
           work_title, ai_work_type, ai_summary, ai_color,
           status, created_by, assigned_to, has_documents, created_at, updated_at
         ) VALUES (
           'phone', $1, $2, $3,
           $4, $5, $6, $7,
           $8, $9, $10, 'yellow',
           'new', $11, $11, false, NOW(), NOW()
         ) RETURNING id`,
        [
          cn || 'Из звонка',
          cte,
          ar.customer_inn || (ar.company && ar.company.inn) || null,
          ctn,
          ctp || callerPhone || null,
          workDescription,
          loc,
          workTitle,
          tt.slice(0, 200),
          ar.summary || null,
          managerId || null
        ]
      );
      const ptId = r.rows[0].id;
      try {
        const { ensureDocumentFolders } = require('./pre-tender-doc-folders');
        await db.query(
          'UPDATE pre_tender_requests SET document_folders = $1 WHERE id = $2',
          [JSON.stringify(ensureDocumentFolders(null)), ptId]
        );
      } catch (_) { /* folders optional */ }
      await db.query(
        'UPDATE call_history SET pre_tender_id = $1, updated_at = NOW() WHERE id = $2',
        [ptId, callId]
      );
      console.log('[CallAnalyzer] Pre-tender #' + ptId + ' from call #' + callId);
      return ptId;
    } catch (err) {
      console.error('[CallAnalyzer] Failed to create pre-tender from call:', err.message);
      return null;
    }
  }

  /**
   * Поручение в «Мои задачи» после звонка (outcome_kind=task).
   */
  async createFollowupTask(ar, callId, managerId) {
    const db = this.db;
    let callMeta = null;
    try {
      const c = await db.query(
        `SELECT id, from_number, to_number, caller_number, client_number, call_type,
                user_id, created_at, task_id, pre_tender_id
           FROM call_history WHERE id = $1`,
        [callId]
      );
      callMeta = c.rows[0] || null;
    } catch (_) { /* ignore */ }
    if (callMeta && callMeta.task_id) {
      return { taskId: callMeta.task_id, assigneeId: managerId || (callMeta && callMeta.user_id) || null, needsAssigneeTag: false };
    }

    const byName = await this.resolveAssigneeByName(ar.suggested_assignee_name);
    // A4: если есть живая заявка клиента — предпочитаем её assigned_to
    let ptAssignee = null;
    try {
      const phoneHint = (callMeta && (callMeta.client_number || callMeta.from_number || callMeta.caller_number)) || ar.contact_phone;
      const existing = await this.findOpenPreTenderForClient({
        phone: phoneHint,
        inn: ar.customer_inn || (ar.company && ar.company.inn) || null,
        company: ar.company_name || (ar.company && ar.company.name) || null,
        windowDays: 30
      });
      if (existing && existing.assigned_to) ptAssignee = existing.assigned_to;
    } catch (_) { /* ignore */ }

    const preferred = byName || ptAssignee || managerId || (callMeta && callMeta.user_id);
    let assigneeId = await this._fallbackAssigneeId(preferred);
    const needsAssigneeTag = !byName && !ptAssignee && !(managerId || (callMeta && callMeta.user_id));

    if (!assigneeId) {
      console.warn('[CallAnalyzer] No assignee for follow-up task, call #' + callId);
      return null;
    }

    const phone = (callMeta && (callMeta.client_number || callMeta.from_number || callMeta.caller_number)) || ar.contact_phone || '';
    const company = ar.company_name || '';
    const title = (ar.task_title
      || (ar.summary ? String(ar.summary).slice(0, 120) : null)
      || ('Поручение после звонка' + (company ? ': ' + company : ''))).slice(0, 200);

    const nextSteps = Array.isArray(ar.next_steps) && ar.next_steps.length
      ? ar.next_steps.map((s) => '• ' + s).join('\n')
      : '';
    const description = [
      ar.summary || null,
      phone ? 'Телефон: ' + phone : null,
      company ? 'Клиент: ' + company : null,
      ar.contact_person ? 'Контакт: ' + ar.contact_person : null,
      nextSteps || null,
      'Звонок #' + callId,
      'Ссылка: #/telephony?call=' + callId
    ].filter(Boolean).join('\n');

    let deadline = null;
    if (ar.task_due_hint && /час|сегодня|срочно/i.test(ar.task_due_hint)) {
      deadline = new Date(Date.now() + 4 * 60 * 60 * 1000);
    } else if (ar.urgency === 'critical' || ar.urgency === 'high') {
      deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    } else {
      deadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    }

    const tags = ['звонок'];
    if (needsAssigneeTag) tags.push('нужен_исполнитель');

    const priority = this._urgencyToPriority(ar.urgency);

    try {
      const task = await db.query(
        `INSERT INTO tasks (
           title, description, assignee_id, creator_id, deadline, priority, status, tags, task_kind, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, 'directive', NOW(), NOW())
         RETURNING id`,
        [
          title,
          description,
          assigneeId,
          managerId || assigneeId,
          deadline,
          priority,
          JSON.stringify(tags)
        ]
      );
      const taskId = task.rows[0].id;
      await db.query(
        'UPDATE call_history SET task_id = $1, updated_at = NOW() WHERE id = $2',
        [taskId, callId]
      );
      console.log('[CallAnalyzer] Follow-up task #' + taskId + ' from call #' + callId + ' → user ' + assigneeId);
      return { taskId, assigneeId, needsAssigneeTag };
    } catch (err) {
      console.error('[CallAnalyzer] Failed to create follow-up task:', err.message);
      return null;
    }
  }
}

module.exports = CallAnalyzer;
