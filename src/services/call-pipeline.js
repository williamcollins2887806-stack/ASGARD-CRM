'use strict';

const fs = require('fs');
const path = require('path');
const { getMangoService } = require('./mango');
const { getSpeechKitService } = require('./speechkit');
const CallAnalyzer = require('./call-analyzer');

class CallPipeline {
  constructor(db, aiProvider, notifyFn) {
    this.db = db;
    this.mango = getMangoService();
    this.speechKit = getSpeechKitService();
    this.analyzer = new CallAnalyzer(aiProvider, db);
    this.notify = notifyFn;
    this.recordStorage = process.env.TELEPHONY_RECORD_STORAGE || './uploads/call_records';
    this.jobQueue = null;
    this.escalationChecker = null;
  }

  /**
   * Attach job queue for persistent async processing
   */
  setJobQueue(jobQueue) {
    this.jobQueue = jobQueue;
  }

  /**
   * Attach escalation checker for DB-persistent escalation
   */
  setEscalationChecker(escalationChecker) {
    this.escalationChecker = escalationChecker;
  }

  /**
   * Register pipeline handlers with the job queue
   */
  registerHandlers(jobQueue) {
    this.jobQueue = jobQueue;
    const self = this;

    jobQueue.register('download_recording', async (job) => {
      const { rows } = await self.db.query('SELECT * FROM call_history WHERE id = $1', [job.call_id]);
      if (!rows.length) return;
      await self._downloadRecording(rows[0], { throwOnError: true });
      const updated = (await self.db.query('SELECT * FROM call_history WHERE id = $1', [job.call_id])).rows[0];
      if (updated && updated.record_path && (updated.transcript_status === 'none' || updated.transcript_status === 'error')) {
        await jobQueue.enqueue('transcribe', job.call_id);
      }
    });

    jobQueue.register('transcribe', async (job) => {
      const { rows } = await self.db.query('SELECT * FROM call_history WHERE id = $1', [job.call_id]);
      if (!rows.length) return;
      await self._transcribe(rows[0], { throwOnError: true });
      const updated = (await self.db.query('SELECT * FROM call_history WHERE id = $1', [job.call_id])).rows[0];
      if (updated && updated.transcript && updated.transcript_status === 'done' && self._needsAnalyze(updated)) {
        await jobQueue.enqueue('analyze', job.call_id);
      }
    });

    jobQueue.register('analyze', async (job) => {
      const { rows } = await self.db.query('SELECT * FROM call_history WHERE id = $1', [job.call_id]);
      if (!rows.length) return;
      await self._aiAnalyze(rows[0], { throwOnError: true });
    });
  }

  /** Нужен ли AI-анализ: нет валидного результата или помечен retryable. */
  _needsAnalyze(call) {
    if (!call) return false;
    const st = call.ai_analysis_status;
    if (st === 'done' || st === 'skipped' || st === 'error_final') return false;
    if (st === 'pending' || st === 'error_retryable') return true;
    // legacy: пустой summary или старая запись ошибки
    if (!call.ai_summary) return true;
    if (/^Ошибка ИИ-анализа:/i.test(String(call.ai_summary))) return true;
    return false;
  }

  /**
   * Полный pipeline обработки звонка после завершения
   * Вызывается асинхронно после ответа на webhook
   */
  async processCall(callHistoryId) {
    const { rows } = await this.db.query('SELECT * FROM call_history WHERE id = $1', [callHistoryId]);
    if (!rows.length) return;
    const call = rows[0];

    console.log(`[CallPipeline] Processing call #${callHistoryId} (${call.call_type}, recording: ${call.recording_id || 'none'})`);

    // If jobQueue is available, enqueue steps for persistent processing
    if (this.jobQueue) {
      if (call.recording_id && !call.record_path) {
        await this.jobQueue.enqueue('download_recording', callHistoryId, { recording_id: call.recording_id });
      } else if (call.record_path && (call.transcript_status === 'none' || call.transcript_status === 'error')) {
        await this.jobQueue.enqueue('transcribe', callHistoryId);
      } else if (call.transcript && call.transcript_status === 'done' && this._needsAnalyze(call)) {
        await this.jobQueue.enqueue('analyze', callHistoryId);
      }
      return;
    }

    // Fallback: direct processing (original behavior)
    if (call.recording_id && !call.record_path) {
      await this._downloadRecording(call);
    }

    const updatedCall = (await this.db.query('SELECT * FROM call_history WHERE id = $1', [callHistoryId])).rows[0];
    if (updatedCall.record_path && (updatedCall.transcript_status === 'none' || updatedCall.transcript_status === 'error')) {
      await this._transcribe(updatedCall);
    }

    const finalCall = (await this.db.query('SELECT * FROM call_history WHERE id = $1', [callHistoryId])).rows[0];
    if (finalCall.transcript && finalCall.transcript_status === 'done' && this._needsAnalyze(finalCall)) {
      await this._aiAnalyze(finalCall);
    }
  }

  async _downloadRecording(call, opts = {}) {
    if (!this.mango.isConfigured()) return;

    try {
      console.log(`[CallPipeline] Downloading recording ${call.recording_id}...`);

      const { buffer, contentType } = await this.mango.downloadRecording(call.recording_id);

      const ext = contentType.includes('mp3') ? 'mp3' : contentType.includes('wav') ? 'wav' : 'mp3';
      const dateDir = new Date(call.created_at).toISOString().slice(0, 7);
      const dir = path.resolve(this.recordStorage, dateDir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const fileName = `${call.recording_id}.${ext}`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, buffer);

      await this.db.query(
        'UPDATE call_history SET record_path = $1, recording_url = $2, updated_at = NOW() WHERE id = $3',
        [filePath, `/api/telephony/calls/${call.id}/record`, call.id]
      );

      console.log(`[CallPipeline] Recording saved: ${filePath} (${buffer.length} bytes)`);
    } catch (err) {
      console.error(`[CallPipeline] Recording download failed for ${call.recording_id}:`, err.message);
      if (opts.throwOnError) throw err;
    }
  }

  async _transcribe(call, opts = {}) {
    // Emulation gate: skip paid SpeechKit, inject stub transcript
    if (process.env.TELEPHONY_EMU_MOCK === '1') {
      const stubText =
        'Клиент: Здравствуйте, хочу уточнить сроки.\nОператор: Добрый день, подскажу по договору.';
      const segments = [
        { speaker: 'Клиент', text: 'Здравствуйте, хочу уточнить сроки.', start: 0, end: 2 },
        { speaker: 'Оператор', text: 'Добрый день, подскажу по договору.', start: 2, end: 5 },
      ];
      await this.db.query(
        `UPDATE call_history SET
          transcript = $1,
          transcript_segments = $2,
          transcript_status = 'done',
          updated_at = NOW()
        WHERE id = $3`,
        [stubText, JSON.stringify(segments), call.id]
      );
      console.log(`[CallPipeline] EMU_MOCK transcription for #${call.id}`);
      return;
    }

    if (!this.speechKit.isConfigured()) return;

    try {
      await this.db.query(
        'UPDATE call_history SET transcript_status = $1, updated_at = NOW() WHERE id = $2',
        ['processing', call.id]
      );

      console.log(`[CallPipeline] Transcribing ${call.record_path}...`);

      // Стерео (L=клиент, R=оператор) обрабатываем ПО КАНАЛАМ — только если файл
      // реально стерео (после склейки r()/t()). Для моно — обычный путь, иначе
      // правая дорожка была бы пустой и мы бы «потеряли» половину разговора.
      const isStereo = (() => {
        try {
          const { spawnSync } = require('child_process');
          const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
            '-show_entries', 'stream=channels', '-of', 'default=nw=1:nk=1', call.record_path],
            { encoding: 'utf8' });
          return parseInt(String(r.stdout || '').trim(), 10) >= 2;
        } catch (_) { return false; }
      })();

      let result;
      if (isStereo && typeof this.speechKit.transcribeStereoChannels === 'function') {
        result = await this.speechKit.transcribeStereoChannels(call.record_path, {
          leftLabel: 'Клиент',
          rightLabel: 'Оператор',
          minSeconds: 10,
        });
      } else {
        result = await this.speechKit.transcribeFile(call.record_path, {
          enableSpeakerDiarization: true,
          maxSpeakers: 2,
          audioChannelCount: 2,
        });
      }

      // Третий и последующие спикеры (перевод). Диаризация по каналу даёт лишь
      // «оператор», но голоса Оператора1/Оператора2 в одном канале. Размечаем
      // ПО ВРЕМЕНИ перевода (pbx_call_legs, role transfer_*), с мёртвой зоной
      // ±1 с: реплики в ней — нейтральны, чтобы не приписать не тому.
      await this._markTransferSpeakers(call, result);

      const formatted = this._formatTranscript(result);
      await this.db.query(
        `UPDATE call_history SET
          transcript = $1,
          transcript_segments = $2,
          transcript_status = 'done',
          updated_at = NOW()
        WHERE id = $3`,
        [formatted, JSON.stringify(result.segments), call.id]
      );

      // Пустая речь: не оставляем карточку в вечном «Ждёт анализ ИИ»
      if (!String(formatted || '').trim()) {
        await this.db.query(
          `UPDATE call_history SET
             ai_summary = $1,
             ai_sentiment = 'neutral',
             ai_is_target = false,
             ai_analysis_status = 'skipped',
             ai_last_error = NULL,
             ai_last_error_at = NULL,
             updated_at = NOW()
           WHERE id = $2`,
          ['В записи нет распознанной речи', call.id]
        );
        console.log(`[CallPipeline] Transcription empty for #${call.id} — AI skipped`);
      } else {
        console.log(`[CallPipeline] Transcription done: ${result.text.length} chars, ${result.segments.length} segments`);
      }
    } catch (err) {
      console.error(`[CallPipeline] Transcription failed for call #${call.id}:`, err.message);
      await this.db.query(
        'UPDATE call_history SET transcript_status = $1, ai_last_error = $2, ai_last_error_at = NOW(), updated_at = NOW() WHERE id = $3',
        ['error', String(err.message || 'transcribe_failed').slice(0, 2000), call.id]
      );
      if (opts.throwOnError) {
        err.retryable = true;
        err.code = err.code || 'provider_error';
        throw err;
      }
    }
  }

  /**
   * Разметка третьего и последующих спикеров (переводы).
   *
   * Диаризация по каналам различает только «клиент»/«оператор». Голоса
   * Оператора1 и Оператора2 физически в одном канале — разделяем ПО ВРЕМЕНИ
   * переводов из pbx_call_legs (role transfer_*). Мёртвая зона ±1 с вокруг
   * перевода: реплики в ней получают нейтральную метку (speaker: null), чтобы
   * не приписать не тому оператору.
   *
   * @param {object} call — строка call_history
   * @param {{segments:Array}} result — результат транскрибации (мутируется)
   */
  async _markTransferSpeakers(call, result) {
    try {
      if (!result || !Array.isArray(result.segments) || !result.segments.length) return;
      const key = call.pbx_uid || call.call_id || '';
      if (!key) return;
      const { rows } = await this.db.query(
        `SELECT l.started_at, l.user_id, u.name
           FROM pbx_call_legs l
           LEFT JOIN users u ON u.id = l.user_id
          WHERE l.role IN ('transfer_blind','transfer_consult')
            AND (l.call_id = $1 OR l.call_id = ('pbx_' || $1))
          ORDER BY l.started_at ASC`,
        [String(key).replace(/^pbx_/, '')]
      );
      if (!rows.length) return;

      // Время сегментов — относительно начала записи. Пересчитываем переводы
      // относительно call.started_at (recording начинается с ответа/начала звонка).
      const baseMs = call.started_at ? new Date(call.started_at).getTime() : null;
      const transfers = rows.map((r) => ({
        tSec: baseMs ? (new Date(r.started_at).getTime() - baseMs) / 1000 : null,
        name: r.name || null,
        userId: r.user_id || null,
      }));
      const DEAD_ZONE = 1; // секунды

      result.segments.forEach((seg) => {
        // Только реплики оператора (speaker 1) меняют «личность» при переводе.
        if (Number(seg.speaker) !== 1) return;
        const t = Number(seg.start);
        if (!Number.isFinite(t)) return;
        let idx = 1;
        let label = seg.speakerLabel || 'Оператор';
        let neutral = false;
        for (const tr of transfers) {
          if (tr.tSec == null) continue;
          if (t >= tr.tSec + DEAD_ZONE) {
            idx += 1;
            label = tr.name || ('Сотрудник ' + (idx));
            neutral = false;
          } else if (t >= tr.tSec - DEAD_ZONE && t < tr.tSec + DEAD_ZONE) {
            neutral = true;
          }
        }
        if (neutral) {
          seg.speaker = null;
          seg.speakerLabel = 'Спикер';
        } else if (idx > 1) {
          seg.speaker = idx;         // 2, 3, ...
          seg.speakerLabel = label;
        }
      });
    } catch (e) {
      console.warn('[CallPipeline] transfer speaker marking skipped:', e.message);
    }
  }

  /**
   * Предыдущие заявки клиента по номеру звонка (для контекста ИИ и дедупа).
   * Возвращает максимум 5 последних «живых» карточек маркетплейса.
   */
  async _clientHistoryForCall(call) {
    try {
      const raw = call.client_number
        || (call.call_type === 'outbound' ? call.to_number : call.from_number)
        || call.caller_number || '';
      const digits = String(raw).replace(/\D/g, '').slice(-10);
      if (digits.length !== 10) return [];
      // Заявки клиента — чтобы ИИ понимал, что обращение уже в работе.
      const r = await this.db.query(
        `SELECT id, created_at, work_title, status
           FROM pre_tender_requests
          WHERE right(regexp_replace(COALESCE(contact_phone, ''), '\\D', '', 'g'), 10) = $1
            AND COALESCE(status, '') NOT IN ('rejected', 'expired')
          ORDER BY created_at DESC
          LIMIT 5`,
        [digits]
      );
      const rows = r.rows || [];
      // Прошлые звонки этого же клиента — фактический контекст разговора:
      // что уже обсуждали, что обещали, чем закончилось.
      try {
        const prev = await this.db.query(
          `SELECT id, created_at, started_at, duration_seconds, ai_summary,
                  ai_sentiment, ai_quality_score, user_id
             FROM call_history
            WHERE right(regexp_replace(COALESCE(client_number, ''), '\\D', '', 'g'), 10) = $1
              AND id <> $2
              AND ai_summary IS NOT NULL
              AND ai_summary <> ''
              AND parent_call_id IS NULL
            ORDER BY COALESCE(started_at, created_at) DESC
            LIMIT 8`,
          [digits, call.id || 0]
        );
        for (const p of prev.rows || []) {
          const dt = p.started_at || p.created_at;
          const day = dt ? new Date(dt).toLocaleDateString('ru-RU') : 'ранее';
          const dur = p.duration_seconds ? ` (${Math.floor(p.duration_seconds / 60)} мин)` : '';
          rows.push({
            id: null,
            created_at: dt,
            work_title: `Звонок ${day}${dur}: ${String(p.ai_summary || '').slice(0, 400)}`,
            status: 'звонок',
            call_id: p.id,
          });
        }
      } catch (e) {
        console.warn('[CallPipeline] previous calls lookup failed:', e.message);
      }
      return rows;
    } catch (err) {
      console.warn('[CallPipeline] client history lookup failed:', err.message);
      return [];
    }
  }

  async _aiAnalyze(call, opts = {}) {
    try {
      console.log(`[CallPipeline] AI analyzing call #${call.id}...`);

      await this.db.query(
        `UPDATE call_history SET
           ai_analysis_status = 'pending',
           updated_at = NOW()
         WHERE id = $1`,
        [call.id]
      );

      let managerName = null;
      if (call.user_id) {
        const mgr = await this.db.query('SELECT name FROM users WHERE id = $1', [call.user_id]);
        if (mgr.rows.length) managerName = mgr.rows[0].name;
      }

      const clientHistory = await this._clientHistoryForCall(call);

      const analysis = await this.analyzer.analyze(call.transcript, {
        direction: call.call_type === 'outbound' ? 'outbound' : 'inbound',
        from_number: call.from_number || call.caller_number,
        to_number: call.to_number || call.called_number,
        duration_seconds: call.duration_seconds || call.duration,
        manager_name: managerName,
        client_history: clientHistory
      });

      const qualityScore = analysis.quality_score != null ? analysis.quality_score : null;
      const status = analysis._skipped ? 'skipped' : 'done';

      await this.db.query(
        `UPDATE call_history SET
          ai_summary = $1,
          ai_is_target = $2,
          ai_lead_data = $3,
          ai_sentiment = $4,
          ai_quality_score = $5,
          ai_analysis_status = $6,
          ai_last_error = NULL,
          ai_last_error_at = NULL,
          updated_at = NOW()
        WHERE id = $7`,
        [
          analysis.summary,
          analysis.is_target,
          JSON.stringify(analysis),
          analysis.sentiment,
          qualityScore,
          status,
          call.id
        ]
      );

      const outcome = analysis.outcome_kind || 'none';
      console.log(`[CallPipeline] AI analysis done: outcome=${outcome}, target=${analysis.is_target}, quality=${qualityScore}`);

      if (analysis._skipped) return;

      const settings = await this._getSettings();
      const autoOk = settings.ai_enabled !== false && settings.auto_analyze !== false;
      // Уже есть заявка/задача — только summary (канон §B11)
      const alreadyLinked = !!(call.pre_tender_id || call.lead_id || call.task_id);

      if (!autoOk || alreadyLinked) return;

      if (outcome === 'lead') {
        const ptId = await this.analyzer.createDraftLead(analysis, call.id, call.user_id);
        if (ptId && this.notify && call.user_id) {
          await this.notify(this.db, {
            user_id: call.user_id,
            title: 'Звонок обработан',
            message: `Заявка #${ptId} из звонка в маркетплейсе. Проверьте данные.`,
            type: 'telephony',
            link: `#/director-inbox?id=${ptId}`
          });
        }
      } else if (outcome === 'task') {
        const created = await this.analyzer.createFollowupTask(analysis, call.id, call.user_id);
        if (created && created.taskId && this.notify) {
          await this.notify(this.db, {
            user_id: created.assigneeId,
            title: 'Поручение из звонка',
            message: (analysis.task_title || analysis.summary || 'Новая задача').slice(0, 200),
            type: 'telephony',
            link: `#/tasks?id=${created.taskId}`
          });
          if (created.needsAssigneeTag) {
            const directors = await this.db.query(
              "SELECT id FROM users WHERE role IN ('ADMIN','DIRECTOR_GEN','DIRECTOR_COMM') AND is_active = true"
            );
            for (const d of directors.rows) {
              await this.notify(this.db, {
                user_id: d.id,
                title: 'Задача из звонка без ясного исполнителя',
                message: `Задача #${created.taskId} по звонку #${call.id} — нужен исполнитель.`,
                type: 'telephony',
                link: `#/tasks?id=${created.taskId}`
              });
            }
          }
        }
      }
    } catch (err) {
      console.error(`[CallPipeline] AI analysis failed for call #${call.id}:`, err.message);
      const retryable = err.retryable !== false && err.code !== 'auth' && err.code !== 'bad_request';
      const contentFail = err.code === 'json_parse_error';
      let attempts = Number(call.ai_attempts || 0);
      if (contentFail) attempts += 1;
      let status = 'error_retryable';
      if (!retryable) status = 'error_final';
      else if (contentFail && attempts >= 3) status = 'error_final';

      try {
        await this.db.query(
          `UPDATE call_history SET
             ai_analysis_status = $1,
             ai_last_error = $2,
             ai_last_error_at = NOW(),
             ai_attempts = $3,
             updated_at = NOW()
           WHERE id = $4`,
          [status, String(err.message || 'ai_failed').slice(0, 2000), attempts, call.id]
        );
      } catch (_) { /* ignore */ }

      if (opts.throwOnError || retryable) {
        err.retryable = retryable && status === 'error_retryable';
        err.code = err.code || 'provider_error';
        throw err;
      }
    }
  }

  /**
   * Обработка локальной записи (MixMonitor).
   * Пропускает download — файл уже на диске.
   */
  async processLocalRecording(callHistoryId) {
    const { rows } = await this.db.query('SELECT * FROM call_history WHERE id = $1', [callHistoryId]);
    if (!rows.length) return;
    const call = rows[0];

    if (!call.record_path) {
      console.log(`[CallPipeline] processLocalRecording: no record_path for call #${callHistoryId}`);
      return;
    }

    if (!fs.existsSync(call.record_path)) {
      console.log(`[CallPipeline] processLocalRecording: file not found ${call.record_path}`);
      return;
    }

    console.log(`[CallPipeline] Processing local recording for call #${callHistoryId}: ${call.record_path}`);

    if (this.jobQueue) {
      if (call.transcript_status === 'none' || !call.transcript_status || call.transcript_status === 'error') {
        await this.jobQueue.enqueue('transcribe', callHistoryId);
      } else if (call.transcript && call.transcript_status === 'done' && this._needsAnalyze(call)) {
        await this.jobQueue.enqueue('analyze', callHistoryId);
      }
      return;
    }

    if (call.transcript_status === 'none' || !call.transcript_status || call.transcript_status === 'error') {
      await this._transcribe(call);
    }

    const updated = (await this.db.query('SELECT * FROM call_history WHERE id = $1', [callHistoryId])).rows[0];
    if (updated && updated.transcript && updated.transcript_status === 'done' && this._needsAnalyze(updated)) {
      await this._aiAnalyze(updated);
    }
  }

  /**
   * Обработка пропущенного звонка: создание задачи + эскалация
   */
  async handleMissedCall(callId) {
    const { rows } = await this.db.query('SELECT * FROM call_history WHERE id = $1', [callId]);
    if (!rows.length) return;
    const call = rows[0];
    if (call.call_type !== 'missed') return;

    const settings = await this._getSettings();
    const deadlineMinutes = settings.missed_deadline_minutes || 30;

    // Находим ответственного менеджера (дежурный РП из pm_duty_roster по МСК)
    let assigneeId = call.user_id;
    if (!assigneeId) {
      try {
        const { getCurrentDuty } = require('./tender-registry-helpers');
        const duty = await getCurrentDuty(this.db);
        if (duty?.pm_user_id) assigneeId = duty.pm_user_id;
      } catch (_) { /* ignore */ }
    }
    if (!assigneeId) {
      const duty = await this.db.query(
        'SELECT user_id FROM user_call_status WHERE is_duty = true AND accepting = true LIMIT 1'
      );
      if (duty.rows.length) assigneeId = duty.rows[0].user_id;
    }

    if (!assigneeId) return;

    // Создаём задачу
    const deadline = new Date(Date.now() + deadlineMinutes * 60 * 1000);
    const fromDisplay = call.from_number || call.caller_number || 'неизвестный номер';

    const task = await this.db.query(
      `INSERT INTO tasks (title, description, assignee_id, creator_id, deadline, priority, status, tags, created_at)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [
        'Перезвонить: ' + fromDisplay,
        'Пропущенный звонок от ' + fromDisplay + '. Дата: ' + new Date(call.created_at).toLocaleString('ru-RU'),
        assigneeId,
        deadline,
        'high',
        'new',
        JSON.stringify(['перезвонить', 'пропущенный'])
      ]
    );

    const taskId = task.rows[0].id;

    await this.db.query(
      'UPDATE call_history SET missed_task_id = $1, updated_at = NOW() WHERE id = $2',
      [taskId, callId]
    );

    if (this.notify) {
      await this.notify(this.db, {
        user_id: assigneeId,
        title: 'Пропущенный звонок',
        message: 'Перезвоните на ' + fromDisplay + '. Дедлайн: ' + deadlineMinutes + ' минут.',
        type: 'telephony',
        link: '/telephony?tab=missed'
      });
    }

    // DB-persistent escalation (via escalation_checker)
    if (this.escalationChecker) {
      await this.escalationChecker.createEscalation(callId, assigneeId, deadlineMinutes);
    } else {
      // Fallback: in-memory timer (original behavior)
      setTimeout(() => this._escalateMissedCall(callId, taskId, assigneeId), deadlineMinutes * 60 * 1000);
    }

    return taskId;
  }

  async _escalateMissedCall(callId, taskId, assigneeId) {
    try {
      const { rows } = await this.db.query('SELECT status FROM tasks WHERE id = $1', [taskId]);
      if (!rows.length) return;

      if (rows[0].status !== 'done' && rows[0].status !== 'completed') {
        const directors = await this.db.query(
          "SELECT id FROM users WHERE role IN ('ADMIN','DIRECTOR_GEN','DIRECTOR_COMM') AND is_active = true"
        );

        for (const dir of directors.rows) {
          if (this.notify) {
            await this.notify(this.db, {
              user_id: dir.id,
              title: 'Эскалация: пропущенный звонок',
              message: 'Задача #' + taskId + ' на перезвон не выполнена в срок.',
              type: 'telephony',
              link: '/telephony?tab=missed'
            });
          }
        }

        console.log('[CallPipeline] Escalated missed call #' + callId + ', task #' + taskId);
      }
    } catch (err) {
      console.error('[CallPipeline] Escalation error:', err.message);
    }
  }

  /**
   * Оценка качества по метаданным (без транскрипции)
   * Шкала 1-10 на основе длительности и типа звонка
   */
  _metadataQualityScore(call) {
    const dur = call.duration_seconds || call.duration || 0;
    const type = call.call_type || call.direction;

    // Пропущенные — нет оценки
    if (type === 'missed' || dur === 0) return null;

    // Базовая оценка по длительности
    let score;
    if (dur < 15) score = 3;       // Очень короткий
    else if (dur < 30) score = 4;   // Короткий
    else if (dur < 60) score = 5;   // Нормальный
    else if (dur < 180) score = 6;  // Хороший разговор
    else if (dur < 300) score = 7;  // Длительный
    else score = 7;                 // Очень длительный

    return score;
  }

  _formatTranscript(result) {
    if (!result.segments || result.segments.length === 0) {
      return result.text || '';
    }
    return result.segments.map(function(seg) {
      var label = seg.speakerLabel || ('Спикер ' + (seg.speaker || 1));
      return '[' + label + ']: ' + (seg.text || '');
    }).join('\n');
  }

  async _getSettings() {
    try {
      const { rows } = await this.db.query("SELECT value_json FROM settings WHERE key = 'telephony_config'");
      if (rows.length && rows[0].value_json) {
        return JSON.parse(rows[0].value_json);
      }
    } catch (e) { /* ignore */ }
    return { missed_deadline_minutes: 30, ai_enabled: true, auto_transcribe: true, auto_analyze: true };
  }
}

module.exports = CallPipeline;
