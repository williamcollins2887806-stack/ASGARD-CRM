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
      await self._downloadRecording(rows[0]);
      // Chain: enqueue transcription after download
      const updated = (await self.db.query('SELECT * FROM call_history WHERE id = $1', [job.call_id])).rows[0];
      if (updated && updated.record_path && updated.transcript_status === 'none') {
        await jobQueue.enqueue('transcribe', job.call_id);
      }
    });

    jobQueue.register('transcribe', async (job) => {
      const { rows } = await self.db.query('SELECT * FROM call_history WHERE id = $1', [job.call_id]);
      if (!rows.length) return;
      await self._transcribe(rows[0]);
      // Chain: enqueue analysis after transcription
      const updated = (await self.db.query('SELECT * FROM call_history WHERE id = $1', [job.call_id])).rows[0];
      if (updated && updated.transcript && updated.transcript_status === 'done' && !updated.ai_summary) {
        await jobQueue.enqueue('analyze', job.call_id);
      }
    });

    jobQueue.register('analyze', async (job) => {
      const { rows } = await self.db.query('SELECT * FROM call_history WHERE id = $1', [job.call_id]);
      if (!rows.length) return;
      await self._aiAnalyze(rows[0]);
    });
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
      } else if (call.record_path && call.transcript_status === 'none') {
        await this.jobQueue.enqueue('transcribe', callHistoryId);
      } else if (call.transcript && call.transcript_status === 'done' && !call.ai_summary) {
        await this.jobQueue.enqueue('analyze', callHistoryId);
      }
      return;
    }

    // Fallback: direct processing (original behavior)
    // Шаг 1: Скачиваем запись
    if (call.recording_id && !call.record_path) {
      await this._downloadRecording(call);
    }

    // Шаг 2: Транскрибируем
    const updatedCall = (await this.db.query('SELECT * FROM call_history WHERE id = $1', [callHistoryId])).rows[0];
    if (updatedCall.record_path && updatedCall.transcript_status === 'none') {
      await this._transcribe(updatedCall);
    }

    // Шаг 3: ИИ-анализ
    const finalCall = (await this.db.query('SELECT * FROM call_history WHERE id = $1', [callHistoryId])).rows[0];
    if (finalCall.transcript && finalCall.transcript_status === 'done' && !finalCall.ai_summary) {
      await this._aiAnalyze(finalCall);
    }
  }

  async _downloadRecording(call) {
    if (!this.mango.isConfigured()) return;

    try {
      console.log(`[CallPipeline] Downloading recording ${call.recording_id}...`);

      const { buffer, contentType } = await this.mango.downloadRecording(call.recording_id);

      // Определяем расширение
      const ext = contentType.includes('mp3') ? 'mp3' : contentType.includes('wav') ? 'wav' : 'mp3';
      const dateDir = new Date(call.created_at).toISOString().slice(0, 7);
      const dir = path.resolve(this.recordStorage, dateDir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const fileName = `${call.recording_id}.${ext}`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, buffer);

      await this.db.query(
        'UPDATE call_history SET record_path = $1, record_url = $2, updated_at = NOW() WHERE id = $3',
        [filePath, `/api/telephony/calls/${call.id}/record`, call.id]
      );

      console.log(`[CallPipeline] Recording saved: ${filePath} (${buffer.length} bytes)`);
    } catch (err) {
      console.error(`[CallPipeline] Recording download failed for ${call.recording_id}:`, err.message);
    }
  }

  async _transcribe(call) {
    if (!this.speechKit.isConfigured()) return;

    try {
      await this.db.query(
        'UPDATE call_history SET transcript_status = $1, updated_at = NOW() WHERE id = $2',
        ['processing', call.id]
      );

      console.log(`[CallPipeline] Transcribing ${call.record_path}...`);

      const result = await this.speechKit.transcribeFile(call.record_path, {
        enableSpeakerDiarization: true,
        maxSpeakers: 2
      });

      await this.db.query(
        `UPDATE call_history SET
          transcript = $1,
          transcript_segments = $2,
          transcript_status = 'done',
          updated_at = NOW()
        WHERE id = $3`,
        [this._formatTranscript(result), JSON.stringify(result.segments), call.id]
      );

      console.log(`[CallPipeline] Transcription done: ${result.text.length} chars, ${result.segments.length} segments`);
    } catch (err) {
      console.error(`[CallPipeline] Transcription failed for call #${call.id}:`, err.message);
      await this.db.query(
        'UPDATE call_history SET transcript_status = $1, updated_at = NOW() WHERE id = $2',
        ['error', call.id]
      );
    }
  }

  async _aiAnalyze(call) {
    try {
      console.log(`[CallPipeline] AI analyzing call #${call.id}...`);

      // Получаем имя менеджера
      let managerName = null;
      if (call.user_id) {
        const mgr = await this.db.query('SELECT name FROM users WHERE id = $1', [call.user_id]);
        if (mgr.rows.length) managerName = mgr.rows[0].name;
      }

      const analysis = await this.analyzer.analyze(call.transcript, {
        direction: call.call_type === 'outbound' ? 'outbound' : 'inbound',
        from_number: call.from_number || call.caller_number,
        to_number: call.to_number || call.called_number,
        duration_seconds: call.duration_seconds || call.duration,
        manager_name: managerName
      });

      // Сохраняем результат анализа
      await this.db.query(
        `UPDATE call_history SET
          ai_summary = $1,
          ai_is_target = $2,
          ai_lead_data = $3,
          ai_sentiment = $4,
          updated_at = NOW()
        WHERE id = $5`,
        [
          analysis.summary,
          analysis.is_target,
          JSON.stringify(analysis),
          analysis.sentiment,
          call.id
        ]
      );

      console.log(`[CallPipeline] AI analysis done: target=${analysis.is_target}, sentiment=${analysis.sentiment}`);

      // Создаём черновик заявки если целевой
      if (analysis.is_target && !call.lead_id) {
        const settings = await this._getSettings();
        if (settings.ai_enabled && settings.auto_analyze) {
          const leadId = await this.analyzer.createDraftLead(analysis, call.id, call.user_id);
          if (leadId && this.notify && call.user_id) {
            await this.notify(this.db, {
              user_id: call.user_id,
              title: 'Звонок обработан',
              message: `Создан черновик заявки #${leadId} из звонка. Проверьте данные.`,
              type: 'telephony',
              link: `/tenders?id=${leadId}`
            });
          }
        }
      }
    } catch (err) {
      console.error(`[CallPipeline] AI analysis failed for call #${call.id}:`, err.message);
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

    // Находим ответственного менеджера
    let assigneeId = call.user_id;
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
      `INSERT INTO tasks (title, description, assignee_id, deadline, priority, status, tags, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [
        'Перезвонить: ' + fromDisplay,
        'Пропущенный звонок от ' + fromDisplay + '. Дата: ' + new Date(call.created_at).toLocaleString('ru-RU'),
        assigneeId,
        deadline,
        'high',
        'todo',
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
