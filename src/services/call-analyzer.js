'use strict';

const { getCallAnalysisPrompt } = require('../prompts/call-analysis-prompt');

class CallAnalyzer {
  constructor(aiProvider, db) {
    this.aiProvider = aiProvider;
    this.db = db;
  }

  async analyze(transcript, callData) {
    if (!transcript || transcript.trim().length < 20) {
      return { is_target: false, summary: 'Слишком короткий разговор для анализа', sentiment: 'neutral', classification: 'wrong_number', quality_score: null, _skipped: true };
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
        // D-253 / план: сводка звонков — yandex-pro
        model: process.env.CALL_ANALYSIS_MODEL || 'yandex-pro',
      });
      const text = typeof response === 'string' ? response : (response.text || response.content || '');
      return this._parseResponse(text);
    } catch (err) {
      console.error('[CallAnalyzer] AI analysis failed:', err.message);
      return { is_target: null, summary: 'Ошибка ИИ-анализа: ' + err.message, sentiment: 'neutral', classification: null, quality_score: null, _error: true };
    }
  }
  _parseResponse(text) {
    let cleaned = text.trim();
    const BT3 = String.fromCharCode(96,96,96);
    if (cleaned.startsWith(BT3 + 'json')) cleaned = cleaned.slice(BT3.length + 4);
    else if (cleaned.startsWith(BT3)) cleaned = cleaned.slice(3);
    if (cleaned.endsWith(BT3)) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd > jsonStart) cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    try { return this._normalizeFields(JSON.parse(cleaned)); }
    catch (err) {
      console.error('[CallAnalyzer] Parse failed:', err.message);
      return { is_target: null, summary: cleaned.slice(0, 500), sentiment: 'neutral', classification: null, quality_score: null, _parseError: true };
    }
  }

  _normalizeFields(data) {
    const VS = ['positive','neutral','negative','aggressive'];
    const VU = ['critical','high','medium','low'];
    const VC = ['new_inquiry','repeat_order','complaint','warranty_claim','information_request','partnership_proposal','supplier_offer','spam','wrong_number'];
    const VW = ['chemical_cleaning','hydro_cleaning','hvac_maintenance','hvac_repair','hvac_installation','industrial_service','consultation','other'];
    const VE = ['heat_exchanger','boiler','pipeline','chiller','ahu','cooling_tower','pump','valve','other'];
    const VSRC = ['website','referral','repeat_client','advertisement','search','exhibition','cold_call'];
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
      is_target: typeof data.is_target === 'boolean' ? data.is_target : null,
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

  /**
   * Найти «живую» заявку того же клиента за windowDays.
   * Один клиент = одна заявка: 10 звонков не должны давать 10 карточек.
   * Матч по нормализованному телефону, ИНН или названию компании.
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
        `SELECT id, work_title, work_description, status, created_at
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

  /** Дописать звонок в историю существующей заявки. */
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
    if (!ar.is_target) return null;
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

    // Дедуп: второй/десятый звонок клиента — это та же заявка, не новая.
    let callMeta = null;
    try {
      const c = await db.query(
        'SELECT from_number, caller_number, client_number, direction FROM call_history WHERE id = $1',
        [callId]
      );
      callMeta = c.rows[0] || null;
    } catch (_) { /* не критично */ }
    const callerPhone = (callMeta && (callMeta.client_number
      || (callMeta.direction === 'outbound' ? callMeta.to_number : callMeta.from_number)
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
      // Маркетплейс (director-inbox), не сага tenders.
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
}

module.exports = CallAnalyzer;